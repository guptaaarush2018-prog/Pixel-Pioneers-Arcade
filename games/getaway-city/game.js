/* Getaway City: an open-world city, in 3D with a chase camera or top-down (Classic view). Walk or take any car, run heists and escape the
   police, drive taxi fares and pizza runs, race checkpoints, hit stunt ramps and hunt hidden
   packages. Cash buys faster cars and perks. Progress saves; the score is lifetime earnings.
   Walk into front doors to burgle houses and hold up shops (each is its own area: the city pauses
   while you're inside), ride the subway, run courier, tow and car-boosting jobs, and follow the
   seven-chapter story from Vinnie's Diner. Guns only stop cars: nobody gets hurt, and pedestrians
   always dive out of the way. Public lobbies put up to 8 players in the same city. */
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
  const ctx2d = Arcade.setupCanvas(canvas, W, H);
  let ctx = ctx2d;            // the 2D canvas in Classic view, the HUD layer over WebGL in 3D
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
  // crack: seconds standing in the circle. alarm: stars when the alarm trips halfway through (0 =
  // silent). rest: minutes before the place can be hit again. Each heist needs the one before it.
  const HEISTS = [
    { name: 'Corner Store Safe', reward: 900, stars: 2, crack: 4, alarm: 0, rest: 4 },
    { name: 'Jewel Box Display', reward: 2500, stars: 3, crack: 6, alarm: 1, rest: 8 },
    { name: 'Gold Depot', reward: 6000, stars: 4, crack: 9, alarm: 2, rest: 12 },
    { name: 'City Bank Vault', reward: 15000, stars: 5, crack: 12, alarm: 3, rest: 20 },
    { name: 'Casino High Roller Cage', reward: 30000, stars: 6, crack: 14, alarm: 4, rest: 25 },
    { name: 'Airport Bullion Run', reward: 50000, stars: 7, crack: 16, alarm: 5, rest: 30 },
  ];
  const DROP_MIN = 1800;     // the fence's drop point is at least this far from the job

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

  // ---------- More places to go ----------
  // Added after the original city was laid out, without touching its random stream, so the
  // streets, packages and ramps stay exactly where they were (and old saves stay valid).
  const NEW_LANDMARKS = [
    ['6,8', { kind: 'guns', name: 'Bullseye Guns', color: '#8d6e63', icon: '🔫' }],
    ['10,13', { kind: 'pawn', name: 'Lucky Pawn', color: '#ab47bc', icon: '💰' }],
    ['3,9', { kind: 'courier', name: 'Swift Parcel', color: '#8bc34a', icon: '📦' }],
    ['12,5', { kind: 'tow', name: 'Hook & Haul Towing', color: '#ff9800', icon: '🛻' }],
    ['14,2', { kind: 'docks', name: 'Export Docks', color: '#29b6f6', icon: '🚢' }],
    ['7,7', { kind: 'story', name: "Vinnie's Diner", color: '#ffca28', icon: '🍝' }],
    ['12,8', { kind: 'herald', name: 'City Herald', color: '#eceff1', icon: '📰' }],
    ['2,14', { kind: 'metro', name: 'Southside Station', color: '#ec407a', icon: '🚇' }],
    ['14,10', { kind: 'metro', name: 'Eastgate Station', color: '#ec407a', icon: '🚇' }],
    ['6,0', { kind: 'metro', name: 'Northpoint Station', color: '#ec407a', icon: '🚇' }],
    ['10,6', { kind: 'metro', name: 'Central Station', color: '#ec407a', icon: '🚇' }],
    ['0,9', { kind: 'metro', name: 'Westside Station', color: '#ec407a', icon: '🚇' }],
  ];
  const NEW_COLORS = { guns: '#5d4037', pawn: '#6a1b9a', courier: '#558b2f', tow: '#e65100', docks: '#607d8b', story: '#c62828', herald: '#455a64', metro: '#ad1457' };
  for (const [key, land] of NEW_LANDMARKS) {
    const [bx, by] = key.split(',').map(Number);
    let blk = blocks[bx][by];
    // Something there already: take the nearest plain city block instead.
    if (blk.land || blk.kind !== 'city') blk = allBlocks.filter(b => !b.land && b.kind === 'city').sort((a, b) => Math.hypot(a.bx - bx, a.by - by) - Math.hypot(b.bx - bx, b.by - by))[0];
    const IN = 26;
    blk.land = land;
    blk.buildings = [makeBuilding(blk.x1 + IN, blk.y1 + IN, blk.x2 - IN, blk.y2 - 150, land.kind === 'metro' ? 34 : land.kind === 'herald' ? 120 : 56, NEW_COLORS[land.kind], land.kind === 'docks' ? 'warehouse' : 'flat')];
    blk.trees = [];
    blk.forecourt = true;
    markers.push({ ...land, x: (blk.x1 + blk.x2) / 2, y: blk.y2 - 60, blk });
  }
  // A package that ended up inside a new building moves out to its forecourt.
  for (const p of packages) if (inBuilding(p.x, p.y, 4)) p.y = blockAt(p.x, p.y).y2 - 14;
  const stations = markers.filter(m => m.kind === 'metro');

  // Doors: every suburb house can be burgled, and some midtown shops can be held up. Walking into
  // a door takes you inside (a separate area: the city stops while you're in there).
  const SHOP_NAMES = ['Quik Stop', 'Snack Shack', 'Gadget Hut', 'Donut Den', 'Corner Deli', 'Gas & Go', 'Pop Shop', 'Mini Mart'];
  const doors = [];
  {
    const drng = Gfx.rng(20261125);      // a stream of its own, so the city's stays untouched
    for (const blk of allBlocks) {
      if (blk.land) continue;
      for (const b of blk.buildings) {
        const x = (b.x1 + b.x2) / 2, y = b.y2 + 7;
        if (inBuilding(x, y, 4)) continue;
        if (b.style === 'house') doors.push({ id: doors.length, kind: 'house', x, y, name: 'House' });
        else if ((b.style === 'flat' || b.style === 'garden') && blk.district === 'midtown' && b.y2 > blk.y2 - 40 && drng() < 0.3) {
          doors.push({ id: doors.length, kind: 'shop', x, y, name: SHOP_NAMES[Math.floor(drng() * SHOP_NAMES.length)] });
        }
      }
    }
  }
  // Detective Kane's house, for the story: the one farthest from the hideout.
  const kaneDoor = doors.filter(d => d.kind === 'house').sort((a, b) => dist(b, hideout) - dist(a, hideout))[0];
  if (kaneDoor) { kaneDoor.kane = true; kaneDoor.name = "Kane's house"; }

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
    tow: { name: 'Tow Truck', price: 0, accel: 300, max: 360, grip: 8, turn: 2.3, hp: 260, mass: 2.4, len: 54, wid: 25, colors: ['#ff9800'], hidden: true },
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
    return { cash: 200, lifetime: 0, owned: ['compact'], perks: { engine: 0, armor: 0, nitro: 0, scanner: 0 }, heists: 0, heistDone: [0, 0, 0, 0, 0, 0], heistNext: [0, 0, 0, 0, 0, 0], raceMedal: 3,
      fares: 0, bestFares: 0, deliveries: 0, raceBest: 0, medal: 0, pkgs: [], stunts: [], intro: false, maxStars: 0, map: N,
      bag: [], guns: {}, gun: null, story: 0, robbed: {}, items: [], holdups: 0, burgles: 0, copsDown: 0, boosts: 0, tows: 0, couriers: 0 };
  }
  function loadSave() {
    const raw = Arcade.load(SAVE_KEY, null);
    // The city grew: packages and ramps moved, so an old save starts those collections again.
    if (raw && raw.map !== N) { raw.pkgs = []; raw.stunts = []; }
    s = raw ? { ...fresh(), ...raw, perks: { ...fresh().perks, ...(raw.perks || {}) } } : fresh();
    if (!Array.isArray(s.heistNext)) s.heistNext = [0, 0, 0, 0, 0, 0];
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
    player.a = Math.PI / 2;      // facing the street
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
      if (view3d ? dp < 950 || dp > 1450 : dp < 640 || dp > 1300) continue;
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
      if (d < (view3d ? 850 : near) || d > 1300) continue;
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
      if (dp < (view3d ? 750 : 560) || dp > 1100) continue;
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
    const T = car.T, mul = car === player.car ? engineMul() : car.role === 'cop' ? 1 + stars * 0.055 : 1;
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
    const first = !s.stunts.includes(st.id);
    const pay = Math.round((far * 1.2 + air * 300) * (first ? 1 : 0.1));
    earn(pay, car.x, car.y - 40, first ? 'New stunt!' : 'Stunt');
    say(`STUNT JUMP · ${Math.round(far / 10)} m`, first ? `${air.toFixed(1)} s of air` : 'Already landed this one: find a new ramp for full pay', 1.8, '#ffd54f');
    if (first) {
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
      mission = { kind: 'heist', h, idx: m.heist, stage: 'crack', crack: 0, alarmed: false, target: m, label: h.name };
      say(h.name, `Stay in the red circle to crack it (${h.crack} s)${h.alarm ? ' · the alarm trips halfway' : ''}`, 2.6, '#ff8a80');
    } else if (m.kind === 'taxi') {
      mission = { kind: 'taxi', needsCar: true, fares: 0, earned: 0, label: 'Taxi shift' };
      nextFare();
    } else if (m.kind === 'pizza') {
      const drops = [];
      let from = m;
      for (let k = 0; k < 4; k++) { const p = randomSidewalk(350, 1000, from); drops.push(p); from = p; }
      mission = { kind: 'pizza', needsCar: true, drops, done: 0, timer: 100, label: 'Pizza run', earned: 0 };
      say('Pizza run!', '4 deliveries in 100 seconds', 2.4, '#ffab91');
    } else if (JOB_INFO[m.kind]) {
      startJob(m);
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
    if (m.kind === 'duel') return updateDuel(dt);
    if (m.kind === 'story') return updateStory();
    const pc = player.car, here = pc || player, slow = !pc || speedOf(pc) < 70;
    if (m.needsCar && !pc) return failMission('You need a car');
    if (m.kind === 'courier' || m.kind === 'tow' || m.kind === 'boost') return updateJob(dt);
    if (m.kind === 'heist') {
      if (m.stage === 'crack') {
        const d = Math.hypot(here.x - m.target.x, here.y - m.target.y);
        if (d < 46 && slow) {
          m.crack += dt;
          if (Gfx.rand() < dt * 10) Arcade.tone({ freq: 1200 + m.crack * 100, dur: 0.03, type: 'square', vol: 0.02 });
          if (m.h.alarm && !m.alarmed && m.crack >= m.h.crack / 2) {
            m.alarmed = true;
            addStars(m.h.alarm, 'ALARM!');
            say('The alarm went off!', 'Keep cracking: the cops are on their way', 2.2, '#ff5252');
            for (let k = 0; k < m.h.alarm; k++) spawnCop();
          }
          if (m.crack >= m.h.crack) {
            m.stage = 'escape';
            m.drop = randomSidewalk(DROP_MIN, 3400, m.target);
            s.heistNext[m.idx] = Date.now() + m.h.rest * 60000;
            addStars(m.h.stars);
            say('Got the loot!', 'Lose every cop, then meet the fence at the drop point', 3, '#ffd54f');
            sfx.good();
            for (let k = 0; k < m.h.stars * 2; k++) spawnCop();
          }
        } else m.crack = Math.max(0, m.crack - dt * 0.5);
      } else if (Math.hypot(here.x - m.drop.x, here.y - m.drop.y) < 50 && slow) {
        if (stars > 0) {
          if (!m.warned) { say('The fence won\'t show with cops after you', 'Lose your wanted level first', 2.2, '#ff8a80'); m.warned = true; }
        } else {
          earn(m.h.reward, m.drop.x, m.drop.y - 50, m.h.name);
          s.heists++;
          s.heistDone[m.idx] = (s.heistDone[m.idx] || 0) + 1;
          Arcade.flag('getaway-heist');
          if (m.idx === 3) Arcade.flag('getaway-bank');
          say('Heist complete!', `The fence paid ${money(m.h.reward)}`, 3, '#9be37a');
          sfx.good();
          mission = null;
          persist();
        }
      } else if (m.warned) m.warned = false;
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
          const rank = medal >= 0 ? medal : 3, better = rank < (s.raceMedal ?? 3);
          const pay = Math.round((medal >= 0 ? [1200, 700, 350][medal] : 120) * (better ? 1 : 0.2));
          if (better) s.raceMedal = rank;
          earn(pay, pc.x, pc.y - 40, medal >= 0 ? names[medal] + (better ? ' (new best)' : '') : 'Finished');
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
    if (m.kind === 'heist') return m.stage === 'crack' ? { x: m.target.x, y: m.target.y, color: '#ff5252' } : { x: m.drop.x, y: m.drop.y, color: '#b388ff' };
    if (m.kind === 'taxi') return { ...(m.stage === 'pickup' ? m.pick : m.drop), color: '#fdd835' };
    if (m.kind === 'pizza') return { ...m.drops[m.done], color: '#ff7043' };
    if (m.kind === 'race') return { ...RACE[m.cp % RACE.length], color: '#ffffff' };
    if (m.kind === 'duel') return { ...m.dest, color: '#69f0ae' };
    if (m.kind === 'story') return storyTarget();
    return jobTarget();
  }
  function objectiveText() {
    const m = mission;
    if (!m) return stars ? 'Lose the cops: get out of sight, or hit a 🎨 Spray Shop' : '';
    if (m.kind === 'heist') return m.stage === 'crack' ? `Crack the ${m.h.name}: stay in the circle` : stars ? `Lose the cops (${'★'.repeat(stars)}), then get the loot to the drop` : 'Get the loot to the purple drop point';
    if (m.kind === 'taxi') return `${m.stage === 'pickup' ? 'Pick up the passenger' : 'Drop them off'} · ${Math.ceil(m.timer)} s · fares ${m.fares}`;
    if (m.kind === 'pizza') return `Deliver pizza ${m.done + 1}/${m.drops.length} · ${Math.ceil(m.timer)} s`;
    if (m.kind === 'race') return m.countdown > 0 ? `Get ready… ${Math.ceil(m.countdown)}` : `Checkpoint ${m.cp}/${RACE.length} · ${m.t.toFixed(1)} s`;
    if (m.kind === 'story') return storyText();
    if (m.kind === 'courier' || m.kind === 'tow' || m.kind === 'boost') return jobText();
    if (m.kind === 'duel') {
      if (m.countdown > 0) return `Race vs ${live.them} · ${Math.ceil(m.countdown)}…`;
      const mine = Math.hypot((player.car || player).x - m.dest.x, (player.car || player).y - m.dest.y), theirs = Math.hypot(friend.x - m.dest.x, friend.y - m.dest.y);
      return `Race vs ${live.them} · ${m.t.toFixed(1)} s · ${mine <= theirs ? 'you lead' : 'they lead'} by ${Math.round(Math.abs(mine - theirs) / 10)} m`;
    }
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
        <p style="font-size:12px;color:var(--muted)">Buy more cars at the 🚗 Car Dealer.</p>`,
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
        const h = HEISTS[m.heist], prev = HEISTS[m.heist - 1], locked = prev && !s.heistDone[m.heist - 1];
        const wait = (s.heistNext[m.heist] || 0) - Date.now();
        if (locked) return { title: `💼 ${h.name}`, html: `<p>Pull off the ${prev.name} first to be trusted with this one.</p>`, ok: false };
        if (wait > 0) return { title: `💼 ${h.name}`, html: `<p>Security is still on high alert after your last visit. Come back in <b>${Math.floor(Math.ceil(wait / 1000) / 60)}:${String(Math.ceil(wait / 1000) % 60).padStart(2, '0')}</b>.</p>`, ok: false };
        return { title: `💼 ${h.name}`, html: `<p>Stand in the circle for ${h.crack} seconds to crack it${h.alarm ? `; the alarm trips halfway and brings <b>${'★'.repeat(h.alarm)}</b>` : ''}. Then escape <b>${'★'.repeat(h.stars)}</b>, lose every cop, and meet the fence at a drop point across town.</p><p class="gc-cash">${money(h.reward)}</p>`, ok: true };
      },
      taxi: () => ({ title: '🚕 Taxi shift', html: '<p>Pick up passengers and drive them across town before the meter runs out. Fast, careful driving earns tips. The shift goes on until you miss one.</p>', ok: true }),
      pizza: () => ({ title: '🍕 Pizza run', html: '<p>Four hot pizzas, 100 seconds. Every second left over is a bonus.</p>', ok: true }),
      race: () => ({ title: '🏁 Street race', html: `<p>${RACE.length} checkpoints around the city. Beat ${RACE_MEDALS[0].toFixed(0)} s for gold.${s.raceBest ? ` Your best: ${s.raceBest.toFixed(2)} s.` : ''}</p>`, ok: true }),
      ...JOB_INFO,
    }[m.kind]();
    const needCar = m.kind !== 'heist' && !info.noCar && !player.car;
    ui.show({
      title: info.title,
      html: info.html + (needCar ? '<p style="color:#ff8a80">You need a car for this one.</p>' : '') + (mission ? '<p style="color:#ff8a80">Finish your current job first.</p>' : ''),
      button: info.ok && !needCar && !mission ? 'Start' : 'OK',
      onAction: () => { ui.hide(); if (info.ok && !needCar && !mission) startMission(m); },
    });
  }

  function busted() {
    const fine = Math.min(10000, Math.round(s.cash * 0.15));
    s.cash -= fine;
    if (player.car) { player.car.role = 'parked'; player.car = null; }
    const lostLoot = mission && mission.kind === 'heist' && mission.stage === 'escape';
    const lostBag = (s.bag || []).length > 0;
    s.bag = [];
    if (mission && mission.kind === 'story') for (const st of mission.steps) if (st.carRef) st.carRef.keep = false;
    if (mission && (mission.kind === 'boost' || mission.kind === 'tow')) { if (mission.target) mission.target.keep = false; if (mission.truck) mission.truck.keep = false; }
    if (mission) { mission = null; }
    clearStars(null);
    for (let i = cars.length - 1; i >= 0; i--) if (cars[i].role === 'leaving') cars.splice(i, 1);
    player.x = policeHQ.x;
    player.y = policeHQ.y + 50;
    sfx.bad();
    persist();
    ui.show({ title: '🚔 Busted!', html: `<p>The police caught you. You paid a ${money(fine)} fine${lostLoot ? ' and the loot was taken' : ''}${lostBag ? '. They emptied your bag, too' : ''}.</p>`, button: 'Back to the streets', onAction: () => ui.hide() });
  }

  // ---------- Input ----------

  const keys = new Set();
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (!overlayEl.hidden) return;
    if (e.code === 'Space') e.preventDefault();
    if (area) { if (e.code === 'KeyP' || e.code === 'Escape') pause(); return; }
    if (e.code === 'KeyQ') switchGun();
    if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Enter') {
      if (player.car) exitCar(false); else enterNearest();
    }
    if (e.code === 'KeyM') mapOpen = !mapOpen;
    if (e.code === 'KeyV') toggleView();
    if (e.code === 'KeyH' && player.car) { sfx.horn(); player.car.honk = 0.3; }
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const held = (...codes) => codes.some(c => keys.has(c));

  // Touch: drag anywhere to steer (and drive toward the drag); tap the buttons in the corner.
  let joy = null;
  const toCanvas = e => { const r = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  const TOUCH_BTNS = [{ id: 'enter', x: W - 70, y: H - 150, r: 32, label: 'E' }, { id: 'brake', x: W - 150, y: H - 70, r: 32, label: '⏸' }];
  let touchBrake = false;
  const onDown = e => {
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
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onMove = e => { if (joy && joy.id === e.pointerId) { const p = toCanvas(e); joy.x = p.x; joy.y = p.y; } };
  const endPtr = e => { if (joy && joy.id === e.pointerId) joy = null; if (touchBrake === e.pointerId) touchBrake = false; };
  for (const el of [canvas, document.getElementById('game3d')]) {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', endPtr);
    el.addEventListener('pointercancel', endPtr);
  }

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
    ui.show({ title: 'Paused', html: `<p>${money(s.cash)} · lifetime ${money(s.lifetime)}</p>${live.on ? '<p class="muted-note">Your friend keeps playing while you\'re paused.</p>' : ''}${onlineHtml()}`, button: 'Resume', onAction: () => ui.hide(), onRender: p => { viewButton(p, () => { ui.hide(); pause(); }); wireOnline(p, () => { ui.hide(); pause(); }); } });
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
      if (c.stick && view3d) {
        // Touch in 3D: the stick is a wheel and pedals (up to drive, sideways to steer).
        steer = clamp(c.stick.x * 1.5, -1, 1);
        throttle = -c.stick.y * c.stick.m;
      } else if (c.stick) {
        // Touch: point the stick where you want to go.
        const want = Math.atan2(c.stick.y, c.stick.x), d = angDiff(want, car.a);
        steer = clamp(d * 2, -1, 1);
        throttle = Math.abs(d) > 2.4 ? -c.stick.m : c.stick.m;
      }
      drive(car, throttle, steer, c.brake, c.boost, dt);
      if (!c.boost && player.nitro < nitroCap()) player.nitro = Math.min(nitroCap(), player.nitro + dt * 0.25);
      player.x = car.x; player.y = car.y;
    } else if (view3d) {
      // On foot in 3D: turn with left/right, walk with up/down; the camera follows behind.
      let turn = c.x, move = -c.y;
      if (c.stick) { turn = c.stick.x * c.stick.m; move = -c.stick.y * c.stick.m; }
      player.a += turn * 3.2 * dt;
      const sp = (c.boost ? 210 : 130) * (move < 0 ? 0.6 : 1) * move;
      player.vx = Math.cos(player.a) * sp;
      player.vy = Math.sin(player.a) * sp;
      if (move || turn) player.walk += dt * (c.boost ? 14 : 9);
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      collideWorld(player, o => [[o.x, o.y]], 8);
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
      if (c.keep) continue;
      if ((d > (view3d ? 1700 : 1500) && !keepOwned) || (c.role === 'leaving' && d > 700) || (c.role === 'wreck' && d > 1000)) cars.splice(i, 1);
    }
    const traffic = cars.filter(c => c.role === 'traffic').length;
    if (traffic < (view3d ? 34 : 44)) spawnTraffic();
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
    // Front doors (on foot): in you go.
    doorCool = Math.max(0, doorCool - 1 / 60);
    if (!player.car && doorCool <= 0) {
      // The door you just came out of (or were turned away from) waits until you've walked off.
      if (lastDoor && Math.hypot(lastDoor.x - player.x, lastDoor.y - player.y) > 40) lastDoor = null;
      for (const d of doors) if (d !== lastDoor && Math.abs(d.x - player.x) < 14 && Math.abs(d.y - player.y) < 12) { lastDoor = d; enterArea(d); doorCool = 1; break; }
    }
    // Markers.
    let on = null;
    for (const m of markers) if (Math.hypot(m.x - here.x, m.y - here.y) < 40 && (!player.car || speedOf(player.car) < 120)) on = m;
    if (on && on !== inMarker) {
      if (on.kind === 'hideout') {
        if (stars > 0) say('Not with cops on your tail!', 'Lose them first: the hideout stays secret', 2, '#ff8a80');
        else if (!mission) { if (player.car) player.car.vx = player.car.vy = 0; hideoutPanel(); }
      } else if (on.kind === 'paint') {
        if (stars > 0 && player.car && seen) say('They saw you pull in!', 'Get out of sight before a respray', 2, '#ff8a80');
        else if (stars > 0 && player.car) {
          const cost = 400 * stars;
          if (s.cash >= cost) {
            s.cash -= cost;
            player.car.color = Arcade.pick(['#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292']);
            player.car.hp = player.car.T.hp;
            clearStars(`Fresh paint! (−${money(cost)})`);
          } else say('Not enough cash for a respray', `${money(cost)} needed`, 2, '#ff8a80');
        } else if (stars > 0) say('Bring a car to respray', '', 1.6, '#80deea');
        else if (player.car && player.car.hp < player.car.T.hp) { player.car.hp = player.car.T.hp; say('Car fixed up', 'Free when you are not wanted', 1.6, '#80deea'); }
      } else if (on.kind === 'dealer') { if (player.car) player.car.vx = player.car.vy = 0; dealerPanel(); }
      else if (on.kind === 'police' || on.kind === 'herald') { /* nothing to do here */ }
      else if (on.kind === 'guns') { if (player.car) player.car.vx = player.car.vy = 0; gunPanel(); }
      else if (on.kind === 'pawn') { if (player.car) player.car.vx = player.car.vy = 0; pawnPanel(); }
      else if (on.kind === 'metro') { if (player.car) player.car.vx = player.car.vy = 0; metroPanel(on); }
      else if (on.kind === 'story') { if (!mission) { if (player.car) player.car.vx = player.car.vy = 0; storyPanel(); } }
      else if (!mission || mission.kind === 'heist') { if (player.car) player.car.vx = player.car.vy = 0; if (!(mission && mission.target === on)) missionPanel(on); }
    }
    inMarker = on;
  }

  let saveT = 0, doorCool = 0, lastDoor = null;
  function update(dt) {
    time += dt;
    dayT = (dayT + dt / 480) % 1;
    if (area) {
      // Inside: the city waits. Only you, the room and the people online move.
      updateArea(dt);
      updateOnline(dt);
      if (mission && mission.kind === 'story') updateStory();
      pops.update(dt);
      if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      return;
    }
    updatePlayer(dt);
    updateGun(dt);
    updateOnline(dt);
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

  // A front door you can walk into: a small mat and an icon, brighter when it's on a story job.
  function drawDoor(d) {
    const st = storyStep(), hot = st && st.t === 'burgle' && st.door === d, closed = ((s.robbed || {})[(d.kind === 'shop' ? 's' : 'h') + d.id] || 0) > Date.now();
    ctx.fillStyle = closed ? 'rgba(80,80,80,0.5)' : hot ? '#ffd54f' : d.kind === 'shop' ? '#4fc3f7' : '#ffb74d';
    ctx.globalAlpha = hot ? 0.6 + 0.4 * Math.sin(time * 6) : 0.85;
    Gfx.roundRect(ctx, d.x - 11, d.y - 6, 22, 12, 3); ctx.fill();
    ctx.globalAlpha = 1;
    Gfx.text(ctx, d.kind === 'shop' ? '🏪' : d.kane ? '🕵️' : '🚪', d.x, d.y - 14, { size: 12, stroke: null });
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
    for (const d of doors) if (vis(d.x, d.y, 20) && Math.hypot(d.x - player.x, d.y - player.y) < 500) drawDoor(d);
    // People, cars and trees.
    for (const p of peds) if (vis(p.x, p.y)) drawPerson(p.x, p.y, p.a || 0, p.color, p.skin, p.step, p.dive > 0);
    if (!player.car) { drawPerson(player.x, player.y, player.a, '#7c4dff', '#ffe0bd', player.walk, false); if (s.gun) drawGunInHand(player.x, player.y, player.a); }
    const air = [];
    for (const c of cars) { if (!vis(c.x, c.y)) continue; if (c.z > 2) air.push(c); else drawCar(c); }
    for (const f of others()) if (vis(f.x, f.y)) drawPuppet2d(f);
    fx.draw(ctx);
    drawTracers2d();
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
    for (const f of others()) dot(f.x, f.y, f.tagColor, big ? 6 : 3.5);
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
    if ((s.bag || []).length || s.gun) {
      Gfx.card(ctx, 12, 58, 190, 26);
      Gfx.text(ctx, `${(s.bag || []).length ? `🎒 ${money(bagValue())}` : ''}${(s.bag || []).length && s.gun ? ' · ' : ''}${s.gun ? `🔫 ${GUNS[s.gun].name} ${s.guns[s.gun]}` : ''}`, 22, 71, { size: 12, align: 'left', stroke: null, color: '#ffe0b2' });
    }
    if (mission && mission.kind === 'heist' && mission.stage === 'crack' && mission.crack > 0) Gfx.bar(ctx, W / 2 - 90, 50, 180, 8, mission.crack / mission.h.crack, '#ffd54f');
    if (view3d) { if (!mapOpen) drawRadar(); drawArrows3d(); }
    else { if (!mapOpen) drawMap(false); drawArrow(); friendArrow2d(); }
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

  // ---------- 3D view ----------
  // The same city and the same simulation, drawn in WebGL behind a chase camera. The 2D world's
  // (x, y) is the 3D world's (x, z), with y pointing up; one unit is about 10 cm. Classic (the
  // top-down drawing above) is the fallback when WebGL is missing or too slow, and V switches.

  const glWrap = $('glwrap'), glCanvas = $('game3d'), hudCanvas = $('hud');
  const VIEW_KEY = 'getaway:view';
  let viewPref = Arcade.load(VIEW_KEY, 'auto');      // auto · 3d · classic · auto-classic (fell back for speed)
  let view3d = false, G3 = null, city3d = null;
  const HS = 1.6, CURB = 1.5;                         // building height stretch, sidewalk height
  const hex = h => GL3D.hex(h);
  const M4 = typeof GL3D !== 'undefined' ? GL3D.mat4 : null;
  const model = M4 ? M4.create() : null, PV = M4 ? M4.create() : null;
  const mulCol = (c, k) => c.map(v => v * k);

  function init3d() {
    if (G3 !== null) return !!G3;
    if (typeof GL3D === 'undefined') { G3 = false; return false; }
    try {
      G3 = GL3D.setup(glCanvas, hudCanvas, W, H) || false;
      if (G3) buildCity3d();
    } catch (e) {
      console.error(e);
      G3 = false;
    }
    return !!G3;
  }
  function setView(want3d, save) {
    if (want3d && !init3d()) want3d = false;
    view3d = want3d;
    canvas.hidden = want3d;
    glWrap.hidden = !want3d;
    ctx = want3d ? G3.hud : ctx2d;
    cam3.ready = false;
    if (save) { viewPref = want3d ? '3d' : 'classic'; Arcade.save(VIEW_KEY, viewPref); }
  }
  function toggleView() {
    if (!view3d && !init3d()) { say('3D view unavailable', 'This browser has WebGL turned off', 2.4, '#ff8a80'); return; }
    setView(!view3d, true);
    say(view3d ? '3D view' : 'Classic view', 'Press V to switch', 1.4, '#80deea');
  }
  function viewButton(panel, reshow) {
    if (G3 === false) return;
    panel.insertAdjacentHTML('beforeend', `<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-view>${view3d ? 'Switch to Classic (top-down) view' : 'Switch to 3D view'}</button></div>`);
    panel.querySelector('[data-view]').addEventListener('click', () => {
      if (!view3d && !init3d()) return;
      setView(!view3d, true);
      reshow();
    });
  }

  // Slow computers: if the first few seconds of 3D run under 24 fps, drop to Classic once.
  const perf = { warm: 0, t: 0, n: 0, done: false };
  function checkSpeed(raw) {
    if (perf.done || viewPref !== 'auto' || !overlayEl.hidden || raw > 0.5) return;
    if ((perf.warm += raw) < 2) return;
    perf.t += raw;
    perf.n++;
    if (perf.t < 6) return;
    perf.done = true;
    if (perf.n / perf.t < 24) {
      setView(false, false);
      viewPref = 'auto-classic';
      Arcade.save(VIEW_KEY, viewPref);
      say('Switched to Classic view', '3D was running slowly here. Press V to try it again.', 4, '#80deea');
    }
  }

  // ---------- 3D geometry helpers ----------

  // A convex polygon as a triangle fan, wound so its front faces along n.
  function poly(out, pts, col, n, glow = false) {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    const p = d < 0 ? [...pts].reverse() : pts;
    const r = col[0] + (glow ? 2 : 0);
    for (let i = 1; i < p.length - 1; i++) for (const q of [p[0], p[i], p[i + 1]]) out.push(q[0], q[1], q[2], r, col[1], col[2], -1, -1);
  }
  const flat = (out, x0, z0, x1, z1, y, col, glow = false) => GL3D.box(out, x0, y, z0, x1, y, z1, col, { skip: 'bewsn', glow });
  // Big flat areas are cut into tiles: fog is worked out per vertex, so one huge quad would come
  // out fogged all over.
  function tiled(out, x0, z0, x1, z1, y, col, step) {
    for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) flat(out, x, z, Math.min(x1, x + step), Math.min(z1, z + step), y, col);
  }
  const ring = (n, r, cx, cz, y) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * TAU) * r, y, cz + Math.sin(i / n * TAU) * r]);
  // A flat rectangle on the ground, turned to angle a; tex gives it 0..1 texture coordinates.
  function rect3(out, x, z, y, hl, hw, a, col, tex = false) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (l, w) => [x + ca * l - sa * w, z + sa * l + ca * w];
    const pts = [P(-hl, -hw), P(-hl, hw), P(hl, hw), P(hl, -hw)], uv = [[0, 0], [0, 1], [1, 1], [1, 0]];
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(pts[i][0], y, pts[i][1], col[0] + 2, col[1], col[2], tex ? uv[i][0] : -1, tex ? uv[i][1] : -1);
  }
  // An open tube from (a, ra) to (b, rb): beacons and the helicopter's spotlight.
  function tube(out, ax, ay, az, ra, bx, by, bz, rb, col, n = 12) {
    for (let i = 0; i < n; i++) {
      const c0 = Math.cos(i / n * TAU), s0 = Math.sin(i / n * TAU), c1 = Math.cos((i + 1) / n * TAU), s1 = Math.sin((i + 1) / n * TAU);
      const p = [[ax + c0 * ra, ay, az + s0 * ra], [ax + c1 * ra, ay, az + s1 * ra], [bx + c1 * rb, by, bz + s1 * rb], [bx + c0 * rb, by, bz + s0 * rb]];
      for (const k of [0, 1, 2, 0, 2, 3]) out.push(p[k][0], p[k][1], p[k][2], col[0] + 2, col[1], col[2], -1, -1);
    }
  }
  // A flat ring on the ground (marker outlines).
  function flatRing(out, x, z, y, r0, r1, col, n = 20) {
    for (let i = 0; i < n; i++) {
      const c0 = Math.cos(i / n * TAU), s0 = Math.sin(i / n * TAU), c1 = Math.cos((i + 1) / n * TAU), s1 = Math.sin((i + 1) / n * TAU);
      poly(out, [[x + c0 * r0, y, z + s0 * r0], [x + c1 * r0, y, z + s1 * r0], [x + c1 * r1, y, z + s1 * r1], [x + c0 * r1, y, z + s0 * r1]], col, [0, 1, 0], true);
    }
  }
  const groundAt = (x, y) => { const b = blockAt(x, y); return b && x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2 ? CURB : 0; };
  const solidAt = (x, y) => { const b = blockAt(x, y); return !!b && b.buildings.some(q => x > q.x1 - 3 && x < q.x2 + 3 && y > q.y1 - 3 && y < q.y2 + 3); };

  // Rows of windows on one wall of a building: one quad with a repeating window texture, set just
  // off the wall. Its texels are see-through between panes, so the wall shows there. The quad is
  // marked as glowing so lit windows shine at night; by day it is tinted to look like glass.
  const WIN_CELLS = 8;
  function windows(out, x0, z0, x1, z1, y0, y1, face, cw, ch, seed) {
    if (y1 - y0 < ch * 0.7) return;
    const o = 0.5, off = (seed % WIN_CELLS) / WIN_CELLS;
    const pts = {
      s: [[x0, y0, z1 + o], [x1, y0, z1 + o], [x1, y1, z1 + o], [x0, y1, z1 + o]],
      n: [[x0, y0, z0 - o], [x0, y1, z0 - o], [x1, y1, z0 - o], [x1, y0, z0 - o]],
      e: [[x1 + o, y0, z0], [x1 + o, y1, z0], [x1 + o, y1, z1], [x1 + o, y0, z1]],
      w: [[x0 - o, y0, z0], [x0 - o, y0, z1], [x0 - o, y1, z1], [x0 - o, y1, z0]],
    }[face];
    const ns = face === 'n' || face === 's';
    const uv = ([x, y, z]) => [off + (ns ? x - x0 : z - z0) / cw / WIN_CELLS, (Math.floor(seed / 8) % WIN_CELLS) / WIN_CELLS + (y1 - y) / ch / WIN_CELLS];
    for (const i of [0, 1, 2, 0, 2, 3]) { const p = pts[i], [u, v] = uv(p); out.push(p[0], p[1], p[2], 3, 1, 1, u, v); }
  }
  function windowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 16 * WIN_CELLS;
    const g = c.getContext('2d'), r = Gfx.rng(77);
    for (let i = 0; i < WIN_CELLS; i++) for (let j = 0; j < WIN_CELLS; j++) {
      const lit = r() < 0.45;
      g.fillStyle = lit ? (r() < 0.7 ? '#ffe39a' : '#fff6dc') : '#3e4c63';
      g.fillRect(i * 16 + 3, j * 16 + 3, 10, 10);
      g.fillStyle = lit ? 'rgba(255,190,90,0.6)' : 'rgba(120,150,190,0.5)';
      g.fillRect(i * 16 + 3, j * 16 + 8, 10, 1);
    }
    return c;
  }
  // A soft white spot on black: light pools (added on) and soft shadows (multiplied in).
  function spotTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 64);
    const rg = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    rg.addColorStop(0, '#fff'); rg.addColorStop(0.5, '#888'); rg.addColorStop(1, '#000');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  // ---------- The city mesh (built once) ----------

  function building3d(out, night, b, land) {
    const x0 = b.x1, z0 = b.y1, x1 = b.x2, z1 = b.y2, base = CURB, top = CURB + b.h * HS;
    const col = hex(b.color), r = Gfx.rng(Math.round(b.x1 * 7 + b.y1 * 13) || 1);
    const seed = Math.floor(r() * 4096);
    const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
    const allWin = (ya, yb, cw, ch, bx0 = x0, bz0 = z0, bx1 = x1, bz1 = z1) => {
      let k = 0;
      for (const f of 'nsew') windows(night, bx0, bz0, bx1, bz1, ya, yb, f, cw, ch, seed + 37 * k++);
    };
    if (b.style === 'house') {
      const wallTop = base + b.h * HS * 0.62, roof = mulCol(col, 0.55), ov = 3;
      GL3D.box(out, x0, base, z0, x1, wallTop, z1, col, { skip: 'bt' });
      if (x1 - x0 >= z1 - z0) {
        poly(out, [[x0 - ov, wallTop, z0 - ov], [x1 + ov, wallTop, z0 - ov], [x1 + ov, top, zm], [x0 - ov, top, zm]], mulCol(roof, 0.82), [0, 1, -1]);
        poly(out, [[x0 - ov, wallTop, z1 + ov], [x1 + ov, wallTop, z1 + ov], [x1 + ov, top, zm], [x0 - ov, top, zm]], roof, [0, 1, 1]);
        poly(out, [[x0, wallTop, z0], [x0, wallTop, z1], [x0, top, zm]], mulCol(col, 0.74), [-1, 0, 0]);
        poly(out, [[x1, wallTop, z0], [x1, wallTop, z1], [x1, top, zm]], mulCol(col, 0.8), [1, 0, 0]);
      } else {
        poly(out, [[x0 - ov, wallTop, z0 - ov], [x0 - ov, wallTop, z1 + ov], [xm, top, z1 + ov], [xm, top, z0 - ov]], mulCol(roof, 0.82), [-1, 1, 0]);
        poly(out, [[x1 + ov, wallTop, z0 - ov], [x1 + ov, wallTop, z1 + ov], [xm, top, z1 + ov], [xm, top, z0 - ov]], roof, [1, 1, 0]);
        poly(out, [[x0, wallTop, z0], [x1, wallTop, z0], [xm, top, z0]], mulCol(col, 0.64), [0, 0, -1]);
        poly(out, [[x0, wallTop, z1], [x1, wallTop, z1], [xm, top, z1]], mulCol(col, 0.7), [0, 0, 1]);
      }
      // Chimney, door and a row of windows.
      GL3D.box(out, x0 + (x1 - x0) * 0.7, top - 14, z0 + (z1 - z0) * 0.3, x0 + (x1 - x0) * 0.7 + 7, top + 6, z0 + (z1 - z0) * 0.3 + 7, hex('#8d6e63'), { skip: 'b' });
      GL3D.box(out, xm - 5, base, z1, xm + 5, base + 17, z1 + 0.7, hex('#5d4037'), { skip: 'b' });
      allWin(base + 8, wallTop - 4, 18, wallTop - base - 12);
      return;
    }
    GL3D.box(out, x0, base, z0, x1, top, z1, col, { skip: 'b' });
    if (b.style === 'warehouse' || b.style === 'shed') {
      for (let x = x0 + 8; x < x1 - 4; x += 14) GL3D.box(out, x, top, z0, x + 3, top + 1.5, z1, mulCol(col, 0.82), { skip: 'b' });
      GL3D.box(out, xm - 18, base, z1, xm + 18, base + Math.min(30, top - base - 6), z1 + 0.6, mulCol(col, 0.55), { skip: 'b' });
      for (let x = xm - 16; x < xm + 16; x += 4) GL3D.box(out, x, base + 1, z1 + 0.6, x + 0.8, base + Math.min(30, top - base - 6) - 1, z1 + 0.9, mulCol(col, 0.45), { skip: 'b' });
      if (b.style === 'warehouse') for (const f of 'ns') windows(night, x0 + 10, z0, x1 - 10, z1, top - 13, top - 4, f, 22, 9, seed + f.charCodeAt(0));
      return;
    }
    // Offices and apartments: windows, a rim round the roof, and something on the roof.
    allWin(base + 12, top - 7, 20, 24);
    const rim = mulCol(col, 0.72), t = 2.5;
    GL3D.box(out, x0 - 1, top, z0 - 1, x1 + 1, top + 3, z0 + t, rim, { skip: 'b' });
    GL3D.box(out, x0 - 1, top, z1 - t, x1 + 1, top + 3, z1 + 1, rim, { skip: 'b' });
    GL3D.box(out, x0 - 1, top, z0 + t, x0 + t, top + 3, z1 - t, rim, { skip: 'bns' });
    GL3D.box(out, x1 - t, top, z0 + t, x1 + 1, top + 3, z1 - t, rim, { skip: 'bns' });
    const w = x1 - x0, d = z1 - z0;
    if (b.style === 'helipad') {
      const rad = Math.min(w, d) * 0.3;
      flat(out, xm - rad, zm - rad, xm + rad, zm + rad, top + 0.3, hex('#455a64'));
      for (const [a0, b0, a1, b1] of [[-rad, -rad, rad, -rad + 3], [-rad, rad - 3, rad, rad], [-rad, -rad, -rad + 3, rad], [rad - 3, -rad, rad, rad]]) flat(out, xm + a0, zm + b0, xm + a1, zm + b1, top + 0.5, hex('#ffeb3b'));
      const hs = rad * 0.45, white = [0.95, 0.95, 0.95];
      flat(out, xm - hs, zm - hs, xm - hs * 0.6, zm + hs, top + 0.6, white);
      flat(out, xm + hs * 0.6, zm - hs, xm + hs, zm + hs, top + 0.6, white);
      flat(out, xm - hs * 0.6, zm - hs * 0.15, xm + hs * 0.6, zm + hs * 0.15, top + 0.6, white);
    } else if (b.style === 'garden') {
      flat(out, x0 + w * 0.15, z0 + d * 0.5, x0 + w * 0.65, z0 + d * 0.85, top + 0.3, hex('#66bb6a'));
      for (let k = 0; k < 6; k++) {
        const bx = x0 + w * (0.2 + r() * 0.4), bz = z0 + d * (0.55 + r() * 0.25), s = 3 + r() * 3;
        GL3D.box(out, bx - s, top, bz - s, bx + s, top + s * 1.6, bz + s, hex('#43a047'), { skip: 'b' });
      }
    } else if (b.style === 'bank') {
      const ch = Math.min(70, top - base - 20);
      for (let k = 0; k < 7; k++) {
        const cx = x0 + 14 + k * (w - 28) / 6;
        GL3D.box(out, cx - 3, base, z1 + 2, cx + 3, base + ch, z1 + 8, [0.93, 0.92, 0.88], { skip: 'b' });
      }
      GL3D.box(out, x0 + 6, base + ch, z1, x1 - 6, base + ch + 8, z1 + 10, [0.88, 0.86, 0.8], { skip: 'b' });
      GL3D.box(out, xm - 16, top + 3, zm - 4, xm + 16, top + 30, zm + 4, hex('#ffd54f'), { glow: true });
    } else {
      // Air-con units, vents and sometimes a water tank.
      for (let k = 0; k < 3 + r() * 4; k++) {
        const s = 4 + r() * 7, ux = x0 + 8 + s + r() * (w - 16 - 2 * s), uz = z0 + 8 + s + r() * (d - 16 - 2 * s);
        GL3D.box(out, ux - s, top, uz - s, ux + s, top + 4 + r() * 6, uz + s, mulCol(hex(shade(b.color, 0.35)), 1), { skip: 'b' });
      }
      if (b.style === 'flat' && r() < 0.5) {
        const tx = x0 + w * 0.7, tz = z0 + d * 0.3;
        for (const [a, c] of [[-6, -6], [4, -6], [-6, 4], [4, 4]]) GL3D.box(out, tx + a, top, tz + c, tx + a + 2, top + 10, tz + c + 2, hex('#5d4037'), { skip: 'b' });
        GL3D.box(out, tx - 8, top + 10, tz - 8, tx + 8, top + 26, tz + 8, hex('#8d6e63'), { skip: 'b' });
      }
    }
    // The tallest towers get a narrower crown on top.
    if (b.style === 'tower' && b.h > 200) {
      const cx0 = x0 + w * 0.22, cx1 = x1 - w * 0.22, cz0 = z0 + d * 0.22, cz1 = z1 - d * 0.22, ct = top + b.h * HS * 0.14;
      GL3D.box(out, cx0, top, cz0, cx1, ct, cz1, mulCol(col, 0.92), { skip: 'b' });
      let k = 0;
      for (const f of 'nsew') windows(night, cx0, cz0, cx1, cz1, top + 4, ct - 4, f, 20, 24, seed + 91 * ++k);
      GL3D.box(out, (cx0 + cx1) / 2 - 1, ct, (cz0 + cz1) / 2 - 1, (cx0 + cx1) / 2 + 1, ct + 40, (cz0 + cz1) / 2 + 1, [0.3, 0.3, 0.32], { skip: 'b' });
      GL3D.box(night, (cx0 + cx1) / 2 - 1.6, ct + 40, (cz0 + cz1) / 2 - 1.6, (cx0 + cx1) / 2 + 1.6, ct + 43, (cz0 + cz1) / 2 + 1.6, [1, 0.2, 0.15], { glow: true });
    }
    // Landmarks carry a glowing sign in their own colour over the forecourt.
    if (land) {
      const sy = Math.min(top - 6, base + 54);
      GL3D.box(out, x0 + 14, sy - 8, z1, x1 - 14, sy, z1 + 1.4, hex(land.color), { glow: true, skip: 'b' });
    }
  }

  function tree3d(out, t) {
    const y = CURB, r = t.r;
    GL3D.box(out, t.x - 2, y, t.y - 2, t.x + 2, y + 12, t.y + 2, hex('#6d4c41'), { skip: 'b' });
    GL3D.box(out, t.x - r * 0.8, y + 10, t.y - r * 0.8, t.x + r * 0.8, y + 10 + r * 1.1, t.y + r * 0.8, hex('#2e7d32'));
    GL3D.box(out, t.x - r * 0.5, y + 10 + r * 1.1, t.y - r * 0.5, t.x + r * 0.5, y + 10 + r * 1.6, t.y + r * 0.5, hex('#43a047'), { skip: 'b' });
  }

  function buildCity3d() {
    const main = [], night = [];
    const LINE = hex('#e8c547'), WHITE = [0.92, 0.92, 0.92];
    // The sea, the quay wall round the city, and the road surface over all of it.
    tiled(main, -2400, -2400, WORLD + 2400, WORLD + 2400, -5, hex('#2f6f9f'), 300);
    GL3D.box(main, -4, -5, -4, WORLD + 4, 0, WORLD + 4, hex('#7d8288'), { skip: 'tb' });
    tiled(main, -4, -4, WORLD + 4, WORLD + 4, 0, [0.27, 0.29, 0.32], 120);
    for (let i = 0; i <= N; i++) {
      const c = roadC(i);
      for (const d of [-2, 0.5]) {
        for (let t = 0; t < WORLD; t += 150) {
          flat(main, t, c + d, Math.min(WORLD, t + 150), c + d + 1.5, 0.1, LINE);
          flat(main, c + d, t, c + d + 1.5, Math.min(WORLD, t + 150), 0.1, LINE);
        }
      }
    }
    const lamps = [];
    for (const blk of allBlocks) {
      const { x1, y1, x2, y2 } = blk;
      for (let k = 0; k < 6; k++) {
        flat(main, x1 - R + 12 + k * 12, y1 - 16, x1 - R + 18 + k * 12, y1 - 4, 0.15, WHITE);
        flat(main, x1 - 16, y1 - R + 12 + k * 12, x1 - 4, y1 - R + 18 + k * 12, 0.15, WHITE);
      }
      GL3D.box(main, x1, 0, y1, x2, CURB, y2, hex('#b9bec4'), { skip: 'b' });
      const ix1 = x1 + 18, iy1 = y1 + 18, ix2 = x2 - 18, iy2 = y2 - 18, gy = CURB + 0.05;
      const grass = blk.kind === 'park' || blk.district === 'suburb';
      flat(main, ix1, iy1, ix2, iy2, gy, hex(grass ? (blk.kind === 'park' ? '#5fa35a' : '#79b26a') : blk.kind === 'lot' ? '#4a5058' : blk.district === 'industrial' ? '#8e8a80' : '#a3a8ae'));
      if (blk.kind === 'park') {
        const cx = (x1 + x2) / 2, cz = (y1 + y2) / 2, sand = hex('#d7c79e'), p = blk.pond;
        flat(main, ix1, cz - 6, ix2, cz + 6, gy + 0.05, sand);
        flat(main, cx - 6, iy1, cx + 6, iy2, gy + 0.05, sand);
        poly(main, ring(20, p.r + 4, p.x, p.y, gy + 0.1), hex('#cfd8dc'), [0, 1, 0]);
        poly(main, ring(20, p.r, p.x, p.y, gy + 0.15), hex('#3d8fd1'), [0, 1, 0]);
        // Benches along the paths.
        for (const [bx, bz, a] of [[cx - 90, cz - 14, 0], [cx + 90, cz + 14, 0], [cx - 14, cz + 90, 1], [cx + 14, cz - 90, 1]]) {
          const hl = a ? 2 : 8, hw = a ? 8 : 2;
          GL3D.box(main, bx - hl, gy, bz - hw, bx + hl, gy + 4, bz + hw, hex('#8d6e63'), { skip: 'b' });
        }
      } else if (grass) {
        for (const b of blk.buildings) flat(main, b.x2 - 30, b.y2, b.x2 - 12, Math.min(b.y2 + 30, iy2), gy + 0.05, hex('#a8a8a8'));
      }
      if (blk.kind === 'lot' || blk.forecourt) for (let k = 0; k < 8; k++) { const x = ix1 + 20 + k * 38; flat(main, x - 1, y2 - 120, x + 1, y2 - 70, gy + 0.05, WHITE); }
      blk.buildings.forEach((b, i) => building3d(main, night, b, i === 0 ? blk.land : null));
      for (const t of blk.trees) tree3d(main, t);
      // A street lamp on the block's corner, leaning out over the junction.
      const lx = x1 + 6, lz = y1 + 6;
      GL3D.box(main, lx - 1.2, CURB, lz - 1.2, lx + 1.2, CURB + 58, lz + 1.2, hex('#455a64'), { skip: 'b' });
      GL3D.box(main, lx - 14, CURB + 56, lz - 1, lx + 1, CURB + 58, lz + 1, hex('#455a64'));
      GL3D.box(night, lx - 15, CURB + 53, lz - 3, lx - 7, CURB + 56, lz + 3, [1, 0.88, 0.6], { glow: true });
      lamps.push({ x: lx - 11, z: lz });
    }
    // Stunt ramps: striped wedges.
    for (const r of ramps) {
      const ca = Math.cos(r.a), sa = Math.sin(r.a);
      const P3 = (al, sd, h) => [r.x + ca * al - sa * sd, h, r.y + sa * al + ca * sd];
      for (let k = 0; k < 5; k++) {
        const s0 = -30 + k * 12, s1 = s0 + 12;
        poly(main, [P3(-16, s0, 0.2), P3(16, s0, 10), P3(16, s1, 10), P3(-16, s1, 0.2)], hex(k % 2 ? '#212121' : '#ffca28'), [0, 1, 0]);
      }
      poly(main, [P3(16, -30, 0), P3(16, 30, 0), P3(16, 30, 10), P3(16, -30, 10)], hex('#5d4037'), [ca, 0, sa]);
      poly(main, [P3(-16, -30, 0), P3(16, -30, 0), P3(16, -30, 10)], hex('#6d4c41'), [sa, 0, -ca]);
      poly(main, [P3(-16, 30, 0), P3(16, 30, 0), P3(16, 30, 10)], hex('#6d4c41'), [-sa, 0, ca]);
    }
    const winTex = G3.texture(windowTexture());
    const gl = G3.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const spotTex = G3.texture(spotTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    city3d = { main: G3.mesh(main), night: G3.mesh(night), winTex, spotTex, lamps, dyn: {} };
    buildActors3d();
  }

  // ---------- Cars, people and the helicopter ----------

  const carMeshes = new Map(), personMeshes = new Map();
  let lightBar, riotBar, legMesh, heliBody, heliRotor, pkgMesh;
  const CAB = (L) => [-L / 2 + L * 0.3, -L / 2 + L * 0.72];
  function carMesh(type, color) {
    const key = type + color;
    if (carMeshes.has(key)) return carMeshes.get(key);
    const T = CARS[type], L = T.len, hl = L / 2, hw = T.wid / 2, out = [];
    const c = hex(color), dark = [0.1, 0.11, 0.13], glass = [0.16, 0.23, 0.3];
    const van = type === 'van' || type === 'riot', beast = type === 'beast', low = type === 'sports' || type === 'super';
    const wr = beast ? 6 : 4.2, base = beast ? 6 : 3, top = van ? 23 : low ? 9 : beast ? 15 : 11;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wx = sx * L * 0.31, wz = sz * (hw - 2.2);
      GL3D.box(out, wx - wr, 0, wz - 2.4, wx + wr, wr * 2, wz + 2.4, dark);
      GL3D.box(out, wx - wr * 0.45, wr * 0.55, wz - 2.5, wx + wr * 0.45, wr * 1.45, wz + 2.5, [0.62, 0.64, 0.68]);
    }
    GL3D.box(out, -hl, base, -hw, hl, top, hw, c);
    GL3D.box(out, -hl - 0.2, base, -hw - 0.2, hl + 0.2, base + 2, hw + 0.2, mulCol(c, 0.55));
    let roofY = top;
    if (van) {
      GL3D.box(out, hl - 0.3, top - 10, -hw + 2, hl + 0.3, top - 2, hw - 2, glass);
      GL3D.box(out, hl - 12, top - 10, -hw - 0.3, hl - 2, top - 3, hw + 0.3, glass);
    } else {
      const [cx0, cx1] = CAB(L), ch = low ? 6.5 : beast ? 8 : 7.5;
      GL3D.box(out, cx0, top, -hw + 2, cx1, top + ch, hw - 2, glass);
      GL3D.box(out, cx0 + 2.5, top + ch - 0.3, -hw + 2.3, cx1 - 2, top + ch + 1, hw - 2.3, c);
      const mid = (cx0 + cx1) / 2;
      GL3D.box(out, mid - 1, top, -hw + 1.8, mid + 1, top + ch, hw - 1.8, c);
      roofY = top + ch + 1;
      if (type === 'police') {
        GL3D.box(out, cx1, top, -hw - 0.1, hl + 0.1, top + 0.3, hw + 0.1, dark);
        GL3D.box(out, -hl - 0.1, top, -hw - 0.1, cx0, top + 0.3, hw + 0.1, dark);
        GL3D.box(out, cx0 - 2, base + 2, -hw - 0.25, cx1 + 2, top - 1, hw + 0.25, dark);
      }
      if (type === 'taxi') GL3D.box(out, -3, roofY, -5, 3, roofY + 3.5, 5, [1, 0.85, 0.2], { glow: true });
      if (type === 'muscle' || type === 'super') {
        for (const z of [-2.6, 0.8]) {
          GL3D.box(out, cx1, top, z, hl + 0.05, top + 0.3, z + 1.8, [0.95, 0.95, 0.95]);
          GL3D.box(out, -hl - 0.05, top, z, cx0, top + 0.3, z + 1.8, [0.95, 0.95, 0.95]);
        }
      }
      if (low) {
        for (const z of [-hw + 4, hw - 5]) GL3D.box(out, -hl + 1.5, top, z, -hl + 3, top + 4, z + 1, dark);
        GL3D.box(out, -hl, top + 4, -hw + 2, -hl + 5, top + 5, hw - 2, mulCol(c, 0.7));
      }
      if (beast) {
        GL3D.box(out, hl, base, -hw + 2, hl + 2.5, base + 8, hw - 2, dark);
        GL3D.box(out, cx0 + 2, roofY, -hw + 3, cx1 - 2, roofY + 1.5, hw - 3, dark);
      }
    }
    for (const sz of [-1, 1]) {
      const za = sz > 0 ? hw - 6 : -hw + 1.5, zb = sz > 0 ? hw - 1.5 : -hw + 6;
      GL3D.box(out, hl - 0.2, base + 4, za, hl + 0.5, base + 6.5, zb, [1, 0.96, 0.78], { glow: true });
      GL3D.box(out, -hl - 0.5, base + 4, za, -hl + 0.2, base + 6.5, zb, [1, 0.12, 0.1], { glow: true });
    }
    const m = G3.mesh(out);
    carMeshes.set(key, m);
    return m;
  }
  function personMesh(color, skin) {
    const key = color + skin;
    if (personMeshes.has(key)) return personMeshes.get(key);
    const out = [], c = hex(color);
    GL3D.box(out, -2, 7, -3.6, 2, 13.5, 3.6, c);
    GL3D.box(out, -2.2, 13.5, -2.2, 2.2, 17.6, 2.2, hex(skin));
    GL3D.box(out, -2.4, 16.6, -2.4, 1.2, 18.3, 2.4, [0.24, 0.17, 0.12]);
    GL3D.box(out, -1, 8, -5, 1, 13, -3.6, mulCol(c, 0.8));
    GL3D.box(out, -1, 8, 3.6, 1, 13, 5, mulCol(c, 0.8));
    const m = G3.mesh(out);
    personMeshes.set(key, m);
    return m;
  }
  function buildActors3d() {
    const T = CARS.police, [cx0, cx1] = CAB(T.len), y = 11 + 7.5 + 1, mid = (cx0 + cx1) / 2;
    const bar = (z0, z1, col, glow) => G3.mesh(GL3D.box([], mid - 3, y, z0, mid + 3, y + 2.5, z1, col, { glow }));
    lightBar = { red: bar(-7, -0.4, [1, 0.1, 0.15], true), blue: bar(0.4, 7, [0.15, 0.45, 1], true), redOff: bar(-7, -0.4, [0.45, 0.1, 0.12], false), blueOff: bar(0.4, 7, [0.1, 0.18, 0.45], false) };
    // Riot vans are van-shaped, so their bar sits on the taller roof near the front.
    const RV = CARS.riot, rx = RV.len / 2 - 12, ry = 23;
    const rbar = (z0, z1, col, glow) => G3.mesh(GL3D.box([], rx - 3, ry, z0, rx + 3, ry + 2.5, z1, col, { glow }));
    riotBar = { red: rbar(-7, -0.4, [1, 0.1, 0.15], true), blue: rbar(0.4, 7, [0.15, 0.45, 1], true), redOff: rbar(-7, -0.4, [0.45, 0.1, 0.12], false), blueOff: rbar(0.4, 7, [0.1, 0.18, 0.45], false) };
    legMesh = G3.mesh(GL3D.box([], -1.3, 0, -1.3, 1.3, 7.2, 1.3, [0.22, 0.27, 0.33]));
    const body = [], dark = hex('#263238');
    GL3D.box(body, -20, 0, -10, 20, 16, 10, dark);
    GL3D.box(body, 8, 3, -8.5, 20.6, 14, 8.5, hex('#80deea'));
    GL3D.box(body, -52, 6, -2, -20, 11, 2, dark);
    GL3D.box(body, -54, 6, -1, -47, 22, 1, hex('#37474f'));
    GL3D.box(body, -1.5, 16, -1.5, 1.5, 20, 1.5, dark);
    for (const z of [-9, 9]) {
      GL3D.box(body, -15, -6, z - 1, 15, -4.5, z + 1, hex('#90a4ae'));
      for (const x of [-8, 6]) GL3D.box(body, x, -4.5, z - 0.6, x + 2, 0, z + 0.6, hex('#90a4ae'));
    }
    GL3D.box(body, 19, -3, -2, 21.5, 1, 2, [1, 1, 0.85], { glow: true });
    GL3D.box(body, -55, 20, -0.5, -53, 22, 0.5, [1, 0.1, 0.1], { glow: true });
    heliBody = G3.mesh(body);
    const rot = [];
    GL3D.box(rot, -50, 0, -2.2, 50, 1, 2.2, [0.12, 0.12, 0.12]);
    GL3D.box(rot, -2.2, 0, -50, 2.2, 1, 50, [0.12, 0.12, 0.12]);
    heliRotor = G3.mesh(rot);
    const pk = [];
    GL3D.box(pk, -7, 0, -6, 7, 10, 6, hex('#a1887f'));
    GL3D.box(pk, -1.5, -0.05, -6.2, 1.5, 10.2, 6.2, hex('#ffd54f'));
    GL3D.box(pk, -7.2, 4, -6.2, 7.2, 6, 6.2, hex('#8d6e63'));
    pkgMesh = G3.mesh(pk);
  }

  function drawPerson3d(x, z, a, color, skin, step, diving) {
    const y = groundAt(x, z), sy = diving ? 0.45 : 1;
    M4.trs(model, x, y, z, -a, 1, sy, 1);
    G3.draw(personMesh(color, skin), model);
    const ca = Math.cos(a), sa = Math.sin(a), sw = diving ? 0 : Math.sin(step) * 2.2;
    for (const side of [-1, 1]) {
      const lx = sw * side, lz = side * 1.7;
      M4.trs(model, x + ca * lx - sa * lz, y, z + sa * lx + ca * lz, -a, 1, sy, 1);
      G3.draw(legMesh, model);
    }
  }

  // ---------- Camera and frame ----------

  const cam3 = { a: 0, dist: 90, cur: 90, fov: 1.1, ready: false };
  const view3 = { ex: 0, ez: 0, ca: 0, f: 1, back: false };
  function project(x, y, z) {
    const m = PV;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w < 2) return null;
    return { x: (cx / w * 0.5 + 0.5) * W, y: (0.5 - cy / w * 0.5) * H, w };
  }

  function render3d(dt) {
    const gl = G3.gl, pc = player.car, tgt = pc || player, sp = pc ? speedOf(pc) : 0;
    // Chase camera: swings round behind your heading (half-following a drift), pulls in front of
    // buildings, and backs off and widens with speed. Hold C to look behind.
    let heading = pc ? pc.a : player.a;
    if (pc && sp > 80 && fwdSpeed(pc) > 0) heading = pc.a + angDiff(Math.atan2(pc.vy, pc.vx), pc.a) * 0.6;
    if (!cam3.ready) { cam3.a = heading; cam3.cur = cam3.dist = pc ? 90 : 50; cam3.ready = true; }
    cam3.a += angDiff(heading, cam3.a) * (1 - Math.exp(-(pc ? 4 : 6) * dt));
    view3.back = keys.has('KeyC');
    const ca = cam3.a + (view3.back ? Math.PI : 0);
    const want = pc ? 88 + sp * 0.05 : 50, hgt = pc ? 34 + sp * 0.015 : 24;
    cam3.dist = Gfx.approach(cam3.dist, want, 3, dt);
    let d = cam3.dist;
    for (let k = 12; k <= cam3.dist; k += 6) if (solidAt(tgt.x - Math.cos(ca) * k, tgt.y - Math.sin(ca) * k)) { d = Math.max(10, k - 8); break; }
    cam3.cur = d < cam3.cur ? d : Gfx.approach(cam3.cur, d, 2.5, dt);
    const baseY = groundAt(tgt.x, tgt.y) + (pc ? pc.z : 0);
    const sh = shake.offset(8);
    const ex = tgt.x - Math.cos(ca) * cam3.cur + sh.x * 0.5, ez = tgt.y - Math.sin(ca) * cam3.cur + sh.y * 0.5, ey = baseY + hgt;
    const lx = tgt.x + Math.cos(ca) * 30, lz = tgt.y + Math.sin(ca) * 30, ly = baseY + (pc ? 10 : 14);
    const yaw = Math.atan2(lx - ex, -(lz - ez)), pitch = Math.atan2(ly - ey, Math.hypot(lx - ex, lz - ez));
    const boosting = pc && player.nitro > 0 && held('ShiftLeft', 'ShiftRight') && held('KeyW', 'ArrowUp');
    cam3.fov = Gfx.approach(cam3.fov, 1.05 + Math.min(0.22, sp / 2200) + (boosting ? 0.1 : 0), 3, dt);
    Object.assign(view3, { ex, ez, ca, f: 1 / Math.tan(cam3.fov / 2) });

    // Sky and light follow the clock.
    const dk = darkness(), kn = dk / 0.6;
    const fog = [0.6 + (0.05 - 0.6) * kn, 0.76 + (0.07 - 0.76) * kn, 0.92 + (0.17 - 0.92) * kn];
    const FOG0 = 520, FOG1 = 1200;
    G3.begin(cam3.fov, 2, 1700, fog, FOG0, FOG1, 1 - dk * 1.15);
    G3.camera(ex, ey, ez, yaw, pitch);
    M4.mul(PV, G3.proj, G3.view);
    const near = (x, y, r) => Math.abs(x - ex) < r && Math.abs(y - ez) < r && Math.hypot(x - ex, y - ez) < r;

    G3.bindTexture(null);
    G3.draw(city3d.main);
    G3.bindTexture(city3d.winTex);
    G3.tint(0.42, 0.56, 0.7, 0.85 * (1 - clamp(dk / 0.3, 0, 1)));
    G3.draw(city3d.night);
    G3.tint(0, 0, 0, 0);
    G3.bindTexture(null);

    // Cars.
    const flash = Math.floor(time * 8) % 2;
    for (const c of cars) {
      if (!near(c.x, c.y, 1300)) continue;
      M4.trs(model, c.x, groundAt(c.x, c.y) + c.z, c.y, -c.a);
      if (c.broken) G3.tint(0.08, 0.08, 0.08, 0.6);
      G3.draw(carMesh(c.type, c.color), model);
      if (c.broken) G3.tint(0, 0, 0, 0);
      if (c.type === 'police' || c.type === 'riot') {
        const on = !c.broken && (c.role === 'cop' || c.siren > 0), lb = c.type === 'riot' ? riotBar : lightBar;
        G3.draw(on && flash ? lb.red : lb.redOff, model);
        G3.draw(on && !flash ? lb.blue : lb.blueOff, model);
      }
    }
    // People.
    for (const p of peds) if (near(p.x, p.y, 900)) drawPerson3d(p.x, p.y, p.a || 0, p.color, p.skin, p.step, p.dive > 0);
    if (!pc) drawPerson3d(player.x, player.y, player.a, '#7c4dff', '#ffe0bd', player.walk, false);
    drawFriend3d();
    const tg = missionTarget();
    if (tg && mission.kind === 'taxi' && mission.stage === 'pickup') drawPerson3d(tg.x, tg.y, Math.atan2(player.y - tg.y, player.x - tg.x), '#fdd835', '#ffe0bd', time * 6, false);
    // Hidden packages spin and bob.
    for (const p of packages) {
      if (s.pkgs.includes(p.id) || !near(p.x, p.y, 900)) continue;
      M4.trs(model, p.x, groundAt(p.x, p.y) + 3 + Math.sin(time * 3 + p.id) * 2, p.y, time * 1.5 + p.id);
      G3.draw(pkgMesh, model);
    }
    // The police helicopter.
    let heliAt = null;
    if (heli) {
      heliAt = { x: heli.x, y: 240, z: heli.y };
      M4.trs(model, heli.x, heliAt.y, heli.y, -Math.atan2(player.y - heli.y, player.x - heli.x));
      G3.draw(heliBody, model);
      M4.trs(model, heli.x, heliAt.y + 20, heli.y, heli.a);
      G3.draw(heliRotor, model);
    }

    // See-through things: soft shadows (multiplied in), then markers and beacons, then light
    // pools (added on). Depth testing keeps all of them behind buildings.
    const dyn = city3d.dyn;
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    const shadows = [], shadowK = 0.55 * (1 - kn * 0.6);
    for (const c of cars) {
      if (!near(c.x, c.y, 480)) continue;
      const lift = Math.max(0.5, 1 - c.z / 120);
      rect3(shadows, c.x, c.y, groundAt(c.x, c.y) + 0.3, c.T.len * 0.72 * lift, c.T.wid * 0.85 * lift, c.a, [shadowK, shadowK, shadowK], true);
    }
    for (const p of peds) if (near(p.x, p.y, 350)) rect3(shadows, p.x, p.y, groundAt(p.x, p.y) + 0.3, 7, 7, 0, [shadowK, shadowK, shadowK], true);
    if (!pc) rect3(shadows, player.x, player.y, groundAt(player.x, player.y) + 0.3, 8, 8, 0, [shadowK, shadowK, shadowK], true);
    G3.bindTexture(city3d.spotTex);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
    G3.draw(dyn.shadows = G3.mesh(shadows, dyn.shadows));

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    G3.bindTexture(null);
    const rings = [], beams = [], pulse = 0.5 + 0.5 * Math.sin(time * 4);
    const outside = (x, z, r) => Math.hypot(x - ex, z - ez) > r + 14;      // a beacon with the camera inside it would tint the whole screen
    for (const m of markers) {
      if (!near(m.x, m.y, 1000)) continue;
      const active = mission && mission.kind === 'heist' && mission.target === m, r = active ? 46 : 32, col = hex(m.color);
      flatRing(rings, m.x, m.y, CURB + 0.4, r - 3, r, col);
      if (outside(m.x, m.y, r)) tube(beams, m.x, CURB, m.y, r, m.x, CURB + 22 + pulse * 6, m.y, r, col);
      if (active && mission.stage === 'crack') {
        const n = Math.max(1, Math.round(28 * mission.crack / mission.h.crack));
        for (let i = 0; i < n; i++) {
          const a0 = -Math.PI / 2 + i / 28 * TAU, a1 = a0 + TAU / 28;
          poly(rings, [[m.x + Math.cos(a0) * 50, CURB + 0.5, m.y + Math.sin(a0) * 50], [m.x + Math.cos(a1) * 50, CURB + 0.5, m.y + Math.sin(a1) * 50], [m.x + Math.cos(a1) * 56, CURB + 0.5, m.y + Math.sin(a1) * 56], [m.x + Math.cos(a0) * 56, CURB + 0.5, m.y + Math.sin(a0) * 56]], hex('#ffd54f'), [0, 1, 0], true);
        }
      }
    }
    for (const d of doors) {
      if (!near(d.x, d.y, 420)) continue;
      const closed = ((s.robbed || {})[(d.kind === 'shop' ? 's' : 'h') + d.id] || 0) > Date.now();
      flatRing(rings, d.x, d.y, CURB + 0.45, 7, 11, hex(closed ? '#616161' : d.kind === 'shop' ? '#4fc3f7' : '#ffb74d'));
    }
    if (tg) {
      const g = groundAt(tg.x, tg.y), col = hex(tg.color);
      flatRing(rings, tg.x, tg.y, g + 0.5, 36, 40, col);
      if (outside(tg.x, tg.y, 34)) tube(beams, tg.x, g, tg.y, 34, tg.x, g + 260, tg.y, 34, col);
    }
    if (mission && mission.kind === 'race') {
      const next = RACE[(mission.cp + 1) % RACE.length];
      if (mission.cp < RACE.length && outside(next.x, next.y, 30)) tube(beams, next.x, 0, next.y, 30, next.x, 120, next.y, 30, [0.8, 0.8, 0.8]);
    }
    const spot = [];
    if (heliAt) tube(spot, heliAt.x, heliAt.y - 4, heliAt.z, 3, player.x, groundAt(player.x, player.y), player.y, 45, [1, 1, 0.85]);
    G3.alpha(0.85);
    G3.draw(dyn.rings = G3.mesh(rings, dyn.rings));
    gl.disable(gl.CULL_FACE);
    G3.alpha(0.22 + pulse * 0.08);
    G3.draw(dyn.beams = G3.mesh(beams, dyn.beams));
    if (spot.length) { G3.alpha(0.07); G3.draw(dyn.spot = G3.mesh(spot, dyn.spot)); }
    gl.enable(gl.CULL_FACE);
    G3.alpha(1);

    const pools = [];
    if (kn > 0.05) {
      for (const L of city3d.lamps) {
        if (!near(L.x, L.z, 800)) continue;
        const k = kn * 0.5 * (1 - Math.hypot(L.x - ex, L.z - ez) / 800);
        rect3(pools, L.x, L.z, CURB + 0.45, 75, 75, 0, [k, k * 0.8, k * 0.5], true);
      }
      for (const c of cars) {
        if (c.broken || !near(c.x, c.y, 700)) continue;
        const k = kn * 0.6 * (1 - Math.hypot(c.x - ex, c.y - ez) / 700), f = c.T.len / 2 + 44;
        rect3(pools, c.x + Math.cos(c.a) * f, c.y + Math.sin(c.a) * f, groundAt(c.x, c.y) + 0.5, 52, 34, c.a, [k, k * 0.97, k * 0.8], true);
        if ((c.type === 'police' || c.type === 'riot') && (c.role === 'cop' || c.siren > 0)) rect3(pools, c.x, c.y, groundAt(c.x, c.y) + 0.55, 55, 55, 0, flash ? [k * 1.2, 0, 0] : [0, k * 0.4, k * 1.3], true);
      }
    }
    if (heliAt) { const k = 0.25 + kn * 0.6; rect3(pools, player.x, player.y, groundAt(player.x, player.y) + 0.6, 70, 70, 0, [k, k, k * 0.85], true); }
    if (pools.length) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform2f(G3.u.fogRange, 1e6, 2e6);
      G3.bindTexture(city3d.spotTex);
      G3.draw(dyn.pools = G3.mesh(pools, dyn.pools));
      gl.uniform2f(G3.u.fogRange, FOG0, FOG1);
      G3.bindTexture(null);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // World-space bits on the HUD layer: particles, floating text and landmark labels.
  function drawWorldHud3d() {
    const scale = view3.f * H / 2;
    for (const p of fx.list) {
      const lift = p.grow ? 6 + p.t * 22 : 5 + (p.z || 0);
      const q = project(p.x, groundAt(p.x, p.y) + lift, p.y);
      if (!q || q.w > 700) continue;
      ctx.globalAlpha = clamp(p.fade ? 1 - p.t / p.life : 1, 0, 1) * 0.75;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.6, Math.min(40, p.size * 0.7 * scale / q.w)), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const m of markers) {
      const d = Math.hypot(m.x - player.x, m.y - player.y);
      if (d > 750) continue;
      const q = project(m.x, CURB + 48, m.y);
      if (!q) continue;
      ctx.globalAlpha = clamp((750 - d) / 150, 0, 1);
      Gfx.text(ctx, m.icon, q.x, q.y, { size: clamp(22 * 300 / q.w, 12, 28), stroke: null });
      if (d < 400) Gfx.text(ctx, m.name, q.x, q.y + clamp(22 * 300 / q.w, 12, 28) * 0.9, { size: 12, color: '#fff', width: 3 });
    }
    ctx.globalAlpha = 1;
    for (const f of pops.list) {
      if (f.t < 0) continue;
      const k = f.t / f.life, q = project(f.x, 34 + f.rise * k * 0.7, f.y);
      if (!q || q.w > 900) continue;
      ctx.globalAlpha = clamp(1 - k * k, 0, 1);
      Gfx.text(ctx, f.str, q.x, q.y, { size: clamp(f.size * 220 / q.w, 11, f.size * 1.4), color: f.color });
    }
    ctx.globalAlpha = 1;
    for (const d of doors) {
      const dd = Math.hypot(d.x - player.x, d.y - player.y);
      if (dd > 260) continue;
      const q = project(d.x, CURB + 20, d.y);
      if (q) Gfx.text(ctx, d.kind === 'shop' ? `🏪 ${d.name}` : d.kane ? "🕵️ Kane's house" : '🚪', q.x, q.y, { size: clamp(16 * 200 / q.w, 10, 16), color: '#fff', width: 3 });
    }
    drawTracers3d();
    friendTag3d();
    if (view3.back) Gfx.text(ctx, 'REAR VIEW', W / 2, H - 24, { size: 14, color: '#80deea' });
  }

  // Off-screen things you need to know about: the job target, and cops closing in from behind.
  function edgeArrow(x, y, color, size) {
    const rel = angDiff(Math.atan2(y - player.y, x - player.x), view3.ca);
    const px = W / 2 + Math.sin(rel) * (W / 2 - 70), py = H / 2 - Math.cos(rel) * (H / 2 - 64);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rel - Math.PI / 2);
    ctx.scale(size, size);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-10, -13); ctx.lineTo(-4, 0); ctx.lineTo(-10, 13); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }
  function drawArrows3d() {
    const tg = missionTarget();
    if (tg) {
      const q = project(tg.x, groundAt(tg.x, tg.y) + 70, tg.y), dist = Math.hypot(tg.x - player.x, tg.y - player.y);
      if (q && q.x > 30 && q.x < W - 30 && q.y > 70 && q.y < H - 30) {
        Gfx.text(ctx, '▼', q.x, q.y + Math.sin(time * 5) * 4, { size: 22, color: tg.color });
        Gfx.text(ctx, `${Math.round(dist / 10)} m`, q.x, q.y - 20, { size: 12 });
      } else edgeArrow(tg.x, tg.y, tg.color, 1);
    }
    for (const c of cars) {
      if (c.role !== 'cop' || c.broken || Math.hypot(c.x - player.x, c.y - player.y) > 900) continue;
      const q = project(c.x, 10, c.y);
      if (q && q.x > 0 && q.x < W && q.y > 0 && q.y < H) continue;
      edgeArrow(c.x, c.y, Math.floor(time * 6) % 2 ? '#ff1744' : '#2979ff', 0.65);
    }
    if (online()) {
      const q = project(friend.x, 20, friend.y);
      if (!(q && q.x > 0 && q.x < W && q.y > 0 && q.y < H)) edgeArrow(friend.x, friend.y, FRIEND_COLOR, 0.7);
    }
  }

  // A round radar that turns with the camera, so "up" is always the way you're looking.
  function drawRadar() {
    const R0 = 74, cx = W - R0 - 14, cy = H - R0 - 14, k = 0.065, rot = -Math.PI / 2 - view3.ca;
    ctx.save();
    ctx.fillStyle = 'rgba(20,28,40,0.78)';
    ctx.beginPath(); ctx.arc(cx, cy, R0 + 5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R0, 0, TAU); ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = '#2f6f9f';
    ctx.fillRect(-R0 * 1.5, -R0 * 1.5, R0 * 3, R0 * 3);
    ctx.drawImage(mapCanvas, -player.x * k, -player.y * k, WORLD * k, WORLD * k);
    const dot = (x, y, c, r, pin) => {
      let dx = (x - player.x) * k, dy = (y - player.y) * k;
      const m = Math.hypot(dx, dy);
      if (m > R0 - 6) { if (!pin) return; dx *= (R0 - 6) / m; dy *= (R0 - 6) / m; }
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(dx, dy, r, 0, TAU); ctx.fill();
    };
    for (const m of markers) dot(m.x, m.y, m.color, 3);
    if (mission && mission.kind === 'race') RACE.forEach((p, i) => { if (i >= mission.cp % RACE.length) dot(p.x, p.y, 'rgba(255,255,255,0.55)', 2); });
    for (const c of cars) if (c.role === 'cop') dot(c.x, c.y, Math.floor(time * 6) % 2 ? '#ff1744' : '#2979ff', 3, true);
    for (const f of others()) dot(f.x, f.y, f.tagColor, 4.5, true);
    const tg = missionTarget();
    if (tg) { ctx.strokeStyle = '#000'; dot(tg.x, tg.y, tg.color, 5, true); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R0, 0, TAU); ctx.stroke();
    const na = -Math.PI / 2 + rot;
    Gfx.text(ctx, 'N', cx + Math.cos(na) * (R0 - 9), cy + Math.sin(na) * (R0 - 9), { size: 11, color: '#ff8a80', width: 3 });
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((player.car ? player.car.a : player.a) + rot);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -6); ctx.lineTo(-2, 0); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  // ---------- Inside: houses and shops ----------
  // Walking into a door loads a separate area (the city pauses until you come out). Houses are
  // burglaries: grab what you can carry before anyone notices. By night the owner is asleep and
  // noise wakes them; by day there's an alarm keypad by the door to beat. Shops can be held up
  // with a gun. What you steal goes in your bag, and the Lucky Pawn buys it.

  const IW = 760, IH = 480;               // interior size
  const BAG_SLOTS = 6;
  const LOOT = {
    tv: { icon: '📺', name: 'TV', value: 350, grab: 2, slots: 2, noise: 14 },
    laptop: { icon: '💻', name: 'Laptop', value: 280, grab: 1, slots: 1, noise: 5 },
    jewels: { icon: '💍', name: 'Jewelry', value: 450, grab: 0.8, slots: 1, noise: 3 },
    console: { icon: '🎮', name: 'Game console', value: 220, grab: 1, slots: 1, noise: 5 },
    painting: { icon: '🖼️', name: 'Painting', value: 600, grab: 1.6, slots: 2, noise: 9 },
    guitar: { icon: '🎸', name: 'Guitar', value: 300, grab: 1, slots: 2, noise: 10 },
    watch: { icon: '⌚', name: 'Watch', value: 380, grab: 0.6, slots: 1, noise: 2 },
    cash: { icon: '💵', name: 'Cash stash', cash: [80, 400], grab: 0.6, slots: 0, noise: 2 },
    safe: { icon: '🔐', name: 'Wall safe', cash: [900, 2400], grab: 7, slots: 0, noise: 30 },
    snacks: { icon: '🍫', name: 'Snacks', cash: [10, 30], grab: 0.5, slots: 0, noise: 0 },
    register: { icon: '🧾', name: 'Cash register', cash: [300, 1100], grab: 3.5, slots: 0, noise: 0, holdup: true },
    ledger: { icon: '📒', name: "The councilman's ledger", grab: 1.2, slots: 0, noise: 3, story: true },
    file: { icon: '🗂️', name: "Kane's evidence file", grab: 2, slots: 0, noise: 6, story: true },
  };
  const bagValue = () => (s.bag || []).reduce((t, id) => t + (LOOT[id]?.value || 0), 0);
  const bagUsed = () => (s.bag || []).reduce((t, id) => t + (LOOT[id]?.slots || 0), 0);
  const wall = (x1, y1, x2, y2) => ({ x1, y1, x2, y2, wall: true });
  const thing = (x1, y1, x2, y2, color, label) => ({ x1, y1, x2, y2, color, label });

  // Two house plans, either way round; what's lying about depends on the house.
  function houseArea(door) {
    const r = Gfx.rng(5000 + door.id), flip = r() < 0.5, plan = r() < 0.5 ? 0 : 1, T = 14;
    let solids = [wall(0, 0, IW, T), wall(0, 0, T, IH), wall(IW - T, 0, IW, IH), wall(0, IH - T, IW / 2 - 44, IH), wall(IW / 2 + 44, IH - T, IW, IH)];
    let spots;
    if (plan === 0) {
      solids.push(wall(300, 0, 300 + T, 170), wall(300, 250, 300 + T, IH), wall(300, 230, 470, 230 + T), wall(550, 230, IW, 230 + T));
      solids.push(thing(40, 40, 200, 90, '#8d6e63', 'Sofa'), thing(90, 150, 180, 200, '#a1887f', 'Table'), thing(340, 30, 720, 70, '#b0bec5', 'Kitchen'), thing(560, 300, 720, 430, '#7986cb', 'Bed'), thing(330, 262, 410, 300, '#6d4c41', 'Wardrobe'));
      spots = [[60, 300, ['tv', 'console', 'guitar']], [230, 60, ['painting', 'tv']], [140, 400, ['console', 'laptop', 'guitar']], [400, 120, ['cash', 'laptop']], [690, 140, ['cash', 'watch']], [480, 300, ['jewels', 'watch']], [690, 260, ['safe', 'painting', 'jewels']], [360, 330, ['laptop', 'cash']]];
    } else {
      solids.push(wall(0, 210, 250, 210 + T), wall(330, 210, IW, 210 + T), wall(380, 0, 380 + T, 120), wall(380, 160, 380 + T, 210));
      solids.push(thing(40, 300, 220, 350, '#8d6e63', 'Sofa'), thing(560, 300, 700, 360, '#a1887f', 'Dining table'), thing(40, 30, 180, 150, '#7986cb', 'Bed'), thing(430, 30, 720, 70, '#b0bec5', 'Kitchen'), thing(250, 30, 340, 70, '#6d4c41', 'Desk'));
      spots = [[290, 110, ['laptop', 'watch']], [60, 180, ['jewels', 'cash']], [330, 170, ['safe', 'painting']], [120, 410, ['tv', 'guitar', 'console']], [400, 420, ['painting', 'tv']], [700, 420, ['cash', 'console']], [600, 120, ['cash', 'laptop']], [240, 300, ['console', 'guitar']]];
    }
    const fx_ = x => (flip ? IW - x : x);
    if (flip) solids = solids.map(b => ({ ...b, x1: IW - b.x2, x2: IW - b.x1 }));
    const loot = [];
    for (const [x, y, kinds] of spots) if (r() < 0.75) loot.push({ x: fx_(x), y, id: kinds[Math.floor(r() * kinds.length)] });
    const bed = solids.find(b => b.label === 'Bed');
    // The story's special items wait in the bedroom.
    const st = storyStep();
    if (st && st.t === 'burgle' && st.door === door) loot.push({ x: (bed.x1 + bed.x2) / 2, y: bed.y2 + 26, id: st.item });
    const night = darkness() > 0.25 || door.kane;
    return { kind: 'house', door, w: IW, h: IH, solids, loot, exit: { x: IW / 2, y: IH - 24 }, floor: ['#d7ccc8', '#bcaaa4'][plan],
      owner: night ? { x: (bed.x1 + bed.x2) / 2, y: (bed.y1 + bed.y2) / 2, awake: false } : null,
      keypad: night ? null : { x: IW / 2 + 70, y: IH - 40, left: 7, done: false } };
  }

  function shopArea(door) {
    const r = Gfx.rng(9000 + door.id), T = 14;
    const solids = [wall(0, 0, IW, T), wall(0, 0, T, IH), wall(IW - T, 0, IW, IH), wall(0, IH - T, IW / 2 - 44, IH), wall(IW / 2 + 44, IH - T, IW, IH),
      thing(250, 60, 510, 100, '#5d4037', 'Counter'), thing(60, 180, 90, 380, '#90a4ae', 'Shelf'), thing(200, 180, 230, 380, '#90a4ae', 'Shelf'), thing(530, 180, 560, 380, '#90a4ae', 'Shelf'), thing(670, 180, 700, 380, '#90a4ae', 'Shelf'), thing(620, 30, 740, 70, '#4fc3f7', 'Fridges')];
    const loot = [{ x: 380, y: 124, id: 'register' }];
    for (const sx of [75, 215, 545, 685]) for (const sy of [200, 280, 360]) if (r() < 0.45) loot.push({ x: sx + (sx < 380 ? 30 : -30), y: sy, id: 'snacks' });
    return { kind: 'shop', door, w: IW, h: IH, solids, loot, exit: { x: IW / 2, y: IH - 24 }, floor: '#eceff1', clerk: { x: 380, y: 40 } };
  }

  let area = null;
  function enterArea(door) {
    const key = (door.kind === 'shop' ? 's' : 'h') + door.id, until = (s.robbed || {})[key] || 0;
    const st = storyStep(), storyHere = st && st.t === 'burgle' && st.door === door;
    if (until > Date.now() && !storyHere) {
      const left = Math.ceil((until - Date.now()) / 60000);
      return say(door.kind === 'shop' ? 'Closed after your last visit' : 'Already cleaned out', `Try again in ${left} min`, 2, '#ff8a80');
    }
    if (player.car) return;
    area = door.kind === 'shop' ? shopArea(door) : houseArea(door);
    Object.assign(area, { px: area.exit.x, py: area.exit.y - 20, a: -Math.PI / 2, walk: 0, noise: 0, grab: null, grabT: 0, took: 0, called: false, callT: 0, t: 0 });
    sfx.door();
    if (area.kind === 'shop') say(door.name, s.gun ? 'Hold E at the register to rob it' : 'Grab a snack, or come back with a gun', 2.4, '#fff59d');
    else if (area.owner) say('Someone\'s asleep in here', 'Walk, don\'t run (Shift is loud). Hold E to grab things.', 2.8, '#b39ddb');
    else say('House alarm!', 'Hold E at the keypad by the door before it goes off', 2.6, '#ff8a80');
  }

  function leaveArea() {
    const A = area, d = A.door;
    area = null;
    player.x = d.x; player.y = d.y + 16; player.a = Math.PI / 2; player.vx = player.vy = 0;
    cam.x = player.x - W / 2 / cam.z; cam.y = player.y - H / 2 / cam.z;
    cam3.ready = false;
    sfx.door();
    if (A.took) {
      s.robbed = s.robbed || {};
      s.robbed[(d.kind === 'shop' ? 's' : 'h') + d.id] = Date.now() + (d.kind === 'shop' ? 8 : 12) * 60000;
      if (d.kind === 'house') { s.burgles = (s.burgles || 0) + 1; if (s.burgles >= 5) Arcade.flag('getaway-burglar'); }
    }
    if (A.called) {
      addStars(Math.max(stars, A.kind === 'shop' ? 2 : 2), 'Police on the way!');
      for (let k = 0; k < 2; k++) spawnCop();
    }
    persist();
  }

  function areaSolid(x, y, r) {
    if (x < r || y < r || x > area.w - r || y > area.h - r) return true;
    return area.solids.some(b => x > b.x1 - r && x < b.x2 + r && y > b.y1 - r && y < b.y2 + r);
  }

  function updateArea(dt) {
    const A = area, c = controls();
    A.t += dt;
    // Walking, top-down, whatever the view.
    let mx = c.x, my = c.y;
    if (c.stick) { mx = c.stick.x * c.stick.m; my = c.stick.y * c.stick.m; }
    const m = Math.hypot(mx, my), sp = c.boost ? 190 : 110;
    if (m > 0) {
      const vx = mx / Math.max(1, m) * sp, vy = my / Math.max(1, m) * sp;
      A.a = Math.atan2(my, mx);
      A.walk += dt * (c.boost ? 14 : 9);
      const o = { x: A.px, y: A.py, vx, vy };
      if (!areaSolid(A.px + vx * dt, A.py, 9)) A.px += vx * dt;
      if (!areaSolid(A.px, A.py + vy * dt, 9)) A.py += vy * dt;
      A.noise += (c.boost ? 22 : 1.5) * dt;
      void o;
    }
    A.noise = Math.max(0, A.noise - (m > 0 ? 1 : 6) * dt);
    // Out the front door.
    if (A.py > A.h - 22 && Math.abs(A.px - A.w / 2) < 44) return leaveArea();
    // The nearest thing you can grab, or the keypad, held with E.
    const holding = keys.has('KeyE') || keys.has('KeyF') || touchBrake !== false;
    let near = null, bd = 40;
    for (const l of A.loot) { const d = Math.hypot(l.x - A.px, l.y - A.py); if (d < bd) { bd = d; near = l; } }
    if (A.keypad && !A.keypad.done && Math.hypot(A.keypad.x - A.px, A.keypad.y - A.py) < 40) near = A.keypad;
    if (near !== A.grab) { A.grab = near; A.grabT = 0; }
    if (near && holding) {
      if (near === A.keypad) {
        A.grabT += dt;
        if (A.grabT >= 2.2) { near.done = true; A.grab = null; say('Alarm off', 'Now help yourself', 1.6, '#9be37a'); sfx.pickup(); }
      } else {
        const L = LOOT[near.id];
        if (L.holdup && !s.gun) { if (A.grabT === 0) say('The clerk laughs at you', 'You need a gun to rob a shop: try 🔫 Bullseye Guns', 2.4, '#ff8a80'); A.grabT = 0.001; }
        else if (L.slots && bagUsed() + L.slots > BAG_SLOTS) { if (A.grabT === 0) say('Your bag is full', 'Sell it at the 💰 Lucky Pawn', 2, '#ff8a80'); A.grabT = 0.001; }
        else {
          A.grabT += dt;
          A.noise += L.noise * dt;
          if (L.holdup && !A.called) { A.called = true; say('"Don\'t shoot! Take it!"', 'The clerk hit the panic button: the police are coming', 2.6, '#ff8a80'); }
          if (A.grabT >= L.grab) takeLoot(near);
        }
      }
    } else if (A.grab && A.grabT > 0 && !holding) A.grabT = 0;
    // The day alarm: beat the keypad before it runs out.
    if (A.keypad && !A.keypad.done && !A.called) {
      A.keypad.left -= dt;
      if (A.keypad.left <= 0) { A.called = true; say('ALARM!', 'The police are on their way: grab what you can and go', 2.6, '#ff5252'); sfx.bad(); }
    }
    // The night owner: too much noise and they wake up and call it in.
    if (A.owner && !A.owner.awake && A.noise >= 100) {
      A.owner.awake = true;
      A.callT = 10;
      say('The owner woke up!', 'They\'re calling the police: get out!', 2.6, '#ff5252');
      sfx.bad();
    }
    if (A.owner && A.owner.awake && !A.called) { A.callT -= dt; if (A.callT <= 0) A.called = true; }
    // Shoplifting where the clerk can see you.
    // Hiding indoors: any wanted stars fade slowly while you're out of sight.
    if (stars > 0 && !A.called) {
      evadeT += dt * 0.6;
      if (evadeT > 6 + stars * 1.5) { stars--; evadeT = 0; if (stars < 4) heli = null; if (stars === 0) clearStars('They lost you while you hid'); }
    }
  }

  function takeLoot(l) {
    const A = area, L = LOOT[l.id];
    A.loot = A.loot.filter(x => x !== l);
    A.grab = null; A.grabT = 0; A.took++;
    sfx.pickup();
    if (L.cash) {
      const n = Math.round(L.cash[0] + Math.random() * (L.cash[1] - L.cash[0]));
      earn(n, undefined, undefined);
      pops.add(`${L.icon} +${money(n)}`, player.x, player.y - 40, { color: '#9be37a', size: 18 });
      floatsIn.push({ text: `${L.icon} +${money(n)}`, x: l.x, y: l.y, t: 1.2 });
      if (L.holdup) { s.holdups = (s.holdups || 0) + 1; Arcade.flag('getaway-holdup'); }
    } else if (L.story) {
      s.items = [...new Set([...(s.items || []), l.id])];
      floatsIn.push({ text: `${L.icon} Got it!`, x: l.x, y: l.y, t: 1.5 });
      say(L.name, 'That\'s what you came for', 2, '#ffd54f');
    } else {
      s.bag = [...(s.bag || []), l.id];
      floatsIn.push({ text: `${L.icon} ${L.name} · ${money(L.value)}`, x: l.x, y: l.y, t: 1.2 });
    }
  }
  const floatsIn = [];

  function drawArea() {
    const A = area, g = ctx;
    // The whole room fits on screen.
    const z = Math.min(W / (A.w + 40), H / (A.h + 40)), cx = A.w / 2, cy = A.h / 2;
    g.fillStyle = '#111318';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-cx, -cy);
    // Floor.
    g.fillStyle = A.floor;
    g.fillRect(0, 0, A.w, A.h);
    g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 1;
    for (let x = 0; x < A.w; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, A.h); g.stroke(); }
    for (let y = 0; y < A.h; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(A.w, y); g.stroke(); }
    // Rug by the door.
    g.fillStyle = 'rgba(120,60,40,0.35)';
    g.fillRect(A.w / 2 - 50, A.h - 70, 100, 50);
    for (const b of A.solids) {
      if (b.wall) { g.fillStyle = '#3e4451'; g.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); continue; }
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(b.x1 + 4, b.y1 + 5, b.x2 - b.x1, b.y2 - b.y1);
      g.fillStyle = b.color; Gfx.roundRect(g, b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1, 6); g.fill();
      Gfx.text(g, b.label, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, { size: 11, color: 'rgba(255,255,255,0.8)', stroke: null });
    }
    // Loot glints.
    for (const l of A.loot) {
      const L = LOOT[l.id], bob = Math.sin(time * 4 + l.x) * 2;
      g.fillStyle = L.story ? 'rgba(255,213,79,0.45)' : 'rgba(255,255,255,0.35)';
      g.beginPath(); g.arc(l.x, l.y, 18 + Math.sin(time * 5) * 2, 0, TAU); g.fill();
      Gfx.text(g, L.icon, l.x, l.y + bob, { size: 22, stroke: null });
    }
    if (A.keypad && !A.keypad.done) {
      g.fillStyle = A.keypad.left < 3 && Math.floor(time * 6) % 2 ? '#ff1744' : '#263238';
      Gfx.roundRect(g, A.keypad.x - 10, A.keypad.y - 14, 20, 28, 4); g.fill();
      Gfx.text(g, '🔢', A.keypad.x, A.keypad.y - 26, { size: 14, stroke: null });
    }
    if (A.owner) {
      drawPersonAt(g, A.owner.x, A.owner.y, A.owner.awake ? Math.sin(time * 6) : 0, '#ffccbc', A.owner.awake);
      if (!A.owner.awake) Gfx.text(g, 'z Z', A.owner.x + 18, A.owner.y - 22 - Math.sin(time * 2) * 4, { size: 14, color: '#fff' });
      else Gfx.text(g, '📞 !', A.owner.x, A.owner.y - 28, { size: 16, color: '#ff5252' });
    }
    if (A.clerk) {
      drawPersonAt(g, A.clerk.x, A.clerk.y, Math.PI / 2, '#4db6ac', false);
      if (A.called) Gfx.text(g, '😱', A.clerk.x, A.clerk.y - 26, { size: 16, stroke: null });
    }
    // You (with your gun out if you have one).
    drawPersonAt(g, A.px, A.py, A.a, '#7c4dff', false, A.walk);
    // Grab ring.
    if (A.grab && A.grabT > 0) {
      const need = A.grab === A.keypad ? 2.2 : LOOT[A.grab.id].grab;
      g.strokeStyle = '#ffd54f'; g.lineWidth = 4;
      g.beginPath(); g.arc(A.grab.x, A.grab.y, 24, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, A.grabT / need)); g.stroke();
    }
    for (let i = floatsIn.length - 1; i >= 0; i--) {
      const f = floatsIn[i];
      f.t -= 1 / 60;
      if (f.t <= 0) { floatsIn.splice(i, 1); continue; }
      Gfx.text(g, f.text, f.x, f.y - 30 - (1.2 - f.t) * 30, { size: 15, color: '#9be37a' });
    }
    // Night: dim the room, with a pool of light around you.
    if (A.owner) {
      g.fillStyle = 'rgba(10,14,40,0.45)';
      g.fillRect(0, 0, A.w, A.h);
      g.globalCompositeOperation = 'lighter';
      const lg = g.createRadialGradient(A.px, A.py, 5, A.px, A.py, 120);
      lg.addColorStop(0, 'rgba(255,240,200,0.25)'); lg.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = lg; g.fillRect(A.px - 120, A.py - 120, 240, 240);
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();
  }

  function drawAreaHud() {
    const A = area;
    const title = A.kind === 'shop' ? `🏪 ${A.door.name}` : A.door.kane ? "🏠 Kane's house" : '🏠 House';
    Gfx.card(ctx, 12, 12, 260, 40);
    Gfx.text(ctx, `${title} · ${money(s.cash)}`, 24, 32, { size: 15, align: 'left', stroke: null, color: '#fff' });
    // The bag.
    Gfx.card(ctx, 12, H - 64, 260, 52);
    Gfx.text(ctx, `🎒 ${bagUsed()}/${BAG_SLOTS} · worth ${money(bagValue())}`, 24, H - 46, { size: 13, align: 'left', stroke: null });
    Gfx.text(ctx, 'Hold E to grab · walk out the front door to leave', 24, H - 26, { size: 11, align: 'left', stroke: null, color: '#90a4ae' });
    if (A.owner && !A.called) {
      Gfx.card(ctx, W - 232, 12, 220, 40);
      Gfx.text(ctx, A.owner.awake ? `Calling the police… ${Math.ceil(A.callT)}` : 'Noise', W - 220, 26, { size: 11, align: 'left', stroke: null, color: A.owner.awake ? '#ff5252' : '#cfd8dc' });
      Gfx.bar(ctx, W - 220, 34, 196, 9, Math.min(1, A.noise / 100), A.noise > 70 ? '#ff5252' : '#ffd54f');
    }
    if (A.keypad && !A.keypad.done && !A.called) {
      Gfx.card(ctx, W - 232, 12, 220, 40);
      Gfx.text(ctx, `Alarm in ${A.keypad.left.toFixed(1)} s`, W - 122, 32, { size: 15, stroke: null, color: '#ff8a80' });
    }
    if (A.called) Gfx.text(ctx, '🚨 The police are coming. Get out!', W / 2, 30, { size: 16, color: '#ff5252' });
    const near = A.grab;
    if (near && near !== A.keypad) { const L = LOOT[near.id]; Gfx.text(ctx, `${L.icon} ${L.name}${L.value ? ' · ' + money(L.value) : ''} · hold E`, W / 2, H - 90, { size: 14 }); }
    else if (near) Gfx.text(ctx, '🔢 Hold E to disarm', W / 2, H - 90, { size: 14 });
    if (banner) {
      ctx.globalAlpha = clamp(banner.t / 0.4, 0, 1);
      Gfx.text(ctx, banner.text, W / 2, H / 2 - 120, { size: 28, color: banner.color, width: 6 });
      if (banner.sub) Gfx.text(ctx, banner.sub, W / 2, H / 2 - 90, { size: 14, width: 4 });
      ctx.globalAlpha = 1;
    }
  }

  // drawPerson draws into the shared ctx; this does the same into any context.
  function drawPersonAt(g, x, y, a, color, alarm, step = 0) {
    const keep = ctx;
    ctx = g;
    drawPerson(x, y, a, color, '#ffe0bd', step, false);
    if (g === keep && s.gun && color === '#7c4dff') drawGunInHand(x, y, a);
    ctx = keep;
    void alarm;
  }
  function drawGunInHand(x, y, a) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = '#212121';
    ctx.fillRect(4, 3, s.gun === 'pistol' ? 9 : 14, 3);
    ctx.restore();
  }

  // ---------- Guns ----------
  // Guns only hurt vehicles: a shot car smokes and breaks down, and people dive for cover rather
  // than get hit. Firing where anyone can see brings the police; shooting at them brings more.

  const GUNS = {
    pistol: { name: 'Pistol', price: 1500, ammo: 24, ammoPrice: 80, dmg: 24, rate: 0.3, range: 440, spread: 0.03, pellets: 1, tone: 900 },
    smg: { name: 'SMG', price: 6000, ammo: 90, ammoPrice: 160, dmg: 11, rate: 0.085, range: 380, spread: 0.07, pellets: 1, tone: 1200 },
    shotgun: { name: 'Shotgun', price: 9000, ammo: 16, ammoPrice: 180, dmg: 12, rate: 0.85, range: 270, spread: 0.2, pellets: 6, tone: 300 },
  };
  let gunT = 0;
  const tracers = [];
  function switchGun() {
    const owned = Object.keys(GUNS).filter(id => (s.guns || {})[id] !== undefined);
    if (!owned.length) return say('No guns yet', 'Bullseye Guns sells them', 1.6, '#90a4ae');
    const order = [null, ...owned], i = order.indexOf(s.gun || null);
    s.gun = order[(i + 1) % order.length];
    say(s.gun ? GUNS[s.gun].name : 'Holstered', s.gun ? `${s.guns[s.gun]} rounds · Space to fire` : '', 1.2, '#cfd8dc');
  }
  function updateGun(dt) {
    gunT = Math.max(0, gunT - dt);
    for (let i = tracers.length - 1; i >= 0; i--) { tracers[i].t -= dt; if (tracers[i].t <= 0) tracers.splice(i, 1); }
    if (!s.gun || player.car || !held('Space') || gunT > 0) return;
    const G = GUNS[s.gun];
    if (!(s.guns[s.gun] > 0)) { gunT = 0.4; Arcade.tone({ freq: 200, dur: 0.04, type: 'square', vol: 0.03 }); return say('Out of ammo', 'Bullseye Guns sells more', 1.4, '#ff8a80'); }
    gunT = G.rate;
    s.guns[s.gun]--;
    // Aim help: the nearest car roughly where you're facing, police first.
    let aim = player.a, best = null, bs = Infinity;
    for (const c of cars) {
      if (c.broken) continue;
      const dx = c.x - player.x, dy = c.y - player.y, d = Math.hypot(dx, dy);
      if (d > G.range || Math.abs(angDiff(Math.atan2(dy, dx), player.a)) > 0.5) continue;
      const sc = d - (c.role === 'cop' ? 200 : 0);
      if (sc < bs) { bs = sc; best = c; }
    }
    if (best) aim = Math.atan2(best.y - player.y, best.x - player.x);
    let hitCop = false;
    for (let p = 0; p < G.pellets; p++) {
      const a = aim + (Math.random() * 2 - 1) * G.spread, ca = Math.cos(a), sa = Math.sin(a);
      let x = player.x, y = player.y, hit = null;
      for (let d = 12; d <= G.range; d += 10) {
        x = player.x + ca * d; y = player.y + sa * d;
        if (inBuilding(x, y)) break;
        hit = cars.find(c => !c.broken && Math.hypot(c.x - x, c.y - y) < c.T.len * 0.42);
        if (hit) break;
      }
      tracers.push({ x1: player.x + ca * 10, y1: player.y + sa * 10, x2: x, y2: y, t: 0.07 });
      if (!hit) continue;
      const wasCop = hit.role === 'cop';
      damage(hit, G.dmg);
      hit.flash = 0.1;
      for (let k = 0; k < 4; k++) fx.emit({ x, y, vx: Gfx.rand(-120, 120), vy: Gfx.rand(-120, 120), drag: 3, life: 0.25, size: 2, color: '#ffe082', shape: 'spark' });
      if (wasCop) {
        hitCop = true;
        if (hit.broken) { s.copsDown = (s.copsDown || 0) + 1; pops.add('Cruiser disabled!', hit.x, hit.y - 30, { color: '#80deea', size: 16 }); }
      } else if (hit.role === 'traffic' && hit.ai) { hit.ai.speed = 280; hit.honk = 0.4; }
    }
    Arcade.tone({ freq: G.tone, to: G.tone / 4, dur: 0.07, type: 'square', vol: 0.04 });
    shake.add(s.gun === 'shotgun' ? 0.18 : 0.06);
    // People scatter.
    for (const p of peds) if (Math.hypot(p.x - player.x, p.y - player.y) < 340) { p.flee = 4; if (Math.random() < 0.05) pops.add(Arcade.pick(['Run!', 'Aaah!', 'Get down!']), p.x, p.y - 20, { color: '#fff', size: 14, life: 0.8 }); }
    if (hitCop) addStars(Math.min(MAX_STARS, Math.max(2, stars + (Math.random() < 0.25 ? 1 : 0))), stars < 2 ? 'Shot at the police!' : null);
    else if (stars < 1 && (copSees(800) || Math.random() < 0.06)) bumpStars('Shots fired!');
    if (hitCop || stars) evadeT = 0;
  }
  function drawTracers2d() {
    ctx.strokeStyle = 'rgba(255,236,160,0.9)'; ctx.lineWidth = 2;
    for (const t of tracers) { ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke(); }
  }
  function drawTracers3d() {
    ctx.strokeStyle = 'rgba(255,236,160,0.9)'; ctx.lineWidth = 2;
    for (const t of tracers) {
      const a = project(t.x1, groundAt(t.x1, t.y1) + 12, t.y1), b = project(t.x2, groundAt(t.x2, t.y2) + 10, t.y2);
      if (!a || !b) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  // ---------- Shops and the subway ----------

  function gunPanel() {
    const rows = Object.entries(GUNS).map(([id, G]) => {
      const own = (s.guns || {})[id] !== undefined;
      return `<div class="gc-row"><span class="gc-ico">🔫</span><span class="gc-info"><b>${G.name}</b><small>${own ? `${s.guns[id]} rounds` : `Damage ${G.dmg}${G.pellets > 1 ? ' × ' + G.pellets : ''} · range ${G.range}`}</small></span>
        <button class="btn gc-buy" type="button" data-gun="${id}" ${own ? (s.cash < G.ammoPrice ? 'disabled' : '') : s.cash < G.price ? 'disabled' : ''}>${own ? `+${G.ammo} ammo ${money(G.ammoPrice)}` : money(G.price)}</button></div>`;
    }).join('');
    ui.show({
      title: '🔫 Bullseye Guns',
      html: `<p class="gc-cash">${money(s.cash)}</p><div class="gc-list">${rows}</div><p style="font-size:12px;color:var(--muted)"><b>Q</b> draws or switches guns, <b>Space</b> fires (on foot). Guns stop cars, not people. Shooting where it's seen brings the police.</p>`,
      button: 'Leave',
      onAction: () => ui.hide(),
      onRender: panel => panel.querySelectorAll('[data-gun]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.gun, G = GUNS[id];
        s.guns = s.guns || {};
        if (s.guns[id] !== undefined) { if (s.cash < G.ammoPrice) return; s.cash -= G.ammoPrice; s.guns[id] += G.ammo; }
        else { if (s.cash < G.price) return; s.cash -= G.price; s.guns[id] = G.ammo; s.gun = id; Arcade.flag('getaway-armed'); }
        sfx.good(); persist(); gunPanel();
      })),
    });
  }

  function pawnPanel() {
    const bag = s.bag || [];
    const counts = {};
    for (const id of bag) counts[id] = (counts[id] || 0) + 1;
    const rows = Object.entries(counts).map(([id, n]) => `<div class="gc-row"><span class="gc-ico">${LOOT[id].icon}</span><span class="gc-info"><b>${LOOT[id].name}${n > 1 ? ' × ' + n : ''}</b><small>${money(LOOT[id].value)} each</small></span></div>`).join('');
    ui.show({
      title: '💰 Lucky Pawn',
      html: `<p class="gc-cash">${money(s.cash)}</p>${bag.length ? `<div class="gc-list">${rows}</div>` : '<p>Your bag is empty. Rob a house (walk up to a front door in the suburbs) and bring me what you find.</p>'}${stars ? '<p style="color:#ff8a80">"Not with the cops on you. Lose them and come back."</p>' : ''}`,
      button: bag.length && !stars ? `Sell it all for ${money(bagValue())}` : 'Leave',
      onAction: () => {
        ui.hide();
        if (!bag.length || stars) return;
        const v = bagValue();
        s.bag = [];
        earn(v, player.x, player.y - 40, 'Sold');
        persist();
      },
    });
  }

  function metroPanel(from) {
    const fare = 25;
    const rows = stations.filter(m => m !== from).map((m, i) => `<div class="gc-row"><span class="gc-ico">🚇</span><span class="gc-info"><b>${m.name}</b><small>${Math.round(dist(m, from) / 10)} m away</small></span>
      <button class="btn gc-buy" type="button" data-go="${stations.indexOf(m)}" ${stars || s.cash < fare ? 'disabled' : ''}>${money(fare)}</button></div>`).join('');
    ui.show({
      title: `🚇 ${from.name}`,
      html: `<p>Ride the subway across town. Your car stays parked here.</p><div class="gc-list">${rows}</div>${stars ? '<p style="color:#ff8a80">The police are watching the stations. Lose them first.</p>' : ''}`,
      button: 'Leave',
      onAction: () => ui.hide(),
      onRender: panel => panel.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
        if (stars || s.cash < fare) return;
        const to = stations[+b.dataset.go];
        s.cash -= fare;
        if (player.car) exitCar(true);
        player.x = to.x; player.y = to.y + 46; player.vx = player.vy = 0;
        cam.x = player.x - W / 2 / cam.z; cam.y = player.y - H / 2 / cam.z;
        cam3.ready = false;
        // A fresh street around you.
        for (let i = cars.length - 1; i >= 0; i--) if (cars[i].role === 'traffic') cars.splice(i, 1);
        peds.length = 0;
        inMarker = to;
        ui.hide();
        say(to.name, 'Doors closing…', 1.8, '#f48fb1');
        Arcade.tone({ freq: 660, to: 440, dur: 0.3, type: 'triangle', vol: 0.05 });
        persist();
      })),
    });
  }

  // ---------- Story: Rise of the Getaway King ----------
  // Seven chapters told by Vinnie (who runs the diner and fences on the side), Mara (a hacker at the
  // docks) and Detective Kane (who wants you in a cell). Each chapter is a list of steps built from
  // the city's own pieces: steal a car, burgle a house, hold up a shop, lose the police, deliver.

  const STORY = [
    { title: 'New Wheels', who: 'Vinnie', reward: 600,
      lines: ['"New in town? Nobody respects a pedestrian, kid."', '"Bring me a Cruiser Sedan. Clean. No dents, no cops."'],
      steps: [{ t: 'steal', car: 'sedan', label: 'Steal the marked Cruiser Sedan' }, { t: 'deliver', to: 'story', minHp: 0.5, label: "Bring it to Vinnie's Diner" }] },
    { title: 'House Call', who: 'Vinnie', reward: 900,
      lines: ['"Councilman Reyes keeps a little black ledger at home."', '"Night is best: people sleep. Walk soft."'],
      steps: [{ t: 'burgle', item: 'ledger', label: "Get the ledger from the councilman's house" }, { t: 'lose', label: 'Lose any cops' }, { t: 'goto', to: 'story', label: 'Take it to Vinnie' }] },
    { title: 'Hardware', who: 'Vinnie', reward: 800, advance: 1500,
      lines: ['"The ledger names a cop. Things are going to get rough."', '"Here\'s $1,500. Buy a pistol at Bullseye, then show me you can use it: rob a shop."'],
      steps: [{ t: 'buy', gun: 'pistol', label: 'Buy a pistol at 🔫 Bullseye Guns' }, { t: 'holdup', label: 'Hold up a corner shop' }, { t: 'lose', label: 'Lose the police' }, { t: 'goto', to: 'story', label: 'Back to the diner' }] },
    { title: 'Kane', who: 'Detective Kane', reward: 1200,
      lines: ['A grey sedan idles outside the diner. A man in a long coat leans on it.', '"Detective Kane. I know what you took from Reyes. Run along, I\'ll catch up."'],
      steps: [{ t: 'stars', n: 3, why: "Kane's crew is on you!" }, { t: 'lose', label: "Shake off Kane's crew" }, { t: 'goto', to: 'docks', label: 'Hide out at the 🚢 Export Docks' }] },
    { title: 'Showroom Fresh', who: 'Mara', reward: 2500,
      lines: ['A woman with a laptop sits on a shipping crate. "Mara. Vinnie said you\'re quick."', '"My buyer wants a Vento Sport, and he pays for paint, not dents."'],
      steps: [{ t: 'steal', car: 'sports', label: 'Steal the marked Vento Sport' }, { t: 'deliver', to: 'docks', minHp: 0.7, label: 'Deliver it to the docks (keep it above 70%)' }] },
    { title: 'Blind Spots', who: 'Mara', reward: 3000, needs: () => Object.keys(s.guns || {}).length ? '' : 'Mara wants you armed: buy a gun at 🔫 Bullseye Guns first.',
      lines: ['"Kane\'s men patrol in those old cruisers. Take three out of service."', '"I\'ll loop the traffic cameras. You make some noise."'],
      steps: [{ t: 'stars', n: 2, why: 'Patrols incoming!' }, { t: 'shoot', n: 3, label: 'Disable 3 police cruisers (shoot them)' }, { t: 'lose', label: 'Lose the police' }, { t: 'goto', to: 'docks', label: 'Report back to Mara' }] },
    { title: "Kane's File", who: 'Vinnie', reward: 15000, needs: () => (s.heists ? '' : 'Vinnie wants proof you can handle a real job: pull off any 💼 heist first.'),
      lines: ['"Kane\'s dirty. He keeps an evidence file at home on everyone he squeezes."', '"Get it to the City Herald and he\'s finished. Then this town is ours."'],
      steps: [{ t: 'burgle', item: 'file', kane: true, label: "Get the evidence file from Kane's house" }, { t: 'stars', n: 5, why: 'Kane sent everyone!' }, { t: 'lose', label: 'Lose them all' }, { t: 'goto', to: 'herald', label: 'Deliver the file to the 📰 City Herald' }] },
  ];

  function storyStep() { return mission && mission.kind === 'story' ? mission.steps[mission.i] : null; }
  const placeOf = kind => markerOf(kind);

  function storyPanel() {
    const ch = STORY[s.story || 0];
    if (!ch) return ui.show({ title: "🍝 Vinnie's Diner", html: '<p>"Kane\'s in a cell, the Herald\'s printing his file, and you run this town now. Coffee\'s on the house, King."</p>', button: 'Leave', onAction: () => ui.hide() });
    const blocked = ch.needs ? ch.needs() : '';
    ui.show({
      title: `📖 Chapter ${(s.story || 0) + 1}: ${ch.title}`,
      html: `<p style="text-align:left"><b>${ch.who}</b></p>${ch.lines.map(l => `<p style="text-align:left">${l}</p>`).join('')}<p class="gc-cash">${money(ch.reward)}</p>${blocked ? `<p style="color:#ff8a80">${blocked}</p>` : ''}${mission ? '<p style="color:#ff8a80">Finish your current job first.</p>' : ''}`,
      button: blocked || mission ? 'OK' : 'Let\'s go',
      onAction: () => {
        ui.hide();
        if (blocked || mission) return;
        if (ch.advance) earn(ch.advance, player.x, player.y - 40, 'Advance');
        mission = { kind: 'story', ch, steps: ch.steps.map(x => ({ ...x })), i: 0, label: ch.title };
        startStep();
      },
    });
  }

  function startStep() {
    const m = mission, st = m.steps[m.i];
    m.base = { holdups: s.holdups || 0, copsDown: s.copsDown || 0 };
    if (st.t === 'steal') {
      const p = randomSidewalk(1100, 2600);
      st.carRef = makeCar(st.car, p.x, p.y, Math.random() * TAU, 'parked');
      st.carRef.keep = true;
    } else if (st.t === 'deliver') {
      st.carRef = m.steps[m.i - 1].carRef;
    } else if (st.t === 'burgle') {
      st.door = st.kane ? kaneDoor : doors.filter(d => d.kind === 'house' && !d.kane).sort((a, b) => Math.abs(dist(a, placeOf('story')) - 1600) - Math.abs(dist(b, placeOf('story')) - 1600))[0];
      s.items = (s.items || []).filter(x => x !== st.item);
    } else if (st.t === 'stars') {
      addStars(st.n, st.why);
      for (let k = 0; k < st.n; k++) spawnCop();
      return nextStep();
    }
    say(m.ch.title, st.label, 2.6, '#ffd54f');
  }
  function nextStep() {
    const m = mission;
    m.i++;
    if (m.i < m.steps.length) return startStep();
    // Chapter done.
    for (const st of m.steps) if (st.carRef) { const k = cars.indexOf(st.carRef); if (k >= 0 && st.carRef !== player.car) cars.splice(k, 1); else st.carRef.keep = false; }
    const ch = m.ch;
    mission = null;
    s.story = (s.story || 0) + 1;
    earn(ch.reward, player.x, player.y - 40, ch.title);
    say(`Chapter complete: ${ch.title}`, s.story < STORY.length ? "Vinnie's Diner has your next job" : 'You are the Getaway King', 3.4, '#ffd54f');
    sfx.good();
    Arcade.flag('getaway-story-1');
    if (s.story >= STORY.length) Arcade.flag('getaway-story');
    persist();
  }
  function updateStory() {
    const m = mission, st = m.steps[m.i], here = player.car || player, slow = !player.car || speedOf(player.car) < 80;
    const at = kind => { const p = placeOf(kind); return Math.hypot(here.x - p.x, here.y - p.y) < 60 && slow; };
    if (st.carRef && st.carRef.broken) return failMission('The car got wrecked');
    if (st.t === 'steal' && player.car === st.carRef) { if (Math.random() < 0.4) bumpStars('Car alarm!'); nextStep(); }
    else if (st.t === 'deliver' && player.car === st.carRef && at(st.to)) {
      if (stars) { if (!m.warned) { say('Not with the cops on you', 'Lose them first', 2, '#ff8a80'); m.warned = true; } return; }
      if (st.minHp && st.carRef.hp / st.carRef.T.hp < st.minHp) return failMission(`Too banged up: it needed to be over ${Math.round(st.minHp * 100)}%`);
      player.car.vx = player.car.vy = 0;
      nextStep();
    } else if (st.t === 'goto' && at(st.to)) {
      if (stars) { if (!m.warned) { say('Not with the cops on you', 'Lose them first', 2, '#ff8a80'); m.warned = true; } return; }
      nextStep();
    } else if (st.t === 'burgle' && (s.items || []).includes(st.item) && !area) nextStep();
    else if (st.t === 'buy' && (s.guns || {})[st.gun] !== undefined) nextStep();
    else if (st.t === 'holdup' && (s.holdups || 0) > m.base.holdups && !area) nextStep();
    else if (st.t === 'shoot' && (s.copsDown || 0) - m.base.copsDown >= st.n) nextStep();
    else if (st.t === 'lose' && stars === 0) nextStep();
    else if (st.t === 'shoot' && stars < 2) { addStars(2, 'More patrols!'); spawnCop(); }
  }
  function storyTarget() {
    const st = storyStep();
    if (!st) return null;
    if (st.t === 'steal') return { x: st.carRef.x, y: st.carRef.y, color: '#ffd54f' };
    if ((st.t === 'deliver' && player.car === st.carRef) || st.t === 'goto') { const p = placeOf(st.to); return { x: p.x, y: p.y, color: '#ffd54f' }; }
    if (st.t === 'deliver') return { x: st.carRef.x, y: st.carRef.y, color: '#ffd54f' };
    if (st.t === 'burgle') return { x: st.door.x, y: st.door.y, color: '#ffd54f' };
    if (st.t === 'buy') { const p = placeOf('guns'); return { x: p.x, y: p.y, color: '#ffd54f' }; }
    if (st.t === 'holdup') { let b = null, bd = Infinity; for (const d of doors) if (d.kind === 'shop') { const k = dist(d, player); if (k < bd) { bd = k; b = d; } } return b && { x: b.x, y: b.y, color: '#ffd54f' }; }
    return null;
  }
  function storyText() {
    const m = mission, st = m.steps[m.i];
    if (st.t === 'deliver' && player.car !== st.carRef) return `${m.ch.title}: get back in the car`;
    if (st.t === 'shoot') return `${m.ch.title}: disable cruisers ${(s.copsDown || 0) - m.base.copsDown}/${st.n}`;
    return `${m.ch.title}: ${st.label}${stars && (st.t === 'goto' || st.t === 'deliver') ? ' (lose the cops first)' : ''}`;
  }

  // ---------- New jobs: courier, tow truck, car boosting ----------

  const BOOST_MODELS = ['muscle', 'sports', 'beast', 'super'];
  function startJob(m) {
    if (m.kind === 'courier') {
      const drops = [];
      let from = m;
      for (let k = 0; k < 5; k++) { const p = randomSidewalk(400, 1300, from); drops.push(p); from = p; }
      mission = { kind: 'courier', needsCar: true, drops, done: 0, timer: 170, label: 'Courier run', earned: 0, hp0: player.car ? player.car.hp / player.car.T.hp : 1 };
      say('Courier run', '5 parcels, 170 seconds. They\'re fragile: drive nicely.', 2.6, '#c5e1a5');
    } else if (m.kind === 'tow') {
      if (player.car) exitCar(true);
      const truck = makeCar('tow', m.x + 70, m.y + 80, 0, 'player');
      truck.keep = true;
      player.car = truck; player.x = truck.x; player.y = truck.y;
      player.nitro = nitroCap();
      mission = { kind: 'tow', needsCar: true, truck, done: 0, stage: 'find', target: towTarget(), label: 'Tow shift', yard: m };
      say('Tow shift', 'Hook up broken-down cars and haul them back to the yard', 2.6, '#ffcc80');
    } else if (m.kind === 'docks') {
      const model = BOOST_MODELS[Math.min(BOOST_MODELS.length - 1, Math.floor(Math.random() * (1 + Math.min(3, (s.boosts || 0)))))];
      const p = randomSidewalk(1500, 3200);
      const car = makeCar(model, p.x, p.y, Math.random() * TAU, 'parked');
      car.keep = true;
      mission = { kind: 'boost', target: car, stage: 'steal', model, label: `Boost a ${CARS[model].name}`, dock: m };
      say('Car boosting', `The client wants a ${CARS[model].name}. Bring it here without wrecking it.`, 2.8, '#81d4fa');
    }
  }
  function towTarget() {
    const p = randomSidewalk(900, 2600);
    const car = makeCar(Arcade.pick(['compact', 'sedan', 'van', 'muscle']), p.x, p.y, Math.random() * TAU, 'parked');
    car.broken = true; car.hp = 0; car.keep = true;
    return car;
  }
  function updateJob(dt) {
    const m = mission, pc = player.car;
    if (m.kind === 'courier') {
      m.timer -= dt;
      if (m.timer <= 0) return failMission('Too slow: the parcels went back to the depot');
      const tgt = m.drops[m.done];
      if (Math.hypot(pc.x - tgt.x, pc.y - tgt.y) < 50 && speedOf(pc) < 90) {
        m.done++;
        const fragile = pc.hp / pc.T.hp < m.hp0 * 0.6 ? 0.5 : 1;
        const pay = Math.round(110 * fragile);
        earn(pay, pc.x, pc.y - 40, fragile < 1 ? 'Dented parcel' : 'Delivered');
        m.earned += pay;
        sfx.pickup();
        if (m.done >= m.drops.length) {
          const bonus = Math.round(m.timer * 8);
          earn(bonus, pc.x, pc.y - 70, 'Time bonus');
          s.couriers = (s.couriers || 0) + 1;
          say('All parcels delivered!', `${money(m.earned + bonus)} earned`, 2.6, '#9be37a');
          sfx.good(); mission = null; persist();
        }
      }
    } else if (m.kind === 'tow') {
      if (pc !== m.truck) return failMission('You left the tow truck');
      const t = m.target, T = m.truck;
      if (m.stage === 'find') {
        if (Math.hypot(T.x - t.x, T.y - t.y) < 70 && speedOf(T) < 60) { m.stage = 'haul'; t.role = 'towed'; t.haulFrom = { x: t.x, y: t.y }; say('Hooked up', 'Haul it back to the yard', 1.6, '#ffcc80'); sfx.door(); }
      } else {
        const back = T.T.len / 2 + t.T.len / 2 + 16;
        t.x = T.x - Math.cos(T.a) * back; t.y = T.y - Math.sin(T.a) * back;
        t.a += angDiff(T.a, t.a) * Math.min(1, dt * 6);
        t.vx = T.vx; t.vy = T.vy; t.z = 0;
        if (Math.hypot(T.x - m.yard.x, T.y - m.yard.y) < 80 && speedOf(T) < 80) {
          const pay = Math.round(200 + Math.hypot(t.haulFrom.x - m.yard.x, t.haulFrom.y - m.yard.y) / 8);
          earn(pay, T.x, T.y - 40, 'Towed');
          cars.splice(cars.indexOf(t), 1);
          m.done++;
          if (m.done >= 3) { s.tows = (s.tows || 0) + 1; say('Shift done!', 'Three cars hauled', 2.4, '#9be37a'); sfx.good(); mission = null; T.keep = false; persist(); }
          else { m.target = towTarget(); m.stage = 'find'; say('Next call', 'Another breakdown across town', 1.6, '#ffcc80'); }
        }
      }
    } else if (m.kind === 'boost') {
      const t = m.target;
      if (t.broken) { t.keep = false; return failMission('The car is wrecked: the client walked'); }
      if (m.stage === 'steal' && pc === t) { m.stage = 'deliver'; if (Math.random() < 0.5) bumpStars('Car alarm!'); say('Got it', 'Get it to the docks. Clean.', 1.6, '#81d4fa'); }
      if (m.stage === 'deliver' && pc === t && Math.hypot(t.x - m.dock.x, t.y - m.dock.y) < 70 && speedOf(t) < 80) {
        if (stars) { if (!m.warned) { say('The buyer won\'t take a hot car', 'Lose the cops first', 2, '#ff8a80'); m.warned = true; } return; }
        const pay = Math.round(CARS[m.model].price * 0.35 * (0.4 + 0.6 * t.hp / t.T.hp));
        exitCar(true);
        cars.splice(cars.indexOf(t), 1);
        earn(pay, player.x, player.y - 40, 'Boosted');
        s.boosts = (s.boosts || 0) + 1;
        if (s.boosts >= 3) Arcade.flag('getaway-boost');
        say('Sold to the exporter', `${money(pay)} for the ${CARS[m.model].name}`, 2.6, '#9be37a');
        sfx.good(); mission = null; persist();
      }
    }
  }
  function jobTarget() {
    const m = mission;
    if (m.kind === 'courier') return { ...m.drops[m.done], color: '#9ccc65' };
    if (m.kind === 'tow') return m.stage === 'find' ? { x: m.target.x, y: m.target.y, color: '#ff9800' } : { x: m.yard.x, y: m.yard.y, color: '#ff9800' };
    if (m.kind === 'boost') return player.car === m.target ? { x: m.dock.x, y: m.dock.y, color: '#29b6f6' } : { x: m.target.x, y: m.target.y, color: '#29b6f6' };
    return null;
  }
  function jobText() {
    const m = mission;
    if (m.kind === 'courier') return `Deliver parcel ${m.done + 1}/${m.drops.length} · ${Math.ceil(m.timer)} s`;
    if (m.kind === 'tow') return m.stage === 'find' ? `Find the broken-down car (${m.done + 1}/3)` : 'Haul it back to the tow yard';
    if (m.kind === 'boost') return player.car === m.target ? `Deliver the ${CARS[m.model].name} to the docks${stars ? ' (lose the cops first)' : ''}` : m.stage === 'steal' ? `Steal the marked ${CARS[m.model].name}` : 'Get back in the car';
    return '';
  }
  const JOB_INFO = {
    courier: () => ({ title: '📦 Swift Parcel', html: '<p>Five parcels across town in 170 seconds. Smash up your car and the parcels get dented: half pay.</p>', ok: true }),
    tow: () => ({ title: '🛻 Hook & Haul Towing', html: '<p>Take the company tow truck, hook up three broken-down cars and haul them back to the yard. Longer hauls pay more.</p>', ok: true, noCar: true }),
    docks: () => ({ title: '🚢 Export Docks', html: '<p>The exporter has a client. Steal the model they want, lose any heat, and deliver it in one piece. The better its condition, the better the pay.</p>', ok: true, noCar: true }),
  };

  // ---------- Online: two friends in one city (live.js) ----------
  // The city is the same for everyone (it's seeded), so nothing big has to be sent. Each player
  // keeps their own save, cash, jobs, traffic and police; what goes back and forth is where you
  // are and what you're driving, 15 times a second. On top of that: bumping into each other,
  // "Join my friend" to meet up, and a head-to-head race to a finish line you both see.

  const FRIEND_COLOR = '#26c6da';
  const friend = { x: 0, y: 0, a: 0, car: null, color: '#fff', z: 0, walk: 0, stars: 0, net: null };
  let netT = 0, onlineError = '';
  const live = Live.create({
    ui,
    tag: 'getaway',
    label: 'Free roam',
    title: 'Free roam',
    onReady: () => { friend.net = null; ui.hide(); say('Online with a friend', 'You each keep your own cash, jobs and police. Pause for a race!', 3.2, FRIEND_COLOR); },
    onEvent: onNet,
    onState: d => {
      if (!d) return;
      const first = !friend.net;
      friend.net = { ...d, at: performance.now() };
      if (first) { friend.x = +d.x || 0; friend.y = +d.y || 0; friend.a = +d.a || 0; }
    },
    onGone: lost => {
      friend.net = null;
      if (mission && mission.kind === 'duel') mission = null;
      say(lost ? 'Lost the connection' : `${live.them} left the city`, '', 2.4, FRIEND_COLOR);
    },
    onCancel: msg => { onlineError = msg || ''; showIntro(); },
  });
  const online = () => live.on && !!friend.net;

  // ---------- Public lobby: up to 8 players in one city (public-lobby.js) ----------
  // Like a friend session, with whoever drops in. Everyone keeps their own save, jobs, traffic and
  // police; you see each other drive and walk about, and bump cars.
  const CROWD_COLORS = ['#ffb74d', '#81c784', '#f06292', '#64b5f6', '#ba68c8', '#4db6ac', '#fff176', '#ff8a65'];
  const crowd = new Map();      // slot -> puppet
  let pub = null, pubError = '', pubToken = 0;
  const pubOn = () => !!pub;
  const addPuppet = (slot, name) => crowd.set(slot, { x: 0, y: 0, a: 0, car: null, color: '#fff', z: 0, walk: 0, stars: 0, net: null, name: String(name || 'Player').slice(0, 24), tagColor: CROWD_COLORS[slot % CROWD_COLORS.length] });
  async function joinPub(reshow) {
    live.leave(); friend.net = null;
    const token = ++pubToken;
    ui.show({ title: 'Finding a public city…', html: Relay.CONNECTING, button: 'Cancel', onAction: () => { pubToken++; reshow(); }, onRender: Relay.ticker });
    try {
      const lobby = await PublicLobby.join(ID, {
        onJoined: d => { addPuppet(d.slot, d.name); say(`${d.name} rolled into town`, '', 1.8, '#ffe0b2'); },
        onLeft: d => { crowd.delete(d.slot); if (d.name) say(`${d.name} left town`, '', 1.6, '#cfd8dc'); },
        onState: (slot, st) => {
          const p = crowd.get(slot);
          if (!p || !st) return;
          const first = !p.net;
          p.net = { ...st, at: performance.now() };
          if (first) { p.x = +st.x || 0; p.y = +st.y || 0; p.a = +st.a || 0; }
        },
        onClosed: () => { leavePub(); say('Lost the connection', 'You\'re back on your own', 2.4, '#ff8a80'); },
      });
      if (token !== pubToken) return lobby.leave();
      pub = { lobby };
      crowd.clear();
      for (const [slot, name] of lobby.names) if (slot !== lobby.slot) addPuppet(slot, name);
      Arcade.flag('getaway-public');
      ui.hide();
      say('Public city', `${lobby.names.size} player${lobby.names.size === 1 ? '' : 's'} in town. Everyone keeps their own cash and cops.`, 3, '#ffe0b2');
    } catch (e) {
      if (token !== pubToken) return;
      pubError = e.message || "Couldn't join a public city.";
      reshow();
    }
  }
  function leavePub() {
    if (pub) pub.lobby.leave();
    pub = null;
    crowd.clear();
  }

  function onlineHtml() {
    if (live.on) {
      return `<p class="bf-label" style="color:${FRIEND_COLOR};text-align:left;margin:10px 0 4px">Online with ${Online.escape(live.them)}</p>
        <div class="menu">
          <button class="btn secondary" type="button" data-race ${online() && !mission ? '' : 'disabled'}>🏁 Race ${Online.escape(live.them)} to a finish line</button>
          <button class="btn secondary" type="button" data-meet ${online() ? '' : 'disabled'}>📍 Join my friend</button>
          <button class="btn secondary" type="button" data-leave-online>Leave online</button>
        </div>`;
    }
    if (pub) {
      return `<p class="bf-label" style="color:#ffe0b2;text-align:left;margin:10px 0 4px">In a public city · ${pub.lobby.names.size} player${pub.lobby.names.size === 1 ? '' : 's'}</p>
        <div class="menu"><button class="btn secondary" type="button" data-leave-pub>Leave the public city</button></div>`;
    }
    if (!live.enabled()) return '';
    const err = onlineError || pubError;
    onlineError = ''; pubError = '';
    return `<p style="text-align:left;margin:10px 0 4px;font-size:13px"><b>Public city:</b> drop into a city with up to 7 other players.</p>
      <div class="menu"><button class="btn" type="button" data-pub>Join a public city</button></div>
      <p style="text-align:left;margin:10px 0 4px;font-size:13px"><b>Play with a friend online:</b> drive the same city together, meet up and race each other.</p>
      ${live.html()}<p class="error">${Online.escape(err)}</p>`;
  }
  function wireOnline(panel, reshow) {
    live.wire(panel);
    panel.querySelector('[data-pub]')?.addEventListener('click', () => joinPub(reshow));
    panel.querySelector('[data-leave-pub]')?.addEventListener('click', () => { leavePub(); reshow(); });
    panel.querySelector('[data-race]')?.addEventListener('click', () => { ui.hide(); challenge(); });
    panel.querySelector('[data-meet]')?.addEventListener('click', () => { ui.hide(); meetUp(); });
    panel.querySelector('[data-leave-online]')?.addEventListener('click', () => {
      if (mission && mission.kind === 'duel') mission = null;
      live.leave();
      friend.net = null;
      reshow();
    });
  }

  function onNet(name, d) {
    d = d || {};
    if (name === 'race') {
      // Your friend wants a race. Say no if you're in the middle of something.
      if (mission || bustT > 0) return live.send('race-busy', { why: mission ? mission.label || 'a job' : 'busted' });
      live.send('race-ok', {});
      startDuel(+d.x, +d.y);
    } else if (name === 'race-ok' && pendingRace) {
      startDuel(pendingRace.x, pendingRace.y);
      pendingRace = null;
    } else if (name === 'race-busy') {
      pendingRace = null;
      say(`${live.them} is busy`, `They're on ${String(d.why || 'a job').slice(0, 30)}`, 2.2, '#ff8a80');
    } else if (name === 'race-won' && mission && mission.kind === 'duel') {
      mission = null;
      Relay.result('l');
      say(`${live.them} won the race`, `They crossed the line in ${(+d.t || 0).toFixed(1)} s`, 3, '#ff8a80');
      sfx.bad();
    } else if (name === 'race-quit' && mission && mission.kind === 'duel') {
      mission = null;
      Relay.result('w');
      earn(250, player.x, player.y - 40, 'Walkover');
      say(`${live.them} gave up`, 'The race is yours', 2.6, '#9be37a');
    }
  }

  // A finish line about as far from you as from your friend, a good drive away for both.
  let pendingRace = null;
  function challenge() {
    if (!online() || mission) return;
    const me = player.car || player, f = friend;
    const mid = { x: (me.x + f.x) / 2, y: (me.y + f.y) / 2 };
    let best = null, bs = Infinity;
    for (let k = 0; k < 40; k++) {
      const p = randomSidewalk(1300, 3400, mid);
      const d1 = Math.hypot(p.x - me.x, p.y - me.y), d2 = Math.hypot(p.x - f.x, p.y - f.y);
      const sc = Math.abs(d1 - d2) + Math.max(0, 1300 - Math.min(d1, d2)) * 2;
      if (sc < bs) { bs = sc; best = p; }
    }
    pendingRace = { x: Math.round(best.x), y: Math.round(best.y) };
    live.send('race', pendingRace);
    say('Challenge sent', `Waiting for ${live.them}…`, 2, FRIEND_COLOR);
  }
  function startDuel(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    mission = { kind: 'duel', dest: { x, y }, countdown: 3, t: 0, label: `Race vs ${live.them}` };
    say(`Race vs ${live.them}!`, 'First to the green finish line wins. Any car, any route.', 3, '#69f0ae');
  }
  function updateDuel(dt) {
    const m = mission;
    if (!online()) { mission = null; return; }
    if (m.countdown > 0) {
      const before = Math.ceil(m.countdown);
      m.countdown -= dt;
      if (Math.ceil(m.countdown) !== before) Arcade.tone({ freq: m.countdown <= 0 ? 880 : 440, dur: 0.15, type: 'square', vol: 0.05 });
      if (m.countdown <= 0) say('GO!', '', 0.8, '#69f0ae');
      // Hold still until the lights change.
      if (player.car) player.car.vx = player.car.vy = 0;
      else player.vx = player.vy = 0;
      return;
    }
    m.t += dt;
    const here = player.car || player;
    if (Math.hypot(here.x - m.dest.x, here.y - m.dest.y) < 45) {
      mission = null;
      live.send('race-won', { t: Math.round(m.t * 10) / 10 });
      Relay.result('w');
      Arcade.flag('getaway-friend-race');
      earn(500, here.x, here.y - 40, 'Race win');
      say(`You beat ${live.them}!`, `${m.t.toFixed(1)} s`, 3, '#9be37a');
      sfx.good();
      persist();
    } else if (m.t > 300) {
      mission = null;
      live.send('race-quit', {});
      say('Race timed out', '', 2, '#ff8a80');
    }
  }

  // Jump next to your friend, as long as nobody's chasing you and you're not on a job.
  function meetUp() {
    if (!online()) return;
    if (stars > 0) return say('Not with the cops after you', 'Lose them first', 2, '#ff8a80');
    if (mission) return say('Finish your job first', '', 2, '#ff8a80');
    const back = friend.a + Math.PI;
    let x = friend.x, y = friend.y;
    for (const [da, d] of [[0, 70], [0.6, 70], [-0.6, 70], [Math.PI / 2, 45], [-Math.PI / 2, 45], [0, 0]]) {
      const tx = friend.x + Math.cos(back + da) * d, ty = friend.y + Math.sin(back + da) * d;
      if (!inBuilding(tx, ty, player.car ? 24 : 10)) { x = tx; y = ty; break; }
    }
    if (player.car) {
      const c = player.car;
      c.x = x; c.y = y; c.a = friend.a; c.vx = c.vy = 0; c.z = 0;
    }
    player.x = x; player.y = y; player.a = friend.a;
    cam.x = x - W / 2 / cam.z; cam.y = y - H / 2 / cam.z;
    cam3.ready = false;
    say(`Met up with ${live.them}`, '', 1.6, FRIEND_COLOR);
  }

  function myState() {
    const c = player.car, r = v => Math.round(v * 10) / 10;
    const o = c || player;
    return { x: r(o.x), y: r(o.y), a: Math.round((c ? c.a : player.a) * 100) / 100, vx: r(o.vx || 0), vy: r(o.vy || 0), c: c ? c.type : 0, col: c ? c.color : 0, z: c ? r(c.z) : 0, w: r(player.walk % 100), st: stars, in: area ? 1 : 0 };
  }
  function updateOnline(dt) {
    if (!live.on && !pub) return;
    netT -= dt;
    if (netT <= 0) {
      netT = 1 / 15;
      const st = myState();
      if (live.on) live.state(st);
      if (pub) pub.lobby.state(st);
    }
    if (live.on) easePuppet(friend, dt);
    for (const p of crowd.values()) easePuppet(p, dt);
  }
  // Ease someone's puppet toward where they should be by now, and bump cars with them.
  function easePuppet(f, dt) {
    const n = f.net;
    if (!n) return;
    const lag = Math.min(0.2, (performance.now() - n.at) / 1000);
    const tx = (+n.x || 0) + (+n.vx || 0) * lag, ty = (+n.y || 0) + (+n.vy || 0) * lag;
    if (Math.hypot(tx - f.x, ty - f.y) > 200) { f.x = tx; f.y = ty; }
    else { f.x = Gfx.approach(f.x, tx, 14, dt); f.y = Gfx.approach(f.y, ty, 14, dt); }
    f.a += angDiff(+n.a || 0, f.a) * Math.min(1, dt * 14);
    f.car = CARS[n.c] ? n.c : null;
    f.color = typeof n.col === 'string' && /^#[0-9a-f]{3,8}$/i.test(n.col) ? n.col : '#ffffff';
    f.z = +n.z || 0;
    f.walk = +n.w || 0;
    f.stars = clamp(n.st | 0, 0, MAX_STARS);
    f.inside = !!n.in;
    // Bumping into their car: you bounce off on your screen, and they do on theirs.
    const pc = player.car;
    if (pc && f.car && !f.inside && f.z < 6 && pc.z < 6) {
      const dx = pc.x - f.x, dy = pc.y - f.y, d = Math.hypot(dx, dy);
      const min = (pc.T.len + CARS[f.car].len) * 0.42;
      if (d > 0.01 && d < min) {
        const nx = dx / d, ny = dy / d;
        pc.x += nx * (min - d); pc.y += ny * (min - d);
        const rel = (pc.vx - (+n.vx || 0)) * nx + (pc.vy - (+n.vy || 0)) * ny;
        if (rel < 0) {
          pc.vx -= nx * rel * 1.3; pc.vy -= ny * rel * 1.3;
          if (-rel > 80) { shake.add(Math.min(0.5, -rel / 900)); sfx.crash(-rel); damage(pc, -rel * 0.02); }
        }
      }
    }
  }

  // Everyone else you can see: your friend (live.js) and the people in your public lobby.
  function others() {
    const out = [];
    if (online() && !friend.inside) { friend.name = live.them; friend.tagColor = FRIEND_COLOR; out.push(friend); }
    for (const p of crowd.values()) if (p.net && !p.inside) out.push(p);
    return out;
  }
  const puppetCar = f => ({ type: f.car, T: CARS[f.car], color: f.color, x: f.x, y: f.y, z: f.z, a: f.a, role: 'friend', honk: 0, broken: false, siren: 0 });
  const puppetTag = f => `${f.name}${f.stars ? ' ' + '★'.repeat(f.stars) : ''}`;
  function drawPuppet2d(f) {
    if (f.car) drawCar(puppetCar(f));
    else drawPerson(f.x, f.y, f.a, f.tagColor, '#ffe0bd', f.walk, false);
    Gfx.text(ctx, puppetTag(f), f.x, f.y - (f.car ? 32 : 22), { size: 13, color: f.tagColor, width: 3 });
  }
  function drawFriend3d() {
    for (const f of others()) {
      if (Math.hypot(f.x - player.x, f.y - player.y) > 1300) continue;
      if (f.car) {
        M4.trs(model, f.x, groundAt(f.x, f.y) + f.z, f.y, -f.a);
        G3.draw(carMesh(f.car, f.color), model);
      } else drawPerson3d(f.x, f.y, f.a, f.tagColor, '#ffe0bd', f.walk, false);
    }
  }
  function friendTag3d() {
    for (const f of others()) {
      const d = Math.hypot(f.x - player.x, f.y - player.y);
      if (d > 1300) continue;
      const q = project(f.x, groundAt(f.x, f.y) + (f.car ? 34 : 26), f.y);
      if (q && q.x > 0 && q.x < W && q.y > 0 && q.y < H) Gfx.text(ctx, puppetTag(f), q.x, q.y, { size: clamp(14 * 300 / q.w, 11, 16), color: f.tagColor, width: 3 });
    }
  }
  // An arrow at the screen's edge pointing to your friend (Classic view).
  function friendArrow2d() {
    if (!online()) return;
    const sx = (friend.x - cam.x) * cam.z, sy = (friend.y - cam.y) * cam.z, m = 40;
    if (sx > m && sx < W - m && sy > m && sy < H - m) return;
    const cx = W / 2, cy = H / 2, a = Math.atan2(sy - cy, sx - cx);
    const k = Math.min((W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
    ctx.save();
    ctx.translate(cx + Math.cos(a) * k, cy + Math.sin(a) * k);
    ctx.rotate(a);
    ctx.scale(0.75, 0.75);
    ctx.fillStyle = FRIEND_COLOR;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-10, -13); ctx.lineTo(-4, 0); ctx.lineTo(-10, 13); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  // ---------- Loop and start ----------

  let last = performance.now();
  function frame(now) {
    const raw = (now - last) / 1000, dt = Math.min(0.05, raw);
    last = now;
    if (overlayEl.hidden && !mapOpen) update(dt);
    else if (live.on || pubOn()) updateOnline(dt);   // a menu open online: keep the others moving
    if (area) {
      ctx.clearRect(0, 0, W, H);
      drawArea();
      drawAreaHud();
    } else if (view3d) {
      render3d(dt);
      ctx.clearRect(0, 0, W, H);
      drawWorldHud3d();
      checkSpeed(raw);
    } else drawWorld();
    if (!area) drawHud();
    updateStats();
    requestAnimationFrame(frame);
  }

  loadSave();
  setView(viewPref === '3d' || viewPref === 'auto', false);
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
      <li>Heists and reckless driving bring the police. The wanted scale runs to <b>8 stars</b>: past five, riot vans join the chase. Stay out of their sight until the stars fade, or slip into a <b>🎨 Spray Shop</b> unseen for a respray. The fence only pays once you've lost every cop, and getting <b>busted</b> costs you the loot and a fine.</li>
      <li>Hit the yellow <b>ramps</b> fast for stunt cash, and hunt for 120 hidden <b>📦 packages</b> across the city. <b>M</b> shows the map, hold <b>C</b> to look behind you, and <b>V</b> switches between the 3D and Classic (top-down) views.</li>
      <li>Spend your cash on cars at the <b>🚗 Dealer</b> and perks at the Hideout.</li>
      <li><b>New:</b> walk into a <b>🚪 front door</b> to burgle a house (sell the haul at the <b>💰 Lucky Pawn</b>) or a <b>🏪 shop</b> to hold it up. Buy guns at <b>🔫 Bullseye Guns</b> (<b>Q</b> to draw, <b>Space</b> to fire: they stop cars, not people). Ride the <b>🚇 subway</b>, take <b>📦 courier</b>, <b>🛻 tow</b> and <b>🚢 boosting</b> jobs, and start the story at <b>🍝 Vinnie's Diner</b>.</li>
    </ul>`;
  function showIntro() {
    const html = s.intro ? `<p>${money(s.cash)} in your pocket · ${s.heists} heists pulled</p>${tips}` : `<p>A whole city to drive around, and plenty of ways to make money in it.</p>${tips}`;
    ui.show({ title: '🌆 Getaway City', html: html + onlineHtml(), button: 'Hit the streets', onAction: () => { s.intro = true; persist(); ui.hide(); }, onRender: p => { viewButton(p, showIntro); wireOnline(p, showIntro); } });
  }
  showIntro();
  const invite = Live.invite('getaway');
  if (invite) live.connect('public', invite);
  // Console handle for testing (only with #dev in the address).
  if (location.hash === '#dev') window.__gc = { get s() { return s; }, player, doors, markers, cars, get area() { return area; }, get mission() { return mission; }, enterArea, storyPanel, gunPanel, pawnPanel, setDay: v => { dayT = v; }, startJob, get pub() { return pub; }, crowd };
  requestAnimationFrame(frame);
})();
