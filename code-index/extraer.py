#!/usr/bin/env python3
"""extraer — genera los NODESLITE de un repo: qué hay en cada archivo, compactado y con presupuesto.

    python3 extraer.py legacy-backend --ruta Modules/Loans
    python3 extraer.py legacy-backend --agrupar 2            # ZOOM: la forma del repo en 10 líneas
    python3 extraer.py pdf-mapper-service --lang go
    python3 extraer.py frontend-monorepo --lang ts --prof 3  # solo TS, hasta 3 niveles
    python3 extraer.py legacy-backend --ruta Modules/Loans --json > nodos.json

TRES FORMAS DE ACOTAR, y sirven para cosas distintas:
  --lang     un corte por stack: `go`, `php`, `ts`, `front`, `infra`… (varios con coma)
  --prof N   filtra a N niveles de carpeta, RELATIVOS a --ruta
  --agrupar N  no filtra: hace ZOOM. En vez de archivos devuelve carpetas a N niveles con lo que
             tienen adentro. Es la vista que un repo de miles de archivos necesita para entenderse:
             `legacy-backend --agrupar 2` lo resume entero en diez líneas y 1,3 segundos.

QUÉ ES UN NODOLITE — por archivo, y nada más que esto:

    p  ruta        ·  l  líneas
    i  imports     ·  d  definiciones (clases, funciones, interfaces)
    r  rutas HTTP  ·  x  infra (docker, terraform, workflows)

Las claves son de UNA LETRA a propósito: esto se le pasa a un modelo, y `"path"` repetido 3.000 veces
son 12 KB de nada. Es el mismo criterio que el resto del proyecto — el índice existe para que alguien
ELIJA, así que lo que no ayuda a elegir, no va.

CÓMO SE RECORTA (el corazón, y lo que lo hace usable): no se manda todo. Cada archivo se PUNTÚA por
cuánta estructura tiene, se ordena por puntaje, y se llena hasta un presupuesto en KB. Un archivo con
rutas y clases entra antes que uno con dos funciones sueltas, y cuando se acaba el presupuesto se
corta — pero se dice cuánto quedó afuera, que es la diferencia entre recortar y mentir.

    rutas ×12 · clases ×6 · imports ×3 · funciones ×1 · infra ×8
    +10 si es `service`/`controller`  ·  +12 si es un archivo de rutas  ·  +15 si es infra pura

⚠ SÓLO CÓDIGO E INFRA. Nada de `.md`: la prosa se lee, no se extrae, y son justo los archivos que
revientan la ventana (el `NEW_ARCHITECTURE.md` de legacy-backend pesa 163 KB él solo).

⚠ Y se lee de `main`, no del working tree: los repos reales trabajan en ramas.

El algoritmo está portado de `carto` (Rust, `src-tauri/src/extraction` + `ai/payload_builder.rs`),
adaptado a los lenguajes de CreditOp: PHP/Laravel, TypeScript/React y Go.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ.parent / "context" / "tools"))
from roots import ROOTS  # noqa: E402

CODIGO = {"php", "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "go", "py", "rs"}
INFRA_EXT = {"tf", "tfvars"}
INFRA_NOMBRE = ("dockerfile", "docker-compose", "taskfile", "makefile", ".github/workflows/")
IGNORAR = ("node_modules/", "vendor/", "dist/", "build/", ".turbo/", "coverage/",
           "/migrations/", ".min.js", "-lock.",
           # ⚠ Los tests van afuera, y hay que nombrar las TRES convenciones: sin `_test.go`, los
           # tests de Go rankeaban ARRIBA del código que prueban (client_test.go 109 vs client.go 82)
           # — tienen más definiciones porque cada caso es una función.
           "/tests/", "/test/", ".spec.", ".test.", "_test.go", "test_")
# ⚠ Y los que arrancan en la RAÍZ del repo: `tests/Unit/…` no empieza con "/tests/",
# así que el filtro de arriba lo dejaba pasar y los tests aparecían en el zoom.
IGNORAR_PREFIJO = ("tests/", "test/", "docs/", "database/seeders/")

# ── patrones, por lenguaje ───────────────────────────────────────────────────────────────────────
IMPORTS = {
    "php": [re.compile(r"^use\s+([\w\\]+)", re.M)],
    "go": [re.compile(r'^\s*(?:[\w.]+\s+)?"([^"]+)"', re.M)],
    "js": [re.compile(r"""(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]"""),
           re.compile(r"""require\s*\(\s*['"]([^'"]+)['"]\s*\)"""),
           re.compile(r"""import\s*\(\s*['"]([^'"]+)['"]\s*\)""")],
}
DEFINICIONES = {
    "php": [re.compile(r"^\s*(?:final\s+|abstract\s+)?class\s+(\w+)", re.M),
            re.compile(r"^\s*interface\s+(\w+)", re.M),
            re.compile(r"^\s*(?:public|protected|private)?\s*(?:static\s+)?function\s+(\w+)", re.M)],
    "go": [re.compile(r"^func\s+(?:\([^)]*\)\s*)?(\w+)", re.M),
           re.compile(r"^type\s+(\w+)\s+(?:struct|interface)", re.M)],
    "js": [re.compile(r"^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)", re.M),
           re.compile(r"^\s*export\s+(?:const|let)\s+(\w+)"),
           re.compile(r"^\s*(?:export\s+)?class\s+(\w+)", re.M),
           re.compile(r"^\s*(?:export\s+)?interface\s+(\w+)", re.M),
           re.compile(r"^\s*(?:export\s+)?type\s+(\w+)\s*=", re.M)],
}
# Rutas: el enfoque de carto — buscar strings entre comillas que parezcan camino, y el verbo cerca.
CANDIDATA = re.compile(r"""['"`]((?:/[\w\-.$#{}:*]+)+)['"`]""")
VERBO = re.compile(r"\b(get|post|put|delete|patch|options)\b", re.I)
PARAM = re.compile(r"\{[^}]+\}|:\w+")


