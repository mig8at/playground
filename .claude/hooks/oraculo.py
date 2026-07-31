#!/usr/bin/env python3
"""PostToolUse: valida las rutas de un `map.json` del árbol de context y regenera el ROUTE-MAP.

QUÉ PROBLEMA RESUELVE. Cada nodo de `context/` trae una lista de archivos fuente ("abrí estos para
entender este tema"). Una ruta mal escrita **no rompe nada**: nadie se entera. El próximo que lea el
contexto busca un archivo que no está — pierde tiempo, o peor, concluye sin esa pieza. El oráculo ya
detectaba eso, pero había que ACORDARSE de correrlo, y una regla que depende de la memoria de alguien
es una regla que se olvida. Esto la vuelve automática.

ORDEN DE LOS PASOS, y el primero no es opcional:
  1. `build-index.py` — el índice es un snapshot del WORKING TREE. Si está viejo (p. ej. se construyó
     con otra rama checkeada), el oráculo reporta DROPs de archivos que sí existen. Ya pasó: un falso
     positivo se venía repitiendo como si fuera deriva real. Cuesta 0,22 s; regenerar siempre elimina
     esa clase entera de error.
  2. `oracle.py` sobre el map.json que se tocó.
  3. `build-route-map.py` — el ROUTE-MAP está declarado como GENERADO, así que se rehace dropee o no.

Un `PostToolUse` **no puede bloquear** (el tool ya corrió), pero con `exit 2` su stderr vuelve al modelo
como error y no se puede ignorar. Para este caso alcanza: lo escrito ya está, lo que importa es que no
quede sin arreglar.
"""
import json
import pathlib
import subprocess
import sys


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # sin payload no hay nada que validar; jamás frenar la sesión por esto

    destino = payload.get("tool_input", {}).get("file_path") or ""
    ruta = pathlib.Path(destino)

    # El filtro va acá y no en el `matcher` del settings para que el hook sea autocontenido:
    # cualquier archivo que no sea un map.json del árbol sale en microsegundos.
    if ruta.name != "map.json" or "server/data/flows" not in ruta.as_posix():
        return 0

    # .../context/server/data/flows/<id>/map.json → parents[4] es `context/`
    try:
        tools = ruta.parents[4] / "tools"
    except IndexError:
        return 0
    if not (tools / "oracle.py").exists():
        return 0

    def corre(script: str, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(tools / script), *args],
            capture_output=True, text=True, timeout=120,
        )

    corre("build-index.py")                       # (1) SIEMPRE primero
    res = corre("oracle.py", str(ruta))           # (2)
    corre("build-route-map.py")                   # (3)

    salida = (res.stdout or "") + (res.stderr or "")
    drops = [l.strip().removeprefix("DROP:").strip()
             for l in salida.splitlines() if "DROP:" in l]

    if not drops:
        return 0

    nodo = ruta.parent.name
    print(f"⚠ {nodo}/map.json cita {len(drops)} ruta(s) que NO existen en los repos:", file=sys.stderr)
    for d in drops:
        print(f"   · {d}", file=sys.stderr)
    print(
        "\nQué hacer, según el caso:\n"
        "  · ruta mal escrita → corregila;\n"
        "  · el archivo vive en una rama SIN MERGEAR → sacalo de `files[]` y marcá la sección del\n"
        "    `doc.md` con «⏳ PENDIENTE DE MERGE» (el contexto se mide contra `main`);\n"
        "  · el archivo se borró del repo → sacá la ruta y actualizá el texto que la citaba.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — un hook roto NUNCA debe frenar la sesión
        print(f"hook oraculo.py falló (no bloqueante): {e}", file=sys.stderr)
        sys.exit(1)
