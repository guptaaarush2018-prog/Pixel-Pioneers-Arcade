/* Block Bloom: drag pieces from the tray onto an 8x8 board. Fill a whole row or column and it
   clears. Clearing on back-to-back turns builds a combo, some blocks carry gems, and every
   three gems earns a shuffle for when the tray has nothing that fits.
   Each new piece uses exactly two Math.random calls, in deal order, so in an online duel both
   players are dealt the same pieces whatever they do with them. */
(() => {
  const W = 480, H = 760, N = 8, CELL = 52;
  const BX = (W - N * CELL) / 2, BY = 112;
  const TRAY_Y = BY + N * CELL + 34, TRAY_H = H - TRAY_Y - 14, SLOT_W = W / 3;
  const TRAY_CELL = 26;
  const COMBO_GRACE = 3;          // turns without a clear before the combo drops
  const GEM_CHANCE = 0.12, GEMS_PER_SHUFFLE = 3, MAX_SHUFFLES = 3;
  const COLORS = ['#ff5d73', '#ffa53d', '#ffd84d', '#4ed98a', '#3dc6ff', '#5b7bff', '#b57bff'];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  canvas.style.touchAction = 'none';
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const { shade, alpha, ease } = Gfx;

  const fx = Gfx.particles(700);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();

  // ---------- Pieces ----------

  // Shapes are lists of [x, y]. Pieces never rotate, so each turned version is its own shape.
  const S = str => str.trim().split('/').flatMap((row, y) => [...row].map((ch, x) => ch === '#' ? [x, y] : null).filter(Boolean));
  const SMALL = [
    { cells: S('#'), color: 2 },
    { cells: S('##'), color: 3 }, { cells: S('#/#'), color: 3 },
    { cells: S('###'), color: 4 }, { cells: S('#/#/#'), color: 4 },
    { cells: S('##/#.'), color: 1 }, { cells: S('##/.#'), color: 1 }, { cells: S('#./##'), color: 1 }, { cells: S('.#/##'), color: 1 },
  ];
  const MEDIUM = [
    { cells: S('####'), color: 4 }, { cells: S('#/#/#/#'), color: 4 },
    { cells: S('##/##'), color: 2 },
    { cells: S('###/.#.'), color: 6 }, { cells: S('.#./###'), color: 6 }, { cells: S('#./##/#.'), color: 6 }, { cells: S('.#/##/.#'), color: 6 },
    { cells: S('##./.##'), color: 0 }, { cells: S('.##/##.'), color: 3 }, { cells: S('#./##/.#'), color: 0 }, { cells: S('.#/##/#.'), color: 3 },
    { cells: S('#./#./##'), color: 1 }, { cells: S('.#/.#/##'), color: 5 }, { cells: S('###/#..'), color: 1 }, { cells: S('###/..#'), color: 5 },
    { cells: S('##/#./#.'), color: 5 }, { cells: S('##/.#/.#'), color: 1 }, { cells: S('#../###'), color: 5 }, { cells: S('..#/###'), color: 1 },
  ];
  const LARGE = [
    { cells: S('#####'), color: 0 }, { cells: S('#/#/#/#/#'), color: 0 },
    { cells: S('###/###/###'), color: 5 },
    { cells: S('###/#../#..'), color: 6 }, { cells: S('###/..#/..#'), color: 6 }, { cells: S('#../#../###'), color: 6 }, { cells: S('..#/..#/###'), color: 6 },
    { cells: S('###/###'), color: 3 }, { cells: S('##/##/##'), color: 3 },
  ];

  let dealt = 0;
  // Bigger pieces turn up more often the longer a game goes (by pieces dealt, not by score,
  // so duel opponents keep getting the same deal).
  function deal() {
    const r = Math.random(), g = Math.random();
    const k = Math.min(1, dealt / 90);
    dealt++;
    const pSmall = 0.4 - 0.16 * k, pLarge = 0.12 + 0.14 * k;
    let list, t;
    if (r < pSmall) { list = SMALL; t = r / pSmall; }
    else if (r < 1 - pLarge) { list = MEDIUM; t = (r - pSmall) / (1 - pLarge - pSmall); }
    else { list = LARGE; t = (r - (1 - pLarge)) / pLarge; }
    const shape = list[Math.min(list.length - 1, Math.floor(t * list.length))];
    const cells = shape.cells;
    const w = Math.max(...cells.map(c => c[0])) + 1, h = Math.max(...cells.map(c => c[1])) + 1;
    const gem = g < GEM_CHANCE ? Math.min(cells.length - 1, Math.floor((g / GEM_CHANCE) * cells.length)) : -1;
    return { cells, w, h, color: COLORS[shape.color], gem, born: clock };
  }

  // ---------- State ----------

  let state = 'ready';
  let board, tray, score, best, combo, quiet, gems, gemBag, shuffles, lines, maxCombo, clock = 0;
  let drag = null, kb = null, clearing = [], bands = [], stuck = false, overT = 0;

  function reset() {
    board = Array.from({ length: N }, () => Array(N).fill(null));
    score = 0;
    combo = 0;
    quiet = 0;
    gems = 0;
    gemBag = 0;
    shuffles = 1;
    lines = 0;
    maxCombo = 0;
    dealt = 0;
    drag = null;
    kb = null;
    clearing = [];
    bands = [];
    stuck = false;
    fx.clear();
    pops.list.length = 0;
    best = Arcade.getBest(Arcade.gameId);
    tray = [deal(), deal(), deal()];
    updateHud();
  }

  const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
  function fits(p, gx, gy) {
    for (const [x, y] of p.cells) {
      if (!inside(gx + x, gy + y) || board[gy + y][gx + x]) return false;
    }
    return true;
  }
  function fitsAnywhere(p) {
    for (let y = 0; y <= N - p.h; y++) for (let x = 0; x <= N - p.w; x++) if (fits(p, x, y)) return true;
    return false;
  }

  // Rows and columns that would be full if p went at (gx, gy).
  function wouldClear(p, gx, gy) {
    const filled = (x, y) => !!board[y][x] || p.cells.some(([cx, cy]) => cx + gx === x && cy + gy === y);
    const rows = [], cols = [];
    for (let i = 0; i < N; i++) {
      let r = true, c = true;
      for (let j = 0; j < N; j++) {
        if (!filled(j, i)) r = false;
        if (!filled(i, j)) c = false;
      }
      if (r) rows.push(i);
      if (c) cols.push(i);
    }
    return { rows, cols };
  }

  const LINE_POINTS = [0, 10, 30, 60, 100, 150, 210, 280];
  const LINE_WORDS = ['', '', 'Double!', 'Triple!', 'Incredible!', 'Unreal!', 'Unreal!', 'Unreal!'];

  function place(i, gx, gy) {
    const p = tray[i];
    if (!p || !fits(p, gx, gy)) return false;
    const { rows, cols } = wouldClear(p, gx, gy);
    p.cells.forEach(([x, y], k) => {
      board[gy + y][gx + x] = { color: p.color, gem: k === p.gem, t: clock };
    });
    tray[i] = null;
    score += p.cells.length;
    Arcade.tone({ freq: 180, to: 120, dur: 0.08, type: 'triangle', vol: 0.06 });
    shake.add(0.06);

    const n = rows.length + cols.length;
    if (n) {
      combo++;
      quiet = 0;
      lines += n;
      maxCombo = Math.max(maxCombo, combo);
      const mult = Math.min(10, combo);
      const pts = LINE_POINTS[Math.min(n, LINE_POINTS.length - 1)] * mult;
      score += pts;
      clearLines(rows, cols, gx + p.w / 2, gy + p.h / 2);
      const cx = BX + (gx + p.w / 2) * CELL, cy = BY + (gy + p.h / 2) * CELL;
      pops.add(`+${pts}`, cx, cy - 10, { color: '#fff', size: 26 + Math.min(14, n * 4), life: 1.1 });
      if (LINE_WORDS[n]) pops.add(LINE_WORDS[n], W / 2, BY + N * CELL / 2 - 40, { color: '#ffd84d', size: 40, life: 1.2, rise: 30, delay: 0.05 });
      if (combo > 1) pops.add(`Combo x${mult}`, W / 2, BY + N * CELL / 2 + 10, { color: '#7ff0c0', size: 28, life: 1.2, rise: 30, delay: 0.12 });
      [523, 659, 784, 1047, 1319].slice(0, Math.min(5, n + 1)).forEach((f, k) => Arcade.tone({ freq: f * Math.pow(1.06, Math.min(combo - 1, 8)), dur: 0.12, type: 'triangle', vol: 0.05, delay: k * 0.05 }));
      shake.add(Math.min(0.6, 0.18 + n * 0.1));
      if (n >= 3) Arcade.flag('block-bloom-triple');
      if (combo >= 5) Arcade.flag('block-bloom-combo');
      if (board.every(row => row.every(c => !c))) {
        score += 300;
        Arcade.flag('block-bloom-sweep');
        pops.add('Clean sweep! +300', W / 2, BY + N * CELL / 2 + 60, { color: '#ff9ad5', size: 30, life: 1.6, rise: 30, delay: 0.3 });
        Arcade.tone({ freq: 784, to: 1568, dur: 0.4, type: 'triangle', vol: 0.06, delay: 0.25 });
      }
    } else if (++quiet >= COMBO_GRACE) {
      combo = 0;
    }

    if (tray.every(t => !t)) tray = [deal(), deal(), deal()];
    updateHud();
    checkStuck();
    return true;
  }

  function clearLines(rows, cols, ox, oy) {
    const hit = new Set();
    for (const r of rows) for (let x = 0; x < N; x++) hit.add(r * N + x);
    for (const c of cols) for (let y = 0; y < N; y++) hit.add(y * N + c);
    let got = 0;
    for (const k of hit) {
      const x = k % N, y = (k / N) | 0, cell = board[y][x];
      if (!cell) continue;
      if (cell.gem) got++;
      clearing.push({ x, y, color: cell.color, gem: cell.gem, t: -Math.hypot(x + 0.5 - ox, y + 0.5 - oy) * 0.035, burst: false });
      board[y][x] = null;
    }
    for (const r of rows) bands.push({ row: r, t: 0 });
    for (const c of cols) bands.push({ col: c, t: 0 });
    if (got) {
      gems += got;
      score += got * 25;
      gemBag += got;
      if (gems >= 15) Arcade.flag('block-bloom-gems');
      while (gemBag >= GEMS_PER_SHUFFLE) {
        gemBag -= GEMS_PER_SHUFFLE;
        if (shuffles < MAX_SHUFFLES) {
          shuffles++;
          pops.add('+1 shuffle', SHUF.x + SHUF.w / 2, SHUF.y + SHUF.h + 16, { color: '#7ff0c0', size: 16, delay: 0.4 });
        }
      }
      Arcade.tone({ freq: 1568, to: 2093, dur: 0.15, type: 'sine', vol: 0.05, delay: 0.15 });
    }
  }

  function shuffle() {
    if (state !== 'playing' || shuffles <= 0) return;
    shuffles--;
    tray = [deal(), deal(), deal()];
    drag = null;
    kb = null;
    Arcade.tone({ freq: 440, to: 880, dur: 0.15, type: 'triangle', vol: 0.05 });
    fx.burst(24, () => ({
      x: Gfx.rand(20, W - 20), y: TRAY_Y + Gfx.rand(10, TRAY_H - 10), vx: Gfx.rand(-80, 80), vy: Gfx.rand(-120, -20),
      drag: 2, life: Gfx.rand(0.3, 0.6), size: Gfx.rand(2, 4), color: '#7ff0c0', shape: 'circle',
    }));
    updateHud();
    checkStuck();
  }

  function checkStuck() {
    const any = tray.some(p => p && fitsAnywhere(p));
    stuck = !any;
    if (stuck && shuffles <= 0) end();
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    $('best').textContent = Math.max(score, best).toLocaleString();
  }

  function end() {
    state = 'over';
    overT = 0;
    drag = null;
    kb = null;
    Arcade.tone({ freq: 330, to: 110, dur: 0.6, type: 'sawtooth', vol: 0.05 });
    setTimeout(() => Arcade.finish(ui, {
      score,
      title: 'Out of room',
      lines: [`${lines} lines · best combo x${maxCombo} · ${gems} gems`],
      onAction: start,
    }), 1100);
  }

  function start() {
    reset();
    state = 'playing';
    ui.hide();
  }

  // ---------- Input ----------

  // Shuffle button, top right.
  const SHUF = { x: W - 132, y: 22, w: 112, h: 44 };

  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  const traySlot = (x, y) => (y >= TRAY_Y && y <= TRAY_Y + TRAY_H ? Math.min(2, Math.floor(x / SLOT_W)) : -1);

  // Where the dragged piece's top-left lands on the board.
  function dragCell(d) {
    const p = tray[d.i];
    const left = d.x - (p.w * CELL) / 2, top = d.y - d.lift - (p.h * CELL) / 2;
    return { gx: Math.round((left - BX) / CELL), gy: Math.round((top - BY) / CELL), left, top };
  }

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    const q = toLogical(e);
    if (q.x >= SHUF.x && q.x <= SHUF.x + SHUF.w && q.y >= SHUF.y && q.y <= SHUF.y + SHUF.h) { shuffle(); return; }
    const i = traySlot(q.x, q.y);
    if (i < 0 || !tray[i]) return;
    kb = null;
    // On touch the piece floats above the finger so you can see where it's going.
    drag = { i, x: q.x, y: q.y, lift: e.pointerType === 'touch' ? 90 : 30, t: clock };
    canvas.setPointerCapture(e.pointerId);
    Arcade.tone({ freq: 520, dur: 0.04, type: 'triangle', vol: 0.03 });
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const q = toLogical(e);
    drag.x = q.x;
    drag.y = q.y;
  });
  const drop = () => {
    if (!drag) return;
    const { gx, gy } = dragCell(drag);
    const i = drag.i;
    drag = null;
    if (!place(i, gx, gy) && tray[i]) Arcade.tone({ freq: 160, dur: 0.06, vol: 0.03 });
  };
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', () => { drag = null; });

  // Keyboard: 1-3 picks a piece, arrows move it, Enter or Space drops it, S shuffles.
  window.addEventListener('keydown', e => {
    if (state !== 'playing') return;
    if (e.key >= '1' && e.key <= '3') {
      const i = +e.key - 1;
      if (!tray[i]) return;
      const p = tray[i];
      kb = { i, gx: Math.floor((N - p.w) / 2), gy: Math.floor((N - p.h) / 2) };
      drag = null;
      e.preventDefault();
    } else if (e.code === 'KeyS') {
      shuffle();
    } else if (kb) {
      const p = tray[kb.i];
      const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (mv) {
        kb.gx = Math.max(0, Math.min(N - p.w, kb.gx + mv[0]));
        kb.gy = Math.max(0, Math.min(N - p.h, kb.gy + mv[1]));
        e.preventDefault();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        const { i, gx, gy } = kb;
        if (place(i, gx, gy)) kb = null;
        else Arcade.tone({ freq: 160, dur: 0.06, vol: 0.03 });
      } else if (e.code === 'Escape') {
        kb = null;
      }
    }
  });

  // ---------- Drawing ----------

  // Each colour's block is painted once into a sprite: a rounded jelly cube with a bevel and shine.
  const blockSprites = new Map();
  function blockSprite(color) {
    let s = blockSprites.get(color);
    if (s) return s;
    s = Gfx.sprite(CELL, CELL, 0, 0, c => {
      const p = 2, sz = CELL - p * 2, r = 9;
      c.fillStyle = shade(color, -0.42);
      Gfx.roundRect(c, p, p + 3, sz, sz - 3, r);
      c.fill();
      const g = c.createLinearGradient(0, p, 0, p + sz);
      g.addColorStop(0, shade(color, 0.28));
      g.addColorStop(0.55, color);
      g.addColorStop(1, shade(color, -0.12));
      c.fillStyle = g;
      Gfx.roundRect(c, p, p, sz, sz - 5, r);
      c.fill();
      // Inner bevel.
      c.strokeStyle = alpha('#ffffff', 0.35);
      c.lineWidth = 2;
      Gfx.roundRect(c, p + 3, p + 3, sz - 6, sz - 11, r - 3);
      c.stroke();
      // Shine.
      c.fillStyle = 'rgba(255,255,255,0.42)';
      Gfx.roundRect(c, p + 7, p + 6, sz * 0.45, 6, 3);
      c.fill();
      c.beginPath();
      c.arc(p + sz - 12, p + 10, 2.5, 0, Math.PI * 2);
      c.fill();
    });
    blockSprites.set(color, s);
    return s;
  }

  const gemSprite = Gfx.sprite(CELL, CELL, CELL / 2, CELL / 2, c => {
    const cx = CELL / 2, cy = CELL / 2 - 2, r = 12;
    c.save();
    c.shadowColor = 'rgba(255,255,255,0.9)';
    c.shadowBlur = 10;
    c.fillStyle = '#e9fbff';
    c.beginPath();
    c.moveTo(cx, cy - r); c.lineTo(cx + r * 0.85, cy - r * 0.2); c.lineTo(cx, cy + r); c.lineTo(cx - r * 0.85, cy - r * 0.2);
    c.closePath();
    c.fill();
    c.restore();
    c.fillStyle = '#9fe8ff';
    c.beginPath();
    c.moveTo(cx, cy - r * 0.2); c.lineTo(cx + r * 0.85, cy - r * 0.2); c.lineTo(cx, cy + r);
    c.closePath();
    c.fill();
    c.fillStyle = '#c8f4ff';
    c.beginPath();
    c.moveTo(cx - r * 0.85, cy - r * 0.2); c.lineTo(cx, cy - r); c.lineTo(cx, cy - r * 0.2);
    c.closePath();
    c.fill();
  });

  function drawBlock(x, y, color, gem, scale = 1, a = 1) {
    if (a < 1) ctx.globalAlpha = a;
    const s = blockSprite(color);
    if (scale === 1) s.draw(ctx, x, y);
    else s.draw(ctx, x, y, scale);
    if (gem) {
      const pulse = 1 + Math.sin(clock * 4 + x * 0.1) * 0.06;
      gemSprite.draw(ctx, x + (CELL / 2) * scale, y + (CELL / 2) * scale, scale * pulse);
    }
    if (a < 1) ctx.globalAlpha = 1;
  }

  const backdrop = Gfx.sprite(W, H, 0, 0, c => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2b1f5c');
    g.addColorStop(0.55, '#3a2a78');
    g.addColorStop(1, '#1b1640');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    const r = Gfx.rng(42);
    for (let i = 0; i < 14; i++) {
      const x = r() * W, y = r() * H, rad = 30 + r() * 90;
      const bg = c.createRadialGradient(x, y, 0, x, y, rad);
      const col = COLORS[Math.floor(r() * COLORS.length)];
      bg.addColorStop(0, alpha(col, 0.13));
      bg.addColorStop(1, alpha(col, 0));
      c.fillStyle = bg;
      c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Board frame and empty slots.
    const fx0 = BX - 12, fy0 = BY - 12, fw = N * CELL + 24;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.5)';
    c.shadowBlur = 24;
    c.shadowOffsetY = 10;
    c.fillStyle = '#151230';
    Gfx.roundRect(c, fx0, fy0, fw, fw, 20);
    c.fill();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 2;
    Gfx.roundRect(c, fx0 + 1, fy0 + 1, fw - 2, fw - 2, 19);
    c.stroke();
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        c.fillStyle = (x + y) % 2 ? '#211c47' : '#241e4d';
        Gfx.roundRect(c, BX + x * CELL + 2, BY + y * CELL + 2, CELL - 4, CELL - 4, 8);
        c.fill();
        c.fillStyle = 'rgba(0,0,0,0.25)';
        Gfx.roundRect(c, BX + x * CELL + 2, BY + y * CELL + 2, CELL - 4, 4, 3);
        c.fill();
      }
    }
    // Tray shelf.
    c.fillStyle = 'rgba(10,8,30,0.35)';
    Gfx.roundRect(c, 12, TRAY_Y, W - 24, TRAY_H, 18);
    c.fill();
  });

  function drawHud() {
    Gfx.text(ctx, score.toLocaleString(), W / 2, 50, { size: 40, color: '#fff', width: 6 });
    Gfx.text(ctx, `BEST ${Math.max(score, best).toLocaleString()}`, W / 2, 84, { size: 12, color: '#cbbcff', stroke: null, weight: 700 });

    // Combo meter, top left.
    Gfx.card(ctx, 20, 22, 112, 44, { fill: 'rgba(20,14,48,0.75)', r: 12 });
    Gfx.text(ctx, 'COMBO', 34, 36, { size: 10, color: '#cbbcff', stroke: null, align: 'left', weight: 700 });
    Gfx.text(ctx, combo > 1 ? `x${Math.min(10, combo)}` : '–', 34, 54, { size: 18, color: combo > 1 ? '#7ff0c0' : '#8d86b8', align: 'left' });
    if (combo > 0) {
      for (let k = 0; k < COMBO_GRACE; k++) {
        ctx.fillStyle = k < COMBO_GRACE - quiet ? '#7ff0c0' : 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(96 + k * 11, 54, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Shuffle button with gem progress.
    const hot = stuck && shuffles > 0 && state === 'playing';
    const pulse = hot ? 1 + Math.sin(clock * 8) * 0.05 : 1;
    ctx.save();
    ctx.translate(SHUF.x + SHUF.w / 2, SHUF.y + SHUF.h / 2);
    ctx.scale(pulse, pulse);
    ctx.translate(-(SHUF.x + SHUF.w / 2), -(SHUF.y + SHUF.h / 2));
    Gfx.card(ctx, SHUF.x, SHUF.y, SHUF.w, SHUF.h, { fill: hot ? 'rgba(40,150,110,0.9)' : shuffles ? 'rgba(20,14,48,0.75)' : 'rgba(20,14,48,0.45)', r: 12 });
    Gfx.text(ctx, `⟳ Shuffle ${shuffles}`, SHUF.x + 12, SHUF.y + 16, { size: 13, color: shuffles ? '#fff' : '#8d86b8', align: 'left', stroke: null });
    for (let k = 0; k < GEMS_PER_SHUFFLE; k++) {
      const x = SHUF.x + 18 + k * 16, y = SHUF.y + 32, on = k < gemBag;
      ctx.fillStyle = on ? '#9fe8ff' : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fill();
    }
    Gfx.text(ctx, 'gems', SHUF.x + 70, SHUF.y + 32, { size: 10, color: '#cbbcff', stroke: null, align: 'left', weight: 600 });
    ctx.restore();
  }

  function drawPreview(p, gx, gy, ok) {
    if (ok) {
      const { rows, cols } = wouldClear(p, gx, gy);
      // Lines about to clear glow, and their blocks take on the piece's colour.
      for (const r of rows) {
        ctx.fillStyle = alpha(p.color, 0.18 + Math.sin(clock * 10) * 0.06);
        Gfx.roundRect(ctx, BX - 4, BY + r * CELL - 2, N * CELL + 8, CELL + 4, 12);
        ctx.fill();
        for (let x = 0; x < N; x++) if (board[r][x]) drawBlock(BX + x * CELL, BY + r * CELL, p.color, board[r][x].gem, 1, 0.75);
      }
      for (const c of cols) {
        ctx.fillStyle = alpha(p.color, 0.18 + Math.sin(clock * 10) * 0.06);
        Gfx.roundRect(ctx, BX + c * CELL - 2, BY - 4, CELL + 4, N * CELL + 8, 12);
        ctx.fill();
        for (let y = 0; y < N; y++) if (board[y][c]) drawBlock(BX + c * CELL, BY + y * CELL, p.color, board[y][c].gem, 1, 0.75);
      }
      for (const [x, y] of p.cells) drawBlock(BX + (gx + x) * CELL, BY + (gy + y) * CELL, p.color, false, 1, 0.5);
    } else if (kb) {
      for (const [x, y] of p.cells) {
        ctx.fillStyle = 'rgba(255,93,115,0.35)';
        Gfx.roundRect(ctx, BX + (gx + x) * CELL + 3, BY + (gy + y) * CELL + 3, CELL - 6, CELL - 6, 8);
        ctx.fill();
      }
    }
  }

  function drawTray() {
    for (let i = 0; i < 3; i++) {
      const p = tray[i];
      if (!p || (drag && drag.i === i)) continue;
      const fit = state !== 'playing' || fitsAnywhere(p);
      const age = clock - p.born;
      const slide = age < 0.35 ? (1 - ease.outBack(Math.min(1, age / 0.35))) * 140 + 0 : 0;
      const sc = TRAY_CELL / CELL;
      const cx = SLOT_W * i + SLOT_W / 2 + slide, cy = TRAY_Y + TRAY_H / 2;
      const x0 = cx - (p.w * TRAY_CELL) / 2, y0 = cy - (p.h * TRAY_CELL) / 2;
      if (kb && kb.i === i) {
        ctx.strokeStyle = alpha('#ffd84d', 0.6 + Math.sin(clock * 8) * 0.3);
        ctx.lineWidth = 2;
        Gfx.roundRect(ctx, SLOT_W * i + 10, TRAY_Y + 8, SLOT_W - 20, TRAY_H - 16, 14);
        ctx.stroke();
      }
      Gfx.shadow(ctx, cx, y0 + p.h * TRAY_CELL + 8, p.w * TRAY_CELL * 0.55, 6, 0.3);
      for (const [x, y] of p.cells) {
        drawBlock(x0 + x * TRAY_CELL, y0 + y * TRAY_CELL, fit ? p.color : '#6b6890', p.gem >= 0 && p.cells[p.gem][0] === x && p.cells[p.gem][1] === y, sc, fit ? 1 : 0.6);
      }
      Gfx.text(ctx, `${i + 1}`, SLOT_W * i + 22, TRAY_Y + 20, { size: 11, color: 'rgba(255,255,255,0.3)', stroke: null, weight: 700 });
    }
  }

  function draw() {
    const off = shake.offset(8);
    ctx.save();
    ctx.translate(off.x, off.y);
    backdrop.draw(ctx, 0, 0);

    // Flash along cleared lines.
    for (const b of bands) {
      const k = b.t / 0.5;
      ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - k)})`;
      if (b.row !== undefined) ctx.fillRect(BX - 6, BY + b.row * CELL + CELL * 0.5 * k, N * CELL + 12, CELL * (1 - k));
      else ctx.fillRect(BX + b.col * CELL + CELL * 0.5 * k, BY - 6, CELL * (1 - k), N * CELL + 12);
    }

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = board[y][x];
        if (!c) continue;
        const age = clock - c.t;
        let col = c.color;
        if (state === 'over') col = overT > (x + y) * 0.04 ? '#4a4670' : col;
        if (age < 0.18) {
          const s = 0.8 + 0.2 * ease.outBack(age / 0.18);
          const px = BX + x * CELL + (CELL * (1 - s)) / 2, py = BY + y * CELL + (CELL * (1 - s)) / 2;
          drawBlock(px, py, col, c.gem, s);
        } else {
          drawBlock(BX + x * CELL, BY + y * CELL, col, c.gem);
        }
      }
    }

    for (const c of clearing) {
      if (c.t < 0) { drawBlock(BX + c.x * CELL, BY + c.y * CELL, c.color, c.gem); continue; }
      const k = Math.min(1, c.t / 0.3);
      const s = 1 - ease.inQuad(k);
      if (s <= 0) continue;
      ctx.save();
      ctx.translate(BX + c.x * CELL + CELL / 2, BY + c.y * CELL + CELL / 2);
      ctx.rotate(k * 0.6);
      ctx.scale(s * (1 + 0.15 * Math.sin(k * Math.PI)), s * (1 + 0.15 * Math.sin(k * Math.PI)));
      blockSprite(c.color).draw(ctx, -CELL / 2, -CELL / 2);
      ctx.globalAlpha = 0.6 * (1 - k);
      ctx.fillStyle = '#fff';
      Gfx.roundRect(ctx, -CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4, 9);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    if (state === 'playing') {
      if (drag) {
        const { gx, gy } = dragCell(drag);
        drawPreview(tray[drag.i], gx, gy, fits(tray[drag.i], gx, gy));
      } else if (kb) {
        drawPreview(tray[kb.i], kb.gx, kb.gy, fits(tray[kb.i], kb.gx, kb.gy));
      }
    }

    drawTray();
    fx.draw(ctx);

    if (drag) {
      const p = tray[drag.i];
      const { left, top } = dragCell(drag);
      const grow = ease.outBack(Math.min(1, (clock - drag.t) / 0.15));
      const sc = TRAY_CELL / CELL + (1 - TRAY_CELL / CELL) * grow;
      const cx = left + (p.w * CELL) / 2, cy = top + (p.h * CELL) / 2;
      Gfx.shadow(ctx, cx, cy + (p.h * CELL * sc) / 2 + 14, p.w * CELL * sc * 0.5, 10, 0.35);
      for (const [x, y] of p.cells) {
        drawBlock(cx + (x - p.w / 2) * CELL * sc, cy + (y - p.h / 2) * CELL * sc - 6, p.color, x === p.cells[p.gem]?.[0] && y === p.cells[p.gem]?.[1], sc);
      }
    }

    pops.draw(ctx);
    ctx.restore();
    drawHud();

    if (state === 'playing' && stuck && shuffles > 0) {
      Gfx.text(ctx, 'No room! Use a shuffle', W / 2, TRAY_Y - 14, { size: 16, color: '#7ff0c0' });
    } else if (state === 'over') {
      ctx.globalAlpha = Math.min(1, overT * 2);
      Gfx.text(ctx, 'Out of room', W / 2, BY + N * CELL / 2, { size: 44, color: '#fff', width: 7 });
      ctx.globalAlpha = 1;
    }
  }

  function update(dt) {
    clock += dt;
    if (state === 'over') overT += dt;
    fx.update(dt);
    pops.update(dt);
    shake.update(dt);
    for (const b of bands) b.t += dt;
    bands = bands.filter(b => b.t < 0.5);
    for (const c of clearing) {
      c.t += dt;
      if (c.t >= 0 && !c.burst) {
        c.burst = true;
        const cx = BX + c.x * CELL + CELL / 2, cy = BY + c.y * CELL + CELL / 2;
        fx.burst(7, () => ({
          x: cx + Gfx.rand(-12, 12), y: cy + Gfx.rand(-12, 12), vx: Gfx.rand(-200, 200), vy: Gfx.rand(-260, 60),
          drag: 1.6, life: Gfx.rand(0.4, 0.8), size: Gfx.rand(3, 6), color: Gfx.rand() < 0.75 ? c.color : '#ffffff',
          shape: 'chip', spin: Gfx.rand(-12, 12),
        }));
        if (c.gem) {
          fx.burst(10, () => ({
            x: cx, y: cy, vx: Gfx.rand(-240, 240), vy: Gfx.rand(-240, 240), drag: 3,
            life: Gfx.rand(0.3, 0.6), size: 2, color: '#c8f4ff', shape: 'spark',
          }));
          pops.add('+25', cx, cy - 10, { color: '#9fe8ff', size: 16 });
        }
      }
    }
    clearing = clearing.filter(c => c.t < 0.3);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => score,
    intro: {
      title: 'Block Bloom',
      html: `<ul>
        <li>Drag a piece from the tray onto the board. Pieces don't rotate.</li>
        <li>Fill a whole row or column to clear it. Clearing several at once scores far more.</li>
        <li>Clear on back-to-back turns to build a <b>combo</b> multiplier. Three turns without a clear and it resets.</li>
        <li>Clear blocks with <b style="color:#9fe8ff">gems</b> for bonus points. Every 3 gems earns a <b>shuffle</b> for a fresh tray.</li>
        <li>The game ends when nothing in the tray fits and you have no shuffles left.</li>
        <li class="kbd-only">Keyboard: <kbd>1</kbd>–<kbd>3</kbd> pick a piece, arrows move it, <kbd>Enter</kbd> drops it, <kbd>S</kbd> shuffles.</li>
      </ul>`,
      button: 'Play',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
