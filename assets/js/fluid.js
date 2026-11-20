/* Fluid: spring-driven motion for the hub pages, after Apple's "Designing Fluid Interfaces".
   - Every animation starts from the value on screen now and keeps its velocity when re-targeted,
     so anything can be grabbed or redirected mid-flight.
   - Springs are set with damping (1 = no overshoot) and response (seconds), not durations.
   - Cards lift and tilt toward the pointer and press in on pointer-down.
   - The genre filter has one selection pill that springs between chips (X and Y separately).
   - Filtering the grid moves cards to their new places instead of cutting.
   - The chat sheet can be dragged away: 1:1 tracking, rubber-banding, and a flick projects ahead.
   Honours prefers-reduced-motion by snapping instead of animating. Load after site.js. */
const Fluid = (() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  document.documentElement.classList.add('fluid');

  // ---------- Springs ----------

  const active = new Set();
  let raf = 0, last = 0;
  function tick(now) {
    const dt = Math.min(0.064, (now - last) / 1000 || 0.016);
    last = now;
    for (const s of active) {
      const steps = Math.ceil(dt / (1 / 240)), h = dt / steps;
      for (let i = 0; i < steps; i++) {
        s.velocity += (-s.k * (s.value - s.target) - s.c * s.velocity) * h;
        s.value += s.velocity * h;
      }
      if (Math.abs(s.value - s.target) < s.eps && Math.abs(s.velocity) < s.eps * 10) {
        s.value = s.target;
        s.velocity = 0;
        active.delete(s);
      }
      s.onUpdate(s.value);
    }
    raf = active.size ? requestAnimationFrame(tick) : 0;
  }
  function wake() {
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }

  function spring(value, onUpdate, { damping = 1, response = 0.4, eps = 0.01 } = {}) {
    const s = {
      value, target: value, velocity: 0, eps, onUpdate,
      k: 0, c: 0,
      config(d, r) { s.k = (2 * Math.PI / r) ** 2; s.c = 4 * Math.PI * d / r; return s; },
      // velocity is in units per second; leave it out to keep the current one (no brick wall).
      to(target, opts = {}) {
        if (opts.damping || opts.response) s.config(opts.damping ?? damping, opts.response ?? response);
        s.target = target;
        if (opts.velocity !== undefined) s.velocity = opts.velocity;
        if (reduced()) { s.value = target; s.velocity = 0; active.delete(s); s.onUpdate(target); return s; }
        active.add(s);
        wake();
        return s;
      },
      set(v) { s.value = s.target = v; s.velocity = 0; active.delete(s); s.onUpdate(v); return s; },
    };
    return s.config(damping, response);
  }

  // Where a flick would come to rest, as scroll deceleration does it (Apple's projection).
  const project = (v, rate = 0.998) => (v / 1000) * rate / (1 - rate);
  // Past a boundary the element follows less and less, like a real thing slowing before it stops.
  const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

  // Velocity from the last ~100ms of pointer samples.
  function tracker() {
    let pts = [];
    return {
      add(x, y) { const t = performance.now(); pts.push({ x, y, t }); pts = pts.filter(p => t - p.t < 100); },
      velocity() {
        if (pts.length < 2) return { x: 0, y: 0 };
        const a = pts[0], b = pts[pts.length - 1], dt = (b.t - a.t) / 1000 || 1;
        return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
      },
      reset() { pts = []; },
    };
  }

  // ---------- Cards: lift, tilt, press ----------

  const cardState = new WeakMap();
  function cardOf(el) {
    let st = cardState.get(el);
    if (st) return st;
    const v = { lift: 0, rx: 0, ry: 0, press: 1 };
    const apply = () => { el.style.transform = `perspective(900px) translateY(${v.lift}px) rotateX(${v.rx}deg) rotateY(${v.ry}deg) scale(${v.press})`; };
    st = {
      lift: spring(0, x => { v.lift = x; apply(); }, { damping: 1, response: 0.35 }),
      rx: spring(0, x => { v.rx = x; apply(); }, { damping: 1, response: 0.4 }),
      ry: spring(0, x => { v.ry = x; apply(); }, { damping: 1, response: 0.4 }),
      press: spring(1, x => { v.press = x; apply(); }, { damping: 1, response: 0.2, eps: 0.0005 }),
    };
    if (!el.querySelector('.shine')) el.insertAdjacentHTML('beforeend', '<span class="shine" aria-hidden="true"></span>');
    cardState.set(el, st);
    return st;
  }

  document.addEventListener('pointerover', e => {
    const el = e.target.closest?.('.card');
    if (!el || el.contains(e.relatedTarget) || !finePointer) return;
    cardOf(el).lift.to(-4);
  });
  document.addEventListener('pointermove', e => {
    const el = e.target.closest?.('.card');
    if (!el || !finePointer || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    const st = cardOf(el);
    st.rx.to((0.5 - py) * 6);
    st.ry.to((px - 0.5) * 7);
    el.style.setProperty('--sx', `${px * 100}%`);
    el.style.setProperty('--sy', `${py * 100}%`);
  });
  document.addEventListener('pointerout', e => {
    const el = e.target.closest?.('.card');
    if (!el || el.contains(e.relatedTarget)) return;
    const st = cardOf(el);
    st.lift.to(0);
    st.rx.to(0);
    st.ry.to(0);
    st.press.to(1);
  });
  // Pressed in on pointer-down, the instant it happens.
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest?.('.card');
    if (el) cardOf(el).press.to(0.975, { response: 0.15 });
  });
  const release = e => {
    const el = e.target.closest?.('.card');
    if (el) cardOf(el).press.to(1, { response: 0.3 });
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);

  // ---------- Filter chips: one springing selection pill ----------

  const filters = document.getElementById('filters');
  if (filters) {
    let pill = null, x, y, w, h, placed = false;
    const draw = () => { if (pill) { pill.style.transform = `translate(${x.value}px, ${y.value}px)`; pill.style.width = `${w.value}px`; pill.style.height = `${h.value}px`; } };
    x = spring(0, draw, { damping: 0.9, response: 0.38 });
    y = spring(0, draw, { damping: 0.9, response: 0.38 });
    w = spring(0, draw, { damping: 1, response: 0.38 });
    h = spring(0, draw, { damping: 1, response: 0.38 });
    const place = () => {
      const chip = filters.querySelector('.chip[aria-pressed="true"]');
      if (!chip) return;
      if (!pill || !pill.isConnected) {
        // hub.js redraws the chips, so the pill is rebuilt where it was and carries on from there.
        pill = document.createElement('span');
        pill.className = 'chip-pill';
        pill.setAttribute('aria-hidden', 'true');
        filters.prepend(pill);
        draw();
      }
      const fr = filters.getBoundingClientRect(), cr = chip.getBoundingClientRect();
      const tx = cr.left - fr.left, ty = cr.top - fr.top;
      if (!placed) { x.set(tx); y.set(ty); w.set(cr.width); h.set(cr.height); placed = true; return; }
      x.to(tx); y.to(ty); w.to(cr.width); h.to(cr.height);
    };
    new MutationObserver(place).observe(filters, { childList: true });
    new ResizeObserver(() => { placed = false; place(); }).observe(filters);
    place();
  }

  // ---------- Grid: cards glide to their new places when the filter changes ----------

  const grid = document.getElementById('games');
  if (grid) {
    let before = null;
    // Captured before hub.js redraws, so the move starts from where each card was on screen.
    filters?.addEventListener('click', () => {
      before = new Map([...grid.children].map(c => [c.getAttribute('href'), c.getBoundingClientRect()]));
    }, true);
    new MutationObserver(() => {
      if (!before || reduced()) { before = null; return; }
      const prev = before;
      before = null;
      requestAnimationFrame(() => {
        let i = 0;
        for (const el of grid.children) {
          const r = el.getBoundingClientRect(), old = prev.get(el.getAttribute('href'));
          if (r.top > innerHeight + 200) continue;
          if (old) {
            const dx = old.left - r.left, dy = old.top - r.top;
            if (!dx && !dy) continue;
            const v = { x: dx, y: dy };
            const apply = () => { el.style.translate = `${v.x}px ${v.y}px`; };
            spring(dx, n => { v.x = n; apply(); if (n === 0 && v.y === 0) el.style.translate = ''; }, { damping: 1, response: 0.45, eps: 0.3 }).to(0);
            spring(dy, n => { v.y = n; apply(); if (n === 0 && v.x === 0) el.style.translate = ''; }, { damping: 1, response: 0.45, eps: 0.3 }).to(0);
            apply();
          } else {
            // New arrivals rise into place, slightly staggered by reading order.
            const delay = Math.min(i++, 12) * 18;
            el.style.opacity = '0';
            el.style.translate = '0 14px';
            setTimeout(() => {
              const v = { o: 0, y: 14 };
              spring(0, n => { v.o = n; el.style.opacity = String(Math.min(1, n)); if (n >= 1) el.style.opacity = ''; }, { response: 0.35, eps: 0.005 }).to(1);
              spring(14, n => { v.y = n; el.style.translate = n ? `0 ${n}px` : ''; }, { response: 0.4, eps: 0.2 }).to(0);
            }, delay);
          }
        }
      });
    }).observe(grid, { childList: true });
  }

  // ---------- Header: scroll edge effect only once content is under it ----------

  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', scrollY > 4);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Chat sheet: drag to dismiss ----------

  function wireSheet(panel) {
    const grip = panel.querySelector('header');
    const close = panel.parentElement.querySelector('.chat-close');
    if (!grip || !close) return;
    const down = panel.parentElement.classList.contains('in-bar') ? -1 : 1; // which way "away" is
    const ty = spring(0, v => { panel.style.translate = v ? `0 ${v}px` : ''; panel.style.opacity = String(Math.max(0.2, 1 - Math.abs(v) / 500)); if (!v) panel.style.opacity = ''; }, { damping: 1, response: 0.35, eps: 0.3 });
    const track = tracker();
    let start = null, grab = 0, moved = false;
    grip.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      grip.setPointerCapture(e.pointerId);
      // Grab it wherever it is, even mid-animation.
      start = e.clientY;
      grab = ty.value * down;
      moved = false;
      track.reset();
      track.add(e.clientX, e.clientY);
      ty.set(ty.value);
      panel.classList.add('dragging');
    });
    grip.addEventListener('pointermove', e => {
      if (start === null) return;
      track.add(e.clientX, e.clientY);
      let d = grab + (e.clientY - start) * down;
      if (Math.abs(e.clientY - start) > 6) moved = true;
      if (d < 0) d = rubberband(d, panel.offsetHeight); // pulling the wrong way resists
      ty.set(d * down);
    });
    const end = () => {
      if (start === null) return;
      start = null;
      panel.classList.remove('dragging');
      if (!moved) return;
      const v = track.velocity().y * down;
      const rest = ty.value * down + project(v);
      if (rest > panel.offsetHeight * 0.35) {
        // Flicked away: carry the finger's speed out, then close and reset for next time.
        ty.to(panel.offsetHeight * 1.1 * down, { velocity: v * down, response: 0.3 });
        setTimeout(() => { close.click(); ty.set(0); }, 220);
      } else ty.to(0, { velocity: v * down, damping: 0.85 });
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }
  const panel = document.querySelector('.chat-panel');
  if (panel) wireSheet(panel);

  return { spring, project, rubberband, tracker };
})();
