/* Chroma Burst: a chain-reaction territory game. On your first turn you drop a three-dot cell on
   any empty square. After that, tap one of your own cells to add a dot. A cell that reaches four
   dots bursts: it empties and throws one dot into each square beside it, turning those squares
   your colour, and full neighbours burst in turn. Wipe every rival colour off the board to win. */
(() => {
  const W = 640, H = 700, TAU = Math.PI * 2;
  const COLORS = [
    { name: 'You', fill: '#ffc53d', glow: '255,197,61' },
    { name: 'Coral', fill: '#ff5d7a', glow: '255,93,122' },
    { name: 'Teal', fill: '#36d6c3', glow: '54,214,195' },
    { name: 'Violet', fill: '#a46bff', glow: '164,107,255' },
  ];
  const LEVELS = [{ name: 'Easy', mult: 1 }, { name: 'Normal', mult: 1.6 }, { name: 'Hard', mult: 2.4 }];
  const WAVE = 0.17;   // seconds per burst wave
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);

  let opts = { size: Arcade.load('chroma:size', 5), rivals: Arcade.load('chroma:rivals', 1), level: Arcade.load('chroma:level', 1), hotseat: false };
  let state = 'menu';
  let n, cells, players, turn, placed, moveNo, waveT, flying, pops, time, botT, biggest, chainNow, cell, ox, oy, hover;

  // ---------- Rules (shared by play and the bots' look-ahead) ----------

  const idx = (x, y) => y * n + x;
  function neighbours(i) {
    const x = i % n, y = Math.floor(i / n), out = [];
    if (x > 0) out.push(i - 1);
    if (x < n - 1) out.push(i + 1);
    if (y > 0) out.push(i - n);
    if (y < n - 1) out.push(i + n);
    return out;
  }
  const clone = b => b.map(c => ({ o: c.o, d: c.d }));
  const alive = (b, pl, placedSet) => pl.filter(p => !placedSet.has(p) || b.some(c => c.o === p));

  // One wave: every full cell bursts at once. Returns the bursting cells (empty when settled).
  function wave(b, owner) {
    const full = [];
    for (let i = 0; i < b.length; i++) if (b[i].d >= 4) full.push(i);
    for (const i of full) {
      b[i].d -= 4;
      if (b[i].d === 0) b[i].o = -1;
      for (const j of neighbours(i)) { b[j].d++; b[j].o = owner; }
    }
    return full;
  }
  // Resolve completely (for the bots). Stops once only one colour is left.
  function settle(b, owner, placedSet, pl) {
    let waves = 0, bursts = 0;
    for (; waves < 400; waves++) {
      const w = wave(b, owner);
      if (!w.length) break;
      bursts += w.length;
      if (placedSet && alive(b, pl, placedSet).length <= 1) break;
    }
    return bursts;
  }
  function apply(b, p, i, first) {
    if (first) { b[i].o = p; b[i].d = 3; } else b[i].d++;
  }
  const legal = (b, p, first) => b.map((c, i) => i).filter(i => (first ? b[i].o === -1 : b[i].o === p));

  // ---------- Bots ----------

  function evaluate(b, me) {
    let s = 0;
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c.o === -1) continue;
      const v = c.d + 1.5;
      if (c.o === me) {
        s += v;
        // A full-ish cell next to a fuller enemy cell is about to be stolen.
        for (const j of neighbours(i)) if (b[j].o !== -1 && b[j].o !== me && b[j].d >= 3 && b[j].d >= c.d) s -= c.d * 0.8;
      } else s -= v;
    }
    if (!b.some(c => c.o !== -1 && c.o !== me)) s += 1000;
    if (!b.some(c => c.o === me)) s -= 1000;
    return s;
  }

  function botMove(p) {
    const first = !placed.has(p);
    const moves = legal(cells, p, first);
    const lv = opts.level;
    if (lv === 0 && Math.random() < 0.6) return moves[Math.floor(Math.random() * moves.length)];
    const ps = new Set([...placed, p]);
    let best = -Infinity, pick = moves[0];
    for (const m of moves) {
      const b = clone(cells);
      apply(b, p, m, first);
      settle(b, p, ps, players);
      let v = evaluate(b, p);
      if (lv === 2 && v < 900) {
        // Look one reply ahead: the next rival's strongest answer.
        const opp = nextAlive(p, b, ps);
        if (opp !== null && opp !== p) {
          const oFirst = !ps.has(opp);
          let worst = Infinity;
          for (const r of legal(b, opp, oFirst)) {
            const b2 = clone(b);
            apply(b2, opp, r, oFirst);
            settle(b2, opp, new Set([...ps, opp]), players);
            worst = Math.min(worst, evaluate(b2, p));
          }
          if (worst < Infinity) v = v * 0.4 + worst * 0.6;
        }
      }
      v += Math.random() * 0.3;
      if (v > best) { best = v; pick = m; }
    }
    return pick;
  }

  function nextAlive(p, b = cells, ps = placed) {
    for (let k = 1; k <= players.length; k++) {
      const q = players[(players.indexOf(p) + k) % players.length];
      if (!ps.has(q) || b.some(c => c.o === q)) return q;
    }
    return null;
  }

  // ---------- Game flow ----------

  function newGame() {
    n = opts.size;
    cell = Math.floor(Math.min(560, 560) / n);
    ox = (W - cell * n) / 2;
    oy = 110 + (560 - cell * n) / 2;
    cells = Array.from({ length: n * n }, () => ({ o: -1, d: 0, pulse: 0, pop: 0 }));
    players = Array.from({ length: (opts.hotseat ? 1 : opts.rivals) + 1 }, (_, i) => i);
    placed = new Set();
    turn = 0;
    moveNo = 0;
    flying = [];
    pops = [];
    time = 0;
    botT = 0.6;
    biggest = 0;
    chainNow = 0;
    hover = -1;
    state = 'playing';
    updateHud();
  }

  const isHuman = p => p === 0 || opts.hotseat;

  function play(i) {
    if (state !== 'playing') return false;
    const p = turn, first = !placed.has(p);
    if (first ? cells[i].o !== -1 : cells[i].o !== p) return false;
    apply(cells, p, i, first);
    cells[i].pop = 1;
    placed.add(p);
    moveNo++;
    chainNow = 0;
    Arcade.tone({ freq: 520 + cells[i].d * 90, dur: 0.06, type: 'triangle', vol: 0.05 });
    state = 'resolving';
    waveT = cells.some(c => c.d >= 4) ? WAVE * 0.6 : 0;
    return true;
  }

  function burstWave() {
    const owner = turn;
    const full = wave(cells, owner);
    if (!full.length) return false;
    chainNow += full.length;
    biggest = Math.max(biggest, chainNow);
    for (const i of full) {
      const from = center(i);
      for (const j of neighbours(i)) { flying.push({ from, to: center(j), t: 0, col: COLORS[owner].fill }); cells[j].pop = 1; }
      pops.push({ ...from, t: 0, col: COLORS[owner].glow });
    }
    Arcade.tone({ freq: 300 + Math.min(chainNow, 20) * 40, to: 160, dur: 0.12, type: 'sawtooth', vol: 0.035 });
    if (owner === 0 && !opts.hotseat && chainNow >= 12) Arcade.flag('chroma-burst-chain');
    return true;
  }

  function afterMove() {
    const left = alive(cells, players, placed);
    if (placed.size >= players.length && left.length === 1) return gameOver(left[0]);
    if (!opts.hotseat && placed.has(0) && !cells.some(c => c.o === 0)) return gameOver(left[0] ?? -1);
    turn = nextAlive(turn);
    botT = 0.45 + Math.random() * 0.25;
    state = 'playing';
    updateHud();
  }

  function gameOver(winner) {
    state = 'over';
    const mine = cells.filter(c => c.o === 0).length;
    if (opts.hotseat) {
      ui.show({
        title: `${winner === 0 ? 'Gold' : 'Coral'} wins!`,
        html: `<p>${moveNo} moves · biggest chain ${biggest}</p>`,
        button: 'Rematch',
        onAction: () => { ui.hide(); newGame(); },
      });
      return;
    }
    const won = winner === 0;
    const L = LEVELS[opts.level];
    if (won) {
      Arcade.flag('chroma-burst-win');
      if (opts.level === 2) Arcade.flag('chroma-burst-hard');
      if (opts.rivals === 3) Arcade.flag('chroma-burst-brawl');
    }
    const score = Math.round(((won ? 1000 + mine * 15 + Math.max(0, 60 - moveNo) * 10 : Math.min(moveNo, 40) * 8) + Math.min(biggest, 30) * 20) * L.mult * (1 + (opts.rivals - 1) * 0.35));
    Arcade.tone({ freq: won ? 660 : 300, to: won ? 1320 : 120, dur: 0.4, type: 'triangle', vol: 0.06 });
    Arcade.finish(ui, {
      score,
      title: won ? 'Board painted!' : `${COLORS[winner]?.name || 'A rival'} takes the board`,
      lines: [`${opts.size}×${opts.size} · ${opts.rivals} ${L.name} rival${opts.rivals > 1 ? 's' : ''} · ${moveNo} moves · biggest chain ${biggest}`],
      button: 'Menu',
      onAction: showMenu,
    });
  }

  // ---------- Update and drawing ----------

  const center = i => ({ x: ox + (i % n) * cell + cell / 2, y: oy + Math.floor(i / n) * cell + cell / 2 });

  function update(dt) {
    time += dt;
    for (const c of cells || []) { c.pop = Math.max(0, c.pop - dt * 4); }
    for (const f of flying) f.t += dt / WAVE;
    flying = flying.filter(f => f.t < 1);
    for (const p of pops) p.t += dt * 2.5;
    pops = pops.filter(p => p.t < 1);
    if (state === 'resolving') {
      waveT -= dt;
      if (waveT <= 0) {
        if (burstWave() && chainNow < 2000) {
          waveT = WAVE;
          const left = alive(cells, players, placed);
          if (placed.size >= players.length && left.length <= 1) { waveT = WAVE; state = 'finishing'; }
        } else afterMove();
      }
    } else if (state === 'finishing') {
      waveT -= dt;
      if (waveT <= 0) afterMove();
    } else if (state === 'playing' && !isHuman(turn)) {
      botT -= dt;
      if (botT <= 0) play(botMove(turn));
    }
  }

  function drawDots(x, y, d, col, k) {
    const r = cell * 0.09 * k;
    const sp = cell * 0.17;
    const spots = d === 1 ? [[0, 0]] : d === 2 ? [[-1, 0], [1, 0]] : d === 3 ? [[0, -0.9], [-1, 0.6], [1, 0.6]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    ctx.fillStyle = '#fff';
    for (const [a, b] of spots) { ctx.beginPath(); ctx.arc(x + a * sp, y + b * sp, r, 0, TAU); ctx.fill(); }
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#11131c');
    bg.addColorStop(1, '#0a0b12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (!cells) return;
    // Turn banner and the score bar of territory.
    const who = COLORS[turn];
    ctx.textAlign = 'center';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillStyle = who.fill;
    const label = state === 'over' ? '' : opts.hotseat ? `${turn === 0 ? 'Gold' : 'Coral'}'s turn` : turn === 0 ? 'Your turn' : `${who.name} is thinking…`;
    ctx.fillText(label, W / 2, 40);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    if (state !== 'over' && !placed.has(turn) && isHuman(turn)) ctx.fillText('First move: drop a 3-dot cell on any empty square', W / 2, 62);
    else if (state !== 'over' && isHuman(turn)) ctx.fillText('Tap one of your cells to add a dot · four dots burst', W / 2, 62);
    const counts = players.map(p => cells.reduce((s, c) => s + (c.o === p ? c.d : 0), 0));
    const tot = counts.reduce((a, b) => a + b, 0) || 1;
    let bx = ox;
    for (const p of players) {
      const w = (cell * n) * counts[p] / tot;
      ctx.fillStyle = COLORS[p].fill;
      ctx.fillRect(bx, 80, w, 8);
      bx += w;
    }
    // Board.
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i], { x, y } = center(i);
      const s = cell - 8;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, 12); ctx.fill();
      if (i === hover && state === 'playing' && isHuman(turn)) {
        const ok = placed.has(turn) ? c.o === turn : c.o === -1;
        ctx.strokeStyle = ok ? `rgba(${COLORS[turn].glow},0.7)` : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (c.o === -1) continue;
      const col = COLORS[c.o];
      const ready = c.d >= 3;
      const k = 1 + c.pop * 0.25 + (ready ? Math.sin(time * 8 + i) * 0.04 : 0);
      const r = s * 0.42 * k;
      if (ready) {
        const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.5);
        g.addColorStop(0, `rgba(${col.glow},0.35)`);
        g.addColorStop(1, `rgba(${col.glow},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, TAU); ctx.fill();
      }
      const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(0.25, col.fill);
      body.addColorStop(1, `rgba(${col.glow},0.75)`);
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      drawDots(x, y, Math.min(4, c.d), col, k);
    }
    // Dots in flight from a burst, easing out toward their new square.
    for (const f of flying) {
      const e = 1 - (1 - f.t) ** 3;
      const x = f.from.x + (f.to.x - f.from.x) * e, y = f.from.y + (f.to.y - f.from.y) * e;
      ctx.fillStyle = f.col;
      ctx.beginPath(); ctx.arc(x, y, cell * 0.1, 0, TAU); ctx.fill();
    }
    for (const p of pops) {
      ctx.strokeStyle = `rgba(${p.col},${1 - p.t})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, cell * (0.3 + p.t * 0.6), 0, TAU); ctx.stroke();
    }
    if (chainNow >= 3 && (state === 'resolving' || state === 'finishing')) {
      ctx.font = '900 26px system-ui, sans-serif';
      ctx.fillStyle = COLORS[turn].fill;
      ctx.fillText(`CHAIN ×${chainNow}`, W / 2, H - 14);
    }
  }

  function updateHud() {
    $('turn').textContent = moveNo;
    $('cells').textContent = cells ? cells.filter(c => c.o === 0).length : 0;
    $('chain').textContent = biggest;
  }

  // ---------- Input ----------

  const cellAt = e => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * W / r.width - ox, y = (e.clientY - r.top) * H / r.height - oy;
    if (!n || x < 0 || y < 0 || x >= cell * n || y >= cell * n) return -1;
    return idx(Math.floor(x / cell), Math.floor(y / cell));
  };
  canvas.addEventListener('pointerdown', e => {
    if (!overlayEl.hidden || state !== 'playing' || !isHuman(turn)) return;
    e.preventDefault();
    const i = cellAt(e);
    if (i >= 0 && !play(i)) Arcade.tone({ freq: 160, dur: 0.05, type: 'square', vol: 0.03 });
    updateHud();
  });
  canvas.addEventListener('pointermove', e => { hover = cellAt(e); });
  window.addEventListener('keydown', e => {
    if ((e.code === 'KeyP' || e.code === 'Escape') && state !== 'menu' && state !== 'over') {
      if (overlayEl.hidden) ui.show({ title: 'Paused', html: '<div class="menu"><button class="btn secondary" type="button" data-quit>Quit to menu</button></div>', button: 'Resume', onAction: () => ui.hide(), onRender: p => p.querySelector('[data-quit]').addEventListener('click', showMenu) });
      else ui.hide();
    }
  });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (overlayEl.hidden) update(dt);
    draw();
    if (cells) updateHud();
    requestAnimationFrame(frame);
  }

  // ---------- Menu ----------

  function menuHtml() {
    const chip = (k, v, label) => `<button class="chip" type="button" data-${k}="${v}" aria-pressed="${opts[k] === v}">${label}</button>`;
    return `<ul>
        <li>First turn: drop a <b>three-dot cell</b> on any empty square.</li>
        <li>Then each turn, tap one of <b>your</b> cells to add a dot. At four dots it <b>bursts</b>, throwing a dot into each square beside it and turning them your colour.</li>
        <li>Full cells caught in a burst burst too, so one tap can set off a chain across the board.</li>
        <li>Knock every other colour off the board to win.</li>
      </ul>
      <div class="menu">
        <div class="row">${chip('size', 5, '5×5')}${chip('size', 7, '7×7')}${chip('size', 9, '9×9')}</div>
        <div class="row">${chip('rivals', 1, '1 rival')}${chip('rivals', 2, '2 rivals')}${chip('rivals', 3, '3 rivals')}</div>
        <div class="row">${LEVELS.map((l, i) => chip('level', i, l.name)).join('')}</div>
        <button class="btn secondary" type="button" data-hotseat>Two players, one device</button>
      </div>`;
  }
  const intro = {
    title: 'Chroma Burst',
    get html() { return menuHtml(); },
    button: 'Play the bots',
    onAction: () => { opts.hotseat = false; start(); },
    onRender: panel => {
      for (const k of ['size', 'rivals', 'level']) {
        panel.querySelectorAll(`[data-${k}]`).forEach(b => b.addEventListener('click', () => {
          opts[k] = +b.dataset[k];
          Arcade.save(`chroma:${k}`, opts[k]);
          showMenu();
        }));
      }
      panel.querySelector('[data-hotseat]').addEventListener('click', () => { opts.hotseat = true; ui.hide(); newGame(); });
    },
  };
  function start() { ui.hide(); newGame(); }
  function showMenu() { state = 'menu'; cells = null; Versus.attach({ ui, start: () => { opts.hotseat = false; start(); }, score: () => (cells ? cells.filter(c => c.o === 0).length * 20 : 0), intro }); }

  showMenu();
  requestAnimationFrame(frame);
})();
