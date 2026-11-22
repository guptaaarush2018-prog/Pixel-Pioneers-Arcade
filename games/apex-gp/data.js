/* Apex GP content: circuits (as road pieces), scenery themes, teams and the points table.
   A circuit is a list of pieces: [length in segments, curve, hill height]. Positive curve bends
   right; hill is the height change across the piece. The builder in game.js eases between them. */
const ApexData = (() => {
  const THEMES = {
    coast: {
      sky: ['#5fb4ff', '#bfe4ff'], fog: '#cfe9ff', grass: ['#5db04a', '#55a444'], road: ['#6b6f78', '#676b74'], rumble: ['#e03a3a', '#f4f4f4'], lane: '#f4f4f4',
      far: '#7fa8c9', mid: '#5e9a5a', sea: '#2e86d6', sprites: ['palm', 'palm', 'billboard', 'flag'], sun: '#fff6c8', night: false,
    },
    desert: {
      sky: ['#f7a35c', '#ffe0a8'], fog: '#ffd9a0', grass: ['#d9b26a', '#cfa75e'], road: ['#77706a', '#726b65'], rumble: ['#e03a3a', '#f4f4f4'], lane: '#f4f4f4',
      far: '#c98a5a', mid: '#b5733f', sprites: ['cactus', 'rock', 'billboard', 'cactus'], sun: '#ffeaa0', night: false,
    },
    city: {
      sky: ['#0b1030', '#3a2a6a'], fog: '#2a2050', grass: ['#2b2f3a', '#272b35'], road: ['#3a3d46', '#363941'], rumble: ['#e03a3a', '#f4f4f4'], lane: '#ffd86b',
      far: '#1a1c3a', mid: '#262a50', sprites: ['lamp', 'lamp', 'billboard', 'tower'], sun: null, night: true,
    },
    forest: {
      sky: ['#7fb8e8', '#d8ecf5'], fog: '#c8dfe6', grass: ['#3f8a3a', '#3a8035'], road: ['#686c74', '#646870'], rumble: ['#e03a3a', '#f4f4f4'], lane: '#f4f4f4',
      far: '#7f9fb5', mid: '#2f6a3a', sprites: ['pine', 'pine', 'oak', 'billboard'], sun: '#ffffff', night: false,
    },
    alpine: {
      sky: ['#9cc8ff', '#eaf4ff'], fog: '#e8f0f8', grass: ['#e9eef3', '#dfe6ed'], road: ['#5d6169', '#595d65'], rumble: ['#2f6fd6', '#f4f4f4'], lane: '#f4f4f4',
      far: '#b8c8de', mid: '#8fa4bd', sprites: ['snowpine', 'snowpine', 'flag', 'billboard'], sun: '#ffffff', night: false,
    },
    sunset: {
      sky: ['#ff6a5a', '#ffc27a'], fog: '#ffb07a', grass: ['#6a9a3a', '#638f35'], road: ['#6a5f66', '#665b62'], rumble: ['#ffc53d', '#3a2a2a'], lane: '#fff0d8',
      far: '#a05a7a', mid: '#6a3a5a', sprites: ['palm', 'oak', 'billboard', 'flag'], sun: '#ffe8a0', night: false,
    },
    dusk: {
      sky: ['#2a1a4a', '#d06a7a'], fog: '#6a4a7a', grass: ['#3a5a3a', '#355335'], road: ['#4a4a54', '#46464f'], rumble: ['#e03a3a', '#f4f4f4'], lane: '#f4f4f4',
      far: '#3a2a5a', mid: '#2a2a44', sprites: ['lamp', 'pine', 'billboard', 'tower'], sun: '#ffb07a', night: true,
    },
    canyon: {
      sky: ['#4aa0e8', '#a8d8ff'], fog: '#e8c8a0', grass: ['#b8643a', '#ad5d36'], road: ['#6a625c', '#665e58'], rumble: ['#e03a3a', '#f4f4f4'], lane: '#f4f4f4',
      far: '#c0703f', mid: '#9a4a2a', sprites: ['rock', 'cactus', 'rock', 'billboard'], sun: '#fff6c8', night: false,
    },
  };

  // [segments, curve, hill]. Curves around ±2 are gentle, ±6 is a hairpin.
  const CIRCUITS = [
    { id: 'harbor', name: 'Harbor Point', country: 'Seaside', theme: 'coast', laps: 3, pieces: [
      [120, 0, 0], [60, 3, 0], [80, 0, 20], [70, -4, 0], [100, 0, -20], [60, 5.5, 0], [140, 0, 0], [50, -2, 30], [50, 2, -30], [80, 0, 0], [70, -5, 0], [60, 0, 0], [90, 3.5, 0], [110, 0, 0],
    ] },
    { id: 'dunes', name: 'Sandstorm Ring', country: 'Desert', theme: 'desert', laps: 3, pieces: [
      [160, 0, 0], [90, 2, 40], [90, 2, -40], [60, 0, 0], [50, -6, 0], [140, 0, 0], [70, 4, 0], [70, -4, 0], [120, 0, 60], [120, 0, -60], [60, 5, 0], [100, 0, 0],
    ] },
    { id: 'neon', name: 'Neon Streets', country: 'Night City', theme: 'city', laps: 3, pieces: [
      [100, 0, 0], [40, 6, 0], [80, 0, 0], [40, -6, 0], [90, 0, 0], [40, 6, 0], [60, 0, 10], [60, 0, -10], [40, 6, 0], [110, 0, 0], [50, -3, 0], [50, 3, 0], [40, 6, 0], [80, 0, 0],
    ] },
    { id: 'pines', name: 'Pine Valley', country: 'Forest', theme: 'forest', laps: 3, pieces: [
      [110, 0, 0], [80, -2.5, 30], [80, 2.5, 20], [60, 0, -50], [70, 4.5, 0], [60, -4.5, 0], [100, 0, 40], [80, 3, -40], [90, 0, 0], [70, -5, 0], [60, 2, 0], [120, 0, 0],
    ] },
    { id: 'summit', name: 'Summit Pass', country: 'Alpine', theme: 'alpine', laps: 3, pieces: [
      [100, 0, 0], [70, 3, 60], [60, -4, 40], [60, 5, 30], [80, 0, -40], [50, -6, -20], [70, 0, -50], [90, 2, 0], [60, -3, 20], [70, 4, -20], [110, 0, 0], [60, -4, 0], [80, 0, 0],
    ] },
    { id: 'boulevard', name: 'Sunset Boulevard', country: 'Riviera', theme: 'sunset', laps: 3, pieces: [
      [140, 0, 0], [60, 4, 0], [60, -4, 0], [60, 4, 0], [100, 0, 20], [50, 6, -20], [120, 0, 0], [80, -3, 0], [80, 0, 30], [80, 0, -30], [50, -6, 0], [90, 0, 0],
    ] },
    { id: 'twilight', name: 'Twilight Loop', country: 'Lakeside', theme: 'dusk', laps: 3, pieces: [
      [120, 0, 0], [70, -3.5, 0], [70, 3.5, 20], [90, 0, -20], [60, 5, 0], [60, 0, 0], [60, 5, 0], [100, 0, 30], [70, -4, -30], [80, 2, 0], [60, -5.5, 0], [100, 0, 0],
    ] },
    { id: 'canyon', name: 'Red Canyon', country: 'Mesa', theme: 'canyon', laps: 3, pieces: [
      [130, 0, 0], [60, 3, 50], [60, -3, 30], [50, 6, 0], [80, 0, -60], [60, -4, -20], [60, 4, 0], [110, 0, 40], [60, -5, 0], [70, 0, -40], [60, 3, 0], [90, -2, 0], [80, 0, 0],
    ] },
    { id: 'coral', name: 'Coral Bay', country: 'Island', theme: 'coast', laps: 3, pieces: [
      [150, 0, 0], [50, 5, 0], [50, -5, 10], [90, 0, -10], [70, 3, 0], [70, 3, 20], [100, 0, -20], [40, -6, 0], [80, 0, 0], [60, 4.5, 30], [60, -2, -30], [120, 0, 0],
    ] },
    { id: 'frostline', name: 'Frostline', country: 'Glacier', theme: 'alpine', laps: 3, pieces: [
      [110, 0, 0], [60, -3, 40], [60, -3, 40], [70, 5, -30], [50, -5.5, 0], [90, 0, -50], [70, 4, 20], [60, 4, -20], [110, 0, 30], [60, -4.5, -30], [80, 2.5, 0], [90, 0, 0],
    ] },
    { id: 'metro', name: 'Metro Grand Prix', country: 'Capital', theme: 'city', laps: 3, pieces: [
      [120, 0, 0], [35, 6, 0], [70, 0, 0], [35, 6, 0], [50, -3, 0], [50, 3, 0], [100, 0, 0], [35, -6, 0], [35, 6, 0], [120, 0, 10], [40, 6, -10], [60, 0, 0], [40, 6, 0], [90, 0, 0],
    ] },
    { id: 'oasis', name: 'Oasis Run', country: 'Dunes', theme: 'desert', laps: 3, pieces: [
      [180, 0, 0], [80, 2.5, 30], [80, -2.5, -30], [50, 5.5, 0], [160, 0, 0], [60, -4, 0], [60, 4, 0], [70, 5, 40], [100, 0, -40], [50, -5, 0], [70, 3, 0], [110, 0, 0],
    ] },
  ];

  // Your car. Stats multiply the base handling; tyre life divides wear.
  const CARS = [
    { id: 'pioneer', name: 'Pioneer P1', color: '#ffc53d', dark: '#1c1500', style: 0, top: 1, accel: 1, grip: 1, wear: 1, boost: 1, blurb: 'The balanced all-rounder.' },
    { id: 'arrow', name: 'Arrow RS', color: '#e8eef7', dark: '#e03a3a', style: 2, top: 1.045, accel: 0.92, grip: 0.9, wear: 1.05, boost: 1, blurb: 'Low drag: fastest on the straights, nervous in the corners.', unlock: { stat: 'races', n: 2, text: 'Finish 2 races' } },
    { id: 'claw', name: 'Claw GT', color: '#3ddc84', dark: '#0d2a1a', style: 1, top: 0.975, accel: 1, grip: 1.2, wear: 1.1, boost: 0.9, blurb: 'Huge downforce carries speed through the corners.', unlock: { stat: 'podiums', n: 2, text: 'Finish on the podium twice' } },
    { id: 'surge', name: 'Surge E', color: '#4fd1ff', dark: '#0b1a33', style: 2, top: 0.99, accel: 1.22, grip: 1, wear: 1, boost: 1.4, blurb: 'Electric torque and a big boost battery.', unlock: { stat: 'wins', n: 1, text: 'Win a race' } },
    { id: 'marathon', name: 'Marathon LM', color: '#ff8a3d', dark: '#2a1608', style: 1, top: 0.985, accel: 0.98, grip: 1.05, wear: 0.55, boost: 1, blurb: 'Tyres that last forever. Built for endurance.', unlock: { stat: 'wins', n: 3, text: 'Win 3 races' } },
    { id: 'phantom', name: 'Phantom X', color: '#24262d', dark: '#a46bff', style: 3, top: 1.05, accel: 1.1, grip: 1.1, wear: 0.9, boost: 1.2, blurb: 'The fastest thing in the paddock.', unlock: { stat: 'titles', n: 1, text: 'Win a season' } },
  ];

  const MODES = [
    { id: 'race', name: 'Quick race', desc: 'One Grand Prix against eleven rivals on the circuit of your choice.' },
    { id: 'season', name: 'Season', desc: 'A full 12-round world championship. Every race weekend has qualifying (two flying laps to set your grid slot) and then the Grand Prix. Points for the top ten, plus one for the fastest lap.' },
    { id: 'trial', name: 'Time trial', desc: 'Five laps alone on track. Chase your best lap on every circuit.' },
    { id: 'elim', name: 'Elimination', desc: 'Every time the leader starts a new lap, the last two cars are out. Survive to the flag.' },
    { id: 'sprint', name: 'Reverse sprint', desc: 'Two laps with the grid reversed: the slowest cars start up front and you start dead last.' },
    { id: 'endurance', name: 'Endurance', desc: 'Eight laps, tyres wear twice as fast, and a pit stop is mandatory: skip it for a 10-second penalty.' },
  ];

  const TEAMS = [
    { name: 'Pioneer Racing', color: '#ffc53d', dark: '#1c1500', you: true },
    { name: 'Falcon', color: '#e03a3a', dark: '#f4f4f4' },
    { name: 'Vortex', color: '#2f6fd6', dark: '#ffd86b' },
    { name: 'Comet', color: '#2ec4b6', dark: '#0d3b37' },
    { name: 'Ember', color: '#ff8a3d', dark: '#2a1608' },
    { name: 'Nova', color: '#a46bff', dark: '#ffffff' },
    { name: 'Atlas', color: '#3ddc84', dark: '#0d2a1a' },
    { name: 'Zephyr', color: '#f4f4f4', dark: '#e03a3a' },
    { name: 'Titan', color: '#3a3f4a', dark: '#ffc53d' },
    { name: 'Orbit', color: '#ff6fb5', dark: '#2a0a1a' },
    { name: 'Raptor', color: '#8a5a34', dark: '#ffd86b' },
    { name: 'Glacier', color: '#9fe3ff', dark: '#10244a' },
  ];
  const DRIVERS = ['K. Arden', 'M. Sato', 'L. Moreau', 'J. Okafor', 'R. Lindqvist', 'T. Varga', 'S. Rossi', 'A. Kowal', 'D. Mendes', 'H. Park', 'E. Novak', 'P. Haddad', 'C. Brandt', 'N. Ivers'];
  const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0];
  // ai: 0 makes mistakes; 1 plans braking and drafts; 2 also boosts on straights; 3+ defends;
  // 4+ brakes later and attacks the car ahead; 5 never errs.
  // catchup: extra pace (up to this much) when a bot is far behind you, so you can't build a
  // big gap and cruise. Not used in qualifying or time trials.
  const LEVELS = [
    { name: 'Rookie', pace: 0.86, grid: 5, mult: 1, ai: 0, catchup: 0.03 },
    { name: 'Pro', pace: 0.94, grid: 11, mult: 1.6, ai: 1, catchup: 0.05 },
    { name: 'Legend', pace: 1.0, grid: 11, mult: 2.3, ai: 2, catchup: 0.07 },
    { name: 'Elite', pace: 1.04, grid: 11, mult: 3, ai: 3, catchup: 0.09 },
    { name: 'Alien', pace: 1.07, grid: 11, mult: 4, ai: 4, catchup: 0.11 },
    { name: 'Mythic', pace: 1.1, grid: 11, mult: 5, ai: 5, catchup: 0.14 },
  ];
  // Invented sponsors for the trackside boards.
  const SPONSORS = [['PIXEL', '#ffc53d', '#1c1500'], ['TURBO COLA', '#e03a3a', '#ffffff'], ['GEM MINE', '#a46bff', '#ffffff'], ['APEX', '#1b1e24', '#ffc53d'], ['TACO TRUCK', '#3ddc84', '#0d2a1a'], ['NOVA FUEL', '#2f6fd6', '#ffffff'], ['ROCKET OIL', '#ff8a3d', '#1b1e24']];

  return { THEMES, CIRCUITS, TEAMS, DRIVERS, POINTS, LEVELS, SPONSORS, CARS, MODES };
})();
