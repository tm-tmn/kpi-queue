<?php
// คัดลอกเป็น api/config.php แล้วใส่ค่าจริง (config.php ไม่ถูก commit)
return [
    'env'      => 'production',          // 'dev' เท่านั้นที่ใช้ debug_now ได้
    'timezone' => 'Asia/Bangkok',

    // ใช้ user ที่มีสิทธิ์ SELECT อย่างเดียว (ดู sql/01_check_tables.sql ขั้นที่ 0)
    'db' => [
        'dsn'  => 'mysql:host=10.0.0.10;port=3306;dbname=hos;charset=utf8mb4',
        'user' => 'opdmap_ro',
        'pass' => 'change-me',
    ],
    'query_timeout_ms' => 8000,

    // รหัสผ่านผู้ดูแลหน้าตั้งค่า: php -r "echo password_hash('รหัสผ่าน', PASSWORD_DEFAULT), PHP_EOL;"
    'admin_username'      => 'administrator',   // เว้นว่าง = ใช้รหัสผ่านอย่างเดียว
    'admin_password_hash' => '',

    // ข้อความสุ่มยาว ๆ ใช้สร้างรหัสอ้างอิงผู้ป่วยรายวัน แทนการส่ง VN ออกไปหน้าจอ
    'secret' => 'change-me-to-a-long-random-string',

    // เก็บ settings.json และแคช — ควรอยู่นอก web root หรือปิดการเข้าถึง
    'storage_dir'   => __DIR__ . '/../storage',
    'cache_seconds' => 25,                // หลายจอเปิดพร้อมกัน ฐานข้อมูลถูกถามไม่เกิน 1 ครั้งต่อรอบ

    // เฉพาะ env = dev: ใช้ทดสอบนอกเวลาทำการ เช่น '2026-10-25 10:30:00'
    'debug_now' => null,
];
