(() => {
  const W = 800, H = 560, TRACK_W = 80, LAPS = 3, CAR_R = 13, STEP = 6;
  const TURN = 2.9;       // rad/s a car can turn once its tyres have full grip
  const GHOST_STEP = 0.1; // seconds between recorded ghost frames
  const SEND_EVERY = 1 / 15; // seconds between position updates in an online race
  const PAR_SPEED = 150;  // px/s; averaging faster than this earns a time bonus (Pro rivals average ~200)

  const THEMES = [
    { name: 'Meadow', grass: '#2d5f3a' },
    { name: 'Pines', grass: '#3a5a2c' },
    { name: 'Canyon', grass: '#8a6a45' },
    { name: 'Desert', grass: '#b8935a' },
    { name: 'Snow', grass: '#c3d3dd' },
    { name: 'Night', grass: '#1d2540' },
  ];

  // The first point of each track is the start line, so it sits on a straight.
  const TRACKS = [
    { id: 'harbor', name: 'Harbor Loop', grass: '#2d5f3a', points: [[400, 90], [680, 110], [720, 280], [680, 450], [520, 470], [440, 380], [360, 380], [280, 470], [120, 450], [80, 280], [120, 110]] },
    { id: 'pines', name: 'Pine Hills', grass: '#3a5a2c', points: [[240, 95], [330, 80], [480, 150], [650, 90], [730, 220], [640, 330], [700, 460], [500, 480], [380, 380], [250, 480], [100, 420], [90, 250], [150, 120]] },
    { id: 'canyon', name: 'Canyon Twist', grass: '#8a6a45', points: [[400, 80], [650, 90], [730, 200], [620, 280], [700, 400], [600, 480], [400, 470], [300, 360], [200, 470], [90, 400], [110, 200], [200, 100]] },
    { id: 'dunes', name: 'Dune Dash', grass: '#b8935a', points: [[300, 85], [560, 85], [700, 130], [720, 250], [640, 330], [700, 420], [620, 480], [430, 470], [330, 400], [210, 470], [90, 420], [100, 260], [170, 130]] },
    { id: 'frost', name: 'Frost Switchback', grass: '#c3d3dd', points: [[260, 85], [560, 85], [700, 110], [725, 230], [720, 420], [665, 480], [600, 430], [590, 270], [520, 210], [455, 270], [450, 420], [380, 485], [250, 480], [150, 470], [80, 380], [85, 200], [140, 110]] },
    { id: 'midnight', name: 'Midnight Circuit', grass: '#1d2540', points: [[420, 90], [640, 90], [720, 170], [650, 250], [720, 340], [700, 460], [560, 480], [500, 380], [400, 330], [300, 390], [260, 480], [110, 470], [80, 340], [200, 250], [95, 160], [190, 90]] },
  ];
  const RIVALS = [
    { color: '#4f8cff', pace: 1 },
    { color: '#3ddc84', pace: 0.97 },
    { color: '#c77dff', pace: 0.94 },
  ];
  // pace scales the rivals' racing-line speeds; wander is how far (px) they drift off the line.
  const LEVELS = [
    { id: 'rookie', name: 'Rookie', pace: 0.64, wander: 14, points: 0.6 },
    { id: 'pro', name: 'Pro', pace: 0.78, wander: 8, points: 1 },
    { id: 'ace', name: 'Ace', pace: 0.97, wander: 2, points: 1.5 },
  ];
  const PLACE_POINTS = [1000, 600, 400, 200];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const trackLayer = Arcade.makeLayer(W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  let state = 'menu';
  let track, path, N, trackLen, racing;
  let cars, player, raceTime, countdown, lapStart, bestLap, recorded, recordAcc, ghost;
  let level = LEVELS.find(l => l.id === Arcade.load('racer:level', 'pro')) || LEVELS[1];
  let selected = TRACKS[0];
  let edit = null;
  let net = null;   // online race: { conn, host, names, want, sendT, target }
  let raceOnline = false; // stays set if the opponent leaves mid-race, so it never scores as solo
  const online = () => raceOnline;
  const keys = { up: false, down: false, left: false, right: false };
  let touchGas = false;

  // Your own tracks from the editor live in localStorage next to the built-in ones.
  const customTracks = () => Arcade.load('tracks', []).map(t => ({ ...t, custom: true }));
  const allTracks = () => [...TRACKS, ...customTracks()];

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
      let seg = Math.hypot(b.x - a.x, b.y - a.y);
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
    if (points.length < 3) return { ok: false, msg: 'Click to place corners in driving order', bad: [], path: null };
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
    // In tight corners the line can't tuck in so far that it bends tighter than a car can turn
    // (about 38px: full lock at the speed where the tyres start to grip).
    const lo = new Float32Array(N).fill(-lim), hi = new Float32Array(N).fill(lim);
    radii(path).forEach((r, i) => {
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
    const speed = Float32Array.from(radii(line), r => clamp(r * TURN * 0.9, 70, 300));
    for (let k = 0; k < 2 * N; k++) {
      const i = (N * 2 - 1 - k) % N, j = (i + 1) % N;
      const ds = Math.hypot(line[j].x - line[i].x, line[j].y - line[i].y);
      speed[i] = Math.min(speed[i], Math.sqrt(speed[j] ** 2 + 2 * 520 * ds));
    }
    return { off, nx, ny, lim, speed };
  }

  function renderTrack(grass, p) {
    const c = trackLayer.ctx;
    c.fillStyle = grass;
    c.fillRect(0, 0, W, H);
    // A little texture so the grass isn't a flat fill.
    c.fillStyle = 'rgba(255,255,255,0.035)';
    for (let i = 0; i < 500; i++) c.fillRect((i * 97) % W, (i * 57 + (i % 7) * 31) % H, 3, 3);
    if (!p) return;

    const trace = () => {
      c.beginPath();
      p.forEach((pt, i) => (i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y)));
      c.closePath();
    };
    c.lineJoin = 'round';
    c.lineCap = 'round';
    trace();
    c.strokeStyle = '#e8e8e8';
    c.lineWidth = TRACK_W + 12;
    c.stroke();
    c.strokeStyle = '#d64545';
    c.setLineDash([14, 14]);
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = '#3b3f47';
    c.lineWidth = TRACK_W;
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 2;
    c.setLineDash([16, 18]);
    c.stroke();
    c.setLineDash([]);

    // Checkered start / finish line.
    const s = p[0];
    c.save();
    c.translate(s.x, s.y);
    c.rotate(s.a + Math.PI / 2);
    for (let i = 0; i < TRACK_W / 8; i++) {
      for (let j = 0; j < 2; j++) {
        c.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        c.fillRect(-TRACK_W / 2 + i * 8, -8 + j * 8, 8, 8);
      }
    }
    c.restore();
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

  // ---------- Race setup ----------

  function makeCar(slot, spec) {
    const back = 8 + Math.floor(slot / 2) * 9;
    const i = (N - back) % N;
    const p = path[i];
    const side = slot % 2 ? 1 : -1;
    return {
      x: p.x + Math.cos(p.a + Math.PI / 2) * side * 18,
      y: p.y + Math.sin(p.a + Math.PI / 2) * side * 18,
      a: p.a, v: 0, idx: i, dist: -back, lap: 0,
      color: spec.color, ai: !!spec.pace, pace: (spec.pace || 1) * level.pace,
      lane: 0, laneT: Arcade.rand(1, 3), finished: null, offTrack: false,
    };
  }

  // Online races are just the two of you: no rivals, side by side on the front row.
  function setupRace(t, vs = null) {
    track = t;
    ({ path, length: trackLen } = buildPath(t.points));
    N = path.length;
    racing = planRacingLine();
    renderTrack(t.grass, path);
    if (vs) {
      const mine = makeCar(vs.host ? 0 : 1, { color: '#ffc53d' });
      const theirs = makeCar(vs.host ? 1 : 0, { color: '#ff5d5d' });
      theirs.remote = true;
      cars = [mine, theirs];
      vs.remote = theirs;
    } else {
      cars = [makeCar(3, { color: '#ffc53d' }), ...RIVALS.map((r, i) => makeCar(i, r))];
    }
    player = cars[0];
    raceTime = 0;
    countdown = 3.5;
    lapStart = 0;
    bestLap = Infinity;
    recorded = [];
    recordAcc = 0;
    ghost = null;
    if (!vs) loadGhost();
    updateHud();
  }

  // ---------- Ghosts ----------

  const encode = frames => frames.map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.a * 100)].map(n => n.toString(36)).join(',')).join(';');
  const decode = s => s.split(';').map(f => {
    const [x, y, a] = f.split(',').map(n => parseInt(n, 36));
    return { x, y, a: a / 100 };
  });

  // Custom tracks only exist on this device, so their ghosts stay local too.
  function loadGhost() {
    const local = Arcade.load('ghost:' + track.id, null);
    const use = g => { if (g && g.frames) ghost = { ...g, frames: decode(g.frames) }; };
    use(local && { ...local, name: 'Your best' });
    if (!Online.enabled || track.custom) return;
    const forTrack = track;
    Online.getGhost(track.id)
      .then(g => {
        if (g && forTrack === track && (!local || g.time <= local.time)) use({ ...g, name: g.name });
      })
      .catch(() => {});
  }

  function saveGhost(time) {
    const frames = encode(recorded);
    const local = Arcade.load('ghost:' + track.id, null);
    if (!local || time < local.time) Arcade.save('ghost:' + track.id, { time, frames });
    if (Online.enabled && !track.custom) Online.saveGhost(track.id, time, frames).catch(() => {}); // rules keep only faster times
  }

  function ghostAt(t) {
    if (!ghost) return null;
    const f = t / GHOST_STEP;
    const i = Math.floor(f);
    if (i >= ghost.frames.length - 1) return null;
    const a = ghost.frames[i], b = ghost.frames[i + 1], k = f - i;
    let da = b.a - a.a;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: a.a + da * k };
  }

  // ---------- Driving ----------

  function angleDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

  // Cars drive straight through each other, so rivals never get in the way of a good lap.
  function drive(car, dt, gas, brake, steer) {
    const top = car.offTrack ? 120 : 300;
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
      if (after !== before && after > 0) Arcade.tone({ freq: 440, dur: 0.15, vol: 0.06 });
      if (countdown <= 0) Arcade.tone({ freq: 880, dur: 0.35, vol: 0.07 });
      return;
    }
    raceTime += dt;

    for (const car of cars) {
      if (car.remote) { followRemote(car, dt); continue; }
      if (car.finished !== null && car !== player) { drive(car, dt, false, true, 0); continue; }
      const input = car.ai
        ? aiInput(car, dt)
        : { gas: keys.up || touchGas, brake: keys.down, steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0) };
      drive(car, dt, input.gas, input.brake, input.steer);
      const lap = Math.floor(car.dist / N);
      if (lap > car.lap) {
        car.lap = lap;
        if (car === player && lap <= LAPS) {
          bestLap = Math.min(bestLap, raceTime - lapStart);
          lapStart = raceTime;
          if (lap < LAPS) Arcade.tone({ freq: 660, to: 880, dur: 0.15, type: 'triangle', vol: 0.05 });
        }
        if (lap >= LAPS && car.finished === null) car.finished = raceTime;
      }
    }

    recordAcc += dt;
    while (recordAcc >= GHOST_STEP) {
      recordAcc -= GHOST_STEP;
      recorded.push({ x: player.x, y: player.y, a: player.a });
    }

    if (net) {
      net.sendT -= dt;
      if (net.sendT <= 0 || player.finished !== null) {
        net.sendT = SEND_EVERY;
        net.conn.state({ x: Math.round(player.x), y: Math.round(player.y), a: Math.round(player.a * 100) / 100, d: player.dist, f: player.finished });
      }
    }

    updateHud();
    if (player.finished !== null) (online() ? finishOnline() : finishRace());
  }

  const position = car => 1 + cars.filter(c => c !== car && (
    (c.finished !== null && (car.finished === null || c.finished < car.finished)) ||
    (c.finished === null && car.finished === null && c.dist > car.dist))).length;

  function finishRace() {
    state = 'over';
    const place = position(player);
    const time = player.finished;
    const title = ['1st place!', '2nd place', '3rd place', '4th place'][place - 1];
    const summary = `${esc(track.name)} · ${time.toFixed(2)}s · best lap ${bestLap.toFixed(2)}s`;
    saveGhost(time);
    const bestKey = 'time:' + track.id;
    const prev = Arcade.load(bestKey, null);
    if (!prev || time < prev) Arcade.save(bestKey, time);
    Arcade.tone({ freq: 523, dur: 0.15, type: 'triangle', vol: 0.07 });
    Arcade.tone({ freq: 784, dur: 0.3, type: 'triangle', vol: 0.07, delay: 0.15 });

    // Anyone can build an easy track, so custom races don't score or count toward achievements.
    if (track.custom) {
      Arcade.countPlay();
      ui.show({
        title,
        html: `<p class="big">${time.toFixed(2)}s</p>
          ${!prev || time < prev ? '<p class="new-best">New track record</p>' : ''}
          <p>${summary}</p>
          <p class="muted-note">Races on your own tracks don't count toward the leaderboard.</p>`,
        button: 'Race again',
        onAction: showMenu,
        delay: 600,
      });
      return;
    }

    const par = (trackLen * LAPS) / PAR_SPEED;
    const score = Math.round(PLACE_POINTS[place - 1] * level.points) + Math.round(Math.max(0, par / time - 1) * 4000);
    if (place === 1) Arcade.flag('pocket-racer-win');
    Arcade.finish(ui, {
      score,
      title,
      lines: [summary, `${level.name} rivals`, '<span class="muted-note">Press R to restart on this track</span>'],
      button: 'Race again',
      onAction: showMenu,
    });
  }

  // ---------- Online races ----------

  // Each player drives their own car and streams where it is; the other car is drawn from that.
  function followRemote(car, dt) {
    const t = net?.target;
    if (!t) return;
    const k = Math.min(1, dt * 12);
    car.x += (t.x - car.x) * k;
    car.y += (t.y - car.y) * k;
    car.a += angleDiff(t.a, car.a) * k;
    car.dist = t.d;
    car.lap = Math.floor(t.d / N);
    if (t.f !== null && t.f !== undefined) car.finished = t.f;
  }

  function finishOnline() {
    state = 'online-over';
    const time = player.finished;
    const rival = cars.find(c => c.remote);
    const won = !rival || rival.finished === null || time <= rival.finished;
    saveGhost(time);
    Arcade.countPlay();
    if (net) Arcade.flag('online-match');
    if (won && net) Arcade.flag('pocket-racer-win');
    Arcade.tone(won ? { freq: 523, to: 1046, dur: 0.4, type: 'triangle', vol: 0.06 } : { freq: 300, to: 120, dur: 0.5, type: 'sawtooth', vol: 0.04 });
    const them = net ? esc(net.names[1]) : 'Your opponent';
    const showResult = () => {
      const r = cars.find(c => c.remote);
      const theirTime = r && r.finished !== null ? `${them} ${r.finished.toFixed(2)}s` : net ? `${them} is still racing…` : `${them} left`;
      ui.show({
        title: won ? 'You win the race!' : `${them} wins`,
        html: `<p class="big">${time.toFixed(2)}s</p><p>${esc(track.name)} · best lap ${bestLap.toFixed(2)}s</p><p data-them>${theirTime}</p>
          ${net ? '<div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div><p class="muted-note" data-wait>A rematch starts when you both press it.</p>' : ''}`,
        button: net ? 'Rematch' : 'Back to menu',
        delay: 600,
        onAction: () => {
          if (!net) return showMenu();
          net.want.me = true;
          net.conn.send('rematch');
          document.querySelector('[data-wait]').textContent = 'Waiting for your opponent…';
          maybeRematch();
        },
        onRender: panel => panel.querySelector('[data-leave]')?.addEventListener('click', () => leaveOnline()),
      });
    };
    showResult();
    // Fill in their time when they cross the line.
    const poll = setInterval(() => {
      const r = cars.find(c => c.remote);
      const slot = document.querySelector('[data-them]');
      if (state !== 'online-over' || !slot) return clearInterval(poll);
      if (r && r.finished !== null) {
        slot.textContent = `${net ? net.names[1] : 'Opponent'} ${r.finished.toFixed(2)}s`;
        clearInterval(poll);
      }
    }, 250);
  }

  async function goOnline(how, code) {
    let cancelled = false;
    const cancel = () => { cancelled = true; leaveOnline(); };
    ui.show({ title: 'Connecting…', html: '<p>Waking up the game server. The first connection can take up to a minute.</p>', button: 'Cancel', onAction: cancel });
    const handlers = {
      ready: () => {
        if (cancelled || !net) return;
        net.conn.send('hello', { name: Arcade.profile().name });
        if (net.host) startOnline();
      },
      event: onNet,
      state: s => { if (net) net.target = s; },
      left: opponentGone,
      closed: () => { if (net) opponentGone(); },
    };
    // Online races use the built-in tracks, which both players have.
    if (selected.custom) selected = TRACKS[0];
    try {
      const res = how === 'quick' ? await Relay.quickMatch('racer', handlers, `Race · ${selected.name}`)
        : how === 'create' ? await Relay.createRoom('racer', handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom('racer', code, handlers);
      if (cancelled) { res.conn.close(); return; }
      net = { conn: res.conn, host: res.slot === 1, names: [Arcade.profile().name, 'Opponent'], want: { me: false, them: false }, sendT: 0, target: null };
      if (net.host) {
        ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: (how === 'create'
            ? `<p>Share this code. The race starts as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick race.</p>') + `<p class="muted-note">Track: ${esc(selected.name)}</p>`,
          button: 'Cancel',
          onAction: cancel,
        });
      } else {
        ui.show({ title: 'Opponent found', html: '<p>Starting…</p>', button: null });
      }
    } catch (e) {
      if (!cancelled) showMenu(e.message);
    }
  }

  // The host picks the track (whatever was selected in their menu) and both grids start together.
  function startOnline() {
    net.want = { me: false, them: false };
    net.conn.send('race', { track: selected.id });
    beginOnline(selected);
  }

  function beginOnline(t) {
    net.target = null;
    raceOnline = true;
    setupRace(t, net);
    state = 'playing';
    ui.hide();
  }

  function onNet(name, data) {
    if (!net) return;
    if (name === 'hello') net.names[1] = String(data?.name || 'Opponent').slice(0, 24);
    else if (name === 'race' && !net.host) beginOnline(TRACKS.find(t => t.id === data.track) || TRACKS[0]);
    else if (name === 'rematch') {
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
      showMenu(`${name} left.`);
    }
  }

  function leaveOnline() {
    if (net) {
      net.conn.send('quit');
      net.conn.close();
      net = null;
    }
    showMenu();
  }
  window.addEventListener('pagehide', () => net?.conn.send('quit'));

  // ---------- HUD & menu ----------

  function updateHud() {
    $('lap').textContent = `${Math.min(LAPS, Math.max(1, player.lap + 1))}/${LAPS}`;
    $('pos').textContent = `${position(player)}/${cars.length}`;
    $('time').textContent = raceTime.toFixed(1);
  }

  function showMenu(error = '') {
    if (net) {
      net.conn.send('quit');
      net.conn.close();
      net = null;
    }
    raceOnline = false;
    state = 'menu';
    selected = allTracks().find(t => t.id === selected.id) || TRACKS[0];
    setupRace(selected);
    const chip = t => {
      const best = Arcade.load('time:' + t.id, null);
      return `<button class="chip" type="button" data-track="${esc(t.id)}" aria-pressed="${t.id === selected.id}">${esc(t.name)}${best ? ` · ${best.toFixed(1)}s` : ''}</button>`;
    };
    const mine = customTracks();
    const levels = LEVELS.map(l => `<button class="chip" type="button" data-level="${l.id}" aria-pressed="${l === level}">${l.name}</button>`).join('');
    ui.show({
      title: 'Pocket Racer',
      html: `<p>Three laps, three rivals. The ghost car is ${Online.enabled && !selected.custom ? 'the fastest racer in the world' : 'your own best run'} on this track.</p>
        <div class="filters" style="justify-content:center;margin-bottom:12px">${TRACKS.map(chip).join('')}</div>
        ${mine.length ? `<p class="muted-note" style="margin:0 0 6px">Your tracks</p><div class="filters" style="justify-content:center;margin-bottom:12px">${mine.map(chip).join('')}</div>` : ''}
        <p class="muted-note" style="margin:0 0 6px">Rivals</p>
        <div class="filters" style="justify-content:center;margin-bottom:16px">${levels}</div>`,
      button: 'Start race',
      onAction: start,
      onRender: panel => {
        const live = Relay.enabled && !selected.custom;
        panel.insertAdjacentHTML('beforeend', `<div class="menu" style="margin-top:8px"><div class="row">
          <button class="btn secondary" type="button" data-build>New track</button>
          ${selected.custom ? '<button class="btn secondary" type="button" data-edit>Edit</button><button class="btn secondary" type="button" data-delete>Delete</button>' : ''}
        </div>
        ${Relay.enabled ? `<p class="muted-note" style="margin:6px 0 0">Race a real player on ${selected.custom ? 'a built-in track' : esc(selected.name)}</p>
        <div class="row">
          <button class="btn secondary" type="button" data-net="quick" ${live ? '' : 'disabled'}>Quick race</button>
          <button class="btn secondary" type="button" data-net="create" ${live ? '' : 'disabled'}>Private room</button>
        </div>
        <div class="row">
          <input class="field" id="code" maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code">
          <button class="btn secondary" type="button" data-net="join">Join</button>
        </div>` : ''}
        </div><p class="error">${esc(error)}</p><div data-waiting></div>`);
        const code = panel.querySelector('#code');
        panel.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => goOnline(b.dataset.net, code.value)));
        code?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); goOnline('join', code.value); } });
        Relay.showWaiting(panel.querySelector('[data-waiting]'), room => goOnline('public', room));
        panel.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => {
          selected = allTracks().find(t => t.id === b.dataset.track);
          showMenu();
        }));
        panel.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => {
          level = LEVELS.find(l => l.id === b.dataset.level);
          Arcade.save('racer:level', level.id);
          showMenu();
        }));
        panel.querySelector('[data-build]').addEventListener('click', () => openEditor(null));
        panel.querySelector('[data-edit]')?.addEventListener('click', () => openEditor(selected));
        panel.querySelector('[data-delete]')?.addEventListener('click', () => {
          if (!confirm(`Delete "${selected.name}"?`)) return;
          Arcade.save('tracks', Arcade.load('tracks', []).filter(t => t.id !== selected.id));
          forgetRecords(selected.id);
          selected = TRACKS[0];
          showMenu();
        });
      },
    });
  }

  function forgetRecords(id) {
    Arcade.save('ghost:' + id, null);
    Arcade.save('time:' + id, null);
  }

  function start() {
    raceOnline = false;
    setupRace(selected);
    state = 'playing';
    ui.hide();
  }

  function pause() {
    if (state !== 'playing' || online()) return;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }

  function resume() {
    state = 'playing';
    ui.hide();
  }

  // ---------- Track editor ----------

  // Corners are placed in driving order; a new one goes in right after the selected corner.
  function openEditor(t) {
    state = 'edit';
    const points = t ? t.points.map(p => [...p]) : [];
    edit = {
      id: t ? t.id : null,
      name: t ? t.name : `My Track ${customTracks().length + 1}`,
      theme: Math.max(0, THEMES.findIndex(th => th.grass === (t && t.grass))),
      points, history: [], sel: points.length - 1, drag: -1, moved: false,
    };
    ui.hide();
    $('editor').hidden = false;
    $('help').style.display = 'none';
    $('touchpad').style.display = 'none';
    canvas.style.touchAction = 'none';
    refreshEditor();
  }

  function closeEditor() {
    edit = null;
    $('editor').hidden = true;
    $('help').style.display = '';
    $('touchpad').style.display = '';
    canvas.style.touchAction = '';
    showMenu();
  }

  function refreshEditor() {
    edit.check = checkTrack(edit.points);
    renderTrack(THEMES[edit.theme].grass, edit.check.path);
    $('ed-undo').disabled = !edit.history.length;
    $('ed-delete').disabled = edit.sel < 0;
    $('ed-save').disabled = !edit.check.ok;
    $('ed-theme').textContent = `Theme: ${THEMES[edit.theme].name}`;
  }

  function remember() {
    edit.history.push(edit.points.map(p => [...p]));
    if (edit.history.length > 60) edit.history.shift();
  }

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return [clamp((e.clientX - r.left) * W / r.width, 20, W - 20), clamp((e.clientY - r.top) * H / r.height, 20, H - 20)];
  }

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'edit' || !$('overlay').hidden) return;
    e.preventDefault();
    const [x, y] = toCanvas(e);
    const reach = Math.max(14, 16 * W / canvas.getBoundingClientRect().width);
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
      Arcade.tone({ freq: 520, dur: 0.05, vol: 0.03 });
    } else {
      edit.history.pop();
    }
    refreshEditor();
  });
  canvas.addEventListener('pointermove', e => {
    if (!edit || edit.drag < 0) return;
    const [x, y] = toCanvas(e);
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
      edit.theme = (edit.theme + 1) % THEMES.length;
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
        ${edit.id ? '<p class="muted-note">Saving clears this track\'s best time and ghost, since the layout changed.</p>' : ''}`,
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
      grass: THEMES[edit.theme].grass,
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
    selected = t;
    closeEditor();
  }

  // ---------- Input ----------

  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  window.addEventListener('keydown', e => {
    if (state === 'edit') {
      if (e.target.tagName === 'INPUT' || !$('overlay').hidden) return;
      if (e.code === 'Delete' || e.code === 'Backspace') deleteCorner();
      if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    // Instant restart on the same track, for speedrunners. Not in online races.
    if (e.code === 'KeyR' && !online() && ['playing', 'paused', 'over'].includes(state) && e.target.tagName !== 'INPUT') {
      for (const k in keys) keys[k] = false;
      start();
      return;
    }
    if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = true;
  });
  window.addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });

  // On touch screens the car accelerates on its own; you steer and brake.
  function hold(id, key) {
    const el = $(id);
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      touchGas = true;
      keys[key] = true;
    });
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { keys[key] = false; });
  }
  hold('left', 'left');
  hold('right', 'right');
  hold('brake', 'down');

  Arcade.onBlur(() => {
    for (const k in keys) keys[k] = false;
    pause();
  });

  // ---------- Drawing ----------

  function drawCar(x, y, a, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-12, -7, 26, 16);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-13, -8, 26, 16, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,24,32,0.85)';
    ctx.fillRect(-3, -6, 8, 12);
    ctx.fillStyle = '#111';
    ctx.fillRect(-10, -10, 6, 3);
    ctx.fillRect(-10, 7, 6, 3);
    ctx.fillRect(5, -10, 6, 3);
    ctx.fillRect(5, 7, 6, 3);
    ctx.restore();
  }

  function draw() {
    ctx.drawImage(trackLayer.canvas, 0, 0, W, H);

    const g = state === 'playing' || state === 'paused' || state === 'over' || state === 'online-over' ? ghostAt(raceTime) : null;
    if (g) {
      drawCar(g.x, g.y, g.a, '#ffffff', 0.35);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`${ghost.name} · ${ghost.time.toFixed(1)}s`, g.x, g.y - 18);
    }
    // Rivals are see-through where they overlap you, so your own car always stays visible.
    for (const car of cars.slice(1)) {
      const over = Math.hypot(car.x - player.x, car.y - player.y) < CAR_R * 2.5;
      drawCar(car.x, car.y, car.a, car.color, over ? 0.45 : 1);
      if (car.remote && net) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(net.names[1], car.x, car.y - 18);
      }
    }
    drawCar(player.x, player.y, player.a, player.color);

    // Little arrow over the player so you can find yourself on the grid.
    if (raceTime < 4 && state !== 'menu') {
      ctx.fillStyle = '#ffc53d';
      ctx.beginPath();
      ctx.moveTo(player.x - 6, player.y - 24);
      ctx.lineTo(player.x + 6, player.y - 24);
      ctx.lineTo(player.x, player.y - 16);
      ctx.fill();
    }

    if (state === 'playing' && countdown > 0) {
      const n = Math.ceil(countdown);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = '700 96px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(n > 3 ? '' : n, W / 2, H / 2);
      ctx.textBaseline = 'alphabetic';
    } else if (state === 'playing' && raceTime < 0.8) {
      ctx.font = '700 72px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255,197,61,${1 - raceTime / 0.8})`;
      ctx.fillText('GO!', W / 2, H / 2 + 24);
    }
  }

  function drawEditor() {
    ctx.drawImage(trackLayer.canvas, 0, 0, W, H);
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

    const msg = check.ok ? `Looks good · ${Math.round(check.length)} px per lap · press Save to race it` : check.msg;
    ctx.font = '600 13px system-ui, sans-serif';
    const w = ctx.measureText(msg).width + 24;
    ctx.fillStyle = 'rgba(14,16,20,0.8)';
    ctx.beginPath();
    ctx.roundRect(W / 2 - w / 2, 10, w, 28, 8);
    ctx.fill();
    ctx.fillStyle = check.ok ? '#3ddc84' : '#fff';
    ctx.fillText(msg, W / 2, 24.5);
    ctx.textBaseline = 'alphabetic';
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    if (state === 'edit') drawEditor();
    else draw();
    requestAnimationFrame(frame);
  }

  showMenu();
  const invite = Relay.takeInvite();
  if (invite) goOnline('public', invite);
  requestAnimationFrame(frame);
})();
