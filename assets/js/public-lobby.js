/* Public lobbies: drop-in rooms of up to 8-10 real players per game, on the relay's arcade hub
   (arcadehub.js in the Stickman Battles repo). The server only knows who is in which lobby. One
   player's browser, the "authority", runs the shared world (bots, a boss) and streams it; every
   player streams their own state. If the authority leaves, the server picks the next player and
   tells everyone (onAuthority), and that browser takes over the world from the last snapshot.

     const lobby = await PublicLobby.join('tankfield', {
       onWelcome({ slot, lobby, roster, authority, age }),  seated (age: ms since the lobby opened)
       onJoined({ slot, name }), onLeft({ slot }), onAuthority(slot),
       onState(slot, s), onWorld(w), onEvent(from, type, data),
       onClosed() })                                         connection lost
     lobby.state(s)   lobby.world(w)   lobby.send(type, data, to)   (to: slot, 'auth' or omitted)
     lobby.leave()    lobby.slot   lobby.isAuthority   lobby.names   lobby.clock()  (ms since the lobby opened)
     PublicLobby.count(game) -> Promise<number | null>   players in that game's lobbies right now */
const PublicLobby = (() => {
  const enabled = typeof Relay !== 'undefined' && Relay.enabled;

  function open(onEvent) {
    const ws = new WebSocket(Relay.wsUrl);
    let up = false;
    const ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error(Relay.UNREACHABLE)); }, 20000);
      ws.onmessage = e => {
        const m = String(e.data);
        if (m === '2') return ws.send('3');
        if (m[0] === '0') return ws.send('40');
        if (m.startsWith('40')) { clearTimeout(t); up = true; return resolve(); }
        if (!m.startsWith('42')) return;
        let ev, data;
        try { [ev, data] = JSON.parse(m.slice(2)); } catch { return; }
        onEvent(ev, data);
      };
      ws.onerror = ws.onclose = () => { clearTimeout(t); if (!up) reject(new Error(Relay.UNREACHABLE)); else { up = false; onEvent('__closed'); } };
    });
    const emit = (ev, data) => { if (ws.readyState === 1) ws.send('42' + JSON.stringify([ev, data])); };
    return { ws, ready, emit, close() { up = false; try { ws.close(); } catch {} } };
  }

  async function join(game, h) {
    if (!enabled) throw new Error('Online play is off.');
    await Relay.wake();
    let me = -1, auth = -1, born = 0;
    const names = new Map();
    let conn;
    const welcomed = new Promise((resolve, reject) => {
      conn = open((ev, d) => {
        if (ev === '__closed') return h.onClosed?.();
        if (ev === 'arc:welcome') {
          me = d.slot; auth = d.authority; born = performance.now() - (d.age || 0);
          for (const p of d.roster || []) names.set(p.slot, p.name);
          h.onWelcome?.(d);
          return resolve();
        }
        if (ev === 'arc:fail') return reject(new Error(d?.reason || "Couldn't join a lobby."));
        if (me < 0) { if (ev === 'arc:authority') auth = d.slot; return; }
        if (ev === 'arc:joined') { names.set(d.slot, d.name); h.onJoined?.(d); }
        else if (ev === 'arc:left') { const name = names.get(d.slot); names.delete(d.slot); h.onLeft?.({ ...d, name }); }
        else if (ev === 'arc:authority') { auth = d.slot; h.onAuthority?.(d.slot); }
        else if (ev === 'arc:state') h.onState?.(d.slot, d.s);
        else if (ev === 'arc:world') h.onWorld?.(d);
        else if (ev === 'arc:ev') h.onEvent?.(d.from, d.type, d.data);
      });
      conn.ready.then(() => conn.emit('arc:join', { game, name: Arcade.profile().name, color: h.color })).catch(reject);
      // A server without public lobbies never answers the join.
      setTimeout(() => { if (me < 0) { conn.close(); reject(new Error("Public lobbies aren't available on the game server yet.")); } }, 15000);
    });
    await welcomed;
    addEventListener('pagehide', () => conn.emit('arc:leave'));
    return {
      get slot() { return me; },
      get isAuthority() { return me >= 0 && me === auth; },
      get authority() { return auth; },
      names,
      clock: () => performance.now() - born,
      state: s => conn.emit('arc:state', s),
      world: w => conn.emit('arc:world', w),
      send: (type, data, to) => conn.emit('arc:ev', { type, data, to }),
      leave() { conn.emit('arc:leave'); conn.close(); },
    };
  }

  async function count(game) {
    if (!enabled) return null;
    try {
      return await new Promise((resolve, reject) => {
        const c = open((ev, d) => { if (ev === 'arc:count' && d?.game === game) { c.close(); resolve(d.n | 0); } });
        c.ready.then(() => c.emit('arc:count', { game })).catch(reject);
        setTimeout(() => { c.close(); resolve(null); }, 8000);
      });
    } catch { return null; }
  }

  return { enabled, join, count };
})();
