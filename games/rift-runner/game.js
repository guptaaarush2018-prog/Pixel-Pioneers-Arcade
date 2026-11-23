/* Rift Runner: a 3D tunnel runner. You run along a square tunnel of floating tiles, jump the gaps and
   keep running around the corners, up the walls and across the ceiling. 36 campaign levels in six
   worlds, an endless mode, a daily run and six runners to unlock. Rendered with Three.js. */
(() => {
  const { RING, T, WORLDS, RUNNERS } = RR;
  const ID = 'rift-runner';
  const $ = id => document.getElementById(id);
  const PI = Math.PI, TAU = PI * 2;

  // ---------- Save ----------
  const defaultSave = () => ({ levels: {}, shards: 0, owned: ['pip'], runner: 'pip', endlessBest: 0, endlessDist: 0, seen: false });
  let save = { ...defaultSave(), ...Arcade.load('rift:save', {}) };
  const persist = () => Arcade.save('rift:save', save);
  const campaignTotal = () => Object.values(save.levels).reduce((a, l) => a + (l.score || 0), 0);
  const leaderboardScore = () => campaignTotal() + save.endlessBest;
  const levelKey = (w, l) => RR.levelName(w, l);
  const isUnlocked = (w, l) => {
    const idx = w * 6 + l;
    if (idx === 0) return true;
    const pw = Math.floor((idx - 1) / 6), pl = (idx - 1) % 6;
    return (save.levels[levelKey(pw, pl)]?.stars || 0) >= 1;
  };
  const starsOf = (w, l) => save.levels[levelKey(w, l)]?.stars || 0;
  const runnerDef = () => RUNNERS.find(r => r.id === save.runner) || RUNNERS[0];

  // ---------- Renderer ----------
  const view = $('view'), stage = $('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  view.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 400);
  scene.fog = new THREE.Fog(0x0a1236, 22, 84);
  function resize() {
    const w = Math.max(200, view.clientWidth), h = Math.max(200, view.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(view);
  resize();

  // Theme colours ease from world to world.
  const theme = {
    sky0: new THREE.Color(WORLDS[0].sky[0]), sky1: new THREE.Color(WORLDS[0].sky[1]), fog: new THREE.Color(WORLDS[0].fog),
    tileA: new THREE.Color(WORLDS[0].tileA), tileB: new THREE.Color(WORLDS[0].tileB), glow: new THREE.Color(WORLDS[0].glow), star: new THREE.Color(WORLDS[0].star),
  };
  const themeGoal = {};
  const tmpC = new THREE.Color();
  function setThemeTarget(w, snap) {
    const W = WORLDS[w];
    themeGoal.sky0 = tmpC.set(W.sky[0]).clone(); themeGoal.sky1 = new THREE.Color(W.sky[1]); themeGoal.fog = new THREE.Color(W.fog);
    themeGoal.tileA = new THREE.Color(W.tileA); themeGoal.tileB = new THREE.Color(W.tileB); themeGoal.glow = new THREE.Color(W.glow); themeGoal.star = new THREE.Color(W.star);
    if (snap) for (const k in themeGoal) theme[k].copy(themeGoal[k]);
  }
  function easeTheme(dt) {
    const k = 1 - Math.exp(-dt * 1.6);
    for (const k2 in themeGoal) theme[k2].lerp(themeGoal[k2], k);
  }

  // Sky dome: a gradient that follows the camera.
  const sky = (() => {
    const g = new THREE.SphereGeometry(300, 16, 12);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -10;
    scene.add(m);
    return m;
  })();
  function paintSky() {
    const pos = sky.geometry.attributes.position, col = sky.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / 300 * 0.5 + 0.5, 0, 1);
      col.setXYZ(i, theme.sky0.r + (theme.sky1.r - theme.sky0.r) * (1 - t), theme.sky0.g + (theme.sky1.g - theme.sky0.g) * (1 - t), theme.sky0.b + (theme.sky1.b - theme.sky0.b) * (1 - t));
    }
    col.needsUpdate = true;
  }

  // Lights for the runner (tiles are unlit and carry their own shading).
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 6);
  scene.add(sun);

  // ---------- Textures ----------
  function canvasTex(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const tileTex = canvasTex(128, (g, s) => {
    g.fillStyle = '#9aa3b8'; g.fillRect(0, 0, s, s);
    const grd = g.createLinearGradient(0, 0, s, s);
    grd.addColorStop(0, '#f4f7ff'); grd.addColorStop(1, '#c7d0e4');
    g.fillStyle = grd;
    g.beginPath(); g.roundRect(7, 7, s - 14, s - 14, 14); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.beginPath(); g.roundRect(7, 7, s - 14, s - 14, 14); g.stroke();
    g.fillStyle = 'rgba(40,50,90,.18)';
    g.beginPath(); g.roundRect(30, 30, s - 60, s - 60, 8); g.fill();
    g.fillStyle = 'rgba(255,255,255,.6)';
    for (const [x, y] of [[20, 20], [s - 20, 20], [20, s - 20], [s - 20, s - 20]]) { g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill(); }
  });
  const hazardTex = canvasTex(64, (g, s) => {
    g.fillStyle = '#16181f'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffc53d';
    for (let i = -s; i < s * 2; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 11, 0); g.lineTo(i + 11 - s, s); g.lineTo(i - s, s); g.fill(); }
  });
  const dotTex = canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });

  // ---------- Tunnel geometry ----------
  const HALF = 2.5;
  const facePos = (u, out) => {
    const f = Math.floor(u / 5) & 3, t = u - Math.floor(u / 5) * 5;
    if (f === 0) { out.x = -HALF + t; out.y = -HALF; }
    else if (f === 1) { out.x = HALF; out.y = -HALF + t; }
    else if (f === 2) { out.x = HALF - t; out.y = HALF; }
    else { out.x = -HALF; out.y = HALF - t; }
    out.f = f;
    out.nx = -Math.sin(f * PI / 2); out.ny = Math.cos(f * PI / 2);
    return out;
  };
  const P = { x: 0, y: 0, f: 0, nx: 0, ny: 1 };

  // One template matrix per ring cell; rows only change the z translation.
  const tpl = [];
  for (let c = 0; c < RING; c++) {
    const p = facePos((Math.floor(c / 5) * 5) + (c % 5) + 0.5, {});
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.f * PI / 2), new THREE.Vector3(1, 1, 1));
    tpl.push({ e: Float32Array.from(m.elements), nx: p.nx, ny: p.ny });
  }

  const WINDOW_BACK = 8, WINDOW_AHEAD = 66;
  const CAP = (WINDOW_BACK + WINDOW_AHEAD + 2) * RING;

  const tileGeo = new THREE.BoxGeometry(0.94, 0.3, 0.94);
  tileGeo.translate(0, -0.15, 0);
  {
    // Bake face shading into vertex colours: bright top, darker sides.
    const shade = [0.62, 0.62, 1, 0.4, 0.55, 0.8]; // +x -x +y -y +z -z
    const colors = new Float32Array(24 * 3);
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) colors.fill(shade[f], (f * 4 + v) * 3, (f * 4 + v) * 3 + 3);
    tileGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  function instanced(geo, mat, cap) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    return m;
  }
  const tiles = instanced(tileGeo, new THREE.MeshBasicMaterial({ map: tileTex, vertexColors: true }), CAP);

  const barrierGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9); barrierGeo.translate(0, 0.45, 0);
  const barriers = instanced(barrierGeo, new THREE.MeshBasicMaterial({ map: hazardTex }), 400);
  const spikeGeo = new THREE.ConeGeometry(0.4, 0.95, 6); spikeGeo.translate(0, 0.475, 0);
  const spikes = instanced(spikeGeo, new THREE.MeshLambertMaterial({ color: 0xff4a5e, emissive: 0x551018 }), 400);

  const shardGeo = new THREE.OctahedronGeometry(0.3, 0); shardGeo.scale(0.8, 1.25, 0.8);
  const shards = instanced(shardGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 260);

  // Glowing ribs along the tunnel so the shape shows even where the tiles are missing.
  const RIBS = 16, RIB_GAP = 6;
  const ribGeo = (() => {
    const parts = [];
    const H = 2.95, t = 0.07;
    const add = (w, h, x, y) => { const g = new THREE.BoxGeometry(w, h, t); g.translate(x, y, 0); parts.push(g); };
    add(H * 2, t, 0, H); add(H * 2, t, 0, -H); add(t, H * 2, H, 0); add(t, H * 2, -H, 0);
    const merged = new THREE.BufferGeometry();
    const pos = [];
    for (const g of parts) { const ng = g.toNonIndexed(); pos.push(...ng.attributes.position.array); }
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return merged;
  })();
  const ribMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const ribs = new THREE.InstancedMesh(ribGeo, ribMat, RIBS);
  ribs.frustumCulled = false;
  scene.add(ribs);

  // Stars drifting past.
  const STARS = 420;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(STARS * 3);
  const starRand = RR.rng(42);
  for (let i = 0; i < STARS; i++) {
    const a = starRand() * TAU, r = 5 + starRand() * 50;
    starPos[i * 3] = Math.cos(a) * r; starPos[i * 3 + 1] = Math.sin(a) * r; starPos[i * 3 + 2] = -starRand() * 110;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ size: 0.5, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: 0xffffff });
  const starPts = new THREE.Points(starGeo, starMat);
  starPts.frustumCulled = false;
  scene.add(starPts);

  // Particles.
  const MAXP = 500;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.45, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false;
  scene.add(pts);
  const parts = Array.from({ length: MAXP }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 }));
  let pIdx = 0;
  function burst(x, y, z, color, n, speed = 4, spread = 1, life = 0.7) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const p = parts[pIdx++ % MAXP];
      const a = Math.random() * TAU, b = Math.random() * PI;
      const s = speed * (0.3 + Math.random() * 0.7);
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.cos(a) * Math.sin(b) * s * spread; p.vy = Math.sin(a) * Math.sin(b) * s * spread; p.vz = Math.cos(b) * s * spread;
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.r = c.r; p.g = c.g; p.b = c.b;
    }
  }
  function updateParticles(dt) {
    for (let i = 0; i < MAXP; i++) {
      const p = parts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vx *= 0.97; p.vy *= 0.97; p.vz *= 0.97;
        const k = Math.max(0, p.life / p.max);
        pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
        pCol[i * 3] = p.r * k; pCol[i * 3 + 1] = p.g * k; pCol[i * 3 + 2] = p.b * k;
      } else {
        pPos[i * 3 + 1] = -9999; pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0;
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // ---------- The runner's body ----------
  const runnerGroup = new THREE.Group();
  scene.add(runnerGroup);
  const body = new THREE.Group();
  runnerGroup.add(body);
  let legL, legR, bodyMesh, visor, accessory;
  function buildRunner(def) {
    body.clear();
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    const trim = new THREE.MeshLambertMaterial({ color: def.trim });
    bodyMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.36, 4, 10), mat);
    bodyMesh.position.y = 0.62;
    body.add(bodyMesh);
    visor = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(def.trim).lerp(new THREE.Color('#9ff'), 0.15) }));
    visor.scale.set(1.1, 0.75, 0.6);
    visor.position.set(0, 0.78, -0.17);
    body.add(visor);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.position.set(0, 0.8, -0.3);
    body.add(eye);
    const legGeo = new THREE.BoxGeometry(0.14, 0.3, 0.16); legGeo.translate(0, -0.15, 0);
    legL = new THREE.Mesh(legGeo, trim); legR = new THREE.Mesh(legGeo, trim);
    legL.position.set(-0.11, 0.36, 0); legR.position.set(0.11, 0.36, 0);
    body.add(legL, legR);
    accessory = new THREE.Group();
    body.add(accessory);
    if (def.id === 'pip') {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3), trim); a.position.set(0, 1.12, 0.02);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0xff5d73 })); b.position.set(0, 1.3, 0.02);
      accessory.add(a, b);
    } else if (def.id === 'zephyr') {
      for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 5), trim); f.rotation.z = s * 0.5; f.rotation.x = 1.3; f.position.set(s * 0.2, 0.85, 0.2); accessory.add(f); }
    } else if (def.id === 'bolt') {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff })); s.position.y = 0.55; accessory.add(s);
    } else if (def.id === 'spring') {
      for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 6, 12), trim); r.rotation.x = PI / 2; r.position.set(0, 1.0 + i * 0.07, 0); accessory.add(r); }
    } else if (def.id === 'drift') {
      for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.22), new THREE.MeshBasicMaterial({ color: 0xe5d1ff })); w.position.set(s * 0.36, 0.7, 0.18); w.rotation.z = s * -0.3; accessory.add(w); }
    } else if (def.id === 'echo') {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 20), new THREE.MeshBasicMaterial({ color: 0x9fe8ff })); h.rotation.x = PI / 2; h.position.y = 1.18; accessory.add(h);
    }
  }

  // ---------- State ----------
  let state = 'menu';       // menu | ready | playing | dead | paused | done
  let mode = 'menu';        // menu | campaign | endless | daily
  let cfg = null, level = null, curW = 0, curL = 0;
  let row = 0, u = 10.5, h = 0, vy = 0, lv = 0, grounded = true, coyote = 0, airJumps = 0;
  let boostT = 0, onIce = false, shake = 0, deaths = 0, collected = 0, cpRow = 0, shieldLeft = 0;
  let stateT = 0, safeRow = 0, safeU = 10.5, invuln = 0, combo = 0, comboT = 0, runShards = 0;
  let lastLandT = 0, trailT = 0, squash = 0, camAng = PI / 2;
  const crumble = new Map();
  const taken = new Set();
  let jumpBuf = 0;
  const keys = { left: false, right: false, jump: false };
  let jumpHeld = false;
  let totalLevelShards = 0;

  const tileAt = (r, c) => {
    const rw = level.rows[r];
    if (!rw) return 0;
    const t = rw[c];
    if (t === T.CRUMBLE) { const s = crumble.get(r * RING + c); if (s && s.t > 0.42) return 0; }
    return t;
  };

  // ---------- Sound ----------
  const tone = o => Arcade.tone(o);
  let musicT = 0, step = 0;
  function music(dt) {
    const w = WORLDS[curWorldForTheme()];
    const dur = 60 / w.bpm / 2;
    musicT += dt;
    while (musicT >= dur) {
      musicT -= dur;
      step = (step + 1) % 32;
      const root = w.root;
      const sc = w.scale;
      if (step % 4 === 0) tone({ freq: root * (step % 16 === 8 ? 1.5 : 1) / 2, dur: dur * 1.6, type: 'triangle', vol: 0.035 });
      if (step % 2 === 0 || step % 8 === 7) {
        const n = sc[(step * 3 + (step >> 3)) % sc.length];
        tone({ freq: root * 2 ** ((n + (step % 16 >= 8 ? 7 : 0)) / 12), dur: dur * 0.9, type: 'square', vol: 0.012 });
      }
      if (step % 8 === 4) tone({ freq: 220, to: 60, dur: 0.07, type: 'sine', vol: 0.03 });
    }
  }
  const curWorldForTheme = () => (mode === 'endless' || mode === 'daily' ? RR.endlessWorldAt(Math.floor(row)) : curW);

  // ---------- Starting levels ----------
  function resetRun() {
    crumble.clear(); taken.clear();
    row = 0; u = 10.5; h = 0; vy = 0; lv = 0; grounded = true; coyote = 0; boostT = 0; onIce = false;
    deaths = 0; collected = 0; cpRow = 0; runShards = 0; combo = 0; invuln = 0; shake = 0; squash = 0;
    airJumps = runnerDef().air; shieldLeft = runnerDef().shield;
    safeRow = 0; safeU = 10.5;
    musicT = 0; step = 0;
  }
  function startCampaign(w, l) {
    mode = 'campaign'; curW = w; curL = l;
    cfg = RR.campaignLevel(w, l);
    level = cfg.level;
    totalLevelShards = level.totalShards();
    resetRun();
    u = level.lane[2] + 0.5; row = 1;
    setThemeTarget(w, true);
    buildRunner(runnerDef());
    ui.hide();
    $('rr-bar').hidden = false;
    buildCpMarks();
    state = 'ready'; stateT = 0;
    banner(`${cfg.name} · ${WORLDS[w].name}`, w * 6 + l === 0 ? 'Run, jump, reach the end' : `${cfg.length} m`, 1900);
    $('s-level').textContent = cfg.name;
  }
  function startEndless(daily) {
    mode = daily ? 'daily' : 'endless';
    const seed = daily ? dailySeed() : (Math.random() * 1e9) | 0;
    cfg = RR.endlessLevel(seed);
    level = cfg.level;
    totalLevelShards = 0;
    resetRun();
    u = level.lane[2] + 0.5; row = 1;
    curW = 0;
    setThemeTarget(0, true);
    buildRunner(runnerDef());
    ui.hide();
    $('rr-bar').hidden = true;
    state = 'ready'; stateT = 0;
    banner(daily ? 'Daily Run' : 'Endless', daily ? 'Same tunnel for everyone today' : 'How far can you get?', 1900);
    $('s-level').textContent = daily ? 'Daily' : 'Endless';
  }
  function dailySeed() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function buildCpMarks() {
    const bar = $('rr-bar');
    bar.querySelectorAll('span').forEach(s => s.remove());
    for (const f of [0.25, 0.5, 0.75]) {
      const s = document.createElement('span');
      s.style.left = f * 100 + '%';
      s.dataset.f = f;
      bar.appendChild(s);
    }
  }

  let bannerTimer = 0;
  function banner(title, sub, ms) {
    const el = $('rr-banner');
    el.querySelector('b').textContent = title;
    el.querySelector('small').textContent = sub || '';
    el.classList.add('on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('on'), ms);
  }

  // ---------- Death, checkpoints, finishing ----------
  function die(why) {
    if (state !== 'playing' || invuln > 0) return;
    // Echo's shield: a fall puts you back on the last solid ground.
    if (why === 'fell' && shieldLeft > 0) {
      shieldLeft--;
      row = Math.max(1, safeRow - 2); u = safeU; h = 0.4; vy = 0; lv = 0; grounded = false; invuln = 1;
      burst(...worldPos(u, h), 0x9fe8ff, 30, 5);
      tone({ freq: 400, to: 1200, dur: 0.3, type: 'triangle', vol: 0.06 });
      banner('Saved!', 'Echo’s shield is spent', 1100);
      return;
    }
    state = 'dead'; stateT = 0;
    deaths++;
    shake = 1;
    const p = worldPos(u, Math.max(h, 0.3));
    burst(p[0], p[1], p[2], runnerDef().color, 70, 7, 1, 1);
    burst(p[0], p[1], p[2], 0xffffff, 25, 5, 1, 0.5);
    tone({ freq: 300, to: 40, dur: 0.6, type: 'sawtooth', vol: 0.08 });
    runnerGroup.visible = false;
  }
  function respawn() {
    runnerGroup.visible = true;
    crumble.clear();
    row = cpRow > 0 ? cpRow : 1;
    u = level.lane[Math.floor(row)] + 0.5;
    h = 0; vy = 0; lv = 0; grounded = true; boostT = 0; onIce = false; invuln = 1.2;
    safeRow = row; safeU = u;
    airJumps = runnerDef().air;
    state = 'playing';
    banner(cpRow > 0 ? 'Checkpoint' : 'Again!', `Attempt ${deaths + 1}`, 900);
  }
  function checkpoints() {
    if (mode !== 'campaign') return;
    const cps = level.cps;
    for (let i = 0; i < cps.length; i++) {
      if (row >= cps[i] + 2 && cpRow < cps[i] + 2) {
        cpRow = cps[i] + 2;
        const mark = $('rr-bar').querySelector(`span[data-f="${[0.25, 0.5, 0.75][i]}"]`);
        mark?.classList.add('hit');
        banner('Checkpoint', '', 900);
        tone({ freq: 523, to: 784, dur: 0.18, type: 'triangle', vol: 0.06 });
        tone({ freq: 784, to: 1046, dur: 0.25, type: 'triangle', vol: 0.05, delay: 0.12 });
      }
    }
  }

  function levelComplete() {
    state = 'done';
    const frac = totalLevelShards ? collected / totalLevelShards : 1;
    const stars = 1 + (frac >= 0.65 ? 1 : 0) + (frac >= 0.9 ? 1 : 0);
    const score = cfg.length * 10 + collected * 100 + stars * 1000;
    const key = cfg.name;
    const prev = save.levels[key] || { stars: 0, score: 0 };
    save.levels[key] = { stars: Math.max(prev.stars, stars), score: Math.max(prev.score, score), deaths: Math.min(prev.deaths ?? 99, deaths) };
    persist();
    Arcade.flag('rift-runner-clear');
    if (stars === 3) Arcade.flag('rift-runner-stars');
    if (deaths === 0) Arcade.flag('rift-runner-clean');
    if (curL === 5) Arcade.flag('rift-runner-world');
    if (Object.keys(save.levels).length >= 36 && Object.values(save.levels).every(l => l.stars >= 1)) Arcade.flag('rift-runner-complete');
    if (collected >= 100) Arcade.flag('rift-runner-hoard');
    tone({ freq: 523, to: 1046, dur: 0.6, type: 'triangle', vol: 0.07 });
    tone({ freq: 659, to: 1318, dur: 0.6, type: 'triangle', vol: 0.05, delay: 0.15 });
    tone({ freq: 784, to: 1568, dur: 0.7, type: 'triangle', vol: 0.05, delay: 0.3 });
    burst(...worldPos(u, 1), 0xffffff, 80, 8, 1, 1.4);
    const idx = curW * 6 + curL;
    const hasNext = idx < 35;
    const worldDone = curL === 5 && curW < 5;
    const starStr = [1, 2, 3].map(i => `<span class="${i <= stars ? '' : 'off'}">★</span>`).join('');
    setTimeout(() => {
      Arcade.finish(ui, {
        score: leaderboardScore(),
        title: `Level ${cfg.name} clear`,
        html: `<div class="rr-stars">${starStr}</div>
          <p>${collected} of ${totalLevelShards} shards · ${deaths} ${deaths === 1 ? 'fall' : 'falls'} · level score ${score.toLocaleString()}</p>
          ${worldDone ? `<p class="new-best">${WORLDS[curW].name} complete! ${WORLDS[curW + 1].name} is open.</p>` : ''}
          ${idx === 35 ? '<p class="new-best">You finished the whole campaign. The rift is closed.</p>' : ''}
          ${stars < 3 ? `<p class="muted-note">${stars === 1 ? 'Collect 65% of the shards for a second star.' : 'Collect 90% of the shards for the third star.'}</p>` : ''}
          <div class="rr-row"><button class="btn secondary" data-act="replay" type="button">Replay</button><button class="btn secondary" data-act="campaign" type="button">Levels</button></div>`,
        button: hasNext ? 'Next level' : 'Menu',
        onAction: () => (hasNext ? startCampaign(Math.floor((idx + 1) / 6), (idx + 1) % 6) : showMenu()),
        delay: 400,
      });
    }, 1200);
  }

  function endlessOver() {
    state = 'done';
    const dist = Math.floor(row);
    const score = dist * 10 + runShards * 50;
    const prevBest = save.endlessBest;
    if (score > save.endlessBest) save.endlessBest = score;
    if (dist > save.endlessDist) save.endlessDist = dist;
    persist();
    if (dist >= 1000) Arcade.flag('rift-runner-1000');
    if (dist >= 3000) Arcade.flag('rift-runner-3000');
    if (runShards >= 100) Arcade.flag('rift-runner-hoard');
    Arcade.finish(ui, {
      score: leaderboardScore(),
      title: mode === 'daily' ? 'Daily Run over' : 'Run over',
      html: `<p>${dist.toLocaleString()} m · ${runShards} shards · run score ${score.toLocaleString()}</p>
        <p class="muted-note">${score > prevBest ? 'New Endless record!' : `Endless record ${save.endlessBest.toLocaleString()}`} · farthest ${save.endlessDist.toLocaleString()} m</p>
        <div class="rr-row"><button class="btn secondary" data-act="menu" type="button">Menu</button></div>`,
      button: 'Run again',
      onAction: () => startEndless(mode === 'daily'),
    });
  }

  // ---------- Input ----------
  const bindKey = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ArrowUp: 'jump', KeyW: 'jump',
  };
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'playing') pause(); else if (state === 'paused') resume(); return; }
    const k = bindKey[e.code];
    if (!k) return;
    if (state === 'playing' || state === 'ready') e.preventDefault();
    if (e.repeat && k === 'jump') return;
    keys[k] = true;
    if (k === 'jump') { jumpBuf = 0.13; jumpHeld = true; }
  });
  addEventListener('keyup', e => {
    const k = bindKey[e.code];
    if (!k) return;
    keys[k] = false;
    if (k === 'jump') jumpHeld = false;
  });
  const hold = (id, k) => {
    const b = $(id);
    if (!b) return;
    const on = e => { e.preventDefault(); keys[k] = true; if (k === 'jump') { jumpBuf = 0.13; jumpHeld = true; } };
    const off = e => { e.preventDefault(); keys[k] = false; if (k === 'jump') jumpHeld = false; };
    b.addEventListener('pointerdown', on);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, off);
  };
  hold('t-left', 'left'); hold('t-right', 'right'); hold('t-jump', 'jump');
  Arcade.onBlur(() => { if (state === 'playing') pause(); keys.left = keys.right = keys.jump = false; jumpHeld = false; });

  // ---------- Physics ----------
  const G = 32, JUMP = 11.6;
  const worldPos = (uu, hh) => {
    facePos(uu, P);
    return [P.x + P.nx * hh, P.y + P.ny * hh, -row];
  };

  function jumpNow(power = 1) {
    const R = runnerDef();
    vy = JUMP * R.jump * power;
    grounded = false; coyote = 0; jumpBuf = 0;
    tone({ freq: 300, to: 620, dur: 0.12, type: 'square', vol: 0.04 });
    squash = -0.25;
    const p = worldPos(u, 0.1);
    burst(p[0], p[1], p[2], theme.glow, 6, 2, 1, 0.4);
  }

  function land(t) {
    h = 0; vy = 0; grounded = true;
    airJumps = runnerDef().air;
    squash = 0.3;
    const p = worldPos(u, 0.05);
    burst(p[0], p[1], p[2], 0xffffff, 8, 2.5, 1, 0.45);
    if (performance.now() - lastLandT > 120) tone({ freq: 140, to: 80, dur: 0.06, type: 'sine', vol: 0.04 });
    lastLandT = performance.now();
  }

  function physics(dt, auto) {
    const R = runnerDef();
    const r0 = Math.floor(row);
    if (level.rows.length < r0 + WINDOW_AHEAD + 30) level.ensure(r0 + WINDOW_AHEAD + 60);
    // Speed.
    const baseSpeed = (mode === 'campaign' ? cfg.speed : mode === 'menu' ? 12 : RR.endlessSpeedAt(row)) * R.speed;
    boostT = Math.max(0, boostT - dt);
    const sp = baseSpeed * (boostT > 0 ? 1.45 : 1);
    row += sp * dt;
    // Sideways.
    let inp = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (auto) inp = 0;
    const target = inp * 8.6 * R.steer;
    if (!auto) {
      const k = grounded ? (onIce ? 1.9 : 17) : 7;
      lv += (target - lv) * (1 - Math.exp(-k * dt));
    }
    u += lv * dt;
    u = ((u % RING) + RING) % RING;
    // Jump.
    coyote = grounded ? 0.09 : coyote - dt;
    jumpBuf -= dt;
    if (jumpBuf > 0 && coyote > 0) jumpNow();
    else if (jumpBuf > 0 && !grounded && airJumps > 0) { airJumps--; jumpNow(0.9); burst(...worldPos(u, 0.2), 0x9fe8ff, 14, 3); }
    if (!jumpHeld && !auto && vy > 4 && !grounded) vy -= 70 * dt;
    // Gravity and landing.
    const cr = Math.floor(row), cc = Math.floor(u);
    const t = tileAt(cr, cc);
    if (grounded && t === T.EMPTY) grounded = false;
    if (!grounded) {
      const prevH = h;
      vy -= G * dt;
      if (R.glide && jumpHeld && vy < -2.6 && h > 0.05) vy = -2.6;
      h += vy * dt;
      if (t !== T.EMPTY && vy <= 0 && prevH >= -0.06 && h <= 0) land(t);
    }
    // Tile effects.
    onIce = false;
    if (grounded) {
      if (t === T.ICE) onIce = true;
      else if (t === T.CRUMBLE) {
        const key = cr * RING + cc;
        if (!crumble.has(key)) crumble.set(key, { t: 0 });
      } else if (t === T.BOOST) {
        if (boostT <= 0) tone({ freq: 400, to: 1000, dur: 0.25, type: 'sawtooth', vol: 0.04 });
        boostT = 1.3;
      } else if (t === T.BOUNCE) {
        vy = 17.5 * Math.max(1, R.jump * 0.95); grounded = false; h = 0.02;
        tone({ freq: 200, to: 900, dur: 0.25, type: 'sine', vol: 0.07 });
        burst(...worldPos(u, 0.1), 0xff5fd0, 18, 4);
      } else if (t === T.SPIKE) die('spike');
      if (grounded && (t === T.TILE || t === T.ICE || t === T.BOOST)) {
        if (cr - safeRow >= 1) { safeRow = cr; safeU = cc + 0.5; }
      }
    }
    // Hazards in the air or ahead.
    if (state === 'playing' && invuln <= 0) {
      if (t === T.SPIKE && h < 0.3) die('spike');
      const aheadR = Math.floor(row + 0.35);
      for (const cc2 of [Math.floor(((u - 0.26) % RING + RING) % RING), cc, Math.floor((u + 0.26) % RING)]) {
        if (tileAt(aheadR, cc2) === T.BARRIER && h < 0.88) { die('block'); break; }
        if (tileAt(cr, cc2) === T.BARRIER && h < 0.88) { die('block'); break; }
      }
      if (h < -9) die('fell');
    }
    if (invuln > 0) invuln -= dt;
    // Crumbling tiles.
    for (const s of crumble.values()) s.t += dt;
    // Shards.
    for (let rr = cr - 1; rr <= cr + 1; rr++) {
      const list = level.shardsAt.get(rr);
      if (!list) continue;
      for (const s of list) {
        if (s.got || mode === 'menu') continue;
        let du = s.c - u;
        du = ((du + 10) % RING + RING) % RING - 10;
        if (Math.abs(du) < 0.8 && Math.abs(s.r + 0.5 - row) < 0.85 && Math.abs(h - s.h) < 1.05) {
          s.got = true;
          collected++; runShards++; save.shards++;
          combo = comboT > 0 ? combo + 1 : 1; comboT = 1.2;
          tone({ freq: 700 * 2 ** (Math.min(combo, 12) / 12), to: 1400 * 2 ** (Math.min(combo, 12) / 12), dur: 0.1, type: 'triangle', vol: 0.045 });
          const p = worldPos(s.c, s.h);
          burst(p[0], p[1], -(s.r + 0.5), 0xffe14d, 10, 3);
        }
      }
    }
    comboT -= dt;
    if (comboT <= 0) combo = 0;
    // Trail.
    trailT -= dt;
    if (trailT <= 0 && grounded) {
      trailT = boostT > 0 ? 0.015 : 0.05;
      const p = worldPos(u, 0.05);
      burst(p[0], p[1], p[2] + 0.3, boostT > 0 ? 0xffe14d : theme.glow, 1, 1, 1, 0.35);
    }
    checkpoints();
    if (mode === 'campaign' && state === 'playing' && row >= level.finishRow + 5) levelComplete();
  }

  // The menu backdrop plays itself.
  let demoRow = 0;
  function autopilot(dt) {
    const r0 = Math.floor(row);
    const want = level.lane[Math.min(level.lane.length - 1, r0 + 3)] + 0.5;
    let d = want - u;
    d = ((d + 10) % RING + RING) % RING - 10;
    lv = THREE.MathUtils.clamp(d * 6, -8, 8);
    const look = (cells) => {
      for (const dr of cells) { const t = tileAt(Math.floor(row + dr), Math.floor(u)); if (t === T.EMPTY || t === T.BARRIER || t === T.SPIKE) return true; }
      return false;
    };
    if (grounded && (look([1.4, 1.8]) )) jumpBuf = 0.1, jumpHeld = true;
    else if (grounded) jumpHeld = false;
    if (!grounded && h > 1.6) jumpHeld = false;
    physics(dt, true);
  }

  // ---------- Frame ----------
  const dummy = new THREE.Object3D();
  const qSpin = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1), yAxis = new THREE.Vector3(0, 1, 0), qFace = new THREE.Quaternion();
  const basis = new THREE.Matrix4(), vR = new THREE.Vector3(), vU = new THREE.Vector3(), vB = new THREE.Vector3(0, 0, 1);
  let time = 0;

  function buildScene(dt) {
    const r0 = Math.max(0, Math.floor(row) - WINDOW_BACK), r1 = Math.floor(row) + WINDOW_AHEAD;
    let nt = 0, nb = 0, ns = 0, nsh = 0;
    const tArr = tiles.instanceMatrix.array, tCol = tiles.instanceColor.array;
    const bArr = barriers.instanceMatrix.array, sArr = spikes.instanceMatrix.array;
    const cA = theme.tileA, cB = theme.tileB;
    for (let r = r0; r <= r1; r++) {
      const rw = level.rows[r];
      if (!rw) continue;
      const z = -(r + 0.5);
      for (let c = 0; c < RING; c++) {
        const t = rw[c];
        if (t === 0) continue;
        const tp = tpl[c];
        let ox = 0, oy = 0, oz = 0;
        if (t === T.CRUMBLE) {
          const s = crumble.get(r * RING + c);
          if (s) {
            if (s.t > 0.42) { const d = (s.t - 0.42); if (d > 0.7) continue; ox = tp.nx * -d * d * 30; oy = tp.ny * -d * d * 30; }
            else { const j = Math.sin(s.t * 90) * 0.03; ox = tp.nx * j; oy = tp.ny * j; }
          }
        }
        const base = nt * 16;
        for (let i = 0; i < 16; i++) tArr[base + i] = tp.e[i];
        tArr[base + 12] += ox; tArr[base + 13] += oy; tArr[base + 14] = z + oz;
        const k = nt * 3, chk = (r + c) & 1;
        let cr, cg, cb;
        switch (t) {
          case T.CRUMBLE: cr = chk ? 0.85 : 0.7; cg = chk ? 0.58 : 0.46; cb = chk ? 0.2 : 0.15; break;
          case T.ICE: cr = chk ? 0.75 : 0.6; cg = chk ? 0.95 : 0.85; cb = 1; break;
          case T.BOOST: { const p = 0.7 + 0.3 * Math.sin(time * 9 - r * 0.9); cr = p; cg = p * 0.9; cb = 0.1; break; }
          case T.BOUNCE: cr = 1; cg = 0.35 + 0.15 * Math.sin(time * 7); cb = 0.8; break;
          case T.SPIKE: cr = 0.28; cg = 0.22; cb = 0.34; break;
          case T.BARRIER: cr = 0.3; cg = 0.33; cb = 0.42; break;
          default: { const src = chk ? cA : cB; cr = src.r; cg = src.g; cb = src.b; }
        }
        tCol[k] = cr; tCol[k + 1] = cg; tCol[k + 2] = cb;
        nt++;
        if (t === T.BARRIER && nb < 400) { const o = nb * 16; for (let i = 0; i < 16; i++) bArr[o + i] = tp.e[i]; bArr[o + 14] = z; nb++; }
        else if (t === T.SPIKE && ns < 400) { const o = ns * 16; for (let i = 0; i < 16; i++) sArr[o + i] = tp.e[i]; sArr[o + 14] = z; ns++; }
      }
      const list = level.shardsAt.get(r);
      if (list) for (const s of list) {
        if (s.got || nsh >= 260) continue;
        facePos(s.c, P);
        dummy.position.set(P.x + P.nx * s.h, P.y + P.ny * s.h, -(s.r + 0.5));
        qFace.setFromAxisAngle(zAxis, P.f * PI / 2);
        qSpin.setFromAxisAngle(yAxis, time * 3 + s.r);
        dummy.quaternion.copy(qFace).multiply(qSpin);
        dummy.updateMatrix();
        shards.setMatrixAt(nsh, dummy.matrix);
        const pulse = 0.85 + 0.15 * Math.sin(time * 6 + s.r);
        shards.instanceColor.array[nsh * 3] = 1; shards.instanceColor.array[nsh * 3 + 1] = 0.88 * pulse; shards.instanceColor.array[nsh * 3 + 2] = 0.3;
        nsh++;
      }
    }
    for (const [m, n] of [[tiles, nt], [barriers, nb], [spikes, ns], [shards, nsh]]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    barriers.instanceColor.needsUpdate = false;
    // Ribs follow the player in a repeating pattern.
    const first = Math.floor(row / RIB_GAP) * RIB_GAP - RIB_GAP;
    ribMat.color.copy(theme.glow);
    for (let i = 0; i < RIBS; i++) {
      dummy.position.set(0, 0, -(first + i * RIB_GAP + 0.5));
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      ribs.setMatrixAt(i, dummy.matrix);
    }
    ribs.instanceMatrix.needsUpdate = true;
  }

  function updateStars(dt, sp) {
    const zc = -row;
    for (let i = 0; i < STARS; i++) {
      starPos[i * 3 + 2] += sp * 0.35 * dt;
      if (starPos[i * 3 + 2] > zc + 8) starPos[i * 3 + 2] -= 115;
    }
    starPts.position.z = 0;
    starGeo.attributes.position.needsUpdate = true;
    starMat.color.copy(theme.star);
  }

  function pose(dt) {
    facePos(u, P);
    const hh = Math.max(h, -12);
    runnerGroup.position.set(P.x + P.nx * hh, P.y + P.ny * hh, -row);
    // Smooth the "up" direction so corners roll the camera.
    const goal = (P.f + 1) * PI / 2;
    let diff = ((goal - camAng + PI) % TAU + TAU) % TAU - PI;
    camAng += diff * (1 - Math.exp(-dt * 7.5));
    const ux = Math.cos(camAng), uy = Math.sin(camAng);
    vU.set(ux, uy, 0); vR.set(uy, -ux, 0);
    basis.makeBasis(vR, vU, vB);
    runnerGroup.quaternion.setFromRotationMatrix(basis);
    // Animate.
    const stride = grounded ? Math.sin(row * 2.2) : 0.9;
    legL.rotation.x = grounded ? stride * 0.9 : -0.7;
    legR.rotation.x = grounded ? -stride * 0.9 : 0.5;
    squash *= Math.exp(-dt * 10);
    body.scale.set(1 - squash * 0.4, 1 + squash, 1 - squash * 0.4);
    body.rotation.z = -lv * 0.025;
    body.rotation.x = grounded ? 0.12 : (vy > 0 ? -0.15 : 0.2);
    bodyMesh.position.y = 0.62 + (grounded ? Math.abs(Math.sin(row * 2.2)) * 0.05 : 0);
    runnerGroup.visible = state !== 'dead';
    // Camera.
    const px = P.x + P.nx * Math.max(h, -2) * 0.6, py = P.y + P.ny * Math.max(h, -2) * 0.6;
    const back = mode === 'menu' ? 5.2 : 4.8;
    const lift = 1.75;
    let sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * shake * 0.5; sy = (Math.random() - 0.5) * shake * 0.5; shake = Math.max(0, shake - dt * 2.5); }
    camera.position.set(px + ux * lift * 0.5 + sx, py + uy * lift * 0.5 + sy, -row + back);
    // Pull the camera in toward the axis a little so the tunnel reads as a tube.
    camera.position.x *= 0.62; camera.position.y *= 0.62;
    camera.up.set(ux, uy, 0);
    camera.lookAt(px * 0.45 + ux * 0.3, py * 0.45 + uy * 0.3, -row - 8);
    const wantFov = 72 + (boostT > 0 ? 10 : 0) + (grounded ? 0 : 3);
    camera.fov += (wantFov - camera.fov) * (1 - Math.exp(-dt * 5));
    camera.updateProjectionMatrix();
    sky.position.copy(camera.position);
  }

  function hud() {
    $('s-shards').textContent = save.shards.toLocaleString();
    if (mode === 'campaign') {
      const f = THREE.MathUtils.clamp(row / level.finishRow, 0, 1);
      $('rr-fill').style.width = f * 100 + '%';
      $('s-prog').textContent = Math.floor(f * 100) + '%';
    } else if (mode === 'endless' || mode === 'daily') {
      $('s-prog').textContent = Math.floor(row) + ' m';
    } else {
      $('s-prog').textContent = '–';
    }
    $('rr-combo').textContent = combo >= 3 ? `Combo ×${combo}` : '';
  }

  let last = performance.now();
  let demoWorld = Math.floor(Math.random() * 6);
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    if (state === 'menu') {
      // Demo run behind the menu.
      if (!level || mode !== 'menu') {
        mode = 'menu';
        cfg = RR.campaignLevel(demoWorld, 2); level = cfg.level; resetRun(); row = 1; u = level.lane[2] + 0.5;
        setThemeTarget(demoWorld, true);
      }
      const n = Math.ceil(dt / 0.016);
      for (let i = 0; i < n; i++) autopilot(dt / n);
      if (state === 'menu' && (row > 700 || (grounded === false && h < -8))) {
        demoWorld = (demoWorld + 1) % 6;
        cfg = RR.campaignLevel(demoWorld, 2); level = cfg.level; resetRun(); row = 1; u = level.lane[2] + 0.5;
        setThemeTarget(demoWorld, false);
      }
      invuln = 5;
      if (state === 'menu') { /* demo ignores hazards */ }
    } else if (state === 'ready') {
      stateT += dt;
      if (stateT > 1.5) { state = 'playing'; banner('Go!', '', 500); tone({ freq: 440, to: 880, dur: 0.2, type: 'square', vol: 0.05 }); }
    } else if (state === 'playing') {
      const n = Math.ceil(dt / 0.012);
      for (let i = 0; i < n && state === 'playing'; i++) physics(dt / n, false);
      music(dt);
      if (mode !== 'campaign') setThemeTarget(RR.endlessWorldAt(Math.floor(row)), false);
    } else if (state === 'dead') {
      stateT += dt;
      if (stateT > 1) {
        if (mode === 'campaign') respawn();
        else endlessOver();
      }
    }
    if (state !== 'paused') {
      easeTheme(dt);
      scene.fog.color.copy(theme.fog);
      paintSky();
      updateParticles(dt);
    }
    if (state !== 'paused') {
      const sp = state === 'playing' || state === 'menu' ? (mode === 'campaign' ? cfg.speed : 12) : 0;
      updateStars(dt, sp * 1.6 + 20);
    }
    buildScene(dt);
    pose(dt);
    hud();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ---------- Menus ----------
  const ui = Arcade.overlay($('overlay'));
  const overlayEl = $('overlay');

  const runnerSvg = r => `<svg viewBox="0 0 56 56" aria-hidden="true"><rect x="16" y="14" width="24" height="28" rx="12" fill="${r.color}"/><rect x="20" y="20" width="16" height="9" rx="4.5" fill="${r.trim}"/><rect x="24" y="23" width="8" height="2.5" rx="1.2" fill="#fff"/><rect x="19" y="42" width="7" height="9" rx="2" fill="${r.trim}"/><rect x="30" y="42" width="7" height="9" rx="2" fill="${r.trim}"/><circle cx="28" cy="9" r="3" fill="#ff5d73"/><rect x="27" y="9" width="2" height="6" fill="${r.trim}"/></svg>`;

  function totalStars() { return Object.values(save.levels).reduce((a, l) => a + (l.stars || 0), 0); }

  function showMenu() {
    state = 'menu'; mode = 'menu'; level = null;
    $('rr-bar').hidden = true;
    $('s-level').textContent = '–';
    ui.show({
      title: 'Pixel Pioneers Arcade',
      html: `<h2 class="rr-title" style="font-size:38px;margin:0">RIFT RUNNER</h2>
        <p class="rr-sub">Run the tunnel. Take the corners. Close the rift.</p>
        <div class="rr-menu">
          <button class="btn" data-act="campaign" type="button">Campaign · ${totalStars()}/108 ★</button>
          <button class="btn secondary" data-act="endless" type="button">Endless${save.endlessDist ? ` · best ${save.endlessDist.toLocaleString()} m` : ''}</button>
          <button class="btn secondary" data-act="daily" type="button">Daily Run</button>
          <button class="btn secondary" data-act="runners" type="button">Runners · ${save.shards.toLocaleString()} shards</button>
          <button class="btn secondary" data-act="howto" type="button">How to play</button>
        </div>`,
      button: null,
    });
  }
  function showHowTo() {
    ui.show({
      title: 'How to play',
      html: `<ul style="text-align:left">
        <li><b>Run</b> forward automatically. <b>Steer</b> with <b>← →</b> or <b>A D</b>.</li>
        <li><b>Jump</b> with <b>Space</b> or <b>↑</b>. Hold it for height. Tiles are the only ground: fall off and you start from the last checkpoint.</li>
        <li>The tunnel is a ring. Run past the edge of the floor and you carry on <b>up the wall</b>, along the <b>ceiling</b> and all the way round.</li>
        <li>Yellow tiles <b>boost</b>, pink tiles <b>bounce</b>, ice is slippery, amber tiles crumble. Hop over <b>striped blocks</b> and stay off the <b>red spikes</b>.</li>
        <li>Collect <b>shards</b>. 65% earns a second star, 90% a third. Spend shards on new runners.</li>
        <li>Finish a level to open the next. Six worlds, six levels each. Endless mode and a Daily Run have no end.</li>
      </ul>
      <div class="rr-row"><button class="btn" data-act="menu" type="button">Got it</button></div>`,
      button: null,
    });
  }
  function showCampaign() {
    const worlds = WORLDS.map((W, w) => {
      const done = [0, 1, 2, 3, 4, 5].reduce((a, l) => a + starsOf(w, l), 0);
      const btns = [0, 1, 2, 3, 4, 5].map(l => {
        const ok = isUnlocked(w, l), s = starsOf(w, l);
        return `<button class="rr-lv" data-act="level" data-w="${w}" data-l="${l}" type="button" ${ok ? '' : 'disabled'}>${ok ? levelKey(w, l) : '🔒'}<small>${ok ? '★'.repeat(s) + '☆'.repeat(3 - s) : ''}</small></button>`;
      }).join('');
      return `<div class="rr-world" style="border-left:4px solid ${W.tileA}"><h3>${w + 1}. ${W.name}<small>${done}/18 ★</small></h3><p>${W.blurb}</p><div class="rr-levels">${btns}</div></div>`;
    }).join('');
    ui.show({
      title: 'Campaign',
      html: `<div class="rr-top"><button class="btn secondary" data-act="menu" type="button">← Menu</button><span>${totalStars()}/108 ★ · ${save.shards.toLocaleString()} shards</span></div>${worlds}`,
      button: null,
    });
  }
  function showRunners() {
    const cards = RUNNERS.map(r => {
      const own = save.owned.includes(r.id), on = save.runner === r.id;
      const act = on ? '<button class="btn secondary" disabled type="button">Selected</button>'
        : own ? `<button class="btn" data-act="pick" data-id="${r.id}" type="button">Select</button>`
          : `<button class="btn" data-act="buy" data-id="${r.id}" type="button" ${save.shards >= r.cost ? '' : 'disabled'}>Unlock · ${r.cost.toLocaleString()}</button>`;
      return `<div class="rr-runner ${on ? 'on' : ''}">${runnerSvg(r)}<b>${r.name}</b><p>${r.perk}</p>${act}</div>`;
    }).join('');
    ui.show({
      title: 'Runners',
      html: `<div class="rr-top"><button class="btn secondary" data-act="menu" type="button">← Menu</button><span>${save.shards.toLocaleString()} shards</span></div><div class="rr-runners">${cards}</div>`,
      button: null,
    });
  }
  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    ui.show({
      title: 'Paused',
      html: `<div class="rr-row"><button class="btn secondary" data-act="quit" type="button">Quit to menu</button></div>`,
      button: 'Resume',
      onAction: resume,
    });
  }
  function resume() {
    if (state !== 'paused') return;
    ui.hide();
    state = 'playing';
    last = performance.now();
  }

  overlayEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.act) {
      case 'menu': showMenu(); break;
      case 'campaign': showCampaign(); break;
      case 'endless': startEndless(false); break;
      case 'daily': startEndless(true); break;
      case 'runners': showRunners(); break;
      case 'howto': showHowTo(); break;
      case 'level': startCampaign(+d.w, +d.l); break;
      case 'replay': startCampaign(curW, curL); break;
      case 'quit': showMenu(); break;
      case 'pick': save.runner = d.id; persist(); showRunners(); break;
      case 'buy': {
        const r = RUNNERS.find(x => x.id === d.id);
        if (r && save.shards >= r.cost && !save.owned.includes(r.id)) {
          save.shards -= r.cost; save.owned.push(r.id); save.runner = r.id; persist();
          tone({ freq: 523, to: 1046, dur: 0.3, type: 'triangle', vol: 0.06 });
          if (save.owned.length >= RUNNERS.length) Arcade.flag('rift-runner-all');
          showRunners();
        }
        break;
      }
    }
  });

  buildRunner(runnerDef());
  paintSky();
  showMenu();
  if (!save.seen) { save.seen = true; persist(); showHowTo(); }
  requestAnimationFrame(frame);
})();
