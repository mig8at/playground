"""Paso completo con Jev: la fila la elige Jev (página en texto, filas numeradas) y la x se calcula con código.

y = (fila elegida + ROW_SHIFT) × alto de fila.
x: se busca el rótulo del campo entre los textos cercanos a esa fila (por palabras en común con el rótulo del
catálogo). Si el rótulo está en el mismo renglón que la fila, x = donde empieza la raya que lo sigue, o donde
termina el rótulo; si está arriba, x = el borde izquierdo de su celda (la línea vertical a su izquierda) + X_PAD.
Uso: python3 -I jev_pipeline.py <catalog.json> <nombre> [<nombre> …]   (plantillas/<nombre>.reducido.json y .mapper.json)
"""
import json, re, statistics, sys, time, unicodedata, urllib.error, urllib.request

ROW_SHIFT = 1      # Jev elige la primera fila en blanco bajo el rótulo; el valor se apoya una fila más abajo.
X_PAD = 3          # pt desde el borde izquierdo de la celda hasta donde empieza el texto.
INLINE_GAP = 2     # pt después de un rótulo en el mismo renglón.

catalog = {f['id']: f for f in json.load(open(sys.argv[1]))['fields']}
token = ''
for l in open('/Users/miguelochoa/Desktop/CREDITOP/playground/connectors/.env'):
    k, _, v = l.strip().partition('=')
    if k.replace('export ', '').strip() in ('JEV_TOKEN', 'TYPESAFE_API_KEY') and v.strip():
        token = v.strip().strip('"\'')
        break

STOP = {'de', 'la', 'el', 'los', 'las', 'y', 'o', 'del', 'en', 'a', 'u', 'no', 'si', 'por', 'para', 'con'}
norm = lambda s: [w for w in re.findall(r'[a-z0-9]+', unicodedata.normalize('NFKD', s.lower()).encode('ascii', 'ignore').decode()) if w not in STOP]

