#!/usr/bin/env python3
"""¿Las referencias `archivo:línea` de un documento siguen apuntando a lo que dicen?

Se le pasan documentos y contesta, cita por cita, si el código que citan sigue donde el documento
dice. Vive acá porque el tablero es quien lo necesita para siempre: las trampas del sistema (`F-xx`)
guardan 149 citas al código de la compañía y sin esto envejecen en silencio.

⚠ NACIÓ EN `context/tools/refs.py` Y SE MUDÓ EL 2026-09-21, cuando el árbol de contexto empezó a
apagarse. No es una copia: es el mismo archivo, y los tres consumidores que quedan en `context/`
importan de acá. Dos motores de citas derivan, y el síntoma de la deriva sería un verde.

CÓMO LO SABE: el ANCLA DE GIT, no el símbolo de la prosa.

La versión anterior buscaba en el texto del doc un símbolo en backticks pegado a la cita y verificaba
que estuviera cerca de la línea. **Nunca funcionó ni una vez.** La cita misma va entre backticks
(`` `routes/customer.php:236-239` ``), así que lo que hay justo antes es el backtick de APERTURA y la
regex jamás cerraba par. Medido el 2026-07-31: de 889 citas «ok», **889 eran solo chequeo de rango**
—«el archivo tiene al menos 236 líneas»— y CERO habían comprobado un símbolo. Una cita corrida seis
líneas pasó en verde y se selló un nodo con ella.

Y emparejar la cita con el símbolo contiguo TAMPOCO se puede: los documentos no tienen convención
fija —a veces va antes, a veces después, y muchas veces lo de al lado es una celda de tabla o un
string de ruta—. Al probarlo, los matches agarraban el símbolo equivocado. Forzarlo produce «movidas»
falsas, que es peor que no chequear: te manda a arreglar lo que está bien.

Lo confiable no está en la prosa, está en git:

  1. ¿cuándo se afirmó esta cita? `max(sello del documento, fecha en que se escribió esa línea)`
     — el sello sale de un `map.json` al lado del documento, si lo hay; la otra de `git blame` sobre
     el propio documento. El `max` NO es un detalle: sin él, corregir una cita la vuelve a romper
     (ver `escrita_en`);
  2. se abre el archivo citado en `main` **a esa fecha** y se guarda el TEXTO de la línea — el ancla;
  3. se busca ese texto en `main` hoy → si está en otra línea, se dice en cuál.

Sin convención que imponer, sin adivinar, y funciona igual para las citas sin símbolo (la mayoría).
Sigue renombres: un archivo pudo cambiar de ruta desde entonces —pasó con `frontend-e2e/` →
`harness/` el 2026-07-31— y sin seguirlos todas las citas de ese documento dirían «no existía».

BALDES, y separarlos es lo que hace que se le pueda creer:
  ✓ ok         el ancla sigue exactamente en esa línea.
  · corrida    desalineada ≤3 líneas: el bloque es el mismo, el archivo ganó algo arriba. No falla.
  ⚠ movida     el ancla está en OTRA línea → viene el número correcto. No marca: corrige.
  ⚠ reescrita  el ancla ya no está en el archivo: la línea se editó o se borró. Pide leer.
  ⚠ fuera      la línea no existe: el archivo tiene menos líneas.
  · sin ancla  NO se pudo anclar (línea en blanco al sellar, ancla demasiado corta para ser única, el
               archivo no existía, o el documento no tiene sello). Se cae al chequeo de rango, que es
               débil — y por eso va en su propio balde en vez de disfrazarse de ✓.
  ? ambigua    el nombre matchea varios archivos y NINGUNO valida: el destino dependería de cuál
               se elija, así que no se ofrece corrección. Se listan los veredictos de todos.
  ? corta      `` `:123` `` relativa al contexto: NADIE la valida. Son la mitad de las citas con
               número de línea, así que el resumen las declara — un verde que cubre el 50 % y no lo
               dice es la misma trampa que el chequeo débil de antes. Se arreglan escribiendo la ruta
               completa; por qué no se resuelven solas, en el comentario de `CORTA`.
  ? no existe  ningún archivo matchea en `main`.

USO
  python3 tablero/tools/citas.py <doc.md> [<doc.md> …]   → valida esos documentos
  python3 tablero/tools/citas.py <doc.md> --ok           → lista también las que están bien

EXIT  0 → nada que corregir · 1 → hay movidas, reescritas o fuera de rango
"""
import concurrent.futures
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from functools import lru_cache

