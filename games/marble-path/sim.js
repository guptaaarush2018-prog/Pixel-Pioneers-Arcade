/* Marble Path physics, shared by the game and by the level checker: a marble in a world of
   fixed line segments and round bumpers, stepped at a fixed rate so a run plays out the same
   every time. Works in the browser (window.MarbleSim) and in Node (module.exports). */
(function (root) {
  const G = 900, MR = 10, STEP = 1 / 240, MAX_T = 14, RAMP = 120, BUMP = 18;

  // A level plus the pieces placed in it -> a list of segments and bumpers.
  function world(level, placed) {
    const segs = level.walls.map(w => ({ x1: w[0], y1: w[1], x2: w[2], y2: w[3], e: 0.35 }));
    const bumps = (level.bumpers || []).map(b => ({ x: b[0], y: b[1], r: b[2] || BUMP }));
    const [cx, cy] = level.cup;
    // The cup: two walls and a floor.
    segs.push({ x1: cx - 30, y1: cy - 34, x2: cx - 26, y2: cy + 12, e: 0.2 }, { x1: cx - 26, y1: cy + 12, x2: cx + 26, y2: cy + 12, e: 0.1 }, { x1: cx + 26, y1: cy + 12, x2: cx + 30, y2: cy - 34, e: 0.2 });
    for (const p of placed) {
      if (p.type === 'ramp') {
        const dx = Math.cos(p.a) * RAMP / 2, dy = Math.sin(p.a) * RAMP / 2;
        segs.push({ x1: p.x - dx, y1: p.y - dy, x2: p.x + dx, y2: p.y + dy, e: 0.3, placed: true });
      } else if (p.type === 'bumper') bumps.push({ x: p.x, y: p.y, r: BUMP, placed: true });
    }
    return { segs, bumps };
  }

  function start(level) {
    return { x: level.start[0], y: level.start[1], vx: level.v0 ? level.v0[0] : 0, vy: level.v0 ? level.v0[1] : 0, t: 0, still: 0, done: null, hits: [] };
  }

  // One fixed step. Returns 'win', 'lost' or null.
  function step(m, w, level) {
    m.vy += G * STEP;
    m.x += m.vx * STEP;
    m.y += m.vy * STEP;
    for (const s of w.segs) {
      const ex = s.x2 - s.x1, ey = s.y2 - s.y1, L2 = ex * ex + ey * ey || 1;
      let t = ((m.x - s.x1) * ex + (m.y - s.y1) * ey) / L2;
      t = Math.max(0, Math.min(1, t));
      const px = s.x1 + ex * t, py = s.y1 + ey * t;
      const dx = m.x - px, dy = m.y - py, d = Math.hypot(dx, dy), min = MR + 3;
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      m.x = px + nx * min; m.y = py + ny * min;
      const vn = m.vx * nx + m.vy * ny;
      if (vn < 0) {
        m.vx -= (1 + s.e) * vn * nx; m.vy -= (1 + s.e) * vn * ny;
        // A little rolling friction along the surface.
        m.vx *= 0.9995; m.vy *= 0.9995;
        if (-vn > 120) m.hits.push({ kind: 'seg', v: -vn, t: m.t });
      }
    }
    for (const b of w.bumps) {
      const dx = m.x - b.x, dy = m.y - b.y, d = Math.hypot(dx, dy), min = MR + b.r;
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      m.x = b.x + nx * min; m.y = b.y + ny * min;
      const vn = m.vx * nx + m.vy * ny;
      if (vn < 0) {
        // Bumpers kick back harder than they're hit.
        const out = Math.max(-vn * 1.05, 380);
        m.vx += (-vn + out) * nx; m.vy += (-vn + out) * ny;
        m.hits.push({ kind: 'bump', b, t: m.t });
      }
    }
    m.t += STEP;
    const [cx, cy] = level.cup;
    if (Math.abs(m.x - cx) < 24 && m.y > cy - 30 && m.y < cy + 10) return (m.done = 'win');
    if (m.y > 620 || m.x < -60 || m.x > 1020 || m.t > MAX_T) return (m.done = 'lost');
    const sp = Math.hypot(m.vx, m.vy);
    m.still = sp < 8 ? m.still + STEP : 0;
    if (m.still > 1.2) return (m.done = 'lost');
    return null;
  }

  // Runs a whole attempt (for the checker). Returns 'win' or 'lost'.
  function run(level, placed) {
    const w = world(level, placed), m = start(level);
    while (!m.done) step(m, w, level);
    return m.done;
  }

  const api = { world, start, step, run, STEP, MR, RAMP, BUMP };
  if (typeof module !== 'undefined') module.exports = api;
  else root.MarbleSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
