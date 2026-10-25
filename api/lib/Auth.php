<?php
declare(strict_types=1);

/** ผู้ดูแลหน้าตั้งค่า: รหัสผ่านเดียว (hash ใน config.php) + session + CSRF token */
final class Auth
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) return;
        session_name('opdmap');
        session_set_cookie_params([
            'httponly' => true,
            'samesite' => 'Strict',
            'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        ]);
        session_start();
    }

    public static function configured(): bool
    {
        return (string) Config::get('admin_password_hash', '') !== '';
    }

    public static function login(string $username, string $password): bool
    {
        self::start();
        $user = (string) Config::get('admin_username', '');
        $userOk = $user === '' || hash_equals($user, $username);
        if (self::configured() && password_verify($password, (string) Config::get('admin_password_hash')) && $userOk) {
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
            return true;
        }
        usleep(800000);
        return false;
    }

    public static function logout(): void
    {
        self::start();
        $_SESSION = [];
        session_destroy();
    }

    public static function isAdmin(): bool
    {
        self::start();
        return !empty($_SESSION['admin']);
    }

    public static function csrf(): ?string
    {
        return self::isAdmin() ? ($_SESSION['csrf'] ?? null) : null;
    }

    public static function requireAdmin(bool $write = false): void
    {
        if (!self::isAdmin()) Json::send(['error' => 'ต้องเข้าสู่ระบบผู้ดูแลก่อน'], 401);
        if ($write) {
            $t = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
            if (!is_string($t) || !hash_equals((string) ($_SESSION['csrf'] ?? ''), $t)) {
                Json::send(['error' => 'หมดเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่'], 403);
            }
        }
    }
}
