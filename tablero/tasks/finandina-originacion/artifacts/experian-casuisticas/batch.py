"""Consulta en el ambiente de pruebas de Experian (UAT) las cédulas de la base de casuísticas, con la cuenta de Finandina
(llavero finandina-experian), y compara lo que devuelve con lo que dice el Excel.

Replica ExperianAciertaClient de legacy-backend, como ../centrales-reales-2026-11-19/hdcplus.py, pero con UN token para
varias consultas. No imprime credenciales ni el token. Cada respuesta completa queda en responses/<cédula>.json.

    bin/pg vault run --ring finandina-experian -- python3 -I batch.py <filas>     # filas: 1-5, 7, 12 (1 = la primera cédula)
"""
import json, os, re, sys, uuid, glob, zipfile, urllib.request, urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

def rows():
    """Las filas del Excel como diccionarios, leído con la biblioteca estándar."""
    path = glob.glob(os.path.join(HERE, "*.xlsx"))[0]
    z = zipfile.ZipFile(path)
    ss = ["".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    out = []
    for r in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).findall(".//m:row", NS):
        vals = []
        for c in r.findall("m:c", NS):
            v = c.find("m:v", NS)
            x = v.text if v is not None else ""
            vals.append(ss[int(x)] if c.get("t") == "s" else x)
        out.append(vals)
    head = out[0]
    return [dict(zip(head, v)) for v in out[1:]]

def pick(spec, n):
    idx = set()
    for part in spec.replace(" ", "").split(","):
        a, _, b = part.partition("-")
        idx.update(range(int(a), int(b or a) + 1))
    return [i for i in sorted(idx) if 1 <= i <= n]

def first_last_name(full):
    """El primer apellido: «DE MOYA GARCIA …» → «DE MOYA»."""
    w = full.split()
    return " ".join(w[:2]) if w and w[0] in ("DE", "DEL") else (w[0] if w else "")

E = os.environ
def post(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

data = rows()
chosen = pick(sys.argv[1] if len(sys.argv) > 1 else "1-3", len(data))
ip = urllib.request.urlopen("https://api.ipify.org", timeout=10).read().decode()
cred = {"Client_Id": E["CLIENT_ID"], "Client_Secret": E["CLIENT_SECRET"]}
st, txt = post(E["AUTH_URL"], cred, {"username": E["AUTH_USERNAME"], "password": E["AUTH_PASSWORD"]})
print("token:", st)
if st != 200:
    print(txt[:300]); sys.exit(1)
tok = json.loads(txt)
auth = f"{tok.get('token_type', 'Bearer')} {tok['access_token']}"
headers = {**cred, "serverIpAddress": ip, "InfoAccountType": "1", "ProductId": "64", "Authorization": auth}

print("fila | cédula | código | nombre igual | modelos (código:score) | Excel Acierta/Advance/Advance 1.1 | listas con datos")
for i in chosen:
    r = data[i - 1]
    doc, full = r["Number ID"], r["Name"]
    body = {
        "user": E["USUARIO"], "password": E["CLAVE"],
        "identifyingTrx": {"requestUUID": str(uuid.uuid4()), "dateTime": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                           "originatorChannelName": "CREDITOP", "originatorChannelType": "42"},
        "identifyingUser": {"person": {"personId": {"personIdNumber": doc, "personIdType": 1}, "personLastName": first_last_name(full)}},
        "parameters": [{"type": "0", "nameParameter": "codigos", "valueParameter": "TOM-001"}],
    }
    st, txt = post(E["URL"], headers, body)
    with open(os.path.join(HERE, "responses", f"{doc}.json"), "w") as f:
        f.write(txt)
    try:
        rep = json.loads(txt).get("ReportHDCplus", {})
    except ValueError:
        print(f"{i} | {doc} | HTTP {st} | sin JSON"); continue
    pr = rep.get("productResult", {})
    name = (rep.get("basicInformation") or {}).get("fullName", "")
    models = ", ".join(f"{m.get('modelCode')}:{m.get('scoreValue')}" for m in rep.get("models") or [])
    lists = ", ".join(f"{k} {len(v)}" for k, v in rep.items() if isinstance(v, list) and v and k not in ("models",))
    same = "sí" if name.split() and set(name.split()) == set(full.split()) else (f"no ({name})" if name else "—")
    print(f"{i} | {doc} | {pr.get('responseCode')} {str(pr.get('responseDesc') or '')[:40]} | {same} | {models or '—'} | "
          f"{r['Acierta']}/{r['Advance Score']}/{r['Advance Score 1_1']} | {lists or '—'}")
