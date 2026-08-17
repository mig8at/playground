"""El mapa de FLUJOS: qué sabe probar el harness, y contra qué.

QUÉ APORTA QUE NINGÚN OTRO MAPA TIENE. `context/` dice cómo funciona, `logs.json` qué dejó rastro,
`archivos.json` qué significa un archivo. Ninguno sabe **qué es DEMOSTRABLE corriéndolo** — y eso vive
sólo en `harness/`, en los nombres de sus tests.

⚠ SALE DE LOS NOMBRES DE `test()`, NO DE LOS PASOS. Medido: `new Flow(...).step()` —que declara pasos
con descripción— está en 4 de 45 specs; es un patrón demo que no se propagó. Los `test('…')` están en
37, y resultaron mejores material: llevan el recorrido con flechas y los códigos de error.

    Ecommerce LOCAL real: /checkout → solicitar → amount → phone → OTP(real) → personal-info
    fecha imposible (31/02/2010) → ONB005 + EXPEDITION_DATE_INVALID

⚠ ES DERIVADO, PERO DE PROSA HUMANA — y eso lo hace distinto de los otros mapas. `archivos.json` sale
de la ESTRUCTURA del código (nombres de tabla, de clase): si el código cambia, el mapa cambia bien.
Acá el contenido es una frase que alguien escribió en un `test('…')`, así que **el mapa hereda la
calidad del nombre**. Un test mal nombrado produce una entrada inútil, y renombrarlo cambia el mapa.
No es un defecto que se pueda arreglar acá: es una propiedad de la fuente, y conviene saberla al leer.
Medido hoy: mediana de 64 caracteres por escenario, mínimo 18 — o sea que el equipo los nombra bien.

⚠ Y LO CONSTRUYE `workers`, NO `harness`, siguiendo la regla que ya rige con `context/`: workers LEE
las otras herramientas y no escribe en ellas. El harness sigue siendo dueño de sus specs; acá sólo se
derivan. Si un spec cambia de nombre, se reconstruye y listo.

    ./cli.py flujos              qué escenarios sabe probar el harness
    ./cli.py flujos --codigos    los códigos de error cubiertos, y CUÁLES NO
"""
import json
import re
from pathlib import Path

AQUI = Path(__file__).resolve().parent
HARNESS = AQUI.parent / "harness"
MAPA = AQUI / "flujos.json"

# Un nombre de test es la unidad: existe en 37 de 45 specs y describe el escenario entero.
# ⚠ El delimitador se CAPTURA y se exige el mismo al cerrar. Con una clase `[^'"`]` el nombre se
# corta en la primera comilla de cualquier tipo — y los nombres de acá empiezan con una: el test
# `'"Sí" → GUARDA flow_id=2 en DB → el buró LEE la DB y lo OMITE'` quedaba en «Pullman ·». Un recorte
# que no rompe nada: deja un nombre corto y plausible, que es la peor forma de perder datos.
_TEST = re.compile(r"""\btest(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1).)*?)\1""", re.S)
_STEP = re.compile(r"\.step\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'", re.S)
# Los códigos de error de CreditOp: ONB002, ONB005… y los SCREAMING_SNAKE del front/back.
_COD = re.compile(r"\b(ONB\d{3}|[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+){1,})\b")
# Las pantallas del wizard, que es lo que hace legible un recorrido.
_PANT = re.compile(r"/[a-z][a-z0-9-]{2,}(?:/[a-z0-9-]+)*")


