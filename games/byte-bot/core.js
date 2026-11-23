/* Byte Bot: the levels and the program interpreter, shared by the game and the level checker.
   Map: . floor · * tile to light · (space) nothing. dir: 0 east, 1 south, 2 west, 3 north.
   slots: how many commands fit in Main, P1 and P2 (0 = that function isn't available yet).
   par: commands in the reference solution (ref), which the checker runs. */
(function (root) {
  const LEVELS = [
    { name: 'Hello, Bot', map: ['....*'], start: [0, 0, 0], slots: [8, 0, 0], par: 5, tip: 'Add Forward four times, then Light. Press Run!',
      ref: { main: 'FFFFX' } },
    { name: 'Turn Around', map: ['...', '  .', '  *'], start: [0, 0, 0], slots: [8, 0, 0], par: 6, tip: 'Turn Right turns the bot clockwise, on the spot.',
      ref: { main: 'FFRFFX' } },
    { name: 'Two Lights', map: ['..*', '  .', '  *'], start: [0, 0, 0], slots: [10, 0, 0], par: 7,
      ref: { main: 'FFXRFFX' } },
    { name: 'Copy and Paste', map: ['.******'], start: [0, 0, 0], slots: [4, 4, 0], par: 7, tip: 'Main is too short now. Put "Forward, Light" in P1, then call P1 from Main.',
      ref: { main: '111', p1: 'FXFX' } },
    { name: 'Staircase', map: ['..   ', ' *.  ', '  *. ', '   *.', '    *'], start: [0, 0, 0], slots: [4, 5, 0], par: 9,
      ref: { main: '1111', p1: 'FRFLX' }, note: 'the last call bumps off the edge, harmlessly' },
    { name: 'Again and Again', map: ['.*********'], start: [0, 0, 0], slots: [1, 3, 0], par: 4, tip: 'A function can call itself. It keeps going until every tile is lit.',
      ref: { main: '1', p1: 'FX1' } },
    { name: 'Round the Block', map: ['...*', '.  .', '.  .', '*..*'], start: [0, 0, 0], slots: [4, 5, 0], par: 9,
      ref: { main: '1111', p1: 'FFFXR' } },
    { name: 'Diagonal Dash', map: ['..    ', ' *.   ', '  *.  ', '   *. ', '    *.', '     *'], start: [0, 0, 0], slots: [1, 6, 0], par: 7,
      ref: { main: '1', p1: 'FRFLX1' } },
    { name: 'Mow the Lawn', map: ['*****', '*****'], start: [0, 0, 0], slots: [6, 2, 5], par: 12, tip: 'P2 can call P1. Build small pieces, then bigger ones.',
      ref: { main: '2RFR2', p1: 'XF', p2: '1111X' } },
    { name: 'Grand Tour', map: ['..*.*', '.   .', '*   *', '.   .', '*.*.*'], start: [0, 0, 0], slots: [4, 3, 3], par: 10,
      ref: { main: '2222', p1: 'FFX', p2: '11R' } },
    { name: 'Spiral', map: ['*****', '    *', '***.*', '*...*', '*****'], start: [0, 0, 0], slots: [8, 4, 4], par: 14, tip: 'Count the tiles on each side of the spiral.',
      ref: { main: 'X2221R1', p1: 'FXFX', p2: '11R' } },
    { name: 'Checkerboard', map: ['*.*.*', '.*.*.', '*.*.*'], start: [0, 0, 0], slots: [12, 4, 4], par: 18, tip: 'Only every other tile lights up. Moving two at a time helps.',
      ref: { main: '2RFRFX1FLFL2', p1: 'FFX', p2: 'X11' } },
  ];

  const parse = s => [...(s || '')];
  // Runs a program. Returns the list of states after each step ({ x, y, d, lit, cmd, bump, fn, at })
  // and whether every tile ended up lit.
  function run(level, prog, maxSteps = 400) {
    const map = level.map, h = map.length, w = Math.max(...map.map(r => r.length));
    const tile = (x, y) => (y >= 0 && y < h && x >= 0 && x < w ? map[y][x] || ' ' : ' ');
    const targets = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tile(x, y) === '*') targets.push(x + ',' + y);
    let [x, y, d] = level.start;
    const lit = new Set();
    const fns = { main: parse(prog.main), p1: parse(prog.p1), p2: parse(prog.p2) };
    const stack = [{ fn: 'main', i: 0 }];
    const steps = [];
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    while (stack.length && steps.length < maxSteps) {
      const top = stack[stack.length - 1];
      if (top.i >= fns[top.fn].length) { stack.pop(); continue; }
      const c = fns[top.fn][top.i++];
      const at = { fn: top.fn, i: top.i - 1 };
      let bump = false;
      if (c === 'F') { const nx = x + DX[d], ny = y + DY[d]; if (tile(nx, ny) !== ' ') { x = nx; y = ny; } else bump = true; }
      else if (c === 'L') d = (d + 3) % 4;
      else if (c === 'R') d = (d + 1) % 4;
      else if (c === 'X') { if (tile(x, y) === '*') { const k = x + ',' + y; if (lit.has(k)) lit.delete(k); else lit.add(k); } }
      else if (c === '1' || c === '2') { if (stack.length < 60) stack.push({ fn: c === '1' ? 'p1' : 'p2', i: 0 }); }
      steps.push({ x, y, d, lit: new Set(lit), cmd: c, bump, at });
      if (targets.length && targets.every(t => lit.has(t))) return { steps, win: true };
    }
    return { steps, win: false, ranOut: steps.length >= maxSteps };
  }

  const size = prog => ['main', 'p1', 'p2'].reduce((t, k) => t + parse(prog[k]).length, 0);
  const api = { LEVELS, run, size };
  if (typeof module !== 'undefined') module.exports = api;
  else root.ByteBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
