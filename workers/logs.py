"""El MAPA PRECARGADO de mensajes de log → archivo que los emite.

QUÉ RESUELVE. Una traza son decenas de líneas y la pregunta es «¿qué archivos corrieron?». Resolverlas
de a una con `git grep` funciona pero no escala: son decenas de greps por traza. Acá el mapa se
construye UNA vez leyendo el código, y después una traza entera se resuelve con búsquedas en memoria.

⚠ POR QUÉ LA LLAVE ES EL MENSAJE Y NO UN HASH QUE VENGA EN EL LOG. Porque no viene: medido en prod, el
campo `extra_file` aparece en ~5% de las líneas y apunta a `vendor/laravel/framework` — el logger
registrando su propia línea, no la de quien llamó. El mensaje, en cambio, es un literal del código.

⚠ Y POR QUÉ SE MATCHEA POR PREFIJO. En el código el mensaje está partido —`'… para entidad ' . $id`—
y en runtime llega completo. El literal es un PREFIJO de lo que se ve en Loki, nunca al revés. Por eso
el índice se ordena de más largo a más corto y gana el prefijo más específico: con el más corto,
«Iniciando validación» se comería «Iniciando validación de reglas de grupo».

    ./cli.py logs --construir     lee los repos y arma logs.json
    ./cli.py logs "<mensaje>"     de un mensaje al archivo
    (la traza entera la resuelve el agente: `archivos_de_la_traza` en datos.py)

Se deriva del código, así que no se pudre: se reconstruye y listo.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent / "context" / "tools"))
from roots import ROOTS  # noqa: E402
import extraer as _extraer  # noqa: E402

MAPA = AQUI / "logs.json"

# Las dos familias que usa CreditOp, medidas: `tracer->log(nivel, MENSAJE, ctx)` (1.054 en
# legacy-backend) y el `Log::` de Laravel, donde el mensaje es el PRIMER argumento (~170).
# Se acepta comilla simple o doble; en PHP la simple no interpola, así que el literal es exacto.
PATRONES = [
    re.compile(r"""tracer\s*->\s*log\s*\(\s*['"][a-z]+['"]\s*,\s*['"]([^'"]{12,})['"]""", re.I),
    re.compile(r"""Log\s*::\s*(?:info|error|warning|debug|critical|notice|alert|emergency)\s*\(\s*['"]([^'"]{12,})['"]""", re.I),
    re.compile(r"""logger\s*\(\s*\)\s*->\s*[a-z]+\s*\(\s*['"]([^'"]{12,})['"]""", re.I),
    re.compile(r"""Log\s*::\s*channel\s*\([^)]*\)\s*->\s*[a-z]+\s*\(\s*['"]([^'"]{12,})['"]""", re.I),
    # TypeScript/JS y Go, por si el mensaje sale de un microservicio
    re.compile(r"""(?:logger|log|console)\s*\.\s*(?:info|error|warn|debug)\s*\(\s*['"`]([^'"`]{12,})['"`]"""),
    re.compile(r"""(?:slog|log)\.(?:Info|Error|Warn|Debug)\w*\(\s*"([^"]{12,})"""),
]

# Un mensaje que aparece en demasiados archivos no identifica nada: matchearlo devolvería una lista
# inútil y daría sensación de precisión. Se guarda igual pero marcado.
DEMASIADOS = 6


def _normalizar(m):
    """La forma con la que se compara. Los números se colapsan porque un literal puede traerlos y el
    runtime otros — pero se conserva la LONGITUD relativa, así que sigue sirviendo de prefijo."""
    return " ".join(m.split()).rstrip(" :.-,")


def construir(verboso=True):
    """Recorre `main` de cada repo y saca todos los mensajes de log con su archivo."""
    mapa = {}
    for alias, root in ROOTS.items():
        # ⚠ `-i`, y costó encontrarlo. El prefiltro de git grep era case-SENSITIVE mientras los
        # patrones de Python usan `re.I`, o sea que el filtro rápido era MÁS ESTRICTO que el matcher
        # real y tiraba líneas antes de que nadie las mirara. Concretamente: `$this->tracer->log(`
        # entraba y `$obsTracer->log(` no —T mayúscula—, y con eso se perdían cientos de mensajes de
        # `OnboardingService`. Un prefiltro más angosto que lo que filtra es un recorte invisible:
        # el resultado se ve completo y le falta la mitad.
        r = subprocess.run(["git", "-C", root, "grep", "-n", "--no-color", "-I", "-i", "-E",
                            r"tracer->log\(|Log::|logger\(\)->|logger\.|slog\.", "main"],
                           capture_output=True, text=True, timeout=300)
        if r.returncode not in (0, 1):
            continue
        n = 0
        for linea in r.stdout.splitlines():
            sin = linea.replace("main:", "", 1)
            ruta, _, resto = sin.partition(":")
            num, _, texto = resto.partition(":")
            if "/vendor/" in ruta or "/node_modules/" in ruta:
                continue
            for rx in PATRONES:
                for msg in rx.findall(texto):
                    k = _normalizar(msg)
                    if len(k) < 12:
                        continue
                    mapa.setdefault(k, []).append({"ruta": f"{alias}/{ruta}", "linea": num,
                                                   "es_test": "test" in ruta.lower()})
                    n += 1
        if verboso and n:
            print(f"  {alias:24} {n:5} mensajes")
    # El `h` se calcula una vez acá y no en cada consulta: es el identificador con el que responde
    # todo el resto del sistema.
    for k, v in mapa.items():
        for x in v:
            x["h"] = _extraer.hash_de(x["ruta"])
    MAPA.write_text(json.dumps(mapa, ensure_ascii=False, indent=1), encoding="utf-8")
    if verboso:
        amb = sum(1 for v in mapa.values() if len(v) > DEMASIADOS)
        print(f"\n  {len(mapa):,} mensajes distintos · {MAPA.stat().st_size//1024} KB · "
              f"{amb} aparecen en más de {DEMASIADOS} archivos (no identifican)")
    return mapa


def cargar():
    if not MAPA.is_file():
        return {}
    return json.loads(MAPA.read_text(encoding="utf-8"))


_ORDEN = None      # (orden, id_del_mapa): se invalida cuando cambia el mapa, no en cada llamada

# Segunda vía, para los mensajes que se arman ENTEROS con variables: muchísimos tienen la forma
# `'Ending ' . __CLASS__ . '::' . __METHOD__`, así que el literal es «Ending » —siete caracteres, una
# llave inútil— pero el mensaje de runtime NOMBRA LA CLASE. Y en Laravel el namespace es la ruta.
# Cubre lo que el mapa no puede: no hay literal que indexar, pero el dato está en el texto.
_CLASE = re.compile(r"\b((?:[A-Z][A-Za-z0-9]*\\)+[A-Z][A-Za-z0-9]*)")
# También la forma corta `Clase::metodo`, sin namespace.
_CORTA = re.compile(r"\b([A-Z][A-Za-z0-9]{3,})::[a-zA-Z]")


def _por_clase(mensaje):
    """Del nombre de una clase en el mensaje a su archivo, resolviendo contra el índice de rutas."""
    import archivos as _arch
    cands = []
    m = _CLASE.search(mensaje)
    if m:
        cands.append(m.group(1).replace("\\", "/") + ".php")
    m2 = _CORTA.search(mensaje)
    if m2:
        cands.append(m2.group(1) + ".php")
    if not cands:
        return None
    todos = _arch.cargar()
    for c in cands:
        # El namespace da la cola de la ruta; se busca por sufijo, que es exacto sin exigir el prefijo
        # del módulo (`Modules/…` cuelga distinto en cada repo).
        hits = [r for r in todos if r.endswith("/" + c) or r.endswith(c.split("/")[-1])
                and c.split("/")[-1] == r.split("/")[-1]]
        hits = [h for h in hits if "test" not in h.lower()] or hits
        if hits:
            return {"literal": f"(por nombre de clase: {c})", "cubre": "n/d",
                    "archivos": [{"ruta": h, "linea": "?", "h": _extraer.hash_de(h),
                                  "es_test": False} for h in hits[:DEMASIADOS]],
                    "ambiguo": len(hits) > DEMASIADOS, "via": "clase"}
    return None


def resolver(mensaje, mapa=None):
    """De un mensaje de runtime al archivo. Devuelve el candidato de PREFIJO MÁS LARGO."""
    global _ORDEN
    mapa = mapa if mapa is not None else cargar()
    # ⚠ El caché original comparaba contra `cargar.__dict__["_ultimo"]`, que NADIE escribía: la
    # condición era siempre verdadera y se reordenaban 1.400 llaves en CADA llamada. Un caché que
    # nunca acierta es peor que no tenerlo, porque se lee como si ahorrara. Ahora se invalida por
    # identidad del mapa, que es lo que de verdad cambia.
    if _ORDEN is None or _ORDEN[1] is not mapa:
        _ORDEN = (sorted(mapa, key=len, reverse=True), mapa)
    m = _normalizar(mensaje)
    if not m:
        return None
    for k in _ORDEN[0]:
        if m.startswith(k):
            v = mapa[k]
            reales = [x for x in v if not x["es_test"]] or v
            return {"literal": k, "cubre": f"{len(k)}/{len(m)} chars",
                    "archivos": reales[:DEMASIADOS],
                    "ambiguo": len(reales) > DEMASIADOS, "via": "literal"}
    # Sin literal: puede que el mensaje nombre la clase. Va SEGUNDO porque el literal da la LÍNEA
    # exacta y esto sólo el archivo — menos preciso, pero mucho mejor que nada.
    return _por_clase(m)


def archivos_de_traza(lineas, mapa=None):
    """De una corrida a la LISTA DE ARCHIVOS QUE CORRIERON — que es para lo que existe todo esto.

    `lineas` son los mensajes de una traza. Cada elemento puede ser el mensaje suelto o `(span, msg)`:
    con el span se rescatan líneas que solas no resuelven. Devuelve los archivos en orden de PRIMERA
    APARICIÓN, que es lo más parecido a la secuencia de ejecución que se puede afirmar sin
    instrumentar el código — los timestamps de Loki no son monótonos entre servicios.

    ⚠ EL SPAN NO ES UNA LLAVE, ES UN PROPAGADOR, y la distinción importa porque invita al error
    contrario. Un `span_id` es hexadecimal ALEATORIO por corrida —medido: 44 distintos en 200 líneas,
    y los de mañana son otros—, así que NO existe un índice «span → archivo» que se pueda
    precalcular: no hay nada estable que indexar. Lo que el span sí hace, en RUNTIME, es agrupar las
    líneas de una misma operación; si una del grupo resolvió, las demás heredan su archivo. Medido en
    prod: rescata el 63% de las que quedaban sin resolver.

    ⚠ Y dice qué archivos DEJARON RASTRO, no cuáles se ejecutaron. Un archivo sin logs es invisible
    acá y eso NO significa que no corrió: un log ausente tiene cuatro causas indistinguibles (no se
    logueó · el nivel lo filtró · el batch no hizo flush · lag de ingesta). La misma regla del
    trazador — la BD dice qué pasó, los logs dicen por qué.
    """
    mapa = mapa if mapa is not None else cargar()
    # ⚠ Sin mapa, CADA línea sale «sin resolver» — que se lee como «no corrió nada» cuando lo que
    # pasa es que nadie construyó el índice. El error de la ausencia silenciosa, otra vez: un vacío
    # tiene que decir POR QUÉ está vacío.
    if not mapa:
        return {"error": "el mapa de logs no está construido: corré `./cli.py logs --construir` "
                         "(tarda ~10s y se deriva del código)"}
    pares = [(x[0], x[1]) if isinstance(x, (tuple, list)) else ("", x) for x in lineas]
    orden, datos = [], {}

    def sumar(ruta, h, linea, via):
        if ruta not in datos:
            orden.append(ruta)
            datos[ruta] = {"ruta": ruta, "h": h, "veces": 0, "lineas": set(), "via": via}
        datos[ruta]["veces"] += 1
        if linea and linea != "?":
            datos[ruta]["lineas"].add(linea)

    porSpan, sinResolver = {}, []
    for span, msg in pares:
        r = resolver(msg, mapa)
        if r:
            for a in r["archivos"]:
                sumar(a["ruta"], a["h"], a.get("linea"), r.get("via", "literal"))
                if span:
                    porSpan.setdefault(span, []).append(a)
        else:
            sinResolver.append((span, msg))

    heredadas = huerfanas = 0
    for span, _ in sinResolver:
        hermanas = porSpan.get(span) if span else None
        if hermanas:
            a = hermanas[0]
            sumar(a["ruta"], a["h"], None, "span")
            heredadas += 1
        else:
            huerfanas += 1

    salida = []
    for ruta in orden:
        d = datos[ruta]
        salida.append({"ruta": ruta, "h": d["h"], "veces": d["veces"], "via": d["via"],
                       "lineas": sorted(d["lineas"], key=lambda x: int(x))[:12]})
    return {"archivos": salida, "cuantos": len(salida), "lineas_leidas": len(pares),
            "heredadas_por_span": heredadas, "sin_resolver": huerfanas,
            "nota": "en orden de PRIMERA APARICIÓN. Dice qué archivos dejaron RASTRO, no cuáles se "
                    "ejecutaron: uno sin logs es invisible acá y eso no prueba que no corrió. Las "
                    "«heredadas_por_span» se atribuyeron por compartir operación, no por su texto."}
