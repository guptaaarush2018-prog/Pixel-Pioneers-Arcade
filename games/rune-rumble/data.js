/* Rune Rumble content: cards, rarities and levels, arenas, chests and the trophy road. */
const RuneData = (() => {
  // ---------- Cards ----------
  // kind: unit · spell · building. Units walk their lane and fight what's in it.
  //   count: units per card · ranged: shoots (and can hit flyers unless `ground`) · splash: area hits
  //   siege: only attacks buildings · fly: only things that can hit air can hit it
  //   heal / spawn / death / ramp / revive / stunHit: special abilities (see game.js)
  // Spells: dmg in radius · stun seconds · rage seconds · bolts (lightning: strikes the N toughest)
  //   towerMult: spells do less to towers and keeps.
  // arena: which arena unlocks the card. Tokens are spawned by other cards and can't be collected.
  const CARDS = [
    // Commons
    { id: 'squire', name: 'Squire', rarity: 'common', arena: 0, cost: 2, kind: 'unit', hp: 300, dmg: 60, rate: 1.0, range: 24, speed: 46, r: 9, desc: 'A cheap, sturdy swordsman.' },
    { id: 'archers', name: 'Archers', rarity: 'common', arena: 0, cost: 3, kind: 'unit', count: 2, hp: 120, dmg: 42, rate: 1.1, range: 140, speed: 44, r: 7, ranged: true, desc: 'Two archers who shoot ground and air.' },
    { id: 'rats', name: 'Rat Pack', rarity: 'common', arena: 0, cost: 2, kind: 'unit', count: 4, hp: 50, dmg: 26, rate: 0.8, range: 16, speed: 72, r: 5, desc: 'Four quick biters. Great against big, slow troops.' },
    { id: 'skeletons', name: 'Skeletons', rarity: 'common', arena: 0, cost: 1, kind: 'unit', count: 3, hp: 40, dmg: 35, rate: 1.0, range: 16, speed: 60, r: 5, desc: 'Three fragile skeletons for one mana.' },
    { id: 'knight', name: 'Knight', rarity: 'common', arena: 0, cost: 3, kind: 'unit', hp: 820, dmg: 85, rate: 1.2, range: 24, speed: 46, r: 10, desc: 'Armoured all over. Soaks up a lot of damage.' },
    { id: 'bomber', name: 'Bomber', rarity: 'common', arena: 0, cost: 4, kind: 'unit', hp: 240, dmg: 95, rate: 1.8, range: 120, speed: 40, r: 9, ranged: true, ground: true, splash: 48, desc: 'Lobs bombs that hit everything nearby. Ground only.' },
    { id: 'arrows', name: 'Arrows', rarity: 'common', arena: 0, cost: 3, kind: 'spell', dmg: 110, radius: 90, towerMult: 0.35, desc: 'A wide volley that clears swarms.' },
    { id: 'bats', name: 'Bat Swarm', rarity: 'common', arena: 1, cost: 2, kind: 'unit', count: 4, hp: 45, dmg: 30, rate: 1.0, range: 18, speed: 80, r: 5, fly: true, desc: 'Four flying bats. Melee troops can\'t touch them.' },
    { id: 'zap', name: 'Zap', rarity: 'common', arena: 1, cost: 2, kind: 'spell', dmg: 120, radius: 48, stun: 0.6, towerMult: 0.35, desc: 'A quick shock that stuns for a moment.' },
    { id: 'cannon', name: 'Cannon', rarity: 'common', arena: 1, cost: 3, kind: 'building', hp: 600, dmg: 80, rate: 1.0, range: 150, life: 30, r: 13, ranged: true, ground: true, desc: 'A sturdy defence that shoots ground troops.' },

    // Rares
    { id: 'brute', name: 'Brute', rarity: 'rare', arena: 0, cost: 5, kind: 'unit', hp: 1500, dmg: 130, rate: 1.6, range: 26, speed: 28, r: 15, siege: true, desc: 'A huge ogre that only smashes buildings.' },
    { id: 'rider', name: 'Rider', rarity: 'rare', arena: 0, cost: 4, kind: 'unit', hp: 560, dmg: 115, rate: 1.3, range: 26, speed: 88, r: 11, desc: 'Gallops in fast and hits hard.' },
    { id: 'fireball', name: 'Fireball', rarity: 'rare', arena: 0, cost: 4, kind: 'spell', dmg: 280, radius: 64, towerMult: 0.35, desc: 'Big damage in a small area.' },
    { id: 'turret', name: 'Turret', rarity: 'rare', arena: 0, cost: 3, kind: 'building', hp: 520, dmg: 48, rate: 0.9, range: 165, life: 25, r: 13, ranged: true, desc: 'A ballista that shoots ground and air.' },
    { id: 'valkyrie', name: 'Valkyrie', rarity: 'rare', arena: 1, cost: 4, kind: 'unit', hp: 900, dmg: 110, rate: 1.4, range: 24, speed: 46, r: 10, splash: 40, desc: 'Spins her axe through everything around her.' },
    { id: 'musketeer', name: 'Musketeer', rarity: 'rare', arena: 1, cost: 4, kind: 'unit', hp: 340, dmg: 100, rate: 1.1, range: 160, speed: 44, r: 8, ranged: true, desc: 'Long-range sharpshooter. Hits air too.' },
    { id: 'healer', name: 'Healer', rarity: 'rare', arena: 2, cost: 4, kind: 'unit', hp: 420, dmg: 30, rate: 1.0, range: 26, speed: 44, r: 9, heal: { amt: 50, radius: 75, every: 1 }, desc: 'Heals nearby friendly troops every second.' },
    { id: 'goblinhut', name: 'Goblin Hut', rarity: 'rare', arena: 2, cost: 5, kind: 'building', hp: 700, dmg: 0, rate: 1, range: 0, life: 35, r: 15, spawn: { id: 'goblin', every: 4.5, n: 1 }, desc: 'Sends out a goblin every few seconds.' },
    { id: 'ramrider', name: 'Ram Rider', rarity: 'rare', arena: 2, cost: 4, kind: 'unit', hp: 1000, dmg: 150, rate: 1.5, range: 24, speed: 88, r: 12, siege: true, desc: 'Charges straight for buildings.' },
    { id: 'wizard', name: 'Wizard', rarity: 'rare', arena: 2, cost: 5, kind: 'unit', hp: 380, dmg: 120, rate: 1.4, range: 140, speed: 44, r: 9, ranged: true, splash: 40, desc: 'Throws fireballs that hit groups, ground and air.' },

    // Epics
    { id: 'dragon', name: 'Baby Dragon', rarity: 'epic', arena: 2, cost: 4, kind: 'unit', hp: 850, dmg: 95, rate: 1.6, range: 90, speed: 60, r: 12, ranged: true, splash: 36, fly: true, desc: 'A flying tank that breathes splash fire.' },
    { id: 'freeze', name: 'Freeze', rarity: 'epic', arena: 3, cost: 4, kind: 'spell', dmg: 70, radius: 72, stun: 3, towerMult: 0.5, desc: 'Freezes everything in the area for 3 seconds.' },
    { id: 'golem', name: 'Stone Golem', rarity: 'epic', arena: 3, cost: 8, kind: 'unit', hp: 3800, dmg: 220, rate: 2.5, range: 26, speed: 24, r: 18, siege: true, death: { id: 'golemite', n: 2 }, desc: 'Enormous and slow. Breaks into two golemites.' },
    { id: 'necro', name: 'Necromancer', rarity: 'epic', arena: 3, cost: 5, kind: 'unit', hp: 500, dmg: 70, rate: 1.4, range: 120, speed: 44, r: 9, ranged: true, spawn: { id: 'skeletons', every: 6, n: 2 }, desc: 'Raises skeletons as she walks.' },
    { id: 'lightning', name: 'Lightning', rarity: 'epic', arena: 4, cost: 6, kind: 'spell', dmg: 600, radius: 95, bolts: 3, towerMult: 0.4, desc: 'Strikes the three toughest targets in the area.' },
    { id: 'rage', name: 'Rage', rarity: 'epic', arena: 4, cost: 2, kind: 'spell', dmg: 0, radius: 95, rage: 6, desc: 'Your troops move and attack 40% faster for 6 seconds.' },

    // Legendaries
    { id: 'princess', name: 'Princess', rarity: 'legendary', arena: 3, cost: 3, kind: 'unit', hp: 220, dmg: 70, rate: 2.6, range: 230, speed: 44, r: 8, ranged: true, splash: 24, desc: 'Fires flaming arrows from very far away.' },
    { id: 'electro', name: 'Storm Mage', rarity: 'legendary', arena: 4, cost: 4, kind: 'unit', hp: 500, dmg: 90, rate: 1.6, range: 130, speed: 46, r: 9, ranged: true, stunHit: 0.5, desc: 'Every bolt stuns whatever it hits.' },
    { id: 'inferno', name: 'Inferno Spire', rarity: 'legendary', arena: 4, cost: 5, kind: 'building', hp: 900, dmg: 20, rate: 0.3, range: 150, life: 30, r: 14, ranged: true, ramp: true, desc: 'A beam that burns hotter the longer it holds a target.' },
    { id: 'phoenix', name: 'Phoenix', rarity: 'legendary', arena: 5, cost: 5, kind: 'unit', hp: 700, dmg: 120, rate: 1.2, range: 70, speed: 64, r: 11, ranged: true, splash: 30, fly: true, revive: true, desc: 'Flies, burns, and rises again once from its ashes.' },

    // Tokens (spawned by other cards)
    { id: 'goblin', name: 'Goblin', token: true, cost: 0, kind: 'unit', hp: 110, dmg: 55, rate: 1.0, range: 18, speed: 72, r: 6 },
    { id: 'golemite', name: 'Golemite', token: true, cost: 0, kind: 'unit', hp: 900, dmg: 60, rate: 2.5, range: 24, speed: 28, r: 11, siege: true },
  ];
  const card = id => CARDS.find(c => c.id === id);
  const COLLECTIBLE = CARDS.filter(c => !c.token);
  const STARTER = ['squire', 'archers', 'rats', 'brute', 'bomber', 'rider', 'fireball', 'turret'];

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
  const ONLINE_LEVEL = 5; // online, every card and tower fights at this level
  const levelMult = lvl => 1.1 ** (lvl - 1);

  // ---------- Arenas ----------
  const ARENAS = [
    { id: 'meadow', name: 'Training Meadow', trophies: 0, grass: '#4a8c3f', grass2: '#428035', path: '#c9ad7a', river: '#3f8fd6', deco: ['tree', 'bush', 'flower'], bot: { think: 1.6, mana: 0.75, level: 1 } },
    { id: 'bone', name: 'Bone Pit', trophies: 300, grass: '#8c7a55', grass2: '#80704d', path: '#d9c79c', river: '#5a9b8f', deco: ['bone', 'rock', 'skull'], bot: { think: 1.2, mana: 0.85, level: 2 } },
    { id: 'glade', name: 'Goblin Glade', trophies: 700, grass: '#3d7a46', grass2: '#356d3e', path: '#a98d5e', river: '#2f7fa8', deco: ['mushroom', 'tree', 'stump'], bot: { think: 1.0, mana: 0.95, level: 3 } },
    { id: 'frost', name: 'Frost Peak', trophies: 1200, grass: '#dce9f2', grass2: '#cfdeea', path: '#9fb6c9', river: '#6fb6e8', deco: ['pine', 'snowrock', 'ice'], bot: { think: 0.8, mana: 1.0, level: 5 } },
    { id: 'forge', name: 'Ember Forge', trophies: 1800, grass: '#4a3a36', grass2: '#41322f', path: '#7d5d48', river: '#ff7a2f', deco: ['lavarock', 'anvil', 'ember'], bot: { think: 0.6, mana: 1.08, level: 6 } },
    { id: 'citadel', name: 'Royal Citadel', trophies: 2600, grass: '#5a4a8a', grass2: '#51427e', path: '#c9b98f', river: '#7a6bff', deco: ['statue', 'banner', 'hedge'], bot: { think: 0.45, mana: 1.15, level: 8 } },
  ];
  const arenaFor = trophies => ARENAS.reduce((a, ar, i) => (trophies >= ar.trophies ? i : a), 0);

  // ---------- Chests ----------
  // Minutes to unlock; cards and gold grow with your arena.
  const CHESTS = {
    free: { name: 'Free Chest', minutes: 0, cards: 4, gold: 20, color: '#8a6a45' },
    silver: { name: 'Silver Chest', minutes: 3, cards: 8, gold: 40, color: '#b8c4d4' },
    golden: { name: 'Golden Chest', minutes: 8, cards: 20, gold: 120, color: '#ffc53d' },
    magic: { name: 'Magic Chest', minutes: 20, cards: 45, gold: 300, color: '#c45cff', epic: 2 },
    legendary: { name: 'Legend Chest', minutes: 30, cards: 1, gold: 0, color: '#3de0c8', legendary: true },
  };
  const CHEST_CYCLE = ['silver', 'silver', 'golden', 'silver', 'silver', 'silver', 'golden', 'silver', 'magic', 'silver', 'golden', 'silver'];
  const FREE_EVERY_H = 4;
  const ODDS = { common: 0.7, rare: 0.245, epic: 0.05, legendary: 0.005 };

  // ---------- Trophy road ----------
  const ROAD = [
    { t: 50, gold: 50 }, { t: 100, chest: 'silver' }, { t: 200, gold: 150 }, { t: 300, chest: 'golden' },
    { t: 400, gold: 250 }, { t: 500, chest: 'silver' }, { t: 600, gold: 350 }, { t: 700, chest: 'magic' },
    { t: 850, gold: 500 }, { t: 1000, chest: 'golden' }, { t: 1200, chest: 'legendary' }, { t: 1400, gold: 1000 },
    { t: 1600, chest: 'magic' }, { t: 1800, chest: 'golden' }, { t: 2000, gold: 2000 }, { t: 2300, chest: 'magic' },
    { t: 2600, chest: 'legendary' }, { t: 3000, gold: 5000 }, { t: 3500, chest: 'magic' }, { t: 4000, chest: 'legendary' },
  ];

  const BOT_NAMES = ['Sir Grumble', 'Lady Ash', 'Old Maple', 'Captain Pike', 'Mira the Bold', 'Baron Thistle', 'Dame Ember', 'Rook', 'Fennick', 'Grimsby'];

  return {
    CARDS, card, COLLECTIBLE, STARTER, RARITIES, UPGRADE_GOLD, MAX_LEVEL, ONLINE_LEVEL, levelMult,
    ARENAS, arenaFor, CHESTS, CHEST_CYCLE, FREE_EVERY_H, ODDS, ROAD, BOT_NAMES,
  };
})();
