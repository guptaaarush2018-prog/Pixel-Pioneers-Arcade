'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../../assets/js/sovereign.js');
const IO = require('../../../games/tankfield/sovereign-io.js');
const { runEpisode, mulberry32 } = require('../tankfield/env.js');
const { STYLES, styleBuild } = require('../tankfield/styles.js');

function randNet(seed, gru) {
  const r = mulberry32(seed), arr = n => Array.from({ length: n }, () => (r() - 0.5) * 0.4);
  const sizes = gru ? [IO.OBS_DIM, 16, 16, 20] : [IO.OBS_DIM, 16, 20];
  const W = [], b = [];
  for (let l = 0; l < sizes.length - 1; l++) { W.push(arr(sizes[l] * sizes[l + 1])); b.push(arr(sizes[l + 1])); }
  const weights = { sizes, W, b };
  if (gru) { const H = 8; weights.gru = { H, Wi: arr(3 * H * 16), Wh: arr(3 * H * H), bi: arr(3 * H), bh: arr(3 * H), M: arr(16 * H) }; }
  return S.loadNet(weights);
}

test('episode against idle ends by maxT with consistent array lengths', () => {
  const r = runEpisode({ seed: 1, sovNet: randNet(5, true), opponent: { kind: 'idle' }, maxT: 6 });
  assert.ok(r.len > 0 && r.len <= Math.ceil(6 * 60 / IO.REPEAT));
  assert.equal(r.obs.length, r.len * IO.OBS_DIM);
  assert.equal(r.acts.length, r.len * IO.HEADS.length);
  assert.equal(r.logps.length, r.len);
  assert.equal(r.rews.length, r.len);
  assert.equal(r.done.length, r.len);
  assert.ok(['win', 'loss', 'timeout'].includes(r.outcome));
});

test('same seed and net give identical rews, a different seed does not', () => {
  const net = randNet(9, true);
  const run = seed => runEpisode({ seed, sovNet: net, opponent: { kind: 'style', name: 'strafer' }, maxT: 15 });
  const a = run(3), b = run(3), c = run(4);
  assert.deepEqual(Array.from(a.rews), Array.from(b.rews));
  assert.deepEqual(Array.from(a.acts), Array.from(b.acts));
  assert.notDeepEqual(Array.from(a.acts), Array.from(c.acts));
});

test('net opponents and ablation flags run', () => {
  const r = runEpisode({ seed: 5, sovNet: randNet(1, true), opponent: { kind: 'net', net: randNet(2, true), greedy: false },
    maxT: 8, memWipeEvery: 5, histOff: true });
  assert.ok(r.len > 0);
});

test('switcher records at least 2 switches over 120 s', () => {
  const { makeDuel } = require('../tankfield/env.js');
  const { world, sov, opp } = makeDuel({ seed: 2 });
  const mem = {};
  for (let i = 0; i < 120 * 20; i++) { world.time = i / 20; STYLES.switcher(world, sov, opp, 0.05, mem); }
  assert.ok(mem.switches.length >= 2, 'switches ' + mem.switches.length);
  for (let i = 1; i < mem.switches.length; i++) assert.ok(mem.switches[i] - mem.switches[i - 1] >= 14.9);
  // and the env reports them when the switcher is the opponent
  const r = runEpisode({ seed: 2, sovNet: randNet(1), opponent: { kind: 'style', name: 'switcher' }, maxT: 5 });
  assert.ok(Array.isArray(r.switches));
});

test('styleBuild: 33 points, every stat at most 7, valid path', () => {
  const rng = mulberry32(11);
  for (const name of Object.keys(STYLES)) for (let i = 0; i < 50; i++) {
    const { path, alloc } = styleBuild(rng, name);
    assert.equal(alloc.length, 33);
    const c = new Array(7).fill(0);
    for (const k of alloc) c[k]++;
    assert.ok(Math.max(...c) <= 7);
    assert.ok(IO.BUILD_PATHS.some(p => p[0] === path[0] && p[1] === path[1]));
  }
});

test('a scripted rusher beats idle in at least 9 of 10 seeds', () => {
  let wins = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const r = runEpisode({ seed, sovNet: null, sovStyle: 'rusher', opponent: { kind: 'idle' }, maxT: 120 });
    if (r.outcome === 'win') wins++;
  }
  assert.ok(wins >= 9, 'rusher wins ' + wins);
});
