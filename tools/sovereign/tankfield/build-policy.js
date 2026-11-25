'use strict';
// Sovereign's build policy: given what the opponent built, pick a turret path and spend 33 stat
// points. Inference is TankSovIO.chooseBuild (the same code the browser runs); this file adds
// the trainable net and its REINFORCE update. Small enough to train in plain JS.
const IO = require('../../../games/tankfield/sovereign-io.js');
const { MLP } = require('../nn/ppo.js');
const { MAX_STAT } = require('../../../games/tankfield/core.js');

const NP = IO.BUILD_PATHS.length, NS = 7, POINTS = 33, ENT_COEF = 0.01;

const makeBuildNet = () => new MLP([IO.BUILD_IN, 32, NP + NS], 0.01);

// A Sovereign.forward view over the MLP's own arrays (no copy, so it always sees current weights).
const views = new WeakMap();
function view(net) {
  let v = views.get(net);
  if (!v || v.W !== net.W) { v = { sizes: net.sizes, W: net.W, b: net.b, bufs: net.sizes.map(n => new Float32Array(n)), gru: null }; views.set(net, v); }
  return v;
}

const sampleBuild = (net, oppFeatures, rng, greedy) => IO.chooseBuild(view(net), oppFeatures, rng, greedy);

function softmax(xs, open) {
  let mx = -Infinity; for (let k = 0; k < xs.length; k++) if (!open || open[k]) mx = Math.max(mx, xs[k]);
  const p = new Float64Array(xs.length); let z = 0;
  for (let k = 0; k < xs.length; k++) if (!open || open[k]) { p[k] = Math.exp(xs[k] - mx); z += p[k]; }
  for (let k = 0; k < xs.length; k++) p[k] /= z;
  return p;
}
const pathProbs = (net, f) => Array.from(softmax(Array.from(net.forward(f, 1).subarray(0, NP))));

// Adds -d(entropy)/dz * coef for a softmax over xs[off .. off+n) into g.
function entGrad(p, g, off, coef) {
  let H = 0; for (const q of p) if (q > 0) H -= q * Math.log(q);
  for (let k = 0; k < p.length; k++) if (p[k] > 0) g[off + k] -= coef * -p[k] * (Math.log(p[k]) + H);
}

// batch: [{ oppFeatures, path, alloc, outcome: +1 | -1 | 0 }]. REINFORCE with a mean baseline,
// plus an entropy bonus on the path choice and the (unmasked) stat choice.
function updateBuild(net, adam, batch) {
  const n = batch.length; if (!n) return 0;
  const out = NP + NS, X = new Float32Array(n * IO.BUILD_IN);
  batch.forEach((s, r) => X.set(s.oppFeatures, r * IO.BUILD_IN));
  const Y = net.forward(X, n), dY = new Float32Array(n * out);
  let base = 0; for (const s of batch) base += s.outcome; base /= n;
  batch.forEach((s, r) => {
    const A = s.outcome - base, o = r * out, g = new Float64Array(out);
    const z = Array.from(Y.subarray(o, o + out));
    // d(-A logp)/dz = A (p - onehot), path head then each masked stat draw.
    const pp = softmax(z.slice(0, NP));
    for (let k = 0; k < NP; k++) g[k] += A * (pp[k] - (k === s.path ? 1 : 0));
    const zs = z.slice(NP), counts = new Array(NS).fill(0);
    for (const pick of s.alloc) {
      const ps = softmax(zs, counts.map(c => c < MAX_STAT));
      for (let k = 0; k < NS; k++) g[NP + k] += A * (ps[k] - (k === pick ? 1 : 0));
      counts[pick]++;
    }
    entGrad(pp, g, 0, ENT_COEF);
    entGrad(softmax(zs), g, NP, ENT_COEF * POINTS);
    for (let k = 0; k < out; k++) dY[o + k] = g[k] / n;
  });
  net.zeroGrad(); net.backward(dY);
  return adam.step(1, 0.5);
}

module.exports = { makeBuildNet, sampleBuild, updateBuild, pathProbs, POINTS };
