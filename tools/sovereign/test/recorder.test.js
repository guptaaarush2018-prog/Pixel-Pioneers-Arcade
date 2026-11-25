'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../../assets/js/sovereign.js');

test('encodeRows / decodeRows round-trip, negatives included', () => {
  const rows = [[0, 5, -3, 120, -45, 99], [12, -7, -3, 0, 4000, 99], [-1, -1, -1, -1, -1, -1]];
  assert.deepEqual(S.decodeRows(S.encodeRows(rows)), rows);
  assert.deepEqual(S.decodeRows(S.encodeRows([])), []);
});

// 3,000 rows (5 minutes at 10 Hz) x 18 columns of tank-like values.
function realisticRows(n) {
  const rows = [];
  let ax = 1500, ay = 1000, bx = 2200, by = 900;
  for (let i = 0; i < n; i++) {
    ax += Math.round(Math.sin(i / 9) * 30); ay += Math.round(Math.cos(i / 7) * 25);
    bx += Math.round(Math.sin(i / 5) * 35); by += Math.round(Math.cos(i / 11) * 20);
    rows.push([ax, ay, Math.round(Math.sin(i / 9) * 300), Math.round(Math.cos(i / 7) * 250), Math.round((i / 10 % 6.28) * 100), 900 - (i % 40),
      bx, by, Math.round(Math.sin(i / 5) * 350), Math.round(Math.cos(i / 11) * 200), Math.round(-(i / 13 % 6.28) * 100), 1200 - (i % 60),
      (i % 3) - 1, ((i >> 2) % 3) - 1, i % 2, i % 9, (i * 7) % 9, (i >> 1) % 2].map(v => v + 0));   // + 0 turns -0 into 0
  }
  return rows;
}

test('a long fight stays under 60000 characters, or truncates and says so', () => {
  const rec = new S.Recorder({ game: 'tankfield', version: 1, hz: 10 });
  for (const r of realisticRows(3000)) rec.row(r);
  const record = rec.finish('win', { pb: { path: 1, alloc: [] }, sb: { path: 2, alloc: [] }, dur: 300 });
  assert.ok(record.frames.length < 60000, `${record.frames.length}`);
  if (record.frames.length >= 59000 - 200) assert.equal(record.trunc, true);
  const back = S.decodeRows(record.frames);
  assert.deepEqual(back, realisticRows(back.length));
});

test('rows stop once the encoding would pass 59000 characters, with trunc set', () => {
  const rec = new S.Recorder({ game: 'tankfield', version: 1, hz: 10 });
  const big = n => Array.from({ length: 18 }, (_, k) => (n * 7919 + k * 104729) % 2000000 - 1000000);
  for (let i = 0; i < 20000; i++) rec.row(big(i));
  const record = rec.finish('loss', {});
  assert.equal(record.trunc, true);
  assert.ok(record.frames.length <= 59000);
});

test('the record carries no uid or name, and has the fields the rules need', () => {
  const rec = new S.Recorder({ game: 'tankfield', version: 3, hz: 10 });
  rec.row([1, 2, 3]);
  const r = rec.finish('other', { pb: {}, sb: {}, dur: 5 });
  for (const k of ['uid', 'name', 'email']) assert.ok(!(k in r), k);
  for (const k of ['g', 'v', 'out', 'tag', 'frames', 't']) assert.ok(k in r, k);
  assert.equal(r.g, 'tankfield'); assert.equal(r.v, 3); assert.equal(r.out, 'other');
  assert.ok(typeof r.tag === 'string' && r.tag.length <= 16);
  assert.equal(rec.finish('win', {}), null, 'a second finish returns null');
});

test('upload resolves even when Online.post rejects', async () => {
  globalThis.Online = { enabled: true, TIMESTAMP: { '.sv': 'timestamp' }, post: () => Promise.reject(new Error('offline')) };
  try {
    const rec = new S.Recorder({ game: 'tankfield', version: 1, hz: 10 });
    rec.row([1]);
    await rec.upload(rec.finish('win', {}));
    globalThis.Online.post = () => { throw new Error('sync throw'); };
    await rec.upload({ g: 'tankfield' });
    await rec.upload(null);
  } finally { delete globalThis.Online; }
});

// In the page, arcade.js and online.js declare `const Arcade` / `const Online`: script-scope
// globals that are NOT properties of window. sovereign.js must still find them.
test('in a page, the recorder finds const Arcade and Online (not window properties)', async () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const ctx = vm.createContext({ console, Math, Date, JSON, Promise, setTimeout });
  ctx.window = ctx;
  vm.runInContext(`const store = {}; const posted = [];
    const Arcade = { load: (k, d) => k in store ? store[k] : d, save: (k, v) => { store[k] = v; } };
    const Online = { enabled: true, TIMESTAMP: { '.sv': 'timestamp' }, post: async (p, r) => { posted.push([p, r]); } };`, ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../assets/js/sovereign.js'), 'utf8'), ctx);
  const out = await vm.runInContext(`(async () => {
    const rec = new Sovereign.Recorder({ game: 'tankfield', version: 2, hz: 10 });
    rec.row([1, 2]);
    const r = rec.finish('win', {});
    await rec.upload(r);
    return { tag: store['sovereign:tag'], again: Sovereign.sessionTag(), posted: posted.length, path: posted[0] && posted[0][0], t: r.t };
  })()`, ctx);
  assert.equal(typeof out.tag, 'string');
  assert.equal(out.tag.length, 12);
  assert.equal(out.again, out.tag, 'the tag persists');
  assert.equal(out.posted, 1);
  assert.equal(out.path, 'trainrec/tankfield');
  assert.deepEqual({ ...out.t }, { '.sv': 'timestamp' });
});
