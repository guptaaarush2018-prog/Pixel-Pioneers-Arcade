(() => {
  const ID = 'neon-noodle';
  const COLS = 24, ROWS = 24, CELL = 20, W = COLS * CELL, H = ROWS * CELL;
  const COMBO_WINDOW = 3000;
  // Combos run to x8; from FEVER up the noodle glows gold and every orb grows you one less.
  const COMBO_MAX = 8, FEVER = 6;
  const MAGNET_RANGE = 3;

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
    magnet: { color: '#ff8a3d', points: 25, grow: 0, ttl: 7000 },
    frenzy: { color: '#9dff6a', points: 25, grow: 0, ttl: 7000 },
    shatter: { color: '#ff5d5d', points: 25, grow: 0, ttl: 7000 },
    gold: { color: '#ffe066', points: 20, grow: 1, ttl: 6000 },
  };
  const LABEL = { prism: 'Ghost!', clock: 'Slow-mo!', magnet: 'Magnet!', frenzy: 'Feeding frenzy!', shatter: 'Rocks shattered!' };
  const fx = Gfx.particles(500);
  const pops = Gfx.floaters();
  const shaker = Gfx.shaker();

  let state = 'ready';
  let snake, dir, queue, grow, pellets, rocks;
  let score, combo, lastEat, eaten, stepMs, acc, time, phaseUntil, slowUntil, magnetUntil, shake;

  function reset() {
    snake = [{ x: 8, y: 12 }, { x: 7, y: 12 }, { x: 6, y: 12 }];
    dir = Arcade.VEC.right;
    queue = [];
    grow = 0;
    pellets = [];
    rocks = [];
    score = 0;
    combo = 1;
    lastEat = -Infinity;
    eaten = 0;
    stepMs = 130;
    acc = 0;
    time = 0;
    phaseUntil = 0;
    slowUntil = 0;
    magnetUntil = 0;
    shake = 0;
    fx.clear();
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
    // Magnet: orbs within range fly into your mouth.
    if (time < magnetUntil && state === 'playing') {
      for (const p of pellets.filter(p => (p.type === 'orb' || p.type === 'gold') && wrapDist(p, next) <= MAGNET_RANGE)) {
        pellets.splice(pellets.indexOf(p), 1);
        fx.burst(8, k => ({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL, vx: ((next.x - p.x) * CELL) * 3 + Gfx.rand(-30, 30), vy: ((next.y - p.y) * CELL) * 3 + Gfx.rand(-30, 30), drag: 4, life: 0.3, size: 2.5, color: PELLETS.magnet.color }));
        eat(p);
      }
    }
  }

  const wrapDist = (a, b) => Math.min(Math.abs(a.x - b.x), COLS - Math.abs(a.x - b.x)) + Math.min(Math.abs(a.y - b.y), ROWS - Math.abs(a.y - b.y));

  function eat(p) {
    const kind = PELLETS[p.type];
    combo = time - lastEat < COMBO_WINDOW ? Math.min(COMBO_MAX, combo + 1) : 1;
    lastEat = time;
    const pts = kind.points * combo;
    score += pts;
    // Fever trims growth so long combos don't fill the board as fast.
    grow += combo >= FEVER ? Math.max(0, kind.grow - 1) : kind.grow;
    burst(p.x, p.y, kind.color, combo >= FEVER ? 22 : 14);
    pops.add(`+${pts}`, (p.x + 0.5) * CELL, p.y * CELL, { size: 12 + combo, color: combo >= FEVER ? '#ffe066' : kind.color, life: 0.7, rise: 28 });
    if (combo === FEVER) {
      pops.add('FEVER!', W / 2, H / 2 - 40, { size: 34, color: '#ffe066', life: 1.1 });
      shaker.add(0.3);
    }

    if (combo >= 5) Arcade.flag('neon-noodle-combo');
    if (combo >= COMBO_MAX) Arcade.flag('neon-noodle-fever');
    if (snake.length >= 40) Arcade.flag('neon-noodle-long');
    if (p.type === 'orb') {
      eaten++;
      spawn('orb');
      if (eaten % 5 === 0) spawn(Arcade.pick(rocks.length >= 2 ? ['prism', 'clock', 'magnet', 'frenzy', 'shatter'] : ['prism', 'clock', 'magnet', 'frenzy']));
      if (eaten % 8 === 0) {
        addRock();
        stepMs = Math.max(62, stepMs - 7);
      }
      Arcade.tone({ freq: 520 + combo * 90, to: 880 + combo * 90, dur: 0.07 });
    } else if (p.type === 'gold') {
      Arcade.tone({ freq: 700 + combo * 80, to: 1100 + combo * 80, dur: 0.07, type: 'triangle' });
    } else {
      pops.add(LABEL[p.type], W / 2, H / 2, { size: 26, color: kind.color, life: 1 });
      if (p.type === 'prism') {
        phaseUntil = time + 5000;
        Arcade.tone({ freq: 400, to: 1400, dur: 0.25, type: 'triangle', vol: 0.07 });
      } else if (p.type === 'clock') {
        slowUntil = time + 5000;
        Arcade.tone({ freq: 900, to: 300, dur: 0.3, type: 'triangle', vol: 0.07 });
      } else if (p.type === 'magnet') {
        magnetUntil = time + 6000;
        Arcade.tone({ freq: 300, to: 900, dur: 0.3, type: 'square', vol: 0.04 });
      } else if (p.type === 'frenzy') {
        for (let k = 0; k < 5; k++) spawn('gold');
        Arcade.tone({ freq: 600, to: 1500, dur: 0.35, type: 'triangle', vol: 0.06 });
      } else if (p.type === 'shatter') {
        // Breaks every rock within 6 cells, or the nearest one if none are that close.
        const near = rocks.filter(r => wrapDist(r, snake[0]) <= 6);
        const gone = near.length ? near : rocks.slice().sort((a, b) => wrapDist(a, snake[0]) - wrapDist(b, snake[0])).slice(0, 1);
        for (const r of gone) {
          rocks.splice(rocks.indexOf(r), 1);
          burst(r.x, r.y, '#8a80d0', 18);
          score += 30;
        }
        shaker.add(0.45);
        if (gone.length) Arcade.flag('neon-noodle-shatter');
        Arcade.tone({ freq: 160, to: 50, dur: 0.4, type: 'sawtooth', vol: 0.06 });
      }
    }
    updateHud();
  }

  // Cosmetic, so it uses Gfx.rand and leaves the seeded Math.random alone.
  function burst(cx, cy, color, n) {
    fx.burst(n, () => {
      const a = Gfx.rand(0, Math.PI * 2), sp = Gfx.rand(40, 170);
      return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 3, life: Gfx.rand(0.3, 0.7), size: Gfx.rand(1.8, 3.2), color, shape: Gfx.rand() < 0.5 ? 'square' : 'circle' };
    });
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
    Versus.attach({
      ui,
      start,
      score: () => score,
      intro: {
        title: 'Neon Noodle',
        html: `<ul>
          <li><b style="color:#3ef0ff">Orbs</b> grow you. Eat them quickly to build a combo up to x${COMBO_MAX}. From x${FEVER} you're in <b style="color:#ffe066">fever</b>.</li>
          <li><b style="color:#ff8a3d">Magnets</b> pull in nearby orbs, <b style="color:#9dff6a">frenzy</b> scatters gold orbs, and <b style="color:#ff5d5d">shatter</b> smashes nearby rocks.</li>
          <li><b style="color:#ff4fd8">Prisms</b> let you pass through your own body for 5 seconds.</li>
          <li><b style="color:#ffd23f">Clocks</b> slow time for 5 seconds.</li>
          <li>The edges wrap around, but rocks appear as you grow. Don't hit them.</li>
        </ul>`,
        button: 'Play',
        onAction: start,
      },
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
    if (p.type === 'orb' || p.type === 'gold') {
      ctx.beginPath();
      ctx.arc(0, 0, (p.type === 'gold' ? 6.5 : 5.5) * pulse, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'magnet') {
      ctx.shadowBlur = 10;
      ctx.lineWidth = 4;
      ctx.strokeStyle = kind.color;
      ctx.beginPath();
      ctx.arc(0, 1, 6 * pulse, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-8 * pulse, 0, 4, 5);
      ctx.fillRect(4 * pulse, 0, 4, 5);
    } else if (p.type === 'frenzy') {
      ctx.rotate(time / 300);
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.arc(Math.cos(k * 1.2566) * 5 * pulse, Math.sin(k * 1.2566) * 5 * pulse, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.type === 'shatter') {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = (k % 2 ? 3.5 : 8.5) * pulse, a = (k / 10) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
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
    if (shake > 0) ctx.translate(Gfx.rand(-shake, shake), Gfx.rand(-shake, shake));
    const so = shaker.offset(7);
    ctx.translate(so.x, so.y);

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

    fx.draw(ctx);
    pops.draw(ctx);

    if (time < magnetUntil && state === 'playing') {
      const h = snake[0];
      ctx.strokeStyle = `rgba(255,138,61,${0.25 + 0.15 * Math.sin(time / 90)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc((h.x + 0.5) * CELL, (h.y + 0.5) * CELL, (MAGNET_RANGE + 0.5) * CELL, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Combo meter: how long until the combo drops.
    if (state === 'playing' && combo > 1) {
      const left = Math.max(0, 1 - (time - lastEat) / COMBO_WINDOW);
      Gfx.text(ctx, `x${combo}${combo >= FEVER ? ' FEVER' : ''}`, W / 2, 16, { size: 15, color: combo >= FEVER ? '#ffe066' : '#3ef0ff', width: 3 });
      Gfx.bar(ctx, W / 2 - 50, 28, 100, 5, left, combo >= FEVER ? '#ffe066' : '#3ef0ff');
    }
    const timers = [['Ghost', phaseUntil, 5000, PELLETS.prism.color], ['Slow', slowUntil, 5000, PELLETS.clock.color], ['Magnet', magnetUntil, 6000, PELLETS.magnet.color]].filter(([, u]) => time < u);
    timers.forEach(([label, until, len, color], i) => {
      Gfx.text(ctx, label, 10, H - 14 - i * 16, { size: 11, color, align: 'left', width: 3 });
      Gfx.bar(ctx, 60, H - 17 - i * 16, 60, 5, (until - time) / len, color);
    });

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
      const fever = combo >= FEVER && state === 'playing';
      ctx.fillStyle = phasing ? `hsl(${300 + hue / 3}, 100%, ${65 - t * 20}%)` : fever ? `hsl(${45 + Math.sin(time / 120 + i * 0.5) * 12}, 100%, ${62 - t * 18}%)` : `hsl(${180 + hue}, 100%, ${62 - t * 18}%)`;
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

    if (state !== 'paused') {
      fx.update(dt / 1000);
      pops.update(dt / 1000);
      shaker.update(dt / 1000);
    }
    shake = Math.max(0, shake - dt * 0.03);

    draw();
    requestAnimationFrame(frame);
  }

  reset();
  showIntro();
  requestAnimationFrame(frame);
})();
