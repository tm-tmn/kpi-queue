"""รวม index.html + css + js เป็นไฟล์เดียว (ใช้ทำหน้าพรีวิว / ส่งไฟล์เดียว)"""
import re, pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/app.css').read_text(encoding='utf-8')
js = ''.join((root / f'js/{n}.js').read_text(encoding='utf-8') + '\n' for n in ['data', 'sim', 'metrics', 'app'])
body = re.search(r'<!--APP-->(.*)<!--/APP-->', html, re.S).group(1)
fragment = sys.argv[2] == 'fragment' if len(sys.argv) > 2 else False
head = ('<title>ผังเวลารอ OPD ศรีนครินทร์</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:wght@500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap">\n'
        f'<style>\n{css}</style>\n')
tail = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n'
        f'<script>\n{js}</script>\n')
if fragment:
    out = head + body + tail
else:
    out = ('<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + head + '</head>\n<body>' + body + tail + '</body>\n</html>\n')
dest = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist/kpi-queue-single.html'
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(out, encoding='utf-8')
print(dest, len(out))
