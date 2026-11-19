"""La vara de point: 42 preguntas sobre capturas reales, cada una con la caja del elemento sacada del DOM (o `null` si
lo que se pide no está en la pantalla). Corre bin/point por cada una y cuenta si el punto cae dentro de la caja.

uso, desde la raíz de my-tools: python3 -I point/eval/run.py
El punto es el centro del recuadro que da el modelo; además se mide cuánto se superpone ese recuadro con la caja real
(IoU). Lo que dio queda en point/eval/.results.json, que es lo que dibuja gallery.py.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, 'point', 'eval')

cases = json.load(open(os.path.join(HERE, 'cases.json')))
results = []
ious = []
hits = {'easy': [0, 0], 'hard': [0, 0]}
secs = []
for c in cases:
    out = subprocess.run([os.path.join(ROOT, 'bin', 'point'), os.path.join(HERE, c['img'] + '.png'), c['q'], '--json'],
                         capture_output=True, text=True)
    if out.returncode not in (0, 3):
        print(f"✗ {c['q']}: {out.stderr.strip()}")
        hits[c['round']][1] += 1
        continue
    a = json.loads(out.stdout)
    secs.append(a['seconds'])
    if c['box'] is None:
        ok = not a['found']
    else:
        x, y, w, h = c['box']
        ok = a['found'] and x <= a['x'] <= x + w and y <= a['y'] <= y + h
    if a['found'] and c['box']:
        x, y, w, h = c['box']
        b = a['box']
        ix = max(0, min(b[2], x + w) - max(b[0], x))
        iy = max(0, min(b[3], y + h) - max(b[1], y))
        ious.append(ix * iy / ((b[2] - b[0]) * (b[3] - b[1]) + w * h - ix * iy))
    results.append({**c, 'answer': a, 'hit': bool(ok)})
    hits[c['round']][0] += ok
    hits[c['round']][1] += 1
    where = f"({a['x']}, {a['y']})" if a['found'] else 'no está'
    print(f"{'✓' if ok else '✗'} {a['seconds']:4.1f}s  {c['img']:13} {c['q'][:55]:55} → {where}")
json.dump(results, open(os.path.join(HERE, '.results.json'), 'w'), ensure_ascii=False, indent=1)
secs.sort()
total = sum(h[0] for h in hits.values())
print(f"\n{total}/{len(cases)} · fáciles {hits['easy'][0]}/{hits['easy'][1]} · difíciles {hits['hard'][0]}/{hits['hard'][1]}"
      f" · mediana {secs[len(secs) // 2]:.1f}s, la más lenta {secs[-1]:.1f}s"
      + (f" · superposición mediana del recuadro (IoU) {sorted(ious)[len(ious) // 2]:.2f}" if ious else ''))
sys.exit(0 if total else 1)
