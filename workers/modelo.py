#!/usr/bin/env python3
"""El MODELO DE DATOS legible: 247 tablas agrupadas en vecindarios de negocio.

POR QUÉ ESTE ARCHIVO, teniendo ya `relaciones.json`. Ahí están los 432 datos, y 432 filas sueltas no
son un mapa: para contestar «¿qué toco para X?» hay que leerlas todas. Acá se agrupan en doce
vecindarios, se les pega cuánto pesa cada tabla en producción, y se marca lo que está muerto.

QUÉ NO HACE, y es a propósito. **No busca caminos de JOIN.** Se probó: el camino más corto entre
`users` y `lenders` es `users.lender_id`, una columna que existe de verdad pero significa «el lender
al que pertenece un usuario DEL STAFF», no los lenders que se le ofrecieron a un cliente. Cuatro
tablas concentran el 61% de las relaciones (`users` 80, `lenders` 72, `user_requests` 70, `allieds`
43), así que cualquier par de tablas queda a dos saltos pasando por un hub, y el camino sale
sintáctico y falso. Una herramienta que devuelve con seguridad una unión equivocada es peor que no
tenerla: la unión se copia a un SQL y el número que sale parece bueno.

DE DÓNDE SALE CADA COSA — importa, porque envejecen distinto:
  · las relaciones → `relaciones.json` (reconstruidas: 44 FK declaradas + convención + agente)
  · el peso y qué está vacío → `tablas.json`, una FOTO de prod con su fecha
  · los vecindarios → ACÁ, derivados del nombre y del grafo. No se escriben en ningún JSON porque
    se recalculan solos: una tabla nueva cae en su vecindario el día que aparece.
"""
from __future__ import annotations

import collections
import json
import pathlib
import re

AQUI = pathlib.Path(__file__).parent

# Los vecindarios, por prefijo. El orden IMPORTA: se aplica el primero que matchea, y por eso
# `creditop_x_lender_*` cae en creditopx y no en entidades — es cartera propia, no configuración del
# lender. Cambiar el orden cambia el mapa.
RACIMOS: list[tuple[str, str, str]] = [
    # Va PRIMERO y por nombre exacto porque cualquier prefijo de abajo se lo lleva antes: `^profile_`
    # (persona) lo agarraba, igual que `^profil` (riesgo) lo agarraba cuando era más ancho. Una
    # excepción de una sola tabla se escribe como excepción, arriba, no ensuciando tres reglas.
    (r"^profile_logs$", "plomería", ""),
    (r"^VW_", "vistas", "consultas guardadas del equipo de datos, no tablas"),
    (r"^creditop_x|^revolving|^treasury",
     "creditopx", "la cartera que CreditOp opera con capital del comercio"),
    # ⚠ `^profil` a secas metía `profile_logs` acá, y NO es perfilamiento: sus columnas son
    # `controller | method | name` — una bitácora de auditoría de quién tocó qué por dentro. Se ve
    # igual que `profile_data` (`monthly_income | credit_score | payment_capacity`, que sí es riesgo)
    # y el prefijo no los distingue. Se separó mirando las columnas, no el nombre.
    (r"^risk_central|^datacredito|^crosscore|^experian|^TEMP_EXPERIAN|^profiling|^profilings"
     r"|^profile_data|^compare_face|^ocr_|^metamap|^jumio|^kyc|^identity_valid|^evidente"
     r"|^deceval|^guarantee|^netco",
     "riesgo", "burós, identidad y perfilamiento: lo que decide si pasa"),
    (r"^allied|^ecommerce|^merchant|^woocommerce|^beneficiaries_by",
     "comercios", "quién vende: entidad, comercio, sucursal y su canal"),
    (r"^lender|^cities_by_lender|^promotions_by|^products_by|^payment_methods_by|^credit_line"
     r"|^products$|^product_categories|^group_rules|^status_per_profiles",
     "entidades", "quién presta la plata y con qué reglas"),
    (r"^user_request|^temporal_requests|^request_auth|^purchase_codes|^validations",
     "solicitud", "la solicitud de crédito y su recorrido"),
    (r"^fields|^field_|^form|^promissory|^signing|^terms_and|^response_types|^error_codes",
     "formulario", "qué se le pregunta al cliente y qué firma"),
    (r"^users|^user_|^profile_|^achieve|^security_question|^variables_by",
     "persona", "el cliente: sus datos y lo que respondió"),
    (r"^payment|^payvalida|^sistecredito|^log_return_wompi|^assistance_fee|^revenue|^bonific",
     "plata", "pagos, pasarelas y comisiones"),
    (r"^otp|^twilio|^email|^modal_survey|^reminder|^sending_methods|^short_url|^contact_web"
     r"|^qr_logs|^confirmation",
     "comunicación", "cómo se le habla al cliente y qué contestó"),
    (r"^oauth|^personal_access|^password_reset|^sessions|^roles|^permissions|^model_has"
     r"|^role_has|^corporate_users",
     "auth", "quién entra al sistema por dentro"),
    (r"^countries|^country_|^colombian_holidays|^banks|^allied_zones",
     "catálogos", "geografía, bancos, festivos: no cambian por una solicitud"),
    (r"^migrations|^failed_jobs|^cache|^logs$|^settings|^paths|^bkp_|^backup_|^temp_",
     "plomería", "Laravel y respaldos: no es negocio"),
]

