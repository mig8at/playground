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
2. **Las citas `archivo:línea` se corren.** Se validan con `citas.py`, acá al lado: lee los repos y
   ancla por CONTENIDO —guarda el texto que tenía la línea el día que se afirmó y lo busca en `main`
   hoy—, así que sigue renombres y no se deja engañar por un archivo que ganó un import arriba. Ese
   motor vivía en `context/tools/refs.py` y se mudó con las trampas el 2026-09-21: es el mismo
   archivo, no una copia.

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
sys.path.insert(0, str(Path(__file__).resolve().parent))

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
    """Las citas `archivo:línea` del documento, contra `main`. Devuelve `(salida, líneas)`.

    ⚠ HASTA EL 2026-09-21 ESTE CHEQUEO NO PODÍA PONERSE EN ROJO. Filtraba las líneas del validador
    que anunciaban movidas o reescritas… y guardaba el resultado en una variable que no leía nadie:
    imprimía el resumen y devolvía 0 igual. O sea que una cita corrida salía en pantalla y `make
    trampas` seguía dando verde, que es exactamente el falso verde que el otro chequeo existe para
    no dar. Ahora el balde roto decide la salida, y se listan las primeras para poder arreglarlas
    sin volver a correr nada.
    """
    try:
        from citas import revisar
    except ImportError as e:
        return 1, [f"  ⚠ no se pudieron validar las citas: falta tablero/tools/citas.py ({e})"]

    baldes, _ = revisar([str(DOC)])
    tot = sum(len(v) for v in baldes.values())
    lineas = [f"  {tot} citas · ✓ {len(baldes['ok'])} ancladas · · {len(baldes['sin-ancla'])} sin ancla"
              f" · ? {len(baldes['no-existe'])} no existen en main"]

    rotas = [(k, baldes[k]) for k in ("movida", "reescrita", "fuera") if baldes[k]]
    if not rotas:
        return 0, lineas
    lineas.append("")
    lineas.append("  ✗ citas que ya no apuntan a lo que dicen:")
    for _, items in rotas:
        for donde, cita, nota in sorted(items)[:8]:
            lineas.append(f"    {donde:22s} {cita:54s} {nota}")
    lineas.append(f"  → todas: python3 {Path('tablero/tools/citas.py')} {DOC.relative_to(RAIZ)}")
    return 1, lineas


def main():
    total, fallas = revisar_indice()
    print(f"\n  TRAMPAS · {total} con ancla en {DOC.relative_to(RAIZ)}\n")
    salida = 0
    if '--indice' not in sys.argv:
        salida, lineas = revisar_citas()
        for l in lineas:
            print(l)
    if fallas:
        print("\n✗ el índice no está completo — una trampa fuera de la puerta se lee como «no nos pasó»:\n")
        print('\n'.join(fallas))
        return 1
    print("  ✓ índice completo: toda trampa con ancla está citada, y ninguna cita apunta al vacío")
    return salida


if __name__ == '__main__':
    sys.exit(main())
