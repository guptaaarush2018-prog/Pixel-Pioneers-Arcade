/* Broadside: top-down age-of-sail battles. Steer your ship, set how much sail is up, and mind
   the wind: running before it or across it is fast, sailing into it is a crawl. Cannons point
   out of the sides, so line up beside a pirate and fire a broadside. Sunk ships leave treasure
   to scoop up; between waves you make port and spend it on a tougher, faster, better-armed ship.
   Score is all the treasure you bring in. */
(() => {
  const ID = 'broadside';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const WORLD_W = 2600, WORLD_H = 1800;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const R = Gfx.rand;   // cosmetic randomness (keeps online duels in step)
  const fx = Gfx.particles(900), wake = Gfx.particles(700), floats = Gfx.floaters(), shake = Gfx.shaker();

  // ---------- Ships ----------

  const TYPES = {
    player: { len: 64, beam: 22, hp: 100, speed: 120, turn: 1.15, guns: 3, reload: 2.6, color: '#8a5a32', sail: '#f4efe2', flag: '#4fc3ff' },
    sloop: { len: 44, beam: 16, hp: 40, speed: 118, turn: 1.4, guns: 2, reload: 3.2, color: '#6b4a2b', sail: '#3a3a3a', flag: '#111', gold: 35, pts: 'Sloop' },
    brig: { len: 60, beam: 21, hp: 90, speed: 104, turn: 1.0, guns: 3, reload: 3.4, color: '#5a3d22', sail: '#d8d0bf', flag: '#c0392b', gold: 70, pts: 'Brig' },
    galleon: { len: 90, beam: 30, hp: 260, speed: 84, turn: 0.62, guns: 5, reload: 3.8, color: '#4a2f1a', sail: '#b8302a', flag: '#ffd23f', gold: 260, pts: 'Galleon' },
  };

  function makeShip(type, x, y, h, team) {
    const t = TYPES[type];
    return { type, t, x, y, h, v: 0, sail: team === 0 ? 2 : 3, team, hp: t.hp, max: t.hp, guns: t.guns, reloadTime: t.reload, speedK: 1,
      reload: [0, 0], sinkT: 0, alive: true, hitT: 0, wakeT: 0, fireT: 0, ai: null, rudder: 0 };
  }

  // ---------- State ----------

  let state = 'menu', ships = [], balls = [], loot = [], islands = [], me = null;
  let wind = { a: 0, s: 1, turnT: 20 };
  let gold = 0, score = 0, wave = 0, waveRng = Math.random, cam = { x: 0, y: 0 }, banner = null, time = 0, sunk = 0, clearT = 0;
  let up = { hull: 0, guns: 0, reload: 0, sails: 0 };

  // ---------- Sailing ----------

  // How well a heading uses the wind: running before it is good, across it (a beam reach) is
  // best, and pointing into it is nearly dead in the water.
  function windFactor(h) {
    const off = Math.abs(angDiff(h, wind.a));   // 0 = wind behind you, π = straight into it
    if (off > 2.55) return 0.14;
    if (off > 1.9) return 0.14 + (2.55 - off) / 0.65 * 0.62;
    return 0.82 + Math.sin(off / 1.9 * Math.PI) * 0.18;
  }

  function sail(s, ctl, dt) {
    const t = s.t;
    const target = (s.sail / 3) * t.speed * s.speedK * windFactor(s.h) * wind.s;
    s.v += (target - s.v) * (target > s.v ? 0.45 : 0.9) * dt;
    const turnRate = t.turn * (0.3 + 0.7 * Math.min(1, s.v / 55));
    s.rudder = Gfx.approach(s.rudder, ctl.turn, 6, dt);
    s.h += s.rudder * turnRate * dt;
    s.x += Math.cos(s.h) * s.v * dt;
    s.y += Math.sin(s.h) * s.v * dt;
    // The edge of the map: a gentle current pushes you back in.
    const m = 40;
    if (s.x < m) { s.x = m; s.h += angDiff(0, s.h) * dt; }
    if (s.x > WORLD_W - m) { s.x = WORLD_W - m; s.h += angDiff(Math.PI, s.h) * dt; }
    if (s.y < m) { s.y = m; s.h += angDiff(Math.PI / 2, s.h) * dt; }
    if (s.y > WORLD_H - m) { s.y = WORLD_H - m; s.h += angDiff(-Math.PI / 2, s.h) * dt; }
    // Islands: run aground and you bounce off with a scrape.
    for (const is of islands) {
      const dx = s.x - is.x, dy = s.y - is.y, d = Math.hypot(dx, dy), r = is.r + t.beam * 0.6;
      if (d < r) {
        s.x = is.x + dx / d * r; s.y = is.y + dy / d * r;
        if (s.v > 30) { damage(s, s.v * 0.08, null); if (s === me) { Arcade.tone({ freq: 90, to: 50, dur: 0.25, type: 'sawtooth', vol: 0.05 }); shake.add(0.25); } }
        s.v *= 0.4;
        s.h += angDiff(Math.atan2(dy, dx), s.h) * 0.2;
      }
    }
    s.reload[0] = Math.max(0, s.reload[0] - dt);
    s.reload[1] = Math.max(0, s.reload[1] - dt);
    s.hitT = Math.max(0, s.hitT - dt);
    // Wake.
    s.wakeT -= dt;
    if (s.wakeT <= 0 && s.v > 12) {
      s.wakeT = 0.06;
      const bx = s.x - Math.cos(s.h) * t.len * 0.5, by = s.y - Math.sin(s.h) * t.len * 0.5;
      for (const side of [-1, 1]) {
        wake.emit({ x: bx + Math.cos(s.h + Math.PI / 2) * side * t.beam * 0.3, y: by + Math.sin(s.h + Math.PI / 2) * side * t.beam * 0.3,
          vx: Math.cos(s.h + Math.PI / 2 * side) * s.v * 0.18, vy: Math.sin(s.h + Math.PI / 2 * side) * s.v * 0.18, life: 1.4, size: 3, grow: 6, color: 'rgba(255,255,255,0.35)' });
      }
    }
    // Damaged ships smoke and burn.
    if (s.hp < s.max * 0.4 && R() < dt * 14) {
      fx.emit({ x: s.x + R(-t.len / 3, t.len / 3) * Math.cos(s.h), y: s.y + R(-t.len / 3, t.len / 3) * Math.sin(s.h), vx: R(-8, 8), vy: R(-30, -12), life: R(1, 1.6), size: R(5, 8), grow: 10, color: 'rgba(70,70,75,0.5)', drag: 0.5 });
      if (R() < 0.4) fx.emit({ x: s.x + R(-8, 8), y: s.y + R(-8, 8), vy: -20, life: 0.4, size: 4, grow: -6, color: '#ffb02e' });
    }
  }

  // side 0 = port (left of the bow), 1 = starboard (right).
  function broadside(s, side) {
    if (!s.alive || s.reload[side] > 0) return false;
    s.reload[side] = s.reloadTime;
    const t = s.t, dir = s.h + (side === 0 ? -Math.PI / 2 : Math.PI / 2);
    const n = s.guns;
    for (let i = 0; i < n; i++) {
      const along = (n === 1 ? 0 : (i / (n - 1) - 0.5)) * t.len * 0.62;
      const ox = s.x + Math.cos(s.h) * along + Math.cos(dir) * t.beam * 0.5;
      const oy = s.y + Math.sin(s.h) * along + Math.sin(dir) * t.beam * 0.5;
      const a = dir + R(-0.06, 0.06), sp = 330 + R(-20, 20);
      const delay = i * 0.06 + R(0, 0.04);
      balls.push({ x: ox, y: oy, vx: Math.cos(a) * sp + Math.cos(s.h) * s.v, vy: Math.sin(a) * sp + Math.sin(s.h) * s.v, t: -delay, life: 1.25, team: s.team, owner: s, dmg: s.team === 0 ? 14 : 11 });
      setTimeout(() => {
        fx.burst(4, () => ({ x: ox, y: oy, vx: Math.cos(dir) * R(30, 80) + R(-15, 15), vy: Math.sin(dir) * R(30, 80) + R(-15, 15), life: R(0.8, 1.4), size: R(5, 9), grow: 14, color: 'rgba(235,235,235,0.75)', drag: 1.6 }));
        fx.emit({ x: ox, y: oy, life: 0.08, size: 9, grow: -60, color: '#ffe9a8' });
      }, delay * 1000);
    }
    const near = Math.hypot(s.x - me.x, s.y - me.y);
    const vol = s === me ? 0.07 : 0.05 * Math.max(0, 1 - near / 900);
    for (let i = 0; i < Math.min(3, n); i++) Arcade.tone({ freq: 90 + R(0, 30), to: 35, dur: 0.35, type: 'sawtooth', vol, delay: i * 0.07 });
    if (s === me) shake.add(0.18);
    return true;
  }

  function damage(s, n, by) {
    if (!s.alive) return;
    s.hp -= n;
    s.hitT = 0.15;
    if (s === me) { shake.add(0.3); Arcade.tone({ freq: 140, to: 70, dur: 0.15, type: 'square', vol: 0.05 }); }
    if (s.hp <= 0) sink(s, by);
  }

  function sink(s, by) {
    s.alive = false;
    s.sinkT = 0;
    s.v *= 0.3;
    fx.burst(30, () => { const a = R(0, TAU), v = R(30, 160); return { x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.5, 1), size: R(4, 8), grow: -4, color: ['#fff3b0', '#ffb02e', '#ff6b3d'][Math.floor(R(0, 3))], drag: 3 }; });
    fx.burst(14, () => ({ x: s.x, y: s.y, vx: R(-90, 90), vy: R(-90, 90), life: R(1, 2), size: R(3, 6), color: s.t.color, shape: 'chip', spin: R(-8, 8), drag: 1.5 }));
    Arcade.tone({ freq: 80, to: 30, dur: 0.7, type: 'sawtooth', vol: 0.08 });
    shake.add(s === me ? 0.8 : 0.35);
    if (s === me) return setTimeout(gameOver, 1800);
    sunk++;
    if (s.type === 'galleon') Arcade.flag('broadside-galleon');
    // Treasure bobs up where it went down.
    const pieces = s.type === 'galleon' ? 5 : s.type === 'brig' ? 3 : 2;
    for (let i = 0; i < pieces; i++) loot.push({ x: s.x + R(-30, 30), y: s.y + R(-30, 30), gold: Math.round(s.t.gold / pieces), kind: 'gold', t: 30, bob: R(0, TAU) });
    if (waveRng() < 0.35) loot.push({ x: s.x + R(-20, 20), y: s.y + R(-20, 20), kind: 'repair', t: 30, bob: R(0, TAU) });
    floats.add(`${s.t.pts} sunk!`, s.x, s.y - 40, { color: '#ffd23f', size: 18 });
  }

  // ---------- Pirates ----------

  function botControl(s, dt) {
    const ai = s.ai;
    const dx = me.x - s.x, dy = me.y - s.y, d = Math.hypot(dx, dy);
    const bearing = Math.atan2(dy, dx);
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = 1.5 + R(0, 1);
      // Circle the player on whichever side is closer to their current heading.
      ai.side = angDiff(bearing + Math.PI / 2, s.h) > 0 ? -1 : 1;
    }
    let want;
    if (d > 360) want = bearing;                                   // close in
    else want = bearing + ai.side * Math.PI / 2 * (d < 170 ? 1.25 : 1);   // run alongside
    // Don't try to sail straight into the wind: tack off to one side.
    if (windFactor(want) < 0.3) want = wind.a + Math.PI + (angDiff(want, wind.a + Math.PI) > 0 ? 1.1 : -1.1);
    // Steer around islands.
    for (const is of islands) {
      const ix = is.x - s.x, iy = is.y - s.y, id = Math.hypot(ix, iy);
      if (id < is.r + 140 && Math.abs(angDiff(Math.atan2(iy, ix), s.h)) < 0.9) want = Math.atan2(iy, ix) + (angDiff(Math.atan2(iy, ix), s.h) > 0 ? -1.5 : 1.5);
    }
    const turn = clamp(angDiff(want, s.h) * 2, -1, 1);
    s.sail = d < 220 ? 2 : 3;
    sail(s, { turn }, dt);
    // Fire when the player is off one side and in range.
    if (d < 400 && me.alive) {
      const rel = angDiff(bearing, s.h);
      const side = rel < 0 ? 0 : 1;
      if (Math.abs(Math.abs(rel) - Math.PI / 2) < 0.32 + ai.loose && ai.aimT <= 0) { if (broadside(s, side)) ai.aimT = 0.6; }
    }
    ai.aimT -= dt;
  }

  // ---------- Waves ----------

  function nextWave() {
    wave++;
    const list = [];
    const sloops = Math.min(1 + Math.ceil(wave * 0.8), 6), brigs = wave >= 2 ? Math.min(Math.floor((wave - 1) / 1.5), 4) : 0;
    for (let i = 0; i < sloops; i++) list.push('sloop');
    for (let i = 0; i < brigs; i++) list.push('brig');
    if (wave % 5 === 0) list.push('galleon');
    for (const type of list) {
      // Arrive from beyond the edge of the screen, away from islands.
      let x, y, tries = 0;
      do {
        const a = waveRng() * TAU, r = 620 + waveRng() * 280;
        x = clamp(me.x + Math.cos(a) * r, 80, WORLD_W - 80);
        y = clamp(me.y + Math.sin(a) * r, 80, WORLD_H - 80);
      } while (tries++ < 20 && islands.some(is => Math.hypot(is.x - x, is.y - y) < is.r + 60));
      const s = makeShip(type, x, y, Math.atan2(me.y - y, me.x - x), 1);
      s.ai = { thinkT: 0, side: 1, aimT: 1 + waveRng(), loose: Math.max(0, 0.18 - wave * 0.015) };
      s.speedK = 1 + Math.min(wave, 12) * 0.012;
      ships.push(s);
    }
    banner = { text: `WAVE ${wave}`, sub: wave % 5 === 0 ? 'A galleon approaches!' : `${list.length} pirate ship${list.length === 1 ? '' : 's'}`, t: 2.4 };
    Arcade.tone({ freq: 220, to: 440, dur: 0.5, type: 'triangle', vol: 0.05 });
    if (wave >= 10) Arcade.flag('broadside-wave10');
  }

  function makeIslands(rng) {
    islands = [];
    for (let i = 0; i < 12; i++) {
      for (let k = 0; k < 30; k++) {
        const r = 50 + rng() * 80, x = 150 + rng() * (WORLD_W - 300), y = 150 + rng() * (WORLD_H - 300);
        if (Math.hypot(x - WORLD_W / 2, y - WORLD_H / 2) < r + 260) continue;
        if (islands.some(is => Math.hypot(is.x - x, is.y - y) < is.r + r + 120)) continue;
        const shape = Array.from({ length: 14 }, () => 0.82 + rng() * 0.22);
        const palms = Array.from({ length: Math.floor(1 + r / 35) }, () => [rng() * TAU, rng() * 0.5]);
        islands.push({ x, y, r, shape, palms, rot: rng() * TAU });
        break;
      }
    }
  }

  // ---------- Flow ----------

  function start() {
    state = 'play';
    // One draw from Math.random sets the sea and the waves (an online duel seeds it for both).
    waveRng = Gfx.rng(Math.floor(Math.random() * 2 ** 31));
    makeIslands(waveRng);
    wind = { a: waveRng() * TAU, s: 1, turnT: 25, target: 0 };
    wind.target = wind.a;
    up = { hull: 0, guns: 0, reload: 0, sails: 0 };
    ships = []; balls = []; loot = []; fx.clear(); wake.clear();
    me = makeShip('player', WORLD_W / 2, WORLD_H / 2, wind.a + Math.PI / 2, 0);
    ships.push(me);
    applyUpgrades();
    me.hp = me.max;
    gold = 0; score = 0; wave = 0; sunk = 0; time = 0; clearT = 0;
    cam.x = me.x; cam.y = me.y;
    ui.hide();
    nextWave();
    updateHud();
  }

  const UPGRADES = [
    { id: 'hull', name: 'Oak hull', desc: '+30 max hull', max: 5, cost: l => 80 + l * 70 },
    { id: 'guns', name: 'More cannons', desc: '+1 gun each side', max: 3, cost: l => 120 + l * 110 },
    { id: 'reload', name: 'Drilled crew', desc: 'Reload 15% faster', max: 4, cost: l => 90 + l * 80 },
    { id: 'sails', name: 'Silk sails', desc: '+8% speed', max: 4, cost: l => 70 + l * 65 },
  ];
  function applyUpgrades() {
    const t = TYPES.player;
    const frac = me.hp / me.max;
    me.max = t.hp + up.hull * 30;
    me.hp = Math.min(me.max, Math.max(1, Math.round(frac * me.max)));
    me.guns = t.guns + up.guns;
    me.reloadTime = t.reload * Math.pow(0.85, up.reload);
    me.speedK = 1 + up.sails * 0.08;
    if (me.guns >= 6) Arcade.flag('broadside-sixguns');
  }

  function portMenu() {
    state = 'port';
    const repairCost = Math.ceil((me.max - me.hp) * 0.9);
    ui.show({
      title: `⚓ Port · wave ${wave} cleared`,
      html: `<p>You have <b style="color:#ffd23f">${gold.toLocaleString()} gold</b> to spend. Your score is everything you've brought in: <b>${score.toLocaleString()}</b>.</p>
        <div class="bs-shop">
          <button class="btn ${repairCost ? '' : 'secondary'}" type="button" data-repair ${repairCost && gold >= repairCost ? '' : 'disabled'}>Repair hull<small>${Math.ceil(me.hp)}/${me.max} · ${repairCost ? `${repairCost} gold` : 'shipshape'}</small></button>
          ${UPGRADES.map(u => {
            const l = up[u.id], c = u.cost(l), maxed = l >= u.max;
            return `<button class="btn secondary" type="button" data-up="${u.id}" ${maxed || gold < c ? 'disabled' : ''}>${u.name} ${'●'.repeat(l)}${'○'.repeat(u.max - l)}<small>${maxed ? 'Maxed out' : `${u.desc} · ${c} gold`}</small></button>`;
          }).join('')}
        </div>`,
      button: 'Set sail',
      onAction: () => { state = 'play'; ui.hide(); nextWave(); },
      onRender: p => {
        p.querySelector('[data-repair]').addEventListener('click', () => {
          if (gold < repairCost) return;
          gold -= repairCost; me.hp = me.max;
          Arcade.tone({ freq: 400, to: 700, dur: 0.15, type: 'triangle', vol: 0.05 });
          portMenu();
        });
        p.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
          const u = UPGRADES.find(x => x.id === b.dataset.up), c = u.cost(up[u.id]);
          if (gold < c || up[u.id] >= u.max) return;
          gold -= c;
          up[u.id]++;
          applyUpgrades();
          Arcade.tone({ freq: 500, to: 900, dur: 0.15, type: 'triangle', vol: 0.05 });
          portMenu();
        }));
      },
    });
    updateHud();
  }

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    Arcade.finish(ui, {
      score,
      title: 'Sunk!',
      lines: [`Wave ${wave} · ${sunk} pirate ship${sunk === 1 ? '' : 's'} sent to the bottom`],
      button: 'Sail again',
      onAction: start,
    });
  }

  function pause() {
    if (state !== 'play' || (typeof Versus !== 'undefined' && Versus.active())) return;
    state = 'paused';
    ui.show({ title: 'Paused', html: `<p>Wave ${wave} · ${gold} gold</p>`, button: 'Resume', onAction: () => { state = 'play'; ui.hide(); } });
  }

  // ---------- Input ----------

  const keys = new Set();
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (state !== 'play') return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') me.sail = Math.min(3, me.sail + 1);
    if (e.code === 'KeyS' || e.code === 'ArrowDown') me.sail = Math.max(0, me.sail - 1);
    if (e.code === 'KeyQ' || e.code === 'KeyJ') broadside(me, 0);
    if (e.code === 'KeyE' || e.code === 'KeyK') broadside(me, 1);
    if (e.code === 'Space') autoFire();
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  Arcade.onBlur(pause);

  // Space: fire whichever side has the closest pirate (or both, if they're both covered).
  function autoFire() {
    let best = [Infinity, Infinity];
    for (const s of ships) {
      if (s === me || !s.alive) continue;
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d > 460) continue;
      const rel = angDiff(Math.atan2(s.y - me.y, s.x - me.x), me.h);
      const side = rel < 0 ? 0 : 1;
      if (Math.abs(Math.abs(rel) - Math.PI / 2) < 0.75) best[side] = Math.min(best[side], d);
    }
    const fired = [0, 1].filter(i => best[i] < Infinity).map(i => broadside(me, i));
    if (!fired.length) broadside(me, me.reload[0] <= me.reload[1] ? 0 : 1);
  }

  // ---------- Update ----------

  function update(dt) {
    // The wind slowly swings round.
    wind.turnT -= dt;
    if (wind.turnT <= 0) { wind.turnT = 22 + waveRng() * 18; wind.target = wind.a + (waveRng() - 0.5) * 1.6; }
    wind.a += clamp(angDiff(wind.target, wind.a), -0.08 * dt, 0.08 * dt);
    if (me.alive) sail(me, { turn: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) }, dt);
    for (const s of ships) {
      if (s === me) continue;
      if (s.alive) botControl(s, dt);
      else s.sinkT += dt;
    }
    if (!me.alive) me.sinkT += dt;
    ships = ships.filter(s => s === me || s.sinkT < 3);
    // Ships shoving each other apart.
    for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) {
      const a = ships[i], b = ships[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = (a.t.len + b.t.len) * 0.32;
      if (d < min && d > 0) {
        const push = (min - d) / 2;
        a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push;
        if (a === me || b === me) { const other = a === me ? b : a; if (me.v > 40) damage(other, 4, me); damage(me, 2, other); }
      }
    }
    // Cannonballs fly in an arc and hit whatever hull they pass over low enough.
    for (const b of balls) {
      if (b.t < 0) { b.t += dt; continue; }
      b.t += dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.z = Math.sin(Math.min(1, b.t / b.life) * Math.PI) * 26;
      if (b.t >= b.life) {
        b.dead = true;
        splash(b.x, b.y);
        continue;
      }
      if (b.z > 18 && b.t > 0.2) continue;
      for (const s of ships) {
        if (!s.alive || s.team === b.team) continue;
        const lx = (b.x - s.x) * Math.cos(-s.h) - (b.y - s.y) * Math.sin(-s.h), ly = (b.x - s.x) * Math.sin(-s.h) + (b.y - s.y) * Math.cos(-s.h);
        if ((lx / (s.t.len / 2)) ** 2 + (ly / (s.t.beam / 2)) ** 2 < 1.15) {
          b.dead = true;
          damage(s, b.dmg, b.owner);
          fx.burst(6, () => ({ x: b.x, y: b.y, vx: R(-90, 90), vy: R(-90, 90), life: R(0.4, 0.8), size: R(2, 4), color: s.t.color, shape: 'chip', spin: R(-10, 10), drag: 2 }));
          fx.emit({ x: b.x, y: b.y, life: 0.15, size: 10, grow: -50, color: '#ffd27a' });
          if (s === me) floats.add(`-${b.dmg}`, me.x, me.y - 30, { color: '#ff8a80', size: 14 });
          break;
        }
      }
      for (const is of islands) if (!b.dead && b.z < 10 && Math.hypot(b.x - is.x, b.y - is.y) < is.r * 0.85) { b.dead = true; fx.burst(5, () => ({ x: b.x, y: b.y, vx: R(-50, 50), vy: R(-50, 50), life: 0.5, size: 3, color: '#d9c48a' })); }
    }
    balls = balls.filter(b => !b.dead);
    // Treasure.
    for (const l of loot) {
      l.t -= dt;
      l.bob += dt * 3;
      if (!me.alive) continue;
      const d = Math.hypot(l.x - me.x, l.y - me.y);
      if (d < 70) { l.x += (me.x - l.x) * dt * 4; l.y += (me.y - l.y) * dt * 4; }
      if (d < 30) {
        l.t = 0;
        if (l.kind === 'gold') {
          gold += l.gold; score += l.gold;
          floats.add(`+${l.gold}`, l.x, l.y - 10, { color: '#ffd23f', size: 18 });
          Arcade.tone({ freq: 880, to: 1320, dur: 0.1, type: 'triangle', vol: 0.05 });
        } else {
          me.hp = Math.min(me.max, me.hp + 25);
          floats.add('+25 hull', l.x, l.y - 10, { color: '#3ccf8e', size: 16 });
          Arcade.tone({ freq: 520, to: 780, dur: 0.12, type: 'triangle', vol: 0.05 });
        }
        updateHud();
      }
    }
    loot = loot.filter(l => l.t > 0);
    // Wave cleared: scoop up the treasure, then make port.
    if (me.alive && ships.every(s => s === me || !s.alive)) {
      clearT += dt;
      if (clearT > (loot.length ? 6 : 1.6)) {
        clearT = 0;
        const bonus = 50 * wave;
        gold += bonus; score += bonus;
        floats.add(`Wave bonus +${bonus}`, me.x, me.y - 50, { color: '#ffd23f', size: 18 });
        loot = [];
        portMenu();
      }
    } else clearT = 0;
    fx.update(dt);
    wake.update(dt);
    floats.update(dt);
    shake.update(dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    // Camera leads ahead of the ship.
    const lx = me.x + Math.cos(me.h) * me.v * 0.9, ly = me.y + Math.sin(me.h) * me.v * 0.9;
    cam.x = Gfx.approach(cam.x, clamp(lx, W / 2, WORLD_W - W / 2), 3, dt);
    cam.y = Gfx.approach(cam.y, clamp(ly, H / 2, WORLD_H - H / 2), 3, dt);
    updateHud();
  }

  function splash(x, y) {
    fx.burst(7, () => ({ x, y, vx: R(-40, 40), vy: R(-70, -10), life: R(0.4, 0.7), size: R(2, 4), grow: -3, color: '#e6f6ff' }));
    rings.push({ x, y, t: 0 });
    Arcade.tone({ freq: 300, to: 120, dur: 0.12, type: 'sine', vol: 0.012 });
  }
  let rings = [];

  // ---------- Drawing ----------

  // A tile of sea texture, drawn once and scrolled.
  const TILE = 256;
  const seaTile = Gfx.sprite(TILE, TILE, 0, 0, g => {
    g.fillStyle = '#1f6f9a';
    g.fillRect(0, 0, TILE, TILE);
    const r = Gfx.rng(5);
    // Everything is drawn nine times (shifted a tile each way) so the tile repeats without seams.
    const wrap = fn => { for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) fn(dx, dy); };
    for (let i = 0; i < 40; i++) {
      const x = r() * TILE, y = r() * TILE, rx = 20 + r() * 30, ry = 8 + r() * 10, a = 0.06 + r() * 0.06;
      g.fillStyle = `rgba(10,40,70,${a})`;
      wrap((dx, dy) => { g.beginPath(); g.ellipse(x + dx, y + dy, rx, ry, 0, 0, TAU); g.fill(); });
    }
    g.lineWidth = 2;
    for (let i = 0; i < 70; i++) {
      const x = r() * TILE, y = r() * TILE, w = 10 + r() * 26;
      g.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`;
      wrap((dx, dy) => { g.beginPath(); g.moveTo(x + dx, y + dy); g.quadraticCurveTo(x + dx + w / 2, y + dy - 4, x + dx + w, y + dy); g.stroke(); });
    }
  });

  function drawSea() {
    const ox = Math.round(-((cam.x - W / 2 + time * 6) % TILE + TILE) % TILE), oy = Math.round(-((cam.y - H / 2 + time * 3) % TILE + TILE) % TILE);
    for (let x = ox - TILE; x < W + TILE; x += TILE) for (let y = oy - TILE; y < H + TILE; y += TILE) seaTile.draw(ctx, x, y);
    // Darker water toward the edge of the map.
    const edge = 260;
    const vx = cam.x - W / 2, vy = cam.y - H / 2;
    ctx.fillStyle = 'rgba(5,25,50,0.5)';
    if (vx < edge) ctx.fillRect(0, 0, edge - vx, H);
    if (vy < edge) ctx.fillRect(0, 0, W, edge - vy);
    if (vx + W > WORLD_W - edge) ctx.fillRect(WORLD_W - edge - vx, 0, W, H);
    if (vy + H > WORLD_H - edge) ctx.fillRect(0, WORLD_H - edge - vy, W, H);
  }

  function islandPath(is, scale) {
    ctx.beginPath();
    const n = is.shape.length;
    for (let i = 0; i <= n; i++) {
      const a = is.rot + i / n * TAU, rr = is.r * scale * is.shape[i % n];
      const x = is.x + Math.cos(a) * rr, y = is.y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function drawIsland(is) {
    ctx.fillStyle = 'rgba(120,210,220,0.35)'; islandPath(is, 1.22); ctx.fill();
    ctx.fillStyle = '#e8d49a'; islandPath(is, 1.0); ctx.fill();
    ctx.fillStyle = '#5ea34a'; islandPath(is, 0.78); ctx.fill();
    ctx.fillStyle = '#4c8f3c'; islandPath(is, 0.5); ctx.fill();
    for (const [a, d] of is.palms) {
      const x = is.x + Math.cos(a) * is.r * d, y = is.y + Math.sin(a) * is.r * d;
      Gfx.shadow(ctx, x + 6, y + 6, 12, 6, 0.2);
      ctx.fillStyle = '#2f7a2a';
      for (let k = 0; k < 5; k++) { const la = k / 5 * TAU + a; ctx.beginPath(); ctx.ellipse(x + Math.cos(la) * 8, y + Math.sin(la) * 8, 10, 4, la, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#7a5a32'; ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill();
    }
  }

  function drawShip(s) {
    const t = s.t;
    const sinkK = s.alive ? 1 : Math.max(0, 1 - s.sinkT / 3);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.h + (s.alive ? 0 : s.sinkT * 0.25));
    ctx.globalAlpha = sinkK;
    const L = t.len / 2, B = t.beam / 2, sc = 0.7 + sinkK * 0.3;
    ctx.scale(sc, sc);
    // Shadow, hull, deck planks, rails.
    ctx.fillStyle = 'rgba(0,20,40,0.3)';
    ctx.beginPath(); ctx.ellipse(4, 5, L * 1.02, B * 1.05, 0, 0, TAU); ctx.fill();
    const hullPath = () => { ctx.beginPath(); ctx.moveTo(L, 0); ctx.quadraticCurveTo(L * 0.55, -B * 1.05, -L * 0.15, -B); ctx.lineTo(-L, -B * 0.82); ctx.lineTo(-L, B * 0.82); ctx.lineTo(-L * 0.15, B); ctx.quadraticCurveTo(L * 0.55, B * 1.05, L, 0); ctx.closePath(); };
    hullPath();
    ctx.fillStyle = s.hitT > 0 ? '#fff' : Gfx.shade(t.color, -0.2);
    ctx.fill();
    ctx.save(); ctx.scale(0.84, 0.74); hullPath(); ctx.fillStyle = s.hitT > 0 ? '#fff' : Gfx.shade(t.color, 0.25); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
    for (let y = -B * 0.6; y <= B * 0.6; y += 4) { ctx.beginPath(); ctx.moveTo(-L * 0.8, y); ctx.lineTo(L * 0.6, y); ctx.stroke(); }
    // Cannons poking out of both sides.
    ctx.fillStyle = '#1e1e1e';
    for (let i = 0; i < s.guns; i++) {
      const x = (s.guns === 1 ? 0 : i / (s.guns - 1) - 0.5) * t.len * 0.62;
      ctx.fillRect(x - 2, -B - 3, 4, 5); ctx.fillRect(x - 2, B - 2, 4, 5);
    }
    // Masts and sails, swung round to catch the wind.
    const masts = t.len > 80 ? [-0.3, 0.05, 0.38] : t.len > 50 ? [-0.18, 0.25] : [0.05];
    const sailAng = clamp(angDiff(wind.a, s.h) * 0.5, -0.9, 0.9);
    const fill = s.sail / 3;
    for (const m of masts) {
      const mx = m * t.len;
      ctx.save();
      ctx.translate(mx, 0);
      ctx.rotate(sailAng);
      if (fill > 0) {
        const w = t.beam * (1.1 + (t.len > 80 ? 0.3 : 0)), depth = 4 + fill * 7;
        ctx.fillStyle = Gfx.shade(t.sail, -0.15);
        ctx.beginPath(); ctx.moveTo(0, -w / 2); ctx.quadraticCurveTo(depth * 1.4, 0, 0, w / 2); ctx.lineTo(-2, w / 2); ctx.lineTo(-2, -w / 2); ctx.fill();
        ctx.fillStyle = t.sail;
        ctx.beginPath(); ctx.moveTo(0, -w / 2); ctx.quadraticCurveTo(depth, 0, 0, w / 2); ctx.closePath(); ctx.fill();
      } else {
        ctx.fillStyle = t.sail; ctx.fillRect(-2, -t.beam * 0.55, 3, t.beam * 1.1);
      }
      ctx.fillStyle = '#3a2614'; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // Flag at the stern, streaming downwind.
    ctx.save();
    ctx.translate(-L * 0.9, 0);
    ctx.rotate(angDiff(wind.a, s.h));
    ctx.fillStyle = t.flag;
    ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(12, -4 + Math.sin(time * 9 + s.x) * 1.5); ctx.lineTo(12, 3 + Math.sin(time * 9 + s.x) * 1.5); ctx.lineTo(0, 2); ctx.fill();
    ctx.restore();
    ctx.restore();
    ctx.globalAlpha = 1;
    if (s.alive && s !== me) Gfx.bar(ctx, s.x - 24, s.y - t.len * 0.5 - 14, 48, 5, s.hp / s.max, '#ff5c5c');
  }

  function draw() {
    const off = shake.offset(9);
    ctx.save();
    ctx.translate(off.x, off.y);
    drawSea();
    ctx.save();
    ctx.translate(W / 2 - cam.x, H / 2 - cam.y);
    for (const r of rings) {
      const k = r.t / 0.8;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - k)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, 4 + k * 22, 3 + k * 14, 0, 0, TAU); ctx.stroke();
    }
    for (const is of islands) if (Math.abs(is.x - cam.x) < W / 2 + is.r * 1.3 && Math.abs(is.y - cam.y) < H / 2 + is.r * 1.3) drawIsland(is);
    for (const l of loot) {
      const y = l.y + Math.sin(l.bob) * 2;
      ctx.globalAlpha = l.t < 4 ? (Math.floor(l.t * 6) % 2 ? 0.4 : 1) : 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(l.x, y + 4, 14 + Math.sin(l.bob) * 2, 6, 0, 0, TAU); ctx.stroke();
      if (l.kind === 'gold') {
        ctx.fillStyle = '#7a4f22'; Gfx.roundRect(ctx, l.x - 9, y - 7, 18, 13, 3); ctx.fill();
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(l.x - 9, y - 2, 18, 3); ctx.fillRect(l.x - 2, y - 5, 4, 6);
      } else {
        ctx.fillStyle = '#9a6a3a'; ctx.beginPath(); ctx.ellipse(l.x, y, 9, 7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3ccf8e'; ctx.fillRect(l.x - 5, y - 1.5, 10, 3); ctx.fillRect(l.x - 1.5, y - 5, 3, 10);
      }
      ctx.globalAlpha = 1;
    }
    wake.draw(ctx);
    for (const s of ships) if (Math.abs(s.x - cam.x) < W / 2 + 80 && Math.abs(s.y - cam.y) < H / 2 + 80) drawShip(s);
    fx.draw(ctx);
    for (const b of balls) {
      if (b.t < 0) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(b.x, b.y - b.z, 3.4, 0, TAU); ctx.fill();
    }
    floats.draw(ctx);
    ctx.restore();
    ctx.restore();
    drawHud();
  }

  function drawHud() {
    if (!me || state === 'menu') return;
    // Hull and the two batteries.
    Gfx.card(ctx, 12, 12, 230, 64);
    Gfx.text(ctx, 'Hull', 24, 26, { size: 12, align: 'left', color: '#cfd8dc', stroke: null });
    Gfx.bar(ctx, 64, 20, 166, 10, Math.max(0, me.hp) / me.max, me.hp > me.max * 0.35 ? '#3ccf8e' : '#ff4d6d');
    for (const [i, label] of [[0, 'Port (Q)'], [1, 'Starboard (E)']]) {
      const ready = me.reload[i] <= 0;
      Gfx.text(ctx, label, 24, 46 + i * 16, { size: 11, align: 'left', color: ready ? '#ffd23f' : '#8d94a1', stroke: null });
      Gfx.bar(ctx, 120, 41 + i * 16, 110, 7, 1 - me.reload[i] / me.reloadTime, ready ? '#ffd23f' : '#6b7280');
    }
    // Sails.
    Gfx.card(ctx, 12, 82, 230, 30);
    Gfx.text(ctx, `Sails ${['furled', 'half', 'three-quarter', 'full'][me.sail]} · ${Math.round(me.v / 10)} knots`, 24, 97, { size: 12, align: 'left', stroke: null });
    // Wind compass.
    const cx = W - 52, cy = 52;
    Gfx.card(ctx, cx - 40, cy - 40, 80, 92);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 28, 0, TAU); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(wind.a);
    ctx.fillStyle = '#7ef0ff';
    ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(4, -9); ctx.lineTo(8, 0); ctx.lineTo(4, 9); ctx.fill();
    ctx.fillRect(-22, -2, 28, 4);
    ctx.restore();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(me.h);
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -5); ctx.lineTo(-8, 5); ctx.fill();
    ctx.restore();
    const wf = windFactor(me.h);
    Gfx.text(ctx, wf > 0.85 ? 'Great wind' : wf > 0.5 ? 'Good wind' : 'Into the wind', cx, cy + 40, { size: 10, color: wf > 0.5 ? '#9be37a' : '#ff8a80', stroke: null });
    // Minimap.
    const mw = 150, mh = mw * WORLD_H / WORLD_W, mx = W - mw - 12, my = H - mh - 12;
    Gfx.card(ctx, mx - 4, my - 4, mw + 8, mh + 8, { fill: 'rgba(10,30,50,0.75)' });
    const k = mw / WORLD_W;
    ctx.fillStyle = '#d9c48a';
    for (const is of islands) { ctx.beginPath(); ctx.arc(mx + is.x * k, my + is.y * k, Math.max(2, is.r * k), 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#ffd23f';
    for (const l of loot) ctx.fillRect(mx + l.x * k - 1, my + l.y * k - 1, 2, 2);
    for (const s of ships) {
      if (!s.alive) continue;
      ctx.fillStyle = s === me ? '#4fc3ff' : s.type === 'galleon' ? '#ffd23f' : '#ff5c5c';
      ctx.beginPath(); ctx.arc(mx + s.x * k, my + s.y * k, s === me ? 3.5 : 2.5, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + (cam.x - W / 2) * k, my + (cam.y - H / 2) * k, W * k, H * k);
    // Score and wave.
    Gfx.text(ctx, `💰 ${gold.toLocaleString()}`, W / 2, 24, { size: 20, color: '#ffd23f' });
    const left = ships.filter(s => s !== me && s.alive).length;
    Gfx.text(ctx, left ? `Wave ${wave} · ${left} pirate${left === 1 ? '' : 's'} left` : loot.length ? 'Collect the treasure!' : 'Wave clear!', W / 2, 46, { size: 12, color: '#e0e6f0' });
    // Arrows toward pirates off screen.
    for (const s of ships) {
      if (s === me || !s.alive) continue;
      const dx = s.x - cam.x, dy = s.y - cam.y;
      if (Math.abs(dx) < W / 2 - 20 && Math.abs(dy) < H / 2 - 20) continue;
      const a = Math.atan2(dy, dx), ex = W / 2 + clamp(dx, -W / 2 + 26, W / 2 - 26), ey = H / 2 + clamp(dy, -H / 2 + 26, H / 2 - 26);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
      ctx.fillStyle = s.type === 'galleon' ? '#ffd23f' : '#ff5c5c';
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.fill();
      ctx.restore();
    }
    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      Gfx.text(ctx, banner.text, W / 2, H / 2 - 70, { size: 34, width: 6 });
      if (banner.sub) Gfx.text(ctx, banner.sub, W / 2, H / 2 - 36, { size: 16, color: '#ffd23f' });
      ctx.globalAlpha = 1;
    }
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('wave').textContent = wave || '-';
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const duel = typeof Versus !== 'undefined' && Versus.active();
    if (state === 'play' && (overlayEl.hidden || duel)) update(dt);
    else if (state === 'over' || state === 'port') { fx.update(dt); floats.update(dt); shake.update(dt); }
    // In an online duel, port doesn't stop the clock for your rival, so it doesn't stop yours.
    if (state === 'port' && duel) update(dt);
    time += dt * (state === 'paused' ? 0 : 1);
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < 0.8);
    if (me) draw();
    else drawMenuSea();
    requestAnimationFrame(frame);
  }
  function drawMenuSea() {
    cam.x = WORLD_W / 2 + Math.sin(time * 0.1) * 300; cam.y = WORLD_H / 2;
    drawSea();
  }

  const intro = {
    title: '⚓ Broadside',
    html: `<p>Pirates on every horizon. Sink them with broadsides and haul in their treasure.</p>
      <ul style="text-align:left;font-size:14px">
        <li><b>A / D</b> steer, <b>W / S</b> raise or lower sail.</li>
        <li>Your cannons point out of the sides: <b>Q</b> fires to port (left), <b>E</b> to starboard (right), <b>Space</b> picks the side with a target.</li>
        <li>Watch the wind arrow. Sailing across the wind is fastest; straight into it, you'll barely move.</li>
        <li>Clear a wave to make port and upgrade your ship. Galleons come every fifth wave.</li>
      </ul>`,
    button: 'Set sail',
    onAction: start,
  };
  updateHud();
  Versus.attach({ ui, start, score: () => score, intro });
  requestAnimationFrame(frame);
})();
