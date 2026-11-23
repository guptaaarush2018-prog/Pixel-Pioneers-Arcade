/* Outpost Rush: capture every outpost on the map. Your outposts train troops over time; send
   half of them (or all, with Shift) marching to another outpost. They reinforce your own, or
   fight whoever holds it, and take it if they outnumber the defenders. Squads that meet on the
   road fight too. Twelve levels against one to three rival armies. */
(() => {
  const ID = 'outpost-rush';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const MARCH = 64;           // px per second
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R = Gfx.rand;
  const fx = Gfx.particles(600), floats = Gfx.floaters(), shake = Gfx.shaker();
  const SAVE = 'outpost:level';

  const SIDES = [
    { name: 'You', color: '#4f8cff', dark: '#2a4f9c' },
    { name: 'Red Banner', color: '#ff5a5f', dark: '#9c2a2e' },
    { name: 'Gold Claw', color: '#ffb02e', dark: '#9c6510' },
    { name: 'Green Fang', color: '#3ccf8e', dark: '#1e7a51' },
  ];
  const NEUTRAL = { color: '#9aa3b5', dark: '#5c6475' };
  const KINDS = [
    { name: 'Camp', r: 20, rate: 0.55, cap: 40 },
    { name: 'Fort', r: 27, rate: 0.85, cap: 70 },
    { name: 'Castle', r: 35, rate: 1.25, cap: 110 },
  ];
  // Levels: rival armies, how sharp they are, and how many outposts.
  const LEVELS = Array.from({ length: 12 }, (_, i) => ({
    n: i + 1, rivals: i < 3 ? 1 : i < 7 ? 2 : 3, think: Math.max(0.7, 2.4 - i * 0.15), greed: 0.45 + i * 0.04, posts: 10 + Math.min(8, Math.floor(i * 0.8)), seed: 1000 + i * 77,
  }));

  let posts = [], squads = [], state = 'menu', level = 0, time = 0, sel = new Set(), drag = null, hover = null, sendAll = false, bots = [];
  let unlocked = Arcade.load(SAVE, 1);

  // ---------- Map ----------

  function makeMap(lv) {
    const rng = Gfx.rng(lv.seed);
    posts = [];
    // Home bases first, in opposite corners-ish, then the rest spread out.
    const homes = [[110, 410], [850, 130], [850, 410], [110, 130]].slice(0, lv.rivals + 1);
    homes.forEach(([x, y], s) => posts.push({ x, y, kind: KINDS[2], owner: s, troops: 30, t: 0, pulse: 0 }));
    for (let k = 0; posts.length < lv.posts && k < 2000; k++) {
      const kind = KINDS[rng() < 0.5 ? 0 : rng() < 0.75 ? 1 : 2];
      const x = 60 + rng() * (W - 120), y = 70 + rng() * (H - 120);
      if (posts.some(p => Math.hypot(p.x - x, p.y - y) < p.kind.r + kind.r + 60)) continue;
      posts.push({ x, y, kind, owner: -1, troops: Math.round(6 + rng() * (8 + kind.r * 0.6)), t: 0, pulse: 0 });
    }
  }

  // ---------- Sending ----------

  function send(from, to, all) {
    if (from === to || from.troops < 2) return;
    const n = Math.floor(all ? from.troops - 1 : from.troops / 2);
    if (n < 1) return;
    from.troops -= n;
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    squads.push({ owner: from.owner, n, from, to, x: from.x, y: from.y, d, t: from.kind.r / d, wob: R(0, TAU) });
    if (from.owner === 0) Arcade.tone({ freq: 330, to: 440, dur: 0.08, type: 'triangle', vol: 0.03 });
  }

  function arrive(q) {
    const p = q.to;
    if (p.owner === q.owner) p.troops += q.n;
    else {
      p.troops -= q.n;
      p.pulse = 0.4;
      fx.burst(6, () => ({ x: p.x + R(-p.kind.r, p.kind.r), y: p.y + R(-p.kind.r, p.kind.r), vx: R(-50, 50), vy: R(-60, -10), life: 0.4, size: 2, color: '#ffe9a8', shape: 'spark' }));
      if (p.troops < 0) {
        const was = p.owner;
        p.owner = q.owner;
        p.troops = -p.troops;
        captured(p, was);
      }
    }
  }

  function captured(p, was) {
    const c = side(p.owner).color;
    fx.burst(30, () => { const a = R(0, TAU), v = R(40, 160); return { x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.5, 1), size: R(2, 4), color: c, drag: 2, shape: 'square' }; });
    if (p.owner === 0) {
      floats.add(`${p.kind.name} taken!`, p.x, p.y - p.kind.r - 14, { color: '#9fc4ff', size: 15 });
      Arcade.tone({ freq: 520, to: 1040, dur: 0.18, type: 'triangle', vol: 0.05 });
      shake.add(0.12);
    } else if (was === 0) {
      floats.add('Lost!', p.x, p.y - p.kind.r - 14, { color: '#ff8a80', size: 15 });
      Arcade.tone({ freq: 300, to: 150, dur: 0.25, type: 'square', vol: 0.04 });
      shake.add(0.2);
    }
  }
  const side = o => (o < 0 ? NEUTRAL : SIDES[o]);

  // ---------- Rival armies ----------

  function botThink(b) {
    const mine = posts.filter(p => p.owner === b.side);
    if (!mine.length) return;
    const lv = LEVELS[level];
    // Incoming threats against each of our outposts.
    const threat = new Map();
    for (const q of squads) if (q.to.owner === b.side && q.owner !== b.side) threat.set(q.to, (threat.get(q.to) || 0) + q.n);
    // Reinforce anything about to fall.
    for (const [p, n] of threat) {
      if (n < p.troops) continue;
      const helper = mine.filter(m => m !== p && m.troops > 8).sort((a, c) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(c.x - p.x, c.y - p.y))[0];
      if (helper) { send(helper, p, false); return; }
    }
    // Attack: the best value target we can afford, weighing distance and how big it is.
    let best = null, bs = -Infinity;
    for (const src of mine) {
      if (src.troops < 10) continue;
      const avail = Math.floor(src.troops / 2) - (threat.get(src) || 0);
      for (const t of posts) {
        if (t.owner === b.side) continue;
        const d = Math.hypot(t.x - src.x, t.y - src.y);
        const grow = t.owner >= 0 ? t.kind.rate * d / MARCH : 0;
        const need = t.troops + grow + 2;
        const enRoute = squads.filter(q => q.owner === b.side && q.to === t).reduce((s, q) => s + q.n, 0);
        if (avail + enRoute < need) continue;
        const sc = (t.kind.rate * 30 + (t.owner === 0 ? 8 * lv.greed : 0) - t.troops) / (d + 80) - (t.owner < 0 ? 0 : 0.02);
        if (sc > bs) { bs = sc; best = [src, t]; }
      }
    }
    if (best && Math.random() < 0.6 + lv.greed * 0.5) send(best[0], best[1], best[0].troops > 60);
  }

  // ---------- Flow ----------

  function startLevel(n) {
    level = clamp(n, 0, LEVELS.length - 1);
    const lv = LEVELS[level];
    makeMap(lv);
    squads = []; sel.clear(); drag = null; fx.clear();
    bots = Array.from({ length: lv.rivals }, (_, i) => ({ side: i + 1, t: 1.5 + i * 0.4 }));
    time = 0;
    state = 'play';
    ui.hide();
    updateHud();
  }

  function update(dt) {
    time += dt;
    for (const p of posts) {
      p.pulse = Math.max(0, p.pulse - dt);
      if (p.owner < 0) continue;
      if (p.troops < p.kind.cap) {
        p.t += dt * p.kind.rate;
        while (p.t >= 1) { p.t -= 1; p.troops++; }
      } else if (p.troops > p.kind.cap + 0.5) p.troops -= dt * 0.5 * (p.troops - p.kind.cap);
    }
    // Squads march; opposing squads that meet fight it out.
    for (const q of squads) {
      q.t += MARCH * dt / q.d;
      q.x = q.from.x + (q.to.x - q.from.x) * q.t;
      q.y = q.from.y + (q.to.y - q.from.y) * q.t;
    }
    for (let i = 0; i < squads.length; i++) for (let j = i + 1; j < squads.length; j++) {
      const a = squads[i], b = squads[j];
      if (a.owner === b.owner || a.n <= 0 || b.n <= 0) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 14) continue;
      const k = Math.min(a.n, b.n);
      a.n -= k; b.n -= k;
      fx.burst(8, () => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vx: R(-80, 80), vy: R(-80, 80), life: 0.35, size: 2, color: '#fff3b0', shape: 'spark' }));
    }
    for (const q of squads) if (q.n > 0 && q.t >= 1 - q.to.kind.r / q.d) { arrive(q); q.n = 0; }
    squads = squads.filter(q => q.n > 0);
    for (const b of bots) { b.t -= dt; if (b.t <= 0) { b.t = LEVELS[level].think * R(0.7, 1.3); botThink(b); } }
    for (const id of [...sel]) if (posts[id]?.owner !== 0) sel.delete(id);
    // Win or lose.
    const alive = s => posts.some(p => p.owner === s) || squads.some(q => q.owner === s);
    if (!alive(0)) return end(false);
    if (bots.every(b => !alive(b.side))) return end(true);
    fx.update(dt);
    floats.update(dt);
    shake.update(dt);
    updateHud();
  }

  function end(won) {
    if (state !== 'play') return;
    state = 'over';
    if (!won) {
      Arcade.countPlay();
      ui.show({
        title: 'Overrun!', html: `<p>Level ${level + 1} · held out ${Math.floor(time)} s</p><div class="menu"><button class="btn secondary" type="button" data-menu>Levels</button></div>`,
        button: 'Try again', onAction: () => startLevel(level), onRender: p => p.querySelector('[data-menu]').addEventListener('click', showMenu),
      });
      return;
    }
    const troops = posts.filter(p => p.owner === 0).reduce((s, p) => s + p.troops, 0);
    const timeBonus = Math.max(0, Math.round((240 - time) * 5));
    const score = 400 + (level + 1) * 250 + timeBonus + Math.round(troops);
    if (level + 2 > unlocked) { unlocked = Math.min(LEVELS.length, level + 2); Arcade.save(SAVE, unlocked); }
    Arcade.flag('outpost-rush-win');
    if (level + 1 >= 6) Arcade.flag('outpost-rush-six');
    if (level + 1 >= 12) Arcade.flag('outpost-rush-all');
    if (time < 90) Arcade.flag('outpost-rush-blitz');
    [523, 659, 784, 1047].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.15, type: 'triangle', vol: 0.05, delay: i * 0.08 }));
    Arcade.finish(ui, {
      score,
      title: `Level ${level + 1} conquered!`,
      lines: [`${Math.floor(time)} s · ${Math.round(troops)} troops left · time bonus ${timeBonus}`],
      button: level + 1 < LEVELS.length ? 'Next level' : 'Play again',
      onAction: () => startLevel(level + 1 < LEVELS.length ? level + 1 : level),
    });
    const panel = overlayEl.querySelector('.panel');
    if (panel && !(typeof Versus !== 'undefined' && Versus.active())) {
      panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-menu>Levels</button></div>');
      panel.querySelector('[data-menu]').addEventListener('click', showMenu);
    }
  }

  // ---------- Input ----------

  const toWorld = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  const postAt = (x, y) => posts.findIndex(p => Math.hypot(p.x - x, p.y - y) < p.kind.r + 10);
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'play') return;
    const m = toWorld(e), i = postAt(m.x, m.y);
    if (i < 0) { sel.clear(); return; }
    const p = posts[i];
    if (p.owner === 0) {
      drag = { start: i, x: m.x, y: m.y, moved: false, shift: e.shiftKey };
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    } else if (sel.size) {
      for (const s of sel) send(posts[s], p, sendAll || e.shiftKey);
      sel.clear();
    }
  });
  canvas.addEventListener('pointermove', e => {
    const m = toWorld(e);
    hover = postAt(m.x, m.y);
    if (!drag) return;
    drag.x = m.x; drag.y = m.y;
    if (Math.hypot(m.x - posts[drag.start].x, m.y - posts[drag.start].y) > posts[drag.start].kind.r + 6) { drag.moved = true; sel.add(drag.start); }
    // Dragging across more of your outposts picks them up too.
    if (hover >= 0 && posts[hover].owner === 0 && drag.moved) sel.add(hover);
  });
  canvas.addEventListener('pointerup', e => {
    if (!drag) return;
    const m = toWorld(e), i = postAt(m.x, m.y);
    if (drag.moved) {
      if (i >= 0 && !(sel.has(i) && posts[i].owner === 0 && sel.size === 1)) {
        sel.delete(i);
        for (const s of sel) send(posts[s], posts[i], sendAll || e.shiftKey);
        sel.clear();
      }
    } else {
      // A click: with others picked, a click on your own outpost sends there; otherwise it toggles.
      const s0 = drag.start;
      if (sel.size && !sel.has(s0) && !drag.shift) { for (const s of sel) send(posts[s], posts[s0], sendAll || e.shiftKey); sel.clear(); }
      else if (sel.has(s0)) sel.delete(s0);
      else sel.add(s0);
    }
    drag = null;
  });
  addEventListener('keydown', e => {
    if (state !== 'play') return;
    if (e.code === 'KeyA') { e.preventDefault(); posts.forEach((p, i) => { if (p.owner === 0) sel.add(i); }); }
    if (e.code === 'KeyT') sendAll = !sendAll;
    if (e.code === 'Escape') { if (sel.size) sel.clear(); else pause(); }
    if (e.code === 'KeyP') pause();
  });
  function pause() {
    if (state !== 'play' || (typeof Versus !== 'undefined' && Versus.active())) return;
    state = 'paused';
    ui.show({
      title: 'Paused', html: `<p>Level ${level + 1}</p><div class="menu"><button class="btn secondary" type="button" data-menu>Levels</button></div>`,
      button: 'Resume', onAction: () => { state = 'play'; ui.hide(); }, onRender: p => p.querySelector('[data-menu]').addEventListener('click', showMenu),
    });
  }
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  const ground = Gfx.sprite(W, H, 0, 0, g => {
    g.fillStyle = '#5b8f45'; g.fillRect(0, 0, W, H);
    const r = Gfx.rng(9);
    for (let i = 0; i < 260; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'; g.beginPath(); g.ellipse(r() * W, r() * H, 10 + r() * 40, 6 + r() * 20, r() * 3, 0, TAU); g.fill(); }
    for (let i = 0; i < 70; i++) { const x = r() * W, y = r() * H; g.fillStyle = 'rgba(30,60,25,0.5)'; g.beginPath(); g.arc(x, y, 4 + r() * 6, 0, TAU); g.fill(); g.fillStyle = '#3f7a35'; g.beginPath(); g.arc(x - 1, y - 2, 3 + r() * 5, 0, TAU); g.fill(); }
  });

  function drawPost(p, i) {
    const s = side(p.owner), r = p.kind.r, picked = sel.has(i), pul = p.pulse;
    // Roads: faint dirt circle.
    ctx.fillStyle = 'rgba(120,90,50,0.35)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + r * 0.45, r * 1.35, r * 0.7, 0, 0, TAU); ctx.fill();
    if (picked || (hover === i && state === 'play')) {
      ctx.strokeStyle = picked ? '#ffffff' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = picked ? 3 : 2;
      ctx.setLineDash(picked ? [] : [5, 4]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 9 + Math.sin(time * 6) * (picked ? 1.5 : 0), 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    Gfx.shadow(ctx, p.x + 3, p.y + r * 0.55, r * 0.95, r * 0.4, 0.3);
    // Walls: a ring with battlements, raised.
    const shakeX = pul > 0 ? R(-1.5, 1.5) : 0;
    const x = p.x + shakeX, y = p.y;
    ctx.fillStyle = s.dark;
    ctx.beginPath(); ctx.ellipse(x, y + 5, r, r * 0.78, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.78, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = Gfx.shade(s.color, 0.25);
    const n = Math.round(r / 3.2);
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU;
      ctx.fillRect(x + Math.cos(a) * r * 0.86 - 3, y + Math.sin(a) * r * 0.67 - 4, 6, 5);
    }
    ctx.fillStyle = Gfx.shade(s.color, -0.15);
    ctx.beginPath(); ctx.ellipse(x, y - 1, r * 0.62, r * 0.48, 0, 0, TAU); ctx.fill();
    // Keep tower for forts and castles.
    if (p.kind !== KINDS[0]) {
      ctx.fillStyle = s.dark; Gfx.roundRect(ctx, x - r * 0.22, y - r * 0.6, r * 0.44, r * 0.5, 3); ctx.fill();
      ctx.fillStyle = Gfx.shade(s.color, 0.1); Gfx.roundRect(ctx, x - r * 0.26, y - r * 0.68, r * 0.52, r * 0.14, 2); ctx.fill();
    }
    // Flag.
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.5;
    const fy = y - r * (p.kind === KINDS[0] ? 0.5 : 0.95);
    ctx.beginPath(); ctx.moveTo(x, fy); ctx.lineTo(x, fy - 16); ctx.stroke();
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.moveTo(x, fy - 16); ctx.lineTo(x + 11, fy - 13 + Math.sin(time * 6 + i) * 1.5); ctx.lineTo(x, fy - 9); ctx.fill();
    Gfx.text(ctx, String(Math.floor(p.troops)), x, y + r * 0.18, { size: 13 + r * 0.22, color: '#fff' });
  }

  function drawSquad(q) {
    const s = side(q.owner), a = Math.atan2(q.to.y - q.from.y, q.to.x - q.from.x);
    const dots = Math.min(14, Math.ceil(q.n / 3));
    const px = -Math.sin(a), py = Math.cos(a);
    for (let k = 0; k < dots; k++) {
      const row = Math.floor(k / 3), col = (k % 3) - 1;
      const bob = Math.sin(time * 12 + k + q.wob) * 0.8;
      const x = q.x - Math.cos(a) * row * 6 + px * col * 5, y = q.y - Math.sin(a) * row * 6 + py * col * 5 + bob;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 3, 3, 1.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = s.dark; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, y - 1, 2.6, 0, TAU); ctx.fill();
    }
    Gfx.text(ctx, String(q.n), q.x, q.y - 11, { size: 11, color: '#fff', width: 3 });
  }

  function draw() {
    const off = shake.offset(6);
    ctx.save();
    ctx.translate(off.x, off.y);
    ground.draw(ctx, 0, 0);
    // Marching lines for squads in flight.
    ctx.lineWidth = 2;
    for (const q of squads) {
      ctx.strokeStyle = Gfx.alpha(side(q.owner).color, 0.25);
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.to.x, q.to.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Aim arrows while picking a target.
    const tgt = drag && drag.moved ? { x: drag.x, y: drag.y } : sel.size && hover >= 0 && !sel.has(hover) ? posts[hover] : null;
    if (tgt) {
      for (const sI of sel) {
        const p = posts[sI];
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(tgt.x, tgt.y, 5, 0, TAU); ctx.fill();
    }
    posts.forEach((p, i) => drawPost(p, i));
    for (const q of squads) drawSquad(q);
    fx.draw(ctx);
    floats.draw(ctx);
    ctx.restore();
    if (state === 'menu') return;
    // Strength bar along the top.
    const tot = [0, 1, 2, 3].map(s => posts.filter(p => p.owner === s).reduce((t, p) => t + p.troops, 0) + squads.filter(q => q.owner === s).reduce((t, q) => t + q.n, 0));
    const sum = tot.reduce((a, b) => a + b, 0) || 1;
    let x = 200;
    Gfx.card(ctx, 196, 8, 568, 18, { r: 9 });
    tot.forEach((t, s) => { if (!t) return; const w = t / sum * 560; ctx.fillStyle = SIDES[s].color; ctx.fillRect(x, 12, w, 10); x += w; });
    Gfx.text(ctx, `Level ${level + 1}`, 16, 18, { size: 14, align: 'left' });
    Gfx.text(ctx, `Send: ${sendAll ? 'all (T)' : 'half (T)'}`, W - 16, 18, { size: 12, align: 'right', color: sendAll ? '#ffd23f' : '#e0e6f0' });
    if (state === 'play' && time < 8) Gfx.text(ctx, 'Click your blue outpost, then click a target (or drag between them)', W / 2, H - 18, { size: 14 });
  }

  function updateHud() {
    $('level').textContent = state === 'menu' ? '-' : level + 1;
    $('posts').textContent = posts.filter(p => p.owner === 0).length;
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  function menuHtml() {
    return `<p>Capture every outpost. Yours train troops over time: click one (or several), then click a target to send <b>half</b> their troops. Hold <b>Shift</b> or press <b>T</b> to send them all.</p>
      <p style="font-size:13px;color:var(--muted)">Troops reinforce your own outposts and fight everyone else's. Squads that meet on the road fight too. Castles train fastest. <b>A</b> picks all your outposts.</p>
      <div class="row" style="flex-wrap:wrap;gap:6px;justify-content:center">${LEVELS.map((l, i) => `<button class="btn ${i + 1 === Math.min(unlocked, LEVELS.length) ? '' : 'secondary'}" type="button" data-level="${i}" ${i + 1 > unlocked ? 'disabled' : ''} style="min-width:52px">${i + 1 > unlocked ? '🔒' : i + 1}</button>`).join('')}</div>`;
  }
  const intro = () => ({ title: '🏰 Outpost Rush', html: menuHtml(), button: `Play level ${Math.min(unlocked, LEVELS.length)}`, onAction: () => startLevel(Math.min(unlocked, LEVELS.length) - 1), onRender: p => p.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => startLevel(+b.dataset.level))) });
  function showMenu() {
    state = 'menu';
    makeMap(LEVELS[Math.min(unlocked, LEVELS.length) - 1]);
    squads = [];
    ui.show(intro());
    updateHud();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += state === 'menu' ? dt : 0;
    if (state === 'play' && (overlayEl.hidden || (typeof Versus !== 'undefined' && Versus.active()))) update(dt);
    else { fx.update(dt); floats.update(dt); shake.update(dt); }
    draw();
    requestAnimationFrame(frame);
  }

  makeMap(LEVELS[Math.min(unlocked, LEVELS.length) - 1]);
  updateHud();
  // Online duel: both players race through the same level 3 map.
  Versus.attach({ ui, start: () => startLevel(2), score: () => 0, intro: intro() });
  requestAnimationFrame(frame);
})();
