#!/usr/bin/env python3
"""¿Qué nodos del árbol quedaron VIEJOS? Calcula y escribe `alineacion.json`.

POR QUÉ UN COMANDO Y NO UN SERVER. El dato que hace falta —qué cambió en `main` desde que se verificó
cada nodo— sale de git, y el browser no puede correr git. Levantar un server para eso es reconstruir
justo lo que se borró a propósito (ver «El MCP está retirado»). Entonces: este comando **calcula en
consola y deja un JSON**, y la viz read-only que ya existe lo lee con el mismo `import.meta.glob` que
usa para `tree.json`. Sin backend, sin WS, sin nada corriendo.

TRES SEÑALES, y la tercera es la que hoy no tiene dueño:

  1. RUTAS MUERTAS — `files[]` que no existen en `main`. Es lo que ya hace el oráculo, acá agregado por
     nodo. Si aparece, el mapa está mintiendo.
  2. DERIVA DE CONTENIDO — archivos del nodo que SÍ existen pero fueron tocados en `main` después de la
     fecha del sello `verified`. El oráculo no puede verlo: un nodo con todas las rutas resolviendo
     puede describir código que cambió por debajo.
  3. MARCAS YA MERGEADAS — nodos con `pending_merge` cuyos archivos **ya están en `main`**. Esa es la
     regla «revisá las marcas después de cada merge» que hoy depende de que alguien se acuerde. Cuando
     esto aparece, hay que devolver las rutas a `files[]`, re-verificar y BORRAR la marca.

USO
    python3 tools/alinear.py              → calcula y escribe alineacion.json
    python3 tools/alinear.py --ver         → solo imprime, no escribe
    python3 tools/alinear.py --ref develop → compara contra otro ref

EXIT
  0 → nada urgente · 1 → hay rutas muertas o marcas ya mergeadas (pedir acción)
"""
import collections
import json
import os
import subprocess
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle import del_ref  # una sola definición de "qué archivos existen en un ref"
from roots import ROOTS

TOOLS = os.path.dirname(os.path.abspath(__file__))
CTX = os.path.dirname(TOOLS)
FLOWS = os.path.join(CTX, "server", "data", "flows")
SALIDA = os.path.join(CTX, "alineacion.json")
DERIVA_ALTA = 25  # % de archivos tocados desde el sello a partir del cual el nodo se marca en rojo


