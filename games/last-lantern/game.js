/* Last Lantern: survive the dark. Your lantern fights on its own; you walk, gather light and choose
   upgrades. Four stages of fifteen minutes, six keepers, eight weapons that evolve, eight passives,
   boss chests, permanent upgrades between runs, and Endless after the dawn. */
(() => {
  const { WEAPONS, WEAPON_IDS, PASSIVES, PASSIVE_IDS, ENEMIES, STAGES, CHARS, META } = LL;
  const W = 960, H = 600, TAU = Math.PI * 2;
  const WIN_AT = 900;
  const $ = id => document.getElementById(id);

  // ---------- Save ----------
  let save = { gold: 0, chars: ['wren'], char: 'wren', cleared: {}, bestTime: {}, meta: {}, seen: false, kills: 0, ...Arcade.load('ll:save', {}) };
  const persist = () => Arcade.save('ll:save', save);
  const mr = id => save.meta[id] || 0;

  const canvas = $('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay($('overlay'));
  const overlayEl = $('overlay');
  const tone = o => Arcade.tone(o);

  // ---------- Run state ----------
  let R = null, state = 'menu', last = performance.now();
  const keys = new Set();
  const joy = { on: false, ox: 0, oy: 0, dx: 0, dy: 0 };
  let grid = new Map();
  let nextId = 1;
  let bgTile = null;

  function ps() { return R.ps; }
  function recalc() {
    const p = R.pass, ch = R.ch.fx, s = R.ps || (R.ps = {});
    s.might = 1 + 0.12 * (p.might || 0) + 0.05 * mr('might') + (ch.might || 0);
    s.cd = Math.max(0.35, (1 - 0.08 * (p.haste || 0)) * (1 - 0.03 * mr('cd')) * (1 - (ch.cd || 0)));
    s.area = 1 + 0.1 * (p.reach || 0) + (ch.area || 0);
    s.move = 1 + 0.08 * (p.swift || 0) + 0.05 * mr('move') + (ch.move || 0);
    s.magnet = 1 + 0.25 * (p.magnet || 0) + 0.2 * mr('magnet');
    s.regen = 0.4 * (p.mend || 0) + 0.2 * mr('regen');
    s.xp = 1 + 0.1 * (p.greed || 0) + 0.04 * mr('growth') + (ch.xp || 0);
    s.gold = 1 + 0.1 * (p.greed || 0) + 0.08 * mr('greed');
    s.armor = mr('armor');
    const mh = (100 + 20 * (p.vital || 0) + (ch.hp || 0)) * (1 + 0.1 * mr('hp'));
    if (R.p.maxhp !== undefined) R.p.hp += mh - R.p.maxhp;
    R.p.maxhp = mh;
    for (const w of R.wp) w.st = LL.weaponStats(w.id, w.lvl, w.evolved);
  }

  function startRun(stageId, charId) {
    const stage = STAGES.find(s => s.id === stageId), ch = CHARS.find(c => c.id === charId);
    R = {
      stage, ch, t: 0, p: { x: 0, y: 0, hp: 100, face: 1, inv: 0, r: 10, hurt: 0 }, en: [], gems: [], pick: [], proj: [], eproj: [], zones: [], fx: [], txt: [],
      wp: [{ id: ch.start, lvl: 1, evolved: false, cd: 0.3, ang: 0, flip: 1 }], pass: {}, lvl: 1, xp: 0, kills: 0, gold: 0, spawnAcc: 0,
      nextElite: 120, bossesDone: 0, swarmsDone: 0, revive: (ch.fx.revive || 0) + mr('revive'), won: false, endless: false, evolved: 0, bossKills: 0,
      shake: 0, cam: { x: 0, y: 0 }, maxLvlTxt: 0,
    };
    R.need = needFor(1);
    recalc();
    R.p.hp = R.p.maxhp;
    bgTile = makeBg(stage);
    state = 'play';
    ui.hide();
    tone({ freq: 330, to: 660, dur: 0.3, type: 'triangle', vol: 0.05 });
  }
  const needFor = l => Math.round(5 + l * 4 + l * l * 0.75);

  function makeBg(stage) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = stage.c1; g.fillRect(0, 0, 256, 256);
    let seed = 99; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    g.fillStyle = stage.c2;
    for (let i = 0; i < 40; i++) {
      const bx = rnd() * 256, by = rnd() * 256, rx = 10 + rnd() * 30, ry = 6 + rnd() * 18, rot = rnd() * 3;
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { g.beginPath(); g.ellipse(bx + ox, by + oy, rx, ry, rot, 0, TAU); g.fill(); }
    }
    g.fillStyle = stage.dot;
    for (let i = 0; i < 90; i++) g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 2, 2 + rnd() * 2);
    return c;
  }

  // ---------- Spatial grid ----------
  const CELL = 64;
  const gk = (cx, cy) => (cx + 1000) * 4000 + (cy + 1000);
  function buildGrid() {
    grid.clear();
    for (const e of R.en) {
      const k = gk(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
      let a = grid.get(k);
      if (!a) grid.set(k, a = []);
      a.push(e);
    }
  }
  function near(x, y, r, fn) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = grid.get(gk(cx, cy));
      if (a) for (const e of a) if (!e.dead && fn(e) === false) return;
    }
  }
  function nearestEnemies(x, y, n, maxD = 700, skip) {
    const out = [];
    for (const e of R.en) {
      if (e.dead || (skip && skip.has(e.id))) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d > maxD * maxD) continue;
      if (out.length < n) { out.push([d, e]); out.sort((a, b) => a[0] - b[0]); }
      else if (d < out[out.length - 1][0]) { out[out.length - 1] = [d, e]; out.sort((a, b) => a[0] - b[0]); }
    }
    return out.map(o => o[1]);
  }

  // ---------- Enemies ----------
  const minute = () => R.t / 60;
  function hpMul() { const m = minute(); return (1 + 0.3 * m + (m > 10 ? 0.15 * (m - 10) : 0)) * Math.pow(R.stage.mult, 0.85); }
  function spawnEnemy(type, x, y, o = {}) {
    const def = ENEMIES[type];
    const hm = hpMul();
    const e = {
      id: nextId++, type, def, x, y, vx: 0, vy: 0, hp: def.hp * hm * (o.hpx || 1), max: def.hp * hm * (o.hpx || 1),
      spd: def.spd * (o.spdx || 1) * (1 + Math.min(0.3, minute() * 0.02)), dmg: def.dmg * 0.75 * (1 + minute() * 0.05) * Math.pow(R.stage.mult, 0.6),
      r: def.r, slow: 0, flash: 0, dead: false, hitT: {}, atk: 2 + Math.random() * 2, ph: Math.random() * 6,
    };
    R.en.push(e);
    return e;
  }
  function spawnDirector(dt) {
    const m = minute();
    const stageRate = 1 + (R.stage.mult - 1) * 0.5;
    R.spawnAcc += dt * (0.9 + 0.35 * m) * stageRate;
    const cap = 330;
    while (R.spawnAcc >= 1) {
      R.spawnAcc -= 1;
      if (R.en.length >= cap) continue;
      const list = LL.pickWave(m);
      let tot = 0; for (const [, w] of list) tot += w;
      let r = Math.random() * tot, type = list[0][0];
      for (const [t, w] of list) { r -= w; if (r <= 0) { type = t; break; } }
      const a = Math.random() * TAU, d = 520 + Math.random() * 120;
      spawnEnemy(type, R.p.x + Math.cos(a) * d, R.p.y + Math.sin(a) * d);
    }
    // Elites.
    if (R.t >= R.nextElite) {
      R.nextElite += 120;
      const a = Math.random() * TAU;
      spawnEnemy('elite', R.p.x + Math.cos(a) * 560, R.p.y + Math.sin(a) * 560).chest = true;
      banner('An elite approaches');
    }
    // Bosses at 5, 10, 15 minutes.
    if (R.bossesDone < 3 && R.t >= 300 * (R.bossesDone + 1)) {
      R.bossesDone++;
      const a = Math.random() * TAU;
      const b = spawnEnemy('boss', R.p.x + Math.cos(a) * 520, R.p.y + Math.sin(a) * 520, { hpx: 1 + R.bossesDone * 0.9 });
      b.chest = true; b.boss = true; b.name = R.stage.boss;
      banner(`${R.stage.boss} awakens`);
      tone({ freq: 90, to: 50, dur: 1, type: 'sawtooth', vol: 0.08 });
    }
    // Swarm rings at 3, 6, 9, 12 minutes.
    if (R.swarmsDone < 4 && R.t >= 180 * (R.swarmsDone + 1)) {
      R.swarmsDone++;
      for (let i = 0; i < 48; i++) { const a = i / 48 * TAU; spawnEnemy('bat', R.p.x + Math.cos(a) * 430, R.p.y + Math.sin(a) * 430, { spdx: 1.15 }); }
      banner('A swarm closes in!');
    }
    // The dawn.
    if (!R.won && !R.endless && R.t >= WIN_AT) win();
  }

  function dmgEnemy(e, amount, kb = 0, fromx = 0, fromy = 0) {
    if (e.dead) return;
    e.hp -= amount;
    e.flash = 0.1;
    if (kb && !e.def.boss && !e.def.elite) {
      const d = Math.hypot(e.x - fromx, e.y - fromy) || 1;
      e.vx += (e.x - fromx) / d * kb; e.vy += (e.y - fromy) / d * kb;
    }
    if (R.txt.length < 50) R.txt.push({ x: e.x, y: e.y - e.r, v: Math.round(amount), life: 0.6, max: 0.6 });
    if (e.hp <= 0) killEnemy(e);
  }
  function killEnemy(e) {
    e.dead = true;
    R.kills++; save.kills++;
    const d = e.def;
    R.gems.push({ x: e.x, y: e.y, v: d.xp, id: nextId++ });
    if (Math.random() < 0.1 + (d.big ? 0.2 : 0)) R.pick.push({ k: 'coin', x: e.x + 6, y: e.y, v: Math.ceil((1 + Math.random() * 3) * R.stage.gold) });
    else if (Math.random() < 0.006) R.pick.push({ k: 'food', x: e.x, y: e.y });
    if (e.chest) R.pick.push({ k: 'chest', x: e.x, y: e.y });
    if (e.boss) { R.bossKills++; Arcade.flag('last-lantern-boss'); R.shake = 1; for (const x of R.en) if (!x.dead && x !== e && !x.def.boss && !x.def.elite) x.hp = Math.min(x.hp, 1); }
    if (R.fx.length < 300) for (let i = 0; i < (d.boss ? 30 : 4); i++) fx(e.x, e.y, d.boss ? '#fff' : R.stage.tints[0]);
  }
  function fx(x, y, color) {
    const a = Math.random() * TAU, s = 30 + Math.random() * 110;
    R.fx.push({ k: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4, max: 0.4, color });
  }
  function banner(text) { R.banner = { text, t: 2.5 }; }

  function hurtPlayer(amount) {
    const p = R.p;
    if (p.inv > 0) return;
    const a = Math.max(1, Math.round(amount - ps().armor));
    p.hp -= a;
    p.inv = 0.5; p.hurt = 0.2;
    R.shake = Math.max(R.shake, 0.3);
    tone({ freq: 180, to: 80, dur: 0.12, type: 'sawtooth', vol: 0.04 });
    if (R.txt.length < 60) R.txt.push({ x: p.x, y: p.y - 14, v: -a, life: 0.7, max: 0.7, bad: true });
    if (p.hp <= 0) {
      if (R.revive > 0) {
        R.revive--;
        p.hp = p.maxhp * 0.5; p.inv = 2.5;
        for (const e of R.en) if (Math.hypot(e.x - p.x, e.y - p.y) < 260 && !e.def.boss) e.hp = 0, e.dead = true;
        banner('Second wind!');
        tone({ freq: 400, to: 1000, dur: 0.5, type: 'triangle', vol: 0.07 });
      } else gameOver();
    }
  }

  // ---------- Weapons ----------
  function fireWeapons(dt) {
    const p = R.p, PS = ps();
    for (const w of R.wp) {
      const st = w.st;
      const dmg = st.dmg * PS.might;
      const area = (st.area || 1) * PS.area;
      if (w.id === 'blades') {
        w.ang += st.spd * dt;
        const n = st.count;
        for (let i = 0; i < n; i++) {
          const a = w.ang + i * TAU / n, bx = p.x + Math.cos(a) * st.rad * PS.area, by = p.y + Math.sin(a) * st.rad * PS.area;
          near(bx, by, 40, e => {
            const rr = e.r + 12 * area;
            if ((e.x - bx) ** 2 + (e.y - by) ** 2 < rr * rr && R.t - (e.hitT['b' + i] || -9) > 0.45) { e.hitT['b' + i] = R.t; dmgEnemy(e, dmg, 160, p.x, p.y); }
          });
        }
        continue;
      }
      w.cd -= dt;
      if (w.cd > 0) continue;
      w.cd = st.cd * PS.cd;
      switch (w.id) {
        case 'bolt': {
          const tg = nearestEnemies(p.x, p.y, st.count, 520);
          for (let i = 0; i < st.count; i++) {
            const t = tg[i % Math.max(1, tg.length)];
            let a = t ? Math.atan2(t.y - p.y, t.x - p.x) : (p.face > 0 ? 0 : Math.PI);
            if (!t || tg.length < st.count) a += (i - (st.count - 1) / 2) * 0.12;
            R.proj.push({ k: 'bolt', x: p.x, y: p.y, vx: Math.cos(a) * st.spd, vy: Math.sin(a) * st.spd, dmg, pierce: st.pierce, r: 6 * area, life: 1.5, hit: new Set(), color: w.evolved ? '#fff2a8' : '#ff9a3d' });
          }
          tone({ freq: 700, to: 400, dur: 0.05, type: 'square', vol: 0.012 });
          break;
        }
        case 'nova': {
          for (let i = 0; i < st.count; i++) R.zones.push({ k: 'nova', x: p.x, y: p.y, r: 0, max: st.rad * area, t: -i * 0.35, dur: 0.55, hit: new Set(), dmg, follow: true });
          tone({ freq: 800, to: 1200, dur: 0.2, type: 'sine', vol: 0.025 });
          break;
        }
        case 'whip': {
          const dirs = st.count >= 2 ? [1, -1] : [w.flip];
          w.flip = -w.flip;
          let hits = 0;
          for (const d of dirs) {
            const len = st.len * area;
            R.fx.push({ k: 'whip', x: p.x, y: p.y, d, len, life: 0.18, max: 0.18, color: w.evolved ? '#ff7ad0' : '#7be36a' });
            near(p.x + d * len / 2, p.y, len, e => {
              if (Math.abs(e.y - p.y) < 30 * area + e.r && (e.x - p.x) * d > -10 && (e.x - p.x) * d < len + e.r) { dmgEnemy(e, dmg, 180, p.x, p.y); hits++; }
            });
          }
          if (st.heal && hits) p.hp = Math.min(p.maxhp, p.hp + Math.min(3, hits * 0.3));
          tone({ freq: 300, to: 150, dur: 0.1, type: 'sawtooth', vol: 0.025 });
          break;
        }
        case 'chain': {
          const hit = new Set();
          let from = { x: p.x, y: p.y };
          let cur = nearestEnemies(p.x, p.y, 1, 360)[0];
          for (let i = 0; i < st.count && cur; i++) {
            hit.add(cur.id);
            R.fx.push({ k: 'bolt', x: from.x, y: from.y, x2: cur.x, y2: cur.y, life: 0.2, max: 0.2 });
            dmgEnemy(cur, dmg, 60, from.x, from.y);
            from = cur;
            let nx = null, nd = (st.range * PS.area) ** 2;
            for (const e of R.en) { if (e.dead || hit.has(e.id)) continue; const d = (e.x - from.x) ** 2 + (e.y - from.y) ** 2; if (d < nd) { nd = d; nx = e; } }
            cur = nx;
          }
          if (hit.size) tone({ freq: 1100, to: 300, dur: 0.12, type: 'sawtooth', vol: 0.02 });
          break;
        }
        case 'flame': {
          const tg = nearestEnemies(p.x, p.y, 40, 420);
          for (let i = 0; i < st.count; i++) {
            const t = tg.length ? tg[Math.floor(Math.random() * tg.length)] : null;
            const x = t ? t.x : p.x + (Math.random() - 0.5) * 240, y = t ? t.y : p.y + (Math.random() - 0.5) * 240;
            R.zones.push({ k: 'fire', x, y, r: st.rad * area, life: st.dur, max: st.dur, tick: 0, dmg, color: w.evolved ? '#fff2a8' : '#ffb03d' });
          }
          tone({ freq: 250, to: 500, dur: 0.15, type: 'triangle', vol: 0.02 });
          break;
        }
        case 'axe': {
          for (let i = 0; i < st.count; i++) {
            R.proj.push({ k: 'axe', x: p.x, y: p.y, vx: p.face * (50 + Math.random() * 90) + (i - (st.count - 1) / 2) * 70, vy: -420 - Math.random() * 60, ay: 760, dmg, pierce: 99, r: 15 * area, life: 2.4, hit: new Set(), spin: 0, color: '#ff7a8a' });
          }
          tone({ freq: 200, to: 350, dur: 0.1, type: 'square', vol: 0.02 });
          break;
        }
        case 'meteor': {
          const tg = nearestEnemies(p.x, p.y, 30, 450);
          for (let i = 0; i < st.count; i++) {
            const t = tg.length ? tg[Math.floor(Math.random() * tg.length)] : null;
            R.zones.push({ k: 'meteor', x: t ? t.x : p.x + (Math.random() - 0.5) * 300, y: t ? t.y : p.y + (Math.random() - 0.5) * 300, r: st.rad * area, t: -i * 0.18, delay: 0.75, dmg });
          }
          break;
        }
      }
    }
  }

  function updateProjs(dt) {
    for (const q of R.proj) {
      q.life -= dt;
      if (q.life <= 0) { q.dead = true; continue; }
      if (q.ay) q.vy += q.ay * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.k === 'axe') q.spin += dt * 12;
      near(q.x, q.y, q.r + 30, e => {
        if (q.hit.has(e.id)) return;
        const rr = q.r + e.r;
        if ((e.x - q.x) ** 2 + (e.y - q.y) ** 2 > rr * rr) return;
        q.hit.add(e.id);
        dmgEnemy(e, q.dmg, 120, q.x - q.vx * 0.01, q.y - q.vy * 0.01);
        if (--q.pierce <= 0) { q.dead = true; return false; }
      });
    }
    R.proj = R.proj.filter(q => !q.dead);
    // Enemy shots.
    const p = R.p;
    for (const q of R.eproj) {
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.life <= 0) q.dead = true;
      else if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < (q.r + p.r) ** 2) { hurtPlayer(q.dmg); q.dead = true; }
    }
    R.eproj = R.eproj.filter(q => !q.dead);
  }

  function updateZones(dt) {
    const p = R.p;
    for (const z of R.zones) {
      z.t = (z.t ?? 0);
      if (z.k === 'nova') {
        z.t += dt;
        if (z.t < 0) continue;
        if (z.follow) { z.x = p.x; z.y = p.y; }
        z.r = z.max * Math.min(1, z.t / z.dur);
        near(z.x, z.y, z.max + 30, e => {
          if (z.hit.has(e.id)) return;
          const d = Math.hypot(e.x - z.x, e.y - z.y);
          if (d < z.r + e.r && d > z.r - 28 - e.r) { z.hit.add(e.id); dmgEnemy(e, z.dmg, 90, z.x, z.y); e.slow = 2; }
        });
        if (z.t >= z.dur + 0.1) z.dead = true;
      } else if (z.k === 'fire') {
        z.life -= dt; z.tick -= dt;
        if (z.tick <= 0) { z.tick = 0.3; near(z.x, z.y, z.r + 30, e => { if ((e.x - z.x) ** 2 + (e.y - z.y) ** 2 < (z.r + e.r) ** 2) dmgEnemy(e, z.dmg); }); }
        if (z.life <= 0) z.dead = true;
      } else if (z.k === 'meteor') {
        z.t += dt;
        if (z.t >= z.delay && !z.boom) {
          z.boom = true; z.dead = true;
          near(z.x, z.y, z.r + 30, e => { if ((e.x - z.x) ** 2 + (e.y - z.y) ** 2 < (z.r + e.r) ** 2) dmgEnemy(e, z.dmg, 220, z.x, z.y); });
          R.fx.push({ k: 'boom', x: z.x, y: z.y, r: z.r, life: 0.35, max: 0.35 });
          R.shake = Math.max(R.shake, 0.12);
          tone({ freq: 110, to: 40, dur: 0.2, type: 'sawtooth', vol: 0.03 });
        }
      }
    }
    R.zones = R.zones.filter(z => !z.dead);
  }

  // ---------- Level ups, chests ----------
  function addXp(v) {
    R.xp += v * ps().xp;
    while (R.xp >= R.need) {
      R.xp -= R.need;
      R.lvl++;
      R.need = needFor(R.lvl);
      R.pendingLevels = (R.pendingLevels || 0) + 1;
      if (R.lvl >= 30) Arcade.flag('last-lantern-30');
    }
  }
  function levelOptions() {
    const opts = [];
    for (const w of R.wp) if (w.lvl < 8 && !w.evolved) opts.push({ type: 'w', id: w.id, label: `${WEAPONS[w.id].name} · Lv ${w.lvl + 1}`, desc: WEAPONS[w.id].ups[w.lvl - 1].t, icon: WEAPONS[w.id].icon });
    if (R.wp.length < 6) for (const id of WEAPON_IDS) if (!R.wp.find(w => w.id === id)) opts.push({ type: 'w', id, label: `New: ${WEAPONS[id].name}`, desc: WEAPONS[id].desc, icon: WEAPONS[id].icon, isNew: true });
    for (const id of Object.keys(R.pass)) if (R.pass[id] < PASSIVES[id].max) opts.push({ type: 'p', id, label: `${PASSIVES[id].name} · Lv ${R.pass[id] + 1}`, desc: PASSIVES[id].desc, icon: PASSIVES[id].icon });
    if (Object.keys(R.pass).length < 6) for (const id of PASSIVE_IDS) if (!R.pass[id]) opts.push({ type: 'p', id, label: `New: ${PASSIVES[id].name}`, desc: PASSIVES[id].desc, icon: PASSIVES[id].icon, isNew: true });
    // Shuffle and take three.
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    const out = opts.slice(0, 3);
    while (out.length < 3) out.push(out.length % 2 ? { type: 'gold', label: 'Pouch of gold', desc: '+60 gold', icon: '💰' } : { type: 'heal', label: 'Roast chicken', desc: 'Restore 40 health', icon: '🍗' });
    return out;
  }
  function applyOption(o) {
    if (o.type === 'w') {
      const w = R.wp.find(x => x.id === o.id);
      if (w) w.lvl++; else R.wp.push({ id: o.id, lvl: 1, evolved: false, cd: 0.3, ang: 0, flip: 1 });
    } else if (o.type === 'p') R.pass[o.id] = (R.pass[o.id] || 0) + 1;
    else if (o.type === 'gold') R.gold += 60;
    else if (o.type === 'heal') R.p.hp = Math.min(R.p.maxhp, R.p.hp + 40);
    recalc();
  }
  function showLevelUp() {
    state = 'levelup';
    const opts = levelOptions();
    R.opts = opts;
    ui.show({
      title: `Level ${R.lvl}`,
      html: `<p class="ll-note">Pick an upgrade (1 / 2 / 3)</p><div class="ll-opts">${opts.map((o, i) => `<button class="ll-opt" data-act="opt" data-i="${i}" type="button"><span class="ll-ico">${o.icon}</span><span><b>${i + 1}. ${o.label}</b><small>${o.desc}</small></span>${o.isNew ? '<em>NEW</em>' : ''}</button>`).join('')}</div>`,
      button: null,
    });
    tone({ freq: 520, to: 1040, dur: 0.25, type: 'triangle', vol: 0.06 });
  }
  function chooseOption(i) {
    const o = R.opts?.[i];
    if (!o) return;
    applyOption(o);
    R.pendingLevels--;
    ui.hide();
    state = 'play';
    last = performance.now();
    if (R.pendingLevels > 0) showLevelUp();
  }
  function openChest() {
    state = 'chest';
    const lines = [];
    // Evolutions first.
    for (const w of R.wp) {
      const def = WEAPONS[w.id];
      if (w.lvl >= 8 && !w.evolved && R.pass[def.pair]) { w.evolved = true; R.evolved++; Arcade.flag('last-lantern-evolve'); lines.push(`<b>${def.name}</b> evolved into <b>${def.evo}</b>!`); break; }
    }
    if (!lines.length) {
      for (let i = 0; i < 2; i++) { const o = levelOptions().find(x => x.type === 'w' || x.type === 'p'); if (o) { applyOption(o); lines.push(`${o.icon} ${o.label}`); } }
    }
    const g = Math.round((40 + Math.random() * 60) * R.stage.gold);
    R.gold += g; lines.push(`💰 ${g} gold`);
    recalc();
    tone({ freq: 400, to: 1200, dur: 0.5, type: 'triangle', vol: 0.07 });
    ui.show({ title: 'Treasure!', html: `<div class="ll-chest">${lines.map(l => `<p>${l}</p>`).join('')}</div>`, button: 'Continue', onAction: () => { ui.hide(); state = 'play'; last = performance.now(); } });
  }

  // ---------- Update ----------
  function update(dt) {
    const p = R.p;
    R.t += dt;
    // Move.
    let mx = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    let my = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
    if (joy.on) { mx = joy.dx; my = joy.dy; }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const sp = 118 * ps().move;
    p.x += mx * sp * dt; p.y += my * sp * dt;
    if (mx) p.face = mx > 0 ? 1 : -1;
    p.inv = Math.max(0, p.inv - dt); p.hurt = Math.max(0, p.hurt - dt);
    p.hp = Math.min(p.maxhp, p.hp + ps().regen * dt);
    R.cam.x += (p.x - R.cam.x) * Math.min(1, dt * 8); R.cam.y += (p.y - R.cam.y) * Math.min(1, dt * 8);

    spawnDirector(dt);
    buildGrid();
    fireWeapons(dt);
    // Enemies.
    const frame = Math.floor(R.t * 60);
    for (const e of R.en) {
      if (e.dead) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      if (e.slow > 0) e.slow -= dt;
      const s = e.spd * (e.slow > 0 ? 0.55 : 1);
      e.vx *= Math.pow(0.001, dt); e.vy *= Math.pow(0.001, dt);
      e.x += (dx / d * s + e.vx) * dt; e.y += (dy / d * s + e.vy) * dt;
      e.flash = Math.max(0, e.flash - dt);
      // Soft separation (a third of the crowd per frame).
      if (!e.def.ghost && (e.id + frame) % 3 === 0) {
        near(e.x, e.y, e.r + 14, o => {
          if (o === e || o.def.ghost) return;
          const ox = e.x - o.x, oy = e.y - o.y, dd = Math.hypot(ox, oy) || 0.1, min = e.r + o.r - 2;
          if (dd < min) { const push = (min - dd) * 0.5; e.x += ox / dd * push; e.y += oy / dd * push; }
        });
      }
      // Touch damage.
      if (d < e.r + p.r) hurtPlayer(e.dmg);
      // Boss rings.
      if (e.boss) {
        e.atk -= dt;
        if (e.atk <= 0) {
          e.atk = e.hp < e.max * 0.5 ? 1.8 : 2.8;
          const n = e.hp < e.max * 0.5 ? 18 : 12, base = Math.random() * TAU;
          for (let i = 0; i < n; i++) { const a = base + i / n * TAU; R.eproj.push({ x: e.x, y: e.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, r: 7, dmg: e.dmg * 0.7, life: 5 }); }
        }
      }
      // Wander far enemies back to the ring.
      if (d > 900 && !e.def.boss && !e.def.elite) { const a = Math.random() * TAU; e.x = p.x + Math.cos(a) * 560; e.y = p.y + Math.sin(a) * 560; }
    }
    updateProjs(dt);
    updateZones(dt);
    R.en = R.en.filter(e => !e.dead);
    // Pickups.
    const mag = 70 * ps().magnet;
    for (const g of R.gems) {
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d < mag || g.pull) { g.pull = true; const s = 320 + (g.t = (g.t || 0) + dt) * 500; g.x += (p.x - g.x) / d * s * dt; g.y += (p.y - g.y) / d * s * dt; }
      if (d < 14) { g.dead = true; addXp(g.v); tone({ freq: 800 + Math.random() * 300, dur: 0.03, type: 'sine', vol: 0.01 }); }
    }
    R.gems = R.gems.filter(g => !g.dead);
    if (R.gems.length > 500) { for (const g of R.gems.splice(0, 150)) addXp(g.v); }
    for (const k of R.pick) {
      const d = Math.hypot(p.x - k.x, p.y - k.y);
      if (k.k !== 'chest' && d < mag) { k.x += (p.x - k.x) / d * 300 * dt; k.y += (p.y - k.y) / d * 300 * dt; }
      if (d < (k.k === 'chest' ? 26 : 14)) {
        k.dead = true;
        if (k.k === 'coin') { const v = Math.max(1, Math.round(k.v * ps().gold)); R.gold += v; tone({ freq: 1200, to: 1500, dur: 0.05, type: 'square', vol: 0.015 }); }
        else if (k.k === 'food') { p.hp = Math.min(p.maxhp, p.hp + 30); }
        else if (k.k === 'chest') { R.chestNow = true; }
      }
    }
    R.pick = R.pick.filter(k => !k.dead);
    for (const f of R.fx) { f.life -= dt; if (f.k === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; } }
    R.fx = R.fx.filter(f => f.life > 0);
    for (const t of R.txt) { t.life -= dt; t.y -= 26 * dt; }
    R.txt = R.txt.filter(t => t.life > 0);
    if (R.banner) { R.banner.t -= dt; if (R.banner.t <= 0) R.banner = null; }
    R.shake = Math.max(0, R.shake - dt * 2.5);
    if (R.t >= 300 && R.t - dt < 300) Arcade.flag('last-lantern-5');
    if (R.t >= 600 && R.t - dt < 600) Arcade.flag('last-lantern-10');
    if (R.kills >= 1000) Arcade.flag('last-lantern-1000');
    if (R.pendingLevels > 0 && state === 'play') showLevelUp();
    else if (R.chestNow && state === 'play') { R.chestNow = false; openChest(); }
  }

  // ---------- Ending ----------
  const score = () => Math.round((R.kills * 10 + Math.floor(R.t) * 8 + R.lvl * 50 + (R.won || R.endless ? 5000 : 0)) * R.stage.mult);
  function bank() {
    save.gold += R.gold;
    const bt = save.bestTime[R.stage.id] || 0;
    if (R.t > bt) save.bestTime[R.stage.id] = Math.floor(R.t);
    persist();
  }
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function summary() {
    return `<p>${mmss(R.t)} survived · ${R.kills.toLocaleString()} foes · level ${R.lvl} · <b>+${R.gold.toLocaleString()} gold</b> (${save.gold.toLocaleString()} banked)</p>
      <p class="ll-note">${R.stage.name} · ${R.ch.name}</p>`;
  }
  function gameOver() {
    state = 'over';
    bank();
    tone({ freq: 300, to: 40, dur: 0.9, type: 'sawtooth', vol: 0.08 });
    const s = score();
    setTimeout(() => Arcade.finish(ui, {
      score: s, title: 'The light went out',
      html: summary() + '<div class="ll-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>',
      button: 'Try again', onAction: () => startRun(R.stage.id, R.ch.id),
    }), 500);
  }
  function win() {
    R.won = true;
    state = 'won';
    for (const e of R.en) { e.hp = 0; e.dead = true; }
    R.eproj = [];
    save.cleared[R.stage.id] = true;
    Arcade.flag('last-lantern-win');
    if (STAGES.every(s => save.cleared[s.id])) Arcade.flag('last-lantern-all');
    persist();
    tone({ freq: 523, to: 1046, dur: 0.8, type: 'triangle', vol: 0.07 });
    ui.show({
      title: 'Dawn breaks',
      html: `<p class="ll-big">You survived the night.</p>${summary()}
        <div class="ll-row"><button class="btn" data-act="endless" type="button">Keep fighting (Endless)</button><button class="btn secondary" data-act="finish" type="button">Finish</button></div>`,
      button: null,
    });
  }
  function finishWin() {
    state = 'over';
    bank();
    Arcade.finish(ui, { score: score(), title: 'Stage cleared', html: summary() + '<div class="ll-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>', button: 'Play again', onAction: () => startRun(R.stage.id, R.ch.id) });
  }

  // ---------- Rendering ----------
  const sx = x => x - R.cam.x + W / 2, sy = y => y - R.cam.y + H / 2;
  function enemyColor(e) {
    const d = e.def;
    if (d.boss) return R.stage.accent;
    if (d.elite) return '#ffd23f';
    const i = e.type.length % 2;
    return R.stage.tints[i];
  }
  function drawEnemy(e) {
    const x = sx(e.x), y = sy(e.y), r = e.r;
    if (x < -60 || x > W + 60 || y < -60 || y > H + 60) return;
    const col = e.flash > 0 ? '#fff' : enemyColor(e);
    ctx.save(); ctx.translate(x, y);
    if (e.def.ghost) ctx.globalAlpha = 0.75;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, r * 0.7, r, r * 0.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5;
    const wob = Math.sin(R.t * 8 + e.ph);
    switch (e.def.shape) {
      case 'bat': ctx.beginPath(); ctx.ellipse(0, 0, r * 0.6, r * 0.5, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-r * 1.5, -r * 0.8 * wob - 2); ctx.lineTo(-r * 0.5, r * 0.5); ctx.moveTo(0, 0); ctx.lineTo(r * 1.5, -r * 0.8 * wob - 2); ctx.lineTo(r * 0.5, r * 0.5); ctx.fill(); break;
      case 'tri': ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, r * 0.8); ctx.lineTo(-r, r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'block': ctx.fillRect(-r, -r, r * 2, r * 2); ctx.strokeRect(-r, -r, r * 2, r * 2); break;
      case 'wisp': ctx.beginPath(); ctx.arc(0, -2, r, Math.PI, 0); ctx.lineTo(r, r); ctx.lineTo(r * 0.4, r * 0.6 + wob * 2); ctx.lineTo(-r * 0.4, r + wob * 2); ctx.lineTo(-r, r * 0.6); ctx.closePath(); ctx.fill(); break;
      case 'boss': ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.2, r * 0.18, 0, TAU); ctx.arc(r * 0.35, -r * 0.2, r * 0.18, 0, TAU); ctx.fill(); break;
      default: ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
    }
    if (e.def.shape !== 'boss' && e.def.shape !== 'bat') { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.15, Math.max(1.6, r * 0.14), 0, TAU); ctx.arc(r * 0.32, -r * 0.15, Math.max(1.6, r * 0.14), 0, TAU); ctx.fill(); }
    if (e.def.elite) { ctx.strokeStyle = '#fff6a8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, TAU); ctx.stroke(); }
    if (e.slow > 0) { ctx.fillStyle = 'rgba(160,230,255,.35)'; ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, TAU); ctx.fill(); }
    if (e.def.boss || e.def.elite) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(-r, -r - 12, r * 2, 5); ctx.fillStyle = '#ff5d5d'; ctx.fillRect(-r, -r - 12, r * 2 * Math.max(0, e.hp / e.max), 5); }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!R) { ctx.fillStyle = '#10131a'; ctx.fillRect(0, 0, W, H); return; }
    const shx = (Math.random() - 0.5) * R.shake * 10, shy = (Math.random() - 0.5) * R.shake * 10;
    ctx.save(); ctx.translate(shx, shy);
    // Ground.
    const ox = -((R.cam.x % 256) + 256) % 256, oy = -((R.cam.y % 256) + 256) % 256;
    for (let x = ox - 256; x < W + 256; x += 256) for (let y = oy - 256; y < H + 256; y += 256) ctx.drawImage(bgTile, Math.round(x), Math.round(y));
    // Zones.
    for (const z of R.zones) {
      const x = sx(z.x), y = sy(z.y);
      if (z.k === 'fire') { const a = Math.min(1, z.life / 0.5); ctx.fillStyle = `rgba(255,150,40,${0.28 * a})`; ctx.beginPath(); ctx.arc(x, y, z.r, 0, TAU); ctx.fill(); ctx.strokeStyle = `rgba(255,210,100,${0.7 * a})`; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = z.color; for (let i = 0; i < 5; i++) { const a2 = i * 1.3 + R.t * 3; ctx.beginPath(); ctx.arc(x + Math.cos(a2) * z.r * 0.5, y + Math.sin(a2 * 1.3) * z.r * 0.5, 3, 0, TAU); ctx.fill(); } }
      else if (z.k === 'nova' && z.t >= 0) { ctx.strokeStyle = `rgba(174,230,255,${1 - z.t / (z.dur + 0.1)})`; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(x, y, Math.max(1, z.r), 0, TAU); ctx.stroke(); }
      else if (z.k === 'meteor' && z.t >= 0) { const k = z.t / z.delay; ctx.strokeStyle = 'rgba(255,90,50,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, z.r, 0, TAU); ctx.stroke(); ctx.fillStyle = 'rgba(255,90,50,.18)'; ctx.beginPath(); ctx.arc(x, y, z.r * k, 0, TAU); ctx.fill(); ctx.fillStyle = '#ff7a45'; ctx.beginPath(); ctx.arc(x, y - (1 - k) * 360, 9, 0, TAU); ctx.fill(); }
    }
    // Pickups.
    for (const g of R.gems) { const x = sx(g.x), y = sy(g.y); ctx.fillStyle = g.v >= 14 ? '#ff7a8a' : g.v >= 3 ? '#7ef2ff' : '#7be36a'; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fill(); }
    for (const k of R.pick) {
      const x = sx(k.x), y = sy(k.y);
      if (k.k === 'coin') { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill(); ctx.strokeStyle = '#8a6d00'; ctx.stroke(); }
      else if (k.k === 'food') { ctx.font = '16px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🍗', x, y + 5); }
      else { const b = Math.sin(R.t * 5) * 2; ctx.fillStyle = '#c98a3a'; ctx.fillRect(x - 14, y - 10 + b, 28, 20); ctx.fillStyle = '#ffd23f'; ctx.fillRect(x - 14, y - 2 + b, 28, 4); ctx.strokeStyle = '#4a2f10'; ctx.lineWidth = 2; ctx.strokeRect(x - 14, y - 10 + b, 28, 20); ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 14; ctx.strokeRect(x - 14, y - 10 + b, 28, 20); ctx.shadowBlur = 0; }
    }
    // Enemies, back to front.
    R.en.sort((a, b) => a.y - b.y);
    for (const e of R.en) drawEnemy(e);
    // Player.
    const p = R.p, px = sx(p.x), py = sy(p.y);
    if (p.inv <= 0 || Math.floor(R.t * 20) % 2) {
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(px, py + 9, 11, 5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = R.ch.color; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py - 14); ctx.lineTo(px + 11, py + 9); ctx.lineTo(px - 11, py + 9); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = p.hurt > 0 ? '#ff5d5d' : '#ffe9c0'; ctx.beginPath(); ctx.arc(px, py - 7, 6, 0, TAU); ctx.fill(); ctx.stroke();
      // Lantern.
      const lx = px + p.face * 13, ly = py + 1;
      ctx.fillStyle = '#ffd23f'; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(lx, ly, 5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    }
    // Spirit blades.
    for (const w of R.wp) if (w.id === 'blades') {
      for (let i = 0; i < w.st.count; i++) {
        const a = w.ang + i * TAU / w.st.count, bx = px + Math.cos(a) * w.st.rad * ps().area, by = py + Math.sin(a) * w.st.rad * ps().area;
        ctx.save(); ctx.translate(bx, by); ctx.rotate(a + Math.PI / 2); ctx.fillStyle = w.evolved ? '#fff' : '#9ff0ff'; ctx.strokeStyle = '#0a3a4a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -14 * ps().area); ctx.lineTo(6, 4); ctx.lineTo(0, 8); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      }
    }
    // Projectiles.
    for (const q of R.proj) {
      const x = sx(q.x), y = sy(q.y);
      if (q.k === 'axe') { ctx.save(); ctx.translate(x, y); ctx.rotate(q.spin); ctx.fillStyle = '#ff7a8a'; ctx.strokeStyle = '#4a0a14'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-14, -3); ctx.lineTo(14, -3); ctx.lineTo(14, 3); ctx.lineTo(-14, 3); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(10, 0, 10, -1.2, 1.2); ctx.fill(); ctx.restore(); }
      else { ctx.fillStyle = q.color; ctx.shadowColor = q.color; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x, y, q.r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }
    }
    for (const q of R.eproj) { const x = sx(q.x), y = sy(q.y); ctx.fillStyle = '#ff4d6d'; ctx.shadowColor = '#ff4d6d'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x, y, q.r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }
    // Effects.
    for (const f of R.fx) {
      const k = f.life / f.max;
      if (f.k === 'dot') { ctx.globalAlpha = k; ctx.fillStyle = f.color; ctx.fillRect(sx(f.x) - 2, sy(f.y) - 2, 4, 4); ctx.globalAlpha = 1; }
      else if (f.k === 'whip') { const x = sx(f.x), y = sy(f.y); ctx.globalAlpha = k; ctx.fillStyle = f.color; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + f.d * f.len * 0.5, y - 36, x + f.d * f.len, y - 4); ctx.quadraticCurveTo(x + f.d * f.len * 0.5, y + 10, x, y); ctx.fill(); ctx.globalAlpha = 1; }
      else if (f.k === 'bolt') { ctx.globalAlpha = k; ctx.strokeStyle = '#d6e0ff'; ctx.lineWidth = 3; ctx.shadowColor = '#b9c9ff'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.moveTo(sx(f.x), sy(f.y)); ctx.lineTo((sx(f.x) + sx(f.x2)) / 2 + (Math.random() - 0.5) * 16, (sy(f.y) + sy(f.y2)) / 2 + (Math.random() - 0.5) * 16); ctx.lineTo(sx(f.x2), sy(f.y2)); ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1; }
      else if (f.k === 'boom') { ctx.fillStyle = `rgba(255,140,60,${k * 0.6})`; ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), f.r * (1.2 - k * 0.3), 0, TAU); ctx.fill(); }
    }
    ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
    for (const t of R.txt) { ctx.globalAlpha = t.life / t.max; ctx.fillStyle = t.bad ? '#ff6a6a' : '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(t.v, sx(t.x), sy(t.y)); ctx.fillText(t.v, sx(t.x), sy(t.y)); ctx.globalAlpha = 1; }
    ctx.restore();
    // Darkness with a pool of light.
    const gr = ctx.createRadialGradient(px, py, 90, px, py, 520);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,12,.55)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    drawHud();
    if (joy.on) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(joy.ox, joy.oy, 40, 0, TAU); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.arc(joy.ox + joy.dx * 34, joy.oy + joy.dy * 34, 18, 0, TAU); ctx.fill(); }
  }

  function drawHud() {
    // XP bar.
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, 16);
    ctx.fillStyle = '#4aa8ff'; ctx.fillRect(0, 0, W * Math.min(1, R.xp / R.need), 16);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('LV ' + R.lvl, W - 8, 9);
    // Timer.
    ctx.textAlign = 'center'; ctx.font = 'bold 26px system-ui'; ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
    const tt = R.endless ? mmss(R.t) : mmss(Math.max(0, WIN_AT - R.t));
    ctx.strokeText(tt, W / 2, 38); ctx.fillStyle = '#fff'; ctx.fillText(tt, W / 2, 38);
    ctx.font = '11px system-ui'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText(R.endless ? 'ENDLESS' : 'UNTIL DAWN', W / 2, 56);
    // Kills and gold.
    ctx.textAlign = 'right'; ctx.font = 'bold 15px system-ui'; ctx.fillStyle = '#fff';
    ctx.fillText(`☠ ${R.kills.toLocaleString()}`, W - 10, 32); ctx.fillStyle = '#ffd23f'; ctx.fillText(`● ${R.gold.toLocaleString()}`, W - 10, 52);
    // Health.
    const hx = 10, hy = 26;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(hx, hy, 160, 14);
    ctx.fillStyle = R.p.hp < R.p.maxhp * 0.3 ? '#ff4d4d' : '#d9534f'; ctx.fillRect(hx, hy, 160 * Math.max(0, R.p.hp / R.p.maxhp), 14);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left'; ctx.fillText(`${Math.ceil(R.p.hp)} / ${Math.round(R.p.maxhp)}`, hx + 6, hy + 8);
    // Weapons and passives.
    ctx.font = '18px system-ui'; ctx.textAlign = 'center';
    R.wp.forEach((w, i) => { const x = 22 + i * 34, y = H - 50; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 15, y - 15, 30, 30); ctx.strokeStyle = w.evolved ? '#ffd23f' : 'rgba(255,255,255,.3)'; ctx.lineWidth = 2; ctx.strokeRect(x - 15, y - 15, 30, 30); ctx.fillStyle = '#fff'; ctx.fillText(WEAPONS[w.id].icon, x, y + 6); ctx.font = 'bold 10px system-ui'; ctx.fillStyle = '#ffd23f'; ctx.fillText(w.evolved ? '★' : w.lvl, x + 10, y + 13); ctx.font = '18px system-ui'; });
    Object.keys(R.pass).forEach((id, i) => { const x = 22 + i * 34, y = H - 16; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 14, y - 12, 28, 24); ctx.fillStyle = '#fff'; ctx.font = '14px system-ui'; ctx.fillText(PASSIVES[id].icon, x, y + 5); ctx.font = 'bold 9px system-ui'; ctx.fillStyle = '#7ef2ff'; ctx.fillText(R.pass[id], x + 10, y + 10); });
    if (R.banner) { ctx.globalAlpha = Math.min(1, R.banner.t); ctx.font = 'bold 24px system-ui'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.textAlign = 'center'; ctx.strokeText(R.banner.text, W / 2, 130); ctx.fillText(R.banner.text, W / 2, 130); ctx.globalAlpha = 1; }
  }

  // ---------- Input ----------
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && state === 'play') e.preventDefault();
    keys.add(e.code);
    if (state === 'levelup' && /^Digit[1-3]$/.test(e.code)) chooseOption(+e.code.slice(5) - 1);
    if ((e.code === 'KeyP' || e.code === 'Escape') && (state === 'play' || state === 'paused')) togglePause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'play' || e.pointerType === 'mouse') return;
    const r = canvas.getBoundingClientRect();
    joy.on = true; joy.ox = (e.clientX - r.left) * W / r.width; joy.oy = (e.clientY - r.top) * H / r.height; joy.dx = joy.dy = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!joy.on) return;
    const r = canvas.getBoundingClientRect();
    const dx = (e.clientX - r.left) * W / r.width - joy.ox, dy = (e.clientY - r.top) * H / r.height - joy.oy;
    const l = Math.hypot(dx, dy) || 1, k = Math.min(1, l / 40);
    joy.dx = dx / l * k; joy.dy = dy / l * k;
  });
  const joyEnd = () => { joy.on = false; joy.dx = joy.dy = 0; };
  canvas.addEventListener('pointerup', joyEnd); canvas.addEventListener('pointercancel', joyEnd);
  function togglePause() {
    if (state === 'play') {
      state = 'paused';
      ui.show({ title: 'Paused', html: `<p class="ll-note">${mmss(R.t)} · ${R.kills} foes</p><div class="ll-row"><button class="btn secondary" data-act="quit" type="button">Give up</button></div>`, button: 'Resume', onAction: togglePause });
    } else if (state === 'paused') { ui.hide(); state = 'play'; last = performance.now(); }
  }
  Arcade.onBlur(() => { if (state === 'play') togglePause(); keys.clear(); });

  // ---------- Menus ----------
  let pickChar = null;
  function showMenu() {
    state = 'menu'; R = null;
    ui.show({
      title: 'Pixel Pioneers Arcade',
      html: `<h2 class="ll-title">LAST LANTERN</h2><p class="ll-note">Keep the light burning until dawn.</p>
        <div class="ll-menu">
          <button class="btn" data-act="chars" type="button">Play</button>
          <button class="btn secondary" data-act="shop" type="button">Upgrades · ${save.gold.toLocaleString()} gold</button>
          <button class="btn secondary" data-act="howto" type="button">How to play</button>
        </div><p class="ll-note">${save.kills.toLocaleString()} foes slain in total</p>`,
      button: null,
    });
  }
  function showHowTo() {
    ui.show({
      title: 'How to play',
      html: `<ul style="text-align:left"><li><b>Move</b> with WASD or the arrow keys (drag on a touch screen). Your lantern <b>attacks on its own</b>.</li>
        <li>Collect <b>light gems</b> from fallen foes to level up and pick an upgrade (<b>1 / 2 / 3</b>). You can carry six weapons and six passives.</li>
        <li>Bring a weapon to <b>level 8</b> while holding its matching passive, then open a <b>boss or elite chest</b> to <b>evolve</b> it.</li>
        <li>Survive <b>15 minutes</b> until dawn. Bosses come at 5, 10 and 15; swarm rings at 3, 6, 9 and 12.</li>
        <li>Gold you collect is kept even if you fall. Spend it on <b>permanent upgrades</b> and new keepers.</li></ul>
        <div class="ll-row"><button class="btn" data-act="menu" type="button">Got it</button></div>`, button: null,
    });
  }
  function showChars() {
    const cards = CHARS.map(c => {
      const own = save.chars.includes(c.id), on = save.char === c.id;
      const w = WEAPONS[c.start];
      const act = own ? `<button class="btn ${on ? '' : 'secondary'}" data-act="pickchar" data-id="${c.id}" type="button">${on ? 'Selected ✓' : 'Select'}</button>`
        : `<button class="btn secondary" data-act="buychar" data-id="${c.id}" type="button" ${save.gold >= c.cost ? '' : 'disabled'}>Unlock · ${c.cost.toLocaleString()}</button>`;
      return `<div class="ll-card ${on ? 'on' : ''}"><i style="background:${c.color}"></i><b>${c.name}</b><small>${c.perk}</small><small>Starts with ${w.icon} ${w.name}</small>${act}</div>`;
    }).join('');
    ui.show({ title: 'Choose a keeper', html: `<div class="ll-top"><button class="btn secondary" data-act="menu" type="button">← Menu</button><span>${save.gold.toLocaleString()} gold</span></div><div class="ll-cards">${cards}</div><div class="ll-row"><button class="btn" data-act="stages" type="button">Choose a stage →</button></div>`, button: null });
  }
  function showStages() {
    const cards = STAGES.map(s => {
      const ok = !s.need || save.cleared[s.need];
      const bt = save.bestTime[s.id];
      return `<button class="ll-stage" data-act="go" data-id="${s.id}" type="button" ${ok ? '' : 'disabled'} style="--c:${s.accent}"><b>${ok ? s.name : 'Locked'}</b><small>${ok ? s.blurb : 'Survive the stage before it'}</small><small>${ok ? `${save.cleared[s.id] ? '★ Cleared · ' : ''}${bt ? 'Best ' + mmss(bt) : 'Not played'} · gold ×${s.gold}` : ''}</small></button>`;
    }).join('');
    ui.show({ title: 'Choose a stage', html: `<div class="ll-top"><button class="btn secondary" data-act="chars" type="button">← Keepers</button><span>${CHARS.find(c => c.id === save.char).name}</span></div><div class="ll-stages">${cards}</div>`, button: null });
  }
  function showShop() {
    const rows = META.map(m => {
      const r = mr(m.id), maxed = r >= m.max, cost = LL.metaCost(m, r);
      return `<div class="ll-up"><div><b>${m.name}</b> <span class="ll-pips">${'●'.repeat(r)}${'○'.repeat(m.max - r)}</span><small>${m.desc}</small></div>${maxed ? '<button class="btn secondary" disabled type="button">Max</button>' : `<button class="btn secondary" data-act="buymeta" data-id="${m.id}" type="button" ${save.gold >= cost ? '' : 'disabled'}>${cost.toLocaleString()}</button>`}</div>`;
    }).join('');
    ui.show({ title: 'Upgrades', html: `<div class="ll-top"><button class="btn secondary" data-act="menu" type="button">← Menu</button><span>${save.gold.toLocaleString()} gold</span></div><div class="ll-ups">${rows}</div>`, button: null });
  }
  overlayEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'opt': chooseOption(+d.i); break;
      case 'menu': showMenu(); break;
      case 'chars': showChars(); break;
      case 'stages': showStages(); break;
      case 'shop': showShop(); break;
      case 'howto': showHowTo(); break;
      case 'pickchar': save.char = d.id; persist(); showChars(); break;
      case 'buychar': { const c = CHARS.find(x => x.id === d.id); if (c && save.gold >= c.cost) { save.gold -= c.cost; save.chars.push(c.id); save.char = c.id; persist(); if (save.chars.length >= CHARS.length) Arcade.flag('last-lantern-chars'); showChars(); } break; }
      case 'buymeta': { const m = META.find(x => x.id === d.id); const r = mr(m.id); if (m && r < m.max && save.gold >= LL.metaCost(m, r)) { save.gold -= LL.metaCost(m, r); save.meta[m.id] = r + 1; persist(); showShop(); } break; }
      case 'go': startRun(d.id, save.char); break;
      case 'quit': if (R) { bank(); } showMenu(); break;
      case 'endless': R.endless = true; ui.hide(); state = 'play'; last = performance.now(); break;
      case 'finish': finishWin(); break;
    }
  });

  // ---------- Loop ----------
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (R && state === 'play') update(dt);
    else if (R && (state === 'won' || state === 'over' || state === 'levelup' || state === 'chest' || state === 'paused')) { /* frozen */ }
    draw();
    requestAnimationFrame(frame);
  }
  showMenu();
  if (!save.seen) { save.seen = true; persist(); showHowTo(); }
  requestAnimationFrame(frame);
})();
