/* Apex GP drawing: the rear view of an open-wheel car, roadside scenery, and the parallax
   background layers for each theme. Everything is drawn once into small canvases and reused. */
const ApexArt = (() => {
  const TAU = Math.PI * 2;
  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };
  const canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const rr = (c, x, y, w, h, r, fill) => { c.fillStyle = fill; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };

  // ---------- Cars ----------

  // Rear view, 200×110, wheels on the ground at the bottom. steer: -1 left, 0, 1 right.
  function drawCar(c, team, steer = 0) {
    const w = 200, h = 110, col = team.color, dark = team.dark;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(w / 2, h - 6, 96, 9, 0, 0, TAU); c.fill();
    // Front tyres peek out behind the rear ones, turned with the steering.
    for (const s of [-1, 1]) {
      const x = w / 2 + s * 62 + steer * 6;
      rr(c, x - 13, 42, 26, 34, 6, '#17181c');
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(x - 11, 46, 4, 26);
    }
    // Floor and sidepods.
    c.fillStyle = '#1b1d22';
    c.beginPath(); c.moveTo(30, 88); c.lineTo(170, 88); c.lineTo(160, 98); c.lineTo(40, 98); c.fill();
    const body = c.createLinearGradient(40, 0, 160, 0);
    body.addColorStop(0, shade(col, 0.25));
    body.addColorStop(0.5, col);
    body.addColorStop(1, shade(col, -0.35));
    c.fillStyle = body;
    c.beginPath(); c.moveTo(44, 90); c.quadraticCurveTo(46, 58, 78, 52); c.lineTo(122, 52); c.quadraticCurveTo(154, 58, 156, 90); c.closePath(); c.fill();
    // Engine cover rising to the airbox, with the halo and helmet in front.
    c.fillStyle = body;
    c.beginPath(); c.moveTo(80, 90); c.lineTo(86, 34); c.quadraticCurveTo(100, 22, 114, 34); c.lineTo(120, 90); c.fill();
    c.fillStyle = dark;
    c.fillRect(97, 30, 6, 60);
    c.fillStyle = '#16171b';
    c.beginPath(); c.ellipse(100, 36, 7, 5, 0, 0, TAU); c.fill();
    c.strokeStyle = '#2a2c33';
    c.lineWidth = 4;
    c.beginPath(); c.arc(100, 46, 22, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    c.fillStyle = '#f4f4f4';
    c.beginPath(); c.arc(100, 40, 10, Math.PI, 0); c.fill();
    c.fillStyle = col;
    c.fillRect(90, 37, 20, 3);
    // Rear tyres: wide slicks with a highlight.
    for (const s of [-1, 1]) {
      const x = w / 2 + s * 70;
      rr(c, x - 22, 50, 44, 54, 9, '#141519');
      c.fillStyle = 'rgba(255,255,255,0.1)';
      c.fillRect(x - 18, 56, 6, 42);
      c.fillStyle = '#2a2c33';
      c.fillRect(x - 22, 74, 44, 4);
    }
    // Rear wing on its pylon, team colour with endplates.
    c.fillStyle = '#22242a';
    c.fillRect(96, 22, 8, 30);
    const wing = c.createLinearGradient(0, 8, 0, 26);
    wing.addColorStop(0, shade(col, 0.2));
    wing.addColorStop(1, shade(col, -0.3));
    rr(c, 34, 10, 132, 14, 3, wing);
    c.fillStyle = dark;
    c.fillRect(34, 20, 132, 3);
    c.fillStyle = '#1b1d22';
    c.fillRect(30, 6, 7, 26);
    c.fillRect(163, 6, 7, 26);
    // Diffuser and the rain light.
    c.fillStyle = '#101115';
    c.beginPath(); c.moveTo(70, 92); c.lineTo(130, 92); c.lineTo(126, 104); c.lineTo(74, 104); c.fill();
    c.strokeStyle = '#2a2c33';
    c.lineWidth = 2;
    for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(78 + i * 11, 93); c.lineTo(78 + i * 11, 103); c.stroke(); }
    c.fillStyle = '#ff3030';
    c.fillRect(94, 84, 12, 6);
  }

  const carCache = new Map();
  function car(team, steer = 0) {
    const key = team.color + steer;
    if (!carCache.has(key)) {
      const cv = canvas(200, 110);
      drawCar(cv.getContext('2d'), team, steer);
      carCache.set(key, cv);
    }
    return carCache.get(key);
  }

  // ---------- Scenery ----------

  // Each sprite: a canvas plus its width in road units (the road is 2000 wide).
  const SPRITES = {
    palm: { w: 180, h: 300, world: 900, draw(c) {
      c.strokeStyle = '#8a6a45'; c.lineWidth = 16; c.lineCap = 'round';
      c.beginPath(); c.moveTo(90, 298); c.quadraticCurveTo(70, 180, 100, 70); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.15)'; c.lineWidth = 3;
      for (let y = 280; y > 80; y -= 16) { c.beginPath(); c.moveTo(78, y); c.lineTo(96, y - 4); c.stroke(); }
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.55;
        c.fillStyle = i % 2 ? '#2f8a3a' : '#3fa04a';
        c.beginPath(); c.moveTo(100, 70);
        c.quadraticCurveTo(100 + Math.cos(a) * 60, 70 + Math.sin(a) * 40 - 20, 100 + Math.cos(a) * 85, 70 + Math.sin(a) * 30 + 40);
        c.quadraticCurveTo(100 + Math.cos(a) * 50, 70 + Math.sin(a) * 20, 100, 76); c.fill();
      }
    } },
    pine: { w: 140, h: 260, world: 800, draw(c) {
      c.fillStyle = '#5a3a20'; c.fillRect(62, 220, 16, 40);
      for (let i = 0; i < 4; i++) {
        c.fillStyle = i % 2 ? '#2a6a34' : '#2f7a3a';
        const y = 20 + i * 50;
        c.beginPath(); c.moveTo(70, y); c.lineTo(70 + 30 + i * 12, y + 90); c.lineTo(70 - 30 - i * 12, y + 90); c.fill();
      }
      c.fillStyle = 'rgba(0,0,0,0.15)';
      c.beginPath(); c.moveTo(70, 20); c.lineTo(118, 230); c.lineTo(70, 230); c.fill();
    } },
    snowpine: { w: 140, h: 260, world: 800, draw(c) {
      SPRITES.pine.draw(c);
      c.fillStyle = '#f4f8fc';
      for (let i = 0; i < 4; i++) {
        const y = 20 + i * 50;
        c.beginPath(); c.moveTo(70, y); c.lineTo(70 + 14 + i * 5, y + 34); c.lineTo(70 - 14 - i * 5, y + 34); c.fill();
      }
    } },
    oak: { w: 220, h: 240, world: 900, draw(c) {
      c.fillStyle = '#5a3a20'; c.fillRect(100, 140, 22, 100);
      for (const [x, y, r, col] of [[70, 110, 60, '#3a8a3a'], [150, 100, 60, '#3a8a3a'], [110, 70, 70, '#45a045'], [110, 130, 55, '#348034']]) {
        c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
      }
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(90, 50, 30, 0, TAU); c.fill();
    } },
    cactus: { w: 120, h: 200, world: 520, draw(c) {
      c.strokeStyle = '#3f8a4a'; c.lineCap = 'round'; c.lineWidth = 26;
      c.beginPath(); c.moveTo(60, 195); c.lineTo(60, 20); c.stroke();
      c.lineWidth = 16;
      c.beginPath(); c.moveTo(60, 110); c.lineTo(25, 110); c.lineTo(25, 60); c.stroke();
      c.beginPath(); c.moveTo(60, 90); c.lineTo(95, 90); c.lineTo(95, 45); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(54, 190); c.lineTo(54, 26); c.stroke();
    } },
    rock: { w: 220, h: 140, world: 900, draw(c) {
      c.fillStyle = '#9a6a4a';
      c.beginPath(); c.moveTo(10, 138); c.lineTo(30, 60); c.lineTo(80, 20); c.lineTo(150, 30); c.lineTo(200, 80); c.lineTo(212, 138); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.2)';
      c.beginPath(); c.moveTo(150, 30); c.lineTo(200, 80); c.lineTo(212, 138); c.lineTo(130, 138); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.15)';
      c.beginPath(); c.moveTo(30, 60); c.lineTo(80, 20); c.lineTo(90, 50); c.fill();
    } },
    lamp: { w: 80, h: 300, world: 420, draw(c) {
      c.fillStyle = '#3a3f4a'; c.fillRect(36, 30, 8, 270);
      c.fillRect(10, 26, 40, 6);
      c.fillStyle = '#ffe9a8'; c.fillRect(6, 32, 22, 6);
      const g = c.createRadialGradient(17, 40, 2, 17, 40, 36);
      g.addColorStop(0, 'rgba(255,233,168,0.7)'); g.addColorStop(1, 'rgba(255,233,168,0)');
      c.fillStyle = g; c.fillRect(0, 0, 80, 90);
    } },
    tower: { w: 160, h: 320, world: 1400, draw(c) {
      c.fillStyle = '#20243a'; c.fillRect(10, 20, 140, 300);
      for (let y = 34; y < 310; y += 18) for (let x = 20; x < 140; x += 18) {
        c.fillStyle = Math.sin(x * 7.1 + y * 3.3) > 0.1 ? '#ffd86b' : '#2c3150';
        c.fillRect(x, y, 10, 10);
      }
    } },
    flag: { w: 120, h: 200, world: 520, draw(c) {
      c.fillStyle = '#cfd5dd'; c.fillRect(20, 10, 6, 190);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) {
        c.fillStyle = (x + y) % 2 ? '#1b1d22' : '#f4f4f4';
        c.fillRect(26 + x * 14, 12 + y * 14, 14, 14);
      }
    } },
    stand: { w: 320, h: 180, world: 2600, draw(c) {
      c.fillStyle = '#3a3f4a'; c.fillRect(0, 40, 320, 140);
      c.fillStyle = '#e03a3a'; c.fillRect(0, 20, 320, 22);
      c.fillStyle = '#f4f4f4'; c.font = '900 16px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('APEX GRAND PRIX', 160, 37);
      const cols = ['#ffc53d', '#4f8cff', '#ff5d5d', '#f4f4f4', '#3ddc84', '#a46bff'];
      for (let r = 0; r < 6; r++) for (let x = 6 + (r % 2) * 5; x < 316; x += 10) {
        c.fillStyle = cols[(x * 7 + r * 13) % cols.length];
        c.beginPath(); c.arc(x, 56 + r * 20, 4, 0, TAU); c.fill();
      }
    } },
    barrier: { w: 200, h: 60, world: 900, draw(c) {
      for (let i = 0; i < 5; i++) {
        c.fillStyle = i % 2 ? '#f4f4f4' : '#e03a3a';
        c.beginPath(); c.ellipse(20 + i * 40, 44, 20, 14, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(20 + i * 40, 40, 10, 5, 0, 0, TAU); c.fill();
      }
      c.fillStyle = '#1b1d22'; c.fillRect(0, 54, 200, 6);
    } },
  };
  const spriteCache = new Map();
  function sprite(kind, sponsor) {
    const key = kind + (sponsor ? sponsor[0] : '');
    if (spriteCache.has(key)) return spriteCache.get(key);
    let out;
    if (kind === 'billboard') {
      const cv = canvas(260, 170), c = cv.getContext('2d');
      c.fillStyle = '#3a3f4a'; c.fillRect(40, 90, 10, 80); c.fillRect(210, 90, 10, 80);
      rr(c, 4, 4, 252, 100, 8, sponsor[1]);
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 4; c.stroke();
      c.fillStyle = sponsor[2]; c.font = '900 34px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText(sponsor[0], 130, 68, 230);
      out = { img: cv, world: 1300 };
    } else {
      const s = SPRITES[kind], cv = canvas(s.w, s.h);
      s.draw(cv.getContext('2d'));
      out = { img: cv, world: s.world };
    }
    spriteCache.set(key, out);
    return out;
  }

  // ---------- Backgrounds ----------

  // Three layers per theme, each 2W wide so they can wrap as the road curves.
  function backgrounds(theme, W, H) {
    const sky = canvas(W, H), s = sky.getContext('2d');
    const g = s.createLinearGradient(0, 0, 0, H * 0.6);
    g.addColorStop(0, theme.sky[0]);
    g.addColorStop(1, theme.sky[1]);
    s.fillStyle = g;
    s.fillRect(0, 0, W, H);
    if (theme.night) {
      for (let i = 0; i < 120; i++) {
        s.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.12})`;
        s.fillRect((i * 97.3) % W, (i * 41.7) % (H * 0.45), 1.5, 1.5);
      }
      s.fillStyle = '#f4f0d8';
      s.beginPath(); s.arc(W * 0.78, H * 0.14, 22, 0, TAU); s.fill();
      s.fillStyle = theme.sky[0];
      s.beginPath(); s.arc(W * 0.78 + 9, H * 0.13, 19, 0, TAU); s.fill();
    } else if (theme.sun) {
      const sg = s.createRadialGradient(W * 0.7, H * 0.2, 4, W * 0.7, H * 0.2, 120);
      sg.addColorStop(0, theme.sun);
      sg.addColorStop(0.25, theme.sun + 'aa');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      s.fillStyle = sg;
      s.fillRect(0, 0, W, H);
      s.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 6; i++) {
        const x = (i * 211) % W, y = 40 + (i * 37) % 90;
        for (const [dx, r] of [[0, 18], [20, 24], [44, 16]]) { s.beginPath(); s.arc(x + dx, y, r, 0, TAU); s.fill(); }
      }
    }
    const layer = (fn) => {
      const cv = canvas(W * 2, H), c = cv.getContext('2d');
      fn(c, W * 2);
      return cv;
    };
    const horizon = H * 0.52;
    const far = layer((c, w) => {
      c.fillStyle = theme.far;
      c.beginPath(); c.moveTo(0, horizon);
      for (let x = 0; x <= w; x += 40) c.lineTo(x, horizon - 60 - Math.abs(Math.sin(x * 0.006) * 90) - Math.sin(x * 0.021) * 25);
      c.lineTo(w, horizon); c.closePath(); c.fill();
      if (theme === ApexData.THEMES.alpine) {
        c.fillStyle = '#f4f8fc';
        for (let x = 0; x <= w; x += 40) {
          const y = horizon - 60 - Math.abs(Math.sin(x * 0.006) * 90) - Math.sin(x * 0.021) * 25;
          if (y < horizon - 110) { c.beginPath(); c.moveTo(x - 18, y + 20); c.lineTo(x, y); c.lineTo(x + 18, y + 20); c.fill(); }
        }
      }
    });
    const mid = layer((c, w) => {
      if (theme.night) {
        // A skyline with lit windows.
        for (let x = 0; x < w; x += 44) {
          const bh = 50 + Math.abs(Math.sin(x * 0.37)) * 110;
          c.fillStyle = theme.mid;
          c.fillRect(x, horizon - bh, 40, bh);
          for (let y = horizon - bh + 8; y < horizon - 6; y += 12) for (let wx = x + 5; wx < x + 36; wx += 10) {
            c.fillStyle = Math.sin(wx * 3.7 + y * 1.3) > 0.3 ? '#ffd86b' : 'rgba(255,255,255,0.06)';
            c.fillRect(wx, y, 5, 6);
          }
        }
      } else {
        c.fillStyle = theme.mid;
        c.beginPath(); c.moveTo(0, horizon);
        for (let x = 0; x <= w; x += 30) c.lineTo(x, horizon - 18 - Math.abs(Math.sin(x * 0.011 + 1)) * 40);
        c.lineTo(w, horizon); c.closePath(); c.fill();
        if (theme.sea) {
          c.fillStyle = theme.sea;
          c.fillRect(0, horizon - 8, w, 14);
          c.fillStyle = 'rgba(255,255,255,0.4)';
          for (let x = 0; x < w; x += 23) c.fillRect(x, horizon - 4 + (x % 3), 10, 1.5);
        }
      }
    });
    return { sky, far, mid, horizon };
  }

  return { car, sprite, backgrounds, shade };
})();
