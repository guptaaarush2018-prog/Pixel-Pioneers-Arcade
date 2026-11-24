'use strict';
/*
 * tools/sovereign/nn/ppo.js — a small MLP with backprop + Adam, and a PPO update. DEV ONLY.
 *
 * Plain JS, no dependencies, so the exact weights trained here load into the
 * browser's Sovereign.forward() (assets/js/sovereign.js) byte for byte: same layout
 * (row-major [out][in]), same tanh hidden layers, linear output.
 */

function randn() {
  const u = Math.random() || 1e-12, v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const GRU_KEYS = ['Wi', 'Wh', 'bi', 'bh', 'M'];

class MLP {
  constructor(sizes, outGain = 1) {
    this.sizes = sizes;
    this.L = sizes.length - 1;
    this.W = []; this.b = []; this.gW = []; this.gb = [];
    for (let l = 0; l < this.L; l++) {
      const nIn = sizes[l], nOut = sizes[l + 1];
      const gain = l === this.L - 1 ? outGain : Math.sqrt(2);
      const W = new Float32Array(nIn * nOut);
      for (let i = 0; i < W.length; i++) W[i] = randn() * gain / Math.sqrt(nIn);
      this.W.push(W); this.b.push(new Float32Array(nOut));
      this.gW.push(new Float32Array(nIn * nOut)); this.gb.push(new Float32Array(nOut));
    }
    this.acts = null;
    this.gru = null;
  }

  // Memory block (assets/js/sovereign.js loadNet): a GRU fed by the first hidden layer and
  // added into the second through M. M starts at zero, so the net plays exactly as
  // it did until training finds a use for the memory. Trained by torch_ppo.py only.
  addGru(H) {
    const nIn = this.sizes[1], k = 1 / Math.sqrt(H);
    const u = n => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * k; return a; };
    this.gru = { H, Wi: u(3 * H * nIn), Wh: u(3 * H * H), bi: u(3 * H), bh: u(3 * H), M: new Float32Array(this.sizes[2] * H) };
    return this;
  }

  // X: Float32Array(n * in). Caches activations for backward().
  forward(X, n) {
    const acts = [X];
    let inp = X;
    for (let l = 0; l < this.L; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1], W = this.W[l], b = this.b[l];
      const out = new Float32Array(n * nOut);
      const last = l === this.L - 1;
      for (let r = 0; r < n; r++) {
        const xo = r * nIn, yo = r * nOut;
        for (let o = 0; o < nOut; o++) {
          let s = b[o]; const wo = o * nIn;
          for (let i = 0; i < nIn; i++) s += W[wo + i] * inp[xo + i];
          out[yo + o] = last ? s : Math.tanh(s);
        }
      }
      acts.push(out);
      inp = out;
    }
    this.acts = acts; this.n = n;
    return inp;
  }

  zeroGrad() { for (let l = 0; l < this.L; l++) { this.gW[l].fill(0); this.gb[l].fill(0); } }

  // dOut: gradient of the loss w.r.t. the last forward()'s output. Accumulates.
  backward(dOut) {
    const n = this.n;
    let dY = dOut;
    for (let l = this.L - 1; l >= 0; l--) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1], W = this.W[l], gW = this.gW[l], gb = this.gb[l];
      const X = this.acts[l];
      const dX = l > 0 ? new Float32Array(n * nIn) : null;
      for (let r = 0; r < n; r++) {
        const xo = r * nIn, yo = r * nOut;
        for (let o = 0; o < nOut; o++) {
          const g = dY[yo + o];
          if (g === 0) continue;
          gb[o] += g;
          const wo = o * nIn;
          for (let i = 0; i < nIn; i++) {
            gW[wo + i] += g * X[xo + i];
            if (dX) dX[xo + i] += g * W[wo + i];
          }
        }
      }
      if (dX) {
        // Through the tanh that produced X.
        for (let k = 0; k < dX.length; k++) dX[k] *= 1 - X[k] * X[k];
      }
      dY = dX;
    }
  }

  params() { const p = []; for (let l = 0; l < this.L; l++) p.push([this.W[l], this.gW[l]], [this.b[l], this.gb[l]]); return p; }

  toJSON() {
    const b64 = f => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
    const j = { sizes: this.sizes, W: this.W.map(b64), b: this.b.map(b64) };
    if (this.gru) { j.gru = { H: this.gru.H }; for (const k of GRU_KEYS) j.gru[k] = b64(this.gru[k]); }
    return j;
  }
  static fromJSON(j) {
    const m = new MLP(j.sizes);
    const f32 = s => { const buf = Buffer.from(s, 'base64'); return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); };
    m.W = j.W.map(f32); m.b = j.b.map(f32);
    if (j.gru) { m.gru = { H: j.gru.H }; for (const k of GRU_KEYS) m.gru[k] = f32(j.gru[k]); }
    return m;
  }
}

