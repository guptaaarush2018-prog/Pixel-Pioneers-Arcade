/* Pocket Racer: the game page. Menus (home, career, quick race, time trial, online, garage,
   records, track builder) sit over a demo race; races use a camera that shows the whole track on
   big screens and follows your car on small ones. Content lives in data.js, drawing in art.js
   and sound in sound.js. */
(() => {
  const W = 800, H = 560, TRACK_W = RacerArt.TRACK_W, CAR_R = 13, STEP = 6;
  const TURN = 2.9;          // rad/s a car can turn once its tyres have full grip
  const TOP_SPEED = 300;
  const GHOST_STEP = 0.1;    // seconds between recorded ghost frames
  const SEND_EVERY = 1 / 15; // seconds between position updates in an online race
  const PAR_SPEED = 150;     // px/s; averaging faster than this earns an arcade time bonus
  const PLACE_POINTS = [1000, 600, 400, 200];
  const MARGIN = 160;        // world drawn around the field, for the follow camera
  const LAYER_SCALE = 2;     // resolution of the pre-drawn track layer
  const D = RacerData, A = RacerArt, S = RacerSound;
  const RIVAL_PACE = [1, 0.97, 0.94];
  // For testing: #autopilot drives your car for you, and nothing it does is posted online.
  const AUTOPILOT = location.hash === '#autopilot';
  const posting = () => Online.enabled && !AUTOPILOT;

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const fmt = t => (t == null || !isFinite(t) ? '–' : t.toFixed(2) + 's');
  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][n] || 'th');
  const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(p => p[1]);

  const canvas = $('game'), stage = $('stage'), screens = $('screens');
  const ctx = canvas.getContext('2d');
  const ui = Arcade.overlay($('overlay'));
  const body = document.body;

  // ---------- Canvas & layers ----------

  let cw = 1, ch = 1, dpr = 1;
  const nightLayer = document.createElement('canvas');
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = stage.getBoundingClientRect();
    cw = Math.max(1, r.width);
    ch = Math.max(1, r.height);
    canvas.width = nightLayer.width = Math.round(cw * dpr);
    canvas.height = nightLayer.height = Math.round(ch * dpr);
    snapCamera = true;
  }
  new ResizeObserver(resize).observe(stage);

  const makeCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const sceneLayer = makeCanvas((W + MARGIN * 2) * LAYER_SCALE, (H + MARGIN * 2) * LAYER_SCALE);
  const skidLayer = makeCanvas(W * LAYER_SCALE, H * LAYER_SCALE);
  const skidCtx = skidLayer.getContext('2d');
  const miniLayer = makeCanvas(160 * 2, 112 * 2);
  let scene = null;

  // ---------- Saved progress ----------

  const coins = () => Arcade.load('racer:coins', 0);
  function addCoins(n) {
    if (!n) return;
    Arcade.save('racer:coins', coins() + n);
    updateWallet(true);
  }
  const starsMap = () => Arcade.load('racer:stars', {});
  const totalStars = () => Object.values(starsMap()).reduce((a, b) => a + b, 0);
  const starsOf = id => starsMap()[id] || 0;
  const cupDone = cup => cup.events.every((_, i) => starsOf(`${cup.id}-${i + 1}`) >= 1);
  const cupOpen = ci => ci === 0 || cupDone(D.CUPS[ci - 1]);
  const eventOpen = ev => cupOpen(ev.cupIndex) && (ev.index === 0 || starsOf(`${ev.cup.id}-${ev.index}`) >= 1);
  const owned = () => Arcade.load('racer:skins', []);
  function skinUnlocked(s) {
    const u = s.unlock;
    if (u.coins) return owned().includes(s.id);
    if (u.stars) return totalStars() >= u.stars;
    if (u.cup) return cupDone(D.CUPS.find(c => c.id === u.cup));
    return true;
  }
  const unlockText = s => s.unlock.coins ? `${s.unlock.coins} coins` : s.unlock.stars ? `${s.unlock.stars} career stars` : s.unlock.cup ? `Finish the ${D.CUPS.find(c => c.id === s.unlock.cup).name}` : 'Free';
  const mySkin = () => {
    const s = D.SKINS.find(k => k.id === Arcade.load('racer:skin', 'sunburst'));
    return s && skinUnlocked(s) ? s : D.SKINS[0];
  };
  const skinById = id => D.SKINS.find(s => s.id === id) || D.SKINS[1];

  function updateWallet(bump = false) {
    $('coins').textContent = coins().toLocaleString();
    $('stars').textContent = totalStars();
    if (bump) {
      const w = $('wallet');
      w.classList.remove('bump');
      void w.offsetWidth;
      w.classList.add('bump');
    }
  }

  // Your own tracks from the builder live in localStorage. Old saves stored a grass colour.
  const OLD_GRASS = ['#2d5f3a', '#3a5a2c', '#8a6a45', '#b8935a', '#c3d3dd', '#1d2540'];
  const customTracks = () => Arcade.load('tracks', []).map(t => ({
    ...t, custom: true, theme: t.theme || D.THEMES[Math.max(0, OLD_GRASS.indexOf(t.grass))].id,
  }));
  const findTrack = id => D.trackById(id) || customTracks().find(t => t.id === id);

  // Records: best lap and best race time per track (race times per lap count).
  const lapKey = id => 'lap:' + id;
  const timeKey = (id, laps) => laps === 3 ? 'time:' + id : `time:${id}:${laps}`;
  const ghostKey = (id, laps) => laps === 3 ? 'ghost:' + id : `ghost:${id}:${laps}`;
  // Which ghost a time trial races: 'world', 'mine', or a friend's id.
  let ghostPick = Arcade.load('racer:ghostPick', 'world');
  // World leaderboards store "higher is better", so lap times go in as 10,000,000 minus milliseconds.
  const lapBoard = id => 'prt-' + id;
  const toScore = t => Math.max(0, 1e7 - Math.round(t * 1000));
  const fromScore = s => (1e7 - s) / 1000;

  // ---------- Track geometry ----------

  // Smooth closed curve through the control points, resampled to evenly spaced points.
  function buildPath(points) {
    const raw = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
      for (let s = 0; s < 24; s++) {
        const t = s / 24, t2 = t * t, t3 = t2 * t;
        raw.push({
          x: 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          y: 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        });
      }
    }
    const out = [raw[0]];
    let carry = 0, total = 0;
    for (let i = 1; i <= raw.length; i++) {
      const a = raw[i - 1], b = raw[i % raw.length];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      total += seg;
      let along = STEP - carry;
      while (along <= seg) {
        const t = along / seg;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        along += STEP;
      }
      carry = seg - (along - STEP);
    }
    if (Math.hypot(out[out.length - 1].x - out[0].x, out[out.length - 1].y - out[0].y) < STEP / 2) out.pop();
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[(i + 1) % out.length];
      out[i].a = Math.atan2(b.y - a.y, b.x - a.x);
    }
    return { path: out, length: total };
  }

  const pathCache = new Map();
  function pathOf(t) {
    const key = t.id + ':' + t.points.join(';');
    if (!pathCache.has(key)) pathCache.set(key, buildPath(t.points));
    return pathCache.get(key);
  }

  // Radius of the curve at each point, measured across a few neighbours either side.
  function radii(p) {
    const n = p.length, k = 3, out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = p[(i - k + n) % n], b = p[i], c = p[(i + k) % n];
      const turn = Math.abs(angleDiff(Math.atan2(c.y - b.y, c.x - b.x), Math.atan2(b.y - a.y, b.x - a.x)));
      const arc = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y);
      out[i] = turn > 1e-4 ? arc / turn : Infinity;
    }
    return out;
  }

  // Works out whether a layout can be raced, and where the trouble spots are so the editor can mark them.
  function checkTrack(points) {
    if (points.length < 3) return { ok: false, msg: 'Tap to place corners in driving order', bad: [], path: null };
    const { path: p, length } = buildPath(points);
    const n = p.length, bad = [], edge = TRACK_W / 2 + 6;
    let msg = '';
    const flag = (pt, why) => { bad.push(pt); msg ||= why; };
    p.forEach(pt => { if (pt.x < edge || pt.x > W - edge || pt.y < edge || pt.y > H - edge) flag(pt, 'Keep the track inside the field'); });
    radii(p).forEach((r, i) => { if (r < 35) flag(p[i], 'A corner is too tight to drive'); });
    // Points far apart along the track must also be far apart on screen, or the road overlaps itself.
    const apart = Math.ceil(170 / STEP);
    for (let i = 0; i < n; i += 2) {
      for (let j = i + apart; j < Math.min(n, i + n - apart); j += 2) {
        if (Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y) < TRACK_W + 14) { flag(p[i], 'The road runs into itself'); break; }
      }
    }
    if (!msg && length < 1000) msg = 'Make the loop a little longer';
    return { ok: !msg, msg, bad, path: p, length };
  }

  // The rivals' racing line: the centreline relaxed toward its neighbours, which straightens it
  // and cuts across apexes, while staying on the tarmac. Every point then gets a top speed: what
  // the car can turn through there, lowered ahead of corners to leave room for braking.
  function planRacingLine() {
    const lim = TRACK_W / 2 - CAR_R - 4;
    const nx = path.map(p => Math.cos(p.a + Math.PI / 2)), ny = path.map(p => Math.sin(p.a + Math.PI / 2));
    const lo = new Float32Array(N).fill(-lim), hi = new Float32Array(N).fill(lim);
    rad.forEach((r, i) => {
      const room = clamp(r - 110 / TURN, -lim, lim);
      if (angleDiff(path[(i + 3) % N].a, path[(i - 3 + N) % N].a) > 0) hi[i] = Math.min(hi[i], room);
      else lo[i] = Math.max(lo[i], -room);
    });
    const off = new Float32Array(N);
    for (const span of [24, 12, 6]) {
      for (let it = 0; it < 120; it++) {
        for (let i = 0; i < N; i++) {
          const a = (i - span + N) % N, b = (i + span) % N;
          const mx = (path[a].x + nx[a] * off[a] + path[b].x + nx[b] * off[b]) / 2;
          const my = (path[a].y + ny[a] * off[a] + path[b].y + ny[b] * off[b]) / 2;
          off[i] = clamp((mx - path[i].x) * nx[i] + (my - path[i].y) * ny[i], lo[i], hi[i]);
        }
      }
    }
    const line = path.map((p, i) => ({ x: p.x + nx[i] * off[i], y: p.y + ny[i] * off[i] }));
    const speed = Float32Array.from(radii(line), r => clamp(r * TURN * 0.9, 70, TOP_SPEED));
    for (let k = 0; k < 2 * N; k++) {
      const i = (N * 2 - 1 - k) % N, j = (i + 1) % N;
      const ds = Math.hypot(line[j].x - line[i].x, line[j].y - line[i].y);
      speed[i] = Math.min(speed[i], Math.sqrt(speed[j] ** 2 + 2 * 520 * ds));
    }
    return { off, nx, ny, lim, speed };
  }

  // Draws the track once into the scene layer; the race then just copies it each frame.
  function renderScene() {
    const c = sceneLayer.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, sceneLayer.width, sceneLayer.height);
    c.setTransform(LAYER_SCALE, 0, 0, LAYER_SCALE, MARGIN * LAYER_SCALE, MARGIN * LAYER_SCALE);
    scene = A.buildScene(c, track, path, rad, W, H);
    A.drawScene(c, scene);
    skidCtx.setTransform(1, 0, 0, 1, 0, 0);
    skidCtx.clearRect(0, 0, skidLayer.width, skidLayer.height);
    skidCtx.setTransform(LAYER_SCALE, 0, 0, LAYER_SCALE, 0, 0);
    // Minimap: the track outline, with the cars added each frame.
    const m = miniLayer.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, miniLayer.width, miniLayer.height);
    A.trackThumb(m, path, miniLayer.width, miniLayer.height, { color: 'rgba(255,255,255,0.85)', width: 7, pad: 14 });
  }

  // Nearest path index to (x, y), searching around a hint index.
  function nearest(x, y, hint) {
    let best = hint, bestD = Infinity;
    for (let k = -40; k <= 40; k++) {
      const i = (hint + k + N) % N;
      const d = (path[i].x - x) ** 2 + (path[i].y - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return { i: best, d: Math.sqrt(bestD) };
  }

  // ---------- Race state ----------

  let state = 'menu';  // menu (demo race behind the screens) · playing · paused · over · online-over · edit
  let mode = 'demo';   // demo · career · quick · trial · online
  let setup = null;    // what the current race was started with, for restarts
  let track, path, N, trackLen, rad, racing, laps, level, event;
  let cars = [], player, raceTime, countdown, lapStart, bestLap, recorded, recordAcc, ghost, finishT, lastPos;
  let particles = [];
  let edit = null;
  let net = null;   // online race: { conn, host, names, skin, want, sendT, target, targetAt, lag, wins, mine, theirs }
  let raceOnline = false; // stays set if the opponent leaves mid-race, so it never scores as solo
  const online = () => raceOnline;
  const keys = { up: false, down: false, left: false, right: false };
  let touchGas = false, lastTouch = false;
  let demoT = 0;

  function makeCar(slot, spec) {
    const back = 8 + Math.floor(slot / 2) * 9;
    const i = (N - back) % N;
    const p = path[i];
    const side = slot % 2 ? 1 : -1;
    return {
      x: p.x + Math.cos(p.a + Math.PI / 2) * side * 18,
      y: p.y + Math.sin(p.a + Math.PI / 2) * side * 18,
      a: p.a, v: 0, idx: i, dist: -back, lap: 0,
      skin: spec.skin, name: spec.name, ai: !!spec.ai, pace: (spec.pace || 1) * level.pace,
      lane: 0, laneT: Arcade.rand(1, 3), finished: null, offTrack: false,
      steer: 0, braking: false, gas: false, slide: 0, rear: null, puff: 0,
    };
  }

  // Sets up the grid. Online races are just the two of you, side by side on the front row.
  function setupRace(t, opts) {
    track = t;
    ({ path, length: trackLen } = pathOf(t));
    N = path.length;
    rad = radii(path);
    racing = planRacingLine();
    laps = opts.laps;
    level = opts.level;
    event = opts.event || null;
    mode = opts.mode;
    renderScene();
    const me = mySkin();
    if (opts.vs) {
      const vs = opts.vs;
      const mine = makeCar(vs.host ? 0 : 1, { skin: me, name: 'You' });
      const theirs = makeCar(vs.host ? 1 : 0, { skin: skinById(vs.skin), name: vs.names[1] });
      theirs.remote = true;
      cars = [mine, theirs];
      vs.mine = new Map();   // track step -> race time each car first reached it, for the live gap
      vs.theirs = new Map();
    } else if (mode === 'trial') {
      cars = [makeCar(0, { skin: me, name: 'You' })];
    } else if (mode === 'demo') {
      const skins = shuffle(D.SKINS);
      const names = shuffle(D.RIVALS);
      cars = [0, 1, 2, 3].map(i => makeCar(i, { skin: skins[i], name: names[i], ai: true, pace: 1.02 - i * 0.03 }));
    } else {
      const skins = shuffle(D.SKINS.filter(s => s.id !== me.id));
      const names = shuffle(D.RIVALS);
      cars = [makeCar(3, { skin: me, name: 'You' }), ...RIVAL_PACE.map((pace, i) => makeCar(i, { skin: skins[i], name: names[i], ai: true, pace }))];
    }
    player = cars[0];
    raceTime = 0;
    countdown = mode === 'demo' ? 0 : 3.5 + (opts.lead || 0);
    lapStart = 0;
    bestLap = Infinity;
    recorded = [];
    recordAcc = 0;
    ghost = null;
    finishT = null;
    lastPos = cars.length;
    particles = [];
    snapCamera = true;
    if (!opts.vs && mode !== 'demo') loadGhost();
  }

  // The target time for three stars: one clean run by a rival at the cup's pace that never
  // drifts off the racing line, simulated ahead of time. Rivals wander, so it beats them all.
  const parCache = new Map();
  function parTime(ev) {
    if (parCache.has(ev.id)) return parCache.get(ev.id);
    const saved = { track, path, N, trackLen, rad, racing, level };
    track = D.trackById(ev.track);
    ({ path, length: trackLen } = pathOf(track));
    N = path.length;
    rad = radii(path);
    racing = planRacingLine();
    level = { ...D.LEVELS.find(l => l.id === ev.level), wander: 0 };
    const car = makeCar(0, { skin: D.SKINS[0], name: '', ai: true, pace: 1 });
    let t = 0;
    const dt = 1 / 60;
    while (car.dist < N * ev.laps && t < 600) {
      const input = aiInput(car, dt);
      drive(car, dt, input.gas, input.brake, input.steer);
      t += dt;
    }
    ({ track, path, N, trackLen, rad, racing, level } = saved);
    parCache.set(ev.id, t);
    return t;
  }

  // ---------- Ghosts ----------

  const encode = frames => frames.map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.a * 100)].map(n => n.toString(36)).join(',')).join(';');
  const decode = s => s.split(';').map(f => {
    const [x, y, a] = f.split(',').map(n => parseInt(n, 36));
    return { x, y, a: a / 100 };
  });

  // The world ghost is the fastest 3-lap race on a built-in track; custom tracks and other
  // lap counts keep a ghost on this device only. Every player's own best 3-lap race is also kept
  // online (pghosts/<track>/<id>), so a time trial can race a friend's ghost instead.
  const friendGhostPath = (trackId, id) => `pghosts/${trackId}/${id}`;
  function loadGhost() {
    const local = Arcade.load(ghostKey(track.id, laps), null);
    const use = g => { if (g && g.frames) ghost = { ...g, frames: decode(g.frames) }; };
    const mine = () => use(local && { ...local, name: 'Your best', skin: mySkin().id });
    const pick = mode === 'trial' ? ghostPick : 'world';
    if (pick === 'mine' || !Online.enabled || track.custom || laps !== 3) return mine();
    const forTrack = track;
    const world = () => Online.getGhost(track.id)
      .then(g => { if (g && forTrack === track && laps === 3 && (!local || g.time <= local.time)) use({ ...g, name: g.name }); })
      .catch(() => {});
    const friend = pick !== 'world' && Friends.get(pick);
    if (!friend) {
      mine();
      return world();
    }
    const name = Friends.short(pick, friend.name);
    Online.get(friendGhostPath(track.id, pick))
      .then(g => {
        if (forTrack !== track) return;
        if (g && g.frames) use({ ...g, name, friend: pick });
        else {
          Arcade.toast('No ghost yet', `${name} hasn't raced ${track.name} yet. Racing the world ghost.`);
          mine();
          world();
        }
      })
      .catch(() => { mine(); world(); });
  }

  function saveGhost(time) {
    const frames = encode(recorded);
    const key = ghostKey(track.id, laps);
    const local = Arcade.load(key, null);
    if (!local || time < local.time) Arcade.save(key, { time, frames });
    if (!posting() || track.custom || laps !== 3) return;
    Online.saveGhost(track.id, time, frames).catch(() => {}); // rules keep only faster times
    // Our own best race goes up for friends to chase. 'ghost:up:<track>' remembers the time we
    // last sent, so a best set before this existed still gets uploaded once.
    const best = Arcade.load(key, null);
    const upKey = 'ghost:up:' + track.id;
    if (best && Arcade.load(upKey, null) !== best.time) {
      const me = Arcade.profile();
      Online.put(friendGhostPath(track.id, me.id), { name: me.name, time: best.time, frames: best.frames, skin: mySkin().id, t: Online.TIMESTAMP })
        .then(() => Arcade.save(upKey, best.time))
        .catch(() => {});   // a slower time than the one already up is refused: harmless
    }
  }

  function ghostAt(t) {
    if (!ghost) return null;
    const f = t / GHOST_STEP;
    const i = Math.floor(f);
    if (i >= ghost.frames.length - 1) return null;
    const a = ghost.frames[i], b = ghost.frames[i + 1], k = f - i;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: a.a + angleDiff(b.a, a.a) * k };
  }

  // ---------- Driving ----------

  // Cars drive straight through each other, so rivals never get in the way of a good lap.
  // The handling is the same as it always was, so old ghosts and records stay fair.
  function drive(car, dt, gas, brake, steer) {
    const top = car.offTrack ? 120 : TOP_SPEED;
    if (gas) car.v += 420 * dt;
    if (brake) car.v -= (car.v > 0 ? 700 : 300) * dt;
    car.v -= car.v * (car.offTrack ? 2.2 : 0.5) * dt;
    car.v = Math.max(-90, Math.min(top, car.v));
    const grip = Math.min(1, Math.abs(car.v) / 110);
    car.a += steer * TURN * grip * Math.sign(car.v || 1) * dt;
    car.x += Math.cos(car.a) * car.v * dt;
    car.y += Math.sin(car.a) * car.v * dt;
    car.x = Math.max(CAR_R, Math.min(W - CAR_R, car.x));
    car.y = Math.max(CAR_R, Math.min(H - CAR_R, car.y));
    // Only for looks and sound: how hard the tyres are working.
    car.steer += (steer - car.steer) * Math.min(1, dt * 14);
    car.gas = gas;
    car.braking = brake && car.v > 20;
    const work = Math.abs(steer) * grip * clamp((car.v - 150) / 130, 0, 1) + (car.braking && car.v > 160 ? 0.5 : 0);
    car.slide += (Math.min(1, work) - car.slide) * Math.min(1, dt * 10);

    const near = nearest(car.x, car.y, car.idx);
    let step = near.i - car.idx;
    if (step > N / 2) step -= N;
    if (step < -N / 2) step += N;
    car.idx = near.i;
    car.dist += step;
    car.offTrack = near.d > TRACK_W / 2 + 4;
  }

  // Rivals chase a point on the racing line a little ahead (further at speed) and steer along
  // the arc that reaches it, then hold the line's planned speed scaled by their pace.
  function aiInput(car, dt) {
    car.laneT -= dt;
    if (car.laneT <= 0) {
      car.lane = Arcade.rand(-1, 1) * level.wander;
      car.laneT = Arcade.rand(1.5, 3.5);
    }
    const { off, nx, ny, lim, speed } = racing;
    const j = (car.idx + Math.round((24 + Math.max(0, car.v) * 0.22) / STEP)) % N;
    const o = clamp(off[j] + car.lane, -lim, lim);
    const dx = path[j].x + nx[j] * o - car.x, dy = path[j].y + ny[j] * o - car.y;
    const yaw = 2 * car.v * Math.sin(angleDiff(Math.atan2(dy, dx), car.a)) / Math.max(1, Math.hypot(dx, dy));
    const grip = Math.max(0.2, Math.min(1, Math.abs(car.v) / 110));
    const steer = clamp(yaw / (TURN * grip), -1, 1);
    const target = speed[(car.idx + 2) % N] * car.pace;
    return { gas: car.v < target, brake: car.v > target + 10, steer };
  }

  function update(dt) {
    if (countdown > 0) {
      const before = Math.ceil(countdown);
      countdown -= dt;
      const after = Math.ceil(countdown);
      if (after !== before && after > 0 && after <= 3) S.sfx.light();
      if (countdown <= 0) {
        S.sfx.go();
        banner('GO!');
        for (const car of cars) puff(car, 8, car.skin.smoke);
      }
      updateLights();
      updateParticles(dt);
      return;
    }
    raceTime += dt;
    updateLights();

    for (const car of cars) {
      if (car.remote) { followRemote(car, dt); effects(car, dt); continue; }
      let input;
      if (car === player && !car.ai && car.finished === null) {
        input = { gas: keys.up || touchGas, brake: keys.down, steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0) };
      } else if (car.finished !== null && car !== player) {
        input = { gas: false, brake: true, steer: aiInput(car, dt).steer };
      } else {
        input = aiInput(car, dt); // rivals, the demo, and your car on autopilot after the flag
      }
      drive(car, dt, input.gas, input.brake, input.steer);
      effects(car, dt);
      const lap = Math.floor(car.dist / N);
      if (lap > car.lap) {
        car.lap = lap;
        if (car === player && mode !== 'demo' && lap <= laps) onPlayerLap(lap);
        if (lap >= laps && car.finished === null) car.finished = raceTime;
      }
    }
    updateParticles(dt);

    if (mode === 'demo') {
      demoT -= dt;
      if (demoT <= 0) startDemo();
      return;
    }

    if (player.finished === null) {
      recordAcc += dt;
      while (recordAcc >= GHOST_STEP) {
        recordAcc -= GHOST_STEP;
        recorded.push({ x: player.x, y: player.y, a: player.a });
      }
    }

    if (net) {
      reached(net.mine, player.dist, raceTime);
      net.sendT -= dt;
      if (net.sendT <= 0 || (player.finished !== null && !net.sentFinish)) {
        net.sendT = SEND_EVERY;
        net.sentFinish = player.finished !== null;
        net.conn.state({ x: Math.round(player.x), y: Math.round(player.y), a: Math.round(player.a * 100) / 100, v: Math.round(player.v), d: player.dist, f: player.finished });
      }
    }

    const pos = position(player);
    if (pos < lastPos && player.finished === null && raceTime > 2) S.sfx.overtake();
    lastPos = pos;

    if (player.finished !== null && finishT === null) {
      finishT = 1.6;
      player.pace = 0.5;
      player.ai = true;
      const place = position(player);
      banner(mode === 'trial' ? 'FINISH' : place === 1 ? 'WINNER!' : `${ordinal(place)} PLACE`, fmt(player.finished));
      (place === 1 || mode === 'trial' ? S.sfx.win : place <= 3 ? S.sfx.podium : S.sfx.lose)();
      if (place <= 3 || mode === 'trial') confetti(place === 1 ? 90 : 40);
    }
    if (finishT !== null && state === 'playing') {
      finishT -= dt;
      if (finishT <= 0) {
        S.stopCar();
        if (online()) finishOnline();
        else if (mode === 'trial') finishTrial();
        else finishRace();
      }
    }
    updateHud();
  }

  function onPlayerLap(lap) {
    const lapTime = raceTime - lapStart;
    lapStart = raceTime;
    const record = Arcade.load(lapKey(track.id), null);
    const fastest = lapTime < bestLap;
    bestLap = Math.min(bestLap, lapTime);
    if (lap >= laps) return;
    if (!track.custom && (!record || lapTime < record) && fastest) {
      banner('LAP RECORD', fmt(lapTime));
      S.sfx.bestLap();
    } else if (lap === laps - 1) {
      banner('FINAL LAP', fmt(lapTime));
      S.sfx.finalLap();
    } else {
      banner(`LAP ${lap + 1}/${laps}`, fmt(lapTime));
      S.sfx.lap();
    }
  }

  const position = car => 1 + cars.filter(c => c !== car && (
    (c.finished !== null && (car.finished === null || c.finished < car.finished)) ||
    (c.finished === null && car.finished === null && c.dist > car.dist))).length;

  // ---------- Effects: smoke, dust, skid marks, confetti ----------

  function rearWheels(car) {
    const m = A.MODELS[car.skin.model] || A.MODELS.coupe;
    const bx = m.wheels[0][0], by = m.wheels[0][1];
    const c = Math.cos(car.a), s = Math.sin(car.a);
    return [[car.x + c * bx - s * by, car.y + s * bx + c * by], [car.x + c * bx + s * by, car.y + s * bx - c * by]];
  }

  function puff(car, n, color, spread = 30) {
    const [l, r] = rearWheels(car);
    for (let i = 0; i < n; i++) {
      const w = i % 2 ? l : r;
      particles.push({
        x: w[0], y: w[1], vx: Arcade.rand(-spread, spread) - Math.cos(car.a) * 20, vy: Arcade.rand(-spread, spread) - Math.sin(car.a) * 20,
        life: 0, max: Arcade.rand(0.5, 0.9), size: Arcade.rand(3, 6), grow: 14, color, kind: 'smoke',
      });
    }
  }

  function effects(car, dt) {
    const wheels = rearWheels(car);
    const speed = Math.abs(car.v);
    const sliding = car.slide > 0.3 && !car.offTrack;
    if (car.rear && (sliding || (car.offTrack && speed > 60))) {
      skidCtx.strokeStyle = car.offTrack ? 'rgba(40,28,12,0.16)' : `rgba(16,16,18,${0.18 + car.slide * 0.2})`;
      skidCtx.lineWidth = 2.6;
      skidCtx.lineCap = 'round';
      skidCtx.beginPath();
      for (let k = 0; k < 2; k++) {
        skidCtx.moveTo(car.rear[k][0], car.rear[k][1]);
        skidCtx.lineTo(wheels[k][0], wheels[k][1]);
      }
      skidCtx.stroke();
    }
    car.rear = wheels;
    car.puff -= dt;
    if (car.puff > 0 || particles.length > 320) return;
    if (sliding) {
      car.puff = 0.05;
      puff(car, 2, car.skin.smoke, 14);
    } else if (car.offTrack && speed > 60) {
      car.puff = 0.06;
      puff(car, 2, scene.theme.dust, 22);
    } else if (car.gas && speed < 90 && raceTime < 3 && mode !== 'demo') {
      car.puff = 0.08;
      puff(car, 1, 'rgba(200,200,200,0.8)', 10);
    }
  }

  function confetti(n) {
    const colors = ['#ffc53d', '#ff4d5e', '#4f8cff', '#3ddc84', '#ffffff', '#c77dff'];
    for (let i = 0; i < n; i++) {
      const a = Arcade.rand(0, Math.PI * 2), sp = Arcade.rand(60, 240);
      particles.push({
        x: player.x, y: player.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: Arcade.rand(1.2, 2.2),
        size: Arcade.rand(2, 4), color: Arcade.pick(colors), kind: 'confetti', spin: Arcade.rand(-12, 12), r: Arcade.rand(0, 6),
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = p.kind === 'confetti' ? 1.6 : 3;
      p.vx -= p.vx * drag * dt;
      p.vy -= p.vy * drag * dt;
      if (p.grow) p.size += p.grow * dt;
      if (p.spin) p.r += p.spin * dt;
    }
    particles = particles.filter(p => p.life < p.max);
  }

  function drawParticles(kind) {
    for (const p of particles) {
      if ((p.kind === 'confetti') !== (kind === 'confetti')) continue;
      const k = 1 - p.life / p.max;
      ctx.globalAlpha = p.kind === 'confetti' ? Math.min(1, k * 2) : k * 0.5;
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillRect(-p.size, -p.size / 2.5, p.size * 2, p.size / 1.25);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Camera ----------

  const cam = { x: W / 2, y: H / 2, z: 1 };
  let snapCamera = true;
  let camMode = Arcade.load('racer:cam', 'auto');
  const fullZoom = () => Math.min(cw / (W + 16), ch / (H + 16));
  const following = () => state !== 'edit' && (camMode === 'follow' || (camMode === 'auto' && fullZoom() < 0.72));

  function updateCamera(dt) {
    let tx = W / 2, ty = H / 2, tz = fullZoom();
    const target = mode === 'demo' ? cars.reduce((a, b) => (b.dist > a.dist ? b : a), cars[0]) : player;
    if (following() && target) {
      const speed = Math.abs(target.v) / TOP_SPEED;
      tz = Math.max(fullZoom() * 1.05, Math.min(cw, ch) / 360 * (1 - speed * 0.14));
      tx = target.x + Math.cos(target.a) * target.v * 0.32;
      ty = target.y + Math.sin(target.a) * target.v * 0.32;
      // Don't look much past the edge of the world.
      const hw = cw / 2 / tz, hh = ch / 2 / tz, slack = MARGIN * 0.9;
      tx = hw * 2 > W + slack * 2 ? W / 2 : clamp(tx, hw - slack, W - hw + slack);
      ty = hh * 2 > H + slack * 2 ? H / 2 : clamp(ty, hh - slack, H - hh + slack);
    }
    const k = snapCamera ? 1 : 1 - Math.exp(-dt * 4.5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.z += (tz - cam.z) * (snapCamera ? 1 : 1 - Math.exp(-dt * 3));
    snapCamera = false;
  }

  function worldMatrix() {
    let sx = 0, sy = 0;
    if (state === 'playing' && player && player.offTrack && Math.abs(player.v) > 80 && !player.ai) {
      sx = Arcade.rand(-1, 1) * 1.2;
      sy = Arcade.rand(-1, 1) * 1.2;
    }
    const z = cam.z * dpr;
    return new DOMMatrix([z, 0, 0, z, dpr * (cw / 2 - cam.x * cam.z + sx), dpr * (ch / 2 - cam.y * cam.z + sy)]);
  }

  function setCamMode(m) {
    camMode = m;
    Arcade.save('racer:cam', m);
    snapCamera = true;
  }

  // ---------- Drawing ----------

  function draw(dt) {
    updateCamera(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!scene) return;
    const m = worldMatrix();
    ctx.setTransform(m);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sceneLayer, -MARGIN, -MARGIN, W + MARGIN * 2, H + MARGIN * 2);
    ctx.drawImage(skidLayer, 0, 0, W, H);
    A.drawCrowd(ctx, scene, performance.now() / 1000, finishT !== null ? 1 : 0);
    drawParticles('smoke');

    const racingNow = state !== 'menu';
    const g = racingNow ? ghostAt(raceTime) : null;
    if (g) A.drawCar(ctx, ghost.skin ? skinById(ghost.skin) : mySkin(), g.x, g.y, g.a, { alpha: ghost.friend ? 0.45 : 0.32 });

    // Rivals are see-through where they overlap you, so your own car always stays visible.
    const others = cars.filter(c => c !== player || mode === 'demo');
    for (const car of others) {
      const over = mode !== 'demo' && Math.hypot(car.x - player.x, car.y - player.y) < CAR_R * 2.5;
      A.drawCar(ctx, car.skin, car.x, car.y, car.a, { steer: car.steer, brake: car.braking, alpha: over ? 0.5 : 1 });
    }
    if (mode !== 'demo') A.drawCar(ctx, player.skin, player.x, player.y, player.a, { steer: player.steer, brake: player.braking });

    // Labels: ghost, the online opponent, and an arrow over you on the grid.
    ctx.textAlign = 'center';
    ctx.font = '700 10px system-ui, sans-serif';
    if (g) {
      ctx.fillStyle = ghost.friend ? 'rgba(255,214,102,0.9)' : 'rgba(255,255,255,0.7)';
      ctx.fillText(`${ghost.friend ? '★ ' : ''}${ghost.name} · ${ghost.time.toFixed(1)}s`, g.x, g.y - 18);
    }
    for (const car of cars) {
      if (car === player || mode === 'demo' || (!car.remote && !following())) continue;
      tag(car.name, car.x, car.y - 18, car.skin.paint);
    }
    if (racingNow && raceTime < 3 && mode !== 'demo') {
      const bob = Math.sin(performance.now() / 150) * 2;
      ctx.fillStyle = '#ffc53d';
      ctx.beginPath();
      ctx.moveTo(player.x - 7, player.y - 27 + bob);
      ctx.lineTo(player.x + 7, player.y - 27 + bob);
      ctx.lineTo(player.x, player.y - 18 + bob);
      ctx.fill();
    }
    drawParticles('confetti');
    if (scene.theme.night) A.drawNight(nightLayer, ctx, scene, cars, m);
    drawMinimap();
  }

  function tag(text, x, y, color) {
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(10,12,18,0.7)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 9, w, 13, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y - 9, 2.5, 13);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x + 1, y + 1);
  }

  const mini = $('minimap'), miniCtx = mini.getContext('2d');
  function drawMinimap() {
    const show = state !== 'menu' && following();
    mini.hidden = !show;
    if (!show) return;
    const r = window.devicePixelRatio > 1 ? 2 : 1;
    if (mini.width !== mini.clientWidth * r) {
      mini.width = mini.clientWidth * r;
      mini.height = mini.clientHeight * r;
    }
    miniCtx.setTransform(1, 0, 0, 1, 0, 0);
    miniCtx.clearRect(0, 0, mini.width, mini.height);
    miniCtx.drawImage(miniLayer, 0, 0, mini.width, mini.height);
    const s = Math.min((mini.width - 14 * mini.width / miniLayer.width * 2) / W, (mini.height - 14 * mini.height / miniLayer.height * 2) / H);
    const ox = (mini.width - W * s) / 2, oy = (mini.height - H * s) / 2;
    for (const car of [...cars].reverse()) {
      miniCtx.fillStyle = car === player ? '#ffc53d' : car.skin.paint;
      miniCtx.strokeStyle = '#000';
      miniCtx.lineWidth = r;
      miniCtx.beginPath();
      miniCtx.arc(ox + car.x * s, oy + car.y * s, (car === player ? 4.5 : 3.2) * r, 0, Math.PI * 2);
      miniCtx.fill();
      miniCtx.stroke();
    }
  }

  // ---------- HUD ----------

  const hudCache = {};
  const setText = (id, text) => {
    if (hudCache[id] === text) return;
    hudCache[id] = text;
    $(id).textContent = text;
  };
  let towerT = 0;

  function updateHud() {
    const pos = position(player);
    setText('pos', mode === 'trial' ? '–' : ordinal(pos));
    setText('pos-of', mode === 'trial' ? '' : `/${cars.length}`);
    setText('lap', `${Math.min(laps, Math.max(1, player.lap + 1))}/${laps}`);
    setText('time', raceTime.toFixed(2));
    const rec = Arcade.load(lapKey(track.id), null);
    setText('best', `Best ${isFinite(bestLap) ? bestLap.toFixed(2) : '–'}${rec ? ` · Rec ${rec.toFixed(2)}` : ''}`);
    const kmh = Math.round(Math.abs(player.v) * 0.8);
    setText('speed', String(kmh));
    $('speedo').style.setProperty('--v', (Math.abs(player.v) / TOP_SPEED).toFixed(3));
    setText('gap', gapText());
    towerT -= 1 / 60;
    if (towerT <= 0) {
      towerT = 0.25;
      const order = [...cars].sort((a, b) => position(a) - position(b));
      $('tower').innerHTML = mode === 'trial' ? '' : order.map((c, i) => `<li class="${c === player ? 'me' : ''}"><span class="n">${i + 1}</span><i style="background:${c.skin.paint}"></i>${esc(c.name)}${c.finished !== null ? '<span class="done">✓</span>' : ''}</li>`).join('');
    }
  }

  function updateLights() {
    const el = $('lights');
    const showing = countdown > 0 && countdown <= 3.5 || (countdown <= 0 && raceTime < 0.7 && mode !== 'demo');
    el.hidden = !showing;
    if (!showing) return;
    const lit = countdown > 0 ? clamp(4 - Math.ceil(countdown), 0, 3) : 3;
    el.classList.toggle('go', countdown <= 0);
    [...el.children].forEach((b, i) => b.classList.toggle('red', countdown > 0 && i < lit));
  }

  function banner(text, sub = '') {
    const el = $('banner');
    el.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // Logs the first time a car reached each step up to `dist` (updates can skip a few).
  function reached(times, dist, t) {
    for (let d = dist; d > dist - 40 && !times.has(d); d--) times.set(d, t);
  }

  // Online: how far apart you are in seconds, from when the leader passed the trailer's spot.
  function gapText() {
    const rival = net && cars.find(c => c.remote);
    if (!rival || countdown > 0 || player.finished !== null || rival.finished !== null) return '';
    const [lead, trail, times] = player.dist >= rival.dist ? [player, rival, net.mine] : [rival, player, net.theirs];
    const passed = times.get(trail.dist);
    if (passed === undefined || lead.dist === trail.dist) return '';
    return `${lead === player ? 'Ahead' : 'Behind'} ${(raceTime - passed).toFixed(1)}s`;
  }

  // ---------- Starting, pausing and finishing races ----------

  function setView(v) {
    body.classList.toggle('in-menu', v === 'menu');
    body.classList.toggle('in-race', v === 'race');
    body.classList.toggle('in-edit', v === 'edit');
    $('hud').hidden = v !== 'race';
    $('pad').hidden = v !== 'race';
    $('help').hidden = v !== 'race';
    $('editor').hidden = v !== 'edit';
    if (v !== 'menu') screens.innerHTML = '';
  }

  function startDemo() {
    const options = D.ALL_TRACKS.filter(t => t !== track);
    level = D.LEVELS[2];
    setupRace(Arcade.pick(options), { mode: 'demo', laps: 99, level });
    demoT = 40;
  }

  function startRace(s) {
    setup = s;
    raceOnline = false;
    for (const k in keys) keys[k] = false;
    touchGas = lastTouch;
    setupRace(s.track, s);
    if (AUTOPILOT) player.ai = true;
    state = 'playing';
    ui.hide();
    setView('race');
    S.stopMusic();
    S.startCar();
    updateHud();
  }

  function restart() {
    if (setup && !online()) startRace(setup);
  }

  function pause() {
    if (state !== 'playing' || online() || finishT !== null) return;
    state = 'paused';
    S.stopCar();
    ui.show({
      title: 'Paused',
      html: `<p>${esc(track.name)} · lap ${Math.min(laps, player.lap + 1)}/${laps}</p>
        <div class="menu"><div class="row"><button class="btn secondary" type="button" data-restart>Restart</button><button class="btn secondary" type="button" data-quit>Quit</button></div></div>
        <div class="settings" style="justify-content:center">${camChips()}</div>`,
      button: 'Resume',
      onAction: resume,
      onRender: panel => {
        panel.querySelector('[data-restart]').addEventListener('click', restart);
        panel.querySelector('[data-quit]').addEventListener('click', () => toMenu());
        wireCamChips(panel);
      },
    });
  }

  function resume() {
    state = 'playing';
    ui.hide();
    S.startCar();
  }

  // Leaves whatever is going on and goes back to the menus, with the demo race behind them.
  function toMenu(view = returnView, error = '') {
    if (net) {
      net.conn.send('quit');
      net.conn.close();
      net = null;
    }
    raceOnline = false;
    S.stopCar();
    state = 'menu';
    ui.hide();
    startDemo();
    go(view);
    if (error) Arcade.toast('Pocket Racer', error);
  }

  // Coins, stars and records shared by every finished race. Returns notes for the results panel.
  function settleRecords(time) {
    const notes = [];
    if (track.custom) return { notes, coins: 0, newLap: false };
    let bonus = 0;
    const lapRec = Arcade.load(lapKey(track.id), null);
    const newLap = isFinite(bestLap) && (!lapRec || bestLap < lapRec);
    if (newLap) {
      Arcade.save(lapKey(track.id), bestLap);
      notes.push(`New lap record: ${fmt(bestLap)}`);
      bonus += 15;
      if (posting()) {
        const me = Arcade.profile();
        Online.put(`scores/${lapBoard(track.id)}/${me.id}`, { name: me.name, score: toScore(bestLap), t: Online.TIMESTAMP }).catch(() => {});
      }
    }
    if (time != null) {
      const key = timeKey(track.id, laps);
      const prev = Arcade.load(key, null);
      if (!prev || time < prev) {
        Arcade.save(key, time);
        if (prev) notes.push(`Best ${laps}-lap time: ${fmt(time)}`);
      }
      saveGhost(time);
    }
    return { notes, coins: bonus, newLap };
  }

  const unlockedIds = () => D.SKINS.filter(skinUnlocked).map(s => s.id);

  function finishRace() {
    state = 'over';
    const place = position(player);
    const time = player.finished;
    const title = place === 1 ? '1st place!' : `${ordinal(place)} place`;
    const before = unlockedIds();
    const rec = settleRecords(time);

    // Career stars: 1 for a podium, 2 for a win, 3 for a win inside the target time.
    let stars = 0, par = 0;
    if (event) {
      par = parTime(event);
      stars = place === 1 ? (time <= par ? 3 : 2) : place <= 3 ? 1 : 0;
      const map = starsMap();
      if (stars > (map[event.id] || 0)) {
        const was = totalStars();
        map[event.id] = stars;
        Arcade.save('racer:stars', map);
        if (posting() && totalStars() > was) {
          const me = Arcade.profile();
          Online.put(`scores/pocket-racer-stars/${me.id}`, { name: me.name, score: totalStars(), t: Online.TIMESTAMP }).catch(() => {});
        }
      }
    }
    const mult = event ? event.cup.reward : level.points;
    const earned = track.custom ? 0 : Math.round(D.PLACE_COINS[place - 1] * mult) + rec.coins;
    addCoins(earned);
    const fresh = unlockedIds().filter(id => !before.includes(id)).map(id => D.SKINS.find(s => s.id === id));
    if (fresh.length) setTimeout(() => S.sfx.unlock(), 900);
    else if (earned) setTimeout(() => S.sfx.coin(), 700);

    const order = [...cars].sort((a, b) => position(a) - position(b));
    const table = `<ol class="results">${order.map((c, i) => `<li class="${c === player ? 'me' : ''}"><span class="n">${i + 1}</span><i style="background:${c.skin.paint}"></i><span>${esc(c.name)}</span><span class="t">${c.finished !== null ? fmt(c.finished) : 'racing'}</span></li>`).join('')}</ol>`;
    const starHtml = event ? `<div class="big-stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('')}</div><p class="muted-note">Target ${fmt(par)} · ${stars ? 'best ' + starsOf(event.id) + '★' : 'finish on the podium to unlock the next race'}</p>` : '';
    const extras = `${starHtml}${table}
      ${earned ? `<div class="reward"><span><span class="coin">●</span> +${earned}</span></div>` : ''}
      ${rec.notes.map(n => `<p class="new-best">${esc(n)}</p>`).join('')}
      ${fresh.map(s => `<p class="unlock-note">New car unlocked: ${esc(s.name)}</p>`).join('')}`;
    const summary = `${esc(track.name)} · ${fmt(time)} · best lap ${fmt(bestLap)}`;

    const next = event && D.EVENTS[D.EVENTS.indexOf(event) + 1];
    const nextOpen = next && eventOpen(next);
    const actionLabel = event ? (nextOpen && next.cup === event.cup ? 'Next race' : 'Career') : 'Race again';
    const action = () => {
      if (event && nextOpen && next.cup === event.cup) startEvent(next);
      else if (event) toMenu('career');
      else restart();
    };

    // Anyone can build an easy track, so custom races don't score or count toward achievements.
    if (track.custom) {
      Arcade.countPlay();
      ui.show({
        title,
        html: `<p class="big">${fmt(time)}</p>${table}<p class="muted-note">Races on your own tracks don't earn coins or records.</p>`,
        button: 'Race again', onAction: restart, delay: 600,
        onRender: panel => addExtraActions(panel, false),
      });
      return;
    }

    const arcadePar = (trackLen * laps) / PAR_SPEED;
    const score = AUTOPILOT ? 0 : Math.round(PLACE_POINTS[place - 1] * level.points * laps / 3) + Math.round(Math.max(0, arcadePar / time - 1) * 4000);
    if (place === 1) Arcade.flag('pocket-racer-win');
    Arcade.finish(ui, {
      score, title,
      lines: [summary, `<span class="muted-note">Arcade score · ${level.name} rivals · press R to retry</span>`],
      html: extras,
      button: actionLabel,
      onAction: action,
    });
    addExtraActions($('overlay').querySelector('.panel'), true);
  }

  function addExtraActions(panel, retry) {
    if (!panel) return;
    panel.insertAdjacentHTML('beforeend', `<div class="extra-actions">${retry ? '<button class="btn secondary" type="button" data-retry>Retry</button>' : ''}<button class="btn secondary" type="button" data-menu>Menu</button></div>`);
    panel.querySelector('[data-retry]')?.addEventListener('click', restart);
    panel.querySelector('[data-menu]').addEventListener('click', () => toMenu());
  }

  // Time trial: just you and the ghost. Your best lap goes on the track's world leaderboard.
  function finishTrial() {
    state = 'over';
    const time = player.finished;
    const rec = settleRecords(time);
    const earned = track.custom ? 0 : 15 + rec.coins;
    addCoins(earned);
    if (earned) setTimeout(() => S.sfx.coin(), 600);
    Arcade.countPlay();
    const board = !track.custom && posting();
    // Racing a friend's ghost: did we beat it?
    let vsFriend = '';
    if (ghost?.friend) {
      const gap = Math.abs(ghost.time - time).toFixed(2);
      if (time < ghost.time) {
        vsFriend = `<p><b style="color:#3ddc84">You beat ${esc(ghost.name)}'s ghost by ${gap}s!</b></p>`;
        Arcade.flag('pocket-racer-ghostbuster');
      } else vsFriend = `<p>${esc(ghost.name)}'s ghost was ${gap}s faster.</p>`;
    }
    ui.show({
      title: ghost?.friend && time < ghost.time ? 'Ghost beaten!' : rec.newLap ? 'New lap record!' : 'Time trial',
      html: `<p class="big">${fmt(bestLap)}</p><p>Best lap · ${esc(track.name)}</p><p>Race ${fmt(time)} · record ${fmt(Arcade.load(lapKey(track.id), null))}</p>${vsFriend}
        ${earned ? `<div class="reward"><span><span class="coin">●</span> +${earned}</span></div>` : ''}
        ${track.custom ? '<p class="muted-note">Your own tracks keep records on this device only.</p>' : ''}
        ${board ? '<div class="board" data-board><p class="board-note">Loading the track leaderboard…</p></div>' : ''}`,
      button: 'Go again',
      onAction: restart,
      delay: 600,
      onRender: panel => addExtraActions(panel, false),
    });
    if (board) {
      const id = track.id;
      // Give our own new record a moment to land before reading the board back.
      setTimeout(() => lapTop(id, 5).then(list => {
        const slot = document.querySelector('[data-board]');
        if (slot) slot.innerHTML = renderTimes(list, 'Fastest laps worldwide');
      }).catch(() => {
        const slot = document.querySelector('[data-board]');
        if (slot) slot.innerHTML = '<p class="board-note">Couldn\'t reach the leaderboard.</p>';
      }), rec.newLap ? 700 : 0);
    }
  }

  const lapTop = (id, n = 10) => Online.top(lapBoard(id), n).then(list => list.map(r => ({ ...r, time: fromScore(r.score) })));

  function renderTimes(list, title) {
    const me = Arcade.profile().id;
    if (!list.length) return `<p class="board-title">${title}</p><p class="board-note">No times yet. Set the first!</p>`;
    return `<p class="board-title">${title}</p><ol class="board-list">${list.map((r, i) => `<li class="${r.id === me ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="name">${esc(typeof Friends === 'undefined' ? r.name : Friends.display(r.id, r.name))}</span><b>${r.time != null ? fmt(r.time) : Number(r.score).toLocaleString()}</b></li>`).join('')}</ol>`;
  }

  // ---------- Online races ----------

  // Each player drives their own car and streams where it is; the other car is drawn from that.
  // Updates arrive a beat late, so aim at where they'll be by now (along their heading at their
  // speed) rather than where they were, or the other car always trails a little behind.
  function followRemote(car, dt) {
    const t = net?.target;
    if (!t) return;
    const ahead = t.f == null ? Math.min(0.25, (performance.now() - net.targetAt) / 1000 + net.lag) * (t.v || 0) : 0;
    const k = Math.min(1, dt * 12);
    const px = car.x, py = car.y;
    car.x += (t.x + Math.cos(t.a) * ahead - car.x) * k;
    car.y += (t.y + Math.sin(t.a) * ahead - car.y) * k;
    const turn = angleDiff(t.a, car.a) * k;
    car.a += turn;
    car.v = t.v || 0;
    car.steer = clamp(turn / Math.max(dt, 1e-3) / TURN, -1, 1);
    car.slide = clamp(Math.abs(car.steer) * (car.v - 150) / 130, 0, 1);
    car.offTrack = nearest(car.x, car.y, car.idx).d > TRACK_W / 2 + 4;
    car.idx = nearest(car.x, car.y, car.idx).i;
    car.braking = Math.hypot(car.x - px, car.y - py) / Math.max(dt, 1e-3) < (car.lastSpeed || 0) - 5;
    car.lastSpeed = Math.hypot(car.x - px, car.y - py) / Math.max(dt, 1e-3);
    reached(net.theirs, t.d, raceTime - net.lag);
    car.dist = t.d;
    car.lap = Math.floor(t.d / N);
    if (t.f !== null && t.f !== undefined) car.finished = t.f;
  }

  function finishOnline() {
    state = 'online-over';
    const time = player.finished;
    const rival = cars.find(c => c.remote);
    let won = !rival || rival.finished === null || time <= rival.finished;
    settleRecords(time);
    Arcade.countPlay();
    if (net) {
      Arcade.flag('online-match');
      Relay.result(won ? 'w' : 'l');
      net.wins[won ? 0 : 1]++;
      addCoins(won ? 50 : 20);
    }
    if (won && net) Arcade.flag('pocket-racer-win');
    const them = net ? esc(net.names[1]) : 'Your opponent';
    const tally = () => net ? `Match score: you ${net.wins[0]} – ${net.wins[1]} ${net.names[1]}` : '';
    const r = cars.find(c => c.remote);
    const theirTime = r && r.finished !== null ? `${them} ${fmt(r.finished)}` : net ? `${them} is still racing…` : `${them} left`;
    ui.show({
      title: won ? 'You win the race!' : `${them} wins`,
      html: `<p class="big">${fmt(time)}</p><p>${esc(track.name)} · best lap ${fmt(bestLap)}</p><p data-them>${theirTime}</p>
        ${net ? `<div class="reward"><span><span class="coin">●</span> +${won ? 50 : 20}</span></div>` : ''}
        <p class="muted-note" data-tally>${esc(tally())}</p>
        ${net ? '<div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div><p class="muted-note" data-wait>A rematch starts when you both press it.</p>' : ''}`,
      button: net ? 'Rematch' : 'Back to menu',
      delay: 600,
      onAction: () => {
        if (!net) return toMenu('online');
        net.want.me = true;
        net.conn.send('rematch');
        document.querySelector('[data-wait]').textContent = 'Waiting for your opponent…';
        maybeRematch();
      },
      onRender: panel => panel.querySelector('[data-leave]')?.addEventListener('click', () => leaveOnline()),
    });
    // Fill in their time when they cross the line. If they actually got there first (their
    // finish was still on its way when ours landed), the result flips.
    const poll = setInterval(() => {
      const rr = cars.find(c => c.remote);
      const slot = document.querySelector('[data-them]');
      if (state !== 'online-over' || !slot) return clearInterval(poll);
      if (rr && rr.finished !== null) {
        slot.textContent = `${net ? net.names[1] : 'Opponent'} ${fmt(rr.finished)}`;
        if (won && rr.finished < time) {
          won = false;
          if (net) {
            net.wins[0]--;
            net.wins[1]++;
          }
          $('overlay').querySelector('h2').textContent = `${net ? net.names[1] : 'Your opponent'} wins`;
          document.querySelector('[data-tally]').textContent = tally();
        }
        clearInterval(poll);
      }
    }, 250);
  }

  let onlineTrack = D.trackById(Arcade.load('racer:onlineTrack', 'harbor')) || D.TRACKS[0];

  async function goOnline(how, code) {
    let cancelled = false;
    const cancel = () => { cancelled = true; leaveOnline(); };
    ui.show({ title: 'Connecting…', html: Relay.CONNECTING, button: 'Cancel', onAction: cancel, onRender: Relay.ticker });
    const handlers = {
      ready: () => {
        if (cancelled || !net) return;
        net.conn.send('hello', { name: Arcade.profile().name, skin: mySkin().id });
        if (net.host) measureLag();
      },
      event: onNet,
      state: s => {
        if (!net) return;
        net.target = s;
        net.targetAt = performance.now();
      },
      left: opponentGone,
      closed: () => { if (net) opponentGone(); },
    };
    try {
      const res = how === 'quick' ? await Relay.quickMatch('racer', handlers, `Race · ${onlineTrack.name}`)
        : how === 'create' ? await Relay.createRoom('racer', handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom('racer', code, handlers);
      if (cancelled) { res.conn.close(); return; }
      net = { conn: res.conn, host: res.slot === 1, names: [Arcade.profile().name, 'Opponent'], skin: 'cherry', want: { me: false, them: false }, sendT: 0, target: null, targetAt: 0, lag: 0, wins: [0, 0] };
      if (net.host) {
        ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: (how === 'create'
            ? `<p>Share this code. The race starts as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick race.</p>') + `<p class="muted-note">Track: ${esc(onlineTrack.name)}</p>`,
          button: 'Cancel',
          onAction: cancel,
        });
      } else {
        ui.show({ title: 'Opponent found', html: '<p>Starting…</p>', button: null });
      }
    } catch (e) {
      if (!cancelled) toMenu('online', e.message);
    }
  }

  // Before the first race the host times a round trip. The race message takes about half of it
  // to arrive, so the host's countdown runs that much longer and both lights go green together.
  // An opponent on an older version never answers; after 2s the race just starts.
  function measureLag() {
    const sent = performance.now();
    const go = () => {
      if (!net || net.pong !== go) return;
      net.pong = null;
      startOnline();
    };
    net.pong = go;
    net.pingAt = sent;
    net.conn.send('ping');
    setTimeout(go, 2000);
  }

  // The host picks the track (whatever was chosen on their Online screen) and both grids start together.
  function startOnline() {
    net.want = { me: false, them: false };
    net.conn.send('race', { track: onlineTrack.id, lag: net.lag });
    beginOnline(onlineTrack, net.lag);
  }

  function beginOnline(t, lead = 0) {
    net.target = null;
    net.sentFinish = false;
    raceOnline = true;
    for (const k in keys) keys[k] = false;
    touchGas = lastTouch;
    setup = null;
    setupRace(t, { mode: 'online', laps: 3, level: D.LEVELS[1], vs: net, lead });
    state = 'playing';
    ui.hide();
    setView('race');
    S.stopMusic();
    S.startCar();
    updateHud();
  }

  function onNet(name, data) {
    if (!net) return;
    if (name === 'hello') {
      net.names[1] = String(data?.name || 'Opponent').slice(0, 24);
      if (D.SKINS.some(s => s.id === data?.skin)) net.skin = data.skin;
    } else if (name === 'race' && !net.host) {
      net.lag = clamp(Number(data.lag) || 0, 0, 1);
      beginOnline(D.trackById(data.track) || D.TRACKS[0]);
    } else if (name === 'ping') net.conn.send('pong');
    else if (name === 'pong' && net.pong) {
      net.lag = Math.min(1, (performance.now() - net.pingAt) / 2000);
      net.pong();
    } else if (name === 'rematch') {
      net.want.them = true;
      maybeRematch();
    } else if (name === 'quit') opponentGone();
  }

  function maybeRematch() {
    if (net?.host && net.want.me && net.want.them) startOnline();
  }

  // Mid-race you finish on your own; anywhere else it's back to the menu.
  function opponentGone() {
    if (!net) return;
    const name = net.names[1];
    net.conn.close();
    net = null;
    if (state === 'playing') {
      cars = cars.filter(c => !c.remote);
      Arcade.toast('Race', `${name} left. Finish for the win!`);
    } else if (state === 'online-over') {
      const slot = document.querySelector('[data-them]');
      if (slot) slot.textContent = `${name} left`;
      document.querySelector('[data-wait]')?.remove();
      document.querySelector('[data-leave]')?.remove();
      document.querySelector('[data-main]').textContent = 'Back to menu';
    } else {
      toMenu('online', `${name} left.`);
    }
  }

  function leaveOnline() {
    if (net) {
      net.conn.send('quit');
      net.conn.close();
      net = null;
    }
    toMenu('online');
  }
  window.addEventListener('pagehide', () => net?.conn.send('quit'));

  // ---------- Menus ----------

  let returnView = 'home';
  let spinners = [];
  let quickPick = { trackId: Arcade.load('racer:track', 'harbor'), laps: Arcade.load('racer:laps', 3) };
  let menuLevel = D.LEVELS.find(l => l.id === Arcade.load('racer:level', 'pro')) || D.LEVELS[1];
  let garagePick = null;
  let recordsPick = 'harbor', recordsTab = 'track';

  const head = (title, sub = '') => `<div class="screen-head"><button class="back-btn" type="button" data-go="home" aria-label="Back">←</button><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div></div>`;

  function go(view, arg) {
    if (state !== 'menu') return;
    returnView = ['home', 'career', 'quick', 'trial', 'online', 'garage', 'records', 'builder'].includes(view) ? view : 'home';
    setView('menu');
    spinners = [];
    const views = { home, career, quick: () => quick('race'), trial: () => quick('trial'), online: onlineView, garage, records, builder };
    const v = (views[view] || home)(arg);
    screens.innerHTML = `<section class="screen">${v.html}</section>`;
    screens.scrollTop = 0;
    screens.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { S.sfx.back(); go(b.dataset.go); }));
    screens.querySelectorAll('canvas[data-thumb]').forEach(c => drawThumb(c, findTrack(c.dataset.thumb)));
    v.wire?.(screens);
    document.querySelectorAll('#nav [data-go]').forEach(b => b.toggleAttribute('aria-current', false));
    const navId = view === 'trial' ? 'quick' : view;
    document.querySelector(`#nav [data-go="${navId}"]`)?.setAttribute('aria-current', 'page');
    updateWallet();
    S.startMusic();
  }
  document.querySelectorAll('#nav [data-go]').forEach(b => b.addEventListener('click', () => {
    if (state !== 'menu') return;
    S.sfx.select();
    go(b.dataset.go);
  }));

  function drawThumb(cv, t) {
    if (!t) return;
    cv.width = 320;
    cv.height = 224;
    const c = cv.getContext('2d');
    const th = D.themeOf(t);
    const g = c.createLinearGradient(0, 0, 320, 224);
    g.addColorStop(0, th.grass);
    g.addColorStop(1, th.grass2);
    c.fillStyle = g;
    c.fillRect(0, 0, 320, 224);
    const p = pathOf(t).path;
    A.trackThumb(c, p, 320, 224, { color: th.night ? '#c9d2ff' : '#f2f2f2', width: 13, pad: 18 });
    A.trackThumb(c, p, 320, 224, { color: th.night ? '#2c3040' : '#3c4049', width: 9, pad: 18 });
  }

  // A slowly turning car on a canvas, for the home screen and the garage.
  function spinner(cv, getSkin, { speed = 0.6, zoom = 1 } = {}) {
    return now => {
      const r = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth * r, h = cv.clientHeight * r;
      if (!w || !h) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, w, h);
      const s = Math.min(w / 46, h / 30) * zoom;
      c.setTransform(s, 0, 0, s * 0.82, w / 2, h / 2); // squashed a little, like looking across a turntable
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.beginPath();
      c.ellipse(0, 3, 20, 13, 0, 0, Math.PI * 2);
      c.fill();
      const a = now / 1000 * speed;
      A.drawCar(c, getSkin(), 0, 0, a, { steer: Math.sin(now / 900) * 0.6 });
    };
  }

  function staticCar(cv, skin) {
    const r = 2;
    cv.width = 100 * r;
    cv.height = 60 * r;
    const c = cv.getContext('2d');
    c.setTransform(3.2 * r, 0, 0, 3.2 * r, 50 * r, 30 * r);
    A.drawCar(c, skin, 0, 0, -0.35, { steer: 0.3 });
  }

  const camChips = () => ['auto', 'follow', 'full'].map(m => `<button class="chip" type="button" data-cam="${m}" aria-pressed="${camMode === m}">Camera: ${m === 'auto' ? 'Auto' : m === 'follow' ? 'Follow' : 'Whole track'}</button>`).join('');
  function wireCamChips(el) {
    el.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => {
      setCamMode(b.dataset.cam);
      el.querySelectorAll('[data-cam]').forEach(x => x.setAttribute('aria-pressed', x.dataset.cam === camMode));
    }));
  }

  function home() {
    const skin = mySkin();
    const doneEvents = D.EVENTS.filter(e => starsOf(e.id) > 0).length;
    const tile = (go, ico, title, sub, color, extra = '') => `<button class="tile ${extra}" type="button" data-go="${go}" style="--c:${color}"><span class="ico">${ico}</span><b>${title}</b><small>${sub}</small></button>`;
    return {
      html: `<div class="home">
        <div class="card hero">
          <h2 class="hero-logo">POCKET<span>RACER</span></h2>
          <p class="tag">Top-down racing. Six cups, ${D.ALL_TRACKS.length} tracks, ${D.SKINS.length} cars.</p>
          <div class="hero-car"><canvas id="hero-car"></canvas><span class="plate">${esc(skin.name)} · #${skin.num}</span></div>
          <div class="hero-actions"><button class="big-btn" type="button" data-go="career" style="flex:1">${doneEvents ? 'Continue career' : 'Start career'}</button></div>
        </div>
        <div>
          <div class="tiles">
            ${tile('quick', '🏁', 'Quick race', 'Any track, three rivals', '#ff4d5e')}
            ${tile('trial', '⏱️', 'Time trial', 'Chase the world or a friend', '#4f8cff')}
            ${tile('online', '🌐', 'Online', Relay.enabled ? 'Race a real player' : 'Not set up here', '#3ddc84')}
            ${tile('garage', '🚗', 'Garage', `${D.SKINS.filter(skinUnlocked).length}/${D.SKINS.length} cars`, '#c77dff')}
            ${tile('records', '🏆', 'Records', 'World leaderboards', '#ffc53d')}
            ${tile('builder', '🛠️', 'Track builder', `${customTracks().length} of your own`, '#ff8a1f')}
            ${tile('career', '⭐', 'Career', `${totalStars()}/${D.EVENTS.length * 3} stars · ${doneEvents}/${D.EVENTS.length} races`, '#ffc53d', 'wide')}
          </div>
          <div class="settings">${camChips()}<button class="chip" type="button" data-music aria-pressed="${S.musicOn()}">Music: ${S.musicOn() ? 'On' : 'Off'}</button></div>
        </div>
      </div>`,
      wire: el => {
        spinners.push(spinner(el.querySelector('#hero-car'), mySkin, { speed: 0.5, zoom: 0.9 }));
        wireCamChips(el);
        el.querySelector('[data-music]').addEventListener('click', e => {
          S.setMusic(!S.musicOn());
          e.target.setAttribute('aria-pressed', S.musicOn());
          e.target.textContent = `Music: ${S.musicOn() ? 'On' : 'Off'}`;
        });
        el.querySelector('[data-go="online"]').disabled = !Relay.enabled;
      },
    };
  }

  function career() {
    const cups = D.CUPS.map((cup, ci) => {
      const open = cupOpen(ci);
      const evs = D.EVENTS.filter(e => e.cup === cup);
      const got = evs.reduce((n, e) => n + starsOf(e.id), 0);
      const prize = D.SKINS.find(s => s.unlock.cup === cup.id);
      const cards = evs.map(e => {
        const t = D.trackById(e.track), ok = eventOpen(e), st = starsOf(e.id);
        return `<button class="track-card event ${ok ? '' : 'locked'}" type="button" data-event="${e.id}" ${ok ? '' : 'disabled'}>
          <canvas data-thumb="${t.id}"></canvas>${ok ? '' : '<span class="lock">🔒</span>'}
          <span class="badge">${e.index + 1}</span>
          <span class="meta"><b>${esc(t.name)}</b><span class="stars-row">${[0, 1, 2].map(i => `<span class="${i < st ? 'on' : ''}">★</span>`).join('')}</span></span>
        </button>`;
      }).join('');
      return `<div class="card cup ${open ? '' : 'locked'}" style="--c:${cup.color}">
        <div class="cup-head"><span class="trophy">🏆</span><div><h3>${cup.name}</h3><p>${cup.laps} laps · ${D.LEVELS.find(l => l.id === cup.level).name} rivals · ${open ? `prize: ${esc(prize.name)} car` : `finish the ${D.CUPS[ci - 1].name} to open`}</p></div><span class="stars-count">★ ${got}/${evs.length * 3}</span></div>
        <div class="events">${cards}</div>
        <div class="progress"><i style="width:${(got / (evs.length * 3)) * 100}%"></i></div>
      </div>`;
    }).join('');
    return {
      html: `${head('Career', 'Finish on the podium to unlock the next race. Win under the target time for three stars.')}<div class="cups">${cups}</div>`,
      wire: el => el.querySelectorAll('[data-event]').forEach(b => b.addEventListener('click', () => {
        S.sfx.select();
        showEvent(D.EVENTS.find(e => e.id === b.dataset.event));
      })),
    };
  }

  function showEvent(ev) {
    const t = D.trackById(ev.track);
    const par = parTime(ev);
    const st = starsOf(ev.id);
    ui.show({
      title: `${ev.cup.name} · Race ${ev.index + 1}`,
      html: `<p class="big" style="font-size:24px">${esc(t.name)}</p>
        <div class="big-stars" style="font-size:26px">${[0, 1, 2].map(i => `<span class="${i < st ? 'on' : ''}">★</span>`).join('')}</div>
        <p>${ev.laps} laps · ${D.LEVELS.find(l => l.id === ev.level).name} rivals</p>
        <p class="muted-note">★ podium · ★★ win · ★★★ win in under ${fmt(par)}</p>
        <div class="menu"><button class="btn secondary" type="button" data-cancel>Back</button></div>`,
      button: 'Race!',
      onAction: () => startEvent(ev),
      onRender: panel => panel.querySelector('[data-cancel]').addEventListener('click', () => ui.hide()),
    });
  }

  function startEvent(ev) {
    startRace({ mode: 'career', track: D.trackById(ev.track), laps: ev.laps, level: D.LEVELS.find(l => l.id === ev.level), event: ev });
  }

  function trackCard(t, selectedId) {
    const lap = Arcade.load(lapKey(t.id), null);
    return `<button class="track-card" type="button" data-track="${esc(t.id)}" aria-pressed="${t.id === selectedId}">
      <canvas data-thumb="${esc(t.id)}"></canvas>
      ${t.reverse ? '<span class="badge">Reverse</span>' : t.custom ? '<span class="badge">Yours</span>' : ''}
      <span class="meta"><b>${esc(t.name)}</b><small>${D.themeOf(t).name}${lap ? ` · lap ${lap.toFixed(2)}s` : ''}</small></span>
    </button>`;
  }

  function quick(kind) {
    const all = [...D.ALL_TRACKS, ...customTracks()];
    if (!all.some(t => t.id === quickPick.trackId)) quickPick.trackId = 'harbor';
    const trial = kind === 'trial';
    const levels = D.LEVELS.map(l => `<button class="chip" type="button" data-level="${l.id}" aria-pressed="${l === menuLevel}">${l.name}</button>`).join('');
    const lapsChips = [1, 2, 3, 5].map(n => `<button class="chip" type="button" data-laps="${n}" aria-pressed="${n === quickPick.laps}">${n} lap${n > 1 ? 's' : ''}</button>`).join('');
    return {
      html: `${head(trial ? 'Time trial' : 'Quick race', trial ? 'Three laps against a ghost: the world record, your own best, or a friend\'s best race. Your best lap goes on the track\'s leaderboard.' : 'Pick a track and race three rivals.')}
        <div class="track-grid">${all.map(t => trackCard(t, quickPick.trackId)).join('')}</div>
        <div class="race-setup">
          ${trial ? `<div class="setup-row"><label>Ghost</label><div class="filters" data-ghosts>${ghostChips()}</div></div>` : `<div class="setup-row"><label>Rivals</label><div class="filters">${levels}</div><label>Laps</label><div class="filters">${lapsChips}</div></div>`}
          <button class="big-btn" type="button" data-start>${trial ? 'Start time trial' : 'Start race'}</button>
        </div>`,
      wire: el => {
        el.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => {
          S.sfx.tick();
          quickPick.trackId = b.dataset.track;
          Arcade.save('racer:track', quickPick.trackId);
          el.querySelectorAll('[data-track]').forEach(x => x.setAttribute('aria-pressed', x === b));
          if (trial) wireGhosts(el);
        }));
        if (trial) wireGhosts(el);
        el.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => {
          menuLevel = D.LEVELS.find(l => l.id === b.dataset.level);
          Arcade.save('racer:level', menuLevel.id);
          el.querySelectorAll('[data-level]').forEach(x => x.setAttribute('aria-pressed', x === b));
        }));
        el.querySelectorAll('[data-laps]').forEach(b => b.addEventListener('click', () => {
          quickPick.laps = +b.dataset.laps;
          Arcade.save('racer:laps', quickPick.laps);
          el.querySelectorAll('[data-laps]').forEach(x => x.setAttribute('aria-pressed', x === b));
        }));
        el.querySelector('[data-start]').addEventListener('click', () => {
          const t = findTrack(quickPick.trackId) || D.TRACKS[0];
          startRace(trial ? { mode: 'trial', track: t, laps: 3, level: menuLevel } : { mode: 'quick', track: t, laps: quickPick.laps, level: menuLevel });
        });
      },
    };
  }

  // Ghost picker for time trials: world record, your best, and each friend, with their time on
  // the selected track filled in once it loads.
  function ghostChips() {
    const friends = typeof Friends !== 'undefined' ? Friends.all().slice(0, 16) : [];
    if (ghostPick !== 'world' && ghostPick !== 'mine' && !friends.some(f => f.id === ghostPick)) ghostPick = 'world';
    const chip = (id, label) => `<button class="chip" type="button" data-ghost="${esc(id)}" aria-pressed="${id === ghostPick}">${label}</button>`;
    return chip('world', 'World record <small data-gtime="world"></small>') + chip('mine', 'Your best <small data-gtime="mine"></small>') +
      friends.map(f => chip(f.id, `★ ${esc(Friends.short(f.id, f.name) || 'Friend')} <small data-gtime="${esc(f.id)}"></small>`)).join('') +
      (friends.length ? '' : '<span class="muted-note">Add friends to race their ghosts.</span>');
  }

  function wireGhosts(el) {
    const box = el.querySelector('[data-ghosts]');
    if (!box) return;
    box.innerHTML = ghostChips();
    box.querySelectorAll('[data-ghost]').forEach(b => b.addEventListener('click', () => {
      S.sfx.tick();
      ghostPick = b.dataset.ghost;
      Arcade.save('racer:ghostPick', ghostPick);
      box.querySelectorAll('[data-ghost]').forEach(x => x.setAttribute('aria-pressed', x === b));
    }));
    const t = findTrack(quickPick.trackId);
    const setTime = (id, v) => {
      const slot = box.querySelector(`[data-gtime="${CSS.escape(id)}"]`);
      if (slot) slot.textContent = v == null ? '· none' : `· ${v.toFixed(1)}s`;
    };
    setTime('mine', Arcade.load(ghostKey(quickPick.trackId, 3), null)?.time);
    if (!t || t.custom || !Online.enabled) return;
    const forId = t.id;
    const still = () => quickPick.trackId === forId;
    Online.get(`ghosts/${forId}/time`).then(v => still() && setTime('world', v)).catch(() => {});
    for (const f of Friends.all().slice(0, 16)) {
      Online.get(`${friendGhostPath(forId, f.id)}/time`).then(v => still() && setTime(f.id, v)).catch(() => {});
    }
  }

  function onlineView() {
    if (!Relay.enabled) return { html: `${head('Online')}<div class="card" style="padding:16px"><p>Online races aren't set up on this copy of the arcade.</p></div>` };
    return {
      html: `${head('Online', 'Race a real player, one on one. Three laps; the first across the line wins.')}
        <div class="online-grid">
          <div class="card"><p class="section-title" style="margin-top:0">Track (when you host)</p>
            <div class="track-grid">${D.ALL_TRACKS.map(t => trackCard(t, onlineTrack.id)).join('')}</div></div>
          <div class="card">
            <p class="section-title" style="margin-top:0">Play</p>
            <div class="menu">
              <button class="btn" type="button" data-net="quick">Quick race</button>
              <button class="btn secondary" type="button" data-net="create">Private room</button>
              <div class="row"><input class="field" id="code" maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code"><button class="btn secondary" type="button" data-net="join">Join</button></div>
            </div>
            <p class="muted-note">Your opponent sees your car: <b>${esc(mySkin().name)}</b>.</p>
            <div data-waiting></div>
          </div>
        </div>`,
      wire: el => {
        const code = el.querySelector('#code');
        el.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => goOnline(b.dataset.net, code.value)));
        code.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); goOnline('join', code.value); } });
        el.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => {
          onlineTrack = D.trackById(b.dataset.track);
          Arcade.save('racer:onlineTrack', onlineTrack.id);
          el.querySelectorAll('[data-track]').forEach(x => x.setAttribute('aria-pressed', x === b));
        }));
        Relay.showWaiting(el.querySelector('[data-waiting]'), room => goOnline('public', room));
      },
    };
  }

  function garage() {
    garagePick = garagePick || mySkin();
    const current = mySkin();
    const cards = D.SKINS.map(s => {
      const ok = skinUnlocked(s);
      return `<button class="skin ${ok ? '' : 'locked'}" type="button" data-skin="${s.id}" aria-pressed="${s === garagePick}">
        <canvas></canvas>${s === current ? '<span class="equipped">✓</span>' : ''}${esc(s.name)}<span class="tagline">${ok ? (s === current ? 'Driving' : 'Owned') : (s.unlock.coins ? '● ' + s.unlock.coins : s.unlock.stars ? '★ ' + s.unlock.stars : '🏆 Cup prize')}</span>
      </button>`;
    }).join('');
    return {
      html: `${head('Garage', 'Every car handles the same. Pick the one you like the look of.')}
        <div class="garage">
          <div class="card showroom"><h3 data-name></h3><span class="model" data-model></span><div class="spin"><canvas id="garage-car"></canvas></div><div class="buy" data-buy></div><p class="note" data-note></p></div>
          <div class="skins">${cards}</div>
        </div>`,
      wire: el => {
        D.SKINS.forEach((s, i) => staticCar(el.querySelectorAll('.skin canvas')[i], s));
        spinners.push(spinner(el.querySelector('#garage-car'), () => garagePick, { speed: 0.7 }));
        const show = () => {
          const s = garagePick, ok = skinUnlocked(s), driving = s === mySkin();
          el.querySelector('[data-name]').textContent = s.name;
          el.querySelector('[data-model]').textContent = `${s.model} · #${s.num} · ${s.pattern}`;
          const buy = el.querySelector('[data-buy]');
          if (ok) buy.innerHTML = `<button class="btn" type="button" data-equip ${driving ? 'disabled' : ''}>${driving ? 'Driving this car' : 'Drive this car'}</button>`;
          else if (s.unlock.coins) buy.innerHTML = `<button class="btn" type="button" data-purchase ${coins() >= s.unlock.coins ? '' : 'disabled'}>Buy for ● ${s.unlock.coins}</button>`;
          else buy.innerHTML = '<button class="btn secondary" type="button" disabled>Locked</button>';
          el.querySelector('[data-note]').textContent = ok ? '' : s.unlock.coins ? (coins() >= s.unlock.coins ? '' : `You have ${coins()} coins. Win races to earn more.`) : `Unlock: ${unlockText(s)}.`;
          buy.querySelector('[data-equip]')?.addEventListener('click', () => {
            Arcade.save('racer:skin', s.id);
            S.sfx.select();
            go('garage');
          });
          buy.querySelector('[data-purchase]')?.addEventListener('click', () => {
            if (coins() < s.unlock.coins) return;
            addCoins(-s.unlock.coins);
            Arcade.save('racer:skins', [...owned(), s.id]);
            Arcade.save('racer:skin', s.id);
            S.sfx.unlock();
            Arcade.toast('Garage', `${s.name} is yours!`);
            go('garage');
          });
        };
        el.querySelectorAll('[data-skin]').forEach(b => b.addEventListener('click', () => {
          garagePick = D.SKINS.find(s => s.id === b.dataset.skin);
          S.sfx.tick();
          el.querySelectorAll('[data-skin]').forEach(x => x.setAttribute('aria-pressed', x === b));
          show();
        }));
        show();
      },
    };
  }

  function records() {
    const rows = D.ALL_TRACKS.map(t => {
      const lap = Arcade.load(lapKey(t.id), null), race = Arcade.load(timeKey(t.id, 3), null);
      return `<button class="rec-row" type="button" data-rec="${t.id}" aria-pressed="${recordsTab === 'track' && t.id === recordsPick}">
        <canvas data-thumb="${t.id}"></canvas><span><b>${esc(t.name)}</b><small>3-lap race ${fmt(race)}</small></span><span class="t">${fmt(lap)}</span></button>`;
    }).join('');
    return {
      html: `${head('Records', 'Your best laps, and the fastest in the world.')}
        <div class="records">
          <div class="card rec-list">
            <div class="filters" style="padding:6px 6px 10px"><button class="chip" type="button" data-tab="stars" aria-pressed="${recordsTab === 'stars'}">Career stars</button><button class="chip" type="button" data-tab="arcade" aria-pressed="${recordsTab === 'arcade'}">Arcade score</button></div>
            ${rows}
          </div>
          <div class="card rec-board" data-board></div>
        </div>`,
      wire: el => {
        const board = el.querySelector('[data-board]');
        const load = () => {
          el.querySelectorAll('[data-rec]').forEach(x => x.setAttribute('aria-pressed', recordsTab === 'track' && x.dataset.rec === recordsPick));
          el.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-pressed', x.dataset.tab === recordsTab));
          const t = D.trackById(recordsPick);
          const title = recordsTab === 'track' ? esc(t.name) : recordsTab === 'stars' ? 'Career stars' : 'Arcade score';
          const mine = recordsTab === 'track' ? `Your best lap: ${fmt(Arcade.load(lapKey(t.id), null))}` : recordsTab === 'stars' ? `You have ${totalStars()} stars` : `Your best: ${Arcade.getBest('pocket-racer').toLocaleString()}`;
          board.innerHTML = `<h3>${title}</h3><p class="muted-note">${mine}</p><div data-list>${Online.enabled ? '<p class="board-note">Loading…</p>' : '<p class="board-note">World leaderboards aren\'t set up on this copy of the arcade.</p>'}</div>
            ${recordsTab === 'track' ? `<div class="menu" style="margin-top:12px"><button class="btn" type="button" data-trial>Time trial on this track</button></div>` : ''}`;
          board.querySelector('[data-trial]')?.addEventListener('click', () => startRace({ mode: 'trial', track: t, laps: 3, level: menuLevel }));
          if (!Online.enabled) return;
          const want = recordsTab + recordsPick;
          const fetch = recordsTab === 'track' ? lapTop(t.id, 10) : Online.top(recordsTab === 'stars' ? 'pocket-racer-stars' : 'pocket-racer', 10);
          fetch.then(list => {
            if (want !== recordsTab + recordsPick || !board.isConnected) return;
            board.querySelector('[data-list]').innerHTML = renderTimes(list, recordsTab === 'track' ? 'Fastest laps' : 'Top 10');
          }).catch(() => {
            if (board.isConnected) board.querySelector('[data-list]').innerHTML = '<p class="board-note">Couldn\'t reach the leaderboard.</p>';
          });
        };
        el.querySelectorAll('[data-rec]').forEach(b => b.addEventListener('click', () => {
          recordsTab = 'track';
          recordsPick = b.dataset.rec;
          S.sfx.tick();
          load();
        }));
        el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
          recordsTab = b.dataset.tab;
          S.sfx.tick();
          load();
        }));
        load();
      },
    };
  }

  function builder() {
    const mine = customTracks();
    const cards = mine.map(t => `<div class="track-card" style="cursor:default">
        <canvas data-thumb="${esc(t.id)}"></canvas>
        <span class="meta"><b>${esc(t.name)}</b><small>${D.themeOf(t).name}${Arcade.load(lapKey(t.id), null) ? ` · lap ${Arcade.load(lapKey(t.id), null).toFixed(2)}s` : ''}</small>
          <span class="filters" style="margin-top:8px"><button class="chip" type="button" data-race="${esc(t.id)}">Race</button><button class="chip" type="button" data-edit="${esc(t.id)}">Edit</button><button class="chip" type="button" data-del="${esc(t.id)}">Delete</button></span></span>
      </div>`).join('');
    return {
      html: `${head('Track builder', 'Tap to drop corners in driving order, drag to move them. The first corner is the start line.')}
        <div class="track-grid">
          <button class="tile" type="button" data-new style="min-height:180px;--c:#ff8a1f"><span class="ico">＋</span><b>New track</b><small>Up to 30 corners</small></button>
          ${cards}
        </div>
        ${mine.length ? '' : '<p class="muted-note" style="margin-top:14px">Tracks you build are saved on this device. Races on them don\'t earn coins or records.</p>'}`,
      wire: el => {
        el.querySelector('[data-new]').addEventListener('click', () => openEditor(null));
        el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditor(findTrack(b.dataset.edit))));
        el.querySelectorAll('[data-race]').forEach(b => b.addEventListener('click', () => startRace({ mode: 'quick', track: findTrack(b.dataset.race), laps: quickPick.laps, level: menuLevel })));
        el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
          const t = findTrack(b.dataset.del);
          if (!confirm(`Delete "${t.name}"?`)) return;
          Arcade.save('tracks', Arcade.load('tracks', []).filter(x => x.id !== t.id));
          forgetRecords(t.id);
          go('builder');
        }));
      },
    };
  }

  function forgetRecords(id) {
    for (const key of [lapKey(id), ...[1, 2, 3, 5].flatMap(n => [timeKey(id, n), ghostKey(id, n)])]) Arcade.save(key, null);
  }

  // ---------- Track editor ----------

  const editLayer = makeCanvas(W * LAYER_SCALE, H * LAYER_SCALE);

  // Corners are placed in driving order; a new one goes in right after the selected corner.
  function openEditor(t) {
    state = 'edit';
    const points = t ? t.points.map(p => [...p]) : [];
    edit = {
      id: t ? t.id : null,
      name: t ? t.name : `My Track ${customTracks().length + 1}`,
      theme: Math.max(0, D.THEMES.findIndex(th => th.id === (t && t.theme))),
      points, history: [], sel: points.length - 1, drag: -1, moved: false,
    };
    ui.hide();
    setView('edit');
    canvas.style.touchAction = 'none';
    snapCamera = true;
    refreshEditor();
  }

  function closeEditor() {
    edit = null;
    canvas.style.touchAction = '';
    state = 'menu';
    setView('menu');
    startDemo();
    go('builder');
  }

  // A quick drawing of the layout (the full scenery is built when you race it).
  function renderEditTrack(theme, p) {
    const c = editLayer.getContext('2d');
    c.setTransform(LAYER_SCALE, 0, 0, LAYER_SCALE, 0, 0);
    c.fillStyle = theme.grass;
    c.fillRect(0, 0, W, H);
    c.fillStyle = theme.grass2;
    for (let i = -H; i < W; i += 60) {
      c.beginPath();
      c.moveTo(i, 0); c.lineTo(i + 30, 0); c.lineTo(i + 30 + H, H); c.lineTo(i + H, H);
      c.fill();
    }
    if (!p) return;
    c.beginPath();
    p.forEach((pt, i) => (i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y)));
    c.closePath();
    c.lineJoin = 'round';
    c.strokeStyle = '#f2f2f2';
    c.lineWidth = TRACK_W + 6;
    c.stroke();
    c.strokeStyle = theme.night ? '#2c3040' : '#3c4049';
    c.lineWidth = TRACK_W;
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1.6;
    c.setLineDash([16, 18]);
    c.stroke();
    c.setLineDash([]);
  }

  function refreshEditor() {
    edit.check = checkTrack(edit.points);
    renderEditTrack(D.THEMES[edit.theme], edit.check.path);
    $('ed-undo').disabled = !edit.history.length;
    $('ed-delete').disabled = edit.sel < 0;
    $('ed-save').disabled = !edit.check.ok;
    $('ed-theme').textContent = `Theme: ${D.THEMES[edit.theme].name}`;
  }

  function remember() {
    edit.history.push(edit.points.map(p => [...p]));
    if (edit.history.length > 60) edit.history.shift();
  }

  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - (cw / 2 - cam.x * cam.z)) / cam.z;
    const y = (e.clientY - r.top - (ch / 2 - cam.y * cam.z)) / cam.z;
    return [clamp(x, 20, W - 20), clamp(y, 20, H - 20)];
  }

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'edit' || !$('overlay').hidden) return;
    e.preventDefault();
    const [x, y] = toWorld(e);
    const reach = Math.max(14, 18 / cam.z);
    let hit = -1, hitD = reach;
    edit.points.forEach((p, i) => {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < hitD) { hit = i; hitD = d; }
    });
    remember();
    if (hit >= 0) {
      edit.sel = edit.drag = hit;
      edit.moved = false;
      canvas.setPointerCapture(e.pointerId);
    } else if (edit.points.length < 30) {
      edit.points.splice(edit.sel + 1, 0, [Math.round(x), Math.round(y)]);
      edit.sel++;
      S.sfx.tick();
    } else {
      edit.history.pop();
    }
    refreshEditor();
  });
  canvas.addEventListener('pointermove', e => {
    if (!edit || edit.drag < 0) return;
    const [x, y] = toWorld(e);
    edit.points[edit.drag] = [Math.round(x), Math.round(y)];
    edit.moved = true;
    refreshEditor();
  });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => {
    if (!edit || edit.drag < 0) return;
    if (!edit.moved) edit.history.pop(); // just selecting a corner isn't worth an undo step
    edit.drag = -1;
    refreshEditor();
  });

  function deleteCorner() {
    if (edit.sel < 0) return;
    remember();
    edit.points.splice(edit.sel, 1);
    edit.sel = Math.min(edit.sel, edit.points.length) - 1;
    if (edit.sel < 0 && edit.points.length) edit.sel = edit.points.length - 1;
    refreshEditor();
  }

  function undo() {
    if (!edit.history.length) return;
    edit.points = edit.history.pop();
    edit.sel = Math.min(edit.sel, edit.points.length - 1);
    refreshEditor();
  }

  const tools = {
    'ed-undo': undo,
    'ed-delete': deleteCorner,
    'ed-reverse': () => {
      if (edit.points.length < 2) return;
      remember();
      // Keep the first corner as the start line, but drive the other way round.
      edit.points = [edit.points[0], ...edit.points.slice(1).reverse()];
      edit.sel = edit.sel > 0 ? edit.points.length - edit.sel : edit.sel;
      refreshEditor();
    },
    'ed-theme': () => {
      edit.theme = (edit.theme + 1) % D.THEMES.length;
      refreshEditor();
    },
    'ed-clear': () => {
      if (!edit.points.length) return;
      remember();
      edit.points = [];
      edit.sel = -1;
      refreshEditor();
    },
    'ed-save': () => { if (edit.check.ok) askName(); },
    'ed-exit': closeEditor,
  };
  for (const [id, fn] of Object.entries(tools)) {
    $(id).addEventListener('click', () => {
      $(id).blur();
      if (state === 'edit') fn();
    });
  }

  function askName(error = '') {
    ui.show({
      title: edit.id ? 'Save changes' : 'Name your track',
      html: `<div class="menu"><input class="field" id="track-name" maxlength="24" autocomplete="off" aria-label="Track name" value="${esc(edit.name)}"></div>
        <p class="error">${error}</p>
        ${edit.id ? '<p class="muted-note">Saving clears this track\'s best times and ghost, since the layout changed.</p>' : ''}`,
      button: 'Save track',
      onAction: saveTrack,
      onRender: panel => {
        const input = panel.querySelector('#track-name');
        input.focus();
        input.select();
        input.addEventListener('keydown', e => { if (e.key === 'Enter') saveTrack(); });
        panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-back>Keep editing</button></div>');
        panel.querySelector('[data-back]').addEventListener('click', () => {
          edit.name = input.value;
          ui.hide();
        });
      },
    });
  }

  function saveTrack() {
    const name = $('track-name').value.trim();
    if (!name) return askName('Give your track a name.');
    const stored = Arcade.load('tracks', []);
    const t = {
      id: edit.id || 'custom-' + Date.now().toString(36),
      name,
      theme: D.THEMES[edit.theme].id,
      points: edit.points.map(p => [Math.round(p[0]), Math.round(p[1])]),
    };
    const at = stored.findIndex(s => s.id === t.id);
    if (at >= 0) {
      stored[at] = t;
      forgetRecords(t.id);
    } else {
      stored.push(t);
    }
    Arcade.save('tracks', stored);
    ui.hide();
    closeEditor();
  }

  function drawEditor() {
    updateCamera(0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(worldMatrix());
    ctx.drawImage(editLayer, 0, 0, W, H);
    const { points, sel, check } = edit;

    // Driving direction, shown as chevrons along the road.
    if (check.path) {
      const p = check.path;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = Math.floor(p.length / 16); i < p.length; i += Math.max(1, Math.floor(p.length / 8))) {
        ctx.save();
        ctx.translate(p[i].x, p[i].y);
        ctx.rotate(p[i].a);
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, -8);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-6, 8);
        ctx.fill();
        ctx.restore();
      }
    }
    // Trouble spots, filled as one shape so overlapping marks don't stack up darker.
    ctx.fillStyle = 'rgba(255,60,60,0.4)';
    ctx.beginPath();
    for (const b of check.bad) {
      ctx.moveTo(b.x + 26, b.y);
      ctx.arc(b.x, b.y, 26, 0, Math.PI * 2);
    }
    ctx.fill();

    // Outline joining the corners, with the gap after the selected corner (where the next one goes) dashed.
    if (points.length > 1) {
      ctx.lineWidth = 1.5;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        ctx.strokeStyle = i === sel ? 'rgba(255,197,61,0.9)' : 'rgba(255,255,255,0.35)';
        ctx.setLineDash(i === sel ? [6, 6] : []);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    points.forEach((p, i) => {
      ctx.fillStyle = i === sel ? '#ffc53d' : '#fff';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p[0], p[1], i === 0 ? 11 : 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.fillText(i === 0 ? 'S' : i + 1, p[0], p[1] + 0.5);
    });

    // Status message, in screen space so it stays readable at any zoom.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const msg = check.ok ? `Looks good · ${Math.round(check.length)} px per lap · press Save to race it` : check.msg;
    ctx.font = '600 13px system-ui, sans-serif';
    const w = Math.min(cw - 16, ctx.measureText(msg).width + 24);
    ctx.fillStyle = 'rgba(14,16,20,0.85)';
    ctx.beginPath();
    ctx.roundRect(cw / 2 - w / 2, 10, w, 28, 8);
    ctx.fill();
    ctx.fillStyle = check.ok ? '#3ddc84' : '#fff';
    ctx.fillText(msg, cw / 2, 24.5, w - 12);
    ctx.textBaseline = 'alphabetic';
  }

  // ---------- Input ----------

  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  window.addEventListener('pointerdown', e => { lastTouch = e.pointerType === 'touch'; }, true);
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (state === 'edit') {
      if (!$('overlay').hidden) return;
      if (e.code === 'Delete' || e.code === 'Backspace') deleteCorner();
      if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (e.code === 'KeyC' && state !== 'menu') {
      const next = { auto: 'follow', follow: 'full', full: 'auto' }[camMode];
      setCamMode(next);
      Arcade.toast('Camera', next === 'auto' ? 'Auto' : next === 'follow' ? 'Follow your car' : 'Whole track');
      return;
    }
    // Instant restart on the same track, for speedrunners. Not in online races.
    if (e.code === 'KeyR' && !online() && setup && ['playing', 'paused', 'over'].includes(state)) {
      restart();
      return;
    }
    if (KEYMAP[e.code]) {
      keys[KEYMAP[e.code]] = true;
      lastTouch = false;
      if (KEYMAP[e.code] === 'up') touchGas = false;
      if (state === 'playing') e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });

  // On touch screens the car accelerates on its own; you steer and brake.
  document.querySelectorAll('#pad [data-key]').forEach(el => {
    const key = el.dataset.key;
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      touchGas = true;
      keys[key] = true;
      el.classList.add('on');
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => {
      keys[key] = false;
      el.classList.remove('on');
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
  });
  $('pause').addEventListener('click', () => (state === 'paused' ? resume() : pause()));

  Arcade.onBlur(() => {
    for (const k in keys) keys[k] = false;
    pause();
  });

  // ---------- Main loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'playing' || state === 'over' || state === 'online-over' || state === 'menu') update(dt);
    if (state === 'edit') drawEditor();
    else draw(dt);
    if (state === 'playing' && player && !player.remote) {
      S.updateCar({ speed: Math.abs(player.v) / TOP_SPEED, gas: player.gas, slide: player.slide, offTrack: player.offTrack });
    }
    for (const s of spinners) s(now);
    requestAnimationFrame(frame);
  }

  resize();
  updateWallet();
  startDemo();
  go('home');
  const invite = Relay.takeInvite();
  if (invite) goOnline('public', invite);
  requestAnimationFrame(frame);
})();
