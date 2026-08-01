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
from refs import renombres, repo_de  # una sola implementación del seguimiento de renombres
from roots import EXTS, ROOTS

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


def rutas_de(files):
    """{alias: (raíz del repo, prefijo, [rutas desde la raíz])} — agrupa los files[] por repo."""
    por_repo = collections.defaultdict(list)
    for f in files:
        alias, _, ruta = f.partition("/")
        por_repo[alias].append(ruta)
    salida = {}
    for alias, rutas in por_repo.items():
        if not ROOTS.get(alias) or not os.path.isdir(ROOTS[alias]):
            continue
        root, pre = repo_de(alias)
        if root:
            salida[alias] = (root, pre, rutas)
    return salida


def pathspec(root, pre, rutas, base):
    """Las rutas de hoy MÁS las que tenían en el baseline, para que un renombre no simule un archivo
    nuevo entero.

    ⚠ Sin esto, `git diff base..main -- harness/pkg/db.ts` no encuentra el archivo en `base` (ahí se
    llamaba `frontend-e2e/pkg/db.ts`) y lo reporta como añadido completo: el nodo `harness` marcaba
    **44 de 44 (100%)** por un renombre que no cambió una línea de comportamiento. Con las dos rutas y
    `-M`, git muestra el cambio real.

    Todo en rutas DESDE LA RAÍZ DEL REPO y sin `--relative`: la ruta vieja puede caer fuera del
    subdirectorio del alias (`frontend-e2e/` está fuera de `harness/`), y con `--relative` git no la
    acepta. Una sola forma de nombrar un archivo, que es lo que ya arreglamos en `refs.py`.
    """
    ren = renombres(root, base)
    spec = []
    for r in rutas:
        full = pre + r
        spec.append(full)
        viejo = ren.get(full)
        if viejo and viejo != full:
            spec.append(viejo)
    return spec


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
    vistos, lista = set(), []
    for alias, (root, pre, rutas) in rutas_de(files).items():
        base = base_en(root, ref, desde)
        if not base:
            continue
        r = subprocess.run(
            ["git", "-C", root, "log", "--no-merges", "-M",
             "--pretty=format:%h\x1f%cs\x1f%an\x1f%s", f"{base}..{ref}",
             "--", *pathspec(root, pre, rutas, base)],
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


def huerfanos_desde(files, ref, desde, declarados):
    """Archivos NUEVOS en `main` que viven en directorios que el nodo YA declara y él no menciona.

    LA TERCERA FORMA DE QUEDAR VIEJO, y hasta hoy no la veía nadie. El oráculo caza los archivos que se
    BORRARON (ruta muerta) y `cambiados_desde` los que CAMBIARON; un archivo **nuevo** no dispara nada:
    el nodo queda 🟢 al día describiendo un directorio al que le agregaron piezas. Pasó el 2026-07-31 —
    se documentaron en prosa `EnsureLoanFlowStarted`, `LoanFlow`, `Flow.php` y 7 más, y ninguno entró a
    `files[]`.

    ⚠ El criterio es la PROXIMIDAD DE DIRECTORIO, no el nombre. Se probó cruzar por nombre de archivo
    contra el texto del doc y es inservible: `index.ts`, `routes.ts`, `server.ts` o
    `RouteServiceProvider.php` matchean cualquier doc que mencione esa palabra — daba 118 candidatos,
    casi todos falsos. Por directorio: 20, todos revisables. Lo que cae fuera de todo directorio
    declarado NO se reporta acá: eso no es un archivo faltante, es un nodo faltante.
    """
    dirs = {os.path.dirname(f) for f in files}
    fset = set(files)
    salida = []
    for alias, (root, pre, rutas) in rutas_de(files).items():
        base = base_en(root, ref, desde)
        if not base:
            continue
        r = subprocess.run(
            ["git", "-C", root, "diff", "--diff-filter=A", "--name-only", "-M", f"{base}..{ref}"],
            capture_output=True, text=True, errors="replace",
        )
        if r.returncode != 0:
            continue
        for ruta in r.stdout.splitlines():
            if not ruta.startswith(pre) or os.path.splitext(ruta)[1] not in EXTS:
                continue
            f = f"{alias}/{ruta[len(pre):]}"
            # `declarados` es la unión de TODOS los nodos, no solo este. Sin eso la señal sigue
            # avisando por un archivo que ya se ruteó a su nodo correcto: `AdoIdDocumentService`
            # vive en un directorio que tocan cuatro nodos, así que tres seguirían reclamándolo
            # para siempre. Un archivo tiene dueño, no cuatro.
            if f in fset or f in declarados or "/tests/" in f or ".spec." in f or ".test." in f:
                continue
            if os.path.dirname(f) in dirs:
                salida.append(f)
    return sorted(salida)


def cambiados_desde(files, ref, desde):
    """Archivos del nodo cuyo CONTENIDO es distinto hoy del que tenían cuando se selló el nodo.

    Se mide con el DIFF NETO (`git diff base..ref`), no con `git log`. Dos intentos con log fallaron,
    los dos en silencio, que es lo peligroso:
      · `--name-only` a secas NO imprime archivos para los commits de merge (default de git), y acá
        todo entra por PR: **38 archivos** sin contar, con `kyc` y `creditopx` figurando 🟢 al día
        teniendo deriva real.
      · `--first-parent --diff-merges=first-parent` sí los muestra, pero reporta el MOVIMIENTO a lo
        largo del camino: archivos que cambiaron en un merge y volvieron atrás en otro salían como
        deriva con `git diff base..main` vacío. Sobreconteo — 5 falsos solo en `kyc`.
    El diff neto contesta la pregunta exacta —«¿este archivo es distinto de cuando lo verifiqué?»— sin
    depender de por dónde pasó la historia.

    `--numstat -M -z` y no `--name-only`: con `-M` un renombre PURO sale `0  0  {viejo => nuevo}`, y
    ese caso NO es deriva —el contenido es idéntico, solo cambió la ruta—. Distinguirlo importa: el
    renombre `frontend-e2e/`→`harness/` marcaba el nodo entero en 44/44 (100%). El `-z` evita tener
    que parsear la notación con llaves.
    """
    tocados = {}
    for alias, (root, pre, rutas) in rutas_de(files).items():
        base = base_en(root, ref, desde)
        if not base:
            continue
        spec = pathspec(root, pre, rutas, base)
        r = subprocess.run(
            ["git", "-C", root, "diff", "--numstat", "-M", "-z", f"{base}..{ref}", "--", *spec],
            capture_output=True, text=True, errors="replace",
        )
        if r.returncode != 0:
            continue
        campos, i, distintos = r.stdout.split("\0"), 0, []
        while i < len(campos):
            if not campos[i]:
                i += 1
                continue
            try:
                mas, menos, resto = campos[i].split("\t", 2)
            except ValueError:
                i += 1
                continue
            if resto == "":                       # renombre: los dos siguientes son viejo y nuevo
                ruta, i = campos[i + 2] if i + 2 < len(campos) else "", i + 3
            else:
                ruta, i = resto, i + 1
            if mas == "0" and menos == "0":       # renombre puro: la ruta cambió, el contenido no
                continue
            if ruta.startswith(pre):
                rel = ruta[len(pre):]
                if f"{alias}/{rel}" in files:
                    distintos.append(rel)
        if not distintos:
            continue
        # CUÁNDO cambió cada uno: eso sí sale del log, en una sola pasada por repo (uno por archivo
        # serían ~170 procesos). El diff manda sobre QUIÉN está en la lista; el log solo pone fecha.
        r2 = subprocess.run(
            ["git", "-C", root, "log", "--name-only", "-M", "--first-parent",
             "--diff-merges=first-parent", "--pretty=format:%cs", f"{base}..{ref}",
             "--", *[pre + d for d in distintos]],
            capture_output=True, text=True,
        )
        fecha, fechas = "", {}
        for linea in r2.stdout.splitlines():
            if not linea.strip():
                continue
            if linea[:4].isdigit() and linea.count("-") == 2 and len(linea) == 10:
                fecha = linea
            elif linea.startswith(pre):
                fechas.setdefault(linea[len(pre):], fecha)  # la 1ª aparición es la más reciente
        for rel in distintos:
            tocados[f"{alias}/{rel}"] = fechas.get(rel, "?")
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
    # unión de lo que declara CUALQUIER nodo — para no reclamar como huérfano algo ya ruteado
    declarados = set()
    for _nid in sorted(os.listdir(FLOWS)):
        _mp = os.path.join(FLOWS, _nid, "map.json")
        if os.path.isfile(_mp):
            _d = json.load(open(_mp))
            declarados |= set(_d.get("files", []))
            # también lo marcado como pendiente de merge: está ruteado, solo que a una rama. Sin
            # esto, un nodo que describe una rama (`motai`) reclama para siempre sus propios
            # archivos de `qa`, que a `files[]` no pueden ir — contra `main` serían rutas muertas.
            declarados |= set((_d.get("pending_merge") or {}).get("files", []))
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
            "huerfanos": (huerfanos_desde(files, sello.get("ref", ref), sello["date"], declarados)
                          if sello.get("date") else []),
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
    # los huérfanos van APARTE del estado: un nodo puede estar 🟢 al día y tener piezas nuevas sin
    # declarar en sus propios directorios. No es deriva de lo que dice; es que dice de menos.
    conh = [n for n in nodos if n.get("huerfanos")]
    if conh:
        print(f"\n  ARCHIVOS NUEVOS sin declarar, en directorios que el nodo ya cubre "
              f"({sum(len(n['huerfanos']) for n in conh)}):")
        for n in conh:
            print(f"    {n['id']:22s} {len(n['huerfanos'])}  " +
                  ", ".join(os.path.basename(f) for f in n["huerfanos"][:3]) +
                  (" …" if len(n["huerfanos"]) > 3 else ""))
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
