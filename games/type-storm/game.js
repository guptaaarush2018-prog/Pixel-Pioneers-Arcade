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
  const { shade, alpha, ease } = Gfx;
  const FONT = '600 20px ui-monospace, Menlo, monospace';

  // Cosmetics only. They use Gfx's own random numbers so duels (which seed Math.random) stay in sync.
  const fx = Gfx.particles(500);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();
  let rings = [], clock = 0;

  // A hidden input brings up the on-screen keyboard on phones and tablets.
  const input = document.createElement('input');
  Object.assign(input, { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('aria-label', 'Type the falling words');
  input.style.cssText = 'position:absolute;opacity:0;pointer-events:none;left:0;top:0;width:1px;height:1px';
  canvas.parentElement.appendChild(input);

  let state = 'ready';
  let words, target, score, shields, wave, toSpawn, spawnT, streak, typed, correct, time, banner, flashT, cleared;

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
    flashT = 0;
    rings = [];
    fx.clear();
    pops.list.length = 0;
    nextWave();
    updateHud();
  }

  function nextWave() {
    wave++;
    if (wave >= 10) Arcade.flag('type-storm-wave10');
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
    ctx.font = FONT;
    const width = ctx.measureText(text).width;
    words.push({
      text, done: 0, width,
      x: Arcade.rand(20, W - width - 20), y: -10, born: time,
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
    ctx.font = FONT;
    const lx = target.x + ctx.measureText(target.text.slice(0, target.done)).width;
    fx.burst(4, () => ({
      x: lx, y: target.y - 7, vx: Gfx.rand(-90, 90), vy: Gfx.rand(-120, 10), drag: 4,
      life: Gfx.rand(0.18, 0.32), size: Gfx.rand(1.2, 2), color: '#ffe066', shape: 'spark',
    }));
    Arcade.tone({ freq: 700 + target.done * 30, dur: 0.03, vol: 0.025 });
    if (target.done === target.text.length) {
      streak++;
      cleared++;
      if (streak >= 25) Arcade.flag('type-storm-streak');
      const gained = target.text.length * 10 * multiplier();
      score += gained;
      blast(target, gained);
      Arcade.tone({ freq: 880, to: 1320, dur: 0.1, type: 'triangle', vol: 0.05 });
      words = words.filter(w => w !== target);
      target = null;
      updateHud();
    }
  }

  // A cleared word: the tile shatters into chips and a ring, and its points float up.
  function blast(w, gained) {
    const cx = w.x + w.width / 2, cy = w.y - 6;
    const hot = streak >= 5;
    rings.push({ x: cx, y: cy, t: 0, r: 28 + w.width * 0.35, color: hot ? '#ffb347' : '#9ef0ff' });
    fx.burst(10 + w.text.length * 2, () => ({
      x: cx + Gfx.rand(-w.width / 2, w.width / 2), y: cy + Gfx.rand(-8, 8),
      vx: Gfx.rand(-220, 220), vy: Gfx.rand(-200, 40), drag: 2.2, life: Gfx.rand(0.35, 0.7),
      size: Gfx.rand(3, 6), color: Gfx.rand() < 0.5 ? '#3a4157' : '#ffc53d', shape: 'chip', spin: Gfx.rand(-14, 14),
    }));
    fx.burst(8, () => ({
      x: cx, y: cy, vx: Gfx.rand(-260, 260), vy: Gfx.rand(-260, 260), drag: 3,
      life: Gfx.rand(0.2, 0.4), size: 2, color: '#fff6c2', shape: 'spark',
    }));
    pops.add(`+${gained}`, cx, cy - 14, { color: multiplier() > 1 ? '#ffb347' : '#9be37a', size: 16 + Math.min(8, multiplier() * 2) });
    if (streak > 0 && streak % 5 === 0 && streak <= 20) {
      pops.add(`x${multiplier()} multiplier!`, W / 2, GROUND - 60, { color: '#ffe066', size: 24, life: 1.2, rise: 30 });
    }
    shake.add(0.12);
  }

  function miss() {
    streak = 0;
    flashT = 0.15;
    shake.add(0.18);
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
      landed(w);
      streak = 0;
      if (w === target) target = null;
      Arcade.tone({ freq: 220, to: 90, dur: 0.25, type: 'sawtooth', vol: 0.05 });
      updateHud();
    }
    words = words.filter(w => w.y < GROUND);

    if (shields <= 0) { end(); return; }
    if (toSpawn === 0 && !words.length) nextWave();
  }

  // A word hit the ground: a red impact, a shake, and the shield segment cracks.
  function landed(w) {
    const cx = w.x + w.width / 2;
    shake.add(0.55);
    flashT = Math.max(flashT, 0.2);
    rings.push({ x: cx, y: GROUND, t: 0, r: 60, color: '#ff6b6b' });
    fx.burst(22, () => ({
      x: cx + Gfx.rand(-w.width / 2, w.width / 2), y: GROUND, z: 0, vx: Gfx.rand(-160, 160), vy: 0,
      vz: Gfx.rand(80, 260), g: 600, life: Gfx.rand(0.5, 0.9), size: Gfx.rand(2, 4),
      color: Gfx.rand() < 0.5 ? '#ff6b6b' : '#ffb347', shape: 'square', spin: Gfx.rand(-10, 10),
    }));
    pops.add('-1 shield', cx, GROUND - 24, { color: '#ff8a8a', size: 16 });
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

  // The night city never changes, so it's painted once into a sprite.
  const backdrop = Gfx.sprite(W, H, 0, 0, c => {
    const g = c.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, '#0d1230');
    g.addColorStop(0.7, '#2a2f6b');
    g.addColorStop(1, '#4b3a7a');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    const r = Gfx.rng(7);
    c.fillStyle = '#fff';
    for (let i = 0; i < 70; i++) {
      c.globalAlpha = 0.25 + r() * 0.6;
      c.beginPath();
      c.arc(r() * W, r() * GROUND * 0.7, 0.5 + r() * 0.9, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    // Two skyline layers: a hazy far row, then a darker near row with lit windows.
    const row = (base, minH, maxH, color, windows) => {
      let x = -10;
      while (x < W) {
        const w = 26 + r() * 40, h = minH + r() * (maxH - minH);
        c.fillStyle = color;
        c.fillRect(x, base - h, w, h);
        if (r() < 0.3) c.fillRect(x + w / 2 - 1, base - h - 10, 2, 10);
        if (windows) {
          for (let wy = base - h + 8; wy < base - 8; wy += 11) {
            for (let wx = x + 5; wx < x + w - 6; wx += 8) {
              if (r() < 0.22) {
                c.fillStyle = r() < 0.8 ? 'rgba(255,217,138,0.6)' : 'rgba(158,240,255,0.5)';
                c.fillRect(wx, wy, 3, 4);
              }
            }
          }
        }
        x += w + 2;
      }
    };
    row(GROUND, 40, 120, '#24285a', false);
    row(GROUND, 24, 80, '#1a1d3d', true);
    // Street.
    const sg = c.createLinearGradient(0, GROUND, 0, H);
    sg.addColorStop(0, '#2b3142');
    sg.addColorStop(1, '#171b25');
    c.fillStyle = sg;
    c.fillRect(0, GROUND, W, H - GROUND);
    c.fillStyle = '#3a4157';
    c.fillRect(0, GROUND, W, 2);
  });

  // Rain is drawn from the clock, so it needs no state and no random numbers.
  function rain() {
    ctx.strokeStyle = 'rgba(158,240,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 46; i++) {
      const sp = 380 + (i * 53) % 160;
      const y = ((i * 89.7) + clock * sp) % (GROUND + 40) - 40;
      const xx = (((i * 157.3 - clock * sp * 0.2) % (W + 60)) + W + 60) % (W + 60) - 30;
      ctx.moveTo(xx, y);
      ctx.lineTo(xx - 5, y + 26);
    }
    ctx.stroke();
  }

  function drawWord(w) {
    const isTarget = w === target;
    const danger = Math.max(0, Math.min(1, (w.y - (GROUND - 110)) / 90));
    const pad = 9, bx = w.x - pad, by = w.y - 21, bw = w.width + pad * 2, bh = 30;
    const spawnK = Math.min(1, (time - w.born) / 0.25);
    const sc = ease.outBack(spawnK);

    ctx.save();
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.scale(sc, sc);
    ctx.translate(-(bx + bw / 2), -(by + bh / 2));

    // Falling trail.
    const tg = ctx.createLinearGradient(0, by - 44, 0, by + 4);
    const trailCol = isTarget ? '#ffe066' : danger > 0.5 ? '#ff8a8a' : '#9ef0ff';
    tg.addColorStop(0, alpha(trailCol, 0));
    tg.addColorStop(1, alpha(trailCol, 0.2));
    ctx.fillStyle = tg;
    ctx.fillRect(bx + 4, by - 44, bw - 8, 46);

    // Tile: dark side face under a gradient top, with a soft drop shadow.
    const base = danger > 0 ? Gfx.mix('#3a4157', '#7a2f3a', danger) : '#3a4157';
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = shade(base, -0.45);
    Gfx.roundRect(ctx, bx, by + 3, bw, bh, 7);
    ctx.fill();
    ctx.restore();
    const g = ctx.createLinearGradient(0, by, 0, by + bh);
    g.addColorStop(0, shade(base, 0.12));
    g.addColorStop(1, shade(base, -0.2));
    ctx.fillStyle = g;
    Gfx.roundRect(ctx, bx, by, bw, bh, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    Gfx.roundRect(ctx, bx + 2, by + 2, bw - 4, 9, 5);
    ctx.fill();

    if (isTarget) {
      const pulse = 0.6 + 0.4 * Math.sin(clock * 10);
      ctx.save();
      ctx.shadowColor = '#ffc53d';
      ctx.shadowBlur = 12 * pulse;
      ctx.strokeStyle = alpha('#ffe066', 0.7 + 0.3 * pulse);
      ctx.lineWidth = 2;
      Gfx.roundRect(ctx, bx - 3, by - 3, bw + 6, bh + 6, 9);
      ctx.stroke();
      ctx.restore();
    } else if (danger > 0.6) {
      ctx.strokeStyle = alpha('#ff6b6b', 0.4 + 0.4 * Math.sin(clock * 14));
      ctx.lineWidth = 1.5;
      Gfx.roundRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, 8);
      ctx.stroke();
    }

    // Letters: typed ones glow gold.
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const doneText = w.text.slice(0, w.done);
    const dw = ctx.measureText(doneText).width;
    if (w.done) {
      ctx.save();
      ctx.shadowColor = '#ffb347';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffc53d';
      ctx.fillText(doneText, w.x, w.y);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(w.text.slice(w.done), w.x + dw, w.y + 2);
    ctx.fillStyle = danger > 0.5 ? '#ffb0b0' : '#eceef2';
    ctx.fillText(w.text.slice(w.done), w.x + dw, w.y);
    ctx.restore();
  }

  function drawShields() {
    const segW = (W - 40) / MAX_SHIELDS;
    for (let i = 0; i < MAX_SHIELDS; i++) {
      const x = 20 + i * segW + 4, y = GROUND + 15, w = segW - 8, h = 10;
      const on = i < shields;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      Gfx.roundRect(ctx, x, y + 2, w, h, 5);
      ctx.fill();
      if (on) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, '#9ef0ff');
        g.addColorStop(1, '#3a7bd9');
        ctx.save();
        ctx.shadowColor = '#4f8cff';
        ctx.shadowBlur = 8 + 4 * Math.sin(clock * 3 + i);
        ctx.fillStyle = g;
        Gfx.roundRect(ctx, x, y, w, h, 5);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        Gfx.roundRect(ctx, x + 3, y + 2, w - 6, 3, 1.5);
        ctx.fill();
      } else {
        ctx.fillStyle = '#2a2f39';
        Gfx.roundRect(ctx, x, y, w, h, 5);
        ctx.fill();
        // Crack marks on a lost shield.
        ctx.strokeStyle = 'rgba(255,107,107,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.3, y);
        ctx.lineTo(x + w * 0.4, y + h * 0.6);
        ctx.lineTo(x + w * 0.55, y + h * 0.3);
        ctx.lineTo(x + w * 0.65, y + h);
        ctx.stroke();
      }
    }
    // A thin force-field line above the street, fainter with fewer shields.
    const k = shields / MAX_SHIELDS;
    const fg = ctx.createLinearGradient(0, GROUND - 16, 0, GROUND);
    fg.addColorStop(0, alpha('#4f8cff', 0));
    fg.addColorStop(1, alpha('#4f8cff', 0.25 * k + 0.05 * Math.sin(clock * 4)));
    ctx.fillStyle = fg;
    ctx.fillRect(0, GROUND - 16, W, 16);
  }

  function drawStreak() {
    const m = multiplier();
    const x = W - 150, y = GROUND - 44, w = 134, h = 34;
    Gfx.card(ctx, x, y, w, h, { r: 9 });
    Gfx.text(ctx, `x${m}`, x + 22, y + h / 2 + 1, { size: 18, color: m > 1 ? '#ffc53d' : '#cfd5e0' });
    Gfx.text(ctx, `Streak ${streak}`, x + 44, y + 11, { size: 11, color: '#cfd5e0', align: 'left', stroke: null, weight: 700 });
    const into = m >= 5 ? 1 : (streak % 5) / 5;
    Gfx.bar(ctx, x + 44, y + 19, w - 54, 7, into, m >= 5 ? '#ff8a3d' : '#ffc53d');
  }

  function draw() {
    const off = shake.offset(9);
    ctx.save();
    ctx.translate(off.x, off.y);
    backdrop.draw(ctx, 0, 0);
    // Lightning flash every so often, from the clock.
    const bolt = (clock % 9.3);
    if (bolt < 0.18) {
      ctx.fillStyle = `rgba(200,220,255,${0.12 * (1 - bolt / 0.18)})`;
      ctx.fillRect(-10, -10, W + 20, GROUND + 10);
    }
    rain();
    drawShields();

    for (const w of words) if (w !== target) drawWord(w);
    if (target) drawWord(target);

    for (const r of rings) {
      const k = r.t / 0.45;
      ctx.strokeStyle = alpha(r.color, 1 - k);
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * ease.outCubic(k), 0, Math.PI * 2);
      ctx.stroke();
    }
    fx.draw(ctx);
    pops.draw(ctx);
    ctx.restore();

    if (state === 'playing' || state === 'paused') drawStreak();

    if (banner && time < banner.until) {
      const left = banner.until - time, age = 1.6 - left;
      const sc = ease.outBack(Math.min(1, age / 0.35));
      ctx.globalAlpha = Math.min(1, left * 2);
      ctx.save();
      ctx.translate(W / 2, H / 2 - 30);
      ctx.scale(sc, sc);
      Gfx.text(ctx, banner.text, 0, 0, { size: 44, color: '#fff', width: 6 });
      if (wave > 1) Gfx.text(ctx, '+1 shield', 0, 34, { size: 16, color: '#9ef0ff' });
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    if (flashT > 0) {
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
      vg.addColorStop(0, 'rgba(255,107,107,0)');
      vg.addColorStop(1, `rgba(255,107,107,${flashT * 3})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function updateFx(dt) {
    clock += dt;
    fx.update(dt);
    pops.update(dt);
    shake.update(dt);
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < 0.45);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    updateFx(state === 'paused' ? 0 : dt);
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
