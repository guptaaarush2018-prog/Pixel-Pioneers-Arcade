(() => {
  const SIZE = 5;                  // boxes per side
  const DOTS = SIZE + 1;
  const GAP = 76, MARGIN = 50, W = MARGIN * 2 + GAP * SIZE, H = W;
  const H_LINES = DOTS * SIZE;     // horizontal lines come first in the line index
  const LINES = H_LINES * 2;
  const COLORS = ['#ffc53d', '#4f8cff'];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let mode = null;   // 'cpu' | 'local' | 'online'
  let state = 'menu';
  let lines, boxes, turn, scores, lastLine, hover = -1;
  let names = ['You', 'Computer'];
  let me = 0;        // which player this device controls online
  let room = null;   // { conn, code, round, pending } while playing online
  let cpuTimer = null;

  // ---------- Board rules ----------

  // Line geometry: horizontal line i joins dot (r, c) to (r, c+1); vertical joins (r, c) to (r+1, c).
  function lineEnds(i) {
    if (i < H_LINES) {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      return [c, r, c + 1, r];
    }
    const j = i - H_LINES, r = Math.floor(j / DOTS), c = j % DOTS;
    return [c, r, c, r + 1];
  }

  const boxSides = (r, c) => [r * SIZE + c, (r + 1) * SIZE + c, H_LINES + r * DOTS + c, H_LINES + r * DOTS + c + 1];

  function boxesOf(i) {
    const out = [];
    if (i < H_LINES) {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      if (r > 0) out.push([r - 1, c]);
      if (r < SIZE) out.push([r, c]);
    } else {
      const j = i - H_LINES, r = Math.floor(j / DOTS), c = j % DOTS;
      if (c > 0) out.push([r, c - 1]);
      if (c < SIZE) out.push([r, c]);
    }
    return out;
  }

  const sidesDrawn = (ls, r, c) => boxSides(r, c).filter(s => ls[s] !== -1).length;

  function resetBoard(starter = 0) {
    lines = new Array(LINES).fill(-1);
    boxes = new Array(SIZE * SIZE).fill(-1);
    turn = starter;
    scores = [0, 0];
    lastLine = -1;
  }

  // Returns true if the move was legal. Completing a box earns another turn.
  function applyMove(i, player) {
    if (lines[i] !== -1 || player !== turn) return false;
    lines[i] = player;
    lastLine = i;
    let closed = 0;
    for (const [r, c] of boxesOf(i)) {
      if (sidesDrawn(lines, r, c) === 4) {
        boxes[r * SIZE + c] = player;
        scores[player]++;
        closed++;
      }
    }
    if (!closed) turn = 1 - turn;
    return true;
  }

  const gameOver = () => scores[0] + scores[1] === SIZE * SIZE;

  // ---------- Computer player ----------

  function cpuMove() {
    const free = [];
    for (let i = 0; i < LINES; i++) if (lines[i] === -1) free.push(i);
    // 1. Close a box if we can.
    const closing = free.filter(i => boxesOf(i).some(([r, c]) => sidesDrawn(lines, r, c) === 3));
    if (closing.length) return Arcade.pick(closing);
    // 2. Otherwise draw a line that doesn't hand over a box.
    const safe = free.filter(i => boxesOf(i).every(([r, c]) => sidesDrawn(lines, r, c) < 2));
    if (safe.length) return Arcade.pick(safe);
    // 3. Otherwise give away as few boxes as possible.
    let best = free[0], bestCost = Infinity;
    for (const i of free) {
      const cost = chainCost(i);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    return best;
  }

  // How many boxes the opponent could grab in a row after we draw line i.
  function chainCost(i) {
    const ls = lines.slice();
    ls[i] = 1;
    let taken = 0, again = true;
    while (again) {
      again = false;
      for (let j = 0; j < LINES; j++) {
        if (ls[j] !== -1) continue;
        if (boxesOf(j).some(([r, c]) => sidesDrawn(ls, r, c) === 3)) {
          ls[j] = 0;
          taken += boxesOf(j).filter(([r, c]) => sidesDrawn(ls, r, c) === 4).length;
          again = true;
        }
      }
    }
    return taken;
  }

  function scheduleCpu() {
    clearTimeout(cpuTimer);
    if (mode !== 'cpu' || state !== 'playing' || turn !== 1) return;
    cpuTimer = setTimeout(() => {
      if (state !== 'playing' || turn !== 1) return;
      applyMove(cpuMove(), 1);
      Arcade.tone({ freq: 330, dur: 0.05, vol: 0.03 });
      afterMove();
    }, 450);
  }

  // ---------- Turn flow ----------

  function afterMove() {
    updateHud();
    if (gameOver()) endGame();
    else scheduleCpu();
  }

  function endGame() {
    state = 'over';
    const [a, b] = scores;
    if (mode === 'cpu') {
      if (a > b) Arcade.flag('box-battle-win');
      Arcade.finish(ui, {
        score: a,
        title: a > b ? 'You win!' : a < b ? 'The computer wins' : "It's a tie",
        lines: [`${a} – ${b}`],
        button: 'Play again',
        onAction: showMenu,
      });
      return;
    }
    Arcade.countPlay();
    const mine = mode === 'online' ? me : null;
    let title;
    if (a === b) title = "It's a tie";
    else if (mode === 'online') title = (a > b) === (me === 0) ? 'You win!' : `${names[a > b ? 0 : 1]} wins`;
    else title = `${names[a > b ? 0 : 1]} wins!`;
    if (mode === 'online') {
      Arcade.flag('online-match');
      if (a !== b && (a > b) === (mine === 0)) Arcade.flag('box-battle-online-win');
    }
    ui.show({
      title,
      html: `<p class="big">${a} – ${b}</p><p>${Online.escape(names[0])} vs ${Online.escape(names[1])}</p>
        ${mode === 'online' ? '<div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div><p class="muted-note">Either player can start a rematch.</p>' : ''}`,
      button: 'Rematch',
      onAction: rematch,
      delay: 400,
      onRender: panel => panel.querySelector('[data-leave]')?.addEventListener('click', leaveRoom),
    });
  }

  function rematch() {
    if (mode === 'online') {
      if (!room) return showMenu();
      if (me === 0) newRound(room.round + 1);
      else room.conn.send('rematch');
      return;
    }
    startLocal(mode);
  }

  function updateHud() {
    const mine = mode === 'online' ? me : 0;
    $('you').textContent = scores[mine];
    $('them').textContent = scores[1 - mine];
    let label = '-';
    if (state === 'playing') {
      if (mode === 'local') label = names[turn];
      else label = turn === mine ? 'Yours' : mode === 'cpu' ? 'Computer' : 'Theirs';
    }
    $('turn').textContent = label;
  }

  // ---------- Modes ----------

  function startLocal(m) {
    mode = m;
    names = m === 'cpu' ? ['You', 'Computer'] : ['Player 1', 'Player 2'];
    resetBoard(0);
    state = 'playing';
    ui.hide();
    updateHud();
  }

  // Online matches go over the relay (relay.js). The host (player 0) keeps the real board: the
  // guest asks to draw a line, the host checks it and tells both sides, so the boards never drift.
  async function goOnline(how, code) {
    let cancelled = false;
    const cancel = () => { cancelled = true; showMenu(); };
    ui.show({ title: 'Connecting…', html: '<p>Waking up the game server. The first connection can take up to a minute.</p>', button: 'Cancel', onAction: cancel });
    const handlers = {
      ready: () => {
        if (cancelled || !room) return;
        room.conn.send('hello', { name: Arcade.profile().name });
        if (me === 0) newRound(0);
      },
      event: onNet,
      left: opponentLeft,
      closed: () => { if (room) opponentLeft(); },
    };
    try {
      const res = how === 'quick' ? await Relay.quickMatch('boxes', handlers, 'Match')
        : how === 'create' ? await Relay.createRoom('boxes', handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom('boxes', code, handlers);
      if (cancelled) { res.conn.close(); return; }
      mode = 'online';
      me = res.slot === 1 ? 0 : 1;
      names = me === 0 ? [Arcade.profile().name, 'Guest'] : ['Host', Arcade.profile().name];
      room = { conn: res.conn, code: res.code || '', round: -1, pending: -1 };
      if (me === 0) {
        ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: how === 'create'
            ? `<p>Share this code. The game starts as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick match.</p>',
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

  // Host only: a fresh board for both players. Starts alternate between rounds.
  function newRound(round) {
    room.conn.send('start', { round });
    beginRound(round);
  }

  function beginRound(round) {
    room.round = round;
    room.pending = -1;
    resetBoard(round % 2);
    state = 'playing';
    ui.hide();
    updateHud();
  }

  function onNet(name, data) {
    if (!room) return;
    if (name === 'hello') names[1 - me] = String(data?.name || 'Opponent').slice(0, 24);
    else if (name === 'start' && me === 1) beginRound(data.round | 0);
    else if (name === 'try' && me === 0 && state === 'playing') {
      if (applyMove(data.l | 0, 1)) shareMove(data.l | 0, 1);
    } else if (name === 'moved' && me === 1) {
      applyMove(data.l, data.p);
      if (data.p !== me) Arcade.tone({ freq: 330, dur: 0.05, vol: 0.03 });
      room.pending = -1;
      afterOnlineMove();
    } else if (name === 'rematch' && me === 0 && state === 'over') newRound(room.round + 1);
    else if (name === 'quit') opponentLeft();
  }

  function shareMove(l, p) {
    room.conn.send('moved', { l, p });
    if (p !== me) Arcade.tone({ freq: 330, dur: 0.05, vol: 0.03 });
    afterOnlineMove();
  }

  function afterOnlineMove() {
    updateHud();
    if (gameOver() && state === 'playing') endGame();
  }

  function opponentLeft() {
    if (!room) return;
    const wasPlaying = state === 'playing';
    closeRoom();
    if (wasPlaying) Arcade.countPlay();
    state = 'over';
    ui.show({ title: 'Your opponent left', html: wasPlaying ? '<p>The game ends here.</p>' : '', button: 'Back to menu', onAction: () => showMenu() });
  }

  function closeRoom() {
    room?.conn.close();
    room = null;
  }

  function leaveRoom() {
    room?.conn.send('quit');
    closeRoom();
    showMenu();
  }
  // Closing the tab counts as leaving, so the other player isn't left waiting.
  window.addEventListener('pagehide', () => room?.conn.send('quit'));

  function showMenu(error = '') {
    clearTimeout(cpuTimer);
    closeRoom();
    state = 'menu';
    mode = null;
    resetBoard(0);
    updateHud();
    const online = Relay.enabled;
    ui.show({
      title: 'Box Battle',
      html: `<p>Take turns drawing lines between dots. Close a box to claim it and go again. Most boxes wins.</p>
        <div class="menu">
          <button class="btn" type="button" data-mode="cpu">Play the computer</button>
          <button class="btn secondary" type="button" data-mode="local">Two players, one device</button>
          <button class="btn secondary" type="button" data-mode="quick" ${online ? '' : 'disabled'}>Quick match online</button>
          <button class="btn secondary" type="button" data-mode="create" ${online ? '' : 'disabled'}>Create private room</button>
          <div class="row">
            <input class="field" id="code" maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code" ${online ? '' : 'disabled'}>
            <button class="btn secondary" type="button" data-mode="join" ${online ? '' : 'disabled'}>Join</button>
          </div>
        </div>
        <p class="error">${error}</p>
        <div data-waiting></div>
        ${online ? '' : '<p class="muted-note">Online play isn\'t switched on for this arcade yet.</p>'}`,
      button: null,
      onRender: panel => {
        const code = panel.querySelector('#code');
        panel.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
          const m = b.dataset.mode;
          if (m === 'cpu' || m === 'local') startLocal(m);
          else goOnline(m, code.value);
        }));
        code.addEventListener('keydown', e => { if (e.key === 'Enter') goOnline('join', code.value); });
        Relay.showWaiting(panel.querySelector('[data-waiting]'), r => goOnline('public', r));
      },
    });
  }

  // ---------- Input ----------

  function lineAt(px, py) {
    let best = -1, bestD = 24;
    for (let i = 0; i < LINES; i++) {
      if (lines[i] !== -1) continue;
      const [c1, r1, c2, r2] = lineEnds(i);
      const mx = MARGIN + ((c1 + c2) / 2) * GAP, my = MARGIN + ((r1 + r2) / 2) * GAP;
      const d = Math.hypot(px - mx, py - my);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  const myTurn = () => state === 'playing' && (mode === 'local' || turn === (mode === 'online' ? me : 0));

  canvas.addEventListener('pointermove', e => { hover = myTurn() ? lineAt(...toBoard(e)) : -1; });
  canvas.addEventListener('pointerleave', () => { hover = -1; });
  canvas.addEventListener('pointerdown', e => {
    if (!myTurn()) return;
    const i = lineAt(...toBoard(e));
    if (i < 0) return;
    hover = -1;
    Arcade.tone({ freq: 440, dur: 0.05, vol: 0.03 });
    if (mode === 'online') {
      if (me === 0) {
        if (applyMove(i, 0)) shareMove(i, 0);
      } else if (room.pending === -1) {
        room.pending = i;
        room.conn.send('try', { l: i });
      }
      return;
    }
    applyMove(i, turn);
    afterMove();
  });

  // ---------- Drawing ----------

  function draw() {
    ctx.fillStyle = '#161920';
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const owner = boxes[r * SIZE + c];
        if (owner === -1) continue;
        ctx.fillStyle = owner ? 'rgba(79,140,255,0.22)' : 'rgba(255,197,61,0.22)';
        ctx.fillRect(MARGIN + c * GAP + 4, MARGIN + r * GAP + 4, GAP - 8, GAP - 8);
        ctx.fillStyle = COLORS[owner];
        ctx.font = '700 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(names[owner][0], MARGIN + c * GAP + GAP / 2, MARGIN + r * GAP + GAP / 2);
      }
    }
    ctx.textBaseline = 'alphabetic';

    const stroke = (i, color, width) => {
      const [c1, r1, c2, r2] = lineEnds(i);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(MARGIN + c1 * GAP, MARGIN + r1 * GAP);
      ctx.lineTo(MARGIN + c2 * GAP, MARGIN + r2 * GAP);
      ctx.stroke();
    };
    for (let i = 0; i < LINES; i++) {
      if (lines[i] === -1) stroke(i, '#232833', 4);
    }
    if (hover >= 0) stroke(hover, mode === 'online' ? COLORS[me] + '88' : COLORS[turn] + '88', 6);
    if (room && room.pending >= 0 && lines[room.pending] === -1) stroke(room.pending, COLORS[me] + '88', 6);
    for (let i = 0; i < LINES; i++) {
      if (lines[i] !== -1) stroke(i, COLORS[lines[i]], i === lastLine ? 7 : 6);
    }

    ctx.fillStyle = '#eceef2';
    for (let r = 0; r < DOTS; r++) {
      for (let c = 0; c < DOTS; c++) {
        ctx.beginPath();
        ctx.arc(MARGIN + c * GAP, MARGIN + r * GAP, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (state === 'playing' && mode === 'online') {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8d94a1';
      ctx.fillText(`${names[0]} vs ${names[1]}${room?.code ? ` · room ${room.code}` : ''}`, W / 2, H - 14);
    }
  }

  function frame() {
    draw();
    requestAnimationFrame(frame);
  }

  resetBoard(0);
  showMenu();
  const invite = Relay.takeInvite();
  if (invite) goOnline('public', invite);
  requestAnimationFrame(frame);
})();
