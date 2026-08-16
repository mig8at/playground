#!/usr/bin/env python3
"""`repos.json` — imprimirlo y VALIDARLO. La guardia del índice por repo.

Por qué no lo valida `oracle.py`: aquel dropea a propósito `.md`, `.sql` y `.yaml`, porque el mapa de
un nodo indexa CÓDIGO y esa regla evita que se llene de migraciones. Pero este índice contesta otra
pregunta —«¿cómo se ensambla este proyecto?»— y ahí el `composer.json`, el `turbo.json`, el `openapi.yaml`
y el ADR **son** la respuesta. Distinta pregunta, distinta regla, validador propio.

    python3 tools/repos.py ver [alias]   # legible, para leer o para pasarle a un agente
    python3 tools/repos.py check         # ¿todas las rutas existen en main?

`check` sale 1 si hay rutas muertas: un índice que apunta a un archivo que ya no está es peor que no
tenerlo, porque un modelo lo abre, no lo encuentra, y concluye cualquier cosa.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from roots import ROOTS  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
INDICE = RAIZ / "repos.json"


def cargar():
    return json.loads(INDICE.read_text(encoding="utf-8"))


def _existe_en_main(alias, rel):
    """¿La ruta está en `main`? Contra main y no contra el working tree, como todo el árbol: los repos
    reales trabajan en ramas, y un archivo que sólo existe en la tuya daría un falso OK."""
    root = ROOTS.get(alias)
    if not root or not Path(root).is_dir():
        return None  # repo no clonado: ni OK ni DROP, se declara aparte
    r = subprocess.run(["git", "-C", root, "cat-file", "-e", f"main:./{rel}"],
                       capture_output=True, text=True, timeout=30)
    return r.returncode == 0


def ver(filtro=None):
    d = cargar()
    print(f"\n{'═' * 96}")
    for linea in d["la_historia_en_una_linea"]:
        print(f"  {linea}")
    print(f"{'═' * 96}")
    for alias, r in d["repos"].items():
        if filtro and filtro != alias:
            continue
        print(f"\n▸ {alias}   ({r['stack']})")
        print(f"  {r['que_es']}")
        print(f"  nació: {r['nacio']}")
        print(f"  cómo se ensambla: {r['como_se_ensambla']}")
        print("  por dónde entrar:")
        for e in r["entrada"]:
            print(f"    · {e['ruta']}")
            print(f"        {e['por_que']}")
    if not filtro:
        print()
        for linea in d["_los_go_comparten_molde"]:
            print(f"  {linea}")
    print()
    return 0


def check():
    d = cargar()
    vivas = muertas = sin_repo = 0
    problemas = []
    for alias, r in d["repos"].items():
        for e in r["entrada"]:
            ruta = e["ruta"]
            if "/" not in ruta:
                problemas.append(f"{ruta} — sin alias (va 'alias/camino')")
                muertas += 1
                continue
            a, rel = ruta.split("/", 1)
            if a not in ROOTS:
                problemas.append(f"{ruta} — alias '{a}' no está en roots.py")
                muertas += 1
                continue
            if a != alias:
                problemas.append(f"{ruta} — está bajo '{alias}' pero su alias es '{a}'")
            estado = _existe_en_main(a, rel)
            if estado is None:
                sin_repo += 1
            elif estado:
                vivas += 1
            else:
                problemas.append(f"{ruta} — NO existe en main")
                muertas += 1

    if problemas:
        print("⚠ problemas:")
        for p in problemas:
            print(f"    {p}")
    extra = f" · {sin_repo} sin repo clonado" if sin_repo else ""
    print(f"\nrepos.json: {len(d['repos'])} repos · {vivas} rutas vivas en main · {muertas} muertas{extra}")
    return 1 if muertas else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    verbo = args[0] if args else "ver"
    if verbo == "check":
        sys.exit(check())
    sys.exit(ver(args[1] if len(args) > 1 else None))