def cambiados_desde(files, ref, desde):
    """Archivos del nodo tocados en `ref` después de `desde`. Un `git log` por repo, no por archivo:
    con ~100 rutas por nodo, uno por archivo serían 100 procesos y esto tarda ~1 s en total."""
    por_repo = collections.defaultdict(list)
    for f in files:
        alias, _, ruta = f.partition("/")
        por_repo[alias].append(ruta)

    tocados = {}
    for alias, rutas in por_repo.items():
        root = ROOTS.get(alias)
        if not root or not os.path.isdir(root):
            continue
        # ⚠ `--relative` NO es opcional acá. `git ls-tree` (el que usa el oráculo) devuelve rutas
        # relativas al DIRECTORIO consultado, pero `git log --name-only` las devuelve relativas a la
        # RAÍZ DEL REPO. Para `frontend-e2e`, que es un subdirectorio de playground y no un repo
        # propio, eso hacía construir `frontend-e2e/frontend-e2e/pkg/…` → no matcheaba nunca y el nodo
        # `findings` reportaba 1 archivo tocado cuando eran 16. Un undercount no avisa: se lee como
        # «este nodo está al día».
        r = subprocess.run(
            ["git", "-C", root, "log", "--since", desde, "--name-only", "--relative",
             "--pretty=format:%cs", ref, "--", *rutas],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            continue
        # el log sale como: fecha, luego las rutas de ese commit, luego línea vacía
        fecha = ""
        for linea in r.stdout.splitlines():
            if not linea.strip():
                continue
            if linea[:4].isdigit() and linea.count("-") == 2 and len(linea) == 10:
                fecha = linea
            elif f"{alias}/{linea}" in files:
                tocados.setdefault(f"{alias}/{linea}", fecha)  # la 1ª es la más reciente
    return tocados


def main():
    args = list(sys.argv[1:])
    solo_ver = "--ver" in args
    if solo_ver:
        args.remove("--ver")
    ref = "main"
    if "--ref" in args:
        i = args.index("--ref")
        ref = args[i + 1] if i + 1 < len(args) else "main"

    existen, sin_verificar, _ = del_ref(ref)
    ciegos = {a for a, _ in sin_verificar}
    nodos, resumen = [], collections.Counter()

    for nid in sorted(os.listdir(FLOWS)):
        mp = os.path.join(FLOWS, nid, "map.json")
        if not os.path.isfile(mp):
            continue
        d = json.load(open(mp))
        files = d.get("files", [])
        sello = d.get("verified") or {}
        pm = d.get("pending_merge") or {}

        muertas = [f for f in files
                   if f.split("/", 1)[0] not in ciegos and f not in existen]
        deriva = cambiados_desde(files, sello.get("ref", ref), sello["date"]) if sello.get("date") else {}
        # señal 3: lo marcado como pendiente, ¿ya está en main?
        ya_mergeadas = [f for f in pm.get("files", []) if f in existen]

        pct = round(100 * len(deriva) / len(files)) if files else 0
        if muertas:
            estado = "rutas-muertas"
        elif ya_mergeadas:
            estado = "marca-ya-mergeada"
        elif pm or sello.get("ref", "main") != "main":
            estado = "rama-sin-mergear"
        elif pct >= DERIVA_ALTA:
            estado = "deriva-alta"
        elif deriva:
            estado = "deriva"
        else:
            estado = "al-dia"
        resumen[estado] += 1

        nodos.append({
            "id": nid,
            "estado": estado,
            "verificado": sello,
            "archivos": len(files),
            "deriva": {"cambiados": len(deriva), "pct": pct,
                       "archivos": [{"ruta": k, "ultimo_cambio": v} for k, v in
                                    sorted(deriva.items(), key=lambda x: x[1], reverse=True)]},
            "rutas_muertas": muertas,
            "pendiente_merge": ({"ref": pm.get("ref"), "archivos": len(pm.get("files", [])),
                                 "ya_en_main": ya_mergeadas} if pm else None),
        })

    orden = ["rutas-muertas", "marca-ya-mergeada", "deriva-alta", "rama-sin-mergear", "deriva", "al-dia"]
    nodos.sort(key=lambda n: (orden.index(n["estado"]), -n["deriva"]["pct"]))
    doc = {
        "generado": str(date.today()),
        "ref": ref,
        "resumen": dict(resumen),
        "nodos": nodos,
    }

    # ── informe legible ──
    print(f"ALINEACIÓN DEL CONTEXTO contra `{ref}` · {doc['generado']}\n")
    ETIQ = {"rutas-muertas": "⛔ RUTAS MUERTAS", "marca-ya-mergeada": "🔁 MARCA YA MERGEADA",
            "deriva-alta": "🔴 deriva alta", "rama-sin-mergear": "⏳ rama sin mergear",
            "deriva": "🟡 deriva", "al-dia": "🟢 al día"}
    for n in nodos:
        if n["estado"] == "al-dia":
            continue
        d = n["deriva"]
        extra = ""
        if n["rutas_muertas"]:
            extra = f" · {len(n['rutas_muertas'])} ruta(s) que no existen en {ref}"
        elif n["pendiente_merge"] and n["pendiente_merge"]["ya_en_main"]:
            extra = f" · {len(n['pendiente_merge']['ya_en_main'])} de sus pendientes YA están en {ref}"
        print(f"  {ETIQ[n['estado']]:22s} {n['id']:22s} {d['cambiados']:3d}/{n['archivos']:<3d} "
              f"({d['pct']:2d}%) desde {n['verificado'].get('date','?')}{extra}")
    print(f"\n  {resumen.get('al-dia', 0)} nodo(s) al día · " +
          " · ".join(f"{v} {k}" for k, v in resumen.items() if k != "al-dia"))

    if sin_verificar:
        print("\n⚠ roots que no se pudieron consultar (sus rutas no se contaron):")
        for alias, motivo in sin_verificar:
            print(f"  · {alias}: {motivo}")

    if not solo_ver:
        with open(SALIDA, "w") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(f"\n→ {os.path.relpath(SALIDA, CTX)} escrito ({len(nodos)} nodos)")

    urgente = resumen.get("rutas-muertas", 0) + resumen.get("marca-ya-mergeada", 0)
    return 1 if urgente else 0


if __name__ == "__main__":
    sys.exit(main())
