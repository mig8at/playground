"""Agente `seleccion` — NO contesta: dice qué archivos habría que leer, y por qué.

Es la fase de PLAN separada de la de ejecución. Ante una pregunta devuelve una lista de archivos
priorizada, cada uno con su justificación, y ahí se corta. Sirve para tres cosas:

1. **Revisar el ruteo antes de gastar.** Leer código es lo caro; elegir mal es lo que lo desperdicia.
   Con la lista a la vista se aprueba, se recorta o se corrige antes de que nadie lea nada.
2. **Pasársela a otro agente.** La salida es estructurada, no prosa: la puede consumir el que lee.
3. **MEDIR EL ÍNDICE.** Y ésta es la que más importa: este agente NO tiene `leer_codigo` ni
   `buscar_en_codigo` — sólo los índices. Si con eso elige bien, el índice está haciendo su trabajo;
   si elige mal o pide grepear, al índice le falta algo. La selección es el examen del índice.

    python3 seleccion.py                    # la pregunta de ejemplo
    python3 seleccion.py "tu pregunta"
"""
import json
import sys

import gemini
from contexto import (  # las herramientas de índice se comparten; no se copian
    HERRAMIENTAS as _TODAS,
    PLAYGROUND,
)

PREGUNTA = (
    "¿Por qué a un cliente no le apareció una entidad en el listado? "
    "Necesito poder darle al comercio un motivo concreto."
)

# Parametrizado para que un orquestador pueda lanzar VARIOS con ángulos distintos, en vez de tener
# cableado «uno y su contraste». El ángulo y los topes son la decisión de quien orquesta: la cantidad
# de archivos correcta depende de la pregunta —una de soporte se contesta con 8, una de arquitectura
# necesita 30— y un número fijo va a estar mal casi siempre.
USO = """
    python3 seleccion.py "<pregunta>" [opciones]
      --angulo "..."     desde dónde mirar (ej: «los tests y las migraciones»)
      --evitar a.json    no repetir lo ya elegido en esos archivos (varios, con coma)
      --min N --max M    objetivo de cantidad (por defecto 4 y 12)
      --salida x.json    dónde guardar (por defecto _ultima-seleccion.json)
"""

# Sólo los índices. Sin `leer_codigo` ni `buscar_en_codigo`: acá se ELIGE, no se lee.
# Las que ven los seleccionadores: TODO lo que sea índice, y nada que lea código.
# ⚠ `gemelos` y `archivos_por_tag` entraron el 2026-08-16 y tapan un hueco vergonzoso: a estos
# agentes se les pedía el ángulo «mirá el gemelo en el otro repo» y no tenían con qué encontrarlo
# —adivinaban la ruta del otro lado—, y se les hablaba de tablas y lenders sin darles forma de
# filtrar por ellos. Pedir un ángulo sin la herramienta para recorrerlo es cómo se fabrica una
# respuesta inventada; ya pasó con los hashes de las migraciones.
DE_INDICE = ["mapa_de_rutas", "indice_de_repos", "subramas_del_repo",
             "mapa_de_negocio_del_repo", "buscar_archivos", "archivos_por_tag",
             "gemelos", "que_hay_en", "abrir_nodo"]

