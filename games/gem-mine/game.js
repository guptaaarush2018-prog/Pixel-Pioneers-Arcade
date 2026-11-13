(() => {
  const { ORES, LAYERS, DIGGERS, RESEARCH, ABILITIES, BITS, SETS, RELICS, CHALLENGES, TRIPS, CORE, BRANCHES, LEGACY } = window.GEM;
  const W = 960, H = 540;
  const LIST_X = 440, LIST_W = W - LIST_X - 24;
  const SAVE_KEY = 'gem-mine:save';
  const VERSION = 2;
  const MILESTONES = [10, 25, 50, 100, 200];   // each doubles that digger's output
  // Faster than any hand can keep up: more clicks than this in one second overheats the pick.
  const MAX_CPS = 20, OVERHEAT = 3;
  const VEIN_TIME = 6;
  const PICK_MAX = 8;
  const LAYER_BONUS = 0.25;      // each layer breached this run: +25% to diggers
  const SHARD_PCT = 10;          // each core shard: +10% to diggers and clicks
  // Core shards: the first needs 1M gems dug in a run (and Granite reached). Each dive makes the
  // next one need 8× more, and every tenfold past that adds one more shard.
  const SHARD_BASE = 1e6, SHARD_STEP = 8;
  // Combos. A nugget caught during a gem rush stacks the rush: each stack adds half the rush
  // multiplier again and half a rush of time. Overclock and a rush together are Overdrive.
  const RUSH_MAX = 5, RUSH_STACK = 0.5, RUSH_CAP = 90;
  const OVER_CAP = 45;
  // Collapse (second prestige): needs this layer reached in the current run. Each echo is +100%.
  const COLLAPSE_LAYER = 6, ECHO_PCT = 100;

  // How each effect key combines across research, bits, relics, sets, the core tree and challenges.
  const FX = {
    dig: 'mul', click: 'mul', nuggetFreq: 'mul', veinFreq: 'mul', veinPay: 'mul', veinOre: 'mul', orePrice: 'mul',
    cd: 'mul', dyn: 'mul', tripTime: 'mul', relicChance: 'mul', cost: 'mul', synergy: 'mul', research: 'mul', nuggetPay: 'mul',
    rushPay: 'mul',
    clickPct: 'add', rushTime: 'add', offline: 'add', trips: 'add', bitSlots: 'add', shardDive: 'add', rushMax: 'add',
    offlineCap: 'max', rushMult: 'max', startLayer: 'max', overdrive: 'max', veinHits: 'min', growth: 'growth',
    noClick: 'flag', noLab: 'flag', autoHire: 'flag', ability: 'list',
  };
  const FX_BASE = { offlineCap: 8, rushMult: 7, startLayer: 0, overdrive: 2, veinHits: 8, growth: 1.15 };

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let s;               // saved state
  let F;               // combined effects, rebuilt every frame
  let buttons = [];
  let buyMode = 1;     // 1 | 10 | 'max'
  let floaters = [], chips = [];
  let tab = 'diggers';
  let labPage = 0;
  let tripTier = -1;
  let nugget = null, nuggetT = 70, frenzy = 0, rushStacks = 0, wasOverdrive = false;
  let vein = null, veinT = 30;
  let overT = 0;       // Overclock: 30 → 10 boosted, 10 → 0 sluggish
  let clickTimes = [], overheat = 0, spaceHeld = false;
  let shake = 0;

  const newRunId = () => Math.random().toString(36).slice(2, 9);

  function fresh(keep = {}) {
    return {
      v: VERSION, gems: 0, run: 0, lifetime: 0, owned: DIGGERS.map(() => 0), lab: [], pick: 0,
      ore: ORES.map(() => 0), refine: 0.2, target: 0, layer: 0, maxLayer: 0,
      shards: 0, core: [], asc: 0, dives: 0, clicks: 0,
      bits: [], equip: [], relics: [], trips: [], cd: {}, challenge: null, done: [],
      echoes: 0, collapses: 0, legacy: [], autoHire: true,
      runId: newRunId(), saved: Date.now(), ...keep,
    };
  }

  // Saves from before the rework: keep diggers, gems and shards, refund old upgrades as gems,
  // and start the shaft at the layer the best digger you own comes from.
  const OLD_UPGRADES = { gloves: 600, charm: 6000, polish: 45000, rush: 300000, veins: 2.5e6, lanterns: 2e7, shift: 1.5e8, core: 6e9 };
  function migrate(raw) {
    const owned = DIGGERS.map((_, i) => raw.owned?.[i] || 0);
    const top = owned.reduce((m, n, i) => (n > 0 ? i : m), 0);
    const layer = DIGGERS[top].layer;
    const refund = (raw.ups || []).reduce((t, id) => t + (OLD_UPGRADES[id] || 0), 0);
    return fresh({
      gems: (raw.gems || 0) + refund, run: raw.run || 0, lifetime: raw.lifetime || 0, owned,
      pick: Math.min(PICK_MAX, raw.pick || 0), shards: raw.shards || 0, dives: raw.dives || 0,
      asc: Math.min(raw.dives || 0, 3), clicks: raw.clicks || 0, layer, maxLayer: layer, target: layer, saved: raw.saved || Date.now(),
    });
  }

  function load() {
    const raw = Arcade.load(SAVE_KEY, null);
    if (!raw) s = fresh();
    else if (raw.v !== VERSION) s = migrate(raw);
    else s = { ...fresh(), ...raw, owned: DIGGERS.map((_, i) => raw.owned?.[i] || 0), ore: ORES.map((_, i) => raw.ore?.[i] || 0) };
  }

  // Depth counts as the score: it grows with every gem you've ever dug, across every dive.
  const depth = () => Math.floor(100 * Math.log10(s.lifetime + 1));
  function persist() {
    s.saved = Date.now();
    Arcade.submitScore('gem-mine', depth());
    Arcade.save(SAVE_KEY, s);
  }
  setInterval(persist, 5000);
  window.addEventListener('pagehide', persist);

  // ---------- Numbers ----------

  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toString();
    const e = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(n) / 3));
    const v = n / Math.pow(1000, e);
    return (v < 100 ? v.toFixed(2) : v.toFixed(1)) + SUFFIX[e];
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
    return h ? `${h}h ${m}m` : m ? `${m}m ${x}s` : `${x}s`;
  }
  const oreText = (cost) => Object.entries(cost).map(([k, v]) => `${fmt(v)} ${k}`).join(' · ');

  // ---------- Effects ----------

  const setDone = set => RELICS.filter(r => r.set === set.id).every(r => s.relics.includes(r.id));
  const challenge = () => CHALLENGES.find(c => c.id === s.challenge);

  function sources() {
    const list = [];
    const chal = challenge();
    if (!chal?.fx.noLab) for (const id of s.lab) list.push(RESEARCH.find(r => r.id === id)?.fx);
    for (const id of s.equip) list.push(BITS.find(b => b.id === id)?.fx);
    for (const id of s.relics) list.push(RELICS.find(r => r.id === id)?.fx);
    for (const set of SETS) if (set.id !== 'trial' && setDone(set)) list.push(set.fx);
    for (const id of s.core) list.push(CORE.find(c => c.id === id)?.fx);
    for (const id of s.legacy) list.push(LEGACY.find(c => c.id === id)?.fx);
    if (chal) list.push(chal.fx);
    return list.filter(Boolean);
  }

  function computeFx() {
    const out = {};
    const vals = {};
    for (const fx of sources()) for (const [k, v] of Object.entries(fx)) (vals[k] ||= []).push(v);
    for (const [k, kind] of Object.entries(FX)) {
      const v = vals[k] || [];
      const base = FX_BASE[k];
      if (kind === 'mul') out[k] = v.reduce((a, b) => a * b, 1);
      else if (kind === 'add') out[k] = v.reduce((a, b) => a + b, 0);
      else if (kind === 'max') out[k] = Math.max(base, ...v);
      else if (kind === 'min') out[k] = Math.min(base, ...v);
      else if (kind === 'flag') out[k] = v.some(Boolean);
      else if (kind === 'list') out[k] = v;
      // A challenge's harsher growth beats any discount.
      else if (kind === 'growth') out[k] = v.some(g => g > base) ? Math.max(...v) : Math.min(base, ...v);
    }
    return out;
  }
  const refresh = () => { F = computeFx(); };

  // ---------- Economy ----------

  const shardMult = () => (1 + s.shards * SHARD_PCT / 100) * echoMult();
  const echoMult = () => 1 + s.echoes * ECHO_PCT / 100;
  const rushMax = () => RUSH_MAX + F.rushMax;
  const coreSpent = () => s.core.reduce((t, id) => t + CORE.find(c => c.id === id).cost, 0);
  const milestoneMult = i => Math.pow(2, MILESTONES.filter(m => s.owned[i] >= m).length);
  const awayCount = i => s.trips.filter(t => t.tier === i && t.runId === s.runId).reduce((n, t) => n + t.n, 0);
  const working = i => Math.max(0, s.owned[i] - awayCount(i));
  // Teamwork: every digger makes the tier above it a little faster, so the cheap ones stay worth hiring.
  const synergy = i => (i ? 1 + 0.005 * F.synergy * s.owned[i - 1] : 1);
  const digMult = () => F.dig * shardMult() * (1 + LAYER_BONUS * s.layer);
  const diggerRate = (i, n = working(i)) => DIGGERS[i].rate * n * milestoneMult(i) * synergy(i) * digMult();
  const baseRate = () => DIGGERS.reduce((t, _, i) => t + diggerRate(i), 0);
  const overMult = () => (overT > 10 ? 3 : overT > 0 ? 0.5 : 1);
  const rushMult = () => (frenzy > 0 ? F.rushMult * F.rushPay * (1 + RUSH_STACK * (Math.max(1, rushStacks) - 1)) : 1);
  const overdrive = () => frenzy > 0 && overT > 10;
  const perSecond = () => baseRate() * overMult() * rushMult() * (overdrive() ? F.overdrive : 1);
  // Dynamite set off during a boost: ×2 in a rush and +1 per extra stack, ×2 again under Overclock.
  const blastCombo = () => (frenzy > 0 ? 1 + Math.max(1, rushStacks) : 1) * (overT > 10 ? 2 : 1);
  const fmtX = n => (n % 1 ? n.toFixed(1) : String(n));
  const clickPct = () => 0.01 + 0.005 * s.pick + F.clickPct;
  // Clicks: a small flat amount plus a slice of your diggers' base rate. No doubling, so clicking
  // stays a bonus on top of a good mine, never a replacement for one.
  const clickPower = () => (F.noClick ? 0 : ((1 + 2 * s.pick) * shardMult() + baseRate() * clickPct()) * F.click);
  const pickCost = () => 50 * Math.pow(6, s.pick);
  const orePrice = t => LAYERS[t].price * F.orePrice;
  const veinPayout = () => Math.max(clickPower() * 40, baseRate() * 15) * F.veinPay;
  const shardNeed = () => SHARD_BASE * Math.pow(SHARD_STEP, s.asc);
  const shardsOnDive = () => (s.layer < 1 || s.run < shardNeed() ? 0 : 1 + Math.floor(Math.log10(s.run / shardNeed())) + F.shardDive);
  const labCost = r => ({ gems: r.gems * F.research, ore: Math.ceil(r.ore * F.research) });
  const hasAbility = id => F.ability.includes(id);
  const cdLeft = id => Math.max(0, ((s.cd[id] || 0) - Date.now()) / 1000);
  const tripSlots = () => 1 + F.trips;
  const bitSlots = () => 1 + F.bitSlots;

  const unitCost = (i, owned = s.owned[i]) => DIGGERS[i].cost * F.cost * Math.pow(F.growth, owned);
  function bulk(i) {
    if (buyMode === 'max') {
      let n = 0, total = 0;
      while (n < 1000 && total + unitCost(i, s.owned[i] + n) <= s.gems) total += unitCost(i, s.owned[i] + n++);
      return { n: Math.max(1, n), total: n ? total : unitCost(i) };
    }
    let total = 0;
    for (let k = 0; k < buyMode; k++) total += unitCost(i, s.owned[i] + k);
    return { n: buyMode, total };
  }

  // Digging income can be split with the refinery, which turns a share of it into ore. Every gem dug
  // still counts toward depth and core shards in full.
  function earn(n, refine = true) {
    if (!(n > 0)) return;
    s.run += n;
    s.lifetime += n;
    if (refine && s.refine > 0) {
      const share = n * s.refine;
      s.gems += n - share;
      s.ore[s.target] += share / orePrice(s.target);
    } else {
      s.gems += n;
    }
  }

  function buy(i) {
    const { n, total } = bulk(i);
    if (s.gems < total) return;
    s.gems -= total;
    const before = milestoneMult(i);
    s.owned[i] += n;
    if (milestoneMult(i) > before) Arcade.toast('Milestone', `${DIGGERS[i].name}s dig twice as fast`);
    Arcade.tone({ freq: 520, to: 780, dur: 0.08, type: 'triangle', vol: 0.04 });
    if (i === 7) Arcade.flag('gem-mine-forge');
  }

  function buyPick() {
    if (s.pick >= PICK_MAX || s.gems < pickCost()) return;
    s.gems -= pickCost();
    s.pick++;
    Arcade.tone({ freq: 660, to: 990, dur: 0.12, type: 'triangle', vol: 0.04 });
  }

  function research(r) {
    const c = labCost(r);
    if (s.lab.includes(r.id) || r.layer > s.layer || s.gems < c.gems || s.ore[r.layer] < c.ore) return;
    s.gems -= c.gems;
    s.ore[r.layer] -= c.ore;
    s.lab.push(r.id);
    Arcade.toast('Research', r.name);
    Arcade.tone({ freq: 590, to: 1180, dur: 0.16, type: 'triangle', vol: 0.05 });
  }

  function breach() {
    const L = LAYERS[s.layer];
    if (!L.breach || s.gems < L.breach.gems || s.ore[s.layer] < L.breach.ore) return;
    s.gems -= L.breach.gems;
    s.ore[s.layer] -= L.breach.ore;
    s.layer++;
    s.target = s.layer;
    s.maxLayer = Math.max(s.maxLayer, s.layer);
    shake = 0.5;
    const next = LAYERS[s.layer];
    const opens = DIGGERS.filter(d => d.layer === s.layer).map(d => d.name).join(' and ');
    Arcade.toast(`Breached into ${next.name}`, `${opens} for hire · ${next.ore.toLowerCase()} ore · +${LAYER_BONUS * 100}% gems`);
    Arcade.tone({ freq: 140, to: 60, dur: 0.5, type: 'sawtooth', vol: 0.06 });
    Arcade.tone({ freq: 440, to: 1320, dur: 0.4, type: 'triangle', vol: 0.05, delay: 0.25 });
    if (s.layer === 5) Arcade.flag('gem-mine-starfall');
    if (s.layer === COLLAPSE_LAYER) Arcade.toast('The core is unstable', 'Open the Echo tab to collapse it for echoes and a legacy perk');
    if (s.layer === LAYERS.length - 1) Arcade.flag('gem-mine-heart');
    const chal = challenge();
    if (chal && s.layer >= chal.goal && !s.done.includes(chal.id)) completeChallenge(chal);
  }

  function completeChallenge(chal) {
    s.done.push(chal.id);
    s.challenge = null;
    giveRelic(chal.relic);
    Arcade.flag('gem-mine-challenge');
    ui.show({
      title: 'Challenge complete!',
      html: `<p>You beat <b>${chal.name}</b>. Its rule is lifted for the rest of this run.</p><p>New relic: <b>${RELICS.find(r => r.id === chal.relic).name}</b></p>`,
      button: 'Keep digging',
      onAction: () => ui.hide(),
    });
  }

  function giveRelic(id) {
    if (s.relics.includes(id)) return;
    s.relics.push(id);
    const r = RELICS.find(x => x.id === id);
    Arcade.toast('Relic found', `${r.name}: ${r.desc}`);
    Arcade.flag('gem-mine-relic');
    refresh();
    const set = SETS.find(x => x.id === r.set);
    if (set.id !== 'trial' && setDone(set)) Arcade.toast('Set complete', `${set.name}. ${set.desc}`);
  }

  // ---------- Forge ----------

  function forge(b) {
    if (s.bits.includes(b.id)) {
      if (s.equip.includes(b.id)) s.equip = s.equip.filter(x => x !== b.id);
      else {
        s.equip.push(b.id);
        while (s.equip.length > bitSlots()) s.equip.shift();
      }
      Arcade.tone({ freq: 400, to: 600, dur: 0.08, type: 'triangle', vol: 0.04 });
      return;
    }
    const can = Object.entries(b.cost).every(([k, v]) => s.ore[ORES.indexOf(k)] >= v);
    if (!can) return;
    for (const [k, v] of Object.entries(b.cost)) s.ore[ORES.indexOf(k)] -= v;
    s.bits.push(b.id);
    s.equip.push(b.id);
    while (s.equip.length > bitSlots()) s.equip.shift();
    Arcade.toast('Forged', `${b.name}: ${b.desc}`);
    Arcade.tone({ freq: 300, to: 900, dur: 0.3, type: 'square', vol: 0.04 });
  }

  // ---------- Expeditions ----------

  const tripEnd = t => t.start + t.secs * 1000;
  function sendTrip(trip) {
    const i = tripTier;
    const n = Math.floor(working(i) / 2);
    if (i < 0 || n < 1 || s.trips.length >= tripSlots()) return;
    const secs = trip.secs * F.tripTime;
    s.trips.push({ trip: trip.id, tier: i, n, start: Date.now(), secs, rate: diggerRate(i, n), layer: s.layer, runId: s.runId });
    Arcade.toast('Expedition', `${n} ${DIGGERS[i].name}${n > 1 ? 's' : ''} set off: back in ${fmtTime(secs)}`);
    Arcade.tone({ freq: 330, to: 660, dur: 0.2, type: 'triangle', vol: 0.04 });
  }

  function tripReward(t) {
    const trip = TRIPS.find(x => x.id === t.trip);
    const gems = t.rate * t.secs * trip.pay;
    return { gems, ore: (gems * 0.1) / orePrice(t.layer), chance: Math.min(1, trip.relic * F.relicChance) };
  }

  // Trips that finish (even while you were away) pay out. If you dived since, the diggers retire
  // but a relic can still turn up.
  function checkTrips() {
    const now = Date.now();
    for (const t of s.trips.filter(t => tripEnd(t) <= now)) {
      s.trips = s.trips.filter(x => x !== t);
      const r = tripReward(t);
      const same = t.runId === s.runId;
      const lines = [];
      if (same) {
        earn(r.gems, false);
        s.ore[t.layer] += r.ore;
        lines.push(`+${fmt(r.gems)} gems`, `+${fmt(r.ore)} ${ORES[t.layer]}`);
      }
      if (Math.random() < r.chance) {
        const pool = RELICS.filter(x => x.set !== 'trial' && SETS.find(st => st.id === x.set).layer <= s.maxLayer && !s.relics.includes(x.id));
        if (pool.length) giveRelic(Arcade.pick(pool).id);
      }
      Arcade.toast('Expedition back', lines.length ? lines.join(' · ') : 'The crew retired after your dive');
    }
  }

  // ---------- Abilities ----------

  function useAbility(id) {
    if (!hasAbility(id) || cdLeft(id) > 0) return;
    const ab = ABILITIES.find(a => a.id === id);
    s.cd[id] = Date.now() + ab.cd * F.cd * 1000;
    if (id === 'dyn') {
      const combo = blastCombo();
      const n = Math.max(baseRate() * 60, clickPower() * 50, 50) * F.dyn * combo;
      earn(n);
      shake = combo > 1 ? 0.7 : 0.4;
      const name = combo === 1 ? 'BOOM!' : `${frenzy > 0 ? 'GOLDEN BLAST' : 'POWER BLAST'} ×${combo}!`;
      floaters.push({ x: ROCK.x, y: ROCK.y - 30, text: `${name} +${fmt(n)}`, t: 0, big: true });
      for (let k = 0; k < 30 + 12 * (combo - 1); k++) chips.push({ x: ROCK.x, y: ROCK.y, vx: Arcade.rand(-320, 320), vy: Arcade.rand(-420, -60), t: 0, c: Arcade.pick(['#ffb300', '#ff7043', '#ffe082']) });
      Arcade.tone({ freq: 90, to: 40, dur: 0.5, type: 'sawtooth', vol: 0.08 });
    } else if (id === 'over') {
      overT = 30;
      floaters.push({ x: ROCK.x, y: ROCK.y - 30, text: 'Overclock! ×3', t: 0, big: true });
      Arcade.tone({ freq: 300, to: 1200, dur: 0.4, type: 'square', vol: 0.04 });
    } else if (id === 'eye') {
      spawnNugget();
      spawnVein(true);
      Arcade.tone({ freq: 700, to: 1400, dur: 0.3, type: 'sine', vol: 0.05 });
    }
  }

  // ---------- Clicking ----------

  // Counts clicks over the last second. Too many and the pick overheats for a few seconds.
  function heatOk() {
    const now = performance.now();
    clickTimes = clickTimes.filter(t => now - t < 1000);
    if (overheat > 0) {
      Arcade.tone({ freq: 120, dur: 0.04, type: 'square', vol: 0.02 });
      return false;
    }
    clickTimes.push(now);
    if (clickTimes.length > MAX_CPS) {
      overheat = OVERHEAT;
      clickTimes = [];
      floaters.push({ x: ROCK.x, y: ROCK.y - 40, text: 'Pick overheated!', t: 0, big: true, hot: true });
      Arcade.tone({ freq: 300, to: 90, dur: 0.4, type: 'sawtooth', vol: 0.05 });
      return false;
    }
    return true;
  }

  function mine(x, y, aimed = true) {
    if (F.noClick) {
      floaters.push({ x, y, text: 'Hands off!', t: 0, hot: true });
      return;
    }
    if (!heatOk()) return;
    if (aimed && vein && Math.hypot(x - vein.x, y - vein.y) < 26) hitVein();
    const n = clickPower();
    earn(n);
    s.clicks++;
    shake = Math.max(shake, 0.08);
    floaters.push({ x: x + Arcade.rand(-20, 20), y, text: '+' + fmt(n), t: 0 });
    for (let i = 0; i < 5; i++) chips.push({ x, y, vx: Arcade.rand(-160, 160), vy: Arcade.rand(-260, -80), t: 0, c: Arcade.pick(Arcade.equipped('gem-sparkle').colors) });
    Arcade.tone({ freq: Arcade.rand(700, 900), dur: 0.03, type: 'square', vol: 0.02 });
  }

  // Ore veins: a glowing crack that pays gems and ore if you hit it enough times before it fades.
  // It needs aim, so Space (which digs at random) won't find it.
  function hitVein() {
    vein.hits++;
    if (vein.hits < vein.need) return;
    const base = veinPayout();
    // Struck during a rush: double gems (not ore) and the rush runs 5s longer.
    const rush = frenzy > 0;
    const n = base * (rush ? 2 : 1);
    earn(n, false);
    const ore = Math.max(1, Math.ceil((base * 0.2) / orePrice(s.layer))) * F.veinOre;
    s.ore[s.layer] += ore;
    if (rush) frenzy = Math.min(Math.max(frenzy, RUSH_CAP), frenzy + 5);
    floaters.push({ x: vein.x, y: vein.y - 10, text: `${rush ? 'Rush vein ×2!' : 'Vein!'} +${fmt(n)} · +${fmt(ore)} ${ORES[s.layer]}`, t: 0, big: true });
    Arcade.tone({ freq: 520, to: 1560, dur: 0.35, type: 'triangle', vol: 0.05 });
    vein = null;
  }

  function spawnVein(easy = false) {
    const a = Arcade.rand(0, Math.PI * 2), r = Arcade.rand(20, 80);
    vein = { x: ROCK.x + Math.cos(a) * r, y: ROCK.y + Math.sin(a) * r, t: 0, hits: 0, need: easy ? 3 : F.veinHits };
  }
  function spawnNugget() {
    nugget = { x: Arcade.rand(40, LIST_X - 40), y: Arcade.rand(130, 330), t: 0 };
  }
  const nextWait = (lo, hi, freq) => (freq > 0 ? Arcade.rand(lo, hi) / freq : Infinity);

  function catchNugget() {
    const full = 20 + F.rushTime;
    const lucky = () => {
      const n = Math.max(baseRate() * 60, clickPower() * 30, 25) * F.nuggetPay;
      earn(n, false);
      floaters.push({ x: nugget.x, y: nugget.y, text: `Lucky! +${fmt(n)}`, t: 0, big: true });
    };
    if (frenzy > 0) {
      // A nugget during a rush always stacks it. At full stacks it pays out as well.
      const maxed = rushStacks >= rushMax();
      rushStacks = Math.min(rushMax(), rushStacks + 1);
      frenzy = Math.min(Math.max(frenzy, RUSH_CAP), frenzy + full / 2);
      if (maxed) lucky();
      floaters.push({ x: nugget.x, y: nugget.y - (maxed ? 22 : 0), text: maxed ? `Rush +${fmtX(full / 2)}s` : `Rush stack ${rushStacks}! ×${fmtX(rushMult())}`, t: 0, big: true });
      for (let k = 0; k < 16; k++) chips.push({ x: nugget.x, y: nugget.y, vx: Arcade.rand(-220, 220), vy: Arcade.rand(-320, -40), t: 0, c: Arcade.pick(['#ffd54f', '#ffe082', '#fff3c4']) });
      if (rushStacks >= 3) Arcade.flag('gem-mine-stack');
      if (rushStacks >= 7) Arcade.flag('gem-mine-fever');
    } else if (Math.random() < 0.5) {
      lucky();
    } else {
      frenzy = full;
      rushStacks = 1;
      floaters.push({ x: nugget.x, y: nugget.y, text: `Gem rush! ×${fmtX(rushMult())} for ${frenzy}s`, t: 0, big: true });
    }
    // Nuggets keep an Overclock running hot a little longer.
    if (overT > 10 && overT < OVER_CAP) {
      overT = Math.min(OVER_CAP, overT + 5);
      floaters.push({ x: nugget.x, y: nugget.y + 22, text: 'Overclock +5s', t: 0 });
    }
    nugget = null;
    Arcade.flag('gem-mine-nugget');
    Arcade.tone({ freq: 880, to: 1760, dur: 0.3, type: 'triangle', vol: 0.05 });
  }

  // ---------- Diving ----------

  function openDive() {
    const got = shardsOnDive();
    if (got < 1) return;
    const chals = s.dives >= 2 ? CHALLENGES : [];
    const layerName = i => LAYERS[i].name;
    const chalBtns = chals.map(c => {
      const done = s.done.includes(c.id);
      const relic = RELICS.find(r => r.id === c.relic).name;
      return `<button class="btn secondary" type="button" data-c="${c.id}" style="flex-direction:column;align-items:flex-start;text-align:left;line-height:1.3">
        <span>${done ? '✓ ' : ''}Challenge: ${c.name}</span>
        <small style="font-weight:400;opacity:.8">${c.rule} Reach ${layerName(c.goal)} to win ${done ? '(already won)' : relic}.</small></button>`;
    }).join('');
    ui.show({
      title: 'Dive deeper?',
      html: `<p>You'll start a fresh shaft with <b>${got} new core shard${got > 1 ? 's' : ''}</b>. Each shard is +${SHARD_PCT}% to diggers and clicks, and a point to spend in the Core tree.</p>
        <p>Diggers, gems, ore, research and your pick reset. Relics, drill bits and the Core tree stay.</p>
        <p>Every dive makes the next shard harder: next time you'll need ${fmt(shardNeed() * SHARD_STEP)} gems in a run.</p>
        <div class="menu">
          <button class="btn" type="button" data-c="">Dive</button>
          ${chals.length ? '' : '<p style="margin:4px 0 0;font-size:12px">Challenge dives unlock after your second dive.</p>'}
          ${chalBtns}
          <button class="btn secondary" type="button" data-x>Not yet</button>
        </div>`,
      button: null,
      onRender: panel => {
        panel.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => dive(b.dataset.c || null)));
        panel.querySelector('[data-x]').addEventListener('click', () => ui.hide());
      },
    });
  }

  function dive(chal) {
    const got = shardsOnDive();
    if (got < 1) return;
    const score = depth();
    s = fresh({
      lifetime: s.lifetime, shards: s.shards + got, core: s.core, asc: s.asc + 1, dives: s.dives + 1,
      bits: s.bits, equip: s.equip, relics: s.relics, trips: s.trips, done: s.done, maxLayer: s.maxLayer,
      clicks: s.clicks, refine: s.refine, challenge: chal,
    });
    // The old crew sticks around: every new shaft starts with a few Pebble Pups, so runs where
    // clicking is off can still get going.
    s.owned[0] = 10;
    refresh();
    s.layer = s.target = F.startLayer;
    overT = frenzy = rushStacks = 0;
    vein = nugget = null;
    persist();
    Arcade.flag('gem-mine-dive');
    const c = challenge();
    Arcade.finish(ui, {
      score,
      title: 'Deeper we go!',
      lines: [
        `You found ${got} core shard${got > 1 ? 's' : ''}. You now have ${s.shards}: +${s.shards * SHARD_PCT}% to everything.`,
        c ? `Challenge on: ${c.rule} Reach ${LAYERS[c.goal].name} to win.` : 'Spend your shards in the Core tab.',
      ],
      button: 'Keep digging',
      onAction: () => ui.hide(),
    });
  }

  // ---------- Core tree ----------

  function buyCore(node) {
    if (s.core.includes(node.id)) return;
    const branch = CORE.filter(c => c.branch === node.branch);
    const k = branch.indexOf(node);
    if (k > 0 && !s.core.includes(branch[k - 1].id)) return;
    if (s.shards - coreSpent() < node.cost) return;
    s.core.push(node.id);
    Arcade.toast('Core', `${node.name}: ${node.desc}`);
    Arcade.tone({ freq: 500, to: 1000, dur: 0.2, type: 'sine', vol: 0.05 });
    refresh();
    while (s.equip.length > bitSlots()) s.equip.shift();
  }
  function respec() {
    s.core = [];
    refresh();
    while (s.equip.length > bitSlots()) s.equip.shift();
  }

  // ---------- Collapse (second prestige) ----------

  // Echoes: the square root of your shards, plus 2 for every layer past the Void Rift this run.
  const echoesOnCollapse = () => (s.layer < COLLAPSE_LAYER ? 0 : Math.floor(Math.sqrt(s.shards)) + 2 * (s.layer - COLLAPSE_LAYER));

  function openCollapse() {
    const got = echoesOnCollapse();
    if (got < 1) return;
    const left = LEGACY.filter(l => !s.legacy.includes(l.id));
    const perks = left.map(l => `<button class="btn secondary" type="button" data-l="${l.id}" style="flex-direction:column;align-items:flex-start;text-align:left;line-height:1.3">
        <span>${l.name}</span><small style="font-weight:400;opacity:.8">${l.desc}</small></button>`).join('');
    ui.show({
      title: 'Collapse the core?',
      html: `<p>You'll gain <b>${got} echo${got > 1 ? 'es' : ''}</b> (+${ECHO_PCT}% to everything each, forever)${left.length ? ' and a <b>legacy perk</b> you pick below' : ''}.</p>
        <p>Your ${s.shards} core shards and the Core tree reset, and shards get easy again. Relics, drill bits and challenge wins stay.</p>
        <div class="menu">${left.length ? perks : '<button class="btn" type="button" data-l="">Collapse</button>'}
          <button class="btn secondary" type="button" data-x>Not yet</button></div>`,
      button: null,
      onRender: panel => {
        panel.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => collapse(b.dataset.l || null)));
        panel.querySelector('[data-x]').addEventListener('click', () => ui.hide());
      },
    });
  }

  function collapse(perk) {
    const got = echoesOnCollapse();
    if (got < 1) return;
    const score = depth();
    const legacy = perk && !s.legacy.includes(perk) ? [...s.legacy, perk] : s.legacy;
    s = fresh({
      lifetime: s.lifetime, dives: s.dives, bits: s.bits, equip: s.equip, relics: s.relics, trips: s.trips, done: s.done,
      maxLayer: s.maxLayer, clicks: s.clicks, refine: s.refine, autoHire: s.autoHire,
      echoes: s.echoes + got, collapses: s.collapses + 1, legacy,
    });
    s.owned[0] = 10;
    refresh();
    while (s.equip.length > bitSlots()) s.equip.shift();
    s.layer = s.target = F.startLayer;
    overT = frenzy = rushStacks = 0;
    vein = nugget = null;
    shake = 0.8;
    persist();
    Arcade.flag('gem-mine-collapse');
    const p = LEGACY.find(l => l.id === perk);
    Arcade.finish(ui, {
      score,
      title: 'The core collapses!',
      lines: [
        `+${got} echo${got > 1 ? 'es' : ''}. You now have ${s.echoes}: ×${fmtX(echoMult())} to everything.`,
        p ? `Legacy perk: ${p.name}. ${p.desc}.` : 'Core shards are easy to find again.',
      ],
      button: 'Start again',
      onAction: () => ui.hide(),
    });
  }

  // Auto Foreman: once a second, hire up to 10 of the best diggers that each cost under a quarter of
  // your gems, so it never eats the savings for a breach.
  function autoHire() {
    if (!F.autoHire || !s.autoHire) return;
    for (let k = 0; k < 10; k++) {
      const i = DIGGERS.findLastIndex((d, j) => d.layer <= s.layer && unitCost(j) <= s.gems * 0.25);
      if (i < 0) return;
      s.gems -= unitCost(i);
      s.owned[i]++;
    }
  }

  // ---------- Input ----------

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  const ROCK = { x: 220, y: 238, r: 105 };
  // Scripted clicks (isTrusted false) don't count.
  canvas.addEventListener('pointerdown', e => {
    if (!e.isTrusted) return;
    const [px, py] = toBoard(e);
    if (nugget && Math.hypot(px - nugget.x, py - nugget.y) < 28) {
      catchNugget();
      return;
    }
    for (const b of buttons) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        if (b.enabled) b.onClick();
        else if (b.why) Arcade.toast('Not yet', b.why);
        return;
      }
    }
    if (Math.hypot(px - ROCK.x, py - ROCK.y) < ROCK.r) mine(px, py);
  });
  // One dig per press: holding Space down doesn't keep digging.
  window.addEventListener('keydown', e => {
    if (!document.getElementById('overlay').hidden || !e.isTrusted) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat || spaceHeld) return;
      spaceHeld = true;
      mine(ROCK.x + Arcade.rand(-40, 40), ROCK.y + Arcade.rand(-40, 40), false);
    }
    const ab = ABILITIES.find(a => `Digit${a.key}` === e.code);
    if (ab && !e.repeat) useAbility(ab.id);
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') spaceHeld = false; });
  window.addEventListener('blur', () => { spaceHeld = false; });

  // ---------- Drawing helpers ----------

  function button(x, y, w, h, { enabled, onClick, why }) {
    buttons.push({ x, y, w, h, enabled, onClick, why });
  }

  function font(weight, size) {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  }
  function text(str, x, y, color, align = 'left') {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(str, x, y);
  }
  function clip(str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    while (str.length > 1 && ctx.measureText(str + '…').width > maxW) str = str.slice(0, -1);
    return str + '…';
  }
  function wrap(str, maxW) {
    const lines = [];
    let line = '';
    for (const word of str.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width > maxW && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  function box(x, y, w, h, fill, stroke) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }

  function drawBtn(x, y, w, h, label, sub, enabled, onClick, { why, accent = '#ffc53d', progress } = {}) {
    box(x, y, w, h, enabled ? '#2b3446' : '#1e222a', enabled ? accent : '#2a2f39');
    if (progress != null) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + 1, y + 1, (w - 2) * Math.min(1, progress), h - 2);
    }
    font(600, 13);
    text(clip(label, w - 16), x + 8, y + 18, enabled ? '#eceef2' : '#7b8290');
    font(500, 11);
    text(clip(sub, w - 16), x + 8, y + 34, enabled ? accent : '#5c6370');
    button(x, y, w, h, { enabled, onClick, why });
  }

  // ---------- Left side: the rock ----------

  function drawRock(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1d1a26');
    g.addColorStop(1, '#2b2233');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LIST_X, H);
    const L = LAYERS[s.layer];
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `hsla(${L.hue - i * 6}, 25%, ${16 + i * 2}%, 0.6)`;
      ctx.fillRect(0, 300 + i * 40, LIST_X, 40);
    }

    const k = 0.9 * (1 + (shake > 0 ? Math.min(0.06, shake * 0.12) : 0) + Math.sin(t * 2) * 0.01);
    ctx.save();
    ctx.translate(ROCK.x + (shake > 0.2 ? Arcade.rand(-3, 3) : 0), ROCK.y);
    ctx.scale(k, k);
    if (frenzy > 0 || overT > 10) {
      ctx.shadowColor = overdrive() ? '#ff8a65' : frenzy > 0 ? '#ffd54f' : '#4fc3f7';
      ctx.shadowBlur = 22 + rushStacks * 6 + Math.sin(t * (overdrive() ? 14 : 6)) * 6;
    }
    ctx.fillStyle = L.rock;
    ctx.beginPath();
    const pts = [[-110, 10], [-80, -80], [-10, -115], [70, -90], [115, -10], [90, 80], [10, 112], [-75, 85]];
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = L.top;
    ctx.beginPath();
    ctx.moveTo(-80, -80); ctx.lineTo(-10, -115); ctx.lineTo(70, -90); ctx.lineTo(10, -40); ctx.closePath();
    ctx.fill();
    const gems = [[-40, -30, '#7fdbff'], [30, 20, '#b388ff'], [-20, 50, '#9be37a'], [55, -40, '#ffd54f'], [-70, 20, '#ff8a80']];
    for (const [x, y, c] of gems) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x, y - 12); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - 9, y);
      ctx.closePath();
      ctx.fill();
    }
    // Ore flecks in this layer's colour.
    ctx.fillStyle = L.oreColor;
    for (const [x, y] of [[-55, -60], [80, 30], [-5, 85], [40, -75], [-90, 45]]) ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.restore();

    if (vein) {
      const fade = Math.min(1, (VEIN_TIME - vein.t) / 1.5);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.strokeStyle = '#ffe082';
      ctx.shadowColor = '#ffd54f';
      ctx.shadowBlur = 14 + Math.sin(t * 10) * 6;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(vein.x - 18, vein.y - 10); ctx.lineTo(vein.x - 4, vein.y + 2); ctx.lineTo(vein.x + 4, vein.y - 6); ctx.lineTo(vein.x + 18, vein.y + 10);
      ctx.stroke();
      ctx.shadowBlur = 0;
      font(700, 11);
      text(`${vein.hits}/${vein.need}`, vein.x, vein.y + 28, '#ffe082', 'center');
      ctx.restore();
    }

    // Header: gems, rate, layer, ore.
    font(700, 32);
    text(fmt(s.gems), ROCK.x, 44, '#eceef2', 'center');
    font(600, 13);
    const boosted = frenzy > 0 || overT > 10;
    text(`gems · ${fmt(perSecond())}/s`, ROCK.x, 64, overdrive() ? '#ff8a65' : boosted ? '#ffd54f' : '#8d94a1', 'center');
    font(600, 11);
    text(`${L.name.toUpperCase()} · LAYER ${s.layer + 1} OF ${LAYERS.length} · +${s.layer * LAYER_BONUS * 100}% GEMS`, ROCK.x, 84, '#8d94a1', 'center');
    font(500, 11);
    const oreRate = s.refine > 0 ? ` · +${fmt((perSecond() * s.refine) / orePrice(s.target))} ${ORES[s.target]}/s` : '';
    text(`${LAYERS[s.layer].ore} ${fmt(s.ore[s.layer])}${oreRate}`, ROCK.x, 102, L.oreColor, 'center');
    const chal = challenge();
    if (chal) {
      font(600, 11);
      text(`CHALLENGE · ${chal.name}: reach ${LAYERS[chal.goal].name}`, ROCK.x, 122, '#ff8a80', 'center');
    }

    // Active boosts, as pills above the rock.
    const pills = [];
    if (frenzy > 0) pills.push([`RUSH ×${fmtX(rushMult())} ${'●'.repeat(rushStacks)}${'○'.repeat(Math.max(0, rushMax() - rushStacks))} ${Math.ceil(frenzy)}s`, '#ffd54f']);
    if (overT > 10) pills.push([`OVERCLOCK ×3 ${Math.ceil(overT - 10)}s`, '#4fc3f7']);
    else if (overT > 0) pills.push([`COOLING ×½ ${Math.ceil(overT)}s`, '#8d94a1']);
    if (overdrive()) pills.push([`OVERDRIVE ×${F.overdrive}`, '#ff8a65']);
    if (pills.length) {
      font(700, 11);
      const widths = pills.map(([label]) => ctx.measureText(label).width + 16);
      let x = ROCK.x - (widths.reduce((a, b) => a + b, 0) + 6 * (pills.length - 1)) / 2;
      const y = chal ? 130 : 112;
      pills.forEach(([label, color], n) => {
        box(x, y, widths[n], 18, 'rgba(14,16,20,0.85)', color);
        text(label, x + widths[n] / 2, y + 13, color, 'center');
        x += widths[n] + 6;
      });
    }

    // Heat gauge.
    const now = performance.now();
    const heat = overheat > 0 ? overheat / OVERHEAT : clickTimes.filter(c => now - c < 1000).length / MAX_CPS;
    ctx.fillStyle = '#2a2f39';
    ctx.fillRect(ROCK.x - 60, 346, 120, 5);
    ctx.fillStyle = overheat > 0 ? '#ff5d5d' : heat > 0.7 ? '#ffb347' : '#7fdbff';
    ctx.fillRect(ROCK.x - 60, 346, 120 * Math.min(1, heat), 5);
    font(500, 11);
    const hint = F.noClick ? 'Your pick is put away this run' : overheat > 0 ? `Pick overheated! Cooling down… ${Math.ceil(overheat)}s` : `Click the rock (or Space) for ${fmt(clickPower())}`;
    text(hint, ROCK.x, 366, '#8d94a1', 'center');

    // Abilities.
    ABILITIES.forEach((ab, n) => {
      const x = 12 + n * 140, y = 376;
      const have = hasAbility(ab.id);
      const left = cdLeft(ab.id);
      const total = ab.cd * F.cd;
      const unlock = RESEARCH.find(r => r.fx.ability === ab.id);
      drawBtn(x, y, 132, 44, `${ab.key} · ${ab.name}`, !have ? `Lab: ${unlock.name}` : left > 0 ? `Ready in ${fmtTime(left)}` : ab.desc, have && left <= 0, () => useAbility(ab.id),
        { accent: '#7fdbff', progress: have && left > 0 ? 1 - left / total : null, why: !have ? `Research ${unlock.name} in the Lab (${LAYERS[unlock.layer].name})` : null });
    });

    // Pick and breach.
    const pc = pickCost();
    drawBtn(12, 428, 200, 46, `Sharper pick (lv ${s.pick}/${PICK_MAX})`, s.pick >= PICK_MAX ? 'Maxed out' : `${fmt(pc)} · clicks +0.5% of gems/s`, s.pick < PICK_MAX && s.gems >= pc && !F.noClick, buyPick);
    const B = L.breach;
    if (B) {
      const ok = s.gems >= B.gems && s.ore[s.layer] >= B.ore;
      const prog = Math.min(s.gems / B.gems, s.ore[s.layer] / B.ore);
      drawBtn(220, 428, 208, 46, `Breach to ${LAYERS[s.layer + 1].name}`, `${fmt(B.gems)} gems · ${B.ore} ${ORES[s.layer]}`, ok, breach,
        { accent: '#9be37a', progress: prog, why: `Bedrock: needs ${fmt(B.gems)} gems and ${B.ore} ${ORES[s.layer]}. Refine ore in the Ore tab.` });
    } else {
      drawBtn(220, 428, 208, 46, 'Deepest layer', 'Nothing left but stars', false, () => {});
    }

    // Dive.
    const shards = shardsOnDive();
    const need = shardNeed();
    let sub;
    if (shards) {
      const nextAt = need * Math.pow(10, shards - F.shardDive);
      sub = `+${shards} core shard${shards > 1 ? 's' : ''} · next at ${fmt(nextAt)} dug this run`;
    } else if (s.layer < 1) sub = 'Breach into Granite first';
    else sub = `Dig ${fmt(need - s.run)} more this run for a core shard`;
    drawBtn(12, 482, 416, 46, `Dive deeper · shards ${s.shards} (+${s.shards * SHARD_PCT}%) · dive ${s.dives + 1}`, sub, shards > 0, openDive,
      { accent: '#c39bff', progress: shards ? null : Math.min(1, Math.log10(s.run + 1) / Math.log10(need)), why: s.layer < 1 ? 'Breach into Granite before you can dive' : `This dive needs ${fmt(need)} gems dug in one run` });
  }

  // ---------- Right side: tabs ----------

  const TABS = [
    { id: 'diggers', label: 'Diggers', open: () => true },
    { id: 'lab', label: 'Lab', open: () => true },
    { id: 'ore', label: 'Ore', open: () => true },
    { id: 'forge', label: 'Forge', open: () => s.maxLayer >= 1, why: 'Reach Granite to open the Forge' },
    { id: 'trips', label: 'Trips', open: () => s.maxLayer >= 1, why: 'Reach Granite to send expeditions' },
    { id: 'core', label: 'Core', open: () => s.dives > 0 || s.shards > 0, why: 'Dive deeper once to open the Core tree' },
    { id: 'relics', label: 'Relics', open: () => s.dives > 0 || s.relics.length > 0 || s.maxLayer >= 1, why: 'Reach Granite to start finding relics' },
    { id: 'echo', label: 'Echo', open: () => s.maxLayer >= COLLAPSE_LAYER || s.collapses > 0, why: 'Breach into the Void Rift to open the Echo tab' },
  ];

  function drawList() {
    ctx.fillStyle = '#161920';
    ctx.fillRect(LIST_X, 0, W - LIST_X, H);
    const tw = (LIST_W - (TABS.length - 1) * 4) / TABS.length;
    TABS.forEach((tb, n) => {
      const x = LIST_X + 12 + n * (tw + 4);
      const open = tb.open();
      box(x, 10, tw, 24, tab === tb.id ? '#eceef2' : '#232833');
      font(600, 11);
      text(open ? tb.label : '🔒', x + tw / 2, 26, tab === tb.id ? '#0e1014' : open ? '#8d94a1' : '#4a505c', 'center');
      button(x, 10, tw, 24, { enabled: open, onClick: () => { tab = tb.id; }, why: tb.why });
    });
    if (!TABS.find(x => x.id === tab).open()) tab = 'diggers';
    ({ diggers: drawDiggers, lab: drawLab, ore: drawOre, forge: drawForge, trips: drawTrips, core: drawCore, relics: drawRelics, echo: drawEcho })[tab]();
  }

  function drawDiggers() {
    font(500, 11);
    text(`Each digger speeds up the next tier by ${(0.5 * F.synergy).toFixed(1)}%`, LIST_X + 14, 58, '#6b7280');
    ['1', '10', 'max'].forEach((m, n) => {
      const val = m === 'max' ? 'max' : +m;
      const x = W - 170 + n * 52;
      box(x, 42, 46, 22, buyMode === val ? '#eceef2' : '#232833');
      font(600, 12);
      text(m === 'max' ? 'Max' : `×${m}`, x + 23, 57, buyMode === val ? '#0e1014' : '#8d94a1', 'center');
      button(x, 42, 46, 22, { enabled: true, onClick: () => { buyMode = val; } });
    });

    // Rows shrink to fit once the deep diggers show up.
    const shown = DIGGERS.filter((d, i) => i < 10 || d.layer <= s.maxLayer + 1);
    const rowH = Math.min(46, Math.floor((H - 74) / shown.length));
    const tight = rowH < 42;
    shown.forEach((d, i) => {
      const y = 72 + i * rowH;
      const reached = d.layer <= s.layer;
      const known = reached && (i === 0 || s.owned[i - 1] > 0 || s.owned[i] > 0 || DIGGERS[i - 1].layer < d.layer);
      const { n, total } = bulk(i);
      const can = known && s.gems >= total;
      box(LIST_X + 12, y, LIST_W, rowH - 5, can ? '#1f2530' : '#1a1d24', can ? '#3b4658' : null);
      ctx.fillStyle = known ? d.color : '#2a2f39';
      ctx.beginPath();
      ctx.arc(LIST_X + 36, y + (tight ? 16 : 20), tight ? 10 : 12, 0, Math.PI * 2);
      ctx.fill();
      font(600, tight ? 13 : 14);
      text(known ? d.name : reached ? '???' : `Locked: ${LAYERS[d.layer].name}`, LIST_X + 58, y + (tight ? 14 : 17), known ? '#eceef2' : '#5c6370');
      font(500, 11);
      const away = awayCount(i);
      const next = MILESTONES.find(m => m > s.owned[i]);
      const syn = synergy(i) >= 1.01 ? ` · +${Math.round((synergy(i) - 1) * 100)}% teamwork` : '';
      const info = known ? `${fmt(diggerRate(i))}/s${next ? ` · ×2 at ${next}` : ''}${syn}${away ? ` · ${away} on a trip` : ''}`
        : reached ? 'Hire the one above to discover' : `Breach into ${LAYERS[d.layer].name} to hire`;
      text(clip(info, 300), LIST_X + 58, y + (tight ? 27 : 32), '#8d94a1');
      font(700, tight ? 17 : 20);
      text(String(s.owned[i]), W - 140, y + (tight ? 22 : 27), '#eceef2', 'right');
      font(600, 13);
      text(known ? `${n > 1 ? `×${n} ` : ''}${fmt(total)}` : '', W - 22, y + (tight ? 21 : 26), can ? '#ffc53d' : '#5c6370', 'right');
      button(LIST_X + 12, y, LIST_W, rowH - 5, { enabled: can, onClick: () => buy(i) });
    });
  }

  function drawLab() {
    if (F.noLab) {
      font(600, 14);
      text('Empty Lab challenge: no research this run.', LIST_X + LIST_W / 2 + 12, 120, '#ff8a80', 'center');
      return;
    }
    // Two pages: layers 1–4, then (once you reach the Outer Core) 5 and below.
    const deep = s.maxLayer >= 4;
    if (!deep) labPage = 0;
    const list = RESEARCH.filter(r => (labPage ? r.layer >= 4 : r.layer < 4));
    let top = 44;
    if (deep) {
      ['Shallow', 'Deep'].forEach((label, n) => {
        const x = LIST_X + 12 + n * 92;
        box(x, 40, 86, 20, labPage === n ? '#eceef2' : '#232833');
        font(600, 11);
        text(label, x + 43, 54, labPage === n ? '#0e1014' : '#8d94a1', 'center');
        button(x, 40, 86, 20, { enabled: true, onClick: () => { labPage = n; } });
      });
      top = 66;
    }
    const cw = (LIST_W - 8) / 2, ch = 54;
    list.forEach((r, n) => {
      const x = LIST_X + 12 + (n % 2) * (cw + 8);
      const y = top + Math.floor(n / 2) * (ch + 5);
      const owned = s.lab.includes(r.id);
      const reached = r.layer <= s.layer;
      const c = labCost(r);
      const can = reached && !owned && s.gems >= c.gems && s.ore[r.layer] >= c.ore;
      box(x, y, cw, ch, owned ? '#1a2a22' : can ? '#1f2530' : '#1a1d24', can ? '#3b4658' : null);
      font(600, 13);
      text(reached ? r.name : '???', x + 10, y + 17, reached ? '#eceef2' : '#5c6370');
      font(500, 11);
      text(clip(reached ? r.desc : `Reach ${LAYERS[r.layer].name}`, cw - 20), x + 10, y + 32, '#8d94a1');
      font(600, 11);
      if (owned) text('Researched', x + 10, y + 47, '#9be37a');
      else if (reached) {
        text(`${fmt(c.gems)} gems`, x + 10, y + 47, s.gems >= c.gems ? '#ffc53d' : '#5c6370');
        text(`${c.ore} ${ORES[r.layer]}`, x + cw - 10, y + 47, s.ore[r.layer] >= c.ore ? LAYERS[r.layer].oreColor : '#5c6370', 'right');
      }
      button(x, y, cw, ch, { enabled: can, onClick: () => research(r) });
    });
    font(500, 11);
    text('Research resets when you dive deeper.', LIST_X + 12 + LIST_W / 2, H - 6, '#5c6370', 'center');
  }

  function drawOre() {
    font(500, 11);
    const lines = wrap('The refinery turns a share of what you dig into ore. Ore pays for breaching bedrock, research and drill bits. Refined gems still count toward depth and core shards.', LIST_W - 4);
    lines.forEach((l, k) => text(l, LIST_X + 14, 52 + k * 14, '#8d94a1'));
    font(600, 12);
    text('Refine', LIST_X + 14, 104, '#eceef2');
    [0, 0.1, 0.2, 0.5].forEach((p, n) => {
      const x = LIST_X + 70 + n * 58;
      box(x, 90, 52, 22, s.refine === p ? '#eceef2' : '#232833');
      font(600, 12);
      text(`${p * 100}%`, x + 26, 105, s.refine === p ? '#0e1014' : '#8d94a1', 'center');
      button(x, 90, 52, 22, { enabled: true, onClick: () => { s.refine = p; } });
    });

    // The deep ores only get a row once you're close to them.
    const oreRows = LAYERS.map((L, t) => t).filter(t => t < 6 || t <= s.maxLayer + 1);
    const oh = Math.min(44, Math.floor(270 / oreRows.length));
    oreRows.forEach((t, k) => {
      const L = LAYERS[t];
      const y = 122 + k * oh;
      const open = t <= s.layer;
      const sel = s.target === t;
      const one = oh < 36;   // single-line rows
      box(LIST_X + 12, y, LIST_W, oh - 4, sel ? '#232b38' : '#1a1d24', sel ? L.oreColor : null);
      ctx.fillStyle = open ? L.oreColor : '#2a2f39';
      ctx.fillRect(LIST_X + 26, y + (oh - 4) / 2 - 7, 14, 14);
      font(600, one ? 13 : 14);
      text(open || s.ore[t] > 0 ? L.ore : '???', LIST_X + 52, y + (one ? (oh - 4) / 2 + 5 : 17), open ? '#eceef2' : '#5c6370');
      font(500, 11);
      const rate = sel && s.refine > 0 ? ` · +${fmt((perSecond() * s.refine) / orePrice(t))}/s` : '';
      text(open ? `${fmt(orePrice(t))} each${rate}${sel ? ' · refining' : one ? '' : ' · tap to refine'}` : `Reach ${L.name}`, one ? LIST_X + 140 : LIST_X + 52, y + (one ? (oh - 4) / 2 + 5 : 32), '#8d94a1');
      font(700, one ? 15 : 18);
      text(fmt(s.ore[t]), W - 22, y + (one ? (oh - 4) / 2 + 6 : 26), open ? L.oreColor : '#5c6370', 'right');
      button(LIST_X + 12, y, LIST_W, oh - 4, { enabled: open, onClick: () => { s.target = t; }, why: `Breach into ${L.name} to refine ${L.ore.toLowerCase()}` });
    });

    const L = LAYERS[s.layer];
    const y = 392;
    box(LIST_X + 12, y, LIST_W, 136, '#1a1d24', '#2a2f39');
    font(700, 13);
    if (!L.breach) {
      text('You are at the bottom of the shaft.', LIST_X + 24, y + 22, '#eceef2');
      font(500, 11);
      text('This is the World Heart. Dive or collapse the core to go again, stronger.', LIST_X + 24, y + 42, '#8d94a1');
      return;
    }
    const N = LAYERS[s.layer + 1];
    text(`Next: ${N.name}`, LIST_X + 24, y + 22, '#9be37a');
    font(500, 11);
    const opens = DIGGERS.filter(d => d.layer === s.layer + 1).map(d => d.name).join(' and ');
    const items = [
      `Bedrock: ${fmt(L.breach.gems)} gems and ${L.breach.ore} ${ORES[s.layer]} (you have ${fmt(s.ore[s.layer])})`,
      `Opens ${opens}, ${N.ore.toLowerCase()} ore and new research`,
      `Every digger digs another +${LAYER_BONUS * 100}%`,
    ];
    items.forEach((l, k) => text(clip('• ' + l, LIST_W - 30), LIST_X + 24, y + 44 + k * 18, '#8d94a1'));
    font(500, 11);
    text('Breach with the button under the rock.', LIST_X + 24, y + 120, '#5c6370');
  }

  function drawForge() {
    font(500, 11);
    text(`Bit slots: ${s.equip.length}/${bitSlots()} · bits are kept forever, ore is spent`, LIST_X + 14, 54, '#8d94a1');
    const bh = Math.min(52, Math.floor((H - 70) / BITS.length));
    BITS.forEach((b, n) => {
      const y = 66 + n * bh;
      const made = s.bits.includes(b.id);
      const on = s.equip.includes(b.id);
      const can = !made && Object.entries(b.cost).every(([k, v]) => s.ore[ORES.indexOf(k)] >= v);
      box(LIST_X + 12, y, LIST_W, bh - 5, on ? '#1a2a22' : made || can ? '#1f2530' : '#1a1d24', on ? '#9be37a' : can ? '#3b4658' : null);
      font(600, 14);
      text(b.name, LIST_X + 24, y + 18, made || can ? '#eceef2' : '#8d94a1');
      font(500, 11);
      text(clip(b.desc, 300), LIST_X + 24, y + 34, '#8d94a1');
      font(600, 12);
      if (made) text(on ? 'Equipped · tap to remove' : 'Tap to equip', W - 22, y + 28, on ? '#9be37a' : '#ffc53d', 'right');
      else {
        let x = W - 22;
        for (const [k, v] of Object.entries(b.cost).reverse()) {
          const t = ORES.indexOf(k);
          const str = `${v} ${k}`;
          text(str, x, y + 28, s.ore[t] >= v ? LAYERS[t].oreColor : '#5c6370', 'right');
          x -= ctx.measureText(str).width + 10;
        }
      }
      button(LIST_X + 12, y, LIST_W, bh - 5, { enabled: made || can, onClick: () => forge(b), why: `Forging needs ${oreText(b.cost)}` });
    });
  }

  function drawTrips() {
    font(500, 11);
    text('Send half of one digger type away. They dig nothing until they return', LIST_X + 14, 52, '#8d94a1');
    text('with gems, ore from this layer and maybe a relic. Trips run while you\'re away.', LIST_X + 14, 66, '#8d94a1');

    const now = Date.now();
    const slots = tripSlots();
    for (let k = 0; k < slots; k++) {
      const y = 78 + k * 46;
      const t = s.trips[k];
      box(LIST_X + 12, y, LIST_W, 40, '#1a1d24', '#2a2f39');
      if (!t) {
        font(500, 12);
        text('Empty slot', LIST_X + 24, y + 25, '#5c6370');
        continue;
      }
      const trip = TRIPS.find(x => x.id === t.trip);
      const p = Math.min(1, (now - t.start) / (t.secs * 1000));
      ctx.fillStyle = '#26364a';
      ctx.fillRect(LIST_X + 13, y + 1, (LIST_W - 2) * p, 38);
      font(600, 13);
      text(`${trip.name} · ${t.n} ${DIGGERS[t.tier].name}${t.n > 1 ? 's' : ''}`, LIST_X + 24, y + 17, '#eceef2');
      font(500, 11);
      text(t.runId === s.runId ? `Bringing back about ${fmt(tripReward(t).gems)} gems` : 'From an earlier dive: relic chance only', LIST_X + 24, y + 32, '#8d94a1');
      font(600, 12);
      text(`${fmtTime(tripEnd(t) / 1000 - now / 1000)} left`, W - 22, y + 25, '#7fdbff', 'right');
    }

    const y0 = 86 + slots * 46;
    const choices = DIGGERS.map((_, i) => i).filter(i => working(i) >= 2);
    if (!choices.includes(tripTier)) tripTier = choices.length ? choices[choices.length - 1] : -1;
    const idx = choices.indexOf(tripTier);
    box(LIST_X + 12, y0, LIST_W, 36, '#1f2530');
    drawArrow(LIST_X + 12, y0, '‹', idx > 0, () => { tripTier = choices[idx - 1]; });
    drawArrow(W - 12 - 36, y0, '›', idx >= 0 && idx < choices.length - 1, () => { tripTier = choices[idx + 1]; });
    font(600, 13);
    const n = tripTier >= 0 ? Math.floor(working(tripTier) / 2) : 0;
    text(tripTier >= 0 ? `Send ${n} of your ${working(tripTier)} ${DIGGERS[tripTier].name}s` : 'Hire at least 2 of a digger to send some', LIST_X + 12 + LIST_W / 2, y0 + 23, tripTier >= 0 ? '#eceef2' : '#5c6370', 'center');

    const busy = s.trips.length >= slots;
    TRIPS.forEach((trip, k) => {
      const y = y0 + 46 + k * 56;
      const secs = trip.secs * F.tripTime;
      const gems = tripTier >= 0 ? diggerRate(tripTier, n) * secs * trip.pay : 0;
      const ore = (gems * 0.1) / orePrice(s.layer);
      const ok = tripTier >= 0 && n >= 1 && !busy;
      drawBtn(LIST_X + 12, y, LIST_W, 50, `${trip.name} · ${fmtTime(secs)}`,
        `≈ ${fmt(gems)} gems · ${fmt(ore)} ${ORES[s.layer]} · ${Math.round(Math.min(1, trip.relic * F.relicChance) * 100)}% relic chance`,
        ok, () => sendTrip(trip), { accent: '#7fdbff', why: busy ? 'All expedition slots are busy' : 'Pick a digger type to send' });
    });
  }

  function drawArrow(x, y, label, enabled, onClick) {
    box(x, y, 36, 36, enabled ? '#2b3446' : '#1e222a');
    font(700, 20);
    text(label, x + 18, y + 25, enabled ? '#eceef2' : '#4a505c', 'center');
    button(x, y, 36, 36, { enabled, onClick });
  }

  function drawCore() {
    const free = s.shards - coreSpent();
    font(600, 13);
    text(`${s.shards} shards · ${free} to spend · +${s.shards * SHARD_PCT}% to everything`, LIST_X + 14, 56, '#c39bff');
    box(W - 100, 42, 78, 22, '#232833');
    font(600, 11);
    text('Reset tree', W - 61, 57, '#8d94a1', 'center');
    button(W - 100, 42, 78, 22, { enabled: s.core.length > 0, onClick: respec });

    const cw = (LIST_W - 16) / 3;
    BRANCHES.forEach((name, b) => {
      const x = LIST_X + 12 + b * (cw + 8);
      font(700, 12);
      text(name.toUpperCase(), x + cw / 2, 84, '#8d94a1', 'center');
      CORE.filter(c => c.branch === b).forEach((node, k, branch) => {
        const y = 94 + k * 88;
        const owned = s.core.includes(node.id);
        const open = k === 0 || s.core.includes(branch[k - 1].id);
        const can = !owned && open && free >= node.cost;
        if (k) {
          ctx.fillStyle = open ? '#c39bff' : '#2a2f39';
          ctx.fillRect(x + cw / 2 - 1, y - 8, 2, 8);
        }
        box(x, y, cw, 80, owned ? '#2a2140' : can ? '#1f2530' : '#1a1d24', owned ? '#c39bff' : can ? '#3b4658' : null);
        font(600, 12);
        text(clip(node.name, cw - 16), x + 8, y + 17, owned || open ? '#eceef2' : '#5c6370');
        font(500, 11);
        wrap(node.desc, cw - 16).slice(0, 2).forEach((l, j) => text(l, x + 8, y + 34 + j * 14, '#8d94a1'));
        font(600, 11);
        text(owned ? 'Active' : `${node.cost} shard${node.cost > 1 ? 's' : ''}`, x + 8, y + 70, owned ? '#c39bff' : can ? '#ffc53d' : '#5c6370');
        button(x, y, cw, 80, { enabled: can, onClick: () => buyCore(node), why: owned ? null : !open ? 'Take the node above it first' : `Needs ${node.cost} free shards` });
      });
    });
  }

  function drawRelics() {
    const cw = (LIST_W - 18) / 4;
    SETS.forEach((set, r) => {
      const y = 42 + r * 98;
      const done = set.id !== 'trial' && setDone(set);
      font(700, 12);
      text(set.name, LIST_X + 14, y + 12, done ? '#9be37a' : '#eceef2');
      const nameW = ctx.measureText(set.name).width;
      font(500, 11);
      const hint = set.id === 'trial' ? 'Won from challenge dives' : set.layer > s.maxLayer ? `${set.desc} · found once you've reached ${LAYERS[set.layer].name}` : `${set.desc} · found on expeditions`;
      text(clip(hint, LIST_W - nameW - 16), LIST_X + 26 + nameW, y + 12, done ? '#9be37a' : '#6b7280');
      RELICS.filter(x => x.set === set.id).forEach((relic, k) => {
        const x = LIST_X + 12 + k * (cw + 6);
        const have = s.relics.includes(relic.id);
        box(x, y + 20, cw, 70, have ? '#2a2614' : '#1a1d24', have ? '#ffc53d' : null);
        font(600, 12);
        text(clip(have ? relic.name : '???', cw - 12), x + 6, y + 38, have ? '#ffd54f' : '#4a505c');
        font(500, 10);
        if (have) wrap(relic.desc, cw - 12).slice(0, 2).forEach((l, j) => text(l, x + 6, y + 56 + j * 13, '#a7adb8'));
        else if (set.id === 'trial') {
          const c = CHALLENGES.find(ch => ch.relic === relic.id);
          text(clip(`Beat ${c.name}`, cw - 12), x + 6, y + 56, '#5c6370');
        }
      });
    });
  }

  function drawEcho() {
    const got = echoesOnCollapse();
    font(700, 15);
    text(`${s.echoes} echo${s.echoes === 1 ? '' : 'es'} · ×${fmtX(echoMult())} to everything`, LIST_X + 14, 60, '#80deea');
    font(500, 11);
    const lines = wrap(`Collapse the core from the Void Rift or deeper. Echoes = √shards (${Math.floor(Math.sqrt(s.shards))} now) + 2 for each layer past the Void Rift this run. Shards, the Core tree and shard difficulty reset; relics, bits and challenge wins stay.`, LIST_W - 4);
    lines.forEach((l, k) => text(l, LIST_X + 14, 80 + k * 14, '#8d94a1'));
    const by = 84 + lines.length * 14;
    drawBtn(LIST_X + 12, by, LIST_W, 46, got ? `Collapse the core · +${got} echo${got > 1 ? 'es' : ''}` : 'Collapse the core',
      got ? `then pick a legacy perk · collapse ${s.collapses + 1}` : `Breach into the ${LAYERS[COLLAPSE_LAYER].name} this run first`, got > 0, openCollapse,
      { accent: '#80deea', why: `Reach the ${LAYERS[COLLAPSE_LAYER].name} in this run to collapse the core` });

    font(700, 12);
    text('LEGACY PERKS · one per collapse, kept forever', LIST_X + 14, by + 70, '#8d94a1');
    const cw = (LIST_W - 8) / 2, ch = 44;
    LEGACY.forEach((l, n) => {
      const x = LIST_X + 12 + (n % 2) * (cw + 8);
      const y = by + 80 + Math.floor(n / 2) * (ch + 5);
      const have = s.legacy.includes(l.id);
      box(x, y, cw, ch, have ? '#14282c' : '#1a1d24', have ? '#80deea' : null);
      font(600, 12);
      text(l.name, x + 8, y + 17, have ? '#80deea' : '#a7adb8');
      font(500, 10);
      text(clip(l.desc, cw - 16), x + 8, y + 33, have ? '#a7adb8' : '#5c6370');
      if (l.id === 'foreman' && have) {
        font(700, 10);
        text(s.autoHire ? 'ON' : 'OFF', x + cw - 8, y + 17, s.autoHire ? '#9be37a' : '#ff8a80', 'right');
        button(x, y, cw, ch, { enabled: true, onClick: () => { s.autoHire = !s.autoHire; } });
      }
    });
  }

  function drawEffects(dt) {
    for (const f of floaters) f.t += dt;
    floaters = floaters.filter(f => f.t < 1.2);
    ctx.textAlign = 'center';
    for (const f of floaters) {
      ctx.globalAlpha = 1 - f.t / 1.2;
      ctx.fillStyle = f.hot ? '#ff7a7a' : f.big ? '#ffd54f' : '#eceef2';
      font(700, f.big ? 18 : 15);
      ctx.fillText(f.text, Math.min(LIST_X - 120, Math.max(120, f.x)), f.y - f.t * 60);
    }
    for (const c of chips) {
      c.t += dt;
      c.vy += 700 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      ctx.globalAlpha = Math.max(0, 1 - c.t / 0.8);
      ctx.fillStyle = c.c;
      ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
    }
    chips = chips.filter(c => c.t < 0.8 && c.x < LIST_X);
    ctx.globalAlpha = 1;

    if (nugget) {
      const pulse = 1 + Math.sin(nugget.t * 8) * 0.15;
      ctx.fillStyle = '#ffd54f';
      ctx.shadowColor = '#ffd54f';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(nugget.x, nugget.y, 16 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function updateHud() {
    $('gems').textContent = fmt(s.gems);
    $('rate').textContent = fmt(perSecond()) + '/s';
    $('depth').textContent = depth() + ' m';
  }

  // ---------- Loop ----------

  let last = performance.now(), t = 0, tripCheck = 0;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    t += dt;
    refresh();
    earn(perSecond() * dt);
    shake = Math.max(0, shake - dt);
    frenzy = Math.max(0, frenzy - dt);
    if (frenzy <= 0) rushStacks = 0;
    overheat = Math.max(0, overheat - dt);
    overT = Math.max(0, overT - dt);

    // Overdrive: announce it once each time the two boosts overlap.
    const od = overdrive();
    if (od && !wasOverdrive) {
      shake = Math.max(shake, 0.4);
      floaters.push({ x: ROCK.x, y: ROCK.y - 60, text: `OVERDRIVE! ×${F.overdrive} on top`, t: 0, big: true, hot: true });
      Arcade.tone({ freq: 220, to: 1760, dur: 0.5, type: 'sawtooth', vol: 0.05 });
      Arcade.flag('gem-mine-overdrive');
    }
    wasOverdrive = od;
    // Gold sparks fly off the rock during a rush, more with every stack.
    if (frenzy > 0 && Math.random() < dt * 5 * rushStacks) {
      const a = Arcade.rand(0, Math.PI * 2);
      chips.push({ x: ROCK.x + Math.cos(a) * 90, y: ROCK.y + Math.sin(a) * 90, vx: Math.cos(a) * 120, vy: -Arcade.rand(140, 300), t: 0, c: od ? '#ff8a65' : '#ffd54f' });
    }

    if ((tripCheck -= dt) <= 0) {
      tripCheck = 1;
      checkTrips();
      autoHire();
      // Never stuck: with clicking off and nothing digging, a Pebble Pup shows up for free.
      if (F.noClick && s.gems < unitCost(0) && s.owned.every((n, i) => working(i) === 0)) s.owned[0]++;
    }

    veinT -= dt;
    if (vein) {
      vein.t += dt;
      if (vein.t > VEIN_TIME) vein = null;
    } else if (veinT <= 0) {
      spawnVein();
      veinT = nextWait(25, 45, F.veinFreq);
    }

    nuggetT -= dt;
    if (nugget) {
      nugget.t += dt;
      if (nugget.t > 8) nugget = null;
    } else if (nuggetT <= 0) {
      spawnNugget();
      nuggetT = nextWait(60, 120, F.nuggetFreq);
    }

    buttons = [];
    drawRock(t);
    drawList();
    drawEffects(dt);
    updateHud();
    requestAnimationFrame(frame);
  }

  // Earnings while the tab was closed: half speed (more with upgrades), up to 8 hours (or 12).
  load();
  refresh();
  veinT = nextWait(25, 45, F.veinFreq);
  nuggetT = nextWait(60, 120, F.nuggetFreq);
  const away = Math.min(F.offlineCap * 3600, (Date.now() - s.saved) / 1000);
  const rate = Math.min(1, 0.5 + F.offline);
  const offline = s.lifetime > 0 && away > 30 ? baseRate() * away * rate : 0;
  checkTrips();
  if (offline > 0) {
    earn(offline);
    const hrs = Math.floor(away / 3600), mins = Math.floor((away % 3600) / 60);
    ui.show({
      title: 'Welcome back!',
      html: `<p>Your diggers kept working for ${hrs ? `${hrs}h ` : ''}${mins}m while you were away, at ${Math.round(rate * 100)}% speed.</p><p class="big">+${fmt(offline)}</p><p>gems${s.refine ? ` (${s.refine * 100}% went to the refinery)` : ''}</p>`,
      button: 'Collect',
      onAction: () => ui.hide(),
    });
  } else if (s.lifetime === 0) {
    ui.show({
      title: 'Gem Mine',
      html: `<ul>
        <li><b>Click the rock</b> (or press Space) to dig gems, and hire <b>diggers</b> to dig for you, even while you're away.</li>
        <li>The <b>refinery</b> turns part of what you dig into <b>ore</b>. Spend gems and ore to <b>breach the bedrock</b> into deeper, richer layers.</li>
        <li>Research in the <b>Lab</b>, unlock <b>abilities</b> (keys 1–3), forge <b>drill bits</b>, and send diggers on <b>expeditions</b> for relics.</li>
        <li>Catch the <b>golden nugget</b>, and hit <b>glowing veins</b> for gems and ore. Click over ${MAX_CPS} a second and your pick <b>overheats</b>.</li>
        <li><b>Combos:</b> a nugget caught during a gem rush <b>stacks</b> the rush (up to ${RUSH_MAX}). Overclock during a rush is <b>Overdrive</b>, and Dynamite or a vein hits much harder while a boost is running.</li>
        <li>Once you've dug ${fmt(SHARD_BASE)} gems in a run, <b>dive deeper</b> for core shards. Each dive makes the next shard harder to get.</li>
        <li>Far below Starfall Deep, reach the <b>Void Rift</b> to <b>collapse the core</b> for echoes and legacy perks.</li>
      </ul>`,
      button: 'Start digging',
      onAction: () => ui.hide(),
    });
  } else {
    ui.hide();
  }
  requestAnimationFrame(frame);
})();
