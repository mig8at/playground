"""Prueba: ¿claude -p (Claude Code local) encuentra las preguntas de un formulario en una imagen, con cajas?

Uso: python3 -I claude_probe.py <png> <mapper.json> <salida.json>
"""
import base64, json, struct, subprocess, sys, tempfile, time

png, mapper_path, out_path = sys.argv[1:4]
raw = open(png, 'rb').read()
W, H = struct.unpack('>II', raw[16:24])

BOX = {'type': 'object', 'additionalProperties': False, 'required': ['x0', 'y0', 'x1', 'y1'],
       'properties': {k: {'type': 'number'} for k in ('x0', 'y0', 'x1', 'y1')}}
SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['preguntas'],
    'properties': {'preguntas': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False,
        'required': ['texto', 'tipo', 'rotulo', 'respuesta', 'opciones'],
        'properties': {
            'texto': {'type': 'string'},
            'tipo': {'type': 'string', 'enum': ['texto', 'opciones']},
            'rotulo': BOX,
            'respuesta': {'anyOf': [BOX, {'type': 'null'}]},
            'opciones': {'type': 'array', 'items': {
                'type': 'object', 'additionalProperties': False, 'required': ['texto', 'casilla'],
                'properties': {'texto': {'type': 'string'}, 'casilla': BOX}}},
        }}}},
}
PROMPT = f'''La imagen es una página de un formulario en blanco, de {W}×{H} píxeles.
Encontrá TODAS las preguntas o datos que la persona tiene que llenar, de arriba hacia abajo.
Para cada una devolvé, en píxeles de esta imagen (x hacia la derecha, y hacia abajo, origen arriba a la izquierda):
- "texto": el rótulo impreso tal cual.
- "rotulo": la caja del rótulo impreso.
- "tipo": "texto" si se escribe un valor; "opciones" si se marca una casilla.
- "respuesta": para "texto", la caja del espacio en blanco donde se escribe, sin tapar ningún texto impreso; para "opciones", null.
- "opciones": para "opciones", cada opción con su texto y la caja de su casilla (sólo el cuadrito); para "texto", [].'''

msg = {'type': 'user', 'message': {'role': 'user', 'content': [
    {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(raw).decode()}},
    {'type': 'text', 'text': PROMPT}]}}

with tempfile.TemporaryDirectory() as d:
    t0 = time.time()
    p = subprocess.run(['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
                        '--json-schema', json.dumps(SCHEMA), '--tools', '', '--strict-mcp-config',
                        '--no-session-persistence'],
                       input=json.dumps(msg) + '\n', capture_output=True, text=True, cwd=d, timeout=600)
    elapsed = time.time() - t0
print(f'salida {p.returncode} · {elapsed:.0f}s · stderr: {p.stderr[:300]}')
out = p.stdout.strip()
# stream-json: un evento por línea; el resultado es el de tipo «result».
events = [json.loads(l) for l in out.splitlines() if l.strip()]
result = next(e for e in reversed(events) if e.get('type') == 'result')
open(out_path, 'w').write(json.dumps(result, indent=1, ensure_ascii=False))
data = result.get('structured_output') or json.loads(result.get('result') or '{}')
qs = data.get('preguntas', [])
print(f"modelo/costo: {result.get('total_cost_usd')} · preguntas: {len(qs)} · texto {sum(q['tipo']=='texto' for q in qs)} · opciones {sum(q['tipo']=='opciones' for q in qs)}")

# Comparación gruesa con el mapeo real: ¿el punto (x, y) de cada campo de texto cae dentro de alguna caja de respuesta?
truth = [f for f in json.load(open(mapper_path))['1']['fields'] if f['type'] == 'text' and 'x' in f]
boxes = [q['respuesta'] for q in qs if q.get('respuesta')]
tol = 0.012
inside = sum(any(b['x0'] / W - tol <= f['x'] <= b['x1'] / W + tol and b['y0'] / H - tol <= f['y'] <= b['y1'] / H + tol for b in boxes) for f in truth)
print(f'campos de texto del mapeo real dentro de alguna caja de respuesta: {inside}/{len(truth)}')
cb = [o['casilla'] for q in qs for o in q.get('opciones', [])]
real_cb = [o for f in json.load(open(mapper_path))['1']['fields'] if f['type'] == 'checkbox' for o in f['options']]
hit = sum(any(b['x0'] / W - tol <= o['x'] <= b['x1'] / W + tol and b['y0'] / H - tol <= o['y'] <= b['y1'] / H + tol for b in cb) for o in real_cb)
print(f'casillas del mapeo real dentro de alguna casilla encontrada: {hit}/{len(real_cb)}')
for q in qs[:8]:
    print(' ', q['tipo'], '·', q['texto'][:40], '·', q.get('respuesta'), '·', len(q.get('opciones', [])), 'opciones')
