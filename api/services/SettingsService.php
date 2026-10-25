<?php
declare(strict_types=1);

/**
 * ค่าที่ผู้ดูแลแก้ได้เองจากหน้าตั้งค่า (ไม่ต้องแก้โค้ด):
 *  KPI, เกณฑ์, การจับคู่ห้อง ↔ รหัสแผนก, ตาราง/คอลัมน์ที่ใช้อ่านเวลา
 * เก็บเป็นไฟล์ storage/settings.json (ไม่เขียนลงฐานข้อมูล HIS)
 */
final class SettingsService
{
    public const PHASES = ['reg', 'scr', 'doc', 'xray', 'lab', 'fin', 'pha'];
    private const KPI_KEYS = ['reg', 'scr', 'doc', 'xray', 'lab', 'fin', 'pha', 'total'];

    private function file(): string { return Config::storage() . '/settings.json.php'; }

    public function defaults(): array
    {
        return json_decode((string) file_get_contents(__DIR__ . '/../../config/settings.default.json'), true);
    }

    public function load(): array
    {
        $d = $this->defaults();
        $raw = Config::readFile($this->file());
        if ($raw === null) return $d;
        $s = json_decode($raw, true);
        if (!is_array($s)) return $d;
        foreach (['kpi', 'thresholds'] as $k) $d[$k] = array_merge($d[$k], $s[$k] ?? []);
        if (isset($s['poll_seconds'])) $d['poll_seconds'] = $s['poll_seconds'];
        foreach ($d['stations'] as $id => $st) {
            if (isset($s['stations'][$id])) $d['stations'][$id] = array_merge($st, $s['stations'][$id]);
        }
        if (isset($s['source'])) $d['source'] = $s['source'];
        $d['updated_at'] = $s['updated_at'] ?? null;
        return $d;
    }

    /** ส่วนที่หน้าจอทั่วไปต้องใช้ (ไม่มีโครงสร้างฐานข้อมูล) */
    public function publicView(array $s): array
    {
        return ['kpi' => $s['kpi'], 'thresholds' => $s['thresholds'], 'poll_seconds' => $s['poll_seconds'], 'stations' => $s['stations'], 'updated_at' => $s['updated_at'] ?? null];
    }

    /** @return array{0: array, 1: string[]} */
    public function validate(array $in, ?SchemaService $schema): array
    {
        $cur = $this->load();
        $e = [];
        $out = ['version' => 1];

        foreach (self::KPI_KEYS as $k) {
            $v = $in['kpi'][$k] ?? $cur['kpi'][$k];
            if (!is_numeric($v) || $v < 1 || $v > 600) $e[] = "KPI {$k} ต้องอยู่ระหว่าง 1–600 นาที";
            $out['kpi'][$k] = (int) $v;
        }
        $t = $in['thresholds'] ?? $cur['thresholds'];
        $out['thresholds'] = [
            'warn_ratio'    => $this->num($t['warn_ratio'] ?? 0.8, 0.5, 0.99, 'เกณฑ์สีเหลือง', $e),
            'stale_minutes' => (int) $this->num($t['stale_minutes'] ?? 240, 30, 720, 'เวลาถือว่าค้างในระบบ', $e),
            'idle_minutes'  => (int) $this->num($t['idle_minutes'] ?? 120, 30, 480, 'เวลาถือว่ากลับแล้ว', $e),
        ];
        $out['poll_seconds'] = (int) $this->num($in['poll_seconds'] ?? 30, 15, 300, 'รอบดึงข้อมูล', $e);

        $seen = [];
        foreach ($cur['stations'] as $id => $st) {
            $x = $in['stations'][$id] ?? $st;
            $name = trim(strip_tags((string) ($x['name'] ?? $st['name'])));
            $short = trim(strip_tags((string) ($x['short'] ?? $st['short'])));
            $phase = (string) ($x['phase'] ?? $st['phase']);
            if ($name === '' || mb_strlen($name) > 80) $e[] = "ชื่อจุดบริการ {$id} ต้องยาว 1–80 ตัวอักษร";
            if ($short === '' || mb_strlen($short) > 30) $e[] = "ชื่อย่อ {$id} ต้องยาว 1–30 ตัวอักษร";
            if (!in_array($phase, self::PHASES, true)) $e[] = "ขั้นบริการของ {$id} ไม่ถูกต้อง";
            $deps = $x['depcodes'] ?? [];
            if (is_string($deps)) $deps = preg_split('/[\s,]+/', $deps, -1, PREG_SPLIT_NO_EMPTY);
            $deps = array_values(array_unique(array_map('strval', (array) $deps)));
            foreach ($deps as $d) {
                if (!preg_match('/^[A-Za-z0-9_.-]{1,12}$/', $d)) $e[] = "รหัสแผนก \"{$d}\" ของ {$name} ไม่ถูกต้อง";
                elseif (isset($seen[$d])) $e[] = "รหัสแผนก {$d} ถูกจับคู่ซ้ำกับ {$seen[$d]} และ {$name}";
                else $seen[$d] = $name;
            }
            $out['stations'][$id] = ['name' => $name, 'short' => $short, 'phase' => $phase, 'depcodes' => $deps,
                'servers' => (int) $this->num($x['servers'] ?? $st['servers'], 1, 60, "จำนวนช่องบริการ {$name}", $e)];
        }

        $out['source'] = $this->validateSource($in['source'] ?? $cur['source'], $schema, $e);
        return [$out, $e];
    }

