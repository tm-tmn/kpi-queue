<?php
declare(strict_types=1);

/**
 * ภาพคิวผู้ป่วยนอกวันนี้ จาก HIS (อ่านอย่างเดียว)
 *
 * ส่งออกเฉพาะ: รหัสอ้างอิงรายวัน (hash ของ VN), เลขคิว, HN 4 ตัวท้าย, รหัสแผนก, เวลา (นาทีนับจาก 00:00)
 * ไม่ส่ง: VN, HN เต็ม, ชื่อ-นามสกุล, และไม่ query ตาราง patient เลย
 *
 * แต่ละจุดบริการมีเวลา 3 ค่า  a = เข้าคิว/มาถึง  s = เรียก/เริ่มบริการ  e = เสร็จ/ออก
 *   เวลารอ        = s − a
 *   เวลาให้บริการ = e − s
 * เมื่อไม่ได้บันทึก (NULL หรือ 00:00:00) จะเติมตามกฎใน normalize() และติดธงให้หน้าจอแสดงต่างออกไป
 */
final class LiveService
{
    public function __construct(private array $settings, private SchemaService $schema) {}

    public function snapshot(DateTimeImmutable $now): array
    {
        $date = $now->format('Y-m-d');
        $nowMin = (int) $now->format('G') * 60 + (int) $now->format('i') + (int) $now->format('s') / 60;
        $src = $this->settings['source'];
        $V = $src['visit'];
        $q = [Database::class, 'q'];
        $warn = [];
        $used = [];

        /* 1) visit วันนี้ — ดึงเฉพาะ 4 ตัวท้ายของ HN ตั้งแต่ใน SQL */
        $sel = ['v.' . $q($V['vn']) . ' AS vn', 'RIGHT(' . Database::text('v.' . $q($V['hn'])) . ', 4) AS hn4'];
        $sel[] = ($V['queue'] ?? '') !== '' ? 'v.' . $q($V['queue']) . ' AS q' : 'NULL AS q';
        $sel[] = ($V['clinic'] ?? '') !== '' ? 'v.' . $q($V['clinic']) . ' AS clinic' : 'NULL AS clinic';
        $sel[] = ($V['time'] ?? '') !== '' ? 'v.' . $q($V['time']) . ' AS t' : 'NULL AS t';
        $rows = Database::select('SELECT ' . implode(', ', $sel) . ' FROM ' . $q($V['table']) . ' v WHERE v.' . $q($V['date']) . ' = ?', [$date]);
        $visits = [];
        foreach ($rows as $r) {
            $visits[(string) $r['vn']] = ['hn4' => (string) $r['hn4'], 'q' => self::str($r['q']), 'clinic' => self::str($r['clinic']),
                'vt' => self::toMin($r['t'], $date, $nowMin), 'steps' => []];
        }
        $join = ' JOIN ' . $q($V['table']) . ' v ON v.' . $q($V['vn']) . ' = x.%s WHERE v.' . $q($V['date']) . ' = ?';

        /* 2) แหล่งเวลาแบบ 1 แถวต่อ 1 แผนก (เช่น opd_dep_queue) */
        foreach ($src['rows'] as $R) {
            if (empty($R['enabled'])) continue;
            $c = fn($k, $as) => ($R[$k] ?? '') !== '' ? 'x.' . $q($R[$k]) . ' AS ' . $as : 'NULL AS ' . $as;
            $sql = 'SELECT x.' . $q($R['vn']) . ' AS vn, ' . $c('depcode', 'dep') . ', ' . $c('queue', 'q') . ', '
                . $c('arrive', 'a') . ', ' . $c('start', 's') . ', ' . $c('end', 'e')
                . ' FROM ' . $q($R['table']) . ' x' . sprintf($join, $q($R['vn']));
            $n = 0;
            foreach (Database::select($sql, [$date]) as $r) {
                $vn = (string) $r['vn'];
                if (!isset($visits[$vn])) continue;
                $visits[$vn]['steps'][] = ['dep' => self::str($r['dep']), 'q' => self::str($r['q']),
                    'a' => self::toMin($r['a'], $date, $nowMin), 's' => self::toMin($r['s'], $date, $nowMin), 'e' => self::toMin($r['e'], $date, $nowMin)];
                $n++;
            }
            $used[] = ['table' => $R['table'], 'kind' => 'rows', 'rows' => $n];
        }

        /* 3) แหล่งเวลาแบบหลายจุดในแถวเดียว (เช่น service_time) */
        foreach ($src['wide'] as $W) {
            if (empty($W['enabled']) || !$W['points']) continue;
            $sel = ['x.' . $q($W['vn']) . ' AS vn'];
            foreach ($W['points'] as $j => $p) {
                foreach (['arrive' => 'a', 'start' => 's', 'end' => 'e'] as $k => $al) {
                    $sel[] = ($p[$k] ?? '') !== '' ? 'x.' . $q($p[$k]) . " AS p{$j}{$al}" : "NULL AS p{$j}{$al}";
                }
            }
            $n = 0;
            foreach (Database::select('SELECT ' . implode(', ', $sel) . ' FROM ' . $q($W['table']) . ' x' . sprintf($join, $q($W['vn'])), [$date]) as $r) {
                $vn = (string) $r['vn'];
                if (!isset($visits[$vn])) continue;
                foreach ($W['points'] as $j => $p) {
                    $dep = $p['dep_mode'] === 'clinic' ? $visits[$vn]['clinic'] : $p['depcode'];
                    $visits[$vn]['steps'][] = ['dep' => $dep, 'q' => null,
                        'a' => self::toMin($r["p{$j}a"], $date, $nowMin), 's' => self::toMin($r["p{$j}s"], $date, $nowMin), 'e' => self::toMin($r["p{$j}e"], $date, $nowMin)];
                }
                $n++;
            }
            $used[] = ['table' => $W['table'], 'kind' => 'wide', 'rows' => $n];
        }
        if (!$used) $warn[] = 'ยังไม่ได้เลือกตารางเวลาในหน้าตั้งค่า จึงเห็นเฉพาะจำนวนผู้มารับบริการ';

        /* 4) รหัสแผนก → จุดบริการ */
        $depSt = [];
        foreach ($this->settings['stations'] as $id => $st) foreach ($st['depcodes'] as $d) $depSt[$d] = $id;

        $th = $this->settings['thresholds'];
        $secret = (string) Config::get('secret', '');
        $out = [];
        $deps = [];
        $unmapped = [];
        foreach ($visits as $vn => $v) {
            $steps = $this->normalize($v, $depSt, $nowMin, (int) $th['stale_minutes']);
            $arr = $v['vt'] ?? ($steps[0]['a'] ?? null);
            if ($arr === null) continue;
            [$done, $di] = $this->finished($steps, $nowMin, (int) $th['idle_minutes']);
            if ($v['clinic'] !== null) $deps[$v['clinic']] = true;
            foreach ($steps as $s) {
                if ($s['dep'] !== null) $deps[$s['dep']] = true;
                if ($s['st'] === null && $s['dep'] !== null) {
                    $u = &$unmapped[$s['dep']];
                    $u = $u ?? ['steps' => 0, 'waiting' => 0];
                    $u['steps']++;
                    if ($s['s'] === null && $s['e'] === null && !$s['stale']) $u['waiting']++;
                    unset($u);
                }
            }
            $out[] = ['id' => substr(hash_hmac('sha256', $date . '|' . $vn, $secret), 0, 12), 'q' => $v['q'], 'hn4' => $v['hn4'], 'clinic' => $v['clinic'],
                'arr' => self::r($arr), 'done' => self::r($done), 'di' => $di, 'steps' => array_map([self::class, 'compact'], $steps)];
        }

        return [
            'mode' => 'live', 'generated' => $now->format(DATE_ATOM), 'date' => $date, 'now' => self::r($nowMin),
            'sources' => $used, 'warnings' => $warn, 'unmapped' => $unmapped,
            'deps' => $this->depNames(array_keys($deps)), 'visits' => $out,
        ];
    }

