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
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
API = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT = 120


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
    except urllib.error.URLError as e:
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
def correr(pregunta, herramientas, instrucciones="", cfg=None, verboso=True):
    """Corre un agente hasta que conteste.

    `herramientas` es un dict {nombre: (declaración, función python)}:
      - declaración = el esquema que ve el modelo (name, description, parameters)
      - función     = lo que se ejecuta de verdad, y devuelve algo serializable

    Devuelve el texto final. Si se acaban los pasos, lo dice en vez de mentir con una respuesta a medias.
    """
    cfg = cfg or config()
    declaraciones = [d for d, _ in herramientas.values()]
    contenidos = [{"role": "user", "parts": [{"text": pregunta}]}]

    cuerpo_base = {"tools": [{"function_declarations": declaraciones}]}
    if instrucciones:
        cuerpo_base["system_instruction"] = {"parts": [{"text": instrucciones}]}

    for paso in range(1, cfg["max_pasos"] + 1):
        cuerpo = dict(cuerpo_base, contents=contenidos)
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
            respuestas.append({
                "functionResponse": {"name": nombre, "response": {"resultado": resultado}}
            })
        contenidos.append({"role": "user", "parts": respuestas})

    return (
        f"(sin respuesta: se agotaron los {cfg['max_pasos']} pasos)\n"
        "Subí MAX_PASOS en .env, o mirá arriba si el agente está pidiendo la misma herramienta en "
        "círculo — eso suele ser una descripción de herramienta que no dice bien qué devuelve."
    )
