/* ================================================================
   คำนวณตัวชี้วัด ณ เวลา T — ใช้ได้ทั้งข้อมูลจำลองและข้อมูลจริงจาก HIS
   step = { st, arrive, start|null, end|null, ia, ie, stale }
     เวลารอ        = start − arrive   (ไม่นับเมื่อไม่มี start หรือ ia = 2)
     เวลาให้บริการ = end − start
   ================================================================ */
(function (G) {
  'use strict';
  const { ST } = G.KQ_DATA;
  let WARN = 0.8;

  /* สถานะเทียบ KPI: ≤ WARN×KPI = ผ่าน, ถึง 100% = ใกล้เกิน, เกิน = แดง */
  function status(v, kpi) {
    if (v == null || !kpi) return 'none';
    const r = v / kpi;
    return r <= WARN ? 'ok' : r <= 1 ? 'warn' : 'bad';
  }
  const measurable = s => s.start != null && s.ia !== 2;
  const isWaiting = (s, T) => !s.stale && s.arrive <= T && (s.start == null || s.start > T) && (s.end == null || s.end > T);

  function indexSteps(pats) {
    const by = {};
    Object.keys(ST).forEach(k => { by[k] = []; });
    pats.forEach(p => p.steps.forEach((s, i) => { if (s.st && by[s.st]) by[s.st].push({ p, s, i }); }));
    Object.values(by).forEach(a => a.sort((x, y) => x.s.arrive - y.s.arrive));
    return by;
  }

  function stationStats(by, T, kpi) {
    const out = {};
    Object.keys(by).forEach(id => {
      const st = ST[id], k = kpi[st.phase];
      const waiting = [];
      let served = 0, inSvc = 0, sumH = 0, nH = 0, maxW = 0, fin = 0, full = 0, noStart = 0, stale = 0, sumP = 0, nP = 0;
      for (const e of by[id]) {
        const s = e.s;
        if (s.arrive > T) break;
        if (s.stale) { stale++; continue; }
        if (isWaiting(s, T)) { waiting.push(e); maxW = Math.max(maxW, T - s.arrive); continue; }
        served++;
        const ended = s.end != null && s.end <= T;
        if (!ended) inSvc++;
        else {
          fin++;                                                   // นับคุณภาพการบันทึกเฉพาะคนที่เสร็จจุดนี้แล้ว
          if (s.start == null) noStart++;
          if (s.start != null && !s.ia && !s.ie) full++;
          if (s.ia !== 2 && !s.ie && s.end >= T - 60) { sumP += s.end - s.arrive; nP++; }
        }
        if (measurable(s) && s.start >= T - 60) { sumH += s.start - s.arrive; nH++; }
      }
      const noTimes = fin > 0 && noStart / fin > 0.9 && nH < 3;   // จุดนี้แทบไม่บันทึกเวลาเรียก
      let avg = null, basis = 'hour';
      if (nH >= 3) avg = sumH / nH;
      else if (noTimes && nP >= 3) { avg = sumP / nP; basis = 'proxy'; }   // ≈ เวลาอยู่ที่จุด (เข้า→ออก)
      else if (waiting.length && !noTimes) { avg = waiting.reduce((a, e) => a + (T - e.s.arrive), 0) / waiting.length; basis = 'now'; }
      out[id] = { id, waiting, n: waiting.length, served, inSvc, avg, basis, maxW, kpi: k, ratio: avg != null ? avg / k : null,
        status: status(avg, k), fin, cov: fin ? full / fin : null, noStart, noTimes, stale };
    });
    return out;
  }

  /* กราฟทุก 15 นาที: เฉลี่ยเวลารอของผู้ที่เริ่มรับบริการในช่วงนั้น + จำนวนรอ ณ ปลายช่วง */
  function series15(by, id, T, from, proxy) {
    from = from || 390;
    const bins = [];
    for (let t = from; t < T; t += 15) bins.push({ t, sum: 0, n: 0, q: 0 });
    for (const e of by[id]) {
      const s = e.s;
      if (s.stale) continue;
      if (!proxy && measurable(s) && s.start < T && s.start >= from) {
        const b = bins[Math.floor((s.start - from) / 15)];
        if (b) { b.sum += s.start - s.arrive; b.n++; }
      }
      if (proxy && s.end != null && s.end < T && s.end >= from && s.ia !== 2 && !s.ie) {
        const b = bins[Math.floor((s.end - from) / 15)];
        if (b) { b.sum += s.end - s.arrive; b.n++; }
      }
      for (const b of bins) { const tt = Math.min(b.t + 15, T); if (isWaiting(s, tt)) b.q++; }
    }
    return bins.map(b => ({ t: b.t, avg: b.n ? b.sum / b.n : null, q: b.q }));
  }

  function overall(pats, stats, T, kpi) {
    let today = 0, inside = 0, done = 0, sumTot = 0, pass = 0;
    for (const p of pats) {
      if (p.arr == null || p.arr > T) continue;
      today++;
      if (p.done == null || p.done > T) inside++;
      else { done++; const tot = p.done - p.arr; sumTot += tot; if (tot <= kpi.total) pass++; }
    }
    let worst = null;
    Object.values(stats).forEach(s => { if (s.ratio != null && (!worst || s.ratio > worst.ratio)) worst = s; });
    return { today, inside, done, avgTotal: done ? sumTot / done : null, passPct: done ? pass / done * 100 : null, worst };
  }

  G.KQ_METRICS = { status, indexSteps, stationStats, series15, overall, isWaiting, setWarn: r => { WARN = r; } };
})(typeof window !== 'undefined' ? window : globalThis);
