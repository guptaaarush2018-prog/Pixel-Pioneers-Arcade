(() => {
  const GW = 64, GH = 40, C = 12, W = GW * C, H = GH * C;
  const TICK = 1 / 14, WIN_ROUNDS = 3;
  const BOOST_TIME = 0.9, BOOST_RECHARGE = 4;
  const SHRINK_AFTER = 25, SHRINK_EVERY = 1.5, MAX_INSET = 14;
  const COLORS = ['#3de0ff', '#ff9a3d'];
  const LEVELS = ['Easy', 'Normal', 'Hard'];
  const MULT = [0.6, 1, 1.5];
  const D = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  // phase: 'menu' | 'count' | 'run' | 'gap' | 'over'
  let phase = 'menu', mode = null, level = 1, me = 0, names = ['You', 'Bot'];
  let grid, players, inset, clock, acc, countT, gapT, wins, round, first, crash = [], lastIn = '';

  // ---------- Simulation (offline, or on the host) ----------

  function newRound() {
    grid = new Uint8Array(GW * GH);
    inset = 0;
    clock = 0;
    acc = 0;
    crash = [];
    players = [
      { x: 12, y: 12, dir: 1, want: 1, alive: true, boost: 1, boosting: 0, press: false },
      { x: GW - 13, y: GH - 13, dir: 3, want: 3, alive: true, boost: 1, boosting: 0, press: false },
    ];
    players.forEach((p, i) => { grid[p.y * GW + p.x] = i + 1; });
    phase = 'count';
    countT = 3;
    updateHud();
  }

  const blocked = (x, y) => x < inset || y < inset || x >= GW - inset || y >= GH - inset || grid[y * GW + x] !== 0;

  // One tick: turn, move one square (two while boosting), and mark the trail. Returns the squares
  // filled this tick so the host can send them on.
  function step() {
    const filled = [];
    clock += TICK;
    if (clock > SHRINK_AFTER && inset < MAX_INSET && Math.floor((clock - SHRINK_AFTER) / SHRINK_EVERY) + 1 > inset) {
      inset++;
      // The closing wall catches anyone riding along the edge.
      players.forEach((p, i) => {
        if (p.alive && (p.x < inset || p.y < inset || p.x >= GW - inset || p.y >= GH - inset)) { p.alive = false; crash.push([p.x, p.y, i]); }
      });
      if (players.some(p => !p.alive)) return filled;
    }
    for (const p of players) {
      if ((p.want + 2) % 4 !== p.dir) p.dir = p.want;
      if (p.press && p.boost >= 1 && !p.boosting) { p.boosting = BOOST_TIME; p.boost = 0; }
      p.press = false;
      if (p.boosting > 0) p.boosting = Math.max(0, p.boosting - TICK);
      else p.boost = Math.min(1, p.boost + TICK / BOOST_RECHARGE);
    }
    const moves = Math.max(...players.map(p => (p.boosting > 0 ? 2 : 1)));
    for (let m = 0; m < moves; m++) {
      const next = players.map(p => (p.alive && (m === 0 || p.boosting > 0) ? { x: p.x + D[p.dir][0], y: p.y + D[p.dir][1] } : null));
      next.forEach((n, i) => {
        if (!n) return;
        const p = players[i];
        if (blocked(n.x, n.y)) { p.alive = false; crash.push([p.x, p.y, i]); }
      });
      if (next[0] && next[1] && next[0].x === next[1].x && next[0].y === next[1].y) {
        players.forEach((p, i) => { if (p.alive) { p.alive = false; crash.push([next[i].x, next[i].y, i]); } });
      }
      next.forEach((n, i) => {
        const p = players[i];
        if (!n || !p.alive) return;
        p.x = n.x;
        p.y = n.y;
        grid[p.y * GW + p.x] = i + 1;
        filled.push([p.x, p.y, i]);
      });
    }
    return filled;
  }

  function roundOver() {
    const [a, b] = players.map(p => p.alive);
    if (a && b) return null;
    return a ? 0 : b ? 1 : -1;
  }

  // ---------- Bot ----------

  // Counts open squares reachable from (x, y), up to a cap.
  function space(x, y, cap = 300) {
    if (blocked(x, y)) return 0;
    const seen = new Set([y * GW + x]), q = [[x, y]];
    while (q.length && seen.size < cap) {
      const [cx, cy] = q.shift();
      for (const [dx, dy] of D) {
        const nx = cx + dx, ny = cy + dy, k = ny * GW + nx;
        if (seen.has(k) || blocked(nx, ny)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    return seen.size;
  }

  function botThink() {
    const p = players[1], o = players[0];
    if (!p.alive) return;
    const options = [p.dir, (p.dir + 1) % 4, (p.dir + 3) % 4].map(d => {
      const nx = p.x + D[d][0], ny = p.y + D[d][1];
      let v = level === 0 ? (blocked(nx, ny) ? -1000 : 0) + Math.random() * 3 : space(nx, ny, level === 2 ? 500 : 200);
      if (d === p.dir) v += 1.5;
      // Squares the rival could reach next tick risk a head-on crash.
      if (level > 0 && o.alive && Math.abs(nx - o.x) + Math.abs(ny - o.y) <= 1) v -= 120;
      if (level === 2) v -= Math.hypot(nx - o.x, ny - o.y) * 0.05;
      return { d, v };
    });
    if (level === 0 && Math.random() < 0.08) options.forEach(o2 => { if (o2.v > -100) o2.v += Math.random() * 10; });
    options.sort((a, b) => b.v - a.v);
    p.want = options[0].d;
    if (level > 0 && p.boost >= 1 && options[0].v > 150 && Math.random() < (level === 2 ? 0.06 : 0.02)) p.press = true;
  }

  // ---------- Flow ----------

  function startMatch(s) {
    mode = s.mode;
    level = s.level;
    me = s.me;
    names = s.mode === 'cpu' ? ['You', `${LEVELS[s.level]} bot`] : s.names;
    first = s.first;
    wins = [0, 0];
    round = 0;
    lastIn = '';
    if (mode !== 'online' || me === 0) hostRound();
  }

  function hostRound() {
    newRound();
    Match.move({ k: 'go', w: wins, r: round });
  }

  function finishRound(winner) {
    phase = 'gap';
    gapT = 1.8;
    if (winner >= 0) wins[winner]++;
    round++;
    Arcade.tone(winner === me || (mode === 'local' && winner >= 0) ? { freq: 523, to: 1046, dur: 0.3, type: 'triangle', vol: 0.05 } : { freq: 200, to: 60, dur: 0.4, type: 'sawtooth', vol: 0.05 });
    updateHud();
  }

  function finishMatch() {
    phase = 'over';
    const winner = wins[0] > wins[1] ? 0 : 1;
    const mine = wins[me];
    if (winner === me && mode !== 'local' && wins[1 - me] === 0) Arcade.flag('light-trail-shutout');
    Match.over({
      winner,
      score: Math.round((mine * 250 + (winner === 0 ? 500 : 0)) * MULT[level]),
      lines: [`Rounds ${wins[0]} – ${wins[1]}`],
    });
  }

  Match.setup({
    ui,
    tag: 'lighttrail',
    title: 'Light Trail',
    levels: LEVELS,
    winFlag: 'light-trail-win',
    hardFlag: 'light-trail-hard',
    onlineWinFlag: 'light-trail-online-win',
    rules: `<ul>
      <li>Your bike leaves a solid wall behind it. Anything you hit, a wall or a trail, ends the round.</li>
      <li>Press <b>Space</b> to <b>boost</b>: double speed for a moment, then it recharges.</li>
      <li>After ${SHRINK_AFTER} seconds the arena starts to shrink. First to ${WIN_ROUNDS} rounds wins.</li>
      <li>Two on one device: Player 1 uses <b>WASD</b> + <b>Shift</b>, Player 2 uses the <b>arrows</b> + <b>/</b>.</li>
    </ul>`,
    onStart: startMatch,
    onMove: onNet,
    onStop: () => { phase = 'over'; },
  });

  // Online: the host runs the bikes and sends the squares filled each tick; the guest sends its turns.
  function onNet(d) {
    if (me === 0) {
      if (d.k === 'in' && players && D[d.d | 0]) {
        players[1].want = d.d | 0;
        if (d.b) players[1].press = true;
      }
      return;
    }
    if (d.k === 'go') {
      wins = d.w || [0, 0];
      round = d.r | 0;
      newRound();
    } else if (d.k === 't' && grid) {
      phase = 'run';
      for (const [x, y, i] of d.c || []) if (x >= 0 && y >= 0 && x < GW && y < GH) grid[y * GW + x] = i + 1;
      inset = d.i | 0;
      (d.h || []).forEach((h, i) => Object.assign(players[i], { x: h[0], y: h[1], dir: h[2], boost: h[3], boosting: h[4] ? 1 : 0, alive: !!h[5] }));
      if (d.x) crash.push(...d.x);
    } else if (d.k === 'round') {
      finishRound(d.w);
    } else if (d.k === 'end') {
      wins = d.w;
      finishMatch();
    }
  }

  function update(dt) {
    if (phase === 'count') {
      countT -= dt;
      if (countT <= 0) phase = 'run';
      return;
    }
    if (phase === 'gap') {
      gapT -= dt;
      if (gapT > 0 || (mode === 'online' && me === 1)) return;
      if (Math.max(...wins) >= WIN_ROUNDS) {
        Match.move({ k: 'end', w: wins });
        finishMatch();
      } else hostRound();
      return;
    }
    if (phase !== 'run' || (mode === 'online' && me === 1)) return;
    acc += dt;
    while (acc >= TICK && phase === 'run') {
      acc -= TICK;
      if (mode === 'cpu') botThink();
      const before = crash.length;
      const filled = step();
      if (mode === 'online') {
        Match.move({
          k: 't', c: filled, i: inset, x: crash.slice(before),
          h: players.map(p => [p.x, p.y, p.dir, Math.round(p.boost * 100) / 100, p.boosting > 0 ? 1 : 0, p.alive ? 1 : 0]),
        });
      }
      const w = roundOver();
      if (w !== null) {
        Match.move({ k: 'round', w });
        finishRound(w);
      }
    }
  }

  function updateHud() {
    $('you').textContent = wins ? wins[mode === 'local' ? 0 : me] : 0;
    $('them').textContent = wins ? wins[mode === 'local' ? 1 : 1 - me] : 0;
    $('round').textContent = (round || 0) + 1;
  }

  // ---------- Input ----------

  const KEYS = [
    { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3, boost: ['ShiftLeft'] },
    { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, boost: ['Slash', 'ShiftRight'] },
  ];

  function steer(i, dir, boost) {
    if (!players || phase === 'over' || phase === 'menu') return;
    if (mode === 'online' && me === 1) {
      const msg = { k: 'in', d: dir ?? players[1].want, b: boost ? 1 : 0 };
      if (dir !== undefined) players[1].want = dir;
      const key = msg.d + ':' + msg.b;
      if (key !== lastIn || boost) Match.move(msg);
      lastIn = key;
      return;
    }
    const p = players[i];
    if (dir !== undefined) p.want = dir;
    if (boost) p.press = true;
  }

  window.addEventListener('keydown', e => {
    if (!$('overlay').hidden || !players) return;
    if (mode === 'local') {
      KEYS.forEach((k, i) => {
        if (e.code in k && e.code !== 'boost') steer(i, k[e.code]);
        if (k.boost.includes(e.code)) steer(i, undefined, true);
      });
      return;
    }
    const i = mode === 'online' ? me : 0;
    const dir = KEYS[0][e.code] ?? KEYS[1][e.code];
    if (dir !== undefined && e.code !== 'boost') steer(i, dir);
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') steer(i, undefined, true);
  });

  // Touch: swipe to turn, tap to boost.
  Arcade.onSwipe(canvas, dir => steer(mode === 'online' ? me : 0, ['up', 'right', 'down', 'left'].indexOf(dir)), () => steer(mode === 'online' ? me : 0, undefined, true));

  // ---------- Drawing ----------

  function draw(dt) {
    ctx.fillStyle = '#07090d';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(80,110,160,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GW; x += 4) { ctx.moveTo(x * C, 0); ctx.lineTo(x * C, H); }
    for (let y = 0; y <= GH; y += 4) { ctx.moveTo(0, y * C); ctx.lineTo(W, y * C); }
    ctx.stroke();
    if (!grid) return;

    if (inset > 0) {
      ctx.fillStyle = 'rgba(255,95,109,0.18)';
      ctx.fillRect(0, 0, W, inset * C);
      ctx.fillRect(0, H - inset * C, W, inset * C);
      ctx.fillRect(0, 0, inset * C, H);
      ctx.fillRect(W - inset * C, 0, inset * C, H);
      ctx.strokeStyle = '#ff5f6d';
      ctx.lineWidth = 2;
      ctx.strokeRect(inset * C, inset * C, W - inset * C * 2, H - inset * C * 2);
    }

    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = COLORS[i] + '99';
      for (let k = 0; k < grid.length; k++) if (grid[k] === i + 1) ctx.fillRect((k % GW) * C + 1, Math.floor(k / GW) * C + 1, C - 2, C - 2);
    }
    players.forEach((p, i) => {
      ctx.save();
      ctx.shadowColor = COLORS[i];
      ctx.shadowBlur = p.boosting > 0 ? 24 : 12;
      ctx.fillStyle = p.alive ? '#ffffff' : COLORS[i];
      ctx.fillRect(p.x * C - 1, p.y * C - 1, C + 2, C + 2);
      ctx.restore();
    });
    for (const c of crash) {
      c[3] = (c[3] || 0) + dt;
      const r = 6 + c[3] * 60;
      ctx.strokeStyle = COLORS[c[2]];
      ctx.globalAlpha = Math.max(0, 1 - c[3] * 1.5);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c[0] * C + C / 2, c[1] * C + C / 2, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Boost meters in the corners.
    players.forEach((p, i) => {
      const x = i === 0 ? 14 : W - 134, y = 12;
      ctx.fillStyle = 'rgba(14,16,20,0.7)';
      ctx.fillRect(x, y, 120, 22);
      ctx.fillStyle = p.boost >= 1 ? COLORS[i] : COLORS[i] + '66';
      ctx.fillRect(x + 4, y + 14, 112 * p.boost, 4);
      ctx.fillStyle = '#eceef2';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${names[i]}${p.boosting > 0 ? ' · BOOST' : ''}`.slice(0, 24), x + 4, y + 11);
    });

    ctx.textAlign = 'center';
    if (phase === 'count') {
      ctx.fillStyle = '#eceef2';
      ctx.font = '800 64px system-ui, sans-serif';
      ctx.fillText(Math.ceil(countT), W / 2, H / 2 + 20);
      ctx.font = '600 15px system-ui, sans-serif';
      const you = mode === 'local' ? '' : `You are ${me === 0 ? 'blue, on the left' : 'orange, on the right'}`;
      ctx.fillText(`Round ${round + 1}${you ? ' · ' + you : ''}`, W / 2, H / 2 + 56);
    } else if (phase === 'gap') {
      ctx.fillStyle = '#eceef2';
      ctx.font = '800 28px system-ui, sans-serif';
      ctx.fillText(`${wins[0]} – ${wins[1]}`, W / 2, H / 2);
    }
    ctx.fillStyle = '#8d94a1';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(Match.label(), W / 2, H - 8);
  }

  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
