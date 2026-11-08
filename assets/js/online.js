/* Online features over the Firebase Realtime Database REST API: plain fetch() for reads and
   writes, EventSource for live updates. No SDK, and the site itself stays fully static. */
const Online = (() => {
  const base = (window.ARCADE_CONFIG?.firebaseUrl || '').trim().replace(/\/+$/, '');
  const enabled = !!base;
  const TIMESTAMP = { '.sv': 'timestamp' };

  const url = (path, query = '') => `${base}/${path}.json${query}`;
  const q = params => '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  // Sends one request, signed with the player's account token when there is one.
  async function send(method, path, body, query = '', options = {}, token = null) {
    if (!enabled) throw new Error('Online is not configured');
    if (token) query += (query ? '&' : '?') + 'auth=' + encodeURIComponent(token);
    const res = await fetch(url(path, query), {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...options,
    });
    if (!res.ok) {
      const err = new Error(`${method} ${path} failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
  // Everything else waits for the account to be ready, so writes go out under the right id.
  const request = async (method, path, body, query, options) => send(method, path, body, query, options, await Auth.ready());
  const get = (path, query) => request('GET', path, undefined, query);
  const put = (path, body) => request('PUT', path, body);
  const patch = (path, body, options) => request('PATCH', path, body, '', options);
  const post = (path, body) => request('POST', path, body);
  const remove = (path, options) => request('DELETE', path, undefined, '', options);

  // ---------- Accounts (Firebase Authentication over REST) ----------
  //
  // Every player gets a guest account on their first visit, with nothing to fill in. The database
  // rules only let an account write its own entries, so nobody can post as someone else. Adding an
  // email and password ("saving" the account) keeps the same account, backs progress up to
  // profiles/<id>, and lets the player log back in from any browser.
  const Auth = (() => {
    const apiKey = (window.ARCADE_CONFIG?.firebaseApiKey || '').trim();
    const on = enabled && !!apiKey;
    const ID = 'https://identitytoolkit.googleapis.com/v1/accounts:';
    const KEY = 'auth', ACCOUNT = 'account', SYNC = 'sync';
    const PRIVATE = k => k === KEY || k === ACCOUNT || k === SYNC || k.startsWith('ghost:');
    let state = on ? Arcade.load(KEY, null) : null; // { uid, token, refresh, exp, email }
    let pending = null, started = false, chain = Promise.resolve();

    const MESSAGES = {
      EMAIL_EXISTS: 'That email already has an account. Log in instead.',
      INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.',
      INVALID_PASSWORD: 'Wrong email or password.',
      EMAIL_NOT_FOUND: 'Wrong email or password.',
      INVALID_EMAIL: 'That doesn\'t look like an email address.',
      MISSING_PASSWORD: 'Type a password.',
      WEAK_PASSWORD: 'Use a password with at least 6 characters.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a few minutes and try again.',
      USER_DISABLED: 'This account has been switched off.',
      OPERATION_NOT_ALLOWED: 'Accounts aren\'t switched on for this arcade yet.',
    };
    const message = e => MESSAGES[e?.code] || 'Couldn\'t reach the server. Check your connection.';

    async function call(endpoint, body, form = false) {
      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
          body: form ? new URLSearchParams(body) : JSON.stringify(body),
        });
      } catch {
        throw Object.assign(new Error('offline'), { code: 'NETWORK' });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = String(data.error?.message || 'NETWORK').split(/[ :]/)[0];
        throw Object.assign(new Error(code), { code });
      }
      return data;
    }

    // Sign-in and refresh replies name the same things differently.
    function keep(d, email = state?.email || '') {
      state = {
        uid: d.localId || d.user_id,
        token: d.idToken || d.id_token,
        refresh: d.refreshToken || d.refresh_token,
        exp: Date.now() + (Number(d.expiresIn || d.expires_in || 3600) - 120) * 1000,
        email: d.email || email,
      };
      Arcade.save(KEY, state);
    }

    // Tabs opened together mustn't each make their own guest account.
    const locked = fn => (navigator.locks ? navigator.locks.request('ppa-auth', fn) : fn());

    async function signIn() {
      await locked(async () => {
        state = Arcade.load(KEY, null);
        if (state?.token && Date.now() < state.exp) return;
        if (state?.refresh) {
          try {
            keep(await call(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, { grant_type: 'refresh_token', refresh_token: state.refresh }, true));
            return;
          } catch (e) {
            if (e.code === 'NETWORK') throw e;
            // The account is gone (or switched off): carry on as a new guest.
          }
        }
        keep(await call(ID + 'signUp?key=' + apiKey, { returnSecureToken: true }));
      });
      // From here on this browser plays as the account. The old id stays on as the friend code.
      const p = Arcade.profile();
      if (p.id !== state.uid) Arcade.save('profile', { ...p, id: state.uid });
      return state.token;
    }

    // A valid token, or null when accounts are off or the server can't be reached.
    function token() {
      if (!on) return Promise.resolve(null);
      if (state?.token && Date.now() < state.exp) return Promise.resolve(state.token);
      return (pending ||= signIn().catch(() => null).finally(() => { pending = null; }));
    }
    const raw = async (method, path, body, query) => send(method, path, body, query, {}, await token());
    const enqueue = fn => (chain = chain.then(fn).catch(() => {}));

    async function ready() {
      if (!on) return null;
      if (!(await token())) return null;
      if (!started) {
        started = true;
        enqueue(setup);
      }
      await chain;
      return token();
    }

    // ---------- One-time setup per account ----------

    const account = () => {
      const a = Arcade.load(ACCOUNT, {});
      return a.uid === state?.uid ? a : { uid: state?.uid };
    };
    const note = changes => Arcade.save(ACCOUNT, { ...account(), ...changes });
    // Anything stored at all: worth looking for old leaderboard entries to bring over.
    const hasData = () => Object.keys(localStorage).some(k => k.startsWith('ppa:') && !['profile', KEY, ACCOUNT, SYNC].includes(k.slice(4)));
    // Progress a player would miss if logging in replaced it.
    const hasProgress = () => Arcade.stats().totalPlays > 0 || Arcade.tickets() > 0;

    async function setup() {
      if (state.email && (await pullNewer())) return;
      await publishName();
      await claimCode();
      window.dispatchEvent(new Event('arcade:account'));
    }

    // Names are unique (names/<name> points at its owner), so nobody can take on someone else's.
    async function publishName() {
      const p = Arcade.profile();
      const before = account().name;
      if (before === p.name) return;
      let name = p.name;
      for (let tries = 0; tries < 6; tries++) {
        const update = { [`names/${name}`]: p.id, [`profiles/${p.id}/name`]: name };
        if (before && before !== name) update[`names/${before}`] = null;
        try {
          await raw('PATCH', '', update);
          break;
        } catch (e) {
          if (e.status !== 401 && e.status !== 403) throw e;
          const owner = await raw('GET', `names/${name}`);
          if (!owner || owner === p.id || tries === 5) throw e;
          name = Arcade.randomName();
        }
      }
      note({ name });
      if (name !== p.name) {
        Arcade.save('profile', { ...Arcade.profile(), name });
        Arcade.toast('New player name', `Someone else is ${p.name}, so you're now ${name}.`);
      }
    }

    // codes/<friend code> points at the account. Claiming your old id also brings over the
    // leaderboard entries and Kingdom you had under it.
    async function claimCode() {
      if (account().code) return;
      const p = Arcade.profile();
      let code = p.code;
      const owner = await raw('GET', `codes/${code}`);
      if (owner && owner !== p.id) {
        do code = Arcade.randomId(); while (await raw('GET', `codes/${code}`));
      }
      if (owner !== p.id) await raw('PUT', `codes/${code}`, p.id);
      if (code !== p.code) Arcade.save('profile', { ...Arcade.profile(), code });
      else if (!owner && hasData()) await moveFrom(code, p.id, Arcade.profile().name);
      note({ code: true });
    }

    async function moveFrom(old, uid, name) {
      const boards = Object.keys(await raw('GET', 'scores', undefined, '?shallow=true') || {});
      await Promise.all(boards.map(async board => {
        const e = await raw('GET', `scores/${board}/${old}`).catch(() => null);
        if (!e || typeof e.score !== 'number') return;
        await raw('PUT', `scores/${board}/${uid}`, { name, score: e.score, t: e.t }).catch(() => {});
        await raw('DELETE', `scores/${board}/${old}`).catch(() => {});
      }));
      const k = await raw('GET', `kingdoms/${old}`).catch(() => null);
      if (k) {
        await raw('PUT', `kingdoms/${uid}`, { ...k, name, t: TIMESTAMP }).catch(() => {});
        await raw('DELETE', `kingdoms/${old}`).catch(() => {});
      }
    }

    // ---------- Backing up progress (saved accounts only) ----------

    function snapshot() {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('ppa:') && !PRIVATE(k.slice(4))) out[k.slice(4)] = localStorage.getItem(k);
      }
      return JSON.stringify(out);
    }

    // Replaces this browser's progress with the account's, keeping the higher of each best score.
    function apply(json, t) {
      const remote = JSON.parse(json || '{}');
      for (const k of Object.keys(localStorage)) {
        if (!k.startsWith('ppa:') || PRIVATE(k.slice(4))) continue;
        const key = k.slice(4);
        if (key.startsWith('best:') && remote[key] !== undefined) remote[key] = String(Math.max(+remote[key] || 0, +localStorage.getItem(k) || 0));
        else if (key.startsWith('best:')) continue;
        localStorage.removeItem(k);
      }
      for (const [k, v] of Object.entries(remote)) localStorage.setItem('ppa:' + k, v);
      localStorage.setItem('ppa:' + SYNC, JSON.stringify(t));
    }

    async function upload() {
      if (!state?.email) return;
      const t = Date.now();
      await raw('PATCH', `profiles/${state.uid}`, { save: snapshot(), saveT: t });
      Arcade.save(SYNC, t);
    }

    // Played on another device since? Take that progress, then reload so the page shows it.
    async function pullNewer() {
      const t = await raw('GET', `profiles/${state.uid}/saveT`);
      if (!t || t <= Arcade.load(SYNC, 0)) return false;
      apply(await raw('GET', `profiles/${state.uid}/save`), t);
      try { sessionStorage.setItem('ppa:synced', '1'); } catch {}
      location.reload();
      return true;
    }

    let uploadTimer = null;
    if (on) {
      Arcade.onSave(key => {
        if (key === 'profile' && started) enqueue(publishName);
        if (!state?.email || PRIVATE(key)) return;
        clearTimeout(uploadTimer);
        uploadTimer = setTimeout(() => enqueue(upload), 8000);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && uploadTimer) {
          clearTimeout(uploadTimer);
          uploadTimer = null;
          enqueue(upload);
        }
      });
      try {
        if (sessionStorage.getItem('ppa:synced')) {
          sessionStorage.removeItem('ppa:synced');
          setTimeout(() => Arcade.toast('Progress synced', 'Picked up where you left off on your other device.'), 500);
        }
      } catch {}
    }

    // ---------- What the Profile page offers ----------

    // Guest -> saved account: same id, same progress, now with an email and password.
    async function register(email, password) {
      try {
        if (!(await token())) throw Object.assign(new Error('offline'), { code: 'NETWORK' });
        keep(await call(ID + 'update?key=' + apiKey, { idToken: state.token, email, password, returnSecureToken: true }), email);
        await enqueue(upload);
        return '';
      } catch (e) {
        return message(e);
      }
    }

    // Swaps this browser over to an existing account and its saved progress.
    async function logIn(email, password) {
      try {
        const d = await call(ID + 'signInWithPassword?key=' + apiKey, { email, password, returnSecureToken: true });
        const [save, t] = await Promise.all([
          send('GET', `profiles/${d.localId}/save`, undefined, '', {}, d.idToken),
          send('GET', `profiles/${d.localId}/saveT`, undefined, '', {}, d.idToken),
        ]);
        clearTimeout(uploadTimer);
        apply(save, t || 0);
        if (!save) Arcade.save('profile', { ...Arcade.profile(), id: d.localId });
        keep(d, email);
        location.reload();
        return '';
      } catch (e) {
        return message(e);
      }
    }

    async function resetPassword(email) {
      try {
        await call(ID + 'sendOobCode?key=' + apiKey, { requestType: 'PASSWORD_RESET', email });
        return '';
      } catch (e) {
        return message(e);
      }
    }

    // Backs everything up, then clears this browser back to a brand-new guest.
    async function logOut() {
      clearTimeout(uploadTimer);
      await enqueue(upload);
      for (const k of Object.keys(localStorage)) if (k.startsWith('ppa:')) localStorage.removeItem(k);
      location.reload();
    }

    return {
      on, ready, register, logIn, logOut, resetPassword, hasProgress,
      email: () => state?.email || '',
    };
  })();

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
    if (i >= 0) nudge();
    return { list, rank: i >= 0 ? i + 1 : null };
  }

  // On a leaderboard but still a guest? Every few days, suggest saving the account.
  function nudge() {
    if (!Auth.on || Auth.email() || Date.now() - Arcade.load('nudged', 0) < 3 * 86400000) return;
    Arcade.save('nudged', Date.now());
    Arcade.toast('Save your account', 'Add your email on the Profile page so this score is never lost.');
  }

  function renderBoard(list, rank) {
    const me = Arcade.profile().id;
    if (!list.length) return '<p class="board-note">No scores yet. Be the first!</p>';
    const rows = list.map((r, i) => `
      <li class="${r.id === me ? 'me' : ''}">
        <span class="rank">${i + 1}</span><span class="name">${escape(typeof Friends === 'undefined' ? r.name : Friends.display(r.id, r.name))}</span><b>${Number(r.score).toLocaleString()}</b>
      </li>`).join('');
    const note = rank ? `<p class="board-note">You're #${rank} worldwide</p>` : '';
    return `<p class="board-title">Global leaderboard</p><ol class="board-list">${rows}</ol>${note}`;
  }

  // ---------- Presence ----------

  function heartbeat(where) {
    if (!enabled) return;
    const beat = () => Auth.ready().then(() => put(`presence/${Arcade.profile().id}`, { at: where, name: Arcade.profile().name, t: TIMESTAMP })).catch(() => {});
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

  // Keeps a local copy of `path` (optionally narrowed by a query) in sync and calls onChange(data) on every update.
  function subscribe(path, onChange, query = '') {
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
    const source = new EventSource(url(path, query));
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

  // ---------- Lobby (players waiting in public matchmaking) ----------

  // relay.js lists a player here while they wait in a public queue room, so others can join
  // them straight from the Lobby page. Private rooms are never listed.
  const listWaiting = (game, room, label) =>
    put(`lobby/${Arcade.profile().id}`, { game, room, label, name: Arcade.profile().name, t: TIMESTAMP });
  const unlistWaiting = options => remove(`lobby/${Arcade.profile().id}`, options);

  // Entries refresh every 20 seconds, so anything older than 45 seconds has gone stale.
  async function waiting(game = null) {
    const data = await get('lobby', q({ orderBy: '"t"', startAt: Date.now() - 45000 }));
    const me = Arcade.profile().id;
    return Object.entries(data || {})
      .filter(([id, v]) => id !== me && (!game || v.game === game))
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.t - b.t);
  }

  // ---------- Ghosts (racing) ----------

  const getGhost = track => get(`ghosts/${track}`);
  const saveGhost = (track, time, frames) =>
    put(`ghosts/${track}`, { name: Arcade.profile().name, time, frames, t: TIMESTAMP });

  async function updateFriendCodes() {
    if (typeof Friends === 'undefined' || Date.now() - Arcade.load('friends:checked', 0) < 3600000) return;
    Arcade.save('friends:checked', Date.now());
    const old = new Set([...Friends.all(), ...Friends.recent()].map(f => f.id).filter(id => id.length <= 12));
    for (const id of old) {
      const uid = await get(`codes/${id}`).catch(() => null);
      if (typeof uid === 'string') Friends.rekey(id, uid);
    }
  }

  if (enabled) heartbeat(Arcade.gameId || 'hub');
  if (Auth.on) Auth.ready().then(updateFriendCodes);

  return {
    enabled, Auth, TIMESTAMP, get, put, patch, post, remove, escape, top, reportScore, renderBoard,
    whoIsOnline, subscribe, listWaiting, unlistWaiting, waiting, getGhost, saveGhost,
  };
})();
