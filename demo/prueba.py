#!/usr/bin/env python3
"""prueba.py — LA PRUEBA DE FUEGO: ¿el esqueleto alcanza para ELEGIR?

QUÉ MIDE. El mapa se vende como enrutador: le da a un seleccionador lo suficiente para decidir qué
archivos leer, más barato que los archivos. Eso se puede refutar, y la forma de refutarlo es una
condición de control que casi nadie corre: **la lista pelada de rutas**. Si con 2.529 nombres de
archivo alcanza, el esqueleto no se gana sus 266.000 tokens y este proyecto no tiene sentido.

    A · sólo rutas       ~ 39.000 tokens
    B · mapa escalonado  ~266.000 tokens   ← tiene que ganar 6,8x más caro

⚠ NO SOY YO EL SUJETO. Un modelo que ya leyó estos archivos en la conversación acierta por memoria y
el resultado no vale nada. Corre contra la API con contexto limpio, una llamada por (pregunta,
condición).

⚠ CUESTA PLATA Y HAY CUOTA. Son 5 preguntas × 2 condiciones = 10 llamadas, y las 5 de la condición B
mandan 266k tokens cada una. Un 429 se reporta, no se reintentea en bucle.

LAS PREGUNTAS tienen verdad de referencia verificada contra `main` con `git grep` — no elegida por lo
que el mapa sabe contestar. Tres son discriminantes (el nombre del archivo NO delata la respuesta),
una es un control fácil (el nombre SÍ delata: si esta falla, el harness está roto) y una es el control
negativo: la respuesta correcta es «no está».
"""
import json, subprocess, sys, pathlib

AQUI = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent / "workers"))
import gemini  # noqa: E402

PREGUNTAS = [
    dict(
        id="can_check_preapproval",
        clase="discriminante",
        pregunta="¿En qué parte del código se decide poner el campo can_check_preapproval en false "
                 "para una entidad del listado?",
        gt=["Modules/Onboarding/App/Services/lenders/LenderListingService.php",
            "Modules/Onboarding/App/Services/lenders/RiskCentralValidationService.php",
            "Modules/Risk/App/Http/Controllers/Customer/ProfilingReviewController.php"],
        nota="EL CASO DEL TRIAJE. Ningún nombre de archivo contiene 'preapproval'.",
    ),
    dict(
        id="profiling_reviews",
        clase="discriminante",
        pregunta="¿Qué código lee o escribe la tabla profiling_reviews?",
        gt=["Modules/Backoffice/App/Services/ApplicationsService.php",
            "Modules/Loans/App/Services/UserProfilingService.php",
            "Modules/Onboarding/App/Http/Controllers/ListLenderController.php",
            "Modules/UserRequestV1/App/Services/CosignerEligibilityService.php",
            "app/Models/ProfilingReview.php",
            "database/migrations/2024_06_26_190553_create_profiling_reviews_table.php",
            "database/migrations/2025_05_30_164638_alter_profiling_reviews_table.php",
            "database/migrations/2025_07_16_121112_add_soft_deletes_to_profiling_reviews_table.php",
            "database/migrations/2026_05_25_014050_add_user_allied_request_index_to_profiling_reviews_table.php"],
        nota="GT = los archivos que NOMBRAN la tabla (grep completo, sin truncar). ListLenderController "
             "y CosignerEligibilityService no se pueden adivinar por el nombre.",
    ),
    dict(
        id="metodo_recalcular",
        clase="metodo",
        pregunta="Quiero recalcular el listado de entidades para un monto distinto sin volver a "
                 "crear la solicitud. ¿Qué archivo y qué MÉTODO exacto tengo que llamar?",
        gt=["Modules/Onboarding/App/Services/lenders/LenderListingService.php"],
        gt_metodos=["recalculate"],
        nota="NIVEL MÉTODO: una lista de rutas no puede contener 'recalculate'. Acá el esqueleto "
             "tiene el dato y la condición A no.",
    ),
    dict(
        id="metodo_categoria",
        clase="metodo",
        pregunta="¿Qué MÉTODO devuelve la categoría de usuario que un lender le asigna a un cliente, "
                 "y en qué archivo está?",
        gt=["Modules/Loans/App/Services/LenderUserCategoryService.php"],
        gt_metodos=["getLenderUserCategory"],
        nota="NIVEL MÉTODO, segundo caso. El nombre del archivo acerca; el del método no está en A.",
    ),
    dict(
        id="ambiente_identidad",
        clase="techo",
        pregunta="¿Qué servicios de verificación de identidad cambian su comportamiento según el "
                 "ambiente, con app()->environment(['local','development'])?",
        gt=["Modules/Identity/App/Services/AgildataService.php",
            "Modules/Identity/App/Services/MareiguaService.php",
            "Modules/Identity/App/Services/TusDatosService.php",
            "app/Services/Lenders/CredifamiliaV2/Evidente/EvidenteFlowService.php"],
        nota="EL TECHO: la condición está en el CUERPO de los métodos, así que NINGUNA condición tiene "
             "el dato. Mide qué NO puede el mapa; acertar acá es por el nombre.",
    ),
    dict(
        id="soap_envelope",
        clase="control-facil",
        pregunta="¿Dónde se arma el envelope SOAP de las integraciones?",
        gt=["Modules/Loans/App/Actions/Concerns/Soap.php",
            "Modules/Loans/App/Actions/DecevalSoap.php"],
        nota="CONTROL: el nombre delata. Las dos condiciones deberían acertar; si falla, el harness "
             "está roto y el resto de los números no valen.",
    ),
    dict(
        id="nequi",
        clase="control-negativo",
        pregunta="¿Dónde está la integración con Nequi para recibir pagos?",
        gt=[],
        nota="CONTROL NEGATIVO: verificado, Nequi NO existe en el repo. La respuesta correcta es "
             "no_esta=true. Mide si el modelo inventa cuando no hay.",
    ),
]

