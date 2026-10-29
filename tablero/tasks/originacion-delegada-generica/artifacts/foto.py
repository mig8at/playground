#!/usr/bin/env python3
"""Foto del riel 4 (originación delegada) para solicitudes ya cerradas, en LOCAL.

Uso: python3 foto.py <slug> <ureq> [<ureq>…] > foto.json
Guarda lo que devuelve cada endpoint del plan de pago y las filas de la base que deja el cierre,
sin los campos que cambian en cada corrida (fechas de generación, ids del mock, ids de fila). Se corre
antes y después del cambio y se compara con `diff`. Las fechas de pago dependen del día: comparar el
mismo día.
"""
import json, subprocess, sys, urllib.request

BASE = "http://localhost/api/onboarding/payment-plan/"
VOLATILE = {"generated_at", "confirmation_number", "created_at", "updated_at", "id", "user_request_id",
            "approval_date", "expires_at", "message_id", "loan_number", "external_credit_id", "full_name", "id_number"}

def scrub(v):
    if isinstance(v, dict):
        return {k: scrub(x) for k, x in v.items() if k not in VOLATILE}
    if isinstance(v, list):
        return [scrub(x) for x in v]
    return v

def get(path):
    req = urllib.request.Request(BASE + path, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return {"http": r.status, "body": scrub(json.load(r))}
    except urllib.error.HTTPError as e:
        return {"http": e.code, "body": e.read().decode()[:300]}

def sql(q):
    out = subprocess.check_output(["docker", "exec", "legacy-backend-mysql-1", "sh", "-c",
        f'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" creditop --batch -e \'{q}\' 2>/dev/null'], text=True)
    rows = [l.split("\t") for l in out.strip().splitlines()]
    return [dict(zip(rows[0], r)) for r in rows[1:]] if rows else []

slug, ureqs = sys.argv[1], sys.argv[2:]
foto = {}
for u in ureqs:
    ur = sql(f"SELECT lender_id, user_request_status_id, amount, original_amount, final_amount, initial_fee, fee_number, fee_value, rate, selected_payment_date FROM user_requests WHERE id={u}")[0]
    fee = ur["fee_number"]
    day = (ur["selected_payment_date"] or "")[8:10].lstrip("0") or "2"
    foto[u] = {
        "solicitud": {k: v for k, v in ur.items() if k != "selected_payment_date"},
        "dia_de_pago": day,
        "continue-request": get(f"{slug}/continue-request/{u}"),
        "payment-dates": get(f"{slug}/payment-dates/{u}"),
        "installment-plan": get(f"{slug}/installment-plan/{u}/{day}"),
        "loan-options": get(f"{slug}/loan-options/{u}/{ur['original_amount'] or ur['amount']}"),
        "payment-plan-summary": get(f"{slug}/payment-plan-summary/{u}"),
        "voucher": get(f"{slug}/voucher/{u}"),
        "documentos_firmados": sql(f"SELECT document_type, status, signer_role, signature_type, (url IS NOT NULL) AS con_url FROM user_request_signing_documents WHERE user_request_id={u} ORDER BY document_type"),
        "pagare": sql(f"SELECT signing_method, (promissory_note_url IS NOT NULL) AS con_pagare, (payment_schedule_url IS NOT NULL) AS con_plan, (deceval_promissory_note_id IS NOT NULL) AS con_deceval FROM promissory_notes WHERE user_request_id={u}"),
        "radicacion": sql(f"SELECT channel, status_id, disbursed_amount FROM lender_transactions WHERE user_request_id={u}"),
        "fee_number": fee,
    }
json.dump(foto, sys.stdout, ensure_ascii=False, indent=1, sort_keys=True)
