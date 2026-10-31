/* Pocket Racer's own sound, all synthesized with the Web Audio API (no audio files):
   an engine note that follows your speed, tyre squeal and off-road rumble from filtered noise,
   race effects, and a small music sequencer for the menus. It follows the arcade's mute button. */
const RacerSound = (() => {
  let ac = null, master = null, sfxBus = null, musicBus = null;
  let engine = null, squeal = null, rumble = null;
  let music = null;
  let musicOn = Arcade.load('racer:music', true);

  const muted = () => Arcade.load('muted', false);

  // Browsers only allow audio after a tap or key press, so everything starts on the first one.
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
    const comp = ac.createDynamicsCompressor();
    master.connect(comp).connect(ac.destination);
    sfxBus = ac.createGain();
    sfxBus.connect(master);
    musicBus = ac.createGain();
    musicBus.gain.value = 0.32;
    musicBus.connect(master);
    return true;
  }
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { ensure(); if (wantMusic) startMusic(); }, { capture: true });
  document.getElementById('mute')?.addEventListener('click', () => setTimeout(applyMute, 0));
  function applyMute() {
    if (!master) return;
    master.gain.setTargetAtTime(muted() ? 0 : 0.8, ac.currentTime, 0.05);
  }

  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    return src;
  }

  // ---------- Continuous car sounds ----------

  // Two detuned oscillators through a low-pass filter: pitch and brightness rise with speed,
  // and the gas pedal opens it up a little more.
  function startCar() {
    if (!ensure() || engine) return;
    const a = ac.createOscillator(), b = ac.createOscillator(), sub = ac.createOscillator();
    a.type = 'sawtooth';
    b.type = 'square';
    sub.type = 'triangle';
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    const gain = ac.createGain();
    gain.gain.value = 0;
    const bg = ac.createGain();
    bg.gain.value = 0.35;
    a.connect(filter);
    b.connect(bg).connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(sfxBus);
    [a, b, sub].forEach(o => o.start());
    engine = { a, b, sub, filter, gain };

    const sq = noise(), sqf = ac.createBiquadFilter(), sqg = ac.createGain();
    sqf.type = 'bandpass';
    sqf.frequency.value = 2400;
    sqf.Q.value = 3;
    sqg.gain.value = 0;
    sq.connect(sqf).connect(sqg).connect(sfxBus);
    sq.start();
    squeal = { src: sq, gain: sqg, filter: sqf };

    const ru = noise(), ruf = ac.createBiquadFilter(), rug = ac.createGain();
    ruf.type = 'lowpass';
    ruf.frequency.value = 260;
    rug.gain.value = 0;
    ru.connect(ruf).connect(rug).connect(sfxBus);
    ru.start();
    rumble = { src: ru, gain: rug };
  }

  // speed 0..1 of top speed, gas true/false, slide 0..1, offTrack true/false.
  function updateCar({ speed, gas, slide, offTrack }) {
    if (!engine) return;
    const t = ac.currentTime;
    // A little "gear change" wobble: pitch climbs through each gear band, then drops back.
    const gears = 4, g = Math.min(gears - 1, Math.floor(speed * gears));
    const inGear = speed * gears - g;
    const f = 48 + g * 14 + inGear * 70;
    engine.a.frequency.setTargetAtTime(f, t, 0.04);
    engine.b.frequency.setTargetAtTime(f * 1.006, t, 0.04);
    engine.sub.frequency.setTargetAtTime(f / 2, t, 0.04);
    engine.filter.frequency.setTargetAtTime(300 + speed * 1500 + (gas ? 500 : 0), t, 0.05);
    engine.gain.gain.setTargetAtTime(0.05 + speed * 0.05 + (gas ? 0.03 : 0), t, 0.06);
    squeal.gain.gain.setTargetAtTime(Math.min(0.09, slide * 0.12), t, 0.04);
    squeal.filter.frequency.setTargetAtTime(2000 + slide * 900, t, 0.05);
    rumble.gain.gain.setTargetAtTime(offTrack ? 0.05 + speed * 0.12 : 0, t, 0.05);
  }

  function stopCar() {
    if (!engine) return;
    const t = ac.currentTime;
    for (const node of [engine.gain, squeal.gain, rumble.gain]) node.gain.setTargetAtTime(0, t, 0.08);
    const old = { engine, squeal, rumble };
    engine = squeal = rumble = null;
    setTimeout(() => {
      [old.engine.a, old.engine.b, old.engine.sub, old.squeal.src, old.rumble.src].forEach(o => { try { o.stop(); } catch {} });
    }, 400);
  }

  // ---------- One-shot effects ----------

  function blip(freq, { to = freq, dur = 0.12, type = 'square', vol = 0.12, delay = 0 } = {}) {
    if (!ensure()) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function whoosh(dur = 0.35, vol = 0.12) {
    if (!ensure()) return;
    const t = ac.currentTime, n = noise(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(sfxBus);
    n.start(t);
    n.stop(t + dur + 0.05);
  }

  const notes = (seq, step = 0.11, opts = {}) => seq.forEach((f, i) => f && blip(f, { dur: step * 1.6, delay: i * step, type: 'triangle', vol: 0.12, ...opts }));

  const sfx = {
    tick: () => blip(880, { dur: 0.04, vol: 0.05, type: 'sine' }),
    select: () => blip(660, { to: 990, dur: 0.08, vol: 0.07, type: 'triangle' }),
    back: () => blip(500, { to: 330, dur: 0.08, vol: 0.06, type: 'triangle' }),
    light: () => blip(440, { dur: 0.22, vol: 0.13, type: 'square' }),
    go: () => { blip(880, { dur: 0.5, vol: 0.14, type: 'square' }); whoosh(0.5, 0.08); },
    lap: () => notes([660, 880], 0.09),
    finalLap: () => notes([660, 880, 1046], 0.09),
    bestLap: () => notes([784, 988, 1175], 0.08, { type: 'square', vol: 0.07 }),
    overtake: () => blip(520, { to: 780, dur: 0.1, vol: 0.06, type: 'triangle' }),
    win: () => notes([523, 659, 784, 1046, 0, 784, 1046], 0.12, { vol: 0.13 }),
    podium: () => notes([523, 659, 784], 0.13),
    lose: () => notes([392, 330, 262], 0.16, { type: 'sawtooth', vol: 0.06 }),
    coin: () => { blip(988, { dur: 0.08, vol: 0.08 }); blip(1318, { dur: 0.25, vol: 0.08, delay: 0.08 }); },
    star: () => notes([1046, 1318, 1568], 0.07, { type: 'sine', vol: 0.1 }),
    unlock: () => notes([523, 784, 1046, 1568], 0.1, { type: 'square', vol: 0.07 }),
    buzz: () => blip(140, { dur: 0.25, vol: 0.08, type: 'sawtooth' }),
  };

  // ---------- Menu music ----------
  // A short four-bar loop: bass, chords and a lead, scheduled a little ahead of time.

  const N = n => 440 * 2 ** ((n - 69) / 12);
  const BARS = [
    { bass: 45, chord: [57, 60, 64] },  // A minor
    { bass: 41, chord: [53, 57, 60] },  // F
    { bass: 48, chord: [55, 60, 64] },  // C
    { bass: 43, chord: [55, 59, 62] },  // G
  ];
  const LEAD = [76, 0, 74, 76, 0, 72, 74, 0, 72, 0, 69, 72, 0, 71, 72, 74];
  let wantMusic = false;

  function startMusic() {
    wantMusic = true;
    if (!musicOn || !ac || music) return;
    const tempo = 0.15; // seconds per 16th
    let step = 0, next = ac.currentTime + 0.1;
    const voice = (freq, t, dur, type, vol) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(musicBus);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    const timer = setInterval(() => {
      while (next < ac.currentTime + 0.3) {
        const bar = BARS[Math.floor(step / 16) % 4], s = step % 16;
        if (s % 4 === 0) voice(N(bar.bass), next, tempo * 3, 'triangle', 0.25);
        if (s % 4 === 2) voice(N(bar.bass + 12), next, tempo * 1.5, 'triangle', 0.12);
        if (s % 8 === 4) bar.chord.forEach(n => voice(N(n), next, tempo * 3, 'square', 0.035));
        const lead = LEAD[(step + Math.floor(step / 32) * 3) % 16];
        if (lead && Math.floor(step / 16) % 2 === 1) voice(N(lead), next, tempo * 1.8, 'square', 0.05);
        // Hi-hat from a burst of noise.
        if (s % 2 === 1) {
          const n = noise(), f = ac.createBiquadFilter(), g = ac.createGain();
          f.type = 'highpass';
          f.frequency.value = 7000;
          g.gain.setValueAtTime(0.06, next);
          g.gain.exponentialRampToValueAtTime(0.0001, next + 0.04);
          n.connect(f).connect(g).connect(musicBus);
          n.start(next);
          n.stop(next + 0.06);
        }
        next += tempo;
        step++;
      }
    }, 50);
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
    Arcade.save('racer:music', on);
    if (!on) { const want = wantMusic; stopMusic(); wantMusic = want; }
    else if (wantMusic) startMusic();
  }

  return { ensure, startCar, updateCar, stopCar, sfx, startMusic, stopMusic, setMusic, musicOn: () => musicOn };
})();
