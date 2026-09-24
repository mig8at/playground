"""Los repos de la compañía para las herramientas en Python: la lista, qué ref mirar y qué existe.

⚠ ESTO YA NO TIENE LÓGICA: la lista vive en `tools/repos.json` y todo lo que toca git lo resuelve
`tablero/server/cmd/repos` (Go, sobre `connectors/repos`), que es la fuente única. Este archivo lee la
lista y le pregunta al comando, con los mismos nombres que tenía cuando la lógica vivía acá, para que
su consumidor (la huella del trazador) no cambie mientras se migra. Por qué la lista es UNA sola, y el criterio para agregar un repo: `connectors/repos`.

    sys.path.insert(0, str(Path(__file__).resolve().parents[N] / "tools"))
    from repos import ROOTS, del_ref, ref_a_indexar
"""
import json
import os
import subprocess
import sys

PLAYGROUND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD_SERVER = os.path.join(PLAYGROUND, "tablero", "server")
BINARY = os.path.join(os.path.expanduser("~/.cache/playground"), "repos")
# Lo que compila el binario: si algo de esto es más nuevo que el binario, se recompila.
SOURCES = [os.path.join(BOARD_SERVER, "cmd", "repos"), os.path.join(BOARD_SERVER, "internal", "layout"),
           os.path.join(PLAYGROUND, "connectors", "repos")]


def _expand(path):
    if path.startswith("~/"):
        return os.path.expanduser(path)
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(PLAYGROUND, path))


with open(os.path.join(PLAYGROUND, "tools", "repos.json"), encoding="utf-8") as _fh:
    _LIST = json.load(_fh)

ROOTS = {alias: _expand(path) for alias, path in _LIST["indexed"].items()}
CITABLES = {**ROOTS, **{alias: _expand(path) for alias, path in _LIST["citable_only"].items()}}
EXTS = set(_LIST["extensions"])
DIAS_RANCIO = 14  # el mismo umbral que `repos.StaleDays`: a partir de acá se avisa que la ref está vieja


def es_local(alias):
    """¿El alias es una HERRAMIENTA DE ESTE REPO? Lo son las que la lista declara con ruta relativa al
    playground; un alias desconocido no lo es (si lo fuera, un alias mal escrito desaparecería)."""
    path = _LIST["indexed"].get(alias)
    return bool(path) and not path.startswith("~/") and not os.path.isabs(path)


def _binary():
    """El comando compilado, rehecho sólo si cambió su código: `go run` en cada llamada costaría un
    segundo por pregunta, y un consumidor pregunta varias veces."""
    newest = 0.0
    for src in SOURCES:
        for base, _, files in os.walk(src):
            for f in files:
                if f.endswith(".go"):
                    newest = max(newest, os.path.getmtime(os.path.join(base, f)))
    if not os.path.exists(BINARY) or os.path.getmtime(BINARY) < newest:
        os.makedirs(os.path.dirname(BINARY), exist_ok=True)
        subprocess.run(["go", "build", "-o", BINARY, "./cmd/repos"], cwd=BOARD_SERVER, check=True,
                       capture_output=True, text=True)
    return BINARY


def _ask(*args, timeout=600):
    run = subprocess.run([_binary(), *args], cwd=BOARD_SERVER, capture_output=True, text=True, timeout=timeout)
    if run.returncode != 0:
        raise RuntimeError(f"repos {' '.join(args)}: {run.stderr.strip()}")
    return json.loads(run.stdout)


_REFS = None


def ref_a_indexar(root, rama="main"):
    """`(ref, motivo)` de la ref que hay que mirar: la que CONTIENE a la otra entre `main` y
    `origin/main`. NO hace fetch. Se resuelven todas las de una vez y se cachean por proceso."""
    global _REFS
    if rama != "main":
        raise ValueError("sólo se resuelve `main`: es la única rama que los consumidores piden")
    if _REFS is None:
        _REFS = _ask("refs")
    choice = _REFS.get(root)
    if choice is None:
        choice = _ask("ref", root)
        _REFS[root] = choice
    return (choice["ref"] or None), choice["reason"]


def refrescar_remotos(roots=None, timeout=30, verboso=False):
    """`git fetch` de cada repo en paralelo; devuelve los alias que fallaron. Sólo actualiza refs
    remotas: no toca el working tree ni ninguna rama local."""
    global _REFS
    if roots is not None and set(roots) != set(ROOTS):
        raise ValueError("se refrescan todos los repos de la lista o ninguno")
    failed = _ask("refresh", str(int(timeout)))["failed"]
    _REFS = None  # las refs remotas cambiaron: lo cacheado ya no vale
    if verboso and failed:
        print(f"  ⚠ no se pudo actualizar: {', '.join(sorted(failed))} — se usa lo que hay en disco")
    return failed


def del_ref(ref=None):
    """`(have, sin_verificar, viejos)`: los archivos de código que existen en la ref como
    `alias/relpath`, los repos que no se pudieron consultar y las refs viejas. Con `None` la ref se
    resuelve por repo; una explícita no se toca."""
    out = _ask("in-ref", *([ref] if ref else []))
    return (set(out["have"]),
            [(u["alias"], u["reason"]) for u in out["unverified"] or []],
            [(s["alias"], s["days"], s["ref"]) for s in out["stale"] or []])


def ref_hoy(alias):
    """La ref contra la que se compara el «hoy» de un repo: se decide por repo, no es una constante."""
    root = ROOTS.get(alias)
    if not root:
        return "main"
    ref, _ = ref_a_indexar(root)
    return ref or "main"


def archivo(alias, ruta, sha=None):
    """¿Existe `ruta` en `alias`, y en qué commit? Lo mismo que `repos file`."""
    out = _ask("file", alias, ruta, *([sha] if sha else []))
    if out.get("error"):
        return {"error": out["error"]}
    out.pop("error", None)
    return out


if __name__ == "__main__":
    # Se conserva la línea de comandos de antes para quien todavía la llame.
    args = sys.argv[1:]
    if args[:1] == ["archivo"] and len(args) in (3, 4):
        print(json.dumps(archivo(*args[1:]), ensure_ascii=False))
    elif args == ["web"]:
        print(json.dumps(_ask("web"), ensure_ascii=False))
    else:
        print("uso: repos.py archivo <alias> <ruta> [<sha>]  ·  repos.py web", file=sys.stderr)
        sys.exit(2)
