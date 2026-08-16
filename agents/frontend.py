"""Agente `frontend` — contesta UNA pregunta: ¿el frontend está sano hoy, y si no, qué lo rompió?

Por qué esa y no «cómo está el frontend»: una tarea vaga da una respuesta vaga. Esta apunta a un modo
de falla REAL y repetido de `frontend-monorepo` — los merges de `fixes-to-production` → `develop`
rompen el empaquetado (pasó con `form-engine` y con `@creditop/dynamic-form`) — así que tiene una
respuesta de sí/no y un culpable posible.

Las herramientas son CUATRO y ninguna más: el agente no tiene shell. Tres son de solo lectura; la única
que escribe algo (artefactos de build) lo dice en su nombre y hay que pedirla.

    python3 frontend.py                 # la pregunta por defecto
    python3 frontend.py "otra pregunta" # lo que quieras, con las mismas 4 herramientas
    python3 frontend.py --modelos       # qué modelos habilita tu key hoy
"""
import subprocess
import sys
from pathlib import Path

import gemini

REPO = Path.home() / "Desktop" / "CREDITOP" / "github" / "frontend-monorepo"

PREGUNTA = (
    "¿El frontend está sano hoy, y si no, qué lo rompió? "
    "Mirá qué se movió últimamente en develop, si se tocaron dependencias, y decidí si hace falta compilar."
)

INSTRUCCIONES = f"""\
Sos un agente que reporta el estado del monorepo de frontend de CreditOp, en {REPO}.
Es un monorepo pnpm + turbo con 4 apps (backoffice, landing, loan-request-wizard, storybook),
2 grupos de modules y 6 packages compartidos.

CONTEXTO QUE CAMBIA TU DIAGNÓSTICO — el modo de falla conocido y repetido de este repo:
los merges de `fixes-to-production` hacia `develop` han roto el EMPAQUETADO más de una vez
(pasó con `form-engine` y con `@creditop/dynamic-form`, esta última con claves duplicadas en un
package.json). Por eso, ante cualquier cambio en `package.json` o `pnpm-lock.yaml`, sospechá primero
de eso. Un commit que sólo toca `.tsx` es mucho menos riesgoso que uno que toca un `package.json`.

CÓMO TRABAJÁS:
- Empezá barato. `commits_recientes` y `cambios_de_dependencias` son rápidas; `compilar` tarda MINUTOS.
  Compilá sólo si lo que viste da motivo para sospechar, y decí por qué decidiste compilar o no.
- No inventes: si una herramienta no te dio el dato, decí que no lo tenés.
- Una ausencia no es una prueba. Que no haya cambios de dependencias no garantiza que compile.

CÓMO CONTESTÁS — corto y en este orden:
1. Un veredicto de una línea: SANO / SOSPECHOSO / ROTO, y por qué.
2. Qué se movió: los commits que importan, con autor. No los listes todos, agrupá.
3. El riesgo de empaquetado: si se tocaron dependencias, cuáles y en qué paquete.
4. Qué haría yo ahora: una recomendación concreta, o «nada, está bien».
Nunca pegues volcados largos de git ni de build. Resumí y citá lo mínimo.
"""


# ── las herramientas ─────────────────────────────────────────────────────────────────────────────
def _git(*args, timeout=60):
    """Corre git DENTRO del monorepo. Solo lectura: acá no hay ningún verbo que escriba."""
    r = subprocess.run(
        ["git", "-C", str(REPO), *args],
        capture_output=True, text=True, timeout=timeout,
    )
    if r.returncode != 0:
        return {"error": (r.stderr or r.stdout)[:400].strip()}
    return r.stdout


def listar_workspaces():
    """Qué apps, modules y packages tiene el monorepo."""
    salida = {}
    for grupo in ("apps", "modules", "packages"):
        d = REPO / grupo
        salida[grupo] = sorted(p.name for p in d.iterdir() if p.is_dir()) if d.is_dir() else []
    return salida


def commits_recientes(rama="develop", cantidad=15):
    """Últimos commits de una rama: fecha, autor, asunto y cuántos archivos tocó."""
    crudo = _git("log", f"origin/{rama}", f"-{int(cantidad)}",
                 "--format=%h|%ad|%an|%s", "--date=short", "--shortstat")
    if isinstance(crudo, dict):
        return crudo
    commits, actual = [], None
    for linea in crudo.splitlines():
        linea = linea.strip()
        if "|" in linea and linea.count("|") >= 3:
            if actual:
                commits.append(actual)
            h, fecha, autor, asunto = linea.split("|", 3)
            actual = {"hash": h, "fecha": fecha, "autor": autor, "asunto": asunto, "cambios": ""}
        elif linea and actual:
            actual["cambios"] = linea
    if actual:
        commits.append(actual)
    return {"rama": rama, "commits": commits}


