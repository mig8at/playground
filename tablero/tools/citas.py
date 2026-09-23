#!/usr/bin/env python3
"""¿Las referencias `archivo:línea` de un documento siguen apuntando a lo que dicen?

Se le pasan documentos y contesta, cita por cita, si el código que citan sigue donde el documento
dice. Vive acá porque el tablero es quien lo necesita para siempre: las trampas del sistema (`F-xx`)
guardan 149 citas al código de la compañía y sin esto envejecen en silencio.

⚠ NACIÓ EN `context/tools/refs.py` Y SE MUDÓ EL 2026-09-21, cuando el árbol de contexto empezó a
apagarse. No es una copia: es el mismo archivo. Dos motores de citas derivan, y el síntoma de la
deriva sería un verde. La lista de repos y el índice de «qué existe en main» se fueron un paso más
allá, a `tools/repos.py` en la raíz, porque también los usan el trazador y `workers`.

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
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# Los repos, la ref a mirar y el índice de «qué existe en main» viven en la raíz: los necesitan tres
# directorios (este, `trazador` y `workers`) y no son de ninguno. Ver `tools/repos.py`, que explica
# por qué hay UNA sola copia.
sys.path.insert(0, os.path.join(ROOT, "tools"))
from repos import ROOTS, del_ref, ref_a_indexar  # noqa: E402,F401


# Contra qué se compara el «hoy». ⚠ NO ES UNA CONSTANTE, y por eso es una función: la ref correcta se
# decide POR REPO (ver `tools/repos.py`).
def today_ref(alias):
    root = ROOTS.get(alias)
    if not root:
        return "main"
    ref, _ = ref_a_indexar(root)
    return ref or "main"


NEAR = 0        # el ancla es TEXTO EXACTO: o está en esa línea o no está. La tolerancia de ±3 venía
                 # del método viejo (buscaba un símbolo "cerca") y acá miente: con ±3, un bloque
                 # corrido 2 líneas se reportaba como «inicio bien, fin movido» — media verdad.
MINOR = 3         # hasta acá una cita desalineada es «corrida» (el archivo ganó un import arriba) y
                 # no «movida» (apunta a otra parte). Se separan por prioridad, no se esconden.
ANCHOR_MIN = 10   # caracteres no-espacio mínimos. Una línea `}` o `]);` matchea en 200 lugares: como
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
SHORT = re.compile(r'`:(\d+)(?:-(\d+))?`')



def git(repo, *args):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, errors="replace")
    return r.stdout if r.returncode == 0 else None


@lru_cache(maxsize=None)
def repo_of(alias):
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
def sha_at(repo, date):
    """El commit al cierre de ese día — el estado que el nodo dice haber verificado.

    ⚠ `repo` acá es el TOPLEVEL del clon, no un alias, así que la ref se resuelve desde la ruta. Contra
    un `main` local atrasado el «cierre de hoy» cae en un commit de días atrás y toda la comparación se
    corre con él."""
    ref, _ = ref_a_indexar(repo)
    out = git(repo, "rev-list", "-1", f"--before={date} 23:59:59", ref or "main")
    return out.strip() if out and out.strip() else None


@lru_cache(maxsize=None)
def renames(repo, sha):
    """{ruta_hoy: ruta_cuando_se_selló}, siguiendo cadenas (un archivo pudo renombrarse dos veces)."""
    ref, _ = ref_a_indexar(repo)
    out = git(repo, "log", "--diff-filter=R", "-M", "--name-status", "--format=", f"{sha}..{ref or 'main'}")
    direct = {}
    for ln in (out or "").splitlines():
        p = ln.split("\t")
        if len(p) == 3 and p[0].startswith("R"):
            direct[p[2]] = p[1]  # nuevo -> viejo
    def origin(p):
        seen = set()
        while p in direct and p not in seen:
            seen.add(p)
            p = direct[p]
        return p
    return {n: origin(n) for n in direct}


@lru_cache(maxsize=None)
def in_ref(alias, ref, rel):
    """El archivo tal como está en `ref` (por defecto `main`), NO como está en disco.

    ⚠ ESTE ES EL MISMO BUG QUE SE ARREGLÓ EN `oracle.py`, y reapareció acá. Leer el working tree hace
    que el veredicto dependa de **qué rama tengas checkeada**: con una feature branch puesta, tus
    propios cambios sin mergear se reportan como citas movidas. Pasó el 2026-08-03 — 6 líneas agregadas
    a `config/services.php` en una rama de trabajo hicieron aparecer una «movida» en el nodo
    `bancolombia`, y la cita contra `main` estaba perfecta. El árbol describe `main`: se compara
    main-entonces contra main-hoy, y el disco no entra.
    """
    repo, pre = repo_of(alias)
    if not repo:
        return None
    return content(repo, ref, pre + rel)


@lru_cache(maxsize=None)
def content(repo, sha, path):
    out = git(repo, "show", f"{sha}:{path}")
    return tuple(out.splitlines()) if out is not None else None


@lru_cache(maxsize=None)
def written_at(doc):
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
    out = git(ROOT, "blame", "--line-porcelain", "-w", "--", doc)
    dates, ln, ts = {}, None, None
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
            dates[ln] = datetime.fromtimestamp(ts + off, timezone.utc).strftime("%Y-%m-%d")
    return dates


def locate(anchor, today, expected):
    """(línea de hoy más cercana a `esperado`, cuántas coincidencias) · (None, 0) si el ancla no sirve.

    Un ancla corta (`}`, `});`, `return;`) matchea en decenas de lugares: no afirma nada, y tratarla
    como válida inventa correcciones al azar. Se rechaza antes de buscar.
    """
    if len(anchor.replace(" ", "")) < ANCHOR_MIN:
        return None, 0
    hits = [i + 1 for i, l in enumerate(today) if l.strip() == anchor]
    if not hits:
        return None, 0
    return min(hits, key=lambda h: abs(h - expected)), len(hits)


def by_anchor(alias, rel, n, end, date, today):
    """('ok'|'movida'|'reescrita', nota) o None si no se pudo anclar (→ el caller cae al rango)."""
    repo, pre = repo_of(alias)
    if not repo or not date:
        return None
    sha = sha_at(repo, date)
    if not sha:
        return None
    full = pre + rel
    base = content(repo, sha, renames(repo, sha).get(full, full))
    if base is None or n > len(base):
        return None                       # el archivo (o la línea) no existía al sellar
    anchor = base[n - 1].strip()
    if len(anchor.replace(" ", "")) < ANCHOR_MIN:
        return None                       # ancla demasiado corta para afirmar nada
    hits = [i + 1 for i, l in enumerate(today) if l.strip() == anchor]
    if not hits:
        return ("reescrita", f"la línea de entonces ya no está: «{anchor[:56]}»")
    moved = not any(abs(h - n) <= NEAR for h in hits)
    ini = min(hits, key=lambda h: abs(h - n))

    # El fin del rango, si lo hay. NO se calcula como «inicio nuevo + largo viejo»: el bloque pudo
    # crecer por dentro. Se ancla igual que el inicio, y si su ancla no sirve se DICE, en vez de
    # devolver un número inventado que el que corrige va a copiar tal cual.
    tail = ""
    if end and n < end <= len(base):
        f_new, f_cnt = locate(base[end - 1].strip(), today, (ini if moved else n) + (end - n))
        if f_new is None:
            tail = f" · el fin (:{end}) no se ancla («{base[end - 1].strip()[:18]}»): revisalo a mano"
        elif f_cnt > 1:
            tail = f" · fin ≈ :{f_new}, pero ese ancla se repite {f_cnt}×: confirmalo"
        elif moved:
            tail = f" → rango :{ini}-{f_new}"
        elif f_new != end:
            # el inicio no se movió pero el bloque creció: el rango igual quedó mal
            degree = "corrida" if abs(f_new - end) <= MINOR else "movida"
            return (degree, f"{alias}: el inicio :{n} sigue bien, pero el rango termina en :{f_new}")

    if not moved:
        return ("ok", "ancla" + (tail if tail else ""))
    extra = f" (y {len(hits) - 1} coincidencia(s) más)" if len(hits) > 1 else ""
    # Se separa por MAGNITUD, y no es cosmética. Con match exacto aparecen 37 citas desalineadas, pero
    # 31 lo están por 1-3 líneas (el archivo ganó un import arriba) y 6 apuntan a otra parte del
    # archivo. Mezclarlas ahoga las que importan; esconder las chicas bajo una tolerancia es afirmar
    # que una cita es correcta cuando no lo es. Van en baldes distintos y solo las grandes fallan.
    degree = "corrida" if abs(ini - n) <= MINOR else "movida"
    # El alias va SIEMPRE en la corrección: cuando la cita matchea varios repos (`config/app.php`
    # vive en dos, `UserRequestController.php` en cinco), un «está en :178» pelado no dice en cuál
    # se comprobó — y editar el doc a ciegas con ese número es cambiar una cita correcta por otra.
    return (degree, f"{alias}: está en :{ini}{extra}{tail}")


def index(ref=None):
    """Mapas para resolver una cita: por relpath completo y por basename.

    `ref=None` es el modo automático de `oracle.del_ref`: cada repo se mira con la ref que contiene a
    la otra. Un valor explícito se respeta tal cual."""
    existing, _, _ = del_ref(ref)
    by_rel, by_base = defaultdict(list), defaultdict(list)
    for f in existing:
        alias, _, rel = f.partition("/")
        by_rel[rel].append((alias, rel))
        by_base[os.path.basename(rel)].append((alias, rel))
    return existing, by_rel, by_base


def resolver(citation, existing, by_rel, by_base):
    """Devuelve [(alias, relpath)] candidatos para una cita tal como está escrita en el doc."""
    # Los docs eliden tramos con `...` o `…` (`Modules/Risk/.../SistecreditoController.php`). Es un
    # estilo de escritura, no una ruta rota: se toma lo que va DESPUÉS de la última elisión y se
    # resuelve por sufijo. Sin esto, 7 citas válidas caían en "no existe".
    if "..." in citation or "…" in citation:
        citation = re.split(r'(?:\.{3}|…)/?', citation)[-1].lstrip("/")
    # 0) la cita YA trae el alias. Sin este caso primero, el paso 1 le pega otro alias delante y arma
    #    `legacy-backend/legacy-backend/app/...`: no resuelve y el archivo aparece como inexistente.
    if citation in existing:
        alias, _, rel = citation.partition("/")
        return [(alias, rel)]
    # 1) con cada alias por delante — y se RECOLECTAN TODOS, no se devuelve el primero. Devolver el
    #    primero hacía que `config/services.php` resolviera a `legacy-application` (267 líneas) y
    #    reportara como deriva las citas :297/:303/:317, válidas en `legacy-backend` (371). Seis falsos
    #    positivos de una: el mismo archivo vive en dos repos, y elegir por orden del dict es al azar.
    in_alias = [(alias, citation) for alias in ROOTS if f"{alias}/{citation}" in existing]
    if in_alias:
        return in_alias
    if citation in by_rel:
        return by_rel[citation]
    suf = [v for rel, vs in by_rel.items() if rel.endswith("/" + citation) for v in vs]
    if suf:
        return suf
    # el basename SOLO si la cita no traía directorio. Con directorio, caer al basename es
    # mis-resolución: `backend-e2e/main.go` (herramienta borrada) se pegaba al `main.go` de otro repo
    # y salía reportado como "fuera de rango", o sea deriva inventada.
    if "/" in citation:
        return []
    return by_base.get(citation, [])


def evaluate(citation, n, end, citation_base, idx):
    """(balde, nota) para una cita ya resuelta a nombre de archivo. Compartido por el formato
    completo (`ruta/archivo.php:123`) y el corto (`` `:123` `` resuelto contra su contexto)."""
    existing, by_rel, by_base = idx
    cands = resolver(citation, existing, by_rel, by_base)
    if not cands:
        return "no-existe", ""

    verdicts = []
    for alias, rel in sorted({(a, r) for a, r in cands}):
        today = in_ref(alias, today_ref(alias), rel)
        if today is None:
            continue
        today = list(today)
        if n > len(today):
            verdicts.append(("fuera", f"{alias}/{rel}: tiene {len(today)} líneas"))
            continue
        verdicts.append(by_anchor(alias, rel, n, end, citation_base, today)
                          or ("sin-ancla", "solo se verificó que la línea existe"))

    # Con varios candidatos NO se adivina, pero tampoco se tira la toalla: si ALGUNO valida, la cita
    # está bien. Con el ancla esto además DESAMBIGUA solo — el archivo equivocado no contiene ese texto.
    order = ["ok", "corrida", "movida", "reescrita", "sin-ancla", "fuera"]
    if not verdicts:
        return "no-existe", "no se pudo leer"
    key, note = min(verdicts, key=lambda v: order.index(v[0]))

    if len(cands) > 1:
        if key not in ("movida", "reescrita", "fuera"):
            # ALGUNO valida (`ok`/`corrida`), o el chequeo fue débil y NO propone ningún destino
            # (`sin-ancla`). En los dos casos no hay corrección que pueda salir del candidato
            # equivocado, que es lo único que esta rama tiene que evitar. Cuántos había se dice igual,
            # porque saber que el nombre es compartido cambia cómo se lee la cita.
            note += f" · {len(cands)} candidatos"
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
            key = "ambigua"
            detail = " · ".join(f"[{k}] {t}" for k, t in sorted(verdicts, key=lambda v: order.index(v[0])))
            note = f"{len(cands)} candidatos y ninguno valida — {detail}"
    return key, note



# ─── RECORRER DOCUMENTOS ────────────────────────────────────────────────────────────────────────────

def stamp_of(doc):
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


def label(doc):
    """Cómo se nombra el documento en la salida: `<carpeta>/<archivo>`.

    La carpeta sola no alcanza (todos los documentos se llaman `doc.md`) y la ruta completa tampoco
    (ocupa media línea y el prefijo se repite en todas)."""
    return f"{os.path.basename(os.path.dirname(doc)) or '.'}/{os.path.basename(doc)}"


def review(documents, idx=None):
    """Valida las citas de esos documentos. Devuelve `(baldes, sin_sello)`.

    `baldes` es {clave: [(dónde, cita, nota)]} con las claves de la lista del docstring de arriba.
    """
    idx = idx or index()
    buckets = defaultdict(list)
    unstamped = set()

    for doc in documents:
        if not os.path.isfile(doc):
            continue
        name = label(doc)
        date = stamp_of(doc)
        if not date:
            unstamped.add(name)

        blame = written_at(os.path.relpath(doc, ROOT))
        with open(doc) as fh:
            lines = fh.read().splitlines()
        for i, line in enumerate(lines, 1):
            where = f"{name}:{i}"
            # cuándo se afirmó esta cita: el sello del documento, o cuándo se escribió la línea si
            # es posterior (ver `escrita_en`). Sin este max, corregir una cita la rompe de nuevo.
            citation_base = max(filter(None, (date, blame.get(i))), default=None)

            for m in REF.finditer(line):
                citation, n = m.group(1), int(m.group(2))
                end = int(m.group(3)) if m.group(3) else None
                tag = f"{citation}:{n}" + (f"-{end}" if end else "")
                key, note = evaluate(citation, n, end, citation_base, idx)
                buckets[key].append((where, tag, note))

            # Cortas: se CUENTAN, no se validan (ver el comentario de `CORTA`). Van por documento para
            # que se vea dónde conviene convertirlas a ruta completa.
            for m in SHORT.finditer(line):
                tag = f":{m.group(1)}" + (f"-{m.group(2)}" if m.group(2) else "")
                buckets["corta"].append((where, tag, "relativa al contexto: fuera del chequeo"))

    return buckets, unstamped


ORD = [("movida", "⚠ MOVIDAS — el ancla está en otra parte del archivo (viene la corrección)"),
       ("corrida", f"· CORRIDAS ≤{MINOR} líneas — desalineadas pero apuntan al mismo bloque"),
       ("reescrita", "⚠ REESCRITAS — la línea de entonces ya no está: hay que leer y decidir"),
       ("fuera", "⚠ FUERA DE RANGO — la línea no existe"),
       ("ambigua", "? AMBIGUAS — el nombre vive en varios repos y ninguno valida: la corrección "
                   "dependería de cuál se elija"),
       ("sin-ancla", "· SIN ANCLA — solo se verificó que la línea existe (chequeo débil)"),
       ("corta", "? CORTAS `:NNN` — relativas al contexto, FUERA del chequeo: nadie las valida. "
                 "Convertí a ruta completa las que sostengan una afirmación importante"),
       ("no-existe", "? NO EXISTEN en main — artefacto generado / otra rama / herramienta borrada")]


def report(buckets, unstamped, show_ok=False):
    """Imprime los baldes y el resumen. Devuelve el código de salida."""
    for key, title in ORD:
        if not buckets[key]:
            continue
        print(f"\n{title}  ({len(buckets[key])})")
        how_many = len(buckets[key]) if (show_ok or key != "sin-ancla") else 12
        for where, citation, note in sorted(buckets[key])[:how_many]:
            print(f"  {where:34s} {citation:58s} {note}")
        if len(buckets[key]) > how_many:
            print(f"  … y {len(buckets[key]) - how_many} más (--ok para verlas todas)")

    if show_ok and buckets["ok"]:
        print(f"\n✓ OK ({len(buckets['ok'])})")
        for where, citation, note in sorted(buckets["ok"]):
            print(f"  {where:34s} {citation:58s} {note}")

    tot = sum(len(v) for v in buckets.values())
    print(f"\n{tot} referencias · ✓ {len(buckets['ok'])} ancladas · ⚠ {len(buckets['movida'])} movidas · "
          f"· {len(buckets['corrida'])} corridas · ⚠ {len(buckets['reescrita'])} reescritas · "
          f"⚠ {len(buckets['fuera'])} fuera · "
          f"· {len(buckets['sin-ancla'])} sin ancla · ? {len(buckets['ambigua'])} ambiguas · "
          f"? {len(buckets['no-existe'])} no existen")
    if buckets["corta"]:
        short_ones = len(buckets["corta"])
        validated = sum(len(buckets[k]) for k in
                        ("ok", "corrida", "movida", "reescrita", "fuera", "sin-ancla"))
        pct = validated * 100 // (validated + short_ones)
        by_doc = defaultdict(int)
        for where, _, _ in buckets["corta"]:
            by_doc[where.rsplit(":", 1)[0]] += 1
        top = " · ".join(f"{n} {c}" for n, c in sorted(by_doc.items(), key=lambda kv: -kv[1])[:5])
        print(f"⚠ {short_ones} citas en formato corto `:NNN` quedan FUERA del chequeo → lo de arriba "
              f"cubre el {pct}% de las citas con número de línea. Peores: {top}")
    if unstamped:
        print(f"⚠ sin `verified.date` al lado (se ancla por `git blame` del documento): "
              f"{', '.join(sorted(unstamped))}")
    print("Las ambiguas y las que no existen NO son deriva: piden juicio, no arreglo automático.")
    return 1 if (buckets["movida"] or buckets["reescrita"] or buckets["fuera"]) else 0


def main():
    docs = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not docs:
        sys.exit(__doc__.split("USO")[1].strip())
    buckets, unstamped = review(docs)
    return report(buckets, unstamped, show_ok="--ok" in sys.argv)


if __name__ == "__main__":
    sys.exit(main())
