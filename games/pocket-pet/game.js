(() => {
  const W = 640, H = 480;
  const SAVE_KEY = 'pet:save';
  const OFFLINE_CAP = 48 * 3600;       // seconds of time away that still count
  const STEP = 600;                    // offline time is replayed in 10-minute steps
  // Points lost per hour, awake. Asleep, energy refills and everything else drops at half speed.
  const DECAY = { hunger: 8, fun: 10, clean: 5, energy: 6 };
  const SLEEP_GAIN = 30;
  const STAGES = [
    { name: 'Egg', at: -1 },
    { name: 'Baby', at: 0 },
    { name: 'Kid', at: 60 },
    { name: 'Teen', at: 250 },
    { name: 'Adult', at: 800 },
    { name: 'Legend', at: 2000 },
  ];
  const HATCH_TIME = 90;               // seconds of watching the egg before it hatches
  const PALETTE = ['#ff8fab', '#7fd1ff', '#9bf6a5', '#ffd166', '#c3a6ff', '#ffab76'];
  const NAMES = ['Mochi', 'Pip', 'Biscuit', 'Nugget', 'Pixel', 'Bloop', 'Taco', 'Sprout', 'Comet', 'Noodle', 'Gizmo', 'Pebble', 'Waffle', 'Sunny', 'Ziggy', 'Bean'];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let s;                // the save
  let game = null;      // the catch mini-game while it runs
  let pops = [], blink = 0, hop = 0, kibbleCool = 0;

  // ---------- Save ----------

  function fresh() {
    const st = Arcade.stats();
    return {
      name: Arcade.pick(NAMES), color: Arcade.pick(PALETTE), stage: 0, bond: 0, egg: 0,
      hunger: 80, fun: 80, clean: 100, energy: 90, treats: 3, sleeping: false, poops: [],
      saved: Date.now(), plays: otherPlays(st), time: otherTime(st), carry: 0,
    };
  }

  // Games and playtime from the rest of the arcade, which turn into treats.
  const otherPlays = st => Object.entries(st.plays).reduce((n, [id, v]) => n + (id === Arcade.gameId ? 0 : v), 0);
  const otherTime = st => Object.entries(st.time).reduce((n, [id, v]) => n + (id === Arcade.gameId ? 0 : v), 0);

  function persist() {
    s.saved = Date.now();
    Arcade.submitScore(Arcade.gameId, Math.floor(s.bond));
    Arcade.save(SAVE_KEY, s);
  }
  setInterval(persist, 5000);
  window.addEventListener('pagehide', persist);

  // ---------- Needs ----------

  const clamp = v => Math.max(0, Math.min(100, v));
  const NEEDS = ['hunger', 'fun', 'clean', 'energy'];
  const happy = () => NEEDS.every(k => s[k] >= 50);
  const mood = () => Math.min(...NEEDS.map(k => s[k]));

  // Moves the clock forward by `secs`. Bond grows a point a minute while every need is above half.
  function age(secs) {
    if (s.stage === 0) return;
    const hrs = secs / 3600;
    for (const k of NEEDS) {
      if (k === 'energy' && s.sleeping) s.energy = clamp(s.energy + SLEEP_GAIN * hrs);
      else s[k] = clamp(s[k] - DECAY[k] * hrs * (s.sleeping ? 0.5 : 1) - (k === 'clean' ? s.poops.length * 2 * hrs : 0));
    }
    if (s.sleeping && s.energy >= 100) s.sleeping = false;
    if (happy()) s.bond += (secs / 60) * (s.stage >= 3 ? 1.2 : 1);
    // Every few hours of digestion leaves a mess to clean up.
    s.carry += secs;
    while (s.carry > 3 * 3600 && s.poops.length < 5) {
      s.carry -= 3 * 3600;
      s.poops.push({ x: Arcade.rand(80, W - 80), y: Arcade.rand(380, 420) });
    }
  }

  function catchUp() {
    const away = Math.min(OFFLINE_CAP, (Date.now() - s.saved) / 1000);
    const before = { ...s, poops: s.poops.length };
    for (let t = away; t > 0; t -= STEP) age(Math.min(STEP, t));
    const st = Arcade.stats();
    const plays = otherPlays(st) - s.plays, mins = Math.floor((otherTime(st) - s.time) / 300);
    const earned = Math.max(0, plays * 3 + mins);
    s.plays = otherPlays(st);
    s.time = otherTime(st);
    s.treats += earned;
    if (earned) Arcade.flag('pocket-pet-treat');
    return { away, earned, plays: Math.max(0, plays), grew: Math.floor(s.bond - before.bond), poops: s.poops.length - before.poops };
  }

  function checkStage() {
    const next = STAGES[s.stage + 1];
    if (!next || s.bond < next.at || s.stage === 0) return;
    s.stage++;
    if (s.stage >= 4) Arcade.flag('pocket-pet-adult');
    persist();
    render();
    [523, 659, 784, 1046].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.15, type: 'triangle', vol: 0.05, delay: i * 0.1 }));
    Arcade.finish(ui, {
      score: Math.floor(s.bond),
      title: `${s.name} grew up!`,
      lines: [`${s.name} is now a <b>${STAGES[s.stage].name}</b>.`, STAGES[s.stage + 1] ? `Next stage at ${STAGES[s.stage + 1].at} bond.` : 'That\'s as big as it gets. Keep caring for your legend!'],
      button: 'Keep playing',
      onAction: () => ui.hide(),
    });
  }

  // ---------- Actions ----------

  function act(a) {
    if (game || !$('overlay').hidden) return;
    if (s.stage === 0) {
      if (a === 'pet') { s.egg += 3; hop = 0.3; Arcade.tone({ freq: 500, dur: 0.05, vol: 0.03 }); }
      return;
    }
    if (s.sleeping && a !== 'sleep') return say('Shh… they\'re sleeping', '#8d94a1');
    if (a === 'feed') {
      if (kibbleCool > 0) return say('Still full. Try again in a moment', '#8d94a1');
      s.hunger = clamp(s.hunger + 25);
      kibbleCool = 20;
      say('+25 food', '#ffd166');
      Arcade.tone({ freq: 400, to: 600, dur: 0.1, vol: 0.04 });
    } else if (a === 'treat') {
      if (!s.treats) return say('No treats. Play other arcade games to earn some!', '#ff7a7a');
      s.treats--;
      s.hunger = clamp(s.hunger + 15);
      s.fun = clamp(s.fun + 20);
      s.bond += 2;
      say('Yum! +2 bond', '#ff8fab');
      Arcade.tone({ freq: 660, to: 990, dur: 0.15, type: 'triangle', vol: 0.05 });
    } else if (a === 'wash') {
      s.clean = clamp(s.clean + 45);
      s.poops = [];
      for (let i = 0; i < 12; i++) pops.push({ x: W / 2 + Arcade.rand(-70, 70), y: 300 + Arcade.rand(-60, 30), vy: -Arcade.rand(20, 60), life: 1, bubble: true });
      say('Squeaky clean', '#7fd1ff');
      Arcade.tone({ freq: 800, to: 1200, dur: 0.2, type: 'sine', vol: 0.04 });
    } else if (a === 'play') {
      if (s.energy < 15) return say('Too tired to play. Try a nap', '#8d94a1');
      game = { t: 12, caught: 0, x: W / 2, y: 150, vx: 220, vy: 160 };
    } else if (a === 'sleep') {
      s.sleeping = !s.sleeping;
      say(s.sleeping ? 'Goodnight…' : 'Good morning!', '#c3a6ff');
    } else if (a === 'pet') {
      s.fun = clamp(s.fun + 1);
      hop = 0.3;
      pops.push({ x: W / 2 + Arcade.rand(-30, 30), y: 230, vy: -40, life: 1, heart: true });
      Arcade.tone({ freq: 700, dur: 0.05, type: 'triangle', vol: 0.03 });
    } else if (a === 'rename') {
      s.name = Arcade.pick(NAMES.filter(n => n !== s.name));
    }
    hop = Math.max(hop, 0.2);
    render();
    checkStage();
  }

  let msg = null;
  function say(text, color) { msg = { text, color, life: 2.2 }; }

  function endGame() {
    const c = game.caught;
    game = null;
    s.fun = clamp(s.fun + Math.min(40, c * 5));
    s.energy = clamp(s.energy - 10);
    s.bond += c;
    say(`Caught ${c}! +${Math.min(40, c * 5)} fun · +${c} bond`, '#9bf6a5');
    render();
    checkStage();
  }

  // ---------- Controls ----------

  function render() {
    const egg = s.stage === 0;
    const b = (id, label, on = true) => `<button class="btn secondary" type="button" data-a="${id}" ${on ? '' : 'disabled'}>${label}</button>`;
    $('actions').innerHTML = egg ? b('pet', 'Warm the egg') :
      b('feed', '🍖 Feed', !s.sleeping) + b('treat', `🍬 Treat ×${s.treats}`, !s.sleeping && s.treats > 0) + b('play', '⚾ Play', !s.sleeping) +
      b('wash', '🫧 Wash', !s.sleeping) + b('sleep', s.sleeping ? '☀️ Wake up' : '🌙 Sleep') + b('rename', 'Rename');
    $('bond').textContent = Math.floor(s.bond);
    $('stage').textContent = STAGES[s.stage].name;
    $('treats').textContent = s.treats;
  }

  $('actions').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    e.target.blur();
    act(a);
  });

  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    if (game) {
      if (Math.hypot(px - game.x, py - game.y) < 34) {
        game.caught++;
        game.vx *= -1.08;
        game.vy = -Math.abs(game.vy) * 1.08 - 40;
        Arcade.tone({ freq: 500 + game.caught * 40, dur: 0.06, type: 'triangle', vol: 0.05 });
      }
      return;
    }
    const k = s.poops.findIndex(p => Math.hypot(px - p.x, py - p.y) < 22);
    if (k >= 0) {
      s.poops.splice(k, 1);
      s.clean = clamp(s.clean + 8);
      say('Cleaned up', '#7fd1ff');
      return;
    }
    if (Math.hypot(px - W / 2, py - 290) < 90) act('pet');
  });

  // ---------- Drawing ----------

  function bar(x, y, label, v, color) {
    ctx.fillStyle = '#8d94a1';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#1e222a';
    ctx.beginPath(); ctx.roundRect(x, y + 6, 130, 10, 5); ctx.fill();
    ctx.fillStyle = v < 25 ? '#ff7a7a' : color;
    ctx.beginPath(); ctx.roundRect(x, y + 6, Math.max(10, 1.3 * v), 10, 5); ctx.fill();
  }

  function drawPet(t) {
    const size = [0, 46, 58, 70, 82, 90][s.stage];
    const cx = W / 2, base = 360;
    const bounce = s.sleeping ? Math.sin(t * 1.5) * 2 : Math.abs(Math.sin(t * 2.4)) * -6 - Math.sin(Math.min(hop, 0.3) / 0.3 * Math.PI) * 30;
    const squash = s.sleeping ? 1.08 : 1 + Math.sin(t * 4.8) * 0.03;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(cx, base + 4, size * 0.9, 10, 0, 0, Math.PI * 2); ctx.fill();

    if (s.stage === 0) {
      const wobble = Math.sin(t * (2 + s.egg / 20)) * (0.05 + s.egg / 900);
      ctx.save();
      ctx.translate(cx, base);
      ctx.rotate(wobble);
      ctx.fillStyle = '#f4ecd8';
      ctx.beginPath(); ctx.ellipse(0, -60, 46, 60, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.color;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-26 + i * 13, -60 + (i % 2 ? 14 : -10), 7, 0, Math.PI * 2); ctx.fill(); }
      if (s.egg > HATCH_TIME * 0.5) {
        ctx.strokeStyle = '#8d7f63';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-20, -90); ctx.lineTo(-8, -80); ctx.lineTo(2, -94); ctx.lineTo(12, -82); ctx.stroke();
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(cx, base + bounce);
    ctx.scale(1 / squash, squash);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.ellipse(0, -size, size, size, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ears from Kid up, a crown for a Legend.
    if (s.stage >= 2) {
      ctx.beginPath(); ctx.moveTo(-size * 0.7, -size * 1.6); ctx.lineTo(-size * 0.35, -size * 2.25); ctx.lineTo(-size * 0.1, -size * 1.8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(size * 0.7, -size * 1.6); ctx.lineTo(size * 0.35, -size * 2.25); ctx.lineTo(size * 0.1, -size * 1.8); ctx.fill();
    }
    if (s.stage >= 5) {
      ctx.fillStyle = '#ffc53d';
      ctx.beginPath();
      ctx.moveTo(-28, -size * 2.05); ctx.lineTo(-28, -size * 2.05 - 22); ctx.lineTo(-14, -size * 2.05 - 10); ctx.lineTo(0, -size * 2.05 - 28);
      ctx.lineTo(14, -size * 2.05 - 10); ctx.lineTo(28, -size * 2.05 - 22); ctx.lineTo(28, -size * 2.05); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(-size * 0.35, -size * 1.4, size * 0.25, size * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
    // Face
    const m = mood();
    const ey = -size * 1.05, ex = size * 0.35;
    ctx.strokeStyle = ctx.fillStyle = '#1b1e24';
    ctx.lineWidth = 3;
    if (s.sleeping || blink > 0) {
      [-ex, ex].forEach(x => { ctx.beginPath(); ctx.moveTo(x - 7, ey); ctx.lineTo(x + 7, ey); ctx.stroke(); });
    } else {
      [-ex, ex].forEach(x => { ctx.beginPath(); ctx.arc(x, ey, 6, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = '#fff';
      [-ex, ex].forEach(x => { ctx.beginPath(); ctx.arc(x + 2, ey - 2, 2, 0, Math.PI * 2); ctx.fill(); });
    }
    ctx.beginPath();
    if (s.sleeping) ctx.arc(0, -size * 0.7, 4, 0, Math.PI * 2);
    else if (m >= 50) ctx.arc(0, -size * 0.8, 10, 0.15 * Math.PI, 0.85 * Math.PI);
    else if (m >= 25) { ctx.moveTo(-8, -size * 0.7); ctx.lineTo(8, -size * 0.7); }
    else ctx.arc(0, -size * 0.6, 10, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();
    if (m >= 50 && !s.sleeping) {
      ctx.fillStyle = 'rgba(255,90,120,0.35)';
      [-1, 1].forEach(k => { ctx.beginPath(); ctx.ellipse(k * size * 0.6, -size * 0.8, 8, 5, 0, 0, Math.PI * 2); ctx.fill(); });
    }
    ctx.restore();

    if (s.sleeping) {
      ctx.fillStyle = '#c3a6ff';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.textAlign = 'left';
      [0, 1, 2].forEach(k => {
        const p = (t * 0.5 + k / 3) % 1;
        ctx.globalAlpha = 1 - p;
        ctx.fillText('z', cx + size * 0.8 + p * 40, base - size * 2 - p * 60);
      });
      ctx.globalAlpha = 1;
    }
  }

  function draw(t, dt) {
    const night = s.sleeping;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, night ? '#141833' : '#2a3a5c');
    g.addColorStop(1, night ? '#0b0d1a' : '#4a5d82');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = night ? '#1c2a1f' : '#3f7a4f';
    ctx.fillRect(0, 370, W, H - 370);
    ctx.fillStyle = night ? '#16221a' : '#356a43';
    for (let x = 0; x < W; x += 24) ctx.fillRect(x, 370, 12, 4);

    bar(20, 26, 'Food', s.hunger, '#ffd166');
    bar(170, 26, 'Fun', s.fun, '#9bf6a5');
    bar(320, 26, 'Clean', s.clean, '#7fd1ff');
    bar(470, 26, 'Energy', s.energy, '#c3a6ff');

    for (const p of s.poops) {
      ctx.fillStyle = '#7a5230';
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.arc(p.x, p.y - 9, 7, 0, Math.PI * 2); ctx.arc(p.x, p.y - 15, 4, 0, Math.PI * 2); ctx.fill();
    }

    drawPet(t);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#eceef2';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillText(s.stage === 0 ? 'A mysterious egg' : s.name, W / 2, 90);
    ctx.fillStyle = 'rgba(236,238,242,0.7)';
    ctx.font = '600 13px system-ui, sans-serif';
    const next = STAGES[s.stage + 1];
    ctx.fillText(s.stage === 0 ? `Click it to keep it warm · ${Math.min(100, Math.floor((s.egg / HATCH_TIME) * 100))}% ready to hatch`
      : `${STAGES[s.stage].name}${next ? ` · ${Math.floor(s.bond)} / ${next.at} bond to grow` : ' · fully grown'}${happy() ? '' : ' · needs care to grow'}`, W / 2, 112);

    for (const p of pops) {
      p.life -= dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.heart) {
        ctx.fillStyle = '#ff5f8a';
        ctx.font = '22px system-ui, sans-serif';
        ctx.fillText('♥', p.x, p.y);
      } else {
        ctx.strokeStyle = '#dff6ff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    pops = pops.filter(p => p.life > 0);

    if (game) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(game.x, game.y, 22, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ff5f6d';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(game.x - 8, game.y, 16, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(game.x + 8, game.y, 16, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
      ctx.fillStyle = '#eceef2';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText(`Tap the ball! ${game.caught} caught · ${Math.ceil(game.t)}s`, W / 2, 150);
    }
    if (msg) {
      msg.life -= dt;
      ctx.globalAlpha = Math.min(1, msg.life * 2);
      ctx.fillStyle = msg.color;
      ctx.font = '700 17px system-ui, sans-serif';
      ctx.fillText(msg.text, W / 2, 455);
      ctx.globalAlpha = 1;
      if (msg.life <= 0) msg = null;
    }
  }

  // ---------- Loop ----------

  let last = performance.now(), tick = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    hop = Math.max(0, hop - dt);
    kibbleCool = Math.max(0, kibbleCool - dt);
    blink -= dt;
    if (blink < -Arcade.rand(2, 5)) blink = 0.12;
    age(dt);
    if ($('overlay').hidden) {
      if (s.stage === 0) {
        s.egg += dt;
        if (s.egg >= HATCH_TIME) hatch();
      }
      tick += dt;
      if (tick > 1) { tick = 0; render(); checkStage(); }
    }
    if (game) {
      game.t -= dt;
      game.vy += 260 * dt;
      game.x += game.vx * dt;
      game.y += game.vy * dt;
      if (game.x < 24 || game.x > W - 24) { game.vx *= -1; game.x = Math.max(24, Math.min(W - 24, game.x)); }
      if (game.y < 130) { game.vy = Math.abs(game.vy); }
      if (game.y > 360) { game.vy = -Math.abs(game.vy) * 0.95 - 60; game.y = 360; }
      if (game.t <= 0) endGame();
    }
    draw(t, dt);
    requestAnimationFrame(frame);
  }

  function hatch() {
    s.stage = 1;
    s.egg = HATCH_TIME;
    Arcade.flag('pocket-pet-hatch');
    persist();
    render();
    [392, 523, 659, 784].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.15, type: 'triangle', vol: 0.05, delay: i * 0.1 }));
    ui.show({
      title: 'It hatched!',
      html: `<p>Say hello to <b>${s.name}</b>.</p><ul>
        <li>Keep <b>food, fun, clean and energy</b> above half and your bond grows, even while you're away.</li>
        <li>Every game you finish elsewhere in the arcade earns <b>treats</b>.</li>
        <li>Grow your bond to raise ${s.name} from Baby to Legend.</li>
      </ul>`,
      button: 'Let\'s go',
      onAction: () => ui.hide(),
    });
  }

  // ---------- Start ----------

  const raw = Arcade.load(SAVE_KEY, null);
  s = raw ? { ...fresh(), ...raw } : fresh();
  const back = raw ? catchUp() : null;
  persist();
  render();
  if (!raw) {
    ui.show({
      title: 'Pocket Pet',
      html: `<p>Someone left an egg on your doorstep. Keep it warm and see what hatches.</p>
        <ul><li>Your pet lives on real time and keeps going while this tab is closed.</li>
        <li>Finish games anywhere in the arcade to earn treats for it.</li></ul>`,
      button: 'Look after it',
      onAction: () => ui.hide(),
    });
  } else if (back && (back.away > 120 || back.earned)) {
    const hrs = Math.floor(back.away / 3600), mins = Math.floor((back.away % 3600) / 60);
    ui.show({
      title: `Welcome back`,
      html: `<p>You were away for ${hrs ? `${hrs}h ` : ''}${mins}m.</p>
        ${back.earned ? `<p class="big">+${back.earned} 🍬</p><p>Treats for finishing ${back.plays} game${back.plays === 1 ? '' : 's'} around the arcade.</p>` : ''}
        ${back.grew > 0 ? `<p>${s.name}'s bond grew by ${back.grew} while you were gone.</p>` : s.stage ? `<p>${s.name} missed you. Check the bars at the top.</p>` : ''}
        ${back.poops > 0 ? '<p>There\'s some tidying up to do.</p>' : ''}`,
      button: `See ${s.stage ? s.name : 'the egg'}`,
      onAction: () => ui.hide(),
    });
  } else ui.hide();
  requestAnimationFrame(frame);
})();
