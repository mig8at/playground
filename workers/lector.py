"""Agente `lector` — el SEGUNDO paso: recibe la selección del primero y lee de verdad.

    python3 seleccion.py "…"     # paso 1: elige QUÉ leer y guarda _ultima-seleccion.json
    python3 lector.py            # paso 2: lo lee y contesta

Por qué en dos pasos y no uno: elegir y leer son trabajos distintos, y separarlos deja REVISAR la
elección antes de gastar. Además el que elige está ciego al código a propósito —así se mide si el
índice alcanza— y el que lee no tiene que volver a rutear.

QUÉ RECIBE, en este orden:
  1. el ÁRBOL de los repos involucrados, por si necesita un archivo que el primero no pidió;
  2. la PREGUNTA;
  3. los ARCHIVOS elegidos, con el `por_que` de cada uno.

EL PRESUPUESTO Y EL RECORTE — que es lo que hace que esto no reviente:

El modelo admite 1.048.576 tokens de entrada, pero se usan 300.000. No es una limitación técnica: a
contexto largo la atención se degrada y el costo sube, y ocho archivos bien elegidos entran de sobra.

Cuando no entran, NO se descarta el archivo (eso hace carto, y perdés la pieza entera): se recorta.
Pero recortar por la cabeza —los primeros N caracteres— devuelve `namespace`, imports y la firma de
la clase, o sea justo lo que menos importa. Así que el recorte es DIRIGIDO:

  · la cabecera (imports y declaración) para ubicarse;
  · ventanas alrededor de lo que la pregunta y el `por_que` de ESE archivo mencionan;
  · y los huecos se marcan `… N líneas omitidas …`, siempre.

Marcarlos no es cosmético: sin la marca, el modelo concluye desde una ausencia —«no existe ese
método»— cuando lo que pasó es que se lo recortamos nosotros.
"""
import json
import re
import sys
from pathlib import Path

import gemini
import contexto
from contexto import (
    CONTEXT, PLAYGROUND, ROOTS, _extraer, buscar_en_codigo, leer_codigo,
)

TOPE_TOKENS = 300_000
CHARS_POR_TOKEN = 4          # estimación grosera para código; se declara como tal, no se disfraza
CABECERA = 35                # líneas de arranque que se conservan siempre al recortar
VENTANA = 45                 # líneas alrededor de cada coincidencia


def _resolver_uno(h):
    d = _extraer.resolver([h])
    return d["resueltos"].get(h.strip().upper())


def _texto(ruta):
    root, rel = ruta.split("/", 1)
    import subprocess
    r = subprocess.run(["git", "-C", ROOTS[root], "show", f"main:./{rel}"],
                       capture_output=True, text=True, timeout=60)
    return r.stdout if r.returncode == 0 else None


_DECLARA = re.compile(
    r"^\s*(?:(?:final|abstract|public|private|protected|static|export|async)\s+)*"
    r"(?:function|class|interface|type|const|func|def)\s+\w+")


def _claves(frases):
    """Las palabras con las que buscar DENTRO del código, traducidas.

    ⚠ Mismo problema que ya tuvo el buscador del índice: se pregunta en español y el código está en
    inglés. Buscar «categoría» nunca iba a encontrar `getLenderUserCategory`, ni «cupo» —que además
    tiene 4 letras— a `available_amount`. Se reusa el MISMO glosario de `indice.py`; tener
    dos habría sido la divergencia de siempre.
    """
    import indice  # vecino: vive en esta misma carpeta desde la unificación
    fuera = set()
    for p in re.findall(r"[A-Za-zÁ-úñÑ_]{4,}", " ".join(frases)):
        b = p.lower()
        fuera.add(b)
        # el glosario vive adentro de `buscar`; se extrae una vez y se reusa
        for eq in getattr(indice, "GLOSARIO_NEGOCIO", {}).get(b, []):
            fuera.add(eq)
    return sorted(fuera)


