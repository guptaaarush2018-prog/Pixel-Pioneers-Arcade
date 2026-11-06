// Gem Mine content: everything you can buy, find or unlock. game.js holds the rules.
// Effects (fx) are combined by kind; see FX in game.js. Ores are named by the layer they come from.
window.GEM = (() => {
  const ORES = ['copper', 'iron', 'crystal', 'obsidian', 'gold', 'starstone'];

  // A run starts at the top of a fresh shaft. Breaching a layer's bedrock costs gems plus that layer's ore,
  // opens the next layer's diggers and ore, and makes everything 25% richer.
  const LAYERS = [
    { name: 'Topsoil', ore: 'Copper', oreColor: '#e0915a', price: 5, breach: { gems: 1500, ore: 25 }, rock: '#5d566b', top: '#6d6680', hue: 280 },
    { name: 'Granite', ore: 'Iron', oreColor: '#b8c4cc', price: 150, breach: { gems: 2e5, ore: 60 }, rock: '#62666e', top: '#767b85', hue: 220 },
    { name: 'Crystal Caves', ore: 'Crystal', oreColor: '#7fdbff', price: 1.2e4, breach: { gems: 2e7, ore: 80 }, rock: '#3f5a73', top: '#557a99', hue: 200 },
    { name: 'Magma Rivers', ore: 'Obsidian', oreColor: '#a58cff', price: 1.5e6, breach: { gems: 3e9, ore: 100 }, rock: '#6b3a2e', top: '#8a4b3a', hue: 15 },
    { name: 'Outer Core', ore: 'Gold', oreColor: '#ffd54f', price: 2e8, breach: { gems: 5e11, ore: 120 }, rock: '#7a5a1f', top: '#9c7628', hue: 40 },
    { name: 'Starfall Deep', ore: 'Starstone', oreColor: '#f48fb1', price: 3e10, breach: null, rock: '#2e2a5c', top: '#433d85', hue: 250 },
  ];

  // `layer`: the layer you have to reach (this run) before you can hire them.
  const DIGGERS = [
    { name: 'Pebble Pup', cost: 15, rate: 0.2, color: '#c8a27a', layer: 0 },
    { name: 'Mole', cost: 100, rate: 2, color: '#8d6e63', layer: 0 },
    { name: 'Drill Bot', cost: 1100, rate: 14, color: '#90a4ae', layer: 1 },
    { name: 'Excavator', cost: 12000, rate: 80, color: '#ffb300', layer: 1 },
    { name: 'Blast Crew', cost: 130000, rate: 450, color: '#ef5350', layer: 2 },
    { name: 'Lava Pump', cost: 1.4e6, rate: 2500, color: '#ff7043', layer: 2 },
    { name: 'Core Tap', cost: 2e7, rate: 14000, color: '#ab47bc', layer: 3 },
    { name: 'Star Forge', cost: 3.3e8, rate: 80000, color: '#4fc3f7', layer: 3 },
    { name: 'Void Drill', cost: 5.1e9, rate: 470000, color: '#7e57c2', layer: 4 },
    { name: 'Planet Cracker', cost: 7.5e10, rate: 2.8e6, color: '#ec407a', layer: 5 },
  ];

  // Lab research: one-time, for this run only. Costs gems plus the ore of its layer.
  const RESEARCH = [
    { id: 'gloves', name: 'Padded Gloves', layer: 0, gems: 200, ore: 5, desc: 'Clicks add +1% of gems/s', fx: { clickPct: 0.01 } },
    { id: 'cart', name: 'Ore Cart', layer: 0, gems: 600, ore: 10, desc: 'Ore costs 25% less to refine', fx: { orePrice: 0.75 } },
    { id: 'dyn', name: 'Dynamite', layer: 0, gems: 1200, ore: 15, desc: 'Unlocks the Dynamite ability (1)', fx: { ability: 'dyn' } },
    { id: 'polish', name: 'Gem Polish', layer: 1, gems: 1.5e4, ore: 15, desc: 'Diggers dig 50% faster', fx: { dig: 1.5 } },
    { id: 'charm', name: 'Lucky Charm', layer: 1, gems: 2.5e4, ore: 20, desc: 'Golden nuggets twice as often', fx: { nuggetFreq: 2 } },
    { id: 'foremen', name: 'Foremen', layer: 1, gems: 4e4, ore: 25, desc: 'Digger teamwork bonus doubled', fx: { synergy: 2 } },
    { id: 'warehouse', name: 'Warehouse', layer: 1, gems: 8e4, ore: 35, desc: 'Away earnings for up to 12 hours', fx: { offlineCap: 12 } },
    { id: 'overclock', name: 'Overclock', layer: 2, gems: 1.5e6, ore: 20, desc: 'Unlocks the Overclock ability (2)', fx: { ability: 'over' } },
    { id: 'veins', name: 'Vein Finder', layer: 2, gems: 3e6, ore: 30, desc: 'Veins pay 3× and show up more', fx: { veinPay: 3, veinFreq: 1.5 } },
    { id: 'prism', name: 'Prism Lenses', layer: 2, gems: 6e6, ore: 40, desc: 'Diggers dig twice as fast', fx: { dig: 2 } },
    { id: 'rush', name: 'Rush Hour', layer: 3, gems: 2e8, ore: 25, desc: 'Gem rushes last 15s longer', fx: { rushTime: 15 } },
    { id: 'eye', name: "Prospector's Eye", layer: 3, gems: 4e8, ore: 35, desc: 'Unlocks the Prospect ability (3)', fx: { ability: 'eye' } },
    { id: 'sinks', name: 'Heat Sinks', layer: 3, gems: 8e8, ore: 45, desc: 'Abilities recharge 25% faster', fx: { cd: 0.75 } },
    { id: 'molten', name: 'Molten Core', layer: 4, gems: 4e10, ore: 30, desc: 'Diggers dig three times as fast', fx: { dig: 3 } },
    { id: 'twin', name: 'Twin Shafts', layer: 4, gems: 8e10, ore: 45, desc: 'A second expedition at a time', fx: { trips: 1 } },
    { id: 'lattice', name: 'Star Lattice', layer: 5, gems: 1e13, ore: 25, desc: 'Diggers and clicks ×2', fx: { dig: 2, click: 2 } },
  ];

  const ABILITIES = [
    { id: 'dyn', key: '1', name: 'Dynamite', cd: 120, desc: 'A minute of digging, right now' },
    { id: 'over', key: '2', name: 'Overclock', cd: 180, desc: 'Diggers ×3 for 20s, then ½ for 10s' },
    { id: 'eye', key: '3', name: 'Prospect', cd: 240, desc: 'A nugget and an easy vein appear' },
  ];

  // Drill bits are forged from ore and kept forever. Only so many fit on the drill at once.
  const BITS = [
    { id: 'steady', name: 'Steady Bit', cost: { copper: 400, iron: 120 }, desc: 'Diggers +30%', fx: { dig: 1.3 } },
    { id: 'spark', name: 'Spark Bit', cost: { iron: 400 }, desc: 'Clicks ×2.5, but diggers −10%', fx: { click: 2.5, dig: 0.9 } },
    { id: 'lucky', name: 'Lucky Bit', cost: { crystal: 300 }, desc: 'Nuggets and veins ×2 as often, diggers −15%', fx: { nuggetFreq: 2, veinFreq: 2, dig: 0.85 } },
    { id: 'blast', name: 'Blast Bit', cost: { crystal: 500 }, desc: 'Dynamite pays ×3, abilities recharge 25% slower', fx: { dyn: 3, cd: 1.25 } },
    { id: 'furnace', name: 'Furnace Bit', cost: { obsidian: 300 }, desc: 'Ore costs half as much, diggers −15%', fx: { orePrice: 0.5, dig: 0.85 } },
    { id: 'abyss', name: 'Abyss Bit', cost: { obsidian: 600, gold: 60 }, desc: 'Diggers ×2, but clicking does nothing', fx: { dig: 2, noClick: true } },
    { id: 'star', name: 'Star Bit', cost: { starstone: 250 }, desc: 'Diggers and clicks +75%', fx: { dig: 1.75, click: 1.75 } },
  ];

  // Relics are permanent. Expeditions find set relics (from sets whose layer you've ever reached);
  // challenge dives award the challenge relics.
  const SETS = [
    { id: 'miner', name: "Miner's Kit", layer: 0, desc: 'Set: diggers +25%', fx: { dig: 1.25 } },
    { id: 'crystal', name: 'Crystal Hoard', layer: 2, desc: 'Set: ore 25% cheaper', fx: { orePrice: 0.75 } },
    { id: 'magma', name: 'Magma Regalia', layer: 3, desc: 'Set: abilities recharge 20% faster', fx: { cd: 0.8 } },
    { id: 'star', name: 'Star Chart', layer: 5, desc: 'Set: +1 core shard every dive', fx: { shardDive: 1 } },
    { id: 'trial', name: 'Trial Trophies', layer: 99, desc: 'Won from challenge dives', fx: {} },
  ];
  const RELICS = [
    { id: 'lantern', set: 'miner', name: 'Old Lantern', desc: 'Diggers +10%', fx: { dig: 1.1 } },
    { id: 'gloves', set: 'miner', name: 'Worn Gloves', desc: 'Clicks +25%', fx: { click: 1.25 } },
    { id: 'compass', set: 'miner', name: 'Brass Compass', desc: 'Veins 20% more often', fx: { veinFreq: 1.2 } },
    { id: 'whistle', set: 'miner', name: 'Canary Whistle', desc: 'Away earnings +20%', fx: { offline: 0.2 } },
    { id: 'prism', set: 'crystal', name: 'Prism Shard', desc: 'Ore 15% cheaper', fx: { orePrice: 0.85 } },
    { id: 'geode', set: 'crystal', name: 'Geode Heart', desc: 'Diggers +15%', fx: { dig: 1.15 } },
    { id: 'echo', set: 'crystal', name: 'Echo Stone', desc: 'Dynamite pays +50%', fx: { dyn: 1.5 } },
    { id: 'rose', set: 'crystal', name: 'Glass Rose', desc: 'Lucky nuggets pay +50%', fx: { nuggetPay: 1.5 } },
    { id: 'idol', set: 'magma', name: 'Ember Idol', desc: 'Gem rushes +5s', fx: { rushTime: 5 } },
    { id: 'mirror', set: 'magma', name: 'Obsidian Mirror', desc: 'Veins pay +50%', fx: { veinPay: 1.5 } },
    { id: 'crown', set: 'magma', name: 'Cinder Crown', desc: 'Diggers +20%', fx: { dig: 1.2 } },
    { id: 'pearl', set: 'magma', name: 'Lava Pearl', desc: 'Abilities recharge 10% faster', fx: { cd: 0.9 } },
    { id: 'comet', set: 'star', name: 'Comet Tail', desc: 'Expeditions 20% shorter', fx: { tripTime: 0.8 } },
    { id: 'moon', set: 'star', name: 'Moon Chip', desc: 'Diggers +25%', fx: { dig: 1.25 } },
    { id: 'void', set: 'star', name: 'Void Pearl', desc: 'Relics 25% likelier on expeditions', fx: { relicChance: 1.25 } },
    { id: 'map', set: 'star', name: 'Star Map', desc: 'Start every run in Granite', fx: { startLayer: 1 } },
    { id: 'patience', set: 'trial', name: 'Patience Stone', desc: 'Diggers +30%', fx: { dig: 1.3 } },
    { id: 'coin', set: 'trial', name: "Haggler's Coin", desc: 'Diggers cost 10% less', fx: { cost: 0.9 } },
    { id: 'nighteye', set: 'trial', name: 'Night Eye', desc: 'Nuggets and veins 30% more often', fx: { nuggetFreq: 1.3, veinFreq: 1.3 } },
    { id: 'notes', set: 'trial', name: 'Field Notes', desc: 'Research costs 25% less', fx: { research: 0.75 } },
  ];

  // Challenge dives: the next run plays by a harsh rule until you reach the goal layer.
  const CHALLENGES = [
    { id: 'handsoff', name: 'Hands Off', rule: 'Clicking the rock does nothing.', goal: 2, relic: 'patience', fx: { noClick: true } },
    { id: 'inflation', name: 'Inflation', rule: 'Digger prices climb 25% per hire.', goal: 2, relic: 'coin', fx: { growth: 1.25 } },
    { id: 'nolab', name: 'Empty Lab', rule: 'No research this run.', goal: 2, relic: 'notes', fx: { noLab: true } },
    { id: 'dark', name: 'Dark Shaft', rule: 'No nuggets or veins.', goal: 3, relic: 'nighteye', fx: { nuggetFreq: 0, veinFreq: 0 } },
  ];

  // Expeditions: send half of one digger type away. They dig nothing until they're back, and return
  // with gems, ore from the deepest layer you've reached this run, and maybe a relic.
  const TRIPS = [
    { id: 'scout', name: 'Scout', secs: 600, pay: 0.8, relic: 0.05 },
    { id: 'haul', name: 'Haul', secs: 3600, pay: 1, relic: 0.18 },
    { id: 'delve', name: 'Deep Delve', secs: 4 * 3600, pay: 1.2, relic: 0.5 },
  ];

  // The core tree. Every shard you've ever found is a point; nodes need the one above them.
  // Respec is free.
  const CORE = [
    { id: 'a1', branch: 0, cost: 1, name: 'Firm Grip', desc: 'Clicks add +1% of gems/s', fx: { clickPct: 0.01 } },
    { id: 'a2', branch: 0, cost: 2, name: 'Blaster Badge', desc: 'Dynamite pays +50%', fx: { dyn: 1.5 } },
    { id: 'a3', branch: 0, cost: 3, name: 'Chain Strike', desc: 'Veins need 5 hits, pay ×2', fx: { veinHits: 5, veinPay: 2 } },
    { id: 'a4', branch: 0, cost: 5, name: 'Quick Fuse', desc: 'Abilities recharge 30% faster', fx: { cd: 0.7 } },
    { id: 'a5', branch: 0, cost: 8, name: 'Master Miner', desc: 'Clicks ×2 and +2% of gems/s', fx: { click: 2, clickPct: 0.02 } },
    { id: 'i1', branch: 1, cost: 1, name: 'Steady Shifts', desc: 'Diggers +25%', fx: { dig: 1.25 } },
    { id: 'i2', branch: 1, cost: 2, name: 'Night Shift', desc: 'Away earnings at full speed', fx: { offline: 0.5 } },
    { id: 'i3', branch: 1, cost: 3, name: "Foremen's Guild", desc: 'Digger teamwork bonus ×2', fx: { synergy: 2 } },
    { id: 'i4', branch: 1, cost: 5, name: 'Cheap Labor', desc: 'Digger prices climb 13%, not 15%', fx: { growth: 1.13 } },
    { id: 'i5', branch: 1, cost: 8, name: 'Deep Roots', desc: 'Diggers ×2, expeditions 25% shorter', fx: { dig: 2, tripTime: 0.75 } },
    { id: 'l1', branch: 2, cost: 1, name: 'Prospector', desc: 'Nuggets 50% more often', fx: { nuggetFreq: 1.5 } },
    { id: 'l2', branch: 2, cost: 2, name: 'Rich Veins', desc: 'Veins drop twice the ore', fx: { veinOre: 2 } },
    { id: 'l3', branch: 2, cost: 3, name: 'Treasure Nose', desc: 'Relics 50% likelier on trips', fx: { relicChance: 1.5 } },
    { id: 'l4', branch: 2, cost: 5, name: 'Tool Belt', desc: 'A second drill bit slot', fx: { bitSlots: 1 } },
    { id: 'l5', branch: 2, cost: 8, name: 'Golden Age', desc: 'Gem rushes are ×10 and +10s', fx: { rushMult: 10, rushTime: 10 } },
  ];
  const BRANCHES = ['Active', 'Idle', 'Luck'];

  return { ORES, LAYERS, DIGGERS, RESEARCH, ABILITIES, BITS, SETS, RELICS, CHALLENGES, TRIPS, CORE, BRANCHES };
})();
if (typeof module !== 'undefined') module.exports = window.GEM;
