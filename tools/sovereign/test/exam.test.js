'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const { examVerdict, updateHof, initialHof, HOF_CAP } = require('../exam.js');

const member = (id, vsLive, vsCand) => ({ id, vsLive, vsCand });

test('a +6 point regression on one hall of fame member fails', () => {
  const v = examVerdict({ hof: [member('kiter', 0.2, 0.2), member('rusher', 0.3, 0.36)], h2h: 0.7 });
  assert.equal(v.pass, false);
  assert.match(v.reasons.join(' '), /rusher/);
});

test('a +5 point change is still a pass', () => {
  assert.equal(examVerdict({ hof: [member('rusher', 0.3, 0.35)], h2h: 0.6 }).pass, true);
});

test('54% head to head against live fails', () => {
  const v = examVerdict({ hof: [member('kiter', 0.2, 0.1)], h2h: 0.54 });
  assert.equal(v.pass, false);
  assert.match(v.reasons.join(' '), /head-to-head/);
});

test('with no live version and no regressions it passes', () => {
  assert.equal(examVerdict({ hof: [member('kiter', null, 0.4)], h2h: null }).pass, true);
});

test('hall of fame starts with every style, adds members over 45% and keeps the strongest 24', () => {
  const hof = initialHof();
  assert.ok(hof.every(m => m.kind === 'style') && hof.some(m => m.ref === 'switcher'));
  const tried = [
    { id: 'snap:iter-50', kind: 'net', ref: 'a.json', winRate: 0.46 },
    { id: 'snap:iter-25', kind: 'net', ref: 'b.json', winRate: 0.45 },
  ];
  const next = updateHof(hof, tried);
  assert.ok(next.some(m => m.id === 'snap:iter-50'));
  assert.ok(!next.some(m => m.id === 'snap:iter-25'));
  const many = Array.from({ length: 40 }, (_, i) => ({ id: 'n' + i, kind: 'net', ref: i + '.json', winRate: 0.5 + i / 100 }));
  const capped = updateHof(next, many);
  assert.equal(capped.length, HOF_CAP);
  assert.ok(capped.some(m => m.id === 'n39') && !capped.some(m => m.id === 'n0'));
});

test('promote refuses a candidate with no passing exam report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-'));
  const cand = path.join(dir, 'latest.json');
  fs.writeFileSync(cand, JSON.stringify({ iter: 1, pi: {}, vf: {}, build: {} }));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'promote.js'), '--game=tankfield', `--cand=${cand}`, `--reports=${dir}`], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /no passing exam/i);
});
