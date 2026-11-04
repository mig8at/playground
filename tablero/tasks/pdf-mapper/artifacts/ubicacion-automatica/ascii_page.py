"""Prototipo: la página del JSON cartesiano dibujada con caracteres en una grilla monoespaciada.

Cada celda de la grilla mide CW × RH puntos. Líneas → ─ │ (┼ donde se cruzan), casillas → [ ], textos en su fila y
columna de inicio. Si un texto no entra, pisa lo que sigue hasta el borde derecho.
Uso: python3 -I ascii_page.py <reducido.json> [ancho de celda pt] [alto de celda pt] [desde fila] [hasta fila]
"""
import json, sys

page = json.load(open(sys.argv[1]))
CW = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
RH = float(sys.argv[3]) if len(sys.argv) > 3 else 8.0
cols, rows = int(page['ancho'] / CW) + 1, int(page['alto'] / RH) + 1
grid = [[' '] * cols for _ in range(rows)]
col, row = lambda x: min(cols - 1, max(0, round(x / CW))), lambda y: min(rows - 1, max(0, round(y / RH)))

def put(r, c, ch):
    cur = grid[r][c]
    if {cur, ch} == {'─', '│'} or (cur in '─│┼' and ch in '─│' and cur != ch): ch = '┼'
    grid[r][c] = ch

for x0, y0, x1, y1 in page['lineas']:
    if abs(y0 - y1) < 1:
        for c in range(col(x0), col(x1) + 1): put(row(y0), c, '─')
    else:
        for r in range(row(y0), row(y1) + 1): put(r, col(x0), '│')
for x0, y0, x1, y1 in page['casillas']:
    r, c = row((y0 + y1) / 2), col(x0)
    for i, ch in enumerate('[ ]'): grid[r][min(cols - 1, c + i)] = ch
for texto, x0, y0, x1, y1 in page['textos']:
    r, c = row(y1 - (y1 - y0) / 2), col(x0)
    for i, ch in enumerate(texto):
        if c + i < cols: grid[r][c + i] = ch

lines = [''.join(r).rstrip() for r in grid]
a, b = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (0, rows)
print(f'grilla {cols} columnas × {rows} filas · celda {CW}×{RH} pt · {sum(len(l) for l in lines)} caracteres sin espacios finales')
print('\n'.join(lines[a:b]))
