const LOCAL_GAMES = CATALOG.filter(g => !g.url);
const page = document.getElementById('page');

if (!Online.enabled) {
  page.innerHTML = `
    <div class="page-head">
      <h1>Leaderboards</h1>
      <p>Global leaderboards aren't switched on for this arcade yet. Here are your personal bests.</p>
    </div>
    <section class="box">
      <table class="table">
        <thead><tr><th>Game</th><th style="text-align:right">Your best</th></tr></thead>
        <tbody>${LOCAL_GAMES.map(g => `<tr><td>${g.title}</td><td class="num">${Arcade.getBest(g.id).toLocaleString()}</td></tr>`).join('')}</tbody>
      </table>
    </section>`;
} else {
  const fromUrl = new URLSearchParams(location.search).get('game');
  const initial = LOCAL_GAMES.some(g => g.id === fromUrl) ? fromUrl : LOCAL_GAMES[0].id;

  page.innerHTML = `
    <div class="page-head">
      <h1>Leaderboards</h1>
      <p>The top 25 players in every game, or just you and your friends. Your row is highlighted.</p>
    </div>
    <section class="box">
      <div class="section-head">
        <select class="select" id="game" aria-label="Game">
          ${LOCAL_GAMES.map(g => `<option value="${g.id}"${g.id === initial ? ' selected' : ''}>${g.title}</option>`).join('')}
        </select>
        <nav class="filters" aria-label="Who to show">
          <button class="chip" type="button" data-view="all">Everyone</button>
          <button class="chip" type="button" data-view="friends">Friends</button>
        </nav>
        <span class="board-note" id="mine"></span>
      </div>
      <div id="table"><p class="board-note">Loading…</p></div>
    </section>`;

  const select = document.getElementById('game');
  const table = document.getElementById('table');

  let view = Arcade.load('board:view', 'all') === 'friends' ? 'friends' : 'all';
  const chips = page.querySelectorAll('[data-view]');
  const showView = () => chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.view === view)));
  chips.forEach(c => c.addEventListener('click', () => {
    view = c.dataset.view;
    Arcade.save('board:view', view);
    showView();
    load(select.value);
  }));
  showView();

  async function load(game) {
    table.innerHTML = '<p class="board-note">Loading…</p>';
    document.getElementById('mine').textContent = `Your best: ${Arcade.getBest(game).toLocaleString()}`;
    const shown = view;
    try {
      const list = shown === 'friends' ? await Online.friendsBoard(game) : await Online.top(game, 25);
      if (select.value !== game || view !== shown) return;
      const me = Arcade.profile().id;
      if (shown === 'friends' && !list.length) {
        table.innerHTML = `<p class="board-note">${Friends.all().length
          ? 'None of your friends have a score here yet. Challenge one from your <a href="profile.html">Profile</a>.'
          : 'Add friends by their friend code on your <a href="profile.html">Profile</a> to see how you compare.'}</p>`;
        return;
      }
      table.innerHTML = list.length
        ? `<table class="table">
            <thead><tr><th>#</th><th>Player</th><th style="text-align:right">Score</th></tr></thead>
            <tbody>${list.map((r, i) => `
              <tr class="${r.id === me ? 'me' : ''}"><td>${i + 1}</td><td>${Online.escape(Friends.display(r.id, r.name))}</td><td class="num">${Number(r.score).toLocaleString()}</td></tr>`).join('')}
            </tbody>
          </table>`
        : '<p class="board-note">No scores yet. Go set the first one!</p>';
    } catch {
      table.innerHTML = '<p class="board-note">Couldn\'t load the leaderboard. Check your connection and try again.</p>';
    }
  }

  select.addEventListener('change', () => {
    history.replaceState(null, '', `?game=${select.value}`);
    load(select.value);
  });
  load(initial);
}
