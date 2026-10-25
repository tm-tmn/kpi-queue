-- =====================================================================
-- ตรวจว่า รพ. บันทึกเวลาในตารางไหนจริง  (MySQL / MariaDB ของ HOSxP)
-- กติกา: อ่านอย่างเดียว · ใช้ COUNT/SUM เท่านั้น · ไม่ดึงข้อมูลรายคน
-- รันทีละขั้น ด้วย user ที่มีสิทธิ์ SELECT อย่างเดียว (ดูขั้นที่ 0)
-- หน้า settings.html → "ตรวจโครงสร้างตาราง" ทำขั้นที่ 1–3 ให้อัตโนมัติ
-- =====================================================================


-- ---------------------------------------------------------------------
-- ขั้นที่ 0  (ให้ DBA รัน) สร้าง user อ่านอย่างเดียว เฉพาะตารางที่ใช้
-- ---------------------------------------------------------------------
-- CREATE USER 'opdmap_ro'@'10.%' IDENTIFIED BY '<รหัสผ่านยาว>';
-- GRANT SELECT ON hos.ovst              TO 'opdmap_ro'@'10.%';
-- GRANT SELECT ON hos.kskdepartment     TO 'opdmap_ro'@'10.%';
-- GRANT SELECT ON hos.ovst_service_time TO 'opdmap_ro'@'10.%';
-- GRANT SELECT ON hos.service_time      TO 'opdmap_ro'@'10.%';
-- GRANT SELECT ON hos.opd_dep_queue     TO 'opdmap_ro'@'10.%';
-- (ไม่ต้องให้สิทธิ์ตาราง patient — ระบบไม่ใช้ชื่อ-นามสกุล)


-- ---------------------------------------------------------------------
-- ขั้นที่ 1  โครงสร้างตาราง (metadata เท่านั้น)
-- ---------------------------------------------------------------------
SHOW COLUMNS FROM ovst_service_time;
SHOW COLUMNS FROM service_time;
SHOW COLUMNS FROM opd_dep_queue;

-- คอลัมน์วันที่/เวลา และคอลัมน์ที่น่าจะเป็นรหัสแผนก ของทั้ง 3 ตาราง
SELECT c.TABLE_NAME, c.ORDINAL_POSITION, c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE
FROM information_schema.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME IN ('ovst_service_time', 'service_time', 'opd_dep_queue')
  AND (c.DATA_TYPE IN ('datetime', 'timestamp', 'time', 'date')
       OR c.COLUMN_NAME IN ('vn', 'hn', 'depcode', 'dep_code', 'cur_dep', 'main_dep', 'depq', 'oqueue'))
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;


-- ---------------------------------------------------------------------
-- ขั้นที่ 2  ฐานเทียบ: จำนวน visit ต่อแผนกหลัก 7 วันล่าสุด
-- ---------------------------------------------------------------------
SELECT o.main_dep AS depcode, d.department,
       COUNT(*)                  AS visits_7d,
       COUNT(DISTINCT o.vstdate) AS days_with_data
FROM ovst o
LEFT JOIN kskdepartment d ON d.depcode = o.main_dep
WHERE o.vstdate >= CURDATE() - INTERVAL 7 DAY
GROUP BY o.main_dep, d.department
ORDER BY visits_7d DESC;


-- ---------------------------------------------------------------------
-- ขั้นที่ 3  ตัวสร้างคำสั่งนับ: ได้ 1 คำสั่งต่อ 1 ตาราง → copy ผลไปรันต่อ
--   นับต่อแผนก 7 วัน: จำนวนแถว และจำนวนแถวที่ "มีค่าเวลาจริง" ของทุกคอลัมน์เวลา
--   ค่า 00:00:00 / 0000-00-00 ถือว่า "ไม่ได้บันทึก" (HOSxP มักเก็บแบบนี้แทน NULL)
--   แบ่งกลุ่มตามคอลัมน์รหัสแผนกของตารางนั้นถ้ามี ไม่มีก็ใช้ ovst.main_dep
--   ต้องมีคอลัมน์ vn เพื่อเชื่อมกับ ovst
-- ---------------------------------------------------------------------
SET SESSION group_concat_max_len = 1000000;
SELECT t.TABLE_NAME,
       CONCAT(
         'SELECT ''', t.TABLE_NAME, ''' AS tbl, ', dep.expr, ' AS depcode, ',
         'COUNT(*) AS n_rows, COUNT(DISTINCT o.vstdate) AS n_days, ',
         GROUP_CONCAT(
           CONCAT('SUM(CASE WHEN x.`', c.COLUMN_NAME, '` IS NULL OR CAST(x.`', c.COLUMN_NAME,
                  '` AS CHAR) IN (''00:00:00'',''0000-00-00'',''0000-00-00 00:00:00'') THEN 0 ELSE 1 END) AS `filled_',
                  c.COLUMN_NAME, '`')
           ORDER BY c.ORDINAL_POSITION SEPARATOR ', '),
         ' FROM `', t.TABLE_NAME, '` x JOIN ovst o ON o.vn = x.vn',
         ' WHERE o.vstdate >= CURDATE() - INTERVAL 7 DAY',
         ' GROUP BY ', dep.expr, ' ORDER BY n_rows DESC;'
       ) AS sql_to_run
FROM (SELECT DISTINCT TABLE_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('ovst_service_time', 'service_time', 'opd_dep_queue')
        AND COLUMN_NAME = 'vn') t
JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = t.TABLE_NAME
 AND c.DATA_TYPE IN ('datetime', 'timestamp', 'time')
JOIN (SELECT tn.TABLE_NAME,
             COALESCE(
               (SELECT CONCAT('x.`', MIN(k.COLUMN_NAME), '`') FROM information_schema.COLUMNS k
                 WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = tn.TABLE_NAME
                   AND k.COLUMN_NAME IN ('depcode', 'dep_code', 'cur_dep')),
               'o.main_dep') AS expr
      FROM (SELECT DISTINCT TABLE_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME IN ('ovst_service_time', 'service_time', 'opd_dep_queue')) tn) dep
  ON dep.TABLE_NAME = t.TABLE_NAME
GROUP BY t.TABLE_NAME, dep.expr;

-- อ่านผลขั้นที่ 3:
--   filled_<คอลัมน์> / n_rows ≈ 100% ในทุกวัน  → จุดนั้นกดบันทึกเวลาจริง ใช้คำนวณได้
--   ≈ 0%                                        → ไม่มีการบันทึก ไม่ควรเลือกคอลัมน์นี้
--   แผนกที่ไม่โผล่เลย                           → ตารางนี้ไม่เก็บเวลาของแผนกนั้น
