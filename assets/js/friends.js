/* Friends and nicknames, kept in this browser. Players are tracked by their id, so a friend stays a
   friend after picking a new name. A nickname is a private label: only you see it, and it shows in
   place of their generated name in chat, the lobby, leaderboards and online matches.
     Friends.add(id, name) / remove(id) / get(id) / all()
     Friends.setNick(id, nick)     returns an error message, or '' when saved
     Friends.short(id, name)       the nickname if there is one, else the name (for match screens)
     Friends.display(id, name)     "★ Nick (RealName12)" for friends, else the name
     Friends.met(id, name)         records an online opponent under "Recent players"
     Friends.result(id, name, 'w' | 'l' | 'd')  adds an online result to your head-to-head record
     Friends.record(id) / records()             { name, w, l, d, games: { <game>: { w, l, d } }, t } */
const Friends = (() => {
  const KEY = 'friends', RECENT_KEY = 'friends:recent';
  const NICK_MAX = 20, RECENT_MAX = 12;
  const ID_RE = /^[A-Za-z0-9]{6,32}$/; // account ids, or older 9-letter codes

  let list = Arcade.load(KEY, {});
  const save = () => Arcade.save(KEY, list);

  const get = id => (id && list[id]) || null;
  const all = () => Object.entries(list).map(([id, f]) => ({ id, ...f })).sort((a, b) => (a.nick || a.name || '').localeCompare(b.nick || b.name || ''));

  function add(id, name = '') {
    if (!ID_RE.test(id || '') || id === Arcade.profile().id) return false;
    list[id] = { name: name || list[id]?.name || '', nick: list[id]?.nick || '', added: list[id]?.added || Date.now() };
    save();
    Arcade.toast('Friend added', name || 'New friend');
    return true;
  }

  function remove(id) {
    delete list[id];
    save();
  }

  // Keeps a friend's name current when they show up somewhere under a new one.
  function touch(id, name) {
    if (!list[id] || !name || list[id].name === name) return;
    list[id].name = name;
    save();
  }

  function setNick(id, nick) {
    const raw = String(nick || '').trim();
    if (!raw) {
      if (list[id]) { list[id].nick = ''; save(); }
      return '';
    }
    const res = Filter.check(raw, NICK_MAX);
    if (res.error) return res.error;
    if (!list[id]) add(id);
    if (!list[id]) return 'Couldn\'t save that nickname.';
    list[id].nick = res.text;
    save();
    return '';
  }

  // A simple prompt for a nickname; adds them as a friend too. Returns an error message or ''.
  function askNick(id, name) {
    const now = get(id)?.nick || '';
    const nick = prompt(`Nickname for ${name} (only you see it, up to ${NICK_MAX} letters). Leave empty to clear.`, now);
    if (nick === null) return '';
    if (!get(id)) add(id, name);
    return setNick(id, nick);
  }

  const short = (id, name) => get(id)?.nick || name;
  function display(id, name) {
    const f = get(id);
    if (!f) return name;
    return f.nick ? `★ ${f.nick} (${name})` : `★ ${name}`;
  }

  // ---------- Recent players ----------

  const recent = () => Arcade.load(RECENT_KEY, []);
  function met(id, name, game = Arcade.gameId) {
    if (!ID_RE.test(id || '') || id === Arcade.profile().id) return;
    touch(id, name);
    const rest = recent().filter(r => r.id !== id);
    Arcade.save(RECENT_KEY, [{ id, name, game, t: Date.now() }, ...rest].slice(0, RECENT_MAX));
  }

  // Swaps an older friend code for the account id it now belongs to.
  function rekey(from, to) {
    if (!ID_RE.test(to) || from === to) return;
    if (list[from]) {
      if (!list[to]) list[to] = list[from];
      delete list[from];
      save();
    }
    if (recent().some(r => r.id === from)) Arcade.save(RECENT_KEY, recent().map(r => (r.id === from ? { ...r, id: to } : r)));
    const all = rivals();
    if (all[from]) {
      if (!all[to]) all[to] = all[from];
      delete all[from];
      Arcade.save(RIVAL_KEY, all);
    }
  }

  // ---------- Head-to-head records ----------

  // Every online match and duel adds to your record against that player. Like friends, it's kept
  // in this browser (and backed up with a saved account), so each player keeps their own count.
  const RIVAL_KEY = 'rivals';
  const rivals = () => Arcade.load(RIVAL_KEY, {});
  const record = id => rivals()[id] || null;
  const records = () => Object.entries(rivals()).map(([id, r]) => ({ id, ...r })).sort((a, b) => b.t - a.t);
  function result(id, name, outcome, game = Arcade.gameId) {
    if (!ID_RE.test(id || '') || id === Arcade.profile().id || !['w', 'l', 'd'].includes(outcome)) return null;
    const all = rivals();
    const r = all[id] || { name: '', w: 0, l: 0, d: 0, games: {} };
    const g = r.games[game] || { w: 0, l: 0, d: 0 };
    r.name = name || r.name;
    r[outcome]++;
    g[outcome]++;
    r.games[game] = g;
    r.t = Date.now();
    all[id] = r;
    Arcade.save(RIVAL_KEY, all);
    return r;
  }
  // "3–2", from your side.
  const tally = r => `${r.w}–${r.l}${r.d ? ` (${r.d} drawn)` : ''}`;

  return { get, all, add, remove, touch, rekey, setNick, askNick, short, display, recent, met, result, record, records, tally, NICK_MAX, ID_RE };
})();
