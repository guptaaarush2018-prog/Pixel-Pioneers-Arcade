/* Online features over the Firebase Realtime Database REST API: plain fetch() for reads and
   writes, EventSource for live updates. No SDK, and the site itself stays fully static. */
const Online = (() => {
  const base = (window.ARCADE_CONFIG?.firebaseUrl || '').trim().replace(/\/+$/, '');
  const enabled = !!base;
  const TIMESTAMP = { '.sv': 'timestamp' };

  const url = (path, query = '') => `${base}/${path}.json${query}`;
  const q = params => '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  async function request(method, path, body, query, options = {}) {
    if (!enabled) throw new Error('Online is not configured');
    const res = await fetch(url(path, query), {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...options,
    });
    if (!res.ok) throw new Error(`${method} ${path} failed (${res.status})`);
    return res.json();
  }
  const get = (path, query) => request('GET', path, undefined, query);
  const put = (path, body) => request('PUT', path, body);
  const patch = (path, body, options) => request('PATCH', path, body, '', options);
  const post = (path, body) => request('POST', path, body);

  const escape = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

  // ---------- Leaderboards ----------

  async function top(game, n = 10) {
    const data = await get(`scores/${game}`, q({ orderBy: '"score"', limitToLast: n }));
    return Object.entries(data || {})
      .map(([id, v]) => ({ id, name: v.name, score: v.score }))
      .sort((a, b) => b.score - a.score);
  }

  // Posts the score if it's the player's best, then returns the top 100 and the player's rank in it.
  async function reportScore(game, score) {
    const me = Arcade.profile();
    if (score >= Arcade.getBest(game)) {
      // The database rules reject anything that isn't an improvement, so a failure here is fine.
      await put(`scores/${game}/${me.id}`, { name: me.name, score, t: TIMESTAMP }).catch(() => {});
    }
    const list = await top(game, 100);
    const i = list.findIndex(r => r.id === me.id);
    return { list, rank: i >= 0 ? i + 1 : null };
  }

  function renderBoard(list, rank) {
    const me = Arcade.profile().id;
    if (!list.length) return '<p class="board-note">No scores yet. Be the first!</p>';
    const rows = list.map((r, i) => `
      <li class="${r.id === me ? 'me' : ''}">
        <span class="rank">${i + 1}</span><span class="name">${escape(r.name)}</span><b>${Number(r.score).toLocaleString()}</b>
      </li>`).join('');
    const note = rank ? `<p class="board-note">You're #${rank} worldwide</p>` : '';
    return `<p class="board-title">Global leaderboard</p><ol class="board-list">${rows}</ol>${note}`;
  }

  // ---------- Presence ----------

  function heartbeat(where) {
    if (!enabled) return;
    const beat = () => put(`presence/${Arcade.profile().id}`, { at: where, t: TIMESTAMP }).catch(() => {});
    beat();
    setInterval(() => { if (!document.hidden) beat(); }, 30000);
  }

  // Players seen in the last 90 seconds, grouped by where they are.
  async function whoIsOnline() {
    const data = await get('presence', q({ orderBy: '"t"', startAt: Date.now() - 90000 }));
    const byGame = {};
    for (const v of Object.values(data || {})) byGame[v.at] = (byGame[v.at] || 0) + 1;
    return { total: Object.keys(data || {}).length, byGame };
  }

  // ---------- Live data ----------

  // Keeps a local copy of `path` in sync and calls onChange(data) on every update.
  function subscribe(path, onChange) {
    let root = null;
    const set = (p, value) => {
      const parts = p.split('/').filter(Boolean);
      if (!parts.length) { root = value; return; }
      if (root === null || typeof root !== 'object') root = {};
      let node = root;
      for (const part of parts.slice(0, -1)) {
        if (node[part] === null || typeof node[part] !== 'object') node[part] = {};
        node = node[part];
      }
      const last = parts[parts.length - 1];
      if (value === null) delete node[last];
      else node[last] = value;
    };
    const source = new EventSource(url(path));
    source.addEventListener('put', e => {
      const { path: p, data } = JSON.parse(e.data);
      set(p, data);
      onChange(root);
    });
    source.addEventListener('patch', e => {
      const { path: p, data } = JSON.parse(e.data);
      for (const [k, v] of Object.entries(data)) set(`${p.replace(/\/$/, '')}/${k}`, v);
      onChange(root);
    });
    return () => source.close();
  }

  // ---------- Rooms (live matches) ----------

  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  async function createRoom(game, data = {}) {
    const me = Arcade.profile();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 4 }, () => Arcade.pick([...CODE_LETTERS])).join('');
      if (await get(`rooms/${code}`)) continue;
      await put(`rooms/${code}`, {
        game, status: 'waiting', round: 0, created: TIMESTAMP,
        players: { 0: { id: me.id, name: me.name } },
        ...data,
      });
      return code;
    }
    throw new Error('Could not create a room');
  }

  // Returns the room on success; throws with a readable message otherwise.
  async function joinRoom(game, code) {
    code = code.trim().toUpperCase();
    const room = await get(`rooms/${code}`);
    if (!room || room.game !== game) throw new Error('No room with that code.');
    const me = Arcade.profile();
    if (room.players?.[1] && room.players[1].id !== me.id) throw new Error('That room is already full.');
    await patch(`rooms/${code}`, { status: 'playing', 'players/1': { id: me.id, name: me.name } });
    return code;
  }

  // ---------- Ghosts (racing) ----------

  const getGhost = track => get(`ghosts/${track}`);
  const saveGhost = (track, time, frames) =>
    put(`ghosts/${track}`, { name: Arcade.profile().name, time, frames, t: TIMESTAMP });

  if (enabled) heartbeat(Arcade.gameId || 'hub');

  return {
    enabled, get, put, patch, post, escape, top, reportScore, renderBoard,
    whoIsOnline, subscribe, createRoom, joinRoom, getGhost, saveGhost,
  };
})();