# La raíz del playground: es el repo contra el que se hace `git blame` de los documentos, y todas las
# rutas que se imprimen son relativas a él.
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


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
def _git_raw(root, *args, timeout=30):
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
        futs = {ex.submit(_git_raw, r, "fetch", "--quiet", "origin", timeout=timeout): a
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
    hay_local = _git_raw(root, "rev-parse", "--verify", "--quiet", rama)[0] == 0
    hay_remoto = _git_raw(root, "rev-parse", "--verify", "--quiet", remoto)[0] == 0

    if not hay_local and not hay_remoto:
        return None, f"no existe ni {rama} ni {remoto}"
    if not hay_remoto:
        return rama, "sin remoto"
    if not hay_local:
        return remoto, "sin rama local"

    # ¿El local está contenido en el remoto? Entonces el remoto trae todo y más.
    if _git_raw(root, "merge-base", "--is-ancestor", rama, remoto)[0] == 0:
        n = _git_raw(root, "rev-list", "--count", f"{rama}..{remoto}")[1] or "0"
        return remoto, ("al día" if n == "0" else f"el local va {n} detrás")
    n = _git_raw(root, "rev-list", "--count", f"{remoto}..{rama}")[1] or "0"
    atras = _git_raw(root, "rev-list", "--count", f"{rama}..{remoto}")[1] or "0"
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
        code, out = _git_raw(root, "ls-tree", "-r", ref, "--name-only", timeout=60)
        if code != 0:
            sin_verificar.append((alias, f"no se pudo leer `{ref}`"))
            if auto:
                ref = None
            continue
        for ruta in out.splitlines():
            if os.path.splitext(ruta)[1] in EXTS:
                have.add(f"{alias}/{ruta}")
        # ¿qué tan viejo es ese ref acá? NO se hace fetch (sería tocar la red por debajo): se avisa.
        c, f = _git_raw(root, "log", "-1", "--format=%ct", ref)
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


CERCA = 0        # el ancla es TEXTO EXACTO: o está en esa línea o no está. La tolerancia de ±3 venía
                 # del método viejo (buscaba un símbolo "cerca") y acá miente: con ±3, un bloque
                 # corrido 2 líneas se reportaba como «inicio bien, fin movido» — media verdad.
LEVE = 3         # hasta acá una cita desalineada es «corrida» (el archivo ganó un import arriba) y
                 # no «movida» (apunta a otra parte). Se separan por prioridad, no se esconden.
ANCLA_MIN = 10   # caracteres no-espacio mínimos. Una línea `}` o `]);` matchea en 200 lugares: como
                 # ancla no afirma nada, y tratarla como válida inventaría «movidas» al azar.

# `ruta/archivo.ext:123` o `…:123-145` — con o sin backticks. La extensión es obligatoria para no
# capturar cualquier `palabra:123`; los archivos sin extensión (bin/asesor:99) se buscan aparte.
# El FIN del rango se captura a propósito: corregir solo el inicio de `:180-226` deja el final
# mintiendo, y un bloque que creció mueve las dos puntas distinto (pasó con `otp-verification.tsx`:
# el inicio se corrió 8 líneas y el fin 10, porque la función ganó dos líneas adentro).
REF = re.compile(r'([\w][\w./+\-]*\.(?:ts|tsx|php|mjs|cjs|js|jsx|vue|go)):(\d+)(?:-(\d+))?')

# ── Citas en formato CORTO: `` `:169` ``, relativas al archivo que nombra el contexto ────────────
# Son la MITAD de las citas con número de línea del árbol, y hasta el 2026-08-08 la herramienta no
# las veía: decía «0 movidas» sobre el 59% de las citas y el resto podía correrse en silencio. Es la
# misma familia del bug del docstring —un verde que cubre menos de lo que aparenta—, por otra puerta.
#
# ⚠ NO SE RESUELVEN, Y ESO ES UNA DECISIÓN MEDIDA, NO PEREZA. Se intentó el 2026-08-08: resolver la
# cita corta contra el único archivo nombrado en la línea (o en la sección). Parecía seguro —440 de
# 903 tenían exactamente un candidato— y produjo **22 fallos falsos**, porque los docs nombran al
# sujeto por CLASE y no por archivo. El caso que lo tumbó:
#
#     hereda `ApiController` (`app/Http/Controllers/ApiController.php:7`) y responde con el trait
#     `App\Traits\ApiResponse`: `{success…}` (`:9`) o `{success:false…}` (`:33`)
#
# `:9` y `:33` son de `ApiResponse.php`, pero el trait no lleva extensión, así que la línea "nombra
# un solo archivo" y la resolución apunta al controller — que tiene 10 líneas. Es exactamente lo que
# el docstring de arriba ya había aprendido: forzar el emparejamiento manda a corregir lo que está
# bien. Así que se CUENTAN y se declaran, no se validan: el número honesto vale más que un verde que
# cubre la mitad. La salida es convertirlas a ruta completa, que sí se ancla.
CORTA = re.compile(r'`:(\d+)(?:-(\d+))?`')



def git(repo, *args):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, errors="replace")
    return r.stdout if r.returncode == 0 else None


