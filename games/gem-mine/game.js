(() => {
  const W = 960, H = 540;
  const LIST_X = 440;
  const SAVE_KEY = 'gem-mine:save';
  const OFFLINE_CAP = 8 * 3600, OFFLINE_RATE = 0.5;
  const GROWTH = 1.15;
  const MILESTONES = [10, 25, 50, 100, 200];   // each doubles that digger's output
  // Faster than any hand can keep up: more clicks than this in one second overheats the pick.
  const MAX_CPS = 20, OVERHEAT = 3;
  const VEIN_HITS = 8, VEIN_TIME = 6;

  const DIGGERS = [
    { name: 'Pebble Pup', cost: 15, rate: 0.2, color: '#c8a27a' },
    { name: 'Mole', cost: 100, rate: 2, color: '#8d6e63' },
    { name: 'Drill Bot', cost: 1100, rate: 14, color: '#90a4ae' },
    { name: 'Excavator', cost: 12000, rate: 80, color: '#ffb300' },
    { name: 'Blast Crew', cost: 130000, rate: 450, color: '#ef5350' },
    { name: 'Lava Pump', cost: 1.4e6, rate: 2500, color: '#ff7043' },
    { name: 'Core Tap', cost: 2e7, rate: 14000, color: '#ab47bc' },
    { name: 'Star Forge', cost: 3.3e8, rate: 80000, color: '#4fc3f7' },
    { name: 'Void Drill', cost: 5.1e9, rate: 470000, color: '#7e57c2' },
    { name: 'Planet Cracker', cost: 7.5e10, rate: 2.8e6, color: '#ec407a' },
  ];

  // One-time upgrades for the current run. Diving deeper resets them along with the diggers.
  const UPGRADES = [
    { id: 'gloves', name: 'Padded Gloves', cost: 600, desc: 'Clicks add 5% of your gems/s, up from 2%' },
    { id: 'charm', name: 'Lucky Charm', cost: 6000, desc: 'Golden nuggets show up twice as often' },
    { id: 'polish', name: 'Gem Polish', cost: 45000, desc: 'Diggers dig 50% faster' },
    { id: 'rush', name: 'Rush Hour', cost: 300000, desc: 'Gem rushes last 35s instead of 20s' },
    { id: 'veins', name: 'Vein Finder', cost: 2.5e6, desc: 'Glowing veins pay three times as much' },
    { id: 'lanterns', name: 'Miner Lanterns', cost: 2e7, desc: 'Diggers dig twice as fast' },
    { id: 'shift', name: 'Night Shift', cost: 1.5e8, desc: 'Away earnings at full speed, for up to 12 hours' },
    { id: 'core', name: 'Core Resonance', cost: 6e9, desc: 'Each core shard gives +35% instead of +25%' },
  ];

  // Depth is 100 per tenfold more gems ever dug; each layer recolours the rock.
  const LAYERS = [
    { at: 0, name: 'Topsoil', rock: '#5d566b', top: '#6d6680', hue: 280 },
    { at: 300, name: 'Granite', rock: '#62666e', top: '#767b85', hue: 220 },
    { at: 600, name: 'Crystal Caves', rock: '#3f5a73', top: '#557a99', hue: 200 },
    { at: 900, name: 'Magma Rivers', rock: '#6b3a2e', top: '#8a4b3a', hue: 15 },
    { at: 1200, name: 'Outer Core', rock: '#7a5a1f', top: '#9c7628', hue: 40 },
    { at: 1500, name: 'Starfall Deep', rock: '#2e2a5c', top: '#433d85', hue: 250 },
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let s;               // saved state
  let buttons = [];
  let buyMode = 1;     // 1 | 10 | 'max'
  let floaters = [], chips = [];
  let tab = 'diggers';  // 'diggers' | 'upgrades'
  let nugget = null, nuggetT = 70, frenzy = 0;
  let vein = null, veinT = 30;
  let clickTimes = [], overheat = 0, spaceHeld = false;
  let shake = 0;

  function fresh(keep = {}) {
    return { gems: 0, run: 0, lifetime: 0, owned: DIGGERS.map(() => 0), ups: [], pick: 0, shards: 0, dives: 0, clicks: 0, layer: 0, saved: Date.now(), ...keep };
  }

  function load() {
    const raw = Arcade.load(SAVE_KEY, null);
    s = raw ? { ...fresh(), ...raw, owned: DIGGERS.map((_, i) => raw.owned?.[i] || 0), ups: raw.ups || [] } : fresh();
  }

  const has = id => s.ups.includes(id);
  const layer = () => LAYERS.filter(l => depth() >= l.at).length - 1;

  // Depth counts as the score, so medals unlock as you dig even before the first dive.
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
    if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toString();
    const e = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(n) / 3));
    const v = n / Math.pow(1000, e);
    return (v < 100 ? v.toFixed(2) : v.toFixed(1)) + SUFFIX[e];
  }

  // ---------- Economy ----------

  const shardPct = () => (has('core') ? 35 : 25);
  const shardBonus = () => 1 + s.shards * shardPct() / 100;
  const milestoneMult = i => Math.pow(2, MILESTONES.filter(m => s.owned[i] >= m).length);
  const upgradeMult = () => (has('polish') ? 1.5 : 1) * (has('lanterns') ? 2 : 1);
  const diggerRate = i => DIGGERS[i].rate * s.owned[i] * milestoneMult(i) * shardBonus() * upgradeMult();
  const perSecond = () => DIGGERS.reduce((t, _, i) => t + diggerRate(i), 0) * (frenzy > 0 ? 7 : 1);
  const clickPower = () => (1 + perSecond() * (has('gloves') ? 0.05 : 0.02)) * Math.pow(2, s.pick) * shardBonus();
  const veinPayout = () => clickPower() * 40 * (has('veins') ? 3 : 1);
  const pickCost = () => 50 * Math.pow(12, s.pick);
  const depth = () => Math.floor(100 * Math.log10(s.lifetime + 1));
  // Two shards per tenfold more gems this run, so each dive helps without running away.
  const shardsOnDive = () => Math.max(0, Math.floor(2 * Math.log10(s.run / 1e4)));

  const unitCost = (i, owned = s.owned[i]) => DIGGERS[i].cost * Math.pow(GROWTH, owned);
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

  function earn(n) {
    s.gems += n;
    s.run += n;
    s.lifetime += n;
  }

  function buy(i) {
    const { n, total } = bulk(i);
    if (s.gems < total) return;
    s.gems -= total;
    const before = milestoneMult(i);
    s.owned[i] += n;
    if (milestoneMult(i) > before) Arcade.toast('Milestone', `${DIGGERS[i].name}s dig twice as fast`);
    Arcade.tone({ freq: 520, to: 780, dur: 0.08, type: 'triangle', vol: 0.04 });
    if (s.owned[DIGGERS.length - 1] > 0) Arcade.flag('gem-mine-forge');
  }

  function buyPick() {
    if (s.gems < pickCost()) return;
    s.gems -= pickCost();
    s.pick++;
    Arcade.tone({ freq: 660, to: 990, dur: 0.12, type: 'triangle', vol: 0.04 });
  }

  function buyUpgrade(u) {
    if (has(u.id) || s.gems < u.cost) return;
    s.gems -= u.cost;
    s.ups.push(u.id);
    Arcade.toast('Upgrade', u.name);
    Arcade.tone({ freq: 590, to: 1180, dur: 0.16, type: 'triangle', vol: 0.05 });
  }

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
    if (!heatOk()) return;
    if (aimed && vein && Math.hypot(x - vein.x, y - vein.y) < 24) hitVein();
    const n = clickPower();
    earn(n);
    s.clicks++;
    shake = 0.08;
    floaters.push({ x: x + Arcade.rand(-20, 20), y, text: '+' + fmt(n), t: 0 });
    for (let i = 0; i < 5; i++) chips.push({ x, y, vx: Arcade.rand(-160, 160), vy: Arcade.rand(-260, -80), t: 0, c: Arcade.pick(Arcade.equipped('gem-sparkle').colors) });
    Arcade.tone({ freq: Arcade.rand(700, 900), dur: 0.03, type: 'square', vol: 0.02 });
  }

  // Prestige: start over with shards that boost everything by 10% each.
  function dive() {
    const got = shardsOnDive();
    if (got < 1) return;
    const score = depth();
    s = fresh({ lifetime: s.lifetime, shards: s.shards + got, dives: s.dives + 1, pick: 0, layer: s.layer });
    persist();
    Arcade.flag('gem-mine-dive');
    Arcade.finish(ui, {
      score,
      title: 'Deeper we go!',
      lines: [`You found ${got} core shard${got > 1 ? 's' : ''}. Everything now digs ${Math.round((shardBonus() - 1) * 100)}% faster.`, 'Your score is the depth you\'ve reached.'],
      button: 'Keep digging',
      onAction: () => ui.hide(),
    });
  }

  // ---------- Input ----------

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  const ROCK = { x: 210, y: 270, r: 120 };
  // Scripted clicks (isTrusted false) don't count.
  canvas.addEventListener('pointerdown', e => {
    if (!e.isTrusted) return;
    const [px, py] = toBoard(e);
    if (nugget && Math.hypot(px - nugget.x, py - nugget.y) < 26) {
      catchNugget();
      return;
    }
    for (const b of buttons) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        if (b.enabled) b.onClick();
        return;
      }
    }
    if (Math.hypot(px - ROCK.x, py - ROCK.y) < ROCK.r) mine(px, py);
  });
  // One dig per press: holding Space down doesn't keep digging.
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space' || !document.getElementById('overlay').hidden) return;
    e.preventDefault();
    if (e.repeat || spaceHeld || !e.isTrusted) return;
    spaceHeld = true;
    mine(ROCK.x + Arcade.rand(-40, 40), ROCK.y + Arcade.rand(-40, 40), false);
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') spaceHeld = false; });
  window.addEventListener('blur', () => { spaceHeld = false; });

  // Ore veins: a glowing crack that pays out if you hit it enough times before it fades. It needs aim,
  // so Space (which digs at random) won't find it.
  function hitVein() {
    vein.hits++;
    if (vein.hits < VEIN_HITS) return;
    const n = veinPayout();
    earn(n);
    floaters.push({ x: vein.x, y: vein.y - 10, text: `Vein! +${fmt(n)}`, t: 0, big: true });
    Arcade.tone({ freq: 520, to: 1560, dur: 0.35, type: 'triangle', vol: 0.05 });
    vein = null;
  }

  function catchNugget() {
    const roll = Math.random();
    if (roll < 0.5) {
      const n = Math.max(perSecond() * 60, clickPower() * 30);
      earn(n);
      floaters.push({ x: nugget.x, y: nugget.y, text: `Lucky! +${fmt(n)}`, t: 0, big: true });
    } else {
      frenzy = has('rush') ? 35 : 20;
      floaters.push({ x: nugget.x, y: nugget.y, text: `Gem rush! ×7 for ${frenzy}s`, t: 0, big: true });
    }
    nugget = null;
    Arcade.flag('gem-mine-nugget');
    Arcade.tone({ freq: 880, to: 1760, dur: 0.3, type: 'triangle', vol: 0.05 });
  }

  // ---------- Drawing ----------

  function button(x, y, w, h, { enabled, onClick }) {
    buttons.push({ x, y, w, h, enabled, onClick });
  }

  function drawRock(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1d1a26');
    g.addColorStop(1, '#2b2233');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LIST_X, H);
    // Strata take on the colour of the layer you've reached.
    const L = LAYERS[layer()];
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `hsla(${L.hue - i * 6}, 25%, ${16 + i * 2}%, 0.6)`;
      ctx.fillRect(0, 400 + i * 24, LIST_X, 24);
    }

    const k = 1 + (shake > 0 ? 0.04 : 0) + Math.sin(t * 2) * 0.01;
    ctx.save();
    ctx.translate(ROCK.x, ROCK.y);
    ctx.scale(k, k);
    ctx.fillStyle = L.rock;
    ctx.beginPath();
    const pts = [[-110, 10], [-80, -80], [-10, -115], [70, -90], [115, -10], [90, 80], [10, 112], [-75, 85]];
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = L.top;
    ctx.beginPath();
    ctx.moveTo(-80, -80); ctx.lineTo(-10, -115); ctx.lineTo(70, -90); ctx.lineTo(10, -40); ctx.closePath();
    ctx.fill();
    // Embedded gems.
    const gems = [[-40, -30, '#7fdbff'], [30, 20, '#b388ff'], [-20, 50, '#9be37a'], [55, -40, '#ffd54f'], [-70, 20, '#ff8a80']];
    for (const [x, y, c] of gems) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x, y - 12); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - 9, y);
      ctx.closePath();
      ctx.fill();
    }
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
      ctx.fillStyle = '#ffe082';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${vein.hits}/${VEIN_HITS}`, vein.x, vein.y + 28);
      ctx.restore();
    }

    // Heat gauge: how close you are to overheating the pick.
    const now = performance.now();
    const heat = overheat > 0 ? overheat / OVERHEAT : clickTimes.filter(c => now - c < 1000).length / MAX_CPS;
    ctx.fillStyle = '#2a2f39';
    ctx.fillRect(ROCK.x - 60, 396, 120, 5);
    ctx.fillStyle = overheat > 0 ? '#ff5d5d' : heat > 0.7 ? '#ffb347' : '#7fdbff';
    ctx.fillRect(ROCK.x - 60, 396, 120 * Math.min(1, heat), 5);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#8d94a1';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(`${L.name.toUpperCase()} · ${depth()} m`, ROCK.x, 112);
    ctx.fillStyle = '#eceef2';
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.fillText(fmt(s.gems), ROCK.x, 64);
    ctx.fillStyle = frenzy > 0 ? '#ffd54f' : '#8d94a1';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(`gems · ${fmt(perSecond())}/s${frenzy > 0 ? `  ·  RUSH ${Math.ceil(frenzy)}s` : ''}`, ROCK.x, 88);
    ctx.fillStyle = '#8d94a1';
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillText(overheat > 0 ? `Pick overheated! Cooling down… ${Math.ceil(overheat)}s` : `Click the rock (or press Space) for ${fmt(clickPower())}`, ROCK.x, 420);

    // Pick upgrade and dive.
    const pc = pickCost();
    drawBtn(20, 440, 190, 44, `Sharper pick (lv ${s.pick})`, `${fmt(pc)} gems · clicks ×2`, s.gems >= pc, buyPick);
    const shards = shardsOnDive();
    drawBtn(220, 440, 200, 44, 'Dive deeper', shards ? `+${shards} core shard${shards > 1 ? 's' : ''} (+${shards * shardPct()}%)` : `Mine ${fmt(1e4 * Math.pow(10, (shards + 1) / 2) - s.run)} more`, shards > 0, dive);
    ctx.fillStyle = '#8d94a1';
    ctx.textAlign = 'center';
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(`Core shards ${s.shards} (+${s.shards * shardPct()}% to everything) · Depth ${depth()} m`, ROCK.x, 510);
  }

  function drawBtn(x, y, w, h, label, sub, enabled, onClick) {
    ctx.fillStyle = enabled ? '#2b3446' : '#1e222a';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = enabled ? '#ffc53d' : '#2a2f39';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = enabled ? '#eceef2' : '#6b7280';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(label, x + 10, y + 18);
    ctx.fillStyle = enabled ? '#ffc53d' : '#5c6370';
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(sub, x + 10, y + 34);
    button(x, y, w, h, { enabled, onClick });
  }

  function drawList() {
    ctx.fillStyle = '#161920';
    ctx.fillRect(LIST_X, 0, W - LIST_X, H);
    [['diggers', 'Diggers'], ['upgrades', `Upgrades ${s.ups.length}/${UPGRADES.length}`]].forEach(([id, label], n) => {
      const x = LIST_X + 12 + n * 104;
      ctx.fillStyle = tab === id ? '#eceef2' : '#232833';
      ctx.fillRect(x, 12, 98, 24);
      ctx.fillStyle = tab === id ? '#0e1014' : '#8d94a1';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + 49, 28);
      button(x, 12, 98, 24, { enabled: true, onClick: () => { tab = id; } });
    });
    if (tab === 'upgrades') return drawUpgrades();

    ['1', '10', 'max'].forEach((m, n) => {
      const val = m === 'max' ? 'max' : +m;
      const x = W - 170 + n * 52;
      ctx.fillStyle = buyMode === val ? '#eceef2' : '#232833';
      ctx.fillRect(x, 12, 46, 24);
      ctx.fillStyle = buyMode === val ? '#0e1014' : '#8d94a1';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m === 'max' ? 'Max' : `×${m}`, x + 23, 28);
      button(x, 12, 46, 24, { enabled: true, onClick: () => { buyMode = val; } });
    });

    const rowH = 48;
    DIGGERS.forEach((d, i) => {
      const y = 46 + i * rowH;
      // Hide diggers far beyond reach, so new ones feel like discoveries.
      const known = i === 0 || s.owned[i - 1] > 0 || s.owned[i] > 0;
      const { n, total } = bulk(i);
      const can = known && s.gems >= total;
      ctx.fillStyle = can ? '#1f2530' : '#1a1d24';
      ctx.fillRect(LIST_X + 12, y, W - LIST_X - 24, rowH - 6);
      if (can) {
        ctx.strokeStyle = '#3b4658';
        ctx.strokeRect(LIST_X + 12.5, y + 0.5, W - LIST_X - 25, rowH - 7);
      }
      ctx.fillStyle = known ? d.color : '#2a2f39';
      ctx.beginPath();
      ctx.arc(LIST_X + 38, y + 21, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = known ? '#eceef2' : '#5c6370';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(known ? d.name : '???', LIST_X + 62, y + 18);
      ctx.fillStyle = '#8d94a1';
      ctx.font = '500 11px system-ui, sans-serif';
      const next = MILESTONES.find(m => m > s.owned[i]);
      ctx.fillText(known ? `${fmt(diggerRate(i))}/s${next ? ` · ×2 at ${next}` : ''}` : 'Buy the one above to discover', LIST_X + 62, y + 34);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#eceef2';
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillText(s.owned[i], W - 150, y + 28);
      ctx.fillStyle = can ? '#ffc53d' : '#5c6370';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText(known ? `${n > 1 ? `×${n} ` : ''}${fmt(total)}` : '', W - 24, y + 27);
      button(LIST_X + 12, y, W - LIST_X - 24, rowH - 6, { enabled: can, onClick: () => buy(i) });
    });
  }

  function drawUpgrades() {
    const rowH = 56;
    UPGRADES.forEach((u, i) => {
      const y = 46 + i * rowH;
      const owned = has(u.id);
      // Upgrades stay hidden until you've dug a tenth of their price this run.
      const known = owned || s.run >= u.cost / 10;
      const can = known && !owned && s.gems >= u.cost;
      ctx.fillStyle = owned ? '#1a2a22' : can ? '#1f2530' : '#1a1d24';
      ctx.fillRect(LIST_X + 12, y, W - LIST_X - 24, rowH - 6);
      if (can) {
        ctx.strokeStyle = '#3b4658';
        ctx.strokeRect(LIST_X + 12.5, y + 0.5, W - LIST_X - 25, rowH - 7);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = known ? '#eceef2' : '#5c6370';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(known ? u.name : '???', LIST_X + 26, y + 21);
      ctx.fillStyle = '#8d94a1';
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText(known ? u.desc : `Dig ${fmt(u.cost / 10)} gems this run to discover`, LIST_X + 26, y + 39);
      ctx.textAlign = 'right';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = owned ? '#9be37a' : can ? '#ffc53d' : '#5c6370';
      ctx.fillText(owned ? 'Owned' : known ? fmt(u.cost) : '', W - 24, y + 21);
      button(LIST_X + 12, y, W - LIST_X - 24, rowH - 6, { enabled: can, onClick: () => buyUpgrade(u) });
    });
    ctx.fillStyle = '#5c6370';
    ctx.textAlign = 'center';
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText('Upgrades reset when you dive deeper.', LIST_X + (W - LIST_X) / 2, H - 22);
  }

  function drawEffects(dt) {
    for (const f of floaters) f.t += dt;
    floaters = floaters.filter(f => f.t < 1.2);
    ctx.textAlign = 'center';
    for (const f of floaters) {
      ctx.globalAlpha = 1 - f.t / 1.2;
      ctx.fillStyle = f.hot ? '#ff7a7a' : f.big ? '#ffd54f' : '#eceef2';
      ctx.font = `700 ${f.big ? 20 : 15}px system-ui, sans-serif`;
      ctx.fillText(f.text, f.x, f.y - f.t * 60);
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
    chips = chips.filter(c => c.t < 0.8);
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

  let last = performance.now(), t = 0;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    t += dt;
    earn(perSecond() * dt);
    shake = Math.max(0, shake - dt);
    frenzy = Math.max(0, frenzy - dt);
    overheat = Math.max(0, overheat - dt);

    veinT -= dt;
    if (vein) {
      vein.t += dt;
      if (vein.t > VEIN_TIME) vein = null;
    } else if (veinT <= 0) {
      const a = Arcade.rand(0, Math.PI * 2), r = Arcade.rand(20, 80);
      vein = { x: ROCK.x + Math.cos(a) * r, y: ROCK.y + Math.sin(a) * r, t: 0, hits: 0 };
      veinT = Arcade.rand(25, 45);
    }

    if (layer() > s.layer) {
      s.layer = layer();
      Arcade.toast('New layer', `${LAYERS[s.layer].name} · ${LAYERS[s.layer].at} m`);
    }

    nuggetT -= dt;
    if (nugget) {
      nugget.t += dt;
      if (nugget.t > 8) nugget = null;
    } else if (nuggetT <= 0) {
      nugget = { x: Arcade.rand(40, LIST_X - 40), y: Arcade.rand(120, 380), t: 0 };
      nuggetT = Arcade.rand(60, 120) / (has('charm') ? 2 : 1);
    }

    buttons = [];
    drawRock(t);
    drawList();
    drawEffects(dt);
    updateHud();
    requestAnimationFrame(frame);
  }

  // Earnings while the tab was closed, at half speed, up to 8 hours.
  load();
  const away = Math.min(has('shift') ? 12 * 3600 : OFFLINE_CAP, (Date.now() - s.saved) / 1000);
  const offline = s.lifetime > 0 && away > 30 ? perSecond() * away * (has('shift') ? 1 : OFFLINE_RATE) : 0;
  if (offline > 0) {
    earn(offline);
    const hrs = Math.floor(away / 3600), mins = Math.floor((away % 3600) / 60);
    ui.show({
      title: 'Welcome back!',
      html: `<p>Your diggers kept working for ${hrs ? `${hrs}h ` : ''}${mins}m while you were away.</p><p class="big">+${fmt(offline)}</p><p>gems</p>`,
      button: 'Collect',
      onAction: () => ui.hide(),
    });
  } else if (s.lifetime === 0) {
    ui.show({
      title: 'Gem Mine',
      html: `<ul>
        <li><b>Click the rock</b> to dig up gems.</li>
        <li>Spend gems on <b>diggers</b> that mine for you, even while you're away.</li>
        <li>Catch the <b>golden nugget</b> when it shows up, and hit <b>glowing veins</b> ${VEIN_HITS} times for a bonus.</li>
        <li>Click too fast (more than ${MAX_CPS} a second) and your pick <b>overheats</b>.</li>
        <li>Buy one-time <b>upgrades</b> in the Upgrades tab.</li>
        <li>Once you've dug about 30,000 gems, <b>dive deeper</b>: start over with core shards that speed everything up by 25% each.</li>
      </ul>`,
      button: 'Start digging',
      onAction: () => ui.hide(),
    });
  } else {
    ui.hide();
  }
  requestAnimationFrame(frame);
})();
