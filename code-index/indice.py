#!/usr/bin/env python3
"""code-index — el índice de los PROYECTOS: qué es cada repo, cómo se ensambla y por dónde entrar.

    python3 indice.py ver [alias]        # legible: para leer o para pasárselo a un agente
    python3 indice.py subramas <alias>   # las unidades de adentro (workspaces, módulos), de main
    python3 indice.py puente             # cobertura del árbol de negocio por repo
    python3 indice.py check              # ¿todas las rutas existen en main?

POR QUÉ VIVE APARTE DE `context/` — son dos preguntas distintas y se notó al chocar dos veces:
`context/` contesta «cómo FUNCIONA CreditOp» (negocio, entra por síntoma); esto contesta «cómo están
CONSTRUIDOS los proyectos» (arquitectura, entra por repo). Y las reglas difieren: `oracle.py` dropea
`.md`, `.sql` y `.yaml` a propósito, porque el mapa de un nodo indexa CÓDIGO; acá el `composer.json`,
el `turbo.json`, el `openapi.yaml` y el ADR **son** la respuesta. Distinta pregunta, distinta regla,
validador propio — que es este archivo.

LA DEPENDENCIA VA EN UN SOLO SENTIDO: este proyecto lee `context/` (su `roots.py` y sus `map.json`),
y `context/` no sabe que esto existe. Misma regla que la del tablero con los nodos: el enlace
unidireccional evita que al mover una pieza quede la otra mintiendo.

`check` sale 1 si hay rutas muertas: un índice que apunta a un archivo que ya no está es peor que no
tenerlo, porque un modelo lo abre, no lo encuentra, y concluye cualquier cosa.
"""
import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
CONTEXT = RAIZ.parent / "context"

# La tabla alias→repo NO se copia: se importa de su fuente única, que vive en context/tools. El propio
# `roots.py` explica por qué tenerla dos veces «no falla, sólo da veredictos equivocados».
sys.path.insert(0, str(CONTEXT / "tools"))
from roots import ROOTS  # noqa: E402

INDICE = RAIZ / "repos.json"


def cargar():
    return json.loads(INDICE.read_text(encoding="utf-8"))


def _existe_en_main(alias, rel):
    """¿La ruta está en `main`? Contra main y no contra el working tree, como todo el árbol: los repos
    reales trabajan en ramas, y un archivo que sólo existe en la tuya daría un falso OK."""
    root = ROOTS.get(alias)
    if not root or not Path(root).is_dir():
        return None  # repo no clonado: ni OK ni DROP, se declara aparte
    r = subprocess.run(["git", "-C", root, "cat-file", "-e", f"main:./{rel}"],
                       capture_output=True, text=True, timeout=30)
    return r.returncode == 0


def nodos_por_repo():
    """EL PUENTE entre los dos árboles: qué nodos de contexto describen cada repo.

    No se escribe a mano y no se guarda: se deriva. Cada `map.json` ya lista sus archivos como
    `alias/relpath`, así que la pertenencia repo→nodo está en los datos desde siempre — sólo faltaba
    leerla al revés. Un nodo nuevo aparece acá solo; uno que deja de tocar un repo, desaparece solo.

    Devuelve {alias: [(nodo, cuántos archivos de ese repo cita), …]}, ordenado por peso: el primero es
    el nodo que más habla de ese repo.
    """
    flows = CONTEXT / "server" / "data" / "flows"
    porRepo = {}
    for d in sorted(p for p in flows.iterdir() if p.is_dir()):
        m = d / "map.json"
        if not m.is_file():
            continue
        try:
            files = json.loads(m.read_text(encoding="utf-8")).get("files", [])
        except json.JSONDecodeError:
            continue
        cuenta = {}
        for f in files:
            if "/" in f:
                cuenta[f.split("/", 1)[0]] = cuenta.get(f.split("/", 1)[0], 0) + 1
        for alias, n in cuenta.items():
            porRepo.setdefault(alias, []).append((d.name, n))
    return {a: sorted(v, key=lambda x: -x[1]) for a, v in porRepo.items()}


