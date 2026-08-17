"""Agente `datos` — el que MIDE. Contesta con la realidad, no con el código.

    python3 datos.py "¿cuántas solicitudes quedan en estado 3 sin pasar a 11?" --target prod
    python3 datos.py "¿qué le pasó a la solicitud 519245?" --target dev

POR QUÉ EXISTE, y por qué es un agente aparte y no una herramienta más del lector: el pipeline de
`seleccion`+`contraste`+`lector` contesta **qué dice el código**. Eso deja afuera la mitad de las
preguntas que se hacen de verdad — «¿esto pasa?», «¿cuántas veces?», «¿desde cuándo?», «¿le pasó a
ESTA solicitud?» — y son justo las que no se pueden contestar leyendo. Un `if` que existe en el código
puede no haber disparado nunca en producción; una rama muerta se ve idéntica a una caliente.

UN AMBIENTE POR CORRIDA, y es deliberado. Las herramientas NO reciben `target`: lo fija quien la lanza
y el agente no puede cambiarlo. Así cada número del informe tiene procedencia inequívoca — no existe
la duda de «¿ese conteo era de prod o del dev compartido?», que es exactamente el error que vuelve
inútil una medición. Para comparar dos ambientes se corre dos veces.

POR QUÉ SE PUEDE SOLTAR CONTRA PRODUCCIÓN: la guarda de solo-lectura NO está en este prompt, está en
Go, antes de salir a la red (`trazador/server/sql.go`, `esSoloLectura`) — exige que la consulta
empiece con SELECT/WITH, prohíbe multi-sentencia, los verbos de escritura y el `INTO OUTFILE` que una
vez se les coló. Un prompt se puede convencer; esa función no. Y todo lo demás que toca el agente son
GET (Loki, PostHog, Redash). No hay ninguna herramienta acá que pueda escribir en ningún ambiente.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import gemini

PLAYGROUND = Path(__file__).resolve().parent.parent
TRAZADOR = PLAYGROUND / "trazador" / "server"
TARGETS = ("local", "dev", "staging", "prod")

# El ambiente es un GLOBAL del proceso, no un parámetro de herramienta: ver el docstring.
TARGET = "local"

# Cuánto texto de una herramienta entra en la conversación. La ventana es grande pero el bucle
# acumula: cada resultado se arrastra en todas las vueltas siguientes. Un `SELECT *` sin LIMIT que
# devuelva 5.000 filas no informa más que 50 — y encarece cada paso posterior.
TOPE_SALIDA = 12_000


def _trazador(*args, timeout=180):
    """Corre el trazador. Argumentos como LISTA, nunca por shell: lo que escriba el modelo no se
    interpola en una línea de comandos."""
    try:
        r = subprocess.run(["go", "run", ".", "-target", TARGET, *args],
                           cwd=str(TRAZADOR), capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"error": f"la consulta pasó los {timeout}s y se cortó. Acotala (menos rango, más LIMIT)."}
    except FileNotFoundError:
        return {"error": "no está `go` en el PATH: el trazador no se puede correr"}
    salida = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        return {"error": salida[-1200:] or f"el trazador salió con código {r.returncode}"}
    return salida[:TOPE_SALIDA] + ("\n\n… (recortado)" if len(salida) > TOPE_SALIDA else "")


# ── las herramientas ─────────────────────────────────────────────────────────────────────────────
def tablas(patron=""):
    """Qué tablas existen. Contra inventar un nombre de tabla."""
    p = re.sub(r"[^a-zA-Z0-9_%]", "", patron)
    filtro = f"AND table_name LIKE '%{p}%'" if p else ""
    return _trazador("-sql", "SELECT table_name, table_rows FROM information_schema.tables "
                             f"WHERE table_schema=DATABASE() {filtro} ORDER BY table_name LIMIT 120")


def esquema(tabla):
    """Las columnas REALES de una tabla, con tipo y default.

    Es la herramienta más importante de todas y conviene usarla ANTES de escribir cualquier SELECT:
    sin ella el modelo escribe el nombre de columna que le parece razonable —y CreditOp está lleno de
    nombres que no son los razonables (`user_request_status_id`, no `status`)— y la consulta falla, o
    peor, no falla y mide otra cosa."""
    t = re.sub(r"[^a-zA-Z0-9_]", "", tabla)
    if not t:
        return {"error": "nombre de tabla vacío o inválido"}
    return _trazador("-sql", "SELECT column_name, column_type, is_nullable, column_default "
                             f"FROM information_schema.columns WHERE table_schema=DATABASE() "
                             f"AND table_name='{t}' ORDER BY ordinal_position")


def consultar_bd(sql):
    """UNA consulta de solo lectura (SELECT o WITH) contra la base del ambiente de esta corrida.

    La guarda de solo-lectura es de la herramienta, no de tu criterio: si mandás algo que escriba,
    se rechaza antes de salir a la red. Poné siempre un LIMIT."""
    return _trazador("-sql", sql, timeout=300)


# ── Loki, leído de verdad ────────────────────────────────────────────────────────────────────────
# ⚠ Por qué esto NO pasa por `trazador -query`, que ya sabe hablar con Loki: ese modo es una SONDA de
# acceso, no un lector. Medido el 2026-08-16: con `-limit 200` trae 200 líneas y imprime CUATRO. Para
# un humano que quiere saber «¿puedo leer?» está perfecto; para un agente es una trampa — recibe una
# muestra presentada como el conjunto, cuenta sobre ella, y devuelve porcentajes inventados con toda
# la confianza del mundo. La primera versión de esta herramienta hacía exactamente eso.
#
# Las credenciales SIGUEN viniendo del `.env.<target>` del trazador: se lee otra vez el mismo archivo,
# no se copia un token a ningún lado.
_UNIDADES = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def _env_loki():
    f = PLAYGROUND / "trazador" / f".env.{TARGET}"
    vals = {}
    for linea in f.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            k, v = linea.split("=", 1)
            vals[k.strip()] = v.strip()
    faltan = [k for k in ("LOKI_URL", "LOKI_USER", "LOKI_TOKEN") if not vals.get(k)]
    if faltan:
        raise KeyError(f"faltan {', '.join(faltan)} en trazador/.env.{TARGET}")
    return vals


def _segundos(desde):
    m = re.fullmatch(r"\s*(\d+)\s*([smhd])\s*", str(desde or "1h"))
    return int(m.group(1)) * _UNIDADES[m.group(2)] if m else 3600


def _loki(ruta, params):
    import base64, time as _t, urllib.parse, urllib.request
    try:
        v = _env_loki()
    except (OSError, KeyError) as e:
        return {"error": str(e)}
    ahora = int(_t.time())
    params = dict(params, end=f"{ahora}000000000")
    url = f"{v['LOKI_URL'].rstrip('/')}/loki/api/v1/{ruta}?" + urllib.parse.urlencode(params)
    cred = base64.b64encode(f"{v['LOKI_USER']}:{v['LOKI_TOKEN']}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {cred}"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        cuerpo = getattr(e, "read", lambda: b"")()[:300].decode("utf-8", "replace")
        return {"error": f"Loki respondió {e}. {cuerpo}".strip()
                         + "  ·  para diagnosticar el ACCESO: make trazador-acceso"}


def archivos_de_la_traza(selector, desde="1h", muestra=300):
    """QUÉ ARCHIVOS CORRIERON detrás de estas líneas de log, en orden de primera aparición.

    Es el salto de «leí logs» a «leí el código que los produjo»: resuelve cada mensaje contra el mapa
    precargado (`logs.json`, derivado del código) y devuelve archivos con su `h`, listo para
    `codigo_de_log`, `que_hay_en` o pedirlo entero. Medido sobre una traza real de producción: 101
    líneas → 6 archivos, 0 sin resolver.

    ⚠ Dice qué archivos DEJARON RASTRO, no cuáles se ejecutaron. Uno sin logs es invisible acá y eso
    no prueba que no corrió — un log ausente tiene cuatro causas indistinguibles.
    """
    import json as _j, re as _re
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import logs as _logs
    crudas = _lineas_crudas(selector, desde, max(30, min(int(muestra or 300), 900)))
    if isinstance(crudas, dict):
        return crudas
    msgs = []
    for _, _, c in crudas:
        try:
            msgs.append(_j.loads(c).get("message", ""))
        except Exception:
            g = _re.search(r'"message"\s*:\s*"((?:[^"\\]|\\.)*)"', c)
            if g:
                msgs.append(g.group(1))
    return _logs.archivos_de_traza([m for m in msgs if m])


def _lineas_crudas(selector, desde, lim):
    """Las líneas SIN recortar ni formatear. Existe separado porque `agrupar_logs` necesita el JSON
    entero para sacarle el `message`: si agrupara sobre lo que muestra `leer_logs` —ya truncado— el
    parseo fallaría siempre y agruparía por prefijo de JSON en vez de por mensaje."""
    import time as _t
    d = _loki("query_range", {"query": selector, "limit": lim,
                              "start": f"{int(_t.time()) - _segundos(desde)}000000000",
                              "direction": "backward"})
    if "error" in d:
        return d
    lineas = []
    for stream in d.get("data", {}).get("result", []):
        nivel = stream.get("stream", {}).get("level", "")
        for ns, texto in stream.get("values", []):
            lineas.append((int(ns), nivel, texto))
    lineas.sort(reverse=True)
    return lineas


def leer_logs(selector, desde="1h", limite=60):
    """Las líneas de log de Loki para un selector LogQL. Devuelve LAS QUE HAY, no una muestra.

    Ejemplos de selector:
      {service_name="legacy-backend"} |= "519245"
      {service_name="legacy-backend", level="error"} |= "Experian"
    Filtrá SIEMPRE por `service_name`, nunca por `environment`: el ambiente ya lo fija el stack."""
    import datetime as _dt
    lim = max(1, min(int(limite or 60), 300))
    lineas = _lineas_crudas(selector, desde, lim)
    if isinstance(lineas, dict):
        return lineas
    salida = [f"{_dt.datetime.fromtimestamp(ns / 1e9):%Y-%m-%d %H:%M:%S}  [{lvl or '-'}]  {txt[:280]}"
              for ns, lvl, txt in lineas]
    return {"selector": selector, "ventana": desde, "devueltas": len(salida),
            "tope_pedido": lim,
            "⚠": ("llegaste al tope: puede haber MÁS líneas de las que ves — para contar usá "
                  "`contar_logs`, no cuentes estas") if len(salida) >= lim else "",
            "lineas": salida[:lim]}


# Lo que el modelo intentaba hacer a mano: descubrir QUÉ TIPOS de error hay. Sin esto gastaba quince
# pasos disparando `contar_logs` contra frases que iba adivinando de las líneas que leía — y se quedaba
# sin presupuesto antes de contestar. Agrupar es trabajo de código, no de agente.
_RUIDO = [
    (re.compile(r"https?://[^\s\"']+"), "<url>"),
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I), "<uuid>"),
    (re.compile(r"\b[0-9a-f]{16,}\b", re.I), "<hex>"),
    (re.compile(r"\d+"), "N"),
    (re.compile(r"\s+"), " "),
]


def agrupar_logs(selector, desde="24h", muestra=300):
    """Agrupa las líneas por FORMA del mensaje y devuelve los tipos más frecuentes con un ejemplo.

    Es la herramienta para «¿qué errores está tirando X?»: contesta en un paso lo que si no son quince.
    ⚠ Agrupa sobre una MUESTRA (las más recientes de la ventana), así que sus conteos son de la muestra.
    Una vez que sabés qué tipos hay, contá cada uno de verdad con `contar_logs` y un filtro `|=`."""
    n = max(30, min(int(muestra or 300), 900))
    lineas = _lineas_crudas(selector, desde, n)
    if isinstance(lineas, dict):
        return lineas
    grupos = {}
    for _, _, crudo in lineas:
        # El mensaje viene en JSON; hay que parsearlo ENTERO — de ahí `_lineas_crudas`. Sacarle el
        # `message` es lo que hace que agrupe por «qué pasó» y no por «cómo empieza el JSON».
        try:
            cuerpo = json.loads(crudo).get("message", crudo)
        except Exception:
            cuerpo = crudo
        cuerpo = " ".join(str(cuerpo).split())
        forma = cuerpo[:150]
        for rx, rep in _RUIDO:
            forma = rx.sub(rep, forma)
        g = grupos.setdefault(forma.strip(), {"veces": 0, "ejemplo": cuerpo[:220]})
        g["veces"] += 1
    orden = sorted(grupos.items(), key=lambda kv: -kv[1]["veces"])[:15]
    return {
        "selector": selector, "ventana": desde,
        "lineas_en_la_muestra": len(lineas),
        "⚠": "los conteos son DE LA MUESTRA. Para el total real de un tipo, corré contar_logs con un "
             "filtro |= sobre una parte estable de su mensaje.",
        "tipos": [{"veces_en_la_muestra": v["veces"], "patron": k, "ejemplo": v["ejemplo"]}
                  for k, v in orden],
    }


def contar_logs(selector, desde="24h"):
    """CUÁNTAS líneas matchean un selector, contadas por Loki. Es la herramienta para «¿cuántas veces?».

    ⚠ No cuentes nunca las líneas que devuelve `leer_logs`: eso trae hasta un tope y contar una muestra
    como si fuera el total es la forma más fácil de devolver un porcentaje falso. Usá esto."""
    import time as _t
    # ⚠ INSTANTÁNEA (`/query`), no `/query_range`. Un range de una expresión `count_over_time([24h])`
    # devuelve UNA SERIE de ventanas de 24h SOLAPADAS, una por cada `step`, alineadas a límites
    # absolutos de tiempo — no un total. La primera versión de esto tomaba el `max()` de esa serie y
    # devolvía 35.036 donde el número real era 3.343: no estaba contando la ventana pedida, estaba
    # eligiendo la ventana solapada más grande, que cubre otro período. Un error más silencioso que
    # el que vino a arreglar, porque el resultado es un entero plausible.
    d = _loki("query", {"query": f"sum(count_over_time({selector} [{desde}]))",
                        "time": f"{int(_t.time())}000000000"})
    if "error" in d:
        return d
    r = d.get("data", {}).get("result", [])
    return {"selector": selector, "ventana": desde,
            "total": int(float(r[0]["value"][1])) if r else 0,
            "nota": "contado por Loki sobre la ventana entera, no sobre una muestra"}


def traza_de_solicitud(ureq):
    """La traza por ETAPAS de una solicitud (BD + logs cruzados): qué pasó, en qué orden y qué falló.
    Es la herramienta correcta para «¿qué le pasó a ESTA solicitud?» — mucho mejor que armar el SQL
    a mano, porque ya sabe qué tablas cruzar."""
    try:
        n = int(ureq)
    except (TypeError, ValueError):
        return {"error": "ureq tiene que ser un número de solicitud"}
    return _trazador("-ureq", str(n), timeout=300)


def historia_de_persona(q):
    """Todos los intentos de una persona, por cédula, teléfono o número de solicitud. Sirve para
    ver si un caso es aislado o el cliente viene reintentando."""
    v = re.sub(r"[^0-9+]", "", str(q))
    if not v:
        return {"error": "pasá una cédula, un teléfono o un número de solicitud"}
    return _trazador("-buscar", v, timeout=300)


import contexto as _ctx

HERRAMIENTAS = {
    # ⚠ La única herramienta de este agente que NO mide: va del log al CÓDIGO que lo emitió. Está acá
    # porque el circuito se cierra en este lado —quien acaba de leer una línea de error es quien
    # necesita saber de qué archivo salió— y porque la llave es el MENSAJE, que sólo se tiene después
    # de leer el log. La línea no trae el archivo: `extra_file` apunta al framework (medido en prod).
    "codigo_de_log": _ctx.HERRAMIENTAS["codigo_de_log"],

    "archivos_de_la_traza": ({
        "name": "archivos_de_la_traza",
        "description": "QUÉ ARCHIVOS corrieron detrás de un selector de logs, en orden de primera "
                       "aparición, con sus líneas y su `h`. Es el salto de «leí logs» a «leí el "
                       "código». Usalo con un selector acotado (un trace_id, un ureq, un error) — "
                       "sobre un selector ancho devuelve el mapa de todo, que no dice nada.",
        "parameters": {"type": "object", "properties": {
            "selector": {"type": "string", "description": "selector LogQL, acotado"},
            "desde": {"type": "string", "description": "ventana: '1h', '24h'"},
            "muestra": {"type": "integer", "description": "líneas a mirar (30-900, por defecto 300)"}},
            "required": ["selector"]},
    }, archivos_de_la_traza),

    "tablas": ({
        "name": "tablas",
        "description": "Qué tablas existen en la base, con su conteo aproximado de filas. `patron` "
                       "acota por nombre (ej. 'lender'). Barata. Usala antes de suponer un nombre.",
        "parameters": {"type": "object", "properties": {
            "patron": {"type": "string", "description": "subcadena del nombre; vacío = todas"}}},
    }, tablas),

    "esquema": ({
        "name": "esquema",
        "description": "Las columnas reales de una tabla, con tipo, nullable y default. Barata. "
                       "USALA ANTES DE ESCRIBIR CUALQUIER SELECT sobre una tabla que no miraste: "
                       "adivinar el nombre de una columna en CreditOp sale mal muy seguido.",
        "parameters": {"type": "object", "properties": {
            "tabla": {"type": "string", "description": "nombre exacto de la tabla"}},
            "required": ["tabla"]},
    }, esquema),

    "consultar_bd": ({
        "name": "consultar_bd",
        "description": "Corre UNA consulta de solo lectura (SELECT o WITH) y devuelve la tabla de "
                       "resultados. Poné siempre LIMIT. Una sentencia por llamada, sin ';' intermedio.",
        "parameters": {"type": "object", "properties": {
            "sql": {"type": "string", "description": "la consulta, empezando con SELECT o WITH"}},
            "required": ["sql"]},
    }, consultar_bd),

    "leer_logs": ({
        "name": "leer_logs",
        "description": "Lee líneas de Loki con un selector LogQL, p. ej. "
                       "'{service_name=\"legacy-backend\"} |= \"519245\"'. Filtrá por service_name, "
                       "nunca por environment. Sirve para VER el error crudo que la base no guarda. "
                       "⚠ Devuelve hasta un tope: si querés saber CUÁNTAS veces pasó, usá contar_logs.",
        "parameters": {"type": "object", "properties": {
            "selector": {"type": "string", "description": "selector LogQL, con sus filtros |= si hacen falta"},
            "desde": {"type": "string", "description": "ventana hacia atrás: '30m', '6h', '24h'. Por defecto 1h"},
            "limite": {"type": "integer", "description": "máximo de líneas (tope 300, por defecto 60)"}},
            "required": ["selector"]},
    }, leer_logs),

    "agrupar_logs": ({
        "name": "agrupar_logs",
        "description": "Los TIPOS de mensaje más frecuentes de un selector, agrupados por forma y con "
                       "un ejemplo de cada uno. Empezá SIEMPRE por acá cuando la pregunta sea «¿qué "
                       "errores hay?» — te da la taxonomía en un paso. Después contá cada tipo con "
                       "contar_logs. ⚠ Sus conteos son de una muestra, no el total.",
        "parameters": {"type": "object", "properties": {
            "selector": {"type": "string", "description": "selector LogQL"},
            "desde": {"type": "string", "description": "ventana: '1h', '24h'. Por defecto 24h"},
            "muestra": {"type": "integer", "description": "cuántas líneas mirar (30-900, por defecto 300)"}},
            "required": ["selector"]},
    }, agrupar_logs),

    "contar_logs": ({
        "name": "contar_logs",
        "description": "CUÁNTAS líneas matchean un selector en una ventana, contadas por Loki sobre la "
                       "ventana entera. Es la herramienta para «¿cuántas veces pasó?» y para cualquier "
                       "porcentaje. Nunca cuentes a mano las líneas de leer_logs: eso es una muestra.",
        "parameters": {"type": "object", "properties": {
            "selector": {"type": "string", "description": "selector LogQL con sus filtros"},
            "desde": {"type": "string", "description": "ventana: '1h', '24h', '7d'. Por defecto 24h"}},
            "required": ["selector"]},
    }, contar_logs),

    "traza_de_solicitud": ({
        "name": "traza_de_solicitud",
        "description": "La traza por etapas de UNA solicitud, cruzando base y logs. La herramienta "
                       "correcta para «¿qué le pasó a esta solicitud?». Tarda, pero evita armar el "
                       "cruce de tablas a mano.",
        "parameters": {"type": "object", "properties": {
            "ureq": {"type": "integer", "description": "el número de solicitud (user_requests.id)"}},
            "required": ["ureq"]},
    }, traza_de_solicitud),

    "historia_de_persona": ({
        "name": "historia_de_persona",
        "description": "Los intentos de una persona por cédula, teléfono o número de solicitud: "
                       "sirve para saber si un caso es aislado o viene reintentando.",
        "parameters": {"type": "object", "properties": {
            "q": {"type": "string", "description": "cédula, teléfono o número de solicitud"}},
            "required": ["q"]},
    }, historia_de_persona),
}


# ── el prompt ────────────────────────────────────────────────────────────────────────────────────
def _diccionario():
    """El vocabulario de negocio, de `creditop.json` (vecino). Va EMBEBIDO y no como herramienta:
    sin esto el agente escribe SQL sintácticamente válido contra las columnas equivocadas, y una
    consulta que corre y mide otra cosa es peor que una que falla."""
    f = Path(__file__).resolve().parent / "creditop.json"
    if not f.is_file():
        return ""
    d = json.loads(f.read_text(encoding="utf-8"))
    partes = []
    for clave, titulo in (("estados", "ESTADOS de la solicitud"), ("tablas", "TABLAS que importan"),
                          ("response_type", "RESPONSE_TYPE (el modo de la entidad)"),
                          ("lenders", "ENTIDADES por id"), ("allieds", "COMERCIOS por id")):
        v = d.get(clave)
        if not isinstance(v, dict):
            continue
        filas = [f"  {k}: {x}" for k, x in v.items() if not k.startswith("_")]
        notas = [f"  ⚠ {x}" for k, x in v.items() if k.startswith("_") and k != "_fuente"]
        partes.append(f"{titulo}\n" + "\n".join(notas + filas))
    return "\n\n".join(partes)


AMBIENTES = """\
local     tu Docker. El más barato y el único donde algo raro no significa nada: los datos son un dump.
dev       la BD compartida del equipo (`inertia-dev`). Datos de prueba de todos, sucios por definición.
staging   ⚠ ES LA MISMA BD QUE dev — literalmente. Un conteo en staging y uno en dev dan lo mismo.
prod      lo real. La ÚNICA fuente válida para «¿esto pasa de verdad, y cuánto?». Solo lectura, y las
          consultas quedan auditadas a nombre del token.
