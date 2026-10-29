/* Real-time 1v1 matches over the Stickman Battles Socket.io relay (server.js in that repo).
   The relay pairs two sockets per room name and forwards whatever they send each other, so
   one player (slot 1) runs the game and the other sends inputs. No SDK: Socket.io's wire
   format over a plain WebSocket is a few string prefixes:
     0{…} open → we reply 40 (connect) · 40{…} connected · 2 ping → 3 pong · 42[event, data] */
const Relay = (() => {
  const base = (window.ARCADE_CONFIG?.relayUrl || '').trim().replace(/\/+$/, '');
  const enabled = !!base && 'WebSocket' in window;
  const wsUrl = base.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const QUEUE_ROOMS = 30;

  // The relay runs on free hosting that sleeps when idle; any request wakes it (up to a minute).
  let awake = null;
  function wake() {
    awake ||= fetch(base + '/healthz', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    return awake;
  }

  // Opens a socket and joins `room` (at most 20 characters; the relay truncates longer names).
  // Handlers: joined(slot) where slot is 1 or 2, full(), ready() once both are in,
  // event(name, data), state(data), left() when the other player goes, closed() on network loss.
  function join(room, handlers) {
    const ws = new WebSocket(wsUrl);
    let live = true;
    const emit = (ev, data) => { if (ws.readyState === 1) ws.send('42' + JSON.stringify([ev, data])); };
    ws.onmessage = e => {
      const m = String(e.data);
      if (m === '2') { ws.send('3'); return; }
      if (m[0] === '0') { ws.send('40'); return; }
      if (m.startsWith('40')) { emit('joinRoom', room); return; }
      if (!m.startsWith('42')) return;
      let ev, data;
      try { [ev, data] = JSON.parse(m.slice(2)); } catch { return; }
      if (ev === 'joined') handlers.joined?.(data.slot);
      else if (ev === 'roomFull') handlers.full?.();
      else if (ev === 'bothConnected') handlers.ready?.();
      else if (ev === 'remoteGameEvent') handlers.event?.(data?.event, data?.data);
      else if (ev === 'remoteState') handlers.state?.(data);
      else if (ev === 'opponentDisconnected') handlers.left?.();
    };
    const lost = () => {
      if (!live) return;
      live = false;
      handlers.closed?.();
    };
    ws.onclose = lost;
    ws.onerror = lost;
    return {
      send: (event, data) => emit('gameEvent', { event, data }),
      state: data => emit('playerState', data),
      close() {
        live = false;
        try { ws.close(); } catch {}
      },
    };
  }

  // Shared plumbing for quickMatch / createRoom / joinRoom: resolves with { conn, slot } once
  // seated, and fires handlers.ready when the opponent arrives.
  function seat(room, handlers, accept) {
    return new Promise((resolve, reject) => {
      const conn = join(room, {
        ...handlers,
        joined: slot => {
          if (accept(slot)) resolve({ conn, slot });
          else { conn.close(); reject(new Error('reject')); }
        },
        full: () => { conn.close(); reject(new Error('full')); },
        closed: () => { reject(new Error('closed')); handlers.closed?.(); },
      });
    });
  }

  // Strangers: take the first public room for this game that isn't already full. While we wait
  // alone in it, the Lobby page lists us (when Firebase is on) so anyone can jump straight in.
  // `label` describes the match there, e.g. "Duel" or "Race · Harbor Loop".
  async function quickMatch(tag, handlers, label = '') {
    await wake();
    for (let n = 1; n <= QUEUE_ROOMS; n++) {
      const room = `pp-${tag}-q${n}`;
      try {
        const listing = listed(room, label, handlers);
        const res = await seat(room, listing.handlers, () => true);
        if (res.slot === 1) listing.start(res.conn);
        return res;
      } catch (e) {
        if (e.message !== 'full') throw new Error("Couldn't reach the game server.");
      }
    }
    throw new Error('Every public room is busy. Try again in a minute.');
  }

  // A waiting player's lobby entry: refreshed while they wait, removed once matched or gone.
  function listed(room, label, handlers) {
    let beat = null, live = false;
    const on = typeof Online !== 'undefined' && Online.enabled;
    const stop = () => {
      clearInterval(beat);
      if (live) Online.unlistWaiting().catch(() => {});
      live = false;
    };
    return {
      handlers: {
        ...handlers,
        ready: () => { stop(); handlers.ready?.(); },
        left: () => { stop(); handlers.left?.(); },
        closed: () => { stop(); handlers.closed?.(); },
      },
      start(conn) {
        if (!on) return;
        live = true;
        const post = () => Online.listWaiting(Arcade.gameId, room, label).catch(() => {});
        post();
        beat = setInterval(post, 20000);
        const close = conn.close;
        conn.close = () => { stop(); close(); };
        window.addEventListener('pagehide', () => { if (live) Online.unlistWaiting({ keepalive: true }).catch(() => {}); });
      },
    };
  }

  // Joins a specific public room someone is waiting in (from the Lobby).
  async function joinPublic(room, handlers) {
    if (!/^pp-[a-z0-9]+-q\d+$/.test(room)) throw new Error('That match link is broken.');
    await wake();
    try {
      return await seat(room, handlers, slot => slot === 2);
    } catch (e) {
      if (e.message === 'full') throw new Error('Someone else got there first.');
      if (e.message === 'reject') throw new Error('That player has already left.');
      throw new Error("Couldn't reach the game server.");
    }
  }

  // Friends: a fresh 4-letter code. Landing in slot 2 means the code was taken, so pick another.
  async function createRoom(tag, handlers) {
    await wake();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
      try {
        return { code, ...await seat(`pp-${tag}-${code.toLowerCase()}`, handlers, slot => slot === 1) };
      } catch (e) {
        if (e.message === 'closed') throw new Error("Couldn't reach the game server.");
      }
    }
    throw new Error("Couldn't create a room.");
  }

  // Landing in slot 1 means nobody made that room, so back out rather than wait in it.
  async function joinRoom(tag, code, handlers) {
    code = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) throw new Error('Room codes are 4 letters.');
    await wake();
    try {
      return await seat(`pp-${tag}-${code.toLowerCase()}`, handlers, slot => slot === 2);
    } catch (e) {
      if (e.message === 'full') throw new Error('That room is already full.');
      if (e.message === 'reject') throw new Error('No room with that code.');
      throw new Error("Couldn't reach the game server.");
    }
  }

  // The Lobby page links to games/<id>/index.html?join=<room>; the game takes the room once.
  function takeInvite() {
    const params = new URLSearchParams(location.search);
    const room = params.get('join');
    if (!room) return null;
    history.replaceState(null, '', location.pathname);
    return enabled ? room : null;
  }

  // Fills `el` with the players waiting for this game and keeps it fresh while it's on screen.
  function showWaiting(el, onJoin) {
    if (!el || typeof Online === 'undefined' || !Online.enabled || !enabled) return;
    const esc = Online.escape;
    const render = list => {
      if (!el.isConnected) return false;
      el.innerHTML = list.length
        ? `<p class="muted-note" style="margin:0 0 6px">Waiting for a match now</p><ul class="waiting-list">${list.slice(0, 4).map(w => `
            <li><span class="dot"></span><span class="who"><b>${esc(w.name)}</b><span>${esc(w.label || 'Quick match')}</span></span>
            <button class="btn" type="button" data-room="${esc(w.room)}">Join</button></li>`).join('')}</ul>`
        : '';
      el.querySelectorAll('[data-room]').forEach(b => b.addEventListener('click', () => onJoin(b.dataset.room)));
      return true;
    };
    const refresh = () => Online.waiting(Arcade.gameId).then(list => {
      if (render(list)) setTimeout(refresh, 5000);
    }).catch(() => {});
    refresh();
  }

  if (enabled) wake();

  return { enabled, join, quickMatch, createRoom, joinRoom, joinPublic, takeInvite, showWaiting };
})();
