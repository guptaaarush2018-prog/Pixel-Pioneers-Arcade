/* Skipstone: skim a stone across a lake. Flick to throw: the speed and direction of your flick
   at the moment you let go become the throw, so a quick, flat flick skips best. Tap just before
   each touchdown for a perfect skip that keeps more speed. Five throws; distance and skips score. */
(() => {
  const W = 900, H = 500, TAU = Math.PI * 2;
  const WATER = 360, SHORE = 90, G = 900, THROWS = 5, PERFECT_WINDOW = 0.14;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  let state = 'ready';   // ready · aim · flying · done · over
  let stone, throwNo, total, results, camX, camV, ripples, splashes, pads, ducks, wind, tapAt, time, msg, power, meterT, keyAngle, charging;
  let bestThrow = Arcade.load('skip:best', 0);

  function newLake() {
    pads = [];
    ducks = [];
    for (let x = 500; x < 9000; x += rand(380, 900)) pads.push({ x, w: rand(34, 52), ph: rand(0, TAU) });
    for (let x = 1400; x < 9000; x += rand(900, 1800)) ducks.push({ x, ph: rand(0, TAU), hit: false });
  }

  function newThrow() {
    stone = { x: SHORE - 10, y: WATER - 70, vx: 0, vy: 0, spin: 0, a: 0, skips: 0, perfects: 0, pads: 0, trail: [] };
    wind = Math.round(rand(-40, 40));
    tapAt = -1;
    charging = false;
    power = 0;
    state = 'aim';
    camX = 0;
    camV = 0;
    msg = null;
    updateHud();
  }

  function reset() {
    throwNo = 0;
    total = 0;
    results = [];
    ripples = [];
    splashes = [];
    time = 0;
    keyAngle = -10;
    newLake();
    newThrow();
  }

  function start() {
    reset();
    ui.hide();
  }

  // ---------- Throwing ----------

  function launch(vx, vy) {
    if (state !== 'aim') return;
    const sp = Math.hypot(vx, vy);
    if (sp < 220 || vx <= 0) { say('Flick toward the lake', '#fff'); return; }
    const s = clamp(sp, 0, 1250) / sp;
    stone.vx = vx * s;
    stone.vy = clamp(vy * s, -700, 500);
    stone.spin = 18 + stone.vx / 40;
    state = 'flying';
    Arcade.tone({ freq: 300, to: 600, dur: 0.12, type: 'triangle', vol: 0.04 });
  }

  function say(text, color = '#ffd25e') { msg = { text, color, t: 1.2 }; }

  function touchdown() {
    const sp = Math.hypot(stone.vx, stone.vy);
    const angle = Math.atan2(stone.vy, stone.vx) * 180 / Math.PI;   // entry angle below the horizon
    const pad = pads.find(p => Math.abs(p.x - stone.x) < p.w);
    ripples.push({ x: stone.x, r: 4, life: 0, gold: false });
    if (pad) {
      stone.vy = -Math.max(220, Math.abs(stone.vy) * 0.9);
      stone.pads++;
      stone.skips++;
      say('LILY PAD BOUNCE!', '#7ef08a');
      Arcade.tone({ freq: 520, to: 880, dur: 0.12, type: 'sine', vol: 0.05 });
      return;
    }
    if (angle > 30 || stone.vx < 120 || sp < 160) return sink(angle > 30 ? 'Too steep' : 'Out of steam');
    const perfect = time - tapAt < PERFECT_WINDOW && tapAt >= 0;
    tapAt = -1;
    stone.skips++;
    // Flatter entries keep more speed; 10-20 degrees is the sweet spot.
    const flat = 1 - clamp(Math.abs(angle - 14) / 30, 0, 0.6);
    stone.vx *= (perfect ? 0.93 : 0.8) * (0.85 + flat * 0.15);
    stone.vy = -Math.max(90, Math.abs(stone.vy) * (perfect ? 0.62 : 0.5));
    stone.y = WATER - 1;
    if (perfect) {
      stone.perfects++;
      ripples[ripples.length - 1].gold = true;
      say(`PERFECT SKIP ×${stone.skips}`);
      Arcade.tone({ freq: 880 + Math.min(stone.perfects, 10) * 40, to: 1320, dur: 0.1, type: 'triangle', vol: 0.05 });
      if (stone.perfects >= 8) Arcade.flag('skipstone-perfect');
    } else {
      Arcade.tone({ freq: 420 + Math.min(stone.skips, 20) * 12, dur: 0.05, type: 'sine', vol: 0.04 });
    }
    for (let i = 0; i < 6; i++) splashes.push({ x: stone.x, y: WATER, vx: rand(-60, 120), vy: rand(-180, -60), life: 0 });
    if (stone.skips >= 15) Arcade.flag('skipstone-fifteen');
  }

  function sink(reason) {
    state = 'done';
    for (let i = 0; i < 16; i++) splashes.push({ x: stone.x, y: WATER, vx: rand(-90, 90), vy: rand(-300, -120), life: 0 });
    ripples.push({ x: stone.x, r: 6, life: 0, gold: false });
    Arcade.tone({ freq: 200, to: 80, dur: 0.3, type: 'sine', vol: 0.06 });
    const meters = Math.max(0, (stone.x - SHORE) / 10);
    const pts = Math.round(meters * 10 + stone.skips * 25 + stone.perfects * 40 + stone.pads * 30);
    total += pts;
    results.push({ meters, skips: stone.skips, pts });
    if (meters > bestThrow) { bestThrow = meters; Arcade.save('skip:best', bestThrow); say(`NEW LONGEST  ${meters.toFixed(1)} m`, '#7af0c8'); }
    else say(`${reason} · ${meters.toFixed(1)} m · ${stone.skips} skips`, '#fff');
    if (meters >= 300) Arcade.flag('skipstone-300');
    throwNo++;
    updateHud();
    setTimeout(() => {
      if (throwNo >= THROWS) finish();
      else newThrow();
    }, 1500);
  }

  function finish() {
    state = 'over';
    const best = results.reduce((a, r) => Math.max(a, r.meters), 0);
    const skips = results.reduce((a, r) => a + r.skips, 0);
    Arcade.finish(ui, {
      score: total,
      title: 'Lake closed',
      lines: [`Longest ${best.toFixed(1)} m · ${skips} skips in ${THROWS} throws`,
        results.map((r, i) => `#${i + 1} ${r.meters.toFixed(0)}m`).join(' · ')],
      onAction: start,
    });
  }

  // ---------- Update ----------

  function update(dt) {
    time += dt;
    if (msg && (msg.t -= dt) <= 0) msg = null;
    for (const r of ripples) { r.life += dt; r.r += dt * 60; }
    ripples = ripples.filter(r => r.life < 1.6);
    for (const s of splashes) { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += G * dt; }
    splashes = splashes.filter(s => s.y < WATER + 4);
    if (state === 'aim' && charging) { meterT += dt; power = (Math.sin(meterT * 3.2 - Math.PI / 2) + 1) / 2; }
    if (state === 'flying') {
      stone.vy += G * dt;
      stone.vx += wind * dt * 0.4;
      stone.x += stone.vx * dt;
      stone.y += stone.vy * dt;
      stone.a += stone.spin * dt;
      stone.trail.push({ x: stone.x, y: stone.y });
      if (stone.trail.length > 18) stone.trail.shift();
      for (const d of ducks) {
        if (!d.hit && Math.abs(d.x - stone.x) < 20 && stone.y > WATER - 26) {
          d.hit = true;
          say('QUACK! A duck stopped it', '#ff9a5a');
          Arcade.tone({ freq: 700, to: 400, dur: 0.15, type: 'square', vol: 0.05 });
          return sink('Duck');
        }
      }
      if (stone.y >= WATER && stone.vy > 0) touchdown();
    }
    // The camera follows on a critically damped spring and never leads the stone off-screen.
    const want = state === 'flying' || state === 'done' ? Math.max(0, stone.x - W * 0.4) : 0;
    const k = (TAU / 0.5) ** 2, c = 4 * Math.PI / 0.5;
    camV += (-k * (camX - want) - c * camV) * dt;
    camX += camV * dt;
    if (state === 'flying' && stone.x - camX > W - 60) camX = stone.x - W + 60;
  }

  // ---------- Drawing ----------

  function draw() {
    const sky = ctx.createLinearGradient(0, 0, 0, WATER);
    sky.addColorStop(0, '#ffb98a');
    sky.addColorStop(0.55, '#ffd9a8');
    sky.addColorStop(1, '#ffe9c8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, WATER);
    ctx.fillStyle = '#fff3d6';
    ctx.beginPath(); ctx.arc(W * 0.72 - camX * 0.02, 120, 46, 0, TAU); ctx.fill();
    // Far hills drift slowly; near ones faster.
    for (const [par, col, hgt, off] of [[0.08, '#c99a8a', 70, 0], [0.2, '#9b7f86', 46, 140]]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, WATER);
      for (let x = 0; x <= W + 20; x += 20) {
        const wx = x + camX * par + off;
        ctx.lineTo(x, WATER - hgt - Math.sin(wx / 140) * 18 - Math.sin(wx / 53) * 7);
      }
      ctx.lineTo(W, WATER);
      ctx.fill();
    }
    const water = ctx.createLinearGradient(0, WATER, 0, H);
    water.addColorStop(0, '#5aa7c4');
    water.addColorStop(1, '#23566e');
    ctx.fillStyle = water;
    ctx.fillRect(0, WATER, W, H - WATER);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    for (let row = 0; row < 7; row++) {
      const y = WATER + 10 + row * 19, sp = 60 + row * 30;
      for (let x = -((camX * (0.6 + row * 0.08) + time * sp * 0.2) % 70); x < W; x += 70) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 18 + row * 3, y); ctx.stroke();
      }
    }
    ctx.save();
    ctx.translate(-camX, 0);
    // Shore.
    ctx.fillStyle = '#7a9a4a';
    ctx.beginPath(); ctx.moveTo(-200, WATER - 40); ctx.lineTo(SHORE + 10, WATER - 40); ctx.quadraticCurveTo(SHORE + 40, WATER - 20, SHORE + 26, WATER + 30); ctx.lineTo(-200, H); ctx.fill();
    ctx.fillStyle = '#5f7d38';
    for (const tx of [-120, -40, 30]) { ctx.beginPath(); ctx.moveTo(tx, WATER - 40); ctx.lineTo(tx + 22, WATER - 150); ctx.lineTo(tx + 44, WATER - 40); ctx.fill(); }
    // Distance markers every 10 m.
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let m = 10; m < 1000; m += 10) {
      const x = SHORE + m * 10;
      if (x < camX - 40 || x > camX + W + 40) continue;
      ctx.fillStyle = m % 50 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.75)';
      ctx.fillRect(x - 1, WATER + 2, 2, m % 50 ? 6 : 12);
      if (m % 50 === 0) ctx.fillText(`${m} m`, x, WATER + 28);
    }
    if (bestThrow > 0) {
      const bx = SHORE + bestThrow * 10;
      ctx.strokeStyle = 'rgba(122,240,200,0.8)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(bx, WATER - 60); ctx.lineTo(bx, WATER + 10); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#7af0c8';
      ctx.fillText('BEST', bx, WATER - 66);
    }
    for (const p of pads) {
      if (p.x < camX - 80 || p.x > camX + W + 80) continue;
      const bob = Math.sin(time * 1.5 + p.ph) * 1.5;
      ctx.fillStyle = '#4f9a4a';
      ctx.beginPath(); ctx.ellipse(p.x, WATER + 3 + bob, p.w, 7, 0, 0.25, TAU - 0.25); ctx.lineTo(p.x, WATER + 3 + bob); ctx.fill();
      ctx.fillStyle = '#ffd0e6';
      ctx.beginPath(); ctx.arc(p.x + p.w * 0.3, WATER - 1 + bob, 4, 0, TAU); ctx.fill();
    }
    for (const d of ducks) {
      if (d.x < camX - 80 || d.x > camX + W + 80) continue;
      const bob = Math.sin(time * 2 + d.ph) * 2;
      ctx.fillStyle = d.hit ? '#c8b080' : '#f2e2a0';
      ctx.beginPath(); ctx.ellipse(d.x, WATER - 6 + bob, 16, 9, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(d.x + 10, WATER - 18 + bob, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff9a3d';
      ctx.beginPath(); ctx.moveTo(d.x + 16, WATER - 19 + bob); ctx.lineTo(d.x + 24, WATER - 17 + bob); ctx.lineTo(d.x + 16, WATER - 15 + bob); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(d.x + 12, WATER - 20 + bob, 1.4, 0, TAU); ctx.fill();
    }
    for (const r of ripples) {
      ctx.strokeStyle = r.gold ? `rgba(255,210,94,${1 - r.life / 1.6})` : `rgba(255,255,255,${0.7 - r.life / 2.4})`;
      ctx.lineWidth = r.gold ? 2.5 : 1.5;
      ctx.beginPath(); ctx.ellipse(r.x, WATER + 2, r.r, r.r * 0.22, 0, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(230,245,255,0.9)';
    for (const s of splashes) ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    // Thrower on the shore.
    const tx = SHORE - 36, ty = WATER - 40;
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, ty - 34); ctx.moveTo(tx, ty); ctx.lineTo(tx - 8, ty + 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx, ty - 26); ctx.lineTo(state === 'aim' ? stone.x - 4 : tx + 16, state === 'aim' ? stone.y : ty - 40); ctx.stroke();
    ctx.fillStyle = '#2a2a3a';
    ctx.beginPath(); ctx.arc(tx, ty - 42, 7, 0, TAU); ctx.fill();
    // Stone trail and stone (squashed by spin so it reads as a flat disc).
    if (state === 'flying') {
      for (let i = 1; i < stone.trail.length; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${i / stone.trail.length * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(stone.trail[i - 1].x, stone.trail[i - 1].y); ctx.lineTo(stone.trail[i].x, stone.trail[i].y); ctx.stroke();
      }
    }
    if (state !== 'done' || stone.y < WATER) {
      ctx.save();
      ctx.translate(stone.x, stone.y);
      ctx.fillStyle = '#6d6a72';
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 3 + Math.abs(Math.sin(stone.a)) * 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9b97a3';
      ctx.beginPath(); ctx.ellipse(-1, -1, 5, 1.6, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // Aim guide while dragging or charging with keys.
    if (state === 'aim' && (drag || charging)) {
      const a = drag ? Math.atan2(drag.vy, drag.vx) : keyAngle * Math.PI / 180;
      const len = drag ? clamp(Math.hypot(drag.vx, drag.vy) / 8, 20, 140) : 30 + power * 110;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(stone.x, stone.y); ctx.lineTo(stone.x + Math.cos(a) * len, stone.y + Math.sin(a) * len); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // HUD.
    ctx.fillStyle = 'rgba(20,20,30,0.55)';
    ctx.beginPath(); ctx.roundRect(14, 14, 200, 52, 10); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const m = state === 'aim' ? 0 : Math.max(0, (stone.x - SHORE) / 10);
    ctx.fillText(`${m.toFixed(1)} m · ${stone.skips} skips`, 26, 36);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`Wind ${wind > 0 ? '→' : wind < 0 ? '←' : ''} ${Math.abs(wind)} · throw ${Math.min(throwNo + 1, THROWS)}/${THROWS}`, 26, 54);
    if (charging) {
      ctx.fillStyle = 'rgba(20,20,30,0.55)';
      ctx.fillRect(W / 2 - 110, H - 40, 220, 14);
      ctx.fillStyle = power > 0.8 ? '#7af0c8' : '#ffd25e';
      ctx.fillRect(W / 2 - 108, H - 38, 216 * power, 10);
    }
    if (msg) {
      ctx.globalAlpha = Math.min(1, msg.t * 3);
      ctx.textAlign = 'center';
      ctx.font = '900 24px system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(30,20,20,0.5)';
      ctx.strokeText(msg.text, W / 2, 110);
      ctx.fillStyle = msg.color;
      ctx.fillText(msg.text, W / 2, 110);
      ctx.globalAlpha = 1;
    }
    if (state === 'aim' && throwNo === 0 && !drag && !charging) {
      ctx.textAlign = 'center';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = '#3a2a2a';
      ctx.fillText('Flick right, fast and flat · tap just before each touchdown', W / 2, 200);
    }
  }

  function updateHud() {
    $('score').textContent = total.toLocaleString();
    $('throw').textContent = `${Math.min(throwNo + 1, THROWS)}/${THROWS}`;
    $('best').textContent = `${bestThrow.toFixed(0)} m`;
  }

  // ---------- Input: the flick's release velocity is the throw ----------

  const toLocal = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height, t: performance.now() };
  };
  let drag = null, hist = [];
  const velocity = () => {
    const now = performance.now(), pts = hist.filter(p => now - p.t < 90);
    if (pts.length < 2) return { vx: 0, vy: 0 };
    const a = pts[0], b = pts[pts.length - 1], dt = (b.t - a.t) / 1000 || 0.016;
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  };
  canvas.addEventListener('pointerdown', e => {
    if (!overlayEl.hidden) return;
    e.preventDefault();
    if (state === 'flying') { tapAt = time; return; }
    if (state !== 'aim') return;
    canvas.setPointerCapture(e.pointerId);
    hist = [toLocal(e)];
    drag = { vx: 0, vy: 0 };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    hist.push(toLocal(e));
    if (hist.length > 12) hist.shift();
    drag = velocity();
  });
  canvas.addEventListener('pointerup', e => {
    if (!drag) return;
    hist.push(toLocal(e));
    const v = velocity();
    drag = null;
    launch(v.vx * 0.9, v.vy * 0.9);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });

  // Keyboard: Up/Down tilt, hold Space to charge, let go to throw, Space mid-flight to tap.
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'flying' || state === 'aim') { paused = state; state = 'paused'; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); }
      else if (state === 'paused') resume();
      return;
    }
    if (!overlayEl.hidden) return;
    if (e.code === 'ArrowUp') { keyAngle = clamp(keyAngle - 2, -40, 10); e.preventDefault(); }
    if (e.code === 'ArrowDown') { keyAngle = clamp(keyAngle + 2, -40, 10); e.preventDefault(); }
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (state === 'flying' && !e.repeat) tapAt = time;
    else if (state === 'aim' && !charging) { charging = true; meterT = 0; }
  });
  window.addEventListener('keyup', e => {
    if (e.code !== 'Space' || !charging || state !== 'aim') return;
    charging = false;
    const sp = 300 + power * 950, a = keyAngle * Math.PI / 180;
    launch(Math.cos(a) * sp, Math.sin(a) * sp);
  });
  let paused = null;
  function resume() { state = paused || 'aim'; paused = null; ui.hide(); }
  Arcade.onBlur(() => { if (state === 'flying' || state === 'aim') { paused = state; state = 'paused'; drag = null; charging = false; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); } });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state !== 'paused' && state !== 'over' && state !== 'ready') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  state = 'ready';
  Versus.attach({
    ui,
    start,
    score: () => total,
    intro: {
      title: 'Skipstone',
      html: `<ul>
        <li><b>Flick</b> to the right to throw. How fast and which way your finger or mouse is moving when you let go is the throw.</li>
        <li>Keep it flat: stones that hit the water steeper than about 30° sink. 10–20° skips best.</li>
        <li><b>Tap</b> just before each touchdown for a <b>perfect skip</b> that keeps more speed. Lily pads give a free bounce; ducks stop you dead.</li>
        <li>Five throws. Distance, skips and perfects all score. Keys: <kbd>↑</kbd>/<kbd>↓</kbd> tilt, hold <kbd>Space</kbd> to charge, <kbd>Space</kbd> to tap.</li>
      </ul>`,
      button: 'To the lake',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
