(() => {
  const W = 400, H = 640, BLOCK_H = 28, BASE_W = 220, PERFECT = 5;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'ready';
  let stack, moving, debris, camY, perfects, popups, time;

  const color = i => `hsl(${(200 + i * 9) % 360}, 65%, ${58 - (i % 2) * 4}%)`;
  const blockY = i => H - 80 - (i + 1) * BLOCK_H;

  function reset() {
    stack = [{ x: (W - BASE_W) / 2, w: BASE_W }];
    debris = [];
    popups = [];
    camY = 0;
    perfects = 0;
    time = 0;
    newBlock();
    updateHud();
  }

  function newBlock() {
    const top = stack[stack.length - 1];
    const fromLeft = stack.length % 2 === 0;
    const speed = Math.min(420, 160 + stack.length * 7);
    moving = { x: fromLeft ? -top.w : W, w: top.w, dir: fromLeft ? 1 : -1, speed };
  }

  function drop() {
    if (state !== 'playing') return;
    const top = stack[stack.length - 1];
    const i = stack.length;
    let { x, w } = moving;

    if (Math.abs(x - top.x) <= PERFECT) {
      // Perfect drop: snap into place, and a run of them grows the block back.
      x = top.x;
      perfects++;
      if (perfects >= 3) w = Math.min(BASE_W, w + 12);
      popups.push({ y: blockY(i), text: perfects > 1 ? `Perfect x${perfects}` : 'Perfect', life: 0.9 });
      Arcade.tone({ freq: 523 * Math.pow(1.06, Math.min(perfects, 12)), dur: 0.12, type: 'triangle', vol: 0.06 });
    } else {
      perfects = 0;
      const left = Math.max(x, top.x), right = Math.min(x + w, top.x + top.w);
      if (right <= left) {
        debris.push({ x, w, y: blockY(i), vy: 0, rot: 0, vr: moving.dir * 2, color: color(i) });
        gameOver();
        return;
      }
      // Slice off whatever hangs over the edge.
      const cutX = x < top.x ? x : right, cutW = w - (right - left);
      debris.push({ x: cutX, w: cutW, y: blockY(i), vy: 0, rot: 0, vr: (x < top.x ? -1 : 1) * Arcade.rand(1.5, 3), color: color(i) });
      x = left;
      w = right - left;
      Arcade.tone({ freq: 300 + i * 6, dur: 0.06, vol: 0.04 });
    }
    stack.push({ x, w });
    newBlock();
    updateHud();
  }

  function update(dt) {
    time += dt;
    moving.x += moving.dir * moving.speed * dt;
    if (moving.x < -moving.w * 0.6) moving.dir = 1;
    if (moving.x > W - moving.w * 0.4) moving.dir = -1;
  }

  function animate(dt) {
    // Keep the top of the tower in the upper part of the screen.
    const target = Math.min(0, blockY(stack.length) - H * 0.35);
    camY += (target - camY) * Math.min(1, dt * 5);
    for (const d of debris) {
      d.vy += 1400 * dt;
      d.y += d.vy * dt;
      d.rot += d.vr * dt;
    }
    debris = debris.filter(d => d.y - camY < H + 100);
    for (const p of popups) { p.y -= 30 * dt; p.life -= dt; }
    popups = popups.filter(p => p.life > 0);
  }

  const height = () => stack.length - 1;

  function updateHud() {
    $('score').textContent = height();
    $('best').textContent = Math.max(height(), Arcade.getBest(Arcade.gameId));
  }

  function gameOver() {
    state = 'over';
    Arcade.tone({ freq: 220, to: 60, dur: 0.5, type: 'sawtooth', vol: 0.06 });
    setTimeout(() => Arcade.finish(ui, {
      score: height(),
      title: 'Tower complete',
      lines: [`${height()} block${height() === 1 ? "" : "s"} high`],
      onAction: start,
    }), 500);
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
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

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (!e.repeat && (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'Enter')) drop();
  });
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); drop(); });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function block(x, y, w, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, BLOCK_H);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x, y + BLOCK_H - 3, w, 3);
  }

  function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const shift = Math.min(1, height() / 60);
    g.addColorStop(0, `hsl(${220 - shift * 30}, 30%, ${14 - shift * 6}%)`);
    g.addColorStop(1, `hsl(${220 - shift * 30}, 25%, ${22 - shift * 8}%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(0, -camY);
    ctx.fillStyle = '#232833';
    ctx.fillRect(0, H - 80, W, 400);

    // Only draw what's on screen; tall towers get long.
    const firstVisible = Math.max(0, Math.floor((H - 80 - (camY + H)) / BLOCK_H) - 1);
    for (let i = firstVisible; i < stack.length; i++) block(stack[i].x, blockY(i), stack[i].w, color(i));
    if (state === 'playing' || state === 'paused') block(moving.x, blockY(stack.length), moving.w, color(stack.length));

    for (const d of debris) {
      ctx.save();
      ctx.translate(d.x + d.w / 2, d.y + BLOCK_H / 2);
      ctx.rotate(d.rot);
      block(-d.w / 2, -BLOCK_H / 2, d.w, d.color);
      ctx.restore();
    }

    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = '#ffc53d';
      ctx.fillText(p.text, W / 2, p.y - 10);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.font = '700 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillText(height(), W / 2, 110);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    animate(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  ui.show({
    title: 'Stack Up',
    html: `<ul>
      <li>Press <b>Space</b>, click, or tap to drop the sliding block.</li>
      <li>Any part hanging over the edge gets sliced off, so your blocks get narrower.</li>
      <li>Line it up perfectly to keep it whole. Three perfects in a row grow it back.</li>
    </ul>`,
    button: 'Start stacking',
    onAction: start,
  });
  requestAnimationFrame(frame);
})();
