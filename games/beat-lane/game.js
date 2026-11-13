(() => {
  const ID = 'beat-lane';
  const W = 960, H = 540;
  const LANES = 4, LANE_W = 92, LANE_X = (W - LANES * LANE_W) / 2, HIT_Y = 452, NOTE_H = 22;
  const KEYS = [['KeyD', 'ArrowLeft'], ['KeyF', 'ArrowDown'], ['KeyJ', 'ArrowUp'], ['KeyK', 'ArrowRight']];
  const KEY_LABELS = ['D', 'F', 'J', 'K'];
  const LANE_COLORS = ['#ff4fd8', '#3ef0ff', '#ffd23f', '#7ed957'];
  const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.135 };
  const POINTS = { perfect: 300, great: 200, good: 100, miss: 0 };
  const LEAD_IN = 2.0;
  const BEST_KEY = 'beat:best', OFFSET_KEY = 'beat:offset', CHOICE_KEY = 'beat:choice';

  // Every song is written by a small composer below from these settings, so the music and the
  // notes come from the same data and always line up. Optional style settings (defaults in brackets):
  //   drums [rock] rock | four | half | break | shuffle      bass [eighths] eighths | offbeat | octave | pulse | walk
  //   swing [0] pushes off-beats late (0.16 is a triplet feel)   arp [false] adds a chord arpeggio
  //   chordBars [1] bars per chord   form [FORM] the song's sections   tag: shown in the song list
  const SONGS = [
    { id: 'neon', name: 'Neon Drive', bpm: 108, root: 45, scale: 'minor', prog: [0, 5, 3, 4], seed: 11, lead: 'square', color: '#3ef0ff' },
    { id: 'parade', name: 'Pixel Parade', bpm: 124, root: 48, scale: 'major', prog: [0, 4, 5, 3], seed: 23, lead: 'triangle', color: '#ffd23f' },
    { id: 'starlight', name: 'Starlight Sprint', bpm: 142, root: 50, scale: 'dorian', prog: [0, 3, 6, 4], seed: 37, lead: 'sawtooth', color: '#c39bff' },
    { id: 'overclock', name: 'Overclock', bpm: 165, root: 43, scale: 'minor', prog: [0, 6, 5, 4], seed: 59, lead: 'square', color: '#ff4d6d' },
    { id: 'recess', name: 'Rainy Recess', tag: 'Lo-fi', bpm: 92, root: 50, scale: 'dorian', prog: [0, 3, 1, 4], seed: 71, lead: 'triangle', color: '#8fb8ff',
      drums: 'half', bass: 'pulse', swing: 0.14, chordBars: 2 },
    { id: 'tide', name: 'Tidal Glow', tag: 'Chill', bpm: 100, root: 52, scale: 'lydian', prog: [0, 1, 5, 4], seed: 83, lead: 'triangle', color: '#5ce0d0',
      drums: 'half', bass: 'octave', arp: true, chordBars: 2 },
    { id: 'mirage', name: 'Mirage Market', tag: 'Desert', bpm: 116, root: 45, scale: 'phrygian', prog: [0, 1, 0, 6], seed: 97, lead: 'sawtooth', color: '#ffa94d',
      drums: 'break', bass: 'walk' },
    { id: 'hopscotch', name: 'Hop Scotch', tag: 'Swing', bpm: 128, root: 48, scale: 'mixolydian', prog: [0, 3, 0, 4], seed: 109, lead: 'square', color: '#ff7eb6',
      drums: 'shuffle', bass: 'walk', swing: 0.16 },
    { id: 'coinop', name: 'Coin-Op Hero', tag: 'Chiptune', bpm: 134, root: 47, scale: 'mixolydian', prog: [0, 6, 3, 4], seed: 127, lead: 'square', color: '#9be37a',
      drums: 'four', bass: 'octave', arp: true },
    { id: 'frostbyte', name: 'Frostbyte', tag: 'Breakbeat', bpm: 146, root: 46, scale: 'harmonic', prog: [0, 5, 3, 4], seed: 139, lead: 'sawtooth', color: '#b3e5fc',
      drums: 'break', bass: 'offbeat', arp: true },
    { id: 'turbo', name: 'Turbo Lane', tag: 'Racing', bpm: 156, root: 44, scale: 'minor', prog: [0, 5, 6, 4], seed: 151, lead: 'square', color: '#ffe066',
      drums: 'four', bass: 'offbeat' },
    { id: 'boss', name: 'Final Boss', tag: 'Boss', bpm: 180, root: 42, scale: 'harmonic', prog: [0, 5, 1, 4], seed: 173, lead: 'sawtooth', color: '#ff3b3b', arp: true,
      drums: 'four', bass: 'octave',
      form: [['intro', 4, 0.25], ['A', 8, 0.6], ['B', 8, 0.8], ['C', 8, 0.5], ['A', 8, 0.7], ['B', 8, 0.9], ['B', 8, 0.95], ['outro', 4, 0.35]] },
  ];
  const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
  };
  // Clearing every song on any difficulty, and the boss on Hard, are achievements.
  const BOSS = 'boss';
  const DIFFS = { easy: { name: 'Easy', gap: 1, holds: false, kicks: false }, normal: { name: 'Normal', gap: 0.5, holds: true, kicks: false }, hard: { name: 'Hard', gap: 0.25, holds: true, kicks: true } };
  // Sections in bars, with how busy each one is.
  const FORM = [['intro', 4, 0.2], ['A', 8, 0.55], ['B', 8, 0.75], ['A', 8, 0.6], ['C', 8, 0.5], ['B', 8, 0.85], ['outro', 4, 0.3]];

  const canvas = document.getElementById('game');
  const ctx = Arcade.setupCanvas(canvas, W, H);
  const ui = Arcade.overlay(document.getElementById('overlay'));
  const $ = id => document.getElementById(id);

  let state = 'menu';   // 'play' | 'paused' | 'over'
  let song, diff, events, notes, evIdx, startAt, audio, master, noise;
  let score, combo, maxCombo, health, counts, judgement, flashes, held, lastBeat, failed, mutedCheck = 0;
  let choice = Arcade.load(CHOICE_KEY, { song: 'neon', diff: 'normal' });
  if (!SONGS.some(s => s.id === choice.song) || !DIFFS[choice.diff]) choice = { song: 'neon', diff: 'normal' };
  let offsetMs = Arcade.load(OFFSET_KEY, 0);

  // ---------- Composer ----------

  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // One bar of drums in the song's style.
  function drumBar(out, style, name, energy, b, t0) {
    const kick = t => out.push({ t: t0 + t, type: 'kick' });
    const snare = t => out.push({ t: t0 + t, type: 'snare' });
    const hat = (t, soft) => out.push({ t: t0 + t, type: 'hat', soft });
    const hats = name !== 'intro';
    const busy = energy > 0.7;
    if (style === 'four') {
      for (let beat = 0; beat < 4; beat++) {
        if (name !== 'C' || beat % 2 === 0) kick(beat);
        if (beat % 2) snare(beat);
        if (hats) { hat(beat + 0.5); if (busy) hat(beat + 0.25, true), hat(beat + 0.75, true); }
      }
      if (name === 'B' && b % 4 === 3) snare(3.25), snare(3.5), snare(3.75);
    } else if (style === 'half') {
      kick(0);
      if (name !== 'C') kick(2.5);
      snare(2);
      if (hats) for (let e = 0; e < 8; e++) hat(e * 0.5, e % 2 === 1);
      if (busy && b % 2) kick(3.5);
    } else if (style === 'break') {
      kick(0);
      kick(1.75);
      if (name !== 'C') kick(2.5);
      snare(1);
      snare(3);
      if (hats) for (let e = 0; e < 8; e++) hat(e * 0.5, e % 2 === 1);
      if (busy) out.push({ t: t0 + 3.75, type: 'snare' });
    } else if (style === 'shuffle') {
      for (let beat = 0; beat < 4; beat++) {
        if (beat % 2 === 0 && (name !== 'C' || beat === 0)) kick(beat);
        if (beat % 2) snare(beat);
        if (hats) hat(beat, true), hat(beat + 0.5);
      }
      if (name === 'B' && b % 4 === 3) snare(3.5);
    } else {
      for (let beat = 0; beat < 4; beat++) {
        if (name !== 'C' || beat % 2 === 0) out.push({ t: t0 + beat, type: beat % 2 === 0 ? 'kick' : 'snare' });
        if (hats) {
          hat(beat + 0.5);
          if (busy) hat(beat + 0.25, true), hat(beat + 0.75, true);
        }
      }
      if (name === 'B' && b % 4 === 3) snare(3.5), snare(3.75);
    }
  }

  // Swing: within each beat, the off-beat lands late (at 0.5 + swing) and the rest stretches to fit.
  function swung(t, sw) {
    if (!sw) return t;
    const beat = Math.floor(t + 1e-9), p = t - beat;
    return beat + (p < 0.5 ? p * (0.5 + sw) / 0.5 : 0.5 + sw + (p - 0.5) * (0.5 - sw) / 0.5);
  }

  // Returns timed events (in beats): drums, bass, pads and a lead melody.
  function compose(S) {
    const sc = SCALES[S.scale];
    const deg = (d, oct = 0) => S.root + sc[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
    const out = [];
    const motifs = {};
    let bar = 0;
    const drums = S.drums || 'rock', bassStyle = S.bass || 'eighths', chordBars = S.chordBars || 1;
    for (const [name, bars, energy] of S.form || FORM) {
      // One two-bar motif per section type, reused with each chord so it sounds like a tune.
      if (!motifs[name]) {
        const r = seeded(S.seed * 97 + name.charCodeAt(0));
        const m = [];
        let step = Math.floor(r() * 3);
        for (let slot = 0; slot < 16; slot++) {
          if (r() > energy + (slot % 2 ? -0.15 : 0.1)) continue;
          step += Math.floor(r() * 5) - 2;
          step = Math.max(-2, Math.min(7, step));
          const len = r() < 0.18 && slot % 2 === 0 ? (r() < 0.5 ? 2 : 4) : 1;
          m.push({ slot, step, len });
          slot += len - 1;
        }
        motifs[name] = m;
      }
      for (let b = 0; b < bars; b++, bar++) {
        const chord = S.prog[Math.floor(bar / chordBars) % S.prog.length];
        const t0 = bar * 4;
        drumBar(out, drums, name, energy, b, t0);
        // Bass.
        if (bassStyle === 'eighths') for (let e = 0; e < 8; e++) out.push({ t: t0 + e * 0.5, type: 'bass', midi: deg(chord + (e % 4 === 3 ? 4 : 0), -1), dur: 0.45 });
        else if (bassStyle === 'offbeat') for (let e = 1; e < 8; e += 2) out.push({ t: t0 + e * 0.5, type: 'bass', midi: deg(chord + (e === 7 ? 4 : 0), -1), dur: 0.4 });
        else if (bassStyle === 'octave') for (let e = 0; e < 8; e++) out.push({ t: t0 + e * 0.5, type: 'bass', midi: deg(chord, e % 2 ? 0 : -1), dur: 0.4 });
        else if (bassStyle === 'pulse') for (let q = 0; q < 4; q++) out.push({ t: t0 + q, type: 'bass', midi: deg(chord + (q === 3 ? 4 : 0), -1), dur: 0.9 });
        else if (bassStyle === 'walk') [0, 2, 4, 5].forEach((d, q) => out.push({ t: t0 + q, type: 'bass', midi: deg(chord + d, -1), dur: 0.85 }));
        // Arpeggio up and down the chord on eighths, in the busier sections.
        if (S.arp && name !== 'intro' && energy >= 0.5) {
          const shape = [0, 2, 4, 7, 4, 2, 0, 2];
          for (let e = 0; e < 8; e++) out.push({ t: t0 + e * 0.5, type: 'arp', midi: deg(chord + shape[e], 1), dur: 0.4 });
        }
        // Pad chord.
        if (name !== 'intro') out.push({ t: t0, type: 'pad', midi: [deg(chord, 1), deg(chord + 2, 1), deg(chord + 4, 1)], dur: 4 });
        // Lead from the motif, which spans two bars.
        if (name !== 'intro' && name !== 'outro') {
          const half = b % 2;
          for (const n of motifs[name]) {
            if (Math.floor(n.slot / 8) !== half) continue;
            out.push({ t: t0 + (n.slot % 8) * 0.5, type: 'lead', midi: deg(chord + n.step, 1), dur: n.len * 0.5 });
          }
        }
      }
    }
    return { events: out.sort((a, b) => a.t - b.t), beats: bar * 4 };
  }

  // Notes to hit, taken from the lead line. Lanes follow the melody's shape: up moves right,
  // down moves left, a big leap skips a lane.
  function chart(comp, D, S) {
    const hatFill = S.bass === 'pulse' || S.bass === 'walk';
    const leads = comp.events.filter(e => e.type === 'lead');
    const out = [];
    let lastT = -9, lane = 1, prev = null;
    const step = midi => {
      if (prev !== null && midi !== prev) {
        const d = midi - prev, n = Math.abs(d) > 4 ? 2 : 1;
        let next = lane + Math.sign(d) * n;
        if (next > 3) next = lane === 3 ? 2 : 3;
        if (next < 0) next = lane === 0 ? 1 : 0;
        lane = next;
      }
      prev = midi;
      return lane;
    };
    for (const e of leads) {
      if (e.t - lastT < D.gap - 1e-6) continue;
      if (D.gap >= 1 && e.t % 1 !== 0) continue;
      const hold = D.holds && e.dur >= 1;
      out.push({ beat: e.t, lane: step(e.midi), len: hold ? e.dur : 0 });
      lastT = e.t + (hold ? e.dur : 0);
    }
    const busy = (t, pad) => out.some(n => Math.abs(n.beat - t) < pad || (n.len && t > n.beat - 0.1 && t < n.beat + n.len + 0.25));
    const extra = [];
    for (const e of comp.events) {
      const edge = e.t < 16 || e.t >= comp.beats - 16;
      // Warm-up taps on the kick during the intro and outro.
      if (e.type === 'kick' && edge && e.t % 2 === 0 && !busy(e.t, 0.6)) extra.push({ beat: e.t, lane: (e.t / 2) % 4, len: 0 });
      if (!D.kicks || edge) continue;
      // Hard: the bass fills the off-beats, and the first beat of each bar is a two-note chord.
      if (e.type === 'bass' && e.t % 1 === 0.5 && !busy(e.t, 0.3) && !extra.some(x => Math.abs(x.beat - e.t) < 0.3)) extra.push({ beat: e.t, lane: e.midi % 4, len: 0 });
      // Songs whose bass sits on the beat get their off-beat notes from the hi-hat instead.
      if (hatFill && e.type === 'hat' && e.t % 1 === 0.5 && !busy(e.t, 0.3) && !extra.some(x => Math.abs(x.beat - e.t) < 0.3)) extra.push({ beat: e.t, lane: Math.floor(e.t * 2 + e.t / 4) % 4, len: 0 });
      if (e.type === 'kick' && e.t % 4 === 0) {
        const n = out.find(x => x.beat === e.t && !x.len);
        if (n) extra.push({ beat: e.t, lane: (n.lane + 2) % 4, len: 0 });
      }
    }
    return [...out, ...extra].sort((a, b) => a.beat - b.beat);
  }

  // ---------- Audio ----------

  function ensureAudio() {
    if (audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    audio = new AC();
    master = audio.createGain();
    master.gain.value = 0.5;
    master.connect(audio.destination);
    noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const freq = m => 440 * Math.pow(2, (m - 69) / 12);

  function voice(type, f, at, dur, vol, filter) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.01);
    g.gain.setTargetAtTime(0, at + dur * 0.7, dur * 0.25 + 0.02);
    let node = o;
    if (filter) {
      const lp = audio.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = filter;
      o.connect(lp);
      node = lp;
    }
    node.connect(g);
    g.connect(master);
    o.start(at);
    o.stop(at + dur + 0.3);
  }

  function hit(at, kind, soft) {
    if (kind === 'kick') {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.setValueAtTime(150, at);
      o.frequency.exponentialRampToValueAtTime(40, at + 0.12);
      g.gain.setValueAtTime(0.9, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
      o.connect(g);
      g.connect(master);
      o.start(at);
      o.stop(at + 0.3);
      return;
    }
    const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    src.buffer = noise;
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const vol = kind === 'hat' ? (soft ? 0.05 : 0.1) : 0.35, len = kind === 'hat' ? 0.05 : 0.16;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(at);
    src.stop(at + len + 0.05);
    if (kind === 'snare') voice('triangle', 190, at, 0.08, 0.15);
  }

  function schedule(ev, at) {
    const spb = 60 / song.bpm;
    if (ev.type === 'kick' || ev.type === 'snare' || ev.type === 'hat') hit(at, ev.type, ev.soft);
    else if (ev.type === 'bass') voice('sawtooth', freq(ev.midi), at, ev.dur * spb, 0.16, 600);
    else if (ev.type === 'lead') voice(song.lead, freq(ev.midi), at, ev.dur * spb, 0.09, 3200);
    else if (ev.type === 'arp') voice('square', freq(ev.midi), at, ev.dur * spb, 0.025, 2200);
    else if (ev.type === 'pad') for (const m of ev.midi) voice('triangle', freq(m), at, ev.dur * spb, 0.035, 1800);
  }

  // ---------- Game ----------

  const spb = () => 60 / song.bpm;
  const songTime = () => audio.currentTime - startAt;   // seconds since the first beat
  const judgeTime = () => songTime() - offsetMs / 1000;
  const fallSpeed = () => 380 + song.bpm * 1.2;          // px per second

  function begin(songId = choice.song, diffId = choice.diff) {
    ensureAudio();
    audio.resume();
    song = SONGS.find(s => s.id === songId) || SONGS[0];
    diff = diffId;
    choice = { song: song.id, diff };
    Arcade.save(CHOICE_KEY, choice);
    const comp = compose(song);
    const at = t => swung(t, song.swing) * spb();
    events = comp.events.map(e => ({ ...e, time: at(e.t) }));
    notes = chart(comp, DIFFS[diff], song).map(n => ({ ...n, time: at(n.beat), end: at(n.beat + n.len), done: false }));
    song.length = comp.beats * spb();
    evIdx = 0;
    startAt = audio.currentTime + LEAD_IN;
    score = 0;
    combo = 0;
    maxCombo = 0;
    health = 100;
    counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    judgement = null;
    flashes = [0, 0, 0, 0];
    held = [false, false, false, false];
    lastBeat = -1;
    failed = false;
    state = 'play';
    ui.hide();
    updateHud();
  }

  const mult = () => Math.min(4, 1 + Math.floor(combo / 20) * 0.5);

  function judge(note, kind, tail = false) {
    counts[kind]++;
    if (kind === 'miss') {
      combo = 0;
      health -= tail ? 4 : 7;
      if (health <= 0 && !failed) fail();
    } else {
      combo++;
      maxCombo = Math.max(maxCombo, combo);
      score += Math.round(POINTS[kind] * mult());
      health = Math.min(100, health + (kind === 'perfect' ? 1.2 : kind === 'great' ? 0.6 : 0));
    }
    judgement = { kind, t: 0 };
    updateHud();
  }

  function press(lane) {
    if (state !== 'play') return;
    held[lane] = true;
    flashes[lane] = 1;
    const now = judgeTime();
    let best = null;
    for (const n of notes) {
      if (n.done || n.lane !== lane || n.hit) continue;
      const d = Math.abs(n.time - now);
      if (d <= WINDOWS.good && (!best || d < Math.abs(best.time - now))) best = n;
      if (n.time - now > WINDOWS.good) break;
    }
    if (!best) return;
    const d = Math.abs(best.time - now);
    const kind = d <= WINDOWS.perfect ? 'perfect' : d <= WINDOWS.great ? 'great' : 'good';
    if (best.len) best.hit = true; // now hold it
    else best.done = true;
    judge(best, kind);
    burst(lane, kind);
  }

  function release(lane) {
    held[lane] = false;
    if (state !== 'play') return;
    const now = judgeTime();
    for (const n of notes) {
      if (n.lane !== lane || !n.hit || n.done) continue;
      n.done = true;
      // Letting go a little early is fine.
      judge(n, now >= n.end - spb() * 0.25 ? 'perfect' : 'miss', true);
    }
  }

  let particles = [];
  function burst(lane, kind) {
    const x = LANE_X + lane * LANE_W + LANE_W / 2;
    for (let i = 0; i < (kind === 'perfect' ? 14 : 8); i++) {
      const a = -Math.PI * Math.random(), s = Arcade.rand(120, 320);
      particles.push({ x, y: HIT_Y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4, color: LANE_COLORS[lane] });
    }
  }

  function fail() {
    failed = true;
    end();
  }

  function grade(acc) {
    return acc >= 0.95 ? 'S' : acc >= 0.88 ? 'A' : acc >= 0.78 ? 'B' : acc >= 0.65 ? 'C' : 'D';
  }

  function end() {
    if (state === 'over') return;
    state = 'over';
    audio.suspend();
    const total = counts.perfect + counts.great + counts.good + counts.miss;
    const acc = total ? (counts.perfect + counts.great * 0.7 + counts.good * 0.4) / total : 0;
    const g = failed ? 'F' : grade(acc);
    if (!failed) {
      Arcade.flag('beat-lane-clear');
      if (diff === 'hard') Arcade.flag('beat-lane-hard');
      if (counts.miss === 0) Arcade.flag('beat-lane-fc');
      if (g === 'S') Arcade.flag('beat-lane-s');
      if (song.id === BOSS && diff === 'hard') Arcade.flag('beat-lane-boss');
    }
    const bests = Arcade.load(BEST_KEY, {});
    const key = `${song.id}:${diff}`;
    const prev = bests[key];
    // A failed run still keeps its score, but a clear always beats a fail for the grade shown.
    if (!prev || score > prev.score || (prev.grade === 'F' && !failed)) {
      bests[key] = { score: Math.max(score, prev?.score || 0), grade: g };
      Arcade.save(BEST_KEY, bests);
    }
    const cleared = id => Object.keys(DIFFS).some(d => bests[`${id}:${d}`] && bests[`${id}:${d}`].grade !== 'F');
    if (SONGS.every(s => cleared(s.id))) Arcade.flag('beat-lane-setlist');
    Arcade.finish(ui, {
      score,
      title: failed ? 'Song failed' : `${g} rank!`,
      lines: [
        `${song.name} · ${DIFFS[diff].name} · ${Math.round(acc * 100)}% accuracy · max combo ${maxCombo}`,
        `Perfect ${counts.perfect} · Great ${counts.great} · Good ${counts.good} · Miss ${counts.miss}`,
      ],
      button: 'Pick a song',
      onAction: showMenu,
    });
  }

  function update() {
    // Respect the arcade's mute button.
    if ((mutedCheck -= 1) <= 0) {
      mutedCheck = 20;
      master.gain.value = Arcade.load('muted', false) ? 0 : 0.5;
    }
    const st = songTime();
    while (evIdx < events.length && events[evIdx].time < st + 0.2) {
      const ev = events[evIdx++];
      if (ev.time >= st - 0.05) schedule(ev, startAt + ev.time);
    }
    const jt = judgeTime();
    for (const n of notes) {
      if (n.done) continue;
      if (!n.hit && n.time < jt - WINDOWS.good) {
        n.done = true;
        judge(n, 'miss');
        if (n.len) counts.miss++;
        if (state !== 'play') return;
      } else if (n.hit && jt >= n.end) {
        n.done = true;
        judge(n, 'perfect', true);
      } else if (n.time > jt + 3) break;
    }
    const beat = Math.floor(st / spb());
    if (beat !== lastBeat) lastBeat = beat;
    if (st > song.length + 1) end();
  }

  function updateHud() {
    $('score').textContent = score || 0;
    $('combo').textContent = combo || 0;
    $('best').textContent = Arcade.getBest(ID);
  }

  // ---------- Input ----------

  // Browsers only start audio after a click or key press; if it's still blocked, the next one starts it.
  const unblock = () => { if (audio && audio.state === 'suspended' && state === 'play') audio.resume(); };
  window.addEventListener('pointerdown', unblock, true);
  window.addEventListener('keydown', unblock, true);

  window.addEventListener('keydown', e => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (state === 'play') pause();
      else if (state === 'paused') resume();
      return;
    }
    const lane = KEYS.findIndex(k => k.includes(e.code));
    if (lane < 0 || e.repeat) return;
    e.preventDefault();
    press(lane);
  });
  window.addEventListener('keyup', e => {
    const lane = KEYS.findIndex(k => k.includes(e.code));
    if (lane >= 0) release(lane);
  });

  function toBoard(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }
  // Touch: tap anywhere in a lane's column. Each finger is tracked so holds work.
  const touches = new Map();
  canvas.addEventListener('pointerdown', e => {
    const [x] = toBoard(e);
    const lane = Math.floor((x - LANE_X) / LANE_W);
    if (lane < 0 || lane >= LANES) return;
    e.preventDefault();
    touches.set(e.pointerId, lane);
    press(lane);
  });
  const lift = e => {
    if (!touches.has(e.pointerId)) return;
    release(touches.get(e.pointerId));
    touches.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  function pause() {
    state = 'paused';
    audio.suspend();
    ui.show({ title: 'Paused', button: 'Resume', onAction: resume, html: '<div class="menu"><button class="btn secondary" type="button" data-quit>Quit to songs</button></div>', onRender: p => p.querySelector('[data-quit]').addEventListener('click', showMenu) });
  }
  function resume() {
    state = 'play';
    audio.resume();
    ui.hide();
  }
  Arcade.onBlur(() => { if (state === 'play') pause(); });

  // ---------- Menu ----------

  // 1-5 stars from how hard the Hard chart is (notes a second, weighted by tempo), relative to the
  // easiest and hardest songs in the list.
  let rating = null;
  function stars(S) {
    if (!rating) {
      const load = SONGS.map(x => {
        const comp = compose(x);
        return chart(comp, DIFFS.hard, x).length / (comp.beats * 60 / x.bpm) * Math.sqrt(x.bpm / 120);
      });
      const lo = Math.min(...load), hi = Math.max(...load);
      rating = Object.fromEntries(SONGS.map((x, i) => [x.id, 1 + Math.round(4 * (load[i] - lo) / (hi - lo || 1))]));
    }
    return '★'.repeat(rating[S.id]) + '☆'.repeat(5 - rating[S.id]);
  }

  function menuHtml() {
    const bests = Arcade.load(BEST_KEY, {});
    const rows = SONGS.map(s => {
      const cells = Object.keys(DIFFS).map(d => {
        const b = bests[`${s.id}:${d}`];
        const on = choice.song === s.id && choice.diff === d;
        return `<button class="btn ${on ? '' : 'secondary'}" type="button" data-song="${s.id}" data-diff="${d}" style="flex:1;flex-direction:column;padding:5px 4px;line-height:1.15;min-width:0">
          <span>${DIFFS[d].name}</span><small style="font-weight:400;opacity:.8">${b ? `${b.grade} · ${b.score.toLocaleString()}` : '—'}</small></button>`;
      }).join('');
      return `<div style="text-align:left;margin:8px 0 2px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
          <b style="color:${s.color}">${s.name}</b>
          <span style="color:var(--muted);font-size:12px">${s.tag ? s.tag + ' · ' : ''}${s.bpm} BPM · <span title="Hard difficulty" style="color:#ffd23f">${stars(s)}</span></span>
        </div><div class="row">${cells}</div>`;
    }).join('');
    return `<p>Hit <b>D F J K</b> (or the arrow keys, or tap the lanes) as notes cross the line. Hold long notes until they end.</p>
      <div class="menu">
        <div style="max-height:min(46vh,340px);overflow-y:auto;padding-right:4px">${rows}</div>
        <div class="row" style="align-items:center;margin-top:6px"><button class="btn secondary" type="button" data-off="-10">−10</button>
        <span style="flex:1;font-size:12px;color:var(--muted)">Timing offset: <b data-offv>${offsetMs}</b> ms</span>
        <button class="btn secondary" type="button" data-off="10">+10</button></div>
        <p style="font-size:12px;margin:0">If notes feel early, raise the offset. If they feel late, lower it.</p>
      </div>`;
  }

  function wireMenu(panel) {
    panel.querySelector(`[data-song="${choice.song}"][data-diff="${choice.diff}"]`)?.scrollIntoView({ block: 'nearest' });
    panel.querySelectorAll('[data-song]').forEach(b => b.addEventListener('click', () => begin(b.dataset.song, b.dataset.diff)));
    panel.querySelectorAll('[data-off]').forEach(b => b.addEventListener('click', () => {
      offsetMs = Math.max(-200, Math.min(200, offsetMs + +b.dataset.off));
      Arcade.save(OFFSET_KEY, offsetMs);
      panel.querySelector('[data-offv]').textContent = offsetMs;
    }));
  }

  function showMenu() {
    if (audio) audio.suspend();
    state = 'menu';
    ui.show({ title: 'Beat Lane', html: menuHtml(), button: `Play ${SONGS.find(s => s.id === choice.song).name} (${DIFFS[choice.diff].name})`, onAction: () => begin(), onRender: wireMenu });
  }

  // ---------- Drawing ----------

  function draw(dt) {
    const st = song && audio && state !== 'menu' ? songTime() : 0;
    const beatPhase = song ? (((st / spb()) % 1) + 1) % 1 : 0;
    const pulse = state === 'play' ? Math.max(0, 1 - beatPhase * 4) : 0;
    const accent = song ? song.color : '#3ef0ff';

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#07060f');
    g.addColorStop(1, '#170d2b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Beat-pulsing rings.
    ctx.strokeStyle = accent;
    for (let k = 0; k < 4; k++) {
      ctx.globalAlpha = 0.06 + pulse * 0.08;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W / 2, HIT_Y, 160 + k * 110 + pulse * 12, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Lanes.
    for (let l = 0; l < LANES; l++) {
      const x = LANE_X + l * LANE_W;
      ctx.fillStyle = l % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, 0, LANE_W, H);
      if (flashes && flashes[l] > 0) {
        const lg = ctx.createLinearGradient(0, HIT_Y, 0, HIT_Y - 260);
        lg.addColorStop(0, LANE_COLORS[l] + '55');
        lg.addColorStop(1, LANE_COLORS[l] + '00');
        ctx.globalAlpha = flashes[l];
        ctx.fillStyle = lg;
        ctx.fillRect(x, HIT_Y - 260, LANE_W, 260);
        ctx.globalAlpha = 1;
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let l = 0; l <= LANES; l++) {
      ctx.beginPath();
      ctx.moveTo(LANE_X + l * LANE_W + 0.5, 0);
      ctx.lineTo(LANE_X + l * LANE_W + 0.5, H);
      ctx.stroke();
    }

    // Notes.
    if (notes && state !== 'menu') {
      const jt = st - offsetMs / 1000;
      const sp = fallSpeed();
      for (const n of notes) {
        if (n.done && !n.hit) continue;
        const y = HIT_Y - (n.time - jt) * sp;
        if (y < -400) break;
        const x = LANE_X + n.lane * LANE_W + 8, w = LANE_W - 16;
        const c = LANE_COLORS[n.lane];
        if (n.len) {
          const yEnd = HIT_Y - (n.end - jt) * sp;
          const top = Math.max(-10, yEnd), bottom = n.hit ? HIT_Y : y;
          if (!n.done && bottom > top) {
            ctx.fillStyle = c + (n.hit ? 'aa' : '55');
            ctx.fillRect(x + w * 0.3, top, w * 0.4, bottom - top);
          }
        }
        if (n.hit || n.done) continue;
        if (y > H + 40) continue;
        ctx.fillStyle = c;
        ctx.shadowColor = c;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.roundRect(x, y - NOTE_H / 2, w, NOTE_H, 6);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(x + 6, y - NOTE_H / 2 + 4, w - 12, 3);
      }
    }

    // Hit line and keys.
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(LANE_X, HIT_Y - 2, LANES * LANE_W, 4);
    for (let l = 0; l < LANES; l++) {
      const x = LANE_X + l * LANE_W;
      const on = held && held[l];
      ctx.strokeStyle = LANE_COLORS[l];
      ctx.lineWidth = on ? 4 : 2;
      ctx.beginPath();
      ctx.roundRect(x + 10, HIT_Y - 14, LANE_W - 20, 28, 8);
      ctx.stroke();
      ctx.fillStyle = on ? LANE_COLORS[l] : 'rgba(255,255,255,0.5)';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(KEY_LABELS[l], x + LANE_W / 2, HIT_Y + 44);
    }

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
      p.life -= dt;
      ctx.globalAlpha = Math.max(0, p.life * 2.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    particles = particles.filter(p => p.life > 0);

    if (!song || state === 'menu') return;

    // Judgement and combo.
    if (judgement && judgement.t < 0.6) {
      const colors = { perfect: '#ffd23f', great: '#7ed957', good: '#3ef0ff', miss: '#ff6b6b' };
      ctx.globalAlpha = 1 - judgement.t / 0.6;
      ctx.fillStyle = colors[judgement.kind];
      ctx.font = `800 ${30 + (1 - judgement.t / 0.6) * 6}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(judgement.kind.toUpperCase(), W / 2, 250);
      ctx.globalAlpha = 1;
    }
    if (combo >= 5) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(combo, W / 2, 200);
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`COMBO · ×${mult()}`, W / 2, 218);
    }

    // Side panels.
    ctx.textAlign = 'left';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillStyle = song.color;
    ctx.fillText(song.name, 24, 40);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = '#8d94a1';
    ctx.fillText(`${DIFFS[diff].name} · ${song.bpm} BPM`, 24, 60);
    ctx.fillText(`Perfect ${counts.perfect}`, 24, 100);
    ctx.fillText(`Great ${counts.great}`, 24, 118);
    ctx.fillText(`Good ${counts.good}`, 24, 136);
    ctx.fillText(`Miss ${counts.miss}`, 24, 154);
    // Health.
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(W - 54, 40, 18, 300);
    ctx.fillStyle = health > 50 ? '#7ed957' : health > 25 ? '#ffd23f' : '#ff6b6b';
    const hh = 300 * Math.max(0, health) / 100;
    ctx.fillRect(W - 54, 340 - hh, 18, hh);
    ctx.textAlign = 'center';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = '#8d94a1';
    ctx.fillText('LIFE', W - 45, 358);
    // Progress.
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, H - 4, W, 4);
    ctx.fillStyle = song.color;
    ctx.fillRect(0, H - 4, W * Math.max(0, Math.min(1, st / song.length)), 4);
    if (state === 'play' && audio.state === 'suspended') {
      ctx.fillStyle = '#ffd23f';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Tap or press any key to start the music', W / 2, 300);
    }
    if (st < 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 48px system-ui, sans-serif';
      ctx.fillText(Math.ceil(-st), W / 2, 230);
    }
  }

  // ---------- Loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'play') update();
    if (flashes) for (let l = 0; l < LANES; l++) flashes[l] = Math.max(held[l] ? 0.6 : 0, flashes[l] - dt * 4);
    if (judgement) judgement.t += dt;
    draw(dt);
    requestAnimationFrame(frame);
  }

  Versus.attach({
    ui,
    // Duels always use the same chart so the scores compare fairly.
    start: () => (Versus.active() ? begin('parade', 'normal') : begin()),
    score: () => score || 0,
    intro: {
      title: 'Beat Lane',
      html: menuHtml(),
      button: `Play ${SONGS.find(s => s.id === choice.song).name} (${DIFFS[choice.diff].name})`,
      onAction: () => begin(),
      onRender: wireMenu,
    },
  });
  requestAnimationFrame(frame);
})();
