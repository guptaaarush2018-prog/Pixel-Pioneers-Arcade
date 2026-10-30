(() => {
  const W = 480, H = 720, S = 8;            // S: pixels per yard
  const FW = 53.3, X0 = (W - FW * S) / 2;   // field width in yards, left sideline in px
  const EYE = H * 0.66;                     // screen row the camera's focus yard sits on
  const QUARTER = 300, PLAY_TIME = 24, INC_TIME = 6;
  const CATCH = 1.5, TACKLE = 0.95;
  const ME = { name: 'Pioneers', color: '#ffc53d', dark: '#7a5a12' };

  const TEAMS = [
    { name: 'Harbor Hawks', color: '#4f8cff' },
    { name: 'Desert Cyclones', color: '#ff8a3d' },
    { name: 'Metro Mammoths', color: '#9aa3b5' },
    { name: 'Frost Falcons', color: '#5ec8d8' },
    { name: 'Canyon Coyotes', color: '#c0703a' },
    { name: 'Iron Rams', color: '#c77dff' },
    { name: 'Bayou Gators', color: '#3ddc84' },
    { name: 'Summit Yetis', color: '#e8e8e8' },
    { name: 'Neon Knights', color: '#ff5dc8' },
    { name: 'Tidal Sharks', color: '#ff5d5d' },
  ];
  const UPGRADES = [
    { id: 'arm', name: 'QB arm', desc: 'Faster, longer, truer throws' },
    { id: 'speed', name: 'Speed', desc: 'Receivers and backs run faster' },
    { id: 'line', name: 'O-line', desc: 'Blockers hold the rush longer' },
    { id: 'kick', name: 'Kicker', desc: 'Wider field goal window' },
  ];
  const MAX_LEVEL = 5;

  // Routes are offsets in yards from where each player lines up (+y is upfield). A route keeps
  // going in its last direction unless it stops.
  const PLAYS = [
    { name: 'Slants', sub: 'Quick, inside', routes: {
      WR1: { p: [[0, 3], [8, 10]] }, SLOT: { p: [[0, 8], [-1.5, 7.5]], stop: true },
      WR2: { p: [[0, 3], [-8, 10]] }, RB: { p: [[-5, 1], [-10, 2.5]], stop: true } } },
    { name: 'Deep shot', sub: 'Everyone goes long', routes: {
      WR1: { p: [[0, 40]] }, SLOT: { p: [[0, 12], [-9, 26]] },
      WR2: { p: [[0, 40]] }, RB: { p: [[4, 3]], stop: true } } },
    { name: 'Outs', sub: 'Toward the sideline', routes: {
      WR1: { p: [[0, 9], [-6, 9]], stop: true }, SLOT: { p: [[0, 6], [7, 15]] },
      WR2: { p: [[0, 9], [6, 9]], stop: true }, RB: { p: [[-7, 0], [-9, 5]], stop: true } } },
    { name: 'HB run', sub: 'Hand it off', run: true, routes: {
      WR1: { p: [[0, 5]], stop: true }, SLOT: { p: [[0, 3]], stop: true },
      WR2: { p: [[0, 5]], stop: true }, RB: { p: [[0, 4]] } } },
  ];
  const ELIGIBLE = ['WR1', 'SLOT', 'WR2', 'RB'];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ---------- Season ----------

  const freshSeason = () => ({ week: 1, wins: 0, losses: 0, points: 0, arm: 1, speed: 1, line: 1, kick: 1 });
  let season = { ...freshSeason(), ...Arcade.load('blitz:season', {}) };
  const saveSeason = () => Arcade.save('blitz:season', season);
  const opponentFor = week => TEAMS[(week - 1) % TEAMS.length];

  // In an online duel both players face the week 1 team with starting stats, so it's fair.
  function teamSheet() {
    const duel = typeof Versus !== 'undefined' && Versus.active();
    const s = duel ? freshSeason() : season;
    const w = s.week;
    return {
      arm: s.arm, speed: s.speed, line: s.line, kick: s.kick, duel,
      opp: opponentFor(w),
      rating: clamp(0.3 + 0.04 * (w - 1), 0.3, 0.8),      // how well they move the ball
      defSpeed: 0.9 + 0.015 * Math.min(w - 1, 12),        // how quick their defenders are
    };
  }

  // ---------- Game state ----------

  let state = 'menu';
  let team, us, them, quarter, clock, los, toGo, down, overtime;
  let players = [], ball = null, carrier = null, play = null, liveT = 0;
  let cam = 30, cards = [], banner = null, deadT = 0, pending = null;
  let burst = 0, burstCool = 0, kickMeter = null;
  const held = { up: false, down: false, left: false, right: false };
  let steer = null; // world point the runner heads for while a finger or mouse is down

  const ord = n => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
  const downText = () => `${ord(down)} & ${toGo >= 100 ? 'Goal' : Math.max(1, Math.round(toGo - los))}`;
  const spotText = y => y === 50 ? 'midfield' : y < 50 ? `your ${Math.round(y)}` : `their ${Math.round(100 - y)}`;
  const clockText = () => overtime ? 'OT' : `Q${quarter} ${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;

  function newGame() {
    team = teamSheet();
    us = them = 0;
    quarter = 1;
    clock = QUARTER;
    overtime = false;
    startDrive(25, 'Opening kickoff. Ball on your 25.');
  }

  function startDrive(y, note = '') {
    los = y;
    down = 1;
    toGo = Math.min(los + 10, 100);
    presnap();
    if (note) say(note);
  }

  function say(text, t = 1.8) {
    banner = { text, t };
  }

  // ---------- Formation & play calling ----------

  function mk(role, side, x, y, spd) {
    return { role, side, x, y, vx: 0, vy: 0, spd, route: null, wp: 0, stun: 0, shed: 0, blocker: null };
  }

  function lineUp() {
    const L = los, sp = 1 + 0.045 * (team.speed - 1), ds = team.defSpeed;
    players = [
      mk('QB', 'off', FW / 2, L - 4, 6.6),
      mk('RB', 'off', FW / 2, L - 7, 8.2 * sp),
      ...[-5, -2.5, 0, 2.5, 5].map(dx => mk('OL', 'off', FW / 2 + dx, L - 0.8, 5.5)),
      mk('WR1', 'off', 6, L - 0.8, 8.4 * sp),
      mk('SLOT', 'off', 38, L - 1.5, 8.0 * sp),
      mk('WR2', 'off', 47, L - 0.8, 8.4 * sp),
      ...[-6.2, -2, 2, 6.2].map(dx => mk('DL', 'def', FW / 2 + dx, L + 1.1, 6.2 * ds)),
      mk('LB1', 'def', FW / 2 - 5, L + 5.5, 7.2 * ds),
      mk('LB2', 'def', FW / 2 + 5, L + 5.5, 7.2 * ds),
      mk('CB1', 'def', 6, L + 6, 8.0 * ds),
      mk('NB', 'def', 38, L + 5, 7.8 * ds),
      mk('CB2', 'def', 47, L + 6, 8.0 * ds),
      mk('S', 'def', FW / 2, L + 14, 7.8 * ds),
    ];
    // Each pass rusher has a blocker in front of him.
    const ol = players.filter(p => p.role === 'OL');
    players.filter(p => p.role === 'DL').forEach((d, i) => { d.blocker = ol[[0, 1, 3, 4][i]]; });
    ball = { state: 'held' };
    carrier = get('QB');
  }

  const get = role => players.find(p => p.role === role);

  function presnap() {
    state = 'presnap';
    play = null;
    burst = burstCool = 0;
    steer = null;
    lineUp();
    cards = PLAYS.map((p, i) => ({ label: p.name, sub: p.sub, key: String(i + 1), act: () => snap(p) }));
    if (down === 4) {
      cards.push({ label: 'Punt', sub: 'Pin them deep', key: '5', act: punt });
      const kickDist = Math.round(100 - los + 17);
      if (kickDist <= 55) cards.push({ label: 'Field goal', sub: `${kickDist} yards`, key: '6', act: startKick });
    }
    updateHud();
  }

  function snap(p) {
    play = p;
    state = 'live';
    liveT = 0;
    for (const pl of players) {
      const r = p.routes[pl.role];
      if (!r) continue;
      pl.route = { pts: r.p.map(([dx, dy]) => ({ x: pl.x + dx, y: pl.y + dy })), stop: !!r.stop };
      pl.wp = 0;
    }
    players.filter(d => d.role === 'DL').forEach(d => {
      d.shed = (1.6 + 0.45 * team.line) * Arcade.rand(0.7, 1.3) * (1.15 - 0.3 * team.rating);
    });
    Arcade.tone({ freq: 220, dur: 0.06, vol: 0.05 });
  }

  // ---------- Movement ----------

  function moveToward(p, tx, ty, spd, dt) {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    const want = d < 0.15 ? 0 : Math.min(spd, d * 4);
    const k = Math.min(1, dt * 7);
    p.vx += ((d ? dx / d : 0) * want - p.vx) * k;
    p.vy += ((d ? dy / d : 0) * want - p.vy) * k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  function runRoute(p, dt) {
    const r = p.route;
    if (!r) return moveToward(p, p.x, p.y, p.spd, dt);
    if (p.wp < r.pts.length) {
      const t = r.pts[p.wp];
      moveToward(p, t.x, t.y, p.spd, dt);
      if (Math.hypot(t.x - p.x, t.y - p.y) < 0.8) p.wp++;
      return;
    }
    if (r.stop) return moveToward(p, p.x, p.y, p.spd, dt);
    const a = r.pts[r.pts.length - 2] || { x: p.x, y: p.y - 1 }, b = r.pts[r.pts.length - 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    moveToward(p, p.x + ((b.x - a.x) / l) * 5, p.y + ((b.y - a.y) / l) * 5, p.spd, dt);
  }

  const runner = () => carrier && !(carrier.role === 'QB' && carrier.y <= los + 0.3 && !play?.run && ball.state === 'held');

  function controlInput() {
    let ix = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    let iy = (held.up ? 1 : 0) - (held.down ? 1 : 0);
    if (steer && runner()) {
      const dx = steer.x - carrier.x, dy = steer.y - carrier.y, d = Math.hypot(dx, dy);
      if (d > 0.4) { ix = dx / d; iy = dy / d; }
    }
    // Runners keep heading upfield on their own; the QB stays put until you move him.
    if (!ix && !iy && runner() && carrier.role !== 'QB') iy = 1;
    const l = Math.hypot(ix, iy) || 1;
    return { ix: ix / l, iy: iy / l, any: !!(ix || iy) };
  }

  function updateLive(dt) {
    liveT += dt;
    burst = Math.max(0, burst - dt);
    burstCool = Math.max(0, burstCool - dt);
    const qb = get('QB'), rb = get('RB');

    // HB run: the back takes the handoff as he passes the QB.
    if (play.run && carrier === qb && liveT > 0.45) {
      carrier = rb;
      rb.route = null;
    }

    // You.
    if (carrier && ball.state === 'held') {
      const inp = controlInput();
      const spd = carrier.spd * (burst > 0 ? 1.45 : 1);
      if (inp.any) moveToward(carrier, carrier.x + inp.ix * 4, carrier.y + inp.iy * 4, spd, dt);
      else moveToward(carrier, carrier.x, carrier.y, spd, dt);
    }

    // Your teammates: run routes until the ball is out, then block whoever's nearest.
    for (const p of players) {
      if (p.side !== 'off' || p === carrier) continue;
      if (ball.state === 'air' && p === ball.target) { moveToward(p, ball.to.x, ball.to.y, p.spd, dt); continue; }
      if (p.role === 'OL') { blockFor(p, dt); continue; }
      if (p.role === 'QB') { moveToward(p, p.x, p.y, p.spd, dt); continue; }
      if (runner() && carrier !== qb && carrier.role !== p.role && (play.run || ball.state === 'held')) {
        const d = nearestDef(p);
        if (d) moveToward(p, d.x, d.y, p.spd * 0.85, dt);
      } else runRoute(p, dt);
    }

    // Theirs.
    for (const d of players) {
      if (d.side !== 'def') continue;
      if (d.stun > 0) { d.stun -= dt; moveToward(d, d.x, d.y, d.spd, dt); continue; }
      defend(d, dt, qb);
    }

    // Anyone blocking slows the defender they're touching.
    for (const o of players) {
      if (o.side !== 'off' || o === carrier) continue;
      for (const d of players) {
        if (d.side === 'def' && d.role !== 'DL' && dist(o, d) < 1.1) { d.x -= d.vx * dt * 0.6; d.y -= d.vy * dt * 0.6; }
      }
    }

    if (ball.state === 'air') return flight(dt);

    // Tackles. A burst can shrug off one tackler at a time.
    for (const d of players) {
      if (d.side !== 'def' || d.stun > 0 || dist(d, carrier) > TACKLE) continue;
      if (burst > 0 && !d.broke && Math.random() < 0.4) {
        d.broke = true;
        d.stun = 1;
        Arcade.tone({ freq: 160, dur: 0.08, type: 'square', vol: 0.05 });
        continue;
      }
      const sack = carrier.role === 'QB' && carrier.y < los && !play.run;
      return endPlay({ type: sack ? 'sack' : 'tackle', y: carrier.y });
    }
    if (carrier.x < 0 || carrier.x > FW) return endPlay({ type: 'out', y: carrier.y });
    if (carrier.y >= 100) return endPlay({ type: 'td' });
  }

  function nearestDef(p) {
    let best = null, bd = Infinity;
    for (const d of players) {
      if (d.side !== 'def') continue;
      const dd = dist(d, p);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  // Linemen stay between their man and the ball.
  function blockFor(o, dt) {
    const rusher = players.find(d => d.blocker === o);
    const guard = carrier || get('QB');
    const d = rusher || nearestDef(o);
    if (!d) return;
    const dx = guard.x - d.x, dy = guard.y - d.y, l = Math.hypot(dx, dy) || 1;
    moveToward(o, d.x + (dx / l) * 1.1, d.y + (dy / l) * 1.1, o.spd, dt);
  }

  function defend(d, dt, qb) {
    // Ball in the air: anyone close enough goes for it.
    if (ball.state === 'air') {
      if (d.role !== 'DL' && dist(d, ball.to) < 16) return moveToward(d, ball.to.x, ball.to.y, d.spd, dt);
      return moveToward(d, ball.to.x, ball.to.y, d.spd * 0.7, dt);
    }
    // Pass rush: held up by the blocker until he sheds him.
    if (d.role === 'DL') {
      const target = runner() ? carrier : qb;
      if (d.shed > 0 && d.blocker && dist(d, d.blocker) < 1.5) {
        d.shed -= dt;
        return moveToward(d, target.x, target.y, d.spd * 0.12, dt);
      }
      return moveToward(d, target.x, target.y, d.spd, dt);
    }
    // Ball carrier on the move: everyone pursues, aiming a little ahead of him.
    if (runner()) {
      const lead = clamp(dist(d, carrier) / d.spd, 0, 1) * 0.8;
      return moveToward(d, carrier.x + carrier.vx * lead, carrier.y + carrier.vy * lead, d.spd, dt);
    }
    // Coverage while the QB holds the ball.
    const man = { CB1: 'WR1', NB: 'SLOT', CB2: 'WR2', LB1: 'RB' }[d.role];
    if (man) {
      const r = get(man);
      if (d.role === 'LB1' && r.y < los + 1) return moveToward(d, r.x, los + 4, d.spd, dt);
      return moveToward(d, r.x + r.vx * 0.35, r.y + r.vy * 0.35 + 1.2, d.spd, dt);
    }
    if (d.role === 'LB2') {
      const zone = { x: FW / 2, y: los + 7 };
      const r = ELIGIBLE.map(get).filter(p => dist(p, zone) < 8).sort((a, b) => dist(a, zone) - dist(b, zone))[0];
      return moveToward(d, r ? r.x : zone.x, r ? r.y + 1 : zone.y, d.spd, dt);
    }
    // Safety: over the top of the deepest receiver.
    const deep = ELIGIBLE.map(get).sort((a, b) => b.y - a.y)[0];
    moveToward(d, (deep.x + FW / 2) / 2, Math.max(los + 12, deep.y + 5), d.spd, dt);
  }

  // ---------- Passing ----------

  function canThrow() {
    return state === 'live' && ball.state === 'held' && carrier.role === 'QB' && !play.run && carrier.y <= los + 0.3;
  }

  function throwTo(tx, ty) {
    if (!canThrow()) return;
    const qb = carrier;
    let dx = tx - qb.x, dy = ty - qb.y, d = Math.hypot(dx, dy);
    const range = 42 + 3 * team.arm;
    if (d > range) { tx = qb.x + (dx / d) * range; ty = qb.y + (dy / d) * range; d = range; }
    // Throws drift with distance, less with a better arm, more with a rusher in your face.
    const pressure = players.some(p => p.role === 'DL' && dist(p, qb) < 2.5);
    const err = d * (0.055 - 0.007 * team.arm) * (pressure ? 2 : 1);
    tx += Arcade.rand(-err, err);
    ty += Arcade.rand(-err, err);
    const speed = 20 + 2 * team.arm;
    const elig = ELIGIBLE.map(get);
    const target = elig.sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty))[0];
    ball = { state: 'air', from: { x: qb.x, y: qb.y }, to: { x: tx, y: ty }, t: 0, T: d / speed + 0.2, h: d * 0.18, target, air: ty - los };
    carrier = null;
    Arcade.tone({ freq: 500, to: 300, dur: 0.12, type: 'triangle', vol: 0.04 });
  }

  // Keys 1-4 throw to a receiver, leading him to where he'll be when the ball arrives.
  function throwToReceiver(i) {
    if (!canThrow()) return;
    const r = get(ELIGIBLE[i]), qb = carrier, speed = 20 + 2 * team.arm;
    let tx = r.x, ty = r.y;
    for (let k = 0; k < 3; k++) {
      const t = Math.hypot(tx - qb.x, ty - qb.y) / speed + 0.2;
      tx = r.x + r.vx * t;
      ty = r.y + r.vy * t;
    }
    throwTo(tx, ty);
  }

  function flight(dt) {
    ball.t += dt;
    if (ball.t < ball.T) return;
    const at = ball.to;
    const near = side => players.filter(p => p.side === side && (side === 'def' || ELIGIBLE.includes(p.role)))
      .map(p => ({ p, d: dist(p, at) })).sort((a, b) => a.d - b.d)[0];
    const o = near('off'), d = near('def');
    const roll = Math.random();
    let result;
    if (o.d <= CATCH && (d.d > CATCH || o.d < d.d - 0.4)) result = roll < 0.93 ? 'catch' : 'inc';
    else if (o.d <= CATCH) result = roll < 0.45 ? 'catch' : roll < 0.62 ? 'int' : 'inc';
    else if (d.d <= 1.1) result = roll < 0.4 ? 'int' : 'inc';
    else result = 'inc';
    if (at.x < 0 || at.x > FW || at.y > 110) result = 'inc';

    if (result === 'int') return endPlay({ type: 'int', y: at.y });
    if (result === 'inc') return endPlay({ type: 'inc' });
    carrier = o.p;
    carrier.x = at.x;
    carrier.y = at.y;
    carrier.route = null;
    if (ball.air >= 35) Arcade.flag('blitz-bowl-bomb');
    ball = { state: 'held' };
    Arcade.tone({ freq: 660, dur: 0.08, type: 'triangle', vol: 0.05 });
    if (carrier.y >= 100) endPlay({ type: 'td' });
  }

  // ---------- Kicking ----------

  function punt() {
    const land = los + Arcade.rand(36, 48);
    say(`Punt: ${Math.round(land - los)} yards`);
    turnover(land >= 100 ? 20 : 100 - land, 'punt', 0);
  }

  // A needle swings across the posts; stop it inside the window.
  function startKick() {
    const yards = Math.round(100 - los + 17);
    state = 'kick';
    kickMeter = { yards, t: 0, win: (0.3 + 0.05 * team.kick) * (1.25 - yards / 60), speed: 2.6 + yards / 25 };
    updateHud();
  }

  function kick() {
    if (state !== 'kick' || kickMeter.done) return;
    const needle = Math.sin(kickMeter.t * kickMeter.speed);
    const good = Math.abs(needle) < kickMeter.win;
    kickMeter.done = true;
    kickMeter.good = good;
    kickMeter.needle = needle;
    Arcade.tone(good ? { freq: 523, to: 784, dur: 0.25, type: 'triangle', vol: 0.06 } : { freq: 300, to: 150, dur: 0.3, type: 'sawtooth', vol: 0.04 });
    setTimeout(() => {
      if (good) {
        us += 3;
        say(`${kickMeter.yards}-yard field goal is good!`);
        turnover(25, 'score', PLAY_TIME);
      } else {
        say('Field goal is no good');
        turnover(100 - Math.max(los - 7, 20), 'miss', PLAY_TIME);
      }
    }, 900);
  }

  // ---------- Results ----------

  function endPlay(result) {
    state = 'dead';
    deadT = 1.3;
    pending = result;
    steer = null;
    const gain = result.y !== undefined ? result.y - los : 0;
    const msgs = {
      td: 'TOUCHDOWN!',
      inc: 'Incomplete',
      int: 'Intercepted!',
      sack: `Sacked! ${Math.round(gain)} yards`,
      tackle: gain >= 0 ? `Gain of ${Math.round(gain)}` : `Loss of ${Math.round(-gain)}`,
      out: `Out of bounds. ${gain >= 0 ? 'Gain' : 'Loss'} of ${Math.abs(Math.round(gain))}`,
    };
    say(msgs[result.type], 1.3);
    if (result.type === 'td') {
      Arcade.tone({ freq: 523, dur: 0.12, type: 'triangle', vol: 0.07 });
      Arcade.tone({ freq: 659, dur: 0.12, type: 'triangle', vol: 0.07, delay: 0.12 });
      Arcade.tone({ freq: 784, dur: 0.3, type: 'triangle', vol: 0.07, delay: 0.24 });
    } else if (result.type === 'int' || result.type === 'sack') {
      Arcade.tone({ freq: 260, to: 110, dur: 0.4, type: 'sawtooth', vol: 0.05 });
    } else {
      Arcade.tone({ freq: 180, dur: 0.08, vol: 0.04 });
    }
  }

  function resolve() {
    const r = pending;
    pending = null;
    if (r.type === 'td') {
      us += 7;
      return turnover(25, 'score', PLAY_TIME);
    }
    if (r.type === 'int') return turnover(r.y >= 100 ? 20 : 100 - clamp(r.y, 1, 99), 'int', PLAY_TIME);
    if (r.type !== 'inc') {
      const y = clamp(r.y, -10, 100);
      if (y <= 0) {
        them += 2;
        say('Safety! Two points to them');
        return turnover(35, 'safety', PLAY_TIME);
      }
      los = y;
    }
    if (tick(r.type === 'inc' ? INC_TIME : PLAY_TIME)) return;
    if (los >= toGo) {
      down = 1;
      toGo = Math.min(los + 10, 100);
      presnap();
      say('First down!');
      return;
    }
    down++;
    if (down > 4) return turnover(100 - los, 'downs', 0);
    presnap();
  }

  // Runs the clock; returns true when the game just ended.
  function tick(sec) {
    if (overtime) return false;
    clock -= sec;
    while (clock <= 0 && quarter < 4) {
      quarter++;
      clock += QUARTER;
      say(quarter === 3 ? 'Halftime done. Second half!' : `End of Q${quarter - 1}`);
    }
    if (quarter === 4 && clock <= 0) {
      clock = 0;
      endRegulation();
      return true;
    }
    updateHud();
    return false;
  }

  function endRegulation() {
    if (us !== them) return finishGame();
    overtime = true;
    state = 'cpu';
    ui.show({
      title: 'Overtime',
      html: `<p class="big">${us} – ${them}</p><p>Tied at the end of regulation. Next score wins. You get the ball first.</p>`,
      button: 'Take the field',
      onAction: () => { ui.hide(); startDrive(25); },
    });
  }

  // You lose the ball; their drive is played out off-screen. `start` is where they begin,
  // measured from their own goal line.
  function turnover(start, why, sec) {
    if (overtime && us !== them) return finishGame();
    if (tick(sec)) return;
    state = 'cpu';
    const opp = team.opp.name, r = team.rating;
    const left = (4 - quarter) * QUARTER + clock;
    const dur = Arcade.rand(100, 220);
    // Short on time, they're less likely to finish the drive.
    const hurry = overtime ? 1 : clamp(left / dur, 0.2, 1);
    const pTD = clamp(0.1 + r * 0.45 + (start - 25) / 120, 0.05, 0.85) * hurry;
    const pFG = clamp(0.16 + (start - 25) / 300, 0.05, 0.4) * hurry;
    const roll = Math.random();
    let outcome, next;
    if (roll < pTD) { them += 7; outcome = 'Touchdown'; next = 25; }
    else if (roll < pTD + pFG) { them += 3; outcome = 'Field goal'; next = 25; }
    else if (roll < pTD + pFG + 0.12) { outcome = 'Interception! Your defense picks it off'; next = Arcade.randInt(30, 55); }
    else { outcome = 'Punt'; next = Arcade.randInt(12, 32); }
    const scored = outcome === 'Touchdown' || outcome === 'Field goal';
    const lead = {
      score: 'You kick off.', punt: 'They take over after your punt.', int: 'Their ball after the interception.',
      downs: 'Turnover on downs.', miss: 'They take over after the miss.', safety: 'You free kick after the safety.',
    }[why];
    const ended = !overtime && tick(dur);
    const after = () => {
      if (overtime && us !== them) return finishGame();
      ui.hide();
      startDrive(next, scored ? 'Ball on your 25 after the kickoff.' : `Ball on ${spotText(next)}.`);
    };
    if (ended) return;
    ui.show({
      title: `${esc(opp)} have the ball`,
      html: `<p>${lead} They start on their ${Math.round(start)}.</p>
        <p><b>${outcome}</b>${scored ? '' : `. Your ball on ${spotText(next)}`}</p>
        <p class="big">${ME.name} ${us} – ${them}</p><p class="muted-note">${clockText()}</p>`,
      button: overtime && us !== them ? 'See result' : 'Take the field',
      onAction: after,
    });
  }

  function finishGame() {
    state = 'over';
    const won = us > them;
    const opp = team.opp.name;
    if (won) Arcade.flag('blitz-bowl-win');
    if (won && them === 0) Arcade.flag('blitz-bowl-shutout');
    let record = '';
    if (!team.duel) {
      season.week++;
      if (won) season.wins++; else season.losses++;
      season.points += won ? 3 : 1;
      saveSeason();
      record = `Season record ${season.wins}-${season.losses} · +${won ? 3 : 1} coach points`;
    }
    Arcade.finish(ui, {
      score: us * 100 + (won ? 1500 : 0),
      title: won ? 'Victory!' : 'Defeat',
      lines: [`${ME.name} ${us} – ${them} ${esc(opp)}`, record].filter(Boolean),
      button: 'Continue',
      onAction: menu,
    });
  }

  // ---------- Update ----------

  function update(dt) {
    if (banner && (banner.t -= dt) <= 0) banner = null;
    if (state === 'live') updateLive(dt);
    if (state === 'dead' && (deadT -= dt) <= 0) resolve();
    if (state === 'kick' && !kickMeter.done) kickMeter.t += dt;

    // Camera: line of scrimmage high enough to clear the play cards, then on the ball.
    let focus = state === 'presnap' ? los - 9 : los + 9;
    if (state === 'live' || state === 'dead') {
      if (ball.state === 'air') focus = ball.from.y + (ball.to.y - ball.from.y) * Math.min(1, ball.t / ball.T) + 4;
      else if (carrier) focus = carrier.y + (runner() ? 8 : 9);
    }
    cam += (focus - cam) * Math.min(1, dt * 4);
  }

  function updateHud() {
    $('score').textContent = `${us} – ${them}`;
    $('down').textContent = state === 'kick' ? 'Kick' : downText();
    $('clock').textContent = clockText();
  }

  // ---------- Input ----------

  const toWorld = (px, py) => ({ x: (px - X0) / S, y: cam + (EYE - py) / S });
  const canvasPoint = e => {
    const r = canvas.getBoundingClientRect();
    return { px: ((e.clientX - r.left) / r.width) * W, py: ((e.clientY - r.top) / r.height) * H };
  };

  canvas.addEventListener('pointerdown', e => {
    const { px, py } = canvasPoint(e);
    if (state === 'presnap') {
      const c = cards.find(c => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h);
      c?.act();
      return;
    }
    if (state === 'kick') return kick();
    if (state !== 'live') return;
    const w = toWorld(px, py);
    if (canThrow()) throwTo(w.x, w.y);
    else steer = w;
  });
  canvas.addEventListener('pointermove', e => {
    if (!steer || state !== 'live') return;
    const { px, py } = canvasPoint(e);
    steer = toWorld(px, py);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(ev, () => { steer = null; });

  function doBurst() {
    if (state !== 'live' || !runner() || burstCool > 0) return;
    burst = 0.7;
    burstCool = 4;
    Arcade.tone({ freq: 300, to: 600, dur: 0.12, type: 'triangle', vol: 0.04 });
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (['live', 'presnap', 'kick'].includes(state)) pause();
      else if (state === 'paused') resume();
      return;
    }
    const d = Arcade.DIRS[e.code];
    if (d) held[d] = true;
    if (state === 'presnap') {
      const c = cards.find(c => e.key === c.key);
      if (c) c.act();
      return;
    }
    if (state === 'kick' && (e.code === 'Space' || e.code === 'Enter')) return kick();
    if (state === 'live') {
      if (/^Digit[1-4]$/.test(e.code)) throwToReceiver(Number(e.code.slice(5)) - 1);
      if (e.code === 'Space') doBurst();
    }
  });
  window.addEventListener('keyup', e => {
    const d = Arcade.DIRS[e.code];
    if (d) held[d] = false;
  });
  $('t-burst').addEventListener('pointerdown', e => { e.preventDefault(); doBurst(); });

  let pausedFrom = null;
  function pause() {
    if (!['live', 'presnap', 'kick'].includes(state) || (state === 'kick' && kickMeter.done)) return;
    pausedFrom = state;
    state = 'paused';
    Object.keys(held).forEach(k => { held[k] = false; });
    ui.show({ title: 'Paused', html: `<p>${ME.name} ${us} – ${them} ${esc(team.opp.name)} · ${clockText()}</p>`, button: 'Resume', onAction: resume });
  }
  function resume() {
    state = pausedFrom;
    ui.hide();
  }
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  const sx = x => X0 + x * S;
  const sy = y => EYE - (y - cam) * S;

  function drawField() {
    ctx.fillStyle = '#1f4a2c';
    ctx.fillRect(0, 0, W, H);
    // Grass stripes every 5 yards, end zones at each end.
    for (let y = -10; y < 110; y += 5) {
      const top = sy(y + 5), bot = sy(y);
      if (bot < 0 || top > H) continue;
      ctx.fillStyle = y < 0 ? '#2b3f7a' : y >= 100 ? team.opp.color : (Math.floor(y / 5) % 2 ? '#2f7a43' : '#2a6e3c');
      ctx.globalAlpha = y >= 100 ? 0.55 : 1;
      ctx.fillRect(sx(0), top, FW * S, bot - top);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx(0), sy(110), FW * S, 120 * S);
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let y = 0; y <= 100; y += 5) {
      const py = sy(y);
      if (py < -20 || py > H + 20) continue;
      ctx.strokeStyle = y % 10 === 0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(sx(0), py);
      ctx.lineTo(sx(FW), py);
      ctx.stroke();
      if (y % 10 === 0 && y > 0 && y < 100) {
        const n = String(y <= 50 ? y : 100 - y);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(n, sx(7), py - 4);
        ctx.fillText(n, sx(FW - 7), py - 4);
      }
      // Hash marks.
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let k = 1; k < 5; k++) {
        const hy = sy(y + k);
        if (y + k >= 100) break;
        ctx.fillRect(sx(FW / 2 - 9.25) - 3, hy, 6, 1);
        ctx.fillRect(sx(FW / 2 + 9.25) - 3, hy, 6, 1);
      }
    }
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(ME.name.toUpperCase(), W / 2, sy(-5) + 8);
    ctx.fillText(team.opp.name.split(' ').pop().toUpperCase(), W / 2, sy(105) + 8);
  }

  function drawPlayer(p) {
    const x = sx(p.x), y = sy(p.y);
    if (y < -20 || y > H + 20) return;
    const mine = p.side === 'off';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 3, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mine ? ME.color : team.opp.color;
    ctx.strokeStyle = mine ? ME.dark : 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (p.stun > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.fillText('✶', x, y - 9);
    }
  }

  function drawBall(x, y, h = 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx(x), sy(y) + 2, 4, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8b4a22';
    ctx.beginPath();
    ctx.ellipse(sx(x), sy(y) - h * S * 0.5, 3.5 + h * 0.04, 5 + h * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(y) - h * S * 0.5 - 2);
    ctx.lineTo(sx(x), sy(y) - h * S * 0.5 + 2);
    ctx.stroke();
  }

  function drawCards() {
    const n = cards.length, perRow = Math.min(n, 3), rows = Math.ceil(n / perRow);
    const cw = 136, ch = 50, gap = 10;
    cards.forEach((c, i) => {
      const row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, n - row * perRow);
      c.w = cw; c.h = ch;
      c.x = W / 2 - (inRow * cw + (inRow - 1) * gap) / 2 + col * (cw + gap);
      c.y = H - 16 - (rows - row) * (ch + gap) + gap;
      ctx.fillStyle = 'rgba(18,21,27,0.88)';
      ctx.strokeStyle = c.label === 'Punt' || c.label === 'Field goal' ? '#5ec8d8' : ME.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, cw, ch, 8);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#eceef2';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText(c.label, c.x + 28, c.y + 22);
      ctx.fillStyle = '#8d94a1';
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText(c.sub, c.x + 28, c.y + 38);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.fillText(c.key, c.x + 10, c.y + 30);
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eceef2';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(`${downText()} · ball on ${spotText(los)} · pick a play`, W / 2, H - 22 - rows * (ch + gap));
  }

  function drawKick() {
    const k = kickMeter, cx = W / 2, cy = 150;
    ctx.fillStyle = 'rgba(18,21,27,0.85)';
    ctx.beginPath();
    ctx.roundRect(cx - 170, cy - 70, 340, 150, 12);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eceef2';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(`${k.yards}-yard field goal`, cx, cy - 44);
    // Uprights with the good window between them.
    const half = 140;
    ctx.fillStyle = 'rgba(61,220,132,0.35)';
    ctx.fillRect(cx - half * k.win, cy - 20, half * 2 * k.win, 40);
    ctx.fillStyle = '#ffc53d';
    ctx.fillRect(cx - half * k.win - 3, cy - 30, 4, 60);
    ctx.fillRect(cx + half * k.win - 1, cy - 30, 4, 60);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(cx - half, cy - 2, half * 2, 4);
    const needle = k.done ? k.needle : Math.sin(k.t * k.speed);
    ctx.fillStyle = k.done ? (k.good ? '#3ddc84' : '#ff6b6b') : '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + needle * half, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8d94a1';
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillText(k.done ? (k.good ? "It's good!" : 'Wide!') : 'Press Space or tap when the ball is between the posts', cx, cy + 58);
  }

  function draw() {
    drawField();

    if (state !== 'menu') {
      // Line of scrimmage and the line to gain.
      ctx.fillStyle = '#4f8cff';
      ctx.fillRect(sx(0), sy(los) - 1.5, FW * S, 3);
      if (toGo < 100) {
        ctx.fillStyle = '#ffe14d';
        ctx.fillRect(sx(0), sy(toGo) - 1.5, FW * S, 3);
      }
    }

    for (const p of players) drawPlayer(p);

    if (state === 'live' || state === 'dead') {
      if (carrier && ball.state === 'held') {
        ctx.strokeStyle = burst > 0 ? '#ff6b6b' : '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx(carrier.x), sy(carrier.y), 10, 0, Math.PI * 2);
        ctx.stroke();
        drawBall(carrier.x + 0.6, carrier.y + 0.3);
      }
      if (ball.state === 'air') {
        const k = Math.min(1, ball.t / ball.T);
        const x = ball.from.x + (ball.to.x - ball.from.x) * k, y = ball.from.y + (ball.to.y - ball.from.y) * k;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(sx(ball.to.x), sy(ball.to.y), 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        drawBall(x, y, Math.sin(k * Math.PI) * ball.h);
      }
      // Receiver numbers while you can still throw.
      if (state === 'live' && canThrow()) {
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ELIGIBLE.forEach((role, i) => {
          const r = get(role);
          ctx.fillStyle = '#12151b';
          ctx.beginPath();
          ctx.arc(sx(r.x), sy(r.y) - 14, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = ME.color;
          ctx.fillText(i + 1, sx(r.x), sy(r.y) - 10);
        });
      }
    } else if (state === 'presnap') {
      drawBall(FW / 2, los);
    }

    if (state === 'presnap') drawCards();
    if (state === 'kick') drawKick();

    if (state === 'live' && burstCool > 0 && runner()) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(W - 96, H - 26, 80, 8);
      ctx.fillStyle = burst > 0 ? '#ff6b6b' : '#8d94a1';
      ctx.fillRect(W - 96, H - 26, 80 * (1 - burstCool / 4), 8);
    }

    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t * 3);
      ctx.fillStyle = 'rgba(18,21,27,0.8)';
      ctx.fillRect(0, 56, W, 40);
      ctx.fillStyle = banner.text === 'TOUCHDOWN!' ? ME.color : '#eceef2';
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(banner.text, W / 2, 83);
      ctx.globalAlpha = 1;
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state !== 'menu' && state !== 'paused' && state !== 'over' && state !== 'cpu') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- Menu ----------

  function seasonHtml() {
    const opp = opponentFor(season.week);
    return `<p>Week ${season.week} vs <b style="color:${opp.color}">${esc(opp.name)}</b> · record ${season.wins}-${season.losses}
      <button class="chip" type="button" data-reset>New season</button></p>
      <p class="muted-note" style="margin:0 0 6px">Coach points: <b>${season.points}</b>. Spend them on your team (cost = next level).</p>
      <div class="menu">${UPGRADES.map(u => {
        const lvl = season[u.id], cost = lvl + 1, can = lvl < MAX_LEVEL && season.points >= cost;
        return `<div class="row" style="justify-content:space-between;align-items:center;gap:8px">
          <span style="text-align:left"><b>${u.name}</b> ${'●'.repeat(lvl)}${'○'.repeat(MAX_LEVEL - lvl)}<br><span class="muted-note">${u.desc}</span></span>
          <button class="btn secondary" type="button" data-up="${u.id}" ${can ? '' : 'disabled'}>${lvl >= MAX_LEVEL ? 'Max' : `+1 (${cost})`}</button></div>`;
      }).join('')}</div>`;
  }

  function wireSeason(panel) {
    const box = panel.querySelector('[data-season]');
    const render = () => {
      box.innerHTML = seasonHtml();
      box.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.up, cost = season[id] + 1;
        if (season[id] >= MAX_LEVEL || season.points < cost) return;
        season.points -= cost;
        season[id]++;
        saveSeason();
        Arcade.tone({ freq: 600, to: 900, dur: 0.12, type: 'triangle', vol: 0.05 });
        render();
      }));
      box.querySelector('[data-reset]').addEventListener('click', () => {
        if (!confirm('Start a new season? Your record and upgrades reset.')) return;
        season = freshSeason();
        saveSeason();
        render();
      });
    };
    render();
  }

  const duelOpts = {
    ui,
    start: () => { ui.hide(); newGame(); },
    score: () => us * 100 + (us > them && state === 'over' ? 1500 : 0),
    intro: {
      title: 'Blitz Bowl',
      html: `<ul>
          <li>Call a play, then drop back with <kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd>.</li>
          <li>Click or tap a spot to throw there, or press <kbd>1</kbd>–<kbd>4</kbd> to hit a receiver in stride.</li>
          <li>After the catch, steer with the arrows or hold a finger where you want to run. <kbd>Space</kbd> bursts and breaks tackles.</li>
        </ul><div data-season></div>`,
      button: 'Kick off',
      onAction: () => { ui.hide(); newGame(); },
      onRender: wireSeason,
    },
  };
  // Versus.attach shows the start panel (with its online duel button), so it doubles as "back to menu".
  function menu() {
    state = 'menu';
    team = teamSheet();
    los = 25;
    players = [];
    Versus.attach(duelOpts);
  }

  us = them = 0;
  toGo = 35;
  menu();
  requestAnimationFrame(frame);
})();
