(() => {
  const W = 900, H = 560;
  const BETS = [5, 10, 25, 50, 100];
  // Jacks or Better, "9/6" pay table: what each hand pays per chip bet.
  const PAYS = [
    ['Royal Flush', 250], ['Straight Flush', 50], ['Four of a Kind', 25], ['Full House', 9],
    ['Flush', 6], ['Straight', 4], ['Three of a Kind', 3], ['Two Pair', 2], ['Jacks or Better', 1],
  ];
  const PAY = Object.fromEntries(PAYS);

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const money = Cards.money;

  let state = 'bet';   // bet → hold → done
  let bet = Arcade.load('poker:bet', 25);
  let hand = [], held = [false, false, false, false, false], deck = [], result = null, busy = false;
  const session = Cards.session();
  const cardX = i => 115 + i * 140;
  const CARD_Y = 300;

  // ---------- Hand ranking ----------

  function rank(cards) {
    const rs = cards.map(c => c.r).sort((a, b) => a - b);
    const counts = {};
    for (const r of rs) counts[r] = (counts[r] || 0) + 1;
    const groups = Object.entries(counts).map(([r, n]) => [+r, n]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const flush = cards.every(c => c.s === cards[0].s);
    const uniq = new Set(rs).size === 5;
    const wheel = rs.join() === '1,2,3,4,5';
    const broadway = rs.join() === '1,10,11,12,13';
    const straight = uniq && (rs[4] - rs[0] === 4 || broadway || wheel);
    if (straight && flush) return broadway ? 'Royal Flush' : 'Straight Flush';
    if (groups[0][1] === 4) return 'Four of a Kind';
    if (groups[0][1] === 3 && groups[1][1] === 2) return 'Full House';
    if (flush) return 'Flush';
    if (straight) return 'Straight';
    if (groups[0][1] === 3) return 'Three of a Kind';
    if (groups[0][1] === 2 && groups[1][1] === 2) return 'Two Pair';
    if (groups[0][1] === 2 && (groups[0][0] >= 11 || groups[0][0] === 1)) return 'Jacks or Better';
    return null;
  }

  // ---------- Flow ----------

  function dealHand() {
    if (busy || state === 'hold' || bet > Cards.chips()) return;
    Cards.addChips(-bet);
    Arcade.save('poker:bet', bet);
    deck = Cards.shoe(1);
    hand = Array.from({ length: 5 }, (_, i) => Cards.place(deck.pop(), cardX(i), CARD_Y, i * 0.1));
    held = [false, false, false, false, false];
    result = null;
    state = 'hold';
    for (let i = 0; i < 5; i++) Arcade.tone({ freq: 900, dur: 0.03, vol: 0.02, delay: i * 0.1 });
    busy = true;
    setTimeout(() => { busy = false; render(); }, 650);
    render();
  }

  function toggle(i) {
    if (state !== 'hold' || busy) return;
    held[i] = !held[i];
    Arcade.tone({ freq: held[i] ? 660 : 440, dur: 0.05, vol: 0.03 });
    render();
  }

  function drawCards() {
    if (state !== 'hold' || busy) return;
    busy = true;
    let n = 0;
    hand = hand.map((c, i) => (held[i] ? c : Cards.place(deck.pop(), cardX(i), CARD_Y, 0.1 * n++, { x: cardX(i), y: -140 })));
    for (let i = 0; i < n; i++) Arcade.tone({ freq: 900, dur: 0.03, vol: 0.02, delay: i * 0.1 });
    setTimeout(() => {
      const r = rank(hand);
      const win = r ? PAY[r] * bet : 0;
      Cards.addChips(win);
      session.track();
      result = { name: r, win };
      if (r === 'Royal Flush') Arcade.flag('video-poker-royal');
      if (r && PAY[r] >= 25) Arcade.flag('video-poker-quads');
      Arcade.tone(win ? { freq: 523, to: 1046, dur: 0.3, type: 'triangle', vol: 0.06 } : { freq: 300, to: 180, dur: 0.2, type: 'sawtooth', vol: 0.03 });
      state = 'done';
      busy = false;
      render();
      if (Cards.chips() < BETS[0]) setTimeout(bust, 900);
    }, 300 + n * 100);
    render();
  }

  function setBet(v) {
    if (state === 'hold') return;
    bet = v;
    render();
  }

  function cashOut() {
    if (state === 'hold' || busy) return;
    session.track();
    Arcade.finish(ui, {
      score: session.peak,
      title: 'Cashed out',
      lines: [`You're holding ${money(Cards.chips())}. Your score is the most chips you held this session.`, 'Chips carry over to Blackjack and High-Low.'],
      button: 'Back to the machine',
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
      button: 'Back to the machine',
      onAction: sitDown,
    });
  }

  function sitDown() {
    session.reset();
    state = hand.length ? 'done' : 'bet';
    result = null;
    ui.hide();
    render();
  }

  // ---------- Controls ----------

  function render() {
    const bar = $('actions');
    const b = (id, label, on, cls = 'secondary') => `<button class="btn ${cls}" type="button" data-a="${id}" ${on ? '' : 'disabled'}>${label}</button>`;
    const betting = state !== 'hold';
    bar.innerHTML = BETS.map(v => b('bet' + v, money(v), betting && Cards.chips() >= v, v === bet ? '' : 'secondary')).join('') +
      (state === 'hold' ? b('draw', 'Draw (Space)', !busy, '') : b('deal', `Deal ${money(bet)} (Space)`, Cards.chips() >= bet && !busy, '')) +
      b('cash', 'Cash out', betting && !busy);
    $('chips').textContent = money(Cards.chips());
    $('bet').textContent = money(bet);
    $('peak').textContent = money(Math.max(session.peak, Cards.chips()));
  }

  $('actions').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    e.target.blur();
    if (a.startsWith('bet')) setBet(+a.slice(3));
    else if (a === 'deal') dealHand();
    else if (a === 'draw') drawCards();
    else if (a === 'cash') cashOut();
  });

  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    if (y < CARD_Y - 30 || y > CARD_Y + Cards.H + 40) return;
    for (let i = 0; i < 5; i++) if (x >= cardX(i) && x <= cardX(i) + Cards.W) toggle(i);
  });

  window.addEventListener('keydown', e => {
    if (!$('overlay').hidden) return;
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
    if (n >= 0) toggle(n);
    else if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (state === 'hold') drawCards();
      else dealHand();
    }
  });

  // ---------- Drawing ----------

  function frame() {
    Cards.felt(ctx, W, H);

    // Pay table, with the current hand's row lit up.
    const tx = 60, ty = 40, rowH = 22;
    ctx.fillStyle = 'rgba(10,12,16,0.55)';
    ctx.beginPath();
    ctx.roundRect(tx - 16, ty - 22, W - 2 * tx + 32, rowH * 5 + 22, 12);
    ctx.fill();
    ctx.font = '600 14px system-ui, sans-serif';
    PAYS.forEach(([name, mult], i) => {
      const col = i < 5 ? 0 : 1, row = i < 5 ? i : i - 5;
      const x = tx + col * 400, y = ty + row * rowH;
      const hit = result?.name === name || (state === 'hold' && !busy && rank(hand) === name);
      ctx.fillStyle = hit ? '#ffc53d' : 'rgba(255,255,255,0.8)';
      ctx.textAlign = 'left';
      ctx.fillText(name, x, y);
      ctx.textAlign = 'right';
      ctx.fillText(money(mult * bet), x + 340, y);
    });

    hand.forEach((c, i) => {
      const up = held[i] && state === 'hold';
      Cards.draw(ctx, c, { lift: up ? 14 : 0, glow: up });
      if (state === 'hold') {
        ctx.font = '700 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = held[i] ? '#ffc53d' : 'rgba(255,255,255,0.45)';
        ctx.fillText(held[i] ? 'HELD' : `${i + 1} · hold`, cardX(i) + Cards.W / 2, CARD_Y + Cards.H + 28);
      }
    });

    if (!hand.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pick a bet and press Deal', W / 2, 360);
    } else if (state === 'hold' && !busy) {
      const r = rank(hand);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(r ? `You have ${r}. Hold cards, then Draw.` : 'Tap cards (or press 1–5) to hold them, then Draw.', W / 2, 240);
    }
    if (state === 'done' && result) {
      Cards.banner(ctx, W, 250, result.name ? `${result.name}! +${money(result.win)}` : 'No win', result.name ? '#3ddc84' : '#ff9a7a');
    }
    requestAnimationFrame(frame);
  }

  if (Cards.chips() < BETS[0]) Cards.bailout();
  render();
  ui.show({
    title: 'Video Poker',
    html: `<ul>
      <li>You're dealt five cards. Choose which to <b>hold</b>, then draw to replace the rest.</li>
      <li>A pair of <b>jacks or better</b> gets your bet back. A royal flush pays 250 to 1.</li>
      <li>Chips are pretend and shared with the other card tables. You have <b>${money(Cards.chips())}</b>.</li>
    </ul>`,
    button: 'Play',
    onAction: sitDown,
  });
  requestAnimationFrame(frame);
})();