"""

INSTRUCCIONES = """\
Sos el agente que MIDE de CreditOp (fintech colombiana de originación de crédito). No leés código:
contestás con lo que muestran la base de datos y los logs REALES.

⚠ ESTÁS CORRIENDO CONTRA: **{target}**. No lo podés cambiar y no hace falta que lo pidas — todas tus
herramientas van a ese ambiente y a ninguno más. Todo número que devuelvas es de ahí, y tenés que
decirlo al contestar.

LOS AMBIENTES, para que sepas qué vale lo que estás midiendo:
{ambientes}

CÓMO TRABAJÁS:
0. **Decidí la consulta que contesta ANTES de empezar a correr consultas.** Tenés un presupuesto de
   pasos y se agota: refinar la misma medición ocho veces gasta el presupuesto y te deja sin llegar a
   la respuesta. Mirá el esquema, pensá cuál es LA consulta, corrémela, y contestá.
1. **Mirá el esquema antes de escribir SQL.** `esquema` y `tablas` son baratas. Adivinar un nombre de
   columna en este sistema sale mal seguido, y el modo de falla peligroso no es que la consulta
   reviente: es que corra y mida otra cosa.
2. **Empezá chico.** Un COUNT antes que un listado; un LIMIT 20 antes que 5.000 filas. Cada resultado
   se arrastra en todas las vueltas siguientes de esta conversación.
