<?php
declare(strict_types=1);

final class Json
{
    public static function send(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function fail(Throwable $e): never
    {
        error_log($e->getMessage());
        self::send(['error' => 'ไม่สามารถอ่านข้อมูลได้ ตรวจการเชื่อมต่อฐานข้อมูล'], 500);
    }
}
