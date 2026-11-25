/* Petal Patrol: lane defense. Mudlings shuffle in from the right along five lanes; plant defenders on a
   9x5 lawn stop them. Sun pays for plants. A mower sits at the end of each lane as a last resort.
   30 campaign levels in three worlds (Sunny Lawn, Moonlit Lawn, Pond), 12 plants, 8 mudling types and a
   giant at the end of every world, plus Survival. */
(() => {
  const W = 960, H = 600, TAU = Math.PI * 2;
  const COLS = 9, ROWS = 5, CW = 84, CH = 90, GX = 150, GY = 96;
  const $ = id => document.getElementById(id);
  const cx = c => GX + c * CW + CW / 2, cy = r => GY + r * CH + CH / 2;
  const colOf = x => Math.floor((x - GX) / CW);

  // ---------- Plants ----------
  const PLANTS = {
    pea:    { name: 'Pea Pod',      cost: 100, cd: 5,  hp: 300,  color: '#5fe36a', desc: 'Shoots peas down its lane.' },
    sun:    { name: 'Sunbloom',     cost: 50,  cd: 5,  hp: 300,  color: '#ffd23f', desc: 'Makes sun. Lots of sun.' },
    wall:   { name: 'Bark Wall',    cost: 50,  cd: 20, hp: 4000, color: '#b98a4a', desc: 'Soaks up a great many bites.' },
    cherry: { name: 'Cherry Blast', cost: 150, cd: 35, hp: 300,  color: '#e0344f', desc: 'Explodes in a 3x3 area.' },
    frost:  { name: 'Frost Pod',    cost: 175, cd: 5,  hp: 300,  color: '#8fe3ff', desc: 'Chilly peas slow mudlings.' },
    spud:   { name: 'Spud Mine',    cost: 25,  cd: 20, hp: 300,  color: '#c9a36a', desc: 'Arms after a while, then blows up whatever steps on it.' },
    chomp:  { name: 'Snapper',      cost: 150, cd: 8,  hp: 300,  color: '#c15bd8', desc: 'Swallows one mudling whole, then chews for ages.' },
    twin:   { name: 'Twin Pod',     cost: 200, cd: 5,  hp: 300,  color: '#3fbf4f', desc: 'Two peas per shot.' },
    squash: { name: 'Smasher',      cost: 50,  cd: 30, hp: 300,  color: '#8fc23a', desc: 'Leaps onto a nearby mudling and flattens it.' },
    thorn:  { name: 'Thorn Patch',  cost: 100, cd: 8,  hp: 300,  color: '#4a9a3a', desc: 'Hurts everything that walks over it.' },
    lob:    { name: 'Melon Lobber', cost: 300, cd: 6,  hp: 300,  color: '#7acb4a', desc: 'Lobs melons over to the first mudling it sees.' },
    torch:  { name: 'Flame Stump',  cost: 175, cd: 8,  hp: 300,  color: '#ff8a3a', desc: 'Peas through it turn to fire for double damage.' },
    lily:   { name: 'Lily Pad',     cost: 25,  cd: 5,  hp: 300,  color: '#58c46a', desc: 'Lets you plant on water.' },
  };
  const PLANT_IDS = Object.keys(PLANTS);
  const UNLOCK_AFTER = { 0: 'wall', 1: 'cherry', 2: 'frost', 3: 'spud', 4: 'chomp', 5: 'twin', 6: 'squash', 7: 'thorn', 8: 'lob', 9: 'torch', 19: 'lily' };

  // ---------- Mudlings ----------
  const ZOMBIES = {
    basic:  { name: 'Mudling',    hp: 200,  spd: 17, cost: 1 },
    cone:   { name: 'Cone Head',  hp: 560,  spd: 17, cost: 2, hat: 'cone' },
    hopper: { name: 'Hopper',     hp: 340,  spd: 30, cost: 3, hop: true },
    reader: { name: 'Reader',     hp: 400,  spd: 15, cost: 3, paper: 150 },
    bucket: { name: 'Bucket Head', hp: 1200, spd: 17, cost: 4, hat: 'bucket' },
    digger: { name: 'Digger',     hp: 500,  spd: 17, cost: 4, dig: true },
    brute:  { name: 'Brute',      hp: 1600, spd: 32, cost: 6, hat: 'helmet' },
    giant:  { name: 'Mud Giant',  hp: 9000, spd: 10, cost: 40, giant: true },
  };
  const WORLDS = [
    { name: 'Sunny Lawn', c1: '#6bbf59', c2: '#5fb04e', sky: true, water: [], start: 50, graves: 0, rowsGap: '#4a8f3d' },
    { name: 'Moonlit Lawn', c1: '#2d5a47', c2: '#285141', sky: false, water: [], start: 150, graves: 6, rowsGap: '#1f4234' },
    { name: 'Pond', c1: '#5fa85a', c2: '#559c50', sky: true, water: [2, 3], start: 100, graves: 0, rowsGap: '#437a3f' },
  ];
  // Which mudlings can appear, by world and level index within the world.
  const POOL = [
    [['basic', 0], ['cone', 2], ['hopper', 4], ['bucket', 6], ['reader', 5], ['brute', 8]],
    [['basic', 0], ['cone', 0], ['reader', 1], ['hopper', 2], ['bucket', 3], ['digger', 4], ['brute', 7]],
    [['basic', 0], ['cone', 0], ['bucket', 1], ['hopper', 1], ['digger', 2], ['reader', 3], ['brute', 5]],
  ];
  function levelPlan(L) {
    const w = Math.floor(L / 10), i = L % 10;
    const total = Math.round(8 + L * 2.2 + i * 1.5);
    const pool = POOL[w].filter(([, from]) => i >= from).map(([t]) => t);
    // Seeded so a level is the same every time.
    let seed = 1000 + L * 77;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const waves = Math.max(2, Math.min(6, 2 + Math.floor(i / 2) + (w > 0 ? 1 : 0)));
    const plan = [];
    let budget = total * 1.4;
    const perWave = Math.ceil(total / waves);
    const dur = 95 + L * 3;
    let t = 22;
    for (let k = 0; k < waves; k++) {
      const last = k === waves - 1;
      const n = Math.round(perWave * (last ? 1.6 : 1));
      const wave = { at: t, n: [], flag: last };
      for (let j = 0; j < n; j++) {
        const maxIdx = Math.min(pool.length - 1, Math.floor(rnd() * pool.length * (0.6 + k * 0.25 + i * 0.04)));
        wave.n.push(pool[Math.max(0, maxIdx)]);
      }
      plan.push(wave);
      t += dur / waves;
    }
    if (i === 9) plan[plan.length - 1].n.push('giant');
    return { world: w, idx: i, waves: plan, total: plan.reduce((a, p) => a + p.n.length, 0) };
  }

  // ---------- Save ----------
  let save = { done: {}, seen: false, survivalBest: 0, ...Arcade.load('pp:save', {}) };
  const persist = () => Arcade.save('pp:save', save);
  const levelsDone = () => Object.keys(save.done).length;
  const ownedPlants = () => {
    const out = ['pea', 'sun'];
    for (const [lv, id] of Object.entries(UNLOCK_AFTER)) if (save.done[lv]) out.push(id);
    return out;
  };
  const slotsFor = () => 6 + (save.done[9] ? 1 : 0) + (save.done[19] ? 1 : 0) + (save.done[29] ? 1 : 0);
  const boardScore = () => Object.values(save.done).reduce((a, s) => a + s, 0) + save.survivalBest;

  const canvas = $('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay($('overlay'));
  const overlayEl = $('overlay');
  const tone = o => Arcade.tone(o);

  // ---------- Game ----------
  let G = null, state = 'menu', last = performance.now();
  const mouse = { x: -99, y: -99 };
  let chosen = [];

  function startGame(mode, L, seeds) {
    const wd = WORLDS[mode === 'survival' ? 0 : Math.floor(L / 10)];
    const plan = mode === 'survival' ? null : levelPlan(L);
    G = {
      mode, L, world: mode === 'survival' ? { ...wd, name: 'Survival' } : wd, plan,
      t: 0, sun: wd.start + (mode === 'survival' ? 100 : 0), plants: [], zs: [], proj: [], suns: [], fx: [], mowers: Array.from({ length: ROWS }, () => ({ x: GX - 36, on: false, used: false })),
      seeds: seeds.map(id => ({ id, cd: 0 })), sel: null, shovel: false, wave: 0, spawnQ: [], skyT: 5, kills: 0, spawned: 0, over: false, flagT: 0,
      graves: [], banner: null, sunMade: 0, survWave: 0, nextSurv: 25, lost: false, mowersUsed: 0, hint: 0,
    };
    if (G.world.graves) {
      let seed = 4242 + L;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      while (G.graves.length < G.world.graves) {
        const c = 4 + Math.floor(rnd() * 5), r = Math.floor(rnd() * ROWS);
        if (!G.graves.some(g => g.c === c && g.r === r)) G.graves.push({ c, r });
      }
    }
    state = 'play';
    ui.hide();
    G.banner = { text: mode === 'survival' ? 'Survival' : `${G.world.name} · Level ${L % 10 + 1}`, t: 3, sub: 'Plant defenders. Collect sun.' };
  }
  const isWater = r => G.world.water.includes(r);
  const plantAt = (c, r) => G.plants.filter(p => p.c === c && p.r === r);
  const topPlant = (c, r) => plantAt(c, r).find(p => p.type !== 'lily') || plantAt(c, r)[0];

  function canPlace(id, c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    if (G.graves.some(g => g.c === c && g.r === r)) return false;
    const here = plantAt(c, r);
    const water = isWater(r);
    if (id === 'lily') return water && !here.length;
    if (water) { const lily = here.find(p => p.type === 'lily'); if (!lily) return false; return !here.some(p => p.type !== 'lily'); }
    return !here.length;
  }
  function plant(id, c, r) {
    const d = PLANTS[id];
    const p = { type: id, c, r, x: cx(c), hp: d.hp, max: d.hp, t: 0, state: 0, flash: 0, anim: Math.random() * 6 };
    if (id === 'sun') p.t = 6 + Math.random() * 6;
    if (id === 'spud') p.t = 15;
    if (id === 'cherry') p.t = 1.1;
    G.plants.push(p);
  }
  function addSun(x, y, v = 25, fromSky = false) {
    G.suns.push({ x, y, ty: fromSky ? y + 60 + Math.random() * 280 : y + 30, vy: fromSky ? 40 : 0, v, life: 0, fall: fromSky, arc: !fromSky ? Math.random() * 40 - 20 : 0 });
    if (fromSky) G.suns[G.suns.length - 1].y = 80;
  }

  function spawnZ(type, row, x = W + 30) {
    const d = ZOMBIES[type];
    const z = { type, d, row: row ?? Math.floor(Math.random() * ROWS), x, hp: d.hp, max: d.hp, slow: 0, eat: 0, bite: 0, paper: d.paper || 0, hat: d.hat, hopped: false, dir: -1, dig: !!d.dig, flash: 0, anim: Math.random() * 6, dead: false, boss: !!d.giant, stage: 0 };
    if (d.giant) z.x = W + 60;
    G.zs.push(z);
    G.spawned++;
    return z;
  }

  function startWaveSpawns(wv) {
    const n = wv.n.length;
    wv.n.forEach((t, i) => G.spawnQ.push({ t: G.t + i * (wv.flag ? 0.45 : 1.1), type: t, flag: wv.flag && i === 0 }));
    G.spawnQ.sort((a, b) => a.t - b.t);
  }

  // ---------- Update ----------
  function update(dt) {
    G.t += dt;
    for (const s of G.seeds) s.cd = Math.max(0, s.cd - dt);
    // Sky sun.
    if (G.world.sky) { G.skyT -= dt; if (G.skyT <= 0) { G.skyT = 8 + Math.random() * 5; addSun(GX + Math.random() * COLS * CW, 70, 25, true); } }
    // Waves.
    if (G.plan) {
      while (G.wave < G.plan.waves.length && G.t >= G.plan.waves[G.wave].at) {
        const wv = G.plan.waves[G.wave++];
        startWaveSpawns(wv);
        if (wv.flag) { G.banner = { text: 'A huge wave of mudlings is approaching!', t: 3.5, sub: '' }; tone({ freq: 120, to: 80, dur: 1, type: 'sawtooth', vol: 0.06 }); }
      }
    } else {
      // Survival: endless escalating waves.
      if (G.t >= G.nextSurv) {
        G.survWave++; G.nextSurv += Math.max(14, 28 - G.survWave * 0.6);
        const L = Math.min(29, 3 + Math.floor(G.survWave * 1.2));
        const pool = POOL[Math.min(2, Math.floor(G.survWave / 6))].filter(([, f]) => Math.floor(G.survWave / 2) >= f).map(([t]) => t);
        const n = 4 + Math.floor(G.survWave * 1.6);
        const wv = { n: [], flag: G.survWave % 5 === 0 };
        for (let j = 0; j < n; j++) wv.n.push(pool[Math.floor(Math.random() * pool.length)]);
        if (G.survWave % 10 === 0) wv.n.push('giant');
        startWaveSpawns(wv);
        if (wv.flag) G.banner = { text: `Wave ${G.survWave}: a huge wave!`, t: 3, sub: '' };
      }
    }
    while (G.spawnQ.length && G.spawnQ[0].t <= G.t) {
      const q = G.spawnQ.shift();
      let row = Math.floor(Math.random() * ROWS);
      spawnZ(q.type, row);
    }
    // Plants.
    for (const p of G.plants) {
      p.flash = Math.max(0, p.flash - dt);
      p.anim += dt;
      const zRow = G.zs.filter(z => z.row === p.r && !z.dead && !z.dig && z.x > p.x - 10 && z.x < W + 20);
      switch (p.type) {
        case 'sun': p.t -= dt; if (p.t <= 0) { p.t = 24; addSun(p.x, cy(p.r) - 10, 25); } break;
        case 'pea': case 'frost': case 'twin': case 'torch': {
          if (p.type === 'torch') break;
          p.t -= dt;
          if (p.t <= 0 && zRow.length) {
            p.t = p.type === 'twin' ? 1.4 : 1.4;
            const n = p.type === 'twin' ? 2 : 1;
            for (let i = 0; i < n; i++) G.proj.push({ x: p.x + 24 + i * 16, y: cy(p.r) - 10, r: p.r, vx: 310, dmg: 20, snow: p.type === 'frost', fire: false, kind: 'pea', delay: 0 });
            tone({ freq: 500, to: 300, dur: 0.05, type: 'square', vol: 0.012 });
          }
          break;
        }
        case 'lob': {
          p.t -= dt;
          const tgt = G.zs.filter(z => z.row === p.r && !z.dead && !z.dig && z.x > p.x && z.x < W).sort((a, b) => a.x - b.x)[0];
          if (p.t <= 0 && tgt) { p.t = 3.4; G.proj.push({ kind: 'melon', x: p.x, y: cy(p.r) - 30, r: p.r, tx: tgt.x, ty: cy(p.r), t: 0, dur: Math.max(0.5, (tgt.x - p.x) / 280), sx: p.x, dmg: 80 }); }
          break;
        }
        case 'cherry': p.t -= dt; if (p.t <= 0) { explode(p.x, cy(p.r), 130, 1800); p.dead = true; tone({ freq: 90, to: 30, dur: 0.5, type: 'sawtooth', vol: 0.07 }); } break;
        case 'spud': {
          if (p.t > 0) { p.t -= dt; break; }
          const hit = G.zs.find(z => z.row === p.r && !z.dead && !z.dig && Math.abs(z.x - p.x) < 40);
          if (hit) { explode(p.x, cy(p.r), 70, 1800); p.dead = true; tone({ freq: 100, to: 40, dur: 0.3, type: 'sawtooth', vol: 0.06 }); }
          break;
        }
        case 'squash': {
          if (p.state === 0) {
            const hit = G.zs.find(z => z.row === p.r && !z.dead && !z.dig && z.x > p.x - 20 && z.x < p.x + CW * 1.3);
            if (hit) { p.state = 1; p.t = 0.45; p.tx = hit.x; }
          } else {
            p.t -= dt;
            if (p.t <= 0) { explode(p.tx, cy(p.r), 55, 1800); p.dead = true; tone({ freq: 140, to: 60, dur: 0.2, type: 'square', vol: 0.06 }); }
          }
          break;
        }
        case 'chomp': {
          if (p.state === 0) {
            const hit = G.zs.find(z => z.row === p.r && !z.dead && !z.dig && !z.boss && z.x > p.x && z.x < p.x + CW * 1.6);
            if (hit) { p.state = 1; p.t = 0.7; p.target = hit; }
          } else if (p.state === 1) {
            p.t -= dt;
            if (p.t <= 0) { if (p.target && !p.target.dead) { p.target.dead = true; G.kills++; fxBurst(p.target.x, cy(p.r), '#c15bd8'); } p.state = 2; p.t = 40; tone({ freq: 200, to: 60, dur: 0.3, type: 'sawtooth', vol: 0.05 }); }
          } else { p.t -= dt; if (p.t <= 0) p.state = 0; }
          break;
        }
        case 'thorn': {
          p.t -= dt;
          if (p.t <= 0) { p.t = 0.5; for (const z of G.zs) if (z.row === p.r && !z.dead && !z.dig && Math.abs(z.x - p.x) < 38) hurtZ(z, 20); }
          break;
        }
      }
    }
    // Torches light peas.
    for (const pr of G.proj) {
      if (pr.kind !== 'pea' || pr.fire) continue;
      for (const t of G.plants) if (t.type === 'torch' && t.r === pr.r && pr.x >= t.x - 10 && pr.x <= t.x + 20) { pr.fire = true; pr.snow = false; pr.dmg = 40; }
    }
    G.plants = G.plants.filter(p => !p.dead && p.hp > 0 || (p.hp <= 0 && false));
    // Projectiles.
    for (const pr of G.proj) {
      if (pr.kind === 'pea') {
        pr.x += pr.vx * dt;
        if (pr.x > W + 20) { pr.dead = true; continue; }
        const z = G.zs.find(z => z.row === pr.r && !z.dead && !z.dig && Math.abs(z.x - pr.x) < 22);
        if (z) { hurtZ(z, pr.dmg); if (pr.snow) z.slow = 4; if (pr.fire) z.slow = 0; pr.dead = true; fxBurst(pr.x, pr.y, pr.fire ? '#ff9a3d' : pr.snow ? '#8fe3ff' : '#9ae37a', 3); tone({ freq: 220, dur: 0.03, type: 'sine', vol: 0.012 }); }
      } else if (pr.kind === 'melon') {
        pr.t += dt;
        const k = Math.min(1, pr.t / pr.dur);
        pr.x = pr.sx + (pr.tx - pr.sx) * k;
        pr.y = cy(pr.r) - 30 - Math.sin(k * Math.PI) * 120;
        if (k >= 1) { pr.dead = true; explode(pr.tx, cy(pr.r), 45, pr.dmg); }
      }
    }
    G.proj = G.proj.filter(p => !p.dead);
    // Mudlings.
    for (const z of G.zs) {
      if (z.dead) continue;
      z.flash = Math.max(0, z.flash - dt); z.anim += dt;
      if (z.slow > 0) z.slow -= dt;
      const sp = z.d.spd * (z.slow > 0 ? 0.5 : 1) * (z.paper === -1 ? 2.2 : 1);
      if (z.dig) {
        z.x -= 46 * dt * (z.slow > 0 ? 0.5 : 1);
        if (z.x < GX + CW * 1.2) { z.dig = false; z.dir = 1; z.x = GX + CW * 0.8; fxBurst(z.x, cy(z.row), '#8a6a3a', 10); }
        continue;
      }
      // What is in front?
      const frontC = colOf(z.x + (z.dir < 0 ? -18 : 18));
      let target = null;
      if (frontC >= 0 && frontC < COLS) {
        const here = plantAt(frontC, z.row).filter(p => p.type !== 'thorn' || true);
        target = here.find(p => p.type !== 'lily') || here[0] || null;
        if (target && (target.type === 'thorn')) target = target; // zombies chew thorns too
        if (target && target.type === 'spud' && target.t > 0) target = target; // unarmed mines get eaten
      }
      if (z.d.hop && !z.hopped && target && z.dir < 0) {
        z.hopped = true; z.x -= CW * 1.2; z.d = { ...z.d, spd: 17 }; fxBurst(z.x, cy(z.row), '#bbb', 4); continue;
      }
      const stomp = z.d.giant;
      if (target) {
        z.eat = 1;
        z.bite -= dt;
        if (stomp) { if (z.bite <= 0) { z.bite = 0.9; target.hp = 0; fxBurst(target.x, cy(z.row), '#6b4a2a', 8); tone({ freq: 70, to: 40, dur: 0.2, type: 'sawtooth', vol: 0.05 }); } }
        else { target.hp -= 100 * dt; target.flash = 0.1; }
        if (target.hp <= 0) target.dead = true;
      } else {
        z.eat = 0;
        z.x += z.dir * sp * dt;
      }
      if (z.dir > 0 && z.x > GX + COLS * CW) z.dead = true;
      // Lawn mower and the house.
      if (z.dir < 0 && z.x < GX - 10) {
        const m = G.mowers[z.row];
        if (!m.used && !m.on) { m.on = true; m.used = true; G.mowersUsed++; tone({ freq: 120, to: 220, dur: 0.6, type: 'sawtooth', vol: 0.05 }); }
        else if (!m.on && !G.lost) { G.lost = true; lose(); }
      }
      if (z.boss) {
        const f = z.hp / z.max;
        if (z.stage === 0 && f < 0.66) { z.stage = 1; spawnZ('basic', z.row, z.x - 10); spawnZ('cone', (z.row + 1) % ROWS, z.x - 10); }
        if (z.stage === 1 && f < 0.33) { z.stage = 2; spawnZ('bucket', z.row, z.x - 10); spawnZ('basic', (z.row + ROWS - 1) % ROWS, z.x - 10); }
      }
    }
    // Mowers.
    for (const m of G.mowers) if (m.on) {
      m.x += 360 * dt;
      const r = G.mowers.indexOf(m);
      for (const z of G.zs) if (!z.dead && z.row === r && Math.abs(z.x - m.x) < 34 && z.dir !== 1 || (!z.dead && z.row === r && Math.abs(z.x - m.x) < 34)) { z.dead = true; G.kills++; fxBurst(z.x, cy(r), '#6b4a2a', 6); }
      if (m.x > W + 40) m.on = false;
    }
    // Reap.
    for (const z of G.zs) if (z.hp <= 0 && !z.dead) { z.dead = true; G.kills++; fxBurst(z.x, cy(z.row), '#6b4a2a', 8); if (z.boss) Arcade.flag('petal-patrol-giant'); }
    G.zs = G.zs.filter(z => !z.dead);
    G.plants = G.plants.filter(p => !p.dead);
    // Suns.
    for (const s of G.suns) {
      s.life += dt;
      if (s.fall) { s.y += s.vy * dt; if (s.y >= s.ty) { s.y = s.ty; s.fall = false; s.life = 0; } }
      else if (s.arc) { s.x += s.arc * dt; s.arc *= 0.95; }
      if (!s.fall && s.life > 7) { s.pull = true; }
      if (s.pull) { s.x += (68 - s.x) * Math.min(1, dt * 6); s.y += (34 - s.y) * Math.min(1, dt * 6); if (Math.hypot(s.x - 68, s.y - 34) < 14) { G.sun += s.v; s.dead = true; } }
    }
    G.suns = G.suns.filter(s => !s.dead);
    for (const f of G.fx) { f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 300 * dt; }
    G.fx = G.fx.filter(f => f.life > 0);
    if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
    // Victory.
    if (G.plan && G.wave >= G.plan.waves.length && !G.spawnQ.length && !G.zs.length && !G.lost && state === 'play') win();
  }

  function hurtZ(z, d) {
    if (z.paper > 0) { z.paper -= d; if (z.paper <= 0) { z.paper = -1; fxBurst(z.x, cy(z.row), '#eee', 6); } d *= 0.2; }
    z.hp -= d; z.flash = 0.08;
    if (z.hat && z.hp < z.max * 0.4) z.hat = null;
  }
  function explode(x, y, r, dmg) {
    G.fx.push({ k: 'boom', x, y, vx: 0, vy: -1000, life: 0.4, max: 0.4, r });
    for (const z of G.zs) if (!z.dead && Math.hypot(z.x - x, cy(z.row) - y) < r + 20) hurtZ(z, z.boss ? dmg * 0.5 : dmg);
    for (let i = 0; i < 14; i++) fxBurst(x, y, '#ffb03d', 1);
  }
  function fxBurst(x, y, color, n = 5) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = 40 + Math.random() * 120; G.fx.push({ k: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5, max: 0.5, color }); }
  }

  // ---------- Ending ----------
  function levelScore() { return Math.round(G.kills * 10 + G.sun / 5 + (ROWS - G.mowersUsed) * 150 + 500 + G.L * 30); }
  function win() {
    state = 'over';
    const score = levelScore();
    const first = !save.done[G.L];
    if ((save.done[G.L] || 0) < score) save.done[G.L] = score;
    persist();
    Arcade.flag('petal-patrol-clear');
    if (G.mowersUsed === 0) Arcade.flag('petal-patrol-clean');
    if (G.L === 9 || G.L === 19 || G.L === 29) Arcade.flag('petal-patrol-world');
    if (levelsDone() >= 30) Arcade.flag('petal-patrol-all');
    tone({ freq: 523, to: 1046, dur: 0.7, type: 'triangle', vol: 0.07 });
    const unlock = first && UNLOCK_AFTER[G.L] ? PLANTS[UNLOCK_AFTER[G.L]] : null;
    const next = G.L < 29 ? G.L + 1 : null;
    Arcade.finish(ui, {
      score: boardScore(), title: `Level ${G.L + 1} cleared`,
      html: `<p>${G.kills} mudlings stopped · ${G.mowersUsed ? G.mowersUsed + ' mower' + (G.mowersUsed > 1 ? 's' : '') + ' used' : 'no mowers used'} · level score ${score.toLocaleString()}</p>
        ${unlock ? `<p class="new-best">New plant: ${unlock.name}!</p><p class="pp-note">${unlock.desc}</p>` : ''}
        <div class="pp-row"><button class="btn secondary" data-act="levels" type="button">Levels</button></div>`,
      button: next !== null ? 'Next level' : 'Menu',
      onAction: () => (next !== null ? seedPick(next) : showMenu()),
    });
  }
  function lose() {
    state = 'over';
    tone({ freq: 200, to: 40, dur: 1, type: 'sawtooth', vol: 0.08 });
    if (G.mode === 'survival') {
      const sc = G.survWave * 100 + G.kills * 10;
      if (sc > save.survivalBest) save.survivalBest = sc;
      persist();
      Arcade.finish(ui, { score: boardScore(), title: 'The mudlings got in', html: `<p>Survived ${G.survWave} waves · ${G.kills} mudlings stopped · run score ${sc.toLocaleString()}</p><div class="pp-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>`, button: 'Try again', onAction: () => seedPick(null) });
    } else {
      Arcade.finish(ui, { score: boardScore(), title: 'The mudlings got in', html: `<p>${G.kills} mudlings stopped. Rearrange your defenders and go again.</p><div class="pp-row"><button class="btn secondary" data-act="levels" type="button">Levels</button></div>`, button: 'Try again', onAction: () => startGame(G.mode, G.L, G.seeds.map(s => s.id)) });
    }
  }

  // ---------- Drawing ----------
  function drawPlantShape(id, x, y, p = {}) {
    const d = PLANTS[id];
    const bob = Math.sin((p.anim || 0) * 3) * 1.5;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(0, 28, 22, 7, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#1b3a14'; ctx.lineWidth = 2;
    const stem = (h = 26) => { ctx.strokeStyle = '#2f8a3a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 28); ctx.lineTo(0, 28 - h); ctx.stroke(); ctx.strokeStyle = '#1b3a14'; ctx.lineWidth = 2; };
    const head = (r, col, dx = 0, dy = 0) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(dx, dy, r, 0, TAU); ctx.fill(); ctx.stroke(); };
    const face = (dx = 0, dy = 0) => { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(dx - 5, dy - 2, 2.2, 0, TAU); ctx.arc(dx + 5, dy - 2, 2.2, 0, TAU); ctx.fill(); };
    switch (id) {
      case 'pea': case 'frost': case 'twin': stem(); ctx.translate(0, bob); head(17, d.color, 0, -10); ctx.fillStyle = id === 'frost' ? '#5ac4e8' : '#3a9a46'; ctx.beginPath(); ctx.arc(19, -8, 8, 0, TAU); ctx.fill(); ctx.stroke(); face(0, -10); if (id === 'twin') { ctx.beginPath(); ctx.arc(19, 6, 7, 0, TAU); ctx.fillStyle = '#2f7a3a'; ctx.fill(); ctx.stroke(); } break;
      case 'sun': stem(); ctx.translate(0, bob); for (let i = 0; i < 10; i++) { const a = i * TAU / 10 + (p.anim || 0) * 0.5; ctx.fillStyle = '#ffb81c'; ctx.beginPath(); ctx.ellipse(Math.cos(a) * 20, -10 + Math.sin(a) * 20, 8, 4, a, 0, TAU); ctx.fill(); } head(14, '#ffd23f', 0, -10); face(0, -10); ctx.strokeStyle = '#7a4a00'; ctx.beginPath(); ctx.arc(0, -6, 5, 0.2, Math.PI - 0.2); ctx.stroke(); break;
      case 'wall': ctx.fillStyle = d.color; ctx.beginPath(); ctx.ellipse(0, 0, 24, 30, 0, 0, TAU); ctx.fill(); ctx.stroke(); face(0, -6); ctx.strokeStyle = '#6b4a1a'; ctx.beginPath(); ctx.arc(0, 8, 7, 0.3, Math.PI - 0.3); ctx.stroke(); if (p.hp !== undefined && p.hp < p.max * 0.5) { ctx.beginPath(); ctx.moveTo(-10, -20); ctx.lineTo(-2, -6); ctx.lineTo(-12, 4); ctx.stroke(); } break;
      case 'cherry': ctx.strokeStyle = '#2f6a2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.quadraticCurveTo(0, -30, 12, 0); ctx.stroke(); ctx.lineWidth = 2; for (const dx of [-14, 14]) { ctx.fillStyle = d.color; ctx.strokeStyle = '#4a0a14'; ctx.beginPath(); ctx.arc(dx, 6, 14, 0, TAU); ctx.fill(); ctx.stroke(); face(dx, 6); } break;
      case 'spud': ctx.fillStyle = (p.t > 0) ? '#8a6a3a' : d.color; ctx.beginPath(); ctx.ellipse(0, 16, 22, 12, 0, Math.PI, 0); ctx.fill(); ctx.stroke(); if (!(p.t > 0)) { ctx.fillStyle = '#e0344f'; ctx.beginPath(); ctx.arc(0, 2, 4, 0, TAU); ctx.fill(); ctx.strokeStyle = '#e0344f'; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -14); ctx.stroke(); } break;
      case 'chomp': stem(22); ctx.translate(0, bob); { const open = p.state === 1 ? 0.2 : p.state === 2 ? 0 : 0.6 + Math.sin((p.anim || 0) * 4) * 0.1; ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(0, -12, 20, -0.4 - open, Math.PI * 1.4 + 0.4); ctx.lineTo(0, -12); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(10, -22); ctx.lineTo(18, -14); ctx.lineTo(12, -8); ctx.fill(); } break;
      case 'squash': ctx.translate(0, p.state === 1 ? -30 : 0); ctx.fillStyle = d.color; ctx.beginPath(); ctx.ellipse(0, 4, 20, 26, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#2f6a2a'; ctx.fillRect(-4, -24, 8, 8); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(-3, 0); ctx.moveTo(12, -4); ctx.lineTo(3, 0); ctx.stroke(); break;
      case 'thorn': ctx.fillStyle = d.color; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 12 - 6, 26); ctx.lineTo(i * 12, 8); ctx.lineTo(i * 12 + 6, 26); ctx.closePath(); ctx.fill(); ctx.stroke(); } break;
      case 'lob': stem(18); ctx.translate(0, bob); head(18, '#3aa84a', 0, -8); ctx.fillStyle = '#7acb4a'; ctx.beginPath(); ctx.arc(14, -22, 11, 0, TAU); ctx.fill(); ctx.stroke(); face(0, -8); break;
      case 'torch': ctx.fillStyle = '#7a4a1a'; ctx.beginPath(); ctx.ellipse(0, 6, 20, 24, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#ff8a3a'; ctx.beginPath(); ctx.moveTo(-10, -12); ctx.quadraticCurveTo(0, -42 + Math.sin((p.anim || 0) * 8) * 4, 10, -12); ctx.fill(); ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(-5, -12); ctx.quadraticCurveTo(0, -28, 5, -12); ctx.fill(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-6, 2, 2, 0, TAU); ctx.arc(6, 2, 2, 0, TAU); ctx.fill(); break;
      case 'lily': ctx.fillStyle = d.color; ctx.beginPath(); ctx.ellipse(0, 22, 30, 11, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(30, 18); ctx.lineTo(30, 26); ctx.fill(); break;
    }
    ctx.restore();
  }
  function drawZombie(z) {
    const x = z.x, y = cy(z.row);
    const wob = Math.sin(z.anim * 4) * 3 * (z.eat ? 0 : 1);
    ctx.save(); ctx.translate(x, y + 6 + (z.dig ? 12 : 0));
    if (z.dir > 0) ctx.scale(-1, 1);
    if (z.boss) ctx.scale(1.9, 1.9);
    if (z.dig) { ctx.fillStyle = '#6b4a2a'; ctx.beginPath(); ctx.ellipse(0, 18, 26, 8, 0, 0, TAU); ctx.fill(); ctx.restore(); return; }
    if (isWater(z.row)) { ctx.fillStyle = 'rgba(80,160,255,.6)'; ctx.beginPath(); ctx.ellipse(0, 20, 28, 10, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#e04a4a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(0, 18, 20, 7, 0, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(0, 30, 20, 6, 0, 0, TAU); ctx.fill();
    const col = z.flash > 0 ? '#fff' : '#8aa57a';
    ctx.strokeStyle = '#1f2a18'; ctx.lineWidth = 2;
    // Legs.
    ctx.fillStyle = '#3a4a6a'; ctx.fillRect(-10, 8 + wob * 0.3, 8, 20); ctx.fillRect(3, 8 - wob * 0.3, 8, 20);
    // Body.
    ctx.fillStyle = z.flash > 0 ? '#fff' : '#6a5a8a'; ctx.beginPath(); ctx.roundRect(-14, -14, 28, 28, 6); ctx.fill(); ctx.stroke();
    // Arms.
    ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(-30, -2 + (z.eat ? Math.sin(z.anim * 14) * 5 : wob)); ctx.stroke();
    ctx.strokeStyle = '#1f2a18'; ctx.lineWidth = 2;
    // Head.
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -26, 14, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-5, -28, 3.6, 0, TAU); ctx.arc(5, -28, 3.6, 0, TAU); ctx.fill(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-6, -28, 1.5, 0, TAU); ctx.arc(4, -28, 1.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-5, -19); ctx.lineTo(5, -19); ctx.stroke();
    if (z.hat === 'cone') { ctx.fillStyle = '#e8803a'; ctx.beginPath(); ctx.moveTo(-12, -34); ctx.lineTo(0, -62); ctx.lineTo(12, -34); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    if (z.hat === 'bucket') { ctx.fillStyle = '#aab3c0'; ctx.fillRect(-13, -50, 26, 20); ctx.strokeRect(-13, -50, 26, 20); ctx.fillRect(-15, -32, 30, 4); }
    if (z.hat === 'helmet') { ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(0, -28, 16, Math.PI, 0); ctx.fill(); ctx.stroke(); }
    if (z.paper > 0) { ctx.fillStyle = '#efe6c8'; ctx.fillRect(-38, -16, 20, 26); ctx.strokeRect(-38, -16, 20, 26); ctx.fillStyle = '#555'; for (let i = 0; i < 4; i++) ctx.fillRect(-35, -12 + i * 6, 14, 2); }
    if (z.slow > 0) { ctx.fillStyle = 'rgba(143,227,255,.35)'; ctx.fillRect(-20, -50, 40, 80); }
    if (z.boss || z.hp < z.max) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-18, -66, 36, 4); ctx.fillStyle = z.boss ? '#ff5d5d' : '#7be36a'; ctx.fillRect(-18, -66, 36 * Math.max(0, z.hp / z.max), 4); }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!G) { ctx.fillStyle = '#10131a'; ctx.fillRect(0, 0, W, H); return; }
    // Lawn.
    ctx.fillStyle = '#27472a'; ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = isWater(r) ? ((r + c) % 2 ? '#3d8ec9' : '#3683bd') : ((r + c) % 2 ? G.world.c1 : G.world.c2);
      ctx.fillRect(GX + c * CW, GY + r * CH, CW, CH);
    }
    // House edge.
    ctx.fillStyle = '#5a4630'; ctx.fillRect(0, 70, GX - 42, H - 70); ctx.fillStyle = '#7a5e3e'; ctx.fillRect(0, 70, GX - 46, 14);
    ctx.fillStyle = '#e8d9b0'; for (let r = 0; r < ROWS; r++) { ctx.fillRect(14, GY + r * CH + 22, 40, 46); ctx.fillStyle = '#8fb8e8'; ctx.fillRect(20, GY + r * CH + 28, 28, 34); ctx.fillStyle = '#e8d9b0'; }
    // Hover and ghost.
    const hc = colOf(mouse.x), hr = Math.floor((mouse.y - GY) / CH);
    if (G.sel !== null && hc >= 0 && hc < COLS && hr >= 0 && hr < ROWS) {
      const id = G.seeds[G.sel].id;
      const ok = canPlace(id, hc, hr);
      ctx.fillStyle = ok ? 'rgba(255,255,255,.22)' : 'rgba(255,60,60,.25)'; ctx.fillRect(GX + hc * CW, GY + hr * CH, CW, CH);
      ctx.globalAlpha = 0.6; drawPlantShape(id, cx(hc), cy(hr), {}); ctx.globalAlpha = 1;
    } else if (G.shovel && hc >= 0 && hc < COLS && hr >= 0 && hr < ROWS && topPlant(hc, hr)) { ctx.fillStyle = 'rgba(255,200,60,.35)'; ctx.fillRect(GX + hc * CW, GY + hr * CH, CW, CH); }
    // Graves.
    for (const g of G.graves) { const x = cx(g.c), y = cy(g.r); ctx.fillStyle = '#8b93a3'; ctx.beginPath(); ctx.roundRect(x - 18, y - 22, 36, 48, [18, 18, 3, 3]); ctx.fill(); ctx.strokeStyle = '#2a2f3a'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#5c6474'; ctx.fillRect(x - 3, y - 12, 6, 22); ctx.fillRect(x - 9, y - 6, 18, 5); }
    // Mowers.
    G.mowers.forEach((m, r) => { if (m.used && !m.on) return; const y = cy(r) + 14; ctx.fillStyle = '#d9382c'; ctx.beginPath(); ctx.roundRect(m.x - 18, y - 14, 36, 24, 5); ctx.fill(); ctx.strokeStyle = '#2a0a08'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(m.x - 10, y + 12, 6, 0, TAU); ctx.arc(m.x + 10, y + 12, 6, 0, TAU); ctx.fill(); ctx.fillStyle = '#ddd'; ctx.fillRect(m.x - 22, y - 22, 5, 14); });
    // Draw rows in order so things overlap right.
    for (let r = 0; r < ROWS; r++) {
      for (const p of G.plants) if (p.r === r && p.type === 'lily') drawPlantShape('lily', p.x, cy(r), p);
      for (const p of G.plants) if (p.r === r && p.type !== 'lily') {
        if (p.type === 'chomp' && p.state === 1 && p.target) { /* chomping */ }
        ctx.globalAlpha = p.flash > 0 ? 0.7 : 1;
        drawPlantShape(p.type, p.x, cy(r), p);
        ctx.globalAlpha = 1;
        if (p.hp < p.max && p.type !== 'cherry') { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(p.x - 18, cy(r) + 34, 36, 4); ctx.fillStyle = '#7be36a'; ctx.fillRect(p.x - 18, cy(r) + 34, 36 * Math.max(0, p.hp / p.max), 4); }
      }
      for (const z of G.zs) if (z.row === r) drawZombie(z);
    }
    for (const pr of G.proj) {
      if (pr.kind === 'pea') { ctx.fillStyle = pr.fire ? '#ff8a3a' : pr.snow ? '#8fe3ff' : '#7be36a'; ctx.strokeStyle = '#1b3a14'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pr.x, pr.y, 7, 0, TAU); ctx.fill(); ctx.stroke(); if (pr.fire) { ctx.fillStyle = 'rgba(255,200,60,.6)'; ctx.beginPath(); ctx.arc(pr.x - 8, pr.y, 5, 0, TAU); ctx.fill(); } }
      else { ctx.fillStyle = '#7acb4a'; ctx.strokeStyle = '#1b3a14'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pr.x, pr.y, 12, 0, TAU); ctx.fill(); ctx.stroke(); ctx.strokeStyle = '#2f7a2a'; ctx.beginPath(); ctx.moveTo(pr.x - 8, pr.y - 6); ctx.lineTo(pr.x + 8, pr.y + 6); ctx.stroke(); }
    }
    for (const f of G.fx) { const k = f.life / f.max; if (f.k === 'boom') { ctx.fillStyle = `rgba(255,170,60,${k * 0.7})`; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.2 - k * 0.2), 0, TAU); ctx.fill(); } else { ctx.globalAlpha = k; ctx.fillStyle = f.color; ctx.fillRect(f.x - 2, f.y - 2, 4, 4); ctx.globalAlpha = 1; } }
    // Suns.
    for (const s of G.suns) { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(G.t); ctx.fillStyle = '#ffd23f'; ctx.shadowColor = '#ffb81c'; ctx.shadowBlur = 14; for (let i = 0; i < 8; i++) { ctx.rotate(TAU / 8); ctx.fillRect(14, -2, 8, 4); } ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; ctx.restore(); }
    drawHud();
  }
  function drawHud() {
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(0, 0, W, 68);
    ctx.fillStyle = '#e8d9b0'; ctx.fillRect(6, 6, 124, 56); ctx.strokeStyle = '#5a4630'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, 124, 56);
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(34, 34, 14, 0, TAU); ctx.fill(); ctx.strokeStyle = '#b07a00'; ctx.stroke();
    ctx.fillStyle = '#3a2a1a'; ctx.font = 'bold 24px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(Math.floor(G.sun), 90, 36);
    G.seeds.forEach((s, i) => {
      const d = PLANTS[s.id], x = 140 + i * 72, y = 6, w = 66, h = 56;
      const afford = G.sun >= d.cost && s.cd <= 0;
      ctx.fillStyle = G.sel === i ? '#fff2b0' : '#e8d9b0'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = G.sel === i ? '#ffb81c' : '#5a4630'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x + w / 2, y + 22); ctx.scale(0.62, 0.62); ctx.translate(-(x + w / 2), -(y + 22)); drawPlantShape(s.id, x + w / 2, y + 22, { t: 1, hp: 1, max: 1 }); ctx.restore();
      ctx.fillStyle = '#3a2a1a'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(d.cost, x + w / 2, y + h - 8);
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left'; ctx.fillText(i + 1, x + 4, y + 9);
      if (s.cd > 0) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x, y, w, h * (s.cd / d.cd)); }
      else if (!afford) { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x, y, w, h); }
    });
    // Shovel.
    ctx.fillStyle = G.shovel ? '#fff2b0' : '#e8d9b0'; ctx.fillRect(W - 70, 6, 64, 56); ctx.strokeStyle = G.shovel ? '#ffb81c' : '#5a4630'; ctx.lineWidth = 3; ctx.strokeRect(W - 70, 6, 64, 56);
    ctx.fillStyle = '#8a8f9a'; ctx.beginPath(); ctx.moveTo(W - 48, 16); ctx.lineTo(W - 28, 16); ctx.lineTo(W - 30, 36); ctx.lineTo(W - 46, 36); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#7a4a1a'; ctx.fillRect(W - 40, 36, 4, 20);
    // Progress.
    const prog = G.plan ? Math.min(1, (G.t - 0) / (G.plan.waves[G.plan.waves.length - 1].at + 20)) : 0;
    if (G.plan) {
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W - 230, H - 22, 210, 10);       ctx.fillStyle = '#7be36a'; ctx.fillRect(W - 230, H - 22, 210 * prog, 10);
      ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.textAlign = 'right'; ctx.fillText(`Wave ${Math.min(G.wave, G.plan.waves.length)}/${G.plan.waves.length} · ${G.zs.length} on the lawn`, W - 20, H - 30);
    } else { ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'right'; ctx.fillText(`Wave ${G.survWave} · ${G.kills} stopped`, W - 20, H - 14); }
    if (G.banner) { ctx.globalAlpha = Math.min(1, G.banner.t); ctx.font = 'bold 28px system-ui'; ctx.textAlign = 'center'; ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.fillStyle = '#fff'; ctx.strokeText(G.banner.text, W / 2, 300); ctx.fillText(G.banner.text, W / 2, 300); if (G.banner.sub) { ctx.font = '16px system-ui'; ctx.lineWidth = 4; ctx.strokeText(G.banner.sub, W / 2, 332); ctx.fillText(G.banner.sub, W / 2, 332); } ctx.globalAlpha = 1; }
    if (state === 'paused') { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- Input ----------
  function toField(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
  canvas.addEventListener('pointermove', e => { const p = toField(e); mouse.x = p.x; mouse.y = p.y; });
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); if (G) { G.sel = null; G.shovel = false; } });
  canvas.addEventListener('pointerdown', e => {
    if (!G || state !== 'play') return;
    const p = toField(e); mouse.x = p.x; mouse.y = p.y;
    // Suns first.
    for (const s of G.suns) if (!s.pull && Math.hypot(s.x - p.x, s.y - p.y) < 28) { s.pull = true; tone({ freq: 800, to: 1200, dur: 0.08, type: 'triangle', vol: 0.04 }); return; }
    // Seed bar.
    if (p.y < 68) {
      const i = Math.floor((p.x - 140) / 72);
      if (i >= 0 && i < G.seeds.length && p.x - 140 - i * 72 < 66) pickSeed(i);
      else if (p.x > W - 70) { G.shovel = !G.shovel; G.sel = null; }
      return;
    }
    const c = colOf(p.x), r = Math.floor((p.y - GY) / CH);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    if (G.shovel) {
      const t = topPlant(c, r);
      if (t) { G.sun += Math.floor(PLANTS[t.type].cost * 0.5); t.dead = true; G.shovel = false; tone({ freq: 300, to: 150, dur: 0.1, type: 'square', vol: 0.04 }); }
      return;
    }
    if (G.sel !== null) {
      const s = G.seeds[G.sel], d = PLANTS[s.id];
      if (canPlace(s.id, c, r) && G.sun >= d.cost && s.cd <= 0) {
        G.sun -= d.cost; s.cd = d.cd; plant(s.id, c, r); G.sel = null;
        tone({ freq: 330, to: 520, dur: 0.1, type: 'triangle', vol: 0.05 });
      } else tone({ freq: 140, dur: 0.07, type: 'square', vol: 0.03 });
    }
  });
  function pickSeed(i) {
    const s = G.seeds[i];
    if (!s) return;
    if (G.sun < PLANTS[s.id].cost || s.cd > 0) { tone({ freq: 140, dur: 0.07, type: 'square', vol: 0.03 }); return; }
    G.sel = G.sel === i ? null : i; G.shovel = false;
  }
  addEventListener('keydown', e => {
    if (!G || e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'play' || state === 'paused') pauseToggle(); return; }
    if (state !== 'play') return;
    if (/^Digit[1-9]$/.test(e.code)) pickSeed(+e.code.slice(5) - 1);
    else if (e.code === 'KeyS') { G.shovel = !G.shovel; G.sel = null; }
  });
  function pauseToggle() {
    if (state === 'play') { state = 'paused'; ui.show({ title: 'Paused', html: '<div class="pp-row"><button class="btn secondary" data-act="menu" type="button">Quit</button></div>', button: 'Resume', onAction: pauseToggle }); }
    else if (state === 'paused') { state = 'play'; ui.hide(); last = performance.now(); }
  }
  Arcade.onBlur(() => { if (state === 'play') pauseToggle(); });

  // ---------- Menus ----------
  function showMenu() {
    state = 'menu'; G = null;
    ui.show({
      title: 'Pixel Pioneers Arcade',
      html: `<h2 class="pp-title">PETAL PATROL</h2><p class="pp-note">Plant. Defend. Don't let them reach the house.</p>
        <div class="pp-menu">
          <button class="btn" data-act="levels" type="button">Adventure · ${levelsDone()}/30</button>
          <button class="btn secondary" data-act="survival" type="button">Survival${save.survivalBest ? ' · best ' + save.survivalBest.toLocaleString() : ''}</button>
          <button class="btn secondary" data-act="almanac" type="button">Plant almanac</button>
          <button class="btn secondary" data-act="howto" type="button">How to play</button>
        </div>`,
      button: null,
    });
  }
  function showHowTo() {
    ui.show({
      title: 'How to play',
      html: `<ul style="text-align:left"><li><b>Click sun</b> as it falls or pops out of Sunbloom (it also drifts to you after a few seconds).</li>
        <li>Pick a seed packet (<b>1–9</b>), then click a square to plant it. Each packet takes time to recharge.</li>
        <li>Mudlings eat your plants. A <b>lawn mower</b> in each lane gives one last sweep, but only once.</li>
        <li><b>Shovel</b> (<b>S</b>) digs up a plant. Spud Mines need time to arm. Diggers come from behind.</li>
        <li>The <b>Moonlit Lawn</b> has no sky sun, only Sunbloom. The <b>Pond</b> needs a Lily Pad under anything planted on water.</li>
        <li>Clear levels to unlock new plants and bigger seed trays. A Mud Giant ends every world.</li></ul>
        <div class="pp-row"><button class="btn" data-act="menu" type="button">Got it</button></div>`, button: null,
    });
  }
  function showLevels() {
    state = 'menu';
    const worlds = WORLDS.map((wd, w) => {
      const btns = Array.from({ length: 10 }, (_, i) => {
        const L = w * 10 + i, ok = L === 0 || save.done[L - 1] !== undefined, done = save.done[L] !== undefined;
        return `<button class="pp-lv ${done ? 'done' : ''}" data-act="level" data-l="${L}" type="button" ${ok ? '' : 'disabled'}>${ok ? (i === 9 ? '★' : i + 1) : '🔒'}<small>${done ? '✔' : ''}</small></button>`;
      }).join('');
      return `<div class="pp-world"><h3>${w + 1}. ${wd.name}</h3><div class="pp-lvs">${btns}</div></div>`;
    }).join('');
    ui.show({ title: 'Adventure', html: `<div class="pp-top"><button class="btn secondary" data-act="menu" type="button">← Menu</button><span>${boardScore().toLocaleString()} points</span></div>${worlds}`, button: null });
  }
  function showAlmanac() {
    const own = ownedPlants();
    const cards = PLANT_IDS.map(id => `<div class="pp-card ${own.includes(id) ? '' : 'off'}"><b>${own.includes(id) ? PLANTS[id].name : '???'}</b><small>${own.includes(id) ? PLANTS[id].desc : 'Not found yet'}</small><span>${own.includes(id) ? '☀ ' + PLANTS[id].cost : ''}</span></div>`).join('');
    ui.show({ title: 'Plant almanac', html: `<div class="pp-top"><button class="btn secondary" data-act="menu" type="button">← Menu</button></div><div class="pp-cards">${cards}</div>`, button: null });
  }
  // Seed picker: choose which plants to bring.
  let pickMode = null, pickLevel = null;
  function seedPick(L, mode = L === null ? 'survival' : 'adventure') {
    pickMode = mode; pickLevel = L;
    const own = ownedPlants();
    const slots = slotsFor();
    chosen = chosen.filter(id => own.includes(id));
    if (!chosen.length) chosen = own.slice(0, slots);
    // The pond needs lily pads: add one if we have it.
    if (mode === 'adventure' && Math.floor(L / 10) === 2 && own.includes('lily') && !chosen.includes('lily')) chosen = [...chosen.slice(0, slots - 1), 'lily'];
    if (own.length <= slots) { chosen = [...own]; if (mode === 'adventure' && L === 0 && false) { } }
    renderSeedPick();
  }
  function renderSeedPick() {
    const own = ownedPlants(), slots = slotsFor();
    const cards = own.map(id => `<button class="pp-card ${chosen.includes(id) ? 'on' : ''}" data-act="seed" data-id="${id}" type="button"><b>${PLANTS[id].name}</b><small>${PLANTS[id].desc}</small><span>☀ ${PLANTS[id].cost}</span></button>`).join('');
    const title = pickMode === 'survival' ? 'Survival' : `${WORLDS[Math.floor(pickLevel / 10)].name} · Level ${pickLevel % 10 + 1}`;
    ui.show({ title, html: `<div class="pp-top"><button class="btn secondary" data-act="${pickMode === 'survival' ? 'menu' : 'levels'}" type="button">← Back</button><span>Pick up to ${slots} plants (${chosen.length}/${slots})</span></div><div class="pp-cards">${cards}</div><div class="pp-row"><button class="btn" data-act="begin" type="button" ${chosen.length ? '' : 'disabled'}>Let's rock!</button></div>`, button: null });
  }
  overlayEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'menu': showMenu(); break;
      case 'levels': showLevels(); break;
      case 'survival': seedPick(null, 'survival'); break;
      case 'almanac': showAlmanac(); break;
      case 'howto': showHowTo(); break;
      case 'level': seedPick(+d.l, 'adventure'); break;
      case 'seed': {
        const slots = slotsFor();
        if (chosen.includes(d.id)) chosen = chosen.filter(x => x !== d.id);
        else if (chosen.length < slots) chosen.push(d.id);
        renderSeedPick();
        break;
      }
      case 'begin': startGame(pickMode === 'survival' ? 'survival' : 'adventure', pickLevel ?? 0, chosen); break;
    }
  });

  // ---------- Loop ----------
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G && state === 'play') update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  showMenu();
  if (!save.seen) { save.seen = true; persist(); showHowTo(); }
  requestAnimationFrame(frame);
})();
