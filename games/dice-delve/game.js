(() => {
  const ID = 'dice-delve';
  const W = 960, H = 540;
  const START_HP = 50, REROLLS = 2, DIE = 72, TRAY_Y = 400, MAX_DICE = 8;

  // Faces: [type, value]. Wild copies whatever you rolled most of.
  const F = (t, v = 0) => ({ t, v });
  const DICE = {
    blade: { name: 'Blade', color: '#e05a5a', faces: [F('atk', 2), F('atk', 2), F('atk', 3), F('atk', 3), F('def', 1), F('blank')] },
    buckler: { name: 'Buckler', color: '#4f8cff', faces: [F('def', 2), F('def', 2), F('def', 3), F('atk', 1), F('atk', 2), F('heal', 2)] },
    warrior: { name: 'Warrior', color: '#ff7a59', faces: [F('atk', 3), F('atk', 3), F('atk', 4), F('def', 2), F('def', 2), F('blank')] },
    guardian: { name: 'Guardian', color: '#5fa8ff', faces: [F('def', 3), F('def', 4), F('def', 4), F('atk', 2), F('heal', 2), F('blank')] },
    healer: { name: 'Healer', color: '#5fd38d', faces: [F('heal', 2), F('heal', 3), F('heal', 3), F('def', 2), F('atk', 2), F('blank')] },
    pyro: { name: 'Pyro', color: '#ff9f43', faces: [F('fire', 2), F('fire', 2), F('fire', 3), F('atk', 2), F('blank'), F('blank')] },
    rogue: { name: 'Rogue', color: '#b388ff', faces: [F('pierce', 3), F('pierce', 3), F('pierce', 4), F('gold', 2), F('atk', 2), F('blank')] },
    gambler: { name: 'Gambler', color: '#ffd23f', faces: [F('gold', 3), F('gold', 3), F('wild'), F('wild'), F('atk', 5), F('blank')] },
  };
  const LOOT_DICE = ['warrior', 'guardian', 'healer', 'pyro', 'rogue', 'gambler'];

  const CHARMS = {
    clover: { name: 'Lucky Clover', desc: '+1 reroll every turn' },
    spikes: { name: 'Spiked Shield', desc: 'Blocked damage is half reflected' },
    fang: { name: 'Vampire Fang', desc: 'Heal 20% of sword damage dealt' },
    ember: { name: 'Ember Heart', desc: 'Fire faces burn +1' },
    iron: { name: 'Iron Skin', desc: 'Start every fight with 6 block' },
    idol: { name: 'Golden Idol', desc: 'Gold faces pay double' },
    combo: { name: 'Combo Charm', desc: 'Pairs count as combos (×1.25)' },
    heart: { name: 'Big Heart', desc: '+15 max HP' },
    whet: { name: 'Whetstone', desc: 'Every sword face +1' },
    wind: { name: 'Second Wind', desc: 'Once a fight, survive a killing blow at 1 HP' },
  };

  // Intents: what the enemy will do next, shown in advance.
  const I = (t, v = 0) => ({ t, v });
  const ACTS = [
    {
      name: 'The Caverns', bg: ['#1a1622', '#2b2233'],
      foes: [
        { name: 'Slime', hp: 18, color: '#7ed957', shape: 'blob', moves: [I('atk', 5), I('atk', 5), I('def', 4)] },
        { name: 'Cave Bat', hp: 13, color: '#9a8cff', shape: 'bat', moves: [I('atk', 3), I('atk', 3), I('atk', 6)] },
        { name: 'Goblin', hp: 22, color: '#a3c45a', shape: 'imp', moves: [I('atk', 6), I('def', 5), I('atk', 7)] },
      ],
      boss: { name: 'Ogre Chief', hp: 52, color: '#c98d5a', shape: 'brute', moves: [I('atk', 8), I('def', 8), I('buff', 2), I('atk', 11)] },
    },
    {
      name: 'The Crypt', bg: ['#12161f', '#1e2533'],
      foes: [
        { name: 'Skeleton', hp: 34, color: '#e8e4d8', shape: 'imp', moves: [I('atk', 9), I('def', 7), I('atk', 10)] },
        { name: 'Wraith', hp: 30, color: '#8fd3ff', shape: 'ghost', moves: [I('curse'), I('atk', 11), I('atk', 9)] },
        { name: 'Ghoul', hp: 42, color: '#9bb07a', shape: 'blob', moves: [I('atk', 9), I('heal', 9), I('atk', 12)] },
      ],
      boss: { name: 'The Lich', hp: 130, color: '#c39bff', shape: 'ghost', moves: [I('curse'), I('atk', 15), I('def', 14), I('buff', 3), I('atk', 17)] },
    },
    {
      name: 'The Abyss', bg: ['#160d14', '#2e1224'],
      foes: [
        { name: 'Fire Imp', hp: 42, color: '#ff7a59', shape: 'imp', moves: [I('atk', 13), I('buff', 3), I('atk', 15)] },
        { name: 'Stone Golem', hp: 72, color: '#9aa3ad', shape: 'brute', moves: [I('def', 16), I('atk', 18), I('def', 12)] },
        { name: 'Shade', hp: 52, color: '#6b5b95', shape: 'ghost', moves: [I('curse'), I('atk', 17), I('atk', 16)] },
      ],
      boss: { name: 'Abyss Wyrm', hp: 250, color: '#ff4d6d', shape: 'wyrm', moves: [I('atk', 20), I('buff', 4), I('def', 22), I('atk', 26), I('curse')] },
    },
  ];
  // Floor plan per act: fight, fight, shop, boss. After floor 12 the acts repeat, harder every loop.
  const PLAN = ['fight', 'fight', 'shop', 'boss'];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';   // 'roll' | 'pick' | 'loot' | 'shop' | 'choose' | 'over' | 'paused'
  let run, foe, dice, rerolls, picked, log, popups, offers, chooseFor, time, buttons, daily, nativeRandom = null, shake;

  // ---------- Seeded runs (Daily Delve) ----------

  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dateSeed() {
    const d = new Date();
    const s = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  }

  // ---------- Run setup ----------

  function newRun(isDaily = false) {
    daily = isDaily;
    if (nativeRandom) Math.random = nativeRandom;
    nativeRandom = null;
    if (daily) {
      nativeRandom = Math.random;
      Math.random = seeded(dateSeed());
    }
    run = { floor: 0, hp: START_HP, max: START_HP, gold: 0, earned: 0, dice: ['blade', 'blade', 'buckler', 'buckler'].map(makeDie), charms: [], cleared: 0, kills: 0 };
    popups = [];
    log = 'Your delve begins.';
    shake = 0;
    nextFloor();
  }

  function makeDie(type) {
    return { type, faces: DICE[type].faces.map(f => ({ ...f })), sharp: 0 };
  }
  const has = c => run.charms.includes(c);
  const loop = () => Math.floor(run.floor / 12);
  const act = () => ACTS[Math.floor((run.floor % 12) / 4)];
  const kind = () => PLAN[run.floor % 4];

  function nextFloor() {
    run.floor++;
    const k = PLAN[(run.floor - 1) % 4];
    const A = ACTS[Math.floor(((run.floor - 1) % 12) / 4)];
    if (k === 'shop') return openShop();
    const base = k === 'boss' ? A.boss : Arcade.pick(A.foes);
    // Past floor 12 every floor is tougher than the last.
    const past = Math.max(0, run.floor - 12);
    const actNo = Math.floor(((run.floor - 1) % 12) / 4);
    const scale = Math.pow(1.14, past) * (1 + 0.2 * actNo), hit = Math.pow(1.08, past) * (1 + 0.15 * actNo);
    // A little tougher on the second fight of each act.
    const step = (run.floor - 1) % 4 === 1 ? 1.15 : 1;
    foe = {
      ...base, max: Math.round(base.hp * scale * step), hp: Math.round(base.hp * scale * step), block: 0, str: 0, burn: 0,
      moves: base.moves.map(m => ({ ...m, v: Math.round(m.v * hit * (m.t === 'atk' ? step : 1)) })), mi: 0, boss: k === 'boss', wind: has('wind'),
    };
    run.block = has('iron') ? 6 : 0;
    run.locked = -1;
    run.windUsed = false;
    log = `Floor ${run.floor}: ${foe.boss ? 'BOSS · ' : ''}${foe.name} appears!`;
    startTurn();
    updateHud();
  }

  const intent = () => foe.moves[foe.mi % foe.moves.length];

  function startTurn() {
    state = 'roll';
    rerolls = REROLLS + (has('clover') ? 1 : 0);
    picked = new Set();
    dice = run.dice.map((d, i) => ({ die: d, face: null, rolling: 0, locked: i === run.locked }));
    for (const d of dice) if (!d.locked) roll(d);
    run.locked = -1;
  }

  function roll(d) {
    d.face = Arcade.pick(d.die.faces);
    d.rolling = 0.35 + Math.random() * 0.2;
  }

  function reroll() {
    if (state !== 'roll' || rerolls <= 0 || !picked.size) return;
    rerolls--;
    for (const i of picked) if (!dice[i].locked) roll(dice[i]);
    picked = new Set();
    Arcade.tone({ freq: 300, to: 500, dur: 0.08, type: 'square', vol: 0.03 });
  }

  // ---------- Resolving a turn ----------

  function tally() {
    const live = dice.filter(d => !d.locked && d.face);
    const faces = live.map(d => ({ ...d.face }));
    // Wild becomes your most common type, at its highest value.
    const counts = {};
    for (const f of faces) if (!['wild', 'blank'].includes(f.t)) counts[f.t] = (counts[f.t] || 0) + 1;
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'atk';
    const topVal = Math.max(2, ...faces.filter(f => f.t === top).map(f => f.v));
    for (const f of faces) if (f.t === 'wild') { f.t = top; f.v = topVal; }
    const sums = {}, n = {};
    for (const f of faces) {
      if (f.t === 'blank') continue;
      let v = f.v;
      if (f.t === 'atk' && has('whet')) v++;
      if (f.t === 'fire' && has('ember')) v++;
      if (f.t === 'gold' && has('idol')) v *= 2;
      sums[f.t] = (sums[f.t] || 0) + v;
      n[f.t] = (n[f.t] || 0) + 1;
    }
    const combos = {};
    for (const t of Object.keys(sums)) {
      const m = n[t] >= 4 ? 2 : n[t] >= 3 ? 1.5 : n[t] === 2 && has('combo') ? 1.25 : 1;
      if (m > 1) combos[t] = m;
      sums[t] = Math.floor(sums[t] * m);
    }
    return { sums, combos };
  }

  function resolve() {
    if (state !== 'roll' || dice.some(d => d.rolling > 0)) return;
    const { sums, combos } = tally();
    const atk = sums.atk || 0, pierce = sums.pierce || 0;
    // Sword damage goes through block first; pierce ignores it.
    const absorbed = Math.min(foe.block, atk);
    foe.block -= absorbed;
    const dealt = atk - absorbed + pierce;
    foe.hp -= dealt;
    if (dealt > 0) {
      popups.push({ x: 720, y: 170, text: `-${dealt}`, t: 0, color: '#ff6b6b', big: true });
      shake = 0.2;
      Arcade.tone({ freq: 180, to: 90, dur: 0.15, type: 'square', vol: 0.05 });
    }
    if (sums.fire) {
      foe.burn += sums.fire;
      popups.push({ x: 760, y: 210, text: `Burn +${sums.fire}`, t: 0, color: '#ff9f43' });
    }
    if (has('fang') && atk - absorbed > 0) heal(Math.floor((atk - absorbed) * 0.2));
    if (sums.def) {
      run.block += sums.def;
      popups.push({ x: 220, y: 210, text: `+${sums.def} block`, t: 0, color: '#7fb2ff' });
    }
    if (sums.heal) heal(sums.heal);
    if (sums.gold) {
      run.gold += sums.gold;
      run.earned += sums.gold;
      popups.push({ x: 220, y: 240, text: `+${sums.gold} gold`, t: 0, color: '#ffd23f' });
    }
    const comboText = Object.entries(combos).map(([t, m]) => `${LABEL[t]} ×${m}`).join(', ');
    log = `You deal ${dealt}${sums.def ? `, block ${sums.def}` : ''}${sums.heal ? `, heal ${sums.heal}` : ''}.${comboText ? ` Combo: ${comboText}!` : ''}`;
    if (Object.keys(combos).length) {
      Arcade.tone({ freq: 660, to: 1320, dur: 0.2, type: 'triangle', vol: 0.05 });
      if (Object.values(combos).some(m => m >= 2)) Arcade.flag('dice-delve-combo');
    }
    if (foe.hp <= 0) return victory();
    enemyTurn();
  }

  const LABEL = { atk: 'Sword', def: 'Shield', heal: 'Heal', fire: 'Fire', pierce: 'Pierce', gold: 'Gold', wild: 'Wild', blank: 'Blank' };

  function heal(n) {
    const before = run.hp;
    run.hp = Math.min(run.max, run.hp + n);
    if (run.hp > before) popups.push({ x: 220, y: 180, text: `+${run.hp - before}`, t: 0, color: '#7ed957' });
  }

  function enemyTurn() {
    // Burn ticks first and ignores block.
    if (foe.burn > 0) {
      foe.hp -= foe.burn;
      popups.push({ x: 720, y: 140, text: `🔥${foe.burn}`, t: 0, color: '#ff9f43' });
      foe.burn--;
      if (foe.hp <= 0) return victory();
    }
    foe.block = 0;
    const m = intent();
    foe.mi++;
    if (m.t === 'atk') {
      const dmg = m.v + foe.str;
      const blocked = Math.min(run.block, dmg);
      run.block -= blocked;
      run.hp -= dmg - blocked;
      if (has('spikes') && blocked > 0) {
        foe.hp -= Math.floor(blocked / 2);
        if (foe.hp <= 0) return victory();
      }
      if (dmg - blocked > 0) {
        popups.push({ x: 220, y: 150, text: `-${dmg - blocked}`, t: 0, color: '#ff6b6b', big: true });
        Arcade.tone({ freq: 120, to: 60, dur: 0.2, type: 'sawtooth', vol: 0.05 });
      }
      log += ` ${foe.name} hits for ${dmg}${blocked ? ` (${blocked} blocked)` : ''}.`;
    } else if (m.t === 'def') {
      foe.block += m.v;
      log += ` ${foe.name} raises ${m.v} block.`;
    } else if (m.t === 'buff') {
      foe.str += m.v;
      log += ` ${foe.name} grows stronger (+${m.v}).`;
    } else if (m.t === 'heal') {
      foe.hp = Math.min(foe.max, foe.hp + m.v);
      log += ` ${foe.name} heals ${m.v}.`;
    } else if (m.t === 'curse') {
      run.locked = Math.floor(Math.random() * run.dice.length);
      log += ` ${foe.name} curses one of your dice!`;
    }
    if (run.hp <= 0 && has('wind') && !run.windUsed) {
      run.windUsed = true;
      run.hp = 1;
      log += ' Second Wind!';
    }
    if (run.hp <= 0) return defeat();
    // Your block lasts until the enemy's next attack, then fades.
    if (m.t === 'atk') run.block = 0;
    startTurn();
    updateHud();
  }

  function victory() {
    run.kills++;
    run.cleared++;
    const reward = 8 + run.floor * 2 + (foe.boss ? 25 : 0);
    run.gold += reward;
    run.earned += reward;
    log = `${foe.name} is defeated! +${reward} gold.`;
    Arcade.tone({ freq: 523, to: 1046, dur: 0.3, type: 'triangle', vol: 0.06 });
    if (foe.boss) {
      Arcade.flag(run.floor >= 12 ? 'dice-delve-abyss' : 'dice-delve-boss');
      if (run.floor === 12) Arcade.toast('The Abyss is conquered', 'Keep delving: it only gets harder.');
      heal(Math.floor(run.max * 0.3));
      offers = shuffle(Object.keys(CHARMS).filter(c => !has(c))).slice(0, 3).map(c => ({ kind: 'charm', id: c }));
    } else {
      offers = [
        { kind: 'die', id: Arcade.pick(LOOT_DICE) },
        Math.random() < 0.5 ? { kind: 'sharpen' } : { kind: 'die', id: Arcade.pick(LOOT_DICE) },
        Math.random() < 0.4 ? { kind: 'rest' } : { kind: 'die', id: Arcade.pick(LOOT_DICE) },
      ];
    }
    if (!offers.length) offers = [{ kind: 'rest' }, { kind: 'sharpen' }];
    if (run.floor >= 8 && run.dice.length >= 6) offers.push({ kind: 'skip' });
    state = 'loot';
    updateHud();
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function take(o) {
    if (o.kind === 'die' && run.dice.length >= MAX_DICE) {
      chooseFor = { kind: 'replace', id: o.id };
      state = 'choose';
      return;
    }
    if (o.kind === 'die') run.dice.push(makeDie(o.id));
    if (o.kind === 'rest') heal(Math.floor(run.max * 0.4));
    if (o.kind === 'charm') addCharm(o.id);
    if (o.kind === 'sharpen' || o.kind === 'trim') {
      chooseFor = o;
      state = 'choose';
      return;
    }
    if (run.dice.length >= MAX_DICE) Arcade.flag('dice-delve-hoard');
    Arcade.tone({ freq: 700, to: 1050, dur: 0.12, type: 'triangle', vol: 0.05 });
    if (state === 'loot') nextFloor();
  }

  function addCharm(id) {
    run.charms.push(id);
    if (id === 'heart') {
      run.max += 15;
      run.hp += 15;
    }
  }

  // Sharpen: +1 to every numbered face. Trim (shop): turn a die's blank into a wild.
  function chooseDie(i) {
    const d = run.dice[i];
    if (chooseFor.kind === 'replace') {
      run.dice[i] = makeDie(chooseFor.id);
    } else if (chooseFor.kind === 'sharpen') {
      for (const f of d.faces) if (f.v) f.v++;
      d.sharp++;
    } else {
      const b = d.faces.find(f => f.t === 'blank');
      if (!b) return;
      b.t = 'wild';
    }
    Arcade.tone({ freq: 500, to: 1000, dur: 0.2, type: 'triangle', vol: 0.05 });
    const from = chooseFor.from;
    chooseFor = null;
    if (from === 'shop') state = 'shop';
    else nextFloor();
  }

  function openShop() {
    state = 'shop';
    log = `Floor ${run.floor}: a wandering merchant. Spend your gold.`;
    const lp = loop() + 1;
    offers = [
      ...shuffle([...LOOT_DICE]).slice(0, 2).map(id => ({ kind: 'die', id, price: 45 * lp })),
      ...shuffle(Object.keys(CHARMS).filter(c => !has(c))).slice(0, 2).map(id => ({ kind: 'charm', id, price: 110 * lp })),
      { kind: 'rest', price: 30 * lp },
      { kind: 'sharpen', price: 55 * lp, from: 'shop' },
      { kind: 'trim', price: 40 * lp, from: 'shop' },
    ];
    updateHud();
  }

  function buy(o) {
    if (o.sold || run.gold < o.price) return;
    if (o.kind === 'trim' && !run.dice.some(d => d.faces.some(f => f.t === 'blank'))) return;
    run.gold -= o.price;
    if (o.kind !== 'rest' && o.kind !== 'sharpen' && o.kind !== 'trim') o.sold = true;
    if (o.kind === 'rest') o.sold = true;
    if (o.kind === 'sharpen' || o.kind === 'trim') {
      o.sold = true;
      chooseFor = o;
      state = 'choose';
      return;
    }
    if (o.kind === 'die' && run.dice.length >= MAX_DICE) {
      chooseFor = { kind: 'replace', id: o.id, from: 'shop' };
      state = 'choose';
      return;
    }
    if (o.kind === 'die') run.dice.push(makeDie(o.id));
    if (o.kind === 'charm') addCharm(o.id);
    if (o.kind === 'rest') heal(Math.floor(run.max * 0.4));
    Arcade.tone({ freq: 880, to: 1320, dur: 0.12, type: 'triangle', vol: 0.05 });
    updateHud();
  }

  const score = () => run.cleared * 150 + run.earned;

  function defeat() {
    state = 'over';
    run.hp = 0;
    if (nativeRandom) {
      Math.random = nativeRandom;
      nativeRandom = null;
    }
    updateHud();
    Arcade.finish(ui, {
      score: score(),
      title: 'Your delve ends',
      lines: [
        `Fell on floor ${run.floor} (${act().name}) to ${foe.name}${daily ? ' · Daily Delve' : ''}`,
        `${run.cleared} floors cleared · ${run.earned} gold found · ${run.dice.length} dice · ${run.charms.length} charms`,
      ],
      button: 'Delve again',
      onAction: () => start(false),
    });
  }

  function updateHud() {
    $('floor').textContent = run ? run.floor : 0;
    $('hp').textContent = run ? `${Math.max(0, run.hp)}/${run.max}` : '-';
    $('gold').textContent = run ? run.gold : 0;
    $('best').textContent = Arcade.getBest(ID);
  }

  // ---------- Input ----------

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }
  canvas.addEventListener('pointerdown', e => {
    const [x, y] = toBoard(e);
    for (const b of buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (b.enabled) b.onClick();
        return;
      }
    }
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (['roll', 'loot', 'shop', 'choose'].includes(state)) pause();
      else if (state === 'paused') resume();
      return;
    }
    if (state !== 'roll') return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= dice.length) togglePick(n - 1);
    if (e.code === 'KeyR') reroll();
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      resolve();
    }
  });

  function togglePick(i) {
    if (dice[i].locked || rerolls <= 0) return;
    if (picked.has(i)) picked.delete(i);
    else picked.add(i);
  }

  let resumeTo = 'roll';
  function pause() {
    resumeTo = state;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }
  function resume() {
    state = resumeTo;
    ui.hide();
  }

  function start(isDaily) {
    newRun(isDaily);
    ui.hide();
  }

  // ---------- Drawing ----------

  function btn(x, y, w, h, label, enabled, onClick, { accent = '#ffd23f', sub = '' } = {}) {
    ctx.fillStyle = enabled ? '#2b3446' : '#1e222a';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = enabled ? accent : '#2a2f39';
    ctx.lineWidth = enabled ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = enabled ? '#eceef2' : '#6b7280';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillText(label, x + w / 2, y + (sub ? h / 2 - 2 : h / 2 + 5));
    if (sub) {
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillStyle = enabled ? accent : '#4a505c';
      ctx.fillText(sub, x + w / 2, y + h / 2 + 14);
    }
    buttons.push({ x, y, w, h, enabled, onClick });
  }

  const FACE_COLOR = { atk: '#ff6b6b', def: '#6fa8ff', heal: '#7ed957', fire: '#ff9f43', pierce: '#c39bff', gold: '#ffd23f', wild: '#ffffff', blank: '#3a3f4b' };

  function faceIcon(f, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = FACE_COLOR[f.t];
    ctx.strokeStyle = FACE_COLOR[f.t];
    ctx.lineWidth = s * 0.12;
    ctx.lineCap = 'round';
    if (f.t === 'atk') {
      ctx.beginPath();
      ctx.moveTo(-s * 0.35, s * 0.35); ctx.lineTo(s * 0.35, -s * 0.35);
      ctx.moveTo(-s * 0.4, s * 0.1); ctx.lineTo(-s * 0.1, s * 0.4);
      ctx.stroke();
    } else if (f.t === 'def') {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.42); ctx.lineTo(s * 0.36, -s * 0.28); ctx.lineTo(s * 0.3, s * 0.15); ctx.lineTo(0, s * 0.42); ctx.lineTo(-s * 0.3, s * 0.15); ctx.lineTo(-s * 0.36, -s * 0.28);
      ctx.closePath();
      ctx.fill();
    } else if (f.t === 'heal') {
      ctx.fillRect(-s * 0.1, -s * 0.35, s * 0.2, s * 0.7);
      ctx.fillRect(-s * 0.35, -s * 0.1, s * 0.7, s * 0.2);
    } else if (f.t === 'fire') {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.42); ctx.quadraticCurveTo(s * 0.4, 0, s * 0.2, s * 0.35); ctx.lineTo(-s * 0.2, s * 0.35); ctx.quadraticCurveTo(-s * 0.4, 0, 0, -s * 0.42);
      ctx.fill();
    } else if (f.t === 'pierce') {
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, 0); ctx.lineTo(s * 0.3, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.42, 0); ctx.lineTo(s * 0.15, -s * 0.2); ctx.lineTo(s * 0.15, s * 0.2);
      ctx.fill();
    } else if (f.t === 'gold') {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b8860b';
      ctx.fillRect(-s * 0.05, -s * 0.18, s * 0.1, s * 0.36);
    } else if (f.t === 'wild') {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? s * 0.18 : s * 0.42;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = `hsl(${(time * 120) % 360}, 90%, 70%)`;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDie(x, y, d, face, opts = {}) {
    const s = opts.size || DIE;
    ctx.fillStyle = opts.dim ? '#2a2d36' : '#f3efe6';
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, s * 0.16);
    ctx.fill();
    ctx.strokeStyle = DICE[d.type].color;
    ctx.lineWidth = 4;
    ctx.stroke();
    if (face) {
      ctx.fillStyle = '#1a1d24';
      ctx.beginPath();
      ctx.roundRect(x + 5, y + 5, s - 10, s - 10, s * 0.12);
      ctx.fill();
      faceIcon(face, x + s / 2, y + s / 2 - (face.v ? 4 : 0), s * 0.62);
      if (face.v) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.round(s * 0.24)}px system-ui, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(face.v, x + s - 9, y + s - 9);
      }
    }
  }

  function bar(x, y, w, h, v, max, color) {
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, v / max), h);
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.max(0, v)}/${max}`, x + w / 2, y + h - 3);
  }

  function drawFoe(cx, cy) {
    const bob = Math.sin(time * 2) * 4;
    const s = foe.boss ? 1.4 : 1;
    ctx.save();
    ctx.translate(cx, cy + bob);
    ctx.scale(s, s);
    ctx.fillStyle = foe.color;
    ctx.beginPath();
    if (foe.shape === 'blob') { ctx.ellipse(0, 20, 52, 38, 0, Math.PI, 0); ctx.lineTo(52, 28); ctx.lineTo(-52, 28); }
    else if (foe.shape === 'bat') { ctx.ellipse(0, 0, 22, 24, 0, 0, Math.PI * 2); ctx.moveTo(-18, -4); ctx.lineTo(-64, -24 + Math.sin(time * 12) * 10); ctx.lineTo(-40, 10); ctx.moveTo(18, -4); ctx.lineTo(64, -24 + Math.sin(time * 12) * 10); ctx.lineTo(40, 10); }
    else if (foe.shape === 'ghost') { ctx.arc(0, -10, 38, Math.PI, 0); ctx.lineTo(38, 40); for (let k = 0; k < 4; k++) ctx.lineTo(38 - (k + 0.5) * 19, 30 + (k % 2) * 12); ctx.lineTo(-38, 40); }
    else if (foe.shape === 'brute') ctx.roundRect(-50, -50, 100, 90, 20);
    else if (foe.shape === 'wyrm') { ctx.ellipse(0, 0, 70, 40, 0, 0, Math.PI * 2); ctx.moveTo(50, -20); ctx.lineTo(90, -60); ctx.lineTo(70, -10); }
    else ctx.roundRect(-34, -40, 68, 76, 16);
    ctx.fill();
    ctx.fillStyle = '#0e1014';
    ctx.beginPath();
    ctx.arc(-14, -6, 6, 0, Math.PI * 2);
    ctx.arc(14, -6, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = foe.boss ? '#ff4d6d' : '#ffffff';
    ctx.beginPath();
    ctx.arc(-12, -8, 2.5, 0, Math.PI * 2);
    ctx.arc(16, -8, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function intentText(m) {
    if (m.t === 'atk') return { text: `Attack ${m.v + foe.str}`, color: '#ff6b6b' };
    if (m.t === 'def') return { text: `Block ${m.v}`, color: '#6fa8ff' };
    if (m.t === 'buff') return { text: `Power up +${m.v}`, color: '#ffb36b' };
    if (m.t === 'heal') return { text: `Heal ${m.v}`, color: '#7ed957' };
    return { text: 'Curse a die', color: '#c39bff' };
  }

  function draw() {
    buttons = [];
    const A = run ? ACTS[Math.floor(((run.floor - 1) % 12) / 4)] || ACTS[0] : ACTS[0];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, A.bg[0]);
    g.addColorStop(1, A.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (!run) return;

    ctx.save();
    if (shake > 0) ctx.translate(Arcade.rand(-4, 4), Arcade.rand(-4, 4));

    // Header.
    ctx.textAlign = 'left';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillStyle = '#eceef2';
    ctx.fillText(`Floor ${run.floor} · ${A.name}${loop() ? ` · Depth ${loop() + 1}` : ''}${daily ? ' · Daily' : ''}`, 16, 28);
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = '#8d94a1';
    const nextKinds = PLAN.map((k, i) => (i === (run.floor - 1) % 4 ? `[${k}]` : k)).join(' › ');
    ctx.fillText(nextKinds, 16, 46);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd23f';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillText(`${run.gold} gold`, W - 16, 28);
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillStyle = '#c39bff';
    ctx.fillText(run.charms.map(c => CHARMS[c].name).join(' · ') || 'No charms yet', W - 16, 46);

    if (['roll', 'over', 'paused'].includes(state) && foe) drawFight();
    else if (state === 'loot') drawLoot();
    else if (state === 'shop') drawShop();
    else if (state === 'choose') drawChoose();
    ctx.restore();

    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.1);
      ctx.fillStyle = p.color;
      ctx.font = `800 ${p.big ? 26 : 15}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - p.t * 30);
    }
    ctx.globalAlpha = 1;
  }

  function drawFight() {
    // You.
    ctx.fillStyle = '#eceef2';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('You', 80, 96);
    bar(80, 104, 260, 18, run.hp, run.max, '#7ed957');
    if (run.block) {
      ctx.fillStyle = '#6fa8ff';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(`🛡 ${run.block} block`, 80, 142);
    }
    // A little adventurer.
    ctx.save();
    ctx.translate(210, 230);
    ctx.fillStyle = '#f3c89b';
    ctx.beginPath();
    ctx.arc(0, -40, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4f8cff';
    ctx.fillRect(-20, -20, 40, 50);
    ctx.fillStyle = '#ccd';
    ctx.fillRect(24, -30, 6, 50);
    ctx.fillStyle = '#6fa8ff';
    ctx.beginPath();
    ctx.arc(-26, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Them.
    ctx.textAlign = 'left';
    ctx.fillStyle = foe.boss ? '#ff6b81' : '#eceef2';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(`${foe.boss ? 'BOSS · ' : ''}${foe.name}`, 600, 96);
    bar(600, 104, 260, 18, Math.max(0, foe.hp), foe.max, '#ff6b6b');
    const tags = [foe.block && `🛡 ${foe.block}`, foe.str && `Power +${foe.str}`, foe.burn && `Burn ${foe.burn}`].filter(Boolean).join('   ');
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = '#c0c5cf';
    ctx.fillText(tags, 600, 142);
    drawFoe(730, 235);
    const it = intentText(intent());
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(650, 300, 160, 26);
    ctx.fillStyle = it.color;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(`Next: ${it.text}`, 730, 318);

    // Log.
    ctx.fillStyle = '#c0c5cf';
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillText(log, W / 2, 360, W - 60);

    // Dice tray.
    const n = dice.length;
    const gap = 10, total = n * DIE + (n - 1) * gap;
    const x0 = Math.min(W / 2 - total / 2, 640 - total);
    const { sums, combos } = tally();
    dice.forEach((d, i) => {
      const x = Math.max(16, x0) + i * (DIE + gap);
      const sel = picked.has(i);
      const y = TRAY_Y + (sel ? -10 : 0);
      const spin = d.rolling > 0 ? Arcade.pick(d.die.faces) : d.face;
      drawDie(x, y, d.die, d.locked ? null : spin, { dim: d.locked });
      if (d.locked) {
        ctx.fillStyle = '#c39bff';
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('CURSED', x + DIE / 2, y + DIE / 2 + 4);
      }
      if (sel) {
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 3;
        ctx.strokeRect(x - 4, y - 4, DIE + 8, DIE + 8);
      }
      ctx.fillStyle = '#6b7280';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${i + 1}`, x + DIE / 2, TRAY_Y + DIE + 16);
      buttons.push({ x, y, w: DIE, h: DIE, enabled: state === 'roll', onClick: () => togglePick(i) });
    });

    // Preview of what this roll does.
    const parts = Object.entries(sums).map(([t, v]) => `${LABEL[t]} ${v}${combos[t] ? ` (×${combos[t]})` : ''}`);
    ctx.textAlign = 'left';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(parts.join(' · ') || 'Nothing rolled', 16, TRAY_Y - 14);

    if (state === 'roll') {
      btn(W - 300, TRAY_Y, 136, 72, `Reroll (R)`, rerolls > 0 && picked.size > 0, reroll, { sub: picked.size ? `${picked.size} dice · ${rerolls} left` : `Tap dice · ${rerolls} left`, accent: '#7fdbff' });
      btn(W - 156, TRAY_Y, 140, 72, 'Go! (Space)', dice.every(d => d.rolling <= 0), resolve, { sub: 'Use these faces', accent: '#9be37a' });
    }
  }

  function offerInfo(o) {
    if (o.kind === 'die') return { title: `${DICE[o.id].name} die`, desc: run.dice.length >= MAX_DICE ? 'Swap it for one of yours' : 'Add it to your pool', die: o.id };
    if (o.kind === 'charm') return { title: CHARMS[o.id].name, desc: CHARMS[o.id].desc };
    if (o.kind === 'rest') return { title: 'Rest', desc: `Heal ${Math.floor(run.max * 0.4)} HP` };
    if (o.kind === 'sharpen') return { title: 'Sharpen', desc: '+1 to every face of one die' };
    if (o.kind === 'trim') return { title: 'Wild carving', desc: "Turn a die's blank face into Wild" };
    return { title: 'Skip', desc: 'Keep your pool lean' };
  }

  function drawOffer(o, x, y, w, h, onClick, enabled, priceLabel) {
    const info = offerInfo(o);
    ctx.fillStyle = enabled ? '#232a38' : '#1a1d24';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = enabled ? '#ffd23f' : '#2a2f39';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = enabled ? '#eceef2' : '#6b7280';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(info.title, x + w / 2, y + 26);
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = '#a7adb8';
    ctx.fillText(info.desc, x + w / 2, y + 46, w - 16);
    if (info.die) {
      const faces = DICE[info.die].faces;
      faces.forEach((f, k) => drawDie(x + w / 2 - 3 * 36 + k * 36 + 2, y + 60, { type: info.die }, f, { size: 32 }));
    }
    if (priceLabel) {
      ctx.fillStyle = o.sold ? '#6b7280' : run.gold >= o.price ? '#ffd23f' : '#ff8a80';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(o.sold ? 'Sold' : `${o.price} gold`, x + w / 2, y + h - 12);
    }
    buttons.push({ x, y, w, h, enabled, onClick });
  }

  function drawLoot() {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eceef2';
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(foe.boss ? 'Boss treasure: pick a charm' : 'Victory! Choose your loot', W / 2, 110);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillStyle = '#a7adb8';
    ctx.fillText(log, W / 2, 136);
    const w = 240, h = 130, gap = 20, total = offers.length * w + (offers.length - 1) * gap;
    offers.forEach((o, i) => drawOffer(o, W / 2 - total / 2 + i * (w + gap), 170, w, h, () => take(o), true));
    drawPool(340);
  }

  function drawShop() {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eceef2';
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillText('The Wandering Merchant', W / 2, 88);
    const w = 214, h = 116;
    offers.forEach((o, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const can = !o.sold && run.gold >= o.price && !(o.kind === 'trim' && !run.dice.some(d => d.faces.some(f => f.t === 'blank')));
      drawOffer(o, 28 + col * (w + 12), 104 + row * (h + 10), w, h, () => buy(o), can, true);
    });
    btn(W - 200, 104 + 2 * (h + 10) - 4, 172, 50, 'Leave shop', true, () => nextFloor(), { accent: '#9be37a', sub: 'On to the boss' });
    drawPool(400);
  }

  function drawChoose() {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eceef2';
    ctx.font = '800 24px system-ui, sans-serif';
    const titles = { sharpen: 'Sharpen which die?', trim: 'Carve a wild face on which die?', replace: `Your pool is full (${MAX_DICE}). Swap out which die for the ${chooseFor.id && DICE[chooseFor.id].name}?` };
    ctx.fillText(titles[chooseFor.kind], W / 2, 110);
    run.dice.forEach((d, i) => {
      const y = 140 + Math.floor(i / 2) * 64, x = i % 2 ? W / 2 + 10 : W / 2 - 410;
      const ok = chooseFor.kind !== 'trim' || d.faces.some(f => f.t === 'blank');
      ctx.fillStyle = ok ? '#232a38' : '#1a1d24';
      ctx.fillRect(x, y, 400, 56);
      ctx.textAlign = 'left';
      ctx.fillStyle = ok ? '#eceef2' : '#6b7280';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(`${DICE[d.type].name}${d.sharp ? ` +${d.sharp}` : ''}`, x + 10, y + 32);
      d.faces.forEach((f, k) => drawDie(x + 110 + k * 46, y + 6, d, f, { size: 44 }));
      buttons.push({ x, y, w: 400, h: 56, enabled: ok, onClick: () => chooseDie(i) });
    });
  }

  function drawPool(y) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8d94a1';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(`Your dice (${run.dice.length}) · HP ${run.hp}/${run.max}`, 28, y);
    run.dice.forEach((d, i) => {
      const x = 28 + (i % 4) * 228, yy = y + 10 + Math.floor(i / 4) * 34;
      d.faces.forEach((f, k) => drawDie(x + k * 34, yy, d, f, { size: 30 }));
    });
  }

  // ---------- Loop ----------

  let last = performance.now();
  time = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    if (state !== 'paused') {
      if (dice) for (const d of dice) d.rolling = Math.max(0, d.rolling - dt);
      shake = Math.max(0, (shake || 0) - dt);
      if (popups) {
        for (const p of popups) p.t += dt;
        popups = popups.filter(p => p.t < 1.1);
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  buttons = [];
  Versus.attach({
    ui,
    start: () => start(false),
    score: () => (run ? score() : 0),
    intro: {
      title: 'Dice Delve',
      html: `<ul>
        <li>Each turn your dice roll. <b>Tap dice</b> (or press their number) and <b>reroll</b> up to twice, then press <b>Go</b>.</li>
        <li><b style="color:#ff6b6b">Swords</b> hit, <b style="color:#6fa8ff">shields</b> block, <b style="color:#ff9f43">fire</b> burns, <b style="color:#c39bff">pierce</b> ignores block. Three of a kind is ×1.5, four or more ×2.</li>
        <li>Enemies show their next move. Win fights to add dice, sharpen them and find charms. Spend gold at the merchant.</li>
        <li>Bosses wait on floors 4, 8 and 12, and beyond that it only gets deeper.</li>
      </ul>
      <div class="menu" style="margin-bottom:8px"><button class="btn secondary" type="button" data-daily>Daily Delve (same run for everyone today)</button></div>`,
      button: 'Delve',
      onAction: () => start(false),
      onRender: panel => panel.querySelector('[data-daily]')?.addEventListener('click', () => start(true)),
    },
  });
  updateHud();
  requestAnimationFrame(frame);
})();
