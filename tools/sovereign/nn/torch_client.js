'use strict';
/*
 * tools/sovereign/nn/torch_client.js: train.js's end of the PyTorch sidecar. DEV ONLY.
 *
 * Spawns tools/sovereign/nn/torch_ppo.py under tools/sovereign/.venv and speaks its framed
 * protocol (uint32 LE header length, JSON header, raw float32/int32 buffers).
 * Weights cross as flat float32 in ppo.js's layout: per layer W ([out][in]) then b.
 *
 * Setup once: python3 -m venv tools/sovereign/.venv && tools/sovereign/.venv/bin/pip install torch numpy
 */
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const { GRU_KEYS } = require('./ppo');
const PY = path.join(__dirname, '..', '.venv', 'bin', 'python');

function flatOf(net) {
  // The layers, then the memory block if the net has one (Wi, Wh, bi, bh, M).
  const parts = []; for (let l = 0; l < net.L; l++) parts.push(net.W[l], net.b[l]);
  if (net.gru) for (const k of GRU_KEYS) parts.push(net.gru[k]);
  let n = 0; for (const p of parts) n += p.length;
  const out = new Float32Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function loadFlat(net, f) {
  let o = 0;
  for (let l = 0; l < net.L; l++) {
    net.W[l].set(f.subarray(o, o + net.W[l].length)); o += net.W[l].length;
    net.b[l].set(f.subarray(o, o + net.b[l].length)); o += net.b[l].length;
  }
  if (net.gru) for (const k of GRU_KEYS) { net.gru[k].set(f.subarray(o, o + net.gru[k].length)); o += net.gru[k].length; }
  if (o !== f.length) throw new Error(`torch weights ${f.length} != net params ${o}`);
}

class TorchPPO {
  constructor(log = console.log) {
    if (!fs.existsSync(PY)) throw new Error(`no ${path.relative(process.cwd(), PY)}; run: python3 -m venv tools/sovereign/.venv && tools/sovereign/.venv/bin/pip install torch numpy`);
    this.proc = spawn(PY, [path.join(__dirname, 'torch_ppo.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', d => String(d).trimEnd().split('\n').forEach(l => log(l)));
    this.buf = Buffer.alloc(0); this.waiting = null; this.dead = null;
    this.proc.stdout.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._drain(); });
    this.proc.on('exit', (code, sig) => {
      this.dead = new Error(`torch sidecar exited ${code}${sig ? ' (' + sig + ')' : ''}`);
      if (this.waiting) { const w = this.waiting; this.waiting = null; w.reject(this.dead); }
    });
  }
  _drain() {
    if (!this.waiting || this.buf.length < 4) return;
    const hl = this.buf.readUInt32LE(0);
    if (this.buf.length < 4 + hl) return;
    const head = JSON.parse(this.buf.subarray(4, 4 + hl).toString('utf8'));
    let need = 4 + hl; for (const [, , n] of head.bufs || []) need += n * 4;
    if (this.buf.length < need) return;
    const bufs = {}; let o = 4 + hl;
    for (const [name, dt, n] of head.bufs || []) {
      const ab = this.buf.buffer.slice(this.buf.byteOffset + o, this.buf.byteOffset + o + n * 4);
      bufs[name] = dt === 'i32' ? new Int32Array(ab) : new Float32Array(ab); o += n * 4;
    }
    this.buf = this.buf.subarray(need);
    const w = this.waiting; this.waiting = null;
    if (head.error) w.reject(new Error(head.error)); else w.resolve({ head, bufs });
  }
  // bufs: [[name, Float32Array|Int32Array], ...]
  call(head, bufs = []) {
    if (this.dead) return Promise.reject(this.dead);
    if (this.waiting) return Promise.reject(new Error('torch sidecar busy'));
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      head = Object.assign({}, head, { bufs: bufs.map(([n, a]) => [n, a instanceof Int32Array ? 'i32' : 'f32', a.length]) });
      const h = Buffer.from(JSON.stringify(head), 'utf8'), len = Buffer.alloc(4); len.writeUInt32LE(h.length, 0);
      this.proc.stdin.write(len); this.proc.stdin.write(h);
      for (const [, a] of bufs) this.proc.stdin.write(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
      this._drain();
    });
  }
  // ref: optional frozen policy (same sizes as pi) the update is pulled toward by cfg.refKl.
  async init(pi, vf, cfg, threads, seed, ref) {
    const bufs = [['pi', flatOf(pi)], ['vf', flatOf(vf)]];
    if (ref) bufs.push(['ref', flatOf(ref)]);
    const { head } = await this.call({ type: 'init', piSizes: pi.sizes, vfSizes: vf.sizes, gru: pi.gru ? pi.gru.H : 0,
      refGru: ref && ref.gru ? ref.gru.H : 0, cfg, threads, seed }, bufs);
    return head;
  }
  // Runs values + GAE + the PPO epochs on the sidecar, then copies the new
  // weights into pi/vf. episodes: [{start, len, trunc, finalObs (Float32Array)}].
  // extra: optional { lr, targetKl } for this update only onward.
  async update(pi, vf, b, seed, extra = {}) {
    const fin = b.episodes.filter(e => e.trunc && e.finalObs);
    const finalObs = new Float32Array(fin.length * b.D); fin.forEach((e, i) => finalObs.set(e.finalObs, i * b.D));
    const { head, bufs } = await this.call(
      { type: 'update', ...extra, N: b.N, D: b.D, H: b.H, seed, episodes: b.episodes.map(e => [e.start, e.len, e.trunc && e.finalObs ? 1 : 0]) },
      [['obs', b.obs], ['acts', b.acts], ['logps', b.logps], ['rews', b.rews], ['finalObs', finalObs]]);
    loadFlat(pi, bufs.pi); loadFlat(vf, bufs.vf);
    return head.upd;
  }
  close() { try { this.proc.stdin.end(); } catch (e) {} }
}

module.exports = { TorchPPO, flatOf, loadFlat };
