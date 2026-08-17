"""Cliente mínimo de Gemini con function calling — el BUCLE, que es lo único que hay que entender.

No sabe nada de CreditOp a propósito: un agente concreto (ver `frontend.py`) le pasa sus herramientas y
su pregunta, y esto se encarga de la mecánica. El próximo agente reusa este archivo tal cual.

Solo stdlib (`urllib`), Python 3.9 del sistema: sin `pip install` y sin venv. Misma decisión que el
credibot de Duncan.

CÓMO ES EL BUCLE, que es todo el secreto:

    1. mandás   → [pregunta del usuario] + [declaración de las herramientas]
    2. contesta → o una `functionCall` («corré `commits_recientes(rama='develop')`»)
                  o texto («la respuesta es …»)
    3. si pidió función: LA CORRÉS VOS, no el modelo. Le devolvés el resultado como `functionResponse`
       y volvés al paso 2 con toda la conversación acumulada.
    4. termina cuando contesta texto, o cuando se acaban los pasos.

El modelo NUNCA ejecuta nada. Elige qué se ejecuta; el código decide qué existe y qué hace.
"""
import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
API = "https://generativelanguage.googleapis.com/v1beta"
# ⚠ 300 y no 120. Un agente que rutea acumula TODO en la conversación —el índice, cada doc que abre,
# cada tramo de código— así que las últimas vueltas mandan un payload grande y tardan. Con 120 s el
# agente de contexto se cortaba en el paso 5, después de haber ruteado bien: se perdía todo el trabajo
# por el final. Si igual se corta, el problema no es el tope: es cuánto se está acumulando.
TIMEOUT = 300


class GeminiError(Exception):
    pass


# ── configuración ────────────────────────────────────────────────────────────────────────────────
def config():
    """Lee `.env` de esta carpeta. `process.env` gana, igual que en el resto del playground."""
    vals = dict(os.environ)
    env = RAIZ / ".env"
    if env.exists():
        for linea in env.read_text(encoding="utf-8").splitlines():
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            k, v = linea.split("=", 1)
            vals.setdefault(k.strip(), v.strip().strip('"').strip("'"))

    key = vals.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise GeminiError(
            "Falta GEMINI_API_KEY.\n"
            "  1. Sacá una key en https://aistudio.google.com/apikey\n"
            f"  2. cp {RAIZ}/.env.example {RAIZ}/.env\n"
            "  3. pegala en GEMINI_API_KEY"
        )
    return {
        "key": key,
        "modelo": vals.get("GEMINI_MODEL", "gemini-2.5-flash").strip(),
        "max_pasos": int(vals.get("MAX_PASOS", "12")),
    }


# ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────
def _pedir(ruta, key, cuerpo=None):
    url = f"{API}/{ruta}?key={urllib.parse.quote(key)}"
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(
        url, data=datos, method="POST" if datos else "GET",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detalle = e.read()[:400].decode("utf-8", "replace")
        # El error de la API es útil pero viene envuelto: lo desenvolvemos, y traducimos los dos
        # casos que de verdad pasan — porque un mensaje que no dice la verdad cuesta media hora.
        try:
            detalle = json.loads(detalle)["error"]["message"]
        except Exception:
            pass
        if e.code in (400, 403) and "API key" in detalle:
            raise GeminiError(f"La API key no sirve ({e.code}): {detalle}")
        if e.code == 404:
            raise GeminiError(
                f"El modelo no existe o tu key no lo tiene habilitado ({e.code}): {detalle}\n"
                "Corré `make agente-modelos` para ver cuáles SÍ podés usar y poné uno en GEMINI_MODEL."
            )
        if e.code == 429:
            raise GeminiError(f"Cuota agotada o demasiadas llamadas ({e.code}): {detalle}")
        raise GeminiError(f"HTTP {e.code}: {detalle}")
    except (socket.timeout, TimeoutError):
        # No lo cubre URLError: sin este caso salía un traceback de 30 líneas que no dice qué pasó.
        raise GeminiError(
            f"La API no contestó en {TIMEOUT} s.\n"
            "Casi siempre es que la conversación se hizo grande: cada herramienta que corre queda "
            "acumulada y el payload crece vuelta a vuelta.\n"
            "Qué hacer: pedirle al agente que lea RANGOS de archivo en vez de archivos enteros, o "
            "acotar la pregunta. Subir el timeout tapa el síntoma, no la causa."
        )
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), socket.timeout):
            raise GeminiError(f"La API no contestó en {TIMEOUT} s (la conversación puede estar muy grande).")
        raise GeminiError(f"No se pudo llegar a la API: {e.reason}")


def modelos(key):
    """Los modelos que ESTA key puede usar hoy. Contra suponer un nombre que ya no existe."""
    d = _pedir("models", key)
    salida = []
    for m in d.get("models", []):
        if "generateContent" in m.get("supportedGenerationMethods", []):
            salida.append((m["name"].replace("models/", ""), m.get("displayName", "")))
    return sorted(salida)


