/* Crate Crew: push every crate onto a glowing pad. You can only push (never pull), one crate
   at a time, so a crate shoved into a corner is stuck for good: undo (Z) and think again.
   32 levels; finishing in the fewest possible pushes earns three stars. The score is the total
   of your best result on every level. */
(() => {
  const ID = 'crate-crew';
  const W = 960, H = 540;
  const SAVE = 'crates:best';     // { level: { pushes, moves, stars, pts } }
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const R = Gfx.rand;
  const fx = Gfx.particles(400), floats = Gfx.floaters();
  const LEVELS = window.CRATE_LEVELS.map(([par, ...rows]) => ({ par, rows }));
  const DIRS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };

  let best = Arcade.load(SAVE, {});
  let L = null, li = 0, walls, pads, crates, you, moves, pushes, history, state = 'menu', face = [1, 0], anim = 0, cell = 48, ox = 0, oy = 0, time = 0, wonT = 0;

  const total = () => Object.values(best).reduce((t, b) => t + (b.pts || 0), 0);
  const starsFor = (lv, p) => (p <= lv.par ? 3 : p <= lv.par * 1.3 + 2 ? 2 : 1);
  const unlocked = () => Math.min(LEVELS.length, Object.keys(best).length + 3);
  // The first level you haven't cleared yet.
  const nextUp = () => { for (let i = 0; i < LEVELS.length; i++) if (!best[i]) return i; return LEVELS.length - 1; };

  function load(n) {
    li = n;
    L = LEVELS[n];
    walls = new Set(); pads = new Set(); crates = [];
    L.rows.forEach((row, y) => [...row].forEach((c, x) => {
      const k = x + ',' + y;
      if (c === '#') walls.add(k);
      if ('.*+'.includes(c)) pads.add(k);
      if ('$*'.includes(c)) crates.push({ x, y, px: x, py: y, onPad: false, pop: 0 });
      if ('@+'.includes(c)) you = { x, y, px: x, py: y };
    }));
    const gw = Math.max(...L.rows.map(r => r.length)), gh = L.rows.length;
    cell = Math.min(64, Math.floor(Math.min((W - 80) / gw, (H - 120) / gh)));
    ox = Math.round((W - gw * cell) / 2); oy = Math.round((H - gh * cell) / 2 + 18);
    moves = 0; pushes = 0; history = []; face = [1, 0]; wonT = 0;
    for (const c of crates) c.onPad = pads.has(c.x + ',' + c.y);
    computeInside();
    state = 'play';
    ui.hide();
    updateHud();
  }

  const crateAt = (x, y) => crates.find(c => c.x === x && c.y === y);
  const blocked = (x, y) => walls.has(x + ',' + y) || !!crateAt(x, y);

  function step(dx, dy) {
    if (state !== 'play') return;
    face = [dx, dy];
    const nx = you.x + dx, ny = you.y + dy;
    if (walls.has(nx + ',' + ny)) return bump();
    const c = crateAt(nx, ny);
    if (c) {
      if (blocked(nx + dx, ny + dy)) return bump();
      history.push(snapshot());
      c.px = c.x; c.py = c.y;
      c.x += dx; c.y += dy;
      const was = c.onPad;
      c.onPad = pads.has(c.x + ',' + c.y);
      pushes++;
      if (c.onPad && !was) {
        c.pop = 1;
        sparkle(c.x, c.y, '#7ef0b0');
        Arcade.tone({ freq: 660, to: 990, dur: 0.12, type: 'triangle', vol: 0.05 });
      } else Arcade.tone({ freq: 150, to: 110, dur: 0.07, type: 'square', vol: 0.03 });
    } else {
      history.push(snapshot());
      Arcade.tone({ freq: 420, dur: 0.025, type: 'sine', vol: 0.015 });
    }
    you.px = you.x; you.py = you.y;
    you.x = nx; you.y = ny;
    moves++;
    anim = 1;
    updateHud();
    if (crates.every(c => c.onPad)) win();
  }
  function bump() { Arcade.tone({ freq: 90, dur: 0.05, type: 'square', vol: 0.02 }); }

  const snapshot = () => ({ you: { x: you.x, y: you.y }, crates: crates.map(c => ({ x: c.x, y: c.y })), moves, pushes });
  function undo() {
    if (state !== 'play' || !history.length) return;
    const s = history.pop();
    you.x = you.px = s.you.x; you.y = you.py = s.you.y;
    crates.forEach((c, i) => { c.x = c.px = s.crates[i].x; c.y = c.py = s.crates[i].y; c.onPad = pads.has(c.x + ',' + c.y); });
    moves = s.moves; pushes = s.pushes;
    anim = 0;
    Arcade.tone({ freq: 300, to: 220, dur: 0.05, type: 'sine', vol: 0.03 });
    updateHud();
  }

  function sparkle(x, y, color) {
    const cx = ox + (x + 0.5) * cell, cy = oy + (y + 0.5) * cell;
    fx.burst(14, () => { const a = R(0, 6.28), v = R(40, 160); return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.4, 0.8), size: R(2, 4), color, drag: 2.5, shape: R() < 0.5 ? 'square' : 'spark' }; });
  }

  function win() {
    state = 'won';
    wonT = 0;
    const stars = starsFor(L, pushes);
    const boxes = crates.length;
    const pts = 100 + boxes * 50 + (stars === 3 ? 150 : stars === 2 ? 60 : 0);
    const prev = best[li];
    const better = !prev || pts > prev.pts || (pts === prev.pts && pushes < prev.pushes);
    if (better) { best[li] = { pushes: Math.min(pushes, prev?.pushes ?? Infinity), moves, stars: Math.max(stars, prev?.stars || 0), pts: Math.max(pts, prev?.pts || 0) }; Arcade.save(SAVE, best); }
    for (const c of crates) sparkle(c.x, c.y, '#ffd23f');
    [523, 659, 784, 1047].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.05, delay: i * 0.07 }));
    Arcade.flag('crate-crew-first');
    if (stars === 3) Arcade.flag('crate-crew-perfect');
    if (Object.keys(best).length >= 16) Arcade.flag('crate-crew-sixteen');
    if (Object.keys(best).length >= LEVELS.length) Arcade.flag('crate-crew-all');
    setTimeout(() => {
      Arcade.finish(ui, {
        score: total(),
        title: `Level ${li + 1} cleared! ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`,
        lines: [`${pushes} pushes (fewest possible: ${L.par}) · ${moves} moves`, 'Your score is the total of your best on every level.'],
        button: li + 1 < LEVELS.length ? 'Next level' : 'Level select',
        onAction: () => (li + 1 < LEVELS.length ? load(li + 1) : showMenu()),
      });
      const panel = overlayEl.querySelector('.panel');
      if (panel) {
        panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-retry>Try for fewer pushes</button><button class="btn secondary" type="button" data-menu>Level select</button></div>');
        panel.querySelector('[data-retry]').addEventListener('click', () => load(li));
        panel.querySelector('[data-menu]').addEventListener('click', showMenu);
      }
    }, 700);
  }

  // ---------- Input ----------

  addEventListener('keydown', e => {
    if (state !== 'play') return;
    const d = DIRS[e.code];
    if (d) { e.preventDefault(); if (anim < 0.35) step(d[0], d[1]); else queued = d; }
    if (e.code === 'KeyZ' || e.code === 'KeyU' || e.code === 'Backspace') { e.preventDefault(); undo(); }
    if (e.code === 'KeyR') load(li);
    if (e.code === 'Escape' || e.code === 'KeyM') showMenu();
  });
  let queued = null;
  Arcade.onSwipe(canvas, dir => { const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir]; if (d && state === 'play') step(d[0], d[1]); });
  // Clickable undo / restart / levels buttons along the top.
  const BTNS = [{ id: 'undo', label: '↶ Undo (Z)', x: 16 }, { id: 'reset', label: '⟲ Restart (R)', x: 140 }, { id: 'menu', label: '▦ Levels (M)', x: 276 }];
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'play') return;
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    if (y > 46) return;
    const b = BTNS.find(b => x >= b.x && x <= b.x + 116);
    if (b?.id === 'undo') undo(); else if (b?.id === 'reset') load(li); else if (b?.id === 'menu') showMenu();
  });

  // ---------- Drawing ----------

  const floorTile = Gfx.sprite(64, 64, 0, 0, g => {
    g.fillStyle = '#c9b89a'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 31, 64, 2); g.fillRect(31, 0, 2, 64);
    const r = Gfx.rng(4); for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(90,60,30,${r() * 0.08})`; g.fillRect(r() * 64, r() * 64, 2, 2); }
  });

  function drawWall(x, y) {
    const px = ox + x * cell, py = oy + y * cell, s = cell;
    ctx.fillStyle = '#4a4f63'; ctx.fillRect(px, py + s * 0.14, s, s * 0.86);
    ctx.fillStyle = '#6b7189'; ctx.fillRect(px, py, s, s * 0.82);
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, s, s * 0.82); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    const bh = s * 0.82 / 3;
    for (let r = 0; r < 3; r++) for (let c = -1; c < 2; c++) { const off = r % 2 ? s / 4 : 0; ctx.fillRect(px + c * s / 2 + off + 1, py + r * bh + 1, s / 2 - 3, bh - 3); }
    ctx.restore();
  }

  function drawCrate(c, k) {
    const x = c.px + (c.x - c.px) * k, y = c.py + (c.y - c.py) * k;
    const px = ox + x * cell, py = oy + y * cell, s = cell, pad = s * 0.08, pop = c.pop;
    ctx.save();
    ctx.translate(px + s / 2, py + s / 2);
    const sc = 1 + Math.sin(pop * Math.PI) * 0.12;
    ctx.scale(sc, sc);
    ctx.translate(-s / 2, -s / 2);
    Gfx.shadow(ctx, s / 2 + 3, s - pad + 2, s * 0.42, s * 0.12, 0.3);
    const top = c.onPad ? '#e8b04a' : '#c98b46', side = c.onPad ? '#b07a22' : '#8f5c2a';
    ctx.fillStyle = side; Gfx.roundRect(ctx, pad, pad + s * 0.1, s - pad * 2, s - pad * 2 - s * 0.04, 5); ctx.fill();
    ctx.fillStyle = top; Gfx.roundRect(ctx, pad, pad, s - pad * 2, s - pad * 2 - s * 0.1, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(70,40,15,0.55)'; ctx.lineWidth = Math.max(2, s * 0.05);
    const a = pad + s * 0.1, b = s - pad - s * 0.1, bb = s - pad - s * 0.2;
    ctx.strokeRect(a, a, b - a, bb - a);
    ctx.beginPath(); ctx.moveTo(a, a); ctx.lineTo(b, bb); ctx.moveTo(b, a); ctx.lineTo(a, bb); ctx.stroke();
    if (c.onPad) { ctx.fillStyle = 'rgba(126,240,176,0.9)'; ctx.beginPath(); ctx.arc(s / 2, s * 0.44, s * 0.1, 0, 6.28); ctx.fill(); }
    ctx.restore();
  }

  function drawYou(k) {
    const x = you.px + (you.x - you.px) * k, y = you.py + (you.y - you.py) * k;
    const px = ox + (x + 0.5) * cell, py = oy + (y + 0.5) * cell, s = cell;
    const hop = Math.sin((1 - anim) * Math.PI) * s * 0.06 * (anim > 0 ? 1 : 0);
    Gfx.shadow(ctx, px + 2, py + s * 0.36, s * 0.28, s * 0.09, 0.3);
    ctx.save();
    ctx.translate(px, py - hop);
    // A little hard-hat worker seen from above-front.
    ctx.fillStyle = '#2f6fd6'; Gfx.roundRect(ctx, -s * 0.24, -s * 0.05, s * 0.48, s * 0.38, s * 0.1); ctx.fill();
    ctx.fillStyle = '#ffcf9e'; ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.2, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, -s * 0.18, s * 0.21, Math.PI, 0); ctx.fill();
    ctx.fillRect(-s * 0.25, -s * 0.19, s * 0.5, s * 0.05);
    ctx.fillStyle = '#1b1b2a';
    const ex = face[0] * s * 0.05, ey = face[1] * s * 0.03;
    ctx.beginPath(); ctx.arc(-s * 0.07 + ex, -s * 0.09 + ey, s * 0.03, 0, 6.28); ctx.arc(s * 0.07 + ex, -s * 0.09 + ey, s * 0.03, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  function draw(dt) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2a2f45'); bg.addColorStop(1, '#1b1f2e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!L) return;
    const k = 1 - Math.pow(anim, 2);
    // Floor inside the walls (flood from the player), then pads, walls, crates, you.
    L.rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '#' && inside.has(x + ',' + y)) floorTile.draw(ctx, ox + x * cell, oy + y * cell, cell / 64); }));
    for (const p of pads) {
      const [x, y] = p.split(',').map(Number), cx = ox + (x + 0.5) * cell, cy = oy + (y + 0.5) * cell;
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, cell * 0.45);
      g.addColorStop(0, `rgba(126,240,176,${0.55 + Math.sin(time * 3) * 0.12})`); g.addColorStop(1, 'rgba(126,240,176,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
      ctx.strokeStyle = 'rgba(60,160,110,0.9)'; ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]); ctx.strokeRect(cx - cell * 0.3, cy - cell * 0.3, cell * 0.6, cell * 0.6); ctx.setLineDash([]);
    }
    for (const w of walls) { const [x, y] = w.split(',').map(Number); drawWall(x, y); }
    // Draw back to front so things overlap nicely.
    const items = [...crates.map(c => ({ y: c.py + (c.y - c.py) * k, c })), { y: you.py + (you.y - you.py) * k, you: true }].sort((a, b) => a.y - b.y);
    for (const it of items) it.you ? drawYou(k) : drawCrate(it.c, k);
    fx.draw(ctx);
    floats.draw(ctx);
    // Top bar.
    for (const b of BTNS) { Gfx.card(ctx, b.x, 10, 116, 28, { r: 8 }); Gfx.text(ctx, b.label, b.x + 58, 24, { size: 12, stroke: null }); }
    const st = best[li];
    Gfx.text(ctx, `Level ${li + 1} / ${LEVELS.length}`, W - 16, 18, { size: 16, align: 'right' });
    Gfx.text(ctx, `Pushes ${pushes} · fewest ${L.par}${st ? ` · best ${'★'.repeat(st.stars)}` : ''}`, W - 16, 38, { size: 12, align: 'right', color: '#cfd8dc', stroke: null });
    const on = crates.filter(c => c.onPad).length;
    Gfx.text(ctx, `${on} / ${crates.length} crates on pads`, W / 2, H - 16, { size: 14, color: on === crates.length ? '#7ef0b0' : '#e0e6f0' });
  }
  // Which floor cells are inside the walls (reachable from the player), for drawing.
  let inside = new Set();
  function computeInside() {
    inside = new Set([you.x + ',' + you.y]);
    const st = [[you.x, you.y]];
    while (st.length) {
      const [x, y] = st.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (x + dx) + ',' + (y + dy);
        if (inside.has(k) || walls.has(k) || y + dy < 0 || x + dx < 0 || y + dy >= L.rows.length || x + dx >= 40) continue;
        inside.add(k); st.push([x + dx, y + dy]);
      }
    }
  }

  function updateHud() {
    $('level').textContent = L ? li + 1 : '-';
    $('pushes').textContent = L ? pushes : 0;
    $('total').textContent = total().toLocaleString();
  }

  // ---------- Level select ----------

  function showMenu() {
    state = 'menu';
    const done = Object.keys(best).length, stars = Object.values(best).reduce((t, b) => t + b.stars, 0);
    ui.show({
      title: '📦 Crate Crew',
      html: `<p>Push every crate onto a glowing pad. You can't pull, so think before you shove one into a corner. <b>Z</b> undoes, <b>R</b> restarts.</p>
        <p style="font-size:13px;color:var(--muted)">${done} of ${LEVELS.length} cleared · ${stars} of ${LEVELS.length * 3} stars · ${total().toLocaleString()} points. Three stars for the fewest possible pushes.</p>
        <div class="cc-grid">${LEVELS.map((l, i) => { const b = best[i], open = i < unlocked(); return `<button class="btn ${b ? 'secondary' : ''}" type="button" data-l="${i}" ${open ? '' : 'disabled'}><b>${open ? i + 1 : '🔒'}</b><small>${b ? '★'.repeat(b.stars) + '☆'.repeat(3 - b.stars) : open ? 'new' : ''}</small></button>`; }).join('')}</div>`,
      button: done < LEVELS.length ? `Play level ${nextUp() + 1}` : null,
      onAction: () => load(nextUp()),
      onRender: p => p.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => load(+b.dataset.l))),
    });
    updateHud();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    anim = Math.max(0, anim - dt * 9);
    if (anim < 0.35 && queued && state === 'play') { const q = queued; queued = null; step(q[0], q[1]); }
    for (const c of crates) c.pop = Math.max(0, c.pop - dt * 3);
    fx.update(dt); floats.update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  load(nextUp());
  showMenu();
  requestAnimationFrame(frame);
})();
