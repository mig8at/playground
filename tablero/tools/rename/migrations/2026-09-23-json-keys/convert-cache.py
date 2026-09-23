#!/usr/bin/env python3
"""convert-cache.py [ruta] — pasa `data/cache/ramas.json` a las claves de la fase 4b, una sola vez.

El server lee el snapshot de ramas decodificándolo en structs; con las etiquetas nuevas, un archivo
viejo se leería VACÍO —«sin medición»— sin ningún error. `make tareas-ramas` lo reescribe con las claves
nuevas cada vez que mide, así que esto sólo evita tener que medir de nuevo el día del cambio.

Renombra claves de objeto que estén en el mapa; las que son dato —los ambientes (`develop`, `main`) de
`en`/`propios`/`como` y los ids de tarea de `tareas`— no están en el mapa y quedan.
"""
import json
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
TABLERO = HERE.parents[3]


def load_map():
    out = {}
    for line in (HERE.parents[1] / "maps" / "phase4b-json.tsv").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            old, new = line.split()
            out[old] = new
    return out


def rename(node, keymap):
    if isinstance(node, dict):
        return {keymap.get(k, k): rename(v, keymap) for k, v in node.items()}
    if isinstance(node, list):
        return [rename(x, keymap) for x in node]
    return node


def main(argv):
    path = pathlib.Path(argv[0]) if argv else TABLERO / "data" / "cache" / "ramas.json"
    doc = json.loads(path.read_text())
    if "measuredAt" in doc:
        print(f"{path}: ya tiene las claves nuevas")
        return 0
    new = rename(doc, load_map())
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, path)
    print(f"{path}: convertido ({len(new.get('tasks', {}))} tareas)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
