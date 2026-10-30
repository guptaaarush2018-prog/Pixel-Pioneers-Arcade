(() => {
  const N = 7, CELL = 64, W = 560, H = 600;
  const BX = (W - N * CELL) / 2, BY = 112;
  const COLORS = ['#ffc53d', '#4f8cff'];
  const LEVELS = ['Easy', 'Normal', 'Hard'];
  const DEPTH = [2, 4, 6];
  const BASE = [400, 800, 1400];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu', mode = null, level = 1, names = ['You', 'Computer'];
  let board, turn, tilts, hover = -1, last = null, winLine = null, anim = null, cpuTimer = null, lastMove = null, queue = [];

  // ---------- Rules ----------

  const empty = () => Array.from({ length: N }, () => Array(N).fill(-1));
  const copy = b => b.map(r => r.slice());

  function dropRow(b, c) {
    for (let r = N - 1; r >= 0; r--) if (b[r][c] === -1) return r;
    return -1;
  }

  // Turns the board a quarter turn (dir 1 clockwise, -1 the other way), then lets every piece fall.
  // Returns where each piece came from, for the fall animation.
  function tilt(b, dir) {
    const t = empty();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (dir === 1) t[r][c] = b[N - 1 - c][r];
      else t[r][c] = b[c][N - 1 - r];
    }
    const from = empty();
    for (let c = 0; c < N; c++) {
      let w = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        if (t[r][c] === -1) continue;
        const v = t[r][c];
        t[r][c] = -1;
        t[w][c] = v;
        from[w][c] = r;
        w--;
      }
    }
    for (let r = 0; r < N; r++) b[r] = t[r];
    return from;
  }

  const DIRS4 = [[0, 1], [1, 0], [1, 1], [1, -1]];
  function fours(b, p) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (b[r][c] !== p) continue;
      for (const [dr, dc] of DIRS4) {
        const line = [[r, c]];
        for (let k = 1; k < 4; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr >= N || cc < 0 || cc >= N || b[rr][cc] !== p) break;
          line.push([rr, cc]);
        }
        if (line.length === 4) return line;
      }
    }
    return null;
  }

  const full = b => b[0].every(v => v !== -1);

  // Returns the outcome after a legal move: null to carry on, or { winner, line } (winner -1 is a draw).
  function apply(move, p) {
    if (state !== 'playing' || p !== turn || anim) return false;
    let from = null;
    if (move.t === 'drop') {
      const c = move.c | 0;
      if (c < 0 || c >= N) return false;
      const r = dropRow(board, c);
      if (r < 0) return false;
      board[r][c] = p;
      last = [r, c];
      anim = { kind: 'drop', r, c, t: 0 };
      Arcade.tone({ freq: 300 + r * 30, dur: 0.06, vol: 0.04 });
    } else if (move.t === 'tilt') {
      if (!tilts[p] || (move.d !== 1 && move.d !== -1)) return false;
      tilts[p]--;
      const before = copy(board);
      from = tilt(board, move.d);
      last = null;
      anim = { kind: 'tilt', d: move.d, before, from, t: 0 };
      Arcade.tone({ freq: 180, to: 90, dur: 0.5, type: 'sawtooth', vol: 0.05 });
    } else return false;
    lastMove = { t: move.t, p };
    turn = 1 - p;
    updateHud();
    return true;
  }

  function outcome() {
    const a = fours(board, 0), b = fours(board, 1);
    if (a && b) return { winner: -1, line: null };
    if (a) return { winner: 0, line: a };
    if (b) return { winner: 1, line: b };
    if (full(board)) return { winner: -1, line: null };
    return null;
  }

  // ---------- Computer ----------

  function evaluate(b, p) {
    let s = 0;
    for (let r = 0; r < N; r++) s += (b[r][3] === p ? 3 : b[r][3] === 1 - p ? -3 : 0);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      for (const [dr, dc] of DIRS4) {
        const er = r + dr * 3, ec = c + dc * 3;
        if (er >= N || ec < 0 || ec >= N) continue;
        let mine = 0, theirs = 0;
        for (let k = 0; k < 4; k++) {
          const v = b[r + dr * k][c + dc * k];
          if (v === p) mine++;
          else if (v === 1 - p) theirs++;
        }
        if (mine && theirs) continue;
        if (mine === 3) s += 8;
        else if (mine === 2) s += 2;
        if (theirs === 3) s -= 10;
        else if (theirs === 2) s -= 2;
      }
    }
    return s;
  }

  const ORDER = [3, 2, 4, 1, 5, 0, 6];
  function search(b, depth, alpha, beta, p, me) {
    const mineWin = fours(b, me), theirWin = fours(b, 1 - me);
    if (mineWin && !theirWin) return 10000 + depth;
    if (theirWin && !mineWin) return -10000 - depth;
    if (mineWin && theirWin) return 0;
    if (full(b)) return 0;
    if (depth === 0) return evaluate(b, me);
    let best = p === me ? -Infinity : Infinity;
    for (const c of ORDER) {
      const r = dropRow(b, c);
      if (r < 0) continue;
      b[r][c] = p;
      const v = search(b, depth - 1, alpha, beta, 1 - p, me);
      b[r][c] = -1;
      if (p === me) { best = Math.max(best, v); alpha = Math.max(alpha, v); }
      else { best = Math.min(best, v); beta = Math.min(beta, v); }
      if (beta <= alpha) break;
    }
    return best;
  }

  // Looks at every drop, plus both tilts while it still has one.
  function cpuMove() {
    const depth = DEPTH[level];
    const options = [];
    for (const c of ORDER) {
      const r = dropRow(board, c);
      if (r < 0) continue;
      const b = copy(board);
      b[r][c] = 1;
      options.push({ move: { t: 'drop', c }, v: search(b, depth - 1, -Infinity, Infinity, 0, 1) });
    }
    if (tilts[1] && level > 0 && board.flat().filter(v => v !== -1).length >= 6) {
      for (const d of [1, -1]) {
        const b = copy(board);
        tilt(b, d);
        options.push({ move: { t: 'tilt', d }, v: search(b, depth - 1, -Infinity, Infinity, 0, 1) - 5 });
      }
    }
    if (level === 0 && Math.random() < 0.3) return Arcade.pick(options.filter(o => o.move.t === 'drop')).move;
    const top = Math.max(...options.map(o => o.v));
    return Arcade.pick(options.filter(o => o.v === top)).move;
  }

  function scheduleCpu() {
    clearTimeout(cpuTimer);
    if (mode !== 'cpu' || state !== 'playing' || turn !== 1) return;
    cpuTimer = setTimeout(() => {
      if (state === 'playing' && turn === 1 && !anim) apply(cpuMove(), 1);
      else scheduleCpu();
    }, 500);
  }

  // ---------- Flow ----------

  // Runs once each move's animation has finished.
  function settle() {
    const o = outcome();
    if (o) return end(o);
    if (queue.length) apply(queue.shift(), 1 - Match.me);
    scheduleCpu();
  }

  function end({ winner, line }) {
    state = 'over';
    winLine = line;
    Arcade.tone(winner === -1 ? { freq: 440, dur: 0.3, vol: 0.04 } : { freq: 523, to: 1046, dur: 0.4, type: 'triangle', vol: 0.06 });
    const left = board.flat().filter(v => v === -1).length;
    const score = winner === 0 ? BASE[level] + left * 10 : winner === -1 ? Math.round(BASE[level] / 4) : 0;
    const byTilt = winner !== -1 && lastMove?.t === 'tilt' && lastMove.p === winner;
    if (byTilt && Match.mine(winner) && mode !== 'local') Arcade.flag('gravity-four-tilt');
    setTimeout(() => Match.over({
      winner,
      score,
      lines: [winner === -1 ? 'Nobody connected four.' : byTilt ? `${names[winner]} won with a tilt!` : `${names[winner]} connected four.`],
    }), 900);
  }

  Match.setup({
    ui,
    tag: 'gravity4',
    title: 'Gravity Four',
    levels: LEVELS,
    winFlag: 'gravity-four-win',
    hardFlag: 'gravity-four-hard',
    onlineWinFlag: 'gravity-four-online-win',
    rules: `<ul>
      <li>Drop pieces into the 7×7 board. Four in a row in any direction wins.</li>
      <li>Once per game you can <b>tilt</b> the board a quarter turn instead of dropping. Every piece falls to the new bottom.</li>
      <li>If a tilt makes four in a row for both players, it's a draw.</li>
    </ul>`,
    onStart: s => {
      clearTimeout(cpuTimer);
      mode = s.mode;
      level = s.level;
      names = s.names;
      board = empty();
      turn = s.first;
      tilts = [1, 1];
      last = null;
      winLine = null;
      anim = null;
      lastMove = null;
      queue = [];
      state = 'playing';
      updateHud();
      scheduleCpu();
    },
    // A move can land while the last one is still animating; it waits its turn.
    onMove: data => { if (anim) queue.push(data); else apply(data, 1 - Match.me); },
    onStop: () => { state = 'over'; },
  });

  function updateHud() {
    if (!board) return;
    const me = mode === 'online' ? Match.me : 0;
    $('turn').textContent = state !== 'playing' ? '-' : mode === 'local' ? names[turn] : turn === me ? 'Yours' : mode === 'cpu' ? 'Computer' : 'Theirs';
    $('tilt').textContent = mode === 'local' ? `${tilts[0]} · ${tilts[1]}` : tilts[me];
    const canTilt = state === 'playing' && Match.mine(turn) && tilts[turn] > 0 && !anim;
    $('tilt-l').disabled = $('tilt-r').disabled = !canTilt;
  }

  // ---------- Input ----------

  function play(move) {
    if (state !== 'playing' || !Match.mine(turn) || anim) return;
    const p = turn;
    if (apply(move, p)) Match.move(move);
  }

  function colAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const c = Math.floor((x - BX) / CELL);
    return c >= 0 && c < N ? c : -1;
  }

  canvas.addEventListener('pointermove', e => { hover = colAt(e); });
  canvas.addEventListener('pointerleave', () => { hover = -1; });
  canvas.addEventListener('pointerdown', e => {
    const c = colAt(e);
    if (c >= 0) play({ t: 'drop', c });
  });
  $('tilt-l').addEventListener('click', e => { e.target.blur(); play({ t: 'tilt', d: -1 }); });
  $('tilt-r').addEventListener('click', e => { e.target.blur(); play({ t: 'tilt', d: 1 }); });
  window.addEventListener('keydown', e => {
    if (!$('overlay').hidden) return;
    if (/^Digit[1-7]$/.test(e.code)) play({ t: 'drop', c: +e.code.slice(5) - 1 });
    else if (e.code === 'ArrowLeft') hover = Math.max(0, (hover < 0 ? 3 : hover) - 1);
    else if (e.code === 'ArrowRight') hover = Math.min(N - 1, (hover < 0 ? 3 : hover) + 1);
    else if ((e.code === 'Space' || e.code === 'ArrowDown') && hover >= 0) play({ t: 'drop', c: hover });
    else if (e.code === 'KeyQ') play({ t: 'tilt', d: -1 });
    else if (e.code === 'KeyE') play({ t: 'tilt', d: 1 });
  });

  // ---------- Drawing ----------

  function piece(x, y, p, alpha = 1, ring = false) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS[p];
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(x - 6, y - 7, CELL * 0.17, 0, Math.PI * 2);
    ctx.fill();
    if (ring) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, CELL * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const cx = c => BX + c * CELL + CELL / 2, cy = r => BY + r * CELL + CELL / 2;

  function drawBoard(b, fallFrom, k) {
    ctx.fillStyle = '#1b2a52';
    ctx.beginPath();
    ctx.roundRect(BX - 8, BY - 8, N * CELL + 16, N * CELL + 16, 14);
    ctx.fill();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      ctx.fillStyle = '#0e1014';
      ctx.beginPath();
      ctx.arc(cx(c), cy(r), CELL * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = b[r][c];
      if (v === -1) continue;
      let y = cy(r);
      if (fallFrom && fallFrom[r][c] !== -1) y = cy(fallFrom[r][c]) + (cy(r) - cy(fallFrom[r][c])) * k;
      const inLine = winLine?.some(([a, d]) => a === r && d === c);
      piece(cx(c), y, v, 1, inLine || (last && last[0] === r && last[1] === c && state === 'playing'));
    }
  }

  function draw(dt) {
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, W, H);
    if (!board) return;

    // Hover piece above the board
    if (state === 'playing' && hover >= 0 && Match.mine(turn) && !anim && dropRow(board, hover) >= 0) {
      piece(cx(hover), BY - 46, turn, 0.75);
    }

    if (anim?.kind === 'tilt') {
      anim.t += dt;
      const spin = Math.min(1, anim.t / 0.45);
      if (spin < 1) {
        const e = spin * spin * (3 - 2 * spin);
        ctx.save();
        ctx.translate(BX + N * CELL / 2, BY + N * CELL / 2);
        ctx.rotate(anim.d * e * Math.PI / 2);
        ctx.translate(-(BX + N * CELL / 2), -(BY + N * CELL / 2));
        drawBoard(anim.before, null, 1);
        ctx.restore();
      } else {
        const k = Math.min(1, (anim.t - 0.45) / 0.35);
        drawBoard(board, anim.from, k * k);
        if (k >= 1) { anim = null; updateHud(); settle(); }
      }
    } else if (anim?.kind === 'drop') {
      anim.t += dt;
      const k = Math.min(1, anim.t / 0.28);
      const v = board[anim.r][anim.c];
      board[anim.r][anim.c] = -1;
      drawBoard(board, null, 1);
      board[anim.r][anim.c] = v;
      const y = BY - 46 + (cy(anim.r) - (BY - 46)) * k * k;
      piece(cx(anim.c), y, v);
      if (k >= 1) { anim = null; updateHud(); settle(); }
    } else {
      drawBoard(board, null, 1);
    }

    ctx.textAlign = 'center';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillStyle = '#8d94a1';
    if (state === 'playing') {
      const who = mode === 'local' ? names[turn] : Match.mine(turn) ? 'Your turn' : `${names[turn]}'s turn`;
      ctx.fillStyle = COLORS[turn];
      ctx.fillText(who + (Match.mine(turn) && tilts[turn] ? ' · drop or tilt (Q / E)' : ''), W / 2, 30);
    }
    ctx.fillStyle = '#8d94a1';
    ctx.fillText(Match.label(), W / 2, H - 14);
  }

  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    draw(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
