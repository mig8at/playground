"""El corpus COMPARTIDO (canon) para los cruces en Python: qué tema declara qué archivo y qué tabla.

Canon es el corpus del equipo, servido en canon.playground.creditop.com: cada tema tiene su prosa por
secciones y su mapa por áreas, cada área con sus `fuentes` ({repo: {ruta: hash}}) y sus `tablas`.

⚠ ESTO NO LEE CANON: se lo pide a `canon corpus` (`tablero/server/cmd/canon`, en Go), que es la única
lectura del corpus entero del playground, y sólo reparte lo que devuelve. Así la huella del trazador y el
tablero leen canon con el mismo cliente, el mismo origen y los mismos errores. El origen
es `CANON_URL`: por defecto producción, que pide la VPN; `CANON_URL=http://localhost:8080` apunta a un
canon local, que tiene su propia base.

⚠ **CANON PUEDE NO RESPONDER, Y ESO NO ES UN ERROR:** sin VPN, sin Go o con el servicio caído, las
funciones devuelven vacío, `available()` lo dice y se avisa UNA vez por stderr, para que quien llame
declare «no lo verifiqué» en vez de imprimir un cero que se lee como «nadie lo explica».
"""
import json
import os
import subprocess
import sys

URL = (os.environ.get("CANON_URL") or "https://canon.playground.creditop.com").rstrip("/")
BOARD_SERVER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tablero", "server")
TIMEOUT = float(os.environ.get("CANON_TIMEOUT", "180"))  # la primera vez compila el comando

# ⚠ EL MISMO REPO CON DOS NOMBRES. Canon llama `legacy-application` al monolito original; los alias de
# `tools/repos.py` —que salen de cómo está clonado acá— lo llaman `application`. Sin esta traducción
# NINGÚN archivo del monolito más grande cruza, y el resultado no es un error: es un «0 temas lo
# explican» sobre miles de archivos, o sea el falso negativo más caro posible. Los demás nombres que
# sólo están de un lado (`merchant-api`, `otp-service`, `harness`…) son repos distintos de verdad.
ALIAS = {"legacy-application": "application"}

_cache = None


def _topics():
    """{tema: {"areas": [...], "prose": str}}, pedido una vez por proceso. Vacío si no se pudo."""
    global _cache
    if _cache is not None:
        return _cache
    try:
        run = subprocess.run(["go", "run", "./cmd/canon", "corpus"], cwd=BOARD_SERVER, capture_output=True,
                             text=True, timeout=TIMEOUT, env={**os.environ, "CANON_URL": URL})
        if run.returncode != 0:
            # `go run` cierra con «exit status N», que tapa el error de verdad: se toma la línea anterior.
            lines = [l for l in run.stderr.splitlines() if l.strip() and not l.startswith("exit status")]
            raise RuntimeError(lines[-1].lstrip("✗ ") if lines else f"exit {run.returncode}")
        _cache = json.loads(run.stdout).get("topics") or {}
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as e:
        print(f"  ⚠ canon no respondió ({URL}): {e}", file=sys.stderr)
        _cache = {}
    return _cache


def maps():
    """{tema: {"areas": [...]}}. La clave es el tema sin su capa (`kyc/context` → `kyc`)."""
    return {topic: {"areas": t.get("areas") or []} for topic, t in _topics().items()}


def prose():
    """{tema: texto} — la prosa de cada tema, títulos y párrafos en orden."""
    return {topic: t.get("prose") or "" for topic, t in _topics().items()}


def available():
    return bool(_topics())


def files_by_topic(ms=None):
    """{"alias/relpath": [temas]} — qué temas declaran cada archivo, con el alias ya traducido.

    Un tema declara sus archivos en `areas[].fuentes[<repo>][<ruta>] = <hash del blob>`. Acá sólo
    interesa la RUTA: la pregunta es quién dice algo de ese archivo, no si el hash sigue al día (eso
    lo contesta `canon -ronda`).
    """
    out = {}
    for topic, m in (ms if ms is not None else maps()).items():
        for a in m.get("areas") or []:
            for repo, files in (a.get("fuentes") or {}).items():
                alias = ALIAS.get(repo, repo)
                for path in files:
                    key = f"{alias}/{path}"
                    if topic not in out.setdefault(key, []):
                        out[key].append(topic)
    return out


def topics_by_repo(ms=None):
    """{alias: [(tema, cuántos archivos de ese repo declara), …]}, del que más habla al que menos."""
    by_repo = {}
    for topic, m in (ms if ms is not None else maps()).items():
        count = {}
        for a in m.get("areas") or []:
            for repo, files in (a.get("fuentes") or {}).items():
                alias = ALIAS.get(repo, repo)
                count[alias] = count.get(alias, 0) + len(files)
        for alias, n in count.items():
            by_repo.setdefault(alias, []).append((topic, n))
    for alias in by_repo:
        by_repo[alias].sort(key=lambda pair: (-pair[1], pair[0]))
    return by_repo


def tables_by_topic(ms=None):
    """{tabla: [temas]} — lo que cada tema DECLARA en `areas[].tablas`.

    ⚠ No es todo: una tabla puede estar explicada en la prosa sin figurar en la lista. Quien necesite
    la respuesta completa tiene que mirar también `prose()` (lo hace la huella del trazador).
    """
    out = {}
    for topic, m in (ms if ms is not None else maps()).items():
        for a in m.get("areas") or []:
            for t in a.get("tablas") or []:
                if topic not in out.setdefault(t, []):
                    out[t].append(topic)
    return out