3. **Un número solo no dice nada.** «847 solicitudes en estado 3» no significa nada sin el total ni
   la ventana de tiempo. Traé siempre el denominador y el período.
4. **No confundas ausencia con prueba.** Que una consulta devuelva 0 filas puede ser que no pasa…
   o que estás mirando la columna equivocada, o un ambiente donde eso no se usa. Cuando un 0 sea la
   respuesta, verificá que la consulta encuentra ALGO con un filtro más flojo antes de afirmarlo.
5. **Los logs son complemento, no respaldo.** Loki guarda una ventana corta: que no haya líneas de
   hace tres meses no quiere decir que no pasó. Para «¿cuántas veces?» manda la base.

LAS ETIQUETAS DE LOKI — esto es TODO lo que hay; no tantees filtros de texto para lo que ya es etiqueta:
- `service_name`: legacy-backend · legacy-application · form-service · merchant-api ·
  customer-profiling-service · customer-service · financial-health-service · merchant-gateways-service
- `level`: error · warning · info · debug — **los errores se piden `{{..., level="error"}}`**, NO con
  `|= "error"` (eso matchea la palabra en cualquier parte y se pierde los que no la dicen)
- `lender`: el slug de la entidad cuando la línea es de una integración (ej. bancolombia_bnpl)
- los `|=`/`|~` son para el CONTENIDO del mensaje, no para lo que ya está etiquetado

