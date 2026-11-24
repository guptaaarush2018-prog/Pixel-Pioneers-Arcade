const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../../games/tankfield/core.js');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mk = (seed = 1, shapes = 70) => C.createWorld({ rng: mulberry32(seed), shapes });

test('xpFor curve', () => {
  assert.equal(C.xpFor(29), 7248);
  assert.equal(C.xpFor(44), 15034);
});

test('gainXp reaches the cap and grants 33 points', () => {
  const w = mk(); const t = C.makeTank(w, { name: 'A', color: '#fff', bot: false });
  w.tanks.push(t);
  C.gainXp(w, t, 20000);
  assert.equal(t.level, C.LEVEL_CAP);
  assert.equal(t.level, 45);
  assert.equal(t.points, 33);
  assert.ok(w.events.some(e => e.type === 'turretPick'));
});

test('spend refuses at MAX_STAT and with no points', () => {
  const w = mk(); const t = C.makeTank(w, { name: 'A', color: '#fff', bot: false });
  assert.equal(C.spend(w, t, 0), false);
  t.points = 20;
  for (let i = 0; i < C.MAX_STAT; i++) assert.equal(C.spend(w, t, 0), true);
  assert.equal(C.spend(w, t, 0), false);
  assert.equal(t.points, 20 - C.MAX_STAT);
});

test('same seed and controls give identical worlds', () => {
  const run = () => {
    const w = mk(7);
    const me = C.makeTank(w, { name: 'Me', color: '#4f8cff', bot: false }); w.tanks.push(me);
    for (let i = 0; i < 4; i++) { const b = C.makeTank(w, { name: 'B' + i, color: '#f00', bot: true }); w.tanks.push(b); C.gainXp(w, b, i * 90); }
    for (let i = 0; i < 600; i++) {
      C.step(w, 1 / 60, new Map([[me, { mx: Math.cos(i / 50), my: Math.sin(i / 70), aim: null, fire: i % 7 < 3 }]]));
      w.events.length = 0;
    }
    return JSON.stringify(w.tanks.map(t => [t.x, t.y, t.hp, t.xp]));
  };
  assert.equal(run(), run());
});

test('twin turret: second barrel is pending and only fires as time advances', () => {
  const w = mk(3, 0); const t = C.makeTank(w, { name: 'A', color: '#fff', bot: false }); w.tanks.push(t);
  C.setTurret(w, t, 'twin');
  C.fire(w, t);
  assert.equal(w.shots.length, 1);
  assert.equal(w.pending.length, 1);
  const reload = C.reloadTime(t);
  const dt = 1 / 60, n = Math.ceil(0.5 * reload / dt) + 1;
  for (let i = 0; i < Math.floor(n / 2); i++) C.step(w, dt, new Map(), { spawnShapes: false });
  assert.equal(w.shots.length, 1);
  assert.equal(w.pending.length, 1);
  for (let i = Math.floor(n / 2); i < n; i++) C.step(w, dt, new Map(), { spawnShapes: false });
  assert.equal(w.shots.length, 2);
  assert.equal(w.pending.length, 0);
});

test('kill payout and tankKilled event', () => {
  const w = mk(); const a = C.makeTank(w, { name: 'A', color: '#fff', bot: true }), b = C.makeTank(w, { name: 'B', color: '#000', bot: true });
  w.tanks.push(a, b);
  C.gainXp(w, a, 20000);
  const before = b.xp;
  C.damage(w, a, 1e9, b);
  assert.equal(b.xp - before, Math.round(20000 * 0.5) + 50);
  const ev = w.events.find(e => e.type === 'tankKilled');
  assert.equal(ev.xp, 10050);
  assert.equal(ev.t, a);
  assert.equal(a.alive, false);
});

test('remote tanks take no damage', () => {
  const w = mk(); const t = C.makeTank(w, { name: 'R', color: '#fff', bot: false }); t.remote = true;
  w.tanks.push(t);
  C.damage(w, t, 50, null);
  assert.equal(t.hp, 100);
});

test('step leaves t.a alone for a controlled tank even if aim is set', () => {
  const w = mk(3, 0); const t = C.makeTank(w, { name: 'A', color: '#fff', bot: false }); w.tanks.push(t);
  t.a = 0.7;
  C.step(w, 1 / 60, new Map([[t, { mx: 0, my: 0, aim: 2.5, fire: true }]]), { spawnShapes: false });
  assert.equal(t.a, 0.7);
});

test('a shot hit event carries the shot position, remote targets included', () => {
  const w = mk(3, 0);
  const a = C.makeTank(w, { name: 'A', color: '#fff', bot: false }), b = C.makeTank(w, { name: 'B', color: '#000', bot: false });
  b.remote = true; w.tanks.push(a, b);
  a.x = 500; a.y = 500; b.x = 530; b.y = 500;
  w.shots.push({ x: 520, y: 500, vx: 0, vy: 0, r: 5, dmg: 5, life: 1, owner: a, pierce: 1, color: '#fff' });
  C.step(w, 1 / 60, new Map(), { spawnShapes: false });
  const ev = w.events.find(e => e.type === 'hit');
  assert.ok(ev);
  assert.equal(ev.sx, 520);
  assert.equal(ev.sy, 500);
  assert.equal(b.hp, 100);
});
