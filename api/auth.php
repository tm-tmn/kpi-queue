<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $b = Json::body();
    if (($b['action'] ?? '') === 'logout') { Auth::logout(); Json::send(['admin' => false]); }
    if (!Auth::configured()) Json::send(['error' => 'ยังไม่ได้ตั้งรหัสผ่านผู้ดูแลใน api/config.php'], 503);
    if (!Auth::login((string) ($b['username'] ?? ''), (string) ($b['password'] ?? ''))) Json::send(['error' => 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'], 401);
}
Json::send(['admin' => Auth::isAdmin(), 'csrf' => Auth::csrf(), 'configured' => Auth::configured(), 'needs_username' => (string) Config::get('admin_username', '') !== '']);
