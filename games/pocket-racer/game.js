(() => {
  const W = 800, H = 560, TRACK_W = 80, LAPS = 3, CAR_R = 13;
  const GHOST_STEP = 0.1; // seconds between recorded ghost frames
  const PAR_SPEED = 150;  // px/s; averaging faster than this earns a time bonus (AI pace is ~185)

  // The first point of each track is the start line, so it sits on a straight.
  const TRACKS = [
    { id: 'harbor', name: 'Harbor Loop', grass: '#2d5f3a', points: [[400, 90], [680, 110], [720, 280], [680, 450], [520, 470], [440, 380], [360, 380], [280, 470], [120, 450], [80, 280], [120, 110]] },
    { id: 'pines', name: 'Pine Hills', grass: '#3a5a2c', points: [[240, 95], [330, 80], [480, 150], [650, 90], [730, 220], [640, 330], [700, 460], [500, 480], [380, 380], [250, 480], [100, 420], [90, 250], [150, 120]] },
    { id: 'canyon', name: 'Canyon Twist', grass: '#8a6a45', points: [[400, 80], [650, 90], [730, 200], [620, 280], [700, 400], [600, 480], [400, 470], [300, 360], [200, 470], [90, 400], [110, 200], [200, 100]] },
  ];
  const RIVALS = [
    { color: '#4f8cff', top: 268 },
    { color: '#3ddc84', top: 256 },
    { color: '#c77dff', top: 244 },
  ];
  const PLACE_POINTS = [1000, 600, 400, 200];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const trackLayer = Arcade.makeLayer(W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';
  let track, path, N, trackLen;
  let cars, player, raceTime, countdown, lapStart, bestLap, recorded, recordAcc, ghost;
  let selected = TRACKS[0];
  const keys = { up: false, down: false, left: false, right: false };
  let touchGas = false;

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
    const STEP = 6;
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

  function renderTrack() {
    const c = trackLayer.ctx;
    c.fillStyle = track.grass;
    c.fillRect(0, 0, W, H);
    // A little texture so the grass isn't a flat fill.
    c.fillStyle = 'rgba(255,255,255,0.035)';
    for (let i = 0; i < 500; i++) c.fillRect((i * 97) % W, (i * 57 + (i % 7) * 31) % H, 3, 3);

    const trace = () => {
      c.beginPath();
      path.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
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
    const s = path[0];
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
      color: spec.color, top: spec.top || 300, ai: !!spec.top,
      lane: side * 14, laneT: Arcade.rand(1, 3), finished: null, offTrack: false,
    };
  }

  function setupRace(t) {
    track = t;
    ({ path, length: trackLen } = buildPath(t.points));
    N = path.length;
    renderTrack();
    cars = [makeCar(3, { color: '#ffc53d' }), ...RIVALS.map((r, i) => makeCar(i, r))];
    player = cars[0];
    raceTime = 0;
    countdown = 3.5;
    lapStart = 0;
    bestLap = Infinity;
    recorded = [];
    recordAcc = 0;
    ghost = null;
    loadGhost();
    updateHud();
  }

  // ---------- Ghosts ----------

  const encode = frames => frames.map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.a * 100)].map(n => n.toString(36)).join(',')).join(';');
  const decode = s => s.split(';').map(f => {
    const [x, y, a] = f.split(',').map(n => parseInt(n, 36));
    return { x, y, a: a / 100 };
  });

  function loadGhost() {
    const local = Arcade.load('ghost:' + track.id, null);
    const use = g => { if (g && g.frames) ghost = { ...g, frames: decode(g.frames) }; };
    use(local && { ...local, name: 'Your best' });
    if (!Online.enabled) return;
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
    if (Online.enabled) Online.saveGhost(track.id, time, frames).catch(() => {}); // rules keep only faster times
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

  const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  function drive(car, dt, gas, brake, steer) {
    const top = car.offTrack ? 120 : car.top;
    if (gas) car.v += 420 * dt;
    if (brake) car.v -= (car.v > 0 ? 700 : 300) * dt;
    car.v -= car.v * (car.offTrack ? 2.2 : 0.5) * dt;
    car.v = Math.max(-90, Math.min(top, car.v));
    const grip = Math.min(1, Math.abs(car.v) / 110);
    car.a += steer * 2.9 * grip * Math.sign(car.v || 1) * dt;
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

  function aiInput(car, dt) {
    car.laneT -= dt;
    if (car.laneT <= 0) {
      car.lane = Arcade.rand(-20, 20);
      car.laneT = Arcade.rand(1.5, 3.5);
    }
    const look = path[(car.idx + 14) % N];
    const tx = look.x + Math.cos(look.a + Math.PI / 2) * car.lane;
    const ty = look.y + Math.sin(look.a + Math.PI / 2) * car.lane;
    const steer = Math.max(-1, Math.min(1, angleDiff(Math.atan2(ty - car.y, tx - car.x), car.a) * 2.5));
    // Slow down for corners: how much the track turns over the next stretch.
    const bend = Math.abs(angleDiff(path[(car.idx + 30) % N].a, path[car.idx].a));
    // Mild rubber-banding keeps races close.
    const gap = (car.dist - player.dist) / N;
    const band = gap > 0.25 ? 0.9 : gap < -0.25 ? 1.08 : 1;
    const target = car.top * band * (1 - Math.min(0.5, bend * 0.45));
    return { gas: car.v < target, brake: car.v > target + 25, steer };
  }

  function collide() {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d === 0 || d >= CAR_R * 2) continue;
        const push = (CAR_R * 2 - d) / 2, nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        a.v *= 0.97; b.v *= 0.97;
      }
    }
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
    collide();

    recordAcc += dt;
    while (recordAcc >= GHOST_STEP) {
      recordAcc -= GHOST_STEP;
      recorded.push({ x: player.x, y: player.y, a: player.a });
    }

    updateHud();
    if (player.finished !== null) finishRace();
  }

  const position = car => 1 + cars.filter(c => c !== car && (
    (c.finished !== null && (car.finished === null || c.finished < car.finished)) ||
    (c.finished === null && car.finished === null && c.dist > car.dist))).length;

  function finishRace() {
    state = 'over';
    const place = position(player);
    const time = player.finished;
    const par = (trackLen * LAPS) / PAR_SPEED;
    const score = PLACE_POINTS[place - 1] + Math.round(Math.max(0, par / time - 1) * 4000);
    if (place === 1) Arcade.flag('pocket-racer-win');
    saveGhost(time);
    const bestKey = 'time:' + track.id;
    const prev = Arcade.load(bestKey, null);
    if (!prev || time < prev) Arcade.save(bestKey, time);
    Arcade.tone({ freq: 523, dur: 0.15, type: 'triangle', vol: 0.07 });
    Arcade.tone({ freq: 784, dur: 0.3, type: 'triangle', vol: 0.07, delay: 0.15 });
    Arcade.finish(ui, {
      score,
      title: ['1st place!', '2nd place', '3rd place', '4th place'][place - 1],
      lines: [`${track.name} · ${time.toFixed(2)}s · best lap ${bestLap.toFixed(2)}s`],
      button: 'Race again',
      onAction: showMenu,
    });
  }

  // ---------- HUD & menu ----------

  function updateHud() {
    $('lap').textContent = `${Math.min(LAPS, Math.max(1, player.lap + 1))}/${LAPS}`;
    $('pos').textContent = `${position(player)}/${cars.length}`;
    $('time').textContent = raceTime.toFixed(1);
  }

  function showMenu() {
    state = 'menu';
    setupRace(selected);
    const chips = TRACKS.map(t => {
      const best = Arcade.load('time:' + t.id, null);
      return `<button class="chip" type="button" data-track="${t.id}" aria-pressed="${t === selected}">${t.name}${best ? ` · ${best.toFixed(1)}s` : ''}</button>`;
    }).join('');
    ui.show({
      title: 'Pocket Racer',
      html: `<p>Three laps, three rivals. The ghost car is ${Online.enabled ? 'the fastest racer in the world' : 'your own best run'} on this track.</p>
        <div class="filters" style="justify-content:center;margin-bottom:16px">${chips}</div>`,
      button: 'Start race',
      onAction: start,
      onRender: panel => panel.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => {
        selected = TRACKS.find(t => t.id === b.dataset.track);
        showMenu();
      })),
    });
  }

  function start() {
    setupRace(selected);
    state = 'playing';
    ui.hide();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }

  function resume() {
    state = 'playing';
    ui.hide();
  }

  // ---------- Input ----------

  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
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

    const g = state === 'playing' || state === 'paused' || state === 'over' ? ghostAt(raceTime) : null;
    if (g) {
      drawCar(g.x, g.y, g.a, '#ffffff', 0.35);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`${ghost.name} · ${ghost.time.toFixed(1)}s`, g.x, g.y - 18);
    }
    for (const car of [...cars].reverse()) drawCar(car.x, car.y, car.a, car.color);

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

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  showMenu();
  requestAnimationFrame(frame);
})();
