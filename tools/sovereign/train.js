'use strict';
/*
 * tools/sovereign/train.js: trains Sovereign with PPO. DEV ONLY.
 *
 *   node tools/sovereign/train.js --game=tankfield --run=<name> [--iters=N] [--hours=H]
 *        [--workers=K] [--steps=S] [--from=<ckpt>] [--fresh]
 *
 * Each iteration every worker thread plays whole headless duels (tankfield/env.js) with the
 * current weights until it has --steps decisions, then the PyTorch sidecar (nn/torch_ppo.py)
 * runs values, GAE and the PPO epochs, and the new weights go back out. Both nets carry a
 * 64-unit GRU, so the update always runs on torch.
 *
 * Opponents per match: 40% scripted styles (the switcher is at least 15% of all matches),
 * 30% self-play against a random snapshot, 30% hall of fame (runs/<name>/hof.json, Task 8's
 * exam fills it). With no hall of fame yet, that 30% goes to styles.
 *
 * Writes runs/<name>/latest.json every iteration, snapshots/iter-<n>.json every 25, and one
 * log.jsonl line per iteration. A run with a latest.json resumes unless --fresh.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const LAB = __dirname, ROOT = path.resolve(LAB, '..', '..');
const loadJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };

if (!isMainThread) worker();
else main().catch(e => { console.error('[sovereign]', e && e.stack || e); process.exit(1); });

// ── Rollout worker: plays matches with the weights it is sent ───────────────────────────
function worker() {
  const Sov = require(path.join(ROOT, 'assets/js/sovereign.js'));
  const { runEpisode } = require('./tankfield/env.js');
  const nets = new Map();   // opponent weights by key, loaded once
  const netOf = (key, json) => { if (!nets.has(key)) nets.set(key, Sov.loadNet(json)); return nets.get(key); };
  parentPort.on('message', msg => {
    if (msg.type === 'opps') { for (const [k, j] of msg.nets) netOf(k, j); return; }
    const pi = Sov.loadNet(msg.pi);
    const out = { obs: [], acts: [], logps: [], rews: [], episodes: [] };
    let n = 0, k = 0;
    while (n < msg.steps) {
      const spec = msg.plan[k % msg.plan.length];
      const opponent = spec.kind === 'net' ? { kind: 'net', net: spec.key === 'current' ? pi : nets.get(spec.key), greedy: false }
        : spec.kind === 'style' ? { kind: 'style', name: spec.name } : { kind: 'idle' };
      const r = runEpisode({ seed: (msg.seed + k * 7919) >>> 0, sovNet: pi, opponent, maxT: msg.maxT });
      k++;
      if (!r.len) continue;
      out.obs.push(r.obs); out.acts.push(r.acts); out.logps.push(r.logps); out.rews.push(r.rews);
      let ret = 0; for (const x of r.rews) ret += x;
      out.episodes.push({ len: r.len, label: spec.label, outcome: r.outcome, ret });
      n += r.len;
    }
    const cat = (parts, T) => { let L = 0; for (const p of parts) L += p.length; const a = new T(L); let o = 0; for (const p of parts) { a.set(p, o); o += p.length; } return a; };
    const res = { obs: cat(out.obs, Float32Array), acts: cat(out.acts, Int32Array), logps: cat(out.logps, Float32Array), rews: cat(out.rews, Float32Array), episodes: out.episodes };
    parentPort.postMessage(res, [res.obs.buffer, res.acts.buffer, res.logps.buffer, res.rews.buffer]);
  });
}

// ── Trainer ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }));
  if ((args.game || 'tankfield') !== 'tankfield') throw new Error('only --game=tankfield exists so far');
  if (!args.run || args.run === true) throw new Error('--run=<name> is required');
  const WORKERS = parseInt(args.workers, 10) || Math.max(1, os.cpus().length - 2);
  const STEPS = parseInt(args.steps, 10) || 8000;           // decisions per worker per iteration
  const MAX_IT = parseInt(args.iters, 10) || Infinity;
  const HOURS = parseFloat(args.hours) || Infinity;
  const MAX_T = 120;
  const DIR = path.join(LAB, 'runs', String(args.run)), SNAPS = path.join(DIR, 'snapshots');
  const log = (...a) => console.log('[sovereign]', ...a);
  fs.mkdirSync(SNAPS, { recursive: true });

  const { MLP } = require('./nn/ppo.js');
  const { TorchPPO } = require('./nn/torch_client.js');
  const IO = require(path.join(ROOT, 'games/tankfield/sovereign-io.js'));
  const HEADS = IO.HEADS, A = HEADS.reduce((a, b) => a + b, 0), H = HEADS.length, D = IO.OBS_DIM;
  const CFG = { HEADS, gamma: 0.99, lambda: 0.95, clip: 0.2, epochs: 4, mb: 2048, entCoef: 0.01, maxGrad: 0.5, seqLen: 128 };
  // The owner's decaying-change rule: steps shrink as training goes on, so a long run settles.
  const lrAt = it => 3e-4 * Math.max(0.1, 0.5 ** (it / 400));
  const klAt = it => 0.03 * Math.max(0.2, 0.5 ** (it / 400));

  // Nets: resume, start from --from, or fresh.
  const saveJSON = (p, v) => { const t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, p); };
  const ckPath = path.join(DIR, 'latest.json'), logPath = path.join(DIR, 'log.jsonl');
  let ck = !args.fresh && loadJSON(ckPath, null), iter = 0, pi, vf;
  if (ck) { iter = ck.iter; log(`resuming ${args.run} at iteration ${iter}`); }
  else if (args.from) { ck = loadJSON(path.resolve(ROOT, args.from), null); if (!ck) throw new Error('cannot read --from ' + args.from); log(`starting from ${args.from}`); }
  if (ck) { pi = MLP.fromJSON(ck.pi); vf = MLP.fromJSON(ck.vf); }
  else {
    pi = new MLP([D, 128, 128, A], 0.01).addGru(64);
    vf = new MLP([D, 128, 128, 1], 1).addGru(64);
    if (fs.existsSync(logPath)) fs.renameSync(logPath, logPath.replace('.jsonl', `-${Date.now()}.jsonl`));
    log('fresh start: random network');
  }
  if (pi.sizes[0] !== D) throw new Error(`checkpoint input ${pi.sizes[0]} != OBS_DIM ${D}`);

  const torch = new TorchPPO(log);
  const h = await torch.init(pi, vf, Object.assign({}, CFG, { lr: lrAt(iter), targetKl: klAt(iter) }), Math.max(2, os.cpus().length - WORKERS), iter);
  log(`PyTorch ${h.torch} (${h.device}), ${WORKERS} workers x ${STEPS} decisions`);

  const workers = Array.from({ length: WORKERS }, () => new Worker(__filename));
  const ask = (w, msg) => new Promise((res, rej) => {
    const onMsg = m => { w.off('error', onErr); res(m); }, onErr = e => { w.off('message', onMsg); rej(e); };
    w.once('message', onMsg); w.once('error', onErr); w.postMessage(msg);
  });
  const sent = new Set();   // opponent net keys every worker already holds
  const share = nets => { const fresh = nets.filter(([k]) => !sent.has(k)); fresh.forEach(([k]) => sent.add(k)); if (fresh.length) workers.forEach(w => w.postMessage({ type: 'opps', nets: fresh })); };

  const STYLE_NAMES = ['kiter', 'rusher', 'strafer', 'sniper', 'farmer'];
  const snapList = () => fs.readdirSync(SNAPS).filter(f => /^iter-\d+\.json$/.test(f));
  const readHof = () => loadJSON(path.join(DIR, 'hof.json'), []);
  // One match's opponent, by the opponent mix.
  function pickOpponent(hof, snaps) {
    const r = Math.random();
    const style = () => {   // the styles' 40%: switcher 0.15 of all matches, idle 0.03, the rest split
      const q = Math.random() * 0.4;
      if (q < 0.15) return { kind: 'style', name: 'switcher', label: 'switcher' };
      if (q < 0.18) return { kind: 'idle', label: 'idle' };
      const name = STYLE_NAMES[Math.floor(Math.random() * STYLE_NAMES.length)];
      return { kind: 'style', name, label: name };
    };
    if (r < 0.4) return style();
    if (r < 0.7) {
      if (!snaps.length) return { kind: 'net', key: 'current', label: 'self' };
      const f = snaps[Math.floor(Math.random() * snaps.length)];
      return { kind: 'net', key: 'snap:' + f, file: path.join(SNAPS, f), label: 'self' };
    }
    if (!hof.length) return style();
    const m = hof[Math.floor(Math.random() * hof.length)];
    if (m.kind === 'style') return m.ref === 'idle' ? { kind: 'idle', label: 'idle' } : { kind: 'style', name: m.ref, label: 'hof' };
    return { kind: 'net', key: 'hof:' + m.ref, file: path.resolve(ROOT, m.ref), label: 'hof' };
  }

  let stop = false;
  process.on('SIGINT', () => { log('SIGINT: finishing this iteration then saving'); stop = true; });
  const t0 = Date.now();
  while (!stop && iter < MAX_IT && Date.now() - t0 < HOURS * 3600e3) {
    const it0 = Date.now(), lr = lrAt(iter), targetKl = klAt(iter);
    const hof = readHof(), snaps = snapList();
    // Plans: more matches than any worker will finish, picked up in order.
    const plans = workers.map(() => Array.from({ length: Math.ceil(STEPS / 200) + 4 }, () => pickOpponent(hof, snaps)));
    const need = new Map();
    for (const p of plans.flat()) if (p.kind === 'net' && p.key !== 'current' && !sent.has(p.key) && !need.has(p.key)) {
      const j = loadJSON(p.file, null);
      if (j) need.set(p.key, j.pi || j); else { p.kind = 'idle'; p.label = 'idle'; }
    }
    share([...need]);
    const piJSON = pi.toJSON();
    const results = await Promise.all(workers.map((w, i) => ask(w, {
      pi: piJSON, steps: STEPS, maxT: MAX_T, plan: plans[i].map(({ kind, key, name, label }) => ({ kind, key, name, label })),
      seed: (iter * 1000003 + i * 10007 + 1) >>> 0,
    })));
    const tRoll = Date.now() - it0;

    // Batch for the sidecar. Every match ends in a win, loss or timeout (reward 0), so none is truncated.
    let N = 0; for (const r of results) N += r.rews.length;
    const b = { N, D, H, obs: new Float32Array(N * D), acts: new Int32Array(N * H), logps: new Float32Array(N), rews: new Float32Array(N), episodes: [] };
    const byLabel = {};
    let o = 0, retSum = 0, eps = 0;
    for (const r of results) {
      b.obs.set(r.obs, o * D); b.acts.set(r.acts, o * H); b.logps.set(r.logps, o); b.rews.set(r.rews, o);
      for (const e of r.episodes) {
        b.episodes.push({ start: o, len: e.len, trunc: false });
        o += e.len; retSum += e.ret; eps++;
        const s = byLabel[e.label] || (byLabel[e.label] = { n: 0, win: 0, loss: 0 });
        s.n++; if (e.outcome === 'win') s.win++; else if (e.outcome === 'loss') s.loss++;
      }
    }
    const upd = await torch.update(pi, vf, b, iter, { lr, targetKl });
    iter++;

    const ckpt = { iter, pi: pi.toJSON(), vf: vf.toJSON(), cfg: CFG, lr, hof };
    saveJSON(ckPath, ckpt);
    if (iter % 25 === 0) saveJSON(path.join(SNAPS, `iter-${iter}.json`), { iter, pi: ckpt.pi });
    const winRate = Object.fromEntries(Object.entries(byLabel).map(([k, s]) => [k, +(s.win / s.n).toFixed(3)]));
    const games = Object.fromEntries(Object.entries(byLabel).map(([k, s]) => [k, s.n]));
    const line = { iter, at: new Date().toISOString(), decisions: N, episodes: eps, winRate, games, meanReward: +(retSum / Math.max(1, eps)).toFixed(4),
      kl: +upd.kl.toFixed(5), lr, targetKl, epochs: upd.epochs, pl: upd.pl, vl: upd.vl, ent: upd.ent, clipFrac: upd.clipFrac, lpErr: upd.lpErr,
      tRoll, tUpd: Date.now() - it0 - tRoll };
    fs.appendFileSync(logPath, JSON.stringify(line) + '\n');
    log(`it ${iter}: ${N} dec, ${eps} eps, ret ${line.meanReward}, kl ${line.kl}, ent ${upd.ent.toFixed(3)}, win ${JSON.stringify(winRate)} (${tRoll} + ${line.tUpd} ms)`);
  }
  torch.close();
  await Promise.all(workers.map(w => w.terminate()));
  log(`stopped at iteration ${iter}`);
}
