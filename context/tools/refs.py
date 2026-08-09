#!/usr/bin/env python3
"""¿Las referencias `archivo:línea` de los docs siguen apuntando a lo que dicen?

CÓMO LO SABE: el ANCLA DE GIT, no el símbolo de la prosa.

La versión anterior buscaba en el texto del doc un símbolo en backticks pegado a la cita y verificaba
que estuviera cerca de la línea. **Nunca funcionó ni una vez.** La cita misma va entre backticks
(`` `routes/customer.php:236-239` ``), así que lo que hay justo antes es el backtick de APERTURA y la
regex jamás cerraba par. Medido el 2026-07-31: de 889 citas «ok», **889 eran solo chequeo de rango**
—«el archivo tiene al menos 236 líneas»— y CERO habían comprobado un símbolo. Una cita corrida seis
líneas pasó en verde y se selló un nodo con ella.

Y emparejar la cita con el símbolo contiguo TAMPOCO se puede: los docs no tienen convención fija —a
veces va antes, a veces después, y muchas veces lo de al lado es una celda de tabla o un string de
ruta—. Al probarlo, los matches agarraban el símbolo equivocado. Forzarlo produce «movidas» falsas,
que es peor que no chequear: te manda a arreglar lo que está bien.

Lo confiable no está en la prosa, está en git:

  1. ¿cuándo se afirmó esta cita? `max(sello del nodo, fecha en que se escribió esa línea del doc)`
     — el sello sale de `map.json` → `verified.date`, la otra de `git blame` sobre el propio doc.
     El `max` NO es un detalle: sin él, corregir una cita la vuelve a romper (ver `escrita_en`);
  2. se abre el archivo citado en `main` **a esa fecha** y se guarda el TEXTO de la línea — el ancla;
  3. se busca ese texto en `main` hoy → si está en otra línea, se dice en cuál.

Sin convención que imponer, sin adivinar, y funciona igual para las citas sin símbolo (la mayoría).
Sigue renombres: un archivo pudo cambiar de ruta desde entonces —pasó con `frontend-e2e/` →
`harness/` el 2026-07-31— y sin seguirlos todas las citas de ese nodo dirían «no existía».

BALDES, y separarlos es lo que hace que se le pueda creer:
  ✓ ok         el ancla sigue exactamente en esa línea.
  · corrida    desalineada ≤3 líneas: el bloque es el mismo, el archivo ganó algo arriba. No falla.
  ⚠ movida     el ancla está en OTRA línea → viene el número correcto. No marca: corrige.
  ⚠ reescrita  el ancla ya no está en el archivo: la línea se editó o se borró. Pide leer.
  ⚠ fuera      la línea no existe: el archivo tiene menos líneas.
  · sin ancla  NO se pudo anclar (línea en blanco al sellar, ancla demasiado corta para ser única, el
               archivo no existía, o el nodo no tiene sello). Se cae al chequeo de rango, que es
               débil — y por eso va en su propio balde en vez de disfrazarse de ✓.
  ? ambigua    el nombre matchea varios archivos y ninguno valida.
  ? corta      `` `:123` `` relativa al contexto: NADIE la valida. Son la mitad de las citas con
               número de línea del árbol, así que el resumen las declara — un verde que cubre el 50 %
               y no lo dice es la misma trampa que el chequeo débil de antes. Se arreglan escribiendo
               la ruta completa; por qué no se resuelven solas, en el comentario de `CORTA`.
  ? no existe  ningún archivo matchea en `main`.

USO
  python3 tools/refs.py                 → todos los nodos
  python3 tools/refs.py <nodo> [<nodo>] → solo esos
  python3 tools/refs.py --ok            → lista también las que están bien

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle import del_ref  # misma definición de "qué existe en main" que el oráculo
from roots import ROOTS

CTX = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(CTX, "server", "data", "flows")
REF_HOY = "main"  # contra qué se compara el "hoy": el árbol describe main, no tu working tree
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
    """El commit de `main` al cierre de ese día — el estado que el nodo dice haber verificado."""
    out = git(repo, "rev-list", "-1", f"--before={fecha} 23:59:59", "main")
    return out.strip() if out and out.strip() else None


@lru_cache(maxsize=None)
def renombres(repo, sha):
    """{ruta_hoy: ruta_cuando_se_selló}, siguiendo cadenas (un archivo pudo renombrarse dos veces)."""
    out = git(repo, "log", "--diff-filter=R", "-M", "--name-status", "--format=", f"{sha}..main")
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
    out = git(CTX, "blame", "--line-porcelain", "-w", "--", doc)
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


def indice(ref="main"):
    """Mapas para resolver una cita: por relpath completo y por basename."""
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
        hoy = en_ref(alias, REF_HOY, rel)
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
    if clave in ("reescrita", "fuera") and len(cands) > 1:
        clave, nota = "ambigua", f"{len(cands)} candidatos y ninguno valida: {nota}"
    elif len(cands) > 1:
        nota += f" · {len(cands)} candidatos"
    return clave, nota


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ver_ok = "--ok" in sys.argv
    idx = indice()
    existen, por_rel, por_base = idx

    nodos = args or sorted(os.listdir(FLOWS))
    baldes = defaultdict(list)
    sin_sello = set()

    for nid in nodos:
        doc = os.path.join(FLOWS, nid, "doc.md")
        if not os.path.isfile(doc):
            continue
        mp = os.path.join(FLOWS, nid, "map.json")
        fecha = None
        if os.path.isfile(mp):
            fecha = ((json.load(open(mp)).get("verified") or {}).get("date"))
        if not fecha:
            sin_sello.add(nid)

        blame = escrita_en(os.path.relpath(doc, CTX))
        for i, linea in enumerate(open(doc).read().splitlines(), 1):
            donde = f"{nid}/doc.md:{i}"
            # cuándo se afirmó esta cita: el sello del nodo, o cuándo se escribió la línea si
            # es posterior (ver `escrita_en`). Sin este max, corregir una cita la rompe de nuevo.
            base_cita = max(filter(None, (fecha, blame.get(i))), default=None)

            for m in REF.finditer(linea):
                cita, n = m.group(1), int(m.group(2))
                fin = int(m.group(3)) if m.group(3) else None
                etiq = f"{cita}:{n}" + (f"-{fin}" if fin else "")
                clave, nota = evaluar(cita, n, fin, base_cita, idx)
                baldes[clave].append((donde, etiq, nota))

            # Cortas: se CUENTAN, no se validan (ver el comentario de `CORTA`). Van por nodo para
            # que se vea dónde conviene convertirlas a ruta completa.
            for m in CORTA.finditer(linea):
                etiq = f":{m.group(1)}" + (f"-{m.group(2)}" if m.group(2) else "")
                baldes["corta"].append((donde, etiq, "relativa al contexto: fuera del chequeo"))

    ORD = [("movida", "⚠ MOVIDAS — el ancla está en otra parte del archivo (viene la corrección)"),
           ("corrida", f"· CORRIDAS ≤{LEVE} líneas — desalineadas pero apuntan al mismo bloque"),
           ("reescrita", "⚠ REESCRITAS — la línea de entonces ya no está: hay que leer y decidir"),
           ("fuera", "⚠ FUERA DE RANGO — la línea no existe"),
           ("ambigua", "? AMBIGUAS — el nombre matchea varios archivos, no se puede afirmar"),
           ("sin-ancla", "· SIN ANCLA — solo se verificó que la línea existe (chequeo débil)"),
           ("corta", "? CORTAS `:NNN` — relativas al contexto, FUERA del chequeo: nadie las valida. "
                     "Convertí a ruta completa las que sostengan una afirmación importante"),
           ("no-existe", "? NO EXISTEN en main — artefacto generado / otra rama / herramienta borrada")]
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
        por_nodo = defaultdict(int)
        for donde, _, _ in baldes["corta"]:
            por_nodo[donde.split("/")[0]] += 1
        top = " · ".join(f"{n} {c}" for n, c in sorted(por_nodo.items(),
                                                       key=lambda kv: -kv[1])[:5])
        print(f"⚠ {cortas} citas en formato corto `:NNN` quedan FUERA del chequeo → lo de arriba "
              f"cubre el {porc}% de las citas con número de línea. Peores nodos: {top}")
    if sin_sello:
        print(f"⚠ sin `verified.date` en map.json (no se pueden anclar): {', '.join(sorted(sin_sello))}")
    print("Las ambiguas y las que no existen NO son deriva: piden juicio, no arreglo automático.")
    return 1 if (baldes["movida"] or baldes["reescrita"] or baldes["fuera"]) else 0


if __name__ == "__main__":
    sys.exit(main())
