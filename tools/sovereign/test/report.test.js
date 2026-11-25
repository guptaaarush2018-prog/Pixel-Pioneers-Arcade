'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { switchCurve, BINS } = require('../report.js');

test('the switch curve puts a dip at +3 s in the +0 to +5 s bin', () => {
  // Per-second exchange over 200 s with switches at 40, 100 and 160 s; a dip 3 s after each.
  const switches = [40, 100, 160];
  const perSecond = Array.from({ length: 200 }, (_, t) => (switches.some(s => t - s === 3) ? -5 : 1));
  const curve = switchCurve([{ perSecond, switches }]);
  assert.equal(curve.length, BINS.length);
  let min = 0; curve.forEach((c, i) => { if (c.mean < curve[min].mean) min = i; });
  assert.equal(curve[min].from, 0);
  assert.equal(curve[min].to, 5);
});

test('bins outside the match are left out of the mean', () => {
  const curve = switchCurve([{ perSecond: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], switches: [2] }]);
  assert.equal(curve[0].n, 0);
  assert.equal(curve[0].mean, null);
});