def buscar(que_necesito, tope=12):
    """EL BUSCADOR: describí lo que necesitás y te devuelve archivos, sin tener que saber rutas.

    Por qué no hashes cortos: se midió (2026-08-15). Las rutas son el 8% de abrir un nodo y el 1,6% de
    lo que acumula una corrida — el peso son los `doc.md`. Y sobre todo, **la ruta es la señal con la
    que se elige**: un nombre de archivo dice qué hay adentro ANTES de abrirlo, y un identificador
    opaco obliga a abrirlo para averiguarlo. Gastaría más. Lo que sí faltaba es esto: buscar por
    intención en vez de recordar caminos.

    Puntúa cada archivo citado por el árbol con tres señales, de la más fuerte a la más débil:
      · el término aparece en su NOMBRE          (fuerte: es de lo que trata el archivo)
      · el término aparece en el `when`/síntomas del nodo que lo cita  (el vocabulario de la tarea)
      · el término aparece en el `doc.md` del nodo que lo cita        (contexto, más difuso)
    """
    # ⚠ Se filtran las vacías y se exige 4 letras. Sin esto, «por» (3 letras) matcheaba «CorPORate» y
    # el primer resultado de «¿por qué no le apareció la entidad?» era un controller de usuarios
    # corporativos. Matchear por substring con palabras cortas y comunes es ruido garantizado.
    VACIAS = {"para", "porque", "sobre", "donde", "cuando", "cual", "cuales", "esta", "este", "esto",
              "eso", "esa", "ese", "como", "mas", "menos", "todo", "toda", "todos", "hay", "tiene",
              "puede", "debe", "sino", "pero", "desde", "hasta", "entre", "cada", "otro", "otra",
              "quiero", "necesito", "saber", "decir", "dar", "ver", "algo", "nada", "muy"}
    terminos = [t.strip("¿?¡!.,;:()«»\"'").lower() for t in que_necesito.split()]
    terminos = [t for t in terminos if len(t) >= 4 and t not in VACIAS]
    # ⚠ EL PUENTE QUE MÁS RINDE: se pregunta en español y el código está en inglés. Sin esto,
    # «perfilamiento reglas duras» no encontraba `ProfilingRulesService` — buscaba «reglas» contra
    # «Rules». No es traducción general: son los términos del NEGOCIO de CreditOp, que es donde el
    # vocabulario de la tarea y el del código se separan.
    GLOSARIO = {
        "cupo": ["quota", "available", "limit"], "categoría": ["category"], "categoria": ["category"],
        "reglas": ["rule"], "regla": ["rule"], "duras": ["rule", "validation"],
        "perfilamiento": ["profiling"], "perfil": ["profil"],
        "entidad": ["lender"], "entidades": ["lender"], "prestamista": ["lender"],
        "comercio": ["allied", "merchant"], "comercios": ["allied", "merchant"],
        "sucursal": ["branch"], "solicitud": ["request"], "solicitudes": ["request"],
        "firma": ["sign", "signature"], "firmar": ["sign"], "pagaré": ["promissory"],
        "pagare": ["promissory"], "desembolso": ["disburse"], "desembolsar": ["disburse"],
        "enganche": ["initial", "fee"], "cuota": ["fee", "installment"], "cuotas": ["fee"],
        "plazo": ["term", "fee_number"], "monto": ["amount"], "ingreso": ["income"],
        "buró": ["risk", "central", "experian"], "buro": ["risk", "central"],
        "identidad": ["identity"], "usuario": ["user"], "cliente": ["user", "customer"],
        "pago": ["payment"], "pagos": ["payment"], "tasa": ["rate"], "seguro": ["insurance"],
        "listado": ["listing", "retrieval"], "asesor": ["advisor", "merchant"],
        "documento": ["document"], "formulario": ["form"], "rotativo": ["revolving"],
    }
    for t in list(terminos):
        terminos.extend(x for x in GLOSARIO.get(t, []) if x not in terminos)
    if not terminos:
        return {"error": "no quedó ningún término útil: usá palabras de 4+ letras y con contenido "
                         "(«cupo», «pagaré», «perfilamiento»), no una frase entera de conectores"}

    flows = CONTEXT / "server" / "data" / "flows"
    mejor = {}   # ruta → (puntaje del MEJOR nodo, ese nodo, por qué)
    citado = {}  # ruta → en cuántos nodos aparece

    # ⚠ Se toma el MEJOR nodo, NO la suma. Primera versión sumaba y ganaban los archivos-hub: uno
    # citado por 20 nodos acumulaba 20 puntos sin ser más pertinente que otro citado por uno solo.
    # Es el bug clásico de puntuar por frecuencia. Lo que importa es «¿hay UN nodo que hable de esto
    # y lo cite?», no «¿cuántos lo mencionan de pasada?».
    for d in sorted(p for p in flows.iterdir() if p.is_dir()):
        try:
            m = json.loads((d / "map.json").read_text(encoding="utf-8"))
        except (json.JSONDecodeError, FileNotFoundError):
            continue
        cuando = (m.get("when", "") + " " + " ".join(m.get("sintomas", []))).lower()
        try:
            doc = (d / "doc.md").read_text(encoding="utf-8").lower()
        except FileNotFoundError:
            doc = ""
        en_cuando = sum(1 for t in terminos if t in cuando)
        en_doc = sum(1 for t in terminos if t in doc)
        base = 4 * en_cuando + (1 if en_doc else 0)

        # Dónde aparece cada término dentro del doc: sirve para medir CERCANÍA con la mención del
        # archivo. Sin esto, todos los archivos de un nodo que matchea empatan y el orden entre ellos
        # queda al azar — era el caso de «perfilamiento reglas duras», que devolvía controllers de
        # admin. El doc cita archivos en prosa; si el término y el archivo están en el mismo párrafo,
        # el doc está hablando de ESE archivo para ESE tema.
        posiciones = []
        for t in terminos:
            desde = doc.find(t)
            while desde != -1 and len(posiciones) < 400:
                posiciones.append(desde)
                desde = doc.find(t, desde + 1)

        for f in m.get("files", []):
            citado[f] = citado.get(f, 0) + 1
            if not base:
                continue
            nombre = f.rsplit("/", 1)[-1].lower()
            # El nombre del archivo es la señal más fuerte: dice de qué trata ANTES de abrirlo.
            puntaje = base + 8 * sum(1 for t in terminos if t in nombre)

            cerca = False
            if posiciones and nombre in doc:
                p = doc.find(nombre)
                while p != -1 and not cerca:
                    cerca = any(abs(p - q) < 700 for q in posiciones)
                    p = doc.find(nombre, p + 1)
            if cerca:
                puntaje += 7

            if puntaje > mejor.get(f, (0,))[0]:
                razon = []
                if any(t in nombre for t in terminos):
                    razon.append("el nombre del archivo habla del tema")
                if cerca:
                    razon.append(f"`{d.name}` lo explica justo donde habla de eso")
                elif en_cuando:
                    razon.append(f"el nodo `{d.name}` se abre con ese vocabulario")
                elif en_doc:
                    razon.append(f"el nodo `{d.name}` lo menciona")
                mejor[f] = (puntaje, d.name, razon)

    # Un archivo que vive en muchos nodos es plomería compartida: se penaliza apenas, para que no
    # desplace al específico. `make context-salud` ya llama «hubs» a eso.
    def final(f):
        p, _, _ = mejor[f]
        return p - min(3, citado.get(f, 1) // 4)

    orden = sorted(mejor, key=lambda f: -final(f))[:tope]
    return {
        "busque": que_necesito,
        "encontrados": len(mejor),
        "archivos": [{
            "ruta": f, "puntaje": final(f), "nodo": mejor[f][1],
            "por_que": mejor[f][2], "en_cuantos_nodos": citado.get(f, 1),
        } for f in orden],
        "nota": "puntaje alto = el NOMBRE del archivo habla del tema y un nodo pertinente lo cita",
    }


def ver_buscar(que):
    d = buscar(que)
    if "error" in d:
        print(f"⚠ {d['error']}")
        return 1
    print(f"\n  «{d['busque']}» → {d['encontrados']} archivos candidatos, los mejores {len(d['archivos'])}:\n")
    for a in d["archivos"]:
        hub = f"  (en {a['en_cuantos_nodos']} nodos)" if a["en_cuantos_nodos"] > 4 else ""
        print(f"  [{a['puntaje']:>3}] {a['ruta']}{hub}")
        print(f"        · {' · '.join(a['por_que'])}")
    print(f"\n  {d['nota']}\n")
    return 0


def _arbol(alias):
    """Todas las rutas del repo en `main`, en una sola llamada a git."""
    root = ROOTS.get(alias)
    if not root or not Path(root).is_dir():
        return []
    r = subprocess.run(["git", "-C", root, "ls-tree", "-r", "--name-only", "main"],
                       capture_output=True, text=True, timeout=120)
    return r.stdout.splitlines() if r.returncode == 0 else []


def _leer(alias, rel):
    root = ROOTS[alias]
    r = subprocess.run(["git", "-C", root, "show", f"main:./{rel}"],
                       capture_output=True, text=True, timeout=30)
    return r.stdout if r.returncode == 0 else ""


def subramas(alias):
    """Las unidades con ENSAMBLADO PROPIO dentro de un repo: workspaces del monorepo, módulos del
    backend. No se guardan en `repos.json` a propósito — se derivan acá, y de `main`.

    ⚠ Por qué de main y no del disco: el working tree suele estar en otra rama. Medido el 2026-08-15,
    `legacy-backend` estaba en una rama donde `Modules/Backoffice` NO EXISTE — caminar el filesystem lo
    habría borrado del índice sin que nada avisara. Lo derivado se deriva de la vara, no de lo que
    tengas puesto.
    """
    if alias not in ROOTS:
        return {"error": f"alias desconocido '{alias}'", "validos": sorted(ROOTS)}
    rutas = _arbol(alias)
    if not rutas:
        return {"error": f"no se pudo leer main de '{alias}' (¿repo clonado?)"}

    notas = cargar().get("notas_de_subramas", {})
    # Clave = la carpeta. ⚠ Los módulos de Laravel también traen `package.json`, así que la misma
    # unidad la encuentran los DOS descubridores; sin esto salía duplicada, una vez como workspace y
    # otra como módulo. Se fusiona: el que corre segundo completa al primero, no lo repite.
    porUnidad = {}

    def sumar(carpeta, **campos):
        u = porUnidad.setdefault(carpeta, {"unidad": carpeta, "nota": notas.get(f"{alias}/{carpeta}", "")})
        for k, v in campos.items():
            if v and not u.get(k):
                u[k] = v
        return u

    # ── monorepo pnpm: una unidad = una carpeta con package.json propio ──
    manifiestos = sorted(p for p in rutas if p.endswith("package.json") and p.count("/") >= 2)
    for m in manifiestos:
        carpeta = m.rsplit("/", 1)[0]
        try:
            pkg = json.loads(_leer(alias, m) or "{}")
        except json.JSONDecodeError:
            pkg = {}
        docs = [p for p in rutas if p.startswith(carpeta + "/") and p.lower().endswith(".md")
                and p.count("/") == carpeta.count("/") + 1]
        sumar(carpeta, nombre=pkg.get("name", ""), tipo=carpeta.split("/", 1)[0],
              manifiesto=m, docs=docs)

    # ── Laravel modules: una unidad = una carpeta bajo Modules/ ──
    modulos = sorted({p.split("/")[1] for p in rutas if p.startswith("Modules/") and "/" in p[8:]})
    for mod in modulos:
        base = f"Modules/{mod}"
        docs = [p for p in rutas if p.startswith(base + "/") and p.lower().endswith(".md")
                and p.count("/") == 2]
        rutas_mod = [p for p in rutas if p.startswith(f"{base}/routes/")]
        u = sumar(base, nombre=mod, manifiesto=f"{base}/module.json" if f"{base}/module.json" in rutas else "",
                  docs=docs, rutas=rutas_mod)
        # El tipo del módulo MANDA sobre el que puso el descubridor de workspaces: un módulo de Laravel
        # con package.json sigue siendo un módulo, no un workspace de npm.
        u["tipo"] = "módulo V1/V2" if mod[-2:] in ("V1", "V2") else "módulo"

    unidades = list(porUnidad.values())
    return {"repo": alias, "contra": "main", "unidades": unidades, "cuantas": len(unidades)}


def mapa_de_negocio(alias):
    """LA SEPARACIÓN DE NEGOCIO DE UN REPO — derivada, no escrita.

    «En frontend-monorepo hay cosas separadas: bancolombia, backoffice, onboarding…» es cierto, y ya
    está en los datos DOS veces: el repo lo separa en carpetas (subramas) y el árbol de contexto lo
    separa en nodos. Sólo faltaba cruzarlos: para cada unidad del repo, qué nodos de negocio la citan.

    Escribir esto a mano —un map.json por área y por repo— sería una TERCERA copia, y la que se pudre
    primero porque nadie la regenera. Acá sale de `main` y de los `map.json` en el momento.

    Devuelve por unidad los nodos que la tocan, ordenados por cuántos archivos citan de ella.
    """
    sub = [u["unidad"] for u in subramas(alias).get("unidades", [])]
    if not sub:
        return {"alias": alias, "unidades": {}, "sueltos": {}, "sin_subramas": True}
    sub.sort(key=len, reverse=True)  # el prefijo más largo gana: modules/x/y antes que modules/x

    flows = CONTEXT / "server" / "data" / "flows"
    porUnidad, sueltos = {}, {}
    for d in sorted(p for p in flows.iterdir() if p.is_dir()):
        m = d / "map.json"
        if not m.is_file():
            continue
        try:
            files = json.loads(m.read_text(encoding="utf-8")).get("files", [])
        except json.JSONDecodeError:
            continue
        for f in files:
            if not f.startswith(alias + "/"):
                continue
            rel = f.split("/", 1)[1]
            u = next((s for s in sub if rel.startswith(s + "/")), None)
            destino = porUnidad.setdefault(u, {}) if u else sueltos
            destino[d.name] = destino.get(d.name, 0) + 1

    return {
        "alias": alias,
        "total_unidades": len(sub),
        "unidades": {u: sorted(v.items(), key=lambda x: -x[1]) for u, v in porUnidad.items()},
        "sueltos": sorted(sueltos.items(), key=lambda x: -x[1]),
    }


def ver_mapa(alias):
    d = mapa_de_negocio(alias)
    if d.get("sin_subramas"):
        print(f"\n▸ {alias} — no tiene subramas, así que no hay separación interna que cruzar.")
        print("  Los nodos que lo describen salen de `puente`.\n")
        return 0
    us = d["unidades"]
    print(f"\n▸ {alias} — qué parte del negocio vive en cada unidad (derivado de main + los map.json)\n")
    ancho = min(52, max((len(u) for u in us), default=20))
    for u in sorted(us, key=lambda x: -sum(c for _, c in us[x])):
        top = " · ".join(f"{n} ({c})" for n, c in us[u][:3])
        print(f"  {u:<{ancho}}  {top}")
    mudas = d["total_unidades"] - len(us)
    print(f"\n  {len(us)}/{d['total_unidades']} unidades tienen nodo que las describa.")
    if mudas:
        print(f"  ⚠ {mudas} sin ningún nodo: o son plomería, o son negocio que el árbol no cubre todavía.")
    if d["sueltos"]:
        cuantos = sum(c for _, c in d["sueltos"])
        print(f"  ⚠ {cuantos} archivo(s) citados fuera de toda subrama (raíz del repo o carpeta sin manifiesto).")
    print()
    return 0


def ver_subramas(alias):
    d = subramas(alias)
    if "error" in d:
        print(f"⚠ {d['error']}")
        return 1
    if not d["cuantas"]:
        # Cero NO es una falla: es la respuesta. Un Laravel plano o un servicio Go de un solo binario
        # no tienen subunidades, y decirlo así evita que se lea como «el descubridor no anduvo».
        print(f"\n▸ {alias} — sin subramas: no usa workspaces ni módulos, es una unidad sola.")
        print("  Su estructura está en `repos.json` (cómo se ensambla + por dónde entrar).\n")
        return 0
    print(f"\n▸ {alias} — {d['cuantas']} unidades con ensamblado propio (contra main)\n")
    for u in sorted(d["unidades"], key=lambda x: (x["tipo"], x["unidad"])):
        etiqueta = f"[{u['tipo']}]"
        print(f"  {etiqueta:16} {u['unidad']}" + (f"   ({u['nombre']})" if u["nombre"] else ""))
        if u.get("docs"):
            print(f"                   docs: {', '.join(p.rsplit('/', 1)[1] for p in u['docs'])}")
        if u.get("rutas"):
            print(f"                   rutas: {len(u['rutas'])} archivo(s)")
        if u.get("nota"):
            print(f"                   ↳ {u['nota']}")
    print()
    return 0


def ver(filtro=None):
    d = cargar()
    puente = nodos_por_repo()
    print(f"\n{'═' * 96}")
    for linea in d["la_historia_en_una_linea"]:
        print(f"  {linea}")
    print(f"{'═' * 96}")
    for alias, r in d["repos"].items():
        if filtro and filtro != alias:
            continue
        print(f"\n▸ {alias}   ({r['stack']})")
        print(f"  {r['que_es']}")
        print(f"  nació: {r['nacio']}")
        print(f"  cómo se ensambla: {r['como_se_ensambla']}")
        print("  por dónde entrar:")
        for e in r["entrada"]:
            print(f"    · {e['ruta']}")
            print(f"        {e['por_que']}")
        # El puente al otro árbol. Derivado de los map.json, no escrito acá.
        nodos = puente.get(alias, [])
        if nodos:
            top = " · ".join(f"{n} ({c})" for n, c in nodos[:6])
            print(f"  qué nodos lo describen: {top}" + (f"  …y {len(nodos) - 6} más" if len(nodos) > 6 else ""))
        else:
            print("  qué nodos lo describen: ninguno todavía — el árbol de negocio no lo cubre")
    if not filtro:
        print()
        for linea in d["_los_go_comparten_molde"]:
            print(f"  {linea}")
    print()
    return 0


def check():
    d = cargar()
    vivas = muertas = sin_repo = 0
    problemas = []
    for alias, r in d["repos"].items():
        for e in r["entrada"]:
            ruta = e["ruta"]
            if "/" not in ruta:
                problemas.append(f"{ruta} — sin alias (va 'alias/camino')")
                muertas += 1
                continue
            a, rel = ruta.split("/", 1)
            if a not in ROOTS:
                problemas.append(f"{ruta} — alias '{a}' no está en roots.py")
                muertas += 1
                continue
            if a != alias:
                problemas.append(f"{ruta} — está bajo '{alias}' pero su alias es '{a}'")
            estado = _existe_en_main(a, rel)
            if estado is None:
                sin_repo += 1
            elif estado:
                vivas += 1
            else:
                problemas.append(f"{ruta} — NO existe en main")
                muertas += 1

    if problemas:
        print("⚠ problemas:")
        for p in problemas:
            print(f"    {p}")
    extra = f" · {sin_repo} sin repo clonado" if sin_repo else ""
    print(f"\nrepos.json: {len(d['repos'])} repos · {vivas} rutas vivas en main · {muertas} muertas{extra}")
    return 1 if muertas else 0


def ver_puente():
    """La cobertura del árbol de negocio POR REPO. Es una medición, no una lista: dice de qué repos
    sabemos y de cuáles casi nada."""
    d = cargar()
    puente = nodos_por_repo()
    print("\n  Cobertura del árbol de negocio, por repo (derivado de los map.json)\n")
    print(f"  {'repo':28} {'nodos':>6} {'citas':>7}   el que más lo describe")
    print(f"  {'─' * 28} {'─' * 6} {'─' * 7}   {'─' * 30}")
    for alias in d["repos"]:
        v = puente.get(alias, [])
        citas = sum(c for _, c in v)
        top = v[0][0] if v else "—"
        aviso = "  ⚠ casi sin cubrir" if 0 < citas <= 6 else ("  ⚠ SIN cubrir" if not citas else "")
        print(f"  {alias:28} {len(v):>6} {citas:>7}   {top}{aviso}")
    print("\n  ⚠ «casi sin cubrir» no es un error: es dónde falta escribir contexto. Los microservicios")
    print("     se sumaron como roots recién el 2026-08-07 (F-123), así que era esperable — pero ahora")
    print("     se ve, que es la diferencia.\n")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    verbo = args[0] if args else "ver"
    if verbo == "check":
        sys.exit(check())
    if verbo == "puente":
        sys.exit(ver_puente())
    if verbo == "buscar":
        if len(args) < 2:
            print("falta qué buscar: python3 indice.py buscar 'por qué no aparece una entidad'")
            sys.exit(2)
        sys.exit(ver_buscar(" ".join(args[1:])))
    if verbo == "mapa":
        if len(args) < 2:
            print("falta el repo: python3 indice.py mapa frontend-monorepo")
            sys.exit(2)
        sys.exit(ver_mapa(args[1]))
    if verbo == "subramas":
        if len(args) < 2:
            print("falta el repo: python3 indice.py subramas frontend-monorepo")
            sys.exit(2)
        sys.exit(ver_subramas(args[1]))
    sys.exit(ver(args[1] if len(args) > 1 else None))