    /**
     * กฎเมื่อจุดไม่ได้กดบันทึกเวลา
     *  - ไม่มีเวลาเข้า (a): ใช้เวลาเสร็จของจุดก่อนหน้า (หรือเวลามา รพ. สำหรับจุดแรก) → ia = 1 "อนุมาน"
     *                        ถ้าอนุมานไม่ได้ ให้ a = s หรือ e → ia = 2 "ไม่ทราบเวลารอ" (ไม่นับในค่าเฉลี่ย)
     *  - ไม่มีเวลาเรียก (s): เวลารอ = ไม่ทราบ ไม่นับในค่าเฉลี่ย แต่ยังนับจำนวนผู้รอ/ผู้รับบริการ
     *  - ไม่มีเวลาเสร็จ (e) แต่ไปจุดถัดไปแล้ว: ใช้เวลาเข้าจุดถัดไปแทน → ie = 1
     *  - รอนานเกิน stale_minutes โดยไม่มีเวลาเรียก/เสร็จ: stale = 1 "ค้างในระบบ" ไม่นับเป็นผู้รอ
     */
    private function normalize(array $v, array $depSt, float $nowMin, int $stale): array
    {
        $raw = array_values(array_filter($v['steps'], fn($s) => $s['a'] !== null || $s['s'] !== null || $s['e'] !== null));
        usort($raw, fn($x, $y) => ($x['a'] ?? $x['s'] ?? $x['e']) <=> ($y['a'] ?? $y['s'] ?? $y['e']));
        $out = [];
        $n = count($raw);
        foreach ($raw as $i => $s) {
            $a = $s['a']; $st = $s['s']; $e = $s['e']; $ia = 0; $ie = 0;
            if ($a === null) {
                $p = $i > 0 ? $out[$i - 1] : null;
                $cand = $p ? ($p['e'] ?? $p['s'] ?? $p['a']) : $v['vt'];
                $first = $st ?? $e;
                if ($cand !== null && ($first === null || $cand <= $first)) { $a = $cand; $ia = 1; }
                else { $a = $first; $ia = 2; }
            }
            if ($e === null && $i + 1 < $n) {
                $nx = $raw[$i + 1]['a'] ?? $raw[$i + 1]['s'] ?? $raw[$i + 1]['e'];
                if ($nx !== null && $nx >= max($a, $st ?? $a)) { $e = $nx; $ie = 1; }
            }
            $isStale = $st === null && $e === null && $nowMin - $a > $stale ? 1 : 0;
            $out[] = ['st' => $depSt[$s['dep'] ?? ''] ?? null, 'dep' => $s['dep'], 'q' => $s['q'], 'a' => $a, 's' => $st, 'e' => $e,
                'ia' => $ia, 'ie' => $ie, 'stale' => $isStale];
        }
        return $out;
    }

