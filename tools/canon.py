"""Leer el corpus COMPARTIDO (canon) desde el disco: qué tema habla de qué archivo y de qué tabla.

Canon vive en OTRO repo —`~/Desktop/CREDITOP/github/playground/tools/canon`, el playground compartido
del equipo— y se publica en canon.playground.creditop.com. Esto no lo consulta por red: lee sus
`content/<tema>/map.json`, que es la parte declarativa. Sirve para cruzar lo que una herramienta MIDE
contra lo que el corpus AFIRMA, sin depender de que haya un servidor arriba.

Lo usan `workers` (para decir qué tema describe cada archivo) y la huella del trazador (para decir qué
tabla toca un flujo que nadie explicó). Hasta el 2026-09-21 ese cruce se hacía contra el árbol local
`context/`, que se apagó.

⚠ **EL CORPUS PUEDE NO ESTAR, Y ESO NO ES UN ERROR:** es otro repo y no todo el mundo lo tiene
clonado. Las funciones devuelven vacío y `hay_corpus()` lo dice, para que quien llame pueda declarar
«no lo verifiqué» en vez de imprimir un cero que se lee como «nadie lo explica».
"""
import json
import os

CONTENIDO = os.environ.get("CANON_CONTENIDO") or os.path.expanduser(
    "~/Desktop/CREDITOP/github/playground/tools/canon/content")

# ⚠ EL MISMO REPO CON DOS NOMBRES. Canon llama `legacy-application` al monolito original; los alias de
# `tools/repos.py` —que salen de cómo está clonado acá— lo llaman `application`. Sin esta traducción
# NINGÚN archivo del monolito más grande cruza, y el resultado no es un error: es un «0 temas lo
# explican» sobre miles de archivos, o sea el falso negativo más caro posible. Los demás nombres que
# sólo están de un lado (`merchant-api`, `otp-service`, `harness`…) son repos distintos de verdad.
ALIAS = {"legacy-application": "application"}


def hay_corpus():
    return os.path.isdir(CONTENIDO)


def mapas():
    """{tema: map.json}. Vacío si el corpus no está clonado."""
    out = {}
    if not hay_corpus():
        return out
    for tema in sorted(os.listdir(CONTENIDO)):
        ruta = os.path.join(CONTENIDO, tema, "map.json")
        if not os.path.isfile(ruta):
            continue
        try:
            with open(ruta, encoding="utf-8") as fh:
                out[tema] = json.load(fh)
        except (OSError, ValueError):
            continue
    return out


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
    la respuesta completa tiene que mirar también el `context.md` (lo hace la huella del trazador).
    """
    fuera = {}
    for tema, m in (ms if ms is not None else mapas()).items():
        for a in m.get("areas") or []:
            for t in a.get("tablas") or []:
                if tema not in fuera.setdefault(t, []):
                    fuera[t].append(tema)
    return fuera
