(() => {
  const W = 960, H = 600;
  const L = 40, R = 920, T = 40, B = 560;          // the pitch
  const MOUTH = [245, 355];                        // goal mouth, top to bottom
  const PR = 11, BR = 6;
  const SPEED = 150, SPRINT = 215;
  const MATCH = 180;                               // seconds
  const STEP = 1 / 60;
  const SEND_EVERY = 1 / 15;
  const COLORS = ['#ffc53d', '#4f8cff'];
  const KITS = ['#1c1500', '#0b1a33'];
  const LEVELS = [
    { name: 'Easy', speed: 0.82, react: 0.45, aim: 70, tackle: 1.2, mult: 0.7 },
    { name: 'Normal', speed: 0.93, react: 0.28, aim: 45, tackle: 2, mult: 1 },
    { name: 'Hard', speed: 1.03, react: 0.12, aim: 25, tackle: 3, mult: 1.5 },
  ];
  // Kickoff spots for the team attacking right; the other team is mirrored.
  const HOME = [
    { role: 'gk', x: 62, y: 300 },
    { role: 'def', x: 230, y: 300 },
    { role: 'fwd', x: 400, y: 200 },
    { role: 'fwd', x: 400, y: 400 },
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const pitch = Arcade.makeLayer(W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const esc = s => Online.escape(s);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const len = (x, y) => Math.hypot(x, y);

  let state = 'menu';     // menu, playing, paused, over
  let mode = null;        // 'bot' | 'host' | 'guest'
  let level = Arcade.load('pitch:level', 1);
  let m = null;           // the match
  let net = null;         // { conn, names, want, sendT, input }
  let me = 0;             // the team this device controls
  let snaps = [];         // guest: last two snapshots

  // ---------- Match setup ----------

  const goalX = team => (team === 0 ? R : L);     // the goal a team attacks
  const ownGoalX = team => (team === 0 ? L : R);
  const side = team => (team === 0 ? 1 : -1);      // +1 attacks to the right

  function newMatch() {
    m = {
      time: MATCH, score: [0, 0], players: [], ball: null,
      ctrl: [2, 2], pause: 0, banner: null, kickoff: 0, events: [],
      input: [blankInput(), blankInput()],
    };
    for (let team = 0; team < 2; team++) {
      HOME.forEach((h, i) => m.players.push({
        id: team * 4 + i, team, role: h.role, i,
        x: 0, y: 0, vx: 0, vy: 0, dir: team === 0 ? 0 : Math.PI,
        stamina: 1, stun: 0, slide: 0, think: 0, hold: 0,
      }));
    }
    m.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, z: 0, vz: 0, owner: null, last: null, block: null, blockT: 0 };
    kickoff(Math.random() < 0.5 ? 0 : 1);
  }

  const blankInput = () => ({ mx: 0, my: 0, sprint: false, shoot: false, pass: 0, sw: 0, charge: 0, held: false, seenPass: 0, seenSw: 0 });
  const team = t => m.players.filter(p => p.team === t);
  const ctrlOf = t => m.players[t * 4 + m.ctrl[t]];
  const humanTeams = () => (mode === 'bot' ? [0] : [0, 1]);

  function kickoff(t) {
    for (const p of m.players) {
      const h = HOME[p.i];
      p.x = p.team === 0 ? h.x : W - h.x;
      p.y = h.y;
      p.vx = p.vy = 0;
      p.dir = p.team === 0 ? 0 : Math.PI;
      p.stun = p.slide = p.hold = 0;
    }
    // The kicking team's striker stands on the ball.
    const taker = m.players[t * 4 + 2];
    taker.x = W / 2 - side(t) * 14;
    taker.y = H / 2;
    Object.assign(m.ball, { x: W / 2, y: H / 2, vx: 0, vy: 0, z: 0, vz: 0, owner: null, last: t, block: null });
    for (const tt of [0, 1]) m.ctrl[tt] = 2;
    m.kickoff = 1;
  }

  // ---------- Ball ----------

  function kick(p, vx, vy, vz = 0, kind = 'pass') {
    const b = m.ball;
    b.owner = null;
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    b.z = Math.max(b.z, 1);
    b.last = p.team;
    b.block = p;          // the kicker can't touch it again straight away
    b.blockT = 0.25;
    p.hold = 0;
    m.events.push(kind === 'shot' ? 's' : 'p');
  }

  function shoot(p, power) {
    const gx = goalX(p.team);
    const keeper = team(1 - p.team).find(q => q.role === 'gk');
    const inp = m.input[p.team];
    // Aim: the far corner from the keeper, nudged by up/down on the stick, off by up to `spread`.
    let ty = keeper.y < H / 2 ? MOUTH[1] - 14 : MOUTH[0] + 14;
    if (isHuman(p) && inp.my) ty = inp.my < 0 ? MOUTH[0] + 12 : MOUTH[1] - 12;
    const spread = isHuman(p) ? 20 + (1 - power) * 25 : LEVELS[level].aim;
    ty += Arcade.rand(-spread, spread);
    const dx = gx - p.x, dy = ty - p.y, d = len(dx, dy);
    const facing = Math.cos(Math.atan2(dy, dx) - p.dir) > 0.2;
    const speed = 380 + power * 360;
    const [ux, uy] = facing ? [dx / d, dy / d] : [Math.cos(p.dir), Math.sin(p.dir)];
    kick(p, ux * speed, uy * speed, 40 + power * 90, 'shot');
  }

  // Passes go to the teammate who best lines up with where the passer is facing.
  function pass(p, lob = false) {
    const mates = team(p.team).filter(q => q !== p);
    let best = null, bestScore = -Infinity;
    for (const q of mates) {
      const dx = q.x - p.x, dy = q.y - p.y, d = len(dx, dy);
      const aim = Math.cos(Math.atan2(dy, dx) - p.dir);
      const blocked = team(1 - p.team).some(o => segDist(o.x, o.y, p.x, p.y, q.x, q.y) < 18);
      const score = aim * 2 - d / 400 + (blocked ? -1.5 : 0) + (q.role === 'gk' ? -1.2 : 0) + side(p.team) * (q.x - p.x) / 600;
      if (score > bestScore) { bestScore = score; best = q; }
    }
    if (!best) return;
    // Lead the receiver a little.
    const tx = best.x + best.vx * 0.3, ty = best.y + best.vy * 0.3;
    const dx = tx - p.x, dy = ty - p.y, d = Math.max(1, len(dx, dy));
    const speed = clamp(d * 1.0 + 140, 220, 560);
    kick(p, dx / d * speed, dy / d * speed, lob ? 220 : 0);
    if (isHuman(p)) m.ctrl[p.team] = best.i;
  }

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return len(px - (ax + dx * t), py - (ay + dy * t));
  }

  function updateBall(dt) {
    const b = m.ball;
    if (b.blockT > 0 && (b.blockT -= dt) <= 0) b.block = null;
    if (b.owner) {
      const p = b.owner;
      b.x = p.x + Math.cos(p.dir) * (PR + BR + 2);
      b.y = p.y + Math.sin(p.dir) * (PR + BR + 2);
      b.vx = p.vx;
      b.vy = p.vy;
      b.z = 0;
      return;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.z > 0 || b.vz) {
      b.vz -= 900 * dt;
      b.z += b.vz * dt;
      if (b.z <= 0) {
        b.z = 0;
        b.vz = b.vz < -120 ? -b.vz * 0.4 : 0;
      }
    }
    const f = Math.exp(-(b.z > 0 ? 0.25 : 0.95) * dt);
    b.vx *= f;
    b.vy *= f;

    // Goals: through the mouth and under the bar.
    const inMouth = b.y > MOUTH[0] && b.y < MOUTH[1];
    if (inMouth && b.z < 34 && (b.x < L || b.x > R)) {
      // The back of the net stops the ball.
      if (b.x < L - 24 || b.x > R + 24) {
        b.x = clamp(b.x, L - 24, R + 24);
        b.vx *= -0.2;
      }
      if (m.pause <= 0 && (b.x < L - 4 || b.x > R + 4)) goal(b.x > R ? 0 : 1);
      return;
    }
    // Everywhere else the pitch is walled in, so play never stops for throw-ins.
    if (b.x < L + BR || b.x > R - BR) {
      if (!inMouth || b.z >= 34) {
        b.x = clamp(b.x, L + BR, R - BR);
        b.vx *= -0.65;
        m.events.push('w');
      }
    }
    if (b.y < T + BR || b.y > B - BR) {
      b.y = clamp(b.y, T + BR, B - BR);
      b.vy *= -0.65;
      m.events.push('w');
    }
    // Goalposts.
    for (const gx of [L, R]) for (const py of MOUTH) {
      const dx = b.x - gx, dy = b.y - py, d = len(dx, dy);
      if (d < BR + 3 && b.z < 34) {
        const nx = dx / (d || 1), ny = dy / (d || 1);
        const dot = b.vx * nx + b.vy * ny;
        if (dot < 0) { b.vx -= 1.7 * dot * nx; b.vy -= 1.7 * dot * ny; m.events.push('post'); }
        b.x = gx + nx * (BR + 3);
        b.y = py + ny * (BR + 3);
      }
    }
  }

  function goal(t) {
    m.score[t]++;
    m.pause = 2.2;
    m.banner = { text: 'GOAL!', team: t, t: 2.2 };
    m.events.push('g' + t);
    m.ball.vx *= 0.2;
    m.ball.vy *= 0.2;
    m.next = 1 - t;
  }

  // ---------- Players ----------

  const isHuman = p => humanTeams().includes(p.team) && m.ctrl[p.team] === p.i && p.role !== 'gk';

  function move(p, tx, ty, speed, dt) {
    const dx = tx - p.x, dy = ty - p.y, d = len(dx, dy);
    const want = d < 4 ? 0 : speed;
    const ax = d ? (dx / d) * want : 0, ay = d ? (dy / d) * want : 0;
    steer(p, ax, ay, dt);
  }

  function steer(p, ax, ay, dt) {
    const k = Math.min(1, dt * 10);
    p.vx += (ax - p.vx) * k;
    p.vy += (ay - p.vy) * k;
    if (len(ax, ay) > 10) p.dir = Math.atan2(ay, ax);
  }

  function updatePlayer(p, dt) {
    const b = m.ball;
    if (p.stun > 0) {
      p.stun -= dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
    } else if (p.slide > 0) {
      p.slide -= dt;
    } else if (isHuman(p)) {
      human(p, dt);
    } else if (p.role === 'gk') {
      keeper(p, dt);
    } else {
      ai(p, dt);
    }
    p.x = clamp(p.x + p.vx * dt, L + PR - 20, R - PR + 20);
    p.y = clamp(p.y + p.vy * dt, T + PR - 10, B - PR + 10);

    // Pick up a loose ball rolling along the ground.
    if (!b.owner && b.z < 14 && p.stun <= 0 && b.block !== p && len(b.x - p.x, b.y - p.y) < PR + BR + 3) {
      const speed = len(b.vx, b.vy);
      // A keeper only gathers shots they can reach; hard ones get parried.
      if (p.role === 'gk' && speed > 520 && Math.random() < 0.55) {
        b.vx = -b.vx * 0.45 + Arcade.rand(-60, 60);
        b.vy = b.vy * 0.4 + Arcade.rand(-160, 160);
        b.block = p;
        b.blockT = 0.3;
        m.events.push('save');
      } else {
        b.owner = p;
        b.last = p.team;
        p.hold = 0;
        if (p.role === 'gk' && speed > 250) m.events.push('save');
        if (humanTeams().includes(p.team) && p.role !== 'gk') m.ctrl[p.team] = p.i;
      }
    }
    // Slide tackles knock the ball loose.
    if (p.slide > 0 && b.owner && b.owner.team !== p.team && len(b.owner.x - p.x, b.owner.y - p.y) < PR * 2 + 6) {
      knockLoose(b.owner, p);
    }
  }

  function knockLoose(carrier, by) {
    const b = m.ball;
    b.owner = null;
    const a = Math.atan2(carrier.y - by.y, carrier.x - by.x) + Arcade.rand(-0.8, 0.8);
    b.vx = Math.cos(a) * 180 + by.vx * 0.5;
    b.vy = Math.sin(a) * 180 + by.vy * 0.5;
    b.block = carrier;
    b.blockT = 0.5;
    carrier.stun = 0.45;
    m.events.push('t');
  }

  function human(p, dt) {
    const inp = m.input[p.team];
    const b = m.ball;
    const sprinting = inp.sprint && p.stamina > 0.05 && (inp.mx || inp.my);
    p.stamina = clamp(p.stamina + (sprinting ? -0.38 : 0.18) * dt, 0, 1);
    const top = (sprinting ? SPRINT : SPEED) * (b.owner === p ? 0.9 : 1);
    const d = len(inp.mx, inp.my) || 1;
    steer(p, (inp.mx / d) * top * (inp.mx || inp.my ? 1 : 0), (inp.my / d) * top * (inp.mx || inp.my ? 1 : 0), dt);

    // Shoot: hold to charge, release to strike. Without the ball the same button slides in.
    if (inp.shoot) inp.charge = Math.min(1, inp.charge + dt / 0.7);
    if (inp.held && !inp.shoot) {
      if (b.owner === p) shoot(p, inp.charge);
      else if (p.slide <= 0) {
        p.slide = 0.35;
        p.vx = Math.cos(p.dir) * 330;
        p.vy = Math.sin(p.dir) * 330;
        m.events.push('slide');
      }
      inp.charge = 0;
    }
    inp.held = inp.shoot;
    if (inp.pass !== inp.seenPass) {
      inp.seenPass = inp.pass;
      if (b.owner === p) pass(p);
    }
  }

  // Switch to the teammate best placed to win the ball.
  function switchPlayer(t) {
    const b = m.ball;
    const options = team(t).filter(q => q.role !== 'gk' && q.i !== m.ctrl[t]);
    options.sort((a, c) => len(a.x - b.x, a.y - b.y) - len(c.x - b.x, c.y - b.y));
    if (options[0]) m.ctrl[t] = options[0].i;
  }

  function keeper(p, dt) {
    const b = m.ball;
    const gx = ownGoalX(p.team), s = side(p.team);
    if (b.owner === p) {
      p.hold += dt;
      move(p, gx + s * 40, H / 2, SPEED * 0.6, dt);
      if (p.hold > 0.9) {
        p.dir = s > 0 ? 0 : Math.PI;
        pass(p, true);
      }
      return;
    }
    // Stay on the line, between the ball and the middle of the goal; come out for close balls.
    let ty = clamp(H / 2 + (b.y - H / 2) * 0.5, MOUTH[0] - 6, MOUTH[1] + 6);
    let tx = gx + s * 22;
    const incoming = s * b.vx < -150 && Math.abs(b.x - gx) < 360;
    if (incoming) {
      const t = (gx + s * 22 - b.x) / b.vx;
      if (t > 0) ty = clamp(b.y + b.vy * t, MOUTH[0] - 10, MOUTH[1] + 10);
    }
    const close = Math.abs(b.x - gx) < 120 && b.y > MOUTH[0] - 60 && b.y < MOUTH[1] + 60 && !b.owner;
    if (close) { tx = b.x; ty = b.y; }
    move(p, tx, ty, SPEED * (incoming ? 1.4 : 1) * (mode === 'bot' && p.team === 1 ? LEVELS[level].speed : 1), dt);
  }

  // Everyone else: the nearest player chases the ball, the rest hold a shape around it.
  function ai(p, dt) {
    const b = m.ball, s = side(p.team), L_ = LEVELS[level];
    const bot = mode === 'bot' && p.team === 1;
    const speedK = bot ? L_.speed : 0.95;
    p.stamina = clamp(p.stamina + 0.18 * dt, 0, 1);

    if (b.owner === p) return carry(p, dt, speedK);

    const ours = b.owner && b.owner.team === p.team;
    const chaser = closestToBall(p.team);
    if (!ours && chaser === p) {
      // Run to where the ball will be, and challenge the carrier.
      const lead = b.owner ? 0.15 : 0.35;
      move(p, b.x + b.vx * lead, b.y + b.vy * lead, SPEED * speedK * (b.owner ? 1.12 : 1.05), dt);
      if (b.owner && b.owner.team !== p.team && len(b.owner.x - p.x, b.owner.y - p.y) < PR * 2 + 4) {
        p.think -= dt;
        const rate = bot ? L_.tackle : 1.6;
        if (p.think <= 0) {
          p.think = 0.3;
          if (Math.random() < rate * 0.3) knockLoose(b.owner, p);
        }
      }
      return;
    }
    // Shape: attackers push up when we have it, everyone drops toward goal when we don't.
    const h = HOME[p.i];
    const baseX = p.team === 0 ? h.x : W - h.x;
    const push = ours ? 230 : b.owner ? -40 : 80;
    let tx = baseX + s * push + (b.x - W / 2) * 0.45;
    let ty = h.y + (b.y - H / 2) * (p.role === 'def' ? 0.6 : 0.35);
    if (p.role === 'def') tx = Math.min(Math.max(tx, Math.min(ownGoalX(p.team), W / 2) + 60), Math.max(ownGoalX(p.team), W / 2) - 60);
    if (!ours && b.owner && p.role === 'def') {
      // Sit between the carrier and our goal.
      tx = (b.x + ownGoalX(p.team)) / 2;
      ty = (b.y + H / 2) / 2;
    }
    move(p, clamp(tx, L + 30, R - 30), clamp(ty, T + 30, B - 30), SPEED * speedK * 0.9, dt);
  }

  function closestToBall(t) {
    const b = m.ball;
    let best = null, bestD = Infinity;
    for (const q of team(t)) {
      if (q.role === 'gk' || isHuman(q)) continue;
      const d = len(q.x - b.x, q.y - b.y);
      if (d < bestD) { bestD = d; best = q; }
    }
    // If the human is nearer, leave it to them.
    if (humanTeams().includes(t)) {
      const h = ctrlOf(t);
      if (h && h.role !== 'gk' && len(h.x - b.x, h.y - b.y) < bestD + 30) return null;
    }
    return best;
  }

  function carry(p, dt, speedK) {
    const gx = goalX(p.team), s = side(p.team);
    const toGoal = len(gx - p.x, H / 2 - p.y);
    p.hold += dt;
    const foes = team(1 - p.team);
    const nearest = foes.filter(f => f.role !== 'gk').sort((a, c) => len(a.x - p.x, a.y - p.y) - len(c.x - p.x, c.y - p.y))[0];
    const pressure = nearest ? len(nearest.x - p.x, nearest.y - p.y) : 999;
    const react = mode === 'bot' && p.team === 1 ? LEVELS[level].react : 0.25;

    if (p.hold > react && toGoal < 290 && Math.abs(p.y - H / 2) < 200) {
      p.dir = Math.atan2(H / 2 - p.y, gx - p.x);
      return shoot(p, clamp(toGoal / 300, 0.45, 0.95));
    }
    if (p.hold > react + 0.3 && pressure < 46 && Math.random() < dt * 4) {
      p.dir = Math.atan2(H / 2 - p.y, gx - p.x) + Arcade.rand(-0.9, 0.9);
      return pass(p);
    }
    // Dribble toward goal, curving away from the nearest defender.
    let ax = s, ay = (H / 2 - p.y) / 300;
    if (nearest && pressure < 110) {
      ay += Math.sign(p.y - nearest.y || 1) * 0.9;
    }
    const d = len(ax, ay);
    steer(p, ax / d * SPEED * speedK * 0.95, ay / d * SPEED * speedK * 0.95, dt);
  }

  // Stops players piling up on the same spot.
  function separate() {
    const ps = m.players;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      const dx = c.x - a.x, dy = c.y - a.y, d = len(dx, dy);
      if (d > 0 && d < PR * 2) {
        const push = (PR * 2 - d) / 2;
        a.x -= dx / d * push; a.y -= dy / d * push;
        c.x += dx / d * push; c.y += dy / d * push;
      }
    }
  }

  // ---------- Simulation ----------

  function step(dt) {
    for (const t of humanTeams()) {
      const inp = m.input[t];
      if (inp.sw !== inp.seenSw) {
        inp.seenSw = inp.sw;
        if (m.ball.owner?.team !== t || m.ball.owner.role === 'gk') switchPlayer(t);
      }
    }
    if (m.pause > 0) {
      m.pause -= dt;
      if (m.banner) m.banner.t -= dt;
      updateBall(dt);
      if (m.pause <= 0) {
        m.banner = null;
        if (m.time <= 0) return endMatch();
        kickoff(m.next);
      }
      return;
    }
    if (m.kickoff > 0) m.kickoff = Math.max(0, m.kickoff - dt);
    m.time -= dt;
    for (const p of m.players) updatePlayer(p, dt);
    separate();
    updateBall(dt);
    if (m.time <= 0 && m.pause <= 0) {
      m.time = 0;
      m.pause = 1.5;
      m.banner = { text: 'Full time', t: 1.5 };
      m.events.push('end');
    }
  }

  function endMatch() {
    state = 'over';
    const mine = m.score[me], theirs = m.score[1 - me];
    const won = mine > theirs, draw = mine === theirs;
    if (mode === 'bot') {
      const L_ = LEVELS[level];
      const score = Math.round((mine * 100 + (won ? 500 : draw ? 200 : 0) + Math.max(0, mine - theirs) * 100) * L_.mult);
      if (won) Arcade.flag('pixel-pitch-win');
      if (won && level === 2) Arcade.flag('pixel-pitch-hard');
      if (won && theirs === 0) Arcade.flag('pixel-pitch-clean');
      Arcade.finish(ui, {
        score,
        title: won ? 'You win!' : draw ? "It's a draw" : 'You lost',
        lines: [`${mine} – ${theirs} · ${L_.name} bots`],
        button: 'Menu',
        onAction: () => showMenu(),
      });
      return;
    }
    if (mode === 'host' && net) {
      net.events.push(...m.events.splice(0));
      net.conn.state(snapshot());
    }
    showOnlineResult();
  }

  // ---------- Input ----------

  const keys = {};
  const local = blankInput();
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (state !== 'playing') {
      if ((e.code === 'KeyP' || e.code === 'Escape') && state === 'paused') resume();
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') return pause();
    if ((e.code === 'KeyZ' || e.code === 'KeyC') && !e.repeat) local.pass++;
    if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat) local.sw++;
    readKeys();
  });
  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    readKeys();
  });
  function readKeys() {
    local.mx = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0) + touch.mx;
    local.my = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0) + touch.my;
    local.sprint = !!(keys.ShiftLeft || keys.ShiftRight) || touch.sprint;
    local.shoot = !!(keys.Space || keys.KeyX) || touch.shoot;
  }

  // Touch: drag anywhere on the left half to move, buttons for the rest.
  const touch = { mx: 0, my: 0, sprint: false, shoot: false, id: null, sx: 0, sy: 0 };
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
  hold('t-shoot', () => { touch.shoot = true; }, () => { touch.shoot = false; });
  hold('t-pass', () => { local.pass++; }, () => {});
  hold('t-switch', () => { local.sw++; }, () => {});
  hold('t-sprint', () => { touch.sprint = true; }, () => { touch.sprint = false; });

  function pushLocalInput() {
    const target = m.input[me];
    Object.assign(target, { mx: clamp(local.mx, -1, 1), my: clamp(local.my, -1, 1), sprint: local.sprint, shoot: local.shoot, pass: local.pass, sw: local.sw });
  }

  // ---------- Network ----------

  function snapshot() {
    return {
      t: Math.round(m.time * 10) / 10, s: m.score, c: m.ctrl, pz: Math.round(m.pause * 10) / 10,
      bn: m.banner ? [m.banner.text, m.banner.team ?? -1] : null,
      p: m.players.map(p => [Math.round(p.x), Math.round(p.y), Math.round(p.dir * 100) / 100, p.slide > 0 ? 1 : 0, Math.round(p.stamina * 100)]),
      b: [Math.round(m.ball.x), Math.round(m.ball.y), Math.round(m.ball.z), m.ball.owner ? m.ball.owner.id : -1],
      ch: Math.round(m.input[1].charge * 100) / 100,
      e: net.events.splice(0),
      over: state === 'over' ? 1 : 0,
    };
  }

  function applySnapshot(s) {
    snaps = [snaps[1] || { s, at: performance.now() }, { s, at: performance.now() }];
    m.time = s.t;
    m.score = s.s;
    m.ctrl = s.c;
    m.pause = s.pz;
    m.banner = s.bn ? { text: s.bn[0], team: s.bn[1] < 0 ? undefined : s.bn[1] } : null;
    m.input[1].charge = s.ch;
    s.p.forEach(([, , dir, slide, st], i) => Object.assign(m.players[i], { dir, slide, stamina: st / 100 }));
    sounds(s.e);
    if (s.over && state === 'playing') {
      state = 'over';
      showOnlineResult();
    }
  }

  // Guest: ease every player and the ball between the last two snapshots.
  function guestPositions() {
    if (snaps.length < 2) return;
    const [a, c] = snaps;
    const k = Math.min(1.3, (performance.now() - c.at) / (SEND_EVERY * 1000));
    m.players.forEach((p, i) => {
      const pa = a.s.p[i], pc = c.s.p[i];
      p.x = pa[0] + (pc[0] - pa[0]) * k;
      p.y = pa[1] + (pc[1] - pa[1]) * k;
    });
    const ba = a.s.b, bc = c.s.b;
    m.ball.x = ba[0] + (bc[0] - ba[0]) * k;
    m.ball.y = ba[1] + (bc[1] - ba[1]) * k;
    m.ball.z = bc[2];
    m.ball.owner = bc[3] >= 0 ? m.players[bc[3]] : null;
  }

  async function goOnline(how, code) {
    let cancelled = false;
    const cancel = () => { cancelled = true; showMenu(); };
    ui.show({ title: 'Connecting…', html: '<p>Waking up the game server. The first connection can take up to a minute.</p>', button: 'Cancel', onAction: cancel });
    const handlers = {
      ready: () => {
        if (cancelled || !net) return;
        net.conn.send('hello', { name: Arcade.profile().name });
        if (me === 0) startOnline();
      },
      event: onNet,
      state: s => { if (mode === 'guest' && m) applySnapshot(s); },
      left: opponentGone,
      closed: () => { if (net) opponentGone(); },
    };
    try {
      const res = how === 'quick' ? await Relay.quickMatch('pitch', handlers, 'Match')
        : how === 'create' ? await Relay.createRoom('pitch', handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom('pitch', code, handlers);
      if (cancelled) { res.conn.close(); return; }
      me = res.slot === 1 ? 0 : 1;
      mode = me === 0 ? 'host' : 'guest';
      net = { conn: res.conn, names: [Arcade.profile().name, 'Opponent'], want: { me: false, them: false }, sendT: 0, inT: 0, lastIn: '', events: [] };
      if (me === 0) {
        ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: how === 'create'
            ? `<p>Share this code. Kickoff is as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick match.</p>',
          button: 'Cancel',
          onAction: cancel,
        });
      } else {
        ui.show({ title: 'Opponent found', html: '<p>You\'re blue, attacking to the left. Starting…</p>', button: null });
      }
    } catch (e) {
      if (!cancelled) showMenu(e.message);
    }
  }

  function startOnline() {
    net.want = { me: false, them: false };
    net.conn.send('start');
    begin();
  }

  function onNet(name, data) {
    if (!net) return;
    if (name === 'hello') net.names[1] = String(data?.name || 'Opponent').slice(0, 24);
    else if (name === 'start' && mode === 'guest') {
      snaps = [];
      begin();
    } else if (name === 'in' && mode === 'host' && m) {
      Object.assign(m.input[1], { mx: clamp(+data.mx || 0, -1, 1), my: clamp(+data.my || 0, -1, 1), sprint: !!data.sp, shoot: !!data.sh, pass: data.pa | 0, sw: data.sw | 0 });
    } else if (name === 'rematch') {
      net.want.them = true;
      maybeRematch();
    } else if (name === 'quit') opponentGone();
  }

  function sendInput(dt) {
    net.inT -= dt;
    const msg = { mx: Math.round(clamp(local.mx, -1, 1) * 100) / 100, my: Math.round(clamp(local.my, -1, 1) * 100) / 100, sp: local.sprint ? 1 : 0, sh: local.shoot ? 1 : 0, pa: local.pass, sw: local.sw };
    const key = JSON.stringify(msg);
    if (key !== net.lastIn || net.inT <= 0) {
      net.conn.send('in', msg);
      net.lastIn = key;
      net.inT = 0.2;
    }
  }

  function maybeRematch() {
    if (mode !== 'host' || !net.want.me || !net.want.them) return;
    startOnline();
  }

  function showOnlineResult() {
    state = 'over';
    const mine = m.score[me], theirs = m.score[1 - me];
    Arcade.countPlay();
    Arcade.flag('online-match');
    if (mine > theirs) Arcade.flag('pixel-pitch-online-win');
    ui.show({
      title: mine > theirs ? 'You win!' : mine === theirs ? "It's a draw" : 'You lost',
      html: `<p class="big">${mine} – ${theirs}</p><p>${esc(net?.names[0] || 'You')} vs ${esc(net?.names[1] || 'Opponent')}</p>
        <div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div>
        <p class="muted-note" data-wait>A rematch starts when you both press it.</p>`,
      button: 'Rematch',
      onAction: () => {
        if (!net) return showMenu();
        net.want.me = true;
        net.conn.send('rematch');
        document.querySelector('[data-wait]').textContent = 'Waiting for your opponent…';
        maybeRematch();
      },
      onRender: panel => panel.querySelector('[data-leave]').addEventListener('click', () => showMenu()),
    });
  }

  function opponentGone() {
    if (!net) return;
    const name = net.names[1];
    const wasPlaying = state === 'playing';
    leaveNet(false);
    if (wasPlaying) {
      state = 'over';
      Arcade.countPlay();
      Arcade.flag('online-match');
      ui.show({ title: `${esc(name)} left`, html: '<p>You win by forfeit.</p>', button: 'Back to menu', onAction: () => showMenu() });
    } else if (state === 'over') {
      const w = document.querySelector('[data-wait]');
      if (w) w.textContent = `${name} left.`;
    } else {
      showMenu(`${name} left.`);
    }
  }

  function leaveNet(tell = true) {
    if (!net) return;
    if (tell) net.conn.send('quit');
    net.conn.close();
    net = null;
  }
  window.addEventListener('pagehide', () => net?.conn.send('quit'));

  // ---------- Flow ----------

  function begin() {
    newMatch();
    if (mode === 'guest') m.input[0] = blankInput();
    state = 'playing';
    ui.hide();
    Arcade.tone({ freq: 880, to: 1320, dur: 0.3, type: 'triangle', vol: 0.05 });
  }

  function startBot(lv) {
    level = lv;
    Arcade.save('pitch:level', lv);
    mode = 'bot';
    me = 0;
    begin();
  }

  function pause() {
    if (state !== 'playing' || mode !== 'bot') return;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }
  function resume() {
    state = 'playing';
    ui.hide();
  }
  Arcade.onBlur(() => {
    for (const k in keys) keys[k] = false;
    readKeys();
    pause();
  });

  function showMenu(error = '') {
    leaveNet();
    state = 'menu';
    mode = 'bot';
    me = 0;
    newMatch();
    const online = Relay.enabled;
    ui.show({
      title: 'Pixel Pitch',
      html: `<p>Four-a-side arcade football. Three minutes, walls all round, no offsides.</p>
        <div class="menu">
          <div class="row">${LEVELS.map((l, i) => `<button class="btn ${i === level ? '' : 'secondary'}" type="button" data-bot="${i}">${l.name}</button>`).join('')}</div>
          ${online ? `<button class="btn secondary" type="button" data-net="quick">Quick match online</button>
          <button class="btn secondary" type="button" data-net="create">Create private room</button>
          <div class="row">
            <input class="field" id="code" maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code">
            <button class="btn secondary" type="button" data-net="join">Join</button>
          </div>` : ''}
        </div>
        <p class="error">${esc(error)}</p>
        <div data-waiting></div>`,
      button: null,
      onRender: panel => {
        panel.querySelectorAll('[data-bot]').forEach(b => b.addEventListener('click', () => startBot(+b.dataset.bot)));
        const code = panel.querySelector('#code');
        panel.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => goOnline(b.dataset.net, code.value)));
        code?.addEventListener('keydown', e => { if (e.key === 'Enter') goOnline('join', code.value); });
        Relay.showWaiting(panel.querySelector('[data-waiting]'), room => goOnline('public', room));
      },
    });
  }

  // ---------- Sound ----------

  function sounds(events) {
    for (const e of events) {
      if (e === 's') Arcade.tone({ freq: 160, to: 80, dur: 0.12, type: 'square', vol: 0.06 });
      else if (e === 'p') Arcade.tone({ freq: 260, to: 200, dur: 0.06, type: 'square', vol: 0.04 });
      else if (e === 'w' || e === 'post') Arcade.tone({ freq: e === 'post' ? 900 : 200, dur: 0.05, vol: 0.03 });
      else if (e === 't' || e === 'slide') Arcade.tone({ freq: 120, to: 60, dur: 0.1, type: 'sawtooth', vol: 0.04 });
      else if (e === 'save') Arcade.tone({ freq: 300, to: 500, dur: 0.1, type: 'triangle', vol: 0.04 });
      else if (e[0] === 'g') {
        const good = +e[1] === me;
        Arcade.tone(good ? { freq: 523, to: 1046, dur: 0.5, type: 'triangle', vol: 0.07 } : { freq: 330, to: 160, dur: 0.5, type: 'sawtooth', vol: 0.05 });
      } else if (e === 'end') Arcade.tone({ freq: 880, dur: 0.6, type: 'triangle', vol: 0.06 });
    }
  }

  // ---------- Drawing ----------

  function renderPitch() {
    const c = pitch.ctx;
    c.fillStyle = '#1d5c33';
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 11; i++) {
      c.fillStyle = i % 2 ? '#22693a' : '#1f6236';
      c.fillRect(L + i * (R - L) / 11, T, (R - L) / 11 + 1, B - T);
    }
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 3;
    c.strokeRect(L, T, R - L, B - T);
    c.beginPath(); c.moveTo(W / 2, T); c.lineTo(W / 2, B); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, 70, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.beginPath(); c.arc(W / 2, H / 2, 4, 0, Math.PI * 2); c.fill();
    for (const [x, s] of [[L, 1], [R, -1]]) {
      c.strokeRect(Math.min(x, x + s * 130), H / 2 - 130, 130, 260);
      c.strokeRect(Math.min(x, x + s * 50), H / 2 - 75, 50, 150);
      c.beginPath(); c.arc(x + s * 95, H / 2, 3, 0, Math.PI * 2); c.fill();
      // Goal and net.
      const gx = s > 0 ? x - 26 : x;
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(gx, MOUTH[0], 26, MOUTH[1] - MOUTH[0]);
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.lineWidth = 1;
      for (let yy = MOUTH[0]; yy <= MOUTH[1]; yy += 10) { c.beginPath(); c.moveTo(gx, yy); c.lineTo(gx + 26, yy); c.stroke(); }
      for (let xx = gx; xx <= gx + 26; xx += 9) { c.beginPath(); c.moveTo(xx, MOUTH[0]); c.lineTo(xx, MOUTH[1]); c.stroke(); }
      c.strokeStyle = '#fff';
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(x, MOUTH[0]); c.lineTo(gx + (s > 0 ? 0 : 26), MOUTH[0]); c.lineTo(gx + (s > 0 ? 0 : 26), MOUTH[1]); c.lineTo(x, MOUTH[1]); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.lineWidth = 3;
    }
  }

  function drawPlayer(p) {
    const human = humanTeams().includes(p.team) && m.ctrl[p.team] === p.i && (mode !== 'bot' || p.team === 0);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + 4, PR, PR * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    if (human) {
      ctx.strokeStyle = p.team === me ? '#fff' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, PR + 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = p.role === 'gk' ? (p.team === 0 ? '#ff8f3d' : '#3dd6c4') : COLORS[p.team];
    ctx.beginPath(); ctx.arc(p.x, p.y, PR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = KITS[p.team];
    ctx.lineWidth = 2;
    ctx.stroke();
    // Facing marker.
    ctx.fillStyle = KITS[p.team];
    ctx.beginPath(); ctx.arc(p.x + Math.cos(p.dir) * 6, p.y + Math.sin(p.dir) * 6, 3, 0, Math.PI * 2); ctx.fill();
    if (p.slide > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.cos(p.dir) * 22, p.y - Math.sin(p.dir) * 22); ctx.stroke();
    }
    if (human && p.team === me) {
      // Stamina and shot power under your player.
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(p.x - 14, p.y + PR + 8, 28, 4);
      ctx.fillStyle = p.stamina > 0.25 ? '#3ddc84' : '#ff7a7a';
      ctx.fillRect(p.x - 14, p.y + PR + 8, 28 * p.stamina, 4);
      const ch = m.input[me].charge;
      if (ch > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(p.x - 14, p.y + PR + 14, 28, 4);
        ctx.fillStyle = '#ffc53d';
        ctx.fillRect(p.x - 14, p.y + PR + 14, 28 * ch, 4);
      }
    }
  }

  function drawBall() {
    const b = m.ball;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(b.x + 2 + b.z * 0.25, b.y + 3 + b.z * 0.15, BR, BR * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    const y = b.y - b.z * 0.5;
    const r = BR + b.z * 0.04;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(b.x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b1e24';
    ctx.beginPath(); ctx.arc(b.x - 1.5, y - 1, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }

  function draw() {
    ctx.drawImage(pitch.canvas, 0, 0, W, H);
    const order = [...m.players].sort((a, c) => a.y - c.y);
    for (const p of order) drawPlayer(p);
    drawBall();

    if (m.banner) {
      ctx.fillStyle = 'rgba(10,12,16,0.6)';
      ctx.fillRect(0, H / 2 - 50, W, 100);
      ctx.font = '800 64px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = m.banner.team !== undefined ? COLORS[m.banner.team] : '#fff';
      ctx.fillText(m.banner.text, W / 2, H / 2 + 22);
    } else if (state === 'playing' && m.time > MATCH - 3) {
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(mode === 'guest' ? 'You are BLUE, attacking left' : 'You are YELLOW, attacking right', W / 2, 100);
    }
    if (net && state === 'playing') {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`${me === 0 ? net.names[0] : net.names[1]} (yellow) vs ${me === 0 ? net.names[1] : net.names[0]} (blue)`, W / 2, H - 14);
    }
  }

  function updateHud() {
    $('you').textContent = m.score[me];
    $('them').textContent = m.score[1 - me];
    const t = Math.max(0, Math.ceil(m.time));
    $('time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  // ---------- Loop ----------

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state === 'playing' && m) {
      if (mode === 'guest') {
        sendInput(dt);
        guestPositions();
      } else {
        pushLocalInput();
        acc += dt;
        while (acc >= STEP) {
          step(STEP);
          acc -= STEP;
          if (state !== 'playing') break;
        }
        // The host hears its own sound effects and passes them on with the next snapshot.
        const events = m.events.splice(0);
        sounds(events);
        if (mode === 'host' && net) {
          net.events.push(...events);
          net.sendT -= dt;
          if (net.sendT <= 0) {
            net.sendT = SEND_EVERY;
            net.conn.state(snapshot());
          }
        }
      }
    }
    draw();
    if (m) updateHud();
    requestAnimationFrame(frame);
  }

  renderPitch();
  showMenu();
  const invite = Relay.takeInvite();
  if (invite) goOnline('public', invite);
  requestAnimationFrame(frame);
})();
