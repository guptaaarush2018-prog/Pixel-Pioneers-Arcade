/* Shadow Step: sneak from the start to the exit. Guards see what's in their cone of light (walls
   block it), and see you from much less far when you're standing in shadow. Being seen fills
   their meter; if it fills, you're caught. Sprinting is fast but noisy, and guards come to see
   what the noise was. Some exits are behind a locked door: find the key. Gems are a bonus.
   Eight levels; the score is the total of your best run on each. */
(() => {
  const ID = 'shadow-step';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const TILE = 32, OY = 28, COLS = 30, ROWS = 16;
  const SAVE = 'shadow:best';
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const R = Gfx.rand;
  const fx = Gfx.particles(300), floats = Gfx.floaters();
  const LEVELS = window.SHADOW_LEVELS;

  const SEE_LIGHT = 180, SEE_SHADOW = 64, CONE = 0.62;
  let best = Arcade.load(SAVE, {});
  let L = null, li = 0, map, player, guards, cams, gems, hasKey, needKey, state = 'menu', time = 0, levelT = 0, spotted = false, noiseT = 0, caughtBy = null, tipT = 0, noises = [];

  const total = () => Object.values(best).reduce((t, b) => t + b.pts, 0);
  const nextUp = () => { for (let i = 0; i < LEVELS.length; i++) if (!best[i]) return i; return LEVELS.length - 1; };
  const tileAt = (tx, ty) => (map[ty] && map[ty][tx]) || '#';
  const solidTile = c => c === '#' || (c === 'D');
  const solidAt = (x, y) => solidTile(tileAt(Math.floor(x / TILE), Math.floor((y - OY) / TILE)));
  const shadowAt = (x, y) => tileAt(Math.floor(x / TILE), Math.floor((y - OY) / TILE)) === 's';
  const center = ([tx, ty]) => ({ x: tx * TILE + TILE / 2, y: OY + ty * TILE + TILE / 2 });

  // ---------- Level ----------

  function load(n) {
    li = n;
    L = LEVELS[n];
    map = L.map.map(r => r.split(''));
    gems = [];
    hasKey = false;
    needKey = L.map.some(r => r.includes('D'));
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = map[y][x];
      if (c === 'P') { player = { x: x * TILE + TILE / 2, y: OY + y * TILE + TILE / 2, a: 0, step: 0 }; map[y][x] = '.'; }
      if (c === '$') { gems.push({ x: x * TILE + TILE / 2, y: OY + y * TILE + TILE / 2, got: false }); map[y][x] = '.'; }
    }
    guards = L.guards.map(g => {
      const p = center(g.route[0]);
      return { x: p.x, y: p.y, a: 0, route: g.route.map(center), i: 1 % g.route.length, wait: g.wait, waitT: 0, look: 0, sus: 0, mode: 'patrol', target: null, step: 0 };
    });
    cams = L.cams.map(c => ({ cam: true, ...center(c.at), from: c.from * Math.PI / 180, to: c.to * Math.PI / 180, speed: c.speed * Math.PI / 180, a: c.from * Math.PI / 180, dir: 1, sus: 0 }));
    levelT = 0; spotted = false; caughtBy = null; tipT = 5; noises = [];
    fx.clear();
    state = 'play';
    ui.hide();
    updateHud();
  }

  // ---------- Sight ----------

  // Distance a ray travels before hitting a wall (or max).
  function rayLen(x, y, a, max) {
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let d = 0; d < max; d += 5) if (solidAt(x + dx * d, y + dy * d)) return d;
    return max;
  }
  function canSee(o, coneHalf) {
    const dx = player.x - o.x, dy = player.y - o.y, d = Math.hypot(dx, dy);
    const range = shadowAt(player.x, player.y) ? SEE_SHADOW : SEE_LIGHT * (o.cam ? 1.2 : 1);
    if (d > range) return 0;
    if (Math.abs(angDiff(Math.atan2(dy, dx), o.a)) > coneHalf) return 0;
    if (rayLen(o.x, o.y, Math.atan2(dy, dx), d) < d - 6) return 0;
    return 1 - d / range * 0.6;
  }

  // ---------- Update ----------

  const keys = new Set();
  function update(dt) {
    time += dt; levelT += dt;
    tipT = Math.max(0, tipT - dt);
    // You.
    let mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let my = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const m = Math.hypot(mx, my);
    if (m) {
      const sp = (sprint ? 170 : 100) * dt;
      move(player, mx / m * sp, my / m * sp, 8);
      player.a = Math.atan2(my, mx);
      player.step += dt * (sprint ? 14 : 9);
      if (sprint) {
        noiseT -= dt;
        if (noiseT <= 0) { noiseT = 0.45; makeNoise(player.x, player.y, 150); }
      }
    }
    // Pick-ups and the exit.
    for (const g of gems) if (!g.got && Math.hypot(g.x - player.x, g.y - player.y) < 16) {
      g.got = true;
      floats.add('+150', g.x, g.y - 14, { color: '#7ef0ff', size: 14 });
      fx.burst(12, () => ({ x: g.x, y: g.y, vx: R(-80, 80), vy: R(-80, 80), life: 0.5, size: 2, color: '#7ef0ff', shape: 'spark', drag: 2 }));
      Arcade.tone({ freq: 880, to: 1320, dur: 0.12, type: 'triangle', vol: 0.04 });
    }
    const here = tileAt(Math.floor(player.x / TILE), Math.floor((player.y - OY) / TILE));
    if (here === 'k') {
      hasKey = true;
      map[Math.floor((player.y - OY) / TILE)][Math.floor(player.x / TILE)] = '.';
      for (const row of map) for (let x = 0; x < COLS; x++) if (row[x] === 'D') row[x] = 'd';
      floats.add('Key! The doors are open', player.x, player.y - 20, { color: '#ffd23f', size: 15 });
      Arcade.tone({ freq: 660, to: 990, dur: 0.2, type: 'triangle', vol: 0.05 });
    }
    if (here === 'E') return escape();
    // Guards.
    for (const g of guards) updateGuard(g, dt);
    for (const c of cams) {
      c.a += c.dir * c.speed * dt;
      if (c.a > c.to) { c.a = c.to; c.dir = -1; } else if (c.a < c.from) { c.a = c.from; c.dir = 1; }
      watch(c, 0.42, dt, 1.4);
    }
    for (const n of noises) n.t += dt;
    noises = noises.filter(n => n.t < 0.6);
    fx.update(dt); floats.update(dt);
    updateHud();
  }

  function move(o, dx, dy, r) {
    const blocked = (x, y) => solidAt(x - r, y - r) || solidAt(x + r, y - r) || solidAt(x - r, y + r) || solidAt(x + r, y + r);
    if (!blocked(o.x + dx, o.y)) o.x += dx;
    if (!blocked(o.x, o.y + dy)) o.y += dy;
  }

  function makeNoise(x, y, r) {
    noises.push({ x, y, r, t: 0 });
    for (const g of guards) {
      const d = Math.hypot(g.x - x, g.y - y);
      // Only noises they can walk straight to (guards don't find their way around walls).
      if (g.mode === 'patrol' && d < r && rayLen(g.x, g.y, Math.atan2(y - g.y, x - g.x), d) >= d - 4) investigate(g, x, y);
    }
  }

  // Seeing you fills the meter; looking away lets it drain.
  function watch(o, cone, dt, rate) {
    const s = canSee(o, cone);
    if (s > 0) {
      o.sus = Math.min(1, o.sus + s * rate * dt);
      if (o.sus > 0.35) spotted = true;
      if (o.sus >= 1) caught(o);
    } else o.sus = Math.max(0, o.sus - dt * 0.5);
    return s;
  }

  function investigate(g, x, y) {
    if (g.mode === 'patrol') g.back = { x: g.x, y: g.y };
    g.mode = 'investigate'; g.target = { x, y }; g.waitT = 0; g.note = 1;
  }

  function updateGuard(g, dt) {
    g.note = Math.max(0, (g.note || 0) - dt);
    const seen = watch(g, CONE, dt, 2.4);
    if (g.sus > 0.3) {
      // Suspicious: stop and stare (and creep toward you).
      g.a += angDiff(Math.atan2(player.y - g.y, player.x - g.x), g.a) * Math.min(1, dt * 5);
      if (seen) { const d = Math.hypot(player.x - g.x, player.y - g.y); if (d > 40) move(g, Math.cos(g.a) * 40 * dt, Math.sin(g.a) * 40 * dt, 9); }
      else if (g.mode === 'patrol') investigate(g, player.x, player.y);
      return;
    }
    let tx, ty, speed = 64;
    if (g.mode === 'investigate') { tx = g.target.x; ty = g.target.y; speed = 84; }
    else if (g.mode === 'return') { tx = g.back.x; ty = g.back.y; }
    else { tx = g.route[g.i].x; ty = g.route[g.i].y; }
    const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy);
    if (d > 3) {
      g.waitT = 0;
      const want = Math.atan2(dy, dx);
      g.a += angDiff(want, g.a) * Math.min(1, dt * 6);
      if (Math.abs(angDiff(want, g.a)) < 0.6) {
        const ox = g.x, oy = g.y;
        move(g, dx / d * Math.min(d, speed * dt), dy / d * Math.min(d, speed * dt), 9);
        g.step += dt * 8;
        if (g.mode === 'investigate' && Math.hypot(g.x - ox, g.y - oy) < 0.5) { g.mode = 'return'; }
      }
      return;
    }
    // Back where it left its route: carry on patrolling.
    if (g.mode === 'return') { g.mode = 'patrol'; g.back = null; return; }
    // At a stop: look around, then carry on.
    g.waitT += dt;
    g.look += dt;
    const hold = g.mode === 'investigate' ? 2.2 : g.wait;
    g.a += Math.sin(g.look * 2.4) * dt * 1.6;
    if (g.waitT >= hold) {
      if (g.mode === 'investigate') { g.mode = 'return'; return; }
      g.mode = 'patrol';
      g.i = (g.i + 1) % g.route.length;
    }
  }

  // ---------- Endings ----------

  function caught(by) {
    if (state !== 'play') return;
    state = 'caught';
    caughtBy = by;
    Arcade.tone({ freq: 880, to: 220, dur: 0.5, type: 'square', vol: 0.06 });
    Arcade.countPlay();
    setTimeout(() => ui.show({
      title: by.cam ? 'Spotted on camera!' : 'Caught!',
      html: `<p>${L.name}</p><p style="font-size:13px;color:var(--muted)">${L.tip}</p><div class="menu"><button class="btn secondary" type="button" data-menu>Levels</button></div>`,
      button: 'Try again',
      onAction: () => load(li),
      onRender: p => p.querySelector('[data-menu]').addEventListener('click', showMenu),
    }), 700);
  }

  function escape() {
    state = 'won';
    const got = gems.filter(g => g.got).length;
    const timeBonus = Math.max(0, Math.round(300 - levelT * 4));
    const ghost = !spotted;
    const pts = 500 + got * 150 + timeBonus + (ghost ? 300 : 0);
    const prev = best[li];
    if (!prev || pts > prev.pts) { best[li] = { pts, gems: Math.max(got, prev?.gems || 0), ghost: ghost || !!prev?.ghost }; Arcade.save(SAVE, best); }
    Arcade.flag('shadow-step-first');
    if (ghost) Arcade.flag('shadow-step-ghost');
    if (got === gems.length && gems.length) Arcade.flag('shadow-step-gems');
    if (Object.keys(best).length >= LEVELS.length) Arcade.flag('shadow-step-all');
    [523, 659, 784, 1047].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.05, delay: i * 0.07 }));
    Arcade.finish(ui, {
      score: total(),
      title: `${L.name}: escaped!${ghost ? ' 👻' : ''}`,
      lines: [`${got}/${gems.length} gems · ${levelT.toFixed(1)} s · ${ghost ? 'never spotted (+300)' : 'spotted, but got away'} · ${pts} points`, 'Your score is the total of your best run on every level.'],
      button: li + 1 < LEVELS.length ? 'Next level' : 'Level select',
      onAction: () => (li + 1 < LEVELS.length ? load(li + 1) : showMenu()),
    });
    const panel = overlayEl.querySelector('.panel');
    if (panel) {
      panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-retry>Replay this level</button><button class="btn secondary" type="button" data-menu>Levels</button></div>');
      panel.querySelector('[data-retry]').addEventListener('click', () => load(li));
      panel.querySelector('[data-menu]').addEventListener('click', showMenu);
    }
  }

  // ---------- Input ----------

  addEventListener('keydown', e => {
    keys.add(e.code);
    if (state !== 'play') return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyR') load(li);
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    ui.show({
      title: 'Paused', html: `<p>${L.name}</p><p style="font-size:13px;color:var(--muted)">${L.tip}</p><div class="menu"><button class="btn secondary" type="button" data-menu>Levels</button></div>`,
      button: 'Resume', onAction: () => { state = 'play'; ui.hide(); }, onRender: p => p.querySelector('[data-menu]').addEventListener('click', showMenu),
    });
  }
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function drawMap() {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = map[y][x], px = x * TILE, py = OY + y * TILE;
      if (c === '#') {
        ctx.fillStyle = '#3a4058'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#4a5170'; ctx.fillRect(px, py, TILE, TILE - 6);
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(px + 2, py + 2, TILE - 4, 3);
        continue;
      }
      ctx.fillStyle = (x + y) % 2 ? '#323a5a' : '#363f61';
      ctx.fillRect(px, py, TILE, TILE);
      if (c === 's') {
        ctx.fillStyle = 'rgba(2,3,10,0.78)'; ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = 'rgba(120,110,200,0.12)'; ctx.lineWidth = 1;
        ctx.beginPath(); for (let k = -TILE; k < TILE; k += 8) { ctx.moveTo(px + k, py + TILE); ctx.lineTo(px + k + TILE, py); } ctx.save(); ctx.clip(new Path2D(`M${px} ${py}h${TILE}v${TILE}h${-TILE}z`)); ctx.stroke(); ctx.restore();
      }
      if (c === 'D' || c === 'd') {
        ctx.fillStyle = c === 'D' ? '#8a5a2a' : 'rgba(138,90,42,0.3)';
        ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        if (c === 'D') { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, 4, 0, TAU); ctx.fill(); }
      }
      if (c === 'E') {
        const glow = 0.5 + Math.sin(time * 3) * 0.2;
        ctx.fillStyle = `rgba(60,207,142,${glow})`; ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
        Gfx.text(ctx, 'EXIT', px + TILE / 2, py + TILE / 2, { size: 9, stroke: null, color: '#0b2a1c' });
      }
      if (c === 'k') {
        const b = Math.sin(time * 4) * 2;
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(px + 12, py + 14 + b, 5, 0, TAU); ctx.moveTo(px + 17, py + 14 + b); ctx.lineTo(px + 26, py + 14 + b); ctx.lineTo(px + 26, py + 19 + b); ctx.stroke();
      }
    }
  }

  function cone(o, half, range, sus) {
    const n = 36, pts = [];
    for (let k = 0; k <= n; k++) {
      const a = o.a - half + (2 * half) * k / n;
      const d = rayLen(o.x, o.y, a, range);
      pts.push([o.x + Math.cos(a) * d, o.y + Math.sin(a) * d]);
    }
    const g = ctx.createRadialGradient(o.x, o.y, 6, o.x, o.y, range);
    const col = sus > 0.3 ? '255,90,80' : '255,230,150';
    g.addColorStop(0, `rgba(${col},0.32)`); g.addColorStop(1, `rgba(${col},0.04)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
  }

  function drawGuard(g) {
    Gfx.shadow(ctx, g.x + 2, g.y + 6, 10, 5, 0.4);
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a);
    const sw = Math.sin(g.step) * 3;
    ctx.fillStyle = '#1b1f2e'; ctx.fillRect(-4 + sw, -8, 6, 4); ctx.fillRect(-4 - sw, 4, 6, 4);
    ctx.fillStyle = '#3a5fb0'; Gfx.roundRect(ctx, -8, -9, 16, 18, 6); ctx.fill();
    ctx.fillStyle = '#e8c39e'; ctx.beginPath(); ctx.arc(2, 0, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1b2a4a'; ctx.beginPath(); ctx.arc(1, 0, 6.5, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; ctx.fillRect(8, 3, 7, 4);
    ctx.restore();
    if (g.sus > 0.05) {
      Gfx.bar(ctx, g.x - 14, g.y - 24, 28, 4, g.sus, g.sus > 0.6 ? '#ff4d4d' : '#ffd23f');
      Gfx.text(ctx, g.sus > 0.6 ? '!' : '?', g.x, g.y - 34, { size: 16, color: g.sus > 0.6 ? '#ff4d4d' : '#ffd23f', width: 3 });
    } else if (g.note > 0) Gfx.text(ctx, '?', g.x, g.y - 26, { size: 13, color: '#cfd8dc', width: 3 });
  }

  function drawPlayer() {
    const hidden = shadowAt(player.x, player.y);
    Gfx.shadow(ctx, player.x + 1, player.y + 6, 8, 4, 0.4);
    ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(player.a);
    ctx.globalAlpha = hidden ? 0.55 : 1;
    const sw = Math.sin(player.step) * 2.5;
    ctx.fillStyle = '#111'; ctx.fillRect(-3 + sw, -6, 5, 3); ctx.fillRect(-3 - sw, 3, 5, 3);
    ctx.fillStyle = '#6b3fa0'; Gfx.roundRect(ctx, -7, -8, 14, 16, 6); ctx.fill();
    ctx.fillStyle = '#4a2a78'; ctx.beginPath(); ctx.arc(1, 0, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(4, -3, 2, 2); ctx.fillRect(4, 1, 2, 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.fillStyle = '#0c0e16'; ctx.fillRect(0, 0, W, H);
    if (!L) return;
    drawMap();
    for (const n of noises) { ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - n.t / 0.6)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * n.t / 0.6, 0, TAU); ctx.stroke(); }
    ctx.globalCompositeOperation = 'lighter';
    for (const g of guards) cone(g, CONE, SEE_LIGHT, g.sus);
    for (const c of cams) cone(c, 0.42, SEE_LIGHT * 1.2, c.sus);
    ctx.globalCompositeOperation = 'source-over';
    for (const gm of gems) {
      if (gm.got) continue;
      const b = Math.sin(time * 3 + gm.x) * 2;
      ctx.fillStyle = '#7ef0ff';
      ctx.beginPath(); ctx.moveTo(gm.x, gm.y - 8 + b); ctx.lineTo(gm.x + 7, gm.y + b); ctx.lineTo(gm.x, gm.y + 8 + b); ctx.lineTo(gm.x - 7, gm.y + b); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(gm.x - 2, gm.y - 4 + b, 2, 4);
    }
    for (const c of cams) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
      ctx.fillStyle = '#8d94a1'; ctx.fillRect(-6, -5, 16, 10);
      ctx.fillStyle = c.sus > 0.3 ? '#ff4d4d' : '#3ccf8e'; ctx.beginPath(); ctx.arc(10, 0, 3, 0, TAU); ctx.fill();
      ctx.restore();
      if (c.sus > 0.05) Gfx.bar(ctx, c.x - 14, c.y - 18, 28, 4, c.sus, '#ff4d4d');
    }
    drawPlayer();
    for (const g of guards) drawGuard(g);
    fx.draw(ctx);
    floats.draw(ctx);
    if (state === 'caught' && caughtBy) { ctx.fillStyle = `rgba(255,40,40,${0.25 + Math.sin(time * 20) * 0.1})`; ctx.fillRect(0, 0, W, H); }
    // Top bar.
    ctx.fillStyle = 'rgba(8,10,18,0.9)'; ctx.fillRect(0, 0, W, OY);
    Gfx.text(ctx, `${li + 1}. ${L.name}`, 12, OY / 2, { size: 13, align: 'left', stroke: null });
    Gfx.text(ctx, `💎 ${gems.filter(g => g.got).length}/${gems.length}${needKey ? ` · ${hasKey ? '🔑 got the key' : '🔒 find the key'}` : ''} · ${levelT.toFixed(1)} s${spotted ? ' · spotted' : ' · unseen 👻'}`, W - 12, OY / 2, { size: 12, align: 'right', stroke: null, color: spotted ? '#ffb0a0' : '#cfe9ff' });
    if (tipT > 0) { ctx.globalAlpha = Math.min(1, tipT); Gfx.card(ctx, W / 2 - 300, H - 44, 600, 32); Gfx.text(ctx, L.tip, W / 2, H - 28, { size: 13, stroke: null }); ctx.globalAlpha = 1; }
  }

  function updateHud() {
    $('level').textContent = L ? li + 1 : '-';
    $('gems').textContent = L ? `${gems.filter(g => g.got).length}/${gems.length}` : '-';
    $('total').textContent = total().toLocaleString();
  }

  // ---------- Level select ----------

  function showMenu() {
    state = 'menu';
    if (!L) load(nextUp()), state = 'menu';
    ui.show({
      title: '🥷 Shadow Step',
      html: `<p>Sneak to the exit without getting caught. Guards see what's in their light; standing in <b>shadow</b> (the dark patches) makes you much harder to spot.</p>
        <ul style="text-align:left;font-size:14px"><li><b>WASD</b> or arrows to move. <b>Shift</b> to sprint (noisy: guards come to look).</li><li>A guard's meter fills while they can see you. Duck out of sight before it's full!</li><li>Gems are a bonus. Escaping without ever being spotted is worth +300. <b>R</b> restarts.</li></ul>
        <div class="row" style="flex-wrap:wrap;gap:6px;justify-content:center">${LEVELS.map((l, i) => { const b = best[i], open = i <= Object.keys(best).length; return `<button class="btn ${b ? 'secondary' : ''}" type="button" data-l="${i}" ${open ? '' : 'disabled'} style="min-width:64px">${open ? i + 1 : '🔒'}${b ? ` ${b.ghost ? '👻' : '✓'}` : ''}</button>`; }).join('')}</div>
        <p style="font-size:12px;color:var(--muted)">${total().toLocaleString()} points</p>`,
      button: `Play level ${nextUp() + 1}`,
      onAction: () => load(nextUp()),
      onRender: p => p.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => load(+b.dataset.l))),
    });
    updateHud();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'play' && overlayEl.hidden) update(dt);
    else { time += dt; fx.update(dt); floats.update(dt); }
    draw();
    requestAnimationFrame(frame);
  }

  load(nextUp());
  showMenu();
  requestAnimationFrame(frame);
})();
