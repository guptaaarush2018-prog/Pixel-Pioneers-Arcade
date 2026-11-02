(() => {
  const W = 960, H = 540;
  const L = 50, R = 910, T = 78, B = 508, CR = 92;   // the rink and its corner radius
  const MID_Y = (T + B) / 2;
  const GOAL_X = [L + 72, R - 72];                    // goal lines: team 0 defends the left one
  const MOUTH = 38, NET_D = 24;                       // half the goal mouth, depth of the net
  const BLUE = [W / 2 - 150, W / 2 + 150];
  const PR = 12, PUCK_R = 5;
  const ACCEL = 620, TOP = 215, BURST = 300, GLIDE = 0.55;
  const PERIOD = 60, OT = 60;
  const STEP = 1 / 60;
  // Test hook: #autopilot lets the bot play your team too, at six times speed, and posts no score.
  const AUTOPILOT = location.hash === '#autopilot';
  const ME = { name: 'Pioneers', color: '#ffc53d', dark: '#4a3608', num: '#1c1500' };
  const RIVALS = [
    { name: 'Glacier Wolves', color: '#4f8cff', dark: '#10244a', num: '#ffffff' },
    { name: 'Harbor Sharks', color: '#2ec4b6', dark: '#0d3b37', num: '#ffffff' },
    { name: 'Crimson Owls', color: '#ff5d5d', dark: '#4a1010', num: '#ffffff' },
    { name: 'Midnight Moose', color: '#7a6cff', dark: '#1e1850', num: '#ffffff' },
    { name: 'Summit Bears', color: '#e6e9ef', dark: '#3a3f4a', num: '#1b1e24' },
  ];
  const LEVELS = [
    { name: 'Easy', speed: 0.82, think: 0.5, save: 0.55, steal: 0.8, aim: 0.22, mult: 1 },
    { name: 'Normal', speed: 0.93, think: 0.32, save: 0.68, steal: 1.4, aim: 0.14, mult: 1.5 },
    { name: 'Hard', speed: 1.02, think: 0.2, save: 0.78, steal: 2.1, aim: 0.08, mult: 2.2 },
  ];
  // Where each skater lines up and drifts back to: [x along their attack, y offset].
  const SPOTS = [{ role: 'C', x: 0.55, y: 0 }, { role: 'W', x: 0.4, y: -0.6 }, { role: 'D', x: 0.18, y: 0.45 }];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const rinkLayer = Arcade.makeLayer(W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const len = (x, y) => Math.hypot(x, y);
  const fx = Sports.particles();
  const shake = Sports.shaker();
  const crowd = Sports.makeCrowd(W, T - 22, { seed: 11, size: 6.5, colors: ['#ffc53d', '#ffc53d', '#4f8cff', '#e6e9ef', '#ff5d5d', '#2b3247', '#ffc53d'] });

  let state = 'menu';  // menu | faceoff | playing | goal | intermission | paused | over
  let level = Arcade.load('ice:level', 1), L8 = LEVELS[level];
  let g = null, rival = RIVALS[0];
  let excite = 0, lamp = [0, 0];

  // ---------- Setup ----------

  function newGame() {
    rival = Arcade.pick(RIVALS);
    L8 = LEVELS[level];
    g = {
      period: 1, time: PERIOD, ot: false, score: [0, 0], myGoals: 0, shots: [0, 0],
      players: [], puck: { x: W / 2, y: MID_Y, vx: 0, vy: 0, owner: null, last: -1, grace: 0, block: null, blockT: 0, trail: [] },
      ctrl: 0, wait: 0, banner: null, events: [], drop: 0,
    };
    for (const team of [0, 1]) {
      SPOTS.forEach((s, i) => g.players.push({ team, i: g.players.length, role: s.role, spot: s, x: 0, y: 0, vx: 0, vy: 0, dir: team ? Math.PI : 0, stun: 0, check: 0, burst: 1, think: Math.random() * 0.3, aim: null, stride: Math.random() * 6, charge: 0, held: false }));
      g.players.push({ team, i: g.players.length, role: 'G', x: GOAL_X[team] + (team ? -14 : 14), y: MID_Y, vx: 0, vy: 0, dir: team ? Math.PI : 0, stun: 0, check: 0, burst: 1, hold: 0, stride: 0, dive: 0 });
    }
    fx.clear();
    faceoff();
  }

  const team = t => g.players.filter(p => p.team === t);
  const skaters = t => team(t).filter(p => p.role !== 'G');
  const goalie = t => team(t).find(p => p.role === 'G');
  const attackDir = t => (t === 0 ? 1 : -1);
  const me = () => g.players[g.ctrl];

  function faceoff() {
    const p = g.puck;
    Object.assign(p, { x: W / 2, y: MID_Y, vx: 0, vy: 0, owner: null, block: null, grace: 0, trail: [] });
    for (const q of g.players) {
      q.vx = q.vy = 0;
      q.stun = q.check = q.charge = 0;
      q.held = false;
      q.burst = 1;
      if (q.role === 'G') { q.x = GOAL_X[q.team] + (q.team ? -14 : 14); q.y = MID_Y; q.hold = 0; continue; }
      const d = attackDir(q.team);
      if (q.role === 'C') { q.x = W / 2 - d * 22; q.y = MID_Y; }
      else { q.x = W / 2 - d * (q.role === 'W' ? 90 : 210); q.y = MID_Y + q.spot.y * 150; }
      q.dir = q.team ? Math.PI : 0;
    }
    g.ctrl = skaters(0).find(q => q.role === 'C').i;
    state = 'faceoff';
    g.drop = 1.2;
    g.banner = { text: g.ot ? 'Sudden death!' : g.period > 1 && g.time === PERIOD ? `Period ${g.period}` : 'Face-off', t: 1.2 };
  }

  // ---------- Rink geometry ----------

  // Keeps a circle of radius r inside the rounded rink, bouncing its velocity off the boards.
  function boards(o, r, bounce) {
    let hit = 0;
    const cx = clamp(o.x, L + CR, R - CR), cy = clamp(o.y, T + CR, B - CR);
    const inCorner = (o.x < L + CR || o.x > R - CR) && (o.y < T + CR || o.y > B - CR);
    if (inCorner) {
      const dx = o.x - cx, dy = o.y - cy, d = len(dx, dy);
      if (d > CR - r) {
        const nx = dx / d, ny = dy / d;
        o.x = cx + nx * (CR - r);
        o.y = cy + ny * (CR - r);
        const vn = o.vx * nx + o.vy * ny;
        if (vn > 0) { o.vx -= (1 + bounce) * vn * nx; o.vy -= (1 + bounce) * vn * ny; hit = vn; }
      }
    } else {
      if (o.x < L + r) { hit = Math.max(hit, -o.vx); o.x = L + r; o.vx = Math.abs(o.vx) * bounce; }
      if (o.x > R - r) { hit = Math.max(hit, o.vx); o.x = R - r; o.vx = -Math.abs(o.vx) * bounce; }
      if (o.y < T + r) { hit = Math.max(hit, -o.vy); o.y = T + r; o.vy = Math.abs(o.vy) * bounce; }
      if (o.y > B - r) { hit = Math.max(hit, o.vy); o.y = B - r; o.vy = -Math.abs(o.vy) * bounce; }
    }
    return hit;
  }

  // Nets are solid from the sides and back; only the mouth lets the puck in.
  function nets(o, r, puck = false) {
    for (const t of [0, 1]) {
      const gx = GOAL_X[t], back = gx - attackDir(t) * NET_D;
      const x0 = Math.min(gx, back) - r, x1 = Math.max(gx, back) + r;
      const y0 = MID_Y - MOUTH - r, y1 = MID_Y + MOUTH + r;
      if (o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1) continue;
      // The puck may slide in through the mouth; the goal check takes it from there.
      if (puck && Math.abs(o.y - MID_Y) < MOUTH - r) continue;
      const outs = [
        { d: o.x - x0, ax: 'x', v: x0 },
        { d: x1 - o.x, ax: 'x', v: x1 },
        { d: o.y - y0, ax: 'y', v: y0 },
        { d: y1 - o.y, ax: 'y', v: y1 },
      ].sort((a, b) => a.d - b.d);
      const o1 = outs[0];
      o[o1.ax] = o1.v;
      if (o1.ax === 'x') o.vx = -o.vx * 0.4; else o.vy = -o.vy * 0.4;
      return true;
    }
    return false;
  }

  // ---------- Puck ----------

  function shoot(p, power) {
    const pk = g.puck, t = p.team, gx = GOAL_X[1 - t];
    // Aim: towards the far side of the net from the goalie, with error that grows with power.
    const gk = goalie(1 - t);
    const far = gk.y < MID_Y ? 1 : -1;
    const human = p.team === 0 && p.i === g.ctrl;
    let tx = gx, ty = MID_Y + far * (MOUTH - 8);
    const toGoal = Math.atan2(ty - p.y, tx - p.x);
    // You shoot where you're facing; the assist only nudges it towards the net when you face it.
    let a = p.dir;
    let diff = Math.atan2(Math.sin(toGoal - a), Math.cos(toGoal - a));
    if (Math.abs(diff) < 0.9) a += diff * (human ? 0.85 : 1);
    const err = (human ? 0.05 : L8.aim) + power * 0.07;
    a += Arcade.rand(-err, err);
    const speed = 430 + power * 520;
    release(p, Math.cos(a) * speed, Math.sin(a) * speed);
    g.events.push(power > 0.6 ? 'slap' : 'wrist');
    if (power > 0.6) shake.kick(3);
    const toward = (Math.cos(a) * attackDir(t)) > 0.3;
    if (toward) g.shots[t]++;
    pk.shot = { team: t, by: p.i, fast: speed > 700 };
  }

  function pass(p) {
    const mates = skaters(p.team).filter(q => q !== p && q.stun <= 0);
    // The best target is open and roughly where you're facing.
    let best = null, bestS = -1e9;
    for (const q of mates) {
      const dx = q.x - p.x, dy = q.y - p.y, d = len(dx, dy);
      const facing = Math.cos(Math.atan2(dy, dx) - p.dir);
      const open = Math.min(...skaters(1 - p.team).map(o => segDist(o.x, o.y, p.x, p.y, q.x, q.y)));
      const s = facing * 120 + Math.min(open, 60) * 2 - d * 0.15 + (q.x - p.x) * attackDir(p.team) * 0.2;
      if (s > bestS) { bestS = s; best = q; }
    }
    if (!best) return;
    const d = len(best.x - p.x, best.y - p.y), speed = clamp(d * 2.2, 360, 640);
    const lead = d / speed;
    const tx = best.x + best.vx * lead * 0.8, ty = best.y + best.vy * lead * 0.8;
    const a = Math.atan2(ty - p.y, tx - p.x);
    release(p, Math.cos(a) * speed, Math.sin(a) * speed);
    g.events.push('pass');
    if (p.team === 0) g.ctrl = best.i;
  }

  function release(p, vx, vy) {
    const pk = g.puck;
    pk.owner = null;
    pk.vx = vx;
    pk.vy = vy;
    pk.block = p;
    pk.blockT = 0.18;
    pk.shot = null;
  }

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const k = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    return len(px - ax - dx * k, py - ay - dy * k);
  }

  function updatePuck(dt) {
    const pk = g.puck;
    pk.blockT -= dt;
    pk.grace -= dt;
    if (pk.blockT <= 0) pk.block = null;
    if (pk.owner) {
      const o = pk.owner;
      const reach = PR + 7;
      // Dangle the puck a little side to side while skating.
      const wob = Math.sin(o.stride * 1.2) * 4;
      pk.x = o.x + Math.cos(o.dir) * reach - Math.sin(o.dir) * wob;
      pk.y = o.y + Math.sin(o.dir) * reach + Math.cos(o.dir) * wob;
      pk.vx = o.vx;
      pk.vy = o.vy;
      pk.trail.length = 0;
      return;
    }
    const px = pk.x, py = pk.y;
    // Sub-steps so a slapshot can't jump through a goalie or a post.
    const n = Math.ceil(len(pk.vx, pk.vy) * dt / 4) || 1;
    for (let s = 0; s < n; s++) {
      pk.x += pk.vx * dt / n;
      pk.y += pk.vy * dt / n;
      if (checkGoal(px, py)) return;
      const hit = boards(pk, PUCK_R, 0.72);
      if (hit > 120) g.events.push('boards');
      if (nets(pk, PUCK_R, true)) g.events.push('post');
      if (goalieSave()) break;
    }
    const f = Math.pow(0.62, dt);
    pk.vx *= f;
    pk.vy *= f;
    const sp = len(pk.vx, pk.vy);
    if (sp > 520) { pk.trail.push([pk.x, pk.y]); if (pk.trail.length > 8) pk.trail.shift(); }
    else if (pk.trail.length) pk.trail.shift();
  }

  function checkGoal(px, py) {
    const pk = g.puck;
    for (const t of [0, 1]) {
      const gx = GOAL_X[t], d = attackDir(t);
      // Crossed this goal line, heading into the net, inside the mouth.
      const before = (px - gx) * d, after = (pk.x - gx) * d;
      if (before >= 0 && after < 0 && Math.abs(pk.y - MID_Y) < MOUTH - PUCK_R + 1) {
        scored(1 - t);
        return true;
      }
    }
    return false;
  }

  // A shot reaching the goalie may be saved; saves either smother or kick out a rebound.
  function goalieSave() {
    const pk = g.puck;
    for (const t of [0, 1]) {
      const gk = goalie(t);
      if (pk.block === gk) continue;
      const reach = PR + PUCK_R + 6 + (gk.dive > 0 ? 10 : 0);
      if (len(pk.x - gk.x, pk.y - gk.y) > reach) continue;
      const sp = len(pk.vx, pk.vy);
      if (sp < 200) {
        pk.owner = gk;
        gk.hold = 0.7;
        pk.last = t;
        g.events.push('glove');
        return true;
      }
      // Human goalies use the bot's save rate at Normal; yours stays steady at every level.
      const base = t === 1 ? L8.save : 0.72;
      const chance = clamp(base - (sp - 500) / 2200 - (gk.dive > 0 ? 0 : 0.05), 0.2, 0.95);
      if (Math.random() < chance) {
        if (Math.random() < 0.35 && sp < 800) {
          pk.owner = gk;
          gk.hold = 0.9;
        } else {
          const a = Math.atan2(pk.y - gk.y, pk.x - gk.x);
          const out = attackDir(t);
          pk.vx = Math.abs(Math.cos(a)) * out * sp * 0.35 + out * 60;
          pk.vy = Math.sin(a) * sp * 0.35 + Arcade.rand(-90, 90);
          pk.block = gk;
          pk.blockT = 0.25;
        }
        pk.last = t;
        g.events.push('save');
        fx.spray(gk.x, gk.y, Math.atan2(pk.vy, pk.vx), 10);
        return true;
      }
      pk.block = gk;
      pk.blockT = 0.3;
    }
    return false;
  }

  function scored(t) {
    g.score[t]++;
    const pk = g.puck;
    if (t === 0 && pk.shot?.team === 0 && pk.shot.by === g.ctrl) g.myGoals++;
    pk.vx *= 0.2;
    pk.vy *= 0.2;
    lamp[1 - t] = 3;
    state = 'goal';
    g.wait = 2.6;
    g.banner = { text: t === 0 ? 'GOAL!' : `${rival.name.split(' ').pop()} score`, t: 2.6, team: t };
    g.events.push(t === 0 ? 'goal' : 'against');
    const gx = GOAL_X[1 - t];
    fx.confetti(gx, MID_Y, t === 0 ? 90 : 30, t === 0 ? [ME.color, '#ffffff', '#ff5d5d'] : [rival.color, '#ffffff']);
    if (t === 0) { excite = 1; shake.kick(8); }
  }

  // ---------- Skaters ----------

  function skate(p, ax, ay, dt, top) {
    // Steer towards a target velocity with limited acceleration; ice keeps you gliding.
    const want = len(ax, ay);
    const tx = want ? (ax / want) * top : 0, ty = want ? (ay / want) * top : 0;
    const dx = tx - p.vx, dy = ty - p.vy, d = len(dx, dy);
    const acc = (want ? ACCEL : ACCEL * GLIDE * 0.5) * dt;
    if (d <= acc) { p.vx = tx; p.vy = ty; }
    else { p.vx += (dx / d) * acc; p.vy += (dy / d) * acc; }
    // Hard stops and turns throw up snow.
    if (want && d > top * 1.3 && len(p.vx, p.vy) > 120 && Math.random() < 0.5) {
      fx.spray(p.x, p.y + 6, Math.atan2(-p.vy, -p.vx), 2);
      if (Math.random() < 0.08) g.events.push('scrape');
    }
    const sp = len(p.vx, p.vy);
    if (sp > 25) {
      const a = Math.atan2(p.vy, p.vx);
      const turn = Math.atan2(Math.sin(a - p.dir), Math.cos(a - p.dir));
      p.dir += turn * Math.min(1, dt * 10);
    }
    p.stride += sp * dt / 14;
  }

  function moveTo(p, x, y, dt, top) {
    const dx = x - p.x, dy = y - p.y, d = len(dx, dy);
    if (d < 8) return skate(p, 0, 0, dt, top);
    // Ease off on arrival.
    skate(p, dx, dy, dt, Math.min(top, d * 3 + 30));
  }

  function updateSkater(p, dt) {
    const pk = g.puck;
    if (p.stun > 0) {
      p.stun -= dt;
      p.vx *= Math.pow(0.3, dt);
      p.vy *= Math.pow(0.3, dt);
    } else if (p.check > 0) {
      p.check -= dt;
    } else if (p.team === 0 && p.i === g.ctrl && !AUTOPILOT) {
      human(p, dt);
    } else {
      ai(p, dt);
    }
    p.burst = clamp(p.burst + dt * 0.25, 0, 1);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (boards(p, PR, 0.3) > 160) { g.events.push('boards'); shake.kick(2); }
    nets(p, PR);

    // Pick up a loose puck.
    if (!pk.owner && pk.block !== p && p.stun <= 0 && len(pk.x - p.x, pk.y - p.y) < PR + PUCK_R + 6) {
      const sp = len(pk.vx - p.vx, pk.vy - p.vy);
      // Fast pucks are hard to corral.
      if (sp < 380 || Math.random() < 0.35) {
        pk.owner = p;
        pk.last = p.team;
        pk.grace = 0.45;
        pk.shot = null;
        if (p.team === 0) g.ctrl = p.i;
        g.events.push('catch');
      } else {
        pk.vx *= 0.5;
        pk.vy *= 0.5;
        pk.block = p;
        pk.blockT = 0.15;
      }
    }
    // Stick checks: a defender close to the puck can poke it away.
    if (pk.owner && pk.owner.team !== p.team && pk.owner.role !== 'G' && pk.grace <= 0 && p.stun <= 0) {
      const d = len(pk.x - p.x, pk.y - p.y);
      const rate = p.team === 0 ? 2.6 : L8.steal;
      if (d < PR + 12 && Math.random() < rate * dt) knockLoose(pk.owner, p, 0.25);
    }
  }

  // Body checks knock the carrier off the puck and flat for a moment.
  function knockLoose(carrier, by, stun) {
    const pk = g.puck;
    pk.owner = null;
    const a = Math.atan2(carrier.y - by.y, carrier.x - by.x) + Arcade.rand(-0.9, 0.9);
    pk.vx = Math.cos(a) * 160 + by.vx * 0.4;
    pk.vy = Math.sin(a) * 160 + by.vy * 0.4;
    pk.block = carrier;
    pk.blockT = 0.4;
    carrier.stun = stun;
    g.events.push('steal');
  }

  function human(p, dt) {
    const inp = input;
    const pk = g.puck;
    let mx = clamp(inp.mx, -1, 1), my = clamp(inp.my, -1, 1);
    const bursting = inp.burst && p.burst > 0.05 && (mx || my);
    if (bursting) p.burst = Math.max(0, p.burst - dt * 0.8);
    skate(p, mx, my, dt, (bursting ? BURST : TOP) * (pk.owner === p ? 0.92 : 1));
    // Hold to wind up a slapshot, tap for a wrist shot. Without the puck: a body check.
    if (inp.shoot) p.charge = Math.min(1, p.charge + dt / 0.8);
    if (p.held && !inp.shoot) {
      if (pk.owner === p) shoot(p, p.charge);
      else bodyCheck(p);
      p.charge = 0;
    }
    p.held = inp.shoot;
    if (inp.pass !== inp.seenPass) {
      inp.seenPass = inp.pass;
      if (pk.owner === p) pass(p);
      else switchPlayer();
    }
  }

  function bodyCheck(p) {
    if (p.check > 0) return;
    const sp = 330;
    p.vx = Math.cos(p.dir) * sp;
    p.vy = Math.sin(p.dir) * sp;
    p.check = 0.28;
    g.events.push('whoosh');
  }

  function switchPlayer() {
    const pk = g.puck;
    const options = skaters(0).filter(q => q.i !== g.ctrl).sort((a, b) => len(a.x - pk.x, a.y - pk.y) - len(b.x - pk.x, b.y - pk.y));
    if (options[0]) { g.ctrl = options[0].i; g.events.push('switch'); }
  }

  // Bot skaters: carry and shoot, support the carrier, or defend between the puck and the net.
  function ai(p, dt) {
    const pk = g.puck, t = p.team, d = attackDir(t);
    const top = TOP * (t === 1 ? L8.speed : 0.95);
    const gx = GOAL_X[1 - t], own = GOAL_X[t];
    const mine = pk.owner && pk.owner.team === t;
    p.think -= dt;
    if (pk.owner === p) {
      // Skate at the net, weaving away from the nearest defender.
      const foes = skaters(1 - t);
      const near = foes.reduce((a, b) => (len(b.x - p.x, b.y - p.y) < len(a.x - p.x, a.y - p.y) ? b : a));
      const nd = len(near.x - p.x, near.y - p.y);
      const ty = MID_Y + clamp(p.y - near.y, -1, 1) * 70;
      moveTo(p, gx - d * 60, ty, dt, top * 0.92);
      const dist = len(gx - p.x, MID_Y - p.y);
      const angle = Math.abs(p.y - MID_Y) / Math.max(1, Math.abs(gx - p.x));
      if (p.think <= 0) {
        p.think = (t === 1 ? L8.think : 0.3) * Arcade.rand(0.6, 1.4);
        if (dist < 280 && angle < 1.1 && (p.x - gx) * d < -30) {
          p.dir = Math.atan2(MID_Y - p.y, gx - p.x);
          shoot(p, dist > 180 ? Arcade.rand(0.6, 1) : Arcade.rand(0.1, 0.5));
        } else if (nd < 50 && Math.random() < 0.55) {
          pass(p);
        }
      }
      return;
    }
    if (mine) {
      // Support: spread out ahead of the carrier.
      const c = pk.owner;
      const lane = p.spot.y || (p.y < MID_Y ? -0.5 : 0.5);
      const tx = clamp(c.x + d * (p.role === 'D' ? -90 : 110), L + 80, R - 80);
      const ty = MID_Y + lane * 150 + Math.sin(g.time * 0.8 + p.i) * 30;
      return moveTo(p, tx, ty, dt, top * 0.9);
    }
    // Defend. The skater nearest the puck chases it; the others cover the slot.
    const chaser = skaters(t).filter(q => !(q.team === 0 && q.i === g.ctrl)).sort((a, b) => len(a.x - pk.x, a.y - pk.y) - len(b.x - pk.x, b.y - pk.y))[0];
    if (chaser === p) {
      const lead = 0.25;
      const tx = pk.x + pk.vx * lead, ty = pk.y + pk.vy * lead;
      moveTo(p, tx, ty, dt, top);
      if (pk.owner && pk.owner.team !== t && len(pk.owner.x - p.x, pk.owner.y - p.y) < 46 && p.think <= 0 && Math.random() < 0.4) {
        p.think = 0.8;
        p.dir = Math.atan2(pk.owner.y - p.y, pk.owner.x - p.x);
        bodyCheck(p);
      }
      return;
    }
    const k = p.role === 'D' ? 0.35 : 0.6;
    const tx = own + (pk.x - own) * k, ty = MID_Y + (pk.y - MID_Y) * k + (p.role === 'D' ? 30 : -30);
    moveTo(p, tx, ty, dt, top * 0.85);
  }

  function updateGoalie(p, dt) {
    const pk = g.puck, t = p.team, d = attackDir(t), gx = GOAL_X[t];
    p.dive = Math.max(0, p.dive - dt);
    if (pk.owner === p) {
      p.hold -= dt;
      if (p.hold <= 0) {
        // Clear it to the most open teammate.
        p.dir = d > 0 ? 0 : Math.PI;
        pass(p);
        if (pk.owner === p) release(p, d * 380, Arcade.rand(-150, 150));
      }
      return;
    }
    // Slide across the crease to cut down the angle, and dive at fast shots.
    const ty = clamp(MID_Y + (pk.y - MID_Y) * 0.55, MID_Y - MOUTH + 4, MID_Y + MOUTH - 4);
    const tx = gx + d * (14 + clamp(Math.abs(pk.x - gx) < 300 ? 10 : 4, 0, 14));
    const sp = len(pk.vx, pk.vy);
    const incoming = !pk.owner && sp > 400 && (pk.vx * d) < 0 && Math.abs(pk.x - gx) < 280;
    if (incoming && p.dive <= 0) {
      const tHit = Math.abs((pk.x - gx) / (pk.vx || 1));
      const yHit = pk.y + pk.vy * tHit;
      if (Math.abs(yHit - p.y) > 10 && Math.abs(yHit - MID_Y) < MOUTH + 10) {
        p.dive = 0.35;
        p.vy = clamp((yHit - p.y) / 0.18, -420, 420);
      }
    }
    if (p.dive <= 0) {
      const top = 170;
      p.vy = clamp((ty - p.y) * 8, -top, top);
      p.vx = clamp((tx - p.x) * 8, -top, top);
    }
    p.x += p.vx * dt;
    p.y = clamp(p.y + p.vy * dt, MID_Y - MOUTH - 6, MID_Y + MOUTH + 6);
    p.dir = Math.atan2(pk.y - p.y, pk.x - p.x);
  }

  // Skaters bump off each other; a body check at speed flattens whoever it hits.
  function collide() {
    const ps = g.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy);
        if (d >= PR * 2 || d === 0) continue;
        const nx = dx / d, ny = dy / d, push = (PR * 2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        for (const [hitter, hit] of [[a, b], [b, a]]) {
          if (hitter.check > 0 && hit.team !== hitter.team && hit.stun <= 0) {
            hit.stun = hit.role === 'G' ? 0.4 : 0.9;
            hit.vx = hitter.vx * 0.8;
            hit.vy = hitter.vy * 0.8;
            hitter.vx *= 0.3;
            hitter.vy *= 0.3;
            hitter.check = 0;
            if (g.puck.owner === hit) knockLoose(hit, hitter, 0.9);
            g.events.push('hit');
            shake.kick(6);
            fx.spray((a.x + b.x) / 2, (a.y + b.y) / 2, Math.atan2(ny, nx), 14);
          }
        }
      }
    }
  }

  // ---------- Simulation ----------

  function step(dt) {
    if (state === 'faceoff') {
      g.drop -= dt;
      if (g.drop <= 0) {
        state = 'playing';
        g.puck.vx = Arcade.rand(-40, 40);
        g.puck.vy = Arcade.rand(-90, 90);
        g.events.push('drop');
      }
      return;
    }
    if (state === 'goal') {
      g.wait -= dt;
      g.puck.x += g.puck.vx * dt;
      g.puck.y += g.puck.vy * dt;
      for (const p of g.players) { p.vx *= 0.97; p.vy *= 0.97; p.x += p.vx * dt; p.y += p.vy * dt; boards(p, PR, 0.3); }
      if (g.wait <= 0) {
        if (g.ot) return endGame();
        faceoff();
      }
      return;
    }
    if (state !== 'playing') return;
    for (const p of g.players) {
      if (p.role === 'G') updateGoalie(p, dt);
      else updateSkater(p, dt);
    }
    collide();
    updatePuck(dt);
    if (state !== 'playing') return;

    g.time -= dt;
    if (g.time <= 0) {
      g.time = 0;
      g.events.push('horn');
      if (g.ot) return endGame();
      if (g.period < 3) {
        g.period++;
        g.time = PERIOD;
        state = 'intermission';
        g.wait = 1.6;
        g.banner = { text: `End of period ${g.period - 1}`, t: 1.6 };
      } else if (g.score[0] === g.score[1]) {
        g.ot = true;
        g.time = OT;
        state = 'intermission';
        g.wait = 1.6;
        g.banner = { text: 'Tied! Overtime', t: 1.6 };
      } else endGame();
    }
  }

  function endGame() {
    state = 'over';
    Sports.stopCrowd();
    const [a, b] = g.score;
    const won = a > b, tie = a === b;
    if (won) Sports.sfx.win(); else Sports.sfx.lose();
    if (won) Arcade.flag('ice-clash-win');
    if (won && level === 2) Arcade.flag('ice-clash-hard');
    if (g.myGoals >= 3) Arcade.flag('ice-clash-hat');
    const score = AUTOPILOT ? 0 : Math.max(0, Math.round(((won ? 500 : tie ? 150 : 0) + a * 120 - b * 40 + g.shots[0] * 5) * L8.mult));
    Arcade.finish(ui, {
      score,
      title: won ? 'You win!' : tie ? 'Tie game' : `${rival.name} win`,
      lines: [`${ME.name} ${a} – ${b} ${rival.name}`, `Shots ${g.shots[0]} – ${g.shots[1]} · your goals ${g.myGoals}${g.myGoals >= 3 ? ' · hat trick!' : ''}`],
      button: 'Play again',
      onAction: () => { ui.hide(); start(); },
    });
  }

  // ---------- Input ----------

  const keys = {};
  const input = { mx: 0, my: 0, burst: false, shoot: false, pass: 0, seenPass: 0 };
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'paused') resume(); else pause();
      return;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && state !== 'menu' && state !== 'over') e.preventDefault();
    if ((e.code === 'KeyZ' || e.code === 'KeyC') && !e.repeat) input.pass++;
    readKeys();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; readKeys(); });
  function readKeys() {
    input.mx = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0) + touch.mx;
    input.my = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0) + touch.my;
    input.burst = !!(keys.ShiftLeft || keys.ShiftRight) || touch.burst;
    input.shoot = !!(keys.Space || keys.KeyX) || touch.shoot;
  }
  // Touch: drag on the rink to skate; buttons for the rest.
  const touch = { mx: 0, my: 0, burst: false, shoot: false, id: null, sx: 0, sy: 0 };
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    touch.id = e.pointerId;
    touch.sx = e.clientX;
    touch.sy = e.clientY;
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== touch.id) return;
    const dx = e.clientX - touch.sx, dy = e.clientY - touch.sy, d = len(dx, dy);
    touch.mx = d > 8 ? dx / Math.max(d, 40) : 0;
    touch.my = d > 8 ? dy / Math.max(d, 40) : 0;
    readKeys();
  });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, e => {
    if (e.pointerId !== touch.id) return;
    touch.id = null;
    touch.mx = touch.my = 0;
    readKeys();
  });
  function hold(id, on, off) {
    const el = $(id);
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); on(); readKeys(); });
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { off(); readKeys(); });
  }
  hold('t-burst', () => { touch.burst = true; }, () => { touch.burst = false; });
  hold('t-pass', () => { input.pass++; }, () => {});
  hold('t-shoot', () => { touch.shoot = true; }, () => { touch.shoot = false; });

  // ---------- Sound ----------

  function sounds(events) {
    const S = Sports.sfx;
    for (const e of events) {
      if (e === 'slap') { S.crack(); }
      else if (e === 'wrist' || e === 'pass') S.clack(e === 'pass' ? 0.7 : 1);
      else if (e === 'boards') S.boards();
      else if (e === 'post') S.clank();
      else if (e === 'save' || e === 'glove') { S.pop(); if (e === 'save') Sports.excite(0.4, 1.2); }
      else if (e === 'hit') { S.thud(1.2); Sports.excite(0.5, 1.5); }
      else if (e === 'steal' || e === 'catch') S.clack(0.5);
      else if (e === 'scrape') S.scrape();
      else if (e === 'whoosh') Sports.noise(0.15, { vol: 0.05, from: 1500, to: 600, type: 'bandpass' });
      else if (e === 'drop') S.whistle();
      else if (e === 'switch') S.select();
      else if (e === 'goal') { S.horn(); S.cheer(1.5); }
      else if (e === 'against') { S.groan(); }
      else if (e === 'horn') S.buzzer();
    }
  }

  // ---------- Flow ----------

  function start() {
    ui.hide();
    Arcade.countPlay();
    newGame();
    excite = 0;
    Sports.startCrowd();
    Sports.sfx.whistle();
  }

  function pause() {
    if (state === 'menu' || state === 'over' || state === 'paused') return;
    pause.was = state;
    state = 'paused';
    ui.show({ title: 'Paused', html: `<p>${ME.name} ${g.score[0]} – ${g.score[1]} ${rival.name}</p>`, button: 'Resume', onAction: resume });
  }
  function resume() {
    state = pause.was || 'playing';
    ui.hide();
  }
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function rinkPath(c, inset = 0) {
    c.beginPath();
    c.roundRect(L + inset, T + inset, R - L - inset * 2, B - T - inset * 2, CR - inset);
  }

  function renderRink() {
    const c = rinkLayer.ctx;
    // Arena behind the boards.
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#141826');
    bg.addColorStop(1, '#0d1018');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    // Ice: cool white with faint skate scratches.
    rinkPath(c);
    const ice = c.createLinearGradient(0, T, 0, B);
    ice.addColorStop(0, '#eef6fb');
    ice.addColorStop(0.5, '#ffffff');
    ice.addColorStop(1, '#e3eef6');
    c.fillStyle = ice;
    c.fill();
    c.save();
    rinkPath(c);
    c.clip();
    const rnd = Sports.seeded(5);
    c.strokeStyle = 'rgba(150,180,205,0.18)';
    c.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = L + rnd() * (R - L), y = T + rnd() * (B - T), a = rnd() * Math.PI, l = 10 + rnd() * 40;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    }
    // Centre ice logo.
    c.fillStyle = 'rgba(255,197,61,0.16)';
    c.beginPath(); c.arc(W / 2, MID_Y, 46, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(160,120,20,0.35)';
    c.font = '900 22px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('PPA', W / 2, MID_Y + 8);
    // Lines: red centre, blue lines, red goal lines.
    c.fillStyle = 'rgba(214,52,52,0.75)';
    c.fillRect(W / 2 - 4, T, 8, B - T);
    c.fillStyle = 'rgba(255,255,255,0.6)';
    for (let y = T; y < B; y += 14) c.fillRect(W / 2 - 1, y, 2, 7);
    c.fillStyle = 'rgba(40,90,200,0.8)';
    for (const x of BLUE) c.fillRect(x - 6, T, 12, B - T);
    c.fillStyle = 'rgba(214,52,52,0.8)';
    for (const x of GOAL_X) c.fillRect(x - 1.5, T, 3, B - T);
    // Circles and dots.
    c.strokeStyle = 'rgba(214,52,52,0.7)';
    c.lineWidth = 2.5;
    c.strokeStyle = 'rgba(40,90,200,0.8)';
    c.beginPath(); c.arc(W / 2, MID_Y, 70, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(214,52,52,0.7)';
    for (const x of [L + 190, R - 190]) for (const y of [MID_Y - 110, MID_Y + 110]) {
      c.beginPath(); c.arc(x, y, 50, 0, Math.PI * 2); c.stroke();
      c.fillStyle = 'rgba(214,52,52,0.8)';
      c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(x - 60, y - 6); c.lineTo(x - 50, y - 6); c.moveTo(x + 50, y + 6); c.lineTo(x + 60, y + 6); c.stroke();
    }
    for (const x of [BLUE[0] - 40, BLUE[1] + 40]) for (const y of [MID_Y - 110, MID_Y + 110]) {
      c.fillStyle = 'rgba(214,52,52,0.8)';
      c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
    }
    // Goal creases.
    for (const t of [0, 1]) {
      const gx = GOAL_X[t], d = attackDir(t);
      c.fillStyle = 'rgba(90,160,240,0.35)';
      c.beginPath(); c.moveTo(gx, MID_Y - 48); c.lineTo(gx + d * 30, MID_Y - 48); c.arc(gx + d * 30, MID_Y, 48, -Math.PI / 2 * d, Math.PI / 2 * d, d < 0); c.lineTo(gx, MID_Y + 48); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(214,52,52,0.8)';
      c.lineWidth = 2;
      c.stroke();
    }
    c.restore();
    // Boards and glass.
    rinkPath(c);
    c.lineWidth = 10;
    c.strokeStyle = '#f2f4f7';
    c.stroke();
    rinkPath(c, -6);
    c.lineWidth = 4;
    c.strokeStyle = '#ffc53d';
    c.stroke();
    rinkPath(c, -10);
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(200,230,255,0.35)';
    c.stroke();
    // Ads along the bottom board.
    c.font = '800 11px system-ui, sans-serif';
    c.textAlign = 'center';
    const ads = ['PIXEL PIONEERS', 'ICE CLASH', 'TACO TRUCK', 'GEM MINE', 'POCKET RACER'];
    ads.forEach((a, i) => {
      const x = L + CR + 20 + i * ((R - L - CR * 2 - 40) / (ads.length - 1));
      c.fillStyle = ['#ff5d5d', '#4f8cff', '#3ddc84', '#a46bff', '#ff8a3d'][i];
      c.fillRect(x - 52, B + 9, 104, 15);
      c.fillStyle = '#fff';
      c.fillText(a, x, B + 20.5);
    });
    // Benches in front of the crowd.
    c.fillStyle = '#1d2333';
    c.fillRect(W / 2 - 260, T - 22, 200, 14);
    c.fillRect(W / 2 + 60, T - 22, 200, 14);
  }

  function drawNet(t) {
    const gx = GOAL_X[t], d = attackDir(t), back = gx - d * NET_D;
    const y0 = MID_Y - MOUTH, y1 = MID_Y + MOUTH;
    const bulge = state === 'goal' && lamp[t] > 0 ? Math.sin(performance.now() / 50) * 3 * (lamp[t] / 3) : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(gx, y0); ctx.quadraticCurveTo(back - d * (6 + bulge), MID_Y, gx, y1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(80,90,110,0.45)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const y = y0 + (i / 8) * (y1 - y0);
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx - d * (NET_D * Math.sin((i / 8) * Math.PI) + bulge), y); ctx.stroke();
    }
    ctx.strokeStyle = '#e03a3a';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(gx, y0); ctx.quadraticCurveTo(back - d * (6 + bulge), MID_Y, gx, y1); ctx.stroke();
    // Goal lamp behind the net.
    const on = lamp[t] > 0 && Math.floor(performance.now() / 150) % 2 === 0;
    ctx.fillStyle = on ? '#ff3030' : '#5a2020';
    ctx.beginPath(); ctx.arc(back - d * 22, MID_Y, 7, 0, Math.PI * 2); ctx.fill();
    if (on) {
      const gl = ctx.createRadialGradient(back - d * 22, MID_Y, 2, back - d * 22, MID_Y, 60);
      gl.addColorStop(0, 'rgba(255,60,60,0.5)');
      gl.addColorStop(1, 'rgba(255,60,60,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(back - d * 22 - 60, MID_Y - 60, 120, 120);
    }
  }

  function kit(t) { return t === 0 ? ME : rival; }

  function drawSkater(p) {
    const k = kit(p.team);
    const x = p.x, y = p.y;
    const sp = len(p.vx, p.vy);
    const stride = Math.sin(p.stride) * Math.min(1, sp / 120);
    const down = p.stun > 0;
    ctx.save();
    ctx.translate(x, y);
    // Shadow.
    ctx.fillStyle = 'rgba(40,70,110,0.22)';
    ctx.beginPath(); ctx.ellipse(2, 10, 15, 6, 0, 0, Math.PI * 2); ctx.fill();
    const face = Math.cos(p.dir) >= 0 ? 1 : -1;
    if (down) ctx.rotate(face * 1.2);
    // Skates and legs, pushing out to the sides as they stride.
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const push = stride * s * 5;
      ctx.strokeStyle = k.dark;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(s * 4, -2); ctx.lineTo(s * 5 + push, 8); ctx.stroke();
      ctx.strokeStyle = '#1b1e24';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(s * 5 + push - face * 4, 10); ctx.lineTo(s * 5 + push + face * 5, 10); ctx.stroke();
      ctx.strokeStyle = '#cfd8e2';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s * 5 + push - face * 5, 12); ctx.lineTo(s * 5 + push + face * 6, 12); ctx.stroke();
    }
    // Stick, held out in front with the blade on the ice.
    const sa = p.dir + (p.charge > 0 ? -face * (0.4 + p.charge * 1.4) : 0.25 * face);
    const sx = Math.cos(sa) * 22, sy = Math.sin(sa) * 22 * 0.6 + 6;
    ctx.strokeStyle = '#3b2a1e';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(face * 5, -10); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.strokeStyle = '#1b1e24';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(p.dir) * 7, sy + Math.sin(p.dir) * 4); ctx.stroke();
    // Jersey with shoulder pads.
    ctx.fillStyle = k.color;
    ctx.beginPath(); ctx.roundRect(-11, -20, 22, 20, [9, 9, 5, 5]); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-11, -9, 22, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.roundRect(3, -20, 8, 20, [0, 9, 5, 0]); ctx.fill();
    ctx.fillStyle = k.dark;
    ctx.fillRect(-10, -2, 20, 4);
    ctx.fillStyle = k.num;
    ctx.font = '800 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.role === 'C' ? '9' : p.role === 'W' ? '17' : '4', 0, -10);
    // Helmet with visor.
    ctx.fillStyle = k.dark;
    ctx.beginPath(); ctx.arc(0, -25, 7.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(-2, -27, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(190,230,255,0.75)';
    ctx.fillRect(face > 0 ? 1 : -7, -26, 6, 3);
    ctx.restore();
    if (down) {
      ctx.fillStyle = '#fff';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✶ ✶', x, y - 36 + Math.sin(performance.now() / 90) * 2);
    }
  }

  function drawGoalie(p) {
    const k = kit(p.team);
    const x = p.x, y = p.y, d = attackDir(p.team);
    ctx.save();
    ctx.translate(x, y);
    if (p.dive > 0) ctx.rotate((p.vy > 0 ? 1 : -1) * d * 0.9);
    ctx.fillStyle = 'rgba(40,70,110,0.22)';
    ctx.beginPath(); ctx.ellipse(0, 10, 17, 6, 0, 0, Math.PI * 2); ctx.fill();
    // Big leg pads.
    ctx.fillStyle = '#f2f4f7';
    ctx.beginPath(); ctx.roundRect(-11, -4, 9, 15, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(2, -4, 9, 15, 3); ctx.fill();
    ctx.strokeStyle = k.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(-11, 2, 9, 2);
    ctx.strokeRect(2, 2, 9, 2);
    ctx.fillStyle = k.color;
    ctx.beginPath(); ctx.roundRect(-13, -24, 26, 22, [10, 10, 5, 5]); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.roundRect(4, -24, 9, 22, [0, 10, 5, 0]); ctx.fill();
    // Blocker and glove.
    ctx.fillStyle = '#f2f4f7';
    ctx.fillRect(-18, -16, 7, 10);
    ctx.fillStyle = k.dark;
    ctx.beginPath(); ctx.arc(15, -12, 6, 0, Math.PI * 2); ctx.fill();
    // Mask.
    ctx.fillStyle = '#f2f4f7';
    ctx.beginPath(); ctx.arc(0, -30, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a6270';
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(d * 2 + i * 2.5, -33); ctx.lineTo(d * 2 + i * 2.5, -26); ctx.stroke(); }
    ctx.fillStyle = k.color;
    ctx.fillRect(-8, -36, 16, 3);
    ctx.restore();
  }

  function drawPuck() {
    const pk = g.puck;
    for (let i = 0; i < pk.trail.length; i++) {
      const [x, y] = pk.trail[i];
      ctx.fillStyle = `rgba(30,40,60,${(i / pk.trail.length) * 0.25})`;
      ctx.beginPath(); ctx.ellipse(x, y, PUCK_R, PUCK_R * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(40,70,110,0.25)';
    ctx.beginPath(); ctx.ellipse(pk.x + 1.5, pk.y + 2.5, PUCK_R + 1, PUCK_R * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111318';
    ctx.beginPath(); ctx.ellipse(pk.x, pk.y + 1.5, PUCK_R, PUCK_R * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2f38';
    ctx.beginPath(); ctx.ellipse(pk.x, pk.y, PUCK_R, PUCK_R * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  }

  function draw(dt) {
    shake.apply(ctx, dt);
    ctx.drawImage(rinkLayer.canvas, 0, 0, W, H);
    excite = Math.max(0, excite - dt * 0.35);
    crowd.draw(ctx, 0, 0, excite, performance.now() / 1000);
    ctx.fillStyle = 'rgba(10,12,20,0.35)';
    ctx.fillRect(0, T - 24, W, 4);
    if (!g) { ctx.restore(); return; }
    lamp = lamp.map(v => Math.max(0, v - dt));
    drawNet(0);
    drawNet(1);
    // Highlight the skater you control.
    const c = me();
    if (state !== 'menu' && state !== 'over') {
      ctx.strokeStyle = ME.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(c.x, c.y + 10, 17, 7, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const list = [...g.players].sort((a, b) => a.y - b.y);
    for (const p of list) {
      if (g.puck.y < p.y && !drawPuck.done) { drawPuck(); drawPuck.done = true; }
      if (p.role === 'G') drawGoalie(p); else drawSkater(p);
    }
    if (!drawPuck.done) drawPuck();
    drawPuck.done = false;
    // Slapshot wind-up meter.
    if (c.charge > 0) {
      ctx.fillStyle = 'rgba(10,12,20,0.7)';
      ctx.fillRect(c.x - 20, c.y - 50, 40, 6);
      ctx.fillStyle = c.charge > 0.6 ? '#ff5d5d' : '#ffc53d';
      ctx.fillRect(c.x - 19, c.y - 49, 38 * c.charge, 4);
    }
    // Burst meter.
    if (c.burst < 1) {
      ctx.fillStyle = 'rgba(10,12,20,0.5)';
      ctx.fillRect(c.x - 14, c.y + 20, 28, 3);
      ctx.fillStyle = '#4fd1ff';
      ctx.fillRect(c.x - 14, c.y + 20, 28 * c.burst, 3);
    }
    fx.update(dt);
    fx.draw(ctx);
    // Scoreboard hanging over centre ice.
    ctx.fillStyle = 'rgba(12,14,22,0.9)';
    ctx.beginPath(); ctx.roundRect(W / 2 - 150, 6, 300, 44, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = ME.color;
    ctx.fillText('PIO', W / 2 - 138, 33);
    ctx.textAlign = 'right';
    ctx.fillStyle = rival.color;
    ctx.fillText(rival.name.split(' ').pop().slice(0, 3).toUpperCase(), W / 2 + 138, 33);
    ctx.font = '900 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(g.score[0], W / 2 - 78, 37);
    ctx.fillText(g.score[1], W / 2 + 78, 37);
    const t = Math.ceil(g.time);
    ctx.fillStyle = '#ff7a5a';
    ctx.font = '700 18px ui-monospace, monospace';
    ctx.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, W / 2, 30);
    ctx.fillStyle = '#9aa3b5';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(g.ot ? 'OVERTIME' : `PERIOD ${g.period}`, W / 2, 44);
    // Banner.
    if (g.banner) {
      g.banner.t -= dt;
      if (g.banner.t <= 0) g.banner = null;
      else {
        g.banner.life ??= g.banner.t;
        const slide = Math.min(1, (g.banner.life - g.banner.t) * 6);
        ctx.globalAlpha = Math.min(1, g.banner.t * 3);
        ctx.fillStyle = 'rgba(12,14,22,0.75)';
        ctx.fillRect(0, MID_Y - 34, W, 68);
        ctx.font = `900 ${g.banner.text === 'GOAL!' ? 52 : 36}px system-ui, sans-serif`;
        ctx.fillStyle = g.banner.team === 0 ? ME.color : g.banner.team === 1 ? rival.color : '#fff';
        ctx.fillText(g.banner.text, W / 2 + (1 - slide) * -300, MID_Y + (g.banner.text === 'GOAL!' ? 18 : 13));
        ctx.globalAlpha = 1;
      }
    }
    if (state === 'faceoff') {
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(W / 2, MID_Y - g.drop * 40, PUCK_R, 0, Math.PI * 2); ctx.fill();
    }
    Sports.lighting(ctx, W, H, 0.25);
    ctx.restore();
  }

  function updateHud() {
    if (!g) return;
    $('score').textContent = `${g.score[0]} – ${g.score[1]}`;
    $('period').textContent = g.ot ? 'OT' : `P${g.period}`;
    const t = Math.ceil(g.time);
    $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  // ---------- Loop ----------

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (g && state !== 'paused' && state !== 'menu' && state !== 'over') {
      if (state === 'intermission') {
        g.wait -= dt;
        if (g.wait <= 0) faceoff();
      } else {
        acc += AUTOPILOT ? dt * 6 : dt;
        while (acc >= STEP) {
          step(STEP);
          acc -= STEP;
        }
      }
      sounds(g.events.splice(0));
    }
    draw(state === 'paused' ? 0 : dt);
    updateHud();
    requestAnimationFrame(frame);
  }

  renderRink();
  const levelChips = () => `<div class="menu"><div class="row">${LEVELS.map((l, i) => `<button class="chip" type="button" data-level="${i}" aria-pressed="${i === level}">${l.name}</button>`).join('')}</div></div>`;
  Versus.attach({
    ui,
    start,
    score: () => (g ? Math.max(0, Math.round((g.score[0] * 120 - g.score[1] * 40 + g.shots[0] * 5) * L8.mult)) : 0),
    intro: {
      title: 'Ice Clash',
      html: `<p>Three-on-three hockey with goalies. Three one-minute periods; tied games go to sudden-death overtime.</p>
        <ul>
          <li><span class="kbd-only"><kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> skate, <kbd>Shift</kbd> to burst.</span><span class="touch-only">Drag on the rink to skate.</span></li>
          <li>Tap <b class="kbd-only">Space</b><b class="touch-only">Shoot</b> for a wrist shot, hold it to wind up a slapshot.</li>
          <li><b class="kbd-only">Z</b><b class="touch-only">Pass</b> passes; without the puck it switches skater, and Shoot throws a body check.</li>
        </ul>${levelChips()}`,
      button: 'Drop the puck',
      onAction: () => { ui.hide(); start(); },
      onRender: panel => panel.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => {
        level = +b.dataset.level;
        L8 = LEVELS[level];
        Arcade.save('ice:level', level);
        panel.querySelectorAll('[data-level]').forEach(x => x.setAttribute('aria-pressed', x === b));
      })),
    },
  });
  requestAnimationFrame(frame);
})();
