const page = document.getElementById('page');
const LOCAL_GAMES = CATALOG.filter(g => !g.url);

function formatTime(secs) {
  if (!secs) return '-';
  if (secs < 60) return `${secs}s`;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
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