@lru_cache(maxsize=None)
def repo_de(alias):
    """(raíz del repo, prefijo del alias dentro de esa raíz).

    ⚠ El alias `harness` NO es un repo: es un subdirectorio de `playground`. Sin normalizar acá, unos
    comandos de git devuelven rutas relativas al subdirectorio y otros relativas a la raíz, y esa
    asimetría ya causó dos bugs reales (alinear.py contaba 1 de 44 en vez de 16; refs.py armaba
    `legacy-backend/legacy-backend/...`). Con toplevel+prefix hay una sola forma de nombrar un archivo.
    """
    d = ROOTS[alias]
    top, pre = git(d, "rev-parse", "--show-toplevel"), git(d, "rev-parse", "--show-prefix")
    return (top.strip(), pre.strip()) if top else (None, "")


@lru_cache(maxsize=None)
def sha_en(repo, fecha):
    """El commit al cierre de ese día — el estado que el nodo dice haber verificado.

    ⚠ `repo` acá es el TOPLEVEL del clon, no un alias, así que la ref se resuelve desde la ruta. Contra
    un `main` local atrasado el «cierre de hoy» cae en un commit de días atrás y toda la comparación se
    corre con él."""
    ref, _ = ref_a_indexar(repo)
    out = git(repo, "rev-list", "-1", f"--before={fecha} 23:59:59", ref or "main")
    return out.strip() if out and out.strip() else None


@lru_cache(maxsize=None)
def renombres(repo, sha):
    """{ruta_hoy: ruta_cuando_se_selló}, siguiendo cadenas (un archivo pudo renombrarse dos veces)."""
    ref, _ = ref_a_indexar(repo)
    out = git(repo, "log", "--diff-filter=R", "-M", "--name-status", "--format=", f"{sha}..{ref or 'main'}")
    directo = {}
    for ln in (out or "").splitlines():
        p = ln.split("\t")
        if len(p) == 3 and p[0].startswith("R"):
            directo[p[2]] = p[1]  # nuevo -> viejo
    def origen(p):
        visto = set()
        while p in directo and p not in visto:
            visto.add(p)
            p = directo[p]
        return p
    return {n: origen(n) for n in directo}


