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
    if (any) Arcade.tone({ freq: 300, dur: 0.03, vol: 0.02 });
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

  // ---------- Drawing ----------

  function button(x, y, w, h, text, { enabled = true, active = false, sub = '', onClick, size = 14 }) {
    ctx.fillStyle = active ? '#3a2f1a' : enabled ? '#232833' : '#1a1d24';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? '#ffc53d' : '#2f3540';
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = enabled ? '#eceef2' : '#5c6370';
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, y + (sub ? h / 2 - 2 : h / 2 + 5));
    if (sub) {
      ctx.fillStyle = enabled ? '#8d94a1' : '#4a505b';
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText(sub, x + w / 2, y + h / 2 + 13, w - 8);
    }
    buttons.push({ x, y, w, h, enabled, onClick });
  }

  function label(text, x, y, { size = 13, color = '#8d94a1', weight = 600, align = 'left', max } = {}) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.fillText(text, x, y, max);
  }

  function drawPlan() {
    ctx.fillStyle = '#14171d';
    ctx.fillRect(0, 0, W, H);
    label(`${weekday()} · Day ${biz.day}${biz.endless ? ' (endless)' : ` of ${DAYS}`}`, 30, 36, { size: 21, color: '#eceef2', weight: 700 });
    label(`Cash $${Math.round(biz.cash)} · Reputation ${Math.round(biz.rep)}/100${weekend() ? ' · Weekend: parks and beaches fill up' : ''}`, 30, 58, { max: 440 });

    // Forecast.
    ctx.fillStyle = '#1e222a';
    ctx.fillRect(30, 70, 440, 58);
    ctx.fillStyle = plan.weather.icon;
    ctx.beginPath(); ctx.arc(60, 99, 16, 0, Math.PI * 2); ctx.fill();
    label(`Forecast: ${plan.weather.name}`, 88, 92, { color: '#eceef2', size: 14 });
    label(plan.event.text, 88, 113, { size: 11, color: plan.event.place || plan.event.critic || plan.event.rival ? '#ffc53d' : '#8d94a1', max: 374 });

    label('Where to park', 30, 150, { color: '#eceef2' });
    PLACES.forEach((p, i) => {
      button(30 + i * 89, 158, 84, 44, p.name, { active: plan.place === i, sub: `$${p.rent} rent`, size: 13, onClick: () => { plan.place = i; } });
    });

    // Menu: price and stock per item.
    label('Menu', 30, 226, { color: '#eceef2' });
    label('Price', 196, 226, { size: 11, align: 'center' });
    label('Stock to buy', 352, 226, { size: 11, align: 'center' });
    onMenu().forEach((it, k) => {
      const y = 234 + k * 44;
      label(it.name, 30, y + 18, { color: '#eceef2', size: 14 });
      label(`${biz.stock[it.id]} left`, 30, y + 34, { size: 11 });
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
          Arcade.tone({ freq: 523, to: 1046, dur: 0.2, type: 'triangle', vol: 0.05 });
        },
      });
    });

    const costs = dayCosts();
    const can = biz.cash >= costs;
    button(500, 448, 430, 66, can ? 'Open for business!' : 'Not enough cash', {
      enabled: can, active: can, sub: `Today costs $${costs}: rent $${place().rent}, stock $${stockCost()}${plan.ads ? ', ads $30' : ''}${biz.owned.cook ? ', wages $20' : ''}`,
      onClick: openShop,
    });
    if (!can) label('Buy less stock or pick a cheaper spot.', 715, 532, { size: 12, color: '#ff7a7a', align: 'center' });
  }

  function drawDay() {
    const p = place();
    ctx.fillStyle = p.sky;
    ctx.fillRect(0, 0, W, H);
    if (plan.weather.id === 'rainy' || plan.weather.id === 'cloudy') {
      ctx.fillStyle = 'rgba(40,50,60,0.35)';
      ctx.fillRect(0, 0, W, H);
    }
    // Backdrop.
    if (p.id === 'downtown') {
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = i % 2 ? '#4a5262' : '#545d6e';
        const bh = 120 + ((i * 53) % 140);
        ctx.fillRect(i * 110, SIDEWALK - 60 - bh, 100, bh);
        ctx.fillStyle = 'rgba(255,230,150,0.5)';
        for (let wy = SIDEWALK - 50 - bh; wy < SIDEWALK - 80; wy += 28) for (let wx = 10; wx < 90; wx += 26) ctx.fillRect(i * 110 + wx, wy, 12, 14);
      }
    } else if (p.id === 'beach') {
      ctx.fillStyle = '#2f8fc9';
      ctx.fillRect(0, 200, W, 80);
      ctx.fillStyle = '#e6cf8f';
      ctx.fillRect(0, 280, W, 100);
    } else if (p.id === 'campus') {
      ctx.fillStyle = '#8f5a4a';
      ctx.fillRect(120, 170, 720, 200);
      ctx.fillStyle = '#a36b58';
      ctx.beginPath(); ctx.moveTo(100, 170); ctx.lineTo(480, 90); ctx.lineTo(860, 170); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,0.6)';
      for (let wx = 160; wx < 820; wx += 60) ctx.fillRect(wx, 210, 26, 40);
    } else if (p.id === 'stadium') {
      ctx.fillStyle = '#6d7a8a';
      ctx.beginPath(); ctx.ellipse(480, 330, 460, 170, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#ffffff';
      for (const lx of [150, 810]) { ctx.fillRect(lx, 80, 6, 120); ctx.fillRect(lx - 20, 70, 46, 16); }
    } else {
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = '#3e7a3b';
        ctx.beginPath(); ctx.arc(50 + i * 100, 300, 40, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6b4f2e';
        ctx.fillRect(46 + i * 100, 330, 8, 40);
      }
    }
    if (plan.weather.id === 'sunny' || plan.weather.id === 'heat') {
      ctx.fillStyle = plan.weather.icon;
      ctx.beginPath(); ctx.arc(860, 70, 36, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = p.ground;
    ctx.fillRect(0, SIDEWALK - 20, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, SIDEWALK + 20, W, 4);

    // The rival, if they're here today.
    if (plan.event.rivalAt === p.id) {
      ctx.fillStyle = '#5c6bc0';
      ctx.fillRect(40, SIDEWALK - 120, 150, 92);
      ctx.fillStyle = '#c5cae9';
      ctx.fillRect(60, SIDEWALK - 104, 80, 36);
      label(`RIVAL · $${plan.event.rivalPrice}`, 115, SIDEWALK - 128, { size: 12, color: '#1a237e', weight: 800, align: 'center' });
    }

    // Truck.
    ctx.fillStyle = '#ff7043';
    ctx.fillRect(TRUCK_X - 100, SIDEWALK - 150, 200, 120);
    ctx.fillStyle = '#ffccbc';
    ctx.fillRect(TRUCK_X - 70, SIDEWALK - 128, 110, 50);
    if (biz.owned.awning) {
      ctx.fillStyle = '#e53935';
      for (let k = 0; k < 6; k++) { ctx.fillStyle = k % 2 ? '#ffffff' : '#e53935'; ctx.fillRect(TRUCK_X - 110 + k * 37, SIDEWALK - 146, 37, 14); }
    }
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(TRUCK_X - 100, SIDEWALK - 168, 200, 22);
    label(biz.owned.sign ? '★ TACOS ★' : 'TACOS', TRUCK_X, SIDEWALK - 151, { size: 15, color: '#5d2a14', weight: 800, align: 'center' });
    ctx.fillStyle = '#263238';
    for (const wx of [-60, 60]) { ctx.beginPath(); ctx.arc(TRUCK_X + wx, SIDEWALK - 28, 18, 0, Math.PI * 2); ctx.fill(); }
    // Cooking progress, one bar per window.
    for (let w = 0; w < lanes(); w++) {
      const sv = day.serving[w];
      if (!sv) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(TRUCK_X - 70, SIDEWALK - 72 + w * 10, 110, 8);
      ctx.fillStyle = '#9be37a';
      ctx.fillRect(TRUCK_X - 70, SIDEWALK - 72 + w * 10, 110 * Math.min(1, day.cooking[w] / serveTime(sv.order)), 8);
    }

    // People.
    const icons = { taco: '🌮', burrito: '🌯', churro: '🥖' };
    for (const per of day.people) {
      const bob = Math.sin((per.x + day.t * 200) / 12) * (per.inQueue ? 0 : 2);
      ctx.fillStyle = per.color;
      ctx.fillRect(per.x - 8, SIDEWALK - 30 + bob, 16, 24);
      ctx.beginPath(); ctx.arc(per.x, SIDEWALK - 40 + bob, 9, 0, Math.PI * 2); ctx.fill();
      ctx.font = '20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (per.moodT > 0 && per.mood) ctx.fillText(per.mood, per.x, SIDEWALK - 58);
      else if (per.inQueue && per.order) {
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillText(icons[per.order] + (per.drink ? '🥤' : ''), per.x, SIDEWALK - 58);
      }
      if (per.inQueue && per.wait > PATIENCE * 0.6) {
        ctx.fillStyle = '#ff7a7a';
        ctx.fillRect(per.x - 8, SIDEWALK - 76, 16 * (1 - per.wait / PATIENCE), 3);
      }
    }

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

    // Clock and tallies.
    ctx.fillStyle = 'rgba(14,16,20,0.75)';
    ctx.fillRect(20, 16, 360, 64);
    const hour = 11 + Math.min(1, day.t / DAY_SECONDS) * 3;
    label(`${Math.floor(hour) > 12 ? Math.floor(hour) - 12 : Math.floor(hour)}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')} ${hour >= 12 ? 'pm' : 'am'}  ·  ${weekday()}  ·  ${p.name}${day.critic ? '  ·  critic in town' : ''}`, 34, 40, { color: '#eceef2', size: 15 });
    const stockText = onMenu().map(i => `${biz.stock[i.id]} ${i.name.toLowerCase()}`).join(' · ');
    const low = onMenu().some(i => !i.addon && biz.stock[i.id] > 0 && biz.stock[i.id] < 5);
    label(`$${Math.round(day.revenue)} today · ${stockText}`, 34, 64, { size: 12, color: low ? '#ff7a7a' : '#8d94a1', max: 336 });
    label('Tap the truck (or press Space) to cook faster!', W / 2, H - 16, { size: 13, color: '#14171d', align: 'center' });
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
