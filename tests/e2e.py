"""ทดสอบผ่านเบราว์เซอร์: python3 tests/e2e.py <three.min.js> <single.html> <base_url>
ต้องเปิด php -S ที่ base_url (api/config.php ชี้ฐานทดสอบ, env=dev, debug_now)"""
import asyncio, sys, json, subprocess, os
USER = os.environ.get('E2E_USER', 'administrator'); PASS = os.environ['E2E_PASS']   # ไม่เก็บรหัสผ่านไว้ในโค้ด
from playwright.async_api import async_playwright
THREE = open(sys.argv[1]).read(); SINGLE = sys.argv[2]; B = sys.argv[3]; OUT = sys.argv[4] if len(sys.argv) > 4 else '/tmp'
fails = []
def check(name, cond, info=''):
    print(('ok   - ' if cond else 'FAIL - ') + name + (' ' + str(info) if info and not cond else ''))
    if not cond: fails.append(name)

async def page(ctx, errs):
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'Failed to load resource' not in m.text else None)
    return pg

async def no_hscroll(pg):
    return await pg.evaluate('document.scrollingElement.scrollWidth <= window.innerWidth + 1')

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        async def mkctx(**kw):
            c = await br.new_context(**kw)
            await c.route('**/three.min.js', lambda r: r.fulfill(body=THREE, content_type='application/javascript'))
            await c.route('**fonts.g**', lambda r: r.abort())
            return c

        # ---------- 1) ไฟล์เดี่ยว = ข้อมูลสมมติ ----------
        errs = []; ctx = await mkctx(viewport={'width': 1366, 'height': 900}); pg = await page(ctx, errs)
        await pg.goto('file://' + SINGLE); await pg.wait_for_timeout(2500)
        check('sim: ป้ายข้อมูลสมมติ', 'ข้อมูลสมมติ' in await pg.inner_text('#simFlag'))
        check('sim: มีตัวเลขผู้รับบริการ', (await pg.inner_text('#kToday')).replace(',', '').isdigit())
        rows = await pg.eval_on_selector_all('#tbody tr[data-st]', 'r => r.map(x => x.dataset.st)')
        check('sim: ตารางครบ 19 จุด', len(rows) == 19, len(rows))
        for st in rows:                               # เปิดทุกจุดบริการ (ทุกอาคาร/ชั้น)
            await pg.evaluate(f"document.querySelector('#tbody tr[data-st={st}]').click()"); await pg.wait_for_timeout(260)
            t = await pg.inner_text('#panelBody')
            if 'เวลารอเฉลี่ย' not in t and 'เวลาอยู่ที่จุด' not in t: check('sim: แผงห้อง ' + st, False, t[:80])
        check('sim: เปิดแผงทุกจุดได้', not [e for e in errs if 'PAGEERR' in e], errs[:3])
        await pg.evaluate("document.querySelector('#tbody tr[data-st=DOC_MED]').click()"); await pg.wait_for_timeout(400)
        await pg.evaluate("var b=document.querySelector('.q-row'); b && b.click()"); await pg.wait_for_timeout(400)
        check('sim: แผงผู้ป่วย', 'เส้นทางตั้งแต่ยื่นบัตรถึงรับยา' in await pg.inner_text('#panelBody'))
        await pg.click('#goPerson'); await pg.wait_for_timeout(500)
        await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(500)
        check('sim: Esc กลับภาพรวม', 'ภาพรวมโรงพยาบาล' in await pg.inner_text('#crumbs'))
        for b in ['#rotL', '#rotR', '#zIn', '#zOut', '#fitBtn']: await pg.click(b)
        await pg.click('[data-speed="60"]'); await pg.wait_for_timeout(1500)
        await pg.fill('#scrub', '480'); await pg.dispatch_event('#scrub', 'input'); await pg.wait_for_timeout(300)
        check('sim: เลื่อนเวลาได้', (await pg.inner_text('#clockOut')).startswith('08:0'))
        await pg.click('#kpiBtn'); await pg.fill('#kpi-doc', '45'); await pg.click('#kpiForm button[type=submit]'); await pg.wait_for_timeout(400)
        kpis = await pg.eval_on_selector_all('#tbody tr', 'r => r.map(x => x.children[6] && x.children[6].innerText)')
        check('sim: แก้ KPI ในโหมดสมมติ', '45' in kpis)
        await pg.click('#themeBtn'); await pg.wait_for_timeout(400)
        bg = await pg.evaluate("getComputedStyle(document.body).backgroundColor")
        check('sim: โหมดมืดเปลี่ยนพื้นหลัง', bg != 'rgb(238, 242, 240)', bg)
        await pg.screenshot(path=OUT + '/e2e_sim_dark.png')
        check('sim: ไม่มี JS error', not errs, errs[:5])
        await ctx.close()

        # ---------- 2) live ----------
        errs = []; ctx = await mkctx(viewport={'width': 1366, 'height': 900}); pg = await page(ctx, errs)
        await pg.goto(B + '/index.html'); await pg.wait_for_timeout(3000)
        check('live: ป้ายข้อมูลจริง', 'ข้อมูลจริงจาก HIS' in await pg.inner_text('#simFlag'), await pg.inner_text('#simFlag'))
        check('live: ซ่อนตัวเลื่อนเวลา', not await pg.is_visible('#scrub'))
        check('live: ปุ่มตั้งค่า', (await pg.inner_text('#kpiBtn')).strip() == 'ตั้งค่า')
        rows = await pg.eval_on_selector_all('#tbody tr[data-st]', 'r => r.map(x => x.dataset.st)')
        for st in rows:
            await pg.evaluate(f"document.querySelector('#tbody tr[data-st={st}]').click()"); await pg.wait_for_timeout(250)
        check('live: เปิดแผงทุกจุดได้ ไม่มี error', not errs, errs[:3])
        xr = await pg.evaluate("[...document.querySelectorAll('#tbody tr[data-st=XRAY] td')].map(t=>t.innerText)")
        check('live: จุดไม่มีข้อมูลแสดง "ไม่มีข้อมูล"', 'ไม่มีข้อมูล' in ' '.join(xr), xr)
        reg = await pg.evaluate("[...document.querySelectorAll('#tbody tr[data-st=REG] td')].map(t=>t.innerText)")
        check('live: จุดไม่มีเวลาเรียกใช้ค่า ≈', any(c.startswith('≈') for c in reg), reg)
        html = await pg.content()
        check('live: ไม่มีชื่อผู้ป่วยในหน้า', 'ทดสอบ' not in html)
        await pg.evaluate("document.querySelector('#tbody tr[data-st=DOC_MED]').click()"); await pg.wait_for_timeout(400)
        hns = await pg.eval_on_selector_all('.q-row .hn', 'r => r.map(x => x.childNodes[0].textContent)')
        check('live: HN แสดง 4 ตัวท้าย', hns and all(h.startswith('HN •••') and len(h) == 10 for h in hns[:20]), hns[:3])
        await pg.evaluate("document.querySelector('.q-row').click()"); await pg.wait_for_timeout(400)
        t = await pg.inner_text('#panelBody')
        check('live: แผงผู้ป่วยแสดงขั้นถัดไปยังไม่ทราบ', 'ยังไม่ทราบ' in t)
        await pg.screenshot(path=OUT + '/e2e_live.png')

        # ---------- 3) HIS ล่ม ----------
        n0 = await pg.inner_text('#kToday')
        subprocess.run(['bash', '-c', 'touch -d "-60 seconds" storage/cache/live-*.json.php; service mariadb stop >/dev/null 2>&1 || mysqladmin -uroot shutdown'], cwd='.')
        await pg.evaluate("window.__poll = true"); await pg.wait_for_timeout(32000)
        flag = await pg.inner_text('#simFlag')
        check('ล่ม: ขึ้นป้ายเตือน', 'เชื่อมต่อ HIS ไม่ได้' in flag or 'แสดงข้อมูลล่าสุด' in flag, flag)
        n1 = int((await pg.inner_text('#kToday')).replace(',', '') or 0)
        check('ล่ม: ข้อมูลเดิมยังอยู่', abs(n1 - int(n0.replace(',', ''))) <= 15 and n1 > 0, (n0, n1))
        check('ล่ม: ป้ายบอกว่าเป็นข้อมูลเก่า ไม่ใช่ "อัปเดตเมื่อสักครู่"', 'ที่ได้ล่าสุด' in flag, flag)
        check('ล่ม: ไม่สลับไปข้อมูลสมมติ', 'ข้อมูลสมมติ' not in flag)
        await pg.screenshot(path=OUT + '/e2e_down.png')
        subprocess.run(['bash', '-c', 'service mariadb start >/dev/null 2>&1; sleep 3'])
        check('ล่ม: ไม่มี JS error', not errs, errs[:3])
        await ctx.close()

        # ---------- 4) หน้าตั้งค่า ----------
        errs = []; ctx = await mkctx(viewport={'width': 1366, 'height': 900}); sp = await page(ctx, errs)
        r = await ctx.request.post(B + '/api/settings.php', data='{}', headers={'Content-Type': 'application/json'})
        check('ตั้งค่า: บันทึกโดยไม่เข้าสู่ระบบถูกปฏิเสธ', r.status == 401, r.status)
        r = await ctx.request.get(B + '/api/schema.php?check=1')
        check('ตั้งค่า: ตรวจตารางโดยไม่เข้าสู่ระบบถูกปฏิเสธ', r.status == 401, r.status)
        r = await ctx.request.get(B + '/api/settings.php'); d = await r.json()
        check('ตั้งค่า: GET สาธารณะไม่มีโครงสร้างฐานข้อมูล', 'source' not in d)
        for path in ['/api/config.php', '/storage/settings.json.php', '/storage/cache/live-20261025.json.php']:
            rr = await ctx.request.get(B + path); body = await rr.text()
            check('ไม่รั่ว: ' + path, 'admin_password_hash' not in body and '"source"' not in body, rr.status)
        await sp.goto(B + '/settings.html'); await sp.wait_for_timeout(800)
        await sp.fill('#user', USER); await sp.fill('#pw', 'wrong-' + PASS); await sp.click('#loginForm button'); await sp.wait_for_timeout(1500)
        check('ตั้งค่า: รหัสผิดขึ้นข้อความ', 'ไม่ถูกต้อง' in await sp.inner_text('#loginErr'))
        await sp.fill('#user', USER + 'x'); await sp.fill('#pw', PASS); await sp.click('#loginForm button'); await sp.wait_for_timeout(1500)
        check('ตั้งค่า: ชื่อผู้ใช้ผิดเข้าไม่ได้', await sp.is_visible('#loginCard'))
        await sp.fill('#user', USER); await sp.fill('#pw', PASS); await sp.click('#loginForm button'); await sp.wait_for_timeout(2000)
        check('ตั้งค่า: เข้าสู่ระบบได้', await sp.is_visible('#appArea'))
        await sp.fill('[data-k="kpi.doc"]', '50'); await sp.fill('[data-k="poll_seconds"]', '15')
        await sp.select_option('[data-k="source.rows.0.start"]', 'time_out'); await sp.select_option('[data-k="source.rows.0.start"]', 'time_call')
        await sp.click('#saveBtn'); await sp.wait_for_timeout(1500)
        check('ตั้งค่า: บันทึกสำเร็จ', 'บันทึกแล้ว' in await sp.inner_text('#saveMsg'), await sp.inner_text('#saveMsg'))
        await sp.fill('[data-k="stations.FIN.depcodes"]', '090, 011'); await sp.click('#saveBtn'); await sp.wait_for_timeout(1200)
        check('ตั้งค่า: แสดงข้อผิดพลาดรหัสซ้ำ', 'ซ้ำ' in await sp.inner_text('#saveErr'))
        await sp.fill('[data-k="stations.FIN.depcodes"]', '090'); await sp.click('#saveBtn'); await sp.wait_for_timeout(1200)
        await sp.click('#runCheck'); await sp.wait_for_timeout(3000)
        check('ตั้งค่า: ผลตรวจตาราง', 'opd_dep_queue' in await sp.inner_text('#checkOut'))
        await sp.screenshot(path=OUT + '/e2e_settings.png', full_page=True)
        pg = await page(ctx, errs); await pg.goto(B + '/index.html'); await pg.wait_for_timeout(2500)
        kpis = await pg.evaluate("[...document.querySelectorAll('#tbody tr[data-st=DOC_MED] td')].map(t=>t.innerText)")
        check('ตั้งค่า: หน้าผังใช้ KPI ใหม่', '50' in kpis, kpis)
        await sp.click('#logoutBtn'); await sp.wait_for_timeout(1200)
        check('ตั้งค่า: ออกจากระบบ', await sp.is_visible('#loginCard'))
        check('ตั้งค่า: ไม่มี JS error', not errs, errs[:5])
        await ctx.close()

        # ---------- 5) มือถือ ----------
        for scheme in ['light', 'dark']:
            errs = []; ctx = await mkctx(viewport={'width': 390, 'height': 844}, color_scheme=scheme, is_mobile=True, has_touch=True); pg = await page(ctx, errs)
            await pg.goto(B + '/index.html'); await pg.wait_for_timeout(2500)
            check(f'มือถือ {scheme}: ไม่เลื่อนแนวนอน', await no_hscroll(pg))
            await pg.evaluate("document.querySelector('#tbody tr[data-st=PHA]').click()"); await pg.wait_for_timeout(1200)
            box = await pg.eval_on_selector('#panel', 'e => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.bottom, innerWidth, innerHeight]; }')
            check(f'มือถือ {scheme}: แผงเป็น bottom sheet', box[0] <= 1 and abs(box[1] - box[3]) <= 1, box)
            await pg.screenshot(path=OUT + f'/e2e_mobile_{scheme}.png')
            sp = await page(ctx, errs); await sp.goto(B + '/settings.html'); await sp.wait_for_timeout(800)
            check(f'มือถือ {scheme}: หน้าตั้งค่าไม่เลื่อนแนวนอน', await no_hscroll(sp))
            check(f'มือถือ {scheme}: ไม่มี JS error', not errs, errs[:3])
            await ctx.close()
        await br.close()
    print('\n' + ('ALL PASSED' if not fails else 'FAILED: ' + ', '.join(fails)))
    sys.exit(1 if fails else 0)
asyncio.run(main())