# Lo que NO alcanza el prefijo hereda el vecindario de la mayoría de tablas a las que apunta. Es más
# débil que el prefijo —por eso se marca con `heredado`— pero rescata las que nadie nombró con la
# convención, que hoy son la diferencia entre cubrir el 57% y cubrir el 97%.
UMBRAL_VACIA = 0        # sin filas en prod
UMBRAL_CATALOGO = 100   # menos que esto es un catálogo, no un registro de negocio

# ⚠ `viva` SIGNIFICA «tiene filas», NO «se está usando». El censo suma el acumulado de años.
#
# ⚠⚠ Y PARA MEDIR SI SE USA HOY, LA VENTANA VA SOBRE LA FILA, NO SOBRE LA SOLICITUD. Es el error que
# se cometió acá el 2026-08-17 y dio seis tablas «muertas» de las que CUATRO estaban escribiendo esa
# misma semana. La consulta equivocada unía a `user_requests` y filtraba por `r.created_at`:
#
#     ✗ FROM <tabla> x JOIN user_requests r ON r.id = x.user_request_id
#       WHERE r.created_at > NOW() - INTERVAL 7 DAY      ← la fecha de la SOLICITUD
#     ✓ FROM <tabla> WHERE created_at > NOW() - INTERVAL 7 DAY   ← la fecha de la FILA
#
# La diferencia no es sutil: una solicitud firma documentos, sube cédula o pasa biometría DÍAS o
# semanas después de crearse, así que sus filas cuelgan de solicitudes viejas y quedan fuera de la
# ventana. `netco_signing_documents` daba 0 y son 252 filas; `compare_face_logs` daba 0 y había
# escrito ese mismo día.
#
# ⚠⚠⚠ Y aun con la ventana bien puesta, un cero NO prueba que el código esté muerto: estas tablas
# cuelgan de flujos de UN lender o UN comercio (biometría y firma no las usan todos), así que una
# semana sin originación de esa entidad da cero con el camino perfectamente vivo. Lo que sí decide
# es `MAX(created_at)`: `user_request_documentations` y `user_request_comments` no reciben una fila
# desde **2024**, y eso ya no es falta de tráfico.


def _cargar(nombre: str, clave: str) -> tuple[dict, dict]:
    d = json.loads((AQUI / nombre).read_text(encoding="utf-8"))
    return d[clave], d


def cargar() -> dict:
    """El modelo entero, ya cruzado. Se calcula en milisegundos; no hace falta cachearlo."""
    rel, _ = _cargar("relaciones.json", "relaciones")
    censo, meta = _cargar("tablas.json", "tablas")

    apunta: dict[str, list[tuple[str, dict]]] = collections.defaultdict(list)
    apuntada: dict[str, list[str]] = collections.defaultdict(list)
    for col, v in rel.items():
        t = col.split(".", 1)[0]
        apunta[t].append((col.split(".", 1)[1], v))
        apuntada[v["a"]].append(col)

    tablas = sorted(set(censo) | set(apunta) | set(apuntada))
    racimo: dict[str, str] = {}
    for t in tablas:
        for pat, nombre, _ in RACIMOS:
            if re.search(pat, t):
                racimo[t] = nombre
                break
    heredado = set()
    for t in tablas:
        if t in racimo:
            continue
        votos = collections.Counter(
            racimo[v["a"]] for _, v in apunta.get(t, []) if v["a"] in racimo)
        if votos:
            racimo[t] = votos.most_common(1)[0][0]
            heredado.add(t)

    out = {}
    for t in tablas:
        info = censo.get(t, {})
        filas = info.get("filas")
        es_vista = info.get("tipo") == "vista"
        out[t] = {
            "racimo": racimo.get(t, "?"),
            "heredado": t in heredado,
            "filas": filas,
            # ⚠ una VISTA con 0 filas no está vacía: no tiene filas propias, por definición. Contarla
            # como muerta fue el primer error acá y habría declarado muertas 28 consultas en uso.
            "estado": ("vista" if es_vista else
                       "en el censo no está" if filas is None else
                       "VACÍA" if filas <= UMBRAL_VACIA else
                       "catálogo" if filas < UMBRAL_CATALOGO else "viva"),
            "apunta_a": apunta.get(t, []),
            "le_apuntan": apuntada.get(t, []),
        }
    return {"tablas": out, "medido": meta.get("_medido"), "fuente": meta.get("_fuente")}


def descripcion(nombre: str) -> str:
    # ⚠ la PRIMERA no vacía, no la primera a secas: las reglas-excepción de arriba comparten nombre
    # con su vecindario y van sin descripción, así que `plomería` devolvía "" por culpa de la de
    # `profile_logs`. Un vecindario sin texto se lee como un vecindario sin explicar.
    for _, n, desc in RACIMOS:
        if n == nombre and desc:
            return desc
    return ""


def por_racimo(m: dict) -> dict[str, list[str]]:
    g: dict[str, list[str]] = collections.defaultdict(list)
    for t, v in m["tablas"].items():
        g[v["racimo"]].append(t)
    # ordenadas por peso: la que más carga primero, que es por donde se empieza a mirar
    for k in g:
        g[k].sort(key=lambda t: -(m["tablas"][t]["filas"] or 0))
    return g


def espina(m: dict, n: int = 4) -> list[tuple[str, int]]:
    """Las tablas que reciben más relaciones: la columna vertebral del modelo."""
    c = collections.Counter({t: len(v["le_apuntan"]) for t, v in m["tablas"].items()})
    return c.most_common(n)
