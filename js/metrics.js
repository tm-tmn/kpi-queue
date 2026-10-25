/* ================================================================
   คำนวณตัวชี้วัด ณ เวลา T (ใช้ได้ทั้งข้อมูลจำลองและข้อมูลจริง)
   ================================================================ */
(function (G) {
  'use strict';
  const { ST } = G.KQ_DATA;

  /* สถานะเทียบ KPI: ≤80% = ผ่าน, 80–100% = ใกล้เกิน, >100% = เกิน */
  function status(v, kpi) {
    if (v == null || !kpi) return 'none';
    const r = v / kpi;
    return r <= 0.8 ? 'ok' : r <= 1 ? 'warn' : 'bad';
  }

  function indexSteps(pats) {
    const by = {};
    Object.keys(ST).forEach(k => { by[k] = []; });
    pats.forEach(p => p.steps.forEach((s, i) => by[s.st].push({ p, s, i })));
    Object.values(by).forEach(a => a.sort((x, y) => x.s.arrive - y.s.arrive));
    return by;
  }

  function stationStats(by, T, kpi) {
    const out = {};
    Object.keys(by).forEach(id => {
      const st = ST[id], k = kpi[st.phase];
      const waiting = [];
      let served = 0, inSvc = 0, sumH = 0, nH = 0, maxW = 0;
      for (const e of by[id]) {
        const s = e.s;
        if (s.arrive > T) break;
        if (T < s.start) { waiting.push(e); maxW = Math.max(maxW, T - s.arrive); continue; }
        served++;
        if (T < s.end) inSvc++;
        if (s.start >= T - 60) { sumH += s.start - s.arrive; nH++; }
      }
      let avg = null, basis = 'hour';
      if (nH >= 3) avg = sumH / nH;
      else if (waiting.length) { avg = waiting.reduce((a, e) => a + (T - e.s.arrive), 0) / waiting.length; basis = 'now'; }
      out[id] = { id, waiting, n: waiting.length, served, inSvc, avg, basis, maxW, kpi: k, ratio: avg != null ? avg / k : null, status: status(avg, k) };
    });
    return out;
  }

  /* กราฟทุก 15 นาที: เฉลี่ยเวลารอของผู้ที่เริ่มรับบริการในช่วงนั้น + จำนวนรอ ณ ต้นช่วง */
  function series15(by, id, T, from) {
    from = from || 390;
    const bins = [];
    for (let t = from; t < T; t += 15) bins.push({ t, sum: 0, n: 0, q: 0 });
    for (const e of by[id]) {
      const s = e.s;
      if (s.start < T && s.start >= from) {
        const b = bins[Math.floor((s.start - from) / 15)];
        if (b) { b.sum += s.start - s.arrive; b.n++; }
      }
      bins.forEach(b => { const tt = Math.min(b.t + 15, T); if (s.arrive <= tt && s.start > tt) b.q++; });
    }
    return bins.map(b => ({ t: b.t, avg: b.n ? b.sum / b.n : null, q: b.q }));
  }

  function overall(pats, stats, T, kpi) {
    let today = 0, inside = 0, done = 0, sumTot = 0, pass = 0;
    for (const p of pats) {
      if (p.arr > T) continue;
      today++;
      if (p.done > T) inside++;
      else { done++; sumTot += p.total; if (p.total <= kpi.total) pass++; }
    }
    let worst = null;
    Object.values(stats).forEach(s => { if (s.ratio != null && (!worst || s.ratio > worst.ratio)) worst = s; });
    return { today, inside, done, avgTotal: done ? sumTot / done : null, passPct: done ? pass / done * 100 : null, worst };
  }

  G.KQ_METRICS = { status, indexSteps, stationStats, series15, overall };
})(typeof window !== 'undefined' ? window : globalThis);
