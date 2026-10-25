<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

/* ผู้ดูแลเท่านั้น — คืน metadata และ COUNT แยกแผนกเท่านั้น ไม่มีข้อมูลรายคน */
Auth::requireAdmin();
try {
    $s = (new SettingsService())->load();
    $schema = new SchemaService();
    $V = $s['source']['visit'];
    $tables = [];
    foreach ($s['source']['rows'] as $r) $tables[$r['table']] = ['dep' => $r['depcode'] ?: null, 'vn' => $r['vn'] ?: null];
    foreach ($s['source']['wide'] as $w) $tables[$w['table']] ??= ['dep' => null, 'vn' => $w['vn'] ?: null];
    foreach (['ovst_service_time', 'service_time', 'opd_dep_queue'] as $t) $tables[$t] ??= ['dep' => null, 'vn' => null];
    $extra = trim((string) ($_GET['table'] ?? ''));
    if ($extra !== '' && Database::validIdent($extra)) $tables[$extra] ??= ['dep' => null, 'vn' => null];

    if (!isset($_GET['check'])) {
        $cols = [$V['table'] => $schema->tableColumns($V['table'])];
        foreach (array_keys($tables) as $t) $cols[$t] = $schema->tableColumns($t);
        Json::send(['columns' => $cols]);
    }
    $days = max(1, min(14, (int) ($_GET['days'] ?? 7)));
    $from = Config::now()->modify("-{$days} days")->format('Y-m-d');
    $out = ['days' => $days, 'from' => $from, 'baseline' => $schema->visitBaseline($V, $from), 'tables' => []];
    foreach ($tables as $t => $o) {
        try { $out['tables'][] = $schema->countCheck($t, $V, $o['dep'], $o['vn'], $from); }
        catch (Throwable $e) { error_log('[opd-map] check ' . $t . ': ' . $e->getMessage()); $out['tables'][] = ['table' => $t, 'exists' => true, 'note' => 'นับไม่ได้: ตรวจสิทธิ์ SELECT ของตารางนี้']; }
    }
    $out['deps'] = (new DepartmentService(Database::pdo()))->all();
    Json::send($out);
} catch (Throwable $e) {
    Json::fail($e);
}
