(() => {
  const W = 960, H = 540;
  const DAYS = 14;
  const DAY_SECONDS = 30;
  const BATCH = 20, BATCH_COST = 16;
  const QUEUE_MAX = 8, PATIENCE = 9;
  const SIDEWALK = 430, TRUCK_X = 480;

  const WEATHER = [
    { id: 'sunny', name: 'Sunny', traffic: 1.1, beach: 1.6, icon: '#ffd54f' },
    { id: 'cloudy', name: 'Cloudy', traffic: 0.95, beach: 0.8, icon: '#b0bec5' },
    { id: 'rainy', name: 'Rainy', traffic: 0.6, beach: 0.3, icon: '#4fc3f7' },
    { id: 'heat', name: 'Heatwave', traffic: 0.85, beach: 2.0, icon: '#ff7043' },
  ];
  const PLACES = [
    { id: 'park', name: 'Park', rent: 20, traffic: 70, fair: 4.5, sky: '#7cb87a', ground: '#4f8a4c' },
    { id: 'downtown', name: 'Downtown', rent: 50, traffic: 95, fair: 6, sky: '#8fa3b8', ground: '#5d6470' },
    { id: 'beach', name: 'Beach', rent: 35, traffic: 70, fair: 5.5, sky: '#7ec8e3', ground: '#e6cf8f' },
  ];
  const EVENTS = [
    { text: 'No events in town today.', place: null, boost: 1 },
    { text: 'Soccer final at the park! Big crowds expected.', place: 'park', boost: 1.8 },
    { text: 'Office lunch rush downtown.', place: 'downtown', boost: 1.6 },
    { text: 'Surf contest at the beach!', place: 'beach', boost: 1.8 },
    { text: 'Street fair downtown.', place: 'downtown', boost: 1.9 },
  ];
  const UPGRADES = [
    { id: 'grill', name: 'Double grill', cost: 150, desc: 'Cook 50% faster' },
    { id: 'sign', name: 'Neon sign', cost: 120, desc: '+20% people stop to look' },
    { id: 'salsa', name: 'Salsa bar', cost: 100, desc: 'Customers happily pay $1 more' },
    { id: 'cook', name: 'Hire a cook', cost: 220, desc: 'Cook twice as fast · $20/day wage' },
    { id: 'cooler', name: 'Big cooler', cost: 90, desc: 'Leftovers stay fresh overnight' },
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
    biz = { day: 1, cash: 150, rep: 30, stock: 0, owned: {}, best: 0, served: 0 };
    rollForecast();
  }

  function rollForecast() {
    const w = Arcade.pick(WEATHER);
    const ev = Math.random() < 0.45 ? Arcade.pick(EVENTS.slice(1)) : EVENTS[0];
    plan = { weather: w, event: ev, place: plan?.place ?? 0, price: plan?.price ?? 5, batches: plan?.batches ?? 2, ads: false };
  }

  // ---------- Economics ----------

  const place = () => PLACES[plan.place];
  const fairPrice = () => place().fair + (biz.owned.salsa ? 1 : 0) + (plan.weather.id === 'heat' && place().id === 'beach' ? 1 : 0) + biz.rep / 50;
  const stockCost = () => plan.batches * BATCH_COST;
  const dayCosts = () => place().rent + stockCost() + (plan.ads ? 30 : 0) + (biz.owned.cook ? 20 : 0);
  const serveTime = () => 1.3 / (biz.owned.grill ? 1.5 : 1) / (biz.owned.cook ? 2 : 1);

  function expectedTraffic() {
    const p = place();
    let t = p.traffic * plan.weather.traffic;
    if (p.id === 'beach') t *= plan.weather.beach;
    if (plan.event.place === p.id) t *= plan.event.boost;
    t *= 0.7 + biz.rep / 100;
    if (plan.ads) t *= 1.3;
    return Math.round(t);
  }

  // How likely a passer-by is to buy: falls off quickly once you charge more than they expect.
  function buyChance() {
    const over = (plan.price - fairPrice()) / fairPrice();
    const appeal = 0.55 * (biz.owned.sign ? 1.2 : 1);
    return Math.max(0.02, Math.min(0.95, appeal * (over <= 0 ? 1 - over * 0.6 : 1 - over * 1.8)));
  }

  // ---------- Day simulation ----------

  function openShop() {
    if (biz.cash < dayCosts()) return;
    biz.cash -= dayCosts();
    biz.stock += plan.batches * BATCH;
    day = {
      t: 0, people: [], queue: [], cooking: 0, sold: 0, revenue: 0, walked: 0, angry: 0, soldOut: 0,
      spawnEvery: DAY_SECONDS / Math.max(1, expectedTraffic()), spawnT: 0, costs: dayCosts(), repStart: biz.rep,
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
        p.wait += dt;
        if (p.wait > PATIENCE) {
          // Waited too long: storms off.
          p.inQueue = false;
          day.queue = day.queue.filter(q => q !== p);
          p.mood = '😠';
          p.moodT = 1.5;
          day.angry++;
          biz.rep = Math.max(0, biz.rep - 1);
        }
        continue;
      }
      p.x += p.dir * p.speed * dt;
      if (!p.decided && Math.abs(p.x - TRUCK_X) < 30) {
        p.decided = true;
        day.walked++;
        if (Math.random() < buyChance()) {
          if (biz.stock - day.queue.length <= 0) {
            p.mood = '❌';
            p.moodT = 1.2;
            day.soldOut++;
            biz.rep = Math.max(0, biz.rep - 0.4);
          } else if (day.queue.length >= QUEUE_MAX) {
            p.mood = '😒';
            p.moodT = 1.2;
            biz.rep = Math.max(0, biz.rep - 0.3);
          } else {
            p.inQueue = true;
            day.queue.push(p);
          }
        } else if (plan.price > fairPrice() + 1) {
          p.mood = '💸';
          p.moodT = 1;
        }
      }
    }

    // Queue positions: line up to the right of the truck window.
    day.queue.forEach((p, i) => { p.x += ((TRUCK_X + 80 + i * 30) - p.x) * Math.min(1, dt * 6); });

    if (day.queue.length) {
      day.cooking += dt;
      if (day.cooking >= serveTime()) serve();
    } else {
      day.cooking = 0;
    }

    day.people = day.people.filter(p => p.inQueue || (p.x > -40 && p.x < W + 40));
    if (day.t >= DAY_SECONDS && !day.queue.length) endDay();
    else if (day.t >= DAY_SECONDS + 8) endDay();
  }

  function serve() {
    day.cooking = 0;
    const p = day.queue.shift();
    p.inQueue = false;
    p.dir = 1;
    p.mood = plan.price <= fairPrice() ? '😋' : '🙂';
    p.moodT = 1.5;
    biz.stock--;
    day.sold++;
    biz.served++;
    day.revenue += plan.price;
    biz.cash += plan.price;
    biz.rep = Math.min(100, biz.rep + (plan.price <= fairPrice() ? 0.35 : 0.1));
    Arcade.tone({ freq: 880, to: 1320, dur: 0.06, type: 'triangle', vol: 0.03 });
  }

  // Tapping the truck makes the cook hurry.
  function hurry() {
    if (state !== 'day' || !day.queue.length) return;
    day.cooking += serveTime() * 0.15;
    Arcade.tone({ freq: 300, dur: 0.03, vol: 0.02 });
    if (day.cooking >= serveTime()) serve();
  }

  function endDay() {
    state = 'report';
    const spoiled = biz.owned.cooler ? 0 : Math.ceil(biz.stock / 2);
    biz.stock -= spoiled;
    const profit = day.revenue - day.costs;
    if (profit >= 300) Arcade.flag('taco-tycoon-300');
    const repDelta = Math.round(biz.rep - day.repStart);
    const notes = [];
    if (day.soldOut > 2) notes.push(`${day.soldOut} hungry customers found you sold out. Buy more stock.`);
    if (day.angry > 2) notes.push(`${day.angry} people gave up waiting. A faster kitchen would help.`);
    if (day.walked > 10 && day.sold / day.walked < 0.2) notes.push('Most people walked past. Your price may be too high.');
    if (spoiled > 5) notes.push(`${spoiled} leftover tacos went bad overnight.`);

    if (biz.day >= DAYS) {
      finishGame(profit);
      return;
    }
    ui.show({
      title: `Day ${biz.day} report`,
      html: `<p class="big" style="color:${profit >= 0 ? '#9be37a' : '#ff7a7a'}">${profit >= 0 ? '+' : '−'}$${Math.abs(Math.round(profit))}</p>
        <ul>
          <li>Sold <b>${day.sold}</b> tacos for <b>$${Math.round(day.revenue)}</b></li>
          <li>Costs <b>$${day.costs}</b> (rent, stock${plan.ads ? ', ads' : ''}${biz.owned.cook ? ', wages' : ''})</li>
          <li>Reputation <b>${Math.round(biz.rep)}</b> (${repDelta >= 0 ? '+' : ''}${repDelta})</li>
          <li>Cash <b>$${Math.round(biz.cash)}</b></li>
        </ul>
        ${notes.map(n => `<p>${n}</p>`).join('')}`,
      button: 'Next day',
      onAction: () => {
        biz.day++;
        rollForecast();
        state = 'plan';
        ui.hide();
      },
    });
  }

  function finishGame(profit) {
    state = 'over';
    const score = Math.max(0, Math.round(biz.cash));
    if (biz.cash >= 2000) Arcade.flag('taco-tycoon-mogul');
    Arcade.finish(ui, {
      score,
      title: 'Season over!',
      lines: [`Final day ${profit >= 0 ? 'profit' : 'loss'}: $${Math.abs(Math.round(profit))}`, `${biz.served} tacos served · reputation ${Math.round(biz.rep)}`, 'Your score is the cash you ended with.'],
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

  function button(x, y, w, h, label, { enabled = true, active = false, sub = '', onClick }) {
    ctx.fillStyle = active ? '#3a2f1a' : enabled ? '#232833' : '#1a1d24';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? '#ffc53d' : '#2f3540';
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = enabled ? '#eceef2' : '#5c6370';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + (sub ? h / 2 - 2 : h / 2 + 5));
    if (sub) {
      ctx.fillStyle = enabled ? '#8d94a1' : '#4a505b';
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText(sub, x + w / 2, y + h / 2 + 14);
    }
    buttons.push({ x, y, w, h, enabled, onClick });
  }

  function label(text, x, y, { size = 13, color = '#8d94a1', weight = 600, align = 'left' } = {}) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  }

  function drawPlan() {
    ctx.fillStyle = '#14171d';
    ctx.fillRect(0, 0, W, H);
    label(`Day ${biz.day} of ${DAYS}`, 30, 40, { size: 22, color: '#eceef2', weight: 700 });
    label(`Cash $${Math.round(biz.cash)} · Reputation ${Math.round(biz.rep)}/100 · ${biz.stock} tacos left over`, 30, 64);

    // Forecast.
    ctx.fillStyle = '#1e222a';
    ctx.fillRect(30, 80, 420, 70);
    ctx.fillStyle = plan.weather.icon;
    ctx.beginPath(); ctx.arc(66, 115, 20, 0, Math.PI * 2); ctx.fill();
    label(`Forecast: ${plan.weather.name}`, 100, 108, { color: '#eceef2', size: 15 });
    label(plan.event.text, 100, 130, { size: 12, color: plan.event.place ? '#ffc53d' : '#8d94a1' });

    label('Where to park', 30, 182, { color: '#eceef2' });
    PLACES.forEach((p, i) => {
      button(30 + i * 142, 192, 134, 52, p.name, { active: plan.place === i, sub: `$${p.rent} rent`, onClick: () => { plan.place = i; } });
    });

    label('Taco price', 30, 278, { color: '#eceef2' });
    button(30, 288, 44, 44, '−', { enabled: plan.price > 1, onClick: () => { plan.price = Math.max(1, plan.price - 0.5); } });
    label(`$${plan.price.toFixed(2)}`, 136, 318, { size: 24, color: '#eceef2', weight: 700, align: 'center' });
    button(198, 288, 44, 44, '+', { enabled: plan.price < 15, onClick: () => { plan.price = Math.min(15, plan.price + 0.5); } });
    const vibe = plan.price <= fairPrice() - 1 ? 'A bargain! People will love it.' : plan.price <= fairPrice() ? 'A fair price for here.' : plan.price <= fairPrice() + 1.5 ? 'A bit pricey for here.' : 'Way too expensive. Few will buy.';
    label(vibe, 256, 316, { size: 12 });

    label('Stock up', 30, 366, { color: '#eceef2' });
    button(30, 376, 44, 44, '−', { enabled: plan.batches > 0, onClick: () => { plan.batches--; } });
    label(`${plan.batches * BATCH}`, 136, 406, { size: 24, color: '#eceef2', weight: 700, align: 'center' });
    button(198, 376, 44, 44, '+', { enabled: plan.batches < 20, onClick: () => { plan.batches++; } });
    label(`tacos for $${stockCost()}`, 256, 396, { size: 12 });
    label(`About ${expectedTraffic()} people will pass by`, 256, 414, { size: 12 });

    button(30, 436, 200, 40, plan.ads ? 'Ads booked ✓' : 'Book ads ($30)', { active: plan.ads, sub: '', onClick: () => { plan.ads = !plan.ads; } });
    label('+30% foot traffic today', 244, 461, { size: 12 });

    // Upgrades.
    label('Upgrades', 500, 40, { size: 18, color: '#eceef2', weight: 700 });
    UPGRADES.forEach((u, i) => {
      const owned = biz.owned[u.id];
      button(500, 56 + i * 62, 430, 54, owned ? `${u.name} ✓` : `${u.name} · $${u.cost}`, {
        enabled: !owned && biz.cash - dayCosts() >= u.cost,
        active: owned,
        sub: u.desc,
        onClick: () => { biz.cash -= u.cost; biz.owned[u.id] = true; Arcade.tone({ freq: 523, to: 1046, dur: 0.2, type: 'triangle', vol: 0.05 }); },
      });
    });

    const costs = dayCosts();
    const can = biz.cash >= costs;
    button(500, 400, 430, 76, can ? 'Open for business!' : 'Not enough cash', {
      enabled: can, active: can, sub: `Today costs $${costs}: rent $${place().rent}, stock $${stockCost()}${plan.ads ? ', ads $30' : ''}${biz.owned.cook ? ', wages $20' : ''}`,
      onClick: openShop,
    });
    if (!can) label('Buy less stock or pick a cheaper spot.', 715, 496, { size: 12, color: '#ff7a7a', align: 'center' });
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

    // Truck.
    ctx.fillStyle = '#ff7043';
    ctx.fillRect(TRUCK_X - 100, SIDEWALK - 150, 200, 120);
    ctx.fillStyle = '#ffccbc';
    ctx.fillRect(TRUCK_X - 70, SIDEWALK - 128, 110, 50);
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(TRUCK_X - 100, SIDEWALK - 168, 200, 22);
    label(biz.owned.sign ? '★ TACOS ★' : 'TACOS', TRUCK_X, SIDEWALK - 151, { size: 15, color: '#5d2a14', weight: 800, align: 'center' });
    ctx.fillStyle = '#263238';
    for (const wx of [-60, 60]) { ctx.beginPath(); ctx.arc(TRUCK_X + wx, SIDEWALK - 28, 18, 0, Math.PI * 2); ctx.fill(); }
    // Cooking progress.
    if (day.queue.length) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(TRUCK_X - 70, SIDEWALK - 72, 110, 8);
      ctx.fillStyle = '#9be37a';
      ctx.fillRect(TRUCK_X - 70, SIDEWALK - 72, 110 * Math.min(1, day.cooking / serveTime()), 8);
    }

    // People.
    for (const per of day.people) {
      const bob = Math.sin((per.x + day.t * 200) / 12) * (per.inQueue ? 0 : 2);
      ctx.fillStyle = per.color;
      ctx.fillRect(per.x - 8, SIDEWALK - 30 + bob, 16, 24);
      ctx.beginPath(); ctx.arc(per.x, SIDEWALK - 40 + bob, 9, 0, Math.PI * 2); ctx.fill();
      if (per.moodT > 0 && per.mood) {
        ctx.font = '20px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(per.mood, per.x, SIDEWALK - 58);
      }
      if (per.inQueue && per.wait > PATIENCE * 0.6) {
        ctx.fillStyle = '#ff7a7a';
        ctx.fillRect(per.x - 8, SIDEWALK - 62, 16 * (1 - per.wait / PATIENCE), 3);
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
    ctx.fillRect(20, 16, 300, 64);
    const hour = 11 + Math.min(1, day.t / DAY_SECONDS) * 3;
    label(`${Math.floor(hour) > 12 ? Math.floor(hour) - 12 : Math.floor(hour)}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')} ${hour >= 12 ? 'pm' : 'am'}  ·  ${p.name}`, 34, 40, { color: '#eceef2', size: 15 });
    label(`Sold ${day.sold} · ${biz.stock} left · $${Math.round(day.revenue)} today`, 34, 64, { size: 13, color: biz.stock < 5 ? '#ff7a7a' : '#8d94a1' });
    label('Tap the truck (or press Space) to cook faster!', W / 2, H - 16, { size: 13, color: '#14171d', align: 'center' });
  }

  function updateHud() {
    $('day').textContent = biz ? `${Math.min(biz.day, DAYS)}/${DAYS}` : '-';
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

  ui.show({
    title: 'Taco Truck Tycoon',
    html: `<ul>
      <li>Each morning, check the <b>forecast</b>, pick a spot, set your <b>price</b>, and buy stock.</li>
      <li>During lunch, <b>tap the truck</b> to cook faster so nobody gives up waiting.</li>
      <li>Spend profits on <b>upgrades</b>. Happy customers grow your reputation.</li>
      <li>Finish ${DAYS} days with as much cash as you can.</li>
    </ul>`,
    button: 'Start the season',
    onAction: start,
  });
  requestAnimationFrame(frame);
})();