class Adam {
  constructor(net, lr = 3e-4, b1 = 0.9, b2 = 0.999, eps = 1e-8) {
    this.net = net; this.lr = lr; this.b1 = b1; this.b2 = b2; this.eps = eps; this.t = 0;
    this.m = net.params().map(([p]) => new Float32Array(p.length));
    this.v = net.params().map(([p]) => new Float32Array(p.length));
  }
  // Clips the global gradient norm, then steps.
  step(scale = 1, maxNorm = 0.5) {
    const ps = this.net.params();
    let sq = 0;
    for (const [, g] of ps) for (let i = 0; i < g.length; i++) sq += (g[i] * scale) ** 2;
    const norm = Math.sqrt(sq);
    const clip = norm > maxNorm ? maxNorm / norm : 1;
    this.t++;
    const c1 = 1 - this.b1 ** this.t, c2 = 1 - this.b2 ** this.t;
    ps.forEach(([p, g], k) => {
      const m = this.m[k], v = this.v[k];
      for (let i = 0; i < p.length; i++) {
        const gi = g[i] * scale * clip;
        m[i] = this.b1 * m[i] + (1 - this.b1) * gi;
        v[i] = this.b2 * v[i] + (1 - this.b2) * gi * gi;
        p[i] -= this.lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + this.eps);
      }
    });
    return norm;
  }
}

// Per-head log-softmax over a logits row. Returns { logp, ent, probs } for the
// chosen actions; probs is filled into `pOut` for the gradient.
function headStats(logits, off, HEADS, act, ai, pOut, lpOut) {
  let logp = 0, ent = 0, o = off;
  for (let h = 0; h < HEADS.length; h++) {
    const n = HEADS[h];
    let mx = -Infinity;
    for (let k = 0; k < n; k++) if (logits[o + k] > mx) mx = logits[o + k];
    let z = 0;
    for (let k = 0; k < n; k++) z += Math.exp(logits[o + k] - mx);
    const lz = Math.log(z);
    for (let k = 0; k < n; k++) {
      const lp = logits[o + k] - mx - lz;
      const p = Math.exp(lp);
      pOut[o - off + k] = p; lpOut[o - off + k] = lp;
      ent -= p * lp;
    }
    logp += logits[o + act[ai + h]] - mx - lz;
    o += n;
  }
  return { logp, ent };
}

/*
 * Gradients for a slice of one minibatch. Loss terms are divided by `m`, the
 * FULL minibatch size, so slices computed on different threads simply add.
 * batch: { obs Float32Array(N*D), acts Int32Array(N*H), logps, adv, ret, D }
 */
function chunkGrads(pi, vf, batch, idx, m, cfg) {
  const { HEADS } = cfg;
  const H = HEADS.length, A = HEADS.reduce((a, b) => a + b, 0), D = batch.D;
  const c = idx.length;
  const X = new Float32Array(c * D), act = new Int32Array(c * H);
  for (let r = 0; r < c; r++) {
    const k = idx[r];
    X.set(batch.obs.subarray(k * D, k * D + D), r * D);
    for (let h = 0; h < H; h++) act[r * H + h] = batch.acts[k * H + h];
  }
  const st = { pl: 0, vl: 0, ent: 0, kl: 0, clip: 0, n: c };
  const pRow = new Float32Array(A), lpRow = new Float32Array(A);
  const logits = pi.forward(X, c);
  const dL = new Float32Array(c * A);
  for (let r = 0; r < c; r++) {
    const k = idx[r];
    const { logp, ent } = headStats(logits, r * A, HEADS, act, r * H, pRow, lpRow);
    const ratio = Math.exp(logp - batch.logps[k]);
    const a = batch.adv[k];
    const s1 = ratio * a, s2 = Math.min(Math.max(ratio, 1 - cfg.clip), 1 + cfg.clip) * a;
    const clipped = s2 < s1;
    st.pl += -Math.min(s1, s2); st.ent += ent; st.kl += batch.logps[k] - logp; st.clip += clipped ? 1 : 0;
    // d(-min)/dlogp = -a*ratio when the unclipped term is the active one.
    const gLogp = clipped ? 0 : -a * ratio;
    let o = 0;
    for (let h = 0; h < H; h++) {
      const n = HEADS[h];
      let Hh = 0;
      for (let q = 0; q < n; q++) Hh -= pRow[o + q] * lpRow[o + q];
      const chosen = act[r * H + h];
      for (let q = 0; q < n; q++) {
        const p = pRow[o + q];
        // -entCoef * dH/dz, with dH/dz_q = -p_q (log p_q + H_h)
        const g = gLogp * ((q === chosen ? 1 : 0) - p) + cfg.entCoef * p * (lpRow[o + q] + Hh);
        dL[r * A + o + q] = g / m;
      }
      o += n;
    }
  }
  pi.zeroGrad(); pi.backward(dL);
  const v = vf.forward(X, c);
  const dV = new Float32Array(c);
  for (let r = 0; r < c; r++) { const e = v[r] - batch.ret[idx[r]]; st.vl += 0.5 * e * e; dV[r] = e / m; }
  vf.zeroGrad(); vf.backward(dV);
  return st;
}

module.exports = { MLP, Adam, chunkGrads, randn, GRU_KEYS };
