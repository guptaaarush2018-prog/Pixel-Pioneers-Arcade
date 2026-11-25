'use strict';
// What a behaviour clone sees and does. The same features come from a recorded row (clone.js
// training) and from a live world (the env's 'clone' opponent), so a clone plays the way it learned.
//
// Recorded row (game.js, 10 Hz): [x, y, vx, vy, a*100, hp] for the player, the same for
// Sovereign, then the player's mx, my, fire, then Sovereign's three choices.
const Sov = require('../../../assets/js/sovereign.js');
const Core = require('../../../games/tankfield/core.js');
const { AW, AH } = Core;

const ROW = { me: 0, sov: 6, mx: 12, my: 13, fire: 14, sovAct: 15 };
const HEADS = [3, 3, 2];   // mx in {-1, 0, 1}, my in {-1, 0, 1}, fire in {0, 1}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// self, foe: { x, y, vx, vy, hp }. Only what a recording holds.
function features(self, foe) {
  const dx = foe.x - self.x, dy = foe.y - self.y;
  return Float32Array.of(
    clamp(dx / 1000, -2, 2), clamp(dy / 1000, -2, 2), Math.min(2, Math.hypot(dx, dy) / 1000),
    self.vx / 400, self.vy / 400, foe.vx / 400, foe.vy / 400,
    self.hp / 1000, foe.hp / 1000,
    self.x / AW, self.y / AH, (AW - self.x) / AW, (AH - self.y) / AH,
  );
}
const CLONE_IN = 13;
const part = (row, o) => ({ x: row[o], y: row[o + 1], vx: row[o + 2], vy: row[o + 3], hp: row[o + 5] });
const rowFeatures = row => features(part(row, ROW.me), part(row, ROW.sov));
// Class index per head for a row's recorded inputs.
const rowTargets = row => [Math.sign(row[ROW.mx]) + 1, Math.sign(row[ROW.my]) + 1, row[ROW.fire] ? 1 : 0];

// rng null → most likely choice per head; otherwise sampled (players aren't deterministic).
function predict(net, feats, rng) {
  const logits = Sov.forward(net, feats, null), act = new Int32Array(3);
  Sov.sample(logits, HEADS, act, !rng, rng || undefined);
  return { mx: act[0] - 1, my: act[1] - 1, fire: act[2] === 1 };
}

// A clone driving a tank in the env: its own move and trigger, aim like the player's auto-aim.
function control(world, self, foe, net, rng) {
  const p = predict(net, features(self, foe), rng);
  const dx = foe.x - self.x, dy = foe.y - self.y, lead = Math.hypot(dx, dy) / Core.shotSpeed(self);
  const aim = Math.atan2(dy + foe.vy * lead, dx + foe.vx * lead) + (world.rng() - 0.5) * 0.16;
  return { mx: p.mx, my: p.my, aim, fire: p.fire };
}

module.exports = { ROW, HEADS, CLONE_IN, features, rowFeatures, rowTargets, predict, control };
