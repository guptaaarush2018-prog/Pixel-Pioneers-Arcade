/* Mod page: chat reports, recent chat and muted players, for the accounts in ARCADE_CONFIG.admins.
   The database rules list the same accounts, so for anyone else every action here is refused. */
(async () => {
  const page = document.getElementById('page');
  const esc = Online.escape;
  const DAY = 86400000, FOREVER = 8.64e15;

  if (!Online.enabled) return void (page.innerHTML = '<div class="page-head"><h1>Mod</h1><p>Online features are off.</p></div>');
  await Online.Auth.ready();
  if (!Arcade.isAdmin()) {
    page.innerHTML = '<div class="page-head"><h1>Mod</h1><p>This page is for the arcade\'s moderators.</p></div>';
    return;
  }

  page.innerHTML = `
    <div class="page-head">
      <h1>Mod</h1>
      <p>Reported chat messages, recent chat and muted players. Chat messages clear themselves after a day.</p>
    </div>
    <section class="box"><div class="section-head"><h2>Reports</h2><button class="btn secondary" type="button" data-refresh>Refresh</button></div><div id="reports"></div></section>
    <section class="box"><div class="section-head"><h2>Muted players</h2></div><div id="bans"></div></section>
    <section class="box"><div class="section-head"><h2>Recent chat</h2></div><div id="chat"></div></section>`;

  const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const names = {}; // id -> name, from whatever this page has seen
  const banButtons = id => `
    <button class="btn secondary" type="button" data-ban="${esc(id)}" data-for="${DAY}">Mute 1 day</button>
    <button class="btn secondary" type="button" data-ban="${esc(id)}" data-for="${7 * DAY}">Mute 7 days</button>
    <button class="btn secondary" type="button" data-ban="${esc(id)}" data-for="${FOREVER}">Chat off</button>`;

  async function act(fn, el) {
    el.disabled = true;
    try {
      await fn();
      load();
    } catch {
      el.disabled = false;
      Arcade.toast('Mod', 'That didn\'t go through. Did you publish the latest database rules?');
    }
  }

  function wire(root) {
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => act(() => Promise.all([
      Online.remove(`chat/${b.dataset.del}`), Online.remove(`reports/${b.dataset.del}`)]), b)));
    root.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', () => act(() => Online.remove(`reports/${b.dataset.dismiss}`), b)));
    root.querySelectorAll('[data-ban]').forEach(b => b.addEventListener('click', () => {
      const span = +b.dataset.for;
      act(() => Online.put(`chatban/${b.dataset.ban}`, span >= FOREVER ? FOREVER : Date.now() + span), b);
    }));
    root.querySelectorAll('[data-unban]').forEach(b => b.addEventListener('click', () => act(() => Online.remove(`chatban/${b.dataset.unban}`), b)));
  }

  async function load() {
    const [reports, bans, chat] = await Promise.all([
      Online.get('reports').catch(() => null),
      Online.get('chatban').catch(() => null),
      Online.get('chat', `?orderBy=${encodeURIComponent('"t"')}&limitToLast=60`).catch(() => null),
    ]);
    for (const m of Object.values(chat || {})) if (m?.id) names[m.id] = m.name;

    // Reports, one row per message, most-reported first.
    const rows = Object.entries(reports || {}).map(([key, by]) => {
      const list = Object.values(by || {});
      const first = list[0] || {};
      if (first.id) names[first.id] = first.name;
      return { key, count: list.length, id: first.id, name: first.name, text: first.text, t: Math.max(...list.map(r => r.t || 0)), live: !!chat?.[key] };
    }).sort((a, b) => b.count - a.count || b.t - a.t);
    const rep = document.getElementById('reports');
    rep.innerHTML = rows.length ? `<ul class="mod-list">${rows.map(r => `
      <li><span class="mod-meta"><b>${esc(r.name || '?')}</b> · reported ${r.count}× · last ${when(r.t)}${r.live ? '' : ' · already gone from chat'}</span>
        <p class="mod-text">${esc(r.text || '')}</p>
        <div class="row">
          <button class="btn" type="button" data-del="${esc(r.key)}">Delete message</button>
          <button class="btn secondary" type="button" data-dismiss="${esc(r.key)}">Dismiss</button>
          ${r.id ? banButtons(r.id) : ''}
        </div></li>`).join('')}</ul>` : '<p class="board-note">No reports. All quiet.</p>';
    wire(rep);

    // Mutes still in force; expired ones are tidied away.
    const now = Date.now();
    const live = Object.entries(bans || {}).filter(([id, until]) => {
      if (until > now) return true;
      Online.remove(`chatban/${id}`).catch(() => {});
      return false;
    });
    const ban = document.getElementById('bans');
    ban.innerHTML = live.length ? `<ul class="mod-list">${live.map(([id, until]) => `
      <li><span class="mod-meta"><b>${esc(names[id] || id)}</b> · ${until >= FOREVER ? 'chat off' : `until ${when(until)}`}</span>
        <div class="row" style="margin-top:6px"><button class="btn secondary" type="button" data-unban="${esc(id)}">Unmute</button></div></li>`).join('')}</ul>`
      : '<p class="board-note">Nobody is muted.</p>';
    wire(ban);

    // Recent chat, newest first, unfiltered so you see what was actually sent.
    const msgs = Object.entries(chat || {}).map(([key, m]) => ({ key, ...m })).sort((a, b) => b.t - a.t);
    const box = document.getElementById('chat');
    box.innerHTML = msgs.length ? `<ul class="mod-list">${msgs.map(m => `
      <li><span class="mod-meta"><b>${esc(m.name)}</b> · ${when(m.t)}${Filter.display(m.text, 140) === null ? ' · hidden by the filter' : ''}</span>
        <p class="mod-text">${esc(m.text)}</p>
        <div class="row"><button class="btn secondary" type="button" data-del="${esc(m.key)}">Delete</button>${m.id === Arcade.profile().id ? '' : banButtons(m.id)}</div></li>`).join('')}</ul>`
      : '<p class="board-note">No chat in the last day.</p>';
    wire(box);
  }

  page.querySelector('[data-refresh]').addEventListener('click', load);
  load();
  setInterval(() => { if (!document.hidden) load(); }, 30000);
})();
