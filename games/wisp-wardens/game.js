/* Wisp Wardens: a tower defense. Wisps walk the road in layers; pop a layer and what's inside spills out.
   Eight towers with two upgrade paths each, eight maps, three difficulties, Endless after the last wave,
   and an autosave after every wave. */
(() => {
  const { W, H, WISPS, MAPS, TOWERS, TOWER_ORDER, DIFFS } = WW;
  const ID = 'wisp-wardens';
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const SELL = 0.7;
  const BASE_SPEED = 55;

  // ---------- Save ----------
  let save = { progress: {}, run: null, seen: false, ...Arcade.load('ww:save', {}) };
  const persist = () => Arcade.save('ww:save', save);
  const bestOf = (m, d) => save.progress[m]?.[d] || 0;
  const boardScore = () => Object.values(save.progress).reduce((a, p) => a + Object.values(p).reduce((b, v) => b + v, 0), 0);
  const mapUnlocked = i => i === 0 || Object.keys(save.progress[MAPS[i - 1].id] || {}).length > 0;
  const mapsWon = () => MAPS.filter(m => save.progress[m.id] && Object.keys(save.progress[m.id]).length).length;

  // ---------- Canvas ----------
  const canvas = $('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay($('overlay'));
  const overlayEl = $('overlay');

  // ---------- Game state ----------
  let G = null;
  let state = 'menu';      // menu | play | paused | over
  let nextId = 1;
  const mouse = { x: -99, y: -99, in: false };
  let bg = null;

  function newGame(mapIdx, diffId, resume) {
    const map = MAPS[mapIdx], diff = DIFFS[diffId];
    G = {
      mapIdx, map, diffId, diff,
      cash: diff.cash, lives: diff.lives, wave: 0, // wave = waves completed
      towers: [], enemies: [], projs: [], fx: [], queue: [], waveT: 0, active: false,
      speed: 1, auto: false, sel: null, placing: null, pops: 0, leaked: false, endless: false,
      built: new Set(), time: 0, popSound: 0, bossKilled: false, spentMax: 0, autoT: 0,
    };
    if (resume) {
      Object.assign(G, { cash: resume.cash, lives: resume.lives, wave: resume.wave, endless: resume.endless, leaked: resume.leaked, pops: resume.pops || 0 });
      for (const t of resume.towers) {
        const tw = makeTower(t.id, t.x, t.y);
        tw.tiers = t.tiers; tw.mode = t.mode; tw.spent = t.spent; tw.stats = WW.statsFor(t.id, t.tiers);
        G.towers.push(tw); G.built.add(t.id);
      }
    }
    bg = renderBackground(map);
    state = 'play';
    ui.hide();
    renderSide(true);
  }
  const makeTower = (id, x, y) => ({ uid: nextId++, id, x, y, tiers: [0, 0], mode: 'first', cd: 0.3, ang: -Math.PI / 2, spent: 0, stats: WW.statsFor(id, [0, 0]), flash: 0 });
  const costOf = base => Math.round(base * G.diff.cost / 5) * 5;
  const towerCost = id => costOf(TOWERS[id].cost);

  function saveRun() {
    if (!G || state === 'over') return;
    save.run = {
      mapIdx: G.mapIdx, diffId: G.diffId, cash: G.cash, lives: G.lives, wave: G.wave, endless: G.endless, leaked: G.leaked, pops: G.pops,
      towers: G.towers.map(t => ({ id: t.id, x: t.x, y: t.y, tiers: t.tiers, mode: t.mode, spent: t.spent })),
    };
    persist();
  }

  // ---------- Sound ----------
  const tone = o => Arcade.tone(o);
  function popSound() {
    if (performance.now() - G.popSound < 45) return;
    G.popSound = performance.now();
    tone({ freq: 500 + Math.random() * 400, to: 200, dur: 0.05, type: 'sine', vol: 0.03 });
  }

  // ---------- Background ----------
  function renderBackground(map) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = map.ground[0]; g.fillRect(0, 0, W, H);
    // Mottled ground.
    let seed = 1234;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    g.fillStyle = map.ground[1];
    for (let i = 0; i < 260; i++) { g.globalAlpha = 0.5; g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 20 + rnd() * 50, 10 + rnd() * 30, rnd() * 3, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    for (const r of map.routes) {
      const stroke = (w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); r.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
      stroke(50, 'rgba(0,0,0,.25)');
      stroke(46, map.edge);
      stroke(38, map.road);
      g.setLineDash([2, 16]);
      stroke(2, 'rgba(255,255,255,.35)');
      g.setLineDash([]);
    }
    for (const d of map.decor) {
      if (d.kind === 'tree') {
        g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(d.x + 4, d.y + 6, d.r, d.r * 0.8, 0, 0, TAU); g.fill();
        g.fillStyle = '#1f5a2c'; g.beginPath(); g.arc(d.x, d.y, d.r, 0, TAU); g.fill();
        g.fillStyle = '#2f8040'; g.beginPath(); g.arc(d.x - d.r * 0.2, d.y - d.r * 0.25, d.r * 0.65, 0, TAU); g.fill();
      } else {
        g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(d.x + 3, d.y + 5, d.r, d.r * 0.7, 0, 0, TAU); g.fill();
        g.fillStyle = '#7b8191'; g.beginPath(); g.ellipse(d.x, d.y, d.r, d.r * 0.8, 0, 0, TAU); g.fill();
        g.fillStyle = '#9aa1b2'; g.beginPath(); g.ellipse(d.x - d.r * 0.2, d.y - d.r * 0.2, d.r * 0.6, d.r * 0.45, 0, 0, TAU); g.fill();
      }
    }
    return c;
  }

  // ---------- Wisps ----------
  function spawnWisp(type, route, s, hpOverride) {
    const w = WISPS[type];
    const e = { id: nextId++, type, route, s, hp: hpOverride ?? w.hp, slowF: 1, slowT: 0, stun: 0, dead: false, x: -99, y: -99, seg: 1 };
    WW.posAt(G.map.routes[route], s, e);
    G.enemies.push(e);
    return e;
  }
  function hit(e, dmg, dtype) {
    if (e.dead || dmg <= 0) return false;
    const w = WISPS[e.type];
    if (w.immune && w.immune.includes(dtype)) return false;
    e.hp -= dmg;
    if (e.hp > 0) return true;
    const overflow = -e.hp;
    e.dead = true;
    G.pops++;
    G.cash += w.boss ? 150 : Math.max(1, Math.round(w.hp / 4));
    popSound();
    if (w.boss) {
      Arcade.flag('wisp-wardens-boss');
      G.bossKilled = true;
      for (let i = 0; i < 40; i++) fx('spark', e.x, e.y, { color: w.color });
      tone({ freq: 120, to: 30, dur: 0.6, type: 'sawtooth', vol: 0.07 });
    } else if (Math.random() < 0.5) fx('spark', e.x, e.y, { color: w.color, n: 1 });
    w.kids.forEach((k, i) => {
      const kid = spawnWisp(k, e.route, Math.max(0, e.s - i * 7), undefined);
      kid.slowT = e.slowT; kid.slowF = e.slowF; kid.stun = e.stun;
      if (overflow > 0) hit(kid, overflow, dtype);
    });
    return true;
  }
  const eRbe = e => WW.rbe(e.type);
  const targetable = e => !e.dead && e.x > -8 && e.x < W + 8 && e.y > -8 && e.y < H + 8;
  const progress = e => e.s / G.map.routes[e.route].total;
  function predict(e, t) {
    const route = G.map.routes[e.route];
    const w = WISPS[e.type];
    const ds = BASE_SPEED * w.speed * (e.slowT > 0 ? e.slowF : 1) * (e.stun > 0 ? 0 : 1) * t;
    return WW.posAt(route, Math.min(route.total, e.s + ds), { seg: e.seg });
  }

  function fx(kind, x, y, o = {}) {
    if (kind === 'spark') {
      const n = o.n || 6;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, s = 40 + Math.random() * 120;
        G.fx.push({ k: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3, max: 0.7, color: o.color || '#fff', r: 2 + Math.random() * 2 });
      }
    } else G.fx.push({ k: kind, x, y, life: o.life || 0.3, max: o.life || 0.3, ...o });
  }

  // ---------- Waves ----------
  function startWave() {
    if (!G || G.active || state !== 'play') return;
    const n = G.wave + 1;
    const groups = WW.wave(n);
    const q = [];
    let idx = 0;
    for (const g of groups) for (let i = 0; i < g.count; i++) q.push({ t: g.at + i * g.gap, type: g.type, route: idx++ % G.map.routes.length });
    q.sort((a, b) => a.t - b.t);
    G.queue = q; G.waveT = 0; G.active = true; G.autoT = 0;
    tone({ freq: 220, to: 330, dur: 0.25, type: 'sawtooth', vol: 0.05 });
    renderSide(true);
  }
  function endWave() {
    G.active = false;
    G.wave++;
    G.cash += 100 + 3 * G.wave;
    for (const t of G.towers) if (t.stats.kind === 'econ') {
      G.cash += Math.round(t.stats.cash);
      if (t.stats.interest) G.cash += Math.floor(G.cash * t.stats.interest);
      fx('spark', t.x, t.y, { color: '#ffe14d', n: 10 });
    }
    tone({ freq: 523, to: 784, dur: 0.2, type: 'triangle', vol: 0.05 });
    if (G.wave > G.diff.waves) { /* in Endless */ }
    if (!G.endless && G.wave >= G.diff.waves) { victory(); return; }
    if (G.wave === 100) Arcade.flag('wisp-wardens-100');
    saveRun();
    renderSide(true);
  }

  // ---------- Combat ----------
  function pickTarget(t) {
    const st = t.stats;
    const range = st.range;
    let best = null, bv = -1e9;
    for (const e of G.enemies) {
      if (!targetable(e)) continue;
      const d = Math.hypot(e.x - t.x, e.y - t.y);
      if (d > range) continue;
      // Skip wisps this tower can't hurt at all.
      const imm = WISPS[e.type].immune;
      if (imm && imm.includes(st.dtype) && st.kind !== 'chain') continue;
      let v;
      switch (t.mode) {
        case 'last': v = -progress(e); break;
        case 'strong': v = eRbe(e) * 1000 + progress(e); break;
        case 'close': v = -d; break;
        default: v = progress(e);
      }
      if (v > bv) { bv = v; best = e; }
    }
    return best;
  }

  function fireTower(t, target) {
    const st = t.stats;
    t.cd = st.rate;
    t.flash = 0.12;
    const dist = Math.hypot(target.x - t.x, target.y - t.y);
    switch (st.kind) {
      case 'proj': case 'arc': case 'blast': {
        const lead = predict(target, dist / st.speed);
        const base = Math.atan2(lead.y - t.y, lead.x - t.x);
        t.ang = base;
        const n = st.shots;
        for (let i = 0; i < n; i++) {
          const a = base + (n > 1 ? (i - (n - 1) / 2) * st.spread : 0);
          const p = { k: st.kind, x: t.x + Math.cos(a) * 16, y: t.y + Math.sin(a) * 16, vx: Math.cos(a) * st.speed, vy: Math.sin(a) * st.speed, dmg: st.dmg, pierce: st.pierce, left: st.pierce, hits: new Set(), life: (st.range * 1.4) / st.speed + 0.2, st, tower: t, back: false, far: dist + 30, travelled: 0 };
          if (st.kind === 'blast') { p.tx = lead.x; p.ty = lead.y; }
          G.projs.push(p);
        }
        tone({ freq: st.kind === 'blast' ? 150 : 700, to: st.kind === 'blast' ? 80 : 420, dur: 0.06, type: st.kind === 'blast' ? 'sawtooth' : 'square', vol: 0.014 });
        break;
      }
      case 'seek': {
        const n = st.shots;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          G.projs.push({ k: 'seek', x: t.x, y: t.y, vx: Math.cos(a) * st.speed, vy: Math.sin(a) * st.speed, dmg: st.dmg, pierce: st.pierce, left: st.pierce, hits: new Set(), life: 3, st, tower: t });
        }
        t.ang = Math.atan2(target.y - t.y, target.x - t.x);
        break;
      }
      case 'snipe': {
        t.ang = Math.atan2(target.y - t.y, target.x - t.x);
        hit(target, st.dmg, st.dtype);
        G.fx.push({ k: 'line', x: t.x, y: t.y, x2: target.x, y2: target.y, life: 0.12, max: 0.12, color: '#a6ffcb', w: 3 });
        tone({ freq: 900, to: 200, dur: 0.1, type: 'sawtooth', vol: 0.03 });
        break;
      }
      case 'chain': {
        t.ang = Math.atan2(target.y - t.y, target.x - t.x);
        let cur = target, prev = { x: t.x, y: t.y };
        const done = new Set();
        for (let i = 0; i <= st.chain && cur; i++) {
          done.add(cur.id);
          G.fx.push({ k: 'bolt', x: prev.x, y: prev.y, x2: cur.x, y2: cur.y, life: 0.16, max: 0.16, color: '#bcd0ff' });
          hit(cur, st.dmg, 'energy');
          if (st.stun && !WISPS[cur.type].boss) cur.stun = Math.max(cur.stun, st.stun);
          prev = { x: cur.x, y: cur.y };
          let nxt = null, nd = 90;
          for (const e of G.enemies) {
            if (e.dead || done.has(e.id) || !targetable(e)) continue;
            const d = Math.hypot(e.x - prev.x, e.y - prev.y);
            if (d < nd) { nd = d; nxt = e; }
          }
          cur = nxt;
        }
        tone({ freq: 1200, to: 300, dur: 0.1, type: 'sawtooth', vol: 0.02 });
        break;
      }
      case 'pulse': {
        G.fx.push({ k: 'ring', x: t.x, y: t.y, r: st.range, life: 0.4, max: 0.4, color: '#8fe3ff' });
        for (const e of G.enemies) {
          if (!targetable(e) || Math.hypot(e.x - t.x, e.y - t.y) > st.range) continue;
          const w = WISPS[e.type];
          if (w.immune && w.immune.includes('cold')) continue;
          const f = w.boss ? 1 - (1 - st.slow) * 0.5 : st.slow;
          if (e.slowT <= 0 || f <= e.slowF) { e.slowF = f; }
          e.slowT = Math.max(e.slowT, st.slowT);
          if (st.dmg > 0) hit(e, st.dmg, 'cold');
        }
        tone({ freq: 900, to: 1500, dur: 0.15, type: 'sine', vol: 0.02 });
        break;
      }
    }
  }

  function explode(p, x, y) {
    const st = p.st;
    G.fx.push({ k: 'boom', x, y, r: st.blast, life: 0.35, max: 0.35 });
    for (const e of G.enemies) {
      if (e.dead || !targetable(e)) continue;
      if (Math.hypot(e.x - x, e.y - y) <= st.blast + WISPS[e.type].r * 0.5) hit(e, st.dmg, 'blast');
    }
    tone({ freq: 120, to: 40, dur: 0.2, type: 'sawtooth', vol: 0.04 });
  }

  function updateProjs(dt) {
    for (const p of G.projs) {
      if (p.dead) continue;
      p.life -= dt;
      if (p.life <= 0 && p.k !== 'arc') { p.dead = true; if (p.k === 'blast') explode(p, p.x, p.y); continue; }
      if (p.k === 'seek') {
        // Steer toward the nearest wisp.
        let best = null, bd = 260;
        for (const e of G.enemies) {
          if (!targetable(e) || p.hits.has(e.id)) continue;
          const imm = WISPS[e.type].immune;
          if (imm && imm.includes(p.st.dtype)) continue;
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          const want = Math.atan2(best.y - p.y, best.x - p.x), cur = Math.atan2(p.vy, p.vx);
          let diff = ((want - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
          const turn = Math.max(-1, Math.min(1, diff)) * Math.min(1, dt * 9);
          const a = cur + turn * 1.6, sp = p.st.speed;
          p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
        }
      }
      if (p.k === 'arc') {
        p.travelled += p.st.speed * dt;
        if (!p.back && p.travelled >= p.far) { p.back = true; p.hits.clear(); p.left = p.pierce; }
        if (p.back) {
          const a = Math.atan2(p.tower.y - p.y, p.tower.x - p.x);
          p.vx = Math.cos(a) * p.st.speed; p.vy = Math.sin(a) * p.st.speed;
          if (Math.hypot(p.tower.x - p.x, p.tower.y - p.y) < 14) { p.dead = true; continue; }
        }
        p.spin = (p.spin || 0) + dt * 18;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) { p.dead = true; continue; }
      if (p.k === 'blast' && Math.hypot(p.tx - p.x, p.ty - p.y) < 10) { p.dead = true; explode(p, p.x, p.y); continue; }
      for (const e of G.enemies) {
        if (e.dead || p.hits.has(e.id) || !targetable(e)) continue;
        const rr = WISPS[e.type].r + 5;
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > rr * rr) continue;
        if (p.k === 'blast') { p.dead = true; explode(p, p.x, p.y); break; }
        p.hits.add(e.id);
        const ok = hit(e, p.dmg, p.st.dtype);
        if (ok && p.st.slow < 1) {
          const w = WISPS[e.type];
          e.slowF = w.boss ? 1 - (1 - p.st.slow) * 0.5 : p.st.slow; e.slowT = Math.max(e.slowT, p.st.slowT);
        }
        p.left--;
        if (p.left <= 0) { p.dead = true; break; }
      }
    }
    G.projs = G.projs.filter(p => !p.dead);
  }

  function step(dt) {
    G.time += dt;
    // Spawn.
    if (G.active) {
      G.waveT += dt;
      while (G.queue.length && G.queue[0].t <= G.waveT) {
        const q = G.queue.shift();
        spawnWisp(q.type, q.route, 0);
      }
    }
    // Move wisps.
    for (const e of G.enemies) {
      if (e.dead) continue;
      const w = WISPS[e.type];
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowF = 1; }
      if (e.stun > 0) { e.stun -= dt; continue; }
      e.s += BASE_SPEED * w.speed * (e.slowT > 0 ? e.slowF : 1) * dt;
      const route = G.map.routes[e.route];
      if (e.s >= route.total) {
        e.dead = true;
        G.lives -= eRbe(e);
        G.leaked = true;
        tone({ freq: 200, to: 90, dur: 0.18, type: 'square', vol: 0.05 });
        continue;
      }
      WW.posAt(route, e.s, e);
    }
    // Towers.
    for (const t of G.towers) {
      t.flash = Math.max(0, t.flash - dt);
      if (t.stats.kind === 'econ') continue;
      t.cd -= dt;
      if (t.cd > 0) continue;
      const target = pickTarget(t);
      if (target) fireTower(t, target);
      else t.cd = 0;
    }
    updateProjs(dt);
    // Effects.
    for (const f of G.fx) {
      f.life -= dt;
      if (f.k === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.94; f.vy *= 0.94; }
    }
    G.fx = G.fx.filter(f => f.life > 0);
    G.enemies = G.enemies.filter(e => !e.dead);
    if (G.lives <= 0) { defeat(); return; }
    if (G.active && !G.queue.length && !G.enemies.length) endWave();
    // Auto-start.
    if (G.auto && !G.active && state === 'play') { G.autoT += dt; if (G.autoT > 1.5) startWave(); }
  }

  // ---------- Ending a run ----------
  const calcScore = (won) => Math.round((G.wave * 150 + Math.max(0, G.lives) * 20 + (won ? 2000 : 0)) * G.diff.mult);
  function recordBest(score) {
    const p = (save.progress[G.map.id] ||= {});
    if (score > (p[G.diffId] || 0)) p[G.diffId] = score;
    persist();
  }
  function victory() {
    state = 'over';
    const score = calcScore(true);
    recordBest(score);
    Arcade.flag('wisp-wardens-' + G.diffId);
    if (!G.leaked) Arcade.flag('wisp-wardens-perfect');
    if (mapsWon() >= MAPS.length) Arcade.flag('wisp-wardens-maps');
    save.run = null; persist();
    tone({ freq: 523, to: 1046, dur: 0.6, type: 'triangle', vol: 0.07 });
    Arcade.finish(ui, {
      score: boardScore(),
      title: `${G.map.name} cleared`,
      html: `<p>${G.diff.name}: all ${G.diff.waves} waves held · ${Math.max(0, G.lives)} lives left · run score ${score.toLocaleString()}</p>
        ${G.leaked ? '' : '<p class="new-best">A perfect defence. Nothing got through.</p>'}
        <div class="td-row"><button class="btn secondary" data-act="endless" type="button">Keep going (Endless)</button><button class="btn secondary" data-act="menu" type="button">Menu</button></div>`,
      button: 'Pick a map',
      onAction: showMaps,
    });
  }
  function defeat() {
    state = 'over';
    const score = calcScore(false);
    recordBest(score);
    save.run = null; persist();
    tone({ freq: 300, to: 40, dur: 0.8, type: 'sawtooth', vol: 0.08 });
    Arcade.finish(ui, {
      score: boardScore(),
      title: `Overrun on wave ${G.wave + 1}`,
      html: `<p>${G.map.name} · ${G.diff.name} · ${G.pops.toLocaleString()} wisps popped · run score ${score.toLocaleString()}</p>
        <div class="td-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>`,
      button: 'Try again',
      onAction: () => newGame(G.mapIdx, G.diffId),
    });
  }
  function continueEndless() {
    G.endless = true; state = 'play'; G.lives = Math.max(G.lives, 1);
    ui.hide();
    saveRun();
    renderSide(true);
  }

  // ---------- Rendering ----------
  function drawTowerShape(t, x, y, ang, scale = 1, ghost = false) {
    const def = TOWERS[t.id || t];
    const id = t.id || t;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    if (ghost) ctx.globalAlpha = 0.75;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(2, 4, 17, 14, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2b3042'; ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
    ctx.strokeStyle = def.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.stroke();
    ctx.rotate(ang);
    ctx.fillStyle = def.color; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    switch (id) {
      case 'spark': ctx.fillRect(2, -3, 16, 6); ctx.strokeRect(2, -3, 16, 6); ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill(); break;
      case 'bombard': ctx.fillRect(0, -6, 18, 12); ctx.strokeRect(0, -6, 18, 12); ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.stroke(); break;
      case 'sniper': ctx.fillRect(0, -2, 24, 4); ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); ctx.fillStyle = '#111'; ctx.fillRect(8, -5, 3, 3); break;
      case 'arc': ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(8, -7); ctx.quadraticCurveTo(20, 0, 8, 7); ctx.lineTo(10, 0); ctx.fill(); break;
      case 'frost': ctx.rotate(-ang); ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * 10, Math.sin(a) * 10); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill(); break;
      case 'hive': ctx.rotate(-ang); ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.5; ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#5a3b00'; for (const [dx, dy] of [[-4, -3], [4, -3], [0, 4]]) { ctx.beginPath(); ctx.arc(dx, dy, 2.2, 0, TAU); ctx.fill(); } break;
      case 'tesla': ctx.rotate(-ang); ctx.fillRect(-3, -9, 6, 18); ctx.beginPath(); ctx.arc(0, -9, 5, 0, TAU); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, -9, 8, 0, TAU); ctx.stroke(); break;
      case 'mint': ctx.rotate(-ang); ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#7a5b00'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1); break;
    }
    ctx.restore();
  }

  function drawWisp(e) {
    const w = WISPS[e.type];
    ctx.save();
    ctx.translate(e.x, e.y);
    if (w.alpha) ctx.globalAlpha = w.alpha;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(2, 5, w.r, w.r * 0.7, 0, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(-w.r * 0.35, -w.r * 0.4, 1, 0, 0, w.r * 1.1);
    g.addColorStop(0, '#fff'); g.addColorStop(0.25, w.color); g.addColorStop(1, shade(w.color, -0.35));
    ctx.fillStyle = g; ctx.strokeStyle = w.ring || shade(w.color, -0.5); ctx.lineWidth = w.ring ? 2.5 : 1.5;
    ctx.beginPath();
    if (w.shape === 'hex') { for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * w.r, Math.sin(a) * w.r); } ctx.closePath(); }
    else if (w.shape === 'diamond') { ctx.moveTo(0, -w.r * 1.15); ctx.lineTo(w.r, 0); ctx.lineTo(0, w.r * 1.15); ctx.lineTo(-w.r, 0); ctx.closePath(); }
    else if (w.shape === 'blimp') { ctx.ellipse(0, 0, w.r * 1.4, w.r, 0, 0, TAU); }
    else ctx.arc(0, 0, w.r, 0, TAU);
    ctx.fill(); ctx.stroke();
    if (w.boss) {
      const max = w.hp, f = Math.max(0, e.hp / max);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(-24, -w.r - 12, 48, 5);
      ctx.fillStyle = '#ff5d5d'; ctx.fillRect(-24, -w.r - 12, 48 * f, 5);
    } else if (w.hp > 1 && e.hp < w.hp) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(-10, -w.r - 7, 20, 3);
      ctx.fillStyle = '#7ef2ff'; ctx.fillRect(-10, -w.r - 7, 20 * Math.max(0, e.hp / w.hp), 3);
    }
    if (e.slowT > 0) { ctx.fillStyle = 'rgba(143,227,255,.35)'; ctx.beginPath(); ctx.arc(0, 0, w.r + 2, 0, TAU); ctx.fill(); }
    if (e.stun > 0) { ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -w.r - 4, 5, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function validSpot(x, y, ignoreUid) {
    if (x < 20 || x > W - 20 || y < 20 || y > H - 20) return false;
    if (WW.distToRoutes(G.map, x, y) < 38) return false;
    for (const d of G.map.decor) if (Math.hypot(d.x - x, d.y - y) < d.r + 16) return false;
    for (const t of G.towers) if (t.uid !== ignoreUid && Math.hypot(t.x - x, t.y - y) < 34) return false;
    return true;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!G || !bg) { ctx.fillStyle = '#10131a'; ctx.fillRect(0, 0, W, H); return; }
    ctx.drawImage(bg, 0, 0);
    // Wisps (smaller first so bosses sit on top).
    const order = [...G.enemies].sort((a, b) => WISPS[a.type].r - WISPS[b.type].r);
    // Range of the selected or placing tower.
    const sel = G.towers.find(t => t.uid === G.sel);
    if (sel) {
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
      if (sel.stats.range < 5000) { ctx.beginPath(); ctx.arc(sel.x, sel.y, sel.stats.range, 0, TAU); ctx.fill(); ctx.stroke(); }
    }
    for (const t of G.towers) {
      drawTowerShape(t, t.x, t.y, t.ang);
      const tot = t.tiers[0] + t.tiers[1];
      for (let i = 0; i < tot; i++) { ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(t.x - (tot - 1) * 3 + i * 6, t.y + 21, 2, 0, TAU); ctx.fill(); }
      if (t.uid === G.sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(t.x, t.y, 20, 0, TAU); ctx.stroke(); }
      if (t.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${t.flash * 3})`; ctx.beginPath(); ctx.arc(t.x, t.y, 16, 0, TAU); ctx.fill(); }
    }
    for (const e of order) drawWisp(e);
    // Projectiles.
    for (const p of G.projs) {
      ctx.save(); ctx.translate(p.x, p.y);
      if (p.k === 'arc') { ctx.rotate(p.spin || 0); ctx.fillStyle = '#ff8fd6'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.quadraticCurveTo(0, -10, 9, 0); ctx.quadraticCurveTo(0, -4, -9, 0); ctx.fill(); ctx.stroke(); ctx.rotate(Math.PI); ctx.beginPath(); ctx.moveTo(-9, 0); ctx.quadraticCurveTo(0, -10, 9, 0); ctx.quadraticCurveTo(0, -4, -9, 0); ctx.fill(); }
      else if (p.k === 'blast') { ctx.fillStyle = '#ffb27a'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); ctx.strokeStyle = '#7a2a00'; ctx.stroke(); }
      else if (p.k === 'seek') { ctx.rotate(Math.atan2(p.vy, p.vx)); ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 3, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(-2, -3, 2, 6); }
      else { ctx.rotate(Math.atan2(p.vy, p.vx)); ctx.fillStyle = '#fff6c8'; ctx.shadowColor = '#ffc53d'; ctx.shadowBlur = 8; ctx.fillRect(-7, -2, 14, 4); }
      ctx.restore();
    }
    // Effects.
    for (const f of G.fx) {
      const k = Math.max(0, f.life / f.max);
      if (f.k === 'dot') { ctx.globalAlpha = k; ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
      else if (f.k === 'ring') { ctx.strokeStyle = f.color; ctx.globalAlpha = k * 0.8; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - k * 0.6), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
      else if (f.k === 'boom') { ctx.fillStyle = `rgba(255,170,80,${k * 0.6})`; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.1 - k * 0.3), 0, TAU); ctx.fill(); ctx.strokeStyle = `rgba(255,240,200,${k})`; ctx.lineWidth = 3; ctx.stroke(); }
      else if (f.k === 'line' || f.k === 'bolt') {
        ctx.strokeStyle = f.color; ctx.globalAlpha = k; ctx.lineWidth = f.w || 2.5; ctx.shadowColor = f.color; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(f.x, f.y);
        if (f.k === 'bolt') { const mx = (f.x + f.x2) / 2 + (Math.random() - 0.5) * 14, my = (f.y + f.y2) / 2 + (Math.random() - 0.5) * 14; ctx.lineTo(mx, my); }
        ctx.lineTo(f.x2, f.y2); ctx.stroke(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      }
    }
    // Placement ghost.
    if (G.placing && mouse.in) {
      const ok = validSpot(mouse.x, mouse.y) && G.cash >= towerCost(G.placing);
      const st = WW.statsFor(G.placing, [0, 0]);
      ctx.fillStyle = ok ? 'rgba(255,255,255,.1)' : 'rgba(255,60,60,.18)'; ctx.strokeStyle = ok ? 'rgba(255,255,255,.55)' : 'rgba(255,90,90,.8)'; ctx.lineWidth = 2;
      if (st.range < 5000) { ctx.beginPath(); ctx.arc(mouse.x, mouse.y, st.range, 0, TAU); ctx.fill(); ctx.stroke(); }
      drawTowerShape(G.placing, mouse.x, mouse.y, -Math.PI / 2, 1, true);
    }
    // Wave banner.
    if (!G.active && state === 'play') {
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W / 2 - 150, 10, 300, 34);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`Wave ${G.wave + 1} ready · press Space`, W / 2, 28);
    }
    if (state === 'paused') { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- Side panel ----------
  const side = $('side');
  let sideKey = '';
  function renderSide(force) {
    if (!G) { side.innerHTML = ''; sideKey = ''; return; }
    const sel = G.towers.find(t => t.uid === G.sel);
    // Rebuild only when something the panel shows has changed (cash itself changes constantly,
    // so only whether each button is affordable counts).
    const upAfford = sel ? [0, 1].map(p => { const u = TOWERS[sel.id].paths[p][1][sel.tiers[p]]; return u && G.cash >= costOf(u.cost) ? 1 : 0; }).join('') : '';
    const key = [TOWER_ORDER.map(id => G.cash >= towerCost(id) ? 1 : 0).join(''), G.placing, G.sel, sel ? sel.tiers.join('') + sel.mode + sel.spent + upAfford : '', G.active, G.speed, G.auto, G.wave].join('|');
    if (!force && key === sideKey) return;
    sideKey = key;
    const shop = TOWER_ORDER.map((id, i) => {
      const d = TOWERS[id], c = towerCost(id);
      return `<button class="td-tw ${G.placing === id ? 'on' : ''}" data-act="place" data-id="${id}" type="button" ${G.cash >= c ? '' : 'disabled'} title="${d.blurb}"><i style="background:${d.color}"></i><span><b>${i + 1}. ${d.name}</b><small>$${c}</small></span></button>`;
    }).join('');
    let selHtml = '<p class="td-note">Pick a tower, then click an empty spot on the map. Click a placed tower to upgrade it.</p>';
    if (sel) {
      const d = TOWERS[sel.id];
      const paths = d.paths.map(([pname, ups], p) => {
        const n = sel.tiers[p];
        const next = ups[n];
        const can = WW.canUpgrade(sel.tiers, p);
        const cost = next ? costOf(next.cost) : 0;
        const body = !next ? `<button class="td-up" disabled type="button"><b>${pname}</b><small>Maxed out</small></button>`
          : !can ? `<button class="td-up" disabled type="button"><b>${next.name}</b><span class="pr">—</span><small>Locked: the other path is too far along</small></button>`
            : `<button class="td-up" data-act="upgrade" data-p="${p}" type="button" ${G.cash >= cost ? '' : 'disabled'}><b>${next.name}</b><span class="pr">$${cost.toLocaleString()}</span><small>${next.desc}</small></button>`;
        return `<div><div class="td-pips">${pname} ${'●'.repeat(n)}${'○'.repeat(4 - n)}</div>${body}</div>`;
      }).join('');
      selHtml = `<h3>${d.name}</h3><div class="td-ups">${paths}</div>
        <div class="td-ctl" style="margin-top:8px">
          ${sel.stats.kind !== 'econ' ? `<button class="btn secondary" data-act="mode" type="button">Target: ${({ first: 'First', last: 'Last', strong: 'Strong', close: 'Close' })[sel.mode]}</button>` : ''}
          <button class="btn secondary" data-act="sell" type="button">Sell $${Math.floor(sel.spent * SELL).toLocaleString()}</button>
        </div>`;
    }
    side.innerHTML = `
      <div class="td-box"><div class="td-ctl">
        <button class="btn" data-act="wave" type="button" ${G.active ? 'disabled' : ''}>${G.active ? 'Wave ' + (G.wave + 1) + '…' : 'Start wave ' + (G.wave + 1)}</button>
        <button class="btn secondary ${G.speed > 1 ? 'on' : ''}" data-act="speed" type="button">${G.speed}×</button>
        <button class="btn secondary ${G.auto ? 'on' : ''}" data-act="auto" type="button">Auto</button>
      </div></div>
      <div class="td-box"><h3>Towers</h3><div class="td-shop">${shop}</div></div>
      <div class="td-box">${sel ? '' : '<h3>Upgrades</h3>'}${selHtml}</div>`;
  }
  side.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !G || state !== 'play') return;
    const d = b.dataset;
    switch (d.act) {
      case 'place': G.placing = G.placing === d.id ? null : d.id; G.sel = null; break;
      case 'wave': startWave(); break;
      case 'speed': G.speed = G.speed === 1 ? 2 : G.speed === 2 ? 3 : 1; break;
      case 'auto': G.auto = !G.auto; break;
      case 'mode': { const sel = G.towers.find(t => t.uid === G.sel); if (sel) sel.mode = ({ first: 'last', last: 'strong', strong: 'close', close: 'first' })[sel.mode]; break; }
      case 'sell': sellSelected(); break;
      case 'upgrade': upgradeSelected(+d.p); break;
    }
    renderSide(true);
  });

  function upgradeSelected(p) {
    const sel = G.towers.find(t => t.uid === G.sel);
    if (!sel || !WW.canUpgrade(sel.tiers, p)) return;
    const up = TOWERS[sel.id].paths[p][1][sel.tiers[p]];
    const cost = costOf(up.cost);
    if (G.cash < cost) return;
    G.cash -= cost; sel.spent += cost;
    sel.tiers[p]++;
    sel.stats = WW.statsFor(sel.id, sel.tiers);
    if (sel.tiers[p] === 4) Arcade.flag('wisp-wardens-tier4');
    tone({ freq: 440, to: 880, dur: 0.15, type: 'triangle', vol: 0.05 });
    fx('spark', sel.x, sel.y, { color: TOWERS[sel.id].color, n: 12 });
    saveRun();
  }
  function sellSelected() {
    const sel = G.towers.find(t => t.uid === G.sel);
    if (!sel) return;
    G.cash += Math.floor(sel.spent * SELL);
    G.towers = G.towers.filter(t => t !== sel);
    G.sel = null;
    tone({ freq: 600, to: 300, dur: 0.15, type: 'triangle', vol: 0.05 });
    saveRun();
  }

  // ---------- Input ----------
  function toField(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  canvas.addEventListener('pointermove', e => { const p = toField(e); mouse.x = p.x; mouse.y = p.y; mouse.in = true; });
  canvas.addEventListener('pointerleave', () => { mouse.in = false; });
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); if (G) { G.placing = null; G.sel = null; renderSide(true); } });
  canvas.addEventListener('pointerdown', e => {
    if (!G || state !== 'play') return;
    const p = toField(e);
    mouse.x = p.x; mouse.y = p.y; mouse.in = true;
    if (G.placing) {
      const cost = towerCost(G.placing);
      if (validSpot(p.x, p.y) && G.cash >= cost) {
        const t = makeTower(G.placing, p.x, p.y);
        t.spent = cost;
        G.cash -= cost;
        G.towers.push(t);
        G.built.add(G.placing);
        if (G.built.size >= TOWER_ORDER.length) Arcade.flag('wisp-wardens-all');
        tone({ freq: 330, to: 660, dur: 0.12, type: 'triangle', vol: 0.05 });
        fx('spark', p.x, p.y, { color: TOWERS[G.placing].color, n: 8 });
        G.sel = t.uid;
        if (!e.shiftKey) G.placing = null;
        saveRun();
      } else tone({ freq: 150, dur: 0.08, type: 'square', vol: 0.03 });
    } else {
      let hitT = null, bd = 22;
      for (const t of G.towers) { const d = Math.hypot(t.x - p.x, t.y - p.y); if (d < bd) { bd = d; hitT = t; } }
      G.sel = hitT ? hitT.uid : null;
    }
    renderSide(true);
  });
  addEventListener('keydown', e => {
    if (!G || e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyP') { togglePause(); return; }
    if (state !== 'play') return;
    if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); startWave(); }
    else if (e.code === 'Escape') { G.placing = null; G.sel = null; }
    else if (e.code === 'KeyF') G.speed = G.speed === 1 ? 2 : G.speed === 2 ? 3 : 1;
    else if (e.code === 'KeyU' && G.sel) { const t = G.towers.find(x => x.uid === G.sel); if (t) upgradeSelected(t.tiers[0] >= t.tiers[1] ? 0 : 1); }
    else if (/^Digit[1-8]$/.test(e.code)) { const id = TOWER_ORDER[+e.code.slice(5) - 1]; if (G.cash >= towerCost(id)) { G.placing = id; G.sel = null; } }
    renderSide(true);
  }, true);

  function togglePause() {
    if (state === 'play') {
      state = 'paused';
      ui.show({ title: 'Paused', html: '<div class="td-row"><button class="btn secondary" data-act="menu" type="button">Save and quit</button></div>', button: 'Resume', onAction: togglePause });
    } else if (state === 'paused') { state = 'play'; ui.hide(); last = performance.now(); }
  }
  Arcade.onBlur(() => { if (state === 'play') togglePause(); });

  // ---------- Menus ----------
  function mapSvg(m) {
    const paths = m.routes.map(r => `<polyline points="${r.pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${m.road}" stroke-width="42" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
    return `<svg viewBox="0 0 900 600" preserveAspectRatio="xMidYMid slice"><rect width="900" height="600" fill="${m.ground[0]}"/>${paths}</svg>`;
  }
  function showMenu() {
    state = 'menu'; G = null; bg = null;
    $('s-wave').textContent = $('s-lives').textContent = $('s-cash').textContent = '–';
    renderSide(true);
    const r = save.run;
    ui.show({
      title: 'Pixel Pioneers Arcade',
      html: `<h2 style="font-size:36px;margin:0;color:var(--text);letter-spacing:.05em">WISP WARDENS</h2>
        <p class="td-note" style="margin:4px 0 14px">Hold the road. Pop every layer.</p>
        <div class="td-menu">
          ${r ? `<button class="btn" data-act="resume" type="button">Continue · ${MAPS[r.mapIdx].name}, wave ${r.wave + 1}</button>` : ''}
          <button class="btn ${r ? 'secondary' : ''}" data-act="maps" type="button">New game</button>
          <button class="btn secondary" data-act="howto" type="button">How to play</button>
        </div>
        <p class="td-note">Maps cleared: ${mapsWon()}/${MAPS.length}</p>`,
      button: null,
    });
  }
  function showHowTo() {
    ui.show({
      title: 'How to play',
      html: `<ul style="text-align:left">
        <li>Wisps walk the road. If one reaches the end you lose lives equal to the layers it still has.</li>
        <li>Popping a wisp reveals the one inside: <b>Pink → Gold → Green → Blue → Red</b>. Tougher ones hold two inside.</li>
        <li><b>Shades</b> shrug off explosions, <b>Ghosts</b> shrug off cold, <b>Iron</b> wisps shrug off sharp shots. <b>Tesla</b> and <b>Hive</b> mixes cover the gaps.</li>
        <li>Each tower has two upgrade paths of four. Take one path all the way and the other only to tier 2.</li>
        <li><b>Mint Engines</b> pay out after every wave. Sell towers for 70% back. Set targeting to First, Last, Strong or Close.</li>
        <li>Your run saves after every wave. Win to open the next map, then try harder difficulties and Endless.</li>
      </ul><div class="td-row"><button class="btn" data-act="menu" type="button">Got it</button></div>`,
      button: null,
    });
  }
  function showMaps() {
    state = 'menu';
    const cards = MAPS.map((m, i) => {
      const meds = ['easy', 'medium', 'hard'].map(d => (bestOf(m.id, d) ? '★' : '☆')).join('');
      const ok = mapUnlocked(i);
      return `<button class="td-map" data-act="map" data-i="${i}" type="button" ${ok ? '' : 'disabled'}>${mapSvg(m)}<div><b>${ok ? m.name : 'Locked'}</b><small>${ok ? m.sub : 'Win the map before it'}</small><br><span class="medals">${meds}</span></div></button>`;
    }).join('');
    ui.show({ title: 'Choose a map', html: `<div class="td-row" style="justify-content:space-between;margin:0"><button class="btn secondary" data-act="menu" type="button">← Menu</button><span class="td-note">Total score ${boardScore().toLocaleString()}</span></div><div class="td-maps">${cards}</div>`, button: null });
  }
  function showDiff(i) {
    const m = MAPS[i];
    const btns = Object.entries(DIFFS).map(([id, d]) => `<button class="btn ${id === 'medium' ? '' : 'secondary'}" data-act="start" data-i="${i}" data-d="${id}" type="button">${d.name}<br><small style="font-weight:500">${d.blurb}${bestOf(m.id, id) ? ` · best ${bestOf(m.id, id).toLocaleString()}` : ''}</small></button>`).join('');
    ui.show({ title: m.name, html: `<div style="max-width:320px;margin:0 auto">${mapSvg(m)}</div><p class="td-note" style="margin:10px 0">${m.sub}</p><div class="td-menu">${btns}<button class="btn secondary" data-act="maps" type="button">← Maps</button></div>`, button: null });
  }
  overlayEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'menu': if (state === 'paused') { saveRun(); } showMenu(); break;
      case 'maps': showMaps(); break;
      case 'howto': showHowTo(); break;
      case 'map': showDiff(+d.i); break;
      case 'start': save.run = null; persist(); newGame(+d.i, d.d); break;
      case 'resume': { const r = save.run; if (r) newGame(r.mapIdx, r.diffId, r); break; }
      case 'endless': continueEndless(); break;
    }
  });

  // ---------- Loop ----------
  let last = performance.now();
  let sideT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G && state === 'play') {
      const total = dt * G.speed;
      const n = Math.max(1, Math.ceil(total / (1 / 60)));
      for (let i = 0; i < n && state === 'play'; i++) step(total / n);
      $('s-wave').textContent = G.endless ? `${G.wave + 1} ∞` : `${Math.min(G.wave + 1, G.diff.waves)}/${G.diff.waves}`;
      $('s-lives').textContent = Math.max(0, G.lives);
      $('s-cash').textContent = '$' + Math.floor(G.cash).toLocaleString();
      sideT += dt;
      if (sideT > 0.2) { sideT = 0; renderSide(false); }
    }
    draw();
    requestAnimationFrame(frame);
  }

  showMenu();
  if (!save.seen) { save.seen = true; persist(); showHowTo(); }
  requestAnimationFrame(frame);
})();
