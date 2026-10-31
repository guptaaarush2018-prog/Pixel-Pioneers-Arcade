/* Pocket Racer drawing: car sprites, and the track with its kerbs, scenery and grandstand.
   Everything is drawn in world units (the 800 x 560 field) with whatever transform the camera
   has set, so it stays sharp at any zoom. Car bodies are cached as sprites per skin. */
const RacerArt = (() => {
  const TRACK_W = 80;
  const TAU = Math.PI * 2;

  // Small seeded random generator, so a track's scenery is the same every visit.
  function seeded(str) {
    let h = 1779033703;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
    let a = h >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };

  // ---------- Cars ----------
  // Car shapes face +x, centred on the origin, about 28 x 16 world units.

  const MODELS = {
    coupe: { len: 28, wid: 15, wheels: [[-8, 7.5], [8, 7.5]], exposed: false },
    muscle: { len: 30, wid: 16, wheels: [[-9, 8], [9, 8]], exposed: false },
    formula: { len: 30, wid: 13, wheels: [[-9, 8], [9, 7.5]], exposed: true },
    buggy: { len: 26, wid: 15, wheels: [[-8, 8.5], [8, 8.5]], exposed: true },
    kart: { len: 22, wid: 14, wheels: [[-6.5, 7.5], [6.5, 7]], exposed: true },
  };

  function bodyPath(model) {
    const p = new Path2D();
    const m = MODELS[model];
    const L = m.len / 2, Wd = m.wid / 2;
    switch (model) {
      case 'formula':
        p.moveTo(L, 0);
        p.lineTo(L - 4, -2.4);
        p.lineTo(2, -3.4);
        p.lineTo(-2, -5.2);
        p.lineTo(-L + 4, -5.2);
        p.lineTo(-L + 2, -3);
        p.lineTo(-L + 2, 3);
        p.lineTo(-L + 4, 5.2);
        p.lineTo(-2, 5.2);
        p.lineTo(2, 3.4);
        p.lineTo(L - 4, 2.4);
        p.closePath();
        break;
      case 'kart':
        p.roundRect(-L + 2, -Wd + 3, m.len - 4, m.wid - 6, 3);
        break;
      case 'buggy':
        p.moveTo(L - 1, -Wd + 3);
        p.lineTo(L, 0);
        p.lineTo(L - 1, Wd - 3);
        p.lineTo(-L + 2, Wd - 2);
        p.lineTo(-L, 0);
        p.lineTo(-L + 2, -Wd + 2);
        p.closePath();
        break;
      case 'muscle':
        p.roundRect(-L, -Wd, m.len, m.wid, [3, 5, 5, 3]);
        break;
      default:
        p.roundRect(-L, -Wd, m.len, m.wid, [4, 6, 6, 4]);
    }
    return p;
  }

  function paintPattern(c, skin, m) {
    const L = m.len / 2, Wd = m.wid / 2;
    c.fillStyle = skin.trim;
    switch (skin.pattern) {
      case 'stripes':
        c.fillRect(-L, -2.6, m.len, 1.6);
        c.fillRect(-L, 1, m.len, 1.6);
        break;
      case 'racing':
        c.fillRect(-L, -2.2, m.len, 4.4);
        break;
      case 'split':
        c.fillRect(-L, -Wd, m.len * 0.45, m.wid);
        break;
      case 'checker':
        for (let i = 0; i < 4; i++) for (let j = -4; j < 4; j++) if ((i + j) % 2 === 0) c.fillRect(L - 9 + i * 2, j * 2, 2, 2);
        break;
      case 'bolt':
        c.beginPath();
        c.moveTo(-L, -1);
        c.lineTo(-3, -4);
        c.lineTo(-1, -0.5);
        c.lineTo(L, -3);
        c.lineTo(1, 1.5);
        c.lineTo(-1, -1.5);
        c.closePath();
        c.fill();
        break;
      case 'tiger':
        for (let x = -L + 2; x < L; x += 4.5) {
          c.beginPath();
          c.moveTo(x, -Wd);
          c.lineTo(x + 2.2, -Wd);
          c.lineTo(x + 0.4, -1.5);
          c.closePath();
          c.fill();
          c.beginPath();
          c.moveTo(x, Wd);
          c.lineTo(x + 2.2, Wd);
          c.lineTo(x + 0.4, 1.5);
          c.closePath();
          c.fill();
        }
        break;
      case 'flames': {
        const g = c.createLinearGradient(L, 0, -L * 0.2, 0);
        g.addColorStop(0, skin.trim);
        g.addColorStop(1, shade(skin.trim, -0.2));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(L, -Wd);
        for (let i = 0; i <= 6; i++) {
          const y = -Wd + (m.wid * i) / 6;
          c.lineTo(i % 2 ? -L * (0.1 + 0.15 * (i % 3)) : L * 0.3, y);
        }
        c.lineTo(L, Wd);
        c.closePath();
        c.fill();
        break;
      }
    }
  }

  function drawBody(c, skin) {
    const m = MODELS[skin.model] || MODELS.coupe;
    const L = m.len / 2, Wd = m.wid / 2;
    const body = bodyPath(skin.model);

    // Rear wing / spoiler sits under the body edge.
    c.fillStyle = shade(skin.paint, -0.45);
    if (skin.model === 'formula') {
      c.fillRect(-L - 1, -7, 4, 14);
      c.fillRect(L - 3, -6.5, 3, 13); // front wing
    } else if (skin.model !== 'kart' && skin.model !== 'buggy') {
      c.fillRect(-L - 1, -Wd + 1, 2.5, m.wid - 2);
    }

    c.save();
    c.clip(body);
    c.fillStyle = skin.paint;
    c.fillRect(-L - 2, -Wd - 2, m.len + 4, m.wid + 4);
    paintPattern(c, skin, m);
    // Rounded-body shading: light down the middle, darker at the sides.
    const g = c.createLinearGradient(0, -Wd, 0, Wd);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.4)');
    c.fillStyle = g;
    c.fillRect(-L - 2, -Wd - 2, m.len + 4, m.wid + 4);
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 0.6;
    c.stroke(body);

    // Cockpit / cabin.
    if (skin.model === 'formula' || skin.model === 'kart') {
      c.fillStyle = '#15171c';
      c.beginPath();
      c.ellipse(skin.model === 'kart' ? -1 : -2, 0, 3.2, 2.4, 0, 0, TAU);
      c.fill();
      // Helmet.
      c.fillStyle = skin.trim;
      c.beginPath();
      c.arc(skin.model === 'kart' ? -1.5 : -2.5, 0, 1.9, 0, TAU);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.beginPath();
      c.arc(skin.model === 'kart' ? -1 : -2, -0.6, 0.7, 0, TAU);
      c.fill();
    } else if (skin.model === 'buggy') {
      c.strokeStyle = '#22252b';
      c.lineWidth = 1.2;
      c.strokeRect(-6, -4.5, 9, 9);
      c.beginPath();
      c.moveTo(-6, -4.5); c.lineTo(3, 4.5);
      c.moveTo(-6, 4.5); c.lineTo(3, -4.5);
      c.stroke();
      c.fillStyle = skin.trim;
      c.beginPath();
      c.arc(-1.5, 0, 2, 0, TAU);
      c.fill();
    } else {
      const front = skin.model === 'muscle' ? 2 : 3.5;
      const glass = c.createLinearGradient(front, 0, -8, 0);
      glass.addColorStop(0, '#9fd3ff');
      glass.addColorStop(0.35, '#2b3a55');
      glass.addColorStop(1, '#182033');
      c.fillStyle = glass;
      c.beginPath();
      c.moveTo(front, -Wd + 2.4);
      c.lineTo(front + 1.6, 0);
      c.lineTo(front, Wd - 2.4);
      c.lineTo(-7.5, Wd - 2.8);
      c.lineTo(-8.5, 0);
      c.lineTo(-7.5, -Wd + 2.8);
      c.closePath();
      c.fill();
      c.fillStyle = shade(skin.paint, -0.1);
      c.fillRect(-5.6, -Wd + 3.4, 6.8, m.wid - 6.8); // roof
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(-5.2, -Wd + 3.6, 6, 1.2);
      if (skin.model === 'muscle') {
        c.fillStyle = shade(skin.paint, -0.35);
        c.fillRect(6, -1.6, 5, 3.2); // hood scoop
      }
    }

    // Number roundel on the nose.
    if (skin.num !== undefined && skin.model !== 'kart') {
      const nx = skin.model === 'formula' ? 7 : L - 6;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(nx, 0, 2.6, 0, TAU);
      c.fill();
      c.fillStyle = '#111';
      c.font = '700 3.2px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.save();
      c.translate(nx, 0);
      c.rotate(Math.PI / 2);
      c.fillText(String(skin.num), 0, 0.2);
      c.restore();
    }

    // Headlights.
    c.fillStyle = '#fff6c8';
    if (skin.model === 'coupe' || skin.model === 'muscle') {
      c.fillRect(L - 1.4, -Wd + 1.6, 1.2, 2.4);
      c.fillRect(L - 1.4, Wd - 4, 1.2, 2.4);
    }
  }

  const spriteCache = new Map();
  const SPRITE_SCALE = 6;
  function carSprite(skin) {
    if (spriteCache.has(skin.id)) return spriteCache.get(skin.id);
    const w = 40, h = 24;
    const cv = document.createElement('canvas');
    cv.width = w * SPRITE_SCALE;
    cv.height = h * SPRITE_SCALE;
    const c = cv.getContext('2d');
    c.scale(SPRITE_SCALE, SPRITE_SCALE);
    c.translate(w / 2, h / 2);
    drawBody(c, skin);
    const sprite = { canvas: cv, w, h };
    spriteCache.set(skin.id, sprite);
    return sprite;
  }

  function wheel(c, x, y, a, exposed) {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = '#111317';
    c.beginPath();
    c.roundRect(-2.8, -1.7, 5.6, 3.4, 1);
    c.fill();
    if (exposed) {
      c.fillStyle = '#6b707a';
      c.fillRect(-1, -1, 2, 2);
    }
    c.restore();
  }

  // opts: steer -1..1, brake bool, alpha, lights (night), bob (0..1 suspension wobble)
  function drawCar(c, skin, x, y, a, opts = {}) {
    const m = MODELS[skin.model] || MODELS.coupe;
    const sprite = carSprite(skin);
    c.save();
    c.globalAlpha = opts.alpha ?? 1;
    c.translate(x, y);
    c.rotate(a);
    // Soft shadow.
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath();
    c.ellipse(1.5, 2.5, m.len / 2 + 1, m.wid / 2 + 1, 0, 0, TAU);
    c.fill();
    const steerA = (opts.steer || 0) * 0.45;
    for (const [wx, wy] of m.wheels) {
      wheel(c, wx, -wy, wx > 0 ? steerA : 0, m.exposed);
      wheel(c, wx, wy, wx > 0 ? steerA : 0, m.exposed);
    }
    c.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
    // Brake lights glow when braking.
    const L = m.len / 2, Wd = m.wid / 2;
    c.fillStyle = opts.brake ? '#ff3b3b' : '#7a1717';
    c.fillRect(-L, -Wd + 1.4, 1.2, 2.2);
    c.fillRect(-L, Wd - 3.6, 1.2, 2.2);
    if (opts.brake) {
      c.globalAlpha = (opts.alpha ?? 1) * 0.45;
      c.fillStyle = '#ff2a2a';
      c.beginPath();
      c.ellipse(-L - 2, 0, 3, Wd, 0, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  // ---------- Track scene ----------

  function grassPattern(ctx, theme) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 120;
    const c = cv.getContext('2d');
    c.fillStyle = theme.grass;
    c.fillRect(0, 0, 120, 120);
    // Mowing stripes (or wind-swept sand and snow).
    c.fillStyle = theme.grass2;
    for (let i = -120; i < 240; i += 60) {
      c.beginPath();
      c.moveTo(i, 0); c.lineTo(i + 30, 0); c.lineTo(i + 150, 120); c.lineTo(i + 120, 120);
      c.closePath();
      c.fill();
    }
    const rnd = seeded(theme.id);
    for (let i = 0; i < 140; i++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      c.fillRect(rnd() * 120, rnd() * 120, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    return ctx.createPattern(cv, 'repeat');
  }

  function asphaltPattern(ctx, night) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.fillStyle = night ? '#2c3040' : '#3c4049';
    c.fillRect(0, 0, 64, 64);
    const rnd = seeded('asphalt');
    for (let i = 0; i < 260; i++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
      c.fillRect(rnd() * 64, rnd() * 64, 1, 1);
    }
    return ctx.createPattern(cv, 'repeat');
  }

  // Polyline offset sideways from the centreline (positive = left of the driving direction).
  function offsetLine(path, off, from = 0, to = path.length) {
    const p = new Path2D();
    for (let k = from; k <= to; k++) {
      const pt = path[k % path.length];
      const x = pt.x + Math.cos(pt.a + Math.PI / 2) * off, y = pt.y + Math.sin(pt.a + Math.PI / 2) * off;
      k === from ? p.moveTo(x, y) : p.lineTo(x, y);
    }
    return p;
  }

  // Runs of path indices where the road bends tightly, with which side is the outside.
  function cornerRuns(path, radii) {
    const n = path.length, runs = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const tight = i < n && radii[i] < 130;
      if (tight && start < 0) start = i;
      if (!tight && start >= 0) {
        if (i - start > 3) {
          const mid = path[Math.floor((start + i) / 2) % n], before = path[Math.max(0, start - 3)], after = path[Math.min(n - 1, i + 2)];
          const turn = Math.atan2(Math.sin(after.a - before.a), Math.cos(after.a - before.a));
          runs.push({ from: Math.max(0, start - 3), to: Math.min(n - 1, i + 3), outside: turn > 0 ? -1 : 1, mid });
        }
        start = -1;
      }
    }
    return runs;
  }

  function buildScene(ctx, track, path, radii, W, H) {
    const theme = RacerData.themeOf(track);
    const n = path.length;
    const rnd = seeded(track.id + ':' + n);
    const road = new Path2D();
    path.forEach((pt, i) => (i ? road.lineTo(pt.x, pt.y) : road.moveTo(pt.x, pt.y)));
    road.closePath();
    const runs = cornerRuns(path, radii);

    // Distance from a point to the road centreline (coarse search is plenty here).
    const nearRoad = (x, y, clear) => {
      for (let i = 0; i < n; i += 2) if ((path[i].x - x) ** 2 + (path[i].y - y) ** 2 < clear * clear) return true;
      return false;
    };

    // Grandstand on the outside of the start straight.
    const s = path[0];
    const outSide = (() => {
      // Pick the side with more room inside the field.
      const nx = Math.cos(s.a + Math.PI / 2), ny = Math.sin(s.a + Math.PI / 2);
      const room = k => Math.min(s.x + nx * k * 90, W - (s.x + nx * k * 90), s.y + ny * k * 90, H - (s.y + ny * k * 90));
      return room(1) > room(-1) ? 1 : -1;
    })();
    const stand = { x: s.x + Math.cos(s.a + Math.PI / 2) * outSide * 72, y: s.y + Math.sin(s.a + Math.PI / 2) * outSide * 72, a: s.a, side: outSide };
    stand.ok = !nearRoad(stand.x, stand.y, 60) && stand.x > 50 && stand.x < W - 50 && stand.y > 30 && stand.y < H - 30;
    stand.crowd = Array.from({ length: 70 }, () => ({ x: rnd() * 96 - 48, y: rnd() * 14 - 7, c: ['#ff5d5d', '#4f8cff', '#ffc53d', '#3ddc84', '#ffffff', '#c77dff'][Math.floor(rnd() * 6)] }));

    // Tyre walls on the outside of the tight corners.
    const tyres = [];
    for (const r of runs) {
      for (let k = r.from; k <= r.to; k += 3) {
        const pt = path[k % n];
        const x = pt.x + Math.cos(pt.a + Math.PI / 2) * r.outside * (TRACK_W / 2 + 34), y = pt.y + Math.sin(pt.a + Math.PI / 2) * r.outside * (TRACK_W / 2 + 34);
        if (x < 6 || x > W - 6 || y < 6 || y > H - 6 || nearRoad(x, y, TRACK_W / 2 + 22)) continue;
        tyres.push({ x, y });
      }
    }

    // Scenery, scattered where there's grass to spare.
    const props = [];
    for (let tries = 0; tries < 900 && props.length < 70; tries++) {
      const x = 10 + rnd() * (W - 20), y = 10 + rnd() * (H - 20);
      if (nearRoad(x, y, TRACK_W / 2 + 30)) continue;
      if (stand.ok && Math.hypot(x - stand.x, y - stand.y) < 70) continue;
      if (props.some(p => Math.hypot(p.x - x, p.y - y) < 22)) continue;
      const kind = theme.scenery[Math.floor(rnd() * theme.scenery.length)];
      props.push({ x, y, kind, s: 0.75 + rnd() * 0.6, r: rnd() * TAU, hue: rnd() });
    }
    props.sort((a, b) => a.y - b.y);

    // Night: street lamps along the road for the lighting pass.
    const lamps = [];
    if (theme.night) {
      for (let k = 0; k < n; k += Math.max(10, Math.floor(n / 14))) {
        const pt = path[k], side = k % 2 ? 1 : -1;
        const x = pt.x + Math.cos(pt.a + Math.PI / 2) * side * (TRACK_W / 2 + 12), y = pt.y + Math.sin(pt.a + Math.PI / 2) * side * (TRACK_W / 2 + 12);
        if (x > 4 && x < W - 4 && y > 4 && y < H - 4) lamps.push({ x, y });
      }
    }

    return {
      theme, road, runs, stand, tyres, props, lamps,
      grass: grassPattern(ctx, theme),
      asphalt: asphaltPattern(ctx, theme.night),
      kerbs: runs.map(r => ({ inner: offsetLine(path, -r.outside * (TRACK_W / 2 + 2), r.from, r.to), outer: offsetLine(path, r.outside * (TRACK_W / 2 + 2), r.from, r.to), trap: offsetLine(path, r.outside * (TRACK_W / 2 + 14), r.from, r.to) })),
      path, W, H,
    };
  }

  function drawProp(c, p, theme) {
    const s = p.s;
    c.save();
    c.translate(p.x, p.y);
    c.scale(s, s);
    const shadow = (rx, ry, ox = 3, oy = 4) => {
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.beginPath();
      c.ellipse(ox, oy, rx, ry, 0, 0, TAU);
      c.fill();
    };
    switch (p.kind) {
      case 'tree':
        shadow(10, 8);
        c.fillStyle = '#2f6b35';
        c.beginPath(); c.arc(0, 0, 10, 0, TAU); c.fill();
        c.fillStyle = '#3e8a44';
        c.beginPath(); c.arc(-2, -2, 7, 0, TAU); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.beginPath(); c.arc(-3, -4, 3.5, 0, TAU); c.fill();
        break;
      case 'bush':
        shadow(7, 5, 2, 3);
        c.fillStyle = '#356f3a';
        for (const [x, y] of [[-3, 0], [3, 1], [0, -3]]) { c.beginPath(); c.arc(x, y, 4.5, 0, TAU); c.fill(); }
        break;
      case 'flowers':
        for (let i = 0; i < 6; i++) {
          c.fillStyle = ['#ffd23f', '#ff7ab6', '#ffffff'][(i + Math.floor(p.hue * 3)) % 3];
          c.beginPath(); c.arc(Math.cos(i * 1.7) * 6, Math.sin(i * 2.3) * 5, 1.4, 0, TAU); c.fill();
        }
        break;
      case 'pine':
      case 'snowpine':
        shadow(8, 6);
        for (const [r, col] of [[10, '#24502a'], [7, '#2e6334'], [4, '#3a7a40']]) {
          c.fillStyle = p.kind === 'snowpine' && r === 4 ? '#ffffff' : col;
          c.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU, rr = i % 2 ? r * 0.6 : r;
            i ? c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          c.closePath();
          c.fill();
        }
        if (p.kind === 'snowpine') {
          c.fillStyle = 'rgba(255,255,255,0.75)';
          c.beginPath(); c.arc(-3, -3, 3, 0, TAU); c.fill();
        }
        break;
      case 'rock':
        shadow(7, 5, 2, 3);
        c.rotate(p.r);
        c.fillStyle = theme.id === 'snow' ? '#9aa6b2' : '#8a7c6c';
        c.beginPath(); c.moveTo(-7, 2); c.lineTo(-4, -5); c.lineTo(4, -6); c.lineTo(7, 1); c.lineTo(2, 6); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.2)';
        c.beginPath(); c.moveTo(-4, -5); c.lineTo(4, -6); c.lineTo(1, -1); c.closePath(); c.fill();
        break;
      case 'mesa':
        shadow(14, 10, 5, 6);
        c.fillStyle = '#9c5f35';
        c.beginPath(); c.roundRect(-13, -9, 26, 18, 6); c.fill();
        c.fillStyle = '#b8743f';
        c.beginPath(); c.roundRect(-10, -7, 18, 12, 5); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.15)';
        c.lineWidth = 1;
        c.beginPath(); c.roundRect(-6, -4, 10, 6, 3); c.stroke();
        break;
      case 'shrub':
        c.fillStyle = theme.id === 'desert' ? '#8d9a4a' : '#7a7a3a';
        for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(Math.cos(i * 1.3) * 3, Math.sin(i * 1.9) * 3, 2.2, 0, TAU); c.fill(); }
        break;
      case 'cactus':
        shadow(6, 4, 3, 3);
        c.fillStyle = '#3f8a4a';
        c.beginPath(); c.arc(0, 0, 4.5, 0, TAU); c.fill();
        c.beginPath(); c.arc(-5, -2, 2.6, 0, TAU); c.fill();
        c.beginPath(); c.arc(5, 1, 2.6, 0, TAU); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.25)';
        c.beginPath(); c.arc(-1, -1, 1.5, 0, TAU); c.fill();
        if (p.hue > 0.6) { c.fillStyle = '#ff7ab6'; c.beginPath(); c.arc(1, -2, 1.3, 0, TAU); c.fill(); }
        break;
      case 'snowman':
        shadow(6, 5);
        c.fillStyle = '#ffffff';
        c.beginPath(); c.arc(0, 1, 5.5, 0, TAU); c.fill();
        c.beginPath(); c.arc(0, -4, 3.5, 0, TAU); c.fill();
        c.fillStyle = '#ff8a1f';
        c.fillRect(0, -4.5, 3.5, 1);
        c.fillStyle = '#222';
        c.fillRect(-1.5, -5.5, 1, 1);
        break;
      case 'building': {
        shadow(13, 13, 5, 6);
        c.fillStyle = '#2c3560';
        c.fillRect(-11, -11, 22, 22);
        c.fillStyle = '#3a457a';
        c.fillRect(-11, -11, 22, 4);
        const r = seeded(String(p.x + p.y));
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
          c.fillStyle = r() < 0.55 ? '#ffd86b' : '#1a2140';
          c.fillRect(-8 + i * 4.5, -4 + j * 4.5, 2.6, 2.6);
        }
        break;
      }
      case 'lamp':
        c.fillStyle = '#ffe9a8';
        c.beginPath(); c.arc(0, 0, 2.2, 0, TAU); c.fill();
        break;
    }
    c.restore();
  }

  // Everything under the cars that never moves; drawn once into a layer per track.
  function drawScene(c, sc) {
    const { path, theme } = sc;
    c.fillStyle = sc.grass;
    c.fillRect(-200, -200, sc.W + 400, sc.H + 400);
    // Darker band outside the field so the edge of the world doesn't just stop.
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 400;
    c.strokeRect(-200, -200, sc.W + 400, sc.H + 400);

    c.lineJoin = 'round';
    c.lineCap = 'round';
    // Gravel traps on the outside of corners.
    if (!theme.night && theme.id !== 'snow') {
      c.strokeStyle = theme.id === 'desert' || theme.id === 'canyon' ? 'rgba(240,215,160,0.55)' : '#cdb98a';
      c.lineWidth = 26;
      for (const k of sc.kerbs) c.stroke(k.trap);
    }
    // Road edge, asphalt, then the painted lines.
    c.strokeStyle = theme.night ? '#c9d2ff' : '#f2f2f2';
    c.lineWidth = TRACK_W + 6;
    c.stroke(sc.road);
    c.strokeStyle = sc.asphalt;
    c.lineWidth = TRACK_W;
    c.stroke(sc.road);
    // Kerbs: red and white blocks on both edges through the corners.
    c.lineCap = 'butt';
    c.lineWidth = 6;
    for (const k of sc.kerbs) {
      for (const line of [k.inner, k.outer]) {
        c.strokeStyle = '#f4f4f4';
        c.setLineDash([]);
        c.stroke(line);
        c.strokeStyle = '#e03b3b';
        c.setLineDash([7, 7]);
        c.stroke(line);
      }
    }
    c.setLineDash([16, 18]);
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1.6;
    c.stroke(sc.road);
    c.setLineDash([]);
    c.lineCap = 'round';

    // Start grid boxes and the chequered line.
    const s = path[0];
    for (let slot = 0; slot < 4; slot++) {
      const back = 8 + Math.floor(slot / 2) * 9, i = (path.length - back) % path.length, p = path[i];
      const side = slot % 2 ? 1 : -1;
      const x = p.x + Math.cos(p.a + Math.PI / 2) * side * 18, y = p.y + Math.sin(p.a + Math.PI / 2) * side * 18;
      c.save();
      c.translate(x, y);
      c.rotate(p.a);
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(-12, -9); c.lineTo(17, -9); c.lineTo(17, 9); c.lineTo(-12, 9);
      c.stroke();
      c.restore();
    }
    c.save();
    c.translate(s.x, s.y);
    c.rotate(s.a + Math.PI / 2);
    for (let i = 0; i < TRACK_W / 5; i++) {
      for (let j = 0; j < 3; j++) {
        c.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        c.fillRect(-TRACK_W / 2 + i * 5, -7.5 + j * 5, 5, 5);
      }
    }
    // Start gantry posts.
    c.fillStyle = '#9aa3b5';
    c.fillRect(-TRACK_W / 2 - 9, -2, 5, 4);
    c.fillRect(TRACK_W / 2 + 4, -2, 5, 4);
    c.fillStyle = 'rgba(30,34,42,0.85)';
    c.fillRect(-TRACK_W / 2 - 6, -3, TRACK_W + 12, 6);
    c.fillStyle = '#ffc53d';
    c.font = '800 4.5px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('POCKET RACER', 0, 0.3);
    c.restore();

    // Tyre walls.
    for (const ty of sc.tyres) {
      c.fillStyle = '#16181c';
      c.beginPath(); c.arc(ty.x, ty.y, 3.6, 0, TAU); c.fill();
      c.fillStyle = '#3a3e46';
      c.beginPath(); c.arc(ty.x, ty.y, 1.4, 0, TAU); c.fill();
    }

    // Grandstand with a crowd that bounces a little.
    if (sc.stand.ok) {
      const st = sc.stand;
      c.save();
      c.translate(st.x, st.y);
      c.rotate(st.a);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(-50, -10, 104, 26);
      c.fillStyle = '#4a5160';
      c.fillRect(-52, -12, 104, 24);
      for (let r = 0; r < 3; r++) {
        c.fillStyle = r % 2 ? '#596172' : '#646d80';
        c.fillRect(-50, -10 + r * 7, 100, 6);
      }
      c.fillStyle = '#d64545';
      c.fillRect(-52, st.side > 0 ? 10 : -14, 104, 4); // roof edge facing away from the road
      c.restore();
    }

    for (const p of sc.props) drawProp(c, p, theme);
  }

  // The crowd in the grandstand, drawn every frame so it can bounce (harder when `cheer` is set).
  function drawCrowd(c, sc, t, cheer = 0) {
    const st = sc.stand;
    if (!st.ok) return;
    c.save();
    c.translate(st.x, st.y);
    c.rotate(st.a);
    for (const p of st.crowd) {
      c.fillStyle = p.c;
      c.beginPath();
      c.arc(p.x, p.y - Math.abs(Math.sin(t * (6 + cheer * 6) + p.x)) * (0.6 + cheer * 1.6), 1.5, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  // Night lighting: darkness everywhere except under the lamps and in front of each car.
  // Drawn in screen space onto `layer`, then laid over the scene.
  function drawNight(layer, c, sc, cars, transform) {
    const lc = layer.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, layer.width, layer.height);
    lc.fillStyle = 'rgba(4,6,22,0.62)';
    lc.fillRect(0, 0, layer.width, layer.height);
    lc.setTransform(transform);
    lc.globalCompositeOperation = 'destination-out';
    for (const l of sc.lamps) {
      const g = lc.createRadialGradient(l.x, l.y, 2, l.x, l.y, 46);
      g.addColorStop(0, 'rgba(0,0,0,0.95)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.beginPath(); lc.arc(l.x, l.y, 46, 0, TAU); lc.fill();
    }
    for (const car of cars) {
      lc.save();
      lc.translate(car.x, car.y);
      lc.rotate(car.a);
      const g = lc.createLinearGradient(10, 0, 110, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.9)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.beginPath();
      lc.moveTo(10, -6); lc.lineTo(110, -38); lc.lineTo(110, 38); lc.lineTo(10, 6);
      lc.closePath();
      lc.fill();
      const halo = lc.createRadialGradient(0, 0, 4, 0, 0, 26);
      halo.addColorStop(0, 'rgba(0,0,0,0.7)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = halo;
      lc.beginPath(); lc.arc(0, 0, 26, 0, TAU); lc.fill();
      lc.restore();
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(layer, 0, 0);
    c.restore();
  }

  // A small picture of a track, for menus and the minimap.
  function trackThumb(c, path, w, h, { color = '#e8e8e8', width = 3, pad = 6, world = [800, 560] } = {}) {
    const s = Math.min((w - pad * 2) / world[0], (h - pad * 2) / world[1]);
    c.save();
    c.translate((w - world[0] * s) / 2, (h - world[1] * s) / 2);
    c.scale(s, s);
    c.beginPath();
    path.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.lineJoin = 'round';
    c.strokeStyle = color;
    c.lineWidth = width / s;
    c.stroke();
    const st = path[0];
    c.fillStyle = '#ffc53d';
    c.beginPath(); c.arc(st.x, st.y, (width * 1.4) / s, 0, TAU); c.fill();
    c.restore();
    return s;
  }

  return { TRACK_W, MODELS, carSprite, drawCar, buildScene, drawScene, drawCrowd, drawNight, trackThumb, seeded, shade };
})();
