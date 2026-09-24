#!/usr/bin/env python3
"""apply-go.py [-w] — renombra las claves JSON del server de Go según `maps/phase4b-json.tsv`.

Lee el inventario que da `server/cmd/naming -json-keys` (etiqueta de struct, clave de mapa literal o índice, con
archivo:línea y el tipo que la contiene) y reescribe SÓLO esa aparición en esa línea. Sin `-w` lista lo
que haría.

Quedan afuera, a propósito, las claves que son el contrato de OTRO:
  · `internal/canon` y `cmd/today.areaCanon` — la respuesta de canon (`objetivo`, `secciones`, `fuentes`);
  · `cmd/cuadrilla` — la API de cuadrilla (`rama`, `autor`, `nota`, `nombre`, `ramas`);
  · `internal/atlassian`, `cmd/jira-mcp` — Jira;
  · `cmd/web.jevCLIOutput` — la salida de `tools/jev.py`;
  · los ÍNDICES de `internal/store/store.go` — son claves del frontmatter, que se escribe a mano y la
    fase 0 dejó en español;
y lo que no es una clave aunque lo parezca: el mapa de palabras vacías de `cmd/branches`, la lista de
contenedores de `cmd/tasks`, los ambientes de `store/sources.go` y las variables de `internal/dbquery`.
"""
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
TABLERO = HERE.parents[2]
SERVER = TABLERO / "server"

SKIP_FILES = ("cmd/cuadrilla/", "cmd/branches/", "cmd/jira-mcp/", "internal/canon/", "internal/atlassian/",
              "internal/pulse/", "internal/dbquery/", "internal/store/sources.go", "internal/taskcontext/")
SKIP_CONTEXTS = ("areaCanon.", "jevCLIOutput.", "jevGuidance.")
SKIP_LINES = {("cmd/tasks/main.go", "map", "tablero"), ("cmd/tasks/main.go", "map", "trazador")}


def load_map():
    out = {}
    for line in (HERE.parent / "maps" / "phase4b-json.tsv").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            old, new = line.split()
            out[old] = new
    return out


def inventory():
    run = subprocess.run(["go", "run", "./cmd/naming", "-json-keys", str(SERVER)], cwd=SERVER,
                         capture_output=True, text=True, check=True)
    for row in run.stdout.splitlines():
        loc, kind, ctx, key = row.split("\t")
        path, line = loc.rsplit(":", 1)
        yield path, int(line), kind, ctx, key


def selected(keymap):
    for path, line, kind, ctx, key in inventory():
        if key not in keymap or path.startswith(SKIP_FILES) or ctx.startswith(SKIP_CONTEXTS):
            continue
        if kind == "index" and path == "internal/store/store.go":
            continue
        if (path, kind, key) in SKIP_LINES:
            continue
        yield path, line, kind, key


def main(argv):
    write = "-w" in argv
    keymap = load_map()
    edits = {}
    for path, line, kind, key in selected(keymap):
        edits.setdefault(path, []).append((line, kind, key))
    total = 0
    for path, items in sorted(edits.items()):
        f = SERVER / path
        lines = f.read_text().split("\n")
        for line, kind, key in items:
            new = keymap[key]
            src = lines[line - 1]
            if kind == "tag":
                pattern = re.compile(r'json:"' + re.escape(key) + r'([",])')
                repl = r'json:"' + new + r'\1'
            else:  # clave de mapa literal o índice: la cadena entre comillas
                pattern = re.compile(r'"' + re.escape(key) + r'"')
                repl = '"' + new + '"'
            got, n = pattern.subn(repl, src, count=1)
            if n != 1:
                print(f"✗ {path}:{line} no encontré {key!r} ({kind}) en: {src.strip()}", file=sys.stderr)
                return 1
            lines[line - 1] = got
            total += 1
            if not write:
                print(f"  {path}:{line}  {kind:5} {key} → {new}")
        if write:
            f.write_text("\n".join(lines))
    print(f"{'aplicadas' if write else 'se aplicarían'}: {total} en {len(edits)} archivos")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
