/* Real-time two-player sessions over the relay (relay.js) for games that run their own live
   simulation on both machines (Zap Arena 1v1, Block Frontier co-op). This file only does the
   plumbing every such game repeats: the Quick match / private room / join buttons, connecting,
   the hello, rematches, and telling a forfeit apart from a dropped connection.

     const live = Live.create({ ui, tag, label, title,
       onReady(host),         both players are in the room (host is slot 1)
       onEvent(name, data),   a message from the other player
       onState(data),         a playerState message from the other player
       onRematch(),           host only: both pressed Rematch
       onGone(lost),          the other player left (lost: our own connection dropped instead)
       onCancel() })          the player backed out of connecting or waiting
     live.html() / live.wire(panel)  the online buttons, for a menu panel
     live.connect(how, code)         'quick' | 'create' | 'join' | 'public'
     live.send(name, data), live.state(data), live.leave(), live.rematch()
     Live.invite(tag)  a lobby link (?join=pp-<tag>-…) meant for this mode, taken off the URL */
const Live = (() => {
  const esc = s => (typeof Online !== 'undefined' ? Online.escape(s) : String(s));

  function invite(tag) {
    const room = new URLSearchParams(location.search).get('join') || '';
    if (!room.startsWith(`pp-${tag}-`) || typeof Relay === 'undefined') return null;
    return Relay.takeInvite();
  }

  function create(o) {
    let net = null;

    const enabled = () => typeof Relay !== 'undefined' && Relay.enabled;

    function html(heading = '') {
      if (!enabled()) return '';
      return `${heading ? `<p class="za-label" style="margin-top:10px">${heading}</p>` : ''}
        <div class="menu">
          <button class="btn secondary" type="button" data-live="quick">Quick match online</button>
          <button class="btn secondary" type="button" data-live="create">Create private room</button>
          <div class="row">
            <input class="field" data-live-code maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code">
            <button class="btn secondary" type="button" data-live="join">Join</button>
          </div>
        </div>
        <div data-live-waiting></div>`;
    }

    function wire(panel) {
      if (!enabled() || !panel) return;
      const code = panel.querySelector('[data-live-code]');
      panel.querySelectorAll('[data-live]').forEach(b => b.addEventListener('click', () => connect(b.dataset.live, code?.value || '')));
      code?.addEventListener('keydown', e => { if (e.key === 'Enter') connect('join', code.value); });
      const w = panel.querySelector('[data-live-waiting]');
      if (w) Relay.showWaiting(w, room => {
        // The Lobby list shows every waiting player for this game, whatever the mode; a room from
        // another mode reloads the page as an invite link, which that mode picks up.
        if (room.startsWith(`pp-${o.tag}-`)) connect('public', room);
        else location.href = `${location.pathname}?join=${encodeURIComponent(room)}`;
      });
    }

    async function connect(how, code) {
      leave();
      let cancelled = false;
      const cancel = () => { cancelled = true; leave(); o.onCancel?.(); };
      o.ui.show({ title: 'Connecting…', html: Relay.CONNECTING, button: 'Cancel', onAction: cancel, onRender: Relay.ticker });
      const handlers = {
        ready: () => {
          if (cancelled || !net) return;
          net.conn.send('hello', { name: Arcade.profile().name });
          net.want = { me: false, them: false };
          // These games keep their HUD in the corners, where the quick-chat bar sits: start it
          // folded away (the 💬 button opens it).
          const qc = document.querySelector('.quick-chat');
          if (qc && !qc.classList.contains('closed')) { qc.classList.add('closed'); qc.querySelector('.qc-toggle')?.setAttribute('aria-expanded', 'false'); }
          o.onReady(net.host);
        },
        event: (name, data) => {
          if (!net) return;
          if (name === 'hello') { net.them = String(data?.name || 'Opponent').slice(0, 24); o.onEvent?.('hello', data); return; }
          if (name === 'rematch') {
            net.want.them = true;
            if (net.host && net.want.me) return startRematch();
            const w = document.querySelector('[data-live-wait]');
            if (w && !net.want.me) w.textContent = `${net.them} wants a rematch! Press Rematch to start.`;
            return;
          }
          if (name === 'quit') return gone(false);
          o.onEvent?.(name, data);
        },
        state: data => { if (net) o.onState?.(data); },
        left: () => gone(false),
        closed: () => { if (net) gone(true); },
      };
      try {
        const res = how === 'quick' ? await Relay.quickMatch(o.tag, handlers, o.label || 'Match')
          : how === 'create' ? await Relay.createRoom(o.tag, handlers)
          : how === 'public' ? await Relay.joinPublic(code, handlers)
          : await Relay.joinRoom(o.tag, code, handlers);
        if (cancelled) { res.conn.close(); return; }
        net = { conn: res.conn, host: res.slot === 1, code: res.code || '', them: 'Opponent', want: { me: false, them: false } };
        if (net.host) {
          o.ui.show({
            title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
            html: how === 'create'
              ? `<p>Share this code. ${esc(o.title || 'The match')} starts as soon as they join.</p><p class="code">${res.code}</p>`
              : "<p>You'll be matched with the next player who presses Quick match.</p>",
            button: 'Cancel',
            onAction: cancel,
          });
        } else {
          o.ui.show({ title: 'Opponent found', html: '<p>Starting…</p>', button: null });
        }
      } catch (e) {
        if (!cancelled) o.onCancel?.(e.message);
      }
    }

    function startRematch() {
      net.want = { me: false, them: false };
      o.onRematch?.();
    }

    function rematch() {
      if (!net || net.want.me) return;
      net.want.me = true;
      net.conn.send('rematch');
      const w = document.querySelector('[data-live-wait]');
      if (w) w.textContent = 'Waiting for your opponent…';
      if (net.host && net.want.them) startRematch();
    }

    function gone(lost) {
      if (!net) return;
      leave(false);
      o.onGone?.(lost);
    }

    function leave(tell = true) {
      if (!net) return;
      if (tell) net.conn.send('quit');
      net.conn.close();
      net = null;
    }
    window.addEventListener('pagehide', () => net?.conn.send('quit'));

    return {
      enabled, html, wire, connect, rematch, leave,
      send: (name, data) => net?.conn.send(name, data),
      state: data => net?.conn.state(data),
      get on() { return !!net; },
      get host() { return !!net?.host; },
      get them() { return net?.them || 'Opponent'; },
      get code() { return net?.code || ''; },
      // The "Rematch / Leave" footer for a result panel.
      waitNote: '<p class="muted-note" data-live-wait>A rematch starts when you both press it.</p>',
    };
  }

  return { create, invite };
})();