INSTRUCCIONES = """\
Tu trabajo NO es contestar la pregunta. Es decidir QUÉ ARCHIVOS habría que leer para contestarla, y
justificar cada uno. Alguien va a revisar tu lista antes de que se lea una sola línea de código.

No tenés herramientas para leer código, y es a propósito: elegís con los índices.

CÓMO ELEGÍS:
1. Entrá por el índice que corresponda: `mapa_de_rutas()` si la pregunta es de NEGOCIO,
   `indice_de_repos()` si es de ARQUITECTURA. Si aplica, `mapa_de_negocio_del_repo(alias)` te dice qué
   parte del negocio vive en cada carpeta de un repo, y `subramas_del_repo(alias)` sus unidades.
2. `abrir_nodo(id)` en los 2 a 4 nodos que matcheen. Leé el doc: muchas veces ya trae la respuesta y
   las trampas, y eso cambia QUÉ archivos hacen falta. La lista `archivos` del nodo es tu menú.
3. De ese menú, elegí. Un nodo puede listar 30 archivos y la respuesta estar en 2. **Elegir bien es
   todo el trabajo**: una lista de 20 archivos no es una selección, es no haber elegido.

REGLAS:
- Apuntá a entre {min} y {max} archivos. Si de verdad no hay tantos que aporten, NO RELLENES:
  devolvé los que valen y explicá en `advertencias` por qué. Un archivo de relleno le come presupuesto
  al siguiente paso — es peor que no mandarlo.
- Cada archivo va con un `por_que` concreto: qué esperás encontrar AHÍ. «Es relevante» no sirve;
  «acá se decide la exclusión por cupo» sí.
- Poné `prioridad` alta sólo a los que, si leés uno solo, contestan lo principal.
- Si el doc de un nodo YA contesta parte de la pregunta, decilo en `ya_respondido`: quizás no haga
  falta leer código para esa parte, y eso es lo más valioso que podés reportar.
- Si los índices NO te alcanzaron para elegir con confianza, decilo en `advertencias` y explicá qué
  te faltó (un `when` sin la seña, un nodo que no cubre el tema). Eso vale tanto como la lista.
- Devolvés HASHES (`h`), no rutas. Es a propósito: escribir treinta rutas son treinta chances de
  equivocarse, y una ruta inventada parece plausible. Un hash que no existe no resuelve, y quien te
  invocó lo ve al instante. Copiá el `h` tal cual figura en el índice.

Cuando tengas la lista, llamá a `entregar_seleccion`. No escribas la respuesta en prosa.
"""


def entregar_seleccion(archivos, nodos_consultados=None, ya_respondido="", advertencias=""):
    """Entrega la selección final de archivos a leer. Llamala UNA vez, cuando ya elegiste."""
    return {
        "archivos": archivos,
        "nodos_consultados": nodos_consultados or [],
        "ya_respondido": ya_respondido,
        "advertencias": advertencias,
    }


HERRAMIENTAS = {k: _TODAS[k] for k in DE_INDICE}
HERRAMIENTAS["entregar_seleccion"] = ({
    "name": "entregar_seleccion",
    "description": "Entrega la lista final de archivos a leer. Llamala una sola vez, al final.",
    "parameters": {"type": "object", "properties": {
        "archivos": {
            "type": "array",
            "description": "hasta 8, ordenados por prioridad",
            "items": {"type": "object", "properties": {
                "h": {"type": "string", "description": "el HASH del archivo, tal cual figura en el campo `h` del índice. NO escribas la ruta: un hash mal copiado no resuelve y se detecta; una ruta inventada parece plausible y no"},
                "por_que": {"type": "string", "description": "qué esperás encontrar en ESE archivo"},
                "prioridad": {"type": "string", "description": "alta | media | baja"},
            }, "required": ["h", "por_que", "prioridad"]},
        },
        "nodos_consultados": {"type": "array", "items": {"type": "string"},
                              "description": "qué nodos abriste para decidir"},
        "ya_respondido": {"type": "string",
                          "description": "qué parte de la pregunta ya contesta la documentación, sin leer código"},
        "advertencias": {"type": "string",
                         "description": "qué te faltó en los índices, o por qué la pregunta es muy ancha"},
    }, "required": ["archivos"]},
}, entregar_seleccion)


def _opt(args, nombre, defecto=None):
    return args[args.index(nombre) + 1] if nombre in args else defecto


