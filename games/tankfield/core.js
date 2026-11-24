/* Tankfield rules, with no drawing, audio or input. The browser game and the Node trainer both
   run this, so the numbers here are the single source of truth. Everything random goes through
   world.rng, and everything the player should see or hear comes out as world.events. */
(function (root) {
  const TAU = Math.PI * 2;
  const AW = 2600, AH = 1800;
  const LEVEL_CAP = 45;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const rand = (w, a, b) => a + w.rng() * (b - a);

  const STATS = [
    { id: 'armor', name: 'Armor', color: '#3ccf8e' },
    { id: 'repair', name: 'Repair', color: '#9be37a' },
    { id: 'ram', name: 'Ram', color: '#ff7ae0' },
    { id: 'shotSpeed', name: 'Shot speed', color: '#4fc3ff' },
    { id: 'shotPower', name: 'Shot power', color: '#ff5a5f' },
    { id: 'reload', name: 'Reload', color: '#ffd23f' },
    { id: 'speed', name: 'Engine', color: '#b07cff' },
  ];
  const MAX_STAT = 7;
  // Turrets: barrels are [angle offset, side offset, length, width, delay fraction].
  const TURRETS = {
    basic: { name: 'Basic', barrels: [[0, 0, 26, 12, 0]], reload: 1, power: 1, speed: 1, spread: 0.03, next: ['twin', 'longshot', 'spray', 'guard'], desc: 'One barrel' },
    twin: { name: 'Twin', barrels: [[0, -6, 26, 10, 0], [0, 6, 26, 10, 0.5]], reload: 1, power: 0.75, speed: 1, spread: 0.04, next: ['triple', 'quad'], desc: 'Two barrels side by side' },
    longshot: { name: 'Long Shot', barrels: [[0, 0, 36, 11, 0]], reload: 1.6, power: 1.6, speed: 1.5, spread: 0.01, range: 1.4, next: ['rail', 'hunter'], desc: 'Slow, hard-hitting, far' },
    spray: { name: 'Spray', barrels: [[0, 0, 24, 16, 0]], reload: 0.5, power: 0.75, speed: 0.95, spread: 0.2, next: ['hose', 'shotgun'], desc: 'Fast and messy' },
    guard: { name: 'Rear Guard', barrels: [[0, 0, 26, 12, 0], [Math.PI, 0, 22, 12, 0.5]], reload: 1, power: 0.95, speed: 1, spread: 0.03, next: ['star', 'tri'], desc: 'Front and back' },
    triple: { name: 'Triple', barrels: [[0, 0, 28, 10, 0], [0.3, 0, 25, 10, 0.33], [-0.3, 0, 25, 10, 0.66]], reload: 1, power: 0.75, speed: 1, spread: 0.04, desc: 'A three-way fan' },
    quad: { name: 'Quad Twin', barrels: [[0, -6, 26, 9, 0], [0, 6, 26, 9, 0.5], [0.15, -14, 22, 8, 0.25], [-0.15, 14, 22, 8, 0.75]], reload: 1.05, power: 0.65, speed: 1, spread: 0.05, desc: 'Four forward barrels' },
    rail: { name: 'Railgun', barrels: [[0, 0, 44, 10, 0]], reload: 2.1, power: 2.6, speed: 2, spread: 0, range: 1.7, pierce: 3, desc: 'Shots go through targets' },
    hunter: { name: 'Hunter', barrels: [[0, 0, 36, 13, 0], [0, 0, 28, 17, 0.12]], reload: 1.7, power: 1.35, speed: 1.4, spread: 0.01, range: 1.4, desc: 'A double long shot' },
    hose: { name: 'Fire Hose', barrels: [[0, -5, 24, 12, 0], [0, 5, 24, 12, 0.5]], reload: 0.45, power: 0.6, speed: 0.95, spread: 0.22, desc: 'A wall of shots' },
    shotgun: { name: 'Scattergun', barrels: [[0, 0, 26, 20, 0]], reload: 1.9, power: 0.7, speed: 1.1, spread: 0.35, pellets: 6, desc: 'Six pellets per shot' },
    star: { name: 'Starburst', barrels: [0, 1, 2, 3, 4, 5].map(k => [k * TAU / 6, 0, 23, 10, k % 2 / 2]), reload: 1.15, power: 0.8, speed: 1, spread: 0.03, desc: 'Six barrels all around' },
    tri: { name: 'Thruster', barrels: [[0, 0, 28, 12, 0], [Math.PI - 0.45, 0, 22, 10, 0.5], [Math.PI + 0.45, 0, 22, 10, 0.5]], reload: 0.95, power: 0.95, speed: 1.05, spread: 0.03, thrust: true, desc: 'Back barrels push you forward' },
  };
  const SHAPE_KINDS = [
    { sides: 4, r: 14, hp: 10, xp: 10, color: '#ffd23f', w: 60 },
    { sides: 3, r: 15, hp: 30, xp: 25, color: '#ff6b6b', w: 28 },
    { sides: 5, r: 24, hp: 100, xp: 130, color: '#7aa2ff', w: 10 },
    { sides: 6, r: 44, hp: 600, xp: 1200, color: '#b07cff', w: 1 },
  ];
  const xpFor = lv => Math.round(20 * Math.pow(lv, 1.75));   // total xp needed to reach level lv+1

  const T = t => TURRETS[t.turret];
  const maxHp = t => 100 + t.stats.armor * 30 + (t.level - 1) * 4;
  const moveSpeed = t => 210 + t.stats.speed * 16 - t.level * 1.2;
  const reloadTime = t => 0.42 * T(t).reload * Math.pow(0.88, t.stats.reload);
  const shotDamage = t => 7 * T(t).power * (1 + t.stats.shotPower * 0.22);
  const shotSpeed = t => 460 * T(t).speed * (1 + t.stats.shotSpeed * 0.1);
  const radius = t => 22 + Math.min(14, (t.level - 1) * 0.45);
  const freshStats = () => Object.fromEntries(STATS.map(s => [s.id, 0]));

  function createWorld({ rng, shapes = 70 } = {}) {
    const world = { tanks: [], shapes: [], shots: [], time: 0, events: [], pending: [], rng: rng || Math.random, shapeId: 0, tankId: 0, shapeTarget: shapes };
    for (let i = 0; i < shapes; i++) spawnShape(world);
    return world;
  }

  // ---------- Tanks ----------

  function makeTank(world, { name, color, bot }) {
    const t = { id: ++world.tankId, name, color, bot, x: 0, y: 0, vx: 0, vy: 0, a: 0, r: 22, hp: 100, max: 100, xp: 0, level: 1, points: 0, stats: freshStats(), turret: 'basic', reload: 0, phase: 0, alive: true, hitT: 0, regenT: 0, respawnT: 0, recoilT: 0,
      ai: bot ? { mode: 'farm', target: null, thinkT: 0, wander: rand(world, 0, TAU), aimErr: 0, courage: rand(world, 0.5, 1.2) } : null };
    place(world, t);
    return t;
  }
  function place(world, t) {
    for (let k = 0; k < 50; k++) {
      t.x = 150 + world.rng() * (AW - 300); t.y = 150 + world.rng() * (AH - 300);
      if (world.tanks.every(o => o === t || !o.alive || Math.hypot(o.x - t.x, o.y - t.y) > 600)) break;
    }
  }

  function gainXp(world, t, n) {
    t.xp += n;
    while (t.level < LEVEL_CAP && t.xp >= xpFor(t.level)) {
      t.level++;
      if (t.level <= 34) t.points++;
      t.max = maxHp(t);
      t.hp = Math.min(t.max, t.hp + 20);
      world.events.push({ type: 'levelUp', t });
      // New turrets at 10 and 20.
      if ((t.level === 10 || t.level === 20) && T(t).next) {
        const options = T(t).next;
        if (t.bot) t.turret = options[Math.floor(world.rng() * options.length)];
        else world.events.push({ type: 'turretPick', t, options });
      }
      if (t.bot) botSpend(world, t);
    }
  }
  function spend(world, t, i) {
    const s = STATS[i];
    if (!s || t.points <= 0 || t.stats[s.id] >= MAX_STAT) return false;
    t.stats[s.id]++;
    t.points--;
    t.max = maxHp(t);
    if (s.id === 'armor') t.hp += 30;
    return true;
  }
  function botSpend(world, t) {
    const pref = [4, 5, 0, 3, 6, 1, 2];
    while (t.points > 0) {
      const opts = pref.filter(i => t.stats[STATS[i].id] < MAX_STAT);
      if (!opts.length) break;
      spend(world, t, opts[Math.floor(world.rng() * Math.min(3, opts.length))]);
    }
  }
  function setTurret(world, t, id) {
    if (TURRETS[id]) t.turret = id;
  }

  // ---------- Shooting ----------

  function fire(world, t) {
    if (t.reload > 0 || !t.alive) return;
    const tur = T(t);
    t.reload = reloadTime(t);
    for (const [ao, side, len, wid, delay] of tur.barrels) {
      const go = () => {
        if (!t.alive) return;
        const a = t.a + ao, ca = Math.cos(a), sa = Math.sin(a), sc = radius(t) / 22;
        const bx = t.x + ca * len * sc - sa * side * sc, by = t.y + sa * len * sc + ca * side * sc;
        for (let p = 0; p < (tur.pellets || 1); p++) {
          const aa = a + rand(world, -1, 1) * tur.spread, sp = shotSpeed(t) * (tur.pellets ? rand(world, 0.8, 1.1) : 1);
          const shot = { x: bx, y: by, vx: Math.cos(aa) * sp + t.vx * 0.3, vy: Math.sin(aa) * sp + t.vy * 0.3, r: wid * 0.42 * sc, dmg: shotDamage(t), life: 1.3 * (tur.range || 1), owner: t, pierce: tur.pierce || 1, color: t.color };
          world.shots.push(shot);
          world.events.push({ type: 'shot', t, shot });
        }
        // Recoil (forward thrust for the Thruster's back barrels).
        const k = tur.thrust && Math.abs(angDiff(a, t.a)) > 1 ? -28 : 9;
        t.vx -= ca * k; t.vy -= sa * k;
        t.recoilT = 0.08;
      };
      if (delay) world.pending.push({ at: world.time + delay * t.reload, fn: go }); else go();
    }
  }

  function damage(world, target, n, by) {
    if (target.shield > 0 || target.dead || target.alive === false) return;
    // Live: each machine owns its own tank, so damage to the other player only happens over
    // there (they report it).
    if (target.remote) return;
    if (target.sides) world.events.push({ type: 'shapeHit', s: target, n, by });
    target.hp -= n;
    target.hitT = 0.1;
    target.regenT = 0;
    if (target.ai && by && !by.bot) target.ai.provoked = true;
    if (!target.sides) world.events.push({ type: 'hit', target, n, by, x: target.x, y: target.y });
    if (target.hp <= 0) {
      if (target.sides) killShape(world, target, by);
      else killTank(world, target, by);
    }
  }

  function killShape(world, s, by) {
    s.dead = true;
    world.events.push({ type: 'shapeKilled', s, by });
    if (by && by.alive !== undefined && !by.remote) gainXp(world, by, s.k.xp);
  }

  function killTank(world, t, by) {
    t.alive = false;
    const xp = Math.round(t.xp * 0.5) + 50;
    world.events.push({ type: 'tankKilled', t, by, xp });
    if (by && !by.remote) gainXp(world, by, xp);
    t.respawnT = 4;
  }

  // ---------- Shapes ----------

  function spawnShape(world) {
    let r = world.rng() * 99, k = SHAPE_KINDS[0];
    for (const kk of SHAPE_KINDS) { if (r < kk.w) { k = kk; break; } r -= kk.w; }
    // Pentagons and the rare big hexagon gather in the middle.
    const mid = k.sides >= 5;
    const x = mid ? AW / 2 + rand(world, -450, 450) : 60 + world.rng() * (AW - 120), y = mid ? AH / 2 + rand(world, -300, 300) : 60 + world.rng() * (AH - 120);
    const s = makeShape(world, k, x, y, ++world.shapeId);
    world.shapes.push(s);
    return s;
  }
  function makeShape(world, k, x, y, id) {
    return { id, k, sides: k.sides, x, y, vx: 0, vy: 0, a: rand(world, 0, TAU), spin: rand(world, -0.6, 0.6), hp: k.hp, max: k.hp, r: k.r, hitT: 0, drift: rand(world, 0, TAU) };
  }

  // ---------- Bots ----------

  function botControl(world, t, dt, opts = {}) {
    const ai = t.ai;
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = 0.4 + rand(world, 0, 0.4);
      // Enemies close by: fight them if we're not much weaker, otherwise back off.
      let foe = null, fd = 650;
      for (const o of world.tanks) {
        if (o === t || !o.alive) continue;
        if (opts.ignore && opts.ignore.has(o)) continue;
        // A new player gets a grace period to find their feet, unless they start the fight.
        if (o === opts.graceTarget && world.time < opts.graceUntil && !ai.provoked) continue;
        const d = Math.hypot(o.x - t.x, o.y - t.y);
        if (d < fd) { fd = d; foe = o; }
      }
      const brave = foe && (t.level * ai.courage >= foe.level * 0.8 || t.hp > t.max * 0.7);
      if (foe && brave && t.hp > t.max * 0.3) { ai.mode = 'fight'; ai.target = foe; }
      else if (foe && fd < 450) { ai.mode = 'flee'; ai.target = foe; }
      else {
        ai.mode = 'farm';
        let best = null, bs = -Infinity;
        for (const s of world.shapes) { const d = Math.hypot(s.x - t.x, s.y - t.y); const sc = s.k.xp / (d + 150) - (s.k.sides === 6 && t.level < 15 ? 1 : 0); if (sc > bs) { bs = sc; best = s; } }
        ai.target = best;
      }
      ai.aimErr = rand(world, -0.12, 0.12);
    }
    const tg = ai.target && (ai.target.alive !== false) && !ai.target.dead ? ai.target : null;
    let mx = 0, my = 0;
    if (tg) {
      const dx = tg.x - t.x, dy = tg.y - t.y, d = Math.hypot(dx, dy) || 1;
      const lead = d / shotSpeed(t);
      t.a += angDiff(Math.atan2(tg.y + (tg.vy || 0) * lead - t.y, tg.x + (tg.vx || 0) * lead - t.x) + ai.aimErr, t.a) * Math.min(1, dt * 6);
      const want = ai.mode === 'fight' ? 260 * (T(t).range || 1) : ai.mode === 'flee' ? 99999 : 160;
      const dir = ai.mode === 'flee' ? -1 : d > want ? 1 : d < want * 0.7 ? -1 : 0;
      mx = dx / d * dir; my = dy / d * dir;
      if (ai.mode !== 'flee') { const s = Math.sin(world.time * 1.3 + ai.wander) * 0.6; mx += -dy / d * s; my += dx / d * s; }
      if (ai.mode !== 'flee' || d < 400) if (Math.abs(angDiff(Math.atan2(dy, dx), t.a)) < 0.3 && d < 520 * (T(t).range || 1)) fire(world, t);
    } else {
      mx = Math.cos(ai.wander); my = Math.sin(ai.wander);
      ai.wander += rand(world, -0.5, 0.5) * dt;
    }
    return { mx, my };
  }

  function drive(world, t, mx, my, dt) {
    const m = Math.hypot(mx, my);
    const sp = moveSpeed(t);
    if (m > 0) { t.vx += mx / m * sp * 5 * dt; t.vy += my / m * sp * 5 * dt; }
    const v = Math.hypot(t.vx, t.vy);
    if (v > sp) { t.vx *= sp / v; t.vy *= sp / v; }
    t.vx *= 1 - 3 * dt; t.vy *= 1 - 3 * dt;
    const r = radius(t);
    t.x = clamp(t.x + t.vx * dt, r, AW - r);
    t.y = clamp(t.y + t.vy * dt, r, AH - r);
  }

  function respawnBot(world, t) {
    // Back with a fraction of what it had, so the arena keeps some strong rivals.
    const keep = Math.floor(t.xp * 0.3);
    Object.assign(t, { xp: 0, level: 1, points: 0, stats: freshStats(), turret: 'basic', alive: true, vx: 0, vy: 0 });
    t.max = maxHp(t); t.hp = t.max;
    place(world, t);
    gainXp(world, t, keep);
    t.hp = t.max;
  }

  // ---------- One tick ----------

  // controls: Map<tank, { mx, my, aim, fire }>. Callers smooth turret angle (t.a) themselves;
  // step never writes t.a for a controlled tank and ignores `aim`.
  function step(world, dt, controls, opts = {}) {
    const spawnShapes = opts.spawnShapes !== false;
    world.time += dt;
    const tanks = world.tanks;
    for (const t of tanks) {
      if (t.remote) continue;
      if (!t.alive) {
        if (t.bot && !(controls && controls.has(t))) { t.respawnT -= dt; if (t.respawnT <= 0) respawnBot(world, t); }
        continue;
      }
      const c = controls && controls.get(t);
      if (c) {
        drive(world, t, c.mx || 0, c.my || 0, dt);
        if (c.fire) fire(world, t);
      } else if (t.bot) {
        const b = botControl(world, t, dt, opts);
        drive(world, t, b.mx, b.my, dt);
      }
      t.reload = Math.max(0, t.reload - dt);
      t.hitT = Math.max(0, t.hitT - dt);
      t.recoilT = Math.max(0, t.recoilT - dt);
      t.regenT += dt;
      if (t.regenT > 5 - t.stats.repair * 0.4) t.hp = Math.min(t.max, t.hp + (2 + t.stats.repair * 2.2) * dt);
    }
    // Shots.
    for (const s of world.shots) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.x < 0 || s.y < 0 || s.x > AW || s.y > AH) s.life = 0;
      if (s.life <= 0) continue;
      for (const sh of world.shapes) {
        if (sh.dead || Math.hypot(sh.x - s.x, sh.y - s.y) > sh.r + s.r) continue;
        // The other player's shots only knock shapes about here; their machine sends the damage.
        if (!s.owner.remote) damage(world, sh, s.dmg, s.owner);
        sh.hitT = 0.08;
        sh.vx += s.vx * 0.02; sh.vy += s.vy * 0.02;
        if (--s.pierce <= 0) { s.life = 0; break; }
      }
      if (s.life <= 0) continue;
      for (const t of tanks) {
        if (t === s.owner || !t.alive || t.shield > 0 || Math.hypot(t.x - s.x, t.y - s.y) > radius(t) + s.r) continue;
        damage(world, t, s.dmg, s.owner);
        if (--s.pierce <= 0) { s.life = 0; break; }
      }
    }
    world.shots = world.shots.filter(s => s.life > 0);
    // Shapes drift and spin; bodies bump.
    for (const sh of world.shapes) {
      sh.drift += dt * 0.2;
      sh.vx += Math.cos(sh.drift) * 4 * dt; sh.vy += Math.sin(sh.drift) * 4 * dt;
      sh.vx *= 1 - 2 * dt; sh.vy *= 1 - 2 * dt;
      sh.x = clamp(sh.x + sh.vx * dt, sh.r, AW - sh.r); sh.y = clamp(sh.y + sh.vy * dt, sh.r, AH - sh.r);
      sh.a += sh.spin * dt;
      sh.hitT = Math.max(0, sh.hitT - dt);
      // Live guest: ease toward where the host says the shape is.
      if (sh.tx !== undefined) { const k = Math.min(1, dt * 3); sh.x += (sh.tx - sh.x) * k; sh.y += (sh.ty - sh.y) * k; }
      for (const t of tanks) {
        if (!t.alive || t.remote) continue;
        const dx = sh.x - t.x, dy = sh.y - t.y, d = Math.hypot(dx, dy), min = sh.r + radius(t);
        if (d >= min || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        sh.vx += nx * 140; sh.vy += ny * 140; t.vx -= nx * 70; t.vy -= ny * 70;
        damage(world, sh, 4 + t.stats.ram * 4, t);
        damage(world, t, sh.k.sides === 3 ? 6 : 3, null);
      }
    }
    world.shapes = world.shapes.filter(s => !s.dead);
    if (spawnShapes) while (world.shapes.length < world.shapeTarget) spawnShape(world);
    // Tanks ramming tanks.
    for (let i = 0; i < tanks.length; i++) for (let j = i + 1; j < tanks.length; j++) {
      const a = tanks[i], b = tanks[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = radius(a) + radius(b);
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      // Live: only our own side of a bump (the other player's machine does theirs).
      if (!a.remote) { a.vx -= nx * 200; a.vy -= ny * 200; damage(world, a, 6 + b.stats.ram * 5, b); }
      if (!b.remote) { b.vx += nx * 200; b.vy += ny * 200; damage(world, b, 6 + a.stats.ram * 5, a); }
    }
    // Delayed barrels.
    if (world.pending.length) {
      const due = world.pending.filter(p => world.time >= p.at);
      if (due.length) {
        world.pending = world.pending.filter(p => world.time < p.at);
        for (const p of due) p.fn();
      }
    }
  }

  const api = { AW, AH, STATS, MAX_STAT, TURRETS, SHAPE_KINDS, xpFor, LEVEL_CAP,
    maxHp, moveSpeed, reloadTime, shotDamage, shotSpeed, radius,
    createWorld, makeTank, place, gainXp, spend, botSpend, setTurret, fire, damage, drive, botControl, respawnBot, spawnShape, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TankCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
