"""Agente `contexto` — el que RUTEA SOLO: lee la documentación, elige qué archivos necesita, y recién
después contesta.

La diferencia con `frontend.py` es el tipo de trabajo, no el tema. Aquel tenía cuatro herramientas y una
pregunta fija. Éste tiene un MÉTODO: mapa → nodos → decidir qué archivos hacen falta → leerlos →
analizar → contestar. Lo interesante es que el ruteo queda **a la vista**: en la traza se ve qué nodos
abrió y qué archivos eligió, así que se puede juzgar si el árbol lo llevó bien o si le faltó una seña.

    python3 contexto.py                    # la pregunta de ejemplo
    python3 contexto.py "tu pregunta"

⚠ Sólo lectura, y contra `main` — no contra lo que tengas checkeado. Los repos reales trabajan en ramas
y stashes locales, así que leer el working tree daría una respuesta sobre código que no está corriendo.
"""
import json
import subprocess
import sys
from pathlib import Path

import gemini

PLAYGROUND = Path(__file__).resolve().parents[1]
CONTEXT = PLAYGROUND / "context"
FLOWS = CONTEXT / "server" / "data" / "flows"

# La tabla alias→repo NO se copia acá: se importa de su fuente única. El propio `roots.py` explica por
# qué —tenerla dos veces es una divergencia que no falla, sólo da veredictos equivocados.
CODE_INDEX = PLAYGROUND / "code-index"

sys.path.insert(0, str(CONTEXT / "tools"))
sys.path.insert(0, str(CODE_INDEX))
from roots import ROOTS  # noqa: E402
import indice as _code_index  # noqa: E402  — el índice por repo es su propio proyecto, se importa

MAX_LINEAS = 260  # tope por lectura: un archivo de 3.000 líneas no entra ni sirve entero

PREGUNTA = (
    "A un cliente no le apareció una entidad en el listado y el comercio reclama. "
    "¿Dónde se decide eso exactamente, y qué evidencia concreta puedo mirar para darle un motivo?"
)

INSTRUCCIONES = """\
Contestás preguntas sobre CreditOp (fintech colombiana de originación de crédito) leyendo primero su
árbol de contexto y después el código real. Tu valor no es saber: es RUTEAR BIEN y verificar.

EL MÉTODO, en este orden y sin saltearte pasos:

1. Elegí el índice según QUÉ TE PREGUNTAN, y empezá por ahí:
   - pregunta de NEGOCIO («¿por qué no le salió esta entidad?», «¿dónde se decide X?») →
     `mapa_de_rutas()`, que tiene la tabla «Entrá por el síntoma» y los «Cuándo:» de cada nodo.
     Elegí 2 a 4 nodos que matcheen y decí por qué esos.
   - pregunta de ARQUITECTURA («¿cómo está armado el monorepo?», «¿dónde arranca este servicio?»,
     «¿por qué el código no está donde lo busco?») → `indice_de_repos()`, que te da por repo el
     stack, cuándo nació, cómo se ensambla y los pocos archivos que lo explican.
   Si la pregunta tiene las dos mitades, usá los dos — primero el de repos para ubicarte.
2. `abrir_nodo(id)` en los que elegiste. Te devuelve el análisis (doc.md) y la LISTA DE ARCHIVOS del
   nodo. Leé el doc con atención: muchas veces ya trae la respuesta y las trampas conocidas.
3. DECIDÍ QUÉ ARCHIVOS NECESITÁS, y justificá cada uno en una frase antes de abrirlo. No los abras
   todos: un nodo puede listar 30 y la respuesta estar en 2. Elegir bien ES el trabajo.
4. `leer_codigo(ruta, desde, hasta)` sobre esos. Leé rangos, no archivos enteros. Si no sabés en qué
   línea está, usá `buscar_en_codigo` para ubicarlo y después leé alrededor.
5. ANALIZÁ ANTES DE CONTESTAR. Antes de escribir la respuesta, revisá: ¿lo que leí sostiene lo que voy
   a afirmar, o lo estoy infiriendo? ¿El doc y el código dicen lo mismo? Si difieren, ESO es lo más
   importante de tu respuesta.

REGLAS:
- El doc del nodo es una afirmación, no una prueba. Si podés verificarla en el código, verificala.
- Si el mapa no te ruteó y tuviste que buscar a ciegas, DECILO: significa que a un nodo le falta una
  seña, y eso vale tanto como la respuesta.
- Nunca inventes rutas ni líneas. Si no lo abriste, no lo cites.
- Distinguí lo que VERIFICASTE de lo que INFERISTE. Un «no lo comprobé» honesto vale más que una
  certeza inventada.

CÓMO CONTESTÁS:
1. La respuesta, en dos o tres frases.
2. La evidencia, con citas `archivo:línea` y de qué repo es cada una.
3. «Cómo ruteé»: qué nodos abriste y por qué, qué archivos elegiste y por qué, cuáles descartaste, y
   qué le faltó al mapa si le faltó algo.
Nunca pegues bloques largos de código: citá la línea y explicá qué hace.
"""


