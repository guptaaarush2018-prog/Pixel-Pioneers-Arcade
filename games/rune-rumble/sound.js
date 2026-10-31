/* Rune Rumble sound: battle effects, chest openings and a little menu tune, all synthesized
   with the Web Audio API. Follows the arcade's mute button. */
const RuneSound = (() => {
  let ac = null, master = null, musicBus = null, noiseBuf = null, music = null, wantMusic = false;
  let musicOn = Arcade.load('rune:music', true);
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
    master.gain.value = muted() ? 0 : 0.7;
    master.connect(ac.createDynamicsCompressor()).connect(ac.destination);
    musicBus = ac.createGain();
    musicBus.gain.value = 0.28;
    musicBus.connect(master);
    return true;
  }
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { ensure(); if (wantMusic) startMusic(); }, { capture: true });
  document.getElementById('mute')?.addEventListener('click', () => setTimeout(() => {
    if (master) master.gain.setTargetAtTime(muted() ? 0 : 0.7, ac.currentTime, 0.05);
  }, 0));

  function tone(freq, { to = freq, dur = 0.12, type = 'square', vol = 0.1, delay = 0, bus } = {}) {
    if (!ensure()) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(dur, { vol = 0.12, from = 2000, to = 300, type = 'lowpass', delay = 0, bus } = {}) {
    if (!ensure()) return;
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    f.type = type;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus || master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  const notes = (seq, step, opts = {}) => seq.forEach((f, i) => f && tone(f, { dur: step * 1.5, delay: i * step, type: 'triangle', vol: 0.1, ...opts }));

  // Short sounds can fire many times a frame in a big fight, so each kind is rate-limited.
  const lastAt = {};
  const limited = (key, gap, fn) => (...args) => {
    const now = performance.now();
    if (now - (lastAt[key] || 0) < gap) return;
    lastAt[key] = now;
    fn(...args);
  };

  const sfx = {
    tap: () => tone(700, { dur: 0.04, vol: 0.05, type: 'sine' }),
    select: () => tone(620, { to: 900, dur: 0.07, vol: 0.06, type: 'triangle' }),
    deny: () => tone(150, { dur: 0.12, vol: 0.07, type: 'sawtooth' }),
    deploy: () => { tone(330, { to: 520, dur: 0.12, type: 'triangle', vol: 0.08 }); noise(0.15, { vol: 0.06, from: 800, to: 200 }); },
    sword: limited('sword', 70, () => noise(0.06, { vol: 0.07, from: 5000, to: 1500, type: 'bandpass' })),
    arrow: limited('arrow', 60, () => noise(0.08, { vol: 0.05, from: 3000, to: 6000, type: 'highpass' })),
    boom: limited('boom', 90, (big = false) => { noise(big ? 0.7 : 0.35, { vol: big ? 0.22 : 0.13, from: 1200, to: 60 }); tone(big ? 90 : 140, { to: 40, dur: big ? 0.5 : 0.25, type: 'sine', vol: 0.15 }); }),
    zap: limited('zap', 80, () => { tone(1800, { to: 200, dur: 0.18, type: 'sawtooth', vol: 0.06 }); noise(0.2, { vol: 0.06, from: 6000, to: 2000, type: 'highpass' }); }),
    freeze: () => { notes([1568, 1976, 2349], 0.05, { type: 'sine', vol: 0.06 }); noise(0.5, { vol: 0.05, from: 8000, to: 3000, type: 'highpass' }); },
    heal: limited('heal', 400, () => tone(880, { to: 1320, dur: 0.15, type: 'sine', vol: 0.04 })),
    rage: () => { tone(110, { to: 220, dur: 0.4, type: 'sawtooth', vol: 0.07 }); },
    death: limited('death', 80, () => tone(300, { to: 120, dur: 0.12, type: 'triangle', vol: 0.05 })),
    towerFall: () => { noise(1.0, { vol: 0.25, from: 900, to: 40 }); tone(120, { to: 35, dur: 0.8, type: 'sine', vol: 0.18 }); notes([523, 659, 784], 0.1, { delay: 0.3 }); },
    crownLost: () => notes([392, 311, 262], 0.14, { type: 'sawtooth', vol: 0.05 }),
    start: () => notes([392, 523, 659, 784], 0.1, { type: 'square', vol: 0.06 }),
    tick: () => tone(1000, { dur: 0.05, vol: 0.05, type: 'square' }),
    win: () => notes([523, 659, 784, 1046, 0, 784, 1046], 0.13, { vol: 0.12 }),
    lose: () => notes([392, 330, 294, 262], 0.18, { type: 'sawtooth', vol: 0.06 }),
    chestShake: () => noise(0.12, { vol: 0.08, from: 400, to: 150 }),
    chestOpen: () => { noise(0.4, { vol: 0.12, from: 3000, to: 300 }); notes([523, 784, 1046], 0.07, { type: 'square', vol: 0.06 }); },
    card: rarity => {
      const base = { common: 660, rare: 784, epic: 988, legendary: 1175 }[rarity] || 660;
      tone(base, { to: base * 1.5, dur: 0.12, type: 'triangle', vol: 0.08 });
      if (rarity === 'epic' || rarity === 'legendary') notes([base, base * 1.25, base * 1.5, base * 2], 0.07, { type: 'square', vol: 0.05, delay: 0.1 });
    },
    gold: () => { tone(988, { dur: 0.07, vol: 0.06 }); tone(1318, { dur: 0.2, vol: 0.06, delay: 0.07 }); },
    upgrade: () => notes([523, 659, 784, 1046, 1318], 0.07, { type: 'square', vol: 0.06 }),
    trophy: () => notes([784, 988, 1175], 0.08, { type: 'triangle', vol: 0.08 }),
  };

  // Menu tune: a lute-ish arpeggio over a drone, four bars, in D dorian.
  const N = n => 440 * 2 ** ((n - 69) / 12);
  const BARS = [[50, 57, 62, 65], [48, 55, 60, 64], [46, 53, 58, 62], [48, 55, 60, 67]];
  const MELODY = [74, 0, 72, 74, 76, 0, 74, 72, 69, 0, 67, 69, 72, 0, 0, 0];
  function startMusic() {
    wantMusic = true;
    if (!musicOn || !ac || music) return;
    const beat = 0.18;
    let step = 0, next = ac.currentTime + 0.1;
    const timer = setInterval(() => {
      while (next < ac.currentTime + 0.3) {
        const bar = BARS[Math.floor(step / 8) % 4], s = step % 8;
        const t = next - ac.currentTime;
        if (s === 0) tone(N(bar[0] - 12), { dur: beat * 7, type: 'triangle', vol: 0.12, delay: t, bus: musicBus });
        tone(N(bar[s % 4] + (s >= 4 ? 12 : 0)), { dur: beat * 1.6, type: 'triangle', vol: 0.05, delay: t, bus: musicBus });
        const m = MELODY[(step + Math.floor(step / 32) * 4) % 16];
        if (m && Math.floor(step / 16) % 2) tone(N(m), { dur: beat * 1.8, type: 'square', vol: 0.03, delay: t, bus: musicBus });
        next += beat;
        step++;
      }
    }, 60);
    music = { timer };
  }
  function stopMusic() {
    wantMusic = false;
    if (!music) return;
    clearInterval(music.timer);
    music = null;
  }
  function setMusic(on) {
    musicOn = on;
    Arcade.save('rune:music', on);
    if (!on) { const w = wantMusic; stopMusic(); wantMusic = w; } else if (wantMusic) startMusic();
  }

  return { sfx, startMusic, stopMusic, setMusic, musicOn: () => musicOn };
})();
