// Links point at index.html directly so the site also works when opened from disk.
const gameUrl = g => `games/${g.id}/index.html`;
const thumbUrl = g => `games/${g.id}/thumb.svg`;
const BADGES = { multiplayer: 'Online multiplayer', ghost: 'Online ghosts' };

const grid = document.getElementById('games');
const filters = document.getElementById('filters');
let active = 'All';

document.getElementById('all-title').textContent = `All games (${CATALOG.length})`;

function renderFeatured() {
  // A different game is featured each day.
  const g = CATALOG[Math.floor(Date.now() / 86400000) % CATALOG.length];
  document.getElementById('featured').innerHTML = `
    <a href="${gameUrl(g)}" tabindex="-1"><img src="${thumbUrl(g)}" alt="${g.title}"></a>
    <div class="featured-body">
      <span class="eyebrow">Featured today · ${g.genre}</span>
      <h1>${g.title}</h1>
      <p>${g.desc}</p>
      <a class="btn" href="${gameUrl(g)}">Play now</a>
    </div>`;
}

function renderCards() {
  grid.innerHTML = '';
  for (const g of CATALOG) {
    if (active !== 'All' && g.genre !== active) continue;
    const best = Arcade.getBest(g.id);
    const badge = g.online && Online.enabled ? `<span class="badge">${BADGES[g.online]}</span>` : '';
    const card = document.createElement('a');
    card.className = 'card';
    card.href = gameUrl(g);
    card.innerHTML = `
      <div class="thumb">${badge}<img src="${thumbUrl(g)}" alt="" loading="lazy"></div>
      <div class="card-body">
        <h3>${g.title}</h3>
        <div class="meta">
          <span>${g.genre}</span>
          <span>${best ? `Best <b>${best.toLocaleString()}</b>` : 'New'}</span>
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
// Refresh best scores when coming back from a game via the browser's back button.
window.addEventListener('pageshow', renderCards);
