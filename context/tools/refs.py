#!/usr/bin/env python3
"""¿Las referencias `archivo:línea` de los nodos siguen apuntando a lo que dicen?

⚠ **EL MOTOR YA NO VIVE ACÁ.** Se mudó a `tablero/tools/citas.py` el 2026-09-21, cuando este árbol
empezó a apagarse: quien lo necesita para siempre es `make trampas`, que valida las 149 citas de las
trampas del sistema, y ese documento ya está en el tablero. Lo que queda acá es lo único propio del
árbol —recorrer los nodos y leerles el sello— y muere con él. La explicación de CÓMO se valida una
cita (el ancla de git, los baldes, por qué no se emparejan símbolos) está en el docstring de
`citas.py`, que es donde está el código: repetirla acá sería una copia envejeciendo.

`diff.py` y `alinear.py` importan de este módulo, así que re-exporta lo que usaban. Un archivo que
sólo reexporta se borra junto con sus importadores el día que el árbol se apague.

USO
  python3 tools/refs.py                 → todos los nodos
  python3 tools/refs.py <nodo> [<nodo>] → solo esos
  python3 tools/refs.py --ok            → lista también las que están bien

EXIT  0 → nada que corregir · 1 → hay movidas, reescritas o fuera de rango
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roots  # noqa: F401,E402  — pone `tablero/tools` en el path (ver su encabezado)
from citas import (  # noqa: E402,F401
    CORTA,
    REF,
    escrita_en,
    evaluar,
    indice,
    informe,
    renombres,
    repo_de,
    revisar,
)

CTX = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(CTX, "server", "data", "flows")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    nodos = args or sorted(os.listdir(FLOWS))
    docs = [os.path.join(FLOWS, nid, "doc.md") for nid in nodos]
    baldes, sin_sello = revisar(docs)
    return informe(baldes, sin_sello, ver_ok="--ok" in sys.argv)


if __name__ == "__main__":
    sys.exit(main())
