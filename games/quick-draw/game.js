(() => {
  const W = 800, H = 480;
  const GROUND = 380;
  const COLORS = ['#ffc53d', '#4f8cff'];
  const FAKES = ['DRAT!', 'DRAWL', 'DREW!', 'DRAW?', 'CLAW!', 'BRAWL', '🐦'];
  const OUTLAWS = [
    { name: 'Dusty Pete', ms: 560, fakes: 0, slip: 0.15 },
    { name: 'Cactus Kate', ms: 500, fakes: 1, slip: 0.12 },
    { name: 'Tumbleweed Tom', ms: 450, fakes: 1, slip: 0.1 },
    { name: 'Rattlesnake Rita', ms: 400, fakes: 2, slip: 0.08 },
    { name: 'Six-Gun Sam', ms: 360, fakes: 2, slip: 0.05 },
    { name: 'Lightning Lou', ms: 320, fakes: 3, slip: 0.04 },
    { name: 'The Dust Devil', ms: 290, fakes: 3, slip: 0.02 },
    { name: 'Midnight Max', ms: 265, fakes: 4, slip: 0 },
  ];
  const ROUNDS_TO_WIN = 2, ONLINE_ROUNDS = 3;
  const LATE = 1.5; // seconds after DRAW before a round is called

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let mode = null, me = 0, names = ['You', 'Outlaw'];
  let phase = 'menu';        // 'menu' | 'round' | 'between' | 'over'
  let r = null;              // the current round
  let wins, outlaw, score, best, betweenT, flash = 0, dust = [];

  // ---------- Rounds ----------

  // A round's script: when DRAW appears, and the fake signs before it.
  function script(fakes) {
    const draw = 2.4 + Math.random() * 3;
    const list = [];
    for (let k = 0; k < fakes; k++) {
      const at = 1.4 + Math.random() * (draw - 1.9);
      if (list.every(f => Math.abs(f.at - at) > 0.6)) list.push({ at, text: FAKES[Math.floor(Math.random() * FAKES.length)] });
    }
    return { draw, fakes: list.sort((a, b) => a.at - b.at) };
  }

  function beginRound(s) {
    r = { t: 0, draw: s.draw, fakes: s.fakes, res: [null, null], done: false, loser: -1 };
    phase = 'round';
    if (mode === 'cpu') {
      const o = OUTLAWS[outlaw];
      const fooled = s.fakes.length && Math.random() < o.slip;
      r.bot = fooled ? { at: s.fakes[0].at + 0.15, foul: true } : { at: s.draw + (o.ms * Arcade.rand(0.85, 1.2)) / 1000 };
    }
    updateHud();
  }

  const sign = () => {
    if (!r) return '';
    if (r.t < 1) return 'Ready…';
    if (r.t >= r.draw) return 'DRAW!';
    const f = r.fakes.find(f => r.t >= f.at && r.t < f.at + 0.45);
    return f ? f.text : 'Steady…';
  };

  // A player pulls the trigger: early is a foul, otherwise the reaction time counts.
  function shoot(i) {
    if (phase !== 'round' || r.done || r.res[i] !== null) return;
    const res = r.t < r.draw ? 'foul' : Math.round((r.t - r.draw) * 1000);
    r.res[i] = res;
    Arcade.tone(res === 'foul' ? { freq: 180, dur: 0.15, type: 'square', vol: 0.04 } : { freq: 90, to: 40, dur: 0.25, type: 'sawtooth', vol: 0.08 });
    if (res !== 'foul') { flash = 0.12; dust.push({ x: i === 0 ? 250 : 550, y: GROUND - 70, t: 0 }); }
    if (mode === 'online') {
      Match.move({ k: 'shot', v: res });
      if (me === 0) decide();
    } else decide();
  }

  // Lower time wins; a foul loses unless both fouled (then it's replayed). Offline this runs
  // locally; online the host calls it once both results are in, or time runs out.
  function decide(force = false) {
    const [a, b] = r.res;
    const ready = (a !== null && b !== null) || force || a === 'foul' || b === 'foul' ||
      (typeof a === 'number' && typeof b !== 'number' && r.t > r.draw + LATE) ||
      (typeof b === 'number' && typeof a !== 'number' && r.t > r.draw + LATE);
    if (!ready || r.done) return;
    let w;
    if (a === 'foul' && b === 'foul') w = -1;
    else if (a === 'foul') w = 1;
    else if (b === 'foul') w = 0;
    else if (a === null && b === null) w = -1;
    else if (a === null) w = 1;
    else if (b === null) w = 0;
    else w = a <= b ? 0 : 1;
    if (mode === 'online') Match.move({ k: 'res', w, v: r.res });
    settle(w);
  }

  function settle(w) {
    r.done = true;
    r.winner = w;
    r.loser = w === -1 ? -1 : 1 - w;
    if (w >= 0) wins[w]++;
    const mine = mode === 'online' ? me : 0;
    if (typeof r.res[mine] === 'number' && r.res[mine] < 200 && w === mine && mode !== 'local') Arcade.flag('quick-draw-200');
    if (mode === 'cpu' && w === 0) score += typeof r.res[0] === 'number' ? Math.max(50, 600 - r.res[0]) : 100;
    if (typeof r.res[mine] === 'number' && w === mine) best = Math.min(best, r.res[mine]);
    phase = 'between';
    betweenT = 2.2;
    updateHud();
  }

  function next() {
    const target = mode === 'cpu' ? ROUNDS_TO_WIN : ONLINE_ROUNDS;
    if (mode === 'cpu') {
      if (wins[0] >= target) {
        score += 300 * (outlaw + 1);
        outlaw++;
        if (outlaw >= OUTLAWS.length) return ladderOver(true);
        wins = [0, 0];
        names[1] = OUTLAWS[outlaw].name;
        Arcade.tone({ freq: 523, to: 1046, dur: 0.4, type: 'triangle', vol: 0.06 });
      } else if (wins[1] >= target) return ladderOver(false);
      return beginRound(script(OUTLAWS[outlaw].fakes));
    }
    if (Math.max(...wins) >= target) {
      phase = 'over';
      return Match.over({ winner: wins[0] > wins[1] ? 0 : 1, lines: [`Rounds ${wins[0]} – ${wins[1]}${best < Infinity ? ` · your best ${best} ms` : ''}`] });
    }
    if (mode === 'local') return beginRound(script(2));
    if (me === 0) hostRound();
  }

  function hostRound() {
    const s = script(2);
    Match.move({ k: 'go', s, w: wins });
    beginRound(s);
  }

  function ladderOver(cleared) {
    phase = 'over';
    if (cleared) Arcade.flag('quick-draw-ladder');
    Arcade.finish(ui, {
      score,
      title: cleared ? 'Fastest in the West!' : `${OUTLAWS[outlaw].name} wins`,
      lines: [cleared ? 'You beat every outlaw in town.' : `You beat ${outlaw} outlaw${outlaw === 1 ? '' : 's'}.`, best < Infinity ? `Your quickest draw: ${best} ms` : ''].filter(Boolean),
      button: 'Menu',
      onAction: () => Match.menu(),
    });
  }

  Match.setup({
    ui,
    tag: 'quickdraw',
    title: 'Quick Draw',
    levels: ['Take on the outlaws'],
    onlineWinFlag: 'quick-draw-online-win',
    rules: `<ul>
      <li>Wait for the sign to say <b>DRAW!</b>, then press <b>Space</b>, click, or tap. Fastest shot wins the round.</li>
      <li>Fire early and it's a <b>foul</b>. Watch out for fake signs like <b>DRAT!</b> and <b>DRAWL</b>.</li>
      <li>Solo: beat eight outlaws in a row, each faster and trickier than the last. Two players on one device: <b>A</b> versus <b>L</b>.</li>
    </ul>`,
    onStart: s => {
      mode = s.mode;
      me = s.me;
      wins = [0, 0];
      best = Infinity;
      score = 0;
      outlaw = 0;
      dust = [];
      names = mode === 'cpu' ? ['You', OUTLAWS[0].name] : s.names;
      if (mode === 'cpu') beginRound(script(OUTLAWS[0].fakes));
      else if (mode === 'local') beginRound(script(2));
      else if (me === 0) hostRound();
      else { phase = 'between'; betweenT = Infinity; r = null; }
    },
    onMove: d => {
      if (d.k === 'go' && me === 1) {
        wins = d.w || wins;
        beginRound(d.s);
      } else if (d.k === 'shot' && r && !r.done) {
        r.res[1 - me] = d.v === 'foul' ? 'foul' : Math.max(0, d.v | 0);
        if (d.v !== 'foul') { flash = 0.12; dust.push({ x: me === 0 ? 550 : 250, y: GROUND - 70, t: 0 }); }
        if (me === 0) decide();
      } else if (d.k === 'res' && me === 1 && r && !r.done) {
        r.res = [d.v?.[0] ?? null, d.v?.[1] ?? null];
        settle(d.w);
      }
    },
    onStop: () => { phase = 'over'; },
  });

  function updateHud() {
    const mine = mode === 'local' ? 0 : me;
    $('you').textContent = wins ? wins[mine] : 0;
    $('them').textContent = wins ? wins[1 - mine] : 0;
    $('foe').textContent = mode === 'cpu' ? `${outlaw + 1}/${OUTLAWS.length}` : '-';
  }

  // ---------- Input ----------

  window.addEventListener('keydown', e => {
    if (!$('overlay').hidden || e.repeat) return;
    if (mode === 'local') {
      if (e.code === 'KeyA') shoot(0);
      else if (e.code === 'KeyL') shoot(1);
    } else if (e.code === 'Space' || e.code === 'Enter') shoot(mode === 'online' ? me : 0);
  });
  canvas.addEventListener('pointerdown', e => {
    if (mode === 'local') {
      const rect = canvas.getBoundingClientRect();
      shoot(e.clientX - rect.left < rect.width / 2 ? 0 : 1);
    } else shoot(mode === 'online' ? me : 0);
  });

  // ---------- Loop ----------

  function update(dt) {
    if (phase === 'round') {
      r.t += dt;
      if (mode === 'cpu' && r.res[1] === null && r.t >= r.bot.at) {
        r.res[1] = r.bot.foul ? 'foul' : Math.round((r.t - r.draw) * 1000);
        if (!r.bot.foul) { flash = 0.12; dust.push({ x: 550, y: GROUND - 70, t: 0 }); Arcade.tone({ freq: 90, to: 40, dur: 0.25, type: 'sawtooth', vol: 0.08 }); }
        decide();
      }
      if (sign() === 'DRAW!' && !r.rang) { r.rang = true; Arcade.tone({ freq: 1200, dur: 0.08, type: 'square', vol: 0.05 }); }
      if (r.t > r.draw + LATE && (mode !== 'online' || me === 0)) decide(true);
    } else if (phase === 'between') {
      betweenT -= dt;
      if (betweenT <= 0) next();
    }
    flash = Math.max(0, flash - dt);
  }

  // ---------- Drawing ----------

  function gunslinger(x, face, color, down, shot) {
    ctx.save();
    ctx.translate(x, GROUND);
    if (down) ctx.rotate(face * -1.3 * Math.min(1, down));
    ctx.fillStyle = '#16100b';
    ctx.fillRect(-9, -46, 7, 46);
    ctx.fillRect(2, -46, 7, 46);
    ctx.fillRect(-13, -92, 26, 48);
    ctx.beginPath(); ctx.arc(0, -104, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-22, -116, 44, 5);
    ctx.fillRect(-11, -132, 22, 18);
    ctx.fillStyle = color;
    ctx.fillRect(-11, -117, 22, 3);
    ctx.fillStyle = '#16100b';
    if (shot) ctx.fillRect(face > 0 ? 8 : -36, -84, 28, 6);
    else ctx.fillRect(face > 0 ? 8 : -14, -82, 6, 30);
    ctx.restore();
  }

  function draw(dt) {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, '#2b1b3d');
    g.addColorStop(0.55, '#c4553a');
    g.addColorStop(1, '#f2a65a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND);
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath(); ctx.arc(W / 2, GROUND - 10, 70, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#3a2418';
    ctx.beginPath();
    ctx.moveTo(0, GROUND - 40); ctx.lineTo(90, GROUND - 90); ctx.lineTo(160, GROUND - 60); ctx.lineTo(240, GROUND - 100); ctx.lineTo(300, GROUND - 40);
    ctx.lineTo(520, GROUND - 40); ctx.lineTo(600, GROUND - 110); ctx.lineTo(690, GROUND - 70); ctx.lineTo(W, GROUND - 95); ctx.lineTo(W, GROUND); ctx.lineTo(0, GROUND);
    ctx.fill();
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(0, GROUND, W, H - GROUND);

    const shotBy = i => r && typeof r.res[i] === 'number';
    const downT = i => (r?.done && r.loser === i ? Math.min(1, (2.2 - betweenT) * 3) : 0);
    gunslinger(250, 1, COLORS[0], downT(0), shotBy(0));
    gunslinger(550, -1, COLORS[1], downT(1), shotBy(1));

    for (const d of dust) {
      d.t += dt;
      ctx.globalAlpha = Math.max(0, 1 - d.t * 2);
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath(); ctx.arc(d.x + (d.x < W / 2 ? 40 : -40), d.y - 12, 10 + d.t * 30, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    dust = dust.filter(d => d.t < 0.5);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 3})`;
      ctx.fillRect(0, 0, W, H);
    }

    // The sign
    if (r || phase === 'between') {
      const text = phase === 'round' ? sign() : r?.done ? (r.winner === -1 ? 'Draw again!' : (mode === 'cpu' && r.winner === 0) || (mode === 'online' && r.winner === me) ? 'You win the round' : `${names[r.winner]} wins the round`) : 'Get ready…';
      const isDraw = text === 'DRAW!';
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(W / 2 - 4, 140, 8, 60);
      ctx.fillStyle = isDraw ? '#ff5f3d' : '#e7c48f';
      ctx.beginPath(); ctx.roundRect(W / 2 - 170, 62, 340, 86, 8); ctx.fill();
      ctx.strokeStyle = '#6b4226';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = isDraw ? '#fff' : '#3a2418';
      ctx.font = `900 ${text.length > 12 ? 24 : 46}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText(text, W / 2, 120);
    }

    // Names and reaction times
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    [250, 550].forEach((x, i) => {
      ctx.fillStyle = COLORS[i];
      ctx.fillText(names[i] + (mode === 'local' ? (i ? ' (L)' : ' (A)') : ''), x, GROUND + 30);
      const v = r?.res[i];
      if (v !== null && v !== undefined && (r.done || mode !== 'online' || i === me)) {
        ctx.fillStyle = v === 'foul' ? '#ff7a7a' : '#fff';
        ctx.font = '800 20px system-ui, sans-serif';
        ctx.fillText(v === 'foul' ? 'FOUL' : `${v} ms`, x, GROUND + 58);
        ctx.font = '700 15px system-ui, sans-serif';
      }
    });
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(Match.label() || (mode === 'cpu' ? `Score ${score.toLocaleString()}` : ''), W / 2, H - 10);
  }

  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (phase !== 'menu' && phase !== 'over') update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
