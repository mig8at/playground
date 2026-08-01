#!/usr/bin/env python3
"""Qué cambió en el código de un nodo DESDE que se verificó. El insumo real para re-contextualizar.

POR QUÉ EXISTE. `alinear.py` dice *qué archivos* cambiaron y *quién* los tocó; `refs.py` dice si las
citas `archivo:línea` siguen apuntando bien. Ninguno contesta la única pregunta que decide si el nodo
sigue siendo cierto: **¿qué dice el código hoy que no decía cuando lo escribí?** Eso se contesta
leyendo, y hasta ahora leerlo costaba reconstruir a mano el repo, el commit del sello y las rutas —
fricción suficiente para que se sellara sin leer (pasó con `ecommerce` el 2026-07-31).

EL DIFF ACUMULADO, NO EL LOG DE COMMITS. `git log -p` cuenta el camino: el mismo archivo aparece
tres veces si lo tocaron tres commits, y hay que ir sumando de cabeza. Para re-contextualizar no
importa el camino, importa **antes contra ahora**: un solo `git diff sello..main`. En los nodos
grandes es varias veces más corto y no obliga a reconciliar cambios que se pisaron entre sí.

Los asuntos de los commits (que sí salen en `alinear.py`) sirven para TRIAR — «esto es de CreditopX,
no toca mi nodo» — pero dicen la intención, no el resultado. La conclusión sale de acá.

USO
  python3 tools/diff.py <nodo>            # resumen por archivo + el diff completo
  python3 tools/diff.py <nodo> --stat     # solo el resumen (cuánto cambió cada archivo)
  python3 tools/diff.py <nodo> --files a.php b.tsx    # solo esos archivos del nodo

EXIT  0 → hay diff (o no hay nada que mostrar) · 2 → el nodo no existe o no tiene sello
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from alinear import base_en, pathspec, rutas_de  # mismo criterio que la alineación
from roots import ROOTS

CTX = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(CTX, "server", "data", "flows")


def git(root, *args):
    r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, errors="replace")
    return r.stdout if r.returncode == 0 else ""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    solo_stat = "--stat" in sys.argv
    filtro = None
    if "--files" in sys.argv:
        i = sys.argv.index("--files")
        filtro = [a for a in sys.argv[i + 1:] if not a.startswith("--")]
        args = [a for a in args if a not in filtro]
    if not args:
        print(__doc__.strip().split("\n\n")[0])
        print("\nfalta el nodo · ej: python3 tools/diff.py onboarding")
        return 2

    nid = args[0]
    mp = os.path.join(FLOWS, nid, "map.json")
    if not os.path.isfile(mp):
        print(f"no existe el nodo `{nid}`")
        return 2
    d = json.load(open(mp))
    sello = (d.get("verified") or {}).get("date")
    ref = (d.get("verified") or {}).get("ref", "main")
    if not sello:
        print(f"`{nid}` no tiene `verified.date` en su map.json: no hay contra qué diffear.")
        return 2

    archivos = [f for f in d.get("files", [])
                if not filtro or any(x in f.partition("/")[2] for x in filtro)]
    por_repo = rutas_de(archivos)

    print(f"╔═ {nid} · qué cambió en `{ref}` desde que se verificó ({sello})")
    print(f"╚═ sobre los {len(archivos)} archivos que el nodo declara"
          + (f" · filtrado por {filtro}" if filtro else ""))

    hubo = False
    for alias, (root, pre, rutas) in por_repo.items():
        base = base_en(root, ref, sello)      # el «antes»: el commit al cierre del día del sello
        if not base:
            continue
        # `-M` y el pathspec con las rutas VIEJAS: sin eso un renombre se lee como archivo nuevo
        # entero (el nodo `harness` mostraba sus 44 archivos como +203 líneas cada uno).
        spec = pathspec(root, pre, rutas, base)
        stat = git(root, "diff", "--stat", "-M", f"{base}..{ref}", "--", *spec).strip()
        if not stat:
            continue
        hubo = True
        print(f"\n── {alias}  ({base[:9]} … {ref}) ──")
        print(stat)
        if not solo_stat:
            print()
            print(git(root, "diff", "-M", f"{base}..{ref}", "--", *spec).rstrip())

    if not hubo:
        print("\n✓ ningún archivo del nodo cambió desde el sello.")
    elif solo_stat:
        print(f"\n(el diff completo: python3 tools/diff.py {nid})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
