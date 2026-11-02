/* Rune Rumble content: cards, rarities and levels, frontiers, caches and the glory path. */
const RuneData = (() => {
  // ---------- Cards ----------
  // kind: unit · spell · building. Units walk their lane and fight what's in it.
  //   count: units per card · ranged: shoots (and can hit flyers unless `ground`) · splash: area hits
  //   siege: only attacks buildings · fly: only things that can hit air can hit it
  //   heal / spawn / death / ramp / revive / stunHit: special abilities (see game.js)
  //   blast: bursts when it dies · thorns: melee attackers take this share back · lifesteal: heals this share of what it deals
  //   manaEvery: adds a mana every N seconds · decoy: a building that only soaks up attacks
  // Spells: dmg in radius · stun seconds · rage seconds · bolts (strikes the N toughest)
  //   ticks / every: repeats N times, this many seconds apart · mend: heals your troops
  //   towerMult: spells do less to towers and keeps.
  // arena: which frontier unlocks the card. Tokens are spawned by other cards and can't be collected.
  const CARDS = [
    // Commons
    { id: 'squire', name: 'Squire', rarity: 'common', arena: 0, cost: 2, kind: 'unit', hp: 300, dmg: 60, rate: 1.0, range: 24, speed: 46, r: 9, desc: 'A cheap, sturdy swordsman.' },
    { id: 'bowmen', name: 'Thorn Bowmen', rarity: 'common', arena: 0, cost: 3, kind: 'unit', count: 2, hp: 120, dmg: 42, rate: 1.1, range: 140, speed: 44, r: 7, ranged: true, desc: 'A pair of hooded bowmen who shoot ground and air.' },
    { id: 'rats', name: 'Rat Pack', rarity: 'common', arena: 0, cost: 2, kind: 'unit', count: 4, hp: 50, dmg: 26, rate: 0.8, range: 16, speed: 72, r: 5, desc: 'Four quick biters. Great against big, slow troops.' },
    { id: 'sprites', name: 'Mud Sprites', rarity: 'common', arena: 0, cost: 1, kind: 'unit', count: 3, hp: 40, dmg: 35, rate: 1.0, range: 16, speed: 60, r: 5, desc: 'Three little mud creatures for one mana.' },
    { id: 'bulwark', name: 'Bulwark', rarity: 'common', arena: 0, cost: 3, kind: 'unit', hp: 820, dmg: 85, rate: 1.2, range: 24, speed: 46, r: 10, desc: 'Plated head to toe. Soaks up a lot of damage.' },
    { id: 'sapper', name: 'Sapper', rarity: 'common', arena: 0, cost: 4, kind: 'unit', hp: 240, dmg: 95, rate: 1.8, range: 120, speed: 40, r: 9, ranged: true, ground: true, splash: 48, desc: 'Lobs powder kegs that hit everything nearby. Ground only.' },
    { id: 'needles', name: 'Needle Rain', rarity: 'common', arena: 0, cost: 3, kind: 'spell', dmg: 110, radius: 90, towerMult: 0.35, desc: 'A wide shower of thorns that clears swarms.' },
    { id: 'moths', name: 'Moth Swarm', rarity: 'common', arena: 1, cost: 2, kind: 'unit', count: 4, hp: 45, dmg: 30, rate: 1.0, range: 18, speed: 80, r: 5, fly: true, desc: 'Four flying moths. Melee troops can\'t touch them.' },
    { id: 'snap', name: 'Static Snap', rarity: 'common', arena: 1, cost: 2, kind: 'spell', dmg: 120, radius: 48, stun: 0.6, towerMult: 0.35, desc: 'A quick shock that stuns for a moment.' },
    { id: 'bombard', name: 'Bombard', rarity: 'common', arena: 1, cost: 3, kind: 'building', hp: 600, dmg: 80, rate: 1.0, range: 150, life: 30, r: 13, ranged: true, ground: true, desc: 'A sturdy gun emplacement that shoots ground troops.' },
    { id: 'scout', name: 'Fox Scout', rarity: 'common', arena: 0, cost: 1, kind: 'unit', hp: 110, dmg: 50, rate: 0.9, range: 18, speed: 88, r: 6, desc: 'A lone runner for one mana. Good for claiming a well early.' },
    { id: 'flick', name: 'Ember Flick', rarity: 'common', arena: 0, cost: 1, kind: 'spell', dmg: 65, radius: 42, towerMult: 0.35, desc: 'A small, cheap burst that finishes off weak troops.' },
    { id: 'pikes', name: 'Pike Line', rarity: 'common', arena: 1, cost: 3, kind: 'unit', count: 3, hp: 170, dmg: 48, rate: 1.1, range: 40, speed: 44, r: 7, desc: 'Three pikemen who strike from behind the front line.' },
    { id: 'hawk', name: 'Kite Hawk', rarity: 'common', arena: 2, cost: 3, kind: 'unit', hp: 320, dmg: 65, rate: 1.1, range: 30, speed: 76, r: 8, fly: true, desc: 'A quick bird of prey that melee troops can\'t reach.' },

    // Rares
    { id: 'brute', name: 'Brute', rarity: 'rare', arena: 0, cost: 5, kind: 'unit', hp: 1500, dmg: 130, rate: 1.6, range: 26, speed: 28, r: 15, siege: true, desc: 'A huge ogre that only smashes buildings.' },
    { id: 'rider', name: 'Rider', rarity: 'rare', arena: 0, cost: 4, kind: 'unit', hp: 560, dmg: 115, rate: 1.3, range: 26, speed: 88, r: 11, desc: 'Gallops in fast and hits hard.' },
    { id: 'cinder', name: 'Cinder Burst', rarity: 'rare', arena: 0, cost: 4, kind: 'spell', dmg: 280, radius: 64, towerMult: 0.35, desc: 'Big damage in a small area.' },
    { id: 'turret', name: 'Turret', rarity: 'rare', arena: 0, cost: 3, kind: 'building', hp: 520, dmg: 48, rate: 0.9, range: 165, life: 25, r: 13, ranged: true, desc: 'A ballista that shoots ground and air.' },
    { id: 'whirlblade', name: 'Whirlblade', rarity: 'rare', arena: 1, cost: 4, kind: 'unit', hp: 900, dmg: 110, rate: 1.4, range: 24, speed: 46, r: 10, splash: 40, desc: 'Spins an axe through everything nearby.' },
    { id: 'longshot', name: 'Longshot', rarity: 'rare', arena: 1, cost: 4, kind: 'unit', hp: 340, dmg: 100, rate: 1.1, range: 160, speed: 44, r: 8, ranged: true, desc: 'A patient marksman. Hits air too.' },
    { id: 'mender', name: 'Mender', rarity: 'rare', arena: 2, cost: 4, kind: 'unit', hp: 420, dmg: 30, rate: 1.0, range: 26, speed: 44, r: 9, heal: { amt: 50, radius: 75, every: 1 }, desc: 'Patches up nearby friendly troops every second.' },
    { id: 'burrow', name: 'Burrow Den', rarity: 'rare', arena: 2, cost: 5, kind: 'building', hp: 700, dmg: 0, rate: 1, range: 0, life: 35, r: 15, spawn: { id: 'burrower', every: 4.5, n: 1 }, desc: 'Sends out a burrower every few seconds.' },
    { id: 'charger', name: 'Siege Charger', rarity: 'rare', arena: 2, cost: 4, kind: 'unit', hp: 1000, dmg: 150, rate: 1.5, range: 24, speed: 88, r: 12, siege: true, desc: 'Thunders straight for buildings.' },
    { id: 'adept', name: 'Ember Adept', rarity: 'rare', arena: 2, cost: 5, kind: 'unit', hp: 380, dmg: 120, rate: 1.4, range: 140, speed: 44, r: 9, ranged: true, splash: 40, desc: 'Hurls embers that hit groups, ground and air.' },
    { id: 'thornwall', name: 'Bramble Wall', rarity: 'rare', arena: 0, cost: 2, kind: 'building', hp: 850, dmg: 0, rate: 1, range: 0, life: 20, r: 14, decoy: true, desc: 'Does nothing but get in the way. Troops stop to hack through it.' },
    { id: 'beetle', name: 'Blast Beetle', rarity: 'rare', arena: 1, cost: 3, kind: 'unit', hp: 260, dmg: 30, rate: 1.0, range: 18, speed: 80, r: 8, blast: { dmg: 220, radius: 52 }, desc: 'Scuttles in fast and explodes when it dies.' },
    { id: 'spore', name: 'Spore Cloud', rarity: 'rare', arena: 2, cost: 3, kind: 'spell', dmg: 48, radius: 70, ticks: 5, every: 0.8, towerMult: 0.35, desc: 'A lingering cloud that hurts everything inside five times.' },
    { id: 'font', name: 'Rune Font', rarity: 'rare', arena: 3, cost: 4, kind: 'building', hp: 520, dmg: 0, rate: 1, range: 0, life: 40, r: 13, manaEvery: 7, desc: 'Pays back a mana every 7 seconds, if it survives long enough.' },

    // Epics
    { id: 'wyrmling', name: 'Wyrmling', rarity: 'epic', arena: 2, cost: 4, kind: 'unit', hp: 850, dmg: 95, rate: 1.6, range: 90, speed: 60, r: 12, ranged: true, splash: 36, fly: true, desc: 'A young flying wyrm with a splash of fire.' },
    { id: 'frostbind', name: 'Frostbind', rarity: 'epic', arena: 3, cost: 4, kind: 'spell', dmg: 70, radius: 72, stun: 3, towerMult: 0.5, desc: 'Locks everything in the area in ice for 3 seconds.' },
    { id: 'colossus', name: 'Stone Colossus', rarity: 'epic', arena: 3, cost: 8, kind: 'unit', hp: 3800, dmg: 220, rate: 2.5, range: 26, speed: 24, r: 18, siege: true, death: { id: 'shardling', n: 2 }, desc: 'Enormous and slow. Crumbles into two shardlings.' },
    { id: 'gravecaller', name: 'Gravecaller', rarity: 'epic', arena: 3, cost: 5, kind: 'unit', hp: 500, dmg: 70, rate: 1.4, range: 120, speed: 44, r: 9, ranged: true, spawn: { id: 'sprites', every: 6, n: 2 }, desc: 'Calls up mud sprites while walking.' },
    { id: 'stormcall', name: 'Stormcall', rarity: 'epic', arena: 4, cost: 6, kind: 'spell', dmg: 600, radius: 95, bolts: 3, towerMult: 0.4, desc: 'Strikes the three toughest targets in the area.' },
    { id: 'hymn', name: 'Battle Hymn', rarity: 'epic', arena: 4, cost: 2, kind: 'spell', dmg: 0, radius: 95, rage: 6, desc: 'Your troops move and attack 40% faster for 6 seconds.' },
    { id: 'thornback', name: 'Thornback', rarity: 'epic', arena: 2, cost: 5, kind: 'unit', hp: 1100, dmg: 70, rate: 1.4, range: 24, speed: 36, r: 13, thorns: 0.33, desc: 'A spiked knight. Melee attackers take a third of their own damage back.' },
    { id: 'mendrain', name: 'Mending Rain', rarity: 'epic', arena: 3, cost: 3, kind: 'spell', dmg: 0, radius: 90, mend: 320, desc: 'Heals your troops in the area in one go.' },
    { id: 'wisps', name: 'Wisp Horde', rarity: 'epic', arena: 4, cost: 5, kind: 'unit', count: 6, hp: 70, dmg: 42, rate: 1.0, range: 18, speed: 70, r: 5, fly: true, desc: 'Six glowing wisps. Deadly unless something hits an area.' },

    // Legendaries
    { id: 'flamebow', name: 'Flamebow', rarity: 'legendary', arena: 3, cost: 3, kind: 'unit', hp: 220, dmg: 70, rate: 2.6, range: 230, speed: 44, r: 8, ranged: true, splash: 24, desc: 'A hooded sniper firing burning arrows from very far away.' },
    { id: 'stormmage', name: 'Storm Mage', rarity: 'legendary', arena: 4, cost: 4, kind: 'unit', hp: 500, dmg: 90, rate: 1.6, range: 130, speed: 46, r: 9, ranged: true, stunHit: 0.5, desc: 'Every bolt stuns whatever it hits.' },
    { id: 'sunlance', name: 'Sunlance', rarity: 'legendary', arena: 4, cost: 5, kind: 'building', hp: 900, dmg: 20, rate: 0.3, range: 150, life: 30, r: 14, ranged: true, ramp: true, desc: 'A beam that burns hotter the longer it holds a target.' },
    { id: 'ashwing', name: 'Ashwing', rarity: 'legendary', arena: 5, cost: 5, kind: 'unit', hp: 700, dmg: 120, rate: 1.2, range: 70, speed: 64, r: 11, ranged: true, splash: 30, fly: true, revive: true, desc: 'A burning bird that rises again once from its ashes.' },
    { id: 'hexblade', name: 'Hexblade', rarity: 'legendary', arena: 4, cost: 4, kind: 'unit', hp: 520, dmg: 95, rate: 1.1, range: 24, speed: 60, r: 10, lifesteal: 0.4, desc: 'A cursed duelist. Every strike heals them.' },

    // Tokens (spawned by other cards)
    { id: 'burrower', name: 'Burrower', token: true, cost: 0, kind: 'unit', hp: 110, dmg: 55, rate: 1.0, range: 18, speed: 72, r: 6 },
    { id: 'shardling', name: 'Shardling', token: true, cost: 0, kind: 'unit', hp: 900, dmg: 60, rate: 2.5, range: 24, speed: 28, r: 11, siege: true },
  ];
  const card = id => CARDS.find(c => c.id === id);
  const COLLECTIBLE = CARDS.filter(c => !c.token);
  const STARTER = ['squire', 'bowmen', 'rats', 'brute', 'sapper', 'rider', 'cinder', 'turret'];
  // What the first frontier's bots bring: no spells and nothing big.
  const NOVICE_DECK = ['squire', 'bowmen', 'rats', 'sprites', 'bulwark', 'sapper', 'rider', 'turret'];

  // ---------- Rarities & levels ----------
  // Copies needed to go from level L to L+1 (index L-1), and the gold it costs.
  const RARITIES = {
    common: { name: 'Common', color: '#9aa7b8', glow: '#cfd8e3', copies: [2, 4, 10, 20, 40, 80, 150, 250] },
    rare: { name: 'Rare', color: '#ff9a3d', glow: '#ffc58a', copies: [1, 2, 4, 10, 20, 40, 80, 120] },
    epic: { name: 'Epic', color: '#c45cff', glow: '#e3a8ff', copies: [1, 1, 2, 4, 8, 15, 25, 40] },
    legendary: { name: 'Legendary', color: '#3de0c8', glow: '#a8fff1', copies: [1, 1, 1, 2, 4, 6, 10, 15] },
  };
  const UPGRADE_GOLD = [20, 50, 150, 400, 1000, 2000, 4000, 8000];
  const MAX_LEVEL = 9;
  const levelMult = lvl => 1.1 ** (lvl - 1);

  // ---------- Frontiers (the ladder's stages) ----------
  // Bots never get more mana than you (mana is a rate, 1 at most). They get harder by acting more often
  // (think, seconds), hesitating less (slip, chance per think) and noticing new troops sooner (react, seconds).
  // They never out-level your deck: level is only the most they'll match. novice bots play badly on purpose: see noviceThink in game.js.
  const ARENAS = [
    { id: 'commons', name: 'Mossgate Commons', glory: 0, grass: '#4a8c3f', grass2: '#428035', path: '#c9ad7a', river: '#3f8fd6', deco: ['tree', 'bush', 'flower'], bot: { think: 1.9, mana: 0.7, level: 1, novice: true } },
    { id: 'flats', name: 'Saltbone Flats', glory: 300, grass: '#8c7a55', grass2: '#80704d', path: '#d9c79c', river: '#5a9b8f', deco: ['bone', 'rock', 'skull'], bot: { think: 2.0, mana: 0.7, slip: 0.45, react: 1.6, save: 10, level: 2 } },
    { id: 'hollow', name: 'Fungal Hollow', glory: 700, grass: '#3d7a46', grass2: '#356d3e', path: '#a98d5e', river: '#2f7fa8', deco: ['mushroom', 'tree', 'stump'], bot: { think: 1.9, mana: 0.75, slip: 0.4, react: 1.4, save: 10, level: 3 } },
    { id: 'pass', name: 'Glasswind Pass', glory: 1200, grass: '#dce9f2', grass2: '#cfdeea', path: '#9fb6c9', river: '#6fb6e8', deco: ['pine', 'snowrock', 'ice'], bot: { think: 1.6, mana: 0.8, slip: 0.32, react: 1.2, save: 9, level: 5 } },
    { id: 'works', name: 'The Cinderworks', glory: 1800, grass: '#4a3a36', grass2: '#41322f', path: '#7d5d48', river: '#ff7a2f', deco: ['lavarock', 'anvil', 'ember'], bot: { think: 1.3, mana: 0.85, slip: 0.25, react: 1.0, save: 8, level: 6 } },
    { id: 'bastion', name: 'Starfall Bastion', glory: 2600, grass: '#5a4a8a', grass2: '#51427e', path: '#c9b98f', river: '#7a6bff', deco: ['statue', 'banner', 'hedge'], bot: { think: 1.0, mana: 0.95, slip: 0.15, react: 0.8, save: 8, level: 8 } },
  ];
  const arenaFor = glory => ARENAS.reduce((a, ar, i) => (glory >= ar.glory ? i : a), 0);

  // ---------- Caches ----------
  // battles: how many finished battles charge it open. rush: gold to skip the whole charge.
  // Cards and gold grow with your frontier.
  const CACHES = {
    free: { name: 'Pocket Cache', battles: 0, rush: 0, cards: 4, gold: 20, color: '#8a6a45' },
    silver: { name: 'Copper Cache', battles: 1, rush: 24, cards: 8, gold: 40, color: '#d0814f' },
    golden: { name: 'Amber Cache', battles: 2, rush: 64, cards: 20, gold: 120, color: '#ffc53d' },
    magic: { name: 'Astral Cache', battles: 4, rush: 160, cards: 45, gold: 300, color: '#c45cff', epic: 2 },
    legendary: { name: 'Mythic Cache', battles: 5, rush: 240, cards: 1, gold: 0, color: '#3de0c8', legendary: true },
  };
  const CACHE_CYCLE = ['silver', 'silver', 'golden', 'silver', 'silver', 'silver', 'golden', 'silver', 'magic', 'silver', 'golden', 'silver'];
  const FREE_EVERY_H = 4;
  const ODDS = { common: 0.7, rare: 0.245, epic: 0.05, legendary: 0.005 };

  // ---------- Glory path ----------
  const ROAD = [
    { t: 50, gold: 50 }, { t: 100, cache: 'silver' }, { t: 200, gold: 150 }, { t: 300, cache: 'golden' },
    { t: 400, gold: 250 }, { t: 500, cache: 'silver' }, { t: 600, gold: 350 }, { t: 700, cache: 'magic' },
    { t: 850, gold: 500 }, { t: 1000, cache: 'golden' }, { t: 1200, cache: 'legendary' }, { t: 1400, gold: 1000 },
    { t: 1600, cache: 'magic' }, { t: 1800, cache: 'golden' }, { t: 2000, gold: 2000 }, { t: 2300, cache: 'magic' },
    { t: 2600, cache: 'legendary' }, { t: 3000, gold: 5000 }, { t: 3500, cache: 'magic' }, { t: 4000, cache: 'legendary' },
  ];

  const BOT_NAMES = ['Sir Grumble', 'Lady Ash', 'Old Maple', 'Captain Pike', 'Mira the Bold', 'Baron Thistle', 'Dame Ember', 'Rook', 'Fennick', 'Grimsby'];

  return {
    CARDS, card, COLLECTIBLE, STARTER, NOVICE_DECK, RARITIES, UPGRADE_GOLD, MAX_LEVEL, levelMult,
    ARENAS, arenaFor, CACHES, CACHE_CYCLE, FREE_EVERY_H, ODDS, ROAD, BOT_NAMES,
  };
})();
