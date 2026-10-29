(() => {
  const W = 720, H = 480, GROUND = 440, MAX_SHIELDS = 5;
  const WORDS = {
    easy: 'cat dog sun map run red top box fox jam key log net owl pen cup bus hat ice kit leg mud nut pig rug sky toy van web yes zip arm bat bed cow egg fan gum hug ink jet lid mix oak pop ray sea tin win yak zoo cake fish frog game hill jump kite lake moon nest park quiz rain ship tree wave wind star snow ring play note leaf gold farm desk cold blue bird'.split(' '),
    medium: 'apple beach brave candy chair cloud crown dance dream eagle earth flame ghost giant grape heart honey house juice knife laser lemon light magic metal mouse music ocean orbit panda party piano pilot pixel plant power queen quick radio river robot rocket shark sleep smile snake space spark storm sugar sweet tiger toast tower train water whale world zebra canyon castle garden jungle marble planet puzzle rabbit silver spider summer tunnel winter'.split(' '),
    hard: 'adventure backpack baseball blizzard building calendar champion chocolate dinosaur elephant engineer festival football frontier galaxy hamburger hurricane invention keyboard kangaroo labyrinth lightning marathon mountain notebook octopus parachute penguin pineapple question rainbow sandwich scientist skeleton snowflake strawberry sunflower telescope thunder treasure umbrella universe vacation volcano waterfall whistle wonderful'.split(' '),
  };

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  // A hidden input brings up the on-screen keyboard on phones and tablets.
  const input = document.createElement('input');
  Object.assign(input, { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('aria-label', 'Type the falling words');
  input.style.cssText = 'position:absolute;opacity:0;pointer-events:none;left:0;top:0;width:1px;height:1px';
  canvas.parentElement.appendChild(input);

  let state = 'ready';
  let words, target, score, shields, wave, toSpawn, spawnT, streak, typed, correct, time, particles, banner, flashT, cleared;

  function reset() {
    words = [];
    target = null;
    score = 0;
    shields = MAX_SHIELDS;
    wave = 0;
    streak = 0;
    typed = 0;
    correct = 0;
    cleared = 0;
    time = 0;
    particles = [];
    flashT = 0;
    nextWave();
    updateHud();
  }

  function nextWave() {
    wave++;
    toSpawn = 6 + wave * 2;
    spawnT = 1.2;
    banner = { text: `Wave ${wave}`, until: time + 1.6 };
    if (wave > 1) shields = Math.min(MAX_SHIELDS, shields + 1);
    updateHud();
  }

  function pickWord() {
    const r = Math.random();
    const hardChance = Math.min(0.45, (wave - 2) * 0.08);
    const medChance = Math.min(0.6, 0.15 + wave * 0.1);
    const pool = r < hardChance ? WORDS.hard : r < hardChance + medChance ? WORDS.medium : WORDS.easy;
    // Avoid two words on screen starting with the same letter, so targeting is never ambiguous.
    for (let i = 0; i < 20; i++) {
      const w = Arcade.pick(pool);
      if (!words.some(x => x.text[0] === w[0])) return w;
    }
    return null;
  }

  function spawn() {
    const text = pickWord();
    if (!text) return false;
    ctx.font = '600 20px ui-monospace, Menlo, monospace';
    const width = ctx.measureText(text).width;
    words.push({
      text, done: 0, width,
      x: Arcade.rand(20, W - width - 20), y: -10,
      speed: Arcade.rand(28, 40) + wave * 6,
    });
    return true;
  }

  const multiplier = () => 1 + Math.min(4, Math.floor(streak / 5));

  function typeChar(ch) {
    if (state !== 'playing') return;
    ch = ch.toLowerCase();
    if (!/^[a-z]$/.test(ch)) return;
    typed++;
    if (!target) {
      target = words.filter(w => w.text[0] === ch).sort((a, b) => b.y - a.y)[0] || null;
      if (!target) { miss(); return; }
    }
    if (target.text[target.done] !== ch) { miss(); return; }
    correct++;
    target.done++;
    Arcade.tone({ freq: 700 + target.done * 30, dur: 0.03, vol: 0.025 });
    if (target.done === target.text.length) {
      streak++;
      cleared++;
      score += target.text.length * 10 * multiplier();
      for (let i = 0; i < 14; i++) {
        particles.push({ x: target.x + Math.random() * target.width, y: target.y, vx: Arcade.rand(-120, 120), vy: Arcade.rand(-160, 40), life: Arcade.rand(0.3, 0.6) });
      }
      Arcade.tone({ freq: 880, to: 1320, dur: 0.1, type: 'triangle', vol: 0.05 });
      words = words.filter(w => w !== target);
      target = null;
      updateHud();
    }
  }

  function miss() {
    streak = 0;
    flashT = 0.15;
    Arcade.tone({ freq: 160, dur: 0.06, vol: 0.03 });
  }

  function update(dt) {
    time += dt;
    flashT = Math.max(0, flashT - dt);
    if (time > (banner?.until ?? 0) - 0.6) {
      spawnT -= dt;
      if (toSpawn > 0 && spawnT <= 0) {
        if (spawn()) toSpawn--;
        spawnT = Math.max(0.7, 2.4 - wave * 0.18) * Arcade.rand(0.8, 1.2);
      }
    }
    for (const w of words) w.y += w.speed * dt;
    for (const w of words.filter(w => w.y >= GROUND)) {
      shields--;
      streak = 0;
      if (w === target) target = null;
      Arcade.tone({ freq: 220, to: 90, dur: 0.25, type: 'sawtooth', vol: 0.05 });
      updateHud();
    }
    words = words.filter(w => w.y < GROUND);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);

    if (shields <= 0) { end(); return; }
    if (toSpawn === 0 && !words.length) nextWave();
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('wave').textContent = wave;
    $('shields').textContent = Math.max(0, shields);
  }

  function end() {
    state = 'over';
    input.blur();
    const accuracy = typed ? Math.round((correct / typed) * 100) : 0;
    const wpm = time > 0 ? Math.round((correct / 5) / (time / 60)) : 0;
    Arcade.finish(ui, {
      score,
      title: 'Storm over',
      lines: [`${cleared} words · ${wpm} WPM · ${accuracy}% accuracy`],
      onAction: start,
    });
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
    input.value = '';
    input.focus({ preventScroll: true });
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    input.blur();
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }

  function resume() {
    state = 'playing';
    ui.hide();
    input.focus({ preventScroll: true });
  }

  input.addEventListener('input', () => {
    for (const ch of input.value) typeChar(ch);
    input.value = '';
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    // If focus wandered off the hidden input, still accept typing.
    if (document.activeElement !== input && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      typeChar(e.key);
      if (state === 'playing') input.focus({ preventScroll: true });
    }
  });
  canvas.addEventListener('pointerdown', () => { if (state === 'playing') input.focus({ preventScroll: true }); });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#141821');
    g.addColorStop(1, '#1d2330');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Ground with one segment per remaining shield.
    ctx.fillStyle = '#232833';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    const segW = (W - 40) / MAX_SHIELDS;
    for (let i = 0; i < MAX_SHIELDS; i++) {
      ctx.fillStyle = i < shields ? '#4f8cff' : '#2a2f39';
      ctx.fillRect(20 + i * segW + 3, GROUND + 14, segW - 6, 8);
    }

    ctx.font = '600 20px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    for (const w of words) {
      const danger = w.y > GROUND - 90;
      ctx.fillStyle = w === target ? 'rgba(255,197,61,0.12)' : 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.roundRect(w.x - 8, w.y - 20, w.width + 16, 28, 6);
      ctx.fill();
      const doneText = w.text.slice(0, w.done);
      ctx.fillStyle = '#ffc53d';
      ctx.fillText(doneText, w.x, w.y);
      ctx.fillStyle = danger ? '#ff8a8a' : '#eceef2';
      ctx.fillText(w.text.slice(w.done), w.x + ctx.measureText(doneText).width, w.y);
    }

    ctx.fillStyle = '#ffc53d';
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (state === 'playing' || state === 'paused') {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#8d94a1';
      ctx.fillText(`Streak ${streak} · x${multiplier()}`, W - 16, GROUND - 10);
    }

    if (banner && time < banner.until) {
      ctx.globalAlpha = Math.min(1, (banner.until - time) * 2);
      ctx.font = '700 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#eceef2';
      ctx.fillText(banner.text, W / 2, H / 2 - 20);
      ctx.globalAlpha = 1;
    }

    if (flashT > 0) {
      ctx.fillStyle = `rgba(255,107,107,${flashT})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => score,
    intro: {
      title: 'Type Storm',
      html: `<ul>
        <li>Type a falling word to destroy it before it hits the ground.</li>
        <li>Start typing any word to lock onto it. Every word on screen starts with a different letter.</li>
        <li>Each word that lands costs a shield. Clearing a wave gives one back.</li>
        <li>Every 5 words in a row without a typo raises your multiplier.</li>
      </ul>`,
      button: 'Start typing',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