EL PROTOCOLO PARA «¿QUÉ ERRORES HAY?» — tres movimientos, no veinte:
1. `agrupar_logs` con `{{service_name="...", level="error"}}` → la taxonomía completa, UNA vez.
2. `contar_logs` del selector entero → el denominador.
3. `contar_logs` de cada tipo que importe, con un `|=` de una frase estable de su mensaje → numeradores.
No repitas `agrupar_logs` con variaciones del selector: la taxonomía no cambia por pedirla distinto.

CÓMO CONTESTÁS — corto, y en este orden:
1. La respuesta en una línea, con el ambiente y el período entre paréntesis.
2. Los números que la sostienen, con la consulta que los produjo (pegá el SQL, corto).
3. Lo que NO pudiste medir, si algo quedó afuera. Esto no es opcional.
4. Si algo te llamó la atención y no era la pregunta, decilo al final en una línea.

⚠ Nunca completes un número que no mediste. Si una herramienta falló, decí que falló. Tu único valor
frente a leer el código es que ESTO PASÓ DE VERDAD; un número inventado destruye esa ventaja entera.

⚠ Nunca pongas datos personales del cliente en tu informe — ni cédulas, ni teléfonos, ni correos,
aunque los hayas visto en una fila o en un log. Referite a las personas por `user_id` o por número de
solicitud.

