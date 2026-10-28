// Shared header for the hub pages: <header class="site-header" data-page="games|leaderboards|profile">
(() => {
  const header = document.querySelector('.site-header');
  const links = [
    ['games', 'index.html', 'Games'],
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
