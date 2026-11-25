'use strict';
/*
 * tools/sovereign/exam.js: the promotion exam. DEV ONLY.
 *
 *   node tools/sovereign/exam.js --game=tankfield --cand=<ckpt> [--live=games/tankfield/sovereign/latest.json] [--games=40] [--workers=K]
 *
 * Greedy Sovereign (candidate, and live if there is one) plays every hall of fame member at
 * --games seeds, then candidate and live play 2 x --games head-to-head, swapping spawn sides.
 * PASS needs both:
 *   - no member wins more than 5 points more often against the candidate than against live;
 *   - the candidate wins at least 55% head-to-head.
 * With no live version yet, only the first part applies (and nothing can regress).
 *
 * The hall of fame lives beside the candidate (runs/<name>/hof.json). It starts with every
 * style; any member or recent snapshot that beats the candidate more than 45% of the time is
 * kept, up to 24, dropping the weakest first. The report goes to tools/sovereign/reports/.
 */
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { Worker, isMainThread, parentPort } = require('worker_threads');

const LAB = __dirname, ROOT = path.resolve(LAB, '..', '..');
const HOF_CAP = 24, HOF_ADD = 0.45, MAX_REGRESS = 0.05, H2H_MIN = 0.55;
const STYLE_IDS = ['kiter', 'rusher', 'strafer', 'sniper', 'farmer', 'switcher'];

// results: { hof: [{ id, vsLive: rate | null, vsCand: rate }], h2h: rate | null }.
// Rates are the member's win rate against that Sovereign; h2h is the candidate's against live.
function examVerdict({ hof, h2h }) {
  const reasons = [];
  for (const m of hof) {
    if (m.vsLive == null) continue;
    if (m.vsCand - m.vsLive > MAX_REGRESS + 1e-9) reasons.push(`${m.id} wins ${pct(m.vsCand)} against the candidate vs ${pct(m.vsLive)} against live`);
  }
  if (h2h != null && h2h < H2H_MIN) reasons.push(`head-to-head ${pct(h2h)} < ${pct(H2H_MIN)}`);
  return { pass: reasons.length === 0, reasons };
}
const pct = x => `${Math.round(x * 1000) / 10}%`;

const initialHof = () => STYLE_IDS.map(s => ({ id: 'style:' + s, kind: 'style', ref: s, bestWinRateVsSov: 0 }));

// tried: [{ id, kind, ref, winRate }] played against the current Sovereign this exam. Styles always
// stay; others join above 45% and the strongest 24 are kept.
function updateHof(hof, tried) {
  const by = new Map(hof.map(m => [m.id, Object.assign({}, m)]));
  for (const t of tried) {
    const m = by.get(t.id);
    if (m) m.bestWinRateVsSov = t.winRate;
    else if (t.winRate > HOF_ADD) by.set(t.id, { id: t.id, kind: t.kind, ref: t.ref, bestWinRateVsSov: t.winRate });
  }
  const all = [...by.values()];
  const styles = all.filter(m => m.kind === 'style');
  const rest = all.filter(m => m.kind !== 'style').sort((a, b) => b.bestWinRateVsSov - a.bestWinRateVsSov);
  return styles.concat(rest).slice(0, Math.max(HOF_CAP, styles.length));
}

