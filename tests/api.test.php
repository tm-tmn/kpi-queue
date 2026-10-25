<?php
/* php tests/api.test.php — ใช้ฐาน hos_fix (tests/fixture.sql) ด้วย user อ่านอย่างเดียว */
declare(strict_types=1);
require __DIR__ . '/../api/lib/Config.php';
require __DIR__ . '/../api/lib/Database.php';
require __DIR__ . '/../api/services/SettingsService.php';
require __DIR__ . '/../api/services/SchemaService.php';
require __DIR__ . '/../api/services/LiveService.php';

$tmp = sys_get_temp_dir() . '/opdmap-test-' . getmypid();
$cfg = ['env' => 'dev', 'timezone' => 'Asia/Bangkok', 'secret' => 's',
  'db' => ['dsn' => getenv('TEST_DSN') ?: 'mysql:unix_socket=/run/mysqld/mysqld.sock;dbname=hos_fix;charset=utf8mb4', 'user' => 'opdmap_ro', 'pass' => 'test-ro-pass'],
  'storage_dir' => $tmp, 'debug_now' => '2026-10-25 10:30:00'];
$p = (new ReflectionClass('Config'))->getProperty('cfg'); $p->setAccessible(true); $p->setValue(null, $cfg);

$n = 0;
function ok(string $name, bool $cond, string $info = ''): void { global $n; if (!$cond) { fwrite(STDERR, "FAIL - $name $info\n"); exit(1); } $n++; echo "ok - $name\n"; }

/* ---------- toMin ---------- */
ok('toMin TIME', LiveService::toMin('08:30:00', '2026-10-25', 630) === 510.0);
ok('toMin DATETIME วันนี้', LiveService::toMin('2026-10-25 08:30:30', '2026-10-25', 630) === 510.5);
ok('toMin 00:00:00 = ไม่ได้บันทึก', LiveService::toMin('00:00:00', '2026-10-25', 630) === null);
ok('toMin 0000-00-00', LiveService::toMin('0000-00-00 00:00:00', '2026-10-25', 630) === null);
ok('toMin วันอื่น = null', LiveService::toMin('2026-10-24 08:30:00', '2026-10-25', 630) === null);
ok('toMin อนาคต = null', LiveService::toMin('11:00:00', '2026-10-25', 630) === null);
ok('toMin ข้อความแปลก = null', LiveService::toMin('abc', '2026-10-25', 630) === null);

/* ---------- guard ---------- */
foreach (["UPDATE ovst SET hn=1", "SELECT 1; DROP TABLE x", "select * from ovst into outfile '/tmp/a'", "/* x */ DELETE FROM ovst", "WITH a AS (SELECT 1) DELETE FROM ovst"] as $q) {
  $blocked = false; try { Database::assertReadOnly($q); } catch (RuntimeException $e) { $blocked = true; }
  ok('guard ปฏิเสธ: ' . $q, $blocked);
}
Database::assertReadOnly("SELECT update_time, created_by FROM t -- comment");
ok('guard ไม่ปฏิเสธคอลัมน์ชื่อคล้ายคำสั่ง', true);
$bad = false; try { Database::q('a`b'); } catch (InvalidArgumentException $e) { $bad = true; }
ok('ชื่อคอลัมน์มี backtick ถูกปฏิเสธ', $bad);

/* ---------- settings validate ---------- */
$S = new SettingsService();
$schema = new SchemaService();
$in = $S->defaults();
$in['source']['rows'][0] = ['enabled' => true, 'table' => 'opd_dep_queue', 'vn' => 'vn', 'depcode' => 'depcode', 'queue' => 'depq', 'arrive' => 'time_in', 'start' => 'time_call', 'end' => 'time_out'];
$in['source']['rows'][1]['enabled'] = false;
$in['source']['wide'][0] = ['enabled' => true, 'table' => 'service_time', 'vn' => 'vn', 'points' => [
  ['label' => 'บัตร', 'dep_mode' => 'fixed', 'depcode' => '001', 'arrive' => 'reg_in', 'start' => '', 'end' => 'reg_out'],
  ['label' => 'ยา', 'dep_mode' => 'fixed', 'depcode' => '091', 'arrive' => 'drug_in', 'start' => 'drug_call', 'end' => 'drug_out']]];
[$clean, $err] = $S->validate($in, $schema);
ok('ค่าถูกต้องผ่านการตรวจ', !$err, implode(' | ', $err));
$x = $in; $x['stations']['FIN']['depcodes'] = ['011'];
[, $err] = $S->validate($x, $schema); ok('รหัสแผนกซ้ำสองห้องถูกปฏิเสธ', (bool) preg_grep('/ซ้ำ/u', $err));
$x = $in; $x['source']['rows'][0]['start'] = 'nope';
[, $err] = $S->validate($x, $schema); ok('คอลัมน์ที่ไม่มีจริงถูกปฏิเสธ', (bool) preg_grep('/ไม่พบคอลัมน์/u', $err));
$x = $in; $x['source']['rows'][0]['table'] = 'patient; DROP';
[, $err] = $S->validate($x, $schema); ok('ชื่อตารางแปลกถูกปฏิเสธ', (bool) $err);
$x = $in; $x['source']['wide'][0]['vn'] = '';
[, $err] = $S->validate($x, $schema); ok('ตารางหลายจุดต้องมีคอลัมน์ vn', (bool) preg_grep('/vn/u', $err));
$x = $in; $x['kpi']['doc'] = 0;
[, $err] = $S->validate($x, $schema); ok('KPI 0 ถูกปฏิเสธ', (bool) $err);
$x = $in; $x['stations']['REG']['name'] = '<script>alert(1)</script>ห้องบัตร';
[$c2] = $S->validate($x, $schema); ok('ตัด HTML ออกจากชื่อห้อง', $c2['stations']['REG']['name'] === 'alert(1)ห้องบัตร');
$clean['stations']['LAB']['depcodes'] = ['080'];
$S->save($clean);
ok('บันทึกไฟล์ settings.json.php', is_file($tmp . '/settings.json.php'));
ok('ไฟล์ settings ขึ้นต้นด้วย exit guard', str_starts_with((string) file_get_contents($tmp . '/settings.json.php'), '<?php http_response_code(404); exit; ?>'));
ok('อ่าน settings กลับได้', $S->load()['stations']['LAB']['depcodes'] === ['080']);

