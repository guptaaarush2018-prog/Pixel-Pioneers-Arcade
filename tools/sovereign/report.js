'use strict';
/*
 * tools/sovereign/report.js: the research report for a training run. DEV ONLY.
 *
 *   node tools/sovereign/report.js --run=<name> [--games=8]
 *
 * Writes tools/sovereign/reports/<run>-<ts>.md with:
 *   1. win rate per opponent over training (log.jsonl);
 *   2. memory ablation: greedy Sovereign against every style with the GRU as trained, wiped
 *      every 20 decisions, and wiped every decision (no memory);
 *   3. switch adaptation: damage exchange against the switcher in 5 s bins around each switch;
 *   4. build choices against each style's builds;
 *   5. engagement: distance bands and how often he holds the trigger.
 */
const fs = require('fs'), path = require('path');

const BINS = [[-10, -5], [-5, 0], [0, 5], [5, 10], [10, 15], [15, 20]];

// episodes: [{ perSecond: [exchange in second t], switches: [s] }]. For each bin, the mean
// exchange over every second t with switch + from <= t < switch + to that the match reached.
function switchCurve(episodes) {
  return BINS.map(([from, to]) => {
    let sum = 0, n = 0;
    for (const { perSecond, switches } of episodes) for (const s of switches) {
      for (let t = Math.ceil(s + from); t < s + to; t++) if (t >= 0 && t < perSecond.length) { sum += perSecond[t]; n++; }
    }
    return { from, to, n, mean: n ? sum / n : null };
  });
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }));
  if (!args.run || args.run === true) { console.error('[report] --run=<name> is required'); process.exit(1); }
  const G = parseInt(args.games, 10) || 8;
  const Sov = require('../../assets/js/sovereign.js'), IO = require('../../games/tankfield/sovereign-io.js'), Core = require('../../games/tankfield/core.js');
  const { runEpisode, mulberry32 } = require('./tankfield/env.js');
  const { STYLES, styleBuild } = require('./tankfield/styles.js');
  const dir = path.join(__dirname, 'runs', String(args.run));
  const ck = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  const pi = Sov.loadNet(ck.pi), bn = ck.build ? Sov.loadNet(ck.build) : null;
  const styles = Object.keys(STYLES), plain = styles.filter(s => s !== 'switcher');
  const pct = x => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
  const md = [`# Sovereign report: ${args.run}`, '', `Checkpoint iteration ${ck.iter}, ${G} greedy games per cell.`, ''];

  // 1. Training curve.
  const log = fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const labels = [...new Set(log.flatMap(l => Object.keys(l.games || {})))].sort();
  const chunk = Math.max(1, Math.ceil(log.length / 10));
  md.push('## 1. Win rate per opponent over training', '', `| Iterations | ${labels.join(' | ')} | Mean return |`, `|---|${labels.map(() => '---|').join('')}---|`);
  for (let a = 0; a < log.length; a += chunk) {
    const part = log.slice(a, a + chunk), cell = k => { let w = 0, n = 0; for (const l of part) if (l.games && l.games[k]) { w += l.winRate[k] * l.games[k]; n += l.games[k]; } return n ? pct(w / n) : '–'; };
    md.push(`| ${part[0].iter}–${part[part.length - 1].iter} | ${labels.map(cell).join(' | ')} | ${(part.reduce((s, l) => s + l.meanReward, 0) / part.length).toFixed(2)} |`);
  }

  // Shared game runner: greedy Sovereign, his greedy build against the style's build.
  const feats = b => { const w = Core.createWorld({ rng: mulberry32(1), shapes: 0 }), t = Core.makeTank(w, { name: 'x', color: '#000' }); IO.applyBuild(w, t, b); return IO.buildFeatures(t); };
  function play(style, seed, extra = {}) {
    const rng = mulberry32(seed ^ 0x51ed27), ob = styleBuild(rng, style === 'switcher' ? plain[Math.floor(rng() * plain.length)] : style);
    const c = bn ? IO.chooseBuild(bn, feats(ob), rng, true) : null;
    const sb = c ? { path: IO.BUILD_PATHS[c.path], alloc: c.alloc } : undefined;
    return { r: runEpisode({ seed, sovNet: pi, sovGreedy: true, opponent: { kind: 'style', name: style }, oppBuild: ob, sovBuild: sb, ...extra }), sb, choice: c };
  }
  const rate = (rs, o) => rs.filter(x => x.r.outcome === o).length / rs.length;

  // 2. Memory ablation.
  md.push('', '## 2. Memory ablation (win / loss)', '', '| Style | GRU as trained | Wiped every 20 | No memory |', '|---|---|---|---|');
  const switcherRuns = [], all = {};
  for (const s of styles) {
    const cols = [0, 20, 1].map(wipe => Array.from({ length: G }, (_, i) => play(s, 4242 + i * 7919, { memWipeEvery: wipe })));
    all[s] = cols[0];
    if (s === 'switcher') switcherRuns.push(...cols[0]);
    md.push(`| ${s} | ${cols.map(c => `${pct(rate(c, 'win'))} / ${pct(rate(c, 'loss'))}`).join(' | ')} |`);
  }

  // 3. Switch adaptation.
  const DPS = 60 / IO.REPEAT;   // decisions per second
  const eps = switcherRuns.map(({ r }) => {
    const perSecond = [];
    for (let k = 0; k < r.len; k++) { const t = Math.floor(k / DPS); perSecond[t] = (perSecond[t] || 0) + (r.done[k] ? 0 : r.rews[k]) * 400; }
    return { perSecond: Array.from(perSecond, v => v || 0), switches: r.switches };
  });
  md.push('', '## 3. Adapting to the switcher', '', 'Damage dealt minus taken per second, around each style switch.', '', '| Seconds from switch | Mean exchange | Seconds sampled |', '|---|---|---|');
  for (const b of switchCurve(eps)) md.push(`| ${b.from} to ${b.to} | ${b.mean == null ? 'n/a' : b.mean.toFixed(1)} | ${b.n} |`);

  // 4. Builds.
  md.push('', '## 4. Build choices', '', '| Against | Turret paths | Mean stats (armor, repair, ram, shot speed, shot power, reload, engine) |', '|---|---|---|');
  for (const s of plain) {
    const paths = {}, stats = new Array(7).fill(0);
    for (const x of all[s]) { if (!x.sb) continue; const k = x.sb.path.join('→'); paths[k] = (paths[k] || 0) + 1; for (const i of x.sb.alloc) stats[i]++; }
    md.push(`| ${s} | ${Object.entries(paths).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(', ') || 'n/a'} | ${stats.map(v => (v / G).toFixed(1)).join(', ')} |`);
  }

  // 5. Engagement.
  md.push('', '## 5. Engagement', '', '| Style | Mean distance | < 300 px | 300–600 px | > 600 px | Trigger held |', '|---|---|---|---|---|---|');
  const OD = IO.OBS_DIM, L = IO.LAYOUT;
  for (const s of styles) {
    let d = 0, n = 0, near = 0, mid = 0, far = 0, fire = 0;
    for (const { r } of all[s]) for (let k = 0; k < r.len; k++) {
      const x = r.obs[k * OD + L.oppDist] * 1000; d += x; n++;
      if (x < 300) near++; else if (x < 600) mid++; else far++;
      fire += r.acts[k * 3 + 2];
    }
    md.push(`| ${s} | ${(d / n).toFixed(0)} px | ${pct(near / n)} | ${pct(mid / n)} | ${pct(far / n)} | ${pct(fire / n)} |`);
  }

  const out = path.join(__dirname, 'reports');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${args.run}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(file, md.join('\n') + '\n');
  console.log(`[report] ${path.relative(process.cwd(), file)}`);
}

if (require.main === module) main();
module.exports = { switchCurve, BINS };
