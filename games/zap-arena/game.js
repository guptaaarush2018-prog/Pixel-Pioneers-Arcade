/* Zap Arena: a fast first-person laser-tag arena against bots. Free-for-all: first to 20 tags,
   or the most tags when the clock runs out. Momentum movement (air strafing, bunny hops,
   slides, jump pads) and three blasters. Everyone who gets tagged just respawns. */
(() => {
  const ID = 'zap-arena';
  const W = 960, H = 540;
  const TAGS_TO_WIN = 20, MATCH_TIME = 210, BOTS = 5;
  // Live 1v1 against a real player (live.js): shorter race, and nobody else in the arena.
  const LIVE_TAGS = 15, LIVE_TIME = 240;
  const GRAV = 22, JUMP = 8, EYE = 1.6, EYE_LOW = 1.0, PW = 0.35, PH = 1.8, PH_LOW = 1.15;
  const PREFS_KEY = 'zap:prefs';

  const glCanvas = document.getElementById('game'), hudCanvas = document.getElementById('hud');
  const G = GL3D.setup(glCanvas, hudCanvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  if (!G) {
    ui.show({ title: 'Zap Arena', html: '<p>This game needs WebGL, which this browser has turned off.</p>', button: 'Back to the arcade', onAction: () => { location.href = '../../index.html'; } });
    return;
  }
  const gl = G.gl, hud = G.hud, hex = GL3D.hex;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  // ---------- Weapons ----------

  const WEAPONS = [
    { id: 'blaster', name: 'Pulse Blaster', dmg: 12, head: 1.6, rate: 0.115, mag: 30, reload: 1.3, spread: 0.014, pellets: 1, range: 90, color: [0.3, 0.9, 1], zoom: 0.95, auto: true },
    { id: 'scatter', name: 'Scatter Zapper', dmg: 10, head: 1.3, rate: 0.8, mag: 6, reload: 1.6, spread: 0.075, pellets: 9, range: 32, falloff: 8, color: [1, 0.55, 0.2], zoom: 0.95 },
    { id: 'rail', name: 'Rail Lance', dmg: 85, head: 1.85, rate: 1.1, mag: 5, reload: 1.8, spread: 0.035, zoomSpread: 0, pellets: 1, range: 160, color: [1, 0.3, 0.9], zoom: 0.42 },
  ];

  // ---------- Maps ----------

  // Boxes: [x0, y0, z0, x1, y1, z1, colour]. Pads: [x, z, upward speed, push x, push z].
  function stairs(out, x0, x1, zStart, dir, steps, color) {
    // Steps 0.5 high and 1 deep, climbing toward zStart + dir * steps.
    for (let k = 0; k < steps; k++) {
      const za = zStart + dir * k, zb = za + dir;
      out.push([x0, 0, Math.min(za, zb), x1, (k + 1) * 0.5, Math.max(za, zb), color]);
    }
  }
  function crateYard() {
    const b = [], C1 = '#e08a3c', C2 = '#3fb6a8', C3 = '#5866d6', WALL = '#2b3346', PLAT = '#46506a';
    const S = 32;
    b.push([-S - 1, 0, -S - 1, S + 1, 8, -S, WALL], [-S - 1, 0, S, S + 1, 8, S + 1, WALL], [-S - 1, 0, -S, -S, 8, S, WALL], [S, 0, -S, S + 1, 8, S, WALL]);
    // Centre platform with stairs north and south.
    b.push([-4, 0, -4, 4, 3, 4, PLAT]);
    stairs(b, -1.5, 1.5, 10, -1, 6, '#56607c');
    stairs(b, -1.5, 1.5, -10, 1, 6, '#56607c');
    // Catwalks to east and west ledges.
    b.push([4, 2.6, -1, 18, 3, 1, '#39425a'], [-18, 2.6, -1, -4, 3, 1, '#39425a']);
    b.push([18, 0, -3, 24, 3, 3, PLAT], [-24, 0, -3, -18, 3, 3, PLAT]);
    // Corner towers (jump pads get you up).
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.push([sx * 20 - 3, 0, sz * 20 - 3, sx * 20 + 3, 5, sz * 20 + 3, '#3b4560']);
    // Crates.
    const crates = [[-10, -14, 2, C1], [-8, -14, 2, C1], [-9, -14, 4, C1], [10, 14, 2, C1], [12, 14, 2, C2], [11, 14, 4, C1], [-14, 8, 2, C2], [14, -8, 2, C2],
      [-22, 12, 2, C3], [22, -12, 2, C3], [6, -20, 2, C1], [-6, 20, 2, C1], [-26, -6, 2, C2], [26, 6, 2, C2], [0, -24, 2, C3], [0, 24, 2, C3], [-13, -24, 2, C2], [13, 24, 2, C2],
      [8, 8, 1, C3], [-8, -8, 1, C3], [8, -8, 1, C1], [-8, 8, 1, C1]];
    for (const [x, z, hgt, c] of crates) {
      const y0 = hgt === 4 ? 2 : 0, top = hgt === 4 ? 4 : hgt;
      b.push([x - 1, y0, z - 1, x + 1, top, z + 1, c]);
    }
    const pads = [];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) pads.push([sx * 14.5, sz * 20, 13.5, sx * 4.2, 0]);
    pads.push([28, 0, 12.5, -5, 0], [-28, 0, 12.5, 5, 0]);
    const spawns = [[-28, 0, -28], [28, 0, 28], [-28, 0, 28], [28, 0, -28], [0, 0, -29], [0, 0, 29], [-29, 0, 0], [29, 0, 0], [0, 3, 0], [-21, 3, 0], [21, 3, 0]];
    return { name: 'Crate Yard', boxes: b, pads, spawns, size: S, floor: ['#1d2333', '#232a3d'], trim: [0.2, 0.9, 1], sky: [0.05, 0.06, 0.11] };
  }
  function pillarHall() {
    const b = [], WALL = '#33283f', P = '#5a3f73', BAL = '#463359';
    const S = 26;
    b.push([-S - 1, 0, -S - 1, S + 1, 9, -S, WALL], [-S - 1, 0, S, S + 1, 9, S + 1, WALL], [-S - 1, 0, -S, -S, 9, S, WALL], [S, 0, -S, S + 1, 9, S, WALL]);
    // A grid of pillars.
    for (let x = -15; x <= 15; x += 10) for (let z = -15; z <= 15; z += 10) if (!(Math.abs(x) === 5 && Math.abs(z) === 5)) b.push([x - 1, 0, z - 1, x + 1, 9, z + 1, P]);
    // Balconies along the north and south walls, with stairs at each end.
    b.push([-14, 0, -S, 14, 3, -S + 5, BAL], [-14, 0, S - 5, 14, 3, S, BAL]);
    stairs(b, -18, -14, -S + 5, 1, 6, '#6b4f87'); stairs(b, 14, 18, -S + 5, 1, 6, '#6b4f87');
    stairs(b, -18, -14, S - 5, -1, 6, '#6b4f87'); stairs(b, 14, 18, S - 5, -1, 6, '#6b4f87');
    // Low cover in the middle.
    for (const [x, z] of [[0, 0], [-6, 0], [6, 0], [0, -6], [0, 6]]) b.push([x - 1.2, 0, z - 1.2, x + 1.2, 1.1, z + 1.2, '#d9467a']);
    for (const [x, z] of [[-20, -8], [20, 8], [-20, 8], [20, -8]]) b.push([x - 1.5, 0, z - 1, x + 1.5, 1.6, z + 1, '#3fb6a8']);
    const pads = [[-22, 0, 14, 0, 0], [22, 0, 14, 0, 0]];
    const spawns = [[-22, 0, -14], [22, 0, 14], [-22, 0, 14], [22, 0, -14], [0, 3, -23], [0, 3, 23], [-10, 0, 0], [10, 0, 0]];
    return { name: 'Pillar Hall', boxes: b, pads, spawns, size: S, floor: ['#231b2e', '#2b2138'], trim: [1, 0.3, 0.8], sky: [0.07, 0.04, 0.1] };
  }
  const MAPS = [crateYard(), pillarHall()];
  const DIFFS = [
    { id: 'easy', name: 'Easy', react: 0.65, turn: 3.2, err: 0.11, mult: 0.6, desc: 'Slow bots' },
    { id: 'normal', name: 'Normal', react: 0.42, turn: 5, err: 0.065, mult: 1, desc: 'Fair fight' },
    { id: 'hard', name: 'Hard', react: 0.25, turn: 7.5, err: 0.035, mult: 1.5, desc: 'Sharp bots' },
  ];
  let prefs = Arcade.load(PREFS_KEY, { map: 0, diff: 1, sens: 1 });
  let map = MAPS[prefs.map] || MAPS[0], diff = DIFFS[prefs.diff] || DIFFS[1];

  // ---------- Map geometry, collision and the bots' walking graph ----------

  let boxes = [], mapMesh = null, nav = [];
  function buildMap() {
    boxes = map.boxes.map(([x0, y0, z0, x1, y1, z1, c]) => ({ x0, y0, z0, x1, y1, z1, c }));
    boxes.push({ x0: -200, y0: -1, z0: -200, x1: 200, y1: 0, z1: 200, c: '#000', floor: true });
    const out = [];
    // Checkered floor.
    const S = map.size;
    for (let x = -S; x < S; x += 2) for (let z = -S; z < S; z += 2) {
      GL3D.box(out, x, -0.1, z, x + 2, 0, z + 2, hex(map.floor[((x + z) / 2) & 1]), { skip: 'bewsn' });
    }
    for (const b of boxes) {
      if (b.floor) continue;
      GL3D.box(out, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, hex(b.c));
      // Glowing trim along the top edges.
      const t = 0.06, [r, g, bl] = map.trim;
      if (b.y1 - b.y0 >= 1) {
        GL3D.box(out, b.x0 - 0.01, b.y1 - t, b.z0 - 0.01, b.x1 + 0.01, b.y1 + 0.005, b.z0 + t, [r, g, bl], { glow: true });
        GL3D.box(out, b.x0 - 0.01, b.y1 - t, b.z1 - t, b.x1 + 0.01, b.y1 + 0.005, b.z1 + 0.01, [r, g, bl], { glow: true });
        GL3D.box(out, b.x0 - 0.01, b.y1 - t, b.z0, b.x0 + t, b.y1 + 0.005, b.z1, [r, g, bl], { glow: true });
        GL3D.box(out, b.x1 - t, b.y1 - t, b.z0, b.x1 + 0.01, b.y1 + 0.005, b.z1, [r, g, bl], { glow: true });
      }
    }
    for (const [x, z] of map.pads) {
      GL3D.box(out, x - 1, 0, z - 1, x + 1, 0.12, z + 1, [0.15, 0.9, 0.5], { glow: true });
      GL3D.box(out, x - 0.6, 0.12, z - 0.6, x + 0.6, 0.16, z + 0.6, [0.8, 1, 0.9], { glow: true });
    }
    mapMesh = G.mesh(new Float32Array(out), mapMesh);
    buildNav();
  }

  const overlapsBox = (x, y, z, w, h) => boxes.some(b => x + w > b.x0 && x - w < b.x1 && y + h > b.y0 && y < b.y1 && z + w > b.z0 && z - w < b.z1);

  // Walkable points on a 1.5 m grid, on the floor and on every box top, linked to neighbours
  // they can walk to (up a step of 0.6 at most, or down any drop).
  function buildNav() {
    nav = [];
    const S = map.size, STEP = 1.5, grid = new Map();
    for (let x = -S + 1; x <= S - 1; x += STEP) for (let z = -S + 1; z <= S - 1; z += STEP) {
      const tops = [0, ...boxes.filter(b => !b.floor && x > b.x0 + 0.3 && x < b.x1 - 0.3 && z > b.z0 + 0.3 && z < b.z1 - 0.3).map(b => b.y1)];
      for (const y of new Set(tops)) {
        if (overlapsBox(x, y + 0.05, z, 0.4, PH - 0.1)) continue;
        const n = { x, y, z, id: nav.length, links: [], i: Math.round(x / STEP), j: Math.round(z / STEP) };
        nav.push(n);
        const k = `${n.i},${n.j}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(n);
      }
    }
    for (const n of nav) {
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        for (const m of grid.get(`${n.i + di},${n.j + dj}`) || []) {
          const dy = m.y - n.y;
          if (dy > 0.6) continue;
          // The way between must be clear at the higher of the two heights.
          const mx = (n.x + m.x) / 2, mz = (n.z + m.z) / 2;
          if (overlapsBox(mx, Math.max(n.y, m.y) + 0.05, mz, 0.3, PH - 0.2)) continue;
          if (dy < -0.6 && (di && dj)) continue;
          n.links.push(m.id);
        }
      }
    }
  }
  function nearestNode(x, y, z) {
    let best = null, bd = Infinity;
    for (const n of nav) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2 + ((n.y - y) * 3) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  function findPath(from, to) {
    if (!from || !to) return [];
    const open = [from.id], came = new Map([[from.id, -1]]), g = new Map([[from.id, 0]]);
    const h = n => Math.hypot(n.x - to.x, n.z - to.z) + Math.abs(n.y - to.y);
    const f = new Map([[from.id, h(from)]]);
    let guard = 0;
    while (open.length && guard++ < 4000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f.get(open[i]) < f.get(open[bi])) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === to.id) {
        const path = [];
        for (let c = cur; c !== -1; c = came.get(c)) path.unshift(nav[c]);
        return path;
      }
      const cn = nav[cur];
      for (const l of cn.links) {
        const ln = nav[l], ng = g.get(cur) + Math.hypot(ln.x - cn.x, ln.z - cn.z) + Math.max(0, ln.y - cn.y);
        if (ng < (g.get(l) ?? Infinity)) {
          came.set(l, cur); g.set(l, ng); f.set(l, ng + h(ln));
          if (!open.includes(l)) open.push(l);
        }
      }
    }
    return [];
  }

  // Ray against all boxes: returns the distance to the first one hit (or Infinity).
  function rayBoxes(ox, oy, oz, dx, dy, dz, maxD) {
    let best = maxD;
    for (const b of boxes) {
      const t = rayAabb(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, best);
      if (t < best) best = t;
    }
    return best;
  }
  function rayAabb(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxD) {
    let t0 = 0, t1 = maxD;
    for (const [o, d, lo, hi] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) [a, c] = [c, a];
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) return Infinity;
    }
    return t0;
  }
  const canSee = (a, b) => {
    const ax = a.x, ay = a.y + eyeOf(a), az = a.z, bx = b.x, by = b.y + 1.2, bz = b.z;
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    return rayBoxes(ax, ay, az, dx / d, dy / d, dz / d, d) >= d - 0.01;
  };

  // ---------- Fighters ----------

  const NAMES = ['Bolt', 'Sparky', 'Volt', 'Glitch', 'Nova', 'Zippy', 'Fuse', 'Laser', 'Pixel', 'Static'];
  const COLORS = ['#ff4f6d', '#ffb02e', '#7ed957', '#b07cff', '#ff7ae0', '#ffe14d', '#4fc3ff', '#ff8a3c'];
  let fighters = [], me = null, matchT = 0, state = 'menu', feed = [], beams = [], sparks = [], hitMark = 0, hurtDir = null, hurtT = 0, zoomT = 0, shots = 0, hits = 0, heads = 0;
  const eyeOf = f => (f.crouch ? EYE_LOW : EYE);
  const heightOf = f => (f.crouch ? PH_LOW : PH);

  function makeFighter(name, color, isBot, weapon) {
    return { name, color, isBot, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, hp: 100, alive: true, respawnT: 0, ground: false, crouch: false, slideT: 0,
      tags: 0, deaths: 0, weapon, ammo: WEAPONS.map(w => w.mag), fireT: 0, reloadT: 0, regenT: 0, lastHitBy: null, jumpHeld: false, ai: isBot ? { path: [], goal: null, target: null, seeT: 0, strafe: 1, strafeT: 0, stuckT: 0, repathT: 0, aimErr: [0, 0], thinkT: 0 } : null, step: 0, bob: 0 };
  }

  function spawn(f) {
    // The spawn point farthest from everyone else who's alive.
    let best = null, bd = -1;
    for (const [x, y, z] of map.spawns) {
      let d = Infinity;
      for (const o of fighters) if (o !== f && o.alive) d = Math.min(d, Math.hypot(o.x - x, o.z - z));
      d += Math.random() * 6;
      if (d > bd) { bd = d; best = [x, y, z]; }
    }
    [f.x, f.y, f.z] = best;
    f.vx = f.vy = f.vz = 0;
    f.yaw = Math.atan2(-f.x, f.z);   // face the middle
    f.pitch = 0;
    f.hp = 100;
    f.alive = true;
    f.ammo = WEAPONS.map(w => w.mag);
    f.reloadT = 0;
    if (f.ai) { f.ai.path = []; f.ai.target = null; }
  }

  // ---------- Movement (shared by you and the bots) ----------

  function accelerate(f, wx, wz, wishSpeed, accel, dt) {
    const cur = f.vx * wx + f.vz * wz, add = wishSpeed - cur;
    if (add <= 0) return;
    const a = Math.min(accel * dt * wishSpeed, add);
    f.vx += a * wx; f.vz += a * wz;
  }

  function moveFighter(f, input, dt) {
    // input: { fwd, strafe, jump, slide } in the fighter's own frame.
    const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
    let wx = sy * input.fwd + cy * input.strafe, wz = -cy * input.fwd + sy * input.strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const speed = Math.hypot(f.vx, f.vz);
    // Slide: crouch while running fast on the ground for a burst of speed and little friction.
    if (input.slide && f.ground && f.slideT <= 0 && speed > 6.5 && !f.crouch) {
      f.slideT = 0.85;
      const k = (speed + 3.2) / speed;
      f.vx *= k; f.vz *= k;
      if (f === me) Arcade.tone({ freq: 220, to: 120, dur: 0.25, type: 'sawtooth', vol: 0.025 });
    }
    f.crouch = input.slide && (f.ground || f.slideT > 0);
    if (!input.slide) f.slideT = 0;
    if (f.ground) {
      // Bunny hop: jumping on the very frame you land skips friction.
      if (input.jump && (!f.jumpHeld || f === me)) {
        f.vy = JUMP;
        f.ground = false;
        f.slideT = 0;
      } else {
        const fr = f.slideT > 0 ? 0.6 : 9;
        const drop = Math.max(speed, 3) * fr * dt;
        const ns = Math.max(0, speed - drop);
        if (speed > 0) { f.vx *= ns / speed; f.vz *= ns / speed; }
        if (f.slideT <= 0) accelerate(f, wx, wz, f.crouch ? 4 : 8.6, 11, dt);
      }
    }
    if (!f.ground) accelerate(f, wx, wz, 1.3, 60, dt);
    f.slideT = Math.max(0, f.slideT - dt);
    f.jumpHeld = input.jump;
    f.vy -= GRAV * dt;
    // Move axis by axis, stepping up small ledges.
    const h = heightOf(f);
    for (const ax of ['x', 'z']) {
      const v = f['v' + ax] * dt;
      if (!v) continue;
      const prev = f[ax];
      f[ax] += v;
      if (overlapsBox(f.x, f.y + 0.01, f.z, PW, h)) {
        // Try a step up.
        if (f.ground && !overlapsBox(f.x, f.y + 0.61, f.z, PW, h)) {
          let up = 0.61;
          while (up > 0.05 && !overlapsBox(f.x, f.y + up - 0.05, f.z, PW, h)) up -= 0.05;
          f.y += up;
        } else {
          f[ax] = prev;
          f['v' + ax] = 0;
        }
      }
    }
    const prevY = f.y;
    f.y += f.vy * dt;
    f.ground = false;
    if (overlapsBox(f.x, f.y, f.z, PW, h)) {
      if (f.vy < 0) {
        // Land on the highest top we fell onto this frame.
        let top = -Infinity;
        for (const b of boxes) {
          if (f.x + PW > b.x0 && f.x - PW < b.x1 && f.z + PW > b.z0 && f.z - PW < b.z1 && b.y1 <= prevY + 0.01 && b.y1 > f.y - 0.01) top = Math.max(top, b.y1);
        }
        f.y = top > -Infinity ? top : prevY;
        if (overlapsBox(f.x, f.y, f.z, PW, h)) f.y = prevY;
        f.ground = true;
      } else f.y = prevY;
      f.vy = 0;
    }
    // Jump pads.
    if (f.ground) for (const [px, pz, up, pushX, pushZ] of map.pads) {
      if (Math.abs(f.x - px) < 1 && Math.abs(f.z - pz) < 1 && f.y < 0.3) {
        f.vy = up; f.vx += pushX; f.vz += pushZ; f.ground = false;
        if (f === me) Arcade.tone({ freq: 300, to: 900, dur: 0.3, type: 'sine', vol: 0.05 });
        if (f === me) Arcade.flag('zap-arena-pad');
      }
    }
    if (f.y < -20) spawn(f);
    // Keep inside the arena.
    const S = map.size - PW;
    f.x = clamp(f.x, -S, S); f.z = clamp(f.z, -S, S);
    f.step += Math.hypot(f.vx, f.vz) * dt * (f.ground ? 1 : 0);
  }

  // ---------- Shooting ----------

  function aimDir(yaw, pitch) { return GL3D.lookDir(yaw, pitch); }
  function fire(f) {
    const w = WEAPONS[f.weapon];
    if (f.reloadT > 0 || f.fireT > 0 || !f.alive) return false;
    if (f.ammo[f.weapon] <= 0) { startReload(f); return false; }
    f.ammo[f.weapon]--;
    f.fireT = w.rate;
    const ox = f.x, oy = f.y + eyeOf(f) - 0.08, oz = f.z;
    const zoomed = f === me && zoomT > 0.6;
    const moving = Math.hypot(f.vx, f.vz) > 4 || !f.ground;
    let spread = (zoomed && w.zoomSpread !== undefined ? w.zoomSpread : w.spread) * (moving && w.id !== 'scatter' ? 1.6 : 1);
    let bestHit = null;
    for (let p = 0; p < w.pellets; p++) {
      let yaw = f.yaw + (Math.random() - 0.5) * 2 * spread, pitch = f.pitch + (Math.random() - 0.5) * 2 * spread;
      if (f.ai) { yaw += f.ai.aimErr[0]; pitch += f.ai.aimErr[1]; }
      const [dx, dy, dz] = aimDir(yaw, pitch);
      let dist = rayBoxes(ox, oy, oz, dx, dy, dz, w.range), victim = null, head = false;
      for (const o of fighters) {
        if (o === f || !o.alive) continue;
        const h = heightOf(o);
        const tb = rayAabb(ox, oy, oz, dx, dy, dz, o.x - 0.38, o.y, o.z - 0.38, o.x + 0.38, o.y + h - 0.42, o.z + 0.38, dist);
        const th = rayAabb(ox, oy, oz, dx, dy, dz, o.x - 0.26, o.y + h - 0.42, o.z - 0.26, o.x + 0.26, o.y + h + 0.05, o.z + 0.26, dist);
        if (th < dist && th <= tb) { dist = th; victim = o; head = true; }
        else if (tb < dist) { dist = tb; victim = o; head = false; }
      }
      const ex = ox + dx * dist, ey = oy + dy * dist, ez = oz + dz * dist;
      beams.push({ a: [ox + dx * 0.6 + Math.cos(f.yaw) * 0.25, oy + dy * 0.6 - 0.12, oz + dz * 0.6 + Math.sin(f.yaw) * 0.25], b: [ex, ey, ez], t: 0.09, c: w.color, w: w.id === 'rail' ? 0.05 : 0.025 });
      if (f === me) shots++;
      if (victim) {
        let dmg = w.dmg * (head ? w.head : 1);
        if (w.falloff && dist > w.falloff) dmg *= Math.max(0.3, 1 - (dist - w.falloff) / (w.range - w.falloff));
        // The other player's machine owns their health: tell it, and it confirms any tag.
        if (victim.remote) pending.push({ d: Math.round(dmg * 10) / 10, h: head ? 1 : 0, w: f.weapon });
        else damage(victim, dmg, f, head);
        if (f === me) { hits++; if (head) heads++; hitMark = head ? 0.25 : 0.15; }
        for (let k = 0; k < 4; k++) sparks.push({ x: ex, y: ey, z: ez, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 5, t: 0.4, c: w.color });
      } else if (dist < w.range) {
        for (let k = 0; k < 2; k++) sparks.push({ x: ex, y: ey, z: ez, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 3, t: 0.3, c: [1, 1, 1] });
      }
      if (!bestHit && victim) bestHit = victim;
      if (f === me && netMode === 'live') shotBeams.push([...beams[beams.length - 1].a, ex, ey, ez].map(v => Math.round(v * 100) / 100));
    }
    if (f === me && netMode === 'live') flushShots();
    // Sound: loud for you, quieter with distance for the bots.
    const d = f === me ? 0 : Math.hypot(f.x - me.x, f.z - me.z);
    const vol = (f === me ? 0.045 : 0.03) * Math.max(0, 1 - d / 50);
    if (vol > 0.002) {
      if (w.id === 'blaster') Arcade.tone({ freq: 900, to: 300, dur: 0.07, type: 'square', vol });
      else if (w.id === 'scatter') Arcade.tone({ freq: 260, to: 60, dur: 0.18, type: 'sawtooth', vol: vol * 1.4 });
      else Arcade.tone({ freq: 1600, to: 200, dur: 0.35, type: 'sine', vol: vol * 1.6 });
    }
    if (f === me) recoil = w.id === 'rail' ? 1 : w.id === 'scatter' ? 0.8 : 0.3;
    if (f.ammo[f.weapon] <= 0) startReload(f);
    return true;
  }
  function startReload(f) {
    const w = WEAPONS[f.weapon];
    if (f.reloadT > 0 || f.ammo[f.weapon] >= w.mag) return;
    f.reloadT = w.reload;
    if (f === me) Arcade.tone({ freq: 300, to: 500, dur: 0.15, type: 'triangle', vol: 0.03 });
  }

  function damage(v, dmg, by, head) {
    if (!v.alive || state !== 'play') return;
    v.hp -= dmg;
    v.regenT = 0;
    v.lastHitBy = by;
    if (v === me) {
      hurtT = 0.5;
      hurtDir = Math.atan2(by.x - me.x, -(by.z - me.z)) - me.yaw;
      Arcade.tone({ freq: 160, to: 90, dur: 0.12, type: 'square', vol: 0.04 });
    } else if (v.ai && !v.ai.target) v.ai.target = by;
    if (v.hp <= 0) {
      v.alive = false;
      v.deaths++;
      v.respawnT = 2.5;
      by.tags++;
      feed.unshift({ text: `${by.name} ⚡ ${v.name}${head ? ' (headshot)' : ''}`, mine: by === me || v === me, t: 4 });
      if (feed.length > 5) feed.pop();
      for (let k = 0; k < 24; k++) sparks.push({ x: v.x, y: v.y + 1, z: v.z, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 6, vz: (Math.random() - 0.5) * 8, t: 0.7, c: hex(v.color) });
      if (by === me) {
        Arcade.tone({ freq: 660, to: 1320, dur: 0.18, type: 'triangle', vol: 0.06 });
        streak++;
        if (streak >= 5) Arcade.flag('zap-arena-streak');
        if (head && WEAPONS[me.weapon].id === 'rail') Arcade.flag('zap-arena-rail');
        banner = { text: streak >= 3 ? `${streak} IN A ROW!` : head ? 'HEADSHOT TAG!' : 'TAGGED!', t: 1.2, color: head ? '#ffd23f' : '#7ef0ff' };
      }
      if (v === me) { streak = 0; banner = { text: `Tagged by ${by.name}`, t: 2.4, color: '#ff6b6b' }; }
      if (v === me && by.remote) live.send('tagged', { h: head ? 1 : 0, w: lastHitWeapon, n: me.deaths });
      if (by.tags >= goal()) endMatch();
    }
  }
  let recoil = 0, streak = 0, banner = null, lastHitWeapon = 0;
  const goal = () => (netMode === 'live' ? LIVE_TAGS : TAGS_TO_WIN);

  // ---------- Bots ----------

  function updateBot(f, dt) {
    const ai = f.ai;
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = 0.25;
      // Nearest enemy it can see (everyone is an enemy).
      let best = null, bd = 48;
      for (const o of fighters) {
        if (o === f || !o.alive) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y, o.z - f.z);
        if (d < bd && canSee(f, o)) { bd = d; best = o; }
      }
      if (best !== ai.target) { ai.target = best; ai.seeT = 0; ai.aimErr = [(Math.random() - 0.5) * diff.err * 6, (Math.random() - 0.5) * diff.err * 4]; }
    }
    let fwd = 0, strafe = 0, jump = false, slide = false;
    const t = ai.target && ai.target.alive ? ai.target : null;
    if (t) {
      ai.seeT += dt;
      const dx = t.x - f.x, dz = t.z - f.z, dist = Math.hypot(dx, dz);
      // Lead moving targets a little, then turn toward them at the bot's turn speed.
      const lead = WEAPONS[f.weapon].id === 'rail' ? 0 : dist / 120;
      const tx = t.x + t.vx * lead, tz = t.z + t.vz * lead, ty = t.y + heightOf(t) * 0.62;
      const wantYaw = Math.atan2(tx - f.x, -(tz - f.z));
      const wantPitch = Math.atan2(ty - (f.y + eyeOf(f)), Math.hypot(tx - f.x, tz - f.z));
      const turn = diff.turn * dt;
      f.yaw += clamp(angDiff(wantYaw, f.yaw), -turn, turn);
      f.pitch += clamp(wantPitch - f.pitch, -turn, turn);
      // Aim error shrinks while it keeps tracking you.
      const settle = Math.exp(-dt * 1.3);
      ai.aimErr[0] *= settle; ai.aimErr[1] *= settle;
      const onTarget = Math.abs(angDiff(wantYaw, f.yaw)) < 0.12 && Math.abs(wantPitch - f.pitch) < 0.12;
      if (onTarget && ai.seeT > diff.react) {
        const w = WEAPONS[f.weapon];
        if (w.auto || Math.random() < dt * 6) fire(f);
      }
      // Fight movement: keep a good range for the weapon, and strafe.
      const want = [13, 6, 24][f.weapon];
      fwd = dist > want + 4 ? 1 : dist < want - 4 ? -1 : 0;
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeT = 0.5 + Math.random() * 1; ai.strafe = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.25) jump = true; }
      strafe = ai.strafe;
      ai.path = [];
      ai.lastSeen = { x: t.x, y: t.y, z: t.z };
    } else {
      // Roam: walk the graph to where an enemy was last seen, or somewhere random.
      ai.repathT -= dt;
      if (!ai.path.length || ai.repathT <= 0) {
        ai.repathT = 4;
        let goal;
        if (ai.lastSeen && Math.random() < 0.6) goal = nearestNode(ai.lastSeen.x, ai.lastSeen.y, ai.lastSeen.z);
        else {
          const others = fighters.filter(o => o !== f && o.alive);
          const o = others[Math.floor(Math.random() * others.length)];
          goal = o && Math.random() < 0.5 ? nearestNode(o.x, o.y, o.z) : nav[Math.floor(Math.random() * nav.length)];
        }
        ai.lastSeen = null;
        ai.path = findPath(nearestNode(f.x, f.y, f.z), goal);
      }
      const next = ai.path[0];
      if (next) {
        const dx = next.x - f.x, dz = next.z - f.z, d = Math.hypot(dx, dz);
        if (d < 0.9 && Math.abs(next.y - f.y) < 1.2) ai.path.shift();
        const wantYaw = Math.atan2(dx, -dz);
        f.yaw += clamp(angDiff(wantYaw, f.yaw), -6 * dt, 6 * dt);
        f.pitch *= Math.exp(-dt * 3);
        fwd = Math.abs(angDiff(wantYaw, f.yaw)) < 1.2 ? 1 : 0.3;
        if (Math.random() < dt * 0.3 && f.ground) slide = Math.hypot(f.vx, f.vz) > 6.6;
      }
      if (f.ammo[f.weapon] < WEAPONS[f.weapon].mag) startReload(f);
    }
    // Stuck: hop, and if that doesn't help, pick a new route.
    if (Math.hypot(f.vx, f.vz) < 1 && (fwd || strafe)) { ai.stuckT += dt; if (ai.stuckT > 0.5) jump = true; if (ai.stuckT > 2) { ai.path = []; ai.stuckT = 0; } } else ai.stuckT = 0;
    moveFighter(f, { fwd, strafe, jump, slide }, dt);
  }

  // ---------- Input ----------

  const keys = new Set();
  let mouseL = false, mouseR = false;
  const look = GL3D.mouseLook(glCanvas, (mx, my) => {
    if (state !== 'play' || !me) return;
    const s = 0.0022 * prefs.sens * (zoomT > 0.6 ? WEAPONS[me.weapon].zoom : 1);
    me.yaw += mx * s;
    me.pitch = clamp(me.pitch - my * s, -1.5, 1.5);
  }, locked => {
    if (!locked && state === 'play' && overlayEl.hidden) pause();
  });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (state !== 'play' || !me) return;
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') switchWeapon(+e.code.slice(5) - 1);
    if (e.code === 'KeyR') startReload(me);
    if (e.code === 'KeyQ') switchWeapon((me.weapon + 2) % 3);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouseL = mouseR = false; });
  glCanvas.addEventListener('mousedown', e => {
    if (!look.locked() || state !== 'play') return;
    if (e.button === 0) { mouseL = true; if (!WEAPONS[me.weapon].auto) fire(me); }
    if (e.button === 2) mouseR = true;
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
  glCanvas.addEventListener('contextmenu', e => e.preventDefault());
  glCanvas.addEventListener('wheel', e => { if (look.locked() && me) { switchWeapon((me.weapon + (e.deltaY > 0 ? 1 : 2)) % 3); e.preventDefault(); } }, { passive: false });
  function switchWeapon(i) {
    if (!me || i === me.weapon) return;
    me.weapon = i;
    me.reloadT = 0;
    me.fireT = 0.25;
    zoomT = 0;
    swapT = 0.25;
  }
  let swapT = 0;

  // ---------- Match flow ----------

  function start() {
    map = MAPS[prefs.map] || MAPS[0];
    diff = DIFFS[prefs.diff] || DIFFS[1];
    buildMap();
    fighters = [];
    me = makeFighter('You', '#4fc3ff', false, 0);
    fighters.push(me);
    const names = [...NAMES].sort(() => Math.random() - 0.5), cols = COLORS.filter(c => c !== '#4fc3ff').sort(() => Math.random() - 0.5);
    for (let i = 0; i < BOTS; i++) fighters.push(makeFighter(names[i], cols[i % cols.length], true, [0, 0, 1, 0, 2][i] ?? 0));
    for (const f of fighters) spawn(f);
    matchT = MATCH_TIME;
    feed = []; beams = []; sparks = []; streak = 0; shots = 0; hits = 0; heads = 0; banner = { text: 'FIRST TO 20 TAGS', t: 2.2, color: '#ffffff' };
    state = 'play';
    ui.hide();
    look.lock();
  }

  const placeOf = f => [...fighters].sort((a, b) => b.tags - a.tags || a.deaths - b.deaths).indexOf(f) + 1;
  function score() {
    if (!me) return 0;
    const won = placeOf(me) === 1 && state === 'over';
    return Math.round((me.tags * 100 + heads * 25 + (won ? 500 : 0)) * diff.mult);
  }

  function endMatch() {
    if (state !== 'play') return;
    state = 'over';
    look.unlock();
    mouseL = mouseR = false;
    if (netMode === 'live') return endLive();
    const place = placeOf(me);
    if (place === 1) {
      Arcade.flag('zap-arena-win');
      if (diff.id === 'hard') Arcade.flag('zap-arena-hard');
      if (me.deaths === 0) Arcade.flag('zap-arena-flawless');
    }
    const rows = [...fighters].sort((a, b) => b.tags - a.tags || a.deaths - b.deaths)
      .map((f, i) => `<tr class="${f === me ? 'me' : ''}"><td>${i + 1}.</td><td><span style="color:${f.color}">■</span> ${f.name}</td><td>${f.tags} tags · ${f.deaths} out</td></tr>`).join('');
    const acc = shots ? Math.round(hits / shots * 100) : 0;
    Arcade.finish(ui, {
      score: score(),
      title: place === 1 ? 'You win! ⚡' : `${['', '1st', '2nd', '3rd', '4th', '5th', '6th'][place]} place`,
      lines: [`${map.name} · ${diff.name} · ${acc}% accuracy · ${heads} headshot${heads === 1 ? '' : 's'}`],
      html: `<table class="za-board">${rows}</table>`,
      button: 'Play again',
      onAction: start,
    });
    const panel = overlayEl.querySelector('.panel');
    if (panel && !(typeof Versus !== 'undefined' && Versus.active())) {
      panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-menu>Change map or difficulty</button></div>');
      panel.querySelector('[data-menu]').addEventListener('click', showMenu);
    }
  }

  function pause() {
    if (state !== 'play') return;
    mouseL = mouseR = false;
    if (netMode === 'live') return livePause();
    ui.show({
      title: 'Paused',
      html: `<p>${me.tags} tags · ${Math.ceil(matchT)} s left</p>
        <div class="row" style="align-items:center;margin:8px 0"><span style="flex:1;text-align:left;font-size:13px">Mouse speed</span>
        <button class="btn secondary" type="button" data-sens="-0.1">−</button><b data-sensv style="width:48px">${prefs.sens.toFixed(1)}</b><button class="btn secondary" type="button" data-sens="0.1">+</button></div>
        <div class="menu"><button class="btn secondary" type="button" data-quit>Quit match</button></div>`,
      button: 'Resume',
      onAction: () => { ui.hide(); look.lock(); },
      onRender: p => {
        p.querySelectorAll('[data-sens]').forEach(b => b.addEventListener('click', () => {
          prefs.sens = clamp(Math.round((prefs.sens + +b.dataset.sens) * 10) / 10, 0.3, 3);
          Arcade.save(PREFS_KEY, prefs);
          p.querySelector('[data-sensv]').textContent = prefs.sens.toFixed(1);
        }));
        p.querySelector('[data-quit]').addEventListener('click', () => { state = 'menu'; showMenu(); });
      },
    });
  }
  Arcade.onBlur(() => { if (state === 'play' && overlayEl.hidden) { look.unlock(); pause(); } });

  function menuHtml() {
    const pick = (list, cur, key, label) => `<p class="za-label">${label}</p><div class="za-pick">${list.map((x, i) => `<button class="btn ${i === cur ? '' : 'secondary'}" type="button" data-${key}="${i}">${x.name}${x.desc ? `<small>${x.desc}</small>` : ''}</button>`).join('')}</div>`;
    return `<ul style="text-align:left">
        <li>Free-for-all laser tag against ${BOTS} bots: <b>first to ${TAGS_TO_WIN} tags</b>, or the most when the ${Math.floor(MATCH_TIME / 60)}:${String(MATCH_TIME % 60).padStart(2, '0')} clock runs out.</li>
        <li><b>Click</b> to zap, <b>right click</b> to zoom. <b>1 2 3</b> switch between the Pulse Blaster, Scatter Zapper and Rail Lance.</li>
        <li>Hold <b>Space</b> to bunny hop, steer in the air to keep your speed, and <b>Shift</b> while running to slide. Green pads launch you.</li>
      </ul>
      ${pick(MAPS, prefs.map, 'map', 'Arena')}${pick(DIFFS, prefs.diff, 'diff', 'Bots')}${live.html(`Live 1v1 against a real player: first to ${LIVE_TAGS} tags, on the arena picked above`)}<p class="error" data-live-error>${liveError}</p>`;
  }
  function wireMenu(p) {
    live.wire(p);
    liveError = '';
    p.querySelectorAll('[data-map]').forEach(b => b.addEventListener('click', () => { prefs.map = +b.dataset.map; Arcade.save(PREFS_KEY, prefs); showMenu(); }));
    p.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => { prefs.diff = +b.dataset.diff; Arcade.save(PREFS_KEY, prefs); showMenu(); }));
  }
  function showMenu() {
    state = 'menu';
    netMode = null;
    live.leave();
    look.unlock();
    ui.show({ title: '⚡ Zap Arena', html: menuHtml(), button: 'Start match', onAction: start, onRender: wireMenu });
  }

  // ---------- Live 1v1 (live.js) ----------
  // Each machine runs its own player and streams where it is. The shooter decides what it hit
  // (it sees the target where it is drawn), the target's machine takes the damage and confirms
  // any tag, so both sides always agree on the score. The host's clock ends the match.

  let netMode = null, rival = null, liveError = '', sendT = 0, pending = [], shotBeams = [];
  const live = Live.create({
    ui,
    tag: 'zap',
    label: '1v1',
    title: 'The 1v1',
    onReady: host => { if (host) hostStart(); },
    onEvent: onLive,
    onState: s => {
      if (!rival) return;
      rival.net = { ...s, at: performance.now() };
      if (!live.host && typeof s.t === 'number' && state === 'play') matchT = s.t;
    },
    onRematch: hostStart,
    onGone: lost => liveGone(lost),
    onCancel: msg => { liveError = msg ? Online.escape(msg) : ''; showMenu(); },
  });

  function hostStart() {
    const m = MAPS[prefs.map] ? prefs.map : 0;
    live.send('start', { map: m });
    startLive(m);
  }

  function startLive(mapIndex) {
    netMode = 'live';
    map = MAPS[mapIndex] || MAPS[0];
    diff = DIFFS[1];
    buildMap();
    me = makeFighter('You', '#4fc3ff', false, 0);
    rival = makeFighter(live.them, '#ff4f6d', false, 0);
    rival.remote = true;
    rival.net = null;
    fighters = [me, rival];
    // Opposite corners to start; after that, the usual farthest-spawn rule.
    const [a, b] = [map.spawns[0], map.spawns[1]];
    spawn(me);
    [me.x, me.y, me.z] = live.host ? a : b;
    me.yaw = Math.atan2(-me.x, me.z);
    [rival.x, rival.y, rival.z] = live.host ? b : a;
    matchT = LIVE_TIME;
    feed = []; beams = []; sparks = []; streak = 0; shots = 0; hits = 0; heads = 0; pending = []; shotBeams = []; sendT = 0;
    banner = { text: `1v1 vs ${rival.name} · FIRST TO ${LIVE_TAGS}`, t: 2.6, color: '#ffffff' };
    state = 'play';
    ui.hide();
    look.lock();
  }

  function onLive(name, d) {
    if (name === 'hello') { if (rival) rival.name = live.them; return; }
    if (name === 'start' && !live.host) return startLive(d?.map | 0);
    if (!rival || state !== 'play') {
      if (name === 'end' && state === 'over') return;
      return;
    }
    if (name === 'fire') {
      // Their beams and sound, then any damage they say they did to us.
      const w = WEAPONS[d.w | 0] || WEAPONS[0];
      for (const b of (d.b || []).slice(0, 12)) beams.push({ a: b.slice(0, 3), b: b.slice(3, 6), t: 0.09, c: w.color, w: w.id === 'rail' ? 0.05 : 0.025 });
      const dist = Math.hypot(rival.x - me.x, rival.z - me.z), vol = 0.03 * Math.max(0, 1 - dist / 50);
      if (vol > 0.002) Arcade.tone(w.id === 'blaster' ? { freq: 900, to: 300, dur: 0.07, type: 'square', vol } : w.id === 'scatter' ? { freq: 260, to: 60, dur: 0.18, type: 'sawtooth', vol: vol * 1.4 } : { freq: 1600, to: 200, dur: 0.35, type: 'sine', vol: vol * 1.6 });
      let dmg = 0, head = false;
      for (const h of (d.h || []).slice(0, 12)) { dmg += Math.min(160, +h.d || 0); head ||= !!h.h; }
      if (dmg > 0 && me.alive) {
        lastHitWeapon = d.w | 0;
        damage(me, dmg, rival, head);
      }
    } else if (name === 'tagged') {
      // They confirm we tagged them.
      rival.deaths = Math.max(rival.deaths + 1, d.n | 0);
      me.tags = rival.deaths;
      rival.alive = false;
      const head = !!d.h;
      feed.unshift({ text: `${me.name} ⚡ ${rival.name}${head ? ' (headshot)' : ''}`, mine: true, t: 4 });
      if (feed.length > 5) feed.pop();
      for (let k = 0; k < 24; k++) sparks.push({ x: rival.x, y: rival.y + 1, z: rival.z, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 6, vz: (Math.random() - 0.5) * 8, t: 0.7, c: hex(rival.color) });
      Arcade.tone({ freq: 660, to: 1320, dur: 0.18, type: 'triangle', vol: 0.06 });
      streak++;
      if (streak >= 5) Arcade.flag('zap-arena-streak');
      if (head && WEAPONS[d.w | 0]?.id === 'rail') Arcade.flag('zap-arena-rail');
      banner = { text: streak >= 3 ? `${streak} IN A ROW!` : head ? 'HEADSHOT TAG!' : 'TAGGED!', t: 1.2, color: head ? '#ffd23f' : '#7ef0ff' };
      if (me.tags >= LIVE_TAGS) { live.send('end', { a: me.tags, b: rival.tags }); endMatch(); }
    } else if (name === 'end') {
      // Their final count, from their side: a = their tags, b = ours.
      rival.tags = Math.max(rival.tags, d.a | 0);
      me.tags = Math.max(me.tags, d.b | 0);
      endMatch();
    }
  }

  function flushShots() {
    if (!shotBeams.length && !pending.length) return;
    live.send('fire', { w: me.weapon, b: shotBeams, h: pending });
    shotBeams = [];
    pending = [];
  }

  const liveLag = () => (rival?.net ? (performance.now() - rival.net.at) / 1000 : 0);

  function updateLive(dt) {
    // Send our state 20 times a second.
    sendT -= dt;
    if (sendT <= 0) {
      sendT = 0.05;
      const r = v => Math.round(v * 100) / 100;
      live.state({ x: r(me.x), y: r(me.y), z: r(me.z), vx: r(me.vx), vy: r(me.vy), vz: r(me.vz), yaw: r(me.yaw), p: r(me.pitch), c: me.crouch ? 1 : 0, g: me.ground ? 1 : 0, w: me.weapon, hp: Math.round(Math.max(0, me.hp)), a: me.alive ? 1 : 0, d: me.deaths, t: live.host ? Math.round(matchT * 10) / 10 : undefined });
    }
    // Move their puppet toward where they should be by now.
    const s = rival.net;
    if (!s) return;
    const lag = Math.min(0.15, liveLag());
    const tx = s.x + s.vx * lag, tz = s.z + s.vz * lag, ty = s.g ? s.y : s.y + s.vy * lag;
    const wasAlive = rival.alive;
    rival.alive = !!s.a && (s.d | 0) >= rival.deaths;
    if (!wasAlive && rival.alive || Math.hypot(tx - rival.x, tz - rival.z) > 5) { rival.x = tx; rival.y = ty; rival.z = tz; }
    else {
      rival.x = Gfx.approach(rival.x, tx, 18, dt);
      rival.y = Gfx.approach(rival.y, ty, 18, dt);
      rival.z = Gfx.approach(rival.z, tz, 18, dt);
    }
    rival.yaw += angDiff(s.yaw, rival.yaw) * Math.min(1, dt * 20);
    rival.pitch = s.p;
    rival.vx = s.vx; rival.vz = s.vz;
    rival.crouch = !!s.c;
    rival.ground = !!s.g;
    rival.weapon = s.w | 0;
    rival.hp = s.hp;
    rival.step += Math.hypot(s.vx, s.vz) * dt * (s.g ? 1 : 0);
  }

  function livePause() {
    ui.show({
      title: 'Menu',
      html: `<p>The match keeps going while this is open.</p><p>${me.tags} – ${rival.tags} · ${Math.ceil(matchT)} s left</p>
        <div class="menu"><button class="btn secondary" type="button" data-quit>Leave match (counts as a loss)</button></div>`,
      button: 'Back in',
      onAction: () => { ui.hide(); look.lock(); },
      onRender: p => p.querySelector('[data-quit]').addEventListener('click', () => {
        Relay.result('l');
        showMenu();
      }),
    });
  }

  function endLive() {
    const won = me.tags > rival.tags, draw = me.tags === rival.tags;
    Arcade.countPlay();
    Arcade.flag('online-match');
    Relay.result(draw ? 'd' : won ? 'w' : 'l');
    if (won) {
      Arcade.flag('zap-arena-online-win');
      if (me.deaths === 0) Arcade.flag('zap-arena-flawless');
    }
    const acc = shots ? Math.round(hits / shots * 100) : 0;
    ui.show({
      title: draw ? "It's a draw" : won ? 'You win! ⚡' : `${Online.escape(rival.name)} wins`,
      html: `<p class="big">${me.tags} – ${rival.tags}</p>
        <p>You vs ${Online.escape(rival.name)} · ${map.name} · ${acc}% accuracy · ${heads} headshot${heads === 1 ? '' : 's'}</p>
        <div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div>${live.waitNote}`,
      button: 'Rematch',
      delay: 600,
      onAction: () => live.rematch(),
      onRender: p => p.querySelector('[data-leave]').addEventListener('click', showMenu),
    });
  }

  function liveGone(lost) {
    const wasPlaying = state === 'play' && netMode === 'live';
    const name = rival?.name || 'Your opponent';
    netMode = null;
    if (wasPlaying) {
      state = 'over';
      look.unlock();
      if (lost) return ui.show({ title: 'Connection lost', html: "<p>Lost the connection to the game server, so this match doesn't count.</p>", button: 'Back to menu', onAction: showMenu });
      Arcade.countPlay();
      Arcade.flag('online-match');
      Arcade.flag('zap-arena-online-win');
      Relay.result('w');
      return ui.show({ title: `${Online.escape(name)} left`, html: '<p>You win by forfeit.</p>', button: 'Back to menu', onAction: showMenu });
    }
    if (state === 'over') {
      const w = document.querySelector('[data-live-wait]');
      if (w) { w.textContent = `${name} left.`; return; }
    }
    liveError = lost ? 'Lost the connection to the game server.' : `${Online.escape(name)} left.`;
    showMenu();
  }

  // ---------- Update ----------

  function update(dt) {
    matchT -= dt;
    // Online, the host's clock is the one that ends the match.
    if (matchT <= 0 && netMode === 'live' && !live.host) matchT = 0;
    else if (matchT <= 0) { matchT = 0; if (netMode === 'live') live.send('end', { a: me.tags, b: rival.tags }); endMatch(); return; }
    // You.
    if (me.alive) {
      const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      moveFighter(me, { fwd, strafe, jump: keys.has('Space'), slide: keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyC') || keys.has('ControlLeft') }, dt);
      if (mouseL && WEAPONS[me.weapon].auto) fire(me);
      zoomT = Gfx.approach(zoomT, mouseR && me.reloadT <= 0 ? 1 : 0, 14, dt);
    }
    if (netMode === 'live') updateLive(dt);
    for (const f of fighters) {
      if (f.remote) continue;
      if (!f.alive) {
        f.respawnT -= dt;
        if (f.respawnT <= 0) spawn(f);
        continue;
      }
      if (f.isBot) updateBot(f, dt);
      f.fireT = Math.max(0, f.fireT - dt);
      if (f.reloadT > 0) { f.reloadT -= dt; if (f.reloadT <= 0) f.ammo[f.weapon] = WEAPONS[f.weapon].mag; }
      f.regenT += dt;
      if (f.regenT > 4 && f.hp < 100) f.hp = Math.min(100, f.hp + 30 * dt);
    }
    for (const b of beams) b.t -= dt;
    beams = beams.filter(b => b.t > 0);
    for (const s of sparks) { s.vy -= 12 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.t -= dt; }
    sparks = sparks.filter(s => s.t > 0);
    for (const f of feed) f.t -= dt;
    feed = feed.filter(f => f.t > 0);
    hitMark = Math.max(0, hitMark - dt);
    hurtT = Math.max(0, hurtT - dt);
    recoil = Math.max(0, recoil - dt * 4);
    swapT = Math.max(0, swapT - dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
  }

  // ---------- Drawing ----------

  // Robot meshes, one per colour: body (with visor) and a leg, drawn with their own matrices.
  const robotMeshes = new Map();
  function robot(color) {
    if (robotMeshes.has(color)) return robotMeshes.get(color);
    const c = hex(color), dark = c.map(v => v * 0.45), out = [], leg = [];
    GL3D.box(out, -0.36, 0.7, -0.24, 0.36, 1.4, 0.24, c);                 // torso
    GL3D.box(out, -0.28, 1.42, -0.26, 0.28, 1.88, 0.26, [0.9, 0.92, 0.96]);  // head
    GL3D.box(out, -0.24, 1.58, -0.28, 0.24, 1.72, -0.25, c, { glow: true }); // visor
    GL3D.box(out, -0.05, 1.88, -0.05, 0.05, 2.05, 0.05, dark);               // antenna
    GL3D.box(out, -0.07, 2.05, -0.07, 0.07, 2.15, 0.07, c, { glow: true });
    GL3D.box(out, 0.36, 1.05, -0.62, 0.52, 1.25, 0.05, [0.2, 0.22, 0.28]);   // blaster arm
    GL3D.box(out, 0.39, 1.1, -0.66, 0.49, 1.2, -0.6, c, { glow: true });
    GL3D.box(out, -0.52, 0.85, -0.12, -0.36, 1.3, 0.12, dark);               // other arm
    GL3D.box(leg, -0.12, 0, -0.14, 0.12, 0.72, 0.14, dark);
    const m = { body: G.mesh(out), leg: G.mesh(leg) };
    robotMeshes.set(color, m);
    return m;
  }
  // First-person blasters, in camera space (x right, y up, looking down -z).
  const gunMeshes = WEAPONS.map(w => {
    const out = [], [r, g, b] = w.color, body = [0.2, 0.22, 0.28], dark = [0.1, 0.11, 0.14];
    if (w.id === 'blaster') {
      GL3D.box(out, -0.06, -0.07, -0.45, 0.06, 0.06, 0, body);
      GL3D.box(out, -0.035, -0.02, -0.6, 0.035, 0.03, -0.45, dark);
      GL3D.box(out, -0.065, 0.0, -0.4, 0.065, 0.02, -0.08, [r, g, b], { glow: true });
      GL3D.box(out, -0.04, -0.2, -0.14, 0.04, -0.07, -0.05, dark);
    } else if (w.id === 'scatter') {
      GL3D.box(out, -0.09, -0.08, -0.5, 0.09, 0.07, 0, body);
      for (const x of [-0.045, 0.045]) GL3D.box(out, x - 0.035, -0.04, -0.62, x + 0.035, 0.03, -0.5, dark);
      GL3D.box(out, -0.095, 0.02, -0.45, 0.095, 0.04, -0.1, [r, g, b], { glow: true });
      GL3D.box(out, -0.045, -0.22, -0.12, 0.045, -0.08, -0.02, dark);
    } else {
      GL3D.box(out, -0.05, -0.06, -0.7, 0.05, 0.05, 0, body);
      GL3D.box(out, -0.025, -0.02, -0.95, 0.025, 0.02, -0.7, [r, g, b], { glow: true });
      GL3D.box(out, -0.04, 0.05, -0.4, 0.04, 0.12, -0.2, dark);
      GL3D.box(out, -0.04, -0.2, -0.12, 0.04, -0.06, -0.04, dark);
    }
    return G.mesh(out);
  });

  const model = GL3D.mat4.create();
  let dyn = null;
  function draw() {
    const fov = 1.25 * (1 - (1 - (me ? WEAPONS[me.weapon].zoom : 1)) * zoomT);
    G.begin(fov, 0.05, 300, map.sky, 40, 120, 1);
    const eyeY = me ? me.y + eyeOf(me) + Math.sin(me.step * 1.6) * 0.03 * (me.ground ? 1 : 0) : 2;
    G.camera(me ? me.x : 0, eyeY, me ? me.z : 0, me ? me.yaw : 0, me ? me.pitch + recoil * 0.02 : 0);
    G.bindTexture(null);
    G.draw(mapMesh);
    // Fighters.
    for (const f of fighters) {
      if (f === me || !f.alive) continue;
      const m = robot(f.color), sq = f.crouch ? 0.65 : 1;
      GL3D.mat4.trs(model, f.x, f.y, f.z, -f.yaw, 1, sq, 1);
      if (f.lastHitBy && f.regenT < 0.12) G.tint(1, 1, 1, 0.5);
      G.draw(m.body, model);
      const swing = Math.sin(f.step * 2.2) * 0.35;
      for (const side of [-1, 1]) {
        const c = Math.cos(-f.yaw), s = Math.sin(-f.yaw);
        const lx = f.x + c * side * 0.18, lz = f.z - s * side * 0.18;
        GL3D.mat4.trs(model, lx + Math.sin(f.yaw) * swing * side * 0.25, f.y, lz - Math.cos(f.yaw) * swing * side * 0.25, -f.yaw, 1, sq, 1);
        G.draw(m.leg, model);
      }
      G.tint(0, 0, 0, 0);
    }
    // Beams and sparks: built fresh each frame, drawn double-sided.
    const out = [];
    for (const b of beams) beam(out, b.a, b.b, b.w * (0.5 + b.t / 0.18), b.c);
    for (const s of sparks) { const r = 0.05; GL3D.box(out, s.x - r, s.y - r, s.z - r, s.x + r, s.y + r, s.z + r, s.c, { glow: true }); }
    if (out.length) {
      dyn = G.mesh(new Float32Array(out), dyn);
      gl.disable(gl.CULL_FACE);
      G.draw(dyn);
      gl.enable(gl.CULL_FACE);
    }
    // Your blaster, drawn on top of everything.
    if (me && me.alive && state === 'play' && zoomT < 0.8) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      G.camera(0, 0, 0, 0, 0);
      const bob = me.ground ? Math.sin(me.step * 1.6) * 0.012 : 0;
      const rl = me.reloadT > 0 ? Math.sin(Math.min(1, me.reloadT / WEAPONS[me.weapon].reload) * Math.PI) * 0.25 : 0;
      GL3D.mat4.trs(model, 0.2 - zoomT * 0.2, -0.19 + bob - rl * 0.6 - swapT * 0.5 + (me.slideT > 0 ? -0.03 : 0), -0.36 + recoil * 0.05, 0, 0.6, 0.6, 0.6);
      G.draw(gunMeshes[me.weapon], model);
    }
    drawHud();
  }
  function beam(out, a, b, w, c) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
    const d = [dx / L, dy / L, dz / L];
    let u = [d[2], 0, -d[0]];
    let ul = Math.hypot(...u);
    if (ul < 1e-3) { u = [1, 0, 0]; ul = 1; }
    u = u.map(v => v / ul * w);
    const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    for (const p of [u, v]) {
      const q = [[a[0] - p[0], a[1] - p[1], a[2] - p[2]], [b[0] - p[0], b[1] - p[1], b[2] - p[2]], [b[0] + p[0], b[1] + p[1], b[2] + p[2]], [a[0] + p[0], a[1] + p[1], a[2] + p[2]]];
      for (const i of [0, 1, 2, 0, 2, 3]) out.push(q[i][0], q[i][1], q[i][2], 2 + c[0], c[1], c[2], -1, -1);
    }
  }

  function project(wx, wy, wz) {
    const v = G.view, p = G.proj;
    const x = v[0] * wx + v[4] * wy + v[8] * wz + v[12], y = v[1] * wx + v[5] * wy + v[9] * wz + v[13], z = v[2] * wx + v[6] * wy + v[10] * wz + v[14];
    if (-z <= 0.05) return null;
    return [(p[0] * x / -z * 0.5 + 0.5) * W, (1 - (p[5] * y / -z * 0.5 + 0.5)) * H];
  }

  function drawHud() {
    hud.clearRect(0, 0, W, H);
    if (!me || state === 'menu') return;
    // Name tags over the bots (projected with the world camera, so set it back first).
    G.camera(me.x, me.y + eyeOf(me), me.z, me.yaw, me.pitch);
    for (const f of fighters) {
      if (f === me || !f.alive) continue;
      const p = project(f.x, f.y + 2.4, f.z);
      if (!p) continue;
      const d = Math.hypot(f.x - me.x, f.z - me.z);
      if (d > 40 || !canSee(me, f)) continue;
      Gfx.text(hud, f.name, p[0], p[1], { size: 12, color: f.color, width: 3 });
      Gfx.bar(hud, p[0] - 18, p[1] + 8, 36, 4, f.hp / 100, f.color);
    }
    const w = WEAPONS[me.weapon];
    // Rail scope.
    if (zoomT > 0.6 && w.id === 'rail') {
      hud.fillStyle = 'rgba(0,0,0,0.55)';
      hud.beginPath(); hud.rect(0, 0, W, H); hud.arc(W / 2, H / 2, 200, 0, Math.PI * 2, true); hud.fill();
      hud.strokeStyle = 'rgba(255,120,230,0.8)';
      hud.lineWidth = 1;
      hud.beginPath(); hud.moveTo(W / 2 - 200, H / 2); hud.lineTo(W / 2 + 200, H / 2); hud.moveTo(W / 2, H / 2 - 200); hud.lineTo(W / 2, H / 2 + 200); hud.stroke();
    }
    // Crosshair: opens up when moving or spraying.
    if (me.alive) {
      const moving = Math.hypot(me.vx, me.vz) > 4 || !me.ground;
      const gap = 5 + (w.spread * (moving ? 1.6 : 1)) * 260 * (zoomT > 0.6 && w.zoomSpread !== undefined ? 0 : 1) + recoil * 6;
      hud.fillStyle = '#ffffff';
      hud.fillRect(W / 2 - 1, H / 2 - 1, 2, 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) hud.fillRect(W / 2 + dx * gap - (dy ? 1 : (dx > 0 ? 0 : 7)), H / 2 + dy * gap - (dx ? 1 : (dy > 0 ? 0 : 7)), dx ? 7 : 2, dy ? 7 : 2);
      if (hitMark > 0) {
        hud.strokeStyle = hitMark > 0.16 ? '#ffd23f' : '#ffffff';
        hud.lineWidth = 2;
        hud.beginPath();
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { hud.moveTo(W / 2 + dx * 6, H / 2 + dy * 6); hud.lineTo(W / 2 + dx * 12, H / 2 + dy * 12); }
        hud.stroke();
      }
    }
    // Where you got hit from.
    if (hurtT > 0 && hurtDir !== null) {
      hud.save();
      hud.translate(W / 2, H / 2);
      hud.rotate(hurtDir);
      hud.fillStyle = `rgba(255,60,60,${hurtT})`;
      hud.beginPath(); hud.moveTo(-30, -110); hud.lineTo(30, -110); hud.lineTo(0, -135); hud.fill();
      hud.restore();
      hud.fillStyle = `rgba(255,0,0,${hurtT * 0.18})`;
      hud.fillRect(0, 0, W, H);
    }
    // Health, ammo, weapon.
    Gfx.card(hud, 14, H - 58, 210, 44);
    Gfx.text(hud, String(Math.ceil(Math.max(0, me.hp))), 30, H - 36, { size: 22, align: 'left', color: me.hp > 40 ? '#7ef0ff' : '#ff6b6b', stroke: null });
    Gfx.bar(hud, 78, H - 42, 132, 12, me.hp / 100, me.hp > 40 ? '#3fd6e8' : '#ff4d6d');
    Gfx.card(hud, W - 224, H - 58, 210, 44);
    Gfx.text(hud, me.reloadT > 0 ? 'Reloading…' : `${me.ammo[me.weapon]} / ${w.mag}`, W - 28, H - 44, { size: 18, align: 'right', stroke: null });
    Gfx.text(hud, `${me.weapon + 1} · ${w.name}`, W - 28, H - 24, { size: 11, align: 'right', color: '#9aa3b5', stroke: null });
    // Clock and leader.
    const lead = [...fighters].sort((a, b) => b.tags - a.tags)[0];
    const mm = Math.floor(matchT / 60), ss = String(Math.floor(matchT % 60)).padStart(2, '0');
    Gfx.card(hud, W / 2 - 110, 10, 220, 38);
    Gfx.text(hud, `${mm}:${ss}`, W / 2, 22, { size: 15, stroke: null });
    Gfx.text(hud, `You ${me.tags} · ${lead === me ? 'leading' : `${lead.name} ${lead.tags}`} · first to ${goal()}`, W / 2, 38, { size: 11, color: '#9aa3b5', stroke: null });
    if (netMode === 'live' && liveLag() > 3) Gfx.text(hud, `Waiting for ${rival.name}…`, W / 2, 64, { size: 13, color: '#ffb02e', width: 3 });
    // Kill feed.
    feed.forEach((f, i) => Gfx.text(hud, f.text, W - 16, 22 + i * 20, { size: 12, align: 'right', color: f.mine ? '#ffd23f' : '#e0e6f0', width: 3 }));
    if (Tab()) {
      const rows = [...fighters].sort((a, b) => b.tags - a.tags || a.deaths - b.deaths);
      Gfx.card(hud, W / 2 - 160, 70, 320, 30 + rows.length * 24, { fill: 'rgba(10,12,20,0.9)' });
      rows.forEach((f, i) => {
        Gfx.text(hud, `${i + 1}. ${f.name}`, W / 2 - 140, 92 + i * 24, { size: 14, align: 'left', color: f === me ? '#ffd23f' : f.color, stroke: null });
        Gfx.text(hud, `${f.tags} tags · ${f.deaths} out`, W / 2 + 140, 92 + i * 24, { size: 13, align: 'right', stroke: null });
      });
    }
    if (!me.alive) {
      hud.fillStyle = 'rgba(0,0,0,0.35)';
      hud.fillRect(0, 0, W, H);
      Gfx.text(hud, `Back in ${Math.max(0, me.respawnT).toFixed(1)}`, W / 2, H / 2 + 40, { size: 18 });
    }
    if (banner) {
      hud.globalAlpha = Math.min(1, banner.t / 0.3);
      Gfx.text(hud, banner.text, W / 2, H / 2 - 80, { size: 26, color: banner.color, width: 5 });
      hud.globalAlpha = 1;
    }
    if (me.slideT > 0) Gfx.text(hud, 'SLIDE', W / 2, H / 2 + 60, { size: 12, color: '#7ef0ff', width: 3 });
    const sp = Math.hypot(me.vx, me.vz);
    if (sp > 10.5) Gfx.text(hud, `${sp.toFixed(1)} m/s`, W / 2, H / 2 + 76, { size: 12, color: '#ffd23f', width: 3 });
    if (sp > 14) Arcade.flag('zap-arena-speed');
  }
  const Tab = () => keys.has('Tab');
  addEventListener('keydown', e => { if (e.code === 'Tab' && state === 'play') e.preventDefault(); });

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    if (state === 'play' && (overlayEl.hidden || netMode === 'live' || (typeof Versus !== 'undefined' && Versus.active()))) update(dt);
    if (mapMesh) draw();
    $('tags').textContent = me ? me.tags : 0;
    $('clock').textContent = state === 'play' ? `${Math.floor(matchT / 60)}:${String(Math.floor(matchT % 60)).padStart(2, '0')}` : '-';
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
    requestAnimationFrame(frame);
  }

  buildMap();
  // A camera drifting around the arena behind the menu.
  me = makeFighter('You', '#4fc3ff', false, 0);
  me.y = 6; me.z = 22; me.pitch = -0.2;
  const liveInvite = Live.invite('zap');
  Versus.attach({
    ui,
    start,
    score,
    intro: { title: '⚡ Zap Arena', html: menuHtml(), button: 'Start match', onAction: start, onRender: wireMenu },
  });
  if (liveInvite) live.connect('public', liveInvite);
  requestAnimationFrame(frame);
})();
