/* Apex GP: a behind-the-car Grand Prix racer. The road is a loop of short segments, each with
   a curve and a height, projected into perspective every frame (the classic arcade road
   technique). Content is in data.js; cars, scenery and backgrounds are drawn in art.js. */
(() => {
  const W = 960, H = 540;
  const SEG = 200, ROAD = 2000, RUMBLE = 3, DRAW = 220;
  const FOV = 100, CAM_H = 1000, DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
  const PLAYER_Z = CAM_H * DEPTH;
  const STEP = 1 / 60;
  const MAX = SEG / STEP;                    // top speed: one segment per step
  const ACCEL = MAX / 5, BRAKE = -MAX, DECEL = -MAX / 5;
  const OFF_DECEL = -MAX / 2, OFF_LIMIT = MAX / 4, CENTRIFUGAL = 0.3;
  const CAR_W = 360;                          // a car's width in road units
  const PIT_LEN = 70;                         // segments of pit lane before the line
  const FOG = 5;
  const KMH = 330 / MAX;
  // Test hook: #autopilot drives your car with the bot and posts no score.
  const AUTOPILOT = location.hash === '#autopilot';

  const D = ApexData, A = ApexArt;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const esc = s => Online.escape(s);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeIn = (a, b, k) => a + (b - a) * k * k;
  const easeInOut = (a, b, k) => a + (b - a) * (-Math.cos(k * Math.PI) / 2 + 0.5);
  const fx = Sports.particles();

  let state = 'menu';   // menu | lights | racing | finished | paused
  let circuit = null, theme = null, bg = null;
  let segments = [], trackLen = 0, mapPts = [];
  let cars = [], player = null;
  let laps = 3, quickLaps = 3, level = clamp(Arcade.load('apex:level', 1), 0, D.LEVELS.length - 1), LV = D.LEVELS[level];
  let mode = Arcade.load('apex:mode2', 'race');
  if (!D.MODES.some(m => m.id === mode)) mode = 'race';
  let wetPick = Arcade.load('apex:wet', false);
  let carPick = Arcade.load('apex:car', 'pioneer');
  let session = 'race';   // race | quali | trial
  let wet = false, car = D.CARS[0], elimDone = 0, outCount = 0;
  const carById = id => D.CARS.find(c => c.id === id) || D.CARS[0];
  const stats = () => ({ races: 0, wins: 0, podiums: 0, titles: 0, poles: 0, ...Arcade.load('apex:stats', {}) });
  const carUnlocked = c => !c.unlock || stats()[c.unlock.stat] >= c.unlock.n;
  const wearMul = () => (mode === 'endurance' ? 2 : 1) * (wet ? 0.75 : 1);
  const solo = () => session !== 'race';
  let pickCircuit = Arcade.load('apex:circuit', 0);
  let lightsT = 0, goDelay = 0, raceT = 0, finishT = 0, results = null;
  let skyOff = 0, farOff = 0, midOff = 0;
  let shakeAmt = 0;

  // ---------- Building a circuit ----------

  const lastY = () => (segments.length ? segments[segments.length - 1].p2.world.y : 0);
  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n, curve, sprites: [], cars: [],
      p1: { world: { y: lastY(), z: n * SEG }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEG }, camera: {}, screen: {} },
      color: Math.floor(n / RUMBLE) % 2,
    });
  }
  function addPiece(len, curve, hill) {
    const n = Math.max(6, Math.round(len * 1.6));
    const enter = Math.floor(n * 0.2), leave = enter, hold = n - enter - leave;
    const y0 = lastY(), y1 = y0 + hill * SEG * 0.5;
    for (let i = 0; i < enter; i++) addSegment(easeIn(0, curve, i / enter), easeInOut(y0, y1, i / n));
    for (let i = 0; i < hold; i++) addSegment(curve, easeInOut(y0, y1, (enter + i) / n));
    for (let i = 0; i < leave; i++) addSegment(easeInOut(curve, 0, i / leave), easeInOut(y0, y1, (enter + hold + i) / n));
  }

  function build(c) {
    circuit = c;
    theme = D.THEMES[c.theme];
    segments = [];
    for (const [len, curve, hill] of c.pieces) addPiece(len, curve, hill);
    // Ease back down to the starting height so the loop closes.
    const y0 = lastY(), n = 80;
    for (let i = 0; i < n; i++) addSegment(0, easeInOut(y0, 0, (i + 1) / n));
    trackLen = segments.length * SEG;
    const rnd = Sports.seeded(c.id.length * 977 + c.pieces.length);
    const N = segments.length;
    // Start/finish line and the pit lane wall.
    for (let i = 0; i < 3; i++) segments[i].start = true;
    for (let i = N - PIT_LEN; i < N; i++) segments[i].pit = true;
    // Grandstands along the main straight, then scenery all the way round.
    for (let i = 6; i < 60; i += 9) {
      segments[i].sprites.push({ kind: 'stand', offset: -1.9 });
      segments[(i + 4) % N].sprites.push({ kind: 'stand', offset: 2.6 });
    }
    for (let i = 60; i < N - PIT_LEN; i += 4 + Math.floor(rnd() * 8)) {
      const kind = theme.sprites[Math.floor(rnd() * theme.sprites.length)];
      const side = rnd() < 0.5 ? -1 : 1;
      segments[i].sprites.push({ kind, offset: side * (1.35 + rnd() * 2.2), sponsor: D.SPONSORS[Math.floor(rnd() * D.SPONSORS.length)] });
      if (rnd() < 0.3) segments[i].sprites.push({ kind: theme.sprites[0], offset: -side * (1.4 + rnd() * 3) });
    }
    // Tyre barriers on the outside of the tighter corners.
    for (let i = 0; i < N; i += 6) {
      const cv = segments[i].curve;
      if (Math.abs(cv) > 3.5) segments[i].sprites.push({ kind: 'barrier', offset: Math.sign(cv) * 1.25 });
    }
    // The minimap: integrate the curves into a 2D shape, then spread out the closing error.
    // Scale the turning so the whole lap comes round one full circle.
    const sum = segments.reduce((t, s) => t + s.curve, 0), abs = segments.reduce((t, s) => t + Math.abs(s.curve), 0);
    const turn = (Math.sign(sum) || 1) * Math.PI * 2 / Math.max(Math.abs(sum), abs * 0.3);
    let x = 0, y = 0, a = 0;
    const pts = [];
    for (const s of segments) {
      a += s.curve * turn;
      x += Math.cos(a) * 1;
      y += Math.sin(a) * 1;
      pts.push([x, y]);
    }
    const ex = pts[N - 1][0], ey = pts[N - 1][1];
    mapPts = pts.map(([px, py], i) => [px - (ex * i) / N, py - (ey * i) / N]);
    const xs = mapPts.map(p => p[0]), ys = mapPts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sc = Math.min(130 / (maxX - minX || 1), 80 / (maxY - minY || 1));
    mapPts = mapPts.map(([px, py]) => [(px - minX) * sc, (py - minY) * sc]);
    mapPts.w = (maxX - minX) * sc;
    mapPts.h = (maxY - minY) * sc;
    bg = A.backgrounds(theme, W, H);
  }

  const segAt = z => segments[Math.floor((((z % trackLen) + trackLen) % trackLen) / SEG) % segments.length];

  // ---------- Race setup ----------

  function makeCar(team, i, pace) {
    const you = !!team.you;
    return {
      team: you ? { ...team, color: car.color, dark: car.dark, style: car.style } : team,
      ti: i, you, name: you ? Arcade.profile().name : D.DRIVERS[(i - 1 + D.DRIVERS.length) % D.DRIVERS.length],
      x: 0, speed: 0, dist: 0, wear: 0, pitT: 0, pitted: false, pitLap: -1,
      pace: you ? 1 : pace ?? LV.pace * (0.955 + Math.random() * 0.055), lane: 0, finished: false, finishT: 0, best: Infinity, lapStart: 0, lapsDone: 0,
      boost: 1, boosting: false, slip: 0, out: false, outAt: 0, mistake: 0, penalty: 0,
    };
  }

  // opts: { session: 'race' | 'quali' | 'trial', grid: [team index...] | 'back', paces: [...] }
  function newRace(opts = {}) {
    session = opts.session || (mode === 'trial' ? 'trial' : 'race');
    const season = mode === 'season' ? champ() : null;
    build(D.CIRCUITS[season ? season.round : pickCircuit]);
    LV = D.LEVELS[level];
    wet = season ? !!season.wet : wetPick;
    car = carUnlocked(carById(carPick)) ? carById(carPick) : D.CARS[0];
    laps = { season: 3, sprint: 2, endurance: 8, elim: 6 }[mode] || quickLaps;
    if (session === 'quali') laps = 2;
    if (session === 'trial') laps = 5;
    const teams = solo() ? [D.TEAMS[0]] : D.TEAMS;
    cars = teams.map((team, i) => makeCar(team, i, opts.paces?.[i]));
    player = cars.find(c => c.you);
    if (solo()) {
      // A flying start from the run-up to the line.
      player.dist = -SEG * 60;
      player.speed = MAX * 0.6;
      player.grid = 1;
    } else {
      let order;
      const bots = cars.filter(c => !c.you);
      if (Array.isArray(opts.grid)) order = opts.grid.map(ti => cars[ti]);
      else if (opts.grid === 'back') order = [...bots.sort((a, b) => b.pace - a.pace), player];
      else if (mode === 'sprint') order = [...bots.sort((a, b) => a.pace - b.pace), player];
      else {
        order = bots.sort((a, b) => b.pace - a.pace);
        order.splice(Math.min(LV.grid, 11), 0, player);
      }
      order.forEach((c, i) => {
        c.grid = i + 1;
        c.dist = -(i + 1) * SEG * 2.2;
        c.x = i % 2 ? 0.45 : -0.45;
        c.lane = c.x;
      });
    }
    fx.clear();
    Sports.clearSting();
    results = null;
    raceT = 0;
    lightsT = 0;
    goDelay = Math.random() * 0.8;
    finishT = 0;
    elimDone = 0;
    outCount = 0;
    skyOff = farOff = midOff = 0;
    state = solo() ? 'racing' : 'lights';
    engine.start();
    if (solo()) Sports.sting(session === 'quali' ? 'Qualifying' : 'Time trial', `${circuit.name} · ${laps} flying laps${wet ? ' · wet' : ''}`, '#ffc53d', 2.4);
    else if (mode === 'season') Sports.sting(`Round ${champ().round + 1} · ${circuit.name}`, `Grand Prix · starting P${player.grid}${wet ? ' · wet track' : ''}`, '#ffc53d', 3);
  }

  // ---------- Championship ----------

  const freshSeason = () => ({ v: 2, round: 0, points: D.TEAMS.map(() => 0), level, wet: Math.random() < 0.2, grid: null, paces: null, wins: 0 });
  function champ() {
    const s = Arcade.load('apex:season2', null);
    return s && s.v === 2 && Array.isArray(s.points) && s.points.length === D.TEAMS.length && s.round < D.CIRCUITS.length ? s : freshSeason();
  }
  const saveChamp = s => Arcade.save('apex:season2', s);

  // ---------- Simulation ----------

  const input = { left: false, right: false, gas: false, brake: false, boost: false };
  let touchDriving = false;

  function updatePlayer(dt) {
    const p = player;
    const seg = segAt(p.dist + startZ());
    const pct = p.speed / MAX;
    const grip = (1 - p.wear * 0.45) * car.grip * (wet ? 0.82 : 1);
    let left = input.left, right = input.right, gas = input.gas || (touchDriving && !input.brake), brake = input.brake;
    if (AUTOPILOT || state === 'finished') ({ left, right, gas, brake } = botDrive(p));
    if (p.pitT > 0) return pitStop(p, dt);

    const dx = dt * 2 * pct;
    if (left) p.x -= dx;
    else if (right) p.x += dx;
    p.x -= dx * pct * seg.curve * CENTRIFUGAL / grip;

    // Boost: a burst of extra power while the meter lasts. Slipstreaming fills it faster.
    p.boosting = input.boost && p.boost > 0.02 && gas && state === 'racing';
    p.boost = clamp(p.boost + dt * (p.boosting ? -0.28 / car.boost : p.slip > 0.4 ? 0.12 : 0.04), 0, 1);
    const top = MAX * car.top * (wet ? 0.95 : 1) * (1 - p.wear * 0.06) * (p.boosting ? 1.1 : 1) * (p.slip > 0.4 ? 1.06 : 1);
    if (gas) p.speed += ACCEL * car.accel * (p.boosting ? 1.4 : 1) * dt * (1 - Math.max(0, p.speed - top) / top);
    else if (brake) p.speed += BRAKE * dt;
    else p.speed += DECEL * dt;
    if (p.speed > top) p.speed = Math.max(top, p.speed + DECEL * dt);

    // Off the tarmac you slow right down, and you hit anything standing there.
    if (Math.abs(p.x) > 1) {
      if (p.speed > OFF_LIMIT) p.speed += OFF_DECEL * dt / grip;
      if (Math.random() < 0.4) fx.dust(W / 2 + (Math.random() - 0.5) * 120, H - 30, 2, theme.grass[0], 60);
      for (const sp of seg.sprites) {
        const s = A.sprite(sp.kind, sp.sponsor);
        const half = s.world / ROAD / 2;
        if (Math.abs(p.x - sp.offset) < half + CAR_W / ROAD / 2 && Math.sign(p.x) === Math.sign(sp.offset)) {
          p.speed = MAX / 6;
          p.x = sp.offset > 0 ? sp.offset - half - CAR_W / ROAD / 2 - 0.02 : sp.offset + half + CAR_W / ROAD / 2 + 0.02;
          crash();
          break;
        }
      }
    }
    p.x = clamp(p.x, -3, 3);
    p.speed = clamp(p.speed, 0, MAX * 1.2);

    // Bumping into a car from behind costs you speed; side by side you rub wheels.
    const myZ = p.dist;
    p.slip = Math.max(0, p.slip - dt * 0.8);
    for (const c of cars) {
      if (c === p || c.pitT > 0 || c.out) continue;
      const gap = c.dist - myZ;
      const overlapX = Math.abs(c.x - p.x) < CAR_W / ROAD * 1.05;
      if (gap > 0 && gap < SEG * 1.4 && overlapX && p.speed > c.speed) {
        p.speed = c.speed * 0.92;
        p.x += p.x > c.x ? 0.04 : -0.04;
        crash(0.5);
      }
      // Slipstream: tucked in close behind a car.
      if (gap > SEG && gap < SEG * 14 && Math.abs(c.x - p.x) < 0.35 && p.speed > MAX * 0.6) p.slip = Math.min(1, p.slip + dt * 1.6);
    }

    // Tyres wear with speed and cornering, faster when sliding over the grass.
    p.wear = clamp(p.wear + dt * (0.002 + pct * 0.0025 + Math.abs(seg.curve) * pct * 0.0008 + (Math.abs(p.x) > 1 ? 0.008 : 0)) * car.wear * wearMul(), 0, 1);

    // The pit lane: slow down and keep right on the last straight.
    const lapPos = (((p.dist % trackLen) + trackLen) % trackLen);
    if (state === 'racing' && !solo() && lapPos > trackLen - PIT_LEN * SEG && lapPos < trackLen - SEG * 4 && p.x > 0.7 && p.speed < MAX * 0.42 && p.pitLap !== p.lapsDone && p.wear > 0.05) {
      p.pitT = 2.8;
      p.pitLap = p.lapsDone;
      Sports.sfx.whistle();
    }
  }

  function pitStop(c, dt) {
    c.speed = Math.max(0, c.speed + BRAKE * dt);
    c.x = lerp(c.x, 1.25, dt * 3);
    if (c.speed > 0) return;
    c.pitT -= dt;
    if (c.you && Math.random() < 0.3) Sports.sfx.clack(0.6);
    if (c.pitT <= 0) {
      c.wear = 0;
      c.pitT = 0;
      c.pitted = true;
      if (c.you) { Sports.sfx.good(); fx.text(W / 2, H * 0.55, 'FRESH TYRES', '#3ddc84', 26); }
    }
  }

  function crash(k = 1) {
    shakeAmt = Math.max(shakeAmt, 8 * k);
    Sports.sfx.thud(k);
    fx.sparks(W / 2, H - 50, Math.round(14 * k), '#ffd86b', 200);
  }

  // Bot drivers: plan braking for the corners ahead, keep to a racing line, draft, pass slower
  // cars, pit once. Higher levels boost on the straights and defend against you.
  function botDrive(c, dt = STEP) {
    const ai = c.you ? 2 : LV.ai;
    c.catch = 1;
    if (!c.you && LV.catchup && player && !player.out && !player.finished && cars.includes(player) && player.dist > c.dist) c.catch = 1 + clamp((player.dist - c.dist) / (trackLen * 0.25), 0, 1) * LV.catchup;
    const pace = c.you ? 1 : c.pace * c.catch;
    const wetK = wet ? 0.92 : 1;
    const corner = cv => pace * MAX * (1 - Math.abs(cv) * 0.05) * (1 - c.wear * 0.06) * wetK;
    let target;
    if (ai === 0) {
      target = corner(Math.max(Math.abs(segAt(c.dist + SEG * 18).curve), Math.abs(segAt(c.dist + SEG * 6).curve)));
    } else {
      // The fastest speed now that still lets the car brake down for each corner in time.
      const brakeA = MAX * 0.6 * (ai >= 5 ? 1.35 : ai >= 4 ? 1.22 : ai >= 3 ? 1.1 : 0.85);
      target = corner(segAt(c.dist + SEG * 2).curve);
      for (let k = 4; k <= 34; k += 3) {
        const v = corner(segAt(c.dist + SEG * k).curve);
        target = Math.min(target, Math.sqrt(v * v + 2 * brakeA * k * SEG));
      }
    }
    if (ai === 0 && !c.you) {
      // Rookies have moments: a lock-up or a missed apex now and then.
      c.mistake = Math.max(0, c.mistake - dt);
      if (c.mistake <= 0 && Math.random() < dt * 0.04) c.mistake = 1.2;
      if (c.mistake > 0) target *= 0.78;
    }
    const seg = segAt(c.dist + SEG * 18);
    let want = clamp(-seg.curve * 0.12, -0.6, 0.6);
    if (!c.you) c.slip = Math.max(0, c.slip - dt * 0.8);
    for (const o of cars) {
      if (o === c || o.out) continue;
      const gap = o.dist - c.dist;
      if (gap > 0 && gap < SEG * 20 && Math.abs(o.x - want) < 0.4 && o.speed < c.speed + 200) want = o.x > 0 ? o.x - 0.55 : o.x + 0.55;
      if (!c.you && ai >= 1 && gap > SEG && gap < SEG * 14 && Math.abs(o.x - c.x) < 0.35 && c.speed > MAX * 0.6) c.slip = Math.min(1, c.slip + dt * 1.6);
      // Attack (Alien and up): pull out of the slipstream toward the open side and pass.
      if (!c.you && ai >= 4 && gap > SEG * 2 && gap < SEG * 9 && Math.abs(o.x - c.x) < 0.3 && c.speed > o.speed) want = o.x > 0 ? o.x - 0.6 : o.x + 0.6;
      // Defend: on the straights, move across to cover you when you're closing from behind.
      if (!c.you && ai >= 3 && o.you && gap < 0 && gap > -SEG * 10 && o.speed > c.speed * 0.98 && Math.abs(seg.curve) < 2) want = lerp(want, clamp(o.x, -0.7, 0.7), 0.5);
    }
    if (!c.you && ai >= 2) {
      const straight = Math.abs(segAt(c.dist + SEG * 25).curve) < 1 && Math.abs(segAt(c.dist + SEG * 8).curve) < 1;
      c.boosting = state === 'racing' && straight && c.boost > 0.05 && c.speed > target * 0.8;
      c.boost = clamp(c.boost + dt * (c.boosting ? -0.3 : (c.slip > 0.4 ? 0.12 : 0.04) * (ai >= 4 ? 1.5 : 1)), 0, 1);
      if (c.boosting) target *= ai >= 4 ? 1.11 : 1.08;
    }
    c.lane = lerp(c.lane, clamp(want, -0.85, 0.85), 0.05);
    const steer = c.lane - c.x;
    return { left: steer < -0.03, right: steer > 0.03, gas: c.speed < target, brake: c.speed > target * 1.08 };
  }

  function updateBot(c, dt) {
    if (c.out) {
      // Eliminated: pull off onto the grass and stop.
      c.speed = Math.max(0, c.speed + BRAKE * 0.4 * dt);
      c.x = lerp(c.x, 2.4, dt * 1.5);
      return;
    }
    if (c.pitT > 0) return pitStop(c, dt);
    const ctl = botDrive(c, dt);
    const seg = segAt(c.dist + startZ());
    const pct = c.speed / MAX;
    if (ctl.gas) c.speed += ACCEL * (LV.ai >= 5 ? 1.08 : LV.ai >= 3 ? 1.02 : 0.95) * (c.boosting ? 1.3 : 1) * dt;
    else if (ctl.brake) c.speed += BRAKE * 0.6 * dt;
    else c.speed += DECEL * dt * 0.5;
    const cap = MAX * c.pace * (c.catch || 1) * 1.04 * (c.boosting ? 1.08 : 1) * (c.slip > 0.4 ? 1.04 : 1) * (wet ? 0.95 : 1);
    c.speed = clamp(c.speed, 0, cap);
    c.x = clamp(lerp(c.x, c.lane, dt * 2.2) - dt * pct * seg.curve * 0.02, -0.95, 0.95);
    c.wear = clamp(c.wear + dt * (0.002 + pct * 0.0028) * wearMul(), 0, 1);
    // Pit when the tyres are gone (or at half distance in Endurance), if there's a lap left.
    const lapPos = (((c.dist % trackLen) + trackLen) % trackLen);
    const due = c.wear > 0.62 || (mode === 'endurance' && c.lapsDone >= laps / 2);
    if (!c.pitted && due && c.lapsDone < laps - 1 && lapPos > trackLen - PIT_LEN * SEG && lapPos < trackLen - SEG * 10) {
      c.pitT = 2.8 + Math.random();
      c.lane = 1.2;
    }
  }

  // A lone bot's flying lap at full pace, for qualifying times.
  const refCache = new Map();
  function refLap() {
    const key = circuit.id + wet + level;
    if (refCache.has(key)) return refCache.get(key);
    const saved = cars;
    const c = makeCar(D.TEAMS[1], 1, 1);
    c.pitted = true;
    c.dist = -trackLen * 0.2;
    c.speed = MAX * 0.6;
    cars = [c];
    let t = 0, t0 = null;
    for (let i = 0; i < 60 * 600; i++) {
      updateBot(c, STEP);
      const before = c.dist;
      c.dist += c.speed * STEP;
      t += STEP;
      if (before < 0 && c.dist >= 0) t0 = t;
      if (t0 !== null && c.dist >= trackLen) break;
    }
    cars = saved;
    const lap = t - (t0 ?? 0);
    refCache.set(key, lap);
    return lap;
  }

  const startZ = () => 0;   // the line sits at z = 0; dist counts from it

  function step(dt) {
    if (state === 'lights') {
      lightsT += dt;
      if (lightsT > 3.2 + goDelay) {
        state = 'racing';
        Sports.sfx.horn();
        for (const c of cars) c.lapStart = 0;
      }
      return;
    }
    raceT += dt;
    updatePlayer(dt);
    for (const c of cars) if (!c.you) updateBot(c, dt);
    for (const c of cars) {
      const before = c.dist;
      c.dist += c.speed * dt;
      if (before < 0 && c.dist >= 0) c.lapStart = raceT;
      if (c.out) continue;
      const done = Math.floor(c.dist / trackLen);
      if (done > c.lapsDone && c.dist > 0) {
        const lap = raceT - c.lapStart;
        if (c.lapsDone > 0 || done === 1) c.best = Math.min(c.best, lap);
        c.lapStart = raceT;
        c.lapsDone = done;
        if (c.you && done < laps) {
          Sports.sfx.select();
          if (solo()) fx.text(W / 2, H * 0.3, `${fmt(lap)}${lap <= c.best ? '  BEST' : ''}`, lap <= c.best ? '#3ddc84' : '#ffffff', 34);
          else fx.text(W / 2, H * 0.3, done === laps - 1 ? 'FINAL LAP' : `LAP ${done + 1}`, '#ffffff', 34);
        }
        if (done >= laps && !c.finished) {
          c.finished = true;
          c.finishT = raceT;
          if (mode === 'endurance' && !solo() && !c.pitted) c.penalty = 10;
          if (c.you) finishRace();
        }
      }
    }
    // Elimination: whenever the leader starts a new lap, the last two running cars are out.
    if (mode === 'elim' && !solo() && state === 'racing') {
      const lead = Math.max(...cars.filter(c => !c.out).map(c => c.lapsDone));
      if (lead > elimDone && lead < laps) {
        elimDone = lead;
        const running = ranking().filter(c => !c.out && !c.finished);
        for (const c of running.slice(-2)) if (running.length > 1) eliminate(c);
        const left = cars.filter(c => !c.out);
        if (state === 'racing' && left.length === 1 && left[0].you) { player.finished = true; player.finishT = raceT; finishRace(); }
      }
    }
    // Sparks and dust are drawn in screen space; tilt the background with the road.
    const seg = segAt(player.dist);
    const pct = player.speed / MAX;
    skyOff += seg.curve * pct * 0.0008;
    farOff += seg.curve * pct * 0.0016;
    midOff += seg.curve * pct * 0.0032;
    if (state === 'finished') {
      finishT += dt;
      if (finishT > (solo() ? 1.4 : 3) && !results) showResults();
    }
  }

  const ranking = () => [...cars].sort((a, b) => {
    if (a.out || b.out) return a.out && b.out ? b.outAt - a.outAt : a.out ? 1 : -1;
    if (a.finished && b.finished) return a.finishT + a.penalty - (b.finishT + b.penalty);
    return a.finished ? -1 : b.finished ? 1 : b.dist - a.dist;
  });

  function eliminate(c) {
    c.out = true;
    c.outAt = ++outCount;
    if (c.you) {
      Sports.sting('Eliminated', `Out on lap ${elimDone + 1} · classified P${position(c)}`, '#ff5d5d', 2.6);
      Sports.sfx.lose();
      state = 'finished';
    } else {
      Sports.sting(`${c.name} is out`, `${cars.filter(o => !o.out).length} cars left`, c.team.color, 1.8);
      Sports.sfx.buzzer();
    }
  }
  const position = c => ranking().indexOf(c) + 1;

  function finishRace() {
    state = 'finished';
    if (solo()) { Sports.sfx.good(); return; }
    const pos = position(player);
    fx.confetti(W / 2, H * 0.4, pos <= 3 ? 120 : 40, ['#1b1d22', '#f4f4f4', '#ffc53d']);
    if (pos === 1) Sports.sfx.win(); else Sports.sfx.good();
    Sports.sfx.cheer(pos <= 3 ? 1.4 : 0.6);
  }

  function bumpStats(fn) {
    const st = stats();
    fn(st);
    Arcade.save('apex:stats', st);
  }

  function showResults() {
    if (session === 'quali') return qualiResults();
    if (session === 'trial') return trialResults();
    // Cars still running are placed by how far round they are, with an estimated gap.
    const order = ranking();
    const lead = order[0];
    const total = c => c.finishT + c.penalty;
    results = order.map((c, i) => {
      const t = c.finished ? total(c) : raceT + (laps * trackLen - c.dist) / Math.max(1, c.speed || MAX * 0.8);
      return { c, pos: i + 1, gap: c.out ? 'OUT' : i === 0 ? fmt(t) : `+${(t - (lead.finished ? total(lead) : t)).toFixed(1)}s` };
    });
    engine.stop();
    const pos = results.find(r => r.c.you).pos;
    const won = pos === 1;
    const before = D.CARS.filter(carUnlocked).map(c => c.id);
    bumpStats(st => { st.races++; if (won) st.wins++; if (pos <= 3) st.podiums++; });
    if (won) Arcade.flag('apex-gp-win');
    if (won && level >= 1 && player.grid >= 12) Arcade.flag('apex-gp-pole');
    if (won && mode === 'elim') Arcade.flag('apex-gp-elim');
    if (won && mode === 'endurance') Arcade.flag('apex-gp-endurance');
    if (won && wet) Arcade.flag('apex-gp-wet');
    if (won && level >= 4) Arcade.flag('apex-gp-alien');
    let champHtml = '', button = 'Race again';
    if (mode === 'season') {
      const s = champ();
      results.forEach(r => { s.points[r.c.ti] += D.POINTS[r.pos - 1] || 0; });
      // One bonus point for the fastest lap, if that driver finished in the top ten.
      const fl = results.filter(r => r.pos <= 10 && r.c.best < Infinity).sort((a, b) => a.c.best - b.c.best)[0];
      if (fl) s.points[fl.c.ti] += 1;
      if (won) s.wins = (s.wins || 0) + 1;
      s.round++;
      s.grid = null;
      s.paces = null;
      s.wet = Math.random() < 0.22;
      const table = D.TEAMS.map((t, i) => ({ t, pts: s.points[i], i })).sort((a, b) => b.pts - a.pts);
      const done = s.round >= D.CIRCUITS.length;
      const mine = table.findIndex(r => r.t.you) + 1;
      if (done && mine === 1) { Arcade.flag('apex-gp-season'); bumpStats(st => st.titles++); }
      champHtml = `${fl ? `<p class="muted-note">Fastest lap: ${esc(fl.c.name)} ${fmt(fl.c.best)} (+1)</p>` : ''}
        <p class="muted-note">${done ? 'Final championship standings' : `Standings after round ${s.round} of ${D.CIRCUITS.length} · you are P${mine}`}</p>
        <ol class="board-list">${table.slice(0, 6).map((r, k) => `<li class="${r.t.you ? 'me' : ''}"><span class="rank">${k + 1}</span><span class="name">${esc(r.i ? D.DRIVERS[r.i - 1] : Arcade.profile().name)} <small style="color:${r.t.color}">${esc(r.t.name)}</small></span><b>${r.pts}</b></li>`).join('')}</ol>`;
      if (done) champHtml = `<p class="new-best">${mine === 1 ? 'You are World Champion!' : `${esc(table[0].t.name)} take the title. You finish P${mine}.`}</p>` + champHtml;
      saveChamp(done ? freshSeason() : s);
      button = done ? 'New season' : 'Next weekend';
    }
    const fresh = D.CARS.filter(c => carUnlocked(c) && !before.includes(c.id));
    const modeMult = { sprint: 0.8, endurance: 1.4, elim: 1.1 }[mode] || 1;
    const score = AUTOPILOT ? 0 : Math.round(((13 - pos) * 100 + (player.best < Infinity ? Math.max(0, 600 - player.best * 8) : 0) + (player.grid - pos) * 25) * LV.mult * modeMult * (wet ? 1.15 : 1));
    const modeName = D.MODES.find(m => m.id === mode).name;
    Arcade.finish(ui, {
      score: Math.max(0, score),
      title: player.out ? `Eliminated · P${pos}` : won ? 'Victory!' : pos <= 3 ? `Podium! P${pos}` : `Finished P${pos}`,
      lines: [`${esc(circuit.name)} · ${modeName} · ${laps} laps${wet ? ' · wet' : ''} · started P${player.grid}`, `Best lap ${player.best < Infinity ? fmt(player.best) : '—'}${player.penalty ? ` · +${player.penalty}s penalty (no pit stop)` : ''}`],
      html: `<ol class="board-list">${results.slice(0, 6).map(r => `<li class="${r.c.you ? 'me' : ''}"><span class="rank">${r.pos}</span><span class="name">${esc(r.c.name)} <small style="color:${r.c.team.color}">${esc(r.c.team.name)}</small></span><b>${r.gap}</b></li>`).join('')}</ol>${champHtml}
        ${fresh.map(c => `<p class="new-best">New car unlocked: ${esc(c.name)}</p>`).join('')}`,
      button,
      onAction: () => start(),
    });
  }

  // Qualifying: your best lap against the field's simulated times sets the grid.
  function qualiResults() {
    results = true;
    engine.stop();
    const ref = refLap();
    const paces = D.TEAMS.map((t, i) => (i ? LV.pace * (0.955 + Math.random() * 0.055) : 1));
    const times = D.TEAMS.map((t, i) => (i ? (ref / paces[i]) * (1 + Arcade.rand(-0.004, 0.012)) : player.best));
    const grid = times.map((t, i) => i).sort((a, b) => times[a] - times[b]);
    const s = champ();
    s.grid = grid;
    s.paces = paces;
    saveChamp(s);
    const mine = grid.indexOf(0) + 1;
    if (mine === 1) { Arcade.flag('apex-gp-pole-position'); bumpStats(st => st.poles++); }
    const pole = times[grid[0]];
    const row = (ti, k) => `<li class="${ti === 0 ? 'me' : ''}"><span class="rank">${k + 1}</span><span class="name">${esc(ti ? D.DRIVERS[ti - 1] : Arcade.profile().name)} <small style="color:${D.TEAMS[ti].color}">${esc(D.TEAMS[ti].name)}</small></span><b>${k ? `+${(times[ti] - pole).toFixed(3)}` : fmt(times[ti])}</b></li>`;
    const show = grid.slice(0, 6).map(row);
    if (mine > 6) show.push(row(0, mine - 1));
    ui.show({
      title: mine === 1 ? 'Pole position!' : `Qualified P${mine}`,
      html: `<p class="big">${fmt(player.best)}</p><p>${esc(circuit.name)} · round ${s.round + 1}${wet ? ' · wet' : ''}</p><ol class="board-list">${show.join('')}</ol>`,
      button: 'Start the Grand Prix',
      onAction: () => { ui.hide(); newRace({ session: 'race', grid, paces }); },
      delay: 400,
    });
  }

  function trialResults() {
    results = true;
    engine.stop();
    const key = `apex:tt:${circuit.id}${wet ? ':wet' : ''}`;
    const prev = Arcade.load(key, null);
    const isRec = player.best < Infinity && (!prev || player.best < prev);
    if (isRec) Arcade.save(key, player.best);
    const ref = refLap();
    bumpStats(st => st.races++);
    const score = AUTOPILOT || player.best === Infinity ? 0 : Math.round(Math.max(0, ref * 1.2 - player.best) * 60 * LV.mult) + 200;
    Arcade.finish(ui, {
      score,
      title: isRec ? 'New lap record!' : 'Session over',
      lines: [`${esc(circuit.name)} · best lap ${player.best < Infinity ? fmt(player.best) : '—'}${prev ? ` · record ${fmt(Math.min(prev, player.best))}` : ''}`, `${LV.name} reference lap ${fmt(ref)}`],
      button: 'Go again',
      onAction: () => start(),
    });
  }

  const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

  // ---------- Engine sound ----------

  const engine = (() => {
    let osc = null, osc2 = null, filt = null, gain = null;
    return {
      start() {
        if (!Sports.ensure() || osc) return;
        const ac = Sports.ctx();
        osc = ac.createOscillator();
        osc2 = ac.createOscillator();
        filt = ac.createBiquadFilter();
        gain = ac.createGain();
        osc.type = 'sawtooth';
        osc2.type = 'square';
        filt.type = 'lowpass';
        filt.frequency.value = 900;
        gain.gain.value = 0;
        osc.connect(filt);
        osc2.connect(filt);
        filt.connect(gain).connect(Sports.master());
        osc.start();
        osc2.start();
      },
      update(speed, boosting) {
        if (!osc) return;
        const ac = Sports.ctx();
        const pct = speed / MAX;
        // Eight gears: revs climb through each one, then drop at the shift.
        const gear = Math.min(7, Math.floor(pct * 8));
        const rev = pct * 8 - gear;
        const f = 70 + gear * 12 + rev * 140 + (boosting ? 25 : 0);
        osc.frequency.setTargetAtTime(f, ac.currentTime, 0.03);
        osc2.frequency.setTargetAtTime(f * 0.5, ac.currentTime, 0.03);
        filt.frequency.setTargetAtTime(500 + pct * 1800, ac.currentTime, 0.05);
        gain.gain.setTargetAtTime(Arcade.load('muted', false) || state === 'paused' ? 0 : 0.035 + pct * 0.035, ac.currentTime, 0.05);
        return gear + 1;
      },
      stop() {
        if (!osc) return;
        gain.gain.setTargetAtTime(0, Sports.ctx().currentTime, 0.1);
        const o = osc, o2 = osc2;
        setTimeout(() => { o.stop(); o2.stop(); }, 400);
        osc = osc2 = null;
      },
    };
  })();

  // ---------- Rendering ----------

  function project(p, camX, camY, camZ) {
    p.camera.x = -camX;
    p.camera.y = p.world.y - camY;
    p.camera.z = p.world.z - camZ;
    p.screen.scale = DEPTH / p.camera.z;
    p.screen.x = Math.round(W / 2 + p.screen.scale * p.camera.x * W / 2);
    p.screen.y = Math.round(H / 2 - p.screen.scale * p.camera.y * H / 2);
    p.screen.w = Math.round(p.screen.scale * ROAD * W / 2);
  }

  function poly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  const fogMix = (() => {
    const cache = new Map();
    const parse = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    return (col, fogCol, k) => {
      const q = Math.round(k * 20);
      const key = col + fogCol + q;
      if (!cache.has(key)) {
        const a = parse(col), b = parse(fogCol), t = q / 20;
        cache.set(key, `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`);
      }
      return cache.get(key);
    };
  })();

  function drawSegment(seg, fog) {
    const p1 = seg.p1.screen, p2 = seg.p2.screen;
    const c = seg.color;
    const f = col => fogMix(col, theme.fog, fog);
    ctx.fillStyle = f(theme.grass[c]);
    ctx.fillRect(0, p2.y, W, p1.y - p2.y);
    const r1 = p1.w / 7, r2 = p2.w / 7;
    poly(p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, f(theme.rumble[c]));
    poly(p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, f(theme.rumble[c]));
    poly(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, f(theme.road[c]));
    if (seg.start) {
      // Chequered start line.
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = -1 + (2 * i) / n, b = -1 + (2 * (i + 1)) / n;
        poly(p1.x + p1.w * a, p1.y, p1.x + p1.w * b, p1.y, p2.x + p2.w * b, p2.y, p2.x + p2.w * a, p2.y, (i + seg.index) % 2 ? '#f4f4f4' : '#1b1d22');
      }
    } else if (c) {
      const l1 = p1.w / 40, l2 = p2.w / 40;
      for (const k of [-1 / 3, 1 / 3]) {
        const x1 = p1.x + p1.w * k * 2, x2 = p2.x + p2.w * k * 2;
        poly(x1 - l1 / 2, p1.y, x1 + l1 / 2, p1.y, x2 + l2 / 2, p2.y, x2 - l2 / 2, p2.y, f(theme.lane));
      }
    }
    if (seg.pit) {
      // The pit lane: a painted strip on the right with a white line.
      const a1 = p1.x + p1.w * 0.72, a2 = p2.x + p2.w * 0.72;
      poly(a1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, a2, p2.y, f(c ? '#6a6e78' : '#646872'));
      poly(a1 - 2, p1.y, a1 + 2, p1.y, a2 + 1, p2.y, a2 - 1, p2.y, f('#f4f4f4'));
    }
  }

  function drawImageClipped(img, x, y, w, h, clipY) {
    if (w < 1 || h < 1) return;
    const clipH = clipY ? Math.max(0, y + h - clipY) : 0;
    if (clipH >= h) return;
    const sh = img.height * (1 - clipH / h);
    ctx.drawImage(img, 0, 0, img.width, sh, x, y, w, h - clipH);
  }

  function drawBackground(playerY) {
    ctx.drawImage(bg.sky, 0, 0, W, H);
    const lift = clamp(playerY * 0.004, -40, 60);
    for (const [img, off] of [[bg.far, farOff], [bg.mid, midOff]]) {
      const sx = ((off * W) % W + W) % W;
      ctx.drawImage(img, sx, 0, W, H, 0, lift, W, H);
    }
    ctx.fillStyle = theme.grass[0];
    ctx.fillRect(0, bg.horizon + lift - 2, W, H);
  }

  function render() {
    const camZ = player.dist - PLAYER_Z;
    const base = segAt(camZ);
    const basePct = (((camZ % SEG) + SEG) % SEG) / SEG;
    const pSeg = segAt(player.dist);
    const pPct = (((player.dist % SEG) + SEG) % SEG) / SEG;
    const playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);
    const camWrap = ((camZ % trackLen) + trackLen) % trackLen;
    drawBackground(playerY);

    // Bucket the cars by segment so they draw in order with the scenery.
    for (const s of segments) s.cars.length = 0;
    for (const c of cars) if (!c.you) segAt(c.dist).cars.push(c);

    let maxy = H, x = 0, dx = -(base.curve * basePct);
    const drawn = [];
    for (let n = 0; n < DRAW; n++) {
      const seg = segments[(base.index + n) % segments.length];
      const looped = seg.index < base.index;
      const camZw = camWrap - (looped ? trackLen : 0);
      seg.clip = maxy;
      project(seg.p1, player.x * ROAD - x, playerY + CAM_H, camZw);
      project(seg.p2, player.x * ROAD - x - dx, playerY + CAM_H, camZw);
      x += dx;
      dx += seg.curve;
      drawn.push(seg);
      seg.fog = 1 - 1 / Math.exp((n / DRAW) * (n / DRAW) * FOG);
      if (seg.p1.camera.z <= DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) { seg.hidden = true; continue; }
      seg.hidden = false;
      drawSegment(seg, seg.fog);
      maxy = seg.p1.screen.y;
    }
    // Scenery and cars, far to near.
    for (let n = drawn.length - 1; n > 0; n--) {
      const seg = drawn[n];
      if (seg.p1.camera.z <= DEPTH) continue;
      const scale = seg.p1.screen.scale;
      for (const sp of seg.sprites) {
        const s = A.sprite(sp.kind, sp.sponsor);
        const w = s.world * scale * W / 2, h = w * (s.img.height / s.img.width);
        const sx = seg.p1.screen.x + scale * sp.offset * ROAD * W / 2;
        drawImageClipped(s.img, sx - w / 2, seg.p1.screen.y - h, w, h, seg.clip);
      }
      for (const c of seg.cars) {
        const pct = (((c.dist % SEG) + SEG) % SEG) / SEG;
        const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, pct);
        const sx = lerp(seg.p1.screen.x, seg.p2.screen.x, pct) + sc * c.x * ROAD * W / 2;
        const sy = lerp(seg.p1.screen.y, seg.p2.screen.y, pct);
        const w = CAR_W * 1.15 * sc * W / 2, h = w * 0.55;
        drawImageClipped(A.car(c.team, 0), sx - w / 2, sy - h, w, h, seg.clip);
      }
    }

    // Slipstream streaks.
    if (player.slip > 0.4 || player.boosting) {
      ctx.strokeStyle = player.boosting ? 'rgba(120,220,255,0.5)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + raceT * 3, r1 = 140 + ((raceT * 900 + i * 61) % 260);
        ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * r1, H * 0.48 + Math.sin(a) * r1 * 0.55); ctx.lineTo(W / 2 + Math.cos(a) * (r1 + 60), H * 0.48 + Math.sin(a) * (r1 + 60) * 0.55); ctx.stroke();
      }
    }

    // Your car, low and centred, leaning with the steering and bobbing over the kerbs.
    const steer = input.left && !input.right ? -1 : input.right && !input.left ? 1 : 0;
    const bump = Math.abs(player.x) > 0.9 && player.speed > 0 ? (Math.random() - 0.5) * 4 : 0;
    const cw = 300, chh = cw * 0.55;
    const cy = H - chh - 6 + bump + Math.sin(raceT * 30) * player.speed / MAX * 0.8;
    ctx.drawImage(A.car(player.team, AUTOPILOT ? 0 : steer), W / 2 - cw / 2, cy, cw, chh);
    // Tyre smoke when sliding, exhaust heat when boosting.
    if (Math.abs(player.x) > 1 && player.speed > MAX * 0.3) fx.dust(W / 2 + (Math.random() < 0.5 ? -110 : 110), H - 20, 2, theme.grass[1], 80);
    if (player.boosting && Math.random() < 0.7) fx.dust(W / 2 + (Math.random() - 0.5) * 20, cy + chh * 0.8, 1, 'rgba(120,200,255,0.6)', 30);
    if (wet) {
      // Rain: a grey wash, falling streaks, and spray off your rear tyres.
      ctx.fillStyle = 'rgba(30,45,70,0.22)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(210,225,255,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const t = performance.now() / 1000;
      for (let i = 0; i < 110; i++) {
        const sx = (i * 137.5 + t * 90 * (1 + (i % 3) * 0.3)) % W, sy = (i * 53 + t * 900 * (1 + (i % 4) * 0.2)) % H;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - 5, sy + 18);
      }
      ctx.stroke();
      if (player.speed > MAX * 0.4 && Math.random() < 0.8) fx.dust(W / 2 + (Math.random() < 0.5 ? -100 : 100), H - 24, 1, 'rgba(220,230,245,0.55)', 90);
    }
  }

  function hud() {
    const pos = position(player);
    const pill = (x, y, w, h) => { ctx.fillStyle = 'rgba(12,14,22,0.72)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill(); };
    // Position and lap, top left.
    pill(12, 12, 196, 74);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffc53d';
    if (solo()) {
      ctx.font = '900 22px system-ui, sans-serif';
      ctx.fillText(session === 'quali' ? 'QUALI' : 'TRIAL', 24, 52);
    } else {
      ctx.font = '900 40px system-ui, sans-serif';
      ctx.fillText(`P${pos}`, 24, 56);
      const pw = ctx.measureText(`P${pos}`).width;
      ctx.fillStyle = '#9aa3b5';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText(`/${cars.filter(c => !c.out).length}`, 26 + pw, 56);
    }
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillText(`LAP ${Math.min(laps, player.lapsDone + 1)}/${laps}`, 118, 34);
    ctx.font = '600 12px ui-monospace, monospace';
    ctx.fillText(fmt(Math.max(0, raceT - player.lapStart)), 118, 52);
    ctx.fillStyle = '#9aa3b5';
    ctx.fillText(player.best < Infinity ? `best ${fmt(player.best)}` : 'best —', 24, 76);

    // Minimap, top right.
    const mw = mapPts.w + 20, mh = mapPts.h + 20, mx = W - mw - 12, my = 12;
    pill(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    mapPts.forEach(([x, y], i) => (i ? ctx.lineTo(mx + 10 + x, my + 10 + y) : ctx.moveTo(mx + 10 + x, my + 10 + y)));
    ctx.closePath();
    ctx.stroke();
    for (const c of [...cars].sort((a, b) => a.you - b.you)) {
      const i = Math.floor(((((c.dist % trackLen) + trackLen) % trackLen) / SEG)) % mapPts.length;
      const [x, y] = mapPts[i];
      ctx.fillStyle = c.team.color;
      ctx.beginPath(); ctx.arc(mx + 10 + x, my + 10 + y, c.you ? 5 : 3, 0, Math.PI * 2); ctx.fill();
      if (c.you) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }

    // Speed, gear, tyres and boost, bottom left.
    const gear = engine.update(player.speed, player.boosting) || Math.min(8, Math.floor(player.speed / MAX * 8) + 1);
    pill(12, H - 92, 200, 80);
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(player.speed * KMH), 112, H - 50);
    ctx.textAlign = 'left';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = '#9aa3b5';
    ctx.fillText('KM/H', 116, H - 52);
    ctx.fillStyle = '#ffc53d';
    ctx.font = '900 26px system-ui, sans-serif';
    ctx.fillText(player.speed < 5 ? 'N' : gear, 166, H - 50);
    // Four tyres, green through red as they wear.
    const tc = player.wear < 0.4 ? '#3ddc84' : player.wear < 0.7 ? '#ffc53d' : '#ff5d5d';
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = tc;
      ctx.beginPath(); ctx.roundRect(24 + (i % 2) * 16, H - 40 + Math.floor(i / 2) * 14, 10, 12, 3); ctx.fill();
    }
    ctx.fillStyle = '#9aa3b5';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(`TYRES ${Math.round((1 - player.wear) * 100)}%`, 62, H - 30);
    ctx.fillText('BOOST', 62, H - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(104, H - 24, 96, 8);
    ctx.fillStyle = player.boosting ? '#78dcff' : '#4f8cff';
    ctx.fillRect(104, H - 24, 96 * player.boost, 8);
    if (player.wear > 0.7 && state === 'racing') {
      ctx.fillStyle = Math.floor(raceT * 3) % 2 ? '#ff5d5d' : '#ffc53d';
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TYRES GONE · PIT: keep right & slow down before the line', W / 2, 30);
    }
    const ttKey = `apex:tt:${circuit.id}${wet ? ':wet' : ''}`;
    const note = mode === 'elim' && !solo() && state === 'racing' ? `ELIMINATION · bottom two out as the leader starts lap ${Math.min(laps, elimDone + 2)}`
      : mode === 'endurance' && !solo() && !player.pitted && state === 'racing' ? 'ENDURANCE · pit stop required (10s penalty if you skip it)'
        : session === 'trial' ? `RECORD ${Arcade.load(ttKey, null) ? fmt(Arcade.load(ttKey, 0)) : '—'}` : '';
    if (note && player.wear <= 0.7) {
      ctx.fillStyle = '#f4f4f4';
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(note, W / 2, 30);
    }
    if (player.slip > 0.4) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SLIPSTREAM', W / 2, H - 12);
    }
    if (player.pitT > 0) {
      pill(W / 2 - 120, H * 0.35, 240, 60);
      ctx.fillStyle = '#ffc53d';
      ctx.font = '900 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(player.speed > 0 ? 'PIT LANE' : `PIT STOP ${player.pitT.toFixed(1)}`, W / 2, H * 0.35 + 38);
    }

    // Start lights.
    if (state === 'lights' || (state === 'racing' && raceT < 1)) {
      const lit = state === 'lights' ? Math.min(5, Math.floor(lightsT / 0.6)) : 0;
      pill(W / 2 - 150, 22, 300, 56);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = state === 'racing' ? '#3ddc84' : i < lit ? '#ff2a2a' : '#2a2c33';
        ctx.beginPath(); ctx.arc(W / 2 - 112 + i * 56, 50, 18, 0, Math.PI * 2); ctx.fill();
      }
      if (state === 'lights' && lit !== hud.lastLit) { hud.lastLit = lit; if (lit > 0) Sports.tone(440, { dur: 0.15, type: 'square', vol: 0.06 }); }
    }
    if (state === 'finished') {
      ctx.fillStyle = 'rgba(12,14,22,0.7)';
      ctx.fillRect(0, H * 0.28, W, 70);
      for (let i = 0; i < 24; i++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#f4f4f4' : '#1b1d22';
        ctx.fillRect(i * 40, H * 0.28 + j * 8 - 16, 40, 8);
      }
      ctx.fillStyle = '#fff';
      ctx.font = '900 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(solo() ? `SESSION OVER · ${player.best < Infinity ? fmt(player.best) : '—'}` : player.out ? `ELIMINATED · P${pos}` : `CHEQUERED FLAG · P${pos}`, W / 2, H * 0.28 + 48);
    }
    Sports.drawSting(ctx, W, H, 1 / 60);
  }

  function updateTopbar() {
    if (!player) return;
    $('pos').textContent = solo() ? (session === 'quali' ? 'Q' : 'TT') : `P${position(player)}`;
    $('lap').textContent = `${Math.min(laps, player.lapsDone + 1)}/${laps}`;
    $('speed').textContent = Math.round(player.speed * KMH);
  }

  // ---------- Input ----------

  const keys = {};
  function readKeys() {
    input.left = !!(keys.ArrowLeft || keys.KeyA || touch.left);
    input.right = !!(keys.ArrowRight || keys.KeyD || touch.right);
    input.gas = !!(keys.ArrowUp || keys.KeyW);
    input.brake = !!(keys.ArrowDown || keys.KeyS || touch.brake);
    input.boost = !!(keys.ShiftLeft || keys.ShiftRight || keys.Space || touch.boost);
  }
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'paused') resume(); else pause(); return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && state !== 'menu') e.preventDefault();
    if (e.code.startsWith('Arrow') || e.code === 'KeyW') touchDriving = false;
    readKeys();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; readKeys(); });
  const touch = { left: false, right: false, brake: false, boost: false };
  function hold(id, k) {
    const el = $(id);
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); touch[k] = true; touchDriving = true; readKeys(); });
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { touch[k] = false; readKeys(); });
  }
  hold('t-left', 'left');
  hold('t-right', 'right');
  hold('t-brake', 'brake');
  hold('t-boost', 'boost');
  // Touching either half of the road steers too; on touch screens the throttle is automatic.
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    touchDriving = true;
    const r = canvas.getBoundingClientRect();
    touch[e.clientX - r.left < r.width / 2 ? 'left' : 'right'] = true;
    canvas.setPointerCapture(e.pointerId);
    readKeys();
  });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { touch.left = touch.right = false; readKeys(); });

  // ---------- Flow ----------

  function start() {
    ui.hide();
    if (mode === 'season') {
      const s = champ();
      if (s.round === 0 && !s.grid) saveChamp({ ...s, level });
      else level = s.level ?? level;
      return weekend();
    }
    newRace();
  }

  // A race weekend: qualifying first (or skip it and start from the back), then the Grand Prix.
  function weekend() {
    const s = champ(), c = D.CIRCUITS[s.round];
    if (s.grid) return newRace({ session: 'race', grid: s.grid, paces: s.paces });
    player = null;
    state = 'menu';
    build(c);
    ui.show({
      title: `Round ${s.round + 1} of ${D.CIRCUITS.length}`,
      html: `<p class="big" style="font-size:26px">${esc(c.name)}</p>
        <p>${esc(c.country)} · ${D.LEVELS[level].name} field${s.wet ? ' · <b>rain forecast</b>' : ' · dry'}</p>
        <p class="muted-note">Qualifying: two flying laps on your own. Your best lap against the field's times sets your grid slot.</p>
        <div class="menu"><button class="btn secondary" type="button" data-skip>Skip qualifying (start last)</button><button class="btn secondary" type="button" data-back>Back to menu</button></div>`,
      button: 'Go to qualifying',
      onAction: () => { ui.hide(); newRace({ session: 'quali' }); },
      onRender: panel => {
        panel.querySelector('[data-skip]').addEventListener('click', () => { ui.hide(); newRace({ session: 'race', grid: 'back' }); });
        panel.querySelector('[data-back]').addEventListener('click', () => menu());
      },
    });
  }

  function pause() {
    if (state !== 'racing' && state !== 'lights') return;
    pause.was = state;
    state = 'paused';
    ui.show({
      title: 'Paused',
      html: `<p>${esc(circuit.name)} · ${solo() ? (session === 'quali' ? 'qualifying lap' : 'time trial lap') : 'lap'} ${Math.min(laps, player.lapsDone + 1)} of ${laps}</p><div class="menu"><button class="btn secondary" type="button" data-quit>${solo() ? 'Leave session' : 'Retire'}</button></div>`,
      button: 'Resume',
      onAction: resume,
      onRender: panel => panel.querySelector('[data-quit]').addEventListener('click', () => { engine.stop(); state = 'menu'; menu(); }),
    });
  }
  function resume() {
    state = pause.was || 'racing';
    ui.hide();
  }
  Arcade.onBlur(pause);

  // ---------- Loop ----------

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (player && (state === 'lights' || state === 'racing' || state === 'finished')) {
      acc += dt;
      while (acc >= STEP) {
        step(STEP);
        acc -= STEP;
      }
    }
    ctx.save();
    if (shakeAmt > 0.3) ctx.translate((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);
    shakeAmt = Math.max(0, shakeAmt - dt * 30);
    if (player) {
      render();
      fx.update(state === 'paused' ? 0 : dt);
      fx.draw(ctx);
      hud();
      updateTopbar();
    } else {
      menuBackdrop(now / 1000);
    }
    ctx.restore();
    requestAnimationFrame(frame);
  }

  // Behind the menu: the selected circuit's scenery with a car parked on the grid.
  function menuBackdrop() {
    if (!bg) build(D.CIRCUITS[pickCircuit]);
    ctx.drawImage(bg.sky, 0, 0, W, H);
    ctx.drawImage(bg.far, 0, 0, W, H, 0, 0, W, H);
    ctx.drawImage(bg.mid, 0, 0, W, H, 0, 0, W, H);
    ctx.fillStyle = theme.grass[0];
    ctx.fillRect(0, bg.horizon - 2, W, H);
    ctx.fillStyle = theme.road[0];
    ctx.beginPath(); ctx.moveTo(W / 2 - 30, bg.horizon); ctx.lineTo(W / 2 + 30, bg.horizon); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.drawImage(A.car(D.TEAMS[0], 0), W / 2 - 150, H - 175, 300, 165);
  }

  function menu() {
    state = 'menu';
    player = null;
    build(D.CIRCUITS[mode === 'season' ? champ().round : pickCircuit]);
    Versus.attach(duelOpts);
  }

  const statLine = c => `Top ${Math.round(c.top * 100)} · Accel ${Math.round(c.accel * 100)} · Grip ${Math.round(c.grip * 100)} · Tyre life ${Math.round(100 / c.wear)} · Boost ${Math.round(c.boost * 100)}`;

  function menuHtml() {
    const s = champ();
    const m = D.MODES.find(x => x.id === mode);
    const chip = (attr, val, on, label, extra = '') => `<button class="chip" type="button" data-${attr}="${val}" aria-pressed="${on}" ${extra}>${label}</button>`;
    const circuits = D.CIRCUITS.map((c, i) => chip('circuit', i, i === pickCircuit, esc(c.name))).join('');
    const carChips = D.CARS.map(c => {
      const open = carUnlocked(c);
      return chip('car', c.id, c.id === carPick && open, `${open ? '' : '🔒 '}${esc(c.name)}`, open ? '' : `disabled title="${esc(c.unlock.text)}"`);
    }).join('');
    const cur = carUnlocked(carById(carPick)) ? carById(carPick) : D.CARS[0];
    const locked = D.CARS.filter(c => !carUnlocked(c));
    const table = D.TEAMS.map((t, i) => ({ t, pts: s.points[i], i })).sort((a, b) => b.pts - a.pts);
    const mine = table.findIndex(r => r.t.you) + 1;
    const seasonInfo = `<p class="muted-note">Round ${s.round + 1} of ${D.CIRCUITS.length}: <b>${esc(D.CIRCUITS[s.round].name)}</b>${s.wet ? ' · rain forecast' : ''}${s.round ? ` · you are P${mine} with ${s.points[0]} pts` : ''}${s.grid ? ' · qualifying done' : ''}</p>
      ${s.round ? '<button class="btn secondary" type="button" data-reset>Start a new season</button>' : ''}`;
    return `<p>${esc(m.desc)}</p>
      <ul>
        <li><span class="kbd-only"><kbd>↑</kbd> throttle, <kbd>↓</kbd> brake, <kbd>←</kbd><kbd>→</kbd> steer, <kbd>Shift</kbd> boost.</span><span class="touch-only">Hold the left or right side to steer; the throttle is automatic. Brake and Boost buttons below.</span></li>
        <li>To pit, keep right in the pit lane before the line and slow down. Wet tracks have less grip.</li>
      </ul>
      <div class="menu">
        <div class="row" style="flex-wrap:wrap">${D.MODES.map(x => chip('mode', x.id, x.id === mode, esc(x.name))).join('')}</div>
        ${mode === 'season' ? seasonInfo : `<div class="row" style="flex-wrap:wrap">${circuits}</div>`}
        <div class="row" style="flex-wrap:wrap">${D.LEVELS.map((l, i) => chip('level', i, i === level, l.name)).join('')}</div>
        ${mode !== 'season' ? `<div class="row" style="flex-wrap:wrap">${chip('wet', 0, !wetPick, '☀️ Dry')}${chip('wet', 1, wetPick, '🌧 Wet')}${mode === 'race' ? [3, 5, 8].map(n => chip('laps', n, n === quickLaps, `${n} laps`)).join('') : ''}</div>` : ''}
        <div class="row" style="flex-wrap:wrap">${carChips}</div>
        <p class="muted-note" style="margin-top:2px"><b>${esc(cur.name)}</b>: ${esc(cur.blurb)}<br>${statLine(cur)}${locked.length ? `<br>Unlock next: ${esc(locked[0].name)} (${esc(locked[0].unlock.text.toLowerCase())})` : ''}</p>
      </div>`;
  }

  const duelOpts = {
    ui,
    start,
    score: () => (player ? Math.max(0, Math.round((13 - position(player)) * 100 * LV.mult)) : 0),
    intro: {
      title: 'Apex GP',
      get html() { return menuHtml(); },
      get button() { return mode === 'season' ? (champ().grid ? 'Start the Grand Prix' : 'Start race weekend') : mode === 'trial' ? 'Start time trial' : 'Start race'; },
      onAction: start,
      onRender: panel => {
        const redraw = () => menu();
        panel.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; Arcade.save('apex:mode2', mode); redraw(); }));
        panel.querySelectorAll('[data-circuit]').forEach(b => b.addEventListener('click', () => { pickCircuit = +b.dataset.circuit; Arcade.save('apex:circuit', pickCircuit); redraw(); }));
        panel.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => { level = +b.dataset.level; Arcade.save('apex:level', level); redraw(); }));
        panel.querySelectorAll('[data-laps]').forEach(b => b.addEventListener('click', () => { quickLaps = +b.dataset.laps; redraw(); }));
        panel.querySelectorAll('[data-wet]').forEach(b => b.addEventListener('click', () => { wetPick = b.dataset.wet === '1'; Arcade.save('apex:wet', wetPick); redraw(); }));
        panel.querySelectorAll('[data-car]').forEach(b => b.addEventListener('click', () => { carPick = b.dataset.car; Arcade.save('apex:car', carPick); redraw(); }));
        panel.querySelector('[data-reset]')?.addEventListener('click', () => { saveChamp(freshSeason()); redraw(); });
      },
    },
  };

  menu();
  requestAnimationFrame(frame);
})();
