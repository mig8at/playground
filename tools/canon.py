"""Leer el corpus COMPARTIDO (canon) por su API: qué tema habla de qué archivo y de qué tabla.

Canon es el corpus del equipo (`Creditop-SAS/playground`, `tools/canon`), servido en
canon.playground.creditop.com. Sus temas viven en la base de canon: la prosa por secciones y el mapa
por áreas, cada área con sus `fuentes` ({repo: {ruta: hash}}) y sus `tablas`. Esto lee ese mapa con
`/api/index` (qué temas hay) y `/api/read` (sus áreas), para cruzar lo que una herramienta MIDE contra
lo que el corpus AFIRMA.

El origen es `CANON_URL`, el mismo que usa el tablero: por defecto el de producción, que pide la VPN;
`CANON_URL=http://localhost:8080` apunta a un canon local, que tiene su propia base.

Lo usan `workers` (para decir qué tema describe cada archivo) y la huella del trazador (para decir qué
tabla toca un flujo que nadie explicó).

⚠ **CANON PUEDE NO RESPONDER, Y ESO NO ES UN ERROR:** sin VPN, o con el servicio caído, las funciones
devuelven vacío y `hay_corpus()` lo dice, para que quien llame pueda declarar «no lo verifiqué» en vez
de imprimir un cero que se lee como «nadie lo explica».
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

URL = (os.environ.get("CANON_URL") or "https://canon.playground.creditop.com").rstrip("/")
TIMEOUT = float(os.environ.get("CANON_TIMEOUT", "8"))
POR_PEDIDO = 20  # ids por `/api/read`: el corpus entero en pocas vueltas, sin pedidos gigantes

# ⚠ EL MISMO REPO CON DOS NOMBRES. Canon llama `legacy-application` al monolito original; los alias de
# `tools/repos.py` —que salen de cómo está clonado acá— lo llaman `application`. Sin esta traducción
# NINGÚN archivo del monolito más grande cruza, y el resultado no es un error: es un «0 temas lo
# explican» sobre miles de archivos, o sea el falso negativo más caro posible. Los demás nombres que
# sólo están de un lado (`merchant-api`, `otp-service`, `harness`…) son repos distintos de verdad.
ALIAS = {"legacy-application": "application"}


_cache = None


def _get(ruta):
    with urllib.request.urlopen(URL + ruta, timeout=TIMEOUT) as r:
        return json.load(r)


def mapas():
    """{tema: {"areas": [...]}}, leído una vez por proceso. Vacío si canon no respondió.

    La clave es el tema sin su capa (`kyc/context` → `kyc`), que es como lo nombran `canon:` en las
    tareas y las salidas de workers.
    """
    return {tema: {"areas": t["areas"]} for tema, t in _temas().items()}


def prosas():
    """{tema: texto} — la prosa de cada tema, secciones y bloques en orden. Vacío si canon no respondió."""
    return {tema: t["prosa"] for tema, t in _temas().items()}


def _temas():
    global _cache
    if _cache is not None:
        return _cache
    out = {}
    try:
        ids = [n["id"] for n in _get("/api/index").get("nodes") or [] if n.get("id")]
        for i in range(0, len(ids), POR_PEDIDO):
            tanda = ",".join(ids[i:i + POR_PEDIDO])
            leido = _get("/api/read?ids=" + urllib.parse.quote(tanda, safe=","))
            for n in leido.get("nodes") or []:
                textos = []
                for s in n.get("sections") or []:
                    textos.append(s.get("title") or "")
                    textos.extend(b.get("text") or "" for b in s.get("blocks") or [])
                out[n["id"].split("/")[0]] = {"areas": n.get("areas") or [], "prosa": "\n".join(textos)}
    except (urllib.error.URLError, OSError, ValueError, KeyError):
        out = {}
    _cache = out
    return out


def hay_corpus():
    return bool(_temas())


def archivos_por_tema(ms=None):
    """{"alias/relpath": [temas]} — qué temas declaran cada archivo, con el alias ya traducido.

    Un tema declara sus archivos en `areas[].fuentes[<repo>][<ruta>] = <hash del blob>`. Acá sólo
    interesa la RUTA: la pregunta es quién dice algo de ese archivo, no si el hash sigue al día (eso
    lo contesta `canon -ronda`).
    """
    fuera = {}
    for tema, m in (ms if ms is not None else mapas()).items():
        for a in m.get("areas") or []:
            for repo, archivos in (a.get("fuentes") or {}).items():
                alias = ALIAS.get(repo, repo)
                for ruta in archivos:
                    clave = f"{alias}/{ruta}"
                    if tema not in fuera.setdefault(clave, []):
                        fuera[clave].append(tema)
    return fuera


def temas_por_repo(ms=None):
    """{alias: [(tema, cuántos archivos de ese repo declara), …]}, del que más habla al que menos."""
    por_repo = {}
    for tema, m in (ms if ms is not None else mapas()).items():
        cuenta = {}
        for a in m.get("areas") or []:
            for repo, archivos in (a.get("fuentes") or {}).items():
                alias = ALIAS.get(repo, repo)
                cuenta[alias] = cuenta.get(alias, 0) + len(archivos)
        for alias, n in cuenta.items():
            por_repo.setdefault(alias, []).append((tema, n))
    for alias in por_repo:
        por_repo[alias].sort(key=lambda par: (-par[1], par[0]))
    return por_repo


def tablas_por_tema(ms=None):
    """{tabla: [temas]} — lo que cada tema DECLARA en `areas[].tablas`.

    ⚠ No es todo: una tabla puede estar explicada en la prosa sin figurar en la lista. Quien necesite
    la respuesta completa tiene que mirar también la prosa del tema (lo hace la huella del trazador).
    """
    fuera = {}
    for tema, m in (ms if ms is not None else mapas()).items():
        for a in m.get("areas") or []:
            for t in a.get("tablas") or []:
                if tema not in fuera.setdefault(t, []):
                    fuera[t].append(tema)
    return fuera
