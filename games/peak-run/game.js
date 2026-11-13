(() => {
  const W = 900, H = 560;
  const BETS = [10, 25, 100, 250];
  const PER_CARD = 0.02;     // each card pays stake × this × the current combo
  const PEAK_BONUS = 0.5, CLEAR_BONUS = 2, STOCK_BONUS = 0.1;
  const UNIT = 82, X0 = 46, Y0 = 34, ROW_Y = 56;
  const STOCK = { x: 300, y: 418 }, WASTE = { x: 420, y: 418 };
  // Power-ups and chains. Golden cards hand out a power when cleared. A combo of HOT or more pays
  // HOT_PAY times as much, and every CHAIN cards in a row pays a bonus. Tuned so a greedy bot
  // returns about 25% more per stake than before powers, since chips are shared with other tables.
  const GOLD_CARDS = 2, HOT = 6, HOT_PAY = 1.25, CHAIN = 5, CHAIN_BONUS = 0.1;
  const POWERS = {
    wild: { key: '1', name: 'Wild', desc: 'the next card you click fits, whatever its rank', color: '#c39bff' },
    peek: { key: '2', name: 'Peek', desc: 'see the next stock card before you call', color: '#7fdbff' },
  };

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const money = Cards.money;
  const fx = Gfx.particles(500);
  const pops = Gfx.floaters();
  const shake = Gfx.shaker();

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
  let gold, powers, wildOn, peekOn;
  const session = Cards.session();

  // ---------- Rules ----------

  const exposed = i => table[i] && COVERS[i].every(j => !table[j]);
  const top = () => waste[waste.length - 1];
  const fits = c => {
    if (wildOn) return true;
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
    // Golden cards sit anywhere below the peaks.
    gold = new Set();
    while (gold.size < GOLD_CARDS) gold.add(Arcade.randInt(3, LAYOUT.length - 1));
    powers = { wild: 0, peek: 0 };
    wildOn = peekOn = false;
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
    const wasWild = wildOn && !fitsRank(c);
    wildOn = false;
    table[i] = null;
    waste.push(Cards.place(c, WASTE.x, WASTE.y, 0, { x: c.x, y: c.y }));
    combo++;
    cleared++;
    bestCombo = Math.max(bestCombo, combo);
    if (combo >= 10) Arcade.flag('peak-run-combo');
    const hot = combo >= HOT;
    let pay = bet * PER_CARD * combo * (hot ? HOT_PAY : 1);
    const cx = c.x + Cards.W / 2, cy = c.y + Cards.H / 2;
    burst(cx, cy, hot ? ['#ff9f43', '#ffd84d', '#fff'] : ['#ffd84d', '#fff'], hot ? 16 : 9);
    if (combo === HOT) {
      say(`Hot streak! Cards pay ×${HOT_PAY}`, '#ff9f43');
      shake.add(0.25);
    }
    if (combo % CHAIN === 0) {
      const bonus = bet * CHAIN_BONUS * (combo / CHAIN);
      pay += bonus;
      pops.add(`Chain ×${combo}! +${money(Math.round(bonus))}`, cx, cy - 34, { color: '#ff9f43', size: 20, life: 1.2 });
      shake.add(0.3);
      if (combo >= 15) Arcade.flag('peak-run-chain');
    }
    if (wasWild) pops.add('Wild!', cx, cy - 16, { color: POWERS.wild.color, size: 18 });
    if (gold.has(i)) {
      gold.delete(i);
      const kind = Math.random() < 0.5 ? 'wild' : 'peek';
      powers[kind]++;
      pops.add(`${POWERS[kind].name} +1 (${POWERS[kind].key})`, cx, cy - 52, { color: POWERS[kind].color, size: 18, life: 1.3 });
      burst(cx, cy, ['#ffd84d', '#ffe9a8', POWERS[kind].color], 20);
      Arcade.flag('peak-run-gold');
      Arcade.tone({ freq: 880, to: 1760, dur: 0.25, type: 'triangle', vol: 0.05 });
    }
    if (LAYOUT[i].row === 0) {
      peaks++;
      pay += bet * PEAK_BONUS;
      say(`Peak cleared! +${money(bet * PEAK_BONUS)}`, '#ffc53d');
      shake.add(0.45);
      burst(cx, cy, ['#ffc53d', '#3ddc84', '#fff', '#7fdbff'], 30);
    }
    if (cleared === LAYOUT.length) {
      pay += bet * CLEAR_BONUS + stock.length * bet * STOCK_BONUS;
      Arcade.flag('peak-run-clear');
    }
    pay = Math.round(pay);
    pops.add('+' + money(pay), cx, cy, { color: hot ? '#ff9f43' : '#ffe066', size: hot ? 18 : 15 });
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
    // A peeked call can't be wrong, so only call the way it's going.
    if (peekOn && call) {
      const next = stock[stock.length - 1];
      if (call === 'up' ? next.r <= top().r : next.r >= top().r) return say('Peeked: that call would be wrong', '#7fdbff');
    }
    peekOn = false;
    wildOn = false;
    const prev = top();
    const c = Cards.place(stock.pop(), WASTE.x, WASTE.y, 0, { x: STOCK.x, y: STOCK.y });
    waste.push(c);
    const right = call && (call === 'up' ? c.r > prev.r : c.r < prev.r);
    if (right) {
      say(`Called it! Combo ×${combo} kept`, '#3ddc84');
      Arcade.tone({ freq: 660, to: 990, dur: 0.15, type: 'triangle', vol: 0.05 });
    } else {
      if (call) say('Wrong call. Combo lost', '#ff7a7a');
      if (combo >= HOT) shake.add(0.2);
      combo = 0;
      Arcade.tone({ freq: 300, dur: 0.05, vol: 0.03 });
    }
    checkStuck();
    render();
  }

  function checkStuck() {
    if (!stock.length && !playable().length && !(powers.wild && table.some((c, i) => c && exposed(i)))) finishDeal(false);
  }

  const fitsRank = c => {
    const d = Math.abs(c.r - top().r);
    return d === 1 || d === 12;
  };

  function usePower(kind) {
    if (state !== 'play' || !powers[kind]) return;
    if (kind === 'wild' && wildOn) return;
    if (kind === 'peek' && (peekOn || !stock.length)) return;
    powers[kind]--;
    if (kind === 'wild') {
      wildOn = true;
      say('Wild! Click any face-up card', POWERS.wild.color);
    } else {
      peekOn = true;
      say('Peek: the next stock card is showing', POWERS.peek.color);
    }
    Arcade.tone({ freq: 520, to: 1040, dur: 0.18, type: 'sine', vol: 0.05 });
    render();
  }

  function burst(x, y, colors, n) {
    fx.burst(n, () => ({
      x, y, vx: Gfx.rand(-220, 220), vy: Gfx.rand(-260, 60), drag: 2.4, life: Gfx.rand(0.45, 0.8),
      size: Gfx.rand(2.5, 4.5), color: colors[Math.floor(Gfx.rand(0, colors.length))], shape: Gfx.rand() < 0.5 ? 'square' : 'chip', spin: Gfx.rand(-10, 10),
    }));
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
      bar.innerHTML = b('flip', `Flip (Space) · ${stock.length} left`, can, '') + b('up', 'Call higher (↑)', can && top().r < 13) + b('down', 'Call lower (↓)', can && top().r > 1) +
        b('wild', `Wild (1) ×${powers.wild}`, powers.wild > 0 && !wildOn) + b('peek', `Peek (2) ×${powers.peek}`, powers.peek > 0 && !peekOn && can);
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
    else if (a === 'wild' || a === 'peek') usePower(a);
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
    else if (state === 'play' && e.code === 'Digit1') usePower('wild');
    else if (state === 'play' && e.code === 'Digit2') usePower('peek');
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

  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    fx.update(dt);
    pops.update(dt);
    shake.update(dt);
    const sh = shake.offset(7);
    ctx.save();
    ctx.translate(sh.x, sh.y);
    Cards.felt(ctx, W, H);
    if (table) {
      const hints = state === 'play' ? new Set(playable()) : new Set();
      const t = now / 1000;
      table.forEach((c, i) => {
        if (!c) return;
        const up = exposed(i);
        Cards.draw(ctx, c, { faceDown: !up, glow: hints.has(i) });
        if (gold.has(i)) drawGold(c, up, t);
      });
      const n = Math.min(stock.length, 6);
      for (let k = 0; k < n; k++) {
        const faceUp = peekOn && k === n - 1;
        const card = faceUp ? { ...stock[stock.length - 1], x: STOCK.x - k * 2, y: STOCK.y - k * 2 } : { x: STOCK.x - k * 2, y: STOCK.y - k * 2, r: 1, s: 0 };
        Cards.draw(ctx, card, { faceDown: !faceUp });
      }
      if (peekOn && stock.length) Gfx.text(ctx, 'PEEK', STOCK.x + Cards.W / 2 - 10, STOCK.y - 18, { size: 13, color: POWERS.peek.color, width: 3 });
      if (!stock.length) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(STOCK.x, STOCK.y, Cards.W, Cards.H, 8); ctx.stroke();
      }
      waste.slice(-3).forEach(c => Cards.draw(ctx, c));
      if (wildOn) {
        ctx.save();
        ctx.strokeStyle = POWERS.wild.color;
        ctx.lineWidth = 3;
        ctx.shadowColor = POWERS.wild.color;
        ctx.shadowBlur = 12 + Math.sin(now / 120) * 6;
        ctx.beginPath(); ctx.roundRect(WASTE.x - 3, WASTE.y - 3, Cards.W + 6, Cards.H + 6, 10); ctx.stroke();
        ctx.restore();
        Gfx.text(ctx, 'WILD', WASTE.x + Cards.W / 2, WASTE.y - 18, { size: 13, color: POWERS.wild.color, width: 3 });
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = '700 18px system-ui, sans-serif';
      const hot = combo >= HOT;
      Gfx.text(ctx, `Combo ×${combo}${hot ? ' 🔥' : ''}`, 560, 440, { size: 20, align: 'left', color: hot ? '#ff9f43' : '#fff', width: 3 });
      if (state === 'play') Gfx.bar(ctx, 560, 452, 170, 5, (combo % CHAIN) / CHAIN, hot ? '#ff9f43' : '#ffd84d');
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(`Won this deal ${money(won)} · peaks ${peaks}/3`, 560, 478);
      ctx.fillText(`Next card pays ${money(Math.round(bet * PER_CARD * (combo + 1) * (combo + 1 >= HOT ? HOT_PAY : 1)))}`, 560, 500);
      ctx.fillText(`Chain bonus in ${CHAIN - (combo % CHAIN)} · golden cards left ${gold.size}`, 560, 522);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pick a stake and press Deal', W / 2, 260);
    }
    fx.draw(ctx);
    pops.draw(ctx);
    if (msg && performance.now() - msg.at < 2500) Cards.banner(ctx, W, 390, msg.text, msg.color);
    ctx.restore();
    requestAnimationFrame(frame);
  }

  // A golden card: shimmering gold rim, and a star once it's face up.
  function drawGold(c, up, t) {
    ctx.save();
    ctx.strokeStyle = '#ffd84d';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#ffd84d';
    ctx.shadowBlur = 8 + Math.sin(t * 4 + c.x) * 4;
    ctx.beginPath(); ctx.roundRect(c.x + 1, c.y + 1, Cards.W - 2, Cards.H - 2, 8); ctx.stroke();
    ctx.restore();
    Gfx.text(ctx, '★', c.x + Cards.W - 12, c.y + 14, { size: up ? 16 : 13, color: '#ffd84d', width: 3 });
  }

  if (Cards.chips() < BETS[0]) Cards.bailout();
  render();
  ui.show({
    title: 'Peak Run',
    html: `<ul>
      <li>Clear the three peaks. Click any face-up card <b>one higher or lower</b> than the card on the pile. Kings and aces connect.</li>
      <li>Every card in a row grows your <b>combo</b>, and each card pays more than the last.</li>
      <li>Stuck? Flip from the stock. That breaks the combo, unless you <b>call higher or lower</b> and get it right.</li>
      <li>Reach a combo of ${HOT} for a <b>hot streak</b> (cards pay ×${HOT_PAY}), and every ${CHAIN} in a row pays a <b>chain bonus</b>.</li>
      <li><b>Golden ★ cards</b> give a power: <b>Wild</b> (1) makes any card fit, <b>Peek</b> (2) shows the next stock card.</li>
      <li>Bonus chips for each peak and a big one for clearing them all. You have <b>${money(Cards.chips())}</b>, shared with the other card tables.</li>
    </ul>`,
    button: 'Take a seat',
    onAction: sitDown,
  });
  requestAnimationFrame(frame);
})();
