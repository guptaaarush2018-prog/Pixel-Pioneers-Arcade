(() => {
  const ID = 'polarity-run';
  const W = 800, H = 400, CEIL = 70, FLOOR = 330, PS = 30, PX = 160, MID = (CEIL + FLOOR) / 2;
  const GRAVITY = 2800, FLIP_V = 150, BASE_SPEED = 360, MAX_SPEED = 880, SPIKE = 20;
  const PINK = '#ff4fd8', CYAN = '#3ef0ff', GOLD = '#ffd23f';
  const ZONE_LEN = 500;           // metres per zone
  const COMBO_TIME = 2, COMBO_MAX = 5;
  const CHARGE_EVERY = 10, CHARGE_MAX = 3;
  const SAW_R = 22, SAW_AMP = (FLOOR - CEIL) / 2 - 24, SAW_WAVE = 520;
  const BANK_KEY = 'polarity:bank', SKIN_KEY = 'polarity:skin', OWNED_KEY = 'polarity:skins';

  // Each zone changes the rules. After Low Gravity, Overdrive loops with everything mixed in
  // and a higher top speed every lap.
  const ZONES = [
    { name: 'Neon Gate', mix: { spike: 1 }, grav: 1, bg: ['#0b0a1a', '#1d1140'] },
    { name: 'Polarity Gates', mix: { spike: 0.55, gate: 0.45 }, grav: 1, bg: ['#0a1020', '#11264a'], tip: 'Match the wall\'s colour: pink on the floor, cyan on the ceiling' },
    { name: 'Saw Mill', mix: { spike: 0.5, saw: 0.5 }, grav: 1, bg: ['#160b0b', '#3a1420'], tip: 'Saws swing through the flip lane. Be on the side they aren\'t' },
    { name: 'Low Gravity', mix: { spike: 0.45, gate: 0.3, saw: 0.25 }, grav: 0.55, bg: ['#06121a', '#0f3340'], tip: 'Flips float. Start them early' },
    { name: 'Overdrive', mix: { spike: 0.4, gate: 0.3, saw: 0.3 }, grav: 1, bg: ['#120a1a', '#2e0f3d'], tip: 'Everything at once, faster every lap' },
  ];
  const zoneDef = z => ZONES[Math.min(z, ZONES.length - 1)];
  const lapOf = z => Math.max(0, z - (ZONES.length - 2));

  const POWERS = {
    shield: { color: '#7fb2ff', label: 'Shield', secs: 0 },
    magnet: { color: '#ff9f43', label: 'Magnet', secs: 8 },
    slow: { color: '#9bf6a5', label: 'Slow-mo', secs: 4 },
  };

  const SKINS = [
    { id: 'classic', name: 'Classic', cost: 0, top: '#ffffff', bottom: GOLD },
    { id: 'mint', name: 'Mint', cost: 150, top: '#e9fff4', bottom: '#3ddc97' },
    { id: 'ruby', name: 'Ruby', cost: 300, top: '#ffe1e1', bottom: '#ff4d6d' },
    { id: 'ghost', name: 'Ghost', cost: 600, top: '#ffffff', bottom: '#9aa6c7', ghost: true },
    { id: 'prism', name: 'Prism', cost: 1200, top: '#ffffff', bottom: '#b388ff', rainbow: true },
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  const stars = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Arcade.rand(CEIL, FLOOR), z: Arcade.rand(0.1, 0.5) }));

  let state = 'ready';
  let player, obstacles, pickups, particles, popups;
  let speed, distance, points, shardCount, time, lastEnd, need, genZone, bufferUntil, shake, scroll;
  let zone, combo, comboT, bestCombo, charges, power, powerT, invuln, banner, gatesPassed;

  function reset() {
    player = { y: FLOOR - PS, vy: 0, g: 1, grounded: true, rot: 0, squash: 0, trail: [] };
    obstacles = [];
    pickups = [];
    particles = [];
    popups = [];
    speed = BASE_SPEED;
    distance = 0;
    points = 0;
    shardCount = 0;
    time = 0;
    lastEnd = W + 200;
    need = 'floor';
    genZone = 0;
    bufferUntil = 0;
    shake = 0;
    scroll = 0;
    zone = 0;
    combo = 0;
    comboT = 0;
    bestCombo = 1;
    charges = 0;
    power = null;
    powerT = 0;
    invuln = 0;
    banner = { text: ZONES[0].name, sub: 'Zone 1', t: 2.2 };
    gatesPassed = 0;
    updateHud();
  }

  const metres = () => Math.floor(distance / 20);
  const zoneAt = worldPx => Math.floor(worldPx / 20 / ZONE_LEN);
  const gravity = () => GRAVITY * zoneDef(zone).grav;
  const mult = () => Math.min(COMBO_MAX, 1 + combo);
  const topSpeed = () => MAX_SPEED + lapOf(zone) * 60;

  // How long a flip takes in a zone, from one surface to the other.
  function flipTime(z) {
    const g = GRAVITY * zoneDef(z).grav, d = FLOOR - CEIL - PS;
    return (-FLIP_V + Math.sqrt(FLIP_V * FLIP_V + 2 * g * d)) / g;
  }

  // ---------- Level generation ----------
  // `need` is the side the player has to be on after the last thing generated. Whenever the next
  // obstacle needs the other side, the gap before it is long enough to flip at the current speed.

  function pickKind(mix) {
    let r = Math.random();
    for (const [k, w] of Object.entries(mix)) if ((r -= w) <= 0) return k;
    return 'spike';
  }

  function addObstacle() {
    const z = zoneAt(distance + (lastEnd - PX) + 200);
    if (z !== genZone) {
      // A breather at the start of every zone.
      genZone = z;
      lastEnd += 520;
      return;
    }
    const Z = zoneDef(z);
    const kind = pickKind(Z.mix);
    const next = Math.random() < (kind === 'spike' ? 0.55 : 0.5) ? (need === 'floor' ? 'ceil' : 'floor') : need;
    const switching = next !== need;
    const flipGap = speed * (flipTime(z) + 0.2) + 70;
    const gap = switching ? flipGap + Arcade.rand(0, 200) + (kind === 'gate' ? 40 : 0) : Arcade.rand(kind === 'spike' ? 30 : 60, 160);
    const x = lastEnd + gap;
    let w;

    if (kind === 'spike') {
      w = SPIKE * Arcade.randInt(2, 8);
      const tall = Math.random() < 0.25 + Math.min(0.2, time / 300);
      obstacles.push({ type: 'spike', x, w, h: tall ? Arcade.rand(80, 120) : 26, side: next === 'floor' ? 'ceil' : 'floor' });
    } else if (kind === 'gate') {
      w = 16;
      obstacles.push({ type: 'gate', x, w, need: next });
    } else {
      // A saw on a wave that's tied to its position on screen, so it reaches the player's column
      // at the far side from where they need to be, whatever the speed.
      w = SAW_R * 2;
      obstacles.push({ type: 'saw', x, w, phase: next === 'floor' ? Math.PI : 0 });
    }

    if (switching && Math.random() < 0.6) {
      const cx = lastEnd + gap / 2;
      for (const y of [140, 200, 260]) pickups.push({ kind: 'shard', x: cx, y });
    } else if (!switching && gap > 100) {
      const y = need === 'floor' ? FLOOR - 18 : CEIL + 18;
      const roll = Math.random();
      if (roll < 0.1) pickups.push({ kind: Arcade.pick(Object.keys(POWERS)), x: lastEnd + gap / 2, y });
      else if (roll < 0.5) pickups.push({ kind: 'shard', x: lastEnd + gap / 2, y });
    }
    lastEnd = x + w;
    need = next;
  }

  const sawY = o => MID + SAW_AMP * Math.cos(((o.x + SAW_R - PX - PS / 2) / SAW_WAVE) * Math.PI * 2 + o.phase);

  // ---------- Flipping ----------

  function flip() {
    if (state !== 'playing') return;
    if (player.grounded) return doFlip();
    // Close to landing: buffer the flip for the moment you touch down. Otherwise spend an air flip.
    const target = player.g === 1 ? FLOOR - PS : CEIL;
    const towards = Math.sign(player.vy) === player.g;
    if (towards && Math.abs(target - player.y) < 50) bufferUntil = time + 0.15;
    else if (charges > 0) {
      charges--;
      burst(PX + PS / 2, player.y + PS / 2, 12, ['#ffffff', GOLD]);
      doFlip();
    } else bufferUntil = time + 0.15;
  }

  function doFlip() {
    player.g *= -1;
    player.grounded = false;
    player.vy = player.g * FLIP_V;
    bufferUntil = 0;
    Arcade.tone({ freq: player.g === 1 ? 520 : 780, to: player.g === 1 ? 300 : 1100, dur: 0.09, type: 'triangle', vol: 0.05 });
  }

  function land() {
    if (player.grounded) return;
    player.grounded = true;
    player.vy = 0;
    player.squash = 1;
    for (let i = 0; i < 5; i++) {
      particles.push({
        x: PX + Math.random() * PS, y: player.g === 1 ? FLOOR : CEIL,
        vx: Arcade.rand(-200, -40), vy: -player.g * Arcade.rand(20, 120),
        life: 0.35, color: player.g === 1 ? PINK : CYAN,
      });
    }
    if (time < bufferUntil) doFlip();
  }

  // ---------- Scoring ----------

  function addPoints(base, x, y, label = '') {
    combo = Math.min(COMBO_MAX - 1, combo + 1);
    comboT = COMBO_TIME;
    const n = base * mult();
    points += n;
    bestCombo = Math.max(bestCombo, mult());
    if (mult() >= COMBO_MAX) Arcade.flag('polarity-run-combo');
    popups.push({ x, y, text: `${label}+${n}${mult() > 1 ? ` ×${mult()}` : ''}`, t: 0 });
  }

  function burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Arcade.rand(60, 260);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: Arcade.rand(0.3, 0.7), color: Arcade.pick(colors) });
    }
  }

  // ---------- Update ----------

  function hitBox(o) {
    if (o.type === 'gate') return { x: o.x, y: CEIL, w: o.w, h: FLOOR - CEIL };
    return o.side === 'floor'
      ? { x: o.x + 4, y: FLOOR - o.h + 6, w: o.w - 8, h: o.h - 6 }
      : { x: o.x + 4, y: CEIL, w: o.w - 8, h: o.h - 6 };
  }
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function hits(o, me) {
    if (o.type === 'saw') {
      const cx = o.x + SAW_R, cy = sawY(o);
      const nx = Math.max(me.x, Math.min(cx, me.x + me.w)), ny = Math.max(me.y, Math.min(cy, me.y + me.h));
      return Math.hypot(cx - nx, cy - ny) < SAW_R - 3;
    }
    if (!overlaps(me, hitBox(o))) return false;
    if (o.type === 'gate') return (player.g === 1 ? 'floor' : 'ceil') !== o.need;
    return true;
  }

  function update(dt) {
    time += dt;
    const z = zoneAt(distance);
    if (z !== zone) {
      zone = z;
      const Z = zoneDef(z);
      const lap = lapOf(z);
      banner = { text: Z.name + (lap > 1 ? ` · lap ${lap}` : ''), sub: Z.tip || `Zone ${z + 1}`, t: 2.6 };
      points += 100;
      popups.push({ x: W / 2, y: MID + 40, text: 'Zone bonus +100', t: 0 });
      Arcade.tone({ freq: 440, to: 880, dur: 0.25, type: 'triangle', vol: 0.05 });
      Arcade.tone({ freq: 660, to: 1320, dur: 0.25, type: 'triangle', vol: 0.05, delay: 0.12 });
      if (z >= 2) Arcade.flag('polarity-run-saw');
      if (z >= ZONES.length - 1) Arcade.flag('polarity-run-overdrive');
    }
    speed = Math.min(topSpeed(), BASE_SPEED + time * 9);
    const slow = power === 'slow' ? 0.6 : 1;
    const dx = speed * slow * dt;
    distance += dx;
    scroll += dx;

    player.vy += player.g * gravity() * dt;
    player.y += player.vy * dt;
    if (player.g === 1 && player.y >= FLOOR - PS) { player.y = FLOOR - PS; land(); }
    if (player.g === -1 && player.y <= CEIL) { player.y = CEIL; land(); }
    player.rot += ((player.g === 1 ? 0 : Math.PI) - player.rot) * Math.min(1, dt * 14);
    player.squash = Math.max(0, player.squash - dt * 6);
    player.trail.unshift(player.y);
    player.trail.length = Math.min(player.trail.length, 6);

    for (const o of obstacles) o.x -= dx;
    for (const p of pickups) p.x -= dx;
    lastEnd -= dx;
    obstacles = obstacles.filter(o => o.x + o.w > -40);
    while (lastEnd < W + 300) addObstacle();

    if ((comboT -= dt) <= 0) combo = 0;
    if (power && power !== 'shield' && (powerT -= dt) <= 0) power = null;
    invuln = Math.max(0, invuln - dt);
    if (banner) banner.t -= dt;

    const me = { x: PX + 4, y: player.y + 4, w: PS - 8, h: PS - 8 };
    for (const o of obstacles) {
      if (o.type === 'gate' && !o.passed && o.x + o.w < PX) {
        o.passed = true;
        gatesPassed++;
        addPoints(25, PX + 40, MID, 'Gate ');
        burst(o.x, player.y + PS / 2, 10, [o.need === 'floor' ? PINK : CYAN]);
      }
      if (invuln > 0 || o.dead || !hits(o, me)) continue;
      if (power === 'shield') {
        o.dead = true;
        power = null;
        invuln = 0.6;
        shake = 8;
        burst(PX + PS / 2, player.y + PS / 2, 24, ['#7fb2ff', '#ffffff']);
        Arcade.tone({ freq: 600, to: 200, dur: 0.25, type: 'square', vol: 0.05 });
        continue;
      }
      crash();
      return;
    }
    obstacles = obstacles.filter(o => !o.dead);

    pickups = pickups.filter(p => {
      if (p.x < -20) return false;
      if (p.kind === 'shard' && power === 'magnet') {
        const dxp = PX + PS / 2 - p.x, dyp = player.y + PS / 2 - p.y, d = Math.hypot(dxp, dyp);
        if (d < 200) {
          p.x += (dxp / d) * 600 * dt;
          p.y += (dyp / d) * 600 * dt;
        }
      }
      if (!overlaps(me, { x: p.x - 10, y: p.y - 10, w: 20, h: 20 })) return true;
      if (p.kind === 'shard') {
        shardCount++;
        addPoints(10, p.x, p.y);
        Arcade.tone({ freq: 1000 + (combo % 5) * 120, dur: 0.05, vol: 0.035 });
        if (shardCount % CHARGE_EVERY === 0 && charges < CHARGE_MAX) {
          charges++;
          popups.push({ x: PX + 60, y: player.y - 10, text: 'Air flip ready!', t: 0, color: GOLD });
        }
      } else {
        power = p.kind;
        powerT = POWERS[p.kind].secs;
        popups.push({ x: p.x, y: p.y, text: POWERS[p.kind].label + '!', t: 0, color: POWERS[p.kind].color });
        Arcade.tone({ freq: 500, to: 1000, dur: 0.2, type: 'sine', vol: 0.05 });
      }
      return false;
    });

    updateHud();
  }

  const score = () => metres() + points;

  function updateHud() {
    $('score').textContent = score();
    $('speed').textContent = (speed / BASE_SPEED).toFixed(1) + 'x';
    $('zone').textContent = zone + 1;
    $('best').textContent = Math.max(score(), Arcade.getBest(ID));
  }

  function crash() {
    state = 'over';
    shake = 14;
    burst(PX + PS / 2, player.y + PS / 2, 40, [PINK, CYAN, '#ffffff']);
    Arcade.tone({ freq: 220, to: 40, dur: 0.6, type: 'sawtooth', vol: 0.07 });
    const bank = Arcade.load(BANK_KEY, 0) + shardCount;
    Arcade.save(BANK_KEY, bank);
    const s = score();
    const next = SKINS.find(k => !ownedSkins().includes(k.id));
    Arcade.finish(ui, {
      score: s,
      title: 'Crashed!',
      lines: [
        `${metres()} m · zone ${zone + 1} (${zoneDef(zone).name}) · ${shardCount} shard${shardCount === 1 ? '' : 's'} · best combo ×${bestCombo}`,
        `Shard bank: ${bank}${next ? ` · next skin ${next.name} at ${next.cost}` : ''} · press M for skins`,
      ],
      button: 'Run again',
      onAction: start,
    });
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume });
  }

  function resume() {
    state = 'playing';
    ui.hide();
  }

  // ---------- Skins ----------

  const ownedSkins = () => ['classic', ...Arcade.load(OWNED_KEY, [])];
  const skin = () => SKINS.find(k => k.id === Arcade.load(SKIN_KEY, 'classic') && ownedSkins().includes(k.id)) || SKINS[0];

  function showSkins() {
    if (state === 'playing') return;
    const bank = Arcade.load(BANK_KEY, 0);
    const rows = SKINS.map(k => {
      const own = ownedSkins().includes(k.id);
      const on = skin().id === k.id;
      const label = on ? `${k.name} · wearing` : own ? `Wear ${k.name}` : `${k.name} · ${k.cost} shards`;
      return `<button class="btn ${on ? '' : 'secondary'}" type="button" data-skin="${k.id}" ${!own && bank < k.cost ? 'disabled' : ''}>
        <span style="display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:8px;background:${k.rainbow ? 'linear-gradient(90deg,#ff4fd8,#ffd23f,#3ef0ff)' : `linear-gradient(${k.top},${k.bottom})`}"></span>${label}</button>`;
    }).join('');
    ui.show({
      title: 'Skins',
      html: `<p>Every shard you grab goes into your bank. You have <b>${bank}</b>.</p><div class="menu">${rows}<button class="btn secondary" type="button" data-back>Back</button></div>`,
      button: null,
      onRender: panel => {
        panel.querySelectorAll('[data-skin]').forEach(b => b.addEventListener('click', () => {
          const k = SKINS.find(x => x.id === b.dataset.skin);
          if (!ownedSkins().includes(k.id)) {
            const have = Arcade.load(BANK_KEY, 0);
            if (have < k.cost) return;
            Arcade.save(BANK_KEY, have - k.cost);
            Arcade.save(OWNED_KEY, [...ownedSkins().filter(x => x !== 'classic'), k.id]);
            Arcade.flag('polarity-run-skin');
          }
          Arcade.save(SKIN_KEY, k.id);
          showSkins();
        }));
        panel.querySelector('[data-back]').addEventListener('click', showIntro);
      },
    });
  }

  // ---------- Input ----------

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (e.code === 'KeyM' && state !== 'playing' && state !== 'paused') return showSkins();
    if (!e.repeat && ['Space', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(e.code)) flip();
  });
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); flip(); });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function drawSpikes(o) {
    const floor = o.side === 'floor';
    const color = floor ? PINK : CYAN;
    const base = floor ? FLOOR : CEIL;
    const dir = floor ? -1 : 1;
    const bodyH = o.h - 26;
    if (bodyH > 0) {
      ctx.fillStyle = '#251f4d';
      ctx.fillRect(o.x, floor ? base - bodyH : base, o.w, bodyH);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, (floor ? base - bodyH : base) + 1, o.w - 2, bodyH - 2);
    }
    const tipBase = base + dir * bodyH;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let x = o.x; x < o.x + o.w; x += SPIKE) {
      ctx.moveTo(x, tipBase);
      ctx.lineTo(x + SPIKE / 2, tipBase + dir * 26);
      ctx.lineTo(x + SPIKE, tipBase);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawGate(o) {
    const color = o.need === 'floor' ? PINK : CYAN;
    const flick = 0.55 + Math.sin(time * 20 + o.x * 0.1) * 0.15;
    ctx.save();
    ctx.globalAlpha = o.passed ? 0.25 : flick;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillRect(o.x + 4, CEIL, o.w - 8, FLOOR - CEIL);
    ctx.globalAlpha = o.passed ? 0.3 : 0.9;
    for (let y = CEIL + 8; y < FLOOR; y += 18) ctx.fillRect(o.x, y, o.w, 3);
    ctx.restore();
    // An arrow at the safe end shows where to be.
    ctx.fillStyle = color;
    const ty = o.need === 'floor' ? FLOOR - 14 : CEIL + 14;
    ctx.beginPath();
    ctx.moveTo(o.x - 22, ty - 7); ctx.lineTo(o.x - 10, ty); ctx.lineTo(o.x - 22, ty + 7);
    ctx.fill();
  }

  function drawSaw(o) {
    const cx = o.x + SAW_R, cy = sawY(o);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, CEIL);
    ctx.lineTo(cx, FLOOR);
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 14);
    ctx.fillStyle = '#ff6b6b';
    ctx.shadowColor = '#ff6b6b';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = i % 2 ? SAW_R - 6 : SAW_R;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#2a1020';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPickup(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.kind === 'shard') {
      ctx.rotate(time * 3);
      ctx.fillStyle = GOLD;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(6, 0); ctx.lineTo(0, 8); ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      const P = POWERS[p.kind];
      const pulse = 1 + Math.sin(time * 8) * 0.1;
      ctx.scale(pulse, pulse);
      ctx.strokeStyle = P.color;
      ctx.shadowColor = P.color;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = P.color;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(P.label[0], 0, 1);
    }
    ctx.restore();
  }

  function drawPlayer() {
    const k = skin();
    const cx = PX + PS / 2, cy = player.y + PS / 2;
    const pol = player.g === 1 ? PINK : CYAN;
    for (let i = player.trail.length - 1; i >= 1; i--) {
      ctx.globalAlpha = 0.18 * (1 - i / player.trail.length);
      ctx.fillStyle = k.rainbow ? `hsl(${(time * 300 + i * 40) % 360}, 90%, 65%)` : pol;
      ctx.fillRect(PX - i * 7, player.trail[i], PS, PS);
    }
    ctx.globalAlpha = invuln > 0 && Math.floor(time * 20) % 2 ? 0.4 : k.ghost ? 0.75 : 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(player.rot);
    const sq = player.squash * 0.2;
    ctx.scale(1 + sq, 1 - sq);
    const g = ctx.createLinearGradient(0, -PS / 2, 0, PS / 2);
    g.addColorStop(0, k.top);
    g.addColorStop(1, k.rainbow ? `hsl(${(time * 120) % 360}, 90%, 65%)` : k.bottom);
    ctx.fillStyle = g;
    // The glow shows your polarity: pink on the floor, cyan on the ceiling.
    ctx.shadowColor = pol;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.roundRect(-PS / 2, -PS / 2, PS, PS, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = pol;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#1a1033';
    ctx.fillRect(4, -6, 6, 8);
    ctx.fillRect(-6, -6, 4, 8);
    ctx.restore();
    ctx.globalAlpha = 1;

    if (power === 'shield') {
      ctx.strokeStyle = 'rgba(127,178,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, PS * 0.85 + Math.sin(time * 6) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawHudLayer() {
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    const lap = lapOf(zone);
    ctx.fillText(`ZONE ${zone + 1} · ${zoneDef(zone).name.toUpperCase()}${lap > 1 ? ` · LAP ${lap}` : ''}`, 14, 24);
    // Progress to the next zone.
    const into = (metres() % ZONE_LEN) / ZONE_LEN;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(14, 32, 160, 4);
    ctx.fillStyle = GOLD;
    ctx.fillRect(14, 32, 160 * into, 4);

    // Air flip charges.
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText('AIR FLIPS', 14, 56);
    for (let i = 0; i < CHARGE_MAX; i++) {
      ctx.fillStyle = i < charges ? GOLD : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(88 + i * 14, 52, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const toNext = CHARGE_EVERY - (shardCount % CHARGE_EVERY);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '500 11px system-ui, sans-serif';
    if (charges < CHARGE_MAX) ctx.fillText(`${toNext} shard${toNext > 1 ? 's' : ''} to next`, 132, 56);

    ctx.textAlign = 'right';
    if (mult() > 1) {
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillStyle = GOLD;
      ctx.fillText(`×${mult()}`, W - 14, 30);
      ctx.fillStyle = 'rgba(255,210,63,0.3)';
      ctx.fillRect(W - 74, 38, 60 * (comboT / COMBO_TIME), 3);
    }
    if (power && power !== 'shield') {
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillStyle = POWERS[power].color;
      ctx.fillText(`${POWERS[power].label} ${Math.ceil(powerT)}s`, W - 90, 24);
    } else if (power === 'shield') {
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillStyle = POWERS.shield.color;
      ctx.fillText('Shield up', W - 90, 24);
    }

    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.9);
      ctx.fillStyle = p.color || '#ffffff';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - p.t * 40);
    }
    ctx.globalAlpha = 1;

    if (banner && banner.t > 0 && state === 'playing') {
      const a = Math.min(1, banner.t / 0.5, (2.6 - banner.t) / 0.3 + 0.2);
      ctx.globalAlpha = Math.max(0, a);
      ctx.textAlign = 'center';
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(banner.text.toUpperCase(), W / 2, MID - 10);
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = GOLD;
      ctx.fillText(banner.sub, W / 2, MID + 14);
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(Arcade.rand(-shake, shake), Arcade.rand(-shake, shake));

    const [c0, c1] = zoneDef(zone).bg;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, c0);
    bg.addColorStop(0.5, c1);
    bg.addColorStop(1, c0);
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    const drift = zoneDef(zone).grav < 1 ? Math.sin(time) * 6 : 0;
    for (const s of stars) {
      const x = (((s.x - scroll * s.z) % W) + W) % W;
      ctx.fillStyle = `rgba(255,255,255,${s.z + 0.2})`;
      ctx.fillRect(x, s.y + drift * s.z * 4, 2 * s.z + 1, 1);
    }

    ctx.fillStyle = '#140d2e';
    ctx.fillRect(-20, FLOOR, W + 40, H - FLOOR + 20);
    ctx.fillRect(-20, -20, W + 40, CEIL + 20);
    ctx.strokeStyle = 'rgba(255, 79, 216, 0.25)';
    ctx.lineWidth = 1;
    const off = scroll % 40;
    ctx.beginPath();
    for (let x = -off; x < W; x += 40) {
      ctx.moveTo(x, FLOOR); ctx.lineTo(x - 30, H);
      ctx.moveTo(x, CEIL); ctx.lineTo(x - 30, 0);
    }
    ctx.stroke();
    ctx.fillStyle = PINK;
    ctx.fillRect(-20, FLOOR, W + 40, 3);
    ctx.fillStyle = CYAN;
    ctx.fillRect(-20, CEIL - 3, W + 40, 3);

    for (const p of pickups) drawPickup(p);
    for (const o of obstacles) {
      if (o.type === 'spike') drawSpikes(o);
      else if (o.type === 'gate') drawGate(o);
      else drawSaw(o);
    }
    if (state !== 'over') drawPlayer();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (state !== 'ready') drawHudLayer();
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state === 'playing') update(dt);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
    for (const p of popups) p.t += dt;
    popups = popups.filter(p => p.t < 0.9);
    shake = Math.max(0, shake - dt * 40);
    draw();
    requestAnimationFrame(frame);
  }

  const intro = {
    title: 'Polarity Run',
    html: `<ul>
      <li>Press <b>Space</b> or tap to flip gravity. You can flip once you've landed; pressing just before you land still counts.</li>
      <li>Every 10 <b style="color:${GOLD}">shards</b> earns an <b>air flip</b>: flip again mid-air (up to 3 saved).</li>
      <li>Chain shards and gates for a combo up to <b>×${COMBO_MAX}</b>. Grab <b>shields</b>, <b>magnets</b> and <b>slow-mo</b>.</li>
      <li>Every ${ZONE_LEN} m is a new zone: <b style="color:${PINK}">pink</b>/<b style="color:${CYAN}">cyan</b> polarity gates, swinging saws, low gravity, then Overdrive.</li>
    </ul>
    <div class="menu" style="margin-bottom:8px"><button class="btn secondary" type="button" data-skins>Skins (${Arcade.load(BANK_KEY, 0)} shards banked)</button></div>`,
    button: 'Run',
    onAction: start,
    onRender: panel => panel.querySelector('[data-skins]')?.addEventListener('click', showSkins),
  };
  function showIntro() {
    state = 'ready';
    ui.show({ ...intro, html: intro.html.replace(/\(\d+ shards banked\)/, `(${Arcade.load(BANK_KEY, 0)} shards banked)`) });
  }

  reset();
  Versus.attach({ ui, start, score: () => score(), intro });
  requestAnimationFrame(frame);
})();
