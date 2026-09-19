"""Agente `plan` — el PRIMERO de la fila: no busca archivos, decide CÓMO se va a buscar.

    python3 plan.py "¿por qué a un cliente no le apareció una entidad?"

POR QUÉ EXISTE. El pipeline tenía un hueco en la cabeza: los ÁNGULOS con los que sale cada
seleccionador (`--angulo`) eran texto libre que alguien escribía a mano. Mientras existió el
subagente `orquestador` los decidía él; al retirarlo quedaron sin dueño, y un `agente-analisis` sin
ángulos son dos agentes mirando lo mismo — que es precisamente lo que el contraste vino a evitar.

QUÉ NO HACE, Y ES LO MÁS IMPORTANTE: **no reescribe la pregunta**. La tentación era «mejorarla» antes
de pasarla, y es una mala idea con forma de buena: si el refinador la entiende mal, el error lo
heredan TODOS los agentes de abajo y encima queda invisible, porque el original ya no está. Un solo
punto de falla, silencioso, en el primer paso. Acá la pregunta original viaja **verbatim** y el plan
va al lado — se AGREGA contexto, no se sustituye la intención.

QUÉ VE, y por qué no más. La superficie de RUTEO, no el conocimiento entero:

    los 38 doc.md enteros      ~208.636 tokens   ← el 70% de la ventana del lector. No.
    ROUTE-MAP.md                 ~8.661 tokens   ← el índice: síntomas + el «cuándo» de cada nodo
    diccionario de negocio       ~1.796 tokens   ← lenders, comercios, rt, estados, tablas, marcas

~10k tokens para decidir la forma de todo lo que viene. Con `CONTEXT_JEV=1`, una sugerencia que pasa
los umbrales sustituye el ROUTE-MAP por 2 a 4 entradas. La opción está apagada por defecto porque la
pregunta se envía a TypeSafe. El detalle lo leen los que siguen: éste decide POR DÓNDE, no QUÉ.
"""
import json
import os
import sys
from pathlib import Path

import gemini
from contexto import CONTEXT

sys.path.insert(0, str(CONTEXT / "tools"))
import jev as context_jev  # noqa: E402

AQUI = Path(__file__).resolve().parent


def entregar_plan(angulos, terminos=None, nodos=None, ambiguedad="", forma=""):
    """Terminal: el plan llega tipado, no como prosa que haya que parsear."""
    return {"angulos": angulos or [], "terminos": terminos or [], "nodos": nodos or [],
            "ambiguedad": ambiguedad, "forma": forma}


HERRAMIENTAS = {"entregar_plan": ({
    "name": "entregar_plan",
    "description": "Entregá el plan de búsqueda. Llamala al final, una sola vez.",
    "parameters": {"type": "object", "properties": {
        "forma": {"type": "string",
                  "description": "qué CLASE de pregunta es: puntual | mecanismo | punta-a-punta | contraste-entre-repos"},
        "angulos": {"type": "array", "description": "un ángulo por seleccionador a lanzar",
                    "items": {"type": "object", "properties": {
                        "angulo": {"type": "string", "description": "la instrucción concreta: DESDE DÓNDE mira este agente"},
                        "por_que": {"type": "string", "description": "qué esperás que encuentre ESTE y no los otros"},
                        "archivos": {"type": "integer", "description": "cuántos archivos debería traer"},
                    }, "required": ["angulo", "por_que", "archivos"]}},
        "terminos": {"type": "array", "description": "el puente español→código: cómo se llama en el código lo que la pregunta nombra en español",
                     "items": {"type": "object", "properties": {
                         "dice": {"type": "string"}, "en_el_codigo": {"type": "string"}},
                         "required": ["dice", "en_el_codigo"]}},
        "nodos": {"type": "array", "items": {"type": "string"},
                  "description": "los nodos del árbol que matchean, por su id"},
        "ambiguedad": {"type": "string",
                       "description": "si la pregunta admite dos lecturas distintas, cuáles. Vacío si es clara."},
    }, "required": ["angulos"]},
}, entregar_plan)}

