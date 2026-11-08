/* Sweet Works: buy candy machines, drag matching ones together to merge them into fancier
   machines, and ship the crates they make down the conveyor. Discover all 20 sweets. */
(() => {
  const ID = 'sweet-works';
  const W = 960, H = 540;
  const SAVE_KEY = 'sweet-works:save';
  const VERSION = 1;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;

  const SWEETS = [
    ['🍬', 'Gumdrop'], ['🍭', 'Lollipop'], ['🍫', 'Chocolate Bar'], ['🍪', 'Cookie'], ['🧁', 'Cupcake'],
    ['🍩', 'Donut'], ['🍮', 'Pudding'], ['🥧', 'Pie'], ['🍰', 'Cake Slice'], ['🍨', 'Sundae'],
    ['🎂', 'Party Cake'], ['🍯', 'Honey Jar'], ['🍡', 'Mochi Skewer'], ['🥮', 'Mooncake'], ['🧇', 'Waffle Tower'],
    ['🍦', 'Mega Cone'], ['🎁', 'Gift Box'], ['🏆', 'Trophy Cake'], ['👑', 'Crown Cake'], ['🏰', 'Candy Castle'],
  ];
  const MAX_LV = SWEETS.length;
  const COLORS = ['#ff8fb1', '#ffb86b', '#ffe066', '#8fe39a', '#6fd3e8', '#7aa8ff', '#b69cff', '#ff7ad9', '#ff6b6b', '#4fd1a5'];
  const machineColor = L => {
    const c = COLORS[(L - 1) % COLORS.length];
    return L > 10 ? Gfx.mix(c, '#3a2f5c', 0.25) : c;
  };

  // ---------- Layout ----------

  const COLS = 5, SLOTS = 20, SW = 112, SH = 98, GAP = 10, GX = 24, GY = 84;
  const BELT_X = 664, BELT_TOP = 70, BELT_END = 500;
  const PX = 706, PW = 238;
  const slotXY = i => ({ x: GX + (i % COLS) * (SW + GAP), y: GY + Math.floor(i / COLS) * (SH + GAP) });
  function slotAt(x, y) {
    for (let i = 0; i < SLOTS; i++) {
      const p = slotXY(i);
      if (x >= p.x && x <= p.x + SW && y >= p.y && y <= p.y + SH) return i;
    }
    return -1;
  }

  // ---------- Economy ----------

  const UPS = [
    { id: 'speed', name: 'Faster machines', icon: '⚡', max: 20, cost: lv => 50 * Math.pow(2.2, lv), show: lv => `+${lv * 12}% speed` },
    { id: 'price', name: 'Fancy wrapping', icon: '🎀', max: 30, cost: lv => 100 * Math.pow(2.6, lv), show: lv => `Sweets sell ×${fmt(Math.pow(1.25, lv))}` },
    { id: 'supply', name: 'Better supplies', icon: '📦', max: 12, cost: lv => 500 * Math.pow(12, lv), show: lv => `New machines: Lv ${lv + 1}` },
    { id: 'auto', name: 'Auto-merger', icon: '🤖', max: 4, cost: lv => (lv === 0 ? 2000 : 6000 * Math.pow(4, lv - 1)), show: lv => (lv ? `Merges a pair every ${AUTO_EVERY[lv]}s` : 'Merges pairs for you') },
  ];
  const AUTO_EVERY = [0, 4, 2.5, 1.5, 0.8];
  const FRANCHISE_AT = 1e9;
  const STAR = 0.25;          // each franchise star: +25% to every sale
  const interval = L => (2.4 + L * 0.18) / (1 + 0.12 * s.speed);
  const value = L => 1.5 * Math.pow(3, L - 1) * Math.pow(1.25, s.price) * (1 + STAR * s.stars);
  const machineCost = () => Math.round(4 * Math.pow(1.08, s.bought) * Math.pow(2, s.supply));
  const slotCost = () => Math.round(30 * Math.pow(2.6, s.slots - 8));
  const starsFor = run => Math.floor(Math.sqrt(run / FRANCHISE_AT));
  const income = () => s.grid.reduce((t, L) => t + (L ? value(L) / interval(L) : 0), 0) * 1.04; // golden crates add ~4%

  // ---------- Save ----------

  let s;
  function fresh(keep = {}) {
    const grid = Array(SLOTS).fill(0);
    grid[0] = 1;
    return { v: VERSION, cash: 10, lifetime: 0, run: 0, grid, slots: 8, bought: 0, speed: 0, price: 0, supply: 0, auto: 0, stars: 0, found: 1, franchises: 0, saved: Date.now(), intro: false, ...keep };
  }
  function loadSave() {
    const raw = Arcade.load(SAVE_KEY, null);
    s = raw && raw.v === VERSION ? { ...fresh(), ...raw } : fresh();
    s.grid = Array.from({ length: SLOTS }, (_, i) => Math.max(0, Math.min(MAX_LV, s.grid[i] | 0)));
  }
  const score = () => Math.floor(100 * Math.log10(s.lifetime + 1));
  function persist() {
    s.saved = Date.now();
    Arcade.submitScore(ID, score());
    Arcade.save(SAVE_KEY, s);
  }

  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toString();
    const e = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(n) / 3));
    const v = n / Math.pow(1000, e);
    return (v < 100 ? v.toFixed(v < 10 ? 2 : 1) : Math.floor(v)) + SUFFIX[e];
  }
  const money = n => '$' + fmt(n);

  // ---------- Effects ----------

  const fx = Gfx.particles(700);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();
  let time = 0;
  const anim = Array.from({ length: SLOTS }, () => ({ t: Math.random() * 2, bounce: 0, spawn: 0, glow: 0 }));
  const crates = [];
  const ghosts = [];      // machines sliding into a merge
  let sellTone = 0, discovery = null;

  const sfx = {
    buy: () => Arcade.tone({ freq: 440, to: 660, dur: 0.1, type: 'triangle', vol: 0.05 }),
    merge: L => { Arcade.tone({ freq: 300 + L * 40, to: 600 + L * 60, dur: 0.14, type: 'triangle', vol: 0.05 }); Arcade.tone({ freq: 900 + L * 30, dur: 0.06, type: 'sine', vol: 0.03, delay: 0.08 }); },
    discover: () => [523, 659, 784, 1047, 1319].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.05, delay: i * 0.08 })),
    sell: () => Arcade.tone({ freq: Arcade.rand(1300, 1600), dur: 0.025, type: 'sine', vol: 0.012 }),
    tap: () => Arcade.tone({ freq: 700, to: 900, dur: 0.04, type: 'square', vol: 0.015 }),
    no: () => Arcade.tone({ freq: 220, to: 160, dur: 0.12, type: 'square', vol: 0.03 }),
    golden: () => [988, 1319, 1760].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.12, type: 'sine', vol: 0.05, delay: i * 0.06 })),
  };

  function burst(x, y, color, n = 16, speed = 180) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = Arcade.rand(speed * 0.4, speed);
      fx.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, life: Arcade.rand(0.4, 0.8), size: Arcade.rand(2, 4.5), color, shape: Math.random() < 0.5 ? 'square' : 'circle', spin: 8 });
    }
  }

  // ---------- Actions ----------

  function checkDiscovery(L) {
    if (L <= s.found) return;
    s.found = L;
    discovery = { L, t: 0 };
    sfx.discover();
    shake.add(0.25);
    if (L >= 5) Arcade.flag('sweet-works-cupcake');
    if (L >= 11) Arcade.flag('sweet-works-cake');
    if (L >= MAX_LV) Arcade.flag('sweet-works-castle');
  }

  function buyMachine() {
    const i = s.grid.findIndex((L, k) => k < s.slots && !L);
    const cost = machineCost();
    if (i < 0) { pops.add('No room! Merge machines', PX + PW / 2, 160, { color: '#ff8a7a', size: 15 }); sfx.no(); return; }
    if (s.cash < cost) { sfx.no(); return; }
    s.cash -= cost;
    s.bought++;
    s.grid[i] = Math.min(MAX_LV, 1 + s.supply);
    anim[i].spawn = 1;
    anim[i].t = 0;
    const p = slotXY(i);
    burst(p.x + SW / 2, p.y + SH / 2, '#ffffff', 10, 120);
    sfx.buy();
    checkDiscovery(s.grid[i]);
    if (s.grid.every(L => L > 0)) Arcade.flag('sweet-works-full');
  }

  function merge(from, to) {
    const L = s.grid[to] + 1;
    s.grid[to] = L;
    s.grid[from] = 0;
    anim[to].bounce = 1;
    anim[to].glow = 1;
    const p = slotXY(to);
    burst(p.x + SW / 2, p.y + SH / 2 - 10, machineColor(L), 22, 220);
    burst(p.x + SW / 2, p.y + SH / 2 - 10, '#ffffff', 8, 140);
    pops.add(`Lv ${L}!`, p.x + SW / 2, p.y + 10, { color: '#ffffff', size: 18 });
    sfx.merge(L);
    checkDiscovery(L);
  }

  function buySlot() {
    if (s.slots >= SLOTS || s.cash < slotCost()) { sfx.no(); return; }
    s.cash -= slotCost();
    const p = slotXY(s.slots);
    s.slots++;
    burst(p.x + SW / 2, p.y + SH / 2, '#ffe066', 18, 160);
    sfx.buy();
  }

  function buyUpgrade(u) {
    const lv = s[u.id], cost = u.cost(lv);
    if (lv >= u.max || s.cash < cost) { sfx.no(); return; }
    s.cash -= cost;
    s[u.id]++;
    sfx.buy();
    pops.add(`${u.icon} Lv ${s[u.id]}`, PX + PW / 2, 120, { color: '#8ef0a0', size: 16 });
  }

  function tapMachine(i) {
    const L = s.grid[i];
    anim[i].t += interval(L) * 0.3;
    anim[i].bounce = Math.max(anim[i].bounce, 0.5);
    const p = slotXY(i);
    for (let k = 0; k < 4; k++) fx.emit({ x: p.x + SW / 2 + Arcade.rand(-20, 20), y: p.y + 30, vy: Arcade.rand(-80, -40), vx: Arcade.rand(-30, 30), drag: 2, life: 0.4, size: 2, color: '#fff6b0', shape: 'spark' });
    sfx.tap();
  }

  function produce(i) {
    const L = s.grid[i], p = slotXY(i);
    anim[i].bounce = Math.max(anim[i].bounce, 0.6);
    crates.push({ L, golden: Math.random() < 0.02, x0: p.x + SW / 2, y0: p.y + 26, ty: p.y + SH / 2, t: 0, phase: 0, y: 0 });
  }

  function sellCrate(c) {
    const v = value(c.L) * (c.golden ? 10 : 1);
    s.cash += v;
    s.lifetime += v;
    s.run += v;
    const x = BELT_X, y = BELT_END + 6;
    if (c.golden || Math.random() < 0.35) pops.add('+' + money(v), x + Arcade.rand(-16, 16), y - 16, { color: c.golden ? '#ffd84a' : '#9be37a', size: c.golden ? 20 : 14, life: 0.8 });
    if (c.golden) {
      burst(x, y - 10, '#ffd84a', 26, 220);
      sfx.golden();
      Arcade.flag('sweet-works-golden');
    }
    if (sellTone <= 0) { sfx.sell(); sellTone = 0.09; }
  }

  function franchise() {
    const got = starsFor(s.run);
    if (got < 1) return;
    ui.show({
      title: '🏬 Open a franchise?',
      html: `<p>Sell this factory and start fresh in a bigger town.</p>
        <p class="big">+${got} ★</p>
        <ul><li>Each star makes every sweet sell for <b>+25%</b>, forever.</li>
        <li>You keep your stars and every sweet you've discovered.</li>
        <li>Machines, upgrades, slots and cash reset.</li></ul>`,
      button: 'Open it!',
      onAction: () => {
        const stars = s.stars + got, keepAuto = Math.min(s.auto, 1);
        s = fresh({ lifetime: s.lifetime, stars, found: s.found, franchises: s.franchises + 1, intro: true, auto: keepAuto });
        crates.length = 0;
        anim.forEach(a => { a.t = 0; a.bounce = 0; a.spawn = 0; });
        persist();
        Arcade.flag('sweet-works-franchise');
        Arcade.finish(ui, {
          score: score(),
          title: 'Franchise opened!',
          lines: [`You now have ${stars} ★: every sweet sells for +${stars * 25}%.`, ...(keepAuto ? ['Your Auto-merger came with you.'] : [])],
          button: 'Start building',
          onAction: () => ui.hide(),
        });
      },
    });
    // A second button to back out.
    const panel = overlayEl.querySelector('.panel');
    const back = document.createElement('button');
    back.className = 'btn';
    back.type = 'button';
    back.textContent = 'Not yet';
    back.style.marginLeft = '8px';
    back.style.background = 'var(--surface-2)';
    back.style.color = 'var(--text)';
    back.addEventListener('click', () => ui.hide());
    panel.appendChild(back);
  }

  // ---------- Input ----------

  let drag = null, mouse = null, buttons = [];
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  canvas.addEventListener('pointerdown', e => {
    if (!overlayEl.hidden) return;
    const p = toCanvas(e);
    for (const b of buttons) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        if (b.enabled) b.onClick(); else sfx.no();
        return;
      }
    }
    const i = slotAt(p.x, p.y);
    if (i < 0) return;
    if (i >= s.slots) { if (i === s.slots) buySlot(); return; }
    if (!s.grid[i]) return;
    drag = { i, sx: p.x, sy: p.y, x: p.x, y: p.y, moved: false, id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointermove', e => {
    const p = toCanvas(e);
    mouse = p;
    if (!drag || drag.id !== e.pointerId) return;
    drag.x = p.x; drag.y = p.y;
    if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 8) drag.moved = true;
  });
  canvas.addEventListener('pointerleave', () => { mouse = null; });
  function endDrag(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (e.type === 'pointercancel' || !s.grid[d.i]) return;
    if (!d.moved) { tapMachine(d.i); return; }
    const j = slotAt(d.x, d.y);
    if (j < 0 || j >= s.slots || j === d.i) return;
    if (!s.grid[j]) {
      s.grid[j] = s.grid[d.i];
      s.grid[d.i] = 0;
      [anim[j], anim[d.i]] = [anim[d.i], anim[j]];
      anim[j].spawn = 0.4;
    } else if (s.grid[j] === s.grid[d.i] && s.grid[j] < MAX_LV) {
      merge(d.i, j);
    } else {
      [s.grid[j], s.grid[d.i]] = [s.grid[d.i], s.grid[j]];
      [anim[j], anim[d.i]] = [anim[d.i], anim[j]];
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  addEventListener('keydown', e => {
    if (!overlayEl.hidden) return;
    if (e.code === 'KeyB') buyMachine();
  });

  // ---------- Update ----------

  let autoT = 0;
  function autoMerge(dt) {
    if (!s.auto) return;
    autoT += dt;
    if (autoT < AUTO_EVERY[s.auto]) return;
    autoT = 0;
    const busy = drag ? drag.i : -1;
    for (let L = 1; L < MAX_LV; L++) {
      const pair = [];
      for (let i = 0; i < s.slots && pair.length < 2; i++) if (s.grid[i] === L && i !== busy) pair.push(i);
      if (pair.length === 2) {
        const [to, from] = pair;
        const a = slotXY(from), b = slotXY(to);
        ghosts.push({ L, x0: a.x, y0: a.y, x1: b.x, y1: b.y, t: 0 });
        merge(from, to);
        return;
      }
    }
  }

  function update(dt) {
    time += dt;
    sellTone -= dt;
    for (let i = 0; i < SLOTS; i++) {
      const a = anim[i];
      a.bounce = Math.max(0, a.bounce - dt * 3.5);
      a.spawn = Math.max(0, a.spawn - dt * 3);
      a.glow = Math.max(0, a.glow - dt * 1.5);
      const L = s.grid[i];
      if (!L || (drag && drag.i === i && drag.moved)) continue;
      a.t += dt;
      const iv = interval(L);
      if (a.t >= iv) { a.t -= iv; if (a.t > iv) a.t = 0; produce(i); }
    }
    for (let k = crates.length - 1; k >= 0; k--) {
      const c = crates[k];
      if (c.phase === 0) {
        c.t += dt / 0.35;
        if (c.t >= 1) { c.phase = 1; c.y = c.ty; }
      } else {
        c.y += dt * (110 + s.speed * 6);
        if (c.y >= BELT_END) { sellCrate(c); crates.splice(k, 1); }
      }
    }
    for (let k = ghosts.length - 1; k >= 0; k--) { ghosts[k].t += dt / 0.25; if (ghosts[k].t >= 1) ghosts.splice(k, 1); }
    autoMerge(dt);
    fx.update(dt);
    pops.update(dt);
    shake.update(dt);
    if (discovery) { discovery.t += dt; if (discovery.t > 2.6) discovery = null; }
  }

  // ---------- Drawing ----------

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3b2f52');
    g.addColorStop(1, '#2a2340');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Checker floor under the machines.
    ctx.save();
    Gfx.roundRect(ctx, GX - 10, GY - 10, COLS * (SW + GAP) + 10, 4 * (SH + GAP) + 10, 16);
    ctx.clip();
    for (let y = GY - 10; y < GY + 440; y += 36) for (let x = GX - 10; x < GX + 620; x += 36) {
      ctx.fillStyle = ((x - GX + 10) / 36 + (y - GY + 10) / 36) % 2 ? '#4a3d66' : '#433760';
      ctx.fillRect(x, y, 36, 36);
    }
    ctx.restore();
  }

  function drawCollection() {
    Gfx.text(ctx, `Sweets ${s.found}/${MAX_LV}`, GX, 24, { size: 14, align: 'left', color: '#ffe3f0', stroke: null });
    if (s.stars) Gfx.text(ctx, `★ ${s.stars}`, GX + 112, 24, { size: 14, align: 'left', color: '#ffd84a', stroke: null });
    for (let k = 0; k < MAX_LV; k++) {
      const x = GX + k * 30.2 + 13, y = 54;
      const got = k < s.found;
      ctx.fillStyle = got ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.25)';
      Gfx.roundRect(ctx, x - 13, y - 13, 26, 26, 7);
      ctx.fill();
      if (got) Gfx.text(ctx, SWEETS[k][0], x, y + 1, { size: 16, stroke: null });
      else Gfx.text(ctx, '?', x, y + 1, { size: 13, color: 'rgba(255,255,255,0.3)', stroke: null });
    }
  }

  // One machine: a chunky candy-coloured box with a window showing what it makes.
  function drawMachine(x, y, L, { scale = 1, progress = 0, bounce = 0, glow = 0, lifted = false } = {}) {
    const c = machineColor(L);
    const sq = Math.sin(bounce * Math.PI) * bounce;
    ctx.save();
    ctx.translate(x + SW / 2, y + SH - 8);
    ctx.scale(scale * (1 + sq * 0.08), scale * (1 - sq * 0.1));
    if (lifted) Gfx.shadow(ctx, 10, 14, 52, 12, 0.45);
    else Gfx.shadow(ctx, 4, 2, 46, 9, 0.35);
    if (glow > 0) {
      const gg = ctx.createRadialGradient(0, -36, 10, 0, -36, 70);
      gg.addColorStop(0, Gfx.alpha('#ffffff', 0.5 * glow));
      gg.addColorStop(1, Gfx.alpha('#ffffff', 0));
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(0, -36, 70, 0, TAU); ctx.fill();
    }
    // Funnel on top.
    ctx.fillStyle = Gfx.shade(c, -0.3);
    ctx.beginPath(); ctx.moveTo(-14, -74); ctx.lineTo(14, -74); ctx.lineTo(9, -64); ctx.lineTo(-9, -64); ctx.fill();
    ctx.fillStyle = Gfx.shade(c, 0.35);
    Gfx.roundRect(ctx, -16, -80, 32, 8, 3); ctx.fill();
    // Body: a dark back edge, a light top face, then the front.
    ctx.fillStyle = Gfx.shade(c, -0.4);
    Gfx.roundRect(ctx, -42, -64, 84, 64, 10);
    ctx.fill();
    const top = ctx.createLinearGradient(0, -64, 0, -42);
    top.addColorStop(0, Gfx.shade(c, 0.35));
    top.addColorStop(1, Gfx.shade(c, 0.15));
    ctx.fillStyle = top;
    Gfx.roundRect(ctx, -41, -63, 82, 22, 9);
    ctx.fill();
    const front = ctx.createLinearGradient(-42, -40, 42, 0);
    front.addColorStop(0, Gfx.shade(c, -0.05));
    front.addColorStop(1, Gfx.shade(c, -0.28));
    ctx.fillStyle = front;
    Gfx.roundRect(ctx, -42, -44, 84, 44, 9);
    ctx.fill();
    // Window with the sweet.
    ctx.fillStyle = 'rgba(20,16,36,0.55)';
    ctx.beginPath(); ctx.arc(0, -26, 17, 0, TAU); ctx.fill();
    ctx.strokeStyle = Gfx.shade(c, 0.45);
    ctx.lineWidth = 3;
    ctx.stroke();
    Gfx.text(ctx, SWEETS[L - 1][0], 0, -25, { size: 20, stroke: null });
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(-6, -33, 4, 0, TAU); ctx.fill();
    // Level badge.
    ctx.fillStyle = '#2b2340';
    ctx.beginPath(); ctx.arc(-34, -60, 11, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    Gfx.text(ctx, String(L), -34, -59.5, { size: 11, stroke: null });
    // Progress strip.
    if (progress >= 0) Gfx.bar(ctx, -30, -6, 60, 4, progress, '#ffffff', 'rgba(0,0,0,0.3)');
    ctx.restore();
  }

  function drawSlots() {
    const same = drag && drag.moved ? s.grid[drag.i] : 0;
    for (let i = 0; i < SLOTS; i++) {
      const p = slotXY(i), L = s.grid[i];
      const open = i < s.slots;
      ctx.fillStyle = open ? 'rgba(20,14,34,0.35)' : 'rgba(10,8,18,0.5)';
      Gfx.roundRect(ctx, p.x, p.y, SW, SH, 12);
      ctx.fill();
      ctx.strokeStyle = open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (!open) {
        if (i === s.slots) {
          const can = s.cash >= slotCost();
          Gfx.text(ctx, '🔒', p.x + SW / 2, p.y + SH / 2 - 12, { size: 20, stroke: null });
          Gfx.text(ctx, money(slotCost()), p.x + SW / 2, p.y + SH / 2 + 16, { size: 13, color: can ? '#8ef0a0' : '#9a8fb5', stroke: null });
        } else Gfx.text(ctx, '🔒', p.x + SW / 2, p.y + SH / 2, { size: 16, stroke: null, color: 'rgba(255,255,255,0.25)' });
        continue;
      }
      // While dragging, light up every machine it could merge with.
      if (same && L === same && i !== drag.i && L < MAX_LV) {
        ctx.strokeStyle = Gfx.alpha('#ffe066', 0.6 + Math.sin(time * 10) * 0.3);
        ctx.lineWidth = 3;
        Gfx.roundRect(ctx, p.x + 2, p.y + 2, SW - 4, SH - 4, 11);
        ctx.stroke();
      }
      if (drag && drag.moved && slotAt(drag.x, drag.y) === i && i !== drag.i) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        Gfx.roundRect(ctx, p.x, p.y, SW, SH, 12);
        ctx.fill();
      }
      if (!L || (drag && drag.moved && drag.i === i)) continue;
      const a = anim[i];
      const pop = a.spawn > 0 ? Math.max(0.05, Gfx.ease.outBack(1 - a.spawn)) : 1;
      drawMachine(p.x, p.y, L, { scale: pop, progress: Math.min(1, a.t / interval(L)), bounce: a.bounce, glow: a.glow });
    }
    for (const g of ghosts) {
      const k = Gfx.ease.inQuad(g.t);
      ctx.globalAlpha = 1 - k * 0.6;
      drawMachine(Gfx.lerp(g.x0, g.x1, k), Gfx.lerp(g.y0, g.y1, k), g.L, { scale: 1 - k * 0.3, progress: -1 });
      ctx.globalAlpha = 1;
    }
  }

  function drawBelt() {
    // Rails with hazard stripes.
    ctx.fillStyle = '#2b2533';
    ctx.fillRect(BELT_X - 24, BELT_TOP, 48, BELT_END - BELT_TOP + 20);
    ctx.fillStyle = '#4a4458';
    ctx.fillRect(BELT_X - 18, BELT_TOP, 36, BELT_END - BELT_TOP + 20);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    const off = (time * (110 + s.speed * 6)) % 14;
    for (let y = BELT_TOP + off; y < BELT_END + 20; y += 14) { ctx.beginPath(); ctx.moveTo(BELT_X - 18, y); ctx.lineTo(BELT_X + 18, y); ctx.stroke(); }
    for (const side of [-24, 18]) {
      ctx.save();
      ctx.beginPath(); ctx.rect(BELT_X + side, BELT_TOP, 6, BELT_END - BELT_TOP + 20); ctx.clip();
      for (let y = BELT_TOP - 12; y < BELT_END + 20; y += 12) {
        ctx.fillStyle = (y / 12) % 2 ? '#ffd23f' : '#2b2533';
        ctx.beginPath(); ctx.moveTo(BELT_X + side, y); ctx.lineTo(BELT_X + side + 6, y + 6); ctx.lineTo(BELT_X + side + 6, y + 12); ctx.lineTo(BELT_X + side, y + 6); ctx.fill();
      }
      ctx.restore();
    }
    // Shipping dock.
    Gfx.box(ctx, BELT_X - 34, BELT_END + 6, 68, 24, 22, '#6b5a8a', 6);
    Gfx.text(ctx, '📦 SHIP', BELT_X, BELT_END - 4, { size: 11, color: '#fff', stroke: 'rgba(0,0,0,0.4)', width: 3 });
  }

  function drawCrate(x, y, L, golden, k = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    if (golden) {
      const g = ctx.createRadialGradient(0, -6, 2, 0, -6, 26);
      g.addColorStop(0, 'rgba(255,220,90,0.6)');
      g.addColorStop(1, 'rgba(255,220,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -6, 26, 0, TAU); ctx.fill();
    }
    Gfx.box(ctx, -13, -4, 26, 12, 12, golden ? '#f2c232' : '#c99a5b', 3);
    ctx.fillStyle = golden ? '#fff1a8' : '#e9d3a5';
    ctx.fillRect(-2, -16, 4, 24);
    Gfx.text(ctx, SWEETS[L - 1][0], 0, -11, { size: 12, stroke: null });
    ctx.restore();
  }

  function drawCrates() {
    for (const c of crates) {
      if (c.phase === 0) {
        const k = Gfx.ease.inOutCubic(Math.min(1, c.t));
        const x = Gfx.lerp(c.x0, BELT_X, k), y = Gfx.lerp(c.y0, c.ty, k) - Math.sin(k * Math.PI) * 40;
        drawCrate(x, y, c.L, c.golden, 0.7 + 0.3 * k);
      } else drawCrate(BELT_X, c.y, c.L, c.golden);
    }
  }

  // ---------- Panel ----------

  function button(x, y, w, h, { enabled, primary = false, onClick, draw }) {
    const hov = enabled && mouse && mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
    ctx.save();
    if (enabled) {
      ctx.shadowColor = primary ? 'rgba(255,120,180,0.5)' : 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = primary ? 16 : 8;
      ctx.shadowOffsetY = 3;
    }
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    if (primary && enabled) { g.addColorStop(0, hov ? '#ff9cc6' : '#ff8ab9'); g.addColorStop(1, '#e85a98'); }
    else if (enabled) { g.addColorStop(0, hov ? '#544673' : '#4a3d66'); g.addColorStop(1, hov ? '#43375e' : '#3b3054'); }
    else { g.addColorStop(0, '#30283f'); g.addColorStop(1, '#2a2338'); }
    ctx.fillStyle = g;
    Gfx.roundRect(ctx, x, y - (hov ? 1 : 0), w, h, 10);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = primary && enabled ? 'rgba(255,230,240,0.6)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    Gfx.roundRect(ctx, x + 0.5, y + 0.5 - (hov ? 1 : 0), w - 1, h - 1, 10);
    ctx.stroke();
    ctx.globalAlpha = enabled ? 1 : 0.7;
    draw(x, y - (hov ? 1 : 0), enabled);
    ctx.globalAlpha = 1;
    buttons.push({ x, y, w, h, enabled, onClick });
  }

  function drawPanel() {
    buttons = [];
    Gfx.card(ctx, PX, 10, PW, 62, { fill: 'rgba(20,14,34,0.7)', r: 12 });
    Gfx.text(ctx, money(s.cash), PX + 14, 36, { size: 24, align: 'left', color: '#ffe066', stroke: null });
    Gfx.text(ctx, `+${money(income())}/s`, PX + 14, 58, { size: 12, align: 'left', color: '#9be37a', stroke: null, weight: 700 });
    Gfx.text(ctx, `Earned ${money(s.lifetime)}`, PX + PW - 12, 58, { size: 11, align: 'right', color: '#b9aed6', stroke: null, weight: 600 });

    const cost = machineCost(), L = Math.min(MAX_LV, 1 + s.supply);
    const room = s.grid.some((v, k) => k < s.slots && !v);
    button(PX, 82, PW, 56, {
      enabled: s.cash >= cost && room, primary: true, onClick: buyMachine,
      draw: (x, y, on) => {
        Gfx.text(ctx, SWEETS[L - 1][0], x + 28, y + 28, { size: 24, stroke: null });
        Gfx.text(ctx, `Buy machine · Lv ${L}`, x + 52, y + 21, { size: 14, align: 'left', color: on ? '#3a0d22' : '#e6dcf7', stroke: null });
        Gfx.text(ctx, room ? money(cost) : 'No room: merge some!', x + 52, y + 40, { size: 13, align: 'left', color: on ? '#5c1a3a' : room ? '#ff9cc6' : '#ff8a7a', stroke: null, weight: 700 });
      },
    });

    UPS.forEach((u, k) => {
      const lv = s[u.id], max = lv >= u.max, c = u.cost(lv), y = 148 + k * 60;
      button(PX, y, PW, 54, {
        enabled: !max && s.cash >= c, onClick: () => buyUpgrade(u),
        draw: (x, yy) => {
          Gfx.text(ctx, u.icon, x + 22, yy + 27, { size: 20, stroke: null });
          Gfx.text(ctx, u.name, x + 42, yy + 18, { size: 13, align: 'left', stroke: null });
          Gfx.text(ctx, `Lv ${lv}`, x + 46 + ctx.measureText(u.name).width, yy + 18, { size: 11, align: 'left', color: '#ffb6d5', stroke: null });
          Gfx.text(ctx, max ? 'MAX' : money(c), x + PW - 12, yy + 37, { size: 13, align: 'right', color: !max && s.cash >= c ? '#8ef0a0' : '#9a8fb5', stroke: null });
          const costW = ctx.measureText(max ? 'MAX' : money(c)).width;
          ctx.save();
          ctx.beginPath(); ctx.rect(x + 40, yy + 26, PW - 60 - costW, 20); ctx.clip();
          Gfx.text(ctx, u.show(max ? lv : lv + 1), x + 42, yy + 37, { size: 11, align: 'left', color: '#b9aed6', stroke: null, weight: 600 });
          ctx.restore();
        },
      });
    });

    // Franchise: a progress bar until it's worth it, then a button.
    const y = 392, got = starsFor(s.run);
    if (got >= 1) {
      button(PX, y, PW, 56, {
        enabled: true, primary: true, onClick: franchise,
        draw: (x, yy) => {
          Gfx.text(ctx, '🏬', x + 26, yy + 28, { size: 22, stroke: null });
          Gfx.text(ctx, 'Open a franchise', x + 50, yy + 21, { size: 14, align: 'left', color: '#3a0d22', stroke: null });
          Gfx.text(ctx, `Restart for +${got} ★ (+${got * 25}% sales)`, x + 50, yy + 40, { size: 11, align: 'left', color: '#5c1a3a', stroke: null, weight: 700 });
        },
      });
    } else {
      Gfx.card(ctx, PX, y, PW, 56, { fill: 'rgba(20,14,34,0.55)', r: 10 });
      Gfx.text(ctx, '🏬 Franchise', PX + 14, y + 18, { size: 13, align: 'left', color: '#d9cff0', stroke: null });
      Gfx.text(ctx, `at ${money(FRANCHISE_AT)} earned`, PX + PW - 12, y + 18, { size: 11, align: 'right', color: '#9a8fb5', stroke: null, weight: 600 });
      Gfx.bar(ctx, PX + 14, y + 33, PW - 28, 10, s.run / FRANCHISE_AT, '#ff8ab9', 'rgba(0,0,0,0.35)');
    }
    Gfx.text(ctx, 'Drag matching machines together to merge', PX + PW / 2, 470, { size: 11, color: '#b9aed6', stroke: null, weight: 600 });
    Gfx.text(ctx, 'Tap a machine to speed it up · B buys', PX + PW / 2, 488, { size: 11, color: '#8a80a6', stroke: null, weight: 600 });
  }

  function drawDiscovery() {
    if (!discovery) return;
    const t = discovery.t, k = t < 0.4 ? Gfx.ease.outBack(t / 0.4) : t > 2.2 ? 1 - (t - 2.2) / 0.4 : 1;
    const [icon, name] = SWEETS[discovery.L - 1];
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, t > 2.2 ? k : 1));
    ctx.fillStyle = 'rgba(15,10,28,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(330, 290);
    ctx.scale(Math.max(0.01, k), Math.max(0.01, k));
    ctx.rotate(Math.sin(time * 2) * 0.02);
    const rays = ctx.createRadialGradient(0, -20, 10, 0, -20, 170);
    rays.addColorStop(0, 'rgba(255,230,140,0.55)');
    rays.addColorStop(1, 'rgba(255,230,140,0)');
    ctx.fillStyle = rays;
    ctx.beginPath(); ctx.arc(0, -20, 170, 0, TAU); ctx.fill();
    ctx.save();
    ctx.rotate(time * 0.6);
    ctx.fillStyle = 'rgba(255,240,180,0.18)';
    for (let i = 0; i < 12; i++) { ctx.rotate(TAU / 12); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-14, -170); ctx.lineTo(14, -170); ctx.fill(); }
    ctx.restore();
    Gfx.text(ctx, 'NEW SWEET!', 0, -110, { size: 22, color: '#ffe066' });
    Gfx.text(ctx, icon, 0, -26, { size: 92, stroke: null });
    Gfx.text(ctx, name, 0, 60, { size: 28 });
    Gfx.text(ctx, `Level ${discovery.L} · sells for ${money(value(discovery.L))}`, 0, 92, { size: 15, color: '#ffd6e8' });
    ctx.restore();
  }

  function draw() {
    const o = shake.offset(6);
    ctx.save();
    ctx.translate(o.x, o.y);
    drawBackground();
    drawCollection();
    drawBelt();
    drawSlots();
    drawCrates();
    fx.draw(ctx);
    pops.draw(ctx);
    ctx.restore();
    drawPanel();
    if (drag && drag.moved && s.grid[drag.i]) drawMachine(drag.x - SW / 2, drag.y - SH / 2 - 10, s.grid[drag.i], { scale: 1.08, lifted: true, progress: -1 });
    drawDiscovery();
    const overMachine = mouse && (() => { const i = slotAt(mouse.x, mouse.y); return i >= 0 && (s.grid[i] || i === s.slots); })();
    const overButton = mouse && buttons.some(b => b.enabled && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h);
    canvas.style.cursor = drag && drag.moved ? 'grabbing' : overButton ? 'pointer' : overMachine ? 'grab' : '';
  }

  let shown = {};
  function updateStats() {
    const vals = { cash: money(s.cash), rate: money(income()) + '/s', found: `${s.found}/${MAX_LV}` };
    for (const k in vals) if (shown[k] !== vals[k]) { $(k).textContent = vals[k]; shown[k] = vals[k]; }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (overlayEl.hidden) update(dt);
    else time += dt;
    draw();
    updateStats();
    requestAnimationFrame(frame);
  }

  // ---------- Start ----------

  loadSave();
  const away = Math.min(7200, (Date.now() - s.saved) / 1000);
  let awayEarned = 0;
  if (away > 60 && s.intro) {
    awayEarned = income() * away * 0.5;
    s.cash += awayEarned;
    s.lifetime += awayEarned;
    s.run += awayEarned;
  }
  setInterval(persist, 5000);
  addEventListener('pagehide', persist);
  Arcade.onBlur(() => {
    persist();
    if (overlayEl.hidden) ui.show({ title: 'Paused', html: '<p>The machines are waiting for you.</p>', button: 'Resume', onAction: () => ui.hide() });
  });

  const tips = `<ul>
      <li><b>Buy machines</b>: each one makes sweets that ride the conveyor to be shipped and sold.</li>
      <li><b>Drag</b> a machine onto another of the <b>same level</b> to merge them into a better one.</li>
      <li>Every new level is a <b>new sweet</b>. Can you discover all ${MAX_LV}?</li>
      <li><b>Tap</b> a machine to speed it up. Unlock more floor space by tapping the 🔒 slot.</li>
      <li>Earn ${money(FRANCHISE_AT)} to open a <b>franchise</b> for permanent ★ bonuses.</li>
    </ul>`;
  if (!s.intro) {
    ui.show({ title: '🍬 Sweet Works', html: `<p>Build the sweetest factory in town.</p>${tips}`, button: 'Start the machines', onAction: () => { s.intro = true; persist(); ui.hide(); } });
  } else if (awayEarned > 0) {
    ui.show({ title: 'Welcome back!', html: `<p>Your machines kept running while you were away.</p><p class="big">+${money(awayEarned)}</p>`, button: 'Back to the factory', onAction: () => ui.hide() });
  } else {
    ui.show({ title: '🍬 Sweet Works', html: `<p>${money(s.cash)} in the till · ${s.found}/${MAX_LV} sweets found</p>${tips}`, button: 'Back to the factory', onAction: () => ui.hide() });
  }
  requestAnimationFrame(frame);
})();
