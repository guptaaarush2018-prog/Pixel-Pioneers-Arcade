/* Speck Spire: a tiny square climbs a giant tower. 54 rooms in six zones, each built from hand-tuned
   obstacle modules (spikes, pits, saws, lasers, crumbling floors, bounce pads, ice, moving platforms),
   a checkpoint at every room, optional stars, and a boss gauntlet at the top of every zone.
   Rooms are generated from a fixed seed, so the tower is the same for everyone. */
(() => {
  const TS = 32, COLS = 30, ROWS = 18, W = COLS * TS, H = ROWS * TS;
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  // Tiles: 0 air, 1 solid, 2 spike, 3 crumble, 4 bounce pad, 5 ice
  const SOLID = new Set([1, 3, 4, 5]);

  const ZONES = [
    { name: 'The Cellar', bg: ['#10162b', '#1b2447'], wall: '#3a4a7a', top: '#7fa0ff', accent: '#9fb8ff', boss: 'The Warden' },
    { name: 'The Foundry', bg: ['#1f0f0d', '#4a1d14'], wall: '#7a3a2a', top: '#ff9a5a', accent: '#ffb27a', boss: 'The Smelter' },
    { name: 'Frost Hall', bg: ['#0c1d2b', '#1a4660'], wall: '#4a7a9a', top: '#c8f1ff', accent: '#aee6ff', boss: 'The Glacier' },
    { name: 'Clockwork', bg: ['#1b1a0d', '#463f14'], wall: '#7a6a2a', top: '#ffe27a', accent: '#ffd23f', boss: 'The Escapement' },
    { name: 'Skyline', bg: ['#0c1f1f', '#14504a'], wall: '#2f7a6a', top: '#7fffd8', accent: '#7ff2c8', boss: 'The Gale' },
    { name: 'The Apex', bg: ['#170d24', '#3a1a5a'], wall: '#6a3a9a', top: '#e0a0ff', accent: '#e6b8ff', boss: 'The Crown' },
  ];
  const ROOMS_PER_ZONE = 9; // eight rooms and a boss
  const TOTAL_ROOMS = ZONES.length * ROOMS_PER_ZONE;

  // ---------- Room generator ----------
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function buildRoom(n) {
    const zone = Math.floor(n / ROOMS_PER_ZONE), idx = n % ROOMS_PER_ZONE;
    const r = rng(9001 + n * 7919);
    const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const tiles = new Uint8Array(COLS * ROWS);
    const room = { n, zone, idx, tiles, saws: [], lasers: [], movers: [], stars: [], checkpoints: [], boss: idx === ROOMS_PER_ZONE - 1, spawn: { x: 40, y: 0 }, bossT: 0, bossDone: false, spawners: [] };
    const set = (c, rr, v) => { if (c >= 0 && c < COLS && rr >= 0 && rr < ROWS) tiles[rr * COLS + c] = v; };
    const col = (c, top, v = 1) => { for (let rr = top; rr < ROWS; rr++) set(c, rr, v); };
    const d = Math.min(1, (zone * ROOMS_PER_ZONE + idx) / (TOTAL_ROOMS - 1));
    const has = f => zone >= f;

    if (room.boss) { buildBoss(room, zone, set, col); return room; }

    let h = 14;                      // current ground surface row
    let c = 0;
    const flat = (len, v = 1) => { for (let i = 0; i < len && c < COLS; i++, c++) col(c, h, v); };
    flat(4);
    room.spawn = { x: 2 * TS, y: h * TS - 14 };
    const endCols = 3;
    const pool = ['flat', 'spikes', 'pit', 'step', 'plats'];
    if (has(1)) pool.push('saw', 'bounce', 'saw');
    if (has(2)) pool.push('ice', 'ice');
    if (has(3)) pool.push('laser', 'mover', 'laser');
    if (has(4)) pool.push('crumble', 'crumble');
    if (has(5)) pool.push('saw', 'laser', 'crumble', 'mover');
    let guard = 0, last = '';
    let starPlaced = r() < 0.7;
    while (c < COLS - endCols - 1 && guard++ < 40) {
      let kind = pool[ri(0, pool.length - 1)];
      if (kind === last && kind !== 'flat') kind = 'flat';
      last = kind;
      const left = COLS - endCols - 1 - c;
      if (left < 4) { flat(left); break; }
      switch (kind) {
        case 'flat': flat(Math.min(left, ri(2, 3))); break;
        case 'spikes': {
          const w = Math.min(3, 1 + Math.floor(d * 3 * r() + 0.6));
          flat(1);
          for (let i = 0; i < w && c < COLS; i++, c++) { col(c, h); set(c, h - 1, 2); }
          flat(Math.min(2, COLS - c));
          break;
        }
        case 'pit': {
          const g = Math.min(left - 2, ri(2, Math.min(4, 2 + Math.floor(d * 3))));
          flat(1);
          c += g;
          // Floor resumes at the same height.
          flat(2);
          break;
        }
        case 'step': {
          const dh = (r() < 0.5 ? -1 : 1) * ri(1, 2);
          const nh = Math.max(9, Math.min(15, h + dh));
          flat(1); h = nh; flat(Math.min(3, COLS - c));
          break;
        }
        case 'plats': {
          const g = Math.min(left - 3, ri(7, 10));
          if (g < 6) { flat(2); break; }
          flat(1);
          let end = c + g, px = c;
          while (px < end - 1) {
            const w = ri(2, 3), py = h + ri(-2, 1);
            for (let i = 0; i < w && px + i < end; i++) set(px + i, Math.min(py, 16), 1);
            if (!starPlaced && r() < 0.4) { room.stars.push({ x: (px + w / 2) * TS, y: (py - 3) * TS + 8 }); starPlaced = true; }
            px += w + ri(2, 3);
          }
          // Last platform must reach the far side.
          set(end - 1, h, 1); set(end - 2, h, 1);
          c = end; flat(1);
          break;
        }
        case 'saw': {
          const len = Math.min(left, ri(6, 8));
          flat(1);
          const sx = (c + Math.floor(len / 2)) * TS + TS / 2;
          flat(len - 1);
          room.saws.push({ x: sx, y0: (h - 4.2) * TS, y1: (h - 0.6) * TS, period: 2.6 - d * 0.7, phase: r() * 3, r: 13, kind: 'v' });
          break;
        }
        case 'laser': {
          const len = Math.min(left, ri(6, 8));
          flat(1);
          const lx = (c + 2) * TS + TS / 2;
          flat(len - 1);
          room.lasers.push({ x: lx, y0: 0, y1: h * TS, period: 2.4 - d * 0.5, on: 0.9, phase: r() * 2, w: 6 });
          if (len > 6) room.lasers.push({ x: lx + TS * 3, y0: 0, y1: h * TS, period: 2.4 - d * 0.5, on: 0.9, phase: 1.2 + r() * 2, w: 6 });
          break;
        }
        case 'bounce': {
          if (h < 11 || left < 9) { flat(2); break; }
          flat(1);
          set(c, h, 4); col(c, h + 1); c++;
          const up = ri(4, 5);
          const gapW = 2;
          c += gapW;
          const nh = h - up;
          h = nh; flat(Math.min(3, COLS - c));
          break;
        }
        case 'ice': {
          const len = Math.min(left, ri(5, 7));
          flat(1);
          for (let i = 0; i < len - 1 && c < COLS; i++, c++) col(c, h, 5);
          // Spikes at the end of the slide, so you must stop or hop.
          if (c + 3 < COLS - endCols) { flat(1); col(c, h); set(c, h - 1, 2); c++; flat(1); }
          break;
        }
        case 'crumble': {
          const g = Math.min(left - 3, ri(7, 10));
          if (g < 6) { flat(2); break; }
          flat(1);
          const end = c + g;
          let px = c;
          while (px < end - 1) { for (let i = 0; i < 2 && px + i < end; i++) set(px + i, h + 1, 3); px += 2 + ri(1, 2); }
          set(end - 1, h, 1); set(end - 2, h, 1);
          c = end; flat(1);
          break;
        }
        case 'mover': {
          const g = Math.min(left - 3, 9);
          if (g < 8) { flat(2); break; }
          flat(1);
          room.movers.push({ x0: c * TS, x1: (c + g - 3) * TS, y: h * TS + 8, w: 3 * TS, speed: 70 + d * 40, phase: 0 });
          c += g;
          flat(2);
          break;
        }
      }
    }
    // Fill to the right edge so the exit lies on solid ground at a safe height.
    while (c < COLS) col(c++, h);
    room.exitY = h * TS;
    // Mid-room checkpoint on solid ground.
    room.checkpoints.push({ x: 14 * TS + 6, y: h * TS - 24, w: 24, h: 24 });
    // Make sure the last 3 columns are flat and clear.
    for (let cc = COLS - 3; cc < COLS; cc++) { for (let rr = 0; rr < ROWS; rr++) set(cc, rr, rr >= h ? 1 : 0); }
    // Ground under spawn is clear and flat.
    if (room.stars.length === 0 && starPlaced) room.stars.push({ x: (COLS - 6) * TS, y: (h - 3) * TS });
    return room;
  }

  function buildBoss(room, zone, set, col) {
    // A wide arena: floor, three platforms, the exit locked until the boss is survived.
    for (let c = 0; c < COLS; c++) col(c, 15);
    for (const [pc, pr] of [[4, 11], [13, 9], [22, 11], [9, 6], [18, 6]]) for (let i = 0; i < 4; i++) set(pc + i, pr, 1);
    room.spawn = { x: 2 * TS, y: 15 * TS - 14 };
    room.bossT = 0; room.bossLen = 24 + zone * 3;
    room.exitY = 15 * TS;
    // Door: the right edge is walled until the gauntlet ends.
    room.doorCols = [28, 29];
    for (const c of room.doorCols) for (let r = 0; r < 15; r++) set(c, r, 1);
    room.stars.push({ x: 13.5 * TS + 16, y: 9 * TS - 40 });
  }

  // ---------- Save ----------
  let save = { room: 0, best: 0, stars: {}, deaths: 0, time: 0, seen: false, bestTime: 0, bestDeaths: 0, complete: false, ...Arcade.load('ss:save', {}) };
  const persist = () => Arcade.save('ss:save', save);
  const starCount = () => Object.keys(save.stars).length;
  const boardScore = () => save.best * 100 + starCount() * 500 + (save.complete ? Math.max(1000, 30000 - save.bestTime * 8 - save.bestDeaths * 40) : 0);

  const canvas = $('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay($('overlay'));
  const overlayEl = $('overlay');
  const tone = o => Arcade.tone(o);

  // ---------- Game state ----------
  let state = 'menu', R = null, P = null, last = performance.now();
  let run = { deaths: 0, time: 0, stars: 0 };
  const keys = {};
  let jumpBuf = 0;
  const crumbles = new Map();
  let fall = [];
  let shake = 0, fade = 0, deadT = 0;
  const trail = [];

  function loadRoom(n, keepRun) {
    R = buildRoom(n);
    R.t = 0;
    crumbles.clear(); fall = [];
    R.got = new Set();
    R.cp = null;
    P = { x: R.spawn.x, y: R.spawn.y, w: 12, h: 12, vx: 0, vy: 0, ground: false, coyote: 0, dead: false, face: 1, onIce: false, ride: null };
    R.bossT = 0; R.shots = []; R.blocks = []; R.bossOpen = false; R.bossAt = 0;
    if (R.boss) R.bossX = W / 2;
    state = 'play';
    ui.hide();
    updateHud();
    banner = { text: R.boss ? `${ZONES[R.zone].name} · ${ZONES[R.zone].boss}` : `${ZONES[R.zone].name} · Room ${R.idx + 1}`, t: 2.2, sub: `Floor ${n + 1} of ${TOTAL_ROOMS}` };
  }
  let banner = null;
  const tileAt = (c, r) => (c < 0 || c >= COLS ? (r >= 0 && r < ROWS ? 1 : 0) : r < 0 ? 0 : r >= ROWS ? 0 : R.tiles[r * COLS + c]);
  const solidAt = (c, r) => {
    const t = tileAt(c, r);
    if (t === 3) { const k = crumbles.get(r * COLS + c); return !(k !== undefined && k > 0.4); }
    return SOLID.has(t);
  };
  const solidRect = (x, y, w, h) => {
    const c0 = Math.floor(x / TS), c1 = Math.floor((x + w - 0.001) / TS), r0 = Math.floor(y / TS), r1 = Math.floor((y + h - 0.001) / TS);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solidAt(c, r)) return true;
    return false;
  };

  // ---------- Hazards ----------
  const sawPos = s => { const k = (Math.sin((R.t + s.phase) / s.period * TAU) + 1) / 2; return { x: s.x, y: s.y0 + (s.y1 - s.y0) * k }; };
  const laserOn = l => ((R.t + l.phase) % l.period) < l.on;
  const laserWarn = l => { const k = (R.t + l.phase) % l.period; return k > l.period - 0.5; };
  const moverPos = m => { const k = (Math.sin((R.t + m.phase) * m.speed / (m.x1 - m.x0) * Math.PI) + 1) / 2; return { x: m.x0 + (m.x1 - m.x0) * k, y: m.y }; };

  function die() {
    if (P.dead) return;
    P.dead = true; deadT = 0; shake = 0.5; run.deaths++;
    for (let i = 0; i < 24; i++) { const a = Math.random() * TAU, s = 80 + Math.random() * 240; sparks.push({ x: P.x + 6, y: P.y + 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, max: 0.7 }); }
    tone({ freq: 260, to: 50, dur: 0.35, type: 'sawtooth', vol: 0.07 });
    if (run.deaths >= 100) Arcade.flag('speck-spire-100');
  }
  const sparks = [];
  function respawn() {
    const sp = R.cp || R.spawn;
    P = { x: sp.x, y: sp.y, w: 12, h: 12, vx: 0, vy: 0, ground: false, coyote: 0, dead: false, face: 1, onIce: false, ride: null };
    crumbles.clear();
    if (R.boss) { R.bossT = 0; R.shots = []; R.blocks = []; R.bossOpen = false; }
  }

  // ---------- Update ----------
  function update(dt) {
    R.t += dt; run.time += dt;
    if (P.dead) { deadT += dt; if (deadT > 0.6) respawn(); stepFx(dt); return; }
    const left = keys.left, right = keys.right;
    const inp = (right ? 1 : 0) - (left ? 1 : 0);
    const ice = P.onIce;
    const accel = P.ground ? (ice ? 520 : 2600) : 1700;
    const fric = P.ground ? (ice ? 260 : 3000) : 300;
    const max = 215;
    if (inp) { P.vx += inp * accel * dt; if (Math.abs(P.vx) > max) P.vx = Math.sign(P.vx) * max; P.face = inp; }
    else { const f = fric * dt; P.vx = Math.abs(P.vx) <= f ? 0 : P.vx - Math.sign(P.vx) * f; }
    // Jump.
    P.coyote = P.ground ? 0.09 : P.coyote - dt;
    jumpBuf -= dt;
    if (jumpBuf > 0 && P.coyote > 0) { P.vy = -590; P.ground = false; P.coyote = 0; jumpBuf = 0; tone({ freq: 320, to: 620, dur: 0.1, type: 'square', vol: 0.03 }); }
    if (!keys.jump && P.vy < -230) P.vy = -230;
    P.vy = Math.min(780, P.vy + 1750 * dt);
    // Moving platforms carry the rider.
    let carry = 0;
    if (P.ride) carry = P.ride.dx;
    // Horizontal.
    moveX(P.vx * dt + carry);
    // Vertical with platform collision.
    moveY(P.vy * dt);
    // Moving platform landing.
    P.ride = null;
    for (const m of R.movers) {
      const mp = moverPos(m), prev = m.prev || mp;
      m.dx = mp.x - prev.x; m.prev = mp;
      if (P.vy >= 0 && P.x + P.w > mp.x && P.x < mp.x + m.w && P.y + P.h >= mp.y - 2 && P.y + P.h <= mp.y + 10) { P.y = mp.y - P.h; P.vy = 0; P.ground = true; P.ride = m; }
    }
    // Crumble timers and ice detect.
    P.onIce = false;
    if (P.ground) {
      const c0 = Math.floor(P.x / TS), c1 = Math.floor((P.x + P.w) / TS), r = Math.floor((P.y + P.h + 1) / TS);
      for (let c = c0; c <= c1; c++) {
        const t = tileAt(c, r);
        if (t === 5) P.onIce = true;
        if (t === 3 && !crumbles.has(r * COLS + c)) crumbles.set(r * COLS + c, 0.001);
        if (t === 4) { P.vy = -930; P.ground = false; tone({ freq: 200, to: 800, dur: 0.2, type: 'sine', vol: 0.06 }); shake = 0.15; }
      }
    }
    for (const [k, v] of crumbles) crumbles.set(k, v + dt);
    // Hazards.
    const cxp = P.x + P.w / 2, cyp = P.y + P.h / 2;
    for (const s of R.saws) { const sp = sawPos(s); if (Math.hypot(sp.x - cxp, sp.y - cyp) < s.r + 5) { die(); return; } }
    for (const l of R.lasers) if (laserOn(l) && Math.abs(l.x - cxp) < l.w / 2 + 5 && cyp > l.y0 && cyp < l.y1) { die(); return; }
    // Spikes: the lower half of the tile.
    {
      const c0 = Math.floor(P.x / TS), c1 = Math.floor((P.x + P.w - 0.01) / TS), r0 = Math.floor(P.y / TS), r1 = Math.floor((P.y + P.h - 0.01) / TS);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (tileAt(c, r) === 2 && P.y + P.h > r * TS + 14 && P.x + P.w > c * TS + 3 && P.x < c * TS + TS - 3) { die(); return; }
    }
    if (P.y > H + 40) { die(); return; }
    // Stars.
    for (const [i, s] of R.stars.entries()) if (!R.got.has(i) && Math.hypot(s.x - cxp, s.y - cyp) < 16) { R.got.add(i); run.stars++; const key = R.n + ':' + i; if (!save.stars[key]) { save.stars[key] = 1; persist(); } tone({ freq: 900, to: 1500, dur: 0.15, type: 'triangle', vol: 0.05 }); Arcade.flag('speck-spire-star'); if (starCount() >= 20) Arcade.flag('speck-spire-stars-20'); }
    // Checkpoints.
    for (const cp of R.checkpoints) if (!R.cp && Math.hypot(cxp - cp.x, cyp - cp.y) < 20) { R.cp = { x: cp.x, y: cp.y }; tone({ freq: 800, to: 1400, dur: 0.1, type: 'triangle', vol: 0.04 }); shake = 0.1; }
    // Boss gauntlet.
    if (R.boss) bossUpdate(dt);
    // Exit.
    if (P.x > W - 14 && (!R.boss || R.bossOpen)) nextRoom();
    // Particles trail.
    trail.push({ x: P.x + 6, y: P.y + 6, life: 0.25 }); if (trail.length > 20) trail.shift();
    stepFx(dt);
    updateHud();
  }
  function stepFx(dt) {
    for (const s of sparks) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 600 * dt; }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
    for (const t of trail) t.life -= dt;
    shake = Math.max(0, shake - dt * 2);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
  }
  function moveX(dx) {
    if (!dx) return;
    const step = Math.sign(dx);
    let rem = Math.abs(dx);
    while (rem > 0) {
      const s = Math.min(rem, 2);
      if (solidRect(P.x + step * s, P.y, P.w, P.h)) { P.vx = 0; break; }
      P.x += step * s; rem -= s;
    }
    if (P.x < 0) { P.x = 0; P.vx = 0; }
    if (P.x > W - P.w && !(R.boss ? R.bossOpen : true)) { P.x = W - P.w; }
  }
  function moveY(dy) {
    P.ground = false;
    const step = Math.sign(dy) || 1;
    let rem = Math.abs(dy);
    while (rem > 0) {
      const s = Math.min(rem, 2);
      if (solidRect(P.x, P.y + step * s, P.w, P.h)) { if (dy > 0) P.ground = true; P.vy = 0; break; }
      P.y += step * s; rem -= s;
    }
    if (dy === 0 && solidRect(P.x, P.y + 1, P.w, P.h)) P.ground = true;
  }

  function bossUpdate(dt) {
    R.bossT += dt;
    const z = R.zone, len = R.bossLen;
    R.bossX = W / 2 + Math.sin(R.bossT * (0.6 + z * 0.1)) * 300;
    if (R.bossT < len) {
      R.bossAt -= dt;
      if (R.bossAt <= 0) {
        R.bossAt = Math.max(0.55, 1.6 - z * 0.15);
        const pattern = Math.floor(R.bossT / 6) % 3;
        const bx = R.bossX, by = 70;
        if (pattern === 0) { for (let i = -2; i <= 2; i++) R.shots.push({ x: bx, y: by, vx: i * 70, vy: 170, r: 7 }); }
        else if (pattern === 1) { const a = Math.atan2(P.y - by, P.x - bx); for (let i = -1; i <= 1; i++) R.shots.push({ x: bx, y: by, vx: Math.cos(a + i * 0.25) * 240, vy: Math.sin(a + i * 0.25) * 240, r: 7 }); }
        else { R.blocks.push({ x: Math.floor((P.x + P.w / 2) / TS) * TS, y: -TS, t: 0, warn: 0.7 }); R.blocks.push({ x: ((Math.floor((P.x + P.w / 2) / TS) + 5) % COLS) * TS, y: -TS, t: 0, warn: 0.9 }); }
        // Higher zones: also rain.
        if (z >= 3) R.blocks.push({ x: Math.floor(Math.random() * COLS) * TS, y: -TS, t: 0, warn: 0.8 });
      }
    } else if (!R.bossOpen) {
      R.bossOpen = true;
      for (const c of R.doorCols) for (let r = 0; r < 15; r++) R.tiles[r * COLS + c] = 0;
      R.shots = []; R.blocks = [];
      tone({ freq: 523, to: 1046, dur: 0.5, type: 'triangle', vol: 0.06 });
      banner = { text: 'The way is open', t: 2.5, sub: '' };
      Arcade.flag('speck-spire-boss');
    }
    for (const s of R.shots) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (Math.hypot(s.x - (P.x + 6), s.y - (P.y + 6)) < s.r + 5) { die(); return; }
    }
    R.shots = R.shots.filter(s => s.y < H + 20 && s.x > -20 && s.x < W + 20);
    for (const b of R.blocks) {
      b.t += dt;
      if (b.t > b.warn) { b.y += 700 * dt; if (P.x + P.w > b.x && P.x < b.x + TS && P.y + P.h > b.y && P.y < b.y + TS) { die(); return; } }
    }
    R.blocks = R.blocks.filter(b => b.y < H + 40);
  }

  function nextRoom() {
    const n = R.n;
    Arcade.flag('speck-spire-room');
    if (n + 1 > save.best) save.best = n + 1;
    if (R.boss) Arcade.flag('speck-spire-boss-win');
    if (n + 1 >= TOTAL_ROOMS) { finishRun(); return; }
    save.room = n + 1;
    persist();
    tone({ freq: 440, to: 880, dur: 0.15, type: 'triangle', vol: 0.05 });
    loadRoom(n + 1);
  }
  function finishRun() {
    state = 'over';
    save.complete = true;
    const t = Math.floor(run.time);
    if (!save.bestTime || t < save.bestTime) { save.bestTime = t; save.bestDeaths = run.deaths; }
    save.room = 0;
    persist();
    Arcade.flag('speck-spire-top');
    if (run.deaths === 0) Arcade.flag('speck-spire-flawless');
    tone({ freq: 523, to: 1568, dur: 1, type: 'triangle', vol: 0.07 });
    Arcade.finish(ui, {
      score: boardScore(), title: 'You reached the top',
      html: `<p>${mmss(run.time)} · ${run.deaths} deaths · ${starCount()} stars collected</p><div class="ss-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>`,
      button: 'Climb again', onAction: () => { run = { deaths: 0, time: 0, stars: 0 }; loadRoom(0); },
    });
  }
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function updateHud() {
    $('s-room').textContent = R ? `${R.n + 1}/${TOTAL_ROOMS}` : '–';
    $('s-deaths').textContent = run.deaths;
    $('s-time').textContent = mmss(run.time);
  }

  // ---------- Drawing ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!R) { ctx.fillStyle = '#0b0e18'; ctx.fillRect(0, 0, W, H); return; }
    const Z = ZONES[R.zone];
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, Z.bg[0]); g.addColorStop(1, Z.bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Far pillars.
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 140 + 20, 0, 40, H);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
    // Tiles.
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = R.tiles[r * COLS + c];
      if (!t) continue;
      const x = c * TS, y = r * TS;
      if (t === 2) { ctx.fillStyle = '#ff5d73'; for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 16, y + TS); ctx.lineTo(x + i * 16 + 8, y + 12); ctx.lineTo(x + i * 16 + 16, y + TS); ctx.closePath(); ctx.fill(); } continue; }
      if (t === 3) { const k = crumbles.get(r * COLS + c); if (k !== undefined && k > 0.4) continue; ctx.fillStyle = '#b88a4a'; ctx.fillRect(x, y + (k ? Math.sin(k * 60) * 1.5 : 0), TS, TS - 8); ctx.fillStyle = '#e0b070'; ctx.fillRect(x, y + (k ? Math.sin(k * 60) * 1.5 : 0), TS, 4); continue; }
      ctx.fillStyle = t === 5 ? '#9fdcf5' : Z.wall; ctx.fillRect(x, y, TS, TS);
      const above = r > 0 ? R.tiles[(r - 1) * COLS + c] : 0;
      if (!SOLID.has(above)) { ctx.fillStyle = t === 5 ? '#e6fbff' : t === 4 ? '#ff7ad0' : Z.top; ctx.fillRect(x, y, TS, t === 4 ? 6 : 4); }
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x, y + TS - 2, TS, 2);
    }
    // Moving platforms.
    for (const m of R.movers) { const p = moverPos(m); ctx.fillStyle = Z.accent; ctx.fillRect(p.x, p.y, m.w, 10); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(p.x, p.y + 6, m.w, 4); }
    // Lasers.
    for (const l of R.lasers) {
      ctx.fillStyle = '#444'; ctx.fillRect(l.x - 8, l.y0, 16, 10); ctx.fillRect(l.x - 8, l.y1 - 3, 16, 3);
      if (laserOn(l)) { ctx.fillStyle = '#ff3b6b'; ctx.shadowColor = '#ff3b6b'; ctx.shadowBlur = 14; ctx.fillRect(l.x - l.w / 2, l.y0 + 10, l.w, l.y1 - l.y0 - 10); ctx.shadowBlur = 0; }
      else if (laserWarn(l)) { ctx.fillStyle = 'rgba(255,59,107,.35)'; ctx.fillRect(l.x - 1, l.y0 + 10, 2, l.y1 - l.y0 - 10); }
    }
    // Saws.
    for (const s of R.saws) {
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x, s.y0); ctx.lineTo(s.x, s.y1); ctx.stroke();
      const p = sawPos(s);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(R.t * 10);
      ctx.fillStyle = '#d6dbe8'; ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = i * TAU / 16, rr = i % 2 ? s.r - 4 : s.r + 3; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5a6070'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill(); ctx.restore();
    }
    // Boss.
    if (R.boss) {
      const bx = R.bossX, by = 56;
      ctx.fillStyle = Z.accent; ctx.shadowColor = Z.accent; ctx.shadowBlur = 24; ctx.beginPath(); ctx.arc(bx, by, 34, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(bx - 12, by - 4, 6, 0, TAU); ctx.arc(bx + 12, by - 4, 6, 0, TAU); ctx.fill(); ctx.fillRect(bx - 14, by + 12, 28, 4);
      for (const s of R.shots) { ctx.fillStyle = '#ff5d73'; ctx.shadowColor = '#ff5d73'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }
      for (const b of R.blocks) { if (b.t < b.warn) { ctx.fillStyle = 'rgba(255,60,90,.22)'; ctx.fillRect(b.x, 0, TS, H); } else { ctx.fillStyle = '#ff5d73'; ctx.fillRect(b.x, b.y, TS, TS); ctx.strokeStyle = '#fff'; ctx.strokeRect(b.x + 2, b.y + 2, TS - 4, TS - 4); } }
      // Timer bar.
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W / 2 - 150, 8, 300, 8); ctx.fillStyle = R.bossOpen ? '#7be36a' : Z.accent; ctx.fillRect(W / 2 - 150, 8, 300 * Math.min(1, R.bossT / R.bossLen), 8);
    }
    // Stars.
    R.stars.forEach((s, i) => { if (R.got.has(i)) return; ctx.save(); ctx.translate(s.x, s.y + Math.sin(R.t * 3 + i) * 3); ctx.fillStyle = '#ffd23f'; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 12; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 5 : 11; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.restore(); });
    // Exit marker.
    if (!R.boss || R.bossOpen) { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(W - 10, (R.exitY || 14 * TS) - 90, 10, 90); ctx.fillStyle = Z.accent; ctx.beginPath(); ctx.moveTo(W - 22, (R.exitY || 14 * TS) - 50); ctx.lineTo(W - 12, (R.exitY || 14 * TS) - 40); ctx.lineTo(W - 22, (R.exitY || 14 * TS) - 30); ctx.fill(); }
    // Checkpoints.
    for (const cp of R.checkpoints) {
      const active = R.cp && R.cp.x === cp.x && R.cp.y === cp.y;
      ctx.fillStyle = active ? '#7be36a' : '#ffd23f';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = active ? 16 : 10;
      ctx.fillRect(cp.x - 2, cp.y - 2, cp.w + 4, cp.h + 4);
      ctx.shadowBlur = 0;
    }
    // Player.
    for (const t of trail) { if (t.life > 0) { ctx.globalAlpha = t.life * 1.5; ctx.fillStyle = '#fff'; ctx.fillRect(t.x - 3, t.y - 3, 6, 6); ctx.globalAlpha = 1; } }
    if (!P.dead) {
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; ctx.fillRect(P.x, P.y, P.w, P.h); ctx.shadowBlur = 0;
      ctx.fillStyle = '#111'; ctx.fillRect(P.x + (P.face > 0 ? 7 : 2), P.y + 3, 3, 3);
    }
    for (const s of sparks) { ctx.globalAlpha = Math.max(0, s.life / s.max); ctx.fillStyle = '#fff'; ctx.fillRect(s.x - 2, s.y - 2, 4, 4); ctx.globalAlpha = 1; }
    ctx.restore();
    if (banner) { ctx.globalAlpha = Math.min(1, banner.t); ctx.font = 'bold 30px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; ctx.strokeText(banner.text, W / 2, 200); ctx.fillText(banner.text, W / 2, 200); if (banner.sub) { ctx.font = '16px system-ui'; ctx.lineWidth = 4; ctx.strokeText(banner.sub, W / 2, 232); ctx.fillText(banner.sub, W / 2, 232); } ctx.globalAlpha = 1; }
    if (state === 'paused') { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- Input ----------
  const bind = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyZ: 'jump' };
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'play' || state === 'paused') pauseToggle(); return; }
    const k = bind[e.code];
    if (!k) return;
    if (state === 'play') e.preventDefault();
    if (e.code === 'KeyR' && state === 'play') return;
    if (!keys[k] && k === 'jump') jumpBuf = 0.1;
    keys[k] = true;
  });
  addEventListener('keyup', e => { const k = bind[e.code]; if (k) keys[k] = false; });
  addEventListener('keydown', e => { if (e.code === 'KeyR' && state === 'play' && !P.dead) die(); });
  const hold = (id, k) => { const b = $(id); if (!b) return; b.addEventListener('pointerdown', e => { e.preventDefault(); if (k === 'jump') jumpBuf = 0.1; keys[k] = true; }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { keys[k] = false; }); };
  hold('t-left', 'left'); hold('t-right', 'right'); hold('t-jump', 'jump');
  function pauseToggle() {
    if (state === 'play') { state = 'paused'; ui.show({ title: 'Paused', html: '<div class="ss-row"><button class="btn secondary" data-act="menu" type="button">Quit to menu</button></div>', button: 'Resume', onAction: pauseToggle }); }
    else if (state === 'paused') { ui.hide(); state = 'play'; last = performance.now(); }
  }
  Arcade.onBlur(() => { if (state === 'play') pauseToggle(); keys.left = keys.right = keys.jump = false; });

  // ---------- Menus ----------
  function showMenu() {
    state = 'menu'; R = null;
    $('s-room').textContent = '–';
    ui.show({
      title: 'Pixel Pioneers Arcade',
      html: `<h2 class="ss-title">SPECK SPIRE</h2><p class="ss-note">You are very small. The tower is very big.</p>
        <div class="ss-menu">
          ${save.room > 0 ? `<button class="btn" data-act="continue" type="button">Continue · floor ${save.room + 1}</button>` : ''}
          <button class="btn ${save.room > 0 ? 'secondary' : ''}" data-act="new" type="button">${save.room > 0 ? 'New climb' : 'Start climbing'}</button>
          <button class="btn secondary" data-act="select" type="button">Room select</button>
          <button class="btn secondary" data-act="howto" type="button">How to play</button>
        </div><p class="ss-note">Furthest: floor ${save.best} · ${starCount()} stars${save.bestTime ? ' · best top-out ' + mmss(save.bestTime) : ''}</p>`,
      button: null,
    });
  }
  function showHowTo() {
    ui.show({
      title: 'How to play',
      html: `<ul style="text-align:left"><li><b>Move</b> with ← → or A D. <b>Jump</b> with Space, ↑ or W. Hold to jump higher.</li>
        <li>Reach the <b>right edge</b> of each room to climb to the next floor. Every room is a checkpoint.</li>
        <li>Spikes, saws and lasers kill instantly. <b>Pink pads</b> bounce, <b>amber blocks</b> crumble, <b>pale ice</b> is slippery. <b>R</b> restarts the room.</li>
        <li>Each zone ends with a <b>boss gauntlet</b>: survive its attacks until the door opens.</li>
        <li>Grab the <b>stars</b> for a higher leaderboard score. Finish the tower fast and with few deaths for a bonus.</li></ul>
        <div class="ss-row"><button class="btn" data-act="menu" type="button">Got it</button></div>`, button: null,
    });
  }
  function showSelect() {
    const zones = ZONES.map((z, zi) => {
      const btns = Array.from({ length: ROOMS_PER_ZONE }, (_, i) => { const n = zi * ROOMS_PER_ZONE + i, ok = n <= save.best; return `<button class="ss-rm ${i === 8 ? 'boss' : ''}" data-act="room" data-n="${n}" type="button" ${ok ? '' : 'disabled'}>${ok ? (i === 8 ? '★' : i + 1) : '🔒'}</button>`; }).join('');
      return `<div class="ss-zone" style="border-left:4px solid ${z.top}"><h3>${zi + 1}. ${z.name}</h3><div class="ss-rms">${btns}</div></div>`;
    }).join('');
    ui.show({ title: 'Room select', html: `<div class="ss-top"><button class="btn secondary" data-act="menu" type="button">← Menu</button><span>${starCount()} stars</span></div>${zones}`, button: null });
  }
  overlayEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'menu': showMenu(); break;
      case 'howto': showHowTo(); break;
      case 'select': showSelect(); break;
      case 'new': run = { deaths: 0, time: 0, stars: 0 }; save.room = 0; loadRoom(0); break;
      case 'continue': run = { deaths: 0, time: 0, stars: 0 }; loadRoom(save.room); break;
      case 'room': run = { deaths: 0, time: 0, stars: 0 }; loadRoom(+d.n); break;
    }
  });

  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (R && state === 'play') update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  showMenu();
  if (!save.seen) { save.seen = true; persist(); showHowTo(); }
  requestAnimationFrame(frame);
  window.__ss = { buildRoom, TOTAL_ROOMS };
})();
