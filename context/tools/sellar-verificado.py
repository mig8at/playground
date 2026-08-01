#!/usr/bin/env python3
"""Pone (o actualiza) el sello `verified` de un nodo: contra qué ref se validó y cuándo.

PARA QUÉ. El oráculo contesta *¿el archivo existe?*. La pregunta que faltaba es *¿sigue diciendo lo
mismo que cuando escribí el nodo?* — y para eso hace falta una **fecha legible por máquina** contra la
que comparar los commits de `main`. Sin el sello no hay "desde cuándo", y un nodo con todas sus rutas
resolviendo puede describir código que cambió por debajo (medido: `onboarding` tenía 40 de 83 archivos
tocados en `main` desde su verificación).

FORMA
    "verified": { "ref": "main", "date": "2026-07-31", "source": "cabecera" }

`source` dice CÓMO se obtuvo la fecha, y es lo que evita tratar una estimación como un hecho:
  · `cabecera`  — salió del encabezado del `doc.md`, donde alguien la escribió al verificar.
  · `git-doc`   — ESTIMADA: es la fecha del último commit que tocó ese `doc.md`. Es un piso, no una
                  verificación: dice "no puede ser más nuevo que esto".
  · `manual`    — la puso este comando al sellar a mano (o sea: acabo de verificar el nodo).

USO
    sellar-verificado.py                 → rellena los que NO tienen sello (no toca los que ya tienen)
    sellar-verificado.py --todos         → recalcula todos, incluidos los que ya tienen
    sellar-verificado.py <nodo> [--ref X]→ sella ESE nodo con la fecha de hoy y source=manual
"""
import json
import os
import re
import subprocess
import sys
from datetime import date

TOOLS = os.path.dirname(os.path.abspath(__file__))
FLOWS = os.path.join(os.path.dirname(TOOLS), "server", "data", "flows")
FECHA = re.compile(r"\b(20\d\d-\d\d-\d\d)\b")
REF = re.compile(r"`(?:origin/)?(main|qa|develop|feature/[\w./-]+)`")


def escribir(map_path, sello):
    """Reescribe el map.json preservando el orden de claves y dejando `verified` después de `when`,
    que es donde un humano lo busca (junto a lo que describe el nodo, no al final del archivo)."""
    with open(map_path) as fh:
        d = json.load(fh)
    d.pop("verified", None)
    salida, puesto = {}, False
    for k, v in d.items():
        salida[k] = v
        if k == "when":
            salida["verified"], puesto = sello, True
    if not puesto:
        salida["verified"] = sello
    with open(map_path, "w") as fh:
        json.dump(salida, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def sello_desde_doc(nodo_dir):
    """Deriva el sello: primero la cabecera del doc.md; si no tiene fecha, el último commit del doc."""
    doc = os.path.join(nodo_dir, "doc.md")
    if os.path.exists(doc):
        with open(doc) as fh:
            cab = fh.read(600).replace("\n", " ")
        f, r = FECHA.search(cab), REF.search(cab)
        if f:
            return {"ref": r.group(1) if r else "main", "date": f.group(1), "source": "cabecera"}
    # sin fecha escrita: se estima con git y se DECLARA que es estimación
    r = subprocess.run(["git", "-C", TOOLS, "log", "-1", "--format=%cs", "--", doc],
                       capture_output=True, text=True)
    fecha = r.stdout.strip() or str(date.today())
    return {"ref": "main", "date": fecha, "source": "git-doc"}


def main():
    args = list(sys.argv[1:])
    todos = "--todos" in args
    if todos:
        args.remove("--todos")
    ref = "main"
    if "--ref" in args:
        i = args.index("--ref")
        ref = args[i + 1] if i + 1 < len(args) else "main"
        del args[i:i + 2]

    # sellado manual de UN nodo: "acabo de verificarlo hoy"
    if args:
        nodo = args[0]
        mp = os.path.join(FLOWS, nodo, "map.json")
        if not os.path.exists(mp):
            sys.exit(f"no existe el nodo `{nodo}` ({mp})")
        sello = {"ref": ref, "date": str(date.today()), "source": "manual"}
        escribir(mp, sello)
        print(f"✓ {nodo}: verificado contra `{ref}` el {sello['date']}")
        return 0

    puestos = {}
    for nodo in sorted(os.listdir(FLOWS)):
        nd = os.path.join(FLOWS, nodo)
        mp = os.path.join(nd, "map.json")
        if not os.path.isdir(nd) or not os.path.exists(mp):
            continue
        with open(mp) as fh:
            ya = json.load(fh).get("verified")
        if ya and not todos:
            continue
        sello = sello_desde_doc(nd)
        escribir(mp, sello)
        puestos[nodo] = sello
        print(f"  {nodo:22s} {sello['date']}  ref={sello['ref']:22s} ({sello['source']})")

    if not puestos:
        print("todos los nodos ya tienen sello (usá --todos para recalcular)")
        return 0
    estim = sum(1 for s in puestos.values() if s["source"] == "git-doc")
    print(f"\n✓ {len(puestos)} nodo(s) sellados · {len(puestos)-estim} de su cabecera · "
          f"{estim} ESTIMADOS con git (son un piso, no una verificación)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