@lru_cache(maxsize=None)
def en_ref(alias, ref, rel):
    """El archivo tal como está en `ref` (por defecto `main`), NO como está en disco.

    ⚠ ESTE ES EL MISMO BUG QUE SE ARREGLÓ EN `oracle.py`, y reapareció acá. Leer el working tree hace
    que el veredicto dependa de **qué rama tengas checkeada**: con una feature branch puesta, tus
    propios cambios sin mergear se reportan como citas movidas. Pasó el 2026-08-03 — 6 líneas agregadas
    a `config/services.php` en una rama de trabajo hicieron aparecer una «movida» en el nodo
    `bancolombia`, y la cita contra `main` estaba perfecta. El árbol describe `main`: se compara
    main-entonces contra main-hoy, y el disco no entra.
    """
    repo, pre = repo_de(alias)
    if not repo:
        return None
    return contenido(repo, ref, pre + rel)


@lru_cache(maxsize=None)
def contenido(repo, sha, path):
    out = git(repo, "show", f"{sha}:{path}")
    return tuple(out.splitlines()) if out is not None else None


@lru_cache(maxsize=None)
def escrita_en(doc):
    """{nº de línea del doc: fecha en que se escribió esa línea} — `git blame` sobre el propio doc.

    ⚠ ESTO NO ES UN LUJO, ES LO QUE HACE QUE LA HERRAMIENTA SE PUEDA USAR DOS VECES. El ancla se lee
    del archivo citado «en la fecha del sello», y el número de línea de la cita solo tiene sentido
    contra ESA fecha: son un par. Si alguien corrige `:180`→`:185` sin re-sellar el nodo, la corrida
    siguiente lee el baseline viejo en la línea 185 —donde entonces había otro código— y vuelve a
    «corregir» con el mismo desplazamiento. Pasó en la primera prueba: las 8 correcciones recién
    aplicadas reaparecieron como movidas, +5 otra vez.

    El baseline correcto de cada cita es el momento en que ALGUIEN AFIRMÓ que era cierta, o sea
    `max(sello del nodo, fecha en que se escribió esa línea)`. Una línea corregida hoy se ancla contra
    hoy y no da falso positivo; una línea vieja en un nodo viejo sigue detectando la deriva.

    Las líneas sin commitear salen con fecha de hoy (blame las marca `0000…`), que es lo correcto:
    acabás de escribirlas.
    """
    out = git(RAIZ, "blame", "--line-porcelain", "-w", "--", doc)
    fechas, ln, ts = {}, None, None
    for row in (out or "").splitlines():
        m = re.match(r'^[0-9a-f]{40} \d+ (\d+)', row)
        if m:
            ln, ts = int(m.group(1)), None
        elif ln and row.startswith("committer-time "):
            ts = int(row.split()[1])
        elif ln and ts is not None and row.startswith("committer-tz "):
            # ⚠ la fecha va en la zona de quien commiteó, NO en UTC. Con `utcfromtimestamp`, un commit
            # de las 19:00 en Colombia (UTC-5) salía fechado al DÍA SIGUIENTE, y un baseline un día
            # más nuevo de la cuenta se come la deriva de ese día sin avisar.
            tz = row.split()[1]
            off = (1 if tz[0] == "+" else -1) * (int(tz[1:3]) * 3600 + int(tz[3:5]) * 60)
            fechas[ln] = datetime.fromtimestamp(ts + off, timezone.utc).strftime("%Y-%m-%d")
    return fechas


def ubicar(ancla, hoy, esperado):
    """(línea de hoy más cercana a `esperado`, cuántas coincidencias) · (None, 0) si el ancla no sirve.

    Un ancla corta (`}`, `});`, `return;`) matchea en decenas de lugares: no afirma nada, y tratarla
    como válida inventa correcciones al azar. Se rechaza antes de buscar.
    """
    if len(ancla.replace(" ", "")) < ANCLA_MIN:
        return None, 0
    hits = [i + 1 for i, l in enumerate(hoy) if l.strip() == ancla]
    if not hits:
        return None, 0
    return min(hits, key=lambda h: abs(h - esperado)), len(hits)


