/* Orbit Weaver: one button, endless planets. Your ship circles a planet; let go at the right
   moment and its tangent line becomes your launch. The next planet's gravity bends the flight
   toward it. Clean, quick captures build an orbit chain for bonus points. */
(() => {
  const W = 760, H = 540, TAU = Math.PI * 2;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  const stars = Array.from({ length: 150 }, () => ({
    x: Math.random() * W, y: Math.random() * H, r: rand(0.4, 1.7), p: rand(0.15, 1), tw: Math.random() * TAU,
  }));

  let state = 'ready';
  let planets, planet, next, ship, flying, flyT, score, captures, streak, trail, particles, time, message, messageT;

  const orbitR = () => planet.r + 34;

  function orbitPos() {
    ship.x = planet.x + Math.cos(ship.orb) * orbitR();
    ship.y = planet.y + Math.sin(ship.orb) * orbitR();
  }

  function spawnNext(from) {
    const minD = 175, maxD = 300;
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * TAU, d = rand(minD, maxD);
      const x = from.x + Math.cos(a) * d, y = from.y + Math.sin(a) * d;
      if (x < 76 || x > W - 76 || y < 76 || y > H - 76) continue;
      return { x, y, r: Math.max(19, 35 - (captures || 0) * 0.55), hue: rand(150, 330), spin: rand(-0.8, 0.8), rot: Math.random() * TAU };
    }
    return { x: clamp(from.x + 200, 76, W - 76), y: clamp(from.y + 110, 76, H - 76), r: 26, hue: 200, spin: 0.4, rot: 0 };
  }

  function reset() {
    captures = 0;
    score = 0;
    planet = { x: 180, y: H / 2, r: 36, hue: 190, spin: 0.4, rot: 0 };
    planets = [planet];
    next = spawnNext(planet);
    ship = { x: 0, y: 0, vx: 0, vy: 0, orb: -Math.PI / 2, a: 0 };
    flying = false;
    flyT = 0;
    streak = 0;
    trail = [];
    particles = [];
    time = 0;
    message = '';
    messageT = 0;
    orbitPos();
    updateHud();
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
  }

  function burst(x, y, hue, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(40, 240);
      particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.35, 0.9),
        size: rand(1.5, 4), color: `hsl(${hue + rand(-30, 30)} 90% 70%)`,
      });
    }
  }

  function launch() {
    if (state !== 'playing' || flying) return;
    const sp = 300 + Math.min(130, captures * 4);
    ship.vx = -Math.sin(ship.orb) * sp;
    ship.vy = Math.cos(ship.orb) * sp;
    ship.a = Math.atan2(ship.vy, ship.vx);
    flying = true;
    flyT = 0;
    trail = [{ x: ship.x, y: ship.y }];
    Arcade.tone({ freq: 520, to: 980, dur: 0.18, type: 'triangle', vol: 0.05 });
  }

  function capture() {
    const quick = flyT < 2.4;
    streak = quick ? streak + 1 : 0;
    const gain = 100 + (quick ? 60 : 0) + Math.min(6, streak) * 25;
    score += gain;
    captures++;
    burst(next.x, next.y, next.hue, 26);
    planets.push(next);
    if (planets.length > 8) planets.shift();
    planet = next;
    next = spawnNext(planet);
    flying = false;
    ship.vx = ship.vy = 0;
    ship.orb = Math.atan2(ship.y - planet.y, ship.x - planet.x);
    orbitPos();
    message = quick ? (streak > 1 ? `ORBIT CHAIN ×${streak}  +${gain}` : `CLEAN CAPTURE  +${gain}`) : `CAPTURED  +${gain}`;
    messageT = 1.5;
    Arcade.tone({ freq: 620 + Math.min(520, streak * 70), to: 1240, dur: 0.16, type: 'triangle', vol: 0.05 });
    Arcade.tone({ freq: 990, dur: 0.1, type: 'sine', vol: 0.03, delay: 0.08 });
    if (streak >= 5) Arcade.flag('orbit-weaver-chain');
    if (captures >= 20) Arcade.flag('orbit-weaver-20');
    updateHud();
  }

  function crash() {
    state = 'over';
    burst(ship.x, ship.y, 12, 34);
    Arcade.tone({ freq: 240, to: 60, dur: 0.5, type: 'sawtooth', vol: 0.06 });
    setTimeout(() => Arcade.finish(ui, {
      score,
      title: 'Lost in space',
      lines: [`${captures} planet${captures === 1 ? '' : 's'} orbited · chain ×${streak}`],
      onAction: start,
    }), 550);
  }

  function update(dt) {
    time += dt;
    if (messageT > 0) messageT -= dt;
    for (const p of particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx -= p.vx * 1.6 * dt;
      p.vy -= p.vy * 1.6 * dt;
    }
    particles = particles.filter(p => p.life < p.max);
    planet.rot += dt * (planet.spin || 0);
    next.rot += dt * (next.spin || 0);
    if (state !== 'playing') return;

    if (!flying) {
      ship.orb += dt * 2.0;
      orbitPos();
      ship.a = ship.orb + Math.PI / 2;
      return;
    }

    flyT += dt;
    const dx = next.x - ship.x, dy = next.y - ship.y, d = Math.hypot(dx, dy) || 1;
    const pull = Math.min(900, 230000 / (d * d));
    ship.vx += (dx / d) * pull * dt;
    ship.vy += (dy / d) * pull * dt;
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    ship.a = Math.atan2(ship.vy, ship.vx);
    trail.push({ x: ship.x, y: ship.y });
    if (trail.length > 60) trail.shift();
    if (Math.random() < dt * 35) {
      particles.push({ x: ship.x, y: ship.y, vx: rand(-18, 18), vy: rand(-18, 18), life: 0, max: 0.45, size: rand(1, 2.4), color: '#9adcff' });
    }

    if (d < next.r + 12) capture();
    else if (flyT > 5.2 || ship.x < -100 || ship.x > W + 100 || ship.y < -100 || ship.y > H + 100) crash();
  }

  // ---------- Drawing ----------

  function drawPlanet(p, alive) {
    const glow = ctx.createRadialGradient(p.x, p.y, p.r * 0.4, p.x, p.y, p.r * 2.4);
    glow.addColorStop(0, `hsla(${p.hue} 90% 60% / ${alive ? 0.32 : 0.16})`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 2.4, 0, TAU);
    ctx.fill();

    const body = ctx.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.4, p.r * 0.15, p.x, p.y, p.r);
    body.addColorStop(0, `hsl(${p.hue} 80% 72%)`);
    body.addColorStop(1, `hsl(${p.hue} 70% 32%)`);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.strokeStyle = `hsla(${p.hue} 90% 80% / 0.65)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r * 1.65, p.r * 0.5, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#070a18');
    bg.addColorStop(0.55, '#0c1029');
    bg.addColorStop(1, '#120a24');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const neb = ctx.createRadialGradient(W * 0.7, H * 0.2, 20, W * 0.7, H * 0.2, 340);
    neb.addColorStop(0, 'rgba(90,60,180,0.22)');
    neb.addColorStop(1, 'transparent');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);

    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.45 * Math.sin(time * 1.6 + s.tw) * s.p + s.p * 0.3;
      ctx.fillStyle = '#dfefff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // The route to the next planet.
    if (state === 'playing' || state === 'ready') {
      ctx.strokeStyle = 'rgba(150,200,255,0.16)';
      ctx.setLineDash([4, 8]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(planet.x, planet.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.arc(planet.x, planet.y, orbitR(), 0, TAU);
      ctx.stroke();

      // Aim preview: where letting go right now would send you.
      if (!flying) {
        const sp = 300 + Math.min(130, captures * 4);
        const vx = -Math.sin(ship.orb) * sp, vy = Math.cos(ship.orb) * sp;
        ctx.strokeStyle = 'rgba(122,240,255,0.4)';
        ctx.setLineDash([3, 7]);
        ctx.beginPath();
        ctx.moveTo(ship.x, ship.y);
        ctx.lineTo(ship.x + vx * 0.55, ship.y + vy * 0.55);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const p of planets) drawPlanet(p, p === planet);
    if (next && next !== planet) drawPlanet(next, true);

    // A pulsing capture ring on the target.
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    ctx.strokeStyle = `rgba(122,240,255,${0.25 + pulse * 0.3})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(next.x, next.y, next.r + 12 + pulse * 3, 0, TAU);
    ctx.stroke();

    // Ship trail.
    if (trail.length > 1) {
      ctx.strokeStyle = 'rgba(122,240,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }

    for (const p of particles) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Ship.
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.a);
    ctx.shadowColor = '#7af0ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#eaffff';
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-9, -8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-9, 8);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#25b6d8';
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-6, -3);
    ctx.lineTo(-6, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // HUD.
    ctx.textAlign = 'left';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(score).toLocaleString(), 18, 34);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('SCORE', 18, 50);
    if (streak > 1) {
      ctx.fillStyle = '#ffd25e';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.fillText(`CHAIN ×${streak}`, 18, 74);
    }
    if (messageT > 0) {
      ctx.globalAlpha = clamp(messageT / 0.4, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7af0ff';
      ctx.font = '900 20px system-ui, sans-serif';
      ctx.fillText(message, W / 2, 70);
      ctx.globalAlpha = 1;
    }
    if (state === 'playing' && !flying && captures === 0 && time < 6) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText('Tap or press Space to release', W / 2, H - 34);
    }
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('streak').textContent = streak;
    $('best').textContent = Arcade.getBest('orbit-weaver').toLocaleString();
  }

  // ---------- Input ----------

  const uiOpen = () => !overlayEl.hidden;
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!uiOpen()) launch();
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') { state = 'paused'; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); }
      else if (state === 'paused') resume();
      return;
    }
    if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') && !e.repeat && !uiOpen()) {
      e.preventDefault();
      launch();
    }
  });
  function resume() { state = 'playing'; ui.hide(); }
  Arcade.onBlur(() => { if (state === 'playing') { state = 'paused'; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); } });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    if (state === 'playing') updateHud();
    requestAnimationFrame(frame);
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => score,
    intro: {
      title: 'Orbit Weaver',
      html: `<ul>
        <li>Your ship circles a planet on its own. Press <b>Space</b>, click, or tap to let go.</li>
        <li>You fly off along the tangent line, and the next planet's gravity pulls you in. Release at the right moment to hit it.</li>
        <li>Capture within 2.4 seconds for a <b>clean capture</b>, and keep chaining them for bigger bonuses.</li>
        <li>The planets get smaller and launches get faster as you go. Miss, and the run is over.</li>
      </ul>`,
      button: 'Start orbiting',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
