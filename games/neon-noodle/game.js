(() => {
  const ID = 'neon-noodle';
  const COLS = 24, ROWS = 24, CELL = 20, W = COLS * CELL, H = ROWS * CELL;
  const COMBO_WINDOW = 3000;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $score = document.getElementById('score');
  const $combo = document.getElementById('combo');
  const $best = document.getElementById('best');

  const PELLETS = {
    orb:   { color: '#3ef0ff', points: 10, grow: 1, ttl: Infinity },
    prism: { color: '#ff4fd8', points: 50, grow: 3, ttl: 7000 },
    clock: { color: '#ffd23f', points: 25, grow: 0, ttl: 7000 },
  };

  let state = 'ready';
  let snake, dir, queue, grow, pellets, rocks, particles;
  let score, combo, lastEat, eaten, stepMs, acc, time, phaseUntil, slowUntil, shake;

  function reset() {
    snake = [{ x: 8, y: 12 }, { x: 7, y: 12 }, { x: 6, y: 12 }];
    dir = Arcade.VEC.right;
    queue = [];
    grow = 0;
    pellets = [];
    rocks = [];
    particles = [];
    score = 0;
    combo = 1;
    lastEat = -Infinity;
    eaten = 0;
    stepMs = 130;
    acc = 0;
    time = 0;
    phaseUntil = 0;
    slowUntil = 0;
    shake = 0;
    spawn('orb');
    updateHud();
  }

  const same = (a, b) => a.x === b.x && a.y === b.y;
  const taken = (x, y) =>
    snake.some(s => s.x === x && s.y === y) ||
    rocks.some(r => r.x === x && r.y === y) ||
    pellets.some(p => p.x === x && p.y === y);

  // Random empty cell at least `gap` cells (in wrap-around distance) from the head.
  function freeCell(gap) {
    const head = snake[0];
    for (let i = 0; i < 400; i++) {
      const x = Arcade.randInt(0, COLS - 1), y = Arcade.randInt(0, ROWS - 1);
      const dx = Math.min(Math.abs(x - head.x), COLS - Math.abs(x - head.x));
      const dy = Math.min(Math.abs(y - head.y), ROWS - Math.abs(y - head.y));
      if (dx + dy >= gap && !taken(x, y)) return { x, y };
    }
    return null;
  }

  function spawn(type) {
    const c = freeCell(3);
    if (c) pellets.push({ ...c, type, born: time });
  }

  function addRock() {
    const c = freeCell(6);
    if (c) rocks.push(c);
  }

  function turn(name) {
    const v = Arcade.VEC[name];
    const last = queue.length ? queue[queue.length - 1] : dir;
    if (queue.length >= 2 || same(v, last) || (v.x === -last.x && v.y === -last.y)) return;
    queue.push(v);
  }

  function step() {
    if (queue.length) dir = queue.shift();
    const head = snake[0];
    const next = { x: (head.x + dir.x + COLS) % COLS, y: (head.y + dir.y + ROWS) % ROWS };

    // The tail moves out of the way this step unless we're growing.
    const body = grow > 0 ? snake : snake.slice(0, -1);
    const phasing = time < phaseUntil;
    if (rocks.some(r => same(r, next)) || (!phasing && body.some(s => same(s, next)))) {
      die();
      return;
    }

    snake.unshift(next);
    if (grow > 0) grow--;
    else snake.pop();

    const hit = pellets.findIndex(p => same(p, next));
    if (hit >= 0) eat(pellets.splice(hit, 1)[0]);
  }

  function eat(p) {
    const kind = PELLETS[p.type];
    combo = time - lastEat < COMBO_WINDOW ? Math.min(5, combo + 1) : 1;
    lastEat = time;
    score += kind.points * combo;
    grow += kind.grow;
    burst(p.x, p.y, kind.color, 14);

    if (p.type === 'orb') {
      eaten++;
      spawn('orb');
      if (eaten % 5 === 0) spawn(Arcade.pick(['prism', 'clock']));
      if (eaten % 8 === 0) {
        addRock();
        stepMs = Math.max(62, stepMs - 7);
      }
      Arcade.tone({ freq: 520 + combo * 90, to: 880 + combo * 90, dur: 0.07 });
    } else if (p.type === 'prism') {
      phaseUntil = time + 5000;
      Arcade.tone({ freq: 400, to: 1400, dur: 0.25, type: 'triangle', vol: 0.07 });
    } else {
      slowUntil = time + 5000;
      Arcade.tone({ freq: 900, to: 300, dur: 0.3, type: 'triangle', vol: 0.07 });
    }
    updateHud();
  }

  function burst(cx, cy, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Arcade.rand(40, 160);
      particles.push({
        x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: Arcade.rand(0.3, 0.7), color,
      });
    }
  }

  function updateHud() {
    $score.textContent = score;
    $combo.textContent = 'x' + combo;
    $best.textContent = Math.max(score, Arcade.getBest(ID));
  }

  function die() {
    state = 'over';
    shake = 12;
    for (const s of snake) burst(s.x, s.y, '#ff4fd8', 3);
    Arcade.tone({ freq: 300, to: 60, dur: 0.5, type: 'sawtooth', vol: 0.06 });
    Arcade.finish(ui, {
      score,
      lines: [`Length ${snake.length} · ${eaten} orbs`],
      onAction: start,
    });
    updateHud();
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

  function showIntro() {
    ui.show({
      title: 'Neon Noodle',
      html: `<ul>
        <li><b style="color:#3ef0ff">Orbs</b> grow you. Eat them quickly to build a combo up to x5.</li>
        <li><b style="color:#ff4fd8">Prisms</b> let you pass through your own body for 5 seconds.</li>
        <li><b style="color:#ffd23f">Clocks</b> slow time for 5 seconds.</li>
        <li>The edges wrap around, but rocks appear as you grow. Don't hit them.</li>
      </ul>`,
      button: 'Play',
      onAction: start,
    });
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    const d = Arcade.DIRS[e.code];
    if (d && state === 'playing') turn(d);
  });
  Arcade.onSwipe(canvas.parentElement, d => { if (state === 'playing') turn(d); });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  function drawPellet(p) {
    const kind = PELLETS[p.type];
    const cx = (p.x + 0.5) * CELL, cy = (p.y + 0.5) * CELL;
    const age = time - p.born;
    if (kind.ttl - age < 2000 && Math.floor(age / 120) % 2) return; // blink before expiring
    const pulse = 1 + Math.sin(time / 180 + p.x) * 0.12;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = kind.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = kind.color;
    if (p.type === 'orb') {
      ctx.beginPath();
      ctx.arc(0, 0, 5.5 * pulse, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'prism') {
      ctx.rotate(time / 400);
      ctx.beginPath();
      ctx.moveTo(0, -8 * pulse); ctx.lineTo(7 * pulse, 0); ctx.lineTo(0, 8 * pulse); ctx.lineTo(-7 * pulse, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 7.5 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#1a1300';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, -5);
      ctx.moveTo(0, 0); ctx.lineTo(Math.cos(time / 300) * 4, Math.sin(time / 300) * 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(Arcade.rand(-shake, shake), Arcade.rand(-shake, shake));

    ctx.fillStyle = '#0b0a1a';
    ctx.fillRect(-20, -20, W + 40, H + 40);

    ctx.fillStyle = '#1d1a3d';
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) ctx.fillRect(x * CELL + CELL / 2 - 1, y * CELL + CELL / 2 - 1, 2, 2);

    // Glowing edges hint that the walls wrap around.
    const edge = 0.25 + Math.sin(time / 500) * 0.1;
    ctx.strokeStyle = `rgba(62, 240, 255, ${edge})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.setLineDash([]);

    for (const r of rocks) {
      ctx.fillStyle = '#3b3566';
      roundRect(r.x * CELL + 1, r.y * CELL + 1, CELL - 2, CELL - 2, 4);
      ctx.fillStyle = '#5a528f';
      roundRect(r.x * CELL + 3, r.y * CELL + 3, CELL - 8, 5, 2);
    }

    for (const p of pellets) drawPellet(p);

    if (state !== 'ready') drawSnake();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 1.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (time < slowUntil && state === 'playing') {
      ctx.fillStyle = 'rgba(255, 210, 63, 0.06)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function drawSnake() {
    const phasing = time < phaseUntil;
    const fading = phasing && phaseUntil - time < 1200 && Math.floor(time / 100) % 2;
    ctx.globalAlpha = phasing && !fading ? 0.55 : 1;
    const n = snake.length;
    for (let i = n - 1; i >= 0; i--) {
      const s = snake[i];
      const t = i / Math.max(1, n - 1);
      const hue = Math.min(i * 7, 120);
      ctx.fillStyle = phasing ? `hsl(${300 + hue / 3}, 100%, ${65 - t * 20}%)` : `hsl(${180 + hue}, 100%, ${62 - t * 18}%)`;
      const inset = 1 + t * 2;
      roundRect(s.x * CELL + inset, s.y * CELL + inset, CELL - inset * 2, CELL - inset * 2, 6);
    }
    ctx.globalAlpha = 1;

    // Eyes look where we're heading.
    const h = snake[0];
    const cx = (h.x + 0.5) * CELL, cy = (h.y + 0.5) * CELL;
    const px = -dir.y, py = dir.x;
    for (const side of [-1, 1]) {
      const ex = cx + dir.x * 3 + px * side * 4.5, ey = cy + dir.y * 3 + py * side * 4.5;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0b0a1a';
      ctx.beginPath(); ctx.arc(ex + dir.x * 1.2, ey + dir.y * 1.2, 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last);
    last = now;

    if (state === 'playing') {
      time += dt;
      acc += dt;
      const interval = stepMs * (time < slowUntil ? 1.7 : 1);
      while (acc >= interval && state === 'playing') {
        acc -= interval;
        step();
      }
      pellets = pellets.filter(p => time - p.born < PELLETS[p.type].ttl);
      if (!pellets.some(p => p.type === 'orb')) spawn('orb');
      if (combo > 1 && time - lastEat > COMBO_WINDOW) {
        combo = 1;
        updateHud();
      }
    }

    for (const p of particles) {
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life -= dt / 1000;
    }
    particles = particles.filter(p => p.life > 0);
    shake = Math.max(0, shake - dt * 0.03);

    draw();
    requestAnimationFrame(frame);
  }

  reset();
  showIntro();
  requestAnimationFrame(frame);
})();
