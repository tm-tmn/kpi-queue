/* สร้างหน้า GitHub Pages ที่ต้องใส่ชื่อผู้ใช้และรหัสผ่านก่อนเปิด
   - เนื้อหาทั้งหน้า (โหมดข้อมูลสมมติ) ถูกเข้ารหัส AES-256-GCM ด้วยกุญแจจาก PBKDF2(ชื่อผู้ใช้ + รหัสผ่าน)
   - ไม่มีรหัสผ่านหรือ hash เก็บไว้ในไฟล์ ถ้าไม่มีรหัสที่ถูกต้องก็ถอดเนื้อหาไม่ได้
   ใช้:  PAGES_USER=administrator PAGES_PASS='...' node tools/build_pages.js dist/pages
   (ต้องรัน python3 tools/build_single.py ก่อน หรือให้สคริปต์นี้เรียกเอง) */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');

const user = process.env.PAGES_USER, pass = process.env.PAGES_PASS;
if (!user || !pass) { console.error('ต้องตั้ง PAGES_USER และ PAGES_PASS'); process.exit(1); }
const out = path.resolve(process.argv[2] || 'dist/pages');
const root = path.resolve(__dirname, '..');
const single = path.join(out, '.app.html');
fs.mkdirSync(out, { recursive: true });
execFileSync('python3', [path.join(root, 'tools/build_single.py'), single]);
const html = fs.readFileSync(single, 'utf8');
fs.unlinkSync(single);

const ITER = 310000;
const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(Buffer.from(user + '\n' + pass, 'utf8'), salt, ITER, 32, 'sha256');
const c = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([c.update(html, 'utf8'), c.final(), c.getAuthTag()]);   // WebCrypto ต้องการ tag ต่อท้าย
const b64 = b => b.toString('base64');

const page = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>ผังเวลารอ OPD ศรีนครินทร์</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:wght@600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap">
<style>
:root { --bg: #EEF2F0; --surface: #FFFFFF; --ink: #14221C; --muted: #5A6B63; --line: #D6DFDA; --accent: #0B6A4E; --accent-ink: #FFFFFF; --bad: #D23F3A; --flag-bg: #FFF3CC; --flag-ink: #6B4B00; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #0C1411; --surface: #131D19; --ink: #E2ECE7; --muted: #8FA39A; --line: #26352E; --accent: #4CC08E; --accent-ink: #062018; --bad: #F2655B; --flag-bg: #3A2F12; --flag-ink: #F6D58A; color-scheme: dark; } }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--ink); font: 15px/1.5 "IBM Plex Sans Thai", system-ui, sans-serif; display: grid; place-items: center;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
.card { width: min(400px, 100%); background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 24px; box-shadow: 0 12px 40px rgba(0,0,0,.08); }
.mark { width: 44px; height: 44px; border-radius: 11px; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; margin-bottom: 14px; }
h1 { margin: 0; font: 700 21px/1.25 "Bai Jamjuree", "IBM Plex Sans Thai", sans-serif; text-wrap: balance; }
p.sub { margin: 4px 0 18px; color: var(--muted); font-size: 13px; }
label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
input { width: 100%; height: 42px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); padding: 0 12px; font: inherit; font-size: 15px; }
input:focus { outline: 2px solid var(--accent); border-color: transparent; }
button { width: 100%; height: 44px; margin-top: 18px; border: 0; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font: 600 15px "IBM Plex Sans Thai", sans-serif; cursor: pointer; }
button:disabled { opacity: .6; cursor: progress; }
button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.err { color: var(--bad); font-size: 13px; margin: 10px 0 0; min-height: 1.5em; }
.note { margin: 16px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--flag-bg); color: var(--flag-ink); font-size: 12px; }
</style>
</head>
<body>
<form class="card" id="gate" autocomplete="on">
  <div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z" fill="currentColor"/></svg></div>
  <h1>ผังเวลารอผู้ป่วยนอก</h1>
  <p class="sub">โรงพยาบาลศรีนครินทร์ · กรุณาเข้าสู่ระบบเพื่อดูต้นแบบ</p>
  <label for="u">ชื่อผู้ใช้</label>
  <input id="u" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required>
  <label for="p">รหัสผ่าน</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  <button id="go" type="submit">เข้าสู่ระบบ</button>
  <p class="err" id="err" role="alert"></p>
  <p class="note">หน้านี้เป็นต้นแบบที่ใช้ข้อมูลสมมติทั้งหมด ไม่มีข้อมูลผู้ป่วยจริง</p>
</form>
<script>
(function () {
  var D = { s: '${b64(salt)}', i: '${b64(iv)}', c: '${b64(ct)}', n: ${ITER} };
  var bin = function (b) { var s = atob(b), a = new Uint8Array(s.length); for (var k = 0; k < s.length; k++) a[k] = s.charCodeAt(k); return a; };
  var KEY = 'kq-gate-key';
  function show(html) { document.open(); document.write(html); document.close(); }
  async function decrypt(raw) {
    var key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bin(D.i) }, key, bin(D.c));
    return new TextDecoder().decode(pt);
  }
  async function derive(u, p) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(u + '\\n' + p), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: bin(D.s), iterations: D.n, hash: 'SHA-256' }, base, 256));
  }
  var saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch (e) {}
  if (saved) decrypt(bin(saved)).then(show, function () { try { sessionStorage.removeItem(KEY); } catch (e) {} });
  document.getElementById('gate').addEventListener('submit', async function (e) {
    e.preventDefault();
    var b = document.getElementById('go'), er = document.getElementById('err');
    if (!window.crypto || !crypto.subtle) { er.textContent = 'เบราว์เซอร์นี้ไม่รองรับการถอดรหัส ลองเปิดด้วย Chrome, Edge หรือ Safari รุ่นใหม่'; return; }
    b.disabled = true; b.textContent = 'กำลังตรวจสอบ…'; er.textContent = '';
    try {
      var raw = await derive(document.getElementById('u').value.trim(), document.getElementById('p').value);
      var html = await decrypt(raw);
      try { sessionStorage.setItem(KEY, btoa(String.fromCharCode.apply(null, raw))); } catch (x) {}
      show(html);
    } catch (x) {
      er.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      b.disabled = false; b.textContent = 'เข้าสู่ระบบ';
      document.getElementById('p').select();
    }
  });
})();
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('built', path.join(out, 'index.html'), Math.round(page.length / 1024) + ' KB');
