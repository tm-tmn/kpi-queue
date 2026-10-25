<?php
declare(strict_types=1);

final class Json
{
    public static function send(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
        exit;
    }

    public static function body(): array
    {
        $raw = file_get_contents('php://input') ?: '';
        $d = json_decode($raw, true);
        return is_array($d) ? $d : [];
    }

    public static function fail(Throwable $e, string $msg = 'ไม่สามารถอ่านข้อมูลจาก HIS ได้ ตรวจการเชื่อมต่อฐานข้อมูล'): never
    {
        error_log('[opd-map] ' . $e->getMessage());
        self::send(['error' => $msg], $e instanceof InvalidArgumentException ? 400 : 500);
    }
}