def cambios_de_dependencias(rama="develop", ultimos=20):
    """¿Se tocaron `package.json` o `pnpm-lock.yaml` en los últimos commits? El disparador conocido
    de los quiebres de empaquetado. Devuelve qué archivo, en qué commit y de quién."""
    crudo = _git("log", f"origin/{rama}", f"-{int(ultimos)}", "--name-only",
                 "--format=@@|%h|%an|%s", "--", "*package.json", "pnpm-lock.yaml")
    if isinstance(crudo, dict):
        return crudo
    hallazgos, cab = [], None
    for linea in crudo.splitlines():
        linea = linea.strip()
        if linea.startswith("@@|"):
            _, h, autor, asunto = linea.split("|", 3)
            cab = {"hash": h, "autor": autor, "asunto": asunto}
        elif linea and cab:
            hallazgos.append(dict(cab, archivo=linea))
    return {
        "rama": rama,
        "commits_mirados": ultimos,
        "cambios": hallazgos,
        "nota": "sin cambios de dependencias" if not hallazgos else
                "OJO: cambios en dependencias — es el disparador conocido de los quiebres de empaquetado",
    }


def compilar(filtro=""):
    """⚠ LENTA (minutos) y la única que escribe algo: corre `pnpm build` (turbo) en el monorepo.
    `filtro` acota a un workspace, p. ej. 'loan-request-wizard'. Usala solo si hay motivo."""
    cmd = ["pnpm", "run", "build"]
    if filtro:
        cmd += ["--filter", filtro]
    try:
        r = subprocess.run(cmd, cwd=str(REPO), capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        return {"ok": False, "motivo": "el build pasó los 15 minutos y se cortó"}
    except FileNotFoundError:
        return {"ok": False, "motivo": "no está pnpm en el PATH"}
    cola = (r.stdout + r.stderr).strip().splitlines()[-25:]
    return {"ok": r.returncode == 0, "codigo": r.returncode, "ultimas_lineas": cola}


HERRAMIENTAS = {
    "listar_workspaces": ({
        "name": "listar_workspaces",
        "description": "Qué apps, modules y packages tiene el monorepo. Rápida.",
        "parameters": {"type": "object", "properties": {}},
    }, listar_workspaces),

    "commits_recientes": ({
        "name": "commits_recientes",
        "description": "Últimos commits de una rama con fecha, autor, asunto y cuántos archivos tocó. Rápida.",
        "parameters": {"type": "object", "properties": {
            "rama": {"type": "string", "description": "rama remota, p. ej. 'develop' o 'main'"},
            "cantidad": {"type": "integer", "description": "cuántos commits, por defecto 15"},
        }},
    }, commits_recientes),

    "cambios_de_dependencias": ({
        "name": "cambios_de_dependencias",
        "description": (
            "Si se tocaron package.json o pnpm-lock.yaml en los últimos commits de una rama, con "
            "autor y commit. Es el disparador conocido de los quiebres de empaquetado. Rápida."
        ),
        "parameters": {"type": "object", "properties": {
            "rama": {"type": "string", "description": "rama remota, por defecto 'develop'"},
            "ultimos": {"type": "integer", "description": "cuántos commits mirar, por defecto 20"},
        }},
    }, cambios_de_dependencias),

    "compilar": ({
        "name": "compilar",
        "description": (
            "Corre el build del monorepo y dice si pasó. LENTA: tarda MINUTOS. Usala sólo si algo "
            "que ya viste da motivo para sospechar, no de entrada."
        ),
        "parameters": {"type": "object", "properties": {
            "filtro": {"type": "string", "description": "workspace a compilar, vacío = todo"},
        }},
    }, compilar),
}


def main():
    args = sys.argv[1:]
    try:
        cfg = gemini.config()
        if args and args[0] == "--modelos":
            print(f"Modelos disponibles para tu key (el configurado es «{cfg['modelo']}»):\n")
            for nombre, titulo in gemini.modelos(cfg["key"]):
                marca = "→" if nombre == cfg["modelo"] else " "
                print(f" {marca} {nombre:42} {titulo}")
            return 0

        if not REPO.is_dir():
            print(f"No encuentro el monorepo en {REPO}", file=sys.stderr)
            return 1

        pregunta = args[0] if args else PREGUNTA
        print(f"\n¿? {pregunta}\n\nmodelo: {cfg['modelo']}  ·  herramientas: {len(HERRAMIENTAS)}\n")
        respuesta = gemini.correr(pregunta, HERRAMIENTAS, INSTRUCCIONES, cfg)
        print(respuesta)
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
