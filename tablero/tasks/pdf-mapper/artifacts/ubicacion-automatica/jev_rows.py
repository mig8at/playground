"""Prueba: con la página dibujada en texto y las filas numeradas, ¿Jev elige la fila donde se escribe cada campo?

La página se arma como en el HTML (celda automática = ancho mediano de letra, fila = el doble; casillas protegidas;
el texto pisa las líneas). Por cada campo de texto del mapeo real, una pregunta «choice» con las filas como
opciones. La fila elegida se compara con la del mapeo real (y de la línea base / alto de fila).
Uso: python3 -I jev_rows.py <reducido.json> <mapper.json> <catalog.json>
"""
import json, statistics, sys, time, urllib.error, urllib.request

page_path, mapper_path, catalog_path = sys.argv[1:4]
p = json.load(open(page_path))
W, H = p['ancho'], p['alto']
catalog = {f['id']: f for f in json.load(open(catalog_path))['fields']}
truth = [f for f in json.load(open(mapper_path))['1']['fields'] if f['type'] == 'text' and 'x' in f]

# Celda automática, como en el HTML.
widths = sorted((x1 - x0) / len(t) for t, x0, y0, x1, y1 in p['textos'] if len(t) >= 4)
CW = max(1.5, round(widths[len(widths) // 2] * 2) / 2)
RH = CW * 2
cols, rows = int(W / CW) + 2, int(H / RH) + 2
grid = [[' '] * cols for _ in range(rows)]
col = lambda x: min(cols - 1, max(0, round(x / CW)))
row = lambda y: min(rows - 1, max(0, round(y / RH)))
isline = lambda ch: ch in '─│┼'
def line(r, c, ch): grid[r][c] = '┼' if isline(grid[r][c]) and grid[r][c] != ch else ch
for x0, y0, x1, y1 in p['lineas']:
    if y0 == y1:
        for c in range(col(x0), col(x1) + 1): line(row(y0), c, '─')
    else:
        for r in range(row(y0), row(y1) + 1): line(r, col(x0), '│')
protected = set()
for x0, y0, x1, y1 in p['casillas']:
    r, c = row((y0 + y1) / 2), col(x0)
    for i, ch in enumerate('[ ]'):
        if c + i < cols: grid[r][c + i] = ch; protected.add((r, c + i))
for t, x0, y0, x1, y1 in p['textos']:
    r, c = row((y0 + y1) / 2), col(x0)
    for i, ch in enumerate(t):
        if c + i >= cols or (r, c + i) in protected: break
        grid[r][c + i] = ch
text_page = '\n'.join(f'{i:03d}{"".join(g).rstrip()}' for i, g in enumerate(grid))
open('vinculacion-texto.txt', 'w').write(text_page)
print(f'celda {CW}×{RH} pt · {rows} filas · {len(text_page)} caracteres')

token = ''
for l in open('/Users/miguelochoa/Desktop/CREDITOP/playground/connectors/.env'):
    k, _, v = l.strip().partition('=')
    if k.replace('export ', '').strip() in ('JEV_TOKEN', 'TYPESAFE_API_KEY') and v.strip():
        token = v.strip().strip('"\'')
        break

criteria = {f'{i:03d}': {'description': f'fila {i:03d}'} for i in range(rows)}
GUIDE = ('`pagina` es un formulario en blanco dibujado con caracteres: cada línea empieza con su número de fila (3 dígitos); '
         '─ │ ┼ son los bordes de las celdas y las rayas donde se escribe, [ ] son casillas. ')
questions = {}
for f in truth:
    label = catalog.get(f['id'], {}).get('label') or f['id']
    questions[f['id']] = {'type': 'choice', 'criteria': criteria, 'instructions': GUIDE +
        f'¿En qué fila escribiría la persona el valor de «{label}»? Es la fila en blanco donde va el valor: la de la raya '
        '(o justo encima de ella) si hay una, o la última fila en blanco de la celda, debajo de su rótulo.'}
body = {'model': 'jev-latest', 'state': {'pagina': text_page}, 'questions': questions}
t0 = time.time()
try:
    res = json.load(urllib.request.urlopen(urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(body).encode(),
        method='POST', headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Long-Context': 'true'}), timeout=300))
except urllib.error.HTTPError as e:
    print('HTTP', e.code, e.read()[:600].decode(errors='replace')); sys.exit(1)
secs = time.time() - t0

errs, rows_out = [], []
for f in truth:
    a = res['answers'][f['id']]
    got, want = int(a['choice']), row(f['y'] * H)
    errs.append(got - want)
    rows_out.append((abs(got - want), f['id'], got, want, a.get('confidence', 0)))
within = lambda n: sum(abs(e) <= n for e in errs)
print(f'{secs:.1f} s · {res.get("model")} · uso {res.get("usage")}')
print(f'fila exacta {within(0)}/{len(errs)} · ±1 fila ({RH:g} pt) {within(1)}/{len(errs)} · ±2 filas ({2*RH:g} pt) {within(2)}/{len(errs)}')
print(f'error mediano {statistics.median(abs(e) for e in errs)} filas · error medio {statistics.mean(abs(e) for e in errs):.1f} filas')
print('peores:', '; '.join(f'{i} eligió {g} (real {w}, conf {c:.2f})' for _, i, g, w, c in sorted(rows_out)[-8:]))
from collections import Counter
print('desvío medio (filas, + = más abajo que el real):', round(statistics.mean(errs), 2), '· histograma:', dict(sorted(Counter(errs).items())))
for shift in (1, 2):
    print(f'corrigiendo +{shift} fila: exacta {sum(e + shift == 0 for e in errs)}/{len(errs)} · ±1 {sum(abs(e + shift) <= 1 for e in errs)}/{len(errs)} · ±2 {sum(abs(e + shift) <= 2 for e in errs)}/{len(errs)}')
