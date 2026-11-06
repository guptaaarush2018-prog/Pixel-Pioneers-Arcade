(() => {
  const ID = 'putt-planet';
  const W = 960, H = 540;
  const BALL_R = 7, CUP_R = 11, SINK_SPEED = 380;
  const MAX_POWER = 900, MAX_DRAG = 150, MAX_STROKES = 8;
  const ROLL_DECEL = 200, DAMPING = 0.55, SAND = 5, STOP = 8;

  // Every hole: an outline (or several rooms), plus whatever's on it. Coordinates are canvas pixels.
  const rect = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const HOLES = [
    { name: 'First Contact', par: 2, tee: [180, 290], cup: [780, 290], rooms: [rect(120, 180, 840, 400)] },
    { name: 'Dogleg', par: 3, tee: [160, 180], cup: [760, 420], rooms: [[[100, 100], [860, 100], [860, 480], [660, 480], [660, 260], [100, 260]]] },
    {
      name: 'Sand Trap', par: 3, tee: [160, 290], cup: [800, 290], rooms: [rect(100, 120, 860, 460)],
      sand: [{ x: 480, y: 290, r: 110 }], walls: [[[480, 120], [480, 215]], [[480, 365], [480, 460]]],
    },
    {
      name: 'Bumper Alley', par: 3, tee: [130, 290], cup: [830, 290], rooms: [rect(80, 160, 880, 420)],
      bumpers: [{ x: 300, y: 225, r: 22 }, { x: 300, y: 355, r: 22 }, { x: 480, y: 290, r: 26 }, { x: 660, y: 225, r: 22 }, { x: 660, y: 355, r: 22 }],
    },
    {
      name: 'The Moat', par: 3, tee: [170, 400], cup: [790, 180], rooms: [rect(100, 100, 860, 480)],
      water: [rect(380, 100, 580, 250), rect(380, 330, 580, 480)],
    },
    {
      name: 'First Orbit', par: 3, tee: [150, 290], cup: [810, 290], rooms: [rect(80, 80, 880, 500)],
      planets: [{ x: 480, y: 290, r: 60, pull: 2.6e6, field: 200, color: '#6fa8ff' }],
    },
    {
      name: 'Wormhole', par: 2, tee: [140, 290], cup: [820, 200], rooms: [rect(80, 120, 420, 460), rect(540, 120, 880, 460)],
      portals: [{ a: [360, 290], b: [610, 290] }],
      sand: [{ x: 760, y: 380, r: 60 }],
    },
    {
      name: 'Sliders', par: 3, tee: [130, 290], cup: [830, 290], rooms: [rect(80, 150, 880, 430)],
      movers: [{ x: 330, y: 290, len: 130, amp: 75, period: 3, vertical: true }, { x: 630, y: 290, len: 130, amp: 75, period: 2.2, vertical: true, phase: Math.PI }],
    },
    {
      name: 'Boost Lane', par: 3, tee: [140, 165], cup: [140, 415],
      rooms: [[[80, 80], [880, 80], [880, 500], [80, 500], [80, 330], [720, 330], [720, 250], [80, 250]]],
      boosts: [{ x: 280, y: 340, w: 300, h: 150, dx: -1, dy: 0 }],
      sand: [{ x: 800, y: 290, r: 45 }],
    },
    {
      name: 'Black Hole Sun', par: 4, tee: [120, 470], cup: [840, 110], rooms: [rect(60, 60, 900, 520)],
      holes: [{ x: 480, y: 290, r: 26, pull: 5e6, field: 230 }],
      planets: [{ x: 300, y: 150, r: 34, pull: 0, field: 0, color: '#ffb36b' }, { x: 660, y: 430, r: 34, pull: 0, field: 0, color: '#ff8fab' }],
    },
    {
      name: 'Zigzag', par: 4, tee: [140, 440], cup: [830, 440], rooms: [rect(80, 80, 880, 500)],
      walls: [[[300, 80], [300, 380]], [[520, 200], [520, 500]], [[740, 80], [740, 380]]],
      sand: [{ x: 410, y: 140, r: 45 }, { x: 630, y: 440, r: 45 }],
      bumpers: [{ x: 410, y: 440, r: 18 }],
    },
    {
      name: 'Grand Finale', par: 4, tee: [110, 110], cup: [850, 460], rooms: [rect(60, 60, 900, 520)],
      planets: [{ x: 330, y: 220, r: 45, pull: 1.8e6, field: 150, color: '#9be37a' }],
      water: [rect(560, 300, 700, 520)],
      movers: [{ x: 780, y: 300, len: 110, amp: 120, period: 2.6, vertical: true }],
      portals: [{ a: [160, 460], b: [620, 140] }],
      bumpers: [{ x: 470, y: 420, r: 20 }],
    },
  ];
  const TOTAL_PAR = HOLES.reduce((t, h) => t + h.par, 0);

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';   // 'aim' | 'rolling' | 'sunk' | 'paused' | 'over'
  let holeIdx, hole, ball, strokes, card, aim, drag, keyAim, keyPower, safePos, time, popups, trail, portalCool, sinkT, aces, banner;

  // ---------- Setup ----------

  function reset() {
    holeIdx = 0;
    card = [];
    aces = 0;
    popups = [];
    time = 0;
    keyAim = 0;
    keyPower = 0.5;
    loadHole();
  }

  function loadHole() {
    hole = HOLES[holeIdx];
    ball = { x: hole.tee[0], y: hole.tee[1], vx: 0, vy: 0, scale: 1 };
    safePos = { x: ball.x, y: ball.y };
    strokes = 0;
    trail = [];
    portalCool = 0;
    drag = null;
    keyAim = Math.atan2(hole.cup[1] - ball.y, hole.cup[0] - ball.x);
    banner = { text: `Hole ${holeIdx + 1} · ${hole.name}`, sub: `Par ${hole.par}`, t: 2.2 };
    state = 'aim';
    updateHud();
  }

  // Wall segments: every room edge, plus loose walls.
  function segments() {
    const out = [];
    for (const room of hole.rooms) for (let i = 0; i < room.length; i++) out.push([room[i], room[(i + 1) % room.length], 0, 0]);
    for (const w of hole.walls || []) out.push([w[0], w[1], 0, 0]);
    for (const m of hole.movers || []) {
      const { x, y, vx, vy } = moverPos(m);
      const half = m.len / 2;
      out.push(m.vertical ? [[x, y - half], [x, y + half], vx, vy] : [[x - half, y], [x + half, y], vx, vy]);
    }
    return out;
  }

  function moverPos(m) {
    const w = (Math.PI * 2) / m.period, p = time * w + (m.phase || 0);
    const off = Math.sin(p) * m.amp, vel = Math.cos(p) * m.amp * w;
    return m.vertical ? { x: m.x, y: m.y + off, vx: 0, vy: vel } : { x: m.x + off, y: m.y, vx: vel, vy: 0 };
  }

  const inRect = (r, x, y) => x >= r[0][0] && x <= r[2][0] && y >= r[0][1] && y <= r[2][1];

  // ---------- Shooting ----------

  function shoot(power, angle) {
    if (state !== 'aim' || power < 0.04) return;
    safePos = { x: ball.x, y: ball.y };
    ball.vx = Math.cos(angle) * power * MAX_POWER;
    ball.vy = Math.sin(angle) * power * MAX_POWER;
    strokes++;
    state = 'rolling';
    Arcade.tone({ freq: 300 + power * 400, to: 200, dur: 0.08, type: 'triangle', vol: 0.06 });
    updateHud();
  }

  function penalty(text) {
    strokes++;
    popups.push({ x: ball.x, y: ball.y - 20, text, t: 0, color: '#7fdbff' });
    Arcade.tone({ freq: 300, to: 90, dur: 0.35, type: 'sine', vol: 0.06 });
    ball.x = safePos.x;
    ball.y = safePos.y;
    ball.vx = ball.vy = 0;
    trail = [];
    if (strokes >= MAX_STROKES) return pickUp();
    state = 'aim';
    updateHud();
  }

  function pickUp() {
    strokes = MAX_STROKES;
    popups.push({ x: ball.x, y: ball.y - 20, text: 'Picked up', t: 0, color: '#ff8a80' });
    finishHole();
  }

  function sink() {
    state = 'sunk';
    sinkT = 0;
    ball.vx = ball.vy = 0;
    const d = strokes - hole.par;
    const names = { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };
    const text = strokes === 1 ? 'HOLE IN ONE!' : names[d] || `+${d}`;
    if (strokes === 1) {
      aces++;
      Arcade.flag('putt-planet-ace');
    }
    popups.push({ x: hole.cup[0], y: hole.cup[1] - 26, text, t: 0, color: d < 0 ? '#ffd23f' : '#ffffff', big: true });
    Arcade.tone({ freq: 660, to: 990, dur: 0.15, type: 'triangle', vol: 0.06 });
    Arcade.tone({ freq: 990, to: 1320, dur: 0.2, type: 'triangle', vol: 0.06, delay: 0.12 });
    finishHole();
  }

  function finishHole() {
    card.push(strokes);
    if (state !== 'sunk') state = 'sunk';
    sinkT = 0;
    updateHud();
  }

  function nextHole() {
    holeIdx++;
    if (holeIdx >= HOLES.length) return endRound();
    loadHole();
  }

  const totalStrokes = () => card.reduce((a, b) => a + b, 0);
  const parSoFar = () => HOLES.slice(0, card.length).reduce((t, h) => t + h.par, 0);
  const toPar = () => totalStrokes() - parSoFar();
  const score = () => Math.max(0, 1000 + (parSoFar() - totalStrokes()) * 100 + aces * 150);
  const fmtPar = n => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

  function endRound() {
    state = 'over';
    Arcade.flag('putt-planet-round');
    if (toPar() < 0) Arcade.flag('putt-planet-under');
    const cells = (arr, f) => arr.map(f).join('');
    const row = (label, arr, f) => `<tr><th style="text-align:left;padding-right:6px">${label}</th>${cells(arr, f)}</tr>`;
    const td = v => `<td style="padding:2px 4px;text-align:center">${v}</td>`;
    const table = `<table style="font-size:12px;margin:0 auto 12px;border-collapse:collapse;color:var(--muted)">
      ${row('Hole', HOLES, (_, i) => td(i + 1))}${row('Par', HOLES, h => td(h.par))}
      ${row('You', card, (s, i) => td(`<b style="color:${s < HOLES[i].par ? '#ffd23f' : s > HOLES[i].par ? '#ff8a80' : 'var(--text)'}">${s}</b>`))}</table>`;
    Arcade.finish(ui, {
      score: score(),
      title: 'Round complete',
      lines: [`${totalStrokes()} strokes · ${fmtPar(toPar())} against par ${TOTAL_PAR}${aces ? ` · ${aces} hole${aces > 1 ? 's' : ''} in one` : ''}`],
      html: table,
      button: 'Play again',
      onAction: start,
    });
  }

  // ---------- Physics ----------

  function collideSegment(seg) {
    const [[x1, y1], [x2, y2], mvx, mvy] = seg;
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((ball.x - x1) * dx + (ball.y - y1) * dy) / len2));
    const cx = x1 + dx * t, cy = y1 + dy * t;
    const ox = ball.x - cx, oy = ball.y - cy, d = Math.hypot(ox, oy);
    if (d >= BALL_R || d === 0) return;
    const nx = ox / d, ny = oy / d;
    ball.x = cx + nx * BALL_R;
    ball.y = cy + ny * BALL_R;
    const rvx = ball.vx - mvx, rvy = ball.vy - mvy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      ball.vx -= 1.75 * vn * nx;
      ball.vy -= 1.75 * vn * ny;
      if (Math.abs(vn) > 60) Arcade.tone({ freq: 220, dur: 0.03, type: 'square', vol: Math.min(0.04, Math.abs(vn) / 20000) });
    }
  }

  function collideCircle(c, restitution, kick = 0) {
    const ox = ball.x - c.x, oy = ball.y - c.y, d = Math.hypot(ox, oy);
    if (d >= c.r + BALL_R || d === 0) return false;
    const nx = ox / d, ny = oy / d;
    ball.x = c.x + nx * (c.r + BALL_R);
    ball.y = c.y + ny * (c.r + BALL_R);
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= (1 + restitution) * vn * nx;
      ball.vy -= (1 + restitution) * vn * ny;
    }
    if (kick) {
      ball.vx += nx * kick;
      ball.vy += ny * kick;
    }
    return true;
  }

  function step(dt) {
    const speed = Math.hypot(ball.vx, ball.vy);
    // Gravity from planets and black holes.
    for (const p of [...(hole.planets || []), ...(hole.holes || [])]) {
      const dx = p.x - ball.x, dy = p.y - ball.y, d = Math.hypot(dx, dy);
      if (!p.pull || d > p.field + p.r) continue;
      const a = p.pull / Math.max(d * d, p.r * p.r);
      ball.vx += (dx / d) * a * dt;
      ball.vy += (dy / d) * a * dt;
    }
    for (const b of hole.boosts || []) {
      if (ball.x > b.x && ball.x < b.x + b.w && ball.y > b.y && ball.y < b.y + b.h) {
        ball.vx += b.dx * 1100 * dt;
        ball.vy += b.dy * 1100 * dt;
      }
    }
    const inSand = (hole.sand || []).some(s => Math.hypot(ball.x - s.x, ball.y - s.y) < s.r);
    const decel = ROLL_DECEL * (inSand ? SAND : 1);
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - decel * dt) * Math.exp(-DAMPING * dt * (inSand ? 3 : 1));
      ball.vx *= ns / sp;
      ball.vy *= ns / sp;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    for (const seg of segments()) collideSegment(seg);
    for (const b of hole.bumpers || []) if (collideCircle(b, 0.9, 120)) Arcade.tone({ freq: 880, dur: 0.05, type: 'square', vol: 0.03 });
    for (const p of hole.planets || []) collideCircle(p, 0.6);

    portalCool = Math.max(0, portalCool - dt);
    if (!portalCool) for (const p of hole.portals || []) {
      for (const [from, to] of [[p.a, p.b], [p.b, p.a]]) {
        if (Math.hypot(ball.x - from[0], ball.y - from[1]) < 14) {
          ball.x = to[0];
          ball.y = to[1];
          portalCool = 0.6;
          trail = [];
          Arcade.flag('putt-planet-portal');
          Arcade.tone({ freq: 400, to: 1200, dur: 0.2, type: 'sine', vol: 0.05 });
          break;
        }
      }
    }

    for (const w of hole.water || []) if (inRect(w, ball.x, ball.y)) return penalty('Splash! +1');
    for (const b of hole.holes || []) if (Math.hypot(ball.x - b.x, ball.y - b.y) < b.r) return penalty('Swallowed! +1');

    // The cup: slow enough and it drops; too fast and it lips out.
    const cd = Math.hypot(ball.x - hole.cup[0], ball.y - hole.cup[1]);
    if (cd < CUP_R) {
      if (speed < SINK_SPEED) return sink();
      ball.vx *= 0.8;
      ball.vy *= 0.8;
      const a = Arcade.rand(-0.25, 0.25), c = Math.cos(a), s = Math.sin(a);
      [ball.vx, ball.vy] = [ball.vx * c - ball.vy * s, ball.vx * s + ball.vy * c];
    } else if (cd < CUP_R + 6 && speed < SINK_SPEED) {
      ball.vx += ((hole.cup[0] - ball.x) / cd) * 300 * dt;
      ball.vy += ((hole.cup[1] - ball.y) / cd) * 300 * dt;
    }

    if (Math.hypot(ball.vx, ball.vy) < STOP && !(hole.boosts || []).some(b => ball.x > b.x && ball.x < b.x + b.w && ball.y > b.y && ball.y < b.y + b.h)) {
      ball.vx = ball.vy = 0;
      if (strokes >= MAX_STROKES) return pickUp();
      state = 'aim';
      keyAim = Math.atan2(hole.cup[1] - ball.y, hole.cup[0] - ball.x);
    }
  }

  function update(dt) {
    time += dt;
    if (banner) banner.t -= dt;
    for (const p of popups) p.t += dt;
    popups = popups.filter(p => p.t < 1.4);
    if (state === 'rolling') {
      const sp = Math.hypot(ball.vx, ball.vy);
      const n = Math.max(1, Math.ceil((sp * dt) / 3));
      for (let k = 0; k < n && state === 'rolling'; k++) step(dt / n);
      trail.push([ball.x, ball.y]);
      if (trail.length > 14) trail.shift();
    } else if (state === 'sunk') {
      sinkT += dt;
      ball.scale = Math.max(0, 1 - sinkT * 3);
      if (sinkT > 1.4) nextHole();
    } else if (state === 'aim') {
      if (held.left) keyAim -= dt * 1.8;
      if (held.right) keyAim += dt * 1.8;
      if (held.up) keyPower = Math.min(1, keyPower + dt * 0.7);
      if (held.down) keyPower = Math.max(0.05, keyPower - dt * 0.7);
    }
  }

  function updateHud() {
    $('hole').textContent = `${Math.min(holeIdx + 1, HOLES.length)}/${HOLES.length}`;
    $('strokes').textContent = strokes;
    $('topar').textContent = fmtPar(toPar());
    $('best').textContent = Arcade.getBest(ID);
  }

  // ---------- Input ----------

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }
  // Drag anywhere and pull back like a slingshot; the shot goes the opposite way.
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'aim') return;
    const [x, y] = toBoard(e);
    drag = { x0: x, y0: y, x, y };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    [drag.x, drag.y] = toBoard(e);
  });
  const release = () => {
    if (!drag) return;
    const { power, angle } = dragShot();
    drag = null;
    shoot(power, angle);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { drag = null; });

  function dragShot() {
    const dx = drag.x0 - drag.x, dy = drag.y0 - drag.y;
    return { power: Math.min(1, Math.hypot(dx, dy) / MAX_DRAG), angle: Math.atan2(dy, dx) };
  }

  const held = { left: false, right: false, up: false, down: false };
  const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'aim' || state === 'rolling' || state === 'sunk') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (KEYS[e.code]) {
      e.preventDefault();
      held[KEYS[e.code]] = true;
    }
    if (e.code === 'Space' && !e.repeat && state === 'aim') {
      e.preventDefault();
      shoot(keyPower, keyAim);
    }
  });
  window.addEventListener('keyup', e => { if (KEYS[e.code]) held[KEYS[e.code]] = false; });

  let resumeTo = 'aim';
  function pause() {
    resumeTo = state;
    state = 'paused';
    drag = null;
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }
  function resume() {
    state = resumeTo;
    ui.hide();
  }
  Arcade.onBlur(() => { if (['aim', 'rolling', 'sunk'].includes(state)) pause(); });

  function start() {
    reset();
    ui.hide();
  }

  // ---------- Drawing ----------

  const stars = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() }));

  function pathPoly(pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function draw() {
    ctx.fillStyle = '#0b0d1f';
    ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + s.s * 0.5})`;
      ctx.fillRect(s.x, s.y, 1 + s.s, 1 + s.s);
    }
    if (!hole) return;

    // Turf with a frame.
    for (const room of hole.rooms) {
      pathPoly(room);
      ctx.fillStyle = '#2f8f4e';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 18;
      for (let x = -H; x < W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + H, H);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const s of hole.sand || []) {
      ctx.fillStyle = '#e3c983';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,120,60,0.25)';
      for (let k = 0; k < 10; k++) ctx.fillRect(s.x + Math.cos(k * 2.4) * s.r * 0.6, s.y + Math.sin(k * 1.7) * s.r * 0.6, 3, 2);
    }
    for (const w of hole.water || []) {
      ctx.fillStyle = '#2a6fb8';
      pathPoly(w);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      for (let y = w[0][1] + 12; y < w[2][1]; y += 18) {
        ctx.beginPath();
        for (let x = w[0][0] + 6; x < w[2][0] - 6; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.08 + time * 3) * 2);
        ctx.stroke();
      }
    }
    for (const b of hole.boosts || []) {
      ctx.fillStyle = 'rgba(255,210,63,0.15)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(255,210,63,0.6)';
      const off = (time * 80) % 40;
      for (let x = b.x + (b.dx < 0 ? b.w - off : off); b.dx < 0 ? x > b.x : x < b.x + b.w; x += b.dx < 0 ? -40 : 40) {
        ctx.beginPath();
        ctx.moveTo(x, b.y + b.h / 2 - 16);
        ctx.lineTo(x + b.dx * 14, b.y + b.h / 2);
        ctx.lineTo(x, b.y + b.h / 2 + 16);
        ctx.lineTo(x + 6 * -b.dx, b.y + b.h / 2);
        ctx.fill();
      }
    }

    // Gravity fields.
    for (const p of [...(hole.planets || []), ...(hole.holes || [])]) {
      if (!p.pull) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + ((p.field * k) / 3 - ((time * 30) % (p.field / 3))), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const b of hole.holes || []) {
      const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r * 2);
      g.addColorStop(0, '#000');
      g.addColorStop(0.5, '#000');
      g.addColorStop(0.75, 'rgba(195,155,255,0.6)');
      g.addColorStop(1, 'rgba(195,155,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of hole.planets || []) {
      const g = ctx.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.4, p.r * 0.1, p.x, p.y, p.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.3, p.color);
      g.addColorStop(1, '#1a1d3a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of hole.bumpers || []) {
      ctx.fillStyle = '#ff4fd8';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd1f5';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of hole.portals || []) {
      for (const [x, y] of [p.a, p.b]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(time * 3);
        ctx.strokeStyle = '#c39bff';
        ctx.lineWidth = 3;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(0, 0, 14 - k * 4, k, k + 4);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Walls.
    ctx.strokeStyle = '#d7c9a8';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const room of hole.rooms) {
      pathPoly(room);
      ctx.stroke();
    }
    for (const w of hole.walls || []) {
      ctx.beginPath();
      ctx.moveTo(...w[0]);
      ctx.lineTo(...w[1]);
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffb36b';
    for (const m of hole.movers || []) {
      const { x, y } = moverPos(m);
      ctx.beginPath();
      if (m.vertical) { ctx.moveTo(x, y - m.len / 2); ctx.lineTo(x, y + m.len / 2); } else { ctx.moveTo(x - m.len / 2, y); ctx.lineTo(x + m.len / 2, y); }
      ctx.stroke();
    }

    // Cup and flag.
    const [cx, cy] = hole.cup;
    ctx.fillStyle = '#0d1a10';
    ctx.beginPath();
    ctx.arc(cx, cy, CUP_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#eceef2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - 46);
    ctx.stroke();
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 46);
    ctx.lineTo(cx + 24 + Math.sin(time * 4) * 3, cy - 39);
    ctx.lineTo(cx, cy - 32);
    ctx.fill();

    // Aim guide.
    if (state === 'aim') {
      const shot = drag ? dragShot() : { power: keyPower, angle: keyAim };
      const len = 40 + shot.power * 160;
      ctx.strokeStyle = `rgba(255,255,255,${drag ? 0.8 : 0.45})`;
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(ball.x + Math.cos(shot.angle) * len, ball.y + Math.sin(shot.angle) * len);
      ctx.stroke();
      ctx.setLineDash([]);
      // Power meter beside the ball.
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(ball.x + 16, ball.y - 30, 8, 60);
      ctx.fillStyle = shot.power > 0.8 ? '#ff6b6b' : shot.power > 0.5 ? '#ffd23f' : '#9be37a';
      ctx.fillRect(ball.x + 16, ball.y + 30 - 60 * shot.power, 8, 60 * shot.power);
    }

    // Ball and trail.
    for (let i = 0; i < trail.length; i++) {
      ctx.globalAlpha = (i / trail.length) * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(trail[i][0], trail[i][1], BALL_R * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (ball.scale > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(ball.x + 2, ball.y + 3, BALL_R * ball.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R * ball.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.4);
      ctx.fillStyle = p.color;
      ctx.font = `800 ${p.big ? 24 : 15}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - p.t * 30);
    }
    ctx.globalAlpha = 1;

    // Header.
    ctx.textAlign = 'left';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillStyle = '#eceef2';
    ctx.fillText(`Hole ${holeIdx + 1} · ${hole.name}`, 14, 26);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillStyle = '#8d94a1';
    ctx.fillText(`Par ${hole.par} · stroke ${strokes}${strokes >= MAX_STROKES - 2 ? ` (pick up at ${MAX_STROKES})` : ''}`, 14, 46);
    ctx.textAlign = 'right';
    ctx.fillText(`Round ${fmtPar(toPar())} · ${totalStrokes()} strokes`, W - 14, 26);

    if (banner && banner.t > 0 && state !== 'over') {
      ctx.globalAlpha = Math.min(1, banner.t / 0.4);
      ctx.textAlign = 'center';
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(banner.text, W / 2, H / 2 - 4);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(banner.sub, W / 2, H / 2 + 20);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state !== 'paused' && state !== 'menu' && state !== 'over') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  state = 'menu';
  Versus.attach({
    ui,
    start,
    score: () => score(),
    intro: {
      title: 'Putt Planet',
      html: `<ul>
        <li><b>Drag back</b> anywhere and let go to putt, like a slingshot. Or aim with <b>←→</b>, set power with <b>↑↓</b>, and putt with <b>Space</b>.</li>
        <li>Too fast and the ball lips out of the cup.</li>
        <li>Planets pull your ball. Black holes and water cost a stroke. Portals, bumpers, sliders and boost pads change everything.</li>
        <li>12 holes, par ${TOTAL_PAR}. Each stroke under par is worth 100 points.</li>
      </ul>`,
      button: 'Tee off',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
