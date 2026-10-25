<?php
declare(strict_types=1);

/**
 * เส้นทางผู้ป่วยนอกวันนี้ ในรูปแบบเดียวกับตัวจำลองใน js/sim.js:
 *   [{ hn4, clinic, steps: [{ depcode, arrive, start, end }] }]   (เวลาเป็นนาทีนับจาก 00:00)
 *
 * ยังไม่เปิดใช้: ต้องยืนยันก่อนว่าเวลาเข้า/เรียก/ออกของแต่ละจุดเก็บในตารางใด
 * (เช่น ovst + ตารางบันทึกเวลาให้บริการของ รพ.) — SQL ด้านล่างเป็นโครง รอแก้ตามโครงสร้างจริง
 */
final class QueueService
{
    public function __construct(private PDO $db, private int $maskDigits = 4) {}

    public function today(): array
    {
        $sql = <<<SQL
            -- TODO: แทนด้วยตาราง/คอลัมน์จริงที่บันทึกเวลาในแต่ละจุดบริการ
            SELECT o.vn, o.hn, o.main_dep AS clinic,
                   t.depcode, t.in_time, t.call_time, t.out_time
            FROM ovst o
            JOIN service_point_time t ON t.vn = o.vn      -- ชื่อตารางสมมติ
            WHERE o.vstdate = CURDATE()
            ORDER BY o.vn, t.in_time
        SQL;
        $rows = $this->db->query($sql)->fetchAll();

        $out = [];
        foreach ($rows as $r) {
            $vn = $r['vn'];
            $out[$vn] ??= [
                'hn4'    => substr((string) $r['hn'], -$this->maskDigits),   // ไม่ส่ง HN เต็มและไม่ส่งชื่อ
                'clinic' => $r['clinic'],
                'steps'  => [],
            ];
            $out[$vn]['steps'][] = [
                'depcode' => $r['depcode'],
                'arrive'  => self::min($r['in_time']),
                'start'   => self::min($r['call_time']),
                'end'     => self::min($r['out_time']),
            ];
        }
        return array_values($out);
    }

    private static function min(?string $hhmmss): ?float
    {
        if (!$hhmmss) return null;
        [$h, $m, $s] = array_map('intval', explode(':', $hhmmss) + [0, 0, 0]);
        return $h * 60 + $m + $s / 60;
    }
}
