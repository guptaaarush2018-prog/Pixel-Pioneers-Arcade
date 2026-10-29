// Links point at index.html directly so the site also works when opened from disk.
// Games hosted elsewhere (catalog `url`) open in a new tab.
const gameUrl = g => g.url || `games/${g.id}/index.html`;
const thumbUrl = g => g.thumb || `games/${g.id}/thumb.svg`;
const linkAttrs = g => (g.url ? ' target="_blank" rel="noopener"' : '');
let playing = {};
const BADGES = { ghost: 'Online ghosts', live: 'Online multiplayer', duel: 'Online duels' };
const badgeOn = g => (g.online === 'ghost' ? Online.enabled : g.url || !!window.ARCADE_CONFIG?.relayUrl);

const grid = document.getElementById('games');
const filters = document.getElementById('filters');
let active = 'All';

document.getElementById('all-title').textContent = `All games (${CATALOG.length})`;

function renderFeatured() {
  // A different game is featured each day.
  const g = CATALOG[Math.floor(Date.now() / 86400000) % CATALOG.length];
  document.getElementById('featured').innerHTML = `
    <a href="${gameUrl(g)}"${linkAttrs(g)} tabindex="-1"><img src="${thumbUrl(g)}" alt="${g.title}"></a>
    <div class="featured-body">
      <span class="eyebrow">Featured today · ${g.genre}</span>
      <h1>${g.title}</h1>
      <p>${g.desc}</p>
      <a class="btn" href="${gameUrl(g)}"${linkAttrs(g)}>Play now${g.url ? ' ↗' : ''}</a>
    </div>`;
}

function renderCards() {
  grid.innerHTML = '';
  for (const g of CATALOG) {
    if (active !== 'All' && g.genre !== active) continue;
    const best = Arcade.getBest(g.id);
    const badge = g.online && badgeOn(g) ? `<span class="badge">${BADGES[g.online]}</span>` : '';
    const live = playing[g.id] ? `<span class="live">${playing[g.id]} playing</span>` : '';
    const card = document.createElement('a');
    card.className = g.url ? 'card external' : 'card';
    card.href = gameUrl(g);
    if (g.url) Object.assign(card, { target: '_blank', rel: 'noopener' });
    card.innerHTML = `
      <div class="thumb">${badge}${live}<img src="${thumbUrl(g)}" alt="" loading="lazy"></div>
      <div class="card-body">
        <h3>${g.title}</h3>
        <div class="meta">
          <span>${g.genre}</span>
          <span>${g.url ? (g.by || 'External') : best ? `Best <b>${best.toLocaleString()}</b>` : 'New'}</span>
        </div>
      </div>`;
    grid.appendChild(card);
  }
}

function renderFilters() {
  const genres = ['All', ...new Set(CATALOG.map(g => g.genre))];
  filters.innerHTML = '';
  for (const genre of genres) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = genre;
    chip.setAttribute('aria-pressed', String(genre === active));
    chip.addEventListener('click', () => {
      active = genre;
      renderFilters();
      renderCards();
    });
    filters.appendChild(chip);
  }
}

renderFeatured();
renderFilters();
renderCards();

// "N playing" on each card, from the same presence data as the header's counter.
if (Online.enabled) {
  const refreshPlaying = () => Online.whoIsOnline()
    .then(({ byGame }) => {
      playing = byGame;
      renderCards();
    })
    .catch(() => {});
  refreshPlaying();
  setInterval(() => { if (!document.hidden) refreshPlaying(); }, 30000);
}
// Refresh best scores when coming back from a game via the browser's back button.
window.addEventListener('pageshow', renderCards);
