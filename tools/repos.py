"""Los repos de la compañía: dónde están clonados, qué ref mirar y qué existe en `main`. FUENTE ÚNICA.

Vive en la raíz porque lo necesitan TRES directorios y no es de ninguno: el validador de citas y la
consola de ramas del tablero, la huella del trazador, y cinco herramientas de `workers`. Nació dentro
del árbol de `context/` (`tools/roots.py`) y se mudó acá el 2026-09-21, cuando ese árbol se apagó.

⚠ **POR QUÉ UNA SOLA COPIA.** No es prolijidad: está medido. El 2026-09-18, `roots.py` resolvía el
código contra el `main` LOCAL de cada clon —que nadie actualiza— y de esa ÚNICA causa salieron cinco
mentiras en cinco herramientas distintas: rutas buenas marcadas para borrar, deriva real dada por
sana, 400 mensajes de log de menos, 391 hardcodes en vez de 409. **Ninguna falló.** Todas devolvieron
menos, y «menos» se lee igual que «no existe». Dos copias de esta lista producirían exactamente eso.

Se importa poniendo la raíz del playground en el path:

    sys.path.insert(0, str(Path(__file__).resolve().parents[N] / "tools"))
    from repos import ROOTS, del_ref, ref_a_indexar
"""
import concurrent.futures
import os
import subprocess
from datetime import datetime, timezone

PLAYGROUND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def es_local(alias):
    """¿El alias apunta a una HERRAMIENTA DE ESTE REPO y no a un repo de la compañía?

    Se DERIVA de la ruta; no hay lista. Una lista a mano se desactualiza el día que se agregue una
    herramienta, y el síntoma sería ruido: medido el 2026-09-21, de 24 archivos con deriva en todo el
    árbol de contexto, 23 eran de herramientas locales y 1 de CreditOp — el único que importaba
    quedaba enterrado debajo.

    ⚠ Un alias DESCONOCIDO no es local. Parece obvio y no lo es: `os.path.abspath("")` devuelve el
    directorio actual, que corriendo desde acá está dentro del playground — o sea que la primera
    versión daba `True` para cualquier alias que no existiera, y un alias mal escrito habría
    desaparecido en silencio. Exactamente el falso verde que esto viene a evitar.
    """
    raiz = ROOTS.get(alias)
    if not raiz:
        return False
    raiz = os.path.abspath(raiz)
    return raiz == PLAYGROUND or raiz.startswith(PLAYGROUND + os.sep)


# ─── LOS REPOS QUE SE PUEDEN CITAR ──────────────────────────────────────────────────────────────────
#
# ⚠ **EL CRITERIO PARA AGREGAR UNO es que el servicio esté VIVO EN PRODUCCIÓN**, no que el repo exista
# en el disco. Se comprueba preguntándole a Loki qué `service_name` emitió en los últimos 7 días. Hasta
# el 2026-08-07 esto conocía 5 repos mientras producción corría **14 servicios**: los 9 que faltaban
# eran invisibles, así que cualquier cita a sus archivos dropeaba en silencio. Ver **F-123**.
#
# Los `microservices/*` son clones anidados dentro de `~/Desktop/CREDITOP/github/microservices/`; cada
# uno tiene su propio `.git`, así que `git ls-tree` funciona igual. El nombre es el del SERVICIO —el
# mismo que sale en Loki y en el deploy—, no la ruta.
#
# ⚠ `harness` y `trazador` no son repos propios: son SUBDIRECTORIOS de `playground`. `git ls-tree`
# desde ahí (sin `--full-name`) devuelve rutas relativas a ese directorio, que es justo el `relpath`
# con el que se nombra un archivo — por eso funcionan igual que los otros sin caso especial.
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

