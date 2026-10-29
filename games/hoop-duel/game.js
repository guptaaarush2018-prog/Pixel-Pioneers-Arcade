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
  const isHuman = p => mode !== 'bot' || p.i === 0;

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
    const perfect = Math.abs(err) < 0.04;
    const k = perfect ? 1 : 1 + err * 0.16 + Arcade.rand(-0.015, 0.015);
    vx *= k;
    vy *= perfect ? 1 : 1 + err * 0.05;
    Object.assign(b, { owner: null, x: sx, y: sy, vx, vy, shooter: p.i, three: Math.abs(hx - p.x) > THREE, block: p.i, blockT: 0.3, scored: false, perfect });
    p.charge = 0;
    p.charging = false;
    p.shotT = 0.4;
    g.events.push(perfect ? 'perfect' : 'shot');
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
      // A missed shot hitting the floor is a live rebound.
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
    g.events.push('score' + h);
    b.vx *= 0.2;
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
    const mine = g.score[me], theirs = g.score[1 - me];
    if (mode === 'bot') {
      const L_ = LEVELS[level];
      const won = mine > theirs;
      if (won) Arcade.flag('hoop-duel-win');
      if (won && level === 2) Arcade.flag('hoop-duel-hard');
      Arcade.finish(ui, {
        score: Math.round((mine * 15 + (won ? 300 : mine === theirs ? 100 : 0)) * L_.mult),
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
    Arcade.tone({ freq: 660, to: 990, dur: 0.25, type: 'triangle', vol: 0.05 });
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
          <li>Hold <b>Space</b> to fill the shot meter and let go in the gold zone. Perfect timing never misses.</li>
          <li>Jump (<b>↑</b>) near the rim and press Space to dunk.</li>
          <li>On defence, Space swipes for a steal, and jumping blocks shots.</li>
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
    ui.show({ title: 'Connecting…', html: '<p>Waking up the game server. The first connection can take up to a minute.</p>', button: 'Cancel', onAction: cancel });
    const handlers = {
      ready: () => {
        if (cancelled || !net) return;
        net.conn.send('hello', { name: Arcade.profile().name });
        if (me === 0) startOnline();
      },
      event: onNet,
      state: s => { if (mode === 'guest' && g) applySnapshot(s); },
      left: opponentGone,
      closed: () => { if (net) opponentGone(); },
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

  function sounds(events) {
    for (const e of events) {
      if (e === 'bounce') Arcade.tone({ freq: 110, to: 70, dur: 0.06, type: 'square', vol: 0.03 });
      else if (e === 'rim') Arcade.tone({ freq: 700, to: 500, dur: 0.08, type: 'triangle', vol: 0.04 });
      else if (e === 'board') Arcade.tone({ freq: 180, dur: 0.06, type: 'square', vol: 0.04 });
      else if (e === 'shot' || e === 'perfect') Arcade.tone({ freq: e === 'perfect' ? 880 : 440, dur: 0.06, vol: 0.03 });
      else if (e === 'dunk') Arcade.tone({ freq: 160, to: 60, dur: 0.25, type: 'sawtooth', vol: 0.06 });
      else if (e === 'block' || e === 'steal') Arcade.tone({ freq: 240, to: 120, dur: 0.12, type: 'sawtooth', vol: 0.05 });
      else if (e === 'swipe') Arcade.tone({ freq: 500, to: 300, dur: 0.04, vol: 0.02 });
      else if (e === 'jump') Arcade.tone({ freq: 300, to: 420, dur: 0.06, type: 'triangle', vol: 0.02 });
      else if (e.startsWith('score')) {
        const good = +e.slice(5) === me;
        Arcade.tone(good ? { freq: 523, to: 1046, dur: 0.35, type: 'triangle', vol: 0.06 } : { freq: 330, to: 200, dur: 0.3, type: 'sawtooth', vol: 0.04 });
      } else if (e === 'buzz') Arcade.tone({ freq: 140, dur: 0.8, type: 'sawtooth', vol: 0.06 });
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
    // Crowd in the stands.
    for (let row = 0; row < 5; row++) {
      for (let i = 0; i < 40; i++) {
        const x = i * 25 + (row % 2) * 12, y = 60 + row * 34;
        c.fillStyle = ['#2b3247', '#333b52', '#3a2f4a', '#2f3e4a'][(i + row) % 4];
        c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill();
        c.fillRect(x - 11, y + 8, 22, 18);
      }
    }
    c.fillStyle = '#1a1f2c';
    c.fillRect(0, 230, W, 20);
    const wood = c.createLinearGradient(0, FLOOR, 0, H);
    wood.addColorStop(0, '#c98e52');
    wood.addColorStop(1, '#a5703c');
    c.fillStyle = wood;
    c.fillRect(0, FLOOR - 40, W, H - FLOOR + 40);
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.lineWidth = 1;
    for (let x = 0; x < W; x += 38) { c.beginPath(); c.moveTo(x, FLOOR - 40); c.lineTo(x - 30, H); c.stroke(); }
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
    const sway = g.ball.scored && Math.abs(g.ball.x - hx) < 40 && g.pause > 0.8 ? Math.sin(performance.now() / 40) * 3 : 0;
    for (let i = 0; i <= 6; i++) {
      const x0 = hx - RIM_R + (i * RIM_R * 2) / 6;
      const x1 = hx - RIM_R * 0.55 + (i * RIM_R * 1.1) / 6 + sway;
      ctx.beginPath(); ctx.moveTo(x0, RIM_Y); ctx.lineTo(x1, RIM_Y + 40); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(hx - RIM_R * 0.8, RIM_Y + 14); ctx.lineTo(hx + RIM_R * 0.8, RIM_Y + 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx - RIM_R * 0.65, RIM_Y + 28); ctx.lineTo(hx + RIM_R * 0.65, RIM_Y + 28); ctx.stroke();
    ctx.strokeStyle = '#ff6a2b';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(hx, RIM_Y, RIM_R, 5, 0, 0, Math.PI * 2); ctx.stroke();
  }

  function drawPlayer(p) {
    const [shirt, dark] = COLORS[p.i];
    const x = p.x, y = p.y;
    const air = !grounded(p);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, FLOOR + 4, 22 - (FLOOR - y) * 0.05, 6, 0, 0, Math.PI * 2); ctx.fill();
    const t = performance.now() / 120;
    const run = grounded(p) && Math.abs(g.input[p.i].mx || 0) > 0 && state === 'playing' ? Math.sin(t) * 8 : 0;
    // Legs.
    ctx.strokeStyle = '#5a3a2a';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 6, y - 34); ctx.lineTo(x - 7 + run, y - (air ? 8 : 2)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, y - 34); ctx.lineTo(x + 7 - run, y - (air ? 8 : 2)); ctx.stroke();
    ctx.fillStyle = '#eceef2';
    ctx.fillRect(x - 12 + run, y - 4, 10, 5);
    ctx.fillRect(x + 2 - run, y - 4, 10, 5);
    // Shorts and jersey.
    ctx.fillStyle = dark;
    ctx.fillRect(x - 13, y - 44, 26, 14);
    ctx.fillStyle = shirt;
    ctx.beginPath(); ctx.roundRect(x - 14, y - 82, 28, 40, 6); ctx.fill();
    ctx.fillStyle = dark;
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.i === 0 ? '7' : '23', x, y - 56);
    // Arms: up when shooting, blocking or dunking; out front when swiping.
    ctx.strokeStyle = '#7a4e36';
    ctx.lineWidth = 6;
    const up = p.charging || p.shotT > 0 || p.dunk > 0 || (air && g.ball.owner !== p.i);
    const reach = p.stealT > 0.3;
    for (const sd of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + sd * 12, y - 76);
      if (up) ctx.lineTo(x + sd * 6 + p.face * 6, y - 112);
      else if (reach) ctx.lineTo(x + p.face * 34, y - 64);
      else ctx.lineTo(x + sd * 16, y - 50);
      ctx.stroke();
    }
    // Head.
    ctx.fillStyle = '#7a4e36';
    ctx.beginPath(); ctx.arc(x, y - 94, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(x - 11, y - 101, 22, 4);
    if (p.i === me) {
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

  function drawBall() {
    const b = g.ball;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(b.x, FLOOR + 4, BALL_R * (0.5 + 0.5 * (b.y / FLOOR)), 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8762b';
    ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a2a10';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(b.x - BALL_R, b.y); ctx.lineTo(b.x + BALL_R, b.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
  }

  function draw() {
    ctx.drawImage(court.canvas, 0, 0, W, H);
    // Scoreboard.
    ctx.fillStyle = 'rgba(10,12,16,0.85)';
    ctx.beginPath(); ctx.roundRect(W / 2 - 120, 12, 240, 50, 10); ctx.fill();
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS[0][0];
    ctx.fillText(g.score[0], W / 2 - 80, 48);
    ctx.fillStyle = COLORS[1][0];
    ctx.fillText(g.score[1], W / 2 + 80, 48);
    const t = Math.max(0, Math.ceil(g.time));
    ctx.fillStyle = '#ff7a5a';
    ctx.font = '700 22px ui-monospace, monospace';
    ctx.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, W / 2, 46);

    for (const p of g.players) drawPlayer(p);
    const b = g.ball;
    // The ball goes behind the net when it's dropping through.
    const behind = b.owner === null && Math.abs(b.y - RIM_Y) < 44 && HOOPS.some(h => Math.abs(b.x - h) < RIM_R);
    if (behind) drawBall();
    drawHoopFront(0);
    drawHoopFront(1);
    if (!behind) drawBall();

    if (g.banner) {
      ctx.font = '800 54px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(10,12,16,0.6)';
      ctx.fillRect(0, 140, W, 80);
      ctx.fillStyle = g.banner.team !== undefined ? COLORS[g.banner.team][0] : '#fff';
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
        acc += dt;
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
    draw();
    if (g) updateHud();
    requestAnimationFrame(frame);
  }

  renderCourt();
  showMenu();
  const invite = Relay.takeInvite();
  if (invite) goOnline('public', invite);
  requestAnimationFrame(frame);
})();
