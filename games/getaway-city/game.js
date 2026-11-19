/* Getaway City: a top-down open-world city. Walk or take any car, run heists and escape the
   police, drive taxi fares and pizza runs, race checkpoints, hit stunt ramps and hunt hidden
   packages. Cash buys faster cars and perks. Progress saves; the score is lifetime earnings.
   Nobody gets hurt: there are no weapons, and pedestrians always dive out of the way. */
(() => {
  const ID = 'getaway-city';
  const W = 960, H = 540;
  const B = 360, R = 90, P = B + R, N = 16;          // block size, road width, pitch, blocks per side
  const WORLD = N * P + R;
  const MAX_STARS = 8;                               // the wanted scale runs all the way to eight
  const SAVE_KEY = 'getaway:save';
  const TAU = Math.PI * 2;
  const LANE = 23;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const { shade } = Gfx;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const money = n => '$' + Math.floor(n).toLocaleString();
  const roadC = i => i * P + R / 2;                  // centre line of road i
  const blockX = b => b * P + R;                      // left (or top) edge of block b

  // ---------- City layout (seeded, so it's the same city every visit) ----------

  const rng = Gfx.rng(20261118);
  const rr = (a, b) => a + rng() * (b - a);
  const blocks = [];      // [bx][by] -> { kind, buildings, trees }
  const CENTER = (N - 1) / 2;

  // Landmarks by block: each has a marker on the sidewalk on the block's south edge.
  const LANDMARKS = {
    '4,11': { kind: 'hideout', name: 'Hideout', color: '#7c4dff', icon: '🏠' },
    '11,2': { kind: 'police', name: 'Police HQ', color: '#1e88e5', icon: '🚓' },
    '12,11': { kind: 'paint', name: 'Spray Shop', color: '#26c6da', icon: '🎨' },
    '2,4': { kind: 'paint', name: 'Spray Shop', color: '#26c6da', icon: '🎨' },
    '9,12': { kind: 'dealer', name: 'Car Dealer', color: '#ffb300', icon: '🚗' },
    '5,2': { kind: 'pizza', name: 'Pizza Pronto', color: '#ff7043', icon: '🍕' },
    '7,11': { kind: 'taxi', name: 'Taxi Stand', color: '#fdd835', icon: '🚕' },
    '1,7': { kind: 'race', name: 'Street Race', color: '#eeeeee', icon: '🏁' },
    '11,7': { kind: 'heist', heist: 0, name: 'Corner Store', color: '#ef5350', icon: '💼' },
    '9,9': { kind: 'heist', heist: 1, name: 'Jewel Box', color: '#ef5350', icon: '💎' },
    '13,4': { kind: 'heist', heist: 2, name: 'Gold Depot', color: '#ef5350', icon: '🥇' },
    '8,5': { kind: 'heist', heist: 3, name: 'City Bank', color: '#ef5350', icon: '🏦' },
    '13,12': { kind: 'heist', heist: 4, name: 'Golden Mile Casino', color: '#ef5350', icon: '🎰' },
    '1,1': { kind: 'heist', heist: 5, name: 'Airport Hangar', color: '#ef5350', icon: '✈️' },
  };
  const HEISTS = [
    { name: 'Corner Store Safe', reward: 900, stars: 2, crack: 3, need: 0 },
    { name: 'Jewel Box Display', reward: 2500, stars: 3, crack: 4, need: 1 },
    { name: 'Gold Depot', reward: 6000, stars: 4, crack: 5, need: 2 },
    { name: 'City Bank Vault', reward: 15000, stars: 5, crack: 7, need: 3 },
    { name: 'Casino High Roller Cage', reward: 30000, stars: 6, crack: 9, need: 4 },
    { name: 'Airport Bullion Run', reward: 50000, stars: 7, crack: 11, need: 5 },
  ];

  const PALETTES = {
    downtown: ['#5c7a99', '#6d8fb3', '#4f6d8a', '#7f97b0', '#5a6a7a', '#3f5f7f'],
    midtown: ['#b07a5a', '#c49a6c', '#9e8a7a', '#c1b59b', '#a1665e', '#8d9da6'],
    suburb: ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#f06292', '#4db6ac'],
    industrial: ['#90a4ae', '#a1887f', '#78909c', '#8d8f7a'],
  };

  function district(bx, by) {
    const d = Math.max(Math.abs(bx - CENTER), Math.abs(by - CENTER));
    if (bx >= 11 && by <= 3) return 'industrial';
    if (d <= 2) return 'downtown';
    if (d <= 4.5) return 'midtown';
    return 'suburb';
  }

  for (let bx = 0; bx < N; bx++) {
    blocks.push([]);
    for (let by = 0; by < N; by++) {
      const x1 = blockX(bx), y1 = blockX(by), x2 = x1 + B, y2 = y1 + B;
      const land = LANDMARKS[`${bx},${by}`];
      const dist4 = district(bx, by);
      let kind = 'city';
      if (!land && ((bx === 4 && by === 4) || rng() < 0.1)) kind = 'park';
      else if (!land && rng() < 0.08) kind = 'lot';
      const blk = { bx, by, x1, y1, x2, y2, kind, district: dist4, land, buildings: [], trees: [] };
      const IN = 26;
      if (kind === 'park') {
        for (let i = 0; i < 16; i++) {
          const x = rr(x1 + 40, x2 - 40), y = rr(y1 + 40, y2 - 40);
          if (Math.hypot(x - (x1 + x2) / 2, y - (y1 + y2) / 2) < 70) continue;
          blk.trees.push({ x, y, r: rr(14, 22) });
        }
        blk.pond = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, r: 50 };
      } else if (kind === 'lot') {
        blk.buildings.push(makeBuilding(x1 + IN, y1 + IN, x2 - IN, y1 + 120, 22, '#9e9e9e', 'shed'));
      } else if (land) {
        // Landmark: one big building at the back, open forecourt in front where the marker sits.
        const h = land.kind === 'police' ? 90 : land.kind === 'heist' && land.heist >= 3 ? 160 : 60;
        const col = { hideout: '#5e548e', police: '#37474f', paint: '#00838f', dealer: '#f9a825', pizza: '#d84315', taxi: '#f9a825', race: '#424242', heist: '#8e5a5a' }[land.kind];
        blk.buildings.push(makeBuilding(x1 + IN, y1 + IN, x2 - IN, y2 - 150, h, col, land.kind === 'heist' && land.heist >= 3 ? 'bank' : 'flat'));
        blk.forecourt = true;
      } else {
        // Split the block into 1-4 lots with a building each.
        const split = dist4 === 'suburb' ? 3 : dist4 === 'downtown' ? (rng() < 0.4 ? 1 : 2) : 2;
        const cells = [];
        if (split === 1) cells.push([x1 + IN, y1 + IN, x2 - IN, y2 - IN]);
        else {
          const sx = x1 + B / 2, sy = y1 + B / 2;
          if (split === 2) {
            if (rng() < 0.5) cells.push([x1 + IN, y1 + IN, sx - 12, y2 - IN], [sx + 12, y1 + IN, x2 - IN, y2 - IN]);
            else cells.push([x1 + IN, y1 + IN, x2 - IN, sy - 12], [x1 + IN, sy + 12, x2 - IN, y2 - IN]);
          } else {
            for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
              cells.push([a ? sx + 14 : x1 + IN + 10, b ? sy + 14 : y1 + IN + 10, a ? x2 - IN - 10 : sx - 14, b ? y2 - IN - 10 : sy - 14]);
            }
          }
        }
        for (const [a, b, c, d] of cells) {
          const pal = PALETTES[dist4];
          const col = pal[Math.floor(rng() * pal.length)];
          let h, style;
          if (dist4 === 'downtown') { h = rr(140, 260); style = rng() < 0.3 ? 'helipad' : 'tower'; }
          else if (dist4 === 'midtown') { h = rr(60, 140); style = rng() < 0.5 ? 'garden' : 'flat'; }
          else if (dist4 === 'industrial') { h = rr(40, 70); style = 'warehouse'; }
          else { h = rr(26, 44); style = 'house'; }
          // Suburb houses are smaller than their lots, with a yard around them.
          const shrink = style === 'house' ? 22 : 0;
          blk.buildings.push(makeBuilding(a + shrink, b + shrink, c - shrink, d - shrink, h, col, style));
          if (style === 'house') blk.trees.push({ x: c - 10, y: d - 10, r: 12 });
        }
      }
      blocks[bx].push(blk);
    }
  }

  function makeBuilding(x1, y1, x2, y2, h, color, style) {
    return { x1, y1, x2, y2, h, color, style, roof: null };
  }

  // Roof art, drawn once per building into its own small canvas.
  function roofSprite(b) {
    const w = Math.max(8, Math.round(b.x2 - b.x1)), h = Math.max(8, Math.round(b.y2 - b.y1));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const r = Gfx.rng(Math.round(b.x1 * 7 + b.y1 * 13));
    const top = shade(b.color, b.style === 'house' ? -0.05 : 0.1);
    g.fillStyle = top;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = shade(b.color, -0.25);
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
    if (b.style === 'house') {
      // Gable roof: two slopes and a ridge.
      g.fillStyle = shade(b.color, -0.15);
      g.fillRect(0, h / 2, w, h / 2);
      g.fillStyle = shade(b.color, 0.25);
      g.fillRect(0, h / 2 - 2, w, 4);
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 1;
      for (let y = 4; y < h; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = '#8d6e63';
      g.fillRect(w * 0.7, h * 0.15, 8, 8);
    } else if (b.style === 'warehouse' || b.style === 'shed') {
      g.strokeStyle = 'rgba(0,0,0,0.15)';
      g.lineWidth = 2;
      for (let x = 6; x < w; x += 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let k = 0; k < 3; k++) g.fillRect(w * (0.2 + k * 0.25), h * 0.3, 10, h * 0.4);
    } else {
      // Flat roofs: vents, AC units, a water tank, maybe a garden or a helipad.
      for (let k = 0; k < 3 + r() * 4; k++) {
        const ux = 8 + r() * (w - 30), uy = 8 + r() * (h - 30), us = 8 + r() * 12;
        g.fillStyle = 'rgba(0,0,0,0.2)';
        g.fillRect(ux + 3, uy + 3, us, us);
        g.fillStyle = shade(b.color, 0.35);
        g.fillRect(ux, uy, us, us);
        g.fillStyle = shade(b.color, -0.1);
        g.beginPath(); g.arc(ux + us / 2, uy + us / 2, us * 0.3, 0, TAU); g.fill();
      }
      if (b.style === 'garden') {
        g.fillStyle = '#66bb6a';
        g.fillRect(w * 0.15, h * 0.55, w * 0.5, h * 0.3);
        g.fillStyle = '#43a047';
        for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(w * 0.2 + r() * w * 0.4, h * 0.6 + r() * h * 0.2, 5, 0, TAU); g.fill(); }
      }
      if (b.style === 'helipad') {
        const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.28;
        g.fillStyle = '#455a64';
        g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.fill();
        g.strokeStyle = '#ffeb3b';
        g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, rad - 4, 0, TAU); g.stroke();
        g.fillStyle = '#fff';
        g.font = `900 ${Math.round(rad)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('H', cx, cy + 1);
      }
      if (b.style === 'bank') {
        g.fillStyle = '#ffd54f';
        g.font = '900 28px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('$', w / 2, h / 2);
      }
    }
    return c;
  }

  const blockAt = (x, y) => {
    const bx = Math.floor((x - R) / P), by = Math.floor((y - R) / P);
    return bx >= 0 && by >= 0 && bx < N && by < N ? blocks[bx][by] : null;
  };
  function nearbyBlocks(x, y, fn) {
    const bx = Math.floor((x - R) / P), by = Math.floor((y - R) / P);
    for (let i = bx - 1; i <= bx + 1; i++) for (let j = by - 1; j <= by + 1; j++) if (i >= 0 && j >= 0 && i < N && j < N) fn(blocks[i][j]);
  }
  const allBlocks = blocks.flat();

  // Markers, hidden packages and stunt ramps.
  const markers = [];
  for (const blk of allBlocks) {
    if (!blk.land) continue;
    markers.push({ ...blk.land, x: (blk.x1 + blk.x2) / 2, y: blk.y2 - 60, blk });
  }
  const markerOf = kind => markers.find(m => m.kind === kind);
  const hideout = markerOf('hideout'), policeHQ = markerOf('police');

  const inBuilding = (x, y, pad = 0) => {
    const blk = blockAt(x, y);
    return !!blk && (blk.buildings.some(b => x > b.x1 - pad && x < b.x2 + pad && y > b.y1 - pad && y < b.y2 + pad) || blk.trees.some(t => Math.hypot(t.x - x, t.y - y) < t.r + pad) || (blk.pond && Math.hypot(blk.pond.x - x, blk.pond.y - y) < blk.pond.r + pad));
  };
  const packages = [];
  for (let tries = 0; packages.length < 120 && tries < 9000; tries++) {
    const blk = allBlocks[Math.floor(rng() * allBlocks.length)];
    const x = rr(blk.x1 + 12, blk.x2 - 12), y = rr(blk.y1 + 12, blk.y2 - 12);
    if (inBuilding(x, y, 16) || packages.some(p => Math.hypot(p.x - x, p.y - y) < 300) || markers.some(m => Math.hypot(m.x - x, m.y - y) < 80)) continue;
    packages.push({ id: packages.length, x, y });
  }
  const ramps = [];
  for (let tries = 0; ramps.length < 30 && tries < 2000; tries++) {
    const horiz = rng() < 0.5, i = Math.floor(rng() * (N + 1)), seg = Math.floor(rng() * N);
    const along = seg * P + R + B / 2 + rr(-80, 80);
    const x = horiz ? along : roadC(i), y = horiz ? roadC(i) : along;
    if (ramps.some(r => Math.hypot(r.x - x, r.y - y) < 480)) continue;
    const dir = horiz ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    ramps.push({ id: ramps.length, x, y, a: dir });
  }

  // Race route: a loop through these intersections.
  const RACE = [[1, 11], [1, 4], [4, 4], [4, 1], [9, 1], [9, 4], [13, 4], [13, 9], [13, 14], [9, 14], [9, 11], [5, 11], [5, 14], [1, 14]].map(([i, j]) => ({ x: roadC(i), y: roadC(j) }));
  const raceLen = RACE.reduce((t, p, k) => t + dist(p, RACE[(k + 1) % RACE.length]), 0);
  const RACE_MEDALS = [raceLen / 360, raceLen / 300, raceLen / 240];      // gold, silver, bronze seconds

  // ---------- Cars ----------

  //   accel px/s², max px/s, grip (sideways friction), turn rad/s, hp, mass, size
  const CARS = {
    compact: { name: 'Pip Compact', price: 0, accel: 300, max: 330, grip: 8, turn: 2.8, hp: 100, mass: 1, len: 38, wid: 20, colors: ['#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa', '#fb8c00'] },
    sedan: { name: 'Cruiser Sedan', price: 1500, accel: 330, max: 370, grip: 7.5, turn: 2.6, hp: 120, mass: 1.2, len: 44, wid: 22, colors: ['#546e7a', '#37474f', '#eeeeee', '#6d4c41', '#1565c0'] },
    van: { name: 'Box Van', price: 2500, accel: 220, max: 300, grip: 7, turn: 2.2, hp: 200, mass: 2, len: 52, wid: 25, colors: ['#eceff1', '#90a4ae', '#a1887f'] },
    taxi: { name: 'Cab', price: 0, accel: 320, max: 360, grip: 7.5, turn: 2.6, hp: 120, mass: 1.2, len: 44, wid: 22, colors: ['#fdd835'], hidden: true },
    muscle: { name: 'Thunder Muscle', price: 4000, accel: 470, max: 440, grip: 5.5, turn: 2.6, hp: 140, mass: 1.4, len: 46, wid: 23, colors: ['#d32f2f', '#212121', '#ff6f00'] },
    sports: { name: 'Vento Sport', price: 9000, accel: 520, max: 500, grip: 8.5, turn: 3, hp: 110, mass: 1.1, len: 44, wid: 22, colors: ['#ffeb3b', '#00e5ff', '#ff4081'] },
    beast: { name: 'Bulldog 4x4', price: 15000, accel: 420, max: 420, grip: 9, turn: 2.4, hp: 320, mass: 2.6, len: 50, wid: 28, colors: ['#33691e', '#4e342e', '#263238'] },
    super: { name: 'Zenith Hyper', price: 30000, accel: 680, max: 590, grip: 9, turn: 3.1, hp: 120, mass: 1.1, len: 46, wid: 23, colors: ['#76ff03', '#ffffff', '#ff1744', '#651fff'] },
    police: { name: 'Interceptor', price: 0, accel: 480, max: 460, grip: 8.5, turn: 2.9, hp: 180, mass: 1.5, len: 46, wid: 23, colors: ['#eceff1'], hidden: true },
    riot: { name: 'Riot Van', price: 0, accel: 380, max: 410, grip: 8, turn: 2.2, hp: 400, mass: 2.8, len: 52, wid: 26, colors: ['#263238'], hidden: true },
  };
  const TRAFFIC = ['compact', 'compact', 'sedan', 'sedan', 'van', 'taxi', 'muscle', 'sports'];

  const spriteCache = new Map();
  function carSprite(type, color) {
    const key = type + color;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const T = CARS[type], L = T.len, Wd = T.wid;
    const sp = Gfx.sprite(L + 8, Wd + 8, (L + 8) / 2, (Wd + 8) / 2, c => {
      c.translate(4, 4);
      // Body (the car points right, +x).
      c.fillStyle = shade(color, -0.35);
      Gfx.roundRect(c, 0, 0, L, Wd, 6); c.fill();
      const bg = c.createLinearGradient(0, 0, 0, Wd);
      bg.addColorStop(0, shade(color, 0.25)); bg.addColorStop(0.5, color); bg.addColorStop(1, shade(color, -0.2));
      c.fillStyle = bg;
      Gfx.roundRect(c, 1, 1, L - 2, Wd - 2, 5); c.fill();
      // Cabin and glass.
      const cabX = type === 'van' ? L * 0.55 : L * 0.3, cabW = type === 'van' ? L * 0.3 : L * 0.42;
      c.fillStyle = '#263238';
      Gfx.roundRect(c, cabX, 3, cabW, Wd - 6, 4); c.fill();
      c.fillStyle = '#80cbc4';
      c.globalAlpha = 0.85;
      Gfx.roundRect(c, cabX + cabW - 7, 4, 6, Wd - 8, 2); c.fill();
      c.globalAlpha = 0.5;
      Gfx.roundRect(c, cabX + 1, 4, 4, Wd - 8, 2); c.fill();
      c.globalAlpha = 1;
      c.fillStyle = shade(color, 0.05);
      Gfx.roundRect(c, cabX + 6, 4, cabW - 14, Wd - 8, 3); c.fill();
      // Lights.
      c.fillStyle = '#fff59d';
      c.fillRect(L - 3, 2, 3, 5); c.fillRect(L - 3, Wd - 7, 3, 5);
      c.fillStyle = '#e53935';
      c.fillRect(0, 2, 2, 5); c.fillRect(0, Wd - 7, 2, 5);
      if (type === 'taxi') {
        c.fillStyle = '#212121';
        c.fillRect(cabX + cabW / 2 - 4, Wd / 2 - 4, 8, 8);
        c.fillStyle = '#212121';
        for (let k = 0; k < 4; k++) c.fillRect(4 + k * 8, Wd / 2 - 1, 4, 2);
      }
      if (type === 'police') {
        c.fillStyle = '#263238';
        c.fillRect(2, 1, cabX - 4, Wd - 2);
        c.fillRect(cabX + cabW + 1, 1, L - cabX - cabW - 4, Wd - 2);
        c.fillStyle = '#eceff1';
        c.fillRect(cabX + cabW / 2 - 3, 2, 6, Wd - 4);
      }
      if (type === 'riot') {
        c.fillStyle = '#eceff1';
        c.fillRect(3, 3, L - 6, 4);
        c.fillRect(3, Wd - 7, L - 6, 4);
        c.fillStyle = '#ffca28';
        for (let k = 0; k < 4; k++) c.fillRect(cabX + cabW + 3 + k * 5, Wd / 2 - 2, 3, 4);
      }
      if (type === 'muscle' || type === 'super') {
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.fillRect(2, Wd / 2 - 3, cabX - 2, 2); c.fillRect(2, Wd / 2 + 1, cabX - 2, 2);
        c.fillRect(cabX + cabW, Wd / 2 - 3, L - cabX - cabW - 2, 2); c.fillRect(cabX + cabW, Wd / 2 + 1, L - cabX - cabW - 2, 2);
      }
      if (type === 'beast') {
        c.fillStyle = '#212121';
        for (const [x, y] of [[6, -2], [L - 14, -2], [6, Wd - 2], [L - 14, Wd - 2]]) c.fillRect(x, y, 9, 4);
      }
    });
    spriteCache.set(key, sp);
    return sp;
  }

  const cars = [];
  function makeCar(type, x, y, a, role, color) {
    const T = CARS[type];
    const car = {
      type, T, x, y, a, vx: 0, vy: 0, z: 0, vz: 0, role, color: color || T.colors[Math.floor(Math.random() * T.colors.length)],
      hp: T.hp, broken: false, smokeT: 0, stuck: 0, ai: null, siren: 0, honk: 0, flash: 0,
    };
    cars.push(car);
    return car;
  }
  const speedOf = c => Math.hypot(c.vx, c.vy);
  const fwdSpeed = c => c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);

  // ---------- Save ----------

  let s;
  function fresh() {
    return { cash: 200, lifetime: 0, owned: ['compact'], perks: { engine: 0, armor: 0, nitro: 0, scanner: 0 }, heists: 0, heistDone: [0, 0, 0, 0, 0, 0],
      fares: 0, bestFares: 0, deliveries: 0, raceBest: 0, medal: 0, pkgs: [], stunts: [], intro: false, maxStars: 0, map: N };
  }
  function loadSave() {
    const raw = Arcade.load(SAVE_KEY, null);
    // The city grew: packages and ramps moved, so an old save starts those collections again.
    if (raw && raw.map !== N) { raw.pkgs = []; raw.stunts = []; }
    s = raw ? { ...fresh(), ...raw, perks: { ...fresh().perks, ...(raw.perks || {}) } } : fresh();
  }
  const score = () => Math.floor(s.lifetime);
  function persist() {
    Arcade.submitScore(ID, score());
    Arcade.dailyScore?.(score());
    Arcade.save(SAVE_KEY, s);
  }
  function earn(n, x, y, label) {
    n = Math.round(n);
    s.cash += n;
    s.lifetime += n;
    if (x !== undefined) pops.add(`${label ? label + ' ' : ''}+${money(n)}`, x, y, { color: '#9be37a', size: 20, life: 1.4, rise: 50 });
    sfx.cash();
  }

  const PERKS = [
    { id: 'engine', icon: '⚙️', name: 'Engine tune', desc: lv => `+${lv * 8}% top speed and acceleration in any car`, costs: [2000, 6000, 15000] },
    { id: 'armor', icon: '🛡️', name: 'Armor plating', desc: lv => `Cars you drive take ${lv * 20}% less damage`, costs: [1500, 5000, 12000] },
    { id: 'nitro', icon: '🔥', name: 'Nitro', desc: lv => (lv ? `Hold Shift to boost · ${2 + lv} s tank` : 'Hold Shift to boost'), costs: [4000, 8000, 16000] },
    { id: 'scanner', icon: '📻', name: 'Police scanner', desc: lv => (lv ? `Wanted stars fade ${lv * 30}% faster` : 'Wanted stars fade faster'), costs: [3000, 9000] },
  ];

  // ---------- Effects and sound ----------

  const fx = Gfx.particles(900);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();
  let audio = null, engineOsc, engineGain, sirenOsc, sirenGain;
  function ensureAudio() {
    if (audio) return;
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      engineOsc = audio.createOscillator(); engineOsc.type = 'sawtooth';
      const lp = audio.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      engineGain = audio.createGain(); engineGain.gain.value = 0;
      engineOsc.connect(lp); lp.connect(engineGain); engineGain.connect(audio.destination); engineOsc.start();
      sirenOsc = audio.createOscillator(); sirenOsc.type = 'square';
      sirenGain = audio.createGain(); sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain); sirenGain.connect(audio.destination); sirenOsc.start();
    } catch { audio = null; }
  }
  addEventListener('pointerdown', ensureAudio);
  addEventListener('keydown', ensureAudio);
  const sfx = {
    cash: () => Arcade.tone({ freq: 880, to: 1320, dur: 0.12, type: 'triangle', vol: 0.05 }),
    crash: v => Arcade.tone({ freq: 120, to: 50, dur: 0.18, type: 'square', vol: Math.min(0.06, 0.015 + v / 8000) }),
    door: () => Arcade.tone({ freq: 300, to: 220, dur: 0.08, type: 'square', vol: 0.03 }),
    star: () => Arcade.tone({ freq: 500, to: 900, dur: 0.2, type: 'sawtooth', vol: 0.04 }),
    good: () => [523, 659, 784, 1047].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.15, type: 'triangle', vol: 0.05, delay: i * 0.08 })),
    bad: () => Arcade.tone({ freq: 400, to: 120, dur: 0.5, type: 'sawtooth', vol: 0.05 }),
    horn: () => Arcade.tone({ freq: 392, dur: 0.15, type: 'square', vol: 0.03 }),
    pickup: () => Arcade.tone({ freq: 700, to: 1400, dur: 0.15, type: 'sine', vol: 0.05 }),
  };

  // ---------- Player ----------

  const player = { x: 0, y: 0, a: -Math.PI / 2, vx: 0, vy: 0, car: null, walk: 0, nitro: 0 };
  let stars = 0, heat = 0, evadeT = 0, seen = false, bustT = 0, heli = null, mission = null, banner = null;
  let time = 0, dayT = 0.3, mapOpen = false, inMarker = null, lastRamp = -1;

  const engineMul = () => 1 + s.perks.engine * 0.08;
  const nitroCap = () => (s.perks.nitro ? 2 + s.perks.nitro : 0);

  function say(text, sub = '', t = 2.6, color = '#ffffff') { banner = { text, sub, t, color }; }

  function addStars(n, reason) {
    const before = stars;
    stars = clamp(Math.max(stars, n), 0, MAX_STARS);
    evadeT = 0;
    if (stars > before) {
      sfx.star();
      if (reason) pops.add(reason, player.x, player.y - 50, { color: '#ff5252', size: 18, life: 1.2 });
    }
    if (stars > s.maxStars) s.maxStars = stars;
    if (stars >= 5) Arcade.flag('getaway-five-stars');
    if (stars >= MAX_STARS) Arcade.flag('getaway-eight-stars');
  }
  function bumpStars(reason) { addStars(Math.min(MAX_STARS, stars + 1), reason); }
  function clearStars(msg) {
    if (stars >= 4 && msg) Arcade.flag('getaway-escape');
    stars = 0;
    evadeT = 0;
    bustT = 0;
    heli = null;
    for (const c of cars) if (c.role === 'cop') c.role = 'leaving';
    if (msg) say(msg, '', 2, '#80deea');
  }

  function spawnAtHideout() {
    player.x = hideout.x;
    player.y = hideout.y + 48;
    player.car = null;
  }

  // ---------- Traffic, cops and pedestrians ----------

  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];      // E S W N
  const laneOff = d => { const [dx, dy] = DIRS[d]; return { x: -dy * LANE, y: dx * LANE }; };
  const iPos = (i, j) => ({ x: roadC(i), y: roadC(j) });

  function aiApproach(car) {
    const { i, j, d } = car.ai;
    const c = iPos(i, j), [dx, dy] = DIRS[d], o = laneOff(d);
    return { x: c.x - dx * (R / 2 + 12) + o.x, y: c.y - dy * (R / 2 + 12) + o.y };
  }
  function aiExit(car) {
    const { i, j, nd } = car.ai;
    const c = iPos(i, j), [dx, dy] = DIRS[nd], o = laneOff(nd);
    return { x: c.x + dx * (R / 2 + 12) + o.x, y: c.y + dy * (R / 2 + 12) + o.y };
  }

  function spawnTraffic() {
    for (let tries = 0; tries < 10; tries++) {
      const d = Math.floor(Math.random() * 4), [dx, dy] = DIRS[d];
      const i = Arcade.randInt(0, N), j = Arcade.randInt(0, N);
      const pi = i - dx, pj = j - dy;
      if (pi < 0 || pj < 0 || pi > N || pj > N) continue;
      const a = iPos(pi, pj), b = iPos(i, j), f = Arcade.rand(0.25, 0.75), o = laneOff(d);
      const x = a.x + (b.x - a.x) * f + o.x, y = a.y + (b.y - a.y) * f + o.y;
      const dp = Math.hypot(x - camX(), y - camY());
      if (dp < 640 || dp > 1300) continue;
      if (cars.some(c => Math.hypot(c.x - x, c.y - y) < 70)) continue;
      const car = makeCar(Arcade.pick(TRAFFIC), x, y, Math.atan2(dy, dx), 'traffic');
      car.ai = { i, j, d, nd: d, phase: 'go', speed: Arcade.rand(150, 200), wait: 0, stuck: 0 };
      const sp = car.ai.speed * 0.8;
      car.vx = dx * sp; car.vy = dy * sp;
      return;
    }
  }

  function spawnCop() {
    const near = stars >= 6 ? 520 : 650;
    const type = stars >= 6 && Math.random() < Math.min(0.45, (stars - 5) * 0.15) ? 'riot' : 'police';
    for (let tries = 0; tries < 24; tries++) {
      const i = Arcade.randInt(0, N), j = Arcade.randInt(0, N);
      const p = iPos(i, j), d = Math.hypot(p.x - player.x, p.y - player.y);
      if (d < near || d > 1300) continue;
      const car = makeCar(type, p.x, p.y, Math.atan2(player.y - p.y, player.x - p.x), 'cop');
      car.nav = null;
      return;
    }
  }

  const peds = [];
  const PED_COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', '#4db6ac', '#ff8a65', '#f06292', '#a1887f', '#90a4ae'];
  function spawnPed() {
    for (let tries = 0; tries < 10; tries++) {
      const blk = blockAt(player.x + Arcade.rand(-900, 900), player.y + Arcade.rand(-700, 700));
      if (!blk) continue;
      const ring = 9, side = Arcade.randInt(0, 3), f = Math.random();
      const x1 = blk.x1 + ring, y1 = blk.y1 + ring, x2 = blk.x2 - ring, y2 = blk.y2 - ring;
      const pts = [[x1 + (x2 - x1) * f, y1], [x2, y1 + (y2 - y1) * f], [x2 - (x2 - x1) * f, y2], [x1, y2 - (y2 - y1) * f]];
      const [x, y] = pts[side];
      const dp = Math.hypot(x - camX(), y - camY());
      if (dp < 560 || dp > 1100) continue;
      peds.push({ x, y, blk, dir: Math.random() < 0.5 ? 1 : -1, speed: Arcade.rand(35, 55), color: Arcade.pick(PED_COLORS), skin: Arcade.pick(['#ffe0bd', '#f1c27d', '#c68642', '#8d5524']), dive: 0, dvx: 0, dvy: 0, flee: 0, step: Math.random() * 10 });
      return;
    }
  }
  function pedTarget(p) {
    // Walk the sidewalk loop around the block, clockwise or not.
    const ring = 9, b = p.blk;
    const x1 = b.x1 + ring, y1 = b.y1 + ring, x2 = b.x2 - ring, y2 = b.y2 - ring;
    const corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    let best = 0, bd = Infinity;
    corners.forEach(([cx, cy], k) => {
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < bd) { bd = d; best = k; }
    });
    const k = bd < 6 ? (best + p.dir + 4) % 4 : best;
    // Head for the next corner along the edge we're on.
    const onTop = Math.abs(p.y - y1) < 3, onBot = Math.abs(p.y - y2) < 3, onL = Math.abs(p.x - x1) < 3, onR = Math.abs(p.x - x2) < 3;
    if (bd >= 6) {
      if (onTop) return p.dir > 0 ? corners[1] : corners[0];
      if (onR) return p.dir > 0 ? corners[2] : corners[1];
      if (onBot) return p.dir > 0 ? corners[3] : corners[2];
      if (onL) return p.dir > 0 ? corners[0] : corners[3];
    }
    return corners[k];
  }

  // ---------- Collisions ----------

  function circleRect(o, cx, cy, r, b) {
    const nx = clamp(cx, b.x1, b.x2), ny = clamp(cy, b.y1, b.y2);
    let dx = cx - nx, dy = cy - ny, d = Math.hypot(dx, dy);
    if (d >= r) return null;
    if (d === 0) {
      const opts = [[cx - b.x1, -1, 0], [b.x2 - cx, 1, 0], [cy - b.y1, 0, -1], [b.y2 - cy, 0, 1]].sort((p, q) => p[0] - q[0]);
      return { nx: opts[0][1], ny: opts[0][2], pen: opts[0][0] + r };
    }
    return { nx: dx / d, ny: dy / d, pen: r - d };
  }
  // Pushes a body (car or walker) out of buildings, trees, ponds and the world edge. Returns the
  // hardest impact speed, for damage.
  function collideWorld(o, pts, r) {
    let impact = 0;
    const hit = (nx, ny, pen) => {
      o.x += nx * pen; o.y += ny * pen;
      const vn = o.vx * nx + o.vy * ny;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        o.vx -= 1.3 * vn * nx; o.vy -= 1.3 * vn * ny;
      }
    };
    for (const [px, py] of pts(o)) {
      nearbyBlocks(px, py, blk => {
        for (const b of blk.buildings) { const h = circleRect(o, px, py, r, b); if (h) hit(h.nx, h.ny, h.pen); }
        for (const t of blk.trees) {
          const dx = px - t.x, dy = py - t.y, d = Math.hypot(dx, dy), min = r + t.r * 0.55;
          if (d < min && d > 0) hit(dx / d, dy / d, min - d);
        }
        if (blk.pond) {
          const p = blk.pond, dx = px - p.x, dy = py - p.y, d = Math.hypot(dx, dy), min = r + p.r;
          if (d < min && d > 0) hit(dx / d, dy / d, min - d);
        }
      });
      if (px < r) hit(1, 0, r - px);
      if (py < r) hit(0, 1, r - py);
      if (px > WORLD - r) hit(-1, 0, px - (WORLD - r));
      if (py > WORLD - r) hit(0, -1, py - (WORLD - r));
    }
    return impact;
  }
  const carPts = c => {
    const k = c.T.len * 0.28, cx = Math.cos(c.a) * k, cy = Math.sin(c.a) * k;
    return [[c.x + cx, c.y + cy], [c.x - cx, c.y - cy]];
  };

  function damage(car, amount) {
    if (car.broken || amount <= 0) return;
    if (car === player.car) amount *= 1 - s.perks.armor * 0.2;
    car.hp -= amount;
    if (car.hp <= 0) {
      car.hp = 0;
      car.broken = true;
      for (let i = 0; i < 26; i++) fx.emit({ x: car.x, y: car.y, vx: Gfx.rand(-160, 160), vy: Gfx.rand(-160, 160), drag: 2, life: Gfx.rand(0.5, 1), size: Gfx.rand(3, 6), color: Gfx.rand() < 0.5 ? '#ff9800' : '#616161', shape: 'square', spin: 5 });
      shake.add(0.5);
      sfx.crash(400);
      if (car === player.car) {
        exitCar(true);
        say('Your car broke down!', 'Find another one', 2.4, '#ff8a65');
      }
      if (car.role === 'cop') car.role = 'wreck';
    }
  }

  function carVsCar(a, b) {
    if (a.z > 4 || b.z > 4) return;
    const ra = a.T.wid * 0.62, rb = b.T.wid * 0.62;
    for (const [ax, ay] of carPts(a)) for (const [bx, by] of carPts(b)) {
      const dx = ax - bx, dy = ay - by, d = Math.hypot(dx, dy), min = ra + rb;
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d, pen = min - d;
      const ma = a.T.mass, mb = b.T.mass, tot = ma + mb;
      a.x += nx * pen * mb / tot; a.y += ny * pen * mb / tot;
      b.x -= nx * pen * ma / tot; b.y -= ny * pen * ma / tot;
      const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rv < 0) {
        const j = -(1.4) * rv / tot;
        a.vx += j * mb * nx; a.vy += j * mb * ny;
        b.vx -= j * ma * nx; b.vy -= j * ma * ny;
        const impact = -rv;
        if (impact > 90) {
          damage(a, (impact - 90) * 0.1 * mb / tot * 2);
          damage(b, (impact - 90) * 0.1 * ma / tot * 2);
          if (impact > 160) {
            shake.add(Math.min(0.4, impact / 1200));
            sfx.crash(impact);
            for (let k = 0; k < 6; k++) fx.emit({ x: (ax + bx) / 2, y: (ay + by) / 2, vx: Gfx.rand(-150, 150), vy: Gfx.rand(-150, 150), drag: 3, life: 0.35, size: 2, color: '#ffe082', shape: 'spark' });
          }
          // Ramming a police car, or ramming traffic in front of one, raises your wanted level.
          const pc = player.car;
          if (pc && (a === pc || b === pc)) {
            const other = a === pc ? b : a;
            if (other.role === 'cop' && stars < 1) bumpStars('Rammed a cop!');
            else if (other.role === 'traffic' && copSees(900) && impact > 200 && stars < 2) bumpStars('Reckless driving!');
            if (other.role === 'cop') evadeT = 0;
          }
        }
      }
    }
  }

  // Line of sight across the city: blocked by any building on the way.
  function clearLine(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 40);
    for (let k = 1; k < n; k++) {
      const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
      const blk = blockAt(x, y);
      if (blk && blk.buildings.some(b => x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2)) return false;
    }
    return true;
  }
  function copSees(range) {
    return cars.some(c => c.role === 'cop' && !c.broken && Math.hypot(c.x - player.x, c.y - player.y) < range && clearLine(c.x, c.y, player.x, player.y));
  }

  // ---------- Driving ----------

  function drive(car, throttle, steer, brake, nitro, dt) {
    const T = car.T, mul = car === player.car ? engineMul() : car.role === 'cop' ? 1 + stars * 0.04 : 1;
    const nitroOn = nitro && car === player.car && player.nitro > 0 && throttle > 0;
    const max = T.max * mul * (nitroOn ? 1.35 : 1), accel = T.accel * mul * (nitroOn ? 1.9 : 1);
    const fx_ = Math.cos(car.a), fy = Math.sin(car.a), rx = -fy, ry = fx_;
    let vF = car.vx * fx_ + car.vy * fy, vR = car.vx * rx + car.vy * ry;
    if (car.z > 0) {
      // Airborne: keep flying.
    } else {
      if (car.broken) throttle = 0;
      if (throttle > 0) vF += (vF < max ? accel : -accel * 0.5) * throttle * dt;
      else if (throttle < 0) vF += (vF > 0 ? -T.accel * 2.2 : vF > -max * 0.4 ? -accel * 0.6 : 0) * -throttle * dt * (vF > 0 ? 1 : 1);
      else vF *= Math.exp(-0.9 * dt);
      vF *= Math.exp(-0.15 * dt);
      const grip = T.grip * (brake ? 0.18 : 1);
      vR *= Math.exp(-grip * dt);
      if (brake) vF *= Math.exp(-1.2 * dt);
      const turn = T.turn * (brake ? 1.35 : 1) * clamp(Math.abs(vF) / 110, 0, 1) * Math.sign(vF);
      car.a += steer * turn * dt;
      // Tyre smoke when sliding.
      if (Math.abs(vR) > 140 && Gfx.rand() < dt * 30) fx.emit({ x: car.x - fx_ * 14, y: car.y - fy * 14, vx: Gfx.rand(-20, 20), vy: Gfx.rand(-20, 20), life: 0.7, size: 4, grow: 10, color: 'rgba(220,220,220,0.35)' });
    }
    car.vx = fx_ * vF + rx * vR;
    car.vy = fy * vF + ry * vR;
    if (nitroOn) {
      player.nitro = Math.max(0, player.nitro - dt);
      if (Gfx.rand() < dt * 40) fx.emit({ x: car.x - fx_ * car.T.len * 0.55, y: car.y - fy * car.T.len * 0.55, vx: -fx_ * 200 + Gfx.rand(-30, 30), vy: -fy * 200 + Gfx.rand(-30, 30), life: 0.25, size: 4, color: Gfx.rand() < 0.5 ? '#40c4ff' : '#ffffff' });
    }
  }

  function moveCar(car, dt) {
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    if (car.z > 0 || car.vz > 0) {
      car.vz -= 900 * dt;
      car.z += car.vz * dt;
      if (car.z <= 0) {
        car.z = 0;
        if (car.vz < -200) { shake.add(0.25); sfx.crash(200); }
        car.vz = 0;
        if (car === player.car && car.stunt) landStunt(car);
      }
    }
    const impact = collideWorld(car, carPts, car.T.wid * 0.6);
    if (impact > 120) {
      damage(car, (impact - 120) * 0.12);
      if (car === player.car) { shake.add(Math.min(0.5, impact / 900)); sfx.crash(impact); }
    }
    if (car.broken) {
      car.smokeT -= dt;
      if (car.smokeT <= 0) {
        car.smokeT = 0.12;
        fx.emit({ x: car.x + Gfx.rand(-6, 6), y: car.y + Gfx.rand(-6, 6), vx: Gfx.rand(-10, 10), vy: Gfx.rand(-30, -10), life: 1.2, size: 5, grow: 12, color: 'rgba(60,60,60,0.45)' });
      }
    }
  }

  // Ramps launch you if you hit them fast and roughly straight.
  function checkRamps(car) {
    if (car.z > 0) return;
    for (const r of ramps) {
      const dx = car.x - r.x, dy = car.y - r.y;
      const along = dx * Math.cos(r.a) + dy * Math.sin(r.a), side = -dx * Math.sin(r.a) + dy * Math.cos(r.a);
      if (Math.abs(along) > 14 || Math.abs(side) > 30) continue;
      const v = car.vx * Math.cos(r.a) + car.vy * Math.sin(r.a);
      if (v < 220) continue;
      car.vz = v * 0.9;
      car.z = 1;
      if (car === player.car) {
        car.stunt = { id: r.id, start: time, x: car.x, y: car.y };
        Arcade.tone({ freq: 300, to: 700, dur: 0.3, type: 'triangle', vol: 0.05 });
      }
    }
  }
  function landStunt(car) {
    const st = car.stunt;
    car.stunt = null;
    const air = time - st.start, far = Math.hypot(car.x - st.x, car.y - st.y);
    const pay = Math.round(far * 1.2 + air * 300);
    earn(pay, car.x, car.y - 40, 'Stunt!');
    say(`STUNT JUMP · ${Math.round(far / 10)} m`, `${air.toFixed(1)} s of air`, 1.8, '#ffd54f');
    if (!s.stunts.includes(st.id)) {
      s.stunts.push(st.id);
      if (s.stunts.length >= 5) Arcade.flag('getaway-stunt');
    }
  }

  // ---------- Getting in and out ----------

  function enterNearest() {
    let best = null, bd = 46;
    for (const c of cars) {
      if (c.broken || c.role === 'wreck' || c.z > 0) continue;
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    if (best.role === 'cop') {
      if (stars < 3) bumpStars('Took a police car!');
    } else if (best.role === 'traffic' && copSees(700)) {
      bumpStars('Car theft!');
    }
    if (best.role === 'traffic') {
      // The driver hops out and runs off.
      const ped = { x: best.x + Math.cos(best.a + Math.PI / 2) * 22, y: best.y + Math.sin(best.a + Math.PI / 2) * 22, blk: blockAt(best.x + 60, best.y + 60) || allBlocks[0], dir: 1, speed: 70, color: Arcade.pick(PED_COLORS), skin: '#f1c27d', dive: 0, dvx: 0, dvy: 0, flee: 4, step: 0 };
      peds.push(ped);
      pops.add('Hey!', ped.x, ped.y - 20, { color: '#fff', size: 16 });
    }
    best.role = 'player';
    best.ai = null;
    player.car = best;
    sfx.door();
    player.nitro = nitroCap();
  }
  function exitCar(force) {
    const c = player.car;
    if (!c) return;
    if (!force && speedOf(c) > 60) return;
    player.car = null;
    c.role = c.broken ? 'wreck' : 'parked';
    const side = c.a + Math.PI / 2;
    player.x = c.x + Math.cos(side) * (c.T.wid / 2 + 12);
    player.y = c.y + Math.sin(side) * (c.T.wid / 2 + 12);
    player.vx = player.vy = 0;
    collideWorld(player, o => [[o.x, o.y]], 8);
    sfx.door();
    if (mission && mission.needsCar) failMission('You left the car');
  }

  // ---------- Missions ----------

  function randomSidewalk(minD, maxD, from = player) {
    for (let k = 0; k < 200; k++) {
      const blk = allBlocks[Math.floor(Math.random() * allBlocks.length)];
      const side = Arcade.randInt(0, 3), f = Arcade.rand(0.2, 0.8);
      const pts = [[blk.x1 + B * f, blk.y1 + 8], [blk.x2 - 8, blk.y1 + B * f], [blk.x1 + B * f, blk.y2 - 8], [blk.x1 + 8, blk.y1 + B * f]];
      const [x, y] = pts[side];
      const d = Math.hypot(x - from.x, y - from.y);
      if (d >= minD && d <= maxD && !inBuilding(x, y, 6)) return { x, y };
    }
    return { x: hideout.x, y: hideout.y };
  }

  function startMission(m) {
    if (m.kind === 'heist') {
      const h = HEISTS[m.heist];
      mission = { kind: 'heist', h, idx: m.heist, stage: 'crack', crack: 0, target: m, label: h.name };
      say(h.name, `Stay in the red circle to crack it (${h.crack} s)`, 2.6, '#ff8a80');
    } else if (m.kind === 'taxi') {
      mission = { kind: 'taxi', needsCar: true, fares: 0, earned: 0, label: 'Taxi shift' };
      nextFare();
    } else if (m.kind === 'pizza') {
      const drops = [];
      let from = m;
      for (let k = 0; k < 4; k++) { const p = randomSidewalk(350, 1000, from); drops.push(p); from = p; }
      mission = { kind: 'pizza', needsCar: true, drops, done: 0, timer: 100, label: 'Pizza run', earned: 0 };
      say('Pizza run!', '4 deliveries in 100 seconds', 2.4, '#ffab91');
    } else if (m.kind === 'race') {
      mission = { kind: 'race', needsCar: true, cp: 1, t: 0, label: 'Street race', countdown: 3 };
      say('Street race', `Gold ${RACE_MEDALS[0].toFixed(0)} s · Silver ${RACE_MEDALS[1].toFixed(0)} s · Bronze ${RACE_MEDALS[2].toFixed(0)} s`, 3, '#ffffff');
    }
  }
  function nextFare() {
    const pick = randomSidewalk(300, 900);
    mission.stage = 'pickup';
    mission.pick = pick;
    mission.timer = Math.hypot(pick.x - player.x, pick.y - player.y) / 160 + 14;
  }
  function failMission(why) {
    if (!mission) return;
    const m = mission;
    mission = null;
    if (m.kind === 'taxi' && m.fares > 0) {
      say(`Shift over: ${m.fares} fare${m.fares > 1 ? 's' : ''}`, `${money(m.earned)} earned · ${why}`, 3, '#fff59d');
      s.bestFares = Math.max(s.bestFares, m.fares);
    } else {
      say('Mission failed', why, 2.6, '#ff8a80');
      sfx.bad();
    }
    persist();
  }

  function updateMission(dt) {
    const m = mission;
    if (!m) return;
    const pc = player.car, here = pc || player, slow = !pc || speedOf(pc) < 70;
    if (m.needsCar && !pc) return failMission('You need a car');
    if (m.kind === 'heist') {
      if (m.stage === 'crack') {
        const d = Math.hypot(here.x - m.target.x, here.y - m.target.y);
        if (d < 46 && slow) {
          m.crack += dt;
          if (Gfx.rand() < dt * 10) Arcade.tone({ freq: 1200 + m.crack * 100, dur: 0.03, type: 'square', vol: 0.02 });
          if (m.crack >= m.h.crack) {
            m.stage = 'escape';
            addStars(m.h.stars);
            say('Got the loot!', 'Lose the cops or get it to the hideout', 2.6, '#ffd54f');
            sfx.good();
            for (let k = 0; k < m.h.stars * 2; k++) spawnCop();
          }
        } else m.crack = Math.max(0, m.crack - dt * 0.5);
      } else if (Math.hypot(here.x - hideout.x, here.y - hideout.y) < 50) {
        earn(m.h.reward, hideout.x, hideout.y - 50, m.h.name);
        s.heists++;
        s.heistDone[m.idx] = (s.heistDone[m.idx] || 0) + 1;
        Arcade.flag('getaway-heist');
        if (m.idx === 3) Arcade.flag('getaway-bank');
        clearStars(null);
        say('Heist complete!', `${money(m.h.reward)} stashed at the hideout`, 3, '#9be37a');
        sfx.good();
        mission = null;
        persist();
      }
    } else if (m.kind === 'taxi') {
      m.timer -= dt;
      if (m.timer <= 0) return failMission(m.stage === 'pickup' ? 'The passenger gave up' : 'Too slow!');
      const tgt = m.stage === 'pickup' ? m.pick : m.drop;
      const d = Math.hypot(pc.x - tgt.x, pc.y - tgt.y);
      if (d < 55 && speedOf(pc) < 60) {
        if (m.stage === 'pickup') {
          m.stage = 'drop';
          m.drop = randomSidewalk(700, 1900);
          const far = Math.hypot(m.drop.x - pc.x, m.drop.y - pc.y);
          m.timer = far / 190 + 10;
          m.fareBase = 50 + far / 7;
          sfx.door();
          say('Passenger in', 'Take them to the yellow marker', 1.6, '#fff59d');
        } else {
          const pay = m.fareBase + m.timer * 6 + (pc.hp / pc.T.hp) * 30;
          earn(pay, pc.x, pc.y - 40, 'Fare');
          m.fares++;
          m.earned += pay;
          s.fares++;
          if (m.fares >= 10) Arcade.flag('getaway-taxi');
          nextFare();
        }
      }
    } else if (m.kind === 'pizza') {
      m.timer -= dt;
      if (m.timer <= 0) return failMission('The pizzas went cold');
      const tgt = m.drops[m.done];
      if (Math.hypot(pc.x - tgt.x, pc.y - tgt.y) < 50 && speedOf(pc) < 90) {
        m.done++;
        earn(80, pc.x, pc.y - 40, 'Delivered');
        m.earned += 80;
        sfx.pickup();
        if (m.done >= m.drops.length) {
          const bonus = Math.round(m.timer * 12);
          earn(bonus, pc.x, pc.y - 70, 'Time bonus');
          s.deliveries++;
          say('All pizzas delivered!', `${money(m.earned + bonus)} earned`, 2.6, '#9be37a');
          sfx.good();
          mission = null;
          persist();
        }
      }
    } else if (m.kind === 'race') {
      if (m.countdown > 0) {
        m.countdown -= dt;
        pc.vx *= 0.8; pc.vy *= 0.8;
        if (m.countdown <= 0) Arcade.tone({ freq: 880, dur: 0.3, type: 'square', vol: 0.05 });
        return;
      }
      m.t += dt;
      if (m.t > RACE_MEDALS[2] * 1.6) return failMission('Out of time');
      const cp = RACE[m.cp % RACE.length];
      if (Math.hypot(pc.x - cp.x, pc.y - cp.y) < 60) {
        Arcade.tone({ freq: 660, to: 990, dur: 0.1, type: 'triangle', vol: 0.05 });
        if (m.cp === RACE.length) {
          const medal = RACE_MEDALS.findIndex(t => m.t <= t);
          const names = ['Gold', 'Silver', 'Bronze'];
          const pay = medal >= 0 ? [1200, 700, 350][medal] : 120;
          earn(pay, pc.x, pc.y - 40, medal >= 0 ? names[medal] : 'Finished');
          if (!s.raceBest || m.t < s.raceBest) s.raceBest = m.t;
          if (medal === 0) Arcade.flag('getaway-race');
          say(medal >= 0 ? `${names[medal]} medal!` : 'Race finished', `${m.t.toFixed(2)} s · best ${s.raceBest.toFixed(2)} s`, 3, medal === 0 ? '#ffd54f' : '#ffffff');
          sfx.good();
          mission = null;
          persist();
        } else m.cp++;
      }
    }
  }

  function missionTarget() {
    const m = mission;
    if (!m) return null;
    if (m.kind === 'heist') return m.stage === 'crack' ? { x: m.target.x, y: m.target.y, color: '#ff5252' } : { x: hideout.x, y: hideout.y, color: '#b388ff' };
    if (m.kind === 'taxi') return { ...(m.stage === 'pickup' ? m.pick : m.drop), color: '#fdd835' };
    if (m.kind === 'pizza') return { ...m.drops[m.done], color: '#ff7043' };
    if (m.kind === 'race') return { ...RACE[m.cp % RACE.length], color: '#ffffff' };
    return null;
  }
  function objectiveText() {
    const m = mission;
    if (!m) return stars ? 'Lose the cops: get out of sight, or hit a 🎨 Spray Shop' : '';
    if (m.kind === 'heist') return m.stage === 'crack' ? `Crack the ${m.h.name}: stay in the circle` : 'Get the loot to the 🏠 Hideout';
    if (m.kind === 'taxi') return `${m.stage === 'pickup' ? 'Pick up the passenger' : 'Drop them off'} · ${Math.ceil(m.timer)} s · fares ${m.fares}`;
    if (m.kind === 'pizza') return `Deliver pizza ${m.done + 1}/${m.drops.length} · ${Math.ceil(m.timer)} s`;
    if (m.kind === 'race') return m.countdown > 0 ? `Get ready… ${Math.ceil(m.countdown)}` : `Checkpoint ${m.cp}/${RACE.length} · ${m.t.toFixed(1)} s`;
    return '';
  }

  // ---------- Shops ----------

  function hideoutPanel(tab = 'garage') {
    const garage = s.owned.map(t => {
      const T = CARS[t];
      return `<div class="gc-row"><span class="gc-ico">🚗</span><span class="gc-info"><b>${T.name}</b><small>Top speed ${T.max} · toughness ${T.hp}</small></span>
        <button class="btn gc-buy" type="button" data-take="${t}">Take it</button></div>`;
    }).join('');
    const perks = PERKS.map(p => {
      const lv = s.perks[p.id], cost = p.costs[lv];
      return `<div class="gc-row"><span class="gc-ico">${p.icon}</span><span class="gc-info"><b>${p.name}</b> <em>Lv ${lv}/${p.costs.length}</em><small>${p.desc(Math.max(1, lv + (cost ? 1 : 0)))}</small></span>
        <button class="btn gc-buy" type="button" data-perk="${p.id}" ${!cost || s.cash < cost ? 'disabled' : ''}>${cost ? money(cost) : 'Max'}</button></div>`;
    }).join('');
    ui.show({
      title: '🏠 Hideout',
      html: `<p class="gc-cash">${money(s.cash)}</p>
        <div class="gc-tabs"><button class="btn ${tab === 'garage' ? '' : 'secondary'}" type="button" data-tab="garage">Garage</button><button class="btn ${tab === 'perks' ? '' : 'secondary'}" type="button" data-tab="perks">Perks</button></div>
        <div class="gc-list">${tab === 'garage' ? garage : perks}</div>
        <p style="font-size:12px;color:var(--muted)">Wanted level cleared. Buy more cars at the 🚗 Car Dealer.</p>`,
      button: 'Back to the streets',
      onAction: () => ui.hide(),
      onRender: panel => {
        panel.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => hideoutPanel(b.dataset.tab)));
        panel.querySelectorAll('[data-take]').forEach(b => b.addEventListener('click', () => {
          if (player.car) exitCar(true);
          const c = makeCar(b.dataset.take, hideout.x + 70, hideout.y + 70, 0, 'parked');
          player.x = c.x; player.y = c.y;
          enterNearest();
          ui.hide();
        }));
        panel.querySelectorAll('[data-perk]').forEach(b => b.addEventListener('click', () => {
          const p = PERKS.find(x => x.id === b.dataset.perk), lv = s.perks[p.id], cost = p.costs[lv];
          if (!cost || s.cash < cost) return;
          s.cash -= cost;
          s.perks[p.id]++;
          player.nitro = nitroCap();
          sfx.good();
          persist();
          hideoutPanel('perks');
        }));
      },
    });
  }
  function dealerPanel() {
    const rows = Object.entries(CARS).filter(([, T]) => !T.hidden && T.price > 0).map(([id, T]) => {
      const own = s.owned.includes(id);
      return `<div class="gc-row"><span class="gc-ico">🏎️</span><span class="gc-info"><b>${T.name}</b><small>Top speed ${T.max} · accel ${T.accel} · grip ${T.grip} · toughness ${T.hp}</small></span>
        <button class="btn gc-buy" type="button" data-buy="${id}" ${own || s.cash < T.price ? 'disabled' : ''}>${own ? 'Owned' : money(T.price)}</button></div>`;
    }).join('');
    ui.show({
      title: '🚗 Car Dealer',
      html: `<p class="gc-cash">${money(s.cash)}</p><div class="gc-list">${rows}</div><p style="font-size:12px;color:var(--muted)">Cars you buy wait for you in the Hideout garage. Your new one is parked right here.</p>`,
      button: 'Leave',
      onAction: () => ui.hide(),
      onRender: panel => panel.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.buy, T = CARS[id];
        if (s.owned.includes(id) || s.cash < T.price) return;
        s.cash -= T.price;
        s.owned.push(id);
        if (id === 'super') Arcade.flag('getaway-super');
        const m = markerOf('dealer');
        makeCar(id, m.x + 60, m.y + 80, 0, 'parked');
        sfx.good();
        persist();
        dealerPanel();
      })),
    });
  }
  function missionPanel(m) {
    const info = {
      heist: () => {
        const h = HEISTS[m.heist], locked = s.heists < h.need;
        return { title: `💼 ${h.name}`, html: locked ? `<p>Pull off ${h.need} heist${h.need > 1 ? 's' : ''} first to be trusted with this one.</p>` : `<p>Crack it in ${h.crack} seconds, then get the loot back to the 🏠 Hideout with <b>${'★'.repeat(h.stars)}</b> on your tail.</p><p class="gc-cash">${money(h.reward)}</p>`, ok: !locked };
      },
      taxi: () => ({ title: '🚕 Taxi shift', html: '<p>Pick up passengers and drive them across town before the meter runs out. Fast, careful driving earns tips. The shift goes on until you miss one.</p>', ok: true }),
      pizza: () => ({ title: '🍕 Pizza run', html: '<p>Four hot pizzas, 100 seconds. Every second left over is a bonus.</p>', ok: true }),
      race: () => ({ title: '🏁 Street race', html: `<p>${RACE.length} checkpoints around the city. Beat ${RACE_MEDALS[0].toFixed(0)} s for gold.${s.raceBest ? ` Your best: ${s.raceBest.toFixed(2)} s.` : ''}</p>`, ok: true }),
    }[m.kind]();
    const needCar = m.kind !== 'heist' && !player.car;
    ui.show({
      title: info.title,
      html: info.html + (needCar ? '<p style="color:#ff8a80">You need a car for this one.</p>' : '') + (mission ? '<p style="color:#ff8a80">Finish your current job first.</p>' : ''),
      button: info.ok && !needCar && !mission ? 'Start' : 'OK',
      onAction: () => { ui.hide(); if (info.ok && !needCar && !mission) startMission(m); },
    });
  }

  function busted() {
    const fine = Math.min(5000, Math.round(s.cash * 0.1));
    s.cash -= fine;
    if (player.car) { player.car.role = 'parked'; player.car = null; }
    if (mission) { mission = null; }
    clearStars(null);
    for (let i = cars.length - 1; i >= 0; i--) if (cars[i].role === 'leaving') cars.splice(i, 1);
    player.x = policeHQ.x;
    player.y = policeHQ.y + 50;
    sfx.bad();
    persist();
    ui.show({ title: '🚔 Busted!', html: `<p>The police caught you. You paid a ${money(fine)} fine.</p>`, button: 'Back to the streets', onAction: () => ui.hide() });
  }

  // ---------- Input ----------

  const keys = new Set();
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (!overlayEl.hidden) return;
    if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Enter') {
      if (player.car) exitCar(false); else enterNearest();
    }
    if (e.code === 'KeyM') mapOpen = !mapOpen;
    if (e.code === 'KeyH' && player.car) { sfx.horn(); player.car.honk = 0.3; }
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const held = (...codes) => codes.some(c => keys.has(c));

  // Touch: drag anywhere to steer (and drive toward the drag); tap the buttons in the corner.
  let joy = null;
  const toCanvas = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  const TOUCH_BTNS = [{ id: 'enter', x: W - 70, y: H - 150, r: 32, label: 'E' }, { id: 'brake', x: W - 150, y: H - 70, r: 32, label: '⏸' }];
  let touchBrake = false;
  canvas.addEventListener('pointerdown', e => {
    const p = toCanvas(e);
    if (e.pointerType !== 'mouse') {
      const b = TOUCH_BTNS.find(b => Math.hypot(p.x - b.x, p.y - b.y) < b.r);
      if (b) {
        if (b.id === 'enter') { if (player.car) exitCar(false); else enterNearest(); }
        else touchBrake = e.pointerId;
        return;
      }
    }
    joy = { id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y };
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointermove', e => { if (joy && joy.id === e.pointerId) { const p = toCanvas(e); joy.x = p.x; joy.y = p.y; } });
  const endPtr = e => { if (joy && joy.id === e.pointerId) joy = null; if (touchBrake === e.pointerId) touchBrake = false; };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);

  function controls() {
    let x = 0, y = 0;
    if (held('KeyW', 'ArrowUp')) y -= 1;
    if (held('KeyS', 'ArrowDown')) y += 1;
    if (held('KeyA', 'ArrowLeft')) x -= 1;
    if (held('KeyD', 'ArrowRight')) x += 1;
    let stick = null;
    if (joy) {
      const dx = joy.x - joy.sx, dy = joy.y - joy.sy, m = Math.hypot(dx, dy);
      if (m > 8) stick = { x: dx / m, y: dy / m, m: Math.min(1, m / 60) };
    }
    return { x, y, stick, brake: held('Space') || touchBrake !== false, boost: held('ShiftLeft', 'ShiftRight') };
  }

  function pause() {
    if (!overlayEl.hidden) return;
    persist();
    ui.show({ title: 'Paused', html: `<p>${money(s.cash)} · lifetime ${money(s.lifetime)}</p>`, button: 'Resume', onAction: () => ui.hide() });
  }
  Arcade.onBlur(pause);

  // ---------- Update ----------

  const camX = () => cam.x + W / 2 / cam.z, camY = () => cam.y + H / 2 / cam.z;
  const cam = { x: 0, y: 0, z: 1 };

  function updatePlayer(dt) {
    const c = controls();
    if (player.car) {
      const car = player.car;
      let throttle = -c.y, steer = c.x;
      if (c.stick) {
        // Touch: point the stick where you want to go.
        const want = Math.atan2(c.stick.y, c.stick.x), d = angDiff(want, car.a);
        steer = clamp(d * 2, -1, 1);
        throttle = Math.abs(d) > 2.4 ? -c.stick.m : c.stick.m;
      }
      drive(car, throttle, steer, c.brake, c.boost, dt);
      if (!c.boost && player.nitro < nitroCap()) player.nitro = Math.min(nitroCap(), player.nitro + dt * 0.25);
      player.x = car.x; player.y = car.y;
    } else {
      let mx = c.x, my = c.y;
      if (c.stick) { mx = c.stick.x * c.stick.m; my = c.stick.y * c.stick.m; }
      const m = Math.hypot(mx, my), sp = c.boost ? 210 : 130;
      if (m > 0) {
        player.vx = mx / Math.max(1, m) * sp;
        player.vy = my / Math.max(1, m) * sp;
        player.a = Math.atan2(my, mx);
        player.walk += dt * (c.boost ? 14 : 9);
      } else { player.vx = 0; player.vy = 0; }
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      collideWorld(player, o => [[o.x, o.y]], 8);
    }
  }

  function updateTraffic(car, dt) {
    const ai = car.ai;
    if (!ai) { drive(car, 0, 0, true, false, dt); return; }
    const target = ai.phase === 'turn' ? aiExit(car) : aiApproach(car);
    const dx = target.x - car.x, dy = target.y - car.y, dd = Math.hypot(dx, dy);
    if (dd < 16) {
      if (ai.phase !== 'turn') {
        // At the junction: pick a way on (never straight back), staying inside the city.
        const opts = [0, 1, 3].map(t => (ai.d + t) % 4).filter(nd => {
          const [ex, ey] = DIRS[nd];
          const ni = ai.i + ex, nj = ai.j + ey;
          return ni >= 0 && nj >= 0 && ni <= N && nj <= N;
        });
        ai.nd = opts.length ? (Math.random() < 0.55 && opts.includes(ai.d) ? ai.d : Arcade.pick(opts)) : (ai.d + 2) % 4;
        ai.phase = 'turn';
      } else {
        const [ex, ey] = DIRS[ai.nd];
        ai.d = ai.nd;
        ai.i += ex; ai.j += ey;
        ai.phase = 'go';
      }
    }
    // Slow for anything in front.
    const fx_ = Math.cos(car.a), fy = Math.sin(car.a);
    let blocked = false;
    const check = (ox, oy) => {
      const rx = ox - car.x, ry = oy - car.y, ahead = rx * fx_ + ry * fy, side = Math.abs(-rx * fy + ry * fx_);
      if (ahead > 0 && ahead < 70 && side < 22) blocked = true;
    };
    if (ai.wait <= 0) {
      for (const o of cars) if (o !== car && Math.abs(o.x - car.x) < 80 && Math.abs(o.y - car.y) < 80) check(o.x, o.y);
      if (!player.car) check(player.x, player.y);
    } else ai.wait -= dt;
    if (blocked) { ai.stuck += dt; if (ai.stuck > 2.5) { ai.wait = 1.2; ai.stuck = 0; car.honk = 0.3; } } else ai.stuck = 0;
    const want = Math.atan2(dy, dx), d = angDiff(want, car.a);
    const turning = ai.phase === 'turn' && ai.nd !== ai.d;
    const targetSpeed = blocked ? 0 : turning ? 105 : ai.speed;
    const vF = fwdSpeed(car);
    const throttle = blocked ? (vF > 5 ? -0.8 : 0) : vF < targetSpeed ? 0.7 : vF > targetSpeed + 30 ? -0.6 : 0;
    drive(car, throttle, clamp(d * 2.5, -1, 1), false, false, dt);
  }

  function updateCop(car, dt) {
    const d = Math.hypot(player.x - car.x, player.y - car.y);
    let tx, ty;
    if (d < 280 || clearLine(car.x, car.y, player.x, player.y)) {
      const lead = player.car ? 0.35 : 0.1;
      tx = player.x + (player.car ? player.car.vx : 0) * lead;
      ty = player.y + (player.car ? player.car.vy : 0) * lead;
      car.nav = null;
    } else {
      // Out of sight: drive the road grid, one junction at a time, toward where you are.
      const i = clamp(Math.round((car.x - R / 2) / P), 0, N), j = clamp(Math.round((car.y - R / 2) / P), 0, N);
      if (!car.nav || Math.hypot(car.nav.x - car.x, car.nav.y - car.y) < 40) {
        const here = iPos(i, j);
        if (Math.hypot(here.x - car.x, here.y - car.y) > 60 && !car.nav) car.nav = here;
        else {
          let best = null, bd = Infinity;
          for (const [ex, ey] of DIRS) {
            const ni = i + ex, nj = j + ey;
            if (ni < 0 || nj < 0 || ni > N || nj > N) continue;
            const p = iPos(ni, nj), pd = Math.hypot(p.x - player.x, p.y - player.y);
            if (pd < bd) { bd = pd; best = p; }
          }
          car.nav = best;
        }
      }
      tx = car.nav.x; ty = car.nav.y;
    }
    const want = Math.atan2(ty - car.y, tx - car.x), da = angDiff(want, car.a);
    let throttle = Math.abs(da) > 2.2 && fwdSpeed(car) < 60 ? -1 : 1;
    // Stuck against something: back up and turn.
    if (speedOf(car) < 25) car.stuck += dt; else car.stuck = Math.max(0, car.stuck - dt);
    if (car.stuck > 1.2) { throttle = -1; if (car.stuck > 2.4) car.stuck = 0; }
    drive(car, throttle, clamp(da * 3, -1, 1) * (throttle < 0 ? -1 : 1), Math.abs(da) > 1.2 && speedOf(car) > 260, false, dt);
    car.siren += dt;
  }

  function updateCars(dt) {
    for (const car of cars) {
      if (car === player.car) continue;
      if (car.role === 'traffic') updateTraffic(car, dt);
      else if (car.role === 'cop') { car.stuck = car.stuck || 0; updateCop(car, dt); }
      else drive(car, 0, 0, true, false, dt);
      if (car.honk > 0) car.honk -= dt;
    }
    for (const car of cars) { moveCar(car, dt); checkRamps(car); }
    // Car-on-car collisions, only between nearby pairs.
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (Math.abs(a.x - b.x) < 70 && Math.abs(a.y - b.y) < 70) carVsCar(a, b);
    }
    // A walking player gets nudged by cars rather than hurt.
    if (!player.car) for (const c of cars) {
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d < c.T.wid * 0.6 + 8 && d > 0) {
        player.x += (player.x - c.x) / d * (c.T.wid * 0.6 + 8 - d);
        player.y += (player.y - c.y) / d * (c.T.wid * 0.6 + 8 - d);
      }
    }
    // Keep the traffic and cop counts near their targets, and clear out far-away cars.
    const px = camX(), py = camY();
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (c === player.car) continue;
      const d = Math.hypot(c.x - px, c.y - py);
      const keepOwned = c.role === 'parked' && s.owned.includes(c.type) && d < 2600;
      if ((d > 1500 && !keepOwned) || (c.role === 'leaving' && d > 700) || (c.role === 'wreck' && d > 1000)) cars.splice(i, 1);
    }
    const traffic = cars.filter(c => c.role === 'traffic').length;
    if (traffic < 44) spawnTraffic();
    const cops = cars.filter(c => c.role === 'cop').length;
    if (cops < [0, 1, 2, 3, 4, 6, 8, 10, 12][stars] && Math.random() < dt * 1.5) spawnCop();
  }

  function updatePeds(dt) {
    while (peds.length < 70) { const n = peds.length; spawnPed(); if (peds.length === n) break; }
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      p.step += dt * 8;
      if (Math.hypot(p.x - camX(), p.y - camY()) > 1300) { peds.splice(i, 1); continue; }
      if (p.dive > 0) {
        p.dive -= dt;
        p.x += p.dvx * dt; p.y += p.dvy * dt;
        p.dvx *= Math.exp(-3 * dt); p.dvy *= Math.exp(-3 * dt);
        collideWorld(p, o => [[o.x, o.y]], 6);
        p.vx = p.vy = 0;
        continue;
      }
      // Dive out of the way of anything fast coming at you.
      for (const c of cars) {
        const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy), sp = speedOf(c);
        if (d < 26 + sp * 0.18 && sp > 70) {
          const toward = (c.vx * dx + c.vy * dy) / (sp * d + 1e-6);
          if (toward > 0.3 || d < 24) {
            const sx = -c.vy / sp, sy = c.vx / sp, side = Math.sign(sx * dx + sy * dy) || 1;
            p.dvx = sx * side * 260; p.dvy = sy * side * 260;
            p.dive = 0.45;
            p.flee = 3;
            if (Gfx.rand() < 0.4) pops.add(Arcade.pick(['Whoa!', 'Hey!', 'Watch it!', 'Yikes!']), p.x, p.y - 20, { color: '#fff', size: 14, life: 0.8 });
            break;
          }
        }
      }
      if (p.dive > 0) continue;
      const [tx, ty] = pedTarget(p);
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1, sp = p.speed * (p.flee > 0 ? 2.6 : 1);
      p.flee = Math.max(0, p.flee - dt);
      p.x += dx / d * Math.min(d, sp * dt);
      p.y += dy / d * Math.min(d, sp * dt);
      p.a = Math.atan2(dy, dx);
    }
  }

  function updateWanted(dt) {
    if (stars <= 0) { seen = false; return; }
    if (stars >= 4 && !heli) heli = { x: player.x - 400, y: player.y - 300, a: 0 };
    if (heli) {
      const tx = player.x + Math.sin(time * 0.7) * 120, ty = player.y + Math.cos(time * 0.5) * 90;
      heli.x = Gfx.approach(heli.x, tx, 1.2, dt);
      heli.y = Gfx.approach(heli.y, ty, 1.2, dt);
      heli.a += dt * 20;
    }
    // The helicopter only keeps you spotted out in the open, not under the trees of a park.
    const blk = blockAt(player.x, player.y);
    const underCover = blk && blk.kind === 'park' && blk.trees.some(t => Math.hypot(t.x - player.x, t.y - player.y) < t.r + 14);
    seen = copSees(520) || (heli && !underCover);
    const fade = 1 + s.perks.scanner * 0.3;
    if (seen) evadeT = 0;
    else {
      evadeT += dt * fade;
      if (evadeT > 6 + stars * 1.5) {
        stars--;
        evadeT = 0;
        if (stars < 4) heli = null;
        if (stars === 0) clearStars('You lost them!');
        else pops.add('★ lost', player.x, player.y - 50, { color: '#80deea', size: 16 });
      }
    }
    // Busted: stopped (or on foot) with a cop right on you.
    let close = false;
    for (const c of cars) if (c.role === 'cop' && !c.broken && Math.hypot(c.x - player.x, c.y - player.y) < (player.car ? 70 : 60)) close = true;
    const stopped = !player.car || speedOf(player.car) < 80;
    if (close && stopped) bustT += dt * (player.car ? 1 : 1.6);
    else bustT = Math.max(0, bustT - dt * 0.7);
    if (bustT > 2.2) busted();
  }

  function updateWorldBits(dt) {
    const here = player.car || player;
    for (const p of packages) {
      if (s.pkgs.includes(p.id)) continue;
      if (Math.hypot(p.x - here.x, p.y - here.y) < 26) {
        s.pkgs.push(p.id);
        earn(250, p.x, p.y - 30, `Package ${s.pkgs.length}/${packages.length}`);
        sfx.pickup();
        if (s.pkgs.length >= 20) Arcade.flag('getaway-packages');
        if (s.pkgs.length === packages.length) { earn(10000, p.x, p.y - 60, 'ALL PACKAGES'); say('Every package found!', '+$10,000', 3, '#ffd54f'); }
        persist();
      }
    }
    // Markers.
    let on = null;
    for (const m of markers) if (Math.hypot(m.x - here.x, m.y - here.y) < 40 && (!player.car || speedOf(player.car) < 120)) on = m;
    if (on && on !== inMarker) {
      if (on.kind === 'hideout') {
        if (stars > 0) clearStars('Laid low at the hideout');
        if (!mission) { if (player.car) player.car.vx = player.car.vy = 0; hideoutPanel(); }
      } else if (on.kind === 'paint') {
        if (stars > 0 && player.car) {
          const cost = 100 * stars;
          if (s.cash >= cost) {
            s.cash -= cost;
            player.car.color = Arcade.pick(['#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292']);
            player.car.hp = player.car.T.hp;
            clearStars(`Fresh paint! (−${money(cost)})`);
          } else say('Not enough cash for a respray', `${money(cost)} needed`, 2, '#ff8a80');
        } else if (stars > 0) say('Bring a car to respray', '', 1.6, '#80deea');
        else if (player.car && player.car.hp < player.car.T.hp) { player.car.hp = player.car.T.hp; say('Car fixed up', 'Free when you are not wanted', 1.6, '#80deea'); }
      } else if (on.kind === 'dealer') { if (player.car) player.car.vx = player.car.vy = 0; dealerPanel(); }
      else if (on.kind === 'police') { /* nothing to do here */ }
      else if (!mission || mission.kind === 'heist') { if (player.car) player.car.vx = player.car.vy = 0; if (!(mission && mission.target === on)) missionPanel(on); }
    }
    inMarker = on;
  }

  let saveT = 0;
  function update(dt) {
    time += dt;
    dayT = (dayT + dt / 480) % 1;
    updatePlayer(dt);
    updateCars(dt);
    updatePeds(dt);
    updateWanted(dt);
    updateMission(dt);
    updateWorldBits(dt);
    fx.update(dt);
    pops.update(dt);
    shake.update(dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    // Camera: pulls ahead of the car and zooms out with speed.
    const pc = player.car, sp = pc ? speedOf(pc) : 0;
    const zt = pc ? clamp(1.05 - sp / 1400, 0.66, 1) : 1.15;
    cam.z = Gfx.approach(cam.z, zt, 1.5, dt);
    const lx = pc ? pc.vx * 0.35 : 0, ly = pc ? pc.vy * 0.35 : 0;
    const tx = player.x + lx - W / 2 / cam.z, ty = player.y + ly - H / 2 / cam.z;
    cam.x = Gfx.approach(cam.x, tx, 4, dt);
    cam.y = Gfx.approach(cam.y, ty, 4, dt);
    saveT += dt;
    if (saveT > 10) { saveT = 0; persist(); }
    // Sound.
    if (audio) {
      const muted = Arcade.load('muted', false);
      const now = audio.currentTime;
      engineGain.gain.setTargetAtTime(!muted && pc ? 0.03 + Math.min(0.03, sp / 15000) : 0, now, 0.08);
      engineOsc.frequency.setTargetAtTime(45 + sp * 0.28 + (keys.has('KeyW') || keys.has('ArrowUp') ? 15 : 0), now, 0.08);
      let near = Infinity;
      for (const c of cars) if (c.role === 'cop') near = Math.min(near, Math.hypot(c.x - player.x, c.y - player.y));
      sirenGain.gain.setTargetAtTime(!muted && stars > 0 && near < 900 ? 0.012 * (1 - near / 900) : 0, now, 0.1);
      sirenOsc.frequency.setTargetAtTime(Math.floor(time * 2.5) % 2 ? 640 : 880, now, 0.02);
    }
  }

  // ---------- Drawing ----------

  // The ground (roads, sidewalks, parks) is drawn once into 512 px tiles, made as they're needed.
  const TILE = 512, tiles = new Map();
  function groundTile(tx, ty) {
    const key = tx * 100 + ty;
    let t = tiles.get(key);
    if (t) return t;
    t = document.createElement('canvas');
    t.width = t.height = TILE;
    const g = t.getContext('2d');
    g.translate(-tx * TILE, -ty * TILE);
    const x0 = tx * TILE, y0 = ty * TILE;
    g.fillStyle = '#41474f';
    g.fillRect(x0, y0, TILE, TILE);
    // Asphalt grain.
    const r = Gfx.rng(key + 7);
    for (let k = 0; k < 300; k++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)'; g.fillRect(x0 + r() * TILE, y0 + r() * TILE, 2, 2); }
    // Lane markings.
    for (let i = 0; i <= N; i++) {
      const c = roadC(i);
      g.fillStyle = '#e8c547';
      g.fillRect(x0, c - 2, TILE, 1.5); g.fillRect(x0, c + 0.5, TILE, 1.5);
      g.fillRect(c - 2, y0, 1.5, TILE); g.fillRect(c + 0.5, y0, 1.5, TILE);
    }
    for (const blk of allBlocks) {
      if (blk.x2 + 20 < x0 || blk.x1 - 20 > x0 + TILE || blk.y2 + 20 < y0 || blk.y1 - 20 > y0 + TILE) continue;
      // Crosswalks at the corners.
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (let k = 0; k < 6; k++) {
        g.fillRect(blk.x1 - R + 12 + k * 12, blk.y1 - 16, 6, 12);
        g.fillRect(blk.x1 - 16, blk.y1 - R + 12 + k * 12, 12, 6);
      }
      // Curb, sidewalk, then the block's own ground.
      g.fillStyle = '#9aa0a6';
      g.fillRect(blk.x1, blk.y1, B, B);
      g.fillStyle = '#b9bec4';
      g.fillRect(blk.x1 + 2, blk.y1 + 2, B - 4, B - 4);
      g.strokeStyle = 'rgba(0,0,0,0.08)';
      g.lineWidth = 1;
      for (let k = 18; k < B; k += 18) {
        g.beginPath(); g.moveTo(blk.x1 + k, blk.y1); g.lineTo(blk.x1 + k, blk.y1 + 18); g.moveTo(blk.x1 + k, blk.y2 - 18); g.lineTo(blk.x1 + k, blk.y2); g.stroke();
        g.beginPath(); g.moveTo(blk.x1, blk.y1 + k); g.lineTo(blk.x1 + 18, blk.y1 + k); g.moveTo(blk.x2 - 18, blk.y1 + k); g.lineTo(blk.x2, blk.y1 + k); g.stroke();
      }
      const ix1 = blk.x1 + 18, iy1 = blk.y1 + 18, iw = B - 36;
      if (blk.kind === 'park' || blk.district === 'suburb') {
        g.fillStyle = blk.kind === 'park' ? '#5fa35a' : '#79b26a';
        g.fillRect(ix1, iy1, iw, iw);
        for (let k = 0; k < 120; k++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,50,0,0.08)'; g.fillRect(ix1 + r() * iw, iy1 + r() * iw, 3, 3); }
        if (blk.kind === 'park') {
          g.strokeStyle = '#d7c79e';
          g.lineWidth = 12;
          g.beginPath(); g.moveTo(blk.x1 + 18, (blk.y1 + blk.y2) / 2); g.lineTo(blk.x2 - 18, (blk.y1 + blk.y2) / 2);
          g.moveTo((blk.x1 + blk.x2) / 2, blk.y1 + 18); g.lineTo((blk.x1 + blk.x2) / 2, blk.y2 - 18); g.stroke();
          const p = blk.pond;
          g.fillStyle = '#3d8fd1';
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
          g.strokeStyle = '#cfd8dc'; g.lineWidth = 5;
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke();
          g.fillStyle = 'rgba(255,255,255,0.4)';
          g.beginPath(); g.arc(p.x - 14, p.y - 12, 8, 0, TAU); g.fill();
        } else {
          // Driveways.
          g.fillStyle = '#a8a8a8';
          for (const b of blk.buildings) g.fillRect(b.x2 - 30, b.y2, 18, Math.min(30, blk.y2 - 18 - b.y2));
        }
      } else {
        g.fillStyle = blk.kind === 'lot' ? '#4a5058' : blk.district === 'industrial' ? '#8e8a80' : '#a3a8ae';
        g.fillRect(ix1, iy1, iw, iw);
        if (blk.kind === 'lot' || blk.forecourt) {
          g.strokeStyle = 'rgba(255,255,255,0.55)';
          g.lineWidth = 2;
          for (let k = 0; k < 8; k++) { const x = ix1 + 20 + k * 38; g.beginPath(); g.moveTo(x, blk.y2 - 120); g.lineTo(x, blk.y2 - 70); g.stroke(); }
        }
      }
    }
    // Water past the city edge.
    g.fillStyle = '#2f6f9f';
    if (x0 < 0) g.fillRect(x0, y0, -x0, TILE);
    if (y0 < 0) g.fillRect(x0, y0, TILE, -y0);
    if (x0 + TILE > WORLD) g.fillRect(WORLD, y0, x0 + TILE - WORLD, TILE);
    if (y0 + TILE > WORLD) g.fillRect(x0, WORLD, TILE, y0 + TILE - WORLD);
    // Ramps are painted on the road.
    for (const rp of ramps) {
      if (rp.x < x0 - 60 || rp.x > x0 + TILE + 60 || rp.y < y0 - 60 || rp.y > y0 + TILE + 60) continue;
      g.save();
      g.translate(rp.x, rp.y);
      g.rotate(rp.a);
      const rg = g.createLinearGradient(-16, 0, 16, 0);
      rg.addColorStop(0, '#5d4037'); rg.addColorStop(1, '#ffca28');
      g.fillStyle = rg;
      g.fillRect(-16, -30, 32, 60);
      g.fillStyle = '#212121';
      for (let k = -24; k < 30; k += 12) g.fillRect(-12, k, 24, 4);
      g.restore();
    }
    if (tiles.size > 40) tiles.delete(tiles.keys().next().value);
    tiles.set(key, t);
    return t;
  }

  // Buildings rise toward the viewer: the roof is the footprint pushed away from the screen's
  // centre in proportion to height, and the two walls facing the centre are drawn between.
  const VIEW_H = 900;
  function drawBuilding(b, cxw, cyw) {
    const k = 1 + b.h / VIEW_H;
    const rx1 = cxw + (b.x1 - cxw) * k, ry1 = cyw + (b.y1 - cyw) * k, rx2 = cxw + (b.x2 - cxw) * k, ry2 = cyw + (b.y2 - cyw) * k;
    const night = darkness();
    const wall = (pts, col) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    };
    // Shadow to the south-east.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x1 + b.h * 0.12, b.y1 + b.h * 0.12, b.x2 - b.x1, b.y2 - b.y1);
    const side = shade(b.color, -0.32), front = shade(b.color, -0.18);
    if (rx1 > b.x1) wall([[b.x1, b.y1], [rx1, ry1], [rx1, ry2], [b.x1, b.y2]], side);
    if (rx2 < b.x2) wall([[b.x2, b.y1], [rx2, ry1], [rx2, ry2], [b.x2, b.y2]], side);
    if (ry1 > b.y1) wall([[b.x1, b.y1], [rx1, ry1], [rx2, ry1], [b.x2, b.y1]], front);
    if (ry2 < b.y2) wall([[b.x1, b.y2], [rx1, ry2], [rx2, ry2], [b.x2, b.y2]], front);
    // Windows on the tall ones: rows of lit squares along the walls at night.
    if (b.h > 80 && (b.style === 'tower' || b.style === 'helipad' || b.style === 'flat' || b.style === 'garden' || b.style === 'bank')) {
      ctx.fillStyle = night > 0.3 ? `rgba(255,230,140,${0.35 + night * 0.4})` : 'rgba(180,220,255,0.35)';
      const rows = Math.floor(b.h / 26);
      for (let rw = 1; rw <= rows; rw++) {
        const t = rw / (rows + 1), kk = 1 + (b.h * t) / VIEW_H;
        if (ry2 < b.y2) {
          const y = cyw + (b.y2 - cyw) * kk, xa = cxw + (b.x1 - cxw) * kk, xb = cxw + (b.x2 - cxw) * kk;
          for (let x = xa + 6; x < xb - 6; x += 14) ctx.fillRect(x, y - 3, 6, 3);
        }
        if (ry1 > b.y1) {
          const y = cyw + (b.y1 - cyw) * kk, xa = cxw + (b.x1 - cxw) * kk, xb = cxw + (b.x2 - cxw) * kk;
          for (let x = xa + 6; x < xb - 6; x += 14) ctx.fillRect(x, y, 6, 3);
        }
      }
    }
    if (!b.roof) b.roof = roofSprite(b);
    ctx.drawImage(b.roof, rx1, ry1, rx2 - rx1, ry2 - ry1);
  }

  function drawTree(t) {
    Gfx.shadow(ctx, t.x + 6, t.y + 6, t.r * 1.1, t.r * 0.8, 0.3);
    ctx.fillStyle = '#2e7d32';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#43a047';
    ctx.beginPath(); ctx.arc(t.x - t.r * 0.2, t.y - t.r * 0.25, t.r * 0.75, 0, TAU); ctx.fill();
    ctx.fillStyle = '#66bb6a';
    ctx.beginPath(); ctx.arc(t.x - t.r * 0.35, t.y - t.r * 0.4, t.r * 0.35, 0, TAU); ctx.fill();
  }

  function drawCar(c) {
    const sp = carSprite(c.type, c.color);
    const lift = c.z * 0.06;
    Gfx.shadow(ctx, c.x + 3 + c.z * 0.3, c.y + 4 + c.z * 0.3, c.T.len * 0.6, c.T.wid * 0.7, 0.35);
    sp.draw(ctx, c.x, c.y - c.z * 0.4, 1 + lift, c.a);
    if ((c.type === 'police' || c.type === 'riot') && (c.role === 'cop' || c.siren > 0)) {
      const on = Math.floor(time * 8) % 2;
      ctx.fillStyle = on ? '#ff1744' : '#2979ff';
      ctx.beginPath(); ctx.arc(c.x, c.y - c.z * 0.4, 4, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.14;
      ctx.beginPath(); ctx.arc(c.x, c.y, 26, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (c.honk > 0) Gfx.text(ctx, '📯', c.x, c.y - 26, { size: 14, stroke: null });
    if (c.broken) {
      ctx.fillStyle = 'rgba(30,30,30,0.35)';
      ctx.beginPath(); ctx.arc(c.x, c.y, c.T.len * 0.45, 0, TAU); ctx.fill();
    }
  }

  function drawPerson(x, y, a, color, skin, step, diving) {
    Gfx.shadow(ctx, x + 2, y + 3, 8, 5, 0.3);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const sw = diving ? 0 : Math.sin(step) * 4;
    ctx.fillStyle = '#37474f';
    ctx.fillRect(-2 + sw, -5, 6, 3); ctx.fillRect(-2 - sw, 2, 6, 3);
    ctx.fillStyle = color;
    Gfx.roundRect(ctx, -5, -7, 10, 14, 4); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(1, 0, 4.2, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawMarker(m) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    const active = mission && mission.kind === 'heist' && mission.target === m;
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.2;
    ctx.fillStyle = m.color;
    ctx.beginPath(); ctx.arc(m.x, m.y, active ? 46 : 32, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(m.x, m.y, active ? 46 : 32, 0, TAU); ctx.stroke();
    if (active && mission.stage === 'crack') {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(m.x, m.y, 52, -Math.PI / 2, -Math.PI / 2 + TAU * mission.crack / mission.h.crack); ctx.stroke();
    }
    ctx.restore();
    Gfx.text(ctx, m.icon, m.x, m.y - 2 - pulse * 4, { size: 22, stroke: null });
    Gfx.text(ctx, m.name, m.x, m.y + 44, { size: 12, color: '#fff', width: 3 });
  }

  function darkness() {
    // 0 at noon, ~0.6 in the middle of the night.
    const d = Math.cos(dayT * TAU);
    return clamp((d + 0.25) * 0.55, 0, 0.6);
  }

  function drawWorld() {
    const sh = shake.offset(10);
    ctx.save();
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x + sh.x / cam.z, -cam.y + sh.y / cam.z);
    const vw = W / cam.z, vh = H / cam.z;
    const x0 = cam.x, y0 = cam.y;
    // Ground tiles.
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + vw) / TILE); tx++) {
      for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + vh) / TILE); ty++) ctx.drawImage(groundTile(tx, ty), tx * TILE, ty * TILE);
    }
    const vis = (x, y, m = 80) => x > x0 - m && x < x0 + vw + m && y > y0 - m && y < y0 + vh + m;
    // Packages and the mission target ring.
    for (const p of packages) {
      if (s.pkgs.includes(p.id) || !vis(p.x, p.y)) continue;
      const bob = Math.sin(time * 3 + p.id) * 3;
      Gfx.shadow(ctx, p.x, p.y + 6, 10, 4, 0.3);
      Gfx.box(ctx, p.x - 9, p.y - 7 + bob, 18, 12, 10, '#a1887f', 2);
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(p.x - 1.5, p.y - 17 + bob, 3, 12);
    }
    const tg = missionTarget();
    if (tg && vis(tg.x, tg.y, 100)) {
      ctx.strokeStyle = tg.color;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 6);
      ctx.beginPath(); ctx.arc(tg.x, tg.y, 40, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      if (mission.kind === 'taxi' && mission.stage === 'pickup') drawPerson(tg.x, tg.y, Math.sin(time * 3), '#fdd835', '#ffe0bd', time * 6, false);
    }
    if (mission && mission.kind === 'race') {
      RACE.forEach((p, i) => {
        if (i < mission.cp % RACE.length && mission.cp !== RACE.length) return;
        if (!vis(p.x, p.y)) return;
        ctx.fillStyle = i === mission.cp % RACE.length ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 40, 0, TAU); ctx.fill();
      });
    }
    for (const m of markers) if (vis(m.x, m.y)) drawMarker(m);
    // People, cars and trees.
    for (const p of peds) if (vis(p.x, p.y)) drawPerson(p.x, p.y, p.a || 0, p.color, p.skin, p.step, p.dive > 0);
    if (!player.car) drawPerson(player.x, player.y, player.a, '#7c4dff', '#ffe0bd', player.walk, false);
    const air = [];
    for (const c of cars) { if (!vis(c.x, c.y)) continue; if (c.z > 2) air.push(c); else drawCar(c); }
    fx.draw(ctx);
    // Buildings and trees, far ones first so near ones overlap them.
    const cxw = x0 + vw / 2, cyw = y0 + vh / 2;
    const bs = [];
    for (const blk of allBlocks) {
      if (blk.x2 < x0 - 200 || blk.x1 > x0 + vw + 200 || blk.y2 < y0 - 200 || blk.y1 > y0 + vh + 200) continue;
      for (const b of blk.buildings) bs.push(b);
      for (const t of blk.trees) if (vis(t.x, t.y)) drawTree(t);
    }
    bs.sort((a, b) => a.h - b.h);
    for (const b of bs) drawBuilding(b, cxw, cyw);
    for (const c of air) drawCar(c);
    // Night: darken, then add light back with headlights and street lamps.
    const dk = darkness();
    if (dk > 0.02) {
      ctx.fillStyle = `rgba(8,12,40,${dk})`;
      ctx.fillRect(x0 - 20, y0 - 20, vw + 40, vh + 40);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const lx = roadC(i) + 50, ly = roadC(j) + 50;
        if (!vis(lx, ly, 120)) continue;
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 110);
        g.addColorStop(0, `rgba(255,200,120,${dk * 0.45})`);
        g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = g;
        ctx.fillRect(lx - 110, ly - 110, 220, 220);
      }
      for (const c of cars) {
        if (!vis(c.x, c.y, 200) || c.broken) continue;
        const fx_ = Math.cos(c.a), fy = Math.sin(c.a);
        const hx = c.x + fx_ * c.T.len * 0.5, hy = c.y + fy * c.T.len * 0.5;
        const g = ctx.createRadialGradient(hx + fx_ * 60, hy + fy * 60, 5, hx + fx_ * 60, hy + fy * 60, 90);
        g.addColorStop(0, `rgba(255,250,210,${dk * 0.55})`);
        g.addColorStop(1, 'rgba(255,250,210,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(hx + fx_ * 60, hy + fy * 60, 90, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (heli) {
      // Spotlight, then the helicopter itself.
      ctx.fillStyle = 'rgba(255,255,220,0.16)';
      ctx.beginPath(); ctx.arc(player.x, player.y, 70, 0, TAU); ctx.fill();
      Gfx.shadow(ctx, heli.x + 40, heli.y + 60, 30, 14, 0.3);
      ctx.save();
      ctx.translate(heli.x, heli.y);
      ctx.fillStyle = '#263238';
      Gfx.roundRect(ctx, -22, -11, 44, 22, 10); ctx.fill();
      ctx.fillRect(-48, -3, 30, 6);
      ctx.fillStyle = '#80deea';
      Gfx.roundRect(ctx, 6, -8, 14, 16, 6); ctx.fill();
      ctx.rotate(heli.a);
      ctx.fillStyle = 'rgba(30,30,30,0.6)';
      ctx.fillRect(-46, -2.5, 92, 5);
      ctx.fillRect(-2.5, -46, 5, 92);
      ctx.restore();
    }
    pops.draw(ctx);
    ctx.restore();
  }

  function drawArrow() {
    const tg = missionTarget() || (stars > 0 && !mission ? null : null);
    if (!tg) return;
    const sx = (tg.x - cam.x) * cam.z, sy = (tg.y - cam.y) * cam.z, m = 50;
    if (sx > m && sx < W - m && sy > m && sy < H - m) return;
    const cx = W / 2, cy = H / 2, a = Math.atan2(sy - cy, sx - cx);
    const k = Math.min((W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
    ctx.save();
    ctx.translate(cx + Math.cos(a) * k, cy + Math.sin(a) * k);
    ctx.rotate(a);
    ctx.fillStyle = tg.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-10, -13); ctx.lineTo(-4, 0); ctx.lineTo(-10, 13); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  // The minimap is the city drawn once, small; dots go on top each frame.
  const MAP_S = 0.045;
  const mapCanvas = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(WORLD * MAP_S);
    const g = c.getContext('2d');
    g.fillStyle = '#3c4148';
    g.fillRect(0, 0, c.width, c.height);
    for (const blk of allBlocks) {
      g.fillStyle = blk.kind === 'park' ? '#4e8a4b' : blk.district === 'suburb' ? '#6a8f60' : '#8b9099';
      g.fillRect(blk.x1 * MAP_S, blk.y1 * MAP_S, B * MAP_S, B * MAP_S);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (const b of blk.buildings) g.fillRect(b.x1 * MAP_S, b.y1 * MAP_S, (b.x2 - b.x1) * MAP_S, (b.y2 - b.y1) * MAP_S);
    }
    return c;
  })();
  function drawMap(big) {
    const size = big ? 460 : 150, scale = size / (WORLD * MAP_S);
    const mx = big ? (W - size) / 2 : W - size - 12, my = big ? (H - size) / 2 : H - size - 12;
    Gfx.card(ctx, mx - 5, my - 5, size + 10, size + 10, { r: 10 });
    ctx.drawImage(mapCanvas, mx, my, size, size);
    const k = MAP_S * scale;
    const dot = (x, y, c, r) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(mx + x * k, my + y * k, r, 0, TAU); ctx.fill(); };
    for (const m of markers) {
      if (big) Gfx.text(ctx, m.icon, mx + m.x * k, my + m.y * k, { size: 16, stroke: null });
      else dot(m.x, m.y, m.color, 2.5);
    }
    if (big) for (const p of packages) if (!s.pkgs.includes(p.id) && s.pkgs.length >= 10) dot(p.x, p.y, '#a1887f', 2.5);
    for (const c of cars) if (c.role === 'cop') dot(c.x, c.y, Math.floor(time * 6) % 2 ? '#ff1744' : '#2979ff', big ? 4 : 2.5);
    const tg = missionTarget();
    if (tg) dot(tg.x, tg.y, tg.color, big ? 7 : 4);
    if (mission && mission.kind === 'race') RACE.forEach((p, i) => { if (i >= mission.cp % RACE.length) dot(p.x, p.y, 'rgba(255,255,255,0.5)', 2); });
    // You: an arrow.
    ctx.save();
    ctx.translate(mx + player.x * k, my + player.y * k);
    ctx.rotate(player.car ? player.car.a : player.a);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
    if (big) Gfx.text(ctx, `📦 ${s.pkgs.length}/${packages.length} packages${s.pkgs.length >= 10 ? '' : ' (found 10 to see the rest on the map)'} · 🦘 ${s.stunts.length}/${ramps.length} stunt jumps · M to close`, W / 2, my + size + 20, { size: 13 });
  }

  function drawHud() {
    // Wanted stars: eight slots now, so the scale keeps climbing past the old five.
    const starL = W - 36 - (MAX_STARS - 1) * 22;
    for (let i = 0; i < MAX_STARS; i++) {
      const on = i < stars, flash = on && !seen && Math.floor(time * 3) % 2;
      Gfx.text(ctx, '★', starL + i * 22, 24, { size: 22, color: on ? (flash ? '#90a4ae' : i >= 5 ? '#ff7043' : '#ffd54f') : 'rgba(255,255,255,0.18)', stroke: 'rgba(0,0,0,0.6)', width: 3 });
    }
    if (stars > 0) {
      const busy = bustT > 0.2;
      Gfx.text(ctx, busy ? `BUSTED IN ${Math.max(0, 2.2 - bustT).toFixed(1)}` : seen ? 'SPOTTED' : 'HIDING…', W - 88, 54, { size: 12, color: busy ? '#ff5252' : seen ? '#ff8a80' : '#80deea' });
    }
    // Cash.
    Gfx.card(ctx, 12, 12, 190, 40);
    Gfx.text(ctx, money(s.cash), 24, 32, { size: 20, align: 'left', color: '#9be37a', stroke: null });
    // Objective.
    const obj = objectiveText();
    if (obj) {
      ctx.font = '700 14px system-ui, sans-serif';
      const w = ctx.measureText(obj).width + 30;
      Gfx.card(ctx, W / 2 - w / 2, 12, w, 32, { fill: 'rgba(20,20,30,0.82)' });
      Gfx.text(ctx, obj, W / 2, 28, { size: 14, stroke: null, color: mission ? '#fff' : '#80deea' });
    }
    // Car status.
    if (player.car) {
      const c = player.car;
      Gfx.card(ctx, 12, H - 74, 210, 62);
      Gfx.text(ctx, c.T.name, 24, H - 60, { size: 12, align: 'left', stroke: null, color: '#cfd8dc' });
      Gfx.text(ctx, `${Math.round(speedOf(c) * 0.25)} km/h`, 210, H - 60, { size: 12, align: 'right', stroke: null });
      Gfx.bar(ctx, 24, H - 48, 186, 9, c.hp / c.T.hp, c.hp / c.T.hp > 0.35 ? '#66bb6a' : '#ef5350');
      if (nitroCap()) Gfx.bar(ctx, 24, H - 33, 186, 7, player.nitro / nitroCap(), '#40c4ff');
      else Gfx.text(ctx, 'E to get out', 24, H - 28, { size: 11, align: 'left', stroke: null, color: '#90a4ae' });
    } else {
      let near = null, bd = 46;
      for (const c of cars) { const d = Math.hypot(c.x - player.x, c.y - player.y); if (d < bd && !c.broken) { bd = d; near = c; } }
      if (near) Gfx.text(ctx, `Press E to take the ${near.T.name}`, W / 2, H - 40, { size: 15 });
    }
    if (!mapOpen) drawMap(false);
    drawArrow();
    if (banner) {
      const a = clamp(banner.t / 0.4, 0, 1);
      ctx.globalAlpha = a;
      Gfx.text(ctx, banner.text, W / 2, H / 2 - 90, { size: 32, color: banner.color, width: 6 });
      if (banner.sub) Gfx.text(ctx, banner.sub, W / 2, H / 2 - 58, { size: 15, width: 4 });
      ctx.globalAlpha = 1;
    }
    if (mapOpen) drawMap(true);
    if (matchMedia('(pointer: coarse)').matches) {
      for (const b of TOUCH_BTNS) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
        Gfx.text(ctx, b.label, b.x, b.y, { size: 20 });
      }
    }
    if (joy) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(joy.sx, joy.sy, 50, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      const dx = joy.x - joy.sx, dy = joy.y - joy.sy, m = Math.hypot(dx, dy), k = m > 50 ? 50 / m : 1;
      ctx.beginPath(); ctx.arc(joy.sx + dx * k, joy.sy + dy * k, 20, 0, TAU); ctx.fill();
    }
  }

  const shown = {};
  function updateStats() {
    const vals = { cash: money(s.cash), wanted: stars ? '★'.repeat(stars) : '-', earned: money(s.lifetime) };
    for (const k in vals) if (shown[k] !== vals[k]) { $(k).textContent = vals[k]; shown[k] = vals[k]; }
  }

  // ---------- Loop and start ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (overlayEl.hidden && !mapOpen) update(dt);
    drawWorld();
    drawHud();
    updateStats();
    requestAnimationFrame(frame);
  }

  loadSave();
  spawnAtHideout();
  // Your starter car waits outside the hideout.
  makeCar(s.owned[s.owned.length - 1], hideout.x + 70, hideout.y + 75, 0, 'parked');
  cam.x = player.x - W / 2; cam.y = player.y - H / 2;
  for (let i = 0; i < 32; i++) spawnTraffic();
  setInterval(() => { if (overlayEl.hidden) persist(); }, 15000);
  addEventListener('pagehide', persist);

  const tips = `<ul>
      <li><b>WASD</b> or arrows to walk or drive. <b>E</b> gets in or out of any car. <b>Space</b> is the handbrake for drifting.</li>
      <li>Walk into a marker to start a job: <b>💼 heists</b>, <b>🚕 taxi</b> shifts, <b>🍕 pizza</b> runs and the <b>🏁 street race</b>.</li>
      <li>Heists and reckless driving bring the police. The wanted scale runs to <b>8 stars</b>: past five, riot vans join the chase. Get out of sight to lose them, lie low at the <b>🏠 Hideout</b>, or get a respray at a <b>🎨 Spray Shop</b>. Stop next to a cop for too long and you're <b>busted</b>.</li>
      <li>Hit the yellow <b>ramps</b> fast for stunt cash, and hunt for 120 hidden <b>📦 packages</b> across the bigger city. <b>M</b> shows the map.</li>
      <li>Spend your cash on cars at the <b>🚗 Dealer</b> and perks at the Hideout.</li>
    </ul>`;
  if (!s.intro) ui.show({ title: '🌆 Getaway City', html: `<p>A whole city to drive around, and plenty of ways to make money in it.</p>${tips}`, button: 'Hit the streets', onAction: () => { s.intro = true; persist(); ui.hide(); } });
  else ui.show({ title: '🌆 Getaway City', html: `<p>${money(s.cash)} in your pocket · ${s.heists} heists pulled</p>${tips}`, button: 'Hit the streets', onAction: () => ui.hide() });
  requestAnimationFrame(frame);
})();
