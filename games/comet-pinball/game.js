(() => {
  const W = 420, H = 720, R = 9, GRAVITY = 760, SUB = 8, MAX_V = 1800;
  const LANE_X = 370, OUTER = 400, LANE_FLOOR = 700;
  const BALLS = 3, SAVE_TIME = 10;
  const FLIP_LEN = 62, FLIP_R = 7, FLIP_UP_SPEED = 24, FLIP_DOWN_SPEED = 14;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- Table ----------

  // Walls are line segments. oneWay ones only push from their front (left-hand) side;
  // kick ones are slingshot faces that fire the ball back out.
  const walls = [];
  const seg = (ax, ay, bx, by, o = {}) => walls.push({ ax, ay, bx, by, e: 0.4, ...o });
  const poly = (pts, o) => { for (let i = 1; i < pts.length; i++) seg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], o); };

  // The dome runs across the whole table, plunger lane included, so a launch curls round to the left.
  const dome = [];
  for (let i = 0; i <= 28; i++) {
    const t = Math.PI + (Math.PI * i) / 28;
    dome.push([210 + 190 * Math.cos(t), 180 + 160 * Math.sin(t)]);
  }
  poly([[20, 590], ...dome, [OUTER, LANE_FLOOR]]);
  seg(LANE_X, 250, LANE_X, LANE_FLOOR);
  seg(LANE_X, LANE_FLOOR, OUTER, LANE_FLOOR);
  seg(OUTER, 222, LANE_X, 250, { oneWay: true, gate: true }); // lets the ball out of the lane, never back in
  seg(20, 590, 122, 648);   // inlane guides down to the flippers
  seg(LANE_X, 590, 268, 648);

  // Slingshots above each flipper: the long inner face kicks.
  const slings = [
    [[58, 470], [58, 556], [108, 586]],
    [[332, 470], [332, 556], [282, 586]],
  ].map(([a, b, c]) => {
    seg(a[0], a[1], b[0], b[1]);
    seg(b[0], b[1], c[0], c[1]);
    const face = { ax: c[0], ay: c[1], bx: a[0], by: a[1], e: 0.4, kick: true, flash: 0 };
    walls.push(face);
    return { pts: [a, b, c], face };
  });

  // Posts between the three rollover lanes at the top.
  const LANE_POSTS = [128, 173, 218, 263];
  LANE_POSTS.forEach(x => seg(x, 64, x, 104, { e: 0.3 }));
  const LANES = [150, 195, 240];
  const LANE_NAMES = ['C', 'O', 'M'];

  const bumpers = [
    { x: 145, y: 205, r: 22, color: '#ff6b6b' },
    { x: 250, y: 205, r: 22, color: '#4f8cff' },
    { x: 197, y: 282, r: 22, color: '#3ddc84' },
  ].map(b => ({ ...b, flash: 0 }));

  // Drop targets along the left wall.
  const targets = [330, 362, 394].map(y => ({ x: 36, y, h: 26, down: false }));

  const flippers = [
    { px: 122, py: 648, rest: 0.52, up: -0.5, key: 'left' },
    { px: 268, py: 648, rest: Math.PI - 0.52, up: Math.PI + 0.5, key: 'right' },
  ].map(f => ({ ...f, a: f.rest, w: 0 }));

  // ---------- State ----------

  let state = 'ready';
  let balls, score, ballNo, mult, bonus, lit, banks, saveUntil, time, charge, banner, skill, drained, particles;
  const held = { left: false, right: false, launch: false };

  function reset() {
    score = 0;
    ballNo = 1;
    particles = [];
    banner = null;
    time = 0;
    newBall();
    updateHud();
  }

  // A fresh ball in the plunger lane. One rollover lane flashes: shoot it on the launch for the skill shot.
  function newBall() {
    balls = [laneBall()];
    mult = 1;
    bonus = 0;
    lit = [false, false, false];
    banks = 0;
    targets.forEach(t => { t.down = false; });
    saveUntil = 0;
    charge = 0;
    drained = false;
    skill = { lane: Arcade.randInt(0, 2), live: true };
  }

  const laneBall = () => ({ x: (LANE_X + OUTER) / 2, y: LANE_FLOOR - R - 1, vx: 0, vy: 0, out: false, still: 0 });
  const inLane = b => b.x > LANE_X && b.y > 600;

  function say(text, sub = '') {
    banner = { text, sub, t: 1.6 };
  }

  function add(points, bonusPts = 0) {
    score += points;
    bonus += bonusPts;
    updateHud();
  }

  function sparks(x, y, color, n = 8) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: Arcade.rand(-160, 160), vy: Arcade.rand(-160, 160), life: Arcade.rand(0.25, 0.5), color });
  }

  // ---------- Physics ----------

  // Pushes the ball out of a fat segment (radius rr) and bounces it. sv is the surface's own
  // velocity at the contact point (flippers). Returns the impact speed, or 0 for no contact.
  function collide(b, ax, ay, bx, by, rr, e, oneWay = false, sv = null) {
    const ex = bx - ax, ey = by - ay;
    const len2 = ex * ex + ey * ey || 1;
    const t = clamp(((b.x - ax) * ex + (b.y - ay) * ey) / len2, 0, 1);
    const cx = ax + ex * t, cy = ay + ey * t;
    let dx = b.x - cx, dy = b.y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= R + rr) return 0;
    if (oneWay && (b.x - ax) * -ey + (b.y - ay) * ex < 0) return 0;
    let nx, ny;
    if (d > 1e-6) { nx = dx / d; ny = dy / d; } else { const l = Math.sqrt(len2); nx = -ey / l; ny = ex / l; }
    b.x = cx + nx * (R + rr);
    b.y = cy + ny * (R + rr);
    const svx = sv ? sv(cx, cy)[0] : 0, svy = sv ? sv(cx, cy)[1] : 0;
    const vn = (b.vx - svx) * nx + (b.vy - svy) * ny;
    if (vn >= 0) return 0.001;
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
    b.nx = nx;
    b.ny = ny;
    return -vn;
  }

  function moveFlippers(h) {
    for (const f of flippers) {
      const target = held[f.key] ? f.up : f.rest;
      const speed = held[f.key] ? FLIP_UP_SPEED : FLIP_DOWN_SPEED;
      const before = f.a;
      const diff = target - f.a;
      f.a += Math.sign(diff) * Math.min(Math.abs(diff), speed * h);
      f.w = (f.a - before) / h;
    }
  }

  const tip = f => [f.px + Math.cos(f.a) * FLIP_LEN, f.py + Math.sin(f.a) * FLIP_LEN];

  function stepBall(b, h) {
    b.vy += GRAVITY * h;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_V) { b.vx *= MAX_V / sp; b.vy *= MAX_V / sp; }
    b.x += b.vx * h;
    b.y += b.vy * h;

    for (const w of walls) {
      const hit = collide(b, w.ax, w.ay, w.bx, w.by, 2, w.e, w.oneWay);
      if (hit > 40 && w.kick) {
        b.vx += b.nx * 420;
        b.vy += b.ny * 420;
        w.flash = 0.12;
        skill.live = false;
        add(10, 10);
        Arcade.tone({ freq: 520, dur: 0.05, vol: 0.04 });
      }
    }

    for (const t of targets) {
      if (t.down) continue;
      if (collide(b, t.x, t.y, t.x, t.y + t.h, 3, 0.35) > 60) hitTarget(t);
    }

    for (const bp of bumpers) {
      const dx = b.x - bp.x, dy = b.y - bp.y, d = Math.hypot(dx, dy);
      if (d >= R + bp.r || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      b.x = bp.x + nx * (R + bp.r);
      b.y = bp.y + ny * (R + bp.r);
      const vn = b.vx * nx + b.vy * ny;
      // Pop bumpers always fire the ball away at a good clip, however gently it arrived.
      const out = Math.max(560, -vn * 0.6);
      b.vx += (out - vn) * nx;
      b.vy += (out - vn) * ny;
      bp.flash = 0.15;
      skill.live = false;
      add(100 * mult, 20);
      sparks(b.x - nx * R, b.y - ny * R, bp.color, 5);
      Arcade.tone({ freq: 300 + bumpers.indexOf(bp) * 120, dur: 0.06, type: 'triangle', vol: 0.05 });
    }

    for (const f of flippers) {
      const [tx, ty] = tip(f);
      const sv = (cx, cy) => [-f.w * (cy - f.py), f.w * (cx - f.px)];
      if (collide(b, f.px, f.py, tx, ty, FLIP_R, 0.25, false, sv)) skill.live = false;
    }

    // Rollover lanes light as the ball passes through them.
    if (b.y > 66 && b.y < 104) {
      LANES.forEach((x, i) => {
        if (Math.abs(b.x - x) > 12 || lit[i]) return;
        lit[i] = true;
        add(50 * mult, 50);
        Arcade.tone({ freq: 700 + i * 90, dur: 0.07, type: 'triangle', vol: 0.04 });
        if (skill.live && i === skill.lane) {
          add(5000);
          say('SKILL SHOT', '+5,000');
          Arcade.flag('comet-pinball-skill');
        }
        skill.live = false;
        if (lit.every(Boolean)) {
          mult = Math.min(5, mult + 1);
          add(1000, 200);
          say(`${LANE_NAMES.join('')} COMPLETE`, `Multiplier x${mult}`);
          setTimeout(() => { lit = [false, false, false]; }, 500);
        }
      });
    }
  }

  function hitTarget(t) {
    t.down = true;
    skill.live = false;
    add(250 * mult, 100);
    sparks(t.x + 4, t.y + t.h / 2, '#ffc53d', 6);
    Arcade.tone({ freq: 880, dur: 0.06, vol: 0.04 });
    if (!targets.every(x => x.down)) return;
    banks++;
    mult = Math.min(5, mult + 1);
    add(1500 * mult, 300);
    setTimeout(() => targets.forEach(x => { x.down = false; }), 900);
    // Every second cleared bank lights multiball: a second ball fires from the lane.
    if (banks % 2 === 0 && balls.length < 3) {
      const extra = laneBall();
      extra.vy = -1250;
      balls.push(extra);
      saveUntil = Math.max(saveUntil, time + 8);
      say('MULTIBALL', `Multiplier x${mult}`);
      Arcade.flag('comet-pinball-multi');
      Arcade.tone({ freq: 400, to: 1200, dur: 0.5, type: 'triangle', vol: 0.06 });
    } else {
      say('TARGETS DOWN', `Multiplier x${mult}`);
    }
  }

  function ballsCollide() {
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= R * 2 || d === 0) continue;
        const nx = dx / d, ny = dy / d, push = (R * 2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel >= 0) continue;
        a.vx += rel * nx; a.vy += rel * ny;
        b.vx -= rel * nx; b.vy -= rel * ny;
      }
    }
  }

  // ---------- Game flow ----------

  function update(dt) {
    time += dt;
    const h = dt / SUB;
    for (let s = 0; s < SUB; s++) {
      moveFlippers(h);
      for (const b of balls) stepBall(b, h);
      if (balls.length > 1) ballsCollide();
    }

    // Plunger: hold to pull back, let go to fire whichever ball is sitting in the lane.
    const waiting = balls.find(b => inLane(b) && Math.abs(b.vy) < 30);
    if (held.launch && waiting) charge = Math.min(1, charge + dt * 1.1);
    else if (charge > 0) {
      if (waiting) {
        waiting.vy = -(620 + 820 * charge);
        Arcade.tone({ freq: 180, to: 520, dur: 0.15, type: 'triangle', vol: 0.05 });
      }
      charge = 0;
    }

    for (const b of balls) {
      if (!b.out && b.x < LANE_X - R) {
        b.out = true;
        if (!saveUntil) saveUntil = time + SAVE_TIME;
      }
      // A ball that settles somewhere it shouldn't gets a nudge (cradled on a flipper is fine).
      b.still = Math.hypot(b.vx, b.vy) < 8 && b.y < 600 ? b.still + dt : 0;
      if (b.still > 3) {
        b.vx = Arcade.rand(-200, 200);
        b.vy = -300;
        b.still = 0;
      }
      if (!Number.isFinite(b.x + b.y) || b.x < -20 || b.x > W + 20 || b.y < -40) Object.assign(b, laneBall());
    }

    const lost = balls.filter(b => b.y > H + 30);
    if (lost.length) {
      balls = balls.filter(b => b.y <= H + 30);
      if (time < saveUntil) {
        lost.forEach(() => balls.push(laneBall()));
        say('BALL SAVED');
        Arcade.tone({ freq: 660, to: 990, dur: 0.2, type: 'triangle', vol: 0.05 });
      } else if (!balls.length) {
        endBall();
        return;
      }
    }

    for (const bp of bumpers) bp.flash = Math.max(0, bp.flash - dt);
    for (const s of slings) s.face.flash = Math.max(0, s.face.flash - dt);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    if (banner && (banner.t -= dt) <= 0) banner = null;
  }

  // End-of-ball bonus: everything you lit, times the multiplier.
  function endBall() {
    const total = bonus * mult;
    score += total;
    Arcade.tone({ freq: 300, to: 90, dur: 0.5, type: 'sawtooth', vol: 0.05 });
    if (ballNo >= BALLS) {
      state = 'over';
      updateHud();
      Arcade.finish(ui, {
        score,
        lines: [`Last ball bonus ${total.toLocaleString()} (${bonus.toLocaleString()} × ${mult})`],
        onAction: start,
      });
      return;
    }
    say(`BONUS ${total.toLocaleString()}`, `${bonus.toLocaleString()} × ${mult}`);
    ballNo++;
    newBall();
    updateHud();
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('ball').textContent = `${Math.min(ballNo, BALLS)}/${BALLS}`;
    $('mult').textContent = `x${mult}`;
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    held.left = held.right = held.launch = false;
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }

  function resume() {
    state = 'playing';
    ui.hide();
  }

  // ---------- Input ----------

  const KEYS = {
    ArrowLeft: 'left', KeyA: 'left', KeyZ: 'left', ShiftLeft: 'left',
    ArrowRight: 'right', KeyD: 'right', Slash: 'right', ShiftRight: 'right',
    Space: 'launch', ArrowDown: 'launch', KeyS: 'launch',
  };
  function press(k, down) {
    if (state !== 'playing') { held[k] = false; return; }
    if (down && !held[k] && k !== 'launch') {
      Arcade.tone({ freq: 150, dur: 0.03, vol: 0.03 });
      // Flipping shifts which rollover lanes are lit, so you can line up the gap.
      lit = k === 'left' ? [...lit.slice(1), lit[0]] : [lit[2], ...lit.slice(0, 2)];
    }
    held[k] = down;
  }
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (KEYS[e.code] && !e.repeat) press(KEYS[e.code], true);
  });
  window.addEventListener('keyup', e => { if (KEYS[e.code]) held[KEYS[e.code]] = false; });

  // Tap the left or right half of the table to flip that side.
  const touches = new Map();
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const k = e.clientX - r.left < r.width / 2 ? 'left' : 'right';
    touches.set(e.pointerId, k);
    press(k, true);
  });
  const lift = e => {
    const k = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (k && ![...touches.values()].includes(k)) held[k] = false;
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  for (const [id, k] of [['t-left', 'left'], ['t-launch', 'launch'], ['t-right', 'right']]) {
    const b = $(id);
    b.addEventListener('pointerdown', e => { e.preventDefault(); press(k, true); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { held[k] = false; });
  }
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  const table = Arcade.makeLayer(W, H);
  (function paintTable() {
    const c = table.ctx;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1b1440');
    g.addColorStop(1, '#0d0f22');
    c.fillStyle = '#0a0b16';
    c.fillRect(0, 0, W, H);
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(20, 590);
    dome.forEach(([x, y]) => c.lineTo(x, y));
    c.lineTo(OUTER, LANE_FLOOR);
    c.lineTo(LANE_X, LANE_FLOOR);
    c.lineTo(LANE_X, 590);
    c.lineTo(268, 648);
    c.lineTo(268, H);
    c.lineTo(122, H);
    c.lineTo(122, 648);
    c.closePath();
    c.fill();
    // Starfield and a comet across the middle of the playfield.
    c.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 70; i++) {
      const x = 30 + ((i * 97) % 330), y = 60 + ((i * 151) % 520);
      c.fillRect(x, y, (i % 5 === 0) ? 2 : 1, (i % 5 === 0) ? 2 : 1);
    }
    const tail = c.createLinearGradient(90, 470, 250, 380);
    tail.addColorStop(0, 'rgba(94,200,216,0)');
    tail.addColorStop(1, 'rgba(94,200,216,0.35)');
    c.strokeStyle = tail;
    c.lineWidth = 18;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(90, 470);
    c.quadraticCurveTo(170, 450, 250, 380);
    c.stroke();
    c.fillStyle = 'rgba(94,200,216,0.55)';
    c.beginPath();
    c.arc(252, 378, 11, 0, Math.PI * 2);
    c.fill();
    c.font = '800 13px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(236,238,242,0.18)';
    c.fillText('COMET', 195, 520);
    // Arrow under the drop targets.
    c.fillStyle = 'rgba(255,197,61,0.25)';
    c.beginPath();
    c.moveTo(80, 365); c.lineTo(62, 357); c.lineTo(62, 373);
    c.fill();
    // Walls on top of everything else.
    c.strokeStyle = '#8d94c8';
    c.lineWidth = 4;
    c.lineCap = 'round';
    for (const w of walls) {
      if (w.kick || w.gate) continue;
      c.beginPath();
      c.moveTo(w.ax, w.ay);
      c.lineTo(w.bx, w.by);
      c.stroke();
    }
  })();

  function drawFlipper(f) {
    const [tx, ty] = tip(f);
    const nx = -Math.sin(f.a), ny = Math.cos(f.a);
    ctx.fillStyle = '#ffc53d';
    ctx.beginPath();
    ctx.moveTo(f.px + nx * 9, f.py + ny * 9);
    ctx.lineTo(tx + nx * 5, ty + ny * 5);
    ctx.arc(tx, ty, 5, f.a + Math.PI / 2, f.a - Math.PI / 2, true);
    ctx.lineTo(f.px - nx * 9, f.py - ny * 9);
    ctx.arc(f.px, f.py, 9, f.a - Math.PI / 2, f.a + Math.PI / 2, true);
    ctx.fill();
    ctx.fillStyle = '#7a5a12';
    ctx.beginPath();
    ctx.arc(f.px, f.py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    ctx.drawImage(table.canvas, 0, 0, W, H);

    // One-way gate, drawn thin so it reads as a flap.
    ctx.strokeStyle = 'rgba(141,148,200,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(OUTER, 222);
    ctx.lineTo(LANE_X, 250);
    ctx.stroke();

    // Rollover lanes.
    const flashOn = Math.floor(time * 4) % 2 === 0;
    LANES.forEach((x, i) => {
      const skillHere = skill?.live && i === skill.lane && flashOn;
      ctx.fillStyle = lit?.[i] ? '#ffc53d' : skillHere ? '#5ec8d8' : 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(x, 86, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = lit?.[i] || skillHere ? '#12151b' : 'rgba(255,255,255,0.5)';
      ctx.fillText(LANE_NAMES[i], x, 90);
    });

    for (const s of slings) {
      const [a, b, c] = s.pts;
      ctx.fillStyle = s.face.flash > 0 ? '#ffffff' : '#c77dff';
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]);
      ctx.closePath();
      ctx.fill();
    }

    for (const t of targets) {
      ctx.fillStyle = t.down ? 'rgba(255,197,61,0.15)' : '#ffc53d';
      ctx.fillRect(t.x - 4, t.y + 2, t.down ? 3 : 8, t.h - 4);
    }

    for (const bp of bumpers) {
      ctx.fillStyle = bp.flash > 0 ? '#ffffff' : bp.color;
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, bp.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#12151b';
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, bp.r - 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bp.color;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('100', bp.x, bp.y + 4);
    }

    flippers.forEach(drawFlipper);

    // Plunger spring.
    const py = LANE_FLOOR + 4 + charge * 14;
    ctx.fillStyle = '#8d94a1';
    ctx.fillRect(LANE_X + 6, py, OUTER - LANE_X - 12, 6);
    ctx.fillRect((LANE_X + OUTER) / 2 - 2, py + 6, 4, H - py);
    if (charge > 0) {
      ctx.fillStyle = '#ffc53d';
      ctx.fillRect(LANE_X + 4, LANE_FLOOR - 70, 3, -charge * 60);
    }

    for (const b of balls || []) {
      const g = ctx.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#9aa3b5');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of particles || []) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (state === 'playing' && time < saveUntil && balls.some(b => b.out)) {
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = flashOn ? '#3ddc84' : 'rgba(61,220,132,0.4)';
      ctx.fillText('BALL SAVE', 195, 700);
    }

    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 3);
      ctx.fillStyle = 'rgba(10,11,22,0.75)';
      ctx.fillRect(40, 400, 310, banner.sub ? 64 : 44);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffc53d';
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillText(banner.text, 195, 430);
      if (banner.sub) {
        ctx.fillStyle = '#eceef2';
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.fillText(banner.sub, 195, 452);
      }
      ctx.globalAlpha = 1;
    }

    if (state === 'playing' && balls.some(b => inLane(b) && !b.out) && charge === 0 && balls.length === 1) {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8d94a1';
      ctx.fillText('Hold Space to pull the plunger', 195, 610);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.025, (now - last) / 1000);
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
      title: 'Comet Pinball',
      html: `<ul>
        <li>Hold <b>Space</b> to pull the plunger and let go to launch.</li>
        <li>Flip with <kbd>←</kbd><kbd>→</kbd> (or <kbd>Z</kbd> <kbd>/</kbd>), or tap either side of the table.</li>
        <li>Light <b>C·O·M</b> and knock down the targets to raise your multiplier. Every second bank starts multiball.</li>
        <li>Launch straight into the flashing lane for a 5,000-point skill shot.</li>
      </ul>`,
      button: 'Start',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
