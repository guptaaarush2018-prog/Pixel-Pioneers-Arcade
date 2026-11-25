'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const CIO = require('../tankfield/clone-io.js');
const { trainClone, kmeans } = require('../clone.js');
const { pull } = require('../pull.js');
const { runEpisode, mulberry32 } = require('../tankfield/env.js');
const S = require('../../../assets/js/sovereign.js');

// Synthetic recorded rows: the player always drives toward Sovereign horizontally (mx = sign(dx)).
function synthRows(n, seed) {
  const r = mulberry32(seed), rows = [];
  for (let i = 0; i < n; i++) {
    const me = [Math.round(r() * 3000), Math.round(r() * 2000), Math.round((r() - 0.5) * 400), Math.round((r() - 0.5) * 400), Math.round(r() * 600), 500];
    const sov = [Math.round(r() * 3000), Math.round(r() * 2000), 0, 0, 0, 480];
    const dx = sov[0] - me[0];
    rows.push([...me, ...sov, Math.sign(dx), 0, r() < 0.5 ? 1 : 0, 0, 0, 0]);
  }
  return rows;
}

test('a clone learns mx = sign(dx) to at least 95% accuracy', () => {
  const rows = synthRows(4000, 1).filter(row => row[12] !== 0);
  const { net } = trainClone([rows], { epochs: 30, seed: 3 });
  const held = synthRows(1000, 99).filter(row => row[12] !== 0);
  let ok = 0;
  for (const row of held) { const p = CIO.predict(S.loadNet(net.toJSON()), CIO.rowFeatures(row), null); if (p.mx === row[12]) ok++; }
  assert.ok(ok / held.length >= 0.95, `accuracy ${ok / held.length}`);
});

test('k-means separates two obvious groups', () => {
  const pts = [[1, 0], [0.9, 0.1], [1, 0.05], [0, 1], [0.1, 0.9], [0.05, 1]];
  const { assign } = kmeans(pts, 2, 7);
  assert.equal(new Set(assign.slice(0, 3)).size, 1);
  assert.equal(new Set(assign.slice(3)).size, 1);
  assert.notEqual(assign[0], assign[3]);
});

test('a clone opponent plays a whole episode in the env', () => {
  const IO = require('../../../games/tankfield/sovereign-io.js');
  const { net } = trainClone([synthRows(500, 2)], { epochs: 2, seed: 1 });
  const r0 = mulberry32(5), arr = n => Array.from({ length: n }, () => (r0() - 0.5) * 0.2);
  const pi = S.loadNet({ sizes: [IO.OBS_DIM, 8, 20], W: [arr(IO.OBS_DIM * 8), arr(8 * 20)], b: [arr(8), arr(20)] });
  const r = runEpisode({ seed: 3, sovNet: pi, opponent: { kind: 'clone', net: S.loadNet(net.toJSON()) }, maxT: 10 });
  assert.ok(r.len > 0 && ['win', 'loss', 'timeout'].includes(r.outcome));
});

test('pull with an empty trainrec writes nothing and reports 0 records', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovpull-')), out = path.join(dir, 'tankfield.jsonl');
  const removed = [], logs = [];
  const db = { get: async () => null, remove: async keys => { removed.push(...keys); } };
  const n = await pull({ db, game: 'tankfield', outFile: out, log: m => logs.push(m) });
  assert.equal(n, 0);
  assert.equal(removed.length, 0);
  assert.ok(!fs.existsSync(out) || fs.readFileSync(out, 'utf8') === '');
  assert.match(logs.join('\n'), /0 records/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pull appends records then deletes exactly the downloaded keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovpull-')), out = path.join(dir, 'tankfield.jsonl');
  const order = [];
  const db = {
    get: async () => ({ a1: { g: 'tankfield', frames: '1,2' }, b2: { g: 'tankfield', frames: '3' } }),
    remove: async keys => { order.push(['remove', [...keys].sort(), fs.readFileSync(out, 'utf8').trim().split('\n').length]); },
  };
  const n = await pull({ db, game: 'tankfield', outFile: out, log: () => {} });
  assert.equal(n, 2);
  assert.deepEqual(order, [['remove', ['a1', 'b2'], 2]], 'deleted after both lines were written');
  const lines = fs.readFileSync(out, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(l => l.key).sort(), ['a1', 'b2']);
  fs.rmSync(dir, { recursive: true, force: true });
});
