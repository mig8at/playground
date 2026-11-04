"""Prueba: ¿Jev dice en qué porcentaje de x y de y está una pelota dentro de un cuadro 5×5?

Para cada posición se dibuja un PNG (cuadro 5×5 con una pelota) y se hacen dos preguntas «score» de 10 niveles
(0–10 %, 10–20 %, … 90–100 %). El porcentaje estimado es (score + 0,5) × 10, porque el score es el promedio
ponderado de los niveles (0 a 9) y cada nivel cubre un tramo de 10 %.
Uso: python3 -I ball.py
"""
import base64, json, struct, urllib.request, uuid, zlib

SIZE, CELLS, RADIUS = 500, 5, 18

def png(ball_x, ball_y):
    rows = []
    for y in range(SIZE):
        row = bytearray([0])
        for x in range(SIZE):
            on_grid = x % (SIZE // CELLS) in (0, 1) or y % (SIZE // CELLS) in (0, 1) or x >= SIZE - 2 or y >= SIZE - 2
            in_ball = (x - ball_x) ** 2 + (y - ball_y) ** 2 <= RADIUS ** 2
            row += bytes((220, 30, 30) if in_ball else (40, 40, 40) if on_grid else (255, 255, 255))
        rows.append(bytes(row))
    raw = b''.join(rows)
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

token = ''
for line in open('/Users/miguelochoa/Desktop/CREDITOP/playground/connectors/.env'):
    k, _, v = line.strip().partition('=')
    if k.replace('export ', '').strip() in ('JEV_TOKEN', 'TYPESAFE_API_KEY') and v.strip():
        token = v.strip().strip('"\'')
        break

levels = lambda axis: [f'{i * 10}–{i * 10 + 10} % del ancho, contando desde la izquierda' if axis == 'x'
                       else f'{i * 10}–{i * 10 + 10} % del alto, contando desde arriba' for i in range(10)]

# Posiciones en fracción del cuadro: el centro, centros de otras casillas y puntos fuera de la grilla.
CASES = [('centro (casilla 3,3)', .5, .5), ('casilla 1,2', .1, .3), ('casilla 4,5', .7, .9),
         ('casilla 5,1', .9, .1), ('fuera de grilla', .33, .62), ('fuera de grilla', .85, .45), ('fuera de grilla', .18, .77)]

print(f"{'caso':22} {'real x,y':>10}   {'Jev x,y':>12}   {'error x,y':>10}   confianza x,y")
errs = []
for name, fx, fy in CASES:
    ref = f'{uuid.uuid4()}-tablero'
    q = lambda axis: {'type': 'score', 'criteria': levels(axis), 'instructions':
        f'En la imagen `tablero` hay un cuadro de 5×5 casillas y una pelota roja. ¿En qué parte del {"ancho" if axis == "x" else "alto"} del cuadro está el centro de la pelota?'}
    body = {'model': 'jev-latest', 'assets': {ref: {'type': 'image', 'format': 'png', 'data_base64': base64.b64encode(png(fx * SIZE, fy * SIZE)).decode()}},
            'state': {'tablero': ref}, 'questions': {'x': q('x'), 'y': q('y')}}
    req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(body).encode(), method='POST', headers={
        'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true'})
    ans = json.load(urllib.request.urlopen(req, timeout=60))['answers']
    px, py = (ans['x']['score'] + .5) * 10, (ans['y']['score'] + .5) * 10
    ex, ey = px - fx * 100, py - fy * 100
    errs.append((abs(ex), abs(ey)))
    print(f"{name:22} {fx*100:4.0f},{fy*100:4.0f}   {px:5.1f},{py:5.1f}   {ex:+5.1f},{ey:+5.1f}   {ans['x']['confidence']:.2f},{ans['y']['confidence']:.2f}")
print(f"error medio: x {sum(e[0] for e in errs)/len(errs):.1f} pts porcentuales · y {sum(e[1] for e in errs)/len(errs):.1f}")
