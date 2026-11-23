/* Turf Trail: claim the map. Step off your land and you leave a trail; get back home and
   everything your trail loops around becomes yours (even other players' land). Cross anyone's
   trail to knock them out, but if someone crosses yours while you're out, you're done. Five
   bots compete with you. Score: the most land you held, plus knockouts. */
(() => {
  const ID = 'turf-trail';
  const W = 960, H = 540, CELL = 8, GW = 120, GH = 64, TOP = 28;
  const SPEED = 9.5;          // cells per second
  const BOTS = 5;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const R = Gfx.rand;
  const fx = Gfx.particles(500), floats = Gfx.floaters(), shake = Gfx.shaker();
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  // owner[i]: 0 empty, else player id. trail[i]: 0, else the id of the player whose trail it is.
  const owner = new Uint8Array(GW * GH), trail = new Uint8Array(GW * GH);
  const idx = (x, y) => y * GW + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH;

  const COLORS = ['#4fc3ff', '#ff5a5f', '#7ed957', '#ffb02e', '#b07cff', '#ff7ae0', '#2ee6c9'];
  const NAMES = ['Zig', 'Blot', 'Scoot', 'Patch', 'Doodle', 'Inky', 'Swoop', 'Gizmo', 'Tango', 'Pixel'];
  let players = [], me = null, state = 'menu', time = 0, peak = 0, kos = 0, names = [];

  function makePlayer(id, name, color, bot) {
    return { id, name, color, light: Gfx.mix(color, '#ffffff', 0.45), dark: Gfx.shade(color, -0.3), bot, x: 0, y: 0, dir: 0, want: 0, t: 0, alive: false, respawnT: 0, cells: 0, out: false, path: [], ai: bot ? { plan: [], wait: 0, bold: 0.4 + R(0, 0.5) } : null, kos: 0 };
  }

  // A 5x5 home patch somewhere with room around it.
  function spawn(p) {
    for (let k = 0; k < 200; k++) {
      const x = 4 + Math.floor(Math.random() * (GW - 8)), y = 4 + Math.floor(Math.random() * (GH - 8));
      let ok = true;
      for (let dy = -4; dy <= 4 && ok; dy++) for (let dx = -4; dx <= 4; dx++) if (owner[idx(x + dx, y + dy)] || trail[idx(x + dx, y + dy)]) { ok = false; break; }
      if (!ok && k < 190) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setOwner(x + dx, y + dy, p.id);
      p.x = x; p.y = y; p.dir = p.want = Math.floor(Math.random() * 4); p.t = 0; p.alive = true; p.out = false; p.path = [];
      if (p.ai) p.ai.plan = [];
      count();
      return;
    }
  }

  function setOwner(x, y, id) {
    const i = idx(x, y);
    owner[i] = id;
    paint(x, y);
  }

  // ---------- Moving ----------

  function stepPlayer(p) {
    if (p.ai) think(p);
    // No turning straight back on yourself.
    if ((p.want + 2) % 4 !== p.dir) p.dir = p.want;
    const nx = p.x + DIRS[p.dir][0], ny = p.y + DIRS[p.dir][1];
    if (!inside(nx, ny)) {
      // The edge of the map: bots turn, you stop and wait for a turn.
      if (p.ai) { p.want = (p.dir + (Math.random() < 0.5 ? 1 : 3)) % 4; }
      return;
    }
    const i = idx(nx, ny);
    // Crossing a trail knocks out its owner (your own counts!).
    const tr = trail[i];
    if (tr) {
      const victim = players.find(q => q.id === tr);
      if (victim && victim.alive) knockOut(victim, p);
      if (!p.alive) return;
    }
    // Head-on: the one with more land survives.
    for (const q of players) {
      if (q === p || !q.alive || q.x !== nx || q.y !== ny) continue;
      if (q.cells >= p.cells) { knockOut(p, q); return; }
      knockOut(q, p);
    }
    const leaving = owner[idx(p.x, p.y)] === p.id;
    p.x = nx; p.y = ny;
    if (owner[i] === p.id) {
      if (p.out) capture(p);
    } else {
      if (!p.out && leaving) p.out = true;
      p.out = true;
      trail[i] = p.id;
      p.path.push(i);
      paint(nx, ny);
    }
  }

  // Back home: the trail becomes land, and so does everything it fenced in.
  function capture(p) {
    for (const i of p.path) { trail[i] = 0; owner[i] = p.id; }
    // Flood from the border through everything that isn't ours; what it can't reach is enclosed.
    const seen = new Uint8Array(GW * GH), stack = [];
    for (let x = 0; x < GW; x++) for (const y of [0, GH - 1]) if (owner[idx(x, y)] !== p.id) { seen[idx(x, y)] = 1; stack.push(idx(x, y)); }
    for (let y = 0; y < GH; y++) for (const x of [0, GW - 1]) if (owner[idx(x, y)] !== p.id && !seen[idx(x, y)]) { seen[idx(x, y)] = 1; stack.push(idx(x, y)); }
    while (stack.length) {
      const i = stack.pop(), x = i % GW, y = (i / GW) | 0;
      for (const [dx, dy] of DIRS) {
        const X = x + dx, Y = y + dy;
        if (!inside(X, Y)) continue;
        const j = idx(X, Y);
        if (seen[j] || owner[j] === p.id) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    let gained = p.path.length;
    const stolen = new Set();
    for (let i = 0; i < GW * GH; i++) {
      if (seen[i] || owner[i] === p.id) continue;
      if (owner[i]) stolen.add(owner[i]);
      owner[i] = p.id;
      // Anyone caught inside with their trail loses it (and they're cut off).
      if (trail[i] && trail[i] !== p.id) { const v = players.find(q => q.id === trail[i]); if (v?.alive) knockOut(v, p); }
      gained++;
    }
    p.path = [];
    p.out = false;
    repaintAll();
    count();
    if (p === me && gained > 0) {
      const pct = (gained / (GW * GH) * 100);
      floats.add(`+${pct.toFixed(1)}%`, p.x * CELL, TOP + p.y * CELL - 10, { color: '#fff', size: 14 + Math.min(14, gained / 40) });
      Arcade.tone({ freq: 500, to: 900 + Math.min(600, gained), dur: 0.15, type: 'triangle', vol: 0.05 });
      if (gained > 400) shake.add(0.2);
    }
    // Anyone whose land is now gone is out too.
    for (const q of players) if (q.alive && q !== p && q.cells === 0) knockOut(q, p);
  }

  function knockOut(victim, by) {
    if (!victim.alive) return;
    victim.alive = false;
    for (const i of victim.path) trail[i] = 0;
    victim.path = [];
    for (let i = 0; i < GW * GH; i++) if (owner[i] === victim.id) owner[i] = 0;
    repaintAll();
    const x = victim.x * CELL + CELL / 2, y = TOP + victim.y * CELL + CELL / 2;
    fx.burst(24, () => { const a = R(0, 6.28), v = R(40, 180); return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.4, 0.9), size: R(2, 5), color: victim.color, drag: 2, shape: 'square' }; });
    count();
    if (victim === me) {
      shake.add(0.6);
      Arcade.tone({ freq: 300, to: 60, dur: 0.6, type: 'sawtooth', vol: 0.06 });
      setTimeout(gameOver, 900);
      return;
    }
    victim.respawnT = 3;
    if (by === me) {
      kos++;
      floats.add(`Knocked out ${victim.name}! +250`, x, y - 14, { color: '#ffd23f', size: 16 });
      Arcade.tone({ freq: 660, to: 1320, dur: 0.18, type: 'triangle', vol: 0.06 });
      if (kos >= 5) Arcade.flag('turf-trail-five');
    }
  }

  function count() {
    for (const p of players) p.cells = 0;
    for (let i = 0; i < GW * GH; i++) if (owner[i]) { const p = players[owner[i] - 1]; if (p) p.cells++; }
    if (me?.alive) {
      const pct = me.cells / (GW * GH) * 100;
      peak = Math.max(peak, pct);
      if (pct >= 25) Arcade.flag('turf-trail-quarter');
      if (pct >= 50) Arcade.flag('turf-trail-half');
    }
    updateHud();
  }

  // ---------- Bots ----------

  // Bots go out on little rectangular loops, bolder when nobody's near their trail.
  function think(p) {
    const ai = p.ai;
    const home = owner[idx(p.x, p.y)] === p.id;
    // Danger: an enemy head near our trail. Head straight home.
    if (p.out) {
      let danger = false;
      for (const q of players) {
        if (q === p || !q.alive) continue;
        for (let k = p.path.length - 1; k >= Math.max(0, p.path.length - 40); k -= 2) {
          const i = p.path[k], tx = i % GW, ty = (i / GW) | 0;
          if (Math.abs(q.x - tx) + Math.abs(q.y - ty) < 7) { danger = true; break; }
        }
        if (danger) break;
      }
      if (danger || p.path.length > 26 + ai.bold * 30) ai.plan = [];
      if (!ai.plan.length) { goHome(p); return; }
    }
    if (!ai.plan.length) {
      if (!home) return goHome(p);
      // Plan a loop: out, across, back.
      const a = Math.floor(Math.random() * 4), turn = Math.random() < 0.5 ? 1 : 3;
      const out = 3 + Math.floor(Math.random() * (5 + ai.bold * 8)), across = 3 + Math.floor(Math.random() * (5 + ai.bold * 10));
      ai.plan = [...Array(out).fill(a), ...Array(across).fill((a + turn) % 4), ...Array(out + 2).fill((a + 2) % 4)];
      ai.plan.unshift(...Array(1 + Math.floor(Math.random() * 3)).fill(p.dir));
    }
    let d = ai.plan.shift();
    // Don't run into our own trail or off the map.
    const safe = dd => { const X = p.x + DIRS[dd][0], Y = p.y + DIRS[dd][1]; return inside(X, Y) && trail[idx(X, Y)] !== p.id && (dd + 2) % 4 !== p.dir; };
    if (!safe(d)) { ai.plan = []; d = [p.dir, (p.dir + 1) % 4, (p.dir + 3) % 4].find(safe) ?? p.dir; }
    p.want = d;
  }

  // The way back: toward the nearest cell of our land, avoiding our own trail.
  function goHome(p) {
    let best = null, bd = Infinity;
    for (let k = 0; k < 4; k++) {
      if ((k + 2) % 4 === p.dir) continue;
      const X = p.x + DIRS[k][0], Y = p.y + DIRS[k][1];
      if (!inside(X, Y) || trail[idx(X, Y)] === p.id) continue;
      // Distance to the nearest home cell, sampled on a coarse grid.
      let d = Infinity;
      for (let y = 0; y < GH; y += 2) for (let x = 0; x < GW; x += 2) if (owner[idx(x, y)] === p.id) d = Math.min(d, Math.abs(x - X) + Math.abs(y - Y));
      if (owner[idx(X, Y)] === p.id) d = -1;
      if (d < bd) { bd = d; best = k; }
    }
    if (best !== null) p.want = best;
  }

  // ---------- Flow ----------

  function start() {
    owner.fill(0); trail.fill(0); fx.clear();
    names = [...NAMES].sort(() => Math.random() - 0.5);
    players = [];
    me = makePlayer(1, 'You', COLORS[0], false);
    players.push(me);
    for (let i = 0; i < BOTS; i++) players.push(makePlayer(i + 2, names[i], COLORS[i + 1], true));
    for (const p of players) spawn(p);
    // You start heading toward the open middle, not into a wall.
    me.dir = me.want = me.x < GW / 2 ? 0 : 2;
    peak = 0; kos = 0; time = 0;
    repaintAll();
    count();
    state = 'play';
    ui.hide();
  }

  const scoreNow = () => Math.round(peak * 100) + kos * 250;

  function gameOver() {
    if (state !== 'play') return;
    state = 'over';
    Arcade.finish(ui, {
      score: scoreNow(),
      title: 'Knocked out!',
      lines: [`Most land: ${peak.toFixed(1)}% · ${kos} knockout${kos === 1 ? '' : 's'} · survived ${Math.floor(time)} s`],
      button: 'Play again',
      onAction: start,
    });
  }

  function update(dt) {
    time += dt;
    for (const p of players) {
      if (!p.alive) {
        if (p.bot) { p.respawnT -= dt; if (p.respawnT <= 0) spawn(p); }
        continue;
      }
      p.t += dt * SPEED * (p === me && boostOn() ? 1.25 : 1);
      while (p.t >= 1 && p.alive) { p.t -= 1; stepPlayer(p); }
      if (state !== 'play') return;
    }
    fx.update(dt);
    floats.update(dt);
    shake.update(dt);
    updateHud();
  }

  // ---------- Input ----------

  const keys = new Set();
  const boostOn = () => false;
  addEventListener('keydown', e => {
    keys.add(e.code);
    if (state !== 'play') return;
    const d = { ArrowRight: 0, KeyD: 0, ArrowDown: 1, KeyS: 1, ArrowLeft: 2, KeyA: 2, ArrowUp: 3, KeyW: 3 }[e.code];
    if (d !== undefined) { e.preventDefault(); me.want = d; }
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  Arcade.onSwipe(canvas, dir => { if (state === 'play') me.want = { right: 0, down: 1, left: 2, up: 3 }[dir] ?? me.want; });
  function pause() {
    if (state !== 'play' || (typeof Versus !== 'undefined' && Versus.active())) return;
    state = 'paused';
    ui.show({ title: 'Paused', html: `<p>${(me.cells / (GW * GH) * 100).toFixed(1)}% of the map</p>`, button: 'Resume', onAction: () => { state = 'play'; ui.hide(); } });
  }
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  // The map is one pixel per cell in an offscreen canvas, scaled up with crisp edges.
  const mapC = document.createElement('canvas');
  mapC.width = GW; mapC.height = GH;
  const mg = mapC.getContext('2d');
  const img = mg.createImageData(GW, GH);
  const rgbCache = {};
  const rgb = hex => rgbCache[hex] || (rgbCache[hex] = Gfx.rgb(hex));
  function paint(x, y) {
    const i = idx(x, y), o = owner[i], t = trail[i];
    let c;
    if (t) c = rgb(players[t - 1]?.light || '#ffffff');
    else if (o) c = rgb(players[o - 1]?.color || '#888888');
    else c = (x + y) % 2 ? [36, 42, 58] : [40, 47, 64];
    const k = i * 4;
    img.data[k] = c[0] ?? c.r; img.data[k + 1] = c[1] ?? c.g; img.data[k + 2] = c[2] ?? c.b; img.data[k + 3] = 255;
    dirty = true;
  }
  function repaintAll() { for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) paint(x, y); }
  let dirty = true;

  // A soft bevel over every cell, drawn once.
  const bevel = Gfx.sprite(GW * CELL, GH * CELL, 0, 0, g => {
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x * CELL, y * CELL, CELL, 1);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x * CELL, y * CELL + CELL - 1, CELL, 1);
    }
  });

  function draw() {
    if (dirty) { mg.putImageData(img, 0, 0); dirty = false; }
    const off = shake.offset(6);
    ctx.fillStyle = '#151924';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(off.x, off.y);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mapC, 0, TOP, GW * CELL, GH * CELL);
    ctx.imageSmoothingEnabled = true;
    bevel.draw(ctx, 0, TOP);
    // Heads, eased between cells.
    for (const p of players) {
      if (!p.alive) continue;
      const k = Math.min(1, p.t);
      const nx = p.x + DIRS[p.dir][0] * k, ny = p.y + DIRS[p.dir][1] * k;
      const fx_ = inside(p.x + DIRS[p.dir][0], p.y + DIRS[p.dir][1]) ? nx : p.x, fy = inside(p.x + DIRS[p.dir][0], p.y + DIRS[p.dir][1]) ? ny : p.y;
      const x = fx_ * CELL + CELL / 2, y = TOP + fy * CELL + CELL / 2;
      Gfx.shadow(ctx, x + 2, y + 3, 9, 6, 0.35);
      ctx.fillStyle = p.dark;
      Gfx.roundRect(ctx, x - 8, y - 7, 16, 16, 5); ctx.fill();
      ctx.fillStyle = p.color;
      Gfx.roundRect(ctx, x - 8, y - 9, 16, 16, 5); ctx.fill();
      // Eyes look where it's heading.
      const [dx, dy] = DIRS[p.dir];
      ctx.fillStyle = '#fff';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(x + dx * 3 - dy * s * 3.5, y - 1 + dy * 3 + dx * s * 3.5, 2.6, 0, 6.28); ctx.fill(); }
      ctx.fillStyle = '#111';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(x + dx * 4 - dy * s * 3.5, y - 1 + dy * 4 + dx * s * 3.5, 1.3, 0, 6.28); ctx.fill(); }
      Gfx.text(ctx, p.name, x, y - 18, { size: 11, color: p === me ? '#fff' : p.light, width: 3 });
    }
    fx.draw(ctx);
    floats.draw(ctx);
    ctx.restore();
    // Top bar: standings.
    ctx.fillStyle = 'rgba(10,12,20,0.85)';
    ctx.fillRect(0, 0, W, TOP);
    const ranked = [...players].sort((a, b) => b.cells - a.cells);
    let x = 10;
    for (const p of ranked) {
      const pct = p.alive ? p.cells / (GW * GH) * 100 : 0;
      const label = `${p.name} ${pct.toFixed(1)}%`;
      ctx.font = '700 12px system-ui, sans-serif';
      const w = ctx.measureText(label).width + 26;
      ctx.globalAlpha = p.alive ? 1 : 0.35;
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x + 7, TOP / 2, 5, 0, 6.28); ctx.fill();
      Gfx.text(ctx, label, x + 16, TOP / 2, { size: 12, align: 'left', stroke: null, color: p === me ? '#ffd23f' : '#e0e6f0' });
      ctx.globalAlpha = 1;
      x += w;
    }
    if (me) Gfx.text(ctx, `Score ${scoreNow().toLocaleString()}`, W - 10, TOP / 2, { size: 13, align: 'right', stroke: null, color: '#ffd23f' });
    if (me?.alive && me.out) Gfx.text(ctx, 'Out on a trail: get home to claim it!', W / 2, H - 14, { size: 13, color: me.light });
  }

  function updateHud() {
    $('land').textContent = me ? `${(me.alive ? me.cells / (GW * GH) * 100 : 0).toFixed(1)}%` : '0%';
    $('kos').textContent = kos;
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'play' && (overlayEl.hidden || (typeof Versus !== 'undefined' && Versus.active()))) update(dt);
    else { fx.update(dt); floats.update(dt); shake.update(dt); }
    draw();
    requestAnimationFrame(frame);
  }

  repaintAll();
  Versus.attach({
    ui, start, score: scoreNow,
    intro: {
      title: '🟦 Turf Trail',
      html: `<p>Claim the map. Leave your land to draw a trail, then get home: everything your loop surrounds becomes yours, even other players' land.</p>
        <ul style="text-align:left;font-size:14px"><li>Cross anyone's trail to knock them out.</li><li>If someone crosses <b>your</b> trail while you're out (or you cross it yourself), you're done.</li><li>Arrow keys or WASD to turn. Score: the most land you held ×100, plus 250 per knockout.</li></ul>`,
      button: 'Play',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
