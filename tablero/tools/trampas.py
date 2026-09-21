#!/usr/bin/env python3
"""Las TRAMPAS del sistema (`F-xx`): que su índice esté completo y sus citas sigan apuntando bien.

QUÉ SON Y POR QUÉ VIVEN ACÁ. Una trampa es un síntoma que ya costó tiempo, con su causa raíz
verificada, su evidencia y su arreglo. Es **crónica**, y la crónica es justo lo que canon —el corpus
que comparte el equipo— rechaza por regla escrita: allá van las reglas que existen en `main`, sin el
relato de quién las descubrió. Vivieron en el árbol de `context/` hasta el 2026-09-21 y se mudaron
acá cuando ese árbol empezó a apagarse: **el tablero ya era su lector real** —medido ese día, 12 de
45 tareas citaban 60 `F-xx` distintos, y canon no citaba ninguno—, así que esto es mover el archivo
adonde ya estaba su uso.

⚠ **No son los «Hallazgos» del tablero, y el nombre importa.** Un hallazgo del tablero es una
anotación fechada DENTRO de una tarea (`> **MEDICIÓN · …**`); una trampa es del sistema, no de una
tarea, y se entra a ella por su SÍNTOMA. Dos cosas distintas con un nombre parecido es como empiezan
a mezclarse.

LOS DOS CHEQUEOS, y cada uno nació de un error medido:

1. **Un hallazgo entra por la PUERTA o no entra.** El documento declara la suya —«nadie lee este
   archivo entero: entrá por acá, saltá al `F-xx`»— y esa puerta es un índice escrito a mano. Medido
   el 2026-09-21: 9 de 239 hallazgos estaban fuera del índice de síntomas, justamente los últimos
   agregados. Para quien entra por la puerta no existían, y su ausencia se lee «no nos pasó».
2. **Las citas `archivo:línea` se corren.** Se validan con el mismo motor que el árbol
   (`context/tools/refs.py`), que sabe leer los repos y anclar por contenido. ⚠ Ese motor vive en
   `context/`, que está en camino de apagarse: el día que se borre hay que traerlo acá. Mientras
   tanto se importa, que es mejor que tener dos copias.

USO
    trampas.py            los dos chequeos
    trampas.py --indice   sólo el índice (no necesita los repos, no toca git)

EXIT  0 → todo en orden · 1 → algo que arreglar
"""
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]          # playground/
DOC = RAIZ / 'tablero' / 'data' / 'trampas' / 'doc.md'
REFS = RAIZ / 'context' / 'tools' / 'refs.py'

ANCLA = re.compile(r"^### (F-\d+)")
INDICE = re.compile(r"^## (Índice[^\n]*)")
CITA = re.compile(r"F-\d+")


def revisar_indice():
    """Cada `## Índice` tiene que citar todo lo que tiene ancla, y no citar lo que no existe."""
    fallas = []
    lineas = DOC.read_text().splitlines()
    anclas = {m.group(1) for l in lineas if (m := ANCLA.match(l))}
    indices = []
    for l in lineas:
        if m := INDICE.match(l):
            indices.append((m.group(1).strip(), set()))
        elif indices and not l.startswith('## '):
            indices[-1][1].update(CITA.findall(l))
    if anclas and not indices:
        fallas.append(f"  sin-índice · {len(anclas)} trampas y ningún «## Índice»")
    for titulo, citados in indices:
        faltan = sorted(anclas - citados, key=lambda f: int(f[2:]))
        if faltan:
            fallas.append(f"  fuera-del-índice · «{titulo}» no cita {len(faltan)}: "
                          + ', '.join(faltan[:12]) + (" …" if len(faltan) > 12 else ""))
        for muerto in sorted(citados - anclas, key=lambda f: int(f[2:])):
            fallas.append(f"  índice-a-trampa-inexistente · «{titulo}» cita {muerto}, sin ancla `### {muerto}`")
    return len(anclas), fallas


def revisar_citas():
    """Reusa el validador del árbol mientras exista; si no está, lo dice en vez de callarlo."""
    if not REFS.is_file():
        return ["  ⚠ no se pudieron validar las citas: falta context/tools/refs.py. "
                "Si `context/` se apagó, hay que traer ese motor acá (ver el encabezado)."]
    r = subprocess.run([sys.executable, str(REFS), '--extra', str(DOC)],
                       capture_output=True, text=True, cwd=REFS.parent)
    salida = (r.stdout or '') + (r.stderr or '')
    malas = [l for l in salida.splitlines() if re.search(r'⚠ \d+ (movidas|reescritas|fuera)', l)]
    resumen = next((l for l in salida.splitlines() if 'referencias ·' in l), None)
    return [f"  {resumen.strip()}"] if resumen else ["  ⚠ el validador no devolvió resumen"]


def main():
    total, fallas = revisar_indice()
    print(f"\n  TRAMPAS · {total} con ancla en {DOC.relative_to(RAIZ)}\n")
    if '--indice' not in sys.argv:
        for l in revisar_citas():
            print(l)
    if fallas:
        print("\n✗ el índice no está completo — una trampa fuera de la puerta se lee como «no nos pasó»:\n")
        print('\n'.join(fallas))
        return 1
    print("  ✓ índice completo: toda trampa con ancla está citada, y ninguna cita apunta al vacío")
    return 0


if __name__ == '__main__':
    sys.exit(main())
