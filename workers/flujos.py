"""El mapa de FLUJOS: qué sabe probar el harness, y contra qué.

QUÉ APORTA QUE NINGÚN OTRO MAPA TIENE. `context/` dice cómo funciona, `logs.json` qué dejó rastro,
`archivos.json` qué significa un archivo. Ninguno sabe **qué es DEMOSTRABLE corriéndolo** — y eso vive
sólo en `harness/`, en los nombres de sus tests.

⚠ SALE DE LOS NOMBRES DE `test()`, NO DE LOS PASOS. Medido: `new Flow(...).step()` —que declara pasos
con descripción— está en 4 de 45 specs; es un patrón demo que no se propagó. Los `test('…')` están en
37, y resultaron mejores material: llevan el recorrido con flechas y los códigos de error.

    Ecommerce LOCAL real: /checkout → solicitar → amount → phone → OTP(real) → personal-info
    fecha imposible (31/02/2010) → ONB005 + EXPEDITION_DATE_INVALID

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
_TEST = re.compile(r"\btest(?:\.\w+)?\(\s*['\"`]([^'\"`]{8,})['\"`]")
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
        escenarios = [" ".join(x.split()) for x in _TEST.findall(t)]
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
