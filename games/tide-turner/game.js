/* Tide Turner: Reversi in short rounds. Place a disc so that it traps a line of the other
   colour between itself and another of yours; every trapped disc turns. Whoever holds more
   discs when neither side can move wins. Six-by-six by default (about a minute a round) with a
   classic eight-by-eight option. Online, each player sends the square they chose and both
   boards apply the same rules; a player with no move is passed automatically on both. */
(() => {
  const W = 560, H = 680, TAU = Math.PI * 2;
  const LEVELS = ['Easy', 'Normal', 'Hard'];
  const BASE = [300, 650, 1000];
  const SIDES = [
    { name: 'Gold', fill: '#ffc53d', dark: '#b8870f', glow: '255,197,61' },
    { name: 'Blue', fill: '#4f8cff', dark: '#2851a8', glow: '79,140,255' },
  ];
  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let parts = [];
  let size = Arcade.load('tide:size', 6);
  let n, cell, ox, oy, board, flipAt, turn, mode, level, me, names, over, hover, botT, last, time, moves, passNote, ended;
  let queue = [];

  // ---------- Rules ----------

  const at = (b, r, c) => (r < 0 || c < 0 || r >= n || c >= n ? -2 : b[r * n + c]);
  function flipsFor(b, i, p) {
    if (b[i] !== -1) return [];
    const r0 = Math.floor(i / n), c0 = i % n, out = [];
    for (const [dr, dc] of DIRS) {
      const line = [];
      let r = r0 + dr, c = c0 + dc;
      while (at(b, r, c) === 1 - p) { line.push(r * n + c); r += dr; c += dc; }
      if (line.length && at(b, r, c) === p) out.push(...line);
    }
    return out;
  }
  const legalMoves = (b, p) => {
    const out = [];
    for (let i = 0; i < b.length; i++) if (b[i] === -1 && flipsFor(b, i, p).length) out.push(i);
    return out;
  };
  const count = (b, p) => b.reduce((s, v) => s + (v === p ? 1 : 0), 0);

  // ---------- Computer ----------

  // Corners are gold, the squares beside them are traps, edges are good.
  function weights() {
    const w = Array(n * n).fill(0);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const er = Math.min(r, n - 1 - r), ec = Math.min(c, n - 1 - c);
      let v = 2;
      if (er === 0 && ec === 0) v = 30;
      else if ((er === 0 && ec === 1) || (er === 1 && ec === 0)) v = -9;
      else if (er === 1 && ec === 1) v = -14;
      else if (er === 0 || ec === 0) v = 6;
      w[r * n + c] = v;
    }
    return w;
  }
  let W8;
  function evaluate(b, p) {
    let s = 0;
    for (let i = 0; i < b.length; i++) if (b[i] !== -1) s += (b[i] === p ? 1 : -1) * W8[i];
    const mine = legalMoves(b, p).length, theirs = legalMoves(b, 1 - p).length;
    s += (mine - theirs) * 3;
    if (!mine && !theirs) s += (count(b, p) - count(b, 1 - p)) * 1000;
    return s;
  }
  function search(b, p, depth, alpha, beta, me2) {
    const ms = legalMoves(b, p);
    if (!depth || (!ms.length && !legalMoves(b, 1 - p).length)) return { v: evaluate(b, me2), m: -1 };
    if (!ms.length) return { v: search(b, 1 - p, depth - 1, alpha, beta, me2).v, m: -1 };
    let best = { v: p === me2 ? -Infinity : Infinity, m: ms[0] };
    ms.sort((a, c) => W8[c] - W8[a]);
    for (const m of ms) {
      const nb = b.slice();
      for (const f of flipsFor(b, m, p)) nb[f] = p;
      nb[m] = p;
      const v = search(nb, 1 - p, depth - 1, alpha, beta, me2).v;
      if (p === me2 ? v > best.v : v < best.v) best = { v, m };
      if (p === me2) alpha = Math.max(alpha, v); else beta = Math.min(beta, v);
      if (beta <= alpha) break;
    }
    return best;
  }
  function botMove(p) {
    const ms = legalMoves(board, p);
    if (level === 0) {
      // Greedy with plenty of mistakes.
      if (Math.random() < 0.4) return Arcade.pick(ms);
      return ms.sort((a, b) => flipsFor(board, b, p).length - flipsFor(board, a, p).length)[0];
    }
    return search(board, p, level === 1 ? 2 : n === 6 ? 6 : 5, -Infinity, Infinity, p).m;
  }

  // ---------- Flow ----------

  function begin(info) {
    mode = info.mode; level = info.level; me = info.me; names = info.names;
    n = info.data.n || size;
    W8 = weights();
    cell = Math.floor(504 / n);
    ox = (W - cell * n) / 2;
    oy = 130;
    board = Array(n * n).fill(-1);
    flipAt = Array(n * n).fill(null);
    const m = n / 2;
    board[(m - 1) * n + m - 1] = board[m * n + m] = 1;
    board[(m - 1) * n + m] = board[m * n + m - 1] = 0;
    turn = info.first;
    over = false; ended = false; hover = -1; botT = 0.7; parts = []; last = -1; time = 0; moves = 0; passNote = ''; queue = [];
    ui.hide();
    advance();
  }

  const mineTurn = () => Match.mine(turn);

  // Skips a player who can't move; ends the round when neither can.
  function advance() {
    if (!legalMoves(board, turn).length) {
      if (!legalMoves(board, 1 - turn).length) return finish();
      const msg = passNote = `${nameOf(turn)} has no move and passes`;
      setTimeout(() => { if (passNote === msg) passNote = ''; }, 1800);
      turn = 1 - turn;
    }
    botT = 0.6 + Math.random() * 0.3;
    updateHud();
  }
  const nameOf = p => (mode === 'cpu' ? (p === 0 ? 'You' : 'Computer') : mode === 'local' ? SIDES[p].name : names[p]);

  function play(i, p) {
    if (over || p !== turn) return false;
    const fl = flipsFor(board, i, p);
    if (!fl.length) return false;
    board[i] = p;
    const { x, y } = center(i);
    fl.forEach(j => {
      const d = Math.max(Math.abs(Math.floor(j / n) - Math.floor(i / n)), Math.abs((j % n) - (i % n)));
      board[j] = p;
      flipAt[j] = { t: -d * 0.09, from: 1 - p };
    });
    flipAt[i] = { t: -0.0, from: -1, drop: true };
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * TAU;
      parts.push({ x, y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80, t: 0, life: 0.4, col: SIDES[p].fill });
    }
    last = i;
    moves++;
    Arcade.tone({ freq: 300 + fl.length * 40, dur: 0.07, type: 'triangle', vol: 0.05 });
    turn = 1 - p;
    advance();
    return true;
  }

  function finish() {
    if (over) return;
    over = true;
    const a = count(board, 0), b = count(board, 1);
    const winner = a === b ? -1 : a > b ? 0 : 1;
    const mineCount = count(board, me);
    if (winner === me && mode === 'cpu') {
      if (mineCount === n * n) Arcade.flag('tide-turner-sweep');
      if (a + b === n * n && Math.abs(a - b) >= 20) Arcade.flag('tide-turner-rout');
    }
    const corners = [0, n - 1, n * (n - 1), n * n - 1].filter(i => board[i] === me).length;
    if (winner === me && corners === 4) Arcade.flag('tide-turner-corners');
    const score = winner === 0 ? BASE[level] + (a - b) * 12 + corners * 40 : a * 8;
    setTimeout(() => Match.over({ winner, score: mode === 'cpu' ? score : 0, lines: [`${SIDES[0].name} ${a} · ${SIDES[1].name} ${b}`] }), 1100);
  }

  // ---------- Update and drawing ----------

  const center = i => ({ x: ox + (i % n) * cell + cell / 2, y: oy + Math.floor(i / n) * cell + cell / 2 });

  function update(dt) {
    time += dt;
    for (const s of parts) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.92; s.vy *= 0.92; }
    parts = parts.filter(s => s.t < s.life);
    if (!board) return;
    flipAt.forEach((f, i) => { if (f) { f.t += dt; if (f.t >= (f.drop ? 0.3 : 0.45)) flipAt[i] = null; } });
    if (over) return;
    if (queue.length && !mineTurn()) { const m = queue.shift(); play(m.i, turn); return; }
    if (mode === 'cpu' && turn !== me) {
      botT -= dt;
      if (botT <= 0) { const m = botMove(turn); if (m >= 0) play(m, turn); }
    }
  }

  function disc(x, y, p, k, lift) {
    const r = cell * 0.4 * k;
    const sd = SIDES[p];
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.35 + lift * 0.3, r * 0.95, r * 0.45, 0, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35 - lift, r * 0.1, x, y - lift, r);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.25, sd.fill);
    g.addColorStop(1, sd.dark);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y - lift, r, 0, TAU); ctx.fill();
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#11151d');
    bg.addColorStop(1, '#080a10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (!board) return;
    ctx.textAlign = 'center';
    const a = count(board, 0), b = count(board, 1);
    const sd = SIDES[turn];
    const label = over ? 'Round over' : mode === 'cpu' ? (turn === me ? 'Your move' : 'Computer is thinking…') : mode === 'local' ? `${sd.name}'s move` : mineTurn() ? 'Your move' : `${names[turn]}'s move`;
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
    ctx.fillText(passNote || Match.label() || 'Trap the other colour between two of yours', W / 2, 78);
    // Disc count bar.
    const bw = cell * n, tot = a + b || 1;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.roundRect(ox, 98, bw, 8, 4); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.roundRect(ox, 98, bw, 8, 4); ctx.clip();
    ctx.fillStyle = SIDES[0].fill; ctx.fillRect(ox, 98, bw * a / tot, 8);
    ctx.fillStyle = SIDES[1].fill; ctx.fillRect(ox + bw * a / tot, 98, bw * b / tot, 8);
    ctx.restore();
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.fillStyle = SIDES[0].fill; ctx.fillText(`${nameOf(0)} ${a}`, ox, 122);
    ctx.textAlign = 'right'; ctx.fillStyle = SIDES[1].fill; ctx.fillText(`${b} ${nameOf(1)}`, ox + bw, 122);
    ctx.textAlign = 'center';
    // Squares.
    const hints = !over && mineTurn() ? new Set(legalMoves(board, turn)) : new Set();
    const preview = hover >= 0 && hints.has(hover) ? new Set(flipsFor(board, hover, turn)) : null;
    for (let i = 0; i < n * n; i++) {
      const { x, y } = center(i), s = cell - 5;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 10); ctx.fill();
      if (i === last) { ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (hints.has(i)) {
        const hot = i === hover;
        ctx.fillStyle = `rgba(${SIDES[turn].glow},${hot ? 0.25 : 0.08 + Math.sin(time * 4 + i) * 0.03})`;
        ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, cell * 0.08, 0, TAU);
        ctx.fillStyle = `rgba(${SIDES[turn].glow},${hot ? 0.9 : 0.45})`;
        ctx.fill();
      }
      const v = board[i];
      if (v < 0) continue;
      const f = flipAt[i];
      if (!f) { disc(x, y, v, preview?.has(i) ? 0.9 + Math.sin(time * 8) * 0.04 : 1, 0); if (preview?.has(i)) { ctx.strokeStyle = `rgba(${SIDES[turn].glow},0.8)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, cell * 0.4, 0, TAU); ctx.stroke(); } continue; }
      if (f.drop) {
        const k = Math.max(0, f.t / 0.3);
        disc(x, y, v, 0.6 + 0.4 * (1 - (1 - k) ** 3), (1 - k) * 24);
        continue;
      }
      if (f.t < 0) { disc(x, y, f.from, 1, 0); continue; }
      const k = f.t / 0.45;
      const sx = Math.abs(Math.cos(k * Math.PI));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(Math.max(0.04, sx), 1);
      disc(0, 0, k < 0.5 ? f.from : v, 1 + Math.sin(k * Math.PI) * 0.1, Math.sin(k * Math.PI) * 10);
      ctx.restore();
    }
    for (const s of parts) {
      ctx.globalAlpha = 1 - s.t / s.life;
      ctx.fillStyle = s.col;
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function updateHud() {
    $('turn').textContent = moves;
    $('gold').textContent = count(board, 0);
    $('blue').textContent = count(board, 1);
  }

  // ---------- Input ----------

  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * W / r.width - ox, y = (e.clientY - r.top) * H / r.height - oy;
    if (x < 0 || y < 0 || x >= cell * n || y >= cell * n) return -1;
    return Math.floor(y / cell) * n + (Math.floor(x / cell));
  }
  canvas.addEventListener('pointermove', e => { hover = cellAt(e); });
  canvas.addEventListener('pointerleave', () => { hover = -1; });
  canvas.addEventListener('pointerdown', e => {
    if (!$('overlay').hidden || !board || over || !mineTurn()) return;
    e.preventDefault();
    hover = cellAt(e);
    if (hover >= 0 && play(hover, turn)) Match.move({ i: hover });
    else Arcade.tone({ freq: 150, dur: 0.05, type: 'square', vol: 0.03 });
  });

  Match.setup({
    ui,
    tag: 'tideturner',
    title: 'Tide Turner',
    levels: LEVELS,
    winFlag: 'tide-turner-win',
    hardFlag: 'tide-turner-hard',
    onlineWinFlag: 'tide-turner-online-win',
    rules: `<ul>
      <li>Place a disc so a straight line of the other colour ends in one of yours: every disc in between <b>turns</b>.</li>
      <li>No move? You pass. When nobody can move, the most discs wins.</li>
      <li><b>Corners</b> can never be flipped. Squares beside them are risky.</li>
    </ul>`,
    onMenu: panel => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = [6, 8].map(s => `<button class="chip" type="button" data-size="${s}" aria-pressed="${size === s}">${s}×${s}${s === 6 ? ' · quick' : ' · classic'}</button>`).join('');
      panel.querySelector('.menu').before(row);
      row.style.cssText = 'display:flex;gap:6px;justify-content:center;margin:0 0 12px';
      row.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => { size = +b.dataset.size; Arcade.save('tide:size', size); Match.menu(); }));
    },
    startData: () => ({ n: size }),
    onStart: begin,
    onMove: d => { if (Number.isInteger(d.i)) queue.push({ i: d.i }); },
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
