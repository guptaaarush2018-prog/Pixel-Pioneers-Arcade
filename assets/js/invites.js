/* Friend challenges over Firebase (invites/<to>/<from>). The challenger picks a game, makes up a room
   and heads straight into it; the friend sees a pop-up and joins the same room from the link. Only
   invites from people on your friends list are shown, and each one lasts two minutes. */
const Invites = (() => {
  if (typeof Online === 'undefined' || !Online.enabled) return null;

  const FRESH = 120000, POLL = 15000;
  const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
  const root = location.pathname.includes('/games/') ? '../../' : '';
  const esc = Online.escape;

  // Every game you can play live: real-time matches, and online score duels (versus.js tags).
  const games = () => CATALOG.filter(g => !g.url && (g.relay || g.online === 'duel'));
  const tagOf = g => g.relay || 'v' + g.id.replace(/-/g, '').slice(0, 10);
  const go = (game, room) => { location.href = `${root}games/${game}/index.html?join=${room}`; };

  async function send(friendId, gameId) {
    const g = CATALOG.find(x => x.id === gameId);
    if (!g) return;
    const code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
    const room = `pp-${tagOf(g)}-${code}`;
    const me = Arcade.profile();
    await Online.put(`invites/${friendId}/${me.id}`, { name: me.name, game: g.id, room, t: Online.TIMESTAMP });
    go(g.id, room);
  }

  // A little dialog for picking which game to challenge a friend to.
  function pick(friendId) {
    const f = Friends.get(friendId);
    document.querySelector('.invite-dialog')?.remove();
    const last = Arcade.load('invites:last', 'chess');
    const el = document.createElement('div');
    el.className = 'invite-dialog';
    el.innerHTML = `<div class="panel">
        <h2>Challenge ${esc(f?.nick || f?.name || 'your friend')}</h2>
        <p>Pick a game. You'll wait in a room until they join (the invite lasts two minutes).</p>
        <select class="select">${games().map(g => `<option value="${g.id}"${g.id === last ? ' selected' : ''}>${esc(g.title)}</option>`).join('')}</select>
        <p class="error"></p>
        <div class="row"><button class="btn secondary" type="button" data-cancel>Cancel</button><button class="btn" type="button" data-send>Send challenge</button></div>
      </div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.querySelector('[data-cancel]').addEventListener('click', close);
    el.querySelector('[data-send]').addEventListener('click', async e => {
      const game = el.querySelector('select').value;
      Arcade.save('invites:last', game);
      e.target.disabled = true;
      try {
        await send(friendId, game);
      } catch {
        el.querySelector('.error').textContent = 'Couldn\'t send the challenge. Check your connection.';
        e.target.disabled = false;
      }
    });
  }

  // ---------- Receiving ----------

  const shown = new Set();
  let box = null;

  function card(from, inv) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'invite-cards';
      document.body.appendChild(box);
    }
    const title = CATALOG.find(g => g.id === inv.game)?.title || 'a game';
    const el = document.createElement('div');
    el.className = 'invite-card';
    el.innerHTML = `<p><b>${esc(Friends.short(from, inv.name))}</b> challenged you to <b>${esc(title)}</b></p>
      <div class="row"><button class="btn secondary" type="button" data-no>No thanks</button><button class="btn" type="button" data-yes>Join</button></div>`;
    const done = () => {
      el.remove();
      Online.remove(`invites/${Arcade.profile().id}/${from}`).catch(() => {});
    };
    el.querySelector('[data-no]').addEventListener('click', done);
    el.querySelector('[data-yes]').addEventListener('click', () => {
      done();
      go(inv.game, inv.room);
    });
    setTimeout(() => el.remove(), Math.max(1000, FRESH - (Date.now() - inv.t)));
    box.appendChild(el);
    Arcade.tone({ freq: 660, to: 1320, dur: 0.25, type: 'triangle', vol: 0.05 });
  }

  async function poll() {
    if (document.hidden) return;
    const me = Arcade.profile().id;
    try {
      const all = await Online.get(`invites/${me}`) || {};
      for (const [from, inv] of Object.entries(all)) {
        const stale = !inv || typeof inv.t !== 'number' || Date.now() - inv.t > FRESH;
        if (stale || !Friends.get(from)) {
          Online.remove(`invites/${me}/${from}`).catch(() => {});
          continue;
        }
        const key = `${from}:${inv.t}`;
        if (shown.has(key) || !CATALOG.some(g => g.id === inv.game)) continue;
        shown.add(key);
        card(from, inv);
      }
    } catch { /* offline */ }
  }
  poll();
  setInterval(poll, POLL);

  return { pick, send };
})();