INSTRUCCIONES = """Sos un SELECCIONADOR de archivos en un monolito de Laravel (fintech de crédito).

Ves un MAPA del repositorio, no el código. NO contestás la pregunta: decís qué archivos habría que
LEER para contestarla, y por qué cada uno.

Reglas:
- Máximo 8 archivos, el más probable primero. Copiá la ruta EXACTA como aparece en el mapa.
- Si el mapa no contiene nada que pueda contestar la pregunta, devolvé no_esta=true y archivos vacío.
  Decir «no está» cuando no está vale más que una lista plausible: el que lea tu selección no tiene
  forma de saber que adivinaste.
- No inventes rutas que no estén en el mapa.
- Si tenés la herramienta `esqueleto`, usala con los candidatos ANTES de decidir: la lista de rutas no
  dice qué métodos tiene cada archivo, y la pregunta puede pedir un método."""

ENTREGAR = ({
    "name": "entregar",
    "description": "Entregá la selección de archivos a leer.",
    "parameters": {
        "type": "object",
        "properties": {
            "archivos": {"type": "array", "items": {"type": "string"},
                         "description": "rutas exactas del mapa, máximo 8, la más probable primero"},
            "por_que": {"type": "array", "items": {"type": "string"},
                        "description": "una línea por archivo, en el mismo orden"},
            "metodos": {"type": "array", "items": {"type": "string"},
                        "description": "si la pregunta pide un método concreto, su nombre exacto"},
            "no_esta": {"type": "boolean",
                        "description": "true si el mapa no tiene nada que pueda contestar"},
        },
        "required": ["archivos", "no_esta"],
    },
}, lambda archivos=None, por_que=None, metodos=None, no_esta=False: {
    "archivos": archivos or [], "por_que": por_que or [], "metodos": metodos or [],
    "no_esta": bool(no_esta)})


def payload(cond):
    args = ["./demo", "payload", "legacy-backend"] + (["rutas"] if cond in ("A", "D") else [])
    return subprocess.run(args, cwd=AQUI, capture_output=True, text=True, check=True).stdout


# ── CONDICIÓN D · la que el experimento sugirió ──────────────────────────────────────────────────
# A gana en costo (39k contra 265k) y pierde SÓLO en las preguntas de nivel método. O sea que B no
# necesitaba los esqueletos de los 2.529 archivos: necesitaba los de los pocos candidatos que estaba
# considerando. D prueba eso: rutas baratas + una herramienta que trae el esqueleto a demanda.
_PEDIDOS = []


def _esqueleto(rutas=None):
    rutas = [r.strip() for r in (rutas or [])][:12]
    if not rutas:
        return {"error": "pasá al menos una ruta del mapa"}
    _PEDIDOS.append(rutas)
    salida = {}
    for r in rutas:
        cp = subprocess.run(["./demo", "mapa", f"legacy-backend/{r}"], cwd=AQUI,
                            capture_output=True, text=True)
        salida[r] = cp.stdout.strip() if cp.returncode == 0 else "(no está en el mapa)"
    return salida


ESQUELETO = ({
    "name": "esqueleto",
    "description": "El esqueleto de archivos concretos: su clase, qué inyecta y la FIRMA de cada "
                   "método. Pedí los candidatos antes de decidir — la lista de rutas no dice qué "
                   "métodos tiene cada archivo.",
    "parameters": {
        "type": "object",
        "properties": {"rutas": {"type": "array", "items": {"type": "string"},
                                 "description": "hasta 12 rutas exactas del mapa"}},
        "required": ["rutas"],
    },
}, _esqueleto)


