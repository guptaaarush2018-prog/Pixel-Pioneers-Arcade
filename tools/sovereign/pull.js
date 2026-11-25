'use strict';
/*
 * tools/sovereign/pull.js: downloads recorded boss fights, then deletes them online. DEV ONLY.
 *
 *   node tools/sovereign/pull.js --game=tankfield
 *
 * Needs tools/sovereign/service-account.json (gitignored), a Firebase service account key for
 * the arcade's project: trainrec has no public read, so only the admin SDK can see it.
 * Appends every record as one JSON line ({ key, ...record }) to tools/sovereign/data/<game>.jsonl,
 * and only after the file is written deletes exactly the keys it downloaded.
 */
const fs = require('fs'), path = require('path');

// db: { get(path) → object | null, remove(path, keys) }. Returns the number of records pulled.
async function pull({ db, game, outFile, log = console.log }) {
  const all = (await db.get(`trainrec/${game}`)) || {};
  const keys = Object.keys(all);
  if (!keys.length) { log(`[pull] ${game}: 0 records`); return 0; }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.appendFileSync(outFile, keys.map(k => JSON.stringify({ key: k, ...all[k] })).join('\n') + '\n');
  await db.remove(keys, `trainrec/${game}`);
  log(`[pull] ${game}: ${keys.length} records → ${path.relative(process.cwd(), outFile)}, deleted online`);
  return keys.length;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }));
  const game = args.game || 'tankfield';
  if (!/^[a-z0-9-]{1,23}$/.test(game)) throw new Error('bad --game');
  const keyFile = path.join(__dirname, 'service-account.json');
  if (!fs.existsSync(keyFile)) throw new Error(`no ${path.relative(process.cwd(), keyFile)}: download a service account key from the Firebase console (Project settings → Service accounts)`);
  const cfg = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'js', 'config.js'), 'utf8');
  const url = (cfg.match(/firebaseUrl:\s*'([^']+)'/) || [])[1];
  if (!url) throw new Error('no firebaseUrl in assets/js/config.js');
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(require(keyFile)), databaseURL: url });
  const ref = p => admin.database().ref(p);
  const db = {
    get: async p => (await ref(p).once('value')).val(),
    // Multi-path update with nulls deletes those keys and nothing else; 200 at a time.
    remove: async (keys, p) => { for (let i = 0; i < keys.length; i += 200) await ref(p).update(Object.fromEntries(keys.slice(i, i + 200).map(k => [k, null]))); },
  };
  await pull({ db, game, outFile: path.join(__dirname, 'data', `${game}.jsonl`) });
  await admin.app().delete();
}

if (require.main === module) main().catch(e => { console.error('[pull]', e.message || e); process.exit(1); });
module.exports = { pull };
