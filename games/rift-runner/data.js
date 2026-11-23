/* Rift Runner: worlds, runners and the level generator.
   A tunnel is a ring of 20 cells (four faces of five). A level is a list of rows, each row 20 cell codes.
   Nothing here touches the screen, so a level is the same every time for the same seed. */
const RR = (() => {
  const RING = 20;
  const T = { EMPTY: 0, TILE: 1, CRUMBLE: 2, ICE: 3, BOOST: 4, BOUNCE: 5, SPIKE: 6, BARRIER: 7 };

  // Each world has its own look, its own tile types and its own tune.
  const WORLDS = [
    { id: 'gate', name: 'Neon Gate', blurb: 'Learn the ring. Clean tiles, wide gaps, boost strips.',
      sky: ['#04061a', '#10204f'], fog: '#0a1236', tileA: '#27d6ff', tileB: '#1b8fd8', glow: '#7ef2ff', star: '#bfeaff',
      features: ['open', 'corridor', 'boost'], bpm: 118, scale: [0, 3, 5, 7, 10], root: 110 },
    { id: 'forge', name: 'Ember Forge', blurb: 'Crumbling floors and spikes over a lava sky.',
      sky: ['#150303', '#4a1208'], fog: '#2a0a05', tileA: '#ff8a3a', tileB: '#c2501b', glow: '#ffd08a', star: '#ffb36b',
      features: ['open', 'corridor', 'crumble', 'spike', 'boost'], bpm: 126, scale: [0, 3, 5, 6, 10], root: 98 },
    { id: 'frost', name: 'Frost Core', blurb: 'Slippery ice and springy bounce pads.',
      sky: ['#04101c', '#1c4a6e'], fog: '#0d2740', tileA: '#bfeaff', tileB: '#7fc4ee', glow: '#ffffff', star: '#e8f8ff',
      features: ['open', 'corridor', 'ice', 'bounce', 'scatter', 'boost'], bpm: 112, scale: [0, 2, 4, 7, 9], root: 123 },
    { id: 'grove', name: 'Overgrowth', blurb: 'Barriers to hurdle, crumbling vines, scattered islands.',
      sky: ['#031208', '#0e3b1e'], fog: '#082414', tileA: '#6ee06a', tileB: '#2f9e48', glow: '#d2ff9a', star: '#b6ffb0',
      features: ['open', 'corridor', 'barrier', 'crumble', 'scatter', 'bridge', 'boost'], bpm: 132, scale: [0, 2, 4, 7, 9], root: 104 },
    { id: 'chrome', name: 'Chrome City', blurb: 'Zig-zag lanes and a bit of everything.',
      sky: ['#0b0a1a', '#3a1d5c'], fog: '#1d1030', tileA: '#ff5fd0', tileB: '#7a64ff', glow: '#ffd0f4', star: '#ffc6ee',
      features: ['open', 'corridor', 'zigzag', 'barrier', 'spike', 'bounce', 'ice', 'scatter', 'boost'], bpm: 138, scale: [0, 3, 5, 7, 8], root: 117 },
    { id: 'matter', name: 'Dark Matter', blurb: 'The long way out. Everything, fast, and thin bridges.',
      sky: ['#000000', '#1a0636'], fog: '#09021a', tileA: '#b06bff', tileB: '#5a2fc2', glow: '#e6c8ff', star: '#d9b8ff',
      features: ['open', 'corridor', 'zigzag', 'barrier', 'spike', 'bounce', 'ice', 'crumble', 'scatter', 'bridge', 'boost'], bpm: 146, scale: [0, 1, 5, 7, 8], root: 92 },
  ];

  // Runners. steer: sideways speed, jump: jump power, speed: run speed, glide: hold jump to fall slowly,
  // air: extra jumps in the air, shield: falls it can survive (it pops back to the last solid tile).
  const RUNNERS = [
    { id: 'pip', name: 'Pip', cost: 0, color: '#ffc53d', trim: '#1c1500', steer: 1, jump: 1, speed: 1, glide: false, air: 0, shield: 0, perk: 'Balanced and friendly.' },
    { id: 'zephyr', name: 'Zephyr', cost: 400, color: '#5fe3ff', trim: '#062a33', steer: 1.28, jump: 1, speed: 1, glide: false, air: 0, shield: 0, perk: 'Turns on a dime.' },
    { id: 'bolt', name: 'Bolt', cost: 900, color: '#ff5d73', trim: '#330710', steer: 1, jump: 0.97, speed: 1.12, glide: false, air: 0, shield: 0, perk: 'Runs 12% faster. Gaps get longer, so watch out.' },
    { id: 'spring', name: 'Spring', cost: 1600, color: '#8cff6b', trim: '#0f3300', steer: 0.95, jump: 1.22, speed: 1, glide: false, air: 0, shield: 0, perk: 'Jumps much higher and farther.' },
    { id: 'drift', name: 'Drift', cost: 2600, color: '#c79bff', trim: '#210a45', steer: 1.05, jump: 1, speed: 1, glide: true, air: 0, shield: 0, perk: 'Hold jump in the air to glide.' },
    { id: 'echo', name: 'Echo', cost: 4000, color: '#ffffff', trim: '#222a40', steer: 1.1, jump: 1.04, speed: 1.04, glide: false, air: 1, shield: 1, perk: 'A double jump, and one save per run.' },
  ];

  // ---------- Randomness ----------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const wrap = c => ((c % RING) + RING) % RING;

  // How a campaign level feels. 36 levels, six per world, climbing smoothly.
  function campaignParams(w, l) {
    const idx = w * 6 + l, d = idx / 35;
    const speed = 11 + 4.8 * d;
    const length = Math.round(650 + 1000 * d + (l === 5 ? 220 : 0));
    return { idx, d, speed, length, w };
  }
  const levelName = (w, l) => `${w + 1}-${l + 1}`;

  // ---------- The generator ----------
  // opts: seed, length (rows, or Infinity), at(row) -> { d, speed, features: [names], world }, checkpoints (bool)
  function createLevel(opts) {
    const rand = rng(opts.seed);
    const rows = [], lane = [];
    const shardsAt = new Map();
    let shardCount = 0;
    let cur = Math.floor(rand() * RING);
    const length = opts.length;
    const cps = [];
    if (opts.checkpoints && isFinite(length)) for (const f of [0.25, 0.5, 0.75]) cps.push(Math.round(length * f));
    let cpNext = 0, justGapped = false, finished = false;
    const finishRow = length;

    const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const pushRow = r => { rows.push(r); lane.push(wrap(cur)); return r; };
    const blank = () => new Uint8Array(RING);
    function fillAround(r, w, type) { // w cells centred on the lane
      const lo = -Math.floor((w - 1) / 2);
      for (let i = 0; i < w; i++) r[wrap(cur + lo + i)] = type;
    }
    function addShard(row, c, h = 0.9) {
      const k = { r: row, c: wrap(c) + 0.5, h, got: false };
      if (!shardsAt.has(row)) shardsAt.set(row, []);
      shardsAt.get(row).push(k);
      shardCount++;
    }
    const step = () => { cur = wrap(cur + (rand() < 0.5 ? -1 : 1)); };

    function ring(n, type = T.TILE) {
      for (let i = 0; i < n; i++) { const r = blank(); r.fill(type); pushRow(r); }
    }
    function open(len, p, surf) {
      const dens = p.density;
      let shardLine = 0;
      for (let i = 0; i < len; i++) {
        const r = blank();
        for (let c = 0; c < RING; c++) if (rand() < dens) r[c] = surf;
        fillAround(r, 3, surf);
        if (rand() < 0.16) step();
        const at = rows.length;
        pushRow(r);
        if (shardLine > 0) { addShard(at, cur); shardLine--; }
        else if (rand() < 0.07) shardLine = ri(3, 6);
      }
    }
    function corridor(len, p, surf, w) {
      const shiftP = 0.05 + 0.12 * p.d;
      for (let i = 0; i < len; i++) {
        const r = blank();
        if (i > 0 && rand() < shiftP) step();
        fillAround(r, w, surf);
        const at = rows.length;
        pushRow(r);
        if (i % 2 === 0 && rand() < 0.65) addShard(at, cur);
      }
    }
    function zigzag(len, p) {
      let dir = rand() < 0.5 ? -1 : 1;
      const every = p.d > 0.6 ? 2 : 3;
      for (let i = 0; i < len; i++) {
        const r = blank();
        if (i > 0 && i % every === 0) {
          cur = wrap(cur + dir);
          if (rand() < 0.25) dir = -dir;
        }
        fillAround(r, p.d > 0.6 ? 2 : 3, T.TILE);
        const at = rows.length;
        pushRow(r);
        if (i % 2 === 1) addShard(at, cur);
      }
    }
    function scatter(len, p, surf) {
      for (let i = 0; i < len; i++) {
        const r = blank();
        for (let c = 0; c < RING; c++) if (rand() < 0.28) r[c] = surf;
        if (rand() < 0.55) step();
        fillAround(r, 2, surf);
        const at = rows.length;
        pushRow(r);
        if (i % 2 === 0) addShard(at, cur);
      }
    }
    function bridge(len, p) {
      const w = p.d > 0.7 ? 1 : 2;
      for (let i = 0; i < len; i++) {
        const r = blank();
        fillAround(r, w, T.TILE);
        const at = rows.length;
        pushRow(r);
        if (i % 2 === 0) addShard(at, cur, 0.9);
      }
    }
    function barriers(len, p) {
      let since = 0;
      for (let i = 0; i < len; i++) {
        const r = blank();
        fillAround(r, 9, T.TILE);
        if (rand() < 0.12) step();
        since++;
        if (since >= 6 && i > 3 && i < len - 3) {
          since = 0;
          const wide = p.d > 0.5 ? 5 : 3;
          const lo = -Math.floor((wide - 1) / 2);
          for (let k = 0; k < wide; k++) r[wrap(cur + lo + k)] = T.BARRIER;
        }
        const at = rows.length;
        pushRow(r);
        if (since === 3) addShard(at, cur, 1.5);
      }
    }
    function spikes(len, p) {
      let since = 0;
      for (let i = 0; i < len; i++) {
        const r = blank();
        fillAround(r, 7, T.TILE);
        since++;
        if (since >= 4 && i > 2 && i < len - 2) {
          since = 0;
          const s = rand() < 0.5 ? -1 : 1;
          r[wrap(cur)] = T.SPIKE;
          r[wrap(cur + s)] = T.SPIKE;
          if (p.d > 0.5) r[wrap(cur - s)] = T.SPIKE;
          cur = wrap(cur - s * (p.d > 0.5 ? 2 : 1));
        }
        const at = rows.length;
        pushRow(r);
        if (since === 2) addShard(at, cur);
      }
    }
    function boostStrip(len, p) {
      open(2, p, T.TILE);
      for (let i = 0; i < len; i++) {
        const r = blank();
        fillAround(r, 5, T.TILE);
        fillAround(r, 3, T.BOOST);
        const at = rows.length;
        pushRow(r);
        addShard(at, cur, 0.9);
      }
      open(3, p, T.TILE);
    }
    // A gap: nothing but space, then a wide landing. The bounce version launches you much farther.
    function gap(p, bounce) {
      const n = bounce ? ri(Math.max(3, p.gapMax), Math.floor(p.gapMax * 1.6) + 1) : ri(2, p.gapMax);
      if (bounce) {
        for (let i = 0; i < 2; i++) { const r = blank(); fillAround(r, 7, T.TILE); fillAround(r, 3, T.BOUNCE); pushRow(r); }
      } else {
        open(2, p, T.TILE);
      }
      for (let i = 0; i < n; i++) {
        const at = rows.length;
        pushRow(blank());
        if (i % 2 === 0) addShard(at, cur, bounce ? 2.4 : 1.7);
      }
      for (let i = 0; i < 4; i++) { const r = blank(); fillAround(r, 9, T.TILE); pushRow(r); }
    }

    function pickSegment(p) {
      const f = p.features;
      const has = n => f.includes(n);
      if (!justGapped && rand() < p.gapChance) {
        justGapped = true;
        gap(p, has('bounce') && rand() < 0.4);
        return;
      }
      justGapped = false;
      const bag = ['open', 'open', 'corridor'];
      for (const n of ['zigzag', 'barrier', 'spike', 'scatter', 'bridge', 'boost']) if (has(n)) bag.push(n);
      if (has('ice')) bag.push('ice');
      if (has('crumble')) bag.push('crumble');
      const kind = bag[Math.floor(rand() * bag.length)];
      const len = ri(8, 16);
      switch (kind) {
        case 'open': open(len, p, T.TILE); break;
        case 'corridor': corridor(len, p, T.TILE, p.d > 0.55 ? 2 : 3); break;
        case 'zigzag': zigzag(len, p); break;
        case 'barrier': barriers(len + 4, p); break;
        case 'spike': spikes(len + 2, p); break;
        case 'scatter': scatter(len, p, T.TILE); break;
        case 'bridge': bridge(ri(6, 12), p); break;
        case 'boost': boostStrip(ri(3, 5), p); break;
        case 'ice': if (rand() < 0.5) open(len, p, T.ICE); else corridor(len, p, T.ICE, 3); break;
        case 'crumble': if (rand() < 0.5) open(len, p, T.CRUMBLE); else corridor(len, p, T.CRUMBLE, 3); break;
      }
    }

    function ensure(n) {
      while (rows.length < n) {
        if (finished) { pushRow(blank()); continue; }
        if (cpNext < cps.length && rows.length >= cps[cpNext]) { ring(8); cpNext++; continue; }
        if (rows.length >= finishRow) { ring(12); finished = true; continue; }
        const p = opts.at(rows.length);
        pickSegment(p);
      }
    }
    // Row 0..13 is a plain, wide runway so a level starts calmly.
    ring(14);
    ensure(80);
    return {
      rows, lane, shardsAt, length, finishRow, cps, ensure,
      get shardCount() { return shardCount; },
      // Total shards in the whole level (campaign levels are generated up front).
      totalShards() { ensure(finishRow + 20); return shardCount; },
      shardsBetween(a, b) { let n = 0; for (let r = a; r < b; r++) n += (shardsAt.get(r) || []).length; return n; },
    };
  }

  // ---------- Campaign and endless setups ----------
  function campaignLevel(w, l) {
    const cp = campaignParams(w, l);
    const world = WORLDS[w];
    // The first level of a world shows off only its signature tiles; the rest unlock the full set.
    const feats = l === 0 ? world.features.slice(0, Math.min(4, world.features.length)) : world.features;
    const level = createLevel({
      seed: 7919 * (w + 1) + 104729 * (l + 1),
      length: cp.length,
      checkpoints: true,
      at: () => {
        const gapMax = Math.max(3, Math.min(Math.round(3 + 3 * cp.d), Math.floor(cp.speed * 0.42)));
        return { d: cp.d, speed: cp.speed, features: feats, density: 0.9 - 0.4 * cp.d, gapMax, gapChance: 0.2 + 0.3 * cp.d, world: w };
      },
    });
    return { level, speed: cp.speed, world: w, name: levelName(w, l), length: cp.length };
  }

  function endlessLevel(seed) {
    const level = createLevel({
      seed,
      length: Infinity,
      checkpoints: false,
      at: row => {
        const d = Math.min(1, row / 5200);
        const speed = 11 + 6 * d + Math.min(1, row / 12000);
        const world = Math.floor(row / 900) % WORLDS.length;
        const feats = row < 500 ? WORLDS[0].features : row < 1500 ? WORLDS[2].features : WORLDS[5].features;
        const gapMax = Math.max(3, Math.min(Math.round(3 + 3 * d), Math.floor(speed * 0.42)));
        return { d, speed, features: feats, density: 0.9 - 0.42 * d, gapMax, gapChance: 0.2 + 0.3 * d, world };
      },
    });
    return { level, speed: 11, world: 0, name: 'Endless' };
  }
  const endlessSpeedAt = row => 11 + 6 * Math.min(1, row / 5200) + Math.min(1, row / 12000);
  const endlessWorldAt = row => Math.floor(row / 900) % WORLDS.length;

  return { RING, T, WORLDS, RUNNERS, rng, wrap, campaignLevel, endlessLevel, endlessSpeedAt, endlessWorldAt, campaignParams, levelName };
})();
