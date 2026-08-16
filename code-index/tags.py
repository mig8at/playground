#!/usr/bin/env python3
"""El ÍNDICE DE TAGS: `{sha: [tags]}` — precalculado una vez, consultado por todos los filtros.

    {"a3f9c1": ["lender:160", "lender:smartpay", "rt:2", "tabla:user_requests", "gates"], …}

CÓMO SE USA: el nodolite lleva su ruta (`p`) Y el hash corto de su contenido (`h`). El hash NO
reemplaza a la ruta —la ruta es lo que dice de qué trata un archivo antes de abrirlo— sino que es la
LLAVE para machear contra esta tabla sin recalcular nada.

⚠ LA LLAVE ES EL SHA DEL CONTENIDO, NO EL DE LA RUTA. Es la decisión que hace que esto no se pudra:

  · con hash de ruta, si el archivo cambia los tags quedan viejos y NADA lo detecta — un caché que
    miente en silencio, el modo de falla que este proyecto persigue en todas sus piezas;
  · con hash de contenido, un archivo modificado tiene OTRA llave: el caché no puede devolver algo
    viejo, simplemente no matchea y se recalcula. Se autoinvalida.

Y sale gratis un beneficio: dos archivos idénticos comparten entrada. Entre `application` y
`legacy-backend` hay 321 copiados byte a byte (ver `cli.py gemelos`), así que se etiquetan una sola vez.

El sha lo calculó git al hacer commit: no hay que leer ni hashear nada.
"""
import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ.parent / "context" / "tools"))

import creditop as _cx  # noqa: E402
import extraer as _ex  # noqa: E402
from roots import ROOTS  # noqa: E402

CACHE = RAIZ / ".tags.json"
LARGO = 8  # 8 hex de un sha bastan: 4.300 millones de valores para ~30.000 archivos


def _tags_de(texto, ruta):
    """Los tags de un archivo. Planos y en minúscula, para que machear sea comparar strings."""
    cx = _cx.analizar(texto, ruta)
    t = set()
    for l in cx.get("lenders", []):
        t.add(f"lender:{l['id']}")
        t.add("lender:" + l["nombre"].split("(")[0].strip().lower().replace(" ", ""))
    for a in cx.get("allieds", []):
        t.add(f"allied:{a['id']}")
        t.add("allied:" + a["nombre"].split("/")[0].strip().lower().replace(" ", ""))
    for r in cx.get("rt", []):
        t.add(f"rt:{r['valor']}")
    for e in cx.get("estados", []):
        t.add(f"estado:{e['id']}")
    for tb in cx.get("tablas", []):
        t.add(f"tabla:{tb}")
    for m in cx.get("marcas", []):
        t.add(f"marca:{m}")
    if cx.get("gates"):
        t.add("gates")
    # Del propio extractor, que ya sabe qué clase de archivo es
    if "/routes/" in ruta or ruta.endswith(("api.php", "web.php", "routes.ts")):
        t.add("tipo:rutas")
    if "service" in ruta.lower():
        t.add("tipo:service")
    if "controller" in ruta.lower():
        t.add("tipo:controller")
    if _ex._es_infra(ruta):
        t.add("tipo:infra")
    return sorted(t)


def construir(aliases=None, verboso=True):
    """Recorre los repos y arma {sha: [tags]}. Reusa lo ya calculado: si un sha ya está, no se relee."""
    aliases = aliases or list(ROOTS)
    idx = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    antes, reusados = len(idx), 0

    for alias in aliases:
        shas = _ex._shas(alias, solo_codigo=True)
        faltan = {s: p for p, s in shas.items() if s[:LARGO] not in idx}
        if verboso:
            print(f"  {alias:26} {len(shas):>5} archivos · {len(faltan):>5} sin etiquetar")
        reusados += len(shas) - len(faltan)
        if not faltan:
            continue
        root = ROOTS[alias]
        p = subprocess.Popen(["git", "-C", root, "cat-file", "--batch"],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        orden = list(faltan)
        salida, _ = p.communicate(("\n".join(orden) + "\n").encode(), timeout=600)
        pos = 0
        for sha in orden:
            nl = salida.find(b"\n", pos)
            if nl == -1:
                break
            cab = salida[pos:nl].split()
            if len(cab) < 3:
                break
            largo = int(cab[2])
            texto = salida[nl + 1:nl + 1 + largo].decode("utf-8", "replace")
            pos = nl + 1 + largo + 1
            tags = _tags_de(texto, faltan[sha])
            if tags:  # sin tags no se guarda: el índice es de lo que SÍ toca algo del negocio
                idx[sha[:LARGO]] = tags

    CACHE.write_text(json.dumps(idx, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if verboso:
        print(f"\n  índice: {len(idx)} entradas ({len(idx) - antes} nuevas · {reusados} ya estaban) "
              f"· {CACHE.stat().st_size / 1024:.0f} KB en {CACHE.name}")
    return idx


def cargar():
    return json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}


def por_tag(tag, aliases=None):
    """Qué archivos tienen ese tag. Devuelve [(alias/ruta, tags)] — la consulta que el caché habilita."""
    idx = cargar()
    if not idx:
        return {"error": "no hay índice todavía: corré `cli.py tags --construir`"}
    fuera = []
    for alias in (aliases or list(ROOTS)):
        for ruta, sha in _ex._shas(alias, solo_codigo=True).items():
            tags = idx.get(sha[:LARGO])
            if tags and tag in tags:
                fuera.append({"ruta": f"{alias}/{ruta}", "tags": tags})
    return {"tag": tag, "cuantos": len(fuera), "archivos": sorted(fuera, key=lambda x: x["ruta"])}


def catalogo():
    """Todos los tags que existen, con cuántos archivos los tienen. Es el `--help` de los datos:
    sin esto no se sabe qué se puede pedir."""
    idx = cargar()
    cuenta = {}
    for tags in idx.values():
        for t in tags:
            cuenta[t] = cuenta.get(t, 0) + 1
    porFamilia = {}
    for t, n in sorted(cuenta.items(), key=lambda x: -x[1]):
        porFamilia.setdefault(t.split(":")[0], []).append((t, n))
    return porFamilia
