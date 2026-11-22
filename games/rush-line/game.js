/* Rush Line: a race across a 7×7 board (the classic game Breakthrough). Each side starts with
   fourteen pieces on its two home rows. A piece steps one square forward, straight or
   diagonally, onto an empty square, and captures only diagonally forward. The first piece to
   reach the far row wins, as does taking every enemy piece. Rounds are over in a couple of
   minutes. Coordinates are canonical (seat 0 at the bottom, moving up); seat 1 sees the board
   turned around. Online, each player sends from/to and both boards apply the same rules. */
(() => {
  const N = 7, CELL = 72, W = 560, H = 680, TAU = Math.PI * 2;
  const BX = (W - N * CELL) / 2, BY = 112;
  const LEVELS = ['Easy', 'Normal', 'Hard'];
  const BASE = [300, 650, 1000];
  const SIDES = [
    { name: 'Gold', fill: '#ffc53d', dark: '#b8870f', ink: '#241a00', glow: '255,197,61' },
    { name: 'Coral', fill: '#ff5d7a', dark: '#b83550', ink: '#2a0710', glow: '255,93,122' },
  ];
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let parts = [];
  let bd, turn, mode, level, me, names, selected, hover, over, botT, lastMove, time, moves, lost, queue = [], won;

  const flipIdx = i => (me === 1 ? N * N - 1 - i : i);
  const xy = i => { const s = flipIdx(i); return { x: BX + (s % N) * CELL + CELL / 2, y: BY + Math.floor(s / N) * CELL + CELL / 2 }; };
  const fwd = p => (p === 0 ? -1 : 1);   // row direction of travel

  // ---------- Rules ----------

  function movesOf(b, i) {
    const p = b[i];
    if (p === null || p === undefined || p < 0) return [];
    const r = Math.floor(i / N), c = i % N, nr = r + fwd(p), out = [];
    if (nr < 0 || nr >= N) return out;
    for (const dc of [-1, 0, 1]) {
      const cc = c + dc;
      if (cc < 0 || cc >= N) continue;
      const j = nr * N + cc, t = b[j];
      if (dc === 0 ? t === -1 : t !== p) out.push(j);
    }
    return out;
  }
  const allMoves = (b, p) => {
    const out = [];
    for (let i = 0; i < b.length; i++) if (b[i] === p) for (const j of movesOf(b, i)) out.push([i, j]);
    return out;
  };
  const reached = (b, p) => { const row = p === 0 ? 0 : N - 1; for (let c = 0; c < N; c++) if (b[row * N + c] === p) return true; return false; };
  const countOf = (b, p) => b.reduce((s, v) => s + (v === p ? 1 : 0), 0);

  // ---------- Computer ----------

  function evaluate(b, p) {
    let s = 0;
    for (let i = 0; i < b.length; i++) {
      const v = b[i];
      if (v < 0) continue;
      const r = Math.floor(i / N), adv = v === 0 ? N - 1 - r : r;   // steps travelled
      let w = 10 + adv * adv * 0.6;
      // A piece with a friend diagonally behind it is protected; edge pieces are harder to capture.
      const back = v === 0 ? r + 1 : r - 1, c = i % N;
      if (back >= 0 && back < N) for (const dc of [-1, 1]) if (c + dc >= 0 && c + dc < N && b[back * N + c + dc] === v) w += 1.2;
      if (c === 0 || c === N - 1) w += 0.8;
      if (adv >= N - 3) w += 6;   // close to the goal
      s += v === p ? w : -w;
    }
    return s;
  }
  function search(b, p, depth, alpha, beta, root) {
    if (reached(b, 1 - p)) return { v: -10000 - depth };
    const ms = allMoves(b, p);
    if (!ms.length) return { v: -10000 };
    if (!depth) return { v: evaluate(b, p) };
    // Winning steps first, then captures, then advances.
    const goal = p === 0 ? 0 : N - 1;
    ms.sort((a, c) => score(b, c, p, goal) - score(b, a, p, goal));
    let best = { v: -Infinity, m: ms[0] };
    for (const m of ms) {
      const nb = b.slice();
      nb[m[1]] = p; nb[m[0]] = -1;
      if (Math.floor(m[1] / N) === goal) return { v: 10000 + depth, m };
      const v = -search(nb, 1 - p, depth - 1, -beta, -alpha, false).v;
      if (v > best.v) best = { v, m };
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    return best;
  }
  const score = (b, m, p, goal) => (Math.floor(m[1] / N) === goal ? 100 : 0) + (b[m[1]] >= 0 ? 10 : 0) + (p === 0 ? N - Math.floor(m[1] / N) : Math.floor(m[1] / N));
  function botMove(p) {
    const ms = allMoves(bd, p);
    const goal = p === 0 ? 0 : N - 1;
    const win = ms.find(m => Math.floor(m[1] / N) === goal);
    if (win) return win;
    if (level === 0) {
      // Takes a free capture most of the time, otherwise wanders forward.
      const caps = ms.filter(m => bd[m[1]] >= 0);
      if (caps.length && Math.random() < 0.6) return Arcade.pick(caps);
      return Arcade.pick(ms);
    }
    return search(bd, p, level === 1 ? 3 : 5, -Infinity, Infinity, true).m || Arcade.pick(ms);
  }

  // ---------- Flow ----------

  function begin(info) {
    mode = info.mode; level = info.level; me = info.me; names = info.names;
    bd = Array(N * N).fill(-1);
    for (let c = 0; c < N; c++) { bd[c] = 1; bd[N + c] = 1; bd[(N - 1) * N + c] = 0; bd[(N - 2) * N + c] = 0; }
    pieces = new Map();
    for (let i = 0; i < bd.length; i++) if (bd[i] >= 0) pieces.set(i, { ...xy(i), rx: xy(i).x, ry: xy(i).y });
    turn = info.first;
    selected = -1; hover = -1; over = false; botT = 0.8; parts = []; lastMove = null; time = 0; moves = 0; lost = 0; queue = [];
    ui.hide();
    updateHud();
  }
  let pieces = new Map();   // render positions, by board index

  function play(from, to, p) {
    if (over || p !== turn || bd[from] !== p || !movesOf(bd, from).includes(to)) return false;
    const cap = bd[to] >= 0;
    if (cap) {
      const { x, y } = xy(to);
      for (let k = 0; k < 12; k++) { const a = Math.random() * TAU, v = 60 + Math.random() * 90; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.45, col: SIDES[1 - p].fill }); }
      if (1 - p === me) lost++;
    }
    const pc = pieces.get(from);
    pieces.delete(from);
    pieces.set(to, pc);
    bd[to] = p; bd[from] = -1;
    lastMove = { from, to };
    moves++;
    Arcade.tone(cap ? { freq: 200, to: 420, dur: 0.12, type: 'sawtooth', vol: 0.05 } : { freq: 280 + moves % 6 * 18, dur: 0.05, type: 'triangle', vol: 0.04 });
    selected = -1;
    if (reached(bd, p) || !countOf(bd, 1 - p)) { finish(p, reached(bd, p) ? 'line' : 'wipe'); return true; }
    turn = 1 - p;
    botT = 0.6 + Math.random() * 0.4;
    updateHud();
    if (!allMoves(bd, turn).length) finish(p, 'wipe');
    return true;
  }

  function finish(winner, why) {
    if (over) return;
    over = true;
    updateHud();
    const mineLeft = countOf(bd, me);
    if (winner === me && mode === 'cpu') {
      if (lost === 0) Arcade.flag('rush-line-flawless');
      if (why === 'wipe') Arcade.flag('rush-line-wipe');
    }
    const score = winner === 0 ? BASE[level] + mineLeft * 30 + Math.max(0, 200 - moves * 2) : (14 - countOf(bd, 1)) * 25;
    setTimeout(() => Match.over({ winner, score: mode === 'cpu' ? score : 0, lines: [`${why === 'line' ? 'Reached the far row' : 'Took every piece'} · ${moves} moves · ${mineLeft} of yours left`] }), 900);
  }

  // ---------- Update and drawing ----------

  function update(dt) {
    time += dt;
    for (const s of parts) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.92; s.vy *= 0.92; }
    parts = parts.filter(s => s.t < s.life);
    if (!bd) return;
    for (const [i, pc] of pieces) {
      const { x, y } = xy(i), k = Math.min(1, dt * 14);
      pc.rx += (x - pc.rx) * k;
      pc.ry += (y - pc.ry) * k;
    }
    if (over) return;
    if (queue.length && !Match.mine(turn)) { const m = queue.shift(); play(m.from, m.to, turn); return; }
    if (mode === 'cpu' && turn !== me) {
      botT -= dt;
      if (botT <= 0) { const m = botMove(turn); if (m) play(m[0], m[1], turn); }
    }
  }

  function pawn(x, y, p, lift, glow) {
    const sd = SIDES[p], r = CELL * 0.33;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.7, r * 0.95, r * 0.4, 0, 0, TAU); ctx.fill();
    if (glow) { ctx.shadowColor = `rgba(${sd.glow},0.8)`; ctx.shadowBlur = 16; }
    const g = ctx.createLinearGradient(x, y - r - lift, x, y + r - lift);
    g.addColorStop(0, sd.fill);
    g.addColorStop(1, sd.dark);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y - lift, r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - lift, r * 0.68, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    // A small chevron shows which way the piece is heading (up the screen for the side at the bottom).
    const up = p === 0 ? (me === 0 ? -1 : 1) : (me === 1 ? -1 : 1);
    ctx.strokeStyle = sd.ink;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 7, y - lift - up * 3); ctx.lineTo(x, y - lift + up * 4); ctx.lineTo(x + 7, y - lift - up * 3); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#12141d');
    bg.addColorStop(1, '#090a10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (!bd) return;
    ctx.textAlign = 'center';
    const sd = SIDES[turn];
    const mine = Match.mine(turn);
    const label = over ? 'Round over' : mode === 'local' ? `${sd.name}'s move` : mine ? 'Your move' : mode === 'online' ? `${names[turn]}'s move` : 'Computer is thinking…';
    ctx.font = '700 17px system-ui, sans-serif';
    const pw = Math.max(170, ctx.measureText(label).width + 56);
    ctx.fillStyle = `rgba(${sd.glow},0.14)`;
    ctx.strokeStyle = `rgba(${sd.glow},0.55)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(W / 2 - pw / 2, 20, pw, 36, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = sd.fill;
    ctx.beginPath(); ctx.arc(W / 2 - pw / 2 + 20, 38, 4 + (over ? 0 : Math.sin(time * 5) * 1.2), 0, TAU); ctx.fill();
    ctx.fillText(label, W / 2 + 8, 44);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(Match.label() || 'Reach the far row · capture only on the diagonal', W / 2, 78);
    // Piece counts.
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.fillStyle = SIDES[me].fill; ctx.fillText(`${mode === 'local' ? SIDES[0].name : 'You'} ${countOf(bd, mode === 'local' ? 0 : me)}`, BX, 102);
    ctx.textAlign = 'right'; ctx.fillStyle = SIDES[1 - me].fill; ctx.fillText(`${countOf(bd, mode === 'local' ? 1 : 1 - me)} ${mode === 'local' ? SIDES[1].name : 'Them'}`, BX + N * CELL, 102);
    ctx.textAlign = 'center';
    const sel = selected >= 0 ? new Set(movesOf(bd, selected)) : null;
    for (let i = 0; i < N * N; i++) {
      const { x, y } = xy(i), s = CELL - 5, sr = flipIdx(i) / N | 0;
      // Goal rows are tinted for whoever is racing to them.
      const goalMe = sr === 0, goalThem = sr === N - 1;
      ctx.fillStyle = goalMe ? `rgba(${SIDES[me].glow},0.10)` : goalThem ? `rgba(${SIDES[1 - me].glow},0.10)` : 'rgba(255,255,255,0.045)';
      ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 10); ctx.fill();
      if (lastMove && (i === lastMove.from || i === lastMove.to)) { ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (sel?.has(i)) {
        const pulse = 0.5 + Math.sin(time * 6) * 0.5;
        if (bd[i] >= 0) { ctx.strokeStyle = `rgba(255,93,122,${0.55 + pulse * 0.4})`; ctx.lineWidth = 3; ctx.stroke(); }
        else { ctx.fillStyle = `rgba(255,255,255,${0.2 + pulse * 0.12})`; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill(); }
      }
      if (i === hover && !over && mine && bd[i] === turn) { ctx.strokeStyle = `rgba(${SIDES[turn].glow},0.7)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 10); ctx.stroke(); }
    }
    const order = [...pieces.entries()].sort((a, b) => a[1].ry - b[1].ry);
    for (const [i, pc] of order) {
      const p = bd[i];
      if (p < 0) continue;
      pawn(pc.rx, pc.ry, p, i === selected ? 7 + Math.sin(time * 6) * 1.5 : 0, i === selected);
    }
    for (const s of parts) {
      ctx.globalAlpha = 1 - s.t / s.life;
      ctx.fillStyle = s.col;
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function updateHud() {
    $('turn').textContent = moves;
    $('mine').textContent = bd ? countOf(bd, mode === 'local' ? 0 : me) : 14;
    $('theirs').textContent = bd ? countOf(bd, mode === 'local' ? 1 : 1 - me) : 14;
  }

  // ---------- Input ----------

  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * W / r.width - BX, y = (e.clientY - r.top) * H / r.height - BY;
    if (x < 0 || y < 0 || x >= N * CELL || y >= N * CELL) return -1;
    return flipIdx(Math.floor(y / CELL) * N + Math.floor(x / CELL));
  }
  canvas.addEventListener('pointermove', e => { hover = cellAt(e); });
  canvas.addEventListener('pointerleave', () => { hover = -1; });
  canvas.addEventListener('pointerdown', e => {
    if (!$('overlay').hidden || !bd || over || !Match.mine(turn)) return;
    e.preventDefault();
    const i = cellAt(e);
    if (i < 0) return;
    if (bd[i] === turn) { selected = selected === i || !movesOf(bd, i).length ? -1 : i; return; }
    if (selected >= 0 && movesOf(bd, selected).includes(i)) {
      const from = selected;
      if (play(from, i, turn)) Match.move({ from, to: i });
    } else selected = -1;
  });

  Match.setup({
    ui,
    tag: 'rushline',
    title: 'Rush Line',
    levels: LEVELS,
    winFlag: 'rush-line-win',
    hardFlag: 'rush-line-hard',
    onlineWinFlag: 'rush-line-online-win',
    rules: `<ul>
      <li>Move one piece a turn: <b>one step forward</b>, straight or diagonal, onto an empty square.</li>
      <li>You <b>capture only diagonally</b> forward. Straight ahead, a piece blocks you.</li>
      <li>The first piece to reach the far row wins, or take every enemy piece.</li>
    </ul>`,
    onStart: begin,
    onMove: d => { if (Number.isInteger(d.from) && Number.isInteger(d.to)) queue.push({ from: d.from, to: d.to }); },
    onStop: () => { over = true; },
  });

  let lastT = performance.now();
  (function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if ($('overlay').hidden) update(dt);
    draw();
    requestAnimationFrame(frame);
  })(lastT);
})();
