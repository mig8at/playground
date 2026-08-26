#!/usr/bin/env python3
"""Sondeo de SOLO LECTURA de las credenciales de Twilio de twilio/.env.

Sólo hace GET (y el POST del canje de token OAuth, que no escribe nada). No manda mensajes.
Cada 401 de Twilio IMPRIME EL NOMBRE DEL PERMISO QUE FALTA: es la forma barata de saber
qué checkbox pedir en la consola sin adivinar.

  ./probe.py              app OAuth (OQ/CLIENT_SECRET): identidad + inventario de permisos
  ./probe.py <url>        un GET puntual con el bearer del app OAuth
  ./probe.py key          API Key (SK + SECRET): inventario REAL de la cuenta
  ./probe.py key <url>    un GET puntual con Basic auth de la API Key
  ./probe.py tpl          los templates de la cuenta y su estado de aprobacion en Meta
"""
import base64
import datetime
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

ENV = pathlib.Path(__file__).with_name(".env")


def load_env():
    out = {}
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    out.update({k: v for k, v in os.environ.items() if k.startswith("TWILIO_")})
    return out


def call(url, headers=None, data=None):
    """Devuelve (status, dict|texto). Nunca levanta por un 4xx."""
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            body, code = r.read(), r.status
    except urllib.error.HTTPError as e:
        body, code = e.read(), e.code
    except urllib.error.URLError as e:
        return 0, f"(red: {e.reason})"
    try:
        return code, json.loads(body)
    except Exception:
        return code, body[:120].decode("utf8", "replace")


def why(code, body):
    """Traduce la respuesta a una línea corta; el 401 revela el permiso que falta."""
    if isinstance(body, str):
        return body
    msg = body.get("message", "")
    if "required permission" in msg:
        return "FALTA  " + msg.split("required permission ")[-1].split(" is missing")[0]
    if code != 200:
        return msg or json.dumps(body)[:150]
    for k in ("accounts", "services", "contents", "incoming_phone_numbers",
              "messages", "usage_records", "content"):
        if isinstance(body.get(k), list):
            return f"{len(body[k])} items"
    return "OK"


def row(label, code, body):
    print(f"{code:<4} {label:<58} {why(code, body)}")


# ------------------------------------------------------------------ app OAuth
def oauth_token(env):
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": env["TWILIO_CLIENT_ID"],
        "client_secret": env["TWILIO_CLIENT_SECRET"],
    }).encode()
    code, d = call("https://iam.twilio.com/v1/token",
                   {"Content-Type": "application/x-www-form-urlencoded"}, body)
    if code not in (200, 201):
        sys.exit(f"el canje del token falló ({code}): {d}")
    return d["access_token"]


def modo_oauth(env, url=None):
    tok = oauth_token(env)
    hdr = {"Authorization": "Bearer " + tok}
    if url:
        row("GET", *call(url, hdr))
        return

    p = tok.split(".")[1]
    p = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
    org = p["act"]["sub"].split(":")[-1]
    exp = datetime.datetime.fromtimestamp(p["exp"], datetime.UTC).isoformat()
    print("### identidad del token (payload del JWT, sin el token)")
    print("  oauth app   :", p["sub"].split(":")[-1])
    print("  organizacion:", org)
    print("  audiencia   :", p["aud"], "| region:", p.get("urn:tw:rgn"))
    print("  vence       :", exp, f'({p["exp"] - p["iat"]}s de vida, sin refresh token)')
    print("  scopes      :", p.get("scope", "(ninguno en el JWT: los resuelve el server)"))

    iam = "https://preview-iam.twilio.com/Organizations/" + org
    print("\n### IAM  (⚠ la ruta va SIN /v1, y Scope quiere el SID crudo, no el trn:...)")
    row("RoleAssignments?Scope=<ORG>", *call(f"{iam}/RoleAssignments?Scope={org}", hdr))
    row("Accounts (cuentas de la organizacion)", *call(f"{iam}/Accounts", hdr))
    row("api/2010-04-01/Accounts.json", *call("https://api.twilio.com/2010-04-01/Accounts.json", hdr))

    print("\n### productos — el nombre del permiso que pediria cada uno")
    for label, u in [
        ("content templates (los HX…)", "https://content.twilio.com/v1/Content"),
        ("messaging services (MG…)", "https://messaging.twilio.com/v1/Services"),
        ("mensajes", "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json"),
        ("Verify", "https://verify.twilio.com/v2/Services"),
        ("Monitor (eventos de auditoria)", "https://monitor.twilio.com/v1/Events"),
        ("Studio", "https://studio.twilio.com/v2/Flows"),
        ("Event Streams", "https://events.twilio.com/v1/Sinks"),
        ("Phone Numbers (compliance)", "https://numbers.twilio.com/v2/RegulatoryCompliance/Bundles"),
    ]:
        row(label, *call(u, hdr))


