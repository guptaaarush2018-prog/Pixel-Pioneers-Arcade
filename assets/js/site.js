// Shared header for the hub pages: <header class="site-header" data-page="games|lobby|leaderboards|profile">
(() => {
  const header = document.querySelector('.site-header');
  const links = [
    ['games', 'index.html', 'Games'],
    ['lobby', 'lobby.html', 'Lobby'],
    ['leaderboards', 'leaderboards.html', 'Leaderboards'],
    ['profile', 'profile.html', 'Profile'],
  ];
  header.innerHTML = `
    <div class="wrap">
      <a class="logo" href="index.html">
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#1e222a"/><rect x="3" y="3" width="4" height="4" fill="#ffc53d"/><rect x="7" y="7" width="3" height="3" fill="#eceef2"/><rect x="10" y="10" width="3" height="3" fill="#8d94a1"/></svg>
        Pixel Pioneers Arcade
      </a>
      <nav class="site-nav">
        ${links.map(([id, href, label]) =>
          `<a href="${href}"${id === header.dataset.page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        <a class="ticket-pill" href="profile.html#shop" title="Tickets: spend them in the prize shop">🎟 ${Arcade.tickets().toLocaleString()}</a>
        <span class="online-pill" id="online-pill"></span>
      </nav>
    </div>`;

  if (!Online.enabled) return;
  const pill = document.getElementById('online-pill');
  const refresh = () => Online.whoIsOnline()
    .then(({ total }) => {
      pill.textContent = `${total} playing now`;
      pill.classList.add('show');
    })
    .catch(() => {});
  refresh();
  setInterval(refresh, 30000);
})();

// Today's daily challenges, for the hub and the profile page.
function renderDaily(el) {
  const d = Arcade.daily();
  const hrs = 24 - new Date().getHours();
  el.innerHTML = `
    <div class="daily-head"><h2>Daily challenges</h2>
      <span class="board-note">+${Arcade.DAILY_REWARD} tickets each, +${Arcade.DAILY_BONUS} for all three · new ones in ${hrs}h</span></div>
    <ul class="daily-list">${d.tasks.map(t => {
      const done = d.done.includes(t.id);
      const progress = t.plays ? ` (${Math.min(d.plays, t.plays)}/${t.plays})` : t.variety ? ` (${Math.min(d.games.length, t.variety)}/${t.variety})` : '';
      const link = t.game ? `games/${t.game}/index.html` : '';
      return `<li class="${done ? 'done' : ''}"><span class="check">${done ? '✓' : ''}</span>
        ${link && !done ? `<a href="${link}">${Online.escape(t.text)}</a>` : `<span>${Online.escape(t.text)}</span>`}${done ? '' : progress}</li>`;
    }).join('')}</ul>`;
}