// ── Game worker ─────────────────────────────────────────────────────────────────────────
// nets: { key: { pi, build|null } } sent once. job: { sov, opp: {kind, name|key}, seed, swap, sovFirst }.
function worker() {
  const Sov = require(path.join(ROOT, 'assets/js/sovereign.js'));
  const Core = require(path.join(ROOT, 'games/tankfield/core.js'));
  const IO = require(path.join(ROOT, 'games/tankfield/sovereign-io.js'));
  const { runEpisode, mulberry32 } = require('./tankfield/env.js');
  const { styleBuild } = require('./tankfield/styles.js');
  const BUILD_STYLES = STYLE_IDS.filter(s => s !== 'switcher');
  const nets = {};
  const features = build => {
    if (!build) return new Float32Array(IO.BUILD_IN);
    const w = Core.createWorld({ rng: mulberry32(1), shapes: 0 }), t = Core.makeTank(w, { name: 'x', color: '#000' });
    IO.applyBuild(w, t, build); return IO.buildFeatures(t);
  };
  const greedyBuild = (n, oppBuild) => { const b = IO.chooseBuild(n.build, features(oppBuild), Math.random, true); return { path: IO.BUILD_PATHS[b.path], alloc: b.alloc }; };
  parentPort.on('message', msg => {
    if (msg.type === 'nets') { for (const [k, v] of Object.entries(msg.nets)) nets[k] = { pi: Sov.loadNet(v.pi), build: v.build ? Sov.loadNet(v.build) : null }; return; }
    const out = msg.jobs.map(j => {
      const rng = mulberry32((j.seed ^ 0x5bd1e995) >>> 0), sov = nets[j.sov];
      const randomStyle = () => styleBuild(rng, BUILD_STYLES[Math.floor(rng() * BUILD_STYLES.length)]);
      let oppBuild, sovBuild, opponent;
      if (j.opp.kind === 'net') {
        const o = nets[j.opp.key];
        opponent = { kind: 'net', net: o.pi, greedy: true };
        if (!o.build) { oppBuild = randomStyle(); sovBuild = greedyBuild(sov, oppBuild); }
        else if (j.sovFirst) { sovBuild = greedyBuild(sov, null); oppBuild = greedyBuild(o, sovBuild); }
        else { oppBuild = greedyBuild(o, null); sovBuild = greedyBuild(sov, oppBuild); }
      } else {
        opponent = j.opp.kind === 'idle' ? { kind: 'idle' } : { kind: 'style', name: j.opp.name };
        oppBuild = j.opp.kind === 'style' && j.opp.name !== 'switcher' ? styleBuild(rng, j.opp.name) : randomStyle();
        sovBuild = greedyBuild(sov, oppBuild);
      }
      return runEpisode({ seed: j.seed, sovNet: sov.pi, sovGreedy: true, opponent, oppBuild, sovBuild, swapSides: !!j.swap, maxT: 120 }).outcome;
    });
    parentPort.postMessage(out);
  });
}

