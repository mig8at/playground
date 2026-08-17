"""Agente `contraste` — el SEGUNDO seleccionador: busca lo que el primero NO miró.

    python3 seleccion.py "…"    # A: elige
    python3 contraste.py        # B: elige OTROS, para contrastar
    python3 lector.py           # C: lee los de A + los de B + los nodos, y concluye

POR QUÉ EXISTE: un solo seleccionador tiene visión de túnel — entra por los nodos que matchean, elige
de ahí, y lo que quedó afuera nunca se entera de que existía. Este agente tiene PROHIBIDO repetir los
archivos de A, así que está obligado a mirar en otro lado: otros nodos, otro repo, el gemelo del
parallel-run, los tests que fijan la conducta, la migración que creó la columna.

Es el mismo principio de un verificador adversarial: la diversidad no sale de pedirla, sale de
IMPEDIR el camino fácil.

⚠ LO QUE NO HACE: rellenar. Si de verdad no queda nada que aporte, tiene que decirlo en
`no_hay_mas` en vez de completar con archivos en los que no cree. Un mínimo obligatorio de archivos
produce relleno, y el relleno en el paso siguiente se paga en presupuesto — le come lugar a los
archivos buenos de A. Por eso el mínimo es una META, no una regla: se le pide que llegue, y se le
permite explicar por qué no.
"""
import json
import sys

import gemini
from contexto import PLAYGROUND
from seleccion import DE_INDICE, HERRAMIENTAS as _SEL, entregar_seleccion

MIN, MAX = 10, 30

INSTRUCCIONES = """\
Otro agente ya eligió archivos para esta pregunta. Tu trabajo es elegir OTROS — los que él NO miró —
para que quien concluya tenga las dos miradas y no una sola.

⚠ NO PUEDAS REPETIR ninguno de los que ya están elegidos. Te los paso abajo con su ruta. Si devolvés
uno repetido, se descarta y perdiste ese lugar.

DÓNDE MIRAR, que es lo que el primero suele saltearse:
- El GEMELO. Casi todo vive dos veces: `application` (el monolito viejo, la ruta viva por defecto) y
  `legacy-backend` (el nuevo). Si él eligió uno, el otro puede decir algo distinto — y cuando difieren,
  ESO es la respuesta.
- Los TESTS. Fijan la conducta esperada, y muchas veces con más claridad que el código.
- Las MIGRACIONES y los MODELOS: qué columnas existen de verdad, con qué default y desde cuándo.
- Los nodos de contexto que él NO abrió. Si entró por `creditopx`, mirá `profiling`, `merchants`,
  `findings`. `buscar_archivos` sirve para llegar a lo que ningún nodo citó.
- El FRONT, si él sólo miró backend. O al revés.

CUÁNTOS: apuntá a entre {min} y {max}. Pero si de verdad no queda nada que aporte, NO RELLENES:
devolvé los que valen y explicá en `no_hay_mas` por qué. Un archivo que no creés que sirva le quita
lugar en el presupuesto a uno que sí — es peor que no mandarlo.

Cada uno con su `por_que` concreto: qué esperás que diga ESE archivo que los otros no dicen.
Devolvés HASHES (`h`), tal cual figuran en el índice. Al final llamá a `entregar_seleccion`.
"""


def main():
    prev = PLAYGROUND / "workers" / "_ultima-seleccion.json"
    if not prev.exists():
        print("no hay una primera selección: corré `seleccion.py` antes", file=sys.stderr)
        return 1
    A = json.loads(prev.read_text(encoding="utf-8"))
    pregunta = (sys.argv[1] if len(sys.argv) > 1 else A.get("pregunta")) or ""
    ya = {a.get("h", "").upper() for a in A["archivos"]}

    # Las rutas de A van EN EL PROMPT: sin verlas no puede evitarlas, y le pediríamos algo imposible.
    import extraer as _ex  # vecino: vive en esta misma carpeta
    res = _ex.resolver(list(ya))
    listado = "\n".join(f"  - {res['resueltos'].get(h, h)}" for h in ya)

    herr = {k: _SEL[k] for k in DE_INDICE}
    herr["entregar_seleccion"] = _SEL["entregar_seleccion"]

    try:
        cfg = gemini.config()
        print(f"\n¿? {pregunta}\n\ncontraste: evitando los {len(ya)} archivos que ya eligió el primero\n")
        r = gemini.correr(
            f"PREGUNTA: {pregunta}\n\nARCHIVOS YA ELEGIDOS (no los repitas):\n{listado}",
            herr, INSTRUCCIONES.format(min=MIN, max=MAX), cfg,
            terminales=("entregar_seleccion",))
        if isinstance(r, str):
            print(r)
            return 1

        # La regla se VERIFICA, no se confía: pedir en el prompt que no repita y no chequearlo es
        # dejar que la diversidad dependa de la buena voluntad del modelo.
        nuevos = [a for a in r["archivos"] if a.get("h", "").upper() not in ya]
        repetidos = len(r["archivos"]) - len(nuevos)
        res2 = _ex.resolver([a.get("h", "") for a in nuevos])

        print(f"ARCHIVOS DE CONTRASTE ({len(nuevos)})"
              + (f"  ⚠ {repetidos} repetidos, descartados" if repetidos else "") + "\n")
        for i, a in enumerate(nuevos, 1):
            ruta = res2["resueltos"].get(a.get("h", ""))
            print(f"  {i}. [{a.get('prioridad','?'):5}] {ruta or a.get('h','?') + '  ⚠ NO EXISTE'}")
            print(f"           {a['por_que']}\n")
        if r.get("no_hay_mas"):
            print(f"NO HAY MÁS QUE APORTE:\n  {r['no_hay_mas']}\n")
        if len(nuevos) < MIN:
            print(f"(devolvió {len(nuevos)}, menos del objetivo de {MIN} — mirá si lo explicó arriba)\n")

        r["archivos"] = nuevos
        r["pregunta"] = pregunta
        (PLAYGROUND / "workers" / "_ultimo-contraste.json").write_text(
            json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
        print("(guardado en _ultimo-contraste.json)")
        return 0
    except gemini.GeminiError as e:
        print(f"\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
