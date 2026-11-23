/* Crown Clash: a platform fighter. Damage builds a percentage; the higher it is, the farther you fly.
   Knock rivals past the blast zone to take their stocks. Six fighters, five stages, an eight-fight ladder
   ending at the Crown Titan, local versus (2P), and an Endless gauntlet. */
(() => {
  const W = 960, H = 540, TAU = Math.PI * 2;
  const $ = id => document.getElementById(id);
  const GRAV = 1900, FALL = 760, BLAST = { l: -170, r: W + 170, t: -230, b: H + 190 };

  // ---------- Fighters ----------
  // weight: heavier = launched less. spd: run. jmp: jump. air: extra jumps. dm: damage multiplier. special: shot | dash | burst
  const FIGHTERS = [
    { id: 'bruno',  name: 'Bruno',  color: '#d9823b', trim: '#ffd9a0', weight: 1.45, spd: 205, jmp: 650, air: 1, dm: 1.2,  special: 'burst', sd: 12, desc: 'Heavy bruiser. Hard to launch, hits like a truck.' },
    { id: 'zip',    name: 'Zip',    color: '#5fd0ff', trim: '#d6f6ff', weight: 0.85, spd: 290, jmp: 690, air: 1, dm: 0.85, special: 'dash',  sd: 9,  desc: 'Light and fast. Lunges across the stage.' },
    { id: 'ember',  name: 'Ember',  color: '#ff5d4a', trim: '#ffc0a0', weight: 1.0,  spd: 235, jmp: 660, air: 1, dm: 1.0,  special: 'shot',  sd: 8,  desc: 'Throws fireballs. Keeps rivals at range.' },
    { id: 'moss',   name: 'Moss',   color: '#6fcf5a', trim: '#d4ffbe', weight: 1.2,  spd: 215, jmp: 640, air: 1, dm: 1.05, special: 'shot',  sd: 13, slow: true, desc: 'Slow leaf bombs that hit very hard.' },
    { id: 'volt',   name: 'Volt',   color: '#ffd23f', trim: '#fff2a8', weight: 0.95, spd: 255, jmp: 670, air: 1, dm: 0.95, special: 'burst', sd: 7,  small: true, desc: 'Quick crackling burst around itself.' },
    { id: 'nimbus', name: 'Nimbus', color: '#c9a0ff', trim: '#efe0ff', weight: 0.8,  spd: 225, jmp: 620, air: 3, dm: 0.9,  special: 'shot',  sd: 6,  desc: 'Floaty with four jumps. Great recovery.' },
  ];
  const BOSS = { id: 'titan', name: 'Crown Titan', color: '#6a3a9a', trim: '#e6b8ff', weight: 1.9, spd: 190, jmp: 640, air: 1, dm: 1.35, special: 'burst', sd: 16, big: true };
  const UNLOCKS = { 2: 'ember', 3: 'moss', 4: 'volt', 5: 'nimbus' };   // after beating ladder fight n+1? see ownedFighters

  // ---------- Stages ----------
  const STAGES = [
    { name: 'Crown Arena', bg: ['#16213f', '#2a3b7a'], plats: [{ x: 200, y: 400, w: 560, h: 140, solid: true }, { x: 320, y: 290, w: 120, soft: true }, { x: 520, y: 290, w: 120, soft: true }] },
    { name: 'Twin Towers', bg: ['#2a1426', '#6a2a4a'], plats: [{ x: 160, y: 410, w: 250, h: 130, solid: true }, { x: 550, y: 410, w: 250, h: 130, solid: true }, { x: 410, y: 320, w: 140, soft: true }, { x: 240, y: 270, w: 100, soft: true }, { x: 620, y: 270, w: 100, soft: true }] },
    { name: 'Floating Isles', bg: ['#0f2a2a', '#1f6a5a'], plats: [{ x: 330, y: 400, w: 300, h: 40, solid: true }, { x: 130, y: 320, w: 130, soft: true }, { x: 700, y: 320, w: 130, soft: true }, { x: 410, y: 270, w: 140, soft: true }, { x: 300, y: 190, w: 110, soft: true }, { x: 550, y: 190, w: 110, soft: true }] },
    { name: 'Clocktop', bg: ['#2a2410', '#6a5a1f'], plats: [{ x: 260, y: 410, w: 440, h: 130, solid: true }, { x: 300, y: 300, w: 110, soft: true, move: { dx: 90, sp: 0.9 } }, { x: 550, y: 300, w: 110, soft: true, move: { dx: 90, sp: 0.9, ph: Math.PI } }] },
    { name: 'Final Pad', bg: ['#10101a', '#3a1a5a'], plats: [{ x: 240, y: 380, w: 480, h: 160, solid: true }] },
  ];

  // ---------- Save ----------
  let save = { wins: 0, ladder: 0, ladderScore: 0, endless: 0, cleared: false, fighters: ['bruno', 'zip'], seen: false, ko: 0, ...Arcade.load('cc:save', {}) };
  const persist = () => Arcade.save('cc:save', save);
  const ownedFighters = () => FIGHTERS.filter(f => save.fighters.includes(f.id));
  const unlock = id => { if (!save.fighters.includes(id)) { save.fighters.push(id); persist(); return true; } return false; };
  const boardScore = () => save.ladderScore + save.endless * 400 + save.wins * 50;

  const canvas = $('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay($('overlay'));
  const overlayEl = $('overlay');
  const tone = o => Arcade.tone(o);

  // ---------- Match state ----------
  let M = null, state = 'menu', last = performance.now();
  let pick = { mode: null, p1: 'bruno', p2: 'zip' };
  let ladder = null;
  const keys = {};
  const edge = { p1: { jp: false, at: false, sp: false }, p2: { jp: false, at: false, sp: false } };

  function mkFighter(def, x, team, human, lvl, stocks, slot) {
    const sc = def.big ? 1.45 : def.small ? 0.9 : 1;
    return { def, team, human, lvl, slot, x, y: 0, vx: 0, vy: 0, w: 34 * sc, h: 56 * sc, sc, dmg: 0, stocks, face: team === 0 ? 1 : -1, ground: false, jumps: def.air, hold: 0,
      atk: null, stun: 0, inv: 2, shield: 100, shielding: false, dodge: 0, drop: 0, specCd: 0, upUsed: false, kos: 0, dead: 0, flash: 0, ai: { t: 0, in: {}, mem: 0 }, hitIds: new Set(), spawnX: x, fastFall: false, shake: 0 };
  }
  function startMatch(opts) {
    const st = STAGES[opts.stage % STAGES.length];
    const plats = st.plats.map(p => ({ ...p, bx: p.x, h: p.h || 12 }));
    M = { stage: st, plats, f: [], proj: [], fx: [], t: 0, over: false, endT: 0, shake: 0, mode: opts.mode, onEnd: opts.onEnd, freeze: 0, intro: 1.4, announce: opts.title || '' };
    const spawn = [W / 2 - 110, W / 2 + 110];
    opts.fighters.forEach((fd, i) => { const f = mkFighter(fd.def, spawn[i % 2], fd.team, fd.human, fd.lvl, fd.stocks, fd.slot); f.spawnX = spawn[i % 2]; f.y = 40; f.hold = 1.0; M.f.push(f); });
    state = 'play'; ui.hide(); updateHud();
  }
  const rect = f => ({ x: f.x - f.w / 2, y: f.y - f.h, w: f.w, h: f.h });
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------- Attacks ----------
  const MOVES = {
    f: { rx: 10, ry: -46, w: 50, h: 26, dmg: 7, kb: 280, sc: 5.2, ang: 38, st: 0.09, ac: 0.11, end: 0.22 },
    u: { rx: -24, ry: -100, w: 48, h: 52, dmg: 6, kb: 310, sc: 5.6, ang: 86, st: 0.08, ac: 0.12, end: 0.24 },
    d: { rx: 6, ry: -20, w: 60, h: 20, dmg: 5, kb: 230, sc: 4.2, ang: 22, st: 0.07, ac: 0.1, end: 0.2 },
    a: { rx: -8, ry: -52, w: 64, h: 40, dmg: 6, kb: 270, sc: 5, ang: 42, st: 0.07, ac: 0.14, end: 0.2 },
    ad: { rx: -10, ry: -4, w: 40, h: 36, dmg: 8, kb: 330, sc: 5.4, ang: -70, st: 0.14, ac: 0.12, end: 0.3 },
  };
  function startAttack(f, key, extra = {}) {
    const m = { ...MOVES[key], ...extra };
    f.atk = { ...m, t: 0, key, hit: new Set(), dir: f.face };
    f.hitIds = f.atk.hit;
  }
  function launch(att, vic, atk) {
    const kb = (atk.kb + vic.dmg * atk.sc) / vic.def.weight;
    const a = atk.ang * Math.PI / 180;
    vic.vx = Math.cos(a) * kb * atk.dir; vic.vy = -Math.sin(a) * kb;
    vic.stun = Math.min(0.75, kb * 0.00075 + 0.12);
    vic.ground = false; vic.atk = null; vic.flash = 0.12; vic.shielding = false;
    return kb;
  }
  function hurt(att, vic, atk, dmgMul = 1) {
    if (vic.inv > 0 || vic.dodge > 0 || vic.dead > 0) return false;
    const dmg = atk.dmg * (att.def.dm) * dmgMul;
    if (vic.shielding && vic.shield > 0 && Math.sign(vic.face) !== Math.sign(atk.dir)) {
      vic.shield -= dmg * 4.5; vic.flash = 0.05; tone({ freq: 700, dur: 0.05, type: 'square', vol: 0.02 });
      vic.x += atk.dir * 5;
      if (vic.shield <= 0) { vic.shield = 0; vic.stun = 1.2; vic.shielding = false; }
      return true;
    }
    vic.dmg += dmg;
    const kb = launch(att, vic, atk);
    M.freeze = Math.min(0.12, 0.03 + dmg * 0.006);
    M.shake = Math.max(M.shake, Math.min(0.5, kb / 2200));
    for (let i = 0; i < 8; i++) { const a = Math.random() * TAU; M.fx.push({ x: vic.x, y: vic.y - vic.h / 2, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, life: 0.4, max: 0.4, c: att.def.trim }); }
    tone({ freq: 160 + Math.min(300, kb / 4), to: 60, dur: 0.12, type: 'square', vol: 0.05 });
    return true;
  }

  function special(f, inp) {
    if (f.specCd > 0 || f.atk) return;
    const d = f.def;
    if (inp.u) {               // up special: recovery
      if (f.upUsed) return;
      f.upUsed = true; f.vy = -760 * (d.weight < 1 ? 1.05 : 1); f.vx = f.face * 80; f.ground = false;
      startAttack(f, 'u', { dmg: 5, kb: 340, ang: 80, ac: 0.3, st: 0, end: 0.35, up: true });
      f.specCd = 0.6; tone({ freq: 300, to: 800, dur: 0.2, type: 'triangle', vol: 0.05 });
      return;
    }
    f.specCd = d.special === 'shot' ? 0.55 : 0.8;
    if (d.special === 'shot') {
      startAttack(f, 'f', { dmg: 0, kb: 0, st: 0.1, ac: 0.01, end: 0.28, shoot: true });
    } else if (d.special === 'dash') {
      f.vx = f.face * 700; f.vy = f.ground ? -80 : Math.min(f.vy, 0); f.ground = false;
      startAttack(f, 'f', { dmg: d.sd, kb: 340, sc: 5.2, ang: 32, rx: 0, w: 60, h: 40, ry: -50, st: 0.02, ac: 0.22, end: 0.4 });
      tone({ freq: 500, to: 900, dur: 0.15, type: 'sawtooth', vol: 0.04 });
    } else {
      startAttack(f, 'f', { dmg: d.sd, kb: 380, sc: 6, ang: 55, rx: -d.sd * 4, ry: -f.h - 8, w: 80 + d.sd * 4, h: f.h + 24, st: 0.18, ac: 0.12, end: 0.45, radial: true });
      tone({ freq: 90, to: 40, dur: 0.3, type: 'sawtooth', vol: 0.06 });
    }
  }

  // ---------- Update ----------
  function humanInput(f) {
    const k = f.slot === 1 ? { l: 'ArrowLeft', r: 'ArrowRight', u: 'ArrowUp', d: 'ArrowDown', sh: 'Slash', e: edge.p2 } : { l: 'KeyA', r: 'KeyD', u: 'KeyW', d: 'KeyS', sh: 'KeyL', e: edge.p1 };
    const inp = { l: !!keys[k.l], r: !!keys[k.r], u: !!keys[k.u], d: !!keys[k.d], sh: !!keys[k.sh], jp: k.e.jp, at: k.e.at, sp: k.e.sp };
    k.e.jp = k.e.at = k.e.sp = false;
    return inp;
  }
  const onStage = f => M.plats.some(p => f.x > p.x - 20 && f.x < p.x + p.w + 20 && p.solid);
  function cpuInput(f) {
    const a = f.ai, inp = { l: false, r: false, u: false, d: false, sh: false, jp: false, at: false, sp: false };
    const foes = M.f.filter(o => o.team !== f.team && o.dead <= 0 && o.stocks > 0);
    const t = foes.sort((p, q) => Math.abs(p.x - f.x) - Math.abs(q.x - f.x))[0];
    const lv = f.lvl, think = Math.max(0.05, 0.24 - lv * 0.02);
    a.t -= 1 / 60;
    if (!t) return inp;
    const dx = t.x - f.x, dy = (t.y - t.h / 2) - (f.y - f.h / 2), ad = Math.abs(dx);
    const main = M.plats.find(p => p.solid);
    const cxm = main.x + main.w / 2;
    const offstage = f.x < main.x - 4 || f.x > main.x + main.w + 4 || f.y > main.y + 30;
    if (offstage || (f.y > H - 20)) {
      const toward = cxm - f.x; inp.l = toward < -10; inp.r = toward > 10;
      if (f.vy > -80 && f.y > main.y - 20) { if (f.jumps > 0 && Math.random() < 0.18) inp.jp = true; else if (f.jumps <= 0 && !f.upUsed && f.vy > 0 && Math.random() < 0.3) { inp.u = true; inp.sp = true; } }
      return inp;
    }
    if (a.t <= 0) {
      a.t = think + Math.random() * think;
      const mem = {};
      const range = f.def.special === 'shot' ? 340 : 70;
      if (ad > 62 + f.w * 0.3) { mem.move = Math.sign(dx); } else mem.move = (Math.random() < 0.15 ? -Math.sign(dx) : 0);
      if (ad < 74 && Math.abs(dy) < 70 && Math.random() < 0.35 + lv * 0.07) mem.atk = dy < -40 ? 'u' : (Math.random() < 0.2 ? 'd' : 'f');
      else if (ad > 140 && f.def.special === 'shot' && Math.abs(dy) < 90 && Math.random() < 0.3 + lv * 0.04) mem.atk = 'sp';
      else if (ad < 120 && f.def.special === 'burst' && Math.random() < 0.08 + lv * 0.02) mem.atk = 'sp';
      else if (f.def.special === 'dash' && ad > 120 && ad < 260 && Math.random() < 0.25) mem.atk = 'sp';
      if (dy < -70 && Math.random() < 0.35 + lv * 0.04) mem.jump = true;
      if (t.atk && ad < 100 && lv >= 3 && Math.random() < 0.12 + lv * 0.05) mem.shield = 0.35;
      a.mem = mem;
    }
    const m = a.mem || {};
    if (m.move < 0) inp.l = true; else if (m.move > 0) inp.r = true;
    if (m.jump) { inp.jp = true; m.jump = false; }
    if (m.shield) { inp.sh = true; m.shield -= 1 / 60; if (m.shield <= 0) m.shield = 0; }
    if (m.atk) { if (m.atk === 'sp') inp.sp = true; else { inp.at = true; if (m.atk === 'u') inp.u = true; if (m.atk === 'd') inp.d = true; } m.atk = null; }
    // keep facing the target when attacking
    if (inp.at || inp.sp) { f.face = dx >= 0 ? 1 : -1; }
    return inp;
  }

  function stepFighter(f, dt) {
    if (f.stocks <= 0) return;
    f.flash = Math.max(0, f.flash - dt); f.inv = Math.max(0, f.inv - dt); f.dodge = Math.max(0, f.dodge - dt); f.drop = Math.max(0, f.drop - dt); f.specCd = Math.max(0, f.specCd - dt);
    if (f.dead > 0) {
      f.dead -= dt;
      if (f.dead <= 0) { f.x = f.spawnX; f.y = -30; f.vx = f.vy = 0; f.dmg = 0; f.hold = 1.2; f.inv = 2.2; f.jumps = f.def.air; f.upUsed = false; f.shield = 100; f.atk = null; f.stun = 0; }
      return;
    }
    const inp = f.human ? humanInput(f) : cpuInput(f);
    if (f.hold > 0) {            // spawn hover
      f.hold -= dt; f.vy = 0; f.vx = 0; f.y += (110 - f.y) * Math.min(1, dt * 5);
      if (inp.l || inp.r || inp.at || inp.jp || inp.sp) f.hold = Math.min(f.hold, 0.05);
      if (f.hold > 0) return;
    }
    const d = f.def;
    // Stun.
    if (f.stun > 0) {
      f.stun -= dt; f.vx *= (1 - 0.6 * dt); f.shielding = false;
    } else {
      f.shielding = inp.sh && f.ground && !f.atk && f.shield > 0;
      if (f.shielding) {
        f.shield = Math.max(0, f.shield - 10 * dt);
        if (inp.l || inp.r) { if (f.dodge <= 0 && (inp.jp || false)) { } }
        f.vx *= 0.6;
        if (inp.jp && (inp.l || inp.r)) { f.dodge = 0.3; f.vx = (inp.r ? 1 : -1) * 420; f.shielding = false; f.shield -= 6; }
      } else {
        f.shield = Math.min(100, f.shield + 14 * dt);
        const move = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
        if (!f.atk || f.atk.up) {
          if (move) { f.face = move; const acc = f.ground ? 2400 : 1500; f.vx += move * acc * dt; const cap = d.spd * (f.atk ? 0.5 : 1); if (Math.abs(f.vx) > cap && Math.sign(f.vx) === move) f.vx = move * Math.max(cap, Math.abs(f.vx) - 2000 * dt); }
          else f.vx *= f.ground ? Math.pow(0.0005, dt) : Math.pow(0.35, dt);
        } else f.vx *= f.ground ? Math.pow(0.003, dt) : Math.pow(0.5, dt);
        // Jump.
        if (inp.jp && !f.atk) {
          if (inp.d && !f.shielding && f.ground && M.plats.some(p => p.soft && Math.abs(f.y - p.y) < 3 && f.x > p.x && f.x < p.x + p.w)) { f.drop = 0.25; f.y += 4; f.ground = false; }
          else if (f.ground) { f.vy = -d.jmp; f.ground = false; tone({ freq: 350, to: 600, dur: 0.08, type: 'square', vol: 0.02 }); }
          else if (f.jumps > 0) { f.jumps--; f.vy = -d.jmp * 0.95; f.vx *= 0.5; tone({ freq: 450, to: 750, dur: 0.08, type: 'square', vol: 0.02 }); for (let i = 0; i < 6; i++) M.fx.push({ x: f.x, y: f.y, vx: (Math.random() - 0.5) * 120, vy: 60 + Math.random() * 60, life: 0.3, max: 0.3, c: '#fff' }); }
        }
        // Attacks.
        if (inp.at && !f.atk) {
          if (!f.ground) startAttack(f, inp.d ? 'ad' : inp.u ? 'u' : 'a');
          else startAttack(f, inp.u ? 'u' : inp.d ? 'd' : 'f');
          tone({ freq: 200, to: 120, dur: 0.06, type: 'sawtooth', vol: 0.025 });
        }
        if (inp.sp) special(f, inp);
        if (inp.d && !f.ground && f.vy > 0 && f.vy < FALL) { f.fastFall = true; }
      }
    }
    // Active attack.
    if (f.atk) {
      const a = f.atk; a.t += dt;
      const on = a.t >= a.st && a.t <= a.st + a.ac;
      if (a.shoot && a.t >= a.st && !a.fired) {
        a.fired = true;
        const slow = d.slow;
        M.proj.push({ x: f.x + f.face * 26, y: f.y - f.h * 0.6, vx: f.face * (slow ? 330 : 520), vy: 0, r: slow ? 14 : 10, owner: f, dmg: d.sd, kb: slow ? 360 : 230, sc: slow ? 6.4 : 4.4, ang: 30, life: 1.5, dir: f.face, c: d.color });
        tone({ freq: 400, to: 250, dur: 0.12, type: 'triangle', vol: 0.04 });
      }
      if (on && !a.shoot) {
        const box = { x: f.x + (a.dir > 0 ? a.rx : -a.rx - a.w), y: f.y + a.ry, w: a.w, h: a.h };
        if (a.radial) { box.x = f.x - a.w / 2; }
        a.box = box;
        for (const o of M.f) if (o.team !== f.team && o.stocks > 0 && o.dead <= 0 && !a.hit.has(o) && overlap(box, rect(o))) { a.hit.add(o); hurt(f, o, { ...a, dir: a.radial ? Math.sign(o.x - f.x) || a.dir : a.dir }); }
      } else a.box = null;
      if (a.t >= a.end) f.atk = null;
    }
    // Gravity and motion.
    const prevY = f.y;
    f.vy = Math.min(f.fastFall ? 980 : FALL, f.vy + GRAV * dt);
    if (f.vy < 0) f.fastFall = false;
    const prevX = f.x;
    f.x += f.vx * dt; f.y += f.vy * dt;
    // Platforms.
    f.ground = false;
    for (const p of M.plats) {
      const px = p.x, pw = p.w, top = p.y;
      // Moving platform: carry riders.
      if (p.solid) {
        if (f.y > top + 10 && f.y - f.h < top + p.h && f.x + f.w / 2 > px && f.x - f.w / 2 < px + pw) {
          // inside the block: push out sideways if below the top
          if (f.y > top + 14) { const toL = f.x + f.w / 2 - px, toR = px + pw - (f.x - f.w / 2); if (toL < toR) f.x = px - f.w / 2; else f.x = px + pw + f.w / 2; f.vx = 0; }
        }
      }
      if (f.vy >= 0 && prevY <= top + 6 && f.y >= top && f.x + f.w / 2 > px + 4 && f.x - f.w / 2 < px + pw - 4 && !(p.soft && f.drop > 0)) {
        f.y = top; f.vy = 0; f.ground = true;
        if (p.move && p.dx) f.x += p.dx;
      }
    }
    if (f.ground) { f.jumps = d.air; f.upUsed = false; f.fastFall = false; }
    // Blast zones.
    if (f.x < BLAST.l || f.x > BLAST.r || f.y > BLAST.b || f.y < BLAST.t) koFighter(f);
    if (f.stun <= 0 && f.ground && f.atk === null) { /* idle */ }
  }
  function koFighter(f) {
    f.stocks--; f.kos++; f.dead = 1.0; f.atk = null; f.stun = 0;
    M.shake = 0.7; M.freeze = 0.15;
    for (let i = 0; i < 22; i++) { const a = Math.random() * TAU; M.fx.push({ x: Math.max(30, Math.min(W - 30, f.x)), y: Math.max(30, Math.min(H - 30, f.y)), vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, life: 0.7, max: 0.7, c: f.def.color }); }
    tone({ freq: 300, to: 40, dur: 0.5, type: 'sawtooth', vol: 0.08 });
    if (!f.human) { const killer = M.f.find(o => o.human && o.team !== f.team); if (killer) killer.kosMade = (killer.kosMade || 0) + 1; save.ko++; if (save.ko >= 25) Arcade.flag('crown-clash-ko-25'); }
    updateHud();
  }

  function update(dt) {
    if (M.freeze > 0) { M.freeze -= dt; return; }
    M.t += dt; M.shake = Math.max(0, M.shake - dt * 1.6);
    if (M.intro > 0) { M.intro -= dt; if (M.intro > 0) { for (const f of M.f) f.vx = f.vy = 0; return; } }
    for (const p of M.plats) if (p.move) { const nx = p.bx + Math.sin(M.t * p.move.sp + (p.move.ph || 0)) * p.move.dx; p.dx = nx - p.x; p.x = nx; }
    for (const f of M.f) stepFighter(f, dt);
    // Projectiles.
    for (const p of M.proj) {
      p.x += p.vx * dt; p.life -= dt;
      for (const o of M.f) if (o.team !== p.owner.team && o.stocks > 0 && o.dead <= 0 && overlap({ x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 }, rect(o))) { hurt(p.owner, o, { dmg: p.dmg, kb: p.kb, sc: p.sc, ang: p.ang, dir: p.dir }); p.life = 0; break; }
    }
    M.proj = M.proj.filter(p => p.life > 0 && p.x > -50 && p.x < W + 50);
    for (const e of M.fx) { e.life -= dt; e.x += e.vx * dt; e.y += e.vy * dt; e.vy += 500 * dt; }
    M.fx = M.fx.filter(e => e.life > 0);
    // End condition.
    if (!M.over) {
      const alive = new Set(M.f.filter(f => f.stocks > 0).map(f => f.team));
      if (alive.size <= 1) { M.over = true; M.winner = [...alive][0]; M.endT = 1.8; tone({ freq: 440, to: 880, dur: 0.5, type: 'triangle', vol: 0.06 }); }
    } else {
      M.endT -= dt;
      if (M.endT <= 0 && state === 'play') { state = 'over'; M.onEnd(M); }
    }
    updateHud();
  }
  function updateHud() {
    if (!M) { $('s-p1').textContent = '–'; $('s-p2').textContent = '–'; return; }
    const a = M.f[0], b = M.f[1];
    $('s-p1').textContent = `${Math.floor(a.dmg)}% ·${'●'.repeat(Math.max(0, a.stocks))}`;
    $('s-p2').textContent = b ? `${Math.floor(b.dmg)}% ·${'●'.repeat(Math.max(0, b.stocks))}` : '–';
  }

  // ---------- Drawing ----------
  function drawFighter(f) {
    if (f.stocks <= 0 || f.dead > 0) return;
    const d = f.def, s = f.sc;
    if (f.inv > 0 && Math.floor(M.t * 14) % 2) ctx.globalAlpha = 0.45;
    ctx.save(); ctx.translate(f.x, f.y);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 2, 20 * s, 5, 0, 0, TAU); ctx.fill();
    ctx.scale(f.face, 1);
    const squash = f.ground ? 1 : 1 + Math.min(0.12, Math.abs(f.vy) / 5000);
    const walk = f.ground && Math.abs(f.vx) > 30 ? Math.sin(M.t * 18) * 4 : 0;
    // Legs.
    ctx.fillStyle = '#1a1a2a'; ctx.fillRect(-9 * s, -14 * s + walk * 0.3, 8 * s, 14 * s); ctx.fillRect(2 * s, -14 * s - walk * 0.3, 8 * s, 14 * s);
    // Body.
    ctx.fillStyle = f.flash > 0 ? '#fff' : d.color; ctx.beginPath(); ctx.roundRect(-16 * s, -f.h + 6, 32 * s, f.h - 16 * s, 10 * s); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = d.trim; ctx.fillRect(-16 * s, -f.h * 0.48, 32 * s, 6 * s);
    // Head details.
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5 * s, -f.h * 0.72, 5 * s, 0, TAU); ctx.arc(-3 * s, -f.h * 0.72, 5 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(7 * s, -f.h * 0.72, 2.4 * s, 0, TAU); ctx.arc(-1 * s, -f.h * 0.72, 2.4 * s, 0, TAU); ctx.fill();
    if (d.big) { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(-16 * s, -f.h + 8); for (let i = 0; i < 5; i++) { ctx.lineTo(-16 * s + i * 8 * s + 4 * s, -f.h - 8); ctx.lineTo(-16 * s + (i + 1) * 8 * s, -f.h + 8); } ctx.fill(); }
    // Arm swing.
    if (f.atk && f.atk.t >= f.atk.st && f.atk.t <= f.atk.st + f.atk.ac && !f.atk.shoot) { ctx.fillStyle = d.trim; ctx.globalAlpha = 0.9 * (ctx.globalAlpha || 1); ctx.beginPath(); ctx.arc(24 * s, -f.h * 0.5, 12 * s, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (f.shielding) { ctx.fillStyle = `rgba(120,200,255,${0.2 + f.shield / 300})`; ctx.strokeStyle = '#9fe0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(f.x, f.y - f.h / 2, f.w * 0.9, f.h * 0.65, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
    // Tag.
    ctx.fillStyle = f.human ? '#fff' : '#ffb3b3'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(f.human ? `P${f.slot + 1}` : 'CPU', f.x, f.y - f.h - 10);
  }
  function drawOffscreen(f) {
    if (f.stocks <= 0 || f.dead > 0) return;
    if (f.x > -10 && f.x < W + 10 && f.y > -10 && f.y < H + 10) return;
    const x = Math.max(16, Math.min(W - 16, f.x)), y = Math.max(16, Math.min(H - 16, f.y));
    ctx.fillStyle = f.def.color; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!M) { ctx.fillStyle = '#0b0e18'; ctx.fillRect(0, 0, W, H); return; }
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, M.stage.bg[0]); g.addColorStop(1, M.stage.bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.05)'; for (let i = 0; i < 6; i++) ctx.fillRect(i * 170 + 40, 0, 60, H);
    ctx.save();
    if (M.shake > 0) ctx.translate((Math.random() - 0.5) * M.shake * 20, (Math.random() - 0.5) * M.shake * 20);
    for (const p of M.plats) {
      if (p.solid) { ctx.fillStyle = '#2b3350'; ctx.fillRect(p.x, p.y, p.w, p.h); ctx.fillStyle = '#7f95d8'; ctx.fillRect(p.x, p.y, p.w, 8); ctx.fillStyle = 'rgba(255,255,255,.06)'; for (let x = p.x + 30; x < p.x + p.w; x += 60) ctx.fillRect(x, p.y + 14, 2, p.h - 14); }
      else { ctx.fillStyle = '#a5b4e8'; ctx.fillRect(p.x, p.y, p.w, 8); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(p.x + 6, p.y + 8, p.w - 12, 4); }
    }
    for (const f of M.f) drawFighter(f);
    for (const f of M.f) if (f.atk && f.atk.box && f.atk.radial) { ctx.strokeStyle = f.def.trim; ctx.globalAlpha = 0.55; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(f.x, f.y - f.h / 2, f.atk.w / 2, f.atk.h / 2, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
    for (const p of M.proj) { ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; }
    for (const e of M.fx) { ctx.globalAlpha = Math.max(0, e.life / e.max); ctx.fillStyle = e.c; ctx.fillRect(e.x - 3, e.y - 3, 6, 6); ctx.globalAlpha = 1; }
    ctx.restore();
    M.f.forEach(drawOffscreen);
    // HUD damage cards.
    const n = M.f.length;
    M.f.forEach((f, i) => {
      const x = n === 2 ? 130 + i * 700 : 130 + i * 230, y = H - 56;
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.roundRect(x - 110, y - 8, 220, 56, 10); ctx.fill();
      ctx.fillStyle = f.def.color; ctx.fillRect(x - 100, y, 6, 40);
      const pct = Math.floor(f.dmg); ctx.font = 'bold 30px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = pct > 150 ? '#ff5d5d' : pct > 80 ? '#ffb347' : '#fff'; ctx.fillText(pct + '%', x - 86, y + 30);
      ctx.font = 'bold 12px system-ui'; ctx.fillStyle = '#cfd6ee'; ctx.textAlign = 'right'; ctx.fillText(f.def.name, x + 100, y + 14);
      for (let s = 0; s < 3; s++) { ctx.fillStyle = s < f.stocks ? f.def.color : 'rgba(255,255,255,.15)'; ctx.beginPath(); ctx.arc(x + 100 - s * 18, y + 34, 6, 0, TAU); ctx.fill(); }
    });
    if (M.intro > 0) { ctx.font = 'bold 40px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; const txt = M.intro > 0.5 ? (M.announce || 'Ready?') : 'FIGHT!'; ctx.strokeText(txt, W / 2, 200); ctx.fillText(txt, W / 2, 200); }
    if (M.over) { ctx.font = 'bold 54px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 7; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffd23f'; ctx.strokeText('GAME!', W / 2, 220); ctx.fillText('GAME!', W / 2, 220); }
    if (state === 'paused') { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- Input ----------
  const blockKeys = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash']);
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'play' || state === 'paused') pauseToggle(); return; }
    if (state === 'play' && blockKeys.has(e.code)) e.preventDefault();
    if (e.repeat) { keys[e.code] = true; return; }
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'KeyW') edge.p1.jp = true;
    if (e.code === 'KeyJ') edge.p1.at = true;
    if (e.code === 'KeyK') edge.p1.sp = true;
    if (e.code === 'ArrowUp') edge.p2.jp = true;
    if (e.code === 'Comma') edge.p2.at = true;
    if (e.code === 'Period') edge.p2.sp = true;
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  function pauseToggle() {
    if (state === 'play') { state = 'paused'; ui.show({ title: 'Paused', html: '<div class="cc-row"><button class="btn secondary" data-act="menu" type="button">Quit match</button></div>', button: 'Resume', onAction: pauseToggle }); }
    else if (state === 'paused') { ui.hide(); state = 'play'; last = performance.now(); }
  }
  Arcade.onBlur(() => { if (state === 'play') pauseToggle(); for (const k in keys) keys[k] = false; });

  // ---------- Modes ----------
  const rndFighter = (excl) => { const pool = FIGHTERS.filter(f => f.id !== excl); return pool[Math.floor(Math.random() * pool.length)]; };
  const fd = id => FIGHTERS.find(f => f.id === id);
  const LADDER_LEN = 8;
  function startLadder(id) {
    ladder = { fight: 0, score: 0, me: fd(id), ko: 0 };
    nextLadder();
  }
  function nextLadder() {
    const n = ladder.fight, boss = n === LADDER_LEN - 1;
    const foe = boss ? BOSS : rndFighter(ladder.me.id);
    const lvl = Math.min(9, 1 + n);
    startMatch({
      mode: 'ladder', stage: boss ? 4 : n, title: boss ? 'The Crown Titan' : `Fight ${n + 1} of ${LADDER_LEN}`,
      fighters: [{ def: ladder.me, team: 0, human: true, lvl: 0, stocks: 3, slot: 0 }, { def: foe, team: 1, human: false, lvl, stocks: boss ? 4 : n < 2 ? 2 : 3, slot: 1 }],
      onEnd: m => {
        const me = m.f[0], won = m.winner === 0;
        const pts = won ? 800 + me.stocks * 300 + Math.max(0, 600 - Math.floor(m.t) * 5) + me.kos * 0 + ladder.fight * 150 : 0;
        if (won) { ladder.score += pts; save.wins++; Arcade.flag('crown-clash-win'); }
        ladderResult(won, pts, m);
      },
    });
  }
  function ladderResult(won, pts, m) {
    const fight = ladder.fight;
    if (won) {
      const newF = fight === 2 || fight === 4 || fight === 5 || fight === 6 ? ['ember', 'moss', 'volt', 'nimbus'].find(id => !save.fighters.includes(id)) : null;
      let unlocked = null;
      if (newF) { unlock(newF); unlocked = fd(newF); Arcade.flag('crown-clash-unlock'); }
      if (fight + 1 >= LADDER_LEN) {
        save.cleared = true; save.ladder = LADDER_LEN;
        if (ladder.score > save.ladderScore) save.ladderScore = ladder.score;
        persist();
        Arcade.flag('crown-clash-titan'); if (ladder.me && m.f[0].stocks === 3) Arcade.flag('crown-clash-flawless');
        Arcade.finish(ui, { score: boardScore(), title: 'Crown claimed', html: `<p>You beat the Crown Titan. Ladder score ${ladder.score.toLocaleString()}.</p><div class="cc-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>`, button: 'Play again', onAction: () => startLadder(ladder.me.id) });
        return;
      }
      if (fight + 1 > save.ladder) save.ladder = fight + 1;
      if (ladder.score > save.ladderScore) save.ladderScore = ladder.score;
      persist();
      Arcade.finish(ui, { score: boardScore(), title: `Fight ${fight + 1} won`, html: `<p>+${pts.toLocaleString()} points · ${m.f[0].stocks} stocks left</p>${unlocked ? `<p class="new-best">New fighter: ${unlocked.name}!</p>` : ''}`, button: 'Next fight', onAction: () => { ladder.fight++; nextLadder(); } });
    } else {
      persist();
      Arcade.finish(ui, { score: boardScore(), title: 'Knocked out', html: `<p>You fell in fight ${fight + 1}. Ladder score ${ladder.score.toLocaleString()}.</p><div class="cc-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>`, button: 'Rematch', onAction: () => nextLadder() });
    }
  }
  function startVersus() {
    const stage = Math.floor(Math.random() * STAGES.length);
    startMatch({
      mode: 'versus', stage, title: `${fd(pick.p1).name} vs ${fd(pick.p2).name}`,
      fighters: [{ def: fd(pick.p1), team: 0, human: true, lvl: 0, stocks: 3, slot: 0 }, { def: fd(pick.p2), team: 1, human: pick.vsHuman, lvl: pick.vsHuman ? 0 : 5, stocks: 3, slot: 1 }],
      onEnd: m => {
        const w = m.winner === 0 ? (m.f[0].def.name) : (m.f[1].def.name);
        Arcade.finish(ui, { score: boardScore(), title: `${w} wins`, html: `<div class="cc-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>`, button: 'Rematch', onAction: startVersus });
      },
    });
  }
  let endless = null;
  function startEndless(id) { endless = { wins: 0, stocks: 3, me: fd(id), dmg: 0 }; endlessFight(); }
  function endlessFight() {
    const n = endless.wins, lvl = Math.min(9, 2 + Math.floor(n / 2)), boss = (n + 1) % 8 === 0;
    const foe = boss ? BOSS : rndFighter(endless.me.id);
    startMatch({
      mode: 'endless', stage: n, title: boss ? 'Crown Titan' : `Wave ${n + 1}`,
      fighters: [{ def: endless.me, team: 0, human: true, lvl: 0, stocks: endless.stocks, slot: 0 }, { def: foe, team: 1, human: false, lvl, stocks: 1, slot: 1 }],
      onEnd: m => {
        const me = m.f[0];
        if (m.winner === 0) {
          endless.wins++; endless.stocks = me.stocks; save.wins++;
          if (endless.wins > save.endless) save.endless = endless.wins;
          if (endless.wins >= 10) Arcade.flag('crown-clash-endless-10');
          if (endless.stocks < 3 && endless.wins % 3 === 0) endless.stocks++;
          persist();
          Arcade.finish(ui, { score: boardScore(), title: `Wave ${endless.wins} cleared`, html: `<p>${endless.stocks} stocks · best ${save.endless}</p><div class="cc-row"><button class="btn secondary" data-act="menu" type="button">Cash out</button></div>`, button: 'Next wave', onAction: endlessFight });
        } else {
          persist();
          Arcade.finish(ui, { score: boardScore(), title: 'Gauntlet over', html: `<p>You cleared ${endless.wins} waves. Best ${save.endless}.</p><div class="cc-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>`, button: 'Try again', onAction: () => startEndless(endless.me.id) });
        }
      },
    });
  }

  // ---------- Menus ----------
  function showMenu() {
    state = 'menu'; M = null; updateHud();
    ui.show({
      title: 'Pixel Pioneers Arcade',
      html: `<h2 class="cc-title">CROWN CLASH</h2><p class="cc-note">Knock them off the stage. Higher % means farther flight.</p>
        <div class="cc-menu">
          <button class="btn" data-act="mode" data-m="ladder" type="button">Crown Ladder${save.cleared ? ' ✔' : ' · ' + save.ladder + '/8'}</button>
          <button class="btn secondary" data-act="mode" data-m="endless" type="button">Endless Gauntlet${save.endless ? ' · best ' + save.endless : ''}</button>
          <button class="btn secondary" data-act="mode" data-m="versus" type="button">Versus (CPU or 2P)</button>
          <button class="btn secondary" data-act="howto" type="button">How to play</button>
        </div>`,
      button: null,
    });
  }
  function showHowTo() {
    ui.show({
      title: 'How to play',
      html: `<div class="cc-keys"><div><b>Player 1</b><br>Move <kbd>A</kbd><kbd>D</kbd> · Jump <kbd>Space</kbd>/<kbd>W</kbd><br>Attack <kbd>J</kbd> (hold <kbd>W</kbd> or <kbd>S</kbd> to aim) · Special <kbd>K</kbd> · Shield <kbd>L</kbd><br>Up + Special = recovery · Shield + Jump + direction = dodge</div>
        <div><b>Player 2</b><br>Move <kbd>←</kbd><kbd>→</kbd> · Jump <kbd>↑</kbd><br>Attack <kbd>,</kbd> · Special <kbd>.</kbd> · Shield <kbd>/</kbd></div></div>
        <ul style="text-align:left"><li>Every hit adds to the victim's <b>%</b>. The higher it climbs, the farther they fly. Knock them past the edge to take a stock.</li>
        <li>Jump again in mid-air. Press <kbd>S</kbd>+Jump on a thin platform to drop through.</li>
        <li>Win the ladder to unlock all six fighters. Beat the Crown Titan at the end.</li></ul>
        <div class="cc-row"><button class="btn" data-act="menu" type="button">Got it</button></div>`, button: null,
    });
  }
  function showSelect(mode) {
    pick.mode = mode;
    const own = ownedFighters();
    const cards = FIGHTERS.map(f => { const has = save.fighters.includes(f.id); return `<button class="cc-card ${has ? '' : 'off'} ${pick.p1 === f.id ? 'on' : ''}" data-act="fighter" data-id="${f.id}" type="button" ${has ? '' : 'disabled'}><i style="background:${f.color}"></i><b>${has ? f.name : '???'}</b><small>${has ? f.desc : 'Win ladder fights to unlock.'}</small></button>`; }).join('');
    let opp = '';
    if (mode === 'versus') {
      opp = `<h3>Opponent</h3><div class="cc-cards">${FIGHTERS.map(f => `<button class="cc-card ${pick.p2 === f.id ? 'on' : ''}" data-act="foe" data-id="${f.id}" type="button" ${save.fighters.includes(f.id) ? '' : 'disabled'}><i style="background:${f.color}"></i><b>${f.name}</b></button>`).join('')}</div>
        <div class="cc-row"><button class="btn secondary" data-act="vs" data-h="0" type="button">${pick.vsHuman ? '' : '✔ '}vs CPU</button><button class="btn secondary" data-act="vs" data-h="1" type="button">${pick.vsHuman ? '✔ ' : ''}vs Player 2</button></div>`;
    }
    ui.show({ title: mode === 'ladder' ? 'Crown Ladder' : mode === 'endless' ? 'Endless Gauntlet' : 'Versus', html: `<div class="cc-top"><button class="btn secondary" data-act="menu" type="button">← Menu</button><span>Choose your fighter</span></div><div class="cc-cards">${cards}</div>${opp}<div class="cc-row"><button class="btn" data-act="go" type="button">Fight!</button></div>`, button: null });
  }
  overlayEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'menu': showMenu(); break;
      case 'howto': showHowTo(); break;
      case 'mode': showSelect(d.m); break;
      case 'fighter': pick.p1 = d.id; showSelect(pick.mode); break;
      case 'foe': pick.p2 = d.id; showSelect(pick.mode); break;
      case 'vs': pick.vsHuman = d.h === '1'; showSelect(pick.mode); break;
      case 'go': if (pick.mode === 'ladder') startLadder(pick.p1); else if (pick.mode === 'endless') startEndless(pick.p1); else startVersus(); break;
    }
  });

  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (M && state === 'play') update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  showMenu();
  if (!save.seen) { save.seen = true; persist(); showHowTo(); }
  requestAnimationFrame(frame);
  // Test hook: run a CPU-vs-CPU match headlessly.
  window.__cc = {
    sim(a, b, la, lb, secs = 240) {
      startMatch({ mode: 'test', stage: 0, fighters: [{ def: fd(a), team: 0, human: false, lvl: la, stocks: 3, slot: 0 }, { def: fd(b), team: 1, human: false, lvl: lb, stocks: 3, slot: 1 }], onEnd: () => {} });
      M.intro = 0;
      let t = 0;
      while (t < secs && !M.over) { update(1 / 60); t += 1 / 60; M.freeze = 0; }
      const r = { t: Math.round(t), over: M.over, winner: M.winner, stocks: M.f.map(f => f.stocks), dmg: M.f.map(f => Math.round(f.dmg)) };
      state = 'menu'; M = null; showMenu();
      return r;
    },
  };
})();
