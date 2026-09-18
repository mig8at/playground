"""Los repos que el árbol indexa y qué cuenta como archivo fuente. FUENTE ÚNICA.

La importan `build-index.py` (que camina el working tree) y `oracle.py` (que le pregunta a git por
una rama). Tenerlo dos veces era una divergencia esperando a pasar: un repo agregado en un solo lado
hace que el oráculo valide contra un universo distinto del que se indexó, y eso no falla — da un
veredicto equivocado.

⚠ `harness` y `trazador` no son repos propios: son SUBDIRECTORIOS de `playground`. `git ls-tree` desde
ahí (sin `--full-name`) devuelve rutas relativas a ese directorio, que es justo el `relpath` que usa el
índice — por eso funcionan igual que los otros cinco sin caso especial.

⚠ **EL CRITERIO PARA AGREGAR UN ROOT es que el servicio esté VIVO EN PRODUCCIÓN**, no que el repo exista
en el disco. Se comprueba preguntándole a Loki qué `service_name` emitió en los últimos 7 días (ver el
nodo `microservicios`, que trae la receta y el censo). Hasta el 2026-08-07 esto indexaba 5 repos mientras
producción corría **14 servicios**: los 9 que faltaban eran invisibles para el árbol, así que ninguna
tarea sobre ellos podía rutear y cualquier cita a sus archivos dropeaba en silencio. Ver **F-123**.

Los `microservices/*` son clones anidados dentro de `~/Desktop/CREDITOP/github/microservices/`; cada uno
tiene su propio `.git`, así que `git ls-tree` funciona igual. El nombre del root es el del SERVICIO —el
mismo que sale en Loki y en el deploy—, no la ruta.
"""
import os

ROOTS = {
    "application": os.path.expanduser("~/Desktop/CREDITOP/github/legacy-application"),
    "frontend-monorepo": os.path.expanduser("~/Desktop/CREDITOP/github/frontend-monorepo"),
    "legacy-backend": os.path.expanduser("~/Desktop/CREDITOP/github/legacy-backend"),
    "pre-approvals-service": os.path.expanduser("~/Desktop/CREDITOP/github/pre-approvals-service"),
    "form-service": os.path.expanduser("~/Desktop/CREDITOP/github/form-service"),
    # Vivos en prod y clonados — agregados el 2026-08-07 (F-123).
    "customer-profiling-service": os.path.expanduser("~/Desktop/CREDITOP/github/customer-profiling-service"),
    "onboarding-forms-service": os.path.expanduser("~/Desktop/CREDITOP/github/onboarding-forms-service"),
    "customer-service": os.path.expanduser("~/Desktop/CREDITOP/github/microservices/customer-service"),
    "financial-health-service": os.path.expanduser("~/Desktop/CREDITOP/github/microservices/financial-health-service"),
    "pdf-mapper-service": os.path.expanduser("~/Desktop/CREDITOP/github/microservices/pdf-mapper-service"),
    # Herramientas propias (subdirectorios de playground, no repos).
    "harness": os.path.expanduser("~/Desktop/CREDITOP/playground/harness"),
    "trazador": os.path.expanduser("~/Desktop/CREDITOP/playground/trazador"),
}

