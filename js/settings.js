/* ================================================================
   หน้าตั้งค่า: KPI, จับคู่ห้อง ↔ รหัสแผนก, ตาราง/คอลัมน์เวลา, ตรวจตาราง (นับเท่านั้น)
   ================================================================ */
(function () {
  'use strict';
  const D = window.KQ_DATA, LV = window.KQ_LIVE;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PHASE_NAME = {}; D.PHASES.forEach(p => { PHASE_NAME[p.id] = p.name; });
  const BNAME = {}; D.CAMPUS_BUILDINGS.forEach(b => { BNAME[b.id] = b.short; });
  const TIME_T = ['datetime', 'timestamp', 'time', 'timestamp without time zone', 'timestamp with time zone', 'time without time zone'];

  let AUTH = null, S = null, COLS = {}, DEPS = {}, CHECK = null, dirty = false;

  /* ---------------- ทั่วไป ---------------- */
  const api = (url, body) => LV.getJSON(url, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': (AUTH && AUTH.csrf) || '' }, body: JSON.stringify(body),
  });
  function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, path, v) {
    const ks = path.split('.'), last = ks.pop();
    const t = ks.reduce((a, k) => a[k], o);
    t[last] = v;
  }
  function markDirty() {
    dirty = true;
    $('saveBar').classList.add('dirty');
    $('saveMsg').textContent = 'มีการเปลี่ยนแปลงที่ยังไม่บันทึก';
  }
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  document.addEventListener('input', e => {
    const el = e.target, k = el.dataset && el.dataset.k;
    if (!k || !S) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = el.value === '' ? '' : +el.value;
    if (el.dataset.kind === 'deps') {
      v = el.value.split(/[\s,]+/).filter(Boolean);
      const box = el.parentNode.querySelector('.dep-names');
      if (box) box.innerHTML = depNames(v);
    }
    setPath(S, k, v);
    markDirty();
    if (el.dataset.rerender) renderSource();
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.table === '1') loadTable(el.value.trim()).then(renderSource);
  });

  /* ---------------- เข้าสู่ระบบ ---------------- */
  async function init() {
    try { AUTH = await LV.getJSON('api/auth.php'); }
    catch (e) {
      $('loginCard').hidden = false;
      $('loginForm').hidden = true;
      $('loginNote').textContent = e.status === 503 ? e.message : 'หน้านี้ต้องเปิดผ่านเว็บเซิร์ฟเวอร์ที่มี PHP (โฟลเดอร์ api/) จึงจะบันทึกค่าได้';
      return;
    }
    if (!AUTH.configured) {
      $('loginCard').hidden = false; $('loginForm').hidden = true;
      $('loginNote').innerHTML = 'ยังไม่ได้ตั้งรหัสผ่านผู้ดูแล ให้ใส่ <code>admin_password_hash</code> ใน api/config.php ก่อน';
      return;
    }
    if (!AUTH.admin) { $('loginCard').hidden = false; $('user').hidden = !AUTH.needs_username; (AUTH.needs_username ? $('user') : $('pw')).focus(); return; }
    await loadAll();
  }
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginErr').hidden = true;
    try { AUTH = await api('api/auth.php', { username: $('user').value.trim(), password: $('pw').value }); $('pw').value = ''; $('loginCard').hidden = true; await loadAll(); }
    catch (err) { $('loginErr').textContent = err.message; $('loginErr').hidden = false; }
  });
  $('logoutBtn').onclick = async () => { await api('api/auth.php', { action: 'logout' }).catch(() => {}); dirty = false; location.reload(); };

  async function loadAll() {
    $('logoutBtn').hidden = false;
    S = await LV.getJSON('api/settings.php');
    try { COLS = (await LV.getJSON('api/schema.php')).columns || {}; } catch (e) { COLS = {}; }
    try { (await LV.getJSON('api/departments.php')).forEach(d => { DEPS[d.depcode] = d.department; }); } catch (e) { /* ไม่มีสิทธิ์อ่าน kskdepartment */ }
    $('depList').innerHTML = Object.keys(DEPS).map(c => '<option value="' + esc(c) + '">' + esc(DEPS[c]) + '</option>').join('');
    $('appArea').hidden = false; $('saveBar').hidden = false;
    renderKpi(); renderMap(); renderSource();
    if (S.updated_at) $('saveMsg').textContent = 'บันทึกล่าสุด ' + new Date(S.updated_at).toLocaleString('th-TH');
  }
  async function loadTable(t) {
    if (!t || COLS[t] !== undefined || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(t)) return;
    try { Object.assign(COLS, (await LV.getJSON('api/schema.php?table=' + encodeURIComponent(t))).columns || {}); } catch (e) { COLS[t] = []; }
  }

  /* ---------------- KPI ---------------- */
  function num(path, label, min, max, step, hint) {
    return '<label class="field">' + esc(label) + '<input type="number" data-k="' + path + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + esc(getPath(S, path)) + '">' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  }
  function renderKpi() {
    $('kpiFields').innerHTML = D.PHASES.map(p => num('kpi.' + p.id, p.name, 1, 600)).join('') + num('kpi.total', 'รวมทั้งหมด', 1, 600);
    $('thFields').innerHTML =
      num('thresholds.warn_ratio', 'เริ่มเป็นสีเหลืองที่สัดส่วนของ KPI', 0.5, 0.99, 0.05, 'เช่น 0.8 = 80%') +
      num('thresholds.stale_minutes', 'ถือว่า "ค้างในระบบ" เมื่อรอเกิน (นาที)', 30, 720, 1, 'ไม่มีเวลาเรียก/เสร็จ ไม่นับเป็นผู้รอ') +
      num('thresholds.idle_minutes', 'ถือว่ากลับแล้ว เมื่อไม่มีความเคลื่อนไหว (นาที)', 30, 480, 1, 'กรณีไม่มีเวลารับยาเสร็จ') +
      num('poll_seconds', 'ดึงข้อมูลใหม่ทุก (วินาที)', 15, 300);
  }

  /* ---------------- จับคู่ห้อง ---------------- */
  function depNames(codes) {
    if (!codes.length) return '<span class="unk">ยังไม่ได้จับคู่</span>';
    return codes.map(c => DEPS[c] ? esc(c) + ' ' + esc(DEPS[c]) : '<span class="unk">' + esc(c) + ' ไม่พบใน kskdepartment</span>').join(' · ');
  }
  function renderMap() {
    const rows = [];
    Object.keys(D.PLANS).forEach(b => D.PLANS[b].floors.forEach((rooms, f) => rooms.forEach(r => {
      if (!r.st || !S.stations[r.st]) return;
      const id = r.st, st = S.stations[id], p = 'stations.' + id;
      rows.push('<tr><td class="room"><b>' + esc(r.n) + '</b><small>' + esc(BNAME[b]) + (D.PLANS[b].floors.length > 1 ? ' · ชั้น ' + (f + 1) : '') + (r.cub ? ' · ห้องย่อย ' + r.cub + ' ห้อง' : '') + '</small></td>' +
        '<td><input type="text" data-k="' + p + '.name" value="' + esc(st.name) + '" maxlength="80" aria-label="ชื่อที่แสดง ' + esc(r.n) + '"></td>' +
        '<td><input type="text" data-k="' + p + '.short" value="' + esc(st.short) + '" maxlength="30" aria-label="ชื่อย่อ ' + esc(r.n) + '"></td>' +
        '<td><select data-k="' + p + '.phase" aria-label="ขั้นบริการ ' + esc(r.n) + '">' + D.PHASES.map(x => '<option value="' + x.id + '"' + (x.id === st.phase ? ' selected' : '') + '>' + x.name + '</option>').join('') + '</select></td>' +
        '<td><input type="text" class="dep" list="depList" data-kind="deps" data-k="' + p + '.depcodes" value="' + esc(st.depcodes.join(', ')) + '" aria-label="รหัสแผนก ' + esc(r.n) + '"><div class="dep-names">' + depNames(st.depcodes) + '</div></td>' +
        '<td class="num"><input type="number" min="1" max="60" data-k="' + p + '.servers" value="' + st.servers + '" aria-label="ช่องบริการ ' + esc(r.n) + '"></td></tr>');
    })));
    $('mapBody').innerHTML = rows.join('');
    renderUnmapped();
  }
  function renderUnmapped() {
    const box = $('unmappedBox');
    if (!CHECK) { box.innerHTML = '<p class="muted note">กด "ตรวจตาราง" ด้านล่าง เพื่อดูแผนกที่มีผู้ป่วยใน 7 วันแต่ยังไม่ได้จับคู่</p>'; return; }
    const mapped = new Set(); Object.values(S.stations).forEach(s => s.depcodes.forEach(c => mapped.add(c)));
    const cnt = {};
    CHECK.baseline.forEach(r => { cnt[r.depcode] = Math.max(cnt[r.depcode] || 0, r.n); });
    CHECK.tables.forEach(t => (t.rows || []).forEach(r => { cnt[r.depcode] = Math.max(cnt[r.depcode] || 0, r.n_rows); }));
    const um = Object.keys(cnt).filter(c => c && !mapped.has(c)).sort((a, b) => cnt[b] - cnt[a]);
    if (!um.length) { box.innerHTML = '<p class="muted note">ทุกแผนกที่พบใน 7 วันถูกจับคู่แล้ว</p>'; return; }
    const opts = Object.keys(S.stations).map(id => '<option value="' + id + '">' + esc(S.stations[id].name) + '</option>').join('');
    box.innerHTML = '<h3>แผนกที่มีผู้ป่วยใน 7 วัน แต่ยังไม่ได้จับคู่ (' + um.length + ')</h3><div class="um-list">' +
      um.slice(0, 60).map(c => '<div class="um-item"><b>' + esc(c) + '</b> ' + esc(DEPS[c] || '') + ' <span class="muted">' + cnt[c].toLocaleString('th-TH') + ' รายการ</span>' +
        '<select aria-label="จับคู่ ' + esc(c) + ' กับห้อง">' + opts + '</select><button class="ghost-btn sm" type="button" data-addmap="' + esc(c) + '">จับคู่</button></div>').join('') + '</div>';
    box.querySelectorAll('[data-addmap]').forEach(b => {
      b.onclick = () => { const id = b.previousElementSibling.value; S.stations[id].depcodes.push(b.dataset.addmap); markDirty(); renderMap(); };
    });
  }

  /* ---------------- ตาราง/คอลัมน์เวลา ---------------- */
  function colField(table, path, label, timeOnly) {
    const v = getPath(S, path) || '', cols = COLS[table];
    if (!cols || !cols.length) {
      return '<label class="field">' + esc(label) + '<input type="text" data-k="' + path + '" value="' + esc(v) + '" placeholder="ชื่อคอลัมน์"></label>';
    }
    const list = timeOnly ? cols.filter(c => TIME_T.includes(c.type)).concat(cols.filter(c => !TIME_T.includes(c.type))) : cols;
    const known = !v || cols.some(c => c.name === v);
    return '<label class="field">' + esc(label) + '<select data-k="' + path + '"' + (known ? '' : ' class="bad"') + '><option value="">— ไม่ใช้ —</option>' +
      (known ? '' : '<option value="' + esc(v) + '" selected>' + esc(v) + ' (ไม่พบ)</option>') +
      list.map(c => '<option value="' + esc(c.name) + '"' + (c.name === v ? ' selected' : '') + '>' + esc(c.name) + ' · ' + esc(c.type) + '</option>').join('') + '</select></label>';
  }
  function tableField(path) {
    const t = getPath(S, path) || '', cols = COLS[t];
    const note = !t ? '' : cols === undefined ? '' : cols.length ? '<small>' + cols.length + ' คอลัมน์</small>' : '<small class="unk" style="color:var(--bad)">ไม่พบตาราง หรือไม่มีสิทธิ์ SELECT</small>';
    return '<label class="field">ชื่อตาราง<input type="text" class="tname" data-table="1" data-k="' + path + '" value="' + esc(t) + '">' + note + '</label>';
  }
  function renderSource() {
    const V = S.source.visit, vt = V.table;
    $('visitFields').innerHTML = tableField('source.visit.table') +
      [['vn', 'เลข visit (vn)'], ['hn', 'HN (ส่งออกแค่ 4 ตัวท้าย)'], ['date', 'วันที่มา'], ['time', 'เวลามา (ใช้แทนเวลาเข้าคิวจุดแรก)'], ['queue', 'เลขคิว'], ['clinic', 'แผนก/คลินิกหลัก']]
        .map(([k, l]) => colField(vt, 'source.visit.' + k, l, k === 'time')).join('');

    $('rowsBox').innerHTML = S.source.rows.map((r, i) => {
      const p = 'source.rows.' + i;
      return '<div class="src' + (r.enabled ? '' : ' off') + '"><div class="src-head">' +
        '<label class="tog"><input type="checkbox" data-k="' + p + '.enabled" data-rerender="1"' + (r.enabled ? ' checked' : '') + '> ใช้ตารางนี้</label>' +
        tableField(p + '.table') + '<button class="ghost-btn sm rm" type="button" data-rm="rows.' + i + '">ลบ</button></div>' +
        '<div class="field-grid">' + colField(r.table, p + '.vn', 'เลข visit (vn)') + colField(r.table, p + '.depcode', 'รหัสแผนก') + colField(r.table, p + '.queue', 'เลขคิวของแผนก') +
        colField(r.table, p + '.arrive', 'เวลาเข้าคิว', true) + colField(r.table, p + '.start', 'เวลาเรียก / เริ่ม', true) + colField(r.table, p + '.end', 'เวลาเสร็จ / ออก', true) + '</div></div>';
    }).join('') || '<p class="muted">ยังไม่มี</p>';

    $('wideBox').innerHTML = S.source.wide.map((w, i) => {
      const p = 'source.wide.' + i;
      const pts = w.points.map((pt, j) => {
        const q = p + '.points.' + j;
        return '<div class="pt"><label class="field">ชื่อจุด<input type="text" data-k="' + q + '.label" value="' + esc(pt.label) + '"></label>' +
          '<label class="field">รหัสแผนก<input type="text" list="depList" data-k="' + q + '.depcode" value="' + esc(pt.depcode) + '"' + (pt.dep_mode === 'clinic' ? ' disabled placeholder="ใช้คลินิกของ visit"' : '') + '>' +
          '<span><label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-pt-clinic="' + q + '"' + (pt.dep_mode === 'clinic' ? ' checked' : '') + '> ใช้คลินิกของ visit</label></span></label>' +
          colField(w.table, q + '.arrive', 'เวลาเข้าคิว', true) + colField(w.table, q + '.start', 'เวลาเรียก', true) + colField(w.table, q + '.end', 'เวลาเสร็จ', true) +
          '<button class="ghost-btn sm" type="button" data-rm="wide.' + i + '.points.' + j + '">ลบจุด</button></div>';
      }).join('');
      return '<div class="src' + (w.enabled ? '' : ' off') + '"><div class="src-head">' +
        '<label class="tog"><input type="checkbox" data-k="' + p + '.enabled" data-rerender="1"' + (w.enabled ? ' checked' : '') + '> ใช้ตารางนี้</label>' +
        tableField(p + '.table') + colField(w.table, p + '.vn', 'เลข visit (vn)') + '<button class="ghost-btn sm rm" type="button" data-rm="wide.' + i + '">ลบ</button></div>' +
        (pts || '<p class="muted note">ยังไม่มีจุดบริการ</p>') + '<button class="ghost-btn sm" type="button" data-addpt="' + i + '">+ เพิ่มจุด</button></div>';
    }).join('') || '<p class="muted">ยังไม่มี</p>';

    document.querySelectorAll('[data-rm]').forEach(b => {
      b.onclick = () => { const ks = b.dataset.rm.split('.'), idx = +ks.pop(); getPath(S.source, ks.join('.')).splice(idx, 1); markDirty(); renderSource(); };
    });
    document.querySelectorAll('[data-addpt]').forEach(b => {
      b.onclick = () => { S.source.wide[+b.dataset.addpt].points.push({ label: '', dep_mode: 'fixed', depcode: '', arrive: '', start: '', end: '' }); markDirty(); renderSource(); };
    });
    document.querySelectorAll('[data-pt-clinic]').forEach(b => {
      b.onchange = () => { getPath(S, b.dataset.ptClinic).dep_mode = b.checked ? 'clinic' : 'fixed'; markDirty(); renderSource(); };
    });
  }
  $('addRows').onclick = () => { S.source.rows.push({ enabled: false, table: '', vn: 'vn', depcode: '', queue: '', arrive: '', start: '', end: '' }); markDirty(); renderSource(); };
  $('addWide').onclick = () => { S.source.wide.push({ enabled: false, table: '', vn: 'vn', points: [] }); markDirty(); renderSource(); };

  /* ---------------- ตรวจตาราง ---------------- */
  $('runCheck').onclick = async () => {
    const b = $('runCheck'); b.disabled = true; b.textContent = 'กำลังนับ…';
    try { CHECK = await LV.getJSON('api/schema.php?check=1&days=7'); renderCheck(); renderUnmapped(); }
    catch (e) { $('checkOut').innerHTML = '<p class="form-err">' + esc(e.message) + '</p>'; }
    b.disabled = false; b.textContent = 'ตรวจตารางอีกครั้ง';
  };
  function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }
  function renderCheck() {
    const C = CHECK;
    let h = '<p class="muted note">ช่วง ' + esc(C.from) + ' ถึงวันนี้ · ตัวเลขทั้งหมดเป็นจำนวนนับ</p>';
    h += '<div class="chk-block"><h3>ฐานเทียบ: จำนวน visit ต่อแผนกหลัก</h3><div class="tbl-scroll"><table class="tbl chk-tbl"><thead><tr><th>รหัสแผนก</th><th>ชื่อ</th><th class="num">visit</th><th class="num">วันที่มีข้อมูล</th></tr></thead><tbody>' +
      C.baseline.slice(0, 40).map(r => '<tr><td>' + esc(r.depcode) + '</td><td>' + esc(DEPS[r.depcode] || '') + '</td><td class="num">' + r.n.toLocaleString('th-TH') + '</td><td class="num">' + r.n_days + '</td></tr>').join('') + '</tbody></table></div></div>';
    C.tables.forEach(t => {
      h += '<div class="chk-block"><h3>' + esc(t.table);
      if (!t.exists) { h += '</h3><p class="muted">ไม่พบตารางนี้ หรือไม่มีสิทธิ์ SELECT</p></div>'; return; }
      if (t.note || !t.rows) { h += '</h3><p class="muted">' + esc(t.note || '') + '</p></div>'; return; }
      const tc = t.time_columns, tot = t.rows.reduce((a, r) => a + r.n_rows, 0);
      h += ' <small class="muted">แบ่งตาม ' + esc(t.group_by) + ' · ' + tot.toLocaleString('th-TH') + ' แถว</small>' +
        (t.rows.length ? '<button class="ghost-btn sm use" type="button" data-use="' + esc(t.table) + '" data-by="' + esc(t.group_by) + '">ใช้ตารางนี้</button>' : '') + '</h3>';
      if (!t.rows.length) { h += '<p class="muted">ไม่มีข้อมูลใน 7 วัน — รพ. ไม่ได้บันทึกในตารางนี้</p></div>'; return; }
      if (!tc.length) { h += '<p class="muted">ไม่มีคอลัมน์ชนิดวันที่-เวลา</p></div>'; return; }
      const sum = {}; tc.forEach(c => { sum[c] = t.rows.reduce((a, r) => a + r.filled[c], 0); });
      const cell = (n, d) => { const v = pct(n, d); return '<td class="fill ' + (v >= 90 ? 'f-hi' : v >= 30 ? 'f-mid' : 'f-lo') + '">' + v + '%</td>'; };
      h += '<div class="tbl-scroll"><table class="tbl chk-tbl"><thead><tr><th>รหัสแผนก</th><th>ชื่อ</th><th class="num">แถว</th><th class="num">วัน</th>' + tc.map(c => '<th class="num">' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
        t.rows.slice(0, 60).map(r => '<tr><td>' + esc(r.depcode) + '</td><td>' + esc(DEPS[r.depcode] || '') + '</td><td class="num">' + r.n_rows.toLocaleString('th-TH') + '</td><td class="num">' + r.n_days + '</td>' + tc.map(c => cell(r.filled[c], r.n_rows)).join('') + '</tr>').join('') +
        '</tbody><tfoot><tr><td colspan="2">รวม (% ที่มีเวลาจริง)</td><td class="num">' + tot.toLocaleString('th-TH') + '</td><td></td>' + tc.map(c => cell(sum[c], tot)).join('') + '</tr></tfoot></table></div></div>';
    });
    h += '<p class="muted note">อ่านผล: ≥ 90% = จุดนั้นกดบันทึกเวลาจริง ใช้คำนวณได้ · ต่ำกว่า 30% = แทบไม่ได้บันทึก ไม่ควรเลือกคอลัมน์นั้น · ค่า 00:00:00 ถือว่าไม่ได้บันทึก</p>';
    $('checkOut').innerHTML = h;
    $('checkOut').querySelectorAll('[data-use]').forEach(b => {
      b.onclick = async () => {
        const t = b.dataset.use, byOwn = b.dataset.by.startsWith(t + '.');
        await loadTable(t);
        if (byOwn) {
          let r = S.source.rows.find(x => x.table === t);
          if (!r) S.source.rows.push(r = { enabled: true, table: t, vn: 'vn', depcode: '', queue: '', arrive: '', start: '', end: '' });
          r.enabled = true; r.depcode = r.depcode || b.dataset.by.split('.')[1];
        } else {
          let w = S.source.wide.find(x => x.table === t);
          if (!w) S.source.wide.push(w = { enabled: true, table: t, vn: 'vn', points: [] });
          w.enabled = true;
        }
        markDirty(); renderSource(); location.hash = 'source';
      };
    });
  }

  /* ---------------- บันทึก ---------------- */
  $('saveBtn').onclick = async () => {
    const b = $('saveBtn'), err = $('saveErr');
    b.disabled = true; err.hidden = true;
    try {
      const r = await api('api/settings.php', S);
      S = r.settings; dirty = false;
      $('saveBar').classList.remove('dirty');
      $('saveMsg').textContent = 'บันทึกแล้ว ' + new Date().toLocaleTimeString('th-TH', { hour12: false }) + ' · ทุกจอจะใช้ค่าใหม่ในรอบดึงข้อมูลถัดไป' + (r.checked_against_db ? '' : ' (ยังไม่ได้ตรวจกับฐานข้อมูล)');
      renderKpi(); renderMap(); renderSource();
    } catch (e) {
      $('saveMsg').textContent = e.message;
      const list = (e.body && e.body.errors) || [];
      err.innerHTML = list.map(x => '<li>' + esc(x) + '</li>').join('');
      err.hidden = !list.length;
      if (e.status === 401 || e.status === 403) setTimeout(() => location.reload(), 1500);
    }
    b.disabled = false;
  };

  init();
})();
