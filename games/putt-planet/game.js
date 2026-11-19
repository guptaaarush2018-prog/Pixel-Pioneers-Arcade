(() => {
  const ID = 'putt-planet';
  const W = 960, H = 540;
  const BALL_R = 7, CUP_R = 11, SINK_SPEED = 380;
  const MAX_POWER = 900, MAX_DRAG = 150, MAX_STROKES = 8;
  const ROLL_DECEL = 200, DAMPING = 0.55, SAND = 5, STOP = 8;

  // Every hole: an outline (or several rooms), plus whatever's on it. Coordinates are canvas pixels.
  const rect = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const HOLES = [
    { name: 'First Contact', par: 2, tee: [180, 290], cup: [780, 290], rooms: [rect(120, 180, 840, 400)] },
    { name: 'Dogleg', par: 3, tee: [160, 180], cup: [760, 420], rooms: [[[100, 100], [860, 100], [860, 480], [660, 480], [660, 260], [100, 260]]] },
    {
      name: 'Sand Trap', par: 3, tee: [160, 290], cup: [800, 290], rooms: [rect(100, 120, 860, 460)],
      sand: [{ x: 480, y: 290, r: 110 }], walls: [[[480, 120], [480, 215]], [[480, 365], [480, 460]]],
    },
    {
      name: 'Bumper Alley', par: 3, tee: [130, 290], cup: [830, 290], rooms: [rect(80, 160, 880, 420)],
      bumpers: [{ x: 300, y: 225, r: 22 }, { x: 300, y: 355, r: 22 }, { x: 480, y: 290, r: 26 }, { x: 660, y: 225, r: 22 }, { x: 660, y: 355, r: 22 }],
    },
    {
      name: 'The Moat', par: 3, tee: [170, 400], cup: [790, 180], rooms: [rect(100, 100, 860, 480)],
      water: [rect(380, 100, 580, 250), rect(380, 330, 580, 480)],
    },
    {
      name: 'First Orbit', par: 3, tee: [150, 290], cup: [810, 290], rooms: [rect(80, 80, 880, 500)],
      planets: [{ x: 480, y: 290, r: 60, pull: 2.6e6, field: 200, color: '#6fa8ff' }],
    },
    {
      name: 'Wormhole', par: 2, tee: [140, 290], cup: [820, 200], rooms: [rect(80, 120, 420, 460), rect(540, 120, 880, 460)],
      portals: [{ a: [360, 290], b: [610, 290] }],
      sand: [{ x: 760, y: 380, r: 60 }],
    },
    {
      name: 'Sliders', par: 3, tee: [130, 290], cup: [830, 290], rooms: [rect(80, 150, 880, 430)],
      movers: [{ x: 330, y: 290, len: 130, amp: 75, period: 3, vertical: true }, { x: 630, y: 290, len: 130, amp: 75, period: 2.2, vertical: true, phase: Math.PI }],
    },
    {
      name: 'Boost Lane', par: 3, tee: [140, 165], cup: [140, 415],
      rooms: [[[80, 80], [880, 80], [880, 500], [80, 500], [80, 330], [720, 330], [720, 250], [80, 250]]],
      boosts: [{ x: 280, y: 340, w: 300, h: 150, dx: -1, dy: 0 }],
      sand: [{ x: 800, y: 290, r: 45 }],
    },
    {
      name: 'Black Hole Sun', par: 4, tee: [120, 470], cup: [840, 110], rooms: [rect(60, 60, 900, 520)],
      holes: [{ x: 480, y: 290, r: 26, pull: 5e6, field: 230 }],
      planets: [{ x: 300, y: 150, r: 34, pull: 0, field: 0, color: '#ffb36b' }, { x: 660, y: 430, r: 34, pull: 0, field: 0, color: '#ff8fab' }],
    },
    {
      name: 'Zigzag', par: 4, tee: [140, 440], cup: [830, 440], rooms: [rect(80, 80, 880, 500)],
      walls: [[[300, 80], [300, 380]], [[520, 200], [520, 500]], [[740, 80], [740, 380]]],
      sand: [{ x: 410, y: 140, r: 45 }, { x: 630, y: 440, r: 45 }],
      bumpers: [{ x: 410, y: 440, r: 18 }],
    },
    {
      name: 'Grand Finale', par: 4, tee: [110, 110], cup: [850, 460], rooms: [rect(60, 60, 900, 520)],
      planets: [{ x: 330, y: 220, r: 45, pull: 1.8e6, field: 150, color: '#9be37a' }],
      water: [rect(560, 300, 700, 520)],
      movers: [{ x: 780, y: 300, len: 110, amp: 120, period: 2.6, vertical: true }],
      portals: [{ a: [160, 460], b: [620, 140] }],
      bumpers: [{ x: 470, y: 420, r: 20 }],
    },
  ];
  // Star coins: one per Classic hole, worth STAR_PTS if you roll through it.
  const CLASSIC_STARS = [[480, 220], [760, 180], [480, 160], [480, 290], [480, 290], [480, 130], [250, 400], [480, 200], [500, 290], [480, 470], [630, 290], [470, 360]];
  HOLES.forEach((h, i) => { h.star = CLASSIC_STARS[i]; });

  // Frost Nebula: ice that barely slows the ball, spinning blades, orbiting moons and a moving cup.
  //   ice: rects where the ball glides   spinners: { x, y, len, speed, arms }   cupMove: { amp, period, vertical }
  //   orbit (on a planet): { cx, cy, rad, period, phase }
  const FROST = [
    { name: 'Black Ice', par: 2, tee: [160, 350], cup: [800, 230], rooms: [rect(100, 180, 860, 400)], ice: [rect(250, 180, 710, 400)], bumpers: [{ x: 480, y: 290, r: 20 }], star: [480, 360] },
    {
      name: 'Windmill', par: 3, tee: [160, 290], cup: [800, 290], rooms: [rect(100, 140, 860, 440)],
      walls: [[[480, 140], [480, 248]], [[480, 332], [480, 440]]], spinners: [{ x: 480, y: 290, len: 150, speed: 1.6 }], star: [300, 190],
    },
    {
      name: 'Moon Orbit', par: 3, tee: [150, 290], cup: [810, 290], rooms: [rect(80, 80, 880, 500)],
      planets: [{ x: 480, y: 290, r: 36, pull: 1.6e6, field: 140, color: '#bfe3ff', orbit: { cx: 480, cy: 290, rad: 130, period: 6 } }], star: [480, 120],
    },
    {
      name: 'Moving Target', par: 3, tee: [160, 290], cup: [780, 290], rooms: [rect(100, 110, 860, 470)],
      cupMove: { amp: 120, period: 4, vertical: true }, ice: [rect(560, 110, 860, 470)], sand: [{ x: 420, y: 290, r: 55 }], star: [420, 420],
    },
    {
      name: 'Twin Blades', par: 3, tee: [130, 290], cup: [830, 290], rooms: [rect(80, 150, 880, 430)],
      spinners: [{ x: 330, y: 290, len: 200, speed: 2 }, { x: 630, y: 290, len: 200, speed: -2.4 }], star: [480, 180],
    },
    {
      name: 'Glacier Bend', par: 3, tee: [150, 170], cup: [750, 440], rooms: [[[80, 80], [880, 80], [880, 500], [620, 500], [620, 260], [80, 260]]],
      ice: [rect(240, 80, 880, 260)], bumpers: [{ x: 835, y: 125, r: 22 }], star: [750, 330],
    },
    {
      name: 'Comet Belt', par: 3, tee: [110, 290], cup: [850, 290], rooms: [rect(60, 100, 900, 480)],
      planets: [
        { x: 300, y: 290, r: 22, pull: 0, field: 0, color: '#9ad0ff', orbit: { cx: 300, cy: 290, rad: 90, period: 3 } },
        { x: 480, y: 290, r: 22, pull: 0, field: 0, color: '#c6b5ff', orbit: { cx: 480, cy: 290, rad: 90, period: 4, phase: 2 } },
        { x: 660, y: 290, r: 22, pull: 0, field: 0, color: '#9ad0ff', orbit: { cx: 660, cy: 290, rad: 90, period: 5, phase: 4 } },
      ],
      star: [480, 290],
    },
    {
      name: 'Freeze Frame', par: 3, tee: [140, 290], cup: [820, 400], rooms: [rect(80, 120, 420, 460), rect(540, 120, 880, 460)],
      portals: [{ a: [360, 400], b: [600, 180] }], ice: [rect(540, 120, 880, 460)], cupMove: { amp: 50, period: 3 }, star: [200, 180],
    },
    {
      name: 'Absolute Zero', par: 4, tee: [120, 470], cup: [840, 110], rooms: [rect(60, 60, 900, 520)],
      holes: [{ x: 480, y: 290, r: 26, pull: 4e6, field: 200 }], spinners: [{ x: 480, y: 290, len: 180, speed: 0.9 }],
      planets: [{ x: 480, y: 90, r: 28, pull: 1e6, field: 100, color: '#e1f5fe', orbit: { cx: 480, cy: 290, rad: 200, period: 7 } }],
      ice: [rect(60, 60, 300, 520)], star: [840, 470],
    },
  ];

  // Magma Belt: lava (a stroke, like water), repulsors that push you away, and switch gates.
  //   lava: rects   pools: { x, y, r, kind }   switches: [{ x, y }] open every gate on the hole   gates: [[a, b]]
  //   boosts can push any way (dx, dy)
  const MAGMA = [
    { name: 'Hot Foot', par: 2, tee: [160, 290], cup: [800, 290], rooms: [rect(100, 160, 860, 420)], lava: [rect(420, 160, 540, 262), rect(420, 318, 540, 420)], star: [300, 200] },
    { name: 'Push Back', par: 3, tee: [140, 290], cup: [820, 290], rooms: [rect(80, 120, 880, 460)], planets: [{ x: 480, y: 290, r: 30, pull: -2.2e6, field: 180, color: '#ff5a3c' }], star: [480, 150] },
    {
      name: 'Gatekeeper', par: 3, tee: [150, 180], cup: [780, 290], rooms: [rect(80, 100, 880, 480)],
      walls: [[[600, 100], [600, 240]], [[600, 340], [600, 480]]], gates: [[[600, 240], [600, 340]]], switches: [{ x: 300, y: 410 }], star: [780, 430],
    },
    {
      name: 'Lava Lamp', par: 3, tee: [130, 440], cup: [830, 150], rooms: [rect(80, 80, 880, 500)],
      pools: [{ x: 330, y: 210, r: 60, kind: 'lava' }, { x: 480, y: 380, r: 70, kind: 'lava' }, { x: 640, y: 190, r: 60, kind: 'lava' }], star: [480, 210],
    },
    {
      name: 'Spin Cycle', par: 3, tee: [160, 290], cup: [800, 290], rooms: [rect(100, 100, 860, 480)],
      spinners: [{ x: 480, y: 290, len: 300, speed: 1.2, arms: 2 }], pools: [{ x: 480, y: 128, r: 24, kind: 'lava' }, { x: 480, y: 452, r: 24, kind: 'lava' }], star: [300, 150],
    },
    {
      name: 'Pinball Forge', par: 3, tee: [130, 290], cup: [830, 290], rooms: [rect(80, 140, 880, 440)],
      bumpers: [{ x: 330, y: 215, r: 20 }, { x: 330, y: 365, r: 20 }, { x: 630, y: 215, r: 20 }, { x: 630, y: 365, r: 20 }],
      planets: [{ x: 480, y: 290, r: 24, pull: -1.5e6, field: 120, color: '#ff5a3c' }], star: [480, 175],
    },
    {
      name: 'The Vault', par: 4, tee: [150, 450], cup: [790, 290], rooms: [rect(60, 60, 900, 520)],
      walls: [[[700, 200], [860, 200]], [[700, 380], [860, 380]], [[860, 200], [860, 380]]], gates: [[[700, 200], [700, 380]]], switches: [{ x: 200, y: 120 }],
      pools: [{ x: 450, y: 290, r: 75, kind: 'lava' }], star: [450, 110],
    },
    {
      name: 'Conveyor Crossing', par: 3, tee: [140, 290], cup: [820, 290], rooms: [rect(80, 100, 880, 480)],
      boosts: [{ x: 300, y: 140, w: 120, h: 300, dx: 0, dy: -1 }, { x: 540, y: 140, w: 120, h: 300, dx: 0, dy: 1 }],
      lava: [rect(300, 100, 660, 140), rect(300, 440, 660, 480)], star: [480, 290],
    },
    {
      name: 'Core Meltdown', par: 4, tee: [120, 470], cup: [840, 110], rooms: [rect(60, 60, 900, 520)],
      spinners: [{ x: 480, y: 290, len: 260, speed: 1.4 }],
      pools: [{ x: 300, y: 140, r: 50, kind: 'lava' }, { x: 300, y: 440, r: 50, kind: 'lava' }, { x: 660, y: 440, r: 50, kind: 'lava' }],
      planets: [{ x: 480, y: 100, r: 22, pull: -1.2e6, field: 110, color: '#ff5a3c', orbit: { cx: 480, cy: 290, rad: 190, period: 6 } }], star: [660, 140],
    },
  ];

  // Asteroid Tour: nine holes made up fresh each round from the same parts. Uses Math.random, so
  // in an online duel (which seeds it) both players get the same tour.
  const TOUR_NAMES = ['Dust Run', 'Crater Lane', 'Ion Alley', 'Rock Garden', 'Drift Zone', 'Star Gate', 'Rift Walk', 'Pebble Pass', 'Nova Strip', 'Quasar Bend', 'Meteor Mile', 'Gravity Well'];
  function makeTour() {
    const R = Arcade.rand, RI = Arcade.randInt;
    const names = [...TOUR_NAMES].sort(() => Math.random() - 0.5);
    const out = [];
    for (let i = 0; i < 9; i++) {
      const x1 = RI(60, 120), x2 = RI(840, 900), y1 = RI(70, 150), y2 = RI(390, 480), mid = (y1 + y2) / 2;
      const h = { name: names[i], par: 2, tee: [x1 + 55, RI(y1 + 50, y2 - 50)], cup: [x2 - 60, RI(y1 + 50, y2 - 50)], rooms: [rect(x1, y1, x2, y2)] };
      const n = Math.min(4, 1 + Math.floor(i / 3) + RI(0, 1));
      const kinds = ['sand', 'bumpers', 'planet', 'spinner', 'strip', 'mover', 'ice', 'repulsor', 'wall', 'boost'].sort(() => Math.random() - 0.5).slice(0, n);
      let hard = 0;
      kinds.forEach((k, j) => {
        const cx = 260 + (440 * (j + 0.5)) / n, cy = R(y1 + 80, y2 - 80);
        const add = (key, v) => (h[key] = h[key] || []).push(v);
        if (k === 'sand') add('sand', { x: cx, y: cy, r: R(40, 65) });
        else if (k === 'bumpers') for (let b = 0; b < 3; b++) add('bumpers', { x: cx + R(-40, 40), y: y1 + ((y2 - y1) * (b + 1)) / 4, r: R(16, 22) });
        else if (k === 'planet') { add('planets', { x: cx, y: mid, r: R(30, 45), pull: R(1.4e6, 2.4e6), field: R(110, 160), color: Arcade.pick(['#6fa8ff', '#9be37a', '#ffb36b', '#c39bff']) }); hard++; }
        else if (k === 'spinner') { add('spinners', { x: cx, y: mid, len: Math.min(240, y2 - y1 - 70), speed: R(1, 2) * (Math.random() < 0.5 ? -1 : 1) }); hard++; }
        else if (k === 'strip') {
          // A lava or water strip right across, with one gap to roll through.
          const gy = R(y1 + 40, y2 - 100), kind = Math.random() < 0.5 ? 'lava' : 'water';
          add(kind, rect(cx - 30, y1, cx + 30, gy));
          add(kind, rect(cx - 30, gy + 70, cx + 30, y2));
          hard++;
        } else if (k === 'mover') add('movers', { x: cx, y: mid, len: 110, amp: (y2 - y1) / 2 - 60, period: R(2, 3.2), vertical: true });
        else if (k === 'ice') add('ice', rect(cx - 70, y1, cx + 70, y2));
        else if (k === 'repulsor') { add('planets', { x: cx, y: mid, r: 24, pull: -R(1.2e6, 2e6), field: 130, color: '#ff5a3c' }); hard++; }
        else if (k === 'wall') {
          const gy = R(y1 + 40, y2 - 120);
          add('walls', [[cx, y1], [cx, gy]]);
          add('walls', [[cx, gy + 85], [cx, y2]]);
        } else if (k === 'boost') add('boosts', { x: cx - 60, y: y1 + 10, w: 120, h: y2 - y1 - 20, dx: 0, dy: Math.random() < 0.5 ? -1 : 1 });
      });
      h.par = Math.min(4, 2 + Math.round((n + hard) / 3));
      h.star = [R(260, 700), R(y1 + 30, y2 - 30)];
      out.push(h);
    }
    return out;
  }

  const COURSES = [
    { id: 'classic', name: 'Moonbase Classic', desc: 'The original 12 holes.', color: '#9be37a', holes: () => HOLES },
    { id: 'frost', name: 'Frost Nebula', desc: 'Ice, spinning blades, orbiting moons and moving cups.', color: '#8fd3ff', holes: () => FROST },
    { id: 'magma', name: 'Magma Belt', desc: 'Lava, repulsors, conveyors and switch gates.', color: '#ff7a45', holes: () => MAGMA },
    { id: 'tour', name: 'Asteroid Tour', desc: 'Nine random holes, new every round.', color: '#c39bff', holes: makeTour },
  ];
  const COURSE_KEY = 'putt:course', BESTS_KEY = 'putt:bests';
  let courseId = Arcade.load(COURSE_KEY, 'classic');
  if (!COURSES.some(c => c.id === courseId)) courseId = 'classic';
  let course = HOLES;
  const totalPar = () => course.reduce((t, h) => t + h.par, 0);

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';   // 'aim' | 'rolling' | 'sunk' | 'paused' | 'over'
  let holeIdx, hole, ball, strokes, card, aim, drag, keyAim, keyPower, safePos, time, popups, trail, portalCool, sinkT, aces, banner;
  let cup = [0, 0], stars = 0, starTaken = false, gatesOpen = false, sparks = [];

  // ---------- Setup ----------

  function reset() {
    course = COURSES.find(c => c.id === courseId).holes();
    holeIdx = 0;
    card = [];
    aces = 0;
    stars = 0;
    popups = [];
    time = 0;
    keyAim = 0;
    keyPower = 0.5;
    loadHole();
  }

  function loadHole() {
    hole = course[holeIdx];
    ball = { x: hole.tee[0], y: hole.tee[1], vx: 0, vy: 0, scale: 1 };
    starTaken = false;
    gatesOpen = false;
    moveThings();
    safePos = { x: ball.x, y: ball.y };
    strokes = 0;
    trail = [];
    portalCool = 0;
    drag = null;
    keyAim = Math.atan2(cup[1] - ball.y, cup[0] - ball.x);
    banner = { text: `Hole ${holeIdx + 1} · ${hole.name}`, sub: `Par ${hole.par}`, t: 2.2 };
    state = 'aim';
    updateHud();
  }

  // Wall segments: every room edge, plus loose walls.
  function segments() {
    const out = [];
    for (const room of hole.rooms) for (let i = 0; i < room.length; i++) out.push([room[i], room[(i + 1) % room.length], 0, 0]);
    for (const w of hole.walls || []) out.push([w[0], w[1], 0, 0]);
    if (!gatesOpen) for (const g of hole.gates || []) out.push([g[0], g[1], 0, 0]);
    // Spinner blades: the wall's speed depends on where along the blade the ball hits it.
    for (const sp of hole.spinners || []) for (const [a, b] of spinnerBlades(sp)) out.push([a, b, 0, 0, sp]);
    for (const m of hole.movers || []) {
      const { x, y, vx, vy } = moverPos(m);
      const half = m.len / 2;
      out.push(m.vertical ? [[x, y - half], [x, y + half], vx, vy] : [[x - half, y], [x + half, y], vx, vy]);
    }
    return out;
  }

  function spinnerBlades(sp) {
    const out = [], half = sp.len / 2;
    for (let k = 0; k < (sp.arms || 1); k++) {
      const a = time * sp.speed + (k * Math.PI) / (sp.arms || 1), c = Math.cos(a) * half, s = Math.sin(a) * half;
      out.push([[sp.x - c, sp.y - s], [sp.x + c, sp.y + s]]);
    }
    return out;
  }

  // Orbiting planets and the moving cup follow the clock.
  function moveThings() {
    for (const p of hole.planets || []) {
      if (!p.orbit) continue;
      const o = p.orbit, a = (time * Math.PI * 2) / o.period + (o.phase || 0);
      p.x = o.cx + Math.cos(a) * o.rad;
      p.y = o.cy + Math.sin(a) * o.rad;
    }
    const m = hole.cupMove;
    const off = m ? Math.sin((time * Math.PI * 2) / m.period) * m.amp : 0;
    cup = m ? (m.vertical ? [hole.cup[0], hole.cup[1] + off] : [hole.cup[0] + off, hole.cup[1]]) : hole.cup;
  }

  function moverPos(m) {
    const w = (Math.PI * 2) / m.period, p = time * w + (m.phase || 0);
    const off = Math.sin(p) * m.amp, vel = Math.cos(p) * m.amp * w;
    return m.vertical ? { x: m.x, y: m.y + off, vx: 0, vy: vel } : { x: m.x + off, y: m.y, vx: vel, vy: 0 };
  }

  const inRect = (r, x, y) => x >= r[0][0] && x <= r[2][0] && y >= r[0][1] && y <= r[2][1];
  const inBoost = b => ball.x > b.x && ball.x < b.x + b.w && ball.y > b.y && ball.y < b.y + b.h;

  // ---------- Shooting ----------

  function shoot(power, angle) {
    if (state !== 'aim' || power < 0.04) return;
    safePos = { x: ball.x, y: ball.y };
    ball.vx = Math.cos(angle) * power * MAX_POWER;
    ball.vy = Math.sin(angle) * power * MAX_POWER;
    strokes++;
    state = 'rolling';
    Arcade.tone({ freq: 300 + power * 400, to: 200, dur: 0.08, type: 'triangle', vol: 0.06 });
    updateHud();
  }

  function penalty(text) {
    strokes++;
    popups.push({ x: ball.x, y: ball.y - 20, text, t: 0, color: '#7fdbff' });
    Arcade.tone({ freq: 300, to: 90, dur: 0.35, type: 'sine', vol: 0.06 });
    ball.x = safePos.x;
    ball.y = safePos.y;
    ball.vx = ball.vy = 0;
    trail = [];
    if (strokes >= MAX_STROKES) return pickUp();
    state = 'aim';
    updateHud();
  }

  function pickUp() {
    strokes = MAX_STROKES;
    popups.push({ x: ball.x, y: ball.y - 20, text: 'Picked up', t: 0, color: '#ff8a80' });
    finishHole();
  }

  function sink() {
    state = 'sunk';
    sinkT = 0;
    ball.vx = ball.vy = 0;
    const d = strokes - hole.par;
    const names = { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };
    const text = strokes === 1 ? 'HOLE IN ONE!' : names[d] || `+${d}`;
    if (strokes === 1) {
      aces++;
      Arcade.flag('putt-planet-ace');
    }
    popups.push({ x: cup[0], y: cup[1] - 26, text, t: 0, color: d < 0 ? '#ffd23f' : '#ffffff', big: true });
    sparkle(cup[0], cup[1], d < 0 ? ['#ffd23f', '#fff', '#9be37a'] : ['#ffffff', '#9be37a'], d < 0 ? 40 : 20);
    Arcade.tone({ freq: 660, to: 990, dur: 0.15, type: 'triangle', vol: 0.06 });
    Arcade.tone({ freq: 990, to: 1320, dur: 0.2, type: 'triangle', vol: 0.06, delay: 0.12 });
    finishHole();
  }

  function finishHole() {
    card.push(strokes);
    if (state !== 'sunk') state = 'sunk';
    sinkT = 0;
    updateHud();
  }

  function nextHole() {
    holeIdx++;
    if (holeIdx >= course.length) return endRound();
    loadHole();
  }

  const totalStrokes = () => card.reduce((a, b) => a + b, 0);
  const parSoFar = () => course.slice(0, card.length).reduce((t, h) => t + h.par, 0);
  const toPar = () => totalStrokes() - parSoFar();
  const STAR_PTS = 50;
  const score = () => Math.max(0, 1000 + (parSoFar() - totalStrokes()) * 100 + aces * 150 + stars * STAR_PTS);
  const fmtPar = n => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

  function endRound() {
    state = 'over';
    Arcade.flag('putt-planet-round');
    if (toPar() < 0) Arcade.flag('putt-planet-under');
    if (courseId === 'frost') Arcade.flag('putt-planet-frost');
    if (courseId === 'magma') Arcade.flag('putt-planet-magma');
    if (courseId === 'tour' && toPar() < 0) Arcade.flag('putt-planet-tour');
    if (stars === course.length) Arcade.flag('putt-planet-stars');
    const bests = Arcade.load(BESTS_KEY, {});
    if (score() > (bests[courseId] || 0)) {
      bests[courseId] = score();
      Arcade.save(BESTS_KEY, bests);
    }
    const cells = (arr, f) => arr.map(f).join('');
    const row = (label, arr, f) => `<tr><th style="text-align:left;padding-right:6px">${label}</th>${cells(arr, f)}</tr>`;
    const td = v => `<td style="padding:2px 4px;text-align:center">${v}</td>`;
    const table = `<table style="font-size:12px;margin:0 auto 12px;border-collapse:collapse;color:var(--muted)">
      ${row('Hole', course, (_, i) => td(i + 1))}${row('Par', course, h => td(h.par))}
      ${row('You', card, (s, i) => td(`<b style="color:${s < course[i].par ? '#ffd23f' : s > course[i].par ? '#ff8a80' : 'var(--text)'}">${s}</b>`))}</table>`;
    const name = COURSES.find(c => c.id === courseId).name;
    Arcade.finish(ui, {
      score: score(),
      title: 'Round complete',
      lines: [`${name} · ${totalStrokes()} strokes · ${fmtPar(toPar())} against par ${totalPar()}${aces ? ` · ${aces} hole${aces > 1 ? 's' : ''} in one` : ''}`, `★ ${stars}/${course.length} star coins (+${stars * STAR_PTS})`],
      html: table + (typeof Versus !== 'undefined' && Versus.active() ? '' : '<div class="menu" style="margin-bottom:8px"><button class="btn secondary" type="button" data-courses>Pick a course</button></div>'),
      button: 'Play again',
      onAction: start,
    });
    document.querySelector('[data-courses]')?.addEventListener('click', showMenu);
  }

  // ---------- Physics ----------

  function collideSegment(seg) {
    let [[x1, y1], [x2, y2], mvx, mvy, spin] = seg;
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((ball.x - x1) * dx + (ball.y - y1) * dy) / len2));
    const cx = x1 + dx * t, cy = y1 + dy * t;
    if (spin) {
      mvx = -spin.speed * (cy - spin.y);
      mvy = spin.speed * (cx - spin.x);
    }
    const ox = ball.x - cx, oy = ball.y - cy, d = Math.hypot(ox, oy);
    if (d >= BALL_R || d === 0) return;
    const nx = ox / d, ny = oy / d;
    ball.x = cx + nx * BALL_R;
    ball.y = cy + ny * BALL_R;
    const rvx = ball.vx - mvx, rvy = ball.vy - mvy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      ball.vx -= 1.75 * vn * nx;
      ball.vy -= 1.75 * vn * ny;
      if (spin) Arcade.tone({ freq: 520, dur: 0.04, type: 'triangle', vol: 0.03 });
      if (Math.abs(vn) > 60) Arcade.tone({ freq: 220, dur: 0.03, type: 'square', vol: Math.min(0.04, Math.abs(vn) / 20000) });
    }
  }

  function collideCircle(c, restitution, kick = 0) {
    const ox = ball.x - c.x, oy = ball.y - c.y, d = Math.hypot(ox, oy);
    if (d >= c.r + BALL_R || d === 0) return false;
    const nx = ox / d, ny = oy / d;
    ball.x = c.x + nx * (c.r + BALL_R);
    ball.y = c.y + ny * (c.r + BALL_R);
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= (1 + restitution) * vn * nx;
      ball.vy -= (1 + restitution) * vn * ny;
    }
    if (kick) {
      ball.vx += nx * kick;
      ball.vy += ny * kick;
    }
    return true;
  }

  function step(dt) {
    const speed = Math.hypot(ball.vx, ball.vy);
    // Gravity from planets and black holes.
    for (const p of [...(hole.planets || []), ...(hole.holes || [])]) {
      const dx = p.x - ball.x, dy = p.y - ball.y, d = Math.hypot(dx, dy);
      if (!p.pull || d > p.field + p.r) continue;
      const a = p.pull / Math.max(d * d, p.r * p.r);
      ball.vx += (dx / d) * a * dt;
      ball.vy += (dy / d) * a * dt;
    }
    for (const b of hole.boosts || []) {
      if (inBoost(b)) {
        ball.vx += b.dx * 1100 * dt;
        ball.vy += b.dy * 1100 * dt;
      }
    }
    const inSand = (hole.sand || []).some(s => Math.hypot(ball.x - s.x, ball.y - s.y) < s.r);
    const onIce = !inSand && (hole.ice || []).some(r => inRect(r, ball.x, ball.y));
    const decel = ROLL_DECEL * (inSand ? SAND : onIce ? 0.12 : 1);
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - decel * dt) * Math.exp(-DAMPING * dt * (inSand ? 3 : onIce ? 0.25 : 1));
      ball.vx *= ns / sp;
      ball.vy *= ns / sp;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    for (const seg of segments()) collideSegment(seg);
    for (const b of hole.bumpers || []) if (collideCircle(b, 0.9, 120)) Arcade.tone({ freq: 880, dur: 0.05, type: 'square', vol: 0.03 });
    for (const p of hole.planets || []) collideCircle(p, 0.6);

    portalCool = Math.max(0, portalCool - dt);
    if (!portalCool) for (const p of hole.portals || []) {
      for (const [from, to] of [[p.a, p.b], [p.b, p.a]]) {
        if (Math.hypot(ball.x - from[0], ball.y - from[1]) < 14) {
          ball.x = to[0];
          ball.y = to[1];
          portalCool = 0.6;
          trail = [];
          Arcade.flag('putt-planet-portal');
          Arcade.tone({ freq: 400, to: 1200, dur: 0.2, type: 'sine', vol: 0.05 });
          break;
        }
      }
    }

    for (const w of hole.water || []) if (inRect(w, ball.x, ball.y)) return penalty('Splash! +1');
    for (const w of hole.lava || []) if (inRect(w, ball.x, ball.y)) return penalty('Toasted! +1');
    for (const p of hole.pools || []) if (Math.hypot(ball.x - p.x, ball.y - p.y) < p.r - 2) return penalty(p.kind === 'lava' ? 'Toasted! +1' : 'Splash! +1');

    if (hole.star && !starTaken && Math.hypot(ball.x - hole.star[0], ball.y - hole.star[1]) < 16) {
      starTaken = true;
      stars++;
      popups.push({ x: hole.star[0], y: hole.star[1] - 18, text: `★ +${STAR_PTS}`, t: 0, color: '#ffd23f' });
      sparkle(hole.star[0], hole.star[1], ['#ffd23f', '#fff6c4'], 18);
      Arcade.tone({ freq: 880, to: 1760, dur: 0.15, type: 'triangle', vol: 0.05 });
    }
    if (!gatesOpen) for (const sw of hole.switches || []) {
      if (Math.hypot(ball.x - sw.x, ball.y - sw.y) < 18) {
        gatesOpen = true;
        popups.push({ x: sw.x, y: sw.y - 20, text: 'Gate open!', t: 0, color: '#7fffd4' });
        sparkle(sw.x, sw.y, ['#7fffd4', '#fff'], 16);
        Arcade.tone({ freq: 500, to: 1000, dur: 0.25, type: 'square', vol: 0.04 });
      }
    }
    for (const b of hole.holes || []) if (Math.hypot(ball.x - b.x, ball.y - b.y) < b.r) return penalty('Swallowed! +1');

    // The cup: slow enough and it drops; too fast and it lips out.
    const cd = Math.hypot(ball.x - cup[0], ball.y - cup[1]);
    if (cd < CUP_R) {
      if (speed < SINK_SPEED) return sink();
      ball.vx *= 0.8;
      ball.vy *= 0.8;
      const a = Arcade.rand(-0.25, 0.25), c = Math.cos(a), s = Math.sin(a);
      [ball.vx, ball.vy] = [ball.vx * c - ball.vy * s, ball.vx * s + ball.vy * c];
    } else if (cd < CUP_R + 6 && speed < SINK_SPEED) {
      ball.vx += ((cup[0] - ball.x) / cd) * 300 * dt;
      ball.vy += ((cup[1] - ball.y) / cd) * 300 * dt;
    }

    if (Math.hypot(ball.vx, ball.vy) < STOP && !(hole.boosts || []).some(inBoost)) {
      ball.vx = ball.vy = 0;
      if (strokes >= MAX_STROKES) return pickUp();
      state = 'aim';
      keyAim = Math.atan2(cup[1] - ball.y, cup[0] - ball.x);
    }
  }

  function sparkle(x, y, colors, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 220;
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, color: colors[i % colors.length] });
    }
  }

  function update(dt) {
    time += dt;
    moveThings();
    if (banner) banner.t -= dt;
    for (const p of popups) p.t += dt;
    popups = popups.filter(p => p.t < 1.4);
    if (state === 'rolling') {
      const sp = Math.hypot(ball.vx, ball.vy);
      const n = Math.max(1, Math.ceil((sp * dt) / 3));
      for (let k = 0; k < n && state === 'rolling'; k++) step(dt / n);
      trail.push([ball.x, ball.y]);
      if (trail.length > 14) trail.shift();
    } else if (state === 'sunk') {
      sinkT += dt;
      ball.scale = Math.max(0, 1 - sinkT * 3);
      if (sinkT > 1.4) nextHole();
    } else if (state === 'aim') {
      if (held.left) keyAim -= dt * 1.8;
      if (held.right) keyAim += dt * 1.8;
      if (held.up) keyPower = Math.min(1, keyPower + dt * 0.7);
      if (held.down) keyPower = Math.max(0.05, keyPower - dt * 0.7);
    }
  }

  function updateHud() {
    $('hole').textContent = `${Math.min(holeIdx + 1, course.length)}/${course.length}`;
    $('strokes').textContent = strokes;
    $('topar').textContent = fmtPar(toPar());
    $('best').textContent = Arcade.getBest(ID);
  }

  // ---------- Input ----------

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }
  // Drag anywhere and pull back like a slingshot; the shot goes the opposite way.
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'aim') return;
    const [x, y] = toBoard(e);
    drag = { x0: x, y0: y, x, y };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    [drag.x, drag.y] = toBoard(e);
  });
  const release = () => {
    if (!drag) return;
    const { power, angle } = dragShot();
    drag = null;
    shoot(power, angle);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { drag = null; });

  function dragShot() {
    const dx = drag.x0 - drag.x, dy = drag.y0 - drag.y;
    return { power: Math.min(1, Math.hypot(dx, dy) / MAX_DRAG), angle: Math.atan2(dy, dx) };
  }

  const held = { left: false, right: false, up: false, down: false };
  const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'aim' || state === 'rolling' || state === 'sunk') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (KEYS[e.code]) {
      e.preventDefault();
      held[KEYS[e.code]] = true;
    }
    if (e.code === 'Space' && !e.repeat && state === 'aim') {
      e.preventDefault();
      shoot(keyPower, keyAim);
    }
  });
  window.addEventListener('keyup', e => { if (KEYS[e.code]) held[KEYS[e.code]] = false; });

  let resumeTo = 'aim';
  function pause() {
    resumeTo = state;
    state = 'paused';
    drag = null;
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }
  function resume() {
    state = resumeTo;
    ui.hide();
  }
  Arcade.onBlur(() => { if (['aim', 'rolling', 'sunk'].includes(state)) pause(); });

  function start() {
    // Duels always play an Asteroid Tour: both players get the same one from the shared seed.
    if (typeof Versus !== 'undefined' && Versus.active()) courseId = 'tour';
    reset();
    ui.hide();
  }

  function menuHtml() {
    const bests = Arcade.load(BESTS_KEY, {});
    const rows = COURSES.map(c => {
      const holes = c.id === 'tour' ? 9 : c.holes().length, par = c.id === 'tour' ? '' : ` · par ${c.holes().reduce((t, h) => t + h.par, 0)}`;
      return `<button class="btn ${c.id === courseId ? '' : 'secondary'}" type="button" data-course="${c.id}" style="flex-direction:column;align-items:flex-start;text-align:left;line-height:1.2">
        <span style="color:${c.id === courseId ? 'inherit' : c.color}">${c.name}</span>
        <small style="font-weight:400;opacity:.85">${holes} holes${par} · ${c.desc}${bests[c.id] ? ` · best ${bests[c.id].toLocaleString()}` : ''}</small></button>`;
    }).join('');
    return `<ul>
        <li><b>Drag back</b> anywhere and let go to putt, like a slingshot. Or aim with <b>←→</b>, set power with <b>↑↓</b>, and putt with <b>Space</b>.</li>
        <li>Too fast and the ball lips out of the cup. Each stroke under par is worth 100 points, and each <b style="color:#ffd23f">★ star coin</b> you roll through is worth ${STAR_PTS}.</li>
      </ul>
      <div class="menu">${rows}</div>`;
  }
  function wireMenu(panel) {
    panel.querySelectorAll('[data-course]').forEach(b => b.addEventListener('click', () => {
      courseId = b.dataset.course;
      Arcade.save(COURSE_KEY, courseId);
      start();
    }));
  }
  function showMenu() {
    state = 'menu';
    ui.show({ title: 'Putt Planet', html: menuHtml(), button: `Tee off: ${COURSES.find(c => c.id === courseId).name}`, onAction: start, onRender: wireMenu });
  }

  // ---------- Drawing ----------

  const sky = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() }));
  const THEMES = {
    classic: { space: '#0b0d1f', turf: '#2f8f4e', wall: '#d7c9a8' },
    frost: { space: '#071426', turf: '#3c8fa8', wall: '#e3f2fd' },
    magma: { space: '#1a0806', turf: '#5f6b3a', wall: '#a1887f' },
    tour: { space: '#120b24', turf: '#4a7d5a', wall: '#cfc3e8' },
  };

  function drawStar(x, y, r, rot) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? r * 0.45 : r, a = rot + (k * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  function pathPoly(pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function draw() {
    const theme = THEMES[courseId] || THEMES.classic;
    ctx.fillStyle = theme.space;
    ctx.fillRect(0, 0, W, H);
    for (const s of sky) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + s.s * 0.5})`;
      ctx.fillRect(s.x, s.y, 1 + s.s, 1 + s.s);
    }
    if (!hole) return;

    // Turf with a frame.
    for (const room of hole.rooms) {
      ctx.save();
      ctx.translate(0, 8);
      pathPoly(room);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.restore();
      pathPoly(room);
      const tg = ctx.createLinearGradient(0, 60, 0, 520);
      tg.addColorStop(0, Gfx.shade(theme.turf, 0.12));
      tg.addColorStop(1, Gfx.shade(theme.turf, -0.12));
      ctx.fillStyle = tg;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 18;
      for (let x = -H; x < W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + H, H);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const s of hole.sand || []) {
      ctx.fillStyle = '#e3c983';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,120,60,0.25)';
      for (let k = 0; k < 10; k++) ctx.fillRect(s.x + Math.cos(k * 2.4) * s.r * 0.6, s.y + Math.sin(k * 1.7) * s.r * 0.6, 3, 2);
    }
    for (const r of hole.ice || []) {
      pathPoly(r);
      const ig = ctx.createLinearGradient(r[0][0], r[0][1], r[2][0], r[2][1]);
      ig.addColorStop(0, 'rgba(225,245,255,0.55)');
      ig.addColorStop(1, 'rgba(150,210,240,0.45)');
      ctx.fillStyle = ig;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 6; k++) {
        const x = r[0][0] + ((k * 97) % (r[2][0] - r[0][0])), y = r[0][1] + ((k * 61) % (r[2][1] - r[0][1]));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 18, y + 10);
        ctx.lineTo(x + 26, y + 4);
        ctx.stroke();
      }
    }
    for (const w of hole.lava || []) {
      pathPoly(w);
      ctx.fillStyle = '#d84315';
      ctx.fill();
      ctx.fillStyle = 'rgba(255,213,79,0.55)';
      for (let k = 0; k < 8; k++) {
        const x = w[0][0] + (((k * 53 + time * 18) % (w[2][0] - w[0][0])) || 0), y = w[0][1] + ((k * 37) % (w[2][1] - w[0][1]));
        ctx.beginPath();
        ctx.arc(x, y, 3 + Math.sin(time * 3 + k) * 2 + 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const p of hole.pools || []) {
      const lava = p.kind === 'lava';
      const pg = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
      pg.addColorStop(0, lava ? '#ffca28' : '#4f9be0');
      pg.addColorStop(0.6, lava ? '#f4511e' : '#2a6fb8');
      pg.addColorStop(1, lava ? '#8d1c0b' : '#173f6b');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = lava ? 'rgba(255,236,179,0.6)' : 'rgba(255,255,255,0.35)';
      for (let k = 0; k < 4; k++) {
        const a = time * (lava ? 0.6 : 1) + k * 1.6, d = p.r * (0.3 + 0.15 * k);
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.7, 2.5 + Math.sin(time * 4 + k) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const w of hole.water || []) {
      ctx.fillStyle = '#2a6fb8';
      pathPoly(w);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      for (let y = w[0][1] + 12; y < w[2][1]; y += 18) {
        ctx.beginPath();
        for (let x = w[0][0] + 6; x < w[2][0] - 6; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.08 + time * 3) * 2);
        ctx.stroke();
      }
    }
    for (const b of hole.boosts || []) {
      ctx.fillStyle = 'rgba(255,210,63,0.15)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
      // Chevrons scrolling the way the pad pushes, drawn in the pad's own frame.
      const along = b.dx ? b.w : b.h, across = b.dx ? b.h : b.w;
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.rotate(Math.atan2(b.dy, b.dx));
      ctx.fillStyle = 'rgba(255,210,63,0.6)';
      const off = (time * 80) % 40;
      for (let x = -along / 2 - 40 + off; x < along / 2 + 40; x += 40) {
        for (let y = -across / 2 + 40; y < across / 2; y += 80) {
          ctx.beginPath();
          ctx.moveTo(x - 7, y - 16);
          ctx.lineTo(x + 7, y);
          ctx.lineTo(x - 7, y + 16);
          ctx.lineTo(x - 1, y);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Gravity fields.
    for (const p of [...(hole.planets || []), ...(hole.holes || [])]) {
      if (!p.pull) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + ((p.field * k) / 3 - ((time * 30) % (p.field / 3))), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const b of hole.holes || []) {
      const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r * 2);
      g.addColorStop(0, '#000');
      g.addColorStop(0.5, '#000');
      g.addColorStop(0.75, 'rgba(195,155,255,0.6)');
      g.addColorStop(1, 'rgba(195,155,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of hole.planets || []) {
      if (p.orbit) {
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 10]);
        ctx.beginPath();
        ctx.arc(p.orbit.cx, p.orbit.cy, p.orbit.rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (p.pull < 0) {
        ctx.save();
        ctx.shadowColor = '#ff5a3c';
        ctx.shadowBlur = 18 + Math.sin(time * 6) * 6;
      }
      Gfx.shadow(ctx, p.x + 4, p.y + p.r * 0.8, p.r * 1.05, p.r * 0.35, 0.35);
      const g = ctx.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.4, p.r * 0.1, p.x, p.y, p.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.3, p.color);
      g.addColorStop(1, '#1a1d3a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      if (p.pull < 0) {
        ctx.restore();
        Gfx.text(ctx, '⇵', p.x, p.y + 1, { size: p.r * 0.9, color: 'rgba(255,255,255,0.85)', width: 0 });
      }
    }
    for (const b of hole.bumpers || []) {
      ctx.fillStyle = '#ff4fd8';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd1f5';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of hole.portals || []) {
      for (const [x, y] of [p.a, p.b]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(time * 3);
        ctx.strokeStyle = '#c39bff';
        ctx.lineWidth = 3;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(0, 0, 14 - k * 4, k, k + 4);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Switches and gates.
    for (const sw of hole.switches || []) {
      Gfx.shadow(ctx, sw.x, sw.y + 4, 18, 7, 0.35);
      ctx.fillStyle = gatesOpen ? '#2e7d6b' : '#1de9b6';
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = gatesOpen ? '#4db6ac' : '#a7ffeb';
      ctx.beginPath();
      ctx.arc(sw.x, sw.y - (gatesOpen ? 0 : 3), 10, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const g of hole.gates || []) {
      ctx.lineCap = 'round';
      if (gatesOpen) {
        ctx.strokeStyle = 'rgba(29,233,182,0.18)';
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 8]);
      } else {
        ctx.strokeStyle = '#ff1744';
        ctx.shadowColor = '#ff1744';
        ctx.shadowBlur = 12;
        ctx.lineWidth = 5 + Math.sin(time * 10) * 1.5;
      }
      ctx.beginPath();
      ctx.moveTo(...g[0]);
      ctx.lineTo(...g[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }

    // Walls, with a darker band underneath so they stand up off the turf.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [col, dy, lw] of [[Gfx.shade(theme.wall, -0.5), 4, 8], [theme.wall, 0, 6]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.save();
      ctx.translate(0, dy);
      for (const room of hole.rooms) {
        pathPoly(room);
        ctx.stroke();
      }
      for (const w of hole.walls || []) {
        ctx.beginPath();
        ctx.moveTo(...w[0]);
        ctx.lineTo(...w[1]);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const sp of hole.spinners || []) {
      for (const [a, b] of spinnerBlades(sp)) {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1] + 4);
        ctx.lineTo(b[0], b[1] + 4);
        ctx.stroke();
        ctx.strokeStyle = '#80deea';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(...a);
        ctx.lineTo(...b);
        ctx.stroke();
      }
      ctx.fillStyle = '#37474f';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b0bec5';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hole.star && !starTaken) {
      const [sx, sy] = hole.star, bob = Math.sin(time * 3) * 2;
      ctx.save();
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffd23f';
      drawStar(sx, sy + bob, 11, time * 1.5);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff6c4';
      drawStar(sx, sy + bob, 5, time * 1.5);
      ctx.fill();
    }
    ctx.strokeStyle = '#ffb36b';
    for (const m of hole.movers || []) {
      const { x, y } = moverPos(m);
      ctx.beginPath();
      if (m.vertical) { ctx.moveTo(x, y - m.len / 2); ctx.lineTo(x, y + m.len / 2); } else { ctx.moveTo(x - m.len / 2, y); ctx.lineTo(x + m.len / 2, y); }
      ctx.stroke();
    }

    // Cup and flag.
    const [cx, cy] = cup;
    ctx.fillStyle = '#0d1a10';
    ctx.beginPath();
    ctx.arc(cx, cy, CUP_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#eceef2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - 46);
    ctx.stroke();
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 46);
    ctx.lineTo(cx + 24 + Math.sin(time * 4) * 3, cy - 39);
    ctx.lineTo(cx, cy - 32);
    ctx.fill();

    // Aim guide.
    if (state === 'aim') {
      const shot = drag ? dragShot() : { power: keyPower, angle: keyAim };
      const len = 40 + shot.power * 160;
      ctx.strokeStyle = `rgba(255,255,255,${drag ? 0.8 : 0.45})`;
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(ball.x + Math.cos(shot.angle) * len, ball.y + Math.sin(shot.angle) * len);
      ctx.stroke();
      ctx.setLineDash([]);
      // Power meter beside the ball.
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(ball.x + 16, ball.y - 30, 8, 60);
      ctx.fillStyle = shot.power > 0.8 ? '#ff6b6b' : shot.power > 0.5 ? '#ffd23f' : '#9be37a';
      ctx.fillRect(ball.x + 16, ball.y + 30 - 60 * shot.power, 8, 60 * shot.power);
    }

    // Ball and trail.
    for (let i = 0; i < trail.length; i++) {
      ctx.globalAlpha = (i / trail.length) * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(trail[i][0], trail[i][1], BALL_R * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (ball.scale > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(ball.x + 2, ball.y + 3, BALL_R * ball.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R * ball.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of sparks) {
      p.x += p.vx / 60;
      p.y += p.vy / 60;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= 1 / 60;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    sparks = sparks.filter(p => p.life > 0);

    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.4);
      ctx.fillStyle = p.color;
      ctx.font = `800 ${p.big ? 24 : 15}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - p.t * 30);
    }
    ctx.globalAlpha = 1;

    // Header.
    ctx.textAlign = 'left';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillStyle = '#eceef2';
    ctx.fillText(`Hole ${holeIdx + 1} · ${hole.name}`, 14, 26);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillStyle = '#8d94a1';
    ctx.fillText(`Par ${hole.par} · stroke ${strokes}${strokes >= MAX_STROKES - 2 ? ` (pick up at ${MAX_STROKES})` : ''}`, 14, 46);
    ctx.textAlign = 'right';
    ctx.fillText(`Round ${fmtPar(toPar())} · ${totalStrokes()} strokes`, W - 14, 26);
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`★ ${stars}/${course.length}${starTaken ? ' ✓' : ''}`, W - 14, 46);

    if (banner && banner.t > 0 && state !== 'over') {
      ctx.globalAlpha = Math.min(1, banner.t / 0.4);
      ctx.textAlign = 'center';
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(banner.text, W / 2, H / 2 - 4);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(banner.sub, W / 2, H / 2 + 20);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state !== 'paused' && state !== 'menu' && state !== 'over') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  state = 'menu';
  Versus.attach({
    ui,
    start,
    score: () => score(),
    intro: {
      title: 'Putt Planet',
      html: menuHtml(),
      button: `Tee off: ${COURSES.find(c => c.id === courseId).name}`,
      onAction: start,
      onRender: wireMenu,
    },
  });
  requestAnimationFrame(frame);
})();
