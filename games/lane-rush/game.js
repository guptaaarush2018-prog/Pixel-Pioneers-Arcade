/* Lane Rush: weave a four-lane highway as it speeds up. Close calls chain into a combo, coins are
   worth 50, trucks take up more road, and a shield pickup soaks one crash. */
(() => {
  const W = 360, H = 640, LANES = 4, LANE_W = 70, ROAD_X = (W - LANES * LANE_W) / 2;
  const CAR_W = 40, CAR_H = 70, TRUCK_H = 112, PLAYER_Y = 520;
  const COLORS = ['#4f8cff', '#3ddc84', '#c77dff', '#ff6b6b', '#e8e8e8', '#5ec8d8', '#ff9f43'];
  const TRUCKS = ['#d9dde4', '#e8c547', '#6aa3d9', '#d9774c'];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const { shade, alpha, roundRect } = Gfx;

  const fx = Gfx.particles(700);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();

  let state = 'ready';
  let lane, x, tilt, speed, distance, bonus, traffic, pickups, nextRow, combo, comboUntil, time, scroll;
  let shield, invuln, wreck, puffT, smashed;

  const laneX = l => ROAD_X + l * LANE_W + LANE_W / 2;

  function reset() {
    lane = 1;
    x = laneX(lane);
    tilt = 0;
    speed = 320;
    distance = 0;
    bonus = 0;
    traffic = [];
    pickups = [];
    nextRow = 200;
    combo = 0;
    comboUntil = 0;
    time = 0;
    scroll = 0;
    shield = false;
    invuln = 0;
    wreck = null;
    puffT = 0;
    smashed = [];
    fx.clear();
    pops.list.length = 0;
    updateHud();
  }

  // Each row of traffic always leaves at least one lane open, and rows are spaced so you
  // can cross the whole road between them at the current speed. Every Math.random call here
  // happens no matter what the player does, so seeded duels spawn the same road for both.
  function spawnRow() {
    const count = Math.random() < 0.25 + Math.min(0.4, time / 120) ? Arcade.randInt(2, 3) : 1;
    const lanes = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    const taken = lanes.slice(0, count);
    let longest = CAR_H;
    for (const l of taken) {
      const truck = Math.random() < (time > 20 ? 0.22 : 0);
      const len = truck ? TRUCK_H : CAR_H;
      longest = Math.max(longest, len);
      traffic.push({
        lane: l, len, truck, y: -len - Arcade.rand(0, 30),
        color: truck ? Arcade.pick(TRUCKS) : Arcade.pick(COLORS), passed: false,
      });
    }
    const free = lanes.slice(count);
    const roll = Math.random(), where = Arcade.pick(free);
    if (time > 15 && roll < 0.06) pickups.push({ lane: where, y: -40, kind: 'shield' });
    else if (roll < 0.35) pickups.push({ lane: where, y: -40, kind: 'coin' });
    // Trucks are longer, so leave a bit more room behind them.
    return (longest - CAR_H) / 0.75;
  }

  function steer(dir) {
    if (state !== 'playing') return;
    const next = Math.max(0, Math.min(LANES - 1, lane + dir));
    if (next !== lane) {
      lane = next;
      tilt = dir * 0.18;
      Arcade.tone({ freq: 300, to: 360, dur: 0.05, vol: 0.025 });
    }
  }

  function update(dt) {
    time += dt;
    speed = Math.min(950, 320 + time * 7);
    if (speed >= 950) Arcade.flag('lane-rush-floored');
    if (distance >= 20000) Arcade.flag('lane-rush-10k');
    const dy = speed * dt;
    distance += dy;
    scroll += dy;
    invuln = Math.max(0, invuln - dt);

    x += (laneX(lane) - x) * Math.min(1, dt * 16);
    tilt *= Math.pow(0.02, dt);

    nextRow -= dy;
    if (nextRow <= 0) {
      const extra = spawnRow();
      nextRow = Math.max(190, speed * 0.55) + Arcade.rand(0, 120) + extra;
    }

    const me = { x: x - CAR_W / 2 + 5, y: PLAYER_Y + 6, w: CAR_W - 10, h: CAR_H - 12 };
    for (let k = traffic.length - 1; k >= 0; k--) {
      const c = traffic[k];
      c.y += dy * 0.75; // traffic drives too, just slower than you
      const cx = laneX(c.lane) - CAR_W / 2;
      if (me.x < cx + CAR_W - 5 && me.x + me.w > cx + 5 && me.y < c.y + c.len - 6 && me.y + me.h > c.y + 6) {
        if (invuln > 0) continue;
        if (shield) { smash(c); traffic.splice(k, 1); continue; }
        crash(c);
        return;
      }
      if (!c.passed && c.y > PLAYER_Y + CAR_H) {
        c.passed = true;
        if (invuln <= 0 && Math.abs(laneX(c.lane) - x) < LANE_W * 1.2) {
          combo = time < comboUntil ? combo + 1 : 1;
          comboUntil = time + 2;
          if (combo >= 5) Arcade.flag('lane-rush-weaver');
          const pts = 25 * Math.min(combo, 8);
          bonus += pts;
          const side = laneX(c.lane) < x ? -1 : 1;
          pops.add(combo > 1 ? `Close call ×${combo}` : 'Close call', x + side * 40, PLAYER_Y + 10 - (combo % 2) * 24, { color: combo >= 5 ? '#ffe066' : '#ffffff', size: 15 });
          fx.burst(8 + Math.min(combo, 8), () => ({
            x: x + side * (CAR_W / 2), y: PLAYER_Y + Gfx.rand(10, CAR_H - 10),
            vx: side * Gfx.rand(-30, 60), vy: Gfx.rand(120, 300), drag: 3, life: Gfx.rand(0.25, 0.45),
            size: 2, color: Gfx.rand() < 0.5 ? '#ffe066' : '#ffffff', shape: 'spark',
          }));
          Arcade.tone({ freq: 500 + combo * 60, dur: 0.06, type: 'triangle', vol: 0.04 });
        }
      }
    }
    traffic = traffic.filter(c => c.y < H + 20);

    for (const p of pickups) p.y += dy;
    pickups = pickups.filter(p => {
      if (p.y > H + 20) return false;
      if (Math.abs(laneX(p.lane) - x) < 30 && Math.abs(p.y - (PLAYER_Y + CAR_H / 2)) < 40) {
        collect(p);
        return false;
      }
      return true;
    });

    // Exhaust puffs.
    puffT -= dt;
    if (puffT <= 0) {
      puffT = 0.06;
      fx.emit({ x: x + Gfx.rand(-6, 6), y: PLAYER_Y + CAR_H + 2, vx: Gfx.rand(-10, 10), vy: speed * 0.25, drag: 2, life: 0.4, size: 3, grow: 10, color: 'rgba(220,225,235,0.35)' });
    }
    updateHud();
  }

  function collect(p) {
    const px = laneX(p.lane);
    if (p.kind === 'coin') {
      bonus += 50;
      pops.add('+50', px, p.y - 10, { color: '#ffe066', size: 18 });
      fx.burst(12, () => ({ x: px, y: p.y, vx: Gfx.rand(-120, 120), vy: Gfx.rand(-160, 40), drag: 3, life: 0.5, size: Gfx.rand(1.5, 3), color: '#ffd84d', shape: 'square', spin: 8 }));
      Arcade.tone({ freq: 990, to: 1320, dur: 0.08, vol: 0.04 });
    } else if (shield) {
      bonus += 50;
      pops.add('+50', px, p.y - 10, { color: '#8fd8ff', size: 18 });
      Arcade.tone({ freq: 660, to: 990, dur: 0.1, vol: 0.04 });
    } else {
      shield = true;
      pops.add('Shield!', px, p.y - 10, { color: '#8fd8ff', size: 20 });
      fx.burst(18, i => ({ x: px, y: p.y, vx: Math.cos(i / 18 * 6.28) * 160, vy: Math.sin(i / 18 * 6.28) * 160, drag: 4, life: 0.5, size: 2.5, color: '#8fd8ff' }));
      Arcade.tone({ freq: 440, to: 880, dur: 0.2, type: 'triangle', vol: 0.05 });
    }
  }

  // The shield absorbs a hit: the other car is knocked off the road and you get a moment of grace.
  function smash(c) {
    shield = false;
    invuln = 1;
    bonus += 100;
    const cx = laneX(c.lane), cy = c.y + c.len / 2;
    const dir = cx < x ? -1 : cx > x ? 1 : Gfx.rand() < 0.5 ? -1 : 1;
    smashed.push({ ...c, x: cx, cy, vx: dir * 380, vy: -120, rot: Math.PI, vr: dir * 7, t: 0 });
    pops.add('Smash! +100', cx, cy - 20, { color: '#8fd8ff', size: 18 });
    burstAt(cx, cy, ['#8fd8ff', '#ffffff', c.color], 26);
    shake.add(0.45);
    Arcade.tone({ freq: 180, to: 520, dur: 0.18, type: 'square', vol: 0.05 });
  }

  function burstAt(px, py, cols, n) {
    fx.burst(n, () => ({
      x: px, y: py, vx: Gfx.rand(-260, 260), vy: Gfx.rand(-260, 200), drag: 2.5, life: Gfx.rand(0.4, 0.8),
      size: Gfx.rand(2, 4.5), color: cols[Math.floor(Gfx.rand(0, cols.length))], shape: Gfx.rand() < 0.5 ? 'square' : 'chip', spin: Gfx.rand(-12, 12),
    }));
  }

  const score = () => Math.floor(distance / 20) + bonus;

  function updateHud() {
    $('score').textContent = score();
    $('speed').textContent = `${Math.round(speed / 4)} km/h`;
    $('best').textContent = Math.max(score(), Arcade.getBest(Arcade.gameId));
  }

  function crash(c) {
    state = 'over';
    wreck = { t: 0, vr: (laneX(c.lane) < x ? 1 : -1) * 5 };
    const cy = Math.max(PLAYER_Y, Math.min(PLAYER_Y + CAR_H, c.y + c.len));
    burstAt(x, cy, ['#ffc53d', '#ff7a3d', '#ffffff', c.color], 40);
    fx.burst(14, () => ({ x: x + Gfx.rand(-14, 14), y: cy, vx: Gfx.rand(-40, 40), vy: Gfx.rand(-90, -30), drag: 1, life: Gfx.rand(0.8, 1.3), size: Gfx.rand(5, 9), grow: 14, color: 'rgba(60,60,70,0.45)' }));
    shake.add(0.9);
    Arcade.tone({ freq: 200, to: 40, dur: 0.5, type: 'sawtooth', vol: 0.07 });
    setTimeout(() => Arcade.finish(ui, {
      score: score(),
      title: 'Crashed!',
      lines: [`${(distance / 2000).toFixed(1)} km · top speed ${Math.round(speed / 4)} km/h`],
      button: 'Drive again',
      onAction: start,
    }), 750);
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
    if (e.repeat) return;
    const d = Arcade.DIRS[e.code];
    if (d === 'left') steer(-1);
    if (d === 'right') steer(1);
  });
  $('left').addEventListener('pointerdown', e => { e.preventDefault(); steer(-1); });
  $('right').addEventListener('pointerdown', e => { e.preventDefault(); steer(1); });
  Arcade.onSwipe(canvas.parentElement, d => {
    if (d === 'left') steer(-1);
    if (d === 'right') steer(1);
  });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  // Roadside trees, rendered once and blitted.
  const tree = Gfx.sprite(56, 64, 28, 52, c => {
    Gfx.shadow(c, 32, 54, 22, 8, 0.35);
    c.fillStyle = '#6b4a2e';
    c.fillRect(25, 38, 6, 16);
    const blobs = [[28, 34, 18, '#2f7d3f'], [20, 28, 13, '#3a9a4b'], [35, 24, 13, '#3a9a4b'], [27, 18, 11, '#4fb35e'], [33, 30, 8, '#4fb35e']];
    for (const [bx, by, r, col] of blobs) {
      c.fillStyle = col;
      c.beginPath(); c.arc(bx, by, r, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.beginPath(); c.arc(24, 14, 6, 0, Math.PI * 2); c.fill();
  });
  const bush = Gfx.sprite(30, 22, 15, 16, c => {
    Gfx.shadow(c, 16, 17, 13, 4, 0.3);
    c.fillStyle = '#3f8f45';
    c.beginPath(); c.arc(10, 12, 7, 0, Math.PI * 2); c.arc(18, 10, 8, 0, Math.PI * 2); c.arc(23, 13, 5, 0, Math.PI * 2); c.fill();
  });
  const R = Gfx.rng(11);
  const scenery = Array.from({ length: 14 }, (_, k) => ({ side: k % 2, y: k * 55 + R() * 20, big: R() < 0.6, dx: R() * 8 }));

  function carPath(len) {
    return c => roundRect(c, -CAR_W / 2, -len / 2, CAR_W, len, 9);
  }

  // Vehicles face "up" in their own frame; traffic is drawn rotated by PI. Height is faked by
  // stacking the footprint upward on screen (Gfx.extrude).
  function drawVehicle(cx, cy, v, angle, player = false) {
    const len = v.len || CAR_H;
    Gfx.shadow(ctx, cx + 4, cy + 6, CAR_W * 0.75, len * 0.55, 0.32);
    const col = v.color;
    if (v.truck) {
      const cab = 30, trailer = len - cab - 4;
      // Cab at the front, a taller box trailer behind it.
      Gfx.extrude(ctx, cx, cy, angle, 10, shade(col, -0.4), shade(col, 0.05), c => roundRect(c, -CAR_W / 2 + 2, -len / 2, CAR_W - 4, cab, 7));
      Gfx.extrude(ctx, cx, cy - 10, angle, 4, shade(col, -0.3), shade('#1d2430', 0.1), c => roundRect(c, -CAR_W / 2 + 6, -len / 2 + 4, CAR_W - 12, 10, 3));
      Gfx.extrude(ctx, cx, cy, angle, 18, '#8b93a1', '#eef1f5', c => roundRect(c, -CAR_W / 2, -len / 2 + cab + 4, CAR_W, trailer, 3));
      ctx.save();
      ctx.translate(cx, cy - 18);
      ctx.rotate(angle);
      ctx.fillStyle = alpha(col, 0.85);
      ctx.fillRect(-CAR_W / 2 + 4, -len / 2 + cab + 10, CAR_W - 8, 6);
      ctx.fillRect(-CAR_W / 2 + 4, len / 2 - 14, CAR_W - 8, 6);
      ctx.restore();
      return;
    }
    Gfx.extrude(ctx, cx, cy, angle, 6, shade(col, -0.42), col, carPath(len));
    // Cabin roof sits on the body.
    Gfx.extrude(ctx, cx, cy - 6, angle, 6, shade(col, -0.25), shade(col, 0.18), c => roundRect(c, -CAR_W / 2 + 6, -len / 2 + 20, CAR_W - 12, len * 0.42, 6));
    ctx.save();
    ctx.translate(cx, cy - 6);
    ctx.rotate(angle);
    // Windshield and rear window.
    ctx.fillStyle = '#1d2430';
    ctx.fillRect(-CAR_W / 2 + 7, -len / 2 + 14, CAR_W - 14, 8);
    ctx.fillStyle = 'rgba(160,200,255,0.35)';
    ctx.fillRect(-CAR_W / 2 + 9, -len / 2 + 15, 8, 3);
    ctx.fillStyle = '#1d2430';
    ctx.fillRect(-CAR_W / 2 + 8, -len / 2 + 20 + len * 0.42 - 2, CAR_W - 16, 6);
    // Lights.
    ctx.fillStyle = '#fff7d6';
    ctx.fillRect(-CAR_W / 2 + 4, -len / 2 + 2, 7, 4);
    ctx.fillRect(CAR_W / 2 - 11, -len / 2 + 2, 7, 4);
    ctx.fillStyle = '#ff4a4a';
    ctx.fillRect(-CAR_W / 2 + 4, len / 2 - 5, 7, 3);
    ctx.fillRect(CAR_W / 2 - 11, len / 2 - 5, 7, 3);
    if (player) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(-2, -len / 2 + 1, 4, len - 2);   // racing stripe
    }
    ctx.restore();
  }

  function drawPickup(p) {
    const px = laneX(p.lane), bob = Math.sin(time * 5 + p.y * 0.02) * 3;
    Gfx.shadow(ctx, px, p.y + 12, 11, 4, 0.3);
    if (p.kind === 'coin') {
      const sx = Math.abs(Math.cos(time * 5 + p.lane));
      ctx.save();
      ctx.translate(px, p.y - 4 + bob);
      ctx.scale(Math.max(0.15, sx), 1);
      ctx.fillStyle = '#c48a00';
      ctx.beginPath(); ctx.arc(0, 1.5, 11, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(-3, -4, 1, 0, 0, 11);
      g.addColorStop(0, '#fff2a8'); g.addColorStop(1, '#ffc53d');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d99a0b';
      ctx.fillRect(-2, -6, 4, 12);
      ctx.restore();
    } else {
      const y = p.y - 6 + bob;
      const g = ctx.createRadialGradient(px - 4, y - 4, 2, px, y, 15);
      g.addColorStop(0, 'rgba(220,245,255,0.95)'); g.addColorStop(1, 'rgba(70,170,255,0.55)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, y, 14, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e6f7ff'; ctx.lineWidth = 2; ctx.stroke();
      // Little shield emblem.
      ctx.fillStyle = '#1f6fc2';
      ctx.beginPath();
      ctx.moveTo(px, y - 7); ctx.lineTo(px + 6, y - 4); ctx.lineTo(px + 5, y + 3); ctx.lineTo(px, y + 7); ctx.lineTo(px - 5, y + 3); ctx.lineTo(px - 6, y - 4);
      ctx.closePath(); ctx.fill();
    }
  }

  function draw() {
    // Grass with mowing stripes that scroll with the road.
    ctx.fillStyle = '#4c9a4a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#458f44';
    const so = scroll % 80;
    for (let y = -80 + so; y < H; y += 80) ctx.fillRect(0, y, W, 40);

    const o = shake.offset(10);
    ctx.save();
    ctx.translate(o.x, o.y);

    // Road.
    const rg = ctx.createLinearGradient(ROAD_X, 0, ROAD_X + LANES * LANE_W, 0);
    rg.addColorStop(0, '#3a3e46'); rg.addColorStop(0.5, '#444952'); rg.addColorStop(1, '#3a3e46');
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(ROAD_X - 12, 0, LANES * LANE_W + 24, H);
    ctx.fillStyle = rg;
    ctx.fillRect(ROAD_X - 8, 0, LANES * LANE_W + 16, H);
    // Red and white rumble strips.
    const ro = scroll % 40;
    for (let y = -40 + ro; y < H; y += 40) {
      ctx.fillStyle = '#e04848';
      ctx.fillRect(ROAD_X - 8, y, 6, 20);
      ctx.fillRect(ROAD_X + LANES * LANE_W + 2, y, 6, 20);
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(ROAD_X - 8, y + 20, 6, 20);
      ctx.fillRect(ROAD_X + LANES * LANE_W + 2, y + 20, 6, 20);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const off = scroll % 60;
    for (let l = 1; l < LANES; l++) {
      for (let y = -60 + off; y < H; y += 60) ctx.fillRect(ROAD_X + l * LANE_W - 2, y, 4, 30);
    }

    for (const p of pickups) drawPickup(p);

    // Draw back to front so nearer vehicles overlap farther ones.
    const vehicles = traffic.map(c => ({ y: c.y + c.len, f: () => drawVehicle(laneX(c.lane), c.y + c.len / 2, c, Math.PI) }));
    if (state !== 'ready') {
      vehicles.push({
        y: PLAYER_Y + CAR_H,
        f: () => {
          if (invuln > 0 && Math.floor(time * 16) % 2) ctx.globalAlpha = 0.5;
          const spin = wreck ? wreck.vr * Math.min(wreck.t, 0.5) : 0;
          drawVehicle(x, PLAYER_Y + CAR_H / 2, { color: '#ffc53d', len: CAR_H }, tilt + spin, true);
          ctx.globalAlpha = 1;
        },
      });
    }
    vehicles.sort((a, b) => a.y - b.y).forEach(v => v.f());

    for (const s of smashed) {
      ctx.globalAlpha = Math.max(0, 1 - s.t / 0.8);
      drawVehicle(s.x, s.cy, s, s.rot);
      ctx.globalAlpha = 1;
    }

    if (shield && state !== 'ready') {
      const r = 46 + Math.sin(time * 6) * 2;
      const cy = PLAYER_Y + CAR_H / 2 - 4;
      const g = ctx.createRadialGradient(x, cy, r * 0.6, x, cy, r);
      g.addColorStop(0, 'rgba(120,200,255,0)'); g.addColorStop(1, 'rgba(120,200,255,0.35)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,240,255,0.7)'; ctx.lineWidth = 2; ctx.stroke();
    }

    // Trees and bushes on the verges (drawn over the road edge shadow, under nothing else).
    for (const s of scenery) {
      const y = ((s.y + scroll) % (H + 140)) - 70;
      const sx = s.side ? W - 16 - s.dx : 16 + s.dx;
      (s.big ? tree : bush).draw(ctx, sx, y);
    }

    fx.draw(ctx);
    pops.draw(ctx);
    ctx.restore();

    // Speed lines once you're really moving.
    if (speed > 600 && state === 'playing') {
      ctx.fillStyle = `rgba(255,255,255,${(speed - 600) / 1600})`;
      for (let i = 0; i < 8; i++) ctx.fillRect((i * 67 + scroll * 0.3) % W, (i * 131 + scroll * 2) % H, 2, 50);
    }

    // Combo meter.
    if (state === 'playing' && combo > 1 && time < comboUntil) {
      const k = (comboUntil - time) / 2;
      Gfx.card(ctx, W / 2 - 60, 14, 120, 34, { r: 17 });
      Gfx.text(ctx, `Combo ×${combo}`, W / 2, 27, { size: 15, color: combo >= 5 ? '#ffe066' : '#fff', width: 3 });
      Gfx.bar(ctx, W / 2 - 44, 38, 88, 4, k, '#ffe066');
    }
    if (shield && state === 'playing') Gfx.text(ctx, '🛡 Shield ready', W - 12, H - 16, { size: 13, align: 'right', color: '#bfe8ff', width: 3 });
  }

  function animate(dt) {
    if (state !== 'playing' && state !== 'over') return;
    fx.update(dt);
    pops.update(dt);
    shake.update(dt);
    for (const s of smashed) {
      s.t += dt; s.x += s.vx * dt; s.cy += s.vy * dt; s.rot += s.vr * dt; s.vy += 300 * dt;
    }
    smashed = smashed.filter(s => s.t < 0.8);
    if (wreck) wreck.t += dt;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    if (state !== 'paused') animate(dt);
    if (state !== 'playing' && state !== 'paused') time += dt;
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => score(),
    intro: {
      title: 'Lane Rush',
      html: `<ul>
        <li>Change lanes to dodge the traffic. There's always a way through.</li>
        <li>Passing right next to a car is a <b>close call</b>. Chain them for a bigger bonus.</li>
        <li>Grab <b>coins</b> for 50 points. A blue <b>shield</b> soaks up one crash.</li>
        <li>Watch out for long trucks. You keep getting faster.</li>
      </ul>`,
      button: 'Start driving',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
