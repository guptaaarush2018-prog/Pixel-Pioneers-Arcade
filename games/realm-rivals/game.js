(() => {
  const W = 960, H = 540;
  const SIDE_X = 600;
  const PLOTS = 8;
  const MARCH = 7;               // seconds each way
  const CASTLE_MAX = 100;

  const BUILDS = {
    farm: { name: 'Farm', cost: 50, color: '#8bc34a', tag: 'food', desc: lv => `+${1.5 * lv} food/s` },
    mine: { name: 'Mine', cost: 60, color: '#b0a089', tag: 'gold', desc: lv => `+${2 * lv} gold/s` },
    house: { name: 'Houses', cost: 60, color: '#d7a86e', tag: 'army room', desc: lv => `+${8 * lv} army room` },
    barracks: { name: 'Barracks', cost: 90, color: '#c0504d', tag: 'troops', desc: lv => `Training speed ×${lv}${lv < 2 ? ' · level 2 unlocks archers' : lv < 3 ? ' · level 3 unlocks knights' : ''}` },
    wall: { name: 'Walls', cost: 100, color: '#9aa3ad', tag: 'defence', desc: lv => `+${15 * lv}% defence` },
    tower: { name: 'Watchtower', cost: 120, color: '#5b7fbf', tag: 'defence', desc: lv => `+${35 * lv} defence power` },
  };
  const MAX_LV = 5;
  const upgradeCost = (type, lv) => Math.round(BUILDS[type].cost * Math.pow(1.7, lv));

  const UNITS = [
    { id: 'soldier', name: 'Soldier', gold: 20, food: 20, power: 10, upkeep: 0.04, time: 3, needs: 1 },
    { id: 'archer', name: 'Archer', gold: 30, food: 30, power: 15, upkeep: 0.06, time: 4, needs: 2, guard: 1.6 },
    { id: 'knight', name: 'Knight', gold: 80, food: 70, power: 42, upkeep: 0.15, time: 7, needs: 3 },
  ];

  const RIVALS = [
    { name: 'Ashford', color: '#e0a040', x: 690, y: 60, power: 60 },
    { name: 'Mirevale', color: '#4fb3a9', x: 880, y: 50, power: 110 },
    { name: 'Stonecrest', color: '#9aa3ad', x: 920, y: 150, power: 190 },
    { name: 'Duskhold', color: '#9b6bd6', x: 820, y: 190, power: 300 },
    { name: 'Emberreach', color: '#ff5d5d', x: 670, y: 180, power: 460 },
  ];
  const HOME = { x: 780, y: 125 };

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';
  let k;            // the kingdom
  let speed = 1;
  let buttons = [];
  let selection = { kind: 'none' };

  function newGame() {
    k = {
      gold: 120, food: 80, glory: 0, castle: CASTLE_MAX, time: 0,
      plots: Array.from({ length: PLOTS }, () => null),
      army: { soldier: 3, archer: 0, knight: 0 },
      queue: [], trainT: 0,
      march: null,          // { target, army, t, phase: 'out' | 'back', loot }
      raid: null,           // { from, power, t }
      raidT: 110,
      rivals: RIVALS.map(r => ({ ...r, hp: 100, conquered: false })),
      log: [], wins: 0, defended: 0,
    };
    k.plots[0] = { type: 'farm', lv: 1 };
    k.plots[1] = { type: 'mine', lv: 1 };
    k.plots[2] = { type: 'barracks', lv: 1 };
    selection = { kind: 'none' };
    say('Your kingdom is founded. Build, train, and conquer all five rivals.');
  }

  function say(text, color = '#cfd4dc') {
    k.log.unshift({ text, color });
    k.log.length = Math.min(k.log.length, 6);
  }

  // ---------- Economy ----------

  const level = type => k.plots.reduce((s, p) => s + (p && p.type === type ? p.lv : 0), 0);
  const armyCount = army => UNITS.reduce((s, u) => s + (army[u.id] || 0), 0);
  const armyRoom = () => 10 + level('house') * 8;
  const queued = () => k.queue.length;
  const armyPower = (army, defending) => UNITS.reduce((s, u) => s + (army[u.id] || 0) * u.power * (defending && u.guard ? u.guard : 1), 0);
  const defence = () => (armyPower(k.army, true) + level('tower') * 35) * (1 + level('wall') * 0.15);
  const tribute = () => k.rivals.filter(r => r.conquered).length * 3;

  function tick(dt) {
    k.time += dt;
    k.gold += (level('mine') * 2 + tribute()) * dt;
    const upkeep = UNITS.reduce((s, u) => s + (k.army[u.id] + (k.march?.army[u.id] || 0)) * u.upkeep, 0);
    k.food += (level('farm') * 1.5 - upkeep) * dt;
    if (k.food < 0) {
      k.food = 0;
      // Hungry troops desert, cheapest first.
      const u = UNITS.find(u => k.army[u.id] > 0);
      if (u && Math.random() < dt * 0.5) {
        k.army[u.id]--;
        say(`Hungry ${u.name.toLowerCase()} deserted. Build more farms!`, '#ff9a7a');
      }
    }
    k.castle = Math.min(CASTLE_MAX, k.castle + dt * 0.25);

    // Training.
    if (k.queue.length) {
      k.trainT += dt * Math.max(1, level('barracks'));
      const u = UNITS.find(u => u.id === k.queue[0]);
      if (k.trainT >= u.time) {
        k.trainT = 0;
        k.queue.shift();
        k.army[u.id]++;
        Arcade.tone({ freq: 600, dur: 0.05, vol: 0.03 });
      }
    }

    // Rivals grow stronger over time.
    for (const r of k.rivals) if (!r.conquered) r.power += r.power * 0.0015 * dt;

    tickMarch(dt);
    tickRaid(dt);
  }

  function train(u) {
    if (k.gold < u.gold || k.food < u.food || level('barracks') < u.needs) return;
    if (armyCount(k.army) + armyCount(k.march?.army || {}) + queued() >= armyRoom()) {
      say('No room for more troops. Build or upgrade houses.', '#ff9a7a');
      return;
    }
    k.gold -= u.gold;
    k.food -= u.food;
    k.queue.push(u.id);
    Arcade.tone({ freq: 440, dur: 0.05, vol: 0.03 });
  }

  function build(i, type) {
    const cost = upgradeCost(type, 0);
    if (k.gold < cost || k.plots[i]) return;
    k.gold -= cost;
    k.plots[i] = { type, lv: 1 };
    Arcade.tone({ freq: 330, to: 660, dur: 0.12, type: 'triangle', vol: 0.04 });
  }

  function upgrade(i) {
    const p = k.plots[i];
    if (!p || p.lv >= MAX_LV || k.gold < upgradeCost(p.type, p.lv)) return;
    const cost = upgradeCost(p.type, p.lv);
    k.gold -= cost;
    p.lv++;
    Arcade.tone({ freq: 440, to: 880, dur: 0.15, type: 'triangle', vol: 0.04 });
  }

  // ---------- War ----------

  function attack(r) {
    if (k.march || r.conquered || !armyCount(k.army)) return;
    k.march = { target: r, army: { ...k.army }, t: 0, phase: 'out', loot: null };
    for (const u of UNITS) k.army[u.id] = 0;
    say(`Your army marches on ${r.name}.`);
    Arcade.tone({ freq: 220, to: 330, dur: 0.2, type: 'sawtooth', vol: 0.04 });
  }

  function loseShare(army, share) {
    for (const u of UNITS) army[u.id] = Math.max(0, Math.round(army[u.id] * (1 - share)));
  }

  function tickMarch(dt) {
    const m = k.march;
    if (!m) return;
    m.t += dt;
    if (m.t < MARCH) return;
    if (m.phase === 'out') {
      const r = m.target;
      const atk = armyPower(m.army) * Arcade.rand(0.85, 1.15);
      const def = r.power;
      if (atk > def) {
        loseShare(m.army, Math.min(0.8, (def / atk) * 0.5));
        const gold = Math.round(30 + r.power * 0.6), food = Math.round(20 + r.power * 0.35);
        m.loot = { gold, food };
        r.power *= 0.72;
        r.hp -= 34;
        k.wins++;
        k.glory += Math.round(gold / 2) + 100;
        if (r.hp <= 0) {
          r.conquered = true;
          k.glory += 600;
          say(`${r.name} has fallen! It now pays you tribute.`, '#ffc53d');
          Arcade.tone({ freq: 523, to: 1046, dur: 0.4, type: 'triangle', vol: 0.06 });
        } else {
          say(`Victory at ${r.name}! Your troops carry home ${gold} gold and ${food} food.`, '#9be37a');
          Arcade.tone({ freq: 523, to: 784, dur: 0.25, type: 'triangle', vol: 0.05 });
        }
      } else {
        loseShare(m.army, Math.min(0.95, 0.55 + (def - atk) / def));
        r.power *= 0.92;
        say(`Defeat at ${r.name}. The survivors retreat.`, '#ff9a7a');
        Arcade.tone({ freq: 300, to: 120, dur: 0.4, type: 'sawtooth', vol: 0.04 });
      }
      m.phase = 'back';
      m.t = 0;
      return;
    }
    for (const u of UNITS) k.army[u.id] += m.army[u.id];
    if (m.loot) {
      k.gold += m.loot.gold;
      k.food += m.loot.food;
    }
    k.march = null;
    if (k.rivals.every(r => r.conquered)) victory();
  }

  function tickRaid(dt) {
    if (!k.raid) {
      k.raidT -= dt;
      const live = k.rivals.filter(r => !r.conquered);
      if (k.raidT <= 0 && live.length) {
        // Stronger rivals raid more often as the game goes on.
        const from = live[Math.floor(Math.random() * Math.min(live.length, 1 + Math.floor(k.time / 90)))];
        k.raid = { from, power: from.power * Arcade.rand(0.45, 0.65), t: 12 };
        say(`${from.name} is marching on you! They arrive in 12 seconds.`, '#ff9a7a');
        Arcade.tone({ freq: 880, to: 440, dur: 0.3, type: 'square', vol: 0.04 });
      }
      return;
    }
    k.raid.t -= dt;
    if (k.raid.t > 0) return;
    const { from, power } = k.raid;
    const def = defence() * Arcade.rand(0.9, 1.1);
    if (def >= power) {
      loseShare(k.army, Math.min(0.6, (power / def) * 0.35));
      from.power *= 0.85;
      k.glory += 200;
      k.defended++;
      say(`You held off ${from.name}'s raid!`, '#9be37a');
      Arcade.tone({ freq: 523, to: 784, dur: 0.25, type: 'triangle', vol: 0.05 });
    } else {
      loseShare(k.army, 0.3);
      k.gold *= 0.8;
      k.food *= 0.8;
      k.castle -= 20 + Math.min(20, (power - def) / 10);
      say(`${from.name} broke through, looted your stores and damaged the castle.`, '#ff7a7a');
      Arcade.tone({ freq: 200, to: 60, dur: 0.5, type: 'sawtooth', vol: 0.05 });
    }
    k.raid = null;
    k.raidT = Arcade.rand(50, 75) - Math.min(20, k.time / 30);
    if (k.castle <= 0) defeat();
  }

  // ---------- Flow ----------

  function victory() {
    state = 'over';
    const bonus = Math.max(0, Math.round(3000 - k.time * 3));
    const score = Math.round(k.glory + 2000 + bonus);
    Arcade.flag('realm-rivals-win');
    Arcade.finish(ui, {
      score, title: 'All realms are yours!',
      lines: [`Conquered in ${fmtTime(k.time)} · ${k.wins} victories · ${k.defended} raids held off`],
      onAction: start,
    });
  }

  function defeat() {
    state = 'over';
    Arcade.finish(ui, {
      score: Math.round(k.glory), title: 'Your castle has fallen',
      lines: [`${k.rivals.filter(r => r.conquered).length} of 5 realms conquered · lasted ${fmtTime(k.time)}`],
      onAction: start,
    });
  }

  const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  function start() {
    newGame();
    speed = 1;
    state = 'playing';
    ui.hide();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: () => { state = 'playing'; ui.hide(); } });
  }
  Arcade.onBlur(pause);
  window.addEventListener('keydown', e => { if (e.code === 'KeyP' || e.code === 'Escape') pause(); });

  // ---------- Immediate-mode buttons ----------

  function button(x, y, w, h, label, { enabled = true, active = false, sub = '', onClick }) {
    ctx.fillStyle = active ? '#2b3446' : enabled ? '#232833' : '#1a1d24';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? '#ffc53d' : '#2f3540';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = enabled ? '#eceef2' : '#5c6370';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 8, y + (sub ? 17 : h / 2 + 5));
    if (sub) {
      ctx.fillStyle = enabled ? '#ffc53d' : '#5c6370';
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText(sub, x + 8, y + 32);
    }
    buttons.push({ x, y, w, h, enabled, onClick });
  }

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    for (const b of buttons) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        if (b.enabled) b.onClick();
        return;
      }
    }
  });

  // ---------- Drawing ----------

  const plotRect = i => {
    const col = i % 4, row = Math.floor(i / 4);
    return { x: 30 + col * 140, y: 250 + row * 140, w: 120, h: 120 };
  };

  function drawVillage() {
    ctx.fillStyle = '#25381f';
    ctx.fillRect(0, 0, SIDE_X, H);
    ctx.fillStyle = '#2e4527';
    for (let i = 0; i < 40; i++) ctx.fillRect((i * 137) % SIDE_X, (i * 89) % H, 4, 4);

    // Castle.
    const cx = 300, cy = 120;
    ctx.fillStyle = '#7b8494';
    ctx.fillRect(cx - 80, cy - 40, 160, 90);
    for (const tx of [-90, 70]) ctx.fillRect(cx + tx, cy - 70, 20, 120);
    ctx.fillRect(cx - 20, cy - 90, 40, 50);
    ctx.fillStyle = '#4a5160';
    ctx.fillRect(cx - 14, cy + 10, 28, 40);
    ctx.fillStyle = '#4f8cff';
    ctx.fillRect(cx - 2, cy - 120, 4, 32);
    ctx.fillRect(cx + 2, cy - 120, 20, 12);
    // Castle health.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(cx - 80, cy + 62, 160, 8);
    ctx.fillStyle = k.castle > 40 ? '#9be37a' : '#ff7a7a';
    ctx.fillRect(cx - 80, cy + 62, 160 * (k.castle / CASTLE_MAX), 8);
    ctx.fillStyle = '#cfd4dc';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Castle ${Math.ceil(k.castle)}/${CASTLE_MAX}`, cx, cy + 88);

    // Troops at home, drawn as little figures beside the castle.
    const home = UNITS.flatMap(u => Array(Math.min(20, k.army[u.id])).fill(u.id));
    home.slice(0, 30).forEach((id, i) => {
      const x = 40 + (i % 10) * 14, y = 40 + Math.floor(i / 10) * 18;
      ctx.fillStyle = id === 'knight' ? '#ffc53d' : id === 'archer' ? '#8bc34a' : '#4f8cff';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    });

    for (let i = 0; i < PLOTS; i++) {
      const r = plotRect(i), p = k.plots[i];
      const sel = selection.kind === 'plot' && selection.i === i;
      ctx.fillStyle = p ? '#3a2f22' : '#2a3a24';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = sel ? '#ffc53d' : '#41553a';
      ctx.lineWidth = sel ? 3 : 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      if (p) {
        const b = BUILDS[p.type];
        ctx.fillStyle = b.color;
        const s = 30 + p.lv * 8;
        ctx.fillRect(r.x + r.w / 2 - s / 2, r.y + 64 - s / 2, s, s * 0.7);
        ctx.beginPath();
        ctx.moveTo(r.x + r.w / 2 - s / 2 - 6, r.y + 64 - s / 2);
        ctx.lineTo(r.x + r.w / 2, r.y + 64 - s / 2 - 18);
        ctx.lineTo(r.x + r.w / 2 + s / 2 + 6, r.y + 64 - s / 2);
        ctx.fill();
        ctx.fillStyle = '#eceef2';
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${b.name} ${p.lv}`, r.x + r.w / 2, r.y + r.h - 8);
      } else {
        ctx.fillStyle = '#5c7052';
        ctx.font = '600 28px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('+', r.x + r.w / 2, r.y + r.h / 2 + 10);
      }
      buttons.push({ ...r, enabled: true, onClick: () => { selection = { kind: 'plot', i }; } });
    }

    // Incoming raid banner.
    if (k.raid) {
      ctx.fillStyle = 'rgba(255,93,93,0.9)';
      ctx.fillRect(160, 196, 280, 32);
      ctx.fillStyle = '#fff';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${k.raid.from.name} attacks in ${Math.ceil(k.raid.t)}s  ·  ~${Math.round(k.raid.power)} vs your ${Math.round(defence())}`, 300, 217);
    }
  }

  function drawMap() {
    ctx.fillStyle = '#1a2230';
    ctx.fillRect(SIDE_X, 0, W - SIDE_X, 240);
    const path = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    ctx.strokeStyle = '#2a3446';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    for (const r of k.rivals) path(HOME, r);
    ctx.setLineDash([]);

    ctx.fillStyle = '#4f8cff';
    ctx.fillRect(HOME.x - 10, HOME.y - 10, 20, 20);
    ctx.fillStyle = '#cfd4dc';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('You', HOME.x, HOME.y + 24);

    for (const r of k.rivals) {
      const sel = selection.kind === 'rival' && selection.r === r;
      ctx.fillStyle = r.conquered ? '#4f8cff' : r.color;
      ctx.beginPath();
      ctx.moveTo(r.x - 12, r.y + 10); ctx.lineTo(r.x - 12, r.y - 6); ctx.lineTo(r.x, r.y - 16); ctx.lineTo(r.x + 12, r.y - 6); ctx.lineTo(r.x + 12, r.y + 10);
      ctx.closePath();
      ctx.fill();
      if (sel) { ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = '#cfd4dc';
      ctx.fillText(r.name, r.x, r.y + 24);
      ctx.fillStyle = r.conquered ? '#4f8cff' : '#8d94a1';
      ctx.fillText(r.conquered ? 'yours' : `⚔ ${Math.round(r.power)}`, r.x, r.y + 37);
      buttons.push({ x: r.x - 30, y: r.y - 20, w: 60, h: 62, enabled: true, onClick: () => { selection = { kind: 'rival', r }; } });
    }

    const dot = (from, to, t, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 6, 0, Math.PI * 2);
      ctx.fill();
    };
    if (k.march) {
      const t = Math.min(1, k.march.t / MARCH);
      if (k.march.phase === 'out') dot(HOME, k.march.target, t, '#4f8cff');
      else dot(k.march.target, HOME, t, '#4f8cff');
    }
    if (k.raid) dot(k.raid.from, HOME, 1 - k.raid.t / 12, '#ff5d5d');
  }

  function drawPanel() {
    const x = SIDE_X + 12, w = W - SIDE_X - 24;
    ctx.fillStyle = '#161920';
    ctx.fillRect(SIDE_X, 240, W - SIDE_X, H - 240);
    ctx.textAlign = 'left';

    if (selection.kind === 'plot') {
      const i = selection.i, p = k.plots[i];
      ctx.fillStyle = '#eceef2';
      ctx.font = '700 14px system-ui, sans-serif';
      if (!p) {
        ctx.fillText('Build on this plot', x, 262);
        Object.entries(BUILDS).forEach(([type, b], n) => {
          const cost = upgradeCost(type, 0);
          button(x + (n % 3) * (w / 3 + 1), 272 + Math.floor(n / 3) * 44, w / 3 - 2, 40, b.name, {
            enabled: k.gold >= cost, sub: `${cost}g · ${b.tag}`, onClick: () => build(i, type),
          });
        });
      } else {
        const b = BUILDS[p.type];
        ctx.fillText(`${b.name} · level ${p.lv}`, x, 262);
        ctx.fillStyle = '#8d94a1';
        ctx.font = '500 12px system-ui, sans-serif';
        ctx.fillText(b.desc(p.lv), x, 282);
        if (p.lv < MAX_LV) {
          const cost = upgradeCost(p.type, p.lv);
          button(x, 294, w, 40, `Upgrade to level ${p.lv + 1}`, { enabled: k.gold >= cost, sub: `${cost} gold · ${b.desc(p.lv + 1)}`, onClick: () => upgrade(i) });
        } else {
          ctx.fillText('Fully upgraded.', x, 314);
        }
      }
    } else if (selection.kind === 'rival') {
      const r = selection.r;
      ctx.fillStyle = r.color;
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText(r.name, x, 262);
      ctx.fillStyle = '#8d94a1';
      ctx.font = '500 12px system-ui, sans-serif';
      if (r.conquered) {
        ctx.fillText('Conquered. Pays you 3 gold/s.', x, 282);
      } else {
        const mine = armyPower(k.army);
        ctx.fillText(`Defence ≈ ${Math.round(r.power)} · walls ${Math.max(0, Math.ceil(r.hp / 34))}/3 standing`, x, 282);
        ctx.fillText(`Your army at home: ${Math.round(mine)} power`, x, 298);
        const label = k.march ? 'Army is away' : !mine ? 'No troops at home' : mine > r.power * 1.15 ? 'Attack (good odds)' : mine > r.power * 0.85 ? 'Attack (risky)' : 'Attack (bad odds)';
        button(x, 308, w, 34, label, { enabled: !k.march && mine > 0, onClick: () => attack(r) });
      }
    } else {
      ctx.fillStyle = '#8d94a1';
      ctx.font = '500 12px system-ui, sans-serif';
      ctx.fillText('Tap a plot to build, or a realm on the map to attack.', x, 262);
      ctx.fillText('Troops at home defend you; archers defend best.', x, 280);
      ctx.fillText(`Defence ${Math.round(defence())} · Army room ${armyCount(k.army) + armyCount(k.march?.army || {}) + queued()}/${armyRoom()}`, x, 298);
    }

    // Training row, always visible.
    ctx.fillStyle = '#eceef2';
    ctx.font = '700 13px system-ui, sans-serif';
    const q = k.queue.length ? ` · training ${k.queue.length}` : '';
    ctx.fillText(`Train troops${q}`, x, 366);
    UNITS.forEach((u, n) => {
      const locked = level('barracks') < u.needs;
      button(x + n * (w / 3 + 1), 374, w / 3 - 2, 40, `${u.name} ${k.army[u.id]}`, {
        enabled: !locked && k.gold >= u.gold && k.food >= u.food,
        sub: locked ? `Barracks ${u.needs}` : `${u.gold}g ${u.food}f`,
        onClick: () => train(u),
      });
    });

    // Event log.
    k.log.slice(0, 5).forEach((l, n) => {
      ctx.fillStyle = l.color;
      ctx.globalAlpha = 1 - n * 0.16;
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText(l.text.length > 58 ? l.text.slice(0, 57) + '…' : l.text, x, 436 + n * 16);
    });
    ctx.globalAlpha = 1;

    button(W - 96, H - 30, 86, 24, `${speed}× speed`, { onClick: () => { speed = speed === 1 ? 2 : 1; } });
  }

  function updateHud() {
    const upkeep = UNITS.reduce((s, u) => s + (k.army[u.id] + (k.march?.army[u.id] || 0)) * u.upkeep, 0);
    const foodRate = level('farm') * 1.5 - upkeep;
    $('gold').textContent = Math.floor(k.gold);
    $('food').textContent = `${Math.floor(k.food)} (${foodRate >= 0 ? '+' : ''}${foodRate.toFixed(1)})`;
    $('army').textContent = Math.round(armyPower(k.army) + (k.march ? armyPower(k.march.army) : 0));
    $('glory').textContent = Math.round(k.glory);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state === 'playing') tick(dt * speed);
    buttons = [];
    drawVillage();
    drawMap();
    drawPanel();
    updateHud();
    requestAnimationFrame(frame);
  }

  newGame();
  ui.show({
    title: 'Realm Rivals',
    html: `<ul>
      <li><b>Farms</b> feed your army, <b>mines</b> pay for everything.</li>
      <li>Train troops at the <b>barracks</b>, then attack rivals on the map. Three wins topple a realm.</li>
      <li>Rivals raid you too. Troops at home, <b>walls</b> and <b>watchtowers</b> defend the castle.</li>
      <li>Conquer all five realms before your castle falls.</li>
    </ul>`,
    button: 'Found your kingdom',
    onAction: start,
  });
  requestAnimationFrame(frame);
})();
