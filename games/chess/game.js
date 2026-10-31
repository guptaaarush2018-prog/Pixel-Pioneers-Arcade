(() => {
  const W = 600, H = 680;
  const SQ = 66, BX = (W - SQ * 8) / 2, BY = 72;
  const LEVELS = ['Easy', 'Normal', 'Hard'];
  const DEPTH = [1, 2, 3];
  const BASE = [300, 700, 1200];
  const VALUE = { p: 100, n: 310, b: 330, r: 500, q: 900, a: 1250, k: 0 };
  // Crystal Chess: a piece that lands on a crystal levels up. A queen becomes an Amazon (queen + knight).
  const LEVEL_UP = { p: 'n', n: 'b', b: 'r', r: 'q', q: 'a' };
  const CRYSTAL_EVERY = 6, CRYSTAL_MAX = 2;
  const START = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR';
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]], BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const [LIGHT, DARK, FRAME] = Arcade.equipped('chess-board').colors;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let variant = Arcade.load('chess:variant', 'classic');
  let state = 'menu', mode = null, level = 1, names = ['You', 'Computer'], first = 0;
  let g = null, rep = null, taken = null, sel = -1, hover = -1, last = null, cpuTimer = null, endWhy = '';
  let promoting = null;  // { f, t } while the player picks what a pawn becomes
  // Undo history (one entry per move played), the move list in algebraic notation, and the clocks.
  let history = [], moves = [], undid = false;
  const CLOCKS = { none: null, 10: { base: 600, inc: 0, label: '10 min' }, 5: { base: 300, inc: 0, label: '5 min' }, '3+2': { base: 180, inc: 2, label: '3 + 2' } };
  let clockPick = Arcade.load('chess:clock', 'none');
  if (!(clockPick in CLOCKS)) clockPick = 'none';
  let clock = null, times = null, turnStart = 0;

  // A link from the Lobby names the queue it came from, so match the variant to it.
  const invite = new URLSearchParams(location.search).get('join') || '';
  if (/^pp-chessx-/.test(invite)) variant = 'crystal';
  else if (/^pp-chess-/.test(invite)) variant = 'classic';

  // ---------- Rules ----------
  // b: 64 squares from a8 to h1, '.' empty, uppercase white, lowercase black. A move onto the last rank
  // carries `promo`: the piece the pawn becomes ('q', 'r', 'b' or 'n').

  const colorOf = c => (c === '.' ? null : c < 'a' ? 'w' : 'b');
  const other = c => (c === 'w' ? 'b' : 'w');
  const typeOf = c => c.toLowerCase();
  const as = (col, t) => (col === 'w' ? t.toUpperCase() : t);
  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  const fresh = v => ({ b: START.split(''), turn: 'w', castle: 'KQkq', ep: -1, half: 0, ply: 0, crystals: [], variant: v });

  function attacked(s, sq, by) {
    const r = sq >> 3, c = sq & 7, b = s.b;
    const has = (rr, cc, types) => on(rr, cc) && colorOf(b[rr * 8 + cc]) === by && types.includes(typeOf(b[rr * 8 + cc]));
    const pr = by === 'w' ? r + 1 : r - 1;
    if (has(pr, c - 1, 'p') || has(pr, c + 1, 'p')) return true;
    for (const [dr, dc] of KNIGHT) if (has(r + dr, c + dc, 'na')) return true;
    for (const [dr, dc] of KING) if (has(r + dr, c + dc, 'k')) return true;
    for (const [dirs, types] of [[ROOK, 'rqa'], [BISHOP, 'bqa']]) {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (on(rr, cc)) {
          const p = b[rr * 8 + cc];
          if (p !== '.') {
            if (colorOf(p) === by && types.includes(typeOf(p))) return true;
            break;
          }
          rr += dr; cc += dc;
        }
      }
    }
    return false;
  }

  const kingSq = (s, col) => s.b.indexOf(as(col, 'k'));
  const inCheck = (s, col = s.turn) => attacked(s, kingSq(s, col), other(col));

  function pseudo(s) {
    const out = [], b = s.b, me = s.turn;
    const add = (f, t, extra) => {
      if (typeOf(b[f]) === 'p' && (t < 8 || t >= 56)) for (const promo of 'qrbn') out.push({ f, t, ...extra, promo });
      else out.push({ f, t, ...extra });
    };
    for (let f = 0; f < 64; f++) {
      const p = b[f];
      if (colorOf(p) !== me) continue;
      const r = f >> 3, c = f & 7, t = typeOf(p);
      if (t === 'p') {
        const dir = me === 'w' ? -1 : 1, home = me === 'w' ? 6 : 1;
        const one = f + dir * 8;
        if (on(r + dir, c) && b[one] === '.') {
          add(f, one);
          if (r === home && b[one + dir * 8] === '.') add(f, one + dir * 8, { dbl: true });
        }
        for (const dc of [-1, 1]) {
          if (!on(r + dir, c + dc)) continue;
          const to = (r + dir) * 8 + c + dc;
          if (colorOf(b[to]) === other(me)) add(f, to);
          else if (to === s.ep) add(f, to, { ep: true });
        }
        continue;
      }
      const steps = t === 'n' ? KNIGHT : t === 'k' ? KING : t === 'a' ? KNIGHT : null;
      if (steps) {
        for (const [dr, dc] of steps) {
          if (!on(r + dr, c + dc)) continue;
          const to = (r + dr) * 8 + c + dc;
          if (colorOf(b[to]) !== me) add(f, to);
        }
      }
      const dirs = t === 'r' ? ROOK : t === 'b' ? BISHOP : t === 'q' || t === 'a' ? ROOK.concat(BISHOP) : [];
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (on(rr, cc)) {
          const to = rr * 8 + cc;
          if (colorOf(b[to]) === me) break;
          add(f, to);
          if (b[to] !== '.') break;
          rr += dr; cc += dc;
        }
      }
      if (t === 'k') {
        const them = other(me), row = me === 'w' ? 56 : 0;
        const [kSide, qSide] = me === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (f === row + 4 && !attacked(s, f, them)) {
          if (s.castle.includes(kSide) && b[row + 5] === '.' && b[row + 6] === '.' && !attacked(s, row + 5, them) && !attacked(s, row + 6, them)) add(f, row + 6, { castle: 'k' });
          if (s.castle.includes(qSide) && b[row + 3] === '.' && b[row + 2] === '.' && b[row + 1] === '.' && !attacked(s, row + 3, them) && !attacked(s, row + 2, them)) add(f, row + 2, { castle: 'q' });
        }
      }
    }
    return out;
  }

  // Same on both players' devices, so online games agree on where crystals appear.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function make(s, m) {
    const b = s.b.slice();
    const p = b[m.f], me = colorOf(p);
    const capture = b[m.t] !== '.' || !!m.ep;
    b[m.t] = p;
    b[m.f] = '.';
    if (m.ep) b[m.t + (me === 'w' ? 8 : -8)] = '.';
    if (m.castle) {
      const row = me === 'w' ? 56 : 0;
      const [from, to] = m.castle === 'k' ? [row + 7, row + 5] : [row, row + 3];
      b[to] = b[from];
      b[from] = '.';
    }
    if (typeOf(p) === 'p' && (m.t < 8 || m.t >= 56)) b[m.t] = as(me, m.promo || 'q');
    let crystals = s.crystals;
    if (crystals.includes(m.t)) {
      crystals = crystals.filter(x => x !== m.t);
      const up = LEVEL_UP[typeOf(b[m.t])];
      if (up) b[m.t] = as(me, up);
    }
    let castle = s.castle;
    for (const [sq, rights] of [[60, 'KQ'], [4, 'kq'], [63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) {
      if (m.f === sq || m.t === sq) for (const x of rights) castle = castle.replace(x, '');
    }
    const n = {
      b, turn: other(me), castle, ep: m.dbl ? (m.f + m.t) / 2 : -1,
      half: typeOf(p) === 'p' || capture ? 0 : s.half + 1, ply: s.ply + 1, crystals, variant: s.variant,
    };
    if (n.variant === 'crystal' && n.ply % CRYSTAL_EVERY === 0 && crystals.length < CRYSTAL_MAX) {
      const spots = [];
      for (let i = 16; i < 48; i++) if (b[i] === '.' && !crystals.includes(i)) spots.push(i);
      if (spots.length) n.crystals = crystals.concat(spots[hash(b.join('') + n.ply) % spots.length]);
    }
    return n;
  }

  // Legal moves with the position each one leads to.
  function children(s) {
    const out = [];
    for (const m of pseudo(s)) {
      const n = make(s, m);
      if (!attacked(n, kingSq(n, s.turn), n.turn)) out.push({ m, n });
    }
    return out;
  }

  function insufficient(s) {
    const rest = s.b.filter(p => p !== '.' && typeOf(p) !== 'k');
    if (!rest.length) return true;
    // In Crystal chess a lone knight or bishop can still level up into a mating piece.
    return s.variant !== 'crystal' && rest.length === 1 && 'nb'.includes(typeOf(rest[0]));
  }

  // null while play goes on, else { winner: 'w' | 'b' | null, why }.
  function result(s, kids = children(s)) {
    if (!kids.length) return inCheck(s) ? { winner: other(s.turn), why: 'Checkmate.' } : { winner: null, why: 'Stalemate.' };
    if (s.half >= 100) return { winner: null, why: 'Fifty moves without a capture or pawn move.' };
    if (insufficient(s)) return { winner: null, why: 'Not enough pieces left to checkmate.' };
    if ((rep.get(key(s)) || 0) >= 3) return { winner: null, why: 'Same position three times.' };
    return null;
  }
  const key = s => s.b.join('') + s.turn + s.castle + s.ep + s.crystals.join(',');

  // ---------- Computer ----------

  function evaluate(s) {
    let v = 0;
    for (let i = 0; i < 64; i++) {
      const p = s.b[i];
      if (p === '.') continue;
      const t = typeOf(p), sign = colorOf(p) === 'w' ? 1 : -1;
      const r = i >> 3, c = i & 7;
      const centre = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5));
      let x = VALUE[t];
      if (t === 'p') x += (sign > 0 ? 6 - r : r - 1) * 8 + (c >= 2 && c <= 5 ? 6 : 0);
      else if (t === 'n' || t === 'b') x += centre * 10;
      else if (t === 'k') x += s.ply < 40 ? (r === (sign > 0 ? 7 : 0) ? 15 : -15) : centre * 6;
      else x += centre * 3;
      v += sign * x;
    }
    // A piece next to a crystal is worth a little more.
    for (const cr of s.crystals) {
      for (const [dr, dc] of KING) {
        const r = (cr >> 3) + dr, c = (cr & 7) + dc;
        if (on(r, c) && s.b[r * 8 + c] !== '.') v += colorOf(s.b[r * 8 + c]) === 'w' ? 12 : -12;
      }
    }
    return s.turn === 'w' ? v : -v;
  }

  // Captures (best victim, cheapest attacker) and crystal grabs first, so alpha-beta cuts sooner.
  const gain = (s, m) => (s.b[m.t] !== '.' ? VALUE[typeOf(s.b[m.t])] * 10 - VALUE[typeOf(s.b[m.f])] : 0) + (m.ep ? 900 : 0) + (s.crystals.includes(m.t) ? 1500 : 0) + (m.promo ? VALUE[m.promo] * 10 : 0);
  const order = (s, kids) => kids.sort((a, b) => gain(s, b.m) - gain(s, a.m));
  const sorted = (s, moves) => moves.map(m => [gain(s, m), m]).sort((a, b) => b[0] - a[0]).map(x => x[1]);

  // The search only checks a move's legality once it gets to it, since most branches are cut first.
  function quiesce(s, alpha, beta, depth) {
    const stand = evaluate(s);
    if (depth === 0 || stand >= beta) return stand;
    alpha = Math.max(alpha, stand);
    const loud = pseudo(s).filter(m => s.b[m.t] !== '.' || m.ep || s.crystals.includes(m.t));
    for (const m of sorted(s, loud)) {
      const n = make(s, m);
      if (attacked(n, kingSq(n, s.turn), n.turn)) continue;
      const v = -quiesce(n, -beta, -alpha, depth - 1);
      if (v >= beta) return v;
      alpha = Math.max(alpha, v);
    }
    return alpha;
  }

  function search(s, depth, alpha, beta) {
    if (s.half >= 100) return 0;
    if (depth === 0) return quiesce(s, alpha, beta, 3);
    let best = -Infinity, any = false;
    for (const m of sorted(s, pseudo(s))) {
      const n = make(s, m);
      if (attacked(n, kingSq(n, s.turn), n.turn)) continue;
      any = true;
      const v = -search(n, depth - 1, -beta, -alpha);
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    if (!any) return inCheck(s) ? -100000 - depth : 0;
    return best;
  }

  function cpuMove() {
    const kids = order(g, children(g));
    if (level === 0 && Math.random() < 0.3) return Arcade.pick(kids).m;
    const scored = kids.map(({ m, n }) => ({ m, v: -search(n, DEPTH[level] - 1, -Infinity, Infinity) + Math.random() * (level === 2 ? 4 : 15) }));
    return scored.reduce((a, b) => (b.v > a.v ? b : a)).m;
  }

  function scheduleCpu() {
    clearTimeout(cpuTimer);
    if (mode !== 'cpu' || state !== 'playing' || playerOf(g.turn) !== 1) return;
    cpuTimer = setTimeout(() => {
      if (state === 'playing' && playerOf(g.turn) === 1) apply(cpuMove(), 1);
    }, 350);
  }

  // ---------- Move list ----------

  const sqName = i => 'abcdefgh'[i & 7] + (8 - (i >> 3));
  // Standard algebraic notation, e.g. Nbd2, exd5, e8=N+, O-O. A ◆ marks a crystal grab.
  function san(s, m, kids, n, nKids) {
    const p = s.b[m.f], t = typeOf(p);
    const capture = s.b[m.t] !== '.' || m.ep;
    let out;
    if (m.castle) out = m.castle === 'k' ? 'O-O' : 'O-O-O';
    else if (t === 'p') out = (capture ? 'abcdefgh'[m.f & 7] + 'x' : '') + sqName(m.t) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      const rivals = [...new Set(kids.filter(k => k.m.t === m.t && k.m.f !== m.f && s.b[k.m.f] === p).map(k => k.m.f))];
      let dis = '';
      if (rivals.length) {
        if (!rivals.some(f => (f & 7) === (m.f & 7))) dis = 'abcdefgh'[m.f & 7];
        else if (!rivals.some(f => f >> 3 === m.f >> 3)) dis = String(8 - (m.f >> 3));
        else dis = sqName(m.f);
      }
      out = t.toUpperCase() + dis + (capture ? 'x' : '') + sqName(m.t);
    }
    if (s.crystals.includes(m.t)) out += '◆';
    return out + (inCheck(n) ? (nKids.length ? '+' : '#') : '');
  }

  function renderMoves() {
    const el = $('moves');
    const pairs = [];
    for (let i = 0; i < moves.length; i += 2) pairs.push(`<span><b>${i / 2 + 1}.</b> ${moves[i]}${moves[i + 1] ? ` ${moves[i + 1]}` : ''}</span>`);
    el.innerHTML = pairs.join(' ') || '<span class="muted">Moves will show up here.</span>';
    el.scrollLeft = el.scrollWidth;
  }

  // ---------- Flow ----------

  // Whoever opens the round plays white.
  const playerOf = col => (col === 'w' ? first : 1 - first);
  const viewer = () => (mode === 'online' ? Match.me : mode === 'cpu' ? 0 : playerOf(g.turn));
  const myColor = () => (mode === 'local' ? 'w' : playerOf('w') === viewer() ? 'w' : 'b');

  // `ms`: the mover's clock as their device reported it (online moves only).
  function apply(m, p, ms) {
    if (state !== 'playing' || p !== playerOf(g.turn)) return false;
    const options = children(g);
    const pick = options.find(k => k.m.f === m.f && k.m.t === m.t && (k.m.promo || '') === (m.promo || ''));
    if (!pick) return false;
    const before = g;
    history.push({ g: before, taken: { w: taken.w.slice(), b: taken.b.slice() }, last, times: times && { ...times } });
    if (clock) {
      const now = performance.now();
      times[before.turn] = typeof ms === 'number' ? ms : times[before.turn] - (now - turnStart) + clock.inc * 1000;
      turnStart = now;
    }
    const victim = before.b[pick.m.t] !== '.' ? before.b[pick.m.t] : pick.m.ep ? as(other(before.turn), 'p') : null;
    if (victim) taken[before.turn].push(victim);
    const crystal = before.crystals.includes(pick.m.t);
    g = pick.n;
    rep.set(key(g), (rep.get(key(g)) || 0) + 1);
    last = pick.m;
    sel = -1;
    promoting = null;
    if (crystal && typeOf(g.b[pick.m.t]) === 'a' && (mode === 'local' || p === viewer())) Arcade.flag('chess-amazon');
    const kids = children(g);
    moves.push(san(before, pick.m, options, g, kids));
    renderMoves();
    if (crystal) Arcade.tone({ freq: 700, to: 1400, dur: 0.22, type: 'triangle', vol: 0.05 });
    else if (inCheck(g)) Arcade.tone({ freq: 520, to: 880, dur: 0.14, type: 'square', vol: 0.04 });
    else Arcade.tone(victim ? { freq: 240, to: 120, dur: 0.1, type: 'square', vol: 0.05 } : { freq: 420, dur: 0.04, vol: 0.03 });
    updateHud();
    const r = result(g, kids);
    if (r) end(r.winner === null ? -1 : playerOf(r.winner), r.why);
    else scheduleCpu();
    return true;
  }

  function end(winner, why) {
    clearTimeout(cpuTimer);
    state = 'over';
    endWhy = why;
    const me = viewer();
    if (winner === me && winner !== -1 && mode !== 'local' && variant === 'crystal') Arcade.flag('chess-crystal');
    const material = taken[first === 0 ? 'w' : 'b'].reduce((t, p) => t + VALUE[typeOf(p)], 0);
    updateHud();
    const full = winner === 0 ? BASE[level] + Math.max(0, 200 - g.ply * 2) : winner === -1 ? Math.round(BASE[level] / 4) : Math.round(material / 10);
    setTimeout(() => Match.over({
      winner,
      score: undid ? Math.round(full / 2) : full,
      practice: undid,
      lines: [why, `${variant === 'crystal' ? 'Crystal' : 'Classic'} chess · ${Math.ceil(g.ply / 2)} moves${clock ? ` · ${clock.label}` : ''}`,
        ...(undid ? ['You took moves back, so this counts as practice: half score, no achievements.'] : [])],
    }), 900);
  }

  // Takes back your last move (and the computer's reply). Not online, and a game with take-backs
  // doesn't count towards the computer achievements.
  function undo() {
    if (state !== 'playing' || mode === 'online' || !history.length) return;
    clearTimeout(cpuTimer);
    do {
      rep.set(key(g), (rep.get(key(g)) || 1) - 1);
      const h = history.pop();
      g = h.g;
      taken = h.taken;
      last = h.last;
      if (h.times) times = h.times;
      moves.pop();
    } while (mode === 'cpu' && history.length && playerOf(g.turn) !== 0);
    turnStart = performance.now();
    sel = -1;
    promoting = null;
    if (mode === 'cpu') undid = true;
    renderMoves();
    updateHud();
    scheduleCpu();
  }

  function resign() {
    if (state !== 'playing') return;
    const p = mode === 'local' ? playerOf(g.turn) : viewer();
    Match.move({ resign: 1 });
    end(1 - p, `${mode === 'local' ? names[p] : 'You'} resigned.`);
  }

  function variantRow(panel) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<button class="btn" type="button" data-v="classic">Classic</button><button class="btn" type="button" data-v="crystal">Crystal</button>`;
    const note = document.createElement('p');
    note.className = 'muted-note';
    const paint = () => {
      row.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('secondary', b.dataset.v !== variant));
      note.textContent = variant === 'crystal'
        ? 'Crystal: every 3 turns a crystal appears mid-board. Move onto it to level that piece up: pawn → knight → bishop → rook → queen → Amazon (queen + knight).'
        : 'Classic: the regular rules, castling and en passant included.';
    };
    row.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
      variant = b.dataset.v;
      Arcade.save('chess:variant', variant);
      paint();
    }));
    paint();
    const clocks = document.createElement('div');
    clocks.className = 'row clock-row';
    // Listed in this order on purpose: number-like keys would otherwise sort first.
    clocks.innerHTML = ['none', '10', '5', '3+2'].map(id => `<button class="btn" type="button" data-clock="${id}">${CLOCKS[id] ? CLOCKS[id].label : 'Untimed'}</button>`).join('');
    const paintClocks = () => clocks.querySelectorAll('[data-clock]').forEach(b => b.classList.toggle('secondary', b.dataset.clock !== clockPick));
    clocks.querySelectorAll('[data-clock]').forEach(b => b.addEventListener('click', () => {
      clockPick = b.dataset.clock;
      Arcade.save('chess:clock', clockPick);
      paintClocks();
    }));
    paintClocks();
    const menu = panel.querySelector('.menu');
    menu.prepend(clocks);
    menu.prepend(note);
    menu.prepend(row);
  }

  Match.setup({
    ui,
    tag: 'chess',
    quickTag: () => (variant === 'crystal' ? 'chessx' : 'chess'),
    quickLabel: () => (variant === 'crystal' ? 'Crystal chess' : 'Classic chess'),
    startData: () => ({ variant, clock: clockPick }),
    title: 'Chess',
    levels: LEVELS,
    winFlag: 'chess-win',
    hardFlag: 'chess-hard',
    onlineWinFlag: 'chess-online-win',
    rules: `<p>Checkmate the other king. Pick a mode and a clock, then an opponent. Online, the host's choices are used.</p>`,
    onMenu: variantRow,
    onStart: s => {
      clearTimeout(cpuTimer);
      mode = s.mode;
      level = s.level;
      names = s.names;
      first = s.first;
      if (s.data?.variant) variant = s.data.variant;
      clock = CLOCKS[s.data?.clock in CLOCKS ? s.data.clock : clockPick] || null;
      times = clock ? { w: clock.base * 1000, b: clock.base * 1000 } : null;
      turnStart = performance.now();
      history = [];
      moves = [];
      undid = false;
      renderMoves();
      g = fresh(variant);
      rep = new Map([[key(g), 1]]);
      taken = { w: [], b: [] };
      sel = -1;
      last = null;
      promoting = null;
      endWhy = '';
      state = 'playing';
      updateHud();
      scheduleCpu();
    },
    onMove: data => {
      if (data.resign || data.timeout) {
        if (state === 'playing') end(Match.me, `${names[1 - Match.me]} ${data.resign ? 'resigned' : 'ran out of time'}.`);
        return;
      }
      const promo = 'qrbn'.includes(data.promo) && data.promo ? data.promo : undefined;
      apply({ f: data.f | 0, t: data.t | 0, promo }, 1 - Match.me, typeof data.ms === 'number' ? Math.max(0, data.ms) : undefined);
    },
    onStop: () => { state = 'over'; clearTimeout(cpuTimer); },
  });

  $('resign').addEventListener('click', resign);
  $('undo').addEventListener('click', undo);

  function updateHud() {
    if (!g) return;
    const me = myColor();
    const worth = col => taken[col].reduce((t, p) => t + VALUE[typeOf(p)], 0);
    const diff = Math.round((worth(me) - worth(other(me))) / 100);
    $('turn').textContent = state !== 'playing' ? '-' : mode === 'local' ? names[playerOf(g.turn)] : playerOf(g.turn) === viewer() ? 'Yours' : mode === 'cpu' ? 'Computer' : 'Theirs';
    $('material').textContent = diff > 0 ? `+${diff}` : diff;
    $('mode').textContent = variant === 'crystal' ? 'Crystal' : 'Classic';
    $('resign').disabled = state !== 'playing';
    $('undo').disabled = state !== 'playing' || mode === 'online' || !history.length;
    $('undo').hidden = mode === 'online';
  }

  // ---------- Input ----------

  const flipped = () => g && myColor() === 'b';
  const sqPos = i => {
    const r = i >> 3, c = i & 7;
    return flipped() ? [BX + (7 - c) * SQ, BY + (7 - r) * SQ] : [BX + c * SQ, BY + r * SQ];
  };

  function sqAt(e) {
    const rc = canvas.getBoundingClientRect();
    const px = ((e.clientX - rc.left) / rc.width) * W, py = ((e.clientY - rc.top) / rc.height) * H;
    let c = Math.floor((px - BX) / SQ), r = Math.floor((py - BY) / SQ);
    if (!on(r, c)) return -1;
    if (flipped()) { r = 7 - r; c = 7 - c; }
    return r * 8 + c;
  }

  canvas.addEventListener('pointermove', e => { hover = sqAt(e); });
  canvas.addEventListener('pointerleave', () => { hover = -1; });
  // The promotion picker: four squares running from the target square towards the middle of the board.
  const PROMOS = ['q', 'r', 'b', 'n'];
  function promoBoxes() {
    const [x, y] = sqPos(promoting.t);
    const dir = y < BY + SQ * 4 ? 1 : -1;
    return PROMOS.map((t, k) => ({ t, x, y: y + dir * k * SQ }));
  }

  function move(m) {
    if (apply(m, playerOf(g.turn))) Match.move(times ? { ...m, ms: Math.round(times[other(g.turn)]) } : m);
  }

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing' || !Match.mine(playerOf(g.turn))) return;
    if (promoting) {
      const rc = canvas.getBoundingClientRect();
      const px = ((e.clientX - rc.left) / rc.width) * W, py = ((e.clientY - rc.top) / rc.height) * H;
      const box = promoBoxes().find(b => px >= b.x && px < b.x + SQ && py >= b.y && py < b.y + SQ);
      const m = { ...promoting, promo: box?.t };
      promoting = null;
      if (box) move(m);
      return;
    }
    const i = sqAt(e);
    if (i < 0) return;
    if (sel >= 0 && sel !== i) {
      const options = children(g).filter(k => k.m.f === sel && k.m.t === i);
      if (options.length > 1) {
        promoting = { f: sel, t: i };
        return;
      }
      if (options.length) return move(options[0].m);
    }
    sel = colorOf(g.b[i]) === g.turn && sel !== i ? i : -1;
    if (sel >= 0) Arcade.tone({ freq: 660, dur: 0.03, vol: 0.02 });
  });

  // ---------- Drawing ----------

  // Pieces are drawn on a unit square centred on 0,0.
  const SHAPES = {
    p: c => {
      c.moveTo(-0.2, 0.3); c.quadraticCurveTo(-0.14, 0.04, -0.07, -0.02); c.lineTo(0.07, -0.02); c.quadraticCurveTo(0.14, 0.04, 0.2, 0.3); c.closePath();
      c.moveTo(0.14, -0.15); c.arc(0, -0.15, 0.14, 0, Math.PI * 2);
    },
    r: c => {
      c.rect(-0.18, -0.12, 0.36, 0.42);
      const pts = [[-0.27, -0.1], [-0.27, -0.36], [-0.15, -0.36], [-0.15, -0.27], [-0.06, -0.27], [-0.06, -0.36], [0.06, -0.36], [0.06, -0.27], [0.15, -0.27], [0.15, -0.36], [0.27, -0.36], [0.27, -0.1]];
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
    },
    n: c => {
      const pts = [[-0.2, 0.3], [0.24, 0.3], [0.24, 0.02], [0.18, -0.22], [0.06, -0.34], [0.02, -0.42], [-0.04, -0.33], [-0.12, -0.3], [-0.3, -0.1], [-0.31, 0.02], [-0.2, 0.05], [-0.06, -0.04], [-0.04, 0.08]];
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
    },
    b: c => {
      c.moveTo(-0.17, 0.3); c.lineTo(-0.06, 0.08); c.lineTo(0.06, 0.08); c.lineTo(0.17, 0.3); c.closePath();
      c.moveTo(0.15, -0.08); c.ellipse(0, -0.08, 0.15, 0.2, 0, 0, Math.PI * 2);
      c.moveTo(0.06, -0.34); c.arc(0, -0.34, 0.06, 0, Math.PI * 2);
    },
    q: c => {
      const pts = [[-0.24, 0.3], [-0.3, -0.2], [-0.14, 0.02], [-0.08, -0.28], [0, 0], [0.08, -0.28], [0.14, 0.02], [0.3, -0.2], [0.24, 0.3]];
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      for (const [x, y] of [[-0.3, -0.24], [-0.08, -0.32], [0.08, -0.32], [0.3, -0.24]]) { c.moveTo(x + 0.05, y); c.arc(x, y, 0.05, 0, Math.PI * 2); }
    },
    k: c => {
      const pts = [[-0.24, 0.3], [-0.29, -0.08], [-0.1, -0.02], [0, -0.14], [0.1, -0.02], [0.29, -0.08], [0.24, 0.3]];
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.rect(-0.035, -0.44, 0.07, 0.28);
      c.rect(-0.12, -0.37, 0.24, 0.07);
    },
  };
  SHAPES.a = SHAPES.q;

  function drawPiece(p, x, y, size, alpha = 1) {
    const t = typeOf(p), white = colorOf(p) === 'w';
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(size, size);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.035;
    ctx.fillStyle = white ? '#f6f2e7' : '#22252c';
    ctx.strokeStyle = white ? '#1b1d22' : '#e4e7ee';
    ctx.beginPath();
    ctx.roundRect(-0.3, 0.28, 0.6, 0.12, 0.04);
    SHAPES[t](ctx);
    ctx.fill('evenodd');
    ctx.stroke();
    if (t === 'n') {
      ctx.fillStyle = white ? '#1b1d22' : '#e4e7ee';
      ctx.beginPath(); ctx.arc(-0.06, -0.18, 0.035, 0, Math.PI * 2); ctx.fill();
    }
    if (t === 'b') {
      ctx.strokeStyle = white ? '#1b1d22' : '#e4e7ee';
      ctx.beginPath(); ctx.moveTo(0.02, -0.18); ctx.lineTo(0.09, -0.04); ctx.stroke();
    }
    if (t === 'a') gem(0, 0.14, 0.09, '#c77dff');
    ctx.restore();
  }

  const timeLeft = col => Math.max(0, times[col] - (state === 'playing' && g.turn === col ? performance.now() - turnStart : 0));
  function drawClock(col, y) {
    const ms = timeLeft(col), secs = Math.ceil(ms / 1000);
    const running = state === 'playing' && g.turn === col;
    const x = BX + SQ * 8 - 96;
    ctx.fillStyle = running ? (ms < 20000 ? '#ff5d5d' : '#eceef2') : '#1e222a';
    ctx.beginPath();
    ctx.roundRect(x, y, 96, 30, 6);
    ctx.fill();
    ctx.fillStyle = running ? '#0e1014' : '#8d94a1';
    ctx.font = '700 17px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ms < 10000 ? (ms / 1000).toFixed(1) : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, x + 48, y + 21);
  }

  // A flag falls on the device that owns that clock (online), so both sides agree on who timed out.
  function checkTime() {
    if (!times || state !== 'playing' || timeLeft(g.turn) > 0) return;
    const p = playerOf(g.turn);
    if (mode === 'online' && p !== Match.me) return;
    if (mode === 'online') Match.move({ timeout: 1 });
    end(1 - p, `${mode === 'online' ? 'You' : names[p]} ran out of time.`);
  }

  function gem(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.75, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.75, y);
    ctx.closePath();
    ctx.fill();
  }

  function draw(t) {
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, W, H);
    if (!g) return;
    const kids = state === 'playing' ? children(g) : [];
    const targets = sel >= 0 ? kids.filter(k => k.m.f === sel).map(k => k.m.t) : [];
    const check = inCheck(g) ? kingSq(g, g.turn) : -1;

    ctx.fillStyle = FRAME;
    ctx.fillRect(BX - 8, BY - 8, SQ * 8 + 16, SQ * 8 + 16);
    for (let i = 0; i < 64; i++) {
      const [x, y] = sqPos(i);
      ctx.fillStyle = ((i >> 3) + (i & 7)) % 2 ? DARK : LIGHT;
      ctx.fillRect(x, y, SQ, SQ);
      if (last && (i === last.f || i === last.t)) {
        ctx.fillStyle = 'rgba(255,197,61,0.32)';
        ctx.fillRect(x, y, SQ, SQ);
      }
      if (i === sel) {
        ctx.fillStyle = 'rgba(79,140,255,0.45)';
        ctx.fillRect(x, y, SQ, SQ);
      }
      if (i === check) {
        const rg = ctx.createRadialGradient(x + SQ / 2, y + SQ / 2, 4, x + SQ / 2, y + SQ / 2, SQ * 0.6);
        rg.addColorStop(0, 'rgba(255,60,60,0.9)');
        rg.addColorStop(1, 'rgba(255,60,60,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(x, y, SQ, SQ);
      }
    }

    // File letters along the bottom row and rank numbers down the left, in the opposite square colour.
    ctx.font = '600 10px system-ui, sans-serif';
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = (7 + k) % 2 ? LIGHT : DARK;
      ctx.textAlign = 'right';
      ctx.fillText('abcdefgh'[flipped() ? 7 - k : k], BX + (k + 1) * SQ - 4, BY + 8 * SQ - 4);
      ctx.fillStyle = k % 2 ? LIGHT : DARK;
      ctx.textAlign = 'left';
      ctx.fillText(flipped() ? k + 1 : 8 - k, BX + 4, BY + k * SQ + 12);
    }

    for (const cr of g.crystals) {
      const [x, y] = sqPos(cr);
      const pulse = 1 + Math.sin(t * 4 + cr) * 0.1;
      ctx.save();
      ctx.shadowColor = '#c77dff';
      ctx.shadowBlur = 16;
      gem(x + SQ / 2, y + SQ / 2, SQ * 0.22 * pulse, '#c77dff');
      ctx.restore();
      gem(x + SQ / 2 - 3, y + SQ / 2 - 4, SQ * 0.08, 'rgba(255,255,255,0.7)');
    }

    for (let i = 0; i < 64; i++) {
      if (g.b[i] === '.') continue;
      const [x, y] = sqPos(i);
      drawPiece(g.b[i], x + SQ / 2, y + SQ / 2 + 2, SQ * 0.95);
    }

    for (const to of targets) {
      const [x, y] = sqPos(to);
      ctx.fillStyle = 'rgba(14,16,20,0.35)';
      ctx.beginPath();
      if (g.b[to] !== '.') {
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(14,16,20,0.4)';
        ctx.arc(x + SQ / 2, y + SQ / 2, SQ / 2 - 4, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.arc(x + SQ / 2, y + SQ / 2, SQ * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (hover >= 0 && targets.includes(hover)) {
      const [x, y] = sqPos(hover);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, SQ - 2, SQ - 2);
    }

    // Captured pieces: the other side's haul above the board, yours below.
    const me = myColor();
    const row = (col, y) => taken[col].slice().sort((a, b) => VALUE[typeOf(b)] - VALUE[typeOf(a)]).forEach((p, i) => drawPiece(p, BX + 10 + i * 20, y, 26));
    row(other(me), BY - 22);
    row(me, BY + SQ * 8 + 26);
    if (times) {
      drawClock(other(me), BY - 38);
      drawClock(me, BY + SQ * 8 + 10);
    }

    ctx.textAlign = 'center';
    ctx.font = '600 14px system-ui, sans-serif';
    if (state === 'playing') {
      const who = mode === 'local' ? `${names[playerOf(g.turn)]} (${g.turn === 'w' ? 'white' : 'black'})` : Match.mine(playerOf(g.turn)) ? 'Your move' : `${names[playerOf(g.turn)]} is thinking…`;
      ctx.fillStyle = g.turn === 'w' ? '#f6f2e7' : '#9aa3b2';
      const next = g.variant === 'crystal' && g.crystals.length < CRYSTAL_MAX ? ` · crystal in ${CRYSTAL_EVERY - (g.ply % CRYSTAL_EVERY)}` : '';
      ctx.fillText(`${who}${check >= 0 ? ' · Check!' : ''}${next}`, W / 2, 24);
    } else if (endWhy) {
      ctx.fillStyle = '#ffc53d';
      ctx.fillText(endWhy, W / 2, 24);
    }
    ctx.fillStyle = '#8d94a1';
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillText(Match.label(), W / 2, H - 12);

    if (promoting && state === 'playing') {
      ctx.fillStyle = 'rgba(14,16,20,0.6)';
      ctx.fillRect(BX, BY, SQ * 8, SQ * 8);
      for (const b of promoBoxes()) {
        ctx.fillStyle = '#eceef2';
        ctx.fillRect(b.x + 2, b.y + 2, SQ - 4, SQ - 4);
        drawPiece(as(g.turn, b.t), b.x + SQ / 2, b.y + SQ / 2 + 2, SQ * 0.95);
      }
      ctx.fillStyle = '#ffc53d';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText('Promote to… (click elsewhere to cancel)', W / 2, BY + SQ * 8 + 52);
    }
  }

  let t0 = performance.now();
  function frame(now) {
    checkTime();
    draw((now - t0) / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
