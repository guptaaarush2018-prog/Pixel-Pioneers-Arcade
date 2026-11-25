'use strict';
/*
 * tools/sovereign/clone.js: behaviour clones of real players, as training opponents. DEV ONLY.
 *
 *   node tools/sovereign/clone.js --game=tankfield [--min=200] [--epochs=20]
 *
 * Reads tools/sovereign/data/tankfield.jsonl (pull.js), groups the fights by session tag,
 * clusters the tags into up to 8 play styles (k-means over each tag's mix of move and trigger
 * inputs), and trains one small classifier per cluster: the player's view of the fight
 * (tankfield/clone-io.js) to the player's mx, my and fire. Writes clones/tankfield/clone-<k>.json,
 * which train.js --clones=tools/sovereign/clones/tankfield puts into the opponent mix.
 */
const fs = require('fs'), path = require('path');
const { MLP, Adam } = require('./nn/ppo.js');
const CIO = require('./tankfield/clone-io.js');
const { mulberry32 } = require('./tankfield/env.js');
const Sov = require('../../assets/js/sovereign.js');

const NOUT = CIO.HEADS.reduce((a, b) => a + b, 0);

// records: arrays of decoded rows. Softmax cross-entropy on each head, Adam, minibatches of 256.
function trainClone(records, { epochs = 20, seed = 1, hidden = 64, lr = 3e-3, mb = 256 } = {}) {
  const rows = records.flat();
  const n = rows.length, X = new Float32Array(n * CIO.CLONE_IN), Y = new Int32Array(n * 3);
  rows.forEach((r, i) => { X.set(CIO.rowFeatures(r), i * CIO.CLONE_IN); Y.set(CIO.rowTargets(r), i * 3); });
  const net = new MLP([CIO.CLONE_IN, hidden, NOUT], 0.01), adam = new Adam(net, lr), rng = mulberry32(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (let a = 0; a < n; a += mb) {
      const b = idx.slice(a, a + mb), m = b.length, xb = new Float32Array(m * CIO.CLONE_IN);
      b.forEach((k, r) => xb.set(X.subarray(k * CIO.CLONE_IN, (k + 1) * CIO.CLONE_IN), r * CIO.CLONE_IN));
      const out = net.forward(xb, m), d = new Float32Array(m * NOUT);
      b.forEach((k, r) => {
        let off = 0;
        CIO.HEADS.forEach((h, hi) => {
          let mx = -Infinity; for (let c = 0; c < h; c++) mx = Math.max(mx, out[r * NOUT + off + c]);
          let z = 0; for (let c = 0; c < h; c++) z += Math.exp(out[r * NOUT + off + c] - mx);
          for (let c = 0; c < h; c++) d[r * NOUT + off + c] = (Math.exp(out[r * NOUT + off + c] - mx) / z - (c === Y[k * 3 + hi] ? 1 : 0)) / m;
          off += h;
        });
      });
      net.zeroGrad(); net.backward(d); adam.step(1, 1);
    }
  }
  // Accuracy of the most likely choice on the training rows, per head.
  const view = Sov.loadNet(net.toJSON()), acc = [0, 0, 0];
  rows.forEach(r => { const p = CIO.predict(view, CIO.rowFeatures(r), null), t = CIO.rowTargets(r); if (p.mx + 1 === t[0]) acc[0]++; if (p.my + 1 === t[1]) acc[1]++; if (+p.fire === t[2]) acc[2]++; });
  return { net, acc: acc.map(a => a / Math.max(1, n)) };
}

// Plain k-means with k-means++ seeding. points: arrays of equal length.
function kmeans(points, k, seed = 1, iters = 50) {
  const rng = mulberry32(seed), d2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  k = Math.min(k, points.length);
  const centers = [points[Math.floor(rng() * points.length)].slice()];
  while (centers.length < k) {
    const ds = points.map(p => Math.min(...centers.map(c => d2(p, c)))), tot = ds.reduce((a, b) => a + b, 0);
    let r = rng() * tot, pick = 0;
    for (; pick < points.length - 1; pick++) { r -= ds[pick]; if (r <= 0) break; }
    centers.push(points[pick].slice());
  }
  let assign = new Array(points.length).fill(0);
  for (let it = 0; it < iters; it++) {
    const next = points.map(p => { let b = 0; centers.forEach((c, i) => { if (d2(p, c) < d2(p, centers[b])) b = i; }); return b; });
    const moved = next.some((a, i) => a !== assign[i]); assign = next;
    centers.forEach((c, ci) => {
      const mine = points.filter((_, i) => assign[i] === ci);
      if (mine.length) for (let j = 0; j < c.length; j++) c[j] = mine.reduce((s, p) => s + p[j], 0) / mine.length;
    });
    if (!moved && it) break;
  }
  return { assign, centers };
}

// Each tag's mix of the 18 (mx, my, fire) input combinations.
function actionHistogram(rows) {
  const h = new Array(18).fill(0);
  for (const r of rows) { const [a, b, c] = CIO.rowTargets(r); h[a * 6 + b * 2 + c]++; }
  const n = rows.length || 1;
  return h.map(v => v / n);
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }));
  const game = args.game || 'tankfield', MIN = parseInt(args.min, 10) || 200, epochs = parseInt(args.epochs, 10) || 20;
  if (game !== 'tankfield') { console.error('[clone] only --game=tankfield exists so far'); process.exit(1); }
  const file = path.join(__dirname, 'data', `${game}.jsonl`);
  const recs = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.g === game && r.frames) : [];
  if (recs.length < MIN) { console.error(`[clone] ${recs.length} records; need at least ${MIN} (--min)`); process.exit(1); }
  const byTag = new Map();
  for (const r of recs) { const rows = Sov.decodeRows(r.frames).filter(x => x.length >= 15); if (!byTag.has(r.tag)) byTag.set(r.tag, []); byTag.get(r.tag).push(rows); }
  const tags = [...byTag.keys()];
  const { assign } = kmeans(tags.map(t => actionHistogram(byTag.get(t).flat())), 8, 1);
  const out = path.join(__dirname, 'clones', game);
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (/^clone-\d+\.json$/.test(f)) fs.unlinkSync(path.join(out, f));
  const groups = [...new Set(assign)].sort((a, b) => a - b);
  groups.forEach((g, k) => {
    const mine = tags.filter((_, i) => assign[i] === g), records = mine.flatMap(t => byTag.get(t));
    const { net, acc } = trainClone(records, { epochs, seed: k + 1 });
    fs.writeFileSync(path.join(out, `clone-${k}.json`), JSON.stringify({ ...net.toJSON(), meta: { tags: mine.length, records: records.length, rows: records.flat().length, acc } }));
    console.log(`[clone] clone-${k}: ${mine.length} players, ${records.length} fights, accuracy mx ${acc[0].toFixed(2)} my ${acc[1].toFixed(2)} fire ${acc[2].toFixed(2)}`);
  });
}

if (require.main === module) main();
module.exports = { trainClone, kmeans, actionHistogram };
