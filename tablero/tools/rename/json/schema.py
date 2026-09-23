#!/usr/bin/env python3
"""schema.py <entrada> <salida> — el schema del contrato con las claves del mapa de la fase 4b.

Renombra sólo NOMBRES de propiedad (las claves de `properties`) y las entradas de `required`; los
valores de `enum` y `const` son datos y quedan. Escribe con el mismo formato a mano del original: un
objeto que sólo describe un valor va en una línea, uno que es `type: object` o anida más que eso, abierto.
`--check` re-serializa la entrada sin cambios y compara, para probar que el formato se conserva.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent


def load_map():
    out = {}
    for line in (HERE.parent / "maps" / "phase4b-json.tsv").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            old, new = line.split()
            out[old] = new
    return out


def rename(node, keymap):
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k == "properties" and isinstance(v, dict):
                out[k] = {keymap.get(p, p): rename(s, keymap) for p, s in v.items()}
            elif k == "required" and isinstance(v, list):
                out[k] = [keymap.get(p, p) for p in v]
            else:
                out[k] = rename(v, keymap)
        return out
    if isinstance(node, list):
        return [rename(x, keymap) for x in node]
    return node


def leaf(d):
    return isinstance(d, dict) and all(not isinstance(v, dict) for v in d.values())


def inline(d):
    return isinstance(d, dict) and d.get("type") != "object" and "properties" not in d and all(
        not isinstance(v, dict) or leaf(v) for v in d.values())


def dump(v, indent=0, root=True, key=None):
    if isinstance(v, dict):
        if not root and key != "properties" and inline(v):  # la lista de propiedades va siempre abierta
            return "{ " + ", ".join(f"{json.dumps(k, ensure_ascii=False)}: {dump(x, 0, False, k)}" for k, x in v.items()) + " }"
        pad = "  " * (indent + 1)
        items = [f"{pad}{json.dumps(k, ensure_ascii=False)}: {dump(x, indent + 1, False, k)}" for k, x in v.items()]
        return "{\n" + ",\n".join(items) + "\n" + "  " * indent + "}"
    if isinstance(v, list):
        return "[" + ", ".join(dump(x, indent, False) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False)


def main(argv):
    src = pathlib.Path(argv[0]).read_text()
    doc = json.loads(src)
    if "--check" in argv:
        same = dump(doc) + "\n" == src
        print("formato conservado" if same else "✗ el formato no se reproduce")
        return 0 if same else 1
    new = rename(doc, load_map())
    new["$id"] = new["$id"].replace("tarea.v1", "task.v2")
    new["properties"]["schemaVersion"] = {"const": "tablero.task.v2"}
    pathlib.Path(argv[1]).write_text(dump(new) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
