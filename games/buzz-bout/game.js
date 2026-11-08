(() => {
  const ID = 'buzz-bout';
  const LIMIT = 15;          // seconds to answer in a match
  const REVEAL_MS = 2800;    // how long the answer stays up
  const DECIDE = 15;         // seconds to pick a category or a wager before one is picked for you
  const SEEN_KEY = 'buzz:seen', DAILY_KEY = 'buzz:daily';
  const COLORS = ['#ffc53d', '#4f8cff'];
  const CATS = {
    science: ['Science', '🔬'], space: ['Space', '🪐'], geography: ['Geography', '🌍'], history: ['History', '🏛️'],
    words: ['Words', '📖'], animals: ['Animals', '🐾'], sports: ['Sports & games', '⚽'], general: ['Mixed bag', '🎲'], math: ['Math', '➗'],
  };
  const CAT_KEYS = Object.keys(CATS);
  // Difficulty of the three questions in each drafted block of a match.
  const BLOCK_DIFF = [[1, 1, 2], [1, 2, 2], [2, 2, 3]];

  const ui = Arcade.overlay(document.getElementById('overlay'));
  const board = document.getElementById('bz');
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- Question bank ----------

  const BANK = {};
  for (const [cat, text] of Object.entries(window.BUZZ_OWN || {})) {
    BANK[cat] = text.trim().split('\n').map((line, i) => {
      const p = line.split('|');
      return { id: `${cat}:o${i}`, q: p[0], a: p.slice(1, 5), d: +p[5] };
    });
  }
  for (const [cat, list] of Object.entries(window.BUZZ_OTDB || {})) {
    BANK[cat] = (BANK[cat] || []).concat(list.map((x, i) => ({ id: `${cat}:t${i}`, q: x[0], a: x.slice(1, 5), d: x[5] })));
  }

  function seeded(s) {
    let a = s >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const shuffle = (arr, r = Math.random) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Math questions are made on the spot, so the answer is always right.
  function mathQ(r, d) {
    const int = (a, b) => a + Math.floor(r() * (b - a + 1));
    const kind = int(0, 3);
    let q, ans;
    if (d <= 1) {
      if (kind === 0) { const a = int(12, 89), b = int(11, 79); q = `${a} + ${b}`; ans = a + b; }
      else if (kind === 1) { const a = int(40, 150), b = int(11, a - 5); q = `${a} − ${b}`; ans = a - b; }
      else if (kind === 2) { const a = int(3, 12), b = int(3, 12); q = `${a} × ${b}`; ans = a * b; }
      else { const b = int(3, 12); ans = int(3, 12); q = `${b * ans} ÷ ${b}`; }
      q = `What is ${q}?`;
    } else if (d === 2) {
      if (kind === 0) { const a = int(13, 49), b = int(3, 9); q = `What is ${a} × ${b}?`; ans = a * b; }
      else if (kind === 1) { const p = [10, 20, 25, 50, 75][int(0, 4)], n = int(2, 20) * 20; q = `What is ${p}% of ${n}?`; ans = (p * n) / 100; }
      else if (kind === 2) { const n = int(11, 20); q = `What is ${n} squared?`; ans = n * n; }
      else { const a = int(2, 9), b = int(2, 9), c = int(2, 20); q = `What is ${c} + ${a} × ${b}?`; ans = c + a * b; }
    } else {
      if (kind === 0) { const n = int(13, 25); q = `What is the square root of ${n * n}?`; ans = n; }
      else if (kind === 1) {
        const den = [3, 4, 5, 8][int(0, 3)];
        let num = int(1, den - 1);
        if (den % num === 0 && num > 1) num = 1; // keep the fraction in lowest terms (2/4, 4/8 → 1/den)
        if (den === 8 && num % 2 === 0) num--;
        const n = den * int(4, 15);
        q = `What is ${num}/${den} of ${n}?`;
        ans = (num * n) / den;
      } else if (kind === 2) { const e = int(5, 10); q = `What is 2 to the power of ${e}?`; ans = 2 ** e; }
      else { const a = int(12, 39), b = int(12, 39); q = `What is ${a} × ${b}?`; ans = a * b; }
    }
    const near = [1, -1, 2, -2, 10, -10, 5, -5, Math.max(3, Math.round(ans * 0.1)), -Math.max(3, Math.round(ans * 0.1))];
    const wrong = [];
    for (const o of shuffle(near, r)) {
      const v = ans + o;
      if (v > 0 && v !== ans && !wrong.includes(v)) wrong.push(v);
      if (wrong.length === 3) break;
    }
    return { id: `math:${q}`, q, a: [ans, ...wrong].map(String), d };
  }

  let seen = new Set(Arcade.load(SEEN_KEY, []));
  function markSeen(q) {
    if (q.id.startsWith('math:')) return;
    seen.add(q.id);
    const list = [...seen].slice(-400);
    seen = new Set(list);
    Arcade.save(SEEN_KEY, list);
  }

  // Picks a question. `fresh` prefers ones this device hasn't shown lately; online and daily
  // games skip that so both players (or everyone that day) get the same questions.
  function pickQ(cat, d, r, used, fresh) {
    if (cat === 'math' || !BANK[cat]) return mathQ(r, d);
    const pool = BANK[cat].filter(q => !used.has(q.id));
    let list = pool.filter(q => q.d === d);
    if (!list.length) list = pool.filter(q => Math.abs(q.d - d) <= 1);
    if (!list.length) list = pool.length ? pool : BANK[cat];
    if (fresh) {
      const unseen = list.filter(q => !seen.has(q.id));
      if (unseen.length) list = unseen;
    }
    const q = list[Math.floor(r() * list.length)];
    used.add(q.id);
    return q;
  }

  // ---------- Shared state ----------

  let mode = null;   // 'cpu' | 'local' | 'online'
  let solo = null;   // 'streak' | 'daily' for the solo modes
  let me = 0, names = ['You', 'Computer'], first = 0;
  let G = null;      // the current game
  let timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const every = (fn, ms) => { const t = setInterval(fn, ms); timers.push(t); return t; };
  function clearTimers() { timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers = []; }

  const readMs = q => clamp(500 + q.q.length * 25, 1000, 3500);
  // 100 points for a right answer, plus up to 100 for speed (full bonus inside 1.5 s).
  const speedBonus = (ms, limitMs) => Math.round(100 * clamp((limitMs - ms) / (limitMs - 1500), 0, 1));
  const local = () => mode === 'local';
  const isMine = p => mode === 'local' || p === me;

  // ---------- Matches (vs computer, same device, online) ----------

  function startMatch(seed) {
    clearTimers();
    G = {
      kind: 'match', seed, block: 0, qi: 0, qs: [], cats: [], used: new Set(), score: [0, 0], right: [0, 0],
      ans: [null, null], wager: [null, null], phase: 'draft', picker: 0, offers: [], cur: null, gained: [0, 0],
      inCat: {}, inAns: {}, inWager: null, limitMs: LIMIT * 1000,
    };
    startBlock(0);
  }

  function startBlock(b) {
    clearTimers();
    G.block = b;
    G.phase = 'draft';
    G.picker = (b + first) % 2;
    const r = seeded(G.seed + 31 * (b + 1));
    G.offers = shuffle(CAT_KEYS.filter(c => !G.cats.includes(c)), r).slice(0, 3);
    G.deadline = Date.now() + DECIDE * 1000;
    render();
    if (mode === 'cpu' && G.picker === 1) later(() => chooseCat(G.offers[Math.floor(Math.random() * 3)]), 1400);
    // Whoever picks has a time limit; when it runs out the first category is taken.
    if (isMine(G.picker)) later(() => { if (G.phase === 'draft' && G.block === b) chooseCat(G.offers[0]); }, DECIDE * 1000);
    every(() => { if (G.phase === 'draft') renderClock(); }, 250);
    pump();
  }

  function chooseCat(cat) {
    if (G.phase !== 'draft' || !G.offers.includes(cat)) return;
    if (mode === 'online' && G.picker === me) Match.move({ k: 'cat', b: G.block, cat });
    G.cats.push(cat);
    const r = seeded(G.seed + 1000 + G.block * 77 + CAT_KEYS.indexOf(cat));
    for (const d of BLOCK_DIFF[G.block]) G.qs.push({ ...pickQ(cat, d, r, G.used, mode !== 'online'), cat });
    Arcade.tone({ freq: 660, dur: 0.08, type: 'triangle', vol: 0.05 });
    ask(G.block * 3);
  }

  function ask(qi) {
    clearTimers();
    G.qi = qi;
    const q = G.qs[qi];
    G.cur = q;
    // Answer order is shuffled on each screen; answers are sent as the bank's index (0 = right).
    G.order = shuffle([0, 1, 2, 3]);
    G.ans = [null, null];
    G.gained = [0, 0];
    G.phase = 'read';
    if (mode !== 'online') markSeen(q);
    render();
    later(() => {
      G.phase = 'answer';
      G.shownAt = performance.now();
      render();
      every(renderClock, 100);
      later(() => {
        for (const p of [0, 1]) if (isMine(p) && G.ans[p] === null) submit(p, -1, G.limitMs);
      }, G.limitMs);
      if (mode === 'cpu') cpuAnswer();
      pump();
    }, readMs(q));
    pump();
  }

  function cpuAnswer() {
    const q = G.cur;
    const odds = [0.82, 0.66, 0.5][(q.d || 2) - 1];
    const ms = clamp(2000 + Math.random() * 7000 + q.q.length * 15, 1500, G.limitMs - 500);
    const pick = Math.random() < odds ? 0 : 1 + Math.floor(Math.random() * 3);
    later(() => submit(1, pick, ms), ms);
  }

  // Locks in player p's answer (the bank index, or -1 for no answer) and how long it took.
  function submit(p, i, ms) {
    if (!G || G.kind !== 'match' || G.ans[p] !== null || (G.phase !== 'answer' && G.phase !== 'read')) return;
    if (G.phase === 'read' && isMine(p)) return; // answers aren't up yet
    G.ans[p] = { i, ms: Math.round(ms) };
    if (mode === 'online' && p === me) Match.move({ k: 'ans', qi: G.qi, i, ms: Math.round(ms) });
    if (isMine(p)) Arcade.tone({ freq: 440, dur: 0.05, type: 'square', vol: 0.03 });
    if (G.ans[0] && G.ans[1]) reveal();
    else render();
  }

  function reveal() {
    clearTimers();
    G.phase = 'reveal';
    const final = G.qi === 9;
    for (const p of [0, 1]) {
      const a = G.ans[p];
      const right = a.i === 0;
      let pts = right ? 100 + speedBonus(a.ms, G.limitMs) : 0;
      if (final) pts += right ? G.wager[p] : -G.wager[p];
      G.gained[p] = pts;
      G.score[p] = Math.max(0, G.score[p] + pts);
      if (right) G.right[p]++;
    }
    const mineRight = mode === 'local' ? null : G.ans[me].i === 0;
    if (mineRight === true || (mineRight === null && (G.ans[0].i === 0 || G.ans[1].i === 0))) Arcade.tone({ freq: 523, to: 784, dur: 0.18, type: 'triangle', vol: 0.06 });
    else Arcade.tone({ freq: 196, dur: 0.22, type: 'square', vol: 0.04 });
    render();
    later(() => {
      if (G.qi === 9) return endMatch();
      if (G.qi === 8) return startWager();
      if (G.qi % 3 === 2) return startBlock(G.block + 1);
      ask(G.qi + 1);
    }, REVEAL_MS);
  }

  // Before the last question each player bets nothing, a quarter or half of their points.
  const wagerOptions = p => [0, Math.floor(G.score[p] / 40) * 10, Math.floor(G.score[p] / 20) * 10];

  function startWager() {
    clearTimers();
    G.phase = 'wager';
    G.wager = [null, null];
    G.behind = mode === 'local' ? null : G.score[me] < G.score[1 - me];
    const r = seeded(G.seed + 5000);
    const cat = CAT_KEYS[Math.floor(r() * CAT_KEYS.length)];
    G.qs[9] = { ...pickQ(cat, 3, r, G.used, mode !== 'online'), cat };
    G.deadline = Date.now() + DECIDE * 1000;
    render();
    if (mode === 'cpu') later(() => setWager(1, wagerOptions(1)[G.score[1] < G.score[0] ? 2 : 1]), 1200);
    later(() => { for (const p of [0, 1]) if (isMine(p) && G.wager[p] === null) setWager(p, 0); }, DECIDE * 1000);
    every(renderClock, 250);
    pump();
  }

  function setWager(p, w) {
    if (!G || G.phase !== 'wager' || G.wager[p] !== null) return;
    G.wager[p] = clamp(Math.round(w) || 0, 0, Math.floor(G.score[p] / 2));
    if (mode === 'online' && p === me) Match.move({ k: 'wager', w: G.wager[p] });
    if (G.wager[0] !== null && G.wager[1] !== null) ask(9);
    else render();
  }

  // Applies anything the other player sent before this screen was ready for it.
  function pump() {
    if (!G || G.kind !== 'match' || mode !== 'online') return;
    const opp = 1 - me;
    if (G.phase === 'draft' && G.picker === opp && G.inCat[G.block] != null) {
      const c = G.inCat[G.block];
      delete G.inCat[G.block];
      chooseCat(G.offers.includes(c) ? c : G.offers[0]);
    } else if ((G.phase === 'read' || G.phase === 'answer') && G.ans[opp] === null && G.inAns[G.qi]) {
      const a = G.inAns[G.qi];
      delete G.inAns[G.qi];
      submit(opp, a.i, a.ms);
    } else if (G.phase === 'wager' && G.wager[opp] === null && G.inWager != null) {
      const w = G.inWager;
      G.inWager = null;
      setWager(opp, w);
    }
  }

  function onMove(d) {
    if (!G || G.kind !== 'match') return;
    if (d.k === 'cat' && CATS[d.cat]) G.inCat[d.b | 0] = d.cat;
    else if (d.k === 'ans') G.inAns[d.qi | 0] = { i: clamp(d.i | 0, -1, 3), ms: clamp(+d.ms || G.limitMs, 0, G.limitMs) };
    else if (d.k === 'wager') G.inWager = Math.max(0, d.w | 0);
    pump();
  }

  function endMatch() {
    clearTimers();
    G.phase = 'done';
    render();
    const [a, b] = G.score;
    const winner = a === b ? -1 : a > b ? 0 : 1;
    if (mode !== 'local') {
      if (G.right[me] === 10) Arcade.flag('buzz-bout-perfect');
      if (G.behind && winner === me) Arcade.flag('buzz-bout-wager');
    }
    const lines = [
      `${esc(names[0])}: ${a.toLocaleString()} points (${G.right[0]}/10 right)`,
      `${esc(names[1])}: ${b.toLocaleString()} points (${G.right[1]}/10 right)`,
    ];
    later(() => Match.over({ winner, score: mode === 'cpu' ? a : 0, lines }), 600);
  }

  // ---------- Solo: Streak and Daily 10 ----------

  function startStreak() {
    clearTimers();
    G = { kind: 'streak', score: 0, streak: 0, best: 0, right: 0, strikes: 0, used: new Set(), phase: 'read', cur: null, ans: null, gained: 0 };
    nextSolo();
  }

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function startDaily() {
    clearTimers();
    const day = today();
    let h = 0;
    for (const c of day) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
    const r = seeded(h);
    const cats = shuffle(CAT_KEYS, r);
    const used = new Set();
    const qs = [1, 1, 1, 2, 2, 2, 2, 3, 3, 3].map((d, i) => ({ ...pickQ(cats[i % cats.length], d, r, used, false), cat: cats[i % cats.length] }));
    const done = Arcade.load(DAILY_KEY, null);
    G = { kind: 'daily', qs, n: 0, score: 0, right: 0, phase: 'read', cur: null, ans: null, gained: 0, practice: done?.day === day, doneScore: done?.score };
    nextSolo();
  }

  const streakMult = () => 1 + 0.5 * Math.min(4, Math.floor(G.streak / 5));
  const soloLimit = () => (G.kind === 'streak' ? Math.max(7, 15 - G.right * 0.25) : LIMIT) * 1000;

  function nextSolo() {
    clearTimers();
    let q;
    if (G.kind === 'streak') {
      const n = G.right;
      const d = n < 5 ? 1 : n < 12 ? (Math.random() < 0.5 ? 1 : 2) : n < 20 ? 2 : Math.random() < 0.5 ? 2 : 3;
      const cat = CAT_KEYS[Math.floor(Math.random() * CAT_KEYS.length)];
      q = { ...pickQ(cat, d, Math.random, G.used, true), cat };
      markSeen(q);
    } else {
      if (G.n >= G.qs.length) return endSolo();
      q = G.qs[G.n++];
    }
    G.cur = q;
    G.order = shuffle([0, 1, 2, 3]);
    G.ans = null;
    G.limitMs = soloLimit();
    G.phase = 'read';
    render();
    later(() => {
      G.phase = 'answer';
      G.shownAt = performance.now();
      render();
      every(renderClock, 100);
      later(() => soloAnswer(-1, G.limitMs), G.limitMs);
    }, readMs(q));
  }

  function soloAnswer(i, ms) {
    if (!G || G.phase !== 'answer' || G.ans) return;
    clearTimers();
    G.ans = { i, ms };
    G.phase = 'reveal';
    const right = i === 0;
    if (right) {
      G.right++;
      G.streak++;
      G.best = Math.max(G.best || 0, G.streak || 0);
      G.gained = Math.round((100 + speedBonus(ms, G.limitMs)) * (G.kind === 'streak' ? streakMult() : 1));
      G.score += G.gained;
      Arcade.tone({ freq: 523, to: 784, dur: 0.18, type: 'triangle', vol: 0.06 });
      if (G.kind === 'streak' && G.streak >= 15) Arcade.flag('buzz-bout-streak');
    } else {
      G.gained = 0;
      G.streak = 0;
      if (G.kind === 'streak') G.strikes++;
      Arcade.tone({ freq: 196, dur: 0.22, type: 'square', vol: 0.04 });
    }
    render();
    later(() => {
      if (G.kind === 'streak' && G.strikes >= 3) endSolo();
      else nextSolo();
    }, right ? 1800 : REVEAL_MS);
  }

  function endSolo() {
    clearTimers();
    G.phase = 'done';
    render();
    if (G.kind === 'streak') {
      return Arcade.finish(ui, {
        score: G.score,
        title: 'Three strikes!',
        lines: [`${G.right} right · longest streak ${G.best || 0}`],
        button: 'Menu',
        onAction: () => Match.menu(),
      });
    }
    if (G.right === 10) Arcade.flag('buzz-bout-perfect');
    if (G.practice) {
      return ui.show({
        title: 'Daily 10 (practice)',
        html: `<p class="big">${G.score.toLocaleString()}</p><p>${G.right}/10 right. You already played today's Daily 10 (you scored ${(G.doneScore || 0).toLocaleString()}), so this run doesn't count. New questions tomorrow!</p>`,
        button: 'Menu',
        onAction: () => Match.menu(),
      });
    }
    Arcade.save(DAILY_KEY, { day: today(), score: G.score });
    Arcade.flag('buzz-bout-daily');
    Arcade.finish(ui, { score: G.score, title: 'Daily 10 done', lines: [`${G.right}/10 right. Come back tomorrow for ten new questions.`], button: 'Menu', onAction: () => Match.menu() });
  }

  // ---------- Input ----------

  // Player p picks the answer shown in slot `slot` (0-3) on this screen.
  function pickSlot(p, slot, at = performance.now()) {
    if (!G || G.phase !== 'answer') return;
    const i = G.order[slot];
    const ms = clamp(at - G.shownAt, 0, G.limitMs);
    if (G.kind === 'match') submit(p, i, ms);
    else soloAnswer(i, ms);
  }

  window.addEventListener('keydown', e => {
    if (!$('overlay').hidden || e.repeat || !G) return;
    const k = e.code;
    const p1 = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(k) >= 0 ? ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(k) : ['KeyA', 'KeyB', 'KeyC', 'KeyD'].indexOf(k);
    const p2 = ['Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(k);
    const keyP = local() ? (p1 >= 0 && /^Digit/.test(k) ? 0 : p2 >= 0 ? 1 : -1) : p1 >= 0 ? me : -1;
    const n = keyP === 1 ? p2 : p1;
    if (keyP < 0 || n < 0) return;
    if (G.phase === 'answer') pickSlot(keyP, n, e.timeStamp || performance.now());
    else if (G.kind === 'match' && G.phase === 'draft' && n < 3 && isMine(G.picker) && (!local() || keyP === G.picker)) chooseCat(G.offers[n]);
    else if (G.kind === 'match' && G.phase === 'wager' && n < 3 && isMine(keyP)) setWager(keyP, wagerOptions(keyP)[n]);
  });

  board.addEventListener('click', e => {
    if (!G) return;
    const ans = e.target.closest('[data-slot]');
    if (ans) {
      const slot = +ans.dataset.slot;
      let p = me;
      // Same device: the left half of an answer is player 1's, the right half player 2's.
      if (local()) { const r = ans.getBoundingClientRect(); p = e.clientX - r.left < r.width / 2 ? 0 : 1; }
      if (G.kind !== 'match') p = 0;
      return pickSlot(p, slot, e.timeStamp || performance.now());
    }
    const cat = e.target.closest('[data-cat]');
    if (cat && G.phase === 'draft' && isMine(G.picker)) return chooseCat(cat.dataset.cat);
    const w = e.target.closest('[data-wager]');
    if (w) { const p = +w.dataset.p; if (isMine(p)) setWager(p, wagerOptions(p)[+w.dataset.wager]); }
  });

  // ---------- Drawing ----------

  function head() {
    if (G.kind !== 'match') {
      const strikes = G.kind === 'streak' ? `<span class="bz-strikes">${'✕'.repeat(G.strikes)}<i>${'✕'.repeat(3 - G.strikes)}</i></span>` : '';
      return `<div class="bz-head solo">
        <div class="bz-chip" style="--c:${COLORS[0]}"><span>Score</span><b>${G.score.toLocaleString()}</b></div>
        <div class="bz-chip" style="--c:${COLORS[1]}"><span>${G.kind === 'streak' ? `Streak${streakMult() > 1 ? ` · ×${streakMult()}` : ''}` : 'Question'}</span><b>${G.kind === 'streak' ? G.streak : `${G.n} / 10`}</b></div>
        ${strikes}
      </div>`;
    }
    return `<div class="bz-head">${[0, 1].map(p => `<div class="bz-chip" style="--c:${COLORS[p]}">
        <span>${esc(names[p])}${mode === 'online' && p === me ? ' (you)' : ''}</span><b>${G.score[p].toLocaleString()}</b>
        ${G.phase === 'reveal' ? `<em class="${G.gained[p] > 0 ? 'up' : G.gained[p] < 0 ? 'down' : ''}">${G.gained[p] > 0 ? '+' : ''}${G.gained[p]}</em>` : ''}
      </div>`).join('<div class="bz-vs">vs</div>')}</div>`;
  }

  function meta() {
    if (G.kind === 'match') {
      const label = G.phase === 'draft' ? `Round ${G.block + 1} of 3` : G.phase === 'wager' || G.qi === 9 ? 'Final question' : `Question ${G.qi + 1} of 10`;
      const cat = G.cur && G.phase !== 'draft' && G.phase !== 'wager' ? ` · ${CATS[G.cur.cat][1]} ${CATS[G.cur.cat][0]}` : '';
      return `${label}${cat}`;
    }
    return G.cur ? `${CATS[G.cur.cat][1]} ${CATS[G.cur.cat][0]}${G.kind === 'daily' ? ` · Daily 10 for ${today()}${G.practice ? ' (practice)' : ''}` : ''}` : '';
  }

  function render() {
    if (!G) { board.innerHTML = ''; return; }
    if (mode === 'online') names = Match.names.slice(); // the other player's name arrives after the start
    let body = '';
    if (G.phase === 'draft') {
      const mine = isMine(G.picker);
      const who = mode === 'local' ? `${esc(names[G.picker])}, pick a category` : mine ? 'Pick a category' : `${esc(names[G.picker])} is picking a category…`;
      body = `<div class="bz-q">${who}</div>
        <div class="bz-cats">${G.offers.map((c, n) => `<button class="bz-cat" type="button" data-cat="${c}" ${mine ? '' : 'disabled'}>
          <span>${CATS[c][1]}</span>${CATS[c][0]}${mine && !('ontouchstart' in window) ? `<kbd>${local() && G.picker === 1 ? 7 + n : n + 1}</kbd>` : ''}</button>`).join('')}</div>
        <div class="bz-status">The next three questions come from this category. <span data-clock></span></div>`;
    } else if (G.phase === 'wager') {
      const rows = [0, 1].filter(p => isMine(p)).map(p => {
        const opts = wagerOptions(p);
        const labels = ['Bet nothing', 'Bet a quarter', 'Bet half'];
        return `<div class="bz-wager">${local() ? `<b style="color:${COLORS[p]}">${esc(names[p])}</b>` : ''}
          ${G.wager[p] !== null ? `<p>Locked in: <b>${G.wager[p]}</b> points</p>` : opts.map((w, n) => `<button class="bz-cat" type="button" data-wager="${n}" data-p="${p}">${labels[n]}<small>${w} pts</small>${'ontouchstart' in window ? '' : `<kbd>${p === 1 && local() ? 7 + n : n + 1}</kbd>`}</button>`).join('')}</div>`;
      }).join('');
      body = `<div class="bz-q">Final question! Bet some of your points</div>
        <p class="bz-sub">Get it right and you win your bet on top of the usual points. Get it wrong and you lose it.</p>
        ${rows}
        <div class="bz-status">${mode !== 'local' && G.wager[me] !== null ? 'Waiting for your opponent…' : ''} <span data-clock></span></div>`;
    } else if (G.cur) {
      const q = G.cur;
      const show = G.phase !== 'read';
      const reveal = G.phase === 'reveal' || G.phase === 'done';
      const picks = G.kind === 'match' ? G.ans : [G.ans, null];
      const answers = G.order.map((i, slot) => {
        const by = [0, 1].filter(p => picks[p] && picks[p].i === i && (reveal || isMine(p)));
        const cls = reveal ? (i === 0 ? 'right' : by.length ? 'wrong' : 'dim') : by.length ? 'locked' : '';
        const keys = 'ontouchstart' in window ? '' : local() && G.kind === 'match' ? `<kbd>${slot + 1}</kbd><kbd class="p2">${(slot + 7) % 10}</kbd>` : `<kbd>${slot + 1}</kbd>`;
        const tags = G.kind === 'match' ? by.map(p => `<i style="background:${COLORS[p]}">${mode === 'online' ? (p === me ? 'You' : 'Them') : esc(names[p]).slice(0, 10)}</i>`).join('') : '';
        return `<button class="bz-ans ${cls}" type="button" data-slot="${slot}" ${show ? '' : 'disabled'}>${keys}<span>${esc(q.a[i])}</span>${tags}</button>`;
      }).join('');
      let status = '';
      if (G.phase === 'read') status = 'Get ready…';
      else if (G.phase === 'answer' && G.kind === 'match') {
        if (mode === 'local') status = [0, 1].map(p => `${esc(names[p])}: ${G.ans[p] ? 'locked in ✓' : 'thinking…'}`).join(' · ');
        else status = G.ans[me] ? `Locked in. ${G.ans[1 - me] ? '' : `Waiting for ${esc(names[1 - me])}…`}` : G.ans[1 - me] ? `${esc(names[1 - me])} has locked in!` : '';
      } else if (reveal && G.kind !== 'match') {
        status = G.ans.i === 0 ? `Right! +${G.gained}` : G.ans.i === -1 ? `Time's up! The answer was ${esc(q.a[0])}.` : `Not quite. The answer was ${esc(q.a[0])}.`;
      } else if (reveal && G.qi === 9) {
        status = [0, 1].map(p => `${esc(names[p])} bet ${G.wager[p]}`).join(' · ');
      }
      body = `<div class="bz-bar"><i data-bar style="width:${G.phase === 'answer' ? 100 : G.phase === 'read' ? 100 : 0}%"></i></div>
        <div class="bz-q">${esc(q.q)}</div>
        <div class="bz-answers ${show ? '' : 'hidden'}">${answers}</div>
        <div class="bz-status">${status}</div>`;
    }
    board.innerHTML = `${head()}<div class="bz-meta">${meta()}</div>${body}
      ${G.kind === 'match' && Match.label() ? `<div class="bz-foot">${esc(Match.label())}</div>` : ''}
      ${local() && G.phase === 'answer' ? `<div class="bz-foot">${esc(names[0])}: keys 1–4 or the left half of an answer · ${esc(names[1])}: keys 7, 8, 9, 0 or the right half</div>` : ''}`;
    updateStats();
  }

  function renderClock() {
    if (!G) return;
    const bar = board.querySelector('[data-bar]');
    if (bar && G.phase === 'answer') {
      const left = 1 - (performance.now() - G.shownAt) / G.limitMs;
      bar.style.width = `${clamp(left, 0, 1) * 100}%`;
      bar.classList.toggle('low', left < 0.25);
    }
    const clock = board.querySelector('[data-clock]');
    if (clock && G.deadline) clock.textContent = `${Math.max(0, Math.ceil((G.deadline - Date.now()) / 1000))} s`;
  }

  function updateStats() {
    if (!G) return;
    const mine = mode === 'online' ? me : 0;
    $('s1').textContent = (G.kind === 'match' ? G.score[mine] : G.score).toLocaleString();
    $('s2').textContent = G.kind === 'match' ? G.score[1 - mine].toLocaleString() : G.kind === 'streak' ? G.streak : '-';
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  // ---------- Setup ----------

  Match.setup({
    ui,
    tag: 'buzzbout',
    title: 'Buzz Bout',
    levels: ['Streak', 'Daily 10', 'Vs computer'],
    winFlag: 'buzz-bout-win',
    onlineWinFlag: 'buzz-bout-online-win',
    rules: `<ul style="text-align:left">
      <li><b>Matches:</b> 10 questions. You both answer every question at once: <b>100 points</b> for a right answer plus up to <b>100 more</b> for speed.</li>
      <li>Players take turns picking the category for each round of three. Before the final question, you can bet up to half your points.</li>
      <li><b>Streak:</b> keep answering until your third wrong answer. Every five in a row raises your multiplier.</li>
      <li><b>Daily 10:</b> the same ten questions for everyone today.</li>
      <li>Answer with keys <b>1–4</b> or by clicking. On one device, the second player uses <b>7, 8, 9, 0</b>.</li>
    </ul>
    <p style="font-size:12px">Some questions come from the <a href="https://opentdb.com" target="_blank" rel="noopener">Open Trivia Database</a> (CC BY-SA 4.0).</p>`,
    startData: () => ({ seed: Math.floor(Math.random() * 2 ** 31) }),
    onStart: s => {
      clearTimers();
      mode = s.mode;
      me = s.me;
      first = s.first;
      solo = null;
      if (mode === 'cpu' && s.level === 0) { solo = 'streak'; names = ['You', '']; return startStreak(); }
      if (mode === 'cpu' && s.level === 1) { solo = 'daily'; names = ['You', '']; return startDaily(); }
      names = mode === 'cpu' ? ['You', 'Computer'] : s.names;
      startMatch(mode === 'online' ? (s.data?.seed | 0) : Math.floor(Math.random() * 2 ** 31));
    },
    onMove,
    onStop: () => { clearTimers(); if (G) G.phase = 'done'; },
  });
})();
