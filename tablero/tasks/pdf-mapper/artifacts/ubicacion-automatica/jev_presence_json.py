"""Prueba: ¿Jev decide qué ids del catálogo entran en una página, leyendo el JSON cartesiano?

Una pregunta «choice» (sí / no) por campo del catálogo (texto y casillas). Se compara con los ids del mapeo
real de la página. Variantes: sólo el JSON, y el JSON más la imagen.
Uso: python3 -I jev_presence_json.py <reducido.json> <mapper.json> <catalog.json> <pagina.png>
"""
import base64, json, sys, time, urllib.request, uuid

page_path, mapper_path, catalog_path, png_path = sys.argv[1:5]
page = json.load(open(page_path))
fields = [f for f in json.load(open(catalog_path))['fields'] if f['type'] in ('text', 'checkbox')]
real = {f['id'] for f in json.load(open(mapper_path))['1']['fields']}

token = ''
for line in open('/Users/miguelochoa/Desktop/CREDITOP/playground/connectors/.env'):
    k, _, v = line.strip().partition('=')
    if k.replace('export ', '').strip() in ('JEV_TOKEN', 'TYPESAFE_API_KEY') and v.strip():
        token = v.strip().strip('"\'')
        break

GUIDE = ('`pagina` describe un formulario en blanco: textos = [texto, x0, y0, x1, y1], lineas, casillas y barras, en puntos '
         'con origen arriba a la izquierda. ')

def ask(with_image):
    state, assets = {'pagina': json.dumps(page, ensure_ascii=False)}, {}
    if with_image:
        ref = f'{uuid.uuid4()}-imagen'
        assets = {ref: {'type': 'image', 'format': 'png', 'data_base64': base64.b64encode(open(png_path, 'rb').read()).decode()}}
        state['imagen'] = ref
    questions = {}
    for f in fields:
        label = f.get('label') or f['id']
        opts = f' (opciones: {", ".join(f["options"])})' if f.get('options') else ''
        questions[f['id']] = {'type': 'choice',
            'instructions': GUIDE + ('La imagen `imagen` es la misma página. ' if with_image else '') + f'¿Este formulario tiene un espacio para llenar el dato «{label}»{opts}?',
            'criteria': {'si': {'description': 'Hay una celda, renglón o casilla para ese dato en esta página'},
                         'no': {'description': 'Esta página no pide ese dato'}}}
    body = {'model': 'jev-latest', 'state': state, 'questions': questions}
    if assets: body['assets'] = assets
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    if with_image: headers['TypeSafe-Danger-Zone-Images'] = 'true'
    t0 = time.time()
    res = json.load(urllib.request.urlopen(urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(body).encode(), method='POST', headers=headers), timeout=180))
    return res, time.time() - t0

print(f'catálogo: {len(fields)} campos · en el mapeo real: {len(real & {f["id"] for f in fields})}')
for with_image in (False, True):
    res, secs = ask(with_image)
    yes = {k for k, a in res['answers'].items() if a.get('choice') == 'si'}
    tp, fp, fn = yes & real, yes - real, (real & {f['id'] for f in fields}) - yes
    print(f"\n{'JSON + imagen' if with_image else 'sólo JSON':14} · {secs:.1f} s · uso {res.get('usage')}")
    print(f'   dijo sí a {len(yes)} · acertados {len(tp)} · de más {len(fp)} · faltaron {len(fn)}')
    conf = lambda k: res['answers'][k].get('confidence', 0)
    print('   de más:  ', ', '.join(f'{k} ({conf(k):.2f})' for k in sorted(fp)))
    print('   faltaron:', ', '.join(f'{k} ({conf(k):.2f})' for k in sorted(fn)))
