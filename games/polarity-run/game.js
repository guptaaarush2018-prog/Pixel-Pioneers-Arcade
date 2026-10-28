(() => {
  const ID = 'polarity-run';
  const W = 800, H = 400, CEIL = 70, FLOOR = 330, PS = 30, PX = 160;
  const GRAVITY = 2800, BASE_SPEED = 360, MAX_SPEED = 880, SPIKE = 20;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  const stars = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Arcade.rand(CEIL, FLOOR), z: Arcade.rand(0.1, 0.5) }));

  let state = 'ready';
  let player, obstacles, shards, particles;
  let speed, distance, shardCount, time, lastEnd, lastSide, bufferUntil, shake, scroll;

  function reset() {
    player = { y: FLOOR - PS, vy: 0, g: 1, grounded: true, rot: 0, squash: 0, trail: [] };
    obstacles = [];
    shards = [];
    particles = [];
    speed = BASE_SPEED;
    distance = 0;
    shardCount = 0;
    time = 0;
    lastEnd = W + 200;
    lastSide = 'ceil';
    bufferUntil = 0;
    shake = 0;
    scroll = 0;
    updateHud();
  }

  // Obstacles alternate sides with enough room to flip between them. A flip takes ~0.4s,
  // so opposite-side gaps scale with speed; same-side gaps can be short since you just stay put.
  function addObstacle() {
    const side = Math.random() < 0.55 ? (lastSide === 'floor' ? 'ceil' : 'floor') : lastSide;
    const switching = side !== lastSide;
    const gap = switching ? speed * 0.55 + 70 + Arcade.rand(0, 220) : Arcade.rand(30, 160);
    const w = SPIKE * Arcade.randInt(2, 8);
    const tall = Math.random() < 0.25 + Math.min(0.2, time / 300);
    const h = tall ? Arcade.rand(80, 120) : 26;
    const x = lastEnd + gap;
    obstacles.push({ x, w, h, side });

    if (switching && Math.random() < 0.6) {
      // Shards along the flip path reward well-timed flips.
      const cx = lastEnd + gap / 2;
      for (const y of [140, 200, 260]) shards.push({ x: cx, y });
    } else if (!switching && gap > 100 && Math.random() < 0.4) {
      const y = side === 'floor' ? CEIL + 18 : FLOOR - 18;
      shards.push({ x: lastEnd + gap / 2, y });
    }
    lastEnd = x + w;
    lastSide = side;
  }

  function flip() {
    if (state !== 'playing') return;
    if (player.grounded) doFlip();
    else bufferUntil = time + 0.15; // buffered: flips the moment you land
  }

  function doFlip() {
    player.g *= -1;
    player.grounded = false;
    player.vy = player.g * 150;
    bufferUntil = 0;
    Arcade.tone({ freq: player.g === 1 ? 520 : 780, to: player.g === 1 ? 300 : 1100, dur: 0.09, type: 'triangle', vol: 0.05 });
  }

  function land() {
    if (player.grounded) return;
    player.grounded = true;
    player.vy = 0;
    player.squash = 1;
    for (let i = 0; i < 5; i++) {
      particles.push({
        x: PX + Math.random() * PS, y: player.g === 1 ? FLOOR : CEIL,
        vx: Arcade.rand(-200, -40), vy: -player.g * Arcade.rand(20, 120),
        life: 0.35, color: player.g === 1 ? '#ff4fd8' : '#3ef0ff',
      });
    }
    if (time < bufferUntil) doFlip();
  }

  function hitBox(o) {
    return o.side === 'floor'
      ? { x: o.x + 4, y: FLOOR - o.h + 6, w: o.w - 8, h: o.h - 6 }
      : { x: o.x + 4, y: CEIL, w: o.w - 8, h: o.h - 6 };
  }

  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function update(dt) {
    time += dt;
    speed = Math.min(MAX_SPEED, BASE_SPEED + time * 9);
    const dx = speed * dt;
    distance += dx;
    scroll += dx;

    player.vy += player.g * GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.g === 1 && player.y >= FLOOR - PS) { player.y = FLOOR - PS; land(); }
    if (player.g === -1 && player.y <= CEIL) { player.y = CEIL; land(); }
    player.rot += ((player.g === 1 ? 0 : Math.PI) - player.rot) * Math.min(1, dt * 14);
    player.squash = Math.max(0, player.squash - dt * 6);
    player.trail.unshift(player.y);
    player.trail.length = Math.min(player.trail.length, 6);

    for (const o of obstacles) o.x -= dx;
    for (const s of shards) s.x -= dx;
    lastEnd -= dx;
    obstacles = obstacles.filter(o => o.x + o.w > -20);
    while (lastEnd < W + 300) addObstacle();

    const me = { x: PX + 4, y: player.y + 4, w: PS - 8, h: PS - 8 };
    for (const o of obstacles) {
      if (overlaps(me, hitBox(o))) {
        crash();
        return;
      }
    }

    shards = shards.filter(s => {
      if (s.x < -20) return false;
      if (overlaps(me, { x: s.x - 9, y: s.y - 9, w: 18, h: 18 })) {
        shardCount++;
        Arcade.tone({ freq: 1000 + (shardCount % 5) * 120, dur: 0.05, vol: 0.035 });
        return false;
      }
      return true;
    });

    updateHud();
  }

  const score = () => Math.floor(distance / 20) + shardCount * 25;

  function updateHud() {
    $('score').textContent = score();
    $('speed').textContent = (speed / BASE_SPEED).toFixed(1) + 'x';
    $('best').textContent = Math.max(score(), Arcade.getBest(ID));
  }

  function crash() {
    state = 'over';
    shake = 14;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, s = Arcade.rand(80, 360);
      particles.push({ x: PX + PS / 2, y: player.y + PS / 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: Arcade.rand(0.4, 1), color: Arcade.pick(['#ff4fd8', '#3ef0ff', '#ffffff']) });
    }
    Arcade.tone({ freq: 220, to: 40, dur: 0.6, type: 'sawtooth', vol: 0.07 });
    const s = score();
    Arcade.finish(ui, {
      score: s,
      title: 'Crashed!',
      lines: [`${Math.floor(distance / 20)}m run · ${shardCount} shard${shardCount === 1 ? "" : "s"}`],
      button: 'Run again',
      onAction: start,
    });
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
    if (!e.repeat && ['Space', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(e.code)) flip();
  });
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); flip(); });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function drawSpikes(o) {
    const floor = o.side === 'floor';
    const color = floor ? '#ff4fd8' : '#3ef0ff';
    const base = floor ? FLOOR : CEIL;
    const dir = floor ? -1 : 1;
    const bodyH = o.h - 26;
    if (bodyH > 0) {
      ctx.fillStyle = '#251f4d';
      ctx.fillRect(o.x, floor ? base - bodyH : base, o.w, bodyH);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, (floor ? base - bodyH : base) + 1, o.w - 2, bodyH - 2);
    }
    const tipBase = base + dir * bodyH;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let x = o.x; x < o.x + o.w; x += SPIKE) {
      ctx.moveTo(x, tipBase);
      ctx.lineTo(x + SPIKE / 2, tipBase + dir * 26);
      ctx.lineTo(x + SPIKE, tipBase);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawPlayer() {
    const cx = PX + PS / 2, cy = player.y + PS / 2;
    for (let i = player.trail.length - 1; i >= 1; i--) {
      ctx.globalAlpha = 0.15 * (1 - i / player.trail.length);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(PX - i * 7, player.trail[i], PS, PS);
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(player.rot);
    const sq = player.squash * 0.2;
    ctx.scale(1 + sq, 1 - sq);
    const g = ctx.createLinearGradient(0, -PS / 2, 0, PS / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#ffd23f');
    ctx.fillStyle = g;
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.roundRect(-PS / 2, -PS / 2, PS, PS, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a1033';
    ctx.fillRect(4, -6, 6, 8);
    ctx.fillRect(-6, -6, 4, 8);
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(Arcade.rand(-shake, shake), Arcade.rand(-shake, shake));

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b0a1a');
    bg.addColorStop(0.5, '#1d1140');
    bg.addColorStop(1, '#0b0a1a');
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    for (const s of stars) {
      const x = (((s.x - scroll * s.z) % W) + W) % W;
      ctx.fillStyle = `rgba(255,255,255,${s.z + 0.2})`;
      ctx.fillRect(x, s.y, 2 * s.z + 1, 1);
    }

    // Floor and ceiling with scrolling grid lines.
    ctx.fillStyle = '#140d2e';
    ctx.fillRect(-20, FLOOR, W + 40, H - FLOOR + 20);
    ctx.fillRect(-20, -20, W + 40, CEIL + 20);
    ctx.strokeStyle = 'rgba(255, 79, 216, 0.25)';
    ctx.lineWidth = 1;
    const off = scroll % 40;
    ctx.beginPath();
    for (let x = -off; x < W; x += 40) {
      ctx.moveTo(x, FLOOR); ctx.lineTo(x - 30, H);
      ctx.moveTo(x, CEIL); ctx.lineTo(x - 30, 0);
    }
    ctx.stroke();
    ctx.fillStyle = '#ff4fd8';
    ctx.fillRect(-20, FLOOR, W + 40, 3);
    ctx.fillStyle = '#3ef0ff';
    ctx.fillRect(-20, CEIL - 3, W + 40, 3);

    for (const s of shards) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(time * 3);
      ctx.fillStyle = '#ffd23f';
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(6, 0); ctx.lineTo(0, 8); ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (const o of obstacles) drawSpikes(o);
    if (state !== 'over') drawPlayer();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
    shake = Math.max(0, shake - dt * 40);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  ui.show({
    title: 'Polarity Run',
    html: `<ul>
      <li>Press <b>Space</b> or tap to flip gravity between the floor and the ceiling.</li>
      <li>You can only flip once you've landed, so plan ahead. Pressing just before you land still counts.</li>
      <li>Grab <b style="color:#ffd23f">shards</b> for bonus points. The run speeds up over time.</li>
    </ul>`,
    button: 'Run',
    onAction: start,
  });
  requestAnimationFrame(frame);
})();
