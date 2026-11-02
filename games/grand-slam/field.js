/* Grand Slam fielding: turns a batted ball (direction, exit speed, launch angle) into a result,
   plans the play (ball flight, fielders, throws, runners) as a timeline, and draws it on a
   top-down diamond. Distances are in feet; angle 0 is straight to centre field, positive to right. */
const SlamField = (() => {
  const G = 32.2;
  const RUN = 27;                   // runner speed, ft/s
  const THROW = 115;                // throwing speed, ft/s
  const REACT = 0.35;
  const D2R = Math.PI / 180;
  const BASES = [[0, 0], [45, 90], [0, 127.3], [-45, 90]];   // home, 1st, 2nd, 3rd as [angle, distance]
  const SPOTS = {
    P: [0, 60.5], C: [180, 4], '1B': [34, 100], '2B': [13, 148], SS: [-13, 148], '3B': [-34, 100],
    LF: [-27, 285], CF: [0, 315], RF: [27, 285],
  };
  const fence = a => 330 + (400 - 330) * Math.cos(Math.min(1, Math.abs(a) / 45) * Math.PI / 2);   // 330 down the lines, 400 to centre

  const toXY = (a, d) => [Math.sin(a * D2R) * d, Math.cos(a * D2R) * d];
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const lerp = (a, b, k) => a + (b - a) * k;
  const baseXY = n => toXY(...BASES[n % 4]);

  // Where the ball goes and what happens to it. Returns the outcome and a timeline to animate.
  function resolve(angle, mph, launch, bases, outs, fielderSpeed = 1) {
    const v = mph * 1.467;
    const fair = Math.abs(angle) <= 45;
    const fielders = Object.entries(SPOTS).map(([pos, [a, d]]) => ({ pos, home: toXY(a, d), speed: (pos.length === 2 && pos !== 'SS' && pos !== '2B' && pos !== '1B' && pos !== '3B' ? 24 : 21) * fielderSpeed }));
    const dir = [Math.sin(angle * D2R), Math.cos(angle * D2R)];
    const play = { angle, mph, launch, events: [], ball: [], runners: [], fielders: fielders.map(f => ({ pos: f.pos, path: [[0, f.home]] })), result: '', runs: 0, outs: 0, bases: [...bases], text: '' };

    // Foul balls: high pop-ups near the lines can be caught.
    if (!fair) {
      const hang = launch > 0 ? (2 * v * Math.sin(launch * D2R) / G) * 0.75 : 0.8;
      const range = launch > 0 ? Math.min(260, (v * v * Math.sin(2 * launch * D2R) / G) * 0.55) : 60;
      const land = toXY(Math.sign(angle) * Math.min(80, Math.abs(angle)), range);
      play.ball.push({ t0: 0, t1: hang, from: [0, 0], to: land, h: launch > 0 ? v * v * Math.sin(launch * D2R) ** 2 / (2 * G) * 0.4 : 0 });
      const catcher = nearest(fielders, land);
      const t = REACT + dist(catcher.home, land) / catcher.speed;
      if (launch > 40 && t < hang && range < 230) {
        play.result = 'foulout';
        play.text = 'Foul out';
        play.outs = 1;
        play.fielders.find(f => f.pos === catcher.pos).path.push([t, land]);
      } else {
        play.result = 'foul';
        play.text = 'Foul ball';
      }
      play.end = hang + 0.4;
      return play;
    }

    // Home runs: high enough and far enough.
    if (launch > 12) {
      const hang = (2 * v * Math.sin(launch * D2R) / G) * 0.72;
      const range = (v * v * Math.sin(2 * launch * D2R) / G) * 0.62;
      const apex = v * v * Math.sin(launch * D2R) ** 2 / (2 * G) * 0.5;
      if (range > fence(angle) + 4) {
        const land = toXY(angle, range);
        play.ball.push({ t0: 0, t1: hang, from: [0, 0], to: land, h: apex });
        play.result = 'hr';
        play.text = bases.every(Boolean) ? 'GRAND SLAM!' : 'HOME RUN!';
        advanceAll(play, 4, hang * 0.2);
        play.end = Math.max(hang + 0.6, ...play.runners.map(r => r.t1)) + 0.4;
        return play;
      }
      // Fly ball or line drive: does anyone get under it?
      const land = toXY(angle, Math.min(range, fence(angle) - 6));
      play.ball.push({ t0: 0, t1: hang, from: [0, 0], to: land, h: apex });
      const f = nearest(fielders, land);
      const tf = REACT + dist(f.home, land) / f.speed;
      if (tf <= hang + 0.05) {
        play.fielders.find(q => q.pos === f.pos).path.push([Math.min(tf, hang), land]);
        play.result = 'flyout';
        play.text = range < 140 ? (launch > 45 ? 'Pop out' : 'Lined out') : 'Fly out';
        play.outs = 1;
        // A deep fly with a runner on third and fewer than two outs: tag up and score.
        if (bases[2] && outs < 2 && range > 210) {
          play.runners.push(run(3, 4, hang + 0.1));
          play.bases[2] = false;
          play.runs = 1;
          play.text += ' · sac fly';
        }
        play.end = hang + 1.4;
        return play;
      }
      // It drops: the ball rolls on a little, then it's picked up and thrown in.
      const roll = toXY(angle, Math.min(fence(angle) - 4, range + v * 0.25));
      play.ball.push({ t0: hang, t1: hang + 0.8, from: land, to: roll, h: 0 });
      const tPick = Math.max(hang + 0.3, REACT + dist(f.home, roll) / f.speed);
      play.fielders.find(q => q.pos === f.pos).path.push([tPick, roll]);
      return hitPlay(play, roll, tPick, bases, outs);
    }

    // Ground ball: the first infielder who can cut it off fields it and throws to first.
    const gv = v * 0.72;
    let fielded = null;
    for (let d = 20; d < 200; d += 4) {
      const p = [dir[0] * d, dir[1] * d];
      const tb = d / gv * (1 + d / 400);
      for (const f of fielders) {
        if (f.pos === 'C' || f.home[1] > 200) continue;
        const tf = REACT + dist(f.home, p) / f.speed;
        if (tf <= tb) { fielded = { f, p, t: tb }; break; }
      }
      if (fielded) break;
    }
    if (fielded) {
      const { f, p, t } = fielded;
      play.ball.push({ t0: 0, t1: t, from: [0, 0], to: p, h: 0, ground: true });
      play.fielders.find(q => q.pos === f.pos).path.push([t, p]);
      // Double play: a force at second, then the relay to first.
      if (bases[0] && outs < 2 && Math.random() < 0.4) {
        const t2 = t + 0.3 + dist(p, baseXY(2)) / THROW;
        const t3 = t2 + 0.35 + dist(baseXY(2), baseXY(1)) / THROW;
        play.ball.push({ t0: t + 0.3, t1: t2, from: p, to: baseXY(2), h: 6 }, { t0: t2 + 0.35, t1: t3, from: baseXY(2), to: baseXY(1), h: 6 });
        play.runners.push(run(1, 2, 0, t2), run(0, 1, 0, t3 + 0.2));
        play.outs = 2;
        play.result = 'dp';
        play.text = 'Double play!';
        play.bases[0] = false;
        if (bases[1]) { play.runners.push(run(2, 3, 0)); play.bases[1] = false; play.bases[2] = true; }
        if (bases[2] && outs === 0) { play.runners.push(run(3, 4, 0)); play.bases[2] = false; play.runs++; }
        play.end = t3 + 1;
        return play;
      }
      const tThrow = t + 0.35 + dist(p, baseXY(1)) / THROW;
      const tRunner = 0.6 + 90 / RUN;
      play.ball.push({ t0: t + 0.35, t1: tThrow, from: p, to: baseXY(1), h: 6 });
      if (tThrow < tRunner) {
        play.result = 'groundout';
        play.text = 'Ground out';
        play.outs = 1;
        play.runners.push(run(0, 1, 0.6, tThrow + 0.1));
        // Forced runners move up; a runner on third scores with fewer than two outs half the time.
        forceAdvance(play, bases, outs, true);
      } else {
        play.result = 'single';
        play.text = 'Infield single!';
        play.runners.push(run(0, 1, 0.6));
        play.bases = [true, bases[1], bases[2]];
        forceAdvance(play, bases, outs, false);
      }
      play.end = Math.max(tThrow, ...play.runners.map(r => r.t1)) + 0.8;
      return play;
    }
    // Through the infield into the outfield.
    const out = toXY(angle, 175 + gv * 0.6);
    const f = nearest(fielders.filter(q => q.home[1] > 200), out);
    const tPick = REACT + dist(f.home, out) / f.speed;
    play.ball.push({ t0: 0, t1: tPick, from: [0, 0], to: out, h: 0, ground: true });
    play.fielders.find(q => q.pos === f.pos).path.push([tPick, out]);
    return hitPlay(play, out, tPick, bases, outs);
  }

  // A clean hit: the batter takes as many bases as they can beat the throw to.
  function hitPlay(play, at, tPick, bases, outs) {
    let n = 1;
    for (let b = 2; b <= 3; b++) {
      const runnerT = 0.6 + (90 * b) / RUN + 0.3 * (b - 1);
      const throwT = tPick + 0.4 + dist(at, baseXY(b)) / THROW;
      if (runnerT + 0.25 < throwT) n = b;
    }
    play.result = ['', 'single', 'double', 'triple'][n];
    play.text = ['', 'Single!', 'Double!', 'Triple!'][n];
    play.ball.push({ t0: tPick + 0.4, t1: tPick + 0.4 + dist(at, baseXY(Math.min(n + 1, 3))) / THROW, from: at, to: baseXY(Math.min(n + 1, 3) % 4), h: 8 });
    // Runners ahead move up by the same number of bases, sometimes one more on a single.
    const next = [false, false, false];
    for (let b = 3; b >= 1; b--) {
      if (!bases[b - 1]) continue;
      let to = b + n + (n === 1 && b >= 1 && Math.random() < (b === 2 ? 0.6 : 0.25) ? 1 : 0);
      if (to >= 4) { to = 4; play.runs++; }
      else if (next[to - 1]) to = Math.min(4, to + 1);
      if (to < 4) next[to - 1] = true;
      play.runners.push(run(b, to, 0.4));
    }
    next[n - 1] = true;
    play.runners.push(run(0, n, 0.6));
    play.bases = next;
    play.end = Math.max(...play.runners.map(r => r.t1), play.ball[play.ball.length - 1].t1) + 0.8;
    void outs;
    return play;
  }

  function forceAdvance(play, bases, outs, batterOut) {
    const next = [...bases];
    if (bases[0] && bases[1] && bases[2] && !batterOut) { play.runners.push(run(3, 4, 0.4)); play.runs++; next[2] = false; }
    if (bases[0] && bases[1] && !batterOut) { play.runners.push(run(2, 3, 0.4)); next[2] = true; next[1] = false; }
    if (bases[0] && !batterOut) { play.runners.push(run(1, 2, 0.4)); next[1] = true; }
    if (batterOut) {
      if (bases[2] && outs < 2 && Math.random() < 0.5) { play.runners.push(run(3, 4, 0.4)); play.runs++; next[2] = false; }
      if (bases[1] && !next[2]) { play.runners.push(run(2, 3, 0.4)); next[2] = true; next[1] = false; }
      if (bases[0] && !next[1]) { play.runners.push(run(1, 2, 0.4)); next[1] = true; next[0] = false; }
    } else next[0] = true;
    play.bases = next;
  }

  function advanceAll(play, n, delay) {
    for (let b = 3; b >= 1; b--) if (play.bases[b - 1]) { play.runners.push(run(b, 4, delay)); play.runs++; }
    play.runners.push(run(0, n, delay));
    play.runs++;
    play.bases = [false, false, false];
  }

  // A runner going from base a to base b (4 = home), starting at t0; outAt marks a put-out.
  function run(a, b, t0, outAt = null) {
    const legs = b - a;
    return { a, b, t0, t1: t0 + (legs * 90) / RUN + 0.2 * (legs - 1), outAt };
  }

  function nearest(list, p) {
    return list.reduce((best, f) => (dist(f.home, p) < dist(best.home, p) ? f : best));
  }

  // Positions at time t, for drawing.
  function ballAt(play, t) {
    let seg = play.ball[0];
    for (const s of play.ball) if (t >= s.t0) seg = s;
    if (!seg) return null;
    const k = Math.max(0, Math.min(1, (t - seg.t0) / Math.max(0.01, seg.t1 - seg.t0)));
    return { x: lerp(seg.from[0], seg.to[0], k), y: lerp(seg.from[1], seg.to[1], k), h: seg.h * 4 * k * (1 - k) };
  }
  function fielderAt(f, t) {
    let prev = f.path[0];
    for (const p of f.path.slice(1)) {
      if (t <= p[0]) {
        const k = Math.max(0, Math.min(1, (t - REACT) / Math.max(0.01, p[0] - REACT)));
        return [lerp(prev[1][0], p[1][0], k), lerp(prev[1][1], p[1][1], k)];
      }
      prev = p;
    }
    return prev[1];
  }
  function runnerAt(r, t) {
    const k = Math.max(0, Math.min(1, (t - r.t0) / (r.t1 - r.t0)));
    const along = r.a + (r.b - r.a) * k;
    const b0 = Math.floor(along), f = along - b0;
    const p = baseXY(b0), q = baseXY(b0 + 1);
    return [lerp(p[0], q[0], f), lerp(p[1], q[1], f)];
  }

  // ---------- Drawing the diamond ----------

  function view(W, H) {
    const k = Math.min((H - 40) / 420, W / 760);
    return { k, ox: W / 2, oy: H - 22 };
  }
  const scr = (v, x, y) => [v.ox + x * v.k, v.oy - y * v.k];

  function renderField(c, W, H) {
    const v = view(W, H);
    c.fillStyle = '#18202e';
    c.fillRect(0, 0, W, H);
    // Stands behind the outfield wall.
    c.fillStyle = '#232b3d';
    c.beginPath();
    c.moveTo(...scr(v, -330 * 0.707 - 40, 330 * 0.707 - 40));
    for (let a = -45; a <= 45; a += 3) c.lineTo(...scr(v, ...toXY(a, fence(a) + 60)));
    c.lineTo(...scr(v, 330 * 0.707 + 40, 330 * 0.707 - 40));
    c.fill();
    // Grass inside the fence, with mowing stripes.
    c.save();
    c.beginPath();
    c.moveTo(...scr(v, 0, -10));
    for (let a = -45; a <= 45; a += 3) c.lineTo(...scr(v, ...toXY(a, fence(a))));
    c.closePath();
    c.fillStyle = '#3f8f3f';
    c.fill();
    c.clip();
    for (let i = -12; i < 12; i++) {
      c.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      c.beginPath();
      c.moveTo(...scr(v, i * 40, 0)); c.lineTo(...scr(v, i * 40 + 40, 0)); c.lineTo(...scr(v, i * 40 + 40 + 300, 460)); c.lineTo(...scr(v, i * 40 + 300, 460));
      c.fill();
    }
    // Infield dirt arc and the grass square.
    c.fillStyle = '#c99a62';
    c.beginPath();
    c.moveTo(...scr(v, 0, -8));
    for (let a = -47; a <= 47; a += 2) c.lineTo(...scr(v, ...toXY(a, 150)));
    c.closePath();
    c.fill();
    c.fillStyle = '#3f8f3f';
    c.beginPath();
    [baseXY(0), baseXY(1), baseXY(2), baseXY(3)].forEach(([x, y], i) => {
      const s = 0.72, cx = 0, cy = 63.6;
      const p = scr(v, cx + (x - cx) * s, cy + (y - cy) * s);
      i ? c.lineTo(...p) : c.moveTo(...p);
    });
    c.closePath();
    c.fill();
    c.fillStyle = '#c99a62';
    c.beginPath(); c.arc(...scr(v, 0, 60.5), 9 * v.k, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(...scr(v, 0, 0), 13 * v.k, 0, Math.PI * 2); c.fill();
    c.restore();
    // Foul lines, bases, warning track and the wall.
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 2;
    for (const a of [-45, 45]) { c.beginPath(); c.moveTo(...scr(v, 0, 0)); c.lineTo(...scr(v, ...toXY(a, 330))); c.stroke(); }
    c.strokeStyle = '#a67a48';
    c.lineWidth = 10 * v.k;
    c.beginPath();
    for (let a = -45; a <= 45; a += 3) { const p = scr(v, ...toXY(a, fence(a) - 6)); a === -45 ? c.moveTo(...p) : c.lineTo(...p); }
    c.stroke();
    c.strokeStyle = '#1f5f8a';
    c.lineWidth = 5;
    c.beginPath();
    for (let a = -45; a <= 45; a += 3) { const p = scr(v, ...toXY(a, fence(a))); a === -45 ? c.moveTo(...p) : c.lineTo(...p); }
    c.stroke();
    c.fillStyle = '#ffc53d';
    c.font = `800 ${Math.round(11 * v.k * 1.6)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    for (const [a, label] of [[-45, '330'], [-22, '375'], [0, '400'], [22, '375'], [45, '330']]) c.fillText(label, ...scr(v, ...toXY(a, fence(a) - 18)));
    for (let b = 1; b <= 3; b++) {
      const [x, y] = scr(v, ...baseXY(b));
      c.fillStyle = '#f4f4f4';
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillRect(-4, -4, 8, 8); c.restore();
    }
    const [hx, hy] = scr(v, 0, 0);
    c.fillStyle = '#f4f4f4';
    c.beginPath(); c.moveTo(hx - 5, hy - 4); c.lineTo(hx + 5, hy - 4); c.lineTo(hx + 5, hy + 1); c.lineTo(hx, hy + 5); c.lineTo(hx - 5, hy + 1); c.fill();
    return v;
  }

  function drawFigure(c, x, y, s, shirt, cap, moving, t) {
    const step = moving ? Math.sin(t * 18) * 3 * s : 0;
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.ellipse(x, y + 2 * s, 6 * s, 2.5 * s, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#e8e8e8';
    c.lineWidth = 2.6 * s;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - 1.5 * s, y - 5 * s); c.lineTo(x - 2 * s + step, y + 1 * s); c.moveTo(x + 1.5 * s, y - 5 * s); c.lineTo(x + 2 * s - step, y + 1 * s); c.stroke();
    c.fillStyle = shirt;
    c.beginPath(); c.roundRect(x - 4 * s, y - 12 * s, 8 * s, 8 * s, 2.5 * s); c.fill();
    c.fillStyle = '#f2c9a0';
    c.beginPath(); c.arc(x, y - 14.5 * s, 2.8 * s, 0, Math.PI * 2); c.fill();
    c.fillStyle = cap;
    c.beginPath(); c.arc(x, y - 15.3 * s, 2.9 * s, Math.PI, 0); c.fill();
  }

  // Draws the play at time t. defense/offense: { shirt, cap } kits.
  function drawPlay(c, W, H, play, t, defense, offense, bases) {
    const v = view(W, H);
    const s = v.k * 1.25;
    const fieldersNow = play ? play.fielders.map(f => ({ pos: f.pos, p: fielderAt(f, t), moving: f.path.length > 1 && t < f.path[f.path.length - 1][0] })) : Object.entries(SPOTS).map(([pos, [a, d]]) => ({ pos, p: toXY(a, d), moving: false }));
    for (const f of fieldersNow) {
      const [x, y] = scr(v, ...f.p);
      drawFigure(c, x, y, s, defense.shirt, defense.cap, f.moving, t);
    }
    // Runners: everyone on base who isn't moving in this play, then the ones who are.
    const movingFrom = new Set(play ? play.runners.map(r => r.a) : []);
    bases.forEach((on, i) => {
      if (on && !movingFrom.has(i + 1)) { const [x, y] = scr(v, ...baseXY(i + 1)); drawFigure(c, x + 6 * s, y, s, offense.shirt, offense.cap, false, t); }
    });
    if (play) {
      for (const r of play.runners) {
        if (r.outAt !== null && t > r.outAt + 0.6) continue;
        const [x, y] = scr(v, ...runnerAt(r, t));
        drawFigure(c, x, y, s, offense.shirt, offense.cap, t > r.t0 && t < r.t1, t);
        if (r.outAt !== null && t > r.outAt) {
          c.fillStyle = '#ff5d5d';
          c.font = `900 ${Math.round(12 * s)}px system-ui, sans-serif`;
          c.textAlign = 'center';
          c.fillText('OUT', x, y - 22 * s);
        }
      }
      const b = ballAt(play, t);
      if (b && t <= play.ball[play.ball.length - 1].t1 + 0.2) {
        const [x, y] = scr(v, b.x, b.y);
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.beginPath(); c.ellipse(x, y, 3 * s, 1.6 * s, 0, 0, Math.PI * 2); c.fill();
        const r = 2.4 * s + b.h * 0.012 * s;
        c.fillStyle = '#ffffff';
        c.beginPath(); c.arc(x, y - b.h * v.k * 0.35, r, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#d64545';
        c.lineWidth = 1;
        c.stroke();
      }
    }
  }

  return { resolve, renderField, drawPlay, fence, toXY, baseXY, view, scr };
})();
