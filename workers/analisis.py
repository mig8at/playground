"""`analisis` — la fila entera, de la pregunta a la respuesta. Es el punto de entrada normal.

    python3 analisis.py "¿por qué a un cliente no le apareció una entidad?"
    python3 analisis.py "…" --plan _plan.json     # reusa un plan ya hecho (no vuelve a planificar)

    plan  →  N seleccionadores (uno por ángulo, cada uno evitando a los anteriores)  →  lector

POR QUÉ ES UN SCRIPT Y NO UNA CADENA DE `&&` EN EL MAKEFILE: porque **cuántos** seleccionadores salen
y **con qué ángulo** ya no es algo fijo — lo decide el plan, y varía por pregunta. Una cadena de make
sólo puede correr una cantidad fija de pasos idénticos, que es justamente lo que el plan vino a
reemplazar.

⚠ La pregunta viaja VERBATIM hasta el final. El plan agrega ángulos y vocabulario; no reescribe la
pregunta. Si un refinador la entendiera mal, el error lo heredarían todos los de abajo y quedaría
invisible — un punto de falla único y silencioso en el primer paso.
"""
import json
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def _correr(script, *args):
    """Cada paso es un PROCESO aparte, no un import. Así cada agente arranca con su propia ventana
    limpia y lo que se pasan entre ellos es sólo el archivo — que es lo que se puede inspeccionar
    después. Un pipeline que se comunica por variables en memoria no se puede auditar."""
    r = subprocess.run([sys.executable, str(AQUI / script), *args], cwd=str(AQUI))
    return r.returncode


def main():
    args = sys.argv[1:]
    pregunta = next((a for a in args if not a.startswith("--")), "")
    if not pregunta:
        print('uso: python3 analisis.py "<pregunta>"', file=sys.stderr)
        return 2

    plan_f = AQUI / "_plan.json"
    # Los artefactos de una corrida anterior contaminan: el lector junta TODOS los `_*.json` que
    # encuentra, así que una selección vieja de otra pregunta entraría al payload sin avisar.
    for viejo in AQUI.glob("_*.json"):
        viejo.unlink()

    print("═" * 96 + "\n  PASO 1/3 · PLAN — cuántos ángulos, cuáles, y cómo se dice en el código\n" + "═" * 96)
    if _correr("plan.py", pregunta) != 0 or not plan_f.is_file():
        print("\n⚠ el plan falló: sigo con UN seleccionador sin ángulo (el comportamiento viejo)")
        angulos = [{"angulo": "", "archivos": 12}]
    else:
        angulos = json.loads(plan_f.read_text(encoding="utf-8")).get("angulos") or [{"angulo": "", "archivos": 12}]

    print("\n" + "═" * 96 + f"\n  PASO 2/3 · SELECCIÓN — {len(angulos)} agentes, cada uno evitando a los anteriores\n" + "═" * 96)
    salidas = []
    for i, a in enumerate(angulos):
        # ⚠ El PRIMERO va a `_ultima-seleccion.json` y no es un detalle de nombres: el lector reparte
        # el presupuesto de izquierda a derecha y esa fuente va primero, así que ahí tiene que caer el
        # ángulo principal.
        salida = "_ultima-seleccion.json" if i == 0 else f"_angulo-{i + 1}.json"
        n = int(a.get("archivos") or 10)
        cmd = [pregunta, "--min", str(max(3, n - 3)), "--max", str(n), "--salida", salida]
        if a.get("angulo"):
            cmd += ["--angulo", a["angulo"]]
        if salidas:
            cmd += ["--evitar", ",".join(salidas)]
        print(f"\n──── ángulo {i + 1}/{len(angulos)} → {salida}")
        if _correr("seleccion.py", *cmd) == 0:
            salidas.append(salida)
        else:
            print(f"  ⚠ el ángulo {i + 1} falló; sigo con los demás")

    if not salidas:
        print("\n⚠ ningún seleccionador entregó archivos: no hay nada que leer", file=sys.stderr)
        return 1

    print("\n" + "═" * 96 + "\n  PASO 3/3 · LECTOR — junta todo, triaja lo que falta y concluye\n" + "═" * 96)
    return _correr("lector.py", pregunta)


if __name__ == "__main__":
    sys.exit(main())
