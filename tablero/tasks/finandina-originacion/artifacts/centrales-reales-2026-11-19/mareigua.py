"""Una consulta a Mareigua real con la cuenta de Finandina (llavero finandina-mareigua), como legacy-backend.

POST /token (grant_type=password) y, si da token, POST /consultas (producto 20). No imprime credenciales ni token.
Guarda en el archivo de salida: el estado y el cuerpo de cada paso.
"""
import json, os, sys, urllib.request, urllib.error, urllib.parse

doc, out = sys.argv[1], sys.argv[2]
HOST = "https://macia.wikiplata.com:44375"
E = os.environ

def call(path, data, headers):
    req = urllib.request.Request(HOST + path, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:  # red, certificado
        return 0, f"{type(e).__name__}: {e}"

result = {"host": HOST}
form = urllib.parse.urlencode({"grant_type": "password", "username": E["FINANDINA_MAREIGUA_USERNAME"], "password": E["FINANDINA_MAREIGUA_PASSWORD"]}).encode()
st, txt = call("/token", form, {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
try:
    body = json.loads(txt)
except Exception:
    body = txt
token = body.get("access_token") if isinstance(body, dict) else None
if isinstance(body, dict) and token:
    body = {k: ("<token>" if k == "access_token" else v) for k, v in body.items()}
result["token"] = {"status": st, "body": body}
print("token:", st)
if token:
    q = json.dumps({"tipo_identificacion_id": 1, "NumeroEmpleado_id": doc, "producto_id": 20}).encode()
    st, txt = call("/consultas", q, {"Content-Type": "application/json", "Accept": "application/json", "Authorization": f"Bearer {token}"})
    try:
        result["consulta"] = {"status": st, "body": json.loads(txt)}
    except Exception:
        result["consulta"] = {"status": st, "body": txt}
    print("consulta:", st)
json.dump(result, open(out, "w"), ensure_ascii=False, indent=2)
print("guardado en", out)