def por_ancla(alias, rel, n, fin, fecha, hoy):
    """('ok'|'movida'|'reescrita', nota) o None si no se pudo anclar (→ el caller cae al rango)."""
    repo, pre = repo_de(alias)
    if not repo or not fecha:
        return None
    sha = sha_en(repo, fecha)
    if not sha:
        return None
    full = pre + rel
    base = contenido(repo, sha, renombres(repo, sha).get(full, full))
    if base is None or n > len(base):
        return None                       # el archivo (o la línea) no existía al sellar
    ancla = base[n - 1].strip()
    if len(ancla.replace(" ", "")) < ANCLA_MIN:
        return None                       # ancla demasiado corta para afirmar nada
    hits = [i + 1 for i, l in enumerate(hoy) if l.strip() == ancla]
    if not hits:
        return ("reescrita", f"la línea de entonces ya no está: «{ancla[:56]}»")
    movio = not any(abs(h - n) <= CERCA for h in hits)
    ini = min(hits, key=lambda h: abs(h - n))

    # El fin del rango, si lo hay. NO se calcula como «inicio nuevo + largo viejo»: el bloque pudo
    # crecer por dentro. Se ancla igual que el inicio, y si su ancla no sirve se DICE, en vez de
    # devolver un número inventado que el que corrige va a copiar tal cual.
    cola = ""
    if fin and n < fin <= len(base):
        f_new, f_cnt = ubicar(base[fin - 1].strip(), hoy, (ini if movio else n) + (fin - n))
        if f_new is None:
            cola = f" · el fin (:{fin}) no se ancla («{base[fin - 1].strip()[:18]}»): revisalo a mano"
        elif f_cnt > 1:
            cola = f" · fin ≈ :{f_new}, pero ese ancla se repite {f_cnt}×: confirmalo"
        elif movio:
            cola = f" → rango :{ini}-{f_new}"
        elif f_new != fin:
            # el inicio no se movió pero el bloque creció: el rango igual quedó mal
            grado = "corrida" if abs(f_new - fin) <= LEVE else "movida"
            return (grado, f"{alias}: el inicio :{n} sigue bien, pero el rango termina en :{f_new}")

    if not movio:
        return ("ok", "ancla" + (cola if cola else ""))
    extra = f" (y {len(hits) - 1} coincidencia(s) más)" if len(hits) > 1 else ""
    # Se separa por MAGNITUD, y no es cosmética. Con match exacto aparecen 37 citas desalineadas, pero
    # 31 lo están por 1-3 líneas (el archivo ganó un import arriba) y 6 apuntan a otra parte del
    # archivo. Mezclarlas ahoga las que importan; esconder las chicas bajo una tolerancia es afirmar
    # que una cita es correcta cuando no lo es. Van en baldes distintos y solo las grandes fallan.
    grado = "corrida" if abs(ini - n) <= LEVE else "movida"
    # El alias va SIEMPRE en la corrección: cuando la cita matchea varios repos (`config/app.php`
    # vive en dos, `UserRequestController.php` en cinco), un «está en :178» pelado no dice en cuál
    # se comprobó — y editar el doc a ciegas con ese número es cambiar una cita correcta por otra.
    return (grado, f"{alias}: está en :{ini}{extra}{cola}")


def indice(ref=None):
    """Mapas para resolver una cita: por relpath completo y por basename.

    `ref=None` es el modo automático de `oracle.del_ref`: cada repo se mira con la ref que contiene a
    la otra. Un valor explícito se respeta tal cual."""
    existen, _, _ = del_ref(ref)
    por_rel, por_base = defaultdict(list), defaultdict(list)
    for f in existen:
        alias, _, rel = f.partition("/")
        por_rel[rel].append((alias, rel))
        por_base[os.path.basename(rel)].append((alias, rel))
    return existen, por_rel, por_base


