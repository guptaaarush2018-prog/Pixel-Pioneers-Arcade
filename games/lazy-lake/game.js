/* Lazy Lake: fishing off a dock until sunset. Hold to charge a cast and let go. Fish that
   notice your lure come for a look: a few nibbles first (hook now and they flee), then the real
   bite. Hook it, then reel: hold to pull, ease off when the line goes red, and let the fish tire
   itself out. Three minutes of daylight per trip; your catch is your score, and it pays coins
   for a better rod, line, reel and lure. The journal keeps the biggest of each kind. */
(() => {
  const ID = 'lazy-lake';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const SURF = 250, DOCK_X = 178, DAY = 180;
  const SAVE = 'lake:save';
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R = Gfx.rand;
  const fx = Gfx.particles(500), floats = Gfx.floaters(), shake = Gfx.shaker();

  // Depth bands are pixels below the surface. pull: how hard it fights; wary: how easily spooked.
  const SPECIES = [
    { id: 'minnow', name: 'Silver Minnow', color: '#b8c7d6', len: [6, 10], depth: [10, 70], value: 4, pull: 0.25, wary: 0.2, weight: 30 },
    { id: 'perch', name: 'Striped Perch', color: '#c9b03a', len: [14, 28], depth: [30, 120], value: 12, pull: 0.45, wary: 0.35, weight: 22 },
    { id: 'sunny', name: 'Sunfish', color: '#ff9f43', len: [10, 20], depth: [15, 90], value: 10, pull: 0.4, wary: 0.3, weight: 18 },
    { id: 'trout', name: 'Rainbow Trout', color: '#e8a0b4', len: [25, 50], depth: [40, 150], value: 30, pull: 0.65, wary: 0.5, weight: 12 },
    { id: 'bass', name: 'Bigmouth Bass', color: '#5f8f4a', len: [30, 60], depth: [60, 190], value: 45, pull: 0.8, wary: 0.55, weight: 9 },
    { id: 'catfish', name: 'Whisker Catfish', color: '#7a6a58', len: [40, 90], depth: [170, 240], value: 70, pull: 0.85, wary: 0.4, weight: 6 },
    { id: 'pike', name: 'Lake Pike', color: '#8aa35a', len: [50, 100], depth: [80, 200], value: 95, pull: 1.0, wary: 0.7, weight: 4 },
    { id: 'koi', name: 'Golden Koi', color: '#ffb02e', len: [35, 70], depth: [20, 110], value: 160, pull: 0.7, wary: 0.85, weight: 2 },
    { id: 'eel', name: 'Glow Eel', color: '#7ef0ff', len: [50, 110], depth: [200, 250], value: 220, pull: 0.95, wary: 0.6, weight: 1.4, night: true },
    { id: 'sturgeon', name: 'Old Sturgeon', color: '#6b7a8c', len: [120, 200], depth: [190, 250], value: 420, pull: 1.25, wary: 0.8, weight: 0.6 },
  ];
  const UPGRADES = [
    { id: 'rod', name: 'Rod', desc: 'Cast farther', costs: [60, 180, 450, 900] },
    { id: 'line', name: 'Line', desc: 'Takes more strain before it snaps', costs: [50, 160, 400, 850] },
    { id: 'reel', name: 'Reel', desc: 'Reel in faster', costs: [50, 150, 380, 800] },
    { id: 'lure', name: 'Lure', desc: 'Fish notice it from farther, and rare fish bite more', costs: [80, 220, 520, 1000] },
  ];
  const fresh = () => ({ coins: 0, up: { rod: 0, line: 0, reel: 0, lure: 0 }, journal: {}, trips: 0 });
  let save = { ...fresh(), ...Arcade.load(SAVE, {}) };
  save.up = { ...fresh().up, ...save.up };

  const DEPTHS = [{ name: 'shallow', d: 55 }, { name: 'middle', d: 135 }, { name: 'deep', d: 999 }];
  let depthSet = 1;
  let state = 'menu', fish = [], lure = null, phase = 'idle', charge = 0, chargeDir = 1, hooked = null, tension = 0, slackT = 0, catchList = [], score = 0, dayT = 0, time = 0, spawnRng = Math.random, held = false, bite = null, banner = null;

  const bottomAt = x => 500 - Math.sin(x / 140) * 18 - (x < 260 ? (260 - x) * 0.9 : 0);
  const castMax = () => 520 + save.up.rod * 70;
  const lineMax = () => 1 + save.up.line * 0.18;
  const reelSpeed = () => 105 + save.up.reel * 22;
  const noticeR = () => 85 + save.up.lure * 22;

  // ---------- Fish ----------

  function spawnFish() {
    const night = dayT > DAY * 0.75;
    const pool = SPECIES.filter(s => !s.night || night);
    const boost = 1 + save.up.lure * 0.35;
    let r = spawnRng() * pool.reduce((t, s) => t + (s.value > 100 ? s.weight * boost : s.weight), 0), sp = pool[0];
    for (const s of pool) { r -= s.value > 100 ? s.weight * boost : s.weight; if (r <= 0) { sp = s; break; } }
    const len = sp.len[0] + spawnRng() * (sp.len[1] - sp.len[0]);
    const dir = spawnRng() < 0.5 ? 1 : -1;
    const depth = sp.depth[0] + spawnRng() * (sp.depth[1] - sp.depth[0]);
    fish.push({ sp, len, x: dir > 0 ? 200 : W + 60, y: SURF + depth, home: SURF + depth, dir, v: 25 + spawnRng() * 30, wig: R(0, TAU), mode: 'swim', interest: 0, nibbles: 0, nibT: 0, cool: 0 });
  }

  function updateFish(dt) {
    for (const f of fish) {
      f.wig += dt * (f.mode === 'fight' ? 14 : 6);
      f.cool = Math.max(0, f.cool - dt);
      if (f.mode === 'swim') {
        f.x += f.dir * f.v * dt;
        f.y += (f.home - f.y) * dt * 0.5 + Math.sin(f.wig * 0.3) * 6 * dt;
        // Notice the lure.
        if (lure && phase === 'out' && f.cool <= 0 && !bite) {
          const d = Math.hypot(lure.x - f.x, lure.y - f.y);
          if (d < noticeR() + f.len * 0.5 && Math.random() < dt * (1.2 - f.sp.wary * 0.6)) { f.mode = 'look'; f.nibbles = 1 + Math.floor(Math.random() * 3); f.nibT = 0.6 + Math.random(); }
        }
      } else if (f.mode === 'look') {
        if (!lure || phase !== 'out') { f.mode = 'swim'; continue; }
        const tx = lure.x - f.dir * f.len * 0.55, ty = lure.y;
        f.dir = lure.x > f.x ? 1 : -1;
        f.x += (tx - f.x) * dt * 2; f.y += (ty - f.y) * dt * 2;
        f.nibT -= dt;
        if (f.nibT <= 0 && Math.hypot(tx - f.x, ty - f.y) < 14) {
          if (f.nibbles > 0) {
            f.nibbles--;
            f.nibT = 0.5 + Math.random() * 0.9;
            lure.tug = 0.25;
            ripple(lure.x, SURF, 0.5);
            Arcade.tone({ freq: 520, dur: 0.04, type: 'sine', vol: 0.025 });
          } else {
            // The real bite: hook it now!
            f.mode = 'bite';
            bite = { f, t: 0.75 - f.sp.wary * 0.2 };
            lure.tug = 0.8;
            ripple(lure.x, SURF, 1.2);
            Arcade.tone({ freq: 880, to: 1320, dur: 0.12, type: 'square', vol: 0.05 });
          }
        }
        // Reeling fast scares the wary ones.
        if (held && Math.random() < dt * f.sp.wary * 1.5) spook(f);
      } else if (f.mode === 'bite') {
        if (!lure || phase !== 'out') { f.mode = 'swim'; continue; }
        f.x += (lure.x - f.dir * f.len * 0.55 - f.x) * dt * 6;
        f.y += (lure.y - f.y) * dt * 6;
      } else if (f.mode === 'flee') {
        f.x += f.dir * 160 * dt;
        f.y += (f.home + 20 - f.y) * dt;
        if (f.x < 150 || f.x > W + 80) f.mode = 'swim';
      }
    }
    fish = fish.filter(f => f.mode === 'fight' || (f.x > 140 && f.x < W + 120));
    while (fish.length < 11) spawnFish();
  }

  function spook(f) {
    f.mode = 'flee';
    f.dir = Math.random() < 0.5 ? -1 : 1;
    f.cool = 6;
    if (bite?.f === f) bite = null;
  }

  // ---------- Casting and reeling ----------

  function press() {
    if (state !== 'play') return;
    held = true;
    if (phase === 'idle') { phase = 'charge'; charge = 0; chargeDir = 1; }
    else if (phase === 'out' && bite) hook();
    else if (phase === 'out') {
      // Hooking at a nibble (not the real bite) scares the fish away.
      const nibbler = fish.find(f => f.mode === 'look' && lure && Math.hypot(lure.x - f.x - f.dir * f.len * 0.55, lure.y - f.y) < 30);
      if (nibbler) { spook(nibbler); floats.add('Too soon!', lure.x, SURF - 30, { color: '#ff8a80', size: 15 }); }
    }
  }
  function release() {
    held = false;
    if (phase === 'charge') {
      // Let go: the lure flies out.
      const dist = 60 + charge * (castMax() - 60);
      lure = { x: DOCK_X + 30, y: 170, tx: DOCK_X + 30 + dist, vy: 0, t: 0, fly: true, tug: 0, sx: DOCK_X + 30 };
      phase = 'cast';
      Arcade.tone({ freq: 700, to: 300, dur: 0.25, type: 'sine', vol: 0.04 });
    }
  }

  function hook() {
    const f = bite.f;
    bite = null;
    hooked = f;
    f.mode = 'fight';
    f.stamina = 1;
    f.burst = 0; f.burstT = 1;
    tension = 0.35;
    slackT = 0;
    phase = 'fight';
    shake.add(0.2);
    Arcade.tone({ freq: 300, to: 600, dur: 0.15, type: 'sawtooth', vol: 0.05 });
    banner = { text: 'Hooked!', t: 1, color: '#ffd23f' };
  }

  function updateLine(dt) {
    if (phase === 'charge') {
      charge += chargeDir * dt / 1.1;
      if (charge >= 1) { charge = 1; chargeDir = -1; } else if (charge <= 0) { charge = 0; chargeDir = 1; }
      return;
    }
    if (!lure) return;
    lure.tug = Math.max(0, lure.tug - dt * 2);
    if (phase === 'cast') {
      lure.t += dt / 0.8;
      const k = Math.min(1, lure.t);
      lure.x = lure.sx + (lure.tx - lure.sx) * k;
      lure.y = 170 + (SURF - 170) * k - Math.sin(k * Math.PI) * 120;
      if (k >= 1) { phase = 'out'; lure.y = SURF + 2; ripple(lure.x, SURF, 1); Arcade.tone({ freq: 300, to: 150, dur: 0.15, type: 'sine', vol: 0.04 }); }
      return;
    }
    if (phase === 'out') {
      if (held && !bite) {
        // Reel in: the lure comes toward the dock and up.
        const dx = DOCK_X + 20 - lure.x, dy = SURF - 4 - lure.y, d = Math.hypot(dx, dy) || 1;
        lure.x += dx / d * reelSpeed() * dt;
        lure.y += dy / d * reelSpeed() * dt * 0.6;
        if (lure.x <= DOCK_X + 24) { lure = null; phase = 'idle'; bite = null; return; }
      } else {
        lure.y = Math.min(bottomAt(lure.x) - 6, SURF + DEPTHS[depthSet].d, lure.y + 38 * dt);
        if (lure.y < SURF + DEPTHS[depthSet].d - 40 && !held) lure.y = Math.min(lure.y, SURF + DEPTHS[depthSet].d);
      }
      if (bite) { bite.t -= dt; if (bite.t <= 0) { spook(bite.f); floats.add('Missed it!', lure.x, SURF - 30, { color: '#ff8a80', size: 15 }); } }
      return;
    }
    if (phase === 'fight') {
      const f = hooked;
      // The fish fights in bursts, harder when it's fresh.
      f.burstT -= dt;
      if (f.burstT <= 0) { f.burst = f.burst > 0 ? 0 : 0.6 + Math.random() * 0.6; f.burstT = f.burst ? 0.6 + Math.random() * 1.2 : 0.5 + Math.random(); f.dir = Math.random() < 0.7 ? 1 : -1; }
      const pull = f.sp.pull * (0.4 + f.stamina * 0.6) * (f.burst ? 1.6 : 0.4) * (0.7 + f.len / 160);
      const reel = held ? 1 : 0;
      tension += (reel * 0.75 + pull * 0.65 - 0.55 - (reel ? 0 : 0.35)) * dt / lineMax();
      tension = Math.max(0, tension);
      // Movement: reeling drags it in; a burst drags it away.
      const toward = reel * reelSpeed() * (1 - Math.min(0.85, pull * 0.6)) * (tension < 0.95 ? 1 : 0.3);
      const away = pull * 70;
      f.x += (-toward + away * f.dir * (f.dir > 0 ? 1 : 0.4)) * dt;
      f.x = clamp(f.x, DOCK_X - 10, W - 30);
      f.y = clamp(f.y + (held ? -30 : 20) * dt + Math.sin(f.wig) * 20 * dt, SURF + 8, bottomAt(f.x) - 6);
      if (tension > 0.3) f.stamina = Math.max(0, f.stamina - dt * 0.07 * (1 + tension));
      lure.x = f.x + f.dir * f.len * 0.55; lure.y = f.y;
      if (Math.random() < dt * 10 * pull) fx.emit({ x: f.x, y: SURF, vx: R(-20, 20), vy: -R(30, 80), life: 0.4, size: 2, color: '#d8f0ff', g: 0 });
      if (tension > 1) {
        snap();
      } else if (tension < 0.04) {
        slackT += dt;
        if (slackT > 1.6) escape();
      } else slackT = 0;
      if (f.x <= DOCK_X + 12) landFish(f);
    }
  }

  function snap() {
    banner = { text: 'Snap! The line broke', t: 1.6, color: '#ff8a80' };
    Arcade.tone({ freq: 1200, to: 200, dur: 0.2, type: 'square', vol: 0.05 });
    shake.add(0.3);
    lose();
  }
  function escape() {
    banner = { text: 'It got away…', t: 1.6, color: '#ff8a80' };
    Arcade.tone({ freq: 400, to: 200, dur: 0.3, type: 'sine', vol: 0.04 });
    lose();
  }
  function lose() {
    if (hooked) { hooked.mode = 'flee'; hooked.cool = 8; }
    hooked = null; lure = null; phase = 'idle'; tension = 0; bite = null;
  }

  function landFish(f) {
    const pts = Math.round(f.sp.value * (0.6 + (f.len - f.sp.len[0]) / (f.sp.len[1] - f.sp.len[0]) * 0.8));
    score += pts;
    catchList.push({ sp: f.sp, len: f.len, pts });
    const j = save.journal[f.sp.id] || { n: 0, best: 0 };
    const record = f.len > j.best;
    save.journal[f.sp.id] = { n: j.n + 1, best: Math.max(j.best, f.len) };
    Arcade.save(SAVE, save);
    fish.splice(fish.indexOf(f), 1);
    hooked = null; lure = null; phase = 'idle'; tension = 0;
    banner = { text: `${f.sp.name}!`, sub: `${f.len.toFixed(0)} cm · +${pts}${record ? ' · new record!' : ''}${j.n === 0 ? ' · new species!' : ''}`, t: 2.2, color: f.sp.color };
    fx.burst(24, () => ({ x: DOCK_X + 10, y: SURF - 10, vx: R(-120, 120), vy: R(-220, -60), life: R(0.5, 1), size: R(2, 4), color: R() < 0.5 ? '#d8f0ff' : f.sp.color, g: 0, drag: 1 }));
    [523, 659, 784].forEach((fq, i) => Arcade.tone({ freq: fq, dur: 0.12, type: 'triangle', vol: 0.05, delay: i * 0.07 }));
    Arcade.flag('lazy-lake-first');
    if (f.sp.value >= 150) Arcade.flag('lazy-lake-rare');
    if (f.sp.id === 'sturgeon') Arcade.flag('lazy-lake-sturgeon');
    if (Object.keys(save.journal).length >= SPECIES.length) Arcade.flag('lazy-lake-journal');
    updateHud();
  }

  const ripples = [];
  function ripple(x, y, s) { ripples.push({ x, y, t: 0, s }); }

  // ---------- Flow ----------

  function start() {
    spawnRng = Gfx.rng(Math.floor(Math.random() * 2 ** 31));
    fish = []; fx.clear(); catchList = [];
    for (let i = 0; i < 9; i++) { spawnFish(); fish[i].x = 220 + spawnRng() * 700; }
    lure = null; phase = 'idle'; hooked = null; bite = null; tension = 0;
    score = 0; dayT = 0; time = 0; banner = null;
    state = 'play';
    ui.hide();
    updateHud();
  }

  function endTrip() {
    if (state !== 'play') return;
    state = 'over';
    save.coins += score;
    save.trips++;
    Arcade.save(SAVE, save);
    if (score >= 600) Arcade.flag('lazy-lake-600');
    const best = catchList.slice().sort((a, b) => b.pts - a.pts)[0];
    Arcade.finish(ui, {
      score,
      title: 'Sunset!',
      lines: [`${catchList.length} fish caught${best ? ` · best: ${best.sp.name}, ${best.len.toFixed(0)} cm` : ''}`, `+${score} coins (you have ${save.coins.toLocaleString()})`],
      button: 'Back to the tackle shop',
      onAction: showMenu,
    });
  }

  function update(dt) {
    time += dt;
    dayT += dt;
    if (dayT >= DAY && phase !== 'fight') return endTrip();
    updateFish(dt);
    updateLine(dt);
    for (const r of ripples) r.t += dt;
    for (let i = ripples.length - 1; i >= 0; i--) if (ripples[i].t > 1.2) ripples.splice(i, 1);
    fx.update(dt); floats.update(dt); shake.update(dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    updateHud();
  }

  // ---------- Input ----------

  addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'KeyJ') { e.preventDefault(); if (!e.repeat) press(); }
    if ((e.code === 'KeyP' || e.code === 'Escape') && state === 'play') pause();
    // How deep the bobber lets the lure sink.
    if (state === 'play' && (e.code === 'KeyW' || e.code === 'ArrowUp')) { e.preventDefault(); depthSet = Math.max(0, depthSet - 1); depthNote(); }
    if (state === 'play' && (e.code === 'KeyS' || e.code === 'ArrowDown')) { e.preventDefault(); depthSet = Math.min(2, depthSet + 1); depthNote(); }
  });
  function depthNote() {
    floats.add(`Depth: ${DEPTHS[depthSet].name}`, 150, 150, { color: '#fff', size: 15 });
    // Pulling the lure up to a shallower setting lifts it right away.
    if (lure && phase === 'out') lure.y = Math.min(lure.y, SURF + DEPTHS[depthSet].d);
  }
  addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'KeyJ') release(); });
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
  addEventListener('pointerup', () => { if (held) release(); });
  addEventListener('blur', () => { if (held) release(); });
  function pause() {
    if (state !== 'play' || (typeof Versus !== 'undefined' && Versus.active())) return;
    state = 'paused';
    held = false;
    ui.show({ title: 'Paused', html: `<p>${score} points so far</p>`, button: 'Resume', onAction: () => { state = 'play'; ui.hide(); } });
  }
  Arcade.onBlur(() => { if (state === 'play') pause(); });

  // ---------- Drawing ----------

  function skyColors() {
    const k = clamp(dayT / DAY, 0, 1);
    const stops = [[0, ['#7ec8f5', '#cfe9ff']], [0.6, ['#f6a65a', '#ffd9a0']], [0.85, ['#8a4f9e', '#ff9a6a']], [1, ['#1d2450', '#5a3a6a']]];
    let a = stops[0], b = stops[0];
    for (let i = 0; i < stops.length - 1; i++) if (k >= stops[i][0] && k <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
    const t = b[0] > a[0] ? (k - a[0]) / (b[0] - a[0]) : 0;
    return [Gfx.mix(a[1][0], b[1][0], t), Gfx.mix(a[1][1], b[1][1], t), k];
  }

  const hills = Gfx.sprite(W, 120, 0, 0, g => {
    g.fillStyle = 'rgba(60,90,80,0.55)'; g.beginPath(); g.moveTo(0, 120);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, 60 - Math.sin(x / 120) * 26 - Math.sin(x / 47) * 8);
    g.lineTo(W, 120); g.fill();
    g.fillStyle = 'rgba(40,70,55,0.8)'; g.beginPath(); g.moveTo(0, 120);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, 92 - Math.sin(x / 90 + 1) * 16);
    g.lineTo(W, 120); g.fill();
    for (let x = 30; x < W; x += 38) { g.fillStyle = '#2f5a40'; g.beginPath(); g.moveTo(x, 70 + Math.sin(x) * 10); g.lineTo(x - 10, 100); g.lineTo(x + 10, 100); g.fill(); }
  });

  function drawFish(f) {
    const L = 18 + f.len * 0.6, h = L * 0.36, wig = Math.sin(f.wig) * 0.25;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.dir, 1);
    const depthDim = clamp((f.y - SURF) / 260, 0, 0.6);
    ctx.globalAlpha = 0.9 - depthDim * 0.5;
    // Tail.
    ctx.fillStyle = Gfx.shade(f.sp.color, -0.2);
    ctx.save(); ctx.translate(-L * 0.45, 0); ctx.rotate(wig);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-L * 0.3, -h * 0.7); ctx.lineTo(-L * 0.22, 0); ctx.lineTo(-L * 0.3, h * 0.7); ctx.fill();
    ctx.restore();
    // Body.
    const g = ctx.createLinearGradient(0, -h, 0, h);
    g.addColorStop(0, Gfx.shade(f.sp.color, -0.25)); g.addColorStop(0.5, f.sp.color); g.addColorStop(1, Gfx.shade(f.sp.color, 0.35));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, L * 0.5, h * (f.sp.id === 'eel' ? 0.45 : 1) * 0.5 * 2 / 2 * (f.sp.id === 'eel' ? 1 : 1), 0, 0, TAU); ctx.fill();
    if (f.sp.id === 'perch') { ctx.fillStyle = 'rgba(40,40,20,0.35)'; for (let k = -1; k <= 1; k++) ctx.fillRect(k * L * 0.15 - 2, -h * 0.45, 4, h * 0.7); }
    if (f.sp.id === 'trout') { ctx.fillStyle = 'rgba(255,90,140,0.5)'; ctx.fillRect(-L * 0.4, -2, L * 0.8, 4); }
    if (f.sp.id === 'koi') { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(-L * 0.1, -h * 0.1, h * 0.25, 0, TAU); ctx.fill(); }
    if (f.sp.id === 'eel') { ctx.shadowColor = '#7ef0ff'; ctx.shadowBlur = 12; ctx.fillStyle = '#c8fbff'; ctx.fillRect(-L * 0.4, -1, L * 0.8, 2); ctx.shadowBlur = 0; }
    if (f.sp.id === 'catfish') { ctx.strokeStyle = '#3a3028'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(L * 0.45, h * 0.1); ctx.quadraticCurveTo(L * 0.6, h * 0.5, L * 0.5, h * 0.8); ctx.stroke(); }
    // Fin and eye.
    ctx.fillStyle = Gfx.shade(f.sp.color, -0.3);
    ctx.beginPath(); ctx.moveTo(-L * 0.05, -h * 0.45); ctx.lineTo(L * 0.12, -h * 0.85); ctx.lineTo(L * 0.2, -h * 0.4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(L * 0.3, -h * 0.12, Math.max(2, h * 0.16), 0, TAU); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(L * 0.32, -h * 0.12, Math.max(1, h * 0.08), 0, TAU); ctx.fill();
    ctx.restore();
    if (f.mode === 'look') Gfx.text(ctx, '?', f.x, f.y - 18, { size: 13, color: '#fff', width: 3 });
  }

  function draw() {
    const [top, bottom, k] = skyColors();
    const off = shake.offset(6);
    ctx.save();
    ctx.translate(off.x, off.y);
    const sky = ctx.createLinearGradient(0, 0, 0, SURF);
    sky.addColorStop(0, top); sky.addColorStop(1, bottom);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, SURF);
    // Sun sinking (and stars after).
    const sunY = 60 + k * 230;
    ctx.fillStyle = k < 0.95 ? '#fff3c4' : '#ffd0a0';
    ctx.shadowColor = '#ffd27a'; ctx.shadowBlur = 40;
    ctx.beginPath(); ctx.arc(720, sunY, 30, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    if (k > 0.8) { ctx.globalAlpha = (k - 0.8) * 5; ctx.fillStyle = '#fff'; const r = Gfx.rng(2); for (let i = 0; i < 60; i++) ctx.fillRect(r() * W, r() * (SURF - 80), 1.5, 1.5); ctx.globalAlpha = 1; }
    hills.draw(ctx, 0, SURF - 118);
    // Water.
    const water = ctx.createLinearGradient(0, SURF, 0, H);
    water.addColorStop(0, Gfx.mix('#3f8fbf', '#1a2a4a', k * 0.8)); water.addColorStop(1, Gfx.mix('#0f3550', '#070c1c', k * 0.8));
    ctx.fillStyle = water; ctx.fillRect(0, SURF, W, H - SURF);
    // Sun's reflection.
    if (sunY < SURF) for (let i = 0; i < 8; i++) { ctx.fillStyle = `rgba(255,230,170,${0.25 - i * 0.025})`; ctx.fillRect(700 - 30 + Math.sin(time * 2 + i) * 6 - i * 2, SURF + 4 + i * 8, 60 + i * 4, 2); }
    // Light rays.
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 5; i++) { const x = 250 + i * 150 + Math.sin(time * 0.3 + i) * 20; ctx.beginPath(); ctx.moveTo(x, SURF); ctx.lineTo(x + 40, SURF); ctx.lineTo(x + 120, H); ctx.lineTo(x + 50, H); ctx.fill(); }
    // Lake bed and weeds.
    ctx.fillStyle = '#3b3326';
    ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x <= W; x += 10) ctx.lineTo(x, bottomAt(x)); ctx.lineTo(W, H); ctx.fill();
    ctx.strokeStyle = '#2f6b3a'; ctx.lineWidth = 3;
    for (let x = 270; x < W; x += 46) { const b = bottomAt(x); ctx.beginPath(); ctx.moveTo(x, b); ctx.quadraticCurveTo(x + Math.sin(time + x) * 10, b - 30, x + Math.sin(time * 1.3 + x) * 6, b - 55); ctx.stroke(); }
    for (const f of fish) if (f !== hooked) drawFish(f);
    if (hooked) drawFish(hooked);
    // Surface waves and ripples.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); for (let x = 0; x <= W; x += 8) { const y = SURF + Math.sin(x / 30 + time * 2) * 1.5; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke();
    for (const r of ripples) { ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - r.t / 1.2)})`; ctx.beginPath(); ctx.ellipse(r.x, r.y, 6 + r.t * 30 * r.s, 2 + r.t * 6 * r.s, 0, 0, TAU); ctx.stroke(); }
    // Dock and the angler.
    ctx.fillStyle = '#6b4a2b';
    for (const x of [30, 90, 150]) ctx.fillRect(x, SURF - 30, 10, 190);
    ctx.fillStyle = '#9a6a3a'; ctx.fillRect(0, SURF - 40, DOCK_X + 10, 14);
    ctx.fillStyle = '#7a5230'; for (let x = 0; x < DOCK_X + 10; x += 22) ctx.fillRect(x, SURF - 40, 2, 14);
    const ax = 120, ay = SURF - 40;
    ctx.fillStyle = '#2f6fd6'; Gfx.roundRect(ctx, ax - 10, ay - 46, 22, 30, 6); ctx.fill();
    ctx.fillStyle = '#3a3a4a'; ctx.fillRect(ax - 8, ay - 18, 7, 18); ctx.fillRect(ax + 3, ay - 18, 7, 18);
    ctx.fillStyle = '#ffcf9e'; ctx.beginPath(); ctx.arc(ax + 1, ay - 56, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e0a040'; ctx.beginPath(); ctx.ellipse(ax + 1, ay - 62, 16, 4, 0, 0, TAU); ctx.fill(); ctx.fillRect(ax - 7, ay - 72, 16, 10);
    // Rod: bends with tension.
    const bend = phase === 'fight' ? tension * 40 : phase === 'charge' ? -charge * 30 : 0;
    const tipX = DOCK_X + 34 - bend * 0.3, tipY = 168 + bend;
    ctx.strokeStyle = '#3a2614'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ax + 8, ay - 36); ctx.quadraticCurveTo(ax + 40, ay - 90, tipX, tipY); ctx.stroke();
    // Line.
    if (lure) {
      ctx.strokeStyle = phase === 'fight' && tension > 0.8 ? '#ff6b6b' : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.2;
      const sag = phase === 'fight' ? (1 - tension) * 40 : 30;
      const floating = phase === 'out';
      const by = floating ? SURF - 2 + Math.sin(time * 3) * 1.5 + lure.tug * 8 : lure.y;
      const endY = floating ? by : lure.y;
      ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.quadraticCurveTo((tipX + lure.x) / 2, Math.max(tipY, endY) - 10 + sag, lure.x, endY); ctx.stroke();
      if (floating) { ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.moveTo(lure.x, by); ctx.lineTo(lure.x, lure.y); ctx.stroke(); }
      // Bobber at the surface, the lure under it.
      if (phase === 'out' || phase === 'cast') {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(lure.x, by, 5, 0, Math.PI); ctx.fill();
        ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(lure.x, by, 5, Math.PI, 0); ctx.fill();
      }
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(lure.x, lure.y, 3, 0, TAU); ctx.fill();
      if (bite) Gfx.text(ctx, '!', lure.x, SURF - 30 - Math.sin(time * 20) * 3, { size: 30, color: '#ffd23f', width: 5 });
    }
    fx.draw(ctx);
    floats.draw(ctx);
    ctx.restore();
    drawHud();
  }

  function drawHud() {
    if (state === 'menu') return;
    // Daylight left.
    const left = Math.max(0, DAY - dayT);
    Gfx.card(ctx, W / 2 - 130, 10, 260, 34);
    Gfx.bar(ctx, W / 2 - 120, 16, 240, 8, left / DAY, left < 30 ? '#ff9a6a' : '#ffd23f');
    Gfx.text(ctx, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} till sunset · ${score} pts`, W / 2, 34, { size: 12, stroke: null });
    if (phase === 'charge') {
      Gfx.card(ctx, 40, 90, 220, 34);
      Gfx.bar(ctx, 50, 100, 200, 14, charge, charge > 0.85 ? '#ff7a45' : '#3ccf8e');
      Gfx.text(ctx, 'Let go to cast', 150, 138, { size: 12 });
    }
    if (phase === 'fight') {
      // Tension gauge: keep it out of the red, and don't let it go slack.
      const x = W - 60, y = 80, h = 260;
      Gfx.card(ctx, x - 22, y - 30, 44, h + 60);
      const g = ctx.createLinearGradient(0, y + h, 0, y);
      g.addColorStop(0, '#4f8cff'); g.addColorStop(0.15, '#3ccf8e'); g.addColorStop(0.75, '#ffd23f'); g.addColorStop(1, '#ff4d4d');
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x - 8, y, 16, h);
      ctx.fillStyle = g; const th = clamp(tension, 0, 1) * h; ctx.fillRect(x - 8, y + h - th, 16, th);
      Gfx.text(ctx, 'Line', x, y - 14, { size: 11, stroke: null });
      Gfx.bar(ctx, x - 14, y + h + 10, 28, 6, hooked.stamina, '#ff9a6a');
      Gfx.text(ctx, held ? 'Reeling' : 'Easing off', W / 2, H - 20, { size: 14, color: tension > 0.8 ? '#ff6b6b' : '#fff' });
    } else if (phase === 'idle') Gfx.text(ctx, 'Hold Space (or click) to cast', W / 2, H - 20, { size: 14 });
    else if (phase === 'out') Gfx.text(ctx, bite ? 'BITE! Press now!' : 'Wait for the real bite (nibbles don\'t count) · hold to reel in', W / 2, H - 20, { size: 14, color: bite ? '#ffd23f' : '#fff' });
    if (phase !== 'fight') Gfx.text(ctx, `Depth: ${DEPTHS[depthSet].name} (W/S)`, 16, H - 20, { size: 12, align: 'left', color: '#cfe9ff' });
    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      Gfx.text(ctx, banner.text, W / 2, 120, { size: 28, color: banner.color, width: 5 });
      if (banner.sub) Gfx.text(ctx, banner.sub, W / 2, 152, { size: 15 });
      ctx.globalAlpha = 1;
    }
    // Today's catch.
    catchList.slice(-6).forEach((c, i) => Gfx.text(ctx, `${c.sp.name} ${c.len.toFixed(0)} cm`, 16, 66 + i * 18, { size: 11, align: 'left', color: c.sp.color }));
  }

  function updateHud() {
    $('score').textContent = score;
    $('fish').textContent = catchList.length;
    $('coins').textContent = save.coins.toLocaleString();
  }

  // ---------- Tackle shop and journal ----------

  function menuHtml() {
    const ups = UPGRADES.map(u => {
      const lv = save.up[u.id], cost = u.costs[lv];
      return `<button class="btn secondary" type="button" data-up="${u.id}" ${cost === undefined || save.coins < cost ? 'disabled' : ''}>${u.name} ${'●'.repeat(lv)}${'○'.repeat(u.costs.length - lv)}<small>${cost === undefined ? 'Maxed out' : `${u.desc} · ${cost} coins`}</small></button>`;
    }).join('');
    const journal = SPECIES.map(s => { const j = save.journal[s.id]; return `<span style="opacity:${j ? 1 : 0.4}"><b style="color:${j ? s.color : 'inherit'}">${j ? s.name : '???'}</b>${j ? ` ${j.best.toFixed(0)} cm` : ''}</span>`; }).join('');
    return `<p>Fish off the dock until sunset. Hold to charge a cast, wait out the nibbles, hook the real bite, then reel: hold to pull, ease off before the line turns red.</p>
      <p style="font-size:13px">🪙 <b>${save.coins.toLocaleString()} coins</b></p>
      <div class="ll-shop">${ups}</div>
      <p style="font-size:12px;color:var(--muted);margin:8px 0 4px">Journal: ${Object.keys(save.journal).length} of ${SPECIES.length} kinds (glow eels only come out at dusk)</p>
      <div class="ll-journal">${journal}</div>`;
  }
  function wireMenu(p) {
    p.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
      const u = UPGRADES.find(x => x.id === b.dataset.up), cost = u.costs[save.up[u.id]];
      if (cost === undefined || save.coins < cost) return;
      save.coins -= cost; save.up[u.id]++;
      Arcade.save(SAVE, save);
      Arcade.tone({ freq: 600, to: 900, dur: 0.12, type: 'triangle', vol: 0.05 });
      if (Object.values(save.up).every(v => v >= 4)) Arcade.flag('lazy-lake-maxed');
      showMenu();
    }));
  }
  const intro = () => ({ title: '🎣 Lazy Lake', html: menuHtml(), button: 'Head to the dock', onAction: start, onRender: wireMenu });
  function showMenu() { state = 'menu'; ui.show(intro()); updateHud(); }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'play' && (overlayEl.hidden || (typeof Versus !== 'undefined' && Versus.active()))) update(dt);
    else { time += dt; updateFish(dt * 0.5); fx.update(dt); }
    draw();
    requestAnimationFrame(frame);
  }

  for (let i = 0; i < 9; i++) { spawnFish(); fish[i].x = 220 + Math.random() * 700; }
  updateHud();
  Versus.attach({ ui, start, score: () => score, intro: intro() });
  requestAnimationFrame(frame);
})();
