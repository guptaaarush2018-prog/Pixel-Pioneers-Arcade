/* Rune Rumble: real-time lane battles with a card collection. Menus (Battle, Cards, Path) sit
   over the battlefield; matches are played against a bot (the ladder, or practice) or another
   player online. Card levels only count on the ladder. Content is in data.js, drawing in art.js, sound in sound.js. */
(() => {
  const W = 960, FIELD_H = 410;
  const LANES = [95, 205, 315];
  const MID = W / 2;
  const KEEP_X = [44, W - 44];
  const TOWER_X = [150, W - 150];
  const DEPLOY = [[80, MID - 40], [MID + 40, W - 80]];   // where each side may place units
  const STEP = 1 / 20;
  const MATCH_TIME = 180, OVERTIME = 60, SURGE_AT = 60, SURGE_MULT = 1.5;
  const MANA_MAX = 10, MANA_EVERY = 2.8;
  const WELL_REACH = 60, WELL_CLAIM = 4, WELL_BONUS = 0.15;   // a well sits on each bridge; seconds to claim; mana per well held
  const SEND_EVERY = 0.08;
  const FIELD = { W, FIELD_H, LANES, MID, KEEP_X };
  const D = RuneData, A = RuneArt, S = RuneSound;
  const COLORS = { me: Arcade.equipped('rune-team')?.colors[0] || '#4f8cff', them: '#ff5d5d' };
  const BUILDING_BASE = {
    tower: { hp: 1100, dmg: 45, rate: 0.9, range: 165, r: 20 },
    keep: { hp: 2400, dmg: 80, rate: 1.0, range: 150, r: 30 },
  };
  const PRACTICE = [
    { name: 'Easy', think: 2.2, mana: 0.65, slip: 0.4, react: 1.6, save: 10, mult: 1 },
    { name: 'Normal', think: 1.7, mana: 0.8, slip: 0.32, react: 1.2, save: 9, mult: 1.5 },
    { name: 'Hard', think: 0.9, mana: 1, slip: 0.12, react: 0.7, save: 8, mult: 2 },
  ];
  const SPELL_DELAY = { cinder: 0.45, needles: 0.5, stormcall: 0.2 };
  const SHOT_STYLE = { bowmen: 'arrow', flamebow: 'fire-arrow', tower: 'arrow', keep: 'arrow', longshot: 'musket', sapper: 'bomb', adept: 'fire', wyrmling: 'fire', ashwing: 'fire', stormmage: 'bolt', gravecaller: 'dark', turret: 'spear', bombard: 'ball', sunlance: 'beam' };
  const CI = Object.fromEntries(D.CARDS.map((c, i) => [c.id, i]));
  // Test hook: #autopilot plays your cards at random, runs bot matches fast and never posts scores.
  const AUTOPILOT = location.hash === '#autopilot';

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const body = document.body;
  const canvas = $('game'), stage = $('stage'), screens = $('screens');
  const ctx = canvas.getContext('2d');
  const ui = Arcade.overlay($('overlay'));

  // ---------- Saved progress ----------

  const gold = () => Arcade.load('rune:gold', 0);
  function addGold(n) {
    Arcade.save('rune:gold', Math.max(0, gold() + n));
    updatePurse(true);
  }
  const glory = () => Arcade.load('rune:trophies', 0);
  const arenaIdx = () => D.arenaFor(glory());
  const arena = () => D.ARENAS[arenaIdx()];

  // Cards were renamed; saves made before that still use the old ids.
  (function migrateCardIds() {
    if (Arcade.load('rune:ids2', false)) return;
    const OLD = { archers: 'bowmen', skeletons: 'sprites', knight: 'bulwark', bomber: 'sapper', arrows: 'needles', bats: 'moths', zap: 'snap', cannon: 'bombard', fireball: 'cinder', valkyrie: 'whirlblade', musketeer: 'longshot', healer: 'mender', goblinhut: 'burrow', ramrider: 'charger', wizard: 'adept', dragon: 'wyrmling', freeze: 'frostbind', golem: 'colossus', necro: 'gravecaller', lightning: 'stormcall', rage: 'hymn', princess: 'flamebow', electro: 'stormmage', inferno: 'sunlance', phoenix: 'ashwing' };
    const cards = Arcade.load('rune:cards', null), ds = Arcade.load('rune:decks', null);
    if (cards) Arcade.save('rune:cards', Object.fromEntries(Object.entries(cards).map(([id, c]) => [OLD[id] || id, c])));
    if (Array.isArray(ds)) Arcade.save('rune:decks', ds.map(d => (Array.isArray(d) ? d.map(id => OLD[id] || id) : d)));
    Arcade.save('rune:ids2', true);
  })();

  // Your collection: { id: { lvl, count } }. Everyone starts with the eight starter cards.
  function collection() {
    let col = Arcade.load('rune:cards', null);
    if (!col) {
      col = Object.fromEntries(D.STARTER.map(id => [id, { lvl: 1, count: 0 }]));
      Arcade.save('rune:cards', col);
    }
    return col;
  }
  const saveCollection = col => Arcade.save('rune:cards', col);
  const owns = id => !!collection()[id];
  const levelOf = id => collection()[id]?.lvl || 1;
  const copiesFor = (card, lvl) => D.RARITIES[card.rarity].copies[lvl - 1];
  const canUpgrade = id => {
    const c = collection()[id], card = D.card(id);
    return c && c.lvl < D.MAX_LEVEL && c.count >= copiesFor(card, c.lvl) && gold() >= D.UPGRADE_GOLD[c.lvl - 1];
  };

  function decks() {
    let ds = Arcade.load('rune:decks', null);
    const valid = d => Array.isArray(d) && d.length === 8 && d.every(owns) && new Set(d).size === 8;
    if (!Array.isArray(ds) || ds.length !== 3) ds = [D.STARTER, D.STARTER, D.STARTER].map(d => [...d]);
    ds = ds.map(d => (valid(d) ? d : [...D.STARTER]));
    return ds;
  }
  const deckIdx = () => Arcade.load('rune:deck', 0);
  const myDeck = () => decks()[deckIdx()];

  // Four cache slots. Each slot: null, or { type, charge }. Battles charge the oldest unfinished one.
  const slots = () => {
    const s = Arcade.load('rune:chests', null);
    if (!Array.isArray(s) || s.length !== 4) return [{ type: 'silver', charge: 0 }, null, null, null];
    // Saves from when caches ran on timers: one that had finished stays ready.
    return s.map(x => (!x || x.charge !== undefined ? x : { type: x.type, charge: x.unlockAt && x.unlockAt <= Date.now() ? D.CACHES[x.type].battles : 0 }));
  };
  const saveSlots = s => Arcade.save('rune:chests', s);

  function updatePurse(bump = false) {
    $('gold').textContent = gold().toLocaleString();
    $('glory').textContent = glory().toLocaleString();
    if (bump) {
      const p = document.querySelector('.purse');
      p.classList.remove('bump');
      void p.offsetWidth;
      p.classList.add('bump');
    }
  }

  // ---------- Match state ----------

  let mode = null;      // 'ranked' | 'practice' | 'host' | 'guest' | null (menu)
  let state = 'menu';   // 'menu' | 'playing' | 'paused' | 'over'
  let practice = 1;
  let me = 0;           // the side this device plays: 0 left, 1 right (guests are drawn mirrored)
  let g = null;         // the match; on a guest, rebuilt from snapshots
  let bot = null;       // { think, mana, name }
  let selected = -1;
  let picked = -1;      // squad of your troops picked to switch lanes
  let hover = null;     // [world x, world y] under the pointer
  let net = null;       // { conn, names, sendT, want: { me, them }, deck }
  let snaps = [];       // guest: the last two snapshots, for smoothing
  let botT = 0;
  let particles = [], nums = [], shake = 0;
  let lastTick = -1;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // deck: 8 card ids · lv: { id: level } · towerLvl: level of this side's towers
  function newPlayer(deck, lv, towerLvl) {
    const order = shuffle(deck.map(id => CI[id]));
    return { mana: 5, hand: order.slice(0, 4), queue: order.slice(4), felled: 0, dmg: 0, lv, towerLvl };
  }

  function newMatch(sides) {
    g = { time: MATCH_TIME, clock: 0, overtime: false, ents: [], nextId: 1, players: sides.map(s => newPlayer(s.deck, s.lv, s.towerLvl)), wells: LANES.map((_, lane) => ({ lane, v: 0, owner: -1 })), fx: [], newFx: [], pending: [], over: null };
    for (const side of [0, 1]) {
      const m = D.levelMult(g.players[side].towerLvl);
      const k = BUILDING_BASE.keep, t = BUILDING_BASE.tower;
      addEnt({ type: 'keep', side, lane: -1, x: KEEP_X[side], ...k, hp: k.hp * m, dmg: k.dmg * m, building: true, air: true });
      LANES.forEach((_, lane) => addEnt({ type: 'tower', side, lane, x: TOWER_X[side], ...t, hp: t.hp * m, dmg: t.dmg * m, building: true, air: true }));
    }
    particles = [];
    nums = [];
  }

  function addEnt(e) {
    const ent = { id: g.nextId++, born: g.clock, cd: 0.4, maxHp: e.hp, yOff: 0, flash: 0, stun: 0, rage: 0, atk: 0, walk: Math.random() * 6, toLane: -1, ...e };
    g.ents.push(ent);
    return ent;
  }

  // A troop or building from a card, at the card's level.
  function spawnFrom(cardId, side, lane, x, lvl, extra = {}) {
    const c = D.card(cardId), m = D.levelMult(lvl);
    return addEnt({
      type: c.id, side, lane, x, lvl,
      hp: c.hp * m, dmg: c.dmg * m, rate: c.rate, range: c.range, speed: c.speed || 0, r: c.r,
      ranged: !!c.ranged, air: !!c.ranged && !c.ground, fly: !!c.fly, splash: c.splash || 0, siege: !!c.siege,
      building: c.kind === 'building', life: c.life || 0,
      heal: c.heal ? { ...c.heal, amt: c.heal.amt * m } : null, healT: 1,
      spawn: c.spawn || null, spawnT: c.spawn ? c.spawn.every * 0.6 : 0,
      death: c.death || null, ramp: !!c.ramp, rampId: 0, rampMult: 1, revive: !!c.revive, stunHit: c.stunHit || 0,
      blast: c.blast || null, thorns: c.thorns || 0, lifesteal: c.lifesteal || 0, manaEvery: c.manaEvery || 0, manaT: c.manaEvery || 0,
      ...extra,
    });
  }

  const towerAlive = (side, lane) => g.ents.some(e => e.type === 'tower' && e.side === side && e.lane === lane && e.hp > 0);
  const laneOf = y => {
    let best = 0;
    LANES.forEach((ly, i) => { if (Math.abs(y - ly) < Math.abs(y - LANES[best])) best = i; });
    return Math.abs(y - LANES[best]) < 60 ? best : -1;
  };
  const entY = e => (e.lane < 0 ? LANES[1] : LANES[e.lane]) + e.yOff;

  // Effects are created by whoever runs the match; the host also streams them to the guest.
  function fx(f) {
    g.fx.push({ ...f, t: 0 });
    if (mode === 'host') g.newFx.push(f);
    onFx(f);
  }

  // ---------- Playing cards ----------

  function canPlay(side, slot, lane, x) {
    const p = g.players[side];
    const card = D.CARDS[p.hand[slot]];
    if (!card || p.mana < card.cost || g.over) return false;
    if (card.kind === 'spell') return x > 0 && x < W && lane >= 0;
    const [a, b] = DEPLOY[side];
    return lane >= 0 && x >= a && x <= b;
  }

  function playCard(side, slot, lane, x) {
    if (!canPlay(side, slot, lane, x)) return false;
    const p = g.players[side];
    const card = D.CARDS[p.hand[slot]];
    const lvl = p.lv[card.id] || 1;
    p.mana -= card.cost;
    p.queue.push(p.hand[slot]);
    p.hand[slot] = p.queue.shift();

    if (card.kind === 'spell') {
      const delay = SPELL_DELAY[card.id] || 0.05;
      g.pending.push({ at: g.clock + delay, side, id: card.id, x, lane, lvl });
      fx({ k: 'cast', id: card.id, x, y: LANES[lane], r: card.radius, s: side, d: delay });
      return true;
    }
    const n = card.count || 1;
    const squad = g.nextId;   // everything one card spawns moves between lanes together
    for (let i = 0; i < n; i++) {
      const spread = n > 1 ? (i - (n - 1) / 2) : 0;
      spawnFrom(card.id, side, lane, x - spread * 6 * (side ? -1 : 1), lvl, { squad, yOff: spread * 12, spread: spread * 12 });
    }
    fx({ k: 'ring', x, y: LANES[lane], r: 26, s: side });
    return true;
  }

  function castSpell({ side, id, x, lane, lvl, tick = 1 }) {
    const card = D.card(id), m = D.levelMult(lvl);
    const y = LANES[lane];
    const inside = g.ents.filter(e => e.hp > 0 && Math.hypot(e.x - x, entY(e) - y) <= card.radius + e.r);
    const foes = inside.filter(e => e.side !== side);
    const dmgTo = e => card.dmg * m * (e.building ? card.towerMult || 1 : 1);
    if (id === 'hymn') {
      for (const e of inside) if (e.side === side && !e.building) e.rage = card.rage;
      fx({ k: 'hymn', x, y, r: card.radius });
      return;
    }
    if (card.mend) {
      for (const e of inside) if (e.side === side && !e.building) e.hp = Math.min(e.maxHp, e.hp + card.mend * m);
      fx({ k: 'heal', x, y, r: card.radius });
      return;
    }
    if (id === 'stormcall') {
      const hits = foes.sort((a, b) => b.hp - a.hp).slice(0, card.bolts);
      fx({ k: 'bolts', pts: hits.map(e => [Math.round(e.x), Math.round(entY(e))]) });
      for (const e of hits) hurt(e, dmgTo(e), side);
      return;
    }
    for (const e of foes) {
      if (card.dmg) hurt(e, dmgTo(e), side);
      if (card.stun && e.type !== 'keep') e.stun = Math.max(e.stun, card.stun);
    }
    fx({ k: id, x, y, r: card.radius });
    if (tick < (card.ticks || 1)) g.pending.push({ at: g.clock + card.every, side, id, x, lane, lvl, tick: tick + 1 });
  }

  // Sends a squad over to another lane. Picking its own lane again calls it back.
  function moveSquad(side, squad, lane) {
    if (lane < 0 || lane >= LANES.length) return false;
    let moved = false;
    for (const u of g.ents) {
      if (u.side !== side || u.squad !== squad || u.hp <= 0 || !u.speed || u.lane < 0) continue;
      u.toLane = lane;
      moved = true;
    }
    return moved;
  }

  // ---------- Simulation (bot games and the online host) ----------

  function hurt(e, dmg, by) {
    if (e.hp <= 0 || dmg <= 0) return;
    // Every point taken off a tower or keep counts towards the overtime tiebreak (overkill doesn't).
    if (e.type === 'tower' || e.type === 'keep') g.players[by].dmg += Math.min(e.hp, dmg);
    e.hp -= dmg;
    e.flash = 0.12;
    damageNumber(e.x, entY(e), dmg, e.side);
    if (e.hp > 0) return;
    e.hp = 0;
    if (e.type === 'tower' || e.type === 'keep') {
      g.players[by].felled += e.type === 'keep' ? 3 - g.players[by].felled : 1;
      fx({ k: 'fall', x: e.x, y: entY(e), s: e.side, keep: e.type === 'keep' ? 1 : 0 });
      if (e.type === 'keep') endMatch(by);
      return;
    }
    if (e.revive) {
      e.revive = false;
      e.hp = e.maxHp * 0.6;
      fx({ k: 'rise', x: e.x, y: entY(e) });
      return;
    }
    fx({ k: 'die', x: Math.round(e.x), y: Math.round(entY(e)), r: e.r, b: e.building ? 1 : 0 });
    if (e.death) {
      for (let i = 0; i < e.death.n; i++) {
        const sp = (i - (e.death.n - 1) / 2) * 14;
        spawnFrom(e.death.id, e.side, e.lane, e.x, e.lvl, { squad: e.squad, yOff: e.yOff + sp, spread: sp });
      }
    }
    if (e.blast) {
      const dmg = e.blast.dmg * D.levelMult(e.lvl);
      fx({ k: 'boom', x: Math.round(e.x), y: Math.round(entY(e)), r: e.blast.radius, c: '#ffb347' });
      for (const o of g.ents) {
        if (o.side === e.side || o.hp <= 0 || o.fly || Math.abs(o.x - e.x) > e.blast.radius + o.r) continue;
        if (o.lane === e.lane || (o.type === 'keep' && !towerAlive(o.side, e.lane))) hurt(o, dmg * (o.building ? 0.5 : 1), e.side);
      }
    }
  }

  // Units fight within their own lane. A keep joins every lane once that lane's tower falls.
  function findTarget(u, reach) {
    let best = null, bd = reach;
    for (const e of g.ents) {
      if (e.side === u.side || e.hp <= 0) continue;
      if (u.siege && !e.building) continue;
      if (e.fly && !u.air) continue;
      if (e.type === 'keep') {
        if (u.lane >= 0 && towerAlive(e.side, u.lane)) continue;
      } else if (u.lane >= 0 && e.lane !== u.lane) {
        continue;
      }
      if (u.building && !u.speed && e.building) continue;   // defences don't shoot buildings
      const d = Math.abs(e.x - u.x) - e.r - u.r;
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { e: best, d: bd } : null;
  }

  const wellsHeld = side => g.wells.filter(w => w.owner === side).length;

  // Troops alone on a bridge pull its well towards their side. v runs from -1 (side 0) to 1 (side 1).
  function updateWells(dt) {
    for (const w of g.wells) {
      const near = side => g.ents.some(e => e.side === side && e.hp > 0 && e.speed && e.lane === w.lane && Math.abs(e.x - MID) < WELL_REACH);
      const a = near(0), b = near(1);
      if (a === b) continue;
      w.v = clamp(w.v + (a ? -dt : dt) / WELL_CLAIM, -1, 1);
      const owner = w.v === -1 ? 0 : w.v === 1 ? 1 : (w.owner === 0 && w.v >= 0) || (w.owner === 1 && w.v <= 0) ? -1 : w.owner;
      if (owner !== w.owner && owner >= 0) fx({ k: 'well', x: MID, y: LANES[w.lane], s: owner });
      w.owner = owner;
    }
  }

  function step(dt) {
    g.clock += dt;
    updateWells(dt);
    const mult = g.time <= SURGE_AT || g.overtime ? SURGE_MULT : 1;
    for (const [side, p] of g.players.entries()) {
      const boost = (bot && side === 1 ? bot.mana : 1) * (1 + wellsHeld(side) * WELL_BONUS);
      p.mana = Math.min(MANA_MAX, p.mana + dt / MANA_EVERY * mult * boost);
    }
    for (const sp of g.pending.filter(s => s.at <= g.clock)) castSpell(sp);
    g.pending = g.pending.filter(s => s.at > g.clock);

    for (const u of g.ents) {
      if (u.hp <= 0) continue;
      u.flash = Math.max(0, u.flash - dt);
      u.atk = Math.max(0, u.atk - dt * 3.5);
      if (u.life) {
        u.life -= dt;
        if (u.life <= 0) { u.hp = 0; fx({ k: 'die', x: Math.round(u.x), y: Math.round(entY(u)), r: u.r, b: 1 }); continue; }
      }
      if (u.stun > 0) { u.stun -= dt; continue; }
      const haste = u.rage > 0 ? 1.4 : 1;
      if (u.rage > 0) u.rage -= dt;
      if (u.spawn) {
        u.spawnT -= dt;
        if (u.spawnT <= 0) {
          u.spawnT = u.spawn.every;
          const squad = g.nextId;
          for (let i = 0; i < u.spawn.n; i++) {
            const sp = (i - (u.spawn.n - 1) / 2) * 12;
            spawnFrom(u.spawn.id, u.side, u.lane < 0 ? 1 : u.lane, u.x + (u.side ? -1 : 1) * (u.r + 6), u.lvl, { squad, yOff: u.yOff + sp, spread: sp });
          }
          fx({ k: 'ring', x: Math.round(u.x), y: Math.round(entY(u)), r: 16, s: u.side });
        }
      }
      if (u.heal) {
        u.healT -= dt;
        if (u.healT <= 0) {
          u.healT = u.heal.every;
          let any = false;
          for (const f of g.ents) {
            if (f.side !== u.side || f.building || f.hp <= 0 || f.hp >= f.maxHp) continue;
            if (Math.hypot(f.x - u.x, entY(f) - entY(u)) > u.heal.radius) continue;
            f.hp = Math.min(f.maxHp, f.hp + u.heal.amt);
            any = true;
          }
          if (any) fx({ k: 'heal', x: Math.round(u.x), y: Math.round(entY(u)), r: u.heal.radius });
        }
      }
      if (u.manaEvery) {
        u.manaT -= dt;
        if (u.manaT <= 0) {
          u.manaT = u.manaEvery;
          const owner = g.players[u.side];
          owner.mana = Math.min(MANA_MAX, owner.mana + 1);
          fx({ k: 'heal', x: Math.round(u.x), y: Math.round(entY(u)), r: 26 });
        }
      }
      u.cd -= dt * haste;
      if (u.toLane >= 0) {
        crossLanes(u, dt * haste);
        u.walk += dt * 9;
        continue;
      }
      if (!u.dmg) continue;
      const t = findTarget(u, u.speed ? u.range + 90 : u.range);
      if (t && t.d <= u.range) {
        if (u.cd <= 0) {
          u.cd = u.rate;
          attack(u, t.e);
        }
      } else if (u.speed) {
        const dir = t ? Math.sign(t.e.x - u.x) : (u.side === 0 ? 1 : -1);
        u.x = Math.max(KEEP_X[0], Math.min(KEEP_X[1], u.x + dir * u.speed * haste * dt));
        u.walk += dt * u.speed * haste / 6;
      }
    }
    g.ents = g.ents.filter(e => e.hp > 0 || e.type === 'tower' || e.type === 'keep');

    if (g.over) return;
    g.time -= dt;
    // When time runs out, whoever felled more towers wins. Level on towers means overtime, where the
    // next tower felled wins. Only when overtime ends level does total damage to towers and keeps
    // decide it. Breaking a keep (in hurt) wins on the spot.
    const [a, b] = g.players.map(p => p.felled);
    if (a !== b && (g.overtime || g.time <= 0)) {
      endMatch(a > b ? 0 : 1);
    } else if (g.time <= 0) {
      if (!g.overtime) {
        g.overtime = true;
        g.time = OVERTIME;
        fx({ k: 'note', text: 'Overtime! Next tower felled wins' });
      } else {
        const [da, db] = g.players.map(p => Math.round(p.dmg));
        endMatch(da === db ? -1 : da > db ? 0 : 1, true);
      }
    }
  }

  // Troops walk across without fighting. Past halfway they count as being in the new lane.
  function crossLanes(u, dt) {
    if (u.lane !== u.toLane && Math.abs(LANES[u.lane] + u.yOff - LANES[u.toLane]) < Math.abs(u.yOff)) {
      u.yOff += LANES[u.lane] - LANES[u.toLane];
      u.lane = u.toLane;
    }
    const want = (u.lane === u.toLane ? 0 : LANES[u.toLane] - LANES[u.lane]) + (u.spread || 0);
    const d = want - u.yOff, stepY = Math.max(40, u.speed) * dt;
    if (Math.abs(d) > stepY) u.yOff += Math.sign(d) * stepY;
    else {
      u.yOff = want;
      if (u.lane === u.toLane) u.toLane = -1;
    }
  }

  function attack(u, target) {
    const y1 = entY(u), y2 = entY(target);
    u.atk = 1;
    let dmg = u.dmg;
    if (u.ramp) {
      u.rampMult = u.rampId === target.id ? Math.min(8, u.rampMult * 1.5) : 1;
      u.rampId = target.id;
      dmg *= u.rampMult;
    }
    if (u.ranged) fx({ k: 'shot', st: SHOT_STYLE[u.type] || 'arrow', x1: Math.round(u.x), y1: Math.round(y1 - (u.building ? 20 : u.r)), x2: Math.round(target.x), y2: Math.round(y2), s: u.side });
    else fx({ k: u.splash ? 'swipe' : 'hit', x: Math.round(target.x), y: Math.round(y2), s: u.side });
    if (u.stunHit && target.type !== 'keep') target.stun = Math.max(target.stun, u.stunHit);
    if (u.splash) {
      for (const e of g.ents) {
        if (e.side === u.side || e.hp <= 0 || (e.lane !== target.lane && e !== target)) continue;
        if (e.fly && !u.air) continue;
        if (Math.abs(e.x - target.x) <= u.splash + e.r) hurt(e, dmg, u.side);
      }
      if (u.ranged) fx({ k: 'boom', x: Math.round(target.x), y: Math.round(y2), r: u.splash, c: u.type === 'sapper' ? '#ffb347' : '#ff7a2f' });
    } else {
      hurt(target, dmg, u.side);
      if (target.thorns && !u.ranged) hurt(u, dmg * target.thorns, target.side);
    }
    if (u.lifesteal) u.hp = Math.min(u.maxHp, u.hp + dmg * u.lifesteal);
  }

  function endMatch(winner, onDamage = false) {
    g.over = { winner, onDamage, felled: g.players.map(p => p.felled), dmg: g.players.map(p => Math.round(p.dmg)) };
  }

  // ---------- Bot ----------

  // A pressured lane gets fresh troops pulled over to it.
  function botShift(enemies) {
    const threat = [0, 1, 2].map(lane => enemies.filter(e => e.lane === lane && e.x > MID - 60).reduce((s, e) => s + e.hp, 0));
    const lane = threat.indexOf(Math.max(...threat));
    if (!threat[lane]) return;
    const idle = g.ents.find(u => u.side === 1 && u.hp > 0 && u.speed && u.lane >= 0 && u.lane !== lane && u.toLane < 0 && u.x > MID && !u.siege
      && !enemies.some(e => e.lane === u.lane && Math.abs(e.x - u.x) < 220));
    if (idle) moveSquad(1, idle.squad, lane);
  }

  function botThink() {
    const side = 1, p = g.players[side];
    if (bot.slip && Math.random() < bot.slip) return;
    // Like a person, a bot takes a moment to notice what you just played.
    const enemies = g.ents.filter(e => e.side === 0 && e.hp > 0 && !e.building && g.clock - e.born >= (bot.react || 0));
    if (bot.shift) botShift(enemies);
    const hand = p.hand.map((c, slot) => ({ slot, card: D.CARDS[c] })).filter(h => h.card.cost <= p.mana);
    if (!hand.length) return;
    if (bot.novice) return noviceThink(hand, enemies);

    // Spells first, when they'll be worth it.
    for (const { slot, card } of hand.filter(h => h.card.kind === 'spell')) {
      if (card.id === 'hymn') {
        const mine = g.ents.filter(e => e.side === 1 && e.hp > 0 && !e.building && e.x < MID + 60);
        for (const e of mine) if (mine.filter(o => o.lane === e.lane && Math.abs(o.x - e.x) < 70).length >= 3) return playCard(side, slot, e.lane, e.x);
        continue;
      }
      if (card.mend) {
        const mine = g.ents.filter(e => e.side === 1 && e.hp > 0 && !e.building);
        for (const e of mine) if (mine.filter(o => o.lane === e.lane && Math.abs(o.x - e.x) < card.radius).reduce((s, o) => s + o.maxHp - o.hp, 0) > 500) return playCard(side, slot, e.lane, e.x);
        continue;
      }
      for (const e of enemies) {
        const near = enemies.filter(o => o.lane === e.lane && Math.abs(o.x - e.x) < card.radius);
        const worth = card.id === 'stormcall' ? e.hp > 900 : card.id === 'frostbind' ? near.reduce((s, o) => s + o.hp, 0) > 1400 && e.x > W - 300 : near.length >= 3 || (card.dmg >= 250 && near.reduce((s, o) => s + Math.min(o.hp, card.dmg), 0) > 500);
        if (worth && e.x > MID - 140) return playCard(side, slot, e.lane, e.x);
      }
    }

    // Defend the lane with the most attackers past the middle.
    const threat = [0, 1, 2].map(lane => enemies.filter(e => e.lane === lane && e.x > MID - 60).reduce((s, e) => s + e.hp, 0));
    const lane = threat.indexOf(Math.max(...threat));
    if (threat[lane] > 0) {
      const foes = enemies.filter(e => e.lane === lane);
      const fliers = foes.some(e => e.fly), ground = foes.some(e => !e.fly);
      const big = foes.some(e => e.maxHp >= 1000);
      const swarm = foes.length >= 3;
      const score = c => {
        if (c.kind === 'spell' || c.siege || c.manaEvery) return -9;
        let s = 1 - c.cost * 0.15;
        const air = (c.ranged && !c.ground) || c.kind === 'building' && c.dmg && !c.ground;
        if (fliers && air) s += 3;
        if (fliers && !ground && !air) s -= 6;
        if (big && ((c.count || 1) >= 3 || c.ramp || c.dmg >= 100)) s += 2;
        if (swarm && c.splash) s += 3;
        if (c.kind === 'building' && !c.dmg) s -= 2;
        if (big && c.decoy) s += 2.5;
        return s;
      };
      const best = hand.map(h => ({ ...h, s: score(h.card) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s > -2) {
        const front = Math.max(...foes.map(e => e.x));
        const x = clamp(best.card.kind === 'building' ? TOWER_X[1] - 70 : front + 90, DEPLOY[1][0], DEPLOY[1][1]);
        return playCard(side, best.slot, lane, x);
      }
    }

    // With nothing to answer, a mana building is worth putting down.
    const font = hand.find(h => h.card.manaEvery);
    if (font && !threat[lane]) return playCard(side, font.slot, Arcade.randInt(0, 2), DEPLOY[1][1] - 30);

    // Back up a push already on its way.
    const pushers = g.ents.filter(e => e.side === 1 && e.hp > 0 && e.speed && e.x < MID + 80);
    if (pushers.length && p.mana >= 4) {
      const lead = pushers.reduce((a, b) => (b.maxHp > a.maxHp ? b : a));
      const support = hand.find(h => h.card.kind === 'unit' && h.card.ranged);
      if (support) return playCard(side, support.slot, lead.lane, DEPLOY[1][0] + 30);
    }

    // Otherwise save up, then push the weakest enemy lane with a tank in front.
    if (p.mana < bot.save) return;
    const towers = g.ents.filter(e => e.type === 'tower' && e.side === 0 && e.hp > 0);
    const push = towers.length ? towers.reduce((a, b) => (b.hp < a.hp ? b : a)).lane : Arcade.randInt(0, 2);
    const units = hand.filter(h => h.card.kind === 'unit').sort((a, b) => (b.card.hp * (b.card.count || 1)) - (a.card.hp * (a.card.count || 1)));
    if (units[0]) playCard(side, units[0].slot, push, units[0].card.siege || units[0].card.speed < 40 ? DEPLOY[1][1] - 10 : DEPLOY[1][0] + 60);
  }

  // First-frontier bots act like someone learning the game: they often hesitate, sometimes answer
  // in the wrong lane, pick cards at random and never save up for a big push.
  function noviceThink(hand, enemies) {
    if (Math.random() < 0.3) return;
    const units = hand.filter(h => h.card.kind !== 'spell');
    if (!units.length) return;
    const pick = Arcade.pick(units);
    const threats = enemies.filter(e => e.x > MID);
    const lane = threats.length && Math.random() < 0.5 ? Arcade.pick(threats).lane : Arcade.randInt(0, 2);
    playCard(1, pick.slot, lane, Arcade.rand(DEPLOY[1][0] + 40, DEPLOY[1][1] - 20));
  }

  // The bot's deck: eight cards from what your arena has unlocked, with a spell and some air defence.
  // Epics and legendaries are rationed so the bot isn't holding a hand you can't have yet.
  function botDeck(maxArena) {
    const pool = D.COLLECTIBLE.filter(c => c.arena <= maxArena);
    for (let tries = 0; tries < 50; tries++) {
      const d = shuffle([...pool]).slice(0, 8);
      const spells = d.filter(c => c.kind === 'spell').length;
      const air = d.filter(c => (c.ranged && !c.ground) || c.fly).length;
      const tank = d.some(c => c.kind === 'unit' && c.hp >= 800);
      const legendaries = d.filter(c => c.rarity === 'legendary').length, epics = d.filter(c => c.rarity === 'epic').length;
      if (spells >= 1 && spells <= 2 && air >= 2 && tank && legendaries <= 1 && epics + legendaries <= Math.floor(maxArena / 2) + 1) return d.map(c => c.id);
    }
    return [...D.STARTER];
  }

  // ---------- Network ----------

  // The host sends the whole visible match about 12 times a second; the guest only draws it.
  function snapshot() {
    return {
      t: Math.round(g.time * 10) / 10, o: g.overtime ? 1 : 0,
      e: g.ents.map(e => [e.id, CI[e.type] ?? (e.type === 'tower' ? 90 : 91), e.side, Math.round(e.x), e.lane, Math.round(e.hp), Math.round(e.maxHp), Math.round(e.yOff),
        (e.flash > 0 ? 1 : 0) | (e.stun > 0 ? 2 : 0) | (e.rage > 0 ? 4 : 0) | (e.atk > 0.5 ? 8 : 0), e.squad || 0, e.toLane]),
      p: g.players.map(p => [Math.round(p.mana * 100) / 100, p.felled, Math.round(p.dmg)]),
      w: g.wells.map(w => [Math.round(w.v * 100) / 100, w.owner]),
      h: g.players[1].hand, n: g.players[1].queue[0],
      f: g.newFx.splice(0),
      over: g.over,
    };
  }

  function applySnapshot(s) {
    const entry = { s, at: performance.now() };
    // Damage numbers on the guest come from health that dropped since the last snapshot.
    if (snaps[1]) {
      const before = new Map(snaps[1].s.e.map(e => [e[0], e]));
      for (const e of s.e) {
        const old = before.get(e[0]);
        if (old && e[5] < old[5]) damageNumber(e[3], (e[4] < 0 ? LANES[1] : LANES[e[4]]) + e[7], old[5] - e[5], e[2]);
      }
    }
    snaps = [snaps[1] || entry, entry];
    g.time = s.t;
    g.overtime = !!s.o;
    s.p.forEach(([mana, felled, dmg], i) => Object.assign(g.players[i], { mana, felled, dmg }));
    s.w.forEach(([v, owner], i) => Object.assign(g.wells[i], { v, owner }));
    g.players[1].hand = s.h;
    g.players[1].queue = [s.n];
    for (const f of s.f) { g.fx.push({ ...f, t: 0 }); onFx(f); }
    if (s.over && state === 'playing') {
      g.over = s.over;
      showResult();
    }
  }

  // Guest: rebuild entities by moving each one from the older snapshot towards the newer one.
  const guestWalk = new Map();
  function guestEnts() {
    if (snaps.length < 2) return [];
    const [a, b] = snaps;
    const k = Math.min(1, (performance.now() - b.at) / (SEND_EVERY * 1000));
    const prev = new Map(a.s.e.map(e => [e[0], e]));
    const laneY = l => LANES[l < 0 ? 1 : l];
    return b.s.e.map(([id, ci, side, x, lane, hp, maxHp, yOff, flags, squad, toLane]) => {
      const old = prev.get(id);
      const px = old ? old[3] + (x - old[3]) * k : x;
      const y = laneY(lane) + yOff, oldY = old ? laneY(old[4]) + old[7] : y;
      const type = ci === 90 ? 'tower' : ci === 91 ? 'keep' : D.CARDS[ci].id;
      const base = ci >= 90 ? BUILDING_BASE[type] : D.CARDS[ci];
      const w = guestWalk.get(id) || { x: px, walk: Math.random() * 6 };
      w.walk += Math.abs(px - w.x) / 6;
      w.x = px;
      guestWalk.set(id, w);
      return {
        id, type, side, x: px, lane, hp, maxHp, yOff: oldY + (y - oldY) * k - laneY(lane), r: base.r,
        flash: flags & 1 ? 0.1 : 0, stun: flags & 2 ? 1 : 0, rage: flags & 4 ? 1 : 0, atk: flags & 8 ? 1 : 0, walk: w.walk,
        building: ci >= 90 || base.kind === 'building', fly: !!base.fly, squad, toLane: toLane ?? -1, speed: base.speed || 0,
      };
    });
  }

  function onNetEvent(name, data) {
    if (name === 'play' && mode === 'host' && state === 'playing') {
      playCard(1, data.slot, data.lane, data.x);
    } else if (name === 'move' && mode === 'host' && state === 'playing') {
      moveSquad(1, data.squad, data.lane);
    } else if (name === 'rematch') {
      net.want.them = true;
      maybeRematch();
    } else if (name === 'start' && mode === 'guest') {
      newMatch(levelFree([...D.STARTER], [...D.STARTER]));
      snaps = [];
      beginPlaying();
    } else if (name === 'quit') {
      opponentGone();
    }
  }

  // Levels only count on the ladder. Everywhere else every card and tower fights at its base stats.
  const levelFree = (...decks) => decks.map(deck => ({ deck, lv: {}, towerLvl: 1 }));
  const validDeck = d => Array.isArray(d) && d.length === 8 && new Set(d).size === 8 && d.every(id => D.card(id) && !D.card(id).token);

  function hostStart() {
    net.want = { me: false, them: false };
    newMatch(levelFree(myDeck(), validDeck(net.theirDeck) ? net.theirDeck : [...D.STARTER]));
    net.conn.send('start');
    beginPlaying();
  }

  function maybeRematch() {
    if (mode !== 'host' || !net.want.me || !net.want.them) return;
    hostStart();
  }

  function opponentGone() {
    if (!net) return;
    const wasPlaying = state === 'playing';
    leaveNet();
    state = 'over';
    if (wasPlaying) {
      Arcade.countPlay();
      Arcade.flag('online-match');
    }
    ui.show({
      title: wasPlaying ? 'Your opponent left' : 'Disconnected',
      html: wasPlaying ? '<p>You win by forfeit.</p>' : '<p>The other player is gone.</p>',
      button: 'Back to menu',
      onAction: () => toMenu(),
    });
  }

  function leaveNet() {
    net?.conn.close();
    net = null;
  }

  async function goOnline(how, code) {
    let cancelled = false;
    const cancel = () => { cancelled = true; toMenu(); };
    ui.show({ title: 'Connecting…', html: '<p>Waking up the game server. The first connection can take up to a minute.</p>', button: 'Cancel', onAction: cancel });
    const handlers = {
      ready: () => {
        if (cancelled || !net) return;
        // The guest's deck rides along with its hello; the host starts once it arrives.
        net.conn.send('hello', { name: Arcade.profile().name, deck: myDeck() });
      },
      event: (name, data) => {
        if (name === 'hello') {
          net.names[1] = String(data?.name || 'Opponent').slice(0, 24);
          net.theirDeck = data?.deck;
          if (me === 0 && mode === 'waiting') {
            mode = 'host';
            hostStart();
          }
        } else onNetEvent(name, data);
      },
      state: s => { if (mode === 'guest') applySnapshot(s); },
      left: opponentGone,
      closed: () => { if (net) opponentGone(); },
    };
    try {
      const res = how === 'quick' ? await Relay.quickMatch('rune', handlers, 'Match')
        : how === 'create' ? await Relay.createRoom('rune', handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom('rune', code, handlers);
      if (cancelled) { res.conn.close(); return; }
      net = { conn: res.conn, names: [Arcade.profile().name, 'Opponent'], sendT: 0, want: { me: false, them: false }, theirDeck: null };
      me = res.slot === 1 ? 0 : 1;
      mode = me === 0 ? 'waiting' : 'guest';
      bot = null;
      if (res.slot === 1) {
        ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: how === 'create'
            ? `<p>Share this code. The match starts as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick match.</p>',
          button: 'Cancel',
          onAction: cancel,
        });
      } else {
        ui.show({ title: 'Opponent found', html: '<p>Starting…</p>', button: null });
      }
    } catch (e) {
      if (!cancelled) toMenu('battle', e.message);
    }
  }

  // ---------- Flow ----------

  function beginPlaying() {
    state = 'playing';
    selected = -1;
    picked = -1;
    botT = 1.5;
    lastTick = -1;
    ui.hide();
    setView('battle');
    handSig = '';
    $('them-name').textContent = mode === 'host' || mode === 'guest' ? net.names[1] : bot.name;
    $('me-name').textContent = Arcade.profile().name;
    banner('Battle!', mode === 'ranked' ? arena().name : mode === 'practice' ? `Practice · ${PRACTICE[practice].name}` : 'Online · no card levels');
    S.stopMusic();
    S.sfx.start();
  }

  function myLevels() {
    const col = collection();
    return Object.fromEntries(Object.entries(col).map(([id, c]) => [id, c.lvl]));
  }
  const avgDeckLevel = () => Math.round(myDeck().reduce((s, id) => s + levelOf(id), 0) / 8);

  function startRanked() {
    const ar = arena(), ai = arenaIdx();
    const lvl = Math.min(ar.bot.level, avgDeckLevel());
    mode = 'ranked';
    me = 0;
    bot = { think: ar.bot.think, mana: ar.bot.mana, slip: ar.bot.slip, react: ar.bot.react, save: ar.bot.save, shift: ai >= 2, novice: !!ar.bot.novice, name: Arcade.pick(D.BOT_NAMES), level: lvl };
    const botLv = Object.fromEntries(D.CARDS.map(c => [c.id, lvl]));
    newMatch([{ deck: myDeck(), lv: myLevels(), towerLvl: avgDeckLevel() }, { deck: ar.bot.novice ? [...D.NOVICE_DECK] : botDeck(ai), lv: botLv, towerLvl: lvl }]);
    beginPlaying();
  }

  // Practice: pick the bot's difficulty. No levels, no glory, and this is the mode with a leaderboard.
  function startPractice(lv) {
    practice = lv;
    const P = PRACTICE[lv];
    mode = 'practice';
    me = 0;
    bot = { think: P.think, mana: P.mana, slip: P.slip, react: P.react, save: P.save, shift: lv > 0, name: `${P.name} bot` };
    newMatch(levelFree(myDeck(), botDeck(Math.max(arenaIdx(), lv * 2))));
    beginPlaying();
  }

  function showResult() {
    state = 'over';
    const { winner, felled, dmg, onDamage } = g.over;
    const mine = felled[me], theirs = felled[1 - me];
    const damageLine = `Tower damage ${dmg[me].toLocaleString()} – ${dmg[1 - me].toLocaleString()}${onDamage && winner !== -1 ? ' decided it after overtime' : ''}`;
    const won = winner === me, draw = winner === -1;
    const title = draw ? "It's a draw" : won ? 'Victory!' : 'Defeat';
    (won ? S.sfx.win : S.sfx.lose)();
    const felledHtml = `<div class="result-felled">${[0, 1, 2].map(i => `<span class="${i < mine ? 'on' : ''}">⚑</span>`).join('')}</div>`;

    if (mode === 'ranked' || mode === 'practice') {
      const rewards = [];
      let extra = '';
      if (mode === 'ranked') {
        const before = glory(), arBefore = arenaIdx();
        const delta = draw ? 0 : won ? Arcade.randInt(28, 32) + mine : -Arcade.randInt(18, 22);
        // You never drop out of an arena you've reached.
        const after = Math.max(D.ARENAS[arBefore].glory, before + delta);
        Arcade.save('rune:trophies', after);
        if (after > Arcade.load('rune:best', 0)) {
          Arcade.save('rune:best', after);
          if (Online.enabled && !AUTOPILOT) {
            const p = Arcade.profile();
            Online.put(`scores/rune-rumble-trophies/${p.id}`, { name: p.name, score: after, t: Online.TIMESTAMP }).catch(() => {});
          }
        }
        rewards.push(`⚜ ${after - before >= 0 ? '+' : ''}${after - before}`);
        chargeCaches();
        if (won) {
          const coins = 20 + arBefore * 12 + mine * 5;
          addGold(coins);
          rewards.push(`◆ +${coins}`);
          const cache = earnCache();
          rewards.push(cache ? `${D.CACHES[cache].name}!` : 'Cache slots full');
        }
        if (arenaIdx() > arBefore) extra = `<p class="unlock-note" style="color:var(--gold)!important;background:rgba(255,197,61,.12);padding:8px;border-radius:10px;font-weight:800">New frontier: ${esc(arena().name)}! New cards can now drop from caches.</p>`;
        if (won) Arcade.flag('rune-rumble-win');
        if (won && arBefore >= 3) Arcade.flag('rune-rumble-hard');
      } else if (won) {
        Arcade.flag('rune-rumble-win');
        if (practice === 2) Arcade.flag('rune-rumble-hard');
        addGold(5);
        rewards.push('◆ +5');
      }
      const summary = `${felledHtml}<p>${damageLine} · vs ${esc(bot.name)}</p><div class="rewards">${rewards.map(r => `<span>${r}</span>`).join('')}</div>${extra}`;
      // The ladder is ranked by glory, so only practice games post a score to the leaderboard.
      if (mode === 'ranked') {
        Arcade.countPlay();
        ui.show({ title, html: summary, button: 'Continue', onAction: () => toMenu('battle') });
        return;
      }
      const score = Math.round(((won ? 300 : 0) + mine * 150 + Math.max(0, Math.round(g.time))) * PRACTICE[practice].mult);
      Arcade.finish(ui, { score, title, html: summary, button: 'Continue', onAction: () => toMenu('battle') });
      return;
    }

    Arcade.countPlay();
    Arcade.flag('online-match');
    chargeCaches();
    if (won) {
      Arcade.flag('rune-rumble-online-win');
      addGold(25);
    } else addGold(5);
    ui.show({
      title,
      html: `${felledHtml}<p>${damageLine}</p><p>${esc(net.names[0])} vs ${esc(net.names[1])}</p>
        <div class="rewards"><span>◆ +${won ? 25 : 5}</span></div>
        <div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div>
        <p class="muted-note" data-wait>A rematch starts when you both press it.</p>`,
      button: 'Rematch',
      onAction: () => {
        net.want.me = true;
        net.conn.send('rematch');
        document.querySelector('[data-wait]').textContent = 'Waiting for your opponent…';
        maybeRematch();
      },
      onRender: panel => panel.querySelector('[data-leave]').addEventListener('click', () => {
        net?.conn.send('quit');
        toMenu();
      }),
    });
  }

  // Every ladder or online battle you finish charges the oldest cache that isn't ready yet.
  function chargeCaches() {
    const s = slots();
    const next = s.find(x => x && x.charge < D.CACHES[x.type].battles);
    if (!next) return;
    next.charge++;
    saveSlots(s);
  }

  // A win drops the next cache in the cycle into the first empty slot.
  function earnCache() {
    const s = slots();
    const free = s.findIndex(x => !x);
    if (free < 0) return null;
    const n = Arcade.load('rune:cycle', 0);
    const type = D.CACHE_CYCLE[n % D.CACHE_CYCLE.length];
    Arcade.save('rune:cycle', n + 1);
    s[free] = { type, charge: 0 };
    saveSlots(s);
    return type;
  }

  function toMenu(tab = currentTab, error = '') {
    if (net) { net.conn.send('quit'); leaveNet(); }
    state = 'menu';
    mode = null;
    me = 0;
    bot = null;
    ui.hide();
    idleField();
    go(tab);
    if (error) Arcade.toast('Rune Rumble', error);
  }

  // The battlefield behind the menus: just the castles of your current arena.
  function idleField() {
    const lv = Object.fromEntries(D.CARDS.map(c => [c.id, 1]));
    newMatch([{ deck: D.STARTER, lv, towerLvl: 1 }, { deck: D.STARTER, lv, towerLvl: 1 }]);
  }

  function pause() {
    if (state !== 'playing' || !bot) return;
    state = 'paused';
    ui.show({
      title: 'Paused',
      html: '<div class="menu"><button class="btn secondary" type="button" data-quit>Surrender</button></div>',
      button: 'Resume',
      onAction: () => { state = 'playing'; ui.hide(); },
      onRender: panel => panel.querySelector('[data-quit]').addEventListener('click', () => {
        state = 'playing';
        ui.hide();
        g.players[1].felled = 3;
        endMatch(1);
      }),
    });
  }
  Arcade.onBlur(pause);
  $('pause').addEventListener('click', () => (state === 'paused' ? (state = 'playing', ui.hide()) : pause()));
  window.addEventListener('pagehide', () => net?.conn.send('quit'));

  // ---------- View: the field lies sideways on wide screens and upright on tall ones ----------

  let view = { s: 1, vertical: false, m: new DOMMatrix(), inv: new DOMMatrix() };
  let cw = 1, ch = 1, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = stage.getBoundingClientRect();
    cw = Math.max(1, r.width);
    ch = Math.max(1, r.height);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    layout();
  }
  new ResizeObserver(resize).observe(stage);

  function layout() {
    const vertical = ch > cw * 1.05;
    const fw = vertical ? FIELD_H : W, fh = vertical ? W : FIELD_H;
    const top = state === 'menu' ? 0 : 0;
    const s = Math.min(cw / fw, (ch - top) / fh);
    const ox = (cw - fw * s) / 2, oy = top + (ch - top - fh * s) / 2;
    const flip = me === 1;
    const m = vertical
      ? new DOMMatrix([0, flip ? s : -s, s, 0, ox, oy + (flip ? 0 : W * s)])
      : new DOMMatrix([flip ? -s : s, 0, 0, s, ox + (flip ? W * s : 0), oy]);
    view = { s, vertical, m, inv: m.inverse() };
  }
  const toScreen = (x, y) => {
    const p = view.m.transformPoint({ x, y });
    return [p.x, p.y];
  };
  const toWorld = (sx, sy) => {
    const p = view.inv.transformPoint({ x: sx, y: sy });
    return [p.x, p.y];
  };

  // ---------- Effects ----------

  function damageNumber(x, y, dmg, side) {
    if (nums.length > 60) nums.shift();
    nums.push({ x, y, v: Math.round(dmg), side, t: 0 });
  }

  function burst(x, y, n, color, speed = 60, life = 0.6, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random());
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8), color });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  // Sounds and particles for each effect, on whichever device draws it.
  function onFx(f) {
    switch (f.k) {
      case 'shot': if (f.st === 'arrow' || f.st === 'spear') S.sfx.arrow(); else if (f.st === 'bolt') S.sfx.zap(); else if (f.st !== 'beam') S.sfx.arrow(); break;
      case 'hit': case 'swipe': S.sfx.sword(); burst(f.x, f.y, 4, '#ffffff', 50, 0.25, 2); break;
      case 'boom': S.sfx.boom(false); burst(f.x, f.y, 10, f.c, 90, 0.45, 3); break;
      case 'ring': S.sfx.deploy(); burst(f.x, f.y, 10, '#d9c9a0', 70, 0.4, 3); break;
      case 'cast': if (f.id === 'needles') S.sfx.arrow(); break;
      case 'cinder': S.sfx.boom(true); burst(f.x, f.y, 26, '#ff7a2f', 140, 0.6, 4); burst(f.x, f.y, 12, '#ffd86b', 90, 0.5, 3); shake = Math.max(shake, 6); break;
      case 'needles': S.sfx.sword(); burst(f.x, f.y, 14, '#c9b98f', 80, 0.4, 2); break;
      case 'flick': S.sfx.boom(false); burst(f.x, f.y, 10, '#ffb347', 80, 0.35, 2); break;
      case 'spore': S.sfx.freeze(); burst(f.x, f.y, 12, '#a6d65a', 45, 0.7, 3); break;
      case 'snap': S.sfx.zap(); burst(f.x, f.y, 16, '#9fe3ff', 120, 0.3, 2); break;
      case 'frostbind': S.sfx.freeze(); burst(f.x, f.y, 24, '#e6f7ff', 90, 0.9, 3); break;
      case 'bolts': S.sfx.zap(); S.sfx.boom(true); shake = Math.max(shake, 5); for (const [x, y] of f.pts) burst(x, y, 14, '#fff27a', 100, 0.4, 3); break;
      case 'hymn': S.sfx.rage(); burst(f.x, f.y, 20, '#c45cff', 100, 0.7, 3); break;
      case 'heal': S.sfx.heal(); burst(f.x, f.y, 6, '#7dff9a', 40, 0.6, 2.5); break;
      case 'rise': S.sfx.freeze(); burst(f.x, f.y, 24, '#ffb347', 100, 0.8, 4); break;
      case 'die': S.sfx.death(); burst(f.x, f.y, f.b ? 18 : 8, f.b ? '#8a7c6c' : '#e6e1d3', f.b ? 90 : 55, 0.5, f.b ? 4 : 3); break;
      case 'fall':
        S.sfx.towerFall();
        shake = Math.max(shake, f.keep ? 16 : 10);
        burst(f.x, f.y, 40, '#9a9284', 160, 0.9, 5);
        burst(f.x, f.y, 20, '#ffc53d', 120, 0.7, 3);
        if (f.s === me) S.sfx.towerLost();
        banner(f.s === me ? 'Tower lost!' : 'Tower down!', f.keep ? 'The keep has fallen' : '');
        break;
      case 'note': banner(f.text); break;
      case 'well': S.sfx.heal(); burst(f.x, f.y, 18, f.s === me ? COLORS.me : COLORS.them, 90, 0.7, 3); break;
    }
  }

  // ---------- Drawing ----------

  const fieldLayer = document.createElement('canvas');
  let fieldFor = '';
  function fieldImage() {
    const ar = mode === 'host' || mode === 'guest' ? D.ARENAS[0] : mode === 'practice' ? D.ARENAS[Math.min(5, practice * 2)] : arena();
    if (fieldFor !== ar.id) {
      fieldFor = ar.id;
      fieldLayer.width = W * 2;
      fieldLayer.height = FIELD_H * 2;
      const c = fieldLayer.getContext('2d');
      c.setTransform(2, 0, 0, 2, 0, 0);
      A.drawField(c, ar, FIELD);
    }
    return ar;
  }

  function drawField(t) {
    const ar = fieldImage();
    ctx.save();
    ctx.setTransform(new DOMMatrix([dpr, 0, 0, dpr, 0, 0]).multiply(view.m));
    ctx.drawImage(fieldLayer, 0, 0, W, FIELD_H);
    A.drawRiver(ctx, ar, FIELD, t);
    drawWells(t);

    if (state === 'playing') {
      // Where the picked troops would go.
      if (picked >= 0 && hover) {
        const lane = laneOf(hover[1]);
        if (lane >= 0) {
          ctx.fillStyle = 'rgba(255,197,61,0.12)';
          ctx.fillRect(60, LANES[lane] - 26, W - 120, 52);
        }
      }
      if (selected >= 0) {
        const card = D.CARDS[g.players[me].hand[selected]];
        if (card && card.kind !== 'spell') {
          const [a, b] = DEPLOY[me];
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(a, 0, b - a, FIELD_H);
          const [c1, c2] = DEPLOY[1 - me];
          ctx.fillStyle = 'rgba(255,60,60,0.10)';
          ctx.fillRect(Math.min(c1, c2) - 40, 0, Math.abs(c2 - c1) + 120, FIELD_H);
        }
      }
    }
    ctx.restore();
  }

  // A rune stone on each bridge, with a ring showing how far it has been claimed. Drawn in world units.
  function drawWells(t) {
    const col = side => (side === me ? COLORS.me : COLORS.them);
    for (const w of g.wells) {
      const y = LANES[w.lane];
      ctx.fillStyle = 'rgba(12,10,24,0.55)';
      ctx.beginPath(); ctx.arc(MID, y, 19, 0, Math.PI * 2); ctx.fill();
      if (w.v) {
        ctx.strokeStyle = col(w.v < 0 ? 0 : 1);
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(MID, y, 17, -Math.PI / 2, -Math.PI / 2 + Math.abs(w.v) * Math.PI * 2); ctx.stroke();
      }
      const size = 9 + (w.owner >= 0 ? Math.sin(t * 3 + w.lane) * 1.2 : 0);
      ctx.fillStyle = w.owner >= 0 ? col(w.owner) : '#d9d3ff';
      ctx.beginPath(); ctx.moveTo(MID, y - size); ctx.lineTo(MID + size * 0.7, y); ctx.lineTo(MID, y + size); ctx.lineTo(MID - size * 0.7, y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(MID, y - size * 0.45); ctx.lineTo(MID, y + size * 0.45); ctx.moveTo(MID - size * 0.25, y); ctx.lineTo(MID + size * 0.25, y); ctx.stroke();
    }
  }

  function drawPreview() {
    if (state !== 'playing' || selected < 0 || !hover) return;
    const card = D.CARDS[g.players[me].hand[selected]];
    const lane = laneOf(hover[1]);
    if (!card || lane < 0) return;
    const ok = canPlay(me, selected, lane, hover[0]);
    const [x, y] = toScreen(hover[0], LANES[lane]);
    const s = view.s;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = ok ? 'rgba(255,255,255,0.85)' : 'rgba(255,93,93,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(x, y, (card.radius || 24) * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (card.kind !== 'spell') A.drawUnit(ctx, card.id, x, y, s, { team: COLORS.me, face: 1, alpha: ok ? 0.6 : 0.3, t: 0 });
    ctx.restore();
  }

  function drawEnts(list, t) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = view.s;
    const placed = list.map(e => {
      const [x, y] = toScreen(e.x, entY(e));
      return { e, x, y };
    }).sort((a, b) => (a.e.fly - b.e.fly) || (a.y - b.y));
    for (const { e, x, y } of placed) {
      const mine = e.side === me;
      if (e.hp <= 0) {
        // Rubble where a tower stood.
        ctx.fillStyle = '#6d665b';
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + Math.cos(i * 2.1) * e.r * 0.7 * s, y + Math.sin(i * 1.7) * e.r * 0.3 * s, e.r * 0.3 * s, 0, Math.PI * 2); ctx.fill(); }
        continue;
      }
      if (mine && e.squad === picked && picked >= 0) {
        ctx.strokeStyle = '#ffc53d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, y, (e.r + 6) * s, (e.r + 6) * s * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      A.drawUnit(ctx, e.type, x, y, s, {
        team: mine ? COLORS.me : COLORS.them, face: mine ? 1 : -1, walk: e.walk, swing: e.atk, flash: e.flash > 0, stun: e.stun > 0, rage: e.rage > 0, fly: e.fly, t: t + e.id,
      });
      if (e.stun > 0) {
        ctx.fillStyle = '#bfe8ff';
        for (let i = 0; i < 3; i++) {
          const a = t * 4 + i * 2.1;
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * e.r * s, y - e.r * 3 * s + Math.sin(a) * 3 * s, 2 * s + 1, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (e.toLane >= 0) {
        const [, ty] = toScreen(e.x, LANES[e.toLane]);
        const [tx2] = toScreen(e.x, LANES[e.toLane]);
        const dx = tx2 - x, dy = ty - y, d = Math.hypot(dx, dy) || 1;
        ctx.fillStyle = mine ? '#ffc53d' : '#ff9a9a';
        ctx.save(); ctx.translate(x + dx / d * (e.r + 10) * s, y + dy / d * (e.r + 10) * s - e.r * s); ctx.rotate(Math.atan2(dy, dx));
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.fill(); ctx.restore();
      }
      // Health bar (always on buildings, on troops once hurt).
      if (e.building || e.hp < e.maxHp) {
        const big = e.type === 'tower' || e.type === 'keep';
        const w = (big ? 48 : Math.max(16, e.r * 2.2)) * s;
        const top = y - (e.type === 'keep' ? 120 : e.type === 'tower' ? 82 : e.building ? 44 : e.r * 3.3 + (e.fly ? 14 : 0)) * s;
        const h = Math.max(3, (big ? 6 : 4) * s);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, h + 2);
        ctx.fillStyle = mine ? COLORS.me : COLORS.them;
        ctx.fillRect(x - w / 2, top, w * Math.max(0, e.hp / e.maxHp), h);
        if (big && s > 0.55) {
          ctx.fillStyle = '#fff';
          ctx.font = `800 ${Math.round(10 * Math.max(0.8, s))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(Math.ceil(e.hp), x, top - 3);
        }
      }
    }
    ctx.restore();
  }

  function drawFx(dt) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = view.s;
    const P = (x, y) => toScreen(x, y);
    for (const f of g.fx) {
      f.t += dt;
      if (f.k === 'shot') {
        const dur = f.st === 'beam' ? 0.25 : f.st === 'bomb' ? 0.35 : 0.2;
        if (f.t > dur) continue;
        const k = f.t / dur;
        const [x1, y1] = P(f.x1, f.y1), [x2, y2] = P(f.x2, f.y2);
        if (f.st === 'beam') {
          ctx.strokeStyle = `rgba(255,${120 + Math.random() * 80},40,0.85)`;
          ctx.lineWidth = 3 * s + 1;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          continue;
        }
        if (f.st === 'bolt') {
          ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x1, y1);
          for (let i = 1; i < 5; i++) ctx.lineTo(x1 + (x2 - x1) * i / 5 + (Math.random() - 0.5) * 10 * s, y1 + (y2 - y1) * i / 5 + (Math.random() - 0.5) * 10 * s);
          ctx.lineTo(x2, y2); ctx.stroke();
          continue;
        }
        const arc = f.st === 'bomb' || f.st === 'ball' ? Math.sin(k * Math.PI) * 40 * s : f.st === 'arrow' || f.st === 'fire-arrow' ? Math.sin(k * Math.PI) * 12 * s : 0;
        const x = x1 + (x2 - x1) * k, y = y1 + (y2 - y1) * k - arc;
        if (f.st === 'arrow' || f.st === 'spear' || f.st === 'musket' || f.st === 'fire-arrow') {
          const nx = x1 + (x2 - x1) * Math.min(1, k + 0.05), ny = y1 + (y2 - y1) * Math.min(1, k + 0.05) - Math.sin(Math.min(1, k + 0.05) * Math.PI) * (arc ? (f.st === 'arrow' || f.st === 'fire-arrow' ? 12 : 40) * s : 0);
          const a = Math.atan2(ny - y, nx - x);
          ctx.save(); ctx.translate(x, y); ctx.rotate(a);
          ctx.strokeStyle = f.st === 'musket' ? '#ffe9a8' : f.st === 'fire-arrow' ? '#ff9a3d' : '#e8dcc0';
          ctx.lineWidth = f.st === 'spear' ? 3 : 2;
          ctx.beginPath(); ctx.moveTo(-(f.st === 'musket' ? 4 : 9) * s - 2, 0); ctx.lineTo(3, 0); ctx.stroke();
          ctx.restore();
        } else {
          const col = f.st === 'fire' ? '#ff7a2f' : f.st === 'dark' ? '#a46bff' : f.st === 'ball' ? '#22252b' : '#2b2f36';
          if (f.st === 'fire' || f.st === 'dark') { ctx.fillStyle = col + '55'; ctx.beginPath(); ctx.arc(x, y, 7 * s + 2, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(x, y, 4 * s + 1.5, 0, Math.PI * 2); ctx.fill();
        }
      } else if (f.k === 'cast') {
        // Spells on their way: a meteor dropping in, or a cloud of arrows.
        if (f.t > f.d) continue;
        const k = f.t / Math.max(0.01, f.d);
        const [x, y] = P(f.x, f.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(x, y, f.r * s, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        if (f.id === 'cinder') {
          const mx = x - (1 - k) * 160 * s, my = y - (1 - k) * 220 * s;
          ctx.fillStyle = 'rgba(255,140,40,0.35)';
          ctx.beginPath(); ctx.arc(mx - 10 * s, my - 14 * s, 14 * s, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ff7a2f'; ctx.beginPath(); ctx.arc(mx, my, 10 * s, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffd86b'; ctx.beginPath(); ctx.arc(mx, my, 5 * s, 0, Math.PI * 2); ctx.fill();
        } else if (f.id === 'needles') {
          ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 1.5;
          for (let i = 0; i < 14; i++) {
            const ax = x + Math.cos(i * 2.4) * f.r * s * 0.8 * ((i % 4) / 4 + 0.25), ay = y + Math.sin(i * 2.4) * f.r * s * 0.5 - (1 - k) * 160 * s;
            ctx.beginPath(); ctx.moveTo(ax - 4, ay - 10); ctx.lineTo(ax, ay); ctx.stroke();
          }
        }
      } else if (f.k === 'boom' || f.k === 'cinder' || f.k === 'snap' || f.k === 'frostbind' || f.k === 'hymn' || f.k === 'needles' || f.k === 'heal' || f.k === 'rise' || f.k === 'flick' || f.k === 'spore') {
        const dur = f.k === 'frostbind' ? 3 : f.k === 'hymn' || f.k === 'spore' ? 0.9 : 0.5;
        if (f.t > dur) continue;
        const k = f.t / dur;
        const [x, y] = P(f.x, f.y);
        const r = (f.r || 30) * s;
        ctx.globalAlpha = 1 - k;
        if (f.k === 'frostbind') {
          ctx.globalAlpha = Math.min(0.5, (1 - k) * 2);
          ctx.fillStyle = '#bfe8ff';
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        } else if (f.k === 'hymn') {
          ctx.strokeStyle = '#c45cff'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(x, y, r * (0.3 + k * 0.8), 0, Math.PI * 2); ctx.stroke();
        } else if (f.k === 'heal') {
          ctx.strokeStyle = '#7dff9a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, r * k, 0, Math.PI * 2); ctx.stroke();
        } else if (f.k === 'snap') {
          ctx.strokeStyle = '#9fe3ff'; ctx.lineWidth = 2.5;
          for (let i = 0; i < 6; i++) {
            const a = i * 1.05 + f.t * 8;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.3); ctx.lineTo(x + Math.cos(a + 0.3) * r, y + Math.sin(a + 0.3) * r * 0.6); ctx.stroke();
          }
        } else {
          const g2 = ctx.createRadialGradient(x, y, 0, x, y, r * (0.6 + k * 0.6));
          const col = f.k === 'needles' ? '#c9b98f' : f.k === 'rise' || f.k === 'flick' ? '#ffb347' : f.k === 'spore' ? '#a6d65a' : f.c || '#ff7a2f';
          g2.addColorStop(0, '#fff3c0');
          g2.addColorStop(0.35, col);
          g2.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g2;
          ctx.beginPath(); ctx.arc(x, y, r * (0.6 + k * 0.6), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (f.k === 'bolts') {
        if (f.t > 0.4) continue;
        ctx.globalAlpha = 1 - f.t / 0.4;
        for (const [wx, wy] of f.pts) {
          const [x, y] = P(wx, wy);
          ctx.strokeStyle = '#fffbd0'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(x + (Math.random() - 0.5) * 40, 0);
          for (let i = 1; i < 6; i++) ctx.lineTo(x + (Math.random() - 0.5) * 24, y * i / 6);
          ctx.lineTo(x, y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (f.k === 'ring') {
        if (f.t > 0.4) continue;
        const [x, y] = P(f.x, f.y);
        ctx.globalAlpha = 1 - f.t / 0.4;
        ctx.strokeStyle = f.s === me ? COLORS.me : COLORS.them;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(x, y, f.r * s * (1 + f.t * 3), f.r * s * (1 + f.t * 3) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (f.k === 'hit' || f.k === 'swipe') {
        if (f.t > 0.18) continue;
        const [x, y] = P(f.x, f.y);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - f.t / 0.18;
        ctx.beginPath();
        if (f.k === 'swipe') ctx.arc(x, y - 10 * s, 22 * s, -2.5, 0.5);
        else { ctx.moveTo(x - 6 * s, y - 16 * s); ctx.lineTo(x + 6 * s, y - 4 * s); ctx.moveTo(x + 6 * s, y - 16 * s); ctx.lineTo(x - 6 * s, y - 4 * s); }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    g.fx = g.fx.filter(f => f.t < (f.k === 'frostbind' ? 3 : 1.2));

    // Particles.
    for (const p of particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 3;
      p.vy *= 1 - dt * 3;
      const [x, y] = P(p.x, p.y);
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(x, y - p.t * 20 * s, p.size * s + 0.5, 0, Math.PI * 2); ctx.fill();
    }
    particles = particles.filter(p => p.t < p.life);
    ctx.globalAlpha = 1;

    // Damage numbers float up from what was hit.
    ctx.textAlign = 'center';
    ctx.font = `900 ${Math.round(11 + 3 * s)}px system-ui, sans-serif`;
    ctx.lineWidth = 3;
    for (const n of nums) {
      n.t += dt;
      const [x, y] = P(n.x, n.y);
      ctx.globalAlpha = Math.max(0, 1 - n.t / 0.8);
      const yy = y - 26 * s - n.t * 30;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(n.v, x, yy);
      ctx.fillStyle = n.side === me ? '#ff8a8a' : '#ffffff';
      ctx.fillText(n.v, x, yy);
    }
    nums = nums.filter(n => n.t < 0.8);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------- Battle HUD and hand ----------

  const artCache = new Map();
  function artFor(card) {
    const key = card.id + COLORS.me;
    if (!artCache.has(key)) {
      const c = document.createElement('canvas');
      c.width = 150;
      c.height = 180;
      A.cardArt(c.getContext('2d'), 150, 180, card, COLORS.me);
      artCache.set(key, c);
    }
    return artCache.get(key);
  }
  function paintArt(root) {
    root.querySelectorAll('canvas[data-art]').forEach(cv => {
      const card = D.card(cv.dataset.art);
      if (!card) return;
      cv.width = 150;
      cv.height = 180;
      cv.getContext('2d').drawImage(artFor(card), 0, 0);
    });
  }

  // One card tile. opts: { lvl, note, bar: [have, need], locked, upg, cls, tag }
  function cardHTML(card, opts = {}) {
    const rc = D.RARITIES[card.rarity]?.color || '#9aa7b8';
    const bar = opts.bar ? `<span class="bar ${opts.bar[0] >= opts.bar[1] ? 'full' : ''}"><i style="width:${Math.min(100, (opts.bar[0] / opts.bar[1]) * 100)}%"></i></span>` : '';
    return `<button class="ccard ${opts.locked ? 'locked' : ''} ${opts.cls || ''}" type="button" ${opts.tag || ''} style="--rc:${rc}">
      <canvas data-art="${card.id}"></canvas><span class="cost">${card.cost}</span>${opts.upg ? '<span class="upg">▲</span>' : ''}
      ${opts.name ? `<span class="name">${esc(card.name)}</span>` : ''}${opts.lvl ? `<span class="lvl">${opts.lvl === 'max' ? 'MAX' : 'Lvl ' + opts.lvl}</span>` : ''}${opts.note ? `<span class="lvl">${opts.note}</span>` : ''}${bar}
    </button>`;
  }

  let handSig = '';
  function updateHand() {
    const p = g.players[me];
    const sig = p.hand.join(',') + '|' + selected;
    const cards = $('cards');
    if (sig !== handSig) {
      const oldHand = handSig.split('|')[0].split(',');
      handSig = sig;
      cards.innerHTML = p.hand.map((ci, i) => {
        const c = D.CARDS[ci];
        return cardHTML(c, { cls: `${selected === i ? 'pick' : ''} ${oldHand[i] !== String(ci) ? 'fresh' : ''}`, tag: `data-slot="${i}"`, name: true });
      }).join('');
      paintArt(cards);
      cards.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (state !== 'playing') return;
        const i = +b.dataset.slot;
        selectCard(selected === i ? -1 : i);
        dragging = selected >= 0;
      }));
      const next = D.CARDS[p.queue[0]];
      const nc = $('next-card').getContext('2d');
      nc.clearRect(0, 0, 80, 96);
      if (next) nc.drawImage(artFor(next), 0, 0, 80, 96);
    }
    cards.querySelectorAll('[data-slot]').forEach((b, i) => b.classList.toggle('poor', p.mana < D.CARDS[p.hand[i]].cost));
    $('mana-fill').style.width = `${(p.mana / MANA_MAX) * 100}%`;
    $('mana-num').textContent = Math.floor(p.mana);
  }

  const hudCache = {};
  function setHud(id, html) {
    if (hudCache[id] === html) return;
    hudCache[id] = html;
    $(id).innerHTML = html;
  }
  function updateHud() {
    const t = Math.max(0, Math.ceil(g.time));
    setHud('time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    $('clock').classList.toggle('ot', g.overtime);
    setHud('clock-note', g.overtime ? 'OVERTIME' : g.time <= SURGE_AT ? 'RUNE SURGE' : '');
    const felled = n => [0, 1, 2].map(i => `<span class="${i < n ? 'on' : ''}">⚑</span>`).join('');
    setHud('me-felled', felled(g.players[me].felled));
    setHud('them-felled', felled(g.players[1 - me].felled));
    setHud('me-dmg', `${Math.round(g.players[me].dmg).toLocaleString()} dmg`);
    setHud('them-dmg', `${Math.round(g.players[1 - me].dmg).toLocaleString()} dmg`);
    const held = wellsHeld(me);
    setHud('mana-rate', held ? `+${Math.round(held * WELL_BONUS * 100)}%` : '');
    if (state === 'playing' && t <= 10 && t !== lastTick && !g.over) {
      lastTick = t;
      S.sfx.tick();
    }
    if (state === 'playing' && !g.overtime && Math.ceil(g.time) === SURGE_AT && !hudCache.surge) {
      hudCache.surge = true;
      banner('Rune Surge!', 'Mana flows faster for the last minute');
    }
  }

  function banner(text, sub = '') {
    const el = $('bbanner');
    el.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ---------- Input ----------

  let dragging = false;
  function pointerWorld(e) {
    const r = canvas.getBoundingClientRect();
    const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top);
    return [x, y, x >= 0 && x <= W && y >= 0 && y <= FIELD_H];
  }
  const ents = () => (mode === 'guest' ? guestEnts() : g.ents);
  const squadOf = id => ents().filter(e => e.side === me && e.squad === id && e.hp > 0);

  function selectCard(i) {
    selected = i;
    picked = -1;
    if (i >= 0) S.sfx.select();
    updateHand();
  }

  function orderSquad(lane) {
    if (picked < 0 || lane < 0 || lane >= LANES.length) return;
    if (mode === 'guest') net.conn.send('move', { squad: picked, lane });
    else moveSquad(me, picked, lane);
    S.sfx.tap();
  }

  // With no card picked, a tap picks up one of your troops, and the next tap on a lane sends them there.
  function tryCommand(wx, wy) {
    const r = canvas.getBoundingClientRect();
    const hit = ents()
      .filter(e => e.side === me && e.hp > 0 && e.speed && e.lane >= 0)
      .map(e => [Math.hypot(e.x - wx, entY(e) - wy), e])
      .filter(([d, e]) => d < e.r + 16)
      .sort((a, b) => a[0] - b[0])[0];
    void r;
    if (hit) {
      picked = hit[1].squad === picked ? -1 : hit[1].squad;
      S.sfx.tap();
      return;
    }
    if (picked >= 0 && laneOf(wy) >= 0) {
      orderSquad(laneOf(wy));
      picked = -1;
    }
  }

  function tryPlay(wx, wy) {
    if (selected < 0) return tryCommand(wx, wy);
    const lane = laneOf(wy);
    if (mode === 'guest') {
      if (!canPlay(1, selected, lane, wx)) return S.sfx.deny();
      net.conn.send('play', { slot: selected, lane, x: Math.round(wx) });
      S.sfx.deploy();
    } else if (!playCard(me, selected, lane, wx)) {
      return S.sfx.deny();
    }
    selectCard(-1);
  }

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    const [x, y, inside] = pointerWorld(e);
    hover = [x, y];
    if (inside) tryPlay(x, y);
  });
  window.addEventListener('pointermove', e => {
    if (state !== 'playing') return;
    const [x, y, inside] = pointerWorld(e);
    hover = inside ? [x, y] : null;
  });
  // Dragging a card from the hand onto the field plays it where you let go.
  window.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    if (state !== 'playing' || selected < 0) return;
    const [x, y, inside] = pointerWorld(e);
    if (inside && e.target === canvas) return; // the canvas's own pointerdown already handled a tap there
    if (inside) tryPlay(x, y);
  });
  canvas.addEventListener('pointerleave', () => { if (!dragging) hover = null; });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      return;
    }
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0 && state === 'playing') selectCard(selected === n ? -1 : n);
    // Up and down nudge the picked troops one lane over.
    const dir = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 }[e.code];
    if (dir && state === 'playing' && picked >= 0) {
      e.preventDefault();
      const u = squadOf(picked)[0];
      if (u) orderSquad((u.toLane >= 0 ? u.toLane : u.lane) + dir);
    }
  });

  // ---------- Menus ----------

  let currentTab = 'battle';
  let swapCard = null;   // a card picked in the collection, waiting for a deck slot to replace
  let timerHandle = null;

  function setView(v) {
    body.classList.toggle('in-menu', v === 'menu');
    body.classList.toggle('in-battle', v === 'battle');
    $('bhud').hidden = v !== 'battle';
    $('hand').hidden = v !== 'battle';
    if (v !== 'menu') screens.innerHTML = '';
    for (const k of Object.keys(hudCache)) delete hudCache[k];
    requestAnimationFrame(resize);
  }

  function go(tab) {
    if (state !== 'menu') return;
    currentTab = tab;
    setView('menu');
    clearInterval(timerHandle);
    const v = { battle: battleTab, cards: cardsTab, road: roadTab }[tab]();
    screens.innerHTML = `<section class="rscreen">${v.html}</section>`;
    screens.scrollTop = 0;
    paintArt(screens);
    v.wire?.(screens);
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.toggleAttribute('aria-current', b.dataset.tab === tab));
    document.querySelector(`#tabs [data-tab="${tab}"]`)?.setAttribute('aria-current', 'page');
    updatePurse();
    S.startMusic();
  }
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.addEventListener('click', () => {
    if (state !== 'menu') return;
    S.sfx.tap();
    swapCard = null;
    go(b.dataset.tab);
  }));

  function drawCache(cv, type, { open = false, glow = false } = {}) {
    const cache = D.CACHES[type];
    const w = cv.width = 128, h = cv.height = 112;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, w, h);
    if (glow) {
      const gl = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, 60);
      gl.addColorStop(0, cache.color + 'aa');
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gl;
      c.fillRect(0, 0, w, h);
    }
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath(); c.ellipse(64, 100, 44, 8, 0, 0, Math.PI * 2); c.fill();
    const wood = type === 'free' ? '#8a6a45' : '#6b4a2a';
    c.fillStyle = wood;
    c.beginPath(); c.roundRect(22, 52, 84, 46, 6); c.fill();
    c.fillStyle = cache.color;
    c.fillRect(22, 60, 84, 6);
    c.fillRect(36, 52, 8, 46);
    c.fillRect(84, 52, 8, 46);
    if (open) {
      c.fillStyle = '#fff6c8';
      c.beginPath(); c.ellipse(64, 54, 38, 8, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = A.shade(wood, -0.2);
      c.beginPath(); c.roundRect(22, 14, 84, 22, [10, 10, 2, 2]); c.fill();
    } else {
      c.fillStyle = A.shade(wood, 0.08);
      c.beginPath(); c.roundRect(20, 28, 88, 28, [16, 16, 4, 4]); c.fill();
      c.fillStyle = cache.color;
      c.fillRect(20, 46, 88, 5);
      c.fillRect(36, 28, 8, 28);
      c.fillRect(84, 28, 8, 28);
      c.fillStyle = '#ffd86b';
      c.beginPath(); c.roundRect(56, 44, 16, 18, 3); c.fill();
      c.fillStyle = '#5a3a10'; c.fillRect(62, 50, 4, 7);
    }
  }

  const fmtLeft = ms => {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return sec >= 60 ? `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s` : `${sec}s`;
  };

  function battleTab() {
    const ar = arena(), ai = arenaIdx(), next = D.ARENAS[ai + 1];
    const t = glory();
    const pct = next ? ((t - ar.glory) / (next.glory - ar.glory)) * 100 : 100;
    const sl = slots();
    const now = Date.now();
    const freeAt = Arcade.load('rune:freeAt', 0);
    const deck = myDeck();
    return {
      html: `<div class="rcard arena-banner"><canvas id="arena-art"></canvas>
          <div class="label"><small>Frontier ${ai + 1}</small><b>${esc(ar.name)}</b></div></div>
        <div class="glory-bar"><i style="width:${clamp(pct, 0, 100)}%"></i></div>
        <div class="glory-line"><span>⚜ ${t}</span><span>${next ? `${esc(next.name)} at ${next.glory}` : 'Top frontier!'}</span></div>
        <button class="battle-btn" type="button" data-ranked>LADDER<small>vs a ${esc(ar.name)} bot · win glory and caches</small></button>
        <div class="mode-row">
          <button class="btn secondary" type="button" data-practice>Practice</button>
          <button class="btn secondary" type="button" data-online ${Relay.enabled ? '' : 'disabled'}>Online 1v1</button>
        </div>
        <p class="rule-note">Hold the rune wells on the bridges for faster mana. When time runs out, whoever felled more towers wins. Level on towers means overtime: the next tower felled wins, and if none falls, the most total tower damage takes it. Break the keep to win on the spot.</p>
        <p class="rsection"><span>Caches</span><span style="text-transform:none;letter-spacing:0">Wins earn caches, battles charge them</span></p>
        <div class="caches">${sl.map((x, i) => {
          if (!x) return `<div class="cache-slot"><small style="margin-top:36px">Empty slot</small></div>`;
          const need = D.CACHES[x.type].battles, ready = x.charge >= need;
          const label = ready ? '<span class="when">OPEN!</span>' : `<small>${x.charge}/${need} battles</small>`;
          return `<button class="cache-slot full ${ready ? 'ready' : ''}" type="button" data-cache="${i}"><canvas data-cache-art="${x.type}"></canvas>${esc(D.CACHES[x.type].name)}${label}</button>`;
        }).join('')}</div>
        <div class="rcard free-cache"><canvas data-cache-art="free"></canvas><div><b>${esc(D.CACHES.free.name)}</b><small data-free>${freeAt <= now ? 'Ready!' : 'Next in ' + fmtLeft(freeAt - now)}</small></div><button class="btn ${freeAt <= now ? '' : 'secondary'}" type="button" data-free-btn ${freeAt <= now ? '' : 'disabled'}>Open</button></div>
        <p class="rsection"><span>Battle deck ${deckIdx() + 1}</span><span class="avg">Average <b>${(deck.reduce((s, id) => s + D.card(id).cost, 0) / 8).toFixed(1)}</b> mana</span></p>
        <div class="rcard deck">${deck.map(id => cardHTML(D.card(id), { lvl: levelOf(id) })).join('')}</div>
        <div class="settings" style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap"><button class="chip" type="button" data-music aria-pressed="${S.musicOn()}">Music: ${S.musicOn() ? 'On' : 'Off'}</button></div>
        <div data-waiting></div>`,
      wire: el => {
        drawArenaArt(el.querySelector('#arena-art'), ar);
        el.querySelectorAll('canvas[data-cache-art]').forEach(cv => drawCache(cv, cv.dataset.cacheArt));
        el.querySelector('[data-ranked]').addEventListener('click', startRanked);
        el.querySelector('[data-practice]').addEventListener('click', practiceMenu);
        el.querySelector('[data-online]').addEventListener('click', onlineMenu);
        el.querySelectorAll('[data-cache]').forEach(b => b.addEventListener('click', () => cacheTap(+b.dataset.cache)));
        el.querySelector('[data-free-btn]').addEventListener('click', () => {
          if (Arcade.load('rune:freeAt', 0) > Date.now()) return;
          Arcade.save('rune:freeAt', Date.now() + D.FREE_EVERY_H * 3600000);
          openCache('free');
        });
        el.querySelector('.deck').addEventListener('click', () => go('cards'));
        el.querySelector('[data-music]').addEventListener('click', e => {
          S.setMusic(!S.musicOn());
          e.target.setAttribute('aria-pressed', S.musicOn());
          e.target.textContent = `Music: ${S.musicOn() ? 'On' : 'Off'}`;
        });
        Relay.showWaiting(el.querySelector('[data-waiting]'), room => goOnline('public', room));
        // Count the free cache's timer down live.
        timerHandle = setInterval(() => {
          if (!el.isConnected) return clearInterval(timerHandle);
          let redraw = false;
          const fa = Arcade.load('rune:freeAt', 0);
          const f = el.querySelector('[data-free]');
          if (f && fa > Date.now()) f.textContent = 'Next in ' + fmtLeft(fa - Date.now());
          else if (f && f.textContent !== 'Ready!') redraw = true;
          if (redraw && state === 'menu' && $('overlay').hidden) go('battle');
        }, 1000);
      },
    };
  }

  function drawArenaArt(cv, ar) {
    const r = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = cv.clientWidth * r || 600;
    cv.height = cv.clientHeight * r || 170;
    const c = cv.getContext('2d');
    const s = Math.max(cv.width / 520, cv.height / FIELD_H);
    c.setTransform(s, 0, 0, s, cv.width / 2 - MID * s, cv.height / 2 - LANES[1] * s);
    A.drawField(c, ar, FIELD);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const k = cv.height / 170;
    A.drawUnit(c, 'tower', cv.width / 2 - 150 * k, cv.height * 0.72, 1.4 * k, { team: COLORS.me, t: 0 });
    A.drawUnit(c, 'tower', cv.width / 2 + 150 * k, cv.height * 0.72, 1.4 * k, { team: COLORS.them, t: 0 });
  }

  function practiceMenu() {
    ui.show({
      title: 'Practice',
      html: `<p>Card levels don't count here, so it's just your deck and your skill. No glory or caches, but your score goes on the leaderboard.</p>
        <div class="menu"><div class="row">${PRACTICE.map((l, i) => `<button class="btn ${i === 1 ? '' : 'secondary'}" type="button" data-p="${i}">${l.name}</button>`).join('')}</div>
        <button class="btn secondary" type="button" data-back>Back</button></div>`,
      button: null,
      onRender: panel => {
        panel.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => startPractice(+b.dataset.p)));
        panel.querySelector('[data-back]').addEventListener('click', () => ui.hide());
      },
    });
  }

  function onlineMenu() {
    ui.show({
      title: 'Online 1v1',
      html: `<p>Bring your deck. Card levels don't exist in online play, so it's fair.</p>
        <div class="menu">
          <button class="btn" type="button" data-net="quick">Quick match</button>
          <button class="btn secondary" type="button" data-net="create">Create private room</button>
          <div class="row"><input class="field" id="code" maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code"><button class="btn secondary" type="button" data-net="join">Join</button></div>
          <button class="btn secondary" type="button" data-back>Back</button>
        </div>`,
      button: null,
      onRender: panel => {
        const code = panel.querySelector('#code');
        panel.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => goOnline(b.dataset.net, code.value)));
        code.addEventListener('keydown', e => { if (e.key === 'Enter') goOnline('join', code.value); });
        panel.querySelector('[data-back]').addEventListener('click', () => ui.hide());
      },
    });
  }

  // ---------- Caches ----------

  function cacheTap(i) {
    const sl = slots(), x = sl[i];
    if (!x) return;
    const cache = D.CACHES[x.type];
    const left = cache.battles - x.charge;
    if (left <= 0) {
      sl[i] = null;
      saveSlots(sl);
      return openCache(x.type);
    }
    const cost = Math.max(10, Math.ceil(cache.rush * left / cache.battles));
    ui.show({
      title: cache.name,
      html: `<canvas class="big" data-c style="width:128px;height:112px"></canvas>
        <p>${cacheContents(x.type)}</p>
        <p class="muted-note">${left} more battle${left === 1 ? '' : 's'} to charge it. Battles charge your oldest cache first.</p>
        <div class="menu">
          <button class="btn secondary" type="button" data-now ${gold() >= cost ? '' : 'disabled'}>Open now · ◆ ${cost}</button>
          <button class="btn secondary" type="button" data-back>Close</button></div>`,
      button: null,
      onRender: panel => {
        drawCache(panel.querySelector('[data-c]'), x.type);
        panel.querySelector('[data-now]').addEventListener('click', () => {
          if (gold() < cost) return;
          addGold(-cost);
          const s = slots();
          s[i] = null;
          saveSlots(s);
          openCache(x.type);
        });
        panel.querySelector('[data-back]').addEventListener('click', () => ui.hide());
      },
    });
  }

  const scale = () => 1 + arenaIdx() * 0.5;
  function cacheContents(type) {
    const c = D.CACHES[type];
    if (c.legendary) return 'One guaranteed Legendary card.';
    return `About ${Math.round(c.cards * scale())} cards and ◆ ${Math.round(c.gold * scale())} gold${c.epic ? `, with at least ${c.epic} Epic` : ''}.`;
  }

  // Rolls a cache's loot from the cards your arena has unlocked, adds it to your collection,
  // then reveals it one card at a time.
  function rollCache(type) {
    const cache = D.CACHES[type], ai = arenaIdx();
    const pool = rar => D.COLLECTIBLE.filter(c => c.rarity === rar && c.arena <= ai);
    const pick = rar => {
      const order = ['legendary', 'epic', 'rare', 'common'];
      for (const r of order.slice(order.indexOf(rar))) { const p = pool(r); if (p.length) return Arcade.pick(p); }
      return D.card('squire');
    };
    const loot = new Map();
    const add = (card, n) => loot.set(card.id, (loot.get(card.id) || 0) + n);
    if (cache.legendary) add(pick('legendary'), 1);
    else {
      let n = Math.round(cache.cards * scale());
      for (let i = 0; i < (cache.epic || 0); i++, n--) add(pick('epic'), 1);
      // A few stacks rather than a card of everything: commons in bulk, rarer ones in ones and twos.
      const stacks = type === 'free' ? 2 : type === 'silver' ? 3 : type === 'golden' ? 5 : 6;
      for (let s = 0; s < stacks && n > 0; s++) {
        const roll = Math.random();
        const rar = roll < D.ODDS.legendary ? 'legendary' : roll < D.ODDS.legendary + D.ODDS.epic ? 'epic' : roll < D.ODDS.legendary + D.ODDS.epic + D.ODDS.rare ? 'rare' : 'common';
        const card = pick(rar);
        const share = s === stacks - 1 ? n : Math.max(1, Math.round(n * ({ common: 0.45, rare: 0.18, epic: 0.06, legendary: 0.02 }[card.rarity])));
        const count = card.rarity === 'legendary' ? 1 : card.rarity === 'epic' ? Math.min(share, 3) : share;
        add(card, count);
        n -= count;
      }
    }
    const goldGot = Math.round(cache.gold * scale() * (0.85 + Math.random() * 0.3));
    const col = collection();
    const items = [...loot.entries()].map(([id, count]) => {
      const card = D.card(id);
      const isNew = !col[id];
      if (isNew) col[id] = { lvl: 1, count: count - 1 };
      else col[id].count += count;
      return { card, count, isNew };
    }).sort((a, b) => ['common', 'rare', 'epic', 'legendary'].indexOf(a.card.rarity) - ['common', 'rare', 'epic', 'legendary'].indexOf(b.card.rarity));
    saveCollection(col);
    if (goldGot) addGold(goldGot);
    return { items, gold: goldGot };
  }

  function openCache(type) {
    const loot = rollCache(type);
    let taps = 0;
    const steps = loot.items.length;
    const show = () => {
      if (taps === 0) {
        ui.show({
          title: D.CACHES[type].name,
          html: `<div class="open-cache"><canvas class="big" data-c></canvas><p class="muted-note">Tap the cache!</p></div>`,
          button: null,
          onRender: panel => {
            const cv = panel.querySelector('[data-c]');
            drawCache(cv, type, { glow: true });
            let shakes = 0;
            cv.addEventListener('click', () => {
              shakes++;
              cv.classList.remove('shake');
              void cv.offsetWidth;
              cv.classList.add('shake');
              S.sfx.cacheShake();
              if (shakes >= 2) {
                S.sfx.cacheOpen();
                drawCache(cv, type, { open: true, glow: true });
                setTimeout(() => { taps = 1; show(); }, 350);
              }
            });
          },
        });
        return;
      }
      if (taps <= steps) {
        const it = loot.items[taps - 1];
        const c = collection()[it.card.id];
        ui.show({
          title: it.card.name,
          html: `<div class="reveal" data-next>
              ${cardHTML(it.card, { cls: it.card.rarity === 'epic' || it.card.rarity === 'legendary' ? it.card.rarity + '-glow' : '', lvl: c.lvl, bar: c.lvl < D.MAX_LEVEL ? [c.count, copiesFor(it.card, c.lvl)] : null })}
              <span class="count">×${it.count}</span>
              ${it.isNew ? '<span class="new">NEW CARD!</span>' : ''}
              <span style="color:${D.RARITIES[it.card.rarity].color};font-weight:800">${D.RARITIES[it.card.rarity].name}</span>
              <span class="loot-left">${steps - taps ? `${steps - taps} more · tap to continue` : 'Tap to finish'}</span>
            </div>`,
          button: 'Next',
          onAction: () => { taps++; show(); },
          onRender: panel => { paintArt(panel); panel.querySelector('[data-next]').addEventListener('click', () => { taps++; show(); }); },
        });
        S.sfx.card(it.card.rarity);
        return;
      }
      ui.show({
        title: 'Cache opened!',
        html: `${loot.gold ? `<div class="rewards"><span>◆ +${loot.gold} gold</span></div>` : ''}
          <div class="loot-summary">${loot.items.map(it => cardHTML(it.card, { lvl: '×' + it.count })).join('')}</div>`,
        button: 'Collect',
        onAction: () => { ui.hide(); go(currentTab); },
        onRender: panel => {
          paintArt(panel);
          panel.querySelectorAll('.lvl').forEach(l => { l.textContent = l.textContent.replace('Lvl ', ''); });
        },
      });
      if (loot.gold) S.sfx.gold();
    };
    show();
  }

  // ---------- Cards tab: deck building, collection, upgrades ----------

  function cardsTab() {
    const col = collection();
    const ds = decks(), di = deckIdx(), deck = ds[di];
    const avg = (deck.reduce((s, id) => s + D.card(id).cost, 0) / 8).toFixed(1);
    const order = c => ['common', 'rare', 'epic', 'legendary'].indexOf(c.rarity) * 100 + c.cost;
    const found = D.COLLECTIBLE.filter(c => col[c.id]).sort((a, b) => order(a) - order(b));
    const locked = D.COLLECTIBLE.filter(c => !col[c.id]).sort((a, b) => a.arena - b.arena || order(a) - order(b));
    const tile = (c, extra = {}) => {
      const k = col[c.id];
      const max = k.lvl >= D.MAX_LEVEL;
      return cardHTML(c, { lvl: max ? 'max' : k.lvl, bar: max ? null : [k.count, copiesFor(c, k.lvl)], upg: canUpgrade(c.id), name: true, ...extra });
    };
    return {
      html: `<h2 class="rtitle">Cards</h2>
        <div class="deck-tabs">${[0, 1, 2].map(i => `<button class="chip" type="button" data-deck="${i}" aria-pressed="${i === di}">Deck ${i + 1}</button>`).join('')}<span class="avg" style="margin-left:auto;align-self:center">Average <b>${avg}</b> mana</span></div>
        <div class="rcard deck">${deck.map((id, i) => tile(D.card(id), { tag: `data-slot="${i}"`, cls: swapCard ? 'selected' : '' })).join('')}</div>
        ${swapCard ? `<p class="swap-note">Tap a card in your deck to swap in ${esc(D.card(swapCard).name)} · <a href="#" data-cancel style="color:inherit">cancel</a></p>` : ''}
        <p class="rsection"><span>Collection</span><span>${found.length}/${D.COLLECTIBLE.length} found</span></p>
        <div class="collection">${found.filter(c => !deck.includes(c.id)).map(c => tile(c, { tag: `data-card="${c.id}"`, cls: swapCard === c.id ? 'selected' : '' })).join('')}</div>
        ${locked.length ? `<p class="rsection"><span>Not found yet</span><span style="text-transform:none;letter-spacing:0">Drop from caches</span></p>
          <div class="collection">${locked.map(c => cardHTML(c, { locked: true, name: true, tag: `data-info="${c.id}"`, note: D.ARENAS[c.arena].name.split(' ').pop() + (c.arena > arenaIdx() ? ' 🔒' : '') })).join('')}</div>` : ''}`,
      wire: el => {
        el.querySelectorAll('[data-deck]').forEach(b => b.addEventListener('click', () => { Arcade.save('rune:deck', +b.dataset.deck); S.sfx.tap(); go('cards'); }));
        el.querySelector('[data-cancel]')?.addEventListener('click', e => { e.preventDefault(); swapCard = null; go('cards'); });
        el.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => {
          const slot = +b.dataset.slot;
          if (swapCard) {
            const all = decks();
            all[deckIdx()][slot] = swapCard;
            Arcade.save('rune:decks', all);
            swapCard = null;
            S.sfx.select();
            go('cards');
          } else cardInfo(deck[slot], true);
        }));
        el.querySelectorAll('[data-card]').forEach(b => b.addEventListener('click', () => cardInfo(b.dataset.card, false)));
        el.querySelectorAll('[data-info]').forEach(b => b.addEventListener('click', () => cardInfo(b.dataset.info, false)));
      },
    };
  }

  function statRows(card, lvl) {
    const m = D.levelMult(lvl), next = lvl < D.MAX_LEVEL ? D.levelMult(lvl + 1) : null;
    const row = (label, v, scaled = true) => {
      const val = scaled ? Math.round(v * m) : v;
      const up = scaled && next ? `<span class="up">+${Math.round(v * next) - val}</span>` : '';
      return `<div>${label}<b>${val}${up}</b></div>`;
    };
    const rows = [];
    if (card.hp) rows.push(row(card.kind === 'building' ? 'Hitpoints' : 'Hitpoints', card.hp));
    if (card.dmg) rows.push(row(card.ticks ? `Damage ×${card.ticks}` : 'Damage', card.dmg));
    if (card.mend) rows.push(row('Heal', card.mend));
    if (card.blast) rows.push(row('Death blast', card.blast.dmg));
    if (card.manaEvery) rows.push(`<div>Mana<b>+1 / ${card.manaEvery}s</b></div>`);
    if (card.thorns) rows.push(`<div>Thorns<b>${card.thorns * 100}%</b></div>`);
    if (card.lifesteal) rows.push(`<div>Lifesteal<b>${card.lifesteal * 100}%</b></div>`);
    if (card.count) rows.push(`<div>Count<b>×${card.count}</b></div>`);
    if (card.rate && card.dmg && card.kind !== 'spell') rows.push(`<div>Hit speed<b>${card.rate}s</b></div>`);
    if (card.speed) rows.push(`<div>Speed<b>${card.speed >= 80 ? 'Very fast' : card.speed >= 60 ? 'Fast' : card.speed >= 40 ? 'Medium' : 'Slow'}</b></div>`);
    if (card.range) rows.push(`<div>Range<b>${card.range >= 100 ? Math.round(card.range / 10) / 2 + ' tiles' : 'Melee'}</b></div>`);
    if (card.radius) rows.push(`<div>Radius<b>${Math.round(card.radius / 10) / 2} tiles</b></div>`);
    if (card.life) rows.push(`<div>Lifetime<b>${card.life}s</b></div>`);
    if (card.stun) rows.push(`<div>Stun<b>${card.stun}s</b></div>`);
    if (card.heal) rows.push(row('Heal / sec', card.heal.amt));
    const targets = card.siege ? 'Buildings' : card.mend ? 'Your troops' : card.kind === 'spell' ? 'Area' : (card.ranged && !card.ground) || card.fly ? 'Air & ground' : card.dmg ? 'Ground' : '—';
    rows.push(`<div>Targets<b>${targets}</b></div>`);
    return rows.join('');
  }

  function cardInfo(id, inDeck) {
    const card = D.card(id), k = collection()[id];
    const rar = D.RARITIES[card.rarity];
    const lvl = k ? k.lvl : 1;
    const need = k && lvl < D.MAX_LEVEL ? copiesFor(card, lvl) : 0;
    const cost = k && lvl < D.MAX_LEVEL ? D.UPGRADE_GOLD[lvl - 1] : 0;
    ui.show({
      title: '',
      html: `<div class="card-info">
          <div class="top">${cardHTML(card, { lvl: k ? (lvl >= D.MAX_LEVEL ? 'max' : lvl) : null, bar: need ? [k.count, need] : null })}
            <div><span class="rar" style="color:${rar.color}">${rar.name} ${card.kind}</span><h3>${esc(card.name)}</h3><p class="muted-note" style="text-align:left">${esc(card.desc)}</p></div></div>
          <div class="stats">${statRows(card, lvl)}</div>
          ${k ? (need ? `<p class="muted-note">${k.count}/${need} cards to level ${lvl + 1} · ◆ ${cost}</p>` : '<p class="muted-note">Max level!</p>') : `<p class="muted-note">Found in caches from ${esc(D.ARENAS[card.arena].name)} (${D.ARENAS[card.arena].glory} glory) onward.</p>`}
          <div class="menu">
            ${k && need ? `<button class="btn" type="button" data-up ${canUpgrade(id) ? '' : 'disabled'}>Upgrade · ◆ ${cost}</button>` : ''}
            ${k && !inDeck ? '<button class="btn secondary" type="button" data-use>Use in deck</button>' : ''}
            <button class="btn secondary" type="button" data-close>Close</button>
          </div>
        </div>`,
      button: null,
      onRender: panel => {
        paintArt(panel);
        panel.querySelector('h2')?.remove();
        panel.querySelector('[data-up]')?.addEventListener('click', () => {
          if (!canUpgrade(id)) return;
          const col = collection();
          col[id].count -= need;
          col[id].lvl++;
          saveCollection(col);
          addGold(-cost);
          S.sfx.upgrade();
          Arcade.toast('Upgraded!', `${card.name} is now level ${col[id].lvl}`);
          cardInfo(id, inDeck);
          if (currentTab === 'cards' && state === 'menu') {
            const keep = $('overlay').innerHTML;
            go('cards');
            void keep;
          }
        });
        panel.querySelector('[data-use]')?.addEventListener('click', () => {
          swapCard = id;
          ui.hide();
          go('cards');
        });
        panel.querySelector('[data-close]').addEventListener('click', () => ui.hide());
      },
    });
  }

  // ---------- Glory path ----------

  function roadTab() {
    const t = glory(), best = Math.max(t, Arcade.load('rune:best', 0));
    const claimed = Arcade.load('rune:road', []);
    const items = [
      ...D.ARENAS.map((a, i) => ({ t: a.glory, arena: i })),
      ...D.ROAD.map(r => ({ ...r })),
    ].sort((a, b) => a.t - b.t || (a.arena !== undefined ? -1 : 1));
    return {
      html: `<h2 class="rtitle">Glory Path</h2><p class="rsub">You have ⚜ ${t} (best ${best}). Claim rewards as you climb.</p>
        <div class="road" data-road>${items.map(it => {
          if (it.arena !== undefined) {
            const ar = D.ARENAS[it.arena], cards = D.COLLECTIBLE.filter(c => c.arena === it.arena);
            return `<div class="rcard milestone arena ${best >= ar.glory ? 'got' : 'locked'}"><span class="t">${ar.glory}</span><span class="what"><b>Frontier ${it.arena + 1}: ${esc(ar.name)}</b><small>Unlocks ${cards.map(c => esc(c.name)).join(', ')}</small></span></div>`;
          }
          const got = best >= it.t, done = claimed.includes(it.t);
          return `<div class="rcard milestone ${got ? 'got' : 'locked'}"><span class="t">${it.t}</span>
            ${it.cache ? `<canvas data-cache-art="${it.cache}"></canvas>` : '<span style="font-size:28px;width:46px;text-align:center">◆</span>'}
            <span class="what">${it.cache ? esc(D.CACHES[it.cache].name) : `${it.gold.toLocaleString()} gold`}<small>${done ? 'Claimed' : got ? 'Ready to claim' : `${it.t - best} glory to go`}</small></span>
            ${got && !done ? `<button class="btn" type="button" data-claim="${it.t}">Claim</button>` : done ? '<span style="color:#3ddc84">✓</span>' : ''}</div>`;
        }).join('')}</div>
        <p class="rsection"><span>Most glory worldwide</span></p>
        <div class="rcard" style="padding:12px" data-board>${Online.enabled ? '<p class="board-note">Loading…</p>' : '<p class="board-note">Leaderboards aren\'t set up on this copy of the arcade.</p>'}</div>`,
      wire: el => {
        el.querySelectorAll('canvas[data-cache-art]').forEach(cv => drawCache(cv, cv.dataset.cacheArt));
        // Start the road at your next reward rather than at the bottom rung.
        const next = el.querySelector('[data-claim]') || el.querySelector('.milestone.locked');
        if (next) screens.scrollTop += next.getBoundingClientRect().top - screens.getBoundingClientRect().top - screens.clientHeight / 2;
        el.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => {
          const at = +b.dataset.claim, item = D.ROAD.find(r => r.t === at);
          const list = Arcade.load('rune:road', []);
          if (list.includes(at)) return;
          Arcade.save('rune:road', [...list, at]);
          if (item.gold) {
            addGold(item.gold);
            S.sfx.gold();
            go('road');
          } else openCache(item.cache);
        }));
        if (Online.enabled) {
          Online.top('rune-rumble-trophies', 10).then(list => {
            const slot = el.querySelector('[data-board]');
            if (!slot?.isConnected) return;
            const meId = Arcade.profile().id;
            slot.innerHTML = list.length ? `<ol class="board-list">${list.map((r, i) => `<li class="${r.id === meId ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="name">${esc(r.name)}</span><b>⚜ ${r.score}</b></li>`).join('')}</ol>` : '<p class="board-note">No one yet. Be the first!</p>';
          }).catch(() => { const slot = el.querySelector('[data-board]'); if (slot) slot.innerHTML = '<p class="board-note">Couldn\'t reach the leaderboard.</p>'; });
        }
      },
    };
  }

  // ---------- Loop ----------

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    if (state === 'playing' && (mode === 'ranked' || mode === 'practice' || mode === 'host')) {
      acc += AUTOPILOT && bot ? dt * 8 : dt;
      while (acc >= STEP) {
        if (AUTOPILOT && bot && !g.over && Math.random() < 0.04) {
          const p0 = g.players[0], slot = Arcade.randInt(0, 3);
          if (p0.mana >= D.CARDS[p0.hand[slot]].cost) {
            const spell = D.CARDS[p0.hand[slot]].kind === 'spell';
            playCard(0, slot, Arcade.randInt(0, 2), spell ? Arcade.rand(MID, W - 120) : Arcade.rand(DEPLOY[0][0], DEPLOY[0][1]));
          }
        }
        step(STEP);
        acc -= STEP;
        if (bot && !g.over) {
          botT -= STEP;
          if (botT <= 0) {
            botT = bot.think * Arcade.rand(0.7, 1.3);
            botThink();
          }
        }
      }
      if (mode === 'host' && net) {
        net.sendT -= dt;
        if (net.sendT <= 0 || g.over) {
          net.sendT = SEND_EVERY;
          net.conn.state(snapshot());
        }
      }
      if (g.over) showResult();
    }

    const list = ents();
    if (picked >= 0 && !list.some(e => e.side === me && e.squad === picked && e.hp > 0)) picked = -1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#151225';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake * dpr, (Math.random() - 0.5) * shake * dpr);
      shake = Math.max(0, shake - dt * 30);
    }
    drawField(t);
    drawEnts(list, t);
    drawFx(state === 'paused' ? 0 : dt);
    drawPreview();
    ctx.restore();
    if (state !== 'menu') {
      updateHud();
      updateHand();
    }
    requestAnimationFrame(frame);
  }

  resize();
  updatePurse();
  idleField();
  go('battle');
  const invite = Relay.takeInvite();
  if (invite) goOnline('public', invite);
  requestAnimationFrame(frame);
})();