# Solo código. Un `.md`, `.sql` o `.yaml` SIEMPRE dropea: no va en `files[]`, se menciona en el doc.md.
EXTS = {".php", ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"}

EXCLUDE = {"node_modules", "vendor", ".git", ".next", "coverage", ".turbo", ".idea", ".vscode"}


# ─── QUÉ REF SE INDEXA, Y POR QUÉ NO ALCANZA CON DECIR «main» ───────────────────────────────────────
#
# Todo el índice de `workers/` se deriva de `main` — así lo anuncia el CLAUDE.md del repo— y hasta hoy
# eso significaba el `main` LOCAL de cada clon, que nadie actualiza al indexar. Medido el 2026-09-18:
# `legacy-backend` estaba **14 commits detrás** de `origin/main`, así que `logs.json` (y con él la
# resolución mensaje→archivo del trazador) describía un código de hace días. No falla: devuelve menos
# mensajes, y «menos» se lee igual que «no existe».
#
# ⚠ PERO «usar siempre origin/main» ES IGUAL DE FALSO, y los datos lo muestran: `harness` y `trazador`
# son subdirectorios de **playground**, cuyo `origin/main` va DETRÁS del local a propósito —el push lo
# decide Miguel—. Medido el mismo día: playground estaba +5 commits sobre su origin. Indexar `origin/main`
# ahí borraría del índice el trabajo del día.
#
# La regla que sirve para los dos casos es la relación, no el nombre: **se indexa la ref que CONTIENE a
# la otra**. Si el local es ancestro del remoto, el remoto trae todo lo del local y más; si no lo es
# —porque el local está adelante o porque divergieron— manda el local, que es lo que la persona ve.
import concurrent.futures
import subprocess


def _git(root, *args, timeout=30):
    try:
        r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except (subprocess.TimeoutExpired, OSError):
        return 1, ""


def refrescar_remotos(roots=None, timeout=30, verboso=False):
    """`git fetch` de cada repo, EN PARALELO. Devuelve los alias que fallaron.

    Es de solo lectura: actualiza las refs remotas y no toca ni el working tree ni ninguna rama local,
    así que es seguro con ramas y stashes en curso. En serie son ~2 s por repo (medido) y con doce eso
    son veinte segundos de espera; en paralelo es el más lento de todos.

    ⚠ Un fetch que falla NO rompe nada: se sigue con lo que haya en disco y se devuelve el alias para
    que quien llame lo pueda decir. Un índice construido sin red es legítimo; uno construido sin red y
    presentado como al día, no.
    """
    roots = roots or ROOTS
    reales = {a: r for a, r in roots.items() if os.path.isdir(os.path.join(r, ".git"))}
    fallaron = []
    if not reales:
        return fallaron
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(_git, r, "fetch", "--quiet", "origin", timeout=timeout): a
                for a, r in reales.items()}
        for f in concurrent.futures.as_completed(futs):
            alias = futs[f]
            code, _ = f.result()
            if code != 0:
                fallaron.append(alias)
    if verboso and fallaron:
        print(f"  ⚠ no se pudo actualizar: {', '.join(sorted(fallaron))} — se indexa lo que hay en disco")
    return fallaron


# El resultado se cachea por proceso: los consumidores interactivos la llaman DENTRO de un loop sobre
# repos (`contexto.py` grepea los doce por consulta) y cada resolución son cuatro llamadas a git. Sin
# cache eso es ~50 subprocesos por comando para contestar algo que no cambia mientras el comando corre.
_CACHE_REF = {}


def ref_a_indexar(root, rama="main"):
    """La ref de git que hay que recorrer: la que CONTIENE a la otra (ver la nota de arriba).

    Devuelve `(ref, motivo)`. El motivo existe para poder imprimirlo: un índice que no dice de qué ref
    salió no se puede contrastar con nada.

    ⚠ NO HACE FETCH: resuelve con lo que ya hay en disco. Quien quiera refs frescas llama antes a
    `refrescar_remotos()` — lo hace `logs.py`, que construye un índice persistente. Los consumidores
    interactivos NO lo hacen a propósito: pagar segundos de red en cada grep es peor negocio que
    aprovechar el último fetch de cualquiera. Aun sin fetch esto ya mejora lo que había, porque
    `origin/main` suele estar por delante del `main` local que nadie mueve.
    """
    if (root, rama) in _CACHE_REF:
        return _CACHE_REF[(root, rama)]
    out = _ref_a_indexar(root, rama)
    _CACHE_REF[(root, rama)] = out
    return out


def _ref_a_indexar(root, rama):
    remoto = f"origin/{rama}"
    hay_local = _git(root, "rev-parse", "--verify", "--quiet", rama)[0] == 0
    hay_remoto = _git(root, "rev-parse", "--verify", "--quiet", remoto)[0] == 0

    if not hay_local and not hay_remoto:
        return None, f"no existe ni {rama} ni {remoto}"
    if not hay_remoto:
        return rama, "sin remoto"
    if not hay_local:
        return remoto, "sin rama local"

    # ¿El local está contenido en el remoto? Entonces el remoto trae todo y más.
    if _git(root, "merge-base", "--is-ancestor", rama, remoto)[0] == 0:
        n = _git(root, "rev-list", "--count", f"{rama}..{remoto}")[1] or "0"
        return remoto, ("al día" if n == "0" else f"el local va {n} detrás")
    n = _git(root, "rev-list", "--count", f"{remoto}..{rama}")[1] or "0"
    atras = _git(root, "rev-list", "--count", f"{rama}..{remoto}")[1] or "0"
    if atras != "0":
        return rama, f"DIVERGEN (local +{n} / remoto +{atras}) — se indexa el local"
    return rama, f"el local va {n} adelante"
