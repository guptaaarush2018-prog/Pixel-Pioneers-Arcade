/* Arcade-wide chat over Firebase (chat/<id>), with filter.js and friends.js. It only streams while the panel is open, since the free
   database plan allows 100 open connections; while closed it checks for new messages now and then.
   Every message is filtered twice: before sending, and again when shown, so a message posted straight
   to the database still can't show anything the filter catches. */
const Chat = (() => {
  if (typeof Online === 'undefined' || !Online.enabled) return null;

  const MAX_LEN = 140, SHOWN = 60, COOLDOWN = 4000, DAY = 86400000;
  const MUTED_KEY = 'chat:muted', SEEN_KEY = 'chat:seen';

  // ---------- Panel ----------

  const NAME_RE = /^[A-Z][a-z]+[A-Z][a-z]+[0-9]{2}$/;
  const here = Arcade.gameId || document.querySelector('[data-page]')?.dataset.page || 'hub';
  const titleOf = id => (window.CATALOG || []).find(g => g.id === id)?.title || { hub: 'Arcade', lobby: 'Lobby', leaderboards: 'Leaderboards', profile: 'Profile' }[id] || '';
  const esc = Online.escape;

  let muted = new Set(Arcade.load(MUTED_KEY, []));
  let messages = {}, stop = null, lastSent = 0, lastText = '';

  const root = document.createElement('div');
  root.className = 'chat-root';
  root.innerHTML = `
    <button class="chat-toggle" type="button" aria-expanded="false">Chat<span class="chat-badge" hidden></span></button>
    <section class="chat-panel" hidden aria-label="Arcade chat">
      <header><b>Arcade chat</b><button class="chat-close" type="button" aria-label="Close chat">×</button></header>
      <ul class="chat-log"><li class="chat-note">Connecting…</li></ul>
      <div class="chat-menu" hidden></div>
      <form class="chat-form">
        <input class="field" maxlength="${MAX_LEN}" placeholder="Say something nice" autocomplete="off" aria-label="Message">
        <button class="btn" type="submit">Send</button>
      </form>
      <p class="chat-error" role="status"></p>
      <p class="chat-rules">Be kind. Swears are filtered, and links or personal info are blocked. Click a name to add a friend, set a nickname, or hide them.</p>
    </section>`;
  document.body.appendChild(root);

  const toggle = root.querySelector('.chat-toggle'), panel = root.querySelector('.chat-panel');
  const log = root.querySelector('.chat-log'), form = root.querySelector('.chat-form');
  const input = form.querySelector('input'), errorEl = root.querySelector('.chat-error');
  const badge = root.querySelector('.chat-badge'), menu = root.querySelector('.chat-menu');

  // Typing in chat mustn't steer the game underneath.
  for (const type of ['keydown', 'keyup', 'keypress']) input.addEventListener(type, e => e.stopPropagation());

  function render() {
    const me = Arcade.profile().id;
    const list = Object.entries(messages || {})
      .map(([key, m]) => ({ key, ...m }))
      .filter(m => m && typeof m.t === 'number' && NAME_RE.test(m.name || '') && !muted.has(m.name))
      .sort((a, b) => a.t - b.t)
      .slice(-SHOWN);
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = list.length ? list.map(m => {
      const text = Filter.display(m.text, MAX_LEN);
      const where = titleOf(m.at);
      const friend = Friends.get(m.id);
      if (friend) Friends.touch(m.id, m.name);
      const sub = [friend?.nick ? m.name : '', where].filter(Boolean).join(' · ');
      return `<li class="${m.id === me ? 'me' : ''}${friend ? ' friend' : ''}">
        <button class="chat-name" type="button" data-id="${esc(m.id || '')}" data-name="${esc(m.name)}" title="Friend, nickname or hide">${friend ? '★ ' : ''}${esc(friend?.nick || m.name)}</button>
        ${sub ? `<span class="chat-where">${esc(sub)}</span>` : ''}
        <p>${text === null ? '<i>message hidden</i>' : esc(text)}</p></li>`;
    }).join('') : '<li class="chat-note">No messages yet. Say hi!</li>';
    if (atBottom || list.at(-1)?.id === me) log.scrollTop = log.scrollHeight;
    if (list.length) Arcade.save(SEEN_KEY, list.at(-1).t);
    log.querySelectorAll('[data-name]').forEach(b => b.addEventListener('click', () => showMenu(b.dataset.id, b.dataset.name)));
  }

  // Clicking a name: add them as a friend, give them a nickname only you see, or hide them.
  function showMenu(id, name) {
    if (!id || id === Arcade.profile().id) return hideMenu();
    const friend = Friends.get(id);
    menu.hidden = false;
    menu.innerHTML = `<b>${esc(friend?.nick || name)}</b>
      ${friend && typeof Invites !== 'undefined' && Invites ? '<button class="btn" type="button" data-act="challenge">Challenge</button>' : ''}
      <button class="btn secondary" type="button" data-act="friend">${friend ? 'Unfriend' : 'Add friend'}</button>
      <button class="btn secondary" type="button" data-act="nick">Nickname</button>
      <button class="btn secondary" type="button" data-act="hide">Hide</button>
      <button class="chat-close" type="button" data-act="close" aria-label="Close">×</button>`;
    menu.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'challenge') Invites.pick(id);
      else if (act === 'friend') {
        if (friend) Friends.remove(id);
        else Friends.add(id, name);
      } else if (act === 'nick') {
        const err = Friends.askNick(id, name);
        if (err) errorEl.textContent = err;
      } else if (act === 'hide') {
        if (!confirm(`Hide messages from ${name}? You can undo this on the Profile page.`)) return;
        muted.add(name);
        Arcade.save(MUTED_KEY, [...muted]);
      }
      hideMenu();
      render();
    }));
  }
  const hideMenu = () => { menu.hidden = true; };

  function open() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    badge.hidden = true;
    if (!stop) {
      stop = Online.subscribe('chat', data => { messages = data || {}; render(); }, `?orderBy=${encodeURIComponent('"t"')}&limitToLast=${SHOWN}`);
      setTimeout(() => {
        const note = log.querySelector('.chat-note');
        if (note?.textContent === 'Connecting…') note.textContent = 'Chat isn\'t available right now. Try again later.';
      }, 8000);
    }
    input.focus();
    prune();
  }

  function close() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    stop?.();
    stop = null;
  }

  toggle.addEventListener('click', () => (panel.hidden ? open() : close()));
  root.querySelector('.chat-close').addEventListener('click', close);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const res = Filter.check(input.value, MAX_LEN);
    errorEl.textContent = res.error || '';
    if (!res.text) return;
    if (Date.now() - lastSent < COOLDOWN) return void (errorEl.textContent = 'Slow down a little.');
    if (res.text === lastText) return void (errorEl.textContent = 'You just said that.');
    const me = Arcade.profile();
    lastSent = Date.now();
    lastText = res.text;
    input.value = '';
    try {
      await Online.post('chat', { id: me.id, name: me.name, text: res.text, at: here, t: Online.TIMESTAMP });
    } catch {
      errorEl.textContent = 'Couldn\'t send. Check your connection.';
    }
  });

  // Anyone may remove messages over a day old, so the first visitor each day tidies up.
  async function prune() {
    try {
      const old = await Online.get('chat', `?orderBy=${encodeURIComponent('"t"')}&endAt=${Date.now() - DAY}&limitToFirst=50`);
      await Promise.all(Object.keys(old || {}).map(k => Online.remove(`chat/${k}`)));
    } catch { /* tidying is best-effort */ }
  }

  // While closed, a light check every minute lights up the button when there's something new.
  async function peek() {
    if (!panel.hidden || document.hidden) return;
    try {
      const latest = Object.values(await Online.get('chat', `?orderBy=${encodeURIComponent('"t"')}&limitToLast=1`) || {})[0];
      badge.hidden = !(latest && latest.t > Arcade.load(SEEN_KEY, 0) && latest.id !== Arcade.profile().id && !muted.has(latest.name));
    } catch { /* offline */ }
  }
  peek();
  setInterval(peek, 60000);

  function unmute(name) {
    muted.delete(name);
    Arcade.save(MUTED_KEY, [...muted]);
  }

  return { muted: () => [...muted], unmute };
})();