def construir(verboso=True):
    """Recorre los specs del harness y arma {spec: {escenarios, codigos, pantallas}}."""
    if not HARNESS.is_dir():
        return {}
    mapa = {}
    for p in sorted(HARNESS.rglob("*.spec.ts")):
        if "node_modules" in str(p):
            continue
        rel = str(p.relative_to(HARNESS))
        t = p.read_text(encoding="utf-8", errors="replace")
        escenarios = [" ".join(m[1].split()) for m in _TEST.findall(t) if len(m[1]) >= 8]
        if not escenarios:
            continue
        pasos = [{"que": a, "detalle": b} for a, b in _STEP.findall(t)]
        blob = " ".join(escenarios) + " " + " ".join(x["detalle"] for x in pasos)
        cods = sorted({c for c in _COD.findall(blob)})
        pants = sorted({x for x in _PANT.findall(" ".join(escenarios)) if len(x) > 4})
        # El EJE sale de la carpeta: channel/, lender/, merchant/… es la convención del harness.
        eje = rel.split("/")[0] if "/" in rel else "raíz"
        mapa[rel] = {"eje": eje, "escenarios": escenarios,
                     **({"pasos": pasos} if pasos else {}),
                     **({"codigos": cods} if cods else {}),
                     **({"pantallas": pants} if pants else {})}
    MAPA.write_text(json.dumps(mapa, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if verboso:
        e = sum(len(v["escenarios"]) for v in mapa.values())
        c = len({x for v in mapa.values() for x in v.get("codigos", [])})
        print(f"  {len(mapa)} specs · {e} escenarios · {c} códigos de error cubiertos · "
              f"{MAPA.stat().st_size // 1024} KB")
    return mapa


def cargar():
    return json.loads(MAPA.read_text(encoding="utf-8")) if MAPA.is_file() else {}


def codigos_sin_prueba(desde="24h", target="prod"):
    """EL CRUCE que justifica este mapa: códigos de error que aparecen en PRODUCCIÓN y que ningún
    spec del harness prueba.

    `logs.json` sabe qué se emite, este mapa sabe qué se prueba, y la diferencia es el trabajo. Sin
    los dos no se puede formular: el harness solo dice qué cubre pero no qué falta, y los logs solos
    dicen qué pasa pero no si está cubierto.

    ⚠ No lee producción: cruza contra los mensajes del CÓDIGO (`logs.json`). Un código que existe en
    el código y no en un spec es candidato; si además aparece en prod, es prioridad — y eso lo dice
    `contar_logs`, no esto.
    """
    import logs as _logs
    probados = {c for v in cargar().values() for c in v.get("codigos", [])}
    en_codigo = set()
    for msg in _logs.cargar():
        en_codigo |= set(_COD.findall(msg))
    # ⚠ Hay que separar DOS cosas que se ven iguales y no lo son, o el resultado engaña: un `ONB004`
    # es un código que EL CLIENTE RECIBE —si no está probado, hay un camino de error sin cubrir—,
    # mientras que `CATEGORY_EVALUATION_START` es un marcador de telemetría interno: no es un fallo y
    # no hay nada que «probar» de él. Meterlos en la misma lista infla el número y lo vuelve inútil.
    ruido = {"HTTP", "URL", "API", "JSON", "SQL", "OTP", "PDF", "SMS", "AML", "KYC"}
    faltan = [c for c in sorted(en_codigo - probados)
              if c not in ruido and not c.startswith(("HTTP_", "APP_"))]
    codigos = [c for c in faltan if c.startswith("ONB")]
    marcas = [c for c in faltan if not c.startswith("ONB")]
    return {"probados": sorted(probados), "en_el_codigo": len(en_codigo),
            "codigos_sin_prueba": codigos, "marcas_sin_prueba": marcas[:30],
            "nota": "«codigos_sin_prueba» (ONBxxx) son los que EL CLIENTE recibe: cada uno es un "
                    "camino de error que ningún spec recorre. Las «marcas» son telemetría interna "
                    "—CATEGORY_*, QUOTA_*— y NO son fallos: van aparte porque no hay nada que probar "
                    "de ellas, y mezclarlas infla el número. Para priorizar un código, mirá si "
                    "aparece en prod: `make agente-datos TARGET=prod`."}


# ── EL FLUJO REAL, el que nadie escribió ────────────────────────────────────────────────────────
#
# La pregunta que abrió esto: ¿y si `flujos.json` fuera escrito a mano, y los logs sirvieran para
# encontrar los pasos que no anotamos? La primera mitad no hizo falta: LOS LOGS YA DAN LA SECUENCIA,
# en orden y en prosa de negocio. Escribirla a mano sería escribir a mano algo derivable — y encima
# la versión escrita sería una creencia, mientras que ésta es evidencia.
#
# Lo que SÍ conviene escribir a mano es lo que no se deriva: qué flujos IMPORTAN y por qué. Eso ya
# vive en `context/`, y por eso acá no se duplica.


def secuencia(mensajes):
    """De las líneas de UNA traza a los PASOS en orden, sin repetir.

    Los mensajes llegan con su hora y muchos se repiten (un mismo paso loguea entrada y salida, o
    corre en bucle). Acá se colapsan a la primera aparición: lo que queda es el RECORRIDO.

    ⚠ Es el recorrido de UNA corrida, no el flujo canónico. Dos solicitudes del mismo tipo pueden
    diferir —un reintento, un lender distinto—, así que esto describe lo que pasó, no lo que debería
    pasar. Para lo segundo está `context/`, que es donde vive el deber ser verificado.
    """
    fuera, vistos = [], set()
    for m in mensajes:
        m = " ".join(str(m).split())
        if not m:
            continue
        # Se colapsa por prefijo: `checkRateLimitPerHour: entered` y `: exiting` son el mismo paso
        # visto dos veces, y listarlos por separado convierte un recorrido en un volcado.
        k = m.split(":")[0][:52] if ":" in m[:60] else m[:52]
        if k in vistos:
            continue
        vistos.add(k)
        fuera.append(m)
    return fuera


# ⚠ ACÁ VIVIÓ `pasos_sin_probar`, que cruzaba los pasos de una corrida contra los escenarios del
# harness para decir cuáles no están probados. Se quitó el mismo día que se escribió, y el motivo
# vale más que la función: daba 58 «sin cubrir» de 64 pasos — o sea casi todo, que es la firma de una
# comparación rota, no de un hallazgo.
#
# La causa no era léxica sino de GRANULARIDAD: un paso de log es UNA llamada («Rate limit OK,
# continuing») y un nombre de test es UN ESCENARIO ENTERO («Ecommerce sin cookie: /checkout → phone →
# OTP → …»). Un escenario cubre docenas de pasos; matchearlos uno a uno por palabras no podía dar
# otra cosa. Arreglar el vocabulario español↔inglés lo habría maquillado sin arreglar nada.
#
# La comparación honesta a este nivel necesitaría que los tests declararan sus pasos —y eso existe
# (`new Flow(...).step()`) pero está en 4 de 45 specs—. Cuando se propague, la función se puede
# escribir de verdad. Hasta entonces, `secuencia()` sola ya contesta lo que se preguntó: cuáles son
# los pasos reales, incluido lo que nadie anotó.


def huella_por_lender(desde="6h", minimo=2):
    """{lender_id: los ARCHIVOS por los que pasan sus solicitudes}, derivado de producción.

    La idea: si una traza tiene un lender y sus mensajes resuelven a archivos, entonces cada lender
    tiene una HUELLA — el conjunto de código que sus solicitudes recorren. Sirve para dos cosas que
    hoy no se pueden contestar: «¿por dónde pasa ESTE lender que no pasa aquél?» y «¿qué código toco
    si cambio algo de este lender?».

    ⚠ CUÁNTO SE PUEDE ATRIBUIR, medido en prod: el `lender_id` aparece en el 15% de las LÍNEAS, pero
    basta una por traza — y así el 57% de las trazas quedan atribuidas. Con el COMERCIO no alcanza:
    `allied_id` está en el 1% de las líneas y sólo el 8% de las trazas, así que un
    `{comercio: [archivos]}` saldría casi vacío y parecería que esos comercios no operan. No se
    construye a propósito; cuando el backend loguee el allied_id, se agrega y ya.

    ⚠ Y es una MUESTRA de la ventana, no el catálogo: un lender sin tráfico en esas horas no aparece,
    y eso no significa que no tenga flujo.

    ⚠⚠ LO QUE ESTO NO ES, y es la lectura que más importa: **no es el recorrido del lender, es dónde
    su identificador queda escrito**. Medido: los lenders 77, 46 y 94 devuelven LOS MISMOS TRES
    ARCHIVOS —CreditopXQuotaController, LenderUserCategoryService, DatacreditoRuleEvaluator—, que son
    el chequeo de cupo. No es que todos hagan lo mismo: es que `lender_id` sólo se loguea ahí. Su paso
    por el listado, la formalización o la firma es invisible acá porque esas líneas no lo nombran.

    Así que sirve para «¿qué código escribe el lender_id?» y NO todavía para «¿por dónde va este
    lender?». La segunda necesita que el backend propague el lender_id al contexto de log, que es un
    cambio de una línea por sitio y convertiría esta función en lo que se quería.
    """
    import re as _re, json as _json, collections as _c, time as _t
    import datos as _d, logs as _logs
    _d.TARGET = "prod"
    seg = {"h": 3600, "d": 86400}
    m = _re.fullmatch(r"(\d+)([hd])", desde or "6h")
    ventana = int(m.group(1)) * seg[m.group(2)] if m else 21600
    d = _d._loki("query_range", {"query": '{service_name="legacy-backend"}', "limit": 1500,
                                 "start": f"{int(_t.time()) - ventana}000000000",
                                 "direction": "backward"})
    if "error" in d:
        return d
    mapa = _logs.cargar()
    if not mapa:
        return {"error": "el mapa de logs no está construido: ./cli.py logs --construir"}

    trazas = _c.defaultdict(lambda: {"lender": set(), "msgs": []})
    for st in d.get("data", {}).get("result", []):
        tid = st.get("stream", {}).get("trace_id", "")
        if not tid:
            continue
        for ns, txt in st.get("values", []):
            try:
                msg = _json.loads(txt).get("message", "")
            except Exception:
                g = _re.search(r'"message"\s*:\s*"((?:[^"\\]|\\.)*)"', txt)
                msg = g.group(1) if g else ""
            if msg:
                trazas[tid]["msgs"].append((int(ns), msg))
            for lid in _re.findall(r'"lender_id"\s*:\s*"?(\d+)', txt):
                trazas[tid]["lender"].add(lid)

    porLender = _c.defaultdict(lambda: {"trazas": 0, "archivos": _c.Counter(), "orden": []})
    sin_lender = 0
    for tid, tr in trazas.items():
        if not tr["lender"]:
            sin_lender += 1
            continue
        # ⚠ Si la traza nombra DOS lenders es el listado comparándolos, no el flujo de uno: se
        # descarta en vez de atribuirle a ambos un recorrido que no es suyo.
        if len(tr["lender"]) != 1:
            continue
        lid = next(iter(tr["lender"]))
        e = porLender[lid]
        e["trazas"] += 1
        for _, msg in sorted(tr["msgs"]):
            r = _logs.resolver(msg, mapa)
            if not r:
                continue
            for a in r["archivos"]:
                if a["ruta"] not in e["archivos"]:
                    e["orden"].append(a["ruta"])
                e["archivos"][a["ruta"]] += 1

    import extraer as _ex
    fuera = {}
    for lid, e in sorted(porLender.items(), key=lambda kv: -kv[1]["trazas"]):
        if e["trazas"] < minimo:
            continue
        fuera[lid] = {
            "trazas": e["trazas"],
            "archivos": [{"h": _ex.hash_de(r), "ruta": r, "lineas": e["archivos"][r]}
                         for r in e["orden"]],
        }
    return {"ventana": desde, "lenders": fuera,
            "trazas_sin_lender": sin_lender, "trazas_totales": len(trazas),
            "nota": "⚠ NO es el recorrido del lender: es DÓNDE SE ESCRIBE SU ID. Medido, varios "
                    "lenders devuelven los mismos 3 archivos (el chequeo de cupo) porque ahí es el "
                    "único lugar que loguea `lender_id` — su paso por listado, formalización y firma "
                    "no lo nombra y es invisible acá. Y el COMERCIO no se puede agrupar: `allied_id` "
                    "llega al 8% de las trazas."}
