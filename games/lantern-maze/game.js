(() => {
  const ID = 'lantern-maze';
  const COLS = 21, ROWS = 15, T = 32, W = COLS * T, H = ROWS * T;
  const START = { x: 1, y: ROWS - 2 };
  const EXIT = { x: COLS - 2, y: 1 };
  const LAIR = { x: 9, y: 7 };
  const DIRV = Object.values(Arcade.VEC);
  const STOP = { x: 0, y: 0 };
  const FLASH_COST = 25, FLASH_RANGE = 4.5, STUN_TIME = 3;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const mazeLayer = Arcade.makeLayer(W, H);
  const fog = Arcade.makeLayer(W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'ready';
  let grid, distMap, distFrom;
  let player, want, shadows, sparks, flasks, particles;
  let score, level, lives, fuel, time, flashT, chain, freezeUntil, invulnUntil, banner, nextBeat;

  // ---------- Maze ----------

  const open = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && grid[y][x] === 0;
  const key = (x, y) => y * COLS + x;

  function makeMaze() {
    const g = Array.from({ length: ROWS }, () => Array(COLS).fill(1));
    const stack = [[1, 1]];
    g[1][1] = 0;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const options = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx > 0 && ny > 0 && nx < COLS - 1 && ny < ROWS - 1 && g[ny][nx] === 1;
      });
      if (!options.length) { stack.pop(); continue; }
      const [dx, dy] = Arcade.pick(options);
      g[y + dy / 2][x + dx / 2] = 0;
      g[y + dy][x + dx] = 0;
      stack.push([x + dx, y + dy]);
    }
    // A perfect maze is a death trap in a chase game, so knock out some walls to add loops.
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (g[y][x] !== 1) continue;
        const horiz = !g[y][x - 1] && !g[y][x + 1] && g[y - 1][x] && g[y + 1][x];
        const vert = !g[y - 1][x] && !g[y + 1][x] && g[y][x - 1] && g[y][x + 1];
        if ((horiz || vert) && Math.random() < 0.24) g[y][x] = 0;
      }
    }
    return g;
  }

  // Distance (in steps) from the player to every tile; shadows use it to hunt.
  function bfs(sx, sy) {
    const d = new Array(COLS * ROWS).fill(Infinity);
    d[key(sx, sy)] = 0;
    const q = [[sx, sy]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (const v of DIRV) {
        const nx = x + v.x, ny = y + v.y;
        if (open(nx, ny) && d[key(nx, ny)] === Infinity) {
          d[key(nx, ny)] = d[key(x, y)] + 1;
          q.push([nx, ny]);
        }
      }
    }
    return d;
  }

  function renderMaze() {
    const c = mazeLayer.ctx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#100d26';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#16123a';
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (!grid[y][x] && (x + y) % 2) c.fillRect(x * T, y * T, T, T);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!grid[y][x]) continue;
        c.fillStyle = '#2b2466';
        c.fillRect(x * T, y * T, T, T);
        c.fillStyle = '#4a3f9c';
        if (!open(x, y - 1) && y > 0) continue;
        c.fillRect(x * T, y * T, T, 5);
      }
    }
  }

  // ---------- Setup ----------

  function mover(tile, speed) {
    return { tx: tile.x, ty: tile.y, dir: STOP, prog: 0, speed };
  }
  const pos = m => ({ x: m.tx + m.dir.x * m.prog, y: m.ty + m.dir.y * m.prog });

  function freeTiles() {
    const tiles = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (open(x, y) && Math.abs(x - START.x) + Math.abs(y - START.y) > 1 && !(x === EXIT.x && y === EXIT.y) && !(x === LAIR.x && y === LAIR.y))
          tiles.push({ x, y });
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    return tiles;
  }

  function placeActors() {
    player = mover(START, 5.2);
    want = null;
    const speed = Math.min(4.7, 3.3 + level * 0.18);
    shadows = shadows.map((s, i) => ({
      ...mover(LAIR, s.hunter ? speed * 0.82 : speed),
      hunter: s.hunter,
      releaseAt: time + 1 + i * 1.6,
      stunUntil: 0,
      gone: false,
    }));
    distFrom = null;
  }

  function buildLevel() {
    grid = makeMaze();
    renderMaze();
    const tiles = freeTiles();
    sparks = new Set(tiles.slice(0, Math.min(tiles.length - 3, 28 + level * 6)).map(t => key(t.x, t.y)));
    flasks = tiles.slice(-3);
    const count = Math.min(6, 2 + level);
    shadows = Array.from({ length: count }, (_, i) => ({ hunter: i === 0 }));
    fuel = 100;
    placeActors();
    banner = { text: `Level ${level}`, until: time + 2 };
  }

  function reset() {
    score = 0;
    level = 1;
    lives = 3;
    time = 0;
    flashT = 0;
    chain = 1;
    freezeUntil = 0;
    invulnUntil = 0;
    nextBeat = 0;
    particles = [];
    buildLevel();
    updateHud();
  }

  // ---------- Movement ----------

  // Moves a mover along the grid, asking `choose` for a new direction at each tile center.
  function advance(m, dt, choose) {
    let move = m.speed * dt;
    if (m.dir === STOP) {
      const d = choose(m);
      if (!d) return;
      m.dir = d;
    }
    while (move > 0) {
      const need = 1 - m.prog;
      if (move < need) { m.prog += move; return; }
      move -= need;
      m.tx += m.dir.x;
      m.ty += m.dir.y;
      m.prog = 0;
      onTile(m);
      const d = choose(m);
      if (!d) { m.dir = STOP; return; }
      m.dir = d;
    }
  }

  function choosePlayer(m) {
    if (want && open(m.tx + want.x, m.ty + want.y)) return want;
    if (m.dir !== STOP && open(m.tx + m.dir.x, m.ty + m.dir.y)) return m.dir;
    return null;
  }

  function chooseShadow(s) {
    let options = DIRV.filter(v => open(s.tx + v.x, s.ty + v.y) && !(v.x === -s.dir.x && v.y === -s.dir.y));
    if (!options.length) options = DIRV.filter(v => open(s.tx + v.x, s.ty + v.y));
    const here = distMap[key(s.tx, s.ty)];
    const senses = s.hunter || here <= 7 + level;
    if (senses && Math.random() > 0.18) {
      return options.reduce((best, v) =>
        distMap[key(s.tx + v.x, s.ty + v.y)] < distMap[key(s.tx + best.x, s.ty + best.y)] ? v : best);
    }
    return Arcade.pick(options);
  }

  function onTile(m) {
    if (m !== player) return;
    const k = key(m.tx, m.ty);
    if (sparks.has(k)) {
      sparks.delete(k);
      score += 10;
      fuel = Math.min(100, fuel + 1.5);
      Arcade.tone({ freq: 880 + Math.random() * 200, dur: 0.04, vol: 0.03 });
      if (!sparks.size) {
        banner = { text: 'Exit open!', until: time + 2 };
        Arcade.tone({ freq: 500, to: 1000, dur: 0.3, type: 'triangle', vol: 0.06 });
      }
      updateHud();
    }
    const f = flasks.findIndex(t => t.x === m.tx && t.y === m.ty);
    if (f >= 0) {
      flasks.splice(f, 1);
      fuel = Math.min(100, fuel + 35);
      score += 50;
      burst(m.tx, m.ty, '#ffb347', 16);
      Arcade.tone({ freq: 300, to: 700, dur: 0.18, type: 'triangle', vol: 0.06 });
      updateHud();
    }
    if (!sparks.size && m.tx === EXIT.x && m.ty === EXIT.y) nextLevel();
  }

  function nextLevel() {
    score += 500 * level + Math.floor(fuel) * 5;
    level++;
    Arcade.tone({ freq: 523, dur: 0.12, type: 'triangle', vol: 0.07 });
    Arcade.tone({ freq: 659, dur: 0.12, type: 'triangle', vol: 0.07, delay: 0.12 });
    Arcade.tone({ freq: 784, dur: 0.2, type: 'triangle', vol: 0.07, delay: 0.24 });
    buildLevel();
    updateHud();
  }

  function flash() {
    if (state !== 'playing' || time < freezeUntil || fuel < FLASH_COST) return;
    fuel -= FLASH_COST;
    flashT = 0.35;
    chain = 1;
    const p = pos(player);
    for (const s of shadows) {
      if (s.gone) continue;
      const q = pos(s);
      if (Math.hypot(q.x - p.x, q.y - p.y) <= FLASH_RANGE) s.stunUntil = time + STUN_TIME;
    }
    Arcade.tone({ freq: 1200, to: 200, dur: 0.25, type: 'sawtooth', vol: 0.05 });
  }

  function loseLife() {
    lives--;
    freezeUntil = time + 1.2;
    burst(pos(player).x, pos(player).y, '#ffb347', 30);
    Arcade.tone({ freq: 400, to: 50, dur: 0.6, type: 'sawtooth', vol: 0.07 });
    updateHud();
    if (lives <= 0) {
      state = 'over';
      Arcade.finish(ui, {
        score,
        title: 'Lights Out',
        lines: [`You reached level ${level}.`],
        button: 'Try again',
        onAction: start,
      });
    }
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Arcade.rand(30, 150);
      particles.push({ x: (x + 0.5) * T, y: (y + 0.5) * T, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: Arcade.rand(0.4, 0.9), color });
    }
  }

  function update(dt) {
    time += dt;
    flashT = Math.max(0, flashT - dt);

    if (time < freezeUntil) return;
    if (freezeUntil && lives > 0) {
      freezeUntil = 0;
      placeActors();
      invulnUntil = time + 2;
    }

    fuel = Math.max(0, fuel - (1.8 + level * 0.25) * dt);

    // Instant turn-around feels much better than waiting for the next tile.
    if (want && player.dir !== STOP && want.x === -player.dir.x && want.y === -player.dir.y) {
      player.tx += player.dir.x;
      player.ty += player.dir.y;
      player.prog = 1 - player.prog;
      player.dir = want;
    }
    advance(player, dt, choosePlayer);
    if (state !== 'playing') return;

    const pk = key(player.tx, player.ty);
    if (distFrom !== pk) {
      distMap = bfs(player.tx, player.ty);
      distFrom = pk;
    }

    const p = pos(player);
    let nearest = Infinity;
    for (const s of shadows) {
      if (s.gone) {
        if (time >= s.releaseAt) Object.assign(s, mover(LAIR, s.speed), { gone: false, stunUntil: 0 });
        continue;
      }
      if (time >= s.releaseAt && time >= s.stunUntil) advance(s, dt, chooseShadow);
      const q = pos(s);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      nearest = Math.min(nearest, d);
      if (d < 0.6) {
        if (time < s.stunUntil) {
          score += 200 * chain;
          chain *= 2;
          s.gone = true;
          s.releaseAt = time + 4;
          burst(q.x, q.y, '#9fd8ff', 20);
          Arcade.tone({ freq: 600, to: 1600, dur: 0.2, type: 'triangle', vol: 0.07 });
          updateHud();
        } else if (time >= invulnUntil) {
          loseLife();
          return;
        }
      }
    }

    // Heartbeat speeds up as a shadow closes in.
    if (nearest < 5 && time >= nextBeat) {
      Arcade.tone({ freq: 70, to: 40, dur: 0.12, type: 'sine', vol: 0.12 });
      nextBeat = time + 0.25 + nearest * 0.12;
    }
  }

  // ---------- Input ----------

  function setWant(name) {
    if (state === 'playing') want = Arcade.VEC[name];
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (e.code === 'Space') { flash(); return; }
    const d = Arcade.DIRS[e.code];
    if (d) setWant(d);
  });
  Arcade.onSwipe(canvas.parentElement, setWant, flash);
  $('flash').addEventListener('pointerdown', e => { e.preventDefault(); flash(); });
  Arcade.onBlur(() => pause());

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

  function updateHud() {
    $('score').textContent = score;
    $('level').textContent = level;
    $('lives').textContent = Math.max(0, lives);
    $('best').textContent = Math.max(score, Arcade.getBest(ID));
  }

  // ---------- Drawing ----------

  function lightRadius() {
    return T * (1.6 + (fuel / 100) * 3.4) + Math.sin(time * 18) * 1.5 + flashT * T * 10;
  }

  function drawShadowBody(s) {
    const q = pos(s);
    const cx = (q.x + 0.5) * T, cy = (q.y + 0.5) * T;
    const stunned = time < s.stunUntil;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, T * 0.55);
    g.addColorStop(0, stunned ? '#cfe9ff' : '#5b1a6e');
    g.addColorStop(1, stunned ? 'rgba(160,210,255,0)' : 'rgba(30,5,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = T * (0.42 + Math.sin(time * 6 + i * 1.7 + s.tx) * 0.07);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.fill();
  }

  function drawShadowEyes(s) {
    const q = pos(s);
    const cx = (q.x + 0.5) * T, cy = (q.y + 0.5) * T;
    const stunned = time < s.stunUntil;
    if (stunned && s.stunUntil - time < 0.8 && Math.floor(time * 10) % 2) return;
    ctx.fillStyle = stunned ? '#7fd0ff' : s.hunter ? '#ff3355' : '#ff7a3d';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8;
    const look = s.dir;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * 5 + look.x * 3, cy - 2 + look.y * 3, 2.6, stunned ? 1.2 : 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function draw() {
    ctx.drawImage(mazeLayer.canvas, 0, 0, W, H);

    const exitOpen = !sparks.size;
    const ex = EXIT.x * T, ey = EXIT.y * T;
    ctx.fillStyle = exitOpen ? '#5dff9b' : '#3a3470';
    ctx.fillRect(ex + 6, ey + 4, T - 12, T - 6);
    ctx.fillStyle = exitOpen ? '#0b3a22' : '#1b1640';
    ctx.fillRect(ex + 10, ey + 8, T - 20, T - 10);

    for (const s of shadows) if (!s.gone && time >= s.releaseAt - 0.5) drawShadowBody(s);

    // Darkness with a hole cut out around the lantern.
    const p = pos(player);
    const px = (p.x + 0.5) * T, py = (p.y + 0.5) * T;
    const r = Math.max(10, lightRadius());
    const f = fog.ctx;
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, W, H);
    f.fillStyle = 'rgba(4, 3, 12, 0.93)';
    f.fillRect(0, 0, W, H);
    f.globalCompositeOperation = 'destination-out';
    const g = f.createRadialGradient(px, py, r * 0.15, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g;
    f.beginPath();
    f.arc(px, py, r, 0, Math.PI * 2);
    f.fill();
    ctx.drawImage(fog.canvas, 0, 0, W, H);

    const warm = ctx.createRadialGradient(px, py, 0, px, py, r);
    warm.addColorStop(0, 'rgba(255, 170, 70, 0.16)');
    warm.addColorStop(1, 'rgba(255, 170, 70, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, W, H);

    // Sparks twinkle faintly in the dark so you can plan a route.
    for (const k of sparks) {
      const x = k % COLS, y = (k / COLS) | 0;
      const cx = (x + 0.5) * T, cy = (y + 0.5) * T;
      const lit = Math.hypot(cx - px, cy - py) < r * 0.8;
      ctx.globalAlpha = lit ? 1 : 0.3 + Math.sin(time * 3 + k) * 0.15;
      ctx.fillStyle = '#ffe28a';
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    for (const t of flasks) {
      const cx = (t.x + 0.5) * T, cy = (t.y + 0.5) * T + Math.sin(time * 3 + t.x) * 2;
      ctx.fillStyle = '#ffb347';
      ctx.shadowColor = '#ffb347';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.roundRect(cx - 5, cy - 4, 10, 11, 3);
      ctx.fill();
      ctx.fillRect(cx - 2, cy - 8, 4, 4);
      ctx.shadowBlur = 0;
    }

    if (exitOpen) {
      ctx.strokeStyle = `rgba(93, 255, 155, ${0.5 + Math.sin(time * 5) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(ex + 3, ey + 2, T - 6, T - 2);
    }

    for (const s of shadows) if (!s.gone && time >= s.releaseAt - 0.5) drawShadowEyes(s);

    if (time >= freezeUntil || !freezeUntil) drawPlayer(px, py);

    for (const q of particles) {
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (flashT > 0) {
      ctx.fillStyle = `rgba(255, 240, 200, ${flashT * 0.8})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawFuelBar();

    if (banner && time < banner.until) {
      ctx.globalAlpha = Math.min(1, (banner.until - time) * 2);
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe28a';
      ctx.fillText(banner.text, W / 2, H / 2 - 40);
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayer(px, py) {
    if (time < invulnUntil && Math.floor(time * 12) % 2) return;
    ctx.fillStyle = '#ffd9a8';
    ctx.beginPath();
    ctx.arc(px, py + 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a1a';
    ctx.fillRect(px - 4, py - 1, 2, 3);
    ctx.fillRect(px + 2, py - 1, 2, 3);
    // Lantern bobbing at the side.
    const lx = px + 10, ly = py + 4 + Math.sin(time * 8) * 1.2;
    ctx.fillStyle = '#ffb347';
    ctx.shadowColor = '#ffb347';
    ctx.shadowBlur = 14;
    ctx.fillRect(lx - 3, ly - 3, 6, 7);
    ctx.shadowBlur = 0;
  }

  function drawFuelBar() {
    const x = 10, y = H - 18, w = 140, h = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = fuel < FLASH_COST ? '#ff5b5b' : '#ffb347';
    ctx.fillRect(x, y, (w * fuel) / 100, h);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x + (w * FLASH_COST) / 100, y - 2, 1, h + 4);
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#cfc8ff';
    ctx.fillText('LANTERN', x + w + 8, y + 7);
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    for (const q of particles) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.94;
      q.vy *= 0.94;
      q.life -= dt;
    }
    particles = particles.filter(q => q.life > 0);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  ui.show({
    title: 'Lantern Maze',
    html: `<ul>
      <li>Collect every <b style="color:#ffe28a">spark</b> to open the <b style="color:#5dff9b">exit</b>, then reach it.</li>
      <li>Your lantern burns down over time. Grab <b style="color:#ffb347">oil flasks</b> to refill it.</li>
      <li>Press <b>Space</b> (or tap) to flash: it uses a quarter tank and stuns nearby shadows. Touch a stunned shadow to banish it.</li>
      <li>Red-eyed shadows always know where you are.</li>
    </ul>`,
    button: 'Enter the maze',
    onAction: start,
  });
  requestAnimationFrame(frame);
})();
