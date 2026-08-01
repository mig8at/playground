#!/usr/bin/env python3
"""Valida que las rutas de un `map.json` EXISTEN. Por default, contra `main`.

POR QUÉ CONTRA UNA RAMA Y NO CONTRA LO QUE HAY EN DISCO. El índice (`tools/index.txt`) es un snapshot
del WORKING TREE, o sea de la rama que cada uno tenga checkeada. Eso produce dos errores, y el segundo
es el peligroso:

  · FALSO DROP — con una feature branch puesta, rutas que sí están en `main` no aparecen. Molesta,
    pero avisa.
  · FALSO OK — con `qa` puesta, una ruta que SOLO existe en `qa` resuelve perfecto: el oráculo dice
    «todo bien» mientras el nodo afirma describir `main`. **Así entró la deriva del nodo `motai`**: 14
    archivos de una rama sin mergear pasaron sin que nada se quejara.

Preguntarle a git por una rama es READ-ONLY y cuesta ~0,13 s en los 6 roots: `git ls-tree` **no toca
el working tree** — no hace checkout, no hace fetch, no mueve el HEAD de nadie. Por eso es el default
y no una opción: la vara del contexto es `main` (ver el CLAUDE.md raíz).

USO
  oracle.py <map.json>                 → contra `main` (default)
  oracle.py <map.json> --ref qa        → contra otro ref (una rama, `origin/main`, un tag, un SHA)
  oracle.py <map.json> --worktree      → contra el índice, o sea lo que está checkeado ahora. Sirve
                                         para documentar una rama a propósito; en ese caso marcá la
                                         sección del doc.md con «⏳ PENDIENTE DE MERGE».

SALIDA
  KEPT n / DROPPED n (of n)  + una línea `DROP: <ruta>` por cada una que no existe.
  Un bloque `SIN VERIFICAR` si algún root no se pudo consultar — esas rutas NO cuentan como OK.

EXIT
  0 → todo resuelve · 1 → hay DROPs · 2 → algún root no se pudo verificar, o error de uso
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from roots import EXTS, ROOTS  # noqa: E402

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDX = os.path.join(ROOT_DIR, "tools", "index.txt")
DIAS_RANCIO = 14  # a partir de acá se avisa que el ref local puede estar detrás de origin


def git(root, *args):
    return subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)


def del_ref(ref):
    """Archivos que existen en `ref`, como `alias/relpath`. Devuelve además los roots que NO se
    pudieron consultar (para no contarlos como si estuvieran bien) y los refs viejos."""
    have, sin_verificar, viejos = set(), [], []
    for alias, root in ROOTS.items():
        if not os.path.isdir(root):
            sin_verificar.append((alias, "el directorio no existe"))
            continue
        # sin --full-name A PROPÓSITO: las rutas vienen relativas al DIRECTORIO consultado, que es
        # exactamente el `relpath` con el que el índice arma `alias/relpath`. Por eso `frontend-e2e`,
        # que es un subdirectorio de playground y no un repo propio, funciona sin caso especial.
        r = git(root, "ls-tree", "-r", ref, "--name-only")
        if r.returncode != 0:
            motivo = r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "falló git ls-tree"
            sin_verificar.append((alias, f"no se pudo leer `{ref}`: {motivo}"))
            continue
        for ruta in r.stdout.splitlines():
            if os.path.splitext(ruta)[1] in EXTS:
                have.add(f"{alias}/{ruta}")
        # ¿qué tan viejo es ese ref acá? NO se hace fetch (sería tocar la red por debajo): se avisa.
        f = git(root, "log", "-1", "--format=%ct", ref)
        if f.returncode == 0 and f.stdout.strip().isdigit():
            edad = datetime.now(timezone.utc) - datetime.fromtimestamp(int(f.stdout.strip()), timezone.utc)
            if edad.days >= DIAS_RANCIO:
                viejos.append((alias, edad.days))
    return have, sin_verificar, viejos


def del_indice():
    if not os.path.exists(IDX):
        sys.exit("falta tools/index.txt → corré: python3 tools/build-index.py")
    return set(l.strip() for l in open(IDX) if l.strip()), [], []


def main():
    args = list(sys.argv[1:])
    if not args:
        sys.exit(__doc__)

    ref, worktree = "main", False
    if "--worktree" in args:
        worktree = True
        args.remove("--worktree")
    if "--ref" in args:
        i = args.index("--ref")
        if i + 1 >= len(args):
            sys.exit("--ref necesita un valor (ej. --ref qa)")
        ref = args[i + 1]
        del args[i:i + 2]
    if not args:
        sys.exit("falta el map.json")

    data = json.load(open(args[0]))
    files = data if isinstance(data, list) else data.get("files", [])

    have, sin_verificar, viejos = del_indice() if worktree else del_ref(ref)
    ciegos_alias = {a for a, _ in sin_verificar}

    kept, dropped, ciegos = [], [], []
    for f in files:
        if f.split("/", 1)[0] in ciegos_alias:
            ciegos.append(f)
        elif f in have:
            kept.append(f)
        else:
            dropped.append(f)

    contra = "el working tree" if worktree else f"`{ref}`"
    print(f"KEPT {len(kept)} / DROPPED {len(dropped)} (of {len(files)}) — contra {contra}")
    for x in dropped:
        print("  DROP:", x)

    if ciegos:
        # solo los roots que este map.json de verdad usa: listar los otros es ruido que hace
        # parecer más grave el problema de lo que es
        usados = {f.split("/", 1)[0] for f in ciegos}
        print(f"\nSIN VERIFICAR ({len(ciegos)} ruta/s): no se pudo consultar su repo → NO cuentan como OK")
        for alias, motivo in sin_verificar:
            if alias in usados:
                print(f"  · {alias}: {motivo}")

    for alias, dias in viejos:
        print(f"⚠ el ref `{ref}` de {alias} es de hace {dias} días — puede estar detrás de origin "
              f"(no se hace fetch solo; si importa: git -C <repo> fetch)")

    return 2 if ciegos else (1 if dropped else 0)


if __name__ == "__main__":
    sys.exit(main())
