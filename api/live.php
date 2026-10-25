<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

/* หน้าจอเรียกทุก 30 วินาที — แคชไว้ cache_seconds เพื่อให้ฐานข้อมูลถูกถามไม่เกิน 1 ครั้งต่อรอบ ไม่ว่าจะเปิดกี่จอ */
$now = Config::now();
$ttl = (int) Config::get('cache_seconds', 25);
$file = Config::storage('cache') . '/live-' . $now->format('Ymd') . '.json.php';
$fresh = fn() => is_file($file) && (time() - filemtime($file)) < $ttl;

$build = function () use ($now): array {
    $settings = (new SettingsService())->load();
    return (new LiveService($settings, new SchemaService()))->snapshot($now);
};
$lock = @fopen($file . '.lock.php', 'c');
if (!$lock) {                       // storage เขียนไม่ได้: ทำงานต่อโดยไม่มีแคช
    error_log('[opd-map] storage ไม่สามารถเขียนได้: ' . dirname($file));
    try { Json::send($build()); } catch (Throwable $e) { Json::fail($e, 'เชื่อมต่อ HIS ไม่ได้ ตรวจการตั้งค่าฐานข้อมูลใน api/config.php'); }
}
if (!$fresh()) {
    flock($lock, LOCK_EX);
    if (!$fresh()) {
        try {
            $data = $build();
            Config::writeFile($file, (string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION));
        } catch (Throwable $e) {
            error_log('[opd-map] live: ' . $e->getMessage());
            flock($lock, LOCK_UN);
            if (is_file($file) && time() - filemtime($file) < 600) {
                $d = json_decode((string) Config::readFile($file), true);
                $d['warnings'][] = 'เชื่อมต่อ HIS ไม่ได้ในรอบนี้ แสดงข้อมูลล่าสุดเมื่อ ' . date('H:i:s', filemtime($file));
                $d['stale_cache'] = true;
                Json::send($d);
            }
            Json::send(['error' => 'เชื่อมต่อ HIS ไม่ได้ ตรวจการตั้งค่าฐานข้อมูลใน api/config.php'], 503);
        }
    }
    flock($lock, LOCK_UN);
}
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Vary: Accept-Encoding');
if (str_contains((string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip') && function_exists('gzencode')) {
    header('Content-Encoding: gzip');
    echo gzencode((string) Config::readFile($file), 5);
} else {
    echo Config::readFile($file);
}