def _lenguaje(ruta):
    ext = ruta.rsplit(".", 1)[-1].lower() if "." in ruta else ""
    if ext == "php":
        return "php", ext
    if ext == "go":
        return "go", ext
    if ext in {"ts", "tsx", "js", "jsx", "mjs", "cjs", "vue"}:
        return "js", ext
    return None, ext


def _es_infra(ruta):
    bajo = ruta.lower()
    return (bajo.rsplit(".", 1)[-1] in INFRA_EXT) or any(n in bajo for n in INFRA_NOMBRE)


def _rutas_http(texto, ruta):
    """Rutas HTTP declaradas o consumidas. Devuelve strings tipo 'POST /api/loans/{id}'."""
    fuera = set()
    for linea in texto.splitlines():
        s = linea.strip()
        if s.startswith(("//", "*", "#", "/*")):
            continue
        for m in CANDIDATA.finditer(linea):
            camino = m.group(1)
            # Descarta lo que parece camino pero no lo es: imports relativos, rutas de disco, globs.
            if len(camino) < 4 or camino.count("/") > 6 or " " in camino:
                continue
            # Un asset no es un endpoint: `/resources/assets/js/app.js` salía como ruta.
            if camino.startswith(("//", "/*")) or camino.endswith(
                    (".ts", ".tsx", ".js", ".jsx", ".vue", ".php", ".css", ".scss",
                     ".png", ".svg", ".jpg", ".ico", ".woff", ".woff2", ".map", ".json")):
                continue
            verbo = VERBO.search(linea)
            metodo = verbo.group(1).upper() if verbo else "?"
            # ⚠ QUÉ CLASE DE RUTA ES — portado del `kind` de carto, y sin esto el cruce entre repos
            # no sirve: el front devuelve rutas de NAVEGACIÓN (`/merchant/{}/lenders/{}`) y el backend
            # rutas de API (`/v1/lender-attempts`). Comparar unas con otras da cero y parece que no se
            # hablan, cuando lo que pasa es que se estaban comparando peras con manzanas.
            norm = PARAM.sub("{}", camino).replace("${}", "{}")
            es_api = bool(verbo) or norm.startswith(("/api/", "/v1/", "/v2/")) or "/api/" in norm
            fuera.add(f"{metodo} {norm}" if es_api else f"UI {norm}")
        if len(fuera) > 40:
            break
    return sorted(fuera)


def extraer_uno(ruta, texto):
    """Un NodoLite. `ruta` es alias/relpath; `texto` el contenido en main."""
    lang, ext = _lenguaje(ruta)
    infra = _es_infra(ruta)
    if not lang and not infra:
        return None

    lineas = texto.count("\n") + 1
    imports, defs = [], []
    if lang:
        for rx in IMPORTS.get(lang, []):
            imports.extend(rx.findall(texto))
        for rx in DEFINICIONES.get(lang, []):
            defs.extend(rx.findall(texto))
    # Los imports propios (relativos o del monorepo) valen; los de librería son ruido.
    imports = sorted({i for i in imports if i.startswith((".", "@creditop", "App\\", "Modules\\"))})[:25]
    defs = sorted({d for d in defs if d and not d.startswith("_")})[:30]
    rutas = _rutas_http(texto, ruta) if (lang or infra) else []

    señales = []
    if infra:
        señales.append(ruta.rsplit("/", 1)[-1])

    nodo = {"p": ruta, "l": lineas}
    if imports:
        nodo["i"] = imports
    if defs:
        nodo["d"] = defs
    if rutas:
        nodo["r"] = rutas[:15]
    if señales:
        nodo["x"] = señales
    return nodo