# -------------------------------------------------------------------- API Key
def modo_key(env, url=None):
    sid, secret = env.get("TWILIO_API_KEY"), env.get("TWILIO_API_SECRET")
    if not sid:
        sys.exit("falta TWILIO_API_KEY (el SID SK… de la clave)")
    if not secret:
        sys.exit('falta TWILIO_API_SECRET — el valor de «Paso 2 de 2: Copia secreta».\n'
                 'Se muestra UNA sola vez; si ya cerraste la pantalla, hay que crear otra key.')
    hdr = {"Authorization": "Basic " + base64.b64encode(f"{sid}:{secret}".encode()).decode()}
    if url:
        row("GET", *call(url, hdr))
        return

    print("### la cuenta a la que pertenece la key")
    code, d = call("https://api.twilio.com/2010-04-01/Accounts.json", hdr)
    if code != 200:
        sys.exit(f"  no autentica ({code}): {why(code, d)}")
    for a in d["accounts"]:
        print(f'  {a["sid"]}  {a["status"]:<9} {a["type"]:<8} {a["friendly_name"]}')
    ac = d["accounts"][0]["sid"]

    print("\n### qué alcanza (⚠ sin cuerpos de mensaje: traen OTPs y teléfonos de clientes)")
    for label, u in [
        ("content templates (los HX…)", "https://content.twilio.com/v1/Content?PageSize=50"),
        ("templates + aprobación de Meta", "https://content.twilio.com/v1/ContentAndApprovals?PageSize=50"),
        ("messaging services (MG…)", "https://messaging.twilio.com/v1/Services?PageSize=50"),
        ("números propios", f"https://api.twilio.com/2010-04-01/Accounts/{ac}/IncomingPhoneNumbers.json?PageSize=50"),
        ("mensajes (sólo el conteo)", f"https://api.twilio.com/2010-04-01/Accounts/{ac}/Messages.json?PageSize=5"),
        ("Verify services", "https://verify.twilio.com/v2/Services?PageSize=20"),
        ("consumo del mes pasado", f"https://api.twilio.com/2010-04-01/Accounts/{ac}/Usage/Records/LastMonth.json?PageSize=5"),
    ]:
        row(label, *call(u, hdr))

    print("\n### los templates, en detalle")
    code, d = call("https://content.twilio.com/v1/ContentAndApprovals?PageSize=50", hdr)
    if code != 200:
        print(" ", why(code, d))
        return
    items = d.get("contents") or d.get("content") or []
    if not items:
        print("  (ninguno en esta cuenta — ojo: los templates son POR CUENTA)")
        return
    for c in items:
        tipos = ",".join((c.get("types") or {}).keys())
        ap = (c.get("approval_requests") or {})
        estado = ap.get("status") or "-"
        print(f'  {c["sid"]}  {c.get("language", "?"):<6} {estado:<10} '
              f'{(c.get("friendly_name") or "")[:36]:<36} [{tipos}]')


# ------------------------------------------------------------------ templates
def modo_tpl(env):
    """Los templates de la cuenta y en que anda su aprobacion de Meta."""
    sid, secret = env.get("TWILIO_SID"), env.get("TWILIO_TOKEN")
    if not (sid and secret):
        sys.exit("faltan TWILIO_SID / TWILIO_TOKEN en .env")
    hdr = {"Authorization": "Basic " + base64.b64encode(f"{sid}:{secret}".encode()).decode()}
    code, d = call("https://content.twilio.com/v1/ContentAndApprovals?PageSize=50", hdr)
    if code != 200:
        sys.exit(f"HTTP {code}: {why(code, d)}")
    items = d.get("contents") or []
    print(f"### {len(items)} templates en la cuenta {sid}")
    print("#   unsubmitted = creado, sin mandar a Meta | received/pending = en revision")
    print("#   approved = usable para INICIAR conversacion | rejected = mira rejection_reason\n")
    for t in items:
        ap = t.get("approval_requests") or {}
        est = ap.get("status") or "unsubmitted"
        marca = {"approved": "✅", "rejected": "❌", "unsubmitted": "·"}.get(est, "⏳")
        print(f'{marca} {t["sid"]}  {est:<12} {ap.get("category") or "-":<14} {t["friendly_name"]}')
        print(f'    types: {", ".join((t.get("types") or {}).keys())}')
        if ap.get("rejection_reason"):
            print(f'    RECHAZO: {ap["rejection_reason"]}')
    return items


if __name__ == "__main__":
    env = load_env()
    args = sys.argv[1:]
    if args and args[0] == "tpl":
        modo_tpl(env)
    elif args and args[0] == "key":
        modo_key(env, args[1] if len(args) > 1 else None)
    else:
        modo_oauth(env, args[0] if args else None)
