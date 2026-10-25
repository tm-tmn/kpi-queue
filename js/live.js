/* ================================================================
   ข้อมูลจริงจาก HIS: ดึง api/live.php ทุก poll_seconds แล้วแปลงเป็นโครงสร้างเดียวกับตัวจำลอง
   ================================================================ */
(function (G) {
  'use strict';
  const { ST } = G.KQ_DATA;

  async function getJSON(url, opt) {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opt || {}));
    let d = null;
    try { d = await r.json(); } catch (e) { /* ไม่ใช่ JSON = ไม่มี PHP */ }
    if (!r.ok || !d) { const err = new Error((d && d.error) || 'HTTP ' + r.status); err.status = r.status; err.body = d; throw err; }
    return d;
  }

  /* แปลง snapshot → visits (step: arrive/start/end เป็นนาทีนับจาก 00:00) */
  function adapt(d) {
    const visits = d.visits.map((v, i) => {
      const steps = v.steps.map(s => ({
        st: s.st && ST[s.st] ? s.st : null, dep: s.dep, q: s.q || null,
        arrive: s.a, start: s.s == null ? null : s.s, end: s.e == null ? null : s.e,
        ia: s.ia || 0, ie: s.ie || 0, stale: s.stale || 0,
      }));
      return { id: i, ref: v.id, hn: v.hn4, q: v.q, clinic: v.clinic, arr: v.arr, done: v.done, di: v.di, steps, route: steps.map(s => s.st), live: true };
    });
    return { visits, now: d.now, generated: d.generated, deps: d.deps || {}, warnings: d.warnings || [], unmapped: d.unmapped || {}, sources: d.sources || [], staleCache: !!d.stale_cache };
  }

  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

  /* สถานะ ณ เวลา T  (between = เสร็จจุดล่าสุดแล้ว ยังไม่เข้าจุดถัดไป: ไม่ทราบตำแหน่ง จึงไม่วาด) */
  function stateAt(v, T) {
    if (v.arr == null || v.arr > T || (v.done != null && v.done <= T)) return null;
    let cur = -1;
    for (let i = 0; i < v.steps.length; i++) if (v.steps[i].arrive <= T) cur = i;
    if (cur < 0) return null;
    const s = v.steps[cur];
    if (!s.st) return { kind: 'between', i: cur };
    if (s.stale) return { kind: 'stale', i: cur, st: s.st, since: s.arrive };
    if (s.end != null && s.end <= T) return { kind: 'between', i: cur, st: s.st };
    if (s.start != null && s.start <= T) return { kind: 'serve', i: cur, st: s.st, srv: hash(v.ref) % ST[s.st].srv.length };
    return { kind: 'wait', i: cur, st: s.st, since: s.arrive };
  }

  G.KQ_LIVE = { getJSON, adapt, stateAt };
})(window);
