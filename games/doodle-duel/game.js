/* Doodle Duel: one player draws a word, the other guesses it. The drawer picks one of three
   words and has 80 seconds; letters of the word show up as hints along the way. A right guess
   scores for both: more the faster it comes. Six rounds, taking turns. Play online (strokes are
   sent live as they're drawn) or pass one device back and forth. */
(() => {
  const ID = 'doodle-duel';
  const CW = 800, CH = 500, ROUNDS = 6, TIME = 80;
  const COLORS = ['#1b1b2a', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41', '#ff80ab', '#ffffff'];
  const SIZES = [3, 7, 14, 26];
  const $ = id => document.getElementById(id);
  const overlayEl = $('overlay');
  const ui = Arcade.overlay(overlayEl);
  const canvas = $('game'), paper = $('paper');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = CW * dpr; canvas.height = CH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const norm = s => String(s).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const W = window.DOODLE_WORDS;

  // m: the match. players[i] = { name, score }; me = my index (both in a local game: -1).
  let peek = false;
  let m = null, strokes = [], cur = null, color = COLORS[0], size = SIZES[1], eraser = false, tick = null;

  // ---------- Drawing ----------

  function redraw() {
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, CW, CH);
    for (const s of strokes) drawStroke(s, 0);
  }
  function drawStroke(s, from) {
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w;
    const p = s.p;
    if (p.length <= 2) { ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath();
    const k = Math.max(0, from - 2);
    ctx.moveTo(p[k], p[k + 1]);
    for (let i = k + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }

  const iDraw = () => m && m.phase === 'draw' && (m.local || m.drawer === m.me);
  const toCanvas = e => { const r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * CW / r.width), Math.round((e.clientY - r.top) * CH / r.height)]; };
  canvas.addEventListener('pointerdown', e => {
    if (!iDraw()) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const [x, y] = toCanvas(e);
    cur = { c: eraser ? '#fffdf7' : color, w: eraser ? size * 2 : size, p: [x, y] };
    strokes.push(cur);
    drawStroke(cur, 0);
    cur.sent = 0;
  });
  canvas.addEventListener('pointermove', e => {
    if (!cur) return;
    const [x, y] = toCanvas(e), p = cur.p;
    if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 2) return;
    p.push(x, y);
    drawStroke(cur, p.length - 4);
  });
  const endStroke = () => { if (cur) { flush(); cur = null; } };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  // Online, new points go out in small batches.
  function flush() {
    if (!m || m.local || !cur) return;
    const p = cur.p;
    if (cur.sent >= p.length) return;
    live.send('st', { i: strokes.indexOf(cur), c: cur.c, w: cur.w, p: p.slice(cur.sent) });
    cur.sent = p.length;
  }
  setInterval(flush, 60);

  function undo() {
    if (!iDraw() || !strokes.length) return;
    strokes.pop(); cur = null; redraw();
    if (!m.local) live.send('undo', { n: strokes.length });
  }
  function clearAll() {
    if (!iDraw()) return;
    strokes = []; cur = null; redraw();
    if (!m.local) live.send('clear', {});
  }

  function buildTools() {
    const t = $('tools');
    t.innerHTML = COLORS.map(c => `<button type="button" data-c="${c}" style="background:${c};${c === '#ffffff' ? 'border-color:#ccc' : ''}" title="Colour"></button>`).join('')
      + SIZES.map(s => `<button type="button" class="size" data-s="${s}" title="Brush size"><i style="width:${Math.min(20, s)}px;height:${Math.min(20, s)}px"></i></button>`).join('')
      + '<button type="button" class="wide" data-er>Eraser</button><button type="button" class="wide" data-undo>Undo (Z)</button><button type="button" class="wide" data-clear>Clear</button>';
    const mark = () => {
      t.querySelectorAll('[data-c]').forEach(b => b.classList.toggle('on', !eraser && b.dataset.c === color));
      t.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('on', +b.dataset.s === size));
      t.querySelector('[data-er]').classList.toggle('on', eraser);
    };
    t.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => { color = b.dataset.c; eraser = false; mark(); }));
    t.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { size = +b.dataset.s; mark(); }));
    t.querySelector('[data-er]').addEventListener('click', () => { eraser = !eraser; mark(); });
    t.querySelector('[data-undo]').addEventListener('click', undo);
    t.querySelector('[data-clear]').addEventListener('click', clearAll);
    mark();
  }
  addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT' && e.code === 'KeyZ') undo(); });

  // ---------- Match ----------

  function newMatch(local, names, me) {
    m = { local, me, players: names.map(n => ({ name: n, score: 0 })), r: -1, phase: 'idle', drawn: [0, 0], quick: false };
    strokes = []; redraw();
    $('log').innerHTML = '';
    nextRound();
  }

  // Round r: player 0 draws the even ones.
  function nextRound() {
    m.r++;
    if (m.r >= ROUNDS) return endMatch();
    m.drawer = m.r % 2;
    m.phase = 'pick';
    m.word = null; m.mask = ''; m.guessed = false;
    strokes = []; redraw();
    render();
    if (m.local) {
      const guesser = m.players[1 - m.drawer].name;
      banner(`${esc(m.players[m.drawer].name)} draws this round.<br><small style="font-size:15px;font-weight:600">${esc(guesser)}, look away while they pick a word!</small>`);
      ui.show({ title: `Round ${m.r + 1} of ${ROUNDS}`, html: `<p><b>${esc(m.players[m.drawer].name)}</b>, it's your turn to draw.</p><p>${esc(guesser)}: no peeking!</p>`, button: 'Show me the words', onAction: pickPanel });
    } else if (m.drawer === m.me) pickPanel();
    else banner(`${esc(m.players[m.drawer].name)} is picking a word…`);
  }

  function choices() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const seen = new Set();
    return ['easy', 'medium', 'hard'].map(k => { let w; do { w = pick(W[k]); } while (seen.has(w)); seen.add(w); return { w, k }; });
  }
  function pickPanel() {
    const opts = choices();
    ui.show({
      title: 'Pick a word to draw',
      html: `<p style="font-size:13px;color:var(--muted)">Harder words score more if they get it.</p><div class="dd-picks">${opts.map((o, i) => `<button class="btn ${i ? 'secondary' : ''}" type="button" data-w="${i}">${esc(o.w)} <small style="opacity:.7">· ${o.k}</small></button>`).join('')}</div>`,
      button: null,
      onRender: p => p.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => { ui.hide(); startDrawing(opts[+b.dataset.w]); })),
    });
  }

  const maskOf = (w, shown) => [...w].map((c, i) => (c === ' ' ? '  ' : shown.has(i) ? c.toUpperCase() : '_')).join(' ');
  function startDrawing(o) {
    m.word = o.w; m.kind = o.k; m.shown = new Set();
    m.mask = maskOf(m.word, m.shown);
    m.left = TIME; m.phase = 'draw';
    banner(null);
    if (!m.local) live.send('round', { r: m.r, mask: m.mask, kind: o.k });
    log(`${m.players[m.drawer].name} is drawing (${m.word.replace(/[^ ]/g, '').length ? 'two words' : `${m.word.length} letters`})`, 'sys');
    startClock();
    render();
  }

  // The drawer's machine runs the clock and checks guesses (only it knows the word).
  function startClock() {
    clearInterval(tick);
    tick = setInterval(() => {
      if (!m || m.phase !== 'draw') return clearInterval(tick);
      m.left -= 0.25;
      if (m.local || m.drawer === m.me) {
        // Hints at the halfway mark and at a quarter left.
        const want = m.left < TIME * 0.25 ? 2 : m.left < TIME * 0.5 ? 1 : 0;
        const letters = [...m.word].map((c, i) => (c === ' ' ? -1 : i)).filter(i => i >= 0 && !m.shown.has(i));
        if (m.shown.size < want && letters.length > 2) {
          m.shown.add(letters[Math.floor(Math.random() * letters.length)]);
          m.mask = maskOf(m.word, m.shown);
          if (!m.local) live.send('hint', { mask: m.mask });
          render();
        }
        if (m.left <= 0) endRound(false, 0);
      }
      renderClock();
    }, 250);
  }

  function guessPoints() { return Math.round((50 + 150 * Math.max(0, m.left) / TIME) * ({ easy: 1, medium: 1.25, hard: 1.6 }[m.kind] || 1)); }

  // A guess from the guesser (local typing, or over the network).
  function checkGuess(text) {
    if (!m || m.phase !== 'draw' || m.guessed) return;
    const g = norm(text), w = norm(m.word);
    if (!g) return;
    const right = g === w || g.replace(/ /g, '') === w.replace(/ /g, '');
    const close = !right && w.length >= 4 && lev(g, w) <= (w.length > 7 ? 2 : 1);
    if (right) {
      const pts = guessPoints();
      if (!m.local) live.send('verdict', { t: text, ok: 1 });
      log(`${m.players[1 - m.drawer].name}: ${text}`, 'ok');
      endRound(true, pts);
    } else {
      if (!m.local) live.send('verdict', { t: text, ok: 0, close: close ? 1 : 0 });
      log(`${m.players[1 - m.drawer].name}: ${text}${close ? '  (so close!)' : ''}`, close ? 'close' : '');
    }
  }

  function endRound(guessed, pts) {
    m.phase = 'reveal';
    clearInterval(tick);
    const g = 1 - m.drawer, dp = Math.round(pts / 2);
    if (guessed) { m.players[g].score += pts; m.players[m.drawer].score += dp; m.drawn[m.drawer]++; }
    if (!m.local) live.send('end', { word: m.word, guessed: guessed ? 1 : 0, pts, dp, quick: TIME - m.left < 10 ? 1 : 0 });
    reveal(m.word, guessed, pts, dp, TIME - m.left < 10);
  }

  function reveal(word, guessed, pts, dp, quick) {
    m.phase = 'reveal';
    clearInterval(tick);
    m.mask = word.toUpperCase().split('').join(' ');
    log(guessed ? `Got it! "${word}" · +${pts} to the guesser, +${dp} to the artist` : `Time's up! It was "${word}"`, guessed ? 'ok' : 'sys');
    banner(`${guessed ? '🎉 ' : '⏰ '}It was <b>${esc(word)}</b>${guessed ? `<br><small style="font-size:15px">+${pts} / +${dp}</small>` : ''}`);
    Arcade.tone(guessed ? { freq: 660, to: 1320, dur: 0.25, type: 'triangle', vol: 0.05 } : { freq: 400, to: 200, dur: 0.3, type: 'sine', vol: 0.04 });
    if (guessed && quick && (m.local || m.drawer !== m.me)) Arcade.flag('doodle-duel-quick');
    if (!m.local && m.drawer === m.me && m.drawn[m.me] >= 3) Arcade.flag('doodle-duel-artist');
    render();
    // The next drawer starts the next round.
    setTimeout(() => {
      if (!m || m.phase !== 'reveal') return;
      if (m.local || (m.r + 1) % 2 === m.me || m.r + 1 >= ROUNDS) nextRound();
      else banner(`${esc(m.players[(m.r + 1) % 2].name)} is picking a word…`);
    }, 3500);
  }

  function endMatch() {
    m.phase = 'over';
    clearInterval(tick);
    render();
    const [a, b] = m.players;
    if (m.local) {
      Arcade.countPlay();
      return ui.show({
        title: a.score === b.score ? "It's a tie!" : `${esc(a.score > b.score ? a.name : b.name)} wins!`,
        html: `<p class="big">${a.score} – ${b.score}</p><p>${esc(a.name)} vs ${esc(b.name)}</p><div class="menu"><button class="btn secondary" type="button" data-menu>Menu</button></div>`,
        button: 'Play again', onAction: () => newMatch(true, [a.name, b.name], -1),
        onRender: p => p.querySelector('[data-menu]').addEventListener('click', showMenu),
      });
    }
    const mine = m.players[m.me].score, theirs = m.players[1 - m.me].score;
    Arcade.flag('online-match');
    Relay.result(mine > theirs ? 'w' : mine < theirs ? 'l' : 'd');
    if (mine > theirs) Arcade.flag('doodle-duel-win');
    Arcade.finish(ui, {
      score: mine,
      title: mine === theirs ? "It's a tie!" : mine > theirs ? 'You win! 🎨' : `${esc(m.players[1 - m.me].name)} wins`,
      lines: [`${mine} – ${theirs}`],
      html: `<div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div>${live.waitNote}`,
      button: 'Rematch',
      onAction: () => live.rematch(),
    });
    overlayEl.querySelector('[data-leave]')?.addEventListener('click', showMenu);
  }

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // ---------- Guess box ----------

  $('guess').addEventListener('submit', e => {
    e.preventDefault();
    const inp = $('guessIn'), text = inp.value.trim().slice(0, 30);
    inp.value = '';
    if (!text || !m || m.phase !== 'draw') return;
    if (!m.local && m.drawer === m.me) return;
    const ok = Filter.check(text, 30);
    if (ok.error !== undefined) { log(ok.error || "That guess can't be sent.", 'sys'); return; }
    if (m.local) checkGuess(ok.text);
    else { live.send('guess', { t: ok.text }); log(`You: ${ok.text}`, ''); }
  });

  // ---------- Online (live.js) ----------

  const live = Live.create({
    ui, tag: 'doodle', label: 'Doodle', title: 'The duel',
    onReady: host => { if (host) { live.send('go', {}); begin(); } },
    onEvent: (name, d) => {
      d = d || {};
      if (name === 'hello') { if (m && !m.local) { m.players[1 - m.me].name = live.them; render(); } return; }
      if (name === 'go' && !live.host) return begin();
      if (!m || m.local) return;
      if (name === 'round') {
        m.r = d.r | 0; m.drawer = m.r % 2; m.phase = 'draw'; m.mask = String(d.mask || ''); m.kind = d.kind; m.left = TIME; m.guessed = false;
        strokes = []; redraw(); banner(null);
        log(`${m.players[m.drawer].name} is drawing`, 'sys');
        startClock(); render();
        setTimeout(() => $('guessIn').focus(), 50);
      } else if (name === 'st' && m.drawer !== m.me) {
        const i = d.i | 0;
        if (!strokes[i]) strokes[i] = { c: typeof d.c === 'string' ? d.c : '#000', w: Math.min(60, +d.w || 3), p: [] };
        const s = strokes[i], from = s.p.length;
        for (const v of (d.p || []).slice(0, 400)) s.p.push(+v || 0);
        drawStroke(s, from);
      } else if (name === 'undo' && m.drawer !== m.me) { strokes.length = Math.max(0, d.n | 0); redraw(); }
      else if (name === 'clear' && m.drawer !== m.me) { strokes = []; redraw(); }
      else if (name === 'hint') { m.mask = String(d.mask || ''); render(); }
      else if (name === 'guess' && m.drawer === m.me) {
        const shown = Filter.display(String(d.t || '').slice(0, 30), 30);
        if (shown) checkGuess(shown);
      } else if (name === 'verdict' && m.drawer !== m.me) {
        if (!d.ok && d.close) log(`So close! "${String(d.t || '').slice(0, 30)}"`, 'close');
      } else if (name === 'end' && m.drawer !== m.me) {
        if (d.guessed) { m.players[1 - m.drawer].score += d.pts | 0; m.players[m.drawer].score += d.dp | 0; m.drawn[m.drawer]++; }
        reveal(String(d.word || ''), !!d.guessed, d.pts | 0, d.dp | 0, !!d.quick);
      }
    },
    onRematch: () => { live.send('go', {}); begin(); },
    onGone: lost => {
      if (!m || m.local) return;
      const playing = m.phase !== 'over';
      m = null; clearInterval(tick);
      if (lost) return showMenu("Lost the connection to the game server.");
      if (playing) { Arcade.flag('online-match'); Relay.result('w'); }
      ui.show({ title: `${esc(live.them)} left`, html: playing ? '<p>You win by forfeit.</p>' : '', button: 'Back to menu', onAction: () => showMenu() });
    },
    onCancel: msg => showMenu(msg),
  });

  function begin() {
    const me = live.host ? 0 : 1, names = [];
    names[me] = Arcade.profile().name; names[1 - me] = live.them;
    ui.hide();
    newMatch(false, names, me);
  }

  // ---------- Screen ----------

  function banner(html) { const b = $('banner'); if (html) { b.innerHTML = `<div>${html}</div>`; b.hidden = false; } else b.hidden = true; }
  function log(text, cls) {
    const p = document.createElement('p');
    p.className = cls || '';
    p.textContent = text;
    const l = $('log');
    l.appendChild(p);
    l.scrollTop = l.scrollHeight;
  }
  function renderClock() {
    const t = $('timer');
    const left = m && m.phase === 'draw' ? Math.max(0, m.left) : 0;
    t.style.setProperty('--p', `${left / TIME * 100}%`);
    $('secs').textContent = m && m.phase === 'draw' ? Math.ceil(left) : '-';
  }
  function render() {
    if (!m) { $('word').innerHTML = ''; $('scores').innerHTML = ''; $('tools').hidden = true; return; }
    const drawing = iDraw();
    // On a shared screen the guesser is right there, so the drawer holds a button to peek.
    const word = drawing && !m.local ? `${m.word.toUpperCase()}<small>Draw this! No letters or numbers.</small>`
      : drawing ? `${peek ? m.word.toUpperCase() : esc(m.mask)}<small><button class="btn secondary" type="button" data-peek style="padding:2px 10px;font-size:12px">👁 Hold to see your word</button></small>`
      : m.mask ? `${esc(m.mask)}<small>${m.phase === 'draw' ? 'Guess the word' : ''}</small>` : '';
    $('word').innerHTML = word;
    const pk = $('word').querySelector('[data-peek]');
    if (pk) {
      const on = v => e => { e.preventDefault(); peek = v; render(); };
      pk.addEventListener('pointerdown', on(true));
      pk.addEventListener('pointerup', on(false));
      pk.addEventListener('pointerleave', on(false));
    }
    $('tools').hidden = !drawing;
    paper.classList.toggle('watch', !drawing);
    $('scores').innerHTML = m.players.map((p, i) => `<div class="dd-score ${m.drawer === i && m.phase === 'draw' ? 'drawing' : ''}" style="--c:${i ? '#ff5a5f' : '#4fc3ff'}"><span>${esc(p.name)}${!m.local && i === m.me ? ' (you)' : ''}</span><span>${p.score}</span></div>`).join('');
    const canGuess = m.phase === 'draw' && (m.local || m.drawer !== m.me);
    $('guessIn').disabled = !canGuess;
    $('guessIn').placeholder = canGuess ? 'Type your guess…' : m.phase === 'draw' ? 'You\'re drawing!' : 'Waiting…';
    $('round').textContent = m.r >= 0 ? `${Math.min(m.r + 1, ROUNDS)}/${ROUNDS}` : '-';
    $('mine').textContent = m.local ? '-' : m.players[m.me].score;
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
    renderClock();
  }

  function showMenu(error = '') {
    live.leave();
    m = null; clearInterval(tick);
    strokes = []; redraw(); banner('🎨 Doodle Duel'); render();
    ui.show({
      title: '🎨 Doodle Duel',
      html: `<p>One draws, one guesses. Pick a word, draw it before the clock runs out, and score when they get it: the faster, the more you both get. Six rounds, taking turns.</p>
        <div class="menu"><button class="btn secondary" type="button" data-local>Pass and play on this device</button></div>
        ${live.html('Play a friend online')}
        <p class="error">${esc(error)}</p>`,
      button: null,
      onRender: p => {
        live.wire(p);
        p.querySelector('[data-local]').addEventListener('click', () => { ui.hide(); newMatch(true, ['Player 1', 'Player 2'], -1); });
      },
    });
  }

  addEventListener('pointerup', () => { if (peek) { peek = false; render(); } });
  buildTools();
  redraw();
  render();
  const invite = Live.invite('doodle');
  showMenu();
  if (invite) live.connect('public', invite);
})();
