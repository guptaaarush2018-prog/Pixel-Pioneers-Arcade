/* Chroma Burst: a chain-reaction territory game. On your first turn you drop a three-dot cell on
   any empty square. After that, tap one of your own cells to add a dot. A cell that reaches four
   dots bursts: it empties and throws one dot into each open square beside it, turning those
   squares your colour, and full neighbours burst in turn. Wipe every rival colour off the board
   to win.
   Six boards (some with walls), three weekly challenges, bots up to Master, a same-device mode
   and online 1v1 matches through match.js: both players run these same rules, each sending only
   the square they tapped. */
(() => {
  const W = 640, H = 700, TAU = Math.PI * 2;
  const COLORS = [
    { name: 'Gold', fill: '#ffc53d', glow: '255,197,61', rgb: [255, 197, 61] },
    { name: 'Coral', fill: '#ff5d7a', glow: '255,93,122', rgb: [255, 93, 122] },
    { name: 'Teal', fill: '#36d6c3', glow: '54,214,195', rgb: [54, 214, 195] },
    { name: 'Violet', fill: '#a46bff', glow: '164,107,255', rgb: [164, 107, 255] },
  ];
  const LEVELS = ['Easy', 'Normal', 'Hard', 'Master'];
  const MULT = [1, 1.6, 2.4, 3.2];
  const WAVE = 0.17;   // seconds per burst wave

  // Boards. '#' is a wall: no dots, and bursts skip it. Classic is a plain square in three sizes.
  const BOARDS = [
    { id: 'classic', name: 'Classic', sizes: [5, 7, 9] },
    { id: 'cross', name: 'Cross', rows: ['##...##', '##...##', '.......', '.......', '.......', '##...##', '##...##'] },
    { id: 'pillars', name: 'Pillars', rows: ['.......', '.#...#.', '.......', '...#...', '.......', '.#...#.', '.......'] },
    { id: 'donut', name: 'Donut', rows: ['.......', '.......', '..###..', '..###..', '..###..', '.......', '.......'] },
    { id: 'bridge', name: 'Bridge', rows: ['...#...', '...#...', '...#...', '.......', '...#...', '...#...', '...#...'] },
    { id: 'diamond', name: 'Diamond', rows: ['####.####', '###...###', '##.....##', '#.......#', '.........', '#.......#', '##.....##', '###...###', '####.####'] },
  ];
  const boardById = id => BOARDS.find(b => b.id === id) || BOARDS[0];
  function layout(boardId, size) {
    const b = boardById(boardId);
    if (!b.rows) {
      const n = b.sizes.includes(size) ? size : 5;
      return { n, walls: null, name: `Classic ${n}×${n}` };
    }
    return { n: b.rows.length, walls: b.rows.join('').split('').map(c => c === '#'), name: b.name };
  }

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const esc = s => Online.escape(s);

  let opts = { board: Arcade.load('chroma:boardId', 'classic'), size: Arcade.load('chroma:size', 5), rivals: Arcade.load('chroma:rivals', 1) };
  let state = 'menu';
  let n, cells, adj, players, turn, placed, moveNo, myMoves, waveT, flying, pops, sparks, time, botT, biggest, chainNow;
  let cell, ox, oy, hover, lastCell, shake, bannerRGB, barW, queue, boardName, playMode, weekly;

  // ---------- Rules (shared by play and the bots' look-ahead) ----------

  const clone = b => b.map(c => ({ o: c.o, d: c.d }));
  const alive = (b, pl, placedSet) => pl.filter(p => !placedSet.has(p) || b.some(c => c.o === p));

  // One wave: every full cell bursts at once. Returns the bursting cells (empty when settled).
  function wave(b, owner) {
    const full = [];
    for (let i = 0; i < b.length; i++) if (b[i].d >= 4) full.push(i);
    for (const i of full) {
      b[i].d -= 4;
      if (b[i].d === 0) b[i].o = -1;
      for (const j of adj[i]) { b[j].d++; b[j].o = owner; }
    }
    return full;
  }
  // Resolve completely (for the bots). Stops once only one colour is left.
  function settle(b, owner, placedSet, pl) {
    for (let waves = 0; waves < 400; waves++) {
      if (!wave(b, owner).length) break;
      if (placedSet && alive(b, pl, placedSet).length <= 1) break;
    }
  }
  function apply(b, p, i, first) {
    if (first) { b[i].o = p; b[i].d = 3; } else b[i].d++;
  }
  const legal = (b, p, first) => {
    const out = [];
    for (let i = 0; i < b.length; i++) if (!wallAt[i] && (first ? b[i].o === -1 : b[i].o === p)) out.push(i);
    return out;
  };
  let wallAt = [];

  // ---------- Bots ----------

  function evaluate(b, me, ps) {
    let s = 0;
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c.o === -1) continue;
      const v = c.d + 1.5;
      if (c.o === me) {
        s += v + (adj[i].length <= 3 ? 0.4 : 0);   // edges and corners are harder to attack
        // A cell next to a rival cell that is about to burst gets stolen.
        for (const j of adj[i]) if (b[j].o !== -1 && b[j].o !== me && b[j].d >= 3) s -= 0.8 + c.d * 0.5;
      } else {
        s -= v;
        for (const j of adj[i]) if (b[j].o === me && c.d >= 3) s += 0.5;   // ...and ours can steal theirs
      }
    }
    const others = players.filter(q => q !== me);
    if (others.every(q => ps.has(q)) && !b.some(c => c.o !== -1 && c.o !== me)) s += 1000;
    if (ps.has(me) && !b.some(c => c.o === me)) s -= 1000;
    return s;
  }

  function nextAlive(p, b = cells, ps = placed) {
    for (let k = 1; k <= players.length; k++) {
      const q = players[(players.indexOf(p) + k) % players.length];
      if (!ps.has(q) || b.some(c => c.o === q)) return q;
    }
    return null;
  }

  // Look-ahead: every move for the player to move is tried, the best few are searched deeper.
  // Everyone but `me` is assumed to play their strongest reply against me.
  function search(b, p, ps, depth, me, alpha, beta, width) {
    const first = !ps.has(p);
    const moves = legal(b, p, first);
    const ps2 = new Set(ps); ps2.add(p);
    const kids = moves.map(m => {
      const c = clone(b);
      apply(c, p, m, first);
      settle(c, p, ps2, players);
      return { m, c, v: evaluate(c, me, ps2) };
    });
    if (!kids.length) return { v: evaluate(b, me, ps), m: -1 };
    const maxing = p === me;
    kids.sort((x, y) => (maxing ? y.v - x.v : x.v - y.v));
    let best = { v: maxing ? -Infinity : Infinity, m: kids[0].m };
    for (const k of kids.slice(0, depth > 1 ? width : 1)) {
      let v = k.v;
      if (depth > 1 && Math.abs(v) < 900) {
        const nxt = nextAlive(p, k.c, ps2);
        if (nxt !== null) v = search(k.c, nxt, ps2, depth - 1, me, alpha, beta, width).v;
      }
      if (maxing ? v > best.v : v < best.v) best = { v, m: k.m };
      if (maxing) alpha = Math.max(alpha, v); else beta = Math.min(beta, v);
      if (beta <= alpha) break;
    }
    return best;
  }

  function botMove(p) {
    const first = !placed.has(p);
    const moves = legal(cells, p, first);
    const lv = Match.level;
    if (lv === 0 && Math.random() < 0.55) return moves[Math.floor(Math.random() * moves.length)];
    const depth = [1, 1, 2, 3][lv];
    const best = search(cells, p, placed, depth, p, -Infinity, Infinity, lv === 3 ? 7 : 5);
    // Easy and Normal wobble a little so they aren't predictable.
    if (lv <= 1 && Math.random() < 0.15) return moves[Math.floor(Math.random() * moves.length)];
    return best.m >= 0 ? best.m : moves[0];
  }

  // ---------- Weekly challenges ----------

  // Three a week, the same for everyone, picked from the ISO week number.
  const weekKey = () => {
    const d = new Date(), t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    return `${y}-W${Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)}`;
  };
  const daysLeft = () => { const d = new Date().getDay(); return d === 1 ? 7 : (8 - d) % 7 || 7; };
  const WEEKLY_REWARD = 20, WEEKLY_BONUS = 20;

  function weeklySet() {
    const key = weekKey();
    let h = 2166136261;
    for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const rng = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
    const pickOf = a => a[Math.floor(rng() * a.length)];
    const walled = BOARDS.slice(1);
    const bA = pickOf(walled), bB = pickOf(BOARDS.filter(b => b !== bA)), bC = pickOf(BOARDS);
    const mk = (b, rivals, level, kind, goal) => {
      const lay = layout(b.id, b.rows ? 0 : pickOf(b.sizes));
      const open = lay.walls ? lay.walls.filter(w => !w).length : lay.n * lay.n;
      const g = kind === 'fast' ? Math.round(open * 0.4) : kind === 'area' ? 100 : goal;
      return { id: `${key}:${kind}`, kind, board: b.id, size: lay.n, boardName: lay.name, rivals, level, goal: g, open };
    };
    const list = [
      mk(bA, 1 + (rng() < 0.4 ? 1 : 0), 1 + (rng() < 0.5 ? 1 : 0), 'win'),
      mk(bB, 1, rng() < 0.5 ? 1 : 2, rng() < 0.5 ? 'fast' : 'area'),
      mk(bC, 2, 0, 'chain', 8 + Math.floor(rng() * 6)),
    ];
    for (const c of list) {
      const who = `${c.rivals} ${LEVELS[c.level]} rival${c.rivals > 1 ? 's' : ''}`;
      c.text = c.kind === 'win' ? `Win on ${c.boardName} against ${who}`
        : c.kind === 'fast' ? `Win on ${c.boardName} against ${who} in ${c.goal} of your own moves or fewer`
        : c.kind === 'area' ? `Win on ${c.boardName} against ${who} with the board at least ${Math.round(c.open * 0.45)} squares full of your colour`
        : `Set off a chain of ${c.goal} bursts in one move on ${c.boardName} against ${who}`;
      if (c.kind === 'area') c.goal = Math.round(c.open * 0.45);
    }
    return { key, list };
  }
  const weeklyState = () => {
    const key = weekKey();
    let s = Arcade.load('chroma:weekly', null);
    if (!s || s.week !== key) { s = { week: key, done: [], streak: s?.streak || 0, perfect: s?.perfect || 0 }; Arcade.save('chroma:weekly', s); }
    return s;
  };
  function weeklyDone(c) {
    if (Arcade.commandUsed()) return;
    const s = weeklyState();
    if (s.done.includes(c.id)) return;
    s.done.push(c.id);
    Arcade.addTickets(WEEKLY_REWARD);
    Arcade.toast('Weekly challenge done', `${c.text} · +${WEEKLY_REWARD} tickets`);
    if (s.done.length >= 3) {
      Arcade.addTickets(WEEKLY_BONUS);
      s.streak++;
      Arcade.flag('chroma-burst-weekly');
      Arcade.toast('All weekly challenges done', `+${WEEKLY_BONUS} bonus tickets`);
    }
    Arcade.save('chroma:weekly', s);
  }

  // ---------- Game flow ----------

  function newGame({ mode, me, first, names, data }) {
    playMode = mode;
    const board = data.board || (mode === 'cpu' ? opts.board : 'classic');
    const lay = layout(board, data.size || opts.size);
    n = lay.n;
    boardName = lay.name;
    wallAt = lay.walls || Array(n * n).fill(false);
    cell = Math.floor(560 / n);
    ox = (W - cell * n) / 2;
    oy = 116 + (560 - cell * n) / 2;
    cells = Array.from({ length: n * n }, (_, i) => ({ o: -1, d: 0, pop: 0, born: 1, from: -1, fade: 1, wall: wallAt[i] }));
    adj = cells.map((_, i) => {
      if (wallAt[i]) return [];
      const x = i % n, y = Math.floor(i / n), out = [];
      if (x > 0) out.push(i - 1);
      if (x < n - 1) out.push(i + 1);
      if (y > 0) out.push(i - n);
      if (y < n - 1) out.push(i + n);
      return out.filter(j => !wallAt[j]);
    });
    const count = mode === 'cpu' ? (weekly ? weekly.rivals : opts.rivals) + 1 : 2;
    players = Array.from({ length: count }, (_, i) => i);
    placed = new Set();
    turn = mode === 'cpu' ? 0 : first;
    moveNo = 0;
    myMoves = 0;
    flying = []; pops = []; sparks = []; queue = [];
    time = 0;
    botT = 0.7;
    biggest = 0;
    chainNow = 0;
    hover = -1;
    lastCell = -1;
    shake = 0;
    bannerRGB = COLORS[turn].rgb.slice();
    barW = players.map(() => 0);
    state = 'playing';
    updateHud();
  }

  const nameOf = p => (playMode === 'cpu' ? (p === 0 ? 'You' : `${COLORS[p].name} bot`) : playMode === 'local' ? `Player ${p + 1}` : Match.names[p]);

  function play(i) {
    if (state !== 'playing') return false;
    const p = turn, first = !placed.has(p);
    if (!cells[i] || cells[i].wall || (first ? cells[i].o !== -1 : cells[i].o !== p)) return false;
    apply(cells, p, i, first);
    if (first) { cells[i].born = 0; cells[i].from = -1; }
    cells[i].pop = 1;
    lastCell = i;
    placed.add(p);
    moveNo++;
    if (Match.mine(p)) myMoves++;
    chainNow = 0;
    Arcade.tone({ freq: 520 + cells[i].d * 90, dur: 0.06, type: 'triangle', vol: 0.05 });
    state = 'resolving';
    waveT = cells.some(c => c.d >= 4) ? WAVE * 0.6 : 0;
    return true;
  }

  function burstWave() {
    const owner = turn;
    const before = cells.map(c => c.o);
    const full = wave(cells, owner);
    if (!full.length) return false;
    chainNow += full.length;
    biggest = Math.max(biggest, chainNow);
    cells.forEach((c, i) => { if (c.o !== before[i]) { c.from = before[i]; c.fade = 0; if (before[i] === -1) c.born = 0; } });
    for (const i of full) {
      const from = center(i);
      for (const j of adj[i]) { flying.push({ from, to: center(j), t: 0, col: COLORS[owner].fill }); cells[j].pop = 1; }
      pops.push({ ...from, t: 0, col: COLORS[owner].glow });
      for (let k = 0; k < 7; k++) {
        const a = Math.random() * TAU, v = 40 + Math.random() * 90;
        sparks.push({ x: from.x, y: from.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.35 + Math.random() * 0.3, col: COLORS[owner].fill });
      }
    }
    shake = Math.min(7, shake + Math.min(chainNow, 14) * 0.35);
    Arcade.tone({ freq: 300 + Math.min(chainNow, 20) * 40, to: 160, dur: 0.12, type: 'sawtooth', vol: 0.035 });
    if (Match.mine(owner) && playMode !== 'local' && chainNow >= 12) Arcade.flag('chroma-burst-chain');
    if (weekly && weekly.kind === 'chain' && owner === 0 && chainNow >= weekly.goal && !weekly.hit) { weekly.hit = true; weeklyDone(weekly); }
    return true;
  }

  function afterMove() {
    const left = alive(cells, players, placed);
    if (placed.size >= players.length && left.length === 1) return gameOver(left[0]);
    if (playMode === 'cpu' && placed.has(0) && !cells.some(c => c.o === 0)) return gameOver(left[0] ?? -1);
    turn = nextAlive(turn);
    botT = 0.5 + Math.random() * 0.25;
    state = 'playing';
    updateHud();
  }

  function gameOver(winner) {
    state = 'over';
    const mine = cells.filter(c => c.o === 0).length;
    if (playMode !== 'cpu') {
      setTimeout(() => Match.over({ winner, score: 0, lines: [`${boardName} · ${moveNo} moves · biggest chain ${biggest}`] }), 700);
      return;
    }
    const won = winner === 0;
    const rivals = players.length - 1, lvl = Match.level;
    if (won) {
      Arcade.flag('chroma-burst-win');
      if (lvl >= 2) Arcade.flag('chroma-burst-hard');
      if (lvl === 3) Arcade.flag('chroma-burst-master');
      if (rivals === 3) Arcade.flag('chroma-burst-brawl');
      if (boardById(opts.board).rows && !weekly) Arcade.flag('chroma-burst-board');
    }
    let weeklyNote = '';
    if (weekly && won) {
      const w = weekly;
      if (w.kind === 'win' || (w.kind === 'fast' && myMoves <= w.goal) || (w.kind === 'area' && mine >= w.goal)) { weeklyDone(w); weeklyNote = 'Challenge complete!'; }
      else if (w.kind === 'fast') weeklyNote = `Won in ${myMoves} moves; the challenge needs ${w.goal} or fewer.`;
      else if (w.kind === 'area') weeklyNote = `You held ${mine} squares; the challenge needs ${w.goal}.`;
    }
    if (weekly && weekly.kind === 'chain' && weekly.hit) weeklyNote = 'Challenge complete!';
    const score = Math.round(((won ? 1000 + mine * 15 + Math.max(0, 60 - moveNo) * 10 : Math.min(moveNo, 40) * 8) + Math.min(biggest, 30) * 20) * MULT[lvl] * (1 + (rivals - 1) * 0.35) * (boardById(opts.board).rows ? 1.1 : 1));
    Arcade.tone({ freq: won ? 660 : 300, to: won ? 1320 : 120, dur: 0.4, type: 'triangle', vol: 0.06 });
    Arcade.finish(ui, {
      score,
      title: won ? 'Board painted!' : `${COLORS[winner]?.name || 'A rival'} takes the board`,
      lines: [`${boardName} · ${rivals} ${LEVELS[lvl]} rival${rivals > 1 ? 's' : ''} · ${moveNo} moves · biggest chain ${biggest}`, ...(weeklyNote ? [`<b>${esc(weeklyNote)}</b>`] : [])],
      button: 'Menu',
      onAction: () => { weekly = null; Match.menu(); },
    });
  }

  // ---------- Update and drawing ----------

  const center = i => ({ x: ox + (i % n) * cell + cell / 2, y: oy + Math.floor(i / n) * cell + cell / 2 });
  const easeOutBack = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2; };

  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt * 14);
    if (cells) {
      for (const c of cells) {
        c.pop = Math.max(0, c.pop - dt * 4);
        c.born = Math.min(1, c.born + dt * 4);
        c.fade = Math.min(1, c.fade + dt * 5);
      }
      for (let p = 0; p < players.length; p++) {
        const tot = cells.reduce((s, c) => s + (c.o >= 0 ? c.d : 0), 0) || 1;
        const mine = cells.reduce((s, c) => s + (c.o === p ? c.d : 0), 0);
        barW[p] += (mine / tot - barW[p]) * Math.min(1, dt * 7);
      }
      const want = COLORS[turn].rgb;
      for (let k = 0; k < 3; k++) bannerRGB[k] += (want[k] - bannerRGB[k]) * Math.min(1, dt * 9);
    }
    for (const f of flying) f.t += dt / WAVE;
    flying = flying.filter(f => f.t < 1);
    for (const p of pops) p.t += dt * 2.5;
    pops = pops.filter(p => p.t < 1);
    for (const s of sparks) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94; }
    sparks = sparks.filter(s => s.t < s.life);
    if (state === 'resolving') {
      waveT -= dt;
      if (waveT <= 0) {
        if (burstWave() && chainNow < 2000) {
          waveT = WAVE;
          if (placed.size >= players.length && alive(cells, players, placed).length <= 1) state = 'finishing';
        } else afterMove();
      }
    } else if (state === 'finishing') {
      waveT -= dt;
      if (waveT <= 0) afterMove();
    } else if (state === 'playing') {
      if (!Match.mine(turn)) {
        if (playMode === 'cpu') {
          botT -= dt;
          if (botT <= 0) play(botMove(turn));
        } else if (queue.length) play(queue.shift().i);   // online: the other player's tap
      }
    }
  }

  function drawDots(x, y, d, k) {
    const r = cell * 0.085 * k;
    const sp = cell * 0.16;
    const spots = d === 1 ? [[0, 0]] : d === 2 ? [[-1, 0], [1, 0]] : d === 3 ? [[0, -1.05], [-1, 0.6], [1, 0.6]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const spin = d >= 3 ? Math.sin(time * 5) * 0.12 : 0;
    const cs = Math.cos(spin), sn = Math.sin(spin);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (const [a, b] of spots) {
      ctx.beginPath();
      ctx.arc(x + (a * cs - b * sn) * sp, y + (a * sn + b * cs) * sp, r, 0, TAU);
      ctx.fill();
    }
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#12141d');
    bg.addColorStop(1, '#090a10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (!cells) return;
    ctx.save();
    if (shake > 0.1) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    const mineTurn = Match.mine(turn);
    ctx.textAlign = 'center';
    // Turn pill, tinted with whoever's turn it is.
    const [pr, pg, pb] = bannerRGB.map(Math.round);
    const label = state === 'over' ? 'Game over' : playMode === 'local' ? `${nameOf(turn)}'s turn` : mineTurn ? 'Your turn' : playMode === 'online' ? `${nameOf(turn)}'s turn` : `${COLORS[turn].name} is thinking…`;
    ctx.font = '700 17px system-ui, sans-serif';
    const pw = Math.max(150, ctx.measureText(label).width + 56);
    ctx.fillStyle = `rgba(${pr},${pg},${pb},0.14)`;
    ctx.strokeStyle = `rgba(${pr},${pg},${pb},0.55)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(W / 2 - pw / 2, 20, pw, 36, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
    const pulse = state === 'playing' ? 0.5 + Math.sin(time * 5) * 0.5 : 0.4;
    ctx.beginPath(); ctx.arc(W / 2 - pw / 2 + 20, 38, 4 + pulse * 1.5, 0, TAU); ctx.fill();
    ctx.fillText(label, W / 2 + 8, 44);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const hint = state === 'over' ? '' : !mineTurn ? (Match.label() || boardName)
      : !placed.has(turn) ? 'Drop a 3-dot cell on any empty square' : 'Tap one of your cells to add a dot · four dots burst';
    ctx.fillText(hint, W / 2, 76);
    // Territory bar.
    const barX = ox, barWd = cell * n;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.roundRect(barX, 90, barWd, 6, 3); ctx.fill();
    let bx = barX;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(barX, 90, barWd, 6, 3); ctx.clip();
    for (const p of players) {
      const w = barWd * barW[p];
      ctx.fillStyle = COLORS[p].fill;
      ctx.fillRect(bx, 90, w, 6);
      bx += w;
    }
    ctx.restore();
    // Board.
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], { x, y } = center(i);
      const s = cell - 8;
      if (c.wall) {
        ctx.fillStyle = '#1b1e2b';
        ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 10); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(x - s / 2 + 5, y - s / 2 + 5, s - 10, s - 10, 6); ctx.stroke();
        continue;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 12); ctx.fill();
      const legalHere = mineTurn && state === 'playing' && (placed.has(turn) ? c.o === turn : c.o === -1);
      if (i === hover && legalHere) {
        ctx.fillStyle = `rgba(${COLORS[turn].glow},0.12)`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${COLORS[turn].glow},0.8)`;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (legalHere && !placed.has(turn)) {
        ctx.fillStyle = `rgba(${COLORS[turn].glow},${0.05 + 0.05 * Math.sin(time * 3 + i)})`;
        ctx.fill();
      }
      if (i === lastCell && state !== 'menu') {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 12); ctx.stroke();
      }
      if (c.o === -1) continue;
      const col = COLORS[c.o];
      const ready = c.d >= 3;
      const born = easeOutBack(c.born);
      const k = (1 + c.pop * 0.22 + (ready ? Math.sin(time * 8 + i) * 0.035 : 0)) * (c.born < 1 ? Math.max(0.05, born) : 1);
      const r = s * 0.42 * k;
      if (ready) {
        const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.6);
        g.addColorStop(0, `rgba(${col.glow},0.38)`);
        g.addColorStop(1, `rgba(${col.glow},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, TAU); ctx.fill();
      }
      const body = (o, rr) => {
        const cc = COLORS[o];
        const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.1, x, y, rr);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.25, cc.fill);
        g.addColorStop(1, `rgba(${cc.glow},0.72)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
      };
      // A captured cell is repainted from the middle outward.
      if (c.fade < 1 && c.from >= 0) { body(c.from, r); body(c.o, r * easeOutBack(c.fade) * Math.min(1, c.fade * 2)); } else body(c.o, r);
      drawDots(x, y, Math.min(4, c.d), k);
    }
    // Dots in flight from a burst, easing out toward their new square.
    for (const f of flying) {
      const e = 1 - (1 - f.t) ** 3;
      const x = f.from.x + (f.to.x - f.from.x) * e, y = f.from.y + (f.to.y - f.from.y) * e;
      ctx.fillStyle = f.col;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(f.from.x + (x - f.from.x) * 0.7, f.from.y + (y - f.from.y) * 0.7, cell * 0.07, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(x, y, cell * 0.1, 0, TAU); ctx.fill();
    }
    for (const p of pops) {
      ctx.strokeStyle = `rgba(${p.col},${1 - p.t})`;
      ctx.lineWidth = 3 * (1 - p.t) + 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, cell * (0.3 + p.t * 0.7), 0, TAU); ctx.stroke();
    }
    for (const s of sparks) {
      ctx.globalAlpha = 1 - s.t / s.life;
      ctx.fillStyle = s.col;
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (chainNow >= 3 && (state === 'resolving' || state === 'finishing')) {
      const k = 1 + Math.min(0.3, chainNow * 0.02) + Math.sin(time * 18) * 0.03;
      ctx.save();
      ctx.translate(W / 2, H - 20);
      ctx.scale(k, k);
      ctx.font = '900 26px system-ui, sans-serif';
      ctx.fillStyle = COLORS[turn].fill;
      ctx.fillText(`CHAIN ×${chainNow}`, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function updateHud() {
    $('turn').textContent = moveNo;
    $('cells').textContent = cells ? cells.filter(c => c.o === Match.me).length : 0;
    $('chain').textContent = biggest;
  }

  // ---------- Input ----------

  const cellAt = e => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * W / r.width - ox, y = (e.clientY - r.top) * H / r.height - oy;
    if (!n || x < 0 || y < 0 || x >= cell * n || y >= cell * n) return -1;
    return Math.floor(y / cell) * n + Math.floor(x / cell);
  };
  canvas.addEventListener('pointerdown', e => {
    if (!overlayEl.hidden || state !== 'playing' || !Match.mine(turn)) return;
    e.preventDefault();
    const i = cellAt(e);
    if (i >= 0 && play(i)) Match.move({ i });
    else if (i >= 0) Arcade.tone({ freq: 160, dur: 0.05, type: 'square', vol: 0.03 });
    updateHud();
  });
  canvas.addEventListener('pointermove', e => { hover = cellAt(e); });
  canvas.addEventListener('pointerleave', () => { hover = -1; });
  window.addEventListener('keydown', e => {
    if ((e.code === 'KeyP' || e.code === 'Escape') && state !== 'menu' && state !== 'over') {
      if (overlayEl.hidden) ui.show({ title: 'Paused', html: '<div class="menu"><button class="btn secondary" type="button" data-quit>Quit to menu</button></div>', button: 'Resume', onAction: () => ui.hide(), onRender: p => p.querySelector('[data-quit]').addEventListener('click', () => { weekly = null; state = 'menu'; cells = null; Match.menu(); }) });
      else ui.hide();
    }
  });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (overlayEl.hidden || state === 'over') update(dt);
    draw();
    if (cells) updateHud();
    requestAnimationFrame(frame);
  }

  // ---------- Menu ----------

  function configHtml() {
    const chip = (k, v, label, on) => `<button class="chip" type="button" data-${k}="${v}" aria-pressed="${on}">${label}</button>`;
    const b = boardById(opts.board);
    const ws = weeklyState(), wk = weeklySet();
    const done = wk.list.filter(c => ws.done.includes(c.id)).length;
    return `<div class="cfg">
        <div class="cfg-label">Board</div>
        <div class="row wrap">${BOARDS.map(x => chip('board', x.id, x.name, opts.board === x.id)).join('')}</div>
        ${b.sizes ? `<div class="row">${b.sizes.map(s => chip('size', s, `${s}×${s}`, opts.size === s)).join('')}</div>` : ''}
        <div class="cfg-label">Bot rivals</div>
        <div class="row">${[1, 2, 3].map(r => chip('rivals', r, `${r} rival${r > 1 ? 's' : ''}`, opts.rivals === r)).join('')}</div>
        <p class="muted-note">Online matches are one on one, on the board of whoever opens the room.</p>
      </div>
      <div class="weekly">
        <div class="cfg-label">Weekly challenges · ${done}/3 · resets in ${daysLeft()} day${daysLeft() > 1 ? 's' : ''}</div>
        <ul class="weekly-list">${wk.list.map((c, i) => {
          const ok = ws.done.includes(c.id);
          return `<li class="${ok ? 'done' : ''}"><span class="tick" aria-hidden="true">${ok ? '✓' : ''}</span><span class="txt">${esc(c.text)}</span>${ok ? '' : `<button class="btn secondary" type="button" data-weekly="${i}">Play</button>`}</li>`;
        }).join('')}</ul>
        <p class="muted-note">+${WEEKLY_REWARD} tickets each, +${WEEKLY_BONUS} for all three${ws.streak ? ` · ${ws.streak} full week${ws.streak > 1 ? 's' : ''} so far` : ''}</p>
      </div>`;
  }

  function onMenu(panel) {
    weekly = null;
    const menu = panel.querySelector('.menu');
    menu.insertAdjacentHTML('beforebegin', configHtml());
    const bind = (k, parse) => panel.querySelectorAll(`[data-${k}]`).forEach(b => b.addEventListener('click', () => {
      opts[k] = parse(b.dataset[k]);
      Arcade.save(k === 'board' ? 'chroma:boardId' : `chroma:${k}`, opts[k]);
      Match.menu();
    }));
    bind('board', v => v);
    bind('size', v => +v);
    bind('rivals', v => +v);
    const wk = weeklySet();
    panel.querySelectorAll('[data-weekly]').forEach(b => b.addEventListener('click', () => {
      const c = { ...wk.list[+b.dataset.weekly], hit: false };
      weekly = c;
      Match.startOffline('cpu', c.level, false);
    }));
  }

  Match.setup({
    ui,
    tag: 'chromaburst',
    title: 'Chroma Burst',
    rules: `<ul>
        <li>First turn: drop a <b>three-dot cell</b> on any empty square.</li>
        <li>Then tap one of <b>your</b> cells to add a dot. At four dots it <b>bursts</b>, throwing a dot into each square beside it and turning them your colour.</li>
        <li>Full cells caught in a burst burst too, so one tap can set off a chain.</li>
        <li>Knock every other colour off the board to win.</li>
      </ul>`,
    levels: LEVELS,
    winFlag: null,
    onlineWinFlag: 'chroma-burst-online-win',
    startData: () => (weekly ? { board: weekly.board, size: weekly.size } : { board: opts.board, size: opts.size }),
    onMenu,
    onStart: info => {
      queue = [];
      newGame(info);
      ui.hide();
    },
    onMove: d => { if (state !== 'menu' && Number.isInteger(d.i)) queue.push({ i: d.i }); },
    onStop: () => { state = 'menu'; cells = null; },
  });
  requestAnimationFrame(frame);
})();
