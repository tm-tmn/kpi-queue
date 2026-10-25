<?php
declare(strict_types=1);

/**
 * ต่อฐานข้อมูล HIS แบบอ่านอย่างเดียว 3 ชั้น
 *  1) user ฐานข้อมูลมีสิทธิ์ SELECT เท่านั้น (ฝั่ง DBA)
 *  2) session ถูกตั้งเป็น READ ONLY ทันทีที่ต่อ — คำสั่งเขียนใด ๆ จะ error ที่ฐานข้อมูล
 *  3) select() รับเฉพาะคำสั่ง SELECT/SHOW/WITH คำสั่งเดียว
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo !== null) return self::$pdo;
        $db = Config::get('db');
        $pdo = new PDO($db['dsn'], $db['user'] ?? null, $db['pass'] ?? null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 5,
        ]);
        $ms = (int) Config::get('query_timeout_ms', 8000);
        switch ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME)) {
            case 'mysql':
                $pdo->exec('SET SESSION TRANSACTION READ ONLY');
                try { $pdo->exec('SET SESSION MAX_EXECUTION_TIME = ' . $ms); }            // MySQL
                catch (Throwable) {
                    try { $pdo->exec('SET SESSION max_statement_time = ' . ($ms / 1000)); } // MariaDB
                    catch (Throwable) { /* รุ่นเก่าไม่รองรับ */ }
                }
                break;
            case 'pgsql':
                $pdo->exec('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
                $pdo->exec('SET statement_timeout = ' . $ms);
                break;
            case 'sqlite':
                $pdo->exec('PRAGMA query_only = ON');
                break;
        }
        return self::$pdo = $pdo;
    }

    public static function driver(): string
    {
        return self::pdo()->getAttribute(PDO::ATTR_DRIVER_NAME);
    }

    /** @return array<int, array<string, mixed>> */
    public static function select(string $sql, array $params = []): array
    {
        self::assertReadOnly($sql);
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    public static function assertReadOnly(string $sql): void
    {
        $s = preg_replace('~/\*.*?\*/|--[^\n]*~s', '', $sql);
        $s = rtrim(trim((string) $s), "; \n\t");
        if (!preg_match('/^(SELECT|SHOW|WITH)\b/i', $s) || str_contains($s, ';')
            || preg_match('/\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|LOCK|CALL|HANDLER|LOAD_FILE|OUTFILE|DUMPFILE)\b/i', $s)) {
            throw new RuntimeException('อนุญาตเฉพาะคำสั่ง SELECT คำสั่งเดียว');
        }
    }

    /** ใส่ชื่อตาราง/คอลัมน์จากหน้าตั้งค่าอย่างปลอดภัย */
    public static function q(string $ident): string
    {
        if (!self::validIdent($ident)) throw new InvalidArgumentException('ชื่อตาราง/คอลัมน์ไม่ถูกต้อง: ' . $ident);
        return self::driver() === 'mysql' ? '`' . $ident . '`' : '"' . $ident . '"';
    }

    public static function validIdent(string $ident): bool
    {
        return (bool) preg_match('/^[A-Za-z_][A-Za-z0-9_]{0,63}$/', $ident);
    }

    /** CAST(x AS ข้อความ) ตาม driver */
    public static function text(string $expr): string
    {
        return 'CAST(' . $expr . ' AS ' . (self::driver() === 'mysql' ? 'CHAR' : 'TEXT') . ')';
    }

    public static function schemaExpr(): string
    {
        return match (self::driver()) { 'mysql' => 'DATABASE()', 'pgsql' => 'current_schema()', default => "'main'" };
    }
}
