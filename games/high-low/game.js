(() => {
  const W = 900, H = 560;
  const BETS = [5, 25, 100, 500];
  const EDGE = 0.95;   // payouts are 95% of fair odds, the house's small cut
  const SKIPS = 3;

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);
  const money = Cards.money;

  let state = 'bet';  // bet → guess → done
  let bet = Arcade.load('hilo:bet', 25);
  let pot = 0, streak = 0, skips = SKIPS, current = null, incoming = null, history = [], result = null, busy = false;
  const session = Cards.session();

  // Aces are high. Every card comes from a freshly shuffled deck, so the odds shown are exact.
  const val = c => (c.r === 1 ? 14 : c.r);
  const odds = c => ({ higher: (14 - val(c)) / 13, lower: (val(c) - 2) / 13 });
  const mult = p => (p > 0 ? Math.floor((EDGE / p) * 100) / 100 : 0);
  const nextCard = () => Cards.shoe(1).pop();

  function begin() {
    if (busy || state === 'guess' || bet > Cards.chips()) return;
    Cards.addChips(-bet);
    Arcade.save('hilo:bet', bet);
    pot = bet;
    streak = 0;
    skips = SKIPS;
    history = [];
    result = null;
    current = Cards.place(nextCard(), W / 2 - Cards.W / 2, 220);
    state = 'guess';
    Arcade.tone({ freq: 900, dur: 0.03, vol: 0.02 });
    render();
  }

  function guess(dir) {
    if (state !== 'guess' || busy) return;
    const p = odds(current)[dir];
    if (p <= 0) return;
    busy = true;
    const prev = current;
    const card = incoming = Cards.place(nextCard(), W / 2 - Cards.W / 2, 220, 0, { x: 820, y: 40 });
    setTimeout(() => {
      incoming = null;
      const a = val(prev), b = val(card);
      shiftHistory(prev);
      current = card;
      busy = false;
      if (a === b) {
        result = { text: 'Same rank: push', color: '#ffc53d' };
        Arcade.tone({ freq: 440, dur: 0.1, vol: 0.04 });
      } else if ((dir === 'higher') === (b > a)) {
        pot = Math.floor(pot * mult(p));
        streak++;
        if (streak >= 8) Arcade.flag('high-low-streak');
        result = { text: `Right! Pot ${money(pot)}`, color: '#3ddc84' };
        Arcade.tone({ freq: 523 + streak * 40, to: 784 + streak * 40, dur: 0.15, type: 'triangle', vol: 0.05 });
      } else {
        result = { text: `Wrong. You lose ${money(pot)}`, color: '#ff7a7a' };
        pot = 0;
        state = 'done';
        session.track();
        Arcade.tone({ freq: 300, to: 120, dur: 0.35, type: 'sawtooth', vol: 0.04 });
        if (Cards.chips() < BETS[0]) setTimeout(bust, 900);
      }
      render();
    }, 300);
    render();
  }

  function skip() {
    if (state !== 'guess' || busy || !skips) return;
    skips--;
    shiftHistory(current);
    current = Cards.place(nextCard(), W / 2 - Cards.W / 2, 220);
    result = null;
    render();
  }

  function take() {
    if (state !== 'guess' || busy || !streak) return;
    Cards.addChips(pot);
    session.track();
    result = { text: `Banked ${money(pot)}`, color: '#3ddc84' };
    if (pot - bet >= 1000) Arcade.flag('high-low-big');
    pot = 0;
    state = 'done';
    Arcade.tone({ freq: 523, to: 1046, dur: 0.3, type: 'triangle', vol: 0.06 });
    render();
  }

  function shiftHistory(c) {
    history.unshift(c);
    history.length = Math.min(history.length, 7);
    history.forEach((h, i) => Cards.place(h, 60 + i * 50, 70, 0, { x: h.x, y: h.y }));
  }

  function cashOut() {
    if (state === 'guess' || busy) return;
    session.track();
    Arcade.finish(ui, {
      score: session.peak,
      title: 'Cashed out',
      lines: [`You're holding ${money(Cards.chips())}. Your score is the most chips you held this session.`, 'Chips carry over to Blackjack and Video Poker.'],
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
    if (state !== 'guess') state = current ? 'done' : 'bet';
    ui.hide();
    render();
  }

  // ---------- Controls ----------

  function render() {
    const bar = $('actions');
    const b = (id, label, on, cls = 'secondary') => `<button class="btn ${cls}" type="button" data-a="${id}" ${on ? '' : 'disabled'}>${label}</button>`;
    if (state === 'guess') {
      const o = odds(current);
      bar.innerHTML = b('higher', `Higher ×${mult(o.higher).toFixed(2)} (↑)`, o.higher > 0 && !busy, '') +
        b('lower', `Lower ×${mult(o.lower).toFixed(2)} (↓)`, o.lower > 0 && !busy, '') +
        b('skip', `Skip (${skips})`, skips > 0 && !busy) +
        b('take', `Bank ${money(pot)} (B)`, streak > 0 && !busy);
    } else {
      bar.innerHTML = BETS.map(v => b('bet' + v, money(v), Cards.chips() >= v, v === bet ? '' : 'secondary')).join('') +
        b('start', `Play ${money(bet)} (Space)`, Cards.chips() >= bet, '') + b('cash', 'Cash out', true);
    }
    $('chips').textContent = money(Cards.chips());
    $('pot').textContent = money(pot);
    $('peak').textContent = money(Math.max(session.peak, Cards.chips()));
  }

  $('actions').addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    e.target.blur();
    if (a.startsWith('bet')) { bet = +a.slice(3); render(); }
    else if (a === 'start') begin();
    else if (a === 'cash') cashOut();
    else if (a === 'skip') skip();
    else if (a === 'take') take();
    else guess(a);
  });

  window.addEventListener('keydown', e => {
    if (!$('overlay').hidden) return;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') guess('higher');
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') guess('lower');
    else if (e.code === 'KeyB') take();
    else if (e.code === 'KeyK') skip();
    else if ((e.code === 'Space' || e.code === 'Enter') && state !== 'guess') {
      e.preventDefault();
      begin();
    }
  });

  // ---------- Drawing ----------

  function frame() {
    Cards.felt(ctx, W, H);
    history.forEach(c => Cards.draw(ctx, c, { dim: true }));
    if (history.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('PREVIOUS', 60, 58);
    }
    if (current) Cards.draw(ctx, current, { glow: state === 'guess' && !incoming });
    if (incoming) Cards.draw(ctx, incoming);

    ctx.textAlign = 'center';
    if (state === 'guess') {
      ctx.fillStyle = '#fff';
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillText(`Pot ${money(pot)}`, W / 2, 400);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(streak ? `${streak} in a row · bank it or keep going` : 'Will the next card be higher or lower?', W / 2, 428);
      Cards.chipStack(ctx, W / 2, 490, pot);
    } else if (!current) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillText('Pick a bet and press Play', W / 2, 290);
    }
    if (result) Cards.banner(ctx, W, 190, result.text, result.color);
    requestAnimationFrame(frame);
  }

  if (Cards.chips() < BETS[0]) Cards.bailout();
  render();
  ui.show({
    title: 'High-Low',
    html: `<ul>
      <li>Guess whether the next card is <b>higher</b> or <b>lower</b>. Aces are high.</li>
      <li>Each right guess multiplies your pot. Long shots pay more. A tie is a push.</li>
      <li><b>Bank</b> the pot any time. One wrong guess loses it all.</li>
      <li>Chips are pretend and shared with the other card tables. You have <b>${money(Cards.chips())}</b>.</li>
    </ul>`,
    button: 'Take a seat',
    onAction: sitDown,
  });
  requestAnimationFrame(frame);
})();
