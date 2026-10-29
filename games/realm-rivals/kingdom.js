/* Realm Rivals: Kingdom, the long-term mode. A city that keeps growing in real time, even with
   the tab closed: upgrades and training finish while you're away, and the world map has
   bandit camps and bot kingdoms to raid (and bots that raid you back).

   With Firebase switched on, real players share the world too. Each kingdom publishes a
   snapshot (power, defenders, lootable stores) to kingdoms/<id>. An attacker's game fights
   the battle against that snapshot when its army arrives, then leaves a battle report in
   the defender's inbox (kinbox/<id>); the defender's game applies the losses next time it
   checks. No game server needed, but like the leaderboards it trusts each player's browser. */
(() => {
  const SAVE = 'kingdom:save';
  const HOUR = 3600000, MIN = 60000;
  const WORLD_W = 1000, WORLD_H = 700;
  const MAX_LV = 20;
  const RES = ['food', 'wood', 'stone', 'gold'];
  const RES_ICON = { food: '🌾', wood: '🪵', stone: '🪨', gold: '🪙' };
  const PEACE_KEEP = 4;           // beginner's peace lasts until the keep reaches this level…
  const PEACE_TIME = 72 * HOUR;   // …or this long, whichever comes first
  const RAID_SHIELD = 2 * HOUR;   // after being sacked, a kingdom can't be attacked again for a while

  const BUILDINGS = {
    keep: { name: 'Keep', base: { wood: 120, stone: 100 }, time: 40, desc: lv => `Other buildings can reach level ${lv + 1}. ${lv >= 6 ? 'Two builders.' : 'Level 6 hires a second builder.'}` },
    farm: { name: 'Farm', base: { wood: 60, stone: 20 }, time: 20, desc: lv => `${rate('food', lv)} food per hour` },
    lumber: { name: 'Lumber Mill', base: { food: 40, stone: 30 }, time: 20, desc: lv => `${rate('wood', lv)} wood per hour` },
    quarry: { name: 'Quarry', base: { food: 40, wood: 50 }, time: 25, desc: lv => `${rate('stone', lv)} stone per hour` },
    mine: { name: 'Gold Mine', base: { wood: 80, stone: 80 }, time: 30, needs: 2, desc: lv => `${rate('gold', lv)} gold per hour` },
    barracks: { name: 'Barracks', base: { wood: 100, stone: 60 }, time: 30, desc: lv => `Trains ${lv * 10} at a time, ${lv * 10}% faster. ${lv < 3 ? 'Level 3 unlocks archers.' : lv < 6 ? 'Level 6 unlocks cavalry.' : ''}` },
    wall: { name: 'Wall', base: { wood: 60, stone: 140 }, time: 35, needs: 2, desc: lv => `+${lv * 8}% defence and ${lv * 60} guard power` },
    warehouse: { name: 'Warehouse', base: { wood: 90, stone: 90 }, time: 25, desc: lv => `Holds ${storage(lv).toLocaleString()} of each; ${safe(lv).toLocaleString()} can't be stolen` },
  };
  const ORDER = ['keep', 'farm', 'lumber', 'quarry', 'mine', 'barracks', 'wall', 'warehouse'];

  // Infantry beats cavalry, cavalry beats archers, archers beat infantry.
  const TROOPS = {
    inf: { name: 'Infantry', atk: 10, def: 13, carry: 50, upkeep: 2, time: 8, cost: { food: 50, wood: 30 }, needs: 1 },
    arc: { name: 'Archers', atk: 14, def: 10, carry: 36, upkeep: 3, time: 12, cost: { food: 60, wood: 70 }, needs: 3 },
    cav: { name: 'Cavalry', atk: 24, def: 15, carry: 90, upkeep: 5, time: 20, cost: { food: 110, gold: 50 }, needs: 6 },
  };
  const TYPES = Object.keys(TROOPS);
  const BEATS = { inf: 'cav', cav: 'arc', arc: 'inf' };

  const BOT_NAMES = ['Ashford', 'Mirevale', 'Stonecrest', 'Duskhold', 'Emberreach', 'Thornwick', 'Glimmerfen', 'Ravenmoor', 'Saltmarsh', 'Highcairn', 'Wolfsden', 'Brightwater'];
  const BOT_COLORS = ['#e0a040', '#4fb3a9', '#9aa3ad', '#9b6bd6', '#ff8f5d', '#7fc06a', '#5b9bd5', '#c77dff', '#d4c060', '#6fd0d0', '#b08060', '#f07fb0'];

  const $ = id => document.getElementById(id);
  const esc = s => Online.escape(s);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const me = Arcade.profile();

  // ---------- Formulas ----------

  function rate(res, lv) {
    if (!lv) return 0;
    const per = { food: 220, wood: 200, stone: 150, gold: 90 }[res];
    return Math.round(per * lv * (1 + lv * 0.12));
  }
  const storage = lv => 4000 + lv * lv * 1500;
  const safe = lv => 600 * lv;
  const costOf = (id, lv) => Object.fromEntries(Object.entries(BUILDINGS[id].base).map(([r, n]) => [r, Math.round(n * Math.pow(1.62, lv))]));
  const timeOf = (id, lv) => Math.round(BUILDINGS[id].time * Math.pow(1.78, lv) * 1000); // ms, for reaching level lv + 1

  // A seeded random generator, so each player's bots and camps sit in the same places every visit.
  function seeded(str) {
    let a = 0;
    for (const ch of str) a = (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const homeOf = id => {
    const r = seeded('home:' + id);
    return { x: Math.round(220 + r() * (WORLD_W - 440)), y: Math.round(170 + r() * (WORLD_H - 340)) };
  };
  const HOME = homeOf(me.id);

  // ---------- Save data ----------

  function fresh() {
    const now = Date.now();
    return {
      v: 1, created: now, last: now,
      res: { food: 1200, wood: 1200, stone: 900, gold: 300 },
      b: { keep: 1, farm: 1, lumber: 1, quarry: 1, mine: 0, barracks: 1, wall: 0, warehouse: 1 },
      builds: [],              // [{ id, until }]
      troops: { inf: 10, arc: 0, cav: 0 },
      train: null,             // { type, left, next, per }
      marches: [],             // [{ id, target, army, arrive, back, phase, loot }]
      mail: [{ t: now, title: 'Welcome, ruler', text: 'Upgrade your farms and mills, train troops at the barracks, and raid bandit camps on the World map. Your kingdom keeps growing while you\'re away.', kind: 'info' }],
      camps: {},               // camp id → time it respawns
      bots: {},                // bot id → { hurtUntil }
      nextRaid: now + 3 * HOUR,
      shield: 0,
      stats: { wins: 0, losses: 0, defended: 0, sacked: 0 },
      unread: 1,
    };
  }

  let s = Arcade.load(SAVE, null);
  if (!s || s.v !== 1) s = fresh();

  const save = () => Arcade.save(SAVE, s);

  // ---------- Derived stats ----------

  const builders = () => (s.b.keep >= 6 ? 2 : 1);
  const cap = () => storage(s.b.warehouse);
  const upkeep = () => TYPES.reduce((n, t) => n + (s.troops[t] + marching(t)) * TROOPS[t].upkeep, 0);
  const marching = t => s.marches.reduce((n, m) => n + (m.army[t] || 0), 0);
  const income = r => rate(r, s.b[{ food: 'farm', wood: 'lumber', stone: 'quarry', gold: 'mine' }[r]]) - (r === 'food' ? upkeep() : 0);
  const armyCount = a => TYPES.reduce((n, t) => n + (a[t] || 0), 0);
  const attackPower = a => TYPES.reduce((n, t) => n + (a[t] || 0) * TROOPS[t].atk, 0);
  const defendPower = (troops, wall, keep) => TYPES.reduce((n, t) => n + (troops[t] || 0) * TROOPS[t].def, 0) * (1 + wall * 0.08) + wall * 60 + keep * 25;
  const myDefence = () => defendPower(s.troops, s.b.wall, s.b.keep);
  const power = () => Math.round(
    ORDER.reduce((n, id) => n + Math.pow(s.b[id], 1.6) * 40, 0) +
    TYPES.reduce((n, t) => n + (s.troops[t] + marching(t)) * (TROOPS[t].atk + TROOPS[t].def) / 2, 0));
  const inPeace = (now = Date.now()) => s.b.keep < PEACE_KEEP && now - s.created < PEACE_TIME;
  const shielded = (now = Date.now()) => inPeace(now) || s.shield > now;
  const lootable = () => Object.fromEntries(RES.map(r => [r, Math.max(0, Math.floor(s.res[r] - safe(s.b.warehouse)))]));
  const afford = cost => Object.entries(cost).every(([r, n]) => s.res[r] >= n);
  const pay = cost => { for (const [r, n] of Object.entries(cost)) s.res[r] -= n; };

  // How well one army's mix of troops matches up against another's.
  function edge(att, def) {
    const ta = armyCount(att) || 1, td = armyCount(def) || 1;
    let e = 0;
    for (const a of TYPES) for (const d of TYPES) {
      const m = BEATS[a] === d ? 1.2 : BEATS[d] === a ? 0.85 : 1;
      e += ((att[a] || 0) / ta) * ((def[d] || 0) / td) * m;
    }
    return armyCount(def) ? e : 1;
  }

  // One battle. Returns the winner and what share of each side is lost.
  function fight(att, defTroops, wall, keep) {
    const A = attackPower(att) * edge(att, defTroops) * Arcade.rand(0.9, 1.1);
    const D = Math.max(1, defendPower(defTroops, wall, keep));
    const ratio = A / D;
    const win = ratio > 1;
    return {
      win, ratio,
      attLoss: win ? clamp(0.35 / ratio, 0.04, 0.85) : clamp(0.6 + 0.25 * (1 / ratio - 1), 0.5, 0.95),
      defLoss: win ? clamp(0.3 * ratio, 0.3, 0.9) : clamp(0.3 * ratio, 0.03, 0.6),
    };
  }
  const shrink = (army, share) => Object.fromEntries(TYPES.map(t => [t, Math.max(0, Math.round((army[t] || 0) * (1 - share)))]));
  const carry = army => TYPES.reduce((n, t) => n + (army[t] || 0) * TROOPS[t].carry, 0);

  // Takes up to the army's carrying capacity, spread across the resources on offer.
  function takeLoot(offer, army) {
    let room = carry(army);
    const total = RES.reduce((n, r) => n + (offer[r] || 0), 0);
    if (!total) return Object.fromEntries(RES.map(r => [r, 0]));
    const k = Math.min(1, room / total);
    return Object.fromEntries(RES.map(r => [r, Math.floor((offer[r] || 0) * k)]));
  }
  const lootText = l => RES.filter(r => l[r]).map(r => `${l[r].toLocaleString()} ${r}`).join(', ') || 'nothing';

  // ---------- The world: camps, bots, and other players ----------

  // Spread around home on a golden-angle spiral (stronger targets further out). Anything that
  // would land off the map is reflected back across home.
  const rng = seeded('world:' + me.id);
  const turn = rng() * Math.PI * 2;
  const near = (n, d) => {
    const a = turn + n * 2.39996;
    let x = HOME.x + Math.cos(a) * d, y = HOME.y + Math.sin(a) * d;
    if (x < 40 || x > WORLD_W - 40) x = 2 * HOME.x - x;
    if (y < 40 || y > WORLD_H - 40) y = 2 * HOME.y - y;
    return { x: Math.round(clamp(x, 40, WORLD_W - 40)), y: Math.round(clamp(y, 40, WORLD_H - 40)) };
  };
  const CAMPS = Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i, kind: 'camp', lv: 1 + Math.floor(i * 1.1), name: 'Bandit camp', ...near(i * 2, 80 + i * 20) }));
  const BOTS = BOT_NAMES.map((name, i) => ({ id: 'b' + i, kind: 'bot', name, color: BOT_COLORS[i], base: Math.round(160 * Math.pow(1.42, i)), ...near(i * 2 + 1, 150 + i * 22) }));

  function campArmy(c) {
    const n = Math.round(8 * Math.pow(1.55, c.lv - 1));
    return { troops: { inf: Math.ceil(n * 0.5), arc: Math.ceil(n * 0.3), cav: Math.floor(n * 0.2 * (c.lv > 3)) }, wall: 0, keep: 0, loot: Object.fromEntries(RES.map(r => [r, Math.round(260 * c.lv * Math.pow(1.35, c.lv - 1) * (r === 'gold' ? 0.4 : 1))])) };
  }
  // Bots grow a little every day and recover from defeats after an hour.
  function botArmy(b, now = Date.now()) {
    const days = (now - s.created) / (24 * HOUR);
    const hurt = (s.bots[b.id]?.hurtUntil || 0) > now ? 0.45 : 1;
    const p = b.base * (1 + days * 0.18) * hurt;
    const n = p / 12;
    const mix = [[0.5, 0.3, 0.2], [0.3, 0.5, 0.2], [0.25, 0.25, 0.5]][+b.id.slice(1) % 3];
    const lv = clamp(Math.round(Math.log(p / 100) * 2), 1, MAX_LV);
    return {
      troops: { inf: Math.round(n * mix[0]), arc: Math.round(n * mix[1]), cav: Math.round(n * mix[2]) },
      wall: Math.floor(lv / 2), keep: lv,
      loot: Object.fromEntries(RES.map(r => [r, Math.round(p * (r === 'gold' ? 1 : 2.5))])),
    };
  }
  const campUp = (c, now = Date.now()) => (s.camps[c.id] || 0) <= now;

  let players = []; // other real kingdoms, from Firebase
  const dist = t => Math.hypot(t.x - HOME.x, t.y - HOME.y);
  const marchTime = t => Math.round((20 + dist(t) * 0.22) * 1000);

  // ---------- Time passing ----------

  // Runs everything that happened between the last save and `to`, in order: resource ticks
  // between events, then each finished upgrade, trained troop, march, or bot raid.
  function advance(to) {
    for (let guard = 0; guard < 5000; guard++) {
      const ev = nextEvent();
      const t = Math.min(to, ev ? ev.t : Infinity);
      produce(t - s.last);
      s.last = t;
      if (!ev || ev.t > to) break;
      ev.run();
    }
  }

  function nextEvent() {
    const evs = [];
    for (const b of s.builds) evs.push({ t: b.until, run: () => finishBuild(b) });
    if (s.train) evs.push({ t: s.train.next, run: trainOne });
    // A march whose battle against a real player is still being fetched waits for the result.
    for (const m of s.marches) if (!m.pending) evs.push({ t: m.phase === 'out' ? m.arrive : m.back, run: () => (m.phase === 'out' ? arrive(m) : homecoming(m)) });
    if (s.b.keep >= 3) evs.push({ t: s.nextRaid, run: botRaid });
    else s.nextRaid = Math.max(s.nextRaid, s.last + 2 * HOUR);
    return evs.sort((a, b) => a.t - b.t)[0] || null;
  }

  function produce(ms) {
    if (ms <= 0) return;
    const h = ms / HOUR;
    for (const r of RES) {
      const before = s.res[r];
      s.res[r] = Math.min(Math.max(before, cap()), before + income(r) * h);
    }
    if (s.res.food < 0) {
      // Hungry troops desert, a few percent per hour.
      s.res.food = 0;
      const share = Math.min(0.5, h * 0.05);
      const lost = armyCount(s.troops) - armyCount(shrink(s.troops, share));
      s.troops = shrink(s.troops, share);
      if (lost > 0 && Math.random() < 0.2) note('Troops deserting', 'Your food ran out and hungry troops are leaving. Upgrade your farms.', 'bad');
    }
  }

  function note(title, text, kind = 'info', t = s.last) {
    s.mail.unshift({ t, title, text, kind });
    s.mail.length = Math.min(s.mail.length, 40);
    s.unread++;
    dirty = true;
  }

  function finishBuild(b) {
    s.builds = s.builds.filter(x => x !== b);
    s.b[b.id]++;
    note(`${BUILDINGS[b.id].name} upgraded`, `Now level ${s.b[b.id]}. ${BUILDINGS[b.id].desc(s.b[b.id])}`, 'good', b.until);
    if (s.b.keep >= 10) Arcade.flag('realm-kingdom-keep');
    Arcade.tone({ freq: 440, to: 880, dur: 0.15, type: 'triangle', vol: 0.04 });
    dirty = true;
  }

  function trainOne() {
    const tr = s.train;
    s.troops[tr.type]++;
    tr.left--;
    if (tr.left <= 0) {
      note('Training complete', `Your new ${TROOPS[tr.type].name.toLowerCase()} are ready.`, 'good', tr.next);
      s.train = null;
    } else {
      tr.next += tr.per;
    }
    dirty = true;
  }

  // ---------- Actions ----------

  function upgrade(id) {
    const lv = s.b[id];
    const b = BUILDINGS[id];
    if (lv >= MAX_LV || s.builds.length >= builders() || s.builds.some(x => x.id === id)) return;
    if (id !== 'keep' && lv > s.b.keep) return;
    if (b.needs && s.b.keep < b.needs) return;
    const cost = costOf(id, lv);
    if (!afford(cost)) return;
    pay(cost);
    s.builds.push({ id, until: Date.now() + timeOf(id, lv) });
    Arcade.tone({ freq: 330, to: 660, dur: 0.12, type: 'triangle', vol: 0.04 });
    commit();
  }

  // Anything with under a minute left can be finished straight away, like most city builders.
  function finishFree(id) {
    const b = s.builds.find(x => x.id === id);
    if (!b || b.until - Date.now() > MIN) return;
    b.until = Date.now();
    tick();
  }

  function trainCost(type, n) {
    return Object.fromEntries(Object.entries(TROOPS[type].cost).map(([r, c]) => [r, c * n]));
  }
  const maxBatch = () => s.b.barracks * 10;

  function train(type, n) {
    const t = TROOPS[type];
    n = Math.floor(n);
    if (s.train || n < 1 || n > maxBatch() || s.b.barracks < t.needs) return;
    const cost = trainCost(type, n);
    if (!afford(cost)) return;
    pay(cost);
    const per = Math.round(t.time * 1000 / (1 + s.b.barracks * 0.1));
    s.train = { type, left: n, per, next: Date.now() + per };
    Arcade.tone({ freq: 440, dur: 0.05, vol: 0.03 });
    commit();
  }

  function send(target, army) {
    if (!armyCount(army) || TYPES.some(t => (army[t] || 0) > s.troops[t])) return;
    if (s.marches.length >= 2) return;
    if (shielded() && target.kind === 'player') s.shield = 0; // attacking a player gives up your own protection
    for (const t of TYPES) s.troops[t] -= army[t] || 0;
    const time = marchTime(target);
    s.marches.push({
      id: Date.now().toString(36), army: { ...army }, phase: 'out', loot: null,
      target: { kind: target.kind, id: target.id, name: target.name, x: target.x, y: target.y },
      arrive: Date.now() + time, back: 0, time,
    });
    Arcade.tone({ freq: 220, to: 330, dur: 0.2, type: 'sawtooth', vol: 0.04 });
    selected = null;
    tab = 'city';
    commit();
  }

  // ---------- Battles ----------

  function arrive(m) {
    m.phase = 'back';
    m.back = m.arrive + m.time;
    const t = m.target;
    if (t.kind === 'camp') {
      const camp = CAMPS.find(c => c.id === t.id);
      if (!campUp(camp, m.arrive)) {
        note('Camp already cleared', 'The bandits had already fled. Your army is heading home.', 'info', m.arrive);
        return;
      }
      resolve(m, campArmy(camp), () => { s.camps[camp.id] = m.arrive + 20 * MIN; });
    } else if (t.kind === 'bot') {
      const bot = BOTS.find(b => b.id === t.id);
      resolve(m, botArmy(bot, m.arrive), () => { s.bots[bot.id] = { hurtUntil: m.arrive + HOUR }; });
    } else {
      attackPlayer(m);
    }
  }

  function resolve(m, foe, onWin) {
    const r = fight(m.army, foe.troops, foe.wall, foe.keep);
    const sent = armyCount(m.army);
    m.army = shrink(m.army, r.attLoss);
    const lost = sent - armyCount(m.army);
    if (r.win) {
      m.loot = takeLoot(foe.loot, m.army);
      onWin();
      s.stats.wins++;
      note(`Victory at ${m.target.name}`, `You lost ${lost} troops. Your army is carrying home ${lootText(m.loot)}.`, 'good', m.arrive);
    } else {
      s.stats.losses++;
      note(`Defeat at ${m.target.name}`, `You lost ${lost} of ${sent} troops. Scout with a stronger army next time.`, 'bad', m.arrive);
    }
    dirty = true;
  }

  function homecoming(m) {
    s.marches = s.marches.filter(x => x !== m);
    for (const t of TYPES) s.troops[t] += m.army[t] || 0;
    if (m.loot) for (const r of RES) s.res[r] += m.loot[r] || 0;
    dirty = true;
  }

  // A bot kingdom raids you every few hours once your keep reaches level 3.
  function botRaid() {
    const at = s.nextRaid;
    s.nextRaid = at + Arcade.rand(2.5, 5) * HOUR;
    if (shielded(at)) return;
    const mine = power();
    const bot = BOTS.slice().sort((a, b) => Math.abs(botArmy(a, at).troops.inf * 30 - mine) - Math.abs(botArmy(b, at).troops.inf * 30 - mine))[0];
    const army = shrink(botArmy(bot, at).troops, Arcade.rand(0.35, 0.6));
    const r = fight(army, s.troops, s.b.wall, s.b.keep);
    const before = armyCount(s.troops);
    if (r.win) {
      s.troops = shrink(s.troops, r.defLoss);
      const loot = takeLoot(lootable(), shrink(army, r.attLoss));
      for (const x of RES) s.res[x] -= loot[x];
      s.shield = at + RAID_SHIELD;
      s.stats.sacked++;
      note(`${bot.name} sacked your city`, `They carried off ${lootText(loot)} and you lost ${before - armyCount(s.troops)} troops. A 2-hour peace shield is up. Build walls and a bigger warehouse.`, 'bad', at);
    } else {
      s.troops = shrink(s.troops, r.defLoss);
      s.stats.defended++;
      note(`You held off ${bot.name}`, `Their raid broke on your walls. You lost ${before - armyCount(s.troops)} troops.`, 'good', at);
    }
  }

  // ---------- Real players (Firebase) ----------

  const ONLINE = Online.enabled;

  function publish() {
    if (!ONLINE) return;
    Online.patch(`kingdoms/${me.id}`, {
      name: me.name, power: power(), keep: s.b.keep, x: HOME.x, y: HOME.y,
      def: { ...s.troops, wall: s.b.wall },
      loot: lootable(),
      peace: shielded() ? Math.max(s.shield, inPeace() ? s.created + PEACE_TIME : 0) : 0,
      t: Online.TIMESTAMP,
    }).catch(() => {});
  }

  async function loadPlayers() {
    if (!ONLINE) return;
    try {
      const data = await Online.get('kingdoms', `?orderBy=${encodeURIComponent('"t"')}&startAt=${Date.now() - 14 * 24 * HOUR}`);
      players = Object.entries(data || {})
        .filter(([id, k]) => id !== me.id && k && typeof k.name === 'string')
        .map(([id, k]) => ({ id, kind: 'player', name: k.name, power: k.power | 0, keep: k.keep | 0, x: k.x | 0, y: k.y | 0, def: k.def || {}, loot: k.loot || {}, peace: k.peace || 0, shield: k.shield || 0, t: k.t }));
      dirty = true;
    } catch {}
  }

  async function attackPlayer(m) {
    m.pending = true; // the battle report goes out once we've seen their latest defences
    let k = null;
    try { k = await Online.get(`kingdoms/${m.target.id}`); } catch {}
    m.pending = false;
    if (!k) {
      note(`${m.target.name} couldn't be found`, 'Their kingdom has moved out of reach. Your army is heading home.', 'info', m.arrive);
      return commit();
    }
    if (Math.max(k.peace || 0, k.shield || 0) > Date.now()) {
      note(`${m.target.name} is protected`, 'A peace shield covers their city, so your army turned back.', 'info', m.arrive);
      return commit();
    }
    const def = { inf: k.def?.inf | 0, arc: k.def?.arc | 0, cav: k.def?.cav | 0 };
    const r = fight(m.army, def, k.def?.wall | 0, k.keep | 0);
    const sent = armyCount(m.army);
    m.army = shrink(m.army, r.attLoss);
    const loot = r.win ? takeLoot(k.loot || {}, m.army) : null;
    m.loot = loot;
    if (r.win) {
      s.stats.wins++;
      Arcade.flag('realm-kingdom-pvp');
      Online.patch(`kingdoms/${m.target.id}`, { shield: Date.now() + RAID_SHIELD }).catch(() => {});
      note(`You sacked ${m.target.name}!`, `A real player's city fell to your army. You lost ${sent - armyCount(m.army)} troops and are carrying home ${lootText(loot)}.`, 'good', m.arrive);
    } else {
      s.stats.losses++;
      note(`${m.target.name} held their walls`, `You lost ${sent - armyCount(m.army)} of ${sent} troops.`, 'bad', m.arrive);
    }
    Online.post(`kinbox/${m.target.id}`, { from: me.name, win: r.win, loss: Math.round(r.defLoss * 1000) / 1000, loot: loot || {}, t: Online.TIMESTAMP }).catch(() => {});
    commit();
  }

  // Defender: battle reports other players left while we were away.
  async function checkInbox() {
    if (!ONLINE) return;
    let box;
    try { box = await Online.get(`kinbox/${me.id}`); } catch { return; }
    if (!box) return;
    for (const [key, r] of Object.entries(box).sort((a, b) => (a[1].t || 0) - (b[1].t || 0))) {
      Online.remove(`kinbox/${me.id}/${key}`).catch(() => {});
      if (!r || typeof r.from !== 'string') continue;
      const before = armyCount(s.troops);
      s.troops = shrink(s.troops, clamp(+r.loss || 0, 0, 0.9));
      const lost = before - armyCount(s.troops);
      if (r.win) {
        const taken = Object.fromEntries(RES.map(x => [x, Math.min(Math.max(0, s.res[x]), Math.max(0, +r.loot?.[x] || 0))]));
        for (const x of RES) s.res[x] -= taken[x];
        s.shield = Math.max(s.shield, (r.t || Date.now()) + RAID_SHIELD);
        s.stats.sacked++;
        note(`${r.from} sacked your city`, `A real player broke through and took ${lootText(taken)}. You lost ${lost} troops. A 2-hour peace shield is up.`, 'bad', r.t || Date.now());
      } else {
        s.stats.defended++;
        note(`You beat back ${r.from}`, `A real player's army broke on your walls. You lost ${lost} troops.`, 'good', r.t || Date.now());
      }
    }
    commit();
  }

  // ---------- UI ----------

  let tab = 'city', selected = null, dirty = true;
  const view = $('view');

  const fmt = n => {
    n = Math.floor(n);
    return n >= 100000 ? Math.round(n / 1000) + 'k' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString();
  };
  const dur = ms => {
    const t = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return h ? `${h}h ${m}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
  };
  const ago = t => {
    const m = Math.round((Date.now() - t) / MIN);
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  const costHtml = cost => Object.entries(cost).map(([r, n]) => `<span class="${s.res[r] >= n ? '' : 'short'}">${RES_ICON[r]} ${fmt(n)}</span>`).join(' ');
  const timer = until => `<span data-until="${until}">${dur(until - Date.now())}</span>`;

  function renderTabs() {
    const tabs = [['city', 'City'], ['army', 'Army'], ['world', 'World'], ['mail', `Mail${s.unread ? ` (${s.unread})` : ''}`], ['ranks', 'Rankings']];
    $('tabs').innerHTML = tabs.map(([id, label]) => `<button class="chip" type="button" data-tab="${id}" aria-pressed="${tab === id}">${label}</button>`).join('');
  }

  function renderRes() {
    const c = cap();
    $('res').innerHTML = RES.map(r => {
      const inc = income(r);
      return `<span title="${r}: ${inc >= 0 ? '+' : ''}${inc}/h, holds ${c.toLocaleString()}">${RES_ICON[r]}<b class="${s.res[r] >= c ? 'full' : ''}">${fmt(s.res[r])}</b></span>`;
    }).join('') + `<span>Power<b>${fmt(power())}</b></span>`;
  }

  function cityHtml() {
    const busy = s.builds.length >= builders();
    const queue = s.builds.map(b => `<li><b>${BUILDINGS[b.id].name} → ${s.b[b.id] + 1}</b> ${timer(b.until)}
      ${b.until - Date.now() <= MIN ? `<button class="btn" type="button" data-act="free:${b.id}">Finish free</button>` : ''}</li>`).join('');
    const marches = s.marches.map(m => `<li><b>${m.phase === 'out' ? 'Marching on' : 'Returning from'} ${esc(m.target.name)}</b> ${armyCount(m.army)} troops · ${m.pending ? 'fighting…' : timer(m.phase === 'out' ? m.arrive : m.back)}</li>`).join('');
    const shield = shielded() ? `<p class="k-note good">🛡 ${inPeace() ? `Beginner's peace until your keep reaches level ${PEACE_KEEP}` : 'Peace shield up'} · nobody can attack you${inPeace() ? '' : ` for ${dur(s.shield - Date.now())}`}</p>`
      : s.b.keep >= 3 ? `<p class="k-note">Bot kingdoms may raid you. Defence ${fmt(myDefence())} · ${fmt(safe(s.b.warehouse))} of each resource is safe.</p>` : '';
    const cards = ORDER.map(id => {
      const b = BUILDINGS[id], lv = s.b[id];
      const up = s.builds.find(x => x.id === id);
      const locked = b.needs && s.b.keep < b.needs;
      const capped = id !== 'keep' && lv > s.b.keep;
      const cost = costOf(id, lv);
      let action;
      if (up) action = `<p class="k-busy">Upgrading · ${timer(up.until)}</p>`;
      else if (lv >= MAX_LV) action = '<p class="k-busy">Max level</p>';
      else if (locked) action = `<p class="k-busy">Needs keep level ${b.needs}</p>`;
      else if (capped) action = `<p class="k-busy">Upgrade the keep first</p>`;
      else action = `<p class="k-cost">${costHtml(cost)} · ⏱ ${dur(timeOf(id, lv))}</p>
        <button class="btn ${afford(cost) && !busy ? '' : 'secondary'}" type="button" data-act="up:${id}" ${afford(cost) && !busy ? '' : 'disabled'}>${lv ? `Upgrade to ${lv + 1}` : 'Build'}</button>`;
      return `<div class="k-card"><h3>${b.name} <span>${lv ? `Lv ${lv}` : 'Not built'}</span></h3><p>${b.desc(Math.max(1, lv))}</p>${action}</div>`;
    }).join('');
    return `${shield}
      <section class="k-row">
        <div class="box"><h2>Builders (${s.builds.length}/${builders()})</h2>${queue ? `<ul class="k-list">${queue}</ul>` : '<p class="k-note">Idle. Pick a building to upgrade.</p>'}</div>
        <div class="box"><h2>Armies out (${s.marches.length}/2)</h2>${marches ? `<ul class="k-list">${marches}</ul>` : '<p class="k-note">None. Raid a camp from the World tab.</p>'}</div>
      </section>
      <div class="k-grid">${cards}</div>`;
  }

  function armyHtml() {
    const rows = TYPES.map(type => {
      const t = TROOPS[type];
      const locked = s.b.barracks < t.needs;
      const most = locked ? 0 : Math.max(0, Math.min(maxBatch(), ...Object.entries(t.cost).map(([r, c]) => Math.floor(s.res[r] / c))));
      return `<div class="k-card">
        <h3>${t.name} <span>${s.troops[type]} home${marching(type) ? ` · ${marching(type)} out` : ''}</span></h3>
        <p>Attack ${t.atk} · defence ${t.def} · carries ${t.carry} · eats ${t.upkeep} food/h. Strong against ${TROOPS[BEATS[type]].name.toLowerCase()}.</p>
        ${locked ? `<p class="k-busy">Needs barracks level ${t.needs}</p>` : `
        <p class="k-cost">Each: ${costHtml(t.cost)}</p>
        <div class="k-train"><input class="field" type="number" min="1" max="${maxBatch()}" value="${Math.max(1, Math.min(10, most))}" data-n="${type}" aria-label="How many ${t.name}">
        <button class="btn ${s.train || !most ? 'secondary' : ''}" type="button" data-act="train:${type}" ${s.train || !most ? 'disabled' : ''}>Train</button>
        <button class="btn secondary" type="button" data-act="trainmax:${type}" ${s.train || !most ? 'disabled' : ''}>Max ${most}</button></div>`}
      </div>`;
    }).join('');
    const tr = s.train;
    return `<section class="box"><h2>Barracks</h2>
        ${tr ? `<p>Training ${tr.left} ${TROOPS[tr.type].name.toLowerCase()} · next in ${timer(tr.next)} · all done in ${timer(tr.next + tr.per * (tr.left - 1))}</p>` : `<p class="k-note">Ready. Trains up to ${maxBatch()} at once.</p>`}
        <p class="k-note">Attack power at home ${fmt(attackPower(s.troops))} · city defence ${fmt(myDefence())} · food upkeep ${upkeep()}/h</p>
      </section>
      <div class="k-grid">${rows}</div>`;
  }

  function targets() {
    const now = Date.now();
    const list = [
      ...CAMPS.map(c => ({ ...c, up: campUp(c, now), info: campArmy(c), label: `Level ${c.lv} bandits` })),
      ...BOTS.map(b => ({ ...b, up: true, info: botArmy(b, now), label: (s.bots[b.id]?.hurtUntil || 0) > now ? 'Bot kingdom · recovering' : 'Bot kingdom' })),
      ...players.map(p => ({ ...p, up: Math.max(p.peace, p.shield) <= now, info: { troops: p.def, wall: p.def.wall | 0, keep: p.keep, loot: p.loot }, label: `Player · keep ${p.keep} · ${ago(p.t)}` })),
    ];
    for (const t of list) t.def = Math.round(defendPower(t.info.troops, t.info.wall, t.info.keep));
    return list;
  }

  function worldHtml() {
    const list = targets();
    const sel = selected && list.find(t => t.id === selected);
    const mine = attackPower(s.troops);
    let side;
    if (sel) {
      const odds = !mine ? 'No troops at home' : mine * 1.0 > sel.def * 1.2 ? 'Good odds' : mine > sel.def * 0.9 ? 'Risky' : 'Bad odds';
      const blocked = !sel.up ? (sel.kind === 'camp' ? `Cleared · back in ${timer(s.camps[sel.id])}` : 'Protected by a peace shield') : s.marches.length >= 2 ? 'Both armies are out' : '';
      side = `<h2>${esc(sel.name)}</h2><p class="k-note">${esc(sel.label)} · ${dur(marchTime(sel))} march</p>
        <p>Defence ≈ <b>${fmt(sel.def)}</b> · your attack at home <b>${fmt(mine)}</b> (${odds})</p>
        <p class="k-note">Loot on offer: ${lootText(Object.fromEntries(RES.map(r => [r, Math.floor(sel.info.loot?.[r] || 0)])))}</p>
        ${sel.kind === 'player' && shielded() ? '<p class="k-note">Attacking a player ends your own peace shield.</p>' : ''}
        ${blocked ? `<p class="k-busy">${blocked}</p>` : `
        <div class="k-send">${TYPES.map(t => `<label>${TROOPS[t].name}<input class="field" type="number" min="0" max="${s.troops[t]}" value="${s.troops[t]}" data-send="${t}"></label>`).join('')}</div>
        <button class="btn" type="button" data-act="send:${sel.id}" ${armyCount(s.troops) ? '' : 'disabled'}>Send army</button>`}`;
    } else {
      side = `<h2>World</h2><p class="k-note">Tap a camp or kingdom on the map. Bandit camps come back 20 minutes after you clear them.</p>
        ${ONLINE ? `<p class="k-note">${players.length} real player${players.length === 1 ? '' : 's'} share this world.</p>` : '<p class="k-note">Real players appear here once the arcade\'s online features are switched on.</p>'}`;
    }
    return `<section class="k-row k-world"><div class="k-map"><canvas id="map"></canvas></div><div class="box">${side}</div></section>`;
  }

  function drawMap() {
    const canvas = $('map');
    if (!canvas) return;
    const w = canvas.parentElement.clientWidth, h = Math.round(w * WORLD_H / WORLD_W);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';
    const c = canvas.getContext('2d');
    c.setTransform(dpr * w / WORLD_W, 0, 0, dpr * w / WORLD_W, 0, 0);
    c.fillStyle = '#1f3324';
    c.fillRect(0, 0, WORLD_W, WORLD_H);
    const r = seeded('terrain');
    for (let i = 0; i < 90; i++) {
      c.fillStyle = r() < 0.5 ? '#264029' : '#2c4a2d';
      c.beginPath();
      c.arc(r() * WORLD_W, r() * WORLD_H, 10 + r() * 40, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#20384a';
    c.beginPath();
    c.ellipse(WORLD_W * 0.78, WORLD_H * 0.2, 90, 50, 0.4, 0, Math.PI * 2);
    c.fill();

    for (const m of s.marches) {
      const total = m.time, now = Date.now();
      const k = m.phase === 'out' ? 1 - (m.arrive - now) / total : (m.back - now) / total;
      const x = HOME.x + (m.target.x - HOME.x) * clamp(k, 0, 1), y = HOME.y + (m.target.y - HOME.y) * clamp(k, 0, 1);
      c.strokeStyle = 'rgba(79,140,255,0.5)';
      c.setLineDash([6, 6]);
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(HOME.x, HOME.y); c.lineTo(m.target.x, m.target.y); c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#4f8cff';
      c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill();
    }

    c.font = '600 15px system-ui, sans-serif';
    c.textAlign = 'center';
    for (const t of targets()) {
      const on = t.id === selected;
      if (t.kind === 'camp') {
        c.globalAlpha = t.up ? 1 : 0.3;
        c.fillStyle = '#b07a48';
        c.beginPath(); c.moveTo(t.x, t.y - 12); c.lineTo(t.x + 12, t.y + 9); c.lineTo(t.x - 12, t.y + 9); c.closePath(); c.fill();
        c.fillStyle = '#eceef2';
        c.fillText(t.lv, t.x, t.y + 26);
      } else {
        c.fillStyle = t.kind === 'player' ? '#ff5d5d' : t.color;
        c.fillRect(t.x - 11, t.y - 11, 22, 22);
        c.fillStyle = '#eceef2';
        c.fillText(t.name, t.x, t.y + 30);
        if (!t.up) { c.strokeStyle = '#8fd3ff'; c.lineWidth = 2; c.beginPath(); c.arc(t.x, t.y, 18, 0, Math.PI * 2); c.stroke(); }
      }
      c.globalAlpha = 1;
      if (on) { c.strokeStyle = '#ffc53d'; c.lineWidth = 3; c.strokeRect(t.x - 17, t.y - 17, 34, 34); }
    }
    c.fillStyle = '#ffc53d';
    c.fillRect(HOME.x - 14, HOME.y - 14, 28, 28);
    c.fillStyle = '#1c1500';
    c.font = '700 14px system-ui, sans-serif';
    c.fillText('You', HOME.x, HOME.y + 5);

    canvas.onclick = e => {
      const b = canvas.getBoundingClientRect();
      const x = (e.clientX - b.left) * WORLD_W / b.width, y = (e.clientY - b.top) * WORLD_W / b.width;
      let best = null, bestD = 30;
      for (const t of targets()) {
        const d = Math.hypot(t.x - x, t.y - y);
        if (d < bestD) { bestD = d; best = t; }
      }
      selected = best?.id || null;
      dirty = true;
      render();
    };
  }

  function mailHtml() {
    s.unread = 0;
    save();
    return `<section class="box"><h2>Reports</h2><ul class="k-mail">${s.mail.map(m => `
      <li class="${m.kind}"><b>${esc(m.title)}</b><span>${ago(m.t)}</span><p>${esc(m.text)}</p></li>`).join('')}</ul></section>
      <p class="k-note">${s.stats.wins} victories · ${s.stats.losses} defeats · ${s.stats.defended} raids held off · sacked ${s.stats.sacked} times</p>`;
  }

  let ranks = null;
  function ranksHtml() {
    if (!ONLINE) return `<section class="box"><h2>Rankings</h2><p class="k-note">Rankings appear once the arcade's online features are switched on. Your power is ${fmt(power())}.</p></section>`;
    if (!ranks) {
      Online.get('kingdoms', `?orderBy=${encodeURIComponent('"power"')}&limitToLast=25`)
        .then(d => {
          ranks = Object.entries(d || {}).map(([id, k]) => ({ id, ...k })).sort((a, b) => b.power - a.power);
          dirty = true;
        })
        .catch(() => { ranks = []; dirty = true; });
      return '<section class="box"><h2>Rankings</h2><p class="board-note">Loading…</p></section>';
    }
    return `<section class="box"><h2>Most powerful kingdoms</h2>
      <table class="table"><thead><tr><th>#</th><th>Ruler</th><th style="text-align:right">Keep</th><th style="text-align:right">Power</th></tr></thead>
      <tbody>${ranks.map((k, i) => `<tr class="${k.id === me.id ? 'me' : ''}"><td>${i + 1}</td><td>${esc(k.name)}</td><td class="num">${k.keep | 0}</td><td class="num">${(k.power | 0).toLocaleString()}</td></tr>`).join('')}</tbody></table></section>`;
  }

  function render() {
    renderTabs();
    renderRes();
    const html = { city: cityHtml, army: armyHtml, world: worldHtml, mail: mailHtml, ranks: ranksHtml }[tab]();
    // Keep whatever is typed into number boxes across re-renders.
    const typed = {};
    view.querySelectorAll('input[data-n], input[data-send]').forEach(i => { typed[i.dataset.n || 's' + i.dataset.send] = i.value; });
    view.innerHTML = html;
    view.querySelectorAll('input[data-n], input[data-send]').forEach(i => {
      const key = i.dataset.n || 's' + i.dataset.send;
      if (typed[key] !== undefined && document.activeElement !== i) i.value = typed[key];
    });
    if (tab === 'world') drawMap();
    dirty = false;
  }

  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    if (tab === 'ranks') ranks = null;
    if (tab === 'world') loadPlayers();
    render();
  });

  view.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const [act, arg] = b.dataset.act.split(':');
    if (act === 'up') upgrade(arg);
    else if (act === 'free') finishFree(arg);
    else if (act === 'train') train(arg, +view.querySelector(`[data-n="${arg}"]`).value);
    else if (act === 'trainmax') train(arg, +b.textContent.replace(/\D/g, ''));
    else if (act === 'send') {
      const army = Object.fromEntries(TYPES.map(t => [t, clamp(Math.floor(+view.querySelector(`[data-send="${t}"]`).value || 0), 0, s.troops[t])]));
      const t = targets().find(x => x.id === arg);
      if (t) send(t, army);
    }
  });

  // ---------- Loop ----------

  function commit() {
    save();
    publish();
    dirty = true;
    render();
  }

  function tick() {
    advance(Date.now());
    save();
    // Don't rebuild the page under someone typing a number; just refresh the counters.
    const typing = view.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (dirty && !typing) render();
    else {
      renderRes();
      view.querySelectorAll('[data-until]').forEach(el => { el.textContent = dur(+el.dataset.until - Date.now()); });
    }
  }

  // Catch up on everything that happened while the tab was closed. A player battle that was
  // still being fetched when the tab closed gets fought again now.
  for (const m of s.marches) {
    if (!m.pending) continue;
    if (ONLINE) attackPlayer(m);
    else m.pending = false;
  }
  const away = Date.now() - s.last;
  advance(Date.now());
  if (away > 5 * MIN) {
    const unread = s.mail.slice(0, s.unread).length;
    Arcade.toast('Welcome back', `${dur(away)} away${unread ? ` · ${unread} new report${unread > 1 ? 's' : ''}` : ''}`);
  }
  save();
  render();
  setInterval(tick, 1000);
  if (ONLINE) {
    publish();
    loadPlayers();
    checkInbox();
    setInterval(() => { if (!document.hidden) { publish(); checkInbox(); } }, 30000);
    setInterval(() => { if (!document.hidden && tab === 'world') loadPlayers(); }, 60000);
  }
  // Counts as a play once per day you check in, for profile stats.
  if (Arcade.load('kingdom:day', '') !== new Date().toDateString()) {
    Arcade.save('kingdom:day', new Date().toDateString());
    Arcade.countPlay();
  }
  window.addEventListener('resize', () => { if (tab === 'world') drawMap(); });
})();