def recortar_secciones(texto, claves, tope_chars, minimo_secciones=8):
    """Recorte por SECCIONES ENTERAS, para documentos. Devuelve (texto, secciones_omitidas).

    ⚠ Por qué no alcanza el recorte por líneas de abajo. MEDIDO el 2026-08-16 sobre el nodo
    `findings` —el más valioso del árbol, 147.003 chars, 137 entradas `### F-xx`—: con un cupo de
    45.000 chars, el recorte por líneas devolvía 45.000 chars con 131 cortes internos y **CERO de las
    137 entradas conservaba su título**. O sea: cuarenta y cinco mil caracteres de fragmentos
    anónimos. El modelo no podía saber ni qué finding estaba leyendo, mucho menos citarlo.

    La causa es que la unidad de sentido de un documento no es la línea, es la SECCIÓN: un finding
    sirve entero (síntoma → causa raíz → evidencia → arreglo) y no sirve nada en pedazos — un síntoma
    sin su arreglo es peor que no traerlo, porque parece información.

    Dos reglas, y las dos importan:
      1. El PREÁMBULO (todo lo anterior a la primera sección) va SIEMPRE y completo: ahí vive el
         índice, que es el router. El propio `findings` lo dice: «nadie lee este archivo entero:
         entrá por el índice y leé sólo ese F-xx».
      2. Las secciones entran ENTERAS o no entran, ordenadas por cuánto matchean. Y se dice cuántas
         quedaron afuera, para que la ausencia no se lea como inexistencia.

    Resultado sobre el mismo caso: preámbulo + las entradas que matchean ≈ 5.400 tokens contra 36.750
    del doc entero, y esta vez legibles.
    """
    if len(texto) <= tope_chars:
        return texto, 0
    partes = re.split(r"^(?=#{2,3} )", texto, flags=re.M)
    if len(partes) < minimo_secciones:
        return None, -1  # sin estructura suficiente: que lo maneje el recorte por líneas
    preambulo, secciones = partes[0], partes[1:]
    palabras = _claves(claves)

    def puntos(s):
        bajo = s.lower()
        titulo = s.splitlines()[0].lower() if s else ""
        # Un match en el TÍTULO vale mucho más que uno en el cuerpo: es de lo que trata la sección.
        return sum(8 if p in titulo else bajo.count(p) for p in palabras)

    ranking = sorted(secciones, key=lambda s: (-puntos(s), len(s)))
    # El aviso se reserva ANTES de llenar. Contarlo después es el mismo error que ya costó tres
    # sobrepasos en este archivo: el presupuesto se mide sobre lo que se ENVÍA, no sobre el cuerpo.
    usado, elegidas = len(preambulo) + 260, []
    for s in ranking:
        if puntos(s) <= 0:
            continue          # sin relación con la pregunta: no se rellena con ruido
        if usado + len(s) > tope_chars:
            continue
        elegidas.append(s)
        usado += len(s)
    # Se devuelven en el ORDEN DEL DOCUMENTO, no por puntaje: un doc leído fuera de orden confunde.
    elegidas = [s for s in secciones if s in elegidas]
    omitidas = len(secciones) - len(elegidas)
    aviso = (f"\n\n> ⚠ De este documento se incluyeron {len(elegidas)} de {len(secciones)} secciones "
             f"—las que matchean la pregunta—, ENTERAS. Las otras {omitidas} existen y no están acá: "
             f"no concluyas que algo no está documentado porque no lo veas.\n") if omitidas else ""
    return preambulo + aviso + "".join(elegidas), omitidas