# ── el bucle ─────────────────────────────────────────────────────────────────────────────────────
def correr(pregunta, herramientas, instrucciones="", cfg=None, verboso=True, terminales=()):
    """Corre un agente hasta que conteste.

    `herramientas` es un dict {nombre: (declaración, función python)}:
      - declaración = el esquema que ve el modelo (name, description, parameters)
      - función     = lo que se ejecuta de verdad, y devuelve algo serializable

    `terminales` son nombres de herramientas que TERMINAN el bucle: se ejecutan y su resultado es la
    respuesta. Sirve para que la salida sea ESTRUCTURADA en vez de prosa — el modelo no «escribe» una
    lista, llama a una función con la lista, y así llega tipada y lista para que la consuma otro agente.
    Sin esto, pedir estructura obliga a parsear texto, que es donde se rompe.

    Devuelve el texto final (o el dict de la terminal). Si se acaban los pasos, lo dice en vez de
    mentir con una respuesta a medias.
    """
    cfg = cfg or config()
    declaraciones = [d for d, _ in herramientas.values()]
    contenidos = [{"role": "user", "parts": [{"text": pregunta}]}]

    cuerpo_base = {"tools": [{"function_declarations": declaraciones}]}
    if instrucciones:
        cuerpo_base["system_instruction"] = {"parts": [{"text": instrucciones}]}

    for paso in range(1, cfg["max_pasos"] + 1):
        cuerpo = dict(cuerpo_base, contents=contenidos)
        if verboso:
            # Mostrar cuánto se acumula hace visible lo que si no aparece sólo como «está lento»:
            # la conversación crece con CADA resultado de herramienta, y eso es lo que hay que
            # gobernar (leer rangos, no archivos enteros).
            kb = len(json.dumps(contenidos)) / 1024
            print(f"  ({kb:,.0f} KB acumulados)", end="  ", flush=True)
        r = _pedir(f"models/{cfg['modelo']}:generateContent", cfg["key"], cuerpo)

        candidatos = r.get("candidates") or []
        if not candidatos:
            # Sin candidatos suele ser un filtro de seguridad: decirlo es mejor que devolver vacío.
            raise GeminiError(f"La API no devolvió candidatos. Respuesta cruda: {json.dumps(r)[:300]}")

        partes = candidatos[0].get("content", {}).get("parts", []) or []
        llamadas = [p["functionCall"] for p in partes if "functionCall" in p]

        if not llamadas:
            texto = "".join(p.get("text", "") for p in partes).strip()
            if verboso:
                print(f"  · contestó en el paso {paso}\n")
            return texto or "(el modelo no devolvió texto)"

        # Guardamos lo que pidió el modelo y ejecutamos NOSOTROS.
        contenidos.append({"role": "model", "parts": partes})
        respuestas = []
        for lc in llamadas:
            nombre, args = lc.get("name", ""), lc.get("args", {}) or {}
            if verboso:
                firma = ", ".join(f"{k}={v!r}" for k, v in args.items())
                print(f"  [{paso}] {nombre}({firma})")
            par = herramientas.get(nombre)
            if not par:
                resultado = {"error": f"no existe la herramienta '{nombre}'"}
            else:
                try:
                    resultado = par[1](**args)
                except Exception as e:
                    # El error se le DEVUELVE al modelo en vez de reventar: así puede corregir el
                    # argumento y reintentar, que es media gracia de tener un bucle.
                    resultado = {"error": f"{type(e).__name__}: {e}"}
                if nombre in terminales and not (isinstance(resultado, dict) and "error" in resultado):
                    if verboso:
                        print(f"  · entregó en el paso {paso}\n")
                    return resultado
            respuestas.append({
                "functionResponse": {"name": nombre, "response": {"resultado": resultado}}
            })
        contenidos.append({"role": "user", "parts": respuestas})

    return (
        f"(sin respuesta: se agotaron los {cfg['max_pasos']} pasos)\n"
        "Subí MAX_PASOS en .env, o mirá arriba si el agente está pidiendo la misma herramienta en "
        "círculo — eso suele ser una descripción de herramienta que no dice bien qué devuelve."
    )


# El único punto de entrada directo del cliente: ¿qué modelos habilita la key HOY? Vivía en
# `frontend.py --modelos` — al retirarse ese agente, la utilidad se mudó a su dueño natural.
if __name__ == "__main__":
    import sys as _sys
    if "--modelos" in _sys.argv:
        try:
            _cfg = config()
            print(f"Modelos disponibles para tu key (el configurado es «{_cfg['modelo']}»):\n")
            for _n, _t in modelos(_cfg["key"]):
                print(f" {'→' if _n == _cfg['modelo'] else ' '} {_n:42} {_t}")
        except GeminiError as _e:
            print(f"\n{_e}", file=_sys.stderr)
            raise SystemExit(1)
    else:
        print("gemini.py es el CLIENTE, no un agente. Único modo directo: --modelos", file=_sys.stderr)
        raise SystemExit(2)
