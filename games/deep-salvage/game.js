/* Deep Salvage: a side-view diving run. Pilot a one-person sub through a sunken trench, grab
   treasure from the seabed, dodge mines and jellyfish, and keep an eye on the oxygen. Three
   tanks per run; surfacing refills the tank. Chaining pickups multiplies the haul. */
(() => {
  const W = 860, H = 520, TAU = Math.PI * 2;
  const SURFACE = 64, SEABED = H - 52;
  const ACC = 540, MAXV = 235;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  const TREASURE = [
    { value: 150, r: 11, color: '#c98a3c' },
    { value: 250, r: 12, color: '#d8a44a' },
    { value: 400, r: 13, color: '#ffc53d' },
    { value: 600, r: 15, color: '#ffe066' },
  ];

  let state = 'ready';
  let sub, ox, tanks, haul, combo, comboT, bestDepth, time, camX, spawnX, objects, particles, bubbles, pointer, shake, message, messageT, invuln, tankFlash;

  function reset() {
    sub = { x: 160, y: SURFACE + 120, vx: 0, vy: 0, thrust: 0, prop: 0 };
    ox = 100;
    tanks = 3;
    haul = 0;
    combo = 0;
    comboT = 0;
    bestDepth = 0;
    time = 0;
    camX = 0;
    spawnX = 380;
    objects = [];
    particles = [];
    bubbles = [];
    pointer = null;
    shake = 0;
    message = '';
    messageT = 0;
    invuln = 0;
    tankFlash = 0;
    for (let i = 0; i < 26; i++) bubbles.push({ x: rand(0, W), y: rand(SURFACE, H), r: rand(1, 4), v: rand(10, 34), sway: Math.random() * TAU });
    spawnAhead(true);
    updateHud();
  }

  const depthM = () => Math.max(0, Math.round((sub.y - SURFACE) / 8 + sub.x / 620));
  const total = () => Math.round(haul + bestDepth * 4);
  const pressure = () => 1 + sub.x / 6000;

  function spawnAhead(first = false) {
    while (spawnX < sub.x + W * 1.5) {
      spawnChunk(spawnX);
      spawnX += rand(130, 240);
    }
    if (first) {
      // A couple of easy pickups right in front of the start.
      addTreasure(300, SURFACE + 150, 0);
      addTreasure(430, SURFACE + 250, 2);
    }
  }

  function addTreasure(x, y, tier) {
    const t = TREASURE[tier] || pick(TREASURE);
    const d = (y - SURFACE) / (SEABED - SURFACE);
    objects.push({ kind: 'treasure', x, y, r: t.r + 4, value: Math.round(t.value * (0.8 + d * 0.8) * pressure()), color: t.color, bob: Math.random() * TAU, got: false });
  }

  function spawnChunk(x) {
    const roll = Math.random();
    if (roll < 0.42) {
      const y = rand(SURFACE + 90, SEABED - 30);
      const deep = (y - SURFACE) / (SEABED - SURFACE);
      addTreasure(x + rand(0, 60), y, deep > 0.72 ? (Math.random() < 0.45 ? 3 : 2) : deep > 0.35 ? 1 + (Math.random() < 0.4 ? 1 : 0) : 0);
    } else if (roll < 0.6) {
      objects.push({ kind: 'rock', x: x + rand(0, 50), y: SEABED - rand(6, 26), r: rand(24, 52), seed: Math.random() * TAU });
    } else if (roll < 0.79) {
      objects.push({ kind: 'mine', x: x + rand(0, 60), y: rand(SURFACE + 100, SEABED - 40), r: 17, phase: Math.random() * TAU, drift: rand(-8, 8) });
    } else if (roll < 0.93) {
      objects.push({ kind: 'jelly', x: x + rand(0, 60), y: rand(SURFACE + 90, SEABED - 70), r: 16, phase: Math.random() * TAU });
    } else {
      for (let i = 0; i < 4; i++) objects.push({ kind: 'fish', x: x + rand(-30, 70), y: rand(SURFACE + 60, SEABED - 60), r: 4, phase: Math.random() * TAU, v: rand(14, 30) });
    }
  }

  function noiseBurst(x, y, n, color = '#bfe9ff') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(20, 140);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.35, 0.8), size: rand(1, 3), color });
    }
  }

  function hurt(amount, from) {
    if (invuln > 0) return;
    ox -= amount;
    invuln = 0.9;
    shake = 9;
    const dx = sub.x - from.x, dy = sub.y - from.y, d = Math.hypot(dx, dy) || 1;
    sub.vx += (dx / d) * 150;
    sub.vy += (dy / d) * 150;
    noiseBurst(sub.x, sub.y, 12, '#ffb4a2');
    Arcade.tone({ freq: 180, to: 70, dur: 0.25, type: 'sawtooth', vol: 0.05 });
    if (ox <= 0) burstTank();
  }

  function burstTank() {
    tanks--;
    combo = 0;
    comboT = 0;
    tankFlash = 1.4;
    Arcade.tone({ freq: 320, to: 60, dur: 0.6, type: 'sawtooth', vol: 0.07 });
    if (tanks <= 0) return gameOver();
    ox = 100;
    sub.y = SURFACE + 34;
    sub.vy = 0;
    invuln = 2.2;
    message = 'Tank empty! Back to the surface';
    messageT = 2.2;
  }

  function collect(t) {
    t.got = true;
    combo = comboT > 0 ? Math.min(4, combo + 1) : 1;
    comboT = 2.6;
    const gain = t.value * combo;
    haul += gain;
    ox = Math.min(100, ox + 1.5);
    noiseBurst(t.x, t.y, 18, '#ffe066');
    Arcade.tone({ freq: 660 + combo * 90, to: 1180, dur: 0.12, type: 'triangle', vol: 0.05 });
    Arcade.tone({ freq: 990, dur: 0.09, type: 'sine', vol: 0.03, delay: 0.05 });
    message = combo > 1 ? `TREASURE ×${combo}  +${gain.toLocaleString()}` : `TREASURE  +${gain.toLocaleString()}`;
    messageT = 1.2;
    if (combo >= 4) Arcade.flag('deep-salvage-combo');
    if (t.value >= 600) Arcade.flag('deep-salvage-chest');
    updateHud();
  }

  function gameOver() {
    state = 'over';
    Arcade.tone({ freq: 220, to: 50, dur: 0.7, type: 'sawtooth', vol: 0.06 });
    setTimeout(() => Arcade.finish(ui, {
      score: total(),
      title: 'Out of air',
      lines: [`${haul.toLocaleString()} hauled · deepest ${bestDepth} m`],
      onAction: start,
    }), 500);
  }

  function update(dt) {
    time += dt;
    if (messageT > 0) messageT -= dt;
    if (tankFlash > 0) tankFlash -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (invuln > 0) invuln -= dt;

    for (const p of particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx -= p.vx * 2 * dt;
      p.vy -= p.vy * 2 * dt;
    }
    particles = particles.filter(p => p.life < p.max);

    for (const b of bubbles) {
      b.y -= b.v * dt;
      b.x += Math.sin(time * 1.4 + b.sway) * 9 * dt;
      if (b.y < SURFACE) { b.y = H + rand(0, 30); b.x = camX + rand(0, W); }
    }

    if (state !== 'playing') return;

    let ax = 0, ay = 0;
    if (pointer) {
      const tx = pointer.x + camX, ty = pointer.y;
      const dx = tx - sub.x, dy = ty - sub.y, d = Math.hypot(dx, dy);
      if (d > 12) { ax = dx / d; ay = dy / d; }
    } else {
      if (keys.left) ax -= 1;
      if (keys.right) ax += 1;
      if (keys.up) ay -= 1;
      if (keys.down) ay += 1;
      const m = Math.hypot(ax, ay) || 1;
      ax /= m;
      ay /= m;
    }
    const boosting = (keys.boost || false) && ox > 2 && (ax || ay);
    const power = boosting ? 1.85 : 1;
    sub.vx += ax * ACC * power * dt;
    sub.vy += ay * ACC * power * dt;
    sub.vx *= Math.exp(-2.3 * dt);
    sub.vy *= Math.exp(-2.3 * dt);
    const sp = Math.hypot(sub.vx, sub.vy);
    if (sp > MAXV * (boosting ? 1.28 : 1)) {
      const k = (MAXV * (boosting ? 1.28 : 1)) / sp;
      sub.vx *= k;
      sub.vy *= k;
    }
    sub.x += sub.vx * dt;
    sub.y += sub.vy * dt;
    sub.thrust += ((ax || ay) ? 1 : 0) * dt * 6;
    sub.prop += sp * dt * 0.06 + 1.5 * dt;
    if (boosting) noiseBurst(sub.x - 26, sub.y + rand(-4, 4), 1, '#9fe8ff');

    sub.x = Math.max(50, sub.x);
    sub.y = clamp(sub.y, SURFACE + 10, SEABED - 16);

    // Oxygen: the surface refills, depth and boosting burn it faster.
    const atSurface = sub.y < SURFACE + 30;
    if (atSurface) {
      ox = Math.min(100, ox + 28 * dt);
    } else {
      const deep = sub.y > SEABED * 0.68 ? 0.5 : 0;
      ox -= (0.95 + deep + (boosting ? 0.9 : 0)) * dt;
      if (ox <= 0) burstTank();
    }
    if (!atSurface && ox > 0) bestDepth = Math.max(bestDepth, depthM());
    if (bestDepth >= 35) Arcade.flag('deep-salvage-deep');

    comboT = Math.max(0, comboT - dt);
    if (comboT <= 0) combo = 0;

    // Camera follows a little ahead of the sub.
    const target = Math.max(0, sub.x - W * 0.36);
    camX += (target - camX) * Math.min(1, dt * 3.2);

    spawnAhead();

    for (const o of objects) {
      if (o.kind === 'treasure') {
        o.bob += dt * 2;
        o.y += Math.sin(o.bob) * 4 * dt;
        if (!o.got && Math.hypot(o.x - sub.x, o.y - sub.y) < o.r + 15) collect(o);
      } else if (o.kind === 'mine') {
        o.y += Math.sin(time * 1.1 + o.phase) * 14 * dt;
        o.x += o.drift * dt;
        if (Math.hypot(o.x - sub.x, o.y - sub.y) < o.r + 13) hurt(13, o);
      } else if (o.kind === 'jelly') {
        o.y += Math.sin(time * 1.3 + o.phase) * 26 * dt;
        if (Math.hypot(o.x - sub.x, o.y - sub.y) < o.r + 12) hurt(8, o);
      } else if (o.kind === 'rock') {
        const d = Math.hypot(o.x - sub.x, o.y - sub.y), min = o.r * 0.8 + 13;
        if (d < min && d > 0) {
          sub.x += (sub.x - o.x) / d * (min - d);
          sub.y += (sub.y - o.y) / d * (min - d);
          sub.vx *= 0.4;
          sub.vy *= 0.4;
        }
      } else if (o.kind === 'fish') {
        o.x += o.v * dt;
      }
    }
    objects = objects.filter(o => o.x > camX - 260 && o.x < sub.x + 2400 && !(o.kind === 'fish' && o.x > sub.x + 1800));

    updateHud();
  }

  // ---------- Drawing ----------

  const kelp = Array.from({ length: 26 }, (_, i) => ({ x: i * 90 + 30, h: rand(60, 180), sway: Math.random() * TAU }));

  function drawSub() {
    ctx.save();
    ctx.translate(sub.x - camX, sub.y + Math.sin(time * 1.8) * 2);
    ctx.rotate(clamp(sub.vy / 900, -0.22, 0.22));
    if (invuln > 0 && Math.floor(time * 14) % 2) ctx.globalAlpha = 0.45;

    // Headlight cone.
    const beam = ctx.createRadialGradient(26, 0, 4, 150, 0, 190);
    beam.addColorStop(0, 'rgba(255,244,200,0.28)');
    beam.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(20, -8);
    ctx.lineTo(240, -80);
    ctx.lineTo(240, 80);
    ctx.lineTo(20, 8);
    ctx.closePath();
    ctx.fill();

    // Propeller.
    ctx.save();
    ctx.translate(-33, 0);
    ctx.rotate(sub.prop);
    ctx.fillStyle = 'rgba(180,220,240,0.6)';
    ctx.fillRect(-3, -11, 6, 22);
    ctx.restore();

    // Hull.
    const hull = ctx.createLinearGradient(0, -16, 0, 16);
    hull.addColorStop(0, '#ffd95e');
    hull.addColorStop(1, '#d98f16');
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 15, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffefae';
    ctx.beginPath();
    ctx.ellipse(-4, -5, 18, 5, -0.2, 0, TAU);
    ctx.fill();
    // Window.
    ctx.fillStyle = '#0d3346';
    ctx.beginPath();
    ctx.arc(12, 0, 8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#7fe4ff';
    ctx.beginPath();
    ctx.arc(13.5, -1.5, 5.2, 0, TAU);
    ctx.fill();
    // Fin and skid.
    ctx.fillStyle = '#c47f12';
    ctx.beginPath();
    ctx.moveTo(-18, -11);
    ctx.lineTo(-26, -24);
    ctx.lineTo(-9, -13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8a5a0a';
    ctx.fillRect(-20, 13, 34, 4);

    // Exhaust bubbles.
    if (Math.random() < 0.55) bubbles.push({ x: camX + sub.x - 30, y: sub.y + rand(-4, 4), r: rand(1, 3.2), v: rand(20, 44), sway: Math.random() * TAU });
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function draw() {
    const sx = shake ? rand(-shake, shake) * 0.4 : 0, sy = shake ? rand(-shake, shake) * 0.4 : 0;
    const depth = clamp((sub.y - SURFACE) / (SEABED - SURFACE), 0, 1);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, `hsl(196 62% ${26 + depth * -8}%)`);
    bg.addColorStop(0.5, `hsl(198 70% ${16 - depth * 4}%)`);
    bg.addColorStop(1, '#04121a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Sun shafts.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = (i * 210 + Math.sin(time * 0.12 + i) * 40) - (camX * 0.06) % 300;
      const g = ctx.createLinearGradient(x, 0, x + 130, H);
      g.addColorStop(0, 'rgba(150,230,255,0.10)');
      g.addColorStop(1, 'rgba(150,230,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 90, 0);
      ctx.lineTo(x + 260, H);
      ctx.lineTo(x + 120, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Distant kelp silhouettes.
    ctx.strokeStyle = 'rgba(8,46,58,0.75)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (const k of kelp) {
      const x = k.x - (camX * 0.35) % 2600;
      if (x < -60 || x > W + 60) continue;
      ctx.beginPath();
      ctx.moveTo(x, SEABED);
      ctx.quadraticCurveTo(x + Math.sin(time * 0.8 + k.sway) * 26, SEABED - k.h * 0.55, x + Math.sin(time * 0.6 + k.sway) * 40, SEABED - k.h);
      ctx.stroke();
    }

    // Seabed.
    ctx.fillStyle = '#6c5a3a';
    ctx.beginPath();
    ctx.moveTo(-10, H);
    for (let x = -10; x <= W + 10; x += 20) {
      const wx = x + camX;
      ctx.lineTo(x, SEABED + Math.sin(wx * 0.006) * 7 + Math.sin(wx * 0.017) * 3);
    }
    ctx.lineTo(W + 10, H);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8f7a52';
    ctx.beginPath();
    ctx.moveTo(-10, H);
    for (let x = -10; x <= W + 10; x += 20) {
      const wx = x + camX;
      ctx.lineTo(x, SEABED + Math.sin(wx * 0.006) * 7 + Math.sin(wx * 0.017) * 3 - 3);
    }
    ctx.lineTo(W + 10, H);
    ctx.closePath();
    ctx.fill();

    // Objects.
    for (const o of objects) {
      const x = o.x - camX;
      if (x < -120 || x > W + 120) continue;
      if (o.kind === 'rock') {
        ctx.fillStyle = '#2f3f45';
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU;
          const r = o.r * (0.75 + 0.25 * Math.sin(i * 2.7 + o.seed));
          const px = x + Math.cos(a) * r, py = o.y + Math.sin(a) * r * 0.7;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(150,180,170,0.18)';
        ctx.beginPath();
        ctx.arc(x - o.r * 0.25, o.y - o.r * 0.3, o.r * 0.3, 0, TAU);
        ctx.fill();
      } else if (o.kind === 'mine') {
        ctx.fillStyle = '#2a3238';
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + o.phase;
          ctx.fillRect(x + Math.cos(a) * (o.r - 2) - 2, o.y + Math.sin(a) * (o.r - 2) - 2, 9, 4);
        }
        ctx.beginPath();
        ctx.arc(x, o.y, o.r, 0, TAU);
        ctx.fill();
        const blink = 0.5 + 0.5 * Math.sin(time * 5 + o.phase);
        ctx.fillStyle = `rgba(255,70,70,${0.4 + blink * 0.6})`;
        ctx.beginPath();
        ctx.arc(x, o.y, 4, 0, TAU);
        ctx.fill();
      } else if (o.kind === 'jelly') {
        const wob = Math.sin(time * 2.2 + o.phase);
        ctx.fillStyle = 'rgba(200,140,255,0.5)';
        ctx.beginPath();
        ctx.ellipse(x, o.y, o.r + wob * 2, o.r * 0.8, 0, Math.PI, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(220,180,255,0.45)';
        ctx.lineWidth = 2;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * 5, o.y);
          ctx.quadraticCurveTo(x + i * 5 + wob * 6, o.y + 14, x + i * 6 + wob * 4, o.y + 26);
          ctx.stroke();
        }
      } else if (o.kind === 'fish') {
        ctx.fillStyle = 'rgba(140,220,235,0.5)';
        ctx.beginPath();
        ctx.ellipse(x, o.y + Math.sin(time * 2 + o.phase) * 5, 7, 3, 0, 0, TAU);
        ctx.fill();
      } else if (o.kind === 'treasure' && !o.got) {
        const bob = Math.sin(o.bob) * 3;
        const glow = ctx.createRadialGradient(x, o.y + bob, 2, x, o.y + bob, o.r * 3);
        glow.addColorStop(0, 'rgba(255,214,90,0.35)');
        glow.addColorStop(1, 'rgba(255,214,90,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - o.r * 3, o.y + bob - o.r * 3, o.r * 6, o.r * 6);
        ctx.fillStyle = '#7a4e20';
        ctx.fillRect(x - o.r, o.y - o.r * 0.6 + bob, o.r * 2, o.r * 1.2);
        ctx.fillStyle = o.color;
        ctx.fillRect(x - o.r, o.y - 2 + bob, o.r * 2, 4);
        ctx.fillRect(x - 3, o.y - o.r * 0.6 + bob, 6, o.r * 1.2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x - o.r + 2, o.y - o.r * 0.6 + bob + 2, o.r * 0.6, 2);
      }
    }

    // Bubbles and particles.
    ctx.fillStyle = 'rgba(200,240,255,0.4)';
    for (const b of bubbles) {
      const x = b.x - camX;
      if (x < -20 || x > W + 20) continue;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, TAU);
      ctx.fill();
    }
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - camX, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (state !== 'over') drawSub();

    // Surface line.
    ctx.fillStyle = 'rgba(160,240,255,0.25)';
    ctx.fillRect(0, 0, W, SURFACE - 24);
    ctx.strokeStyle = 'rgba(200,250,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 10) {
      const y = SURFACE - 24 + Math.sin(x * 0.03 + time * 2) * 4;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    // HUD.
    ctx.save();
    ctx.translate(sx, sy);
    drawHud();
    ctx.restore();
  }

  function drawHud() {
    // Oxygen.
    ctx.fillStyle = 'rgba(8,20,28,0.72)';
    ctx.beginPath();
    ctx.roundRect(16, 16, 236, 54, 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('OXYGEN', 28, 38);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.roundRect(28, 45, 210, 12, 6);
    ctx.fill();
    const oc = ox > 45 ? '#3ddc84' : ox > 20 ? '#ffc53d' : '#ff5252';
    ctx.fillStyle = oc;
    ctx.beginPath();
    ctx.roundRect(28, 45, Math.max(4, 210 * clamp(ox / 100, 0, 1)), 12, 6);
    ctx.fill();
    if (ox < 25) {
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(time * 8);
      ctx.strokeStyle = '#ff5252';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, W - 8, H - 8);
      ctx.globalAlpha = 1;
    }

    // Tanks.
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < tanks ? '#7fe4ff' : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.roundRect(272 + i * 26, 30, 18, 30, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(8,20,28,0.6)';
      ctx.fillRect(279 + i * 26, 26, 4, 6);
    }

    // Haul and depth.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd25e';
    ctx.font = '900 24px system-ui, sans-serif';
    ctx.fillText(total().toLocaleString(), W - 20, 42);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(`HAUL · ${depthM()} m`, W - 20, 60);

    if (combo > 1) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd25e';
      ctx.font = '900 26px system-ui, sans-serif';
      ctx.fillText(`×${combo}`, W / 2, 44);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillText('CHAIN', W / 2, 58);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(W / 2 - 40, 64, 80, 3);
      ctx.fillStyle = '#ffd25e';
      ctx.fillRect(W / 2 - 40, 64, 80 * (comboT / 2.6), 3);
    }

    if (messageT > 0) {
      ctx.globalAlpha = clamp(messageT / 0.4, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = tankFlash > 0 ? '#ff8a80' : '#7fe4ff';
      ctx.font = '900 20px system-ui, sans-serif';
      ctx.fillText(message, W / 2, H - 40);
      ctx.globalAlpha = 1;
    }
    if (state === 'playing' && sub.y > SURFACE + 34 && time < 7) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText('Dive for treasure · surface to refill oxygen', W / 2, H - 78);
    }
  }

  function updateHud() {
    $('score').textContent = total().toLocaleString();
    $('depth').textContent = `${depthM()} m`;
    $('tanks').textContent = Math.max(0, tanks);
  }

  // ---------- Input ----------

  const keys = { left: false, right: false, up: false, down: false, boost: false };
  const KEYS = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ShiftLeft: 'boost', ShiftRight: 'boost', Space: 'boost',
  };
  const uiOpen = () => !overlayEl.hidden;

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  canvas.addEventListener('pointerdown', e => {
    if (uiOpen() || state !== 'playing') return;
    e.preventDefault();
    pointer = toCanvas(e);
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointermove', e => { if (pointer) pointer = toCanvas(e); });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { pointer = null; });
  window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') pointer = null; }, true);

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') { state = 'paused'; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); }
      else if (state === 'paused') resume();
      return;
    }
    const k = KEYS[e.code];
    if (k && !uiOpen()) {
      keys[k] = true;
      pointer = null;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => {
    const k = KEYS[e.code];
    if (k) keys[k] = false;
  });
  function resume() { state = 'playing'; ui.hide(); }
  Arcade.onBlur(() => { if (state === 'playing') { state = 'paused'; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); } });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => total(),
    intro: {
      title: 'Deep Salvage',
      html: `<ul>
        <li>Pilot the sub with <b>WASD</b> or the arrow keys, and hold <b>Space</b> to boost (it burns oxygen).</li>
        <li>Collect treasure from the trench. Quick pickups chain into a <b>×4</b> multiplier.</li>
        <li>Mines and jellyfish cost oxygen. Rocks just get in the way.</li>
        <li>Surface at the top to refill. You have <b>three tanks</b>; the deepest, richest water is worth the risk.</li>
      </ul>`,
      button: 'Dive in',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