def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(USO)
        return 0
    angulo = _opt(args, "--angulo", "")
    minimo = int(_opt(args, "--min", 4))
    maximo = int(_opt(args, "--max", 12))
    salida = _opt(args, "--salida", "_ultima-seleccion.json")

    # Lo ya elegido por otros: se le pasa para que NO lo repita, y se verifica al recibir.
    ya, rutas_ya = set(), []
    for f in (_opt(args, "--evitar", "") or "").split(","):
        p = PLAYGROUND / "workers" / f.strip()
        if f.strip() and p.exists():
            for a in json.loads(p.read_text(encoding="utf-8")).get("archivos", []):
                ya.add(a.get("h", "").upper())

    try:
        cfg = gemini.config()
        pregunta = args[0] if args and not args[0].startswith("--") else PREGUNTA
        import extraer as _ex  # vecino: vive en esta misma carpeta desde la unificación
        if ya:
            rutas_ya = [_ex.resolver([h])["resueltos"].get(h, h) for h in ya]

        instr = INSTRUCCIONES.format(min=minimo, max=maximo)

        # El PUENTE al código, si hay un plan. Se pregunta en español y el código está en inglés: es
        # el error más repetido de esta herramienta —«migración» nunca iba a matchear `migrations`,
        # «cupo» nunca a `available_amount`— y hasta acá se parcheaba a mano en el glosario cada vez
        # que aparecía. El plan lo resuelve donde corresponde: ANTES de buscar, y para esta pregunta.
        plan = PLAYGROUND / "workers" / "_plan.json"
        if plan.exists():
            try:
                terminos = json.loads(plan.read_text(encoding="utf-8")).get("terminos") or []
            except json.JSONDecodeError:
                terminos = []
            if terminos:
                lineas = "\n".join(f"  «{t.get('dice','')}» se llama {t.get('en_el_codigo','')}"
                                   for t in terminos)
                instr += ("\n⚠ CÓMO SE LLAMA EN EL CÓDIGO lo que la pregunta nombra en español. "
                          "Buscá por estos términos, no por los del enunciado:\n" + lineas + "\n")

        if angulo:
            instr += (f"\n⚠ TU ÁNGULO: {angulo}\nOtros agentes están mirando esto desde otros lados. "
                      f"Vos mirá DESDE AHÍ — no intentes cubrir todo.\n")
        entrada = f"PREGUNTA: {pregunta}"
        if rutas_ya:
            instr += ("\n⚠ NO REPITAS los archivos que ya eligieron otros: se descartan al recibir y "
                      "perdés ese lugar. Están listados abajo.\n")
            entrada += "\n\nYA ELEGIDOS POR OTROS (no los repitas):\n" + "\n".join(
                f"  - {r}" for r in rutas_ya)

        print(f"\n¿? {pregunta}")
        if angulo:
            print(f"   ángulo: {angulo}")
        print(f"\nmodelo: {cfg['modelo']}  ·  sólo índices  ·  objetivo {minimo}-{maximo} archivos"
              + (f"  ·  evitando {len(ya)}" if ya else "") + "\n")
        r = gemini.correr(entrada, HERRAMIENTAS, instr, cfg, terminales=("entregar_seleccion",))
        if isinstance(r, str):
            print(r)
            return 1

        if r.get("nodos_consultados"):
            print(f"nodos consultados: {', '.join(r['nodos_consultados'])}\n")
        # El agente devuelve hashes; acá se resuelven a rutas para que un humano pueda leer la
        # selección — y para que los inventados salten a la vista en vez de pasar por buenos.
        # La regla de no repetir se VERIFICA, no se confía al prompt.
        antes = len(r["archivos"])
        r["archivos"] = [a for a in r["archivos"] if a.get("h", "").upper() not in ya]
        repetidos = antes - len(r["archivos"])
        res = _ex.resolver([a.get("h", "") for a in r["archivos"]])
        print(f"ARCHIVOS A LEER ({len(r['archivos'])})"
              + (f"  ⚠ {repetidos} repetidos, descartados" if repetidos else "") + "\n")
        for i, a in enumerate(r["archivos"], 1):
            h = a.get("h", "?")
            ruta = res["resueltos"].get(h)
            print(f"  {i}. [{a.get('prioridad', '?'):5}] {ruta or f'{h}  ⚠ NO EXISTE (inventado)'}")
            print(f"           {a['por_que']}\n")
        if res["no_existen"]:
            print(f"⚠ {len(res['no_existen'])} hash(es) que el modelo se inventó: "
                  f"{', '.join(res['no_existen'])}\n")
        if r.get("ya_respondido"):
            print(f"YA LO CONTESTA LA DOCUMENTACIÓN:\n  {r['ya_respondido']}\n")
        if r.get("advertencias"):
            print(f"⚠ ADVERTENCIAS:\n  {r['advertencias']}\n")

        r["angulo"] = angulo
        destino = PLAYGROUND / "workers" / salida
        # La pregunta viaja con la selección: el paso 2 tiene que saber qué se estaba
        # respondiendo, o recortaría los archivos buscando las palabras equivocadas.
        r["pregunta"] = pregunta
        destino.write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"(guardada en {destino.name} — lista para pasársela al que lee)")
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