/* ---------- live snapshot ---------- */
$set = $S->load();
$d = (new LiveService($set, $schema))->snapshot(Config::now());
$json = json_encode($d, JSON_UNESCAPED_UNICODE);
$V = []; foreach ($d['visits'] as $v) $V[$v['q']] = $v;
ok('ไม่มี VN / HN เต็ม / ชื่อ ในผลลัพธ์', !str_contains($json, '"V1"') && !str_contains($json, '000123456') && !str_contains($json, 'ห้ามหลุด') && !str_contains($json, '"vn"'));
ok('HN เหลือ 4 ตัวท้าย', $V['1']['hn4'] === '3456');
ok('ไม่รวม visit ของเมื่อวาน', count($d['visits']) === 8, (string) count($d['visits']));
$s1 = $V['1']['steps'];
ok('V1 ครบทุกจุด เรียงตามเวลา', array_column($s1, 'st') === ['REG', 'SCR_MED', 'DOC_MED', 'PHA'], json_encode(array_column($s1, 'st')));
ok('V1 รับยาเสร็จ = กลับแล้ว', $V['1']['done'] === 575.0 && $V['1']['di'] === 0);
$doc2 = $V['2']['steps'][1];
ok('V2 ไม่มีเวลาเข้าคิว → อนุมานจากจุดก่อน (ia=1)', $doc2['a'] === 500.0 && ($doc2['ia'] ?? 0) === 1, json_encode($doc2));
$s3 = $V['3']['steps'];
ok('V3 ไม่มีเวลาเสร็จ แต่ไปจุดถัดไปแล้ว → ใช้เวลาเข้าจุดถัดไป (ie=1)', $s3[0]['e'] === 510.0 && ($s3[0]['ie'] ?? 0) === 1);
ok('V3 จุดล่าสุดยังรอ ไม่มีธงค้าง', !isset($s3[1]['s']) && !isset($s3[1]['stale']));
ok('V4 รอเกิน 240 นาที → ค้างในระบบ และถือว่ากลับแล้ว', ($V['4']['steps'][0]['stale'] ?? 0) === 1 && $V['4']['di'] === 1);
ok('V5 เวลา 00:00:00 ทั้งหมดถูกตัดทิ้ง', $V['5']['steps'] === []);
ok('V6 แผนกที่ยังไม่จับคู่ถูกรายงาน', isset($d['unmapped']['099']) && $d['unmapped']['099']['waiting'] === 1);
ok('V8 เวลาเรียกในอนาคตถูกตัดทิ้ง', !isset($V['8']['steps'][0]['s']));
ok('V9 ไม่มีความเคลื่อนไหวเกิน 120 นาที → ถือว่ากลับแล้ว', $V['9']['done'] === 425.0 && $V['9']['di'] === 1);
ok('ชื่อแผนกจาก kskdepartment', ($d['deps']['011'] ?? '') === 'OPD อายุรกรรม');

/* ---------- ตรวจตาราง: ได้แต่ตัวเลข ---------- */
$c = $schema->countCheck('opd_dep_queue', $set['source']['visit'], 'depcode', 'vn', '2026-10-18');
ok('ตรวจตาราง นับแยกแผนก', $c['group_by'] === 'opd_dep_queue.depcode' && count($c['rows']) >= 3);
$keys = array_unique(array_merge(...array_map('array_keys', $c['rows'])));
sort($keys);
ok('ตรวจตาราง ไม่มีข้อมูลรายคน', $keys === ['depcode', 'filled', 'n_days', 'n_rows'], json_encode($keys));
$r011 = array_values(array_filter($c['rows'], fn($r) => $r['depcode'] === '011'))[0];
ok('นับเวลาเรียกที่บันทึกจริง', $r011['n_rows'] === 6 && $r011['filled']['time_call'] === 4, json_encode($r011));
$c2 = $schema->countCheck('service_time', $set['source']['visit'], null, 'vn', '2026-10-18');
$f = array_sum(array_map(fn($r) => $r['filled']['pay_in'], $c2['rows']));
ok('00:00:00 ไม่นับเป็นบันทึก', $f === 0);

array_map('unlink', glob($tmp . '/*.php') ?: []); @rmdir($tmp . '/cache'); @rmdir($tmp);
echo "$n tests passed\n";
