/* Merge Moons: drop space rocks into a glass jar. Two of the same size touching merge into the
   next one up, from a speck of dust all the way to a star (two stars collide in a supernova and
   clear out). Rocks tumble and roll with real physics. If the pile stays over the red line, the
   jar is full and the run ends. */
(() => {
  const ID = 'merge-moons';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const JAR_L = 318, JAR_R = 642, FLOOR = 512, LINE = 128, DROP_Y = 84;
  const G = 1500, SUBSTEPS = 6;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R = Gfx.rand;
  const fx = Gfx.particles(700), floats = Gfx.floaters(), shake = Gfx.shaker();

  // The eleven sizes. pts: what a merge into this one scores.
  const TIERS = [
    { name: 'Dust', r: 13, c: ['#c9b8a6', '#7d6b5a'] },
    { name: 'Pebble', r: 18, c: ['#d9d2c5', '#8a8378'] },
    { name: 'Rock', r: 24, c: ['#b08968', '#6b4f3a'] },
    { name: 'Comet', r: 31, c: ['#a8e6ff', '#3a8fb7'] },
    { name: 'Moonlet', r: 38, c: ['#e8e8ee', '#8d8d9c'] },
    { name: 'Moon', r: 46, c: ['#fff6d6', '#b8a878'] },
    { name: 'Red World', r: 55, c: ['#ff8a65', '#b23c1e'] },
    { name: 'Ocean World', r: 65, c: ['#64b5f6', '#1e4f9c'] },
    { name: 'Jungle World', r: 76, c: ['#81c784', '#2e6b33'] },
    { name: 'Gas Giant', r: 88, c: ['#ffcc80', '#c26a1a'] },
    { name: 'Star', r: 101, c: ['#fff59d', '#ff9800'] },
  ];
  TIERS.forEach((t, i) => { t.pts = (i + 1) * (i + 2) / 2 * 4; });
  const DROPPABLE = 5;

  let bodies = [], state = 'menu', score = 0, aimX = W / 2, next = 0, after = 0, dropT = 0, overT = 0, biggest = 0, dropRng = Math.random, time = 0, chain = 0, chainT = 0, idN = 0;

  // ---------- Physics ----------

  function addBody(tier, x, y, vx = 0, vy = 0) {
    const b = { id: ++idN, tier, x, y, vx, vy, r: TIERS[tier].r, spin: R(-1, 1), a: R(0, TAU), born: time, squash: 0, dropped: true };
    bodies.push(b);
    return b;
  }

  function step(dt) {
    for (const b of bodies) {
      b.vy += G * dt;
      b.vx *= 1 - 0.4 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // Walls and floor.
      if (b.x - b.r < JAR_L) { b.x = JAR_L + b.r; b.vx = Math.abs(b.vx) * 0.3; }
      if (b.x + b.r > JAR_R) { b.x = JAR_R - b.r; b.vx = -Math.abs(b.vx) * 0.3; }
      if (b.y + b.r > FLOOR) {
        b.y = FLOOR - b.r;
        if (b.vy > 220) b.squash = Math.min(0.25, b.vy / 3000);
        b.vy = -b.vy * 0.15;
        b.vx *= 1 - 3 * dt;
        b.a += b.vx / b.r * dt;
      }
    }
    // Pairs: merge equals, push the rest apart.
    const merges = [];
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy);
        if (d >= min || d === 0) continue;
        if (a.tier === b.tier && !a.dead && !b.dead) { a.dead = b.dead = true; merges.push([a, b]); continue; }
        const nx = dx / d, ny = dy / d, over = min - d;
        const ma = a.r * a.r, mb = b.r * b.r, ta = mb / (ma + mb), tb = ma / (ma + mb);
        a.x -= nx * over * ta; a.y -= ny * over * ta;
        b.x += nx * over * tb; b.y += ny * over * tb;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const j = -(1.12) * rv;
          a.vx -= nx * j * ta; a.vy -= ny * j * ta;
          b.vx += nx * j * tb; b.vy += ny * j * tb;
          // Rolling: rub off some sideways speed into spin.
          const tx = -ny, ty = nx, rt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
          a.vx += tx * rt * 0.05; a.vy += ty * rt * 0.05; b.vx -= tx * rt * 0.05; b.vy -= ty * rt * 0.05;
        }
      }
    }
    if (merges.length) {
      bodies = bodies.filter(b => !b.dead);
      for (const [a, b] of merges) merge(a, b);
    }
    for (const b of bodies) b.a += b.vx / b.r * dt * 0.5;
  }

  function merge(a, b) {
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, t = a.tier;
    chain = chainT > 0 ? chain + 1 : 1;
    chainT = 0.9;
    const mult = Math.min(chain, 6);
    if (t === TIERS.length - 1) {
      // Two stars: a supernova that blows the nearby rocks around.
      const pts = 1000 * mult;
      score += pts;
      floats.add(`SUPERNOVA +${pts}`, x, y - 40, { color: '#fff59d', size: 26, life: 1.6 });
      burst(x, y, '#fff59d', 80, 420);
      shake.add(0.9);
      for (const o of bodies) { const dx = o.x - x, dy = o.y - y, d = Math.hypot(dx, dy) || 1; if (d < 260) { o.vx += dx / d * 900 * (1 - d / 260); o.vy += dy / d * 900 * (1 - d / 260) - 300; } }
      Arcade.flag('merge-moons-supernova');
      [523, 659, 784, 1047, 1319].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.25, type: 'triangle', vol: 0.05, delay: i * 0.07 }));
      updateHud();
      return;
    }
    const nt = t + 1, nb = addBody(nt, x, y, (a.vx + b.vx) / 2, Math.min(0, (a.vy + b.vy) / 2) - 60);
    nb.squash = -0.25;
    nb.dropped = true;
    const pts = TIERS[nt].pts * mult;
    score += pts;
    floats.add(`+${pts}${mult > 1 ? ` ×${mult}` : ''}`, x, y - TIERS[nt].r - 6, { color: mult > 1 ? '#ffd23f' : '#fff', size: 15 + Math.min(10, nt * 1.2) });
    burst(x, y, TIERS[nt].c[0], 10 + nt * 3, 120 + nt * 25);
    shake.add(0.04 + nt * 0.025);
    if (nt > biggest) {
      biggest = nt;
      if (nt >= 5) floats.add(`First ${TIERS[nt].name}!`, W / 2, 150, { color: TIERS[nt].c[0], size: 22, life: 1.6 });
    }
    if (nt >= 7) Arcade.flag('merge-moons-ocean');
    if (nt === TIERS.length - 1) Arcade.flag('merge-moons-star');
    if (chain >= 4) Arcade.flag('merge-moons-chain');
    Arcade.tone({ freq: 300 + nt * 60, to: 500 + nt * 90, dur: 0.12, type: 'triangle', vol: 0.05 });
    updateHud();
  }

  function burst(x, y, color, n, sp) {
    fx.burst(n, () => { const a = R(0, TAU), v = R(sp * 0.3, sp); return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.4, 0.9), size: R(2, 5), color, drag: 2.5, shape: R() < 0.5 ? 'circle' : 'spark' }; });
  }

  // ---------- Flow ----------

  // The queue of drops comes from its own seeded generator, so an online duel deals both
  // players the same rocks.
  const roll = () => Math.min(DROPPABLE - 1, Math.floor(dropRng() * dropRng() * DROPPABLE * 1.35));
  function start() {
    dropRng = Gfx.rng(Math.floor(Math.random() * 2 ** 31));
    bodies = []; fx.clear();
    score = 0; biggest = 0; dropT = 0; overT = 0; time = 0; chain = 0;
    next = roll(); after = roll();
    state = 'play';
    ui.hide();
    updateHud();
  }

  function drop() {
    if (state !== 'play' || dropT > 0) return;
    const r = TIERS[next].r;
    addBody(next, clamp(aimX, JAR_L + r, JAR_R - r), DROP_Y, 0, 60).dropped = false;
    next = after;
    after = roll();
    dropT = 0.45;
    Arcade.tone({ freq: 220, to: 160, dur: 0.08, type: 'sine', vol: 0.04 });
  }

  function update(dt) {
    time += dt;
    dropT = Math.max(0, dropT - dt);
    chainT = Math.max(0, chainT - dt);
    if (keys.has('ArrowLeft') || keys.has('KeyA')) aimX -= 420 * dt;
    if (keys.has('ArrowRight') || keys.has('KeyD')) aimX += 420 * dt;
    aimX = clamp(aimX, JAR_L + TIERS[next].r, JAR_R - TIERS[next].r);
    const h = dt / SUBSTEPS;
    for (let k = 0; k < SUBSTEPS; k++) step(h);
    for (const b of bodies) { b.squash *= Math.exp(-10 * dt); if (!b.dropped && b.y > LINE + b.r + 4) b.dropped = true; }
    // Over the line: a rock that has settled with its top above it.
    const over = bodies.some(b => b.dropped && b.y - b.r < LINE && Math.abs(b.vy) < 60 && time - b.born > 1);
    overT = over ? overT + dt : Math.max(0, overT - dt * 2);
    if (overT > 2.2) gameOver();
    fx.update(dt);
    floats.update(dt);
    shake.update(dt);
  }

  function gameOver() {
    if (state !== 'play') return;
    state = 'over';
    shake.add(0.6);
    Arcade.tone({ freq: 300, to: 80, dur: 0.7, type: 'sawtooth', vol: 0.05 });
    Arcade.finish(ui, {
      score,
      title: 'The jar is full!',
      lines: [`Biggest: ${TIERS[biggest].name}`],
      button: 'Play again',
      onAction: start,
    });
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('biggest').textContent = state === 'menu' ? '-' : TIERS[biggest].name;
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  // ---------- Input ----------

  const keys = new Set();
  addEventListener('keydown', e => {
    keys.add(e.code);
    if (state !== 'play') return;
    if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); drop(); }
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  const toX = e => { const r = canvas.getBoundingClientRect(); return (e.clientX - r.left) * W / r.width; };
  canvas.addEventListener('pointermove', e => { aimX = toX(e); });
  canvas.addEventListener('pointerdown', e => { aimX = toX(e); if (e.pointerType !== 'mouse') return; drop(); });
  canvas.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') drop(); });
  function pause() {
    if (state !== 'play' || (typeof Versus !== 'undefined' && Versus.active())) return;
    state = 'paused';
    ui.show({ title: 'Paused', html: `<p>${score.toLocaleString()} points</p>`, button: 'Resume', onAction: () => { state = 'play'; ui.hide(); } });
  }
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  const backdrop = Gfx.sprite(W, H, 0, 0, g => {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b0f2a'); bg.addColorStop(1, '#241640');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const r = Gfx.rng(3);
    for (let i = 0; i < 220; i++) { g.globalAlpha = 0.3 + r() * 0.7; g.fillStyle = '#fff'; const s = r() < 0.9 ? 1 : 2; g.fillRect(r() * W, r() * H, s, s); }
    g.globalAlpha = 1;
    for (const [x, y, rad, c] of [[120, 120, 160, 'rgba(176,124,255,0.12)'], [860, 420, 200, 'rgba(79,140,255,0.12)']]) {
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });

  // Each size is painted once into a sprite (with a little face), then drawn rotated.
  const sprites = TIERS.map((t, i) => Gfx.sprite(t.r * 2 + 8, t.r * 2 + 8, t.r + 4, t.r + 4, g => {
    const c = t.r + 4, r = t.r;
    if (i === TIERS.length - 1) {
      const glow = g.createRadialGradient(c, c, r * 0.6, c, c, r + 4);
      glow.addColorStop(0, 'rgba(255,200,60,0.6)'); glow.addColorStop(1, 'rgba(255,200,60,0)');
      g.fillStyle = glow; g.beginPath(); g.arc(c, c, r + 4, 0, TAU); g.fill();
    }
    const gr = g.createRadialGradient(c - r * 0.35, c - r * 0.35, r * 0.1, c, c, r);
    gr.addColorStop(0, Gfx.shade(t.c[0], 0.25)); gr.addColorStop(0.6, t.c[0]); gr.addColorStop(1, t.c[1]);
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
    const rr = Gfx.rng(i * 17 + 5);
    // Craters, bands or continents depending on the kind.
    if (i <= 5) { for (let k = 0; k < 3 + i; k++) { const a = rr() * TAU, d = rr() * r * 0.6, cr = r * (0.08 + rr() * 0.14); g.fillStyle = 'rgba(0,0,0,0.13)'; g.beginPath(); g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, cr, 0, TAU); g.fill(); } }
    else if (i === 9) { g.save(); g.beginPath(); g.arc(c, c, r, 0, TAU); g.clip(); for (let k = -4; k <= 4; k++) { g.fillStyle = k % 2 ? 'rgba(120,50,10,0.18)' : 'rgba(255,255,255,0.1)'; g.fillRect(c - r, c + k * r * 0.22, r * 2, r * 0.12); } g.restore(); }
    else if (i === 7 || i === 8) { g.save(); g.beginPath(); g.arc(c, c, r, 0, TAU); g.clip(); g.fillStyle = i === 7 ? 'rgba(129,199,132,0.75)' : 'rgba(40,90,40,0.5)'; for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(c + (rr() - 0.5) * r * 1.4, c + (rr() - 0.5) * r * 1.4, r * (0.2 + rr() * 0.25), r * (0.12 + rr() * 0.18), rr() * 3, 0, TAU); g.fill(); } g.restore(); }
    // Shine.
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.ellipse(c - r * 0.35, c - r * 0.42, r * 0.28, r * 0.16, -0.6, 0, TAU); g.fill();
    // Face.
    const ey = c - r * 0.05, ex = r * 0.3, es = Math.max(2, r * 0.1);
    g.fillStyle = '#1b1530';
    g.beginPath(); g.arc(c - ex, ey, es, 0, TAU); g.arc(c + ex, ey, es, 0, TAU); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(c - ex + es * 0.35, ey - es * 0.35, es * 0.35, 0, TAU); g.arc(c + ex + es * 0.35, ey - es * 0.35, es * 0.35, 0, TAU); g.fill();
    g.strokeStyle = '#1b1530'; g.lineWidth = Math.max(1.2, r * 0.05); g.lineCap = 'round';
    g.beginPath(); g.arc(c, ey + es * 1.2, r * 0.14, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = 'rgba(255,120,150,0.35)';
    g.beginPath(); g.arc(c - ex * 1.5, ey + es * 1.6, es * 0.9, 0, TAU); g.arc(c + ex * 1.5, ey + es * 1.6, es * 0.9, 0, TAU); g.fill();
  }));

  function drawBody(b) {
    const t = TIERS[b.tier], sq = b.squash;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(1 + sq, 1 - sq);
    ctx.rotate(b.a);
    sprites[b.tier].draw(ctx, 0, 0);
    ctx.restore();
    if (b.tier === 9) { // rings drawn upright over the giant
      ctx.strokeStyle = 'rgba(255,230,180,0.55)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(b.x, b.y, t.r * 1.25, t.r * 0.28, -0.25, 0, TAU); ctx.stroke();
    }
  }

  function draw(dt) {
    const off = shake.offset(8);
    ctx.save();
    ctx.translate(off.x, off.y);
    backdrop.draw(ctx, 0, 0);
    // The jar.
    ctx.fillStyle = 'rgba(150,180,255,0.06)';
    Gfx.roundRect(ctx, JAR_L - 8, LINE - 30, JAR_R - JAR_L + 16, FLOOR - LINE + 38, 18); ctx.fill();
    // Danger line, brighter as the pile nears it.
    const warn = clamp(overT / 2.2, 0, 1);
    ctx.strokeStyle = `rgba(255,${90 - warn * 60},${90 - warn * 60},${0.35 + warn * 0.6 + (warn > 0 ? Math.sin(time * 18) * 0.2 : 0)})`;
    ctx.setLineDash([10, 8]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(JAR_L, LINE); ctx.lineTo(JAR_R, LINE); ctx.stroke();
    ctx.setLineDash([]);
    // Aim guide and the rock waiting to drop.
    if (state === 'play' || state === 'paused') {
      const r = TIERS[next].r, x = clamp(aimX, JAR_L + r, JAR_R - r);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, DROP_Y + r); ctx.lineTo(x, FLOOR); ctx.stroke();
      ctx.globalAlpha = dropT > 0 ? 0.4 : 1;
      sprites[next].draw(ctx, x, DROP_Y);
      ctx.globalAlpha = 1;
    }
    for (const b of bodies) drawBody(b);
    // Glass walls.
    const glass = ctx.createLinearGradient(JAR_L - 12, 0, JAR_L + 4, 0);
    glass.addColorStop(0, 'rgba(200,220,255,0.5)'); glass.addColorStop(1, 'rgba(200,220,255,0.05)');
    ctx.fillStyle = glass; ctx.fillRect(JAR_L - 12, LINE - 30, 14, FLOOR - LINE + 42);
    ctx.save(); ctx.translate(JAR_L + JAR_R, 0); ctx.scale(-1, 1); ctx.fillStyle = glass; ctx.fillRect(JAR_L - 12, LINE - 30, 14, FLOOR - LINE + 42); ctx.restore();
    ctx.fillStyle = 'rgba(200,220,255,0.4)'; Gfx.roundRect(ctx, JAR_L - 12, FLOOR, JAR_R - JAR_L + 24, 12, 6); ctx.fill();
    fx.draw(ctx);
    floats.draw(ctx);
    ctx.restore();
    // Side panels: next up, and the ladder of sizes.
    Gfx.card(ctx, 700, 70, 120, 120);
    Gfx.text(ctx, 'Next', 760, 88, { size: 13, color: '#cfd8dc', stroke: null });
    const ns = Math.min(1, 40 / TIERS[after].r);
    sprites[after].draw(ctx, 760, 140, ns);
    Gfx.card(ctx, 700, 205, 230, 300);
    Gfx.text(ctx, 'Merge ladder', 815, 222, { size: 13, color: '#cfd8dc', stroke: null });
    TIERS.forEach((t, i) => {
      const y = 246 + i * 24.5, s = Math.min(1, 10 / t.r);
      ctx.globalAlpha = i <= biggest || state === 'menu' ? 1 : 0.35;
      sprites[i].draw(ctx, 722, y, s);
      Gfx.text(ctx, t.name, 740, y, { size: 12, align: 'left', stroke: null, color: i === biggest && state !== 'menu' ? '#ffd23f' : '#e0e6f0' });
      Gfx.text(ctx, `+${t.pts}`, 918, y, { size: 11, align: 'right', stroke: null, color: '#8d94a1' });
      ctx.globalAlpha = 1;
    });
    Gfx.text(ctx, score.toLocaleString(), 160, 90, { size: 40 });
    Gfx.text(ctx, 'points', 160, 122, { size: 13, color: '#9aa3b5', stroke: null });
    if (chain > 1 && chainT > 0) Gfx.text(ctx, `Chain ×${Math.min(chain, 6)}`, 160, 160, { size: 20, color: '#ffd23f' });
    if (overT > 0.3 && state === 'play') Gfx.text(ctx, 'Too full!', W / 2, LINE - 40, { size: 20, color: '#ff6b6b' });
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'play' && (overlayEl.hidden || (typeof Versus !== 'undefined' && Versus.active()))) update(dt);
    else { fx.update(dt); floats.update(dt); shake.update(dt); }
    draw(dt);
    requestAnimationFrame(frame);
  }

  updateHud();
  Versus.attach({
    ui, start, score: () => score,
    intro: {
      title: '🪐 Merge Moons',
      html: `<p>Drop space rocks into the jar. Two of the same size merge into the next size up, from <b>Dust</b> all the way to a <b>Star</b>.</p>
        <p>Quick merges in a row chain up to ×6. Keep the pile under the red line, or the jar's full!</p>`,
      button: 'Play',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
