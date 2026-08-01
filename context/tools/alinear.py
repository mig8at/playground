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


TOPE_COMMITS = 15  # cuántos se guardan en el JSON; el total siempre se reporta entero


def base_en(root, ref, fecha):
    """El commit de `ref` al cierre del día del sello: el «antes» contra el que se compara.

    ⚠ Se usa un RANGO de commits (`base..ref`) y no `--since <fecha>`. `--since` filtra por fecha del
    commit, y un merge del 23 puede traer commits escritos el 10: quedaban fuera del filtro aunque el
    cambio SÍ entró a main después del sello. Así aparecían nodos con deriva y «0 commits» —
    `kyc` y `creditopx` el 2026-07-31.
    """
    r = subprocess.run(["git", "-C", root, "rev-list", "-1", f"--before={fecha} 23:59:59", ref],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def commits_desde(files, ref, desde):
    """Los commits que tocaron archivos del nodo desde el sello: quién y qué dijo que hizo.

    POR QUÉ, si ya está la lista de archivos: «14 de 101 archivos cambiaron» no dice si conviene
    leerlos hoy ni a quién preguntarle. El asunto del commit sí *tría*: al revisar `ecommerce` alcanzó
    con leer «feat/customer-revolving-credit-detail» para saber que ese cambio era de CreditopX y no
    tocaba lo que el nodo afirma — sin abrir una línea de código.

    ⚠ Y ahí termina su valor: el asunto dice la INTENCIÓN, no lo que pasó. Para concluir que un nodo
    sigue siendo cierto hay que leer el diff (`make context-diff NODE=x`). Esto ordena la cola; no la
    resuelve.

    `--no-merges` a propósito: con merges, `onboarding` mostraba 16 commits y la mitad eran «Staging
    (#749)» — ruido con autor equivocado (el que mergeó, no el que escribió). Sin ellos: 8 commits
    reales, mismos 4 autores, asuntos que se pueden leer.
    """
    por_repo = collections.defaultdict(list)
    for f in files:
        alias, _, ruta = f.partition("/")
        por_repo[alias].append(ruta)

    vistos, lista = set(), []
    for alias, rutas in por_repo.items():
        root = ROOTS.get(alias)
        if not root or not os.path.isdir(root):
            continue
        base = base_en(root, ref, desde)
        if not base:
            continue
        r = subprocess.run(
            ["git", "-C", root, "log", "--no-merges", "--relative",
             "--pretty=format:%h\x1f%cs\x1f%an\x1f%s", f"{base}..{ref}", "--", *rutas],
            capture_output=True, text=True, errors="replace",
        )
        if r.returncode != 0:
            continue
        for linea in r.stdout.splitlines():
            p = linea.split("\x1f")
            if len(p) == 4 and p[0] not in vistos:
                vistos.add(p[0])
                lista.append({"sha": p[0], "fecha": p[1], "autor": p[2], "asunto": p[3], "repo": alias})
    lista.sort(key=lambda c: c["fecha"], reverse=True)
    autores = collections.Counter(c["autor"] for c in lista)
    return {"total": len(lista), "autores": dict(autores.most_common()),
            "lista": lista[:TOPE_COMMITS]}


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
        base = base_en(root, ref, desde)
        if not base:
            continue
        # QUÉ archivos: el DIFF NETO `base..ref`, no un `git log`. Dos intentos con log fallaron y
        # los dos en silencio, que es lo peligroso:
        #   · `--name-only` a secas NO imprime archivos para los commits de merge (default de git), y
        #     acá todo entra por PR: 38 archivos quedaban sin contar y dos nodos figuraban 🟢 al día
        #     teniendo deriva real (`kyc`, `creditopx`).
        #   · `--first-parent --diff-merges=first-parent` los muestra, pero reporta el MOVIMIENTO a lo
        #     largo del camino: archivos que cambiaron en un merge y volvieron atrás en otro salían
        #     como deriva con `git diff base..main` vacío. Sobreconteo — 5 falsos en `kyc` solo.
        # El diff neto contesta la pregunta exacta —«¿este archivo es distinto de cuando lo verifiqué?»—
        # sin depender de por dónde pasó la historia. `--relative` porque el alias `harness` es un
        # SUBDIRECTORIO de playground: sin eso git devuelve rutas desde la raíz del repo y no matchean.
        r = subprocess.run(
            ["git", "-C", root, "diff", "--name-only", "--relative", f"{base}..{ref}", "--", *rutas],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            continue
        distintos = [ln for ln in r.stdout.splitlines() if f"{alias}/{ln}" in files]
        if not distintos:
            continue
        # CUÁNDO cambió cada uno: eso sí sale del log, en una sola pasada por repo (uno por archivo
        # serían ~170 procesos). El diff manda sobre quién está en la lista; el log solo pone fecha.
        r2 = subprocess.run(
            ["git", "-C", root, "log", "--name-only", "--relative",
             "--first-parent", "--diff-merges=first-parent",
             "--pretty=format:%cs", f"{base}..{ref}", "--", *distintos],
            capture_output=True, text=True,
        )
        fecha, fechas = "", {}
        for linea in r2.stdout.splitlines():
            if not linea.strip():
                continue
            if linea[:4].isdigit() and linea.count("-") == 2 and len(linea) == 10:
                fecha = linea
            else:
                fechas.setdefault(linea, fecha)  # la 1ª aparición es la más reciente
        for ruta in distintos:
            tocados[f"{alias}/{ruta}"] = fechas.get(ruta, "?")
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
            "commits": (commits_desde(files, sello.get("ref", ref), sello["date"])
                        if deriva and sello.get("date") else None),
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
        # los commits atrasados y QUIÉN los hizo: es lo que decide a quién preguntarle antes de leer
        c = n.get("commits") or {}
        atras = ""
        if c.get("total"):
            quien = ", ".join(list(c["autores"])[:3])
            if len(c["autores"]) > 3:
                quien += f" +{len(c['autores']) - 3}"
            atras = f"  ·  {c['total']:2d} commits · {quien}"
        print(f"  {ETIQ[n['estado']]:22s} {n['id']:22s} {d['cambiados']:3d}/{n['archivos']:<3d} "
              f"({d['pct']:2d}%) desde {n['verificado'].get('date','?')}{extra}{atras}")
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
