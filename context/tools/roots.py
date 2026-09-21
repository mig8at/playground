"""Los repos que el árbol indexa y qué cuenta como archivo fuente.

⚠ **YA NO ES LA FUENTE: ES UN PUENTE.** La lista de repos, la resolución de la ref a mirar y el
índice de «qué existe en main» se mudaron a `tools/repos.py`, en la raíz, el 2026-09-21, cuando este
árbol empezó a apagarse. Tenían que sobrevivir a `context/` —los necesitan el tablero, el trazador y `workers`— y dos copias
habrían derivado sin avisar: el síntoma de esa deriva es un VERDE, porque un repo que falta devuelve
«menos archivos» y «menos» se lee igual que «no existe» (es la lección del §4 del CLAUDE.md raíz).

Lo que queda acá es `EXCLUDE`, que sólo significa algo para el índice de este árbol. Todo lo demás se
re-exporta para que los diez consumidores no cambien ni una línea.
"""
import os
import sys

PLAYGROUND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

sys.path.insert(0, os.path.join(PLAYGROUND, "tools"))
from repos import (  # noqa: E402,F401
    EXTS,
    ROOTS,
    del_ref,
    es_local,
    ref_a_indexar,
    refrescar_remotos,
)

EXCLUDE = {"node_modules", "vendor", ".git", ".next", "coverage", ".turbo", ".idea", ".vscode"}
