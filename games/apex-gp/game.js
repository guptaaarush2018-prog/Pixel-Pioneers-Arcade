/* Apex GP: a behind-the-car Grand Prix racer. The road is a loop of short segments, each with
   a curve and a height, projected into perspective every frame (the classic arcade road
   technique). Content is in data.js; cars, scenery and backgrounds are drawn in art.js. */
(() => {
  const W = 960, H = 540;
  const SEG = 200, ROAD = 2000, RUMBLE = 3, DRAW = 220;
  const FOV = 100, CAM_H = 1000, DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
  const PLAYER_Z = CAM_H * DEPTH;
  const STEP = 1 / 60;
  const MAX = SEG / STEP;                    // top speed: one segment per step
  const ACCEL = MAX / 5, BRAKE = -MAX, DECEL = -MAX / 5;
  const OFF_DECEL = -MAX / 2, OFF_LIMIT = MAX / 4, CENTRIFUGAL = 0.3;
  const CAR_W = 360;                          // a car's width in road units
  const PIT_LEN = 70;                         // segments of pit lane before the line
  const FOG = 5;
  const KMH = 330 / MAX;
  // Test hook: #autopilot drives your car with the bot and posts no score.
  const AUTOPILOT = location.hash === '#autopilot';

  const D = ApexData, A = ApexArt;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const esc = s => Online.escape(s);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeIn = (a, b, k) => a + (b - a) * k * k;
  const easeInOut = (a, b, k) => a + (b - a) * (-Math.cos(k * Math.PI) / 2 + 0.5);
  const fx = Sports.particles();

  let state = 'menu';   // menu | lights | racing | finished | paused
  let circuit = null, theme = null, bg = null;
  let segments = [], trackLen = 0, mapPts = [];
  let cars = [], player = null;
  let laps = 3, level = Arcade.load('apex:level', 1), LV = D.LEVELS[level];
  let modeChamp = Arcade.load('apex:mode', 'race') === 'champ';
  let pickCircuit = Arcade.load('apex:circuit', 0);
  let lightsT = 0, goDelay = 0, raceT = 0, finishT = 0, results = null;
  let skyOff = 0, farOff = 0, midOff = 0;
  let shakeAmt = 0;

  // ---------- Building a circuit ----------

  const lastY = () => (segments.length ? segments[segments.length - 1].p2.world.y : 0);
  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n, curve, sprites: [], cars: [],
      p1: { world: { y: lastY(), z: n * SEG }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEG }, camera: {}, screen: {} },
      color: Math.floor(n / RUMBLE) % 2,
    });
  }
  function addPiece(len, curve, hill) {
    const n = Math.max(6, Math.round(len * 1.6));
    const enter = Math.floor(n * 0.2), leave = enter, hold = n - enter - leave;
    const y0 = lastY(), y1 = y0 + hill * SEG * 0.5;
    for (let i = 0; i < enter; i++) addSegment(easeIn(0, curve, i / enter), easeInOut(y0, y1, i / n));
    for (let i = 0; i < hold; i++) addSegment(curve, easeInOut(y0, y1, (enter + i) / n));
    for (let i = 0; i < leave; i++) addSegment(easeInOut(curve, 0, i / leave), easeInOut(y0, y1, (enter + hold + i) / n));
  }

  function build(c) {
    circuit = c;
    theme = D.THEMES[c.theme];
    segments = [];
    for (const [len, curve, hill] of c.pieces) addPiece(len, curve, hill);
    // Ease back down to the starting height so the loop closes.
    const y0 = lastY(), n = 80;
    for (let i = 0; i < n; i++) addSegment(0, easeInOut(y0, 0, (i + 1) / n));
    trackLen = segments.length * SEG;
    const rnd = Sports.seeded(c.id.length * 977 + c.pieces.length);
    const N = segments.length;
    // Start/finish line and the pit lane wall.
    for (let i = 0; i < 3; i++) segments[i].start = true;
    for (let i = N - PIT_LEN; i < N; i++) segments[i].pit = true;
    // Grandstands along the main straight, then scenery all the way round.
    for (let i = 6; i < 60; i += 9) {
      segments[i].sprites.push({ kind: 'stand', offset: -1.9 });
      segments[(i + 4) % N].sprites.push({ kind: 'stand', offset: 2.6 });
    }
    for (let i = 60; i < N - PIT_LEN; i += 4 + Math.floor(rnd() * 8)) {
      const kind = theme.sprites[Math.floor(rnd() * theme.sprites.length)];
      const side = rnd() < 0.5 ? -1 : 1;
      segments[i].sprites.push({ kind, offset: side * (1.35 + rnd() * 2.2), sponsor: D.SPONSORS[Math.floor(rnd() * D.SPONSORS.length)] });
      if (rnd() < 0.3) segments[i].sprites.push({ kind: theme.sprites[0], offset: -side * (1.4 + rnd() * 3) });
    }
    // Tyre barriers on the outside of the tighter corners.
    for (let i = 0; i < N; i += 6) {
      const cv = segments[i].curve;
      if (Math.abs(cv) > 3.5) segments[i].sprites.push({ kind: 'barrier', offset: Math.sign(cv) * 1.25 });
    }
    // The minimap: integrate the curves into a 2D shape, then spread out the closing error.
    // Scale the turning so the whole lap comes round one full circle.
    const sum = segments.reduce((t, s) => t + s.curve, 0), abs = segments.reduce((t, s) => t + Math.abs(s.curve), 0);
    const turn = (Math.sign(sum) || 1) * Math.PI * 2 / Math.max(Math.abs(sum), abs * 0.3);
    let x = 0, y = 0, a = 0;
    const pts = [];
    for (const s of segments) {
      a += s.curve * turn;
      x += Math.cos(a) * 1;
      y += Math.sin(a) * 1;
      pts.push([x, y]);
    }
    const ex = pts[N - 1][0], ey = pts[N - 1][1];
    mapPts = pts.map(([px, py], i) => [px - (ex * i) / N, py - (ey * i) / N]);
    const xs = mapPts.map(p => p[0]), ys = mapPts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sc = Math.min(130 / (maxX - minX || 1), 80 / (maxY - minY || 1));
    mapPts = mapPts.map(([px, py]) => [(px - minX) * sc, (py - minY) * sc]);
    mapPts.w = (maxX - minX) * sc;
    mapPts.h = (maxY - minY) * sc;
    bg = A.backgrounds(theme, W, H);
  }

  const segAt = z => segments[Math.floor((((z % trackLen) + trackLen) % trackLen) / SEG) % segments.length];

  // ---------- Race setup ----------

  function newRace() {
    build(D.CIRCUITS[modeChamp ? champ().round : pickCircuit]);
    LV = D.LEVELS[level];
    const drivers = [...D.DRIVERS].sort(() => Math.random() - 0.5);
    const startPos = Math.min(LV.grid, 11);
    cars = D.TEAMS.map((team, i) => ({
      team, ti: i, you: !!team.you, name: team.you ? Arcade.profile().name : drivers[i],
      x: 0, speed: 0, dist: 0, wear: 0, pitT: 0, pitted: false, pitLap: -1,
      pace: team.you ? 1 : LV.pace * (0.95 + Math.random() * 0.06), lane: 0, finished: false, finishT: 0, best: Infinity, lapStart: 0, lapsDone: 0,
      boost: 1, boosting: false, slip: 0,
    }));
    // Grid: two columns behind the line, you at your starting slot.
    const order = cars.filter(c => !c.you).sort((a, b) => b.pace - a.pace);
    order.splice(startPos, 0, cars.find(c => c.you));
    order.forEach((c, i) => {
      c.grid = i + 1;
      c.dist = -(i + 1) * SEG * 2.2;
      c.x = i % 2 ? 0.45 : -0.45;
      c.lane = c.x;
    });
    player = cars.find(c => c.you);
    fx.clear();
    results = null;
    raceT = 0;
    lightsT = 0;
    goDelay = Math.random() * 0.8;
    finishT = 0;
    skyOff = farOff = midOff = 0;
    state = 'lights';
    engine.start();
  }

  // ---------- Championship ----------

  function champ() {
    const s = Arcade.load('apex:season', null);
    return s && Array.isArray(s.points) && s.points.length === D.TEAMS.length ? s : { round: 0, points: D.TEAMS.map(() => 0), level };
  }
  const saveChamp = s => Arcade.save('apex:season', s);

  // ---------- Simulation ----------

  const input = { left: false, right: false, gas: false, brake: false, boost: false };
  let touchDriving = false;

  function updatePlayer(dt) {
    const p = player;
    const seg = segAt(p.dist + startZ());
    const pct = p.speed / MAX;
    const grip = 1 - p.wear * 0.45;
    let left = input.left, right = input.right, gas = input.gas || (touchDriving && !input.brake), brake = input.brake;
    if (AUTOPILOT || state === 'finished') ({ left, right, gas, brake } = botDrive(p));
    if (p.pitT > 0) return pitStop(p, dt);

    const dx = dt * 2 * pct;
    if (left) p.x -= dx;
    else if (right) p.x += dx;
    p.x -= dx * pct * seg.curve * CENTRIFUGAL / grip;

    // Boost: a burst of extra power while the meter lasts. Slipstreaming fills it faster.
    p.boosting = input.boost && p.boost > 0.02 && gas && state === 'racing';
    p.boost = clamp(p.boost + dt * (p.boosting ? -0.28 : p.slip > 0.4 ? 0.12 : 0.04), 0, 1);
    const top = MAX * (1 - p.wear * 0.06) * (p.boosting ? 1.1 : 1) * (p.slip > 0.4 ? 1.06 : 1);
    if (gas) p.speed += ACCEL * (p.boosting ? 1.4 : 1) * dt * (1 - Math.max(0, p.speed - top) / top);
    else if (brake) p.speed += BRAKE * dt;
    else p.speed += DECEL * dt;
    if (p.speed > top) p.speed = Math.max(top, p.speed + DECEL * dt);

    // Off the tarmac you slow right down, and you hit anything standing there.
    if (Math.abs(p.x) > 1) {
      if (p.speed > OFF_LIMIT) p.speed += OFF_DECEL * dt / grip;
      if (Math.random() < 0.4) fx.dust(W / 2 + (Math.random() - 0.5) * 120, H - 30, 2, theme.grass[0], 60);
      for (const sp of seg.sprites) {
        const s = A.sprite(sp.kind, sp.sponsor);
        const half = s.world / ROAD / 2;
        if (Math.abs(p.x - sp.offset) < half + CAR_W / ROAD / 2 && Math.sign(p.x) === Math.sign(sp.offset)) {
          p.speed = MAX / 6;
          p.x = sp.offset > 0 ? sp.offset - half - CAR_W / ROAD / 2 - 0.02 : sp.offset + half + CAR_W / ROAD / 2 + 0.02;
          crash();
          break;
        }
      }
    }
    p.x = clamp(p.x, -3, 3);
    p.speed = clamp(p.speed, 0, MAX * 1.2);

    // Bumping into a car from behind costs you speed; side by side you rub wheels.
    const myZ = p.dist;
    p.slip = Math.max(0, p.slip - dt * 0.8);
    for (const c of cars) {
      if (c === p || c.pitT > 0) continue;
      const gap = c.dist - myZ;
      const overlapX = Math.abs(c.x - p.x) < CAR_W / ROAD * 1.05;
      if (gap > 0 && gap < SEG * 1.4 && overlapX && p.speed > c.speed) {
        p.speed = c.speed * 0.92;
        p.x += p.x > c.x ? 0.04 : -0.04;
        crash(0.5);
      }
      // Slipstream: tucked in close behind a car.
      if (gap > SEG && gap < SEG * 14 && Math.abs(c.x - p.x) < 0.35 && p.speed > MAX * 0.6) p.slip = Math.min(1, p.slip + dt * 1.6);
    }

    // Tyres wear with speed and cornering, faster when sliding over the grass.
    p.wear = clamp(p.wear + dt * (0.002 + pct * 0.0025 + Math.abs(seg.curve) * pct * 0.0008 + (Math.abs(p.x) > 1 ? 0.008 : 0)), 0, 1);

    // The pit lane: slow down and keep right on the last straight.
    const lapPos = (((p.dist % trackLen) + trackLen) % trackLen);
    if (state === 'racing' && lapPos > trackLen - PIT_LEN * SEG && lapPos < trackLen - SEG * 4 && p.x > 0.7 && p.speed < MAX * 0.42 && p.pitLap !== p.lapsDone && p.wear > 0.05) {
      p.pitT = 2.8;
      p.pitLap = p.lapsDone;
      Sports.sfx.whistle();
    }
  }

  function pitStop(c, dt) {
    c.speed = Math.max(0, c.speed + BRAKE * dt);
    c.x = lerp(c.x, 1.25, dt * 3);
    if (c.speed > 0) return;
    c.pitT -= dt;
    if (c.you && Math.random() < 0.3) Sports.sfx.clack(0.6);
    if (c.pitT <= 0) {
      c.wear = 0;
      c.pitT = 0;
      c.pitted = true;
      if (c.you) { Sports.sfx.good(); fx.text(W / 2, H * 0.55, 'FRESH TYRES', '#3ddc84', 26); }
    }
  }

  function crash(k = 1) {
    shakeAmt = Math.max(shakeAmt, 8 * k);
    Sports.sfx.thud(k);
    fx.sparks(W / 2, H - 50, Math.round(14 * k), '#ffd86b', 200);
  }

  // Bot drivers: keep to a racing line, brake for corners, pass slower cars, and pit once.
  function botDrive(c) {
    const seg = segAt(c.dist + startZ() + SEG * 18);
    const near = segAt(c.dist + startZ() + SEG * 6);
    const curve = Math.max(Math.abs(seg.curve), Math.abs(near.curve));
    const target = c.pace * MAX * (1 - curve * 0.05) * (1 - c.wear * 0.06);
    // Hug the inside of the next corner.
    let want = clamp(-seg.curve * 0.12, -0.6, 0.6);
    for (const o of cars) {
      if (o === c) continue;
      const gap = o.dist - c.dist;
      if (gap > 0 && gap < SEG * 20 && Math.abs(o.x - want) < 0.4 && o.speed < c.speed + 200) want = o.x > 0 ? o.x - 0.55 : o.x + 0.55;
    }
    c.lane = lerp(c.lane, clamp(want, -0.85, 0.85), 0.05);
    const steer = c.lane - c.x;
    return { left: steer < -0.03, right: steer > 0.03, gas: c.speed < target, brake: c.speed > target * 1.08 };
  }

  function updateBot(c, dt) {
    if (c.pitT > 0) return pitStop(c, dt);
    const ctl = botDrive(c);
    const seg = segAt(c.dist + startZ());
    const pct = c.speed / MAX;
    if (ctl.gas) c.speed += ACCEL * 0.95 * dt;
    else if (ctl.brake) c.speed += BRAKE * 0.6 * dt;
    else c.speed += DECEL * dt * 0.5;
    c.speed = clamp(c.speed, 0, MAX * c.pace * 1.04);
    c.x = clamp(lerp(c.x, c.lane, dt * 2.2) - dt * pct * seg.curve * 0.02, -0.95, 0.95);
    c.wear = clamp(c.wear + dt * (0.002 + pct * 0.0028), 0, 1);
    // Pit when the tyres are gone, if there's a lap left to use them.
    const lapPos = (((c.dist % trackLen) + trackLen) % trackLen);
    if (!c.pitted && c.wear > 0.62 && c.lapsDone < laps - 1 && lapPos > trackLen - PIT_LEN * SEG && lapPos < trackLen - SEG * 10) {
      c.pitT = 2.8 + Math.random();
      c.lane = 1.2;
    }
  }

  const startZ = () => 0;   // the line sits at z = 0; dist counts from it

  function step(dt) {
    if (state === 'lights') {
      lightsT += dt;
      if (lightsT > 3.2 + goDelay) {
        state = 'racing';
        Sports.sfx.horn();
        for (const c of cars) c.lapStart = 0;
      }
      return;
    }
    raceT += dt;
    updatePlayer(dt);
    for (const c of cars) if (!c.you) updateBot(c, dt);
    for (const c of cars) {
      c.dist += c.speed * dt;
      const done = Math.floor(c.dist / trackLen);
      if (done > c.lapsDone && c.dist > 0) {
        const lap = raceT - c.lapStart;
        if (c.lapsDone > 0 || done === 1) c.best = Math.min(c.best, lap);
        c.lapStart = raceT;
        c.lapsDone = done;
        if (c.you && done < laps) {
          Sports.sfx.select();
          fx.text(W / 2, H * 0.3, done === laps - 1 ? 'FINAL LAP' : `LAP ${done + 1}`, '#ffffff', 34);
        }
        if (done >= laps && !c.finished) {
          c.finished = true;
          c.finishT = raceT;
          if (c.you) finishRace();
        }
      }
    }
    // Sparks and dust are drawn in screen space; tilt the background with the road.
    const seg = segAt(player.dist);
    const pct = player.speed / MAX;
    skyOff += seg.curve * pct * 0.0008;
    farOff += seg.curve * pct * 0.0016;
    midOff += seg.curve * pct * 0.0032;
    if (state === 'finished') {
      finishT += dt;
      if (finishT > 3 && !results) showResults();
    }
  }

  const ranking = () => [...cars].sort((a, b) => (a.finished && b.finished ? a.finishT - b.finishT : a.finished ? -1 : b.finished ? 1 : b.dist - a.dist));
  const position = c => ranking().indexOf(c) + 1;

  function finishRace() {
    state = 'finished';
    const pos = position(player);
    fx.confetti(W / 2, H * 0.4, pos <= 3 ? 120 : 40, ['#1b1d22', '#f4f4f4', '#ffc53d']);
    if (pos === 1) Sports.sfx.win(); else Sports.sfx.good();
    Sports.sfx.cheer(pos <= 3 ? 1.4 : 0.6);
  }

  function showResults() {
    // Cars still running are placed by how far round they are, with an estimated gap.
    const order = ranking();
    const lead = order[0];
    results = order.map((c, i) => {
      const t = c.finished ? c.finishT : raceT + (laps * trackLen - c.dist) / Math.max(1, c.speed || MAX * 0.8);
      return { c, pos: i + 1, gap: i === 0 ? fmt(t) : `+${(t - (lead.finished ? lead.finishT : t)).toFixed(1)}s` };
    });
    engine.stop();
    const pos = results.find(r => r.c.you).pos;
    const won = pos === 1;
    if (won) Arcade.flag('apex-gp-win');
    if (won && level >= 1 && player.grid >= 12) Arcade.flag('apex-gp-pole');
    let champHtml = '';
    if (modeChamp) {
      const s = champ();
      results.forEach(r => { s.points[r.c.ti] += D.POINTS[r.pos - 1] || 0; });
      s.round++;
      const table = D.TEAMS.map((t, i) => ({ t, pts: s.points[i], i })).sort((a, b) => b.pts - a.pts);
      const done = s.round >= D.CIRCUITS.length;
      if (done && table[0].t.you) Arcade.flag('apex-gp-season');
      champHtml = `<p class="muted-note">${done ? 'Final championship standings' : `Championship after round ${s.round} of ${D.CIRCUITS.length}`}</p>
        <ol class="board-list">${table.slice(0, 5).map(r => `<li class="${r.t.you ? 'me' : ''}"><span class="name">${esc(r.t.name)}</span><b>${r.pts}</b></li>`).join('')}</ol>`;
      if (done) champHtml = `<p class="new-best">${table[0].t.you ? 'You are World Champion!' : `${esc(table[0].t.name)} take the title.`}</p>` + champHtml;
      saveChamp(done ? { round: 0, points: D.TEAMS.map(() => 0), level } : s);
    }
    const score = AUTOPILOT ? 0 : Math.round(((13 - pos) * 100 + (player.best < Infinity ? Math.max(0, 600 - player.best * 8) : 0) + (player.grid - pos) * 25) * LV.mult);
    Arcade.finish(ui, {
      score: Math.max(0, score),
      title: won ? 'Victory!' : pos <= 3 ? `Podium! P${pos}` : `Finished P${pos}`,
      lines: [`${esc(circuit.name)} · ${laps} laps · started P${player.grid}`, `Best lap ${player.best < Infinity ? fmt(player.best) : '—'}`],
      html: `<ol class="board-list">${results.slice(0, 6).map(r => `<li class="${r.c.you ? 'me' : ''}"><span class="rank">${r.pos}</span><span class="name">${esc(r.c.name)} <small style="color:${r.c.team.color}">${esc(r.c.team.name)}</small></span><b>${r.gap}</b></li>`).join('')}</ol>${champHtml}`,
      button: modeChamp && champ().round > 0 ? 'Next round' : 'Race again',
      onAction: () => start(),
    });
  }

  const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

  // ---------- Engine sound ----------

  const engine = (() => {
    let osc = null, osc2 = null, filt = null, gain = null;
    return {
      start() {
        if (!Sports.ensure() || osc) return;
        const ac = Sports.ctx();
        osc = ac.createOscillator();
        osc2 = ac.createOscillator();
        filt = ac.createBiquadFilter();
        gain = ac.createGain();
        osc.type = 'sawtooth';
        osc2.type = 'square';
        filt.type = 'lowpass';
        filt.frequency.value = 900;
        gain.gain.value = 0;
        osc.connect(filt);
        osc2.connect(filt);
        filt.connect(gain).connect(Sports.master());
        osc.start();
        osc2.start();
      },
      update(speed, boosting) {
        if (!osc) return;
        const ac = Sports.ctx();
        const pct = speed / MAX;
        // Eight gears: revs climb through each one, then drop at the shift.
        const gear = Math.min(7, Math.floor(pct * 8));
        const rev = pct * 8 - gear;
        const f = 70 + gear * 12 + rev * 140 + (boosting ? 25 : 0);
        osc.frequency.setTargetAtTime(f, ac.currentTime, 0.03);
        osc2.frequency.setTargetAtTime(f * 0.5, ac.currentTime, 0.03);
        filt.frequency.setTargetAtTime(500 + pct * 1800, ac.currentTime, 0.05);
        gain.gain.setTargetAtTime(Arcade.load('muted', false) || state === 'paused' ? 0 : 0.035 + pct * 0.035, ac.currentTime, 0.05);
        return gear + 1;
      },
      stop() {
        if (!osc) return;
        gain.gain.setTargetAtTime(0, Sports.ctx().currentTime, 0.1);
        const o = osc, o2 = osc2;
        setTimeout(() => { o.stop(); o2.stop(); }, 400);
        osc = osc2 = null;
      },
    };
  })();

  // ---------- Rendering ----------

  function project(p, camX, camY, camZ) {
    p.camera.x = -camX;
    p.camera.y = p.world.y - camY;
    p.camera.z = p.world.z - camZ;
    p.screen.scale = DEPTH / p.camera.z;
    p.screen.x = Math.round(W / 2 + p.screen.scale * p.camera.x * W / 2);
    p.screen.y = Math.round(H / 2 - p.screen.scale * p.camera.y * H / 2);
    p.screen.w = Math.round(p.screen.scale * ROAD * W / 2);
  }

  function poly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  const fogMix = (() => {
    const cache = new Map();
    const parse = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    return (col, fogCol, k) => {
      const q = Math.round(k * 20);
      const key = col + fogCol + q;
      if (!cache.has(key)) {
        const a = parse(col), b = parse(fogCol), t = q / 20;
        cache.set(key, `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`);
      }
      return cache.get(key);
    };
  })();

  function drawSegment(seg, fog) {
    const p1 = seg.p1.screen, p2 = seg.p2.screen;
    const c = seg.color;
    const f = col => fogMix(col, theme.fog, fog);
    ctx.fillStyle = f(theme.grass[c]);
    ctx.fillRect(0, p2.y, W, p1.y - p2.y);
    const r1 = p1.w / 7, r2 = p2.w / 7;
    poly(p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, f(theme.rumble[c]));
    poly(p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, f(theme.rumble[c]));
    poly(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, f(theme.road[c]));
    if (seg.start) {
      // Chequered start line.
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = -1 + (2 * i) / n, b = -1 + (2 * (i + 1)) / n;
        poly(p1.x + p1.w * a, p1.y, p1.x + p1.w * b, p1.y, p2.x + p2.w * b, p2.y, p2.x + p2.w * a, p2.y, (i + seg.index) % 2 ? '#f4f4f4' : '#1b1d22');
      }
    } else if (c) {
      const l1 = p1.w / 40, l2 = p2.w / 40;
      for (const k of [-1 / 3, 1 / 3]) {
        const x1 = p1.x + p1.w * k * 2, x2 = p2.x + p2.w * k * 2;
        poly(x1 - l1 / 2, p1.y, x1 + l1 / 2, p1.y, x2 + l2 / 2, p2.y, x2 - l2 / 2, p2.y, f(theme.lane));
      }
    }
    if (seg.pit) {
      // The pit lane: a painted strip on the right with a white line.
      const a1 = p1.x + p1.w * 0.72, a2 = p2.x + p2.w * 0.72;
      poly(a1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, a2, p2.y, f(c ? '#6a6e78' : '#646872'));
      poly(a1 - 2, p1.y, a1 + 2, p1.y, a2 + 1, p2.y, a2 - 1, p2.y, f('#f4f4f4'));
    }
  }

  function drawImageClipped(img, x, y, w, h, clipY) {
    if (w < 1 || h < 1) return;
    const clipH = clipY ? Math.max(0, y + h - clipY) : 0;
    if (clipH >= h) return;
    const sh = img.height * (1 - clipH / h);
    ctx.drawImage(img, 0, 0, img.width, sh, x, y, w, h - clipH);
  }

  function drawBackground(playerY) {
    ctx.drawImage(bg.sky, 0, 0, W, H);
    const lift = clamp(playerY * 0.004, -40, 60);
    for (const [img, off] of [[bg.far, farOff], [bg.mid, midOff]]) {
      const sx = ((off * W) % W + W) % W;
      ctx.drawImage(img, sx, 0, W, H, 0, lift, W, H);
    }
    ctx.fillStyle = theme.grass[0];
    ctx.fillRect(0, bg.horizon + lift - 2, W, H);
  }

  function render() {
    const camZ = player.dist - PLAYER_Z;
    const base = segAt(camZ);
    const basePct = (((camZ % SEG) + SEG) % SEG) / SEG;
    const pSeg = segAt(player.dist);
    const pPct = (((player.dist % SEG) + SEG) % SEG) / SEG;
    const playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);
    const camWrap = ((camZ % trackLen) + trackLen) % trackLen;
    drawBackground(playerY);

    // Bucket the cars by segment so they draw in order with the scenery.
    for (const s of segments) s.cars.length = 0;
    for (const c of cars) if (!c.you) segAt(c.dist).cars.push(c);

    let maxy = H, x = 0, dx = -(base.curve * basePct);
    const drawn = [];
    for (let n = 0; n < DRAW; n++) {
      const seg = segments[(base.index + n) % segments.length];
      const looped = seg.index < base.index;
      const camZw = camWrap - (looped ? trackLen : 0);
      seg.clip = maxy;
      project(seg.p1, player.x * ROAD - x, playerY + CAM_H, camZw);
      project(seg.p2, player.x * ROAD - x - dx, playerY + CAM_H, camZw);
      x += dx;
      dx += seg.curve;
      drawn.push(seg);
      seg.fog = 1 - 1 / Math.exp((n / DRAW) * (n / DRAW) * FOG);
      if (seg.p1.camera.z <= DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) { seg.hidden = true; continue; }
      seg.hidden = false;
      drawSegment(seg, seg.fog);
      maxy = seg.p1.screen.y;
    }
    // Scenery and cars, far to near.
    for (let n = drawn.length - 1; n > 0; n--) {
      const seg = drawn[n];
      if (seg.p1.camera.z <= DEPTH) continue;
      const scale = seg.p1.screen.scale;
      for (const sp of seg.sprites) {
        const s = A.sprite(sp.kind, sp.sponsor);
        const w = s.world * scale * W / 2, h = w * (s.img.height / s.img.width);
        const sx = seg.p1.screen.x + scale * sp.offset * ROAD * W / 2;
        drawImageClipped(s.img, sx - w / 2, seg.p1.screen.y - h, w, h, seg.clip);
      }
      for (const c of seg.cars) {
        const pct = (((c.dist % SEG) + SEG) % SEG) / SEG;
        const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, pct);
        const sx = lerp(seg.p1.screen.x, seg.p2.screen.x, pct) + sc * c.x * ROAD * W / 2;
        const sy = lerp(seg.p1.screen.y, seg.p2.screen.y, pct);
        const w = CAR_W * 1.15 * sc * W / 2, h = w * 0.55;
        drawImageClipped(A.car(c.team, 0), sx - w / 2, sy - h, w, h, seg.clip);
      }
    }

    // Slipstream streaks.
    if (player.slip > 0.4 || player.boosting) {
      ctx.strokeStyle = player.boosting ? 'rgba(120,220,255,0.5)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + raceT * 3, r1 = 140 + ((raceT * 900 + i * 61) % 260);
        ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * r1, H * 0.48 + Math.sin(a) * r1 * 0.55); ctx.lineTo(W / 2 + Math.cos(a) * (r1 + 60), H * 0.48 + Math.sin(a) * (r1 + 60) * 0.55); ctx.stroke();
      }
    }

    // Your car, low and centred, leaning with the steering and bobbing over the kerbs.
    const steer = input.left && !input.right ? -1 : input.right && !input.left ? 1 : 0;
    const bump = Math.abs(player.x) > 0.9 && player.speed > 0 ? (Math.random() - 0.5) * 4 : 0;
    const cw = 300, chh = cw * 0.55;
    const cy = H - chh - 6 + bump + Math.sin(raceT * 30) * player.speed / MAX * 0.8;
    ctx.drawImage(A.car(player.team, AUTOPILOT ? 0 : steer), W / 2 - cw / 2, cy, cw, chh);
    // Tyre smoke when sliding, exhaust heat when boosting.
    if (Math.abs(player.x) > 1 && player.speed > MAX * 0.3) fx.dust(W / 2 + (Math.random() < 0.5 ? -110 : 110), H - 20, 2, theme.grass[1], 80);
    if (player.boosting && Math.random() < 0.7) fx.dust(W / 2 + (Math.random() - 0.5) * 20, cy + chh * 0.8, 1, 'rgba(120,200,255,0.6)', 30);
  }

  function hud() {
    const pos = position(player);
    const pill = (x, y, w, h) => { ctx.fillStyle = 'rgba(12,14,22,0.72)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill(); };
    // Position and lap, top left.
    pill(12, 12, 196, 74);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffc53d';
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.fillText(`P${pos}`, 24, 56);
    const pw = ctx.measureText(`P${pos}`).width;
    ctx.fillStyle = '#9aa3b5';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(`/${cars.length}`, 26 + pw, 56);
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillText(`LAP ${Math.min(laps, player.lapsDone + 1)}/${laps}`, 118, 34);
    ctx.font = '600 12px ui-monospace, monospace';
    ctx.fillText(fmt(Math.max(0, raceT - player.lapStart)), 118, 52);
    ctx.fillStyle = '#9aa3b5';
    ctx.fillText(player.best < Infinity ? `best ${fmt(player.best)}` : 'best —', 24, 76);

    // Minimap, top right.
    const mw = mapPts.w + 20, mh = mapPts.h + 20, mx = W - mw - 12, my = 12;
    pill(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    mapPts.forEach(([x, y], i) => (i ? ctx.lineTo(mx + 10 + x, my + 10 + y) : ctx.moveTo(mx + 10 + x, my + 10 + y)));
    ctx.closePath();
    ctx.stroke();
    for (const c of [...cars].sort((a, b) => a.you - b.you)) {
      const i = Math.floor(((((c.dist % trackLen) + trackLen) % trackLen) / SEG)) % mapPts.length;
      const [x, y] = mapPts[i];
      ctx.fillStyle = c.team.color;
      ctx.beginPath(); ctx.arc(mx + 10 + x, my + 10 + y, c.you ? 5 : 3, 0, Math.PI * 2); ctx.fill();
      if (c.you) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }

    // Speed, gear, tyres and boost, bottom left.
    const gear = engine.update(player.speed, player.boosting) || Math.min(8, Math.floor(player.speed / MAX * 8) + 1);
    pill(12, H - 92, 200, 80);
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(player.speed * KMH), 112, H - 50);
    ctx.textAlign = 'left';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = '#9aa3b5';
    ctx.fillText('KM/H', 116, H - 52);
    ctx.fillStyle = '#ffc53d';
    ctx.font = '900 26px system-ui, sans-serif';
    ctx.fillText(player.speed < 5 ? 'N' : gear, 166, H - 50);
    // Four tyres, green through red as they wear.
    const tc = player.wear < 0.4 ? '#3ddc84' : player.wear < 0.7 ? '#ffc53d' : '#ff5d5d';
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = tc;
      ctx.beginPath(); ctx.roundRect(24 + (i % 2) * 16, H - 40 + Math.floor(i / 2) * 14, 10, 12, 3); ctx.fill();
    }
    ctx.fillStyle = '#9aa3b5';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(`TYRES ${Math.round((1 - player.wear) * 100)}%`, 62, H - 30);
    ctx.fillText('BOOST', 62, H - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(104, H - 24, 96, 8);
    ctx.fillStyle = player.boosting ? '#78dcff' : '#4f8cff';
    ctx.fillRect(104, H - 24, 96 * player.boost, 8);
    if (player.wear > 0.7 && state === 'racing') {
      ctx.fillStyle = Math.floor(raceT * 3) % 2 ? '#ff5d5d' : '#ffc53d';
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TYRES GONE · PIT: keep right & slow down before the line', W / 2, 30);
    }
    if (player.slip > 0.4) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SLIPSTREAM', W / 2, H - 12);
    }
    if (player.pitT > 0) {
      pill(W / 2 - 120, H * 0.35, 240, 60);
      ctx.fillStyle = '#ffc53d';
      ctx.font = '900 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(player.speed > 0 ? 'PIT LANE' : `PIT STOP ${player.pitT.toFixed(1)}`, W / 2, H * 0.35 + 38);
    }

    // Start lights.
    if (state === 'lights' || (state === 'racing' && raceT < 1)) {
      const lit = state === 'lights' ? Math.min(5, Math.floor(lightsT / 0.6)) : 0;
      pill(W / 2 - 150, 22, 300, 56);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = state === 'racing' ? '#3ddc84' : i < lit ? '#ff2a2a' : '#2a2c33';
        ctx.beginPath(); ctx.arc(W / 2 - 112 + i * 56, 50, 18, 0, Math.PI * 2); ctx.fill();
      }
      if (state === 'lights' && lit !== hud.lastLit) { hud.lastLit = lit; if (lit > 0) Sports.tone(440, { dur: 0.15, type: 'square', vol: 0.06 }); }
    }
    if (state === 'finished') {
      ctx.fillStyle = 'rgba(12,14,22,0.7)';
      ctx.fillRect(0, H * 0.28, W, 70);
      for (let i = 0; i < 24; i++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#f4f4f4' : '#1b1d22';
        ctx.fillRect(i * 40, H * 0.28 + j * 8 - 16, 40, 8);
      }
      ctx.fillStyle = '#fff';
      ctx.font = '900 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`CHEQUERED FLAG · P${pos}`, W / 2, H * 0.28 + 48);
    }
  }

  function updateTopbar() {
    if (!player) return;
    $('pos').textContent = `P${position(player)}`;
    $('lap').textContent = `${Math.min(laps, player.lapsDone + 1)}/${laps}`;
    $('speed').textContent = Math.round(player.speed * KMH);
  }

  // ---------- Input ----------

  const keys = {};
  function readKeys() {
    input.left = !!(keys.ArrowLeft || keys.KeyA || touch.left);
    input.right = !!(keys.ArrowRight || keys.KeyD || touch.right);
    input.gas = !!(keys.ArrowUp || keys.KeyW);
    input.brake = !!(keys.ArrowDown || keys.KeyS || touch.brake);
    input.boost = !!(keys.ShiftLeft || keys.ShiftRight || keys.Space || touch.boost);
  }
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'paused') resume(); else pause(); return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && state !== 'menu') e.preventDefault();
    if (e.code.startsWith('Arrow') || e.code === 'KeyW') touchDriving = false;
    readKeys();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; readKeys(); });
  const touch = { left: false, right: false, brake: false, boost: false };
  function hold(id, k) {
    const el = $(id);
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); touch[k] = true; touchDriving = true; readKeys(); });
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { touch[k] = false; readKeys(); });
  }
  hold('t-left', 'left');
  hold('t-right', 'right');
  hold('t-brake', 'brake');
  hold('t-boost', 'boost');
  // Touching either half of the road steers too; on touch screens the throttle is automatic.
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    touchDriving = true;
    const r = canvas.getBoundingClientRect();
    touch[e.clientX - r.left < r.width / 2 ? 'left' : 'right'] = true;
    canvas.setPointerCapture(e.pointerId);
    readKeys();
  });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { touch.left = touch.right = false; readKeys(); });

  // ---------- Flow ----------

  function start() {
    ui.hide();
    Arcade.countPlay();
    if (modeChamp) {
      const s = champ();
      if (s.round === 0) saveChamp({ ...s, level });
      else level = s.level ?? level;
    }
    newRace();
  }

  function pause() {
    if (state !== 'racing' && state !== 'lights') return;
    pause.was = state;
    state = 'paused';
    ui.show({
      title: 'Paused',
      html: `<p>${esc(circuit.name)} · lap ${Math.min(laps, player.lapsDone + 1)} of ${laps}</p><div class="menu"><button class="btn secondary" type="button" data-quit>Retire</button></div>`,
      button: 'Resume',
      onAction: resume,
      onRender: panel => panel.querySelector('[data-quit]').addEventListener('click', () => { engine.stop(); state = 'menu'; menu(); }),
    });
  }
  function resume() {
    state = pause.was || 'racing';
    ui.hide();
  }
  Arcade.onBlur(pause);

  // ---------- Loop ----------

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (player && (state === 'lights' || state === 'racing' || state === 'finished')) {
      acc += dt;
      while (acc >= STEP) {
        step(STEP);
        acc -= STEP;
      }
    }
    ctx.save();
    if (shakeAmt > 0.3) ctx.translate((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);
    shakeAmt = Math.max(0, shakeAmt - dt * 30);
    if (player) {
      render();
      fx.update(state === 'paused' ? 0 : dt);
      fx.draw(ctx);
      hud();
      updateTopbar();
    } else {
      menuBackdrop(now / 1000);
    }
    ctx.restore();
    requestAnimationFrame(frame);
  }

  // Behind the menu: the selected circuit's scenery with a car parked on the grid.
  function menuBackdrop() {
    if (!bg) build(D.CIRCUITS[pickCircuit]);
    ctx.drawImage(bg.sky, 0, 0, W, H);
    ctx.drawImage(bg.far, 0, 0, W, H, 0, 0, W, H);
    ctx.drawImage(bg.mid, 0, 0, W, H, 0, 0, W, H);
    ctx.fillStyle = theme.grass[0];
    ctx.fillRect(0, bg.horizon - 2, W, H);
    ctx.fillStyle = theme.road[0];
    ctx.beginPath(); ctx.moveTo(W / 2 - 30, bg.horizon); ctx.lineTo(W / 2 + 30, bg.horizon); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.drawImage(A.car(D.TEAMS[0], 0), W / 2 - 150, H - 175, 300, 165);
  }

  function menu() {
    state = 'menu';
    player = null;
    build(D.CIRCUITS[modeChamp ? champ().round : pickCircuit]);
    Versus.attach(duelOpts);
  }

  function menuHtml() {
    const s = champ();
    const circuits = D.CIRCUITS.map((c, i) => `<button class="chip" type="button" data-circuit="${i}" aria-pressed="${i === pickCircuit}">${esc(c.name)}</button>`).join('');
    return `<p>Grand Prix racing against eleven rivals. Draft in the slipstream, save your boost for the straights, and pit when your tyres go.</p>
      <ul>
        <li><span class="kbd-only"><kbd>↑</kbd> throttle, <kbd>↓</kbd> brake, <kbd>←</kbd><kbd>→</kbd> steer, <kbd>Shift</kbd> boost.</span><span class="touch-only">Hold the left or right side to steer; the throttle is automatic. Brake and Boost buttons below.</span></li>
        <li>To pit, keep right in the pit lane before the line and slow down.</li>
      </ul>
      <div class="menu">
        <div class="row"><button class="chip" type="button" data-mode="race" aria-pressed="${!modeChamp}">Single race</button><button class="chip" type="button" data-mode="champ" aria-pressed="${modeChamp}">Championship</button></div>
        ${modeChamp ? `<p class="muted-note">Round ${s.round + 1} of ${D.CIRCUITS.length}: <b>${esc(D.CIRCUITS[s.round].name)}</b>${s.round ? ` · you have ${s.points[0]} points` : ''}</p>${s.round ? '<button class="btn secondary" type="button" data-reset>Start a new championship</button>' : ''}`
          : `<div class="row" style="flex-wrap:wrap">${circuits}</div>`}
        <div class="row">${D.LEVELS.map((l, i) => `<button class="chip" type="button" data-level="${i}" aria-pressed="${i === level}">${l.name}</button>`).join('')}</div>
        <div class="row">${[3, 5].map(n => `<button class="chip" type="button" data-laps="${n}" aria-pressed="${n === laps}">${n} laps</button>`).join('')}</div>
      </div>`;
  }

  const duelOpts = {
    ui,
    start,
    score: () => (player ? Math.max(0, Math.round((13 - position(player)) * 100 * LV.mult)) : 0),
    intro: {
      title: 'Apex GP',
      get html() { return menuHtml(); },
      button: 'Start race',
      onAction: start,
      onRender: panel => {
        const redraw = () => menu();
        panel.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { modeChamp = b.dataset.mode === 'champ'; Arcade.save('apex:mode', modeChamp ? 'champ' : 'race'); redraw(); }));
        panel.querySelectorAll('[data-circuit]').forEach(b => b.addEventListener('click', () => { pickCircuit = +b.dataset.circuit; Arcade.save('apex:circuit', pickCircuit); redraw(); }));
        panel.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => { level = +b.dataset.level; Arcade.save('apex:level', level); redraw(); }));
        panel.querySelectorAll('[data-laps]').forEach(b => b.addEventListener('click', () => { laps = +b.dataset.laps; redraw(); }));
        panel.querySelector('[data-reset]')?.addEventListener('click', () => { saveChamp({ round: 0, points: D.TEAMS.map(() => 0), level }); redraw(); });
      },
    },
  };

  menu();
  requestAnimationFrame(frame);
})();