def resolver(cita, existen, por_rel, por_base):
    """Devuelve [(alias, relpath)] candidatos para una cita tal como está escrita en el doc."""
    # Los docs eliden tramos con `...` o `…` (`Modules/Risk/.../SistecreditoController.php`). Es un
    # estilo de escritura, no una ruta rota: se toma lo que va DESPUÉS de la última elisión y se
    # resuelve por sufijo. Sin esto, 7 citas válidas caían en "no existe".
    if "..." in cita or "…" in cita:
        cita = re.split(r'(?:\.{3}|…)/?', cita)[-1].lstrip("/")
    # 0) la cita YA trae el alias. Sin este caso primero, el paso 1 le pega otro alias delante y arma
    #    `legacy-backend/legacy-backend/app/...`: no resuelve y el archivo aparece como inexistente.
    if cita in existen:
        alias, _, rel = cita.partition("/")
        return [(alias, rel)]
    # 1) con cada alias por delante — y se RECOLECTAN TODOS, no se devuelve el primero. Devolver el
    #    primero hacía que `config/services.php` resolviera a `legacy-application` (267 líneas) y
    #    reportara como deriva las citas :297/:303/:317, válidas en `legacy-backend` (371). Seis falsos
    #    positivos de una: el mismo archivo vive en dos repos, y elegir por orden del dict es al azar.
    en_alias = [(alias, cita) for alias in ROOTS if f"{alias}/{cita}" in existen]
    if en_alias:
        return en_alias
    if cita in por_rel:
        return por_rel[cita]
    suf = [v for rel, vs in por_rel.items() if rel.endswith("/" + cita) for v in vs]
    if suf:
        return suf
    # el basename SOLO si la cita no traía directorio. Con directorio, caer al basename es
    # mis-resolución: `backend-e2e/main.go` (herramienta borrada) se pegaba al `main.go` de otro repo
    # y salía reportado como "fuera de rango", o sea deriva inventada.
    if "/" in cita:
        return []
    return por_base.get(cita, [])


def evaluar(cita, n, fin, base_cita, idx):
    """(balde, nota) para una cita ya resuelta a nombre de archivo. Compartido por el formato
    completo (`ruta/archivo.php:123`) y el corto (`` `:123` `` resuelto contra su contexto)."""
    existen, por_rel, por_base = idx
    cands = resolver(cita, existen, por_rel, por_base)
    if not cands:
        return "no-existe", ""

    veredictos = []
    for alias, rel in sorted({(a, r) for a, r in cands}):
        hoy = en_ref(alias, ref_hoy(alias), rel)
        if hoy is None:
            continue
        hoy = list(hoy)
        if n > len(hoy):
            veredictos.append(("fuera", f"{alias}/{rel}: tiene {len(hoy)} líneas"))
            continue
        veredictos.append(por_ancla(alias, rel, n, fin, base_cita, hoy)
                          or ("sin-ancla", "solo se verificó que la línea existe"))

    # Con varios candidatos NO se adivina, pero tampoco se tira la toalla: si ALGUNO valida, la cita
    # está bien. Con el ancla esto además DESAMBIGUA solo — el archivo equivocado no contiene ese texto.
    orden = ["ok", "corrida", "movida", "reescrita", "sin-ancla", "fuera"]
    if not veredictos:
        return "no-existe", "no se pudo leer"
    clave, nota = min(veredictos, key=lambda v: orden.index(v[0]))

    if len(cands) > 1:
        if clave not in ("movida", "reescrita", "fuera"):
            # ALGUNO valida (`ok`/`corrida`), o el chequeo fue débil y NO propone ningún destino
            # (`sin-ancla`). En los dos casos no hay corrección que pueda salir del candidato
            # equivocado, que es lo único que esta rama tiene que evitar. Cuántos había se dice igual,
            # porque saber que el nombre es compartido cambia cómo se lee la cita.
            nota += f" · {len(cands)} candidatos"
        else:
            # ⚠ NINGUNO VALIDA, Y ACÁ LA CORRECCIÓN NO SE PUEDE OFRECER. El destino que saldría es el
            # del candidato que el ranking puso primero, no el que la evidencia señala — y aplicarlo
            # rompe citas buenas. Medido el 2026-09-18 en el nodo `actors`: cinco citas a
            # `app/Models/User.php` (que existe en los DOS monolitos) salían como «movidas» a
            # `application`, con saltos de ~54 líneas; eran de `legacy-backend` y estaban corridas +1.
            # La corrección automática las habría roto.
            #
            # Antes esto sólo se marcaba `ambigua` cuando el mejor veredicto era `reescrita`/`fuera`, o
            # sea cuando ni siquiera había número que ofrecer. El caso peligroso es el otro: cuando SÍ
            # hay número y parece confiable. Ahora se listan los veredictos de TODOS los candidatos, que
            # es lo que deja decidir a quien lee — y para eso la sección ya dice que piden juicio.
            clave = "ambigua"
            detalle = " · ".join(f"[{k}] {t}" for k, t in sorted(veredictos, key=lambda v: orden.index(v[0])))
            nota = f"{len(cands)} candidatos y ninguno valida — {detalle}"
    return clave, nota



