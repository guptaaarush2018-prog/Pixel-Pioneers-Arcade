/* Bonk Brawl: four round brawlers on a floating arena that shrinks as the round goes on. Shove
   your rivals off the edge: a dash (Space) hits far harder than a bump, but leaves you open while
   it recharges. Last one standing wins the round; first to three rounds wins the match. Against
   three bots, or two players on one keyboard (plus two bots). */
(() => {
  const ID = 'bonk-brawl';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const CX = W / 2, CY = H / 2 + 14, R0 = 238, RMIN = 110, SHRINK = 55, ROUNDS = 3;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R = Gfx.rand;
  const fx = Gfx.particles(600), floats = Gfx.floaters(), shake = Gfx.shaker();

  const LEVELS = [
    { name: 'Easy', react: 0.45, aim: 0.5, dash: 0.6, desc: 'Clumsy bots' },
    { name: 'Normal', react: 0.25, aim: 0.25, dash: 1, desc: 'Fair fight' },
    { name: 'Hard', react: 0.1, aim: 0.1, dash: 1.4, desc: 'Ruthless bots' },
  ];
  const LOOKS = [
    { name: 'You', color: '#4fc3ff' }, { name: 'Bruiser', color: '#ff5a5f' }, { name: 'Wobble', color: '#ffb02e' }, { name: 'Zip', color: '#7ed957' },
  ];
  const POWERS = [
    { id: 'heavy', label: 'Heavy', color: '#8d94a1', t: 8 },
    { id: 'spring', label: 'Spring', color: '#ff7ae0', t: 8 },
    { id: 'shield', label: 'Shield', color: '#7ef0ff', t: 6 },
  ];

  let mode = 'bots', level = Arcade.load('bonk:level', 1), fighters = [], arenaR = R0, roundT = 0, state = 'menu', time = 0, wins = [0, 0, 0, 0], kos = 0, round = 0, banner = null, powers = [], powerT = 6, lastHit = null;

  function makeFighter(i, human) {
    const look = mode === 'two' && i === 1 ? { name: 'Player 2', color: '#ff5a5f' } : i === 0 && mode === 'two' ? { name: 'Player 1', color: '#4fc3ff' } : LOOKS[i];
    const a = -Math.PI / 2 + i * TAU / 4 + Math.PI / 4;
    return { i, name: look.name, color: look.color, human, x: CX + Math.cos(a) * 140, y: CY + Math.sin(a) * 140, vx: 0, vy: 0, r: 22, out: false, fall: 0, dashT: 0, cd: 0, face: a + Math.PI, power: null, powerT: 0, squash: 0, blink: R(0, 5), ai: human ? null : { t: 0, target: null, err: [0, 0] }, lastHit: null };
  }

  // ---------- Round flow ----------

  function startMatch(m) {
    mode = m;
    wins = [0, 0, 0, 0]; kos = 0; round = 0;
    nextRound();
  }
  function nextRound() {
    round++;
    fighters = [0, 1, 2, 3].map(i => makeFighter(i, i === 0 || (mode === 'two' && i === 1)));
    arenaR = R0; roundT = 0; powers = []; powerT = 6; fx.clear();
    state = 'countdown';
    countT = 2.2;
    banner = { text: `Round ${round}`, t: 2, color: '#fff' };
    ui.hide();
    updateHud();
  }
  let countT = 0;

  function endRound(winner) {
    state = 'roundover';
    if (winner) {
      wins[winner.i]++;
      banner = { text: `${winner.name} ${winner.i === 0 && mode !== 'two' ? 'win' : 'wins'} the round!`, t: 2.5, color: winner.color };
      if (winner.i === 0 && mode === 'bots') Arcade.tone({ freq: 523, to: 1046, dur: 0.3, type: 'triangle', vol: 0.05 });
    } else banner = { text: 'Nobody left!', t: 2.5, color: '#fff' };
    updateHud();
    const champ = [0, 1, 2, 3].find(i => wins[i] >= ROUNDS);
    setTimeout(() => (champ !== undefined ? endMatch(champ) : nextRound()), 2200);
  }

  function endMatch(champ) {
    state = 'over';
    const me = fighters[0];
    if (mode === 'two') {
      Arcade.countPlay();
      ui.show({
        title: `${fighters[champ].name} wins the match!`,
        html: `<p>${fighters.map((f, i) => `<span style="color:${f.color}">${f.name} ${wins[i]}</span>`).join(' · ')}</p><div class="menu"><button class="btn secondary" type="button" data-menu>Menu</button></div>`,
        button: 'Rematch', delay: 500, onAction: () => startMatch('two'),
        onRender: p => p.querySelector('[data-menu]').addEventListener('click', showMenu),
      });
      return;
    }
    const won = champ === 0;
    const score = Math.round((kos * 100 + wins[0] * 250 + (won ? 500 : 0)) * [0.7, 1, 1.4][level]);
    if (won) { Arcade.flag('bonk-brawl-win'); if (level === 2) Arcade.flag('bonk-brawl-hard'); if (wins.slice(1).every(w => w === 0)) Arcade.flag('bonk-brawl-sweep'); }
    Arcade.finish(ui, {
      score,
      title: won ? 'Champion! 🏆' : `${fighters[champ].name} wins the match`,
      lines: [`${wins[0]} round${wins[0] === 1 ? '' : 's'} won · ${kos} knockout${kos === 1 ? '' : 's'} · ${LEVELS[level].name} bots`],
      button: 'Play again',
      onAction: () => startMatch('bots'),
    });
    const panel = overlayEl.querySelector('.panel');
    if (panel && !(typeof Versus !== 'undefined' && Versus.active())) {
      panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-menu>Menu</button></div>');
      panel.querySelector('[data-menu]').addEventListener('click', showMenu);
    }
  }

  // ---------- Fighting ----------

  function dash(f, dx, dy) {
    if (f.cd > 0 || f.out) return;
    const m = Math.hypot(dx, dy);
    const a = m > 0.1 ? Math.atan2(dy, dx) : f.face;
    f.face = a;
    const power = 560 * (f.power === 'spring' ? 1.25 : 1);
    f.vx += Math.cos(a) * power; f.vy += Math.sin(a) * power;
    f.dashT = 0.28; f.cd = 1.1;
    f.squash = 0.3;
    fx.burst(8, () => ({ x: f.x - Math.cos(a) * 18, y: f.y - Math.sin(a) * 18, vx: -Math.cos(a) * R(40, 120) + R(-30, 30), vy: -Math.sin(a) * R(40, 120) + R(-30, 30), life: 0.35, size: R(3, 6), grow: -8, color: 'rgba(255,255,255,0.7)' }));
    if (f.human) Arcade.tone({ freq: 300, to: 600, dur: 0.1, type: 'square', vol: 0.03 });
  }

  const mass = f => (f.power === 'heavy' ? 2.2 : 1);
  function collide(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
    if (d >= min || d === 0) return;
    const nx = dx / d, ny = dy / d, over = min - d;
    const ma = mass(a), mb = mass(b);
    a.x -= nx * over * mb / (ma + mb); a.y -= ny * over * mb / (ma + mb);
    b.x += nx * over * ma / (ma + mb); b.y += ny * over * ma / (ma + mb);
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) return;
    // A dash turns a bump into a bonk.
    const boostA = a.dashT > 0 ? (a.power === 'spring' ? 2.6 : 2.1) : 1, boostB = b.dashT > 0 ? (b.power === 'spring' ? 2.6 : 2.1) : 1;
    const j = -(1 + 0.9) * rv / (1 / ma + 1 / mb);
    const shieldA = a.power === 'shield' ? 0.3 : 1, shieldB = b.power === 'shield' ? 0.3 : 1;
    a.vx -= nx * j / ma * boostB * shieldA; a.vy -= ny * j / ma * boostB * shieldA;
    b.vx += nx * j / mb * boostA * shieldB; b.vy += ny * j / mb * boostA * shieldB;
    a.lastHit = { by: b, t: time }; b.lastHit = { by: a, t: time };
    a.squash = b.squash = 0.25;
    const hard = Math.min(1, -rv / 600) * Math.max(boostA, boostB);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    fx.burst(Math.round(4 + hard * 10), () => ({ x: mx, y: my, vx: R(-160, 160), vy: R(-160, 160), life: R(0.25, 0.5), size: R(2, 4), color: '#fff3b0', shape: 'spark', drag: 3 }));
    if (hard > 0.6) { floats.add('BONK!', mx, my - 20, { color: '#ffd23f', size: 18 + hard * 6 }); shake.add(0.25 * hard); }
    Arcade.tone({ freq: 180 + hard * 120, to: 90, dur: 0.12, type: 'square', vol: 0.02 + hard * 0.03 });
  }

  function knockOut(f) {
    f.out = true; f.fall = 0;
    fx.burst(20, () => ({ x: f.x, y: f.y, vx: R(-120, 120), vy: R(-120, 120), life: R(0.4, 0.8), size: R(3, 6), color: f.color, drag: 2, shape: 'square' }));
    const by = f.lastHit && time - f.lastHit.t < 3 ? f.lastHit.by : null;
    if (by && by.i === 0 && mode === 'bots') { kos++; floats.add('Knockout! +100', f.x, f.y - 30, { color: '#ffd23f', size: 16 }); Arcade.flag('bonk-brawl-ko'); }
    if (f.i === 0 && mode === 'bots') shake.add(0.4);
    Arcade.tone({ freq: 500, to: 80, dur: 0.6, type: 'sine', vol: 0.05 });
    const alive = fighters.filter(x => !x.out);
    if (alive.length <= 1) endRound(alive[0] || null);
  }

  // ---------- Bots ----------

  function botInput(f, dt) {
    const ai = f.ai, lv = LEVELS[level];
    ai.t -= dt;
    if (ai.t <= 0) {
      ai.t = lv.react + R(0, 0.3);
      let best = null, bs = -Infinity;
      for (const o of fighters) {
        if (o === f || o.out) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y), edge = Math.hypot(o.x - CX, o.y - CY) / arenaR;
        const sc = edge * 200 - d * 0.6 + (o.human ? 40 : 0);
        if (sc > bs) { bs = sc; best = o; }
      }
      ai.target = best;
      ai.err = [R(-1, 1) * lv.aim * 60, R(-1, 1) * lv.aim * 60];
    }
    const t = ai.target;
    let mx = 0, my = 0, doDash = false;
    // Stay away from the edge first.
    const ex = f.x - CX, ey = f.y - CY, ed = Math.hypot(ex, ey);
    if (ed > arenaR - 50) { mx = -ex / ed; my = -ey / ed; }
    else if (t && !t.out) {
      // Get between the target and the middle, then charge outward through them.
      const ox = t.x - CX, oy = t.y - CY, od = Math.hypot(ox, oy) || 1;
      const sx = t.x - ox / od * 46 + ai.err[0], sy = t.y - oy / od * 46 + ai.err[1];
      const dx = sx - f.x, dy = sy - f.y, d = Math.hypot(dx, dy);
      const tx = t.x - f.x, ty = t.y - f.y, td = Math.hypot(tx, ty);
      const lined = (tx * ox + ty * oy) / (td * od) > 0.5;
      if (td < 110 && lined && Math.random() < dt * 6 * lv.dash) { doDash = true; mx = tx / td; my = ty / td; }
      else if (d > 8) { mx = dx / d; my = dy / d; }
    }
    // Grab a nearby power-up.
    for (const p of powers) if (Math.hypot(p.x - f.x, p.y - f.y) < 120) { const dx = p.x - f.x, dy = p.y - f.y, d = Math.hypot(dx, dy) || 1; mx = dx / d; my = dy / d; }
    return { mx, my, dash: doDash };
  }

  // ---------- Update ----------

  const keys = new Set();
  function inputFor(f) {
    if (f.ai) return botInput(f, 0);
    const p2 = mode === 'two' && f.i === 1;
    const k = c => keys.has(c);
    if (p2) return { mx: (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0), my: (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0), dash: dashPressed[1] };
    if (mode === 'two') return { mx: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), my: (k('KeyS') ? 1 : 0) - (k('KeyW') ? 1 : 0), dash: dashPressed[0] };
    return { mx: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0), my: (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0), dash: dashPressed[0] };
  }
  const dashPressed = [false, false];

  function update(dt) {
    time += dt;
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    if (state === 'countdown') { countT -= dt; if (countT <= 0) { state = 'play'; banner = { text: 'BONK!', t: 0.8, color: '#ffd23f' }; Arcade.tone({ freq: 880, dur: 0.2, type: 'square', vol: 0.05 }); } }
    if (state === 'play') {
      roundT += dt;
      if (roundT > 8) arenaR = Math.max(RMIN, arenaR - SHRINK * dt / 6);
      powerT -= dt;
      if (powerT <= 0 && powers.length < 2) { powerT = 7 + R(0, 4); const a = R(0, TAU), d = R(0, arenaR * 0.6); powers.push({ ...POWERS[Math.floor(Math.random() * POWERS.length)], x: CX + Math.cos(a) * d, y: CY + Math.sin(a) * d, bob: 0 }); }
    }
    for (const f of fighters) {
      if (f.out) { f.fall += dt; continue; }
      if (state === 'play') {
        const inp = f.ai ? botInput(f, dt) : inputFor(f);
        const m = Math.hypot(inp.mx, inp.my);
        if (m) { f.vx += inp.mx / m * 900 * dt; f.vy += inp.my / m * 900 * dt; f.face = Math.atan2(inp.my, inp.mx); }
        if (inp.dash) dash(f, inp.mx, inp.my);
      }
      const max = f.dashT > 0 ? 900 : 260;
      const v = Math.hypot(f.vx, f.vy);
      if (v > max) { f.vx *= max / v; f.vy *= max / v; }
      const fr = f.dashT > 0 ? 1.2 : 3.4;
      f.vx *= Math.exp(-fr * dt); f.vy *= Math.exp(-fr * dt);
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.dashT = Math.max(0, f.dashT - dt); f.cd = Math.max(0, f.cd - dt);
      f.squash *= Math.exp(-8 * dt);
      if (f.power) { f.powerT -= dt; if (f.powerT <= 0) f.power = null; }
      for (const p of powers) if (!p.taken && Math.hypot(p.x - f.x, p.y - f.y) < f.r + 12) { p.taken = true; f.power = p.id; f.powerT = p.t; floats.add(p.label, f.x, f.y - 30, { color: p.color, size: 14 }); Arcade.tone({ freq: 700, to: 1100, dur: 0.12, type: 'triangle', vol: 0.04 }); }
      if (state === 'play' && Math.hypot(f.x - CX, f.y - CY) > arenaR + 4) knockOut(f);
    }
    powers = powers.filter(p => !p.taken);
    dashPressed[0] = dashPressed[1] = false;
    for (let i = 0; i < fighters.length; i++) for (let j = i + 1; j < fighters.length; j++) if (!fighters[i].out && !fighters[j].out) collide(fighters[i], fighters[j]);
    fx.update(dt); floats.update(dt); shake.update(dt);
  }

  // ---------- Input ----------

  addEventListener('keydown', e => {
    keys.add(e.code);
    if (state !== 'play' && state !== 'countdown') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.code)) e.preventDefault();
    if (!e.repeat && (e.code === 'Space' || (mode !== 'two' && (e.code === 'KeyJ' || e.code === 'KeyK')))) dashPressed[0] = true;
    if (!e.repeat && mode === 'two' && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Slash' || e.code === 'KeyL')) dashPressed[1] = true;
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  function pause() {
    if (state === 'paused' || (typeof Versus !== 'undefined' && Versus.active())) return;
    const was = state;
    state = 'paused';
    ui.show({ title: 'Paused', html: '<div class="menu"><button class="btn secondary" type="button" data-menu>Quit to menu</button></div>', button: 'Resume', onAction: () => { state = was; ui.hide(); }, onRender: p => p.querySelector('[data-menu]').addEventListener('click', showMenu) });
  }
  Arcade.onBlur(() => { if (state === 'play' || state === 'countdown') pause(); });

  // ---------- Drawing ----------

  const backdrop = Gfx.sprite(W, H, 0, 0, g => {
    const bg = g.createRadialGradient(CX, CY, 50, CX, CY, 600);
    bg.addColorStop(0, '#3a1a4a'); bg.addColorStop(1, '#0d0818');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const r = Gfx.rng(12);
    for (let i = 0; i < 160; i++) { g.globalAlpha = 0.3 + r() * 0.7; g.fillStyle = '#fff'; g.fillRect(r() * W, r() * H, 1.5, 1.5); }
    g.globalAlpha = 1;
  });

  function drawArena() {
    // Underside and glowing rim.
    ctx.fillStyle = '#2a1e3a';
    ctx.beginPath(); ctx.ellipse(CX, CY + 22, arenaR + 6, (arenaR + 6) * 0.92, 0, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(CX - arenaR * 0.3, CY - arenaR * 0.3, 10, CX, CY, arenaR);
    g.addColorStop(0, '#6b5a8a'); g.addColorStop(1, '#43375e');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, CY, arenaR, 0, TAU); ctx.fill();
    // Tiles.
    ctx.save(); ctx.beginPath(); ctx.arc(CX, CY, arenaR, 0, TAU); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2;
    for (let r = 40; r < R0; r += 40) { ctx.beginPath(); ctx.arc(CX, CY, r, 0, TAU); ctx.stroke(); }
    for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(CX + Math.cos(a) * R0, CY + Math.sin(a) * R0); ctx.stroke(); }
    ctx.restore();
    const danger = arenaR < R0 - 2;
    ctx.strokeStyle = danger ? `rgba(255,90,90,${0.6 + Math.sin(time * 8) * 0.3})` : 'rgba(255,210,63,0.8)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(CX, CY, arenaR, 0, TAU); ctx.stroke();
  }

  function drawFighter(f) {
    let sc = 1, x = f.x, y = f.y;
    if (f.out) { sc = Math.max(0, 1 - f.fall * 1.2); y += f.fall * 120; if (sc <= 0) return; }
    else Gfx.shadow(ctx, x + 3, y + f.r * 0.7, f.r * 0.95, f.r * 0.45, 0.35);
    const sq = f.squash, r = f.r * sc;
    ctx.save();
    ctx.translate(x, y);
    if (f.out) ctx.rotate(f.fall * 6);
    ctx.scale(1 + sq, 1 - sq);
    if (f.dashT > 0) { ctx.fillStyle = Gfx.alpha(f.color, 0.3); ctx.beginPath(); ctx.arc(-Math.cos(f.face) * 14, -Math.sin(f.face) * 14, r, 0, TAU); ctx.fill(); }
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, Gfx.shade(f.color, 0.4)); g.addColorStop(1, f.power === 'heavy' ? '#6b7080' : f.color);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = Gfx.shade(f.color, -0.35); ctx.lineWidth = 2.5; ctx.stroke();
    // Face, looking where it's heading.
    const lx = Math.cos(f.face) * r * 0.25, ly = Math.sin(f.face) * r * 0.25;
    const blink = Math.sin(time * 2 + f.blink) > 0.97;
    ctx.fillStyle = '#fff';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(lx + s * r * 0.3, ly - r * 0.15, r * 0.2, blink ? 1 : r * 0.24, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#111';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(lx * 1.4 + s * r * 0.3, ly * 1.4 - r * 0.15, r * 0.1, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); if (f.dashT > 0 || f.out) ctx.arc(lx, ly + r * 0.3, r * 0.14, 0, TAU); else ctx.arc(lx, ly + r * 0.2, r * 0.18, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.restore();
    if (f.power === 'shield' && !f.out) { ctx.strokeStyle = `rgba(126,240,255,${0.5 + Math.sin(time * 10) * 0.2})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 6, 0, TAU); ctx.stroke(); }
    if (!f.out) {
      Gfx.text(ctx, f.name, x, y - r - 14, { size: 11, color: f.color, width: 3 });
      if (f.cd > 0) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - f.cd / 1.1)); ctx.stroke(); }
    }
  }

  function draw() {
    const off = shake.offset(8);
    ctx.save();
    ctx.translate(off.x, off.y);
    backdrop.draw(ctx, 0, 0);
    drawArena();
    for (const p of powers) {
      p.bob += 0.05;
      const y = p.y + Math.sin(p.bob) * 3;
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, y, 11, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      Gfx.text(ctx, p.id === 'heavy' ? 'W' : p.id === 'spring' ? '⇡' : '◆', p.x, y, { size: 11, stroke: null, color: '#111' });
    }
    const order = [...fighters].sort((a, b) => a.y - b.y);
    for (const f of order) if (f.out) drawFighter(f);
    for (const f of order) if (!f.out) drawFighter(f);
    fx.draw(ctx);
    floats.draw(ctx);
    ctx.restore();
    if (state === 'menu') return;
    // Round wins.
    fighters.forEach((f, i) => {
      const x = 20 + i * 160;
      Gfx.card(ctx, x, 10, 150, 30);
      ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(x + 14, 25, 7, 0, TAU); ctx.fill();
      Gfx.text(ctx, f.name, x + 28, 25, { size: 12, align: 'left', stroke: null, color: f.out ? '#8d94a1' : '#fff' });
      for (let k = 0; k < ROUNDS; k++) { ctx.fillStyle = k < wins[i] ? '#ffd23f' : 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(x + 108 + k * 13, 25, 5, 0, TAU); ctx.fill(); }
    });
    if (state === 'countdown') Gfx.text(ctx, String(Math.ceil(countT)), CX, CY, { size: 60, color: '#fff', width: 8 });
    if (banner) { ctx.globalAlpha = Math.min(1, banner.t * 2); Gfx.text(ctx, banner.text, CX, 90, { size: 30, color: banner.color, width: 6 }); ctx.globalAlpha = 1; }
    if (arenaR < R0 - 2 && state === 'play') Gfx.text(ctx, 'The arena is shrinking!', CX, H - 18, { size: 13, color: '#ff8a80' });
  }

  function updateHud() {
    $('round').textContent = round || '-';
    $('kos').textContent = kos;
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  // ---------- Menu ----------

  function menuHtml() {
    return `<p>Four brawlers, one shrinking arena. Shove everyone else off the edge: a <b>dash</b> hits far harder than a bump. Last one standing wins the round; first to ${ROUNDS} wins.</p>
      <p style="font-size:13px"><b>WASD</b> or arrows to move, <b>Space</b> to dash. Grab power-ups: <b>Heavy</b> (hard to move), <b>Spring</b> (bigger bonks), <b>Shield</b>.</p>
      <div class="row">${LEVELS.map((l, i) => `<button class="btn ${i === level ? '' : 'secondary'}" type="button" data-level="${i}">${l.name}</button>`).join('')}</div>
      <div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-two>Two players, one keyboard</button></div>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 0">Two players: Blue uses <b>WASD</b> + <b>Space</b>, Red uses the <b>arrows</b> + <b>Enter</b>. Two bots join in.</p>`;
  }
  function wireMenu(p) {
    p.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => { level = +b.dataset.level; Arcade.save('bonk:level', level); p.querySelectorAll('[data-level]').forEach(x => x.classList.toggle('secondary', +x.dataset.level !== level)); }));
    p.querySelector('[data-two]').addEventListener('click', () => startMatch('two'));
  }
  const intro = () => ({ title: '🥊 Bonk Brawl', html: menuHtml(), button: 'Brawl vs bots', onAction: () => startMatch('bots'), onRender: wireMenu });
  function showMenu() { state = 'menu'; mode = 'bots'; fighters = [0, 1, 2, 3].map(i => makeFighter(i, i === 0)); ui.show(intro()); updateHud(); }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const duel = typeof Versus !== 'undefined' && Versus.active();
    if ((state === 'play' || state === 'countdown' || state === 'roundover') && (overlayEl.hidden || duel)) update(dt);
    else { time += dt; fx.update(dt); floats.update(dt); shake.update(dt); }
    draw();
    requestAnimationFrame(frame);
  }

  fighters = [0, 1, 2, 3].map(i => makeFighter(i, i === 0));
  updateHud();
  Versus.attach({ ui, start: () => startMatch('bots'), score: () => Math.round((kos * 100 + wins[0] * 250) * [0.7, 1, 1.4][level]), intro: intro() });
  requestAnimationFrame(frame);
})();
