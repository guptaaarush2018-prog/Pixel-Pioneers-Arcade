// Every game in the arcade. Add a new game here; its folder lives at games/<id>/ with an
// index.html (body data-game="<id>") and a 16:10 thumb.svg.
//   goals:  scores for the Bronze / Silver / Gold achievements
//   online: 'multiplayer' or 'ghost' adds a badge on the hub (all games get leaderboards)
//   extras: game-specific achievements, unlocked with Arcade.flag(id)
window.CATALOG = [
  {
    id: 'pocket-racer',
    title: 'Pocket Racer',
    genre: 'Racing',
    desc: 'Three quick laps against three rivals. Beat the fastest racer in the world, whose ghost runs with you.',
    goals: [1200, 1800, 2300],
    online: 'ghost',
    extras: [{ id: 'pocket-racer-win', title: 'Pocket Racer: Podium Top', desc: 'Finish a race in 1st place.' }],
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
