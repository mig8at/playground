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
2. **Las citas `archivo:línea` se corren.** Se validan con `citations.py`, acá al lado: lee los repos y
   ancla por CONTENIDO —guarda el texto que tenía la línea el día que se afirmó y lo busca en `main`
   hoy—, así que sigue renombres y no se deja engañar por un archivo que ganó un import arriba. Ese
   motor vivía en `context/tools/refs.py` y se mudó con las trampas el 2026-09-21: es el mismo
   archivo, no una copia.

USO
    traps.py            los dos chequeos
    traps.py --indice   sólo el índice (no necesita los repos, no toca git)

EXIT  0 → todo en orden · 1 → algo que arreglar
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # playground/
DOC = ROOT / 'tablero' / 'data' / 'traps' / 'doc.md'
sys.path.insert(0, str(Path(__file__).resolve().parent))

ANCHOR = re.compile(r"^### (F-\d+)")
INDEX = re.compile(r"^## (Índice[^\n]*)")
CITATION = re.compile(r"F-\d+")


def review_index():
    """Cada `## Índice` tiene que citar todo lo que tiene ancla, y no citar lo que no existe."""
    failures = []
    lines = DOC.read_text().splitlines()
    anchors = {m.group(1) for l in lines if (m := ANCHOR.match(l))}
    indices = []
    for l in lines:
        if m := INDEX.match(l):
            indices.append((m.group(1).strip(), set()))
        elif indices and not l.startswith('## '):
            indices[-1][1].update(CITATION.findall(l))
    if anchors and not indices:
        failures.append(f"  sin-índice · {len(anchors)} trampas y ningún «## Índice»")
    for title, cited in indices:
        missing = sorted(anchors - cited, key=lambda f: int(f[2:]))
        if missing:
            failures.append(f"  fuera-del-índice · «{title}» no cita {len(missing)}: "
                          + ', '.join(missing[:12]) + (" …" if len(missing) > 12 else ""))
        for dead in sorted(cited - anchors, key=lambda f: int(f[2:])):
            failures.append(f"  índice-a-trampa-inexistente · «{title}» cita {dead}, sin ancla `### {dead}`")
    return len(anchors), failures


def review_citations():
    """Las citas `archivo:línea` del documento, contra `main`. Devuelve `(salida, líneas)`.

    ⚠ HASTA EL 2026-09-21 ESTE CHEQUEO NO PODÍA PONERSE EN ROJO. Filtraba las líneas del validador
    que anunciaban movidas o reescritas… y guardaba el resultado en una variable que no leía nadie:
    imprimía el resumen y devolvía 0 igual. O sea que una cita corrida salía en pantalla y `make
    trampas` seguía dando verde, que es exactamente el falso verde que el otro chequeo existe para
    no dar. Ahora el balde roto decide la salida, y se listan las primeras para poder arreglarlas
    sin volver a correr nada.
    """
    try:
        from citations import review
    except ImportError as e:
        return 1, [f"  ⚠ no se pudieron validar las citas: falta tablero/tools/citations.py ({e})"]

    buckets, _ = review([str(DOC)])
    tot = sum(len(v) for v in buckets.values())
    lines = [f"  {tot} citas · ✓ {len(buckets['ok'])} ancladas · · {len(buckets['sin-ancla'])} sin ancla"
              f" · ? {len(buckets['no-existe'])} no existen en main"]

    broken = [(k, buckets[k]) for k in ("movida", "reescrita", "fuera") if buckets[k]]
    if not broken:
        return 0, lines
    lines.append("")
    lines.append("  ✗ citas que ya no apuntan a lo que dicen:")
    for _, items in broken:
        for where, citation, note in sorted(items)[:8]:
            lines.append(f"    {where:22s} {citation:54s} {note}")
    lines.append(f"  → todas: python3 {Path('tablero/tools/citations.py')} {DOC.relative_to(ROOT)}")
    return 1, lines


def main():
    total, failures = review_index()
    print(f"\n  TRAMPAS · {total} con ancla en {DOC.relative_to(ROOT)}\n")
    output = 0
    if '--indice' not in sys.argv:
        output, lines = review_citations()
        for l in lines:
            print(l)
    if failures:
        print("\n✗ el índice no está completo — una trampa fuera de la puerta se lee como «no nos pasó»:\n")
        print('\n'.join(failures))
        return 1
    print("  ✓ índice completo: toda trampa con ancla está citada, y ninguna cita apunta al vacío")
    return output


if __name__ == '__main__':
    sys.exit(main())
