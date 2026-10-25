<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$svc = new SettingsService();
try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        Auth::requireAdmin(true);
        $schema = null;
        try { Database::pdo(); $schema = new SchemaService(); } catch (Throwable $e) { /* ฐานข้อมูลไม่พร้อม: ตรวจเฉพาะรูปแบบ */ }
        [$clean, $errors] = $svc->validate(Json::body(), $schema);
        if ($errors) Json::send(['error' => 'บันทึกไม่ได้ ตรวจรายการด้านล่าง', 'errors' => $errors], 422);
        $svc->save($clean);
        Json::send(['ok' => true, 'settings' => $svc->load(), 'checked_against_db' => $schema !== null]);
    }
    $s = $svc->load();
    Json::send(Auth::isAdmin() ? $s : $svc->publicView($s));
} catch (Throwable $e) {
    Json::fail($e, 'อ่านหรือบันทึกการตั้งค่าไม่ได้ ตรวจสิทธิ์เขียนโฟลเดอร์ storage');
}
