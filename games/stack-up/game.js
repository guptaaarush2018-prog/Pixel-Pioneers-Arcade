/* Stack Up: drop sliding blocks onto the tower. Overhangs get sliced off, perfect drops keep the
   block whole, and every 10th block is golden: land it perfectly to get your full width back.
   Score is simply the tower's height. */
(() => {
  const W = 400, H = 640, BLOCK_H = 28, BASE_W = 220, PERFECT = 5;
  const GROUND = H - 80;
  const DX = 12, DY = 9;          // oblique depth: how far the top and side faces lean back
  const GOLD_EVERY = 10;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const { shade, alpha, ease } = Gfx;

  const fx = Gfx.particles(500);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();

  let state = 'ready';
  let stack, moving, debris, camY, perfects, rings, time, landT, banner;

  // Height bands the sky passes through on the way up.
  const BANDS = [
    { at: 0, name: null, top: '#5aa7e6', bot: '#bfe3f7' },
    { at: 20, name: 'Cloud layer', top: '#4a86d4', bot: '#a6d2f0' },
    { at: 40, name: 'Sunset heights', top: '#3a3f8f', bot: '#f29a6b' },
    { at: 60, name: 'Night sky', top: '#0d1230', bot: '#2a2f6b' },
    { at: 80, name: 'Outer space', top: '#04050f', bot: '#120d2e' },
  ];

  const isGold = i => i > 0 && i % GOLD_EVERY === 0;
  const hexColor = i => isGold(i) ? '#ffc53d' : hsl2hex((200 + i * 9) % 360, 62, 58 - (i % 2) * 5);
  const blockY = i => GROUND - (i + 1) * BLOCK_H;

  function hsl2hex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }

  function reset() {
    stack = [{ x: (W - BASE_W) / 2, w: BASE_W }];
    debris = [];
    rings = [];
    camY = 0;
    perfects = 0;
    time = 0;
    landT = -1;
    banner = null;
    fx.clear();
    pops.list.length = 0;
    newBlock();
    updateHud();
  }

  function newBlock() {
    const top = stack[stack.length - 1];
    const fromLeft = stack.length % 2 === 0;
    // One Math.random call per block, whatever the player does, so duel opponents stay in sync.
    const r = Math.random();
    let speed = Math.min(420, 160 + stack.length * 7);
    if (stack.length > 15) speed *= 0.85 + r * 0.35;   // past 15, block speed varies a little
    moving = { x: fromLeft ? -top.w : W, w: top.w, dir: fromLeft ? 1 : -1, speed };
  }

  function drop() {
    if (state !== 'playing') return;
    const top = stack[stack.length - 1];
    const i = stack.length;
    let { x, w } = moving;
    const y = blockY(i);

    if (Math.abs(x - top.x) <= PERFECT) {
      // Perfect drop: snap into place, and a run of them grows the block back.
      x = top.x;
      perfects++;
      if (perfects >= 5) Arcade.flag('stack-up-perfect');
      let label = perfects > 1 ? `Perfect ×${perfects}` : 'Perfect!';
      if (isGold(i)) {
        w = BASE_W;
        x = Math.max(0, Math.min(W - BASE_W, top.x + top.w / 2 - BASE_W / 2));
        label = 'Golden! Full width';
        shake.add(0.25);
        Arcade.tone({ freq: 784, to: 1568, dur: 0.35, type: 'triangle', vol: 0.06 });
      } else if (perfects >= 3) w = Math.min(BASE_W, w + 12);
      rings.push({ x, w, y, t: 0, gold: isGold(i) });
      sparkle(x, w, y, isGold(i) ? '#fff2b3' : '#ffffff', isGold(i) ? 40 : 18 + Math.min(perfects, 8) * 3);
      pops.add(label, W / 2, y - 18, { color: isGold(i) ? '#ffe066' : '#ffffff', size: 20 });
      Arcade.tone({ freq: 523 * Math.pow(1.06, Math.min(perfects, 12)), dur: 0.12, type: 'triangle', vol: 0.06 });
    } else {
      perfects = 0;
      const left = Math.max(x, top.x), right = Math.min(x + w, top.x + top.w);
      if (right <= left) {
        debris.push({ x, w, y, vy: 0, rot: 0, vr: moving.dir * 2, i });
        gameOver();
        return;
      }
      // Slice off whatever hangs over the edge.
      const cutLeft = x < top.x;
      const cutX = cutLeft ? x : right, cutW = w - (right - left);
      debris.push({ x: cutX, w: cutW, y, vy: -60, rot: 0, vr: (cutLeft ? -1 : 1) * Gfx.rand(1.5, 3), i });
      const edge = cutLeft ? left : right;
      fx.burst(10, () => ({
        x: edge, y: y + Gfx.rand(0, BLOCK_H), vx: (cutLeft ? -1 : 1) * Gfx.rand(40, 160), vy: Gfx.rand(-120, 20),
        drag: 1.5, life: Gfx.rand(0.4, 0.7), size: Gfx.rand(2, 4), color: shade(hexColor(i), Gfx.rand(-0.2, 0.3)), shape: 'square', spin: Gfx.rand(-8, 8),
      }));
      x = left;
      w = right - left;
      if (cutW > 30) shake.add(0.12);
      Arcade.tone({ freq: 300 + i * 6, dur: 0.06, vol: 0.04 });
    }
    stack.push({ x, w });
    landT = 0;
    if (stack.length > 75) Arcade.flag('stack-up-75');
    const band = BANDS.find(b => b.at === height());
    if (band && band.name) banner = { text: band.name, t: 0 };
    newBlock();
    updateHud();
  }

  function sparkle(x, w, y, col, n) {
    fx.burst(n, () => {
      const side = Gfx.rand() < 0.5;
      return {
        x: side ? (Gfx.rand() < 0.5 ? x : x + w) : x + Gfx.rand(0, w), y: y + Gfx.rand(-4, 6),
        vx: Gfx.rand(-90, 90), vy: Gfx.rand(-170, -40), drag: 2, life: Gfx.rand(0.5, 0.9),
        size: Gfx.rand(1.5, 3.2), color: col, shape: Gfx.rand() < 0.5 ? 'circle' : 'square', spin: 6,
      };
    });
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
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < 0.6);
    if (landT >= 0) { landT += dt; if (landT > 0.3) landT = -1; }
    if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }
    fx.update(dt);
    pops.update(dt);
    shake.update(dt);
  }

  const height = () => stack.length - 1;

  function updateHud() {
    $('score').textContent = height();
    $('best').textContent = Math.max(height(), Arcade.getBest(Arcade.gameId));
  }

  function gameOver() {
    state = 'over';
    shake.add(0.6);
    Arcade.tone({ freq: 220, to: 60, dur: 0.5, type: 'sawtooth', vol: 0.06 });
    setTimeout(() => Arcade.finish(ui, {
      score: height(),
      title: 'Tower complete',
      lines: [`${height()} block${height() === 1 ? '' : 's'} high`],
      onAction: start,
    }), 700);
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

  // A slab in oblique projection: front face, a top face leaning up-right and a right side face.
  function block(x, y, w, i, squash = 0) {
    const c = hexColor(i);
    const h = BLOCK_H * (1 - squash);
    const yy = y + BLOCK_H - h;
    // side
    ctx.fillStyle = shade(c, -0.38);
    ctx.beginPath();
    ctx.moveTo(x + w, yy); ctx.lineTo(x + w + DX, yy - DY); ctx.lineTo(x + w + DX, yy + h - DY); ctx.lineTo(x + w, yy + h);
    ctx.closePath(); ctx.fill();
    // top
    ctx.fillStyle = shade(c, 0.28);
    ctx.beginPath();
    ctx.moveTo(x, yy); ctx.lineTo(x + DX, yy - DY); ctx.lineTo(x + w + DX, yy - DY); ctx.lineTo(x + w, yy);
    ctx.closePath(); ctx.fill();
    // front
    const g = ctx.createLinearGradient(0, yy, 0, yy + h);
    g.addColorStop(0, shade(c, 0.06));
    g.addColorStop(1, shade(c, -0.14));
    ctx.fillStyle = g;
    ctx.fillRect(x, yy, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x, yy, w, 2);
    if (isGold(i)) {
      // Moving shine across golden blocks.
      const sx = x + ((time * 160) % (w + 60)) - 30;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, yy, w, h); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.moveTo(sx, yy + h); ctx.lineTo(sx + 12, yy); ctx.lineTo(sx + 26, yy); ctx.lineTo(sx + 14, yy + h);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function skyAt(h) {
    let a = BANDS[0], b = BANDS[0];
    for (let k = 0; k < BANDS.length; k++) {
      if (h >= BANDS[k].at) { a = BANDS[k]; b = BANDS[k + 1] || BANDS[k]; }
    }
    const t = b === a ? 0 : Math.min(1, (h - a.at) / (b.at - a.at));
    return { top: Gfx.mix(a.top, b.top, t), bot: Gfx.mix(a.bot, b.bot, t) };
  }

  // Fixed scenery, laid out once.
  const R = Gfx.rng(7);
  const stars = Array.from({ length: 90 }, () => ({ x: R() * W, y: R() * H, r: R() * 1.4 + 0.3, tw: R() * 6 }));
  const clouds = Array.from({ length: 14 }, (_, k) => ({ x: R() * W, alt: 19 + k * 2 + R() * 2, s: 0.6 + R() * 0.7, v: 6 + R() * 10 }));
  const city = Array.from({ length: 16 }, (_, k) => ({ x: k * 27 - 10, w: 22 + R() * 14, h: 40 + R() * 90 }));

  function drawCloud(x, y, s) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, 16 * s, 0, Math.PI * 2);
    ctx.arc(x + 18 * s, y - 8 * s, 20 * s, 0, Math.PI * 2);
    ctx.arc(x + 38 * s, y, 15 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x, y - 2 * s, 38 * s, 16 * s);
  }

  function draw() {
    const camH = -camY / BLOCK_H;   // how many blocks the camera has climbed
    const sky = skyAt(camH);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky.top);
    g.addColorStop(1, sky.bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Stars fade in once you're above the sunset.
    const starA = Math.max(0, Math.min(1, (camH - 45) / 20));
    if (starA > 0) {
      for (const s of stars) {
        ctx.globalAlpha = starA * (0.5 + 0.5 * Math.sin(time * 2 + s.tw));
        ctx.fillStyle = '#fff';
        ctx.fillRect(s.x, (s.y - camY * 0.05) % H, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }

    const o = shake.offset(9);
    ctx.save();
    ctx.translate(o.x, -camY + o.y);

    // Clouds drift past in a band partway up.
    for (const c of clouds) {
      const y = blockY(c.alt);
      if (y - camY < -60 || y - camY > H + 60) continue;
      const x = ((c.x + time * c.v) % (W + 120)) - 80;
      drawCloud(x, y, c.s);
    }

    // City skyline and ground.
    for (const b of city) {
      ctx.fillStyle = '#6d8db0';
      ctx.fillRect(b.x, GROUND - b.h, b.w, b.h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let wy = GROUND - b.h + 8; wy < GROUND - 8; wy += 12) {
        for (let wx = b.x + 4; wx < b.x + b.w - 5; wx += 8) ctx.fillRect(wx, wy, 3, 5);
      }
    }
    const gg = ctx.createLinearGradient(0, GROUND, 0, GROUND + 80);
    gg.addColorStop(0, '#5fae4e');
    gg.addColorStop(1, '#3d7d36');
    ctx.fillStyle = gg;
    ctx.fillRect(-20, GROUND, W + 40, 400);
    ctx.fillStyle = '#7cc764';
    ctx.fillRect(-20, GROUND, W + 40, 4);

    const base = stack[0];
    Gfx.shadow(ctx, base.x + base.w / 2 + DX / 2, GROUND + 4, base.w * 0.65, 10, 0.35);

    // Only draw what's on screen; tall towers get long.
    const firstVisible = Math.max(0, Math.floor((GROUND - (camY + H)) / BLOCK_H) - 1);
    for (let i = firstVisible; i < stack.length; i++) {
      const squash = i === stack.length - 1 && landT >= 0 ? Math.sin(Math.min(1, landT / 0.3) * Math.PI) * 0.18 : 0;
      block(stack[i].x, blockY(i), stack[i].w, i, squash);
    }
    if (state === 'playing' || state === 'paused') {
      const i = stack.length;
      const top = stack[stack.length - 1];
      // A faint guide shows where the block below sits.
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1;
      ctx.strokeRect(top.x + 0.5, blockY(i) + 0.5, top.w - 1, BLOCK_H - 1);
      ctx.setLineDash([]);
      block(moving.x, blockY(i), moving.w, i);
    }

    for (const r of rings) {
      const k = r.t / 0.6, grow = ease.outCubic(k) * 18;
      ctx.strokeStyle = alpha(r.gold ? '#ffe066' : '#ffffff', 1 - k);
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.strokeRect(r.x - grow, r.y - grow, r.w + grow * 2, BLOCK_H + grow * 2);
    }

    for (const d of debris) {
      ctx.save();
      ctx.translate(d.x + d.w / 2, d.y + BLOCK_H / 2);
      ctx.rotate(d.rot);
      block(-d.w / 2, -BLOCK_H / 2, d.w, d.i);
      ctx.restore();
    }

    fx.draw(ctx);
    pops.draw(ctx);
    ctx.restore();

    // Big faded height counter, plus a marker for the next golden block.
    Gfx.text(ctx, String(height()), W / 2, 96, { size: 64, color: 'rgba(255,255,255,0.9)', stroke: 'rgba(0,0,0,0.25)', width: 6, weight: 900 });
    if (state === 'playing') {
      const toGold = GOLD_EVERY - (height() % GOLD_EVERY) - 1;
      const msg = toGold === 0 ? 'Golden block! Land it perfectly' : `Golden block in ${toGold}`;
      Gfx.text(ctx, msg, W / 2, 138, { size: 13, color: toGold === 0 ? '#ffe066' : 'rgba(255,255,255,0.75)', width: 3 });
      if (perfects >= 2) Gfx.text(ctx, `Perfect streak ${perfects}`, W / 2, 158, { size: 13, color: '#9ef0ff', width: 3 });
    }
    if (banner) {
      const k = banner.t;
      const a = k < 0.3 ? k / 0.3 : k > 1.8 ? Math.max(0, 1 - (k - 1.8) / 0.4) : 1;
      ctx.globalAlpha = a;
      Gfx.card(ctx, W / 2 - 110, 190, 220, 40, { fill: 'rgba(15,20,40,0.7)', r: 20 });
      Gfx.text(ctx, banner.text, W / 2, 210, { size: 18, color: '#fff' });
      ctx.globalAlpha = 1;
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    else time += dt;
    animate(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => height(),
    intro: {
      title: 'Stack Up',
      html: `<ul>
        <li>Press <b>Space</b>, click, or tap to drop the sliding block.</li>
        <li>Any part hanging over the edge gets sliced off, so your blocks get narrower.</li>
        <li>Line it up perfectly to keep it whole. Three perfects in a row grow it back.</li>
        <li>Every 10th block is <b>golden</b>: land it perfectly to get your full width back.</li>
      </ul>`,
      button: 'Start stacking',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
