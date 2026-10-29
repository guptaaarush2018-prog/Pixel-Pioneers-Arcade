(() => {
  const W = 960, H = 540;
  const FIELD_H = 410;
  const LANES = [95, 205, 315];
  const MID = W / 2;
  const KEEP_X = [44, W - 44];
  const TOWER_X = [150, W - 150];
  const DEPLOY = [[80, MID - 40], [MID + 40, W - 80]];   // where each side may place units
  const STEP = 1 / 20;
  const MATCH_TIME = 180, OVERTIME = 60, DOUBLE_AT = 60;
  const MANA_MAX = 10, MANA_EVERY = 2.8;
  const SEND_EVERY = 0.08;
  const COLORS = { me: '#4f8cff', them: '#ff5d5d' };

  // Every player brings the same eight runes. `count` units spawn per card.
  const CARDS = [
    { id: 'squire', name: 'Squire', cost: 2, kind: 'unit', hp: 300, dmg: 60, rate: 1.0, range: 24, speed: 46, r: 9 },
    { id: 'archers', name: 'Archers', cost: 3, kind: 'unit', count: 2, hp: 120, dmg: 42, rate: 1.1, range: 140, speed: 44, r: 7, ranged: true },
    { id: 'brute', name: 'Brute', cost: 5, kind: 'unit', hp: 1500, dmg: 130, rate: 1.6, range: 26, speed: 28, r: 15, siege: true },
    { id: 'rats', name: 'Rat Pack', cost: 2, kind: 'unit', count: 4, hp: 50, dmg: 26, rate: 0.8, range: 16, speed: 72, r: 5 },
    { id: 'bomber', name: 'Bomber', cost: 4, kind: 'unit', hp: 240, dmg: 95, rate: 1.8, range: 120, speed: 40, r: 9, ranged: true, splash: 48 },
    { id: 'rider', name: 'Rider', cost: 4, kind: 'unit', hp: 560, dmg: 115, rate: 1.3, range: 26, speed: 88, r: 11 },
    { id: 'fireball', name: 'Fireball', cost: 4, kind: 'spell', dmg: 280, radius: 64 },
    { id: 'turret', name: 'Turret', cost: 3, kind: 'building', hp: 520, dmg: 48, rate: 0.9, range: 165, life: 25, r: 13, ranged: true },
  ];
  const BUILDINGS = {
    tower: { hp: 1100, dmg: 45, rate: 0.9, range: 165, r: 20 },
    keep: { hp: 2400, dmg: 80, rate: 1.0, range: 150, r: 30 },
  };
  const LEVELS = [
    { name: 'Easy', think: 1.8, mana: 0.65, mult: 1 },
    { name: 'Normal', think: 1.0, mana: 0.9, mult: 1.5 },
    { name: 'Hard', think: 0.45, mana: 1.1, mult: 2 },
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let mode = null;      // 'bot' | 'host' | 'guest'
  let state = 'menu';   // 'menu' | 'playing' | 'paused' | 'over'
  let level = 1;
  let me = 0;           // the side this device plays: 0 left, 1 right (guests are drawn mirrored)
  let g = null;         // the match; on a guest, rebuilt from snapshots
  let selected = -1;
  let hover = null;
  let net = null;       // { conn, names, sendT, want: { me, them } }
  let snaps = [];       // guest: the last two snapshots, for smoothing
  let botT = 0;

  // ---------- Match setup ----------

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newPlayer() {
    const deck = shuffle(CARDS.map((_, i) => i));
    return { mana: 5, hand: deck.slice(0, 4), queue: deck.slice(4), crowns: 0 };
  }

  function newMatch() {
    g = { time: MATCH_TIME, overtime: false, ents: [], nextId: 1, players: [newPlayer(), newPlayer()], fx: [], newFx: [], over: null };
    for (const side of [0, 1]) {
      addEnt({ type: 'keep', side, lane: -1, x: KEEP_X[side], ...BUILDINGS.keep, building: true });
      LANES.forEach((_, lane) => addEnt({ type: 'tower', side, lane, x: TOWER_X[side], ...BUILDINGS.tower, building: true }));
    }
  }

  function addEnt(e) {
    const ent = { id: g.nextId++, cd: 0.4, maxHp: e.hp, yOff: 0, flash: 0, ...e };
    g.ents.push(ent);
    return ent;
  }

  const towerAlive = (side, lane) => g.ents.some(e => e.type === 'tower' && e.side === side && e.lane === lane && e.hp > 0);
  const laneOf = y => {
    let best = 0;
    LANES.forEach((ly, i) => { if (Math.abs(y - ly) < Math.abs(y - LANES[best])) best = i; });
    return Math.abs(y - LANES[best]) < 60 ? best : -1;
  };
  const entY = e => (e.lane < 0 ? LANES[1] : LANES[e.lane]) + e.yOff;

  function fx(f) {
    g.fx.push({ ...f, t: 0 });
    if (mode === 'host') g.newFx.push(f);
  }

  // ---------- Playing cards ----------

  function canPlay(side, slot, lane, x) {
    const p = g.players[side];
    const card = CARDS[p.hand[slot]];
    if (!card || p.mana < card.cost || g.over) return false;
    if (card.kind === 'spell') return x > 0 && x < W && lane >= 0;
    const [a, b] = DEPLOY[side];
    return lane >= 0 && x >= a && x <= b;
  }

  function playCard(side, slot, lane, x) {
    if (!canPlay(side, slot, lane, x)) return false;
    const p = g.players[side];
    const card = CARDS[p.hand[slot]];
    p.mana -= card.cost;
    p.queue.push(p.hand[slot]);
    p.hand[slot] = p.queue.shift();

    if (card.kind === 'spell') {
      const y = LANES[lane];
      for (const e of g.ents) {
        if (e.side === side || e.hp <= 0) continue;
        if (Math.hypot(e.x - x, entY(e) - y) <= card.radius + e.r) hurt(e, e.building ? card.dmg * 0.35 : card.dmg, side);
      }
      fx({ k: 'boom', x, y, r: card.radius, c: '#ff9a3d' });
      Arcade.tone({ freq: 160, to: 50, dur: 0.35, type: 'sawtooth', vol: 0.05 });
      return true;
    }
    const n = card.count || 1;
    for (let i = 0; i < n; i++) {
      const spread = n > 1 ? (i - (n - 1) / 2) : 0;
      addEnt({
        type: card.id, side, lane, x: x - spread * 6 * (side ? -1 : 1), yOff: spread * 12,
        hp: card.hp, dmg: card.dmg, rate: card.rate, range: card.range, speed: card.speed || 0,
        r: card.r, ranged: !!card.ranged, splash: card.splash || 0, siege: !!card.siege,
        building: card.kind === 'building', life: card.life || 0,
      });
    }
    fx({ k: 'ring', x, y: LANES[lane], r: 26, s: side });
    Arcade.tone({ freq: 520, to: 700, dur: 0.08, type: 'triangle', vol: 0.04 });
    return true;
  }

  // ---------- Simulation (bot games and the online host) ----------

  function hurt(e, dmg, by) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.flash = 0.12;
    if (e.hp > 0) return;
    e.hp = 0;
    if (e.type === 'tower' || e.type === 'keep') {
      g.players[by].crowns += e.type === 'keep' ? 3 - g.players[by].crowns : 1;
      fx({ k: 'boom', x: e.x, y: entY(e), r: 50, c: '#ffc53d' });
      Arcade.tone({ freq: 220, to: 60, dur: 0.5, type: 'square', vol: 0.06 });
      if (e.type === 'keep') endMatch(by);
    }
  }

  // Units fight within their own lane. A keep joins every lane once that lane's tower falls.
  function findTarget(u, reach) {
    let best = null, bd = reach;
    for (const e of g.ents) {
      if (e.side === u.side || e.hp <= 0) continue;
      if (u.siege && !e.building) continue;
      if (e.type === 'keep') {
        if (u.lane >= 0 && towerAlive(e.side, u.lane)) continue;
      } else if (u.lane >= 0 && e.lane !== u.lane) {
        continue;
      }
      if (u.building && !u.speed && e.building) continue;   // defences don't shoot buildings
      const d = Math.abs(e.x - u.x) - e.r - u.r;
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { e: best, d: bd } : null;
  }

  function step(dt) {
    const mult = g.time <= DOUBLE_AT || g.overtime ? 2 : 1;
    for (const [side, p] of g.players.entries()) {
      const boost = mode === 'bot' && side === 1 ? LEVELS[level].mana : 1;
      p.mana = Math.min(MANA_MAX, p.mana + dt / MANA_EVERY * mult * boost);
    }

    for (const u of g.ents) {
      if (u.hp <= 0) continue;
      u.flash = Math.max(0, u.flash - dt);
      if (u.life) {
        u.life -= dt;
        if (u.life <= 0) { u.hp = 0; continue; }
      }
      u.cd -= dt;
      const t = findTarget(u, u.speed ? u.range + 90 : u.range);
      if (t && t.d <= u.range) {
        if (u.cd <= 0) {
          u.cd = u.rate;
          attack(u, t.e);
        }
      } else if (u.speed) {
        const dir = t ? Math.sign(t.e.x - u.x) : (u.side === 0 ? 1 : -1);
        u.x = Math.max(KEEP_X[0], Math.min(KEEP_X[1], u.x + dir * u.speed * dt));
      }
    }
    g.ents = g.ents.filter(e => e.hp > 0 || e.type === 'tower' || e.type === 'keep');

    if (g.over) return;
    g.time -= dt;
    if (g.overtime && g.players[0].crowns !== g.players[1].crowns) {
      endMatch(g.players[0].crowns > g.players[1].crowns ? 0 : 1);
    } else if (g.time <= 0) {
      const [a, b] = g.players.map(p => p.crowns);
      if (a !== b) endMatch(a > b ? 0 : 1);
      else if (!g.overtime) { g.overtime = true; g.time = OVERTIME; }
      else endMatch(-1);
    }
  }

  function attack(u, target) {
    const y1 = entY(u), y2 = entY(target);
    if (u.ranged) fx({ k: 'shot', x1: u.x, y1, x2: target.x, y2, c: u.splash ? '#ffb347' : '#e8e3c8' });
    else fx({ k: 'hit', x: target.x, y: y2 });
    if (u.splash) {
      for (const e of g.ents) {
        if (e.side === u.side || e.hp <= 0 || (e.lane !== target.lane && e !== target)) continue;
        if (Math.abs(e.x - target.x) <= u.splash) hurt(e, u.dmg, u.side);
      }
      fx({ k: 'boom', x: target.x, y: y2, r: u.splash, c: '#ff9a3d' });
    } else {
      hurt(target, u.dmg, u.side);
    }
  }

  function endMatch(winner) {
    g.over = { winner, crowns: g.players.map(p => p.crowns) };
  }

  // ---------- Bot ----------

  function botThink() {
    const side = 1, p = g.players[side];
    const hand = p.hand.map((c, slot) => ({ slot, card: CARDS[c] })).filter(h => h.card.cost <= p.mana);
    if (!hand.length) return;
    const enemies = g.ents.filter(e => e.side === 0 && e.hp > 0 && !e.building);

    // Fireball a clump of three or more.
    const ball = hand.find(h => h.card.id === 'fireball');
    if (ball) {
      for (const e of enemies) {
        const near = enemies.filter(o => o.lane === e.lane && Math.abs(o.x - e.x) < 55);
        if (near.length >= 3 && e.x > MID - 120) return playCard(side, ball.slot, e.lane, e.x);
      }
    }

    // Defend the lane with the most attackers past the middle.
    const threat = [0, 1, 2].map(lane => enemies.filter(e => e.lane === lane && e.x > MID - 60).reduce((s, e) => s + e.hp, 0));
    const lane = threat.indexOf(Math.max(...threat));
    if (threat[lane] > 0) {
      const foes = enemies.filter(e => e.lane === lane);
      const big = foes.some(e => e.type === 'brute' || e.type === 'rider');
      const swarm = foes.length >= 3;
      const pref = big ? ['rats', 'squire', 'turret', 'archers'] : swarm ? ['bomber', 'archers', 'turret', 'squire'] : ['squire', 'archers', 'rider', 'turret'];
      const pickH = pref.map(id => hand.find(h => h.card.id === id)).find(Boolean) || hand.find(h => h.card.kind !== 'spell');
      if (pickH) {
        const front = Math.max(...foes.map(e => e.x));
        const x = Math.max(DEPLOY[1][0], Math.min(DEPLOY[1][1], pickH.card.kind === 'building' ? TOWER_X[1] - 70 : front + 90));
        return playCard(side, pickH.slot, lane, x);
      }
    }

    // Otherwise save up, then push the weakest enemy lane with a tank and support behind it.
    if (p.mana < (level === 2 ? 7 : 8)) return;
    const towers = g.ents.filter(e => e.type === 'tower' && e.side === 0 && e.hp > 0);
    const push = towers.length ? towers.reduce((a, b) => (b.hp < a.hp ? b : a)).lane : Arcade.randInt(0, 2);
    const order = ['brute', 'rider', 'bomber', 'archers', 'squire', 'rats'];
    const pickH = order.map(id => hand.find(h => h.card.id === id)).find(Boolean);
    if (pickH) playCard(side, pickH.slot, push, pickH.card.id === 'brute' ? DEPLOY[1][1] - 10 : DEPLOY[1][0] + 60);
  }

  // ---------- Network ----------

  // The host sends the whole visible match about 12 times a second; the guest only draws it.
  function snapshot() {
    return {
      t: Math.round(g.time * 10) / 10, o: g.overtime ? 1 : 0,
      e: g.ents.map(e => [e.id, CARD_INDEX[e.type] ?? (e.type === 'tower' ? 90 : 91), e.side, Math.round(e.x), e.lane, Math.round(e.hp), e.maxHp, Math.round(e.yOff), e.flash > 0 ? 1 : 0]),
      p: g.players.map(p => [Math.round(p.mana * 100) / 100, p.crowns]),
      h: g.players[1].hand, n: g.players[1].queue[0],
      f: g.newFx.splice(0),
      over: g.over,
    };
  }
  const CARD_INDEX = Object.fromEntries(CARDS.map((c, i) => [c.id, i]));

  function applySnapshot(s) {
    const entry = { s, at: performance.now() };
    snaps = [snaps[1] || entry, entry];
    g.time = s.t;
    g.overtime = !!s.o;
    s.p.forEach(([mana, crowns], i) => Object.assign(g.players[i], { mana, crowns }));
    g.players[1].hand = s.h;
    g.players[1].queue = [s.n];
    for (const f of s.f) g.fx.push({ ...f, t: 0 });
    if (s.f.some(f => f.k === 'boom' && f.r >= 50)) Arcade.tone({ freq: 220, to: 60, dur: 0.5, type: 'square', vol: 0.06 });
    if (s.over && state === 'playing') {
      g.over = s.over;
      showResult();
    }
  }

  // Guest: rebuild entities by moving each one from the older snapshot towards the newer one.
  function guestEnts() {
    if (snaps.length < 2) return [];
    const [a, b] = snaps;
    const k = Math.min(1, (performance.now() - b.at) / (SEND_EVERY * 1000));
    const prev = new Map(a.s.e.map(e => [e[0], e]));
    return b.s.e.map(([id, ci, side, x, lane, hp, maxHp, yOff, flash]) => {
      const old = prev.get(id);
      const px = old ? old[3] + (x - old[3]) * k : x;
      const type = ci === 90 ? 'tower' : ci === 91 ? 'keep' : CARDS[ci].id;
      const base = ci >= 90 ? BUILDINGS[type] : CARDS[ci];
      return { id, type, side, x: px, lane, hp, maxHp, yOff, flash: flash ? 0.1 : 0, r: base.r, building: ci >= 90 || base.kind === 'building' };
    });
  }

  function onNetEvent(name, data) {
    if (name === 'play' && mode === 'host' && state === 'playing') {
      playCard(1, data.slot, data.lane, data.x);
    } else if (name === 'rematch') {
      net.want.them = true;
      maybeRematch();
    } else if (name === 'start' && mode === 'guest') {
      newMatch();
      snaps = [];
      beginPlaying();
    } else if (name === 'quit') {
      opponentGone();
    }
  }

  function maybeRematch() {
    if (mode !== 'host' || !net.want.me || !net.want.them) return;
    net.want = { me: false, them: false };
    newMatch();
    net.conn.send('start');
    beginPlaying();
  }

  function opponentGone() {
    if (!net) return;
    const wasPlaying = state === 'playing';
    leaveNet();
    state = 'over';
    if (wasPlaying) {
      Arcade.countPlay();
      Arcade.flag('online-match');
    }
    ui.show({
      title: wasPlaying ? 'Your opponent left' : 'Disconnected',
      html: wasPlaying ? '<p>You win by forfeit.</p>' : '<p>The other player is gone.</p>',
      button: 'Back to menu',
      onAction: () => showMenu(),
    });
  }

  function leaveNet() {
    net?.conn.close();
    net = null;
  }

  async function goOnline(how, code) {
    let cancelled = false;
    ui.show({ title: 'Connecting…', html: '<p>Waking up the game server. The first connection can take up to a minute.</p>', button: 'Cancel', onAction: () => { cancelled = true; showMenu(); } });
    const handlers = {
      ready: () => {
        if (cancelled) return;
        net.conn.send('hello', { name: Arcade.profile().name });
        if (me === 0) {
          mode = 'host';
          newMatch();
          net.conn.send('start');
          beginPlaying();
        }
      },
      event: (name, data) => {
        if (name === 'hello') net.names[1] = String(data?.name || 'Opponent').slice(0, 24);
        else onNetEvent(name, data);
      },
      state: s => { if (mode === 'guest') applySnapshot(s); },
      left: opponentGone,
      closed: () => { if (net) opponentGone(); },
    };
    try {
      const res = how === 'quick' ? await Relay.quickMatch('rune', handlers, 'Match')
        : how === 'create' ? await Relay.createRoom('rune', handlers)
        : how === 'public' ? await Relay.joinPublic(code, handlers)
        : await Relay.joinRoom('rune', code, handlers);
      if (cancelled) { res.conn.close(); return; }
      net = { conn: res.conn, names: [Arcade.profile().name, 'Opponent'], sendT: 0, want: { me: false, them: false } };
      me = res.slot === 1 ? 0 : 1;
      mode = me === 0 ? 'waiting' : 'guest';
      if (res.slot === 1) {
        ui.show({
          title: how === 'create' ? 'Waiting for a friend' : 'Looking for an opponent…',
          html: how === 'create'
            ? `<p>Share this code. The match starts as soon as they join.</p><p class="code">${res.code}</p>`
            : '<p>You\'ll be matched with the next player who presses Quick match.</p>',
          button: 'Cancel',
          onAction: () => { cancelled = true; showMenu(); },
        });
      } else {
        ui.show({ title: 'Opponent found', html: '<p>Starting…</p>', button: null });
      }
    } catch (e) {
      if (!cancelled) showMenu(e.message);
    }
  }

  // ---------- Flow ----------

  function beginPlaying() {
    state = 'playing';
    selected = -1;
    botT = 0;
    ui.hide();
    Arcade.tone({ freq: 392, to: 784, dur: 0.25, type: 'triangle', vol: 0.05 });
  }

  function startBot(lv) {
    level = lv;
    mode = 'bot';
    me = 0;
    newMatch();
    beginPlaying();
  }

  function showResult() {
    state = 'over';
    const { winner, crowns } = g.over;
    const mine = crowns[me], theirs = crowns[1 - me];
    const title = winner === -1 ? "It's a draw" : winner === me ? 'Victory!' : 'Defeat';
    Arcade.tone(winner === me ? { freq: 523, to: 1046, dur: 0.4, type: 'triangle', vol: 0.06 } : { freq: 300, to: 120, dur: 0.5, type: 'sawtooth', vol: 0.04 });

    if (mode === 'bot') {
      const L = LEVELS[level];
      const score = Math.round(((winner === 0 ? 300 : 0) + mine * 150 + Math.max(0, Math.round(g.time))) * L.mult);
      if (winner === 0) Arcade.flag('rune-rumble-win');
      if (winner === 0 && level === 2) Arcade.flag('rune-rumble-hard');
      Arcade.finish(ui, {
        score, title,
        lines: [`Crowns ${mine} – ${theirs} · ${L.name} bot`],
        button: 'Menu',
        onAction: () => showMenu(),
      });
      return;
    }

    Arcade.countPlay();
    Arcade.flag('online-match');
    if (winner === me) Arcade.flag('rune-rumble-online-win');
    ui.show({
      title,
      html: `<p class="big">${mine} – ${theirs}</p><p>${Online.escape(net.names[0])} vs ${Online.escape(net.names[1])}</p>
        <div class="menu"><button class="btn secondary" type="button" data-leave>Leave</button></div>
        <p class="muted-note" data-wait>A rematch starts when you both press it.</p>`,
      button: 'Rematch',
      onAction: () => {
        net.want.me = true;
        net.conn.send('rematch');
        document.querySelector('[data-wait]').textContent = 'Waiting for your opponent…';
        maybeRematch();
      },
      onRender: panel => panel.querySelector('[data-leave]').addEventListener('click', () => {
        net?.conn.send('quit');
        showMenu();
      }),
    });
  }

  function showMenu(error = '') {
    if (net) { net.conn.send('quit'); leaveNet(); }
    state = 'menu';
    mode = null;
    me = 0;
    newMatch();
    const online = Relay.enabled;
    ui.show({
      title: 'Rune Rumble',
      html: `<p>Spend mana on rune cards to send troops down three lanes. Topple towers for crowns, or break the keep to win outright.</p>
        <div class="menu">
          <div class="row">
            ${LEVELS.map((l, i) => `<button class="btn ${i === 1 ? '' : 'secondary'}" type="button" data-bot="${i}">${l.name}</button>`).join('')}
          </div>
          <button class="btn secondary" type="button" data-net="quick" ${online ? '' : 'disabled'}>Quick match online</button>
          <button class="btn secondary" type="button" data-net="create" ${online ? '' : 'disabled'}>Create private room</button>
          <div class="row">
            <input class="field" id="code" maxlength="4" placeholder="CODE" autocomplete="off" aria-label="Room code" ${online ? '' : 'disabled'}>
            <button class="btn secondary" type="button" data-net="join" ${online ? '' : 'disabled'}>Join</button>
          </div>
        </div>
        <p class="error">${error}</p>
        <div data-waiting></div>`,
      button: null,
      onRender: panel => {
        Relay.showWaiting(panel.querySelector('[data-waiting]'), room => goOnline('public', room));
        panel.querySelectorAll('[data-bot]').forEach(b => b.addEventListener('click', () => startBot(+b.dataset.bot)));
        const code = panel.querySelector('#code');
        panel.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => goOnline(b.dataset.net, code.value)));
        code.addEventListener('keydown', e => { if (e.key === 'Enter') goOnline('join', code.value); });
      },
    });
  }

  function pause() {
    if (state !== 'playing' || mode !== 'bot') return;
    state = 'paused';
    ui.show({ title: 'Paused', button: 'Resume', onAction: () => { state = 'playing'; ui.hide(); } });
  }
  Arcade.onBlur(pause);

  window.addEventListener('pagehide', () => net?.conn.send('quit'));

  // ---------- Input ----------

  // Screen x for a world x: guests see the field mirrored so their side is always on the left.
  const sx = x => (me === 1 ? W - x : x);

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  const CARD_W = 128, CARD_H = 104, HAND_Y = FIELD_H + 18;
  const cardX = i => 210 + i * (CARD_W + 12);

  function tryPlay(px, py) {
    if (selected < 0 || py > FIELD_H) return;
    const lane = laneOf(py), x = sx(px);
    if (mode === 'guest') {
      if (!canPlay(1, selected, lane, x)) return Arcade.tone({ freq: 140, dur: 0.08, vol: 0.03 });
      net.conn.send('play', { slot: selected, lane, x: Math.round(x) });
      Arcade.tone({ freq: 520, to: 700, dur: 0.08, type: 'triangle', vol: 0.04 });
    } else if (!playCard(me, selected, lane, x)) {
      return Arcade.tone({ freq: 140, dur: 0.08, vol: 0.03 });
    }
    selected = -1;
  }

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    const [px, py] = toBoard(e);
    for (let i = 0; i < 4; i++) {
      if (px >= cardX(i) && px <= cardX(i) + CARD_W && py >= HAND_Y && py <= HAND_Y + CARD_H) {
        selected = selected === i ? -1 : i;
        Arcade.tone({ freq: 660, dur: 0.04, vol: 0.03 });
        return;
      }
    }
    tryPlay(px, py);
  });
  canvas.addEventListener('pointermove', e => { hover = toBoard(e); });
  canvas.addEventListener('pointerleave', () => { hover = null; });

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pause();
      return;
    }
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0 && state === 'playing') selected = selected === n ? -1 : n;
  });

  // ---------- Drawing ----------

  function drawField() {
    ctx.fillStyle = '#1b2a1f';
    ctx.fillRect(0, 0, W, FIELD_H);
    // Your half tinted blue, theirs red.
    ctx.fillStyle = 'rgba(79,140,255,0.05)';
    ctx.fillRect(0, 0, MID, FIELD_H);
    ctx.fillStyle = 'rgba(255,93,93,0.05)';
    ctx.fillRect(MID, 0, MID, FIELD_H);
    for (const y of LANES) {
      ctx.fillStyle = '#2b3b2c';
      ctx.fillRect(0, y - 26, W, 52);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.setLineDash([10, 12]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
    }
    // River down the middle.
    ctx.fillStyle = '#1f4a6b';
    ctx.fillRect(MID - 10, 0, 20, FIELD_H);
    for (const y of LANES) {
      ctx.fillStyle = '#6b5233';
      ctx.fillRect(MID - 14, y - 22, 28, 44);
    }

    if (selected >= 0 && state === 'playing') {
      const hand = g.players[me].hand;
      const card = CARDS[hand[selected]];
      if (card && card.kind !== 'spell') {
        const [a, b] = DEPLOY[me];
        const x1 = Math.min(sx(a), sx(b)), x2 = Math.max(sx(a), sx(b));
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x1, 0, x2 - x1, FIELD_H);
      }
      if (hover && hover[1] < FIELD_H) {
        const lane = laneOf(hover[1]);
        if (lane >= 0) {
          const ok = canPlay(me, selected, lane, sx(hover[0]));
          ctx.strokeStyle = ok ? 'rgba(255,255,255,0.7)' : 'rgba(255,93,93,0.7)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(hover[0], LANES[lane], card?.radius || 22, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  function drawEnt(e) {
    const x = sx(e.x), y = entY(e);
    const mine = e.side === me;
    const col = mine ? COLORS.me : COLORS.them;
    const face = mine ? 1 : -1;
    ctx.save();
    ctx.translate(x, y);
    if (e.hp <= 0) {
      ctx.fillStyle = '#3a3f48';
      ctx.fillRect(-e.r, -e.r * 0.4, e.r * 2, e.r * 0.8);
      ctx.restore();
      return;
    }
    ctx.fillStyle = e.flash > 0 ? '#ffffff' : col;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    switch (e.type) {
      case 'keep':
        ctx.fillRect(-26, -150, 52, 300);
        ctx.strokeRect(-26, -150, 52, 300);
        ctx.fillStyle = '#ffc53d';
        ctx.beginPath(); ctx.moveTo(-12, -8); ctx.lineTo(0, -22); ctx.lineTo(12, -8); ctx.lineTo(8, 8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
        break;
      case 'tower':
        ctx.fillRect(-18, -20, 36, 40);
        ctx.strokeRect(-18, -20, 36, 40);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        for (let i = -1; i <= 1; i++) ctx.fillRect(i * 12 - 4, -26, 8, 8);
        break;
      case 'turret':
        ctx.fillRect(-12, -12, 24, 24);
        ctx.fillStyle = '#20242c';
        ctx.fillRect(0, -3, 18 * face, 6);
        break;
      case 'brute':
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#20242c';
        ctx.fillRect(8 * face - 4, -16, 8, 32);
        break;
      case 'archers':
        ctx.beginPath(); ctx.moveTo(9 * face, 0); ctx.lineTo(-7 * face, -8); ctx.lineTo(-7 * face, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'rats':
        ctx.beginPath(); ctx.ellipse(0, 0, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'bomber':
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffb347';
        ctx.fillRect(-2, -14, 4, 6);
        break;
      case 'rider':
        ctx.beginPath(); ctx.ellipse(0, 3, 14, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -7, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      default:
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#e8e3c8';
        ctx.beginPath(); ctx.moveTo(6 * face, -2); ctx.lineTo(16 * face, -10); ctx.stroke();
    }
    ctx.restore();

    if (e.hp < e.maxHp) {
      const w = e.building ? 44 : Math.max(16, e.r * 2.2);
      const top = e.type === 'keep' ? y - 162 : y - e.r - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - w / 2, top, w, 4);
      ctx.fillStyle = col;
      ctx.fillRect(x - w / 2, top, w * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  function drawFx(dt) {
    for (const f of g.fx) {
      f.t += dt;
      const a = 1 - f.t / (f.k === 'boom' ? 0.45 : 0.25);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      if (f.k === 'shot') {
        const k = Math.min(1, f.t / 0.15);
        ctx.fillStyle = f.c;
        ctx.beginPath();
        ctx.arc(sx(f.x1 + (f.x2 - f.x1) * k), f.y1 + (f.y2 - f.y1) * k, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.k === 'boom') {
        ctx.fillStyle = f.c;
        ctx.beginPath();
        ctx.arc(sx(f.x), f.y, f.r * (0.5 + f.t), 0, Math.PI * 2);
        ctx.fill();
      } else if (f.k === 'ring') {
        ctx.strokeStyle = f.s === me ? COLORS.me : COLORS.them;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx(f.x), f.y, f.r * (1 + f.t * 2), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx(f.x) - 3, f.y - 3, 6, 6);
      }
    }
    ctx.globalAlpha = 1;
    g.fx = g.fx.filter(f => f.t < 0.5);
  }

  function drawHand() {
    ctx.fillStyle = '#12151b';
    ctx.fillRect(0, FIELD_H, W, H - FIELD_H);
    const p = g.players[me];

    // Mana bar.
    ctx.fillStyle = '#8d94a1';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('MANA', 24, HAND_Y + 14);
    ctx.fillStyle = '#d06bff';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillText(Math.floor(p.mana), 24, HAND_Y + 58);
    for (let i = 0; i < MANA_MAX; i++) {
      const fill = Math.max(0, Math.min(1, p.mana - i));
      ctx.fillStyle = '#2a2f39';
      ctx.fillRect(24 + i * 16, HAND_Y + 76, 13, 18);
      ctx.fillStyle = '#d06bff';
      ctx.fillRect(24 + i * 16, HAND_Y + 76 + 18 * (1 - fill), 13, 18 * fill);
    }

    p.hand.forEach((ci, i) => {
      const c = CARDS[ci];
      if (!c) return;
      const x = cardX(i), y = HAND_Y - (selected === i ? 8 : 0);
      const ok = p.mana >= c.cost;
      ctx.fillStyle = selected === i ? '#2b3446' : '#1e222a';
      ctx.fillRect(x, y, CARD_W, CARD_H);
      ctx.strokeStyle = selected === i ? '#ffc53d' : '#2a2f39';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, CARD_W, CARD_H);
      ctx.globalAlpha = ok ? 1 : 0.4;
      if (c.kind !== 'spell') drawEnt({ type: c.id, side: me, lane: -1, x: sx(x + CARD_W / 2), yOff: y + 44 - LANES[1], hp: 1, maxHp: 1, r: c.r, flash: 0 });
      else {
        ctx.fillStyle = '#ff9a3d';
        ctx.beginPath(); ctx.arc(x + CARD_W / 2, y + 44, 14, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#eceef2';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(c.name + (c.count ? ` ×${c.count}` : ''), x + CARD_W / 2, y + CARD_H - 12);
      ctx.fillStyle = '#d06bff';
      ctx.beginPath(); ctx.arc(x + 16, y + 16, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(c.cost, x + 16, y + 21);
      ctx.fillStyle = '#5c6370';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillText(i + 1, x + CARD_W - 12, y + 18);
      ctx.globalAlpha = 1;
    });

    const next = CARDS[p.queue[0]];
    ctx.fillStyle = '#8d94a1';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT', W - 70, HAND_Y + 14);
    if (next) {
      ctx.fillStyle = '#eceef2';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(next.name, W - 70, HAND_Y + 50);
      ctx.fillStyle = '#d06bff';
      ctx.fillText(next.cost + ' mana', W - 70, HAND_Y + 70);
    }
  }

  function drawBanner() {
    const t = Math.max(0, Math.ceil(g.time));
    const label = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    ctx.textAlign = 'center';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(MID - 70, 6, 140, 26);
    ctx.fillStyle = g.overtime ? '#ff7a7a' : '#eceef2';
    ctx.fillText(g.overtime ? `OT ${label}` : label, MID, 25);
    if ((g.time <= DOUBLE_AT || g.overtime) && state === 'playing') {
      ctx.fillStyle = '#d06bff';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText('2× MANA', MID, 46);
    }
    if (net && state === 'playing') {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = '#8d94a1';
      ctx.textAlign = 'left';
      ctx.fillText(net.names[0], 12, FIELD_H - 10);
      ctx.textAlign = 'right';
      ctx.fillText(net.names[1], W - 12, FIELD_H - 10);
    }
  }

  function updateHud() {
    const t = Math.max(0, Math.ceil(g.time));
    $('time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('you').textContent = g.players[me].crowns;
    $('them').textContent = g.players[1 - me].crowns;
  }

  // ---------- Loop ----------

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (state === 'playing' && (mode === 'bot' || mode === 'host')) {
      acc += dt;
      while (acc >= STEP) {
        step(STEP);
        acc -= STEP;
        if (mode === 'bot' && !g.over) {
          botT -= STEP;
          if (botT <= 0) {
            botT = LEVELS[level].think * Arcade.rand(0.7, 1.3);
            botThink();
          }
        }
      }
      if (mode === 'host' && net) {
        net.sendT -= dt;
        if (net.sendT <= 0 || g.over) {
          net.sendT = SEND_EVERY;
          net.conn.state(snapshot());
        }
      }
      if (g.over) showResult();
    }

    const ents = mode === 'guest' ? guestEnts() : g.ents;
    drawField();
    for (const e of ents.filter(e => e.building)) drawEnt(e);
    for (const e of ents.filter(e => !e.building)) drawEnt(e);
    drawFx(dt);
    drawBanner();
    drawHand();
    updateHud();
    requestAnimationFrame(frame);
  }

  showMenu();
  const invite = Relay.takeInvite();
  if (invite) goOnline('public', invite);
  requestAnimationFrame(frame);
})();
