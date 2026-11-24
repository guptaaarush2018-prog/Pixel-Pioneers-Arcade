'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../../../games/tankfield/core.js');
const S = require('../../../assets/js/sovereign.js');
const IO = require('../../../games/tankfield/sovereign-io.js');

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function duel() {
  const world = Core.createWorld({ rng: seeded(7), shapes: 20 });
  const a = Core.makeTank(world, { name: 'a', color: '#fff' });
  const b = Core.makeTank(world, { name: 'b', color: '#000' });
  a.x = 800; a.y = 700; b.x = 1300; b.y = 1000; b.vx = 30; b.vy = -20;
  b.turret = 'twin'; b.stats.armor = 3; b.hp = 80; b.reload = 0.1;
  world.shots.push({ x: 900, y: 800, vx: 100, vy: 50, r: 5, dmg: 7, life: 1, owner: b, pierce: 1 });
  return { world, a, b };
}

test('observe writes exactly OBS_DIM finite values', () => {
  const { world, a, b } = duel();
  const out = new Float32Array(IO.OBS_DIM + 3).fill(NaN);
  IO.observe(world, a, b, new Int32Array([4, 2, 1]), out);
  for (let i = 0; i < IO.OBS_DIM; i++) assert.ok(Number.isFinite(out[i]), 'index ' + i);
  assert.ok(Number.isNaN(out[IO.OBS_DIM]), 'wrote past OBS_DIM');
  assert.equal(IO.OBS_DIM, 121);
});

test('mirrored world: opponent block of one matches self block of the other', () => {
  const { world, a, b } = duel();
  const prev = new Int32Array(3);
  const oa = new Float32Array(IO.OBS_DIM), ob = new Float32Array(IO.OBS_DIM);
  IO.observe(world, a, b, prev, oa);
  IO.observe(world, b, a, prev, ob);
  const L = IO.LAYOUT;
  const same = (x, xo, y, yo, n) => { for (let i = 0; i < n; i++) assert.equal(x[xo + i], y[yo + i]); };
  same(oa, L.oppHp, ob, L.selfHp, 1);
  same(oa, L.oppVel, ob, L.selfVel, 2);
  same(oa, L.oppStats, ob, L.selfStats, 7);
  same(oa, L.oppTurret, ob, L.selfTurret, Object.keys(Core.TURRETS).length);
  same(oa, L.oppReload, ob, L.selfReload, 1);
  same(ob, L.oppHp, oa, L.selfHp, 1);
  same(ob, L.oppStats, oa, L.selfStats, 7);
  assert.equal(oa[L.oppDx], -ob[L.oppDx]);
  assert.equal(oa[L.oppDy], -ob[L.oppDy]);
});

test('applyAction with aim offset 4 aims straight at a stationary opponent', () => {
  const { world, a, b } = duel();
  b.vx = 0; b.vy = 0;
  const r = IO.applyAction(world, a, b, [0, 4, 1], 1 / 60);
  assert.equal(r.aim, Math.atan2(b.y - a.y, b.x - a.x));
  assert.equal(r.fire, true);
  assert.equal(r.mx, 0); assert.equal(r.my, 0);
  const m = IO.applyAction(world, a, b, [3, 4, 0], 1 / 60);
  assert.ok(Math.abs(m.mx - Math.cos(Math.PI / 2)) < 1e-12 && Math.abs(m.my - 1) < 1e-12);
  assert.equal(m.fire, false);
});

test('applyAction leads a moving opponent', () => {
  const { world, a, b } = duel();
  const r = IO.applyAction(world, a, b, [0, 4, 0], 1 / 60);
  assert.notEqual(r.aim, Math.atan2(b.y - a.y, b.x - a.x));
});

test('applyBuild: level 45, 33 points spent, each stat <= 7', () => {
  const { world, a } = duel();
  const alloc = [];
  for (let i = 0; i < 33; i++) alloc.push(i % 7);
  IO.applyBuild(world, a, { path: IO.BUILD_PATHS[2], alloc });
  assert.equal(a.level, 45);
  assert.equal(a.xp, 20000);
  assert.equal(a.turret, IO.BUILD_PATHS[2][1]);
  const v = Object.values(a.stats);
  assert.equal(v.reduce((x, y) => x + y, 0), 33);
  assert.ok(v.every(x => x <= 7));
  assert.equal(a.hp, a.max);
  assert.equal(a.max, Core.maxHp(a));
  // Overspending a stat past 7 is capped, never exceeded.
  IO.applyBuild(world, a, { path: IO.BUILD_PATHS[0], alloc: new Array(33).fill(4) });
  assert.equal(a.stats.shotPower, 7);
});

test('BUILD_PATHS covers every [level10, level20] pair', () => {
  let leaves = 0;
  for (const k of Core.TURRETS.basic.next) leaves += Core.TURRETS[k].next.length;
  assert.equal(IO.BUILD_PATHS.length, leaves);
  for (const [p, q] of IO.BUILD_PATHS) assert.ok(Core.TURRETS[p].next.includes(q));
});

test('buildFeatures: 7 stats/7 plus a turret one-hot, length BUILD_IN', () => {
  const { a } = duel();
  a.stats.armor = 7; a.turret = 'rail';
  const f = IO.buildFeatures(a);
  assert.equal(f.length, IO.BUILD_IN);
  assert.equal(f[0], 1);
  assert.equal(f[7 + Object.keys(Core.TURRETS).indexOf('rail')], 1);
});

function handNet(bias) {
  const n = IO.BUILD_PATHS.length + 7;
  return S.loadNet({ sizes: [IO.BUILD_IN, 32, n], W: [new Array(IO.BUILD_IN * 32).fill(0), new Array(32 * n).fill(0)], b: [new Array(32).fill(0), bias] });
}
function replayLogp(bias, res) {
  const np = IO.BUILD_PATHS.length;
  const lse = (xs) => { const m = Math.max(...xs); return m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0)); };
  let lp = bias[res.path] - lse(bias.slice(0, np));
  const counts = new Array(7).fill(0);
  for (const s of res.alloc) {
    const open = [];
    for (let k = 0; k < 7; k++) if (counts[k] < 7) open.push(bias[np + k]);
    lp += bias[np + s] - lse(open);
    counts[s]++;
  }
  return lp;
}

test('chooseBuild: valid alloc, deterministic greedy, hand-summed logp', () => {
  const np = IO.BUILD_PATHS.length;
  const bias = Array.from({ length: np + 7 }, (_, i) => Math.sin(i * 1.7));
  const net = handNet(bias);
  const feats = new Float32Array(IO.BUILD_IN);
  for (const greedy of [true, false]) {
    const res = IO.chooseBuild(net, feats, seeded(3), greedy);
    assert.equal(res.alloc.length, 33);
    const cnt = new Array(7).fill(0);
    for (const s of res.alloc) cnt[s]++;
    assert.ok(cnt.every(c => c <= 7));
    assert.ok(res.path >= 0 && res.path < np);
    assert.ok(Number.isFinite(res.logp));
    assert.ok(Math.abs(res.logp - replayLogp(bias.map(Math.fround), res)) < 1e-9);
  }
  const g1 = IO.chooseBuild(net, feats, seeded(1), true), g2 = IO.chooseBuild(net, feats, seeded(99), true);
  assert.deepEqual(g1, g2);
  const top = bias.slice(0, np).indexOf(Math.max(...bias.slice(0, np)));
  assert.equal(g1.path, top);
  assert.equal(g1.alloc[0], bias.slice(np).indexOf(Math.max(...bias.slice(np))));
});
