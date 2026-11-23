/* Cloud Aces: side-view biplane dogfights over the countryside. Pull up to climb (hold it to
   loop the loop), push down to dive; diving gains speed, climbing bleeds it, and too slow is a
   stall. The plane rolls itself upright after a half loop, so up always means "nose up".
   Squadron: waves of enemy planes and blimps. Ace duel: one CPU ace, first to 5. Two players:
   the same on one keyboard. The arena wraps around left and right. */
(() => {
  const ID = 'cloud-aces';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const GROUND = 486, CEIL = 26;
  const DUEL_TO = 5;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const wrapX = x => ((x % W) + W) % W;
  const dxWrap = (a, b) => { let d = b - a; if (d > W / 2) d -= W; if (d < -W / 2) d += W; return d; };
  const fx = Gfx.particles(900), floats = Gfx.floaters(), shake = Gfx.shaker();
  const R = Gfx.rand;   // cosmetic randomness (keeps duel seeds in step)

  // ---------- Planes ----------

  const KINDS = {
    player: { hp: 6, turn: 3.1, cruise: 235, boost: 345, gun: 0.11, color: '#4fc3ff', trim: '#e8f6ff' },
    p2: { hp: 6, turn: 3.1, cruise: 235, boost: 345, gun: 0.11, color: '#ff5a5f', trim: '#ffe3e3' },
    scout: { hp: 2, turn: 2.6, cruise: 215, boost: 290, gun: 0.32, color: '#9be37a', trim: '#2f5a1f', pts: 100 },
    ace: { hp: 4, turn: 3.0, cruise: 240, boost: 330, gun: 0.18, color: '#ffb02e', trim: '#5a3200', pts: 250 },
    gunship: { hp: 7, turn: 1.7, cruise: 175, boost: 210, gun: 0.5, color: '#b07cff', trim: '#2c1a4d', pts: 300, big: true },
  };
  const LEVELS = [
    { name: 'Rookie', turn: 0.72, aim: 0.22, react: 0.6, desc: 'Learning to fly' },
    { name: 'Pilot', turn: 0.88, aim: 0.12, react: 0.38, desc: 'Fair fight' },
    { name: 'Ace', turn: 1, aim: 0.05, react: 0.2, desc: 'Watch your six' },
  ];

  function makePlane(kind, x, y, a, team) {
    const k = KINDS[kind];
    return { kind, k, team, x, y, a, s: k.cruise, fall: 0, flip: Math.cos(a) >= 0 ? 1 : -1, roll: Math.cos(a) >= 0 ? 1 : -1, invT: 0,
      hp: k.hp, alive: true, fireT: 0, boost: 1, twinT: 0, shieldT: 0, rockets: 0, hitT: 0, respawnT: 0, kills: 0, loop: 0, loopDir: 0, prop: 0,
      ai: null, spawnT: 1.2, trail: 0 };
  }

  // ---------- State ----------

  let mode = 'squad';   // squad · ace · two
  let state = 'menu', planes = [], bullets = [], rockets = [], pickups = [], blimps = [];
  let p1 = null, p2 = null, score = 0, lives = 3, wave = 0, waveT = 0, combo = 0, comboT = 0, toSpawn = [], spawnT = 0, level = 1, banner = null, time = 0, waveRng = Math.random;
  let wins = [0, 0];
  const prefs = Arcade.load('aces:prefs', { level: 1 });

  // ---------- Physics ----------

  // input: { pitch: -1 | 0 | 1 (1 = nose up), boost, fire, rocket }
  function fly(p, input, dt) {
    if (!p.alive) return;
    const k = p.k, stalled = p.s < 118;
    // Turning: "up" is toward the top of the pilot's head, which is `flip`.
    let turn = input.pitch * k.turn * (stalled ? 0.45 : 1) * (p.boosting ? 0.85 : 1);
    if (input.rot !== undefined) turn = input.rot;   // bots steer directly
    const before = p.a;
    p.a -= turn * p.flip * dt;
    p.a = Math.atan2(Math.sin(p.a), Math.cos(p.a));
    // Loops: count how far it has turned one way without stopping.
    const dA = angDiff(p.a, before);
    if (Math.abs(dA) > 0.0001) {
      const dir = Math.sign(dA);
      if (dir !== p.loopDir) { p.loopDir = dir; p.loop = 0; }
      p.loop += Math.abs(dA);
      if (p.loop >= TAU) { p.loop = 0; onLoop(p); }
    } else p.loop = Math.max(0, p.loop - dt * 2);
    // Speed: gravity along the nose, the engine pulling toward cruise (or boost) speed.
    const sinA = Math.sin(p.a);
    p.boosting = input.boost && p.boost > 0.05;
    p.boost = clamp(p.boost + (p.boosting ? -0.42 : 0.18) * dt, 0, 1);
    const target = p.boosting ? k.boost : k.cruise;
    p.s += 260 * sinA * dt;
    p.s += (target - p.s) * (p.boosting ? 1.6 : 0.55) * dt;
    p.s = clamp(p.s, 40, 470);
    // Stall: the nose drops and the plane sinks until it's going fast enough again.
    if (stalled) {
      const down = Math.PI / 2;
      p.a += clamp(angDiff(down, p.a), -1.4 * dt, 1.4 * dt);
      p.fall = Math.min(260, p.fall + 300 * dt);
    } else p.fall = Math.max(0, p.fall - 420 * dt);
    p.x = wrapX(p.x + Math.cos(p.a) * p.s * dt);
    p.y += (sinA * p.s + p.fall) * dt;
    // Upside down for a moment with the stick released: roll upright.
    const inverted = p.flip * Math.cos(p.a) < -0.15;
    p.invT = inverted && input.pitch === 0 ? p.invT + dt : inverted && p.ai ? p.invT + dt : 0;
    if (p.invT > (p.ai ? 0.25 : 0.35)) { p.flip = -p.flip; p.invT = 0; }
    p.roll = Gfx.approach(p.roll, p.flip, 9, dt);
    // The ceiling is rough air: it shoves you back down.
    if (p.y < CEIL) { p.y = CEIL; p.a += clamp(angDiff(Math.cos(p.a) >= 0 ? 0.5 : Math.PI - 0.5, p.a), -3 * dt, 3 * dt); p.s *= 1 - dt; }
    p.prop += dt * (20 + p.s / 10);
    p.fireT = Math.max(0, p.fireT - dt);
    p.twinT = Math.max(0, p.twinT - dt);
    p.shieldT = Math.max(0, p.shieldT - dt);
    p.hitT = Math.max(0, p.hitT - dt);
    p.spawnT = Math.max(0, p.spawnT - dt);
    p.bumpT = Math.max(0, (p.bumpT || 0) - dt);
    if (input.fire) shoot(p);
    if (input.rocket) launchRocket(p);
    // Smoke from a damaged plane, and wingtip trails at speed.
    p.trail -= dt;
    if (p.trail <= 0) {
      p.trail = 0.04;
      const hurt = p.hp <= p.k.hp / 2;
      const bx = p.x - Math.cos(p.a) * 18, by = p.y - Math.sin(p.a) * 18;
      if (hurt) fx.emit({ x: bx, y: by, vx: R(-15, 15), vy: R(-30, -10), life: R(0.6, 1.1), size: R(4, 7), grow: 9, color: p.hp <= 1 ? '#3a3a3a' : '#8a8a8a', drag: 1 });
      else if (p.boosting || p.s > 330) fx.emit({ x: bx, y: by, life: 0.35, size: 2.5, grow: -4, color: 'rgba(255,255,255,0.7)' });
    }
    if (p.y >= GROUND - 6) crash(p);
  }

  function onLoop(p) {
    if (p === p1 || p === p2) {
      floats.add('LOOP!', p.x, p.y - 30, { color: '#ffe066', size: 18 });
      Arcade.tone({ freq: 520, to: 1040, dur: 0.2, type: 'triangle', vol: 0.05 });
      if (p === p1) Arcade.flag('cloud-aces-loop');
      if (mode === 'squad' && p === p1) addScore(50, p.x, p.y - 50, false);
    }
  }

  // ---------- Weapons ----------

  function shoot(p) {
    if (p.fireT > 0 || p.spawnT > 0.8) return;
    p.fireT = p.k.gun;
    const twin = p.twinT > 0;
    const cos = Math.cos(p.a), sin = Math.sin(p.a);
    const offs = twin ? [-5, 5] : [0];
    for (const o of offs) {
      const nx = -sin * o * p.flip, ny = cos * o * p.flip;
      const spread = p.ai ? R(-0.03, 0.03) : R(-0.012, 0.012);
      const a = p.a + spread;
      bullets.push({ x: p.x + cos * 22 + nx, y: p.y + sin * 22 + ny, vx: Math.cos(a) * (p.s + 620), vy: Math.sin(a) * (p.s + 620), life: p.ai ? 0.75 : 0.85, owner: p, team: p.team });
    }
    fx.emit({ x: p.x + cos * 24, y: p.y + sin * 24, life: 0.06, size: 6, grow: -40, color: '#ffe9a8' });
    const near = p === p1 || p === p2;
    Arcade.tone({ freq: near ? 640 : 520, to: 220, dur: 0.04, type: 'square', vol: near ? 0.018 : 0.008 });
  }

  function launchRocket(p) {
    if (p.rockets <= 0 || p.fireT > 0) return;
    p.rockets--;
    p.fireT = 0.25;
    rockets.push({ x: p.x, y: p.y + 6, a: p.a, s: p.s + 120, life: 3, owner: p, team: p.team, smoke: 0 });
    Arcade.tone({ freq: 200, to: 600, dur: 0.3, type: 'sawtooth', vol: 0.04 });
  }

  function hurt(p, dmg, by) {
    if (!p.alive || p.spawnT > 0) return;
    if (p.shieldT > 0) {
      fx.burst(5, () => ({ x: p.x, y: p.y, vx: R(-80, 80), vy: R(-80, 80), life: 0.3, size: 2, color: '#7ef0ff', shape: 'spark' }));
      return;
    }
    p.hp -= dmg;
    p.hitT = 0.12;
    if (p === p1 || p === p2) { shake.add(0.25); Arcade.tone({ freq: 160, to: 90, dur: 0.1, type: 'square', vol: 0.04 }); }
    fx.burst(4, () => ({ x: p.x, y: p.y, vx: R(-120, 120), vy: R(-120, 60), life: 0.4, size: 2, color: '#ffd27a', shape: 'spark', drag: 2 }));
    if (p.hp <= 0) destroy(p, by);
  }

  function destroy(p, by) {
    p.alive = false;
    explode(p.x, p.y, p.k.big ? 1.6 : 1, p.k.color);
    // The pilot bails out.
    fx.emit({ x: p.x, y: p.y, vx: R(-30, 30), vy: -60, life: 3.2, size: 5, color: '#fff', shape: 'square', fade: true, drag: 1.5 });
    if (by && by.alive !== undefined) by.kills++;
    if (mode === 'squad') {
      if (p === p1) return loseLife();
      if (by === p1 || by?.team === 0) {
        combo = comboT > 0 ? combo + 1 : 1;
        comboT = 3;
        addScore(p.k.pts * Math.min(combo, 5), p.x, p.y - 20, true);
        if (Math.random() < (p.k.big ? 0.9 : 0.28)) dropPickup(p.x, p.y);
      }
    } else {
      const winner = p === p1 ? 1 : 0;
      wins[winner]++;
      banner = { text: `${winner === 0 ? nameOf(0) : nameOf(1)} scores!`, t: 1.6, color: winner === 0 ? KINDS.player.color : (mode === 'two' ? KINDS.p2.color : KINDS.ace.color) };
      if (wins[winner] >= DUEL_TO) setTimeout(endDuel, 1400);
      else p.respawnT = 1.8;
    }
  }

  function crash(p) {
    if (!p.alive) return;
    p.y = GROUND - 6;
    fx.burst(14, () => ({ x: p.x + R(-20, 20), y: GROUND, vx: R(-120, 120), vy: R(-220, -60), g: 0, life: R(0.5, 1), size: R(2, 4), color: '#7a5a3a', drag: 1 }));
    p.hp = 0;
    if (mode === 'squad' && p !== p1) {
      // A bot flew into the ground: half points for you.
      p.alive = false;
      explode(p.x, p.y, 1, p.k.color);
      addScore(Math.round(p.k.pts / 2), p.x, p.y - 30, true);
      return;
    }
    destroy(p, mode === 'squad' ? null : (p === p1 ? planes.find(o => o.team === 1) : p1));
  }

  function explode(x, y, size, color) {
    shake.add(0.3 * size);
    fx.burst(Math.round(26 * size), () => {
      const a = R(0, TAU), v = R(40, 260) * size;
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.4, 0.9), size: R(3, 7) * size, grow: -5, color: ['#fff3b0', '#ffb02e', '#ff6b3d', '#ffd23f'][Math.floor(R(0, 4))], drag: 3 };
    });
    fx.burst(Math.round(10 * size), () => ({ x, y, vx: R(-160, 160), vy: R(-200, 40), life: R(0.8, 1.4), size: R(3, 5), color, shape: 'chip', spin: R(-12, 12), drag: 0.8 }));
    fx.burst(Math.round(8 * size), () => ({ x: x + R(-10, 10), y: y + R(-10, 10), vx: R(-30, 30), vy: R(-50, -10), life: R(1, 1.8), size: R(8, 14) * size, grow: 10, color: 'rgba(60,60,70,0.6)', drag: 1 }));
    Arcade.tone({ freq: 120, to: 40, dur: 0.45, type: 'sawtooth', vol: 0.06 });
  }

  // ---------- Pickups ----------

  const PICKUPS = [
    { id: 'twin', label: 'Twin guns', color: '#ffd23f' },
    { id: 'repair', label: 'Repair', color: '#3ccf8e' },
    { id: 'shield', label: 'Shield', color: '#7ef0ff' },
    { id: 'rockets', label: 'Rockets', color: '#ff7a45' },
  ];
  function dropPickup(x, y) {
    const k = PICKUPS[Math.floor(waveRng() * PICKUPS.length)];
    pickups.push({ ...k, x, y: Math.min(y, GROUND - 60), t: 12, bob: R(0, TAU) });
  }
  function collect(p, k) {
    if (k.id === 'twin') p.twinT = 14;
    if (k.id === 'repair') p.hp = p.k.hp;
    if (k.id === 'shield') p.shieldT = 8;
    if (k.id === 'rockets') p.rockets = Math.min(9, p.rockets + 3);
    floats.add(k.label, p.x, p.y - 26, { color: k.color, size: 16 });
    Arcade.tone({ freq: 660, to: 1320, dur: 0.15, type: 'triangle', vol: 0.05 });
  }

  // ---------- Squadron waves ----------

  // Waves come from their own seeded generator, so an online duel deals both players the same ones.
  function nextWave() {
    wave++;
    const n = Math.min(3 + wave, 10);
    toSpawn = [];
    for (let i = 0; i < n; i++) {
      const r = waveRng();
      const kind = wave >= 3 && r < Math.min(0.12 + wave * 0.025, 0.3) ? 'gunship' : wave >= 2 && r < 0.45 + wave * 0.03 ? 'ace' : 'scout';
      toSpawn.push({ kind, side: waveRng() < 0.5 ? -1 : 1, y: 80 + waveRng() * 220 });
    }
    if (wave % 3 === 0) blimps.push(makeBlimp());
    spawnT = 1.2;
    banner = { text: `WAVE ${wave}`, t: 2, color: '#ffffff', sub: wave % 3 === 0 ? 'Blimp spotted!' : '' };
    Arcade.tone({ freq: 330, to: 660, dur: 0.4, type: 'triangle', vol: 0.05 });
    if (wave >= 5) Arcade.flag('cloud-aces-wave5');
  }
  function makeBlimp() {
    const dir = waveRng() < 0.5 ? 1 : -1;
    return { x: dir > 0 ? -140 : W + 140, y: 110 + waveRng() * 120, dir, hp: 30, max: 30, hitT: 0, gunT: 2, alive: true };
  }

  function spawnBot(kind, side, y) {
    const x = side < 0 ? 0 : W - 1;
    const p = makePlane(kind, x, y, side < 0 ? 0 : Math.PI, 1);
    p.spawnT = 0;
    const lv = LEVELS[mode === 'squad' ? Math.min(2, Math.floor((wave - 1) / 3)) : level];
    p.ai = { lv, t: 0, aimErr: R(-1, 1) * lv.aim, seeT: 0, evadeT: 0, wantY: y };
    planes.push(p);
  }

  // ---------- Bots ----------

  function botInput(p, dt) {
    const ai = p.ai, lv = ai.lv;
    ai.t -= dt;
    // Pick the closest enemy plane.
    let tgt = null, bd = Infinity;
    for (const o of planes) {
      if (!o.alive || o.team === p.team) continue;
      const d = Math.hypot(dxWrap(p.x, o.x), o.y - p.y);
      if (d < bd) { bd = d; tgt = o; }
    }
    let want = p.a;
    let fire = false, boost = false;
    if (tgt) {
      const lead = bd / 900;
      const tx = dxWrap(p.x, tgt.x + Math.cos(tgt.a) * tgt.s * lead), ty = tgt.y + Math.sin(tgt.a) * tgt.s * lead - p.y;
      want = Math.atan2(ty, tx) + ai.aimErr;
      const off = Math.abs(angDiff(want, p.a));
      if (off < 0.5) ai.seeT += dt; else ai.seeT = 0;
      fire = off < 0.16 && bd < 430 && ai.seeT > lv.react;
      boost = bd > 380 || (off > 2.2 && bd < 160);
      if (ai.t <= 0) { ai.t = 0.6 + R(0, 0.6); ai.aimErr = R(-1, 1) * lv.aim; }
    } else {
      want = Math.cos(p.a) >= 0 ? 0 : Math.PI;
    }
    // Stay off the ground and out of the rough air.
    const nose = Math.sin(p.a);
    if (p.y > GROUND - 120 && nose > -0.2) want = Math.cos(p.a) >= 0 ? -0.6 : Math.PI + 0.6;
    if (p.y > GROUND - 70) want = -Math.PI / 2;
    if (p.y < CEIL + 50 && nose < 0.2) want = Math.cos(p.a) >= 0 ? 0.5 : Math.PI - 0.5;
    if (p.s < 140) { want = Math.cos(p.a) >= 0 ? 0.9 : Math.PI - 0.9; boost = true; }
    const diff = angDiff(want, p.a);
    const rate = p.k.turn * lv.turn;
    const rot = clamp(diff * 6, -rate, rate) * -p.flip;
    return { pitch: Math.sign(rot) * -p.flip || 0, rot, boost, fire };
  }

  // ---------- Players' input ----------

  const keys = new Set();
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'Space', 'ArrowLeft', 'ArrowRight'].includes(e.code) && state === 'play') e.preventDefault();
    if ((e.code === 'KeyP' || e.code === 'Escape') && state === 'play') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  Arcade.onBlur(() => { if (state === 'play') pause(); });
  const k = c => keys.has(c);
  function inputFor(n) {
    if (mode !== 'two') {
      // One player: either set of keys.
      return {
        pitch: (k('ArrowUp') || k('KeyW') ? 1 : 0) - (k('ArrowDown') || k('KeyS') ? 1 : 0),
        boost: k('ShiftLeft') || k('ShiftRight') || k('ArrowRight') || k('KeyD'),
        fire: k('Space') || k('KeyJ') || k('KeyF') || touch.fire,
        rocket: k('KeyX') || k('KeyK') || k('KeyR'),
      };
    }
    return n === 0
      ? { pitch: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0), boost: k('ShiftLeft') || k('KeyD'), fire: k('Space') || k('KeyF') }
      : { pitch: (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0), boost: k('ShiftRight') || k('ArrowLeft'), fire: k('Enter') || k('NumpadEnter') || k('Slash') || k('KeyL') };
  }
  // Touch: hold the top or bottom of the screen to climb or dive; a second finger fires.
  const touch = { pitch: 0, fire: false };
  canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') touchUpdate(e); });
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'touch' && e.buttons) touchUpdate(e); });
  addEventListener('pointerup', () => { touch.pitch = 0; touch.fire = false; });
  function touchUpdate(e) {
    const r = canvas.getBoundingClientRect();
    touch.fire = true;
    touch.pitch = (e.clientY - r.top) / r.height < 0.5 ? 1 : -1;
  }

  // ---------- Flow ----------

  function start(m = mode) {
    mode = m;
    state = 'play';
    planes = []; bullets = []; rockets = []; pickups = []; blimps = []; fx.clear();
    score = 0; lives = 3; wave = 0; combo = 0; comboT = 0; time = 0; wins = [0, 0];
    level = prefs.level;
    p1 = makePlane('player', 120, 200, 0, 0);
    p2 = null;
    planes.push(p1);
    if (mode === 'squad') {
      // One draw from Math.random seeds the waves (in a duel, both players' match).
      const seed = Math.floor(Math.random() * 2 ** 31);
      waveRng = Gfx.rng(seed);
      nextWave();
    } else if (mode === 'two') {
      p2 = makePlane('p2', W - 120, 320, Math.PI, 1);
      planes.push(p2);
      banner = { text: `FIRST TO ${DUEL_TO}`, t: 2, color: '#fff' };
    } else {
      const bot = makePlane('ace', W - 120, 320, Math.PI, 1);
      bot.ai = { lv: LEVELS[level], t: 0, aimErr: 0, seeT: 0 };
      bot.k = { ...KINDS.ace, hp: 6, turn: 3.1, cruise: 235, boost: 345, gun: 0.13 };
      bot.hp = 6;
      planes.push(bot);
      banner = { text: `FIRST TO ${DUEL_TO}`, t: 2, color: '#fff' };
    }
    ui.hide();
    updateHud();
  }

  function respawn(p) {
    const left = p === p1;
    p.x = left ? 120 : W - 120;
    p.y = left ? 150 + R(0, 60) : 280 + R(0, 60);
    p.a = left ? 0 : Math.PI;
    p.flip = p.roll = left ? 1 : -1;
    p.s = p.k.cruise; p.fall = 0;
    p.hp = p.k.hp; p.alive = true; p.spawnT = 1.5; p.boost = 1; p.twinT = 0; p.shieldT = 0;
  }

  function loseLife() {
    lives--;
    combo = 0;
    updateHud();
    if (lives <= 0) return setTimeout(gameOver, 1200);
    p1.respawnT = 1.6;
    banner = { text: lives === 1 ? 'LAST PLANE!' : `${lives} PLANES LEFT`, t: 1.6, color: '#ff8a80' };
  }

  function addScore(n, x, y, kill) {
    score += n;
    floats.add(`+${n}${kill && combo > 1 ? ` ×${Math.min(combo, 5)}` : ''}`, x, y, { color: combo > 1 && kill ? '#ffd23f' : '#fff', size: combo > 1 && kill ? 20 : 16 });
    updateHud();
  }

  function gameOver() {
    if (state !== 'play') return;
    state = 'over';
    Arcade.finish(ui, {
      score,
      title: 'Shot down',
      lines: [`Reached wave ${wave} · ${p1.kills} plane${p1.kills === 1 ? '' : 's'} downed`],
      button: 'Fly again',
      onAction: () => start('squad'),
    });
    addMenuButton();
  }

  function nameOf(i) {
    if (mode === 'two') return i === 0 ? 'Blue' : 'Red';
    return i === 0 ? 'You' : `${LEVELS[level].name} ace`;
  }

  function endDuel() {
    if (state !== 'play') return;
    state = 'over';
    const youWon = wins[0] > wins[1];
    if (mode === 'ace') {
      if (youWon) {
        Arcade.flag('cloud-aces-duel');
        if (level === 2) Arcade.flag('cloud-aces-ace');
      }
      Arcade.countPlay();
      ui.show({
        title: youWon ? 'You win the duel!' : `The ${LEVELS[level].name} ace wins`,
        html: `<p class="big">${wins[0]} – ${wins[1]}</p><div class="menu"><button class="btn secondary" type="button" data-menu>Menu</button></div>`,
        button: 'Rematch',
        delay: 500,
        onAction: () => start('ace'),
        onRender: p => p.querySelector('[data-menu]').addEventListener('click', showMenu),
      });
    } else {
      Arcade.countPlay();
      ui.show({
        title: `${youWon ? 'Blue' : 'Red'} wins!`,
        html: `<p class="big">${wins[0]} – ${wins[1]}</p><div class="menu"><button class="btn secondary" type="button" data-menu>Menu</button></div>`,
        button: 'Rematch',
        delay: 500,
        onAction: () => start('two'),
        onRender: p => p.querySelector('[data-menu]').addEventListener('click', showMenu),
      });
    }
  }

  function addMenuButton() {
    const panel = overlayEl.querySelector('.panel');
    if (!panel || (typeof Versus !== 'undefined' && Versus.active())) return;
    panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-menu>Other modes</button></div>');
    panel.querySelector('[data-menu]').addEventListener('click', showMenu);
  }

  function pause() {
    if (state !== 'play' || (typeof Versus !== 'undefined' && Versus.active())) return;
    state = 'paused';
    ui.show({
      title: 'Paused',
      html: '<div class="menu"><button class="btn secondary" type="button" data-quit>Quit to menu</button></div>',
      button: 'Resume',
      onAction: () => { state = 'play'; ui.hide(); },
      onRender: p => p.querySelector('[data-quit]').addEventListener('click', showMenu),
    });
  }

  // ---------- Update ----------

  function update(dt) {
    time += dt;
    comboT = Math.max(0, comboT - dt);
    if (comboT === 0) combo = 0;
    for (const p of planes) {
      if (!p.alive) {
        if (p.respawnT > 0) { p.respawnT -= dt; if (p.respawnT <= 0) respawn(p); }
        continue;
      }
      const input = p.ai ? botInput(p, dt) : inputFor(p === p1 ? 0 : 1);
      fly(p, input, dt);
    }
    // Squadron spawning.
    if (mode === 'squad' && state === 'play') {
      spawnT -= dt;
      if (toSpawn.length && spawnT <= 0) {
        const s = toSpawn.shift();
        spawnBot(s.kind, s.side, s.y);
        spawnT = 1.1;
      }
      planes = planes.filter(p => p.alive || p.team === 0);
      if (!toSpawn.length && planes.length === 1 && !blimps.length) {
        waveT += dt;
        if (waveT > 1.6) {
          waveT = 0;
          addScore(150 * wave, W / 2, 140, false);
          nextWave();
        }
      } else waveT = 0;
    }
    // Bullets.
    for (const b of bullets) {
      b.x = wrapX(b.x + b.vx * dt);
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.y > GROUND) { b.life = 0; fx.emit({ x: b.x, y: GROUND, vy: -40, life: 0.3, size: 3, color: '#a07a50' }); }
      for (const p of planes) {
        if (!p.alive || p.team === b.team || b.life <= 0) continue;
        const r = p.k.big ? 22 : 15;
        if (Math.hypot(dxWrap(b.x, p.x), p.y - b.y) < r) {
          b.life = 0;
          p.lastHitBy = b.owner;
          hurt(p, 1, b.owner);
        }
      }
      for (const bl of blimps) {
        if (b.life <= 0 || b.team !== 0 || !bl.alive) continue;
        if (Math.abs(b.x - bl.x) < 78 && Math.abs(b.y - bl.y) < 26) { b.life = 0; hitBlimp(bl, 1, b.x, b.y); }
      }
    }
    bullets = bullets.filter(b => b.life > 0);
    // Rockets home in on the nearest enemy.
    for (const r of rockets) {
      let tgt = null, bd = 520;
      for (const p of planes) { if (!p.alive || p.team === r.team) continue; const d = Math.hypot(dxWrap(r.x, p.x), p.y - r.y); if (d < bd) { bd = d; tgt = p; } }
      for (const bl of blimps) { if (!bl.alive || r.team !== 0) continue; const d = Math.hypot(dxWrap(r.x, bl.x), bl.y - r.y); if (d < bd) { bd = d; tgt = bl; } }
      if (tgt) r.a += clamp(angDiff(Math.atan2(tgt.y - r.y, dxWrap(r.x, tgt.x)), r.a), -3.2 * dt, 3.2 * dt);
      r.s = Math.min(640, r.s + 500 * dt);
      r.x = wrapX(r.x + Math.cos(r.a) * r.s * dt);
      r.y += Math.sin(r.a) * r.s * dt;
      r.life -= dt;
      r.smoke -= dt;
      if (r.smoke <= 0) { r.smoke = 0.02; fx.emit({ x: r.x, y: r.y, vx: R(-10, 10), vy: R(-10, 10), life: 0.6, size: 3, grow: 8, color: 'rgba(220,220,230,0.55)' }); }
      if (r.y > GROUND) { r.life = 0; explode(r.x, GROUND - 4, 0.6, '#555'); }
      for (const p of planes) {
        if (r.life <= 0 || !p.alive || p.team === r.team) continue;
        if (Math.hypot(dxWrap(r.x, p.x), p.y - r.y) < 20) { r.life = 0; p.lastHitBy = r.owner; hurt(p, 4, r.owner); explode(r.x, r.y, 0.5, '#fff'); }
      }
      for (const bl of blimps) {
        if (r.life <= 0 || r.team !== 0 || !bl.alive) continue;
        if (Math.abs(r.x - bl.x) < 80 && Math.abs(r.y - bl.y) < 30) { r.life = 0; hitBlimp(bl, 6, r.x, r.y); explode(r.x, r.y, 0.5, '#fff'); }
      }
    }
    rockets = rockets.filter(r => r.life > 0);
    // Blimps drift across and lob flak at you.
    for (const bl of blimps) {
      bl.x += bl.dir * 34 * dt;
      bl.hitT = Math.max(0, bl.hitT - dt);
      bl.gunT -= dt;
      if (bl.gunT <= 0 && p1.alive) {
        bl.gunT = 1.6;
        const a = Math.atan2(p1.y - bl.y, dxWrap(bl.x, p1.x));
        for (const o of [-0.12, 0, 0.12]) bullets.push({ x: bl.x, y: bl.y + 20, vx: Math.cos(a + o) * 300, vy: Math.sin(a + o) * 300, life: 1.6, owner: null, team: 1 });
      }
      if ((bl.dir > 0 && bl.x > W + 160) || (bl.dir < 0 && bl.x < -160)) bl.alive = false;
    }
    blimps = blimps.filter(b => b.alive);
    // Pickups.
    for (const pk of pickups) {
      pk.t -= dt;
      pk.bob += dt * 3;
      pk.y = Math.min(GROUND - 30, pk.y + 12 * dt);
      for (const p of [p1, p2]) if (p?.alive && Math.hypot(dxWrap(p.x, pk.x), p.y - pk.y) < 28) { collect(p, pk); pk.t = 0; }
    }
    pickups = pickups.filter(p => p.t > 0);
    // Planes bumping into each other.
    for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
      const a = planes[i], b = planes[j];
      if (!a.alive || !b.alive || a.team === b.team || a.spawnT > 0 || b.spawnT > 0) continue;
      const dx = dxWrap(a.x, b.x), dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < 22 && (a.bumpT || 0) <= 0 && (b.bumpT || 0) <= 0) {
        // A mid-air bump: both take a knock and get shoved apart (once, not every frame).
        a.bumpT = b.bumpT = 0.8;
        const nx = d ? dx / d : 1, ny = d ? dy / d : 0;
        a.x = wrapX(a.x - nx * 14); a.y -= ny * 14; b.x = wrapX(b.x + nx * 14); b.y += ny * 14;
        hurt(a, 2, b); hurt(b, 2, a);
      }
    }
    fx.update(dt);
    floats.update(dt);
    shake.update(dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
  }

  function hitBlimp(bl, dmg, x, y) {
    bl.hp -= dmg;
    bl.hitT = 0.1;
    fx.burst(3, () => ({ x, y, vx: R(-60, 60), vy: R(-60, 60), life: 0.3, size: 2, color: '#ffd27a', shape: 'spark' }));
    if (bl.hp <= 0 && bl.alive) {
      bl.alive = false;
      explode(bl.x, bl.y, 2.2, '#d9467a');
      combo = comboT > 0 ? combo + 1 : 1;
      comboT = 3;
      addScore(600, bl.x, bl.y - 30, true);
      dropPickup(bl.x - 30, bl.y);
      dropPickup(bl.x + 30, bl.y);
      Arcade.flag('cloud-aces-blimp');
    }
  }

  // ---------- Drawing ----------

  // The scenery is drawn once into layers; clouds drift over it.
  const backdrop = Gfx.sprite(W, H, 0, 0, g => {
    const sky = g.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#3a7bd5');
    sky.addColorStop(0.6, '#8ec5ff');
    sky.addColorStop(1, '#ffe4b8');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // Sun.
    const sun = g.createRadialGradient(780, 110, 10, 780, 110, 120);
    sun.addColorStop(0, 'rgba(255,250,220,1)');
    sun.addColorStop(0.25, 'rgba(255,240,180,0.8)');
    sun.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = sun;
    g.fillRect(620, -40, 320, 320);
    // Far hills, then near hills.
    const r = Gfx.rng(7);
    for (const [base, amp, col] of [[GROUND - 70, 50, '#8fb3c9'], [GROUND - 30, 40, '#6fa86a'], [GROUND - 6, 22, '#5c9a4f']]) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) g.lineTo(x, base - Math.abs(Math.sin(x / 140 + base) * amp) - r() * 4);
      g.lineTo(W, H);
      g.fill();
    }
    // Fields.
    g.fillStyle = '#4f8a3f';
    g.fillRect(0, GROUND - 6, W, H - GROUND + 6);
    const fields = ['#79b24f', '#d8c25a', '#9fc75a', '#c89a4a'];
    for (let x = 0; x < W; x += 80 + Math.floor(r() * 50)) {
      g.fillStyle = fields[Math.floor(r() * fields.length)];
      g.beginPath();
      g.moveTo(x, GROUND + 4); g.lineTo(x + 70, GROUND + 4); g.lineTo(x + 90, H); g.lineTo(x - 20, H);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.08)';
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x + k * 18, GROUND + 6); g.lineTo(x + k * 22 - 10, H); g.stroke(); }
    }
    // A little farm and some trees along the horizon.
    for (let i = 0; i < 26; i++) {
      const x = r() * W, y = GROUND - 4;
      g.fillStyle = '#3d6e33';
      g.beginPath(); g.arc(x, y - 10, 8 + r() * 5, 0, TAU); g.fill();
      g.fillStyle = '#5a3d22'; g.fillRect(x - 1.5, y - 4, 3, 6);
    }
    for (const [x, c] of [[210, '#c0392b'], [640, '#e8e2d0'], [870, '#c0392b']]) {
      g.fillStyle = c; g.fillRect(x, GROUND - 26, 36, 24);
      g.fillStyle = '#5a3d22'; g.beginPath(); g.moveTo(x - 4, GROUND - 26); g.lineTo(x + 18, GROUND - 42); g.lineTo(x + 40, GROUND - 26); g.fill();
      g.fillStyle = '#ffe9a8'; g.fillRect(x + 6, GROUND - 18, 6, 6);
    }
    // Windmill.
    g.fillStyle = '#e8e2d0'; g.fillRect(470, GROUND - 60, 14, 58);
  });

  const clouds = [];
  { const r = Gfx.rng(11); for (let i = 0; i < 9; i++) clouds.push({ x: r() * W, y: 40 + r() * 300, s: 0.6 + r() * 0.9, v: 6 + r() * 14, front: i < 3 }); }
  function cloud(g, x, y, s, a) {
    g.globalAlpha = a;
    g.fillStyle = '#ffffff';
    for (const [dx, dy, rr] of [[0, 0, 26], [24, -10, 22], [48, 0, 24], [22, 8, 22], [-22, 6, 18], [70, 6, 16]]) {
      g.beginPath(); g.arc(x + dx * s, y + dy * s, rr * s, 0, TAU); g.fill();
    }
    g.fillStyle = 'rgba(180,200,225,0.5)';
    g.beginPath(); g.ellipse(x + 24 * s, y + 18 * s, 50 * s, 8 * s, 0, 0, TAU); g.fill();
    g.globalAlpha = 1;
  }

  function drawPlane(p) {
    const k = p.k, big = k.big ? 1.35 : 1;
    // Shadow on the ground, smaller the higher it is.
    const hgt = (GROUND - p.y) / GROUND;
    Gfx.shadow(ctx, p.x, GROUND + 2, 18 * big * (1 - hgt * 0.6), 4, 0.22 * (1 - hgt * 0.7));
    const blink = p.spawnT > 0 && Math.floor(p.spawnT * 10) % 2 === 0;
    if (blink) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.scale(big, p.roll * big);
    const body = p.hitT > 0 ? '#ffffff' : k.color, trim = k.trim, dark = Gfx.shade(k.color, -0.35);
    // Lower wing (behind).
    ctx.fillStyle = dark;
    Gfx.roundRect(ctx, -9, 3, 18, 5, 2); ctx.fill();
    // Fuselage.
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(18, -4); ctx.quadraticCurveTo(22, 0, 18, 5); ctx.lineTo(-14, 3); ctx.lineTo(-20, -1); ctx.lineTo(-14, -5); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-12, -4, 26, 2);
    // Tail.
    ctx.fillStyle = trim;
    ctx.beginPath(); ctx.moveTo(-14, -3); ctx.lineTo(-22, -12); ctx.lineTo(-18, -2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(-22, -1, 8, 3);
    // Pilot.
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath(); ctx.arc(0, -6, 3.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe0b0';
    ctx.fillRect(1, -7, 2.5, 2.5);
    // Upper wing with struts.
    ctx.strokeStyle = dark; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-6, -10); ctx.lineTo(-6, 4); ctx.moveTo(7, -10); ctx.lineTo(7, 4); ctx.stroke();
    ctx.fillStyle = body;
    Gfx.roundRect(ctx, -11, -13, 24, 4.5, 2); ctx.fill();
    ctx.fillStyle = trim;
    ctx.fillRect(9, -13, 3, 4.5);
    // Propeller blur.
    ctx.fillStyle = 'rgba(40,40,40,0.55)';
    const ph = Math.abs(Math.sin(p.prop)) * 11 + 2;
    ctx.beginPath(); ctx.ellipse(22, 0, 1.6, ph, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(21, 0, 2, 0, TAU); ctx.fill();
    ctx.restore();
    if (p.shieldT > 0) {
      ctx.strokeStyle = `rgba(126,240,255,${0.4 + Math.sin(time * 10) * 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 26 * big, 0, TAU); ctx.stroke();
    }
  }

  function drawBlimp(bl) {
    ctx.save();
    ctx.translate(bl.x, bl.y);
    ctx.scale(bl.dir, 1);
    const g = ctx.createLinearGradient(0, -28, 0, 28);
    g.addColorStop(0, bl.hitT > 0 ? '#fff' : '#ff8fb5');
    g.addColorStop(1, bl.hitT > 0 ? '#fdd' : '#b8305f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 80, 28, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a2348';
    ctx.beginPath(); ctx.moveTo(-70, -4); ctx.lineTo(-96, -24); ctx.lineTo(-86, 0); ctx.lineTo(-96, 24); ctx.lineTo(-70, 4); ctx.fill();
    ctx.fillStyle = '#4a3a4a'; Gfx.roundRect(ctx, -22, 24, 44, 12, 4); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; for (let i = -2; i <= 2; i++) ctx.fillRect(i * 8 - 2, 28, 4, 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    for (const yy of [-12, 0, 12]) { ctx.beginPath(); ctx.ellipse(0, yy * 0.4, 76, 26 - Math.abs(yy), 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    ctx.restore();
    Gfx.bar(ctx, bl.x - 40, bl.y - 42, 80, 5, bl.hp / bl.max, '#ff5c8a');
  }

  function draw(dt) {
    const off = shake.offset(8);
    ctx.save();
    ctx.translate(off.x, off.y);
    backdrop.draw(ctx, 0, 0);
    for (const c of clouds) {
      c.x += c.v * dt * (c.front ? 1.5 : 1);
      if (c.x > W + 120) c.x = -160;
      if (!c.front) cloud(ctx, c.x, c.y, c.s, 0.85);
    }
    // Windmill sails.
    ctx.save(); ctx.translate(477, GROUND - 60); ctx.rotate(time * 0.8);
    ctx.fillStyle = '#7a5a3a';
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillRect(-2, 0, 4, 28); }
    ctx.restore();
    for (const bl of blimps) drawBlimp(bl);
    for (const pk of pickups) {
      const y = pk.y + Math.sin(pk.bob) * 4;
      ctx.globalAlpha = pk.t < 2 ? (Math.floor(pk.t * 8) % 2 ? 0.4 : 1) : 1;
      // Parachute crate.
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pk.x - 10, y - 8); ctx.lineTo(pk.x - 14, y - 26); ctx.moveTo(pk.x + 10, y - 8); ctx.lineTo(pk.x + 14, y - 26); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(pk.x, y - 26, 16, Math.PI, 0); ctx.fill();
      ctx.fillStyle = pk.color; Gfx.roundRect(ctx, pk.x - 10, y - 9, 20, 18, 4); ctx.fill();
      Gfx.text(ctx, pk.id === 'twin' ? '2×' : pk.id === 'repair' ? '+' : pk.id === 'shield' ? '◆' : '➶', pk.x, y, { size: 12, color: '#111', stroke: null });
      ctx.globalAlpha = 1;
    }
    for (const p of planes) if (p.alive) drawPlane(p);
    // Bullets as short tracers.
    ctx.lineCap = 'round';
    for (const b of bullets) {
      ctx.strokeStyle = b.team === 0 ? '#fff6b0' : '#ffb0a0';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018); ctx.stroke();
    }
    for (const r of rockets) {
      ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.a);
      ctx.fillStyle = '#ddd'; ctx.fillRect(-7, -2, 14, 4);
      ctx.fillStyle = '#ff7a45'; ctx.beginPath(); ctx.arc(-8, 0, 3 + R(0, 2), 0, TAU); ctx.fill();
      ctx.restore();
    }
    fx.draw(ctx);
    for (const c of clouds) if (c.front) cloud(ctx, c.x, c.y, c.s * 1.3, 0.55);
    floats.draw(ctx);
    ctx.restore();
    drawHud();
  }

  function planeHud(p, x, align, label, color) {
    Gfx.card(ctx, align === 'left' ? x : x - 190, 10, 190, 50);
    const lx = align === 'left' ? x + 12 : x - 178;
    Gfx.text(ctx, label, lx, 24, { size: 12, align: 'left', color, stroke: null });
    Gfx.bar(ctx, lx, 34, 166, 8, Math.max(0, p.hp) / p.k.hp, p.hp > 2 ? '#3ccf8e' : '#ff4d6d');
    Gfx.bar(ctx, lx, 46, 166, 5, p.boost, '#7ef0ff');
    let tag = '';
    if (p.twinT > 0) tag += ` 2×${Math.ceil(p.twinT)}`;
    if (p.rockets) tag += ` ➶${p.rockets}`;
    if (p.shieldT > 0) tag += ' ◆';
    if (tag) Gfx.text(ctx, tag.trim(), lx + 166, 24, { size: 12, align: 'right', color: '#ffd23f', stroke: null });
  }

  function drawHud() {
    if (state === 'menu' || !p1) return;
    if (mode === 'squad') {
      planeHud(p1, 12, 'left', `${'✈'.repeat(Math.max(0, lives))}  Wave ${wave}`, '#fff');
      Gfx.text(ctx, score.toLocaleString(), W - 16, 30, { size: 24, align: 'right' });
      if (combo > 1) Gfx.text(ctx, `COMBO ×${Math.min(combo, 5)}`, W - 16, 54, { size: 13, align: 'right', color: '#ffd23f' });
    } else {
      const other = planes[1];
      planeHud(p1, 12, 'left', `${nameOf(0)} · ${wins[0]}`, KINDS.player.color);
      planeHud(other, W - 12, 'right', `${nameOf(1)} · ${wins[1]}`, other.k.color);
      Gfx.text(ctx, `${wins[0]} – ${wins[1]}`, W / 2, 30, { size: 26 });
    }
    if (p1.alive && p1.s < 118) Gfx.text(ctx, 'STALL! DIVE TO GAIN SPEED', W / 2, H - 30, { size: 14, color: '#ff8a80' });
    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 2);
      Gfx.text(ctx, banner.text, W / 2, H / 2 - 60, { size: 34, color: banner.color, width: 6 });
      if (banner.sub) Gfx.text(ctx, banner.sub, W / 2, H / 2 - 26, { size: 16, color: '#ffd23f' });
      ctx.globalAlpha = 1;
    }
  }

  function updateHud() {
    $('score').textContent = mode === 'squad' ? score.toLocaleString() : `${wins[0]}–${wins[1]}`;
    $('wave').textContent = mode === 'squad' ? wave : '-';
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  // ---------- Menu ----------

  function menuHtml() {
    return `<p>Biplane dogfights over the fields. <b>↑</b> pulls the nose up (hold it to loop), <b>↓</b> dives. Diving builds speed, climbing burns it, and too slow means a stall.</p>
      <ul style="text-align:left;font-size:14px">
        <li><b>Space</b> fires, <b>Shift</b> boosts, <b>X</b> fires rockets when you have them.</li>
        <li>The arena wraps around the sides. Don't hit the ground!</li>
      </ul>
      <div class="menu">
        <button class="btn secondary" type="button" data-mode="ace">Ace duel vs the computer</button>
        <div class="row">${LEVELS.map((l, i) => `<button class="btn ${i === prefs.level ? '' : 'secondary'}" type="button" data-level="${i}" title="${l.desc}">${l.name}</button>`).join('')}</div>
        <button class="btn secondary" type="button" data-mode="two">Two players, one keyboard</button>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 0">Two players: Blue uses <b>W/S</b>, <b>Space</b> to fire, <b>Left Shift</b> to boost. Red uses <b>↑/↓</b>, <b>Enter</b> to fire, <b>Right Shift</b> to boost. First to ${DUEL_TO}.</p>`;
  }
  function wireMenu(p) {
    p.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => start(b.dataset.mode)));
    p.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => {
      prefs.level = +b.dataset.level;
      Arcade.save('aces:prefs', prefs);
      p.querySelectorAll('[data-level]').forEach(x => x.classList.toggle('secondary', +x.dataset.level !== prefs.level));
    }));
  }
  const intro = () => ({ title: '✈️ Cloud Aces', html: menuHtml(), button: 'Fly Squadron', onAction: () => start('squad'), onRender: wireMenu });
  function showMenu() {
    state = 'menu';
    mode = 'squad';
    ui.show(intro());
    updateHud();
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'play' && (overlayEl.hidden || (typeof Versus !== 'undefined' && Versus.active()))) update(dt);
    else if (state === 'menu' || state === 'over') { fx.update(dt); floats.update(dt); shake.update(dt); time += dt; }
    draw(state === 'paused' ? 0 : dt);
    requestAnimationFrame(frame);
  }

  updateHud();
  Versus.attach({ ui, start: () => start('squad'), score: () => score, intro: intro() });
  requestAnimationFrame(frame);
})();
