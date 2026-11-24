'use strict';
// Scripted Tankfield opponents that fight like different kinds of player, plus a build sampler.
const Core = require('../../../games/tankfield/core.js');
const IO = require('../../../games/tankfield/sovereign-io.js');
const { STATS, MAX_STAT, AW, AH } = Core;

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const R = (rng, a, b) => a + rng() * (b - a);

// Player-like auto-aim: lead bearing plus a little jitter.
function aimAt(world, self, opp) {
  const dx = opp.x - self.x, dy = opp.y - self.y;
  const lead = Math.hypot(dx, dy) / Core.shotSpeed(self);
  return Math.atan2(dy + opp.vy * lead, dx + opp.vx * lead) + R(world.rng, -0.08, 0.08);
}
const toward = (self, x, y, k = 1) => {
  const dx = x - self.x, dy = y - self.y, d = Math.hypot(dx, dy) || 1;
  return [dx / d * k, dy / d * k];
};
// Blends in a push toward the middle near the arena walls.
function avoidWalls(self, mx, my) {
  const m = 160;
  if (self.x < m) mx += 1;
  if (self.x > AW - m) mx -= 1;
  if (self.y < m) my += 1;
  if (self.y > AH - m) my -= 1;
  const d = Math.hypot(mx, my);
  return d > 1 ? [mx / d, my / d] : [mx, my];
}
const perp = (self, opp, sign) => {
  const [tx, ty] = toward(self, opp.x, opp.y);
  return [-ty * sign, tx * sign];
};
const out = (world, self, opp, mx, my, fire) => {
  [mx, my] = avoidWalls(self, mx, my);
  return { mx, my, aim: aimAt(world, self, opp), fire };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const STYLES = {
  // Keeps about 450 px away and circles.
  kiter(world, self, opp) {
    const d = dist(self, opp);
    const [mx, my] = d < 350 ? toward(self, opp.x, opp.y, -1) : d > 520 ? toward(self, opp.x, opp.y) : perp(self, opp, 1);
    return out(world, self, opp, mx, my, d < 800);
  },
  // Drives straight in and rams while shooting.
  rusher(world, self, opp) {
    const [mx, my] = toward(self, opp.x, opp.y);
    return out(world, self, opp, mx, my, dist(self, opp) < 750);
  },
  // Sidesteps, flipping direction every second or two, holding mid range.
  strafer(world, self, opp, dt, mem) {
    if (mem.flipAt === undefined || world.time >= mem.flipAt) {
      mem.sign = world.rng() < 0.5 ? -1 : 1; mem.flipAt = world.time + R(world.rng, 0.8, 2);
    }
    const d = dist(self, opp);
    const [px, py] = perp(self, opp, mem.sign), [tx, ty] = toward(self, opp.x, opp.y, d > 550 ? 0.7 : d < 300 ? -0.7 : 0);
    return out(world, self, opp, px + tx, py + ty, d < 850);
  },
  // Sits far back, backs off when approached, fires only when the gun is nearly on target.
  sniper(world, self, opp) {
    const d = dist(self, opp);
    let [mx, my] = d < 700 ? toward(self, opp.x, opp.y, -1) : [0, 0];
    const aim = aimAt(world, self, opp);
    [mx, my] = avoidWalls(self, mx, my);
    return { mx, my, aim, fire: d < 1200 && Math.abs(angDiff(aim, self.a)) < 0.15 };
  },
  // Hunts shapes; fights only when the duelist is close or has just hurt it.
  farmer(world, self, opp, dt, mem) {
    if (mem.hp !== undefined && self.hp < mem.hp - 0.5) mem.angryUntil = world.time + 4;
    mem.hp = self.hp;
    const d = dist(self, opp);
    if (d < 350 || world.time < (mem.angryUntil || 0)) {
      const [mx, my] = d < 300 ? toward(self, opp.x, opp.y, -1) : perp(self, opp, 1);
      return out(world, self, opp, mx, my, d < 800);
    }
    let best = null, bd = Infinity;
    for (const s of world.shapes) { const e = Math.hypot(s.x - self.x, s.y - self.y); if (e < bd) { bd = e; best = s; } }
    if (!best) return out(world, self, opp, 0, 0, false);
    const [mx, my] = avoidWalls(self, ...(bd > 250 ? toward(self, best.x, best.y) : [0, 0]));
    return { mx, my, aim: Math.atan2(best.y - self.y, best.x - self.x) + R(world.rng, -0.08, 0.08), fire: bd < 700 };
  },
  // Changes style every 15-40 s; mem.switches logs when.
  switcher(world, self, opp, dt, mem) {
    const names = Object.keys(STYLES).filter(n => n !== 'switcher');
    if (!mem.sub) { mem.sub = {}; mem.switches = []; mem.cur = null; mem.nextAt = 0; }
    if (world.time >= mem.nextAt) {
      const pool = names.filter(n => n !== mem.cur);
      mem.cur = pool[Math.floor(world.rng() * pool.length)];
      if (world.time > 0) mem.switches.push(world.time);
      mem.nextAt = world.time + R(world.rng, 15, 40);
    }
    return STYLES[mem.cur](world, self, opp, dt, mem.sub[mem.cur] || (mem.sub[mem.cur] = {}));
  },
};

// Stat weights and liked first-tier turrets per style.
const W = o => STATS.map(s => o[s.id] || 0.3);
const STYLE_BUILD = {
  kiter: { w: W({ speed: 3, shotSpeed: 2, shotPower: 2 }), paths: ['longshot', 'twin', 'spray'] },
  rusher: { w: W({ ram: 4, armor: 3, speed: 3, repair: 1 }), paths: ['spray', 'guard', 'twin'] },
  strafer: { w: W({ speed: 3, reload: 2, shotPower: 2, armor: 1 }), paths: ['twin', 'guard', 'spray'] },
  sniper: { w: W({ shotPower: 4, shotSpeed: 3, reload: 2 }), paths: ['longshot'] },
  farmer: { w: W({ reload: 3, shotPower: 2, repair: 2, armor: 2 }), paths: ['twin', 'spray', 'guard', 'longshot'] },
  switcher: { w: W({}), paths: ['twin', 'longshot', 'spray', 'guard'] },
};

// A plausible player build: an element of BUILD_PATHS and 33 stat points (never past 7 in one stat).
function styleBuild(rng, styleName) {
  const sb = STYLE_BUILD[styleName] || STYLE_BUILD.switcher;
  const liked = IO.BUILD_PATHS.filter(p => sb.paths.includes(p[0]));
  const pool = liked.length && rng() < 0.85 ? liked : IO.BUILD_PATHS;
  const path = pool[Math.floor(rng() * pool.length)];
  const counts = new Array(STATS.length).fill(0), alloc = [];
  for (let n = 0; n < 33; n++) {
    let z = 0;
    for (let i = 0; i < counts.length; i++) if (counts[i] < MAX_STAT) z += sb.w[i];
    let r = rng() * z, pick = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= MAX_STAT) continue;
      pick = i; r -= sb.w[i];
      if (r <= 0) break;
    }
    counts[pick]++; alloc.push(pick);
  }
  return { path, alloc };
}

module.exports = { STYLES, styleBuild };
