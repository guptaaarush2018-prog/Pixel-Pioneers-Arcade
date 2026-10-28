/* Shared helpers for every Pixel Pioneers game: storage, canvas sizing, input, overlays, sound. */
const Arcade = (() => {
  const PREFIX = 'ppa:';

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch {}
  }

  const getBest = id => load('best:' + id, 0);

  // Returns true when the score is a new personal best.
  function submitScore(id, score) {
    if (score > getBest(id)) {
      save('best:' + id, score);
      return true;
    }
    return false;
  }

  // Gives the canvas a fixed logical size (w x h), keeps it sharp on high-DPI screens,
  // and scales it to fit its parent while keeping the aspect ratio.
  function setupCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const stage = canvas.parentElement;
    const fit = () => {
      const r = stage.getBoundingClientRect();
      const s = Math.min((r.width - 16) / w, (r.height - 16) / h);
      canvas.style.width = Math.floor(w * s) + 'px';
      canvas.style.height = Math.floor(h * s) + 'px';
    };
    new ResizeObserver(fit).observe(stage);
    fit();
    return ctx;
  }

  // Offscreen canvas at the same DPR, drawn back with ctx.drawImage(c, 0, 0, w, h).
  function makeLayer(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = document.createElement('canvas');
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas: c, ctx };
  }

  const DIRS = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };
  const VEC = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  };

  // Stop arrows and space from scrolling the page while playing.
  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });

  // Swipe gestures fire as soon as the finger travels far enough, so repeated swipes chain.
  // A touch that barely moves counts as a tap.
  function onSwipe(el, onDir, onTap) {
    let sx = 0, sy = 0, moved = false;
    el.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      sx = t.clientX; sy = t.clientY; moved = false;
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      sx = t.clientX; sy = t.clientY; moved = true;
    }, { passive: false });
    el.addEventListener('touchend', () => {
      if (!moved && onTap) onTap();
    }, { passive: true });
  }

  // Calls fn when the tab loses focus, so games can auto-pause.
  function onBlur(fn) {
    window.addEventListener('blur', fn);
    document.addEventListener('visibilitychange', () => { if (document.hidden) fn(); });
  }

  // Start / pause / game-over panel laid over the canvas. Enter or Space presses its main button.
  // Pass button: null for a menu with only custom buttons, wired up in onRender(panel).
  // While the overlay is hidden the game counts as being played, which drives playtime stats.
  function overlay(el) {
    let action = null, readyAt = 0;
    window.addEventListener('keydown', e => {
      if (el.hidden || !action) return;
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      if (e.target.tagName === 'INPUT') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (performance.now() >= readyAt) action();
    }, true);

    return {
      show({ title, html = '', button = 'Play', onAction = null, delay = 0, onRender }) {
        const main = button ? `<button class="btn" type="button" data-main>${button}</button>` : '';
        el.innerHTML = `<div class="panel"><h2>${title}</h2>${html}${main}</div>`;
        el.hidden = false;
        playing = false;
        action = button ? onAction : null;
        readyAt = performance.now() + delay;
        el.querySelector('[data-main]')?.addEventListener('click', () => {
          if (performance.now() >= readyAt) onAction();
        });
        onRender?.(el.querySelector('.panel'));
      },
      hide() {
        el.hidden = true;
        action = null;
        playing = true;
      },
    };
  }

  // ---------- Player profile ----------

  // Names are generated rather than typed, so nothing inappropriate ends up on a leaderboard.
  const ADJECTIVES = ['Swift', 'Brave', 'Clever', 'Lucky', 'Mighty', 'Quiet', 'Rapid', 'Sunny', 'Cosmic', 'Pixel', 'Turbo', 'Happy', 'Bold', 'Calm', 'Fuzzy', 'Jolly', 'Nimble', 'Witty', 'Zippy', 'Epic', 'Silent', 'Golden', 'Frosty', 'Rocket'];
  const NOUNS = ['Otter', 'Falcon', 'Panda', 'Tiger', 'Koala', 'Fox', 'Owl', 'Lynx', 'Gecko', 'Bison', 'Raven', 'Shark', 'Moose', 'Yak', 'Llama', 'Badger', 'Heron', 'Puffin', 'Comet', 'Wizard', 'Ninja', 'Pilot', 'Knight', 'Robot'];

  const randomName = () => pick(ADJECTIVES) + pick(NOUNS) + randInt(10, 99);
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), b => (b % 36).toString(36)).join('');

  function profile() {
    let p = load('profile', null);
    if (!p || !p.id) {
      p = { id: randomId(), name: randomName() };
      save('profile', p);
    }
    return p;
  }

  function setName(name) {
    save('profile', { ...profile(), name });
  }

  // ---------- Stats & achievements ----------

  const gameId = document.body?.dataset.game || null;
  let playing = false;

  function stats() {
    return { time: {}, plays: {}, totalTime: 0, totalPlays: 0, days: [], flags: {}, ...load('stats', {}) };
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function updateStats(fn) {
    const s = stats();
    fn(s);
    if (!s.days.includes(today())) s.days.push(today());
    save('stats', s);
    checkAchievements();
  }

  // Marks a one-off accomplishment, e.g. Arcade.flag('box-battle-win'). Catalog games can
  // list these under `extras` to turn them into achievements.
  function flag(name) {
    updateStats(s => { s.flags[name] = true; });
  }

  function achievementList() {
    const games = window.CATALOG || [];
    const list = [
      { id: 'first-finish', title: 'First Run', desc: 'Finish your first game.', test: s => s.totalPlays >= 1 },
      { id: 'ten-games', title: 'Warmed Up', desc: 'Finish 10 games.', test: s => s.totalPlays >= 10 },
      { id: 'fifty-games', title: 'Arcade Regular', desc: 'Finish 50 games.', test: s => s.totalPlays >= 50 },
      { id: 'explorer', title: 'Explorer', desc: 'Play 5 different games.', test: s => Object.keys(s.plays).length >= 5 },
      { id: 'all-games', title: 'Completionist', desc: 'Play every game in the arcade.', test: s => games.length > 0 && games.every(g => s.plays[g.id]) },
      { id: 'time-10', title: 'Ten Minutes In', desc: 'Play for 10 minutes in total.', test: s => s.totalTime >= 600 },
      { id: 'time-60', title: 'One Hour Club', desc: 'Play for 1 hour in total.', test: s => s.totalTime >= 3600 },
      { id: 'time-300', title: 'Five Hour Legend', desc: 'Play for 5 hours in total.', test: s => s.totalTime >= 18000 },
      { id: 'days-3', title: 'Coming Back', desc: 'Play on 3 different days.', test: s => s.days.length >= 3 },
      { id: 'days-7', title: 'Weekly Player', desc: 'Play on 7 different days.', test: s => s.days.length >= 7 },
      { id: 'top-ten', title: 'On the Board', desc: 'Reach the top 10 of a global leaderboard.', test: s => s.flags['top-ten'] },
      { id: 'online-match', title: 'Good Game', desc: 'Finish an online match.', test: s => s.flags['online-match'] },
    ];
    for (const g of games) {
      ['Bronze', 'Silver', 'Gold'].forEach((tier, i) => list.push({
        id: `${g.id}-${tier.toLowerCase()}`, game: g.id, tier,
        title: `${g.title}: ${tier}`,
        desc: `Score ${g.goals[i].toLocaleString()} or more.`,
        test: () => getBest(g.id) >= g.goals[i],
      }));
      for (const x of g.extras || []) list.push({ ...x, game: g.id, test: s => s.flags[x.id] });
    }
    return list;
  }

  const unlocked = () => load('achievements', {});

  function checkAchievements() {
    const s = stats();
    const got = unlocked();
    let changed = false;
    for (const a of achievementList()) {
      if (got[a.id] || !a.test(s)) continue;
      got[a.id] = Date.now();
      changed = true;
      toast('Achievement unlocked', a.title);
    }
    if (changed) save('achievements', got);
  }

  function toast(label, text) {
    if (!document.body) return;
    let stack = document.querySelector('.toasts');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toasts';
      stack.setAttribute('role', 'status');
      document.body.appendChild(stack);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span>${label}</span><b>${text}</b>`;
    stack.appendChild(t);
    tone({ freq: 660, to: 990, dur: 0.15, type: 'triangle', vol: 0.05 });
    setTimeout(() => t.classList.add('out'), 3500);
    setTimeout(() => t.remove(), 4000);
  }

  // Count playtime once a second while a game is actually being played.
  let unsaved = 0;
  setInterval(() => {
    if (!gameId || !playing || document.hidden) return;
    unsaved++;
    if (unsaved >= 10) flushTime();
  }, 1000);
  function flushTime() {
    if (!unsaved) return;
    const secs = unsaved;
    unsaved = 0;
    updateStats(s => {
      s.time[gameId] = (s.time[gameId] || 0) + secs;
      s.totalTime += secs;
    });
  }
  window.addEventListener('pagehide', flushTime);

  // Standard game-over flow: saves the score, counts the play, shows the panel,
  // and (when online is set up) posts the score and shows the global top 5.
  function countPlay() {
    flushTime();
    updateStats(s => {
      s.plays[gameId] = (s.plays[gameId] || 0) + 1;
      s.totalPlays++;
    });
  }

  function finish(ui, { score, title = 'Game Over', lines = [], button = 'Play again', onAction, delay = 600, html = '' }) {
    const isBest = submitScore(gameId, score);
    countPlay();
    ui.show({
      title,
      html: `<p class="big">${score.toLocaleString()}</p>
        ${isBest && score > 0 ? '<p class="new-best">New personal best</p>' : ''}
        ${lines.map(l => `<p>${l}</p>`).join('')}${html}
        <div class="board" data-board></div>`,
      button,
      onAction,
      delay,
    });
    if (typeof Online !== 'undefined' && Online.enabled && score > 0) {
      const slot = document.querySelector('[data-board]');
      slot.innerHTML = '<p class="board-note">Checking the global leaderboard…</p>';
      Online.reportScore(gameId, score)
        .then(({ list, rank }) => {
          if (rank && rank <= 10) flag('top-ten');
          slot.innerHTML = Online.renderBoard(list.slice(0, 5), rank);
        })
        .catch(() => { slot.innerHTML = '<p class="board-note">Couldn\'t reach the leaderboard.</p>'; });
    }
  }

  // Tiny synth for sound effects; no audio files needed.
  let audio = null;
  let muted = load('muted', false);
  function tone({ freq = 440, to = freq, dur = 0.1, type = 'square', vol = 0.05, delay = 0 } = {}) {
    if (muted) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime + delay;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch {}
  }

  function wireMuteButton() {
    const btn = document.getElementById('mute');
    if (!btn) return;
    const render = () => { btn.textContent = muted ? 'Sound off' : 'Sound on'; };
    btn.addEventListener('click', () => {
      muted = !muted;
      save('muted', muted);
      render();
      btn.blur();
    });
    render();
  }
  document.addEventListener('DOMContentLoaded', wireMuteButton);

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  document.addEventListener('DOMContentLoaded', checkAchievements);

  return {
    load, save, getBest, submitScore, setupCanvas, makeLayer, DIRS, VEC, onSwipe, onBlur, overlay, tone, rand, randInt, pick,
    gameId, profile, setName, randomName, stats, flag, achievementList, unlocked, finish, countPlay, toast,
  };
})();