# ── herramientas ─────────────────────────────────────────────────────────────────────────────────
def _resolver(ruta):
    """`alias/relpath` → (root, relpath). Es también el sandbox: fuera de ROOTS no se lee nada."""
    if "/" not in ruta:
        raise ValueError(f"ruta sin alias: '{ruta}'. Va como 'alias/camino', p. ej. 'legacy-backend/app/…'")
    alias, rel = ruta.split("/", 1)
    if alias not in ROOTS:
        raise ValueError(f"alias desconocido '{alias}'. Los válidos son: {', '.join(sorted(ROOTS))}")
    return ROOTS[alias], rel


def mapa_de_rutas():
    """El índice del árbol de contexto: la tabla de síntomas y el «Cuándo:» de cada nodo. Empezá acá."""
    return (CONTEXT / "docs" / "ROUTE-MAP.md").read_text(encoding="utf-8")


def _subramas(alias):
    """Las unidades internas de un repo. Se delega a `code-index/indice.py`, que es su implementación
    única: duplicar acá el descubrimiento sería la divergencia que `roots.py` advierte."""
    return _code_index.subramas(alias)


def indice_de_repos():
    """El OTRO índice: por repo en vez de por pregunta. Qué es cada repositorio, con qué está hecho,
    cuándo nació y los pocos archivos que explican cómo se ensambla. Usalo cuando la pregunta sea de
    ARQUITECTURA («¿cómo está armado el monorepo?», «¿dónde arranca este servicio?») y no de negocio."""
    return json.loads((CODE_INDEX / "repos.json").read_text(encoding="utf-8"))


def abrir_nodo(id):
    """El análisis de un nodo (doc.md) más la lista de archivos fuente que cita (map.json)."""
    d = FLOWS / id
    if not d.is_dir():
        disponibles = sorted(p.name for p in FLOWS.iterdir() if p.is_dir())
        return {"error": f"no existe el nodo '{id}'", "nodos": disponibles}
    m = json.loads((d / "map.json").read_text(encoding="utf-8"))
    return {
        "nodo": id,
        "cuando": m.get("when", ""),
        "sintomas": m.get("sintomas", []),
        "verificado": m.get("verified", {}),
        "archivos": m.get("files", []),
        "doc": (d / "doc.md").read_text(encoding="utf-8"),
    }