# ─── RECORRER DOCUMENTOS ────────────────────────────────────────────────────────────────────────────

def sello_de(doc):
    """La fecha en que alguien declaró haber verificado el documento entero, si la hay.

    Sale de un `map.json` al lado del documento (`verified.date`) — el formato que usaba el árbol de
    contexto. Un documento sin sello no queda sin validar: cada cita se ancla contra la fecha en que
    se ESCRIBIÓ esa línea (`escrita_en`), que es más ajustada. Lo que se pierde es detectar deriva en
    una línea vieja que nadie tocó, así que el resumen lo declara en vez de callarlo.
    """
    mp = os.path.join(os.path.dirname(doc), "map.json")
    if not os.path.isfile(mp):
        return None
    try:
        with open(mp) as fh:
            return (json.load(fh).get("verified") or {}).get("date")
    except (OSError, ValueError):
        return None


def etiqueta(doc):
    """Cómo se nombra el documento en la salida: `<carpeta>/<archivo>`.

    La carpeta sola no alcanza (todos los documentos se llaman `doc.md`) y la ruta completa tampoco
    (ocupa media línea y el prefijo se repite en todas)."""
    return f"{os.path.basename(os.path.dirname(doc)) or '.'}/{os.path.basename(doc)}"


def revisar(documentos, idx=None):
    """Valida las citas de esos documentos. Devuelve `(baldes, sin_sello)`.

    `baldes` es {clave: [(dónde, cita, nota)]} con las claves de la lista del docstring de arriba.
    """
    idx = idx or indice()
    baldes = defaultdict(list)
    sin_sello = set()

    for doc in documentos:
        if not os.path.isfile(doc):
            continue
        nombre = etiqueta(doc)
        fecha = sello_de(doc)
        if not fecha:
            sin_sello.add(nombre)

        blame = escrita_en(os.path.relpath(doc, RAIZ))
        with open(doc) as fh:
            lineas = fh.read().splitlines()
        for i, linea in enumerate(lineas, 1):
            donde = f"{nombre}:{i}"
            # cuándo se afirmó esta cita: el sello del documento, o cuándo se escribió la línea si
            # es posterior (ver `escrita_en`). Sin este max, corregir una cita la rompe de nuevo.
            base_cita = max(filter(None, (fecha, blame.get(i))), default=None)

            for m in REF.finditer(linea):
                cita, n = m.group(1), int(m.group(2))
                fin = int(m.group(3)) if m.group(3) else None
                etiq = f"{cita}:{n}" + (f"-{fin}" if fin else "")
                clave, nota = evaluar(cita, n, fin, base_cita, idx)
                baldes[clave].append((donde, etiq, nota))

            # Cortas: se CUENTAN, no se validan (ver el comentario de `CORTA`). Van por documento para
            # que se vea dónde conviene convertirlas a ruta completa.
            for m in CORTA.finditer(linea):
                etiq = f":{m.group(1)}" + (f"-{m.group(2)}" if m.group(2) else "")
                baldes["corta"].append((donde, etiq, "relativa al contexto: fuera del chequeo"))

    return baldes, sin_sello


