(() => {
  const ID = 'rampart';
  const W = 960, H = 540;
  const COLS = 20, ROWS = 12, CELL = 40, GX = 0, GY = 50;
  const PANEL_X = COLS * CELL + 6, PANEL_W = W - PANEL_X - 6;
  const ENTRY = { c: 0, r: 5 }, EXIT = { c: COLS - 1, r: 6 };
  const START_GOLD = 150, START_LIVES = 20, BUILD_TIME = 15;
  const INTEREST = 0.05, INTEREST_CAP = 30;

  const ENEMIES = {
    grunt: { name: 'Grunt', hp: 32, speed: 1.25, bounty: 3, pts: 10, leak: 1, color: '#9be37a', r: 0.28 },
    runner: { name: 'Runner', hp: 20, speed: 2.3, bounty: 3, pts: 10, leak: 1, color: '#ffd54f', r: 0.22 },
    brute: { name: 'Brute', hp: 140, speed: 0.75, bounty: 8, pts: 25, leak: 2, armor: 3, color: '#ef8354', r: 0.38 },
    flyer: { name: 'Flyer', hp: 28, speed: 1.5, bounty: 4, pts: 12, leak: 1, fly: true, color: '#7fdbff', r: 0.26 },
    healer: { name: 'Healer', hp: 45, speed: 1.1, bounty: 6, pts: 18, leak: 1, heal: 6, color: '#ff8fab', r: 0.28 },
    splitter: { name: 'Splitter', hp: 60, speed: 1.0, bounty: 5, pts: 15, leak: 1, split: 'runner', color: '#c39bff', r: 0.32 },
    boss: { name: 'Warlord', hp: 1000, speed: 0.6, bounty: 60, pts: 300, leak: 10, armor: 5, color: '#ff4d6d', r: 0.48 },
  };
  // When each enemy type starts turning up.
  const UNLOCK = { grunt: 1, runner: 3, brute: 5, flyer: 7, healer: 9, splitter: 11 };
  const MODS = {
    Swift: 'Enemies move 35% faster',
    Armored: 'Enemies have +3 armor',
    Swarm: 'Twice as many, but weaker',
    Regen: 'Enemies heal over time',
  };

  const TOWERS = {
    wall: { name: 'Wall', key: '1', cost: 4, color: '#5b6478', desc: 'Blocks the path. Make them walk.' },
    bolt: { name: 'Bolt', key: '2', cost: 35, dmg: 9, range: 2.6, rate: 0.45, color: '#ffd23f', desc: 'Fast single shots' },
    frost: { name: 'Frost', key: '3', cost: 55, dmg: 3, range: 2.1, rate: 0.9, slow: 0.45, slowT: 1.6, color: '#7fdbff', desc: 'Chills everything in range' },
    cannon: { name: 'Cannon', key: '4', cost: 80, dmg: 26, range: 3.0, rate: 1.5, splash: 0.95, ground: true, color: '#ff8a3d', desc: 'Splash damage, ground only' },
    spark: { name: 'Spark', key: '5', cost: 110, dmg: 16, range: 2.5, rate: 1.1, chain: 3, pierce: true, color: '#c39bff', desc: 'Chains to 4 foes, ignores armor' },
  };
  const TOOL_IDS = Object.keys(TOWERS);
  const MAX_LEVEL = 3;
  const upgradeCost = t => Math.round(TOWERS[t.type].cost * (t.level === 1 ? 0.8 : 1.4));
  const towerStat = (t, k) => {
    const T = TOWERS[t.type];
    if (k === 'dmg') return T.dmg * Math.pow(1.6, t.level - 1);
    if (k === 'range') return T.range + 0.25 * (t.level - 1);
    if (k === 'slow') return Math.min(0.7, T.slow + 0.1 * (t.level - 1));
    if (k === 'chain') return T.chain + (t.level - 1);
    return T[k];
  };

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';   // 'build' | 'wave' | 'paused' | 'over'
  let grid, dist, towers, enemies, shots, effects, popups;
  let gold, lives, wave, score, kills, spawnQ, spawnT, buildT, nextWave, speedUp, tool, selected, hover, leakedRun, buttons;
  let time = 0;

  // ---------- Grid and paths ----------

  const inGrid = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
  const idx = (c, r) => r * COLS + c;

  // Distance (in steps) from every open cell to the exit. Enemies always step downhill.
  function flow(blocked) {
    const d = new Array(COLS * ROWS).fill(Infinity);
    const q = [[EXIT.c, EXIT.r]];
    d[idx(EXIT.c, EXIT.r)] = 0;
    for (let h = 0; h < q.length; h++) {
      const [c, r] = q[h];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (!inGrid(nc, nr) || blocked[idx(nc, nr)] || d[idx(nc, nr)] !== Infinity) continue;
        d[idx(nc, nr)] = d[idx(c, r)] + 1;
        q.push([nc, nr]);
      }
    }
    return d;
  }
  const blockedMap = () => grid.map(g => g !== null);

  // A cell can be built on if it's empty, nobody is standing in it, and every walker can still reach the exit.
  function canBuild(c, r) {
    if (!inGrid(c, r) || grid[idx(c, r)] !== null) return false;
    if ((c === ENTRY.c && r === ENTRY.r) || (c === EXIT.c && r === EXIT.r)) return false;
    for (const e of enemies) {
      if (e.fly) continue;
      if (Math.round(e.x) === c && Math.round(e.y) === r) return false;
      if (e.target && e.target.c === c && e.target.r === r) return false;
    }
    const b = blockedMap();
    b[idx(c, r)] = true;
    const d = flow(b);
    if (d[idx(ENTRY.c, ENTRY.r)] === Infinity) return false;
    for (const e of enemies) {
      if (e.fly) continue;
      const ec = Math.round(e.x), er = Math.round(e.y);
      if (inGrid(ec, er) && d[idx(ec, er)] === Infinity) return false;
    }
    return true;
  }

  function nextStep(c, r) {
    let best = null, bd = dist[idx(c, r)];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (inGrid(nc, nr) && dist[idx(nc, nr)] < bd) {
        bd = dist[idx(nc, nr)];
        best = { c: nc, r: nr };
      }
    }
    return best;
  }

  function pathFromEntry() {
    const out = [];
    let c = ENTRY.c, r = ENTRY.r;
    for (let k = 0; k < COLS * ROWS && !(c === EXIT.c && r === EXIT.r); k++) {
      const n = nextStep(c, r);
      if (!n) break;
      out.push(n);
      c = n.c;
      r = n.r;
    }
    return out;
  }

  // ---------- Setup ----------

  function reset() {
    grid = new Array(COLS * ROWS).fill(null);
    // A handful of boulders so every map plays a little differently.
    for (let k = 0; k < 14; k++) {
      const c = Arcade.randInt(2, COLS - 3), r = Arcade.randInt(0, ROWS - 1);
      if (grid[idx(c, r)] !== null) continue;
      grid[idx(c, r)] = 'rock';
      if (flow(blockedMap())[idx(ENTRY.c, ENTRY.r)] === Infinity) grid[idx(c, r)] = null;
    }
    dist = flow(blockedMap());
    towers = [];
    enemies = [];
    shots = [];
    effects = [];
    popups = [];
    gold = START_GOLD;
    lives = START_LIVES;
    wave = 0;
    score = 0;
    kills = 0;
    spawnQ = [];
    spawnT = 0;
    buildT = Infinity;
    speedUp = false;
    tool = 'wall';
    selected = null;
    hover = null;
    leakedRun = 0;
    buttons = [];
    nextWave = makeWave(1);
    updateHud();
  }

  function makeWave(n) {
    const kinds = Object.keys(UNLOCK).filter(k => n >= UNLOCK[k]);
    const featured = Arcade.pick(kinds);
    const mod = n >= 6 && Math.random() < 0.5 ? Arcade.pick(Object.keys(MODS)) : null;
    let count = 8 + Math.floor(n * 1.5);
    if (mod === 'Swarm') count = Math.round(count * 1.7);
    const list = [];
    for (let i = 0; i < count; i++) list.push(Math.random() < 0.5 ? featured : Arcade.pick(kinds));
    if (n % 10 === 0) list.push('boss');
    const counts = {};
    for (const k of list) counts[k] = (counts[k] || 0) + 1;
    return { n, list, mod, counts, gap: mod === 'Swarm' ? 0.4 : Math.max(0.45, 0.85 - n * 0.01) };
  }

  function startWave() {
    if (state !== 'build') return;
    // Calling a wave early pays the seconds you skipped. Saving gold pays interest.
    const early = isFinite(buildT) ? Math.floor(buildT) : 0;
    const interest = Math.min(INTEREST_CAP, Math.floor(gold * INTEREST));
    gold += early + interest;
    if (early + interest > 0) popups.push({ x: COLS * CELL / 2, y: GY + 30, text: `+${early + interest} gold${interest ? ` (${interest} interest)` : ''}`, t: 0, color: '#ffd23f' });
    wave = nextWave.n;
    spawnQ = nextWave.list.map(k => ({ kind: k, mod: nextWave.mod }));
    spawnT = 0.5;
    state = 'wave';
    nextWave = makeWave(wave + 1);
    Arcade.tone({ freq: 200, to: 400, dur: 0.3, type: 'square', vol: 0.05 });
    updateHud();
  }

  function spawn(kind, mod, at) {
    const E = ENEMIES[kind];
    const scale = Math.pow(1.12, wave - 1) * (mod === 'Swarm' ? 0.6 : 1);
    const hp = E.hp * scale;
    enemies.push({
      kind, hp, max: hp, x: at ? at.x : -0.6, y: at ? at.y : ENTRY.r, target: at ? null : { c: 0, r: ENTRY.r },
      speed: E.speed * (mod === 'Swift' ? 1.35 : 1), armor: (E.armor || 0) + (mod === 'Armored' ? 3 : 0),
      regen: mod === 'Regen' ? 0.03 : 0, slowT: 0, slow: 0, fly: !!E.fly, wobble: Math.random() * 6,
    });
  }

  // ---------- Building ----------

  function place(c, r) {
    const T = TOWERS[tool];
    if (gold < T.cost) return flash('Not enough gold');
    if (!canBuild(c, r)) return flash('That would block the path');
    gold -= T.cost;
    grid[idx(c, r)] = tool;
    if (tool !== 'wall') {
      const t = { type: tool, c, r, level: 1, cd: 0, mode: 'first', spent: T.cost, aim: 0 };
      towers.push(t);
    } else {
      towers.push({ type: 'wall', c, r, level: 1, spent: T.cost });
    }
    dist = flow(blockedMap());
    Arcade.tone({ freq: 300, to: 450, dur: 0.06, type: 'square', vol: 0.04 });
    updateHud();
  }

  function towerAt(c, r) {
    return towers.find(t => t.c === c && t.r === r);
  }

  function upgrade() {
    const t = selected;
    if (!t || t.type === 'wall' || t.level >= MAX_LEVEL) return;
    const cost = upgradeCost(t);
    if (gold < cost) return flash('Not enough gold');
    gold -= cost;
    t.spent += cost;
    t.level++;
    Arcade.tone({ freq: 500, to: 1000, dur: 0.15, type: 'triangle', vol: 0.05 });
    updateHud();
  }

  function sell() {
    const t = selected;
    if (!t) return;
    gold += Math.floor(t.spent * 0.7);
    towers = towers.filter(x => x !== t);
    grid[idx(t.c, t.r)] = null;
    dist = flow(blockedMap());
    selected = null;
    Arcade.tone({ freq: 400, to: 200, dur: 0.1, type: 'triangle', vol: 0.04 });
    updateHud();
  }

  function flash(text) {
    popups.push({ x: hover ? hover.c * CELL + CELL / 2 : COLS * CELL / 2, y: hover ? GY + hover.r * CELL : GY + 40, text, t: 0, color: '#ff8a80' });
    Arcade.tone({ freq: 140, dur: 0.08, type: 'square', vol: 0.03 });
  }

  // ---------- Combat ----------

  function damage(e, amount, pierce = false) {
    const n = pierce ? amount : Math.max(1, amount - e.armor);
    e.hp -= n;
    if (e.hp <= 0 && !e.dead) kill(e);
  }

  function kill(e) {
    e.dead = true;
    const E = ENEMIES[e.kind];
    const bounty = Math.round(E.bounty * (1 + wave * 0.04));
    gold += bounty;
    score += E.pts;
    kills++;
    popups.push({ x: e.x * CELL + CELL / 2, y: GY + e.y * CELL, text: `+${bounty}`, t: 0, color: '#ffd23f' });
    for (let i = 0; i < 8; i++) effects.push({ type: 'bit', x: e.x, y: e.y, vx: Arcade.rand(-2, 2), vy: Arcade.rand(-2, 2), t: 0, life: 0.4, color: E.color });
    if (E.split) for (let k = 0; k < 2; k++) spawn(E.split, null, { x: e.x + Arcade.rand(-0.2, 0.2), y: e.y + Arcade.rand(-0.2, 0.2) });
    if (e.kind === 'boss') {
      Arcade.flag('rampart-boss');
      Arcade.tone({ freq: 120, to: 600, dur: 0.6, type: 'sawtooth', vol: 0.06 });
    } else Arcade.tone({ freq: 700 + Math.random() * 200, dur: 0.04, vol: 0.025 });
    updateHud();
  }

  function inRange(t, range, filter = () => true) {
    return enemies.filter(e => !e.dead && filter(e) && Math.hypot(e.x - t.c, e.y - t.r) <= range);
  }

  // Progress toward the exit: how many steps are left (fliers measure straight-line).
  function remaining(e) {
    if (e.fly) return Math.hypot(EXIT.c + 1 - e.x, EXIT.r - e.y);
    const c = Math.round(e.x), r = Math.round(e.y);
    return inGrid(c, r) ? dist[idx(c, r)] : 99;
  }

  function choose(t, list) {
    if (!list.length) return null;
    if (t.mode === 'strong') return list.reduce((a, b) => (b.hp > a.hp ? b : a));
    if (t.mode === 'close') return list.reduce((a, b) => (Math.hypot(b.x - t.c, b.y - t.r) < Math.hypot(a.x - t.c, a.y - t.r) ? b : a));
    return list.reduce((a, b) => (remaining(b) < remaining(a) ? b : a));
  }

  function fire(t) {
    const T = TOWERS[t.type];
    const range = towerStat(t, 'range');
    if (t.type === 'frost') {
      const hit = inRange(t, range);
      if (!hit.length) return false;
      for (const e of hit) {
        damage(e, towerStat(t, 'dmg'));
        e.slow = Math.max(e.slow, towerStat(t, 'slow'));
        e.slowT = T.slowT;
      }
      effects.push({ type: 'ring', x: t.c, y: t.r, r: range, t: 0, life: 0.35, color: T.color });
      return true;
    }
    const target = choose(t, inRange(t, range, e => !(T.ground && e.fly)));
    if (!target) return false;
    t.aim = Math.atan2(target.y - t.r, target.x - t.c);
    if (t.type === 'spark') {
      let from = { x: t.c, y: t.r }, cur = target;
      const hitList = [];
      for (let k = 0; k <= towerStat(t, 'chain') && cur; k++) {
        hitList.push(cur);
        effects.push({ type: 'zap', x1: from.x, y1: from.y, x2: cur.x, y2: cur.y, t: 0, life: 0.15, color: T.color });
        damage(cur, towerStat(t, 'dmg') * Math.pow(0.85, k), true);
        from = cur;
        const prev = cur;
        cur = enemies.filter(e => !e.dead && !hitList.includes(e) && Math.hypot(e.x - prev.x, e.y - prev.y) < 1.8)
          .sort((a, b) => Math.hypot(a.x - prev.x, a.y - prev.y) - Math.hypot(b.x - prev.x, b.y - prev.y))[0];
      }
      Arcade.tone({ freq: 1200, to: 600, dur: 0.06, type: 'sawtooth', vol: 0.02 });
      return true;
    }
    shots.push({ type: t.type, x: t.c, y: t.r, target, tx: target.x, ty: target.y, dmg: towerStat(t, 'dmg'), speed: t.type === 'cannon' ? 7 : 14, splash: T.splash });
    Arcade.tone({ freq: t.type === 'cannon' ? 120 : 900, dur: 0.04, type: t.type === 'cannon' ? 'square' : 'triangle', vol: 0.02 });
    return true;
  }

  // ---------- Update ----------

  function update(dt) {
    time += dt;
    if (state === 'build') {
      if (isFinite(buildT)) {
        buildT -= dt;
        if (buildT <= 0) {
          buildT = 0;
          startWave();
        }
      }
    }

    if (state === 'wave') {
      spawnT -= dt;
      if (spawnQ.length && spawnT <= 0) {
        const s = spawnQ.shift();
        spawn(s.kind, s.mod);
        spawnT = nextWaveGap();
      }
      if (!spawnQ.length && !enemies.length) waveCleared();
    }

    for (const e of enemies) {
      const E = ENEMIES[e.kind];
      e.slowT -= dt;
      if (e.slowT <= 0) e.slow = 0;
      if (e.regen) e.hp = Math.min(e.max, e.hp + e.max * e.regen * dt);
      if (E.heal) for (const o of enemies) if (o !== e && !o.dead && Math.hypot(o.x - e.x, o.y - e.y) < 1.5) o.hp = Math.min(o.max, o.hp + E.heal * Math.pow(1.12, wave - 1) * dt * 0.2);
      let step = e.speed * (1 - e.slow) * dt;
      if (e.fly) {
        const tx = EXIT.c + 1, ty = EXIT.r;
        const d = Math.hypot(tx - e.x, ty - e.y);
        if (d < step) leak(e);
        else {
          e.x += ((tx - e.x) / d) * step;
          e.y += ((ty - e.y) / d) * step;
        }
        continue;
      }
      while (step > 0 && !e.dead) {
        if (!e.target) {
          const c = Math.round(e.x), r = Math.round(e.y);
          if (c === EXIT.c && r === EXIT.r) e.target = { c: COLS + 1, r: EXIT.r };
          else e.target = nextStep(c, r) || { c, r };
        }
        const dx = e.target.c - e.x, dy = e.target.r - e.y, d = Math.hypot(dx, dy);
        if (d <= step) {
          e.x = e.target.c;
          e.y = e.target.r;
          step -= d;
          if (e.target.c > COLS) { leak(e); break; }
          e.target = null;
          if (d === 0) break;
        } else {
          e.x += (dx / d) * step;
          e.y += (dy / d) * step;
          step = 0;
        }
      }
    }
    enemies = enemies.filter(e => !e.dead);

    for (const t of towers) {
      if (t.type === 'wall') continue;
      t.cd -= dt;
      if (t.cd <= 0 && fire(t)) t.cd = TOWERS[t.type].rate;
    }

    for (const s of shots) {
      if (!s.target.dead) { s.tx = s.target.x; s.ty = s.target.y; }
      const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
      const step = s.speed * dt;
      if (d <= step) {
        s.done = true;
        if (s.splash) {
          effects.push({ type: 'boom', x: s.tx, y: s.ty, r: s.splash, t: 0, life: 0.3, color: '#ff8a3d' });
          for (const e of enemies) if (!e.dead && !e.fly && Math.hypot(e.x - s.tx, e.y - s.ty) <= s.splash) damage(e, s.dmg);
        } else if (!s.target.dead) damage(s.target, s.dmg);
      } else {
        s.x += (dx / d) * step;
        s.y += (dy / d) * step;
      }
    }
    shots = shots.filter(s => !s.done);
    enemies = enemies.filter(e => !e.dead);

    for (const f of effects) {
      f.t += dt;
      if (f.type === 'bit') { f.x += f.vx * dt; f.y += f.vy * dt; }
    }
    effects = effects.filter(f => f.t < f.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter(p => p.t < 1);
  }

  const nextWaveGap = () => {
    const w = spawnQ[0];
    return (w && w.mod === 'Swarm' ? 0.4 : Math.max(0.45, 0.85 - wave * 0.01)) * Arcade.rand(0.8, 1.2);
  };

  function leak(e) {
    e.dead = true;
    lives -= ENEMIES[e.kind].leak;
    leakedRun += ENEMIES[e.kind].leak;
    effects.push({ type: 'ring', x: EXIT.c, y: EXIT.r, r: 1, t: 0, life: 0.4, color: '#ff4d6d' });
    Arcade.tone({ freq: 160, to: 80, dur: 0.25, type: 'sawtooth', vol: 0.05 });
    updateHud();
    if (lives <= 0) gameOver();
  }

  function waveCleared() {
    const bonus = 20 + wave * 2;
    gold += bonus;
    score += 50 * wave;
    popups.push({ x: COLS * CELL / 2, y: GY + 60, text: `Wave ${wave} cleared · +${bonus} gold`, t: 0, color: '#9be37a' });
    if (wave >= 10) Arcade.flag('rampart-wave10');
    if (wave >= 25) Arcade.flag('rampart-wave25');
    if (wave >= 10 && leakedRun === 0) Arcade.flag('rampart-perfect');
    state = 'build';
    buildT = BUILD_TIME;
    Arcade.tone({ freq: 523, to: 784, dur: 0.2, type: 'triangle', vol: 0.05 });
    updateHud();
  }

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    lives = 0;
    Arcade.finish(ui, {
      score,
      title: 'The rampart fell',
      lines: [`You held out until wave ${wave} · ${kills} enemies defeated`],
      button: 'Build again',
      onAction: start,
    });
  }

  function updateHud() {
    $('score').textContent = score;
    $('wave').textContent = wave;
    $('best').textContent = Math.max(score, Arcade.getBest(ID));
  }

  // ---------- Input ----------

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }
  const cellAt = (x, y) => {
    const c = Math.floor((x - GX) / CELL), r = Math.floor((y - GY) / CELL);
    return inGrid(c, r) ? { c, r } : null;
  };

  canvas.addEventListener('pointermove', e => {
    const [x, y] = toBoard(e);
    hover = cellAt(x, y);
  });
  canvas.addEventListener('pointerleave', () => { hover = null; });
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'build' && state !== 'wave') return;
    const [x, y] = toBoard(e);
    for (const b of buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (b.enabled) b.onClick();
        return;
      }
    }
    const cell = cellAt(x, y);
    hover = cell;
    if (!cell) return;
    const t = towerAt(cell.c, cell.r);
    if (t) {
      selected = selected === t ? null : t;
      return;
    }
    if (grid[idx(cell.c, cell.r)] === 'rock') return;
    selected = null;
    if (tool) place(cell.c, cell.r);
  });
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    tool = null;
    selected = null;
  });

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (e.code === 'Escape' && (tool || selected) && (state === 'build' || state === 'wave')) {
        tool = null;
        selected = null;
        return;
      }
      if (state === 'build' || state === 'wave') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (state !== 'build' && state !== 'wave') return;
    const t = TOOL_IDS.find(id => `Digit${TOWERS[id].key}` === e.code);
    if (t) { tool = t; selected = null; }
    if (e.code === 'KeyU') upgrade();
    if (e.code === 'KeyS' && selected) sell();
    if (e.code === 'KeyF') speedUp = !speedUp;
    if (e.code === 'KeyN' || e.code === 'Space') { e.preventDefault(); startWave(); }
  });

  let resumeTo = 'build';
  function pause() {
    resumeTo = state;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }
  function resume() {
    state = resumeTo;
    ui.hide();
  }
  Arcade.onBlur(() => { if (state === 'build' || state === 'wave') pause(); });

  function start() {
    reset();
    state = 'build';
    ui.hide();
  }

  // ---------- Drawing ----------

  function btn(x, y, w, h, label, sub, enabled, onClick, { active = false, accent = '#ffd23f' } = {}) {
    ctx.fillStyle = active ? '#2f3a4f' : enabled ? '#232a38' : '#1a1d24';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? accent : enabled ? '#3b4658' : '#262a33';
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = enabled ? '#eceef2' : '#5c6370';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(label, x + 8, y + (sub ? 17 : h / 2 + 5));
    if (sub) {
      ctx.fillStyle = enabled ? accent : '#4a505c';
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText(sub, x + 8, y + 32);
    }
    buttons.push({ x, y, w, h, enabled, onClick });
  }

  const px = c => GX + c * CELL + CELL / 2;
  const py = r => GY + r * CELL + CELL / 2;

  function drawTower(t, ghost = false) {
    const T = TOWERS[t.type];
    const x = GX + t.c * CELL, y = GY + t.r * CELL;
    if (t.type === 'wall') {
      ctx.fillStyle = ghost ? 'rgba(91,100,120,0.6)' : '#4a5263';
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 2, y + 2, CELL - 4, 6);
      ctx.strokeStyle = '#363d4b';
      ctx.strokeRect(x + 2.5, y + 14.5, CELL - 5, 0.01);
      ctx.strokeRect(x + CELL / 2 + 0.5, y + 2, 0.01, 12);
      return;
    }
    ctx.fillStyle = '#2b3140';
    ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
    ctx.save();
    ctx.translate(x + CELL / 2, y + CELL / 2);
    ctx.globalAlpha = ghost ? 0.6 : 1;
    ctx.fillStyle = T.color;
    if (t.type === 'frost') {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + time;
        ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
      }
      ctx.closePath();
      ctx.fill();
    } else if (t.type === 'spark') {
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, 4 + Math.sin(time * 10) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, t.type === 'cannon' ? 12 : 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(t.aim || 0);
      ctx.fillRect(0, t.type === 'cannon' ? -5 : -3, t.type === 'cannon' ? 16 : 15, t.type === 'cannon' ? 10 : 6);
    }
    ctx.restore();
    // Level pips.
    for (let k = 0; k < t.level; k++) {
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(x + 6 + k * 7, y + CELL - 8, 5, 3);
    }
  }

  function draw() {
    buttons = [];
    ctx.fillStyle = '#12151c';
    ctx.fillRect(0, 0, W, H);

    // Grid.
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (c + r) % 2 ? '#1f3324' : '#22392a';
      ctx.fillRect(GX + c * CELL, GY + r * CELL, CELL, CELL);
    }
    // Entry and exit.
    ctx.fillStyle = 'rgba(255,77,109,0.35)';
    ctx.fillRect(GX, GY + ENTRY.r * CELL, 6, CELL);
    ctx.fillStyle = 'rgba(127,219,255,0.45)';
    ctx.fillRect(GX + COLS * CELL - 6, GY + EXIT.r * CELL, 6, CELL);

    // The current route, so you can see your maze working.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (const p of pathFromEntry()) {
      ctx.beginPath();
      ctx.arc(px(p.c), py(p.r), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[idx(c, r)] !== 'rock') continue;
      ctx.fillStyle = '#4d4a44';
      ctx.beginPath();
      ctx.ellipse(px(c), py(r) + 2, 15, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#625e56';
      ctx.beginPath();
      ctx.ellipse(px(c) - 3, py(r) - 2, 9, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const t of towers) drawTower(t);

    // Hover ghost and range.
    if (hover && (state === 'build' || state === 'wave')) {
      const t = towerAt(hover.c, hover.r);
      if (!t && tool && grid[idx(hover.c, hover.r)] === null) {
        const ok = gold >= TOWERS[tool].cost && canBuild(hover.c, hover.r);
        drawTower({ type: tool, c: hover.c, r: hover.r, level: 1 }, true);
        ctx.strokeStyle = ok ? 'rgba(255,255,255,0.5)' : 'rgba(255,90,90,0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(GX + hover.c * CELL + 1, GY + hover.r * CELL + 1, CELL - 2, CELL - 2);
        if (TOWERS[tool].range) rangeCircle(hover.c, hover.r, TOWERS[tool].range);
      }
    }
    if (selected && selected.type !== 'wall') rangeCircle(selected.c, selected.r, towerStat(selected, 'range'));
    if (selected) {
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.strokeRect(GX + selected.c * CELL + 1, GY + selected.r * CELL + 1, CELL - 2, CELL - 2);
    }

    for (const e of enemies) drawEnemy(e);

    for (const s of shots) {
      ctx.fillStyle = s.type === 'cannon' ? '#2a2a2a' : '#ffd23f';
      ctx.beginPath();
      ctx.arc(px(s.x), py(s.y), s.type === 'cannon' ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const f of effects) {
      const a = 1 - f.t / f.life;
      ctx.globalAlpha = a;
      if (f.type === 'ring' || f.type === 'boom') {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = f.type === 'boom' ? 4 : 2;
        ctx.beginPath();
        ctx.arc(px(f.x), py(f.y), f.r * CELL * (f.type === 'boom' ? 0.5 + 0.5 * (f.t / f.life) : f.t / f.life), 0, Math.PI * 2);
        ctx.stroke();
      } else if (f.type === 'zap') {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px(f.x1), py(f.y1));
        const mx = (f.x1 + f.x2) / 2 + Arcade.rand(-0.2, 0.2), my = (f.y1 + f.y2) / 2 + Arcade.rand(-0.2, 0.2);
        ctx.lineTo(px(mx), py(my));
        ctx.lineTo(px(f.x2), py(f.y2));
        ctx.stroke();
      } else if (f.type === 'bit') {
        ctx.fillStyle = f.color;
        ctx.fillRect(px(f.x) - 2, py(f.y) - 2, 4, 4);
      }
    }
    ctx.globalAlpha = 1;

    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t;
      ctx.fillStyle = p.color;
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - p.t * 30);
    }
    ctx.globalAlpha = 1;

    drawTopBar();
    drawPanel();
  }

  function rangeCircle(c, r, range) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px(c), py(r), range * CELL, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawEnemy(e) {
    const E = ENEMIES[e.kind];
    const x = px(e.x), y = py(e.y) + (e.fly ? Math.sin(time * 6 + e.wobble) * 3 - 6 : 0);
    const r = E.r * CELL;
    if (e.fly) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x, py(e.y) + 8, r * 0.8, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = E.color;
    ctx.beginPath();
    if (e.kind === 'brute' || e.kind === 'boss') ctx.rect(x - r, y - r, r * 2, r * 2);
    else if (e.fly) { ctx.moveTo(x - r, y); ctx.lineTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 0.6); }
    else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (e.armor) {
      ctx.strokeStyle = '#cfd8dc';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (e.slow > 0) {
      ctx.strokeStyle = '#7fdbff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(x - 3, y - 3, 2, 3);
    ctx.fillRect(x + 1, y - 3, 2, 3);
    if (e.hp < e.max) {
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 12, y - r - 8, 24, 4);
      ctx.fillStyle = e.hp / e.max > 0.4 ? '#7ed957' : '#ff5d5d';
      ctx.fillRect(x - 12, y - r - 8, 24 * Math.max(0, e.hp / e.max), 4);
    }
  }

  function drawTopBar() {
    ctx.fillStyle = '#161920';
    ctx.fillRect(0, 0, W, GY - 4);
    ctx.textAlign = 'left';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`⛁ ${gold}`, 14, 29);
    ctx.fillStyle = '#ff6b81';
    ctx.fillText(`♥ ${Math.max(0, lives)}`, 100, 29);
    ctx.fillStyle = '#eceef2';
    ctx.fillText(`Wave ${wave}`, 170, 29);
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = '#8d94a1';
    const counts = Object.entries(nextWave.counts).map(([k, n]) => `${n} ${ENEMIES[k].name}${n > 1 ? 's' : ''}`).join(', ');
    const label = state === 'wave' ? `Now: ${spawnQ.length} still coming` : `Next wave ${nextWave.n}: ${counts}`;
    ctx.fillText(label, 260, 22);
    if (nextWave.mod || state === 'wave') {
      ctx.fillStyle = '#ff8a80';
      ctx.fillText(state === 'wave' ? `Up next: wave ${nextWave.n}${nextWave.mod ? ` · ${nextWave.mod}` : ''}` : `${nextWave.mod}: ${MODS[nextWave.mod]}`, 260, 38);
    }
    const interest = Math.min(INTEREST_CAP, Math.floor(gold * INTEREST));
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8d94a1';
    ctx.fillText(`Interest next wave: +${interest}`, PANEL_X - 10, 29);
  }

  function drawPanel() {
    ctx.fillStyle = '#161920';
    ctx.fillRect(PANEL_X - 6, GY - 4, W - PANEL_X + 6, H - GY + 4);
    const x = PANEL_X, w = PANEL_W;
    let y = GY + 4;
    for (const id of TOOL_IDS) {
      const T = TOWERS[id];
      btn(x, y, w, 40, `${T.key} ${T.name}`, `${T.cost} gold`, gold >= T.cost, () => { tool = id; selected = null; }, { active: tool === id });
      y += 44;
    }
    y += 4;
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(x, y, w, 158);
    const t = selected;
    ctx.textAlign = 'left';
    if (t) {
      const T = TOWERS[t.type];
      ctx.fillStyle = T.color;
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText(t.type === 'wall' ? 'Wall' : `${T.name} · Lv ${t.level}`, x + 8, y + 20);
      ctx.fillStyle = '#8d94a1';
      ctx.font = '500 11px system-ui, sans-serif';
      if (t.type !== 'wall') {
        const lines = [T.desc, `Damage ${Math.round(towerStat(t, 'dmg'))} · range ${towerStat(t, 'range').toFixed(1)}`];
        if (t.type === 'frost') lines.push(`Slow ${Math.round(towerStat(t, 'slow') * 100)}%`);
        if (t.type === 'spark') lines.push(`Chains ${towerStat(t, 'chain')} times`);
        lines.forEach((l, k) => ctx.fillText(l, x + 8, y + 38 + k * 14));
        const up = t.level < MAX_LEVEL;
        btn(x + 6, y + 80, w - 12, 22, up ? `Upgrade (U) · ${upgradeCost(t)}` : 'Max level', null, up && gold >= upgradeCost(t), upgrade);
        const modes = { first: 'First', strong: 'Strongest', close: 'Closest' };
        btn(x + 6, y + 106, w - 12, 22, `Target: ${modes[t.mode]}`, null, t.type !== 'frost', () => {
          t.mode = t.mode === 'first' ? 'strong' : t.mode === 'strong' ? 'close' : 'first';
        });
      } else {
        ctx.fillText(T.desc, x + 8, y + 38);
      }
      btn(x + 6, y + 132, w - 12, 22, `Sell (S) · +${Math.floor(t.spent * 0.7)}`, null, true, sell);
    } else {
      ctx.fillStyle = '#8d94a1';
      ctx.font = '500 11px system-ui, sans-serif';
      const help = tool ? [`Placing: ${TOWERS[tool].name}`, TOWERS[tool].desc, '', 'Click a tile to build.', 'Click a tower to manage it.', 'Right-click or Esc to stop.']
        : ['Pick something to build,', 'or click a tower to', 'upgrade or sell it.', '', 'Enemies take the shortest', 'route. Make it long.'];
      help.forEach((l, k) => ctx.fillText(l, x + 8, y + 18 + k * 15));
    }
    y += 164;
    if (state === 'build') {
      const label = isFinite(buildT) ? `Send wave now (+${Math.floor(buildT)})` : 'Start wave 1';
      btn(x, y, w, 40, label, isFinite(buildT) ? `Auto in ${Math.ceil(buildT)}s · Space` : 'Space · build first!', true, startWave, { active: true, accent: '#9be37a' });
    } else {
      btn(x, y, w, 40, `Wave ${wave} in progress`, `${enemies.length} on the field`, false, () => {});
    }
    btn(x, y + 44, w, 26, speedUp ? 'Speed ×2 (F)' : 'Speed ×1 (F)', null, true, () => { speedUp = !speedUp; }, { active: speedUp });
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'build' || state === 'wave') {
      const steps = speedUp ? 2 : 1;
      for (let k = 0; k < steps && (state === 'build' || state === 'wave'); k++) update(dt);
    }
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => score,
    intro: {
      title: 'Rampart',
      html: `<ul>
        <li>Enemies march from the <b style="color:#ff6b81">red gate</b> to the <b style="color:#7fdbff">blue gate</b>. Every one that gets through costs lives.</li>
        <li>Build <b>walls</b> and <b>towers</b> to make them walk the long way. You can't fully block the path.</li>
        <li><b>Bolt</b> shoots fast, <b>Frost</b> slows, <b>Cannon</b> splashes the ground, <b>Spark</b> chains and cuts through armor. Flyers ignore your maze.</li>
        <li>Upgrade and sell towers between waves. Gold you save earns <b>5% interest</b> each wave, and calling a wave early pays a bonus.</li>
      </ul>`,
      button: 'Build',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
