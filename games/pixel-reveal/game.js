(() => {
  const W = 560, H = 570, N = 10;
  const CELL = 38, GX = 160, GY = 170;
  const BASE = 2000, PER_SEC = 4, HINT_COST = 250;

  // Pixel art from around the arcade. '.' is empty; every other letter is a filled cell in that color.
  const PICTURES = [
    { id: 'heart', name: 'Extra Life', pal: { r: '#ff5f6d', w: '#ffd1d6' }, art: ['.rrr..rrr.', 'rrwrrrrrrr', 'rwrrrrrrrr', 'rrrrrrrrrr', 'rrrrrrrrrr', '.rrrrrrrr.', '..rrrrrr..', '...rrrr...', '....rr....', '..........'] },
    { id: 'gem', name: 'Gem Mine', pal: { c: '#5ec8d8', w: '#e6fbff', b: '#2a8fb8' }, art: ['..cccccc..', '.cwwccccc.', 'cwccccccbc', 'cccccccccb', 'bbbbbbbbbb', '.bcccccbb.', '..bcccbb..', '...bccb...', '....bb....', '.....b....'] },
    { id: 'crown', name: 'Realm Rivals', pal: { y: '#ffc53d', r: '#ff5f6d', b: '#4f8cff', o: '#c9952a' }, art: ['r...rr...r', 'y...yy...y', 'yy..yy..yy', 'yyy.yy.yyy', 'yyyyyyyyyy', 'yyryybyryy', 'yyyyyyyyyy', 'oooooooooo', '.oooooooo.', '..........'] },
    { id: 'taco', name: 'Taco Truck', pal: { g: '#3ddc84', r: '#ff5f6d', m: '#8b4a2b', s: '#f2c14e' }, art: ['..........', '..grgggr..', '.gmgrmgmg.', 'gsmrgmrmsg', 'ssssssssss', 'ssssssssss', '.ssssssss.', '..ssssss..', '..........', '..........'] },
    { id: 'rocket', name: 'Cloud Climber', pal: { r: '#ff5f6d', w: '#dfe3ec', b: '#4f8cff', f: '#ffc53d' }, art: ['....rr....', '...rwwr...', '...wwww...', '...wbbw...', '...wbbw...', '...wwww...', '..rwwwwr..', '.rrwwwwrr.', '.r.ffff.r.', '....ff....'] },
    { id: 'ghost', name: 'Lantern Maze', pal: { p: '#8b5cf6', w: '#ffffff', k: '#1b1e24' }, art: ['...pppp...', '.pppppppp.', 'pppppppppp', 'pwwppppwwp', 'pwkppppwkp', 'pppppppppp', 'pppppppppp', 'pppppppppp', 'pp.pppp.pp', 'p...pp...p'] },
    { id: 'car', name: 'Pocket Racer', pal: { r: '#ff5f6d', b: '#7fb0ff', k: '#3a404c', y: '#ffc53d' }, art: ['..........', '...rrrr...', '..rbbrbr..', '.rrbbrbrr.', 'yrrrrrrrry', 'rrrrrrrrrr', 'rkkrrrrkkr', '.kk....kk.', '..........', '..........'] },
    { id: 'key', name: 'Letter Lock', pal: { y: '#ffc53d' }, art: ['..yyy.....', '.y...y....', '.y...y....', '.y...y....', '..yyy.....', '...y......', '...yy.....', '...y......', '...yyy....', '...y......'] },
    { id: 'spade', name: 'Card Tables', pal: { w: '#eceef2' }, art: ['....ww....', '...wwww...', '..wwwwww..', '.wwwwwwww.', 'wwwwwwwwww', 'wwwwwwwwww', '.www..www.', '....ww....', '...wwww...', '..wwwwww..'] },
    { id: 'noodle', name: 'Neon Noodle', pal: { g: '#3ddc84', w: '#ffffff', r: '#ff5f6d' }, art: ['gggggggg..', 'g......g..', 'g.gggg.g..', 'g.g..g.g..', 'g.g.gg.g..', 'g.g....g..', 'g.gggggg..', 'g.........', 'gggggggwgr', '..........'] },
    { id: 'trophy', name: 'Champion', pal: { y: '#ffc53d', o: '#c9952a' }, art: ['yyyyyyyyyy', 'y.yyyyyy.y', 'y.yyyyyy.y', '.yyyyyyyy.', '..yyyyyy..', '...yyyy...', '....yy....', '....yy....', '..oooooo..', '..oooooo..'] },
    { id: 'comet', name: 'Comet Pinball', pal: { y: '#ffc53d', o: '#ff9a3d', w: '#e6fbff' }, art: ['.......ww.', '......wwww', '.....owwww', '....yowww.', '...yyoo...', '..yyo.....', '.yyo......', 'yy........', 'y.........', '..........'] },
    { id: 'lantern', name: 'Lantern', pal: { o: '#c9952a', y: '#ffe08a', w: '#ffffff' }, art: ['....oo....', '...o..o...', '..oooooo..', '..oyyyyo..', '..oywyyo..', '..oyyyyo..', '..oyyyyo..', '..oooooo..', '...oooo...', '..........'] },
    { id: 'football', name: 'Blitz Bowl', pal: { b: '#9a5a32', w: '#ffffff' }, art: ['..........', '...bbbb...', '.bbbbbbbb.', 'bbbwbwbwbb', 'bbwwwwwwbb', 'bbbwbwbwbb', '.bbbbbbbb.', '...bbbb...', '..........', '..........'] },
    { id: 'ball', name: 'Hoop Duel', pal: { o: '#f28c28', k: '#7a3f0c' }, art: ['...okko...', '.oookkooo.', '.okookooko', 'ooookkoooo', 'kkkkkkkkkk', 'kkkkkkkkkk', 'ooookkoooo', '.okookooko', '.oookkooo.', '...okko...'] },
  ];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';
  let pic, grid, rowClues, colClues, clock, hints, touchMode = 'fill', drag = null, flash = 0;
  let solvedMap = Arcade.load('pixel:solved', {});

  // ---------- Clues ----------

  const filled = (p, r, c) => p.art[r][c] !== '.';
  function runs(line) {
    const out = [];
    let n = 0;
    for (const v of line) {
      if (v) n++;
      else if (n) { out.push(n); n = 0; }
    }
    if (n) out.push(n);
    return out.length ? out : [0];
  }
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const rowLine = r => grid[r].map(v => v === 1);
  const colLine = c => grid.map(row => row[c] === 1);
  const rowDone = r => same(runs(rowLine(r)), rowClues[r]);
  const colDone = c => same(runs(colLine(c)), colClues[c]);

  // ---------- Flow ----------

  function load(p) {
    pic = p;
    grid = Array.from({ length: N }, () => Array(N).fill(0));  // 0 empty, 1 filled, 2 crossed out
    rowClues = Array.from({ length: N }, (_, r) => runs(Array.from({ length: N }, (_, c) => filled(p, r, c))));
    colClues = Array.from({ length: N }, (_, c) => runs(Array.from({ length: N }, (_, r) => filled(p, r, c))));
    clock = 0;
    hints = 0;
    flash = 0;
    updateHud();
  }

  // The next picture you haven't revealed yet; once the gallery is full, any picture at random.
  function nextPicture() {
    const fresh = PICTURES.filter(p => !solvedMap[p.id]);
    // In a duel both players need the same picture, so the seeded pick ignores each gallery.
    if (Versus.active() || !fresh.length) return PICTURES[Math.floor(Math.random() * PICTURES.length)];
    return fresh[0];
  }

  function start(p = null) {
    load(p || nextPicture());
    state = 'playing';
    ui.hide();
  }

  const score = () => Math.max(100, Math.round(BASE - clock * PER_SEC - hints * HINT_COST));

  function check() {
    for (let i = 0; i < N; i++) if (!rowDone(i) || !colDone(i)) return;
    state = 'revealed';
    flash = 1;
    const s = score();
    const firstTime = !solvedMap[pic.id];
    solvedMap[pic.id] = Math.min(solvedMap[pic.id] || Infinity, Math.round(clock));
    Arcade.save('pixel:solved', solvedMap);
    const count = Object.keys(solvedMap).length;
    if (count >= 5) Arcade.flag('pixel-reveal-five');
    if (count >= PICTURES.length) Arcade.flag('pixel-reveal-all');
    if (!hints && clock < 120) Arcade.flag('pixel-reveal-quick');
    [523, 659, 784, 1046, 1318].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.12, type: 'triangle', vol: 0.05, delay: i * 0.08 }));
    setTimeout(() => Arcade.finish(ui, {
      score: s,
      title: pic.name,
      lines: [`${firstTime ? 'New picture for your gallery!' : 'Revealed again.'} ${count} of ${PICTURES.length} collected.`, `${fmt(clock)} · ${hints} hint${hints === 1 ? '' : 's'}`],
      button: 'Next picture',
      onAction: () => start(),
      html: '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-gallery>Gallery</button></div>',
    }), 1400);
    setTimeout(() => document.querySelector('[data-gallery]')?.addEventListener('click', showGallery), 1450);
  }

  // A hint fixes one cell that's currently wrong, or fills a missing one.
  function hint() {
    if (state !== 'playing') return;
    const wrong = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const want = filled(pic, r, c);
      if ((grid[r][c] === 1) !== want) wrong.push([r, c, want]);
    }
    if (!wrong.length) return;
    const [r, c, want] = wrong[Math.floor(Math.random() * wrong.length)];
    grid[r][c] = want ? 1 : 2;
    hints++;
    Arcade.tone({ freq: 880, to: 1320, dur: 0.15, type: 'triangle', vol: 0.05 });
    updateHud();
    check();
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

  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  function updateHud() {
    $('time').textContent = fmt(clock);
    $('hints').textContent = hints;
    $('gallery').textContent = `${Object.keys(solvedMap).length}/${PICTURES.length}`;
    $('mode-btn').textContent = touchMode === 'fill' ? 'Tap fills ■' : 'Tap crosses ✕';
  }

  function thumb(p, size = 60, reveal = true) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d'), s = size / N;
    x.fillStyle = '#161920';
    x.fillRect(0, 0, size, size);
    for (let r = 0; r < N; r++) for (let col = 0; col < N; col++) {
      if (!filled(p, r, col)) continue;
      x.fillStyle = reveal ? p.pal[p.art[r][col]] : '#2a2f39';
      x.fillRect(col * s, r * s, s, s);
    }
    return c.toDataURL();
  }

  function showGallery() {
    const cards = PICTURES.map(p => {
      const got = solvedMap[p.id] !== undefined;
      return `<button type="button" data-pic="${p.id}" title="${got ? p.name : 'Not revealed yet'}" style="background:none;border:1px solid var(--line);border-radius:8px;padding:6px;cursor:pointer;color:var(--muted);font-size:11px">
        <img src="${thumb(p, 60, got)}" width="60" height="60" alt="" style="display:block;image-rendering:pixelated;border-radius:4px;${got ? '' : 'filter:blur(2px)'}">
        ${got ? `${fmt(solvedMap[p.id])}` : '?'}</button>`;
    }).join('');
    ui.show({
      title: `Gallery · ${Object.keys(solvedMap).length}/${PICTURES.length}`,
      html: `<p>Pick any picture to play. Revealed pictures show your best time.</p>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:8px 0">${cards}</div>`,
      button: 'Back',
      onAction: showMenu,
      onRender: panel => panel.querySelectorAll('[data-pic]').forEach(b => b.addEventListener('click', () => start(PICTURES.find(p => p.id === b.dataset.pic)))),
    });
  }

  function showMenu() {
    state = 'menu';
    Versus.attach({
      ui,
      start: () => start(),
      score,
      intro: {
        title: 'Pixel Reveal',
        html: `<ul>
          <li>The numbers show how many filled squares are in a row or column, and in what groups. <b>3 1</b> means a block of 3, a gap, then 1.</li>
          <li><b>Click</b> to fill, <b>right-click</b> to cross out. Drag to paint several.</li>
          <li>Each finished row lights up in the picture's real colors.</li>
          <li>Solve it fast for a high score. A hint (<kbd>H</kbd>) fixes one square but costs ${HINT_COST} points.</li>
        </ul>`,
        button: 'Next picture',
        onAction: () => start(),
        onRender: panel => {
          panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-gallery>Gallery</button></div>');
          panel.querySelector('[data-gallery]').addEventListener('click', showGallery);
        },
      },
    });
  }

  // ---------- Input ----------

  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const c = Math.floor((px - GX) / CELL), rr = Math.floor((py - GY) / CELL);
    return c >= 0 && c < N && rr >= 0 && rr < N ? [rr, c] : null;
  }

  function paint(r, c) {
    if (grid[r][c] !== drag.from || grid[r][c] === drag.to) return;
    grid[r][c] = drag.to;
    Arcade.tone({ freq: drag.to === 1 ? 600 : 400, dur: 0.03, vol: 0.02 });
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    const at = cellAt(e);
    if (!at) return;
    canvas.setPointerCapture(e.pointerId);
    const cross = e.button === 2 || (e.pointerType !== 'mouse' && touchMode === 'cross');
    const want = cross ? 2 : 1;
    const from = grid[at[0]][at[1]];
    drag = { from, to: from === want ? 0 : want };
    paint(...at);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || state !== 'playing') return;
    const at = cellAt(e);
    if (at) paint(...at);
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    if (state === 'playing') check();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
    } else if (e.code === 'KeyH') hint();
  });
  $('mode-btn').addEventListener('click', e => {
    touchMode = touchMode === 'fill' ? 'cross' : 'fill';
    e.target.blur();
    updateHud();
  });
  $('hint-btn').addEventListener('click', e => { e.target.blur(); hint(); });
  Arcade.onBlur(pause);

  // ---------- Drawing ----------

  function draw(dt) {
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, W, H);
    if (!pic) return;

    // Clues
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < N; i++) {
      const rd = rowDone(i), cd = colDone(i);
      ctx.fillStyle = i % 2 ? '#161920' : '#1a1e26';
      ctx.fillRect(10, GY + i * CELL, GX - 14, CELL);
      ctx.fillRect(GX + i * CELL, 10, CELL, GY - 14);
      ctx.textAlign = 'right';
      ctx.fillStyle = rd ? '#4a5160' : '#eceef2';
      ctx.fillText(rowClues[i].join('  '), GX - 12, GY + i * CELL + CELL / 2 + 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = cd ? '#4a5160' : '#eceef2';
      colClues[i].slice().reverse().forEach((n, k) => ctx.fillText(n, GX + i * CELL + CELL / 2, GY - 18 - k * 22));
    }

    // Cells. A filled cell shows the picture's color once its row is finished and it belongs there.
    const done = state === 'revealed';
    for (let r = 0; r < N; r++) {
      const rd = rowDone(r);
      for (let c = 0; c < N; c++) {
        const x = GX + c * CELL, y = GY + r * CELL, v = grid[r][c];
        ctx.fillStyle = '#161920';
        ctx.fillRect(x, y, CELL, CELL);
        if (v === 1 || (done && filled(pic, r, c))) {
          const real = filled(pic, r, c) ? pic.pal[pic.art[r][c]] : null;
          ctx.fillStyle = (rd || done) && real ? real : '#c5cad3';
          ctx.fillRect(x + (done ? 0 : 2), y + (done ? 0 : 2), CELL - (done ? 0 : 4), CELL - (done ? 0 : 4));
        } else if (v === 2 && !done) {
          ctx.strokeStyle = '#4a5160';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 11, y + 11); ctx.lineTo(x + CELL - 11, y + CELL - 11);
          ctx.moveTo(x + CELL - 11, y + 11); ctx.lineTo(x + 11, y + CELL - 11);
          ctx.stroke();
        }
      }
    }
    if (!done) {
      for (let k = 0; k <= N; k++) {
        ctx.strokeStyle = k % 5 ? '#2a2f39' : '#6b7280';
        ctx.lineWidth = k % 5 ? 1 : 2;
        ctx.beginPath();
        ctx.moveTo(GX + k * CELL, GY); ctx.lineTo(GX + k * CELL, GY + N * CELL);
        ctx.moveTo(GX, GY + k * CELL); ctx.lineTo(GX + N * CELL, GY + k * CELL);
        ctx.stroke();
      }
    }
    if (flash > 0) {
      flash = Math.max(0, flash - dt);
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`;
      ctx.fillRect(GX, GY, N * CELL, N * CELL);
    }

    // Corner: picture name once revealed, otherwise a live score.
    ctx.textAlign = 'center';
    ctx.fillStyle = done ? '#ffc53d' : '#8d94a1';
    ctx.font = done ? '800 18px system-ui, sans-serif' : '600 13px system-ui, sans-serif';
    ctx.fillText(done ? pic.name : `Score ${score().toLocaleString()}`, 80, 80);
    if (!done) ctx.fillText(solvedMap[pic.id] !== undefined ? pic.name : '???', 80, 104);
    ctx.textBaseline = 'alphabetic';
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state === 'playing') {
      clock += dt;
      updateHud();
    }
    draw(dt);
    requestAnimationFrame(frame);
  }

  load(PICTURES[0]);
  showMenu();
  requestAnimationFrame(frame);
})();