def text_page(p):
    widths = sorted((x1 - x0) / len(t) for t, x0, y0, x1, y1 in p['textos'] if len(t) >= 4)
    cw = max(1.5, round(widths[len(widths) // 2] * 2) / 2)
    rh = cw * 2
    cols, rows = int(p['ancho'] / cw) + 2, int(p['alto'] / rh) + 2
    grid = [[' '] * cols for _ in range(rows)]
    col = lambda x: min(cols - 1, max(0, round(x / cw)))
    row = lambda y: min(rows - 1, max(0, round(y / rh)))
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
    return '\n'.join(f'{i:03d}{"".join(g).rstrip()}' for i, g in enumerate(grid)), rows, cw, rh

def ask_rows(page_text, rows, fields):
    criteria = {f'{i:03d}': {'description': f'fila {i:03d}'} for i in range(rows)}
    guide = ('`pagina` es un formulario en blanco dibujado con caracteres: cada línea empieza con su número de fila (3 dígitos); '
             '─ │ ┼ son los bordes de las celdas y las rayas donde se escribe, [ ] son casillas. ')
    questions = {fid: {'type': 'choice', 'criteria': criteria, 'instructions': guide +
        f'¿En qué fila escribiría la persona el valor de «{label}»? Es la fila en blanco donde va el valor: la de la raya '
        '(o justo encima de ella) si hay una, o la última fila en blanco de la celda, debajo de su rótulo.'} for fid, label in fields}
    body = {'model': 'jev-latest', 'state': {'pagina': page_text}, 'questions': questions}
    req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(body).encode(), method='POST', headers={
        'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Long-Context': 'true'})
    t0 = time.time()
    try:
        res = json.load(urllib.request.urlopen(req, timeout=300))
    except urllib.error.HTTPError as e:
        raise SystemExit(f'HTTP {e.code} {e.read()[:300].decode(errors="replace")}')
    return res, time.time() - t0

def x_for(p, label, y, rh):
    words = set(norm(label))
    near = [t for t in p['textos'] if y - 9 * rh <= (t[2] + t[4]) / 2 <= y + rh * 0.6]
    scored = [(len(words & set(norm(t[0]))), -abs(y - t[4]), t) for t in near]
    scored = [s for s in scored if s[0] > 0]
    if not scored:
        return None, 'sin rótulo'
    t = max(scored)[2]
    _, x0, y0, x1, y1 = t
    if abs(y1 - y) <= rh:  # rótulo en el mismo renglón que el valor
        after = [l for l in p['lineas'] if l[1] == l[3] and abs(l[1] - y) <= rh and x1 - 4 <= l[0] <= x1 + 40]
        return (min(l[0] for l in after) if after else x1 + INLINE_GAP), 'en línea'
    left = [l[0] for l in p['lineas'] if l[0] == l[2] and l[0] <= x0 + 1 and l[1] - 2 <= y <= l[3] + 2]
    return ((max(left) + X_PAD) if left else x0), 'arriba'

def candidates(p, y, rh):
    """Puntos de inicio posibles en el renglón de y, cada uno con una descripción de lo que tiene al lado."""
    out = []
    band = lambda t: abs(t[4] - y) <= 1.5 * rh   # textos en el mismo renglón
    def label_above(x):  # el rótulo de la celda que empieza en x: el texto más cercano arriba, dentro de la celda
        cell = [t for t in p['textos'] if x - 1 <= t[1] and t[4] < y - rh * 0.5 and y - t[4] <= 10 * rh]
        right = [l[0] for l in p['lineas'] if l[0] == l[2] and l[0] > x + 2 and l[1] - 2 <= y <= l[3] + 2]
        if right: cell = [t for t in cell if t[1] < min(right)]
        return max(cell, key=lambda t: t[4])[0] if cell else ''
    for l in p['lineas']:
        if l[0] == l[2] and l[1] - 2 <= y <= l[3] + 2:  # borde izquierdo de una celda que cruza este renglón
            lab = label_above(l[0])
            out.append((l[0] + X_PAD, f'al comienzo de la celda' + (f' cuyo rótulo es «{lab[:40]}»' if lab else '')))
    for t in p['textos']:
        if band(t):
            out.append((t[3] + INLINE_GAP, f'justo después del texto «{t[0][:40]}»'))
            if t[0].strip() in ('DD', 'MM', 'AAAA', 'AA', 'DD/MM/AAAA'):
                out.append((t[1], f'sobre la guía «{t[0]}»'))
    for l in p['lineas']:
        if l[1] == l[3] and abs(l[1] - y) <= 1.5 * rh and l[2] - l[0] < p['ancho'] * 0.6:  # rayas, no bordes de toda la tabla
            prev = [t for t in p['textos'] if band(t) and t[3] <= l[0] + 4]
            out.append((l[0], 'al comienzo de la raya' + (f' que sigue a «{max(prev, key=lambda t: t[3])[0][:40]}»' if prev else '')))
    # Sin repetidos (dos candidatos a menos de 3 pt son el mismo lugar) y ordenados de izquierda a derecha.
    uniq = []
    for x, d in sorted(out):
        if uniq and x - uniq[-1][0] < 3: continue
        uniq.append((x, d))
    return uniq[:255]

def ask_x(page_text, items):
    questions = {}
    for fid, label, cands in items:
        if not cands: continue
        questions[fid] = {'type': 'choice', 'instructions':
            '`pagina` es un formulario en blanco dibujado con caracteres. Ya se sabe en qué renglón va el valor de '
            f'«{label}». ¿En cuál de estos lugares de ese renglón empieza a escribirse?',
            'criteria': {f'c{i:02d}': {'description': d} for i, (x, d) in enumerate(cands)}}
    body = {'model': 'jev-latest', 'state': {'pagina': page_text}, 'questions': questions}
    req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(body).encode(), method='POST', headers={
        'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Long-Context': 'true'})
    t0 = time.time()
    try:
        res = json.load(urllib.request.urlopen(req, timeout=300))
    except urllib.error.HTTPError as e:
        raise SystemExit(f'HTTP {e.code} {e.read()[:300].decode(errors="replace")}')
    return res, time.time() - t0

all_ok = []
for name in sys.argv[2:]:
    p = json.load(open(f'plantillas/{name}.reducido.json'))
    W, H = p['ancho'], p['alto']
    truth = [f for f in json.load(open(f'plantillas/{name}.mapper.json'))['1']['fields'] if f['type'] == 'text' and 'x' in f]
    fields = [(f['id'], (catalog.get(f['id'], {}).get('label') or f['id'].replace('_', ' '))) for f in truth]
    page_text, rows, cw, rh = text_page(p)
    res, secs = ask_rows(page_text, rows, fields)
    ys = {f['id']: (int(res['answers'][f['id']]['choice']) + ROW_SHIFT) * rh for f in truth}
    items = [(f['id'], label, candidates(p, ys[f['id']], rh)) for f, (_, label) in zip(truth, fields)]
    res_x, secs_x = ask_x(page_text, items)
    secs += secs_x
    cand_of = {fid: c for fid, _, c in items}
    ok_y = ok_xy = 0
    dists, misses = [], []
    for f, (_, label) in zip(truth, fields):
        y = ys[f['id']]
        a = res_x['answers'].get(f['id'])
        if a:
            x, how = cand_of[f['id']][int(a['choice'][1:])][0], cand_of[f['id']][int(a['choice'][1:])][1][:28]
        else:
            x, how = None, 'sin candidatos'
        rx, ry = f['x'] * W, f['y'] * H
        dy = y - ry
        ok_y += abs(dy) <= 8
        if x is None:
            misses.append(f"{f['id']} (sin rótulo)"); continue
        dx = x - rx
        dists.append((dx ** 2 + dy ** 2) ** .5)
        good = abs(dx) <= 12 and abs(dy) <= 8
        ok_xy += good
        if not good: misses.append(f"{f['id']} {how} dx={dx:+.0f} dy={dy:+.0f}")
    all_ok.append((name, ok_xy, len(truth)))
    print(f'\n{name}: celda {cw}×{rh} pt · {rows} filas · {secs:.1f} s (dos pedidos) · {res["usage"]["input_tokens"] + res_x["usage"]["input_tokens"]} tokens de entrada')
    print(f'   y a ±8 pt: {ok_y}/{len(truth)} · x e y (±12 / ±8 pt): {ok_xy}/{len(truth)} · distancia mediana {statistics.median(dists):.1f} pt')
    print('   fuera:', '; '.join(misses[:10]) + (' …' if len(misses) > 10 else ''))
print('\nresumen:', ' · '.join(f'{n.split("--")[-1]} {a}/{b}' for n, a, b in all_ok))
