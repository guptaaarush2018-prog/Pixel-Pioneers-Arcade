/* Wisp Wardens: maps, wisps, towers, upgrades and the wave generator. No drawing in here. */
const WW = (() => {
  const W = 900, H = 600;

  // ---------- Wisps ----------
  // Pop a wisp and it splits into its children, like layers of an onion. hp is how many hits one layer takes.
  // immune: damage types that do nothing to it.
  const WISPS = {
    ember:   { name: 'Ember',   speed: 1.0,  hp: 1, kids: [],                     color: '#ff5d5d', r: 9 },
    azure:   { name: 'Azure',   speed: 1.25, hp: 1, kids: ['ember'],              color: '#4aa8ff', r: 10 },
    sprout:  { name: 'Sprout',  speed: 1.6,  hp: 1, kids: ['azure'],              color: '#5fe36a', r: 10.5 },
    glint:   { name: 'Glint',   speed: 2.2,  hp: 1, kids: ['sprout'],             color: '#ffe14d', r: 11 },
    bloom:   { name: 'Bloom',   speed: 2.6,  hp: 1, kids: ['glint'],              color: '#ff7ad0', r: 11.5 },
    shade:   { name: 'Shade',   speed: 2.0,  hp: 1, kids: ['bloom', 'bloom'],     color: '#2a2438', r: 12, immune: ['blast'], ring: '#9a7bff' },
    ghost:   { name: 'Ghost',   speed: 2.0,  hp: 1, kids: ['bloom', 'bloom'],     color: '#e9f1ff', r: 12, immune: ['cold'], alpha: 0.7 },
    iron:    { name: 'Iron',    speed: 1.0,  hp: 1, kids: ['shade', 'ghost'],     color: '#8a93a6', r: 13, immune: ['sharp'], shape: 'hex' },
    crystal: { name: 'Crystal', speed: 2.2,  hp: 10, kids: ['bloom', 'bloom'],    color: '#9ff0ff', r: 13, shape: 'diamond' },
    behemoth:{ name: 'Behemoth', speed: 0.9, hp: 220, kids: ['crystal', 'crystal', 'crystal', 'crystal'], color: '#c0392b', r: 26, boss: true, shape: 'blimp' },
    titan:   { name: 'Titan',   speed: 0.8,  hp: 900, kids: ['behemoth', 'behemoth', 'crystal', 'crystal'], color: '#5b2a86', r: 34, boss: true, shape: 'blimp' },
  };
  const rbeCache = {};
  function rbe(t) {
    if (rbeCache[t] !== undefined) return rbeCache[t];
    const w = WISPS[t];
    return (rbeCache[t] = w.hp + w.kids.reduce((a, k) => a + rbe(k), 0));
  }

  // ---------- Waves ----------
  const TIERS = [
    [1, 4, [['ember', 1]]],
    [5, 8, [['ember', 0.4], ['azure', 0.6]]],
    [9, 12, [['azure', 0.4], ['sprout', 0.6]]],
    [13, 17, [['sprout', 0.4], ['glint', 0.6]]],
    [18, 22, [['glint', 0.5], ['bloom', 0.5]]],
    [23, 27, [['bloom', 0.6], ['shade', 0.4]]],
    [28, 32, [['bloom', 0.4], ['ghost', 0.3], ['shade', 0.3]]],
    [33, 38, [['shade', 0.4], ['ghost', 0.3], ['iron', 0.3]]],
    [39, 45, [['crystal', 0.6], ['iron', 0.4]]],
    [46, 9999, [['crystal', 0.5], ['shade', 0.2], ['ghost', 0.2], ['iron', 0.1]]],
  ];
  const BOSSES = { 25: [['behemoth', 1]], 40: [['behemoth', 2]], 50: [['titan', 1]], 60: [['titan', 2]], 70: [['titan', 2], ['behemoth', 2]], 80: [['titan', 3]] };

  // A wave is a list of groups: { type, count, gap (seconds between wisps), at (start delay) }.
  function wave(n) {
    const tier = TIERS.find(t => n >= t[0] && n <= t[1]);
    const budget = 14 + 7 * n + 0.5 * n * n;
    const span = Math.min(30, 12 + n * 0.2);
    const groups = [];
    let at = 0;
    for (const [type, share] of tier[2]) {
      const count = Math.max(1, Math.round(budget * share / rbe(type)));
      const gap = Math.max(0.1, (span * Math.max(0.35, share)) / count);
      groups.push({ type, count, gap, at });
      at += span * 0.18 * (1 + share);
    }
    const boss = n > 80 ? (n % 10 === 0 ? [['titan', Math.floor(n / 20)]] : null) : BOSSES[n];
    if (boss) boss.forEach(([type, count], i) => groups.push({ type, count, gap: 4, at: 4 + i * 6 }));
    return groups;
  }
  const waveRbe = n => wave(n).reduce((a, g) => a + g.count * rbe(g.type), 0);

  // ---------- Difficulties ----------
  const DIFFS = {
    easy:   { name: 'Easy',   waves: 40, lives: 150, cash: 800, cost: 0.85, mult: 1,   blurb: '40 waves · cheaper towers' },
    medium: { name: 'Medium', waves: 60, lives: 100, cash: 650, cost: 1,    mult: 1.6, blurb: '60 waves' },
    hard:   { name: 'Hard',   waves: 80, lives: 60,  cash: 550, cost: 1.08, mult: 2.5, blurb: '80 waves · pricey towers' },
  };

  // ---------- Maps ----------
  const sine = (amp, per, y0, x0 = -30, x1 = 930, step = 24) => {
    const pts = [];
    for (let x = x0; x <= x1; x += step) pts.push([x, Math.round(y0 + amp * Math.sin((x - x0) / per))]);
    return pts;
  };
  const MAPS = [
    { id: 'meadow', name: 'Meadow Bend', sub: 'A gentle first walk', ground: ['#2f6b3a', '#2a5f34'], road: '#c9b27a', edge: '#8c7a4a',
      paths: [[[-30, 120], [220, 120], [220, 300], [600, 300], [600, 110], [780, 110], [780, 480], [300, 480], [300, 560], [930, 560]]] },
    { id: 'switch', name: 'Switchback', sub: 'Long and winding', ground: ['#31506b', '#2b4660'], road: '#d6dfe8', edge: '#7f93a6',
      paths: [[[-30, 70], [820, 70], [820, 170], [80, 170], [80, 270], [820, 270], [820, 370], [80, 370], [80, 470], [820, 470], [820, 560], [930, 560]]] },
    { id: 'spiral', name: 'The Spiral', sub: 'Everything ends in the middle', ground: ['#4a3a63', '#42335a'], road: '#d7c7ff', edge: '#8a74c4',
      paths: [[[-30, 40], [860, 40], [860, 560], [40, 560], [40, 120], [780, 120], [780, 480], [120, 480], [120, 200], [700, 200], [700, 400], [200, 400], [200, 300], [450, 300]]] },
    { id: 'rivers', name: 'Twin Rivers', sub: 'Two doors, one road', ground: ['#2d6a66', '#275c59'], road: '#e8e0b9', edge: '#9a9468',
      paths: [[[-30, 90], [330, 90], [330, 300], [930, 300]], [[-30, 510], [330, 510], [330, 300], [930, 300]]] },
    { id: 'cross', name: 'Crossroads', sub: 'Two roads, one big junction', ground: ['#5b6b2f', '#515f2a'], road: '#e0d3a2', edge: '#968a5a',
      paths: [[[-30, 150], [450, 150], [450, 450], [930, 450]], [[-30, 450], [300, 450], [300, 150], [930, 150]]] },
    { id: 'canyon', name: 'Sunset Canyon', sub: 'Smooth curves, wide open', ground: ['#7a4a2c', '#6e4227'], road: '#f0c98a', edge: '#b0753a',
      paths: [sine(190, 150, 300)] },
    { id: 'pillars', name: 'Pillar Run', sub: 'Tall laps through the hall', ground: ['#3a3f4f', '#333847'], road: '#c8d0e6', edge: '#7b86a8',
      paths: [[[-30, 540], [160, 540], [160, 60], [330, 60], [330, 540], [500, 540], [500, 60], [670, 60], [670, 540], [840, 540], [840, 300], [930, 300]]] },
    { id: 'loop', name: 'Grand Loop', sub: 'It crosses itself. Plan for it', ground: ['#285c4a', '#235242'], road: '#d5f0d0', edge: '#79ab8a',
      paths: [[[-30, 320], [120, 320], [120, 90], [780, 90], [780, 510], [330, 510], [330, 300], [560, 300], [560, 230]]] },
  ];
  // Path helpers (precomputed lengths so a wisp is just a distance along the road).
  for (const m of MAPS) {
    m.routes = m.paths.map(pts => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, cum, total: cum[cum.length - 1] };
    });
    // Scenery: rocks and trees that can't be built on, placed away from the road.
    const rnd = ((seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; })(m.id.length * 977 + m.id.charCodeAt(0) * 31);
    m.decor = [];
    let tries = 0;
    while (m.decor.length < 14 && tries++ < 400) {
      const o = { x: 30 + rnd() * (W - 60), y: 30 + rnd() * (H - 60), r: 12 + rnd() * 12, kind: rnd() < 0.6 ? 'tree' : 'rock' };
      if (distToRoutes(m, o.x, o.y) < 60 + o.r) continue;
      if (m.decor.some(d => Math.hypot(d.x - o.x, d.y - o.y) < d.r + o.r + 20)) continue;
      m.decor.push(o);
    }
  }
  function distToSeg(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }
  function distToRoutes(m, x, y) {
    let best = 1e9;
    for (const r of m.routes) for (let i = 1; i < r.pts.length; i++) best = Math.min(best, distToSeg(x, y, r.pts[i - 1], r.pts[i]));
    return best;
  }
  // Position at distance s along a route; seg is a hint to keep it fast.
  function posAt(route, s, out) {
    const { pts, cum } = route;
    let i = out.seg || 1;
    if (s < cum[i - 1]) i = 1;
    while (i < cum.length - 1 && s > cum[i]) i++;
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    out.seg = i;
    out.x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
    out.y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
    return out;
  }

  // ---------- Towers ----------
  // Upgrade effects: add (+), mul (x), set (=). Two paths of four; one path can go to the top
  // only while the other stays at tier 2 or below.
  const U = (name, cost, desc, fx) => ({ name, cost, desc, fx });
  const TOWERS = {
    spark: { name: 'Spark Turret', cost: 200, color: '#ffc53d', blurb: 'Fast, cheap, reliable bolts.',
      base: { kind: 'proj', range: 120, rate: 0.8, dmg: 1, pierce: 2, speed: 560, shots: 1, spread: 0.2, dtype: 'sharp', slow: 1, slowT: 0 },
      paths: [
        ['Rapid Fire', [U('Quick Draw', 140, 'Fires 25% faster.', { mul: { rate: 0.75 } }), U('Twin Bolt', 260, 'Shoots two bolts at once.', { add: { shots: 1 } }), U('Barrage', 700, 'Three bolts and faster fire.', { set: { shots: 3 }, mul: { rate: 0.7 } }), U('Storm Core', 3200, 'Four bolts, blazing fast.', { set: { shots: 4 }, mul: { rate: 0.4 }, add: { dmg: 1 } })]],
        ['Piercing', [U('Sharp Tips', 120, 'Bolts pop 3 more wisps.', { add: { pierce: 3 } }), U('Long Reach', 150, 'More range.', { add: { range: 25 } }), U('Razor Bolts', 600, 'Heavier bolts cut deeper.', { add: { dmg: 2, pierce: 4 } }), U('Lance Beam', 2800, 'Huge damage, huge range.', { add: { dmg: 4, pierce: 20, range: 40 }, mul: { rate: 0.8 } })]],
      ] },
    frost: { name: 'Frost Pylon', cost: 300, color: '#8fe3ff', blurb: 'Chills everything nearby. Ghosts shrug it off.',
      base: { kind: 'pulse', range: 90, rate: 2.0, dmg: 0, slow: 0.5, slowT: 1.6, dtype: 'cold', pierce: 99, shots: 1 },
      paths: [
        ['Deep Freeze', [U('Cold Snap', 150, 'Slows for longer.', { add: { slowT: 1 } }), U('Glacial', 240, 'Slows much harder.', { set: { slow: 0.35 } }), U('Absolute Zero', 900, 'Almost stops them.', { set: { slow: 0.1 }, add: { slowT: 1 } }), U('Ice Age', 3500, 'Big range, hurts as it freezes.', { add: { range: 40, dmg: 1 }, mul: { rate: 0.6 } })]],
        ['Reach', [U('Wide Chill', 130, 'More range.', { add: { range: 30 } }), U('Frost Nova', 300, 'Pulses faster.', { mul: { rate: 0.7 } }), U('Shatter', 800, 'Cold now pops a layer.', { add: { dmg: 1 } }), U('Permafrost', 2800, 'Pops two layers, range, faster.', { add: { dmg: 2, range: 30, slowT: 1 }, mul: { rate: 0.6 } })]],
      ] },
    bombard: { name: 'Bombard', cost: 650, color: '#ff7a45', blurb: 'Explosive shells hit a whole crowd. Shades resist.',
      base: { kind: 'blast', range: 140, rate: 1.7, dmg: 1, blast: 48, speed: 420, dtype: 'blast', pierce: 1, shots: 1, slow: 1, slowT: 0 },
      paths: [
        ['Blast', [U('Big Bomb', 350, 'Larger explosions.', { add: { blast: 16 } }), U('Heavy Shell', 550, 'Hits harder.', { add: { dmg: 1 } }), U('Mega Blast', 1500, 'Huge blast radius.', { add: { blast: 30, dmg: 1 } }), U('Cataclysm', 5500, 'Devastating blasts.', { add: { blast: 60, dmg: 4 }, mul: { rate: 0.8 } })]],
        ['Reload', [U('Quick Load', 300, 'Fires faster.', { mul: { rate: 0.75 } }), U('Autoloader', 450, 'Faster still, more range.', { mul: { rate: 0.7 }, add: { range: 15 } }), U('Rapid Mortar', 1600, 'A mortar battery.', { mul: { rate: 0.55 } }), U('Thunder Barrage', 6000, 'Constant shelling.', { mul: { rate: 0.3 }, add: { dmg: 1, blast: 20 } })]],
      ] },
    sniper: { name: 'Sniper Spire', cost: 350, color: '#a6ffcb', blurb: 'Hits anything on the map. Slow, hard-hitting.',
      base: { kind: 'snipe', range: 99999, rate: 2.2, dmg: 2, dtype: 'sharp', pierce: 1, shots: 1, slow: 1, slowT: 0 },
      paths: [
        ['Power', [U('Hollow Point', 300, 'More damage.', { add: { dmg: 2 } }), U('Heavy Slug', 700, 'Much more damage.', { add: { dmg: 4 } }), U('Cannon Round', 2200, 'Cracks crystal in one shot.', { add: { dmg: 10 } }), U('Executioner', 9000, 'Deletes bosses.', { add: { dmg: 60 } })]],
        ['Speed', [U('Bolt Action', 350, 'Fires faster.', { mul: { rate: 0.7 } }), U('Semi-Auto', 600, 'Much faster.', { mul: { rate: 0.55 } }), U('Full Auto', 3000, 'Rapid fire, more damage.', { mul: { rate: 0.3 }, add: { dmg: 1 } }), U('Gatling Spire', 7000, 'An endless stream.', { mul: { rate: 0.3 }, add: { dmg: 2 } })]],
      ] },
    arc: { name: 'Arc Thrower', cost: 280, color: '#ff8fd6', blurb: 'Boomerang blades that slice both ways.',
      base: { kind: 'arc', range: 130, rate: 1.3, dmg: 1, pierce: 6, speed: 380, shots: 1, spread: 0.15, dtype: 'sharp', slow: 1, slowT: 0 },
      paths: [
        ['Spin', [U('Sharper Edges', 180, 'Blades pop more wisps.', { add: { pierce: 4 } }), U('Glaives', 400, 'Heavier blades.', { add: { dmg: 1 } }), U('Razor Whirl', 1300, 'An extra blade.', { add: { shots: 1, pierce: 6 } }), U('Chaos Blades', 4200, 'Three blades, big damage.', { set: { shots: 3 }, add: { dmg: 2, pierce: 10 } })]],
        ['Range', [U('Long Throw', 150, 'More range.', { add: { range: 25 } }), U('Fast Return', 300, 'Faster, faster fire.', { add: { speed: 150 }, mul: { rate: 0.8 } }), U('Double Chakram', 900, 'Two blades, faster.', { add: { shots: 1 }, mul: { rate: 0.7 } }), U('Eternal Orbit', 3600, 'Blades never stop.', { mul: { rate: 0.35 }, add: { range: 40, pierce: 20 } })]],
      ] },
    hive: { name: 'Wasp Hive', cost: 500, color: '#ffd23f', blurb: 'Seeking stingers chase down the nearest wisp.',
      base: { kind: 'seek', range: 150, rate: 1.1, dmg: 1, pierce: 1, speed: 340, shots: 1, dtype: 'sharp', slow: 1, slowT: 0 },
      paths: [
        ['Swarm', [U('Bigger Hive', 400, 'One more wasp.', { add: { shots: 1 } }), U('Wasp Wave', 550, 'Another wasp, faster.', { add: { shots: 1 }, mul: { rate: 0.8 } }), U('Locust Cloud', 1800, 'A huge cloud.', { add: { shots: 3 }, mul: { rate: 0.6 } }), U('Plague Swarm', 7000, 'The sky goes dark.', { add: { shots: 6, dmg: 1 }, mul: { rate: 0.4 } })]],
        ['Venom', [U('Barbed Stingers', 300, 'Stingers pop two wisps.', { set: { pierce: 2 } }), U('Venom', 450, 'Stung wisps slow down.', { set: { slow: 0.7, slowT: 1.2 } }), U('Hunter Wasps', 1400, 'Faster, longer reach, harder.', { add: { dmg: 1, range: 40, speed: 80 } }), U('Queen’s Wrath', 5500, 'Brutal stings.', { add: { dmg: 3, pierce: 3 }, mul: { rate: 0.6 } })]],
      ] },
    tesla: { name: 'Tesla Coil', cost: 550, color: '#9fb5ff', blurb: 'Chain lightning that hits several wisps at once.',
      base: { kind: 'chain', range: 110, rate: 1.2, dmg: 1, chain: 3, dtype: 'energy', pierce: 1, shots: 1, stun: 0, slow: 1, slowT: 0 },
      paths: [
        ['Chain', [U('Longer Arcs', 300, 'Two more jumps.', { add: { chain: 2 } }), U('Storm Arcs', 600, 'Three more jumps.', { add: { chain: 3 } }), U('Thunder', 2000, 'Many jumps, harder, faster.', { add: { chain: 6, dmg: 1 }, mul: { rate: 0.8 } }), U('Overload', 6500, 'Lightning everywhere.', { add: { chain: 12, dmg: 2 }, mul: { rate: 0.6 } })]],
        ['Charge', [U('Capacitor', 250, 'Fires faster.', { mul: { rate: 0.8 } }), U('Stun Bolts', 500, 'Stuns wisps briefly.', { set: { stun: 0.4 } }), U('Lightning Rod', 1500, 'Range, damage, longer stun.', { add: { range: 40, dmg: 1 }, set: { stun: 0.7 } }), U('Tesla Grid', 5500, 'Constant shocking.', { mul: { rate: 0.35 }, set: { stun: 1 }, add: { dmg: 2 } })]],
      ] },
    mint: { name: 'Mint Engine', cost: 600, color: '#ffe14d', blurb: 'Makes cash at the end of every wave. Doesn’t fight.',
      base: { kind: 'econ', range: 0, rate: 1, dmg: 0, cash: 90, interest: 0, pierce: 0, shots: 0, dtype: 'none', slow: 1, slowT: 0 },
      paths: [
        ['Yield', [U('Better Crop', 500, '+60 per wave.', { add: { cash: 60 } }), U('Golden Mint', 700, '+120 per wave.', { add: { cash: 120 } }), U('Bank', 3000, '+400 per wave.', { add: { cash: 400 } }), U('Treasury', 9000, '+1,500 per wave.', { add: { cash: 1500 } })]],
        ['Markets', [U('Auto-collect', 400, '+30 per wave.', { add: { cash: 30 } }), U('Trade Route', 900, 'Earn 2% interest on your cash.', { add: { interest: 0.02 } }), U('Investment', 2500, '+200 per wave.', { add: { cash: 200 } }), U('Stock Exchange', 8000, '+800 per wave and 4% more interest.', { add: { cash: 800, interest: 0.04 } })]],
      ] },
  };
  const TOWER_ORDER = ['spark', 'frost', 'bombard', 'sniper', 'arc', 'hive', 'tesla', 'mint'];

  // Turn a tower's base stats and bought upgrades into the numbers the game uses.
  function statsFor(id, tiers) {
    const def = TOWERS[id];
    const s = { ...def.base };
    tiers.forEach((n, p) => {
      for (let i = 0; i < n; i++) {
        const fx = def.paths[p][1][i].fx;
        if (fx.set) Object.assign(s, fx.set);
        if (fx.add) for (const k in fx.add) s[k] = (s[k] || 0) + fx.add[k];
        if (fx.mul) for (const k in fx.mul) s[k] = s[k] * fx.mul[k];
      }
    });
    s.rate = Math.max(0.04, s.rate);
    return s;
  }
  // Can this path be bought one tier further? (4 on one path means the other stays at 2 or less.)
  function canUpgrade(tiers, p) {
    const n = tiers[p], o = tiers[1 - p];
    if (n >= 4) return false;
    if (n + 1 > 2 && o > 2) return false;
    return true;
  }
  const upgradeCostTotal = (id, tiers) => TOWERS[id].paths.reduce((a, [, ups], p) => a + ups.slice(0, tiers[p]).reduce((b, u) => b + u.cost, 0), 0);

  return { W, H, WISPS, rbe, wave, waveRbe, DIFFS, MAPS, TOWERS, TOWER_ORDER, statsFor, canUpgrade, upgradeCostTotal, distToRoutes, posAt };
})();
