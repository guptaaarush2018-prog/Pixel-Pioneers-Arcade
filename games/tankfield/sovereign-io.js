/* Sovereign's eyes and hands for Tankfield: turns a duel into a feature vector, turns the net's
   three choices into a move/aim/fire control, and handles the pre-fight build (turret path and
   stat points). The browser boss and the Node trainer share this file. */
(function (root) {
  const Core = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.TankCore;
  const Sov = typeof module !== 'undefined' && module.exports ? require('../../assets/js/sovereign.js') : root.Sovereign;
  const { AW, AH, STATS, TURRETS, MAX_STAT } = Core;

  // move: none + 8 directions; aim: offset from the lead-predicted bearing; fire: no/yes.
  const AIM_OFFSETS = [-0.4, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.4];
  const HEADS = [9, 9, 2];
  const REPEAT = 3;   // one decision per 3 sim frames at 60 Hz

  const TURRET_IDS = Object.keys(TURRETS);
  const NT = TURRET_IDS.length;
  const TURRET_INDEX = Object.fromEntries(TURRET_IDS.map((id, i) => [id, i]));
  const N_SHOTS = 8, N_SHAPES = 4;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  // Where each block starts in the observation (tests and tools read this).
  const LAYOUT = {};
  let o = 0;
  const at = (name, n) => { LAYOUT[name] = o; o += n; };
  at('selfHp', 1); at('selfVel', 2); at('selfReload', 1); at('selfStats', 7); at('selfTurret', NT); at('selfAim', 2);
  at('oppDx', 1); at('oppDy', 1); at('oppDist', 1); at('oppVel', 2); at('oppHp', 1); at('oppStats', 7); at('oppTurret', NT);
  at('oppAim', 2); at('oppReload', 1);
  at('shots', N_SHOTS * 4); at('shapes', N_SHAPES * 3); at('walls', 4); at('prev', 9 + 9 + 2);
  const OBS_DIM = o;

  const reloadFrac = t => clamp(t.reload / Core.reloadTime(t), 0, 1);

  function observe(world, self, opp, prevAct, out) {
    out.fill(0, 0, OBS_DIM);
    const L = LAYOUT;
    out[L.selfHp] = self.hp / self.max;
    out[L.selfVel] = self.vx / 400; out[L.selfVel + 1] = self.vy / 400;
    out[L.selfReload] = reloadFrac(self);
    for (let i = 0; i < 7; i++) out[L.selfStats + i] = self.stats[STATS[i].id] / MAX_STAT;
    out[L.selfTurret + TURRET_INDEX[self.turret]] = 1;

    const dx = opp.x - self.x, dy = opp.y - self.y, dist = Math.hypot(dx, dy);
    out[L.oppDx] = clamp(dx / 1000, -1, 1); out[L.oppDy] = clamp(dy / 1000, -1, 1);
    out[L.oppDist] = clamp(dist / 1000, 0, 1);
    out[L.oppVel] = opp.vx / 400; out[L.oppVel + 1] = opp.vy / 400;
    out[L.oppHp] = opp.hp / opp.max;
    for (let i = 0; i < 7; i++) out[L.oppStats + i] = opp.stats[STATS[i].id] / MAX_STAT;
    out[L.oppTurret + TURRET_INDEX[opp.turret]] = 1;
    // How our own gun sits relative to the straight line from us to them (0 = pointing at them).
    const own = angDiff(self.a, Math.atan2(dy, dx));
    out[L.selfAim] = Math.sin(own); out[L.selfAim + 1] = Math.cos(own);
    // How the opponent's gun sits relative to the line from them to us (0 = pointing at us).
    const rel = angDiff(opp.a, Math.atan2(-dy, -dx));
    out[L.oppAim] = Math.sin(rel); out[L.oppAim + 1] = Math.cos(rel);
    out[L.oppReload] = reloadFrac(opp);

    // Nearest enemy shots, then nearest shapes.
    const shots = [];
    for (const s of world.shots) {
      if (s.owner === self) continue;
      shots.push({ s, d: (s.x - self.x) ** 2 + (s.y - self.y) ** 2 });
    }
    shots.sort((p, q) => p.d - q.d);
    for (let i = 0; i < N_SHOTS && i < shots.length; i++) {
      const s = shots[i].s, k = L.shots + i * 4;
      out[k] = clamp((s.x - self.x) / 1000, -1, 1); out[k + 1] = clamp((s.y - self.y) / 1000, -1, 1);
      out[k + 2] = clamp(s.vx / 1000, -2, 2); out[k + 3] = clamp(s.vy / 1000, -2, 2);
    }
    const shapes = [];
    for (const s of world.shapes) shapes.push({ s, d: (s.x - self.x) ** 2 + (s.y - self.y) ** 2 });
    shapes.sort((p, q) => p.d - q.d);
    for (let i = 0; i < N_SHAPES && i < shapes.length; i++) {
      const s = shapes[i].s, k = L.shapes + i * 3;
      out[k] = clamp((s.x - self.x) / 1000, -1, 1); out[k + 1] = clamp((s.y - self.y) / 1000, -1, 1);
      out[k + 2] = s.r / 50;
    }
    out[L.walls] = clamp(self.x / 1000, 0, 1); out[L.walls + 1] = clamp((AW - self.x) / 1000, 0, 1);
    out[L.walls + 2] = clamp(self.y / 1000, 0, 1); out[L.walls + 3] = clamp((AH - self.y) / 1000, 0, 1);
    out[L.prev + prevAct[0]] = 1; out[L.prev + 9 + prevAct[1]] = 1; out[L.prev + 18 + prevAct[2]] = 1;
    return out;
  }

  // The caller smooths self.a toward `aim` (dt * 12), like the player's auto-aim.
  function applyAction(world, self, opp, act, dt) {
    const dx = opp.x - self.x, dy = opp.y - self.y;
    const lead = Math.hypot(dx, dy) / Core.shotSpeed(self);
    const bearing = Math.atan2(dy + opp.vy * lead, dx + opp.vx * lead);
    let mx = 0, my = 0;
    if (act[0] > 0) { const a = (act[0] - 1) * Math.PI / 4; mx = Math.cos(a); my = Math.sin(a); }
    return { mx, my, aim: bearing + AIM_OFFSETS[act[1]], fire: act[2] === 1 };
  }

  // ---------- Build ----------

  const BUILD_PATHS = [];
  for (const a of TURRETS.basic.next) for (const b of TURRETS[a].next) BUILD_PATHS.push([a, b]);
  const N_PATHS = BUILD_PATHS.length;
  const BUILD_POINTS = 33;   // levels 2..34 each give one point

  function buildFeatures(tank) {
    const f = new Float32Array(7 + NT);
    for (let i = 0; i < 7; i++) f[i] = tank.stats[STATS[i].id] / MAX_STAT;
    f[7 + TURRET_INDEX[tank.turret]] = 1;
    return f;
  }
  const BUILD_IN = 7 + NT;

  function applyBuild(world, tank, { path, alloc }) {
    tank.level = Core.LEVEL_CAP; tank.xp = 20000;
    for (const s of STATS) tank.stats[s.id] = 0;
    tank.points = BUILD_POINTS;
    Core.setTurret(world, tank, path[1]);
    for (const i of alloc) Core.spend(world, tank, i);
    tank.max = Core.maxHp(tank);
    tank.hp = tank.max;
  }

  // One path draw, then 33 stat draws that skip stats already at 7. logp sums every draw under its mask.
  function chooseBuild(net, oppFeatures, rng, greedy) {
    const logits = Sov.forward(net, oppFeatures, null);
    const lp = Array.from(logits.subarray(0, N_PATHS));
    const st = Array.from(logits.subarray(N_PATHS, N_PATHS + 7));
    const draw = (xs, open) => {
      let mx = -Infinity;
      for (let k = 0; k < xs.length; k++) if (open[k] && xs[k] > mx) mx = xs[k];
      let z = 0;
      for (let k = 0; k < xs.length; k++) if (open[k]) z += Math.exp(xs[k] - mx);
      let pick = -1;
      if (greedy) {
        for (let k = 0; k < xs.length; k++) if (open[k] && (pick < 0 || xs[k] > xs[pick])) pick = k;
      } else {
        let r = rng() * z, last = -1;
        for (let k = 0; k < xs.length; k++) {
          if (!open[k]) continue;
          last = k; r -= Math.exp(xs[k] - mx);
          if (r <= 0) { pick = k; break; }
        }
        if (pick < 0) pick = last;
      }
      return { pick, logp: xs[pick] - mx - Math.log(z) };
    };
    const p = draw(lp, lp.map(() => true));
    let logp = p.logp;
    const counts = new Array(7).fill(0), alloc = [];
    for (let n = 0; n < BUILD_POINTS; n++) {
      const d = draw(st, counts.map(c => c < MAX_STAT));
      alloc.push(d.pick); counts[d.pick]++; logp += d.logp;
    }
    return { path: p.pick, alloc, logp };
  }

  const api = { HEADS, REPEAT, AIM_OFFSETS, OBS_DIM, LAYOUT, observe, applyAction,
    BUILD_PATHS, BUILD_IN, buildFeatures, applyBuild, chooseBuild };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TankSovIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
