#!/usr/bin/env python3
"""normalize.py [--old] — JSON canónico (claves ordenadas) de stdin, para comparar salidas de la fase 4b.

Con `--old` además traduce las claves viejas con `maps/phase4b-json.tsv`, así la salida de ANTES y la de
AHORA se comparan por contenido: si difieren en algo más que el nombre de las claves, es un error.
`--reverse` hace lo contrario (claves nuevas → viejas): sirve para rearmar el caché de ramas viejo.

No traduce adentro del brief de canon (`canon: [...]` en `retomar -json`): esas claves son de la
respuesta de canon —`objetivo`, `secciones`— y quedan como vienen. Si la entrada no es JSON, sale 2 y
no imprime nada: el llamador compara esa salida como texto.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
# Claves que YA eran inglesas antes de la fase y coinciden con un nombre nuevo: el `draft` de un PR en el
# caché de ramas existía antes que `borrador → draft`. El camino inverso no las toca, o las inventa.
REVERSE_KEEP = {"draft"}
VERSIONS = {"tablero.tarea.v1": "tablero.task.v2"}


def load_map(reverse=False):
    pairs = []
    for line in (HERE.parent / "maps" / "phase4b-json.tsv").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            pairs.append(line.split())
    news = [n for _, n in pairs]
    dup = {n for n in news if news.count(n) > 1}
    if dup:
        sys.exit(f"el mapa no es biyectivo: {sorted(dup)} reciben dos claves viejas")
    return {n: o for o, n in pairs if n not in REVERSE_KEEP} if reverse else dict(pairs)


def rename(node, keymap):
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k == "canon" and isinstance(v, list) and v and isinstance(v[0], dict):
                out[k] = v  # el brief de canon: contrato de canon
            elif k == "schemaVersion" and v in VERSIONS:
                out[k] = VERSIONS[v]  # el cambio de versión es el buscado
            else:
                out[keymap.get(k, k)] = rename(v, keymap)
        return out
    if isinstance(node, list):
        return [rename(x, keymap) for x in node]
    return node


def main(argv):
    raw = sys.stdin.read()
    try:
        doc = json.loads(raw)
    except ValueError:
        return 2
    if "--old" in argv:
        doc = rename(doc, load_map())
    elif "--reverse" in argv:
        doc = rename(doc, load_map(reverse=True))
        print(json.dumps(doc, ensure_ascii=False, indent=2))
        return 0
    print(json.dumps(doc, ensure_ascii=False, sort_keys=True, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