def leer_codigo(ruta, desde=1, hasta=0):
    """Un tramo de un archivo fuente, leído de `main` (no del working tree). `ruta` es 'alias/camino'.
    Devuelve las líneas numeradas, para poder citarlas."""
    root, rel = _resolver(ruta)
    r = subprocess.run(["git", "-C", root, "show", f"main:./{rel}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        return {"error": f"no está en main: {ruta}", "detalle": (r.stderr or "").strip()[:200]}
    lineas = r.stdout.splitlines()
    total = len(lineas)
    desde = max(1, int(desde))
    hasta = total if not hasta else min(int(hasta), total)
    if hasta - desde + 1 > MAX_LINEAS:
        hasta = desde + MAX_LINEAS - 1
    tramo = "\n".join(f"{i}: {lineas[i - 1]}" for i in range(desde, hasta + 1))
    return {"ruta": ruta, "lineas_totales": total, "mostrando": f"{desde}-{hasta}", "codigo": tramo}


def buscar_en_codigo(patron, alias, subruta=""):
    """Dónde aparece un texto dentro de un repo, en `main`. Para ubicar la línea antes de leerla.
    Usalo sólo si el nodo no te llevó directo — y después contá que lo usaste."""
    if alias not in ROOTS:
        return {"error": f"alias desconocido '{alias}'", "validos": sorted(ROOTS)}
    cmd = ["git", "-C", ROOTS[alias], "grep", "-n", "--no-color", "-F", patron, "main"]
    if subruta:
        cmd += ["--", subruta]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if r.returncode not in (0, 1):
        return {"error": (r.stderr or "").strip()[:200]}
    hits = [l.replace("main:", "", 1) for l in r.stdout.splitlines()[:40]]
    return {"patron": patron, "alias": alias, "coincidencias": len(hits), "donde": hits}


HERRAMIENTAS = {
    "mapa_de_rutas": ({
        "name": "mapa_de_rutas",
        "description": "El índice del árbol de contexto: tabla «entrá por el síntoma» y el «Cuándo:» de cada nodo. Empezá SIEMPRE por acá.",
        "parameters": {"type": "object", "properties": {}},
    }, mapa_de_rutas),

    "indice_de_repos": ({
        "name": "indice_de_repos",
        "description": (
            "Índice POR REPO: qué es cada repositorio, con qué stack, cuándo nació y los pocos "
            "archivos que explican cómo se ensambla. Para preguntas de ARQUITECTURA («¿cómo está "
            "armado el monorepo?», «¿por dónde arranca este servicio?»). El mapa_de_rutas es para "
            "preguntas de NEGOCIO; éste, para entender los proyectos."
        ),
        "parameters": {"type": "object", "properties": {}},
    }, indice_de_repos),

    "subramas_del_repo": ({
        "name": "subramas_del_repo",
        "description": (
            "Las unidades con ensamblado propio DENTRO de un repo: los workspaces del monorepo "
            "(apps, packages, modules) o los módulos del backend, con su nombre, sus docs y sus "
            "rutas. Se descubren de main en el momento, no están escritas a mano. Usalo después de "
            "`indice_de_repos` cuando necesites bajar un nivel: «¿qué apps hay?», «¿en qué módulo "
            "vive esto?»."
        ),
        "parameters": {"type": "object", "properties": {
            "alias": {"type": "string", "description": "repo, p. ej. 'frontend-monorepo' o 'legacy-backend'"},
        }, "required": ["alias"]},
    }, lambda alias: _subramas(alias)),

    "abrir_nodo": ({
        "name": "abrir_nodo",
        "description": "El análisis de un nodo (doc.md) y la lista de archivos fuente que cita. Devuelve además su «cuándo», sus síntomas y cuándo se verificó.",
        "parameters": {"type": "object", "properties": {
            "id": {"type": "string", "description": "id del nodo, p. ej. 'profiling' o 'kyc'"},
        }, "required": ["id"]},
    }, abrir_nodo),

    "leer_codigo": ({
        "name": "leer_codigo",
        "description": f"Un tramo de un archivo fuente leído de main, con las líneas numeradas. Máximo {MAX_LINEAS} líneas por llamada: leé rangos, no archivos enteros.",
        "parameters": {"type": "object", "properties": {
            "ruta": {"type": "string", "description": "'alias/camino' tal cual figura en el map.json del nodo"},
            "desde": {"type": "integer", "description": "primera línea, por defecto 1"},
            "hasta": {"type": "integer", "description": "última línea, 0 = hasta donde entre"},
        }, "required": ["ruta"]},
    }, leer_codigo),

    "buscar_en_codigo": ({
        "name": "buscar_en_codigo",
        "description": "Dónde aparece un texto exacto dentro de un repo, en main. Para ubicar una línea antes de leerla, o cuando el nodo no te llevó directo.",
        "parameters": {"type": "object", "properties": {
            "patron": {"type": "string", "description": "texto exacto a buscar"},
            "alias": {"type": "string", "description": "repo donde buscar, p. ej. 'legacy-backend'"},
            "subruta": {"type": "string", "description": "acotar a una carpeta, opcional"},
        }, "required": ["patron", "alias"]},
    }, buscar_en_codigo),
}


def main():
    args = sys.argv[1:]
    try:
        cfg = gemini.config()
        if args and args[0] == "--modelos":
            for nombre, titulo in gemini.modelos(cfg["key"]):
                print(f" {'→' if nombre == cfg['modelo'] else ' '} {nombre:42} {titulo}")
            return 0
        pregunta = args[0] if args else PREGUNTA
        print(f"\n¿? {pregunta}\n\nmodelo: {cfg['modelo']}  ·  herramientas: {len(HERRAMIENTAS)}  ·  "
              f"repos: {len(ROOTS)}\n")
        print(gemini.correr(pregunta, HERRAMIENTAS, INSTRUCCIONES, cfg))
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
