(() => {
  const W = 900, H = 520, N = 10, CELL = 36;
  const GRIDS = [{ x: 50, y: 96 }, { x: 490, y: 96 }];  // your fleet, enemy waters
  const SHIPS = [5, 4, 3, 3, 2];
  const NAMES = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'];
  const STRIKE_AT = 3;
  const LEVELS = ['Easy', 'Normal', 'Hard'];
  const BASE = [300, 600, 900];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  // phase: 'menu' | 'place' | 'battle' | 'over'
  let phase = 'menu', mode = null, level = 1, me = 0, names = ['You', 'Computer'];
  let fleet, incoming, view, sonars, turn, first, ready, theirReady, tool, sonarLeft, streak, shots, hits, hover = -1, drag = null, waiting = false;
  let cpu = null, cpuTimer = null, log = [], sunkCount = 0;

  // ---------- Fleets ----------

  const cellsOf = s => Array.from({ length: s.len }, (_, k) => (s.r + (s.dir ? k : 0)) * N + s.c + (s.dir ? 0 : k));

  function fits(ships, s, skip = -1) {
    if (s.r < 0 || s.c < 0 || (s.dir ? s.r + s.len : s.c + s.len) > N || (s.dir ? s.c : s.r) >= N) return false;
    const taken = new Set(ships.flatMap((o, i) => (i === skip ? [] : cellsOf(o))));
    return cellsOf(s).every(i => !taken.has(i));
  }

  function randomFleet() {
    const ships = [];
    for (const len of SHIPS) {
      let s;
      do s = { len, dir: Math.random() < 0.5 ? 1 : 0, r: Arcade.randInt(0, N - 1), c: Arcade.randInt(0, N - 1), hits: 0 };
      while (!fits(ships, s));
      ships.push(s);
    }
    return ships;
  }

  // The defending side works out what a volley hit. Every cell reports back as a miss, a hit, or a
  // hit that sank a ship (with that ship's cells, so the shooter can outline it).
  function resolve(ships, shotsAt, cells) {
    const out = [];
    for (const i of cells) {
      if (i < 0 || i >= N * N || shotsAt[i]) continue;
      const k = ships.findIndex(s => cellsOf(s).includes(i));
      shotsAt[i] = k >= 0 ? 2 : 1;
      const res = { i, hit: k >= 0 };
      if (k >= 0 && ++ships[k].hits === ships[k].len) res.sunk = { cells: cellsOf(ships[k]), name: NAMES[k] };
      out.push(res);
    }
    return { cells: out, over: ships.every(s => s.hits === s.len) };
  }

  const countIn = (ships, cells) => cells.filter(i => ships.some(s => cellsOf(s).includes(i))).length;

  function area(center, kind) {
    const r = Math.floor(center / N), c = center % N, out = [];
    const offs = kind === 'sonar' ? [-1, 0, 1].flatMap(dr => [-1, 0, 1].map(dc => [dr, dc])) : kind === 'strike' ? [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] : [[0, 0]];
    for (const [dr, dc] of offs) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
    }
    return out;
  }

  // ---------- Turns ----------

  function myTurn() {
    return phase === 'battle' && turn === me && !waiting;
  }

  function fire(center) {
    if (!myTurn()) return;
    const kind = tool;
    if (kind === 'sonar' && !sonarLeft) return;
    if (kind === 'strike' && streak < STRIKE_AT) return;
    const cells = area(center, kind);
    if (kind !== 'sonar' && cells.every(i => view[i])) return;
    if (kind === 'sonar') sonarLeft--;
    if (kind === 'strike') streak = 0;
    tool = 'shot';
    Arcade.tone(kind === 'sonar' ? { freq: 1200, to: 600, dur: 0.4, type: 'sine', vol: 0.05 } : { freq: 200, to: 80, dur: 0.2, type: 'square', vol: 0.04 });
    if (mode === 'cpu') {
      const res = kind === 'sonar' ? { sonar: countIn(cpu.ships, cells), center, cells: [] } : resolve(cpu.ships, cpu.incoming, cells);
      landed(kind, center, res);
    } else {
      waiting = true;
      Match.move({ k: 'fire', kind, center, cells });
    }
    renderTools();
  }

  // The result of this player's volley, from the computer or the other player's game.
  function landed(kind, center, res) {
    waiting = false;
    if (kind === 'sonar') {
      sonars.push({ center, count: res.sonar | 0 });
      say(`Sonar: ${res.sonar | 0} ship square${res.sonar === 1 ? '' : 's'} in that area`);
    } else {
      let anyHit = false;
      for (const c of res.cells || []) {
        if (c.i < 0 || c.i >= N * N) continue;
        shots++;
        view[c.i] = c.hit ? 2 : 1;
        if (c.hit) { hits++; anyHit = true; }
        if (c.sunk) {
          c.sunk.cells.forEach(i => { if (i >= 0 && i < N * N) view[i] = 3; });
          sunkCount++;
          say(`You sank their ${c.sunk.name}!`);
        }
      }
      if (kind === 'shot') streak = anyHit ? streak + 1 : 0;
      if (!res.cells?.some(c => c.sunk)) say(anyHit ? (kind === 'strike' ? 'Airstrike hit!' : 'Hit!') : 'Miss.');
      Arcade.tone(anyHit ? { freq: 520, to: 260, dur: 0.25, type: 'sawtooth', vol: 0.05 } : { freq: 300, dur: 0.08, vol: 0.02 });
      if (res.over) return end(me);
    }
    turn = 1 - me;
    renderTools();
    scheduleCpu();
  }

  // The other side's volley at this player's fleet.
  function incomingFire(kind, center, cells) {
    let res;
    if (kind === 'sonar') {
      res = { sonar: countIn(fleet, cells), cells: [] };
      say(`${names[1 - me]} pinged your waters with sonar`);
    } else {
      res = resolve(fleet, incoming, cells);
      const hit = res.cells.some(c => c.hit);
      const sunk = res.cells.find(c => c.sunk);
      say(sunk ? `${names[1 - me]} sank your ${sunk.sunk.name}` : hit ? `${names[1 - me]} hit you` : `${names[1 - me]} missed`);
      Arcade.tone(hit ? { freq: 160, to: 60, dur: 0.3, type: 'sawtooth', vol: 0.05 } : { freq: 260, dur: 0.06, vol: 0.02 });
    }
    return res;
  }

  function say(text) {
    log.unshift({ text, t: performance.now() });
    log.length = Math.min(log.length, 3);
  }

  // ---------- Computer ----------

  function cpuTarget() {
    const unknown = [];
    for (let i = 0; i < N * N; i++) if (!cpu.shotsAt[i]) unknown.push(i);
    if (level === 0 && Math.random() < 0.6) return Arcade.pick(unknown);
    // Every way the remaining ships could still lie scores the squares it covers. Unsunk hits pull
    // hard, so it chases a wounded ship along its line.
    const heat = Array(N * N).fill(0);
    const open = i => cpu.shotsAt[i] !== 1 && cpu.shotsAt[i] !== 3;
    const live = cpu.left.slice();
    const wounded = cpu.shotsAt.some(v => v === 2);
    for (const len of live) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const dir of [0, 1]) {
        const s = { len, r, c, dir };
        if ((dir ? r + len : c + len) > N) continue;
        const cs = cellsOf(s);
        if (!cs.every(open)) continue;
        const onHits = cs.filter(i => cpu.shotsAt[i] === 2).length;
        if (wounded && !onHits && level > 1) continue;
        for (const i of cs) if (!cpu.shotsAt[i]) heat[i] += 1 + onHits * 20;
      }
    }
    if (level === 1 && !wounded) {
      // Normal hunts on a checkerboard, which still finds every ship.
      for (let i = 0; i < N * N; i++) if ((Math.floor(i / N) + i) % 2) heat[i] *= 0.2;
    }
    const top = Math.max(...unknown.map(i => heat[i]));
    return Arcade.pick(unknown.filter(i => heat[i] === top));
  }

  function scheduleCpu() {
    clearTimeout(cpuTimer);
    if (mode !== 'cpu' || phase !== 'battle' || turn !== 1) return;
    cpuTimer = setTimeout(() => {
      if (phase !== 'battle' || turn !== 1) return;
      const i = cpuTarget();
      const res = incomingFire('shot', i, [i]);
      cpu.shotsAt[i] = res.cells[0]?.hit ? 2 : 1;
      const sunk = res.cells[0]?.sunk;
      if (sunk) {
        sunk.cells.forEach(j => { cpu.shotsAt[j] = 3; });
        cpu.left.splice(cpu.left.indexOf(sunk.cells.length), 1);
      }
      if (res.over) return end(1);
      turn = 0;
      renderTools();
    }, 700);
  }

  // ---------- Flow ----------

  function begin(s) {
    clearTimeout(cpuTimer);
    mode = s.mode;
    level = s.level;
    me = s.me;
    names = s.names;
    first = s.first;
    fleet = randomFleet();
    incoming = Array(N * N).fill(0);
    view = Array(N * N).fill(0);
    sonars = [];
    sonarLeft = 1;
    streak = 0;
    shots = hits = sunkCount = 0;
    ready = theirReady = waiting = false;
    tool = 'shot';
    log = [];
    cpu = mode === 'cpu' ? { ships: randomFleet(), incoming: Array(N * N).fill(0), shotsAt: Array(N * N).fill(0), left: SHIPS.slice() } : null;
    phase = 'place';
    renderTools();
  }

  function setReady() {
    if (phase !== 'place' || ready) return;
    ready = true;
    if (mode === 'online') Match.move({ k: 'ready' });
    maybeBattle();
  }

  function maybeBattle() {
    if (!ready || (mode === 'online' && !theirReady)) {
      renderTools();
      return;
    }
    phase = 'battle';
    turn = first;
    say(turn === me ? 'Your shot first.' : `${names[1 - me]} shoots first.`);
    Arcade.tone({ freq: 440, to: 880, dur: 0.3, type: 'triangle', vol: 0.05 });
    renderTools();
    scheduleCpu();
  }

  function onMove(d) {
    if (d.k === 'ready') {
      theirReady = true;
      if (phase === 'place') maybeBattle();
    } else if (d.k === 'fire' && phase === 'battle' && turn !== me) {
      const kind = ['shot', 'sonar', 'strike'].includes(d.kind) ? d.kind : 'shot';
      const cells = area(d.center | 0, kind);
      const res = incomingFire(kind, d.center | 0, cells);
      Match.move({ k: 'res', kind, center: d.center | 0, ...res });
      if (res.over) return end(1 - me);
      turn = me;
      renderTools();
    } else if (d.k === 'res' && phase === 'battle' && turn === me && waiting) {
      landed(d.kind, d.center | 0, d);
    }
  }

  function end(winner) {
    phase = 'over';
    clearTimeout(cpuTimer);
    renderTools();
    const afloat = fleet.reduce((n, s) => n + s.len, 0) - incoming.filter(v => v === 2).length;
    const acc = shots ? hits / shots : 0;
    if (winner === me && mode !== 'local' && afloat === 17) Arcade.flag('fleet-hunt-flawless');
    const score = winner === 0 ? BASE[level] + afloat * 10 + Math.round(acc * 300) : hits * 10;
    setTimeout(() => Match.over({
      winner,
      score,
      lines: [`Accuracy ${Math.round(acc * 100)}% · ${afloat} of 17 squares of your fleet still afloat`],
    }), 1200);
  }

  Match.setup({
    ui,
    tag: 'fleethunt',
    title: 'Fleet Hunt',
    levels: LEVELS,
    local: false,
    winFlag: 'fleet-hunt-win',
    hardFlag: 'fleet-hunt-hard',
    onlineWinFlag: 'fleet-hunt-online-win',
    rules: `<ul>
      <li>Hide five ships, then take turns firing at the enemy grid. Sink their whole fleet to win.</li>
      <li><b>Sonar</b> (once a game): ping a 3×3 area to learn how many ship squares are inside.</li>
      <li><b>Airstrike</b>: hit ${STRIKE_AT} shots in a row to charge it, then blast five squares in a plus shape.</li>
    </ul>`,
    onStart: begin,
    onMove,
    onStop: () => { phase = 'over'; renderTools(); },
  });

  // ---------- Controls ----------

  function renderTools() {
    const bar = $('actions');
    const b = (id, label, on = true, cls = 'secondary') => `<button class="btn ${cls}" type="button" data-a="${id}" ${on ? '' : 'disabled'}>${label}</button>`;
    if (phase === 'place') {
      bar.innerHTML = ready
        ? '<span class="muted-note" style="align-self:center;color:var(--muted)">Waiting for your opponent to finish placing…</span>'
        : b('shuffle', 'Shuffle fleet') + b('ready', 'Ready to battle', true, '');
    } else if (phase === 'battle') {
      const mine = myTurn();
      bar.innerHTML = b('shot', 'Fire (1)', mine, tool === 'shot' ? '' : 'secondary') +
        b('sonar', `Sonar ×${sonarLeft} (2)`, mine && sonarLeft > 0, tool === 'sonar' ? '' : 'secondary') +
        b('strike', `Airstrike ${Math.min(streak, STRIKE_AT)}/${STRIKE_AT} (3)`, mine && streak >= STRIKE_AT, tool === 'strike' ? '' : 'secondary');
    } else {
      bar.innerHTML = '';
    }
    $('turn').textContent = phase === 'battle' ? (turn === me ? 'Yours' : mode === 'cpu' ? 'Computer' : 'Theirs') : phase === 'place' ? 'Placing' : '-';
    $('afloat').textContent = fleet ? fleet.filter(s => s.hits < s.len).length : 5;
    $('sunk').textContent = sunkCount;
  }

  $('actions').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    e.target.blur();
    if (a === 'shuffle') fleet = randomFleet();
    else if (a === 'ready') setReady();
    else tool = a;
    renderTools();
  });

  window.addEventListener('keydown', e => {
    if (!$('overlay').hidden || phase !== 'battle') return;
    if (e.code === 'Digit1') tool = 'shot';
    else if (e.code === 'Digit2' && sonarLeft) tool = 'sonar';
    else if (e.code === 'Digit3' && streak >= STRIKE_AT) tool = 'strike';
    else return;
    renderTools();
  });

  function cellAt(e, g) {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const c = Math.floor((px - GRIDS[g].x) / CELL), rr = Math.floor((py - GRIDS[g].y) / CELL);
    return c >= 0 && c < N && rr >= 0 && rr < N ? rr * N + c : -1;
  }

  // While placing: drag a ship to move it, click it to turn it.
  canvas.addEventListener('pointerdown', e => {
    if (phase === 'place' && !ready) {
      const i = cellAt(e, 0);
      const k = fleet.findIndex(s => cellsOf(s).includes(i));
      if (k < 0) return;
      canvas.setPointerCapture(e.pointerId);
      const s = fleet[k];
      drag = { k, off: s.dir ? Math.floor(i / N) - s.r : (i % N) - s.c, moved: false, start: i };
    } else if (phase === 'battle') {
      const i = cellAt(e, 1);
      if (i >= 0) fire(i);
    }
  });
  canvas.addEventListener('pointermove', e => {
    hover = phase === 'battle' ? cellAt(e, 1) : -1;
    if (!drag) return;
    const i = cellAt(e, 0);
    if (i < 0 || i === drag.start) return;
    drag.moved = true;
    const s = fleet[drag.k];
    const next = { ...s, r: Math.floor(i / N) - (s.dir ? drag.off : 0), c: (i % N) - (s.dir ? 0 : drag.off) };
    if (fits(fleet, next, drag.k)) {
      fleet[drag.k] = next;
      drag.start = i;
    }
  });
  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    if (!drag.moved) {
      const s = fleet[drag.k];
      const turned = { ...s, dir: 1 - s.dir };
      if (fits(fleet, turned, drag.k)) fleet[drag.k] = turned;
    }
    drag = null;
  });
  canvas.addEventListener('pointerleave', () => { hover = -1; });

  // ---------- Drawing ----------

  function water(g, title, active) {
    const { x, y } = GRIDS[g];
    ctx.fillStyle = '#0f2340';
    ctx.fillRect(x, y, N * CELL, N * CELL);
    ctx.strokeStyle = active ? '#4f8cff' : '#1d3a66';
    ctx.lineWidth = 1;
    for (let k = 0; k <= N; k++) {
      ctx.beginPath();
      ctx.moveTo(x + k * CELL, y); ctx.lineTo(x + k * CELL, y + N * CELL);
      ctx.moveTo(x, y + k * CELL); ctx.lineTo(x + N * CELL, y + k * CELL);
      ctx.stroke();
    }
    ctx.fillStyle = '#6b7280';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let k = 0; k < N; k++) {
      ctx.fillText('ABCDEFGHIJ'[k], x + k * CELL + CELL / 2, y - 6);
      ctx.fillText(k + 1, x - 12, y + k * CELL + CELL / 2 + 4);
    }
    ctx.fillStyle = active ? '#eceef2' : '#8d94a1';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(title, x + N * CELL / 2, y - 26);
  }

  function marker(g, i, kind) {
    const x = GRIDS[g].x + (i % N) * CELL, y = GRIDS[g].y + Math.floor(i / N) * CELL;
    if (kind === 1) {
      ctx.fillStyle = '#5b7bb0';
      ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, 4, 0, Math.PI * 2); ctx.fill();
    } else {
      if (kind === 3) {
        ctx.fillStyle = '#5a1f28';
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      }
      ctx.strokeStyle = '#ff5f6d';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 10, y + 10); ctx.lineTo(x + CELL - 10, y + CELL - 10);
      ctx.moveTo(x + CELL - 10, y + 10); ctx.lineTo(x + 10, y + CELL - 10);
      ctx.stroke();
    }
  }

  function draw() {
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, W, H);
    if (!fleet) return;
    const battle = phase === 'battle';
    water(0, phase === 'place' ? 'Your fleet · drag to move, click to turn' : 'Your fleet', phase === 'place' || (battle && turn !== me));
    water(1, battle && turn === me ? 'Enemy waters · your shot' : 'Enemy waters', battle && turn === me);

    for (const s of fleet) {
      const { x, y } = GRIDS[0];
      const sunk = s.hits === s.len;
      ctx.fillStyle = sunk ? '#3a2a30' : drag && fleet[drag.k] === s ? '#9aa3b2' : '#6b7486';
      ctx.beginPath();
      ctx.roundRect(x + s.c * CELL + 4, y + s.r * CELL + 4, (s.dir ? 1 : s.len) * CELL - 8, (s.dir ? s.len : 1) * CELL - 8, 12);
      ctx.fill();
    }
    incoming.forEach((v, i) => { if (v) marker(0, i, v); });
    view.forEach((v, i) => { if (v) marker(1, i, v); });

    for (const s of sonars) {
      const cells = area(s.center, 'sonar');
      const r0 = Math.min(...cells.map(i => Math.floor(i / N))), c0 = Math.min(...cells.map(i => i % N));
      const r1 = Math.max(...cells.map(i => Math.floor(i / N))), c1 = Math.max(...cells.map(i => i % N));
      const { x, y } = GRIDS[1];
      ctx.strokeStyle = '#3ddc84';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(x + c0 * CELL + 2, y + r0 * CELL + 2, (c1 - c0 + 1) * CELL - 4, (r1 - r0 + 1) * CELL - 4);
      ctx.setLineDash([]);
      ctx.fillStyle = '#3ddc84';
      ctx.font = '800 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (!view[s.center]) ctx.fillText(s.count, x + (s.center % N) * CELL + CELL / 2, y + Math.floor(s.center / N) * CELL + CELL / 2 + 6);
    }

    if (battle && myTurn() && hover >= 0) {
      const { x, y } = GRIDS[1];
      ctx.fillStyle = tool === 'sonar' ? 'rgba(61,220,132,0.25)' : tool === 'strike' ? 'rgba(255,95,109,0.3)' : 'rgba(255,197,61,0.35)';
      for (const i of area(hover, tool)) ctx.fillRect(x + (i % N) * CELL + 1, y + Math.floor(i / N) * CELL + 1, CELL - 2, CELL - 2);
    }

    ctx.textAlign = 'center';
    log.forEach((l, k) => {
      const age = (performance.now() - l.t) / 1000;
      ctx.globalAlpha = k === 0 ? 1 : 0.5;
      ctx.fillStyle = k === 0 && age < 0.4 ? '#ffc53d' : '#eceef2';
      ctx.font = k === 0 ? '700 16px system-ui, sans-serif' : '500 13px system-ui, sans-serif';
      ctx.fillText(l.text, W / 2, 34 + k * 18);
    });
    ctx.globalAlpha = 1;
    if (waiting) {
      ctx.fillStyle = '#8d94a1';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText('Firing…', GRIDS[1].x + N * CELL / 2, GRIDS[1].y + N * CELL + 22);
    }
    ctx.fillStyle = '#8d94a1';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(Match.label(), W / 2, H - 10);
  }

  function frame() {
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