    /** กลับบ้านแล้ว = รับยาเสร็จ หรือไม่มีความเคลื่อนไหวนานเกิน idle_minutes หลังจุดสุดท้ายเสร็จ (di = 1 อนุมาน) */
    private function finished(array $steps, float $nowMin, int $idle): array
    {
        if (!$steps) return [null, 0];
        foreach (array_reverse($steps) as $s) {
            if ($s['st'] !== null && ($this->settings['stations'][$s['st']]['phase'] ?? '') === 'pha' && $s['e'] !== null) return [$s['e'], 0];
        }
        $last = end($steps);
        $lastT = $last['e'] ?? null;
        if ($last['stale']) return [$last['a'], 1];
        if ($lastT !== null && $nowMin - $lastT > $idle) return [$lastT, 1];
        return [null, 0];
    }

    private function depNames(array $codes): array
    {
        $codes = array_values(array_filter($codes, fn($c) => $c !== null && $c !== ''));
        if (!$codes) return [];
        $names = [];
        try {
            foreach (array_chunk($codes, 400) as $chunk) {
                $in = implode(',', array_fill(0, count($chunk), '?'));
                foreach (Database::select('SELECT depcode, department FROM kskdepartment WHERE depcode IN (' . $in . ')', $chunk) as $r) {
                    $names[(string) $r['depcode']] = (string) $r['department'];
                }
            }
        } catch (Throwable $e) {
            error_log('[opd-map] kskdepartment: ' . $e->getMessage());
        }
        return $names;
    }

    /** แปลงค่าเวลา (TIME หรือ DATETIME) เป็นนาทีนับจาก 00:00 ของวันนี้; 00:00:00 / วันอื่น / อนาคต = ไม่ได้บันทึก */
    public static function toMin(mixed $val, string $date, float $nowMin): ?float
    {
        if ($val === null) return null;
        $s = trim((string) $val);
        if ($s === '' || $s === '00:00:00' || str_starts_with($s, '0000-00-00')) return null;
        if (preg_match('/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/', $s, $m)) {
            if ($m[1] !== $date) return null;
            $h = (int) $m[2]; $i = (int) $m[3]; $sec = (int) ($m[4] ?? 0);
        } elseif (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?/', $s, $m)) {
            $h = (int) $m[1]; $i = (int) $m[2]; $sec = (int) ($m[3] ?? 0);
        } else {
            return null;
        }
        $min = $h * 60 + $i + $sec / 60;
        return $min > $nowMin + 2 ? null : $min;
    }

    /** ตัดค่าว่าง/ธงที่เป็น 0 ออกเพื่อลดขนาด (หน้าจอถือว่าไม่มี = null/0) */
    private static function compact(array $s): array
    {
        $o = ['st' => $s['st'], 'dep' => $s['dep'], 'a' => self::r($s['a'])];
        if ($s['s'] !== null) $o['s'] = self::r($s['s']);
        if ($s['e'] !== null) $o['e'] = self::r($s['e']);
        if ($s['q'] !== null) $o['q'] = $s['q'];
        foreach (['ia', 'ie', 'stale'] as $k) if ($s[$k]) $o[$k] = $s[$k];
        return $o;
    }

    private static function str(mixed $v): ?string
    {
        return $v === null || $v === '' ? null : (string) $v;
    }

    private static function r(?float $v): ?float
    {
        return $v === null ? null : round($v, 1);
    }
}
