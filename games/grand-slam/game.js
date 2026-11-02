/* Grand Slam: arcade baseball. You're the home team. On defence you pick a pitch and aim it;
   at bat you steer a contact cursor over the zone and time your swing. Balls in play are
   handed to field.js, which works out the result and animates it on the diamond. */
(() => {
  const W = 960, H = 540;
  const HZ = 300, F = 520, CAM_Z = 10, CAM_H = 4.2;      // behind-the-plate camera
  const MOUND = 55;                                      // release distance, feet
  const ZONE_W = 0.83, ZONE_MID = 2.55, ZONE_H = 0.95;   // half-width, centre height, half-height (ft)
  const CURSOR = 0.34;                                   // contact cursor radius in zone units
  const WINDOW = 0.12;                                   // seconds either side of perfect timing
  // Test hook: #autopilot lets the bot bat for you too and posts no score.
  const AUTOPILOT = location.hash === '#autopilot';
  const PITCHES = [
    { id: 'fast', name: 'Fastball', key: '1', mph: 94, brk: [0, -0.3], err: 0.12 },
    { id: 'curve', name: 'Curveball', key: '2', mph: 78, brk: [0.9, -1.6], err: 0.2 },
    { id: 'slider', name: 'Slider', key: '3', mph: 85, brk: [-1.3, -0.6], err: 0.18 },
    { id: 'change', name: 'Changeup', key: '4', mph: 80, brk: [0.3, -0.9], err: 0.14 },
  ];
  const LEVELS = [
    { name: 'Rookie', slow: 1.9, eye: 0.62, contact: 0.85, chase: 0.32, power: 0.85, mult: 1 },
    { name: 'Pro', slow: 1.6, eye: 0.74, contact: 1, chase: 0.24, power: 1, mult: 1.6 },
    { name: 'All-Star', slow: 1.38, eye: 0.84, contact: 1.12, chase: 0.16, power: 1.1, mult: 2.3 },
  ];
  const ME = { name: 'Pioneers', short: 'PIO', shirt: '#ffc53d', cap: '#1c1500' };
  const RIVALS = [
    { name: 'Bay Pelicans', short: 'BAY', shirt: '#4f8cff', cap: '#10244a' },
    { name: 'Canyon Coyotes', short: 'CAN', shirt: '#ff8a3d', cap: '#3a1a08' },
    { name: 'River Otters', short: 'RIV', shirt: '#2ec4b6', cap: '#0d3b37' },
    { name: 'Iron Rams', short: 'IRN', shirt: '#9aa3b5', cap: '#1b1e24' },
    { name: 'Comet Kings', short: 'COM', shirt: '#a46bff', cap: '#2a1050' },
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const fieldLayer = Arcade.makeLayer(W, H);
  const parkLayer = Arcade.makeLayer(W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const fx = Sports.particles();
  const crowd = Sports.makeCrowd(W, 118, { seed: 21, size: 6, colors: ['#ffc53d', '#ffc53d', '#4f8cff', '#e6e9ef', '#ff5d5d', '#2b3247'] });

  let state = 'menu';   // menu | aim | pitch | play | result | over | paused
  let level = Arcade.load('slam:level', 1), LV = LEVELS[level];
  let innings = 3;
  let g = null, rival = RIVALS[0];
  let excite = 0;

  // ---------- Game state ----------

  function newGame() {
    rival = Arcade.pick(RIVALS);
    LV = LEVELS[level];
    g = {
      inning: 1, top: true, outs: 0, balls: 0, strikes: 0, bases: [false, false, false],
      line: [[], []], runs: [0, 0], hits: [0, 0], ks: 0, inningKs: 0,
      pitch: null, swing: null, play: null, playT: 0, banner: null, next: null,
      choice: 0, aim: { x: 0, y: 0 }, cursor: { x: 0, y: 0 }, steal: false, homers: 0,
      batterAnim: 0, pitcherAnim: 0,
    };
    g.line[1][0] = 0;
    startAtBat();
  }

  const batting = () => (g.top ? 1 : 0);        // which team is at bat: 0 you, 1 them
  const youBat = () => !g.top;

  function startAtBat() {
    g.balls = g.strikes = 0;
    readyPitch();
  }

  function readyPitch() {
    g.pitch = null;
    g.swing = null;
    g.batterAnim = 0;
    g.pitcherAnim = 0;
    g.cursor = { x: 0, y: 0 };
    state = 'aim';
    if (youBat()) {
      // The bot pitcher picks a pitch and a spot, then winds up after a beat.
      g.botWait = Arcade.rand(0.9, 1.6);
    } else if (AUTOPILOT) {
      g.botWait = 0.5;
    }
  }

  // ---------- Pitching ----------

  function throwPitch(kind, aimX, aimY, byBot) {
    const p = PITCHES[kind];
    const err = p.err * (byBot ? (level === 2 ? 0.8 : 1) : 1);
    const tx = clamp(aimX + Arcade.rand(-err, err) * 1.4, -2.2, 2.2);
    const ty = clamp(aimY + Arcade.rand(-err, err) * 1.4, -2.2, 2.2);
    const mph = p.mph * Arcade.rand(0.97, 1.03);
    // Seconds from release to the plate, slowed down so it's playable.
    const T = MOUND / (mph * 1.467) * LV.slow;
    g.pitch = { kind, p, tx, ty, mph, T, t: 0, brk: p.brk, hand: byBot ? 1 : -1 };
    g.pitcherAnim = 0.001;
    g.windup = 0.55;
    state = 'pitch';
    Sports.sfx.tick();
    // The bot batter decides now whether it'll swing and how well it picked up the pitch.
    if (!youBat()) planBotSwing();
  }

  // Ball position along its path, in feet (x across, y height, z from the plate).
  function ballPos(pt, t) {
    const k = clamp(t / pt.T, 0, 1.15);
    const rx = 1.6 * pt.hand, ry = 6;
    const tx = pt.tx * ZONE_W, ty = ZONE_MID + pt.ty * ZONE_H;
    // Breaking balls travel straight at first and bend late.
    const bx = pt.brk[0], by = pt.brk[1];
    const x = lerp(rx, tx - bx, k) + bx * Math.pow(k, 2.4);
    const y = lerp(ry, ty - by, k) + by * Math.pow(k, 2.2);
    return { x, y, z: MOUND * (1 - k) };
  }
  const inZone = pt => Math.abs(pt.tx) <= 1.05 && Math.abs(pt.ty) <= 1.05;

  // ---------- Swinging ----------

  function swing() {
    if (state !== 'pitch' || g.swing || !youBat() || g.windup > 0) return;
    g.swing = { t: g.pitch.t, x: g.cursor.x, y: g.cursor.y };
    g.batterAnim = 0.001;
    Sports.noise(0.12, { vol: 0.06, from: 1800, to: 500, type: 'bandpass' });
  }

  function planBotSwing() {
    const pt = g.pitch;
    const zone = inZone(pt);
    // Offspeed pitches fool the bot more often; corners are harder to square up.
    const fooled = pt.p.id !== 'fast' && Math.random() > LV.eye;
    // With two strikes it protects the plate and chases more.
    const two = g.strikes >= 2;
    const go = zone ? Math.random() < (two ? 0.9 : 0.72) || fooled : Math.random() < LV.chase + (two ? 0.12 : 0) + (fooled ? 0.25 : 0);
    if (!go) { g.botSwing = null; return; }
    const edge = Math.max(Math.abs(pt.tx), Math.abs(pt.ty));
    const timing = Arcade.rand(-1, 1) * (fooled ? 1.5 : 1) / LV.contact;
    const miss = (edge > 1 ? 0.42 : 0.3) / LV.contact + (fooled ? 0.12 : 0);
    g.botSwing = {
      t: pt.T + timing * WINDOW,
      x: pt.tx + Arcade.rand(-miss, miss),
      y: pt.ty + Arcade.rand(-miss, miss),
    };
  }

  // At the plate: did the bat meet the ball, and how?
  function contact(sw, pt, power) {
    const e = (sw.t - pt.T) / WINDOW;                       // -1 early … 1 late
    const dx = sw.x - pt.tx, dy = sw.y - pt.ty;
    const d = Math.hypot(dx, dy);
    if (Math.abs(e) > 1 || d > CURSOR) return null;
    const q = (1 - d / CURSOR) * (1 - Math.abs(e) * 0.55);
    // Early swings pull the ball to left field, late ones go the other way.
    const angle = clamp(e * 42 + dx * 25 + Arcade.rand(-6, 6), -70, 70);
    // Hitting under the ball lifts it; over the top beats it into the ground.
    const launch = clamp(14 + (pt.ty - sw.y) / CURSOR * 38 + Arcade.rand(-5, 5), -15, 70);
    const mph = (58 + q * 52) * power;
    return { angle, launch, mph, q };
  }

  // ---------- Resolving pitches ----------

  function pitchArrived() {
    const pt = g.pitch;
    const sw = youBat() ? g.swing : g.botSwing;
    if (sw) {
      const c = contact(sw, pt, youBat() ? 1.04 : LV.power);
      if (c) return inPlay(c);
      g.strikes = Math.min(3, g.strikes + 1);
      return call(g.strikes >= 3 ? 'Strike three!' : 'Swing and a miss', 'strike');
    }
    if (inZone(pt)) {
      g.strikes++;
      return call(g.strikes >= 3 ? 'Strike three, called!' : 'Strike!', 'strike');
    }
    g.balls++;
    if (g.balls >= 4) return walk();
    return call('Ball', 'ball');
  }

  function call(text, kind) {
    g.banner = { text, t: 1.1, kind };
    state = 'result';
    g.wait = 1.1;
    if (kind === 'strike') Sports.sfx.pop();
    if (g.strikes >= 3) {
      g.next = () => out('K');
      if (!youBat()) { g.ks++; g.inningKs++; Sports.sfx.cheer(0.6); }
      return;
    }
    g.next = () => { stealCheck(); readyPitch(); };
  }

  function walk() {
    g.banner = { text: 'Ball four · take your base', t: 1.3 };
    state = 'result';
    g.wait = 1.3;
    const [a, b, c] = g.bases;
    let runs = 0;
    if (a && b && c) runs = 1;
    g.bases = [true, a || false ? true : b, a && b ? true : c];
    if (a) g.bases[1] = true;
    if (a && b) g.bases[2] = true;
    g.next = () => { score(runs); startAtBat(); };
  }

  // A stolen base attempt, called before the pitch, settles once it's thrown.
  function stealCheck() {
    if (!g.steal) return;
    g.steal = false;
    if (!g.bases[0] || g.bases[1]) return;
    const safe = Math.random() < (level === 2 ? 0.6 : level === 1 ? 0.7 : 0.8);
    g.bases[0] = false;
    if (safe) { g.bases[1] = true; fx.text(W / 2, 200, 'STOLEN BASE!', '#3ddc84', 30); Sports.sfx.good(); }
    else { g.outs++; fx.text(W / 2, 200, 'CAUGHT STEALING', '#ff5d5d', 30); Sports.sfx.bad(); if (g.outs >= 3) g.after3 = true; }
  }

  function inPlay(c) {
    const play = SlamField.resolve(c.angle, c.mph, c.launch, g.bases, g.outs, youBat() ? 0.95 + level * 0.05 : 0.95);
    g.play = play;
    g.playT = 0;
    state = 'play';
    Sports.sfx.crack();
    if (play.result === 'foul') {
      // Fouls count as strikes until two.
      if (g.strikes < 2) g.strikes++;
      g.playT = 0;
      g.play.end = Math.min(play.end, 1.6);
    }
    excite = play.result === 'hr' ? 1 : ['single', 'double', 'triple'].includes(play.result) ? 0.5 : 0.15;
    if (excite > 0.3) Sports.sfx.cheer(excite * 1.3);
  }

  function playDone() {
    const play = g.play;
    g.play = null;
    const bat = batting();
    if (play.result === 'foul') { g.banner = { text: 'Foul ball', t: 0.9 }; state = 'result'; g.wait = 0.9; g.next = readyPitch; return; }
    const hit = ['single', 'double', 'triple', 'hr'].includes(play.result);
    if (hit) g.hits[bat]++;
    if (play.result === 'hr' && bat === 0) {
      g.homers++;
      Arcade.flag('grand-slam-hr');
      if (play.text === 'GRAND SLAM!') Arcade.flag('grand-slam-slam');
      fx.confetti(W / 2, 220, 140);
      for (let i = 0; i < 4; i++) setTimeout(() => fx.firework(Arcade.rand(200, 760), Arcade.rand(60, 160), Arcade.pick(['#ffc53d', '#ff5d5d', '#4f8cff', '#3ddc84'])), i * 250);
      Sports.sfx.organ();
    }
    g.bases = play.bases;
    g.banner = { text: play.text, t: 1.5, kind: hit ? 'hit' : 'out' };
    state = 'result';
    g.wait = 1.5;
    const runs = play.runs, outs = play.outs;
    g.next = () => {
      score(runs);
      if (outs) { out(play.result, outs); return; }
      startAtBat();
    };
  }

  function score(runs) {
    if (!runs) return;
    const bat = batting();
    g.runs[bat] += runs;
    g.line[bat][g.inning - 1] = (g.line[bat][g.inning - 1] || 0) + runs;
    if (bat === 0) { fx.text(W / 2, 170, runs > 1 ? `${runs} RUNS SCORE` : 'RUN SCORES', '#ffc53d', 30); Sports.sfx.cheer(0.8); }
    else Sports.sfx.groan();
    // Walk-off: the home team takes the lead in the last inning.
    if (!g.top && g.inning >= innings && g.runs[0] > g.runs[1]) g.walkoff = true;
  }

  function out(kind, n = 1) {
    g.outs += n;
    if (g.walkoff) return endGame();
    if (g.outs >= 3 || g.after3) return endHalf();
    startAtBat();
  }

  function endHalf() {
    if (g.top && g.inningKs >= 3) Arcade.flag('grand-slam-k');
    g.after3 = false;
    g.outs = 0;
    g.bases = [false, false, false];
    g.inningKs = 0;
    g.steal = false;
    if (g.top) {
      // Bottom half; skipped in the last inning if you're already ahead.
      if (g.inning >= innings && g.runs[0] > g.runs[1]) return endGame();
      g.top = false;
      g.line[0][g.inning - 1] = g.line[0][g.inning - 1] || 0;
      g.banner = { text: `Bottom of the ${ordinal(g.inning)} · you're up`, t: 1.6 };
    } else {
      if (g.inning >= innings && g.runs[0] !== g.runs[1]) return endGame();
      g.inning++;
      g.top = true;
      g.line[1][g.inning - 1] = 0;
      g.banner = { text: g.inning > innings ? `Extra innings! Top of the ${ordinal(g.inning)}` : `Top of the ${ordinal(g.inning)} · take the mound`, t: 1.6 };
    }
    g.line[batting()][g.inning - 1] = g.line[batting()][g.inning - 1] || 0;
    Sports.sfx.whistle();
    state = 'result';
    g.wait = 1.6;
    g.next = startAtBat;
    // Extra innings stop after the 9th.
    if (g.inning > Math.max(innings + 3, 9)) endGame();
  }

  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10] || 'th');

  function endGame() {
    state = 'over';
    Sports.stopCrowd();
    const [us, them] = g.runs;
    const won = us > them, tie = us === them;
    (won ? Sports.sfx.win : Sports.sfx.lose)();
    if (won) Arcade.flag('grand-slam-win');
    const score = AUTOPILOT ? 0 : Math.max(0, Math.round(((won ? 400 : tie ? 120 : 0) + us * 60 + g.hits[0] * 12 + g.ks * 15 - them * 10 + g.homers * 50) * LV.mult));
    Arcade.finish(ui, {
      score,
      title: won ? (g.walkoff ? 'Walk-off win!' : 'You win!') : tie ? 'Tie game' : `${rival.name} win`,
      lines: [`${ME.name} ${us} – ${them} ${rival.name}`, `Hits ${g.hits[0]} – ${g.hits[1]} · strikeouts ${g.ks}${g.homers ? ` · home runs ${g.homers}` : ''}`],
      button: 'Play ball',
      onAction: () => start(),
    });
  }

  // ---------- The bot on the mound ----------

  function botPitch() {
    // Mostly strikes, nibbling at corners; more waste pitches when ahead in the count.
    const ahead = g.strikes > g.balls;
    const kind = Math.random() < 0.45 ? 0 : Arcade.randInt(1, 3);
    const wide = ahead && Math.random() < 0.5;
    const x = wide ? Arcade.pick([-1.4, 1.4]) : Arcade.rand(-0.85, 0.85);
    const y = wide ? Arcade.rand(-1.4, 0.6) : Arcade.rand(-0.85, 0.85);
    throwPitch(kind, x, y, true);
  }

  // ---------- Update ----------

  function update(dt) {
    excite = Math.max(0, excite - dt * 0.3);
    if (state === 'aim') {
      if (g.botWait !== undefined && g.botWait > 0) {
        g.botWait -= dt;
        if (g.botWait <= 0) {
          g.botWait = undefined;
          if (youBat()) botPitch();
          else if (AUTOPILOT) throwPitch(Arcade.randInt(0, 3), Arcade.rand(-1.1, 1.1), Arcade.rand(-1.1, 1.1), false);
        }
      }
      moveCursor(dt);
    } else if (state === 'pitch') {
      moveCursor(dt);
      if (g.windup > 0) { g.windup -= dt; g.pitcherAnim = 1 - g.windup / 0.55; return; }
      g.pitch.t += dt;
      if (g.swing) g.batterAnim = Math.min(1, g.batterAnim + dt * 5);
      if (g.botSwing && g.pitch.t >= g.botSwing.t - 0.1) g.batterAnim = Math.min(1, g.batterAnim + dt * 5);
      // Autopilot bats with the bot's eye.
      if (AUTOPILOT && youBat() && !g.swing && g.pitch.t > 0.05 && g.auto === undefined) {
        planBotSwing();
        g.auto = g.botSwing;
        g.botSwing = null;
      }
      if (AUTOPILOT && youBat() && g.auto && g.pitch.t >= g.auto.t) { g.cursor = { x: g.auto.x, y: g.auto.y }; g.swing = { ...g.auto }; g.auto = null; }
      if (g.pitch.t >= g.pitch.T + 0.02) { g.auto = undefined; pitchArrived(); }
    } else if (state === 'play') {
      g.playT += dt;
      if (g.playT >= g.play.end) playDone();
    } else if (state === 'result') {
      g.wait -= dt;
      if (g.wait <= 0) { const n = g.next; g.next = null; n?.(); }
    }
    if (g.banner) { g.banner.t -= dt; if (g.banner.t <= 0) g.banner = null; }
  }

  // Your cursor: the aiming target on the mound, or the contact zone at bat.
  function moveCursor(dt) {
    const target = youBat() ? g.cursor : g.aim;
    const sp = 2.6 * dt;
    target.x = clamp(target.x + (keys.right - keys.left) * sp, -1.8, 1.8);
    target.y = clamp(target.y + (keys.up - keys.down) * sp, -1.8, 1.8);
  }

  // ---------- Input ----------

  const keys = { left: 0, right: 0, up: 0, down: 0 };
  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'paused') resume(); else pause(); return; }
    if (!g || state === 'menu' || state === 'over' || state === 'paused') return;
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = 1; e.preventDefault(); }
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); act(); }
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0 && !youBat() && state === 'aim') { g.choice = n; Sports.sfx.select(); }
    if (e.code === 'KeyR' && youBat()) toggleSteal();
  });
  window.addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = 0; });

  function act() {
    if (youBat()) swing();
    else if (state === 'aim') throwPitch(g.choice, g.aim.x, g.aim.y, false);
  }
  function toggleSteal() {
    if (state !== 'aim' || !youBat() || !g.bases[0] || g.bases[1]) return;
    g.steal = !g.steal;
    Sports.sfx.select();
  }

  // Pointer: point at the zone to aim; click (or the Swing/Pitch button) to act.
  const zoneToScreen = (zx, zy) => {
    const s = F / CAM_Z;
    return [W / 2 + zx * ZONE_W * s, HZ - (ZONE_MID + zy * ZONE_H - CAM_H) * s];
  };
  const screenToZone = (sx, sy) => {
    const s = F / CAM_Z;
    return [(sx - W / 2) / s / ZONE_W, ((HZ - sy) / s + CAM_H - ZONE_MID) / ZONE_H];
  };
  function pointerZone(e) {
    const r = canvas.getBoundingClientRect();
    return screenToZone(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
  }
  // Pitch picker: a 2x2 grid in the bottom-right corner, clear of the catcher.
  const PB_X = W - 248, PB_Y = H - 124;
  function pitchButtonAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    const col = Math.floor((x - PB_X) / 115), row = Math.floor((y - PB_Y) / 54);
    return col >= 0 && col < 2 && row >= 0 && row < 2 ? row * 2 + col : -1;
  }
  canvas.addEventListener('pointermove', e => {
    if (!g || (state !== 'aim' && state !== 'pitch')) return;
    const [zx, zy] = pointerZone(e);
    const t = youBat() ? g.cursor : state === 'aim' ? g.aim : null;
    if (t && (e.pointerType === 'mouse' || e.buttons)) { t.x = clamp(zx, -1.8, 1.8); t.y = clamp(zy, -1.8, 1.8); }
  });
  canvas.addEventListener('pointerdown', e => {
    if (!g || (state !== 'aim' && state !== 'pitch')) return;
    if (!youBat() && state === 'aim') {
      const b = pitchButtonAt(e);
      if (b >= 0) { g.choice = b; Sports.sfx.select(); return; }
    }
    const [zx, zy] = pointerZone(e);
    const t = youBat() ? g.cursor : g.aim;
    t.x = clamp(zx, -1.8, 1.8);
    t.y = clamp(zy, -1.8, 1.8);
    // A mouse click acts straight away; on touch you drag to aim and use the button.
    if (e.pointerType === 'mouse') act();
  });
  $('t-act').addEventListener('pointerdown', e => { e.preventDefault(); if (g) act(); });
  $('t-steal').addEventListener('pointerdown', e => { e.preventDefault(); if (g) toggleSteal(); });

  // ---------- Drawing: the park behind the plate ----------

  const P = (x, y, z) => {
    const s = F / (z + CAM_Z);
    return [W / 2 + x * s, HZ - (y - CAM_H) * s, s];
  };

  function renderPark() {
    const c = parkLayer.ctx;
    // Sky and the stands behind the outfield.
    const sky = c.createLinearGradient(0, 0, 0, HZ);
    sky.addColorStop(0, '#2a4f8a');
    sky.addColorStop(1, '#8fc0e8');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, HZ);
    // Light towers.
    for (const x of [90, 870]) {
      c.fillStyle = '#3a3f4a';
      c.fillRect(x - 3, 20, 6, 150);
      c.fillStyle = '#e8eef5';
      c.fillRect(x - 26, 14, 52, 18);
      c.fillStyle = 'rgba(255,255,240,0.35)';
      c.beginPath(); c.arc(x, 23, 40, 0, Math.PI * 2); c.fill();
    }
    // Scoreboard frame in centre field (numbers drawn live).
    c.fillStyle = '#1b2230';
    c.fillRect(W / 2 - 150, 22, 300, 96);
    c.strokeStyle = '#ffc53d';
    c.lineWidth = 3;
    c.strokeRect(W / 2 - 150, 22, 300, 96);
    // Outfield wall with ads.
    c.fillStyle = '#1f5f8a';
    c.fillRect(0, HZ - 30, W, 26);
    const ads = [['PIXEL PIONEERS', '#ffc53d'], ['GRAND SLAM', '#ff5d5d'], ['TACO TRUCK', '#3ddc84'], ['APEX GP', '#4fd1ff'], ['ICE CLASH', '#a46bff']];
    c.font = '800 12px system-ui, sans-serif';
    c.textAlign = 'center';
    ads.forEach(([t, col], i) => { const x = 96 + i * 192; c.fillStyle = col; c.fillRect(x - 70, HZ - 26, 140, 18); c.fillStyle = '#10141c'; c.fillText(t, x, HZ - 12.5); });
    c.fillStyle = '#ffc53d';
    c.fillRect(0, HZ - 32, W, 3);
    // Grass in perspective, with mowing bands.
    c.fillStyle = '#3f8f3f';
    c.fillRect(0, HZ - 4, W, H - HZ + 4);
    for (let z = 400; z > 0; z -= 25) {
      const [, y1] = P(0, 0, z), [, y2] = P(0, 0, z - 25);
      c.fillStyle = (z / 25) % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
      c.fillRect(0, y1, W, y2 - y1);
    }
    // Infield dirt: a wedge out to the bases, the mound, and the plate area.
    const dirt = '#c99a62';
    c.fillStyle = dirt;
    c.beginPath();
    const corner = (x, z) => P(x, 0, z);
    const [ax, ay] = corner(-95, 95), [bx, by] = corner(95, 95), [cx, cy] = corner(0, 135), [hx1, hy1] = corner(-12, -4), [hx2, hy2] = corner(12, -4);
    c.moveTo(hx1, hy1); c.lineTo(ax, ay); c.quadraticCurveTo(cx, cy - 18, bx, by); c.lineTo(hx2, hy2); c.fill();
    c.fillStyle = '#3f8f3f';
    const [g1x, g1y] = corner(-52, 52), [g2x, g2y] = corner(0, 100), [g3x, g3y] = corner(52, 52), [g4x, g4y] = corner(0, 12);
    c.beginPath(); c.moveTo(g1x, g1y); c.lineTo(g2x, g2y); c.lineTo(g3x, g3y); c.lineTo(g4x, g4y); c.fill();
    const [mx, my, ms] = P(0, 0, MOUND + 5);
    c.fillStyle = dirt;
    c.beginPath(); c.ellipse(mx, my, 9 * ms, 2.2 * ms, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f4f4f4';
    c.fillRect(mx - 1 * ms, my - 0.2 * ms, 2 * ms, 0.4 * ms);
    // Foul lines and bases.
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 2;
    for (const sx of [-1, 1]) {
      c.beginPath(); c.moveTo(...P(sx * 1.5, 0, 0).slice(0, 2)); c.lineTo(...P(sx * 230, 0, 230).slice(0, 2)); c.stroke();
    }
    for (const [x, z] of [[63.6, 63.6], [0, 127], [-63.6, 63.6]]) {
      const [bx2, by2, bs] = P(x, 0, z);
      c.fillStyle = '#f4f4f4';
      c.fillRect(bx2 - 0.75 * bs, by2 - 0.3 * bs, 1.5 * bs, 0.6 * bs);
    }
    // Batter's boxes and home plate.
    c.fillStyle = '#c4935a';
    c.beginPath(); c.ellipse(W / 2, P(0, 0, 0)[1] + 4, 170, 26, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 2;
    for (const sx of [-1, 1]) {
      const p1 = P(sx * 1.2, 0, 3), p2 = P(sx * 5, 0, 3), p3 = P(sx * 5, 0, -3), p4 = P(sx * 1.2, 0, -3);
      c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.lineTo(p3[0], p3[1]); c.lineTo(p4[0], p4[1]); c.closePath(); c.stroke();
    }
    const h1 = P(-0.71, 0, 0.7), h2 = P(0.71, 0, 0.7), h3 = P(0.71, 0, 0), h4 = P(0, 0, -0.7), h5 = P(-0.71, 0, 0);
    c.fillStyle = '#f4f4f4';
    c.beginPath(); c.moveTo(h1[0], h1[1]); c.lineTo(h2[0], h2[1]); c.lineTo(h3[0], h3[1]); c.lineTo(h4[0], h4[1]); c.lineTo(h5[0], h5[1]); c.fill();
  }

  function drawPerson(c, x, y, s, kit, opts = {}) {
    // A ball player drawn upright at feet (x, y); s is pixels per foot.
    const { back = false, crouch = 0, arm = 0, leg = 0, glove = true } = opts;
    const h = (1 - crouch * 0.35);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.ellipse(x, y, 1.3 * s, 0.35 * s, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#eceef2';
    c.lineWidth = 0.55 * s;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x - 0.3 * s, y - 3 * s * h); c.lineTo(x - 0.45 * s - leg * 0.6 * s, y - (leg ? 1.2 : 0) * s);
    c.moveTo(x + 0.3 * s, y - 3 * s * h); c.lineTo(x + 0.45 * s, y);
    c.stroke();
    c.fillStyle = kit.shirt;
    c.beginPath(); c.roundRect(x - 0.85 * s, y - 5.3 * s * h, 1.7 * s, 2.5 * s * h, 0.5 * s); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.15)';
    c.fillRect(x + 0.3 * s, y - 5.3 * s * h, 0.55 * s, 2.5 * s * h);
    // Throwing arm swings over the top.
    const a = -Math.PI / 2 - 1.2 + arm * 2.6;
    c.strokeStyle = '#f2c9a0';
    c.lineWidth = 0.42 * s;
    c.beginPath(); c.moveTo(x + 0.7 * s, y - 4.9 * s * h); c.lineTo(x + 0.7 * s + Math.cos(a) * 1.8 * s, y - 4.9 * s * h + Math.sin(a) * 1.8 * s); c.stroke();
    if (glove) {
      c.fillStyle = '#7a4a22';
      c.beginPath(); c.arc(x - 1.1 * s, y - 4.1 * s * h, 0.45 * s, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = back ? '#3a2a1a' : '#f2c9a0';
    c.beginPath(); c.arc(x, y - 6 * s * h, 0.62 * s, 0, Math.PI * 2); c.fill();
    c.fillStyle = kit.cap;
    c.beginPath(); c.arc(x, y - 6.2 * s * h, 0.64 * s, Math.PI, 0); c.fill();
    if (!back) c.fillRect(x - 0.1 * s, y - 6.25 * s * h, 0.9 * s, 0.18 * s);
  }

  // The batter, seen from behind, standing in the right-handed box (left of the plate).
  function drawBatter(c, kit, anim) {
    const [x, y, s] = P(-3.4, 0, 0.6);
    const sc = s * 0.66;
    drawPerson(c, x, y, sc, kit, { back: true, glove: false });
    c.fillStyle = '#2a2d36';
    c.beginPath(); c.arc(x, y - 6.15 * sc, 0.68 * sc, 0, Math.PI * 2); c.fill();
    c.fillStyle = kit.shirt;
    c.font = `800 ${Math.round(0.9 * sc)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.fillText('12', x, y - 3.9 * sc);
    // The bat: cocked over the shoulder, then whipped through the zone.
    const hands = [x + 0.6 * sc, y - 4.6 * sc];
    const a = lerp(-2.3, 0.9, anim) + (anim > 0 ? 0 : Math.sin(performance.now() / 300) * 0.05);
    c.strokeStyle = '#c9a26a';
    c.lineWidth = 0.32 * sc;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(hands[0], hands[1]); c.lineTo(hands[0] + Math.cos(a) * 3.1 * sc, hands[1] + Math.sin(a) * 3.1 * sc * (anim > 0.3 ? 0.5 : 1)); c.stroke();
    c.strokeStyle = '#a07a40';
    c.lineWidth = 0.42 * sc;
    c.beginPath(); c.moveTo(hands[0] + Math.cos(a) * 2 * sc, hands[1] + Math.sin(a) * 2 * sc * (anim > 0.3 ? 0.5 : 1)); c.lineTo(hands[0] + Math.cos(a) * 3.1 * sc, hands[1] + Math.sin(a) * 3.1 * sc * (anim > 0.3 ? 0.5 : 1)); c.stroke();
  }

  function drawPitcher(c, kit, anim) {
    const [x, y, s] = P(0, 0.8, MOUND + 5);
    // Wind-up: knee up, then the arm comes over.
    drawPerson(c, x, y, s * 1.05, kit, { leg: anim > 0.15 && anim < 0.7 ? 1 : 0, arm: anim });
  }

  function drawCatcher(c, kit) {
    // Crouched low at the bottom of the frame so the zone stays clear above the mask.
    const x = W / 2, y = H + 8, sc = 24;
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.ellipse(x, y, 1.8 * sc, 0.5 * sc, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2a2d36';
    c.beginPath(); c.roundRect(x - 1.3 * sc, y - 3.2 * sc, 2.6 * sc, 2.3 * sc, 0.8 * sc); c.fill();
    c.fillStyle = kit.shirt;
    c.fillRect(x - 1.3 * sc, y - 1.4 * sc, 2.6 * sc, 0.5 * sc);
    c.fillStyle = '#1b1e24';
    c.beginPath(); c.arc(x, y - 3.9 * sc, 0.75 * sc, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#7a4a22';
    c.beginPath(); c.arc(x + 1.4 * sc, y - 3 * sc, 0.7 * sc, 0, Math.PI * 2); c.fill();
  }

  function drawZone() {
    const [x0, y0] = zoneToScreen(-1, 1), [x1, y1] = zoneToScreen(1, -1);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x0 + ((x1 - x0) * i) / 3, y0); ctx.lineTo(x0 + ((x1 - x0) * i) / 3, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, y0 + ((y1 - y0) * i) / 3); ctx.lineTo(x1, y0 + ((y1 - y0) * i) / 3); ctx.stroke();
    }
  }

  function drawBall() {
    const pt = g.pitch;
    if (!pt || g.windup > 0) return;
    const b = ballPos(pt, pt.t);
    if (b.z < -3) return;
    const [x, y, s] = P(b.x, b.y, b.z);
    const [, gy] = P(b.x, 0, b.z);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, gy, 0.2 * s + 1, 0.06 * s + 0.5, 0, 0, Math.PI * 2); ctx.fill();
    const r = Math.max(1.5, 0.12 * s);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // Spinning seams.
    ctx.strokeStyle = '#d64545';
    ctx.lineWidth = Math.max(0.6, r * 0.18);
    const spin = pt.t * 40;
    ctx.beginPath(); ctx.arc(x - r * 0.9 * Math.cos(spin), y, r * 0.7, -1, 1); ctx.stroke();
  }

  function drawCursor() {
    if (youBat()) {
      const [cx, cy] = zoneToScreen(g.cursor.x, g.cursor.y);
      const [ex] = zoneToScreen(g.cursor.x + CURSOR, 0);
      const r = ex - cx;
      ctx.strokeStyle = g.swing ? '#ffc53d' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,197,61,0.12)';
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
    } else if (state === 'aim') {
      const [cx, cy] = zoneToScreen(g.aim.x, g.aim.y);
      const err = PITCHES[g.choice].err * 1.4;
      const [ex] = zoneToScreen(g.aim.x + err, 0);
      ctx.strokeStyle = '#ff5d5d';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(6, ex - cx), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff5d5d';
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawPitchButtons() {
    PITCHES.forEach((p, i) => {
      const x = PB_X + (i % 2) * 115, y = PB_Y + Math.floor(i / 2) * 54;
      const on = i === g.choice;
      ctx.fillStyle = on ? 'rgba(255,197,61,0.95)' : 'rgba(12,14,22,0.8)';
      ctx.beginPath(); ctx.roundRect(x + 3, y, 109, 48, 10); ctx.fill();
      ctx.fillStyle = on ? '#1c1500' : '#eceef2';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, x + 57, y + 22);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = on ? '#4a3608' : '#9aa3b5';
      ctx.fillText(`${p.key} · ${p.mph} mph`, x + 57, y + 38);
    });
  }

  // Line score on the centre-field board, plus count, outs and bases.
  function drawScoreboard() {
    const onField = state === 'play' || !!g.lastPlay;
    const bx0 = onField ? 14 : W / 2 - 150, by0 = onField ? H - 110 : 22;
    ctx.fillStyle = onField ? 'rgba(12,14,22,0.82)' : '#1b2230';
    ctx.fillRect(bx0, by0, 300, 96);
    ctx.strokeStyle = '#ffc53d';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx0, by0, 300, 96);
    const x0 = bx0 + 10, y0 = by0 + 8;
    const cols = Math.max(innings, g.inning);
    const cw = Math.min(22, 170 / cols);
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9aa3b5';
    for (let i = 0; i < cols; i++) ctx.fillText(i + 1, x0 + 44 + i * cw, y0 + 10);
    ctx.fillText('R', x0 + 44 + cols * cw + 8, y0 + 10);
    ctx.fillText('H', x0 + 44 + cols * cw + 34, y0 + 10);
    [[rival, 1], [ME, 0]].forEach(([team, t], row) => {
      const y = y0 + 30 + row * 22;
      ctx.textAlign = 'left';
      ctx.fillStyle = team.shirt;
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.fillText(team.short, x0 + 4, y);
      ctx.textAlign = 'center';
      ctx.font = '700 12px ui-monospace, monospace';
      ctx.fillStyle = '#eceef2';
      for (let i = 0; i < cols; i++) {
        const v = g.line[t][i];
        const live = i === g.inning - 1 && batting() === t;
        ctx.fillStyle = live ? '#ffc53d' : '#eceef2';
        ctx.fillText(v === undefined ? '' : v, x0 + 44 + i * cw, y);
      }
      ctx.fillStyle = '#ffc53d';
      ctx.font = '900 14px ui-monospace, monospace';
      ctx.fillText(g.runs[t], x0 + 44 + cols * cw + 8, y);
      ctx.fillStyle = '#eceef2';
      ctx.font = '700 12px ui-monospace, monospace';
      ctx.fillText(g.hits[t], x0 + 44 + cols * cw + 34, y);
    });
    ctx.fillStyle = '#9aa3b5';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(`${g.top ? '▲' : '▼'} ${g.inning}`, x0 + 260, y0 + 10);
    // Count and outs, top left.
    const px = 18, py = 18;
    ctx.fillStyle = 'rgba(12,14,22,0.75)';
    ctx.beginPath(); ctx.roundRect(px, py, 150, 86, 10); ctx.fill();
    const dots = (label, n, max, col, y) => {
      ctx.fillStyle = '#9aa3b5';
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, px + 12, y + 4);
      for (let i = 0; i < max; i++) { ctx.fillStyle = i < n ? col : 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(px + 36 + i * 15, y, 5, 0, Math.PI * 2); ctx.fill(); }
    };
    dots('B', g.balls, 3, '#3ddc84', py + 20);
    dots('S', g.strikes, 2, '#ffc53d', py + 42);
    dots('O', g.outs, 2, '#ff5d5d', py + 64);
    // Base diamond.
    const bx = px + 118, by = py + 46;
    [[0, -16], [-16, 0], [16, 0]].forEach(([dx, dy], i) => {
      const on = g.bases[[1, 2, 0][i]];
      ctx.fillStyle = on ? '#ffc53d' : 'rgba(255,255,255,0.18)';
      ctx.save(); ctx.translate(bx + dx, by + dy); ctx.rotate(Math.PI / 4); ctx.fillRect(-6, -6, 12, 12); ctx.restore();
    });
    // Who's doing what, top right.
    ctx.fillStyle = 'rgba(12,14,22,0.75)';
    ctx.beginPath(); ctx.roundRect(W - 198, 18, 180, 52, 10); ctx.fill();
    ctx.fillStyle = youBat() ? ME.shirt : rival.shirt;
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(youBat() ? 'YOU\'RE BATTING' : 'YOU\'RE PITCHING', W - 186, 40);
    ctx.fillStyle = '#9aa3b5';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(youBat() ? (g.steal ? 'Runner going on the pitch!' : 'Aim the circle, time the swing') : 'Pick a pitch, aim, throw', W - 186, 58);
  }

  function draw(dt) {
    if (!g) {
      ctx.drawImage(parkLayer.canvas, 0, 0, W, H);
      crowd.draw(ctx, 0, HZ - 150, 0, performance.now() / 1000);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      return;
    }
    if (state === 'play' || (state === 'result' && g.lastPlay)) {
      // The diamond, top-down, while the ball is in play.
      ctx.drawImage(fieldLayer.canvas, 0, 0, W, H);
      const play = g.play || g.lastPlay;
      SlamField.drawPlay(ctx, W, H, play, g.play ? g.playT : play.end, batting() === 0 ? rival : ME, batting() === 0 ? ME : rival, g.play ? g.bases : play.bases);
      if (g.play) g.lastPlay = g.play;
    } else {
      g.lastPlay = null;
      ctx.drawImage(parkLayer.canvas, 0, 0, W, H);
      crowd.draw(ctx, 0, HZ - 150, excite, performance.now() / 1000);
      const fieldKit = youBat() ? rival : ME, batKit = youBat() ? ME : rival;
      drawPitcher(ctx, fieldKit, g.pitcherAnim);
      drawZone();
      drawBall();
      drawBatter(ctx, batKit, g.batterAnim);
      drawCatcher(ctx, fieldKit);
      if (state === 'aim' || state === 'pitch') drawCursor();
      if (!youBat() && state === 'aim') drawPitchButtons();
    }
    fx.update(dt);
    fx.draw(ctx);
    drawScoreboard();
    if (g.banner) {
      const b = g.banner;
      ctx.globalAlpha = Math.min(1, b.t * 4);
      ctx.fillStyle = 'rgba(12,14,22,0.78)';
      ctx.fillRect(0, H / 2 - 30, W, 60);
      ctx.fillStyle = b.kind === 'hit' ? (batting() === 0 ? ME.shirt : rival.shirt) : b.kind === 'out' || b.kind === 'strike' ? '#ff8a8a' : '#ffffff';
      if (b.text.includes('HOME') || b.text.includes('GRAND')) ctx.fillStyle = '#ffc53d';
      ctx.font = '900 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.text, W / 2, H / 2 + 12);
      ctx.globalAlpha = 1;
    }
  }

  function updateHud() {
    if (!g) return;
    $('score').textContent = `${g.runs[0]} – ${g.runs[1]}`;
    $('inning').textContent = `${g.top ? '▲' : '▼'}${g.inning}`;
    $('count').textContent = `${g.balls}-${g.strikes}, ${g.outs} out`;
    $('t-act').textContent = youBat() ? 'Swing' : 'Pitch';
    $('t-steal').hidden = !youBat();
  }

  // ---------- Flow ----------

  function start() {
    ui.hide();
    Arcade.countPlay();
    newGame();
    excite = 0;
    Sports.startCrowd();
    Sports.sfx.organ();
    g.banner = { text: 'Top of the 1st · take the mound', t: 1.8 };
    state = 'result';
    g.wait = 1.8;
    g.next = startAtBat;
  }

  function pause() {
    if (!g || state === 'menu' || state === 'over' || state === 'paused') return;
    pause.was = state;
    state = 'paused';
    ui.show({ title: 'Paused', html: `<p>${ME.name} ${g.runs[0]} – ${g.runs[1]} ${rival.name} · ${g.top ? 'top' : 'bottom'} of the ${ordinal(g.inning)}</p>`, button: 'Resume', onAction: resume });
  }
  function resume() {
    state = pause.was || 'aim';
    ui.hide();
  }
  Arcade.onBlur(pause);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (g && state !== 'paused' && state !== 'menu' && state !== 'over') update(AUTOPILOT ? dt * 3 : dt);
    draw(state === 'paused' ? 0 : dt);
    updateHud();
    requestAnimationFrame(frame);
  }

  renderPark();
  SlamField.renderField(fieldLayer.ctx, W, H);
  Versus.attach({
    ui,
    start,
    score: () => (g ? Math.max(0, Math.round((g.runs[0] * 60 + g.hits[0] * 12 + g.ks * 15 - g.runs[1] * 10) * LV.mult)) : 0),
    intro: {
      title: 'Grand Slam',
      html: `<p>Three innings of arcade baseball. You pitch the top of each inning and bat the bottom.</p>
        <ul>
          <li><b>Pitching:</b> pick a pitch (<kbd>1</kbd>–<kbd>4</kbd> or tap it), aim at the zone, then <span class="kbd-only"><kbd>Space</kbd> or click</span><span class="touch-only">tap <b>Pitch</b></span>.</li>
          <li><b>Batting:</b> steer the circle over the ball and swing as it reaches the plate. Early pulls it, late goes the other way; under the ball lifts it.</li>
          <li><span class="kbd-only"><kbd>R</kbd></span><span class="touch-only"><b>Steal</b></span> sends your runner from first on the next pitch.</li>
        </ul>
        <div class="menu"><div class="row">${LEVELS.map((l, i) => `<button class="chip" type="button" data-level="${i}" aria-pressed="${i === level}">${l.name}</button>`).join('')}</div></div>`,
      button: 'Play ball',
      onAction: start,
      onRender: panel => panel.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => {
        level = +b.dataset.level;
        LV = LEVELS[level];
        Arcade.save('slam:level', level);
        panel.querySelectorAll('[data-level]').forEach(x => x.setAttribute('aria-pressed', x === b));
      })),
    },
  });
  requestAnimationFrame(frame);
})();
