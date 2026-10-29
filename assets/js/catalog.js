// Every game in the arcade. Add a new game here; its folder lives at games/<id>/ with an
// index.html (body data-game="<id>") and a 16:10 thumb.svg.
//   goals:  scores for the Bronze / Silver / Gold achievements
//   online: 'multiplayer' or 'ghost' adds a badge on the hub when Firebase is set up; 'live'
//           does the same when the real-time relay is (all games get leaderboards)
//   extras: game-specific achievements, unlocked with Arcade.flag(id)
window.CATALOG = [
  {
    id: 'pocket-racer',
    title: 'Pocket Racer',
    genre: 'Racing',
    desc: 'Three quick laps against three rivals on six tracks, or build your own. Beat the fastest racer in the world, whose ghost runs with you.',
    goals: [1200, 1800, 2300],
    online: 'ghost',
    extras: [{ id: 'pocket-racer-win', title: 'Pocket Racer: Podium Top', desc: 'Finish a race in 1st place.' }],
  },
  {
    id: 'rune-rumble',
    title: 'Rune Rumble',
    genre: 'Strategy',
    desc: 'Real-time lane battles. Spend mana on rune cards, send troops down three lanes, and topple the enemy keep. Play the bot or anyone online.',
    goals: [600, 1200, 2000],
    online: 'live',
    extras: [
      { id: 'rune-rumble-win', title: 'Rune Rumble: First Crown', desc: 'Beat the bot.' },
      { id: 'rune-rumble-hard', title: 'Rune Rumble: Rune Master', desc: 'Beat the Hard bot.' },
      { id: 'rune-rumble-online-win', title: 'Rune Rumble: Arena Victor', desc: 'Win an online match.' },
    ],
  },
  {
    id: 'realm-rivals',
    title: 'Realm Rivals',
    genre: 'Strategy',
    desc: 'Build farms, mines and barracks, raise an army, and conquer five rival kingdoms before their raids bring down your castle.',
    goals: [2000, 6000, 10000],
    extras: [{ id: 'realm-rivals-win', title: 'Realm Rivals: High King', desc: 'Conquer all five realms.' }],
  },
  {
    id: 'taco-tycoon',
    title: 'Taco Truck Tycoon',
    genre: 'Tycoon',
    desc: 'Pick a spot, set your price, and stock up for the weather. Then work the lunch rush. Fourteen days to build a taco empire.',
    goals: [1500, 3000, 5000],
    extras: [
      { id: 'taco-tycoon-300', title: 'Taco Tycoon: Big Day', desc: 'Make $300 profit in one day.' },
      { id: 'taco-tycoon-mogul', title: 'Taco Tycoon: Taco Mogul', desc: 'Finish the season with $2,000.' },
    ],
  },
  {
    id: 'gem-mine',
    title: 'Gem Mine',
    genre: 'Idle',
    desc: 'Click the rock, hire diggers, and watch the gems pile up, even while you\'re away. Dive deeper to dig even faster.',
    goals: [500, 1000, 1500],
    extras: [
      { id: 'gem-mine-nugget', title: 'Gem Mine: Golden Touch', desc: 'Catch a golden nugget.' },
      { id: 'gem-mine-dive', title: 'Gem Mine: Into the Deep', desc: 'Dive deeper for the first time.' },
      { id: 'gem-mine-forge', title: 'Gem Mine: Star Forged', desc: 'Own a Star Forge.' },
    ],
  },
  {
    id: 'crowd-rush',
    title: 'Crowd Rush',
    genre: 'Arcade',
    desc: 'Pick the right gates to grow your crowd, beat the red crowds, dodge the saws, and climb the stairs for a big multiplier.',
    goals: [500, 2000, 6000],
    extras: [{ id: 'crowd-rush-top', title: 'Crowd Rush: Sky High', desc: 'Reach the ×3.0 step.' }],
  },
  {
    id: 'lane-rush',
    title: 'Lane Rush',
    genre: 'Racing',
    desc: 'Weave through highway traffic at ever-higher speeds. Close calls earn bonus points.',
    goals: [1000, 3000, 6000],
  },
  {
    id: 'box-battle',
    title: 'Box Battle',
    genre: 'Strategy',
    desc: 'Draw lines, close boxes, take another turn. Play the computer, a friend, or anyone online with a room code.',
    goals: [13, 16, 20],
    online: 'multiplayer',
    extras: [
      { id: 'box-battle-win', title: 'Box Battle: Outsmarted', desc: 'Beat the computer.' },
      { id: 'box-battle-online-win', title: 'Box Battle: Champion', desc: 'Win an online match.' },
    ],
  },
  {
    id: 'neon-noodle',
    title: 'Neon Noodle',
    genre: 'Arcade',
    desc: 'Grow your noodle in a wrap-around arena. Chain bites for combos and grab prisms to slip through your own tail.',
    goals: [200, 600, 1500],
  },
  {
    id: 'crystal-swap',
    title: 'Crystal Swap',
    genre: 'Puzzle',
    desc: 'Swap crystals to make rows of three or more. You have 60 seconds, and big matches buy you more time.',
    goals: [2000, 5000, 9000],
  },
  {
    id: 'lantern-maze',
    title: 'Lantern Maze',
    genre: 'Maze',
    desc: 'Collect every spark in a dark maze while shadows close in. Your lantern is running low, so flash it wisely.',
    goals: [1000, 3000, 7000],
  },
  {
    id: 'brick-burst',
    title: 'Brick Burst',
    genre: 'Arcade',
    desc: 'Bounce the ball, break every brick, catch power-ups. Each level is short and a little harder.',
    goals: [1500, 5000, 12000],
  },
  {
    id: 'type-storm',
    title: 'Type Storm',
    genre: 'Typing',
    desc: 'Words rain down from the sky. Type them before they land. Good practice that doesn\'t feel like it.',
    goals: [500, 1500, 3500],
  },
  {
    id: 'cloud-climber',
    title: 'Cloud Climber',
    genre: 'Platformer',
    desc: 'Bounce from platform to platform, all the way to space. Save your battery cells for rocket boosts.',
    goals: [500, 1500, 3000],
  },
  {
    id: 'stack-up',
    title: 'Stack Up',
    genre: 'Arcade',
    desc: 'One button. Drop each sliding block onto the tower; anything hanging over gets sliced off.',
    goals: [15, 30, 50],
  },
  {
    id: 'polarity-run',
    title: 'Polarity Run',
    genre: 'Runner',
    desc: 'Flip gravity between the floor and the ceiling to dodge spikes. The faster it gets, the harder it is.',
    goals: [300, 800, 1500],
  },
];
