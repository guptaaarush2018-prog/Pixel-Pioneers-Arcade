(() => {
  const W = 900, H = 560;
  const DECKS = 6, MIN_BET = 5;
  const CHIP_VALUES = [5, 25, 100, 500];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const money = Cards.money;

  let state = 'bet';    // bet → dealing → player → dealer → done
  let shoe = Cards.shoe(DECKS);
  let bet = 0, lastBet = 25;
  let hands = [], active = 0, dealer = [], holeHidden = true, messages = [];
  let busy = false;     // true while cards are flying, so buttons can't be spammed
  const session = Cards.session();

  // ---------- Rules ----------

  function value(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      total += c.r === 1 ? 11 : Math.min(10, c.r);
      if (c.r === 1) aces++;
    }
    while (total > 21 && aces) { total -= 10; aces--; }
    return { total, soft: aces > 0 };
  }
  const isBlackjack = cards => cards.length === 2 && value(cards).total === 21;
  const tenValue = c => Math.min(10, c.r);

  // Reshuffle once three quarters of the shoe is gone.
  function draw() {
    if (shoe.length < DECKS * 13) {
      shoe = Cards.shoe(DECKS);
      toast('Shuffling a fresh shoe');
    }
    return shoe.pop();
  }

  // ---------- Layout ----------

  const handX = i => (hands.length === 1 ? W / 2 : i === 0 ? W * 0.3 : W * 0.7);
  const cardX = (cx, n, i) => cx - Cards.W / 2 - ((n - 1) * 26) / 2 + i * 26;

  function deal(target, i, delay, cx, y) {
    const card = draw();
    target.push(card);
    Cards.place(card, cardX(cx, i + 1, i), y, delay);
    return card;
  }

  // Lines cards back up after a split or as a hand grows.
  function relayout() {
    hands.forEach((h, hi) => h.cards.forEach((c, i) => { c.x = cardX(handX(hi), h.cards.length, i); c.y = 330; }));
    dealer.forEach((c, i) => { c.x = cardX(W / 2, dealer.length, i); c.y = 70; });
  }

  // ---------- Flow ----------

  const wait = s => new Promise(r => setTimeout(r, s * 1000));

  async function startHand() {
    if (busy || state !== 'bet' || bet < MIN_BET || bet > Cards.chips()) return;
    busy = true;
    Cards.addChips(-bet);
    lastBet = bet;
    hands = [{ cards: [], bet, done: false, result: null }];
    dealer = [];
    active = 0;
    holeHidden = true;
    messages = [];
    state = 'dealing';
    render();
    const p = hands[0].cards;
    deal(p, 0, 0, W / 2, 330);
    deal(dealer, 0, 0.25, W / 2, 70);
    deal(p, 1, 0.5, W / 2, 330);
    deal(dealer, 1, 0.75, W / 2, 70);
    relayout();
    tick(4);
    await wait(1.1);

    // Dealer peeks for blackjack with an ace or ten showing.
    if (isBlackjack(dealer) || isBlackjack(p)) {
      holeHidden = false;
      await wait(0.4);
      return settle();
    }
    state = 'player';
    busy = false;
    render();
  }

  async function hit() {
    if (!canAct()) return;
    busy = true;
    const h = hands[active];
    deal(h.cards, h.cards.length, 0, handX(active), 330);
    relayout();
    tick(1);
    await wait(0.35);
    if (value(h.cards).total >= 21) return nextHand();
    busy = false;
    render();
  }

  function stand() {
    if (!canAct()) return;
    nextHand();
  }

  async function double() {
    if (!canDouble()) return;
    busy = true;
    const h = hands[active];
    Cards.addChips(-h.bet);
    h.bet *= 2;
    h.doubled = true;
    deal(h.cards, h.cards.length, 0, handX(active), 330);
    relayout();
    tick(1);
    await wait(0.45);
    nextHand();
  }

  async function split() {
    if (!canSplit()) return;
    busy = true;
    const h = hands[0];
    Cards.addChips(-h.bet);
    const moved = h.cards.pop();
    hands.push({ cards: [moved], bet: h.bet, done: false, result: null, fromSplit: true });
    h.fromSplit = true;
    relayout();
    await wait(0.2);
    deal(h.cards, 1, 0, handX(0), 330);
    deal(hands[1].cards, 1, 0.25, handX(1), 330);
    relayout();
    tick(2);
    await wait(0.6);
    // Split aces get one card each and no more.
    if (moved.r === 1) {
      hands.forEach(x => { x.done = true; });
      return dealerTurn();
    }
    if (value(h.cards).total === 21) return nextHand();
    busy = false;
    render();
  }

  async function nextHand() {
    hands[active].done = true;
    if (active < hands.length - 1) {
      active++;
      busy = false;
      if (value(hands[active].cards).total === 21) return nextHand();
      render();
      return;
    }
    dealerTurn();
  }

  // Dealer draws to 17 and stands on soft 17, unless every hand already busted.
  async function dealerTurn() {
    busy = true;
    state = 'dealer';
    holeHidden = false;
    render();
    await wait(0.5);
    if (hands.some(h => value(h.cards).total <= 21)) {
      while (value(dealer).total < 17) {
        deal(dealer, dealer.length, 0, W / 2, 70);
        relayout();
        tick(1);
        await wait(0.5);
      }
    }
    settle();
  }

  function settle() {
    const d = value(dealer).total;
    const dealerBJ = isBlackjack(dealer);
    let won = 0, staked = 0;
    for (const h of hands) {
      const v = value(h.cards).total;
      const bj = isBlackjack(h.cards) && !h.fromSplit;
      staked += h.bet;
      let pay = 0;
      if (v > 21) h.result = 'Bust';
      else if (bj && !dealerBJ) { h.result = 'Blackjack!'; pay = h.bet * 2.5; }
      else if (dealerBJ && !bj) h.result = 'Dealer blackjack';
      else if (d > 21 || v > d) { h.result = 'Win'; pay = h.bet * 2; }
      else if (v === d) { h.result = 'Push'; pay = h.bet; }
      else h.result = 'Lose';
      won += pay;
    }
    Cards.addChips(won);
    session.track();
    const net = won - staked;
    if (hands.some(h => h.result === 'Blackjack!')) Arcade.flag('blackjack-natural');
    if (net >= 1000) Arcade.flag('blackjack-big');
    Arcade.tone(net > 0 ? { freq: 523, to: 1046, dur: 0.25, type: 'triangle', vol: 0.06 } : net < 0 ? { freq: 300, to: 150, dur: 0.3, type: 'sawtooth', vol: 0.04 } : { freq: 440, dur: 0.1, vol: 0.04 });
    messages = [net > 0 ? `+${money(net)}` : net < 0 ? `−${money(-net)}` : 'Push'];
    state = 'done';
    busy = false;
    bet = Math.min(lastBet, Cards.chips());
    render();
    if (Cards.chips() < MIN_BET) setTimeout(bust, 900);
  }

  function newRound() {
    if (state !== 'done' || busy) return;
    hands = [];
    dealer = [];
    messages = [];
    state = 'bet';
    bet = Math.min(lastBet, Cards.chips());
    render();
  }

  // ---------- Leaving the table ----------

  function cashOut() {
    if (busy || (state !== 'bet' && state !== 'done')) return;
    session.track();
    const score = session.peak;
    Arcade.finish(ui, {
      score,
      title: 'Cashed out',
      lines: [`You're holding ${money(Cards.chips())}. Your score is the most chips you held this session.`, 'Chips carry over to Video Poker and High-Low.'],
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
    hands = [];
    dealer = [];
    messages = [];
    state = 'bet';
    bet = Math.min(lastBet, Cards.chips());
    ui.hide();
    render();
  }

  // ---------- Controls ----------

  const canAct = () => state === 'player' && !busy;
  const canDouble = () => canAct() && hands[active].cards.length === 2 && Cards.chips() >= hands[active].bet;
  const canSplit = () => canAct() && hands.length === 1 && hands[0].cards.length === 2 &&
    tenValue(hands[0].cards[0]) === tenValue(hands[0].cards[1]) && Cards.chips() >= hands[0].bet;

  function addBet(n) {
    if (state === 'done') {
      newRound();
      bet = 0; // picking chips after a hand starts a fresh bet
    }
    if (state !== 'bet') return;
    bet = Math.min(Cards.chips(), bet + n);
    Arcade.tone({ freq: 700, dur: 0.04, vol: 0.03 });
    render();
  }

  function render() {
    const bar = $('actions');
    const b = (id, label, on, cls = 'secondary') => `<button class="btn ${cls}" type="button" data-a="${id}" ${on ? '' : 'disabled'}>${label}</button>`;
    if (state === 'bet' || state === 'done') {
      bar.innerHTML = CHIP_VALUES.map(v => b('chip' + v, '+' + v, Cards.chips() > (state === 'bet' ? bet : 0))).join('') +
        b('clear', 'Clear', state === 'bet' && bet > 0) +
        (state === 'done'
          ? b('rebet', `Deal ${money(Math.min(lastBet, Cards.chips()))}`, Cards.chips() >= MIN_BET, '')
          : b('deal', 'Deal', bet >= MIN_BET && !busy, '')) +
        b('cash', 'Cash out', !busy);
    } else {
      bar.innerHTML = b('hit', 'Hit (H)', canAct(), '') + b('stand', 'Stand (S)', canAct(), '') +
        b('double', 'Double (D)', canDouble()) + b('split', 'Split (P)', canSplit());
    }
    $('chips').textContent = money(Cards.chips());
    $('bet').textContent = money(state === 'bet' ? bet : hands.reduce((n, h) => n + h.bet, 0));
    $('peak').textContent = money(Math.max(session.peak, Cards.chips()));
  }

  $('actions').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    e.target.blur();
    if (a.startsWith('chip')) addBet(+a.slice(4));
    else if (a === 'clear') { bet = 0; render(); }
    else if (a === 'deal') startHand();
    else if (a === 'rebet') { newRound(); startHand(); }
    else if (a === 'cash') cashOut();
    else ({ hit, stand, double, split })[a]();
  });

  window.addEventListener('keydown', e => {
    if (!$('overlay').hidden) return;
    if (e.code === 'KeyH') hit();
    else if (e.code === 'KeyS') stand();
    else if (e.code === 'KeyD') double();
    else if (e.code === 'KeyP') split();
    else if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (state === 'bet') startHand();
      else if (state === 'done' && Cards.chips() >= MIN_BET) { newRound(); startHand(); }
    }
  });

  let toasts = [];
  function toast(text) { toasts.push({ text, t: 2 }); }
  function tick(n) { for (let i = 0; i < n; i++) Arcade.tone({ freq: 900, dur: 0.03, vol: 0.02, delay: i * 0.25 }); }

  // ---------- Drawing ----------

  function frame() {
    Cards.felt(ctx, W, H);

    // The shoe, top right.
    ctx.fillStyle = '#0b2a1a';
    ctx.beginPath();
    ctx.roundRect(800, 24, 86, 120, 10);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i === 3 ? '#2a5bd7' : '#1f48ad';
      ctx.beginPath();
      ctx.roundRect(812 - i * 2, 34 + i * 2, Cards.W - 14, 96, 6);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON SOFT 17', W / 2, 262);

    dealer.forEach((c, i) => Cards.draw(ctx, c, { faceDown: i === 1 && holeHidden }));
    if (dealer.length && performance.now() > dealer[dealer.length - 1].at + 260) {
      const shown = holeHidden ? [dealer[0]] : dealer;
      const v = value(shown);
      pill(W / 2, 40, `Dealer ${v.soft && v.total < 21 && !holeHidden ? 'soft ' : ''}${v.total}${holeHidden ? ' + ?' : ''}`);
    }

    hands.forEach((h, hi) => {
      const cx = handX(hi);
      h.cards.forEach(c => Cards.draw(ctx, c, { lift: state === 'player' && hi === active && hands.length > 1 ? 8 : 0 }));
      if (h.cards.length && performance.now() > h.cards[h.cards.length - 1].at + 260) {
        const v = value(h.cards);
        pill(cx, 470, `${v.soft && v.total < 21 ? 'soft ' : ''}${v.total}${h.doubled ? ' · doubled' : ''}`, state === 'player' && hi === active);
        if (h.result) {
          const good = h.result === 'Win' || h.result === 'Blackjack!';
          pill(cx, 300, h.result, false, good ? '#3ddc84' : h.result === 'Push' ? '#ffc53d' : '#ff7a7a');
        }
      }
      Cards.chipStack(ctx, cx, 515, h.bet);
    });
    if (state === 'bet') {
      Cards.chipStack(ctx, W / 2, 470, bet);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bet >= MIN_BET ? 'Press Deal (Space) when you\'re ready' : `Add chips to bet (minimum ${money(MIN_BET)})`, W / 2, 380);
    }
    if (state === 'done' && messages[0]) Cards.banner(ctx, W, 220, messages[0], messages[0].startsWith('+') ? '#3ddc84' : messages[0] === 'Push' ? '#ffc53d' : '#ff7a7a');

    toasts = toasts.filter(t => (t.t -= 1 / 60) > 0);
    toasts.forEach((t, i) => pill(W / 2, 160 + i * 30, t.text));

    requestAnimationFrame(frame);
  }

  function pill(x, y, text, on = false, color = '#fff') {
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 24;
    ctx.fillStyle = on ? 'rgba(255,197,61,0.9)' : 'rgba(10,12,16,0.7)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 17, w, 26, 13);
    ctx.fill();
    ctx.fillStyle = on ? '#1c1500' : color;
    ctx.fillText(text, x, y + 1);
  }

  if (Cards.chips() < MIN_BET) Cards.bailout();
  bet = Math.min(lastBet, Cards.chips());
  render();
  ui.show({
    title: 'Blackjack',
    html: `<ul>
      <li>Get closer to <b>21</b> than the dealer without going over. Face cards count 10, aces 1 or 11.</li>
      <li><b>Double</b> your bet for exactly one more card, or <b>split</b> a pair into two hands.</li>
      <li>Chips are pretend and shared with the other card tables. You have <b>${money(Cards.chips())}</b>.</li>
      <li>Cash out any time. Your score is the most chips you held.</li>
    </ul>`,
    button: 'Take a seat',
    onAction: sitDown,
  });
  requestAnimationFrame(frame);
})();
