// Who's online right now, and everyone waiting in a public queue, with a button to join them.
const page = document.getElementById('page');
const titleOf = id => CATALOG.find(g => g.id === id)?.title || id;

if (!Online.enabled) {
  page.innerHTML = `
    <div class="page-head">
      <h1>Lobby</h1>
      <p>The lobby needs the arcade's online features, which aren't switched on yet. You can still play online with a room code or quick match from inside each game.</p>
    </div>`;
} else {
  page.innerHTML = `
    <div class="page-head">
      <h1>Lobby</h1>
      <p>Players waiting for a public match right now. Join one and you'll be in their game straight away.</p>
    </div>
    <section class="box">
      <div class="stat-row" id="counts"><div class="stat"><span>Playing now</span><b>-</b></div></div>
    </section>
    <section class="box">
      <h2>Waiting for an opponent</h2>
      <div id="waiting"><p class="board-note">Loading…</p></div>
    </section>`;

  const counts = document.getElementById('counts');
  const waitingEl = document.getElementById('waiting');

  async function refresh() {
    try {
      const [{ total, byGame }, list] = await Promise.all([Online.whoIsOnline(), Online.waiting()]);
      const busiest = Object.entries(byGame).filter(([id]) => id !== 'hub' && id !== 'lobby').sort((a, b) => b[1] - a[1]).slice(0, 3);
      counts.innerHTML = `<div class="stat"><span>Playing now</span><b>${total}</b></div>
        <div class="stat"><span>Waiting for a match</span><b>${list.length}</b></div>
        ${busiest.map(([id, n]) => `<div class="stat"><span>${Online.escape(titleOf(id))}</span><b>${n}</b></div>`).join('')}`;
      waitingEl.innerHTML = list.length
        ? `<ul class="waiting-list">${list.map(w => `
            <li><span class="dot"></span>
              <span class="who"><b>${Online.escape(w.name)}</b><span>${Online.escape(titleOf(w.game))} · ${Online.escape(w.label || 'Quick match')} · waiting ${Math.max(1, Math.round((Date.now() - w.t) / 1000))}s</span></span>
              <a class="btn" href="games/${encodeURIComponent(w.game)}/index.html?join=${encodeURIComponent(w.room)}">Join</a></li>`).join('')}</ul>`
        : '<p class="board-note">Nobody is waiting right now. Press Quick match in any online game and you\'ll show up here for others to join.</p>';
    } catch {
      waitingEl.innerHTML = '<p class="board-note">Couldn\'t reach the lobby. Check your connection.</p>';
    }
  }
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 5000);
}
