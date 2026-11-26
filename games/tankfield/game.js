/* Tankfield: a top-down tank arena. Shoot the drifting shapes for experience, level up, put
   points into your tank's stats (keys 1-7), and pick a new turret at levels 10 and 20. Rival
   tanks are doing the same, and they'll come for you once they're strong enough. One life; the
   score is all the experience you earned. Auto-aim is on by default (Q switches to the mouse).
   Live 1v1 (live.js) drops the bots: two players share one arena of shapes, first to
   LIVE_KILLS kills (or the most when the clock runs out).
   Solo runs that reach 20,000 xp meet Sovereign, a level 45 boss tank driven by a neural net
   trained in tools/sovereign/ (weights in sovereign/latest.json). He plays by the same rules and
   inputs as you; if the weights fail to load, a rule bot stands in and grants no flags. */
(() => {
  const ID = 'tankfield';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const RIVALS = 14, SHAPES = 170;
  const LIVE_KILLS = 3, LIVE_TIME = 300;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const R = Gfx.rand;
  const fx = Gfx.particles(700), floats = Gfx.floaters(), shake = Gfx.shaker();

  const C = TankCore;
  const { AW, AH, MID_W, MID_H, STATS, MAX_STAT, TURRETS, SHAPE_KINDS, xpFor, radius, shotSpeed, shotRange, maxHp } = C;
  const T = t => TURRETS[t.turret];
  // All the rules live in core.js; this file draws, listens and keeps score.
  const newWorld = shapes => C.createWorld({ rng: () => Math.random(), shapes });
  let world = newWorld(SHAPES);
  const controls = new Map();

  let me = null, state = 'menu', cam = { x: AW / 2, y: AH / 2, z: 0.8 }, time = 0, aimMode = Arcade.load('tank:aim', 'auto');
  let mouse = { x: W / 2, y: H / 2, down: false }, kills = 0, picking = null;
  const spend = (t, i) => C.spend(world, t, i);

  // ---------- Sovereign ----------
  const BOSS_XP = 20000, BOSS_DIST = 1300;
  const IO = TankSovIO, Sov = Sovereign;
  // The assassin kit: a Railgun with shot speed, power, reload and engine all maxed (28 of his 33
  // points) and the last 5 in armor. His shots cross the whole screen, so the camera pulls back
  // while he's alive and an arrow at the edge points to him.
  const ASSASSIN_BUILD = IO.KITS.assassin;
  // undefined: not asked yet; null: failed (fallback boss); else { v, pi, build }.
  let bossWeights, bossWeightsP = null, boss = null, bannerT = 0, banner = null;
  const showBanner = (text, sub) => { banner = { text, sub }; bannerT = 4; };
  const prefetchBoss = () => { bossWeightsP = bossWeightsP || Sov.loadWeights(ID).then(w => { bossWeights = w; }); };
  const soloRun = () => !netMode && !(typeof Versus !== 'undefined' && Versus.active());

  // What drives Sovereign's tank: the net when the weights loaded, else a rule bot (no flags).
  function bossBrain(t) {
    const w = bossWeights, net = w ? Sov.loadNet(w.pi) : null;
    if (!net) t.ai = { mode: 'farm', target: null, thinkT: 0, wander: 0, aimErr: 0, courage: 2 };
    return { net, state: net ? Sov.newState(net) : null, act: new Int32Array(IO.HEADS.length), prev: new Int32Array(IO.HEADS.length),
      obs: new Float32Array(IO.OBS_DIM), c: { mx: 0, my: 0, aim: t.a, fire: false }, decisionT: 0, version: w ? w.v : null, fallback: !net };
  }

  function spawnBoss() {
    const w = bossWeights;
    const t = C.makeTank(world, { name: 'Sovereign', color: '#ffd23f', bot: false });
    const a = R(0, TAU), r = 40;
    t.x = clamp(me.x + Math.cos(a) * BOSS_DIST, r, AW - r);
    t.y = clamp(me.y + Math.sin(a) * BOSS_DIST, r, AH - r);
    t.a = Math.atan2(me.y - t.y, me.x - t.x);
    const build = ASSASSIN_BUILD;
    IO.applyBuild(world, t, build);
    world.tanks.push(t);
    const brain = bossBrain(t), fallback = brain.fallback;
    boss = { tank: t, ...brain, outcome: null, build,
      // The fight is recorded for training (net boss only): both tanks at 10 Hz, your inputs and his choices.
      recorder: fallback ? null : new Sov.Recorder({ game: ID, version: w.v, hz: 10 }), recT: 0, startT: time,
      playerBuild: { turret: me.turret, stats: { ...me.stats } } };
    showBanner('SOVEREIGN HAS ENTERED', 'Matches against Sovereign help train him.');
    shake.add(0.8);
    Arcade.tone({ freq: 110, to: 55, dur: 0.9, type: 'sawtooth', vol: 0.07 });
    Arcade.tone({ freq: 523, to: 1046, dur: 0.4, type: 'triangle', vol: 0.05 });
  }

  // Sovereign's controls this frame. The net decides every REPEAT sim frames (as in training)
  // and holds its move, aim and trigger in between; the turret turns like the player's auto-aim.
  function bossControl(dt, opp = me) {
    const t = boss.tank;
    if (boss.fallback) {
      const rivals = new Set(world.tanks.filter(o => o !== opp && o !== t));
      const b = C.botControl(world, t, dt, { ignore: rivals });
      return { mx: b.mx, my: b.my, aim: null, fire: false };
    }
    boss.decisionT -= dt;
    if (boss.decisionT <= 0) {
      boss.decisionT += IO.REPEAT / 60;
      if (boss.decisionT <= 0) boss.decisionT = IO.REPEAT / 60;
      IO.observe(world, t, opp, boss.prev, boss.obs);
      Sov.sample(Sov.forward(boss.net, boss.obs, boss.state), IO.HEADS, boss.act, true);
      boss.prev.set(boss.act);
      boss.c = IO.applyAction(world, t, opp, boss.act, dt);
    }
    t.a += angDiff(boss.c.aim, t.a) * Math.min(1, dt * 12);
    return boss.c;
  }

  const tankRow = t => [Math.round(t.x), Math.round(t.y), Math.round(t.vx), Math.round(t.vy), Math.round(t.a * 100), Math.round(Math.max(0, t.hp))];
  function recordBoss(dt) {
    if (!boss.recorder) return;
    boss.recT -= dt;
    if (boss.recT > 0) return;
    boss.recT += 1 / boss.recorder.hz;
    const c = controls.get(me) || { mx: 0, my: 0, fire: false };
    boss.recorder.row([...tankRow(me), ...tankRow(boss.tank), Math.round(c.mx || 0), Math.round(c.my || 0), c.fire ? 1 : 0, ...boss.act]);
  }
  // Ends the recording once, with the outcome from your side ('win' | 'loss' | 'other'), and sends it.
  function finishBoss(outcome) {
    if (!boss || !boss.recorder) return;
    const rec = boss.recorder.finish(outcome, { pb: boss.playerBuild, sb: boss.build, dur: Math.round(time - boss.startT) });
    if (rec) boss.recorder.upload(rec);
  }
  addEventListener('pagehide', () => { if (boss && !boss.outcome) finishBoss('other'); });

  const NAMES = ['Rumble', 'Ironsides', 'Boomer', 'Tread', 'Clank', 'Bolt', 'Rivet', 'Howitzer', 'Pounder', 'Sprocket',
    'Mortar', 'Brick', 'Gauge', 'Piston', 'Torque', 'Ratchet', 'Anvil', 'Flint', 'Grinder', 'Turbo', 'Bastion', 'Cinder'];
  const COLORS = ['#ff5a5f', '#ffb02e', '#3ccf8e', '#ff7ae0', '#b07cff', '#2ee6c9', '#ff8a3d', '#9be37a', '#e05aff', '#5ad1ff', '#ffd23f', '#ff6fa3', '#7ee0b5', '#c99bff'];

  // ---------- Flow ----------

  function start() {
    leavePub();
    netMode = null; rival = null;
    world = newWorld(SHAPES);
    fx.clear();
    me = C.makeTank(world, { name: 'You', color: '#4f8cff', bot: false });
    world.tanks.push(me);
    me.x = AW / 2 + R(-300, 300); me.y = AH / 2 + R(-200, 200);
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < RIVALS; i++) {
      const b = C.makeTank(world, { name: names[i], color: COLORS[i % COLORS.length], bot: true });
      world.tanks.push(b);
      C.gainXp(world, b, Math.floor(Math.random() * (i < 3 ? 2500 : 400)));
    }
    world.events.length = 0;
    kills = 0; time = 0; picking = null;
    boss = null; bannerT = 0; world.truce = null;
    prefetchBoss();
    cam.x = me.x; cam.y = me.y; cam.z = viewZoom();
    state = 'play';
    ui.hide();
    updateHud();
  }
  function gameOver() {
    if (state !== 'play') return;
    state = 'over';
    Arcade.finish(ui, {
      score: Math.floor(me.xp),
      title: 'Tank destroyed',
      lines: [`Level ${me.level} ${T(me).name} · ${kills} tank${kills === 1 ? '' : 's'} destroyed · ${Math.floor(time)} s`],
      button: 'Roll out again',
      onAction: start,
    });
  }

  function update(dt) {
    time += dt;
    if (netMode === 'live') {
      matchT -= dt;
      // The host's clock ends the match.
      if (matchT <= 0) {
        matchT = 0;
        if (live.host) { live.send('end', liveTotals()); return endLive(); }
      }
      if (!me.alive) { liveRespawnT -= dt; if (liveRespawnT <= 0) liveRespawn(); }
      me.shield = Math.max(0, (me.shield || 0) - dt);
    }
    // You.
    controls.clear();
    if (me.alive) {
      let mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      let my = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      // Aim: the mouse, or the nearest thing worth shooting.
      let want = me.a, auto = null;
      if (aimMode === 'mouse') want = Math.atan2((mouse.y - H / 2) / cam.z + cam.y - me.y, (mouse.x - W / 2) / cam.z + cam.x - me.x);
      else {
        let bd = Math.max(520 * (T(me).range || 1), Math.min(shotRange(me) * 0.9, 1400)), bs = -Infinity;
        for (const o of world.tanks) {
          if (o === me || !o.alive) continue;
          const d = Math.hypot(o.x - me.x, o.y - me.y);
          // Only tanks that are after you, or right on top of you: auto-aim shouldn't start fights.
          if (world.truce && world.truce(o, me)) continue;
          const hostile = (o.remote && !o.bot) || (boss && o === boss.tank) || (o.ai?.mode === 'fight' && o.ai.target === me) || (o.remote && o.bot && d < 520) || d < 260;
          if (hostile && d < bd) { bs = 1e9 - d; auto = o; bd = d; }
        }
        if (!auto) for (const s of world.shapes) { const d = Math.hypot(s.x - me.x, s.y - me.y); if (d > 460) continue; const sc = s.k.xp / (d + 60); if (sc > bs) { bs = sc; auto = s; } }
        if (auto) { const d = Math.hypot(auto.x - me.x, auto.y - me.y), lead = d / shotSpeed(me); want = Math.atan2(auto.y + (auto.vy || 0) * lead - me.y, auto.x + (auto.vx || 0) * lead - me.x); }
      }
      me.a += angDiff(want, me.a) * Math.min(1, dt * (aimMode === 'mouse' ? 30 : 12));
      controls.set(me, { mx, my, aim: null, fire: mouse.down || keys.has('Space') || (aimMode === 'auto' && auto && autoFire) });
    }
    if (netMode === 'live') updateLive(dt);
    if (netMode === 'pub') updatePub(dt);
    // Sovereign arrives once per solo run at 20,000 xp; while he lives the rivals leave you two alone.
    if (!boss && me.alive && me.xp >= BOSS_XP && soloRun() && bossWeights !== undefined) spawnBoss();
    const duel = boss && !boss.raid && boss.tank.alive && me.alive;
    if (duel) { controls.set(boss.tank, bossControl(dt)); recordBoss(dt); }
    const raid = netMode === 'pub' && boss && boss.raid && boss.tank.alive && !boss.tank.remote;
    if (raid) { const opp = raidTarget(dt); controls.set(boss.tank, opp ? bossControl(dt, opp) : { mx: 0, my: 0, fire: false }); }
    bannerT = Math.max(0, bannerT - dt);
    // A new player gets 30 seconds to find their feet (the bots' grace), unless they start the fight.
    const makesShapes = netMode === 'live' ? live.host : netMode === 'pub' ? pubAuth() : true;
    C.step(world, dt, controls, { spawnShapes: makesShapes, graceTarget: netMode ? null : me, graceUntil: 30, ignore: duel ? new Set([me, boss.tank]) : raid ? new Set([boss.tank]) : undefined });
    handleEvents();
    cam.x = Gfx.approach(cam.x, me.x, 6, dt);
    cam.y = Gfx.approach(cam.y, me.y, 6, dt);
    cam.z = Gfx.approach(cam.z, viewZoom(), 2, dt);
    fx.update(dt); floats.update(dt); shake.update(dt);
    updateHud();
  }

  // What the rules did this frame, as sights, sounds, flags and live messages.
  function handleEvents() {
    let fired = false;
    for (const e of world.events) {
      if (e.type === 'shot') {
        if (netMode === 'pub' && e.t.nid && (e.t === me || (pubAuth() && !e.t.remote))) { const s = e.snap; pub.shots.push([e.t.nid, ...[s.x, s.y, s.vx, s.vy, s.r, s.dmg, s.life, s.pierce].map(v => Math.round(v * 10) / 10)]); }
        if (e.t !== me) continue;
        fired = true;
        const s = e.snap;   // as fired, not as step has since moved it
        if (netMode === 'live') liveShots.push([s.x, s.y, s.vx, s.vy, s.r, s.dmg, s.life, s.pierce].map(v => Math.round(v * 10) / 10));
      } else if (e.type === 'levelUp') {
        if (e.t !== me) continue;
        floats.add(`Level ${me.level}!`, me.x, me.y - 46, { color: '#ffd23f', size: 18 });
        Arcade.tone({ freq: 523, to: 1046, dur: 0.18, type: 'triangle', vol: 0.05 });
        if (me.level >= 25) Arcade.flag('tankfield-25');
      } else if (e.type === 'turretPick') {
        if (e.t === me) picking = e.options;
      } else if (e.type === 'shapeHit') {
        if (netMode === 'live' && e.by === me) liveHits.push([e.s.id, Math.round(e.n * 10) / 10]);
        if (netMode === 'pub' && e.by === me) pub.hits.push([e.s.id, Math.round(e.n * 10) / 10]);
      } else if (e.type === 'hit') {
        if (e.target === me) shake.add(0.12);
        // Raid: who did how much to Sovereign, for the reward split.
        if (netMode === 'pub' && boss && boss.raid && e.target === boss.tank && pubAuth()) { const k = e.by === me ? pub.lobby.slot : e.by?.slot; if (k !== undefined) pub.dmg[k] = (pub.dmg[k] || 0) + e.n; }
        if (e.sx !== undefined) fx.burst(3, () => ({ x: e.sx, y: e.sy, vx: R(-80, 80), vy: R(-80, 80), life: 0.25, size: 2, color: '#fff', shape: 'spark' }));
      } else if (e.type === 'shapeKilled') {
        const s = e.s;
        if (netMode === 'live' || netMode === 'pub') goneShapes.add(s.id);
        fx.burst(10, () => ({ x: s.x, y: s.y, vx: R(-120, 120), vy: R(-120, 120), life: R(0.3, 0.6), size: R(2, 5), color: s.k.color, drag: 3, shape: 'square', spin: R(-10, 10) }));
        if (e.by === me) {
          floats.add(`+${s.k.xp}`, s.x, s.y - 12, { color: s.k.color, size: 12 + Math.min(10, s.k.xp / 40) });
          if (s.k.sides === 6) Arcade.flag('tankfield-hexagon');
        }
      } else if (e.type === 'tankKilled') {
        const t = e.t;
        fx.burst(40, () => { const a = R(0, TAU), v = R(60, 260); return { x: t.x, y: t.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.5, 1), size: R(3, 7), color: t.color, drag: 2.5, shape: 'square', spin: R(-8, 8) }; });
        Arcade.tone({ freq: 150, to: 40, dur: 0.5, type: 'sawtooth', vol: 0.06 });
        if (netMode === 'pub' && pubAuth() && t !== me) pubKilled(e);
        if (boss && !boss.raid && t === boss.tank) {
          shake.add(1);
          if (e.by === me && !boss.fallback) {
            Arcade.flag('tankfield-sovereign');
            Arcade.save('sovereign:beaten:tankfield', { v: boss.version, t: Date.now() });
          }
          if (!boss.outcome) { boss.outcome = e.by === me ? 'win' : 'other'; finishBoss(boss.outcome); }
        }
        if (t === me && boss && !boss.raid && boss.tank.alive && !boss.outcome) { boss.outcome = e.by === boss.tank ? 'loss' : 'other'; finishBoss(boss.outcome); }
        if (t === me) {
          shake.add(0.8);
          if (netMode === 'live') liveDied(e.by); else if (netMode === 'pub') pubDied(e.by); else setTimeout(gameOver, 1000);
        } else if (e.by === me) {
          kills++;
          floats.add(`${t.name} destroyed! +${e.xp}`, t.x, t.y - 30, { color: '#ffd23f', size: 18 });
          shake.add(0.3);
          Arcade.flag('tankfield-kill');
          if (kills >= 5) Arcade.flag('tankfield-five');
        }
      }
    }
    world.events.length = 0;
    if (fired) Arcade.tone({ freq: 380, to: 160, dur: 0.05, type: 'square', vol: 0.02 });
  }

  // ---------- Input ----------

  const keys = new Set();
  let autoFire = true;
  addEventListener('keydown', e => {
    keys.add(e.code);
    if (state !== 'play') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    const n = +e.key;
    if (n >= 1 && n <= 7) {
      if (picking && n <= picking.length) { me.turret = picking[n - 1]; picking = null; Arcade.tone({ freq: 440, to: 880, dur: 0.2, type: 'triangle', vol: 0.05 }); Arcade.flag('tankfield-turret'); if (me.level >= 20) Arcade.flag('tankfield-final'); }
      else if (!picking && spend(me, n - 1)) Arcade.tone({ freq: 600 + n * 40, dur: 0.06, type: 'triangle', vol: 0.04 });
    }
    if (e.code === 'KeyQ') { aimMode = aimMode === 'auto' ? 'mouse' : 'auto'; Arcade.save('tank:aim', aimMode); floats.add(aimMode === 'auto' ? 'Auto-aim on' : 'Aim with the mouse', me.x, me.y - 50, { color: '#fff', size: 14 }); }
    if (e.code === 'KeyE') { autoFire = !autoFire; floats.add(autoFire ? 'Auto-fire on' : 'Auto-fire off', me.x, me.y - 50, { color: '#fff', size: 14 }); }
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouse.down = false; });
  const toCanvas = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  canvas.addEventListener('pointermove', e => { const p = toCanvas(e); mouse.x = p.x; mouse.y = p.y; });
  canvas.addEventListener('pointerdown', e => {
    const p = toCanvas(e); mouse.x = p.x; mouse.y = p.y;
    // Clicks on the stat and turret panels.
    const hit = panelHit(p.x, p.y);
    if (hit) return hit();
    if (aimMode === 'mouse') mouse.down = true;
  });
  addEventListener('pointerup', () => { mouse.down = false; });
  function pause() {
    if (state === 'play' && netMode === 'live') return livePause();
    if (state === 'play' && netMode === 'pub') return pubPause();
    if (state !== 'play' || (typeof Versus !== 'undefined' && Versus.active())) return;
    state = 'paused';
    ui.show({ title: 'Paused', html: `<p>Level ${me.level} ${T(me).name}</p>`, button: 'Resume', onAction: () => { state = 'play'; ui.hide(); } });
  }
  Arcade.onBlur(pause);

  // ---------- Camera ----------

  // How much of the arena you see: a little more as your tank grows, more again with a long-range
  // turret (as in the turret's own reach), and the widest view while Sovereign is alive.
  function viewZoom() {
    if (!me) return 0.8;
    let z = 0.82 - Math.min(44, me.level - 1) * 0.004;
    if (T(me).range) z *= 0.82;
    if (boss && boss.tank.alive) z = Math.min(z, 0.5);
    return z;
  }

  // An arrow on the screen edge pointing to Sovereign when he's out of view, with his distance.
  function drawBossArrow() {
    if (!boss || !boss.tank.alive) return;
    const t = boss.tank, z = cam.z;
    const sx = W / 2 + (t.x - cam.x) * z, sy = H / 2 + (t.y - cam.y) * z;
    if (sx > 20 && sx < W - 20 && sy > 20 && sy < H - 20) return;
    const a = Math.atan2(sy - H / 2, sx - W / 2), m = 34;
    const k = Math.min((W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - (Math.sin(a) > 0 ? 70 : m)) / Math.abs(Math.sin(a) || 1e-6));
    const x = W / 2 + Math.cos(a) * k;
    let y = H / 2 + Math.sin(a) * k;
    if (x > W - 175 && y > H - 150) y = H - 150;   // clear of the minimap
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 8);
    ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#3a2a00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-5, 0); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    Gfx.text(ctx, `Sovereign · ${Math.round(Math.hypot(t.x - me.x, t.y - me.y) / 10) * 10}`, clamp(x, 70, W - 70), clamp(y + (y > H / 2 ? -22 : 22), 14, H - 14), { size: 11, color: '#ffd23f', width: 3 });
  }

  // ---------- Drawing ----------

  function polygon(x, y, r, n, a) {
    ctx.beginPath();
    for (let k = 0; k < n; k++) { const t = a + k / n * TAU; const px = x + Math.cos(t) * r, py = y + Math.sin(t) * r; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  }

  function drawTank(t) {
    const r = radius(t), sc = r / 22, tur = T(t), flash = t.hitT > 0;
    Gfx.shadow(ctx, t.x + 3, t.y + 5, r * 1.05, r * 0.8, 0.3);
    ctx.save();
    ctx.translate(t.x, t.y);
    // Barrels.
    ctx.rotate(t.a);
    const recoil = t.recoilT > 0 ? -3 : 0;
    for (const [ao, side, len, wid] of tur.barrels) {
      ctx.save(); ctx.rotate(ao);
      ctx.fillStyle = '#8d94a1'; ctx.strokeStyle = '#4a5060'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(0, side * sc - wid * sc / 2, (len + recoil) * sc, wid * sc); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // Body.
    ctx.fillStyle = flash ? '#ffffff' : Gfx.shade(t.color, -0.25);
    ctx.beginPath(); ctx.arc(0, 2, r * 0.86, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r);
    g.addColorStop(0, flash ? '#fff' : Gfx.shade(t.color, 0.35)); g.addColorStop(1, flash ? '#fff' : t.color);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, TAU); ctx.fill();
    ctx.restore();
    if (boss && t === boss.tank) {
      ctx.strokeStyle = `rgba(255,210,63,${0.35 + 0.25 * Math.sin(time * 5)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, r + 10, 0, TAU); ctx.stroke();
    }
    if (t.shield > 0) {
      ctx.strokeStyle = `rgba(126,240,255,${0.4 + 0.3 * Math.sin(time * 12)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, r + 8, 0, TAU); ctx.stroke();
    }
    if (t.hp < t.max) Gfx.bar(ctx, t.x - r, t.y + r + 8, r * 2, 5, Math.max(0, t.hp) / t.max, t === me ? '#3ccf8e' : '#ff5c5c');
    if (t !== me) Gfx.text(ctx, `${t.name} · ${t.level}`, t.x, t.y - r - 14, { size: 12, color: '#fff', width: 3 });
  }

  const grid = Gfx.sprite(80, 80, 0, 0, g => { g.fillStyle = '#d8dde6'; g.fillRect(0, 0, 80, 80); g.strokeStyle = 'rgba(80,90,110,0.12)'; g.lineWidth = 2; g.strokeRect(0, 0, 80, 80); });

  function draw() {
    const off = shake.offset(7);
    ctx.save();
    ctx.translate(off.x, off.y);
    ctx.fillStyle = '#aab3c2'; ctx.fillRect(-10, -10, W + 20, H + 20);
    const z = cam.z, hw = W / 2 / z, hh = H / 2 / z;
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
    const x0 = Math.max(0, Math.floor((cam.x - hw) / 80) * 80), y0 = Math.max(0, Math.floor((cam.y - hh) / 80) * 80);
    for (let x = x0; x < Math.min(AW, cam.x + hw + 80); x += 80) for (let y = y0; y < Math.min(AH, cam.y + hh + 80); y += 80) grid.draw(ctx, x, y);
    // The middle, where the big shapes gather.
    ctx.fillStyle = 'rgba(176,124,255,0.07)'; ctx.fillRect(AW / 2 - MID_W, AH / 2 - MID_H, MID_W * 2, MID_H * 2);
    const vis = (x, y, m) => Math.abs(x - cam.x) < hw + m && Math.abs(y - cam.y) < hh + m;
    for (const s of world.shapes) {
      if (!vis(s.x, s.y, 60)) continue;
      Gfx.shadow(ctx, s.x + 2, s.y + 4, s.r, s.r * 0.6, 0.2);
      polygon(s.x, s.y, s.r, s.sides, s.a);
      ctx.fillStyle = s.hitT > 0 ? '#fff' : s.k.color; ctx.fill();
      ctx.strokeStyle = Gfx.shade(s.k.color, -0.35); ctx.lineWidth = 3; ctx.stroke();
      if (s.hp < s.max) Gfx.bar(ctx, s.x - s.r, s.y + s.r + 6, s.r * 2, 4, s.hp / s.max, '#3ccf8e');
    }
    for (const s of world.shots) {
      if (!vis(s.x, s.y, 60)) continue;
      // Fast shots (Long Shot, Railgun) leave a streak so you can see where they came from.
      const v = Math.hypot(s.vx, s.vy);
      if (v > 700) {
        const k = Math.min(0.09, 140 / v);
        ctx.strokeStyle = s.color; ctx.globalAlpha = 0.45; ctx.lineWidth = s.r * 1.3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x - s.vx * k, s.y - s.vy * k); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = Gfx.shade(s.color, -0.3); ctx.beginPath(); ctx.arc(s.x, s.y + 1.5, s.r, 0, TAU); ctx.fill();
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
    for (const t of world.tanks) if (t.alive && vis(t.x, t.y, 80)) drawTank(t);
    fx.draw(ctx);
    floats.draw(ctx);
    ctx.strokeStyle = 'rgba(40,50,70,0.5)'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, AW, AH);
    ctx.restore();
    ctx.restore();
    if (state === 'menu' || !me) return;
    drawBossArrow();
    drawPanels();
  }

  // Stat bars (bottom left), the level bar, the minimap and the turret picker.
  let hits = [];
  function drawPanels() {
    hits = [];
    const x0 = 12, y0 = H - 12 - STATS.length * 19 - 22;
    Gfx.card(ctx, x0, y0, 222, STATS.length * 19 + 28);
    Gfx.text(ctx, me.points ? `${me.points} point${me.points === 1 ? '' : 's'} to spend (keys 1-7)` : 'Stats', x0 + 10, y0 + 13, { size: 11, align: 'left', stroke: null, color: me.points ? '#ffd23f' : '#cfd8dc' });
    STATS.forEach((s, i) => {
      const y = y0 + 24 + i * 19, v = me.stats[s.id];
      Gfx.text(ctx, `${i + 1} ${s.name}`, x0 + 10, y + 6, { size: 11, align: 'left', stroke: null });
      for (let k = 0; k < MAX_STAT; k++) { ctx.fillStyle = k < v ? s.color : 'rgba(255,255,255,0.12)'; Gfx.roundRect(ctx, x0 + 100 + k * 15, y, 13, 11, 3); ctx.fill(); }
      if (me.points && v < MAX_STAT) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; Gfx.roundRect(ctx, x0 + 100 + v * 15, y, 13, 11, 3); ctx.fill(); }
      hits.push({ x: x0, y: y - 3, w: 222, h: 17, fn: () => spend(me, i) });
    });
    // Level and xp.
    const need = xpFor(me.level), prev = me.level > 1 ? xpFor(me.level - 1) : 0;
    Gfx.card(ctx, W / 2 - 170, H - 44, 340, 32);
    Gfx.bar(ctx, W / 2 - 160, H - 38, 320, 10, (me.xp - prev) / (need - prev), '#ffd23f');
    Gfx.text(ctx, `Level ${me.level} ${T(me).name} · ${Math.floor(me.xp).toLocaleString()} xp`, W / 2, H - 20, { size: 12, stroke: null });
    // Minimap.
    const mw = 150, mh = mw * AH / AW, mx = W - mw - 12, my = H - mh - 12, k = mw / AW;
    Gfx.card(ctx, mx - 4, my - 4, mw + 8, mh + 8);
    ctx.fillStyle = 'rgba(176,124,255,0.2)'; ctx.fillRect(mx + (AW / 2 - MID_W) * k, my + (AH / 2 - MID_H) * k, MID_W * 2 * k, MID_H * 2 * k);
    for (const t of world.tanks) { if (!t.alive) continue; ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(mx + t.x * k, my + t.y * k, t === me ? 3.5 : 2.5, 0, TAU); ctx.fill(); }
    // Leaderboard.
    const top = [...world.tanks].filter(t => t.alive).sort((a, b) => b.xp - a.xp).slice(0, 5);
    Gfx.card(ctx, W - 182, 10, 170, 22 + top.length * 17);
    Gfx.text(ctx, 'Top tanks', W - 97, 21, { size: 11, stroke: null, color: '#cfd8dc' });
    top.forEach((t, i) => Gfx.text(ctx, `${i + 1}. ${t.name}  ${Math.floor(t.xp).toLocaleString()}`, W - 172, 38 + i * 17, { size: 11, align: 'left', stroke: null, color: t === me ? '#ffd23f' : t.color }));
    if (netMode === 'live' && rival) {
      Gfx.card(ctx, W / 2 - 150, 10, 300, 40);
      Gfx.text(ctx, `You ${kills}  –  ${rival.kills} ${rival.name}`, W / 2, 25, { size: 15, stroke: null, color: '#fff' });
      Gfx.text(ctx, `First to ${LIVE_KILLS} · ${Math.floor(matchT / 60)}:${String(Math.floor(matchT % 60)).padStart(2, '0')}`, W / 2, 42, { size: 11, stroke: null, color: '#cfd8dc' });
      if (!me.alive) Gfx.text(ctx, `Back in ${Math.ceil(liveRespawnT)}…`, W / 2, H / 2 - 40, { size: 22 });
    }
    Gfx.text(ctx, `${aimMode === 'auto' ? 'Auto-aim' : 'Mouse aim'} (Q)${autoFire || aimMode === 'mouse' ? '' : ' · auto-fire off (E)'}`, 14, 20, { size: 11, align: 'left', color: '#2b2f3a', stroke: 'rgba(255,255,255,0.6)', width: 3 });
    // Turret choice.
    if (picking) {
      const n = picking.length, w = 150, x = W / 2 - (n * (w + 10) - 10) / 2, y = netMode === 'pub' ? 82 : 60;
      Gfx.text(ctx, `Level ${me.level}: pick a new turret (keys 1-${n})`, W / 2, y - 14, { size: 16 });
      picking.forEach((id, i) => {
        const t = TURRETS[id], bx = x + i * (w + 10);
        Gfx.card(ctx, bx, y, w, 120, { fill: 'rgba(20,28,40,0.88)' });
        // A little preview.
        ctx.save(); ctx.translate(bx + w / 2, y + 48); ctx.rotate(-0.5);
        for (const [ao, side, len, wid] of t.barrels) { ctx.save(); ctx.rotate(ao); ctx.fillStyle = '#8d94a1'; ctx.fillRect(0, side * 0.8 - wid * 0.4, len * 0.8, wid * 0.8); ctx.restore(); }
        ctx.fillStyle = '#4f8cff'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
        ctx.restore();
        Gfx.text(ctx, `${i + 1}. ${t.name}`, bx + w / 2, y + 88, { size: 13, stroke: null });
        Gfx.text(ctx, t.desc, bx + w / 2, y + 106, { size: 10, stroke: null, color: '#9aa3b5' });
        hits.push({ x: bx, y, w, h: 120, fn: () => { me.turret = id; picking = null; Arcade.flag('tankfield-turret'); } });
      });
    }
    if (netMode === 'pub' && pub) drawPubHud();
    // Last, so nothing covers it.
    if (bannerT > 0) {
      const al = Math.min(1, bannerT / 0.6, (4 - bannerT) / 0.3);
      ctx.save(); ctx.globalAlpha = al;
      Gfx.text(ctx, banner?.text || '', W / 2, H / 2 - 110, { size: 34, color: '#ffd23f', width: 6 });
      Gfx.text(ctx, banner?.sub || '', W / 2, H / 2 - 78, { size: 14, color: '#fff', width: 4 });
      ctx.restore();
    }
  }
  function panelHit(x, y) {
    const h = [...hits].reverse().find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    return h ? h.fn : null;
  }

  function updateHud() {
    $('xp').textContent = me ? Math.floor(me.xp).toLocaleString() : 0;
    $('lvl').textContent = me ? me.level : '-';
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'play' && (overlayEl.hidden || netMode === 'live' || netMode === 'pub' || (typeof Versus !== 'undefined' && Versus.active()))) update(dt);
    else { fx.update(dt); floats.update(dt); shake.update(dt); }
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- Live 1v1 (live.js) ----------
  // Each machine drives its own tank and streams where it is. Shots are sent as they're fired and
  // flown on both machines, but only the tank that gets hit takes the damage (it sees itself where
  // it really is), and it tells the other side when it's destroyed, so both agree on the kills.
  // Shapes are shared: the host owns them and sends a snapshot twice a second; both sides send
  // the damage they do to them. The host's clock ends the match.

  let netMode = null, rival = null, matchT = 0, liveError = '', liveShots = [], liveHits = [];
  let sendT = 0, flushT = 0, snapT = 0, liveRespawnT = 0, lost = 0, goneShapes = new Set();
  const live = Live.create({
    ui,
    tag: 'tank',
    label: '1v1',
    title: 'The 1v1',
    onReady: host => { if (host) hostStart(); },
    onEvent: onLive,
    onState: st => {
      if (!rival) return;
      rival.net = { ...st, at: performance.now() };
      if (!live.host && typeof st.t === 'number' && state === 'play') matchT = st.t;
    },
    onRematch: hostStart,
    onGone: gone => liveGone(gone),
    onCancel: msg => { liveError = msg ? Online.escape(msg) : ''; showMenu(); },
  });

  function hostStart() {
    live.send('start', {});
    startLive();
  }

  function startLive() {
    netMode = 'live';
    // The host makes the shapes; the guest waits for its first snapshot.
    world = newWorld(live.host ? SHAPES : 0);
    world.shapeTarget = SHAPES;
    fx.clear(); goneShapes = new Set();
    me = C.makeTank(world, { name: 'You', color: '#4f8cff', bot: false });
    rival = C.makeTank(world, { name: live.them, color: '#ff5a5f', bot: false });
    rival.remote = true; rival.net = null; rival.kills = 0; rival.deaths = 0;
    world.tanks.push(me, rival);
    // Opposite sides of the arena.
    const left = { x: AW * 0.2, y: AH / 2 }, right = { x: AW * 0.8, y: AH / 2 };
    Object.assign(me, live.host ? left : right);
    Object.assign(rival, live.host ? right : left);
    me.a = live.host ? 0 : Math.PI;
    me.shield = 3; me.deaths = 0;
    if (live.host) sendShapes();
    kills = 0; lost = 0; time = 0; picking = null; matchT = LIVE_TIME;
    liveShots = []; liveHits = []; sendT = 0; flushT = 0; snapT = 0;
    cam.x = me.x; cam.y = me.y;
    floats.add(`1v1 vs ${rival.name} · first to ${LIVE_KILLS}`, me.x, me.y - 60, { color: '#fff', size: 18 });
    state = 'play';
    ui.hide();
    updateHud();
  }

  function sendShapes() {
    live.send('shapes', world.shapes.map(sh => [sh.id, SHAPE_KINDS.indexOf(sh.k), Math.round(sh.x), Math.round(sh.y), Math.ceil(sh.hp)]));
  }

  function applyShapes(list) {
    if (!Array.isArray(list)) return;
    const byId = new Map(world.shapes.map(sh => [sh.id, sh]));
    const next = [];
    for (const row of list.slice(0, SHAPES * 2)) {
      const [id, ki, x, y, hp] = row;
      const k = SHAPE_KINDS[ki];
      if (!k || goneShapes.has(id) || !isFinite(x) || !isFinite(y)) continue;
      let sh = byId.get(id);
      if (!sh) { sh = C.makeShape(world, k, clamp(x, 0, AW), clamp(y, 0, AH), id); sh.hp = clamp(+hp || k.hp, 1, k.hp); }
      else sh.hp = Math.min(sh.hp, clamp(+hp || k.hp, 1, k.hp));
      sh.tx = clamp(x, 0, AW); sh.ty = clamp(y, 0, AH);
      next.push(sh);
    }
    world.shapes = next;
  }

  const liveTotals = () => ({ a: kills, b: rival.kills, xa: Math.floor(me.xp), xb: Math.floor(rival.xp) });

  function onLive(name, d) {
    if (name === 'hello') { if (rival) rival.name = live.them; return; }
    if (name === 'start' && !live.host) return startLive();
    if (!rival || state !== 'play' || netMode !== 'live') return;
    if (name === 'shapes') { if (!live.host) applyShapes(d); return; }
    if (name === 'f') {
      // Their shots, flown here too, and the damage they did to shapes.
      for (const v of (Array.isArray(d?.s) ? d.s : []).slice(0, 40)) {
        const [x, y, vx, vy, r, dmg, life, pierce] = v.map(Number);
        if (![x, y, vx, vy].every(isFinite)) continue;
        world.shots.push({ x, y, vx, vy, r: clamp(r, 1, 12), dmg: clamp(dmg, 0, 80), life: clamp(life, 0, 3), owner: rival, pierce: clamp(pierce | 0, 1, 3), color: rival.color });
      }
      for (const [id, n] of (Array.isArray(d?.h) ? d.h : []).slice(0, 60)) {
        const sh = world.shapes.find(x => x.id === id);
        if (!sh || sh.dead) continue;
        sh.hitT = 0.08;
        sh.hp -= clamp(+n || 0, 0, 200);
        if (sh.hp <= 0) C.killShape(world, sh, null);
      }
      return;
    }
    if (name === 'dead') {
      // They were destroyed. k: whether it was us (rather than a shape) that did it.
      rival.deaths++;
      rival.alive = false;
      fx.burst(40, () => { const a = R(0, TAU), v = R(60, 260); return { x: rival.x, y: rival.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.5, 1), size: R(3, 7), color: rival.color, drag: 2.5, shape: 'square', spin: R(-8, 8) }; });
      Arcade.tone({ freq: 150, to: 40, dur: 0.5, type: 'sawtooth', vol: 0.06 });
      if (!d?.k) return;
      kills = Math.max(kills + 1, d.n | 0);
      const xp = Math.round(rival.xp * 0.25) + 50;
      C.gainXp(world, me, xp);
      floats.add(`${rival.name} destroyed! +${xp}`, rival.x, rival.y - 30, { color: '#ffd23f', size: 18 });
      shake.add(0.3);
      Arcade.flag('tankfield-kill');
      if (kills >= LIVE_KILLS) { live.send('end', liveTotals()); endLive(); }
      return;
    }
    if (name === 'end') {
      // Their totals, from their side: a = theirs, b = ours.
      rival.kills = Math.max(rival.kills, d?.a | 0);
      kills = Math.max(kills, d?.b | 0);
      if (isFinite(d?.xa)) rival.xp = Math.max(rival.xp, +d.xa);
      endLive();
    }
  }

  function liveDied(by) {
    me.alive = false;
    me.deaths++;
    const k = by === rival;
    if (k) { lost++; rival.kills = Math.max(rival.kills, lost); }
    live.send('dead', { k: k ? 1 : 0, n: lost });
    liveRespawnT = 3;
    if (k && rival.kills >= LIVE_KILLS) { live.send('end', liveTotals()); endLive(); }
  }

  function liveRespawn() {
    // Back with everything you'd earned, as far from them as the arena allows, shielded for a moment.
    me.alive = true; me.vx = me.vy = 0;
    me.max = maxHp(me); me.hp = me.max;
    me.x = rival.x < AW / 2 ? AW - 200 : 200;
    me.y = clamp(AH - rival.y, 200, AH - 200);
    me.shield = 3;
  }

  function updateLive(dt) {
    sendT -= dt; flushT -= dt; snapT -= dt;
    if (sendT <= 0) {
      sendT = 0.05;
      const r = v => Math.round(v * 10) / 10;
      live.state({ x: r(me.x), y: r(me.y), vx: r(me.vx), vy: r(me.vy), a: Math.round(me.a * 100) / 100, h: Math.round(Math.max(0, me.hp)), m: Math.round(me.max), l: me.level, u: me.turret, p: Math.floor(me.xp), rm: me.stats.ram, al: me.alive ? 1 : 0, d: me.deaths, sh: me.shield > 0 ? 1 : 0, k: kills, t: live.host ? r(matchT) : undefined });
    }
    if (flushT <= 0 && (liveShots.length || liveHits.length)) {
      flushT = 0.05;
      live.send('f', { s: liveShots, h: liveHits });
      liveShots = []; liveHits = [];
    }
    if (live.host && snapT <= 0) { snapT = 0.5; sendShapes(); }
    // Their tank: move toward where it should be by now.
    const st = rival.net;
    if (!st) return;
    const lag = Math.min(0.15, (performance.now() - st.at) / 1000);
    const tx = st.x + st.vx * lag, ty = st.y + st.vy * lag;
    const wasAlive = rival.alive;
    // A state sent before their 'dead' arrived mustn't bring them back.
    rival.alive = !!st.al && (st.d | 0) >= rival.deaths;
    if ((!wasAlive && rival.alive) || Math.hypot(tx - rival.x, ty - rival.y) > 200) { rival.x = tx; rival.y = ty; }
    else { rival.x = Gfx.approach(rival.x, tx, 14, dt); rival.y = Gfx.approach(rival.y, ty, 14, dt); }
    rival.x = clamp(rival.x, 0, AW); rival.y = clamp(rival.y, 0, AH);
    rival.vx = st.vx; rival.vy = st.vy;
    rival.a += angDiff(+st.a || 0, rival.a) * Math.min(1, dt * 20);
    rival.level = clamp(st.l | 0, 1, 45);
    rival.max = Math.max(1, st.m | 0); rival.hp = clamp(st.h | 0, 0, rival.max);
    if (TURRETS[st.u]) rival.turret = st.u;
    rival.xp = Math.max(0, st.p | 0);
    rival.stats.ram = clamp(st.rm | 0, 0, MAX_STAT);
    rival.shield = st.sh ? 1 : 0;
    rival.kills = Math.max(rival.kills, st.k | 0);
  }

  function livePause() {
    ui.show({
      title: 'Menu',
      html: `<p>The match keeps going while this is open.</p><p>${kills} – ${rival.kills} · ${Math.ceil(matchT)} s left</p>
        <div class="menu"><button class="btn secondary" type="button" data-quit>Leave match (counts as a loss)</button></div>`,
      button: 'Back in',
      onAction: () => ui.hide(),
      onRender: p => p.querySelector('[data-quit]').addEventListener('click', () => {
        Relay.result('l');
        showMenu();
      }),
    });
  }

  function endLive() {
    if (state !== 'play' || netMode !== 'live') return;
    state = 'over';
    const mx = Math.floor(me.xp), tx = Math.floor(rival.xp);
    const won = kills > rival.kills || (kills === rival.kills && mx > tx);
    const draw = kills === rival.kills && mx === tx;
    Arcade.countPlay();
    Arcade.flag('online-match');
    Relay.result(draw ? 'd' : won ? 'w' : 'l');
    if (won) Arcade.flag('tankfield-online-win');
    const them = Online.escape(rival.name);
    ui.show({
      title: draw ? "It's a draw" : won ? 'You win! 🛡️' : `${them} wins`,
      html: `<p class="big">${kills} – ${rival.kills}</p>
        <p>You vs ${them} · Level ${me.level} ${T(me).name}${kills === rival.kills ? ` · tie broken on xp: ${mx.toLocaleString()} to ${tx.toLocaleString()}` : ''}</p>
        <div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div>${live.waitNote}`,
      button: 'Rematch',
      delay: 600,
      onAction: () => live.rematch(),
      onRender: p => p.querySelector('[data-leave]').addEventListener('click', showMenu),
    });
  }

  function liveGone(connLost) {
    const wasPlaying = state === 'play' && netMode === 'live';
    const name = rival?.name || 'Your opponent';
    if (wasPlaying) {
      state = 'over';
      netMode = null;
      if (connLost) return ui.show({ title: 'Connection lost', html: "<p>Lost the connection to the game server, so this match doesn't count.</p>", button: 'Back to menu', onAction: showMenu });
      Arcade.countPlay();
      Arcade.flag('online-match');
      Arcade.flag('tankfield-online-win');
      Relay.result('w');
      return ui.show({ title: `${Online.escape(name)} left`, html: '<p>You win by forfeit.</p>', button: 'Back to menu', onAction: showMenu });
    }
    if (state === 'over' && netMode === 'live') {
      const w = document.querySelector('[data-live-wait]');
      if (w) { w.textContent = `${name} left.`; return; }
    }
    liveError = connLost ? 'Lost the connection to the game server.' : `${Online.escape(name)} left.`;
    showMenu();
  }

  // ---------- Public lobby (public-lobby.js) ----------
  // Up to 10 real players share one arena with bots. One player's browser (the lobby's authority)
  // runs the bots, the shapes and Sovereign, and streams them 10 times a second; every player
  // streams their own tank. As in the 1v1, the machine that owns a tank applies the damage it
  // takes (from any shot it sees), and the shooter is told about kills so it can collect the xp.
  // Sovereign raids every RAID_EVERY seconds of the lobby's clock, tougher for every player in
  // the lobby; while he's up, players can't hurt each other, and his reward is split by damage.
  // If the authority leaves, the next player's browser takes the bots over from the last snapshot.

  const PUB_RIVALS = 10, RAID_EVERY = 450, RAID_LIFE = 240, RAID_POOL = 10050;
  const TURRET_IDS = Object.keys(TURRETS);
  const PEER_COLORS = ['#2f6fff', '#00b8d4', '#00c853', '#aa00ff', '#ff6d00', '#c51162', '#6200ea', '#00bfa5', '#ffab00', '#304ffe'];
  let pub = null, pubError = '', pubToken = 0;
  const pubAuth = () => netMode === 'pub' && !!pub && pub.lobby.isAuthority;
  const statStr = t => STATS.map(s => t.stats[s.id]).join('');
  const readStats = (t, str) => { if (typeof str === 'string' && str.length === 7) STATS.forEach((s, i) => { t.stats[s.id] = clamp(+str[i] || 0, 0, MAX_STAT); }); };
  const r1 = v => Math.round(v * 10) / 10;
  const raidOn = () => !!(boss && boss.raid && boss.tank.alive);

  async function joinPub() {
    leavePub();
    live.leave();
    const token = ++pubToken;
    ui.show({ title: 'Joining a public lobby…', html: Relay.CONNECTING, button: 'Cancel', onAction: () => { pubToken++; showMenu(); }, onRender: Relay.ticker });
    prefetchBoss();
    try {
      const lobby = await PublicLobby.join(ID, {
        color: '#4f8cff',
        onJoined: d => { if (pub) { addPeer(d.slot, d.name); floats.add(`${d.name} joined`, me.x, me.y - 60, { color: '#fff', size: 14 }); } },
        onLeft: d => { if (pub) { removePeer(d.slot); if (d.name) floats.add(`${d.name} left`, me.x, me.y - 60, { color: '#cfd8dc', size: 14 }); } },
        onAuthority: slot => { if (pub && slot === pub.lobby.slot) takeOver(); },
        onState: (slot, st) => { const t = pub?.byNid.get('p' + slot); if (t && st) t.net = { ...st, at: performance.now() }; },
        onWorld: w => { if (pub && !pub.lobby.isAuthority) applyWorld(w); },
        onEvent: (from, type, d) => { if (pub) pubEvent(from, type, d); },
        onClosed: () => pubGone(),
      });
      if (token !== pubToken) return lobby.leave();
      startPub(lobby);
    } catch (e) {
      if (token !== pubToken) return;
      pubError = Online.escape(e.message || "Couldn't join a lobby.");
      showMenu();
    }
  }

  function leavePub() {
    if (!pub) return;
    pub.lobby.leave();
    pub = null;
  }

  function register(t, nid) { t.nid = nid; pub.byNid.set(nid, t); }

  function startPub(lobby) {
    netMode = 'pub'; rival = null; boss = null; bannerT = 0;
    world = newWorld(lobby.isAuthority ? SHAPES : 0);
    world.shapeTarget = SHAPES;
    fx.clear(); goneShapes = new Set();
    pub = { lobby, byNid: new Map(), shots: [], hits: [], sendT: 0, flushT: 0, worldT: 0, shapesT: 0, respawnT: 0,
      bossK: Math.floor(lobby.clock() / 1000 / RAID_EVERY), bossEnd: 0, dmg: {} };
    // Players can't hurt each other while Sovereign is up.
    world.truce = (a, b) => raidOn() && a !== boss.tank && b !== boss.tank && !a.bot && !b.bot;
    me = C.makeTank(world, { name: 'You', color: '#4f8cff', bot: false });
    world.tanks.push(me);
    register(me, 'p' + lobby.slot);
    me.shield = 5; me.deaths = 0;
    for (const [slot, name] of lobby.names) if (slot !== lobby.slot) addPeer(slot, name);
    if (lobby.isAuthority) for (let i = 0; i < PUB_RIVALS; i++) addPubBot(i);
    kills = 0; time = 0; picking = null;
    cam.x = me.x; cam.y = me.y; cam.z = viewZoom();
    state = 'play';
    ui.hide();
    Arcade.countPlay();
    floats.add(`Public lobby · ${lobby.names.size} player${lobby.names.size === 1 ? '' : 's'}`, me.x, me.y - 60, { color: '#fff', size: 18 });
    updateHud();
  }

  function addPubBot(i) {
    const b = C.makeTank(world, { name: NAMES[i % NAMES.length], color: COLORS[i % COLORS.length], bot: true });
    world.tanks.push(b);
    register(b, 'b' + i);
    C.gainXp(world, b, Math.floor(Math.random() * (i < 3 ? 3000 : 500)));
    world.events.length = 0;
  }

  function addPeer(slot, name) {
    if (pub.byNid.has('p' + slot)) removePeer(slot);
    const t = C.makeTank(world, { name: String(name || 'Player').slice(0, 24), color: PEER_COLORS[slot % PEER_COLORS.length], bot: false });
    t.remote = true; t.alive = false; t.slot = slot; t.deaths = 0; t.net = null;
    world.tanks.push(t);
    register(t, 'p' + slot);
  }

  function removePeer(slot) {
    const t = pub.byNid.get('p' + slot);
    if (!t) return;
    world.tanks = world.tanks.filter(x => x !== t);
    pub.byNid.delete('p' + slot);
  }

  function explode(t) {
    fx.burst(40, () => { const a = R(0, TAU), v = R(60, 260); return { x: t.x, y: t.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: R(0.5, 1), size: R(3, 7), color: t.color, drag: 2.5, shape: 'square', spin: R(-8, 8) }; });
    if (Math.hypot(t.x - me.x, t.y - me.y) < 1400) Arcade.tone({ freq: 150, to: 40, dur: 0.5, type: 'sawtooth', vol: 0.05 });
  }

  // The previous authority left: run its bots, Sovereign and shapes from here on.
  function takeOver() {
    for (const t of world.tanks) {
      if (!t.remote || !t.nid || t.nid[0] === 'p') continue;
      t.remote = false; t.net = null;
      if (t.nid === 'S') {
        boss = { tank: t, raid: true, ...bossBrain(t), target: null, targetT: 0 };
        if (!t.alive) { world.tanks = world.tanks.filter(x => x !== t); pub.byNid.delete('S'); boss = null; }
      } else if (!t.alive) t.respawnT = 2;
    }
    for (const sh of world.shapes) { delete sh.tx; delete sh.ty; }
    world.shapeTarget = SHAPES;
    // A lobby whose bots all left with the old authority gets a fresh set.
    if (![...pub.byNid.keys()].some(k => k[0] === 'b')) for (let i = 0; i < PUB_RIVALS; i++) addPubBot(i);
  }

  // ---- Authority: the shared world ----

  const tankRowPub = t => [t.nid, r1(t.x), r1(t.y), Math.round(t.vx), Math.round(t.vy), Math.round(t.a * 100), Math.ceil(Math.max(0, t.hp)), Math.round(t.max), t.level,
    TURRET_IDS.indexOf(t.turret), Math.floor(t.xp), t.alive ? 1 : 0, statStr(t), t.name, t.color];

  function sendWorld() {
    const w = { b: world.tanks.filter(t => t.nid && t.nid[0] !== 'p').map(tankRowPub), bk: pub.bossK, be: pub.bossEnd };
    if (pub.shapesT <= 0) {
      pub.shapesT = 0.5;
      w.t = world.shapes.map(sh => [sh.id, SHAPE_KINDS.indexOf(sh.k), Math.round(sh.x), Math.round(sh.y), Math.ceil(sh.hp)]);
    }
    pub.lobby.world(w);
  }

  function applyWorld(w) {
    if (!w || !Array.isArray(w.b)) return;
    const seen = new Set();
    for (const row of w.b.slice(0, 40)) {
      const [nid, x, y, vx, vy, a, hp, max, lv, tu, xp, al, st, name, color] = row;
      if (typeof nid !== 'string' || nid[0] === 'p' || !isFinite(x) || !isFinite(y)) continue;
      seen.add(nid);
      let t = pub.byNid.get(nid);
      if (!t) {
        t = C.makeTank(world, { name: String(name || 'Tank').slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#888888', bot: nid !== 'S' });
        t.remote = true; t.x = clamp(x, 0, AW); t.y = clamp(y, 0, AH);
        world.tanks.push(t);
        register(t, nid);
      }
      t.net = { x: clamp(x, 0, AW), y: clamp(y, 0, AH), vx: +vx || 0, vy: +vy || 0, a: (+a || 0) / 100, at: performance.now() };
      t.max = Math.max(1, +max || 1); t.hp = clamp(+hp || 0, 0, t.max);
      t.level = clamp(lv | 0, 1, 45);
      if (TURRET_IDS[tu]) t.turret = TURRET_IDS[tu];
      t.xp = Math.max(0, +xp || 0);
      readStats(t, st);
      const alive = !!al;
      if (t.alive && !alive) explode(t);
      if (!t.alive && alive) { t.x = t.net.x; t.y = t.net.y; }
      t.alive = alive;
      if (nid === 'S' && (!boss || boss.tank !== t) && alive) { boss = { tank: t, raid: true }; raidStarted(); }
    }
    for (const [nid, t] of [...pub.byNid]) {
      if (nid[0] === 'p' || seen.has(nid)) continue;
      world.tanks = world.tanks.filter(x => x !== t);
      pub.byNid.delete(nid);
      if (boss && boss.tank === t) boss = null;
    }
    if (isFinite(w.bk)) pub.bossK = w.bk;
    if (isFinite(w.be)) pub.bossEnd = w.be;
    if (w.t) applyShapes(w.t);
  }

  function raidStarted() {
    showBanner('SOVEREIGN RAID', 'Team up and bring him down. Players can\'t hurt each other until he falls.');
    shake.add(0.8);
    Arcade.tone({ freq: 110, to: 55, dur: 0.9, type: 'sawtooth', vol: 0.07 });
    Arcade.tone({ freq: 523, to: 1046, dur: 0.4, type: 'triangle', vol: 0.05 });
  }

  function players() { return world.tanks.filter(t => t.nid && t.nid[0] === 'p'); }

  function spawnRaid() {
    const alive = players().filter(t => t.alive);
    const focus = alive.length ? alive[Math.floor(Math.random() * alive.length)] : me;
    const t = C.makeTank(world, { name: 'Sovereign', color: '#ffd23f', bot: false });
    const a = R(0, TAU), r = 40;
    t.x = clamp(focus.x + Math.cos(a) * BOSS_DIST, r, AW - r);
    t.y = clamp(focus.y + Math.sin(a) * BOSS_DIST, r, AH - r);
    t.a = Math.atan2(focus.y - t.y, focus.x - t.x);
    IO.applyBuild(world, t, ASSASSIN_BUILD);
    // Tougher for every player in the lobby. His reward is the raid split, so his own kill pays little.
    const n = players().length;
    t.max = Math.round(C.maxHp(t) * (1 + 0.9 * (n - 1))); t.hp = t.max; t.xp = 0;
    world.tanks.push(t);
    register(t, 'S');
    boss = { tank: t, raid: true, ...bossBrain(t), target: null, targetT: 0 };
    pub.bossEnd = pub.lobby.clock() / 1000 + RAID_LIFE;
    pub.dmg = {};
    raidStarted();
  }

  // Sovereign hunts whoever is closest, re-checked every few seconds; his memory resets on a switch.
  function raidTarget(dt) {
    boss.targetT -= dt;
    if (boss.targetT <= 0 || !boss.target || !boss.target.alive || !world.tanks.includes(boss.target)) {
      boss.targetT = 4;
      const t = boss.tank;
      let best = null, bd = Infinity;
      for (const p of players()) { if (!p.alive) continue; const d = Math.hypot(p.x - t.x, p.y - t.y); if (d < bd) { bd = d; best = p; } }
      if (best !== boss.target && boss.net) boss.state = Sov.newState(boss.net);
      boss.target = best;
    }
    return boss.target;
  }

  function endRaid(won) {
    const total = Object.values(pub.dmg).reduce((a, b) => a + b, 0);
    const xp = {};
    if (won) for (const [k, v] of Object.entries(pub.dmg)) if (v >= total * 0.03) xp[k] = Math.round(RAID_POOL * Math.max(0.3, v / total));
    const t = boss.tank;
    if (!won) { t.alive = false; explode(t); }
    world.tanks = world.tanks.filter(x => x !== t);
    pub.byNid.delete('S');
    pub.lobby.send('raid', { won: won ? 1 : 0, xp });
    raidOver({ won, xp });
  }

  function raidOver(d) {
    boss = null;
    const mine = clamp(+(d.xp || {})[pub.lobby.slot] || 0, 0, RAID_POOL);
    if (d.won) {
      showBanner('SOVEREIGN FALLS', mine ? `Your share of the reward: +${mine.toLocaleString()} xp` : 'Hit him next time to share the reward.');
      Arcade.tone({ freq: 523, to: 1568, dur: 0.6, type: 'triangle', vol: 0.06 });
      if (mine) { C.gainXp(world, me, mine); Arcade.flag('tankfield-raid'); }
    } else showBanner('SOVEREIGN WITHDRAWS', `He'll be back in ${Math.round(RAID_EVERY / 60 * 2) / 2} minutes.`);
  }

  function pubKilled(e) {
    const t = e.t;
    if (boss && boss.raid && t === boss.tank) return endRaid(true);
    // A bot here, destroyed by another player: they collect the xp on their machine.
    if (e.by && e.by.remote && e.by.slot !== undefined) pub.lobby.send('kill', { xp: e.xp, name: t.name }, e.by.slot);
  }

  // ---- Everyone ----

  function pubDied(by) {
    me.alive = false;
    me.deaths++;
    pub.respawnT = 4;
    pub.lobby.send('dead', { by: by?.nid || null, xp: Math.floor(me.xp), d: me.deaths });
  }

  function pubRespawn() {
    // Back as a fresh tank with 30% of your xp (the turret choices come round again).
    const keep = Math.floor(me.xp * 0.3);
    Object.assign(me, { xp: 0, level: 1, points: 0, stats: Object.fromEntries(STATS.map(s => [s.id, 0])), turret: 'basic', alive: true, vx: 0, vy: 0 });
    me.max = maxHp(me); me.hp = me.max;
    C.place(world, me);
    C.gainXp(world, me, keep);
    me.hp = me.max; me.shield = 5;
    cam.x = me.x; cam.y = me.y;
  }

  function pubEvent(from, type, d) {
    if (state !== 'play' || netMode !== 'pub') return;
    if (type === 'f') {
      for (const v of (Array.isArray(d?.s) ? d.s : []).slice(0, 120)) {
        const owner = pub.byNid.get(v[0]);
        if (!owner || !owner.remote) continue;
        const [x, y, vx, vy, r, dmg, life, pierce] = v.slice(1).map(Number);
        if (![x, y, vx, vy].every(isFinite)) continue;
        world.shots.push({ x, y, vx, vy, r: clamp(r, 1, 14), dmg: clamp(dmg, 0, 100), life: clamp(life, 0, 3), owner, pierce: clamp(pierce | 0, 1, 3), color: owner.color });
      }
      for (const [id, n] of (Array.isArray(d?.h) ? d.h : []).slice(0, 60)) {
        const sh = world.shapes.find(x => x.id === id);
        if (!sh || sh.dead) continue;
        sh.hitT = 0.08;
        sh.hp -= clamp(+n || 0, 0, 200);
        if (sh.hp <= 0) C.killShape(world, sh, null);
      }
    } else if (type === 'dead') {
      const t = pub.byNid.get('p' + from);
      if (t) { t.deaths = Math.max(t.deaths + 1, d?.d | 0); if (t.alive) explode(t); t.alive = false; }
      const xp = Math.round(clamp(+d?.xp || 0, 0, 1e7) * 0.5) + 50;
      if (d?.by === me.nid) {
        C.gainXp(world, me, xp);
        kills++;
        if (t) floats.add(`${t.name} destroyed! +${xp}`, t.x, t.y - 30, { color: '#ffd23f', size: 18 });
        shake.add(0.3);
        Arcade.flag('tankfield-kill');
        if (kills >= 5) Arcade.flag('tankfield-five');
      } else if (pubAuth() && typeof d?.by === 'string' && d.by[0] === 'b') {
        const b = pub.byNid.get(d.by);
        if (b && !b.remote && b.alive) C.gainXp(world, b, xp);
      }
    } else if (type === 'kill') {
      const xp = clamp(d?.xp | 0, 0, 1e7);
      C.gainXp(world, me, xp);
      kills++;
      floats.add(`${String(d?.name || 'Tank').slice(0, 24)} destroyed! +${xp}`, me.x, me.y - 50, { color: '#ffd23f', size: 18 });
      shake.add(0.3);
      Arcade.flag('tankfield-kill');
      if (kills >= 5) Arcade.flag('tankfield-five');
    } else if (type === 'raid' && from === pub.lobby.authority) {
      raidOver({ won: !!d?.won, xp: d?.xp || {} });
    }
  }

  function syncRemote(t, dt) {
    const st = t.net;
    if (!st) return;
    if (t.nid[0] === 'p') {
      const wasAlive = t.alive;
      t.alive = !!st.al && (st.d | 0) >= t.deaths;
      if (!wasAlive && t.alive) { t.x = st.x; t.y = st.y; }
      t.level = clamp(st.l | 0, 1, 45);
      t.max = Math.max(1, st.m | 0); t.hp = clamp(st.h | 0, 0, t.max);
      if (TURRETS[st.u]) t.turret = st.u;
      t.xp = Math.max(0, st.p | 0);
      readStats(t, st.st);
      t.shield = st.sh ? 1 : 0;
    }
    const lag = Math.min(0.15, (performance.now() - st.at) / 1000);
    const tx = st.x + (st.vx || 0) * lag, ty = st.y + (st.vy || 0) * lag;
    if (Math.hypot(tx - t.x, ty - t.y) > 250) { t.x = tx; t.y = ty; }
    else { t.x = Gfx.approach(t.x, tx, 14, dt); t.y = Gfx.approach(t.y, ty, 14, dt); }
    t.x = clamp(t.x, 0, AW); t.y = clamp(t.y, 0, AH);
    t.vx = st.vx || 0; t.vy = st.vy || 0;
    t.a += angDiff(+st.a || 0, t.a) * Math.min(1, dt * 20);
  }

  function updatePub(dt) {
    const L = pub.lobby;
    pub.sendT -= dt; pub.flushT -= dt; pub.worldT -= dt; pub.shapesT -= dt;
    me.shield = Math.max(0, (me.shield || 0) - dt);
    if (!me.alive) { pub.respawnT -= dt; if (pub.respawnT <= 0) pubRespawn(); }
    if (pub.sendT <= 0) {
      pub.sendT = 0.05;
      L.state({ x: r1(me.x), y: r1(me.y), vx: r1(me.vx), vy: r1(me.vy), a: Math.round(me.a * 100) / 100, h: Math.round(Math.max(0, me.hp)), m: Math.round(me.max), l: me.level, u: me.turret,
        p: Math.floor(me.xp), st: statStr(me), al: me.alive ? 1 : 0, d: me.deaths, sh: me.shield > 0 ? 1 : 0 });
    }
    if (pub.flushT <= 0 && (pub.shots.length || pub.hits.length)) {
      pub.flushT = 0.05;
      L.send('f', { s: pub.shots.splice(0, 120), h: pub.hits.splice(0, 60) });
    }
    if (L.isAuthority) {
      const c = L.clock() / 1000, k = Math.floor(c / RAID_EVERY);
      if (!boss && k > pub.bossK && bossWeights !== undefined) { pub.bossK = k; spawnRaid(); }
      if (raidOn() && c > pub.bossEnd) endRaid(false);
      if (pub.worldT <= 0) { pub.worldT = 0.1; sendWorld(); }
    }
    for (const t of world.tanks) if (t.remote) syncRemote(t, dt);
  }

  function drawPubHud() {
    const c = pub.lobby.clock() / 1000;
    Gfx.card(ctx, W / 2 - 160, 10, 320, raidOn() ? 46 : 36);
    if (raidOn()) {
      const t = boss.tank, left = Math.max(0, pub.bossEnd - c);
      Gfx.text(ctx, `SOVEREIGN RAID · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} left`, W / 2, 24, { size: 13, stroke: null, color: '#ffd23f' });
      Gfx.bar(ctx, W / 2 - 145, 34, 290, 10, Math.max(0, t.hp) / t.max, '#ffd23f');
    } else {
      const next = Math.max(0, (pub.bossK + 1) * RAID_EVERY - c);
      Gfx.text(ctx, `Public lobby · ${pub.lobby.names.size} player${pub.lobby.names.size === 1 ? '' : 's'}`, W / 2, 22, { size: 12, stroke: null, color: '#fff' });
      Gfx.text(ctx, `Sovereign raid in ${Math.floor(next / 60)}:${String(Math.floor(next % 60)).padStart(2, '0')}`, W / 2, 37, { size: 11, stroke: null, color: next < 30 ? '#ffd23f' : '#cfd8dc' });
    }
    if (!me.alive) Gfx.text(ctx, `Back in ${Math.ceil(pub.respawnT)}…`, W / 2, H / 2 - 40, { size: 22 });
  }

  function pubPause() {
    ui.show({
      title: 'Menu',
      html: `<p>The lobby keeps going while this is open.</p><p>Level ${me.level} ${T(me).name} · ${kills} tank${kills === 1 ? '' : 's'} destroyed</p>
        <div class="menu"><button class="btn secondary" type="button" data-quit>Leave the lobby</button></div>`,
      button: 'Back in',
      onAction: () => ui.hide(),
      onRender: p => p.querySelector('[data-quit]').addEventListener('click', showMenu),
    });
  }

  function pubGone() {
    if (netMode !== 'pub') return;
    pub = null;
    state = 'over';
    netMode = null;
    ui.show({ title: 'Connection lost', html: '<p>Lost the connection to the game server.</p>', button: 'Back to menu', onAction: showMenu });
  }

  // ---------- Menu ----------

  const INTRO_HTML = `<p>Shoot shapes for experience, level up, and outgrow the rival tanks before they come for you. One life.</p>
        <ul style="text-align:left;font-size:14px"><li><b>WASD</b> or arrows to drive. <b>Auto-aim</b> fires at the nearest target by itself (<b>Q</b> switches to aiming and firing with the mouse; <b>E</b> turns auto-fire off).</li>
        <li>Each level gives a point: press <b>1-7</b> to upgrade Armor, Repair, Ram, Shot speed, Shot power, Reload or Engine.</li>
        <li>At levels 10 and 20 you pick a new turret. Big purple shapes in the middle are worth the most.</li></ul>`;
  const attachOpts = {
    ui, start, score: () => (me && netMode !== 'live' ? Math.floor(me.xp) : 0),
    intro: {
      title: '🛡️ Tankfield',
      get html() {
        const lobby = PublicLobby.enabled ? `<p class="za-label" style="margin-top:10px">Public lobby: drop into a shared arena with real players and bots. Sovereign raids every 7½ minutes; bring him down together.</p>
          <div class="menu"><button class="btn" type="button" data-pub>Join a public lobby <span data-pub-count></span></button></div><p class="error">${pubError}</p>` : '';
        return `${INTRO_HTML}${lobby}${live.html(`Live 1v1 against a real player: same arena, no bots, first to ${LIVE_KILLS} kills`)}<p class="error" data-live-error>${liveError}</p>`;
      },
      button: 'Roll out',
      onAction: start,
      onRender: p => {
        live.wire(p); liveError = ''; pubError = '';
        p.querySelector('[data-pub]')?.addEventListener('click', joinPub);
        const n = p.querySelector('[data-pub-count]');
        if (n) PublicLobby.count(ID).then(c => { if (c && n.isConnected) n.textContent = `· ${c} playing`; });
      },
    },
  };
  function showMenu() {
    state = 'menu';
    netMode = null;
    rival = null;
    live.leave();
    leavePub();
    boss = null; world.truce = null;
    world.tanks = []; world.shots = []; world.pending = []; world.events.length = 0;
    Versus.attach(attachOpts);
  }

  updateHud();
  const liveInvite = Live.invite('tank');
  Versus.attach(attachOpts);
  if (liveInvite) live.connect('public', liveInvite);
  // Console handle for testing (only with #dev in the address).
  if (location.hash === '#dev') window.__tank = { get me() { return me; }, get boss() { return boss; }, get world() { return world; }, get pub() { return pub; }, spawnBoss, spawnRaid: () => spawnRaid() };
  requestAnimationFrame(frame);
})();