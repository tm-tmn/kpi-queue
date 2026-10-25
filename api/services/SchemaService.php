<?php
declare(strict_types=1);

/**
 * ตรวจโครงสร้างและการบันทึกจริง — ใช้เฉพาะ metadata และ COUNT/SUM แยกตามแผนก
 * ไม่มีคำสั่งใดในไฟล์นี้คืนข้อมูลรายคน
 */
final class SchemaService
{
    private const TIME_TYPES = ['datetime', 'timestamp', 'time', 'timestamp without time zone', 'timestamp with time zone', 'time without time zone'];
    private const DEP_GUESS = ['depcode', 'dep_code', 'cur_dep'];
    private array $memo = [];

    /** @return array<int, array{name:string,type:string,nullable:bool}> */
    public function tableColumns(string $table): array
    {
        if (!Database::validIdent($table)) return [];
        if (isset($this->memo[$table])) return $this->memo[$table];
        if (Database::driver() === 'sqlite') {
            $rows = Database::select('SELECT name AS name, lower(type) AS type, CASE WHEN "notnull" = 1 THEN \'NO\' ELSE \'YES\' END AS nullable FROM pragma_table_info(?)', [$table]);
        } else {
            $rows = Database::select(
                'SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ' . Database::schemaExpr() . ' AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [$table]);
        }
        $rows = array_map(fn($r) => ['name' => (string) ($r['name'] ?? $r['NAME'] ?? ''), 'type' => strtolower((string) ($r['type'] ?? $r['TYPE'] ?? '')),
            'nullable' => strtoupper((string) ($r['nullable'] ?? $r['NULLABLE'] ?? 'YES')) === 'YES'], $rows);
        return $this->memo[$table] = $rows;
    }

    public static function isTime(string $type): bool
    {
        return in_array($type, self::TIME_TYPES, true);
    }

    /**
     * นับย้อนหลัง $days วัน ต่อแผนก: จำนวนแถว, จำนวนวัน, และจำนวนแถวที่มีเวลาจริงของทุกคอลัมน์เวลา
     * @param array $visit settings.source.visit
     */
    public function countCheck(string $table, array $visit, ?string $depCol, ?string $vnCol, string $from): array
    {
        $cols = $this->tableColumns($table);
        if (!$cols) return ['table' => $table, 'exists' => false];
        $names = array_column($cols, 'name');
        $timeCols = array_values(array_filter($cols, fn($c) => self::isTime($c['type'])));
        $out = ['table' => $table, 'exists' => true, 'columns' => $cols, 'time_columns' => array_column($timeCols, 'name')];
        foreach ([$vnCol, $visit['vn'], 'vn'] as $cand) {
            if ($cand && in_array($cand, $names, true)) { $vnCol = $cand; break; }
            $vnCol = null;
        }
        if (!$vnCol) {
            $out['note'] = 'ไม่มีคอลัมน์ vn จึงเชื่อมกับตาราง visit ไม่ได้';
            return $out;
        }
        if (!$depCol || !in_array($depCol, $names, true)) {
            $depCol = null;
            foreach (self::DEP_GUESS as $g) if (in_array($g, $names, true)) { $depCol = $g; break; }
        }
        $q = [Database::class, 'q'];
        $depExpr = $depCol ? 'x.' . $q($depCol) : 'o.' . $q($visit['clinic'] ?: 'main_dep');
        $sums = [];
        foreach ($timeCols as $i => $c) {
            $col = 'x.' . $q($c['name']);
            $sums[] = 'SUM(CASE WHEN ' . $col . ' IS NULL OR ' . Database::text($col) . " IN ('00:00:00','0000-00-00','0000-00-00 00:00:00') THEN 0 ELSE 1 END) AS f{$i}";
        }
        $sql = 'SELECT ' . $depExpr . ' AS depcode, COUNT(*) AS n_rows, COUNT(DISTINCT o.' . $q($visit['date']) . ') AS n_days'
            . ($sums ? ', ' . implode(', ', $sums) : '')
            . ' FROM ' . $q($table) . ' x JOIN ' . $q($visit['table']) . ' o ON o.' . $q($visit['vn']) . ' = x.' . $q($vnCol)
            . ' WHERE o.' . $q($visit['date']) . ' >= ? GROUP BY ' . $depExpr . ' ORDER BY n_rows DESC LIMIT 300';
        $rows = Database::select($sql, [$from]);
        $out['group_by'] = $depCol ? "{$table}.{$depCol}" : "{$visit['table']}." . ($visit['clinic'] ?: 'main_dep');
        $out['rows'] = array_map(function ($r) use ($timeCols) {
            $f = [];
            foreach ($timeCols as $i => $c) $f[$c['name']] = (int) $r["f{$i}"];
            return ['depcode' => (string) $r['depcode'], 'n_rows' => (int) $r['n_rows'], 'n_days' => (int) $r['n_days'], 'filled' => $f];
        }, $rows);
        return $out;
    }

    /** ฐานเทียบ: จำนวน visit ต่อแผนกหลัก */
    public function visitBaseline(array $visit, string $from): array
    {
        $q = [Database::class, 'q'];
        $clinic = $visit['clinic'] ?: 'main_dep';
        $rows = Database::select('SELECT o.' . $q($clinic) . ' AS depcode, COUNT(*) AS n, COUNT(DISTINCT o.' . $q($visit['date']) . ') AS n_days FROM '
            . $q($visit['table']) . ' o WHERE o.' . $q($visit['date']) . ' >= ? GROUP BY o.' . $q($clinic) . ' ORDER BY n DESC LIMIT 300', [$from]);
        return array_map(fn($r) => ['depcode' => (string) $r['depcode'], 'n' => (int) $r['n'], 'n_days' => (int) $r['n_days']], $rows);
    }
}
