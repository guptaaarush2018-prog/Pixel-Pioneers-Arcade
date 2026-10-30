(() => {
  const W = 900, H = 560;
  const BETS = [10, 25, 100, 250];
  const PER_CARD = 0.02;     // each card pays stake × this × the current combo
  const PEAK_BONUS = 0.5, CLEAR_BONUS = 2, STOCK_BONUS = 0.1;
  const UNIT = 82, X0 = 46, Y0 = 34, ROW_Y = 56;
  const STOCK = { x: 300, y: 418 }, WASTE = { x: 420, y: 418 };

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const money = Cards.money;

  // The three peaks, as (row, x) in card-width units. A card is covered by the two cards that
  // overlap it in the row below.
  const LAYOUT = [
    ...[1.5, 4.5, 7.5].map(x => ({ row: 0, x })),
    ...[1, 2, 4, 5, 7, 8].map(x => ({ row: 1, x })),
    ...Array.from({ length: 9 }, (_, i) => ({ row: 2, x: i + 0.5 })),
    ...Array.from({ length: 10 }, (_, i) => ({ row: 3, x: i })),
  ];
  const COVERS = LAYOUT.map(a => LAYOUT.map((b, j) => (b.row === a.row + 1 && Math.abs(b.x - a.x) === 0.5 ? j : -1)).filter(j => j >= 0));

  let state = 'bet';   // bet → play → done
  let bet = Arcade.load('peak:bet', 25);
  let table, stock, waste, combo, bestCombo, won, cleared, peaks, msg;
  const session = Cards.session();

  // ---------- Rules ----------

  const exposed = i => table[i] && COVERS[i].every(j => !table[j]);
  const top = () => waste[waste.length - 1];
  const fits = c => {
    const d = Math.abs(c.r - top().r);
    return d === 1 || d === 12;  // K and A wrap around
  };
  const playable = () => table.map((c, i) => (c && exposed(i) && fits(c) ? i : -1)).filter(i => i >= 0);

  function pos(i) {
    const l = LAYOUT[i];
    return { x: X0 + l.x * UNIT, y: Y0 + l.row * ROW_Y };
  }

  function deal() {
    if (state === 'play' || bet > Cards.chips()) return;
    Cards.addChips(-bet);
    Arcade.save('peak:bet', bet);
    const deck = Cards.shoe(1);
    table = LAYOUT.map((_, i) => {
      const p = pos(i);
      return Cards.place(deck.pop(), p.x, p.y, i * 0.025);
    });
    stock = deck;
    waste = [Cards.place(stock.pop(), WASTE.x, WASTE.y, 0.75)];
    combo = 0;
    bestCombo = 0;
    won = 0;
    cleared = 0;
    peaks = 0;
    msg = null;
    state = 'play';
    Arcade.tone({ freq: 900, dur: 0.03, vol: 0.02 });
    render();
  }

  function take(i) {
    if (state !== 'play' || !exposed(i) || !fits(table[i])) return;
    const c = table[i];
    table[i] = null;
    waste.push(Cards.place(c, WASTE.x, WASTE.y, 0, { x: c.x, y: c.y }));
    combo++;
    cleared++;
    bestCombo = Math.max(bestCombo, combo);
    if (combo >= 10) Arcade.flag('peak-run-combo');
    let pay = bet * PER_CARD * combo;
    if (LAYOUT[i].row === 0) {
      peaks++;
      pay += bet * PEAK_BONUS;
      say(`Peak cleared! +${money(bet * PEAK_BONUS)}`, '#ffc53d');
    }
    if (cleared === LAYOUT.length) {
      pay += bet * CLEAR_BONUS + stock.length * bet * STOCK_BONUS;
      Arcade.flag('peak-run-clear');
    }
    pay = Math.round(pay);
    won += pay;
    Cards.addChips(pay);
    session.track();
    Arcade.tone({ freq: 440 + Math.min(combo, 14) * 45, dur: 0.08, type: 'triangle', vol: 0.05 });
    if (cleared === LAYOUT.length) finishDeal(true);
    else checkStuck();
    render();
  }

  // Turning a stock card breaks the combo, unless you called higher or lower and got it right.
  function flip(call = null) {
    if (state !== 'play' || !stock.length) return;
    const prev = top();
    const c = Cards.place(stock.pop(), WASTE.x, WASTE.y, 0, { x: STOCK.x, y: STOCK.y });
    waste.push(c);
    const right = call && (call === 'up' ? c.r > prev.r : c.r < prev.r);
    if (right) {
      say(`Called it! Combo ×${combo} kept`, '#3ddc84');
      Arcade.tone({ freq: 660, to: 990, dur: 0.15, type: 'triangle', vol: 0.05 });
    } else {
      if (call) say('Wrong call. Combo lost', '#ff7a7a');
      combo = 0;
      Arcade.tone({ freq: 300, dur: 0.05, vol: 0.03 });
    }
    checkStuck();
    render();
  }

  function checkStuck() {
    if (!stock.length && !playable().length) finishDeal(false);
  }

  function finishDeal(clearedAll) {
    state = 'done';
    session.track();
    const profit = won - bet;
    say(clearedAll ? `All three peaks! Won ${money(won)}` : profit >= 0 ? `Won ${money(won)}` : `Deal over · ${money(won)} back`, clearedAll || profit >= 0 ? '#3ddc84' : '#ffc53d');
    if (clearedAll) [523, 659, 784, 1046].forEach((f, k) => Arcade.tone({ freq: f, dur: 0.15, type: 'triangle', vol: 0.05, delay: k * 0.1 }));
    if (Cards.chips() < BETS[0]) setTimeout(bust, 1200);
  }

  function say(text, color) {
    msg = { text, color, at: performance.now() };
  }

  function cashOut() {
    if (state === 'play') return;
    session.track();
    Arcade.finish(ui, {
      score: session.peak,
      title: 'Cashed out',
      lines: [`You're holding ${money(Cards.chips())}. Your score is the most chips you held this session.`, 'Chips carry over to the other card tables.'],
      button: 'Back to the table',
      onAction: sitDown,
    });
  }

  function bust() {
    const score = session.peak;
    Cards.bailout();
    Arcade.finish(ui, {
      score,
      title: 'Out of chips',
      lines: [`The house spots you ${money(Cards.chips())} to keep playing.`],
      button: 'Back to the table',
      onAction: sitDown,
    });
  }

  function sitDown() {
    session.reset();
    ui.hide();
    render();
  }

  // ---------- Controls ----------

  function render() {
    const bar = $('actions');
    const b = (id, label, on, cls = 'secondary') => `<button class="btn ${cls}" type="button" data-a="${id}" ${on ? '' : 'disabled'}>${label}</button>`;
    if (state === 'play') {
      const can = stock.length > 0;
      bar.innerHTML = b('flip', `Flip (Space) · ${stock.length} left`, can, '') + b('up', 'Flip & call higher (↑)', can && top().r < 13) + b('down', 'Flip & call lower (↓)', can && top().r > 1);
    } else {
      bar.innerHTML = BETS.map(v => b('bet' + v, money(v), Cards.chips() >= v, v === bet ? '' : 'secondary')).join('') +
        b('deal', `Deal ${money(bet)} (Space)`, Cards.chips() >= bet, '') + b('cash', 'Cash out', true);
    }
    $('chips').textContent = money(Cards.chips());
    $('combo').textContent = state === 'play' ? `×${combo}` : '-';
    $('peak').textContent = money(Math.max(session.peak, Cards.chips()));
  }

  $('actions').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    e.target.blur();
    if (a.startsWith('bet')) { bet = +a.slice(3); render(); }
    else if (a === 'deal') deal();
    else if (a === 'cash') cashOut();
    else if (a === 'flip') flip();
    else flip(a);
  });

  window.addEventListener('keydown', e => {
    if (!$('overlay').hidden) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (state === 'play') flip();
      else deal();
    } else if (state === 'play' && (e.code === 'ArrowUp' || e.code === 'KeyW')) flip('up');
    else if (state === 'play' && (e.code === 'ArrowDown' || e.code === 'KeyS')) flip('down');
  });

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'play') return;
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const inside = (x, y) => px >= x && px <= x + Cards.W && py >= y && py <= y + Cards.H;
    if (inside(STOCK.x, STOCK.y)) return flip();
    // Topmost card first: later rows sit on top.
    for (let i = LAYOUT.length - 1; i >= 0; i--) {
      if (!table[i]) continue;
      const p = pos(i);
      if (inside(p.x, p.y)) return take(i);
    }
  });

  // ---------- Drawing ----------

  function frame() {
    Cards.felt(ctx, W, H);
    if (table) {
      const hints = state === 'play' ? new Set(playable()) : new Set();
      table.forEach((c, i) => { if (c) Cards.draw(ctx, c, { faceDown: !exposed(i), glow: hints.has(i) }); });
      for (let k = 0; k < Math.min(stock.length, 6); k++) {
        Cards.draw(ctx, { x: STOCK.x - k * 2, y: STOCK.y - k * 2, r: 1, s: 0 }, { faceDown: true });
      }
      if (!stock.length) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(STOCK.x, STOCK.y, Cards.W, Cards.H, 8); ctx.stroke();
      }
      waste.slice(-3).forEach(c => Cards.draw(ctx, c));

      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText(`Combo ×${combo}`, 560, 448);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(`Won this deal ${money(won)} · peaks ${peaks}/3`, 560, 474);
      ctx.fillText(`Next card pays ${money(Math.round(bet * PER_CARD * (combo + 1)))}`, 560, 498);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pick a stake and press Deal', W / 2, 260);
    }
    if (msg && performance.now() - msg.at < 2500) Cards.banner(ctx, W, 390, msg.text, msg.color);
    requestAnimationFrame(frame);
  }

  if (Cards.chips() < BETS[0]) Cards.bailout();
  render();
  ui.show({
    title: 'Peak Run',
    html: `<ul>
      <li>Clear the three peaks. Click any face-up card <b>one higher or lower</b> than the card on the pile. Kings and aces connect.</li>
      <li>Every card in a row grows your <b>combo</b>, and each card pays more than the last.</li>
      <li>Stuck? Flip from the stock. That breaks the combo, unless you <b>call higher or lower</b> and get it right.</li>
      <li>Bonus chips for each peak and a big one for clearing them all. You have <b>${money(Cards.chips())}</b>, shared with the other card tables.</li>
    </ul>`,
    button: 'Take a seat',
    onAction: sitDown,
  });
  requestAnimationFrame(frame);
})();
