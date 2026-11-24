'use strict';
// Headless Tankfield duel for the training lab: Sovereign against a scripted style, a net
// (self-play, hall of fame, clone) or a tank that stands still. Fixed 60 Hz, one decision
// per REPEAT frames, the last controls held in between.
const Core = require('../../../games/tankfield/core.js');
const IO = require('../../../games/tankfield/sovereign-io.js');
const Sov = require('../../../assets/js/sovereign.js');
const { STYLES, styleBuild } = require('./styles.js');
const { AW, AH } = Core;

const DT = 1 / 60;
const DMG_SCALE = 400, KILL_REWARD = 3;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLE_NAMES = Object.keys(STYLES);

// Two non-bot tanks 700 px apart near the centre, facing each other, builds applied.
function makeDuel({ seed, sovBuild, oppBuild, shapes = 70, rng } = {}) {
  rng = rng || mulberry32(seed);
  const world = Core.createWorld({ rng, shapes });
  const sov = Core.makeTank(world, { name: 'Sovereign', color: '#ff4fd8' });
  const opp = Core.makeTank(world, { name: 'Rival', color: '#4fc3ff' });
  world.tanks.push(sov, opp);
  sov.x = AW / 2 - 350; opp.x = AW / 2 + 350;
  sov.y = opp.y = AH / 2;
  sov.a = 0; opp.a = Math.PI;
  const pick = () => styleBuild(rng, STYLE_NAMES[Math.floor(rng() * STYLE_NAMES.length)]);
  IO.applyBuild(world, sov, sovBuild || pick());
  IO.applyBuild(world, opp, oppBuild || pick());
  return { world, sov, opp };
}

function runEpisode({ seed, sovNet, sovGreedy = false, opponent, maxT = 120, memWipeEvery = 0, histOff = false, sovBuild, oppBuild, sovStyle }) {
  const rng = mulberry32(seed);
  const sovRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);   // sampling streams stay apart from world rolls
  const oppRng = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  opponent = opponent || { kind: 'idle' };
  if (!oppBuild && opponent.kind === 'style') oppBuild = styleBuild(rng, opponent.name);
  if (sovStyle && !sovBuild) sovBuild = styleBuild(rng, sovStyle);
  const { world, sov, opp } = makeDuel({ seed, sovBuild, oppBuild, rng });

  const OD = IO.OBS_DIM, NH = IO.HEADS.length;
  const obsBuf = new Float32Array(OD), oppObs = new Float32Array(OD);
  const sovH = Sov.newState(sovNet), oppNet = opponent.kind === 'net' ? opponent.net : null;
  const oppH = Sov.newState(oppNet);
  const sovPrev = new Int32Array(NH), oppPrev = new Int32Array(NH), zeroPrev = new Int32Array(NH);
  const sovAct = new Int32Array(NH), oppAct = new Int32Array(NH);
  const mem = {}, sovMem = {};
  const style = opponent.kind === 'style' ? STYLES[opponent.name] : null;
  if (opponent.kind === 'style' && !style) throw new Error('unknown style ' + opponent.name);

  const obs = [], acts = [], logps = [], rews = [];
  const stats = { dmgDealt: 0, dmgTaken: 0, t: 0 };
  let outcome = 'timeout', ended = false, decisions = 0;
  const controls = new Map();
  const maxSteps = Math.round(maxT / DT);
  let steps = 0;

  while (!ended && steps < maxSteps) {
    // Decide.
    IO.observe(world, sov, opp, histOff ? zeroPrev : sovPrev, obsBuf);
    let logp = 0, sc;
    if (sovStyle) {   // sanity checks only: a script plays Sovereign's tank, the net is unused
      sc = STYLES[sovStyle](world, sov, opp, DT, sovMem);
    } else {
      const logits = Sov.forward(sovNet, obsBuf, sovH);
      logp = Sov.sample(logits, IO.HEADS, sovAct, sovGreedy, sovRng);
      sovPrev.set(sovAct);
      sc = IO.applyAction(world, sov, opp, sovAct, DT);
    }
    for (let i = 0; i < OD; i++) obs.push(obsBuf[i]);
    for (let i = 0; i < NH; i++) acts.push(sovAct[i]);
    logps.push(logp);
    let oc;
    if (opponent.kind === 'net') {
      IO.observe(world, opp, sov, oppPrev, oppObs);
      const ol = Sov.forward(oppNet, oppObs, oppH);
      Sov.sample(ol, IO.HEADS, oppAct, !!opponent.greedy, oppRng);
      oppPrev.set(oppAct);
      oc = IO.applyAction(world, opp, sov, oppAct, DT);
    } else if (style) {
      oc = style(world, opp, sov, DT, mem);
    } else {
      oc = { mx: 0, my: 0, aim: opp.a, fire: false };
    }
    decisions++;
    // Hold those controls for REPEAT frames.
    let r = 0;
    controls.set(sov, sc); controls.set(opp, oc);
    for (let k = 0; k < IO.REPEAT && !ended && steps < maxSteps; k++, steps++) {
      for (const [t, c] of [[sov, sc], [opp, oc]]) t.a += angDiff(c.aim, t.a) * Math.min(1, DT * 12);
      Core.step(world, DT, controls, { spawnShapes: true });
      for (const e of world.events) {
        if (e.type === 'hit') {
          if (e.target === opp && e.by === sov) { r += e.n; stats.dmgDealt += e.n; }
          else if (e.target === sov && e.by === opp) { r -= e.n; stats.dmgTaken += e.n; }
        } else if (e.type === 'tankKilled') {
          if (e.t === sov) { r -= KILL_REWARD * DMG_SCALE; outcome = 'loss'; ended = true; }
          else if (e.t === opp) { r += KILL_REWARD * DMG_SCALE; if (outcome !== 'loss') outcome = 'win'; ended = true; }
        }
      }
      world.events.length = 0;
    }
    rews.push(r / DMG_SCALE);
    if (memWipeEvery > 0 && decisions % memWipeEvery === 0 && sovH) sovH.fill(0);
  }
  stats.t = world.time;
  stats.decisions = decisions;
  const len = rews.length;
  const done = new Uint8Array(len);
  if (len) done[len - 1] = 1;
  return {
    obs: Float32Array.from(obs), acts: Int32Array.from(acts), logps: Float32Array.from(logps), rews: Float32Array.from(rews),
    done, outcome, len, switches: mem.switches || sovMem.switches || [], stats,
  };
}

module.exports = { DT, mulberry32, makeDuel, runEpisode };