INSTRUCCIONES = """\
Sos el primer agente de una fila que va a contestar una pregunta sobre CreditOp (fintech colombiana de
originación de crédito). **Vos no contestás y no elegís archivos.** Decidís CÓMO van a buscar los que
siguen, que es una decisión distinta y se toma antes.

Después de vos salen N seleccionadores en paralelo. Cada uno recibe un ÁNGULO y tiene PROHIBIDO
repetir los archivos de los anteriores. Después, un lector junta todo y concluye.

LO QUE DECIDÍS:

1. **Qué CLASE de pregunta es**, porque de eso sale cuántos ángulos:

   | clase | ángulos | archivos c/u | por qué |
   |---|---|---|---|
   | puntual («¿por qué a ESTE cliente no le salió X?») | 1-2 | 4-10 | la respuesta suele estar en 2 archivos; traer 30 diluye |
   | mecanismo («¿cómo se decide el cupo?») | 2-3 | 8-12 | conviene contrastar el código con su config y sus tests |
   | punta-a-punta («todo el flujo de formalización») | 3-4 | 10-15 | son etapas distintas; un seleccionador ve una sola |
   | contraste-entre-repos («¿difieren los monolitos?») | 2 | 10-15 | uno por repo, y que el lector compare |

   Más ángulos no es mejor: cada uno cuesta ~10 llamadas a la API y le come lugar a los demás en el
   presupuesto del lector. Menos tampoco: con uno solo hay visión de túnel garantizada.

2. **Cuáles ángulos**, y ésta es tu decisión de verdad. Tienen que ser ORTOGONALES: si dos pueden
   traer los mismos archivos, sobra uno. Ángulos que rinden acá:
   - «el gemelo en el otro repo» — casi todo vive dos veces: `application` (monolito viejo, la ruta
     viva por defecto) y `legacy-backend` (el nuevo). Cuando difieren, ESO es la respuesta.
   - «los tests y las migraciones» — fijan la conducta y las columnas reales
   - «los modelos y la configuración» — de dónde salen los valores, no dónde se usan
   - «el front» si el resto se fue al backend, o al revés
   - «qué puede fallar»: los servicios externos, los middlewares, el manejo de error
   Escribí cada ángulo como una INSTRUCCIÓN a ese agente («mirá X, no Y»), no como un título.

3. **El puente al código.** La pregunta viene en español y el código está en inglés — es el error más
   repetido de esta herramienta. Por cada cosa que la pregunta nombre, decí cómo se llama en el
   código o en la base: «cupo» → `available_amount`, «entidad» → `lender`, «solicitud» →
   `user_request`, «migración» → `migrations`. Usá el vocabulario de abajo, que trae los ids reales.

4. **Los nodos** del árbol que matchean, mirando la tabla «entrá por el síntoma» del mapa.

5. **La ambigüedad, si la hay.** Si la pregunta admite dos lecturas que llevarían a archivos
   distintos, decilo — no elijas una en silencio. Si es clara, dejalo vacío.

⚠ NO reescribas la pregunta. Viaja tal cual a los que siguen; lo tuyo se suma, no la reemplaza.

Al final llamá a `entregar_plan`.
"""


