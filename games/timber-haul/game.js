/* Timber Haul: drive a logging truck through the forest, saw down trees, haul the logs to the
   sawmill, and spend the cash on a bigger saw, a longer bed, a faster engine, a better mill,
   a crew of helper trucks, and new forests to clear. */
(() => {
  const ID = 'timber-haul';
  const W = 960, H = 540;
  const WORLD_W = 2400, WORLD_H = 1600;
  const SAVE_KEY = 'timber-haul:save';
  const VERSION = 1;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const { shade } = Gfx;
  const TAU = Math.PI * 2;

  // ---------- World data ----------

  const TYPES = [
    { name: 'Pine', hp: 1, logs: 1, value: 3, regrow: 28, bark: '#8a5a34', ring: '#e9c68c', leaf: '#3f9b4a' },
    { name: 'Birch', hp: 3, logs: 1, value: 8, regrow: 32, bark: '#ece6d8', ring: '#f2deb0', leaf: '#9dcf4f' },
    { name: 'Redwood', hp: 7, logs: 2, value: 18, regrow: 38, bark: '#a2432c', ring: '#e7a072', leaf: '#2f7d43' },
    { name: 'Frost Pine', hp: 18, logs: 2, value: 45, regrow: 44, bark: '#6d5a52', ring: '#dde6ec', leaf: '#3a7d72' },
    { name: 'Maple', hp: 40, logs: 3, value: 110, regrow: 50, bark: '#5e3b25', ring: '#f0b878', leaf: '#e2652e' },
  ];

  const ZONES = [
    { name: 'Pine Grove', cost: 0, x: 0, y: 900, w: 900, h: 700, ground: '#7cc158' },
    { name: 'Birch Wood', cost: 300, x: 0, y: 0, w: 900, h: 900, ground: '#90cb60', pad: { x: 450, y: 985 } },
    { name: 'Redwood Valley', cost: 2500, x: 900, y: 0, w: 600, h: 1000, ground: '#6cae50', pad: { x: 1200, y: 1085 } },
    { name: 'Frost Pines', cost: 15000, x: 1500, y: 0, w: 900, h: 900, ground: '#e4edf2', snow: true, pad: { x: 1420, y: 470 } },
    { name: 'Maple Ridge', cost: 80000, x: 1500, y: 900, w: 900, h: 700, ground: '#bcc35c', pad: { x: 1430, y: 1150 } },
  ];
  const YARD = { x: 900, y: 1000, w: 600, h: 600, ground: '#a8c76a' };
  const PAD_R = 42;
  const MILL_PAD = { x: 1185, y: 1385, r: 48 };
  const GARAGE_PAD = { x: 995, y: 1366, r: 42 };
  const MILL = { x: 1290, y: 1330, w: 170, d: 110, h: 62, color: '#c9744a' };
  const GARAGE = { x: 930, y: 1462, w: 130, d: 90, h: 52, color: '#7d8ea8' };
  const BELT = { x0: 1228, x1: 1296, y: 1386 };
  const START = { x: 1100, y: 1250 };
  const ROADS = [
    [[995, 1366], [1185, 1385], [1300, 1385]],
    [[1185, 1385], [1185, 1240], [1200, 1085]],
    [[1185, 1260], [880, 1240]],
    [[1185, 1240], [1430, 1150]],
  ];

  // ---------- Upgrades ----------

  const sawDmg = lv => 3 * Math.pow(1.28, lv);
  const sawReach = lv => 22 + Math.min(lv, 20) * 1.1;
  const capOf = lv => 10 + lv * 6;
  const speedOf = lv => 170 + lv * 10;
  const millMult = lv => 1 + lv * 0.15;
  const UPS = [
    { id: 'saw', name: 'Saw blades', icon: '🪚', base: 25, grow: 1.55, max: 30, show: lv => `Cuts ${fmt(sawDmg(lv))}/s, wider reach` },
    { id: 'cap', name: 'Truck bed', icon: '🪵', base: 20, grow: 1.42, max: 40, show: lv => `Holds ${capOf(lv)} logs` },
    { id: 'eng', name: 'Engine', icon: '⚙️', base: 40, grow: 1.6, max: 15, show: lv => `Top speed ${Math.round(speedOf(lv))}` },
    { id: 'mill', name: 'Sawmill', icon: '🏭', base: 60, grow: 1.65, max: 25, show: lv => `Logs sell for ×${millMult(lv).toFixed(2)}` },
  ];
  const upCost = (u, lv) => Math.round(u.base * Math.pow(u.grow, lv));
  const CREW_COST = [400, 1500, 6000, 25000, 100000, 400000];
  const crewCap = () => 8 + s.lv.cap * 2;
  const crewDmg = () => sawDmg(s.lv.saw) * 0.5;
  const crewSpeed = () => 140 + s.lv.eng * 5;

  // ---------- Save ----------

  let s;
  function fresh() {
    return {
      v: VERSION, cash: 0, lifetime: 0, lv: { saw: 0, cap: 0, eng: 0, mill: 0 }, crew: 0, unlocked: 1, paid: 0,
      x: START.x, y: START.y, a: -Math.PI / 2, load: [], order: null, sold: 0, lucky: 0, saved: Date.now(), intro: false,
    };
  }
  function loadSave() {
    const raw = Arcade.load(SAVE_KEY, null);
    s = raw && raw.v === VERSION ? { ...fresh(), ...raw, lv: { ...fresh().lv, ...raw.lv } } : fresh();
    s.load = (s.load || []).filter(t => TYPES[t]).slice(0, capOf(s.lv.cap));
  }
  const score = () => Math.floor(s.lifetime);
  function persist() {
    s.x = truck.x; s.y = truck.y; s.a = truck.a;
    s.saved = Date.now();
    Arcade.submitScore(ID, score());
    Arcade.save(SAVE_KEY, s);
  }

  // ---------- Numbers ----------

  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa'];
  function fmt(n) {
    if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toString();
    const e = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(n) / 3));
    const v = n / Math.pow(1000, e);
    return (v < 100 ? v.toFixed(v < 10 ? 2 : 1) : Math.floor(v)) + SUFFIX[e];
  }
  const money = n => '$' + fmt(n);
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const inRect = (p, r, pad = 0) => p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad;

  // ---------- Sprites ----------

  function pineTiers(c, cx, baseY, tiers, halfW, tierH, step, shrink, leaf, snow) {
    for (let i = 0; i < tiers; i++) {
      const by = baseY - i * step, hw = halfW - i * shrink, ty = by - tierH;
      c.fillStyle = shade(leaf, -0.25);
      c.beginPath(); c.moveTo(cx, ty); c.lineTo(cx + hw, by); c.lineTo(cx, by + 4); c.closePath(); c.fill();
      c.fillStyle = shade(leaf, 0.1);
      c.beginPath(); c.moveTo(cx, ty); c.lineTo(cx - hw, by); c.lineTo(cx, by + 4); c.closePath(); c.fill();
      if (snow) {
        const k = 0.45;
        c.fillStyle = '#f4f8fb';
        c.beginPath(); c.moveTo(cx, ty); c.lineTo(cx - hw * k, ty + tierH * k); c.lineTo(cx - hw * 0.15, ty + tierH * k - 3);
        c.lineTo(cx + hw * 0.1, ty + tierH * k + 1); c.lineTo(cx + hw * k, ty + tierH * k - 2); c.closePath(); c.fill();
      }
    }
  }
  function blobs(c, list, leaf) {
    for (const [x, y, r] of list) {
      c.fillStyle = shade(leaf, -0.22);
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
    for (const [x, y, r] of list) {
      c.fillStyle = leaf;
      c.beginPath(); c.arc(x - r * 0.15, y - r * 0.18, r * 0.86, 0, TAU); c.fill();
    }
    for (const [x, y, r] of list) {
      c.fillStyle = shade(leaf, 0.22);
      c.beginPath(); c.arc(x - r * 0.35, y - r * 0.4, r * 0.42, 0, TAU); c.fill();
    }
  }
  function trunk(c, x0, x1, y0, y1, bark) {
    c.fillStyle = shade(bark, -0.2);
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.fillStyle = bark;
    c.fillRect(x0, y0, (x1 - x0) * 0.55, y1 - y0);
  }
  // Each tree: a sprite anchored at the base of its trunk.
  function treeSprite(i, leafOverride) {
    const T = TYPES[i], leaf = leafOverride || T.leaf;
    switch (i) {
      case 0: return Gfx.sprite(60, 92, 30, 84, c => {
        trunk(c, 27, 33, 62, 85, T.bark);
        pineTiers(c, 30, 70, 3, 25, 30, 16, 6, leaf);
      });
      case 1: return Gfx.sprite(64, 92, 32, 84, c => {
        trunk(c, 29, 35, 36, 85, T.bark);
        c.fillStyle = '#3b3b3b';
        for (const [y, w] of [[48, 4], [58, 3], [70, 4], [78, 3]]) c.fillRect(29 + (y % 3), y, w, 2);
        blobs(c, [[32, 32, 17], [19, 42, 12], [45, 42, 12], [32, 18, 11]], leaf);
      });
      case 2: return Gfx.sprite(60, 124, 30, 116, c => {
        trunk(c, 25, 35, 70, 117, T.bark);
        pineTiers(c, 30, 82, 4, 22, 30, 17, 4, leaf);
      });
      case 3: return Gfx.sprite(64, 100, 32, 92, c => {
        trunk(c, 29, 35, 70, 93, T.bark);
        pineTiers(c, 32, 78, 3, 27, 32, 17, 6, leaf, true);
      });
      default: return Gfx.sprite(76, 98, 38, 90, c => {
        trunk(c, 34, 42, 54, 91, T.bark);
        blobs(c, [[38, 36, 20], [22, 48, 14], [54, 48, 14], [28, 22, 13], [48, 24, 13]], leaf);
      });
    }
  }
  const SPRITES = TYPES.map((_, i) => treeSprite(i));
  const LUCKY = TYPES.map((_, i) => treeSprite(i, '#f1c232'));
  const STUMPS = TYPES.map(T => Gfx.sprite(32, 26, 16, 18, c => {
    c.fillStyle = shade(T.bark, -0.25);
    c.beginPath(); c.ellipse(16, 18, 10, 5, 0, 0, TAU); c.fill();
    c.fillRect(6, 11, 20, 7);
    c.fillStyle = T.ring;
    c.beginPath(); c.ellipse(16, 11, 10, 5, 0, 0, TAU); c.fill();
    c.strokeStyle = shade(T.ring, -0.25);
    c.lineWidth = 1;
    c.beginPath(); c.ellipse(16, 11, 6, 3, 0, 0, TAU); c.stroke();
    c.beginPath(); c.ellipse(16, 11, 2.5, 1.2, 0, 0, TAU); c.stroke();
  }));

  function makePattern(snow) {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    const r = Gfx.rng(snow ? 7 : 3);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.05 + r() * 0.06})` : `rgba(0,40,0,${0.05 + r() * 0.06})`;
      if (snow) g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.5)' : `rgba(90,130,170,${0.06 + r() * 0.06})`;
      g.beginPath(); g.arc(r() * 160, r() * 160, 1 + r() * 3, 0, TAU); g.fill();
    }
    if (!snow) {
      g.strokeStyle = 'rgba(30,80,20,0.22)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 22; i++) {
        const x = r() * 160, y = r() * 160;
        g.beginPath();
        g.moveTo(x - 3, y - 4); g.lineTo(x - 1, y + 2);
        g.moveTo(x, y - 6); g.lineTo(x, y + 2);
        g.moveTo(x + 3, y - 4); g.lineTo(x + 1, y + 2);
        g.stroke();
      }
    }
    return ctx.createPattern(c, 'repeat');
  }
  const GRASS = makePattern(false), SNOW = makePattern(true);

  // ---------- Trees ----------

  const CELL = 100;
  const grid = new Map();
  const cellKey = (cx, cy) => cx * 1000 + cy;
  const trees = [];
  const byZone = ZONES.map(() => []);
  function nearby(x, y, r, fn) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const list = grid.get(cellKey(cx, cy));
      if (list) for (const t of list) fn(t);
    }
  }
  (function plant() {
    const r = Gfx.rng(20261107);
    const clear = ZONES.filter(z => z.pad).map(z => z.pad);
    ZONES.forEach((z, zi) => {
      const gap = 44 + zi * 3;
      const tries = Math.round(z.w * z.h / (gap * gap) * 4);
      for (let i = 0; i < tries; i++) {
        const x = z.x + 22 + r() * (z.w - 44), y = z.y + 40 + r() * (z.h - 56);
        if (clear.some(p => Math.hypot(p.x - x, p.y - y) < 115)) continue;
        let ok = true;
        nearby(x, y, gap, t => { if (ok && Math.hypot(t.x - x, t.y - y) < gap * (0.8 + 0.2 * r())) ok = false; });
        if (!ok) continue;
        const T = TYPES[zi];
        const t = { x, y, type: zi, zone: zi, hp: T.hp, state: 0, timer: 0, g: 1, shake: 0, fallDir: 1, lucky: 0, size: 0.85 + r() * 0.3, claimed: null };
        trees.push(t);
        byZone[zi].push(t);
        const k = cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(t);
      }
    });
  })();
  const standing = t => t.state === 0 && t.g >= 1;

  // Pebbles, flowers and bushes: drawn flat on the ground, never in the way.
  const decor = [];
  (function scatter() {
    const r = Gfx.rng(99);
    for (let i = 0; i < 520; i++) {
      const x = r() * WORLD_W, y = r() * WORLD_H;
      const zone = ZONES.findIndex(z => inRect({ x, y }, z));
      const k = r();
      decor.push({ x, y, kind: k < 0.4 ? 'rock' : k < 0.8 ? 'flower' : 'bush', c: r(), snow: zone === 3 });
    }
  })();

  // ---------- Effects ----------

  const fx = Gfx.particles(900);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();
  const flyers = [];      // logs (and coins) arcing between places
  const belt = [];        // logs riding the conveyor into the mill
  let beltOn = 0, smokeT = 0;

  // ---------- Vehicles ----------

  const truck = { x: START.x, y: START.y, a: -Math.PI / 2, v: 0, spin: 0, incoming: 0, cutting: false, blocked: 0, player: true };
  let helpers = [];
  function makeHelper(i) {
    return { x: GARAGE_PAD.x + (i % 3) * 14, y: GARAGE_PAD.y - 10, a: -Math.PI / 2, v: 0, spin: 0, load: [], incoming: 0,
      state: 'seek', target: null, unloadT: 0, wait: 0.5 + i * 1.2, cutting: false, color: ['#f08c2e', '#e2b53c', '#47b37a', '#c75fd0', '#e85a6a', '#5bc8d6'][i % 6] };
  }
  const loadOf = v => (v.player ? s.load : v.load);
  const capFor = v => (v.player ? capOf(s.lv.cap) : crewCap());

  // ---------- Input ----------

  const keys = new Set();
  addEventListener('keydown', e => keys.add(e.code));
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  let joy = null;
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  canvas.addEventListener('pointerdown', e => {
    const p = toCanvas(e);
    joy = { id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y };
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointermove', e => {
    if (!joy || joy.id !== e.pointerId) return;
    const p = toCanvas(e);
    joy.x = p.x; joy.y = p.y;
  });
  const endJoy = e => { if (joy && joy.id === e.pointerId) joy = null; };
  canvas.addEventListener('pointerup', endJoy);
  canvas.addEventListener('pointercancel', endJoy);

  function inputVec() {
    let x = 0, y = 0;
    for (const k of keys) {
      const d = Arcade.DIRS[k];
      if (d) { x += Arcade.VEC[d].x; y += Arcade.VEC[d].y; }
    }
    if (x || y) { const m = Math.hypot(x, y); return { x: x / m, y: y / m, m: 1 }; }
    if (joy) {
      const dx = joy.x - joy.sx, dy = joy.y - joy.sy, m = Math.hypot(dx, dy);
      if (m > 6) return { x: dx / m, y: dy / m, m: Math.min(1, m / 55) };
    }
    return { x: 0, y: 0, m: 0 };
  }

  // ---------- Sound ----------

  let sawSoundT = 0, sellCombo = 0, comboT = 0;
  const sfx = {
    saw: () => Arcade.tone({ freq: Arcade.rand(150, 190), to: Arcade.rand(120, 150), dur: 0.06, type: 'sawtooth', vol: 0.012 }),
    fell: () => {
      Arcade.tone({ freq: 190, to: 70, dur: 0.22, type: 'triangle', vol: 0.05 });
      Arcade.tone({ freq: 90, to: 50, dur: 0.18, type: 'square', vol: 0.02, delay: 0.12 });
    },
    stack: n => Arcade.tone({ freq: 260 + Math.min(n, 120) * 3, dur: 0.035, type: 'square', vol: 0.014 }),
    coin: n => Arcade.tone({ freq: 660 + Math.min(n, 60) * 14, dur: 0.05, type: 'triangle', vol: 0.03 }),
    buy: () => Arcade.tone({ freq: 520, to: 880, dur: 0.12, type: 'triangle', vol: 0.05 }),
    full: () => Arcade.tone({ freq: 220, to: 160, dur: 0.14, type: 'square', vol: 0.03 }),
    pay: () => Arcade.tone({ freq: Arcade.rand(900, 1100), dur: 0.03, type: 'triangle', vol: 0.015 }),
    unlock: () => {
      [523, 659, 784, 1047].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.05, delay: i * 0.1 }));
    },
    lucky: () => [880, 1175, 1568].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.14, type: 'sine', vol: 0.05, delay: i * 0.07 })),
  };

  // ---------- Game rules ----------

  const visiblePad = () => (s.unlocked < ZONES.length ? ZONES[s.unlocked].pad : null);
  const zoneOpen = i => i < s.unlocked;

  function pushOutCircleRect(v, cx, cy, r, rect) {
    const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    let dx = cx - nx, dy = cy - ny;
    const d = Math.hypot(dx, dy);
    if (d >= r) return;
    if (d === 0) {
      // Centre inside the rectangle: push out along the shortest side.
      const opts = [[cx - rect.x, -1, 0], [rect.x + rect.w - cx, 1, 0], [cy - rect.y, 0, -1], [rect.y + rect.h - cy, 0, 1]].sort((a, b) => a[0] - b[0]);
      const [pen, ox, oy] = opts[0];
      v.x += ox * (pen + r); v.y += oy * (pen + r);
      return;
    }
    v.x += dx / d * (r - d); v.y += dy / d * (r - d);
  }
  const SOLIDS = [
    { x: MILL.x, y: MILL.y, w: MILL.w, h: MILL.d },
    { x: GARAGE.x, y: GARAGE.y, w: GARAGE.w, h: GARAGE.d },
  ];
  function collide(v) {
    for (const off of [0, 20]) {
      const cx = v.x + Math.cos(v.a) * off, cy = v.y + Math.sin(v.a) * off, r = 13;
      nearby(cx, cy, 40, t => {
        if (!standing(t)) return;
        const dx = cx - t.x, dy = cy - t.y, d = Math.hypot(dx, dy), min = r + 7;
        if (d < min && d > 0) { v.x += dx / d * (min - d); v.y += dy / d * (min - d); }
      });
      for (const b of SOLIDS) pushOutCircleRect(v, v.x + Math.cos(v.a) * off, v.y + Math.sin(v.a) * off, r, b);
      ZONES.forEach((z, i) => { if (!zoneOpen(i)) pushOutCircleRect(v, v.x + Math.cos(v.a) * off, v.y + Math.sin(v.a) * off, r, z); });
    }
    v.x = Math.max(24, Math.min(WORLD_W - 24, v.x));
    v.y = Math.max(30, Math.min(WORLD_H - 20, v.y));
  }

  const sawPoint = v => ({ x: v.x + Math.cos(v.a) * 46, y: v.y + Math.sin(v.a) * 46 });

  function chips(t, n = 2) {
    const T = TYPES[t.type];
    for (let i = 0; i < n; i++) {
      fx.emit({ x: t.x + Arcade.rand(-6, 6), y: t.y - 6, z: 6, vx: Arcade.rand(-120, 120), vy: Arcade.rand(-60, 40), vz: Arcade.rand(60, 160), g: 420,
        life: 0.6, size: Arcade.rand(2, 3.5), color: Math.random() < 0.5 ? T.ring : shade(T.ring, -0.2), shape: 'chip', spin: Arcade.rand(-12, 12) });
    }
  }

  // Cuts a standing tree for dt seconds' worth of damage. Returns false if the vehicle is too full.
  function cut(v, t, dmg, dt) {
    const T = TYPES[t.type];
    if (loadOf(v).length + v.incoming + T.logs > capFor(v)) return false;
    t.hp -= dmg * dt;
    t.shake = 0.12;
    v.cutting = true;
    if (Math.random() < dt * 30) chips(t, 1);
    if (t.hp <= 0) fell(t, v);
    return true;
  }

  function fell(t, v) {
    const T = TYPES[t.type];
    t.state = 1; t.timer = 0; t.hp = 0;
    t.fallDir = t.x >= v.x ? 1 : -1;
    t.claimed = null;
    v.incoming += T.logs;
    for (let i = 0; i < T.logs; i++) {
      flyers.push({ kind: 'log', type: t.type, x0: t.x, y0: t.y, z0: 24, to: v, t: -0.18 - i * 0.09, dur: 0.38 });
    }
    chips(t, 8);
    for (let i = 0; i < 10; i++) {
      fx.emit({ x: t.x + Arcade.rand(-18, 18), y: t.y - 4, z: Arcade.rand(20, 50), vx: Arcade.rand(-40, 40) + t.fallDir * 40, vy: Arcade.rand(-20, 20), vz: Arcade.rand(-10, 40), g: 120, drag: 1.5,
        life: Arcade.rand(0.6, 1.1), size: Arcade.rand(2.5, 4.5), color: t.lucky ? '#ffd84a' : shade(T.leaf, Arcade.rand(-0.2, 0.2)), shape: 'square', spin: Arcade.rand(-6, 6) });
    }
    if (v.player) { sfx.fell(); shake.add(0.12); }
    if (t.lucky) {
      const bonus = Math.round(TYPES[s.unlocked - 1].value * 25 * millMult(s.lv.mill));
      earn(bonus);
      pops.add('LUCKY! +' + money(bonus), t.x, t.y - 70, { color: '#ffd84a', size: 24, life: 1.6, rise: 60 });
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * TAU, sp = Arcade.rand(80, 240);
        fx.emit({ x: t.x, y: t.y - 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 2.5, life: Arcade.rand(0.5, 1), size: Arcade.rand(1.5, 3), color: Math.random() < 0.5 ? '#fff3b0' : '#ffcc33', shape: 'spark' });
      }
      t.lucky = 0;
      sfx.lucky();
      shake.add(0.3);
      Arcade.flag('timber-haul-lucky');
      Arcade.toast('Lucky tree', `+${money(bonus)} bonus`);
    }
  }

  function earn(n) {
    s.cash += n;
    s.lifetime += n;
  }

  function sell(type, v) {
    const value = TYPES[type].value * millMult(s.lv.mill);
    earn(value);
    belt.push({ type, p: 0 });
    beltOn = 1.2;
    if (!v.player) {
      if (Math.random() < 0.35) pops.add('+' + money(value), BELT.x0 + Arcade.rand(-10, 30), BELT.y - 30, { color: '#ffe9a8', size: 13, life: 0.7 });
      return;
    }
    s.sold++;
    tripSold++;
    sellCombo++;
    comboT = 0.6;
    sfx.coin(sellCombo);
    pops.add('+' + money(value), BELT.x0 + Arcade.rand(-14, 40), BELT.y - 34, { color: '#ffe066', size: 17 });
    for (let i = 0; i < 3; i++) {
      fx.emit({ x: BELT.x0 + 10, y: BELT.y - 10, z: 10, vx: Arcade.rand(-70, 70), vy: Arcade.rand(-50, 30), vz: Arcade.rand(90, 180), g: 500, life: 0.7, size: 3.2, color: '#ffd23f' });
    }
    if (s.sold === 1) Arcade.flag('timber-haul-first');
    if (tripSold >= 100) Arcade.flag('timber-haul-full');
    const o = s.order;
    if (o && o.type === type) {
      o.have++;
      if (o.have >= o.need) {
        earn(o.reward);
        pops.add('ORDER DONE +' + money(o.reward), truck.x, truck.y - 90, { color: '#8ef0a0', size: 22, life: 1.6, rise: 50 });
        Arcade.toast('Order complete', `${o.need} ${TYPES[o.type].name} logs: +${money(o.reward)}`);
        sfx.unlock();
        newOrder();
      }
    }
  }

  function newOrder() {
    const top = s.unlocked - 1;
    const type = Math.random() < 0.6 ? top : Math.max(0, top - 1);
    const need = Math.max(8, Math.round(capOf(s.lv.cap) * Arcade.rand(0.6, 1.2) / TYPES[type].logs) * TYPES[type].logs);
    s.order = { type, need, have: 0, reward: Math.round(need * TYPES[type].value * millMult(s.lv.mill) * 1.5) };
  }

  function unlockZone() {
    const z = ZONES[s.unlocked];
    s.unlocked++;
    s.paid = 0;
    sfx.unlock();
    shake.add(0.5);
    const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
    for (let i = 0; i < 80; i++) {
      fx.emit({ x: cx + Arcade.rand(-z.w / 2, z.w / 2), y: cy + Arcade.rand(-z.h / 2, z.h / 2), vx: Arcade.rand(-30, 30), vy: Arcade.rand(-80, -20), life: Arcade.rand(0.8, 1.6),
        size: Arcade.rand(2, 4), color: ['#ffe066', '#ffffff', '#9fe870'][i % 3], shape: 'square', spin: 4 });
    }
    if (s.unlocked - 1 === 2) Arcade.flag('timber-haul-redwood');
    if (s.unlocked === ZONES.length) Arcade.flag('timber-haul-maple');
    if (!s.order || s.order.type < s.unlocked - 2) newOrder();
    persist();
    const T = TYPES[s.unlocked - 1];
    Arcade.finish(ui, {
      score: score(),
      title: `${z.name} is open!`,
      lines: [
        `${T.name} trees: ${T.logs > 1 ? `${T.logs} logs each, ` : ''}${money(T.value)} a log before mill bonus.`,
        T.hp > sawDmg(s.lv.saw) * 2 ? 'They are tough. Upgrade your saw at the garage.' : 'Your saw can handle them. Go get them!',
        s.unlocked < ZONES.length ? `Next up: ${ZONES[s.unlocked].name} for ${money(ZONES[s.unlocked].cost)}.` : 'Every forest is open. Keep hauling for the top of the leaderboard!',
      ],
      button: 'Keep hauling',
      onAction: () => ui.hide(),
    });
  }

  // ---------- Garage ----------

  function garagePanel() {
    const rows = UPS.map(u => {
      const lv = s.lv[u.id], maxed = lv >= u.max, cost = upCost(u, lv);
      return `<div class="th-up"><span class="th-ico">${u.icon}</span><span class="th-info"><b>${u.name}</b> <em>Lv ${lv}</em><small>${u.show(lv)}</small>${maxed ? '' : `<small class="th-next">Next: ${u.show(lv + 1)}</small>`}</span>
        <button class="btn th-buy" type="button" data-up="${u.id}" ${maxed || s.cash < cost ? 'disabled' : ''}>${maxed ? 'Max' : money(cost)}</button></div>`;
    });
    const cc = CREW_COST[s.crew];
    rows.push(`<div class="th-up"><span class="th-ico">🚚</span><span class="th-info"><b>Crew truck</b> <em>${s.crew}/${CREW_COST.length}</em><small>Cuts and hauls on its own, even while you're away</small></span>
      <button class="btn th-buy" type="button" data-up="crew" ${cc === undefined || s.cash < cc ? 'disabled' : ''}>${cc === undefined ? 'Max' : money(cc)}</button></div>`);
    ui.show({
      title: '🔧 Garage',
      html: `<p class="th-cash">${money(s.cash)}</p><div class="th-ups">${rows.join('')}</div>`,
      button: 'Back to work',
      onAction: () => ui.hide(),
      onRender: panel => panel.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => buy(b.dataset.up))),
    });
  }
  function buy(id) {
    if (id === 'crew') {
      const cost = CREW_COST[s.crew];
      if (cost === undefined || s.cash < cost) return;
      s.cash -= cost;
      helpers.push(makeHelper(s.crew));
      s.crew++;
      if (s.crew >= 3) Arcade.flag('timber-haul-crew');
    } else {
      const u = UPS.find(x => x.id === id), lv = s.lv[id], cost = upCost(u, lv);
      if (lv >= u.max || s.cash < cost) return;
      s.cash -= cost;
      s.lv[id]++;
    }
    sfx.buy();
    persist();
    garagePanel();
  }
  const canAffordUpgrade = () => UPS.some(u => s.lv[u.id] < u.max && s.cash >= upCost(u, s.lv[u.id])) || (CREW_COST[s.crew] !== undefined && s.cash >= CREW_COST[s.crew]);

  // ---------- Update ----------

  let inGarage = true, tripSold = 0, unloadT = 0, payT = 0, luckyT = 45, fullT = 0, time = 0;
  const cam = { x: 0, y: 0 };

  function steer(v, tx, ty, maxV, dt, stopAt = 0) {
    const want = Math.atan2(ty - v.y, tx - v.x);
    const d = angDiff(want, v.a);
    v.a += Math.max(-6 * dt, Math.min(6 * dt, d));
    const left = Math.hypot(tx - v.x, ty - v.y) - stopAt;
    const target = left <= 0 ? 0 : Math.min(maxV, left * 3) * Math.max(0.3, Math.cos(d));
    v.v = Gfx.approach(v.v, target, 5, dt);
  }
  function move(v, dt) {
    v.x += Math.cos(v.a) * v.v * dt;
    v.y += Math.sin(v.a) * v.v * dt;
    v.spin += dt * (v.cutting ? 40 : 14);
    if (v.v > 60 && Math.random() < dt * 14) {
      const bx = v.x - Math.cos(v.a) * 30, by = v.y - Math.sin(v.a) * 30;
      fx.emit({ x: bx + Arcade.rand(-8, 8), y: by + Arcade.rand(-8, 8), vx: Arcade.rand(-15, 15), vy: Arcade.rand(-25, -5), life: 0.6, size: 3, grow: 9,
        color: inRect(v, ZONES[3]) ? 'rgba(255,255,255,0.55)' : 'rgba(150,120,80,0.35)' });
    }
  }

  function updateTruck(dt) {
    const inp = inputVec();
    const maxV = speedOf(s.lv.eng) * (truck.cutting ? 0.55 : 1);
    if (inp.m > 0) {
      const d = angDiff(Math.atan2(inp.y, inp.x), truck.a);
      truck.a += Math.max(-7 * dt, Math.min(7 * dt, d));
      truck.v = Gfx.approach(truck.v, maxV * inp.m * Math.max(0.35, Math.cos(d)), 4, dt);
    } else truck.v = Gfx.approach(truck.v, 0, 6, dt);
    move(truck, dt);
    collide(truck);

    // Saw: everything standing within reach of the blades gets cut at once.
    truck.cutting = false;
    let blocked = false;
    // The blades sweep a line across the whole front of the truck, a bit wider than the truck.
    const sp = sawPoint(truck), reach = sawReach(s.lv.saw), half = reach * 0.75;
    const px = -Math.sin(truck.a), py = Math.cos(truck.a);
    nearby(sp.x, sp.y, half + 30, t => {
      if (!standing(t)) return;
      const along = Math.max(-half, Math.min(half, (t.x - sp.x) * px + (t.y - sp.y) * py));
      if (Math.hypot(t.x - (sp.x + px * along), t.y - (sp.y + py * along)) > 18) return;
      if (!cut(truck, t, sawDmg(s.lv.saw), dt)) blocked = true;
    });
    if (blocked && !truck.cutting) {
      fullT -= dt;
      if (fullT <= 0) {
        pops.add('FULL! Sell at the mill', truck.x, truck.y - 70 - stackHeight(s.load.length), { color: '#ff8a7a', size: 16, life: 1.1 });
        sfx.full();
        fullT = 1.6;
      }
    }
    if (truck.cutting) {
      sawSoundT -= dt;
      if (sawSoundT <= 0) { sfx.saw(); sawSoundT = 0.08; }
    }

    // Sawmill pad: logs fly off the stack one by one.
    if (dist(truck, MILL_PAD) < MILL_PAD.r && s.load.length) {
      unloadT -= dt;
      const every = Math.max(0.025, 0.085 * Math.pow(0.94, s.lv.mill));
      while (unloadT <= 0 && s.load.length) {
        const type = s.load.pop();
        flyers.push({ kind: 'log', type, x0: truck.x, y0: truck.y, z0: stackHeight(s.load.length + 1) + 8, to: 'mill', who: truck, t: 0, dur: 0.32 });
        unloadT += every;
      }
    } else {
      unloadT = 0;
      if (dist(truck, MILL_PAD) > MILL_PAD.r + 20) tripSold = 0;
    }

    // Garage pad: opens the upgrade panel once per visit.
    const atGarage = dist(truck, GARAGE_PAD) < GARAGE_PAD.r;
    if (atGarage && !inGarage) { truck.v = 0; inGarage = true; keys.clear(); joy = null; garagePanel(); }
    if (!atGarage) inGarage = false;

    // Unlock pad: standing on it pays the cash in.
    const pad = visiblePad();
    if (pad && dist(truck, pad) < PAD_R && s.cash > 0) {
      const z = ZONES[s.unlocked];
      const rate = Math.max(z.cost / 1.5, 40);
      const pay = Math.min(s.cash, z.cost - s.paid, rate * dt);
      s.cash -= pay;
      s.paid += pay;
      payT -= dt;
      if (payT <= 0) {
        payT = 0.06;
        sfx.pay();
        flyers.push({ kind: 'coin', x0: truck.x, y0: truck.y, z0: 20, to: pad, t: 0, dur: 0.3 });
      }
      if (s.paid >= z.cost - 0.01) unlockZone();
    }
  }

  function pickTree(h) {
    const top = s.unlocked - 1;
    const zi = Math.random() < 0.7 ? top : Arcade.randInt(0, top);
    let best = null, bd = Infinity;
    for (const t of byZone[zi]) {
      if (!standing(t) || t.claimed || t.lucky > 0) continue;
      const d = (t.x - h.x) ** 2 + (t.y - h.y) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  function updateHelper(h, dt) {
    h.cutting = false;
    if (h.wait > 0) { h.wait -= dt; return; }
    const cap = crewCap();
    if (h.state === 'seek') {
      h.target = pickTree(h);
      if (h.target) { h.target.claimed = h; h.state = 'go'; } else h.v = Gfx.approach(h.v, 0, 5, dt);
    } else if (h.state === 'go' || h.state === 'cut') {
      const t = h.target;
      if (!t || !standing(t) || t.claimed !== h) { h.state = 'seek'; h.target = null; return; }
      const d = Math.hypot(t.x - h.x, t.y - h.y);
      if (d > 46) { h.state = 'go'; steer(h, t.x, t.y, crewSpeed(), dt, 36); } else {
        h.state = 'cut';
        h.a += Math.max(-5 * dt, Math.min(5 * dt, angDiff(Math.atan2(t.y - h.y, t.x - h.x), h.a)));
        h.v = Gfx.approach(h.v, 0, 8, dt);
        if (!cut(h, t, crewDmg(), dt)) { t.claimed = null; h.state = 'home'; }
        else if (t.state !== 0) {
          h.state = h.load.length + h.incoming + TYPES[t.type].logs > cap ? 'home' : 'seek';
          h.target = null;
        }
      }
    } else if (h.state === 'home') {
      steer(h, MILL_PAD.x - 20, MILL_PAD.y - 6, crewSpeed(), dt, 4);
      if (Math.hypot(MILL_PAD.x - 20 - h.x, MILL_PAD.y - 6 - h.y) < 26 && h.incoming === 0) h.state = 'unload';
    } else if (h.state === 'unload') {
      h.v = Gfx.approach(h.v, 0, 8, dt);
      h.unloadT -= dt;
      if (h.unloadT <= 0 && h.load.length) {
        const type = h.load.pop();
        flyers.push({ kind: 'log', type, x0: h.x, y0: h.y, z0: stackHeight(h.load.length + 1) + 8, to: 'mill', who: h, t: 0, dur: 0.32 });
        h.unloadT = 0.14;
      }
      if (!h.load.length) h.state = 'seek';
    }
    move(h, dt);
    h.x = Math.max(20, Math.min(WORLD_W - 20, h.x));
    h.y = Math.max(30, Math.min(WORLD_H - 20, h.y));
  }

  function updateTrees(dt) {
    for (const t of trees) {
      if (t.shake > 0) t.shake -= dt;
      if (t.state === 1) {
        t.timer += dt;
        if (t.timer > 0.55) { t.state = 2; t.timer = 0; }
      } else if (t.state === 2) {
        t.timer += dt;
        if (t.timer > TYPES[t.type].regrow) { t.state = 0; t.g = 0.05; t.hp = TYPES[t.type].hp; }
      } else if (t.g < 1) t.g = Math.min(1, t.g + dt / 1.4);
      if (t.lucky > 0) {
        t.lucky -= dt;
        if (Math.random() < dt * 10) {
          fx.emit({ x: t.x + Arcade.rand(-20, 20), y: t.y - Arcade.rand(20, 70), vy: -20, life: 0.8, size: 2, color: '#fff3b0', shape: 'square', spin: 6 });
        }
      }
    }
    luckyT -= dt;
    if (luckyT <= 0) {
      luckyT = Arcade.rand(70, 110);
      const pool = trees.filter(t => zoneOpen(t.zone) && standing(t) && dist(t, truck) > 300 && dist(t, truck) < 1100);
      if (pool.length) {
        Arcade.pick(pool).lucky = 45;
        Arcade.toast('A lucky tree appeared!', 'Follow the gold arrow and cut it for a big bonus');
      }
    }
  }

  function flyerPos(f) {
    const k = Gfx.ease.inOutCubic(Math.max(0, Math.min(1, f.t / f.dur)));
    let tx, ty, tz;
    if (f.to === 'mill') { tx = BELT.x0 + 4; ty = BELT.y; tz = 12; }
    else if (f.kind === 'coin') { tx = f.to.x; ty = f.to.y; tz = 0; }
    else { tx = f.to.x - Math.cos(f.to.a) * 12; ty = f.to.y - Math.sin(f.to.a) * 12; tz = stackHeight(loadOf(f.to).length + 1) + 6; }
    return { x: Gfx.lerp(f.x0, tx, k), y: Gfx.lerp(f.y0, ty, k), z: Gfx.lerp(f.z0, tz, k) + Math.sin(k * Math.PI) * 50, k };
  }

  function updateFlyers(dt) {
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i];
      f.t += dt;
      if (f.t < f.dur) continue;
      flyers.splice(i, 1);
      if (f.kind === 'coin') continue;
      if (f.to === 'mill') sell(f.type, f.who);
      else {
        f.to.incoming--;
        const load = loadOf(f.to);
        load.push(f.type);
        if (f.to.player) sfx.stack(load.length);
      }
    }
    for (let i = belt.length - 1; i >= 0; i--) {
      belt[i].p += dt * 2.2;
      if (belt[i].p >= 1) belt.splice(i, 1);
    }
  }

  function update(dt) {
    time += dt;
    updateTruck(dt);
    for (const h of helpers) updateHelper(h, dt);
    updateTrees(dt);
    updateFlyers(dt);
    fx.update(dt);
    pops.update(dt);
    shake.update(dt);
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) sellCombo = 0; }
    beltOn = Math.max(0, beltOn - dt);
    smokeT -= dt;
    if (smokeT <= 0) {
      smokeT = beltOn > 0 ? 0.08 : 0.35;
      fx.emit({ x: MILL.x + 132 + Arcade.rand(-3, 3), y: MILL.y - MILL.h - 34, vx: Arcade.rand(5, 20), vy: Arcade.rand(-40, -25), drag: 0.3,
        life: 2.2, size: 5, grow: 8, color: beltOn > 0 ? 'rgba(235,235,235,0.5)' : 'rgba(220,220,220,0.32)' });
    }

    // Camera leads a little in the direction of travel.
    const lead = 0.35;
    const tx = truck.x + Math.cos(truck.a) * truck.v * lead - W / 2;
    const ty = truck.y + Math.sin(truck.a) * truck.v * lead - H / 2 - 20;
    cam.x = Gfx.approach(cam.x, Math.max(0, Math.min(WORLD_W - W, tx)), 5, dt);
    cam.y = Gfx.approach(cam.y, Math.max(0, Math.min(WORLD_H - H, ty)), 5, dt);
  }

  // ---------- Drawing ----------

  const LAYER = 3.3, PER_LAYER = 4, MAX_DRAWN = 120;
  const stackHeight = n => 9 + Math.ceil(Math.min(n, MAX_DRAWN) / PER_LAYER) * LAYER;
  const onScreen = (x, y, m = 80) => x > cam.x - m && x < cam.x + W + m && y > cam.y - m && y < cam.y + H + m * 2;

  function drawGround() {
    for (const r of [...ZONES, YARD]) {
      ctx.fillStyle = r.ground;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // Soft seams between regions.
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 6;
    for (const r of ZONES) ctx.strokeRect(r.x, r.y, r.w, r.h);
    const vx = cam.x - 20, vy = cam.y - 20;
    ctx.fillStyle = GRASS;
    ctx.fillRect(vx, vy, W + 40, H + 40);
    const z = ZONES[3];
    if (cam.x + W > z.x && cam.y < z.y + z.h) {
      ctx.fillStyle = SNOW;
      ctx.fillRect(z.x, z.y, z.w, z.h);
    }

    // Dirt roads.
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const [w, c] of [[50, '#b48d5a'], [40, '#d1ad76']]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      for (const r of ROADS) {
        ctx.beginPath();
        r.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    }

    for (const d of decor) {
      if (!onScreen(d.x, d.y, 20)) continue;
      if (d.kind === 'rock') {
        ctx.fillStyle = d.snow ? '#b9c6cf' : '#8f9493';
        ctx.beginPath(); ctx.ellipse(d.x, d.y, 6 + d.c * 5, 4 + d.c * 3, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = d.snow ? '#e6eef3' : '#b4b9b7';
        ctx.beginPath(); ctx.ellipse(d.x - 1.5, d.y - 1.5, 3 + d.c * 3, 2 + d.c * 2, 0, 0, TAU); ctx.fill();
      } else if (d.kind === 'flower' && !d.snow) {
        ctx.fillStyle = ['#ffffff', '#ffd84a', '#ff8fb1', '#b59bff'][Math.floor(d.c * 4)];
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(d.x + i * 5 - 5, d.y + (i % 2) * 3, 2, 0, TAU); ctx.fill(); }
      } else if (d.kind === 'bush') {
        const c = d.snow ? '#9db8b4' : '#4f9a3f';
        ctx.fillStyle = shade(c, -0.2);
        ctx.beginPath(); ctx.arc(d.x, d.y, 8, 0, TAU); ctx.arc(d.x + 8, d.y + 1, 6, 0, TAU); ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(d.x - 1, d.y - 2, 6, 0, TAU); ctx.arc(d.x + 7, d.y - 1, 4.5, 0, TAU); ctx.fill();
      }
    }
  }

  function drawPad(p, color, label, icon, progress = -1) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = Gfx.alpha(color, 0.22 + pulse * 0.08);
    Gfx.roundRect(ctx, -PAD_R, -PAD_R * 0.7, PAD_R * 2, PAD_R * 1.4, 14);
    ctx.fill();
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -time * 20;
    ctx.strokeStyle = Gfx.alpha('#ffffff', 0.7);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    if (progress >= 0) {
      ctx.fillStyle = Gfx.alpha(color, 0.6);
      Gfx.roundRect(ctx, -PAD_R, -PAD_R * 0.7, PAD_R * 2 * progress, PAD_R * 1.4, 14);
      ctx.fill();
    }
    ctx.restore();
    Gfx.text(ctx, icon, p.x, p.y - 4, { size: 22, stroke: null });
    Gfx.text(ctx, label, p.x, p.y + 20, { size: 12, color: '#fff' });
  }

  function drawTreeShadows() {
    ctx.fillStyle = 'rgba(20,40,10,0.22)';
    for (const t of visibleTrees) {
      if (t.state === 2) continue;
      const k = t.size * (t.state === 0 ? t.g : 1 - t.timer / 0.55);
      if (k <= 0.05) continue;
      ctx.beginPath();
      ctx.ellipse(t.x + 9 * k, t.y + 2, 22 * k, 8 * k, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawTree(t) {
    const sp = t.lucky > 0 ? LUCKY[t.type] : SPRITES[t.type];
    if (t.state === 2 || t.state === 1) STUMPS[t.type].draw(ctx, t.x, t.y + 2, t.size * 0.9);
    if (t.state === 2) return;
    if (t.state === 1) {
      const k = t.timer / 0.55;
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      sp.draw(ctx, t.x, t.y, t.size, t.fallDir * Gfx.ease.inQuad(Math.min(1, k * 1.15)) * Math.PI / 2);
      ctx.globalAlpha = 1;
      return;
    }
    if (t.lucky > 0) {
      const g = ctx.createRadialGradient(t.x, t.y - 40, 4, t.x, t.y - 40, 60);
      g.addColorStop(0, 'rgba(255,230,120,0.55)');
      g.addColorStop(1, 'rgba(255,230,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(t.x, t.y - 40, 60, 0, TAU); ctx.fill();
    }
    const wob = t.shake > 0 ? Math.sin(time * 70) * 2.2 : 0;
    const g = t.g < 1 ? Gfx.ease.outBack(t.g) : 1;
    sp.draw(ctx, t.x + wob, t.y, t.size * g);
    if (t.shake > 0 && t.hp < TYPES[t.type].hp) {
      Gfx.bar(ctx, t.x - 16, t.y - 92 * t.size, 32, 5, t.hp / TYPES[t.type].hp, '#ff6b4a');
    }
  }

  // One log lying across the bed, seen from above; ends show the rings.
  function drawLog(type, x, y, len, thick) {
    const T = TYPES[type];
    ctx.fillStyle = shade(T.bark, -0.25);
    Gfx.roundRect(ctx, x - thick / 2, y - len / 2, thick, len, thick / 2);
    ctx.fill();
    ctx.fillStyle = T.bark;
    Gfx.roundRect(ctx, x - thick / 2, y - len / 2, thick * 0.65, len, thick / 2);
    ctx.fill();
    ctx.fillStyle = T.ring;
    ctx.beginPath(); ctx.ellipse(x, y - len / 2 + 1, thick / 2 - 0.5, 2.2, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y + len / 2 - 1, thick / 2 - 0.5, 2.2, 0, 0, TAU); ctx.fill();
  }

  function drawVehicle(v, body, sawR) {
    const k = v.player ? 1 : 0.8;
    const load = loadOf(v);
    ctx.save();
    ctx.translate(v.x, v.y);
    // Shadow, offset down-right like the trees'.
    ctx.save();
    ctx.translate(7, 6);
    ctx.rotate(v.a);
    ctx.fillStyle = 'rgba(20,30,10,0.25)';
    Gfx.roundRect(ctx, -38 * k, -17 * k, 92 * k, 34 * k, 10);
    ctx.fill();
    ctx.restore();

    ctx.rotate(v.a);
    ctx.scale(k, k);
    const ux = -Math.sin(v.a), uy = -Math.cos(v.a); // straight up the screen, in the truck's frame
    const at = (h, fn) => { ctx.save(); ctx.translate(ux * h / k, uy * h / k); fn(); ctx.restore(); };
    const solid = (h0, h1, side, top, path) => {
      ctx.fillStyle = side;
      for (let h = h0; h < h1; h++) at(h, () => { path(); ctx.fill(); });
      at(h1, () => { ctx.fillStyle = top; path(); ctx.fill(); });
    };

    // Wheels.
    ctx.fillStyle = '#23262b';
    for (const [x, y] of [[-24, -16], [-24, 16], [-8, -16], [-8, 16], [20, -16], [20, 16]]) {
      Gfx.roundRect(ctx, x - 6, y - 4, 12, 8, 3);
      ctx.fill();
    }

    // Saw arm and blades out front.
    solid(2, 5, '#5c636d', '#8a929d', () => { ctx.beginPath(); ctx.rect(26, -4, 22, 8); });
    const spread = Math.min(sawR * 0.75, 30) - 3, br = 8 + Math.min(sawR, 44) * 0.16;
    solid(3, 6, '#5c636d', '#d0473a', () => { ctx.beginPath(); ctx.rect(44, -spread - 2, 7, spread * 2 + 4); });
    at(6, () => {
      for (const sy of [-spread, spread]) {
        ctx.save();
        ctx.translate(48, sy);
        ctx.rotate(v.spin * (sy < 0 ? 1 : -1));
        ctx.fillStyle = '#c9d1d9';
        ctx.beginPath();
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * TAU, r = i % 2 ? br : br * 0.78;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#eef2f6';
        ctx.beginPath(); ctx.arc(-br * 0.2, -br * 0.2, br * 0.45, 0, TAU); ctx.fill();
        ctx.fillStyle = '#6b737d';
        ctx.beginPath(); ctx.arc(0, 0, br * 0.22, 0, TAU); ctx.fill();
        ctx.restore();
      }
    });

    // Chassis, bed and cab.
    solid(1, 6, '#363b43', '#555c66', () => Gfx.roundRect(ctx, -36, -14, 66, 28, 5));
    at(6, () => {
      ctx.fillStyle = '#80583a';
      Gfx.roundRect(ctx, -35, -13, 40, 26, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      for (let x = -28; x < 5; x += 7) { ctx.beginPath(); ctx.moveTo(x, -13); ctx.lineTo(x, 13); ctx.stroke(); }
    });
    solid(6, 22, shade(body, -0.35), body, () => Gfx.roundRect(ctx, 7, -14, 23, 28, 5));
    at(22, () => {
      ctx.fillStyle = '#25344d';
      Gfx.roundRect(ctx, 21, -12, 7, 24, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(23, -10, 2, 9);
      ctx.fillStyle = shade(body, 0.2);
      Gfx.roundRect(ctx, 9, -11, 10, 22, 3);
      ctx.fill();
    });

    // Log stack: four logs a layer across the bed, layers rising straight up the screen.
    const n = Math.min(load.length, MAX_DRAWN);
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / PER_LAYER), col = i % PER_LAYER;
      const jitter = ((i * 37) % 7 - 3) * 0.25;
      at(7 + layer * LAYER, () => drawLog(load[i], -30 + col * 9.6 + jitter, jitter * 0.6, 26, 8.4));
    }
    // Corner stakes hold it in.
    const top = Math.max(12, 7 + Math.ceil(n / PER_LAYER) * LAYER - 2);
    for (const [x, y] of [[-34, -13], [-34, 13], [4, -13], [4, 13]]) {
      solid(6, top, '#a63b2a', '#d4553e', () => { ctx.beginPath(); ctx.rect(x - 1.5, y - 1.5, 3, 3); });
    }
    ctx.restore();

    if (v.player && load.length >= capOf(s.lv.cap)) {
      const y = v.y - stackHeight(load.length) - 26 + Math.sin(time * 6) * 3;
      Gfx.card(ctx, v.x - 26, y - 11, 52, 22, { fill: 'rgba(200,50,40,0.92)', r: 11 });
      Gfx.text(ctx, 'FULL', v.x, y, { size: 13, stroke: null });
    }
  }

  function drawBelt() {
    // Conveyor from the sell pad into the mill.
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(BELT.x0 - 4, BELT.y - 13, BELT.x1 - BELT.x0 + 8, 26);
    ctx.fillStyle = '#555c66';
    ctx.fillRect(BELT.x0, BELT.y - 10, BELT.x1 - BELT.x0, 20);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    const off = (time * (beltOn > 0 ? 60 : 0)) % 10;
    for (let x = BELT.x0 + off; x < BELT.x1; x += 10) { ctx.beginPath(); ctx.moveTo(x, BELT.y - 10); ctx.lineTo(x, BELT.y + 10); ctx.stroke(); }
    for (const b of belt) drawLog(b.type, Gfx.lerp(BELT.x0 + 4, BELT.x1 + 6, b.p), BELT.y - 4, 18, 7);

  }

  function drawMill() {
    const m = MILL;
    Gfx.shadow(ctx, m.x + m.w / 2 + 14, m.y + m.d - 4, m.w * 0.62, 26, 0.3);
    Gfx.box(ctx, m.x, m.y, m.w, m.d, m.h, m.color, 6);
    // Roof: two sloped halves with a ridge.
    const rx = m.x - 6, ry = m.y - m.h - 6, rw = m.w + 12, rd = m.d + 6;
    ctx.fillStyle = '#7a4a3a';
    ctx.beginPath(); ctx.moveTo(rx, ry + rd * 0.5); ctx.lineTo(rx + rw, ry + rd * 0.5); ctx.lineTo(rx + rw, ry + rd); ctx.lineTo(rx, ry + rd); ctx.fill();
    ctx.fillStyle = '#a3624a';
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + rw, ry); ctx.lineTo(rx + rw, ry + rd * 0.5); ctx.lineTo(rx, ry + rd * 0.5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let x = rx + 12; x < rx + rw; x += 14) { ctx.beginPath(); ctx.moveTo(x, ry); ctx.lineTo(x, ry + rd); ctx.stroke(); }
    ctx.fillStyle = '#c47a5c';
    ctx.fillRect(rx, ry + rd * 0.5 - 2, rw, 4);
    // Chimney.
    Gfx.box(ctx, m.x + 124, m.y - m.h - 6, 18, 14, 26, '#8b8f96', 2);
    // Front wall: a door at the belt and a big spinning saw.
    const fy = m.y + m.d - m.h * 0.9;
    ctx.fillStyle = '#4a2d22';
    Gfx.roundRect(ctx, m.x - 2, BELT.y - 30, 18, 34, 3);
    ctx.fill();
    ctx.save();
    ctx.translate(m.x + 120, fy + 28);
    ctx.rotate(time * (beltOn > 0 ? 9 : 1.5));
    ctx.fillStyle = '#d6dde4';
    ctx.beginPath();
    for (let i = 0; i < 28; i++) { const a = i / 28 * TAU, r = i % 2 ? 22 : 18; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.fill();
    ctx.fillStyle = '#7d858e';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    ctx.restore();
    Gfx.card(ctx, m.x + 30, fy + 6, 66, 20, { fill: '#2b2f36', r: 5 });
    Gfx.text(ctx, 'SAWMILL', m.x + 63, fy + 16, { size: 11, color: '#ffd166', stroke: null });
    // Plank stacks out back grow with everything ever earned.
    const piles = Math.min(4, Math.floor(Math.log10(s.lifetime + 1)));
    for (let i = 0; i < piles; i++) {
      const px = m.x + 10 + i * 40, py = m.y + m.d + 12, ph = 8 + i * 5;
      Gfx.box(ctx, px, py, 32, 14, ph, '#e2b77d', 2);
      ctx.fillStyle = 'rgba(120,70,30,0.35)';
      for (let y = py - ph + 14 + 3; y < py + 14; y += 4) ctx.fillRect(px + 1, y, 30, 1);
    }
  }

  function drawGarage() {
    const g = GARAGE;
    Gfx.shadow(ctx, g.x + g.w / 2 + 12, g.y + g.d - 4, g.w * 0.6, 22, 0.3);
    Gfx.box(ctx, g.x, g.y, g.w, g.d, g.h, g.color, 6);
    ctx.fillStyle = '#5c6b82';
    Gfx.roundRect(ctx, g.x - 4, g.y - g.h - 6, g.w + 8, 16, 4);
    ctx.fill();
    // Roller door on the front face.
    const dx = g.x + 22, dy = g.y + g.d - g.h * 0.9 + 4, dw = g.w - 44, dh = g.h * 0.9 - 6;
    ctx.fillStyle = '#c8ced8';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.fillStyle = '#9aa3b0';
    for (let y = dy + 4; y < dy + dh; y += 6) ctx.fillRect(dx, y, dw, 2);
    Gfx.card(ctx, g.x + 24, g.y - g.h + 8, g.w - 48, 20, { fill: '#2b2f36', r: 5 });
    Gfx.text(ctx, 'GARAGE', g.x + g.w / 2, g.y - g.h + 18, { size: 11, color: '#7fd1ff', stroke: null });
  }

  function drawLocked() {
    ZONES.forEach((z, i) => {
      if (zoneOpen(i)) return;
      if (z.x > cam.x + W || z.x + z.w < cam.x || z.y > cam.y + H + 100 || z.y + z.h < cam.y) return;
      ctx.fillStyle = 'rgba(16,24,20,0.5)';
      ctx.fillRect(z.x, z.y, z.w, z.h);
      // Fence along the edges that face open ground.
      ctx.strokeStyle = '#8a6a44';
      ctx.lineWidth = 4;
      ctx.strokeRect(z.x + 2, z.y + 2, z.w - 4, z.h - 4);
      ctx.fillStyle = '#6e5233';
      for (let x = z.x; x <= z.x + z.w; x += 36) { ctx.fillRect(x - 3, z.y - 8, 6, 14); ctx.fillRect(x - 3, z.y + z.h - 10, 6, 14); }
      for (let y = z.y; y <= z.y + z.h; y += 36) { ctx.fillRect(z.x - 3, y - 8, 6, 14); ctx.fillRect(z.x + z.w - 3, y - 8, 6, 14); }
      const cx = Math.max(cam.x + 140, Math.min(cam.x + W - 190, z.x + z.w / 2));
      const cy = Math.max(cam.y + 130, Math.min(cam.y + H - 90, z.y + z.h / 2));
      if (!inRect({ x: cx, y: cy }, z)) return;
      const next = i === s.unlocked;
      Gfx.card(ctx, cx - 120, cy - 34, 240, 68, { fill: 'rgba(15,20,28,0.82)', r: 12 });
      Gfx.text(ctx, '🔒 ' + z.name, cx, cy - 12, { size: 18, stroke: null });
      Gfx.text(ctx, next ? `Stand on the sign with ${money(z.cost)}` : `Unlock ${ZONES[i - 1].name} first`, cx, cy + 14, { size: 13, color: next ? '#ffd166' : '#9aa3ad', stroke: null, weight: 600 });
    });
  }

  let visibleTrees = [];
  function drawWorld() {
    const o = shake.offset(8);
    ctx.save();
    ctx.translate(-Math.round(cam.x) + o.x, -Math.round(cam.y) + o.y);
    drawGround();

    visibleTrees = [];
    nearby(cam.x + W / 2, cam.y + H / 2, Math.max(W, H) / 2 + 140, t => { if (onScreen(t.x, t.y)) visibleTrees.push(t); });

    const pad = visiblePad();
    drawBelt();
    drawPad(MILL_PAD, '#ffb347', 'SELL', '💰');
    drawPad(GARAGE_PAD, '#57b6ff', 'UPGRADE', '🔧');
    if (pad) {
      const z = ZONES[s.unlocked];
      drawPad(pad, '#7ee081', money(Math.ceil(z.cost - s.paid)), '🔓', s.paid / z.cost);
    }
    drawTreeShadows();

    // Everything that stands up is drawn back to front.
    const things = visibleTrees.map(t => ({ y: t.y, draw: () => drawTree(t) }));
    things.push({ y: truck.y + 8, draw: () => drawVehicle(truck, '#4fa3e3', sawReach(s.lv.saw)) });
    for (const h of helpers) if (onScreen(h.x, h.y)) things.push({ y: h.y + 8, draw: () => drawVehicle(h, h.color, 22) });
    things.push({ y: MILL.y + MILL.d, draw: drawMill });
    things.push({ y: GARAGE.y + GARAGE.d, draw: drawGarage });
    things.sort((a, b) => a.y - b.y);
    for (const t of things) t.draw();

    for (const f of flyers) {
      const p = flyerPos(f);
      if (f.t < 0) continue;
      if (f.kind === 'coin') {
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.arc(p.x, p.y - p.z, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff1a8';
        ctx.beginPath(); ctx.arc(p.x - 1.5, p.y - p.z - 1.5, 2, 0, TAU); ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y - p.z);
        ctx.rotate(p.k * 5);
        drawLog(f.type, 0, 0, 22, 8);
        ctx.restore();
      }
    }
    fx.draw(ctx);
    drawLocked();
    pops.draw(ctx);
    ctx.restore();
  }

  // Points at whatever the player should do next, at the screen edge if it's off-screen.
  function guide() {
    const full = s.load.length + truck.incoming >= capOf(s.lv.cap) - 2;
    const pad = visiblePad();
    const lucky = trees.find(t => t.lucky > 0 && standing(t));
    let target = null, color = '#ffd166', icon = '';
    if (full && dist(truck, MILL_PAD) > MILL_PAD.r) { target = MILL_PAD; icon = '💰'; }
    else if (pad && s.cash >= ZONES[s.unlocked].cost - s.paid && dist(truck, pad) > PAD_R) { target = pad; color = '#7ee081'; icon = '🔓'; }
    else if (lucky) { target = { x: lucky.x, y: lucky.y - 40 }; color = '#ffd84a'; icon = '✨'; }
    else if (canAffordUpgrade() && s.load.length === 0 && dist(truck, GARAGE_PAD) > GARAGE_PAD.r && s.lifetime < 2000) { target = GARAGE_PAD; color = '#57b6ff'; icon = '🔧'; }
    if (!target) return;
    const sx = target.x - cam.x, sy = target.y - cam.y;
    const m = 40;
    if (sx > m && sx < W - m && sy > m && sy < H - m) {
      const bob = Math.sin(time * 6) * 6;
      ctx.save();
      ctx.translate(sx, sy - 60 + bob);
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-12, -10); ctx.lineTo(12, -10); ctx.lineTo(0, 8); ctx.closePath();
      ctx.stroke(); ctx.fill();
      ctx.restore();
      return;
    }
    const cx = W / 2, cy = H / 2, a = Math.atan2(sy - cy, sx - cx);
    const k = Math.min((W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
    const ex = cx + Math.cos(a) * k, ey = cy + Math.sin(a) * k;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.fillStyle = 'rgba(15,20,28,0.8)';
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.fill();
    ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(18, -9); ctx.lineTo(18, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    Gfx.text(ctx, icon, ex, ey + 1, { size: 18, stroke: null });
  }

  function drawHud() {
    // Order card.
    const o = s.order;
    if (o) {
      Gfx.card(ctx, 12, 12, 270, 58);
      Gfx.text(ctx, `📋 ${o.need} ${TYPES[o.type].name} logs`, 24, 30, { size: 13, align: 'left', stroke: null });
      Gfx.text(ctx, `+${money(o.reward)}`, 270, 30, { size: 13, align: 'right', color: '#8ef0a0', stroke: null });
      Gfx.bar(ctx, 24, 46, 246, 12, o.have / o.need, '#4cc26a');
      Gfx.text(ctx, `${o.have}/${o.need}`, 147, 52, { size: 10, stroke: 'rgba(0,0,0,0.6)', width: 3 });
    }
    // Load meter.
    const cap = capOf(s.lv.cap), n = s.load.length;
    Gfx.card(ctx, 12, H - 52, 200, 40);
    Gfx.text(ctx, '🪵', 30, H - 32, { size: 18, stroke: null });
    Gfx.bar(ctx, 48, H - 39, 150, 14, n / cap, n >= cap ? '#e5533d' : '#d59a4a');
    Gfx.text(ctx, `${n} / ${cap}`, 123, H - 32, { size: 11, stroke: 'rgba(0,0,0,0.6)', width: 3 });

    // Minimap.
    const mw = 150, ms = mw / WORLD_W, mh = WORLD_H * ms, mx = W - mw - 12, my = 12;
    Gfx.card(ctx, mx - 4, my - 4, mw + 8, mh + 8, { r: 8 });
    for (const [i, r] of [...ZONES.map((z, i) => [i, z]), [-1, YARD]]) {
      ctx.fillStyle = r.ground;
      ctx.globalAlpha = i >= 0 && !zoneOpen(i) ? 0.35 : 0.9;
      ctx.fillRect(mx + r.x * ms, my + r.y * ms, r.w * ms, r.h * ms);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + cam.x * ms, my + cam.y * ms, W * ms, H * ms);
    const dot = (x, y, c, r = 2.5) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(mx + x * ms, my + y * ms, r, 0, TAU); ctx.fill(); };
    dot(MILL_PAD.x, MILL_PAD.y, '#ffb347', 3);
    dot(GARAGE_PAD.x, GARAGE_PAD.y, '#57b6ff', 3);
    const pad = visiblePad();
    if (pad) dot(pad.x, pad.y, '#7ee081', 3);
    for (const t of trees) if (t.lucky > 0 && standing(t)) dot(t.x, t.y, '#ffd84a', 3);
    for (const h of helpers) dot(h.x, h.y, h.color, 2);
    dot(truck.x, truck.y, '#ffffff', 3.5);

    guide();

    // Touch joystick.
    if (joy) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(joy.sx, joy.sy, 50, 0, TAU); ctx.fill(); ctx.stroke();
      const dx = joy.x - joy.sx, dy = joy.y - joy.sy, m = Math.hypot(dx, dy), k = m > 50 ? 50 / m : 1;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(joy.sx + dx * k, joy.sy + dy * k, 20, 0, TAU); ctx.fill();
    }
  }

  let shown = {};
  function updateStats() {
    const vals = { cash: money(s.cash), load: `${s.load.length}/${capOf(s.lv.cap)}`, earned: money(s.lifetime) };
    for (const k in vals) if (shown[k] !== vals[k]) { $(k).textContent = vals[k]; shown[k] = vals[k]; }
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (overlayEl.hidden) update(dt);
    else time += dt;
    drawWorld();
    drawHud();
    updateStats();
    requestAnimationFrame(frame);
  }

  // ---------- Start ----------

  loadSave();
  truck.x = s.x; truck.y = s.y; truck.a = s.a;
  collide(truck);
  inGarage = dist(truck, GARAGE_PAD) < GARAGE_PAD.r;
  helpers = Array.from({ length: s.crew }, (_, i) => makeHelper(i));
  if (!s.order) newOrder();
  cam.x = Math.max(0, Math.min(WORLD_W - W, truck.x - W / 2));
  cam.y = Math.max(0, Math.min(WORLD_H - H, truck.y - H / 2));

  // The crew keeps working while you're away: half speed, up to two hours.
  const away = Math.min(7200, (Date.now() - s.saved) / 1000);
  let awayEarned = 0;
  if (s.crew > 0 && away > 60) {
    // One crew trip: drive to and cut each tree (about 2.5 s travel each), then ~25 s to the mill and back.
    const T = TYPES[s.unlocked - 1];
    const trip = crewCap() / T.logs * (2.5 + T.hp / crewDmg()) + 25;
    const perSec = s.crew * crewCap() * T.value * millMult(s.lv.mill) / trip;
    awayEarned = Math.round(perSec * away * 0.5);
    earn(awayEarned);
  }

  setInterval(persist, 5000);
  addEventListener('pagehide', persist);
  Arcade.onBlur(() => {
    persist();
    if (overlayEl.hidden) ui.show({ title: 'Paused', html: '<p>Your crew is waiting.</p>', button: 'Resume', onAction: () => ui.hide() });
  });

  const tips = `<ul>
      <li>Drive with <b>WASD</b> or the <b>arrow keys</b>, or drag anywhere on the screen.</li>
      <li>Drive into trees and your saw does the rest. Logs stack up on your truck.</li>
      <li>Park on <b>💰 SELL</b> at the sawmill to cash in your load.</li>
      <li>Drive onto <b>🔧 UPGRADE</b> to improve your truck and hire a crew.</li>
      <li>Stand on a <b>🔓 sign</b> to pay for a new forest with better trees.</li>
    </ul>`;
  if (!s.intro) {
    ui.show({ title: '🌲 Timber Haul', html: `<p>Clear the forests, fill the mill, build a logging empire.</p>${tips}`, button: 'Start hauling', onAction: () => { s.intro = true; persist(); ui.hide(); } });
  } else if (awayEarned > 0) {
    ui.show({ title: 'Welcome back!', html: `<p>Your crew kept hauling while you were away.</p><p class="big">+${money(awayEarned)}</p>`, button: 'Keep hauling', onAction: () => ui.hide() });
  } else {
    ui.show({ title: '🌲 Timber Haul', html: `<p>${money(s.cash)} in the bank · ${ZONES[s.unlocked - 1].name}</p>${tips}`, button: 'Keep hauling', onAction: () => ui.hide() });
  }
  requestAnimationFrame(frame);
})();
