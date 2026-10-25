<?php
declare(strict_types=1);

final class Config
{
    private static ?array $cfg = null;

    public static function all(): array
    {
        if (self::$cfg === null) {
            $file = __DIR__ . '/../config.php';
            if (!is_file($file)) {
                throw new RuntimeException('ยังไม่มี api/config.php (คัดลอกจาก config.example.php)');
            }
            self::$cfg = require $file;
        }
        return self::$cfg;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::all()[$key] ?? $default;
    }

    public static function storage(string $sub = ''): string
    {
        $dir = rtrim((string) self::get('storage_dir', __DIR__ . '/../../storage'), '/');
        $path = $sub === '' ? $dir : $dir . '/' . $sub;
        if (!is_dir($path)) @mkdir($path, 0770, true);
        return $path;
    }

    /**
     * ไฟล์ใน storage เก็บเป็น .php ที่ขึ้นต้นด้วยคำสั่ง exit
     * ถ้า web server ไม่อ่าน .htaccess (เช่น nginx) แล้วมีคนเปิดไฟล์ตรง ๆ ก็จะได้หน้าว่าง ไม่ใช่ข้อมูล
     */
    private const GUARD = "<?php http_response_code(404); exit; ?>\n";

    public static function writeFile(string $path, string $data): void
    {
        $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp.php';
        if (file_put_contents($tmp, self::GUARD . $data, LOCK_EX) === false) throw new RuntimeException('เขียนไฟล์ไม่ได้: ' . $path);
        rename($tmp, $path);
    }

    public static function readFile(string $path): ?string
    {
        if (!is_file($path)) return null;
        $s = (string) file_get_contents($path);
        return str_starts_with($s, self::GUARD) ? substr($s, strlen(self::GUARD)) : $s;
    }

    public static function now(): DateTimeImmutable
    {
        $tz = new DateTimeZone((string) self::get('timezone', 'Asia/Bangkok'));
        $dbg = self::get('debug_now');
        if ($dbg && self::get('env') === 'dev') return new DateTimeImmutable((string) $dbg, $tz);
        return new DateTimeImmutable('now', $tz);
    }
}