def _ruteo_jev(pregunta):
    """Pista local y acotada. Un fallo devuelve None y conserva el ROUTE-MAP de siempre."""
    if os.environ.get("CONTEXT_JEV", "0").lower() not in ("1", "true", "yes"):
        return None
    try:
        nodes = context_jev.catalog()
        row = context_jev.route(pregunta, nodes, live=True, env_file=CONTEXT / ".env")
        if "jev" not in row or row["decision"]["action"] != "suggest":
            return None
        probabilities = row["jev"]["probabilities"]
        ranked = [n for n, p in sorted(probabilities.items(), key=lambda item: (-item[1], item[0]))
                  if n != context_jev.NONE and p >= .01]
        if row["decision"]["node"] and row["decision"]["node"] not in ranked:
            ranked.insert(0, row["decision"]["node"])
        # Si la distribución es muy concentrada puede haber un solo nodo. Se suman los candidatos
        # locales hasta llegar a cuatro, sin volver a enviar el mapa entero al LLM generativo.
        for item in row["baseline"]:
            if item["node"] not in ranked:
                ranked.append(item["node"])
        ranked = ranked[:4]
        return {
            "decision": row["decision"], "needs_case_data": row["jev"]["needs_case_data"],
            "nodes": [{"id": n, "probability": probabilities.get(n), **nodes[n]} for n in ranked],
            "jev_input_tokens": row["jev"]["usage"]["input_tokens"], "ms": row["ms"],
            "candidate_mode": row["candidate_mode"],
        }
    except (context_jev.JevError, OSError, ValueError, KeyError, TypeError):
        return None


def _superficie(pregunta):
    """Ruteo compacto con Jev; el índice completo queda como recuperación local."""
    routing = _ruteo_jev(pregunta)
    d = json.loads((AQUI / "creditop.json").read_text(encoding="utf-8"))
    vocab = {k: v for k, v in d.items() if not k.startswith("_")}
    if routing:
        route_surface = ("# RUTEO DE CONTEXT\n\nJev propuso estas entradas. Son pistas para decidir el plan, "
                         "no una respuesta ni una verificación:\n\n" +
                         json.dumps(routing, ensure_ascii=False, indent=1))
    else:
        rm = (CONTEXT / "docs" / "ROUTE-MAP.md").read_text(encoding="utf-8")
        route_surface = "# EL MAPA DE RUTAS (índice completo; Jev no estuvo disponible)\n\n" + rm
    surface = (route_surface + "\n\n# EL VOCABULARIO DEL NEGOCIO "
               "(ids reales, y las trampas marcadas con ⚠)\n\n" +
               json.dumps(vocab, ensure_ascii=False, indent=1))
    return surface, routing


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("uso: python3 plan.py \"<pregunta>\"", file=sys.stderr)
        return 2
    pregunta = args[0]
    try:
        cfg = gemini.config()
        sup, routing = _superficie(pregunta)
        fuente = "ruteo compacto de Jev" if routing else "mapa completo (recuperación)"
        print(f"\n¿? {pregunta}\n\nplan: {fuente} + vocabulario (~{len(sup)//4:,} tokens)\n")
        r = gemini.correr(f"PREGUNTA: {pregunta}\n\n{sup}", HERRAMIENTAS, INSTRUCCIONES, cfg,
                          terminales=("entregar_plan",))
        if isinstance(r, str):
            print(r)
            return 1

        print(f"FORMA: {r.get('forma') or '(no la dijo)'}  ·  {len(r['angulos'])} ángulos\n")
        for i, a in enumerate(r["angulos"], 1):
            print(f"  {i}. [{a.get('archivos', '?'):>2} archivos] {a['angulo']}")
            print(f"      espera encontrar: {a.get('por_que', '')}\n")
        if r.get("terminos"):
            print("PUENTE AL CÓDIGO")
            for t in r["terminos"]:
                print(f"  {t.get('dice', ''):24} → {t.get('en_el_codigo', '')}")
            print()
        if r.get("nodos"):
            print(f"NODOS: {', '.join(r['nodos'])}\n")
        if r.get("ambiguedad"):
            print(f"⚠ AMBIGÜEDAD: {r['ambiguedad']}\n")

        r["pregunta"] = pregunta  # verbatim, para que los de abajo usen ÉSTA y no una versión mía
        if routing:
            r["jev_routing"] = routing
        (AQUI / "_plan.json").write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
        print("(guardado en _plan.json — lo consume `analisis.py`)")
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
