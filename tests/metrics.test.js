/* node tests/metrics.test.js — ทดสอบกฎคำนวณเวลารอ และกรณีไม่ได้บันทึกเวลา */
const assert = require('assert');
const dir = __dirname + '/../js/';
global.window = global;
require(dir + 'data.js'); require(dir + 'sim.js'); require(dir + 'metrics.js');
// live.js ใช้ fetch ตอนเรียกเท่านั้น โหลดได้
require(dir + 'live.js');
const M = KQ_METRICS, LV = KQ_LIVE, KPI = KQ_DATA.KPI_DEFAULT;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

const v = (id, steps, extra) => Object.assign({ id, ref: 'r' + id, hn: '1234', arr: steps[0].arrive, done: null, steps, live: true }, extra || {});
const st = (stId, a, s, e, f) => Object.assign({ st: stId, dep: 'x', arrive: a, start: s, end: e, ia: 0, ie: 0, stale: 0 }, f || {});

t('เวลารอ = เรียก − เข้าคิว เฉลี่ย 60 นาทีล่าสุด', () => {
  const P = [600, 605, 610].map((a, i) => v(i, [st('DOC_MED', a, a + 20, a + 25)]));
  const S = M.stationStats(M.indexSteps(P), 640, KPI).DOC_MED;
  assert.strictEqual(S.avg, 20); assert.strictEqual(S.basis, 'hour'); assert.strictEqual(S.served, 3); assert.strictEqual(S.n, 0);
});
t('ผู้ที่ยังรอ ไม่ถูกนับว่า "ไม่มีเวลาเรียก" และไม่ลดสัดส่วนบันทึกครบ', () => {
  const P = [v(0, [st('DOC_MED', 600, 610, 615)]), v(1, [st('DOC_MED', 620, null, null)])];
  const S = M.stationStats(M.indexSteps(P), 630, KPI).DOC_MED;
  assert.strictEqual(S.n, 1); assert.strictEqual(S.noStart, 0); assert.strictEqual(S.cov, 1);
});
t('เสร็จแล้วแต่ไม่มีเวลาเรียก: นับรับบริการ ไม่นับในค่าเฉลี่ย', () => {
  const P = [600, 601, 602].map((a, i) => v(i, [st('DOC_MED', a, a + 30, a + 31)])).concat([v(9, [st('DOC_MED', 600, null, 630)])]);
  const S = M.stationStats(M.indexSteps(P), 640, KPI).DOC_MED;
  assert.strictEqual(S.avg, 30); assert.strictEqual(S.noStart, 1); assert.strictEqual(S.served, 4);
});
t('จุดที่ไม่บันทึกเวลาเรียกเลย → ใช้เวลาอยู่ที่จุด (≈ ออก − เข้า)', () => {
  const P = [600, 605, 610, 615].map((a, i) => v(i, [st('REG', a, null, a + 6)]));
  const S = M.stationStats(M.indexSteps(P), 640, KPI).REG;
  assert.strictEqual(S.noTimes, true); assert.strictEqual(S.basis, 'proxy'); assert.strictEqual(S.avg, 6);
  const ser = M.series15(M.indexSteps(P), 'REG', 640, 600, true);
  assert.ok(ser.some(b => b.avg === 6));
});
t('ค้างในระบบ ไม่นับเป็นผู้รอ', () => {
  const P = [v(0, [st('LAB', 400, null, null, { stale: 1 })]), v(1, [st('LAB', 620, null, null)])];
  const S = M.stationStats(M.indexSteps(P), 640, KPI).LAB;
  assert.strictEqual(S.n, 1); assert.strictEqual(S.stale, 1);
});
t('ไม่ทราบเวลาเข้าคิว (ia=2) ไม่นับในค่าเฉลี่ย', () => {
  const P = [600, 601, 602].map((a, i) => v(i, [st('FIN', a, a + 10, a + 12)])).concat([v(5, [st('FIN', 620, 620, 625, { ia: 2 })])]);
  const S = M.stationStats(M.indexSteps(P), 640, KPI).FIN;
  assert.strictEqual(S.avg, 10);
});
t('ห้องที่ไม่ได้จับคู่ (st=null) ไม่ทำให้พัง', () => {
  const P = [v(0, [st(null, 600, 601, 602), st('PHA', 603, 610, 612)])];
  const S = M.stationStats(M.indexSteps(P), 640, KPI);
  assert.strictEqual(S.PHA.served, 1);
});
t('สถานะ live: รอ / รับบริการ / ระหว่างจุด / กลับแล้ว', () => {
  const p = v(0, [st('SCR_MED', 600, 605, 610), st('DOC_MED', 612, 650, null)]);
  assert.strictEqual(LV.stateAt(p, 602).kind, 'wait');
  assert.strictEqual(LV.stateAt(p, 607).kind, 'serve');
  assert.strictEqual(LV.stateAt(p, 611).kind, 'between');
  assert.strictEqual(LV.stateAt(p, 620).kind, 'wait');
  assert.strictEqual(LV.stateAt(p, 655).kind, 'serve');
  p.done = 660; assert.strictEqual(LV.stateAt(p, 661), null);
  assert.strictEqual(LV.stateAt(p, 500), null);
});
t('overall: เวลารวม และ % ผ่าน KPI', () => {
  const P = [v(0, [st('PHA', 600, 610, 700)], { arr: 500, done: 700 }), v(1, [st('PHA', 600, 610, 650)], { arr: 600, done: 650 }), v(2, [st('DOC_MED', 630, null, null)])];
  const o = M.overall(P, M.stationStats(M.indexSteps(P), 720, KPI), 720, KPI);
  assert.strictEqual(o.today, 3); assert.strictEqual(o.inside, 1); assert.strictEqual(o.done, 2);
  assert.strictEqual(o.avgTotal, 125); assert.strictEqual(o.passPct, 50);
});
t('เกณฑ์สีปรับได้', () => {
  assert.strictEqual(M.status(50, 60), 'warn'); M.setWarn(0.9); assert.strictEqual(M.status(50, 60), 'ok'); M.setWarn(0.8);
  assert.strictEqual(M.status(61, 60), 'bad'); assert.strictEqual(M.status(null, 60), 'none');
});
t('ตัวจำลอง: ทุกคนมีเส้นทางเรียงเวลา และเวลารอไม่ติดลบ', () => {
  const P = KQ_SIM.runSim(2026);
  P.forEach(p => p.steps.forEach((s, i) => {
    assert.ok(s.start >= s.arrive - 1e-9 && s.end >= s.start, 'order');
    if (i) assert.ok(s.arrive >= p.steps[i - 1].end - 1e-9, 'sequence');
  }));
});
console.log(n + ' tests passed');
