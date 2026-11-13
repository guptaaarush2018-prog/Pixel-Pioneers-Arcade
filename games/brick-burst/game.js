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
    fire: { label: 'F', color: '#ff8a3d' },
    laser: { label: 'L', color: '#ff5d8f' },
  };
  // Combo: every brick broken before the ball touches the paddle again adds COMBO_STEP to the
  // points multiplier, up to COMBO_MAX.
  const COMBO_STEP = 0.25, COMBO_MAX = 4;
  const BOMB_COLOR = '#e8453c';

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
  let paddle, balls, bricks, drops, score, lives, level, wideUntil, slowUntil, time, held, pointerX;
  let lostLife = false;  // this level, for the flawless achievement
  let combo = 0, fireUntil = 0, laserUntil = 0, bolts = [], boltCd = 0;
  const fx = Gfx.particles(700);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();
  // Only level layouts use Math.random (seeded in duels, so both players get the same walls).
  // Drops and launch angles depend on play, so they use their own rolls.
  const roll = Gfx.rand;
  const comboMult = () => Math.min(COMBO_MAX, 1 + combo * COMBO_STEP);

  function buildLevel() {
    const rows = Math.min(8, 4 + Math.floor(level / 2));
    const pattern = level === 1 ? PATTERNS[0] : PATTERNS[(level - 1) % PATTERNS.length];
    bricks = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!pattern(r, c, rows)) continue;
        // Tougher bricks show up higher on the wall as levels go on.
        const hp = Math.min(4, 1 + Math.floor(Math.max(0, level - 1 - r) / 2) + (r < 2 && level > 2 ? 1 : 0));
        // From level 2, some bricks are bombs: they take out everything around them.
        const bomb = level >= 2 && Math.random() < 0.07;
        bricks.push({ x: SIDE + c * (BRICK_W + GAP), y: TOP + r * (BRICK_H + GAP), hp: bomb ? 1 : hp, max: bomb ? 1 : hp, bomb });
      }
    }
    if (!bricks.length) bricks.push({ x: W / 2 - BRICK_W / 2, y: TOP, hp: 1, max: 1 });
    resetBall();
  }

  function resetBall() {
    balls = [{ x: paddle.x, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, stuck: true }];
    drops = [];
    bolts = [];
    wideUntil = slowUntil = fireUntil = laserUntil = 0;
    combo = 0;
  }

  function reset() {
    paddle = { x: W / 2, w: 90 };
    fx.clear();
    score = 0;
    lives = 3;
    level = 1;
    lostLife = false;
    time = 0;
    held = { left: false, right: false };
    pointerX = null;
    buildLevel();
    updateHud();
  }

  const ballSpeed = () => (380 + level * 22) * (time < slowUntil ? 0.65 : 1);

  function launch() {
    if (state !== 'playing') return;
    if (!balls.some(b => b.stuck)) return fireLaser();
    for (const b of balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const a = roll(-0.35, 0.35);
      b.vx = Math.sin(a) * ballSpeed();
      b.vy = -Math.cos(a) * ballSpeed();
      Arcade.tone({ freq: 440, dur: 0.05, vol: 0.03 });
    }
  }

  function burst(x, y, color, n = 10) {
    fx.burst(n, () => ({
      x: x + roll(-BRICK_W / 3, BRICK_W / 3), y, vx: roll(-170, 170), vy: roll(-200, 80), drag: 1.5, life: roll(0.35, 0.7),
      size: roll(2.5, 5), color: roll() < 0.3 ? '#fff' : color, shape: roll() < 0.6 ? 'square' : 'chip', spin: roll(-10, 10),
    }));
  }

  function fireLaser() {
    if (time >= laserUntil || boltCd > 0) return;
    boltCd = 0.28;
    for (const s of [-1, 1]) bolts.push({ x: paddle.x + s * (paddle.w / 2 - 8), y: PADDLE_Y - 4 });
    Arcade.tone({ freq: 1200, to: 600, dur: 0.06, type: 'square', vol: 0.02 });
  }

  function hitBrick(b, smash = false) {
    if (b.hp <= 0) return;
    b.hp = smash ? 0 : b.hp - 1;
    if (b.hp <= 0) {
      const mult = comboMult();
      const pts = Math.round(25 * level * b.max * mult);
      score += pts;
      combo++;
      if (combo >= 12) Arcade.flag('brick-burst-combo');
      const cx = b.x + BRICK_W / 2, cy = b.y + BRICK_H / 2;
      burst(cx, cy, b.bomb ? BOMB_COLOR : HP_COLORS[b.max - 1]);
      if (combo >= 3) pops.add(`+${pts}`, cx, cy, { size: 13 + Math.min(7, combo / 2), color: mult >= 3 ? '#ff8a3d' : '#ffe066', life: 0.7, rise: 30 });
      if (roll() < 0.12) {
        const kind = roll() < 0.08 ? 'life' : ['wide', 'multi', 'slow', 'fire', 'laser'][Math.floor(roll(0, 5))];
        drops.push({ x: cx, y: cy, kind });
      }
      Arcade.tone({ freq: 660 + Math.min(combo, 16) * 30, dur: 0.05, vol: 0.035 });
      if (b.bomb) explode(b);
    } else {
      score += 10;
      Arcade.tone({ freq: 330, dur: 0.04, vol: 0.03 });
    }
    updateHud();
  }

  // A bomb brick breaks every brick touching it, and those can set off more bombs.
  function explode(b) {
    shake.add(0.35);
    Arcade.flag('brick-burst-bomb');
    const cx = b.x + BRICK_W / 2, cy = b.y + BRICK_H / 2;
    fx.burst(26, () => {
      const a = roll(0, Math.PI * 2), sp = roll(80, 320);
      return { x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 3, life: roll(0.3, 0.6), size: roll(3, 7), grow: -4, color: ['#ffd84d', '#ff8a3d', BOMB_COLOR][Math.floor(roll(0, 3))] };
    });
    Arcade.tone({ freq: 120, to: 40, dur: 0.35, type: 'sawtooth', vol: 0.06 });
    for (const o of bricks) {
      if (o.hp > 0 && Math.abs(o.x - b.x) <= BRICK_W + GAP + 1 && Math.abs(o.y - b.y) <= BRICK_H + GAP + 1) hitBrick(o, true);
    }
  }

  function power(kind) {
    if (kind === 'wide') wideUntil = time + 10;
    if (kind === 'slow') slowUntil = time + 8;
    if (kind === 'fire') fireUntil = time + 7;
    if (kind === 'laser') laserUntil = time + 9;
    pops.add({ wide: 'Wide paddle', slow: 'Slow ball', life: 'Extra life', multi: 'Multi-ball', fire: 'Fireball!', laser: 'Lasers! (Space)' }[kind], paddle.x, PADDLE_Y - 24, { color: POWERS[kind].color, size: 17 });
    if (kind === 'life') lives = Math.min(5, lives + 1);
    if (kind === 'multi') {
      if (balls.length >= 3) Arcade.flag('brick-burst-swarm');
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
      if (combo >= 5) pops.add(`Combo ×${combo}!`, paddle.x, PADDLE_Y - 30, { color: '#ff8a3d', size: 18 });
      combo = 0;
      Arcade.tone({ freq: 260, dur: 0.04, vol: 0.03 });
    }

    for (const br of bricks) {
      if (br.hp <= 0) continue;
      const cx = Math.max(br.x, Math.min(b.x, br.x + BRICK_W));
      const cy = Math.max(br.y, Math.min(b.y, br.y + BRICK_H));
      if ((b.x - cx) ** 2 + (b.y - cy) ** 2 > BALL_R * BALL_R) continue;
      // Bounce off whichever side we overlap least.
      // A fireball smashes straight through.
      if (time < fireUntil) {
        hitBrick(br, true);
        continue;
      }
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
    boltCd = Math.max(0, boltCd - dt);
    for (const bolt of bolts) {
      bolt.y -= 720 * dt;
      const hit = bricks.find(br => br.hp > 0 && bolt.x >= br.x && bolt.x <= br.x + BRICK_W && bolt.y >= br.y && bolt.y <= br.y + BRICK_H);
      if (hit) {
        bolt.y = -99;
        hitBrick(hit);
      }
    }
    bolts = bolts.filter(b => b.y > -20);
    // A trail behind each ball.
    for (const b of balls) {
      if (b.stuck) continue;
      const fire = time < fireUntil;
      fx.emit({ x: b.x, y: b.y, size: fire ? 6 : 4, grow: -10, life: fire ? 0.3 : 0.18, color: fire ? (roll() < 0.5 ? '#ff8a3d' : '#ffd84d') : 'rgba(255,197,61,0.45)' });
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


    if (!balls.length) {
      lives--;
      shake.add(0.5);
      lostLife = true;
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
      if (!lostLife) Arcade.flag('brick-burst-flawless');
      lostLife = false;
      level++;
      if (level >= 5) Arcade.flag('brick-burst-level5');
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

  // Bricks are pre-drawn once per colour: a bevelled block with a glossy top.
  const brickSprites = new Map();
  function brickSprite(color, bomb) {
    const key = color + bomb;
    if (!brickSprites.has(key)) {
      brickSprites.set(key, Gfx.sprite(BRICK_W + 4, BRICK_H + 6, 0, 0, c => {
        c.fillStyle = 'rgba(0,0,0,0.35)';
        Gfx.roundRect(c, 2, 4, BRICK_W, BRICK_H, 4);
        c.fill();
        c.fillStyle = Gfx.shade(color, -0.35);
        Gfx.roundRect(c, 0, 0, BRICK_W, BRICK_H, 4);
        c.fill();
        const g = c.createLinearGradient(0, 0, 0, BRICK_H);
        g.addColorStop(0, Gfx.shade(color, 0.25));
        g.addColorStop(1, color);
        c.fillStyle = g;
        Gfx.roundRect(c, 0, 0, BRICK_W, BRICK_H - 3, 4);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fillRect(4, 3, BRICK_W - 8, 3);
        if (bomb) Gfx.text(c, '✸', BRICK_W / 2, BRICK_H / 2 - 1, { size: 15, color: '#ffd84d', width: 3 });
      }));
    }
    return brickSprites.get(key);
  }

  function draw() {
    const sh = shake.offset(7);
    ctx.save();
    ctx.translate(sh.x, sh.y);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#171b26');
    bg.addColorStop(1, '#0d0f14');
    ctx.fillStyle = bg;
    ctx.fillRect(-10, -10, W + 20, H + 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }

    const t = performance.now() / 1000;
    for (const b of bricks) {
      brickSprite(b.bomb ? BOMB_COLOR : HP_COLORS[b.hp - 1], !!b.bomb).draw(ctx, b.x, b.y);
      if (b.bomb) {
        ctx.fillStyle = `rgba(255,216,77,${0.12 + 0.1 * Math.sin(t * 6 + b.x)})`;
        ctx.fillRect(b.x, b.y, BRICK_W, BRICK_H - 3);
      }
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

    // Paddle: a raised bar, with laser turrets while lasers are on.
    const px = paddle.x - paddle.w / 2;
    const pc = time < laserUntil ? POWERS.laser.color : time < wideUntil ? '#3ddc84' : '#dfe3ea';
    Gfx.shadow(ctx, paddle.x, PADDLE_Y + PADDLE_H + 4, paddle.w / 2 + 6, 5, 0.4);
    ctx.fillStyle = Gfx.shade(pc, -0.4);
    Gfx.roundRect(ctx, px, PADDLE_Y + 2, paddle.w, PADDLE_H, 6);
    ctx.fill();
    const pg = ctx.createLinearGradient(0, PADDLE_Y, 0, PADDLE_Y + PADDLE_H);
    pg.addColorStop(0, Gfx.shade(pc, 0.35));
    pg.addColorStop(1, pc);
    ctx.fillStyle = pg;
    Gfx.roundRect(ctx, px, PADDLE_Y, paddle.w, PADDLE_H - 2, 6);
    ctx.fill();
    if (time < laserUntil) {
      ctx.fillStyle = Gfx.shade(POWERS.laser.color, -0.3);
      for (const s of [-1, 1]) ctx.fillRect(paddle.x + s * (paddle.w / 2 - 8) - 3, PADDLE_Y - 6, 6, 8);
    }
    ctx.fillStyle = '#ff9fbf';
    for (const bolt of bolts) ctx.fillRect(bolt.x - 1.5, bolt.y - 8, 3, 14);

    fx.draw(ctx);
    const fire = time < fireUntil;
    for (const b of balls) {
      ctx.save();
      ctx.shadowColor = fire ? '#ff8a3d' : '#ffc53d';
      ctx.shadowBlur = fire ? 18 : 8;
      const bgr = ctx.createRadialGradient(b.x - 2, b.y - 2, 1, b.x, b.y, BALL_R);
      bgr.addColorStop(0, '#fff6d5');
      bgr.addColorStop(1, fire ? '#ff6a2a' : '#ffc53d');
      ctx.fillStyle = bgr;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    pops.draw(ctx);

    // Combo meter and active power timers.
    if (combo >= 2) Gfx.text(ctx, `Combo ×${combo} · ${comboMult().toFixed(2)}× pts`, W / 2, 40, { size: 15, color: comboMult() >= 3 ? '#ff8a3d' : '#ffe066', width: 3 });
    const timers = [['wide', wideUntil, 10], ['slow', slowUntil, 8], ['fire', fireUntil, 7], ['laser', laserUntil, 9]].filter(([, until]) => time < until);
    timers.forEach(([kind, until, len], i) => {
      const x = 12 + i * 62;
      Gfx.text(ctx, POWERS[kind].label, x + 6, H - 14, { size: 12, color: POWERS[kind].color, width: 3 });
      Gfx.bar(ctx, x + 16, H - 18, 40, 6, (until - time) / len, POWERS[kind].color);
    });

    if (state === 'playing' && balls.some(b => b.stuck)) {
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8d94a1';
      ctx.fillText(`Level ${level} · press Space or tap to launch`, W / 2, PADDLE_Y - 40);
    }
    ctx.restore();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'playing') {
      update(dt);
      fx.update(dt);
      pops.update(dt);
      shake.update(dt);
    }
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
        <li>Catch power-ups: <b>W</b> wide paddle, <b>M</b> multi-ball, <b>S</b> slow ball, <b>F</b> fireball, <b>L</b> lasers (Space to fire), <b>+</b> extra life.</li>
        <li>Break bricks without touching the paddle for a <b>combo</b>: up to ×${COMBO_MAX} points. <b>✸ Bomb bricks</b> blow up their neighbours.</li>
      </ul>`,
      button: 'Start',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
