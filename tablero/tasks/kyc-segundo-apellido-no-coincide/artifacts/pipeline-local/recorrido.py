#!/usr/bin/env python3
"""Recorrido completo del pipeline de KYC v2 en LOCAL, como lo hace el wizard.

Por caso: dicta al mock local de centrales (:8105) lo que contesta cada central para la cédula,
registra el teléfono (v1), valida el OTP (v2), guarda datos personales (v2), arranca el pipeline en
customer-profiling-service (:8082), espera a que termine o pida algo, y lee `users`.

Sólo local: backend en http://localhost, mock en :8105, servicio en :8082.
"""
import json, subprocess, sys, time, urllib.request, urllib.error, random

API = "http://localhost"
CPS = "http://localhost:8082"
MOCK = "http://localhost:8105"
BRANCH = "76db47f5"   # Sonría · RESTREPO (comercio 26, encendido en kyc_pipeline_allieds local)
PARTNER = 26


def http(method, url, body=None, timeout=60):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"content-type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:300].decode(errors="replace")}


def dictate(central, doc, value):
    http("POST", f"{MOCK}/mockoon-admin/global-vars", {"key": f"{central}_{doc}", "value": json.dumps(value, ensure_ascii=False)})


def agildata_answer(doc, name):
    _, base = http("GET", f"{MOCK}/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/CC/0")
    base["respuesta"]["datosBasicos"]["nombre"] = name
    base["respuesta"]["datosBasicos"]["numeroId"] = doc
    return base


def mareigua_answer(doc, n1, n2, a1, a2):
    _, base = http("POST", f"{MOCK}/mareigua/consultas", {"NumeroEmpleado_id": "0"})
    base.update(primer_nombre_persona_natural=n1, segundo_nombre_persona_natural=n2,
                primer_apellido_persona_natural=a1, segundo_apellido_persona_natural=a2,
                numero_identificacion_persona_natural=doc)
    return base


AGIL_EMPTY = {"usuario": None, "respuesta": None, "codConsulta": "10000000000000000", "codRespuesta": "02",
              "observaciones": "No se encontró información del afiliado."}
FAIL = {"__http_status": 500, "__body": {"error": "falla simulada"}}


def db(sql):
    pw = subprocess.run("grep -E '^DB_PASSWORD=' ~/Desktop/CREDITOP/github/legacy-backend/.env | cut -d= -f2-",
                        shell=True, capture_output=True, text=True).stdout.strip()
    r = subprocess.run(["docker", "exec", "-e", f"MYSQL_PWD={pw}", "legacy-backend-mysql-1", "mysql",
                        "--default-character-set=utf8mb4", "-ucreditop", "creditop", "-N", "-e", sql],
                       capture_output=True, text=True)
    return r.stdout.strip()


def run_case(label, name, surname, agil=None, mareigua=None, seed=None):
    rnd = random.Random(seed)
    doc = str(rnd.randint(1_090_000_000, 1_099_999_999))
    tel = "31" + str(rnd.randint(10_000_000, 99_999_999))
    if agil is not None:
        dictate("agildata", doc, agil(doc) if callable(agil) else agil)
    if mareigua is not None:
        dictate("mareigua", doc, mareigua(doc) if callable(mareigua) else mareigua)

    st, reg = http("POST", f"{API}/api/onboarding/phone/register",
                   {"phone_number": tel, "phoneNumber": tel, "terms": True, "policies": True, "otp_length": 4,
                    "otpLength": 4, "partner_branch_hash": BRANCH, "partnerBranchHash": BRANCH})
    st, otp = http("POST", f"{API}/api/v2/onboarding/otp-auth/validate/{BRANCH}",
                   {"cellPhone": tel, "otpCode": tel[-4:], "originalAmount": 2_000_000, "amount": 2_000_000})
    payload = (otp.get("data") or {}).get("payload") or (otp.get("errors") or {}).get("payload") or otp.get("payload") or {}
    ur = payload.get("userRequestId") or payload.get("user_request_id")
    if not ur:
        return {"caso": label, "error": f"OTP v2 sin solicitud: HTTP {st} {json.dumps(otp)[:200]}"}

    st, pi = http("POST", f"{API}/api/v2/onboarding/personal-info/{BRANCH}/{ur}", {
        "document": {"type": "CC", "number": doc, "expedition": {"year": 2015, "month": 5, "day": 10}},
        "email": f"qa{doc}@gmail.com", "name": name, "surname": surname,
        "birth": {"year": 1995, "month": 5, "day": 10}, "stratum": 3})
    if st >= 300:
        return {"caso": label, "error": f"personal-info v2 HTTP {st} {json.dumps(pi, ensure_ascii=False)[:200]}"}

    st, start = http("POST", f"{CPS}/api/v1/loan-requests/{ur}/legacy-kyc-pipeline",
                     {"partner_id": PARTNER, "country_code": "CO"})
    wf = start.get("workflow_id") or start.get("workflowId") or (start.get("data") or {}).get("workflow_id")
    if not wf:
        return {"caso": label, "error": f"arranque HTTP {st} {json.dumps(start)[:200]}"}

    status = {}
    for _ in range(90):
        st, status = http("GET", f"{CPS}/api/v1/loan-requests/{ur}/legacy-kyc-pipeline/{wf}")
        pending = {k: v for k, v in status.items() if "pending" in k.lower() and v}
        if status.get("status") != "RUNNING" or pending:
            break
        time.sleep(1)

    row = db(f"SELECT CONCAT(IFNULL(first_name,''),' / ',IFNULL(surname,''),'  [full_name: ',IFNULL(full_name,''),']') "
             f"FROM users u JOIN user_requests r ON r.user_id=u.id WHERE r.id={ur}")
    return {"caso": label, "escrito": f"{name} / {surname}", "ureq": ur, "workflow": wf,
            "estado": status.get("status"),
            "pide": {k: v for k, v in status.items() if "pending" in k.lower() and v} or None,
            "centrales": [f'{o.get("provider")}={o.get("result")}' for o in status.get("provider_outcomes", [])],
            "guardado": row}


CASOS = {
    "1": ("Ñ que la central omite", "LUIS", "MUÑOZ", lambda d: agildata_answer(d, "LUIS MUNOZ"), None),
    "2": ("Ñ que la central trae", "LUIS", "MUÑOZ", lambda d: agildata_answer(d, "LUIS MUÑOZ"), None),
    "3": ("completa 2º apellido", "JUAN CARLOS", "PEREZ", lambda d: agildata_answer(d, "JUAN CARLOS PEREZ GOMEZ"), None),
    "4": ("completa 1+1 contra 4", "ANA", "PEREZ", lambda d: agildata_answer(d, "ANA MARIA PEREZ GOMEZ"), None),
    "5": ("ambiguo: pide corregir", "ANA", "PEREZ GOMEZ", lambda d: agildata_answer(d, "ANA MARIA PEREZ GOMEZ"), None),
    "6": ("Ágil vacía → Mareigua sin Ñ", "LUIS", "MUÑOZ", AGIL_EMPTY, lambda d: mareigua_answer(d, "LUIS", "", "MUNOZ", "PEREZ")),
    "7": ("Ágil caída → Mareigua", "JUAN", "PEREZ", FAIL, lambda d: mareigua_answer(d, "JUAN", "CARLOS", "PEREZ", "GOMEZ")),
}

if __name__ == "__main__":
    pick = sys.argv[1:] or list(CASOS)
    for k in pick:
        label, n, s, a, m = CASOS[k]
        print(json.dumps(run_case(f"{k} {label}", n, s, a, m, seed=f"{time.time()}-{k}"), ensure_ascii=False))
