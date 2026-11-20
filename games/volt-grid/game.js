/* Volt Grid: a board of wire tiles, scrambled. Rotate them to carry power from the generator in
   the middle to every bulb. Each board is a random spanning tree, so there is always exactly one
   way to light it all. Boards grow as you go; a shared clock gains time for every board solved.
   Tiles turn on springs, so fast clicks queue up smoothly instead of snapping. */
(() => {
  const W = 640, H = 640, TAU = Math.PI * 2;
  const SIZES = [4, 5, 5, 6, 6, 7, 7, 8, 8, 9];
  const START_CLOCK = 75, SOLVE_BONUS = 25;
  // Directions: 0 up, 1 right, 2 down, 3 left. A tile's wires are a 4-bit mask in that order.
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const rot = (mask, n) => { n = ((n % 4) + 4) % 4; return ((mask << n) | (mask >> (4 - n))) & 15; };
  const bits = m => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

  let state = 'ready';
  let board, n, cell, ox, oy, src, clock, score, boardNo, moves, par, lit, sparks, solvedT, time, focus, combo;

  // A critically damped spring per tile angle (response 0.18s), integrated in update().
  const K = (TAU / 0.18) ** 2, C = 4 * Math.PI / 0.18;

  function generate(size) {
    n = size;
    cell = Math.floor(560 / n);
    ox = (W - cell * n) / 2;
    oy = (H - cell * n) / 2 + 10;
    const masks = Array.from({ length: n * n }, () => 0);
    src = Math.floor(n / 2) * n + Math.floor(n / 2);
    // Randomized Prim's: grow a tree from the generator, preferring fewer branches per tile.
    const inTree = new Set([src]);
    const frontier = [];
    const addEdges = i => {
      const x = i % n, y = Math.floor(i / n);
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < n && ny < n) frontier.push([i, d, ny * n + nx]);
      }
    };
    addEdges(src);
    while (inTree.size < n * n) {
      const k = Math.floor(Math.random() * frontier.length);
      const [a, d, b] = frontier.splice(k, 1)[0];
      if (inTree.has(b)) continue;
      // Cross tiles (four wires) are rare in good boards; skip a branch that would make one.
      if (bits(masks[a]) >= 3 && Math.random() < 0.8 && frontier.some(f => !inTree.has(f[2]))) { frontier.push([a, d, b]); continue; }
      masks[a] |= 1 << d;
      masks[b] |= 1 << ((d + 2) % 4);
      inTree.add(b);
      addEdges(b);
    }
    par = 0;
    board = masks.map((m, i) => {
      // Scramble. Straight pieces only have two distinct turns.
      let r = Math.floor(Math.random() * 4);
      if (i === src && r === 0) r = 1;
      const need = (4 - r) % 4;
      const straight = m === 5 || m === 10;
      par += m === 15 ? 0 : straight ? need % 2 : need === 3 ? 1 : need; // the fewest clicks either way
      return { sol: m, turns: r, ang: r * Math.PI / 2, vel: 0, lit: false, flash: 0 };
    });
    moves = 0;
    combo = 0;
    focus = src;
    sparks = [];
    trace();
  }

  const maskOf = i => rot(board[i].sol, board[i].turns);

  // Flood power from the generator through connected wires.
  function trace() {
    for (const t of board) t.wasLit = t.lit, t.lit = false;
    const stack = [src];
    board[src].lit = true;
    while (stack.length) {
      const i = stack.pop(), x = i % n, y = Math.floor(i / n), m = maskOf(i);
      for (let d = 0; d < 4; d++) {
        if (!(m & (1 << d))) continue;
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (board[j].lit || !(maskOf(j) & (1 << ((d + 2) % 4)))) continue;
        board[j].lit = true;
        stack.push(j);
      }
    }
    lit = 0;
    for (const t of board) {
      if (t.lit) lit++;
      if (t.lit && !t.wasLit) t.flash = 1;
    }
  }

  const bulbs = () => board.filter((t, i) => i !== src && bits(t.sol) === 1);

  function reset() {
    score = 0;
    boardNo = 0;
    clock = START_CLOCK;
    time = 0;
    solvedT = 0;
    generate(SIZES[0]);
    updateHud();
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
  }

  function turn(i, dir = 1) {
    if (state !== 'playing' || i < 0 || i >= board.length) return;
    const t = board[i];
    t.turns = (t.turns + dir + 4) % 4;
    // The angle keeps running past 2π so a spin always goes the way you clicked.
    t.target = (t.target ?? t.ang) + dir * Math.PI / 2;
    moves++;
    const before = lit;
    trace();
    Arcade.tone({ freq: lit > before ? 700 + Math.min(500, lit * 8) : 330, dur: 0.05, type: 'triangle', vol: 0.04 });
    if (lit === board.length) solved();
    updateHud();
  }

  function solved() {
    state = 'solved';
    solvedT = 1.4;
    const size = n;
    const extra = Math.max(0, moves - par);
    const tidy = Math.max(0, 300 - extra * 15);
    const gain = size * size * 12 + tidy + Math.round(clock) * 2;
    score += gain;
    clock += SOLVE_BONUS;
    combo = extra <= 2 ? combo + 1 : 0;
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * TAU, sp = 80 + Math.random() * 260;
      sparks.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.6 + Math.random() * 0.6 });
    }
    banner = { text: extra === 0 ? `PERFECT WIRING  +${gain}` : `POWERED UP  +${gain}`, t: 1.4 };
    [523, 659, 784, 1046].forEach((f, k) => Arcade.tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.05, delay: k * 0.07 }));
    if (extra === 0) Arcade.flag('volt-grid-perfect');
    if (size >= 8) Arcade.flag('volt-grid-eight');
    boardNo++;
    updateHud();
  }
  let banner = null;

  function nextBoard() {
    generate(SIZES[Math.min(boardNo, SIZES.length - 1)]);
    state = 'playing';
    updateHud();
  }

  function gameOver() {
    state = 'over';
    Arcade.tone({ freq: 260, to: 70, dur: 0.6, type: 'sawtooth', vol: 0.05 });
    Arcade.finish(ui, {
      score,
      title: 'Blackout',
      lines: [`${boardNo} board${boardNo === 1 ? '' : 's'} powered · ${lit}/${board.length} tiles lit on the last`],
      onAction: start,
    });
  }

  function update(dt) {
    time += dt;
    for (const t of board) {
      const target = t.target ?? t.ang;
      for (let s = 0; s < 4; s++) {
        const h = dt / 4;
        t.vel += (-K * (t.ang - target) - C * t.vel) * h;
        t.ang += t.vel * h;
      }
      t.flash = Math.max(0, t.flash - dt * 2.5);
    }
    for (const p of sparks) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 2; p.vy *= 1 - dt * 2; }
    sparks = sparks.filter(p => p.life < p.max);
    if (banner && (banner.t -= dt) <= 0) banner = null;
    if (state === 'solved') {
      solvedT -= dt;
      if (solvedT <= 0) nextBoard();
      return;
    }
    if (state !== 'playing') return;
    clock -= dt;
    if (clock <= 0) { clock = 0; updateHud(); gameOver(); return; }
    updateHud();
  }

  // ---------- Drawing ----------

  function drawTile(i) {
    const t = board[i], x = ox + (i % n) * cell, y = oy + Math.floor(i / n) * cell, c = cell / 2;
    ctx.save();
    ctx.translate(x + c, y + c);
    ctx.fillStyle = t.lit ? `rgba(60,200,255,${0.08 + t.flash * 0.25})` : 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.roundRect(-c + 2, -c + 2, cell - 4, cell - 4, 8); ctx.fill();
    if (i === focus && state === 'playing') {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-c + 3, -c + 3, cell - 6, cell - 6, 8); ctx.stroke();
    }
    ctx.rotate(t.ang);
    const w = Math.max(5, cell * 0.16);
    ctx.lineCap = 'round';
    ctx.strokeStyle = t.lit ? '#5fe1ff' : '#4a5263';
    if (t.lit) { ctx.shadowColor = '#3cc8ff'; ctx.shadowBlur = 10 + t.flash * 14; }
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let d = 0; d < 4; d++) {
      if (!(t.sol & (1 << d))) continue;
      ctx.moveTo(0, 0);
      ctx.lineTo(DX[d] * c, DY[d] * c);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.rotate(-t.ang);
    if (i === src) {
      ctx.fillStyle = '#ffc53d';
      ctx.beginPath(); ctx.arc(0, 0, cell * 0.28, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1c1500';
      ctx.font = `900 ${Math.round(cell * 0.3)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡', 0, 1);
    } else if (bits(t.sol) === 1) {
      const r = cell * 0.2;
      if (t.lit) {
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 2.4);
        g.addColorStop(0, 'rgba(255,240,170,0.9)');
        g.addColorStop(1, 'rgba(255,240,170,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = t.lit ? '#fff2b3' : '#2a303c';
      ctx.strokeStyle = t.lit ? '#ffd25e' : '#4a5263';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = t.lit ? '#bdf2ff' : '#4a5263';
      ctx.beginPath(); ctx.arc(0, 0, w * 0.75, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0d1220');
    bg.addColorStop(1, '#080b14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.roundRect(ox - 10, oy - 10, cell * n + 20, cell * n + 20, 16); ctx.fill();
    for (let i = 0; i < board.length; i++) drawTile(i);
    for (const p of sparks) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = '#9fe9ff';
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    // Progress bar of lit bulbs.
    const all = bulbs(), on = all.filter(t => t.lit).length;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.roundRect(ox, 14, cell * n, 6, 3); ctx.fill();
    ctx.fillStyle = '#ffd25e';
    ctx.beginPath(); ctx.roundRect(ox, 14, cell * n * (all.length ? on / all.length : 0), 6, 3); ctx.fill();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`${on}/${all.length} BULBS · ${n}×${n} · MOVES ${moves} (PAR ${par})`, ox, 36);
    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 3);
      ctx.fillStyle = 'rgba(8,11,20,0.75)';
      ctx.fillRect(0, H / 2 - 34, W, 68);
      ctx.fillStyle = '#5fe1ff';
      ctx.font = '900 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(banner.text, W / 2, H / 2 + 10);
      ctx.globalAlpha = 1;
    }
    if (clock < 10 && state === 'playing') {
      ctx.fillStyle = `rgba(255,80,80,${0.08 + 0.08 * Math.sin(time * 10)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('clock').textContent = `${Math.ceil(clock)}s`;
    $('boards').textContent = boardNo;
  }

  // ---------- Input ----------

  const tileAt = e => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * W / r.width - ox, y = (e.clientY - r.top) * H / r.height - oy;
    if (x < 0 || y < 0 || x >= cell * n || y >= cell * n) return -1;
    return Math.floor(y / cell) * n + Math.floor(x / cell);
  };
  // Turn on pointer-down: the response is immediate, not on release.
  canvas.addEventListener('pointerdown', e => {
    if (!overlayEl.hidden) return;
    e.preventDefault();
    const i = tileAt(e);
    if (i < 0) return;
    focus = i;
    turn(i, e.button === 2 || e.shiftKey ? -1 : 1);
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') { state = 'paused'; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); }
      else if (state === 'paused') resume();
      return;
    }
    if (!overlayEl.hidden || state !== 'playing') return;
    const mv = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] }[e.code];
    if (mv) {
      e.preventDefault();
      const x = Math.max(0, Math.min(n - 1, focus % n + mv[0])), y = Math.max(0, Math.min(n - 1, Math.floor(focus / n) + mv[1]));
      focus = y * n + x;
    } else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') { e.preventDefault(); turn(focus, 1); }
    else if (e.code === 'KeyQ') { e.preventDefault(); turn(focus, -1); }
  });
  function resume() { state = 'playing'; ui.hide(); }
  Arcade.onBlur(() => { if (state === 'playing') { state = 'paused'; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); } });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state !== 'paused') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => score,
    intro: {
      title: 'Volt Grid',
      html: `<ul>
        <li>Click or tap a tile to turn it clockwise (right-click or <kbd>Shift</kbd> for the other way).</li>
        <li>Carry power from the <b>⚡ generator</b> to every bulb. When every tile is lit, the board is powered.</li>
        <li>The clock starts at ${START_CLOCK}s and every solved board adds ${SOLVE_BONUS}s. Boards grow up to 9×9.</li>
        <li>Solve close to <b>par</b> (the fewest turns) for a tidy bonus. Keys: arrows move, <kbd>Space</kbd>/<kbd>E</kbd> turns, <kbd>Q</kbd> turns back.</li>
      </ul>`,
      button: 'Switch on',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
