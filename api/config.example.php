<?php
// คัดลอกเป็น api/config.php แล้วใส่ค่าจริง (config.php ไม่ถูก commit)
return [
    'db' => [
        'dsn'  => 'mysql:host=127.0.0.1;port=3306;dbname=hos;charset=utf8mb4',
        'user' => 'readonly_user',   // ใช้ user อ่านอย่างเดียว
        'pass' => 'change-me',
    ],
    // ส่งกลับเฉพาะ 4 ตัวท้ายของ HN เสมอ
    'hn_mask_digits' => 4,
];
