/* Marble Path: get the marble into the cup. Place the ramps and bumpers from your tray, then
   let it roll (Space) and watch. Ramps turn in 15-degree steps (Q/E or the scroll wheel);
   bumpers kick the marble away hard. Miss, and your pieces stay put so you can adjust them.
   Using fewer pieces scores more. After three misses on a level, a hint shows one piece. */
(() => {
  const ID = 'marble-path';
  const W = 960, H = 540, TAU = Math.PI * 2, FIELD = 800;
  const SAVE = 'marble:best';
  const S = window.MarbleSim;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const R = Gfx.rand;
  const fx = Gfx.particles(400), floats = Gfx.floaters();
  const LEVELS = window.MARBLE_LEVELS;

  let best = Arcade.load(SAVE, {});
  let L = null, li = 0, placed = [], holding = null, mouse = { x: 0, y: 0 }, state = 'menu', marble = null, world = null, trail = [], acc = 0, misses = 0, time = 0, hint = false;
  const total = () => Object.values(best).reduce((t, b) => t + b.pts, 0);
  const nextUp = () => { for (let i = 0; i < LEVELS.length; i++) if (!best[i]) return i; return LEVELS.length - 1; };
  const left = type => L.inv[type] - placed.filter(p => p.type === type).length - (holding?.type === type && !holding.from ? 1 : 0);

  function load(n) {
    li = n; L = LEVELS[n];
    placed = []; holding = null; marble = null; trail = []; misses = 0; hint = false;
    state = 'edit';
    ui.hide();
    updateHud();
  }

  // ---------- Placing ----------

  const validSpot = p => p.x > 20 && p.x < FIELD - 20 && p.y > 50 && p.y < H - 20 && Math.hypot(p.x - L.start[0], p.y - L.start[1]) > 50 && Math.hypot(p.x - L.cup[0], p.y - L.cup[1]) > 45;
  function pickAt(x, y) {
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i];
      if (p.type === 'bumper' && Math.hypot(p.x - x, p.y - y) < S.BUMP + 6) return i;
      if (p.type === 'ramp') {
        const dx = Math.cos(p.a), dy = Math.sin(p.a), t = (x - p.x) * dx + (y - p.y) * dy, n = Math.abs(-(x - p.x) * dy + (y - p.y) * dx);
        if (Math.abs(t) < S.RAMP / 2 + 6 && n < 12) return i;
      }
    }
    return -1;
  }
  function rotate(d) {
    const target = holding || (hover >= 0 ? placed[hover] : null);
    if (!target || target.type !== 'ramp') return;
    target.a = Math.round((target.a + d * Math.PI / 12) / (Math.PI / 12)) * (Math.PI / 12);
    Arcade.tone({ freq: 500, dur: 0.03, type: 'sine', vol: 0.02 });
  }
  let hover = -1;

  // ---------- Running ----------

  function play() {
    if (state !== 'edit') return;
    if (holding) { if (holding.from) placed.push(holding); holding = null; }
    world = S.world(L, placed.map(p => ({ ...p })));
    marble = S.start(L);
    trail = []; acc = 0;
    state = 'run';
    Arcade.tone({ freq: 300, to: 500, dur: 0.12, type: 'triangle', vol: 0.04 });
  }
  function stopRun() { state = 'edit'; marble = null; trail = []; }

  function updateRun(dt) {
    acc += dt;
    let n = 0;
    while (acc >= S.STEP && state === 'run' && n++ < 40) {
      acc -= S.STEP;
      const hitsBefore = marble.hits.length;
      const res = S.step(marble, world, L);
      for (const h of marble.hits.slice(hitsBefore)) {
        if (h.kind === 'bump') { h.b.flash = 0.25; Arcade.tone({ freq: 600, to: 900, dur: 0.08, type: 'square', vol: 0.03 }); fx.burst(6, () => ({ x: marble.x, y: marble.y, vx: R(-120, 120), vy: R(-120, 120), life: 0.3, size: 2, color: '#ff7ae0', shape: 'spark' })); }
        else Arcade.tone({ freq: 140 + Math.min(200, h.v / 4), dur: 0.04, type: 'sine', vol: 0.02 });
      }
      if (res === 'win') return win();
      if (res === 'lost') return lose();
    }
    trail.push([marble.x, marble.y]);
    if (trail.length > 40) trail.shift();
  }

  function lose() {
    state = 'miss';
    misses++;
    fx.burst(14, () => ({ x: clampX(marble.x), y: Math.min(H - 10, marble.y), vx: R(-80, 80), vy: R(-120, -20), life: 0.5, size: 3, color: '#c0c8d8' }));
    Arcade.tone({ freq: 300, to: 120, dur: 0.3, type: 'sine', vol: 0.04 });
    if (misses >= 3 && !hint) { hint = true; floats.add('Hint: a ghost piece shows one way', FIELD / 2, 80, { color: '#7ef0ff', size: 16, life: 2.5 }); }
    setTimeout(() => { if (state === 'miss') stopRun(); }, 700);
  }
  const clampX = x => Math.max(10, Math.min(FIELD - 10, x));

  function win() {
    state = 'won';
    const used = placed.length, inv = L.inv.ramp + L.inv.bumper;
    const stars = used <= L.par ? 3 : used <= L.par + 1 ? 2 : 1;
    const pts = 300 + (inv - used) * 150 + (stars === 3 ? 200 : 0);
    const prev = best[li];
    if (!prev || pts > prev.pts) { best[li] = { pts, stars: Math.max(stars, prev?.stars || 0) }; Arcade.save(SAVE, best); }
    updateHud();
    fx.burst(40, () => { const a = R(0, TAU), v = R(80, 260); return { x: L.cup[0], y: L.cup[1] - 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 0, life: R(0.6, 1.1), size: R(2, 5), color: ['#ffd23f', '#7ef0ff', '#ff7ae0', '#9be37a'][Math.floor(R(0, 4))], shape: 'square', spin: R(-10, 10), drag: 1 }; });
    [523, 659, 784, 1047].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.05, delay: i * 0.07 }));
    Arcade.flag('marble-path-first');
    if (stars === 3) Arcade.flag('marble-path-perfect');
    if (used < L.par) Arcade.flag('marble-path-clever');
    if (Object.keys(best).length >= LEVELS.length) Arcade.flag('marble-path-all');
    setTimeout(() => {
      Arcade.finish(ui, {
        score: total(),
        title: `${L.name}: in the cup! ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`,
        lines: [`${used} piece${used === 1 ? '' : 's'} used (par ${L.par})${used < L.par ? ' · beat the par!' : ''}`, 'Your score is the total of your best on every level.'],
        button: li + 1 < LEVELS.length ? 'Next level' : 'Level select',
        onAction: () => (li + 1 < LEVELS.length ? load(li + 1) : showMenu()),
      });
      const panel = overlayEl.querySelector('.panel');
      if (panel) {
        panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-retry>Try with fewer pieces</button><button class="btn secondary" type="button" data-menu>Levels</button></div>');
        panel.querySelector('[data-retry]').addEventListener('click', () => { state = 'edit'; marble = null; ui.hide(); });
        panel.querySelector('[data-menu]').addEventListener('click', showMenu);
      }
    }, 900);
  }

  // ---------- Input ----------

  const toCanvas = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  canvas.addEventListener('pointermove', e => {
    mouse = toCanvas(e);
    if (holding) { holding.x = Math.round(mouse.x / 10) * 10; holding.y = Math.round(mouse.y / 10) * 10; }
    hover = state === 'edit' && !holding ? pickAt(mouse.x, mouse.y) : -1;
  });
  canvas.addEventListener('pointerdown', e => {
    mouse = toCanvas(e);
    if (e.button === 2) { rotate(1); return; }
    const btn = trayHit(mouse.x, mouse.y);
    if (btn) return btn();
    if (state === 'run' || state === 'miss') { stopRun(); return; }
    if (state !== 'edit') return;
    if (holding) {
      if (mouse.x > FIELD) return;
      if (!validSpot(holding)) { floats.add("Can't go there", holding.x, holding.y - 20, { color: '#ff8a80', size: 13 }); return; }
      placed.push({ type: holding.type, x: holding.x, y: holding.y, a: holding.a });
      holding = null;
      Arcade.tone({ freq: 400, to: 300, dur: 0.06, type: 'square', vol: 0.03 });
      return;
    }
    const i = pickAt(mouse.x, mouse.y);
    if (i >= 0) { holding = { ...placed[i], from: true }; placed.splice(i, 1); }
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { if (state === 'edit') { e.preventDefault(); rotate(e.deltaY > 0 ? 1 : -1); } }, { passive: false });
  addEventListener('keydown', e => {
    if (state === 'menu' || !overlayEl.hidden) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); state === 'edit' ? play() : (state === 'run' || state === 'miss') && stopRun(); }
    if (e.code === 'KeyQ') rotate(-1);
    if (e.code === 'KeyE') rotate(1);
    if (e.code === 'KeyR') { if (state !== 'edit') stopRun(); }
    if (e.code === 'Escape' || e.code === 'Backspace' || e.code === 'Delete') { if (holding) { if (!holding.from || e.code !== 'Escape') holding = null; else { placed.push(holding); holding = null; } } else if (e.code === 'Escape') showMenu(); }
  });

  // ---------- Tray (right side) ----------

  let trayBtns = [];
  function trayHit(x, y) { const b = trayBtns.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h && b.on); return b ? b.fn : null; }
  function drawTray() {
    trayBtns = [];
    ctx.fillStyle = '#1b2030'; ctx.fillRect(FIELD, 0, W - FIELD, H);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(FIELD, 0, 2, H);
    Gfx.text(ctx, `${li + 1}. ${L.name}`, FIELD + 80, 24, { size: 13, stroke: null });
    Gfx.text(ctx, `Par ${L.par} · ${best[li] ? '★'.repeat(best[li].stars) : 'not solved'}`, FIELD + 80, 44, { size: 11, stroke: null, color: '#ffd23f' });
    const items = [['ramp', 'Ramp'], ['bumper', 'Bumper']];
    items.forEach(([type, label], k) => {
      const y = 70 + k * 96, n = left(type), on = state === 'edit' && n > 0 && !holding;
      Gfx.card(ctx, FIELD + 14, y, 132, 84, { fill: on ? 'rgba(40,52,76,0.95)' : 'rgba(30,36,52,0.8)' });
      if (type === 'ramp') drawRamp({ x: FIELD + 80, y: y + 34, a: -0.3 }, 0.7, n > 0 ? 1 : 0.35);
      else drawBumper({ x: FIELD + 80, y: y + 34 }, n > 0 ? 1 : 0.35);
      Gfx.text(ctx, `${label} ×${n}`, FIELD + 80, y + 70, { size: 12, stroke: null, color: n > 0 ? '#fff' : '#6b7280' });
      trayBtns.push({ x: FIELD + 14, y, w: 132, h: 84, on, fn: () => { holding = { type, x: mouse.x, y: mouse.y, a: 0 }; } });
    });
    const btn = (y, label, color, on, fn) => { Gfx.card(ctx, FIELD + 14, y, 132, 36, { fill: on ? color : 'rgba(30,36,52,0.8)' }); Gfx.text(ctx, label, FIELD + 80, y + 18, { size: 13, stroke: null, color: on ? '#111' : '#6b7280' }); trayBtns.push({ x: FIELD + 14, y, w: 132, h: 36, on, fn }); };
    btn(270, state === 'edit' ? '▶ Let it roll (Space)' : '■ Stop (Space)', state === 'edit' ? '#ffd23f' : '#ff8a80', state === 'edit' || state === 'run' || state === 'miss', () => (state === 'edit' ? play() : stopRun()));
    btn(314, 'Clear pieces', '#cfd8dc', state === 'edit' && placed.length > 0, () => { placed = []; holding = null; });
    btn(358, 'Levels', '#cfd8dc', true, showMenu);
    const tips = holding ? ['Click to place', holding.type === 'ramp' ? 'Q / E or scroll: turn' : '', 'Esc: put it back'] : ['Click a piece to pick it up', 'Click a placed piece to move it', 'Del while holding: remove'];
    tips.filter(Boolean).forEach((t, i) => Gfx.text(ctx, t, FIELD + 80, 418 + i * 18, { size: 10, stroke: null, color: '#9aa3b5' }));
    if (misses) Gfx.text(ctx, `Misses: ${misses}`, FIELD + 80, 500, { size: 11, stroke: null, color: '#ff8a80' });
  }

  // ---------- Drawing ----------

  const board = Gfx.sprite(FIELD, H, 0, 0, g => {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1f4a6e'); bg.addColorStop(1, '#173852');
    g.fillStyle = bg; g.fillRect(0, 0, FIELD, H);
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
    for (let x = 0; x <= FIELD; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(FIELD, y); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    for (let x = 0; x <= FIELD; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(FIELD, y); g.stroke(); }
  });

  function drawWall(w) {
    const [x1, y1, x2, y2] = w;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(x1 + 2, y1 + 3); ctx.lineTo(x2 + 2, y2 + 3); ctx.stroke();
    ctx.strokeStyle = '#9aa6bd'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = '#d6deec'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, y1 - 2); ctx.lineTo(x2, y2 - 2); ctx.stroke();
  }
  function drawRamp(p, scale = 1, alpha = 1, ghost = false) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(scale, scale);
    const L2 = S.RAMP / 2;
    ctx.fillStyle = ghost ? 'rgba(126,240,255,0.3)' : '#5a3d22'; Gfx.roundRect(ctx, -L2, -3, S.RAMP, 9, 3); ctx.fill();
    ctx.fillStyle = ghost ? 'rgba(126,240,255,0.5)' : '#c98b46'; Gfx.roundRect(ctx, -L2, -5, S.RAMP, 8, 3); ctx.fill();
    if (!ghost) { ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(-L2 + 4, -4, S.RAMP - 8, 2); ctx.fillStyle = '#6b4a2b'; for (const x of [-L2 + 8, L2 - 8]) { ctx.beginPath(); ctx.arc(x, -1, 2, 0, TAU); ctx.fill(); } }
    ctx.restore();
  }
  function drawBumper(p, alpha = 1, ghost = false) {
    const fl = p.flash || 0;
    ctx.save(); ctx.globalAlpha = alpha;
    if (!ghost) Gfx.shadow(ctx, p.x + 2, p.y + 6, S.BUMP, S.BUMP * 0.5, 0.3);
    const g = ctx.createRadialGradient(p.x - 5, p.y - 6, 2, p.x, p.y, S.BUMP);
    g.addColorStop(0, ghost ? 'rgba(126,240,255,0.6)' : fl > 0 ? '#fff' : '#ff9ad5'); g.addColorStop(1, ghost ? 'rgba(126,240,255,0.25)' : '#c2187a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, S.BUMP + fl * 8, 0, TAU); ctx.fill();
    ctx.strokeStyle = ghost ? 'rgba(126,240,255,0.7)' : '#ffd1ec'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  function draw() {
    if (!L) { ctx.fillStyle = '#173852'; ctx.fillRect(0, 0, W, H); return; }
    board.draw(ctx, 0, 0);
    // The chute and the cup.
    const [sx, sy] = L.start;
    ctx.fillStyle = '#3a4560'; Gfx.roundRect(ctx, sx - 16, 0, 32, sy + 4, 6); ctx.fill();
    ctx.fillStyle = '#25304a'; ctx.fillRect(sx - 10, 0, 20, sy);
    const [cx, cy] = L.cup;
    ctx.fillStyle = 'rgba(255,210,63,0.15)'; ctx.fillRect(cx - 26, cy - 34, 52, 46);
    for (const w of [[cx - 30, cy - 34, cx - 26, cy + 12], [cx - 26, cy + 12, cx + 26, cy + 12], [cx + 26, cy + 12, cx + 30, cy - 34]]) drawWall(w);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + 30, cy - 34); ctx.lineTo(cx + 30, cy - 74); ctx.stroke();
    ctx.fillStyle = '#ff5a5f'; ctx.beginPath(); ctx.moveTo(cx + 30, cy - 74); ctx.lineTo(cx + 52, cy - 66 + Math.sin(time * 4) * 2); ctx.lineTo(cx + 30, cy - 58); ctx.fill();
    for (const w of L.walls) drawWall(w);
    for (const b of (world?.bumps || []).filter(b => !b.placed)) drawBumper(b);
    if (!world || state === 'edit') for (const b of (L.bumpers || [])) drawBumper({ x: b[0], y: b[1] });
    // Hint ghost.
    if (hint && state === 'edit') {
      const h = L.hint[0];
      if (h.type === 'ramp') drawRamp({ x: h.x, y: h.y, a: h.a * Math.PI / 12 }, 1, 0.9, true);
      else drawBumper({ x: h.x, y: h.y }, 0.9, true);
    }
    placed.forEach((p, i) => {
      if (p.type === 'ramp') drawRamp(p); else drawBumper(world && state !== 'edit' ? world.bumps.find(b => b.placed && b.x === p.x && b.y === p.y) || p : p);
      if (i === hover) { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.type === 'ramp' ? S.RAMP / 2 + 6 : S.BUMP + 6, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    });
    if (holding && mouse.x < FIELD) {
      const ok = validSpot(holding);
      if (holding.type === 'ramp') drawRamp(holding, 1, ok ? 0.85 : 0.4); else drawBumper(holding, ok ? 0.85 : 0.4);
    }
    // The marble, with a trail.
    if (marble) {
      trail.forEach(([x, y], i) => { ctx.fillStyle = `rgba(220,230,255,${i / trail.length * 0.3})`; ctx.beginPath(); ctx.arc(x, y, S.MR * i / trail.length, 0, TAU); ctx.fill(); });
      const g = ctx.createRadialGradient(marble.x - 3, marble.y - 4, 1, marble.x, marble.y, S.MR);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#c8d4ea'); g.addColorStop(1, '#5a6a88');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(marble.x, marble.y, S.MR, 0, TAU); ctx.fill();
    } else if (state === 'edit') {
      ctx.fillStyle = 'rgba(200,212,234,0.8)'; ctx.beginPath(); ctx.arc(sx, sy, S.MR, 0, TAU); ctx.fill();
    }
    fx.draw(ctx);
    floats.draw(ctx);
    drawTray();
  }

  function updateHud() {
    $('level').textContent = L ? li + 1 : '-';
    $('stars').textContent = Object.values(best).reduce((t, b) => t + b.stars, 0);
    $('total').textContent = total().toLocaleString();
  }

  function showMenu() {
    state = 'menu';
    if (!L) L = LEVELS[nextUp()];
    ui.show({
      title: '🔮 Marble Path',
      html: `<p>Get the marble into the cup. Place the <b>ramps</b> and <b>bumpers</b> from your tray, then let it roll and watch what happens.</p>
        <p style="font-size:13px;color:var(--muted)">Click a piece, then click to place it. <b>Q</b>/<b>E</b> or the scroll wheel turn ramps. <b>Space</b> lets the marble go. Fewer pieces score more.</p>
        <div class="row" style="flex-wrap:wrap;gap:6px;justify-content:center">${LEVELS.map((l, i) => { const b = best[i], open = i <= Object.keys(best).length + 1; return `<button class="btn ${b ? 'secondary' : ''}" type="button" data-l="${i}" ${open ? '' : 'disabled'} style="min-width:60px;flex-direction:column;line-height:1.2"><b>${open ? i + 1 : '🔒'}</b><small style="font-size:10px;color:#ffd23f">${b ? '★'.repeat(b.stars) : ''}</small></button>`; }).join('')}</div>
        <p style="font-size:12px;color:var(--muted)">${total().toLocaleString()} points</p>`,
      button: `Play level ${nextUp() + 1}`,
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
    if (state === 'run' && overlayEl.hidden) updateRun(dt);
    for (const b of world?.bumps || []) if (b.flash) b.flash = Math.max(0, b.flash - dt);
    fx.update(dt); floats.update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  L = LEVELS[nextUp()];
  showMenu();
  requestAnimationFrame(frame);
})();
