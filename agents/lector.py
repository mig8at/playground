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
    usado, partes, informe = 0, [], []
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

        # Lo que queda del presupuesto, repartido entre los que faltan: así el primero no se lo come
        # todo y el último no se queda sin nada.
        restantes = max(1, len(hashes) - len(partes))
        cupo = max(8_000, (presupuesto - usado) // restantes)
        claves = [pregunta, item.get("por_que", "")]
        cuerpo, omitidas = recortar(texto, claves, cupo)
        partes.append(f"### {ruta}\n# por qué se pidió: {item.get('por_que','')}\n"
                      f"{'# ⚠ RECORTADO — los huecos están marcados' if omitidas else ''}\n{cuerpo}")
        usado += len(cuerpo)
        informe.append({"ruta": ruta, "estado": "recortado" if omitidas else "completo",
                        "lineas_omitidas": omitidas, "kb": round(len(cuerpo) / 1024, 1)})
    return "\n\n".join(partes), informe, usado


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
    sel = json.loads(sel_path.read_text(encoding="utf-8"))
    pregunta = args[0] if args else sel.get("pregunta") or (
        "¿Por qué a un cliente no le apareció esa entidad en el listado?")

    try:
        cfg = gemini.config()
        bloque, informe, chars = cargar_seleccion(sel["archivos"], pregunta)
        print(f"\n¿? {pregunta}\n")
        print(f"CARGADOS ({len(informe)} archivos · ~{chars // CHARS_POR_TOKEN:,} tokens de "
              f"{TOPE_TOKENS:,})\n")
        for i in informe:
            marca = "✓" if i.get("estado") == "completo" else ("✂" if i.get("estado") == "recortado" else "⚠")
            print(f"  {marca} {i.get('ruta', i.get('h'))}  {i.get('kb', '')} KB"
                  + (f"  ({i['lineas_omitidas']} líneas omitidas)" if i.get("lineas_omitidas") else ""))
        print()
        entrada = f"PREGUNTA: {pregunta}\n\nARCHIVOS:\n\n{bloque}"
        print(gemini.correr(entrada, HERRAMIENTAS, INSTRUCCIONES, cfg))
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
