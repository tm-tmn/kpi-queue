<?php
declare(strict_types=1);

ini_set('display_errors', '0');
require __DIR__ . '/lib/Config.php';
require __DIR__ . '/lib/Database.php';
require __DIR__ . '/lib/Json.php';
require __DIR__ . '/lib/Auth.php';
require __DIR__ . '/services/SettingsService.php';
require __DIR__ . '/services/SchemaService.php';
require __DIR__ . '/services/LiveService.php';
require __DIR__ . '/services/DepartmentService.php';

try {
    date_default_timezone_set((string) Config::get('timezone', 'Asia/Bangkok'));
} catch (Throwable $e) {
    Json::send(['error' => 'ยังไม่ได้ตั้งค่า api/config.php'], 503);
}