    private function validateSource(array $src, ?SchemaService $schema, array &$e): array
    {
        $cols = function (string $table) use ($schema): ?array {
            if (!$schema) return null;
            $c = $schema->tableColumns($table);
            return $c ? array_column($c, 'name') : [];
        };
        $chk = function (string $table, array $fields, string $label, bool $enabled) use ($cols, &$e) {
            if (!$enabled) return;
            if (!Database::validIdent($table)) { $e[] = "{$label}: ชื่อตาราง \"{$table}\" ไม่ถูกต้อง"; return; }
            $have = $cols($table);
            if ($have !== null && !$have) { $e[] = "{$label}: ไม่พบตาราง {$table} หรือไม่มีสิทธิ์อ่าน"; return; }
            foreach ($fields as $f => $v) {
                if ($v === '' || $v === null) continue;
                if (!Database::validIdent((string) $v)) $e[] = "{$label}: ชื่อคอลัมน์ \"{$v}\" ไม่ถูกต้อง";
                elseif ($have !== null && !in_array($v, $have, true)) $e[] = "{$label}: ไม่พบคอลัมน์ {$table}.{$v}";
            }
        };
        $s = fn($v) => trim((string) ($v ?? ''));

        $v = $src['visit'] ?? [];
        $visit = ['table' => $s($v['table'] ?? 'ovst')];
        foreach (['vn', 'hn', 'date', 'time', 'queue', 'clinic'] as $k) $visit[$k] = $s($v[$k] ?? '');
        foreach (['vn', 'hn', 'date'] as $k) if ($visit[$k] === '') $e[] = "ตาราง visit: ต้องระบุคอลัมน์ {$k}";
        $chk($visit['table'], array_diff_key($visit, ['table' => 1]), 'ตาราง visit', true);

        $rows = [];
        foreach (array_values($src['rows'] ?? []) as $i => $r) {
            $x = ['enabled' => !empty($r['enabled']), 'table' => $s($r['table'] ?? '')];
            foreach (['vn', 'depcode', 'queue', 'arrive', 'start', 'end'] as $k) $x[$k] = $s($r[$k] ?? '');
            $label = 'แหล่งเวลาแบบรายแผนก #' . ($i + 1) . ' (' . $x['table'] . ')';
            if ($x['enabled']) {
                if ($x['vn'] === '' || $x['depcode'] === '') $e[] = "{$label}: ต้องระบุคอลัมน์ vn และรหัสแผนก";
                if ($x['arrive'] === '' && $x['start'] === '' && $x['end'] === '') $e[] = "{$label}: ต้องระบุคอลัมน์เวลาอย่างน้อย 1 คอลัมน์";
            }
            $chk($x['table'], array_diff_key($x, ['enabled' => 1, 'table' => 1]), $label, $x['enabled']);
            if ($x['table'] !== '') $rows[] = $x;
        }

        $wide = [];
        foreach (array_values($src['wide'] ?? []) as $i => $w) {
            $x = ['enabled' => !empty($w['enabled']), 'table' => $s($w['table'] ?? ''), 'vn' => $s($w['vn'] ?? 'vn'), 'points' => []];
            $label = 'แหล่งเวลาแบบหลายจุดในแถวเดียว #' . ($i + 1) . ' (' . $x['table'] . ')';
            $fields = ['vn' => $x['vn']];
            foreach (array_values($w['points'] ?? []) as $j => $p) {
                $pt = ['label' => mb_substr(trim(strip_tags((string) ($p['label'] ?? ''))), 0, 40),
                    'dep_mode' => ($p['dep_mode'] ?? 'fixed') === 'clinic' ? 'clinic' : 'fixed',
                    'depcode' => $s($p['depcode'] ?? '')];
                foreach (['arrive', 'start', 'end'] as $k) { $pt[$k] = $s($p[$k] ?? ''); $fields["p{$j}{$k}"] = $pt[$k]; }
                if ($x['enabled']) {
                    if ($pt['dep_mode'] === 'fixed' && !preg_match('/^[A-Za-z0-9_.-]{1,12}$/', $pt['depcode'])) $e[] = "{$label} จุดที่ " . ($j + 1) . ': ต้องระบุรหัสแผนก';
                    if ($pt['arrive'] === '' && $pt['start'] === '' && $pt['end'] === '') $e[] = "{$label} จุดที่ " . ($j + 1) . ': ต้องระบุคอลัมน์เวลาอย่างน้อย 1 คอลัมน์';
                }
                $x['points'][] = $pt;
            }
            if ($x['enabled'] && !$x['points']) $e[] = "{$label}: ยังไม่มีจุดบริการ";
            if ($x['enabled'] && $x['vn'] === '') $e[] = "{$label}: ต้องระบุคอลัมน์ vn";
            $chk($x['table'], $fields, $label, $x['enabled']);
            if ($x['table'] !== '') $wide[] = $x;
        }
        return ['visit' => $visit, 'rows' => $rows, 'wide' => $wide];
    }

    private function num(mixed $v, float $min, float $max, string $label, array &$e): float
    {
        if (!is_numeric($v) || $v < $min || $v > $max) { $e[] = "{$label} ต้องอยู่ระหว่าง {$min}–{$max}"; return $min; }
        return (float) $v;
    }

    public function save(array $clean): void
    {
        $clean['updated_at'] = Config::now()->format(DATE_ATOM);
        Config::writeFile($this->file(), (string) json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        foreach (glob(Config::storage('cache') . '/live-*.php') ?: [] as $c) @unlink($c);
    }
}
