/* Market Mayhem: ninety seconds on the trading floor. Five pretend tickers drift on a random
   walk, and news events jolt them. Buy the dips, sell the spikes, and build a streak of winning
   trades for bonus cash. The score is your closing net worth. */
(() => {
  const W = 880, H = 520, ROUND = 90, QTY = 10, FEE = 0.003;
  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const overlayEl = document.getElementById('overlay');
  const ui = Arcade.overlay(overlayEl);
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();

  const DEFS = [
    { id: 'PXL', name: 'Pixelsoft', color: '#4f8cff', vol: 0.019, start: 100 },
    { id: 'NVA', name: 'Nova Motors', color: '#c77dff', vol: 0.024, start: 84 },
    { id: 'GLD', name: 'Goldline', color: '#ffc53d', vol: 0.013, start: 132 },
    { id: 'ZAP', name: 'Zap Energy', color: '#3ddc84', vol: 0.027, start: 68 },
    { id: 'MOON', name: 'Moonbase Co.', color: '#ff7a8a', vol: 0.033, start: 46 },
  ];
  const GOOD = ['smash earnings', 'announces buyback', 'lands big contract', 'upgrade to buy', 'unveils new product'];
  const BAD = ['misses earnings', 'recall announced', 'loses contract', 'downgrade to sell', 'investigation opened'];

  let state = 'ready';
  let stocks, cash, remaining, tickT, newsT, streak, bestStreak, realized, headlines, message, messageT, selected, hitboxes, tapeX, time, shake;

  function reset() {
    stocks = DEFS.map(d => ({
      ...d, price: d.start, shares: 0, cost: 0, hot: 0, hotT: 0,
      history: Array.from({ length: 30 }, (_, i) => d.start * (1 + Math.sin(i * 0.4 + d.start) * 0.01)),
    }));
    cash = 2000;
    remaining = ROUND;
    tickT = 0;
    newsT = 7;
    streak = 0;
    bestStreak = 0;
    realized = 0;
    headlines = [{ text: 'Market open · 90 seconds on the clock', t: 0 }];
    message = 'Buy low, sell high. News moves prices fast.';
    messageT = 3;
    selected = 0;
    hitboxes = [];
    tapeX = W;
    time = 0;
    shake = 0;
    updateHud();
  }

  const holdings = () => stocks.reduce((t, s) => t + s.shares * s.price, 0);
  const netWorth = () => Math.round(cash + holdings());

  function flash(text) {
    message = text;
    messageT = 2.2;
  }

  function marketTick() {
    for (const s of stocks) {
      const drift = s.hot ? s.hot * 0.004 : 0;
      const noise = (Math.random() * 2 - 1) * s.vol;
      const pullBack = s.price > s.start * 1.6 ? 0.0022 : 0;
      s.price = Math.max(4, s.price * (1 + drift + noise - pullBack));
      s.price = Math.round(s.price * 100) / 100;
      s.history.push(s.price);
      if (s.history.length > 260) s.history.shift();
      if (s.hotT > 0) {
        s.hotT -= 0.35;
        if (s.hotT <= 0) s.hot = 0;
      }
    }
  }

  function marketNews() {
    const s = pick(stocks);
    const good = Math.random() < 0.58;
    const jump = good ? rand(0.04, 0.09) : -rand(0.04, 0.09);
    s.price = Math.max(4, s.price * (1 + jump));
    s.hot = good ? 1 : -1;
    s.hotT = 8;
    const text = `${s.id} ${good ? pick(GOOD) : pick(BAD)} · ${jump > 0 ? '+' : ''}${(jump * 100).toFixed(1)}%`;
    headlines.unshift({ text, t: 0 });
    headlines = headlines.slice(0, 4);
    flash(text);
    Arcade.tone({ freq: good ? 660 : 300, to: good ? 990 : 220, dur: 0.2, type: 'triangle', vol: 0.04 });
  }

  function buy(i) {
    if (state !== 'playing') return;
    const s = stocks[i];
    const cost = s.price * QTY * (1 + FEE);
    if (cash < cost) return flash(`Not enough cash for ${QTY} ${s.id}`);
    cash -= cost;
    s.shares += QTY;
    s.cost += cost;
    flash(`Bought ${QTY} ${s.id} at $${s.price.toFixed(2)}`);
    Arcade.tone({ freq: 520, to: 700, dur: 0.1, type: 'triangle', vol: 0.04 });
  }

  function sell(i) {
    if (state !== 'playing') return;
    const s = stocks[i];
    if (s.shares < QTY) return flash(`You hold ${s.shares} ${s.id}, need ${QTY}`);
    const gross = s.price * QTY * (1 - FEE);
    const avg = s.cost / s.shares;
    const pnl = gross - avg * QTY;
    cash += gross;
    s.shares -= QTY;
    s.cost = Math.max(0, s.cost - avg * QTY);
    realized += pnl;
    if (pnl >= 0) {
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      const bonus = Math.min(60, streak * 10);
      cash += bonus;
      flash(`Sold ${QTY} ${s.id} · +${money(pnl)} · streak ${streak} (+${money(bonus)})`);
      Arcade.tone({ freq: 660 + Math.min(400, streak * 60), to: 1180, dur: 0.16, type: 'triangle', vol: 0.05 });
      if (streak >= 5) Arcade.flag('market-mayhem-streak');
    } else {
      streak = 0;
      flash(`Sold ${QTY} ${s.id} · ${money(pnl)}`);
      Arcade.tone({ freq: 320, to: 180, dur: 0.18, type: 'sawtooth', vol: 0.04 });
    }
    updateHud();
  }

  function closeMarket() {
    if (state !== 'playing') return;
    state = 'over';
    const worth = netWorth();
    if (worth >= 4000) Arcade.flag('market-mayhem-double');
    Arcade.tone({ freq: 523, dur: 0.2, type: 'triangle', vol: 0.06 });
    Arcade.tone({ freq: 784, dur: 0.3, type: 'triangle', vol: 0.06, delay: 0.15 });
    setTimeout(() => Arcade.finish(ui, {
      score: worth,
      title: worth >= 4000 ? 'Bull market!' : 'Market closed',
      lines: [
        `Cash ${money(cash)} · shares ${money(holdings())}`,
        `Realised ${money(realized)} · best winning streak ${bestStreak}`,
      ],
      onAction: start,
    }), 500);
  }

  function update(dt) {
    time += dt;
    if (messageT > 0) messageT -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 30);
    tapeX -= dt * 42;
    const tapeWidth = headlines.reduce((t, h) => t + h.text.length * 8 + 60, 0);
    if (tapeX < -tapeWidth) tapeX = W;
    if (state !== 'playing') return;

    remaining -= dt;
    if (remaining <= 0) {
      remaining = 0;
      updateHud();
      return closeMarket();
    }
    tickT -= dt;
    while (tickT <= 0) {
      tickT += 0.35;
      marketTick();
    }
    newsT -= dt;
    if (newsT <= 0) {
      newsT = rand(9, 14);
      marketNews();
    }
    updateHud();
  }

  // ---------- Drawing ----------

  function panel(x, y, w, h, active = false) {
    ctx.fillStyle = active ? 'rgba(255,197,61,0.08)' : 'rgba(255,255,255,0.035)';
    ctx.strokeStyle = active ? 'rgba(255,197,61,0.7)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = active ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();
  }

  function sparkline(s, x, y, w, h) {
    const data = s.history.slice(-40);
    const lo = Math.min(...data), hi = Math.max(...data), range = hi - lo || 1;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    data.forEach((p, i) => {
      const px = x + (i / Math.max(1, data.length - 1)) * w;
      const py = y + h - ((p - lo) / range) * h;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  }

  function button(x, y, w, h, label, color, enabled) {
    ctx.globalAlpha = enabled ? 1 : 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 7);
    ctx.fill();
    ctx.fillStyle = '#08110b';
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }

  function drawChart() {
    const s = stocks[selected];
    const x = 16, y = 92, w = 380, h = 340;
    panel(x, y, w, h, true);
    const data = s.history.slice(-150);
    const open = data[0];
    const change = ((s.price - open) / open) * 100;
    const up = change >= 0;
    const lo = Math.min(...data), hi = Math.max(...data), range = hi - lo || 1;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '900 22px system-ui, sans-serif';
    ctx.fillText(s.id, x + 18, y + 34);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(s.name.toUpperCase(), x + 18, y + 50);

    ctx.textAlign = 'right';
    ctx.fillStyle = s.color;
    ctx.font = '900 26px system-ui, sans-serif';
    ctx.fillText(`$${s.price.toFixed(2)}`, x + w - 18, y + 36);
    ctx.fillStyle = up ? '#3ddc84' : '#ff5d5e';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(`${up ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}% this session`, x + w - 18, y + 52);

    // Chart body.
    const cx = x + 18, cy = y + 76, cw = w - 36, ch = h - 158;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gy = cy + (ch / 4) * i;
      ctx.beginPath();
      ctx.moveTo(cx, gy);
      ctx.lineTo(cx + cw, gy);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`$${(hi - (range / 4) * i).toFixed(0)}`, cx + 4, gy - 3);
    }
    const grad = ctx.createLinearGradient(0, cy, 0, cy + ch);
    grad.addColorStop(0, `${s.color}66`);
    grad.addColorStop(1, `${s.color}00`);
    ctx.beginPath();
    data.forEach((p, i) => {
      const px = cx + (i / Math.max(1, data.length - 1)) * cw;
      const py = cy + ch - ((p - lo) / range) * ch;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.lineTo(cx + cw, cy + ch);
    ctx.lineTo(cx, cy + ch);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((p, i) => {
      const px = cx + (i / Math.max(1, data.length - 1)) * cw;
      const py = cy + ch - ((p - lo) / range) * ch;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();

    // Your position.
    const avg = s.shares ? s.cost / s.shares : 0;
    const value = s.shares * s.price;
    const pnl = value - s.cost;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('POSITION', cx, cy + ch + 26);
    ctx.fillStyle = '#fff';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillText(`${s.shares} shares · ${money(value)}`, cx, cy + ch + 46);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(s.shares ? `Avg cost $${avg.toFixed(2)}` : 'No position yet', cx, cy + ch + 63);
    if (s.shares) {
      ctx.textAlign = 'right';
      ctx.fillStyle = pnl >= 0 ? '#3ddc84' : '#ff5d5e';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.fillText(`${pnl >= 0 ? '+' : ''}${money(pnl)}`, cx + cw, cy + ch + 46);
    }
    ctx.textAlign = 'left';
  }

  function draw() {
    const sx = shake ? rand(-shake, shake) : 0, sy = shake ? rand(-shake, shake) : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#080d12';
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.25, 0, 10, W * 0.25, 0, 500);
    glow.addColorStop(0, 'rgba(60,110,200,0.12)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(sx, sy);

    // Header numbers.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText('CLOSING NET WORTH', 18, 24);
    ctx.fillStyle = '#ffd25e';
    ctx.font = '900 30px system-ui, sans-serif';
    ctx.fillText(money(netWorth()), 18, 52);

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText('CASH', W / 2 - 110, 24);
    ctx.fillStyle = '#fff';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillText(money(cash), W / 2 - 110, 46);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText('WIN STREAK', W / 2 + 20, 24);
    ctx.fillStyle = streak >= 3 ? '#ffd25e' : '#fff';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillText(String(streak), W / 2 + 20, 46);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText('TIME LEFT', W - 18, 24);
    ctx.fillStyle = remaining < 15 ? '#ff5d5e' : '#fff';
    ctx.font = '900 26px system-ui, sans-serif';
    ctx.fillText(`${Math.ceil(remaining)}s`, W - 18, 52);

    // News tape.
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, 66, W, 22);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 66, W, 22);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.font = '700 11px system-ui, sans-serif';
    let tx = tapeX;
    for (const h of headlines) {
      ctx.fillStyle = /[-]/.test(h.text.split('·')[1] || '') ? '#ff8a8a' : '#8fe3b0';
      ctx.fillText(h.text, tx, 81);
      tx += h.text.length * 7 + 60;
    }
    ctx.restore();

    drawChart();

    // Stock list.
    hitboxes = [];
    stocks.forEach((s, i) => {
      const x = 412, y = 92 + i * 64, w = 452, h = 56;
      panel(x, y, w, h, i === selected);
      ctx.textAlign = 'left';
      ctx.fillStyle = s.color;
      ctx.font = '900 17px system-ui, sans-serif';
      ctx.fillText(s.id, x + 14, y + 25);
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillText(`${s.shares} sh · ${money(s.shares * s.price)}`, x + 14, y + 41);

      sparkline(s, x + 82, y + 15, 88, 26);

      const open = s.history[s.history.length - 30] || s.price;
      const chg = ((s.price - open) / open) * 100;
      ctx.fillStyle = '#fff';
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`$${s.price.toFixed(2)}`, x + 256, y + 25);
      ctx.fillStyle = chg >= 0 ? '#3ddc84' : '#ff5d5e';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.fillText(`${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`, x + 256, y + 41);

      const canSell = s.shares >= QTY;
      const canBuy = cash >= s.price * QTY * (1 + FEE);
      button(x + 268, y + 13, 52, 30, 'BUY', '#3ddc84', canBuy && state === 'playing');
      button(x + 326, y + 13, 52, 30, 'SELL', '#ff5d5e', canSell && state === 'playing');
      hitboxes.push({ x: x + 268, y: y + 13, w: 52, h: 30, fn: () => buy(i) });
      hitboxes.push({ x: x + 326, y: y + 13, w: 52, h: 30, fn: () => sell(i) });
      hitboxes.push({ x, y, w: 250, h, fn: () => { selected = i; Arcade.tone({ freq: 600, dur: 0.05, vol: 0.03 }); } });
    });

    // Footer.
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(16, 444);
    ctx.lineTo(W - 16, 444);
    ctx.stroke();
    ctx.textAlign = 'left';
    if (messageT > 0) {
      ctx.globalAlpha = clamp(messageT / 0.4, 0, 1);
      ctx.fillStyle = /^-|Not enough|need/.test(message) ? '#ff8a8a' : '#9be37a';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(message, 18, 468);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('Click a ticker or press 1–5 · B buys 10 shares · S sells 10 · news shocks move prices fast', 18, 492);

    ctx.restore();
  }

  function updateHud() {
    $('score').textContent = money(netWorth());
    $('cash').textContent = money(cash);
    $('clock').textContent = `${Math.max(0, Math.ceil(remaining))}s`;
  }

  // ---------- Input ----------

  const uiOpen = () => !overlayEl.hidden;
  canvas.addEventListener('pointerdown', e => {
    if (uiOpen() || state !== 'playing') return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    for (let i = hitboxes.length - 1; i >= 0; i--) {
      const b = hitboxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return; }
    }
  });

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') { state = 'paused'; ui.show({ title: 'Paused', html: `<p>${money(netWorth())} net worth · ${Math.ceil(remaining)}s left</p>`, button: 'Resume', onAction: resume }); }
      else if (state === 'paused') resume();
      return;
    }
    if (uiOpen() || state !== 'playing') return;
    if (/^Digit[1-5]$/.test(e.code)) {
      selected = Number(e.code.slice(5)) - 1;
      Arcade.tone({ freq: 600, dur: 0.05, vol: 0.03 });
    }
    if (e.code === 'KeyB') buy(selected);
    if (e.code === 'KeyS') sell(selected);
  });
  function resume() { state = 'playing'; ui.hide(); }
  Arcade.onBlur(() => { if (state === 'playing') { state = 'paused'; ui.show({ title: 'Paused', button: 'Resume', onAction: resume }); } });

  function start() {
    reset();
    state = 'playing';
    ui.hide();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  Versus.attach({
    ui,
    start,
    score: () => netWorth(),
    intro: {
      title: 'Market Mayhem',
      html: `<ul>
        <li>You have <b>$2,000</b> and <b>90 seconds</b>. Your score is your closing net worth.</li>
        <li>Click a ticker to chart it, then <b>Buy</b> or <b>Sell</b> 10 shares. Keys <b>1–5</b>, <b>B</b> and <b>S</b> work too.</li>
        <li>Prices drift and <b>news shocks</b> move one stock hard. Buy before a jump, sell into it.</li>
        <li>Profitable sells build a <b>win streak</b> that pays bonus cash. Fees are 0.3%.</li>
      </ul>`,
      button: 'Open the market',
      onAction: start,
    },
  });
  requestAnimationFrame(frame);
})();
