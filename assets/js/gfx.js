/* Shared drawing and "game feel" helpers: colour shading, soft shadows, extruded (fake 3D) shapes,
   outlined text, particles, floating popups, screen shake and easing. Load after arcade.js.
   Everything draws in the canvas's logical units, so it works with Arcade.setupCanvas. */
const Gfx = (() => {
  // Effects use their own random numbers, never Math.random: online duels (versus.js) seed
  // Math.random so both players get the same game, and cosmetic rolls must not shift that sequence.
  let fxSeed = (Date.now() ^ 0x9e3779b9) >>> 0 || 1;
  function fxRand() {
    fxSeed ^= fxSeed << 13; fxSeed >>>= 0;
    fxSeed ^= fxSeed >>> 17;
    fxSeed ^= fxSeed << 5; fxSeed >>>= 0;
    return fxSeed / 4294967296;
  }
  const rand = (a = 0, b = 1) => a + fxRand() * (b - a);

  // ---------- Colour ----------

  const hexCache = new Map();
  function rgb(hex) {
    let c = hexCache.get(hex);
    if (!c) {
      const h = hex.replace('#', '');
      const n = parseInt(h.length === 3 ? h.replace(/./g, d => d + d) : h, 16);
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      hexCache.set(hex, c);
    }
    return c;
  }
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  // amt > 0 lightens toward white, amt < 0 darkens toward black (-1..1).
  function shade(hex, amt) {
    const [r, g, b] = rgb(hex);
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    return toHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
  }
  function mix(a, b, t) {
    const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
    return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
  }
  function alpha(hex, a) {
    const [r, g, b] = rgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ---------- Shapes ----------

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Soft ground shadow: an ellipse that fades out at the edges.
  function shadow(ctx, x, y, rx, ry, a = 0.28) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // A box seen from above with a slight tilt: the darker side face shows below the lighter top.
  // (x, y) is the top-left of the footprint; h is how tall it stands, in pixels on screen.
  function box(ctx, x, y, w, d, h, color, r = 4) {
    ctx.fillStyle = shade(color, -0.35);
    roundRect(ctx, x, y - h + d * 0.1, w, d + h * 0.9, r);
    ctx.fill();
    const g = ctx.createLinearGradient(0, y - h, 0, y - h + d);
    g.addColorStop(0, shade(color, 0.12));
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    roundRect(ctx, x, y - h, w, d, r);
    ctx.fill();
  }

  // Draws a rotated shape as a solid standing h pixels tall: the side colour is stamped from the
  // ground up, then the top face sits h pixels higher on screen. path(ctx) traces the footprint
  // around (0, 0) in the object's own frame. "Up" is always straight up the screen, which is
  // what sells the depth when a vehicle turns.
  function extrude(ctx, x, y, angle, h, side, top, path) {
    ctx.fillStyle = side;
    for (let i = 0; i < h; i += 1) {
      ctx.save();
      ctx.translate(x, y - i);
      ctx.rotate(angle);
      path(ctx);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(x, y - h);
    ctx.rotate(angle);
    ctx.fillStyle = top;
    path(ctx);
    ctx.fill();
    ctx.restore();
  }

  // Text with a dark outline so it reads on any background.
  function text(ctx, str, x, y, { size = 16, color = '#fff', stroke = 'rgba(0,0,0,0.55)', width = 4, align = 'center', baseline = 'middle', weight = 800 } = {}) {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (stroke && width) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = width;
      ctx.strokeStyle = stroke;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  // A rounded panel with a soft drop shadow and a light top edge, for in-canvas HUD cards.
  function card(ctx, x, y, w, h, { fill = 'rgba(20,28,40,0.78)', r = 10, edge = 'rgba(255,255,255,0.12)' } = {}) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = fill;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.stroke();
  }

  // A progress bar with a glossy fill.
  function bar(ctx, x, y, w, h, t, color, back = 'rgba(0,0,0,0.35)') {
    t = Math.max(0, Math.min(1, t));
    ctx.fillStyle = back;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    if (t <= 0) return;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(color, 0.3));
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    roundRect(ctx, x, y, Math.max(h, w * t), h, h / 2);
    ctx.fill();
  }

  // ---------- Easing ----------

  const ease = {
    linear: t => t,
    inQuad: t => t * t,
    outQuad: t => 1 - (1 - t) * (1 - t),
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outElastic: t => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  // Frame-rate independent smoothing toward a target (rate ~ how many "halves" per second).
  const approach = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);

  // ---------- Particles ----------

  // shape: 'circle' | 'square' | 'chip' (thin spinning rectangle) | 'spark' (line along velocity)
  function particles(max = 600) {
    const list = [];
    return {
      list,
      emit(p) {
        if (list.length >= max) list.shift();
        list.push({
          x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, life: 0.6, t: 0,
          size: 3, grow: 0, color: '#fff', shape: 'circle', rot: fxRand() * 6.28, spin: 0, fade: true, ...p,
        });
      },
      burst(n, f) { for (let i = 0; i < n; i++) this.emit(f(i)); },
      update(dt) {
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          p.t += dt;
          if (p.t >= p.life) { list.splice(i, 1); continue; }
          const k = Math.exp(-p.drag * dt);
          p.vx *= k; p.vy *= k;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.g) {
            p.vz -= p.g * dt;
            p.z += p.vz * dt;
            if (p.z < 0) { p.z = 0; p.vz *= -0.35; p.vx *= 0.6; p.vy *= 0.6; }
          }
          p.rot += p.spin * dt;
          p.size = Math.max(0, p.size + p.grow * dt);
        }
      },
      draw(ctx) {
        for (const p of list) {
          const a = p.fade ? 1 - p.t / p.life : 1;
          ctx.globalAlpha = Math.max(0, Math.min(1, a));
          ctx.fillStyle = p.color;
          const x = p.x, y = p.y - p.z;
          if (p.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(x, y, p.size, 0, Math.PI * 2);
            ctx.fill();
          } else if (p.shape === 'spark') {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.size;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - p.vx * 0.03, y - p.vy * 0.03);
            ctx.stroke();
          } else {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(p.rot);
            const w = p.shape === 'chip' ? p.size * 1.8 : p.size, h = p.shape === 'chip' ? p.size * 0.7 : p.size;
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.restore();
          }
        }
        ctx.globalAlpha = 1;
      },
      clear() { list.length = 0; },
    };
  }

  // ---------- Floating text ("+$12") ----------

  function floaters() {
    const list = [];
    return {
      list,
      add(str, x, y, { color = '#ffe066', size = 18, life = 0.9, rise = 46, delay = 0 } = {}) {
        list.push({ str, x, y, color, size, life, rise, t: -delay });
      },
      update(dt) {
        for (let i = list.length - 1; i >= 0; i--) {
          list[i].t += dt;
          if (list[i].t >= list[i].life) list.splice(i, 1);
        }
      },
      draw(ctx) {
        for (const f of list) {
          if (f.t < 0) continue;
          const k = f.t / f.life;
          const pop = k < 0.15 ? ease.outBack(k / 0.15) : 1;
          ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
          text(ctx, f.str, f.x, f.y - ease.outCubic(k) * f.rise, { size: f.size * (0.6 + 0.4 * pop), color: f.color });
        }
        ctx.globalAlpha = 1;
      },
    };
  }

  // ---------- Screen shake ----------

  function shaker() {
    let trauma = 0;
    return {
      add(a) { trauma = Math.min(1, trauma + a); },
      update(dt) { trauma = Math.max(0, trauma - dt * 1.8); },
      // Offset to translate the world by this frame.
      offset(max = 10) {
        const s = trauma * trauma * max;
        return { x: (fxRand() * 2 - 1) * s, y: (fxRand() * 2 - 1) * s };
      },
    };
  }

  // ---------- Sprites ----------

  // Pre-renders a drawing into an offscreen canvas once, so busy scenes can blit it cheaply.
  // draw(ctx) paints inside a w x h box whose anchor (ax, ay) is where the sprite is placed.
  function sprite(w, h, ax, ay, draw) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(x);
    return {
      canvas: c, w, h, ax, ay,
      draw(ctx, px, py, scale = 1, rot = 0) {
        if (rot === 0 && scale === 1) { ctx.drawImage(c, px - ax, py - ay, w, h); return; }
        ctx.save();
        ctx.translate(px, py);
        if (rot) ctx.rotate(rot);
        if (scale !== 1) ctx.scale(scale, scale);
        ctx.drawImage(c, -ax, -ay, w, h);
        ctx.restore();
      },
    };
  }

  // Seeded random numbers, for layouts that should look the same every visit.
  function rng(seed = 1) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  return { rand, rgb, shade, mix, alpha, roundRect, shadow, box, extrude, text, card, bar, ease, lerp, approach, particles, floaters, shaker, sprite, rng };
})();
