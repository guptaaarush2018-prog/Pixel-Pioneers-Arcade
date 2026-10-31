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
      <p>The top 25 players in every game. Your row is highlighted.</p>
    </div>
    <section class="box">
      <div class="section-head">
        <select class="select" id="game" aria-label="Game">
          ${LOCAL_GAMES.map(g => `<option value="${g.id}"${g.id === initial ? ' selected' : ''}>${g.title}</option>`).join('')}
        </select>
        <span class="board-note" id="mine"></span>
      </div>
      <div id="table"><p class="board-note">Loading…</p></div>
    </section>`;

  const select = document.getElementById('game');
  const table = document.getElementById('table');

  async function load(game) {
    table.innerHTML = '<p class="board-note">Loading…</p>';
    document.getElementById('mine').textContent = `Your best: ${Arcade.getBest(game).toLocaleString()}`;
    try {
      const list = await Online.top(game, 25);
      if (select.value !== game) return;
      const me = Arcade.profile().id;
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
