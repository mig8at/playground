"""Una consulta HDC Plus a Experian UAT con la cuenta de Finandina (llavero finandina-experian).

Replica ExperianAciertaClient de legacy-backend. No imprime credenciales ni el token.
La respuesta completa queda en el archivo que se pasa como argumento.
"""
import json, os, sys, uuid, urllib.request, urllib.error
from datetime import datetime, timezone
from urllib.parse import urlsplit

doc, last_name, out = sys.argv[1], sys.argv[2], sys.argv[3]
E = os.environ
host = "{0.scheme}://{0.netloc}".format(urlsplit(E["URL"]))
ip = urllib.request.urlopen("https://api.ipify.org", timeout=10).read().decode()

def post(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

cred = {"Client_Id": E["CLIENT_ID"], "Client_Secret": E["CLIENT_SECRET"]}
st, txt = post(E["AUTH_URL"], cred, {"username": E["AUTH_USERNAME"], "password": E["AUTH_PASSWORD"]})
print("token:", st)
if st != 200:
    print(txt[:400]); sys.exit(1)
tok = json.loads(txt)
auth = f"{tok.get('token_type', 'Bearer')} {tok['access_token']}"

body = {
    "user": E["USUARIO"],
    "password": E["CLAVE"],
    "identifyingTrx": {
        "requestUUID": str(uuid.uuid4()),
        "dateTime": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "originatorChannelName": "CREDITOP",
        "originatorChannelType": "42",
    },
    "identifyingUser": {"person": {"personId": {"personIdNumber": doc, "personIdType": 1},
                                   "personLastName": last_name.upper()}},
    "parameters": [{"type": "0", "nameParameter": "codigos", "valueParameter": "TOM-001"}],
}
headers = {**cred, "serverIpAddress": ip, "InfoAccountType": "1", "ProductId": "64", "Authorization": auth}
st, txt = post(E["URL"], headers, body)
print("consulta:", st)
with open(out, "w") as f:
    f.write(txt)
print("guardada en", out, f"({len(txt)} bytes)")
