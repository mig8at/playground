"""Prueba: ¿Jev distingue qué campos del catálogo aparecen en una página?

Uso: python3 -I presence.py <png> <mapper.json> <catalog.json> <página>
"""
import base64, json, sys, time, urllib.request, urllib.error, uuid

png, mapper_path, catalog_path, page = sys.argv[1:5]
token = ''
for line in open('/Users/miguelochoa/Desktop/CREDITOP/playground/connectors/.env'):
    k, _, v = line.strip().partition('=')
    if k.replace('export ', '').strip() in ('JEV_TOKEN', 'TYPESAFE_API_KEY') and v.strip():
        token = v.strip().strip('"\'')
        break

fields = [f for f in json.load(open(catalog_path))['fields'] if f['type'] in ('text', 'checkbox')]
ref = f'{uuid.uuid4()}-page'
questions = {}
for f in fields:
    label = f.get('label') or f['id']
    opts = f' (opciones: {", ".join(f["options"])})' if f.get('options') else ''
    questions[f['id']] = {
        'type': 'choice',
        'instructions': f'¿El formulario de la imagen `page` tiene un espacio para llenar el dato «{label}»{opts}?',
        'criteria': {'si': {'description': 'Hay una celda, renglón o casilla para ese dato en esta página'},
                     'no': {'description': 'Esta página no pide ese dato'}},
    }
body = {'model': 'jev-latest', 'assets': {ref: {'type': 'image', 'format': 'png', 'data_base64': base64.b64encode(open(png, 'rb').read()).decode()}},
        'state': {'page': ref}, 'questions': questions}
req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(body).encode(), method='POST', headers={
    'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true'})
t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        answer = json.load(r)
except urllib.error.HTTPError as e:
    print('HTTP', e.code, e.read()[:800].decode(errors='replace'))
    sys.exit(1)
print(f"{len(questions)} preguntas · {time.time() - t0:.1f}s · {answer.get('model')} · {answer.get('usage')}")
on_page = {f['id'] for f in json.load(open(mapper_path))[page]['fields']}
ans = answer.get('answers') or {}
tp = fp = fn = 0
for f in fields:
    a = ans.get(f['id']) or {}
    yes, real = a.get('choice') == 'si', f['id'] in on_page
    tp += yes and real; fp += yes and not real; fn += real and not yes
    if yes != real:
        print(f"{'FALSO +' if yes else 'FALSO -'} {f['id']:28} conf={a.get('confidence', 0):.2f} «{f.get('label')}»")
print(f'en el mapeo real: {len(on_page & {f["id"] for f in fields})} · Jev dijo sí: {tp + fp} · acertados {tp} · falsos + {fp} · falsos - {fn}')
print('ejemplo de respuesta:', json.dumps(next(iter(ans.values()), {}))[:300])
