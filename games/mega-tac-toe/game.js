(() => {
  const W = 600, H = 640;
  const BIG = 540, BX = 30, BY = 56, GAP = 12;
  const SMALL = (BIG - GAP * 2) / 3, CELL = SMALL / 3;
  const COLORS = ['#ffc53d', '#4f8cff'];
  const LEVELS = ['Easy', 'Normal', 'Hard'];
  const DEPTH = [1, 3, 5];
  const BASE = [300, 700, 1200];
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu', mode = null, level = 1, names = ['You', 'Computer'];
  let g = null, hover = -1, lastCell = -1, winLine = null, cpuTimer = null;

  // ---------- Rules ----------
  // cells: 81 entries (board * 9 + square), -1 empty. small: each board's result, -1 open,
  // 0 or 1 won, 2 full with no winner. next: the board the player must use, or -1 for any open board.

  const fresh = first => ({ cells: Array(81).fill(-1), small: Array(9).fill(-1), next: -1, turn: first });
  const clone = s => ({ cells: s.cells.slice(), small: s.small.slice(), next: s.next, turn: s.turn });

  function lineWinner(get) {
    for (const l of LINES) {
      const v = get(l[0]);
      if ((v === 0 || v === 1) && v === get(l[1]) && v === get(l[2])) return { v, l };
    }
    return null;
  }

  function legal(s) {
    const out = [];
    const boards = s.next >= 0 && s.small[s.next] === -1 ? [s.next] : [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(b => s.small[b] === -1);
    for (const b of boards) for (let k = 0; k < 9; k++) if (s.cells[b * 9 + k] === -1) out.push(b * 9 + k);
    return out;
  }

  function play(s, i) {
    const b = Math.floor(i / 9), k = i % 9;
    s.cells[i] = s.turn;
    const w = lineWinner(j => s.cells[b * 9 + j]);
    if (w) s.small[b] = s.turn;
    else if (s.cells.slice(b * 9, b * 9 + 9).every(v => v !== -1)) s.small[b] = 2;
    s.next = s.small[k] === -1 ? k : -1;
    s.turn = 1 - s.turn;
  }

  // null while the game goes on; otherwise { winner, line } where winner -1 is a draw. With no line of
  // three big boards, whoever won more boards takes it.
  function result(s) {
    const w = lineWinner(b => s.small[b]);
    if (w) return { winner: w.v, line: w.l };
    if (s.small.some(v => v === -1)) return null;
    const a = s.small.filter(v => v === 0).length, b = s.small.filter(v => v === 1).length;
    return { winner: a > b ? 0 : b > a ? 1 : -1, line: null };
  }

  // ---------- Computer ----------

  const WEIGHT = [3, 2, 3, 2, 4, 2, 3, 2, 3];
  function linesScore(get, p) {
    let s = 0;
    for (const l of LINES) {
      let mine = 0, theirs = 0;
      for (const j of l) {
        const v = get(j);
        if (v === p) mine++;
        else if (v === 1 - p) theirs++;
        else if (v === 2) { mine = theirs = 9; break; }
      }
      if (mine && theirs) continue;
      if (mine === 2) s += 4; else if (mine === 1) s += 1;
      if (theirs === 2) s -= 4; else if (theirs === 1) s -= 1;
    }
    return s;
  }

  function evaluate(s, p) {
    let v = linesScore(b => s.small[b], p) * 60;
    for (let b = 0; b < 9; b++) {
      if (s.small[b] === p) v += 40 * WEIGHT[b];
      else if (s.small[b] === 1 - p) v -= 40 * WEIGHT[b];
      else if (s.small[b] === -1) v += linesScore(j => s.cells[b * 9 + j], p) * WEIGHT[b];
    }
    // Sending the opponent anywhere they like is a gift.
    if (s.next === -1) v += s.turn === p ? 25 : -25;
    return v;
  }

  function search(s, depth, alpha, beta, me) {
    const r = result(s);
    if (r) return r.winner === me ? 100000 + depth : r.winner === -1 ? 0 : -100000 - depth;
    if (depth === 0) return evaluate(s, me);
    const moves = legal(s);
    if (moves.length > 20) depth = Math.min(depth, 2);
    let best = s.turn === me ? -Infinity : Infinity;
    for (const i of moves) {
      const t = clone(s);
      play(t, i);
      const v = search(t, depth - 1, alpha, beta, me);
      if (s.turn === me) { best = Math.max(best, v); alpha = Math.max(alpha, v); }
      else { best = Math.min(best, v); beta = Math.min(beta, v); }
      if (beta <= alpha) break;
    }
    return best;
  }

  function cpuMove() {
    const moves = legal(g);
    if (level === 0 && Math.random() < 0.5) return Arcade.pick(moves);
    // A free choice of board means dozens of moves, so it looks less far ahead.
    const depth = moves.length > 20 ? Math.min(DEPTH[level], 3) : DEPTH[level];
    let best = -Infinity, picks = [];
    for (const i of moves) {
      const t = clone(g);
      play(t, i);
      const v = search(t, depth - 1, -Infinity, Infinity, g.turn);
      if (v > best) { best = v; picks = [i]; }
      else if (v === best) picks.push(i);
    }
    return Arcade.pick(picks);
  }

  function scheduleCpu() {
    clearTimeout(cpuTimer);
    if (mode !== 'cpu' || state !== 'playing' || g.turn !== 1) return;
    cpuTimer = setTimeout(() => {
      if (state === 'playing' && g.turn === 1) apply(cpuMove(), 1);
    }, 450);
  }

  // ---------- Flow ----------

  function apply(i, p) {
    if (state !== 'playing' || p !== g.turn || !legal(g).includes(i)) return false;
    const before = g.small[Math.floor(i / 9)];
    play(g, i);
    lastCell = i;
    const won = before === -1 && (g.small[Math.floor(i / 9)] === 0 || g.small[Math.floor(i / 9)] === 1);
    Arcade.tone(won ? { freq: 660, to: 990, dur: 0.18, type: 'triangle', vol: 0.05 } : { freq: p ? 360 : 440, dur: 0.05, vol: 0.03 });
    updateHud();
    const r = result(g);
    if (r) end(r);
    else scheduleCpu();
    return true;
  }

  function end({ winner, line }) {
    state = 'over';
    winLine = line;
    const mineIdx = mode === 'online' ? Match.me : 0;
    const boards = g.small.filter(v => v === mineIdx).length;
    if (winner !== -1 && winner === mineIdx && mode !== 'local' && !g.small.includes(1 - mineIdx)) Arcade.flag('mega-tac-toe-sweep');
    setTimeout(() => Match.over({
      winner,
      score: winner === 0 ? BASE[level] + boards * 20 : winner === -1 ? Math.round(BASE[level] / 4) : boards * 10,
      lines: [line ? 'Three big boards in a row.' : `Boards won: ${g.small.filter(v => v === 0).length} – ${g.small.filter(v => v === 1).length}`],
    }), 900);
  }

  Match.setup({
    ui,
    tag: 'megattt',
    title: 'Mega Tac-Toe',
    levels: LEVELS,
    winFlag: 'mega-tac-toe-win',
    hardFlag: 'mega-tac-toe-hard',
    onlineWinFlag: 'mega-tac-toe-online-win',
    rules: `<ul>
      <li>Nine small tic-tac-toe boards make one big one. Win a small board to claim it.</li>
      <li>Where you play sends your opponent to the <b>matching board</b>: the top-right square sends them top-right.</li>
      <li>Sent to a board that's already finished? Play anywhere.</li>
      <li>Three big boards in a row wins. If nobody manages it, whoever won more boards wins.</li>
    </ul>`,
    onStart: s => {
      clearTimeout(cpuTimer);
      mode = s.mode;
      level = s.level;
      names = s.names;
      g = fresh(s.first);
      lastCell = -1;
      winLine = null;
      state = 'playing';
      updateHud();
      scheduleCpu();
    },
    onMove: data => apply(data.i | 0, 1 - Match.me),
    onStop: () => { state = 'over'; },
  });

  function updateHud() {
    const me = mode === 'online' ? Match.me : 0;
    $('you').textContent = g.small.filter(v => v === me).length;
    $('them').textContent = g.small.filter(v => v === 1 - me).length;
    $('turn').textContent = state !== 'playing' ? '-' : mode === 'local' ? names[g.turn] : g.turn === me ? 'Yours' : mode === 'cpu' ? 'Computer' : 'Theirs';
  }

  // ---------- Input ----------

  const cellPos = i => {
    const b = Math.floor(i / 9), k = i % 9;
    return [BX + (b % 3) * (SMALL + GAP) + (k % 3) * CELL, BY + Math.floor(b / 3) * (SMALL + GAP) + Math.floor(k / 3) * CELL];
  };

  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    for (let i = 0; i < 81; i++) {
      const [x, y] = cellPos(i);
      if (px >= x && px < x + CELL && py >= y && py < y + CELL) return i;
    }
    return -1;
  }

  canvas.addEventListener('pointermove', e => { hover = cellAt(e); });
  canvas.addEventListener('pointerleave', () => { hover = -1; });
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing' || !Match.mine(g.turn)) return;
    const i = cellAt(e);
    if (i >= 0 && apply(i, g.turn)) Match.move({ i });
  });

  // ---------- Drawing ----------

  function mark(p, x, y, size, width, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COLORS[p];
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    const m = size * 0.24;
    ctx.beginPath();
    if (p === 0) {
      ctx.moveTo(x + m, y + m); ctx.lineTo(x + size - m, y + size - m);
      ctx.moveTo(x + size - m, y + m); ctx.lineTo(x + m, y + size - m);
    } else {
      ctx.arc(x + size / 2, y + size / 2, size / 2 - m, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, W, H);
    if (!g) return;
    const open = state === 'playing' ? new Set(legal(g).map(i => Math.floor(i / 9))) : new Set();

    for (let b = 0; b < 9; b++) {
      const x = BX + (b % 3) * (SMALL + GAP), y = BY + Math.floor(b / 3) * (SMALL + GAP);
      ctx.fillStyle = open.has(b) ? (g.turn ? 'rgba(79,140,255,0.13)' : 'rgba(255,197,61,0.13)') : '#161920';
      ctx.beginPath();
      ctx.roundRect(x, y, SMALL, SMALL, 10);
      ctx.fill();
      if (open.has(b)) {
        ctx.strokeStyle = COLORS[g.turn];
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.strokeStyle = '#2a2f39';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 1; k < 3; k++) {
        ctx.moveTo(x + k * CELL, y + 8); ctx.lineTo(x + k * CELL, y + SMALL - 8);
        ctx.moveTo(x + 8, y + k * CELL); ctx.lineTo(x + SMALL - 8, y + k * CELL);
      }
      ctx.stroke();
      for (let k = 0; k < 9; k++) {
        const i = b * 9 + k, v = g.cells[i];
        const [cx, cy] = cellPos(i);
        if (v !== -1) mark(v, cx, cy, CELL, 5, g.small[b] === -1 ? 1 : 0.35);
        if (i === lastCell && state === 'playing') {
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(cx + 3, cy + 3, CELL - 6, CELL - 6);
        }
      }
      if (hover >= 0 && Math.floor(hover / 9) === b && g.cells[hover] === -1 && open.has(b) && Match.mine(g.turn)) {
        const [cx, cy] = cellPos(hover);
        mark(g.turn, cx, cy, CELL, 5, 0.4);
      }
      if (g.small[b] === 0 || g.small[b] === 1) mark(g.small[b], x, y, SMALL, 12, winLine && !winLine.includes(b) ? 0.5 : 0.95);
      if (g.small[b] === 2) {
        ctx.fillStyle = 'rgba(14,16,20,0.5)';
        ctx.beginPath(); ctx.roundRect(x, y, SMALL, SMALL, 10); ctx.fill();
      }
    }

    ctx.textAlign = 'center';
    ctx.font = '600 14px system-ui, sans-serif';
    if (state === 'playing') {
      ctx.fillStyle = COLORS[g.turn];
      const who = mode === 'local' ? `${names[g.turn]}'s turn` : Match.mine(g.turn) ? 'Your turn' : `${names[g.turn]} is thinking…`;
      ctx.fillText(`${who}${g.next === -1 || g.small[g.next] !== -1 ? ' · play on any open board' : ''}`, W / 2, 32);
    }
    ctx.fillStyle = '#8d94a1';
    ctx.fillText(Match.label(), W / 2, H - 14);
  }

  function frame() {
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
