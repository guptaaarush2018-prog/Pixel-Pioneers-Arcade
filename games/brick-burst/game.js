(() => {
  const W = 480, H = 640, COLS = 8, BRICK_H = 20, TOP = 70, SIDE = 20, GAP = 6;
  const BRICK_W = (W - SIDE * 2 - GAP * (COLS - 1)) / COLS;
  const PADDLE_Y = 600, PADDLE_H = 12, BALL_R = 7;
  const HP_COLORS = ['#4f8cff', '#3ddc84', '#ffc53d', '#ff6b6b'];
  const POWERS = {
    wide: { label: 'W', color: '#3ddc84' },
    multi: { label: 'M', color: '#c77dff' },
    slow: { label: 'S', color: '#5ec8d8' },
    life: { label: '+', color: '#ff6b6b' },
  };

  // Each pattern says whether a brick goes at (row, col) for a given row count.
  const PATTERNS = [
    () => true,
    (r, c) => (r + c) % 2 === 0,
    (r, c, rows) => Math.abs(c - 3.5) <= r + 0.5 - (rows - 4) * 0.5 + 1,
    (r, c, rows) => Math.abs(c - 3.5) + Math.abs(r - (rows - 1) / 2) <= 4,
    r => r % 2 === 0,
    (r, c) => c !== 3 && c !== 4,
    () => Math.random() < 0.7,
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'ready';
  let paddle, balls, bricks, drops, particles, score, lives, level, wideUntil, slowUntil, time, held, pointerX;

  function buildLevel() {
    const rows = Math.min(8, 4 + Math.floor(level / 2));
    const pattern = level === 1 ? PATTERNS[0] : PATTERNS[(level - 1) % PATTERNS.length];
    bricks = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!pattern(r, c, rows)) continue;
        // Tougher bricks show up higher on the wall as levels go on.
        const hp = Math.min(4, 1 + Math.floor(Math.max(0, level - 1 - r) / 2) + (r < 2 && level > 2 ? 1 : 0));
        bricks.push({ x: SIDE + c * (BRICK_W + GAP), y: TOP + r * (BRICK_H + GAP), hp, max: hp });
      }
    }
    if (!bricks.length) bricks.push({ x: W / 2 - BRICK_W / 2, y: TOP, hp: 1, max: 1 });
    resetBall();
  }

  function resetBall() {
    balls = [{ x: paddle.x, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, stuck: true }];
    drops = [];
    wideUntil = slowUntil = 0;
  }

  function reset() {
    paddle = { x: W / 2, w: 90 };
    particles = [];
    score = 0;
    lives = 3;
    level = 1;
    time = 0;
    held = { left: false, right: false };
    pointerX = null;
    buildLevel();
    updateHud();
  }

  const ballSpeed = () => (380 + level * 22) * (time < slowUntil ? 0.65 : 1);

  function launch() {
    if (state !== 'playing') return;
    for (const b of balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const a = Arcade.rand(-0.35, 0.35);
      b.vx = Math.sin(a) * ballSpeed();
      b.vy = -Math.cos(a) * ballSpeed();
      Arcade.tone({ freq: 440, dur: 0.05, vol: 0.03 });
    }
  }

  function burst(x, y, color) {
    for (let i = 0; i < 8; i++) {
      particles.push({ x, y, vx: Arcade.rand(-150, 150), vy: Arcade.rand(-150, 100), life: Arcade.rand(0.3, 0.6), color });
    }
  }

  function hitBrick(b) {
    b.hp--;
    if (b.hp <= 0) {
      score += 25 * level * b.max;
      burst(b.x + BRICK_W / 2, b.y + BRICK_H / 2, HP_COLORS[b.max - 1]);
      if (Math.random() < 0.12) {
        const kind = Math.random() < 0.08 ? 'life' : Arcade.pick(['wide', 'multi', 'slow']);
        drops.push({ x: b.x + BRICK_W / 2, y: b.y + BRICK_H / 2, kind });
      }
      Arcade.tone({ freq: 660 + Math.random() * 200, dur: 0.05, vol: 0.035 });
    } else {
      score += 10;
      Arcade.tone({ freq: 330, dur: 0.04, vol: 0.03 });
    }
    updateHud();
  }

  function power(kind) {
    if (kind === 'wide') wideUntil = time + 10;
    if (kind === 'slow') slowUntil = time + 8;
    if (kind === 'life') lives = Math.min(5, lives + 1);
    if (kind === 'multi') {
      const src = balls.find(b => !b.stuck) || balls[0];
      for (const s of [-0.4, 0.4]) {
        const a = Math.atan2(src.vx || 0.01, -(src.vy || -1)) + s;
        balls.push({ x: src.x, y: src.y, vx: Math.sin(a) * ballSpeed(), vy: -Math.abs(Math.cos(a) * ballSpeed()), stuck: false });
      }
    }
    score += 50;
    Arcade.tone({ freq: 500, to: 1000, dur: 0.15, type: 'triangle', vol: 0.05 });
    updateHud();
  }

  function stepBall(b, dt) {
    // Keep a constant speed even when slow-mo turns on or off.
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const target = ballSpeed();
    b.vx *= target / sp;
    b.vy *= target / sp;

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); }
    if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); }
    if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); }

    // Paddle: where you hit it decides the bounce angle.
    const half = paddle.w / 2;
    if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y + BALL_R <= PADDLE_Y + PADDLE_H + 8 && Math.abs(b.x - paddle.x) <= half + BALL_R) {
      const t = Math.max(-1, Math.min(1, (b.x - paddle.x) / half));
      const a = t * 1.05;
      b.vx = Math.sin(a) * target;
      b.vy = -Math.cos(a) * target;
      b.y = PADDLE_Y - BALL_R;
      Arcade.tone({ freq: 260, dur: 0.04, vol: 0.03 });
    }

    for (const br of bricks) {
      if (br.hp <= 0) continue;
      const cx = Math.max(br.x, Math.min(b.x, br.x + BRICK_W));
      const cy = Math.max(br.y, Math.min(b.y, br.y + BRICK_H));
      if ((b.x - cx) ** 2 + (b.y - cy) ** 2 > BALL_R * BALL_R) continue;
      // Bounce off whichever side we overlap least.
      const overlapX = Math.min(b.x + BALL_R - br.x, br.x + BRICK_W - (b.x - BALL_R));
      const overlapY = Math.min(b.y + BALL_R - br.y, br.y + BRICK_H - (b.y - BALL_R));
      if (overlapX < overlapY) b.vx = b.x < br.x + BRICK_W / 2 ? -Math.abs(b.vx) : Math.abs(b.vx);
      else b.vy = b.y < br.y + BRICK_H / 2 ? -Math.abs(b.vy) : Math.abs(b.vy);
      hitBrick(br);
      break;
    }
  }

  function update(dt) {
    time += dt;
    paddle.w = time < wideUntil ? 140 : 90;
    if (pointerX !== null) paddle.x += (pointerX - paddle.x) * Math.min(1, dt * 25);
    else paddle.x += ((held.right ? 1 : 0) - (held.left ? 1 : 0)) * 520 * dt;
    paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, paddle.x));

    for (const b of balls) {
      if (b.stuck) {
        b.x = paddle.x;
        b.y = PADDLE_Y - BALL_R - 1;
        continue;
      }
      // Small steps so a fast ball can't tunnel through a brick.
      const steps = 4;
      for (let i = 0; i < steps; i++) stepBall(b, dt / steps);
    }
    bricks = bricks.filter(b => b.hp > 0);
    balls = balls.filter(b => b.y < H + 20);

    for (const d of drops) d.y += 160 * dt;
    drops = drops.filter(d => {
      if (d.y > H) return false;
      if (d.y + 10 >= PADDLE_Y && d.y - 10 <= PADDLE_Y + PADDLE_H && Math.abs(d.x - paddle.x) < paddle.w / 2 + 10) {
        power(d.kind);
        return false;
      }
      return true;
    });

    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);

    if (!balls.length) {
      lives--;
      updateHud();
      Arcade.tone({ freq: 300, to: 80, dur: 0.4, type: 'sawtooth', vol: 0.06 });
      if (lives <= 0) {
        state = 'over';
        Arcade.finish(ui, { score, lines: [`You reached level ${level}.`], onAction: start });
        return;
      }
      resetBall();
    }

    if (!bricks.length) {
      score += 250 * level;
      level++;
      Arcade.tone({ freq: 523, dur: 0.12, type: 'triangle', vol: 0.06 });
      Arcade.tone({ freq: 784, dur: 0.2, type: 'triangle', vol: 0.06, delay: 0.12 });
      buildLevel();
      updateHud();
    }
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('level').textContent = level;
    $('lives').textContent = lives;
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

  // ---------- Input ----------

  const toX = e => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };
  canvas.parentElement.addEventListener('pointermove', e => { pointerX = toX(e); });
  canvas.addEventListener('pointerdown', e => {
    pointerX = toX(e);
    launch();
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') launch();
    const d = Arcade.DIRS[e.code];
    if (d === 'left' || d === 'right') {
      held[d] = true;
      pointerX = null; // keyboard takes over from the mouse
    }
  });
  window.addEventListener('keyup', e => {
    const d = Arcade.DIRS[e.code];
    if (d === 'left' || d === 'right') held[d] = false;
  });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function draw() {
    ctx.fillStyle = '#12151b';
    ctx.fillRect(0, 0, W, H);

    for (const b of bricks) {
      ctx.fillStyle = HP_COLORS[b.hp - 1];
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, BRICK_W, BRICK_H, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(b.x + 3, b.y + 3, BRICK_W - 6, 3);
    }

    for (const d of drops) {
      const p = POWERS[d.kind];
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(d.x - 14, d.y - 9, 28, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#12151b';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.label, d.x, d.y + 4);
    }

    ctx.fillStyle = time < wideUntil ? '#3ddc84' : '#eceef2';
    ctx.beginPath();
    ctx.roundRect(paddle.x - paddle.w / 2, PADDLE_Y, paddle.w, PADDLE_H, 6);
    ctx.fill();

    ctx.fillStyle = '#ffc53d';
    for (const b of balls) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (state === 'playing' && balls.some(b => b.stuck)) {
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8d94a1';
      ctx.fillText(`Level ${level} · press Space or tap to launch`, W / 2, PADDLE_Y - 40);
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
    score: () => score,
    intro: {
      title: 'Brick Burst',
      html: `<ul>
        <li>Move the paddle to keep the ball in play and break every brick.</li>
        <li>Where the ball hits the paddle decides where it goes.</li>
        <li>Catch power-ups: <b>W</b> wide paddle, <b>M</b> multi-ball, <b>S</b> slow ball, <b>+</b> extra life.</li>
      </ul>`,
      button: 'Start',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
