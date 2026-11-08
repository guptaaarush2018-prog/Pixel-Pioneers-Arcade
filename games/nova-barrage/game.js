(() => {
  const ID = 'nova-barrage';
  const W = 540, H = 720;
  const TAU = Math.PI * 2;
  const SECTOR_LEN = 62;   // seconds of waves before the boss (the clock stops while a mid-boss is up)
  const MID_AT = 30, MID_TIMEOUT = 24;
  const HIT_R = 3, GRAZE_R = 22, PICK_R = 64;
  const MAX_BULLETS = 700, MAX_STARS = 450, MAX_SPARKS = 500;
  const BOMBS = 3;
  const CHOICE_KEY = 'nova:diff';

  const DIFFS = {
    easy: { name: 'Easy', speed: 0.78, density: 0.7, lives: 4, score: 0.6 },
    normal: { name: 'Normal', speed: 1, density: 1, lives: 3, score: 1 },
    hard: { name: 'Hard', speed: 1.15, density: 1.3, lives: 3, score: 1.6 },
  };
  const SECTORS = [
    { name: 'Outer Belt', sky: ['#05070f', '#0e1a33'], accent: '#3ef0ff' },
    { name: 'Ember Reach', sky: ['#0f0507', '#331014'], accent: '#ff7a45' },
    { name: 'Crystal Drift', sky: ['#04090c', '#0d2a2e'], accent: '#5cf2c0' },
    { name: 'Storm Front', sky: ['#07051a', '#1e1240'], accent: '#b388ff' },
    { name: 'Nova Core', sky: ['#120509', '#3a0b2a'], accent: '#ffd23f' },
  ];
  const BULLET_COLORS = { a: '#ff4fd8', b: '#3ef0ff', c: '#ffd23f', d: '#ff7a45', e: '#7ed957' };

  const UPGRADES = [
    { id: 'spread', name: 'Spread shot', desc: 'Two more angled bolts. Hold Shift to tighten them.', max: 3 },
    { id: 'heavy', name: 'Heavy rounds', desc: 'Every shot hits 30% harder.', max: 3 },
    { id: 'drones', name: 'Wing drones', desc: 'A pair of drones that fire alongside you.', max: 2 },
    { id: 'missiles', name: 'Homing missiles', desc: 'Missiles that chase the nearest enemy.', max: 3 },
    { id: 'shield', name: 'Deflector', desc: 'Blocks one hit. Recharges at the start of every sector.', max: 2 },
    { id: 'magnet', name: 'Star magnet', desc: 'Pull stars in from much further away.', max: 1 },
    { id: 'bomb', name: 'Bomb bay', desc: 'One more bomb now, and one more each time you refill.', max: 2 },
    { id: 'life', name: 'Spare hull', desc: 'One extra life.', max: 2 },
  ];

  // Enemy guns use the patterns below. `first` is the delay before the first shot.
  const TYPES = {
    dart: { hp: 2, r: 11, value: 100, stars: 1, color: '#7fdbff', guns: [{ p: 'aimed', every: 2.2, n: 1, spread: 0, spd: 170, r: 5, c: 'a', first: 0.7 }] },
    wing: { hp: 5, r: 14, value: 200, stars: 2, color: '#b388ff', guns: [{ p: 'aimed', every: 1.7, n: 3, spread: 0.28, spd: 150, r: 5, c: 'b', first: 0.9 }] },
    turret: { hp: 14, r: 19, value: 500, stars: 4, color: '#ffd23f', guns: [{ p: 'ring', every: 1.6, n: 10, grow: true, spin: 0.17, spd: 115, r: 6, c: 'c', first: 1.3 }] },
    spinner: { hp: 18, r: 19, value: 700, stars: 5, color: '#ff7a45', guns: [{ p: 'spiral', every: 0.14, arms: 2, spin: 0.33, spd: 120, r: 5, c: 'd', first: 1.4 }] },
    brute: { hp: 60, r: 30, value: 2000, stars: 10, color: '#5cf2c0', guns: [
      { p: 'aimed', every: 1.4, n: 5, spread: 0.15, spd: 180, r: 6, c: 'a', first: 1.6 },
      { p: 'ring', every: 3, n: 16, grow: true, spin: 0.09, spd: 100, r: 7, c: 'e', first: 2.4 },
    ] },
    guard: { hp: 170, r: 34, value: 5000, stars: 20, color: '#ff4fd8', blocker: true, guns: [
      { p: 'flower', every: 1.5, n: 10, grow: true, spin: 0.15, spd: 135, r: 6, c: 'b', first: 1.6 },
      { p: 'aimed', every: 1, n: 3, spread: 0.2, spd: 200, r: 5, c: 'a', first: 2.2 },
    ] },
  };

  // One boss per sector. Each phase is a set of guns; the phase changes as its health drops.
  const BOSSES = [
    { name: 'Gatekeeper', hp: 320, color: '#3ef0ff', sides: 6, phases: [
      [{ p: 'ring', every: 1.1, n: 16, spin: 0.2, spd: 130, r: 6, c: 'b' }, { p: 'aimed', every: 1.6, n: 3, spread: 0.2, spd: 195, r: 5, c: 'a' }],
      [{ p: 'spiral', every: 0.09, arms: 3, spin: 0.21, spd: 140, r: 5, c: 'c' }],
      [{ p: 'flower', every: 1.2, n: 14, spin: 0.12, spd: 145, r: 6, c: 'b' }, { p: 'aimed', every: 1, n: 5, spread: 0.14, spd: 210, r: 5, c: 'a' }],
    ] },
    { name: 'Spindle', hp: 440, color: '#ff7a45', sides: 4, phases: [
      [{ p: 'spiral', every: 0.09, arms: 4, spin: 0.15, spd: 130, r: 5, c: 'd' }, { p: 'spiral', every: 0.12, arms: 3, spin: -0.19, spd: 105, r: 6, c: 'c' }],
      [{ p: 'wall', every: 1.2, gap: 66, step: 30, spd: 115, r: 6, c: 'd' }, { p: 'aimed', every: 1.3, n: 3, spread: 0.25, spd: 185, r: 5, c: 'a' }],
      [{ p: 'ring', every: 0.65, n: 18, spin: 0.11, spd: 150, r: 6, c: 'c' }, { p: 'spiral', every: 0.11, arms: 2, spin: 0.4, spd: 115, r: 5, c: 'd' }],
    ] },
    { name: 'Prism', hp: 560, color: '#5cf2c0', sides: 3, phases: [
      [{ p: 'rain', every: 0.28, n: 2, spd: 145, r: 5, c: 'e' }, { p: 'aimed', every: 1.1, n: 7, spread: 0.13, spd: 175, r: 5, c: 'b' }],
      [{ p: 'flower', every: 0.95, n: 16, spin: 0.2, spd: 150, r: 6, c: 'e' }],
      [{ p: 'spiral', every: 0.07, arms: 5, spin: 0.09, spd: 135, r: 5, c: 'b' }, { p: 'aimed', every: 1.5, n: 3, spread: 0.2, spd: 230, r: 8, c: 'a' }],
    ] },
    { name: 'Tempest', hp: 700, color: '#b388ff', sides: 5, phases: [
      [{ p: 'rain', every: 0.2, n: 2, spd: 165, r: 5, c: 'b' }, { p: 'ring', every: 1.4, n: 22, spin: 0.07, spd: 120, r: 6, c: 'a' }],
      [{ p: 'wall', every: 1, gap: 60, step: 28, spd: 130, r: 6, c: 'b' }, { p: 'spiral', every: 0.12, arms: 3, spin: 0.27, spd: 125, r: 5, c: 'c' }],
      [{ p: 'flower', every: 0.8, n: 18, spin: 0.15, spd: 160, r: 6, c: 'a' }, { p: 'aimed', every: 0.85, n: 5, spread: 0.16, spd: 220, r: 5, c: 'c' }],
    ] },
    { name: 'The Nova Core', hp: 900, color: '#ffd23f', sides: 8, phases: [
      [{ p: 'ring', every: 0.9, n: 20, spin: 0.13, spd: 135, r: 6, c: 'c' }, { p: 'aimed', every: 1.1, n: 5, spread: 0.16, spd: 210, r: 5, c: 'a' }],
      [{ p: 'spiral', every: 0.08, arms: 4, spin: 0.14, spd: 135, r: 5, c: 'd' }, { p: 'spiral', every: 0.08, arms: 4, spin: -0.14, spd: 110, r: 5, c: 'c' }],
      [{ p: 'wall', every: 1.1, gap: 62, step: 30, spd: 125, r: 6, c: 'c' }, { p: 'rain', every: 0.3, n: 2, spd: 150, r: 5, c: 'd' }],
      [{ p: 'flower', every: 0.9, n: 18, spin: 0.17, spd: 155, r: 6, c: 'c' }, { p: 'spiral', every: 0.12, arms: 3, spin: 0.25, spd: 120, r: 5, c: 'a' }, { p: 'aimed', every: 1.2, n: 3, spread: 0.2, spd: 230, r: 7, c: 'd' }],
    ] },
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';   // 'play' | 'paused' | 'pick' | 'over'
  let diff = Arcade.load(CHOICE_KEY, 'normal');
  if (!DIFFS[diff]) diff = 'normal';
  let D = DIFFS[diff];
  let seed, sector, plan, waveIdx, sclock, warnT, clearT, overT;
  let p, shots, missiles, bullets, enemies, boss, stars, sparks, rings, banner;
  let score, heat, heatHold, maxMult, lives, bombs, bombT, shield, up, grazes, bossesBeaten;
  let hitSector, hitBoss, bombBoss, graze500, lastGrazeSound = 0;
  const keys = new Set();
  const pool = [];

  // ---------- Helpers ----------

  function seeded(s) {
    let a = s >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const si = () => sector % SECTORS.length;           // which of the five sectors
  const loop = () => Math.floor(sector / SECTORS.length); // how many times round
  const level = () => si() + loop() * 2;
  const spdMul = () => D.speed * (1 + 0.05 * si() + 0.1 * loop());
  const rateMul = () => D.density * (1 + 0.1 * si() + 0.2 * loop());
  const hpMul = () => 1 + 0.3 * level();
  const mult = () => 1 + heat / 25;
  const addScore = n => { score += Math.round(n * mult() * D.score); };
  const addFlat = n => { score += Math.round(n * D.score); };
  const sectorName = () => (loop() ? `Deep Space ${sector + 1}` : SECTORS[si()].name);
  const skin = () => Arcade.equipped('nova-ship')?.colors || ['#3ef0ff', '#e8f6ff'];

  // ---------- Run setup ----------

  function begin(d) {
    if (d) { diff = d; D = DIFFS[d]; } else D = DIFFS[diff];
    // Math.random is seeded by versus.js during a duel, so both players get the same seed and
    // with it the same waves and upgrade offers.
    seed = Math.floor(Math.random() * 2 ** 31);
    sector = 0;
    p = { x: W / 2, y: H - 90, inv: 2, cd: 0, mcd: 0, vol: 0, dead: false };
    shots = []; missiles = []; bullets.length = 0; enemies = []; boss = null; stars = []; sparks = []; rings = [];
    score = 0; heat = 0; heatHold = 0; maxMult = 1; lives = D.lives; bombs = BOMBS; bombT = 0; grazes = 0; bossesBeaten = 0;
    up = Object.fromEntries(UPGRADES.map(u => [u.id, 0]));
    graze500 = false;
    startSector();
    state = 'play';
    ui.hide();
  }
  bullets = [];

  function startSector() {
    plan = makePlan();
    waveIdx = 0;
    sclock = 0;
    warnT = -1;
    clearT = -1;
    boss = null;
    hitSector = false;
    shield = up.shield;
    banner = { text: sectorName(), sub: loop() ? `Loop ${loop() + 1} · everything is tougher` : `Sector ${sector + 1}`, t: 2.6 };
  }

  // The sector's waves, from its own seed so they don't depend on how the run has gone.
  function makePlan() {
    const r = seeded(seed + sector * 7919);
    const lv = level();
    const weights = {
      column: 3, vee: 3, sweep: 2 + lv * 0.3, wings: 2, turrets: 1 + lv * 0.5,
      spinner: lv >= 1 ? 0.6 + lv * 0.4 : 0, mixed: lv >= 1 ? 1 : 0, brute: lv >= 2 ? 0.3 + lv * 0.25 : 0,
    };
    const heavy = { turrets: 1, spinner: 1, mixed: 1, brute: 1 };
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    const roll = () => {
      let x = r() * total;
      for (const [k, w] of Object.entries(weights)) if ((x -= w) < 0) return k;
      return 'column';
    };
    const gap = Math.max(1.5, 3.1 - lv * 0.3);
    const list = [];
    let t = 2.5, last = '';
    while (t < SECTOR_LEN) {
      if (t >= MID_AT && !list.some(w => w.kind === 'mid')) {
        list.push({ at: MID_AT, kind: 'mid' });
        t = MID_AT + 2;
        continue;
      }
      let kind = roll();
      if (kind === last) kind = roll();
      last = kind;
      list.push({ at: t, kind, x: r(), side: r() < 0.5 ? -1 : 1 });
      t += gap * (0.8 + r() * 0.5) * (heavy[kind] ? 1.7 : 1);
    }
    return list.sort((a, b) => a.at - b.at);
  }

  // ---------- Enemies ----------

  function spawn(type, o) {
    const T = TYPES[type];
    const hp = T.hp * hpMul();
    enemies.push({
      type, T, hp, max: hp, r: T.r, x: o.x, y: o.y, x0: o.x, y0: o.y, t: 0,
      move: o.move, vx: o.vx || 0, vy: o.vy || 0, ty: o.ty, hold: o.hold || 0,
      ang: o.ang || 0, spd: o.spd || 0, turn: o.turn || 0, sway: !!o.sway,
      guns: T.guns.map(g => ({ k: g, cd: g.first, s: {} })), flash: 0, blocker: !!T.blocker, spin: 0,
    });
  }

  const FORMS = {
    column: w => { for (let i = 0; i < 5; i++) spawn('dart', { x: 60 + w.x * (W - 120), y: -20 - i * 44, move: 'line', vy: 210 }); },
    vee: w => {
      const cx = 120 + w.x * (W - 240);
      for (let i = 0; i < 5; i++) spawn('dart', { x: cx + (i - 2) * 42, y: -20 - Math.abs(i - 2) * 36, move: 'line', vy: 190 });
    },
    sweep: w => {
      for (let i = 0; i < 6; i++) {
        spawn('dart', { x: w.side < 0 ? -20 - i * 42 : W + 20 + i * 42, y: 70 + w.x * 140 + i * 6, move: 'line', vx: -w.side * 230, vy: 35 });
      }
    },
    wings: w => {
      for (let i = 0; i < 4; i++) {
        spawn('wing', { x: w.side < 0 ? -30 - i * 50 : W + 30 + i * 50, y: 50 + i * 18, move: 'arc', ang: w.side < 0 ? 0.3 : Math.PI - 0.3, spd: 190, turn: (w.side < 0 ? 1 : -1) * 0.75 });
      }
    },
    turrets: () => {
      spawn('turret', { x: W * 0.27, y: -30, move: 'stop', ty: 150, hold: 6 });
      spawn('turret', { x: W * 0.73, y: -30, move: 'stop', ty: 150, hold: 6 });
    },
    spinner: w => spawn('spinner', { x: 140 + w.x * (W - 280), y: -30, move: 'stop', ty: 170, hold: 5 }),
    mixed: w => { FORMS.vee(w); spawn('turret', { x: W / 2, y: -60, move: 'stop', ty: 120, hold: 6 }); },
    brute: w => spawn('brute', { x: 150 + w.x * (W - 300), y: -40, move: 'stop', ty: 160, hold: 11 }),
    mid: () => {
      spawn('guard', { x: W / 2, y: -50, move: 'stop', ty: 150, hold: MID_TIMEOUT, sway: true });
      banner = { text: 'Guardian', sub: 'Waves pause until it falls', t: 2 };
    },
  };

  function spawnBoss() {
    const B = BOSSES[si()];
    const hp = B.hp * (1 + loop() * 0.9);
    boss = { B, hp, max: hp, x: W / 2, y: -90, t: 0, phase: 0, inv: 2.6, flash: 0, guns: B.phases[0].map(k => ({ k, cd: 1, s: {} })), spin: 0 };
    hitBoss = false;
    bombBoss = false;
    Arcade.tone({ freq: 110, to: 55, dur: 0.8, type: 'sawtooth', vol: 0.06 });
  }

  // ---------- Bullets ----------

  function fire(x, y, ang, spd, r = 5, c = 'a') {
    if (bullets.length >= MAX_BULLETS) return;
    const b = pool.pop() || {};
    const s = spd * spdMul();
    b.x = x; b.y = y; b.vx = Math.cos(ang) * s; b.vy = Math.sin(ang) * s; b.r = r; b.c = c; b.g = false;
    bullets.push(b);
  }
  const aim = e => Math.atan2(p.y - e.y, p.x - e.x);

  const PAT = {
    aimed(e, k) {
      const a = aim(e);
      for (let i = 0; i < k.n; i++) fire(e.x, e.y, a + (i - (k.n - 1) / 2) * k.spread, k.spd, k.r, k.c);
    },
    ring(e, k, s) {
      s.rot = (s.rot || Math.PI / 2) + (k.spin || 0);
      const n = k.n + (k.grow ? Math.min(6, level()) : 0);
      for (let i = 0; i < n; i++) fire(e.x, e.y, s.rot + (i * TAU) / n, k.spd, k.r, k.c);
    },
    spiral(e, k, s) {
      s.rot = (s.rot || 0) + k.spin;
      for (let i = 0; i < k.arms; i++) fire(e.x, e.y, s.rot + (i * TAU) / k.arms, k.spd, k.r, k.c);
    },
    flower(e, k, s) {
      s.rot = (s.rot || 0) + (k.spin || 0);
      const n = k.n + (k.grow ? Math.min(6, level()) : 0);
      for (let i = 0; i < n; i++) {
        fire(e.x, e.y, s.rot + (i * TAU) / n, k.spd, k.r, k.c);
        fire(e.x, e.y, s.rot + ((i + 0.5) * TAU) / n, k.spd * 0.6, k.r, k.c);
      }
    },
    // A row of bullets across the top with a gap that slides back and forth.
    wall(e, k, s) {
      s.t = (s.t || 0) + 1;
      const gap = W / 2 + Math.sin(s.t * 0.9) * (W / 2 - 90);
      for (let x = 14; x < W; x += k.step) if (Math.abs(x - gap) > k.gap) fire(x, -6, Math.PI / 2, k.spd, k.r, k.c);
    },
    rain(e, k) {
      for (let i = 0; i < k.n; i++) fire(Math.random() * W, -6, Math.PI / 2 + (Math.random() - 0.5) * 0.3, k.spd * (0.7 + Math.random() * 0.6), k.r, k.c);
    },
  };

  function runGuns(e, dt) {
    for (const g of e.guns) {
      g.cd -= dt;
      let n = 0;
      while (g.cd <= 0 && n++ < 3) {
        PAT[g.k.p](e, g.k, g.s);
        g.cd += g.k.every / rateMul();
      }
    }
  }

  // Turns every enemy bullet into a star worth a little, pulled straight to the ship.
  function cashBullets(val = 10) {
    for (const b of bullets) {
      if (stars.length < MAX_STARS) stars.push({ x: b.x, y: b.y, vx: 0, vy: -40, val, pull: true });
      else addScore(val);
      pool.push(b);
    }
    bullets.length = 0;
  }

  function clearNear(radius) {
    let j = 0;
    for (const b of bullets) {
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < radius * radius) { pool.push(b); burst(b.x, b.y, BULLET_COLORS[b.c], 2, 60); }
      else bullets[j++] = b;
    }
    bullets.length = j;
  }

  // ---------- Effects ----------

  function burst(x, y, color, n, speed = 160) {
    for (let i = 0; i < n && sparks.length < MAX_SPARKS; i++) {
      const a = Math.random() * TAU, s = speed * (0.3 + Math.random());
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.3 + Math.random() * 0.4, color });
    }
  }

  // ---------- Player ----------

  function shoot(x, y, ang, dmg) {
    shots.push({ x, y, vx: Math.sin(ang) * 960, vy: -Math.cos(ang) * 960, dmg });
  }

  function drones() {
    const out = [];
    if (up.drones >= 1) out.push([p.x - 32, p.y + 8], [p.x + 32, p.y + 8]);
    if (up.drones >= 2) out.push([p.x - 56, p.y + 22], [p.x + 56, p.y + 22]);
    return out;
  }

  function playerFire(dt) {
    const focus = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const dmg = 1 + 0.3 * up.heavy;
    p.cd -= dt;
    while (p.cd <= 0) {
      p.cd += 0.085;
      p.vol++;
      shoot(p.x - 7, p.y - 14, 0, dmg);
      shoot(p.x + 7, p.y - 14, 0, dmg);
      for (let i = 1; i <= up.spread; i++) {
        const a = i * (focus ? 0.045 : 0.13);
        shoot(p.x - 5, p.y - 10, -a, dmg * 0.8);
        shoot(p.x + 5, p.y - 10, a, dmg * 0.8);
      }
      if (p.vol % 2 === 0) for (const [x, y] of drones()) shoot(x, y - 6, 0, dmg * 0.8);
    }
    if (up.missiles) {
      p.mcd -= dt;
      if (p.mcd <= 0) {
        p.mcd = 1 / up.missiles;
        for (const s of [-1, 1]) missiles.push({ x: p.x + s * 12, y: p.y, vx: s * 160, vy: -180, t: 0, dmg: 2.5 * (1 + 0.3 * up.heavy) });
      }
    }
  }

  function bomb() {
    if (state !== 'play' || p.dead || bombs <= 0 || bombT > 0) return;
    bombs--;
    bombT = 1.4;
    p.inv = Math.max(p.inv, 1.8);
    heat *= 0.5;
    if (boss) bombBoss = true;
    cashBullets(10);
    for (const e of enemies) damage(e, 40);
    if (boss && boss.inv <= 0) damageBoss(60);
    rings.push({ x: p.x, y: p.y, t: 0, life: 0.9, max: 700, color: skin()[0] });
    Arcade.tone({ freq: 140, to: 30, dur: 0.7, type: 'sawtooth', vol: 0.08 });
  }

  function hurt() {
    if (p.inv > 0 || bombT > 0 || p.dead) return;
    if (shield > 0) {
      shield--;
      p.inv = 1.5;
      clearNear(140);
      rings.push({ x: p.x, y: p.y, t: 0, life: 0.5, max: 140, color: '#7fdbff' });
      Arcade.tone({ freq: 600, to: 300, dur: 0.25, type: 'triangle', vol: 0.06 });
      return;
    }
    lives--;
    hitSector = true;
    hitBoss = true;
    heat = 0;
    p.inv = 2.6;
    bombs = Math.max(bombs, BOMBS + up.bomb);
    clearNear(200);
    burst(p.x, p.y, skin()[0], 40, 260);
    rings.push({ x: p.x, y: p.y, t: 0, life: 0.6, max: 200, color: '#ff6b6b' });
    Arcade.tone({ freq: 300, to: 40, dur: 0.6, type: 'sawtooth', vol: 0.08 });
    if (lives <= 0) {
      p.dead = true;
      overT = 1.6;
    }
  }

  // ---------- Damage and kills ----------

  function damage(e, n) {
    if (e.hp <= 0) return;
    e.hp -= n;
    e.flash = 0.06;
    if (e.hp <= 0) kill(e);
  }

  function kill(e) {
    addScore(e.T.value);
    heat = Math.min(100, heat + (e.blocker ? 10 : e.T.value >= 500 ? 3 : 1));
    for (let i = 0; i < e.T.stars && stars.length < MAX_STARS; i++) {
      stars.push({ x: e.x + (Math.random() - 0.5) * e.r * 2, y: e.y + (Math.random() - 0.5) * e.r, vx: (Math.random() - 0.5) * 120, vy: -80 - Math.random() * 80, val: 30 });
    }
    burst(e.x, e.y, e.T.color, e.blocker ? 50 : e.r > 20 ? 24 : 12, e.blocker ? 260 : 180);
    if (e.blocker) {
      cashBullets(15);
      rings.push({ x: e.x, y: e.y, t: 0, life: 0.7, max: 300, color: e.T.color });
    }
    Arcade.tone({ freq: e.r > 20 ? 160 : 260, to: 50, dur: e.r > 20 ? 0.3 : 0.12, type: 'square', vol: 0.03 });
  }

  function damageBoss(n) {
    if (!boss || boss.inv > 0 || boss.hp <= 0) return;
    boss.hp -= n;
    boss.flash = 0.05;
    const phases = boss.B.phases.length;
    const ph = Math.min(phases - 1, Math.floor((1 - boss.hp / boss.max) * phases));
    if (boss.hp <= 0) return bossDown();
    if (ph !== boss.phase) {
      boss.phase = ph;
      boss.inv = 1.2;
      boss.guns = boss.B.phases[ph].map(k => ({ k, cd: 1.2, s: {} }));
      cashBullets(10);
      rings.push({ x: boss.x, y: boss.y, t: 0, life: 0.6, max: 260, color: boss.B.color });
      Arcade.tone({ freq: 330, to: 660, dur: 0.25, type: 'triangle', vol: 0.06 });
    }
  }

  function bossDown() {
    const b = boss;
    const n = sector + 1;
    bossesBeaten++;
    Arcade.flag('nova-barrage-win');
    addFlat(5000 * n);
    if (!bombBoss) addFlat(3000 * n);
    if (!bombBoss && !hitBoss) Arcade.flag('nova-barrage-nobomb');
    if (!hitSector) { addFlat(5000 * n); Arcade.flag('nova-barrage-flawless'); }
    if (sector === SECTORS.length - 1) Arcade.flag('nova-barrage-clear');
    b.summary = [
      `Boss bonus +${Math.round(5000 * n * D.score).toLocaleString()}`,
      !bombBoss ? `No bombs +${Math.round(3000 * n * D.score).toLocaleString()}` : '',
      !hitSector ? `Untouched sector +${Math.round(5000 * n * D.score).toLocaleString()}` : '',
    ].filter(Boolean);
    cashBullets(20);
    for (const s of stars) s.pull = true;
    for (const e of enemies) if (e.hp > 0) kill(e);
    enemies = [];
    burst(b.x, b.y, b.B.color, 120, 340);
    rings.push({ x: b.x, y: b.y, t: 0, life: 1, max: 600, color: b.B.color });
    Arcade.tone({ freq: 523, to: 1046, dur: 0.6, type: 'triangle', vol: 0.07 });
    Arcade.tone({ freq: 659, to: 1318, dur: 0.6, type: 'triangle', vol: 0.05, delay: 0.15 });
    clearT = 2.8;
    banner = { text: `${b.B.name} down!`, sub: sectorName() + ' clear', t: 2.6 };
    boss = { ...b, hp: 0, gone: true };
  }

  // ---------- Upgrades ----------

  function showPick() {
    state = 'pick';
    const r = seeded(seed + sector * 131);
    const open = UPGRADES.filter(u => up[u.id] < u.max);
    const offers = [];
    while (offers.length < 3 && open.length) {
      // Spare hulls turn up less often.
      let i = Math.floor(r() * open.length);
      if (open[i].id === 'life' && r() < 0.5) i = Math.floor(r() * open.length);
      offers.push(open.splice(i, 1)[0]);
    }
    const summary = boss?.summary || [];
    if (!offers.length) {
      addFlat(10000);
      return nextSector();
    }
    ui.show({
      title: `${sectorName()} clear`,
      html: `${summary.map(l => `<p>${l}</p>`).join('')}
        <p>Choose an upgrade${offers.length > 1 ? ` (keys 1–${offers.length})` : ''}:</p>
        <div class="menu">${offers.map((u, i) => `<button class="btn ${i ? 'secondary' : ''}" type="button" data-up="${u.id}" style="text-align:left">
          <b>${i + 1}. ${u.name}</b>${u.max > 1 ? ` · level ${up[u.id] + 1}` : ''}<br><small>${u.desc}</small></button>`).join('')}</div>`,
      button: null,
      onRender: panel => panel.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => choose(b.dataset.up))),
    });
    showPick.offers = offers;
  }

  function choose(id) {
    if (state !== 'pick') return;
    up[id]++;
    if (id === 'bomb') bombs++;
    if (id === 'life') lives++;
    if (id === 'shield') shield = up.shield;
    nextSector();
  }

  function nextSector() {
    sector++;
    startSector();
    p.inv = 2;
    state = 'play';
    ui.hide();
  }

  // ---------- Update ----------

  function update(dt) {
    p.inv = Math.max(0, p.inv - dt);
    bombT = Math.max(0, bombT - dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }

    // Move.
    if (!p.dead) {
      const focus = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const sp = focus ? 140 : 320;
      let mx = 0, my = 0;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) mx--;
      if (keys.has('ArrowRight') || keys.has('KeyD')) mx++;
      if (keys.has('ArrowUp') || keys.has('KeyW')) my--;
      if (keys.has('ArrowDown') || keys.has('KeyS')) my++;
      if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
      p.x = clamp(p.x + mx * sp * dt, 14, W - 14);
      p.y = clamp(p.y + my * sp * dt, 40, H - 24);
      if (clearT < 0) playerFire(dt);
    }

    // Heat cools off unless you keep grazing and killing.
    if (heatHold > 0) heatHold -= dt;
    else heat = Math.max(0, heat - 6 * dt);
    maxMult = Math.max(maxMult, mult());

    // Waves.
    if (!boss) {
      if (!enemies.some(e => e.blocker && e.hp > 0)) sclock += dt;
      while (waveIdx < plan.length && plan[waveIdx].at <= sclock) FORMS[plan[waveIdx].kind](plan[waveIdx++]);
      if (waveIdx >= plan.length && sclock >= SECTOR_LEN) {
        if (warnT < 0) {
          warnT = 3.2;
          banner = { text: 'WARNING', sub: `${BOSSES[si()].name} approaching`, t: 3, warn: true };
          Arcade.tone({ freq: 220, dur: 0.25, type: 'square', vol: 0.05 });
          Arcade.tone({ freq: 220, dur: 0.25, type: 'square', vol: 0.05, delay: 0.5 });
        }
        warnT -= dt;
        if (warnT <= 0) spawnBoss();
      }
    }

    // Enemies.
    for (const e of enemies) {
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
      e.spin += dt;
      let armed = true;
      if (e.move === 'line') { e.x += e.vx * dt; e.y += e.vy * dt; }
      else if (e.move === 'arc') {
        e.ang += e.turn * dt;
        e.x += Math.cos(e.ang) * e.spd * dt;
        e.y += Math.sin(e.ang) * e.spd * dt;
      } else if (e.move === 'stop') {
        if (e.t < 1.2) { const k = e.t / 1.2; e.y = e.y0 + (e.ty - e.y0) * (1 - (1 - k) ** 3); }
        else if (e.t < 1.2 + e.hold) { if (e.sway) e.x = e.x0 + Math.sin((e.t - 1.2) * 0.6) * 140; }
        else { e.y -= 110 * dt; armed = false; }
      }
      if (armed && e.y > 10 && e.y < H * 0.72 && e.x > 0 && e.x < W) runGuns(e, dt);
      if (!p.dead && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < (e.r * 0.7 + HIT_R) ** 2) hurt();
    }
    enemies = enemies.filter(e => e.hp > 0 && !(e.t > 1.5 && (e.x < -90 || e.x > W + 90 || e.y > H + 60 || e.y < -120)));

    // Boss.
    if (boss && !boss.gone) {
      const b = boss;
      b.t += dt;
      b.inv = Math.max(0, b.inv - dt);
      b.flash = Math.max(0, b.flash - dt);
      b.spin += dt * (0.4 + b.phase * 0.25);
      if (b.t < 2.5) b.y = -90 + (230) * (1 - (1 - b.t / 2.5) ** 3);
      else {
        b.x = W / 2 + Math.sin((b.t - 2.5) * 0.5) * 150;
        b.y = 140 + Math.sin((b.t - 2.5) * 0.8) * 20;
        if (b.inv <= 0 && !p.dead) runGuns(b, dt);
      }
      if (!p.dead && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < (40 + HIT_R) ** 2) hurt();
    }

    // Player shots.
    const targets = boss && !boss.gone ? [...enemies, boss] : enemies;
    let j = 0;
    for (const s of shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      let used = s.y < -20 || s.x < -20 || s.x > W + 20;
      if (!used) {
        for (const e of targets) {
          const r = e === boss ? 44 : e.r;
          if ((s.x - e.x) ** 2 + (s.y - e.y) ** 2 < r * r) {
            if (e === boss) damageBoss(s.dmg); else damage(e, s.dmg);
            used = true;
            if (Math.random() < 0.3) burst(s.x, s.y, '#ffffff', 1, 80);
            break;
          }
        }
      }
      if (!used) shots[j++] = s;
    }
    shots.length = j;

    // Missiles.
    for (const m of missiles) {
      m.t += dt;
      let best = null, bd = Infinity;
      for (const e of boss && !boss.gone ? [...enemies, boss] : enemies) {
        if (e.y < -10) continue;
        const d = (e.x - m.x) ** 2 + (e.y - m.y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (best && m.t > 0.15) {
        const a = Math.atan2(best.y - m.y, best.x - m.x);
        const k = Math.min(1, 5 * dt);
        m.vx += (Math.cos(a) * 560 - m.vx) * k;
        m.vy += (Math.sin(a) * 560 - m.vy) * k;
      } else m.vy -= 600 * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (best && (best.x - m.x) ** 2 + (best.y - m.y) ** 2 < (best === boss ? 44 : best.r) ** 2) {
        if (best === boss) damageBoss(m.dmg); else damage(best, m.dmg);
        burst(m.x, m.y, '#ffb347', 6, 120);
        m.dead = true;
      }
    }
    missiles = missiles.filter(m => !m.dead && m.t < 3 && m.y > -40 && m.y < H + 40 && m.x > -40 && m.x < W + 40);

    // Enemy bullets: hits and grazes.
    j = 0;
    const live = !p.dead && p.inv <= 0 && bombT <= 0;
    let struck = false;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -30 || b.x > W + 30 || b.y < -40 || b.y > H + 30) { pool.push(b); continue; }
      if (!p.dead) {
        const d2 = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
        if (live && d2 < (HIT_R + b.r * 0.7) ** 2) struck = true;
        if (!b.g && d2 < (GRAZE_R + b.r) ** 2) {
          b.g = true;
          grazes++;
          heat = Math.min(100, heat + 2.5);
          heatHold = 1.2;
          addScore(20);
          if (Math.random() < 0.5) burst(b.x, b.y, '#ffffff', 1, 60);
          const now = performance.now();
          if (now - lastGrazeSound > 70) { lastGrazeSound = now; Arcade.tone({ freq: 1500, dur: 0.02, type: 'sine', vol: 0.012 }); }
          if (grazes >= 500 && !graze500) { graze500 = true; Arcade.flag('nova-barrage-graze'); }
        }
      }
      bullets[j++] = b;
    }
    bullets.length = j;
    if (struck) hurt(); // after the loop: getting hit clears nearby bullets
    if (bombT > 0.8) cashBullets(10);

    // Stars.
    const reach = PICK_R * (up.magnet ? 2.2 : 1);
    for (const s of stars) {
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
      if (!p.dead && (s.pull || d < reach)) {
        s.pull = true;
        const sp = 620;
        s.x += (dx / (d || 1)) * sp * dt;
        s.y += (dy / (d || 1)) * sp * dt;
        if (d < 18) { addScore(s.val); s.dead = true; }
      } else {
        s.vy = Math.min(220, s.vy + 260 * dt);
        s.vx *= 0.97;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.y > H + 10) s.dead = true;
      }
    }
    stars = stars.filter(s => !s.dead);

    // Effects.
    for (const s of sparks) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94; }
    sparks = sparks.filter(s => s.t < s.life);
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < r.life);

    // Between sectors, and the end of the run.
    if (clearT >= 0) {
      clearT -= dt;
      if (clearT < 0 && !p.dead) showPick();
    }
    if (p.dead) {
      overT -= dt;
      if (overT <= 0) gameOver();
    }
  }

  function gameOver() {
    state = 'over';
    Arcade.finish(ui, {
      score,
      title: 'Ship down',
      lines: [
        `Reached ${sectorName()} on ${D.name}`,
        `${grazes.toLocaleString()} grazes · ${bossesBeaten} boss${bossesBeaten === 1 ? '' : 'es'} beaten · best multiplier ×${maxMult.toFixed(1)}`,
      ],
      onAction: () => begin(),
    });
    // Outside a duel, let them switch difficulty right from the results.
    if (!Versus.active()) {
      const panel = document.querySelector('#overlay .panel');
      panel?.insertAdjacentHTML('beforeend', `<p style="margin-top:12px">Or play again on:</p><div class="menu"><div class="row">${diffButtons()}</div></div>`);
      wireDiff(panel, d => begin(d));
    }
  }

  // ---------- Pause ----------

  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    keys.clear();
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }
  function resume() {
    state = 'play';
    ui.hide();
  }

  // ---------- Input ----------

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'play') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (state === 'pick' && /^Digit[1-3]$/.test(e.code)) {
      const u = showPick.offers?.[+e.code.slice(5) - 1];
      if (u) choose(u.id);
      return;
    }
    if (state !== 'play') return;
    keys.add(e.code);
    if (!e.repeat && ['Space', 'KeyX', 'KeyK'].includes(e.code)) bomb();
    if (e.code.startsWith('Shift')) e.preventDefault();
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  Arcade.onBlur(() => { keys.clear(); pause(); });

  // Touch and mouse: drag anywhere and the ship follows the finger's movement (not its spot,
  // so the ship stays visible above your thumb).
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'play') return;
    e.preventDefault();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id || state !== 'play' || p.dead) return;
    const s = (W / canvas.getBoundingClientRect().width) * 1.2;
    p.x = clamp(p.x + (e.clientX - drag.x) * s, 14, W - 14);
    p.y = clamp(p.y + (e.clientY - drag.y) * s, 40, H - 24);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const endDrag = e => { if (drag && e.pointerId === drag.id) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  $('bomb-btn')?.addEventListener('pointerdown', e => { e.preventDefault(); bomb(); });
  $('pause-btn')?.addEventListener('pointerdown', e => { e.preventDefault(); if (state === 'play') pause(); else if (state === 'paused') resume(); });

  // ---------- Drawing ----------

  const sprites = new Map();
  function sprite(c, r) {
    const key = c + r;
    if (sprites.has(key)) return sprites.get(key);
    const size = Math.ceil(r * 2 + 10);
    const { canvas: cv, ctx: g } = Arcade.makeLayer(size, size);
    const m = size / 2;
    const grad = g.createRadialGradient(m, m, r * 0.3, m, m, m);
    grad.addColorStop(0, BULLET_COLORS[c]);
    grad.addColorStop(0.6, BULLET_COLORS[c] + '66');
    grad.addColorStop(1, BULLET_COLORS[c] + '00');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.fillStyle = BULLET_COLORS[c];
    g.beginPath(); g.arc(m, m, r, 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(m, m, r * 0.55, 0, TAU); g.fill();
    const s = { cv, size };
    sprites.set(key, s);
    return s;
  }

  const field = [0.25, 0.5, 1].map((speed, layer) => Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H, speed: 30 + speed * 90, size: 0.6 + layer * 0.6 })));
  const skies = new Map();
  function sky() {
    const S = SECTORS[sector ? si() : 0];
    if (!skies.has(S.name)) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, S.sky[0]);
      g.addColorStop(1, S.sky[1]);
      skies.set(S.name, g);
    }
    return skies.get(S.name);
  }

  function poly(x, y, r, sides, rot) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i * TAU) / sides;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function drawEnemy(e) {
    const c = e.flash > 0 ? '#ffffff' : e.T.color;
    ctx.fillStyle = c;
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    const { x, y, r } = e;
    switch (e.type) {
      case 'dart':
        ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x - r * 0.8, y - r * 0.7); ctx.lineTo(x, y - r * 0.2); ctx.lineTo(x + r * 0.8, y - r * 0.7); ctx.closePath(); ctx.fill();
        break;
      case 'wing':
        ctx.beginPath(); ctx.moveTo(x, y + r * 0.6); ctx.lineTo(x - r, y - r * 0.6); ctx.lineTo(x - r * 0.3, y - r * 0.2); ctx.lineTo(x, y - r * 0.7); ctx.lineTo(x + r * 0.3, y - r * 0.2); ctx.lineTo(x + r, y - r * 0.6); ctx.closePath(); ctx.fill();
        break;
      case 'turret':
        poly(x, y, r, 6, e.spin * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, TAU); ctx.fill();
        break;
      case 'spinner':
        for (let i = 0; i < 4; i++) {
          const a = e.spin * 3 + (i * TAU) / 4;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a + 0.5) * r * 0.6, y + Math.sin(a + 0.5) * r * 0.6); ctx.closePath(); ctx.fill();
        }
        break;
      default:
        poly(x, y, r, e.type === 'guard' ? 4 : 8, e.spin * (e.type === 'guard' ? 0.8 : 0.2)); ctx.fill();
        ctx.fillStyle = '#0b0d14';
        ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, TAU); ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, TAU); ctx.fill();
        if (e.blocker) {
          ctx.strokeStyle = c + '88';
          ctx.beginPath(); ctx.arc(x, y, r + 8 + Math.sin(e.t * 4) * 3, 0, TAU); ctx.stroke();
        }
    }
    if (e.max > 20 && e.hp < e.max) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(x - r, y - r - 10, r * 2, 3);
      ctx.fillStyle = e.T.color;
      ctx.fillRect(x - r, y - r - 10, (r * 2 * Math.max(0, e.hp)) / e.max, 3);
    }
  }

  function drawBoss(b) {
    const c = b.flash > 0 ? '#ffffff' : b.B.color;
    ctx.save();
    ctx.globalAlpha = b.inv > 0 && b.t > 2.5 ? 0.6 + Math.sin(b.t * 30) * 0.3 : 1;
    ctx.strokeStyle = c;
    ctx.lineWidth = 3;
    poly(b.x, b.y, 64, b.B.sides, b.spin);
    ctx.stroke();
    ctx.strokeStyle = c + '55';
    poly(b.x, b.y, 76, b.B.sides * 2, -b.spin * 0.7);
    ctx.stroke();
    ctx.fillStyle = c;
    poly(b.x, b.y, 44, b.B.sides, -b.spin * 1.4);
    ctx.fill();
    ctx.fillStyle = '#0b0d14';
    ctx.beginPath(); ctx.arc(b.x, b.y, 22, 0, TAU); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(b.x, b.y, 10 + Math.sin(b.t * 6) * 3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawShip(x, y, colors, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const flame = 8 + Math.random() * 8;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath(); ctx.moveTo(x - 5, y + 12); ctx.lineTo(x, y + 12 + flame); ctx.lineTo(x + 5, y + 12); ctx.fill();
    ctx.fillStyle = colors[0];
    ctx.beginPath();
    ctx.moveTo(x, y - 20); ctx.lineTo(x + 7, y - 4); ctx.lineTo(x + 17, y + 10); ctx.lineTo(x + 6, y + 13); ctx.lineTo(x, y + 9);
    ctx.lineTo(x - 6, y + 13); ctx.lineTo(x - 17, y + 10); ctx.lineTo(x - 7, y - 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = colors[1];
    ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 4, y); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function draw(dt) {
    ctx.fillStyle = state === 'menu' ? '#05070f' : sky();
    ctx.fillRect(0, 0, W, H);
    const scroll = state === 'play' ? dt : state === 'menu' ? dt * 0.5 : 0;
    for (const layer of field) {
      for (const s of layer) {
        s.y += s.speed * scroll;
        if (s.y > H) { s.y -= H; s.x = Math.random() * W; }
        ctx.fillStyle = `rgba(200,220,255,${0.25 + s.size * 0.25})`;
        ctx.fillRect(s.x, s.y, s.size, s.size * (1 + s.speed / 80));
      }
    }
    if (state === 'menu' || !p) return;

    // Stars to collect.
    ctx.fillStyle = '#ffe680';
    for (const s of stars) {
      ctx.beginPath(); ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x + 4, s.y); ctx.lineTo(s.x, s.y + 5); ctx.lineTo(s.x - 4, s.y); ctx.fill();
    }

    for (const e of enemies) drawEnemy(e);
    if (boss && !boss.gone) drawBoss(boss);

    // Player shots and missiles.
    const col = skin();
    ctx.fillStyle = col[1];
    for (const s of shots) ctx.fillRect(s.x - 1.5, s.y - 8, 3, 14);
    ctx.fillStyle = '#ffb347';
    for (const m of missiles) { ctx.beginPath(); ctx.arc(m.x, m.y, 3.5, 0, TAU); ctx.fill(); }

    // Ship, drones and hitbox.
    if (!p.dead) {
      const blink = p.inv > 0 ? (Math.floor(p.inv * 12) % 2 ? 0.35 : 0.9) : 1;
      drawShip(p.x, p.y, col, blink);
      ctx.fillStyle = col[0];
      for (const [x, y] of drones()) { poly(x, y, 6, 4, performance.now() / 300); ctx.fill(); }
      if (shield > 0) {
        ctx.strokeStyle = `rgba(127,219,255,${0.35 + 0.15 * Math.sin(performance.now() / 150)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, TAU); ctx.stroke();
      }
      const focus = keys.has('ShiftLeft') || keys.has('ShiftRight');
      if (focus) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, GRAZE_R, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ff4fd8';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y + 1, HIT_R + 1, 0, TAU); ctx.fill(); ctx.stroke();
    }

    // Enemy bullets.
    for (const b of bullets) {
      const s = sprite(b.c, b.r);
      ctx.drawImage(s.cv, b.x - s.size / 2, b.y - s.size / 2, s.size, s.size);
    }

    // Effects.
    for (const s of sparks) {
      ctx.globalAlpha = 1 - s.t / s.life;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    for (const r of rings) {
      const k = r.t / r.life;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.max * (1 - (1 - k) ** 2), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    drawHud();
  }

  function drawHud() {
    const S = SECTORS[si()];
    ctx.textAlign = 'left';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = S.accent;
    if (boss && !boss.gone) {
      ctx.fillText(boss.B.name, 14, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(14, 30, W - 28, 6);
      ctx.fillStyle = boss.B.color;
      ctx.fillRect(14, 30, ((W - 28) * Math.max(0, boss.hp)) / boss.max, 6);
      const ph = boss.B.phases.length;
      ctx.fillStyle = '#0b0d14';
      for (let i = 1; i < ph; i++) ctx.fillRect(14 + ((W - 28) * i) / ph - 1, 30, 2, 6);
    } else {
      ctx.fillText(`${sector + 1} · ${sectorName()}`, 14, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(14, 30, 120, 3);
      ctx.fillStyle = S.accent;
      ctx.fillRect(14, 30, 120 * Math.min(1, sclock / SECTOR_LEN), 3);
    }

    // Multiplier gauge.
    ctx.textAlign = 'right';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillStyle = heat > 60 ? '#ffd23f' : '#ffffff';
    ctx.fillText(`×${mult().toFixed(1)}`, W - 14, 60);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(W - 90, 66, 76, 4);
    ctx.fillStyle = heat > 60 ? '#ffd23f' : '#3ef0ff';
    ctx.fillRect(W - 90, 66, (76 * heat) / 100, 4);

    // Lives and bombs.
    for (let i = 0; i < lives; i++) drawShip(22 + i * 26, H - 22, skin(), 0.75);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ff7a45';
    for (let i = 0; i < bombs; i++) { ctx.beginPath(); ctx.arc(W - 18 - i * 20, H - 20, 7, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText('BOMBS', W - 14, H - 34);

    if (banner) {
      const a = Math.min(1, banner.t * 2, (2.8 - banner.t) * 3);
      ctx.globalAlpha = Math.max(0, a);
      ctx.textAlign = 'center';
      ctx.font = '900 34px system-ui, sans-serif';
      ctx.fillStyle = banner.warn ? (Math.floor(banner.t * 4) % 2 ? '#ff4f6d' : '#ffffff') : '#ffffff';
      ctx.fillText(banner.text, W / 2, H * 0.42);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(banner.sub, W / 2, H * 0.42 + 26);
      ctx.globalAlpha = 1;
    }
  }

  let shown = {};
  function updateStats() {
    const best = Math.max(Arcade.getBest(ID), score || 0);
    const vals = { score: (score || 0).toLocaleString(), mult: '×' + (p ? mult().toFixed(1) : '1.0'), best: best.toLocaleString() };
    for (const [k, v] of Object.entries(vals)) if (shown[k] !== v) { shown[k] = v; $(k).textContent = v; }
  }

  // ---------- Menu ----------

  function diffButtons() {
    return Object.entries(DIFFS).map(([id, d]) => `<button class="btn ${id === diff ? '' : 'secondary'}" type="button" data-diff="${id}">${d.name}</button>`).join('');
  }
  function wireDiff(panel, onPick) {
    panel?.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => {
      diff = b.dataset.diff;
      Arcade.save(CHOICE_KEY, diff);
      onPick(diff);
    }));
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'play') {
      // Small steps so fast bullets can't skip over the tiny hitbox on a slow frame.
      const steps = Math.ceil(dt / (1 / 90));
      for (let i = 0; i < steps && state === 'play'; i++) update(dt / steps);
    }
    draw(dt);
    updateStats();
    requestAnimationFrame(frame);
  }

  Versus.attach({
    ui,
    // Duels are always on Normal so the scores compare fairly.
    start: () => begin(Versus.active() ? 'normal' : diff),
    score: () => score || 0,
    intro: {
      title: 'Nova Barrage',
      html: `<p>Fly through five sectors of bullet storms and beat each sector's boss. Your ship fires on its own.</p>
        <ul style="text-align:left">
          <li><b>Arrow keys</b> or <b>WASD</b> to move. Hold <b>Shift</b> to slow down and line up shots. On a phone, drag anywhere.</li>
          <li>Only the tiny white dot in the middle of your ship can be hit.</li>
          <li><b>Graze</b> bullets (let them pass close by) to raise your score multiplier.</li>
          <li><b>Space</b> or <b>X</b> fires a bomb that turns every bullet on screen into stars.</li>
          <li>After each boss, choose an upgrade.</li>
        </ul>
        <div class="menu"><div class="row">${diffButtons()}</div></div>`,
      button: 'Launch',
      onAction: () => begin(),
      onRender: panel => wireDiff(panel, () => {
        panel.querySelectorAll('[data-diff]').forEach(b => b.classList.toggle('secondary', b.dataset.diff !== diff));
      }),
    },
  });
  requestAnimationFrame(frame);
})();
