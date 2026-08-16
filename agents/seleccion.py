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

# Sólo los índices. Sin `leer_codigo` ni `buscar_en_codigo`: acá se ELIGE, no se lee.
DE_INDICE = ["mapa_de_rutas", "indice_de_repos", "subramas_del_repo",
             "mapa_de_negocio_del_repo", "buscar_archivos", "abrir_nodo"]

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
- Máximo 8 archivos. Si creés que hacen falta más, es señal de que la pregunta es demasiado ancha:
  decilo en `advertencias` y elegí los 8 que más rinden.
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
            }, "required": ["ruta", "por_que", "prioridad"]},
        },
        "nodos_consultados": {"type": "array", "items": {"type": "string"},
                              "description": "qué nodos abriste para decidir"},
        "ya_respondido": {"type": "string",
                          "description": "qué parte de la pregunta ya contesta la documentación, sin leer código"},
        "advertencias": {"type": "string",
                         "description": "qué te faltó en los índices, o por qué la pregunta es muy ancha"},
    }, "required": ["archivos"]},
}, entregar_seleccion)


def main():
    args = sys.argv[1:]
    try:
        cfg = gemini.config()
        pregunta = args[0] if args else PREGUNTA
        print(f"\n¿? {pregunta}\n\nmodelo: {cfg['modelo']}  ·  sólo índices, sin leer código\n")
        r = gemini.correr(pregunta, HERRAMIENTAS, INSTRUCCIONES, cfg,
                          terminales=("entregar_seleccion",))
        if isinstance(r, str):
            print(r)
            return 1

        if r.get("nodos_consultados"):
            print(f"nodos consultados: {', '.join(r['nodos_consultados'])}\n")
        print(f"ARCHIVOS A LEER ({len(r['archivos'])})\n")
        for i, a in enumerate(r["archivos"], 1):
            print(f"  {i}. [{a.get('prioridad', '?'):5}] {a.get('h', a.get('ruta', '?'))}")
            print(f"           {a['por_que']}\n")
        if r.get("ya_respondido"):
            print(f"YA LO CONTESTA LA DOCUMENTACIÓN:\n  {r['ya_respondido']}\n")
        if r.get("advertencias"):
            print(f"⚠ ADVERTENCIAS:\n  {r['advertencias']}\n")

        destino = PLAYGROUND / "agents" / "_ultima-seleccion.json"
        destino.write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"(guardada en {destino.name} — lista para pasársela al que lee)")
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
