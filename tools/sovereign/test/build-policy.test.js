'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../../../games/tankfield/core.js');
const IO = require('../../../games/tankfield/sovereign-io.js');
const { Adam } = require('../nn/ppo.js');
const BP = require('../tankfield/build-policy.js');
const { mulberry32 } = require('../tankfield/env.js');

const feats = rng => { const f = new Float32Array(IO.BUILD_IN); for (let i = 0; i < 7; i++) f[i] = rng(); f[7 + Math.floor(rng() * (IO.BUILD_IN - 7))] = 1; return f; };

test('allocations always spend 33 points with no stat over 7', () => {
  const net = BP.makeBuildNet(), rng = mulberry32(3);
  for (let k = 0; k < 200; k++) {
    const b = BP.sampleBuild(net, feats(rng), rng, k % 5 === 0);
    assert.equal(b.alloc.length, 33);
    const counts = new Array(7).fill(0); for (const i of b.alloc) counts[i]++;
    assert.ok(counts.every(c => c <= Core.MAX_STAT), String(counts));
    assert.ok(b.path >= 0 && b.path < IO.BUILD_PATHS.length);
    assert.ok(Number.isFinite(b.logp) && b.logp <= 0);
  }
});

test('greedy sampling is deterministic', () => {
  const net = BP.makeBuildNet(), f = feats(mulberry32(9));
  const a = BP.sampleBuild(net, f, mulberry32(1), true), b = BP.sampleBuild(net, f, mulberry32(2), true);
  assert.deepEqual(a, b);
});

test('the browser chooser agrees with the lab sampler on the same weights', () => {
  const net = BP.makeBuildNet(), f = feats(mulberry32(4));
  const S = require('../../../assets/js/sovereign.js');
  const shipped = S.loadNet(net.toJSON());
  assert.deepEqual(IO.chooseBuild(shipped, f, mulberry32(5), false), BP.sampleBuild(net, f, mulberry32(5), false));
});

test('REINFORCE learns that path 0 wins', () => {
  const net = BP.makeBuildNet(), adam = new Adam(net, 3e-3), rng = mulberry32(11);
  for (let it = 0; it < 300; it++) {
    const batch = [];
    for (let k = 0; k < 16; k++) {
      const f = feats(rng), b = BP.sampleBuild(net, f, rng, false);
      batch.push({ oppFeatures: f, path: b.path, alloc: b.alloc, outcome: b.path === 0 ? 1 : -1 });
    }
    BP.updateBuild(net, adam, batch);
  }
  const p0 = BP.pathProbs(net, feats(rng))[0];
  assert.ok(p0 > 0.8, `P(path 0) = ${p0}`);
});
