/* Block Frontier: a first-person voxel sandbox on a generated island. Mine with your hands,
   craft better pickaxes to reach deeper ores, build anything, and fend off the glooms that
   creep out at night. Survival earns expedition points (the score); Creative is free building.
   The world and your stuff are saved in the browser. */
(() => {
  const ID = 'block-frontier';
  const W = 960, H = 540;
  const SX = 128, SZ = 128, SY = 64, CS = 16, SEA = 24;
  const SAVE_KEY = 'frontier:world';
  const REACH = 5.5;

  const glCanvas = document.getElementById('game'), hudCanvas = document.getElementById('hud');
  const G = GL3D.setup(glCanvas, hudCanvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  if (!G) {
    ui.show({ title: 'Block Frontier', html: '<p>This game needs WebGL, which this browser has turned off.</p>', button: 'Back to the arcade', onAction: () => { location.href = '../../index.html'; } });
    return;
  }
  const gl = G.gl, hud = G.hud;

  // ---------- Blocks and items ----------

  // tex: [top, side, bottom] tiles in the atlas. hard: seconds to break by hand. tier: the
  // pickaxe needed for it to drop anything (0 hand, 1 wood, 2 stone, 3 iron, 4 crystal).
  // rock: pickaxes speed it up a lot. pts: expedition points for mining it in Survival.
  const B = {
    1: { name: 'Grass', tex: [0, 1, 2], hard: 0.6, drop: 2 },
    2: { name: 'Dirt', tex: [2, 2, 2], hard: 0.5 },
    3: { name: 'Stone', tex: [3, 3, 3], hard: 1.6, tier: 1, rock: true, drop: 9 },
    4: { name: 'Sand', tex: [4, 4, 4], hard: 0.5 },
    5: { name: 'Water', tex: [5, 5, 5], water: true },
    6: { name: 'Log', tex: [7, 6, 7], hard: 1.3 },
    7: { name: 'Leaves', tex: [8, 8, 8], hard: 0.25, cutout: true, drop: 0 },
    8: { name: 'Planks', tex: [9, 9, 9], hard: 0.9 },
    9: { name: 'Cobblestone', tex: [10, 10, 10], hard: 1.8, tier: 1, rock: true },
    10: { name: 'Coal Ore', tex: [11, 11, 11], hard: 2, tier: 1, rock: true, drop: 101, pts: 5 },
    11: { name: 'Iron Ore', tex: [12, 12, 12], hard: 2.6, tier: 2, rock: true, drop: 102, pts: 15 },
    12: { name: 'Gold Ore', tex: [13, 13, 13], hard: 3, tier: 3, rock: true, drop: 103, pts: 40 },
    13: { name: 'Crystal Ore', tex: [14, 14, 14], hard: 3.6, tier: 3, rock: true, drop: 104, pts: 120 },
    14: { name: 'Bedrock', tex: [15, 15, 15], hard: Infinity },
    15: { name: 'Snow', tex: [16, 17, 2], hard: 0.5, drop: 2 },
    16: { name: 'Glass', tex: [18, 18, 18], hard: 0.3, cutout: true },
    17: { name: 'Brick', tex: [19, 19, 19], hard: 1.8, tier: 1, rock: true },
    18: { name: 'Glow Lamp', tex: [20, 20, 20], hard: 0.4, glow: true },
    19: { name: 'Iron Block', tex: [21, 21, 21], hard: 3, tier: 2, rock: true },
    20: { name: 'Gold Block', tex: [22, 22, 22], hard: 3, tier: 2, rock: true },
    21: { name: 'Crystal Block', tex: [23, 23, 23], hard: 3, tier: 2, rock: true, glow: true },
    22: { name: 'Gel Block', tex: [24, 24, 24], hard: 0.4, bouncy: true },
    23: { name: 'Bookshelf', tex: [9, 25, 9], hard: 1 },
    24: { name: 'Red Tile', tex: [26, 26, 26], hard: 1, rock: true },
    25: { name: 'Blue Tile', tex: [27, 27, 27], hard: 1, rock: true },
    26: { name: 'Mossy Stone', tex: [28, 28, 28], hard: 1.8, tier: 1, rock: true },
    27: { name: 'Pumpkin', tex: [29, 30, 29], hard: 0.8 },
  };
  // Items that aren't blocks. tool: { kind, tier, dmg }.
  const ITEMS = {
    100: { name: 'Stick' }, 101: { name: 'Coal' }, 102: { name: 'Iron' }, 103: { name: 'Gold' }, 104: { name: 'Crystal' },
    105: { name: 'Gloom Gel' }, 106: { name: 'Apple', food: 3 }, 107: { name: 'Pumpkin Pie', food: 6 },
    110: { name: 'Wooden Pickaxe', tool: 'pick', tier: 1 }, 111: { name: 'Stone Pickaxe', tool: 'pick', tier: 2 },
    112: { name: 'Iron Pickaxe', tool: 'pick', tier: 3 }, 113: { name: 'Crystal Pickaxe', tool: 'pick', tier: 4 },
    120: { name: 'Wooden Sword', tool: 'sword', dmg: 2 }, 121: { name: 'Stone Sword', tool: 'sword', dmg: 3 },
    122: { name: 'Iron Sword', tool: 'sword', dmg: 4 }, 123: { name: 'Crystal Sword', tool: 'sword', dmg: 6 },
  };
  const itemName = id => (B[id] || ITEMS[id] || {}).name || '?';
  const isBlock = id => id > 0 && id < 100 && !B[id].water;
  const PICK_SPEED = [1, 2, 3.5, 5.5, 9];

  // Crafting: needs (pairs of id, count) make `count` of `out`. Points are paid the first time.
  const RECIPES = [
    { out: 8, count: 4, needs: [[6, 1]] },
    { out: 100, count: 4, needs: [[8, 2]] },
    { out: 110, count: 1, needs: [[8, 3], [100, 2]], pts: 20 },
    { out: 111, count: 1, needs: [[9, 3], [100, 2]], pts: 40 },
    { out: 112, count: 1, needs: [[102, 3], [100, 2]], pts: 80 },
    { out: 113, count: 1, needs: [[104, 3], [100, 2]], pts: 250 },
    { out: 120, count: 1, needs: [[8, 2], [100, 1]], pts: 10 },
    { out: 121, count: 1, needs: [[9, 2], [100, 1]], pts: 20 },
    { out: 122, count: 1, needs: [[102, 2], [100, 1]], pts: 40 },
    { out: 123, count: 1, needs: [[104, 2], [100, 1]], pts: 150 },
    { out: 16, count: 2, needs: [[4, 2], [101, 1]], pts: 5 },
    { out: 17, count: 4, needs: [[9, 4], [101, 1]], pts: 5 },
    { out: 18, count: 2, needs: [[16, 1], [105, 1], [101, 1]], pts: 15 },
    { out: 22, count: 1, needs: [[105, 4]], pts: 10 },
    { out: 23, count: 1, needs: [[8, 6]] },
    { out: 24, count: 4, needs: [[9, 4], [27, 1]] },
    { out: 25, count: 4, needs: [[9, 4], [104, 1]] },
    { out: 26, count: 2, needs: [[9, 2], [7, 1]] },
    { out: 107, count: 2, needs: [[27, 1], [106, 1]] },
    { out: 19, count: 1, needs: [[102, 9]], pts: 30 },
    { out: 20, count: 1, needs: [[103, 9]], pts: 80 },
    { out: 21, count: 1, needs: [[104, 9]], pts: 300 },
  ];

  // ---------- Texture atlas (8 x 4 tiles of 16 px, painted here) ----------

  const ATLAS_COLS = 8, ATLAS_ROWS = 4, T = 16;
  const atlas = document.createElement('canvas');
  atlas.width = ATLAS_COLS * T;
  atlas.height = ATLAS_ROWS * T;
  (function paintAtlas() {
    const g = atlas.getContext('2d');
    const r = Gfx.rng(1234);
    const px = (t, x, y, c) => { g.fillStyle = c; g.fillRect((t % ATLAS_COLS) * T + x, Math.floor(t / ATLAS_COLS) * T + y, 1, 1); };
    const noise = (t, base, amt = 0.12, pick) => {
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) px(t, x, y, pick ? pick(x, y) : Gfx.shade(base, (r() - 0.5) * 2 * amt));
    };
    const speckle = (t, base, spot, n, size = 2) => {
      noise(t, base, 0.1);
      for (let k = 0; k < n; k++) {
        const x = Math.floor(r() * (T - size)), y = Math.floor(r() * (T - size));
        for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) if (r() < 0.85) px(t, x + a, y + b, Gfx.shade(spot, (r() - 0.5) * 0.3));
      }
    };
    noise(0, '#5fae3e', 0.14);                                                           // grass top
    noise(1, '#8a5f3a', 0.12, (x, y) => (y < 3 + (x * 7 % 3) ? Gfx.shade('#5fae3e', (r() - 0.5) * 0.25) : Gfx.shade('#8a5f3a', (r() - 0.5) * 0.24)));
    noise(2, '#8a5f3a', 0.14);                                                           // dirt
    noise(3, '#8d8f92', 0.1);                                                            // stone
    for (let k = 0; k < 5; k++) { const y = Math.floor(r() * T); for (let x = 0; x < 6; x++) px(3, (x + k * 5) % T, y, '#7a7c80'); }
    noise(4, '#e6d595', 0.08);                                                           // sand
    noise(5, '#3f7fd6', 0.06);                                                           // water
    noise(6, '#6b4a2b', 0.1, (x, y) => Gfx.shade(x % 4 === 0 ? '#58391f' : '#6e4c2c', (r() - 0.5) * 0.15));   // log side
    noise(7, '#b98d58', 0.05, (x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); return d > 7 ? '#6b4a2b' : Math.floor(d) % 3 === 0 ? '#9a7445' : Gfx.shade('#bf9460', (r() - 0.5) * 0.1); });
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {                            // leaves (with holes)
      const hole = r() < 0.16;
      g.fillStyle = hole ? 'rgba(0,0,0,0)' : Gfx.shade('#3f8f35', (r() - 0.5) * 0.35);
      g.clearRect(8 * 0 + (8 % ATLAS_COLS) * T + x, 1 * T + y, 1, 1);
      if (!hole) g.fillRect((8 % ATLAS_COLS) * T + x, 1 * T + y, 1, 1);
    }
    noise(9, '#b48a55', 0.08, (x, y) => (y % 4 === 3 ? '#8c6a3e' : (x + Math.floor(y / 4) * 5) % 9 === 0 ? '#987247' : Gfx.shade('#b48a55', (r() - 0.5) * 0.1)));
    noise(10, '#7f8185', 0.18, (x, y) => ((x + y * 3) % 7 === 0 || (x * 5 + y) % 11 === 0 ? '#5f6164' : Gfx.shade('#86888c', (r() - 0.5) * 0.25)));
    speckle(11, '#8d8f92', '#262626', 5);
    speckle(12, '#8d8f92', '#d8a483', 5);
    speckle(13, '#8d8f92', '#f5d03b', 5);
    speckle(14, '#8d8f92', '#5ef2ff', 4);
    noise(15, '#3b3b3e', 0.3);                                                           // bedrock
    noise(16, '#f3f7fa', 0.04);                                                          // snow top
    noise(17, '#8a5f3a', 0.12, (x, y) => (y < 4 + (x * 5 % 2) ? Gfx.shade('#f3f7fa', (r() - 0.5) * 0.06) : Gfx.shade('#8a5f3a', (r() - 0.5) * 0.24)));
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {                            // glass: frame, clear middle
      const edge = x === 0 || y === 0 || x === T - 1 || y === T - 1, glint = (x === 3 && y > 2 && y < 7) || (x === 4 && y === 3);
      const tx = (18 % ATLAS_COLS) * T + x, ty = Math.floor(18 / ATLAS_COLS) * T + y;
      g.clearRect(tx, ty, 1, 1);
      if (edge || glint) { g.fillStyle = edge ? '#cfe8f0' : '#ffffff'; g.fillRect(tx, ty, 1, 1); }
    }
    noise(19, '#a5503b', 0.08, (x, y) => (y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 4) % 8 === 0 ? '#d8cfc3' : Gfx.shade('#a5503b', (r() - 0.5) * 0.15)));
    noise(20, '#ffe082', 0.05, (x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); return d < 4 ? '#ffffff' : d < 6.5 ? '#fff3c4' : Gfx.shade('#e0b54a', (r() - 0.5) * 0.1); });
    noise(21, '#d9dde2', 0.06, (x, y) => (x % 8 === 0 || y % 8 === 0 ? '#aeb4ba' : Gfx.shade('#dfe3e8', (r() - 0.5) * 0.06)));
    noise(22, '#f2c53d', 0.06, (x, y) => (x % 8 === 0 || y % 8 === 0 ? '#c99a20' : Gfx.shade('#f6cf4a', (r() - 0.5) * 0.08)));
    noise(23, '#5ef2ff', 0.1, (x, y) => ((x + y) % 5 === 0 ? '#c8fbff' : Gfx.shade('#3fd6e8', (r() - 0.5) * 0.15)));
    noise(24, '#a06bff', 0.06, (x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); return d < 5 ? '#c7a6ff' : Gfx.shade('#8f5bf0', (r() - 0.5) * 0.12); });
    noise(25, '#b48a55', 0.05, (x, y) => (y % 8 === 0 || y % 8 === 7 ? '#8c6a3e' : x % 3 === 0 ? '#3d2a18' : ['#c0392b', '#2e86de', '#27ae60', '#f39c12'][Math.floor(x / 3 + y / 8) % 4]));
    noise(26, '#c0392b', 0.05, (x, y) => (x % 8 === 0 || y % 8 === 0 ? '#8e2a1f' : Gfx.shade('#c94436', (r() - 0.5) * 0.08)));
    noise(27, '#2e86de', 0.05, (x, y) => (x % 8 === 0 || y % 8 === 0 ? '#1f5d9c' : Gfx.shade('#3591e6', (r() - 0.5) * 0.08)));
    noise(28, '#7f8185', 0.18, (x, y) => (r() < 0.3 ? Gfx.shade('#5a8f3a', (r() - 0.5) * 0.2) : Gfx.shade('#84868a', (r() - 0.5) * 0.25)));
    noise(29, '#e38b26', 0.06, (x, y) => (Math.hypot(x - 7.5, y - 7.5) < 2 ? '#6b8f2a' : Gfx.shade('#e38b26', (r() - 0.5) * 0.1)));
    noise(30, '#e38b26', 0.06, (x, y) => (x % 4 === 0 ? '#c46f15' : Gfx.shade('#e8922b', (r() - 0.5) * 0.08)));
  })();
  const atlasTex = G.texture(atlas);
  const tileUV = t => {
    const e = 0.02 / T;
    const u0 = (t % ATLAS_COLS) / ATLAS_COLS + e, v0 = Math.floor(t / ATLAS_COLS) / ATLAS_ROWS + e;
    return [u0, v0, u0 + 1 / ATLAS_COLS - 2 * e, v0 + 1 / ATLAS_ROWS - 2 * e];
  };

  // Item icons (for the hotbar and the inventory screen): blocks as little 3D cubes from the atlas,
  // other items as small pixel drawings.
  const icons = {};
  function drawTile(g, t, x, y, w, h) {
    g.drawImage(atlas, (t % ATLAS_COLS) * T, Math.floor(t / ATLAS_COLS) * T, T, T, x, y, w, h);
  }
  function makeIcon(id) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (B[id]) {
      const [top, side] = B[id].tex;
      // Top face.
      g.setTransform(0.75, 0.375, -0.75, 0.375, 16, 2);
      drawTile(g, top, 0, 0, 16, 16);
      // Left face.
      g.setTransform(0.75, 0.375, 0, 0.9, 4, 8);
      drawTile(g, side, 0, 0, 16, 16);
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 0, 16, 16);
      // Right face.
      g.setTransform(0.75, -0.375, 0, 0.9, 16, 14);
      drawTile(g, side, 0, 0, 16, 16);
      g.fillStyle = 'rgba(0,0,0,0.32)'; g.fillRect(0, 0, 16, 16);
      g.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      const P = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x * 2, y * 2, w * 2, h * 2); };
      const it = ITEMS[id];
      const mat = it.tier || it.dmg ? ['#b48a55', '#8d8f92', '#dfe3e8', '#5ef2ff'][[110, 111, 112, 113, 120, 121, 122, 123].indexOf(id) % 4] : null;
      if (id === 100) for (let k = 0; k < 10; k++) P(3 + k, 12 - k, 2, 2, '#8c6a3e');
      else if (id === 101) { P(4, 5, 8, 7, '#262626'); P(5, 6, 3, 2, '#444'); }
      else if (id === 102 || id === 103) { const c = id === 102 ? '#dfe3e8' : '#f6cf4a'; P(3, 6, 10, 5, Gfx.shade(c, -0.25)); P(4, 6, 8, 3, c); }
      else if (id === 104) { P(6, 2, 4, 12, '#3fd6e8'); P(4, 5, 8, 6, '#5ef2ff'); P(7, 4, 2, 3, '#c8fbff'); }
      else if (id === 105) { P(3, 5, 10, 8, '#8f5bf0'); P(5, 6, 4, 3, '#c7a6ff'); }
      else if (id === 106) { P(4, 5, 8, 8, '#d63031'); P(7, 3, 2, 3, '#6b4a2b'); P(9, 3, 3, 2, '#27ae60'); P(5, 6, 2, 2, '#ff7675'); }
      else if (id === 107) { P(2, 8, 12, 5, '#c98a45'); P(3, 7, 10, 2, '#e38b26'); }
      else if (it.tool === 'pick') {
        for (let k = 0; k < 9; k++) P(4 + k, 13 - k, 2, 2, '#8c6a3e');
        P(3, 2, 10, 2, mat); P(2, 3, 2, 3, mat); P(12, 3, 2, 3, mat); P(7, 1, 3, 2, Gfx.shade(mat, 0.2));
      } else if (it.tool === 'sword') {
        for (let k = 0; k < 8; k++) P(5 + k, 9 - k, 2, 2, mat);
        P(3, 10, 5, 2, '#5a3d22'); P(4, 9, 2, 4, '#5a3d22'); P(2, 12, 2, 2, '#8c6a3e');
      }
    }
    icons[id] = { canvas: c, url: c.toDataURL() };
  }
  for (const id of [...Object.keys(B), ...Object.keys(ITEMS)].map(Number)) if (!(B[id] && B[id].water)) makeIcon(id);

  // ---------- World generation ----------

  const world = new Uint8Array(SX * SY * SZ);
  const idx = (x, y, z) => (y * SZ + z) * SX + x;
  const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ;
  const get = (x, y, z) => (inside(x, y, z) ? world[idx(x, y, z)] : y < 0 ? 14 : 0);
  let edits = new Map();

  function hash2(x, z, seed) {
    let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const smooth = t => t * t * (3 - 2 * t);
  function noise2(x, z, seed) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = smooth(x - xi), zf = smooth(z - zi);
    const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed), c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
    return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
  }
  function fbm(x, z, seed, oct = 4) {
    let v = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { v += noise2(x * f, z * f, seed + o * 31) * amp; amp *= 0.5; f *= 2; }
    return v / 0.9375;
  }
  function noise3(x, y, z, seed) {
    // Two 2D noises sliced by height: cheap and good enough for caves.
    return (noise2(x + y * 0.71, z - y * 0.37, seed) + noise2(x - y * 0.53, z + y * 0.89, seed + 7)) / 2;
  }

  function generate(seed) {
    world.fill(0);
    const rnd = Gfx.rng(seed * 13 + 5);
    const heights = new Int16Array(SX * SZ);
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const d = Math.hypot(x - SX / 2, z - SZ / 2) / (SX / 2);
      let h = SEA + 2 + (fbm(x / 40, z / 40, seed) - 0.45) * 22;
      const m = Math.max(0, fbm(x / 70, z / 70, seed + 99) - 0.52) * 70;
      h += m;
      const edge = smooth(Math.min(1, Math.max(0, (d - 0.72) / 0.26)));
      h = h * (1 - edge) + (SEA - 7) * edge;
      h = Math.max(2, Math.min(SY - 4, Math.round(h)));
      heights[z * SX + x] = h;
      for (let y = 0; y <= h; y++) {
        let id = 3;
        if (y === 0 || (y === 1 && rnd() < 0.5)) id = 14;
        else if (h <= SEA + 1) id = y > h - 4 ? 4 : 3;
        else if (h > 46) id = y === h ? 15 : y > h - 2 ? 2 : 3;
        else id = y === h ? 1 : y > h - 4 ? 2 : 3;
        world[idx(x, y, z)] = id;
      }
      for (let y = h + 1; y <= SEA; y++) world[idx(x, y, z)] = 5;
    }
    // Caves: carve where two noise fields meet, below the surface and above the bedrock.
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const h = heights[z * SX + x];
      for (let y = 3; y < h - 3; y++) {
        const n1 = noise3(x / 14, y / 9, z / 14, seed + 500), n2 = noise3(x / 18, y / 7, z / 18, seed + 900);
        if (Math.abs(n1 - 0.5) < 0.045 && Math.abs(n2 - 0.5) < 0.09) world[idx(x, y, z)] = 0;
        else if (y < 14 && noise3(x / 9, y / 6, z / 9, seed + 1300) > 0.8) world[idx(x, y, z)] = 0;
      }
    }
    // Ore veins: small blobs, rarer and deeper the better the ore.
    const ORES = [[10, 52, 0.012], [11, 40, 0.007], [12, 22, 0.0035], [13, 12, 0.0018]];
    for (const [ore, maxY, chance] of ORES) {
      const n = Math.round(SX * SZ * maxY * chance / 4);
      for (let k = 0; k < n; k++) {
        let x = Math.floor(rnd() * SX), y = 2 + Math.floor(rnd() * (maxY - 2)), z = Math.floor(rnd() * SZ);
        const size = 2 + Math.floor(rnd() * 4);
        for (let s = 0; s < size; s++) {
          if (get(x, y, z) === 3) world[idx(x, y, z)] = ore;
          x += Math.floor(rnd() * 3) - 1; y += Math.floor(rnd() * 3) - 1; z += Math.floor(rnd() * 3) - 1;
        }
      }
    }
    // Trees, thicker where the forest noise is high, and a few pumpkins.
    const trees = [];
    for (let k = 0; k < 2600; k++) {
      const x = 3 + Math.floor(rnd() * (SX - 6)), z = 3 + Math.floor(rnd() * (SZ - 6)), h = heights[z * SX + x];
      if (world[idx(x, h, z)] !== 1) continue;
      if (rnd() > fbm(x / 30, z / 30, seed + 77) * 1.4 - 0.2) continue;
      if (trees.some(([a, b]) => Math.abs(a - x) < 4 && Math.abs(b - z) < 4)) continue;
      trees.push([x, z]);
      const th = 4 + Math.floor(rnd() * 3);
      for (let y = 1; y <= th; y++) world[idx(x, h + y, z)] = 6;
      for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const rr = dy >= 0 ? 1 : 2;
        if (Math.abs(dx) > rr || Math.abs(dz) > rr || (Math.abs(dx) === 2 && Math.abs(dz) === 2 && rnd() < 0.7)) continue;
        const X = x + dx, Y = h + th + dy, Z = z + dz;
        if (inside(X, Y, Z) && world[idx(X, Y, Z)] === 0) world[idx(X, Y, Z)] = 7;
      }
      if (inside(x, h + th + 2, z)) world[idx(x, h + th + 2, z)] = 7;
    }
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(rnd() * SX), z = Math.floor(rnd() * SZ), h = heights[z * SX + x];
      if (world[idx(x, h, z)] === 1 && h + 1 < SY) world[idx(x, h + 1, z)] = 27;
    }
    return heights;
  }

  // ---------- Meshing ----------

  const opaque = id => id !== 0 && !B[id].water && !B[id].cutout;
  const FACES = [
    { n: [0, 1, 0], v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], tex: 0, shade: 1 },
    { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], tex: 2, shade: 0.5 },
    { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], tex: 1, shade: 0.78 },
    { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], tex: 1, shade: 0.72 },
    { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], tex: 1, shade: 0.86 },
    { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], tex: 1, shade: 0.64 },
  ];
  const AO_LEVEL = [0.45, 0.65, 0.82, 1];

  function emitFace(out, x, y, z, id, f, water) {
    const blk = B[id];
    const [u0, v0, u1, v1] = tileUV(blk.tex[f.tex]);
    const [nx, ny, nz] = f.n;
    const axis = nx ? 0 : ny ? 1 : 2;
    const ao = [];
    for (const c of f.v) {
      if (blk.glow || water) { ao.push(3); continue; }
      // Ambient occlusion: count the solid blocks touching this corner in the layer the face looks into.
      const L = [x + nx, y + ny, z + nz];
      const t = [0, 1, 2].filter(a => a !== axis);
      const o1 = [0, 0, 0], o2 = [0, 0, 0];
      o1[t[0]] = c[t[0]] ? 1 : -1;
      o2[t[1]] = c[t[1]] ? 1 : -1;
      const s1 = opaque(get(L[0] + o1[0], L[1] + o1[1], L[2] + o1[2])) ? 1 : 0;
      const s2 = opaque(get(L[0] + o2[0], L[1] + o2[1], L[2] + o2[2])) ? 1 : 0;
      const cc = opaque(get(L[0] + o1[0] + o2[0], L[1] + o1[1] + o2[1], L[2] + o1[2] + o2[2])) ? 1 : 0;
      ao.push(s1 && s2 ? 0 : 3 - s1 - s2 - cc);
    }
    const verts = f.v.map((c, i) => {
      let u, v;
      if (axis === 1) { u = c[0]; v = c[2]; } else { u = axis === 0 ? c[2] : c[0]; v = 1 - c[1]; }
      const k = (blk.glow ? 1 : f.shade * AO_LEVEL[ao[i]]);
      // Surface water sits a little below the top of its block.
      const yy = water && c[1] === 1 && get(x, y + 1, z) !== 5 ? y + 0.88 : y + c[1];
      return [x + c[0], yy, z + c[2], (blk.glow ? 2 + k : k), k, k, u0 + (u1 - u0) * u, v0 + (v1 - v0) * v];
    });
    const order = ao[0] + ao[2] < ao[1] + ao[3] ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
    for (const i of order) out.push(...verts[i]);
  }

  const chunks = [];        // [cx][cz] -> { solid, water }
  const NCX = SX / CS, NCZ = SZ / CS;
  function buildChunk(cx, cz) {
    const solid = [], water = [];
    for (let y = 0; y < SY; y++) for (let z = cz * CS; z < cz * CS + CS; z++) for (let x = cx * CS; x < cx * CS + CS; x++) {
      const id = world[idx(x, y, z)];
      if (!id) continue;
      const blk = B[id];
      for (const f of FACES) {
        const nb = get(x + f.n[0], y + f.n[1], z + f.n[2]);
        if (blk.water) {
          if (nb === 0 || (B[nb] && B[nb].cutout)) emitFace(water, x, y, z, id, f, true);
        } else if (!opaque(nb) && !(nb === id && blk.cutout && id !== 7)) {
          // Leaves keep the faces between them (they look fuller); glass doesn't.
          emitFace(solid, x, y, z, id, f, false);
        }
      }
    }
    const old = chunks[cx]?.[cz];
    if (!chunks[cx]) chunks[cx] = [];
    chunks[cx][cz] = { solid: G.mesh(new Float32Array(solid), old?.solid), water: G.mesh(new Float32Array(water), old?.water) };
  }
  function rebuildAround(x, z) {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const set = new Set([`${cx},${cz}`]);
    if (x % CS === 0) set.add(`${cx - 1},${cz}`);
    if (x % CS === CS - 1) set.add(`${cx + 1},${cz}`);
    if (z % CS === 0) set.add(`${cx},${cz - 1}`);
    if (z % CS === CS - 1) set.add(`${cx},${cz + 1}`);
    for (const k of set) {
      const [a, b] = k.split(',').map(Number);
      if (a >= 0 && b >= 0 && a < NCX && b < NCZ) buildChunk(a, b);
    }
  }
  function setBlock(x, y, z, id) {
    if (!inside(x, y, z)) return;
    world[idx(x, y, z)] = id;
    edits.set(idx(x, y, z), id);
    rebuildAround(x, z);
  }

  // Clouds: one flat mesh of white slabs, drifting.
  let clouds = null, ocean = null;
  function buildSky(seed) {
    const out = [];
    for (let z = -20; z < 30; z++) for (let x = -20; x < 30; x++) {
      // The pattern repeats every 20 slabs, so the drifting layer can wrap around seamlessly.
      if (noise2((((x % 20) + 20) % 20) / 4, z / 4, seed + 4242) < 0.62) continue;
      GL3D.box(out, x * 8, 0, z * 8, x * 8 + 8, 2, z * 8 + 8, [1, 1, 1], { shade: { top: 1, bottom: 0.85, x: 0.93, z: 0.9 } });
    }
    clouds = G.mesh(out, clouds);
    // The sea all around the island.
    const s = [];
    const [u0, v0, u1, v1] = tileUV(5);
    const quad = (x0, z0, x1, z1) => {
      const y = SEA + 0.88, c = 0.9;
      for (const [x, z, u, v] of [[x0, z0, u0, v0], [x0, z1, u0, v1], [x1, z1, u1, v1], [x0, z0, u0, v0], [x1, z1, u1, v1], [x1, z0, u1, v0]]) s.push(x, y, z, c, c, c, u, v);
    };
    quad(-400, -400, SX + 400, 0); quad(-400, SZ, SX + 400, SZ + 400); quad(-400, 0, 0, SZ); quad(SX, 0, SX + 400, SZ);
    ocean = G.mesh(s, ocean);
  }

  // ---------- Save ----------

  let s, heights;
  function newWorld(mode) {
    const seed = Math.floor(Math.random() * 1e9);
    s = { seed, mode, pts: 0, day: 1, time: 0.3, inv: [], crafted: {}, mined: {}, hp: 20, nights: 0, spawn: null, pos: null, yaw: 0, pitch: 0 };
    edits = new Map();
    heights = generate(seed);
    // Spawn on open grass near the middle: spiral out until the top block is grass with sky above.
    let sx = SX / 2, sz = SZ / 2;
    search: for (let r = 0; r < 40; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = SX / 2 + dx, z = SZ / 2 + dz, h = heights[z * SX + x];
      if (world[idx(x, h, z)] === 1 && world[idx(x, h + 1, z)] === 0 && world[idx(x, h + 2, z)] === 0 && world[idx(x, h + 3, z)] === 0) { sx = x; sz = z; break search; }
    }
    s.spawn = [sx + 0.5, Math.max(heights[sz * SX + sx], SEA) + 1.01, sz + 0.5];
    s.pos = [...s.spawn];
    if (mode === 'creative') s.inv = [1, 2, 3, 8, 6, 16, 17, 18, 21].map(id => ({ id, n: 1 }));
    buildAll();
    placePlayer();
    save();
  }
  function loadWorld() {
    const raw = Arcade.load(SAVE_KEY, null);
    if (!raw || !raw.seed) return false;
    s = { ...raw };
    heights = generate(s.seed);
    edits = new Map();
    const e = raw.edits || [];
    for (let k = 0; k < e.length; k += 2) { world[e[k]] = e[k + 1]; edits.set(e[k], e[k + 1]); }
    buildAll();
    return true;
  }
  function save() {
    if (!s) return;
    s.pos = [player.x, player.y, player.z];
    s.yaw = player.yaw;
    s.pitch = player.pitch;
    s.hp = player.hp;
    const flat = [];
    for (const [k, v] of edits) flat.push(k, v);
    Arcade.save(SAVE_KEY, { ...s, edits: flat });
    if (s.mode === 'survival') { Arcade.submitScore(ID, s.pts); Arcade.dailyScore?.(s.pts); }
  }
  function buildAll() {
    for (let cx = 0; cx < NCX; cx++) for (let cz = 0; cz < NCZ; cz++) buildChunk(cx, cz);
    buildSky(s.seed);
  }

  // ---------- Inventory ----------

  const HOTBAR = 9, SLOTS = 36;
  let sel = 0;
  const slot = i => s.inv[i] || null;
  const countOf = id => s.inv.reduce((t, it) => t + (it && it.id === id ? it.n : 0), 0);
  const STACK = id => (ITEMS[id] && ITEMS[id].tool ? 1 : 64);
  function give(id, n = 1) {
    if (s.mode === 'creative' && isBlock(id)) return true;
    for (let i = 0; i < SLOTS && n > 0; i++) {
      const it = s.inv[i];
      if (it && it.id === id && it.n < STACK(id)) { const k = Math.min(n, STACK(id) - it.n); it.n += k; n -= k; }
    }
    for (let i = 0; i < SLOTS && n > 0; i++) {
      if (!s.inv[i]) { const k = Math.min(n, STACK(id)); s.inv[i] = { id, n: k }; n -= k; }
    }
    return n === 0;
  }
  function take(id, n) {
    for (let i = SLOTS - 1; i >= 0 && n > 0; i--) {
      const it = s.inv[i];
      if (!it || it.id !== id) continue;
      const k = Math.min(n, it.n);
      it.n -= k;
      n -= k;
      if (it.n <= 0) s.inv[i] = null;
    }
  }
  const held = () => slot(sel);
  const pickTier = () => { const it = held(); return it && ITEMS[it.id] && ITEMS[it.id].tool === 'pick' ? ITEMS[it.id].tier : 0; };

  function addPts(n, why) {
    if (s.mode !== 'survival' || !n) return;
    s.pts += n;
    note(`+${n} ${why}`, '#ffd54f');
    if (s.pts >= 500) Arcade.flag('block-frontier-explorer');
  }

  // ---------- Player ----------

  const player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: false, hp: 20, hurtT: 0, fly: false, fallStart: 0, swing: 0, regenT: 0 };
  const PW = 0.3, PH = 1.8, EYE = 1.62;
  const solidAt = (x, y, z) => { const id = get(Math.floor(x), Math.floor(y), Math.floor(z)); return id !== 0 && !B[id].water; };
  const waterAt = (x, y, z) => get(Math.floor(x), Math.floor(y), Math.floor(z)) === 5;

  function collides(x, y, z, w = PW, h = PH) {
    for (let bx = Math.floor(x - w); bx <= Math.floor(x + w - 1e-6); bx++)
      for (let by = Math.floor(y); by <= Math.floor(y + h - 1e-6); by++)
        for (let bz = Math.floor(z - w); bz <= Math.floor(z + w - 1e-6); bz++) {
          const id = get(bx, by, bz);
          if (id !== 0 && !B[id].water) return true;
          if (bx < 0 || bz < 0 || bx >= SX || bz >= SZ) return true;
        }
    return false;
  }
  // Moves a body one axis at a time, stopping at blocks. Returns which axes were blocked.
  function moveBody(o, dt, w, h) {
    const hit = { x: false, y: false, z: false };
    for (const ax of ['x', 'z', 'y']) {
      const v = o['v' + ax] * dt;
      if (!v) continue;
      const steps = Math.ceil(Math.abs(v) / 0.4);
      for (let k = 0; k < steps; k++) {
        const prev = o[ax];
        o[ax] += v / steps;
        if (collides(o.x, o.y, o.z, w, h)) {
          // Snap flush against the block that stopped us (or give up and stay put).
          // The body spans o - down .. o + up on this axis.
          const up = ax === 'y' ? h : w, down = ax === 'y' ? 0 : w;
          o[ax] = v > 0 ? Math.floor(o[ax] + up) - up - 1e-4 : Math.floor(o[ax] - down) + 1 + down;
          if (collides(o.x, o.y, o.z, w, h) || Math.abs(o[ax] - prev) > 0.5) o[ax] = prev;
          hit[ax] = true;
          break;
        }
      }
      if (hit[ax]) o['v' + ax] = 0;
    }
    return hit;
  }

  function damagePlayer(n, why) {
    if (s.mode === 'creative' || n <= 0) return;
    player.hp -= n;
    player.hurtT = 0.4;
    player.regenT = 0;
    Arcade.tone({ freq: 220, to: 120, dur: 0.15, type: 'square', vol: 0.05 });
    if (player.hp <= 0) {
      player.hp = 20;
      player.x = s.spawn[0]; player.y = s.spawn[1]; player.z = s.spawn[2];
      player.vx = player.vy = player.vz = 0;
      note(`You were knocked out${why ? ' by ' + why : ''}. Back to camp!`, '#ff8a80');
    }
  }

  // ---------- Glooms ----------

  const glooms = [];
  const gloomMesh = (() => {
    const out = [];
    GL3D.box(out, -0.45, 0, -0.45, 0.45, 0.8, 0.45, GL3D.hex('#7d4fe0'));
    GL3D.box(out, -0.3, 0.42, -0.47, -0.1, 0.62, -0.44, [0.05, 0.05, 0.1]);
    GL3D.box(out, 0.1, 0.42, -0.47, 0.3, 0.62, -0.44, [0.05, 0.05, 0.1]);
    GL3D.box(out, -0.22, 0.48, -0.49, -0.16, 0.56, -0.46, [1, 1, 1]);
    GL3D.box(out, 0.18, 0.48, -0.49, 0.24, 0.56, -0.46, [1, 1, 1]);
    GL3D.box(out, -0.15, 0.2, -0.47, 0.15, 0.28, -0.44, [0.3, 0.1, 0.35]);
    GL3D.box(out, -0.47, 0.6, -0.47, 0.47, 0.82, 0.47, GL3D.hex('#9a6cf5'), { skip: 'b' });
    return G.mesh(out);
  })();
  function spawnGloom() {
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2, d = 16 + Math.random() * 20;
      const x = Math.floor(player.x + Math.cos(a) * d), z = Math.floor(player.z + Math.sin(a) * d);
      if (x < 1 || z < 1 || x >= SX - 1 || z >= SZ - 1) continue;
      let y = SY - 2;
      while (y > 1 && !solidAt(x, y, z)) y--;
      if (waterAt(x, y + 1, z) || get(x, y, z) === 7) continue;
      glooms.push({ x: x + 0.5, y: y + 1, z: z + 0.5, vx: 0, vy: 0, vz: 0, hp: 4, hopT: Math.random(), hitT: 0, yaw: 0, melt: 0, flash: 0 });
      return;
    }
  }
  function updateGlooms(dt, night) {
    if (s.mode === 'survival' && night && glooms.length < 6 && Math.random() < dt * 0.25) spawnGloom();
    for (let i = glooms.length - 1; i >= 0; i--) {
      const g = glooms[i];
      const dx = player.x - g.x, dz = player.z - g.z, d = Math.hypot(dx, dz);
      g.yaw = Math.atan2(dx, -dz);
      g.vy -= 24 * dt;
      g.hopT -= dt;
      const onGround = collides(g.x, g.y - 0.05, g.z, 0.4, 0.8);
      if (onGround) { g.vx *= 0.8; g.vz *= 0.8; }
      if (onGround && g.hopT <= 0 && d < 30) {
        g.hopT = 0.8 + Math.random() * 0.8;
        g.vy = 7;
        g.vx = dx / d * 4.2; g.vz = dz / d * 4.2;
        if (d < 12 && Math.random() < 0.5) Arcade.tone({ freq: 180, to: 260, dur: 0.08, type: 'sine', vol: 0.03 });
      }
      moveBody(g, dt, 0.4, 0.8);
      g.hitT -= dt;
      g.flash = Math.max(0, g.flash - dt);
      const dy = player.y - g.y;
      if (d < 0.9 && dy > -1 && dy < 1.6 && g.hitT <= 0) {
        g.hitT = 1;
        damagePlayer(3, 'a gloom');
        player.vx += dx / (d || 1) * 7; player.vz += dz / (d || 1) * 7; player.vy = 5;
      }
      // Sunlight melts them.
      if (!night) g.melt += dt;
      if (g.melt > 3 || g.y < -5 || d > 60) glooms.splice(i, 1);
    }
  }

  // ---------- Ray picking ----------

  function raycast(maxD) {
    const [dx, dy, dz] = GL3D.lookDir(player.yaw, player.pitch);
    let x = Math.floor(player.x), y = Math.floor(player.y + EYE), z = Math.floor(player.z);
    const ox = player.x, oy = player.y + EYE, oz = player.z;
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
    let tx = (sx > 0 ? x + 1 - ox : ox - x) * tdx, ty = (sy > 0 ? y + 1 - oy : oy - y) * tdy, tz = (sz > 0 ? z + 1 - oz : oz - z) * tdz;
    let n = [0, 0, 0], t = 0;
    while (t <= maxD) {
      const id = get(x, y, z);
      if (id && !B[id].water) return { x, y, z, id, n, t };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; n = [-sx, 0, 0]; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; n = [0, -sy, 0]; }
      else { z += sz; t = tz; tz += tdz; n = [0, 0, -sz]; }
    }
    return null;
  }
  function pickGloom(maxD) {
    const [dx, dy, dz] = GL3D.lookDir(player.yaw, player.pitch);
    const ox = player.x, oy = player.y + EYE, oz = player.z;
    let best = null, bt = maxD;
    for (const g of glooms) {
      // Ray vs the gloom's box.
      let t0 = 0, t1 = bt;
      for (const [o, d, lo, hi] of [[ox, dx, g.x - 0.45, g.x + 0.45], [oy, dy, g.y, g.y + 0.8], [oz, dz, g.z - 0.45, g.z + 0.45]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = Infinity; break; } continue; }
        let a = (lo - o) / d, b = (hi - o) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      }
      if (t0 <= t1 && t0 < bt) { bt = t0; best = g; }
    }
    return best ? { g: best, t: bt } : null;
  }

  // ---------- Input ----------

  const keys = new Set();
  let mouseL = false, mining = null, notes = [], lastSpace = 0;
  const look = GL3D.mouseLook(glCanvas, (mx, my) => {
    player.yaw += mx * 0.0024;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - my * 0.0024));
  }, locked => {
    if (!locked && overlayEl.hidden && state === 'play') pause();
  });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (state !== 'play' || !overlayEl.hidden) return;
    if (e.code.startsWith('Digit')) { const d = +e.code.slice(5); if (d >= 1 && d <= 9) sel = d - 1; }
    if (e.code === 'KeyE') { look.unlock(); inventoryPanel(); }
    if (e.code === 'KeyQ') dropHeld();
    if (e.code === 'Space') {
      const now = performance.now();
      if (s.mode === 'creative' && now - lastSpace < 300) { player.fly = !player.fly; player.vy = 0; note(player.fly ? 'Flying (double-tap Space to land)' : 'Landed', '#80deea'); }
      lastSpace = now;
    }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouseL = false; });
  glCanvas.addEventListener('mousedown', e => {
    if (!look.locked() || state !== 'play') return;
    if (e.button === 0) { mouseL = true; hit(); }
    if (e.button === 2) use();
  });
  addEventListener('mouseup', e => { if (e.button === 0) { mouseL = false; mining = null; } });
  glCanvas.addEventListener('contextmenu', e => e.preventDefault());
  glCanvas.addEventListener('wheel', e => { if (look.locked()) { sel = (sel + (e.deltaY > 0 ? 1 : 8)) % 9; e.preventDefault(); } }, { passive: false });

  function dropHeld() {
    const it = held();
    if (!it) return;
    it.n--;
    if (it.n <= 0) s.inv[sel] = null;
  }

  // Left click: hit a gloom if one's in reach, otherwise start mining.
  function hit() {
    player.swing = 0.25;
    const bl = raycast(REACH), gm = pickGloom(REACH);
    if (gm && (!bl || gm.t < bl.t)) {
      const it = held(), dmg = it && ITEMS[it.id] && ITEMS[it.id].tool === 'sword' ? ITEMS[it.id].dmg : 1;
      const g = gm.g;
      g.hp -= dmg;
      g.flash = 0.2;
      const [dx, , dz] = GL3D.lookDir(player.yaw, 0);
      g.vx = dx * 6; g.vz = dz * 6; g.vy = 4;
      Arcade.tone({ freq: 400, to: 250, dur: 0.08, type: 'square', vol: 0.04 });
      if (g.hp <= 0) {
        glooms.splice(glooms.indexOf(g), 1);
        burst(g.x, g.y + 0.4, g.z, [0.55, 0.35, 0.95], 14);
        give(105, 1 + (Math.random() < 0.5 ? 1 : 0));
        addPts(15, 'gloom popped');
        s.popped = (s.popped || 0) + 1;
        if (s.popped >= 10) Arcade.flag('block-frontier-glooms');
      }
      mining = null;
    }
  }
  // Right click: eat, or place the held block against the face you're looking at.
  function use() {
    const it = held();
    if (!it) return;
    const info = ITEMS[it.id];
    if (info && info.food) {
      if (player.hp >= 20) return note('You are not hungry', '#cfd8dc');
      player.hp = Math.min(20, player.hp + info.food);
      take(it.id, 1);
      Arcade.tone({ freq: 500, to: 700, dur: 0.1, type: 'triangle', vol: 0.04 });
      return;
    }
    if (!isBlock(it.id)) return;
    const r = raycast(REACH);
    if (!r) return;
    const x = r.x + r.n[0], y = r.y + r.n[1], z = r.z + r.n[2];
    if (!inside(x, y, z) || (get(x, y, z) !== 0 && get(x, y, z) !== 5)) return;
    // Not inside yourself (or a gloom).
    const overlaps = (ox, oy, oz, w, h) => x + 1 > ox - w && x < ox + w && y + 1 > oy && y < oy + h && z + 1 > oz - w && z < oz + w;
    if (overlaps(player.x, player.y, player.z, PW, PH) || glooms.some(g => overlaps(g.x, g.y, g.z, 0.4, 0.8))) return;
    setBlock(x, y, z, it.id);
    if (s.mode !== 'creative') take(it.id, 1);
    player.swing = 0.2;
    s.placed = (s.placed || 0) + 1;
    if (s.placed >= 100) Arcade.flag('block-frontier-builder');
    Arcade.tone({ freq: 300, dur: 0.05, type: 'square', vol: 0.03 });
  }

  function mineTime(id) {
    const blk = B[id];
    if (s.mode === 'creative') return 0.12;
    const tier = pickTier();
    let t = blk.hard / (blk.rock ? PICK_SPEED[tier] : 1 + tier * 0.35);
    if (blk.tier && tier < blk.tier) t *= 3.5;
    return t;
  }
  function updateMining(dt) {
    if (!mouseL) { mining = null; return; }
    const r = raycast(REACH);
    if (!r || B[r.id].hard === Infinity) { mining = null; return; }
    if (!mining || mining.x !== r.x || mining.y !== r.y || mining.z !== r.z) mining = { x: r.x, y: r.y, z: r.z, id: r.id, t: 0, need: mineTime(r.id) };
    mining.t += dt;
    player.swing = Math.max(player.swing, 0.12);
    if (Math.random() < dt * 8) Arcade.tone({ freq: 160 + Math.random() * 80, dur: 0.03, type: 'square', vol: 0.02 });
    if (mining.t >= mining.need) {
      const { x, y, z, id } = mining;
      const blk = B[id];
      setBlock(x, y, z, 0);
      // Water flows into the gap from beside or above.
      if ([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([a, b, c]) => get(x + a, y + b, z + c) === 5)) setBlock(x, y, z, 5);
      const tex = blk.tex[1], col = atlasColor(tex);
      burst(x + 0.5, y + 0.5, z + 0.5, col, 10);
      Arcade.tone({ freq: 220, to: 120, dur: 0.07, type: 'triangle', vol: 0.04 });
      if (s.mode !== 'creative') {
        const tier = pickTier();
        if (blk.tier && tier < blk.tier) note(`Needs a ${['', 'wooden', 'stone', 'iron', 'crystal'][blk.tier]} pickaxe to collect`, '#ff8a80');
        else {
          let drop = blk.drop === undefined ? id : blk.drop;
          if (id === 7) drop = Math.random() < 0.12 ? 106 : Math.random() < 0.15 ? 100 : 0;
          if (drop) give(drop, 1);
          if (blk.pts) {
            addPts(blk.pts, blk.name);
            s.mined[id] = (s.mined[id] || 0) + 1;
            if (id === 13) Arcade.flag('block-frontier-crystal');
          }
        }
      }
      if (y <= 3) Arcade.flag('block-frontier-deep');
      mining = null;
    }
  }
  const atlasColors = {};
  function atlasColor(t) {
    if (atlasColors[t]) return atlasColors[t];
    const d = atlas.getContext('2d').getImageData((t % ATLAS_COLS) * T + 6, Math.floor(t / ATLAS_COLS) * T + 6, 4, 4).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return (atlasColors[t] = [r / 4 / 255, g / 4 / 255, b / 4 / 255]);
  }

  // Little cubes that fly out of broken blocks and popped glooms.
  const bits = [];
  function burst(x, y, z, col, n) {
    for (let i = 0; i < n; i++) bits.push({ x, y, z, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 5, life: 0.6 + Math.random() * 0.4, col: col.map(c => c * (0.8 + Math.random() * 0.3)) });
  }
  let bitsMesh = null;

  // ---------- Menus ----------

  let state = 'menu';
  function inventoryPanel(msg = '') {
    const slotHtml = i => {
      const it = s.inv[i];
      return `<button class="bf-slot ${i === sel ? 'sel' : ''}" type="button" data-slot="${i}" title="${it ? itemName(it.id) : ''}">${it ? `<img src="${icons[it.id].url}" alt=""><b>${it.n > 1 ? it.n : ''}</b>` : ''}</button>`;
    };
    let palette = '';
    if (s.mode === 'creative') {
      palette = `<p class="bf-label">Creative blocks: click one to put it in your selected slot</p><div class="bf-grid">${Object.keys(B).map(Number).filter(isBlock).map(id => `<button class="bf-slot" type="button" data-give="${id}" title="${itemName(id)}"><img src="${icons[id].url}" alt=""></button>`).join('')}</div>`;
    }
    const recipes = RECIPES.map((r, i) => {
      const ok = r.needs.every(([id, n]) => countOf(id) >= n);
      const need = r.needs.map(([id, n]) => `<img src="${icons[id].url}" alt="">${n}`).join(' + ');
      return `<div class="bf-recipe"><img src="${icons[r.out].url}" alt=""><b>${itemName(r.out)}${r.count > 1 ? ' ×' + r.count : ''}</b><span class="bf-need ${ok ? 'ok' : ''}">${need}${r.pts && !s.crafted[r.out] && s.mode === 'survival' ? ` · <span style="color:#ffd54f">+${r.pts} pts first time</span>` : ''}</span><button class="btn" type="button" data-craft="${i}" ${ok ? '' : 'disabled'}>Craft</button></div>`;
    }).join('');
    ui.show({
      title: 'Inventory',
      html: `${msg ? `<p style="color:#9be37a">${msg}</p>` : ''}<p class="bf-label">Hotbar (click a slot to select it, then click a backpack slot to swap)</p>
        <div class="bf-grid">${Array.from({ length: HOTBAR }, (_, i) => slotHtml(i)).join('')}</div>
        <p class="bf-label">Backpack</p>
        <div class="bf-grid">${Array.from({ length: SLOTS - HOTBAR }, (_, i) => slotHtml(i + HOTBAR)).join('')}</div>
        ${palette}
        <p class="bf-label">Crafting</p><div class="bf-recipes">${recipes}</div>`,
      button: 'Back to the world',
      onAction: resume,
      onRender: panel => {
        panel.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => {
          const i = +b.dataset.slot;
          if (i < HOTBAR) sel = i;
          else { const t = s.inv[sel]; s.inv[sel] = s.inv[i] || null; s.inv[i] = t || null; }
          inventoryPanel();
        }));
        panel.querySelectorAll('[data-give]').forEach(b => b.addEventListener('click', () => { s.inv[sel] = { id: +b.dataset.give, n: 1 }; inventoryPanel(); }));
        panel.querySelectorAll('[data-craft]').forEach(b => b.addEventListener('click', () => {
          const r = RECIPES[+b.dataset.craft];
          if (!r.needs.every(([id, n]) => countOf(id) >= n)) return;
          for (const [id, n] of r.needs) take(id, n);
          if (!give(r.out, r.count)) note('Backpack full!', '#ff8a80');
          if (!s.crafted[r.out]) { s.crafted[r.out] = true; addPts(r.pts || 0, `crafted ${itemName(r.out)}`); }
          if (r.out === 113) Arcade.flag('block-frontier-crystal-pick');
          Arcade.tone({ freq: 600, to: 900, dur: 0.1, type: 'triangle', vol: 0.04 });
          inventoryPanel(`Crafted ${itemName(r.out)}${r.count > 1 ? ' ×' + r.count : ''}`);
        }));
      },
    });
  }

  function pause() {
    if (state !== 'play') return;
    save();
    ui.show({
      title: 'Paused',
      html: `<p>${s.mode === 'survival' ? `${s.pts.toLocaleString()} expedition points · day ${s.day}` : 'Creative world'}</p>
        <div class="menu"><button class="btn secondary" type="button" data-inv>Inventory and crafting (E)</button><button class="btn secondary" type="button" data-new>New world…</button></div>`,
      button: 'Resume',
      onAction: resume,
      onRender: p => {
        p.querySelector('[data-inv]').addEventListener('click', () => inventoryPanel());
        p.querySelector('[data-new]').addEventListener('click', () => newWorldMenu(true));
      },
    });
  }
  function resume() {
    ui.hide();
    state = 'play';
    look.lock();
  }
  Arcade.onBlur(() => { if (state === 'play' && overlayEl.hidden) { look.unlock(); pause(); } });

  function newWorldMenu(confirm) {
    ui.show({
      title: confirm ? 'Start a new world?' : '⛏️ Block Frontier',
      html: `${confirm ? '<p style="color:#ff8a80">Your current world will be replaced. Your best score stays on the leaderboard.</p>' : '<p>A blocky island to explore, mine and build on.</p>'}
        <ul style="text-align:left">
          <li><b>Survival</b>: punch trees for wood, craft pickaxes, dig for coal, iron, gold and crystal. Glooms come out at night. Ores, first crafts and popped glooms earn <b>expedition points</b>.</li>
          <li><b>Creative</b>: every block, unlimited. Double-tap Space to fly. No points.</li>
        </ul>
        <div class="menu"><button class="btn" type="button" data-mode="survival">New Survival world</button><button class="btn secondary" type="button" data-mode="creative">New Creative world</button></div>`,
      button: confirm ? 'Keep my world' : null,
      onAction: () => pause2(),
      onRender: p => p.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        newWorld(b.dataset.mode);
        resume();
      })),
    });
  }
  function pause2() { state = 'play'; pause(); }

  // ---------- Update ----------

  const notesMax = 4;
  function note(text, color = '#fff') {
    notes.push({ text, color, t: 3.5 });
    if (notes.length > notesMax) notes.shift();
  }

  function placePlayer() {
    [player.x, player.y, player.z] = s.pos || s.spawn;
    player.yaw = s.yaw || 0;
    player.pitch = s.pitch || 0;
    player.hp = s.hp || 20;
    player.vx = player.vy = player.vz = 0;
    player.fly = false;
    while (collides(player.x, player.y, player.z) && player.y < SY) player.y += 1;
    glooms.length = 0;
  }

  const dayLength = 600;
  const isNight = () => s.time > 0.75 || s.time < 0.22;
  function update(dt) {
    // Day and night.
    const wasNight = isNight();
    s.time = (s.time + dt / dayLength) % 1;
    if (wasNight && !isNight()) {
      s.day++;
      if (s.mode === 'survival') { addPts(25, 'survived the night'); s.nights = (s.nights || 0) + 1; if (s.nights >= 3) Arcade.flag('block-frontier-nights'); }
    }
    // Movement.
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const inWater = waterAt(player.x, player.y + 0.4, player.z) || waterAt(player.x, player.y + 1.2, player.z);
    const speed = player.fly ? (sprint ? 14 : 8) : inWater ? 2.6 : sprint ? 6 : 4.3;
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    let wx = sy * fwd + cy * strafe, wz = -cy * fwd + sy * strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const accel = player.ground || player.fly || inWater ? 14 : 3;
    player.vx += (wx * speed - player.vx) * Math.min(1, accel * dt);
    player.vz += (wz * speed - player.vz) * Math.min(1, accel * dt);
    if (player.fly) {
      const up = (keys.has('Space') ? 1 : 0) - (keys.has('ShiftLeft') || keys.has('ControlLeft') || keys.has('KeyC') ? 1 : 0);
      player.vy += (up * 8 - player.vy) * Math.min(1, 10 * dt);
    } else if (inWater) {
      player.vy -= 9 * dt;
      player.vy *= Math.exp(-2.5 * dt);
      if (keys.has('Space')) player.vy = Math.min(3.2, player.vy + 18 * dt);
    } else {
      player.vy -= 26 * dt;
      if (keys.has('Space') && player.ground) { player.vy = 8.4; player.ground = false; }
    }
    player.vy = Math.max(-40, player.vy);
    const fallV = player.vy;
    const wasGround = player.ground;
    const hitAx = moveBody(player, dt, PW, PH);
    player.ground = hitAx.y && fallV <= 0;
    if (player.ground && !wasGround && !player.fly) {
      const under = get(Math.floor(player.x), Math.floor(player.y - 0.1), Math.floor(player.z));
      if (under && B[under] && B[under].bouncy && fallV < -4) { player.vy = Math.min(16, -fallV * 0.85); player.ground = false; Arcade.tone({ freq: 300, to: 600, dur: 0.12, type: 'sine', vol: 0.04 }); }
      else if (fallV < -14 && !inWater) damagePlayer(Math.round((-fallV - 14) * 0.9), 'a fall');
    }
    if (player.y < -10) { player.x = s.spawn[0]; player.y = s.spawn[1]; player.z = s.spawn[2]; player.vy = 0; }
    // Health comes back slowly.
    player.regenT += dt;
    if (player.regenT > 4 && player.hp < 20) { player.hp++; player.regenT = 2; }
    player.hurtT = Math.max(0, player.hurtT - dt);
    player.swing = Math.max(0, player.swing - dt);

    updateMining(dt);
    updateGlooms(dt, isNight());
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.vy -= 20 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (solidAt(b.x, b.y, b.z)) { b.vy = Math.abs(b.vy) * 0.3; b.vx *= 0.6; b.vz *= 0.6; b.y += 0.05; }
      b.life -= dt;
      if (b.life <= 0) bits.splice(i, 1);
    }
    for (const n of notes) n.t -= dt;
    notes = notes.filter(n => n.t > 0);
  }

  // ---------- Drawing ----------

  const SKY_DAY = [0.53, 0.76, 0.98], SKY_NIGHT = [0.03, 0.04, 0.1], SKY_DUSK = [0.95, 0.55, 0.35];
  function skyColor() {
    const sun = Math.sin((s.time - 0.25) * Math.PI * 2);           // 1 at noon, -1 at midnight
    const dayK = Math.max(0, Math.min(1, sun * 2 + 0.5));
    const dusk = Math.max(0, 1 - Math.abs(sun) * 4) * 0.6;
    const c = SKY_NIGHT.map((n, i) => n + (SKY_DAY[i] - n) * dayK);
    return { c: c.map((v, i) => v + (SKY_DUSK[i] - v) * dusk), light: 0.4 + dayK * 0.6, sun };
  }
  const model = GL3D.mat4.create();

  function project(wx, wy, wz) {
    const v = G.view, p = G.proj;
    const x = v[0] * wx + v[4] * wy + v[8] * wz + v[12], y = v[1] * wx + v[5] * wy + v[9] * wz + v[13], z = v[2] * wx + v[6] * wy + v[10] * wz + v[14];
    const cx = p[0] * x, cy = p[5] * y, cw = -z;
    if (cw <= 0.01) return null;
    return [(cx / cw * 0.5 + 0.5) * W, (1 - (cy / cw * 0.5 + 0.5)) * H];
  }

  function draw() {
    const sky = skyColor();
    const underwater = waterAt(player.x, player.y + EYE, player.z);
    const fog = underwater ? [0.1, 0.25, 0.5] : sky.c;
    G.begin(1.2, 0.08, 400, fog, underwater ? 2 : 48, underwater ? 18 : 92, sky.light);
    G.camera(player.x, player.y + EYE, player.z, player.yaw, player.pitch);
    G.bindTexture(atlasTex);
    for (let cx = 0; cx < NCX; cx++) for (let cz = 0; cz < NCZ; cz++) G.draw(chunks[cx][cz].solid);
    // Glooms.
    G.bindTexture(null);
    for (const g of glooms) {
      const sq = 1 + Math.min(0.25, Math.abs(g.vy) * 0.03), melt = Math.max(0.2, 1 - g.melt / 3);
      GL3D.mat4.trs(model, g.x, g.y, g.z, -g.yaw, melt / Math.sqrt(sq), melt * sq, melt / Math.sqrt(sq));
      if (g.flash > 0) G.tint(1, 1, 1, 0.6);
      G.draw(gloomMesh, model);
      if (g.flash > 0) G.tint(0, 0, 0, 0);
    }
    // Block bits.
    if (bits.length) {
      const out = [];
      for (const b of bits) { const r = 0.07; GL3D.box(out, b.x - r, b.y - r, b.z - r, b.x + r, b.y + r, b.z + r, b.col); }
      bitsMesh = G.mesh(new Float32Array(out), bitsMesh);
      G.draw(bitsMesh);
    }
    // Clouds.
    GL3D.mat4.trs(model, -160 + (performance.now() / 1000 * 0.6) % 160, 58, -160, 0);
    G.draw(clouds, model);
    // Target outline.
    const r = state === 'play' ? raycast(REACH) : null;
    if (r) {
      const e = 0.003, out = [], x0 = r.x - e, y0 = r.y - e, z0 = r.z - e, x1 = r.x + 1 + e, y1 = r.y + 1 + e, z1 = r.z + 1 + e;
      const c = 0.05;
      const L = (a, b) => out.push(...a, c, c, c, -1, -1, ...b, c, c, c, -1, -1);
      for (const [y] of [[y0], [y1]]) { L([x0, y, z0], [x1, y, z0]); L([x1, y, z0], [x1, y, z1]); L([x1, y, z1], [x0, y, z1]); L([x0, y, z1], [x0, y, z0]); }
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) L([x, y0, z], [x, y1, z]);
      outline = G.mesh(new Float32Array(out), outline);
      G.draw(outline, undefined, gl.LINES);
    }
    // Water, last and see-through.
    G.bindTexture(atlasTex);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    G.alpha(0.72);
    G.draw(ocean);
    for (let cx = 0; cx < NCX; cx++) for (let cz = 0; cz < NCZ; cz++) G.draw(chunks[cx][cz].water);
    G.alpha(1);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    drawHud(sky, r, underwater);
  }
  let outline = null;

  function drawHud(sky, target, underwater) {
    hud.clearRect(0, 0, W, H);
    // Sun and moon.
    const a = (s.time - 0.25) * Math.PI * 2;
    for (const [dir, col, rad] of [[1, '#fff6c4', 26], [-1, '#e3e8f0', 18]]) {
      const p = project(player.x + Math.cos(a) * 300 * dir, player.y + Math.sin(a) * 300 * dir, player.z - 80);
      if (p && !underwater) {
        hud.fillStyle = col;
        hud.shadowColor = col;
        hud.shadowBlur = dir > 0 ? 30 : 12;
        hud.fillRect(p[0] - rad / 2, p[1] - rad / 2, rad, rad);
        hud.shadowBlur = 0;
      }
    }
    if (underwater) { hud.fillStyle = 'rgba(30,80,160,0.25)'; hud.fillRect(0, 0, W, H); }
    if (player.hurtT > 0) { hud.fillStyle = `rgba(255,40,40,${player.hurtT * 0.5})`; hud.fillRect(0, 0, W, H); }
    if (state !== 'play') return;
    // Crosshair and mining progress.
    hud.fillStyle = 'rgba(255,255,255,0.85)';
    hud.fillRect(W / 2 - 9, H / 2 - 1, 18, 2);
    hud.fillRect(W / 2 - 1, H / 2 - 9, 2, 18);
    if (mining) {
      hud.strokeStyle = '#ffd54f';
      hud.lineWidth = 3;
      hud.beginPath();
      hud.arc(W / 2, H / 2, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, mining.t / mining.need));
      hud.stroke();
    }
    // Hotbar.
    const sz = 44, x0 = W / 2 - (sz * 9) / 2, y0 = H - sz - 10;
    for (let i = 0; i < HOTBAR; i++) {
      const x = x0 + i * sz;
      hud.fillStyle = 'rgba(15,18,26,0.7)';
      hud.fillRect(x + 1, y0, sz - 2, sz);
      hud.strokeStyle = i === sel ? '#ffffff' : 'rgba(255,255,255,0.18)';
      hud.lineWidth = i === sel ? 3 : 1;
      hud.strokeRect(x + 1.5, y0 + 0.5, sz - 3, sz - 1);
      const it = s.inv[i];
      if (it) {
        hud.imageSmoothingEnabled = false;
        hud.drawImage(icons[it.id].canvas, x + 6, y0 + 6, 32, 32);
        if (it.n > 1 && s.mode !== 'creative') Gfx.text(hud, String(it.n), x + sz - 6, y0 + sz - 9, { size: 12, align: 'right', width: 3 });
      }
    }
    const h = held();
    if (h) Gfx.text(hud, itemName(h.id), W / 2, y0 - 12, { size: 13, width: 3 });
    // Held item, swinging.
    if (h) {
      const sw = Math.sin((player.swing / 0.25) * Math.PI) * 30;
      hud.save();
      hud.translate(W - 130 - sw, H - 120 + sw * 0.6);
      hud.rotate(-0.3 - sw * 0.01);
      hud.imageSmoothingEnabled = false;
      hud.drawImage(icons[h.id].canvas, -48, -48, 96, 96);
      hud.restore();
    }
    // Hearts.
    if (s.mode === 'survival') {
      for (let i = 0; i < 10; i++) {
        const v = Math.max(0, Math.min(2, player.hp - i * 2));
        const x = x0 + i * 17, y = y0 - 34;
        hud.fillStyle = 'rgba(0,0,0,0.5)';
        heart(x, y, 7);
        if (v > 0) { hud.fillStyle = '#ff3b4a'; hud.save(); hud.beginPath(); hud.rect(x - 8, y - 8, v === 2 ? 16 : 8, 16); hud.clip(); heart(x, y, 6); hud.restore(); }
      }
      Gfx.text(hud, `${s.pts.toLocaleString()} pts`, W - 16, 22, { size: 16, align: 'right', color: '#ffd54f' });
    } else Gfx.text(hud, 'Creative', W - 16, 22, { size: 16, align: 'right', color: '#80deea' });
    const clock = s.time < 0.22 || s.time > 0.75 ? '🌙 Night' : s.time < 0.3 ? '🌅 Morning' : s.time > 0.68 ? '🌇 Evening' : '☀️ Day';
    Gfx.text(hud, `${clock} ${s.day}`, W - 16, 44, { size: 12, align: 'right', color: '#cfd8dc' });
    if (target) Gfx.text(hud, B[target.id].name, W / 2, 24, { size: 12, color: '#e0e0e0', width: 3 });
    notes.forEach((n, i) => {
      hud.globalAlpha = Math.min(1, n.t);
      Gfx.text(hud, n.text, 16, 24 + i * 20, { size: 13, align: 'left', color: n.color, width: 3 });
    });
    hud.globalAlpha = 1;
  }
  function heart(x, y, r) {
    hud.beginPath();
    hud.moveTo(x, y + r * 0.9);
    hud.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.6, y - r * 1.3, x, y - r * 0.4);
    hud.bezierCurveTo(x + r * 0.6, y - r * 1.3, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
    hud.fill();
  }

  // ---------- Loop ----------

  let last = performance.now(), saveT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'play' && overlayEl.hidden) {
      update(dt);
      saveT += dt;
      if (saveT > 10) { saveT = 0; save(); }
    }
    if (s) draw();
    $('points').textContent = s ? (s.mode === 'survival' ? s.pts.toLocaleString() : '—') : 0;
    $('day').textContent = s ? s.day : 1;
    $('best').textContent = Arcade.getBest(ID).toLocaleString();
    requestAnimationFrame(frame);
  }

  addEventListener('pagehide', save);
  if (loadWorld()) {
    placePlayer();
    ui.show({
      title: '⛏️ Block Frontier',
      html: `<p>Welcome back! ${s.mode === 'survival' ? `${s.pts.toLocaleString()} expedition points, day ${s.day}.` : 'Your creative world is waiting.'}</p>
        <p style="font-size:13px;color:var(--muted)">Click the world to look around. WASD to move, Space to jump, hold left click to mine, right click to place, E for inventory and crafting.</p>`,
      button: 'Play',
      onAction: resume,
    });
    state = 'paused';
  } else {
    // Nothing saved yet: make a world behind the menu so there's something to look at.
    newWorld('survival');
    newWorldMenu(false);
  }
  requestAnimationFrame(frame);
})();
