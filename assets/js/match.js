/* Turn-based 1v1 plumbing shared by the board games (Gravity Four, Mega Tac-Toe, Fleet Hunt):
   the start menu, the computer and same-device modes, and online matches over the relay.
   Online, both players run the same rules: each sends its own moves and checks the other's, so
   neither side has to be in charge. Rounds alternate who goes first.
     Match.setup({ ui, tag, title, rules, levels, onStart, onMove, winFlag, hardFlag, onlineWinFlag, local })
       local: false hides the same-device mode (for games with hidden information)
       onStart({ mode, level, me, first, names })  a fresh board; `first` is the player who opens
       onMove(data)                                the other player's move, online only
     Match.move(data)         sends this player's move online (no-op offline)
     Match.mine(turn)         true when `turn` (0 or 1) is played on this device right now
     Match.over({ winner, score, lines })  winner 0 or 1, or -1 for a draw; score counts vs the computer */
const Match = (() => {
  let opts = null, room = null;
  const m = { mode: null, level: 0, me: 0, names: ['You', 'Computer'], round: 0 };
  const esc = s => Online.escape(s);

  function setup(o) {
    opts = o;
    m.level = Arcade.load(`${Arcade.gameId}:level`, 1);
    const invite = Relay.takeInvite();
    if (invite) connect('public', invite);
    else menu();
  }

  function menu(error = '') {
    leave();
    m.mode = null;
    const online = Relay.enabled;
    opts.ui.show({
      title: opts.title,
      html: `${opts.rules}
        <div class="menu">
          <div class="row">${opts.levels.map((l, i) => `<button class="btn ${i === m.level ? '' : 'secondary'}" type="button" data-cpu="${i}">${l}</button>`).join('')}</div>
          ${opts.local === false ? '' : '<button class="btn secondary" type="button" data-local>Two players, one device</button>'}
          ${online ? `<button class="btn secondary" type="button" data-net="quick">Quick match online</button>
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
        panel.querySelectorAll('[data-cpu]').forEach(b => b.addEventListener('click', () => offline('cpu', +b.dataset.cpu)));
        panel.querySelector('[data-local]')?.addEventListener('click', () => offline('local', 0));
        const code = panel.querySelector('#code');
        panel.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => connect(b.dataset.net, code.value)));
        code?.addEventListener('keydown', e => { if (e.key === 'Enter') connect('join', code.value); });
        Relay.showWaiting(panel.querySelector('[data-waiting]'), r => connect('public', r));
      },
    });
  }

  function offline(mode, level) {
    m.mode = mode;
    m.me = 0;
    m.round = 0;
    if (mode === 'cpu') {
      m.level = level;
      Arcade.save(`${Arcade.gameId}:level`, level);
    }
    m.names = mode === 'cpu' ? ['You', `${opts.levels[level]} computer`] : ['Player 1', 'Player 2'];
    startRound();
  }

  function startRound() {
    opts.ui.hide();
    opts.onStart({ mode: m.mode, level: m.level, me: m.me, first: m.round % 2, names: m.names.slice() });
  }

  // ---------- Online ----------

  async function connect(how, code) {
    let cancelled = false;
    const cancel = () => { cancelled = true; menu(); };
    opts.ui.show({ title: 'Connecting…', html: '<p>Waking up the game server. The first connection can take up to a minute.</p>', button: 'Cancel', onAction: cancel });
    const handlers = {
      ready: () => {
        if (cancelled || !room) return;
        room.conn.send('hello', { name: Arcade.profile().name });
        if (m.me === 0) newRound(0);
      },
      event: onNet,
      left: opponentLeft,
      closed: () => { if (room) opponentLeft(); },
    };
    try {
      const res = how === 'quick' ? await Relay.quickMatch(opts.tag, handlers, 'Match')
        : how === 'create' ? await Relay.createRoom(opts.tag, handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom(opts.tag, code, handlers);
      if (cancelled) { res.conn.close(); return; }
      m.mode = 'online';
      m.me = res.slot === 1 ? 0 : 1;
      m.names = m.me === 0 ? [Arcade.profile().name, 'Opponent'] : ['Opponent', Arcade.profile().name];
      room = { conn: res.conn, code: res.code || '', want: false, theirWant: false, playing: false };
      if (m.me === 0) {
        opts.ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: how === 'create'
            ? `<p>Share this code. The game starts as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick match.</p>',
          button: 'Cancel',
          onAction: cancel,
        });
      } else {
        opts.ui.show({ title: 'Opponent found', html: '<p>Starting…</p>', button: null });
      }
    } catch (e) {
      if (!cancelled) menu(e.message);
    }
  }

  function newRound(round) {
    room.conn.send('start', { round });
    beginOnline(round);
  }

  function beginOnline(round) {
    m.round = round;
    room.want = room.theirWant = false;
    room.playing = true;
    startRound();
  }

  function onNet(name, data) {
    if (!room) return;
    if (name === 'hello') m.names[1 - m.me] = String(data?.name || 'Opponent').slice(0, 24);
    else if (name === 'start' && m.me === 1) beginOnline(data.round | 0);
    else if (name === 'move' && room.playing) opts.onMove(data || {});
    else if (name === 'rematch') {
      room.theirWant = true;
      if (m.me === 0 && room.want) newRound(m.round + 1);
    } else if (name === 'quit') opponentLeft();
  }

  function opponentLeft() {
    if (!room) return;
    const name = m.names[1 - m.me];
    const wasPlaying = room.playing;
    leave(false);
    if (wasPlaying) {
      Arcade.countPlay();
      Arcade.flag('online-match');
      opts.onStop?.();
      opts.ui.show({ title: `${esc(name)} left`, html: '<p>You win by forfeit.</p>', button: 'Back to menu', onAction: () => menu() });
    } else if (m.mode === 'online' && !document.getElementById('overlay').hidden && document.querySelector('[data-wait]')) {
      document.querySelector('[data-wait]').textContent = `${name} left.`;
    } else {
      menu(`${name} left.`);
    }
  }

  function leave(tell = true) {
    if (!room) return;
    if (tell) room.conn.send('quit');
    room.conn.close();
    room = null;
  }
  window.addEventListener('pagehide', () => room?.conn.send('quit'));

  // ---------- Results ----------

  function over({ winner, score = 0, lines = [] }) {
    const draw = winner === -1;
    if (m.mode === 'cpu') {
      if (winner === 0 && opts.winFlag) Arcade.flag(opts.winFlag);
      if (winner === 0 && m.level === opts.levels.length - 1 && opts.hardFlag) Arcade.flag(opts.hardFlag);
      Arcade.finish(opts.ui, {
        score,
        title: draw ? "It's a draw" : winner === 0 ? 'You win!' : 'The computer wins',
        lines,
        button: 'Menu',
        onAction: () => menu(),
      });
      return;
    }
    Arcade.countPlay();
    let title;
    if (draw) title = "It's a draw";
    else if (m.mode === 'online') title = winner === m.me ? 'You win!' : `${esc(m.names[winner])} wins`;
    else title = `${m.names[winner]} wins!`;
    if (m.mode === 'online') {
      room.playing = false;
      Arcade.flag('online-match');
      if (winner === m.me && opts.onlineWinFlag) Arcade.flag(opts.onlineWinFlag);
    }
    opts.ui.show({
      title,
      html: `${lines.map(l => `<p>${l}</p>`).join('')}<p>${esc(m.names[0])} vs ${esc(m.names[1])}</p>
        <div class="menu"><button class="btn secondary" type="button" data-leave>${m.mode === 'online' ? 'Leave' : 'Menu'}</button></div>
        ${m.mode === 'online' ? '<p class="muted-note" data-wait>A rematch starts when you both press it.</p>' : ''}`,
      button: 'Rematch',
      delay: 400,
      onAction: rematch,
      onRender: panel => panel.querySelector('[data-leave]').addEventListener('click', () => menu()),
    });
  }

  function rematch() {
    if (m.mode !== 'online') {
      m.round++;
      return startRound();
    }
    if (!room) return menu();
    if (room.want) return;
    room.want = true;
    room.conn.send('rematch');
    const w = document.querySelector('[data-wait]');
    if (w) w.textContent = 'Waiting for your opponent…';
    if (m.me === 0 && room.theirWant) newRound(m.round + 1);
  }

  const mine = turn => m.mode === 'local' || turn === m.me;
  const move = data => { if (m.mode === 'online' && room) room.conn.send('move', data); };
  const label = () => (m.mode === 'online' ? `${m.names[0]} vs ${m.names[1]}${room?.code ? ` · room ${room.code}` : ''}` : '');

  return { setup, menu, move, mine, over, label, get mode() { return m.mode; }, get me() { return m.me; }, get names() { return m.names; }, get level() { return m.level; } };
})();
