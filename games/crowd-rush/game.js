(() => {
  const W = 480, H = 720;
  const ROAD_L = 50, ROAD_R = W - 50, ROAD_MID = W / 2;
  const PLAYER_Y = H - 170;
  const SPEED = 270;
  const GAP = 380;            // distance between obstacles
  const STEPS = 10;
  // Smart-pick streak: taking the better gate grows it; from the second in a row, each gate pays
  // STREAK_PCT% more runners per streak level (up to STREAK_MAX).
  const STREAK_PCT = 10, STREAK_MAX = 5;
  const COLORS = { you: '#1e88e5', rival: '#ef5350', idle: '#9aa5b4' };

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';         // 'playing' | 'stairs' | 'between' | 'paused' | 'over'
  let level, total, crowd, shown, x, targetX, dist, things, finishAt, stairs;
  let keys = { left: false, right: false };
  let streak, bestStreak, shield;
  const fx = Gfx.particles(600);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();

  const radius = n => Math.min(150, 8 + Math.sqrt(Math.max(0, n)) * 3.4);

  // ---------- Level generation ----------

  // Builds gates, rival crowds and saws while tracking the crowd size a good player would
  // have, so rivals are always beatable with the right choices.
  function makeLevel(n) {
    const list = [];
    let est = 10;
    const segments = 7 + Math.min(8, n);
    for (let i = 0; i < segments; i++) {
      const y = -(i + 1) * GAP;
      const kind = i > 0 && i % 3 === 2 ? 'enemy' : i > 1 && Math.random() < 0.18 + n * 0.02 ? 'saw' : 'gate';
      if (kind === 'gate') {
        const good = goodOp(est, n), bad = badOp(est, n);
        const left = Math.random() < 0.5;
        list.push({ kind, y, ops: left ? [good, bad] : [bad, good], used: false });
        est = Math.max(1, apply(good, est));
        // Pickups between gates: idle runners to recruit, or a shield before a rival crowd.
        const roll = Math.random(), side = Math.random() < 0.5 ? -1 : 1;
        const px = ROAD_MID + side * Arcade.rand(50, 110);
        if (i % 3 === 1 && roll < 0.55) list.push({ kind: 'shield', y: y - GAP / 2, px, used: false });
        else if (roll < 0.5) {
          const v = Math.round(Arcade.rand(4, 8 + n * 2 + est * 0.12));
          list.push({ kind: 'recruit', y: y - GAP / 2, px, v, used: false });
          est += Math.round(v / 2);
        }
      } else if (kind === 'enemy') {
        const size = Math.max(3, Math.round(est * Arcade.rand(0.35, 0.6 + n * 0.02)));
        list.push({ kind, y, size, left: size, fighting: false });
        est -= size;
      } else {
        list.push({ kind, y, sx: Arcade.rand(ROAD_L + 40, ROAD_R - 40), phase: Math.random() * 6, r: 26 });
        list.push({ kind: 'gate', y: y - GAP / 2, ops: [goodOp(est, n), goodOp(est, n)], used: false });
        est = apply(list[list.length - 1].ops[0], est);
      }
    }
    return { list, finish: -(segments + 1) * GAP, est };
  }

  function goodOp(est, n) {
    const r = Math.random();
    if (est < 40 && r < 0.5) return { op: '×', v: Arcade.pick([2, 2, 3]) };
    if (r < 0.25) return { op: '×', v: 2 };
    return { op: '+', v: Math.round(Arcade.rand(8, 18 + n * 6 + est * 0.3)) };
  }

  function badOp(est, n) {
    const r = Math.random();
    if (r < 0.3 && est > 12) return { op: '÷', v: 2 };
    if (r < 0.75) return { op: '−', v: Math.round(Arcade.rand(5, 10 + n * 4 + est * 0.25)) };
    return { op: '+', v: Arcade.randInt(2, 6) };      // a "trap": good, but not the best
  }

  function apply(g, n) {
    if (g.op === '+') return n + g.v;
    if (g.op === '−') return n - g.v;
    if (g.op === '×') return n * g.v;
    return Math.floor(n / g.v);
  }

  // ---------- Flow ----------

  function startLevel() {
    const lv = makeLevel(level);
    things = lv.list;
    finishAt = lv.finish;
    dist = 0;
    crowd = shown = 10;
    x = targetX = ROAD_MID;
    stairs = null;
    streak = 0;
    shield = false;
    fx.clear();
    state = 'playing';
    ui.hide();
  }

  function newRun() {
    level = 1;
    bestStreak = 0;
    total = 0;
    crowd = 10;
    startLevel();
  }

  function lose() {
    state = 'over';
    Arcade.tone({ freq: 300, to: 80, dur: 0.6, type: 'sawtooth', vol: 0.05 });
    Arcade.finish(ui, {
      score: total,
      title: 'Your crowd is gone!',
      lines: [`Reached level ${level}`],
      onAction: newRun,
    });
  }

  function levelDone(mult) {
    const gained = Math.round(stairs.start * mult);
    total += gained;
    if (mult >= 3) Arcade.flag('crowd-rush-top');
    state = 'between';
    Arcade.tone({ freq: 523, to: 1046, dur: 0.35, type: 'triangle', vol: 0.06 });
    ui.show({
      title: `Level ${level} cleared!`,
      html: `<p class="big">+${gained.toLocaleString()}</p><p>${stairs.start} runners × ${mult.toFixed(1)} on the stairs</p><p>Total ${total.toLocaleString()}</p>`,
      button: 'Next level',
      delay: 400,
      onAction: () => {
        level++;
        startLevel();
      },
    });
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: () => { state = 'playing'; ui.hide(); } });
  }
  Arcade.onBlur(pause);

  // ---------- Update ----------

  function popText(text, color, dy = 0) {
    pops.add(text, x, PLAYER_Y - 80 - dy, { color, size: 28, life: 1, rise: 60 });
  }

  function burst(px, py, colors, n, speed = 220) {
    fx.burst(n, () => ({
      x: px + Gfx.rand(-10, 10), y: py, vx: Gfx.rand(-speed, speed), vy: Gfx.rand(-speed * 1.2, speed * 0.3), drag: 2.5,
      life: Gfx.rand(0.35, 0.7), size: Gfx.rand(2.5, 4.5), color: colors[Math.floor(Gfx.rand(0, colors.length))], shape: Gfx.rand() < 0.5 ? 'square' : 'circle',
    }));
  }

  function update(dt) {
    if (keys.left) targetX -= 420 * dt;
    if (keys.right) targetX += 420 * dt;
    const r = radius(crowd);
    targetX = Math.max(ROAD_L + r * 0.6, Math.min(ROAD_R - r * 0.6, targetX));
    x += (targetX - x) * Math.min(1, dt * 12);

    const fighting = things.find(t => t.kind === 'enemy' && t.fighting && t.left > 0);
    if (!fighting) dist += SPEED * dt;

    for (const t of things) {
      const sy = PLAYER_Y + t.y + dist;    // screen y
      if (t.kind === 'gate' && !t.used && sy >= PLAYER_Y) {
        t.used = true;
        const pick = x < ROAD_MID ? 0 : 1;
        const g = t.ops[pick];
        const before = crowd;
        crowd = Math.max(0, apply(g, crowd));
        // The better pick of the two keeps the streak going; from 2 in a row it pays a bonus.
        const smart = crowd >= apply(t.ops[1 - pick], before);
        streak = smart ? streak + 1 : 0;
        bestStreak = Math.max(bestStreak, streak);
        let bonus = 0;
        if (smart && streak >= 2 && crowd > before) bonus = Math.max(1, Math.round((crowd - before) * STREAK_PCT * Math.min(STREAK_MAX, streak - 1) / 100));
        crowd += bonus;
        if (streak >= 6) Arcade.flag('crowd-rush-streak');
        const gx = pick ? ROAD_MID + (ROAD_R - ROAD_MID) / 2 : ROAD_L + (ROAD_MID - ROAD_L) / 2;
        burst(gx, PLAYER_Y - 20, crowd >= before ? ['#64b5f6', '#bbdefb', '#fff'] : ['#ef5350', '#ffcdd2'], 16);
        popText(`${g.op}${g.v}`, crowd >= before ? '#9be37a' : '#ff7a7a');
        if (bonus) popText(`Streak ×${streak} +${bonus}`, '#ffd54f', 34);
        if (crowd < before) shake.add(0.25);
        Arcade.tone(crowd >= before ? { freq: 600 + Math.min(streak, 6) * 60, to: 900 + Math.min(streak, 6) * 80, dur: 0.12, type: 'triangle', vol: 0.05 } : { freq: 300, to: 200, dur: 0.12, vol: 0.04 });
      } else if ((t.kind === 'recruit' || t.kind === 'shield') && !t.used && Math.abs(sy - PLAYER_Y) < 26 && Math.abs(t.px - x) < 34 + r * 0.6) {
        t.used = true;
        if (t.kind === 'recruit') {
          crowd += t.v;
          popText(`+${t.v} joined!`, '#e0e0e0');
          burst(t.px, sy, ['#cfd8dc', '#64b5f6'], 14, 160);
          Arcade.tone({ freq: 700, to: 1050, dur: 0.1, type: 'triangle', vol: 0.04 });
        } else {
          shield = true;
          popText('Shield up!', '#80deea');
          burst(t.px, sy, ['#80deea', '#e0f7fa'], 18, 180);
          Arcade.tone({ freq: 500, to: 1200, dur: 0.25, type: 'sine', vol: 0.05 });
        }
      } else if (t.kind === 'enemy' && t.left > 0 && (t.fighting || sy >= PLAYER_Y - r - 20)) {
        // Both crowds lose runners one for one until a side runs out. A shield halves your losses
        // for one fight. (Cosmetic rolls use Gfx.rand so duels stay in sync.)
        if (!t.fighting) {
          t.shielded = shield;
          shield = false;
          shake.add(0.2);
        }
        t.fighting = true;
        const k = Math.min(t.left, Math.max(1, Math.ceil(60 * dt + t.size * dt * 1.5)));
        const mine = Math.min(crowd, t.shielded ? Math.ceil(k / 2) : k);
        const theirs = t.shielded ? Math.min(t.left, mine * 2) : Math.min(k, mine);
        t.left -= theirs;
        crowd -= mine;
        if (Gfx.rand() < 0.5) burst(x, PLAYER_Y - r * 0.5, [COLORS.you, COLORS.rival], 2, 140);
        if (Gfx.rand() < 0.4) Arcade.tone({ freq: Gfx.rand(150, 260), dur: 0.03, type: 'square', vol: 0.02 });
        if (t.left <= 0 && crowd > 0) {
          popText('Crowd beaten!', '#9be37a');
          burst(x, PLAYER_Y - 40, ['#9be37a', '#fff', '#ffd54f'], 22);
        }
      } else if (t.kind === 'saw') {
        const sx = t.sx + Math.sin(t.phase + dist / 90) * 80;
        t.cx = sx;
        if (Math.abs(sy - PLAYER_Y) < t.r + r * 0.6 && Math.abs(sx - x) < t.r + r * 0.7) {
          t.hurt = (t.hurt || 0) + dt * 40;
          while (t.hurt >= 1) { t.hurt--; crowd = Math.max(0, crowd - 1); }
          shake.add(dt * 2);
          if (Gfx.rand() < 0.5) burst(sx, sy, ['#ef5350', '#cfd8dc'], 2, 200);
        }
      }
    }
    shown += (crowd - shown) * Math.min(1, dt * 10);
    if (crowd <= 0) { lose(); return; }

    if (PLAYER_Y + finishAt + dist >= PLAYER_Y) {
      state = 'stairs';
      stairs = { start: crowd, step: 0, t: 0, cost: Math.max(2, Math.round(crowd / (STEPS * 0.6))) };
    }
  }

  // The crowd climbs the stairs, leaving runners behind on each step. Higher steps multiply more.
  function updateStairs(dt) {
    stairs.t += dt;
    if (stairs.t < 0.18) return;
    stairs.t = 0;
    if (crowd >= stairs.cost && stairs.step < STEPS) {
      crowd -= stairs.cost;
      stairs.step++;
      burst(ROAD_MID, PLAYER_Y - stairs.step * 40, [`hsl(${200 - stairs.step * 18}, 80%, 65%)`, '#fff'], 10);
      Arcade.tone({ freq: 400 + stairs.step * 60, dur: 0.06, type: 'triangle', vol: 0.04 });
    } else {
      levelDone(1 + stairs.step * 0.2);
    }
    shown = crowd;
  }

  // ---------- Input ----------

  let dragFrom = null;
  canvas.addEventListener('pointerdown', e => {
    dragFrom = { px: e.clientX, x: targetX };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragFrom) return;
    const r = canvas.getBoundingClientRect();
    targetX = dragFrom.x + ((e.clientX - dragFrom.px) / r.width) * W * 1.2;
  });
  canvas.addEventListener('pointerup', () => { dragFrom = null; });
  window.addEventListener('keydown', e => {
    const d = Arcade.DIRS[e.code];
    if (d === 'left') keys.left = true;
    if (d === 'right') keys.right = true;
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  window.addEventListener('keyup', e => {
    const d = Arcade.DIRS[e.code];
    if (d === 'left') keys.left = false;
    if (d === 'right') keys.right = false;
  });

  // ---------- Drawing ----------

  // Runners sit in a sunflower spiral so any count packs into a tidy blob.
  // Each runner is a body with a lit head, drawn back to front so near ones overlap far ones.
  function drawCrowd(cx, cy, n, color, rad) {
    const shownN = Math.min(220, Math.round(n));
    if (shownN <= 0) return;
    Gfx.shadow(ctx, cx, cy + rad * 0.35 + 6, rad + 10, rad * 0.35 + 6, 0.25);
    const spread = rad / Math.sqrt(Math.max(1, shownN));
    const body = Gfx.shade(color, -0.25), head = Gfx.shade(color, 0.35);
    const now = performance.now();
    const pts = [];
    for (let i = 0; i < shownN; i++) {
      const a = i * 2.39996, d = Math.sqrt(i) * spread;
      pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.6 + Math.sin(now / 90 + i) * 1.2]);
    }
    pts.sort((p, q) => p[1] - q[1]);
    ctx.fillStyle = body;
    ctx.beginPath();
    for (const [px, py] of pts) { ctx.moveTo(px + 4.5, py); ctx.arc(px, py, 4.5, 0, Math.PI * 2); }
    ctx.fill();
    ctx.fillStyle = head;
    ctx.beginPath();
    for (const [px, py] of pts) { ctx.moveTo(px + 2.6, py - 4); ctx.arc(px, py - 4, 2.6, 0, Math.PI * 2); }
    ctx.fill();
  }

  function draw() {
    const sh = shake.offset(8);
    ctx.save();
    ctx.translate(sh.x, sh.y);
    ctx.fillStyle = '#7fc8a9';
    ctx.fillRect(-10, -10, W + 20, H + 20);
    const off = (dist || 0) % 60;
    // Grass tufts scroll with the road.
    ctx.fillStyle = '#6cb894';
    for (let y = -60 + off; y < H; y += 60) {
      ctx.fillRect(12, y + 10, 18, 6);
      ctx.fillRect(W - 34, y + 40, 18, 6);
    }
    ctx.fillStyle = '#b7bfcc';
    ctx.fillRect(ROAD_L - 8, -10, 8, H + 20);
    ctx.fillRect(ROAD_R, -10, 8, H + 20);
    const rg = ctx.createLinearGradient(ROAD_L, 0, ROAD_R, 0);
    rg.addColorStop(0, '#cfd5de');
    rg.addColorStop(0.5, '#e3e7ee');
    rg.addColorStop(1, '#cfd5de');
    ctx.fillStyle = rg;
    ctx.fillRect(ROAD_L, -10, ROAD_R - ROAD_L, H + 20);
    ctx.fillStyle = '#c3cad6';
    for (let y = -60 + off; y < H; y += 60) ctx.fillRect(ROAD_MID - 3, y, 6, 30);

    if (!things) { ctx.restore(); return; }
    for (const t of things) {
      const sy = PLAYER_Y + t.y + dist;
      if (sy < -120 || sy > H + 120) continue;
      if (t.kind === 'gate' && !t.used) {
        t.ops.forEach((g, i) => {
          const good = g.op === '+' || g.op === '×';
          const gx = i ? ROAD_MID : ROAD_L;
          const gw = ROAD_MID - ROAD_L - 8;
          const col = good ? '#42a5f5' : '#ef5350';
          const gg = ctx.createLinearGradient(0, sy - 34, 0, sy + 20);
          gg.addColorStop(0, Gfx.alpha(col, 0.75));
          gg.addColorStop(1, Gfx.alpha(col, 0.35));
          ctx.fillStyle = gg;
          ctx.fillRect(gx + 4, sy - 34, gw, 54);
          ctx.fillStyle = Gfx.shade(col, -0.3);
          ctx.fillRect(gx + 4, sy - 40, 6, 62);
          ctx.fillRect(gx + gw - 2, sy - 40, 6, 62);
          ctx.fillRect(gx + 4, sy - 40, gw + 2, 6);
          Gfx.text(ctx, `${g.op}${g.v}`, gx + (ROAD_MID - ROAD_L) / 2, sy - 6, { size: 30, color: '#fff', width: 5, stroke: Gfx.alpha(Gfx.shade(col, -0.5), 0.8) });
        });
      } else if (t.kind === 'enemy' && t.left > 0) {
        drawCrowd(ROAD_MID, sy, t.left, COLORS.rival, radius(t.left));
        Gfx.text(ctx, String(t.left), ROAD_MID, sy - radius(t.left) * 0.6 - 18, { size: 22, color: '#fff', stroke: '#b71c1c', width: 5 });
      } else if (t.kind === 'recruit' && !t.used) {
        drawCrowd(t.px, sy, t.v, COLORS.idle, radius(t.v));
        Gfx.text(ctx, `+${t.v}`, t.px, sy - radius(t.v) * 0.6 - 16, { size: 18, color: '#fff', stroke: '#546e7a', width: 4 });
      } else if (t.kind === 'shield' && !t.used) {
        const bob = Math.sin(performance.now() / 200) * 4;
        Gfx.shadow(ctx, t.px, sy + 14, 18, 6, 0.3);
        ctx.save();
        ctx.shadowColor = '#80deea';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#26c6da';
        ctx.beginPath();
        ctx.moveTo(t.px, sy - 22 + bob); ctx.lineTo(t.px + 16, sy - 14 + bob); ctx.lineTo(t.px + 13, sy + 4 + bob); ctx.lineTo(t.px, sy + 12 + bob); ctx.lineTo(t.px - 13, sy + 4 + bob); ctx.lineTo(t.px - 16, sy - 14 + bob);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#e0f7fa';
        ctx.fillRect(t.px - 2, sy - 14 + bob, 4, 16);
        ctx.fillRect(t.px - 7, sy - 8 + bob, 14, 4);
      } else if (t.kind === 'saw') {
        const sx = t.cx ?? t.sx;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(performance.now() / 80);
        ctx.fillStyle = '#90a4ae';
        ctx.beginPath();
        for (let k = 0; k < 16; k++) {
          const rr = k % 2 ? t.r : t.r * 0.7, a = (k / 16) * Math.PI * 2;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#546e7a';
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    // Finish stairs.
    const fy = PLAYER_Y + finishAt + dist;
    if (fy > -STEPS * 40) {
      for (let s = 0; s < STEPS; s++) {
        const y = fy - 20 - s * 40;
        ctx.fillStyle = `hsl(${200 - s * 18}, 70%, ${55 + (s % 2) * 6}%)`;
        ctx.fillRect(ROAD_L, y - 40, ROAD_R - ROAD_L, 40);
        ctx.fillStyle = '#fff';
        ctx.font = '800 18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`×${(1 + (s + 1) * 0.2).toFixed(1)}`, ROAD_MID, y - 14);
      }
    }

    const climb = stairs ? stairs.step * 40 : 0;
    const r = radius(shown);
    if (shield) {
      ctx.save();
      ctx.strokeStyle = 'rgba(128,222,234,0.8)';
      ctx.fillStyle = 'rgba(128,222,234,0.15)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, PLAYER_Y - climb, r + 16, r * 0.6 + 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    drawCrowd(x, PLAYER_Y - climb, shown, COLORS.you, r);
    Gfx.text(ctx, String(Math.max(0, Math.round(shown))), x, PLAYER_Y - climb + r * 0.6 + 28, { size: 24, color: '#fff', stroke: '#0d47a1', width: 5 });

    fx.draw(ctx);
    pops.draw(ctx);

    // Progress bar.
    const prog = Math.min(1, dist / -finishAt);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(ROAD_L, 14, ROAD_R - ROAD_L, 8);
    ctx.fillStyle = '#1e88e5';
    ctx.fillRect(ROAD_L, 14, (ROAD_R - ROAD_L) * prog, 8);
    if (streak >= 2 && state === 'playing') {
      Gfx.card(ctx, W / 2 - 70, 30, 140, 30, { r: 15 });
      Gfx.text(ctx, `Smart streak ×${streak}`, W / 2, 45, { size: 14, color: streak >= 4 ? '#ffd54f' : '#fff', width: 3 });
    }
    ctx.restore();
  }

  function updateHud() {
    $('level').textContent = level || 1;
    $('crowd').textContent = Math.max(0, Math.round(crowd || 0));
    $('score').textContent = (total || 0).toLocaleString();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    else if (state === 'stairs') updateStairs(dt);
    if (state !== 'paused') {
      fx.update(dt);
      pops.update(dt);
      shake.update(dt);
    }
    draw();
    updateHud();
    requestAnimationFrame(frame);
  }

  Versus.attach({
    ui,
    start: newRun,
    score: () => total,
    intro: {
      title: 'Crowd Rush',
      html: `<ul>
        <li>Steer your crowd through the <b>blue gates</b> to grow it. Red ones shrink it.</li>
        <li>Red crowds fight you one for one. Be bigger when you meet them.</li>
        <li>Take the <b>better gate</b> twice in a row to start a <b>smart streak</b>: each gate after that adds bonus runners.</li>
        <li>Run into <b>grey runners</b> to recruit them, and grab a <b>shield</b> to halve your losses in the next fight.</li>
        <li>Dodge the saws. At the end, climb the stairs: the higher you get, the bigger the multiplier.</li>
      </ul>`,
      button: 'Run!',
      onAction: newRun,
    },
  });
  requestAnimationFrame(frame);
})();
