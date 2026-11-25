'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const LAB = path.join(__dirname, '..');
const hasVenv = fs.existsSync(path.join(LAB, '.venv', 'bin', 'python'));

test('train.js runs two tiny iterations and writes a checkpoint and log', { skip: !hasVenv && 'no tools/sovereign/.venv', timeout: 240000 }, () => {
  const run = `smoke-${process.pid}`, dir = path.join(LAB, 'runs', run);
  try {
    const r = spawnSync(process.execPath, [path.join(LAB, 'train.js'), '--game=tankfield', `--run=${run}`, '--iters=2', '--workers=1', '--steps=2000'],
      { encoding: 'utf8', timeout: 230000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const latest = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
    assert.equal(latest.iter, 2);
    assert.ok(latest.pi && latest.vf && latest.cfg && typeof latest.lr === 'number' && Array.isArray(latest.hof));
    const lines = fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    const l = JSON.parse(lines[1]);
    assert.equal(l.iter, 2);
    assert.ok(l.winRate && typeof l.meanReward === 'number' && typeof l.kl === 'number' && typeof l.lr === 'number');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
