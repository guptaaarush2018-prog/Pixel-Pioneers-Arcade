(() => {
  const ID = 'beat-lane';
  const W = 960, H = 540;
  const LANES = 4, LANE_W = 92, LANE_X = (W - LANES * LANE_W) / 2, HIT_Y = 452, NOTE_H = 22;
  const KEYS = [['KeyD', 'ArrowLeft'], ['KeyF', 'ArrowDown'], ['KeyJ', 'ArrowUp'], ['KeyK', 'ArrowRight']];
  const KEY_LABELS = ['D', 'F', 'J', 'K'];
  const LANE_COLORS = ['#ff4fd8', '#3ef0ff', '#ffd23f', '#7ed957'];
  const WINDOWS = { perfect: 0.045, great: 0.09, good: 0.135, early: 0.25 };
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
    // The Extreme set: fast songs written for Expert and Insane, where every 16th can be a note.
    { id: 'breaker', name: 'Circuit Breaker', tag: 'Drum & Bass', extreme: true, bpm: 174, root: 45, scale: 'minor', prog: [0, 5, 2, 6], seed: 191, lead: 'sawtooth', color: '#00e5a0',
      drums: 'dnb', bass: 'reese', arp: true,
      form: [['intro', 4, 0.35], ['A', 8, 0.7], ['B', 8, 0.9], ['A', 8, 0.75], ['C', 4, 0.55], ['B', 8, 0.95], ['B', 8, 1], ['outro', 4, 0.4]] },
    { id: 'hyper', name: 'Hyperdrive', tag: 'Extreme', extreme: true, bpm: 196, root: 47, scale: 'harmonic', prog: [0, 3, 5, 4], seed: 211, lead: 'square', color: '#ff8a00',
      drums: 'four', bass: 'octave', arp: true,
      form: [['intro', 4, 0.4], ['A', 8, 0.75], ['B', 8, 0.95], ['C', 4, 0.6], ['A', 8, 0.85], ['B', 8, 1], ['outro', 4, 0.45]] },
    { id: 'glitch', name: 'Glitch Storm', tag: 'Breakcore', extreme: true, bpm: 210, root: 44, scale: 'phrygian', prog: [0, 1, 4, 0], seed: 233, lead: 'sawtooth', color: '#e040fb',
      drums: 'amen', bass: 'offbeat', arp: true,
      form: [['intro', 4, 0.4], ['A', 8, 0.8], ['B', 8, 1], ['C', 4, 0.65], ['B', 8, 1], ['A', 8, 0.9], ['B', 8, 1], ['outro', 4, 0.5]] },
    { id: 'horizon', name: 'Event Horizon', tag: 'Final', extreme: true, bpm: 228, root: 41, scale: 'harmonic', prog: [0, 1, 5, 4], seed: 257, lead: 'sawtooth', color: '#ffffff',
      drums: 'blast', bass: 'octave', arp: true,
      form: [['intro', 4, 0.45], ['A', 8, 0.85], ['B', 8, 1], ['C', 8, 0.7], ['B', 8, 1], ['B', 8, 1], ['A', 8, 0.95], ['outro', 4, 0.6]] },
    { id: 'singularity', name: 'Singularity', tag: 'Speedcore', extreme: true, bpm: 240, root: 40, scale: 'phrygian', prog: [0, 6, 1, 0], seed: 281, lead: 'square', color: '#ff1744',
      drums: 'blast', bass: 'reese', arp: true,
      form: [['intro', 4, 0.5], ['A', 8, 0.9], ['B', 8, 1], ['B', 8, 1], ['C', 4, 0.75], ['B', 8, 1], ['B', 8, 1], ['outro', 4, 0.7]] },
  ];
  const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
  };
  // Clearing every song on any difficulty, and the boss on Hard, are achievements.
  const BOSS = 'boss', FINAL = 'singularity';
  // Expert and Insane build on the Hard chart: 16th-note runs, jumps and hands (2-3 notes at once),
  // and every note it adds plays a key sound so the chart is always something you can hear.
  //   speed: how much faster notes fall   drain: life lost per miss
  const DIFFS = {
    easy: { name: 'Easy', gap: 1, holds: false, kicks: false },
    normal: { name: 'Normal', gap: 0.5, holds: true, kicks: false },
    hard: { name: 'Hard', gap: 0.25, holds: true, kicks: true },
    expert: { name: 'Expert', gap: 0.25, holds: true, kicks: true, tier: 1, speed: 1.25, drain: 8 },
    insane: { name: 'Insane', gap: 0.25, holds: true, kicks: true, tier: 2, speed: 1.45, drain: 9 },
  };
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
    } else if (style === 'dnb') {
      // Two-step: kick on 1 and the "and" of 3, snare on 2 and 4, rolling 16th hats.
      kick(0);
      kick(2.5);
      if (busy && b % 2) kick(1.75);
      snare(1);
      snare(3);
      if (hats) for (let e = 0; e < 16; e++) hat(e * 0.25, e % 2 === 1);
      if (name === 'B' && b % 4 === 3) snare(3.5), snare(3.75);
    } else if (style === 'amen') {
      // A chopped-up break that changes every bar.
      const chops = [[0, 'k'], [0.5, 'k'], [1, 's'], [1.75, 's'], [2.25, 'k'], [2.5, 'k'], [3, 's'], [3.5, 's']];
      chops.forEach(([t, k], i) => { if ((b + i) % 5 !== 4 || !busy) (k === 'k' ? kick : snare)(t); });
      if (busy) snare(3.75), snare(b % 2 ? 2.75 : 0.75);
      if (hats) for (let e = 0; e < 16; e++) hat(e * 0.25, e % 4 !== 2);
    } else if (style === 'blast') {
      // Kicks on every 8th (16ths in the loudest parts), snare on every beat's off-beat.
      for (let e = 0; e < (busy ? 16 : 8); e++) kick(e * (busy ? 0.25 : 0.5));
      for (let beat = 0; beat < 4; beat++) snare(beat + 0.5);
      if (hats) for (let beat = 0; beat < 4; beat++) hat(beat);
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

  // Returns timed events (in beats): drums, bass, pads and a lead melody. Songs never change, so
  // each one is composed once.
  const composed = {};
  function compose(S) {
    return composed[S.id] || (composed[S.id] = composeSong(S));
  }
  function composeSong(S) {
    const sc = SCALES[S.scale];
    const deg = (d, oct = 0) => S.root + sc[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
    const out = [];
    const motifs = {};
    const sections = [], chords = [];
    let bar = 0;
    const drums = S.drums || 'rock', bassStyle = S.bass || 'eighths', chordBars = S.chordBars || 1;
    for (const [name, bars, energy] of S.form || FORM) {
      sections.push({ name, energy, start: bar * 4, end: (bar + bars) * 4 });
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
        chords.push(chord);
        const t0 = bar * 4;
        drumBar(out, drums, name, energy, b, t0);
        // Bass.
        if (bassStyle === 'eighths') for (let e = 0; e < 8; e++) out.push({ t: t0 + e * 0.5, type: 'bass', midi: deg(chord + (e % 4 === 3 ? 4 : 0), -1), dur: 0.45 });
        else if (bassStyle === 'offbeat') for (let e = 1; e < 8; e += 2) out.push({ t: t0 + e * 0.5, type: 'bass', midi: deg(chord + (e === 7 ? 4 : 0), -1), dur: 0.4 });
        else if (bassStyle === 'octave') for (let e = 0; e < 8; e++) out.push({ t: t0 + e * 0.5, type: 'bass', midi: deg(chord, e % 2 ? 0 : -1), dur: 0.4 });
        else if (bassStyle === 'pulse') for (let q = 0; q < 4; q++) out.push({ t: t0 + q, type: 'bass', midi: deg(chord + (q === 3 ? 4 : 0), -1), dur: 0.9 });
        else if (bassStyle === 'walk') [0, 2, 4, 5].forEach((d, q) => out.push({ t: t0 + q, type: 'bass', midi: deg(chord + d, -1), dur: 0.85 }));
        else if (bassStyle === 'reese') [0, 1.5, 2.5, 3].forEach((q, i) => out.push({ t: t0 + q, type: 'bass', midi: deg(chord + (i === 3 && b % 2 ? 4 : 0), -1), dur: i === 0 ? 1.4 : 0.45 }));
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
    return { events: out.sort((a, b) => a.t - b.t), beats: bar * 4, sections, chords, deg };
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
    // Lead notes are in time order, so a binary search finds the ones near t.
    const beats = out.map(n => n.beat), holds = out.filter(n => n.len), first = new Map();
    for (const n of out) if (!n.len && !first.has(n.beat)) first.set(n.beat, n);
    const busy = (t, pad) => {
      let lo = 0, hi = beats.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (beats[mid] <= t - pad) lo = mid + 1; else hi = mid; }
      if (lo < beats.length && Math.abs(beats[lo] - t) < pad) return true;
      return holds.some(n => t > n.beat - 0.1 && t < n.beat + n.len + 0.25);
    };
    const extra = [];
    // extra fills in time order too, so only its last note can be near t.
    const nearExtra = t => extra.length > 0 && Math.abs(extra[extra.length - 1].beat - t) < 0.3;
    for (const e of comp.events) {
      const edge = e.t < 16 || e.t >= comp.beats - 16;
      // Warm-up taps on the kick during the intro and outro.
      if (e.type === 'kick' && edge && e.t % 2 === 0 && !busy(e.t, 0.6)) extra.push({ beat: e.t, lane: (e.t / 2) % 4, len: 0 });
      if (!D.kicks || edge) continue;
      // Hard: the bass fills the off-beats, and the first beat of each bar is a two-note chord.
      if (e.type === 'bass' && e.t % 1 === 0.5 && !busy(e.t, 0.3) && !nearExtra(e.t)) extra.push({ beat: e.t, lane: e.midi % 4, len: 0 });
      // Songs whose bass sits on the beat get their off-beat notes from the hi-hat instead.
      if (hatFill && e.type === 'hat' && e.t % 1 === 0.5 && !busy(e.t, 0.3) && !nearExtra(e.t)) extra.push({ beat: e.t, lane: Math.floor(e.t * 2 + e.t / 4) % 4, len: 0 });
      if (e.type === 'kick' && e.t % 4 === 0) {
        const n = first.get(e.t);
        if (n) extra.push({ beat: e.t, lane: (n.lane + 2) % 4, len: 0 });
      }
    }
    const all = [...out, ...extra].sort((a, b) => a.beat - b.beat);
    if (D.tier) return harder(all, comp, D, S);
    // The original twelve songs keep their charts exactly (so old bests still compare); the
    // Extreme set goes through the same playability limits as Expert and Insane.
    return S.extreme ? playable(all, [], S) : all;
  }

  // Human limits, in seconds of real time. D and F are the left hand, J and K the right.
  //   FINGER: the same key pressed again (after a tap, or after letting go of a hold)
  //   HAND:   two different moments on the same hand (pressing together, as a chord, is fine)
  // At 240 BPM a 16th is 0.0625 s, so full-speed runs have to alternate hands, the way real
  // stream charts do, and a jack (one key repeated) can't be faster than about 7 a second.
  const FINGER = 0.14, HAND = 0.1;
  function playable(keep, extra, S) {
    const sec = b => swung(b, S.swing) * 60 / S.bpm;
    const lanes = [[], [], [], []], hands = [[], []];
    // Sorted insert, and "is anything within gap of t (other than exactly t)".
    const put = (arr, v) => {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
      arr.splice(lo, 0, v);
    };
    const near = (arr, t, gap, sameOk) => {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t - gap) lo = m + 1; else hi = m; }
      for (let i = lo; i < arr.length && arr[i] < t + gap; i++) if (!(sameOk && Math.abs(arr[i] - t) < 1e-6)) return true;
      return false;
    };
    const fits = n => {
      const t = sec(n.beat), end = sec(n.beat + n.len), h = n.lane >> 1;
      if (near(lanes[n.lane], t, FINGER, false)) return false;
      if (n.len && near(lanes[n.lane], end, FINGER, false)) return false;
      return !near(hands[h], t, HAND, true);
    };
    const take = n => {
      const t = sec(n.beat);
      put(lanes[n.lane], t);
      if (n.len) put(lanes[n.lane], sec(n.beat + n.len));
      if (!hands[n.lane >> 1].some(x => Math.abs(x - t) < 1e-6)) put(hands[n.lane >> 1], t);
    };
    const out = [];
    for (const group of [keep, extra]) for (const n of group) if (fits(n)) { take(n); out.push(n); }
    return out.sort((a, b) => a.beat - b.beat || a.lane - b.lane);
  }

  // Expert and Insane. Walks the song on a 16th-note grid and fills it with patterns (rolls,
  // trills, zig-zags, jacks), turns drum hits into jumps and hands, and never puts a tap inside
  // a held note's lane. Seeded, so a song's chart is always the same.
  const PATTERNS = [
    [0, 1, 2, 3], [3, 2, 1, 0], [0, 2, 1, 3], [3, 1, 2, 0], [0, 3, 0, 3], [1, 2, 1, 2],
    [0, 1, 0, 2], [3, 2, 3, 1], [0, 2, 3, 1], [1, 3, 0, 2], [0, 0, 3, 3], [2, 1, 3, 0],
  ];
  // Patterns that switch hands on every note: the only way to stream 16ths once they come faster
  // than one hand can manage (see HAND below).
  const SPLIT = [[0, 2, 1, 3], [3, 1, 2, 0], [1, 3, 0, 2], [0, 3, 1, 2], [2, 0, 3, 1], [1, 2, 0, 3], [3, 0, 2, 1], [2, 1, 3, 0]];
  function harder(base, comp, D, S) {
    const r = seeded(S.seed * 31 + D.tier * 7);
    // Notes indexed by their 16th (swing-free charts keep every beat on that grid).
    const grid = new Map();
    const holds = base.filter(n => n.len);
    const slot = t => Math.round(t * 4);
    const at = t => grid.get(slot(t)) || [];
    for (const n of base) {
      const q = slot(n.beat);
      if (!grid.has(q)) grid.set(q, []);
      grid.get(q).push({ ...n });
    }
    const holdAt = (lane, t) => holds.some(n => n.lane === lane && t > n.beat - 0.05 && t < n.beat + n.len + 0.2);
    const add = (t, lane, key = true) => {
      if (holdAt(lane, t) || at(t).some(n => n.lane === lane)) return false;
      const q = slot(t);
      if (!grid.has(q)) grid.set(q, []);
      grid.get(q).push({ beat: t, lane, len: 0, key });
      return true;
    };
    const drums = new Map();
    for (const e of comp.events) if (e.type === 'kick' || e.type === 'snare') drums.set(Math.round(e.t * 4), e.type);
    const end = comp.beats - 8;
    const pool = 15 / S.bpm < HAND ? SPLIT : PATTERNS;
    let pat = pool[0], pi = 0;
    for (const sec of comp.sections) {
      const e = sec.energy, intro = sec.name === 'intro' || sec.name === 'outro';
      // How much of the 16th grid gets filled.
      const fill = D.tier === 2 ? (intro ? 0.25 : e >= 0.85 ? 1 : e >= 0.6 ? 0.8 : 0.5) : (intro ? 0 : e >= 0.85 ? 0.6 : e >= 0.6 ? 0.4 : 0.2);
      for (let q = sec.start * 4; q < sec.end * 4; q++) {
        const t = q / 4;
        if (t < 4 || t >= end) continue;
        // A new pattern every beat, sometimes every half beat on Insane.
        if (q % 4 === 0 || (D.tier === 2 && q % 2 === 0 && r() < 0.25)) { pat = pool[Math.floor(r() * pool.length)]; pi = 0; }
        const here = at(t);
        const drum = drums.get(q);
        if (!here.length) {
          const onBeat = q % 2 === 0;
          if (!(onBeat ? r() < Math.min(1, fill + 0.3) : r() < fill)) { pi++; continue; }
          add(t, pat[pi++ % 4]);
        } else pi++;
        // Jumps and hands on the drums.
        const lanes = at(t).map(n => n.lane);
        if (drum && !intro && q % 2 === 0) {
          const want = D.tier === 2
            ? (q % 16 === 0 && e >= 0.8 ? 3 : (drum === 'snare' || q % 4 === 0) && e >= 0.7 ? 2 : 1)
            : (drum === 'snare' && e >= 0.7 && q % 4 === 0 ? 2 : q % 16 === 0 ? 2 : 1);
          for (let k = 0; lanes.length < want && k < 8; k++) {
            const lane = Math.floor(r() * 4);
            if (!lanes.includes(lane) && add(t, lane)) lanes.push(lane);
          }
        }
      }
    }
    // Insane: short jack bursts (the same lane three times on 8ths) at the end of loud bars.
    if (D.tier === 2) {
      for (const sec of comp.sections) {
        if (sec.energy < 0.85) continue;
        for (let bar = sec.start; bar < sec.end; bar += 8) {
          const lane = Math.floor(r() * 4), t = bar + 7;
          if (t >= end) continue;
          for (let k = 0; k < 3; k++) {
            const tt = t + k * 0.5;
            grid.set(slot(tt), at(tt).filter(n => n.len));
            add(tt, lane);
          }
        }
      }
    }
    // The melody and drum hits come first; the runs added on top give way wherever they'd break
    // a human limit. Jack bursts are spaced as 8ths so they survive at any tempo up to 240.
    const merged = [...grid.values()].flat().sort((a, b) => a.beat - b.beat || a.lane - b.lane);
    return playable(merged.filter(n => !n.key), merged.filter(n => n.key), S);
  }

  // A soft pluck for each note Expert and Insane add, pitched to the chord of its bar.
  function keySounds(comp, chartNotes) {
    const out = [];
    const sounding = new Set(comp.events.filter(e => e.type === 'lead' || e.type === 'arp').map(e => Math.round(e.t * 4)));
    const seen = new Set();
    for (const n of chartNotes) {
      if (!n.key) continue;
      const q = Math.round(n.beat * 4);
      if (sounding.has(q) || seen.has(q)) continue;
      seen.add(q);
      const chord = comp.chords[Math.floor(n.beat / 4)] || 0;
      out.push({ t: n.beat, type: 'key', midi: comp.deg(chord + [0, 2, 4, 7][n.lane], 1), dur: 0.2 });
    }
    return out;
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
    else if (ev.type === 'key') voice('triangle', freq(ev.midi), at, Math.min(0.12, ev.dur * spb), 0.045, 4000);
    else if (ev.type === 'pad') for (const m of ev.midi) voice('triangle', freq(m), at, ev.dur * spb, 0.035, 1800);
  }

  // ---------- Game ----------

  const spb = () => 60 / song.bpm;
  const songTime = () => audio.currentTime - startAt;   // seconds since the first beat
  const judgeTime = () => songTime() - offsetMs / 1000;
  // px per second; capped so every note is on screen for at least half a second before it lands.
  const fallSpeed = () => Math.min(880, (380 + song.bpm * 1.2) * (DIFFS[diff].speed || 1));

  function begin(songId = choice.song, diffId = choice.diff) {
    ensureAudio();
    audio.resume();
    song = SONGS.find(s => s.id === songId) || SONGS[0];
    diff = diffId;
    choice = { song: song.id, diff };
    Arcade.save(CHOICE_KEY, choice);
    const comp = compose(song);
    const at = t => swung(t, song.swing) * spb();
    const charted = chart(comp, DIFFS[diff], song);
    const all = DIFFS[diff].tier ? [...comp.events, ...keySounds(comp, charted)].sort((a, b) => a.t - b.t) : comp.events;
    events = all.map(e => ({ ...e, time: at(e.t) }));
    notes = charted.map(n => ({ ...n, time: at(n.beat), end: at(n.beat + n.len), done: false }));
    song.length = comp.beats * spb();
    evIdx = 0;
    startAt = audio.currentTime + LEAD_IN;
    score = 0;
    combo = 0;
    maxCombo = 0;
    health = 100;
    counts = { perfect: 0, great: 0, good: 0, miss: 0, ghost: 0 };
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
      health -= tail ? 4 : (DIFFS[diff].drain || 7);
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
    let best = null, early = null;
    for (const n of notes) {
      if (n.done || n.lane !== lane || n.hit) continue;
      const d = Math.abs(n.time - now);
      if (d <= WINDOWS.good && (!best || d < Math.abs(best.time - now))) best = n;
      if (!early && n.time - now > WINDOWS.good && n.time - now <= WINDOWS.early) early = n;
      if (n.time - now > WINDOWS.early) break;
    }
    // Mashing costs you. Pressing far too early uses the note up as a miss, and a press with no
    // note near it at all is a ghost tap: it breaks the combo and drains life.
    if (!best && early) {
      early.done = true;
      judge(early, 'miss');
      return;
    }
    if (!best) return ghost(lane);
    const d = Math.abs(best.time - now);
    const kind = d <= WINDOWS.perfect ? 'perfect' : d <= WINDOWS.great ? 'great' : 'good';
    if (best.len) best.hit = true; // now hold it
    else best.done = true;
    judge(best, kind);
    burst(lane, kind);
  }

  function ghost(lane) {
    counts.ghost++;
    combo = 0;
    health -= DIFFS[diff].tier ? 3 : 2;
    score = Math.max(0, score - 25);
    judgement = { kind: 'ghost', t: 0 };
    if (health <= 0 && !failed) fail();
    updateHud();
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
    // Ghost taps count against accuracy too (half a miss each), so mashing can't reach a good rank.
    const acc = total ? (counts.perfect + counts.great * 0.7 + counts.good * 0.4) / (total + counts.ghost * 0.5) : 0;
    const g = failed ? 'F' : grade(acc);
    if (!failed) {
      Arcade.flag('beat-lane-clear');
      if (diff === 'hard' || DIFFS[diff].tier) Arcade.flag('beat-lane-hard');
      if (DIFFS[diff].tier) Arcade.flag('beat-lane-expert');
      if (diff === 'insane') Arcade.flag('beat-lane-insane');
      if (song.id === FINAL && diff === 'insane') Arcade.flag('beat-lane-final');
      if (counts.miss === 0 && counts.ghost === 0) Arcade.flag('beat-lane-fc');
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
        `Perfect ${counts.perfect} · Great ${counts.great} · Good ${counts.good} · Miss ${counts.miss}${counts.ghost ? ` · Ghost taps ${counts.ghost}` : ''}`,
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

  // A level for each chart: notes a second, weighted by tempo (faster songs are harder to read).
  // Computed once per song and difficulty when the menu first opens.
  const levels = {};
  function level(S, d) {
    const key = `${S.id}:${d}`;
    if (!(key in levels)) {
      const comp = compose(S);
      const nps = chart(comp, DIFFS[d], S).length / (comp.beats * 60 / S.bpm);
      levels[key] = Math.max(1, Math.round(nps * Math.sqrt(S.bpm / 120) * 1.1));
    }
    return levels[key];
  }
  const levelColor = n => n >= 20 ? '#ff1744' : n >= 14 ? '#e040fb' : n >= 9 ? '#ff8a00' : n >= 5 ? '#ffd23f' : '#7ed957';

  function menuHtml() {
    const bests = Arcade.load(BEST_KEY, {});
    const rows = SONGS.map(s => {
      const cells = Object.keys(DIFFS).map(d => {
        const b = bests[`${s.id}:${d}`];
        const on = choice.song === s.id && choice.diff === d;
        const lv = level(s, d);
        return `<button class="btn ${on ? '' : 'secondary'}" type="button" data-song="${s.id}" data-diff="${d}" style="flex:1;flex-direction:column;padding:5px 2px;line-height:1.15;min-width:0;font-size:13px">
          <span>${DIFFS[d].name} <b style="color:${levelColor(lv)}">${lv}</b></span><small style="font-weight:400;opacity:.8;font-size:11px">${b ? `${b.grade} · ${b.score.toLocaleString()}` : '—'}</small></button>`;
      }).join('');
      return `<div style="text-align:left;margin:8px 0 2px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
          <b style="color:${s.color}">${s.name}</b>
          <span style="color:var(--muted);font-size:12px">${s.extreme ? '<b style="color:#ff1744">EXTREME</b> · ' : ''}${s.tag ? s.tag + ' · ' : ''}${s.bpm} BPM</span>
        </div><div class="row">${cells}</div>`;
    }).join('');
    return `<p>Hit <b>D F J K</b> (or the arrow keys, or tap the lanes) as notes cross the line. Hold long notes until they end. The number on each button is the chart's level. Expert and Insane add 16th-note runs and two- and three-note chords.</p>
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
      const colors = { perfect: '#ffd23f', great: '#7ed957', good: '#3ef0ff', miss: '#ff6b6b', ghost: '#b07cff' };
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
    if (counts.ghost) {
      ctx.fillStyle = '#b07cff';
      ctx.fillText(`Ghost taps ${counts.ghost}`, 24, 172);
    }
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
