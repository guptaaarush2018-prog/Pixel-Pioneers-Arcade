(() => {
  const W = 360, H = 640, LANES = 4, LANE_W = 70, ROAD_X = (W - LANES * LANE_W) / 2;
  const CAR_W = 40, CAR_H = 70, PLAYER_Y = 520;
  const COLORS = ['#4f8cff', '#3ddc84', '#c77dff', '#ff6b6b', '#e8e8e8', '#5ec8d8'];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'ready';
  let lane, x, tilt, speed, distance, bonus, traffic, coins, popups, nextRow, combo, comboUntil, time, scroll;

  const laneX = l => ROAD_X + l * LANE_W + LANE_W / 2;

  function reset() {
    lane = 1;
    x = laneX(lane);
    tilt = 0;
    speed = 320;
    distance = 0;
    bonus = 0;
    traffic = [];
    coins = [];
    popups = [];
    nextRow = 200;
    combo = 0;
    comboUntil = 0;
    time = 0;
    scroll = 0;
    updateHud();
  }

  // Each row of traffic always leaves at least one lane open, and rows are spaced so you
  // can cross the whole road between them at the current speed.
  function spawnRow() {
    const count = Math.random() < 0.25 + Math.min(0.4, time / 120) ? Arcade.randInt(2, 3) : 1;
    const lanes = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    const taken = lanes.slice(0, count);
    for (const l of taken) {
      traffic.push({ lane: l, y: -CAR_H - Arcade.rand(0, 30), color: Arcade.pick(COLORS), passed: false });
    }
    const free = lanes.slice(count);
    if (Math.random() < 0.35) coins.push({ lane: Arcade.pick(free), y: -40 });
  }

  function steer(dir) {
    if (state !== 'playing') return;
    const next = Math.max(0, Math.min(LANES - 1, lane + dir));
    if (next !== lane) {
      lane = next;
      tilt = dir * 0.18;
      Arcade.tone({ freq: 300, to: 360, dur: 0.05, vol: 0.025 });
    }
  }

  function update(dt) {
    time += dt;
    speed = Math.min(950, 320 + time * 7);
    const dy = speed * dt;
    distance += dy;
    scroll += dy;

    x += (laneX(lane) - x) * Math.min(1, dt * 16);
    tilt *= Math.pow(0.02, dt);

    nextRow -= dy;
    if (nextRow <= 0) {
      spawnRow();
      nextRow = Math.max(190, speed * 0.55) + Arcade.rand(0, 120);
    }

    const me = { x: x - CAR_W / 2 + 5, y: PLAYER_Y + 6, w: CAR_W - 10, h: CAR_H - 12 };
    for (const c of traffic) {
      c.y += dy * 0.75; // traffic drives too, just slower than you
      const cx = laneX(c.lane) - CAR_W / 2;
      if (me.x < cx + CAR_W - 5 && me.x + me.w > cx + 5 && me.y < c.y + CAR_H - 6 && me.y + me.h > c.y + 6) {
        crash();
        return;
      }
      if (!c.passed && c.y > PLAYER_Y + CAR_H) {
        c.passed = true;
        if (Math.abs(laneX(c.lane) - x) < LANE_W * 1.2) {
          combo = time < comboUntil ? combo + 1 : 1;
          comboUntil = time + 2;
          const pts = 25 * Math.min(combo, 8);
          bonus += pts;
          popups.push({ x: laneX(c.lane), y: PLAYER_Y, text: combo > 1 ? `Close call x${combo}` : 'Close call', life: 0.9 });
          Arcade.tone({ freq: 500 + combo * 60, dur: 0.06, type: 'triangle', vol: 0.04 });
        }
      }
    }
    traffic = traffic.filter(c => c.y < H + 20);

    for (const c of coins) c.y += dy;
    coins = coins.filter(c => {
      if (c.y > H) return false;
      if (Math.abs(laneX(c.lane) - x) < 30 && Math.abs(c.y - (PLAYER_Y + CAR_H / 2)) < 40) {
        bonus += 50;
        popups.push({ x: laneX(c.lane), y: c.y, text: '+50', life: 0.7 });
        Arcade.tone({ freq: 990, to: 1320, dur: 0.08, vol: 0.04 });
        return false;
      }
      return true;
    });

    for (const p of popups) { p.y -= 60 * dt; p.life -= dt; }
    popups = popups.filter(p => p.life > 0);
    updateHud();
  }

  const score = () => Math.floor(distance / 20) + bonus;

  function updateHud() {
    $('score').textContent = score();
    $('speed').textContent = `${Math.round(speed / 4)} km/h`;
    $('best').textContent = Math.max(score(), Arcade.getBest(Arcade.gameId));
  }

  function crash() {
    state = 'over';
    Arcade.tone({ freq: 200, to: 40, dur: 0.5, type: 'sawtooth', vol: 0.07 });
    Arcade.finish(ui, {
      score: score(),
      title: 'Crashed!',
      lines: [`${(distance / 2000).toFixed(1)} km · top speed ${Math.round(speed / 4)} km/h`],
      button: 'Drive again',
      onAction: start,
    });
  }

  function start() {
    reset();
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

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (e.repeat) return;
    const d = Arcade.DIRS[e.code];
    if (d === 'left') steer(-1);
    if (d === 'right') steer(1);
  });
  $('left').addEventListener('pointerdown', e => { e.preventDefault(); steer(-1); });
  $('right').addEventListener('pointerdown', e => { e.preventDefault(); steer(1); });
  Arcade.onSwipe(canvas.parentElement, d => {
    if (d === 'left') steer(-1);
    if (d === 'right') steer(1);
  });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function drawCar(cx, y, color, angle = 0, player = false) {
    ctx.save();
    ctx.translate(cx, y + CAR_H / 2);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-CAR_W / 2 + 3, -CAR_H / 2 + 5, CAR_W, CAR_H);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-CAR_W / 2, -CAR_H / 2, CAR_W, CAR_H, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,24,32,0.8)';
    ctx.fillRect(-CAR_W / 2 + 6, -CAR_H / 2 + (player ? 14 : 44), CAR_W - 12, 12);
    ctx.fillRect(-CAR_W / 2 + 6, -CAR_H / 2 + (player ? 44 : 14), CAR_W - 12, 8);
    ctx.fillStyle = player ? '#fff7d6' : '#ff5a5a';
    ctx.fillRect(-CAR_W / 2 + 4, player ? -CAR_H / 2 : CAR_H / 2 - 4, 8, 4);
    ctx.fillRect(CAR_W / 2 - 12, player ? -CAR_H / 2 : CAR_H / 2 - 4, 8, 4);
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = '#2f5d3a';
    ctx.fillRect(0, 0, W, H);
    // Roadside trees scroll by.
    ctx.fillStyle = '#25492e';
    for (let i = 0; i < 8; i++) {
      const y = ((i * 120 + scroll * 0.9) % (H + 120)) - 60;
      ctx.beginPath(); ctx.arc(14, y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W - 14, y + 60, 12, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = '#3b3f47';
    ctx.fillRect(ROAD_X - 6, 0, LANES * LANE_W + 12, H);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(ROAD_X - 6, 0, 4, H);
    ctx.fillRect(ROAD_X + LANES * LANE_W + 2, 0, 4, H);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const off = scroll % 60;
    for (let l = 1; l < LANES; l++) {
      for (let y = -60 + off; y < H; y += 60) ctx.fillRect(ROAD_X + l * LANE_W - 2, y, 4, 30);
    }

    for (const c of coins) {
      ctx.fillStyle = '#ffc53d';
      ctx.beginPath();
      ctx.arc(laneX(c.lane), c.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c48a00';
      ctx.fillRect(laneX(c.lane) - 2, c.y - 6, 4, 12);
    }

    for (const c of traffic) drawCar(laneX(c.lane), c.y, c.color, Math.PI);
    if (state !== 'ready') drawCar(x, PLAYER_Y, '#ffc53d', tilt, true);

    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    // Speed lines once you're really moving.
    if (speed > 600 && state === 'playing') {
      ctx.fillStyle = `rgba(255,255,255,${(speed - 600) / 2000})`;
      for (let i = 0; i < 6; i++) ctx.fillRect((i * 67 + scroll) % W, (i * 131 + scroll * 2) % H, 2, 40);
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

  reset();
  Versus.attach({
    ui,
    start,
    score: () => score(),
    intro: {
      title: 'Lane Rush',
      html: `<ul>
        <li>Change lanes to dodge the traffic. There's always a way through.</li>
        <li>Passing right next to a car is a <b>close call</b>. Chain them for a bigger bonus.</li>
        <li>Grab <b>coins</b> for 50 points. You keep getting faster.</li>
      </ul>`,
      button: 'Start driving',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
