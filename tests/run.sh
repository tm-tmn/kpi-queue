#!/usr/bin/env bash
# รันการทดสอบทั้งหมด: E2E_PASS=<รหัสผู้ดูแลทดสอบ> bash tests/run.sh [three.min.js] [base_url]
# ต้องมี: node, php (pdo_mysql), MariaDB ที่โหลด tests/fixture.sql ลงฐาน hos_fix และ user opdmap_ro
#        สำหรับ e2e: python3 + playwright, php -S ที่ base_url โดย api/config.php ชี้ฐานทดสอบ (env=dev)
set -e
cd "$(dirname "$0")/.."
echo "== JS unit"; node tests/metrics.test.js
echo "== PHP"; php tests/api.test.php
if [ -n "$1" ] && [ -n "$2" ]; then
  echo "== e2e"; python3 tools/build_single.py /tmp/kq-single.html >/dev/null
  python3 tests/e2e.py "$1" /tmp/kq-single.html "$2" /tmp
fi
