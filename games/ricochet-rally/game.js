/* Ricochet Rally: pull back on the puck like a slingshot and let go. It slides, banks off walls
   and bumpers, and every target it hits after a bank is worth more. Clear all the targets with the
   shots you have; leftover shots pay a bonus and carry the run to a harder table. */
(() => {
  const W = 760, H = 540, TAU = Math.PI * 2;
  const M = 34;                   // table rim
  const PR = 11;                  // puck radius
  const MAX_PULL = 150, MAX_SPEED = 1050;
  const FRICTION = 0.62;          // per second, exponential
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

  let state = 'ready';
  let level, score, shots, puck, targets, bumpers, mines, banks, aim, particles, pops, time, levelHits, shake, streak;

  function buildLevel() {
    const nT = Math.min(3 + level, 9);
    const nB = Math.min(1 + Math.floor(level / 2), 6);
    const nM = level >= 3 ? Math.min(level - 2, 4) : 0;
    puck = { x: W / 2, y: H - M - 60, vx: 0, vy: 0, moving: false, trail: [] };
    targets = [];
    bumpers = [];
    mines = [];
    const free = (x, y, r) => Math.hypot(x - puck.x, y - puck.y) > r + 70
      && [...targets, ...bumpers, ...mines].every(o => Math.hypot(o.x - x, o.y - y) > o.r + r + 22);
    const place = (r, list, extra) => {
      for (let i = 0; i < 200; i++) {
        const x = rand(M + r + 10, W - M - r - 10), y = rand(M + r + 10, H - M - r - 110);
        if (free(x, y, r)) { list.push({ x, y, r, ...extra() }); return; }
      }
    };
    for (let i = 0; i < nB; i++) place(rand(20, 34), bumpers, () => ({ glow: 0 }));
    for (let i = 0; i < nT; i++) place(16, targets, () => ({ hit: false, pop: 0, orbit: level >= 4 && Math.random() < 0.35 ? { cx: 0, cy: 0, a: rand(0, TAU), rad: rand(18, 34), sp: rand(0.7, 1.4) * (Math.random() < 0.5 ? -1 : 1) } : null }));
    for (const t of targets) if (t.orbit) { t.orbit.cx = t.x; t.orbit.cy = t.y; }
    for (let i = 0; i < nM; i++) place(13, mines, () => ({ spin: rand(0, TAU) }));
    shots = nT + 2 - Math.min(2, Math.floor(level / 3));
    levelHits = 0;
    banks = 0;
  }

  function reset() {
    level = 1;
    score = 0;
    streak = 0;
    particles = [];
    pops = [];
    time = 0;
    shake = 0;
    aim = null;
    buildLevel();
    updateHud();
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
  }

  function burst(x, y, color, n = 18, sp = 200) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(40, sp);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rand(0.3, 0.8), size: rand(1.5, 3.5), color });
    }
  }
  function pop(x, y, text, color = '#fff') { pops.push({ x, y, text, color, t: 0 }); }

  // ---------- Shooting ----------

  function shoot(dx, dy) {
    const pull = Math.min(MAX_PULL, Math.hypot(dx, dy));
    if (pull < 10 || puck.moving || shots <= 0) return;
    const sp = (pull / MAX_PULL) * MAX_SPEED, a = Math.atan2(dy, dx);
    puck.vx = Math.cos(a) * sp;
    puck.vy = Math.sin(a) * sp;
    puck.moving = true;
    puck.trail = [];
    banks = 0;
    shots--;
    Arcade.tone({ freq: 240, to: 520, dur: 0.12, type: 'triangle', vol: 0.05 });
    updateHud();
  }

  function settle() {
    puck.moving = false;
    puck.vx = puck.vy = 0;
    if (targets.every(t => t.hit)) return clearLevel();
    if (shots <= 0) return gameOver();
  }

  function clearLevel() {
    const bonus = 250 + shots * 150 + level * 50;
    score += bonus;
    pop(W / 2, H / 2, `TABLE CLEAR  +${bonus}`, '#7af0c8');
    Arcade.tone({ freq: 523, dur: 0.12, type: 'triangle', vol: 0.06 });
    Arcade.tone({ freq: 784, dur: 0.18, type: 'triangle', vol: 0.06, delay: 0.1 });
    Arcade.tone({ freq: 1046, dur: 0.24, type: 'triangle', vol: 0.06, delay: 0.2 });
    if (shots >= 2) Arcade.flag('ricochet-rally-spare');
    if (level >= 6) Arcade.flag('ricochet-rally-six');
    level++;
    state = 'between';
    setTimeout(() => { buildLevel(); state = 'playing'; updateHud(); }, 1100);
    updateHud();
  }

  function gameOver() {
    state = 'over';
    Arcade.tone({ freq: 300, to: 90, dur: 0.5, type: 'sawtooth', vol: 0.05 });
    const left = targets.filter(t => !t.hit).length;
    setTimeout(() => Arcade.finish(ui, {
      score,
      title: 'Out of shots',
      lines: [`Reached table ${level} · ${left} target${left === 1 ? '' : 's'} left standing`],
      onAction: start,
    }), 500);
  }

  // ---------- Physics ----------

  function bounceCircle(o, rest = 1.05) {
    const dx = puck.x - o.x, dy = puck.y - o.y, d = Math.hypot(dx, dy), min = o.r + PR;
    if (d >= min || d === 0) return false;
    const nx = dx / d, ny = dy / d;
    puck.x = o.x + nx * min;
    puck.y = o.y + ny * min;
    const dot = puck.vx * nx + puck.vy * ny;
    if (dot < 0) {
      puck.vx -= (1 + rest) * dot * nx;
      puck.vy -= (1 + rest) * dot * ny;
    }
    return true;
  }

  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt * 30);
    for (const p of particles) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt;
    }
    particles = particles.filter(p => p.life < p.max);
    for (const p of pops) p.t += dt;
    pops = pops.filter(p => p.t < 1.3);
    for (const t of targets) {
      t.pop = Math.max(0, t.pop - dt * 2);
      if (t.orbit && !t.hit) {
        t.orbit.a += t.orbit.sp * dt;
        t.x = t.orbit.cx + Math.cos(t.orbit.a) * t.orbit.rad;
        t.y = t.orbit.cy + Math.sin(t.orbit.a) * t.orbit.rad;
      }
    }
    for (const b of bumpers) b.glow = Math.max(0, b.glow - dt * 3);
    for (const m of mines) m.spin += dt * 1.5;
    if (state !== 'playing' || !puck.moving) return;

    // Substeps keep a fast puck from tunnelling through anything.
    const steps = Math.ceil(Math.hypot(puck.vx, puck.vy) * dt / 4) || 1, h = dt / steps;
    for (let s = 0; s < steps && puck.moving; s++) {
      puck.x += puck.vx * h;
      puck.y += puck.vy * h;
      let wall = false;
      if (puck.x < M + PR) { puck.x = M + PR; puck.vx = Math.abs(puck.vx) * 0.92; wall = true; }
      if (puck.x > W - M - PR) { puck.x = W - M - PR; puck.vx = -Math.abs(puck.vx) * 0.92; wall = true; }
      if (puck.y < M + PR) { puck.y = M + PR; puck.vy = Math.abs(puck.vy) * 0.92; wall = true; }
      if (puck.y > H - M - PR) { puck.y = H - M - PR; puck.vy = -Math.abs(puck.vy) * 0.92; wall = true; }
      if (wall) bank(puck.x, puck.y, '#9adcff');
      for (const b of bumpers) if (bounceCircle(b)) { b.glow = 1; bank(puck.x, puck.y, '#ff9de2'); }
      for (const t of targets) {
        if (t.hit || Math.hypot(puck.x - t.x, puck.y - t.y) > t.r + PR) continue;
        t.hit = true;
        t.pop = 1;
        levelHits++;
        streak++;
        const mult = 1 + banks;
        const gain = 100 * mult + (streak > 1 ? 25 * Math.min(streak, 8) : 0);
        score += gain;
        pop(t.x, t.y - 18, mult > 1 ? `×${mult} BANK  +${gain}` : `+${gain}`, mult > 2 ? '#ffd25e' : '#7af0c8');
        burst(t.x, t.y, mult > 1 ? '#ffd25e' : '#7af0c8', 22);
        Arcade.tone({ freq: 660 + Math.min(8, mult) * 90, to: 1320, dur: 0.12, type: 'triangle', vol: 0.05 });
        if (mult >= 4) Arcade.flag('ricochet-rally-bank');
        updateHud();
      }
      for (const m of mines) {
        if (Math.hypot(puck.x - m.x, puck.y - m.y) > m.r + PR) continue;
        burst(m.x, m.y, '#ff6b5e', 30, 280);
        shake = 10;
        pop(m.x, m.y - 18, 'MINE  −1 shot', '#ff6b5e');
        Arcade.tone({ freq: 160, to: 50, dur: 0.4, type: 'sawtooth', vol: 0.07 });
        mines.splice(mines.indexOf(m), 1);
        shots = Math.max(0, shots - 1);
        streak = 0;
        puck.vx *= 0.2;
        puck.vy *= 0.2;
        updateHud();
        break;
      }
    }
    const k = Math.exp(-FRICTION * dt);
    puck.vx *= k;
    puck.vy *= k;
    puck.trail.push({ x: puck.x, y: puck.y });
    if (puck.trail.length > 26) puck.trail.shift();
    if (Math.hypot(puck.vx, puck.vy) < 22) settle();
  }

  function bank(x, y, color) {
    banks++;
    burst(x, y, color, 6, 120);
    Arcade.tone({ freq: 380 + Math.min(banks, 8) * 40, dur: 0.05, type: 'square', vol: 0.03 });
  }

  // ---------- Aim preview: the straight path and the first bank ----------

  function previewPath(dx, dy) {
    const pull = Math.min(MAX_PULL, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    let x = puck.x, y = puck.y, vx = Math.cos(a), vy = Math.sin(a);
    const pts = [{ x, y }];
    let remaining = 120 + pull * 3.2, bounces = 0;
    while (remaining > 0 && bounces < 2) {
      const tx = vx > 0 ? (W - M - PR - x) / vx : vx < 0 ? (M + PR - x) / vx : Infinity;
      const ty = vy > 0 ? (H - M - PR - y) / vy : vy < 0 ? (M + PR - y) / vy : Infinity;
      const t = Math.min(tx, ty, remaining);
      x += vx * t; y += vy * t;
      remaining -= t;
      pts.push({ x, y });
      if (t === tx) vx = -vx; else if (t === ty) vy = -vy;
      bounces++;
    }
    return pts;
  }

  // ---------- Drawing ----------

  function draw() {
    ctx.save();
    if (shake > 0.3) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#13202e');
    bg.addColorStop(1, '#0b131c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Table felt with a soft centre light.
    ctx.fillStyle = '#14394a';
    ctx.beginPath(); ctx.roundRect(M - 6, M - 6, W - 2 * M + 12, H - 2 * M + 12, 18); ctx.fill();
    const lamp = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 420);
    lamp.addColorStop(0, 'rgba(90,200,220,0.18)');
    lamp.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = lamp;
    ctx.fillRect(M, M, W - 2 * M, H - 2 * M);
    ctx.strokeStyle = 'rgba(150,230,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(M, M, W - 2 * M, H - 2 * M, 12); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = M + 40; x < W - M; x += 40) { ctx.beginPath(); ctx.moveTo(x, M); ctx.lineTo(x, H - M); ctx.stroke(); }
    for (let y = M + 40; y < H - M; y += 40) { ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke(); }

    for (const b of bumpers) {
      ctx.fillStyle = `rgba(255,120,210,${0.15 + b.glow * 0.35})`;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 8 + b.glow * 6, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 2, b.x, b.y, b.r);
      g.addColorStop(0, '#ffd0f0');
      g.addColorStop(1, '#b0307f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    }
    for (const m of mines) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.spin);
      ctx.fillStyle = '#ff6b5e';
      for (let i = 0; i < 8; i++) { ctx.rotate(TAU / 8); ctx.fillRect(m.r - 3, -2, 7, 4); }
      ctx.fillStyle = '#3a1010';
      ctx.beginPath(); ctx.arc(0, 0, m.r, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(255,107,94,${0.5 + 0.5 * Math.sin(time * 6)})`;
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const t of targets) {
      if (t.hit && t.pop <= 0) continue;
      const s = t.hit ? 1 + (1 - t.pop) * 0.8 : 1 + Math.sin(time * 3 + t.x) * 0.04;
      ctx.globalAlpha = t.hit ? t.pop : 1;
      ctx.strokeStyle = '#7af0c8';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r * s, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(122,240,200,0.25)';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r * s * 0.55, 0, TAU); ctx.fill();
      if (t.orbit && !t.hit) {
        ctx.strokeStyle = 'rgba(122,240,200,0.15)';
        ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.arc(t.orbit.cx, t.orbit.cy, t.orbit.rad, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }

    // Aim: a rubber band from the puck back toward the pull, and the path forward.
    if (aim && state === 'playing' && !puck.moving) {
      const dx = aim.dx, dy = aim.dy, pull = Math.hypot(dx, dy), k = Math.min(1, pull / MAX_PULL);
      const pts = previewPath(dx, dy);
      ctx.strokeStyle = `rgba(255,210,94,${0.35 + k * 0.4})`;
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      const band = Math.min(MAX_PULL, pull) * 0.6 + rubber(Math.max(0, pull - MAX_PULL), 120);
      const bx = puck.x - (dx / (pull || 1)) * band, by = puck.y - (dy / (pull || 1)) * band;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(puck.x, puck.y); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, TAU); ctx.fill();
      // Power ring.
      ctx.strokeStyle = k >= 1 ? '#ffd25e' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(puck.x, puck.y, PR + 9, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    }

    if (puck.trail.length > 1) {
      for (let i = 1; i < puck.trail.length; i++) {
        ctx.strokeStyle = `rgba(255,210,94,${i / puck.trail.length * 0.5})`;
        ctx.lineWidth = (i / puck.trail.length) * PR;
        ctx.beginPath();
        ctx.moveTo(puck.trail[i - 1].x, puck.trail[i - 1].y);
        ctx.lineTo(puck.trail[i].x, puck.trail[i].y);
        ctx.stroke();
      }
    }
    // Puck with a little stretch along its motion, so speed reads in the frame.
    const sp = Math.hypot(puck.vx, puck.vy), st = 1 + Math.min(0.35, sp / 2600);
    ctx.save();
    ctx.translate(puck.x, puck.y);
    ctx.rotate(Math.atan2(puck.vy, puck.vx));
    ctx.scale(st, 1 / st);
    ctx.shadowColor = '#ffd25e';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(0, 0, PR, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#e0a020';
    ctx.beginPath(); ctx.arc(0, 0, PR * 0.5, 0, TAU); ctx.fill();
    ctx.restore();

    for (const p of particles) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    for (const p of pops) {
      ctx.globalAlpha = Math.min(1, (1.3 - p.t) * 2);
      ctx.font = '900 17px system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(p.text, p.x, p.y - p.t * 30);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - p.t * 30);
    }
    ctx.globalAlpha = 1;

    // Shots left as pucks along the bottom rim.
    for (let i = 0; i < shots; i++) {
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath(); ctx.arc(M + 14 + i * 20, H - M / 2, 6, 0, TAU); ctx.fill();
    }
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`TABLE ${level}`, W - M, H - M / 2 + 4);
    if (state === 'playing' && level === 1 && shots >= targets.length + 2 && !aim) {
      ctx.textAlign = 'center';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('Drag back from anywhere and let go · banks multiply points', W / 2, H - M - 18);
    }
    ctx.restore();
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('shots').textContent = shots;
    $('table').textContent = level;
  }

  // ---------- Input: pull back from anywhere, 1:1 with the pointer ----------

  const toLocal = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  };
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (!overlayEl.hidden || state !== 'playing' || puck.moving) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drag = toLocal(e);
    aim = { dx: 0, dy: 0 };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = toLocal(e);
    aim = { dx: drag.x - p.x, dy: drag.y - p.y };
  });
  const letGo = () => {
    if (!drag) return;
    drag = null;
    if (aim) shoot(aim.dx, aim.dy);
    aim = null;
  };
  canvas.addEventListener('pointerup', letGo);
  canvas.addEventListener('pointercancel', () => { drag = null; aim = null; });

  // Keyboard: arrows aim and set power, Space shoots.
  let keyAim = { a: -Math.PI / 2, p: 90 };
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') { state = 'paused'; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); }
      else if (state === 'paused') resume();
      return;
    }
    if (!overlayEl.hidden || state !== 'playing' || puck.moving) return;
    const k = { ArrowLeft: [-0.06, 0], ArrowRight: [0.06, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.code];
    if (k) {
      e.preventDefault();
      keyAim.a += k[0];
      keyAim.p = clamp(keyAim.p + k[1], 15, MAX_PULL);
      aim = { dx: Math.cos(keyAim.a) * keyAim.p, dy: Math.sin(keyAim.a) * keyAim.p };
    } else if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      const a = aim || { dx: Math.cos(keyAim.a) * keyAim.p, dy: Math.sin(keyAim.a) * keyAim.p };
      shoot(a.dx, a.dy);
      aim = null;
    }
  });
  function resume() { state = 'playing'; ui.hide(); }
  Arcade.onBlur(() => { if (state === 'playing') { state = 'paused'; drag = null; aim = null; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); } });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state !== 'paused') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => score,
    intro: {
      title: 'Ricochet Rally',
      html: `<ul>
        <li>Drag back from anywhere on the table and let go to send the puck the other way. Pull further for more power.</li>
        <li>Hit every <b>target ring</b> to clear the table. Each wall or bumper bank before a hit multiplies its points.</li>
        <li>Shots left over when the table is clear pay a bonus. Run out with targets standing and it's over.</li>
        <li>Later tables add <b>mines</b> (they cost a shot) and targets that orbit. Keys: arrows aim, <kbd>Space</kbd> shoots.</li>
      </ul>`,
      button: 'Rack up',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
