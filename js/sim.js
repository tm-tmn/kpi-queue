/* ================================================================
   ตัวจำลองผู้ป่วยนอก (ข้อมูลสมมติทั้งหมด)
   - discrete-event, FIFO หลายช่องบริการ, ค่าสุ่มคงที่ (seed) ทุกครั้งที่เปิด
   - แพทย์เริ่มตรวจ 08:30 ผู้ป่วยมามากช่วง 06:00–09:00
   เมื่อต่อข้อมูลจริง: แทน runSim() ด้วยข้อมูลจาก HOSxP (ovst / service time)
   ให้ได้โครงสร้าง patient.steps[] แบบเดียวกัน
   ================================================================ */
(function (G) {
  'use strict';
  const D = G.KQ_DATA;
  const { PX, PLANS, ST, CLINICS, DOORS, SPAWNS, CAMPUS_PATHS_PX } = D;

  const PACE_PLAN = 0.055;   // นาที/หน่วยผัง (ช้ากว่าจริงเพื่อให้เห็นการเดิน)
  const PACE_CAMPUS = 0.11;  // นาที/หน่วยภาพรวม
  const LIFT_MIN = 0.8;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------- เส้นทางเดิน ---------- */
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const plen = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; };
  function corr(b, p, q) {
    const cz = (PLANS[b].corr[0] + PLANS[b].corr[1]) / 2;
    const pts = [p, [p[0], cz], [q[0], cz], q];
    return pts.filter((v, i) => i === 0 || dist(v, pts[i - 1]) > 0.01);
  }
  const campusPaths = {};
  Object.keys(CAMPUS_PATHS_PX).forEach(k => {
    const pts = CAMPUS_PATHS_PX[k].map(p => PX(p[0], p[1]));
    const [a, b] = k.split('>');
    campusPaths[a + '>' + b] = pts;
    campusPaths[b + '>' + a] = pts.slice().reverse();
  });
  function campusPath(a, b) {
    if (campusPaths[a + '>' + b]) return campusPaths[a + '>' + b];
    const p1 = campusPath(a, 'main'), p2 = campusPath('main', b);
    return p1.concat(p2.slice(1));
  }

  function endpoint(key) {
    if (ST[key]) { const s = ST[key]; return { kind: 'st', b: s.b, f: s.f, p: s.door, key }; }
    const sp = SPAWNS.find(s => s.id === key);
    return { kind: 'sp', p: sp.p, key };
  }
  function toExit(b, f, p) {
    const P = PLANS[b];
    if (f === 0) return [{ sp: 'plan', b, f: 0, pts: corr(b, p, P.exit) }];
    return [{ sp: 'plan', b, f, pts: corr(b, p, P.lift) }, { sp: 'lift', b }, { sp: 'plan', b, f: 0, pts: corr(b, P.lift, P.exit) }];
  }
  function fromExit(b, f, p) {
    return toExit(b, f, p).reverse().map(s => s.pts ? Object.assign({}, s, { pts: s.pts.slice().reverse() }) : s);
  }
  const legCache = {};
  function leg(aKey, bKey) {
    const ck = aKey + '>' + bKey;
    if (legCache[ck]) return legCache[ck];
    const A = endpoint(aKey), B = endpoint(bKey);
    let segs = [];
    if (A.kind === 'st' && B.kind === 'st' && A.b === B.b) {
      if (A.f === B.f) segs.push({ sp: 'plan', b: A.b, f: A.f, pts: corr(A.b, A.p, B.p) });
      else {
        const L = PLANS[A.b].lift;
        segs.push({ sp: 'plan', b: A.b, f: A.f, pts: corr(A.b, A.p, L) }, { sp: 'lift', b: A.b }, { sp: 'plan', b: A.b, f: B.f, pts: corr(A.b, L, B.p) });
      }
    } else {
      if (A.kind === 'st') segs = segs.concat(toExit(A.b, A.f, A.p));
      const ca = A.kind === 'st' ? A.b : A.key, cb = B.kind === 'st' ? B.b : B.key;
      segs.push({ sp: 'campus', pts: campusPath(ca, cb) });
      if (B.kind === 'st') segs = segs.concat(fromExit(B.b, B.f, B.p));
    }
    let t = 0;
    segs.forEach(s => {
      s.len = s.pts ? plen(s.pts) : 0;
      s.dur = s.sp === 'lift' ? LIFT_MIN : s.len * (s.sp === 'campus' ? PACE_CAMPUS : PACE_PLAN);
      s.t0 = t; t += s.dur; s.t1 = t;
    });
    const L = { segs, dur: Math.max(0.3, t) };
    legCache[ck] = L;
    return L;
  }
  /* ตำแหน่งตามเวลาที่เดินไปแล้ว → {sp, b, f, x, z} */
  function legPos(L, el) {
    let s = L.segs.find(s => el < s.t1) || L.segs[L.segs.length - 1];
    if (s.sp === 'lift') return { sp: 'lift', b: s.b };
    const u = s.dur > 0 ? Math.min(1, Math.max(0, (el - s.t0) / s.dur)) : 1;
    let d = u * s.len;
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1], b = s.pts[i], l = dist(a, b);
      if (d <= l || i === s.pts.length - 1) {
        const k = l ? Math.min(1, d / l) : 1;
        return { sp: s.sp, b: s.b, f: s.f, x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k };
      }
      d -= l;
    }
  }

  /* ---------- heap ---------- */
  function Heap() { this.a = []; }
  Heap.prototype.push = function (x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].t <= x.t) break; a[i] = a[p]; i = p; } a[i] = x; };
  Heap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop(), n = a.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = -1, mt = last.t;
        if (l < n && a[l].t < mt) { m = l; mt = a[l].t; }
        if (r < n && a[r].t < mt) { m = r; }
        if (m < 0) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  };

  /* ---------- จำลองทั้งวัน ---------- */
  // จำนวนผู้ป่วยมาถึงต่อชั่วโมง (เริ่ม 06:00) — สมมติ
  const HOURLY = [[360, 450], [420, 650], [480, 600], [540, 420], [600, 300], [660, 180], [720, 80], [780, 200], [840, 150], [900, 60]];

  function runSim(seed) {
    const rnd = mulberry32(seed || 2026);
    const norm = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const svc = s => Math.max(0.3, s * Math.exp(0.45 * norm() - 0.1));
    const pickClinic = () => { let r = rnd(), acc = 0; for (const c of CLINICS) { acc += c.share; if (r < acc) return c; } return CLINICS[0]; };
    const pickSpawn = () => { let r = rnd(), acc = 0; for (const s of SPAWNS) { acc += s.w; if (r < acc) return s.id; } return SPAWNS[0].id; };

    const pats = [];
    const usedHN = new Set();
    HOURLY.forEach(([h, n]) => {
      for (let i = 0; i < n; i++) {
        const c = pickClinic();
        const route = ['REG'];
        if (rnd() < c.lab) route.push('LAB');
        route.push('SCR_' + c.id);
        if (rnd() < c.xpre) route.push('XRAY');
        route.push('DOC_' + c.id);
        if (rnd() < c.xpost) route.push('XRAY');
        if (rnd() < 0.86) route.push('FIN');
        if (rnd() < 0.93) route.push('PHA');
        let hn; do { hn = String(4000000 + Math.floor(rnd() * 5999999)); } while (usedHN.has(hn)); usedHN.add(hn);
        const spawn = pickSpawn(), exitTo = rnd() < 0.5 ? spawn : pickSpawn();
        const regArr = h + rnd() * 60;
        const l0 = leg(spawn, 'REG');
        pats.push({ id: pats.length, hn, clinic: c.id, appt: rnd() < 0.55, route, spawn, exitTo, appear: regArr - l0.dur, steps: [] });
      }
    });

    const free = {};
    Object.keys(ST).forEach(k => { free[k] = new Array(ST[k].c).fill(0); });
    const H = new Heap();
    pats.forEach(p => H.push({ t: p.appear + leg(p.spawn, 'REG').dur, p, i: 0 }));
    while (H.a.length) {
      const e = H.pop(), p = e.p, sid = p.route[e.i], s = ST[sid], fr = free[sid];
      let k = 0; for (let j = 1; j < fr.length; j++) if (fr[j] < fr[k]) k = j;
      const start = Math.max(e.t, s.open, fr[k]);
      const end = start + svc(s.s);
      fr[k] = end;
      p.steps.push({ st: sid, arrive: e.t, start, end, srv: k });
      if (e.i + 1 < p.route.length) H.push({ t: end + leg(sid, p.route[e.i + 1]).dur, p, i: e.i + 1 });
      else { p.done = end; p.gone = end + leg(sid, p.exitTo).dur; }
    }
    pats.forEach(p => { p.arr = p.steps[0].arrive; p.total = p.done - p.arr; });
    return pats;
  }

  /* สถานะผู้ป่วย ณ เวลา T */
  function stateAt(p, T) {
    if (T < p.appear || T >= p.gone) return null;
    const S = p.steps;
    if (T < S[0].arrive) return { kind: 'walk', L: leg(p.spawn, 'REG'), el: T - p.appear, i: -1 };
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (T < s.start) return { kind: 'wait', i, st: s.st, since: s.arrive };
      if (T < s.end) return { kind: 'serve', i, st: s.st, srv: s.srv };
      const nx = S[i + 1];
      if (nx && T < nx.arrive) return { kind: 'walk', L: leg(s.st, nx.st), el: T - s.end, i, to: nx.st };
    }
    return { kind: 'walk', L: leg(S[S.length - 1].st, p.exitTo), el: T - p.done, i: S.length, out: true };
  }

  G.KQ_SIM = { runSim, stateAt, legPos, leg, campusPath };
})(typeof window !== 'undefined' ? window : globalThis);
