/* Shared bits for the card tables (Blackjack, Video Poker, High-Low): a chip wallet that carries
   between them, a shuffled shoe, and card drawing with a deal animation. Chips are pretend
   money; they can't be bought and are worth nothing outside the arcade. */
const Cards = (() => {
  const START = 1000, BAILOUT = 500;
  const SUITS = ['♠', '♥', '♦', '♣'];
  const NAMES = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  const W = 78, H = 110;

  // ---------- Chips ----------

  const chips = () => Arcade.load('chips', START);
  const setChips = n => Arcade.save('chips', Math.max(0, Math.round(n)));
  const addChips = n => setChips(chips() + n);
  const money = n => '$' + Math.round(n).toLocaleString();

  // A session runs from sitting down to cashing out; its score is the most chips you held.
  function session() {
    let peak = chips();
    return {
      track() { peak = Math.max(peak, chips()); },
      get peak() { return peak; },
      reset() { peak = chips(); },
    };
  }

  // Broke players get a fresh stack so nobody is ever locked out.
  function bailout() {
    setChips(BAILOUT);
    return BAILOUT;
  }

  // ---------- Deck ----------

  // r: 1 (ace) to 13 (king); s: 0-3. `decks` shoes are shuffled with Fisher-Yates.
  function shoe(decks = 1) {
    const out = [];
    for (let d = 0; d < decks; d++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) out.push({ r, s });
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  const rankName = r => NAMES[r] || String(r);
  const red = c => c.s === 1 || c.s === 2;
  const label = c => rankName(c.r) + SUITS[c.s];

  // ---------- Drawing ----------

  // Cards fly in from `from` to (x, y) after `delay` seconds, flipping face-up on arrival.
  function place(card, x, y, delay = 0, from = { x: 820, y: 40 }) {
    card.x = x;
    card.y = y;
    card.from = from;
    card.at = performance.now() + delay * 1000;
    return card;
  }

  function draw(ctx, card, { faceDown = false, lift = 0, glow = false, dim = false } = {}) {
    const now = performance.now();
    const k = Math.min(1, Math.max(0, (now - (card.at || 0)) / 260));
    if (now < (card.at || 0)) return false;
    const e = 1 - Math.pow(1 - k, 3);
    const x = card.from ? card.from.x + (card.x - card.from.x) * e : card.x;
    const y = (card.from ? card.from.y + (card.y - card.from.y) * e : card.y) - lift;
    const down = faceDown || k < 1;
    ctx.save();
    ctx.globalAlpha = dim ? 0.45 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 4, W, H, 8);
    ctx.fill();
    if (glow) {
      ctx.shadowColor = '#ffc53d';
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = down ? '#2a5bd7' : '#fbfbf8';
    ctx.beginPath();
    ctx.roundRect(x, y, W, H, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (down) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x + 6, y + 6, W - 12, H - 12, 5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < 6; i++) for (let j = 0; j < 9; j++) if ((i + j) % 2) ctx.fillRect(x + 10 + i * 10, y + 10 + j * 10, 10, 10);
    } else {
      ctx.fillStyle = red(card) ? '#d43b3b' : '#1b1e24';
      ctx.textAlign = 'left';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText(rankName(card.r), x + 7, y + 24);
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText(SUITS[card.s], x + 7, y + 44);
      ctx.textAlign = 'center';
      ctx.font = card.r > 10 ? '700 34px system-ui, sans-serif' : '40px system-ui, sans-serif';
      ctx.fillText(card.r > 10 ? rankName(card.r) : SUITS[card.s], x + W / 2 + 6, y + H / 2 + 22);
    }
    if (glow) {
      ctx.strokeStyle = '#ffc53d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(x, y, W, H, 8);
      ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  // Green felt with a soft spotlight, used by every table.
  function felt(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h * 0.45, 40, w / 2, h * 0.45, w * 0.7);
    g.addColorStop(0, '#1f7a4a');
    g.addColorStop(1, '#0f3f27');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(14, 14, w - 28, h - 28, 24);
    ctx.stroke();
  }

  function chipStack(ctx, x, y, amount) {
    if (amount <= 0) return;
    const colors = [[500, '#7a3cff'], [100, '#1b1e24'], [25, '#1f9d55'], [10, '#2a5bd7'], [5, '#d43b3b'], [1, '#e8e8e8']];
    let left = amount, n = 0;
    for (const [v, col] of colors) {
      while (left >= v && n < 12) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(x, y - n * 4 + 2, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.ellipse(x, y - n * 4, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        left -= v;
        n++;
      }
    }
    ctx.fillStyle = '#fff';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(money(amount), x, y + 26);
  }

  function banner(ctx, w, y, text, color = '#ffc53d') {
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width + 40;
    ctx.fillStyle = 'rgba(10,12,16,0.75)';
    ctx.beginPath();
    ctx.roundRect(w / 2 - tw / 2, y - 30, tw, 44, 12);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, y);
  }

  return { W, H, SUITS, chips, setChips, addChips, money, session, bailout, shoe, rankName, label, red, place, draw, felt, chipStack, banner };
})();
