(() => {
  const W = 960, H = 540;
  const DAYS = 14;
  const DAY_SECONDS = 30;
  const BATCH = 20;
  const QUEUE_MAX = 8, PATIENCE = 9;
  const SIDEWALK = 430, TRUCK_X = 480;
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const WEATHER = [
    { id: 'sunny', name: 'Sunny', traffic: 1.1, beach: 1.6, icon: '#ffd54f' },
    { id: 'cloudy', name: 'Cloudy', traffic: 0.95, beach: 0.8, icon: '#b0bec5' },
    { id: 'rainy', name: 'Rainy', traffic: 0.6, beach: 0.3, icon: '#4fc3f7' },
    { id: 'heat', name: 'Heatwave', traffic: 0.85, beach: 2.0, icon: '#ff7043' },
  ];
  // weekday / weekend: how busy each spot is on those days.
  const PLACES = [
    { id: 'park', name: 'Park', rent: 20, traffic: 70, fair: 4.5, weekday: 0.85, weekend: 1.4, sky: '#7cb87a', ground: '#4f8a4c' },
    { id: 'downtown', name: 'Downtown', rent: 50, traffic: 95, fair: 6, weekday: 1.15, weekend: 0.6, sky: '#8fa3b8', ground: '#5d6470' },
    { id: 'beach', name: 'Beach', rent: 35, traffic: 70, fair: 5.5, weekday: 0.9, weekend: 1.35, sky: '#7ec8e3', ground: '#e6cf8f' },
    { id: 'campus', name: 'Campus', rent: 15, traffic: 70, fair: 4, weekday: 1.2, weekend: 0.45, sky: '#b0a4d8', ground: '#7a6f9a' },
    { id: 'stadium', name: 'Stadium', rent: 70, traffic: 35, fair: 7, weekday: 0.8, weekend: 1.1, sky: '#9fb5c9', ground: '#55606e' },
  ];
  const EVENTS = [
    { text: 'No events in town today.', place: null, boost: 1 },
    { text: 'Soccer final at the park! Big crowds expected.', place: 'park', boost: 1.8 },
    { text: 'Office lunch rush downtown.', place: 'downtown', boost: 1.6 },
    { text: 'Surf contest at the beach!', place: 'beach', boost: 1.8 },
    { text: 'Street fair downtown.', place: 'downtown', boost: 1.9 },
    { text: 'Exams are over: campus is celebrating!', place: 'campus', boost: 1.9 },
    { text: 'Big game at the stadium tonight!', place: 'stadium', boost: 4.2 },
    { text: 'A food critic is touring the trucks. Fast service at fair prices will impress.', place: null, boost: 1, critic: true },
    { text: 'A rival truck is parked at the {place}, charging ${price}.', place: null, boost: 1, rival: true },
  ];
  // Menu: main dishes people crave, plus horchata that rides along with orders.
  const ITEMS = [
    { id: 'taco', name: 'Tacos', unlock: 0, batch: 16, cook: 1, fair: 1, price: 5, crave: { base: 1 } },
    { id: 'burrito', name: 'Burritos', unlock: 200, batch: 30, cook: 1.6, fair: 1.7, price: 9, crave: { base: 0.7, downtown: 1.5, campus: 1.4, stadium: 1.3, rainy: 1.3 } },
    { id: 'churro', name: 'Churros', unlock: 150, batch: 8, cook: 0.5, fair: 0.6, price: 3, crave: { base: 0.6, beach: 1.6, park: 1.4, heat: 1.3, sunny: 1.2 } },
    { id: 'horchata', name: 'Horchata', unlock: 120, batch: 10, cook: 0, fair: 0.55, price: 3, addon: true },
  ];
  const UPGRADES = [
    { id: 'grill', name: 'Double grill', cost: 150, desc: 'Cook 50% faster' },
    { id: 'sign', name: 'Neon sign', cost: 120, desc: '+20% people stop to look' },
    { id: 'salsa', name: 'Salsa bar', cost: 100, desc: 'Customers happily pay $1 more' },
    { id: 'cook', name: 'Hire a cook', cost: 220, desc: 'Cook twice as fast · $20/day wage' },
    { id: 'cooler', name: 'Big cooler', cost: 90, desc: 'Leftovers stay fresh overnight' },
    { id: 'awning', name: 'Awning', cost: 80, desc: 'Rain scares off far fewer people' },
    { id: 'loyalty', name: 'Loyalty cards', cost: 160, desc: 'Regulars come back: +15% traffic' },
    { id: 'window', name: 'Second window', cost: 380, desc: 'Serve two orders at once' },
    { id: 'van', name: 'Delivery bike', cost: 260, desc: 'Sell 15% of leftovers each night' },
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';    // 'plan' | 'day' | 'report' | 'over'
  let biz;               // the business across all days
  let plan;              // today's choices
  let day;               // today's simulation
  let buttons = [];

  function newGame() {
    biz = {
      day: 1, cash: 150, rep: 30, owned: {}, unlocked: { taco: true }, served: 0, endless: false, seasonScore: 0,
      stock: Object.fromEntries(ITEMS.map(i => [i.id, 0])),
    };
    rollForecast();
  }

  function rollForecast() {
    const w = Arcade.pick(WEATHER);
    let ev = Math.random() < 0.5 ? { ...Arcade.pick(EVENTS.slice(1)) } : EVENTS[0];
    if (ev.rival) {
      const p = Arcade.pick(PLACES.slice(0, 4));
      ev = { ...ev, rivalAt: p.id, rivalPrice: Math.max(2, Math.round(p.fair - 1)), text: ev.text.replace('{place}', p.name).replace('{price}', Math.max(2, Math.round(p.fair - 1))) };
    }
    const keep = plan || {};
    plan = {
      weather: w, event: ev, place: keep.place ?? 0, ads: false,
      price: keep.price || Object.fromEntries(ITEMS.map(i => [i.id, i.price])),
      batches: keep.batches || Object.fromEntries(ITEMS.map(i => [i.id, i.id === 'taco' ? 2 : 0])),
    };
  }

  // ---------- Economics ----------

  const place = () => PLACES[plan.place];
  const weekday = () => WEEKDAYS[(biz.day - 1) % 7];
  const weekend = () => ['Sat', 'Sun'].includes(weekday());
  const item = id => ITEMS.find(i => i.id === id);
  const onMenu = () => ITEMS.filter(i => biz.unlocked[i.id]);
  const fairPrice = id => item(id).fair * (place().fair + (biz.owned.salsa ? 1 : 0) + (plan.weather.id === 'heat' && place().id === 'beach' ? 1 : 0) + biz.rep / 50);
  const stockCost = () => onMenu().reduce((t, i) => t + plan.batches[i.id] * i.batch, 0);
  const dayCosts = () => place().rent + stockCost() + (plan.ads ? 30 : 0) + (biz.owned.cook ? 20 : 0);
  const serveTime = id => 1.3 * item(id).cook / (biz.owned.grill ? 1.5 : 1) / (biz.owned.cook ? 2 : 1);
  const lanes = () => (biz.owned.window ? 2 : 1);

  function expectedTraffic() {
    const p = place();
    let t = p.traffic * (weekend() ? p.weekend : p.weekday);
    const w = plan.weather;
    t *= w.id === 'rainy' && biz.owned.awning ? 0.85 : w.traffic;
    if (p.id === 'beach') t *= w.beach;
    if (plan.event.place === p.id) t *= plan.event.boost;
    t *= 0.7 + biz.rep / 100;
    if (plan.ads) t *= 1.3;
    if (biz.owned.loyalty) t *= 1.15;
    return Math.round(t);
  }

  // How likely someone is to buy an item: falls off quickly once you charge more than they expect,
  // and a cheaper rival truck nearby steals some of them.
  function buyChance(id) {
    const fair = fairPrice(id), price = plan.price[id];
    const over = (price - fair) / fair;
    let appeal = 0.55 * (biz.owned.sign ? 1.2 : 1);
    if (plan.event.rivalAt === place().id && id !== 'horchata') appeal *= price > plan.event.rivalPrice * item(id).fair ? 0.55 : 1.05;
    return Math.max(0.02, Math.min(0.95, appeal * (over <= 0 ? 1 - over * 0.6 : 1 - over * 1.8)));
  }

  function craving() {
    const mains = ITEMS.filter(i => !i.addon);
    const weights = mains.map(i => (i.crave.base || 1) * (i.crave[place().id] || 1) * (i.crave[plan.weather.id] || 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let k = 0; k < mains.length; k++) if ((r -= weights[k]) <= 0) return mains[k].id;
    return 'taco';
  }

  const available = id => biz.unlocked[id] && biz.stock[id] - day.reserved[id] > 0;

  // ---------- Day simulation ----------

  function openShop() {
    if (biz.cash < dayCosts()) return;
    biz.cash -= dayCosts();
    for (const i of onMenu()) biz.stock[i.id] += plan.batches[i.id] * BATCH;
    day = {
      t: 0, people: [], queue: [], cooking: [0, 0], serving: [null, null], sold: {}, revenue: 0, walked: 0, angry: 0, soldOut: 0,
      reserved: Object.fromEntries(ITEMS.map(i => [i.id, 0])),
      spawnEvery: DAY_SECONDS / Math.max(1, expectedTraffic()), spawnT: 0, costs: dayCosts(), repStart: biz.rep, critic: plan.event.critic ? { served: 0, slow: 0, pricey: 0 } : null,
      rain: plan.weather.id === 'rainy' ? Array.from({ length: 80 }, () => ({ x: Math.random() * W, y: Math.random() * H })) : null,
    };
    state = 'day';
    Arcade.tone({ freq: 392, to: 784, dur: 0.2, type: 'triangle', vol: 0.05 });
  }

  function spawnPerson() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    day.people.push({
      x: dir > 0 ? -20 : W + 20, dir, speed: Arcade.rand(55, 85), decided: false, inQueue: false, wait: 0, mood: null, moodT: 0,
      color: Arcade.pick(['#ef9a9a', '#90caf9', '#a5d6a7', '#ffe082', '#ce93d8', '#ffab91', '#80cbc4']),
      // Looks only: rolled from Gfx.rand so duels' seeded Math.random isn't disturbed.
      skin: SKIN[Math.floor(Gfx.rand(0, SKIN.length))], hair: HAIR[Math.floor(Gfx.rand(0, HAIR.length))],
      pants: PANTS[Math.floor(Gfx.rand(0, PANTS.length))], tall: Gfx.rand(0.9, 1.12), seed: Gfx.rand(0, 10),
    });
  }

  function decide(p) {
    // They want something; if it's not on today's menu they might settle for something else.
    const want = craving();
    let pick = null;
    if (available(want) && Math.random() < buyChance(want)) pick = want;
    else {
      const alts = onMenu().filter(i => !i.addon && i.id !== want && available(i.id));
      for (const a of alts) if (Math.random() < buyChance(a.id) * 0.6) { pick = a.id; break; }
    }
    if (!pick) {
      const anyStock = onMenu().some(i => !i.addon && available(i.id));
      if (!anyStock && Math.random() < 0.5) {
        p.mood = '❌';
        p.moodT = 1.2;
        day.soldOut++;
        biz.rep = Math.max(0, biz.rep - 0.4);
      } else if (plan.price[want] > fairPrice(want) + 1) {
        p.mood = '💸';
        p.moodT = 1;
      }
      return;
    }
    if (day.queue.length >= QUEUE_MAX) {
      p.mood = '😒';
      p.moodT = 1.2;
      biz.rep = Math.max(0, biz.rep - 0.3);
      return;
    }
    p.order = pick;
    // A drink on the side?
    const drinkChance = { heat: 0.6, sunny: 0.4, cloudy: 0.25, rainy: 0.1 }[plan.weather.id];
    if (available('horchata') && Math.random() < drinkChance * (buyChance('horchata') / 0.55)) {
      p.drink = true;
      day.reserved.horchata++;
    }
    day.reserved[pick]++;
    p.inQueue = true;
    day.queue.push(p);
  }

  function tickDay(dt) {
    day.t += dt;
    if (day.t < DAY_SECONDS) {
      day.spawnT -= dt;
      while (day.spawnT <= 0) {
        day.spawnT += day.spawnEvery * Arcade.rand(0.5, 1.5);
        spawnPerson();
      }
    }

    for (const p of day.people) {
      p.moodT = Math.max(0, p.moodT - dt);
      if (p.inQueue) {
        if (p.beingServed) continue;
        p.wait += dt;
        if (p.wait > PATIENCE) {
          // Waited too long: storms off.
          p.inQueue = false;
          day.queue = day.queue.filter(q => q !== p);
          day.reserved[p.order]--;
          if (p.drink) day.reserved.horchata--;
          p.mood = '😠';
          p.moodT = 1.5;
          day.angry++;
          if (day.critic) day.critic.slow++;
          biz.rep = Math.max(0, biz.rep - 1);
        }
        continue;
      }
      p.x += p.dir * p.speed * dt;
      if (!p.decided && Math.abs(p.x - TRUCK_X) < 30) {
        p.decided = true;
        day.walked++;
        decide(p);
      }
    }

    // Queue positions: line up to the right of the truck window.
    day.queue.forEach((p, i) => { p.x += ((TRUCK_X + 80 + i * 30) - p.x) * Math.min(1, dt * 6); });

    // Each window cooks the next order in line.
    for (let w = 0; w < lanes(); w++) {
      if (!day.serving[w]) {
        const next = day.queue.find(p => !p.beingServed);
        if (next) {
          next.beingServed = true;
          day.serving[w] = next;
          day.cooking[w] = 0;
        }
      }
      const p = day.serving[w];
      if (!p) continue;
      day.cooking[w] += dt;
      if (day.cooking[w] >= serveTime(p.order)) serve(w);
    }

    day.people = day.people.filter(p => p.inQueue || (p.x > -40 && p.x < W + 40));
    if (day.t >= DAY_SECONDS && !day.queue.length) endDay();
    else if (day.t >= DAY_SECONDS + 8) endDay();
  }

  function serve(w) {
    const p = day.serving[w];
    day.serving[w] = null;
    day.cooking[w] = 0;
    day.queue = day.queue.filter(q => q !== p);
    p.inQueue = false;
    p.dir = 1;
    const fair = plan.price[p.order] <= fairPrice(p.order);
    p.mood = fair ? '😋' : '🙂';
    p.moodT = 1.5;
    let paid = plan.price[p.order];
    biz.stock[p.order]--;
    day.reserved[p.order]--;
    day.sold[p.order] = (day.sold[p.order] || 0) + 1;
    if (p.drink) {
      biz.stock.horchata--;
      day.reserved.horchata--;
      day.sold.horchata = (day.sold.horchata || 0) + 1;
      paid += plan.price.horchata;
    }
    biz.served++;
    day.revenue += paid;
    biz.cash += paid;
    biz.rep = Math.min(100, biz.rep + (fair ? 0.35 : 0.1));
    servedFx(paid);
    if (day.critic) {
      day.critic.served++;
      if (!fair) day.critic.pricey++;
    }
    Arcade.tone({ freq: 880, to: 1320, dur: 0.06, type: 'triangle', vol: 0.03 });
  }

  // Tapping the truck makes the cooks hurry.
  function hurry() {
    if (state !== 'day') return;
    let any = false;
    for (let w = 0; w < lanes(); w++) {
      const p = day.serving[w];
      if (!p) continue;
      any = true;
      day.cooking[w] += serveTime(p.order) * 0.15;
      if (day.cooking[w] >= serveTime(p.order)) serve(w);
    }
    if (any) { Arcade.tone({ freq: 300, dur: 0.03, vol: 0.02 }); hurryFx(); }
  }

  function endDay() {
    state = 'report';
    const notes = [];
    // The delivery bike sells some leftovers at half price; the rest spoils unless you have the cooler.
    let delivered = 0;
    if (biz.owned.van) {
      for (const i of onMenu()) {
        const n = Math.floor(biz.stock[i.id] * 0.15);
        biz.stock[i.id] -= n;
        delivered += n * plan.price[i.id] * 0.5;
      }
      delivered = Math.round(delivered);
      biz.cash += delivered;
      day.revenue += delivered;
    }
    let spoiled = 0;
    if (!biz.owned.cooler) for (const i of ITEMS) {
      const n = Math.ceil(biz.stock[i.id] / 2);
      biz.stock[i.id] -= n;
      spoiled += n;
    }
    const profit = day.revenue - day.costs;
    if (profit >= 300) Arcade.flag('taco-tycoon-300');
    if (profit >= 600) Arcade.flag('taco-tycoon-600');
    if (place().id === 'stadium' && plan.event.place === 'stadium' && profit >= 400) Arcade.flag('taco-tycoon-stadium');

    if (day.critic) {
      const c = day.critic;
      const good = c.served >= 10 && c.slow <= 2 && c.pricey <= c.served * 0.3;
      biz.rep = Math.max(0, Math.min(100, biz.rep + (good ? 10 : -6)));
      notes.push(good ? 'The food critic loved it! Reputation +10.' : 'The food critic was not impressed. Reputation −6.');
    }
    const repDelta = Math.round(biz.rep - day.repStart);
    if (day.soldOut > 2) notes.push(`${day.soldOut} hungry customers found nothing left. Buy more stock.`);
    if (day.angry > 2) notes.push(`${day.angry} people gave up waiting. A faster kitchen would help.`);
    if (day.walked > 10 && biz.served && Object.values(day.sold).reduce((a, b) => a + b, 0) / day.walked < 0.2) notes.push('Most people walked past. Your prices may be too high, or they wanted something you don\'t sell.');
    if (spoiled > 5) notes.push(`${spoiled} leftovers went bad overnight.`);
    if (delivered) notes.push(`Your delivery bike sold leftovers for $${delivered}.`);

    if (!biz.endless && biz.day >= DAYS) return finishSeason(profit);
    // A season takes a while and isn't saved, so each day's closing cash counts as a score too.
    Arcade.submitScore(Arcade.gameId, Math.max(0, Math.round(biz.cash)));
    const soldList = onMenu().map(i => `${day.sold[i.id] || 0} ${i.name.toLowerCase()}`).join(', ');
    ui.show({
      title: `Day ${biz.day} report`,
      html: `<p class="big" style="color:${profit >= 0 ? '#9be37a' : '#ff7a7a'}">${profit >= 0 ? '+' : '−'}$${Math.abs(Math.round(profit))}</p>
        <ul>
          <li>Sold ${soldList} for <b>$${Math.round(day.revenue)}</b></li>
          <li>Costs <b>$${day.costs}</b> (rent, stock${plan.ads ? ', ads' : ''}${biz.owned.cook ? ', wages' : ''})</li>
          <li>Reputation <b>${Math.round(biz.rep)}</b> (${repDelta >= 0 ? '+' : ''}${repDelta})</li>
          <li>Cash <b>$${Math.round(biz.cash)}</b></li>
        </ul>
        ${notes.map(n => `<p>${n}</p>`).join('')}`,
      button: 'Next day',
      onAction: nextDay,
    });
  }

  function nextDay() {
    biz.day++;
    rollForecast();
    // Out of money and nothing worth opening for: the truck closes.
    if (biz.cash < place().rent && PLACES.every(p => biz.cash < p.rent)) return bankrupt();
    state = 'plan';
    ui.hide();
  }

  function finishSeason(profit) {
    state = 'over';
    const score = Math.max(0, Math.round(biz.cash));
    biz.seasonScore = score;
    if (biz.cash >= 2000) Arcade.flag('taco-tycoon-mogul');
    Arcade.finish(ui, {
      score,
      title: 'Season over!',
      lines: [`Final day ${profit >= 0 ? 'profit' : 'loss'}: $${Math.abs(Math.round(profit))}`, `${biz.served} orders served · reputation ${Math.round(biz.rep)}`, 'Your score is the cash you ended with. Keep the truck running in endless mode, or start a new season.'],
      button: 'Keep the truck running',
      onAction: () => {
        biz.endless = true;
        nextDay();
      },
    });
  }

  function retire() {
    state = 'over';
    const score = Math.max(0, Math.round(biz.cash));
    if (biz.day >= 30) Arcade.flag('taco-tycoon-veteran');
    Arcade.finish(ui, {
      score,
      title: 'Retired!',
      lines: [`You ran the truck for ${biz.day - 1} days and retired with $${score}.`, `${biz.served} orders served · reputation ${Math.round(biz.rep)}`],
      button: 'New season',
      onAction: start,
    });
  }

  function bankrupt() {
    state = 'over';
    Arcade.finish(ui, {
      score: biz.seasonScore,
      title: 'Out of business',
      lines: [`You ran out of cash on day ${biz.day}.`, `Your season score of $${biz.seasonScore} still counts.`],
      button: 'New season',
      onAction: start,
    });
  }

  function start() {
    plan = null;
    newGame();
    state = 'plan';
    ui.hide();
  }

  // ---------- Input ----------

  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    if (state === 'day') {
      if (Math.abs(px - TRUCK_X) < 110 && py > 260 && py < 460) hurry();
      return;
    }
    if (state !== 'plan') return;
    for (const b of buttons) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        if (b.enabled) {
          b.onClick();
          Arcade.tone({ freq: 600, dur: 0.03, vol: 0.02 });
        }
        return;
      }
    }
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && state === 'day') { e.preventDefault(); hurry(); }
  });

  // ---------- Effects ----------
  // Purely cosmetic, and they roll Gfx.rand (never Math.random) so online duels stay in sync.

  const fx = Gfx.particles(500);
  const pops = Gfx.floaters();
  let time = 0, squash = 0, steamT = 0;
  const clouds = Array.from({ length: 6 }, (_, i) => ({ x: i * 190 + Gfx.rand(0, 120), y: Gfx.rand(30, 130), s: Gfx.rand(0.6, 1.2), v: Gfx.rand(6, 14) }));
  const SKIN = ['#f6d1b0', '#e9b48a', '#c98b5e', '#a8693f', '#7c4a2a', '#f2c7a0'];
  const HAIR = ['#2b1d14', '#4a3020', '#7a4a22', '#d9a54a', '#1c1c1c', '#a0522d', '#c0c0c0'];
  const PANTS = ['#34495e', '#2c3e50', '#5d4037', '#455a64', '#1a237e', '#6d4c41'];
  const money = n => `$${n % 1 ? n.toFixed(2) : n}`;

  function updateFx(dt) {
    time += dt;
    squash = Math.max(0, squash - dt * 6);
    fx.update(dt);
    pops.update(dt);
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > W + 120) { c.x = -160; c.y = Gfx.rand(30, 130); }
    }
    if (state === 'day' && day) {
      steamT -= dt;
      const busy = day.serving.some(Boolean);
      if (steamT <= 0) {
        steamT = busy ? 0.07 : 0.4;
        fx.emit({ x: TRUCK_X + 62 + Gfx.rand(-4, 4), y: SIDEWALK - 196, vx: Gfx.rand(-6, 10), vy: Gfx.rand(-40, -25), drag: 0.4, life: 1.6, size: 4, grow: 9, color: busy ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)' });
      }
      if (day.rain) for (let i = 0; i < 3; i++) {
        fx.emit({ x: Gfx.rand(0, W), y: Gfx.rand(SIDEWALK - 10, H), vx: 0, vy: 0, life: 0.25, size: 1.5, grow: 10, color: 'rgba(210,225,255,0.35)' });
      }
    }
  }

  function servedFx(paid) {
    pops.add('+' + money(paid), TRUCK_X + 150 + Gfx.rand(-10, 10), SIDEWALK - 130, { color: '#9be37a', size: 20 });
    for (let i = 0; i < 6; i++) {
      fx.emit({ x: TRUCK_X + 50, y: SIDEWALK - 70, z: 0, vx: Gfx.rand(-60, 90), vy: Gfx.rand(-10, 10), vz: Gfx.rand(120, 220), g: 520, life: 0.8, size: 3.5, color: i % 2 ? '#ffd23f' : '#ffe98a' });
    }
  }

  function hurryFx() {
    squash = 1;
    for (let i = 0; i < 5; i++) {
      fx.emit({ x: TRUCK_X + Gfx.rand(-30, 50), y: SIDEWALK - 92, vx: Gfx.rand(-90, 90), vy: Gfx.rand(-140, -60), drag: 2, life: 0.4, size: 2, color: i % 2 ? '#ffb347' : '#ffdd55', shape: 'spark' });
    }
  }

  // ---------- Drawing ----------

  let mouse = null;
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    mouse = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  });
  canvas.addEventListener('pointerleave', () => { mouse = null; });
  const over = (x, y, w, h) => mouse && mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;

  function button(x, y, w, h, text, { enabled = true, active = false, primary = false, sub = '', onClick, size = 14 }) {
    const hov = enabled && over(x, y, w, h);
    const lift = hov ? -1 : 0;
    y += lift;
    ctx.save();
    if (enabled) {
      ctx.shadowColor = primary ? 'rgba(255,150,40,0.45)' : 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = primary ? 18 : hov ? 10 : 6;
      ctx.shadowOffsetY = 3;
    }
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    if (primary) { g.addColorStop(0, hov ? '#ffc65c' : '#ffb547'); g.addColorStop(1, '#f0841f'); }
    else if (active) { g.addColorStop(0, '#4b3b1b'); g.addColorStop(1, '#33280f'); }
    else if (enabled) { g.addColorStop(0, hov ? '#353d4d' : '#2b313d'); g.addColorStop(1, hov ? '#272d39' : '#20252e'); }
    else { g.addColorStop(0, '#1c1f26'); g.addColorStop(1, '#17191f'); }
    ctx.fillStyle = g;
    Gfx.roundRect(ctx, x, y, w, h, 9);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = primary ? 'rgba(255,240,200,0.6)' : active ? '#ffc53d' : 'rgba(255,255,255,0.07)';
    ctx.lineWidth = active && !primary ? 2 : 1;
    Gfx.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 9);
    ctx.stroke();
    if (enabled && !primary) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      Gfx.roundRect(ctx, x + 2, y + 2, w - 4, h * 0.45, 7);
      ctx.fill();
    }
    ctx.fillStyle = primary ? '#3a1d00' : enabled ? '#eceef2' : '#5c6370';
    ctx.font = `${primary ? 800 : 600} ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x + w / 2, y + (sub ? h / 2 - 2 : h / 2 + 5));
    if (sub) {
      ctx.fillStyle = primary ? 'rgba(58,29,0,0.75)' : enabled ? '#8d94a1' : '#4a505b';
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText(sub, x + w / 2, y + h / 2 + 13, w - 8);
    }
    buttons.push({ x, y: y - lift, w, h, enabled, onClick });
  }

  function label(text, x, y, { size = 13, color = '#8d94a1', weight = 600, align = 'left', max } = {}) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y, max);
  }

  function cloud(x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [dx, dy, r] of [[0, 0, 22], [24, -10, 26], [50, 0, 20], [26, 6, 22]]) {
      ctx.moveTo(x + dx * s + r * s, y + dy * s);
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function weatherIcon(x, y, id, r) {
    if (id === 'sunny' || id === 'heat') {
      const c = id === 'heat' ? '#ff7043' : '#ffd54f';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * 0.5);
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); ctx.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15); ctx.stroke();
      }
      ctx.restore();
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 1, x, y, r * 0.65);
      g.addColorStop(0, Gfx.shade(c, 0.4));
      g.addColorStop(1, c);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (id === 'rainy') {
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const k = (time * 1.5 + i / 3) % 1;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.moveTo(x - 8 + i * 8, y + 4 + k * 10); ctx.lineTo(x - 10 + i * 8, y + 9 + k * 10); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    cloud(x - r * 0.75, y - 2, r / 34, id === 'rainy' ? '#90a4ae' : '#cfd8dc');
  }

  function drawPlan() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a1f29');
    bg.addColorStop(1, '#11141a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(140, 40, 10, 140, 40, 420);
    glow.addColorStop(0, 'rgba(255,140,60,0.10)');
    glow.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    // Panel behind the right-hand shop.
    Gfx.card(ctx, 488, 12, 460, 424, { fill: 'rgba(255,255,255,0.025)', r: 14, edge: 'rgba(255,255,255,0.05)' });

    label(`${weekday()} · Day ${biz.day}${biz.endless ? ' (endless)' : ` of ${DAYS}`}`, 30, 36, { size: 21, color: '#eceef2', weight: 700 });
    label(`Cash $${Math.round(biz.cash)} · Reputation ${Math.round(biz.rep)}/100${weekend() ? ' · Weekend: parks and beaches fill up' : ''}`, 30, 58, { max: 440 });

    // Forecast.
    Gfx.card(ctx, 30, 70, 440, 58, { fill: '#1f2531', r: 12 });
    weatherIcon(60, 99, plan.weather.id, 17);
    label(`Forecast: ${plan.weather.name}`, 88, 92, { color: '#eceef2', size: 14 });
    label(plan.event.text, 88, 113, { size: 11, color: plan.event.place || plan.event.critic || plan.event.rival ? '#ffc53d' : '#8d94a1', max: 374 });

    label('Where to park', 30, 150, { color: '#eceef2' });
    PLACES.forEach((p, i) => {
      const x = 30 + i * 89;
      button(x, 158, 84, 44, p.name, { active: plan.place === i, sub: `$${p.rent} rent`, size: 13, onClick: () => { plan.place = i; } });
      // A little strip of the spot's scenery along the top of its button.
      const g = ctx.createLinearGradient(0, 161, 0, 167);
      g.addColorStop(0, p.sky);
      g.addColorStop(1, p.ground);
      ctx.fillStyle = g;
      Gfx.roundRect(ctx, x + 6, 161, 72, 5, 2.5);
      ctx.fill();
      if (plan.event.place === p.id) { ctx.fillStyle = '#ffc53d'; ctx.beginPath(); ctx.arc(x + 76, 166, 4, 0, Math.PI * 2); ctx.fill(); }
    });

    // Menu: price and stock per item.
    label('Menu', 30, 226, { color: '#eceef2' });
    label('Price', 196, 226, { size: 11, align: 'center' });
    label('Stock to buy', 352, 226, { size: 11, align: 'center' });
    const icons = { taco: '🌮', burrito: '🌯', churro: '🥖', horchata: '🥤' };
    onMenu().forEach((it, k) => {
      const y = 234 + k * 44;
      ctx.fillStyle = k % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)';
      Gfx.roundRect(ctx, 24, y - 3, 452, 42, 8);
      ctx.fill();
      label(icons[it.id], 30, y + 26, { size: 18, color: '#fff' });
      label(it.name, 56, y + 18, { color: '#eceef2', size: 14, max: 66 });
      label(`${biz.stock[it.id]} left`, 56, y + 34, { size: 11 });
      button(126, y, 32, 36, '−', { enabled: plan.price[it.id] > 0.5, onClick: () => { plan.price[it.id] = Math.max(0.5, plan.price[it.id] - 0.5); } });
      const fp = fairPrice(it.id), pr = plan.price[it.id];
      label(`$${pr.toFixed(2)}`, 196, y + 18, { size: 16, color: '#eceef2', weight: 700, align: 'center' });
      label(pr <= fp - 1 ? 'bargain' : pr <= fp ? 'fair' : pr <= fp + 1.5 ? 'pricey' : 'too much', 196, y + 33, { size: 10, align: 'center', color: pr <= fp ? '#9be37a' : pr <= fp + 1.5 ? '#ffc53d' : '#ff7a7a' });
      button(234, y, 32, 36, '+', { enabled: pr < 20, onClick: () => { plan.price[it.id] = Math.min(20, pr + 0.5); } });
      button(284, y, 32, 36, '−', { enabled: plan.batches[it.id] > 0, onClick: () => { plan.batches[it.id]--; } });
      label(`${plan.batches[it.id] * BATCH}`, 352, y + 18, { size: 16, color: '#eceef2', weight: 700, align: 'center' });
      label(`$${plan.batches[it.id] * it.batch}`, 352, y + 33, { size: 10, align: 'center' });
      button(388, y, 32, 36, '+', { enabled: plan.batches[it.id] < 20, onClick: () => { plan.batches[it.id]++; } });
      if (it.addon) label('with orders', 428, y + 22, { size: 10 });
    });

    const adsY = 234 + onMenu().length * 44 + 6;
    button(30, adsY, 170, 34, plan.ads ? 'Ads booked ✓' : 'Book ads ($30)', { active: plan.ads, size: 13, onClick: () => { plan.ads = !plan.ads; } });
    label(`~${expectedTraffic()} people will pass by`, 214, adsY + 22, { size: 12 });
    if (biz.endless) button(360, adsY, 110, 34, 'Retire', { size: 13, sub: '', onClick: retire });

    // Upgrades and new menu items.
    label('Upgrades & menu', 500, 36, { size: 17, color: '#eceef2', weight: 700 });
    const shop = [
      ...ITEMS.filter(i => i.unlock).map(i => ({ id: i.id, name: `Add ${i.name}`, cost: i.unlock, desc: i.addon ? 'Sold alongside orders, great in the heat' : `Cook ${i.cook > 1 ? 'slower' : 'faster'}, sell ${i.fair > 1 ? 'pricier' : 'cheaper'}`, have: biz.unlocked[i.id], buy: () => { biz.unlocked[i.id] = true; } })),
      ...UPGRADES.map(u => ({ ...u, have: biz.owned[u.id], buy: () => { biz.owned[u.id] = true; } })),
    ];
    shop.forEach((u, i) => {
      const x = 500 + (i % 2) * 218, y = 48 + Math.floor(i / 2) * 50;
      button(x, y, 212, 45, u.have ? `${u.name} ✓` : `${u.name} · $${u.cost}`, {
        enabled: !u.have && biz.cash - dayCosts() >= u.cost,
        active: u.have,
        sub: u.desc,
        size: 13,
        onClick: () => {
          biz.cash -= u.cost;
          u.buy();
          pops.add(`−$${u.cost}`, x + 106, y + 10, { color: '#ffc53d', size: 16 });
          Arcade.tone({ freq: 523, to: 1046, dur: 0.2, type: 'triangle', vol: 0.05 });
        },
      });
    });

    const costs = dayCosts();
    const can = biz.cash >= costs;
    button(500, 448, 430, 66, can ? 'Open for business!' : 'Not enough cash', {
      enabled: can, primary: can, sub: `Today costs $${costs}: rent $${place().rent}, stock $${stockCost()}${plan.ads ? ', ads $30' : ''}${biz.owned.cook ? ', wages $20' : ''}`,
      onClick: openShop,
    });
    if (!can) label('Buy less stock or pick a cheaper spot.', 715, 532, { size: 12, color: '#ff7a7a', align: 'center' });
    pops.draw(ctx);
    canvas.style.cursor = buttons.some(b => b.enabled && over(b.x, b.y, b.w, b.h)) ? 'pointer' : '';
  }

  // ---------- Day scene ----------

  function tree(x, y, r, leaf) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(x + 6, y + 40, r * 0.9, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6b4f2e';
    ctx.fillRect(x - 4, y, 8, 42);
    ctx.fillStyle = Gfx.shade(leaf, -0.2);
    ctx.beginPath(); ctx.arc(x, y - 4, r, 0, Math.PI * 2); ctx.arc(x - r * 0.6, y + 6, r * 0.7, 0, Math.PI * 2); ctx.arc(x + r * 0.6, y + 6, r * 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = leaf;
    ctx.beginPath(); ctx.arc(x - r * 0.15, y - 8, r * 0.8, 0, Math.PI * 2); ctx.arc(x - r * 0.65, y + 3, r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = Gfx.shade(leaf, 0.2);
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.45, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }

  function hills(y, amp, freq, phase, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, SIDEWALK);
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, y - Math.sin(x * freq + phase) * amp - Math.sin(x * freq * 2.3 + phase * 2) * amp * 0.4);
    ctx.lineTo(W, SIDEWALK);
    ctx.fill();
  }

  function backdrop(p) {
    const r = Gfx.rng(p.rent * 7 + 3);
    if (p.id === 'downtown') {
      for (let i = 0; i < 12; i++) {
        const bh = 140 + r() * 160, bx = i * 84 - 20;
        ctx.fillStyle = Gfx.mix(p.sky, '#4a5466', 0.45);
        ctx.fillRect(bx, SIDEWALK - 40 - bh - 30, 80, bh + 30);
      }
      for (let i = 0; i < 9; i++) {
        const bh = 110 + r() * 140, bx = i * 110, bw = 100;
        const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        g.addColorStop(0, i % 2 ? '#525b6c' : '#5c6678');
        g.addColorStop(1, i % 2 ? '#434b5a' : '#4b5466');
        ctx.fillStyle = g;
        ctx.fillRect(bx, SIDEWALK - 40 - bh, bw, bh + 20);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(bx, SIDEWALK - 40 - bh, bw, 6);
        if (r() < 0.4) { ctx.fillStyle = '#3b414d'; ctx.fillRect(bx + 60, SIDEWALK - 40 - bh - 22, 22, 22); ctx.fillRect(bx + 63, SIDEWALK - 40 - bh - 26, 16, 4); }
        for (let wy = SIDEWALK - 30 - bh; wy < SIDEWALK - 60; wy += 26) for (let wx = 10; wx < 90; wx += 24) {
          const lit = r() < 0.55;
          ctx.fillStyle = lit ? 'rgba(255,226,150,0.75)' : 'rgba(30,40,60,0.45)';
          ctx.fillRect(bx + wx, wy, 13, 15);
        }
      }
    } else if (p.id === 'beach') {
      const sea = ctx.createLinearGradient(0, 200, 0, 290);
      sea.addColorStop(0, '#2a86c4');
      sea.addColorStop(1, '#4fb3dd');
      ctx.fillStyle = sea;
      ctx.fillRect(0, 200, W, 92);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      for (let row = 0; row < 4; row++) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 12) ctx.lineTo(x, 218 + row * 20 + Math.sin(x / 40 + time * 1.5 + row) * 3);
        ctx.stroke();
      }
      const sand = ctx.createLinearGradient(0, 284, 0, SIDEWALK);
      sand.addColorStop(0, '#f2dea4');
      sand.addColorStop(1, '#e2c784');
      ctx.fillStyle = sand;
      ctx.beginPath();
      ctx.moveTo(0, 292);
      for (let x = 0; x <= W; x += 20) ctx.lineTo(x, 286 + Math.sin(x / 70 + time) * 3);
      ctx.lineTo(W, SIDEWALK); ctx.lineTo(0, SIDEWALK);
      ctx.fill();
      for (const [x, c] of [[120, '#ef5350'], [760, '#42a5f5']]) {
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, 300); ctx.lineTo(x + 6, 380); ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(x - 50, 312); ctx.quadraticCurveTo(x, 270, x + 50, 304); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.moveTo(x - 16, 300); ctx.quadraticCurveTo(x, 282, x + 16, 298); ctx.lineTo(x, 302); ctx.fill();
      }
      for (const x of [300, 880]) {
        ctx.strokeStyle = '#8d6e48';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, 390); ctx.quadraticCurveTo(x - 10, 300, x + 18, 220); ctx.stroke();
        ctx.fillStyle = '#3f9b4a';
        for (let k = 0; k < 6; k++) {
          const a = -Math.PI / 2 + (k - 2.5) * 0.55 + Math.sin(time + k) * 0.05;
          ctx.save();
          ctx.translate(x + 18, 220);
          ctx.rotate(a);
          ctx.beginPath(); ctx.ellipse(32, 0, 34, 8, 0.25, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    } else if (p.id === 'campus') {
      hills(330, 10, 0.006, 1, '#7aa86a');
      const bx = 150, by = 175, bw = 660, bh = 200;
      const g = ctx.createLinearGradient(0, by, 0, by + bh);
      g.addColorStop(0, '#a5644f');
      g.addColorStop(1, '#8a4f3d');
      ctx.fillStyle = g;
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let y = by + 6; y < by + bh; y += 10) for (let x = bx + ((y / 10) % 2) * 12; x < bx + bw; x += 24) ctx.fillRect(x, y, 22, 1);
      ctx.fillStyle = '#c99a7e';
      ctx.beginPath(); ctx.moveTo(bx - 24, by); ctx.lineTo(480, by - 82); ctx.lineTo(bx + bw + 24, by); ctx.fill();
      ctx.fillStyle = '#b5856a';
      ctx.fillRect(bx - 24, by - 6, bw + 48, 12);
      ctx.fillStyle = '#f5ecd8';
      ctx.beginPath(); ctx.arc(480, by - 34, 20, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3b2b20';
      ctx.lineWidth = 2;
      const hr = (11 + Math.min(1, day.t / DAY_SECONDS) * 3) / 12 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(480, by - 34); ctx.lineTo(480 + Math.sin(hr) * 10, by - 34 - Math.cos(hr) * 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(480, by - 34); ctx.lineTo(480, by - 50); ctx.stroke();
      for (let cx = 360; cx <= 600; cx += 48) {
        ctx.fillStyle = '#efe4cf';
        ctx.fillRect(cx - 8, by + 20, 16, bh - 20);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(cx + 4, by + 20, 4, bh - 20);
      }
      for (let wx = bx + 30; wx < bx + bw - 20; wx += 58) {
        if (wx > 330 && wx < 620) continue;
        ctx.fillStyle = '#f7e7b8';
        Gfx.roundRect(ctx, wx, by + 40, 28, 44, 12); ctx.fill();
        ctx.fillStyle = '#6a3c2c';
        ctx.fillRect(wx + 13, by + 40, 2, 44);
        ctx.fillStyle = '#f7e7b8';
        Gfx.roundRect(ctx, wx, by + 110, 28, 44, 4); ctx.fill();
      }
      tree(80, 300, 42, '#4f9a45');
      tree(880, 300, 42, '#4f9a45');
    } else if (p.id === 'stadium') {
      const g = ctx.createLinearGradient(0, 160, 0, 360);
      g.addColorStop(0, '#7d8a9b');
      g.addColorStop(1, '#5c6878');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(480, 360, 470, 200, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.ellipse(480, 360, 470 - k * 22, 200 - k * 22, 0, Math.PI, 0); ctx.stroke(); }
      const cols = ['#ef5350', '#ffd54f', '#42a5f5', '#ffffff', '#66bb6a', '#ff8a65'];
      for (let i = 0; i < 260; i++) {
        const a = Math.PI + r() * Math.PI, k = 0.55 + r() * 0.42;
        const x = 480 + Math.cos(a) * 470 * k, y = 360 + Math.sin(a) * 200 * k + (day && r() < 0.3 ? Math.sin(time * 8 + i) * 1.5 : 0);
        ctx.fillStyle = cols[i % cols.length];
        ctx.fillRect(x, y, 3, 3);
      }
      for (const lx of [150, 810]) {
        ctx.fillStyle = '#d9dee5';
        ctx.fillRect(lx, 80, 6, 200);
        ctx.fillStyle = '#eef2f6';
        Gfx.roundRect(ctx, lx - 24, 62, 54, 22, 4); ctx.fill();
        const lg = ctx.createRadialGradient(lx + 3, 73, 4, lx + 3, 73, 90);
        lg.addColorStop(0, 'rgba(255,255,220,0.5)');
        lg.addColorStop(1, 'rgba(255,255,220,0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(lx + 3, 73, 90, 0, Math.PI * 2); ctx.fill();
      }
      for (const [fx0, c] of [[300, '#ef5350'], [660, '#42a5f5']]) {
        ctx.fillStyle = '#ccc';
        ctx.fillRect(fx0, 130, 3, 40);
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(fx0 + 3, 130); ctx.lineTo(fx0 + 30 + Math.sin(time * 5) * 3, 138); ctx.lineTo(fx0 + 3, 146); ctx.fill();
      }
    } else {
      hills(300, 26, 0.008, 0.5, '#8cc58a');
      hills(338, 16, 0.011, 2, '#6aaa66');
      for (let i = 0; i < 9; i++) tree(40 + i * 110 + (i % 2) * 20, 300 + (i % 3) * 8, 36 + (i % 3) * 6, i % 2 ? '#3f8a3c' : '#4a9a45');
      ctx.fillStyle = '#7b5a3a';
      ctx.fillRect(700, 372, 70, 6);
      ctx.fillRect(704, 378, 5, 14); ctx.fillRect(760, 378, 5, 14);
      ctx.fillRect(700, 358, 70, 5);
    }
  }

  function drawTruck(x, base, { body = '#ff7043', trim = '#ffd54f', text = 'TACOS', neon = false, awning = false, scale = 1, cooks = 1, bars = null, sq = 0 }) {
    ctx.save();
    ctx.translate(x, base);
    ctx.scale(scale * (1 + sq * 0.03), scale * (1 - sq * 0.05));
    Gfx.shadow(ctx, 6, 2, 130, 14, 0.35);
    // Body.
    const g = ctx.createLinearGradient(0, -170, 0, -20);
    g.addColorStop(0, Gfx.shade(body, 0.15));
    g.addColorStop(1, Gfx.shade(body, -0.12));
    ctx.fillStyle = g;
    Gfx.roundRect(ctx, -110, -160, 220, 132, 14);
    ctx.fill();
    // Cab with windshield on the left.
    ctx.fillStyle = Gfx.shade(body, -0.05);
    Gfx.roundRect(ctx, -132, -110, 40, 82, 10);
    ctx.fill();
    ctx.fillStyle = '#9ad3f0';
    Gfx.roundRect(ctx, -128, -104, 26, 34, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.moveTo(-124, -100); ctx.lineTo(-112, -100); ctx.lineTo(-124, -80); ctx.fill();
    // Trim stripe and bumper.
    ctx.fillStyle = trim;
    ctx.fillRect(-110, -50, 220, 8);
    ctx.fillStyle = '#9aa3ad';
    Gfx.roundRect(ctx, -136, -32, 274, 8, 4);
    ctx.fill();
    // Serving window with the kitchen inside.
    ctx.fillStyle = '#3a2a24';
    Gfx.roundRect(ctx, -72, -132, 120, 58, 6);
    ctx.fill();
    const inner = ctx.createLinearGradient(0, -132, 0, -74);
    inner.addColorStop(0, '#5a4038');
    inner.addColorStop(1, '#3a2a24');
    ctx.fillStyle = inner;
    Gfx.roundRect(ctx, -68, -128, 112, 50, 4);
    ctx.fill();
    for (let c = 0; c < cooks; c++) {
      const cx = -36 + c * 50, bob = Math.sin(time * 10 + c * 2) * (bars ? 1.5 : 0.3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 9, -96 + bob, 18, 18);
      ctx.fillStyle = SKIN[c + 1];
      ctx.beginPath(); ctx.arc(cx, -104 + bob, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      Gfx.roundRect(ctx, cx - 8, -122 + bob, 16, 10, 4); ctx.fill();
      ctx.fillRect(cx - 9, -114 + bob, 18, 3);
    }
    // Counter ledge.
    ctx.fillStyle = '#c4ccd4';
    Gfx.roundRect(ctx, -78, -78, 132, 8, 3);
    ctx.fill();
    // Cooking progress, one bar per window, on the counter.
    if (bars) bars.forEach((t, i) => { if (t >= 0) Gfx.bar(ctx, -66, -126 + i * 9, 108, 6, t, '#9be37a', 'rgba(0,0,0,0.45)'); });
    // Awning.
    if (awning) {
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = k % 2 ? '#ffffff' : '#e53935';
        ctx.beginPath();
        ctx.moveTo(-86 + k * 21, -148); ctx.lineTo(-86 + (k + 1) * 21, -148);
        ctx.lineTo(-86 + (k + 1) * 21 + 4, -136); ctx.arc(-86 + k * 21 + 12.5, -136, 10.5, 0, Math.PI); ctx.closePath();
        ctx.fill();
      }
    }
    // Side menu board.
    ctx.fillStyle = '#2b2f36';
    Gfx.roundRect(ctx, 60, -128, 40, 54, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let k = 0; k < 4; k++) ctx.fillRect(66, -120 + k * 12, 18 + (k % 2) * 8, 3);
    // Roof sign.
    ctx.fillStyle = Gfx.shade(trim, -0.15);
    ctx.fillRect(-60, -170, 6, 12); ctx.fillRect(54, -170, 6, 12);
    ctx.fillStyle = trim;
    Gfx.roundRect(ctx, -86, -194, 172, 28, 8);
    ctx.fill();
    if (neon) {
      ctx.save();
      ctx.shadowColor = '#ff4fa3';
      ctx.shadowBlur = 14 + Math.sin(time * 6) * 4;
      Gfx.text(ctx, '★ ' + text + ' ★', 0, -180, { size: 17, color: '#ff4fa3', stroke: '#5d2a14', width: 2 });
      ctx.restore();
      for (let k = 0; k < 9; k++) {
        ctx.fillStyle = (Math.floor(time * 4) + k) % 2 ? '#fff6b0' : '#ffb347';
        ctx.beginPath(); ctx.arc(-78 + k * 19.5, -165, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      Gfx.text(ctx, text, 0, -180, { size: 16, color: '#5d2a14', stroke: null });
    }
    // Chimney for the grill.
    ctx.fillStyle = '#8b8f96';
    ctx.fillRect(56, -186, 12, 26);
    // Wheels.
    for (const wx of [-70, 66]) {
      ctx.fillStyle = '#1f2428';
      ctx.beginPath(); ctx.arc(wx, -20, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9aa3ad';
      ctx.beginPath(); ctx.arc(wx, -20, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d0d6dc';
      ctx.beginPath(); ctx.arc(wx - 2, -22, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPerson(per) {
    const walking = !per.inQueue;
    const step = walking ? Math.sin((per.x + per.seed * 50) / 7) : 0;
    const bob = walking ? Math.abs(step) * -2 : 0;
    const x = per.x, base = SIDEWALK - 4, h = per.tall;
    Gfx.shadow(ctx, x, base, 13, 4, 0.3);
    // Legs.
    ctx.fillStyle = per.pants;
    ctx.save();
    ctx.translate(x - 4, base - 16 * h + bob);
    ctx.rotate(step * 0.35);
    Gfx.roundRect(ctx, -3, 0, 6, 16 * h, 3); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x + 4, base - 16 * h + bob);
    ctx.rotate(-step * 0.35);
    Gfx.roundRect(ctx, -3, 0, 6, 16 * h, 3); ctx.fill();
    ctx.restore();
    // Body.
    const top = base - 16 * h - 22 * h + bob;
    const g = ctx.createLinearGradient(x - 10, 0, x + 10, 0);
    g.addColorStop(0, Gfx.shade(per.color, 0.12));
    g.addColorStop(1, Gfx.shade(per.color, -0.18));
    ctx.fillStyle = g;
    Gfx.roundRect(ctx, x - 10, top, 20, 24 * h, 7);
    ctx.fill();
    // Head and hair.
    ctx.fillStyle = per.skin;
    ctx.beginPath(); ctx.arc(x, top - 9, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = per.hair;
    ctx.beginPath(); ctx.arc(x, top - 11, 9, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    ctx.fillStyle = '#2a2a2a';
    const look = per.inQueue ? -1 : per.dir;
    ctx.fillRect(x + look * 3 - 1, top - 10, 2, 2);

    // Speech bubble: a mood, or the order while they wait.
    const bubble = per.moodT > 0 && per.mood ? per.mood : per.inQueue && per.order ? ({ taco: '🌮', burrito: '🌯', churro: '🥖' }[per.order] + (per.drink ? '🥤' : '')) : null;
    if (bubble) {
      if (bubble !== per.shown) { per.shown = bubble; per.shownAt = time; }
      const age = Math.min(1, (time - per.shownAt) / 0.25);
      const k = Gfx.ease.outBack(Math.max(0, age));
      const by = top - 34;
      ctx.save();
      ctx.translate(x, by);
      ctx.scale(k, k);
      const bw = per.drink && per.moodT <= 0 ? 44 : 30;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      Gfx.roundRect(ctx, -bw / 2, -14, bw, 24, 10);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, 9); ctx.lineTo(4, 9); ctx.lineTo(0, 15); ctx.fill();
      ctx.font = '15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bubble, 0, -1);
      ctx.restore();
    }
    if (per.inQueue && per.wait > PATIENCE * 0.5) {
      Gfx.bar(ctx, x - 12, top - 52, 24, 4, 1 - per.wait / PATIENCE, per.wait > PATIENCE * 0.8 ? '#ff5a4a' : '#ffb347');
    }
  }

  function drawDay() {
    const p = place(), wid = plan.weather.id, gloomy = wid === 'rainy' || wid === 'cloudy';
    // A real blue sky, lightly tinted by the spot's colour.
    const tint = Gfx.mix('#5aa8e6', p.sky, 0.18);
    const sky = ctx.createLinearGradient(0, 0, 0, SIDEWALK);
    sky.addColorStop(0, gloomy ? Gfx.mix(tint, '#4c5562', 0.6) : Gfx.shade(tint, -0.08));
    sky.addColorStop(1, gloomy ? Gfx.mix(tint, '#a3adb7', 0.55) : wid === 'heat' ? Gfx.mix(tint, '#ffcc80', 0.55) : Gfx.shade(tint, 0.5));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    if (wid === 'sunny' || wid === 'heat') {
      const c = wid === 'heat' ? '#ff9a5a' : '#ffe27a';
      const glow = ctx.createRadialGradient(860, 74, 10, 860, 74, 150);
      glow.addColorStop(0, Gfx.alpha(c, 0.55));
      glow.addColorStop(1, Gfx.alpha(c, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(700, 0, 260, 240);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(860, 74, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(850, 64, 14, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of clouds) cloud(c.x, c.y, c.s, gloomy ? 'rgba(120,130,140,0.75)' : 'rgba(255,255,255,0.8)');
    backdrop(p);

    // Sidewalk and street.
    const walk = Gfx.mix(p.ground, '#d8d2c4', 0.45);
    ctx.fillStyle = walk;
    ctx.fillRect(0, SIDEWALK - 22, W, 44);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let x = 0; x < W; x += 64) ctx.fillRect(x, SIDEWALK - 22, 2, 44);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, SIDEWALK - 22, W, 3);
    ctx.fillStyle = Gfx.shade(walk, -0.3);
    ctx.fillRect(0, SIDEWALK + 22, W, 6);
    const street = ctx.createLinearGradient(0, SIDEWALK + 28, 0, H);
    street.addColorStop(0, Gfx.shade(p.ground, -0.25));
    street.addColorStop(1, Gfx.shade(p.ground, -0.4));
    ctx.fillStyle = street;
    ctx.fillRect(0, SIDEWALK + 28, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let x = 0; x < W; x += 80) ctx.fillRect(x, SIDEWALK + 70, 40, 4);
    if (gloomy) { ctx.fillStyle = 'rgba(30,40,55,0.18)'; ctx.fillRect(0, 0, W, H); }

    // The rival, if they're here today.
    if (plan.event.rivalAt === p.id) {
      drawTruck(115, SIDEWALK - 8, { body: '#5c6bc0', trim: '#c5cae9', text: `RIVAL $${plan.event.rivalPrice}`, scale: 0.62 });
    }

    // Our truck.
    const bars = Array.from({ length: lanes() }, (_, w) => day.serving[w] ? Math.min(1, day.cooking[w] / serveTime(day.serving[w].order)) : -1);
    drawTruck(TRUCK_X, SIDEWALK - 8, { neon: biz.owned.sign, awning: biz.owned.awning, cooks: biz.owned.cook ? 2 : 1, bars, sq: squash });

    // People, back to front isn't needed on a single sidewalk; queue draws last so bubbles sit on top.
    for (const per of day.people) if (!per.inQueue) drawPerson(per);
    for (const per of day.people) if (per.inQueue) drawPerson(per);

    fx.draw(ctx);
    if (day.rain) {
      ctx.strokeStyle = 'rgba(200,220,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of day.rain) {
        d.y = (d.y + 9) % H;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 3, d.y + 10);
      }
      ctx.stroke();
    }
    pops.draw(ctx);

    // Clock and tallies.
    Gfx.card(ctx, 20, 16, 380, 64, { fill: 'rgba(14,16,20,0.9)', r: 12 });
    const hour = 11 + Math.min(1, day.t / DAY_SECONDS) * 3;
    label(`${Math.floor(hour) > 12 ? Math.floor(hour) - 12 : Math.floor(hour)}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')} ${hour >= 12 ? 'pm' : 'am'}  ·  ${weekday()}  ·  ${p.name}${day.critic ? '  ·  critic in town' : ''}`, 34, 40, { color: '#eceef2', size: 15 });
    const stockText = onMenu().map(i => `${biz.stock[i.id]} ${i.name.toLowerCase()}`).join(' · ');
    const low = onMenu().some(i => !i.addon && biz.stock[i.id] > 0 && biz.stock[i.id] < 5);
    label(`$${Math.round(day.revenue)} today · ${stockText}`, 34, 64, { size: 12, color: low ? '#ff7a7a' : '#8d94a1', max: 356 });
    Gfx.bar(ctx, 34, 72, 352, 3, day.t / DAY_SECONDS, '#ffc53d', 'rgba(255,255,255,0.08)');
    Gfx.text(ctx, 'Tap the truck (or press Space) to cook faster!', W / 2, H - 18, { size: 13, color: '#ffffff', stroke: 'rgba(0,0,0,0.45)', width: 3, weight: 700 });
    canvas.style.cursor = mouse && Math.abs(mouse.x - TRUCK_X) < 110 && mouse.y > 260 && mouse.y < 460 ? 'pointer' : '';
  }

  function updateHud() {
    $('day').textContent = biz ? (biz.endless ? `${biz.day}` : `${Math.min(biz.day, DAYS)}/${DAYS}`) : '-';
    $('cash').textContent = biz ? `$${Math.round(biz.cash)}` : '-';
    $('rep').textContent = biz ? Math.round(biz.rep) : '-';
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    buttons = [];
    updateFx(dt);
    if (state === 'day') {
      tickDay(dt);
      if (state === 'day') drawDay();
    } else if (state === 'plan') {
      drawPlan();
    } else if (state === 'report' || state === 'over') {
      if (day) drawDay();
    } else {
      ctx.fillStyle = '#14171d';
      ctx.fillRect(0, 0, W, H);
    }
    if (biz) updateHud();
    requestAnimationFrame(frame);
  }

  Versus.attach({
    ui,
    start,
    score: () => (biz ? biz.cash : 0),
    intro: {
      title: 'Taco Truck Tycoon',
      html: `<ul>
        <li>Each morning, check the <b>forecast</b> and the day of the week, pick a spot, then set <b>prices</b> and buy stock for your menu.</li>
        <li>During lunch, <b>tap the truck</b> to cook faster so nobody gives up waiting.</li>
        <li>Unlock <b>burritos, churros and horchata</b>: people crave different things at different spots and in different weather.</li>
        <li>Watch out for <b>rival trucks</b>, and impress the <b>food critic</b>.</li>
        <li>Finish ${DAYS} days with as much cash as you can, then keep going in endless mode.</li>
      </ul>`,
      button: 'Start the season',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