def puntuar(nodo):
    """Cuánta ESTRUCTURA tiene el archivo. Portado de `payload_builder.rs` de carto."""
    p = nodo["p"].lower()
    n = (len(nodo.get("r", [])) * 12
         + len(nodo.get("d", [])) * 3
         + len(nodo.get("i", [])) * 3
         + len(nodo.get("x", [])) * 8)
    if "service" in p or "controller" in p:
        n += 10
    if "/routes/" in p or p.endswith(("routes.ts", "api.php", "web.php")):
        n += 12
    if _es_infra(nodo["p"]):
        n += 15
    return n


def _blobs(alias, subruta="", tope_archivos=4000):
    """Lee de `main` los archivos que nos interesan. Usa `git cat-file --batch`: un solo proceso para
    miles de archivos, en vez de un `git show` por cada uno (que tardaba minutos)."""
    root = ROOTS.get(alias)
    if not root or not Path(root).is_dir():
        return []
    r = subprocess.run(["git", "-C", root, "ls-tree", "-r", "main"] + ([subruta] if subruta else []),
                       capture_output=True, text=True, timeout=180)
    quiero = []
    for linea in r.stdout.splitlines():
        try:
            meta, camino = linea.split("\t", 1)
            sha = meta.split()[2]
        except (ValueError, IndexError):
            continue
        bajo = camino.lower()
        if any(x in bajo for x in IGNORAR) or bajo.startswith(IGNORAR_PREFIJO):
            continue
        ext = bajo.rsplit(".", 1)[-1] if "." in bajo else ""
        if ext in CODIGO or _es_infra(camino):
            quiero.append((sha, camino))
    quiero = quiero[:tope_archivos]
    if not quiero:
        return []

    p = subprocess.Popen(["git", "-C", root, "cat-file", "--batch"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    salida, _ = p.communicate(("\n".join(s for s, _ in quiero) + "\n").encode(), timeout=300)

    fuera, pos = [], 0
    for _, camino in quiero:
        nl = salida.find(b"\n", pos)
        if nl == -1:
            break
        cab = salida[pos:nl].split()
        if len(cab) < 3:
            break
        largo = int(cab[2])
        cuerpo = salida[nl + 1:nl + 1 + largo]
        pos = nl + 1 + largo + 1
        fuera.append((camino, cuerpo.decode("utf-8", "replace")))
    return fuera


LENGUAJES = {  # alias amable → extensiones reales
    "php": {"php"}, "go": {"go"}, "py": {"py"}, "rust": {"rs"},
    "ts": {"ts", "tsx"}, "js": {"js", "jsx", "mjs", "cjs"}, "vue": {"vue"},
    "front": {"ts", "tsx", "js", "jsx", "mjs", "cjs", "vue"},
    "infra": set(),  # se resuelve por nombre, no por extensión
}


def _es_del_lenguaje(ruta, langs):
    if not langs:
        return True
    if "infra" in langs and _es_infra(ruta):
        return True
    ext = ruta.rsplit(".", 1)[-1].lower() if "." in ruta else ""
    return any(ext in LENGUAJES.get(l, {l}) for l in langs)


def _profundidad(rel, base=""):
    """Cuántos niveles de carpeta tiene una ruta, RELATIVOS a `base`. Relativo y no absoluto porque
    es lo que espera quien pide `--ruta Modules/Loans --prof 2`: dos niveles DESDE ahí."""
    if base and rel.startswith(base.rstrip("/") + "/"):
        rel = rel[len(base.rstrip("/")) + 1:]
    return rel.count("/")


def agrupar(nodos, alias, base, niveles):
    """ZOOM: en vez de archivos, carpetas a `niveles` de profundidad, con lo que hay adentro.

    Es la vista que le falta a un repo grande: `legacy-backend` tiene miles de archivos y nadie los
    entiende de a uno, pero agrupado a 2 niveles se ve la forma en veinte líneas.
    """
    cajas = {}
    for n in nodos:
        rel = n["p"].split("/", 1)[1]
        corto = rel[len(base.rstrip("/")) + 1:] if base and rel.startswith(base.rstrip("/") + "/") else rel
        partes = corto.split("/")
        clave = "/".join(partes[:niveles]) if len(partes) > niveles else "/".join(partes[:-1]) or "."
        if base:
            clave = f"{base.rstrip('/')}/{clave}" if clave != "." else base.rstrip("/")
        c = cajas.setdefault(clave, {"carpeta": clave, "archivos": 0, "lineas": 0,
                                     "rutas": [], "defs": 0, "puntaje": 0})
        c["archivos"] += 1
        c["lineas"] += n["l"]
        c["defs"] += len(n.get("d", []))
        c["rutas"].extend(n.get("r", []))
        c["puntaje"] += puntuar(n)
    for c in cajas.values():
        c["rutas"] = sorted(set(c["rutas"]))[:4]
    return sorted(cajas.values(), key=lambda c: -c["puntaje"])


def extraer(alias, subruta="", tope_kb=60, langs=None, prof=0, guardar_textos=None):
    """Los nodoslite de un repo (o de una subruta), recortados a un presupuesto.

    `guardar_textos`: si le pasás un dict, queda {relpath: contenido} — para que la capa de CreditOp
    analice el negocio sin volver a pedirle los blobs a git."""
    nodos, descartados = [], {"lenguaje": 0, "profundidad": 0}
    for camino, texto in _blobs(alias, subruta):
        if guardar_textos is not None:
            guardar_textos[camino] = texto
        if not _es_del_lenguaje(camino, langs):
            descartados["lenguaje"] += 1
            continue
        if prof and _profundidad(camino, subruta) > prof:
            descartados["profundidad"] += 1
            continue
        n = extraer_uno(f"{alias}/{camino}", texto)
        if n and (n.get("d") or n.get("r") or n.get("i") or n.get("x")):
            nodos.append(n)

    nodos.sort(key=puntuar, reverse=True)
    presupuesto, usado, dentro = tope_kb * 1024, 0, []
    for n in nodos:
        cuesta = len(json.dumps(n, ensure_ascii=False))
        if usado + cuesta > presupuesto:
            continue
        dentro.append(n)
        usado += cuesta
    return {
        "repo": alias, "subruta": subruta or "(todo)",
        "lenguajes": sorted(langs) if langs else "todos",
        "profundidad_max": prof or None,
        "encontrados": len(nodos), "entregados": len(dentro),
        "descartados": {k: v for k, v in descartados.items() if v},
        "kb": round(usado / 1024, 1), "tope_kb": tope_kb,
        "nodos": dentro,
    }


def imprimir(d, zoom=0):
    """La vista legible. Vive acá y no en el CLI porque es parte de la herramienta, no del parseo."""
    filtros = []
    if d["lenguajes"] != "todos":
        filtros.append(f"lang={','.join(d['lenguajes'])}")
    if d["profundidad_max"]:
        filtros.append(f"prof<={d['profundidad_max']}")
    cab = f"  ·  {' · '.join(filtros)}" if filtros else ""

    if zoom:
        print(f"\n> {d['repo']} · {d['subruta']} — agrupado a {zoom} nivel(es){cab}\n")
        for c in d["carpetas"][:25]:
            print(f"  [{c['puntaje']:>5}] {c['carpeta']}/   "
                  f"{c['archivos']} archivos · {c['lineas']:,} lineas · {c['defs']} defs")
            if c["rutas"]:
                print(f"           rutas: {' · '.join(c['rutas'][:3])}")
        if len(d["carpetas"]) > 25:
            print(f"\n  ! {len(d['carpetas']) - 25} carpetas mas, no mostradas.")
        print()
        return 0

    print(f"\n> {d['repo']} · {d['subruta']} — {d['entregados']}/{d['encontrados']} archivos "
          f"· {d['kb']} KB de {d['tope_kb']} KB{cab}\n")
    for n in d["nodos"][:30]:
        marcas = []
        if n.get("r"):
            marcas.append(f"{len(n['r'])} rutas")
        if n.get("d"):
            marcas.append(f"{len(n['d'])} defs")
        if n.get("i"):
            marcas.append(f"{len(n['i'])} imports")
        if n.get("x"):
            marcas.append("infra")
        print(f"  [{puntuar(n):>3}] {n['p'].split('/', 1)[1]}  ({n['l']} lineas · {' · '.join(marcas)})")
        if n.get("cx"):
            import creditop
            linea = creditop.resumen(n["cx"])
            if linea:
                print(f"        {linea}")
        if n.get("r"):
            print(f"        rutas: {' · '.join(n['r'][:3])}")
    if d["encontrados"] > d["entregados"]:
        print(f"\n  ! {d['encontrados'] - d['entregados']} archivos quedaron fuera del presupuesto. "
              f"Subi --tope o acota con --ruta. (Recortar y decirlo; nunca recortar en silencio.)")
    print()
    return 0


# La entrada de consola es `cli.py`: este modulo es la LOGICA y se importa.


# ── cruce de rutas entre repos ───────────────────────────────────────────────────────────────────
def _es_api(r):
    """Una ruta cruzable: la de API. Las de navegación (UI) se marcan y no se cruzan por default."""
    return not r.startswith("UI ")


def _solo_camino(r):
    """'POST /api/x/{}' → '/api/x/{}'. El VERBO se descarta para cruzar: la detección de método es
    débil (sale de buscar el verbo cerca en la misma línea) y descartar por un '?' perdería matches
    ciertos. El camino sí es confiable."""
    return r.split(" ", 1)[1] if " " in r else r


def cruzar_rutas(aliases, sufijo_min=2, tope_kb=10_000, solo_api=True):
    """Qué rutas HTTP aparecen en MÁS DE UN repo. Es el mapa de quién le habla a quién.

    ⚠ No alcanza con comparar caminos iguales: el front pide
    `/api/onboarding/loan-application/lenders-v2/{}` y el backend la declara como `lenders-v2/{}`
    adentro de un grupo con prefijo. Por eso el cruce es por SUFIJO — comparten los últimos N
    segmentos — que es como se ven de verdad las dos puntas de una misma llamada.
    """
    porRepo = {}
    for a in aliases:
        d = extraer(a, "", tope_kb)
        caminos = {}
        for n in d["nodos"]:
            for r in n.get("r", []):
                if solo_api and not _es_api(r):
                    continue
                c = _solo_camino(r)
                segs = [s for s in c.split("/") if s]
                if len(segs) < sufijo_min:
                    continue
                clave = segs[-sufijo_min:]
                # ⚠ Un sufijo de puros parámetros (`/{}/{}`) matchea CUALQUIER cosa con cualquier
                # cosa: es la coincidencia falsa clásica. Se exige al menos un segmento literal.
                if not any(s != "{}" for s in clave):
                    continue
                caminos.setdefault("/".join(clave), []).append((c, n["p"]))
        porRepo[a] = caminos

    coincidencias = []
    for clave in set().union(*(set(c) for c in porRepo.values())) if porRepo else []:
        donde = {a: porRepo[a][clave] for a in aliases if clave in porRepo[a]}
        if len(donde) < 2:
            continue
        coincidencias.append({
            "sufijo": "/" + clave,
            "repos": list(donde),
            "puntas": {a: sorted({f"{c}  ←  {p.split('/', 1)[1]}" for c, p in v})[:3]
                       for a, v in donde.items()},
        })
    coincidencias.sort(key=lambda x: (-len(x["repos"]), x["sufijo"]))
    # Cuántas rutas aportó cada repo: si uno trae 0, el «ninguna» es porque ese repo no declara
    # rutas de esa clase — no porque no se hablen. Decirlo evita la conclusión equivocada.
    aporte = {a: len(porRepo[a]) for a in aliases}
    return {"repos": list(aliases), "sufijo_min": sufijo_min, "solo_api": solo_api,
            "rutas_por_repo": aporte, "coincidencias": coincidencias, "cuantas": len(coincidencias)}


def imprimir_cruce(d, tope=25):
    print(f"\n> rutas compartidas entre {' + '.join(d['repos'])} "
          f"(coinciden los ultimos {d['sufijo_min']} segmentos)\n")
    print(f"  rutas {'de API' if d['solo_api'] else '(API + UI)'} que aporto cada uno: "
          + " · ".join(f"{a}: {n}" for a, n in d["rutas_por_repo"].items()) + "\n")
    if not d["cuantas"]:
        vacios = [a for a, n in d["rutas_por_repo"].items() if not n]
        if vacios:
            print(f"  ninguna, y la razon es que {' y '.join(vacios)} no aporto ninguna ruta de API.")
            print("  Probá con --con-ui, o es que ese repo arma sus llamadas en otro lado (un cliente")
            print("  con base URL, un SDK generado). NO concluyas que no se hablan.\n")
        else:
            print("  ninguna. O no se hablan, o lo hacen por otra via (cola, evento, SDK).\n")
        return 0
    for c in d["coincidencias"][:tope]:
        print(f"  {c['sufijo']}   [{' + '.join(c['repos'])}]")
        for a, puntas in c["puntas"].items():
            for p in puntas:
                print(f"      {a}: {p}")
    if d["cuantas"] > tope:
        print(f"\n  ! {d['cuantas'] - tope} coincidencias mas, no mostradas.")
    print()
    return 0
