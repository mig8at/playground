"""Dibuja lo que dio la última corrida de run.py: cada pregunta sobre su captura, con el recuadro y el punto del modelo
(magenta) y la caja real sacada del DOM (verde, punteada). Una sola página HTML con las imágenes adentro, para mirarla.

uso, desde la raíz de my-tools: python3 -I point/eval/gallery.py   → point/eval/gallery.html
"""
import base64
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
results = json.load(open(os.path.join(HERE, '.results.json')))
images = {}
for r in results:
    if r['img'] not in images:
        images[r['img']] = base64.b64encode(open(os.path.join(HERE, r['img'] + '.png'), 'rb').read()).decode()

PAD = 70  # alrededor de lo que importa, para ver el contexto sin la captura entera


def card(r):
    a = r['answer']
    w, h = a['width'], a['height']
    marks = []
    xs, ys = [], []
    if r['box']:
        x, y, bw, bh = r['box']
        marks.append(f'<div class="truth" style="left:{x}px;top:{y}px;width:{bw}px;height:{bh}px"></div>')
        xs += [x, x + bw]
        ys += [y, y + bh]
    if a['found']:
        b = a['box']
        marks.append(f'<div class="guess" style="left:{b[0]}px;top:{b[1]}px;width:{b[2] - b[0]}px;height:{b[3] - b[1]}px"></div>')
        marks.append(f'<div class="dot" style="left:{a["x"] - 7}px;top:{a["y"] - 7}px"></div>')
        xs += [b[0], b[2]]
        ys += [b[1], b[3]]
    if not xs:  # no está, y el modelo tampoco lo encontró: la captura entera, achicada
        x0, y0, x1, y1 = 0, 0, w, h
    else:
        x0, y0 = max(0, min(xs) - PAD), max(0, min(ys) - PAD)
        x1, y1 = min(w, max(xs) + PAD), min(h, max(ys) + PAD)
    vw, vh = x1 - x0, y1 - y0
    scale = min(1, 560 / vw)
    verdict = 'acierta' if r['hit'] else 'falla'
    if r['box'] is None:
        said = 'dijo que no está' if not a['found'] else 'inventó un lugar'
    elif not a['found']:
        said = 'dijo que no está'
    else:
        x, y, bw, bh = r['box']
        bx = a['box']
        ix = max(0, min(bx[2], x + bw) - max(bx[0], x))
        iy = max(0, min(bx[3], y + bh) - max(bx[1], y))
        iou = ix * iy / ((bx[2] - bx[0]) * (bx[3] - bx[1]) + bw * bh - ix * iy)
        said = f'recuadro {iou:.0%} sobre el real'
    return f'''<figure class="{verdict}">
<figcaption><b>{html.escape(r["q"])}</b><span>{verdict} · {said} · {a["seconds"]:.1f} s</span></figcaption>
<div class="view" style="width:{vw * scale:.0f}px;height:{vh * scale:.0f}px">
<div class="shot" style="width:{w}px;height:{h}px;transform:scale({scale});left:{-x0 * scale:.0f}px;top:{-y0 * scale:.0f}px" data-img="{r["img"]}">
{"".join(marks)}</div></div></figure>'''


hits = sum(r['hit'] for r in results)
page = f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><title>point · galería</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {{ --bg:#f6f6f8; --card:#fff; --ink:#1d1d24; --muted:#6b6b78; --line:#e3e3ea; --guess:#e61e5a; --truth:#1f9d55; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#16161b; --card:#202027; --ink:#ececf1; --muted:#9a9aa8; --line:#33333d; }} }}
body {{ margin:0; padding:20px 16px; background:var(--bg); color:var(--ink); font:14px/1.4 -apple-system, system-ui, sans-serif; }}
h1 {{ font-size:18px; margin:0 0 4px; }} .sub {{ color:var(--muted); margin:0 0 16px; }}
.legend span {{ margin-right:14px; }} .legend i {{ display:inline-block; width:14px; height:10px; margin-right:5px; vertical-align:middle; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 380px), 1fr)); gap:14px; }}
figure {{ margin:0; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px; overflow:hidden; }}
figure.falla {{ border-color:var(--guess); }}
figcaption {{ margin-bottom:8px; }} figcaption span {{ display:block; color:var(--muted); font-size:12px; }}
figure.falla figcaption span {{ color:var(--guess); }}
.view {{ position:relative; overflow:hidden; max-width:100%; border-radius:4px; }}
.shot {{ position:absolute; transform-origin:0 0; background-size:100% 100%; }}
.truth {{ position:absolute; border:2px dashed var(--truth); box-sizing:border-box; }}
.guess {{ position:absolute; border:2px solid var(--guess); box-sizing:border-box; background:color-mix(in srgb, var(--guess) 10%, transparent); }}
.dot {{ position:absolute; width:14px; height:14px; border-radius:50%; background:var(--guess); border:2px solid #fff; box-sizing:border-box; }}
{"".join(f'.shot[data-img="{k}"] {{ background-image:url(data:image/png;base64,{v}); }}' for k, v in images.items())}
</style></head><body>
<h1>point · dónde toca Qwen3-VL-4B</h1>
<p class="sub">{hits} de {len(results)} aciertos ·
<span class="legend"><span><i style="background:var(--guess)"></i>recuadro y punto del modelo</span><span><i style="border:2px dashed var(--truth)"></i>el elemento real</span></span></p>
<div class="grid">{"".join(card(r) for r in sorted(results, key=lambda r: r["hit"]))}</div>
</body></html>'''
open(os.path.join(HERE, 'gallery.html'), 'w').write(page)
print(f'point/eval/gallery.html · {hits}/{len(results)}')
