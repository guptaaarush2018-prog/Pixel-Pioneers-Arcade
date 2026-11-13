(() => {
  const W = 960, H = 540;
  const FLOOR = 470, G = 1700;
  const RIM_Y = 228, RIM_R = 24, BALL_R = 11;
  const HOOPS = [W - 112, 112];            // the hoop each player attacks
  const BOARDS = [W - 80, 80];             // backboard x for each hoop
  const THREE = 235;                       // shots from further than this score 3
  const SPEED = 270, JUMP = 760;
  const MATCH = 120, WIN_AT = 21;
  const STEP = 1 / 60, SEND_EVERY = 1 / 15;
  const SWEET = 0.8;                       // where the shot meter is perfect
  const COLORS = [['#ffc53d', '#1c1500'], ['#4f8cff', '#0b1a33']];
  const LEVELS = [
    { name: 'Easy', aim: 0.22, react: 0.5, steal: 0.12, speed: 0.82, mult: 0.7 },
    { name: 'Normal', aim: 0.13, react: 0.3, steal: 0.22, speed: 0.93, mult: 1 },
    { name: 'Hard', aim: 0.07, react: 0.16, steal: 0.32, speed: 1.02, mult: 1.5 },
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const court = Arcade.makeLayer(W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const esc = s => Online.escape(s);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fx = Sports.particles();
  const shake = Sports.shaker();
  const crowd = Sports.makeCrowd(W, 150, { seed: 4, size: 7, colors: ['#ffc53d', '#ffc53d', '#4f8cff', '#4f8cff', '#e6e9ef', '#2b3247', '#ff5d5d'] });
  // Test hook: #autopilot lets a bot play for you too and posts no score.
  const AUTOPILOT = location.hash === '#autopilot';
  const FIRE_AT = 3;                       // baskets in a row to catch fire
  let excite = 0, trail = [], swish = [0, 0];

  let state = 'menu', mode = 'bot', level = Arcade.load('hoop:level', 1), me = 0;
  let g = null, net = null, snaps = [];

  // ---------- Setup ----------

  function newGame() {
    g = {
      time: MATCH, score: [0, 0], pause: 0, banner: null, events: [],
      players: [0, 1].map(i => ({ i, x: i === 0 ? 300 : W - 300, y: FLOOR, vy: 0, face: i === 0 ? 1 : -1, charge: 0, charging: false, stun: 0, stealT: 0, shotT: 0, dunk: 0, think: 0, plan: null })),
      ball: { x: 0, y: 0, vx: 0, vy: 0, owner: null, shooter: -1, three: false, block: -1, blockT: 0, dribble: 0, scored: false, perfect: false },
      input: [blank(), blank()],
      possession: Math.random() < 0.5 ? 0 : 1,
      streak: [0, 0], fire: [false, false],
    };
    resetPossession(g.possession);
  }
  const blank = () => ({ mx: 0, jump: false, shoot: false, held: false, jumped: false });

  // The player with the ball starts in their own half; the defender sets up near halfway.
  function resetPossession(i) {
    const [a, d] = [g.players[i], g.players[1 - i]];
    a.x = i === 0 ? 260 : W - 260;
    d.x = i === 0 ? W / 2 + 60 : W / 2 - 60;
    for (const p of g.players) { p.y = FLOOR; p.vy = 0; p.charge = 0; p.charging = false; p.stun = 0; p.dunk = 0; p.face = p.i === 0 ? 1 : -1; }
    Object.assign(g.ball, { owner: i, vx: 0, vy: 0, shooter: -1, scored: false, block: -1 });
    placeBall();
  }

  const hoopOf = p => HOOPS[p.i];
  const grounded = p => p.y >= FLOOR - 0.5;
  const isHuman = p => mode !== 'bot' || (p.i === 0 && !AUTOPILOT);

  function placeBall() {
    const b = g.ball, p = g.players[b.owner];
    if (p.charging || !grounded(p)) {
      b.x = p.x + p.face * 6;
      b.y = p.y - 92;
    } else {
      b.dribble += STEP * 9;
      b.x = p.x + p.face * 22;
      b.y = FLOOR - BALL_R - Math.abs(Math.sin(b.dribble)) * 42;
    }
  }

  // ---------- Shooting ----------

  // Works out the arc that drops the ball through the rim, then spoils it by how far the
  // release was from the sweet spot on the meter.
  function release(p, quality) {
    const b = g.ball;
    const hx = hoopOf(p), sx = p.x + p.face * 6, sy = p.y - 96;
    const dx = hx - sx, dy = RIM_Y - 6 - sy;
    const T = 0.62 + Math.abs(dx) / 1100;
    let vx = dx / T, vy = (dy - 0.5 * G * T * T) / T;
    const err = quality.err;
    // On fire, the gold zone is more than twice as forgiving.
    const perfect = Math.abs(err) < (g.fire[p.i] ? 0.1 : 0.04);
    const k = perfect ? 1 : 1 + err * 0.16 + Arcade.rand(-0.015, 0.015);
    vx *= k;
    vy *= perfect ? 1 : 1 + err * 0.05;
    Object.assign(b, { owner: null, x: sx, y: sy, vx, vy, shooter: p.i, three: Math.abs(hx - p.x) > THREE, block: p.i, blockT: 0.3, scored: false, perfect });
    p.charge = 0;
    p.charging = false;
    p.shotT = 0.4;
    g.events.push(perfect ? 'perfect' : 'shot');
    g.events.push('q' + p.i + (perfect ? 'perfect' : err < -0.12 ? 'early' : err > 0.12 ? 'late' : 'good'));
  }

  function dunk(p) {
    const b = g.ball;
    p.dunk = 0.35;
    Object.assign(b, { owner: null, x: hoopOf(p), y: RIM_Y - 18, vx: 0, vy: 300, shooter: p.i, three: false, block: p.i, blockT: 0.4, scored: false, perfect: true });
    g.events.push('dunk');
  }

  // ---------- Simulation ----------

  function step(dt) {
    if (g.pause > 0) {
      g.pause -= dt;
      updateBall(dt);
      if (g.pause <= 0) {
        g.banner = null;
        if (g.over) return endGame();
        resetPossession(g.possession);
      }
      return;
    }
    g.time -= dt;
    for (const p of g.players) updatePlayer(p, dt);
    // Players can't stand inside each other on the floor.
    const [a, c] = g.players;
    if (Math.abs(a.x - c.x) < 34 && Math.abs(a.y - c.y) < 60) {
      const push = (34 - Math.abs(a.x - c.x)) / 2 * Math.sign(a.x - c.x || 1);
      a.x += push;
      c.x -= push;
    }
    updateBall(dt);
    if (g.time <= 0 && g.ball.owner !== null || g.time <= -4) finish();
  }

  function finish() {
    if (g.over) return;
    g.time = 0;
    g.over = true;
    g.pause = 1.6;
    g.banner = { text: 'Final buzzer', t: 1.6 };
    g.events.push('buzz');
  }

  function updatePlayer(p, dt) {
    const inp = g.input[p.i];
    const b = g.ball;
    const L_ = LEVELS[level];
    p.stealT = Math.max(0, p.stealT - dt);
    p.shotT = Math.max(0, p.shotT - dt);
    if (p.dunk > 0) p.dunk -= dt;
    let mx = 0, jump = false, shoot = false;
    if (p.stun > 0) p.stun -= dt;
    else if (isHuman(p)) ({ mx, jump, shoot } = inp);
    else ({ mx, jump, shoot } = bot(p, dt));

    const hasBall = b.owner === p.i;
    const speed = SPEED * (isHuman(p) ? 1 : L_.speed) * (p.charging ? 0.25 : hasBall ? 0.9 : 1);
    if (grounded(p)) p.x += mx * speed * dt;
    else p.x += mx * speed * 0.6 * dt;
    if (mx) p.face = mx > 0 ? 1 : -1;
    if (hasBall) p.face = Math.sign(hoopOf(p) - p.x) || p.face;
    p.x = clamp(p.x, 30, W - 30);

    if (jump && grounded(p) && !p.charging) {
      p.vy = -JUMP;
      g.events.push('jump');
    }
    p.vy += G * dt;
    p.y += p.vy * dt;
    if (p.y >= FLOOR) { p.y = FLOOR; p.vy = 0; }

    // Shoot button: hold to fill the meter and release to shoot. Near the rim in the air, it dunks.
    // Without the ball it's a steal swipe (or a block, in the air).
    const pressed = shoot && !inp.heldPrev;
    if (hasBall) {
      const nearRim = Math.abs(p.x - hoopOf(p)) < 95 && p.y < FLOOR - 70;
      if (pressed && nearRim) dunk(p);
      else if (shoot) {
        p.charging = true;
        p.charge = Math.min(1.2, p.charge + dt / 0.75);
      } else if (p.charging) {
        release(p, { err: p.charge - SWEET });
      }
    } else if (pressed && p.stealT <= 0) {
      p.stealT = 0.5;
      const o = g.players[1 - p.i];
      if (b.owner === o.i && grounded(p) && Math.abs(o.x - p.x) < 52 && !o.charging) {
        const chance = isHuman(p) ? 0.38 : L_.steal;
        if (Math.random() < chance) loose(o, p);
        else g.events.push('swipe');
      } else g.events.push('swipe');
    }
    inp.heldPrev = shoot;
  }

  function loose(from, by) {
    const b = g.ball;
    b.owner = null;
    b.vx = (by.x < from.x ? 1 : -1) * Arcade.rand(120, 220);
    b.vy = -Arcade.rand(250, 400);
    b.shooter = -1;
    b.block = from.i;
    b.blockT = 0.4;
    from.stun = 0.35;
    g.events.push('steal');
  }

  function updateBall(dt) {
    const b = g.ball;
    if (b.blockT > 0 && (b.blockT -= dt) <= 0) b.block = -1;
    if (b.owner !== null) {
      placeBall();
      if (b.y > FLOOR - BALL_R - 2 && !g.players[b.owner].charging) {
        if (!b.bounced) g.events.push('bounce');
        b.bounced = true;
      } else b.bounced = false;
      return;
    }
    const prevY = b.y;
    b.vy += G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Rim ends and backboards.
    for (let h = 0; h < 2; h++) {
      for (const rx of [HOOPS[h] - RIM_R, HOOPS[h] + RIM_R]) bounceOff(b, rx, RIM_Y, 3, 0.55);
      const bx = BOARDS[h];
      if (b.y > RIM_Y - 95 && b.y < RIM_Y + 12 && Math.abs(b.x - bx) < BALL_R + 4) {
        b.x = bx + (b.x < bx ? -1 : 1) * (BALL_R + 4);
        b.vx *= -0.6;
        g.events.push('board');
      }
      // Score: falling through the hoop between the rim ends.
      if (!b.scored && prevY < RIM_Y && b.y >= RIM_Y && b.vy > 0 && Math.abs(b.x - HOOPS[h]) < RIM_R - 4) {
        b.scored = true;
        scored(h);
      }
    }
    // Blocks: a jumping defender's hands meet the ball on the way up.
    for (const p of g.players) {
      if (p.i === b.block || p.i === b.shooter && b.blockT > 0) continue;
      const hx = p.x, hy = p.y - 112;
      if (b.shooter >= 0 && !grounded(p) && Math.hypot(b.x - hx, b.y - hy) < BALL_R + 18 && !b.scored) {
        b.vx = p.face * Arcade.rand(150, 300);
        b.vy = Math.min(b.vy, -100) * 0.5;
        b.shooter = -1;
        b.block = p.i;
        b.blockT = 0.3;
        g.events.push('block');
        if (isHuman(p) && mode === 'bot') Arcade.flag('hoop-duel-block');
      }
    }
    if (b.y > FLOOR - BALL_R) {
      b.y = FLOOR - BALL_R;
      b.vy = -Math.abs(b.vy) * 0.62;
      b.vx *= 0.85;
      if (Math.abs(b.vy) > 60) g.events.push('bounce');
      // A missed shot hitting the floor is a live rebound, and cools the shooter off.
      if (b.shooter >= 0 && !b.scored) cool(b.shooter);
      b.shooter = -1;
    }
    if (b.x < BALL_R || b.x > W - BALL_R) {
      b.x = clamp(b.x, BALL_R, W - BALL_R);
      b.vx *= -0.6;
    }
    if (b.y < 10) { b.y = 10; b.vy = Math.abs(b.vy) * 0.5; }

    // Anyone can grab a loose ball within reach, unless it just left their hands.
    if (g.pause > 0 || b.scored) return;
    for (const p of g.players) {
      if (p.i === b.block || p.stun > 0) continue;
      const top = p.y - 120;
      if (Math.abs(b.x - p.x) < 30 && b.y > top && b.y < p.y && !(b.shooter >= 0 && b.vy < 0)) {
        b.owner = p.i;
        b.shooter = -1;
        p.charge = 0;
        p.charging = false;
        g.events.push('catch');
        break;
      }
    }
  }

  function cool(i) {
    g.streak[i] = 0;
    if (g.fire[i]) { g.fire[i] = false; g.events.push('cold' + i); }
  }

  function bounceOff(b, cx, cy, r, rest) {
    const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), min = BALL_R + r;
    if (d >= min || d === 0) return;
    const nx = dx / d, ny = dy / d;
    const dot = b.vx * nx + b.vy * ny;
    if (dot < 0) {
      b.vx -= (1 + rest) * dot * nx;
      b.vy -= (1 + rest) * dot * ny;
      g.events.push('rim');
    }
    b.x = cx + nx * min;
    b.y = cy + ny * min;
  }

  // Hoop h belongs to the player attacking it, so that's who scores (even off an own tip-in).
  function scored(h) {
    const b = g.ball;
    const pts = b.three && b.shooter === h ? 3 : 2;
    g.score[h] += pts;
    g.possession = 1 - h;
    g.pause = 1.2;
    g.banner = { text: b.perfect && pts === 3 ? 'PERFECT 3!' : b.perfect ? 'SWISH!' : pts === 3 ? '3 POINTS' : '2 POINTS', team: h, t: 1.2 };
    g.events.push('score' + h + (pts === 3 ? 'three' : g.players[h].dunk > 0 ? 'dunk' : ''));
    b.vx *= 0.2;
    cool(1 - h);
    if (++g.streak[h] >= FIRE_AT && !g.fire[h]) {
      g.fire[h] = true;
      g.events.push('fire' + h);
      g.banner = { text: 'ON FIRE!', team: h, t: 1.2 };
      if (isHuman(g.players[h]) && mode === 'bot') Arcade.flag('hoop-duel-fire');
    }
    if (isHuman(g.players[h]) && mode === 'bot' && pts === 3) Arcade.flag('hoop-duel-three');
    if (g.score[h] >= WIN_AT) {
      g.over = true;
      g.pause = 1.6;
    }
  }

  // ---------- Bot ----------

  function bot(p, dt) {
    const L_ = LEVELS[level];
    const b = g.ball, o = g.players[1 - p.i];
    const hx = hoopOf(p), towards = Math.sign(hx - p.x);
    const out = { mx: 0, jump: false, shoot: false };
    p.think -= dt;

    if (b.owner === p.i) {
      if (!p.plan) {
        const r = Math.random();
        p.plan = { spot: r < 0.35 ? THREE + 30 : r < 0.7 ? 170 : 40, wait: Arcade.rand(0.3, 1.1), release: SWEET + Arcade.rand(-L_.aim, L_.aim) };
      }
      const dist = Math.abs(hx - p.x);
      if (p.charging) {
        out.shoot = p.charge < p.plan.release;
        if (!out.shoot) p.plan = null;
        return out;
      }
      if (p.plan.spot < 60) {
        // Drive and dunk.
        out.mx = towards;
        if (dist < 150 && grounded(p)) out.jump = true;
        if (!grounded(p) && dist < 90 && p.vy > -200) out.shoot = true;
        return out;
      }
      if (dist > p.plan.spot + 10) out.mx = towards;
      else if ((p.plan.wait -= dt) <= 0 || Math.abs(o.x - p.x) > 90) out.shoot = true;
      // Back off if the defender is right on top of us.
      if (Math.abs(o.x - p.x) < 40 && dist < p.plan.spot + 60 && Math.random() < dt * 2) out.mx = -towards;
      return out;
    }
    p.plan = null;

    if (b.owner === o.i) {
      // Defend: stay between them and our hoop (which they attack).
      const guard = hoopOf(o);
      const tx = o.x + Math.sign(guard - o.x) * 46;
      out.mx = Math.abs(tx - p.x) > 8 ? Math.sign(tx - p.x) : 0;
      if (o.charging && p.think <= 0 && Math.abs(o.x - p.x) < 80) {
        p.think = L_.react + 0.4;
        setTimeout(() => { if (g && !isHuman(p)) p.queuedJump = true; }, L_.react * 1000);
      }
      if (p.queuedJump) {
        out.jump = true;
        p.queuedJump = false;
      }
      if (Math.abs(o.x - p.x) < 50 && Math.random() < dt * 1.5) out.shoot = true;
      return out;
    }
    // Loose ball: chase it, jump for high rebounds.
    out.mx = Math.abs(b.x - p.x) > 10 ? Math.sign(b.x - p.x) : 0;
    if (b.y < FLOOR - 140 && Math.abs(b.x - p.x) < 60 && b.vy > 0) out.jump = true;
    return out;
  }

  // ---------- Flow ----------

  function endGame() {
    state = 'over';
    Sports.stopCrowd();
    const mine = g.score[me], theirs = g.score[1 - me];
    if (mode === 'bot') {
      const L_ = LEVELS[level];
      const won = mine > theirs;
      if (won) Arcade.flag('hoop-duel-win');
      if (won && level === 2) Arcade.flag('hoop-duel-hard');
      Arcade.finish(ui, {
        score: AUTOPILOT ? 0 : Math.round((mine * 15 + (won ? 300 : mine === theirs ? 100 : 0)) * L_.mult),
        title: won ? 'You win!' : mine === theirs ? "It's a tie" : 'You lost',
        lines: [`${mine} – ${theirs} · ${L_.name} bot`],
        button: 'Menu',
        onAction: () => showMenu(),
      });
      return;
    }
    if (mode === 'host' && net) {
      net.events.push(...g.events.splice(0));
      net.conn.state(snapshot());
    }
    showOnlineResult();
  }

  function begin() {
    newGame();
    state = 'playing';
    ui.hide();
    fx.clear();
    trail = [];
    Sports.startCrowd();
    Sports.sfx.whistle();
  }

  function startBot(lv) {
    level = lv;
    Arcade.save('hoop:level', lv);
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

  function showMenu(error = '') {
    leaveNet();
    state = 'menu';
    mode = 'bot';
    me = 0;
    newGame();
    const online = Relay.enabled;
    ui.show({
      title: 'Hoop Duel',
      html: `<p>One on one, full court. First to ${WIN_AT} or the most points when two minutes are up.</p>
        <ul>
          <li>Hold <b class="kbd-only">Space</b><b class="touch-only">Shoot</b> to fill the shot meter and let go in the gold zone. Perfect timing never misses.</li>
          <li>Jump (<b class="kbd-only">↑</b><b class="touch-only">Jump</b>) near the rim and press <span class="kbd-only">Space</span><span class="touch-only">Shoot</span> to dunk.</li>
          <li>On defence, <span class="kbd-only">Space</span><span class="touch-only">Shoot</span> swipes for a steal, and jumping blocks shots.</li>
        </ul>
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

  // ---------- Network ----------

  function snapshot() {
    return {
      t: Math.round(g.time * 10) / 10, s: g.score, pz: Math.round(g.pause * 10) / 10,
      bn: g.banner ? [g.banner.text, g.banner.team ?? -1] : null,
      p: g.players.map(p => [Math.round(p.x), Math.round(p.y), p.face, Math.round(p.charge * 100) / 100, p.charging ? 1 : 0, p.dunk > 0 ? 1 : 0, p.shotT > 0 ? 1 : 0, p.stealT > 0.3 ? 1 : 0]),
      b: [Math.round(g.ball.x), Math.round(g.ball.y), g.ball.owner ?? -1],
      f: g.fire.map(Number),
      e: net.events.splice(0),
      over: state === 'over' ? 1 : 0,
    };
  }

  function applySnapshot(s) {
    snaps = [snaps[1] || { s, at: performance.now() }, { s, at: performance.now() }];
    g.time = s.t;
    g.score = s.s;
    g.pause = s.pz;
    g.banner = s.bn ? { text: s.bn[0], team: s.bn[1] < 0 ? undefined : s.bn[1] } : null;
    s.p.forEach(([, , face, charge, charging, dunked, shot, swipe], i) => Object.assign(g.players[i], { face, charge, charging: !!charging, dunk: dunked ? 0.1 : 0, shotT: shot ? 0.1 : 0, stealT: swipe ? 0.4 : 0 }));
    if (s.f) g.fire = s.f.map(Boolean);
    sounds(s.e);
    if (s.over && state === 'playing') {
      state = 'over';
      showOnlineResult();
    }
  }

  function guestPositions() {
    if (snaps.length < 2) return;
    const [a, c] = snaps;
    const k = Math.min(1.3, (performance.now() - c.at) / (SEND_EVERY * 1000));
    g.players.forEach((p, i) => {
      p.x = a.s.p[i][0] + (c.s.p[i][0] - a.s.p[i][0]) * k;
      p.y = a.s.p[i][1] + (c.s.p[i][1] - a.s.p[i][1]) * k;
    });
    g.ball.x = a.s.b[0] + (c.s.b[0] - a.s.b[0]) * k;
    g.ball.y = a.s.b[1] + (c.s.b[1] - a.s.b[1]) * k;
    g.ball.owner = c.s.b[2] >= 0 ? c.s.b[2] : null;
  }

  async function goOnline(how, code) {
    let cancelled = false;
    const cancel = () => { cancelled = true; showMenu(); };
    ui.show({ title: 'Connecting…', html: Relay.CONNECTING, button: 'Cancel', onAction: cancel, onRender: Relay.ticker });
    const handlers = {
      ready: () => {
        if (cancelled || !net) return;
        net.conn.send('hello', { name: Arcade.profile().name });
        if (me === 0) startOnline();
      },
      event: onNet,
      state: s => { if (mode === 'guest' && g) applySnapshot(s); },
      left: opponentGone,
      closed: () => { if (net) opponentGone(true); },
    };
    try {
      const res = how === 'quick' ? await Relay.quickMatch('hoops', handlers, 'Match')
        : how === 'create' ? await Relay.createRoom('hoops', handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom('hoops', code, handlers);
      if (cancelled) { res.conn.close(); return; }
      me = res.slot === 1 ? 0 : 1;
      mode = me === 0 ? 'host' : 'guest';
      net = { conn: res.conn, names: [Arcade.profile().name, 'Opponent'], want: { me: false, them: false }, sendT: 0, inT: 0, lastIn: '', events: [] };
      if (me === 0) {
        ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: how === 'create'
            ? `<p>Share this code. Tip-off is as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick match.</p>',
          button: 'Cancel',
          onAction: cancel,
        });
      } else {
        ui.show({ title: 'Opponent found', html: '<p>You\'re blue, shooting at the left hoop. Starting…</p>', button: null });
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
    } else if (name === 'in' && mode === 'host' && g) {
      Object.assign(g.input[1], { mx: clamp(+data.mx || 0, -1, 1), jump: !!data.j, shoot: !!data.s });
    } else if (name === 'rematch') {
      net.want.them = true;
      maybeRematch();
    } else if (name === 'quit') opponentGone();
  }

  function sendInput(dt) {
    net.inT -= dt;
    const msg = { mx: local.mx, j: local.jump ? 1 : 0, s: local.shoot ? 1 : 0 };
    const key = JSON.stringify(msg);
    if (key !== net.lastIn || net.inT <= 0) {
      net.conn.send('in', msg);
      net.lastIn = key;
      net.inT = 0.2;
    }
  }

  function maybeRematch() {
    if (mode === 'host' && net.want.me && net.want.them) startOnline();
  }

  function showOnlineResult() {
    state = 'over';
    const mine = g.score[me], theirs = g.score[1 - me];
    Arcade.countPlay();
    Arcade.flag('online-match');
    Relay.result(mine > theirs ? 'w' : mine < theirs ? 'l' : 'd');
    if (mine > theirs) Arcade.flag('hoop-duel-online-win');
    ui.show({
      title: mine > theirs ? 'You win!' : mine === theirs ? "It's a tie" : 'You lost',
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

  // lost: our own connection dropped. Nobody wins that, so it isn't counted.
  function opponentGone(lost = false) {
    if (!net) return;
    const name = net.names[1];
    const wasPlaying = state === 'playing';
    leaveNet(false);
    if (lost) {
      if (wasPlaying) state = 'over';
      ui.show({ title: 'Connection lost', html: '<p>Lost the connection to the game server, so this match doesn\'t count.</p>', button: 'Back to menu', onAction: () => showMenu() });
      return;
    }
    if (wasPlaying) {
      state = 'over';
      Arcade.countPlay();
      Arcade.flag('online-match');
      Relay.result('w');
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

  // ---------- Input ----------

  const keys = {};
  const local = { mx: 0, jump: false, shoot: false };
  const touch = { left: false, right: false, jump: false, shoot: false };
  function readKeys() {
    local.mx = (keys.ArrowRight || keys.KeyD || touch.right ? 1 : 0) - (keys.ArrowLeft || keys.KeyA || touch.left ? 1 : 0);
    local.jump = !!(keys.ArrowUp || keys.KeyW || touch.jump);
    local.shoot = !!(keys.Space || keys.KeyX || touch.shoot);
  }
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    keys[e.code] = true;
    readKeys();
  });
  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    readKeys();
  });
  function hold(id, key) {
    const el = $(id);
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); touch[key] = true; readKeys(); });
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { touch[key] = false; readKeys(); });
  }
  hold('t-left', 'left');
  hold('t-right', 'right');
  hold('t-jump', 'jump');
  hold('t-shoot', 'shoot');
  Arcade.onBlur(() => {
    for (const k in keys) keys[k] = false;
    readKeys();
    pause();
  });

  // ---------- Sound ----------

  // Sounds and effects for what just happened. The guest gets the same events from the host.
  function sounds(events) {
    const S = Sports.sfx, b = g.ball;
    for (const e of events) {
      if (e === 'bounce') S.bounce();
      else if (e === 'rim') { S.clank(); fx.sparks(b.x, b.y, 6, '#ff9a5a', 90); }
      else if (e === 'board') S.thud(0.5);
      else if (e === 'shot' || e === 'perfect') Sports.noise(0.1, { vol: 0.04, from: 1500, to: 600, type: 'bandpass' });
      else if (e === 'dunk') { S.thud(1.4); S.clank(); shake.kick(9); excite = 1; S.cheer(1.2); }
      else if (e === 'block') { S.thud(1); fx.text(b.x, b.y - 24, 'BLOCKED!', '#ff7a7a', 26); S.cheer(0.6); shake.kick(4); }
      else if (e === 'steal') { S.pop(); fx.text(b.x, b.y - 24, 'STOLEN!', '#5ec8d8', 24); S.cheer(0.4); }
      else if (e === 'swipe') Sports.noise(0.06, { vol: 0.03, from: 2500, to: 1200, type: 'bandpass' });
      else if (e === 'jump') Sports.tone(300, { to: 420, dur: 0.06, type: 'triangle', vol: 0.02 });
      else if (e[0] === 'q') {
        // Shot timing label over the shooter's head.
        const p = g.players[+e[1]], kind = e.slice(2);
        const [txt, col] = { perfect: ['PERFECT', '#ffc53d'], early: ['EARLY', '#7ab8ff'], late: ['LATE', '#ff7a7a'], good: ['GOOD', '#e6e9ef'] }[kind];
        fx.text(p.x, p.y - 140, txt, col, kind === 'perfect' ? 24 : 18);
      } else if (e.startsWith('score')) {
        const h = +e[5], big = e.endsWith('three') || e.endsWith('dunk');
        S.swish();
        swish[h] = 1;
        excite = big ? 1 : 0.6;
        S.cheer(big ? 1.3 : 0.7);
        if (h !== me && mode !== 'bot') S.groan();
        if (big) {
          fx.confetti(HOOPS[h], RIM_Y - 20, 90, [COLORS[h][0], '#ffffff', '#ff5d5d', '#3ddc84']);
          shake.kick(4);
        }
      } else if (e.startsWith('fire')) {
        const h = +e[4];
        S.horn();
        for (let i = 0; i < 4; i++) setTimeout(() => fx.firework(Arcade.rand(160, W - 160), Arcade.rand(70, 170), Arcade.pick(['#ff8a3d', '#ffc53d', '#ff5d5d'])), i * 200);
        fx.text(g.players[h].x, g.players[h].y - 150, 'ON FIRE', '#ff8a3d', 28);
      } else if (e.startsWith('cold')) fx.text(g.players[+e[4]].x, g.players[+e[4]].y - 150, 'cooled off', '#7ab8ff', 16);
      else if (e === 'buzz') S.buzzer();
    }
  }

  // ---------- Drawing ----------

  function renderCourt() {
    const c = court.ctx;
    const sky = c.createLinearGradient(0, 0, 0, FLOOR);
    sky.addColorStop(0, '#141826');
    sky.addColorStop(1, '#232a3d');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, FLOOR);
    // Roof truss and spotlights above the stands (the crowd itself is drawn live).
    c.fillStyle = '#0c0f18';
    c.fillRect(0, 0, W, 44);
    c.strokeStyle = '#262c3d';
    c.lineWidth = 2;
    for (let x = 0; x < W; x += 40) { c.beginPath(); c.moveTo(x, 6); c.lineTo(x + 20, 38); c.lineTo(x + 40, 6); c.stroke(); }
    c.strokeRect(-2, 6, W + 4, 32);
    for (const x of [120, 330, 630, 840]) {
      const glow = c.createRadialGradient(x, 30, 2, x, 30, 60);
      glow.addColorStop(0, 'rgba(255,250,230,0.9)');
      glow.addColorStop(1, 'rgba(255,250,230,0)');
      c.fillStyle = glow;
      c.fillRect(x - 60, 0, 120, 90);
    }
    // LED ad boards at courtside.
    c.fillStyle = '#0d1018';
    c.fillRect(0, 190, W, 30);
    const ads = [['PIXEL PIONEERS', '#ffc53d'], ['HOOP DUEL', '#ff7a5a'], ['ICE CLASH', '#5ec8d8'], ['APEX GP', '#3ddc84'], ['GRAND SLAM', '#c77dff']];
    c.font = '900 15px system-ui, sans-serif';
    c.textAlign = 'center';
    ads.forEach(([t, col], i) => {
      const x = 96 + i * 192;
      c.fillStyle = 'rgba(255,255,255,0.04)';
      c.fillRect(x - 90, 193, 180, 24);
      c.fillStyle = col;
      c.fillText(t, x, 211);
    });
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(0, 190, W, 2);
    const wood = c.createLinearGradient(0, FLOOR, 0, H);
    wood.addColorStop(0, '#c98e52');
    wood.addColorStop(1, '#a5703c');
    c.fillStyle = wood;
    c.fillRect(0, FLOOR - 40, W, H - FLOOR + 40);
    // Arena wall behind the baseline, with championship banners.
    const wall = c.createLinearGradient(0, 220, 0, FLOOR - 40);
    wall.addColorStop(0, '#151a28');
    wall.addColorStop(1, '#232a3d');
    c.fillStyle = wall;
    c.fillRect(0, 220, W, FLOOR - 260);
    [[250, '#ffc53d', '7'], [370, '#4f8cff', '23'], [590, '#ff7a5a', '11'], [710, '#3ddc84', '32']].forEach(([x, col, n]) => {
      c.fillStyle = col;
      c.beginPath(); c.moveTo(x - 22, 228); c.lineTo(x + 22, 228); c.lineTo(x + 22, 300); c.lineTo(x, 288); c.lineTo(x - 22, 300); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.font = '900 20px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(n, x, 266);
    });
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(0, FLOOR - 70, W, 30);
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.lineWidth = 1;
    for (let x = 0; x < W; x += 38) { c.beginPath(); c.moveTo(x, FLOOR - 40); c.lineTo(x - 30, H); c.stroke(); }
    // Varnish: a soft band of light across the boards.
    const gloss = c.createLinearGradient(0, FLOOR - 40, 0, H);
    gloss.addColorStop(0, 'rgba(255,255,255,0.18)');
    gloss.addColorStop(0.35, 'rgba(255,255,255,0.04)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = gloss;
    c.fillRect(0, FLOOR - 40, W, H - FLOOR + 40);
    // Centre court logo.
    c.fillStyle = 'rgba(255,197,61,0.25)';
    c.beginPath(); c.ellipse(W / 2, FLOOR + 10, 70, 22, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(28,21,0,0.55)';
    c.font = '900 italic 22px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('PP', W / 2, FLOOR + 18);
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(W / 2, FLOOR - 40); c.lineTo(W / 2, H); c.stroke();
    c.beginPath(); c.ellipse(W / 2, FLOOR + 10, 70, 22, 0, 0, Math.PI * 2); c.stroke();
    // Three-point lines and painted keys.
    for (const hx of HOOPS) {
      const s = hx > W / 2 ? -1 : 1;
      c.fillStyle = 'rgba(180,60,60,0.45)';
      c.fillRect(Math.min(hx - s * 30, hx + s * 150), FLOOR - 30, 180, 50);
      c.beginPath(); c.moveTo(hx + s * THREE, FLOOR - 40); c.lineTo(hx + s * THREE, H); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.font = '700 14px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('3PT', hx + s * (THREE + 26), H - 12);
    }
    // Backboards and poles.
    for (let h = 0; h < 2; h++) {
      const bx = BOARDS[h], s = h === 0 ? 1 : -1;
      c.fillStyle = '#3a3f48';
      c.fillRect(bx + s * 20 - 5, RIM_Y - 60, 10, FLOOR - RIM_Y + 60);
      c.fillRect(Math.min(bx, bx + s * 22), RIM_Y - 50, 22, 8);
      c.fillStyle = 'rgba(230,240,255,0.85)';
      c.fillRect(bx - 4, RIM_Y - 100, 8, 116);
      c.strokeStyle = '#d64545';
      c.lineWidth = 2;
      c.strokeRect(bx - 4, RIM_Y - 100, 8, 116);
    }
  }

  function drawHoopFront(h) {
    const hx = HOOPS[h];
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    // After a basket the net whips down and ripples back.
    const k = swish[h], tt = performance.now() / 45;
    const stretch = 40 + k * 14, sway = k * Math.sin(tt) * 4;
    for (let i = 0; i <= 6; i++) {
      const x0 = hx - RIM_R + (i * RIM_R * 2) / 6;
      const x1 = hx - RIM_R * (0.55 - k * 0.2) + (i * RIM_R * (1.1 - k * 0.4)) / 6 + sway;
      ctx.beginPath(); ctx.moveTo(x0, RIM_Y); ctx.quadraticCurveTo((x0 + x1) / 2 + sway * 0.5, RIM_Y + stretch * 0.5, x1, RIM_Y + stretch); ctx.stroke();
    }
    for (const f of [0.35, 0.7]) {
      const w = RIM_R * (0.85 - f * 0.3 - k * 0.15);
      ctx.beginPath(); ctx.moveTo(hx - w + sway * f, RIM_Y + stretch * f); ctx.lineTo(hx + w + sway * f, RIM_Y + stretch * f); ctx.stroke();
    }
    ctx.strokeStyle = '#ff6a2b';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(hx, RIM_Y, RIM_R, 5, 0, 0, Math.PI * 2); ctx.stroke();
  }

  function drawPlayer(p, mirror = false) {
    const [shirt, dark] = COLORS[p.i];
    const x = p.x, y = p.y;
    const air = !grounded(p);
    const t = performance.now() / 120;
    const run = grounded(p) && Math.abs(g.input[p.i].mx || 0) > 0 && state === 'playing' ? Math.sin(t) * 8 : 0;
    const skin = p.i === 0 ? '#8a5a3c' : '#c99068';
    const skinDark = p.i === 0 ? '#6a4028' : '#a87050';
    // On fire: flames lick up around the player.
    if (!mirror && g.fire[p.i] && Math.random() < 0.6) fx.dust(x + Arcade.rand(-14, 14), y - Arcade.rand(20, 90), 1, Arcade.pick(['rgba(255,138,61,0.7)', 'rgba(255,197,61,0.7)', 'rgba(255,93,93,0.6)']), 30);
    // Legs with socks and sneakers.
    ctx.lineCap = 'round';
    for (const [sd, off] of [[-1, run], [1, -run]]) {
      const fx0 = x + sd * 7 + off, fy = y - (air ? 8 : 3);
      ctx.strokeStyle = skinDark;
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(x + sd * 6, y - 34); ctx.lineTo(fx0, fy - 6); ctx.stroke();
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = 7.5;
      ctx.beginPath(); ctx.moveTo(fx0 - (fx0 - x - sd * 6) * 0.2, fy - 12); ctx.lineTo(fx0, fy - 3); ctx.stroke();
      ctx.fillStyle = shirt;
      ctx.beginPath(); ctx.roundRect(fx0 - 6 + p.face * 2, fy - 3, 13, 6, 3); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(fx0 - 6 + p.face * 2, fy + 1, 13, 2);
    }
    // Shorts with a side stripe.
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.roundRect(x - 14, y - 46, 28, 17, 3); ctx.fill();
    ctx.fillStyle = shirt;
    ctx.fillRect(x - 14, y - 46, 3, 17);
    ctx.fillRect(x + 11, y - 46, 3, 17);
    // Jersey, shaded on the side away from the lights.
    const jg = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
    jg.addColorStop(0, shirt);
    jg.addColorStop(1, shade(shirt, -0.25));
    ctx.fillStyle = jg;
    ctx.beginPath(); ctx.roundRect(x - 14, y - 82, 28, 40, 6); ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 6, y - 82); ctx.lineTo(x, y - 75); ctx.lineTo(x + 6, y - 82); ctx.stroke();
    ctx.fillStyle = dark;
    ctx.font = '900 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.i === 0 ? '7' : '23', x, y - 56);
    // Arms: up when shooting, blocking or dunking; out front when swiping.
    const up = p.charging || p.shotT > 0 || p.dunk > 0 || (air && g.ball.owner !== p.i);
    const reach = p.stealT > 0.3;
    for (const sd of [-1, 1]) {
      let hx2, hy2;
      if (up) { hx2 = x + sd * 6 + p.face * 6; hy2 = y - 114; }
      else if (reach) { hx2 = x + p.face * 36; hy2 = y - 64; }
      else { hx2 = x + sd * 16; hy2 = y - 50; }
      ctx.strokeStyle = shirt;
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(x + sd * 11, y - 78); ctx.lineTo(x + sd * 12 + (hx2 - x - sd * 12) * 0.15, y - 78 + (hy2 - y + 78) * 0.15); ctx.stroke();
      ctx.strokeStyle = skin;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x + sd * 12, y - 76); ctx.lineTo(hx2, hy2); ctx.stroke();
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(hx2, hy2, 4, 0, Math.PI * 2); ctx.fill();
    }
    // Head: ear, eye, hair and a headband in the team colour.
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(x, y - 94, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skinDark;
    ctx.beginPath(); ctx.arc(x - p.face * 3, y - 93, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(x + p.face * 6, y - 96, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - 97, 11, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    ctx.fillStyle = g.fire[p.i] ? '#ff8a3d' : shirt;
    ctx.fillRect(x - 11, y - 101, 22, 4);
    if (mirror) return;
    if (p.i === me && !AUTOPILOT) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(x - 6, y - 128); ctx.lineTo(x + 6, y - 128); ctx.lineTo(x, y - 120); ctx.fill();
    }
    // Shot meter.
    if (p.charging) {
      const mx = x + p.face * -34, top = y - 120, h = 80;
      ctx.fillStyle = 'rgba(10,12,16,0.75)';
      ctx.fillRect(mx - 6, top, 12, h);
      ctx.fillStyle = 'rgba(255,197,61,0.45)';
      ctx.fillRect(mx - 6, top + h * (1 - (SWEET + 0.04) / 1.2), 12, h * 0.08 / 1.2);
      const fill = Math.min(1.2, p.charge) / 1.2;
      const close = Math.abs(p.charge - SWEET) < 0.04;
      ctx.fillStyle = close ? '#ffc53d' : p.charge > SWEET ? '#ff7a7a' : '#3ddc84';
      ctx.fillRect(mx - 4, top + h * (1 - fill), 8, h * fill);
    }
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16), f = c => Math.round(clamp(k < 0 ? c * (1 + k) : c + (255 - c) * k, 0, 255));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function drawBall() {
    const b = g.ball;
    // A comet tail while it's in the air; flames when the shooter is on fire.
    const hot = b.owner === null && b.shooter >= 0 && g.fire[b.shooter];
    trail.forEach((q, i) => {
      const k = i / trail.length;
      ctx.fillStyle = hot ? `rgba(255,${120 + k * 100 | 0},40,${k * 0.6})` : `rgba(255,255,255,${k * 0.22})`;
      ctx.beginPath(); ctx.arc(q.x, q.y, BALL_R * (0.3 + k * 0.6) * (hot ? 1.3 : 1), 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(b.x, FLOOR + 4, BALL_R * (0.5 + 0.5 * (b.y / FLOOR)), 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8762b';
    ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a2a10';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(b.x - BALL_R, b.y); ctx.lineTo(b.x + BALL_R, b.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(b.x - 4, b.y - 4, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // The jumbotron hanging over centre court.
  function drawJumbotron() {
    const x = W / 2, y = 8, w = 280, h = 70;
    ctx.strokeStyle = '#3a4050';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 100, 0); ctx.lineTo(x - 100, y); ctx.moveTo(x + 100, 0); ctx.lineTo(x + 100, y); ctx.stroke();
    ctx.fillStyle = '#1b2030';
    ctx.beginPath(); ctx.roundRect(x - w / 2 - 6, y, w + 12, h + 10, 8); ctx.fill();
    ctx.fillStyle = '#05070c';
    ctx.fillRect(x - w / 2, y + 5, w, h);
    ctx.textAlign = 'center';
    for (const i of [0, 1]) {
      const cx = x + (i ? 92 : -92);
      ctx.fillStyle = g.fire[i] ? '#ff8a3d' : COLORS[i][0];
      ctx.font = '800 11px system-ui, sans-serif';
      ctx.fillText(g.fire[i] ? 'ON FIRE' : i === 0 ? 'HOME' : 'AWAY', cx, y + 22);
      ctx.fillStyle = COLORS[i][0];
      ctx.font = '900 32px ui-monospace, monospace';
      ctx.shadowColor = COLORS[i][0];
      ctx.shadowBlur = 10;
      ctx.fillText(String(g.score[i]).padStart(2, '0'), cx, y + 58);
      ctx.shadowBlur = 0;
    }
    const t = Math.max(0, Math.ceil(g.time));
    ctx.fillStyle = t <= 10 && state === 'playing' ? '#ff5d5d' : '#ff9a5a';
    ctx.font = '700 24px ui-monospace, monospace';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8;
    ctx.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, x, y + 46);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#5a6278';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(`FIRST TO ${WIN_AT}`, x, y + 66);
    // Scanlines.
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let yy = y + 5; yy < y + 5 + h; yy += 3) ctx.fillRect(x - w / 2, yy, w, 1);
  }

  function draw(dt = 0) {
    excite = Math.max(0, excite - dt * 0.35);
    swish = swish.map(v => Math.max(0, v - dt * 1.4));
    const b0 = g.ball;
    if (b0.owner === null && dt > 0) { trail.push({ x: b0.x, y: b0.y }); if (trail.length > 10) trail.shift(); }
    else if (b0.owner !== null) trail = [];
    shake.apply(ctx, dt);
    ctx.drawImage(court.canvas, 0, 0, W, H);
    crowd.draw(ctx, 0, 42, state === 'playing' ? excite : 0, performance.now() / 1000);
    drawJumbotron();

    // Reflections in the varnished floor.
    ctx.save();
    ctx.beginPath(); ctx.rect(0, FLOOR, W, H - FLOOR); ctx.clip();
    ctx.globalAlpha = 0.13;
    ctx.translate(0, FLOOR * 2 + 6);
    ctx.scale(1, -1);
    for (const p of g.players) drawPlayer(p, true);
    ctx.restore();
    for (const p of g.players) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(p.x, FLOOR + 4, 22 - (FLOOR - p.y) * 0.05, 6, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const p of g.players) drawPlayer(p);
    const b = g.ball;
    // The ball goes behind the net when it's dropping through.
    const behind = b.owner === null && Math.abs(b.y - RIM_Y) < 44 && HOOPS.some(h => Math.abs(b.x - h) < RIM_R);
    if (behind) drawBall();
    drawHoopFront(0);
    drawHoopFront(1);
    if (!behind) drawBall();

    fx.update(dt);
    fx.draw(ctx);
    ctx.restore();
    Sports.lighting(ctx, W, H, 0.22);

    if (g.banner) {
      ctx.font = '900 italic 54px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const band = ctx.createLinearGradient(0, 0, W, 0);
      band.addColorStop(0, 'rgba(10,12,16,0)');
      band.addColorStop(0.2, 'rgba(10,12,16,0.75)');
      band.addColorStop(0.8, 'rgba(10,12,16,0.75)');
      band.addColorStop(1, 'rgba(10,12,16,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, 140, W, 80);
      ctx.fillStyle = g.banner.text.includes('FIRE') ? '#ff8a3d' : g.banner.team !== undefined ? COLORS[g.banner.team][0] : '#fff';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeText(g.banner.text, W / 2, 198);
      ctx.fillText(g.banner.text, W / 2, 198);
    }
    if (net && state === 'playing') {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(`${me === 0 ? net.names[0] : net.names[1]} (yellow) vs ${me === 0 ? net.names[1] : net.names[0]} (blue)`, W / 2, 80);
    }
  }

  function updateHud() {
    $('you').textContent = g.score[me];
    $('them').textContent = g.score[1 - me];
    $('ball').textContent = g.ball.owner === null ? 'Loose' : g.ball.owner === me ? 'Yours' : 'Theirs';
  }

  // ---------- Loop ----------

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state === 'playing' && g) {
      if (mode === 'guest') {
        sendInput(dt);
        guestPositions();
      } else {
        Object.assign(g.input[0], local);
        acc += AUTOPILOT ? dt * 2 : dt;
        while (acc >= STEP) {
          step(STEP);
          acc -= STEP;
          if (state !== 'playing') break;
        }
        const events = g.events.splice(0);
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
    draw(state === 'paused' ? 0 : dt);
    if (g) updateHud();
    requestAnimationFrame(frame);
  }

  renderCourt();
  showMenu();
  const invite = Relay.takeInvite();
  if (invite) goOnline('public', invite);
  requestAnimationFrame(frame);
})();
