"""Los repos que el árbol indexa y qué cuenta como archivo fuente.

⚠ **YA NO ES LA FUENTE: ES UN PUENTE.** La lista de repos, la resolución de la ref a mirar y el
índice de «qué existe en main» se mudaron a `tablero/tools/citas.py` el 2026-09-21, cuando este árbol
empezó a apagarse. El motor tenía que sobrevivir a `context/` —lo necesita `make trampas`, que valida
las citas de las trampas del sistema— y dos copias habrían derivado sin avisar: el síntoma de esa
deriva es un VERDE, porque un repo que falta devuelve «menos archivos» y «menos» se lee igual que «no
existe» (es la lección medida de `roots.py` leyendo el `main` local, F-… y el §4 del CLAUDE.md raíz).

Lo que queda acá es lo que sólo significa algo para el árbol y muere con él: `es_local`, `EXCLUDE` y
`PLAYGROUND`. Todo lo demás se re-exporta para que los diez consumidores no cambien ni una línea.
"""
import os
import sys

PLAYGROUND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# El motor vive en el tablero, que es lo que sobrevive. El insert va acá y no en cada consumidor
# porque `roots` es la capa más baja: la importan los diez.
sys.path.insert(0, os.path.join(PLAYGROUND, "tablero", "tools"))
from citas import (  # noqa: E402,F401
    EXTS,
    ROOTS,
    del_ref,
    ref_a_indexar,
    refrescar_remotos,
)


def es_local(alias):
    """¿El alias apunta a una HERRAMIENTA DE ESTE REPO y no a un repo de la compañía?

    Se DERIVA de la ruta; no hay lista. Una lista a mano se desactualiza el día que se agregue una
    herramienta, y el síntoma sería justo lo que esto viene a quitar: ruido en el ranking de deriva.

    POR QUÉ IMPORTA LA DISTINCIÓN. El sello y la deriva contestan «¿el código cambió por debajo de lo
    que escribí?». Para los repos de la compañía eso importa porque lo cambian otros, en otro repo,
    sin avisar: el nodo es la única memoria. Para `harness` o `trazador`, el código y su documentación
    viven acá y se commitean juntos, así que lo que los mantiene al día es el commit, no el sello.
    Medirlos con la misma vara produce ruido, y está medido: el 2026-09-21, de 24 archivos con deriva
    en TODO el árbol, 23 eran de herramientas locales y 1 de CreditOp — el único que importaba quedaba
    enterrado debajo.

    ⚠ Un alias DESCONOCIDO no es local. Parece obvio y no lo es: `os.path.abspath("")` devuelve el
    directorio actual, que corriendo desde acá está dentro del playground — o sea que la primera
    versión daba `True` para cualquier alias que no existiera, y un alias mal escrito habría
    desaparecido del ranking en silencio. Exactamente el falso verde que esto viene a evitar.
    """
    raiz = ROOTS.get(alias)
    if not raiz:
        return False
    raiz = os.path.abspath(raiz)
    return raiz == PLAYGROUND or raiz.startswith(PLAYGROUND + os.sep)


EXCLUDE = {"node_modules", "vendor", ".git", ".next", "coverage", ".turbo", ".idea", ".vscode"}
