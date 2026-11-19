/* Small WebGL 1 toolkit for the arcade's first-person 3D games (Block Frontier, Zap Arena).
   No libraries: 4x4 matrices, one shader that does vertex colours, an optional texture atlas,
   fog, sun and night lighting, meshes made from plain float arrays, mouse look with pointer
   lock, and a 2D HUD canvas laid over the 3D one.

   Vertex layout (8 floats): x y z  r g b  u v. Colour carries the baked lighting (ambient
   occlusion, face shading). A vertex with u < 0 is drawn untextured. Set the colour's red above
   2 (r = 2 + real red) to mark it as glowing: it ignores the day/night light. */
const GL3D = (() => {
  // ---------- Matrices (column-major Float32Array(16)) ----------

  const mat4 = {
    create: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    perspective(out, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      out.fill(0);
      out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
      return out;
    },
    // A first-person camera: eye position plus yaw (turning left/right) and pitch (up/down).
    // Yaw 0 looks down -z; positive yaw turns right.
    fps(out, x, y, z, yaw, pitch) {
      const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      // Rows of the rotation: right, up, back.
      const rx = cy, ry = 0, rz = sy;
      const ux = -sy * sp, uy = cp, uz = cy * sp;
      const bx = -sy * cp, by = -sp, bz = cy * cp;
      out[0] = rx; out[4] = ry; out[8] = rz;
      out[1] = ux; out[5] = uy; out[9] = uz;
      out[2] = bx; out[6] = by; out[10] = bz;
      out[3] = out[7] = out[11] = 0;
      out[12] = -(rx * x + ry * y + rz * z);
      out[13] = -(ux * x + uy * y + uz * z);
      out[14] = -(bx * x + by * y + bz * z);
      out[15] = 1;
      return out;
    },
    // Model matrix: translate, then rotate about y, then scale.
    trs(out, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
      const c = Math.cos(ry), s = Math.sin(ry);
      out[0] = c * sx; out[1] = 0; out[2] = -s * sx; out[3] = 0;
      out[4] = 0; out[5] = sy; out[6] = 0; out[7] = 0;
      out[8] = s * sz; out[9] = 0; out[10] = c * sz; out[11] = 0;
      out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
      return out;
    },
    mul(out, a, b) {
      const r = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += a[k * 4 + j] * b[i * 4 + k];
        r[i * 4 + j] = v;
      }
      out.set(r);
      return out;
    },
  };

  // Unit vector the camera looks along for a yaw and pitch (matches mat4.fps).
  const lookDir = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

  // ---------- Shader ----------

  const VS = `
    attribute vec3 a_pos; attribute vec3 a_col; attribute vec2 a_uv;
    uniform mat4 u_proj, u_view, u_model;
    varying vec3 v_col; varying vec2 v_uv; varying float v_dist; varying float v_glow;
    void main() {
      vec4 wp = u_model * vec4(a_pos, 1.0);
      vec4 vp = u_view * wp;
      gl_Position = u_proj * vp;
      v_glow = a_col.r > 1.5 ? 1.0 : 0.0;
      v_col = vec3(a_col.r - v_glow * 2.0, a_col.gb);
      v_uv = a_uv;
      v_dist = length(vp.xyz);
    }`;
  const FS = `
    precision mediump float;
    uniform sampler2D u_tex; uniform vec3 u_fog; uniform vec2 u_fogRange; uniform float u_light; uniform vec4 u_tint; uniform float u_alpha;
    varying vec3 v_col; varying vec2 v_uv; varying float v_dist; varying float v_glow;
    void main() {
      vec4 base = v_uv.x < 0.0 ? vec4(1.0) : texture2D(u_tex, v_uv);
      if (base.a < 0.5) discard;
      float light = mix(u_light, 1.0, v_glow);
      vec3 c = base.rgb * v_col * light;
      c = mix(c, u_tint.rgb, u_tint.a);
      float f = clamp((v_dist - u_fogRange.x) / (u_fogRange.y - u_fogRange.x), 0.0, 1.0);
      gl_FragColor = vec4(mix(c, u_fog, f), u_alpha);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  // ---------- Setup ----------

  // Fits the 3D canvas (and a HUD canvas on top of it) into the stage at a fixed aspect ratio.
  // The 3D canvas renders at up to `maxScale` device pixels per CSS pixel, to stay fast on
  // school laptops.
  function setup(glCanvas, hudCanvas, w, h, { maxScale = 1.25 } = {}) {
    const gl = glCanvas.getContext('webgl', { antialias: true, alpha: false }) || glCanvas.getContext('experimental-webgl');
    if (!gl) return null;
    const hud = hudCanvas.getContext('2d');
    const wrap = glCanvas.parentElement, stage = wrap.parentElement;
    const state = { gl, hud, w, h, scale: 1 };
    const fit = () => {
      const r = stage.getBoundingClientRect();
      const s = Math.min((r.width - 16) / w, (r.height - 16) / h);
      const cw = Math.max(64, Math.floor(w * s)), ch = Math.max(36, Math.floor(h * s));
      wrap.style.width = cw + 'px';
      wrap.style.height = ch + 'px';
      for (const c of [glCanvas, hudCanvas]) { c.style.width = cw + 'px'; c.style.height = ch + 'px'; }
      const dpr = Math.min(window.devicePixelRatio || 1, maxScale);
      glCanvas.width = Math.round(cw * dpr);
      glCanvas.height = Math.round(ch * dpr);
      const hd = Math.min(window.devicePixelRatio || 1, 2);
      hudCanvas.width = Math.round(cw * hd);
      hudCanvas.height = Math.round(ch * hd);
      hud.setTransform(hudCanvas.width / w, 0, 0, hudCanvas.height / h, 0, 0);
    };
    new ResizeObserver(fit).observe(stage);
    fit();

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const loc = n => gl.getUniformLocation(prog, n);
    state.u = { proj: loc('u_proj'), view: loc('u_view'), model: loc('u_model'), tex: loc('u_tex'), fog: loc('u_fog'), fogRange: loc('u_fogRange'), light: loc('u_light'), tint: loc('u_tint'), alpha: loc('u_alpha') };
    state.a = { pos: gl.getAttribLocation(prog, 'a_pos'), col: gl.getAttribLocation(prog, 'a_col'), uv: gl.getAttribLocation(prog, 'a_uv') };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.uniform4f(state.u.tint, 0, 0, 0, 0);
    gl.uniform1f(state.u.light, 1);
    gl.uniform1f(state.u.alpha, 1);
    gl.uniform1i(state.u.tex, 0);
    // A 1x1 white texture so untextured draws are safe.
    const white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    state.identity = mat4.create();
    state.proj = mat4.create();
    state.view = mat4.create();

    // Starts a frame: clears to the fog colour and sets the camera.
    state.begin = (fov, near, far, fog, fogStart, fogEnd, light = 1) => {
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(fog[0], fog[1], fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      mat4.perspective(state.proj, fov, w / h, near, far);
      gl.uniformMatrix4fv(state.u.proj, false, state.proj);
      gl.uniform3f(state.u.fog, fog[0], fog[1], fog[2]);
      gl.uniform2f(state.u.fogRange, fogStart, fogEnd);
      gl.uniform1f(state.u.light, light);
    };
    state.camera = (x, y, z, yaw, pitch) => {
      mat4.fps(state.view, x, y, z, yaw, pitch);
      gl.uniformMatrix4fv(state.u.view, false, state.view);
    };
    // Draws a mesh (from state.mesh) with an optional model matrix.
    state.draw = (mesh, model = state.identity, mode = gl.TRIANGLES) => {
      if (!mesh || !mesh.count) return;
      gl.uniformMatrix4fv(state.u.model, false, model);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
      gl.enableVertexAttribArray(state.a.pos);
      gl.vertexAttribPointer(state.a.pos, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(state.a.col);
      gl.vertexAttribPointer(state.a.col, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(state.a.uv);
      gl.vertexAttribPointer(state.a.uv, 2, gl.FLOAT, false, 32, 24);
      gl.drawArrays(mode, 0, mesh.count);
    };
    // Uploads (or replaces) a mesh's vertices. Pass the old mesh to reuse its buffer.
    state.mesh = (data, old) => {
      const m = old || { buf: gl.createBuffer(), count: 0 };
      gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
      gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.STATIC_DRAW);
      m.count = data.length / 8;
      return m;
    };
    state.freeMesh = m => { if (m) gl.deleteBuffer(m.buf); };
    // A texture from a canvas, with crisp (nearest) pixels.
    state.texture = canvas => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    state.bindTexture = t => gl.bindTexture(gl.TEXTURE_2D, t || white);
    state.tint = (r, g, b, a) => gl.uniform4f(state.u.tint, r, g, b, a);
    state.alpha = a => gl.uniform1f(state.u.alpha, a);
    return state;
  }

  // ---------- Geometry helpers ----------

  // Appends an axis-aligned box (x0..x1, y0..y1, z0..z1) with simple face shading.
  // color: [r, g, b]. Faces get brighter on top and darker on the sides and bottom.
  const SHADE = { top: 1, bottom: 0.55, x: 0.8, z: 0.68 };
  function box(out, x0, y0, z0, x1, y1, z1, color, { glow = false, shade = SHADE, skip = '' } = {}) {
    const [r, g, b] = color;
    const quad = (pts, k) => {
      const cr = r * k + (glow ? 2 : 0), cg = g * k, cb = b * k;
      for (const i of [0, 1, 2, 0, 2, 3]) out.push(pts[i][0], pts[i][1], pts[i][2], cr, cg, cb, -1, -1);
    };
    if (!skip.includes('t')) quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], shade.top);
    if (!skip.includes('b')) quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], shade.bottom);
    if (!skip.includes('e')) quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], shade.x);
    if (!skip.includes('w')) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], shade.x * 0.92);
    if (!skip.includes('s')) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], shade.z);
    if (!skip.includes('n')) quad([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], shade.z * 0.9);
    return out;
  }
  const hex = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  // ---------- Mouse look ----------

  // Pointer lock on click; onMove(dx, dy) gets raw mouse movement while locked.
  function mouseLook(canvas, onMove, onLockChange) {
    canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) { const p = canvas.requestPointerLock?.(); p?.catch?.(() => {}); } });
    document.addEventListener('pointerlockchange', () => onLockChange?.(document.pointerLockElement === canvas));
    document.addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) onMove(e.movementX || 0, e.movementY || 0); });
    return {
      locked: () => document.pointerLockElement === canvas,
      lock: () => { const p = canvas.requestPointerLock?.(); p?.catch?.(() => {}); },
      unlock: () => { if (document.pointerLockElement === canvas) document.exitPointerLock(); },
    };
  }

  return { mat4, lookDir, setup, box, hex, mouseLook };
})();