async function runJobs(nets, jobs, nWorkers) {
  const ws = Array.from({ length: Math.min(nWorkers, jobs.length) || 1 }, () => new Worker(__filename));
  ws.forEach(w => w.postMessage({ type: 'nets', nets }));
  const results = new Array(jobs.length);
  let next = 0;
  const CHUNK = 4;
  await Promise.all(ws.map(w => (async () => {
    while (next < jobs.length) {
      const a = next; next = Math.min(jobs.length, next + CHUNK);
      const chunk = jobs.slice(a, next);
      const out = await new Promise((res, rej) => {
        const onMsg = m => { w.off('error', onErr); res(m); }, onErr = e => { w.off('message', onMsg); rej(e); };
        w.once('message', onMsg); w.once('error', onErr); w.postMessage({ jobs: chunk });
      });
      out.forEach((o, i) => { results[a + i] = o; });
    }
  })()));
  await Promise.all(ws.map(w => w.terminate()));
  return results;
}

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const loadJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }));
  if ((args.game || 'tankfield') !== 'tankfield') throw new Error('only --game=tankfield exists so far');
  if (!args.cand || args.cand === true) throw new Error('--cand=<ckpt> is required');
  const G = parseInt(args.games, 10) || 40, W = parseInt(args.workers, 10) || Math.max(1, os.cpus().length - 1);
  const candPath = path.resolve(args.cand), cand = loadJSON(candPath, null);
  if (!cand || !cand.pi) throw new Error('cannot read candidate ' + candPath);
  const livePath = path.resolve(ROOT, args.live || 'games/tankfield/sovereign/latest.json');
  const live = loadJSON(livePath, null);
  const runDir = path.dirname(candPath), hofPath = path.join(runDir, 'hof.json');
  const hof = loadJSON(hofPath, null) || initialHof();

  // Members, plus the run's four newest snapshots as hall of fame hopefuls.
  const snapDir = path.join(runDir, 'snapshots');
  const snaps = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).filter(f => /^iter-\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10)).slice(-4) : [];
  const nets = { cand: { pi: cand.pi, build: cand.build || null } };
  if (live) nets.live = { pi: live.pi, build: live.build || null };
  const opps = [];
  for (const m of hof) {
    if (m.kind === 'style') opps.push({ id: m.id, kind: 'style', ref: m.ref, opp: m.ref === 'idle' ? { kind: 'idle' } : { kind: 'style', name: m.ref } });
    else { const j = loadJSON(path.resolve(ROOT, m.ref), null); if (!j) continue; nets[m.id] = { pi: j.pi || j, build: j.build || null }; opps.push({ id: m.id, kind: m.kind, ref: m.ref, opp: { kind: 'net', key: m.id } }); }
  }
  for (const f of snaps) {
    const id = 'snap:' + path.basename(runDir) + '/' + f;
    if (opps.some(o => o.id === id)) continue;
    const ref = path.relative(ROOT, path.join(snapDir, f)), j = loadJSON(path.join(snapDir, f), null);
    nets[id] = { pi: j.pi, build: j.build || null };
    opps.push({ id, kind: 'net', ref, opp: { kind: 'net', key: id }, hopeful: true });
  }
  const jobs = [];
  for (const o of opps) for (const sovKey of live ? ['cand', 'live'] : ['cand'])
    for (let s = 0; s < G; s++) jobs.push({ tag: [o.id, sovKey], sov: sovKey, opp: o.opp, seed: 9001 + s * 104729 });
  if (live) for (let s = 0; s < 2 * G; s++) jobs.push({ tag: ['h2h'], sov: 'cand', opp: { kind: 'net', key: 'live' }, seed: 7001 + s * 15485863, swap: s % 2 === 1, sovFirst: s % 2 === 1 });

  console.log(`[exam] ${opps.length} opponents x ${G} games${live ? ` against candidate and live v${live.v}, plus ${2 * G} head-to-head` : ' (no live version yet)'}, ${jobs.length} games on ${W} workers`);
  const t0 = Date.now();
  const outcomes = await runJobs(nets, jobs.map(({ tag, ...j }) => j), W);
  const tally = {};
  jobs.forEach((j, i) => { const k = j.tag.join('|'), t = tally[k] || (tally[k] = { n: 0, sovWin: 0, sovLoss: 0 }); t.n++; if (outcomes[i] === 'win') t.sovWin++; else if (outcomes[i] === 'loss') t.sovLoss++; });
  const rateVs = (id, key) => { const t = tally[id + '|' + key]; return t ? t.sovLoss / t.n : null; };
  const rows = opps.map(o => ({ id: o.id, kind: o.kind, ref: o.ref, hopeful: !!o.hopeful, vsCand: rateVs(o.id, 'cand'), vsLive: live ? rateVs(o.id, 'live') : null }));
  const h2h = live ? tally.h2h.sovWin / tally.h2h.n : null;
  // Hopefuls (snapshots not yet in the hall) only decide membership, not the verdict.
  const verdict = examVerdict({ hof: rows.filter(r => !r.hopeful), h2h });
  const newHof = updateHof(hof, rows.map(r => ({ id: r.id, kind: r.kind, ref: r.ref, winRate: r.vsCand })));
  fs.writeFileSync(hofPath, JSON.stringify(newHof, null, 1));

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = path.resolve(args.reports || path.join(LAB, 'reports'));
  fs.mkdirSync(reportsDir, { recursive: true });
  const md = [
    `# Sovereign exam ${ts}`, '',
    `Candidate: ${candPath}`, `SHA256: ${sha(candPath)}`, `Iteration: ${cand.iter ?? '?'}`,
    `Live: ${live ? `v${live.v} (${livePath})` : 'none'}`, `Games per opponent: ${G}`, '',
    '| Opponent | Win rate vs live | Win rate vs candidate | Change |', '|---|---|---|---|',
    ...rows.map(r => `| ${r.id}${r.hopeful ? ' (hopeful)' : ''} | ${r.vsLive == null ? 'n/a' : pct(r.vsLive)} | ${pct(r.vsCand)} | ${r.vsLive == null ? '' : (r.vsCand >= r.vsLive ? '+' : '') + pct(r.vsCand - r.vsLive)} |`),
    '', `Head-to-head (candidate vs live): ${h2h == null ? 'n/a' : pct(h2h)}`,
    `Hall of fame after this exam: ${newHof.length} members`, '',
    ...verdict.reasons.map(r => `- ${r}`), '',
    `Verdict: ${verdict.pass ? 'PASS' : 'FAIL'}`, '',
  ].join('\n');
  const rp = path.join(reportsDir, `exam-${ts}.md`);
  fs.writeFileSync(rp, md);
  console.log(`[exam] ${((Date.now() - t0) / 1000).toFixed(0)} s, report ${path.relative(process.cwd(), rp)}`);
  for (const r of verdict.reasons) console.log('  ' + r);
  console.log(verdict.pass ? 'PASS' : 'FAIL');
}

if (!isMainThread) worker();
else if (require.main === module) main().catch(e => { console.error('[exam]', e && e.stack || e); process.exit(1); });

module.exports = { examVerdict, updateHof, initialHof, HOF_CAP, STYLE_IDS };
