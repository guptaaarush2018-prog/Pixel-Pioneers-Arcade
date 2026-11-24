'use strict';
// Sovereign: the shared neural-net runner. The browser games and the Node training lab
// (tools/sovereign/) both run policies through this file, so a net trained in the lab plays
// identically in the page. Ported from Stickman-Battles js/smb-brain.js; `heads` is a
// parameter of sample() because each game has its own action layout.
(function (root) {
  function _b64ToF32(s) {
    const bin = atob(s), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Float32Array(u8.buffer);
  }
  function f32ToB64(f) {
    const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const toF32 = x => typeof x === 'string' ? _b64ToF32(x) : Float32Array.from(x);

  // weights: { sizes:[in,h1,...,out], W:[b64|array...], b:[...], gru?:{H,Wi,Wh,bi,bh,M} }.
  // W is row-major [out][in].
  function loadNet(weights) {
    if (!weights || !weights.sizes || !weights.W || !weights.b) return null;
    const W = weights.W.map(toF32), b = weights.b.map(toF32);
    const bufs = weights.sizes.map(n => new Float32Array(n));
    const net = { sizes: weights.sizes, W, b, bufs, gru: null };
    // Optional memory: a GRU fed by the first hidden layer, added into the second.
    // torch.nn.GRU's layout: gates r, z, n stacked.
    const g = weights.gru;
    if (g && g.H && weights.sizes.length >= 4) {
      net.gru = { H: g.H, Wi: toF32(g.Wi), Wh: toF32(g.Wh), bi: toF32(g.bi), bh: toF32(g.bh), M: toF32(g.M), tmp: new Float32Array(g.H) };
    }
    return net;
  }
  // The memory carried through one episode: zeros at the start.
  function newState(net) { return net && net.gru ? new Float32Array(net.gru.H) : null; }

  function _gruStep(g, x, nIn, h) {
    const H = g.H, Wi = g.Wi, Wh = g.Wh, bi = g.bi, bh = g.bh, out = g.tmp;
    for (let j = 0; j < H; j++) {
      let ri = bi[j], zi = bi[H + j], ni = bi[2 * H + j];
      const a = j * nIn, bz = (H + j) * nIn, c = (2 * H + j) * nIn;
      for (let i = 0; i < nIn; i++) { const v = x[i]; ri += Wi[a + i] * v; zi += Wi[bz + i] * v; ni += Wi[c + i] * v; }
      let rh = bh[j], zh = bh[H + j], nh = bh[2 * H + j];
      const d = j * H, e = (H + j) * H, f = (2 * H + j) * H;
      for (let i = 0; i < H; i++) { const v = h[i]; rh += Wh[d + i] * v; zh += Wh[e + i] * v; nh += Wh[f + i] * v; }
      const r = 1 / (1 + Math.exp(-(ri + rh))), z = 1 / (1 + Math.exp(-(zi + zh)));
      out[j] = (1 - z) * Math.tanh(ni + r * nh) + z * h[j];
    }
    h.set(out);
  }

  // h: this agent's memory (newState), advanced one decision. A net with no GRU ignores it.
  // The returned logits array is a reused buffer, valid until the next forward on this net.
  function forward(net, x, h) {
    const S = net.sizes, L = S.length - 1, g = net.gru;
    if (g && !h) h = new Float32Array(g.H);
    let inp = x;
    for (let l = 0; l < L; l++) {
      const nIn = S[l], nOut = S[l + 1], W = net.W[l], b = net.b[l], out = net.bufs[l + 1];
      const mem = g && l === 1, H = mem ? g.H : 0, M = mem ? g.M : null;
      for (let o = 0; o < nOut; o++) {
        let s = b[o]; const row = o * nIn;
        for (let i = 0; i < nIn; i++) s += W[row + i] * inp[i];
        if (mem) { const mr = o * H; for (let i = 0; i < H; i++) s += M[mr + i] * h[i]; }
        out[o] = l < L - 1 ? Math.tanh(s) : s;
      }
      if (g && l === 0) _gruStep(g, out, nOut, h);
      inp = out;
    }
    return inp;
  }

  // Samples one option per head (heads = [n0, n1, ...]) into act. Returns the joint log-probability.
  function sample(logits, heads, act, greedy) {
    let off = 0, logp = 0;
    for (let h = 0; h < heads.length; h++) {
      const n = heads[h];
      let mx = -Infinity;
      for (let k = 0; k < n; k++) if (logits[off + k] > mx) mx = logits[off + k];
      let z = 0;
      for (let k = 0; k < n; k++) z += Math.exp(logits[off + k] - mx);
      let pick = 0;
      if (greedy) {
        for (let k = 1; k < n; k++) if (logits[off + k] > logits[off + pick]) pick = k;
      } else {
        let r = Math.random() * z;
        for (pick = 0; pick < n - 1; pick++) { r -= Math.exp(logits[off + pick] - mx); if (r <= 0) break; }
      }
      act[h] = pick;
      logp += logits[off + pick] - mx - Math.log(z);
      off += n;
    }
    return logp;
  }

  // Fetches the shipped weights for a game. A game page lives at /games/<game>/ (or
  // /games/<game>), so '../<game>/sovereign/latest.json' resolves to
  // /games/<game>/sovereign/latest.json either way. Never throws: null on any failure
  // (network, bad JSON, missing pi). Returns { v, pi, build }.
  async function loadWeights(game) {
    try {
      if (typeof fetch !== 'function') return null;
      const res = await fetch('../' + encodeURIComponent(game) + '/sovereign/latest.json', { cache: 'no-cache' });
      if (!res || !res.ok) return null;
      const j = await res.json();
      if (!j || !j.pi || !j.pi.sizes) return null;
      return { v: j.v, pi: j.pi, build: j.build };
    } catch (e) { return null; }
  }

  // A random 12-char id for this browser, persisted via Arcade (browser only).
  function sessionTag() {
    const A = root.Arcade;
    let tag = null;
    try { tag = A && A.load ? A.load('sovereign:tag', null) : null; } catch (e) {}
    if (typeof tag === 'string' && tag.length === 12) return tag;
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    tag = '';
    for (let i = 0; i < 12; i++) tag += chars[Math.floor(Math.random() * chars.length)];
    try { if (A && A.save) A.save('sovereign:tag', tag); } catch (e) {}
    return tag;
  }

  const api = { loadNet, newState, forward, sample, loadWeights, sessionTag, f32ToB64, b64ToF32: _b64ToF32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sovereign = api;
})(typeof window !== 'undefined' ? window : globalThis);
