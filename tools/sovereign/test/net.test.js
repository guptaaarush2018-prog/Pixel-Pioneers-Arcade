'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../../assets/js/sovereign.js');
const { MLP } = require('../nn/ppo.js');

const HEADS = [3, 2, 2, 4];
function randArr(n, k = 0.5) { return Array.from({ length: n }, () => (Math.random() * 2 - 1) * k); }
function weightsFor(sizes) {
  const W = [], b = [];
  for (let l = 0; l < sizes.length - 1; l++) { W.push(randArr(sizes[l] * sizes[l + 1])); b.push(randArr(sizes[l + 1])); }
  return { sizes, W, b };
}

test('forward without GRU matches MLP.forward', () => {
  const w = weightsFor([6, 8, 7, 11]);
  const net = S.loadNet(w);
  const mlp = new MLP(w.sizes);
  mlp.W = w.W.map(a => Float32Array.from(a)); mlp.b = w.b.map(a => Float32Array.from(a));
  const x = Float32Array.from(randArr(6, 1));
  const ref = mlp.forward(x, 1), got = S.forward(net, x, S.newState(net));
  assert.equal(S.newState(net), null);
  for (let i = 0; i < 11; i++) assert.ok(Math.abs(ref[i] - got[i]) < 1e-5);
});

test('GRU with zero M equals no-GRU logits', () => {
  const w = weightsFor([6, 8, 7, 11]);
  const H = 5;
  const g = { H, Wi: randArr(3 * H * 8), Wh: randArr(3 * H * H), bi: randArr(3 * H), bh: randArr(3 * H), M: new Array(7 * H).fill(0) };
  const plain = S.loadNet(w), mem = S.loadNet({ ...w, gru: g });
  const h = S.newState(mem);
  assert.equal(h.length, H);
  for (let t = 0; t < 3; t++) {
    const x = Float32Array.from(randArr(6, 1));
    const a = Float32Array.from(S.forward(plain, x, null)), b = S.forward(mem, x, h);
    for (let i = 0; i < 11; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-5);
  }
  assert.ok(h.some(v => v !== 0));
});

test('sample greedy picks argmax and logp sums log-softmaxes', () => {
  const logits = Float32Array.from(randArr(11, 2));
  const act = new Int32Array(4);
  const logp = S.sample(logits, HEADS, act, true);
  let off = 0, exp = 0;
  HEADS.forEach((n, h) => {
    let pick = 0; for (let k = 1; k < n; k++) if (logits[off + k] > logits[off + pick]) pick = k;
    assert.equal(act[h], pick);
    let z = 0; for (let k = 0; k < n; k++) z += Math.exp(logits[off + k]);
    exp += Math.log(Math.exp(logits[off + pick]) / z);
    off += n;
  });
  assert.ok(Math.abs(logp - exp) < 1e-5);
});

test('loadNet round-trips base64 weights', () => {
  const w = weightsFor([4, 5, 6, 3]);
  const enc = { sizes: w.sizes, W: w.W.map(a => S.f32ToB64(Float32Array.from(a))), b: w.b.map(a => S.f32ToB64(Float32Array.from(a))) };
  const a = S.loadNet(w), b = S.loadNet(enc);
  for (let l = 0; l < 3; l++) { assert.deepEqual(Array.from(a.W[l]), Array.from(b.W[l])); assert.deepEqual(Array.from(a.b[l]), Array.from(b.b[l])); }
  assert.equal(S.loadNet(null), null);
});

test('loadWeights never throws and returns null on failure', async () => {
  assert.equal(await S.loadWeights('nope'), null);
});
