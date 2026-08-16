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
from contexto import (
    CODE_INDEX, CONTEXT, PLAYGROUND, ROOTS, _extraer, buscar_en_codigo, leer_codigo,
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
    tiene 4 letras— a `available_amount`. Se reusa el MISMO glosario de `code-index/indice.py`; tener
    dos habría sido la divergencia de siempre.
    """
    sys.path.insert(0, str(CODE_INDEX))
    import indice
    fuera = set()
    for p in re.findall(r"[A-Za-zÁ-úñÑ_]{4,}", " ".join(frases)):
        b = p.lower()
        fuera.add(b)
        # el glosario vive adentro de `buscar`; se extrae una vez y se reusa
        for eq in getattr(indice, "GLOSARIO_NEGOCIO", {}).get(b, []):
            fuera.add(eq)
    return sorted(fuera)


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

    for v in vivos:
        queda = disponible - usado
        if queda <= 0:
            break
        cuerpo, om = recortar(v["texto"], [pregunta, v["por_que"]], len(v["cuerpo"]) + queda)
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
    for f in sorted((PLAYGROUND / "agents").glob("_*.json")):
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
        cuerpo, om = recortar(texto, [pregunta], por_nodo)
        partes.append(f"## nodo `{n}`" + (" (recortado)" if om else "") + f"\n{cuerpo}")
        usados.append(n)
    return "\n\n".join(partes), usados


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
}

INSTRUCCIONES = """\
Ya tenés los archivos que otro agente eligió para contestar la pregunta. Tu trabajo es LEERLOS y
responder — no volver a rutear.

⚠ ALGUNOS ARCHIVOS ESTÁN RECORTADOS. Donde dice `… N líneas omitidas …`, ESO NO ES QUE EL CÓDIGO NO
EXISTA: es que no entraba en el presupuesto. Nunca concluyas desde una ausencia dentro de un archivo
recortado. Si necesitás lo que falta, pedilo con `pedir_archivo(h, desde, hasta)` o ubicalo con
`buscar_en_codigo`.

Si te falta un archivo que nadie eligió, buscalo en `arbol_de_archivos` y pedilo — pero decilo en tu
respuesta: significa que la selección se quedó corta, y eso es información sobre el índice.

CÓMO CONTESTÁS:
1. La respuesta, en dos o tres frases.
2. La evidencia, con citas `archivo:línea` (los números que ves son los reales del archivo).
3. Qué te faltó: archivos que pediste de más, o partes recortadas que necesitabas.
Distinguí siempre lo que VERIFICASTE leyendo de lo que estás infiriendo.
"""


def main():
    args = sys.argv[1:]
    sel_path = PLAYGROUND / "agents" / "_ultima-seleccion.json"
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
    d = PLAYGROUND / "agents"
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
        entrada = (f"PREGUNTA: {pregunta}\n\n"
                   f"{'CONTEXTO VERIFICADO (los nodos del árbol — leelo ANTES del código):' if docs else ''}\n"
                   f"{docs}\n\nARCHIVOS:\n\n{bloque}")
        print(gemini.correr(entrada, HERRAMIENTAS, INSTRUCCIONES, cfg))
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
