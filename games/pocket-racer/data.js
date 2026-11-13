/* Pocket Racer content: tracks, themes, the career, car skins and rival drivers. */
const RacerData = (() => {
  // Each theme decides the grass, the scenery scattered round the track, and whether it's night.
  const THEMES = [
    { id: 'meadow', name: 'Meadow', grass: '#3f8a4a', grass2: '#367d41', dust: '#6b4a2a', scenery: ['tree', 'tree', 'bush', 'flowers'] },
    { id: 'pines', name: 'Pines', grass: '#3d6b31', grass2: '#35602b', dust: '#5a4527', scenery: ['pine', 'pine', 'pine', 'rock'] },
    { id: 'canyon', name: 'Canyon', grass: '#b07a4a', grass2: '#a36f42', dust: '#c8915a', scenery: ['rock', 'rock', 'mesa', 'shrub'] },
    { id: 'desert', name: 'Desert', grass: '#d6b06a', grass2: '#cba460', dust: '#e3c27f', scenery: ['cactus', 'cactus', 'rock', 'shrub'] },
    { id: 'snow', name: 'Snow', grass: '#dfe9f0', grass2: '#d3dfe8', dust: '#ffffff', scenery: ['snowpine', 'snowpine', 'snowman', 'rock'] },
    { id: 'night', name: 'Night', grass: '#22305a', grass2: '#1e2b52', dust: '#3a4a7a', scenery: ['building', 'lamp', 'building', 'lamp'], night: true },
  ];
  const themeOf = t => THEMES.find(th => th.id === t.theme) || THEMES.find(th => th.grass === t.grass) || THEMES[0];

  // The first point of each track is the start line, so it sits on a straight.
  const TRACKS = [
    { id: 'harbor', name: 'Harbor Loop', theme: 'meadow', points: [[400, 90], [680, 110], [720, 280], [680, 450], [520, 470], [440, 380], [360, 380], [280, 470], [120, 450], [80, 280], [120, 110]] },
    { id: 'pines', name: 'Pine Hills', theme: 'pines', points: [[240, 95], [330, 80], [480, 150], [650, 90], [730, 220], [640, 330], [700, 460], [500, 480], [380, 380], [250, 480], [100, 420], [90, 250], [150, 120]] },
    { id: 'canyon', name: 'Canyon Twist', theme: 'canyon', points: [[400, 80], [650, 90], [730, 200], [620, 280], [700, 400], [600, 480], [400, 470], [300, 360], [200, 470], [90, 400], [110, 200], [200, 100]] },
    { id: 'dunes', name: 'Dune Dash', theme: 'desert', points: [[300, 85], [560, 85], [700, 130], [720, 250], [640, 330], [700, 420], [620, 480], [430, 470], [330, 400], [210, 470], [90, 420], [100, 260], [170, 130]] },
    { id: 'frost', name: 'Frost Switchback', theme: 'snow', points: [[260, 85], [560, 85], [700, 110], [725, 230], [720, 420], [665, 480], [600, 430], [590, 270], [520, 210], [455, 270], [450, 420], [380, 485], [250, 480], [150, 470], [80, 380], [85, 200], [140, 110]] },
    { id: 'midnight', name: 'Midnight Circuit', theme: 'night', points: [[420, 90], [640, 90], [720, 170], [650, 250], [720, 340], [700, 460], [560, 480], [500, 380], [400, 330], [300, 390], [260, 480], [110, 470], [80, 340], [200, 250], [95, 160], [190, 90]] },
    // Generated layouts, each checked with the track builder's rules (see checkTrack in game.js).
    { id: 'hedgerow', name: 'Hedgerow Hook', theme: 'meadow', points: [[247, 75], [111, 96], [115, 208], [390, 215], [396, 469], [687, 458], [686, 87]] },
    { id: 'clover', name: 'Clover Bend', theme: 'meadow', points: [[480, 354], [232, 342], [230, 94], [103, 100], [107, 471], [683, 468], [672, 353]] },
    { id: 'orchard', name: 'Orchard Run', theme: 'meadow', points: [[341, 502], [682, 468], [702, 206], [486, 78], [97, 70], [109, 199], [311, 199], [308, 338], [111, 335], [108, 485]] },
    { id: 'windmill', name: 'Windmill Way', theme: 'meadow', points: [[557, 72], [138, 90], [120, 475], [699, 455], [684, 329], [564, 331], [549, 213], [698, 205], [688, 92]] },
    { id: 'fern', name: 'Fern Gully', theme: 'pines', points: [[322, 59], [80, 88], [192, 295], [205, 462], [444, 458], [440, 289], [589, 293], [578, 472], [695, 464], [691, 99]] },
    { id: 'lumber', name: 'Lumberjack Loop', theme: 'pines', points: [[437, 208], [719, 381], [601, 502], [480, 384], [347, 386], [118, 268], [110, 59]] },
    { id: 'timber', name: 'Timberline', theme: 'pines', points: [[397, 59], [689, 82], [700, 223], [545, 476], [267, 480], [248, 358], [390, 340], [405, 220], [118, 221], [110, 72]] },
    { id: 'ridge', name: 'Ridge Runner', theme: 'pines', points: [[270, 490], [109, 465], [119, 336], [416, 336], [389, 208], [269, 216], [251, 85], [688, 95], [671, 471]] },
    { id: 'mesa', name: 'Mesa Maze', theme: 'canyon', points: [[349, 497], [694, 465], [675, 62], [401, 262], [111, 266], [115, 461]] },
    { id: 'coyote', name: 'Coyote Cut', theme: 'canyon', points: [[381, 60], [118, 100], [108, 341], [407, 222], [560, 207], [540, 465], [687, 461], [697, 93]] },
    { id: 'redrock', name: 'Red Rock Rally', theme: 'canyon', points: [[253, 115], [428, 177], [571, 78], [694, 233], [724, 469], [421, 376], [179, 499], [81, 213], [91, 58]] },
    { id: 'arch', name: 'Arch Gate', theme: 'canyon', points: [[355, 68], [470, 80], [711, 94], [735, 294], [674, 502], [432, 340], [107, 454], [62, 334], [138, 77]] },
    { id: 'sandstorm', name: 'Sandstorm Sprint', theme: 'desert', points: [[246, 73], [107, 93], [110, 209], [285, 216], [311, 460], [680, 465], [684, 89]] },
    { id: 'cactus', name: 'Cactus Crossing', theme: 'desert', points: [[293, 494], [692, 480], [679, 212], [405, 207], [387, 75], [95, 75], [91, 215], [248, 205], [248, 335], [104, 344], [108, 471]] },
    { id: 'oasis', name: 'Oasis Run', theme: 'desert', points: [[531, 130], [691, 62], [726, 383], [508, 415], [452, 501], [322, 459], [286, 383], [90, 300], [81, 70], [314, 128], [409, 200]] },
    { id: 'mirage', name: 'Mirage Mile', theme: 'desert', points: [[366, 59], [101, 107], [126, 457], [308, 451], [287, 219], [484, 229], [480, 465], [687, 464], [691, 99]] },
    { id: 'scorpion', name: 'Scorpion Sting', theme: 'desert', points: [[400, 58], [690, 73], [698, 217], [558, 219], [557, 346], [708, 352], [697, 487], [414, 482], [272, 341], [109, 208], [107, 77]] },
    { id: 'glacier', name: 'Glacier Gap', theme: 'snow', points: [[521, 65], [109, 96], [99, 472], [223, 463], [230, 332], [446, 209], [700, 217], [680, 85]] },
    { id: 'polar', name: 'Polar Pass', theme: 'snow', points: [[537, 102], [666, 171], [740, 309], [609, 390], [509, 473], [313, 492], [66, 328], [139, 176], [326, 85], [428, 63]] },
    { id: 'blizzard', name: 'Blizzard Bowl', theme: 'snow', points: [[524, 65], [686, 85], [691, 213], [418, 214], [415, 353], [693, 339], [685, 475], [135, 464], [121, 94]] },
    { id: 'icicle', name: 'Icicle Alley', theme: 'snow', points: [[245, 68], [334, 88], [431, 142], [611, 82], [742, 205], [611, 299], [618, 365], [589, 485], [439, 489], [334, 366], [199, 490], [62, 456], [101, 327], [140, 246], [124, 181], [129, 63]] },
    { id: 'neon', name: 'Neon Nights', theme: 'night', points: [[253, 110], [87, 125], [98, 283], [368, 341], [559, 501], [742, 231], [600, 62], [367, 107]] },
    { id: 'moonlight', name: 'Moonlight Mile', theme: 'night', points: [[535, 157], [663, 58], [736, 229], [730, 329], [669, 383], [563, 494], [448, 480], [392, 382], [312, 401], [129, 411], [99, 303], [60, 218], [159, 110], [344, 181], [425, 250]] },
    { id: 'downtown', name: 'Downtown Drift', theme: 'night', points: [[419, 466], [571, 470], [724, 492], [722, 280], [566, 261], [573, 73], [406, 92], [392, 267], [89, 290], [85, 492], [243, 467]] },
    { id: 'tunnel', name: 'Tunnel Vision', theme: 'night', points: [[551, 489], [687, 471], [700, 355], [515, 356], [518, 93], [121, 101], [118, 469]] },
    { id: 'skyline', name: 'Skyline Spiral', theme: 'night', points: [[405, 502], [110, 458], [121, 95], [411, 98], [417, 339], [542, 334], [548, 104], [689, 102], [695, 456]] },
  ];
  // The six original tracks can also be driven the other way round (same start line).
  const reversed = t => ({ ...t, id: t.id + '-r', name: t.name + ' Reverse', points: [t.points[0], ...t.points.slice(1).reverse()], reverse: true });
  const ALL_TRACKS = [...TRACKS, ...TRACKS.slice(0, 6).map(reversed)];
  const trackById = id => ALL_TRACKS.find(t => t.id === id);

  // Rival pace scales their racing-line speed; wander is how far (px) they drift off the line.
  const LEVELS = [
    { id: 'rookie', name: 'Rookie', pace: 0.64, wander: 14, points: 0.6 },
    { id: 'club', name: 'Club', pace: 0.71, wander: 11, points: 0.8, career: true },
    { id: 'pro', name: 'Pro', pace: 0.78, wander: 8, points: 1 },
    { id: 'expert', name: 'Expert', pace: 0.88, wander: 5, points: 1.25, career: true },
    { id: 'ace', name: 'Ace', pace: 0.97, wander: 2, points: 1.5 },
    { id: 'legend', name: 'Legend', pace: 1.01, wander: 1, points: 1.8, career: true },
  ];

  // Career: six cups of six events. A podium unlocks the next event; finishing a cup opens the
  // next one. Stars: 1 for a podium, 2 for a win, 3 for a win under the target time.
  // The three-star target time is worked out per race in game.js (parTime).
  const CUPS = [
    { id: 'rookie', name: 'Rookie Cup', color: '#3ddc84', level: 'rookie', laps: 2, reward: 1, events: ['harbor', 'dunes', 'pines', 'canyon', 'frost', 'midnight'] },
    { id: 'club', name: 'Club Cup', color: '#2ec4b6', level: 'club', laps: 2, reward: 1.2, events: ['hedgerow', 'sandstorm', 'timber', 'mesa', 'glacier', 'neon'] },
    { id: 'pro', name: 'Pro Cup', color: '#4f8cff', level: 'pro', laps: 3, reward: 1.5, events: ['harbor-r', 'dunes-r', 'pines-r', 'canyon-r', 'frost-r', 'midnight-r'] },
    { id: 'expert', name: 'Expert Cup', color: '#c77dff', level: 'expert', laps: 3, reward: 1.75, events: ['orchard', 'coyote', 'cactus', 'fern', 'polar', 'downtown'] },
    { id: 'ace', name: 'Ace Cup', color: '#ff5d5d', level: 'ace', laps: 3, reward: 2, events: ['canyon', 'frost', 'midnight', 'pines-r', 'harbor', 'dunes-r'] },
    { id: 'legend', name: 'Legend Cup', color: '#ff8a1f', level: 'legend', laps: 3, reward: 2.5, events: ['icicle', 'moonlight', 'scorpion', 'blizzard', 'mirage', 'skyline'] },
  ];
  const EVENTS = CUPS.flatMap((cup, ci) => cup.events.map((track, i) => ({
    id: `${cup.id}-${i + 1}`, cup, cupIndex: ci, index: i, track, laps: cup.laps, level: cup.level,
  })));
  const PLACE_COINS = [60, 40, 25, 10];

  // Car skins are only paint: every car drives the same, so nobody buys speed.
  //   model:   body shape  ·  paint / trim: colours  ·  pattern: what's painted over the body
  //   unlock:  { coins } to buy, { stars } from the career, or { cup } for finishing a cup
  const SKINS = [
    { id: 'sunburst', name: 'Sunburst', model: 'coupe', paint: '#ffc53d', trim: '#1b1d22', pattern: 'stripes', num: 7, smoke: '#e9e2d0', unlock: {} },
    { id: 'cherry', name: 'Cherry', model: 'coupe', paint: '#ff4d5e', trim: '#ffffff', pattern: 'stripes', num: 12, smoke: '#f2dede', unlock: { coins: 120 } },
    { id: 'retro', name: 'Retro', model: 'kart', paint: '#f2e3c6', trim: '#2a9d8f', pattern: 'split', num: 3, smoke: '#efe7d6', unlock: { coins: 180 } },
    { id: 'ocean', name: 'Ocean', model: 'formula', paint: '#3a86ff', trim: '#ffffff', pattern: 'racing', num: 21, smoke: '#dbe8ff', unlock: { coins: 240 } },
    { id: 'lime', name: 'Lime Bolt', model: 'buggy', paint: '#9be37a', trim: '#1b1d22', pattern: 'bolt', num: 5, smoke: '#e3f5d8', unlock: { coins: 300 } },
    { id: 'candy', name: 'Candy', model: 'kart', paint: '#ff8fc7', trim: '#ffffff', pattern: 'checker', num: 8, smoke: '#ffd6ec', unlock: { coins: 350 } },
    { id: 'tiger', name: 'Tiger', model: 'coupe', paint: '#ff8a1f', trim: '#1b1d22', pattern: 'tiger', num: 9, smoke: '#f5dfc8', unlock: { coins: 450 } },
    { id: 'midnight', name: 'Midnight', model: 'muscle', paint: '#232a4d', trim: '#5ef0ff', pattern: 'racing', num: 1, smoke: '#a8f6ff', unlock: { coins: 550 } },
    { id: 'inferno', name: 'Inferno', model: 'muscle', paint: '#c81d25', trim: '#ffb000', pattern: 'flames', num: 66, smoke: '#ffcf8a', unlock: { coins: 700 } },
    { id: 'mint', name: 'Mint', model: 'formula', paint: '#7fe0c6', trim: '#20343a', pattern: 'split', num: 14, smoke: '#d9fff4', unlock: { stars: 10 } },
    { id: 'arctic', name: 'Arctic', model: 'buggy', paint: '#f4f9ff', trim: '#4fb3ff', pattern: 'checker', num: 0, smoke: '#ffffff', unlock: { cup: 'rookie' } },
    { id: 'neon', name: 'Neon', model: 'formula', paint: '#1b1030', trim: '#ff3df2', pattern: 'bolt', num: 99, smoke: '#ff9bf7', unlock: { cup: 'pro' } },
    { id: 'phantom', name: 'Phantom', model: 'muscle', paint: '#0f1014', trim: '#9aa3b5', pattern: 'flames', num: 13, smoke: '#7d8494', unlock: { stars: 60 } },
    { id: 'copper', name: 'Copperhead', model: 'coupe', paint: '#b5651d', trim: '#f4e1c1', pattern: 'checker', num: 4, smoke: '#f0d9bf', unlock: { cup: 'club' } },
    { id: 'storm', name: 'Storm', model: 'muscle', paint: '#5b6cff', trim: '#e9ecff', pattern: 'bolt', num: 77, smoke: '#d6dcff', unlock: { cup: 'expert' } },
    { id: 'aurora', name: 'Aurora', model: 'formula', paint: '#12b886', trim: '#c77dff', pattern: 'flames', num: 0, smoke: '#d3fff1', unlock: { cup: 'legend' } },
    { id: 'gold', name: 'Gold Rush', model: 'formula', paint: '#e8b923', trim: '#5a3d00', pattern: 'racing', num: 1, smoke: '#fff1b8', unlock: { cup: 'ace' } },
    { id: 'volt', name: 'Volt', model: 'kart', paint: '#00d2ff', trim: '#0b1d2a', pattern: 'bolt', num: 10, smoke: '#c9f6ff', unlock: { coins: 900 } },
    { id: 'royal', name: 'Royal', model: 'muscle', paint: '#6a1b9a', trim: '#ffd54f', pattern: 'stripes', num: 2, smoke: '#e6cff2', unlock: { coins: 1200 } },
    { id: 'sakura', name: 'Sakura', model: 'buggy', paint: '#ffc6da', trim: '#d81b60', pattern: 'split', num: 11, smoke: '#ffe3ee', unlock: { stars: 90 } },
  ];

  // Rival drivers (names are made up). Each race draws three, with skins that aren't yours.
  const RIVALS = ['Blaze', 'Nova', 'Rex', 'Jet', 'Pixel', 'Turbo', 'Comet', 'Dash', 'Echo', 'Zip', 'Rocket', 'Flash'];

  return { THEMES, themeOf, TRACKS, ALL_TRACKS, trackById, reversed, LEVELS, CUPS, EVENTS, PLACE_COINS, SKINS, RIVALS };
})();
