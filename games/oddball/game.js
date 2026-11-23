/* Oddball: name something that fits the prompt, but pick what nobody else will. Every right
   answer scores by how rare it is: the share of players who gave it today (from everyone's
   answers in Firebase), blended with a built-in guess until enough people have played. Six
   prompts a round, 25 seconds each. The Daily Oddball is the same six for everyone today;
   Free play deals random prompts (and works as an online score duel). */
(() => {
  const ID = 'oddball';
  const ROUND = 6, TIME = 25, WRONG_COST = 3;
  const DAILY_KEY = 'oddball:daily';
  const EPOCH = Date.UTC(2026, 10, 21);       // Daily Oddball #1
  // Rarity tiers: the share of players giving an answer at or above `min` lands in the tier.
  const TIERS = [
    { name: 'Common', min: 0.2, pts: 10, color: '#9aa3b5' },
    { name: 'Uncommon', min: 0.08, pts: 25, color: '#3ccf8e' },
    { name: 'Rare', min: 0.03, pts: 45, color: '#4f8cff' },
    { name: 'Epic', min: 0.01, pts: 70, color: '#b07cff' },
    { name: 'Oddball', min: 0, pts: 100, color: '#ffc53d' },
  ];
  // The built-in guess at each answer group's share, before real answers come in, and how many
  // players' worth of weight that guess carries against them.
  const PRIOR = [0.24, 0.1, 0.045, 0.018, 0.006], PRIOR_WEIGHT = 6;

  const el = document.getElementById('ob');
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const online = typeof Online !== 'undefined' && Online.enabled;

  // ---------- Answers ----------

  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').trim().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]/g, '');
  // Plurals count as the same answer ("cookies" = "cookie", "berries" = "berry").
  const stem = k => (k.length > 4 && k.endsWith('ies') ? k.slice(0, -3) + 'y'
    : k.length > 4 && /(ss|x|z|ch|sh)es$/.test(k) ? k.slice(0, -2)
    : k.length > 3 && k.endsWith('s') && !k.endsWith('ss') && !k.endsWith('us') ? k.slice(0, -1) : k);

  const PROMPTS = (window.ODDBALL_PROMPTS || []).map(p => {
    const keys = new Map();
    const answers = [];
    p.a.split('|').forEach((group, g) => {
      for (const raw of group.split(',')) {
        const names = raw.split('/').map(x => x.trim()).filter(Boolean);
        if (!names.length) continue;
        const canon = norm(names[0]).slice(0, 32);
        if (answers.some(a => a.key === canon)) continue;
        const ans = { key: canon, show: names[0], group: Math.min(g, PRIOR.length - 1) };
        answers.push(ans);
        for (const n of names) if (!keys.has(stem(norm(n)))) keys.set(stem(norm(n)), ans);
      }
    });
    return { id: p.id, q: p.q, keys, answers };
  });

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    // Edit distance where swapping two neighbouring letters ("hermoine") counts as one typo.
    let pp = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > max) return max + 1;
      pp = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  // The accepted answer a guess means, allowing a typo or two in longer words.
  function match(p, text) {
    const k = stem(norm(text));
    if (!k) return null;
    if (p.keys.has(k)) return p.keys.get(k);
    const max = k.length >= 9 ? 2 : k.length >= 5 ? 1 : 0;
    if (!max) return null;
    let best = null, bd = max + 1;
    for (const [key, ans] of p.keys) {
      const d = lev(k, key, max);
      if (d < bd) { bd = d; best = ans; }
    }
    return best;
  }

  // ---------- Rarity ----------

  // counts: { answerKey: players } for this prompt today, not counting you.
  function rarity(p, ans, counts) {
    const n = counts ? Object.values(counts).reduce((t, c) => t + c, 0) : 0;
    const c = counts?.[ans.key] || 0;
    const share = (c + PRIOR_WEIGHT * PRIOR[ans.group]) / (n + PRIOR_WEIGHT);
    const tier = TIERS.findIndex(t => share >= t.min);
    return { share, tier, n, c };
  }

  // ---------- Dates and the daily set ----------

  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dailyNo = () => {
    const d = new Date();
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000) + 1;
  };
  function dailySet() {
    // A shuffled cycle through the whole bank, so prompts don't repeat until it runs out.
    const cycle = Math.floor((dailyNo() - 1) * ROUND / PROMPTS.length);
    const order = PROMPTS.map((p, i) => i);
    const rc = Gfx.rng(cycle * 104729 + 3);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rc() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const start = ((dailyNo() - 1) * ROUND) % PROMPTS.length;
    const set = [];
    for (let k = 0; set.length < ROUND && k < order.length; k++) set.push(PROMPTS[order[(start + k) % order.length]]);
    return set;
  }

  // ---------- Online answers: oddball/<day>/<prompt>/<uid> = answer key ----------

  let dayCounts = null;   // { promptId: { key: n } }, without you
  async function fetchCounts() {
    if (!online) return null;
    try {
      const raw = await Online.get(`oddball/${dayKey()}`) || {};
      const me = Arcade.profile().id, out = {};
      for (const [pid, byUid] of Object.entries(raw)) {
        const c = out[pid] = {};
        for (const [uid, key] of Object.entries(byUid || {})) if (uid !== me && typeof key === 'string') c[key] = (c[key] || 0) + 1;
      }
      return out;
    } catch { return null; }
  }
  function postAnswer(pid, key) {
    if (!online) return;
    Online.Auth.ready()
      .then(() => Online.put(`oddball/${dayKey()}/${pid}/${Arcade.profile().id}`, key))
      .catch(() => {});
  }

  // ---------- Round ----------

  let run = null;   // { mode, prompts, i, results: [], score, t0, left, phase }
  let timer = null;

  function startDaily() {
    const saved = Arcade.load(DAILY_KEY, null);
    if (saved?.day === dayKey() && saved.done) return dailyResults(saved);
    const prompts = dailySet();
    run = { mode: 'daily', prompts, i: 0, results: [], score: 0 };
    if (saved?.day === dayKey() && Array.isArray(saved.results)) {
      run.results = saved.results;
      run.i = saved.results.length;
      run.score = saved.results.reduce((t, r) => t + r.pts, 0);
    }
    ui.hide();
    el.innerHTML = '<p class="ob-msg">Loading today\'s answers…</p>';
    fetchCounts().then(c => {
      dayCounts = c;
      nextPrompt();
    });
  }

  function startFree() {
    const pool = PROMPTS.slice();
    const prompts = [];
    while (prompts.length < ROUND && pool.length) prompts.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    run = { mode: 'free', prompts, i: 0, results: [], score: 0 };
    dayCounts = null;
    ui.hide();
    nextPrompt();
  }

  function nextPrompt() {
    if (run.i >= run.prompts.length) return finishRun();
    const p = run.prompts[run.i];
    run.phase = 'ask';
    run.deadline = performance.now() + TIME * 1000;
    el.innerHTML = `
      <div class="ob-top"><span>${run.mode === 'daily' ? `Daily Oddball #${dailyNo()}` : 'Free play'} · ${run.i + 1} of ${ROUND}</span>${pipsHtml()}<span class="ob-score">${run.score} pts</span></div>
      <div class="ob-bar"><i data-bar style="width:100%"></i></div>
      <div class="ob-q">${esc(p.q)}</div>
      <p class="ob-hint">Rarer right answers score more. One answer counts.</p>
      <form class="ob-form" data-form autocomplete="off"><input data-in maxlength="40" placeholder="Type your answer" aria-label="Your answer" spellcheck="false" autocapitalize="off"><button class="btn" type="submit">Go</button></form>
      <p class="ob-msg" data-msg></p>
      <div class="ob-row"><button class="btn secondary" type="button" data-pass>Pass (Esc)</button></div>`;
    const input = el.querySelector('[data-in]');
    el.querySelector('[data-form]').addEventListener('submit', e => { e.preventDefault(); guess(input.value); });
    el.querySelector('[data-pass]').addEventListener('click', () => resolve(null));
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); resolve(null); } });
    setTimeout(() => input.focus(), 30);
    clearInterval(timer);
    timer = setInterval(tick, 100);
    updateHud();
  }

  function pipsHtml() {
    return `<span class="ob-pips">${run.prompts.map((_, k) => {
      const r = run.results[k];
      return `<i class="${r ? (r.tier < 0 ? 'miss' : 't' + r.tier) : k === run.i ? 'now' : ''}"></i>`;
    }).join('')}</span>`;
  }

  function tick() {
    if (!run || run.phase !== 'ask') return clearInterval(timer);
    const left = (run.deadline - performance.now()) / 1000;
    const bar = el.querySelector('[data-bar]');
    if (bar) {
      bar.style.width = Math.max(0, left / TIME * 100) + '%';
      bar.classList.toggle('low', left < 6);
    }
    if (left <= 0) resolve(null, "Time's up!");
  }

  function guess(text) {
    if (run?.phase !== 'ask') return;
    const p = run.prompts[run.i], input = el.querySelector('[data-in]'), msg = el.querySelector('[data-msg]');
    if (!text.trim()) return;
    const ans = match(p, text);
    if (!ans) {
      run.deadline -= WRONG_COST * 1000;
      msg.className = 'ob-msg bad';
      msg.textContent = `"${text.trim().slice(0, 30)}" isn't on our list. −${WRONG_COST} s, try another!`;
      input.classList.remove('shake');
      void input.offsetWidth;
      input.classList.add('shake');
      input.select();
      Arcade.tone({ freq: 180, to: 120, dur: 0.15, type: 'square', vol: 0.04 });
      return;
    }
    resolve(ans);
  }

  function resolve(ans, why = '') {
    if (run?.phase !== 'ask') return;
    run.phase = 'reveal';
    clearInterval(timer);
    const p = run.prompts[run.i];
    const left = Math.max(0, (run.deadline - performance.now()) / 1000);
    let res;
    if (ans) {
      const counts = dayCounts?.[p.id] || null;
      const r = rarity(p, ans, counts);
      const speed = Math.ceil(left / TIME * 10);
      const pts = TIERS[r.tier].pts + speed;
      res = { id: p.id, key: ans.key, show: ans.show, tier: r.tier, share: r.share, pts, speed, n: r.n };
      if (run.mode === 'daily') postAnswer(p.id, ans.key);
      if (r.tier === 4) Arcade.flag('oddball-oddball');
    } else {
      res = { id: p.id, key: '', show: '', tier: -1, share: 0, pts: 0, speed: 0, n: 0 };
    }
    run.results[run.i] = res;
    run.score += res.pts;
    if (run.mode === 'daily') Arcade.save(DAILY_KEY, { day: dayKey(), results: run.results, done: false });
    reveal(p, res, why);
    updateHud();
  }

  function reveal(p, res, why) {
    const t = TIERS[res.tier];
    const examples = p.answers.filter(a => a.group >= 3).sort(() => Math.random() - 0.5).slice(0, 3).map(a => a.show);
    el.innerHTML = `
      <div class="ob-top"><span>${run.i + 1} of ${ROUND}</span>${pipsHtml()}<span class="ob-score">${run.score} pts</span></div>
      <div class="ob-q">${esc(p.q)}</div>
      ${res.tier < 0
        ? `<div class="ob-reveal"><div class="ob-ans">${why || 'Passed'}</div><p class="ob-pts">Some rare ones: ${examples.map(esc).join(', ')}</p></div>`
        : `<div class="ob-reveal" style="--c:${t.color}">
            <div class="ob-ans">${esc(res.show)}</div>
            <span class="ob-badge" style="--c:${t.color}">${t.name}</span>
            <div class="ob-meter">${TIERS.map((_, k) => `<span class="${k <= res.tier ? 'on' : ''}"></span>`).join('')}</div>
            <p class="ob-pts"><b>+${res.pts}</b> · ${shareText(res)}${res.speed ? ` · +${res.speed} speed` : ''}</p>
          </div>`}
      <div class="ob-row"><button class="btn" type="button" data-next>${run.i + 1 >= ROUND ? 'See results' : 'Next'} (Enter)</button></div>`;
    const next = el.querySelector('[data-next]');
    const go = () => { if (run.phase !== 'reveal') return; run.phase = 'wait'; run.i++; nextPrompt(); };
    next.addEventListener('click', go);
    setTimeout(() => next.focus(), 30);
    if (res.tier >= 0) {
      Arcade.tone({ freq: 440 + res.tier * 110, to: 660 + res.tier * 180, dur: 0.18, type: 'triangle', vol: 0.05 });
      if (res.tier >= 3) {
        Arcade.tone({ freq: 880, to: 1320, dur: 0.25, type: 'triangle', vol: 0.05, delay: 0.15 });
        confetti(res.tier === 4 ? 46 : 26);
      }
    } else Arcade.tone({ freq: 200, to: 140, dur: 0.2, type: 'sine', vol: 0.04 });
  }

  const pct = x => (x >= 0.1 ? Math.round(x * 100) : x >= 0.01 ? Math.round(x * 1000) / 10 : '<1') + '%';
  function shareText(res) {
    if (run?.mode === 'daily' && res.n >= 3) return `about ${pct(res.share)} of players`;
    return `we'd guess ${pct(res.share)} of players say it`;
  }

  function confetti(n) {
    const box = document.createElement('div');
    box.className = 'ob-confetti';
    const colors = ['#ffc53d', '#b07cff', '#4f8cff', '#3ccf8e', '#ff7ae0'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.style.left = `${10 + Math.random() * 80}%`;
      c.style.top = `${-5 + Math.random() * 25}%`;
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
      c.style.setProperty('--r', `${(Math.random() - 0.5) * 1080}deg`);
      c.style.animationDelay = `${Math.random() * 0.25}s`;
      box.appendChild(c);
    }
    el.appendChild(box);
    setTimeout(() => box.remove(), 1800);
  }

  function updateHud() {
    $('score').textContent = run ? run.score.toLocaleString() : 0;
    $('round').textContent = run ? `${Math.min(run.i + 1, ROUND)}/${ROUND}` : '-';
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  // ---------- Results ----------

  function finishRun() {
    clearInterval(timer);
    const r = run;
    const good = r.results.filter(x => x.tier >= 2).length;
    if (good === ROUND) Arcade.flag('oddball-sweep');
    if (r.mode === 'daily') {
      Arcade.flag('oddball-daily');
      const saved = { day: dayKey(), results: r.results, done: true, score: r.score };
      Arcade.save(DAILY_KEY, saved);
      el.innerHTML = '';
      Arcade.finish(ui, {
        score: r.score,
        title: `Daily Oddball #${dailyNo()}`,
        lines: [`${good} of ${ROUND} answers were Rare or better.`],
        html: '<div class="menu"><button class="btn secondary" type="button" data-see>See what everyone said</button></div>',
        button: 'Menu',
        onAction: showMenu,
      });
      overlayEl.querySelector('[data-see]')?.addEventListener('click', () => dailyResults(saved));
    } else {
      el.innerHTML = '';
      Arcade.finish(ui, {
        score: r.score,
        title: 'Free play',
        lines: [r.results.map(x => x.tier < 0 ? '✖' : ['⚪', '🟢', '🔵', '🟣', '🟡'][x.tier]).join(' '), `${good} of ${ROUND} answers were Rare or better.`],
        button: 'Play again',
        onAction: startFree,
      });
      const panel = overlayEl.querySelector('.panel');
      if (panel && !(typeof Versus !== 'undefined' && Versus.active())) {
        panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-menu>Menu</button></div>');
        panel.querySelector('[data-menu]').addEventListener('click', showMenu);
      }
    }
    updateHud();
  }

  // Today's results: your answers next to the most popular ones, with fresh counts.
  async function dailyResults(saved) {
    ui.hide();
    run = null;
    el.innerHTML = '<p class="ob-msg">Counting everyone\'s answers…</p>';
    const counts = await fetchCounts();
    const prompts = dailySet();
    const emoji = saved.results.map(x => x.tier < 0 ? '✖️' : ['⚪', '🟢', '🔵', '🟣', '🟡'][x.tier]).join('');
    const cards = prompts.map((p, k) => {
      const mine = saved.results[k];
      const c = counts?.[p.id] || {};
      // You count too, now that you've played.
      if (mine?.key) c[mine.key] = (c[mine.key] || 0) + 1;
      const n = Object.values(c).reduce((t, v) => t + v, 0);
      const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([key, v]) => `${esc(p.answers.find(a => a.key === key)?.show || key)} ${Math.round(v / n * 100)}%`);
      const fallback = p.answers.filter(a => a.group === 0).slice(0, 3).map(a => esc(a.show));
      const t = mine && mine.tier >= 0 ? TIERS[mine.tier] : null;
      const unique = mine?.key && c[mine.key] === 1 && n >= 10;
      if (unique) Arcade.flag('oddball-unique');
      return `<div class="ob-card" style="--c:${t ? t.color : '#5a2a30'}">
        <h3>${esc(p.q)}</h3>
        <div class="mine"><span>${mine?.key ? esc(mine.show) : '<i style="color:var(--muted)">No answer</i>'}</span><small>${t ? `${t.name} · +${mine.pts}` : '0'}${unique ? ' · only you!' : ''}</small></div>
        <div class="top">${n > 1 ? `Most said (${n} players): ${top.join(' · ')}` : `Expected: ${fallback.join(', ')}`}</div>
      </div>`;
    }).join('');
    el.innerHTML = `
      <div class="ob-total">Daily Oddball #${dailyNo()}<b>${saved.score ?? saved.results.reduce((t, r) => t + r.pts, 0)} pts</b><div class="ob-share">${emoji}</div></div>
      <div class="ob-cards">${cards}</div>
      ${counts ? '' : '<p class="ob-msg">Couldn\'t load everyone\'s answers, so these use our built-in guesses.</p>'}
      <p class="ob-msg">A new Oddball arrives at midnight.</p>
      <div class="ob-row"><button class="btn" type="button" data-free>Free play</button><button class="btn secondary" type="button" data-menu>Menu</button></div>`;
    el.querySelector('[data-free]').addEventListener('click', startFree);
    el.querySelector('[data-menu]').addEventListener('click', showMenu);
    updateHud();
  }

  // ---------- Menu ----------

  function menuHtml() {
    const saved = Arcade.load(DAILY_KEY, null);
    const doneToday = saved?.day === dayKey() && saved.done;
    const started = saved?.day === dayKey() && !saved.done && saved.results?.length;
    return `<p>Name something that fits, but think of what <b>nobody else</b> will. The rarer your right answer, the more it scores.</p>
      <div class="ob-tiers">${TIERS.map(t => `<span style="background:${t.color}">${t.name}<small>${t.pts} pts</small></span>`).join('')}</div>
      <p style="font-size:13px;color:var(--muted)">Six prompts, ${TIME} seconds each, one answer per prompt. Typos are fine; answers that don't fit cost ${WRONG_COST} seconds. Faster answers earn a small bonus.</p>
      <div class="menu"><button class="btn" type="button" data-daily>${doneToday ? `Today's results (#${dailyNo()})` : started ? `Finish today's Oddball (#${dailyNo()})` : `Play today's Oddball (#${dailyNo()})`}</button></div>
      <p style="font-size:12px;color:var(--muted);margin:4px 0 0">${doneToday ? `You scored ${saved.score} today. Come back tomorrow for a new set.` : 'Same six prompts for everyone today, scored against what everyone actually said.'}</p>`;
  }
  function wireMenu(panel) {
    panel.querySelector('[data-daily]').addEventListener('click', startDaily);
  }
  const intro = () => ({ title: '🟡 Oddball', html: menuHtml(), button: 'Free play', onAction: startFree, onRender: wireMenu });
  function showMenu() {
    clearInterval(timer);
    run = null;
    el.innerHTML = '';
    ui.show(intro());
    updateHud();
  }

  // Enter moves on from a reveal even when focus has wandered.
  addEventListener('keydown', e => {
    if (e.key === 'Enter' && run?.phase === 'reveal' && document.activeElement?.tagName !== 'BUTTON') {
      e.preventDefault();
      el.querySelector('[data-next]')?.click();
    }
  });

  updateHud();
  Versus.attach({ ui, start: startFree, score: () => run?.score || 0, intro: intro() });
  // Exposed for tests: the matcher against a prompt id.
  window.__oddball = { match: (id, text) => match(PROMPTS.find(p => p.id === id), text), PROMPTS, dailySet, rarity };
})();