def recortar(texto, claves, tope_chars):
    """Recorte DIRIGIDO: cabecera + ventanas alrededor de lo que se está buscando.

    Devuelve (texto_recortado, cuántas líneas se omitieron). Las líneas van numeradas para que las
    citas del modelo sigan siendo verificables aunque el archivo esté incompleto.
    """
    lineas = texto.splitlines()
    if len(texto) <= tope_chars:
        return "\n".join(f"{i}: {l}" for i, l in enumerate(lineas, 1)), 0

    palabras = _claves(claves)

    # Cada línea se PUNTÚA y después se llena hasta el presupuesto. Antes se armaba un conjunto de
    # ventanas y se devolvía entero — con muchas coincidencias las ventanas se solapaban y el recorte
    # terminaba MÁS GRANDE que el tope (28 KB con un cupo de 12 KB). Puntuar y llenar respeta el
    # presupuesto por construcción, y además conserva lo mejor primero en vez de lo primero que salga.
    puntos = {}
    for i, l in enumerate(lineas, 1):
        bajo = l.lower()
        if i <= CABECERA:
            puntos[i] = 100 - i                       # la cabecera, para ubicarse
        if _DECLARA.search(l):
            puntos[i] = max(puntos.get(i, 0), 60)     # las declaraciones: baratas y orientan
        if any(p in bajo for p in palabras):
            for d in range(-VENTANA // 2, VENTANA // 2 + 1):
                j = i + d
                if 1 <= j <= len(lineas):
                    # más cerca de la coincidencia, más puntaje
                    puntos[j] = max(puntos.get(j, 0), 80 - abs(d))

    orden = sorted(puntos, key=lambda x: (-puntos[x], x))

    def render(sel):
        """El texto final. Se arma de verdad para medirlo: estimar el costo por línea se quedaba corto
        —faltaban el prefijo del número y, sobre todo, los marcadores de hueco— y el recorte salía un
        10-15% por encima del tope. Un presupuesto que se estima es un presupuesto que se pasa."""
        fuera, ultima, om = [], 0, 0
        for i in sorted(sel):
            if i > ultima + 1:
                hueco = i - ultima - 1
                om += hueco
                fuera.append(f"        … {hueco} líneas omitidas …")
            fuera.append(f"{i}: {lineas[i - 1]}")
            ultima = i
        if ultima < len(lineas):
            om += len(lineas) - ultima
            fuera.append(f"        … {len(lineas) - ultima} líneas omitidas …")
        return "\n".join(fuera), om

    # Llenado grueso y después ajuste EXACTO: se sacan las de menor puntaje hasta que el render entre.
    quedan, gasto = set(), 0
    for i in orden:
        costo = len(lineas[i - 1]) + 8
        if gasto + costo > tope_chars:
            continue
        quedan.add(i)
        gasto += costo
    if not quedan:
        quedan = set(range(1, min(len(lineas), tope_chars // 60) + 1))
    peores = [i for i in reversed(orden) if i in quedan]
    while peores:
        texto_out, om = render(quedan)
        if len(texto_out) <= tope_chars:
            return texto_out, om
        quedan.discard(peores.pop(0))
    return render(quedan)


def cargar_seleccion(hashes, pregunta, tope_tokens=TOPE_TOKENS):
    """Carga los archivos elegidos dentro del presupuesto. Devuelve el bloque y el informe de qué entró."""
    presupuesto = tope_tokens * CHARS_POR_TOKEN
    vivos, informe = [], []
    for item in hashes:
        h = item.get("h", "")
        ruta = _resolver_uno(h)
        if not ruta:
            informe.append({"h": h, "estado": "NO EXISTE"})
            continue
        texto = _texto(ruta)
        if texto is None:
            informe.append({"ruta": ruta, "estado": "no está en main"})
            continue
        vivos.append({"ruta": ruta, "texto": texto, "por_que": item.get("por_que", "")})

    # ── EL REPARTO: piso para todos, y el resto de IZQUIERDA A DERECHA ────────────────────────────
    # Se midió con las tres formas, forzando que no entrara (8 archivos, 318 KB, tope 60 KB):
    #
    #   cuota por archivo   7k 7k 7k 7k 7k 5k 7k 7k   <- reparte parejo… y RECORTA EL #1, que es el
    #                                                    que tiene la respuesta, para darle al #8
    #   izquierda a derecha 44k 15k 0 0 0 0 0 0       <- respeta la prioridad pero deja CINCO en cero
    #   piso + izq a der    44k 2k 2k 2k 2k 2k 2k 2k  <- el prioritario ENTERO y nadie invisible
    #
    # Va la tercera. El orden lo puso el agente que eligió y hay que honrarlo: si dijo que el primero
    # es «alta», recortarlo para hacerle lugar al último es repartir mal. Pero el piso importa igual:
    # con 0 el modelo no sabe ni qué métodos existen, y no puede pedir el tramo que le falta.
    # El piso se ADAPTA: con un presupuesto chico, 2.500 por archivo puede no entrar ni siquiera como
    # piso (8 archivos × 2.500 = 20.000). Un piso fijo que no cabe convierte el mínimo en el máximo y
    # el total se pasa igual.
    PISO = 2_500

    def cabecera(v):
        """Lo que se le pone ADELANTE a cada archivo. Cuesta y hay que contarlo: la primera versión lo
        ignoraba y el total se pasaba ~210 chars por archivo. Mismo error de antes, un nivel más
        arriba — si el presupuesto no cuenta TODO lo que se manda, no es un presupuesto."""
        return (f"### {v['ruta']}\n# por qué se pidió: {v['por_que']}\n"
                f"{'# ⚠ RECORTADO — los huecos están marcados' if v.get('om') else ''}\n")

    # ⚠ En el PEOR CASO: la cabecera crece si el archivo termina recortado, y eso se sabe después.
    # Contarla sin esa línea dejaba el total ~40 chars por archivo recortado por encima del tope.
    # Se reserva de más y se usa de menos: pasarse es un error, sobrar no.
    fijo = sum(len(cabecera(dict(v, om=1))) + 2 for v in vivos)
    disponible = max(0, presupuesto - fijo)

    piso = min(PISO, max(400, disponible // max(1, len(vivos))))
    for v in vivos:
        v["cuerpo"], v["om"] = recortar(v["texto"], [pregunta, v["por_que"]], piso)
    usado = sum(len(v["cuerpo"]) for v in vivos)

    # ⚠ TECHO POR ARCHIVO. El reparto de arriba le da al primero todo lo que quiera, y eso es correcto
    # cuando el primero es el que tiene la respuesta. Pero hay archivos citados por los nodos que son
    # ENORMES y no son razonamiento: `ExperianFixture.php` son 207 KB (~53.000 tokens) de datos de
    # prueba, y `ListLenders.vue` 182 KB. Si uno de ésos sale primero, se lleva el pase completo y los
    # demás se quedan con el piso.
    # No es hoy un problema de presupuesto —las corridas reales usan 31k de 300k— sino de ATENCIÓN:
    # cincuenta mil tokens de fixture no compiten por lugar, compiten por foco. Esto es un seguro
    # barato, no el arreglo de algo medido: ningún archivo se lleva más de un tercio.
    TECHO = max(piso, int(disponible * 0.33))
    for v in vivos:
        queda = disponible - usado
        if queda <= 0:
            break
        cupo = min(len(v["cuerpo"]) + queda, TECHO)
        cuerpo, om = recortar(v["texto"], [pregunta, v["por_que"]], cupo)
        usado += len(cuerpo) - len(v["cuerpo"])
        v["cuerpo"], v["om"] = cuerpo, om

    partes = []
    for v in vivos:
        partes.append(cabecera(v) + v["cuerpo"])
        informe.append({"ruta": v["ruta"], "estado": "recortado" if v["om"] else "completo",
                        "lineas_omitidas": v["om"], "kb": round(len(v["cuerpo"]) / 1024, 1)})
    completo = "\n\n".join(partes)
    return completo, informe, len(completo)


def cargar_nodos(sel, pregunta, tope_tokens):
    """Los `doc.md` de los nodos que consultó el seleccionador.

    Van ANTES del código y con presupuesto aparte porque cumplen otra función: el código dice qué
    hace el sistema, el nodo dice qué se VERIFICÓ y con qué trampas —los `F-xx`, el «antes de
    concluir»—. Sin eso el modelo re-deduce cosas que ya sabemos, y a veces las re-deduce mal.
    """
    nodos = []
    for f in sorted((PLAYGROUND / "workers").glob("_*.json")):
        try:
            nodos += json.loads(f.read_text(encoding="utf-8")).get("nodos_consultados") or []
        except (json.JSONDecodeError, AttributeError):
            continue
    nodos = list(dict.fromkeys(nodos))
    if not nodos:
        return "", []
    cupo_total, partes, usados = tope_tokens * CHARS_POR_TOKEN, [], []
    por_nodo = max(3_000, cupo_total // len(nodos))
    for n in nodos:
        f = CONTEXT / "server" / "data" / "flows" / n / "doc.md"
        if not f.is_file():
            continue
        texto = f.read_text(encoding="utf-8")
        # Primero por SECCIONES: un doc se lee por unidades de sentido, no por líneas sueltas. Si no
        # tiene estructura suficiente devuelve None y cae al recorte por líneas, que es el genérico.
        cuerpo, om = recortar_secciones(texto, [pregunta], por_nodo)
        como = "secciones"
        if cuerpo is None:
            cuerpo, om = recortar(texto, [pregunta], por_nodo)
            como = "líneas"
        partes.append(f"## nodo `{n}`" + (f" (recortado por {como})" if om else "") + f"\n{cuerpo}")
        usados.append(n)
    return "\n\n".join(partes), usados


def mapa_del_vecindario(nodos, cargados, tope_chars):
    """El MAPA de todo lo que citan los nodos consultados: una línea por archivo, con lo que DEFINE.

    Por qué existe, que es la corrección de un agujero de diseño: hasta acá un archivo tenía sólo dos
    estados para el lector —cargado entero (~4.000 tokens) o ausente— y el segundo era además
    INVISIBLE. Si el seleccionador se dejaba afuera el archivo que contestaba, el lector no tenía
    forma de sospecharlo: contestaba con lo que había, seguro.

    Tenía `arbol_de_archivos` para recuperarse, pero devuelve RUTAS PELADAS — una guía telefónica.
    Elegir de ahí es adivinar por el nombre del archivo.

    El nodolite es el estado intermedio que faltaba, y sale gratis al lado del código: MEDIDO sobre
    los nodos reales, el mapa entero cuesta **27-37x menos** que cargar esos mismos archivos (`kyc`:
    39 archivos = 5.337 tokens de mapa contra 197.177 enteros; `creditopx`: 2.370 contra 63.712). Por
    ~2% del presupuesto el lector deja de ser ciego a lo que no le dieron, y `pedir_archivo` —que ya
    existía— pasa de ser un salto de fe a una decisión informada.
    """
    vistos, filas, saltados = set(), [], 0
    for n in nodos:
        f = CONTEXT / "server" / "data" / "flows" / n / "map.json"
        if not f.is_file():
            continue
        for ruta in json.loads(f.read_text(encoding="utf-8")).get("files", []):
            if ruta in vistos:
                continue
            vistos.add(ruta)
            ya = ruta in cargados
            texto = _texto(ruta)
            if texto is None:
                continue
            lite = _extraer.extraer_uno(ruta, texto)
            if not lite:
                continue
            # Lo que DEFINE es lo que dice de qué trata; los imports no aportan al elegir.
            define = ", ".join(lite.get("d", [])[:6]) or "—"
            rutas_http = f" · {len(lite['r'])} rutas HTTP" if lite.get("r") else ""
            marca = "✓" if ya else f"h={lite.get('h', _extraer.hash_de(ruta))}"
            filas.append((ya, f"{'✓' if ya else ' '} {ruta}  [{lite.get('l', '?')} l]"
                              f"{rutas_http}\n     define: {define}"
                              + ("" if ya else f"   ({marca})")))
    if not filas:
        return "", 0
    # Los NO cargados primero: son los que el lector puede accionar. Los ✓ son sólo para que no
    # pida algo que ya tiene.
    filas.sort(key=lambda x: x[0])
    cuerpo, usado = [], 0
    for _, linea in filas:
        if usado + len(linea) > tope_chars:
            saltados += 1
            continue
        cuerpo.append(linea)
        usado += len(linea)
    faltan = sum(1 for ya, _ in filas if not ya)
    cab = (f"EL VECINDARIO — los {len(filas)} archivos que citan los nodos consultados. "
           f"Los ✓ ({len(filas) - faltan}) ya los tenés completos abajo; los otros {faltan} NO te los "
           f"dieron y podés traerlos con `pedir_archivo(h)` si lo que leés indica que hacen falta.\n"
           + (f"⚠ {saltados} no entraron en este mapa.\n" if saltados else ""))
    return cab + "\n".join(cuerpo), faltan


def arbol(alias, ruta=""):
    """El árbol de archivos de un repo, por si hace falta uno que no estaba en la selección.
    Devuelve rutas con su `h`, que es con lo que se piden."""
    if alias not in ROOTS:
        return {"error": f"alias desconocido '{alias}'", "validos": sorted(ROOTS)}
    fuera = []
    for rel in _extraer._shas(alias, solo_codigo=True):
        if ruta and not rel.startswith(ruta):
            continue
        r = f"{alias}/{rel}"
        fuera.append({"h": _extraer.hash_de(r), "ruta": r})
    return {"repo": alias, "bajo": ruta or "(todo)", "cuantos": len(fuera), "archivos": fuera[:400]}


def pedir_archivo(h, desde=1, hasta=0):
    """Un archivo que NO estaba en la selección, por su `h`. Para cuando leyendo aparece que falta uno."""
    ruta = _resolver_uno(h)
    if not ruta:
        return {"error": f"el hash {h} no existe. Sacalo del árbol o del índice, no lo inventes"}
    return leer_codigo(ruta, desde, hasta)


def _entregar_faltantes(faltan=None, motivo=""):
    """Terminal del triaje: el modelo no escribe la lista, LLAMA a esto con ella."""
    return {"faltan": [h.strip().upper() for h in (faltan or []) if h and h.strip()],
            "motivo": motivo}


TRIAJE = {"entregar_faltantes": ({
    "name": "entregar_faltantes",
    "description": "Entregá los `h` de los archivos del mapa que hacen falta (lista vacía si ninguno).",
    "parameters": {"type": "object", "properties": {
        "faltan": {"type": "array", "items": {"type": "string"},
                   "description": "los `h` tal cual figuran en el mapa; vacío si ninguno"},
        "motivo": {"type": "string", "description": "en una frase, por qué esos (o por qué ninguno)"},
    }, "required": ["faltan"]},
}, _entregar_faltantes)}

TRIAJE_INSTR = """\
Te paso una pregunta y el MAPA de archivos que existen y que NO se cargaron. Tu único trabajo es
decidir cuáles de ESOS harían falta para contestar bien. No contestás la pregunta.

Mirá el nombre y las definiciones de cada uno. Pedí los que respondan MEJOR que el resto, no todo lo
que suene relacionado: cada uno que pidas le come lugar al que sí importa. Entre 0 y 4.
Si ninguno aporta, devolvé la lista vacía — es una respuesta válida y barata.
Al final llamá a `entregar_faltantes`."""


def triaje(pregunta, mapa, cfg, tope=4):
    """El paso que decide si a la selección le faltó algo — y lo da el PROGRAMA, no el modelo.

    ⚠ Acá está la lección, y costó dos intentos fallidos el 2026-08-16. Se le sacó a propósito de la
    selección el archivo que tenía la respuesta (`LenderListingService`, con `stampCreditopXApproval`),
    dejándolo en el mapa con ese nombre a la vista. El lector no lo pidió: contestó con lo que tenía,
    describió el camino v1 y **se perdió el v2 entero**, sin una señal de duda.

    Intento 1: una instrucción («mirá el vecindario antes de contestar»). No la siguió.
    Intento 2: una herramienta con «OBLIGATORIA» en su descripción y en el prompt. No la llamó.

    La causa no es que le falte información ni énfasis: **un modelo que ya tiene UNA respuesta deja de
    buscar**, y un archivo que falta no se siente como un hueco — se siente como una respuesta
    completa. Pedirlo mejor no cambia eso. Lo que lo cambia es que la decisión ocurra en una llamada
    APARTE, antes de que exista una respuesta a la que aferrarse, y que esa llamada la haga el código.

    Es la misma forma que el `--evitar` del contraste: la calidad no salió de pedir diversidad, salió
    de impedirle el camino fácil.
    """
    if not mapa:
        return [], ""
    try:
        r = gemini.correr(f"PREGUNTA: {pregunta}\n\n{mapa}", TRIAJE, TRIAJE_INSTR, cfg,
                          verboso=False, terminales=("entregar_faltantes",))
    except gemini.GeminiError:
        return [], "(el triaje falló; se sigue sin él)"
    if not isinstance(r, dict):
        return [], "(el triaje no devolvió lista)"
    return r.get("faltan", [])[:tope], r.get("motivo", "")


HERRAMIENTAS = {
    "arbol_de_archivos": ({
        "name": "arbol_de_archivos",
        "description": "Las rutas de un repo con su `h`, para pedir un archivo que no estaba en la "
                       "selección. Acotá con `ruta` (ej: 'Modules/Loans') o devuelve demasiados.",
        "parameters": {"type": "object", "properties": {
            "alias": {"type": "string"}, "ruta": {"type": "string"},
        }, "required": ["alias"]},
    }, arbol),
    "pedir_archivo": ({
        "name": "pedir_archivo",
        "description": "Trae un archivo por su `h`, opcionalmente un rango de líneas. Usalo sólo si "
                       "leyendo lo que tenés aparece que falta uno.",
        "parameters": {"type": "object", "properties": {
            "h": {"type": "string"}, "desde": {"type": "integer"}, "hasta": {"type": "integer"},
        }, "required": ["h"]},
    }, pedir_archivo),
    "buscar_en_codigo": ({
        "name": "buscar_en_codigo",
        "description": "Dónde aparece un texto exacto en un repo, en main. Para ubicar algo que te "
                       "recortaron y necesitás.",
        "parameters": {"type": "object", "properties": {
            "patron": {"type": "string"}, "alias": {"type": "string"}, "subruta": {"type": "string"},
        }, "required": ["patron", "alias"]},
    }, buscar_en_codigo),

    # Leyendo aparece la pregunta «¿y el otro monolito hace lo mismo?». Sin esto, la única salida era
    # suponer la ruta del gemelo — y una ruta supuesta que no existe se lee como «no está en el otro
    # repo», que es una conclusión, no un error.
    "gemelos": contexto.HERRAMIENTAS["gemelos"],
    "que_hay_en": contexto.HERRAMIENTAS["que_hay_en"],
}

INSTRUCCIONES = """\
Ya tenés los archivos que otro agente eligió para contestar la pregunta. Tu trabajo es LEERLOS y
responder — no volver a rutear.

⚠ ALGUNOS ARCHIVOS ESTÁN RECORTADOS. Donde dice `… N líneas omitidas …`, ESO NO ES QUE EL CÓDIGO NO
EXISTA: es que no entraba en el presupuesto. Nunca concluyas desde una ausencia dentro de un archivo
recortado. Si necesitás lo que falta, pedilo con `pedir_archivo(h, desde, hasta)` o ubicalo con
`buscar_en_codigo`.

«EL VECINDARIO» es la lista de los archivos que citan los nodos y que NO se cargaron, con lo que
define cada uno. Ya pasaron por un triaje y lo que hacía falta se trajo — pero si leyendo aparece que
falta otro, pedilo por su `h` con `pedir_archivo`. Nunca concluyas «el código no hace X» sin fijarte
si el archivo que haría X está en esa lista.

Si te falta algo que ni el vecindario lista, buscalo en `arbol_de_archivos`. En todos los casos,
**decilo en tu respuesta**: que un archivo haya hecho falta es información sobre el índice, tan
valiosa como la respuesta misma.

CÓMO CONTESTÁS:
1. La respuesta, en dos o tres frases.
2. La evidencia, con citas `archivo:línea` (los números que ves son los reales del archivo).
3. Qué te faltó: archivos que pediste de más, o partes recortadas que necesitabas.
Distinguí siempre lo que VERIFICASTE leyendo de lo que estás infiriendo.
"""


def main():
    args = sys.argv[1:]
    sel_path = PLAYGROUND / "workers" / "_ultima-seleccion.json"
    if not sel_path.exists():
        print(f"no hay selección todavía: corré primero `seleccion.py`", file=sys.stderr)
        return 1
    # TODAS las selecciones que haya, no dos fijas: el orquestador puede lanzar N ángulos y esto los
    # junta sin saber cuántos son. Se DEDUPLICA por hash —dos agentes pueden coincidir pese al aviso—
    # y se conserva el orden: primero los de la primera selección, que es la que tiene la prioridad
    # principal, y así el reparto de izquierda a derecha sigue honrando ese orden.
    # ⚠ La PRIMARIA va primero. Ordenar alfabético ponía `_seleccion-2` antes que
    # `_ultima-seleccion`, y como el reparto del presupuesto va de izquierda a derecha, eso le daba
    # el contexto entero al ángulo secundario y recortaba al principal. El orden de las fuentes ES
    # la prioridad.
    d = PLAYGROUND / "workers"
    fuentes = [f for f in [d / "_ultima-seleccion.json"] if f.exists()]
    fuentes += [f for f in sorted(d.glob("_*.json"))
                if f not in fuentes and f.name != "_ultima-seleccion.json"
                and ("seleccion" in f.name or "contraste" in f.name or "angulo" in f.name)]
    sel, archivos, vistos, de_donde = None, [], set(), []
    for f in fuentes:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if sel is None:
            sel = d
        etiqueta = d.get("angulo") or f.stem.lstrip("_")
        n = 0
        for a in d.get("archivos", []):
            h = a.get("h", "").upper()
            if h in vistos:
                continue
            vistos.add(h)
            archivos.append(dict(a, origen=etiqueta))
            n += 1
        if n:
            de_donde.append(f"{etiqueta} ({n})")
    if sel is None:
        print("no hay ninguna selección: corré `seleccion.py` antes", file=sys.stderr)
        return 1
    pregunta = args[0] if args else sel.get("pregunta") or (
        "¿Por qué a un cliente no le apareció esa entidad en el listado?")

    try:
        cfg = gemini.config()
        # Los NODOS primero y con presupuesto propio: traen las trampas verificadas («antes de
        # concluir», los F-xx) que el código no puede mostrar, y son lo que evita que el modelo
        # re-descubra mal algo que ya se sabe. Se les da un 15% del total.
        print(f"\nFUENTES: {' · '.join(de_donde)}")
        docs, nodos_usados = cargar_nodos(sel, pregunta, int(TOPE_TOKENS * 0.15))
        bloque, informe, chars = cargar_seleccion(archivos, pregunta,
                                                  TOPE_TOKENS - len(docs) // CHARS_POR_TOKEN)
        print(f"\n¿? {pregunta}\n")
        print(f"CARGADOS ({len(informe)} archivos · ~{chars // CHARS_POR_TOKEN:,} tokens de "
              f"{TOPE_TOKENS:,})\n")
        for i in informe:
            marca = "✓" if i.get("estado") == "completo" else ("✂" if i.get("estado") == "recortado" else "⚠")
            print(f"  {marca} {i.get('ruta', i.get('h'))}  {i.get('kb', '')} KB"
                  + (f"  ({i['lineas_omitidas']} líneas omitidas)" if i.get("lineas_omitidas") else ""))
        print()
        if nodos_usados:
            print(f"  + contexto: {', '.join(nodos_usados)}  ({len(docs)//CHARS_POR_TOKEN:,} tokens)\n")

        # El MAPA del vecindario: barato (mide 27-37x menos que el código) y es lo único que hace
        # VISIBLE lo que la selección dejó afuera. Se arma con lo que sobró, con un techo del 4%.
        cargados = {i.get("ruta") for i in informe if i.get("ruta")}
        mapa, sin_cargar = mapa_del_vecindario(nodos_usados, cargados,
                                               int(TOPE_TOKENS * 0.04) * CHARS_POR_TOKEN)
        if mapa:
            print(f"  + mapa del vecindario: {sin_cargar} archivos que NO se cargaron, visibles "
                  f"({len(mapa)//CHARS_POR_TOKEN:,} tokens)")
            # El TRIAJE, en una llamada aparte y ANTES de armar el payload final. Ver `triaje()`:
            # dejárselo al lector como instrucción o como herramienta «obligatoria» no funcionó las
            # dos veces que se probó — el paso tiene que darlo el programa.
            faltan, motivo = triaje(pregunta, mapa, cfg)
            if faltan:
                # `cargar_seleccion` toma la forma de una selección ({h, prioridad, …}), no hashes
                # pelados: el triaje devuelve strings y hay que vestirlos.
                extra, inf2, ch2 = cargar_seleccion(
                    [{"h": h, "prioridad": "alta", "por_que": motivo} for h in faltan],
                    pregunta, int(TOPE_TOKENS * 0.15))
                bloque += "\n\n" + extra
                print(f"  ⚠ TRIAJE: la selección se quedó corta — {len(inf2)} archivo(s) rescatados "
                      f"({ch2 // CHARS_POR_TOKEN:,} tokens)\n    motivo: {motivo}")
                for i in inf2:
                    print(f"      + {i.get('ruta', i.get('h'))}")
            else:
                print(f"    triaje: no falta ninguno · {motivo}")
            print()

        entrada = (f"PREGUNTA: {pregunta}\n\n"
                   f"{'CONTEXTO VERIFICADO (los nodos del árbol — leelo ANTES del código):' if docs else ''}\n"
                   f"{docs}\n\n{mapa}\n\nARCHIVOS:\n\n{bloque}")
        print(gemini.correr(entrada, HERRAMIENTAS, INSTRUCCIONES, cfg))
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
