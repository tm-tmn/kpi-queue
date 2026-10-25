/* สร้างฐานข้อมูลทดสอบ (ข้อมูลสังเคราะห์ทั้งหมด ชื่อคอลัมน์สมมติ ไม่ใช่โครงสร้างจริงของ รพ.)
   node tools/testdb/seed.js 2026-10-25 > /tmp/seed.sql && mysql hos_test < /tmp/seed.sql */
const dir = __dirname + '/../../js/';
require(dir + 'data.js'); require(dir + 'sim.js');
const { ST, CLINICS } = KQ_DATA;
const today = process.argv[2] || new Date().toISOString().slice(0, 10);
const out = [];
const P = s => out.push(s);
P(`DROP TABLE IF EXISTS ovst, patient, kskdepartment, opd_dep_queue, service_time, ovst_service_time;
CREATE TABLE ovst (vn VARCHAR(13) PRIMARY KEY, hn VARCHAR(9), vstdate DATE, vsttime TIME, oqueue INT, main_dep CHAR(3), cur_dep CHAR(3), KEY (vstdate));
CREATE TABLE patient (hn VARCHAR(9) PRIMARY KEY, pname VARCHAR(20), fname VARCHAR(80), lname VARCHAR(80));
CREATE TABLE kskdepartment (depcode CHAR(3) PRIMARY KEY, department VARCHAR(150));
CREATE TABLE opd_dep_queue (id INT AUTO_INCREMENT PRIMARY KEY, vn VARCHAR(13), depcode CHAR(3), depq INT, time_in DATETIME NULL, time_call DATETIME NULL, time_out DATETIME NULL, KEY (vn));
CREATE TABLE service_time (vn VARCHAR(13) PRIMARY KEY, vstdate DATE, reg_in TIME, reg_out TIME, pay_in TIME, pay_out TIME, drug_in TIME, drug_call TIME, drug_out TIME);
CREATE TABLE ovst_service_time (id INT AUTO_INCREMENT PRIMARY KEY, vn VARCHAR(13), service_code VARCHAR(5), begin_datetime DATETIME NULL, end_datetime DATETIME NULL, KEY (vn));`);
const deps = [['001', 'ห้องบัตร'], ['080', 'ห้องเจาะเลือด'], ['081', 'รังสีวินิจฉัย'], ['090', 'การเงิน'], ['091', 'ห้องยา OPD'], ['099', 'ศูนย์ส่งต่อ (ไม่ได้อยู่ในผัง)']];
CLINICS.forEach(c => { deps.push([c.scr[2], 'ซักประวัติ' + c.name]); deps.push([c.doc[2], 'OPD ' + c.name]); });
P('INSERT INTO kskdepartment VALUES ' + deps.map(d => `('${d[0]}','${d[1]}')`).join(',') + ';');
const pad = n => String(n).padStart(2, '0');
const tm = m => `${pad(Math.floor(m / 60))}:${pad(Math.floor(m % 60))}:${pad(Math.floor((m * 60) % 60))}`;
let rnd = 99; const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
for (let d = 7; d >= 0; d--) {
  const dt = new Date(today + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - d);
  const ds = dt.toISOString().slice(0, 10);
  const pats = KQ_SIM.runSim(2026 + d);
  const ov = [], pt = [], q = [], st = [], ost = [];
  const qn = {};
  pats.forEach((p, i) => {
    const vn = ds.replace(/-/g, '').slice(2) + String(i).padStart(5, '0');
    const dtm = m => `'${ds} ${tm(m)}'`;
    const S = {}; p.steps.forEach(s => { S[s.st] = s; });
    ov.push(`('${vn}','${p.hn}','${ds}','${tm(p.arr)}',${i + 1},'${ST['DOC_' + p.clinic].dep}','${ST[p.steps[p.steps.length - 1].st].dep}')`);
    if (d === 0) pt.push(`('${p.hn}','นาย','ทดสอบ${i}','สมมติ')`);
    p.steps.forEach(s => {
      const id = s.st, dep = ST[id].dep;
      if (id.startsWith('SCR_') || id.startsWith('DOC_')) {
        qn[dep] = (qn[dep] || 0) + 1;
        const call = id.startsWith('SCR_') && r() < 0.3 ? 'NULL' : dtm(s.start);   // ซักประวัติไม่กดเรียก 30%
        const fin = r() < 0.05 ? 'NULL' : dtm(s.end);                                  // ลืมปิด 5%
        q.push(`('${vn}','${dep}',${qn[dep]},${dtm(s.arrive)},${call},${fin})`);
      }
      if (id === 'LAB') ost.push(`('${vn}','LAB',${dtm(s.start)},${dtm(s.end)})`);    // มีแค่เริ่ม-เสร็จ
      // XRAY: ไม่มีการบันทึกเวลาเลย
    });
    const g = (id, k) => S[id] ? `'${tm(S[id][k])}'` : `'00:00:00'`;
    st.push(`('${vn}','${ds}',${g('REG', 'arrive')},${g('REG', 'end')},${g('FIN', 'arrive')},${g('FIN', 'end')},${g('PHA', 'arrive')},${S.PHA && r() < 0.6 ? g('PHA', 'start') : "'00:00:00'"},${g('PHA', 'end')})`);
  });
  const chunk = (tbl, cols, rows) => { for (let i = 0; i < rows.length; i += 500) P(`INSERT INTO ${tbl} ${cols} VALUES ${rows.slice(i, i + 500).join(',')};`); };
  chunk('ovst', '', ov); chunk('patient', '', pt);
  chunk('opd_dep_queue', '(vn,depcode,depq,time_in,time_call,time_out)', q);
  chunk('service_time', '', st);
  chunk('ovst_service_time', '(vn,service_code,begin_datetime,end_datetime)', ost);
}
console.log(out.join('\n'));
