/* Last Lantern: weapons, passives, enemies, stages, characters and permanent upgrades. Data only. */
const LL = (() => {
  // Weapons level 1..8. base is level 1; ups[i] is applied going to level i+2. Number = add, "x" prefix = multiply.
  // dmg: damage, cd: seconds between uses, count: shots/blades/strikes, area: size multiplier, spd: projectile speed,
  // pierce: enemies a shot passes through, dur: seconds an effect lasts.
  const WEAPONS = {
    bolt: { name: 'Ember Bolt', icon: '🔥', color: '#ff9a3d', pair: 'might', evo: 'Inferno Lance',
      desc: 'Fires at the nearest enemy.',
      base: { dmg: 10, cd: 1.0, count: 1, spd: 470, pierce: 1, area: 1 },
      ups: [{ t: '+1 bolt', count: 1 }, { t: '+5 damage', dmg: 5 }, { t: '+1 bolt', count: 1 }, { t: 'Passes through 2 more', pierce: 2 }, { t: '+5 damage', dmg: 5 }, { t: '+1 bolt', count: 1 }, { t: '+10 damage, faster', dmg: 10, xcd: 0.8 }],
      evoFx: { dmg: 14, count: 3, pierce: 99, xcd: 0.7, spd: 200 } },
    blades: { name: 'Spirit Blades', icon: '🗡️', color: '#9ff0ff', pair: 'reach', evo: 'Halo of Knives',
      desc: 'Blades circle you and cut anything they touch.',
      base: { dmg: 7, cd: 0, count: 2, spd: 2.6, area: 1, rad: 74 },
      ups: [{ t: '+1 blade', count: 1 }, { t: 'Spin faster', spd: 0.5 }, { t: '+1 blade', count: 1 }, { t: '+4 damage', dmg: 4 }, { t: '+1 blade', count: 1 }, { t: 'Wider orbit', rad: 22 }, { t: '+1 blade, +4 damage', count: 1, dmg: 4 }],
      evoFx: { dmg: 8, count: 4, spd: 1.2, rad: 40, area: 0.5 } },
    nova: { name: 'Frost Nova', icon: '❄️', color: '#aee6ff', pair: 'haste', evo: 'Absolute Winter',
      desc: 'A freezing ring that slows what it hits.',
      base: { dmg: 12, cd: 3.2, count: 1, area: 1, rad: 130 },
      ups: [{ t: 'Bigger ring', rad: 25 }, { t: '+8 damage', dmg: 8 }, { t: 'Faster', xcd: 0.85 }, { t: 'Bigger ring', rad: 30 }, { t: '+10 damage', dmg: 10 }, { t: 'Faster', xcd: 0.85 }, { t: 'Two rings', count: 1, dmg: 6 }],
      evoFx: { dmg: 20, rad: 120, xcd: 0.6, count: 1 } },
    whip: { name: 'Thorn Whip', icon: '🌿', color: '#7be36a', pair: 'mend', evo: 'Briar Reaper',
      desc: 'Lashes out in front, then behind.',
      base: { dmg: 14, cd: 1.5, count: 1, area: 1, len: 130 },
      ups: [{ t: 'Both sides at once', count: 1 }, { t: '+6 damage', dmg: 6 }, { t: 'Longer', len: 30 }, { t: '+6 damage', dmg: 6 }, { t: 'Faster', xcd: 0.8 }, { t: 'Longer', len: 40 }, { t: '+10 damage', dmg: 10 }],
      evoFx: { dmg: 20, len: 90, xcd: 0.6, count: 1, heal: 1 } },
    chain: { name: 'Storm Chain', icon: '⚡', color: '#b9c9ff', pair: 'magnet', evo: 'Tempest',
      desc: 'Lightning that jumps from foe to foe.',
      base: { dmg: 9, cd: 1.7, count: 3, area: 1, range: 170 },
      ups: [{ t: '+1 jump', count: 1 }, { t: '+5 damage', dmg: 5 }, { t: '+2 jumps', count: 2 }, { t: 'Faster', xcd: 0.85 }, { t: '+5 damage', dmg: 5 }, { t: '+2 jumps', count: 2 }, { t: '+8 damage', dmg: 8 }],
      evoFx: { dmg: 12, count: 8, xcd: 0.55, range: 80, strikes: 3 } },
    flame: { name: 'Holy Fire', icon: '✨', color: '#ffd23f', pair: 'greed', evo: 'Sunfall',
      desc: 'Pools of fire burn where enemies gather.',
      base: { dmg: 5, cd: 3.0, count: 1, area: 1, rad: 52, dur: 3 },
      ups: [{ t: 'Bigger pools', rad: 14 }, { t: '+1 pool', count: 1 }, { t: '+3 damage', dmg: 3 }, { t: 'Lasts longer', dur: 1.5 }, { t: '+1 pool', count: 1 }, { t: '+4 damage', dmg: 4 }, { t: 'Bigger pools', rad: 20, count: 1 }],
      evoFx: { dmg: 8, count: 3, rad: 30, dur: 3, xcd: 0.7 } },
    axe: { name: 'Tumble Axe', icon: '🪓', color: '#ff7a8a', pair: 'swift', evo: 'Death Spiral',
      desc: 'Heavy axes lobbed upward that cut through everything.',
      base: { dmg: 16, cd: 1.6, count: 1, area: 1, pierce: 99 },
      ups: [{ t: '+1 axe', count: 1 }, { t: '+8 damage', dmg: 8 }, { t: 'Faster', xcd: 0.85 }, { t: '+1 axe', count: 1 }, { t: '+8 damage', dmg: 8 }, { t: 'Bigger', area: 0.25 }, { t: '+1 axe', count: 1 }],
      evoFx: { dmg: 14, count: 3, area: 0.5, xcd: 0.65 } },
    meteor: { name: 'Meteor Rain', icon: '☄️', color: '#ff5d3a', pair: 'vital', evo: 'Starfall',
      desc: 'Calls stones from the sky onto your enemies.',
      base: { dmg: 22, cd: 2.4, count: 1, area: 1, rad: 62 },
      ups: [{ t: '+1 meteor', count: 1 }, { t: '+10 damage', dmg: 10 }, { t: 'Bigger blast', rad: 16 }, { t: '+1 meteor', count: 1 }, { t: 'Faster', xcd: 0.8 }, { t: '+12 damage', dmg: 12 }, { t: '+2 meteors', count: 2 }],
      evoFx: { dmg: 30, count: 4, rad: 34, xcd: 0.6 } },
  };
  const WEAPON_IDS = Object.keys(WEAPONS);

  const PASSIVES = {
    might: { name: 'Might', icon: '💪', desc: '+12% damage per level.', max: 5 },
    haste: { name: 'Haste', icon: '⏱️', desc: '8% faster attacks per level.', max: 5 },
    reach: { name: 'Reach', icon: '🔍', desc: '+10% area and range per level.', max: 5 },
    swift: { name: 'Swiftness', icon: '👟', desc: '+8% move speed per level.', max: 5 },
    vital: { name: 'Vitality', icon: '❤️', desc: '+20 max health per level.', max: 5 },
    mend: { name: 'Mending', icon: '🩹', desc: 'Regain 0.4 health per second per level.', max: 5 },
    magnet: { name: 'Magnetism', icon: '🧲', desc: '+25% pickup range per level.', max: 5 },
    greed: { name: 'Greed', icon: '💰', desc: '+10% gold and experience per level.', max: 5 },
  };
  const PASSIVE_IDS = Object.keys(PASSIVES);

  // Enemies. speed in px/s. xp: gem value. Palette picks the stage colour.
  const ENEMIES = {
    bat:    { name: 'Bat', hp: 6, spd: 105, dmg: 5, r: 9, xp: 1, shape: 'bat' },
    ghoul:  { name: 'Ghoul', hp: 20, spd: 52, dmg: 8, r: 12, xp: 1, shape: 'blob' },
    imp:    { name: 'Imp', hp: 13, spd: 86, dmg: 7, r: 10, xp: 1, shape: 'tri' },
    skel:   { name: 'Skeleton', hp: 34, spd: 62, dmg: 10, r: 12, xp: 2, shape: 'skull' },
    wraith: { name: 'Wraith', hp: 48, spd: 76, dmg: 12, r: 13, xp: 3, shape: 'wisp', ghost: true },
    brute:  { name: 'Brute', hp: 150, spd: 48, dmg: 16, r: 19, xp: 6, shape: 'blob', big: true },
    golem:  { name: 'Golem', hp: 420, spd: 38, dmg: 24, r: 26, xp: 14, shape: 'block', big: true },
    elite:  { name: 'Elite', hp: 700, spd: 60, dmg: 22, r: 24, xp: 30, shape: 'skull', elite: true },
    boss:   { name: 'Boss', hp: 6000, spd: 44, dmg: 30, r: 44, xp: 100, shape: 'boss', boss: true },
  };
  // What spawns when. Each entry: from minute, list of [type, weight].
  const WAVES = [
    [0, [['bat', 3], ['ghoul', 2]]],
    [2, [['bat', 2], ['ghoul', 2], ['imp', 2]]],
    [4, [['ghoul', 2], ['imp', 2], ['skel', 2]]],
    [6, [['imp', 2], ['skel', 3], ['wraith', 2], ['brute', 0.6]]],
    [9, [['skel', 2], ['wraith', 3], ['brute', 1], ['imp', 2]]],
    [12, [['wraith', 3], ['brute', 1.6], ['golem', 0.7], ['skel', 2]]],
  ];

  const STAGES = [
    { id: 'hollow', name: 'Mossy Hollow', blurb: 'Where it all starts. Mild and mossy.', mult: 1, gold: 1, c1: '#1c2b1f', c2: '#233a28', dot: '#2f4d33', accent: '#7be36a', tints: ['#6a8f5a', '#9ad06a'], boss: 'Elder Treant', need: null },
    { id: 'crypt', name: 'Cinder Crypt', blurb: 'Hotter, faster, hungrier.', mult: 1.35, gold: 1.4, c1: '#2a1612', c2: '#3a1c15', dot: '#5a2a1c', accent: '#ff7a45', tints: ['#b0503a', '#ff9a5a'], boss: 'Ashen Warden', need: 'hollow' },
    { id: 'mere', name: 'Frozen Mere', blurb: 'Slippery light, deep cold.', mult: 1.8, gold: 1.9, c1: '#13222e', c2: '#1b3345', dot: '#2c5470', accent: '#8fd8ff', tints: ['#5a8fb5', '#aee6ff'], boss: 'Winter Maw', need: 'crypt' },
    { id: 'throne', name: 'Hollow Throne', blurb: 'The end of the road. Bring everything.', mult: 2.4, gold: 2.6, c1: '#1c142b', c2: '#2a1b40', dot: '#43306a', accent: '#c79bff', tints: ['#7a5ab5', '#c79bff'], boss: 'The Hollow King', need: 'mere' },
  ];

  const CHARS = [
    { id: 'wren', name: 'Wren', cost: 0, color: '#ffd23f', start: 'bolt', perk: 'Lantern keeper. +10% experience.', fx: { xp: 0.1 } },
    { id: 'brannoc', name: 'Brannoc', cost: 400, color: '#7be36a', start: 'whip', perk: 'Woodsman. +25 max health.', fx: { hp: 25 } },
    { id: 'sable', name: 'Sable', cost: 800, color: '#9ff0ff', start: 'blades', perk: 'Duelist. +10% move speed.', fx: { move: 0.1 } },
    { id: 'iseult', name: 'Iseult', cost: 1400, color: '#aee6ff', start: 'nova', perk: 'Frost mage. Attacks 10% faster.', fx: { cd: 0.1 } },
    { id: 'korr', name: 'Korr', cost: 2200, color: '#ff7a8a', start: 'axe', perk: 'Berserker. +15% damage.', fx: { might: 0.15 } },
    { id: 'maeve', name: 'Maeve', cost: 3400, color: '#ff5d3a', start: 'meteor', perk: 'Star witch. +10% area, one revival.', fx: { area: 0.1, revive: 1 } },
  ];

  // Permanent upgrades bought with gold between runs.
  const META = [
    { id: 'might', name: 'Power', desc: '+5% damage per rank', max: 5, base: 200 },
    { id: 'armor', name: 'Armor', desc: 'Take 1 less damage per rank', max: 3, base: 600 },
    { id: 'hp', name: 'Vigor', desc: '+10% max health per rank', max: 5, base: 200 },
    { id: 'regen', name: 'Recovery', desc: '+0.2 health/s per rank', max: 5, base: 300 },
    { id: 'cd', name: 'Cooldown', desc: '3% faster attacks per rank', max: 5, base: 300 },
    { id: 'move', name: 'Stride', desc: '+5% move speed per rank', max: 5, base: 200 },
    { id: 'magnet', name: 'Attraction', desc: '+20% pickup range per rank', max: 3, base: 250 },
    { id: 'growth', name: 'Growth', desc: '+4% experience per rank', max: 5, base: 300 },
    { id: 'greed', name: 'Fortune', desc: '+8% gold per rank', max: 5, base: 250 },
    { id: 'revive', name: 'Second Wind', desc: 'Revive once at half health', max: 1, base: 4000 },
  ];
  const metaCost = (m, rank) => m.base * (rank + 1);

  function weaponStats(id, lvl, evolved) {
    const def = WEAPONS[id];
    const s = { ...def.base };
    const apply = fx => { for (const k in fx) { if (k === 't') continue; if (k[0] === 'x') s[k.slice(1)] *= fx[k]; else if (k === 'heal') s.heal = 1; else s[k] = (s[k] || 0) + fx[k]; } };
    for (let i = 0; i < lvl - 1; i++) apply(def.ups[i]);
    if (evolved) apply(def.evoFx);
    return s;
  }
  function pickWave(minute) {
    let w = WAVES[0][1];
    for (const [m, list] of WAVES) if (minute >= m) w = list;
    return w;
  }
  return { WEAPONS, WEAPON_IDS, PASSIVES, PASSIVE_IDS, ENEMIES, WAVES, STAGES, CHARS, META, metaCost, weaponStats, pickWave };
})();
