'use strict';
/*
 * tools/sovereign/promote.js: ships an examined checkpoint to the game. DEV ONLY.
 *
 *   node tools/sovereign/promote.js --game=tankfield --cand=<ckpt> [--reports=<dir>]
 *   node tools/sovereign/promote.js --game=tankfield --cand=<ckpt> --dev   # v0, no exam (unreleased branches only)
 *
 * Refuses unless the newest exam report for exactly this file (same path and SHA-256) says
 * PASS. Writes games/tankfield/sovereign/v<N+1>.json as { v, pi, build } (no value net) and
 * copies it to latest.json, then prints the git commands. It never commits or pushes.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const LAB = __dirname, ROOT = path.resolve(LAB, '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const fail = msg => { console.error('[promote] ' + msg); process.exit(1); };

if ((args.game || 'tankfield') !== 'tankfield') fail('only --game=tankfield exists so far');
if (!args.cand || args.cand === true) fail('--cand=<ckpt> is required');
const candPath = path.resolve(args.cand);
if (!fs.existsSync(candPath)) fail('no such file ' + candPath);
const hash = crypto.createHash('sha256').update(fs.readFileSync(candPath)).digest('hex');

if (!args.dev) {
  const dir = path.resolve(args.reports || path.join(LAB, 'reports'));
  const mine = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => /^exam-.*\.md$/.test(f)).sort().reverse()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .find(t => t.includes(`Candidate: ${candPath}\n`) && t.includes(`SHA256: ${hash}\n`));
  if (!mine || !/^Verdict: PASS$/m.test(mine)) fail(`no passing exam report for ${candPath} (run exam.js on it first)`);
}

const cand = JSON.parse(fs.readFileSync(candPath, 'utf8'));
if (!cand.pi || !cand.build) fail('candidate has no pi or build net');
const out = path.join(ROOT, 'games', args.game || 'tankfield', 'sovereign');
fs.mkdirSync(out, { recursive: true });
const versions = fs.readdirSync(out).map(f => /^v(\d+)\.json$/.exec(f)).filter(Boolean).map(m => +m[1]);
const v = args.dev ? 0 : Math.max(0, ...versions) + 1;
const body = JSON.stringify({ v, pi: cand.pi, build: cand.build });
const file = path.join(out, `v${v}.json`);
fs.writeFileSync(file, body);
fs.writeFileSync(path.join(out, 'latest.json'), body);
const rel = p => path.relative(ROOT, p);
console.log(`[promote] wrote ${rel(file)} and ${rel(path.join(out, 'latest.json'))} (${(body.length / 1024).toFixed(0)} KB)${args.dev ? ' as a DEV build, no exam' : ''}`);
console.log(`git add ${rel(file)} ${rel(path.join(out, 'latest.json'))} && git commit -m "Tankfield: Sovereign v${v}"`);
