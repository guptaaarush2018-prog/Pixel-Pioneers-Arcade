(() => {
  const ID = 'cloud-climber';
  const W = 400, H = 640;
  const GRAVITY = 1900, JUMP = -860, SPRING = -1450, BOOST = -1150, MOVE = 360;
  const PW = 30, PH = 34, PLAT_H = 14, MAX_CELLS = 3;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  // Sky colors (top, bottom) by how far you've climbed.
  const SKY = [
    { at: 0, top: '#5fb8ff', bottom: '#d5f1ff' },
    { at: 5000, top: '#ff8a6b', bottom: '#ffd3a3' },
    { at: 10000, top: '#2a2366', bottom: '#7a3f8f' },
    { at: 16000, top: '#05040f', bottom: '#170d36' },
  ];

  const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() < 0.2 ? 2 : 1 }));
  const clouds = Array.from({ length: 6 }, (_, i) => ({ x: Math.random() * W, y: i * 140, s: Arcade.rand(0.7, 1.4) }));

  let state = 'ready';
  let player, platforms, drones, cells, particles;
  let camY, topY, startY, climb, bonus, cellsHeld, boostT, time, held, touchDir;

  function reset() {
    platforms = [{ x: 0, y: 600, w: W, type: 'ground', vx: 0 }];
    drones = [];
    cells = [];
    particles = [];
    topY = 600;
    player = { x: W / 2 - PW / 2, y: 600 - PH, vx: 0, vy: JUMP, face: 1, squash: 0 };
    camY = 0;
    startY = player.y;
    climb = 0;
    bonus = 0;
    cellsHeld = 1;
    boostT = 0;
    time = 0;
    held = { left: false, right: false };
    touchDir = 0;
    generate();
    updateHud();
  }

  const difficulty = () => Math.min(1, climb / 14000);

  function addRow() {
    const d = difficulty();
    const gap = Arcade.rand(55, 70 + 85 * d); // max jump height is ~195px, so this always stays reachable
    topY -= gap;
    const w = Math.round(Arcade.rand(70, 90) - d * 26);
    const x = Arcade.rand(0, W - w);
    const r = Math.random();
    const pMoving = 0.08 + 0.22 * d, pCrumble = 0.05 + 0.15 * d;
    let type = 'normal';
    if (r < 0.06) type = 'spring';
    else if (r < 0.06 + pMoving) type = 'moving';
    else if (r < 0.06 + pMoving + pCrumble) type = 'crumble';
    platforms.push({
      x, y: topY, w, type,
      vx: type === 'moving' ? Arcade.pick([-1, 1]) * Arcade.rand(50, 90 + 90 * d) : 0,
      broken: false, fallV: 0,
    });
    if (type !== 'crumble' && Math.random() < 0.07) cells.push({ x: x + w / 2, y: topY - 20 });
    if (climb > 1200 && Math.random() < 0.04 + 0.1 * d) {
      drones.push({ x: Arcade.rand(10, W - 46), y: topY + gap / 2 - 11, w: 36, h: 22, vx: Arcade.pick([-1, 1]) * Arcade.rand(40, 100), alive: true });
    }
  }

  function generate() {
    while (topY > camY - 120) addRow();
    const bottom = camY + H + 60;
    platforms = platforms.filter(p => p.y < bottom);
    drones = drones.filter(d => d.y < bottom);
    cells = cells.filter(c => c.y < bottom);
  }

  function boost() {
    if (state !== 'playing' || cellsHeld <= 0) return;
    cellsHeld--;
    player.vy = BOOST;
    boostT = 0.7;
    Arcade.tone({ freq: 120, to: 600, dur: 0.4, type: 'sawtooth', vol: 0.05 });
    updateHud();
  }

  function bounce(v) {
    player.vy = v;
    player.squash = 1;
    Arcade.tone(v === SPRING
      ? { freq: 300, to: 1200, dur: 0.22, type: 'triangle', vol: 0.07 }
      : { freq: 380, to: 620, dur: 0.08, type: 'square', vol: 0.035 });
  }

  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function update(dt) {
    time += dt;
    const dir = (held.right ? 1 : 0) - (held.left ? 1 : 0) || touchDir;
    if (dir) player.face = dir;
    player.vx += (dir * MOVE - player.vx) * Math.min(1, dt * 12);
    player.x += player.vx * dt;
    if (player.x + PW / 2 < 0) player.x += W;
    else if (player.x + PW / 2 > W) player.x -= W;

    const prevBottom = player.y + PH;
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    player.squash = Math.max(0, player.squash - dt * 5);
    boostT = Math.max(0, boostT - dt);

    for (const p of platforms) {
      if (p.type === 'moving') {
        p.x += p.vx * dt;
        if (p.x < 0 || p.x + p.w > W) {
          p.vx *= -1;
          p.x = Math.max(0, Math.min(W - p.w, p.x));
        }
      }
      if (p.broken) {
        p.fallV += GRAVITY * dt;
        p.y += p.fallV * dt;
        continue;
      }
      // One-way platforms: only land when falling onto the top edge.
      if (player.vy > 0 && prevBottom <= p.y && player.y + PH >= p.y &&
          player.x + PW - 6 > p.x && player.x + 6 < p.x + p.w) {
        player.y = p.y - PH;
        bounce(p.type === 'spring' ? SPRING : JUMP);
        if (p.type === 'crumble') {
          p.broken = true;
          for (let i = 0; i < 8; i++) puff(p.x + Math.random() * p.w, p.y + 6, '#c99a6b');
        }
      }
    }

    const body = { x: player.x + 4, y: player.y + 4, w: PW - 8, h: PH - 6 };
    for (const d of drones) {
      if (!d.alive) continue;
      d.x += d.vx * dt;
      if (d.x < 0 || d.x + d.w > W) d.vx *= -1;
      if (!overlaps(body, d)) continue;
      const stomp = player.vy > 0 && prevBottom <= d.y + 10;
      if (stomp || boostT > 0) {
        d.alive = false;
        bonus += 100;
        if (stomp) bounce(JUMP);
        for (let i = 0; i < 14; i++) puff(d.x + d.w / 2, d.y + d.h / 2, '#ff4fd8');
        Arcade.tone({ freq: 800, to: 200, dur: 0.15, type: 'square', vol: 0.05 });
      } else {
        gameOver('Zapped by a drone!');
        return;
      }
    }

    for (let i = cells.length - 1; i >= 0; i--) {
      const c = cells[i];
      if (overlaps(body, { x: c.x - 8, y: c.y - 10, w: 16, h: 20 })) {
        cells.splice(i, 1);
        if (cellsHeld < MAX_CELLS) cellsHeld++;
        else bonus += 50;
        Arcade.tone({ freq: 660, to: 1320, dur: 0.12, type: 'triangle', vol: 0.06 });
        updateHud();
      }
    }

    if (boostT > 0) puff(player.x + PW / 2, player.y + PH, Math.random() < 0.5 ? '#ffd23f' : '#ff8a3d');

    camY = Math.min(camY, player.y - H * 0.42);
    climb = Math.max(climb, startY - player.y);
    generate();
    updateHud();

    if (player.y > camY + H + 30) gameOver('You fell!');
  }

  function puff(x, y, color) {
    particles.push({ x, y, vx: Arcade.rand(-60, 60), vy: Arcade.rand(20, 140), life: Arcade.rand(0.3, 0.6), color });
  }

  const score = () => Math.floor(climb / 10) + bonus;

  function updateHud() {
    $('score').textContent = score();
    $('cells').textContent = `${cellsHeld}/${MAX_CELLS}`;
    $('best').textContent = Math.max(score(), Arcade.getBest(ID));
  }

  function gameOver(reason) {
    state = 'over';
    Arcade.tone({ freq: 500, to: 80, dur: 0.6, type: 'sawtooth', vol: 0.06 });
    const s = score();
    Arcade.finish(ui, {
      score: s,
      title: reason,
      lines: [`Height: ${Math.floor(climb / 10)}m`],
      button: 'Climb again',
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

  // ---------- Input ----------

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (!e.repeat) boost();
      return;
    }
    const d = Arcade.DIRS[e.code];
    if (d === 'left' || d === 'right') held[d] = true;
  });
  window.addEventListener('keyup', e => {
    const d = Arcade.DIRS[e.code];
    if (d === 'left' || d === 'right') held[d] = false;
  });

  function holdButton(el, onDown, onUp) {
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); onDown(); });
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, onUp);
  }
  holdButton($('left'), () => { touchDir = -1; }, () => { if (touchDir === -1) touchDir = 0; });
  holdButton($('right'), () => { touchDir = 1; }, () => { if (touchDir === 1) touchDir = 0; });
  $('boost').addEventListener('pointerdown', e => { e.preventDefault(); boost(); });

  // Touching the left or right half of the game also steers.
  holdButton(canvas, () => {}, () => { touchDir = 0; });
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const r = canvas.getBoundingClientRect();
    touchDir = e.clientX < r.left + r.width / 2 ? -1 : 1;
  });

  Arcade.onBlur(() => {
    held.left = held.right = false;
    touchDir = 0;
    pause();
  });

  // ---------- Drawing ----------

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
  }
  function skyAt(h) {
    let i = 0;
    while (i < SKY.length - 2 && h > SKY[i + 1].at) i++;
    const a = SKY[i], b = SKY[i + 1];
    const t = Math.max(0, Math.min(1, (h - a.at) / (b.at - a.at)));
    return [mix(a.top, b.top, t), mix(a.bottom, b.bottom, t)];
  }

  function drawBackground() {
    const [top, bottom] = skyAt(climb);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const starAlpha = Math.max(0, Math.min(1, (climb - 8000) / 6000));
    if (starAlpha > 0) {
      ctx.fillStyle = `rgba(255,255,255,${starAlpha})`;
      for (const s of stars) {
        const y = (((s.y - camY * 0.05) % H) + H) % H;
        ctx.fillRect(s.x, y, s.s, s.s);
      }
    }

    const cloudAlpha = Math.max(0, 1 - climb / 11000) * 0.7;
    if (cloudAlpha > 0) {
      ctx.fillStyle = `rgba(255,255,255,${cloudAlpha})`;
      for (const c of clouds) {
        const y = ((((c.y - camY * 0.3) % (H + 200)) + H + 200) % (H + 200)) - 100;
        for (const [dx, dy, r] of [[0, 0, 22], [24, -8, 28], [52, 0, 22], [26, 8, 20]]) {
          ctx.beginPath();
          ctx.arc(c.x + dx * c.s, y + dy * c.s, r * c.s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Height markers every 250m.
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    const step = 2500;
    const first = Math.ceil((startY - (camY + H)) / step) * step;
    for (let h = Math.max(step, first); startY - h > camY; h += step) {
      const y = startY - h - camY;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(0, y, W, 1);
      ctx.fillText(`${h / 10}m`, W - 6, y - 4);
    }
  }

  const PLAT_COLORS = {
    ground: ['#4caf7a', '#2f7a50'],
    normal: ['#7cf5b0', '#36a874'],
    spring: ['#7cf5b0', '#36a874'],
    moving: ['#a99bff', '#6a58d6'],
    crumble: ['#d8a878', '#8f6440'],
  };

  function drawPlatform(p) {
    const y = p.y - camY;
    const [top, side] = PLAT_COLORS[p.type];
    ctx.globalAlpha = p.broken ? Math.max(0, 1 - p.fallV / 900) : 1;
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.roundRect(p.x, y + 3, p.w, PLAT_H - 2, 6);
    ctx.fill();
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.roundRect(p.x, y, p.w, PLAT_H - 5, 6);
    ctx.fill();
    if (p.type === 'crumble') {
      ctx.strokeStyle = side;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x + p.w * 0.3, y); ctx.lineTo(p.x + p.w * 0.38, y + 8);
      ctx.moveTo(p.x + p.w * 0.7, y); ctx.lineTo(p.x + p.w * 0.62, y + 8);
      ctx.stroke();
    }
    if (p.type === 'spring') {
      const cx = p.x + p.w / 2;
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 8, y);
      for (let i = 1; i <= 4; i++) ctx.lineTo(cx + (i % 2 ? 8 : -8), y - i * 3);
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(cx - 10, y - 15, 20, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawDrone(d) {
    const x = d.x, y = d.y - camY;
    const blink = Math.floor(time * 4) % 2;
    ctx.fillStyle = '#2b2440';
    ctx.beginPath();
    ctx.roundRect(x, y + 6, d.w, d.h - 6, 6);
    ctx.fill();
    ctx.fillStyle = blink ? '#ff4fd8' : '#ff8ae6';
    ctx.beginPath();
    ctx.arc(x + d.w / 2, y + 14, 4, 0, Math.PI * 2);
    ctx.fill();
    // Spinning rotors.
    ctx.fillStyle = '#c9c3e6';
    const spin = Math.abs(Math.sin(time * 30)) * 10 + 2;
    ctx.fillRect(x + 6 - spin / 2, y + 2, spin, 2);
    ctx.fillRect(x + d.w - 6 - spin / 2, y + 2, spin, 2);
    ctx.fillRect(x + 5, y + 3, 2, 4);
    ctx.fillRect(x + d.w - 7, y + 3, 2, 4);
  }

  function drawCell(c) {
    const x = c.x, y = c.y - camY + Math.sin(time * 4 + c.x) * 3;
    ctx.fillStyle = '#ffd23f';
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(x - 7, y - 9, 14, 18, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillRect(x - 3, y - 12, 6, 3);
    ctx.fillStyle = '#5a4300';
    ctx.fillRect(x - 1, y - 5, 2, 10);
    ctx.fillRect(x - 5, y - 1, 10, 2);
  }

  function drawPlayer(x) {
    const y = player.y - camY;
    // Squash on landing, stretch while rising fast.
    const stretch = Math.max(-0.15, Math.min(0.15, -player.vy / 6000)) - player.squash * 0.18;
    const w = PW * (1 - stretch), h = PH * (1 + stretch);
    const bx = x + (PW - w) / 2, by = y + (PH - h);
    ctx.fillStyle = '#e8f7ff';
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 9);
    ctx.fill();
    ctx.fillStyle = '#1d2a4a';
    ctx.beginPath();
    ctx.roundRect(bx + 4 + player.face * 2, by + 7, w - 8, 12, 5);
    ctx.fill();
    ctx.fillStyle = '#3ef0ff';
    ctx.fillRect(bx + w / 2 - 2 + player.face * 6, by + 10, 5, 5);
    ctx.fillStyle = '#e8f7ff';
    ctx.fillRect(bx + w / 2 - 1, by - 6, 2, 6);
    ctx.fillStyle = '#ff4fd8';
    ctx.beginPath();
    ctx.arc(bx + w / 2, by - 7, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9fb3c8';
    ctx.fillRect(bx + 4, by + h - 4, 8, 4);
    ctx.fillRect(bx + w - 12, by + h - 4, 8, 4);
  }

  function draw() {
    drawBackground();
    for (const p of platforms) drawPlatform(p);
    for (const c of cells) drawCell(c);
    for (const d of drones) if (d.alive) drawDrone(d);

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 1.8);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 3, p.y - camY - 3, 6, 6);
    }
    ctx.globalAlpha = 1;

    // Draw a second copy when wrapping around the edge.
    drawPlayer(player.x);
    if (player.x < 0) drawPlayer(player.x + W);
    if (player.x + PW > W) drawPlayer(player.x - W);
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
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  ui.show({
    title: 'Cloud Climber',
    html: `<ul>
      <li>You bounce automatically. Steer left and right; the sides wrap around.</li>
      <li><b style="color:#a99bff">Purple</b> platforms move, <b style="color:#d8a878">cracked</b> ones crumble after one bounce, and <b style="color:#ffd23f">springs</b> launch you.</li>
      <li>Grab <b style="color:#ffd23f">battery cells</b> for a rocket boost (Space). Boosting smashes drones.</li>
      <li>Stomp drones from above. Touching one any other way ends the run.</li>
    </ul>`,
    button: 'Start climbing',
    onAction: start,
  });
  requestAnimationFrame(frame);
})();
