/* Banner Siege: a quick Stratego-style game of hidden ranks on a 6×7 board. Each side has eleven
   pieces face-down to the other. Move one a turn; walk into an enemy piece and both are
   revealed, and the higher rank wins. Capture the enemy Flag, or leave them with nothing that
   can move.
   Online, each player's board only ever holds the truth about their own pieces. An attack sends
   the attacker's rank; the defender, who knows their own piece, settles the fight and sends the
   result back, so nothing is revealed that the rules wouldn't show anyway. Coordinates are
   always "seat 0 at the bottom"; seat 1 simply sees the board turned around. */
(() => {
  const COLS = 6, ROWS = 7, CELL = 76, W = 560, H = 690;
  const BX = (W - COLS * CELL) / 2, BY = 116;
  const LAKES = [3 * COLS + 1, 3 * COLS + 4];
  const ARMY = ['F', 'B', 'B', '1', '2', '2', '3', '3', '4', '4', '5'];
  const INFO = {
    F: { n: 'Flag', s: 'FLAG', v: 1000 },
    B: { n: 'Bomb', s: 'BOMB', v: 14 },
    1: { n: 'Spy', s: 'SPY', v: 22, r: 1 },
    2: { n: 'Scout', s: 'SCOUT', v: 10, r: 2 },
    3: { n: 'Miner', s: 'MINER', v: 24, r: 3 },
    4: { n: 'Knight', s: 'KNIGHT', v: 38, r: 4 },
    5: { n: 'General', s: 'GENERAL', v: 70, r: 5 },
  };
  const SIDE = [{ fill: '#ffc53d', dark: '#b8870f', ink: '#241a00', glow: '255,197,61' }, { fill: '#ff5d7a', dark: '#b83550', ink: '#2a0710', glow: '255,93,122' }];
  const LEVELS = ['Easy', 'Normal', 'Hard'];
  const BASE = [300, 600, 950];
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const TAU = Math.PI * 2;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let parts = [];
  let phase = 'menu', mode = null, level = 1, me = 0, names = ['You', 'Computer'];
  let bd, turn, selected, hover, ready, theirReady, inbox, busy, duel, moveNo, quiet, dead, awaiting, lastMove, cpuT, time, trail, captured;

  const rowOf = i => Math.floor(i / COLS), colOf = i => i % COLS;
  const flip = i => (me === 1 ? ROWS * COLS - 1 - i : i);        // canonical <-> screen
  const cellXY = i => { const s = flip(i); return { x: BX + colOf(s) * CELL + CELL / 2, y: BY + rowOf(s) * CELL + CELL / 2 }; };
  const homeRows = seat => (seat === 0 ? [4, 5, 6] : [0, 1, 2]);
  const inHome = (i, seat) => homeRows(seat).includes(rowOf(i));

  // ---------- Rules ----------

  function fight(a, d) {
    if (d === 'F') return 'att';
    if (d === 'B') return a === '3' ? 'att' : 'def';
    if (a === '1' && d === '5') return 'att';
    const ra = INFO[a].r, rd = INFO[d].r;
    return ra > rd ? 'att' : ra < rd ? 'def' : 'both';
  }

  // Squares a piece could move to. `k` is the piece's rank when the mover knows it.
  function movesFrom(b, i, k) {
    const p = b[i];
    if (!p || k === 'F' || k === 'B') return [];
    const out = [], r = rowOf(i), c = colOf(i);
    for (const [dr, dc] of DIRS) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) {
        const j = rr * COLS + cc;
        if (LAKES.includes(j)) break;
        if (!b[j]) out.push(j);
        else { if (b[j].s !== p.s) out.push(j); break; }
        if (k !== '2') break;
        rr += dr; cc += dc;
      }
    }
    return out;
  }
  const allMoves = (b, seat) => b.flatMap((p, i) => (p && p.s === seat ? movesFrom(b, i, p.k).map(to => ({ from: i, to })) : []));

  function randomLayout(seat) {
    const rows = homeRows(seat), back = seat === 0 ? 6 : 0, step = seat === 0 ? -1 : 1;
    const all = rows.flatMap(r => Array.from({ length: COLS }, (_, c) => r * COLS + c));
    const flag = back * COLS + Arcade.randInt(0, COLS - 1);
    const near = [flag - 1, flag + 1, flag + step * COLS].filter(j => all.includes(j) && rowOf(j) === rowOf(flag) + (j === flag + step * COLS ? step : 0));
    const bombs = near.sort(() => Math.random() - 0.5).slice(0, 2);
    const rest = ['1', '2', '2', '3', '3', '4', '4', '5'];
    while (bombs.length < 2) { const j = Arcade.pick(all.filter(x => x !== flag && !bombs.includes(x))); bombs.push(j); }
    const free = all.filter(x => x !== flag && !bombs.includes(x)).sort(() => Math.random() - 0.5);
    const out = [[flag, 'F'], [bombs[0], 'B'], [bombs[1], 'B']];
    rest.forEach((k, n) => out.push([free[n], k]));
    return out;
  }
  function place(seat, layout) {
    for (let i = 0; i < bd.length; i++) if (bd[i]?.s === seat) bd[i] = null;
    for (const [i, k] of layout) bd[i] = { s: seat, k, rev: false, moved: false, rx: cellXY(i).x, ry: cellXY(i).y };
  }

  // ---------- Game flow ----------

  function begin({ mode: m, level: lv, me: who, first, names: nm }) {
    mode = m; level = lv; me = who; names = nm;
    bd = Array(ROWS * COLS).fill(null);
    place(me, randomLayout(me));
    if (mode === 'cpu') place(1 - me, randomLayout(1 - me));
    turn = first;
    selected = -1; hover = -1; inbox = []; busy = 0; duel = null; parts = []; moveNo = 0; quiet = 0;
    dead = [{}, {}]; captured = 0; awaiting = false; lastMove = null; trail = []; time = 0; cpuT = 0.8;
    ready = false;
    theirReady = mode === 'cpu';
    phase = 'setup';
    renderTools();
    updateHud();
  }

  function setReady() {
    if (phase !== 'setup' || ready) return;
    ready = true;
    if (mode === 'online') Match.move({ k: 'ready', cells: bd.map((p, i) => (p && p.s === me ? i : -1)).filter(i => i >= 0) });
    maybeStart();
    renderTools();
  }
  function maybeStart() {
    if (!ready || !theirReady || phase !== 'setup') return;
    phase = 'play';
    selected = -1;
    cpuT = 0.9;
    Arcade.tone({ freq: 392, to: 784, dur: 0.3, type: 'triangle', vol: 0.05 });
    renderTools();
    checkStuck();
  }

  function checkStuck() {
    if (phase !== 'play') return;
    const side = turn;
    if (mode === 'cpu' || side === me) {
      if (!allMoves(bd, side).length) {
        if (mode === 'online') Match.move({ k: 'stuck' });
        end(side === me ? 1 - me : me, 'no moves');
      }
    }
  }

  function kill(i) {
    const p = bd[i];
    if (!p) return;
    const { x, y } = cellXY(i);
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * TAU, v = 50 + Math.random() * 110;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.4 + Math.random() * 0.3, col: SIDE[p.s].fill });
    }
    if (p.k) dead[p.s][p.k] = (dead[p.s][p.k] || 0) + 1;
    if (p.s !== me) captured++;
    bd[i] = null;
  }

  // Settle a move that has been decided. outcome is for attacks: 'att' | 'def' | 'both'.
  function resolve(from, to, outcome, attK, defK) {
    const a = bd[from];
    moveNo++;
    lastMove = { from, to };
    if (!outcome) {
      const dist = Math.abs(rowOf(to) - rowOf(from)) + Math.abs(colOf(to) - colOf(from));
      a.moved = true;
      if (dist > 1) { a.k = '2'; a.rev = true; }
      bd[to] = a; bd[from] = null;
      quiet++;
      Arcade.tone({ freq: 240 + moveNo % 5 * 14, dur: 0.05, type: 'triangle', vol: 0.04 });
    } else {
      const d = bd[to];
      a.k = attK; d.k = defK; a.rev = d.rev = true; a.moved = true;
      duel = { a: { k: attK, s: a.s }, d: { k: defK, s: d.s }, outcome, t: 0 };
      busy = 1.35;
      quiet = 0;
      if (outcome === 'att') {
        kill(to);
        bd[to] = a; bd[from] = null;
        if (defK === 'B') Arcade.flag('banner-siege-miner');
        if (attK === '1' && defK === '5' && a.s === me) Arcade.flag('banner-siege-spy');
      } else if (outcome === 'def') kill(from);
      else { kill(from); kill(to); }
      Arcade.tone(outcome === 'att' ? { freq: 220, to: 660, dur: 0.25, type: 'sawtooth', vol: 0.05 } : { freq: 520, to: 140, dur: 0.3, type: 'sawtooth', vol: 0.05 });
      if (defK === 'F') return end(a.s, 'flag');
    }
    turn = 1 - turn;
    selected = -1;
    cpuT = 0.8 + Math.random() * 0.5;
    updateHud();
    if (quiet >= 60) return end(-1, 'stalemate');
    if (!busy) checkStuck();
  }

  function end(winner, why) {
    if (phase === 'over') return;
    phase = 'over';
    selected = -1;
    renderTools();
    const mine = bd.filter(p => p && p.s === me).length;
    for (const p of bd) if (p) p.rev = true;
    const score = winner === me ? BASE[level] + mine * 40 + Math.max(0, 220 - moveNo * 3) : captured * 40;
    Arcade.tone(winner === me ? { freq: 520, to: 1040, dur: 0.4, type: 'triangle', vol: 0.06 } : { freq: 300, to: 110, dur: 0.4, type: 'triangle', vol: 0.06 });
    const lines = [`${why === 'flag' ? 'The Flag fell' : why === 'no moves' ? 'No pieces left that can move' : 'Stalemate'} · ${moveNo} moves · ${captured} enemy piece${captured === 1 ? '' : 's'} taken`];
    setTimeout(() => Match.over({ winner: winner < 0 ? -1 : winner, score: mode === 'cpu' ? score : 0, lines }), why === 'flag' ? 1500 : 700);
  }

  // ---------- Online messages ----------

  function onMove(d) { inbox.push(d); }
  function handle(d) {
    if (d.k === 'ready') {
      const cells = (d.cells || []).map(Number).filter(i => i >= 0 && i < ROWS * COLS && inHome(i, 1 - me));
      if (cells.length !== ARMY.length || new Set(cells).size !== cells.length) return;
      place(1 - me, cells.map(i => [i, null]));
      theirReady = true;
      maybeStart();
      renderTools();
    } else if (phase === 'play' && d.k === 'mv' && turn !== me) {
      const a = bd[d.from | 0];
      if (a && a.s !== me && !bd[d.to | 0]) resolve(d.from | 0, d.to | 0, null);
    } else if (phase === 'play' && d.k === 'atk' && turn !== me) {
      const from = d.from | 0, to = d.to | 0, a = bd[from], t = bd[to];
      if (!a || a.s === me || !t || t.s !== me || !INFO[d.rank] || d.rank === 'F' || d.rank === 'B') return;
      const outcome = fight(d.rank, t.k);
      Match.move({ k: 'res', from, to, outcome, defRank: t.k });
      resolve(from, to, outcome, d.rank, t.k);
    } else if (phase === 'play' && d.k === 'res' && awaiting) {
      awaiting = false;
      resolve(d.from | 0, d.to | 0, d.outcome, bd[d.from | 0].k, d.defRank);
    } else if (d.k === 'stuck' && phase === 'play') end(me, 'no moves');
  }

  // ---------- Computer ----------

  function pool(seat) {
    const left = {};
    for (const k of ARMY) left[k] = (left[k] || 0) + 1;
    for (const [k, n] of Object.entries(dead[seat])) left[k] -= n;
    for (const p of bd) if (p && p.s === seat && p.rev) left[p.k]--;
    return left;
  }

  function aiMove() {
    const seat = 1 - me, moves = allMoves(bd, seat);
    if (!moves.length) return null;
    const left = pool(me);
    const noise = [3, 1.2, 0.4][level];
    if (level === 0 && Math.random() < 0.3) return Arcade.pick(moves);
    let best = null, bestV = -Infinity;
    for (const m of moves) {
      const a = bd[m.from], t = bd[m.to];
      let v = 0;
      const va = INFO[a.k].v;
      if (t) {
        // Fight: weigh every rank the unknown piece could be.
        let ranks;
        if (t.rev) ranks = { [t.k]: 1 };
        else {
          ranks = {};
          for (const [k, n] of Object.entries(left)) if (n > 0 && !(t.moved && (k === 'F' || k === 'B'))) ranks[k] = n;
        }
        const tot = Object.values(ranks).reduce((x, y) => x + y, 0) || 1;
        for (const [k, n] of Object.entries(ranks)) {
          const o = fight(a.k, k), vd = INFO[k].v;
          v += (n / tot) * (o === 'att' ? vd : o === 'both' ? vd - va : -va);
        }
        if (level === 0) v *= 0.6;
      } else {
        // Quiet move: advance, and keep out of reach of known stronger pieces.
        v += (seat === 1 ? rowOf(m.to) - rowOf(m.from) : rowOf(m.from) - rowOf(m.to)) * 0.7;
        if (level >= 1) {
          for (const [dr, dc] of DIRS) {
            const r = rowOf(m.to) + dr, c = colOf(m.to) + dc;
            if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
            const q = bd[r * COLS + c];
            if (q && q.s === me && q.rev && q.k !== 'B' && q.k !== 'F' && fight(q.k, a.k) === 'att') v -= va * 0.8;
          }
          // The Flag and Bombs never leave home, so a piece that moved can be ignored as a target.
          if (a.k === '3') v += 0.4;
        }
        if (a.k === '2' && Math.abs(m.to - m.from) > COLS) v += 0.4;   // scouts like open lanes
      }
      v += (Math.random() - 0.5) * noise * 2;
      if (v > bestV) { bestV = v; best = m; }
    }
    return best;
  }

  // ---------- Input ----------

  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * W / r.width - BX, y = (e.clientY - r.top) * H / r.height - BY;
    if (x < 0 || y < 0 || x >= COLS * CELL || y >= ROWS * CELL) return -1;
    return flip(Math.floor(y / CELL) * COLS + Math.floor(x / CELL));
  }
  canvas.addEventListener('pointermove', e => { hover = cellAt(e); });
  canvas.addEventListener('pointerleave', () => { hover = -1; });
  canvas.addEventListener('pointerdown', e => {
    if (!$('overlay').hidden) return;
    e.preventDefault();
    const i = cellAt(e);
    if (i < 0 || LAKES.includes(i)) return;
    if (phase === 'setup' && !ready) {
      if (!inHome(i, me)) return;
      if (selected < 0) { if (bd[i]) selected = i; }
      else {
        if (selected !== i) {
          [bd[selected], bd[i]] = [bd[i], bd[selected]];
          Arcade.tone({ freq: 360, dur: 0.05, type: 'triangle', vol: 0.04 });
        }
        selected = -1;
      }
      return;
    }
    if (phase !== 'play' || !Match.mine(turn) || busy > 0 || awaiting) return;
    const p = bd[i];
    if (p && p.s === me) {
      selected = selected === i ? -1 : i;
      if (selected >= 0 && !movesFrom(bd, i, p.k).length) { selected = -1; Arcade.tone({ freq: 150, dur: 0.06, type: 'square', vol: 0.03 }); }
      return;
    }
    if (selected >= 0 && movesFrom(bd, selected, bd[selected].k).includes(i)) {
      const from = selected, a = bd[from], t = bd[i];
      if (t) {
        if (mode === 'online') {
          Match.move({ k: 'atk', from, to: i, rank: a.k });
          awaiting = true;
          selected = -1;
        } else resolve(from, i, fight(a.k, t.k), a.k, t.k);
      } else {
        if (mode === 'online') Match.move({ k: 'mv', from, to: i });
        resolve(from, i, null);
      }
    } else selected = -1;
  });

  // ---------- Update and drawing ----------

  function update(dt) {
    time += dt;
    for (const s of parts) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.93; s.vy *= 0.93; }
    parts = parts.filter(s => s.t < s.life);
    if (!bd) return;
    bd.forEach((p, i) => {
      if (!p) return;
      const { x, y } = cellXY(i);
      const k = Math.min(1, dt * 16);
      p.rx += (x - p.rx) * k;
      p.ry += (y - p.ry) * k;
    });
    if (busy > 0) {
      busy -= dt;
      if (duel) duel.t += dt;
      if (busy <= 0) { busy = 0; duel = null; checkStuck(); }
      return;
    }
    if (inbox.length && !awaiting || (awaiting && inbox.some(m => m.k === 'res'))) {
      const i = awaiting ? inbox.findIndex(m => m.k === 'res') : 0;
      handle(inbox.splice(i, 1)[0]);
      return;
    }
    if (phase === 'play' && mode === 'cpu' && turn !== me) {
      cpuT -= dt;
      if (cpuT <= 0) {
        const m = aiMove();
        if (!m) return checkStuck();
        const a = bd[m.from], t = bd[m.to];
        resolve(m.from, m.to, t ? fight(a.k, t.k) : null, a.k, t?.k);
      }
    }
  }

  function glyph(k, x, y, sz, ink) {
    ctx.fillStyle = ink; ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(2, sz * 0.09);
    ctx.lineCap = 'round';
    if (k === 'F') {
      ctx.beginPath(); ctx.moveTo(x - sz * 0.22, y + sz * 0.38); ctx.lineTo(x - sz * 0.22, y - sz * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - sz * 0.22, y - sz * 0.4); ctx.lineTo(x + sz * 0.32, y - sz * 0.18); ctx.lineTo(x - sz * 0.22, y + sz * 0.04); ctx.fill();
    } else if (k === 'B') {
      ctx.beginPath(); ctx.arc(x, y + sz * 0.08, sz * 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + sz * 0.12, y - sz * 0.2); ctx.quadraticCurveTo(x + sz * 0.3, y - sz * 0.4, x + sz * 0.4, y - sz * 0.2); ctx.stroke();
    } else {
      ctx.font = `900 ${Math.round(sz * 0.62)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(INFO[k].r, x, y + sz * 0.14);
    }
  }

  function drawPiece(p, x, y, lift, faded) {
    const sd = SIDE[p.s], s = CELL - 14;
    const show = p.s === me || p.rev;
    ctx.save();
    ctx.translate(x, y - lift);
    if (lift) { ctx.shadowColor = `rgba(${sd.glow},0.7)`; ctx.shadowBlur = 18; }
    const g = ctx.createLinearGradient(0, -s / 2, 0, s / 2);
    g.addColorStop(0, sd.fill);
    g.addColorStop(1, sd.dark);
    ctx.fillStyle = faded ? 'rgba(80,84,96,0.8)' : g;
    ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, 12); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-s / 2 + 3, -s / 2 + 3, s - 6, s - 6, 9); ctx.stroke();
    if (show && p.k) {
      glyph(p.k, 0, -4, s * 0.62, sd.ink);
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = sd.ink;
      ctx.fillText(INFO[p.k].s, 0, s / 2 - 7);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.2, 0, TAU); ctx.fill();
      ctx.font = '900 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = sd.ink;
      ctx.fillText('?', 0, 7);
    }
    ctx.restore();
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#12141d');
    bg.addColorStop(1, '#090a10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (!bd) return;
    ctx.textAlign = 'center';
    // Status pill.
    const mine = Match.mine(turn);
    const label = phase === 'setup' ? (ready ? 'Waiting for your opponent…' : 'Arrange your army') : phase === 'over' ? 'Game over' : awaiting ? 'Resolving…' : mine ? 'Your move' : mode === 'online' ? `${names[turn]}'s move` : 'Computer is thinking…';
    const sd = SIDE[phase === 'setup' ? me : turn];
    ctx.font = '700 17px system-ui, sans-serif';
    const pw = Math.max(170, ctx.measureText(label).width + 56);
    ctx.fillStyle = `rgba(${sd.glow},0.14)`;
    ctx.strokeStyle = `rgba(${sd.glow},0.55)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(W / 2 - pw / 2, 20, pw, 36, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = sd.fill;
    ctx.beginPath(); ctx.arc(W / 2 - pw / 2 + 20, 38, 4 + (phase === 'play' ? Math.sin(time * 5) * 1.2 : 0), 0, TAU); ctx.fill();
    ctx.fillText(label, W / 2 + 8, 44);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(phase === 'setup' ? 'Tap two squares in your zone to swap · Flag at the back, Bombs beside it' : Match.label() || 'Walk into a piece to fight it', W / 2, 80);
    // Captured trays.
    const tray = (seat, y) => {
      const lost = Object.entries(dead[seat]).flatMap(([k, n]) => Array(n).fill(k));
      ctx.font = '700 11px system-ui, sans-serif';
      lost.forEach((k, i) => {
        const x = BX + 12 + i * 22;
        ctx.fillStyle = SIDE[seat].fill; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.roundRect(x - 9, y - 9, 18, 18, 5); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = SIDE[seat].ink;
        ctx.fillText(k === 'F' ? '⚑' : k === 'B' ? '●' : INFO[k].r, x, y + 4);
      });
    };
    tray(1 - me, 100);
    tray(me, BY + ROWS * CELL + 22);
    // Board squares.
    for (let i = 0; i < ROWS * COLS; i++) {
      const { x, y } = cellXY(i), s = CELL - 6;
      if (LAKES.includes(i)) {
        const g = ctx.createLinearGradient(x, y - s / 2, x, y + s / 2);
        g.addColorStop(0, '#16324f'); g.addColorStop(1, '#0f2238');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 12); ctx.fill();
        ctx.strokeStyle = 'rgba(120,190,255,0.25)';
        ctx.lineWidth = 2;
        for (let w = 0; w < 3; w++) { ctx.beginPath(); ctx.moveTo(x - 20, y - 12 + w * 12 + Math.sin(time * 2 + w) * 2); ctx.quadraticCurveTo(x - 8, y - 18 + w * 12, x, y - 12 + w * 12); ctx.quadraticCurveTo(x + 8, y - 6 + w * 12, x + 20, y - 12 + w * 12); ctx.stroke(); }
        continue;
      }
      const home = phase === 'setup' && inHome(i, me);
      ctx.fillStyle = home ? 'rgba(255,197,61,0.09)' : 'rgba(255,255,255,0.045)';
      ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 12); ctx.fill();
      if (lastMove && (i === lastMove.from || i === lastMove.to)) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // Moves for the selected piece.
    if (selected >= 0 && phase === 'play' && bd[selected]) {
      for (const j of movesFrom(bd, selected, bd[selected].k)) {
        const { x, y } = cellXY(j), pulse = 0.5 + Math.sin(time * 6) * 0.5;
        if (bd[j]) {
          ctx.strokeStyle = `rgba(255,93,122,${0.55 + pulse * 0.4})`;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.roundRect(x - CELL / 2 + 4, y - CELL / 2 + 4, CELL - 8, CELL - 8, 12); ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(255,255,255,${0.22 + pulse * 0.12})`;
          ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill();
        }
      }
    }
    if (hover >= 0 && !LAKES.includes(hover) && ((phase === 'setup' && inHome(hover, me) && !ready) || (phase === 'play' && mine && bd[hover]?.s === me))) {
      const { x, y } = cellXY(hover);
      ctx.strokeStyle = `rgba(${SIDE[me].glow},0.7)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x - CELL / 2 + 3, y - CELL / 2 + 3, CELL - 6, CELL - 6, 12); ctx.stroke();
    }
    // Pieces: the selected one lifts.
    const order = bd.map((p, i) => [p, i]).filter(([p]) => p).sort((a, b) => a[0].ry - b[0].ry);
    for (const [p, i] of order) {
      drawPiece(p, p.rx, p.ry, i === selected ? 6 + Math.sin(time * 6) * 1.5 : 0, false);
    }
    for (const s of parts) {
      ctx.globalAlpha = 1 - s.t / s.life;
      ctx.fillStyle = s.col;
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (duel) drawDuel();
  }

  function drawDuel() {
    const k = Math.min(1, duel.t / 0.25), e = 1 - (1 - k) ** 3;
    const fade = duel.t > 1.1 ? 1 - (duel.t - 1.1) / 0.25 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(W / 2, BY + ROWS * CELL / 2);
    ctx.scale(0.7 + 0.3 * e, 0.7 + 0.3 * e);
    ctx.fillStyle = 'rgba(12,14,22,0.94)';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-190, -88, 380, 176, 18); ctx.fill(); ctx.stroke();
    const win = duel.outcome;
    const side = (who, x, won) => {
      ctx.save();
      ctx.translate(x, -4);
      ctx.globalAlpha *= won ? 1 : 0.55;
      drawPiece({ s: who.s, k: who.k, rev: true }, 0, 0, won ? 4 : 0, false);
      ctx.restore();
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(INFO[who.k].n, x, 56);
    };
    side(duel.a, -100, win === 'att' || win === 'both');
    side(duel.d, 100, win === 'def' || win === 'both');
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('VS', 0, 4);
    ctx.font = '800 14px system-ui, sans-serif';
    ctx.fillStyle = '#ffc53d';
    const msg = win === 'both' ? 'Both fall' : (win === 'att' ? duel.a : duel.d).k === 'F' ? '' : `${INFO[(win === 'att' ? duel.a : duel.d).k].n} wins`;
    ctx.fillText(duel.d.k === 'F' ? 'The Flag is captured!' : msg, 0, -62);
    ctx.restore();
  }

  function updateHud() {
    $('turn').textContent = moveNo;
    $('mine').textContent = bd ? bd.filter(p => p && p.s === me).length : 11;
    $('caps').textContent = captured || 0;
  }

  // ---------- Controls ----------

  function renderTools() {
    const bar = $('actions');
    if (phase === 'setup') {
      bar.innerHTML = ready
        ? '<span style="align-self:center;color:var(--muted);font-size:13px">Waiting for your opponent to finish arranging…</span>'
        : '<button class="btn secondary" type="button" data-a="shuffle">Shuffle army</button><button class="btn" type="button" data-a="ready">Ready for battle</button>';
    } else bar.innerHTML = '';
  }
  $('actions').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'shuffle' && phase === 'setup' && !ready) { place(me, randomLayout(me)); selected = -1; }
    else if (a === 'ready') setReady();
  });

  Match.setup({
    ui,
    tag: 'bannersiege',
    title: 'Banner Siege',
    levels: LEVELS,
    local: false,
    winFlag: 'banner-siege-win',
    hardFlag: 'banner-siege-hard',
    onlineWinFlag: 'banner-siege-online-win',
    rules: `<ul>
      <li>Eleven hidden pieces each. Move one a turn; walk into an enemy to fight: the <b>higher rank wins</b>, ties fall together.</li>
      <li><b>Scouts</b> run any distance. The <b>Spy</b> beats the General if it strikes first. <b>Bombs</b> kill attackers, but a <b>Miner</b> defuses them.</li>
      <li>Capture the <b>Flag</b>, or leave them with nothing that can move.</li>
    </ul>`,
    onStart: info => { begin(info); },
    onMove,
    onStop: () => { phase = 'over'; renderTools(); },
  });

  let last = performance.now();
  (function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if ($('overlay').hidden) update(dt);
    draw();
    requestAnimationFrame(frame);
  })(last);
})();
