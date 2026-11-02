/* Shared pieces for the sports games: stadium sound (crowd, whistles, hits, cheers), particle
   effects (confetti, dust, sparks, ice spray), screen shake, and animated crowds for the stands.
   Everything is synthesized or drawn; there are no files to load. Follows the arcade mute button. */
const Sports = (() => {
  const TAU = Math.PI * 2;

  // ---------- Sound ----------

  let ac = null, master = null, noiseBuf = null, crowd = null, crowdWanted = false;
  const muted = () => Arcade.load('muted', false);

  function ensure() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted() ? 0 : 0.8;
    master.connect(ac.createDynamicsCompressor()).connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  // Browsers only allow audio after a gesture, so the crowd starts on the first tap or key.
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, () => { if (ensure() && crowdWanted && !crowd) startCrowd(); }, { capture: true });
  }
  document.addEventListener('click', e => {
    if (!e.target.closest?.('#mute')) return;
    setTimeout(() => { if (master) master.gain.setTargetAtTime(muted() ? 0 : 0.8, ac.currentTime, 0.05); }, 0);
  });

  function tone(freq, { to = freq, dur = 0.12, type = 'square', vol = 0.1, delay = 0 } = {}) {
    if (!ac || muted()) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(dur, { vol = 0.12, from = 2000, to = 300, type = 'lowpass', q = 1, delay = 0, attack = 0.005 } = {}) {
    if (!ac || muted()) return;
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // Crowd murmur: band-passed noise with a slow swell. excite() makes it roar for a moment.
  function startCrowd() {
    crowdWanted = true;
    if (!ac || crowd || muted()) return;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.6;
    g.gain.value = 0.025;
    lfo.frequency.value = 0.15;
    lg.gain.value = 0.008;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(master);
    src.start();
    lfo.start();
    crowd = { src, f, g, lfo };
  }
  function stopCrowd() {
    crowdWanted = false;
    if (!crowd) return;
    const c = crowd;
    crowd = null;
    c.g.gain.setTargetAtTime(0, ac.currentTime, 0.2);
    setTimeout(() => { c.src.stop(); c.lfo.stop(); }, 800);
  }
  function excite(level = 1, secs = 2.5) {
    if (!crowd) return;
    const t = ac.currentTime, g = crowd.g.gain, f = crowd.f.frequency;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.025 + 0.09 * level, t, 0.08);
    g.setTargetAtTime(0.025, t + secs * 0.5, secs * 0.35);
    f.cancelScheduledValues(t);
    f.setTargetAtTime(1100, t, 0.1);
    f.setTargetAtTime(700, t + secs * 0.5, secs * 0.35);
  }

  const lastAt = {};
  const limited = (key, gap, fn) => (...a) => {
    const now = performance.now();
    if (now - (lastAt[key] || 0) < gap) return;
    lastAt[key] = now;
    fn(...a);
  };

  const sfx = {
    whistle: (long = false) => {
      tone(2600, { to: 2500, dur: long ? 0.6 : 0.25, type: 'sine', vol: 0.07 });
      tone(2750, { to: 2700, dur: long ? 0.6 : 0.25, type: 'sine', vol: 0.04 });
      if (long) { tone(2600, { dur: 0.25, type: 'sine', vol: 0.07, delay: 0.75 }); }
    },
    horn: () => { for (const f of [220, 277, 330]) tone(f, { dur: 1.1, type: 'sawtooth', vol: 0.05 }); },
    buzzer: () => tone(150, { dur: 0.9, type: 'square', vol: 0.06 }),
    cheer: (big = 1) => { noise(1.6 + big, { vol: 0.12 * big, from: 1400, to: 900, type: 'bandpass', q: 0.5, attack: 0.15 }); excite(big, 2.5 + big); },
    groan: () => { noise(1.2, { vol: 0.06, from: 600, to: 250, type: 'bandpass', q: 0.8, attack: 0.1 }); tone(180, { to: 120, dur: 0.8, type: 'triangle', vol: 0.03 }); },
    thud: limited('thud', 60, (k = 1) => { noise(0.18, { vol: 0.14 * k, from: 900, to: 80 }); tone(90, { to: 45, dur: 0.15, type: 'sine', vol: 0.12 * k }); }),
    kick: limited('kick', 50, (k = 1) => { tone(160, { to: 60, dur: 0.09, type: 'sine', vol: 0.12 * k }); noise(0.05, { vol: 0.08 * k, from: 3000, to: 800 }); }),
    swish: () => noise(0.25, { vol: 0.08, from: 6000, to: 2000, type: 'highpass' }),
    clank: () => { tone(820, { to: 760, dur: 0.18, type: 'triangle', vol: 0.06 }); tone(1230, { dur: 0.12, type: 'triangle', vol: 0.03 }); },
    bounce: limited('bounce', 50, () => tone(120, { to: 70, dur: 0.07, type: 'square', vol: 0.04 })),
    crack: () => { noise(0.08, { vol: 0.25, from: 5000, to: 1500, type: 'bandpass', q: 0.7 }); tone(1800, { to: 600, dur: 0.06, type: 'triangle', vol: 0.08 }); },
    pop: () => { noise(0.06, { vol: 0.16, from: 1800, to: 400 }); tone(240, { to: 140, dur: 0.06, type: 'sine', vol: 0.08 }); },
    clack: limited('clack', 40, (k = 1) => { tone(1500, { to: 900, dur: 0.04, type: 'triangle', vol: 0.07 * k }); noise(0.04, { vol: 0.08 * k, from: 4000, to: 2000, type: 'bandpass' }); }),
    boards: limited('boards', 70, () => { noise(0.22, { vol: 0.14, from: 600, to: 120 }); tone(110, { to: 70, dur: 0.18, type: 'square', vol: 0.05 }); }),
    scrape: limited('scrape', 120, () => noise(0.18, { vol: 0.05, from: 7000, to: 4000, type: 'highpass' })),
    tick: () => tone(1000, { dur: 0.04, type: 'square', vol: 0.04 }),
    select: () => tone(660, { to: 990, dur: 0.07, type: 'triangle', vol: 0.06 }),
    good: () => [523, 659, 784].forEach((f, i) => tone(f, { dur: 0.16, type: 'triangle', vol: 0.07, delay: i * 0.08 })),
    bad: () => [330, 262].forEach((f, i) => tone(f, { dur: 0.2, type: 'sawtooth', vol: 0.04, delay: i * 0.12 })),
    win: () => [523, 659, 784, 1046, 0, 784, 1046].forEach((f, i) => f && tone(f, { dur: 0.2, type: 'triangle', vol: 0.09, delay: i * 0.12 })),
    lose: () => [392, 330, 294, 262].forEach((f, i) => tone(f, { dur: 0.25, type: 'sawtooth', vol: 0.045, delay: i * 0.16 })),
    organ: () => [392, 440, 494, 587, 0, 494, 587].forEach((f, i) => f && tone(f, { dur: 0.18, type: 'square', vol: 0.045, delay: i * 0.13 })),
  };

  // ---------- Particles ----------

  // A particle system for one canvas. Units are whatever the caller draws in.
  function particles() {
    let list = [];
    const add = p => { list.push(p); if (list.length > 600) list.splice(0, list.length - 600); };
    return {
      confetti(x, y, n = 60, colors = ['#ffc53d', '#ff5d5d', '#4f8cff', '#3ddc84', '#ffffff'], spread = 260) {
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = spread * (0.4 + Math.random() * 0.8);
          add({ k: 'confetti', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 320, drag: 1.6, life: 1.6 + Math.random(), t: 0, size: 3 + Math.random() * 3, rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 14, color: colors[i % colors.length] });
        }
      },
      // A firework: a shell bursting into a ring of sparks.
      firework(x, y, color = '#ffc53d', n = 36) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU, sp = 110 + Math.random() * 60;
          add({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 90, drag: 1.2, life: 0.9 + Math.random() * 0.4, t: 0, size: 2.2, color });
        }
      },
      dust(x, y, n = 8, color = 'rgba(210,190,150,0.8)', speed = 50) {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU, sp = speed * (0.3 + Math.random());
          add({ k: 'puff', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, g: 0, drag: 3, life: 0.4 + Math.random() * 0.3, t: 0, size: 3 + Math.random() * 3, grow: 10, color });
        }
      },
      spray(x, y, dir, n = 10, color = 'rgba(235,248,255,0.9)', speed = 120) {
        for (let i = 0; i < n; i++) {
          const a = dir + (Math.random() - 0.5) * 1.4, sp = speed * (0.4 + Math.random());
          add({ k: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0, drag: 4, life: 0.3 + Math.random() * 0.3, t: 0, size: 1.5 + Math.random() * 1.5, color });
        }
      },
      sparks(x, y, n = 12, color = '#ffd86b', speed = 160) {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU, sp = speed * (0.4 + Math.random());
          add({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 200, drag: 1.5, life: 0.3 + Math.random() * 0.4, t: 0, size: 1.8, color });
        }
      },
      // Floating text, e.g. "+3" or "PERFECT".
      text(x, y, str, color = '#ffffff', size = 20) {
        add({ k: 'text', x, y, vx: 0, vy: -40, g: 0, drag: 1, life: 1.1, t: 0, size, str, color });
      },
      update(dt) {
        for (const p of list) {
          p.t += dt;
          p.vy += p.g * dt;
          p.vx *= 1 - Math.min(1, p.drag * dt);
          p.vy *= 1 - Math.min(1, p.drag * dt);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.rot !== undefined) p.rot += p.spin * dt;
        }
        list = list.filter(p => p.t < p.life);
      },
      draw(c) {
        for (const p of list) {
          const k = p.t / p.life;
          c.globalAlpha = Math.max(0, p.k === 'confetti' ? Math.min(1, (1 - k) * 3) : 1 - k);
          c.fillStyle = p.color;
          if (p.k === 'confetti') {
            c.save();
            c.translate(p.x, p.y);
            c.rotate(p.rot);
            c.fillRect(-p.size / 2, -p.size * 0.3 * Math.abs(Math.cos(p.rot * 1.7)) - 0.5, p.size, p.size * 0.6 * Math.abs(Math.cos(p.rot * 1.7)) + 1);
            c.restore();
          } else if (p.k === 'text') {
            c.font = `900 ${p.size}px system-ui, sans-serif`;
            c.textAlign = 'center';
            c.lineWidth = 4;
            c.strokeStyle = 'rgba(0,0,0,0.55)';
            c.strokeText(p.str, p.x, p.y);
            c.fillText(p.str, p.x, p.y);
          } else {
            const r = p.k === 'puff' ? p.size + p.grow * k : p.size;
            c.beginPath();
            c.arc(p.x, p.y, r, 0, TAU);
            c.fill();
          }
        }
        c.globalAlpha = 1;
      },
      clear() { list = []; },
      get count() { return list.length; },
    };
  }

  // Screen shake: call kick(amount), then wrap drawing in apply(ctx) / ctx.restore().
  function shaker() {
    let amt = 0;
    return {
      kick(a) { amt = Math.max(amt, a); },
      apply(c, dt) {
        c.save();
        if (amt > 0.2) c.translate((Math.random() - 0.5) * amt, (Math.random() - 0.5) * amt);
        amt = Math.max(0, amt - dt * 40);
      },
    };
  }

  // ---------- Crowd ----------

  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Rows of fans for a stand w×h. draw(c, x, y, excite, t) bounces them; at excite 1 they jump
  // with their arms up. `colors` are the shirts, so a home crowd can wear its team's colours.
  function makeCrowd(w, h, { seed = 7, rows = 0, size = 7, colors, back = '#20253a', dir = 1 } = {}) {
    const rnd = seeded(seed);
    const shirts = colors || ['#ffc53d', '#4f8cff', '#ff5d5d', '#e6e9ef', '#3ddc84', '#a46bff', '#ff8a3d', '#2b3247'];
    const skins = ['#f2c9a0', '#d9a066', '#a5703c', '#7a4e36', '#f6d2b0'];
    const hairs = ['#2a1d14', '#5a3a20', '#d9b25a', '#1b1b22', '#8a4a22', '#cfcfcf'];
    const n = rows || Math.max(1, Math.floor(h / (size * 2.6)));
    const fans = [];
    for (let r = 0; r < n; r++) {
      const y = (r + 0.8) * (h / n);
      for (let x = size * 0.8 + (r % 2) * size; x < w; x += size * 2.05 + rnd() * size * 0.4) {
        if (rnd() < 0.06) continue; // an empty seat here and there
        fans.push({ x, y, shirt: shirts[Math.floor(rnd() * shirts.length)], skin: skins[Math.floor(rnd() * skins.length)], hair: hairs[Math.floor(rnd() * hairs.length)], ph: rnd() * TAU, sp: 0.7 + rnd() * 0.6, flag: rnd() < 0.05 });
      }
    }
    // Back rows first so nearer fans overlap them.
    fans.sort((a, b) => (dir > 0 ? a.y - b.y : b.y - a.y));
    const layer = document.createElement('canvas');
    layer.width = Math.ceil(w);
    layer.height = Math.ceil(h);
    const lc = layer.getContext('2d');
    lc.fillStyle = back;
    lc.fillRect(0, 0, w, h);
    for (let r = 0; r < n; r++) {
      lc.fillStyle = r % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.12)';
      lc.fillRect(0, r * (h / n), w, h / n);
    }
    return {
      draw(c, ox, oy, excite = 0, t = 0) {
        c.drawImage(layer, ox, oy);
        c.save();
        c.beginPath();
        c.rect(ox, oy, w, h);
        c.clip();
        const s = size;
        for (const f of fans) {
          const jump = excite > 0.05 ? Math.max(0, Math.sin(t * 9 * f.sp + f.ph)) * s * 0.9 * excite : Math.sin(t * 1.5 * f.sp + f.ph) * s * 0.06;
          const x = ox + f.x, y = oy + f.y - jump;
          c.fillStyle = f.shirt;
          c.beginPath(); c.roundRect(x - s * 0.75, y - s * 0.2, s * 1.5, s * 1.3, s * 0.45); c.fill();
          if (excite > 0.35) {
            c.strokeStyle = f.skin;
            c.lineWidth = s * 0.32;
            c.lineCap = 'round';
            c.beginPath();
            c.moveTo(x - s * 0.55, y); c.lineTo(x - s * 0.85, y - s * 1.2);
            c.moveTo(x + s * 0.55, y); c.lineTo(x + s * 0.85, y - s * 1.2);
            c.stroke();
          }
          c.fillStyle = f.skin;
          c.beginPath(); c.arc(x, y - s * 0.62, s * 0.5, 0, TAU); c.fill();
          c.fillStyle = f.hair;
          c.beginPath(); c.arc(x, y - s * 0.75, s * 0.5, Math.PI, 0); c.fill();
          if (f.flag) {
            c.fillStyle = '#d9d2c4';
            c.fillRect(x + s * 0.7, y - s * 2.2, s * 0.14, s * 2.2);
            c.fillStyle = f.shirt;
            const wave = Math.sin(t * 6 + f.ph) * s * 0.25;
            c.beginPath(); c.moveTo(x + s * 0.84, y - s * 2.2); c.lineTo(x + s * 2.0, y - s * 1.9 + wave); c.lineTo(x + s * 0.84, y - s * 1.5); c.fill();
          }
        }
        c.restore();
      },
    };
  }

  // A soft vignette and top light over a scene, for a little stadium atmosphere.
  function lighting(c, w, h, strength = 0.35) {
    const g = c.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  return { sfx, startCrowd, stopCrowd, excite, particles, shaker, makeCrowd, lighting, seeded, tone, noise, ensure, ctx: () => ac, master: () => master };
})();