EL VOCABULARIO DEL NEGOCIO — usalo para escribir el SQL, y creele a las trampas marcadas con ⚠:
{diccionario}
"""


def main():
    global TARGET
    args = [a for a in sys.argv[1:]]
    if "--target" in args:
        i = args.index("--target")
        if i + 1 >= len(args) or args[i + 1] not in TARGETS:
            print(f"--target tiene que ser uno de: {', '.join(TARGETS)}", file=sys.stderr)
            return 2
        TARGET = args[i + 1]
        del args[i:i + 2]

    pregunta = " ".join(args).strip()
    if not pregunta:
        print(__doc__.strip().split("\n\n")[1])
        return 2

    if not TRAZADOR.is_dir():
        print(f"no encuentro el trazador en {TRAZADOR}", file=sys.stderr)
        return 1
    if not (PLAYGROUND / "trazador" / f".env.{TARGET}").is_file():
        print(f"falta trazador/.env.{TARGET} — sin credenciales para ese ambiente", file=sys.stderr)
        return 1

    try:
        cfg = gemini.config()
        # Un agente que MIDE gasta un paso por consulta, y una medición honesta necesita varias: el
        # esquema, el numerador, el denominador, y el control de que un 0 sea un 0 de verdad. Con el
        # presupuesto de un seleccionador (12) se queda sin pasos justo antes de contestar — medido.
        cfg["max_pasos"] = max(cfg["max_pasos"], 22)
        aviso = "  ⚠ PRODUCCIÓN (solo lectura, auditado)" if TARGET == "prod" else ""
        print(f"\n¿? {pregunta}\n\nambiente: {TARGET}{aviso}  ·  modelo: {cfg['modelo']}\n")
        respuesta = gemini.correr(
            pregunta, HERRAMIENTAS,
            INSTRUCCIONES.format(target=TARGET, ambientes=AMBIENTES, diccionario=_diccionario()),
            cfg)
        print(respuesta)
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
