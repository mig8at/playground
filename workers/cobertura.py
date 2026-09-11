"""cobertura — cruza la lógica QUEMADA contra lo que canon declara, y contra su PESO.

POR QUÉ EXISTE. `quemado` dice dónde el código decide por identidad: 391 lugares. Pero los trata a
todos igual, y no lo son. Un id quemado en un camino que el equipo toca todas las semanas es una
trampa activa; el mismo id en un archivo que nadie mira hace tres meses es deuda conocida; y un id en
un archivo que NINGÚN área de canon declara es peor que las dos: es invisible para quien lee el corpus
antes de atacar una tarea.

⚠ NO REIMPLEMENTA NADA. El detector es `quemado` y el peso lo mide `canon -peso`: acá sólo se cruzan
por archivo. Dos herramientas que cuenten lo mismo de dos formas producen dos verdades, y la discusión
pasa a ser cuál de las dos está bien — es la misma razón por la que el panel de canon usa los cortes
de `-chats` y no los suyos.
"""
import json
import os
import subprocess
import sys
from collections import defaultdict

CANON = os.path.expanduser("~/Desktop/CREDITOP/github/playground/tools/canon")
CLONES = os.path.expanduser("~/Desktop/CREDITOP/github")


def areas_de_canon():
    """(repo, ruta) → [(tema, n)], leído de los mapas del corpus. Es la fuente, no una copia."""
    porArchivo = defaultdict(list)
    objetivos = {}
    raiz = os.path.join(CANON, "content")
    if not os.path.isdir(raiz):
        return porArchivo, objetivos
    for tema in sorted(os.listdir(raiz)):
        p = os.path.join(raiz, tema, "map.json")
        if not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8") as f:
            mapa = json.load(f)
        for i, a in enumerate(mapa.get("areas", [])):
            objetivos[(tema, i)] = a.get("objetivo", "")
            for repo, rutas in (a.get("fuentes") or {}).items():
                for ruta in rutas:
                    porArchivo[(repo, ruta)].append((tema, i))
    return porArchivo, objetivos


def peso_de_canon():
    """(tema, n) → commits de los últimos 90 días. Lo mide canon; acá sólo se le pregunta.

    Si canon no se puede correr —sin Go, sin clones— se devuelve vacío y el cruce sigue funcionando
    sin la columna de peso, en vez de fallar entero."""
    try:
        out = subprocess.run(
            ["go", "run", ".", "-peso", "json"], cwd=CANON, capture_output=True, text=True, timeout=300,
            env={**os.environ, "CANON_CONTENIDO": "./content", "CANON_REPOS": CLONES},
        ).stdout
        datos = json.loads(out[out.index("{"):])
    except Exception as e:                      # noqa: BLE001 — cualquier falla degrada, no rompe
        print(f"  ⚠ sin peso: no se pudo correr `canon -peso` ({type(e).__name__})", file=sys.stderr)
        return {}
    return {(a["node"].split("/")[0], a["n"]): a.get("commits", 0) for a in datos.get("areas", [])}


def cruzar(hits):
    porArchivo, objetivos = areas_de_canon()
    peso = peso_de_canon()
    filas = []
    for h in hits:
        clave = (h.get("repo"), h.get("archivo"))
        areas = porArchivo.get(clave, [])
        if areas:
            mejor = max(areas, key=lambda k: peso.get(k, 0))
            filas.append({**h, "area": f"{mejor[0]}#{mejor[1]}", "commits": peso.get(mejor, 0),
                          "objetivo": objetivos.get(mejor, ""), "declarado": True})
        else:
            filas.append({**h, "area": None, "commits": None, "objetivo": "", "declarado": False})
    return filas, bool(peso)
