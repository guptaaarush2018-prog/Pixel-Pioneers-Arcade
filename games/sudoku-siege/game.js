(() => {
  const W = 600, H = 690;
  const CELL = 56, BX = (W - CELL * 9) / 2, BY = 52;
  const PAD_Y = BY + CELL * 9 + 16, PAD_W = 50, PAD_H = 50, PAD_G = 6;
  const FOG_TIME = 6, LOCK_TIME = 2;
  const LEVELS = [
    { name: 'Easy', clues: 40, base: 1200 },
    { name: 'Medium', clues: 32, base: 2400 },
    { name: 'Hard', clues: 26, base: 3600 },
  ];
  const BOTS = [
    { name: 'Rookie', every: 10 },
    { name: 'Pro', every: 6 },
  ];
  const WIN_BONUS = 800;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const esc = s => Online.escape(s);

  let state = 'menu', mode = 'solo';  // 'solo' | 'bot' | 'online'
  let level = Arcade.load('sudoku:level', 0), botLevel = 0;
  let puzzle, solution, cells, notes, wrong, sel, noteMode, mistakes, clock, lockT, done, fog, rival, bot;
  let net = null;  // { conn, host, names, round, mineDone, theirDone }

  // ---------- Puzzle generation ----------

  const rowOf = i => Math.floor(i / 9), colOf = i => i % 9, boxOf = i => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
  const PEERS = Array.from({ length: 81 }, (_, i) => {
    const out = new Set();
    for (let j = 0; j < 81; j++) if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) out.add(j);
    return [...out];
  });
  const UNITS = [
    ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
    ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
    ...Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3))),
  ];
  const BOX_CELLS = UNITS.slice(18);

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const candidates = (g, i) => {
    let used = 0;
    for (const p of PEERS[i]) if (g[p]) used |= 1 << g[p];
    const out = [];
    for (let d = 1; d <= 9; d++) if (!(used & (1 << d))) out.push(d);
    return out;
  };

  // Counts solutions up to `limit`, always branching on the emptiest cell with the fewest options.
  function countSolutions(g, limit = 2) {
    let best = -1, bestC = null;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const c = candidates(g, i);
      if (!c.length) return 0;
      if (!bestC || c.length < bestC.length) { best = i; bestC = c; if (c.length === 1) break; }
    }
    if (best < 0) return 1;
    let n = 0;
    for (const d of bestC) {
      g[best] = d;
      n += countSolutions(g, limit - n);
      g[best] = 0;
      if (n >= limit) break;
    }
    return n;
  }

  function fill(g) {
    const i = g.indexOf(0);
    if (i < 0) return true;
    for (const d of shuffle(candidates(g, i))) {
      g[i] = d;
      if (fill(g)) return true;
    }
    g[i] = 0;
    return false;
  }

  // A full random grid, then clues removed one at a time as long as the answer stays unique.
  function generate(clues) {
    const full = Array(81).fill(0);
    fill(full);
    const g = full.slice();
    let left = 81;
    for (const i of shuffle([...Array(81).keys()])) {
      if (left <= clues) break;
      const keep = g[i];
      g[i] = 0;
      if (countSolutions(g.slice()) !== 1) g[i] = keep;
      else left--;
    }
    return { puzzle: g, solution: full };
  }

  // ---------- Board state ----------

  function load(p, s) {
    puzzle = p.slice();
    solution = s.slice();
    cells = p.slice();
    notes = Array(81).fill(0);
    wrong = Array(81).fill(false);
    sel = puzzle.indexOf(0);
    noteMode = false;
    mistakes = 0;
    clock = 0;
    lockT = 0;
    done = new Set();
    fog = null;
    rival = { filled: 0, total: 81 - puzzle.filter(Boolean).length };
    updateHud();
  }

  const filledRight = () => cells.filter((v, i) => !puzzle[i] && v === solution[i]).length;
  const solved = () => cells.every((v, i) => v === solution[i]);
  const fogged = i => fog && BOX_CELLS[fog.box].includes(i);

  function place(d) {
    if (state !== 'playing' || sel < 0 || puzzle[sel] || lockT > 0 || fogged(sel)) return;
    if (noteMode && d) {
      if (!cells[sel]) notes[sel] ^= 1 << d;
      return;
    }
    if (cells[sel] === d) d = 0;
    cells[sel] = d;
    wrong[sel] = !!d && d !== solution[sel];
    if (!d) return;
    if (wrong[sel]) {
      mistakes++;
      if (mode !== 'solo') lockT = LOCK_TIME;
      Arcade.tone({ freq: 200, to: 120, dur: 0.2, type: 'sawtooth', vol: 0.04 });
      return;
    }
    notes[sel] = 0;
    for (const p of PEERS[sel]) notes[p] &= ~(1 << d);
    Arcade.tone({ freq: 520 + d * 30, dur: 0.06, type: 'triangle', vol: 0.04 });
    checkUnits(sel);
    net?.conn.send('prog', { n: filledRight() });
    if (solved()) finished();
  }

  // Finishing a row, column or box rings a chime and, in a race, fogs one box on the rival's board.
  function checkUnits(i) {
    UNITS.forEach((u, k) => {
      if (done.has(k) || !u.includes(i) || !u.every(j => cells[j] === solution[j])) return;
      done.add(k);
      Arcade.tone({ freq: 784, to: 1175, dur: 0.18, type: 'triangle', vol: 0.05, delay: 0.05 });
      if (mode === 'bot') bot.wait = Math.max(bot.wait, FOG_TIME);
      if (mode === 'online' && net) net.conn.send('fog');
    });
  }

  function fogMe() {
    const open = BOX_CELLS.map((b, k) => k).filter(k => BOX_CELLS[k].some(j => cells[j] !== solution[j]) && k !== fog?.box);
    if (!open.length) return;
    fog = { box: open[Math.floor(Math.random() * open.length)], t: FOG_TIME };
    Arcade.tone({ freq: 160, dur: 0.3, type: 'sine', vol: 0.06 });
  }

  // ---------- Bot rival ----------

  function botStep(dt) {
    bot.wait -= dt;
    if (bot.wait > 0) return;
    bot.wait = BOTS[botLevel].every * Arcade.rand(0.7, 1.3);
    const i = bot.todo.pop();
    if (i === undefined) return;
    bot.grid[i] = solution[i];
    rival.filled++;
    UNITS.forEach((u, k) => {
      if (bot.done.has(k) || !u.includes(i) || !u.every(j => bot.grid[j])) return;
      bot.done.add(k);
      fogMe();
    });
    if (!bot.todo.length) lost('The bot finished first');
  }

  // ---------- Flow ----------

  function score() {
    const L = LEVELS[mode === 'solo' ? level : 1];
    return Math.max(100, Math.round(L.base - clock * 2 - mistakes * 60));
  }

  function finished() {
    if (mode === 'online') {
      state = 'waiting';
      if (net.host) decide(0);
      else net.conn.send('done');
      return;
    }
    state = 'over';
    const won = mode === 'bot';
    const s = score() + (won ? WIN_BONUS : 0);
    if (mode === 'solo' && level === 2) Arcade.flag('sudoku-siege-hard');
    if (!mistakes) Arcade.flag('sudoku-siege-clean');
    [523, 659, 784, 1046].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.15, type: 'triangle', vol: 0.05, delay: i * 0.1 }));
    Arcade.finish(ui, {
      score: s,
      title: won ? 'You beat the bot!' : 'Solved!',
      lines: [`${LEVELS[mode === 'solo' ? level : 1].name} · ${fmt(clock)} · ${mistakes} mistake${mistakes === 1 ? '' : 's'}`],
      button: 'Menu',
      onAction: () => showMenu(),
    });
  }

  function lost(title) {
    state = 'over';
    const s = filledRight() * 15;
    Arcade.tone({ freq: 330, to: 160, dur: 0.5, type: 'sawtooth', vol: 0.04 });
    Arcade.finish(ui, {
      score: s,
      title,
      lines: [`You filled ${filledRight()} of ${rival.total} cells.`],
      button: 'Menu',
      onAction: () => showMenu(),
    });
  }

  function startSolo(lv) {
    level = lv;
    Arcade.save('sudoku:level', lv);
    mode = 'solo';
    const g = generate(LEVELS[lv].clues);
    load(g.puzzle, g.solution);
    state = 'playing';
    ui.hide();
  }

  function startBot(lv) {
    botLevel = lv;
    mode = 'bot';
    const g = generate(LEVELS[1].clues);
    load(g.puzzle, g.solution);
    bot = { grid: g.puzzle.slice(), todo: shuffle(g.puzzle.map((v, i) => (v ? -1 : i)).filter(i => i >= 0)), wait: BOTS[lv].every, done: new Set() };
    state = 'playing';
    ui.hide();
  }

  function pause() {
    if (state !== 'playing' || mode === 'online') return;
    state = 'paused';
    ui.show({ title: 'Paused', html: '<p>The clock is stopped.</p>', button: 'Resume', onAction: resume });
  }

  function resume() {
    state = 'playing';
    ui.hide();
  }

  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  function updateHud() {
    $('time').textContent = fmt(clock || 0);
    $('mistakes').textContent = mistakes || 0;
    $('mode').textContent = mode === 'solo' ? LEVELS[level].name : mode === 'bot' ? `vs ${BOTS[botLevel].name}` : 'Online';
  }

  function showMenu(error = '') {
    leaveNet();
    state = 'menu';
    mode = 'solo';
    const online = Relay.enabled;
    ui.show({
      title: 'Sudoku Siege',
      html: `<p>Fill the grid so every row, column and 3×3 box has 1 to 9.</p>
        <ul>
          <li><b>Solo:</b> beat the clock. Fewer mistakes and a faster time score more.</li>
          <li><b>Race:</b> you and a rival solve the same puzzle. Finish a row, column or box to <b>fog</b> one of their boxes for ${FOG_TIME} seconds. A wrong number locks you out for ${LOCK_TIME}.</li>
        </ul>
        <div class="menu">
          <div class="row">${LEVELS.map((l, i) => `<button class="btn ${i === level ? '' : 'secondary'}" type="button" data-solo="${i}">${l.name}</button>`).join('')}</div>
          <div class="row">${BOTS.map((b, i) => `<button class="btn secondary" type="button" data-bot="${i}">Race ${b.name} bot</button>`).join('')}</div>
          ${online ? `<button class="btn secondary" type="button" data-net="quick">Quick race online</button>
          <button class="btn secondary" type="button" data-net="create">Create private room</button>
          <div class="row">
            <input class="field" id="code" maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code">
            <button class="btn secondary" type="button" data-net="join">Join</button>
          </div>` : ''}
        </div>
        <p class="error">${esc(error)}</p>
        <div data-waiting></div>`,
      button: null,
      onRender: panel => {
        panel.querySelectorAll('[data-solo]').forEach(b => b.addEventListener('click', () => startSolo(+b.dataset.solo)));
        panel.querySelectorAll('[data-bot]').forEach(b => b.addEventListener('click', () => startBot(+b.dataset.bot)));
        const code = panel.querySelector('#code');
        panel.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => goOnline(b.dataset.net, code.value)));
        code?.addEventListener('keydown', e => { if (e.key === 'Enter') goOnline('join', code.value); });
        Relay.showWaiting(panel.querySelector('[data-waiting]'), room => goOnline('public', room));
      },
    });
  }

  // ---------- Online race ----------
  // The host makes the puzzle and sends it over. Both boards are played locally; progress and fog
  // go back and forth as events, and the host decides who finished first.

  async function goOnline(how, code) {
    let cancelled = false;
    const cancel = () => { cancelled = true; showMenu(); };
    ui.show({ title: 'Connecting…', html: '<p>Waking up the game server. The first connection can take up to a minute.</p>', button: 'Cancel', onAction: cancel });
    const handlers = {
      ready: () => {
        if (cancelled || !net) return;
        net.conn.send('hello', { name: Arcade.profile().name });
        if (net.host) newRound(0);
      },
      event: onNet,
      left: opponentLeft,
      closed: () => { if (net) opponentLeft(); },
    };
    try {
      const res = how === 'quick' ? await Relay.quickMatch('sudoku', handlers, 'Race')
        : how === 'create' ? await Relay.createRoom('sudoku', handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom('sudoku', code, handlers);
      if (cancelled) { res.conn.close(); return; }
      net = { conn: res.conn, host: res.slot === 1, names: [Arcade.profile().name, 'Opponent'], round: -1, want: false, theirWant: false };
      if (net.host) {
        ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: how === 'create'
            ? `<p>Share this code. The race starts as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick race.</p>',
          button: 'Cancel',
          onAction: cancel,
        });
      } else {
        ui.show({ title: 'Opponent found', html: '<p>Starting…</p>', button: null });
      }
    } catch (e) {
      if (!cancelled) showMenu(e.message);
    }
  }

  function newRound(round) {
    const g = generate(LEVELS[1].clues);
    net.conn.send('start', { round, p: g.puzzle.join(''), s: g.solution.join('') });
    beginRound(round, g.puzzle, g.solution);
  }

  function beginRound(round, p, s) {
    mode = 'online';
    net.round = round;
    net.want = net.theirWant = false;
    net.decided = false;
    load(p, s);
    state = 'playing';
    ui.hide();
  }

  // Host only: whoever reports a finished board first wins.
  function decide(winner) {
    if (net.decided) return;
    net.decided = true;
    net.conn.send('result', { w: winner });
    showResult(winner === 0);
  }

  function onNet(name, data) {
    if (!net) return;
    if (name === 'hello') net.names[1] = String(data?.name || 'Opponent').slice(0, 24);
    else if (name === 'start' && !net.host) {
      const p = String(data.p || '').split('').map(Number), s = String(data.s || '').split('').map(Number);
      if (p.length === 81 && s.length === 81) beginRound(data.round | 0, p, s);
    } else if (name === 'prog' && rival) rival.filled = Math.max(0, Math.min(rival.total, data.n | 0));
    else if (name === 'fog' && state === 'playing') fogMe();
    else if (name === 'done' && net.host) decide(1);
    else if (name === 'result' && !net.host) showResult(data.w === 1);
    else if (name === 'rematch') {
      net.theirWant = true;
      if (net.host && net.want) newRound(net.round + 1);
    } else if (name === 'quit') opponentLeft();
  }

  function showResult(won) {
    state = 'over';
    Arcade.countPlay();
    Arcade.flag('online-match');
    if (won) Arcade.flag('sudoku-siege-online-win');
    Arcade.tone(won ? { freq: 660, to: 1320, dur: 0.4, type: 'triangle', vol: 0.06 } : { freq: 330, to: 160, dur: 0.5, type: 'sawtooth', vol: 0.04 });
    ui.show({
      title: won ? 'You win the race!' : `${esc(net.names[1])} wins`,
      html: `<p>${won ? `Solved in ${fmt(clock)}.` : `You filled ${filledRight()} of ${rival.total} cells.`}</p>
        <div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div>
        <p class="muted-note" data-wait>A rematch starts when you both press it.</p>`,
      button: 'Rematch',
      onAction: () => {
        if (!net) return showMenu();
        net.want = true;
        net.conn.send('rematch');
        document.querySelector('[data-wait]').textContent = 'Waiting for your opponent…';
        if (net.host && net.theirWant) newRound(net.round + 1);
      },
      onRender: panel => panel.querySelector('[data-leave]').addEventListener('click', () => showMenu()),
    });
  }

  function opponentLeft() {
    if (!net) return;
    const name = net.names[1];
    const wasPlaying = state === 'playing' || state === 'waiting';
    leaveNet(false);
    if (wasPlaying) {
      state = 'over';
      Arcade.countPlay();
      ui.show({ title: `${esc(name)} left`, html: '<p>You win by forfeit.</p>', button: 'Back to menu', onAction: () => showMenu() });
    } else if (state === 'over') {
      const w = document.querySelector('[data-wait]');
      if (w) w.textContent = `${name} left.`;
    } else showMenu(`${name} left.`);
  }

  function leaveNet(tell = true) {
    if (!net) return;
    if (tell) net.conn.send('quit');
    net.conn.close();
    net = null;
  }
  window.addEventListener('pagehide', () => net?.conn.send('quit'));

  // ---------- Input ----------

  window.addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (state !== 'playing') return;
    const dir = Arcade.DIRS[e.code];
    if (dir && sel >= 0) {
      const v = Arcade.VEC[dir];
      sel = ((rowOf(sel) + v.y + 9) % 9) * 9 + (colOf(sel) + v.x + 9) % 9;
    } else if (/^Digit[1-9]$|^Numpad[1-9]$/.test(e.code)) place(+e.code.slice(-1));
    else if (['Backspace', 'Delete', 'Digit0', 'Numpad0'].includes(e.code)) place(0);
    else if (e.code === 'KeyN') noteMode = !noteMode;
  });

  const padKeys = [];
  for (let d = 1; d <= 9; d++) padKeys.push({ d, x: (W - (9 * PAD_W + 8 * PAD_G)) / 2 + (d - 1) * (PAD_W + PAD_G), y: PAD_Y, w: PAD_W, h: PAD_H });
  padKeys.push({ d: 'notes', x: W / 2 - 160, y: PAD_Y + PAD_H + 8, w: 154, h: 40 });
  padKeys.push({ d: 0, x: W / 2 + 6, y: PAD_Y + PAD_H + 8, w: 154, h: 40 });

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const c = Math.floor((px - BX) / CELL), rr = Math.floor((py - BY) / CELL);
    if (c >= 0 && c < 9 && rr >= 0 && rr < 9) { sel = rr * 9 + c; return; }
    const k = padKeys.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
    if (!k) return;
    if (k.d === 'notes') noteMode = !noteMode;
    else place(k.d);
  });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function draw() {
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, W, H);
    if (!cells) return;

    // Rival progress
    if (mode !== 'solo' && rival) {
      const label = mode === 'bot' ? `${BOTS[botLevel].name} bot` : net?.names[1] || 'Opponent';
      const mine = filledRight() / rival.total, theirs = rival.filled / rival.total;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      [[`You`, mine, '#4f8cff', 14], [label, theirs, '#ff7a7a', 32]].forEach(([name, f, col, y]) => {
        ctx.fillStyle = '#8d94a1';
        ctx.fillText(name, BX, y);
        ctx.fillStyle = '#1e222a';
        ctx.fillRect(BX + 110, y - 5, CELL * 9 - 110, 10);
        ctx.fillStyle = col;
        ctx.fillRect(BX + 110, y - 5, (CELL * 9 - 110) * f, 10);
      });
    }

    const selVal = sel >= 0 ? cells[sel] : 0;
    for (let i = 0; i < 81; i++) {
      const x = BX + colOf(i) * CELL, y = BY + rowOf(i) * CELL;
      let bg = '#161920';
      if (sel >= 0 && PEERS[sel].includes(i)) bg = '#1b2030';
      if (selVal && cells[i] === selVal) bg = '#24304a';
      if (i === sel) bg = '#2c3d63';
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, CELL, CELL);
      if (cells[i]) {
        ctx.fillStyle = puzzle[i] ? '#eceef2' : wrong[i] ? '#ff7a7a' : '#7fb0ff';
        ctx.font = `${puzzle[i] ? 700 : 600} 28px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cells[i], x + CELL / 2, y + CELL / 2 + 2);
      } else if (notes[i]) {
        ctx.fillStyle = '#8d94a1';
        ctx.font = '500 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let d = 1; d <= 9; d++) {
          if (notes[i] & (1 << d)) ctx.fillText(d, x + 10 + ((d - 1) % 3) * 18, y + 11 + Math.floor((d - 1) / 3) * 17);
        }
      }
    }

    // Grid lines
    for (let k = 0; k <= 9; k++) {
      ctx.strokeStyle = k % 3 ? '#2a2f39' : '#6b7280';
      ctx.lineWidth = k % 3 ? 1 : 2.5;
      ctx.beginPath();
      ctx.moveTo(BX + k * CELL, BY); ctx.lineTo(BX + k * CELL, BY + 9 * CELL);
      ctx.moveTo(BX, BY + k * CELL); ctx.lineTo(BX + 9 * CELL, BY + k * CELL);
      ctx.stroke();
    }

    // Fog over one box
    if (fog) {
      const b = fog.box, x = BX + (b % 3) * CELL * 3, y = BY + Math.floor(b / 3) * CELL * 3;
      ctx.fillStyle = 'rgba(150,160,180,0.92)';
      ctx.fillRect(x + 1, y + 1, CELL * 3 - 2, CELL * 3 - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      const t = performance.now() / 600;
      for (let k = 0; k < 6; k++) {
        ctx.beginPath();
        ctx.arc(x + 30 + ((k * 47 + t * 12) % (CELL * 3 - 50)), y + 30 + ((k * 61) % (CELL * 3 - 50)), 22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#1b1e24';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Fogged ${Math.ceil(fog.t)}s`, x + CELL * 1.5, y + CELL * 1.5);
    }

    if (lockT > 0) {
      ctx.fillStyle = 'rgba(255,122,122,0.12)';
      ctx.fillRect(BX, BY, CELL * 9, CELL * 9);
      ctx.fillStyle = '#ff7a7a';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Wrong number · locked ${lockT.toFixed(1)}s`, W / 2, BY + CELL * 9 + 10);
    }

    // Number pad
    const counts = Array(10).fill(0);
    cells.forEach((v, i) => { if (v && v === solution[i]) counts[v]++; });
    for (const k of padKeys) {
      const on = k.d === 'notes' && noteMode;
      const used = typeof k.d === 'number' && k.d > 0 && counts[k.d] >= 9;
      ctx.fillStyle = on ? '#ffc53d' : '#1e222a';
      ctx.globalAlpha = used ? 0.35 : 1;
      ctx.beginPath(); ctx.roundRect(k.x, k.y, k.w, k.h, 8); ctx.fill();
      ctx.fillStyle = on ? '#1c1500' : '#eceef2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (typeof k.d === 'number' && k.d > 0) {
        ctx.font = '700 24px system-ui, sans-serif';
        ctx.fillText(k.d, k.x + k.w / 2, k.y + k.h / 2 - 3);
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.fillStyle = '#8d94a1';
        ctx.fillText(9 - counts[k.d], k.x + k.w / 2, k.y + k.h - 8);
      } else {
        ctx.font = '600 15px system-ui, sans-serif';
        ctx.fillText(k.d === 'notes' ? `Notes ${noteMode ? 'on' : 'off'} (N)` : 'Erase (⌫)', k.x + k.w / 2, k.y + k.h / 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';

    if (state === 'waiting') {
      ctx.fillStyle = 'rgba(14,16,20,0.7)';
      ctx.fillRect(BX, BY, CELL * 9, CELL * 9);
      ctx.fillStyle = '#eceef2';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Checking who finished first…', W / 2, BY + CELL * 4.5);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state === 'playing') {
      clock += dt;
      lockT = Math.max(0, lockT - dt);
      if (fog && (fog.t -= dt) <= 0) fog = null;
      if (mode === 'bot') botStep(dt);
      updateHud();
    }
    draw();
    requestAnimationFrame(frame);
  }

  showMenu();
  const invite = Relay.takeInvite();
  if (invite) goOnline('public', invite);
  requestAnimationFrame(frame);
})();
