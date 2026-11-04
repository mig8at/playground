"""Prueba: ¿Jev ubica, en la imagen de una plantilla, dónde va cada campo del catálogo?

Uso: python3 -I probe.py <modelo> <png> <mapper.json> <catalog.json> <salida.json>
El token se lee de connectors/.env (JEV_TOKEN o TYPESAFE_API_KEY) y no se imprime.
"""
import base64, json, sys, time, urllib.request, urllib.error, uuid

model, png, mapper_path, catalog_path, out_path = sys.argv[1:6]
IDS = ['first_name', 'middle_name', 'last_name', 'second_last_name', 'address', 'city', 'email',
       'cell_phone', 'company_name', 'job_position', 'nationality', 'birth_place']

token = ''
for line in open('/Users/miguelochoa/Desktop/CREDITOP/playground/connectors/.env'):
    k, _, v = line.strip().partition('=')
    if k.replace('export ', '').strip() in ('JEV_TOKEN', 'TYPESAFE_API_KEY') and v.strip():
        token = v.strip().strip('"\'')
        break
assert token, 'sin token'

catalog = {f['id']: f for f in json.load(open(catalog_path))['fields']}
ref = f'{uuid.uuid4()}-page'
questions = {}
for fid in IDS:
    label = catalog[fid].get('label') or fid
    questions[fid] = {
        'type': 'box',
        'instructions': (
            f'Es un formulario en blanco. Ubicá el espacio vacío donde la persona escribe «{label}» en la imagen `page`. '
            'Devolvé la caja de esa celda o renglón en blanco donde va el valor, incluyendo su rótulo si está dentro de la celda.'
        ),
    }
body = {
    'model': model,
    'assets': {ref: {'type': 'image', 'format': 'png', 'data_base64': base64.b64encode(open(png, 'rb').read()).decode()}},
    'state': {'page': ref},
    'questions': questions,
}
req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(body).encode(), method='POST', headers={
    'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true'})
t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        answer = json.load(r)
except urllib.error.HTTPError as e:
    print('HTTP', e.code, e.read()[:800].decode(errors='replace'))
    sys.exit(1)
elapsed = time.time() - t0
json.dump(answer, open(out_path, 'w'), indent=1)

truth = {f['id']: f for f in json.load(open(mapper_path))['1']['fields'] if f['id'] in IDS}
print(f"modelo {answer.get('model')} · {elapsed:.1f}s · uso {answer.get('usage')}")
hits = 0
for fid in IDS:
    a = (answer.get('answers') or {}).get(fid) or {}
    b, t = a.get('box') or {}, truth.get(fid)
    inside = bool(b and t and b['left'] - 0.01 <= t['x'] <= b['right'] + 0.01 and b['top'] - 0.01 <= t['y'] <= b['bottom'] + 0.01)
    hits += inside
    bs = ' '.join(f"{k[0]}={b[k]:.3f}" for k in ('left', 'top', 'right', 'bottom')) if b else str(a)[:120]
    print(f"{'✓' if inside else '✗'} {fid:18} conf={a.get('confidence', 0):.2f}  {bs}  real=({t['x']:.3f},{t['y']:.3f})")
print(f'{hits}/{len(IDS)} con el punto real dentro de la caja')
