const page = document.getElementById('page');
const LOCAL_GAMES = CATALOG.filter(g => !g.url);

function formatTime(secs) {
  if (!secs) return '-';
  if (secs < 60) return `${secs}s`;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

const esc = s => Online.escape(s);
const titleOf = id => CATALOG.find(g => g.id === id)?.title || '';

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)} days ago`;
}

function friendsBox(me) {
  const friends = Friends.all();
  const recent = Friends.recent().filter(r => !Friends.get(r.id));
  const row = f => `<li>
      <span class="dot" data-dot="${esc(f.id)}" style="opacity:.25"></span>
      <span class="who"><b>★ ${esc(f.nick || f.name || 'New friend')}</b><span data-status="${esc(f.id)}">${esc(f.nick ? f.name : '')}</span></span>
      ${typeof Invites !== 'undefined' && Invites ? `<button class="btn" type="button" data-challenge="${esc(f.id)}">Challenge</button>` : ''}
      <button class="btn secondary" type="button" data-nick="${esc(f.id)}">Nickname</button>
      <button class="btn secondary" type="button" data-unfriend="${esc(f.id)}">Remove</button>
    </li>`;
  return `<section class="box">
      <h2>Friends</h2>
      <p class="muted-note">Your friend code is <b class="friend-code">${esc(me.id)}</b>
        <button class="btn secondary" type="button" id="copy-code">Copy</button>
        Share it in person, and a friend can add you here. Nicknames are private: only you see them.</p>
      <div class="friend-add">
        <input class="field" id="friend-code" maxlength="32" placeholder="Friend code" autocomplete="off" aria-label="Friend code">
        <button class="btn" type="button" id="add-friend">Add friend</button>
      </div>
      <p class="error" id="friend-error"></p>
      ${friends.length ? `<ul class="waiting-list">${friends.map(row).join('')}</ul>`
        : '<p class="board-note">No friends yet. Add someone by their code, from a name in chat, or from the players you\'ve met below.</p>'}
      ${recent.length ? `<h3>Recent players</h3><ul class="waiting-list">${recent.map(r => `<li>
          <span class="who"><b>${esc(r.name)}</b><span>${esc(titleOf(r.game))} · ${ago(r.t)}</span></span>
          <button class="btn secondary" type="button" data-befriend="${esc(r.id)}" data-name="${esc(r.name)}">Add friend</button></li>`).join('')}</ul>` : ''}
    </section>`;
}

// Online or not, and where: friends' heartbeats are in presence/<id>, which also carries their current name.
async function friendStatus() {
  if (!Online.enabled) return;
  for (const f of Friends.all()) {
    Online.get(`presence/${f.id}`).then(p => {
      const status = page.querySelector(`[data-status="${f.id}"]`), dot = page.querySelector(`[data-dot="${f.id}"]`);
      if (!status || !p) return;
      if (p.name) Friends.touch(f.id, p.name);
      const live = Date.now() - p.t < 90000;
      const where = titleOf(p.at);
      status.textContent = [f.nick ? p.name || f.name : '', live ? `Online${where ? ` · playing ${where}` : ''}` : `Last seen ${ago(p.t)}`].filter(Boolean).join(' · ');
      if (live) dot.style.opacity = 1;
    }).catch(() => {});
  }
}

function render() {
  const me = Arcade.profile();
  const s = Arcade.stats();
  const got = Arcade.unlocked();
  const all = Arcade.achievementList();
  const general = all.filter(a => !a.game);

  const gameRows = LOCAL_GAMES.map(g => `
    <tr>
      <td><a href="games/${g.id}/index.html">${g.title}</a></td>
      <td class="num">${Arcade.getBest(g.id).toLocaleString()}</td>
      <td class="num">${s.plays[g.id] || 0}</td>
      <td class="num">${formatTime(s.time[g.id] || 0)}</td>
    </tr>`).join('');

  const achCard = a => {
    const tierClass = a.tier ? a.tier.toLowerCase() : '';
    const icon = a.tier ? a.tier[0] : '★';
    return `<div class="ach${got[a.id] ? ' got' : ''}">
      <span class="icon ${tierClass}">${icon}</span>
      <div><b>${a.title}</b><span>${a.desc}</span></div>
    </div>`;
  };

  page.innerHTML = `
    <div class="page-head">
      <h1>Your profile</h1>
      <p>Everything here is saved in this browser.</p>
    </div>

    <section class="box">
      <h2>Player name</h2>
      <div class="name-row">
        <span class="current">${Online.escape(me.name)}</span>
        <button class="btn secondary" type="button" id="reroll">Pick a new name</button>
      </div>
      <div class="name-choices" id="choices"></div>
      <p class="muted-note">Names are generated so every leaderboard stays friendly.</p>
    </section>

    ${friendsBox(me)}

    <section class="box daily" id="daily"></section>

    <section class="box" id="shop">
      <div class="daily-head"><h2>Prize shop</h2><span class="board-note">You have <b class="tickets">🎟 ${Arcade.tickets().toLocaleString()}</b> tickets. Earn them by finishing games, scoring medals and doing daily challenges.</span></div>
      ${Arcade.SHOP.map(group => `<h3>${esc(group.title)}</h3><div class="shop-row">${group.items.map(item => {
        const mine = item.cost === 0 || Arcade.owned()[`${group.slot}:${item.id}`];
        const on = Arcade.equipped(group.slot)?.id === item.id;
        return `<button class="shop-item${on ? ' on' : ''}" type="button" data-slot="${group.slot}" data-item="${item.id}"${!mine && Arcade.tickets() < item.cost ? ' disabled' : ''}>
          <span class="swatches">${item.colors.slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>
          <b>${esc(item.name)}</b><span>${on ? 'Equipped' : mine ? 'Equip' : `🎟 ${item.cost}`}</span></button>`;
      }).join('')}</div>`).join('')}
    </section>

    ${typeof Chat !== 'undefined' && Chat && Chat.muted().length ? `<section class="box">
      <h2>Hidden in chat</h2>
      <ul class="waiting-list">${Chat.muted().map(n => `<li><span class="who"><b>${Online.escape(n)}</b></span>
        <button class="btn secondary" type="button" data-unmute="${Online.escape(n)}">Show again</button></li>`).join('')}</ul>
    </section>` : ''}

    <section class="box">
      <h2>Stats</h2>
      <div class="stat-row">
        <div class="stat"><span>Time played</span><b>${formatTime(s.totalTime)}</b></div>
        <div class="stat"><span>Games finished</span><b>${s.totalPlays}</b></div>
        <div class="stat"><span>Days played</span><b>${s.days.length}</b></div>
        <div class="stat"><span>Achievements</span><b>${Object.keys(got).length} / ${all.length}</b></div>
      </div>
    </section>

    <section class="box">
      <h2>Achievements</h2>
      <div class="ach-grid">${general.map(achCard).join('')}</div>
    </section>

    <section class="box">
      <h2>Game medals</h2>
      <div class="ach-grid">${all.filter(a => a.game).map(achCard).join('')}</div>
    </section>

    <section class="box">
      <h2>By game</h2>
      <table class="table">
        <thead><tr><th>Game</th><th style="text-align:right">Best</th><th style="text-align:right">Played</th><th style="text-align:right">Time</th></tr></thead>
        <tbody>${gameRows}</tbody>
      </table>
    </section>`;

  const friendError = document.getElementById('friend-error');
  document.getElementById('copy-code').addEventListener('click', e => {
    navigator.clipboard?.writeText(me.id).then(() => { e.target.textContent = 'Copied'; }).catch(() => {});
  });
  const addByCode = () => {
    const code = document.getElementById('friend-code').value.trim().toLowerCase();
    if (code === me.id) return void (friendError.textContent = 'That\'s your own code.');
    if (!Friends.ID_RE.test(code)) return void (friendError.textContent = 'Friend codes are letters and numbers, like the one above.');
    Friends.add(code, '');
    render();
  };
  document.getElementById('add-friend').addEventListener('click', addByCode);
  document.getElementById('friend-code').addEventListener('keydown', e => { if (e.key === 'Enter') addByCode(); });
  page.querySelectorAll('[data-befriend]').forEach(b => b.addEventListener('click', () => {
    Friends.add(b.dataset.befriend, b.dataset.name);
    render();
  }));
  page.querySelectorAll('[data-unfriend]').forEach(b => b.addEventListener('click', () => {
    const f = Friends.get(b.dataset.unfriend);
    if (!confirm(`Remove ${f?.nick || f?.name || 'this friend'} from your friends?`)) return;
    Friends.remove(b.dataset.unfriend);
    render();
  }));
  page.querySelectorAll('[data-nick]').forEach(b => b.addEventListener('click', () => {
    const f = Friends.get(b.dataset.nick);
    const err = Friends.askNick(b.dataset.nick, f?.name || 'your friend');
    if (err) friendError.textContent = err;
    else render();
  }));
  renderDaily(document.getElementById('daily'));
  page.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => {
    if (Arcade.equip(b.dataset.slot, b.dataset.item)) render();
  }));
  page.querySelectorAll('[data-challenge]').forEach(b => b.addEventListener('click', () => Invites.pick(b.dataset.challenge)));
  friendStatus();

  page.querySelectorAll('[data-unmute]').forEach(b => b.addEventListener('click', () => {
    Chat.unmute(b.dataset.unmute);
    render();
  }));

  document.getElementById('reroll').addEventListener('click', () => {
    const choices = document.getElementById('choices');
    choices.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const name = Arcade.randomName();
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = name;
      b.addEventListener('click', () => {
        Arcade.setName(name);
        render();
      });
      choices.appendChild(b);
    }
  });
}

render();
