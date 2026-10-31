/* Rune Rumble drawing: troops, buildings, the battlefield for each arena, and card art.
   Troops and buildings are drawn upright around their feet (0, 0), facing +x, in "unit" pixels;
   the caller scales and flips them. The battlefield is drawn in world units with any transform. */
const RuneArt = (() => {
  const TAU = Math.PI * 2;

  const shade = (col, k) => {
    let rgb;
    if (col[0] === '#') {
      const n = parseInt(col.slice(1), 16);
      rgb = [n >> 16, (n >> 8) & 255, n & 255];
    } else rgb = col.match(/[\d.]+/g).slice(0, 3).map(Number);
    const f = c => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
    return `rgb(${rgb.map(f).join(',')})`;
  };
  // A left-lit fill across a shape's width, for rounded, solid-looking bodies.
  const lit = (c, col, x0, x1, k = 0.2) => {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, shade(col, k));
    g.addColorStop(0.55, col);
    g.addColorStop(1, shade(col, -k * 1.2));
    return g;
  };
  const ball = (c, x, y, r, col) => {
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, shade(col, 0.3));
    g.addColorStop(1, shade(col, -0.15));
    return g;
  };
  function seeded(str) {
    let a = 0;
    for (let i = 0; i < str.length; i++) a = (Math.imul(a ^ str.charCodeAt(i), 2654435761) + 1) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const circle = (c, x, y, r, fill) => { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
  const ellipse = (c, x, y, rx, ry, fill) => { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill(); };
  const rrect = (c, x, y, w, h, r, fill) => { c.fillStyle = fill; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };
  const OUT = 'rgba(20,16,24,0.55)';

  // ---------- Troops ----------

  // Weapons are drawn from the hand, pointing up and forward; `swing` rotates them (0 rest, 1 strike).
  function weapon(c, kind, len, swing, team) {
    c.save();
    c.rotate(-0.5 + swing * 1.6);
    c.lineCap = 'round';
    switch (kind) {
      case 'sword': {
        const bw = len * 0.09;
        c.fillStyle = '#9aa3ae';
        c.beginPath(); c.moveTo(-bw, -len * 0.18); c.lineTo(-bw, -len * 0.9); c.lineTo(0, -len * 1.04); c.lineTo(bw, -len * 0.9); c.lineTo(bw, -len * 0.18); c.fill();
        c.fillStyle = '#eef2f6';
        c.beginPath(); c.moveTo(-bw, -len * 0.18); c.lineTo(-bw, -len * 0.9); c.lineTo(0, -len * 1.04); c.lineTo(0, -len * 0.18); c.fill();
        c.strokeStyle = '#c9a24a'; c.lineWidth = len * 0.11;
        c.beginPath(); c.moveTo(-len * 0.24, -len * 0.18); c.lineTo(len * 0.24, -len * 0.18); c.stroke();
        c.strokeStyle = '#5a3a20'; c.lineWidth = len * 0.1;
        c.beginPath(); c.moveTo(0, -len * 0.16); c.lineTo(0, len * 0.04); c.stroke();
        circle(c, 0, len * 0.08, len * 0.07, '#c9a24a');
        break;
      }
      case 'axe':
        c.strokeStyle = '#7a5530'; c.lineWidth = len * 0.12;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -len); c.stroke();
        for (const sx of [1, -0.7]) {
          c.fillStyle = sx > 0 ? '#dfe4ea' : '#aab2bc';
          c.beginPath(); c.moveTo(0, -len); c.quadraticCurveTo(len * 0.55 * sx, -len * 0.88, len * 0.45 * sx, -len * 0.5); c.lineTo(0, -len * 0.62); c.fill();
        }
        c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = len * 0.04;
        c.beginPath(); c.moveTo(len * 0.1, -len * 0.95); c.quadraticCurveTo(len * 0.45, -len * 0.85, len * 0.4, -len * 0.58); c.stroke();
        break;
      case 'club':
        c.strokeStyle = '#6b4a2a'; c.lineWidth = len * 0.2;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -len * 0.8); c.stroke();
        circle(c, 0, -len * 0.85, len * 0.24, ball(c, 0, -len * 0.85, len * 0.24, '#7d5733'));
        circle(c, len * 0.12, -len * 0.98, len * 0.05, '#cfc6b8');
        circle(c, -len * 0.1, -len * 0.78, len * 0.05, '#cfc6b8');
        break;
      case 'staff':
        c.strokeStyle = '#6b4a2a'; c.lineWidth = len * 0.1;
        c.beginPath(); c.moveTo(0, len * 0.3); c.lineTo(0, -len); c.stroke();
        circle(c, 0, -len - len * 0.12, len * 0.3, (team || '#ffffff') + '44');
        circle(c, 0, -len - len * 0.12, len * 0.18, ball(c, 0, -len - len * 0.12, len * 0.18, team || '#ffffff'));
        break;
      case 'lance':
        c.strokeStyle = '#b89463'; c.lineWidth = len * 0.1;
        c.beginPath(); c.moveTo(0, len * 0.2); c.lineTo(len * 0.2, -len * 1.2); c.stroke();
        break;
      case 'musket':
        c.rotate(0.9 - swing * 1.6 + swing * 0.2);
        c.strokeStyle = '#3a2a1f'; c.lineWidth = len * 0.14;
        c.beginPath(); c.moveTo(-len * 0.2, 0); c.lineTo(0, -len * 1.1); c.stroke();
        break;
      case 'dagger':
        c.strokeStyle = '#d9dee6'; c.lineWidth = len * 0.16;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -len * 0.6); c.stroke();
        break;
    }
    c.restore();
  }

  function bow(c, len, draw) {
    c.strokeStyle = '#8a5a2b';
    c.lineWidth = len * 0.1;
    c.beginPath();
    c.arc(0, 0, len * 0.6, -1.2, 1.2);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = len * 0.04;
    const pull = -draw * len * 0.35;
    c.beginPath();
    c.moveTo(Math.cos(-1.2) * len * 0.6, Math.sin(-1.2) * len * 0.6);
    c.lineTo(pull, 0);
    c.lineTo(Math.cos(1.2) * len * 0.6, Math.sin(1.2) * len * 0.6);
    c.stroke();
  }

  // A little person. o: { r, team, skin, outfit, legs, boots, head, gear, walk, swing, cape, undead }
  function person(c, o) {
    const r = o.r, step = Math.sin(o.walk) * r * 0.28;
    const outfit = o.outfit || o.team, skin = o.skin || '#f2c9a0';
    const legs = o.legs || '#3a3340', boots = o.boots || '#2a2128';
    // Legs with boots; the back one sits in shadow.
    const leg = (x, lift, col) => {
      rrect(c, x, -r * 0.78 - lift, r * 0.32, r * 0.6, r * 0.12, col);
      rrect(c, x - r * 0.03, -r * 0.26 - lift, r * 0.44, r * 0.26, [r * 0.08, r * 0.16, r * 0.06, r * 0.06], boots);
    };
    leg(-r * 0.36 + step * 0.45, Math.max(0, step) * 0.25, shade(legs, -0.25));
    leg(r * 0.04 - step * 0.45, Math.max(0, -step) * 0.25, legs);

    const bob = Math.abs(Math.sin(o.walk)) * r * 0.08;
    c.save();
    c.translate(0, -bob);
    if (o.cape) {
      const flow = Math.sin(o.walk * 0.5) * r * 0.12;
      c.fillStyle = shade(o.team, -0.3);
      c.beginPath(); c.moveTo(-r * 0.45, -r * 1.8); c.quadraticCurveTo(-r * 1.0 - flow, -r * 1.1, -r * 1.05 - flow, -r * 0.4); c.lineTo(r * 0.1, -r * 0.55); c.fill();
    }
    // Back arm.
    rrect(c, -r * 0.7, -r * 1.72, r * 0.3, r * 0.78, r * 0.15, shade(outfit, -0.35));
    circle(c, -r * 0.55, -r * 0.95, r * 0.16, shade(skin, -0.2));
    // Torso: left-lit, with a diagonal team sash and a belt.
    const torso = () => { c.beginPath(); c.roundRect(-r * 0.62, -r * 1.86, r * 1.24, r * 1.24, [r * 0.46, r * 0.46, r * 0.28, r * 0.28]); };
    torso();
    c.fillStyle = lit(c, outfit, -r * 0.62, r * 0.62);
    c.fill();
    c.save();
    torso();
    c.clip();
    c.fillStyle = o.team;
    c.beginPath(); c.moveTo(-r * 0.7, -r * 1.62); c.lineTo(-r * 0.4, -r * 1.9); c.lineTo(r * 0.75, -r * 0.98); c.lineTo(r * 0.75, -r * 0.66); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.beginPath(); c.moveTo(-r * 0.7, -r * 1.62); c.lineTo(-r * 0.4, -r * 1.9); c.lineTo(-r * 0.3, -r * 1.82); c.lineTo(-r * 0.62, -r * 1.52); c.fill();
    c.fillStyle = '#3b2a1e';
    c.fillRect(-r * 0.7, -r * 0.96, r * 1.4, r * 0.15);
    c.fillStyle = '#e8c35a';
    c.fillRect(r * 0.02, -r * 0.98, r * 0.2, r * 0.19);
    c.restore();
    // Head: shaded, with a bright eye and rosy cheek.
    const hx = r * 0.05, hy = -r * 2.25, hr = r * 0.56;
    circle(c, hx, hy, hr, ball(c, hx, hy, hr, skin));
    if (!o.undead) {
      ellipse(c, r * 0.31, -r * 2.3, r * 0.12, r * 0.15, '#ffffff');
      circle(c, r * 0.35, -r * 2.29, r * 0.075, '#1b1b22');
      circle(c, r * 0.37, -r * 2.33, r * 0.03, '#ffffff');
      circle(c, r * 0.3, -r * 2.06, r * 0.1, 'rgba(255,110,110,0.3)');
    }
    o.head?.(c, r);
    // Front arm and what it holds.
    c.save();
    c.translate(r * 0.45, -r * 1.35);
    o.gear?.(c, r, o.swing);
    c.restore();
    rrect(c, r * 0.3, -r * 1.72, r * 0.3, r * 0.42, r * 0.14, shade(outfit, 0.08));
    circle(c, r * 0.45, -r * 1.3, r * 0.19, ball(c, r * 0.45, -r * 1.3, r * 0.19, skin));
    c.restore();
  }

  // Head gear. Each takes (c, r) and draws around the head at (0.05r, -2.25r).
  const helm = col => (c, r) => {
    const g = c.createLinearGradient(-r * 0.6, -r * 2.9, r * 0.6, -r * 2.3);
    g.addColorStop(0, shade(col, 0.45));
    g.addColorStop(0.5, col);
    g.addColorStop(1, shade(col, -0.3));
    c.fillStyle = g;
    c.beginPath(); c.arc(r * 0.05, -r * 2.3, r * 0.62, Math.PI, 0); c.fill();
    c.fillStyle = shade(col, -0.15);
    c.fillRect(-r * 0.58, -r * 2.34, r * 1.26, r * 0.15);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath(); c.ellipse(-r * 0.18, -r * 2.62, r * 0.16, r * 0.08, -0.5, 0, TAU); c.fill();
  };
  // A hood over the top and back of the head, leaving the face open.
  const hood = col => (c, r) => {
    const path = () => {
      c.beginPath();
      c.arc(r * 0.02, -r * 2.25, r * 0.7, Math.PI * 0.62, Math.PI * 1.95);
      c.quadraticCurveTo(r * 0.45, -r * 2.62, r * 0.12, -r * 2.5);
      c.quadraticCurveTo(-r * 0.25, -r * 2.25, -r * 0.05, -r * 1.68);
      c.closePath();
    };
    path();
    c.fillStyle = lit(c, col, -r * 0.7, r * 0.7);
    c.fill();
    c.strokeStyle = shade(col, -0.35);
    c.lineWidth = r * 0.08;
    c.beginPath(); c.moveTo(r * 0.68, -r * 2.43); c.quadraticCurveTo(r * 0.45, -r * 2.62, r * 0.12, -r * 2.5); c.quadraticCurveTo(-r * 0.25, -r * 2.25, -r * 0.05, -r * 1.68); c.stroke();
  };
  const pointy = col => (c, r) => {
    c.fillStyle = lit(c, col, -r * 0.7, r * 0.75);
    c.beginPath(); c.moveTo(-r * 0.75, -r * 2.45); c.lineTo(r * 0.8, -r * 2.45); c.quadraticCurveTo(r * 0.1, -r * 2.9, -r * 0.35, -r * 3.75); c.quadraticCurveTo(-r * 0.2, -r * 3.0, -r * 0.75, -r * 2.45); c.fill();
    c.fillStyle = shade(col, -0.3);
    c.fillRect(-r * 0.75, -r * 2.55, r * 1.55, r * 0.14);
    circle(c, -r * 0.02, -r * 2.95, r * 0.12, '#ffd86b');
  };

  // Type → how to draw it. Each takes (c, r, team, anim).
  const TROOPS = {
    squire: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: shade(team, -0.15), head: helm('#9aa3b0'),
      gear: (g, r, s) => { weapon(g, 'sword', r * 1.3, s); rrect(g, -r * 1.1, -r * 0.2, r * 0.5, r * 0.75, r * 0.15, '#8a6a3a'); } }),
    knight: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#a9b2bf', legs: '#7d8794', cape: true,
      head: (g, r) => { helm('#c3cad4')(g, r); g.fillStyle = team; g.fillRect(-r * 0.1, -r * 3.05, r * 0.22, r * 0.55); g.fillStyle = '#20242c'; g.fillRect(r * 0.15, -r * 2.3, r * 0.4, r * 0.1); },
      gear: (g, r, s) => weapon(g, 'sword', r * 1.6, s) }),
    archers: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: 0, outfit: '#4f7a3a', head: hood('#3f6a2e'),
      gear: (g, r, s) => { g.translate(r * 0.3, 0); bow(g, r * 1.4, s); } }),
    princess: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: 0, outfit: '#f2a6c8', skin: '#f6d2b0',
      head: (g, r) => { g.fillStyle = '#f2d16b'; g.beginPath(); g.arc(0, -r * 2.3, r * 0.62, Math.PI * 0.9, Math.PI * 2.1); g.fill();
        g.fillStyle = '#ffc53d'; g.beginPath(); g.moveTo(-r * 0.4, -r * 2.75); g.lineTo(-r * 0.3, -r * 3.15); g.lineTo(-r * 0.05, -r * 2.9); g.lineTo(r * 0.15, -r * 3.2); g.lineTo(r * 0.3, -r * 2.9); g.lineTo(r * 0.5, -r * 3.15); g.lineTo(r * 0.5, -r * 2.75); g.fill(); },
      gear: (g, r, s) => { g.translate(r * 0.3, 0); bow(g, r * 1.5, s); } }),
    musketeer: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#5a4a7a',
      head: (g, r) => { g.fillStyle = '#2b2533'; g.beginPath(); g.ellipse(0, -r * 2.6, r * 0.9, r * 0.25, 0, 0, TAU); g.fill(); g.fillRect(-r * 0.45, -r * 3.05, r * 0.9, r * 0.5); g.fillStyle = team; g.beginPath(); g.ellipse(-r * 0.5, -r * 3.0, r * 0.5, r * 0.15, -0.6, 0, TAU); g.fill(); },
      gear: (g, r, s) => weapon(g, 'musket', r * 1.6, s) }),
    wizard: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#3a5ac8', head: (g, r) => { pointy('#2f4ab0')(g, r); g.fillStyle = '#eee'; g.beginPath(); g.moveTo(-r * 0.1, -r * 2); g.lineTo(r * 0.5, -r * 2); g.lineTo(r * 0.2, -r * 1.3); g.fill(); },
      gear: (g, r, s) => weapon(g, 'staff', r * 1.5, s * 0.4, '#ff9a3d') }),
    necro: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#2e2638', skin: '#c9d1c0', head: hood('#1f1828'),
      gear: (g, r, s) => weapon(g, 'staff', r * 1.5, s * 0.4, '#a46bff') }),
    electro: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#2b6fd6', head: (g, r) => { g.strokeStyle = '#bfe8ff'; g.lineWidth = r * 0.18; g.beginPath(); for (let i = -2; i <= 2; i++) { g.moveTo(i * r * 0.22, -r * 2.7); g.lineTo(i * r * 0.32, -r * 3.25); } g.stroke(); },
      gear: (g, r, s) => { circle(g, r * 0.2, -r * 0.2, r * (0.3 + s * 0.25), 'rgba(140,220,255,0.85)'); circle(g, r * 0.2, -r * 0.2, r * 0.15, '#fff'); } }),
    healer: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#f2efe6', head: hood('#e6e1d3'),
      gear: (g, r, s) => weapon(g, 'staff', r * 1.5, s * 0.3, '#5dff9a') }),
    valkyrie: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: shade(team, -0.1), skin: '#f2c9a0',
      head: (g, r) => { g.fillStyle = '#ff8a2b'; g.beginPath(); g.arc(0, -r * 2.35, r * 0.62, Math.PI * 0.8, Math.PI * 2.2); g.fill(); g.fillRect(-r * 0.7, -r * 2.35, r * 0.3, r * 0.9); },
      gear: (g, r, s) => { g.rotate(s * TAU); weapon(g, 'axe', r * 1.4, 0); } }),
    bomber: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#5c5f66', skin: '#e8ebe4', head: (g, r) => { g.fillStyle = '#20242c'; g.fillRect(-r * 0.6, -r * 2.5, r * 1.2, r * 0.2); },
      gear: (g, r, s) => { circle(g, r * 0.1, -r * 0.3 - s * r, r * 0.45, '#22252b'); circle(g, r * 0.25, -r * 0.8 - s * r, r * 0.12, '#ffb347'); } }),
    goblin: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#7a5a3a', skin: '#7fc95a',
      head: (g, r) => { g.fillStyle = '#7fc95a'; g.beginPath(); g.moveTo(-r * 0.4, -r * 2.4); g.lineTo(-r * 1.1, -r * 2.7); g.lineTo(-r * 0.4, -r * 2.15); g.fill(); g.beginPath(); g.moveTo(r * 0.4, -r * 2.4); g.lineTo(r * 1.1, -r * 2.7); g.lineTo(r * 0.4, -r * 2.15); g.fill(); },
      gear: (g, r, s) => weapon(g, 'dagger', r * 1.2, s) }),
    skeletons: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#e9e6dc', legs: '#d9d5c8', boots: '#bdb8aa', skin: '#efece2', undead: true,
      head: (g, r) => { g.fillStyle = '#1b1b22'; g.fillRect(r * 0.05, -r * 2.4, r * 0.18, r * 0.18); g.fillRect(-r * 0.25, -r * 2.4, r * 0.18, r * 0.18); g.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 3; i++) g.fillRect(-r * 0.45, -r * 1.65 + i * r * 0.28, r * 0.9, r * 0.08); },
      gear: (g, r, s) => weapon(g, 'sword', r * 1.1, s) }),
    brute: (c, r, team, a) => person(c, { r, team, walk: a.walk, swing: a.swing, outfit: '#7a5a3a', skin: '#8fb36a', legs: '#5a4a32',
      head: (g, r) => { g.fillStyle = '#f2f2e8'; g.beginPath(); g.moveTo(r * 0.3, -r * 2.0); g.lineTo(r * 0.38, -r * 2.25); g.lineTo(r * 0.46, -r * 2.0); g.fill(); },
      gear: (g, r, s) => weapon(g, 'club', r * 1.5, s) }),

    rats: (c, r, team, a) => {
      const b = Math.sin(a.walk * 2) * r * 0.15;
      c.strokeStyle = '#d9a596'; c.lineWidth = r * 0.2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-r * 1.1, -r * 0.6); c.quadraticCurveTo(-r * 2, -r * 1.2 + b, -r * 2.2, -r * 0.4); c.stroke();
      for (let i = 0; i < 2; i++) { const ph = Math.sin(a.walk * 2 + i * 3) * r * 0.3; ellipse(c, -r * 0.5 + i * r + ph, -r * 0.12, r * 0.28, r * 0.14, '#d9a596'); }
      ellipse(c, 0, -r * 0.8 + b, r * 1.3, r * 0.8, ball(c, 0, -r * 0.8 + b, r * 1.3, '#7a6a64'));
      ellipse(c, r * 0.1, -r * 0.5 + b, r * 0.8, r * 0.35, 'rgba(255,235,225,0.25)');
      circle(c, r * 1.1, -r * 0.95 + b, r * 0.55, ball(c, r * 1.1, -r * 0.95 + b, r * 0.55, '#7a6a64'));
      circle(c, r * 0.85, -r * 1.5 + b, r * 0.32, '#7a6a64');
      circle(c, r * 0.87, -r * 1.5 + b, r * 0.18, '#e8a3a0');
      circle(c, r * 1.62, -r * 0.92 + b, r * 0.12, '#e87a8a');
      circle(c, r * 1.3, -r * 1.08 + b, r * 0.11, '#111');
      circle(c, r * 1.33, -r * 1.12 + b, r * 0.04, '#fff');
      c.fillStyle = team; c.fillRect(r * 0.5, -r * 1.25 + b, r * 0.22, r * 0.85);
    },
    bats: (c, r, team, a) => {
      const f = Math.sin(a.walk * 3) * 0.8;
      for (const s of [-1, 1]) {
        c.fillStyle = s < 0 ? '#3a2c48' : '#4e3d60';
        c.beginPath(); c.moveTo(0, -r); c.quadraticCurveTo(s * r * 1.6, -r * (1.9 + f), s * r * 2.2, -r * (0.8 + f));
        c.quadraticCurveTo(s * r * 1.7, -r * (0.75 + f * 0.6), s * r * 1.45, -r * (0.55 + f * 0.4));
        c.quadraticCurveTo(s * r * 1.1, -r * (0.7 + f * 0.3), s * r * 0.8, -r * 0.5);
        c.quadraticCurveTo(s * r * 0.4, -r * 0.6, 0, -r * 0.7); c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = r * 0.08;
        c.beginPath(); c.moveTo(0, -r); c.lineTo(s * r * 1.45, -r * (0.55 + f * 0.4)); c.moveTo(s * r * 0.4, -r * 0.95); c.lineTo(s * r * 2.1, -r * (0.85 + f)); c.stroke();
      }
      circle(c, 0, -r, r * 0.62, ball(c, 0, -r, r * 0.62, '#5a4870'));
      c.fillStyle = '#5a4870';
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * r * 0.15, -r * 1.45); c.lineTo(s * r * 0.4, -r * 1.85); c.lineTo(s * r * 0.48, -r * 1.35); c.fill(); }
      circle(c, -r * 0.18, -r * 1.08, r * 0.12, '#ffeb6b');
      circle(c, r * 0.22, -r * 1.08, r * 0.12, '#ffeb6b');
      c.fillStyle = team; c.fillRect(-r * 0.35, -r * 0.7, r * 0.7, r * 0.16);
    },
    rider: (c, r, team, a) => {
      const b = Math.sin(a.walk * 1.5) * r * 0.1;
      c.fillStyle = '#7a4f2e';
      for (let i = 0; i < 4; i++) { const ph = Math.sin(a.walk * 1.5 + i * 1.6) * r * 0.25; c.fillRect(-r * 0.8 + i * r * 0.5 + ph, -r * 0.8, r * 0.18, r * 0.8); }
      ellipse(c, 0, -r * 1.05 + b, r * 1.05, r * 0.5, '#8a5a34');
      c.save(); c.translate(r * 0.95, -r * 1.35 + b); c.rotate(-0.6); ellipse(c, 0, 0, r * 0.45, r * 0.24, '#8a5a34'); c.restore();
      c.fillStyle = '#3a2618'; c.fillRect(-r * 0.2, -r * 1.55 + b, r * 0.9, r * 0.2);
      c.save(); c.translate(-r * 0.05, -r * 1.2 + b); c.scale(0.62, 0.62);
      person(c, { r, team, walk: 0, swing: a.swing, head: helm('#9aa3b0'), gear: (g, r, s) => weapon(g, 'lance', r * 1.5, s * 0.4) });
      c.restore();
    },
    ramrider: (c, r, team, a) => {
      const b = Math.sin(a.walk * 1.5) * r * 0.1;
      c.fillStyle = '#4a4038';
      for (let i = 0; i < 4; i++) { const ph = Math.sin(a.walk * 1.5 + i * 1.6) * r * 0.2; c.fillRect(-r * 0.7 + i * r * 0.45 + ph, -r * 0.7, r * 0.18, r * 0.7); }
      for (let i = -2; i <= 2; i++) circle(c, i * r * 0.3, -r * 1.05 + b + (i % 2) * r * 0.1, r * 0.42, '#efe8da');
      circle(c, r * 0.95, -r * 1.2 + b, r * 0.38, '#6b5f55');
      c.strokeStyle = '#b8a07a'; c.lineWidth = r * 0.18;
      c.beginPath(); c.arc(r * 0.9, -r * 1.35 + b, r * 0.35, Math.PI * 1.1, Math.PI * 2.1); c.stroke();
      c.save(); c.translate(-r * 0.1, -r * 1.25 + b); c.scale(0.55, 0.55);
      person(c, { r, team, walk: 0, swing: a.swing, skin: '#7fc95a', head: helm('#8a6a3a'), gear: (g, r, s) => weapon(g, 'club', r * 1.2, s) });
      c.restore();
    },
    golem: (c, r, team, a) => golemBody(c, r, team, a, '#8a8f99'),
    golemite: (c, r, team, a) => golemBody(c, r, team, a, '#9aa0aa'),
    dragon: (c, r, team, a) => {
      const f = Math.sin(a.walk * 2.5) * 0.7;
      const green = '#5fbf4f';
      for (const s of [-1, 1]) {
        const tipY = -r * (2.5 + f), tipX = -r * 0.6 * s;
        c.fillStyle = s < 0 ? shade(green, -0.4) : shade(green, -0.2);
        c.beginPath(); c.moveTo(-r * 0.2, -r * 1.2); c.lineTo(tipX, tipY); c.quadraticCurveTo(-r * 1.0, -r * (2.0 + f * 0.7), -r * 1.5, -r * (1.7 + f * 0.5)); c.quadraticCurveTo(-r * 0.9, -r * 1.4, -r * 0.2, -r * 1.2); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = r * 0.07;
        c.beginPath(); c.moveTo(-r * 0.2, -r * 1.2); c.lineTo(-r * 0.95, -r * (1.95 + f * 0.65)); c.stroke();
      }
      c.strokeStyle = green; c.lineWidth = r * 0.32; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-r * 0.8, -r); c.quadraticCurveTo(-r * 1.6, -r * 0.8, -r * 1.7, -r * 1.3); c.stroke();
      c.fillStyle = '#e8d98a';
      c.beginPath(); c.moveTo(-r * 1.7, -r * 1.3); c.lineTo(-r * 2.05, -r * 1.5); c.lineTo(-r * 1.75, -r * 1.65); c.fill();
      ellipse(c, 0, -r, r * 0.95, r * 0.62, ball(c, 0, -r, r * 0.95, green));
      ellipse(c, r * 0.1, -r * 0.82, r * 0.6, r * 0.34, '#e8d98a');
      c.strokeStyle = 'rgba(160,130,50,0.45)'; c.lineWidth = r * 0.06;
      for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(r * (0.1 + i * 0.25), -r * 1.1); c.lineTo(r * (0.1 + i * 0.25), -r * 0.52); c.stroke(); }
      circle(c, r * 0.95, -r * 1.45, r * 0.52, ball(c, r * 0.95, -r * 1.45, r * 0.52, green));
      ellipse(c, r * 1.35, -r * 1.33, r * 0.3, r * 0.2, green);
      c.fillStyle = '#f2ead0';
      for (const dx of [0.62, 0.82]) { c.beginPath(); c.moveTo(r * dx, -r * 1.85); c.lineTo(r * (dx - 0.22), -r * 2.3); c.lineTo(r * (dx + 0.1), -r * 1.9); c.fill(); }
      circle(c, r * 1.12, -r * 1.58, r * 0.13, '#fff7c0');
      circle(c, r * 1.15, -r * 1.58, r * 0.07, '#111');
      c.fillStyle = team; c.fillRect(-r * 0.32, -r * 1.58, r * 0.64, r * 0.18);
      if (a.swing > 0.3) {
        circle(c, r * 1.8, -r * 1.35, r * 0.45 * a.swing, 'rgba(255,120,30,0.6)');
        circle(c, r * 1.75, -r * 1.35, r * 0.25 * a.swing, 'rgba(255,230,120,0.9)');
      }
    },
    phoenix: (c, r, team, a) => {
      const f = Math.sin(a.walk * 2.5) * 0.8;
      for (const s of [-1, 1]) {
        const g = c.createLinearGradient(0, -r, -r * 1.2, -r * (2.4 + f));
        g.addColorStop(0, '#ff5a2f'); g.addColorStop(0.6, '#ff9a3d'); g.addColorStop(1, '#ffe07a');
        c.fillStyle = g;
        c.globalAlpha *= s < 0 ? 0.8 : 1;
        c.beginPath(); c.moveTo(0, -r * 1.2); c.quadraticCurveTo(-r * 0.5 * s, -r * (2.6 + f), -r * 1.6, -r * (2.0 + f));
        c.lineTo(-r * 1.25, -r * (1.75 + f * 0.7)); c.lineTo(-r * 1.45, -r * (1.55 + f * 0.5)); c.quadraticCurveTo(-r * 0.8, -r * 1.2, 0, -r); c.fill();
        c.globalAlpha /= s < 0 ? 0.8 : 1;
      }
      const tg = c.createLinearGradient(-r * 0.6, 0, -r * 2.1, 0);
      tg.addColorStop(0, '#ffc53d'); tg.addColorStop(1, 'rgba(255,90,47,0.4)');
      c.fillStyle = tg;
      c.beginPath(); c.moveTo(-r * 0.6, -r); c.quadraticCurveTo(-r * 1.4, -r * (0.4 + f * 0.2), -r * 2.0, -r * 0.55); c.lineTo(-r * 1.6, -r * 1.05); c.lineTo(-r * 2.1, -r * 1.35); c.quadraticCurveTo(-r * 1.3, -r * 1.35, -r * 0.6, -r * 1.15); c.fill();
      ellipse(c, 0, -r * 1.05, r * 0.82, r * 0.52, ball(c, 0, -r * 1.05, r * 0.82, '#ff5a2f'));
      circle(c, r * 0.8, -r * 1.4, r * 0.4, ball(c, r * 0.8, -r * 1.4, r * 0.4, '#ff8a3d'));
      c.fillStyle = '#ffd86b';
      c.beginPath(); c.moveTo(r * 0.7, -r * 1.75); c.quadraticCurveTo(r * 0.5, -r * 2.25, r * 0.25, -r * 2.15); c.quadraticCurveTo(r * 0.5, -r * 1.95, r * 0.55, -r * 1.7); c.fill();
      c.beginPath(); c.moveTo(r * 1.12, -r * 1.48); c.lineTo(r * 1.55, -r * 1.36); c.lineTo(r * 1.12, -r * 1.24); c.fill();
      circle(c, r * 0.92, -r * 1.5, r * 0.1, '#fff7c0');
      circle(c, r * 0.94, -r * 1.5, r * 0.055, '#111');
      c.fillStyle = team; c.fillRect(-r * 0.28, -r * 1.48, r * 0.56, r * 0.16);
    },
  };

  function golemBody(c, r, team, a, stone) {
    const step = Math.sin(a.walk) * r * 0.15;
    rrect(c, -r * 0.72 + step, -r * 0.75, r * 0.52, r * 0.75, r * 0.15, shade(stone, -0.35));
    rrect(c, r * 0.2 - step, -r * 0.75, r * 0.52, r * 0.75, r * 0.15, shade(stone, -0.2));
    // Back fist.
    circle(c, -r * 0.95, -r * 1.25, r * 0.4, shade(stone, -0.35));
    c.beginPath(); c.roundRect(-r, -r * 2.05, r * 2, r * 1.45, r * 0.42);
    c.fillStyle = lit(c, stone, -r, r, 0.25); c.fill();
    // Mossy cap and cracks glowing with the rune inside.
    c.fillStyle = 'rgba(110,170,80,0.55)';
    c.beginPath(); c.ellipse(-r * 0.2, -r * 1.98, r * 0.7, r * 0.16, 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(122,255,234,0.85)'; c.lineWidth = r * 0.09; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-r * 0.55, -r * 1.8); c.lineTo(-r * 0.15, -r * 1.42); c.lineTo(-r * 0.35, -r * 1.0); c.moveTo(r * 0.3, -r * 1.75); c.lineTo(r * 0.5, -r * 1.35); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (const [x, y, s2] of [[0.55, -1.0, 0.16], [-0.7, -1.3, 0.12], [0.1, -0.8, 0.1]]) circle(c, r * x, r * y, r * s2, 'rgba(0,0,0,0.18)');
    c.beginPath(); c.roundRect(-r * 0.45, -r * 2.62, r * 0.9, r * 0.7, r * 0.22);
    c.fillStyle = lit(c, shade(stone, 0.1), -r * 0.45, r * 0.45, 0.25); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(-r * 0.05, -r * 2.36, r * 0.42, r * 0.16);
    circle(c, r * 0.22, -r * 2.28, r * 0.13, 'rgba(122,255,234,0.4)');
    circle(c, r * 0.22, -r * 2.28, r * 0.07, '#c8fff6');
    c.fillStyle = team; c.fillRect(-r, -r * 1.28, r * 2, r * 0.2);
    // Front fist punches forward on a swing.
    const fx = r * (0.9 + a.swing * 0.6);
    circle(c, fx, -r * 1.3, r * 0.44, ball(c, fx, -r * 1.3, r * 0.44, stone));
  }

  // ---------- Buildings ----------

  function crenels(c, x, y, w, n, h, fill) {
    c.fillStyle = fill;
    const bw = w / (n * 2 - 1);
    for (let i = 0; i < n; i++) c.fillRect(x + i * bw * 2, y - h, bw, h);
  }

  const BUILDINGS = {
    tower: (c, s, team, a) => {
      const w = 40 * s, h = 46 * s;
      ellipse(c, 0, 0, w * 0.6, w * 0.22, 'rgba(0,0,0,0.25)');
      rrect(c, -w / 2 - 3 * s, -8 * s, w + 6 * s, 8 * s, 3 * s, '#7d7568');
      c.beginPath(); c.roundRect(-w / 2, -h, w, h - 4 * s, 3 * s);
      c.fillStyle = lit(c, '#9a9284', -w / 2, w / 2, 0.22); c.fill();
      rrect(c, w * 0.18, -h * 0.82, 4 * s, 10 * s, 2 * s, '#3a3028');
      rrect(c, -w * 0.3, -h * 0.82, 4 * s, 10 * s, 2 * s, '#3a3028');
      c.fillStyle = '#857d70';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) c.fillRect(-w / 2 + (j + (i % 2) * 0.5) * w / 3 + 2 * s, -h + 8 * s + i * 9 * s, w / 3 - 4 * s, 2 * s);
      rrect(c, -w * 0.6, -h - 4 * s, w * 1.2, 7 * s, 2 * s, '#aaa294');
      crenels(c, -w * 0.6, -h - 4 * s, w * 1.2, 4, 6 * s, '#aaa294');
      // Banner.
      c.fillStyle = '#5a4a3a'; c.fillRect(-1 * s, -h - 26 * s, 2 * s, 22 * s);
      const wave = Math.sin(a.t * 4) * 2 * s;
      c.fillStyle = team;
      c.beginPath(); c.moveTo(1 * s, -h - 26 * s); c.lineTo(15 * s, -h - 22 * s + wave); c.lineTo(1 * s, -h - 17 * s); c.fill();
      rrect(c, -7 * s, -h * 0.45, 14 * s, h * 0.45, [7 * s, 7 * s, 0, 0], '#3a3028');
      // The archer on top leans into each shot.
      c.save(); c.translate(0, -h - 3 * s); c.scale(s * 0.75, s * 0.75); person(c, { r: 7, team, walk: 0, swing: 0, head: hood(shade(team, -0.3)), gear: (g, r) => { g.translate(r * 0.3, 0); bow(g, r * 1.4, a.swing); } }); c.restore();
    },
    keep: (c, s, team, a) => {
      const w = 92 * s, h = 70 * s;
      ellipse(c, 0, 0, w * 0.62, w * 0.2, 'rgba(0,0,0,0.3)');
      for (const sx of [-1, 1]) {
        c.beginPath(); c.roundRect(sx * w * 0.5 - 13 * s, -h - 14 * s, 26 * s, h + 14 * s, 3 * s);
        c.fillStyle = lit(c, '#a59c8c', sx * w * 0.5 - 13 * s, sx * w * 0.5 + 13 * s, 0.22); c.fill();
        rrect(c, sx * w * 0.5 - 2 * s, -h + 2 * s, 4 * s, 11 * s, 2 * s, '#3a3028');
        crenels(c, sx * w * 0.5 - 15 * s, -h - 14 * s, 30 * s, 3, 6 * s, '#b3aa99');
        c.fillStyle = shade(team, -0.2);
        c.beginPath(); c.moveTo(sx * w * 0.5 - 16 * s, -h - 20 * s); c.lineTo(sx * w * 0.5, -h - 40 * s); c.lineTo(sx * w * 0.5 + 16 * s, -h - 20 * s); c.fill();
      }
      c.beginPath(); c.roundRect(-w * 0.42, -h, w * 0.84, h, 3 * s);
      c.fillStyle = lit(c, '#9a9284', -w * 0.42, w * 0.42, 0.22); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) c.fillRect(-w * 0.42 + (j + (i % 2) * 0.5) * w * 0.21 + 2 * s, -h + 12 * s + i * 11 * s, w * 0.21 - 4 * s, 2 * s);
      crenels(c, -w * 0.42, -h, w * 0.84, 5, 7 * s, '#aaa294');
      c.fillStyle = team; c.fillRect(-w * 0.42, -h * 0.72, w * 0.84, 6 * s);
      rrect(c, -12 * s, -h * 0.5, 24 * s, h * 0.5, [12 * s, 12 * s, 0, 0], '#3a3028');
      // The king, bobbing when he's annoyed.
      const k = a.swing;
      c.save(); c.translate(0, -h - 2 * s - k * 3 * s); c.scale(s, s);
      person(c, { r: 9, team, walk: 0, swing: 0, outfit: shade(team, -0.1), head: (g, r) => { g.fillStyle = '#ffc53d'; g.beginPath(); g.moveTo(-r * 0.55, -r * 2.75); g.lineTo(-r * 0.45, -r * 3.35); g.lineTo(-r * 0.15, -r * 3.0); g.lineTo(r * 0.05, -r * 3.45); g.lineTo(r * 0.25, -r * 3.0); g.lineTo(r * 0.55, -r * 3.35); g.lineTo(r * 0.6, -r * 2.75); g.fill(); g.fillStyle = '#d8d8d8'; g.beginPath(); g.arc(r * 0.15, -r * 1.95, r * 0.45, 0, Math.PI); g.fill(); } });
      c.restore();
    },
    turret: (c, s, team, a) => {
      ellipse(c, 0, 0, 16 * s, 6 * s, 'rgba(0,0,0,0.25)');
      rrect(c, -12 * s, -10 * s, 24 * s, 10 * s, 2 * s, '#7a5a3a');
      c.fillStyle = team; c.fillRect(-12 * s, -6 * s, 24 * s, 3 * s);
      c.save(); c.translate(0, -14 * s); c.rotate(-0.15);
      rrect(c, -4 * s, -3 * s, 20 * s, 6 * s, 2 * s, '#5a4028');
      c.strokeStyle = '#3a2618'; c.lineWidth = 2 * s;
      c.beginPath(); c.arc(4 * s, 0, 10 * s, -1.2, 1.2); c.stroke();
      c.fillStyle = '#d9dee6'; c.fillRect((14 - a.swing * 6) * s, -1 * s, 8 * s, 2 * s);
      c.restore();
    },
    cannon: (c, s, team, a) => {
      ellipse(c, 0, 0, 16 * s, 6 * s, 'rgba(0,0,0,0.25)');
      c.save(); c.translate(-a.swing * 3 * s, -10 * s); c.rotate(-0.25);
      rrect(c, -6 * s, -5 * s, 24 * s, 10 * s, 4 * s, '#2b2f36');
      circle(c, 18 * s, 0, 4 * s, '#111');
      c.restore();
      circle(c, -4 * s, -5 * s, 6 * s, '#6b4a2a');
      circle(c, -4 * s, -5 * s, 2.5 * s, team);
      circle(c, 6 * s, -5 * s, 6 * s, '#6b4a2a');
    },
    goblinhut: (c, s, team, a) => {
      ellipse(c, 0, 0, 20 * s, 7 * s, 'rgba(0,0,0,0.25)');
      rrect(c, -15 * s, -16 * s, 30 * s, 16 * s, 2 * s, '#8a6a45');
      c.fillStyle = '#d9b25a';
      c.beginPath(); c.moveTo(-20 * s, -14 * s); c.lineTo(0, -34 * s - a.swing * 2 * s); c.lineTo(20 * s, -14 * s); c.fill();
      c.strokeStyle = 'rgba(120,80,20,0.5)'; c.lineWidth = 1.5 * s;
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * 6 * s, -15 * s); c.lineTo(i * 2 * s, -30 * s); c.stroke(); }
      rrect(c, -5 * s, -11 * s, 10 * s, 11 * s, [5 * s, 5 * s, 0, 0], '#2a1f18');
      c.fillStyle = team; c.fillRect(-15 * s, -16 * s, 30 * s, 3 * s);
    },
    inferno: (c, s, team, a) => {
      ellipse(c, 0, 0, 16 * s, 6 * s, 'rgba(0,0,0,0.25)');
      c.fillStyle = '#5a4f4a';
      c.beginPath(); c.moveTo(-12 * s, 0); c.lineTo(-6 * s, -30 * s); c.lineTo(6 * s, -30 * s); c.lineTo(12 * s, 0); c.fill();
      c.fillStyle = team; c.fillRect(-10 * s, -8 * s, 20 * s, 3 * s);
      const glow = 0.6 + Math.sin(a.t * 6) * 0.2 + a.swing * 0.4;
      circle(c, 0, -36 * s, 9 * s * glow, 'rgba(255,120,40,0.35)');
      c.fillStyle = '#ff7a2f';
      c.beginPath(); c.moveTo(0, -46 * s); c.lineTo(6 * s, -36 * s); c.lineTo(0, -28 * s); c.lineTo(-6 * s, -36 * s); c.fill();
      c.fillStyle = '#ffd86b';
      c.beginPath(); c.moveTo(0, -41 * s); c.lineTo(3 * s, -36 * s); c.lineTo(0, -32 * s); c.lineTo(-3 * s, -36 * s); c.fill();
    },
  };

  // Troop frames are drawn once, at the resolution they'll be shown, with a dark outline all
  // round, then reused. Walk cycles are cut into 16 frames and swings into 5.
  const frames = new Map();
  const WALK_LOOP = Math.PI * 4;   // every troop's walk animation repeats within this
  function troopFrame(type, team, r, walk, swing, tint, px) {
    const wf = Math.round((((walk % WALK_LOOP) + WALK_LOOP) % WALK_LOOP) / WALK_LOOP * 16) % 16;
    const sf = Math.round(Math.max(0, Math.min(1, swing)) * 4);
    const key = `${type}|${team}|${wf}|${sf}|${tint}|${px}`;
    let f = frames.get(key);
    if (f) return f;
    if (frames.size > 3000) frames.clear();
    const d = Math.max(1, Math.round(px * 0.6));
    const w = Math.ceil(5.8 * r * px) + d * 4, h = Math.ceil(4.7 * r * px) + d * 4;
    const ox = w / 2, oy = Math.ceil(4.25 * r * px) + d * 2;
    const art = document.createElement('canvas');
    art.width = w;
    art.height = h;
    const g = art.getContext('2d');
    g.translate(ox, oy);
    g.scale(px, px);
    (TROOPS[type] || TROOPS.squire)(g, r, team, { walk: (wf / 16) * WALK_LOOP, swing: sf / 4 });
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const k = out.getContext('2d');
    for (const [dx, dy] of [[-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, -d], [-d, d], [d, d]]) k.drawImage(art, dx, dy);
    k.globalCompositeOperation = 'source-in';
    k.fillStyle = '#1a1420';
    k.fillRect(0, 0, w, h);
    k.globalCompositeOperation = 'source-over';
    k.drawImage(art, 0, 0);
    if (tint) {
      k.globalCompositeOperation = 'source-atop';
      k.fillStyle = tint === 'flash' ? 'rgba(255,255,255,0.7)' : 'rgba(150,215,255,0.5)';
      k.fillRect(0, 0, w, h);
    }
    f = { cv: out, ox, oy, px };
    frames.set(key, f);
    return f;
  }

  // o: { team, face (1 or -1), walk, swing, flash, stun, rage, fly, alpha, t }
  function drawUnit(c, type, x, y, s, o) {
    c.save();
    c.translate(x, y);
    c.globalAlpha = o.alpha ?? 1;
    if (BUILDINGS[type]) {
      BUILDINGS[type](c, s, o.team, { t: o.t || 0, swing: o.swing || 0 });
      c.restore();
      if (o.flash || o.stun) {
        c.save();
        c.globalAlpha = o.flash ? 0.45 : 0.3;
        c.globalCompositeOperation = 'lighter';
        const r = 22 * s;
        ellipse(c, x, y - r * 1.2, r * 1.2, r * 1.3, o.flash ? '#ffffff' : '#7fd4ff');
        c.restore();
      }
      return;
    }
    const def = RuneData.card(type);
    const r = def ? def.r : 9;
    const lift = o.fly ? (14 + Math.sin((o.t || 0) * 3 + x) * 2) * s : 0;
    ellipse(c, 0, 0, r * 0.95 * s, r * 0.35 * s, o.fly ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.28)');
    if (o.rage) {
      ellipse(c, 0, -lift, r * 1.4 * s, r * 0.55 * s, 'rgba(196,92,255,0.45)');
      ellipse(c, 0, -lift, r * 1.0 * s, r * 0.38 * s, 'rgba(230,170,255,0.35)');
    }
    const m = c.getTransform();
    const px = Math.max(1, Math.min(8, Math.round(s * Math.hypot(m.a, m.b) * 4) / 4));
    const f = troopFrame(type, o.team, r, o.walk || 0, o.swing || 0, o.flash ? 'flash' : o.stun ? 'stun' : '', px);
    c.translate(0, -lift);
    c.scale((o.face || 1) * s / px, s / px);
    c.drawImage(f.cv, -f.ox, -f.oy);
    c.restore();
  }

  // ---------- Spell art ----------

  function spellIcon(c, id, size) {
    const s = size / 40;
    c.save();
    c.scale(s, s);
    switch (id) {
      case 'fireball': {
        const g = c.createRadialGradient(-4, -4, 2, 0, 0, 16);
        g.addColorStop(0, '#fff3b0'); g.addColorStop(0.4, '#ffb347'); g.addColorStop(1, '#ff4a1f');
        c.fillStyle = 'rgba(255,120,40,0.4)';
        c.beginPath(); c.moveTo(-26, -20); c.lineTo(-4, -14); c.lineTo(-14, -2); c.fill();
        circle(c, 2, 2, 15, g);
        break;
      }
      case 'arrows':
        for (let i = -1; i <= 1; i++) {
          c.save(); c.translate(i * 10, i * 4); c.rotate(0.6);
          c.strokeStyle = '#8a5a2b'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, -18); c.lineTo(0, 14); c.stroke();
          c.fillStyle = '#d9dee6'; c.beginPath(); c.moveTo(0, 20); c.lineTo(-4, 12); c.lineTo(4, 12); c.fill();
          c.fillStyle = '#ff5d5d'; c.fillRect(-3, -18, 6, 5);
          c.restore();
        }
        break;
      case 'zap':
      case 'lightning':
        c.fillStyle = id === 'zap' ? '#7fd4ff' : '#fff27a';
        c.strokeStyle = id === 'zap' ? '#2b8fd6' : '#d6a92b'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(4, -20); c.lineTo(-10, 2); c.lineTo(-1, 2); c.lineTo(-6, 20); c.lineTo(11, -4); c.lineTo(2, -4); c.closePath(); c.fill(); c.stroke();
        break;
      case 'freeze':
        c.strokeStyle = '#bfe8ff'; c.lineWidth = 3.5; c.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          c.save(); c.rotate(i * Math.PI / 3);
          c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -17); c.moveTo(0, -10); c.lineTo(-5, -14); c.moveTo(0, -10); c.lineTo(5, -14); c.stroke();
          c.restore();
        }
        break;
      case 'rage':
        circle(c, 0, 0, 16, 'rgba(196,92,255,0.35)');
        c.fillStyle = '#c45cff';
        c.beginPath(); c.moveTo(-10, 12); c.lineTo(-4, -4); c.lineTo(-8, -4); c.lineTo(0, -18); c.lineTo(8, -4); c.lineTo(4, -4); c.lineTo(10, 12); c.closePath(); c.fill();
        break;
    }
    c.restore();
  }

  // Card art for the hand and the collection: rarity background, then the troop, building or spell.
  function cardArt(c, w, h, card, team) {
    const rar = RuneData.RARITIES[card.rarity] || RuneData.RARITIES.common;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, shade(rar.color, -0.35));
    g.addColorStop(1, shade(rar.color, -0.7));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = -h; i < w; i += 14) { c.beginPath(); c.moveTo(i, h); c.lineTo(i + 7, h); c.lineTo(i + 7 + h, 0); c.lineTo(i + h, 0); c.fill(); }
    const glow = c.createRadialGradient(w / 2, h * 0.55, 2, w / 2, h * 0.55, w * 0.6);
    glow.addColorStop(0, 'rgba(255,255,255,0.22)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    if (card.kind === 'spell') {
      c.save(); c.translate(w / 2, h / 2); spellIcon(c, card.id, Math.min(w, h) * 0.8); c.restore();
    } else if (card.kind === 'building') {
      const s = Math.min(w, h) / (card.id === 'goblinhut' ? 46 : 52);
      drawUnit(c, card.id, w / 2, h * 0.86, s, { team, swing: 0, t: 0 });
    } else {
      const big = card.r >= 14 ? 0.9 : card.r >= 11 ? 1.05 : 1.25;
      const s = Math.min(w, h) / (card.r * 4.2) * big;
      const n = Math.min(card.count || 1, 3);
      for (let i = n - 1; i >= 0; i--) {
        const dx = n > 1 ? (i - (n - 1) / 2) * w * 0.22 : 0;
        drawUnit(c, card.id, w / 2 + dx, h * (card.fly ? 0.9 : 0.86) - (n > 1 ? (i % 2) * h * 0.06 : 0), s * (n > 1 ? 0.8 : 1), { team, face: 1, walk: 0.6, swing: 0, fly: false });
      }
    }
  }

  // ---------- Battlefield ----------

  // Drawn once per arena into a layer; the caller passes the world-to-layer transform.
  function drawField(c, arena, L) {
    const { W, FIELD_H, LANES, MID, KEEP_X } = L;
    const rnd = seeded(arena.id);
    c.fillStyle = arena.grass;
    c.fillRect(0, 0, W, FIELD_H);
    // Checkerboard mowing.
    c.fillStyle = arena.grass2;
    for (let x = 0; x < W; x += 48) for (let y = 0; y < FIELD_H; y += 48) if (((x + y) / 48) % 2 === 0) c.fillRect(x, y, 48, 48);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      c.fillRect(rnd() * W, rnd() * FIELD_H, 2 + rnd() * 3, 2 + rnd() * 3);
    }
    // Decorations in the gaps between lanes and along the edges.
    const gaps = [LANES[0] - 60, (LANES[0] + LANES[1]) / 2, (LANES[1] + LANES[2]) / 2, LANES[2] + 60];
    for (const gy of gaps) {
      for (let x = 110; x < W - 110; x += 34 + rnd() * 40) {
        if (Math.abs(x - MID) < 36) continue;
        deco(c, arena.deco[Math.floor(rnd() * arena.deco.length)], x, gy + (rnd() - 0.5) * 22, 0.7 + rnd() * 0.5, rnd);
      }
    }
    // Lanes: a worn path with a stone edge.
    for (const y of LANES) {
      c.fillStyle = shade(arena.path, -0.25);
      c.beginPath(); c.roundRect(60, y - 28, W - 120, 56, 26); c.fill();
      c.fillStyle = arena.path;
      c.beginPath(); c.roundRect(64, y - 24, W - 128, 48, 22); c.fill();
      for (let i = 0; i < 70; i++) {
        c.fillStyle = 'rgba(0,0,0,0.07)';
        c.beginPath(); c.arc(70 + rnd() * (W - 140), y + (rnd() - 0.5) * 40, 1 + rnd() * 2.5, 0, TAU); c.fill();
      }
    }
    // Castle walls behind each keep.
    for (const kx of KEEP_X) {
      const x = kx < MID ? 6 : W - 20;
      c.fillStyle = '#857d70'; c.fillRect(x, 10, 14, FIELD_H - 20);
      c.fillStyle = '#9a9284';
      for (let y = 12; y < FIELD_H - 16; y += 14) c.fillRect(x - 2, y, 18, 8);
    }
    // River and bridges.
    c.fillStyle = shade(arena.river, -0.3);
    c.fillRect(MID - 18, 0, 36, FIELD_H);
    c.fillStyle = arena.river;
    c.fillRect(MID - 14, 0, 28, FIELD_H);
    for (const y of LANES) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(MID - 24, y - 24, 48, 52);
      c.fillStyle = '#8a6a45';
      c.fillRect(MID - 24, y - 26, 48, 52);
      c.fillStyle = '#6b5233';
      for (let x = MID - 22; x < MID + 24; x += 8) c.fillRect(x, y - 26, 2, 52);
      c.fillStyle = '#5a4028';
      c.fillRect(MID - 24, y - 28, 48, 4);
      c.fillRect(MID - 24, y + 24, 48, 4);
    }
  }

  // Ripples on the river, drawn every frame on top of the field layer.
  function drawRiver(c, arena, L, t) {
    const { FIELD_H, LANES, MID } = L;
    c.strokeStyle = arena.id === 'forge' ? 'rgba(255,230,120,0.55)' : 'rgba(255,255,255,0.35)';
    c.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) {
      const y = ((i * 53 + t * 26) % (FIELD_H + 20)) - 10;
      if (LANES.some(ly => Math.abs(y - ly) < 30)) continue;
      c.beginPath();
      c.moveTo(MID - 8, y);
      c.quadraticCurveTo(MID, y - 4, MID + 8, y);
      c.stroke();
    }
  }

  function deco(c, kind, x, y, s, rnd) {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    switch (kind) {
      case 'tree': circle(c, 2, 3, 12, 'rgba(0,0,0,0.2)'); circle(c, 0, 0, 12, '#2f6b35'); circle(c, -3, -3, 8, '#3e8a44'); circle(c, -4, -5, 3, 'rgba(255,255,255,0.15)'); break;
      case 'pine': for (const [r, col] of [[11, '#24502a'], [7, '#2e6334'], [4, '#ffffff']]) circle(c, 0, 0, r, col); break;
      case 'bush': for (const [dx, dy] of [[-4, 0], [4, 1], [0, -4]]) circle(c, dx, dy, 5.5, '#356f3a'); break;
      case 'flower': for (let i = 0; i < 5; i++) circle(c, Math.cos(i * 1.3) * 6, Math.sin(i * 2.1) * 5, 1.8, ['#ffd23f', '#ff7ab6', '#fff'][i % 3]); break;
      case 'rock': case 'snowrock': case 'lavarock':
        c.fillStyle = kind === 'snowrock' ? '#a9b6c2' : kind === 'lavarock' ? '#2b2422' : '#8a7c6c';
        c.beginPath(); c.moveTo(-8, 3); c.lineTo(-5, -6); c.lineTo(5, -7); c.lineTo(8, 1); c.lineTo(2, 6); c.fill();
        if (kind === 'snowrock') { c.fillStyle = '#fff'; c.beginPath(); c.moveTo(-5, -6); c.lineTo(5, -7); c.lineTo(1, -2); c.fill(); }
        if (kind === 'lavarock') { c.strokeStyle = '#ff7a2f'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-4, -2); c.lineTo(0, 1); c.lineTo(4, -3); c.stroke(); }
        break;
      case 'bone': c.strokeStyle = '#eee8d8'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(-6, -2); c.lineTo(6, 2); c.stroke(); circle(c, -7, -2, 2.2, '#eee8d8'); circle(c, 7, 2, 2.2, '#eee8d8'); break;
      case 'skull': circle(c, 0, 0, 6, '#eee8d8'); circle(c, -2, 0, 1.5, '#333'); circle(c, 2, 0, 1.5, '#333'); break;
      case 'mushroom': c.fillStyle = '#f2ead8'; c.fillRect(-1.5, 0, 3, 5); c.fillStyle = '#d64545'; c.beginPath(); c.arc(0, 0, 6, Math.PI, 0); c.fill(); circle(c, -2, -3, 1, '#fff'); circle(c, 2, -2, 1, '#fff'); break;
      case 'stump': circle(c, 0, 0, 7, '#6b4a2a'); circle(c, 0, 0, 5, '#b8935a'); c.strokeStyle = '#8a6a45'; c.beginPath(); c.arc(0, 0, 2.5, 0, TAU); c.stroke(); break;
      case 'ice': c.fillStyle = 'rgba(200,235,255,0.9)'; c.beginPath(); c.moveTo(0, -9); c.lineTo(5, 0); c.lineTo(0, 7); c.lineTo(-5, 0); c.fill(); break;
      case 'anvil': c.fillStyle = '#2b2f36'; c.fillRect(-7, -3, 14, 5); c.fillRect(-3, 2, 6, 4); break;
      case 'ember': circle(c, 0, 0, 4, 'rgba(255,122,47,0.5)'); circle(c, 0, 0, 2, '#ffd86b'); break;
      case 'statue': circle(c, 0, 0, 7, '#c9c3b5'); circle(c, 0, -1, 4, '#e3ddcf'); break;
      case 'banner': c.fillStyle = '#ffc53d'; c.fillRect(-1, -8, 2, 14); c.fillStyle = '#7a3ad6'; c.fillRect(1, -8, 7, 6); break;
      case 'hedge': rrect(c, -9, -5, 18, 10, 4, '#2e5a34'); break;
    }
    c.restore();
  }

  return { drawUnit, cardArt, spellIcon, drawField, drawRiver, shade };
})();