# Solo código. Un `.md`, `.sql` o `.yaml` no se indexa: una cita a un archivo así cae en «no existe».
EXTS = {".php", ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"}


# ─── QUÉ REF SE MIRA, Y POR QUÉ NO ALCANZA CON DECIR «main» ─────────────────────────────────────────
#
# Medido el 2026-09-18: `legacy-backend` estaba **14 commits detrás** de `origin/main`, así que mirar
# el `main` local describía un código de hace días. No falla: devuelve menos, y «menos» se lee igual
# que «no existe».
#
# ⚠ PERO «usar siempre origin/main» ES IGUAL DE FALSO, y los datos lo muestran: `harness` y `trazador`
# son subdirectorios de **playground**, cuyo `origin/main` va DETRÁS del local a propósito —el push lo
# decide Miguel—. Medido el mismo día: playground estaba +5 commits sobre su origin. Mirar `origin/main`
# ahí borraría el trabajo del día.
#
# La regla que sirve para los dos casos es la relación, no el nombre: **se mira la ref que CONTIENE a
# la otra**. Si el local es ancestro del remoto, el remoto trae todo lo del local y más; si no lo es
# —porque el local está adelante o porque divergieron— manda el local, que es lo que la persona ve.
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
            if f.result()[0] != 0:
                fallaron.append(alias)
    if verboso and fallaron:
        print(f"  ⚠ no se pudo actualizar: {', '.join(sorted(fallaron))} — se usa lo que hay en disco")
    return fallaron


# El resultado se cachea por proceso: resolver la ref son cuatro llamadas a git y se pregunta una vez
# por repo y por cita.
_CACHE_REF = {}


def ref_a_indexar(root, rama="main"):
    """La ref de git que hay que mirar: la que CONTIENE a la otra (ver la nota de arriba).

    Devuelve `(ref, motivo)`. El motivo existe para poder imprimirlo: un veredicto que no dice de qué
    ref salió no se puede contrastar con nada.

    ⚠ NO HACE FETCH: resuelve con lo que ya hay en disco. Quien quiera refs frescas llama antes a
    `refrescar_remotos()`. Pagar segundos de red en cada consulta es peor negocio que aprovechar el
    último fetch de cualquiera; aun sin fetch esto ya mejora el `main` local que nadie mueve.
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
        return rama, f"DIVERGEN (local +{n} / remoto +{atras}) — se mira el local"
    return rama, f"el local va {n} adelante"


DIAS_RANCIO = 14  # a partir de acá se avisa que el ref local puede estar detrás de origin


def del_ref(ref=None):
    """Archivos que existen en `ref`, como `alias/relpath`. Devuelve además los roots que NO se
    pudieron consultar (para no contarlos como si estuvieran bien) y los refs viejos.

    ⚠ CON EL DEFAULT (`None`), LA REF SE RESUELVE POR REPO Y NO ES EL LITERAL `main`: `ref_a_indexar`
    elige la que CONTIENE a la otra. Un `ref` explícito NO se toca: si alguien pide `qa`, quiere `qa`.

    `git ls-tree` es READ-ONLY: no hace checkout, no hace fetch, no mueve el HEAD de nadie.
    """
    have, sin_verificar, viejos = set(), [], []
    auto = ref is None
    for alias, root in ROOTS.items():
        if not os.path.isdir(root):
            sin_verificar.append((alias, "el directorio no existe"))
            continue
        if auto:
            ref, _ = ref_a_indexar(root)
            if ref is None:
                sin_verificar.append((alias, "no existe ni `main` ni `origin/main`"))
                continue
        # sin --full-name A PROPÓSITO: las rutas vienen relativas al DIRECTORIO consultado, que es
        # exactamente el `relpath` con el que se arma `alias/relpath`. Por eso `harness`, que es un
        # subdirectorio de playground y no un repo propio, funciona sin caso especial.
        code, out = _git(root, "ls-tree", "-r", ref, "--name-only", timeout=60)
        if code != 0:
            sin_verificar.append((alias, f"no se pudo leer `{ref}`"))
            if auto:
                ref = None
            continue
        for ruta in out.splitlines():
            if os.path.splitext(ruta)[1] in EXTS:
                have.add(f"{alias}/{ruta}")
        # ¿qué tan viejo es ese ref acá? NO se hace fetch (sería tocar la red por debajo): se avisa.
        c, f = _git(root, "log", "-1", "--format=%ct", ref)
        if c == 0 and f.isdigit():
            edad = datetime.now(timezone.utc) - datetime.fromtimestamp(int(f), timezone.utc)
            if edad.days >= DIAS_RANCIO:
                viejos.append((alias, edad.days, ref))
        if auto:
            ref = None
    return have, sin_verificar, viejos


# Contra qué se compara el «hoy». ⚠ NO ES UNA CONSTANTE, y por eso es una función: la ref correcta se
# decide POR REPO (ver la nota de arriba).
def ref_hoy(alias):
    root = ROOTS.get(alias)
    if not root:
        return "main"
    ref, _ = ref_a_indexar(root)
    return ref or "main"