def puntuar(p, r):
    elegidos = [x.strip() for x in r.get("archivos", [])]
    gt = set(p["gt"])
    if p["clase"] == "control-negativo":
        ok = r.get("no_esta") or not elegidos
        return dict(veredicto="OK" if ok else "INVENTÓ", hits=0, total=0, rank=None,
                    elegidos=len(elegidos))
    hits = [x for x in elegidos if x in gt]
    rank = next((i + 1 for i, x in enumerate(elegidos) if x in gt), None)
    met_ok = None
    if p.get("gt_metodos"):
        dichos = [m.strip() for m in r.get("metodos", [])]
        met_ok = any(m in dichos for m in p["gt_metodos"])
    ok = bool(hits) if met_ok is None else (bool(hits) and met_ok)
    return dict(veredicto="ACIERTA" if ok else "FALLA", hits=len(hits), total=len(gt),
                rank=rank, elegidos=len(elegidos), metodo=met_ok,
                metodos_dichos=r.get("metodos", []))


def main():
    conds = sys.argv[1:] or ["A", "B"]
    res = {}
    for cond in conds:
        mapa = payload(cond)
        tok = len(mapa) // 4
        nombre = {"A": "sólo rutas", "B": "mapa escalonado",
                  "D": "rutas + esqueleto A DEMANDA"}[cond]
        print(f"\n{'='*94}\nCONDICIÓN {cond} — {nombre} · ~{tok:,} tokens de payload\n{'='*94}")
        for p in PREGUNTAS:
            prompt = (f"MAPA DEL REPOSITORIO legacy-backend (rama main):\n\n{mapa}\n\n"
                      f"PREGUNTA: {p['pregunta']}")
            herr = {"entregar": ENTREGAR}
            if cond == "D":
                herr["esqueleto"] = ESQUELETO
            _PEDIDOS.clear()
            try:
                r = gemini.correr(prompt, herr, INSTRUCCIONES, verboso=False,
                                  terminales=("entregar",))
            except Exception as e:
                print(f"  {p['id']:24s} ERROR: {type(e).__name__}: {str(e)[:140]}")
                res[(cond, p["id"])] = dict(veredicto="ERROR", hits=0, total=len(p["gt"]),
                                            rank=None, elegidos=0)
                continue
            if not isinstance(r, dict):
                print(f"  {p['id']:24s} no llamó a entregar: {str(r)[:100]}")
                res[(cond, p["id"])] = dict(veredicto="NO-ENTREGÓ", hits=0, total=len(p["gt"]),
                                            rank=None, elegidos=0)
                continue
            s = puntuar(p, r)
            s["respuesta"] = r  # cruda: re-puntuar no debe costar otra llamada
            if cond == "D":
                s["pedidos"] = [x for lote in _PEDIDOS for x in lote]
            res[(cond, p["id"])] = s
            marca = {"ACIERTA": "✓", "OK": "✓", "FALLA": "✗", "INVENTÓ": "✗"}.get(s["veredicto"], "?")
            met = "" if s.get("metodo") is None else ("  método ✓" if s["metodo"] else
                                                     f"  método ✗ (dijo {s.get('metodos_dichos')})")
            print(f"  {marca} {p['id']:24s} [{p['clase']:16s}] {s['veredicto']:8s} "
                  f"{s['hits']}/{s['total']} del GT · eligió {s['elegidos']} · "
                  f"1er acierto en #{s['rank'] if s['rank'] else '—'}{met}")
            if s.get("pedidos") is not None:
                print(f"        pidió el esqueleto de {len(s['pedidos'])} archivos "
                      f"(~{len(s['pedidos'])*550} tokens extra)")
            for a, w in zip(r.get("archivos", [])[:3], (r.get("por_que") or []) + [""] * 3):
                en = "✓" if a in set(p["gt"]) else " "
                print(f"        {en} {a}")
                if w:
                    print(f"          → {w[:110]}")
    # Acumula: correr una condición sola no debe borrar el resultado de las otras (B cuesta 7×265k
    # tokens y no se re-corre por gusto).
    ruta = AQUI / "_prueba.json"
    previo = json.load(open(ruta)) if ruta.exists() else {}
    previo.update({f"{c}/{i}": v for (c, i), v in res.items()})
    json.dump(previo, open(ruta, "w"), indent=1, ensure_ascii=False)
    print(f"\nresultados en _prueba.json")


if __name__ == "__main__":
    main()
