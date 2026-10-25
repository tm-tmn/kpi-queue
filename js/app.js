/* ================================================================
   ผังเวลารอผู้ป่วยนอก — ฉาก 3 มิติ isometric + UI
   ================================================================ */
(function () {
  'use strict';
  const D = window.KQ_DATA, SIM = window.KQ_SIM, M = window.KQ_METRICS;
  const { ST, PLANS, CAMPUS_BUILDINGS, CLINICS, PXR, PX } = D;
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const fmtT = m => { m = Math.floor(m); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const fmtN = v => v == null ? '–' : Math.round(v).toLocaleString('th-TH');
  const hn4 = hn => 'HN •••' + hn.slice(-4);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CL = {}; CLINICS.forEach(c => { CL[c.id] = c; });
  const BLD = {}; CAMPUS_BUILDINGS.forEach(b => { BLD[b.id] = b; });
  const PH = {}; D.PHASES.forEach(p => { PH[p.id] = p.name; });
  const STV = { ok: '--ok', warn: '--warn', bad: '--bad', none: '--muted' };
  const STNAME = { ok: 'ผ่าน KPI', warn: 'ใกล้เกิน KPI', bad: 'เกิน KPI', none: 'ยังไม่มีข้อมูล' };
  const locName = (b, f) => BLD[b].short + (PLANS[b].floors.length > 1 ? ' · ชั้น ' + (f + 1) : '');

  /* ---------------- ข้อมูลจำลอง ---------------- */
  let KPI = Object.assign({}, D.KPI_DEFAULT, store.get('kq-kpi', {}));
  const PATS = SIM.runSim(2026);
  const BY = M.indexSteps(PATS);
  let T = 630;                // 10:30
  let playing = true, speed = 10;
  let stats = {}, ov = {};

  /* ---------------- ธีม ---------------- */
  let TK = {};
  function readTokens() {
    const cs = getComputedStyle(document.documentElement);
    ['--ok', '--warn', '--bad', '--walk', '--accent', '--muted', '--sc-ground', '--sc-grass', '--sc-road', '--sc-roadline', '--sc-bld', '--sc-roof', '--sc-ctx', '--sc-edge', '--sc-wall',
      '--sc-floor', '--sc-corr', '--sc-tree', '--sc-text', '--sc-head', '--sc-slab'].forEach(k => { TK[k] = cs.getPropertyValue(k).trim() || '#888'; });
  }
  const isDark = () => {
    const a = document.documentElement.getAttribute('data-theme');
    return a ? a === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };
  let themeMode = store.get('kq-theme', 'system');
  function applyThemeAttr() {
    if (themeMode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', themeMode);
  }
  applyThemeAttr();

  /* ---------------- three.js ---------------- */
  const canvas = $('gl'), vp = $('viewport');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.75);
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(40, 80, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  scene.add(hemi, sun, sun.target);

  const MAT = {};
  const lam = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
  ['ground', 'grass', 'road', 'roadline', 'bld', 'roof', 'ctx', 'wall', 'floor', 'corr', 'tree', 'head', 'slab', 'lift'].forEach(k => { MAT[k] = lam(); });
  MAT.edge = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.55 });
  MAT.wire = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false });
  MAT.body = new THREE.MeshLambertMaterial({ color: 0xffffff });
  MAT.band = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 });
  MAT.ring = new THREE.MeshBasicMaterial({ color: 0xffffff });
  MAT.route = new THREE.LineBasicMaterial({ color: 0xffffff });
  const C = k => new THREE.Color(TK[k]);
  function applyTheme() {
    readTokens();
    const map = { ground: '--sc-ground', grass: '--sc-grass', road: '--sc-road', roadline: '--sc-roadline', bld: '--sc-bld', roof: '--sc-roof', ctx: '--sc-ctx', wall: '--sc-wall',
      floor: '--sc-floor', corr: '--sc-corr', tree: '--sc-tree', head: '--sc-head', slab: '--sc-slab', lift: '--sc-ctx', edge: '--sc-edge', wire: '--sc-edge' };
    Object.keys(map).forEach(k => MAT[k].color.set(TK[map[k]]));
    MAT.band.color.set(TK['--sc-edge']); MAT.ring.color.set(TK['--accent']); MAT.route.color.set(TK['--accent']);
    const dark = isDark();
    hemi.intensity = dark ? 0.62 : 0.78; sun.intensity = dark ? 0.42 : 0.58;
    hemi.groundColor.set(dark ? 0x223030 : 0x9aa8a0);
    if (view.mode === 'bld') buildDecal();
    tick(true);
  }

  /* ---------------- กล้อง + การควบคุม ---------------- */
  const EL = Math.atan(1 / Math.SQRT2);
  const rig = { tx: 0, tz: 0, az: Math.PI / 4, half: 30, zoom: 1, g: { tx: 0, tz: 0, az: Math.PI / 4, half: 30, zoom: 1 } };
  let VW = 800, VH = 500;
  function updateCam() {
    const R = 300;
    cam.position.set(rig.tx + R * Math.cos(EL) * Math.sin(rig.az), R * Math.sin(EL), rig.tz + R * Math.cos(EL) * Math.cos(rig.az));
    cam.up.set(0, 1, 0);
    cam.lookAt(rig.tx, 0, rig.tz);
    const a = VW / VH;
    cam.top = rig.half; cam.bottom = -rig.half; cam.left = -rig.half * a; cam.right = rig.half * a;
    cam.zoom = rig.zoom;
    cam.updateProjectionMatrix();
  }
  function frame(cx, cz, w, d, h, instant) {
    const a = VW / VH, s = w + d;
    const half = Math.max(s * 0.408 / 2 * 1.18 + (h || 0) * 0.45, s * 0.707 / 2 / a * 1.08);
    Object.assign(rig.g, { tx: cx, tz: cz, half, zoom: 1 });
    if (instant) { rig.tx = cx; rig.tz = cz; rig.half = half; rig.zoom = 1; }
  }
  function stepRig(dt) {
    const k = 1 - Math.pow(0.0005, dt);
    ['tx', 'tz', 'az', 'half', 'zoom'].forEach(p => { rig[p] += (rig.g[p] - rig[p]) * k; });
  }
  function resize() {
    const r = vp.getBoundingClientRect();
    VW = Math.max(1, r.width); VH = Math.max(1, r.height);
    renderer.setSize(VW, VH, false);
    updateCam();
  }
  new ResizeObserver(resize).observe(vp);

  const ptrs = new Map();
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) drag = { x0: e.clientX, y0: e.clientY, moved: 0, t: performance.now(), multi: false };
    else if (drag) drag.multi = true;
  });
  canvas.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) { hover(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (ptrs.size === 1) {
      const wpp = (2 * rig.half / rig.zoom) / VH;
      const rx = Math.cos(rig.az), rz = -Math.sin(rig.az), fx = -Math.sin(rig.az), fz = -Math.cos(rig.az);
      const ux = dx * wpp, uy = dy * wpp / Math.sin(EL);
      rig.g.tx += -rx * ux + fx * uy; rig.g.tz += -rz * ux + fz * uy;
      rig.tx = rig.g.tx; rig.tz = rig.g.tz;
      if (drag) drag.moved += Math.abs(dx) + Math.abs(dy);
    } else if (ptrs.size === 2) {
      const ids = [...ptrs.keys()], o = ptrs.get(ids[0] === e.pointerId ? ids[1] : ids[0]);
      const d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
      if (d0 > 0) { rig.g.zoom = clampZ(rig.g.zoom * d1 / d0); rig.zoom = rig.g.zoom; }
    }
    p.x = e.clientX; p.y = e.clientY;
  });
  const endPtr = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0 && drag) {
      if (!drag.multi && drag.moved < 8 && performance.now() - drag.t < 600) pick(e);
      drag = null;
    }
  };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', e => { e.preventDefault(); rig.g.zoom = clampZ(rig.g.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  const clampZ = z => Math.min(9, Math.max(0.35, z));
  $('zIn').onclick = () => { rig.g.zoom = clampZ(rig.g.zoom * 1.35); };
  $('zOut').onclick = () => { rig.g.zoom = clampZ(rig.g.zoom / 1.35); };
  $('rotL').onclick = () => { rig.g.az -= Math.PI / 2; };
  $('rotR').onclick = () => { rig.g.az += Math.PI / 2; };
  $('fitBtn').onclick = () => fitView();

  /* ---------------- ตัวช่วยสร้างวัตถุ ---------------- */
  function box(x0, z0, x1, z1, h, mat, y0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), h, Math.abs(z1 - z0)), mat);
    m.position.set((x0 + x1) / 2, (y0 || 0) + h / 2, (z0 + z1) / 2);
    return m;
  }
  function edges(mesh) {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), MAT.edge);
    l.position.copy(mesh.position);
    return l;
  }
  function flat(x0, z0, x1, z1, y, mat) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.receiveShadow = true;
    return m;
  }
  function disposeGroup(g) {
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.userData.ownMat) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    scene.remove(g);
  }

  /* ---------------- ภาพรวมโรงพยาบาล ---------------- */
  let campus = null;
  const halo = {};
  function buildCampus() {
    const g = new THREE.Group();
    const [gx0, gz0] = PX(-20, -20), [gx1, gz1] = PX(837, 963);
    g.add(flat(gx0, gz0, gx1, gz1, 0, MAT.ground));
    // ถนน
    D.ROADS.forEach(r => { const [a, b, c, d] = PXR(r.r); const m = box(a, b, c, d, 0.06, MAT.road); m.receiveShadow = true; g.add(m); });
    D.ROUNDABOUTS.forEach(([x, y]) => {
      const [wx, wz] = PX(x, y);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.07, 28), MAT.road); ring.position.set(wx, 0.035, wz); g.add(ring);
      const isl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.14, 24), MAT.grass); isl.position.set(wx, 0.07, wz); g.add(isl);
    });
    D.WALKWAYS.forEach(r => { const [a, b, c, d] = PXR(r); const m = box(a, b, c, d, 0.12, MAT.roadline, 1.6); g.add(m); });
    // อาคาร
    const occupied = [];
    CAMPUS_BUILDINGS.forEach(B => {
      const parts = B.rects.map(r => ({ r, h: B.h })).concat((B.podium || []).map(r => ({ r, h: 3 }))).concat((B.extra || []).map(e => ({ r: e.r, h: e.h })));
      let bb = [1e9, 1e9, -1e9, -1e9], top = 0;
      parts.forEach(p => {
        const [a, b, c, d] = PXR(p.r);
        bb = [Math.min(bb[0], a), Math.min(bb[1], b), Math.max(bb[2], c), Math.max(bb[3], d)];
        top = Math.max(top, p.h);
        occupied.push([a - 1, b - 1, c + 1, d + 1]);
        if (B.wire) {
          const m = box(a, b, c, d, p.h, MAT.wire); g.add(m); g.add(edges(m));
          return;
        }
        const side = B.svc ? MAT.bld : MAT.ctx, roof = B.roof === 'main' ? MAT.roof : side;
        const m = box(a, b, c, d, p.h, [side, side, roof, side, side, side]);
        m.castShadow = true; m.receiveShadow = true;
        m.userData.bld = B.id;
        g.add(m); g.add(edges(m));
        if (B.svc) pickables.push(m);
        // แถบชั้น
        if (B.svc) for (let y = 1.2; y < p.h - 0.4; y += 1.2) {
          const s = box(a - 0.02, b - 0.02, c + 0.02, d + 0.02, 0.06, MAT.band, y);
          g.add(s);
        }
      });
      B.bb = bb; B.top = top;
      if (B.svc) {
        const hm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false });
        const h = flat(bb[0] - 1.4, bb[1] - 1.4, bb[2] + 1.4, bb[3] + 1.4, 0.09, hm);
        h.userData.ownMat = true; halo[B.id] = hm;
        g.add(h);
      }
    });
    // ต้นไม้
    const rnd = (s => () => { s = (s * 16807) % 2147483647; return s / 2147483647; })(7);
    const roads = D.ROADS.map(r => PXR(r.r));
    const inside = (x, z, list) => list.some(r => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
    const pts = [];
    for (let i = 0; i < 900 && pts.length < 170; i++) {
      const x = gx0 + 2 + rnd() * (gx1 - gx0 - 4), z = gz0 + 2 + rnd() * (gz1 - gz0 - 4);
      if (inside(x, z, occupied) || inside(x, z, roads.map(r => [r[0] - 0.8, r[1] - 0.8, r[2] + 0.8, r[3] + 0.8]))) continue;
      pts.push([x, z, 0.6 + rnd() * 0.6]);
    }
    const tg = new THREE.SphereGeometry(1, 10, 8); tg.scale(1, 0.85, 1); tg.translate(0, 1.2, 0);
    const trees = new THREE.InstancedMesh(tg, MAT.tree, pts.length);
    const dm = new THREE.Object3D();
    pts.forEach((p, i) => { dm.position.set(p[0], 0, p[1]); dm.scale.setScalar(p[2]); dm.updateMatrix(); trees.setMatrixAt(i, dm.matrix); });
    trees.castShadow = true; trees.frustumCulled = false;
    g.add(trees);
    return g;
  }

  /* ---------------- ผังภายในอาคาร ---------------- */
  let bgrp = null, decal = null;
  const roomMat = {}, areaMat = {};
  function buildBuilding(b, f) {
    const P = PLANS[b], g = new THREE.Group(), W = P.W, Dd = P.D;
    Object.keys(roomMat).forEach(k => delete roomMat[k]);
    Object.keys(areaMat).forEach(k => delete areaMat[k]);
    const slab = box(-W / 2 - 0.6, -Dd / 2 - 0.6, W / 2 + 0.6, Dd / 2 + 0.6, 0.6, MAT.slab, -0.6); slab.receiveShadow = true; g.add(slab); g.add(edges(slab));
    g.add(flat(-W / 2, -Dd / 2, W / 2, Dd / 2, 0.01, MAT.corr));
    const WH = 1.05, WT = 0.2, DOOR = 2.6;
    const wall = (x0, z0, x1, z1, h) => { const m = box(x0, z0, x1, z1, h || WH, MAT.wall); m.castShadow = true; m.receiveShadow = true; g.add(m); };
    const hwall = (x0, x1, z, gap) => {
      if (!gap) return wall(x0, z - WT / 2, x1, z + WT / 2);
      const c = (x0 + x1) / 2, w = Math.min(DOOR, (x1 - x0) * 0.5);
      wall(x0, z - WT / 2, c - w / 2, z + WT / 2); wall(c + w / 2, z - WT / 2, x1, z + WT / 2);
    };
    P.floors[f].forEach(room => {
      const [x0, z0, x1, z1] = room.r;
      let mat = MAT.floor;
      if (room.st) { mat = new THREE.MeshLambertMaterial({ color: TK['--sc-floor'] }); roomMat[room.st] = mat; }
      else if (room.waitFor) { mat = new THREE.MeshLambertMaterial({ color: TK['--sc-floor'] }); areaMat[room.waitFor] = mat; }
      else if (room.k === 'area') mat = MAT.grass;
      const fl = flat(x0 + 0.05, z0 + 0.05, x1 - 0.05, z1 - 0.05, 0.02, mat);
      if (mat !== MAT.floor && mat !== MAT.grass) fl.userData.ownMat = true;
      if (room.st) { fl.userData.st = room.st; pickables.push(fl); }
      if (room.waitFor) { fl.userData.st = room.waitFor; pickables.push(fl); }
      g.add(fl);
      if (room.k === 'area') return;
      const d = room.d || '';
      hwall(x0, x1, z0, d.includes('n'));
      hwall(x0, x1, z1, d.includes('s'));
      wall(x0 - WT / 2, z0, x0 + WT / 2, z1);
      wall(x1 - WT / 2, z0, x1 + WT / 2, z1);
      if (room.cub) {
        const cw = (x1 - x0) / room.cub, south = d.includes('s');
        for (let k = 1; k < room.cub; k++) {
          const x = x0 + cw * k, za = south ? z0 : z1 - (z1 - z0) * 0.55, zb = south ? z0 + (z1 - z0) * 0.55 : z1;
          wall(x - 0.08, za, x + 0.08, zb, 0.8);
        }
      }
      if (room.k === 'lift') { const m = box(x0 + 1.5, z0 + 1.5, x1 - 1.5, z0 + 5, 2.2, MAT.lift); m.castShadow = true; g.add(m); g.add(edges(m)); }
    });
    // ปลายทางเดิน
    wall(-W / 2 - WT / 2, P.corr[0], -W / 2 + WT / 2, P.corr[1]);
    wall(W / 2 - WT / 2, P.corr[0], W / 2 + WT / 2, P.corr[1]);
    // ทางออก
    if (f === 0) {
      const [ex, ez] = P.exit;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 3), new THREE.MeshBasicMaterial({ color: TK['--accent'] }));
      arrow.userData.ownMat = true;
      arrow.rotation.x = Math.PI / 2; arrow.position.set(ex, 0.15, ez + 1.4); g.add(arrow);
    }
    bgrp = g;
    buildDecal();
    return g;
  }
  function buildDecal() {
    if (!bgrp) return;
    if (decal) { bgrp.remove(decal); decal.geometry.dispose(); decal.material.map.dispose(); decal.material.dispose(); }
    const P = PLANS[view.b], rooms = P.floors[view.f], S = 28;
    const cv = document.createElement('canvas'); cv.width = P.W * S; cv.height = P.D * S;
    const x = cv.getContext('2d');
    const X = v => (v + P.W / 2) * S, Z = v => (v + P.D / 2) * S;
    x.fillStyle = TK['--sc-text']; x.strokeStyle = TK['--sc-text'];
    x.textAlign = 'center'; x.textBaseline = 'middle';
    rooms.forEach(room => {
      const [x0, z0, x1, z1] = room.r, cx = (x0 + x1) / 2, south = room.d && room.d.includes('s');
      // ที่นั่ง
      if (room.k === 'area' && room.waitFor) {
        x.globalAlpha = 0.18;
        for (let zz = z0 + 1.2; zz < z1 - 0.8; zz += 1.6) { x.fillRect(X(x0 + 0.9), Z(zz), (x1 - x0 - 1.8) * S, 0.35 * S); }
        x.globalAlpha = 1;
      }
      x.globalAlpha = room.st ? 0.9 : 0.7;
      x.font = '600 ' + Math.round(S * 0.78) + 'px "IBM Plex Sans Thai", sans-serif';
      const ty = room.k === 'area' ? z1 - 0.9 : south ? z0 + 1.0 : z1 - 1.0;
      x.fillText(room.n, X(cx), Z(ty), (x1 - x0 - 0.6) * S);
      if (room.cub) {
        x.font = '500 ' + Math.round(S * 0.6) + 'px "IBM Plex Sans Thai", sans-serif'; x.globalAlpha = 0.6;
        const cw = (x1 - x0) / room.cub;
        for (let k = 0; k < room.cub; k++) x.fillText('ห้อง ' + (k + 1), X(x0 + cw * (k + 0.5)), Z(south ? z0 + 2.1 : z1 - 2.1));
      }
      x.globalAlpha = 1;
    });
    x.font = '600 ' + Math.round(S * 0.7) + 'px "IBM Plex Sans Thai", sans-serif'; x.globalAlpha = 0.55;
    x.fillText('ทางเดิน', X(P.W / 2 - 3), Z((P.corr[0] + P.corr[1]) / 2));
    if (view.f === 0) { x.globalAlpha = 0.85; x.fillText('ทางเข้า-ออก', X(P.exit[0]), Z(P.exit[1] - 1.4)); }
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(P.W, P.D), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.05; m.renderOrder = 2;
    decal = m; bgrp.add(m);
  }

  /* ---------------- คน (instanced) ---------------- */
  const MAXP = 1800;
  const bodyG = new THREE.CylinderGeometry(0.19, 0.25, 0.78, 8); bodyG.translate(0, 0.39, 0);
  const headG = new THREE.SphereGeometry(0.17, 10, 8); headG.translate(0, 0.95, 0);
  const bodies = new THREE.InstancedMesh(bodyG, MAT.body, MAXP);
  const heads = new THREE.InstancedMesh(headG, MAT.head, MAXP);
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < MAXP; i++) bodies.setColorAt(i, white);   // ต้องทำก่อนตั้ง count = 0
  [bodies, heads].forEach(m => { m.frustumCulled = false; m.castShadow = true; m.count = 0; });
  scene.add(bodies, heads);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 28), MAT.ring);
  ring.rotation.x = Math.PI / 2; ring.visible = false; scene.add(ring);
  let instPid = [];
  const slotCache = {};
  function slots(st) {
    if (slotCache[st]) return slotCache[st];
    const s = ST[st], [x0, z0, x1, z1] = s.wait, sp = 0.92, out = [];
    for (let x = x0 + sp / 2; x <= x1 - sp / 2 + 1e-6; x += sp) for (let z = z0 + sp / 2; z <= z1 - sp / 2 + 1e-6; z += sp) out.push([x, z]);
    out.sort((a, b) => Math.hypot(a[0] - s.door[0], a[1] - s.door[1]) - Math.hypot(b[0] - s.door[0], b[1] - s.door[1]));
    return (slotCache[st] = out);
  }
  const overflow = {};
  const dm = new THREE.Object3D(), col = new THREE.Color();
  function updatePeople(now) {
    const wl = {};
    const vis = [];
    const inB = view.mode === 'bld';
    for (const p of PATS) {
      const s = SIM.stateAt(p, T);
      if (!s) continue;
      if (s.kind === 'wait') { (wl[s.st] = wl[s.st] || []).push({ p, since: s.since }); continue; }
      if (s.kind === 'serve') {
        const st = ST[s.st];
        if (inB && st.b === view.b && st.f === view.f) { const q = st.srv[s.srv]; vis.push({ p, x: q[0] + ((p.id % 5) - 2) * 0.06, z: q[1] + 0.5, c: 'serve' }); }
        continue;
      }
      const lp = SIM.legPos(s.L, s.el);
      if (!lp || lp.sp === 'lift') continue;
      if (inB ? (lp.sp === 'plan' && lp.b === view.b && lp.f === view.f) : lp.sp === 'campus') vis.push({ p, x: lp.x, z: lp.z, c: 'walk', bob: true });
    }
    Object.keys(overflow).forEach(k => delete overflow[k]);
    if (inB) {
      Object.keys(wl).forEach(id => {
        const st = ST[id];
        if (st.b !== view.b || st.f !== view.f) return;
        const arr = wl[id].sort((a, b) => a.since - b.since);
        const sl = slots(id), k = KPI[st.phase];
        arr.forEach((w, i) => {
          if (i >= sl.length) return;
          vis.push({ p: w.p, x: sl[i][0], z: sl[i][1], c: M.status(T - w.since, k) });
        });
        if (arr.length > sl.length) overflow[id] = arr.length - sl.length;
      });
    }
    const sc = inB ? 1 : 1.5;
    let n = 0;
    instPid = [];
    let selPos = null;
    for (const v of vis) {
      if (n >= MAXP) break;
      const y = v.bob ? Math.abs(Math.sin(now * 0.009 + v.p.id)) * 0.07 * sc : 0;
      dm.position.set(v.x, y, v.z); dm.rotation.set(0, 0, 0); dm.scale.setScalar(sc); dm.updateMatrix();
      bodies.setMatrixAt(n, dm.matrix); heads.setMatrixAt(n, dm.matrix);
      col.set(TK[v.c === 'serve' ? '--accent' : v.c === 'walk' ? '--walk' : STV[v.c]]);
      bodies.setColorAt(n, col);
      instPid[n] = v.p.id;
      if (sel.type === 'pat' && sel.id === v.p.id) selPos = [v.x, v.z, sc];
      n++;
    }
    bodies.count = heads.count = n;
    bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    ring.visible = !!selPos;
    if (selPos) { ring.position.set(selPos[0], 0.12 + Math.abs(Math.sin(now * 0.004)) * 0.1, selPos[1]); ring.scale.setScalar(selPos[2]); }
  }

  /* ---------------- ป้ายลอย ---------------- */
  const labRoot = $('labels');
  let labels = [];
  function clearLabels() { labRoot.innerHTML = ''; labels = []; }
  function addLabel(cls, html, pos, data) {
    const el = document.createElement('div');
    el.className = 'lab ' + cls;
    el.innerHTML = html;
    labRoot.appendChild(el);
    const L = Object.assign({ el, pos: new THREE.Vector3(pos[0], pos[1], pos[2]) }, data || {});
    if (L.st || L.bld) el.addEventListener('click', ev => { ev.stopPropagation(); if (L.st) openStation(L.st); else enterBuilding(L.bld); });
    labels.push(L);
    return L;
  }
  const v3 = new THREE.Vector3();
  function placeLabels() {
    const ppu = VH / (2 * rig.half / rig.zoom);
    const compact = view.mode === 'bld' ? ppu < 15 : ppu < 7;
    for (const L of labels) {
      v3.copy(L.pos).project(cam);
      const x = (v3.x + 1) / 2 * VW, y = (1 - v3.y) / 2 * VH;
      const off = x < -80 || x > VW + 80 || y < -40 || y > VH + 80;
      L.el.style.display = off || (L.minPpu && ppu < L.minPpu) ? 'none' : '';
      L.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,' + (L.ctx ? '-50%' : '-100%') + ')';
      L.el.classList.toggle('compact', compact);
    }
  }
  function stationLabelHTML(id) {
    const s = stats[id], st = ST[id];
    if (!s) return '';
    const more = overflow[id] ? ' <span class="muted">(+' + overflow[id] + ' นอกภาพ)</span>' : '';
    return '<div class="lab-card" style="--sc:var(' + STV[s.status] + ')"><div class="lab-t"><i></i>' + esc(st.short) + '</div>' +
      '<div class="lab-v">รอ <b>' + s.n + '</b> คน · <b class="st-' + s.status + '">' + fmtN(s.avg) + '</b> นาที' + more + '</div></div>';
  }
  function bldAgg(b) {
    let n = 0, worst = null;
    Object.values(ST).forEach(st => {
      if (st.b !== b) return;
      const s = stats[st.id]; if (!s) return;
      n += s.n;
      if (s.ratio != null && (!worst || s.ratio > worst.ratio)) worst = s;
    });
    return { n, worst, status: worst ? worst.status : 'none' };
  }
  function floorAgg(b, f) {
    let n = 0, worst = null;
    Object.values(ST).forEach(st => {
      if (st.b !== b || st.f !== f) return;
      const s = stats[st.id]; n += s.n;
      if (s.ratio != null && (!worst || s.ratio > worst.ratio)) worst = s;
    });
    return { n, status: worst ? worst.status : 'none' };
  }
  function bldLabelHTML(b) {
    const B = BLD[b], a = bldAgg(b);
    return '<div class="lab-card" style="--sc:var(' + STV[a.status] + ')"><div class="lab-t"><i></i>' + esc(B.short) + (B.guess ? ' <span class="guess">เดา</span>' : '') + '</div>' +
      '<div class="lab-v">รอ <b>' + a.n + '</b> คน' + (a.worst ? ' · ช้าสุด <b class="st-' + a.status + '">' + esc(ST[a.worst.id].short) + '</b>' : '') + '</div></div>';
  }

  /* ---------------- มุมมอง ---------------- */
  const pickables = [];
  const view = { mode: 'campus', b: null, f: 0 };
  let routeLine = null;
  function setView(mode, b, f, keepCam) {
    canvas.classList.add('fade');
    setTimeout(() => {
      view.mode = mode; view.b = b; view.f = f || 0;
      pickables.length = 0;
      if (bgrp) { disposeGroup(bgrp); bgrp = null; decal = null; }
      clearLabels();
      if (mode === 'campus') {
        if (campus) { disposeGroup(campus); }
        campus = buildCampus(); scene.add(campus);
        CAMPUS_BUILDINGS.forEach(B => {
          if (!B.bb) return;
          const cx = (B.bb[0] + B.bb[2]) / 2, cz = (B.bb[1] + B.bb[3]) / 2;
          if (B.svc) addLabel('bld', bldLabelHTML(B.id), [cx, B.top + 1.2, cz], { bld: B.id });
          else if (B.name) addLabel('ctx', '<span>' + esc(B.name) + '</span>', [cx, B.top + 0.4, cz], { ctx: true, minPpu: 6 });
        });
        [['ถ.กัลปพฤกษ์', 120, 870], ['ถ.มิตรภาพ', 785, 700]].forEach(([n, x, y]) => { const p = PX(x, y); addLabel('ctx', '<span>' + n + '</span>', [p[0], 0.2, p[1]], { ctx: true, minPpu: 5 }); });
        sun.shadow.camera.left = -60; sun.shadow.camera.right = 60; sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
        if (!keepCam) fitView(true);
      } else {
        if (campus) { disposeGroup(campus); campus = null; }
        scene.add(buildBuilding(b, view.f));
        Object.values(ST).forEach(st => {
          if (st.b !== b || st.f !== view.f) return;
          const [x0, z0, x1, z1] = st.room.r;
          addLabel('st', '', [(x0 + x1) / 2, 2.4, (z0 + z1) / 2], { st: st.id });
        });
        sun.shadow.camera.left = -32; sun.shadow.camera.right = 32; sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32;
        if (!keepCam) fitView(true);
      }
      sun.shadow.camera.updateProjectionMatrix();
      updateRoute();
      renderNav();
      tick(true);
      canvas.classList.remove('fade');
    }, 160);
  }
  function fitView(instant) {
    if (view.mode === 'campus') { const a = PX(210, 110), b = PX(560, 560); frame((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, b[0] - a[0], b[1] - a[1], 6, instant); }
    else { const P = PLANS[view.b]; frame(0, 0, P.W, P.D, 2, instant); }
  }
  function enterBuilding(b, f) { setView('bld', b, f || 0); }
  function renderNav() {
    const c = $('crumbs');
    if (view.mode === 'campus') c.innerHTML = '<span class="cur">ภาพรวมโรงพยาบาล</span>';
    else {
      c.innerHTML = '<button id="crHome">ภาพรวมโรงพยาบาล</button><span class="sep">›</span><span class="cur">' + esc(BLD[view.b].name) + '</span>' +
        (BLD[view.b].guess ? ' <span class="guess">เดา</span>' : '');
      $('crHome').onclick = () => setView('campus');
    }
    $('guessNote').textContent = view.mode === 'campus'
      ? 'ตำแหน่งอาคารลอกจากภาพถ่ายดาวเทียม · อาคารผู้ป่วยนอกและการจัดคลินิกเป็นการเดา รอยืนยัน'
      : 'ผังภายในอาคารนี้เป็นการเดา รอผังจริง · ' + (BLD[view.b].note || '');
    renderFloors();
  }
  function renderFloors() {
    const el = $('floors');
    if (view.mode !== 'bld' || PLANS[view.b].floors.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = PLANS[view.b].floors.map((_, i) => {
      const a = floorAgg(view.b, i);
      return '<button data-f="' + i + '" class="' + (i === view.f ? 'on' : '') + '" style="--dc:var(' + STV[a.status] + ')" aria-pressed="' + (i === view.f) + '"><span class="dot"></span>ชั้น ' + (i + 1) + ' · ' + a.n + ' คน</button>';
    }).join('');
    el.querySelectorAll('button').forEach(bt => { bt.onclick = () => { const f = +bt.dataset.f; if (f !== view.f) setView('bld', view.b, f, true); }; });
  }

  /* ---------------- เลือกวัตถุ ---------------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hitTest(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hp = ray.intersectObjects([bodies, heads], false);
    if (hp.length && hp[0].instanceId != null && instPid[hp[0].instanceId] != null) return { pat: instPid[hp[0].instanceId] };
    const h = ray.intersectObjects(pickables, false);
    if (h.length) return h[0].object.userData;
    return null;
  }
  function pick(e) {
    const h = hitTest(e);
    if (!h) return;
    if (h.pat != null) openPerson(h.pat);
    else if (h.bld) enterBuilding(h.bld);
    else if (h.st) openStation(h.st);
  }
  let hoverT = 0;
  function hover(e) {
    if (e.pointerType !== 'mouse' || performance.now() - hoverT < 60) return;
    hoverT = performance.now();
    canvas.style.cursor = hitTest(e) ? 'pointer' : 'grab';
  }

  /* ---------------- แผงข้อมูล ---------------- */
  const sel = { type: null, id: null };
  const panel = $('panel'), pbody = $('panelBody');
  $('panelX').onclick = closePanel;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('kpiModal').hidden) closeKpi(); else if (!panel.hidden) closePanel(); else if (view.mode === 'bld') setView('campus'); } });
  function closePanel() { panel.hidden = true; sel.type = sel.id = null; labels.forEach(L => L.el.classList.remove('sel')); updateRoute(); }
  function openStation(id) {
    const st = ST[id];
    if (view.mode !== 'bld' || view.b !== st.b || view.f !== st.f) setView('bld', st.b, st.f);
    sel.type = 'st'; sel.id = id;
    panel.hidden = false;
    renderPanel(true);
    updateRoute();
  }
  function openPerson(pid) {
    sel.type = 'pat'; sel.id = pid;
    panel.hidden = false;
    renderPanel(true);
    updateRoute();
  }
  function goPerson(pid) {
    const p = PATS[pid], s = SIM.stateAt(p, T);
    if (!s) return;
    let b, f;
    if (s.kind === 'wait' || s.kind === 'serve') { b = ST[s.st].b; f = ST[s.st].f; }
    else { const lp = SIM.legPos(s.L, s.el); if (lp.sp === 'campus') b = null; else { b = lp.b; f = lp.f || 0; } }
    if (b == null) { if (view.mode !== 'campus') setView('campus'); }
    else if (view.mode !== 'bld' || view.b !== b || view.f !== f) setView('bld', b, f);
  }
  function renderPanel(reset) {
    if (panel.hidden) return;
    const keep = reset ? 0 : (pbody.querySelector('.q-list') || {}).scrollTop || 0;
    const keepP = reset ? 0 : panel.scrollTop;
    pbody.innerHTML = sel.type === 'st' ? stationPanel(sel.id) : personPanel(sel.id);
    const ql = pbody.querySelector('.q-list'); if (ql) ql.scrollTop = keep;
    panel.scrollTop = keepP;
    pbody.querySelectorAll('[data-pid]').forEach(b => { b.onclick = () => openPerson(+b.dataset.pid); });
    const gp = pbody.querySelector('#goPerson'); if (gp) gp.onclick = () => goPerson(sel.id);
    const gs = pbody.querySelector('#backSt'); if (gs) gs.onclick = () => openStation(gs.dataset.st);
    labels.forEach(L => L.el.classList.toggle('sel', sel.type === 'st' && L.st === sel.id));
  }
  function stationPanel(id) {
    const st = ST[id], s = stats[id], k = KPI[st.phase];
    const rows = s.waiting.slice(0, 80).map((e, i) => {
      const w = T - e.s.arrive, ss = M.status(w, k);
      return '<button class="q-row" data-pid="' + e.p.id + '"><span class="qn">' + (i + 1) + '</span><span class="hn">' + hn4(e.p.hn) + '<small>' + esc(CL[e.p.clinic].name) + '</small></span>' +
        '<span class="muted">' + fmtT(e.s.arrive) + '</span><span class="w st-' + ss + '">' + Math.round(w) + ' น.</span></button>';
    }).join('');
    return '<div class="pn-eyebrow">' + esc(locName(st.b, st.f)) + ' · ขั้น' + PH[st.phase] + '</div>' +
      '<h3 class="pn-title">' + esc(st.name) + '</h3>' +
      '<div class="pn-actions" style="margin:-2px 0 10px"><span class="chip st-' + s.status + '">' + STNAME[s.status] + '</span><span class="chip">depcode ' + st.dep + ' <span class="guess">เดา</span></span><span class="chip">' + st.c + ' ช่องบริการ</span></div>' +
      '<div class="pn-stats">' +
      '<div class="pn-stat"><span>รอตอนนี้</span><b>' + s.n + '</b> คน</div>' +
      '<div class="pn-stat"><span>เฉลี่ย 60 นาที</span><b style="color:var(' + STV[s.status] + ')">' + fmtN(s.avg) + '</b> / ' + k + '</div>' +
      '<div class="pn-stat"><span>รับบริการแล้ว</span><b>' + s.served + '</b> คน</div></div>' +
      '<div class="pn-h">เวลารอเฉลี่ยทุก 15 นาที <small>เส้นประ = KPI ' + k + ' นาที</small></div>' +
      '<div class="chart">' + chartSVG(M.series15(BY, id, T, 390), k) + '</div>' +
      '<div class="pn-h">รายการคิวที่รอ <small>' + s.n + ' คน · เรียงตามเวลามาถึง</small></div>' +
      (s.n ? '<div class="q-list"><div class="q-head"><span>#</span><span>ผู้ป่วย</span><span>มาถึง</span><span>รอแล้ว</span></div>' + rows +
        (s.n > 80 ? '<div class="q-more">และอีก ' + (s.n - 80) + ' คน</div>' : '') + '</div>' : '<p class="muted">ไม่มีผู้รอในขณะนี้</p>');
  }
  function chartSVG(ser, k) {
    const W = 340, H = 160, pl = 30, pr = 10, pt = 12, pb = 24;
    if (!ser.length) return '<p class="muted">ยังไม่มีข้อมูล</p>';
    const t0 = ser[0].t, t1 = Math.max(t0 + 60, ser[ser.length - 1].t + 15);
    const maxV = Math.max(k * 1.3, ...ser.map(s => s.avg || 0));
    const step = maxV > 150 ? 50 : maxV > 60 ? 30 : 15, ymax = Math.ceil(maxV / step) * step;
    const maxQ = Math.max(1, ...ser.map(s => s.q));
    const X = t => pl + (t - t0) / (t1 - t0) * (W - pl - pr), Y = v => pt + (1 - v / ymax) * (H - pt - pb);
    let g = '';
    for (let v = 0; v <= ymax; v += step) g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" style="stroke:var(--line)" stroke-width="1"/><text x="' + (pl - 5) + '" y="' + (Y(v) + 4) + '" text-anchor="end" style="fill:var(--muted)" font-size="10">' + v + '</text>';
    for (let h = Math.ceil(t0 / 60) * 60; h <= t1; h += 60) g += '<text x="' + X(h) + '" y="' + (H - 7) + '" text-anchor="middle" style="fill:var(--muted)" font-size="10">' + fmtT(h).slice(0, 2) + ':00</text>';
    const bw = Math.max(2, (X(t0 + 15) - X(t0)) * 0.7);
    const bars = ser.map(s => '<rect x="' + (X(s.t + 7.5) - bw / 2) + '" y="' + (H - pb - s.q / maxQ * (H - pt - pb) * 0.35) + '" width="' + bw + '" height="' + (s.q / maxQ * (H - pt - pb) * 0.35) + '" style="fill:var(--walk)" opacity=".22"/>').join('');
    let path = '', area = '', open = false, first = null, lastX = 0;
    ser.forEach(s => {
      if (s.avg == null) { if (open) { area += 'L' + lastX + ',' + Y(0) + 'L' + first + ',' + Y(0) + 'Z'; } open = false; return; }
      const x = X(s.t + 7.5), y = Y(s.avg);
      if (!open) { path += 'M' + x + ',' + y; area += 'M' + x + ',' + Y(0) + 'L' + x + ',' + y; first = x; open = true; } else { path += 'L' + x + ',' + y; area += 'L' + x + ',' + y; }
      lastX = x;
    });
    if (open) area += 'L' + lastX + ',' + Y(0) + 'Z';
    const dots = ser.filter(s => s.avg != null).map(s => '<circle cx="' + X(s.t + 7.5) + '" cy="' + Y(s.avg) + '" r="2.6" style="fill:var(' + STV[M.status(s.avg, k)] + ')"/>').join('');
    const ky = Y(k);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="กราฟเวลารอเฉลี่ยเทียบ KPI">' + g + bars +
      '<path d="' + area + '" style="fill:var(--accent)" opacity=".1"/><path d="' + path + '" fill="none" style="stroke:var(--accent)" stroke-width="2" stroke-linejoin="round"/>' + dots +
      '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + ky + '" y2="' + ky + '" style="stroke:var(--bad)" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<text x="' + (W - pr) + '" y="' + (ky - 4) + '" text-anchor="end" style="fill:var(--bad)" font-size="10" font-weight="600">KPI ' + k + '</text>' +
      '<text x="' + (pl + 2) + '" y="' + (pt - 2) + '" style="fill:var(--muted)" font-size="9">นาที · แท่งจาง = จำนวนคนรอ</text></svg>';
  }
  function personPanel(pid) {
    const p = PATS[pid], s = SIM.stateAt(p, T);
    let now = 'ยังไม่มาถึง';
    if (!s) now = T >= p.gone ? 'กลับบ้านแล้ว' : 'ยังไม่มาถึง';
    else if (s.kind === 'wait') now = 'รอที่ ' + ST[s.st].short;
    else if (s.kind === 'serve') now = 'กำลังรับบริการที่ ' + ST[s.st].short;
    else if (s.i === -1) now = 'กำลังเดินมาห้องบัตร';
    else if (s.out) now = 'รับยาแล้ว กำลังออกจากอาคาร';
    else now = 'กำลังเดินไป ' + ST[s.to].short;
    const items = p.route.map((sid, i) => {
      const st = ST[sid], k = KPI[st.phase], step = p.steps[i];
      const loc = esc(locName(st.b, st.f));
      if (!step || step.arrive > T) return '<li class="future"><span class="dot"></span><div><div class="nm">' + esc(st.short) + ' · ' + PH[st.phase] + '</div><div class="loc">' + loc + ' · ยังไม่ถึงขั้นนี้</div></div></li>';
      const waiting = T < step.start, w = (waiting ? T : step.start) - step.arrive, ss = M.status(w, k);
      const cur = s && (s.kind === 'wait' || s.kind === 'serve') && s.i === i;
      const tm = waiting ? 'มาถึง ' + fmtT(step.arrive) + ' · <b>รออยู่ ' + Math.round(w) + ' นาที</b>'
        : 'มาถึง ' + fmtT(step.arrive) + ' · เรียก ' + fmtT(step.start) + ' · <b>รอ ' + Math.round(w) + ' นาที</b>' + (T >= step.end ? ' · เสร็จ ' + fmtT(step.end) : ' · กำลังรับบริการ');
      return '<li class="' + (cur ? 'now' : '') + '" style="--dc:var(' + STV[ss] + ')"><span class="dot"></span><div><div class="nm">' + esc(st.short) + ' · ' + PH[st.phase] + '</div><div class="loc">' + loc + '</div><div class="tm">' + tm + '</div>' +
        '<div class="bar" style="--bc:var(' + STV[ss] + ');--kp:66.7%"><i style="width:' + Math.min(100, w / k / 1.5 * 100) + '%"></i></div><div class="tm">KPI ' + k + ' นาที</div></div></li>';
    }).join('');
    const arrived = p.arr <= T;
    const tot = arrived ? Math.min(T, p.done) - p.arr : 0, ts = M.status(tot, KPI.total);
    const back = p.steps.find(x => x.arrive <= T && T < x.start);
    return '<div class="pn-eyebrow">ผู้ป่วย (ข้อมูลสมมติ)</div><h3 class="pn-title">' + hn4(p.hn) + '</h3>' +
      '<div class="pn-actions" style="margin:-2px 0 10px"><span class="chip">' + esc(CL[p.clinic].name) + '</span><span class="chip">' + (p.appt ? 'มีนัด' : 'ไม่มีนัด') + '</span>' + (arrived ? '<span class="chip st-' + ts + '">' + STNAME[ts] + '</span>' : '') + '</div>' +
      '<div class="pn-stats"><div class="pn-stat"><span>ยื่นบัตร</span><b>' + (arrived ? fmtT(p.arr) : '–') + '</b></div>' +
      '<div class="pn-stat"><span>อยู่ใน รพ. แล้ว</span><b style="color:var(' + STV[ts] + ')">' + (arrived ? Math.round(tot) : '–') + '</b> น.</div>' +
      '<div class="pn-stat"><span>KPI รวม</span><b>' + KPI.total + '</b> น.</div></div>' +
      '<div class="pn-h">ตอนนี้ <small>' + esc(now) + '</small></div>' +
      '<div class="pn-h">เส้นทางตั้งแต่ยื่นบัตรถึงรับยา</div><ol class="tl">' + items + '</ol>' +
      '<div class="pn-actions"><button class="ghost-btn sm" id="goPerson">ไปที่ตำแหน่งปัจจุบัน</button>' +
      (back ? '<button class="ghost-btn sm" id="backSt" data-st="' + back.st + '">ดูคิวที่ ' + esc(ST[back.st].short) + '</button>' : '') + '</div>';
  }
  /* เส้นทางของคนที่เลือก (บนภาพรวม) */
  function updateRoute() {
    if (routeLine) { scene.remove(routeLine); routeLine.geometry.dispose(); routeLine = null; }
    if (sel.type !== 'pat' || view.mode !== 'campus') return;
    const p = PATS[sel.id], keys = [p.spawn].concat(p.route).concat([p.exitTo]);
    const pts = [];
    for (let i = 1; i < keys.length; i++) {
      const L = SIM.leg(keys[i - 1], keys[i]);
      L.segs.forEach(s => { if (s.sp === 'campus') s.pts.forEach(q => pts.push(new THREE.Vector3(q[0], 0.35, q[1]))); });
    }
    if (pts.length < 2) return;
    routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), MAT.route);
    scene.add(routeLine);
  }

  /* ---------------- KPI / ตาราง ---------------- */
  function renderTop() {
    $('kToday').textContent = fmtN(ov.today);
    $('kTodayS').textContent = 'คน · ตั้งแต่ 06:00';
    $('kInside').textContent = fmtN(ov.inside);
    $('kInsideS').textContent = 'คน · รับยาแล้ว ' + fmtN(ov.done) + ' คน';
    const as = M.status(ov.avgTotal, KPI.total);
    $('kAvg').textContent = fmtN(ov.avgTotal);
    $('kAvgS').textContent = 'นาที · KPI ' + KPI.total + ' นาที';
    $('kAvg').parentNode.style.setProperty('--kc', 'var(' + STV[as] + ')');
    $('kPass').textContent = ov.passPct == null ? '–' : Math.round(ov.passPct) + '%';
    $('kPassS').textContent = 'ของผู้ที่รับยาแล้ว (≤ ' + KPI.total + ' นาที)';
    const ps = ov.passPct == null ? 'none' : ov.passPct >= 80 ? 'ok' : ov.passPct >= 60 ? 'warn' : 'bad';
    $('kPass').parentNode.style.setProperty('--kc', 'var(' + STV[ps] + ')');
    const w = ov.worst;
    $('kWorst').textContent = w ? ST[w.id].name : '–';
    $('kWorstS').textContent = w ? 'เฉลี่ย ' + fmtN(w.avg) + ' นาที (KPI ' + w.kpi + ') · รอ ' + w.n + ' คน' : '';
    $('kWorstBox').style.setProperty('--kc', 'var(' + STV[w ? w.status : 'none'] + ')');
    $('kWorstBox').onclick = w ? () => goStation(w.id) : null;
    $('kWorstBox').style.cursor = w ? 'pointer' : '';
  }
  function renderTable() {
    const rows = Object.values(stats).sort((a, b) => (b.ratio == null ? -1 : b.ratio) - (a.ratio == null ? -1 : a.ratio));
    $('tbody').innerHTML = rows.map(s => {
      const st = ST[s.id], r = s.ratio;
      return '<tr data-st="' + s.id + '" tabindex="0"><td class="nm"><span class="stripe" style="--sc:var(' + STV[s.status] + ')"></span>' + esc(st.name) + '</td>' +
        '<td>' + esc(locName(st.b, st.f)) + '</td><td>' + st.dep + ' <span class="guess">เดา</span></td>' +
        '<td class="num">' + s.n + '</td><td class="num">' + fmtN(s.avg) + '</td><td class="num">' + (s.n ? Math.round(s.maxW) : '–') + '</td><td class="num">' + s.kpi + '</td>' +
        '<td><div class="ratio"><div class="bar" style="--bc:var(' + STV[s.status] + ');--kp:66.7%"><i style="width:' + (r == null ? 0 : Math.min(100, r / 1.5 * 100)) + '%"></i></div><span>' + (r == null ? '–' : Math.round(r * 100) + '%') + '</span></div></td>' +
        '<td class="num">' + s.served + '</td></tr>';
    }).join('');
  }
  $('tbody').addEventListener('click', e => { const tr = e.target.closest('tr'); if (tr) goStation(tr.dataset.st); });
  $('tbody').addEventListener('keydown', e => { if (e.key === 'Enter') { const tr = e.target.closest('tr'); if (tr) goStation(tr.dataset.st); } });
  function goStation(id) { openStation(id); $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  function renderAssume() {
    const svc = CAMPUS_BUILDINGS.filter(b => b.svc);
    $('assumeList').innerHTML =
      '<h3>ตำแหน่งและอาคาร</h3><ul>' +
      '<li>อาคารบนภาพรวมลอกจากภาพถ่ายดาวเทียมที่ส่งมา ขนาดและความสูงเป็นการประมาณ</li>' +
      svc.map(b => '<li><b>' + esc(b.short) + '</b> <span class="guess">เดา</span> — ' + esc(b.note) + '</li>').join('') +
      '<li>อาคารศูนย์บริการการแพทย์ชั้นเลิศแสดงเป็นโครงก่อสร้าง ยังไม่ใช้เป็นจุดบริการ</li></ul>' +
      '<h3>ผังภายในและรหัสแผนก</h3><ul>' +
      '<li>ผังภายในทุกชั้นวาดขึ้นเอง ยังไม่ได้ลอกจากผังจริง ต้องการภาพผังแต่ละอาคาร/ชั้น</li>' +
      '<li>depcode ทุกจุดเป็นตัวเลขสมมติ ต้องการผลจาก <code>kskdepartment</code> (depcode, department) และการจับคู่ห้องในผัง เช่น ห้องตรวจ 3 = 005</li>' +
      '<li>KPI เวลารอตั้งต้นที่ ' + D.PHASES.map(p => p.name + ' ' + D.KPI_DEFAULT[p.id]).join(', ') + ', รวม ' + D.KPI_DEFAULT.total + ' นาที แก้ได้ที่ "ตั้งค่า KPI"</li>' +
      '<li>สัดส่วนผู้ป่วยแต่ละคลินิก โอกาสส่ง Lab/X-ray และจำนวนช่องบริการ เป็นค่าสมมติเพื่อให้เห็นภาพ</li></ul>';
    const rows = [];
    Object.keys(PLANS).forEach(b => PLANS[b].floors.forEach((rooms, f) => rooms.forEach(r => {
      if (!r.st) return;
      const st = ST[r.st];
      rows.push('<tr><td>' + esc(r.n) + (r.cub ? ' <span class="muted">(ห้อง 1–' + r.cub + ')</span>' : '') + '</td><td>' + esc(locName(b, f)) + '</td><td>' + st.dep + ' <span class="guess">เดา</span></td><td class="num">' + st.c + '</td></tr>');
    })));
    $('mapBody').innerHTML = rows.join('');
  }

  /* ---------------- ตั้งค่า KPI ---------------- */
  const kpiFields = D.PHASES.map(p => [p.id, p.name]).concat([['total', 'รวมทั้งหมด']]);
  function openKpi() {
    $('kpiGrid').innerHTML = kpiFields.map(([id, n]) => '<label for="kpi-' + id + '">' + n + '<input id="kpi-' + id + '" type="number" min="1" max="600" step="1" value="' + KPI[id] + '"></label>').join('');
    $('kpiModal').hidden = false;
    $('kpi-reg').focus();
  }
  function closeKpi() { $('kpiModal').hidden = true; }
  $('kpiBtn').onclick = openKpi;
  $('kpiModal').addEventListener('click', e => { if (e.target === $('kpiModal')) closeKpi(); });
  $('kpiForm').addEventListener('submit', e => {
    e.preventDefault();
    kpiFields.forEach(([id]) => { const v = +$('kpi-' + id).value; if (v > 0) KPI[id] = v; });
    store.set('kq-kpi', KPI); closeKpi(); tick(true); renderAssume();
  });
  $('kpiReset').onclick = () => { kpiFields.forEach(([id]) => { $('kpi-' + id).value = D.KPI_DEFAULT[id]; }); };

  /* ---------------- เวลา ---------------- */
  const playBtn = $('playBtn');
  function setPlaying(v) {
    playing = v;
    $('playIcon').setAttribute('d', v ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z');
    playBtn.setAttribute('aria-label', v ? 'หยุดชั่วคราว' : 'เล่นต่อ');
  }
  playBtn.onclick = () => { if (!playing && T >= 990) T = 630; setPlaying(!playing); };
  document.querySelectorAll('[data-speed]').forEach(b => {
    b.onclick = () => { speed = +b.dataset.speed; document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b)); };
  });
  let scrubbing = false;
  const scrub = $('scrub');
  scrub.addEventListener('input', () => { scrubbing = true; T = +scrub.value; tick(true); });
  scrub.addEventListener('change', () => { scrubbing = false; });
  $('themeBtn').onclick = () => {
    themeMode = isDark() ? 'light' : 'dark';
    store.set('kq-theme', themeMode); applyThemeAttr(); applyTheme();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeMode === 'system') applyTheme(); });

  /* ---------------- รอบอัปเดต ---------------- */
  let lastTick = 0;
  function tick(force) {
    const now = performance.now();
    if (!force && now - lastTick < 450) return;
    lastTick = now;
    stats = M.stationStats(BY, T, KPI);
    ov = M.overall(PATS, stats, T, KPI);
    $('clockOut').textContent = fmtT(T);
    if (!scrubbing) scrub.value = Math.floor(T);
    renderTop(); renderTable();
    labels.forEach(L => { if (L.st) L.el.innerHTML = stationLabelHTML(L.st); else if (L.bld) L.el.innerHTML = bldLabelHTML(L.bld); });
    labels.forEach(L => L.el.classList.toggle('sel', sel.type === 'st' && L.st === sel.id));
    if (view.mode === 'bld') {
      const fl = C('--sc-floor');
      Object.keys(roomMat).forEach(id => { const s = stats[id]; roomMat[id].color.copy(fl).lerp(C(STV[s.status] === '--muted' ? '--sc-floor' : STV[s.status]), s.status === 'none' ? 0 : 0.42); });
      Object.keys(areaMat).forEach(id => { const s = stats[id]; areaMat[id].color.copy(fl).lerp(C(STV[s.status] === '--muted' ? '--sc-floor' : STV[s.status]), s.status === 'none' ? 0 : 0.22); });
      renderFloors();
    } else {
      Object.keys(halo).forEach(b => { const a = bldAgg(b); halo[b].color.set(TK[a.status === 'none' ? '--sc-ground' : STV[a.status]]); });
    }
    renderPanel(false);
  }
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing && !scrubbing) {
      T = Math.min(990, T + dt * speed / 60);
      if (T >= 990) setPlaying(false);
    }
    stepRig(dt);
    updateCam();
    updatePeople(now);
    placeLabels();
    tick(false);
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  }

  /* ---------------- เริ่ม ---------------- */
  readTokens();
  renderAssume();
  resize();
  const start = () => { applyTheme(); setView('campus'); requestAnimationFrame(loop); };
  if (document.fonts && document.fonts.load) Promise.race([document.fonts.load('600 16px "IBM Plex Sans Thai"'), new Promise(r => setTimeout(r, 1500))]).then(start, start);
  else start();
})();
