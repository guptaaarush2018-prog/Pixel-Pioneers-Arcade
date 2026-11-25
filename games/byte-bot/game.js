/* Byte Bot: program a little robot to light every blue tile. Build the program from Forward,
   Turn left, Turn right and Light, then press Run and watch it go. Later levels give you two
   functions, P1 and P2, that Main (or each other, or themselves) can call. Shorter programs earn
   more stars, and every command under par earns bonus points; the score is the total of your
   best on every level. */
(() => {
  const ID = 'byte-bot';
  const CW = 800, CH = 550;
  const SAVE = 'bytebot:best', PROG = 'bytebot:progs';
  const B = window.ByteBot, LEVELS = B.LEVELS;
  const $ = id => document.getElementById(id);
  const overlayEl = $('overlay');
  const ui = Arcade.overlay(overlayEl);
  const canvas = $('game');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = CW * dpr; canvas.height = CH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = Gfx.rand;
  const fx = Gfx.particles(300);

  const CMDS = [
    { c: 'F', label: 'Forward', icon: '⬆', key: '↑' },
    { c: 'L', label: 'Left', icon: '↺', key: '←' },
    { c: 'R', label: 'Right', icon: '↻', key: '→' },
    { c: 'X', label: 'Light', icon: '✦', key: 'Space' },
    { c: '1', label: 'Call P1', icon: 'P1', key: '1' },
    { c: '2', label: 'Call P2', icon: 'P2', key: '2' },
  ];
  const ICON = Object.fromEntries(CMDS.map(c => [c.c, c.icon]));
  const FNS = ['main', 'p1', 'p2'];

  let best = Arcade.load(SAVE, {}), saved = Arcade.load(PROG, {});
  // Re-score saved bests with the current rules (shorter = more points). The old rules didn't record
  // a shorter run that scored the same, so also count a saved program that still solves its level.
  (() => {
    let changed = false;
    for (const k of Object.keys(best)) {
      const lv = LEVELS[k], b = best[k];
      if (!lv) continue;
      let n = b.size ?? Infinity;
      if (saved[k] && B.run(lv, saved[k]).win) n = Math.min(n, B.size(saved[k]));
      if (!Number.isFinite(n)) continue;
      const pts = Math.max(b.pts || 0, B.points(lv, n)), stars = Math.max(b.stars || 0, B.stars(lv, n));
      if (pts !== b.pts || n !== b.size || stars !== b.stars) { best[k] = { pts, stars, size: n }; changed = true; }
    }
    if (changed) Arcade.save(SAVE, best);
  })();
  let L = null, li = 0, prog = null, active = 'main', run = null, bot = null, lit = new Set(), state = 'menu', time = 0;
  const total = () => Object.values(best).reduce((t, b) => t + b.pts, 0);
  const nextUp = () => { for (let i = 0; i < LEVELS.length; i++) if (!best[i]) return i; return LEVELS.length - 1; };

  function load(n) {
    li = n; L = LEVELS[n];
    prog = saved[n] ? { ...saved[n] } : { main: '', p1: '', p2: '' };
    active = 'main';
    reset();
    state = 'edit';
    ui.hide();
    $('tip').textContent = L.tip || '';
    renderSide();
    updateHud();
  }
  function reset() {
    run = null;
    bot = { x: L.start[0], y: L.start[1], d: L.start[2], px: L.start[0], py: L.start[1], pd: L.start[2], t: 1, bump: 0 };
    lit = new Set();
  }

  // ---------- Editing ----------

  const slotsFor = fn => L.slots[FNS.indexOf(fn)];
  function add(c) {
    if (state !== 'edit') return;
    if ((c === '1' && !L.slots[1]) || (c === '2' && !L.slots[2])) return;
    if (prog[active].length >= slotsFor(active)) { Arcade.tone({ freq: 160, dur: 0.06, type: 'square', vol: 0.03 }); return; }
    prog[active] += c;
    Arcade.tone({ freq: 500 + prog[active].length * 30, dur: 0.04, type: 'triangle', vol: 0.03 });
    store();
    renderSide();
  }
  function removeAt(fn, i) {
    if (state !== 'edit') return;
    prog[fn] = prog[fn].slice(0, i) + prog[fn].slice(i + 1);
    store();
    renderSide();
  }
  function store() { saved[li] = { ...prog }; Arcade.save(PROG, saved); }

  // ---------- Running ----------

  const STEP = () => (fast ? 0.12 : 0.32);
  let fast = false, stepT = 0;
  function start() {
    if (state !== 'edit') return;
    if (!prog.main.length) { flash('Add some commands to Main first'); return; }
    reset();
    run = B.run(L, prog);
    run.i = 0;
    state = 'run';
    stepT = 0;
    renderSide();
  }
  function stop() { if (state === 'run' || state === 'fail') { state = 'edit'; reset(); renderSide(); } }

  function advance() {
    const s = run.steps[run.i++];
    if (!s) return finishRun();
    bot.px = bot.x; bot.py = bot.y; bot.pd = bot.d;
    bot.x = s.x; bot.y = s.y; bot.d = s.d; bot.t = 0;
    bot.bump = s.bump ? 1 : 0;
    const newly = [...s.lit].find(k => !lit.has(k));
    if (newly) {
      const [x, y] = newly.split(',').map(Number), p = iso(x, y);
      fx.burst(14, () => ({ x: p.x, y: p.y, vx: R(-80, 80), vy: R(-120, -20), life: 0.6, size: R(2, 4), color: '#7ef0ff', g: 0, drag: 1.5 }));
      Arcade.tone({ freq: 700 + s.lit.size * 40, dur: 0.1, type: 'triangle', vol: 0.04 });
    } else if (s.cmd === 'X') Arcade.tone({ freq: 300, dur: 0.06, type: 'sine', vol: 0.03 });
    else if (s.bump) Arcade.tone({ freq: 120, dur: 0.08, type: 'square', vol: 0.03 });
    else if (s.cmd === 'F') Arcade.tone({ freq: 260, dur: 0.03, type: 'sine', vol: 0.02 });
    lit = s.lit;
    current = s.at;
    renderSide();
    if (run.i >= run.steps.length) setTimeout(finishRun, STEP() * 1000 + 150);
  }
  let current = null;

  function finishRun() {
    if (state !== 'run') return;
    current = null;
    if (run.win) return win();
    state = 'fail';
    flash(run.ranOut ? 'It ran forever! Every tile has to be lit for it to stop.' : 'Not every tile is lit. Tweak the program and run it again.');
    Arcade.tone({ freq: 300, to: 150, dur: 0.3, type: 'sine', vol: 0.04 });
    setTimeout(() => { if (state === 'fail') stop(); }, 1400);
  }

  function win() {
    state = 'won';
    const size = B.size(prog);
    const stars = B.stars(L, size);
    const pts = B.points(L, size);
    const prev = best[li];
    if (!prev || pts > prev.pts) { best[li] = { pts, stars: Math.max(stars, prev?.stars || 0), size: Math.min(size, prev?.size ?? Infinity) }; Arcade.save(SAVE, best); }
    updateHud();
    [523, 659, 784, 1047].forEach((f, i) => Arcade.tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.05, delay: i * 0.07 }));
    Arcade.flag('byte-bot-first');
    if (stars === 3) Arcade.flag('byte-bot-perfect');
    if (size < L.par) Arcade.flag('byte-bot-shorter');
    if (prog.p1.includes('1')) Arcade.flag('byte-bot-recursion');
    if (Object.keys(best).length >= LEVELS.length) Arcade.flag('byte-bot-all');
    setTimeout(() => {
      Arcade.finish(ui, {
        score: total(),
        title: `${L.name}: all lit! ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`,
        lines: [`${size} command${size === 1 ? '' : 's'} (par ${L.par})${size < L.par ? ` · ${L.par - size} under par, +${(L.par - size) * B.SAVE_PTS}!` : ''}`, 'Every command under par is worth ' + B.SAVE_PTS + ' more points. Your score is the total of your best on every level.'],
        button: li + 1 < LEVELS.length ? 'Next level' : 'Level select',
        onAction: () => (li + 1 < LEVELS.length ? load(li + 1) : showMenu()),
      });
      const panel = overlayEl.querySelector('.panel');
      if (panel) {
        panel.insertAdjacentHTML('beforeend', '<div class="menu" style="margin-top:8px"><button class="btn secondary" type="button" data-retry>Make it shorter</button><button class="btn secondary" type="button" data-menu>Levels</button></div>');
        panel.querySelector('[data-retry]').addEventListener('click', () => { ui.hide(); state = 'edit'; reset(); renderSide(); });
        panel.querySelector('[data-menu]').addEventListener('click', showMenu);
      }
    }, 700);
  }

  let flashMsg = null;
  function flash(t) { flashMsg = { t, life: 2.6 }; }

  // ---------- Side panel ----------

  function renderSide() {
    if (!L) return;
    const fnHtml = fn => {
      const n = slotsFor(fn), code = prog[fn];
      return `<div class="bb-fn ${active === fn ? 'on' : ''} ${n ? '' : 'off'}" data-fn="${fn}">
        <h3><span>${fn === 'main' ? 'Main' : fn.toUpperCase()}</span><span>${code.length}/${n}</span></h3>
        <div class="bb-slots">${Array.from({ length: n }, (_, i) => {
          const c = code[i];
          const now = current && current.fn === fn && current.i === i;
          return c ? `<button type="button" class="bb-slot full c-${c} ${now ? 'now' : ''}" data-rm="${fn}:${i}" title="Click to remove">${ICON[c]}</button>` : '<span class="bb-slot"></span>';
        }).join('')}</div></div>`;
    };
    const editing = state === 'edit';
    $('side').innerHTML = `
      <div class="bb-title"><span>${li + 1}. ${L.name}</span><small>Par ${L.par}${best[li] ? ` · ${'★'.repeat(best[li].stars)}` : ''}</small></div>
      ${FNS.map(fnHtml).join('')}
      <div class="bb-pal">${CMDS.map(c => `<button type="button" class="c-${c.c}" data-add="${c.c}" ${!editing || (c.c === '1' && !L.slots[1]) || (c.c === '2' && !L.slots[2]) ? 'disabled' : ''}><span>${c.icon}</span>${c.label}<kbd>${c.key}</kbd></button>`).join('')}</div>
      <div class="bb-run">
        <button class="btn" type="button" data-run>${editing ? '▶ Run (Enter)' : '■ Stop (Enter)'}</button>
        <button class="btn secondary" type="button" data-fast>${fast ? 'Fast ✓' : 'Fast'}</button>
      </div>
      <div class="bb-run"><button class="btn secondary" type="button" data-clear ${editing ? '' : 'disabled'}>Clear ${active === 'main' ? 'Main' : active.toUpperCase()}</button><button class="btn secondary" type="button" data-menu>Levels</button></div>
      <p style="font-size:11px;color:var(--muted);margin:0">Click a row to choose where commands go. Click a command to remove it. Light toggles: lighting a lit tile turns it off.</p>`;
    $('side').querySelectorAll('[data-fn]').forEach(el => el.addEventListener('click', e => { if (e.target.closest('[data-rm]')) return; active = el.dataset.fn; renderSide(); }));
    $('side').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { const [fn, i] = b.dataset.rm.split(':'); removeAt(fn, +i); }));
    $('side').querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => add(b.dataset.add)));
    $('side').querySelector('[data-run]').addEventListener('click', () => (state === 'edit' ? start() : stop()));
    $('side').querySelector('[data-fast]').addEventListener('click', () => { fast = !fast; renderSide(); });
    $('side').querySelector('[data-clear]').addEventListener('click', () => { prog[active] = ''; store(); renderSide(); });
    $('side').querySelector('[data-menu]').addEventListener('click', showMenu);
  }

  addEventListener('keydown', e => {
    if (state === 'menu' || !overlayEl.hidden) return;
    const map = { ArrowUp: 'F', KeyW: 'F', ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', Space: 'X', Digit1: '1', Digit2: '2' };
    if (map[e.code]) { e.preventDefault(); add(map[e.code]); }
    if (e.code === 'Backspace') { e.preventDefault(); if (state === 'edit' && prog[active].length) removeAt(active, prog[active].length - 1); }
    if (e.code === 'Tab') { e.preventDefault(); const open = FNS.filter(f => slotsFor(f)); active = open[(open.indexOf(active) + (e.shiftKey ? open.length - 1 : 1)) % open.length]; renderSide(); }
    if (e.code === 'Enter') { e.preventDefault(); state === 'edit' ? start() : stop(); }
    if (e.code === 'Escape') showMenu();
  });

  // ---------- Board ----------

  const TW = 64, TH = 34, TD = 14;
  let ox = CW / 2, oy = 120;
  function layout() {
    const h = L.map.length, w = Math.max(...L.map.map(r => r.length));
    const bw = (w + h) * TW / 2, bh = (w + h) * TH / 2;
    ox = CW / 2 - (w - h) * TW / 4;
    oy = (CH - bh) / 2 - 10;
    // Small boards are drawn bigger.
    zoom = Math.min(1.9, CW * 0.8 / bw, CH * 0.62 / (bh + 40));
  }
  let zoom = 1;
  const iso = (x, y) => ({ x: ox + (x - y) * TW / 2, y: oy + (x + y) * TH / 2 + TH / 2 });

  function tile(x, y, kind) {
    const p = iso(x, y);
    const top = [[p.x, p.y - TH / 2], [p.x + TW / 2, p.y], [p.x, p.y + TH / 2], [p.x - TW / 2, p.y]];
    const isLit = lit.has(x + ',' + y);
    const col = kind === '*' ? (isLit ? '#5ef2ff' : '#2b5fb8') : '#8892aa';
    // Sides.
    ctx.fillStyle = Gfx.shade(col, -0.35);
    ctx.beginPath(); ctx.moveTo(...top[3]); ctx.lineTo(...top[2]); ctx.lineTo(top[2][0], top[2][1] + TD); ctx.lineTo(top[3][0], top[3][1] + TD); ctx.fill();
    ctx.fillStyle = Gfx.shade(col, -0.5);
    ctx.beginPath(); ctx.moveTo(...top[2]); ctx.lineTo(...top[1]); ctx.lineTo(top[1][0], top[1][1] + TD); ctx.lineTo(top[2][0], top[2][1] + TD); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); top.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    if (kind === '*') {
      ctx.save();
      if (isLit) { ctx.shadowColor = '#7ef0ff'; ctx.shadowBlur = 18; }
      ctx.fillStyle = isLit ? '#e8fdff' : 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawBot() {
    const k = Math.min(1, bot.t);
    const e = Gfx.ease.inOutCubic(k);
    const x = bot.px + (bot.x - bot.px) * e, y = bot.py + (bot.y - bot.py) * e;
    let d = bot.pd + ((((bot.d - bot.pd) % 4) + 5) % 4 - 1) * e;
    const p = iso(x, y), bob = Math.sin(time * 6) * 1.5;
    const shakeX = bot.bump > 0 ? Math.sin(time * 60) * 3 * bot.bump : 0;
    Gfx.shadow(ctx, p.x, p.y + 2, 16, 7, 0.35);
    const a = d * Math.PI / 2;
    // Facing in screen space: east goes down-right, south down-left, and so on.
    const fxv = Math.cos(a) - Math.sin(a), fyv = (Math.cos(a) + Math.sin(a)) * 0.5;
    const bx = p.x + shakeX, by = p.y - 26 + bob;
    ctx.fillStyle = '#d6dbe6'; Gfx.roundRect(ctx, bx - 14, by - 4, 28, 24, 7); ctx.fill();
    ctx.fillStyle = '#aab3c5'; ctx.fillRect(bx - 14, by + 14, 28, 6);
    ctx.fillStyle = '#eef1f7'; Gfx.roundRect(ctx, bx - 12, by - 20, 24, 18, 6); ctx.fill();
    // Face toward where it's heading (eyes slide around).
    const ex = fxv * 4, ey = fyv * 3, front = fyv > -0.1;
    if (front) {
      ctx.fillStyle = '#1b1f2e'; Gfx.roundRect(ctx, bx - 9 + ex, by - 16 + ey, 18, 10, 4); ctx.fill();
      ctx.fillStyle = state === 'won' ? '#ffd23f' : '#5ef2ff';
      ctx.fillRect(bx - 6 + ex, by - 13 + ey, 4, 4); ctx.fillRect(bx + 2 + ex, by - 13 + ey, 4, 4);
    }
    ctx.strokeStyle = '#8892aa'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by - 20); ctx.lineTo(bx, by - 28); ctx.stroke();
    ctx.fillStyle = '#ff5a5f'; ctx.beginPath(); ctx.arc(bx, by - 29, 3, 0, Math.PI * 2); ctx.fill();
    // Arrow on the floor showing which way it faces.
    ctx.fillStyle = 'rgba(255,210,63,0.8)';
    ctx.beginPath(); ctx.moveTo(p.x + fxv * 24, p.y + fyv * 24); ctx.lineTo(p.x + fxv * 12 - fyv * 8, p.y + fyv * 12 + fxv * 4); ctx.lineTo(p.x + fxv * 12 + fyv * 8, p.y + fyv * 12 - fxv * 4); ctx.fill();
  }

  function draw(dt) {
    ctx.clearRect(0, 0, CW, CH);
    if (!L) return;
    layout();
    ctx.save();
    ctx.translate(CW / 2, CH / 2); ctx.scale(zoom, zoom); ctx.translate(-CW / 2, -CH / 2);
    const h = L.map.length;
    // Back to front.
    const cells = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < L.map[y].length; x++) if (L.map[y][x] !== ' ') cells.push([x, y, L.map[y][x]]);
    cells.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
    const botDepth = bot.x + bot.y;
    let drawn = false;
    for (const [x, y, k] of cells) {
      if (!drawn && x + y > botDepth) { drawBot(); drawn = true; }
      tile(x, y, k);
    }
    if (!drawn) drawBot();
    fx.draw(ctx);
    ctx.restore();
    const targets = cells.filter(c => c[2] === '*').length;
    Gfx.text(ctx, `${lit.size} / ${targets} lit`, CW - 16, 24, { size: 16, align: 'right' });
    if (flashMsg) { ctx.globalAlpha = Math.min(1, flashMsg.life); Gfx.text(ctx, flashMsg.t, CW / 2, 30, { size: 15, color: '#ffb0a0' }); ctx.globalAlpha = 1; }
  }

  function updateHud() {
    $('level').textContent = L ? li + 1 : '-';
    $('stars').textContent = Object.values(best).reduce((t, b) => t + b.stars, 0);
    $('total').textContent = total().toLocaleString();
  }

  function showMenu() {
    if (state === 'run') stop();
    state = 'menu';
    if (!L) { L = LEVELS[nextUp()]; li = nextUp(); prog = { main: '', p1: '', p2: '' }; reset(); }
    ui.show({
      title: '🤖 Byte Bot',
      html: `<p>Program the robot to light up every blue tile. Line up commands, press <b>Run</b>, and watch it follow them exactly.</p>
        <p style="font-size:13px;color:var(--muted)">Later levels add <b>P1</b> and <b>P2</b>: little programs that Main can call, again and again. Shorter programs earn more stars, and every command under par is worth bonus points.</p>
        <div class="row" style="flex-wrap:wrap;gap:6px;justify-content:center">${LEVELS.map((l, i) => { const b = best[i], open = i <= Object.keys(best).length + 1; return `<button class="btn ${b ? 'secondary' : ''}" type="button" data-l="${i}" ${open ? '' : 'disabled'} style="min-width:60px;flex-direction:column;line-height:1.2"><b>${open ? i + 1 : '🔒'}</b><small style="font-size:10px;color:#ffd23f">${b ? '★'.repeat(b.stars) : ''}</small></button>`; }).join('')}</div>
        <p style="font-size:12px;color:var(--muted)">${total().toLocaleString()} points</p>`,
      button: `Play level ${nextUp() + 1}`,
      onAction: () => load(nextUp()),
      onRender: p => p.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => load(+b.dataset.l))),
    });
    updateHud();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    if (bot) { bot.t = Math.min(1, bot.t + dt / STEP()); bot.bump = Math.max(0, bot.bump - dt * 3); }
    if (state === 'run' && overlayEl.hidden) { stepT += dt; if (stepT >= STEP()) { stepT = 0; advance(); } }
    if (flashMsg) { flashMsg.life -= dt; if (flashMsg.life <= 0) flashMsg = null; }
    fx.update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  showMenu();
  requestAnimationFrame(frame);
})();
