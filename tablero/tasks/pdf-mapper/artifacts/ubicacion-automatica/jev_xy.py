"""Prueba: ¿Jev ubica cada campo del catálogo con dos preguntas «score» (x e y) leyendo el JSON cartesiano?

Para cada campo de texto del mapeo real de la página (se sabe que están, así se mide sólo la ubicación) se
pregunta x e y en 10 niveles de 10 % cada uno; el valor estimado es (score + 0,5) × 10 % del ancho o del alto.
Dos variantes: sólo el JSON, y el JSON más la imagen de la página.
Uso: python3 -I jev_xy.py <reducido.json> <mapper.json> <catalog.json> <pagina.png>
"""
import base64, json, math, sys, time, urllib.request, uuid

page_path, mapper_path, catalog_path, png_path = sys.argv[1:5]
page = json.load(open(page_path))
W, H = page['ancho'], page['alto']
catalog = {f['id']: f for f in json.load(open(catalog_path))['fields']}
truth = [f for f in json.load(open(mapper_path))['1']['fields'] if f['type'] == 'text' and 'x' in f]

token = ''
for line in open('/Users/miguelochoa/Desktop/CREDITOP/playground/connectors/.env'):
    k, _, v = line.strip().partition('=')
    if k.replace('export ', '').strip() in ('JEV_TOKEN', 'TYPESAFE_API_KEY') and v.strip():
        token = v.strip().strip('"\'')
        break

def levels(axis):
    size = W if axis == 'x' else H
    return [f'{axis} entre {round(size * i / 10)} y {round(size * (i + 1) / 10)} pt ({i * 10}–{i * 10 + 10} % del {"ancho, desde la izquierda" if axis == "x" else "alto, desde arriba"})' for i in range(10)]

GUIDE = ('Es un formulario en blanco descrito en `pagina`: coordenadas en puntos, origen arriba a la izquierda. '
         'textos = [texto, x0, y0, x1, y1] (y1 es la línea base), lineas = [x0, y0, x1, y1] (bordes de celdas y rayas), '
         'casillas = [x0, y0, x1, y1]. ')

def ask(with_image):
    state = {'pagina': json.dumps(page, ensure_ascii=False)}
    assets = {}
    if with_image:
        ref = f'{uuid.uuid4()}-imagen'
        assets = {ref: {'type': 'image', 'format': 'png', 'data_base64': base64.b64encode(open(png_path, 'rb').read()).decode()}}
        state['imagen'] = ref
    questions = {}
    for f in truth:
        label = catalog.get(f['id'], {}).get('label') or f['id']
        for axis in ('x', 'y'):
            what = ('el x donde empieza a escribirse la primera letra (borde izquierdo del espacio en blanco, después del rótulo si está en el mismo renglón)'
                    if axis == 'x' else 'el y de la línea base sobre la que se escribe el valor (encima de la raya, o abajo dentro de la celda si el rótulo está arriba)')
            questions[f"{f['id']}__{axis}"] = {'type': 'score', 'criteria': levels(axis),
                'instructions': GUIDE + (f'La imagen `imagen` es la misma página. ' if with_image else '') + f'Para el dato «{label}», ¿cuál es {what}?'}
    body = {'model': 'jev-latest', 'state': state, 'questions': questions}
    if assets: body['assets'] = assets
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    if with_image: headers['TypeSafe-Danger-Zone-Images'] = 'true'
    t0 = time.time()
    res = json.load(urllib.request.urlopen(urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(body).encode(), method='POST', headers=headers), timeout=180))
    return res, time.time() - t0

for with_image in (False, True):
    res, secs = ask(with_image)
    ans = res['answers']
    ok, dists, rows = 0, [], []
    for f in truth:
        px = (ans[f"{f['id']}__x"]['score'] + .5) / 10 * W
        py = (ans[f"{f['id']}__y"]['score'] + .5) / 10 * H
        rx, ry = f['x'] * W, f['y'] * H
        dx, dy = px - rx, py - ry
        dists.append(math.hypot(dx, dy))
        good = abs(dx) <= 12 and abs(dy) <= 8
        ok += good
        rows.append((math.hypot(dx, dy), f['id'], dx, dy))
    med = sorted(dists)[len(dists) // 2]
    print(f"{'JSON + imagen' if with_image else 'sólo JSON':14} · {secs:.1f} s · {res.get('model')} · uso {res.get('usage')}")
    print(f'   {ok}/{len(truth)} a ±12 pt en x y ±8 pt en y · distancia mediana {med:.1f} pt · error medio x {sum(abs(r[2]) for r in rows)/len(rows):.1f} pt, y {sum(abs(r[3]) for r in rows)/len(rows):.1f} pt')
    print('   mejores:', ', '.join(f'{r[1]} ({r[2]:+.0f},{r[3]:+.0f})' for r in sorted(rows)[:4]))
    print('   peores: ', ', '.join(f'{r[1]} ({r[2]:+.0f},{r[3]:+.0f})' for r in sorted(rows)[-4:]))