ORD = [("movida", "⚠ MOVIDAS — el ancla está en otra parte del archivo (viene la corrección)"),
       ("corrida", f"· CORRIDAS ≤{LEVE} líneas — desalineadas pero apuntan al mismo bloque"),
       ("reescrita", "⚠ REESCRITAS — la línea de entonces ya no está: hay que leer y decidir"),
       ("fuera", "⚠ FUERA DE RANGO — la línea no existe"),
       ("ambigua", "? AMBIGUAS — el nombre vive en varios repos y ninguno valida: la corrección "
                   "dependería de cuál se elija"),
       ("sin-ancla", "· SIN ANCLA — solo se verificó que la línea existe (chequeo débil)"),
       ("corta", "? CORTAS `:NNN` — relativas al contexto, FUERA del chequeo: nadie las valida. "
                 "Convertí a ruta completa las que sostengan una afirmación importante"),
       ("no-existe", "? NO EXISTEN en main — artefacto generado / otra rama / herramienta borrada")]


def informe(baldes, sin_sello, ver_ok=False):
    """Imprime los baldes y el resumen. Devuelve el código de salida."""
    for clave, titulo in ORD:
        if not baldes[clave]:
            continue
        print(f"\n{titulo}  ({len(baldes[clave])})")
        cuantas = len(baldes[clave]) if (ver_ok or clave != "sin-ancla") else 12
        for donde, cita, nota in sorted(baldes[clave])[:cuantas]:
            print(f"  {donde:34s} {cita:58s} {nota}")
        if len(baldes[clave]) > cuantas:
            print(f"  … y {len(baldes[clave]) - cuantas} más (--ok para verlas todas)")

    if ver_ok and baldes["ok"]:
        print(f"\n✓ OK ({len(baldes['ok'])})")
        for donde, cita, nota in sorted(baldes["ok"]):
            print(f"  {donde:34s} {cita:58s} {nota}")

    tot = sum(len(v) for v in baldes.values())
    print(f"\n{tot} referencias · ✓ {len(baldes['ok'])} ancladas · ⚠ {len(baldes['movida'])} movidas · "
          f"· {len(baldes['corrida'])} corridas · ⚠ {len(baldes['reescrita'])} reescritas · "
          f"⚠ {len(baldes['fuera'])} fuera · "
          f"· {len(baldes['sin-ancla'])} sin ancla · ? {len(baldes['ambigua'])} ambiguas · "
          f"? {len(baldes['no-existe'])} no existen")
    if baldes["corta"]:
        cortas = len(baldes["corta"])
        validadas = sum(len(baldes[k]) for k in
                        ("ok", "corrida", "movida", "reescrita", "fuera", "sin-ancla"))
        porc = validadas * 100 // (validadas + cortas)
        por_doc = defaultdict(int)
        for donde, _, _ in baldes["corta"]:
            por_doc[donde.rsplit(":", 1)[0]] += 1
        top = " · ".join(f"{n} {c}" for n, c in sorted(por_doc.items(), key=lambda kv: -kv[1])[:5])
        print(f"⚠ {cortas} citas en formato corto `:NNN` quedan FUERA del chequeo → lo de arriba "
              f"cubre el {porc}% de las citas con número de línea. Peores: {top}")
    if sin_sello:
        print(f"⚠ sin `verified.date` al lado (se ancla por `git blame` del documento): "
              f"{', '.join(sorted(sin_sello))}")
    print("Las ambiguas y las que no existen NO son deriva: piden juicio, no arreglo automático.")
    return 1 if (baldes["movida"] or baldes["reescrita"] or baldes["fuera"]) else 0


def main():
    docs = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not docs:
        sys.exit(__doc__.split("USO")[1].strip())
    baldes, sin_sello = revisar(docs)
    return informe(baldes, sin_sello, ver_ok="--ok" in sys.argv)


if __name__ == "__main__":
    sys.exit(main())
