/* Tankfield: a top-down tank arena. Shoot the drifting shapes for experience, level up, put
   points into your tank's stats (keys 1-7), and pick a new turret at levels 10 and 20. Rival
   tanks are doing the same, and they'll come for you once they're strong enough. One life; the
   score is all the experience you earned. Auto-aim is on by default (Q switches to the mouse). */
(() => {
  const ID = 'tankfield';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const AW = 2600, AH = 1800;
  const RIVALS = 6, SHAPES = 70;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const R = Gfx.rand;
  const fx = Gfx.particles(700), floats = Gfx.floaters(), shake = Gfx.shaker();

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

  let tanks = [], shapes = [], shots = [], me = null, state = 'menu', cam = { x: AW / 2, y: AH / 2 }, time = 0, aimMode = Arcade.load('tank:aim', 'auto');
  let mouse = { x: W / 2, y: H / 2, down: false }, kills = 0, picking = null;

  // ---------- Tanks ----------

  const NAMES = ['Rumble', 'Ironsides', 'Boomer', 'Tread', 'Clank', 'Bolt', 'Rivet', 'Howitzer', 'Pounder', 'Sprocket'];
  const COLORS = ['#ff5a5f', '#ffb02e', '#3ccf8e', '#ff7ae0', '#b07cff', '#2ee6c9'];
  function makeTank(name, color, bot) {
    const t = { name, color, bot, x: 0, y: 0, vx: 0, vy: 0, a: 0, r: 22, hp: 100, max: 100, xp: 0, level: 1, points: 0, stats: Object.fromEntries(STATS.map(s => [s.id, 0])), turret: 'basic', reload: 0, phase: 0, alive: true, hitT: 0, regenT: 0, respawnT: 0, recoilT: 0,
      ai: bot ? { mode: 'farm', target: null, thinkT: 0, wander: R(0, TAU), aimErr: 0, courage: R(0.5, 1.2) } : null };
    place(t);
    return t;
  }
  function place(t) {
    for (let k = 0; k < 50; k++) {
      t.x = 150 + Math.random() * (AW - 300); t.y = 150 + Math.random() * (AH - 300);
      if (tanks.every(o => o === t || !o.alive || Math.hypot(o.x - t.x, o.y - t.y) > 600)) break;
    }
  }
  const T = t => TURRETS[t.turret];
  const maxHp = t => 100 + t.stats.armor * 30 + (t.level - 1) * 4;
  const moveSpeed = t => 210 + t.stats.speed * 16 - t.level * 1.2;
  const reloadTime = t => 0.42 * T(t).reload * Math.pow(0.88, t.stats.reload);
  const shotDamage = t => 7 * T(t).power * (1 + t.stats.shotPower * 0.22);
  const shotSpeed = t => 460 * T(t).speed * (1 + t.stats.shotSpeed * 0.1);
  const radius = t => 22 + Math.min(14, (t.level - 1) * 0.45);

  function gainXp(t, n) {
    t.xp += n;
    while (t.level < 45 && t.xp >= xpFor(t.level)) {
      t.level++;
      if (t.level <= 34) t.points++;
      t.max = maxHp(t);
      t.hp = Math.min(t.max, t.hp + 20);
      if (t === me) {
        floats.add(`Level ${t.level}!`, t.x, t.y - 46, { color: '#ffd23f', size: 18 });
        Arcade.tone({ freq: 523, to: 1046, dur: 0.18, type: 'triangle', vol: 0.05 });
        if (t.level >= 25) Arcade.flag('tankfield-25');
      }
      // New turrets at 10 and 20.
      if ((t.level === 10 || t.level === 20) && T(t).next) {
        if (t === me) picking = T(t).next;
        else t.turret = Arcade.pick(T(t).next);
      }
      if (t.bot) botSpend(t);
    }
    if (t === me) updateHud();
  }
  function spend(t, i) {
    const s = STATS[i];
    if (!s || t.points <= 0 || t.stats[s.id] >= MAX_STAT) return false;
    t.stats[s.id]++;
    t.points--;
    t.max = maxHp(t);
    if (s.id === 'armor') t.hp += 30;
    return true;
  }
  function botSpend(t) {
    const pref = [4, 5, 0, 3, 6, 1, 2];
    while (t.points > 0) { const opts = pref.filter(i => t.stats[STATS[i].id] < MAX_STAT); if (!opts.length) break; spend(t, opts[Math.floor(Math.random() * Math.min(3, opts.length))]); }
  }

  // ---------- Shooting ----------

  function fire(t) {
    if (t.reload > 0 || !t.alive) return;
    const tur = T(t);
    t.reload = reloadTime(t);
    for (const [ao, side, len, wid, delay] of tur.barrels) {
      const go = () => {
        if (!t.alive) return;
        const a = t.a + ao, ca = Math.cos(a), sa = Math.sin(a), sc = radius(t) / 22;
        const bx = t.x + ca * len * sc - sa * side * sc, by = t.y + sa * len * sc + ca * side * sc;
        for (let p = 0; p < (tur.pellets || 1); p++) {
          const aa = a + R(-1, 1) * tur.spread, sp = shotSpeed(t) * (tur.pellets ? R(0.8, 1.1) : 1);
          shots.push({ x: bx, y: by, vx: Math.cos(aa) * sp + t.vx * 0.3, vy: Math.sin(aa) * sp + t.vy * 0.3, r: wid * 0.42 * sc, dmg: shotDamage(t), life: 1.3 * (tur.range || 1), owner: t, pierce: tur.pierce || 1, color: t.color });
        }
        // Recoil (forward thrust for the Thruster's back barrels).
        const k = tur.thrust && Math.abs(angDiff(a, t.a)) > 1 ? -28 : 9;
        t.vx -= ca * k; t.vy -= sa * k;
        t.recoilT = 0.08;
        if (t === me) Arcade.tone({ freq: 380, to: 160, dur: 0.05, type: 'square', vol: 0.02 });
      };
      if (delay) setTimeout(go, delay * t.reload * 1000); else go();
    }
  }

  function damage(target, n, by) {
    target.hp -= n;
    target.hitT = 0.1;
    target.regenT = 0;
    if (target.ai && by === me) target.ai.provoked = true;
    if (target === me) { shake.add(0.12); }
    if (target.hp <= 0) {
      if (target.sides) killShape(target, by);
      else killTank(target, by);
    }
  }

  function killShape(s, by) {
    s.dead = true;
    fx.burst(10, () => ({ x: s.x, y: s.y, vx: R(-120, 120), vy: R(-120, 120), life: R(0.3, 0.6), size: R(2, 5), color: s.k.color, drag: 3, shape: 'square', spin: R(-10, 10) }));
    if (by && by.alive !== undefined) {
      gainXp(by, s.k.xp);
      if (by === me) floats.add(`+${s.k.xp}`, s.x, s.y - 12, { color: s.k.color, size: 12 + Math.min(10, s.k.xp / 40) });
      if (by === me && s.k.sides === 6) Arcade.flag('tankfield-hexagon');
    }
  }

  function killTank(t, by) {
    t.alive = false;
    fx.burst(40, () => { const a = R(0, TAU), v = R(60, 260); return { x: t.x, y: t.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.5, 1), size: R(3, 7), color: t.color, drag: 2.5, shape: 'square', spin: R(-8, 8) }; });
    Arcade.tone({ freq: 150, to: 40, dur: 0.5, type: 'sawtooth', vol: 0.06 });
    if (t === me) { shake.add(0.8); setTimeout(gameOver, 1000); return; }
    if (by) {
      gainXp(by, Math.round(t.xp * 0.5) + 50);
      if (by === me) {
        kills++;
        floats.add(`${t.name} destroyed! +${Math.round(t.xp * 0.5) + 50}`, t.x, t.y - 30, { color: '#ffd23f', size: 18 });
        shake.add(0.3);
        Arcade.flag('tankfield-kill');
        if (kills >= 5) Arcade.flag('tankfield-five');
      }
    }
    t.respawnT = 4;
  }

  // ---------- Shapes ----------

  function spawnShape() {
    let r = Math.random() * 99, k = SHAPE_KINDS[0];
    for (const kk of SHAPE_KINDS) { if (r < kk.w) { k = kk; break; } r -= kk.w; }
    // Pentagons and the rare big hexagon gather in the middle.
    const mid = k.sides >= 5;
    const x = mid ? AW / 2 + R(-450, 450) : 60 + Math.random() * (AW - 120), y = mid ? AH / 2 + R(-300, 300) : 60 + Math.random() * (AH - 120);
    shapes.push({ k, sides: k.sides, x, y, vx: 0, vy: 0, a: R(0, TAU), spin: R(-0.6, 0.6), hp: k.hp, max: k.hp, r: k.r, hitT: 0, drift: R(0, TAU) });
  }

  // ---------- Bots ----------

  function botControl(t, dt) {
    const ai = t.ai;
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = 0.4 + R(0, 0.4);
      // Enemies close by: fight them if we're not much weaker, otherwise back off.
      let foe = null, fd = 650;
      for (const o of tanks) {
        if (o === t || !o.alive) continue;
        // A new player gets 30 seconds to find their feet, unless they start the fight.
        if (o === me && time < 30 && !ai.provoked) continue;
        const d = Math.hypot(o.x - t.x, o.y - t.y);
        if (d < fd) { fd = d; foe = o; }
      }
      const brave = foe && (t.level * ai.courage >= foe.level * 0.8 || t.hp > t.max * 0.7);
      if (foe && brave && t.hp > t.max * 0.3) { ai.mode = 'fight'; ai.target = foe; }
      else if (foe && fd < 450) { ai.mode = 'flee'; ai.target = foe; }
      else {
        ai.mode = 'farm';
        let best = null, bs = -Infinity;
        for (const s of shapes) { const d = Math.hypot(s.x - t.x, s.y - t.y); const sc = s.k.xp / (d + 150) - (s.k.sides === 6 && t.level < 15 ? 1 : 0); if (sc > bs) { bs = sc; best = s; } }
        ai.target = best;
      }
      ai.aimErr = R(-0.12, 0.12);
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
      if (ai.mode !== 'flee') { const s = Math.sin(time * 1.3 + ai.wander) * 0.6; mx += -dy / d * s; my += dx / d * s; }
      if (ai.mode !== 'flee' || d < 400) if (Math.abs(angDiff(Math.atan2(dy, dx), t.a)) < 0.3 && d < 520 * (T(t).range || 1)) fire(t);
    } else {
      mx = Math.cos(ai.wander); my = Math.sin(ai.wander);
      ai.wander += R(-0.5, 0.5) * dt;
    }
    return { mx, my };
  }

  // ---------- Flow ----------

  function start() {
    tanks = []; shapes = []; shots = []; fx.clear();
    me = makeTank('You', '#4f8cff', false);
    tanks.push(me);
    me.x = AW / 2 + R(-300, 300); me.y = AH / 2 + R(-200, 200);
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < RIVALS; i++) {
      const b = makeTank(names[i], COLORS[i], true);
      tanks.push(b);
      gainXp(b, Math.floor(Math.random() * 300));
    }
    for (let i = 0; i < SHAPES; i++) spawnShape();
    kills = 0; time = 0; picking = null;
    cam.x = me.x; cam.y = me.y;
    state = 'play';
    ui.hide();
    updateHud();
  }

  function gameOver() {
    if (state !== 'play') return;
    state = 'over';
    Arcade.finish(ui, {
      score: Math.floor(me.xp),
      title: 'Tank destroyed',
      lines: [`Level ${me.level} ${T(me).name} · ${kills} tank${kills === 1 ? '' : 's'} destroyed · ${Math.floor(time)} s`],
      button: 'Roll out again',
      onAction: start,
    });
  }

  function update(dt) {
    time += dt;
    // You.
    if (me.alive) {
      let mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      let my = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      drive(me, mx, my, dt);
      // Aim: the mouse, or the nearest thing worth shooting.
      let want = me.a, auto = null;
      if (aimMode === 'mouse') want = Math.atan2(mouse.y + cam.y - H / 2 - me.y, mouse.x + cam.x - W / 2 - me.x);
      else {
        let bd = 520 * (T(me).range || 1), bs = -Infinity;
        for (const o of tanks) {
          if (o === me || !o.alive) continue;
          const d = Math.hypot(o.x - me.x, o.y - me.y);
          // Only tanks that are after you, or right on top of you: auto-aim shouldn't start fights.
          const hostile = (o.ai?.mode === 'fight' && o.ai.target === me) || d < 260;
          if (hostile && d < bd) { bs = 1e9 - d; auto = o; bd = d; }
        }
        if (!auto) for (const s of shapes) { const d = Math.hypot(s.x - me.x, s.y - me.y); if (d > 460) continue; const sc = s.k.xp / (d + 60); if (sc > bs) { bs = sc; auto = s; } }
        if (auto) { const d = Math.hypot(auto.x - me.x, auto.y - me.y), lead = d / shotSpeed(me); want = Math.atan2(auto.y + (auto.vy || 0) * lead - me.y, auto.x + (auto.vx || 0) * lead - me.x); }
      }
      me.a += angDiff(want, me.a) * Math.min(1, dt * (aimMode === 'mouse' ? 30 : 12));
      if (mouse.down || keys.has('Space') || (aimMode === 'auto' && auto && autoFire)) fire(me);
    }
    for (const t of tanks) {
      if (!t.alive) {
        if (t.bot) { t.respawnT -= dt; if (t.respawnT <= 0) respawnBot(t); }
        continue;
      }
      if (t.bot) { const c = botControl(t, dt); drive(t, c.mx, c.my, dt); }
      t.reload = Math.max(0, t.reload - dt);
      t.hitT = Math.max(0, t.hitT - dt);
      t.recoilT = Math.max(0, t.recoilT - dt);
      t.regenT += dt;
      if (t.regenT > 5 - t.stats.repair * 0.4) t.hp = Math.min(t.max, t.hp + (2 + t.stats.repair * 2.2) * dt);
    }
    // Shots.
    for (const s of shots) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.x < 0 || s.y < 0 || s.x > AW || s.y > AH) s.life = 0;
      if (s.life <= 0) continue;
      for (const sh of shapes) {
        if (sh.dead || Math.hypot(sh.x - s.x, sh.y - s.y) > sh.r + s.r) continue;
        damage(sh, s.dmg, s.owner);
        sh.hitT = 0.08;
        sh.vx += s.vx * 0.02; sh.vy += s.vy * 0.02;
        if (--s.pierce <= 0) { s.life = 0; break; }
      }
      if (s.life <= 0) continue;
      for (const t of tanks) {
        if (t === s.owner || !t.alive || Math.hypot(t.x - s.x, t.y - s.y) > radius(t) + s.r) continue;
        damage(t, s.dmg, s.owner);
        fx.burst(3, () => ({ x: s.x, y: s.y, vx: R(-80, 80), vy: R(-80, 80), life: 0.25, size: 2, color: '#fff', shape: 'spark' }));
        if (--s.pierce <= 0) { s.life = 0; break; }
      }
    }
    shots = shots.filter(s => s.life > 0);
    // Shapes drift and spin; bodies bump.
    for (const sh of shapes) {
      sh.drift += dt * 0.2;
      sh.vx += Math.cos(sh.drift) * 4 * dt; sh.vy += Math.sin(sh.drift) * 4 * dt;
      sh.vx *= 1 - 2 * dt; sh.vy *= 1 - 2 * dt;
      sh.x = clamp(sh.x + sh.vx * dt, sh.r, AW - sh.r); sh.y = clamp(sh.y + sh.vy * dt, sh.r, AH - sh.r);
      sh.a += sh.spin * dt;
      sh.hitT = Math.max(0, sh.hitT - dt);
      for (const t of tanks) {
        if (!t.alive) continue;
        const dx = sh.x - t.x, dy = sh.y - t.y, d = Math.hypot(dx, dy), min = sh.r + radius(t);
        if (d >= min || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        sh.vx += nx * 140; sh.vy += ny * 140; t.vx -= nx * 70; t.vy -= ny * 70;
        damage(sh, 4 + t.stats.ram * 4, t);
        damage(t, sh.k.sides === 3 ? 6 : 3, null);
      }
    }
    shapes = shapes.filter(s => !s.dead);
    while (shapes.length < SHAPES) spawnShape();
    // Tanks ramming tanks.
    for (let i = 0; i < tanks.length; i++) for (let j = i + 1; j < tanks.length; j++) {
      const a = tanks[i], b = tanks[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = radius(a) + radius(b);
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      a.vx -= nx * 200; a.vy -= ny * 200; b.vx += nx * 200; b.vy += ny * 200;
      damage(a, 6 + b.stats.ram * 5, b); damage(b, 6 + a.stats.ram * 5, a);
    }
    cam.x = Gfx.approach(cam.x, me.x, 6, dt);
    cam.y = Gfx.approach(cam.y, me.y, 6, dt);
    fx.update(dt); floats.update(dt); shake.update(dt);
    updateHud();
  }

  function drive(t, mx, my, dt) {
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

  function respawnBot(t) {
    // Back with a fraction of what it had, so the arena keeps some strong rivals.
    const keep = Math.floor(t.xp * 0.3);
    Object.assign(t, { xp: 0, level: 1, points: 0, stats: Object.fromEntries(STATS.map(s => [s.id, 0])), turret: 'basic', alive: true, vx: 0, vy: 0 });
    t.max = maxHp(t); t.hp = t.max;
    place(t);
    gainXp(t, keep);
    t.hp = t.max;
  }

  // ---------- Input ----------

  const keys = new Set();
  let autoFire = true;
  addEventListener('keydown', e => {
    keys.add(e.code);
    if (state !== 'play') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    const n = +e.key;
    if (n >= 1 && n <= 7) {
      if (picking && n <= picking.length) { me.turret = picking[n - 1]; picking = null; Arcade.tone({ freq: 440, to: 880, dur: 0.2, type: 'triangle', vol: 0.05 }); Arcade.flag('tankfield-turret'); if (me.level >= 20) Arcade.flag('tankfield-final'); }
      else if (!picking && spend(me, n - 1)) Arcade.tone({ freq: 600 + n * 40, dur: 0.06, type: 'triangle', vol: 0.04 });
    }
    if (e.code === 'KeyQ') { aimMode = aimMode === 'auto' ? 'mouse' : 'auto'; Arcade.save('tank:aim', aimMode); floats.add(aimMode === 'auto' ? 'Auto-aim on' : 'Aim with the mouse', me.x, me.y - 50, { color: '#fff', size: 14 }); }
    if (e.code === 'KeyE') { autoFire = !autoFire; floats.add(autoFire ? 'Auto-fire on' : 'Auto-fire off', me.x, me.y - 50, { color: '#fff', size: 14 }); }
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouse.down = false; });
  const toCanvas = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  canvas.addEventListener('pointermove', e => { const p = toCanvas(e); mouse.x = p.x; mouse.y = p.y; });
  canvas.addEventListener('pointerdown', e => {
    const p = toCanvas(e); mouse.x = p.x; mouse.y = p.y;
    // Clicks on the stat and turret panels.
    const hit = panelHit(p.x, p.y);
    if (hit) return hit();
    if (aimMode === 'mouse') mouse.down = true;
  });
  addEventListener('pointerup', () => { mouse.down = false; });
  function pause() {
    if (state !== 'play' || (typeof Versus !== 'undefined' && Versus.active())) return;
    state = 'paused';
    ui.show({ title: 'Paused', html: `<p>Level ${me.level} ${T(me).name}</p>`, button: 'Resume', onAction: () => { state = 'play'; ui.hide(); } });
  }
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function polygon(x, y, r, n, a) {
    ctx.beginPath();
    for (let k = 0; k < n; k++) { const t = a + k / n * TAU; const px = x + Math.cos(t) * r, py = y + Math.sin(t) * r; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  }

  function drawTank(t) {
    const r = radius(t), sc = r / 22, tur = T(t), flash = t.hitT > 0;
    Gfx.shadow(ctx, t.x + 3, t.y + 5, r * 1.05, r * 0.8, 0.3);
    ctx.save();
    ctx.translate(t.x, t.y);
    // Barrels.
    ctx.rotate(t.a);
    const recoil = t.recoilT > 0 ? -3 : 0;
    for (const [ao, side, len, wid] of tur.barrels) {
      ctx.save(); ctx.rotate(ao);
      ctx.fillStyle = '#8d94a1'; ctx.strokeStyle = '#4a5060'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(0, side * sc - wid * sc / 2, (len + recoil) * sc, wid * sc); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // Body.
    ctx.fillStyle = flash ? '#ffffff' : Gfx.shade(t.color, -0.25);
    ctx.beginPath(); ctx.arc(0, 2, r * 0.86, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r);
    g.addColorStop(0, flash ? '#fff' : Gfx.shade(t.color, 0.35)); g.addColorStop(1, flash ? '#fff' : t.color);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, TAU); ctx.fill();
    ctx.restore();
    if (t.hp < t.max) Gfx.bar(ctx, t.x - r, t.y + r + 8, r * 2, 5, Math.max(0, t.hp) / t.max, t === me ? '#3ccf8e' : '#ff5c5c');
    if (t !== me) Gfx.text(ctx, `${t.name} · ${t.level}`, t.x, t.y - r - 14, { size: 12, color: '#fff', width: 3 });
  }

  const grid = Gfx.sprite(80, 80, 0, 0, g => { g.fillStyle = '#d8dde6'; g.fillRect(0, 0, 80, 80); g.strokeStyle = 'rgba(80,90,110,0.12)'; g.lineWidth = 2; g.strokeRect(0, 0, 80, 80); });

  function draw() {
    const off = shake.offset(7);
    ctx.save();
    ctx.translate(off.x, off.y);
    ctx.fillStyle = '#aab3c2'; ctx.fillRect(-10, -10, W + 20, H + 20);
    const ox = W / 2 - cam.x, oy = H / 2 - cam.y;
    ctx.save();
    ctx.translate(ox, oy);
    const x0 = Math.max(0, Math.floor((cam.x - W / 2) / 80) * 80), y0 = Math.max(0, Math.floor((cam.y - H / 2) / 80) * 80);
    for (let x = x0; x < Math.min(AW, cam.x + W / 2 + 80); x += 80) for (let y = y0; y < Math.min(AH, cam.y + H / 2 + 80); y += 80) grid.draw(ctx, x, y);
    // The middle, where the big shapes gather.
    ctx.fillStyle = 'rgba(176,124,255,0.07)'; ctx.fillRect(AW / 2 - 500, AH / 2 - 340, 1000, 680);
    const vis = (x, y, m) => Math.abs(x - cam.x) < W / 2 + m && Math.abs(y - cam.y) < H / 2 + m;
    for (const s of shapes) {
      if (!vis(s.x, s.y, 60)) continue;
      Gfx.shadow(ctx, s.x + 2, s.y + 4, s.r, s.r * 0.6, 0.2);
      polygon(s.x, s.y, s.r, s.sides, s.a);
      ctx.fillStyle = s.hitT > 0 ? '#fff' : s.k.color; ctx.fill();
      ctx.strokeStyle = Gfx.shade(s.k.color, -0.35); ctx.lineWidth = 3; ctx.stroke();
      if (s.hp < s.max) Gfx.bar(ctx, s.x - s.r, s.y + s.r + 6, s.r * 2, 4, s.hp / s.max, '#3ccf8e');
    }
    for (const s of shots) {
      if (!vis(s.x, s.y, 20)) continue;
      ctx.fillStyle = Gfx.shade(s.color, -0.3); ctx.beginPath(); ctx.arc(s.x, s.y + 1.5, s.r, 0, TAU); ctx.fill();
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
    for (const t of tanks) if (t.alive && vis(t.x, t.y, 80)) drawTank(t);
    fx.draw(ctx);
    floats.draw(ctx);
    ctx.strokeStyle = 'rgba(40,50,70,0.5)'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, AW, AH);
    ctx.restore();
    ctx.restore();
    if (state === 'menu' || !me) return;
    drawPanels();
  }

  // Stat bars (bottom left), the level bar, the minimap and the turret picker.
  let hits = [];
  function drawPanels() {
    hits = [];
    const x0 = 12, y0 = H - 12 - STATS.length * 19 - 22;
    Gfx.card(ctx, x0, y0, 222, STATS.length * 19 + 28);
    Gfx.text(ctx, me.points ? `${me.points} point${me.points === 1 ? '' : 's'} to spend (keys 1-7)` : 'Stats', x0 + 10, y0 + 13, { size: 11, align: 'left', stroke: null, color: me.points ? '#ffd23f' : '#cfd8dc' });
    STATS.forEach((s, i) => {
      const y = y0 + 24 + i * 19, v = me.stats[s.id];
      Gfx.text(ctx, `${i + 1} ${s.name}`, x0 + 10, y + 6, { size: 11, align: 'left', stroke: null });
      for (let k = 0; k < MAX_STAT; k++) { ctx.fillStyle = k < v ? s.color : 'rgba(255,255,255,0.12)'; Gfx.roundRect(ctx, x0 + 100 + k * 15, y, 13, 11, 3); ctx.fill(); }
      if (me.points && v < MAX_STAT) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; Gfx.roundRect(ctx, x0 + 100 + v * 15, y, 13, 11, 3); ctx.fill(); }
      hits.push({ x: x0, y: y - 3, w: 222, h: 17, fn: () => spend(me, i) });
    });
    // Level and xp.
    const need = xpFor(me.level), prev = me.level > 1 ? xpFor(me.level - 1) : 0;
    Gfx.card(ctx, W / 2 - 170, H - 44, 340, 32);
    Gfx.bar(ctx, W / 2 - 160, H - 38, 320, 10, (me.xp - prev) / (need - prev), '#ffd23f');
    Gfx.text(ctx, `Level ${me.level} ${T(me).name} · ${Math.floor(me.xp).toLocaleString()} xp`, W / 2, H - 20, { size: 12, stroke: null });
    // Minimap.
    const mw = 150, mh = mw * AH / AW, mx = W - mw - 12, my = H - mh - 12, k = mw / AW;
    Gfx.card(ctx, mx - 4, my - 4, mw + 8, mh + 8);
    ctx.fillStyle = 'rgba(176,124,255,0.2)'; ctx.fillRect(mx + (AW / 2 - 500) * k, my + (AH / 2 - 340) * k, 1000 * k, 680 * k);
    for (const t of tanks) { if (!t.alive) continue; ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(mx + t.x * k, my + t.y * k, t === me ? 3.5 : 2.5, 0, TAU); ctx.fill(); }
    // Leaderboard.
    const top = [...tanks].filter(t => t.alive).sort((a, b) => b.xp - a.xp).slice(0, 5);
    Gfx.card(ctx, W - 182, 10, 170, 22 + top.length * 17);
    Gfx.text(ctx, 'Top tanks', W - 97, 21, { size: 11, stroke: null, color: '#cfd8dc' });
    top.forEach((t, i) => Gfx.text(ctx, `${i + 1}. ${t.name}  ${Math.floor(t.xp).toLocaleString()}`, W - 172, 38 + i * 17, { size: 11, align: 'left', stroke: null, color: t === me ? '#ffd23f' : t.color }));
    Gfx.text(ctx, `${aimMode === 'auto' ? 'Auto-aim' : 'Mouse aim'} (Q)${autoFire || aimMode === 'mouse' ? '' : ' · auto-fire off (E)'}`, 14, 20, { size: 11, align: 'left', color: '#2b2f3a', stroke: 'rgba(255,255,255,0.6)', width: 3 });
    // Turret choice.
    if (picking) {
      const n = picking.length, w = 150, x = W / 2 - (n * (w + 10) - 10) / 2, y = 60;
      Gfx.text(ctx, `Level ${me.level}: pick a new turret (keys 1-${n})`, W / 2, y - 14, { size: 16 });
      picking.forEach((id, i) => {
        const t = TURRETS[id], bx = x + i * (w + 10);
        Gfx.card(ctx, bx, y, w, 120, { fill: 'rgba(20,28,40,0.88)' });
        // A little preview.
        ctx.save(); ctx.translate(bx + w / 2, y + 48); ctx.rotate(-0.5);
        for (const [ao, side, len, wid] of t.barrels) { ctx.save(); ctx.rotate(ao); ctx.fillStyle = '#8d94a1'; ctx.fillRect(0, side * 0.8 - wid * 0.4, len * 0.8, wid * 0.8); ctx.restore(); }
        ctx.fillStyle = '#4f8cff'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
        ctx.restore();
        Gfx.text(ctx, `${i + 1}. ${t.name}`, bx + w / 2, y + 88, { size: 13, stroke: null });
        Gfx.text(ctx, t.desc, bx + w / 2, y + 106, { size: 10, stroke: null, color: '#9aa3b5' });
        hits.push({ x: bx, y, w, h: 120, fn: () => { me.turret = id; picking = null; Arcade.flag('tankfield-turret'); } });
      });
    }
  }
  function panelHit(x, y) {
    const h = [...hits].reverse().find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    return h ? h.fn : null;
  }

  function updateHud() {
    $('xp').textContent = me ? Math.floor(me.xp).toLocaleString() : 0;
    $('lvl').textContent = me ? me.level : '-';
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'play' && (overlayEl.hidden || (typeof Versus !== 'undefined' && Versus.active()))) update(dt);
    else { fx.update(dt); floats.update(dt); shake.update(dt); }
    draw();
    requestAnimationFrame(frame);
  }

  for (let i = 0; i < SHAPES; i++) spawnShape();
  updateHud();
  Versus.attach({
    ui, start, score: () => (me ? Math.floor(me.xp) : 0),
    intro: {
      title: '🛡️ Tankfield',
      html: `<p>Shoot shapes for experience, level up, and outgrow the rival tanks before they come for you. One life.</p>
        <ul style="text-align:left;font-size:14px"><li><b>WASD</b> or arrows to drive. <b>Auto-aim</b> fires at the nearest target by itself (<b>Q</b> switches to aiming and firing with the mouse; <b>E</b> turns auto-fire off).</li>
        <li>Each level gives a point: press <b>1-7</b> to upgrade Armor, Repair, Ram, Shot speed, Shot power, Reload or Engine.</li>
        <li>At levels 10 and 20 you pick a new turret. Big purple shapes in the middle are worth the most.</li></ul>`,
      button: 'Roll out',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
