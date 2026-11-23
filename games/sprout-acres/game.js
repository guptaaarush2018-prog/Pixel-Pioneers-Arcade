/* Sprout Acres: a little farm that grows a day at a time. Walk around (or click a plot) and
   press Space to do whatever the plot needs: till it, plant your chosen seed, water it, or pick
   what's ripe. Crops only grow on days they were watered (rain counts). At the end of each day
   your harvest sells at the stand, at that day's prices. Spend it in the shed on new seeds,
   sprinklers, a bigger watering can, and more land. The score is everything you've earned. */
(() => {
  const ID = 'sprout-acres';
  const W = 960, H = 540, TAU = Math.PI * 2;
  const DAY = 60;
  const SAVE = 'farm:save';
  const T = 48, FX0 = 228, FY0 = 92;     // plot size and where the field starts
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R = Gfx.rand;
  const fx = Gfx.particles(500), floats = Gfx.floaters();
  const money = n => '$' + Math.floor(n).toLocaleString();

  // days: to ripen. regrow: days to fruit again after picking (else the plot is cleared).
  const CROPS = [
    { id: 'turnip', name: 'Turnip', seed: 10, days: 2, price: 30, color: '#f3f0ff', leaf: '#5fae3e', unlock: 0 },
    { id: 'carrot', name: 'Carrot', seed: 15, days: 3, price: 48, color: '#ff8c2a', leaf: '#4f9a35', unlock: 0 },
    { id: 'berry', name: 'Strawberry', seed: 45, days: 4, price: 32, regrow: 2, color: '#e8384a', leaf: '#3f8a2f', unlock: 300 },
    { id: 'corn', name: 'Corn', seed: 30, days: 5, price: 100, color: '#ffd23f', leaf: '#6aa83a', unlock: 600 },
    { id: 'melon', name: 'Melon', seed: 60, days: 6, price: 210, color: '#5fbf4a', leaf: '#3f7f2f', unlock: 1500 },
    { id: 'pumpkin', name: 'Pumpkin', seed: 80, days: 7, price: 300, color: '#ff8c1a', leaf: '#4f8a35', unlock: 3000 },
    { id: 'sunflower', name: 'Sunflower', seed: 70, days: 5, price: 190, color: '#ffd23f', leaf: '#4f9a35', unlock: 5000 },
    { id: 'starfruit', name: 'Starfruit', seed: 300, days: 8, price: 1000, color: '#fff27a', leaf: '#2f8f6a', unlock: 12000 },
  ];
  const fresh = () => ({ cash: 100, earned: 0, day: 1, cols: 7, rows: 4, plots: {}, seeds: { turnip: 6 }, sel: 'turnip', can: 0, sprinklers: 0, crate: {}, best: {}, prices: null, rainy: false });
  let s = { ...fresh(), ...Arcade.load(SAVE, {}) };

  const farmer = { x: FX0 - 40, y: FY0 + 60, tx: null, ty: null, face: [0, 1], step: 0, action: 0 };
  let dayT = 0, state = 'menu', time = 0, water = 0, rain = [], banner = null, queuedAct = null;

  // ---------- Field ----------

  const key = (c, r) => c + ',' + r;
  const plot = (c, r) => s.plots[key(c, r)] || (s.plots[key(c, r)] = { soil: 'grass' });
  const plotAt = (x, y) => { const c = Math.floor((x - FX0) / T), r = Math.floor((y - FY0) / T); return c >= 0 && r >= 0 && c < s.cols && r < s.rows ? [c, r] : null; };
  const crop = id => CROPS.find(c => c.id === id);
  const canMax = () => 10 + s.can * 8;

  // The plot in front of the farmer.
  function facing() {
    const fx_ = farmer.x + farmer.face[0] * 26, fy = farmer.y + 10 + farmer.face[1] * 26;
    return plotAt(fx_, fy) || plotAt(farmer.x, farmer.y + 10);
  }

  function act(cr) {
    if (!cr) return;
    const [c, r] = cr, p = plot(c, r);
    const px = FX0 + c * T + T / 2, py = FY0 + r * T + T / 2;
    farmer.action = 0.25;
    if (p.soil === 'grass') { p.soil = 'tilled'; dust(px, py, '#8a6a42'); Arcade.tone({ freq: 180, to: 120, dur: 0.08, type: 'square', vol: 0.03 }); return save(); }
    if (p.sprinkler) return;
    if (p.soil === 'tilled' && !p.crop) {
      const cp = crop(s.sel);
      if (!(s.seeds[s.sel] > 0)) return say(`No ${cp.name.toLowerCase()} seeds: buy some in the shed`, '#ff8a80');
      s.seeds[s.sel]--;
      p.crop = s.sel; p.grow = 0; p.wet = s.rainy; p.ripe = false;
      dust(px, py, cp.leaf);
      Arcade.tone({ freq: 500, to: 700, dur: 0.07, type: 'triangle', vol: 0.03 });
      return save();
    }
    if (p.crop && p.ripe) return harvest(p, px, py);
    if (p.crop && !p.wet) {
      if (water <= 0) return say('The watering can is empty: fill it at the well', '#80deea');
      water--;
      p.wet = true;
      fx.burst(8, () => ({ x: px + R(-10, 10), y: py - 10, vx: R(-30, 30), vy: R(10, 60), life: 0.4, size: 2, color: '#80deea' }));
      Arcade.tone({ freq: 700, to: 400, dur: 0.1, type: 'sine', vol: 0.03 });
      return save();
    }
  }

  function harvest(p, px, py) {
    const cp = crop(p.crop);
    s.crate[cp.id] = (s.crate[cp.id] || 0) + 1;
    floats.add(`+1 ${cp.name}`, px, py - 20, { color: cp.color, size: 14 });
    fx.burst(12, () => ({ x: px, y: py - 8, vx: R(-70, 70), vy: R(-120, -30), life: 0.6, size: R(2, 4), color: R() < 0.5 ? cp.color : cp.leaf, g: 0, drag: 1 }));
    Arcade.tone({ freq: 660, to: 990, dur: 0.1, type: 'triangle', vol: 0.04 });
    if (cp.regrow) { p.ripe = false; p.grow = cp.days - cp.regrow; }
    else { p.crop = null; p.ripe = false; p.soil = 'tilled'; }
    Arcade.flag('sprout-acres-harvest');
    if (cp.id === 'starfruit') Arcade.flag('sprout-acres-starfruit');
    save();
  }

  function dust(x, y, c) { fx.burst(8, () => ({ x: x + R(-12, 12), y: y + R(-6, 10), vx: R(-40, 40), vy: R(-50, -10), life: 0.4, size: R(2, 4), color: c })); }
  function say(text, color = '#fff') { banner = { text, t: 2.2, color }; }

  // ---------- Days ----------

  function rollPrices() {
    s.prices = {};
    for (const c of CROPS) s.prices[c.id] = Math.round(c.price * (0.75 + Math.random() * 0.6));
    s.rainy = Math.random() < 0.18;
  }

  function endDay() {
    // Sell everything in the crate at today's prices.
    let sold = 0, lines = [];
    for (const [id, n] of Object.entries(s.crate)) {
      if (!n) continue;
      const v = n * s.prices[id];
      sold += v;
      lines.push(`${n} ${crop(id).name}${n > 1 ? 's' : ''} · ${money(v)}`);
    }
    s.crate = {};
    s.cash += sold; s.earned += sold;
    // Growth: watered crops grow a day; sprinklers water their neighbours for tomorrow.
    let grew = 0;
    for (const [k, p] of Object.entries(s.plots)) {
      if (!p.crop || p.ripe) continue;
      if (p.wet) { p.grow++; grew++; if (p.grow >= crop(p.crop).days) p.ripe = true; }
    }
    s.day++;
    rollPrices();
    for (const p of Object.values(s.plots)) if (p.crop) p.wet = s.rainy;
    for (const [k, p] of Object.entries(s.plots)) {
      if (!p.sprinkler) continue;
      const [c, r] = k.split(',').map(Number);
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) { const q = s.plots[key(c + dc, r + dr)]; if (q?.crop) q.wet = true; }
    }
    water = canMax();
    Arcade.submitScore(ID, Math.floor(s.earned));
    Arcade.dailyScore?.(Math.floor(s.earned));
    if (s.earned >= 1000) Arcade.flag('sprout-acres-1k');
    if (s.earned >= 25000) Arcade.flag('sprout-acres-25k');
    if (s.day >= 15) Arcade.flag('sprout-acres-week');
    save();
    dayT = 0;
    Arcade.tone({ freq: 392, to: 523, dur: 0.3, type: 'triangle', vol: 0.04 });
    state = 'night';
    ui.show({
      title: `🌙 End of day ${s.day - 1}`,
      html: `${sold ? `<p>The stand sold <b style="color:#9be37a">${money(sold)}</b> of produce:</p><p style="font-size:13px">${lines.join('<br>')}</p>` : '<p>Nothing sold today.</p>'}
        <p style="font-size:13px;color:var(--muted)">${grew} crop${grew === 1 ? '' : 's'} grew overnight. Tomorrow: ${s.rainy ? '🌧️ rain (everything gets watered)' : '☀️ sunny'}.</p>
        <p>Cash ${money(s.cash)} · earned ${money(s.earned)} in all</p>`,
      button: `Start day ${s.day}`,
      onAction: () => { state = 'play'; ui.hide(); },
    });
  }

  function save() { Arcade.save(SAVE, s); updateHud(); }

  // ---------- Shed ----------

  const expandCost = () => 250 * Math.pow(2, (s.cols - 7) + (s.rows - 4));
  function shed(msg = '') {
    state = 'shop';
    const seeds = CROPS.map(c => {
      const open = s.earned >= c.unlock;
      return `<button class="btn secondary" type="button" data-seed="${c.id}" ${open && s.cash >= c.seed * 5 ? '' : 'disabled'}>${open ? c.name : '🔒 ' + c.name}<small>${open ? `5 seeds · ${money(c.seed * 5)} · ${c.days} days · sells ~${money(c.price)}${c.regrow ? ' · regrows' : ''}` : `Earn ${money(c.unlock)} to unlock`}</small></button>`;
    }).join('');
    const can = s.can < 4 ? 120 * (s.can + 1) * (s.can + 1) : null;
    const tools = `
      <button class="btn secondary" type="button" data-buy="sprinkler" ${s.cash >= 400 ? '' : 'disabled'}>Sprinkler<small>Waters the 8 plots around it every morning · ${money(400)}</small></button>
      <button class="btn secondary" type="button" data-buy="can" ${can && s.cash >= can ? '' : 'disabled'}>Bigger watering can<small>${can ? `Holds ${canMax() + 8} · ${money(can)}` : 'Biggest already'}</small></button>
      <button class="btn secondary" type="button" data-buy="expand" ${s.cash >= expandCost() && (s.cols < 12 || s.rows < 7) ? '' : 'disabled'}>More land<small>${s.cols < 12 || s.rows < 7 ? `Another ${s.cols <= s.rows + 3 && s.cols < 12 ? 'column' : 'row'} of plots · ${money(expandCost())}` : 'The farm is as big as it gets'}</small></button>`;
    ui.show({
      title: '🛖 The shed',
      html: `${msg ? `<p style="color:#9be37a">${msg}</p>` : ''}<p>Cash: <b>${money(s.cash)}</b> · Seeds: ${Object.entries(s.seeds).filter(([, n]) => n > 0).map(([id, n]) => `${crop(id).name} ×${n}`).join(', ') || 'none'}${s.sprinklers ? ` · Sprinklers to place: ${s.sprinklers}` : ''}</p>
        <div class="sa-shop">${seeds}</div><div class="sa-shop" style="margin-top:8px">${tools}</div>`,
      button: 'Back to the field',
      onAction: () => { state = 'play'; ui.hide(); },
      onRender: p => {
        p.querySelectorAll('[data-seed]').forEach(b => b.addEventListener('click', () => {
          const c = crop(b.dataset.seed);
          if (s.cash < c.seed * 5) return;
          s.cash -= c.seed * 5; s.seeds[c.id] = (s.seeds[c.id] || 0) + 5; s.sel = c.id;
          save(); shed(`Bought 5 ${c.name.toLowerCase()} seeds`);
        }));
        p.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
          const what = b.dataset.buy;
          if (what === 'sprinkler' && s.cash >= 400) { s.cash -= 400; s.sprinklers++; save(); return shed('Sprinkler bought: stand on a tilled plot and press X to place it'); }
          if (what === 'can' && can && s.cash >= can) { s.cash -= can; s.can++; water = canMax(); save(); return shed('Bigger can!'); }
          if (what === 'expand' && s.cash >= expandCost()) {
            s.cash -= expandCost();
            if (s.cols <= s.rows + 3 && s.cols < 12) s.cols++; else s.rows++;
            Arcade.flag('sprout-acres-expand');
            save(); return shed('The farm grew!');
          }
        }));
      },
    });
  }

  function placeSprinkler() {
    const cr = facing();
    if (!cr || !s.sprinklers) return say(s.sprinklers ? 'Face a plot to place it' : 'Buy a sprinkler in the shed first', '#ff8a80');
    const p = plot(...cr);
    if (p.crop || p.sprinkler) return say('Pick an empty plot for the sprinkler', '#ff8a80');
    p.sprinkler = true; p.soil = 'tilled';
    s.sprinklers--;
    Arcade.flag('sprout-acres-sprinkler');
    save();
  }

  // ---------- Input ----------

  const keys = new Set();
  addEventListener('keydown', e => {
    keys.add(e.code);
    if (state !== 'play') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if ((e.code === 'Space' || e.code === 'KeyE') && !e.repeat) doAction();
    if (e.code === 'KeyQ' || e.code === 'Tab') { e.preventDefault(); cycleSeed(1); }
    if (e.code === 'KeyX') placeSprinkler();
    if (e.code === 'KeyB') shed();
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
    const n = +e.key;
    if (n >= 1 && n <= CROPS.length && s.earned >= CROPS[n - 1].unlock) s.sel = CROPS[n - 1].id;
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  function cycleSeed(d) {
    const open = CROPS.filter(c => s.earned >= c.unlock);
    const i = open.findIndex(c => c.id === s.sel);
    s.sel = open[(i + d + open.length) % open.length].id;
  }
  function doAction() {
    // At the well: fill up. At the shed door: shop. Otherwise work the plot in front.
    if (Math.hypot(farmer.x - WELL.x, farmer.y - WELL.y) < 46) { water = canMax(); say('Watering can filled', '#80deea'); Arcade.tone({ freq: 300, to: 600, dur: 0.25, type: 'sine', vol: 0.04 }); return; }
    if (Math.hypot(farmer.x - SHED.x, farmer.y - SHED.y) < 56) return shed();
    act(facing());
  }
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'play') return;
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    // The seed bar.
    const bar = seedBarHit(x, y);
    if (bar) { s.sel = bar; return; }
    if (Math.hypot(x - WELL.x, y - WELL.y) < 34) { walkTo(WELL.x + 30, WELL.y, () => doAction()); return; }
    if (Math.hypot(x - SHED.x, y - SHED.y) < 50) { walkTo(SHED.x, SHED.y + 40, () => shed()); return; }
    const cr = plotAt(x, y);
    if (cr) {
      const px = FX0 + cr[0] * T + T / 2, py = FY0 + cr[1] * T + T / 2;
      // Stand just below the plot, facing it.
      walkTo(px, py + T * 0.72 - 10, () => { farmer.face = [0, -1]; act(cr); });
    } else walkTo(x, y - 10, null);
  });
  function walkTo(x, y, then) { farmer.tx = x; farmer.ty = y; queuedAct = then; }

  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    save();
    ui.show({ title: 'Paused', html: `<p>Day ${s.day} · ${money(s.cash)}</p>`, button: 'Resume', onAction: () => { state = 'play'; ui.hide(); } });
  }
  Arcade.onBlur(pause);

  // ---------- Update ----------

  const WELL = { x: 120, y: 330 }, SHED = { x: 110, y: 150 }, STAND = { x: 840, y: 470 };
  function update(dt) {
    time += dt;
    dayT += dt;
    if (dayT >= DAY) return endDay();
    // Walking: keys, or toward a clicked spot.
    let mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let my = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    if (mx || my) { farmer.tx = null; queuedAct = null; }
    else if (farmer.tx !== null) {
      const dx = farmer.tx - farmer.x, dy = farmer.ty - farmer.y, d = Math.hypot(dx, dy);
      if (d < 4) { farmer.tx = null; const q = queuedAct; queuedAct = null; q?.(); }
      else { mx = dx / d; my = dy / d; }
    }
    const m = Math.hypot(mx, my);
    if (m) {
      farmer.x = clamp(farmer.x + mx / m * 190 * dt, 30, W - 30);
      farmer.y = clamp(farmer.y + my / m * 190 * dt, 70, H - 40);
      farmer.step += dt * 10;
      farmer.face = Math.abs(mx) > Math.abs(my) ? [Math.sign(mx), 0] : [0, Math.sign(my)];
    }
    farmer.action = Math.max(0, farmer.action - dt);
    if (s.rainy) for (let i = 0; i < 4; i++) rain.push({ x: R(0, W + 100), y: -10, v: R(500, 700) });
    for (const r of rain) { r.y += r.v * dt; r.x -= r.v * 0.2 * dt; }
    rain = rain.filter(r => r.y < H);
    fx.update(dt); floats.update(dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    updateHud();
  }

  // ---------- Drawing ----------

  const grass = Gfx.sprite(W, H, 0, 0, g => {
    g.fillStyle = '#7cc05a'; g.fillRect(0, 0, W, H);
    const r = Gfx.rng(8);
    for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(30,80,20,0.08)'; g.fillRect(r() * W, r() * H, 2, 4); }
    for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H; g.fillStyle = ['#fff', '#ffd23f', '#ff9ab0'][Math.floor(r() * 3)]; g.beginPath(); g.arc(x, y, 2, 0, TAU); g.fill(); }
    // Path to the stand.
    g.fillStyle = '#d8c08a';
    g.beginPath(); g.moveTo(0, 360); g.quadraticCurveTo(400, 520, W, 470); g.lineTo(W, 500); g.quadraticCurveTo(400, 560, 0, 395); g.fill();
  });

  function drawPlot(c, r) {
    const p = s.plots[key(c, r)] || { soil: 'grass' };
    const x = FX0 + c * T, y = FY0 + r * T;
    if (p.soil !== 'grass') {
      ctx.fillStyle = p.wet ? '#5a3d22' : '#8a6238';
      Gfx.roundRect(ctx, x + 3, y + 3, T - 6, T - 6, 6); ctx.fill();
      ctx.fillStyle = p.wet ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.08)';
      for (let k = 0; k < 3; k++) ctx.fillRect(x + 8, y + 12 + k * 11, T - 16, 3);
    } else {
      ctx.strokeStyle = 'rgba(40,80,30,0.25)'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 3.5, y + 3.5, T - 7, T - 7);
    }
    if (p.sprinkler) {
      ctx.fillStyle = '#90a4ae'; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#cfd8dc'; ctx.fillRect(x + T / 2 - 2, y + T / 2 - 14, 4, 12);
      if (Math.sin(time * 4) > 0.7 && state === 'play') fx.emit({ x: x + T / 2, y: y + T / 2 - 14, vx: R(-60, 60), vy: R(-60, 0), life: 0.4, size: 2, color: '#80deea' });
    }
    if (p.crop) drawCrop(crop(p.crop), x + T / 2, y + T / 2 + 6, p);
  }

  function drawCrop(cp, x, y, p) {
    const k = p.ripe ? 1 : (p.grow + (p.wet ? 0.3 : 0)) / cp.days, sway = Math.sin(time * 2 + x) * 1.5;
    ctx.save();
    ctx.translate(x, y);
    if (k < 0.34) {
      ctx.fillStyle = cp.leaf;
      ctx.beginPath(); ctx.ellipse(-4 + sway, -4, 5, 3, -0.6, 0, TAU); ctx.ellipse(4 + sway, -4, 5, 3, 0.6, 0, TAU); ctx.fill();
    } else if (!p.ripe) {
      const h = 8 + k * 16;
      ctx.strokeStyle = Gfx.shade(cp.leaf, -0.2); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sway, -h); ctx.stroke();
      ctx.fillStyle = cp.leaf;
      for (const s_ of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s_ * 7 + sway, -h * 0.6, 8, 4, s_ * 0.5, 0, TAU); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(sway, -h, 6, 4, 0, 0, TAU); ctx.fill();
    } else {
      // Ripe: show the produce, with a little bounce.
      const b = Math.abs(Math.sin(time * 4 + x)) * 2;
      ctx.fillStyle = cp.leaf;
      ctx.beginPath(); ctx.ellipse(-7, -8, 8, 4, -0.5, 0, TAU); ctx.ellipse(7, -8, 8, 4, 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = cp.color;
      ctx.strokeStyle = Gfx.shade(cp.color, -0.35); ctx.lineWidth = 1.5;
      if (cp.id === 'corn') { ctx.fillRect(-4, -26 - b, 8, 18); ctx.fillStyle = cp.leaf; ctx.fillRect(-6, -14 - b, 3, 10); ctx.fillRect(3, -14 - b, 3, 10); }
      else if (cp.id === 'sunflower') { ctx.strokeStyle = cp.leaf; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -22); ctx.stroke(); for (let k2 = 0; k2 < 10; k2++) { const a = k2 / 10 * TAU; ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(Math.cos(a) * 7, -26 - b + Math.sin(a) * 7, 5, 2.5, a, 0, TAU); ctx.fill(); } ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.arc(0, -26 - b, 5, 0, TAU); ctx.fill(); }
      else if (cp.id === 'carrot') { ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(6, -8); ctx.lineTo(0, 6); ctx.fill(); ctx.stroke(); }
      else if (cp.id === 'starfruit') { ctx.beginPath(); for (let k2 = 0; k2 < 10; k2++) { const a = k2 / 10 * TAU - Math.PI / 2, rr = k2 % 2 ? 5 : 11; ctx.lineTo(Math.cos(a) * rr, -12 - b + Math.sin(a) * rr); } ctx.fill(); ctx.stroke(); ctx.shadowColor = '#fff27a'; }
      else if (cp.id === 'berry') { for (const [dx, dy] of [[-6, -10], [5, -12], [0, -4]]) { ctx.beginPath(); ctx.arc(dx, dy - b, 5, 0, TAU); ctx.fill(); ctx.stroke(); } }
      else { const rr = cp.id === 'pumpkin' ? 15 : cp.id === 'melon' ? 13 : 9; ctx.beginPath(); ctx.ellipse(0, -rr * 0.7 - b, rr, rr * 0.8, 0, 0, TAU); ctx.fill(); ctx.stroke(); if (cp.id === 'melon') { ctx.strokeStyle = '#2f6a2a'; for (const dx of [-5, 0, 5]) { ctx.beginPath(); ctx.moveTo(dx, -rr * 1.4 - b); ctx.lineTo(dx, -b); ctx.stroke(); } } }
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(14, -24, 2 + Math.sin(time * 6) * 1, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (!p.wet && !p.ripe) { ctx.fillStyle = '#80deea'; ctx.beginPath(); ctx.moveTo(x + 14, y - 24); ctx.quadraticCurveTo(x + 19, y - 16, x + 14, y - 14); ctx.quadraticCurveTo(x + 9, y - 16, x + 14, y - 24); ctx.fill(); }
  }

  function drawFarmer() {
    const { x, y } = farmer, bob = Math.abs(Math.sin(farmer.step)) * 2;
    Gfx.shadow(ctx, x, y + 18, 13, 5, 0.3);
    ctx.save(); ctx.translate(x, y - bob);
    ctx.fillStyle = '#4a6fd6'; Gfx.roundRect(ctx, -10, -6, 20, 22, 6); ctx.fill();
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-8, 14, 6, 6); ctx.fillRect(2, 14, 6, 6);
    ctx.fillStyle = '#ffcf9e'; ctx.beginPath(); ctx.arc(0, -14, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8c06a'; ctx.beginPath(); ctx.ellipse(0, -20, 15, 5, 0, 0, TAU); ctx.fill(); ctx.fillRect(-7, -28, 14, 8);
    ctx.fillStyle = '#1b1b2a';
    if (farmer.face[1] >= 0) { ctx.fillRect(-4 + farmer.face[0] * 2, -14, 2, 3); ctx.fillRect(2 + farmer.face[0] * 2, -14, 2, 3); }
    // Tool swing.
    if (farmer.action > 0) { ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 3; const a = farmer.action * 8; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(8 + Math.cos(a) * 14 * (farmer.face[0] || 1), Math.sin(a) * 10); ctx.stroke(); }
    ctx.restore();
  }

  function draw() {
    grass.draw(ctx, 0, 0);
    // Fence around the field.
    const fw = s.cols * T, fh = s.rows * T;
    ctx.strokeStyle = '#a07a4a'; ctx.lineWidth = 4;
    ctx.strokeRect(FX0 - 8, FY0 - 8, fw + 16, fh + 16);
    ctx.fillStyle = '#8a6238';
    for (let x = FX0 - 8; x <= FX0 + fw + 8; x += 24) { ctx.fillRect(x - 3, FY0 - 14, 6, 12); ctx.fillRect(x - 3, FY0 + fh + 2, 6, 12); }
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) drawPlot(c, r);
    // Highlight what Space will work on.
    const f = facing();
    if (f && state === 'play') { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.strokeRect(FX0 + f[0] * T + 2, FY0 + f[1] * T + 2, T - 4, T - 4); ctx.setLineDash([]); }
    // Shed, well and stand.
    Gfx.shadow(ctx, SHED.x + 4, SHED.y + 40, 60, 12, 0.3);
    ctx.fillStyle = '#b5483a'; ctx.fillRect(SHED.x - 50, SHED.y - 20, 100, 58);
    ctx.fillStyle = '#6b2f26'; ctx.beginPath(); ctx.moveTo(SHED.x - 60, SHED.y - 18); ctx.lineTo(SHED.x, SHED.y - 60); ctx.lineTo(SHED.x + 60, SHED.y - 18); ctx.fill();
    ctx.fillStyle = '#4a2a1a'; ctx.fillRect(SHED.x - 14, SHED.y + 4, 28, 34);
    Gfx.text(ctx, 'SHED', SHED.x, SHED.y - 8, { size: 11, stroke: null, color: '#ffe9c8' });
    ctx.fillStyle = '#8d8d9c'; ctx.beginPath(); ctx.ellipse(WELL.x, WELL.y, 26, 16, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a6fa8'; ctx.beginPath(); ctx.ellipse(WELL.x, WELL.y - 2, 18, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(WELL.x - 22, WELL.y - 40, 4, 34); ctx.fillRect(WELL.x + 18, WELL.y - 40, 4, 34); ctx.fillRect(WELL.x - 24, WELL.y - 44, 48, 6);
    Gfx.text(ctx, 'WELL', WELL.x, WELL.y + 26, { size: 10, stroke: null, color: '#fff' });
    ctx.fillStyle = '#c98b46'; ctx.fillRect(STAND.x - 50, STAND.y - 26, 100, 28);
    ctx.fillStyle = '#ff7a7a'; for (let i = 0; i < 5; i++) ctx.fillRect(STAND.x - 50 + i * 20, STAND.y - 44, 20, 10);
    ctx.fillStyle = '#fff'; for (let i = 0; i < 5; i += 2) ctx.fillRect(STAND.x - 50 + i * 20, STAND.y - 44, 20, 10);
    const crateN = Object.values(s.crate).reduce((t, n) => t + n, 0);
    Gfx.text(ctx, crateN ? `${crateN} to sell tonight` : 'Farm stand', STAND.x, STAND.y - 10, { size: 11, stroke: null, color: '#3a2614' });
    drawFarmer();
    fx.draw(ctx);
    floats.draw(ctx);
    // Rain and evening light.
    if (s.rainy) { ctx.strokeStyle = 'rgba(200,220,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); for (const r of rain) { ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - 3, r.y + 12); } ctx.stroke(); ctx.fillStyle = 'rgba(40,60,90,0.15)'; ctx.fillRect(0, 0, W, H); }
    const eve = clamp((dayT / DAY - 0.7) / 0.3, 0, 1);
    if (eve > 0) { ctx.fillStyle = `rgba(255,120,60,${eve * 0.18})`; ctx.fillRect(0, 0, W, H); ctx.fillStyle = `rgba(20,20,60,${eve * 0.25})`; ctx.fillRect(0, 0, W, H); }
    drawHud();
  }

  let seedHits = [];
  function seedBarHit(x, y) { const h = seedHits.find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h); return h ? h.id : null; }
  function drawHud() {
    if (state === 'menu') return;
    // Day clock.
    Gfx.card(ctx, 12, 10, 200, 46);
    Gfx.text(ctx, `Day ${s.day} ${s.rainy ? '🌧️' : '☀️'}`, 24, 24, { size: 14, align: 'left', stroke: null });
    Gfx.bar(ctx, 24, 36, 176, 8, 1 - dayT / DAY, dayT / DAY > 0.8 ? '#ff9a6a' : '#ffd23f');
    // Water.
    Gfx.card(ctx, 12, 62, 200, 30);
    Gfx.text(ctx, '💧', 26, 77, { size: 14, stroke: null });
    Gfx.bar(ctx, 42, 72, 158, 10, water / canMax(), '#4fc3ff');
    // Cash.
    Gfx.text(ctx, money(s.cash), W - 16, 26, { size: 22, align: 'right', color: '#9be37a' });
    Gfx.text(ctx, `Prices today: ${CROPS.filter(c => s.earned >= c.unlock).map(c => `${c.name} ${money(s.prices[c.id])}`).join(' · ')}`, W - 16, 50, { size: 11, align: 'right', stroke: null, color: '#1b3a14' });
    // Seed bar.
    seedHits = [];
    const open = CROPS.filter(c => s.earned >= c.unlock), bw = 86, x0 = W / 2 - open.length * (bw + 4) / 2;
    open.forEach((c, i) => {
      const x = x0 + i * (bw + 4), y = H - 44, sel = s.sel === c.id;
      Gfx.card(ctx, x, y, bw, 34, { fill: sel ? 'rgba(255,210,63,0.9)' : 'rgba(20,28,40,0.78)' });
      Gfx.text(ctx, `${i + 1} ${c.name}`, x + bw / 2, y + 12, { size: 11, stroke: null, color: sel ? '#1b1b1b' : '#fff' });
      Gfx.text(ctx, `×${s.seeds[c.id] || 0}`, x + bw / 2, y + 26, { size: 11, stroke: null, color: sel ? '#1b1b1b' : '#cfd8dc' });
      seedHits.push({ x, y, w: bw, h: 34, id: c.id });
    });
    if (banner) { ctx.globalAlpha = Math.min(1, banner.t * 2); Gfx.text(ctx, banner.text, W / 2, 70, { size: 16, color: banner.color }); ctx.globalAlpha = 1; }
  }

  function updateHud() {
    $('day').textContent = s.day;
    $('cash').textContent = money(s.cash);
    $('earned').textContent = money(s.earned);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'play' && overlayEl.hidden) update(dt);
    else time += dt;
    draw();
    requestAnimationFrame(frame);
  }

  if (!s.prices) rollPrices();
  water = canMax();
  addEventListener('pagehide', () => Arcade.save(SAVE, s));
  updateHud();
  ui.show({
    title: '🌱 Sprout Acres',
    html: `<p>${s.earned ? `Welcome back! Day ${s.day}, ${money(s.cash)} in the tin.` : 'A patch of land, a watering can, and six turnip seeds.'}</p>
      <ul style="text-align:left;font-size:14px">
        <li><b>WASD</b> to walk (or click where to go). <b>Space</b> does what the plot in front needs: till, plant, water, or pick.</li>
        <li>Crops only grow on days they're watered. Refill the can at the <b>well</b>; rain waters everything.</li>
        <li>What you pick sells at the stand at the end of each day, at that day's prices. The <b>shed</b> (B) sells seeds, sprinklers and more land.</li>
        <li><b>1-8</b> or <b>Q</b> picks a seed. <b>X</b> places a sprinkler.</li>
      </ul>`,
    button: 'Start farming',
    onAction: () => { state = 'play'; ui.hide(); },
  });
  requestAnimationFrame(frame);
})();
