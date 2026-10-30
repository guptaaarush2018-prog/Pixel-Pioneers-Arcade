(() => {
  const W = 500, H = 720;
  const ROWS = 6, LEN = 5, TILE = 58, GAP = 8;
  const GX = (W - (LEN * TILE + (LEN - 1) * GAP)) / 2, GY = 54;
  const START_TIME = 150, FAIL_PENALTY = 20, KEY_EVERY = 3;
  const COLORS = { 2: '#3ddc84', 1: '#ffc53d', 0: '#3a404c' };
  const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', '>ZXCVBNM<'];

  // Answers: common, school-friendly words. Each answer's last letter becomes the next answer's
  // first letter, so the list covers every letter that words here end with.
  const ANSWERS = `about above actor acute adapt admit adopt adult after again agent agree ahead alarm album alert alien
    alike alive allow alone along alter amber amuse angel anger angle angry ankle apple apply apron arena argue arise
    armor arrow aside asset audio avoid awake award aware bacon badge baker basic basin batch beach beard beast begin
    belly bench berry birth black blade blame blank blast blaze blend bless blind blink block bloom board boast bonus
    boost booth brain brake brand brave bread break brick bride brief bring broad brook broom brush buddy build bunch
    burst cabin cable camel candy canoe cargo carry catch cause cedar chain chair chalk charm chart chase cheap check
    cheek cheer chess chest chick chief child chill chirp choir chord civic claim clamp clash class clean clear clerk
    click cliff climb clock close cloth cloud clown coach coast cocoa comet coral couch count court cover crack craft
    crane crash crate crawl crazy cream creek crisp cross crowd crown crumb crust curve cycle daily dairy daisy dance
    delay delta depth diary dizzy dodge donut draft drain drama dream dress drift drill drink drive eager eagle early
    earth easel eight elbow elder elect email empty enjoy enter entry equal erase error event every exact exist extra
    fable faint fairy faith false fancy feast fence ferry fetch fever field fifty final flame flash fleet flock flood
    floor flour fluid flute focus force forge forty found frame fresh frost fruit funny gauge ghost giant given glass
    glide globe glove grace grade grain grand grape graph grass gravy great green greet grill group guard guess guide
    habit happy harsh haste haven heart heavy hedge hello hippo hobby honey horse hotel house human humor hurry ideal
    igloo image index inner input issue ivory jelly jewel joint jolly judge juice jumbo kayak knife knock koala label
    large laser later laugh layer learn lemon level light limit linen lodge logic loose lucky lunar lunch magic major
    mango maple march match mayor medal melon mercy merit metal meter might minor mixer model money month moose motor
    mount mouse mouth movie music naval nerve never night ninja noble noise north novel nurse ocean offer often olive
    onion opera orbit order other otter outer owner paint panda panel paper party pasta patch pause peace peach pearl
    pedal penny perch phone photo piano pilot pinch pixel pizza place plain plane plant plate plaza point polar porch
    pouch power press price pride prime print prize proud prove pulse punch pupil puppy quack quart queen quest quick
    quiet quilt quote radar radio raise rally ranch range rapid raven reach react ready realm relax relay reply rhyme
    ridge right rival river roast robin robot rocky rodeo rough round route royal rugby ruler rusty salad sandy sauce
    scale scarf scene scoop score scout scrub seven shade shake shape share shark sharp sheep shelf shell shift shine
    shirt shore short shout sight skate skill skirt skunk slate sleep slice slide slope smart smile smoke snack snail
    snake sneak solar solid solve sound south space spade spark speak speed spell spend spice spike spine spoon sport
    spray squad stack staff stage stair stamp stand stare start state steam steel stick still stone stool storm story
    stove straw strip stuck study style sugar sunny super swamp swing sword table taste teach teeth thank theme thick
    thing think thumb tiger toast today token topic torch total touch tough tower track trade trail train treat trend
    trial tribe trick truck trunk trust truth tulip tutor twice twist ultra uncle under unity until upper urban usual
    valid value vapor vault verse video visit vital vivid vocal voice wagon waste watch water whale wheat wheel while
    whirl whole width witty world worry write yacht yearn yield young youth zebra zesty`.trim().split(/\s+/);
  const VALID = new Set([...(window.LETTER_LOCK_WORDS || '').split(' '), ...ANSWERS]);

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'ready';
  let answer, rows, cur, locked, keysState, used, clock, timeLeft, score, chain, solved, keys, msg, popups, shake, next, best;

  // ---------- Rules ----------

  // 2 = right spot, 1 = in the word elsewhere, 0 = not in the word. Repeated letters are only
  // marked as often as they appear in the answer.
  function grade(guess) {
    const res = Array(LEN).fill(0), left = {};
    for (let i = 0; i < LEN; i++) {
      if (guess[i] === answer[i]) res[i] = 2;
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < LEN; i++) {
      if (res[i] || !left[guess[i]]) continue;
      res[i] = 1;
      left[guess[i]]--;
    }
    return res;
  }

  function pickAnswer(first) {
    let pool = ANSWERS.filter(w => !used.has(w) && (!first || w[0] === first));
    if (!pool.length) pool = ANSWERS.filter(w => !used.has(w));
    if (!pool.length) { used.clear(); pool = ANSWERS; }
    const w = pool[Math.floor(Math.random() * pool.length)];
    used.add(w);
    return w;
  }

  // The previous answer's last letter is locked into the first tile. With no match in the
  // answer list the chain starts fresh from a new letter.
  function newWord(first) {
    answer = pickAnswer(first);
    rows = [];
    locked = { 0: answer[0] };
    keysState = {};
    resetInput();
  }

  function resetInput() {
    cur = Array(LEN).fill('');
    for (const i in locked) cur[i] = locked[i];
  }

  function type(letter) {
    if (state !== 'playing' || next) return;
    const i = cur.findIndex(c => !c);
    if (i < 0) return;
    cur[i] = letter;
    Arcade.tone({ freq: 520, dur: 0.03, vol: 0.02 });
  }

  function erase() {
    if (state !== 'playing' || next) return;
    for (let i = LEN - 1; i >= 0; i--) {
      if (cur[i] && !(i in locked)) { cur[i] = ''; return; }
    }
  }

  function submit() {
    if (state !== 'playing' || next) return;
    const guess = cur.join('').toLowerCase();
    if (guess.length < LEN) { say('Not enough letters', '#ff7a7a'); shake = 0.4; return; }
    if (!VALID.has(guess)) { say('Not in the word list', '#ff7a7a'); shake = 0.4; return; }
    const res = grade(guess);
    rows.push({ word: guess, res, at: clock });
    res.forEach((r, i) => {
      const k = guess[i];
      keysState[k] = Math.max(keysState[k] ?? -1, r);
      if (r === 2) locked[i] = k;
    });
    Arcade.tone({ freq: 440, dur: 0.06, vol: 0.03 });
    if (guess === answer) win();
    else if (rows.length >= ROWS) fail();
    else resetInput();
  }

  function win() {
    const n = rows.length;
    chain++;
    solved++;
    best = Math.max(best, chain);
    const points = (ROWS + 1 - n) * 100 + (chain - 1) * 50;
    const bonus = 10 + (ROWS - n) * 6;
    score += points;
    timeLeft += bonus;
    if (chain % KEY_EVERY === 0) keys++;
    if (n <= 2) Arcade.flag('letter-lock-ace');
    if (chain >= 10) Arcade.flag('letter-lock-chain');
    popups.push({ text: `+${points}  ·  +${bonus}s`, y: GY + n * (TILE + GAP) - 20, life: 1.4, color: '#3ddc84' });
    say(chain > 1 ? `Chain ×${chain}!` : 'Solved!', '#3ddc84');
    [523, 659, 784].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.12, type: 'triangle', vol: 0.05, delay: 0.5 + i * 0.08 }));
    next = { at: clock + 1.3, first: answer[LEN - 1] };
    updateHud();
  }

  function fail() {
    chain = 0;
    timeLeft = Math.max(0, timeLeft - FAIL_PENALTY);
    say(`It was ${answer.toUpperCase()}  ·  −${FAIL_PENALTY}s`, '#ff7a7a');
    Arcade.tone({ freq: 300, to: 140, dur: 0.35, type: 'sawtooth', vol: 0.04, delay: 0.5 });
    next = { at: clock + 2, first: answer[LEN - 1] };
    updateHud();
  }

  // Keys reveal one letter of the current word in its spot. One is earned every third word in a chain.
  function useKey() {
    if (state !== 'playing' || next || !keys) return;
    const open = [...answer].map((_, i) => i).filter(i => !(i in locked));
    if (open.length <= 1) return;
    const i = open[Math.floor(Math.random() * open.length)];
    locked[i] = answer[i];
    keys--;
    const typed = cur.filter((c, j) => c && !(j in locked) && j !== i);
    resetInput();
    typed.forEach(type);
    Arcade.tone({ freq: 880, to: 1320, dur: 0.15, type: 'triangle', vol: 0.05 });
    updateHud();
  }

  function say(text, color) {
    msg = { text, color, life: 2 };
  }

  // ---------- Flow ----------

  function reset() {
    used = new Set();
    clock = 0;
    timeLeft = START_TIME;
    score = 0;
    chain = 0;
    best = 0;
    solved = 0;
    keys = 0;
    msg = null;
    popups = [];
    shake = 0;
    next = null;
    newWord(null);
    updateHud();
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
  }

  function gameOver() {
    state = 'over';
    Arcade.tone({ freq: 392, to: 196, dur: 0.5, type: 'triangle', vol: 0.05 });
    Arcade.finish(ui, {
      score,
      title: 'Time\'s up',
      lines: [`${solved} word${solved === 1 ? '' : 's'} solved · longest chain ${best}`, `The last word was <b>${answer.toUpperCase()}</b>.`],
      onAction: start,
    });
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }

  function resume() {
    state = 'playing';
    ui.hide();
  }

  function update(dt) {
    clock += dt;
    if (!next) timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      gameOver();
      return;
    }
    if (next && clock >= next.at) {
      const first = next.first;
      next = null;
      newWord(first);
    }
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('chain').textContent = chain;
    $('keys').textContent = keys;
  }

  // ---------- Input ----------

  window.addEventListener('keydown', e => {
    if (e.code === 'Escape' || (e.code === 'KeyP' && e.shiftKey)) {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (state !== 'playing' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Backspace') erase();
    else if (e.key === '?' || e.key === '/') useKey();
    else if (/^[a-z]$/i.test(e.key)) type(e.key.toLowerCase());
  });

  // On-screen keyboard, drawn on the canvas.
  const KW = 42, KH = 54, KG = 6, KY = 504;
  const keyRects = [];
  KEY_ROWS.forEach((row, r) => {
    const widths = [...row].map(k => (k === '>' || k === '<' ? KW * 1.5 + KG / 2 : KW));
    const total = widths.reduce((a, b) => a + b, 0) + KG * (row.length - 1);
    let x = (W - total) / 2;
    [...row].forEach((k, i) => {
      keyRects.push({ k, x, y: KY + r * (KH + KG), w: widths[i], h: KH });
      x += widths[i] + KG;
    });
  });
  const keyBtn = { x: W - 118, y: 8, w: 104, h: 30 };

  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const hit = b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
    if (hit(keyBtn)) return useKey();
    const key = keyRects.find(hit);
    if (!key) return;
    if (key.k === '>') submit();
    else if (key.k === '<') erase();
    else type(key.k.toLowerCase());
  });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function tile(x, y, letter, color, scaleY = 1, border = '#2a2f39') {
    ctx.save();
    ctx.translate(x + TILE / 2, y + TILE / 2);
    ctx.scale(1, Math.max(0.02, scaleY));
    ctx.fillStyle = color || '#161920';
    ctx.beginPath();
    ctx.roundRect(-TILE / 2, -TILE / 2, TILE, TILE, 8);
    ctx.fill();
    if (!color) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (letter) {
      ctx.fillStyle = color === COLORS[2] || color === COLORS[1] ? '#12151b' : '#eceef2';
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter.toUpperCase(), 0, 2);
    }
    ctx.restore();
  }

  function draw(dt) {
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, W, H);

    // Time bar
    const frac = Math.min(1, timeLeft / START_TIME);
    ctx.fillStyle = '#1e222a';
    ctx.beginPath(); ctx.roundRect(14, 14, W - 148, 18, 9); ctx.fill();
    ctx.fillStyle = timeLeft < 20 ? '#ff7a7a' : '#4f8cff';
    ctx.beginPath(); ctx.roundRect(14, 14, Math.max(18, (W - 148) * frac), 18, 9); ctx.fill();
    ctx.fillStyle = '#eceef2';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.ceil(timeLeft)}s`, 22, 24);

    ctx.fillStyle = keys ? '#ffc53d' : '#1e222a';
    ctx.beginPath(); ctx.roundRect(keyBtn.x, keyBtn.y, keyBtn.w, keyBtn.h, 8); ctx.fill();
    ctx.fillStyle = keys ? '#1c1500' : '#8d94a1';
    ctx.textAlign = 'center';
    ctx.fillText(`🔑 Key ×${keys}`, keyBtn.x + keyBtn.w / 2, keyBtn.y + keyBtn.h / 2 + 1);

    // Grid
    const shakeX = shake > 0 ? Math.sin(shake * 60) * 8 * shake : 0;
    shake = Math.max(0, shake - dt);
    for (let r = 0; r < ROWS; r++) {
      const y = GY + r * (TILE + GAP);
      const row = rows?.[r];
      for (let i = 0; i < LEN; i++) {
        const x = GX + i * (TILE + GAP);
        if (row) {
          const t = (clock - row.at - i * 0.12) / 0.3;
          if (t < 0.5) tile(x, y, row.word[i], null, 1 - Math.max(0, t) * 2, '#4a5160');
          else tile(x, y, row.word[i], COLORS[row.res[i]], Math.min(1, (t - 0.5) * 2));
        } else if (r === rows?.length && state !== 'ready' && !next) {
          const isLocked = i in locked;
          tile(x + shakeX, y, cur[i], null, 1, isLocked ? '#3ddc84' : cur[i] ? '#6b7280' : '#2a2f39');
          if (isLocked) {
            ctx.fillStyle = 'rgba(61,220,132,0.12)';
            ctx.beginPath(); ctx.roundRect(x + shakeX, y, TILE, TILE, 8); ctx.fill();
          }
        } else {
          tile(x, y, '', null);
        }
      }
    }

    // Message and score popups
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (msg) {
      msg.life -= dt;
      ctx.globalAlpha = Math.min(1, msg.life * 2);
      ctx.fillStyle = msg.color;
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText(msg.text, W / 2, 476);
      ctx.globalAlpha = 1;
      if (msg.life <= 0) msg = null;
    } else if (state === 'playing' && !next) {
      ctx.fillStyle = '#8d94a1';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(chain ? `Chain ×${chain} · solve it to keep going` : 'The green tile is locked in for you', W / 2, 476);
    }
    for (const p of popups) {
      p.life -= dt;
      p.y -= 24 * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.fillText(p.text, W / 2, p.y);
    }
    ctx.globalAlpha = 1;
    popups = popups.filter(p => p.life > 0);

    // Keyboard
    for (const k of keyRects) {
      const s = keysState?.[k.k.toLowerCase()];
      ctx.fillStyle = s === undefined ? '#2a2f39' : COLORS[s];
      ctx.beginPath(); ctx.roundRect(k.x, k.y, k.w, k.h, 6); ctx.fill();
      ctx.fillStyle = s === 2 || s === 1 ? '#12151b' : '#eceef2';
      ctx.font = k.k === '>' ? '700 13px system-ui, sans-serif' : '700 17px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(k.k === '>' ? 'ENTER' : k.k === '<' ? '⌫' : k.k, k.x + k.w / 2, k.y + k.h / 2 + 1);
    }
    ctx.textBaseline = 'alphabetic';
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  reset();
  state = 'ready';
  Versus.attach({
    ui,
    start,
    score: () => score,
    intro: {
      title: 'Letter Lock',
      html: `<ul>
        <li>Guess the five-letter word in six tries. <b style="color:#3ddc84">Green</b> is the right spot, <b style="color:#ffc53d">gold</b> is in the word somewhere else.</li>
        <li>The <b>last letter</b> of each answer is locked in as the <b>first letter</b> of the next one.</li>
        <li>Fewer guesses score more and add time to the clock. Missing a word costs ${FAIL_PENALTY} seconds and breaks your chain.</li>
        <li>Every third word in a chain earns a <b>key</b>. Press <kbd>?</kbd> to spend it on a free letter.</li>
      </ul>`,
      button: 'Start the chain',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
