"""Prueba: con sólo el JSON cartesiano de la página (sin imagen), ¿Claude da el punto x, y donde empieza a
escribirse cada dato del formulario? Se compara con el mapeo real (mapper.json, hecho a mano).

Uso: python3 -I anchor_from_json.py <cartesiano.json> <mapper.json> <salida.json> [modelo: opus | sonnet | haiku]
"""
import json, math, subprocess, sys, tempfile, time

src, mapper_path, out_path = sys.argv[1:4]
model = sys.argv[4] if len(sys.argv) > 4 else None
page = json.load(open(src))
W, H = page['ancho'], page['alto']

SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['campos'],
    'properties': {'campos': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False, 'required': ['rotulo', 'tipo', 'x', 'y', 'opciones'],
        'properties': {
            'rotulo': {'type': 'string'},
            'tipo': {'type': 'string', 'enum': ['texto', 'opciones']},
            'x': {'type': ['number', 'null']},
            'y': {'type': ['number', 'null']},
            'opciones': {'type': 'array', 'items': {
                'type': 'object', 'additionalProperties': False, 'required': ['texto', 'x', 'y'],
                'properties': {'texto': {'type': 'string'}, 'x': {'type': 'number'}, 'y': {'type': 'number'}}}},
        }}}},
}

PROMPT = f'''Te paso una página de un formulario en blanco convertida a coordenadas, en puntos PDF ({W}×{H}),
origen arriba a la izquierda (x a la derecha, y hacia abajo):
- "textos": [texto, x0, y0, x1, y1] — y1 es la línea base del texto.
- "lineas": [x0, y0, x1, y1] — bordes de celdas y rayas donde se escribe.
- "casillas": [x0, y0, x1, y1] — cuadritos para marcar.
- "barras": [x0, y0, x1, y1] — barras de título de sección (no se escribe ahí).

Encontrá TODOS los datos que la persona tiene que llenar en esta página. Para cada uno devolvé:
- "rotulo": el texto impreso que lo identifica.
- "tipo": "texto" si se escribe un valor, "opciones" si se marca una casilla.
- Para "texto": "x", "y" = el punto donde empezaría a escribir la primera letra del valor: x en el borde izquierdo
  del espacio en blanco (justo después del rótulo si está a la izquierda en el mismo renglón, o después del inicio
  de la raya), e y en la línea base sobre la que se escribe (encima de la raya, o abajo dentro de la celda si el
  rótulo está arriba; nunca sobre otro texto ni fuera de la celda). "opciones": [].
- Para "opciones": "x", "y" = null, y en "opciones" cada opción con su texto y el centro de su casilla.

Usá las coordenadas de los datos que te paso; no inventes elementos que no estén.

{json.dumps(page, ensure_ascii=False)}'''

with tempfile.TemporaryDirectory() as d:
    t0 = time.time()
    p = subprocess.run(['claude', '-p', '--output-format', 'json', '--json-schema', json.dumps(SCHEMA),
                        '--tools', '', '--strict-mcp-config', '--no-session-persistence'] + (['--model', model] if model else []),
                       input=PROMPT, capture_output=True, text=True, cwd=d, timeout=900)
    elapsed = time.time() - t0
result = json.loads(p.stdout or '{}')
json.dump(result, open(out_path, 'w'), indent=1, ensure_ascii=False)
if result.get('is_error') or not result.get('structured_output'):
    print('falló:', (result.get('result') or p.stderr)[:400]); sys.exit(1)
campos = result['structured_output']['campos']
print(f"{model or 'por defecto'} · {', '.join(result.get('modelUsage', {}))} · {elapsed:.0f}s · USD {result.get('total_cost_usd', 0):.2f} · {len(campos)} campos "
      f"({sum(c['tipo'] == 'texto' for c in campos)} texto, {sum(len(c['opciones']) for c in campos)} opciones)")

# Comparación: cada campo del mapeo real busca el punto propuesto más cercano.
real = json.load(open(mapper_path))['1']['fields']
pts = [(c['x'], c['y'], c['rotulo']) for c in campos if c['tipo'] == 'texto' and c['x'] is not None]
opts = [(o['x'], o['y'], o['texto']) for c in campos for o in c['opciones']]

def score(truth, cand, tx, ty):
    ok, dists, misses = 0, [], []
    for name, x, y in truth:
        best = min(cand, key=lambda c: math.hypot(c[0] - x, c[1] - y), default=None)
        if not best:
            continue
        dx, dy = best[0] - x, best[1] - y
        dists.append(math.hypot(dx, dy))
        if abs(dx) <= tx and abs(dy) <= ty: ok += 1
        else: misses.append(f'{name} dx={dx:+.0f} dy={dy:+.0f} ({best[2][:25]})')
    med = sorted(dists)[len(dists) // 2] if dists else 0
    return ok, len(truth), med, misses

text_truth = [(f['id'], f['x'] * W, f['y'] * H) for f in real if f['type'] == 'text' and 'x' in f]
opt_truth = [(f"{f['id']}:{o['id']}", o['x'] * W, o['y'] * H) for f in real if f['type'] == 'checkbox' for o in f['options']]
ok, n, med, misses = score(text_truth, pts, 12, 8)
print(f'texto: {ok}/{n} a ±12 pt en x y ±8 pt en y · distancia mediana {med:.1f} pt')
print('  fuera:', '; '.join(misses[:12]))
ok, n, med, misses = score(opt_truth, opts, 6, 6)
print(f'opciones: {ok}/{n} a ±6 pt · distancia mediana {med:.1f} pt')
print('  fuera:', '; '.join(misses[:8]))
