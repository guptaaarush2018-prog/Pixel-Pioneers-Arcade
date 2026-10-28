(() => {
  const N = 8, CELL = 60, W = N * CELL, H = N * CELL;
  const KINDS = 6;
  const COLORS = ['#ff6b6b', '#4f8cff', '#3ddc84', '#ffc53d', '#c77dff', '#5ec8d8'];
  const ROUND_TIME = 60;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'ready';
  let grid, phase, selected, swapPair, cascade, score, timeLeft, popups, dragFrom, bestCombo;

  // ---------- Board ----------

  const gem = k => ({ k, dx: 0, dy: 0, dying: 0 });
  const inside = (r, c) => r >= 0 && c >= 0 && r < N && c < N;

  function fill() {
    grid = [];
    for (let r = 0; r < N; r++) {
      grid.push([]);
      for (let c = 0; c < N; c++) {
        let k;
        do k = Arcade.randInt(0, KINDS - 1);
        while ((c >= 2 && grid[r][c - 1].k === k && grid[r][c - 2].k === k) || (r >= 2 && grid[r - 1][c].k === k && grid[r - 2][c].k === k));
        grid[r].push(gem(k));
        grid[r][c].dy = -N - r * 0.3; // drop in at the start
      }
    }
  }

  // Every run of 3+ in a row or column. Returns the cells to clear and the run lengths.
  function findMatches() {
    const cells = new Set(), runs = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N;) {
        let e = c;
        while (e + 1 < N && grid[r][e + 1].k === grid[r][c].k) e++;
        if (e - c >= 2) { runs.push(e - c + 1); for (let i = c; i <= e; i++) cells.add(r * N + i); }
        c = e + 1;
      }
    }
    for (let c = 0; c < N; c++) {
      for (let r = 0; r < N;) {
        let e = r;
        while (e + 1 < N && grid[e + 1][c].k === grid[r][c].k) e++;
        if (e - r >= 2) { runs.push(e - r + 1); for (let i = r; i <= e; i++) cells.add(i * N + c); }
        r = e + 1;
      }
    }
    return { cells, runs };
  }

  function swap(a, b) {
    const t = grid[a.r][a.c];
    grid[a.r][a.c] = grid[b.r][b.c];
    grid[b.r][b.c] = t;
  }

  function hasMoves() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          if (!inside(r + dr, c + dc)) continue;
          const a = { r, c }, b = { r: r + dr, c: c + dc };
          swap(a, b);
          const ok = findMatches().cells.size > 0;
          swap(a, b);
          if (ok) return true;
        }
      }
    }
    return false;
  }

  function reshuffle() {
    do fill(); while (!hasMoves());
    popups.push({ x: W / 2, y: H / 2, text: 'Shuffle!', life: 1 });
  }

  const animating = () => grid.some(row => row.some(g => g.dx || g.dy || g.dying));

  // ---------- Turn flow ----------

  function trySwap(a, b) {
    if (phase !== 'idle' || Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return;
    swap(a, b);
    // Animate from where each crystal came from.
    grid[a.r][a.c].dx = b.c - a.c; grid[a.r][a.c].dy = b.r - a.r;
    grid[b.r][b.c].dx = a.c - b.c; grid[b.r][b.c].dy = a.r - b.r;
    swapPair = [a, b];
    phase = 'swapping';
    selected = null;
    Arcade.tone({ freq: 500, dur: 0.05, vol: 0.03 });
  }

  function resolve() {
    const { cells, runs } = findMatches();
    if (!cells.size) {
      cascade = 1;
      phase = 'idle';
      if (!hasMoves()) reshuffle();
      return;
    }
    let gained = 0;
    for (const len of runs) {
      gained += len * 20 * cascade;
      if (len >= 4) timeLeft += len - 2; // big matches buy time
    }
    score += gained;
    bestCombo = Math.max(bestCombo, cascade);
    const first = [...cells][0];
    popups.push({
      x: (first % N) * CELL + CELL / 2, y: Math.floor(first / N) * CELL + CELL / 2,
      text: cascade > 1 ? `+${gained} x${cascade}` : `+${gained}`, life: 0.8,
    });
    for (const i of cells) grid[Math.floor(i / N)][i % N].dying = 1;
    Arcade.tone({ freq: 520 + cascade * 110, to: 780 + cascade * 110, dur: 0.12, type: 'triangle', vol: 0.05 });
    cascade++;
    phase = 'clearing';
    updateHud();
  }

  // Remove cleared crystals, drop the rest down, and refill from the top.
  function collapse() {
    for (let c = 0; c < N; c++) {
      const keep = [];
      for (let r = N - 1; r >= 0; r--) if (!grid[r][c].dead) keep.push({ g: grid[r][c], from: r });
      for (let r = N - 1, i = 0; r >= 0; r--, i++) {
        if (i < keep.length) {
          grid[r][c] = keep[i].g;
          grid[r][c].dy = keep[i].from - r;
        } else {
          // New crystals start above the board and fall in with the rest.
          grid[r][c] = gem(Arcade.randInt(0, KINDS - 1));
          grid[r][c].dy = -(N - keep.length);
        }
      }
    }
    phase = 'falling';
  }

  function update(dt) {
    timeLeft = Math.max(0, timeLeft - dt);
    for (const row of grid) {
      for (const g of row) {
        const step = dt * 9;
        g.dx = Math.abs(g.dx) <= step ? 0 : g.dx - Math.sign(g.dx) * step;
        g.dy = Math.abs(g.dy) <= step * 1.4 ? 0 : g.dy - Math.sign(g.dy) * step * 1.4;
        if (g.dying) {
          g.dying = Math.max(0, g.dying - dt * 5);
          if (!g.dying) g.dead = true;
        }
      }
    }
    for (const p of popups) { p.y -= 40 * dt; p.life -= dt; }
    popups = popups.filter(p => p.life > 0);
    updateHud();

    if (animating()) return;
    if (phase === 'swapping') {
      if (findMatches().cells.size) resolve();
      else {
        // Not a match: swap back.
        const [a, b] = swapPair;
        swap(a, b);
        grid[a.r][a.c].dx = b.c - a.c; grid[a.r][a.c].dy = b.r - a.r;
        grid[b.r][b.c].dx = a.c - b.c; grid[b.r][b.c].dy = a.r - b.r;
        phase = 'unswapping';
        Arcade.tone({ freq: 200, dur: 0.08, vol: 0.03 });
      }
    } else if (phase === 'unswapping') {
      phase = 'idle';
    } else if (phase === 'clearing') {
      collapse();
    } else if (phase === 'falling' || phase === 'start') {
      resolve();
    }
    if (phase === 'idle' && timeLeft <= 0) end();
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('time').textContent = Math.ceil(timeLeft);
    $('best').textContent = Math.max(score, Arcade.getBest(Arcade.gameId)).toLocaleString();
  }

  function end() {
    state = 'over';
    Arcade.tone({ freq: 660, to: 330, dur: 0.4, type: 'triangle', vol: 0.06 });
    Arcade.finish(ui, {
      score,
      title: "Time's up!",
      lines: [`Biggest cascade: x${bestCombo}`],
      onAction: start,
    });
  }

  function start() {
    popups = [];
    fill();
    while (!hasMoves()) fill();
    phase = 'start';
    selected = null;
    cascade = 1;
    bestCombo = 1;
    score = 0;
    timeLeft = ROUND_TIME;
    state = 'playing';
    ui.hide();
    updateHud();
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

  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * N);
    const row = Math.floor(((e.clientY - r.top) / r.height) * N);
    return inside(row, c) ? { r: row, c } : null;
  }

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing' || phase !== 'idle') return;
    const cell = cellAt(e);
    if (!cell) return;
    canvas.setPointerCapture(e.pointerId);
    if (selected && Math.abs(selected.r - cell.r) + Math.abs(selected.c - cell.c) === 1) {
      trySwap(selected, cell);
      return;
    }
    selected = cell;
    dragFrom = cell;
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragFrom || phase !== 'idle') return;
    const cell = cellAt(e);
    if (cell && (cell.r !== dragFrom.r || cell.c !== dragFrom.c)) {
      const dr = Math.sign(cell.r - dragFrom.r), dc = Math.sign(cell.c - dragFrom.c);
      // Dragging diagonally picks the bigger direction.
      const target = Math.abs(cell.r - dragFrom.r) >= Math.abs(cell.c - dragFrom.c)
        ? { r: dragFrom.r + dr, c: dragFrom.c } : { r: dragFrom.r, c: dragFrom.c + dc };
      trySwap(dragFrom, target);
      dragFrom = null;
    }
  });
  canvas.addEventListener('pointerup', () => { dragFrom = null; });

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
    }
  });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function shape(k, x, y, s) {
    ctx.fillStyle = COLORS[k];
    ctx.beginPath();
    if (k === 0) ctx.arc(x, y, s, 0, Math.PI * 2);
    else if (k === 1) { ctx.moveTo(x, y - s * 1.15); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s * 1.15); ctx.lineTo(x - s, y); }
    else if (k === 2) ctx.roundRect(x - s * 0.88, y - s * 0.88, s * 1.76, s * 1.76, 5);
    else if (k === 3) { ctx.moveTo(x, y - s * 1.05); ctx.lineTo(x + s * 1.05, y + s * 0.85); ctx.lineTo(x - s * 1.05, y + s * 0.85); }
    else if (k === 4) for (let i = 0; i < 6; i++) ctx.lineTo(x + Math.cos(i * Math.PI / 3) * s, y + Math.sin(i * Math.PI / 3) * s);
    else for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? s * 0.48 : s * 1.08, a = -Math.PI / 2 + i * Math.PI / 5;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
    // Shine.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(x - s * 0.3, y - s * 0.35, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    ctx.fillStyle = '#161920';
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if ((r + c) % 2) {
          ctx.fillStyle = '#1b1f27';
          ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        }
      }
    }
    if (!grid) return;
    if (selected) {
      ctx.strokeStyle = '#eceef2';
      ctx.lineWidth = 3;
      ctx.strokeRect(selected.c * CELL + 3, selected.r * CELL + 3, CELL - 6, CELL - 6);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const g = grid[r][c];
        if (g.dead) continue;
        const size = 20 * (g.dying ? g.dying : 1);
        shape(g.k, (c + g.dx) * CELL + CELL / 2, (r + g.dy) * CELL + CELL / 2, size);
      }
    }
    ctx.restore();

    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    if (state === 'playing' && timeLeft < 10) {
      ctx.fillStyle = `rgba(255,107,107,${0.1 + Math.sin(timeLeft * 10) * 0.05})`;
      ctx.fillRect(0, 0, W, 4);
      ctx.fillRect(0, H - 4, W, 4);
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

  ui.show({
    title: 'Crystal Swap',
    html: `<ul>
      <li>Swap two neighboring crystals to line up 3 or more of the same kind.</li>
      <li>Chain reactions multiply your points.</li>
      <li>You have 60 seconds. Matching 4 or 5 adds extra time.</li>
    </ul>`,
    button: 'Start',
    onAction: start,
  });
  requestAnimationFrame(frame);
})();
