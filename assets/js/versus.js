/* Online score duels for the single-player games, over the same relay as Rune Rumble.
   Both players start the same game at the same moment, with the same random seed so the
   opening layout matches, watch each other's score live, and the higher final score wins.
   A game opts in by showing its start panel through Versus.attach({ ui, start, score, intro }):
     start  the game's own start function
     score  returns the current score
     intro  the ui.show() options for its start panel, which gains an "online duel" button
   Arcade.finish hands its result panel to Versus while a duel is on. */
const Versus = (() => {
  const SEND_EVERY = 400; // ms between live score updates
  const nativeRandom = Math.random;
  let game = null;
  let net = null;   // { conn, host, names: [me, them], mine, theirs, want: { me, them } }
  let pill = null, timer = null;

  const esc = s => Online.escape(s);
  const tag = () => 'v' + Arcade.gameId.replace(/-/g, '').slice(0, 10);
  const enabled = () => typeof Relay !== 'undefined' && Relay.enabled && !!game;

  // Small seeded generator (mulberry32) so both players' first random rolls line up.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function attach(opts) {
    game = opts;
    const invite = typeof Relay !== 'undefined' && Relay.takeInvite();
    if (invite) connect('public', invite);
    else showIntro();
  }

  function showIntro() {
    const { onRender } = game.intro;
    game.ui.show({
      ...game.intro,
      onRender: panel => {
        onRender?.(panel);
        addButton(panel);
      },
    });
  }

  function addButton(panel) {
    if (!enabled()) return;
    panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-duel>Online duel</button></div>');
    panel.querySelector('[data-duel]').addEventListener('click', () => lobby());
  }

  function lobby(error = '') {
    leave();
    game.ui.show({
      title: 'Online duel',
      html: `<p>Play the same game at the same time as someone else. You'll see their score as you go, and the higher score wins.</p>
        <div class="menu">
          <button class="btn" type="button" data-net="quick">Quick match</button>
          <button class="btn secondary" type="button" data-net="create">Create private room</button>
          <div class="row">
            <input class="field" id="duel-code" maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code">
            <button class="btn secondary" type="button" data-net="join">Join</button>
          </div>
          <button class="btn secondary" type="button" data-back>Back</button>
        </div>
        <p class="error">${error}</p>
        <div data-waiting></div>`,
      button: null,
      onRender: panel => {
        const code = panel.querySelector('#duel-code');
        panel.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => connect(b.dataset.net, code.value)));
        code.addEventListener('keydown', e => { if (e.key === 'Enter') connect('join', code.value); });
        panel.querySelector('[data-back]').addEventListener('click', showIntro);
        Relay.showWaiting(panel.querySelector('[data-waiting]'), room => connect('public', room));
      },
    });
  }

  async function connect(how, code) {
    let cancelled = false;
    const cancel = () => { cancelled = true; lobby(); };
    game.ui.show({ title: 'Connecting…', html: '<p>Waking up the game server. The first connection can take up to a minute.</p>', button: 'Cancel', onAction: cancel });
    const handlers = {
      ready: () => {
        if (cancelled || !net) return;
        net.conn.send('hello', { name: Arcade.profile().name });
        if (net.host) go();
      },
      event: onEvent,
      left: opponentLeft,
      closed: () => { if (net) opponentLeft(); },
    };
    try {
      const res = how === 'quick' ? await Relay.quickMatch(tag(), handlers, 'Duel')
        : how === 'create' ? await Relay.createRoom(tag(), handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom(tag(), code, handlers);
      if (cancelled) { res.conn.close(); return; }
      net = { conn: res.conn, host: res.slot === 1, names: [Arcade.profile().name, 'Opponent'], mine: null, theirs: null, want: { me: false, them: false } };
      if (net.host) {
        game.ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: how === 'create'
            ? `<p>Share this code. The duel starts as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick match.</p>',
          button: 'Cancel',
          onAction: cancel,
        });
      } else {
        game.ui.show({ title: 'Opponent found', html: '<p>Starting…</p>', button: null });
      }
    } catch (e) {
      if (!cancelled) lobby(e.message);
    }
  }

  // The host picks the seed and both sides count down from it.
  function go() {
    const seed = Math.floor(nativeRandom() * 2 ** 31);
    net.want = { me: false, them: false };
    net.conn.send('go', { seed });
    countdown(seed);
  }

  function onEvent(name, data) {
    if (!net) return;
    if (name === 'hello') net.names[1] = String(data?.name || 'Opponent').slice(0, 24);
    else if (name === 'go' && !net.host) countdown(data.seed | 0);
    else if (name === 'score' && net.theirs) net.theirs.score = +data.s || 0;
    else if (name === 'done' && net.theirs) {
      net.theirs = { score: +data.s || 0, done: true };
      renderResult();
    } else if (name === 'rematch') {
      net.want.them = true;
      if (net.host && net.want.me) go();
    } else if (name === 'quit') {
      opponentLeft();
    }
  }

  function countdown(seed) {
    let n = 3;
    const tick = () => {
      if (!net) return;
      if (n === 0) {
        Math.random = seeded(seed);
        net.mine = { score: 0, done: false };
        net.theirs = { score: 0, done: false };
        game.start();
        showPill();
        Arcade.tone({ freq: 880, dur: 0.3, vol: 0.06 });
        return;
      }
      game.ui.show({ title: `Duel vs ${esc(net.names[1])}`, html: `<p class="big">${n}</p><p>Highest score wins.</p>`, button: null });
      Arcade.tone({ freq: 440, dur: 0.12, vol: 0.05 });
      n--;
      setTimeout(tick, 1000);
    };
    tick();
  }

  function showPill() {
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'duel-pill';
      document.querySelector('.stage').appendChild(pill);
    }
    clearInterval(timer);
    let sent = -1;
    const update = () => {
      if (!net?.mine) return;
      const s = net.mine.done ? net.mine.score : Math.round(game.score() || 0);
      if (s !== sent && !net.mine.done) {
        net.conn.send('score', { s });
        sent = s;
      }
      const ahead = s >= net.theirs.score;
      pill.innerHTML = `<span>You <b>${s.toLocaleString()}</b></span><span class="${ahead ? '' : 'lead'}">${esc(net.names[1])} <b>${net.theirs.score.toLocaleString()}</b>${net.theirs.done ? ' ✓' : ''}</span>`;
    };
    update();
    timer = setInterval(update, SEND_EVERY);
    pill.hidden = false;
  }

  // Called by Arcade.finish. Returns overrides for its result panel.
  function finished(score) {
    if (!game) return null;
    if (!net?.mine || net.mine.done) {
      return { onRender: panel => addButton(panel) };
    }
    net.mine = { score, done: true };
    net.conn.send('done', { s: score });
    Arcade.flag('online-match');
    setTimeout(renderResult);
    return {
      html: '<div class="duel-result" data-duel-result></div>',
      button: 'Rematch',
      onAction: rematch,
      onRender: panel => {
        panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-leave>Leave duel</button></div>');
        panel.querySelector('[data-leave]').addEventListener('click', () => {
          leave();
          showIntro();
        });
      },
    };
  }

  function renderResult() {
    const slot = document.querySelector('[data-duel-result]');
    if (!slot || !net?.mine?.done) return;
    const me = net.mine.score, them = net.theirs.score;
    let verdict;
    if (!net.theirs.done) verdict = `<p>Waiting for ${esc(net.names[1])} to finish…</p>`;
    else if (me === them) verdict = '<p class="duel-verdict">It\'s a tie!</p>';
    else verdict = `<p class="duel-verdict ${me > them ? 'win' : 'lose'}">${me > them ? 'You win the duel!' : `${esc(net.names[1])} wins the duel`}</p>`;
    if (net.theirs.done && me > them && !net.counted) {
      net.counted = true;
      Arcade.toast('Duel won', `${me.toLocaleString()} to ${them.toLocaleString()}`);
    }
    slot.innerHTML = `${verdict}<p>You ${me.toLocaleString()} · ${esc(net.names[1])} ${them.toLocaleString()}</p>`;
  }

  function rematch() {
    if (!net) {
      game.start();
      return;
    }
    if (net.want.me) return;
    net.want.me = true;
    net.conn.send('rematch');
    const slot = document.querySelector('[data-duel-result]');
    if (slot) slot.insertAdjacentHTML('beforeend', '<p class="muted-note">Waiting for your opponent to press Rematch…</p>');
    if (net.host && net.want.them) go();
  }

  function opponentLeft() {
    if (!net) return;
    const name = net.names[1];
    const inRun = !!net.mine;
    const waiting = net.mine?.done && !net.theirs?.done;
    leave(false);
    // Mid-run the game carries on solo; before the start there's nothing left to wait for.
    if (!inRun) return lobby(`${name} left the duel.`);
    Arcade.toast('Duel over', `${name} left`);
    const slot = document.querySelector('[data-duel-result]');
    if (slot) slot.innerHTML = `<p>${esc(name)} left${waiting ? ' before finishing. You win!' : '.'}</p>`;
  }

  function leave(tell = true) {
    clearInterval(timer);
    if (pill) pill.hidden = true;
    Math.random = nativeRandom;
    if (!net) return;
    if (tell) net.conn.send('quit');
    net.conn.close();
    net = null;
  }
  window.addEventListener('pagehide', () => leave());

  return { attach, finished, active: () => !!net?.mine };
})();
