(() => {
  const W = 480, H = 720;
  const ROAD_L = 50, ROAD_R = W - 50, ROAD_MID = W / 2;
  const PLAYER_Y = H - 170;
  const SPEED = 270;
  const GAP = 380;            // distance between obstacles
  const STEPS = 10;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';         // 'playing' | 'stairs' | 'between' | 'paused' | 'over'
  let level, total, crowd, shown, x, targetX, dist, things, finishAt, stairs;
  let keys = { left: false, right: false };
  let pops = [];

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
    state = 'playing';
    ui.hide();
  }

  function newRun() {
    level = 1;
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

  function popText(text, color) {
    pops.push({ text, color, t: 0, x });
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
        const g = t.ops[x < ROAD_MID ? 0 : 1];
        const before = crowd;
        crowd = Math.max(0, apply(g, crowd));
        popText(`${g.op}${g.v}`, crowd >= before ? '#9be37a' : '#ff7a7a');
        Arcade.tone(crowd >= before ? { freq: 600, to: 900, dur: 0.12, type: 'triangle', vol: 0.05 } : { freq: 300, to: 200, dur: 0.12, vol: 0.04 });
      } else if (t.kind === 'enemy' && t.left > 0 && (t.fighting || sy >= PLAYER_Y - r - 20)) {
        // Both crowds lose runners one for one until a side runs out.
        t.fighting = true;
        const k = Math.min(t.left, crowd, Math.max(1, Math.ceil(60 * dt + t.size * dt * 1.5)));
        t.left -= k;
        crowd -= k;
        if (Math.random() < 0.4) Arcade.tone({ freq: Arcade.rand(150, 260), dur: 0.03, type: 'square', vol: 0.02 });
      } else if (t.kind === 'saw') {
        const sx = t.sx + Math.sin(t.phase + dist / 90) * 80;
        t.cx = sx;
        if (Math.abs(sy - PLAYER_Y) < t.r + r * 0.6 && Math.abs(sx - x) < t.r + r * 0.7) {
          t.hurt = (t.hurt || 0) + dt * 40;
          while (t.hurt >= 1) { t.hurt--; crowd = Math.max(0, crowd - 1); }
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
  function drawCrowd(cx, cy, n, color, rad) {
    const shownN = Math.min(220, Math.round(n));
    ctx.fillStyle = color;
    const spread = rad / Math.sqrt(Math.max(1, shownN));
    for (let i = 0; i < shownN; i++) {
      const a = i * 2.39996, d = Math.sqrt(i) * spread;
      const bob = Math.sin(performance.now() / 90 + i) * 1.2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.6 + bob, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw() {
    ctx.fillStyle = '#7fc8a9';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d9dee6';
    ctx.fillRect(ROAD_L, 0, ROAD_R - ROAD_L, H);
    ctx.fillStyle = '#c3cad6';
    const off = (dist || 0) % 60;
    for (let y = -60 + off; y < H; y += 60) ctx.fillRect(ROAD_MID - 3, y, 6, 30);

    if (!things) return;
    for (const t of things) {
      const sy = PLAYER_Y + t.y + dist;
      if (sy < -120 || sy > H + 120) continue;
      if (t.kind === 'gate' && !t.used) {
        t.ops.forEach((g, i) => {
          const good = g.op === '+' || g.op === '×';
          const gx = i ? ROAD_MID : ROAD_L;
          ctx.fillStyle = good ? 'rgba(66,165,245,0.55)' : 'rgba(239,83,80,0.55)';
          ctx.fillRect(gx + 4, sy - 34, ROAD_MID - ROAD_L - 8, 54);
          ctx.fillStyle = '#fff';
          ctx.font = '800 30px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${g.op}${g.v}`, gx + (ROAD_MID - ROAD_L) / 2, sy + 4);
        });
      } else if (t.kind === 'enemy' && t.left > 0) {
        drawCrowd(ROAD_MID, sy, t.left, '#ef5350', radius(t.left));
        ctx.fillStyle = '#b71c1c';
        ctx.font = '800 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(t.left, ROAD_MID, sy - radius(t.left) * 0.6 - 14);
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
    drawCrowd(x, PLAYER_Y - climb, shown, '#1e88e5', r);
    ctx.fillStyle = '#0d47a1';
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.max(0, Math.round(shown)), x, PLAYER_Y - climb + r * 0.6 + 30);

    for (const p of pops) {
      p.t += 1 / 60;
      ctx.globalAlpha = Math.max(0, 1 - p.t);
      ctx.fillStyle = p.color;
      ctx.font = '800 28px system-ui, sans-serif';
      ctx.fillText(p.text, p.x, PLAYER_Y - 80 - p.t * 60);
    }
    ctx.globalAlpha = 1;
    pops = pops.filter(p => p.t < 1);

    // Progress bar.
    const prog = Math.min(1, dist / -finishAt);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(ROAD_L, 14, ROAD_R - ROAD_L, 8);
    ctx.fillStyle = '#1e88e5';
    ctx.fillRect(ROAD_L, 14, (ROAD_R - ROAD_L) * prog, 8);
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
    draw();
    updateHud();
    requestAnimationFrame(frame);
  }

  ui.show({
    title: 'Crowd Rush',
    html: `<ul>
      <li>Steer your crowd through the <b>blue gates</b> to grow it. Red ones shrink it.</li>
      <li>Red crowds fight you one for one. Be bigger when you meet them.</li>
      <li>Dodge the saws. At the end, climb the stairs: the higher you get, the bigger the multiplier.</li>
    </ul>`,
    button: 'Run!',
    onAction: newRun,
  });
  requestAnimationFrame(frame);
})();
