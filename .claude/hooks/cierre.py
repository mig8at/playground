#!/usr/bin/env python3
"""Stop · el cierre de sesión del tablero deja de depender de que alguien se acuerde.

EL PROBLEMA: `tablero/CLAUDE.md` pide cuatro cosas al terminar de trabajar en una tarea (reescribir
la retoma, apilar el Registro, declarar `ramas:`, escribir la bitácora con minutos medidos). Las
cuatro se olvidaron el 26/8 y el tablero mintió ocho días; medido el 2026-09-14, 23 de las 39 tareas
abiertas no tienen sección de retoma. Olvidarlo no rompe nada, y por eso se olvida.

QUÉ HACE: cuando el modelo termina de responder, corre `cierre -json` (tablero/server/cmd/cierre) y
mira SÓLO las tareas que ESTA sesión tocó —las que el transcript nombra por slug o por una de sus
ramas—. Si a alguna le falta una pieza, devuelve `decision: block` con la lista: el modelo vuelve a
tomar el turno y la completa (o dice que sigue en el medio). Las tareas que tocó otra sesión no son
asunto de ésta.

UNA VEZ POR SESIÓN Y POR DÍA: deja una marca en `tablero/data/cache/` (fuera de git). Sin eso, cada
turno volvería a bloquear y el modelo se quedaría dando vueltas. Y `stop_hook_active` corta el bucle
que el propio block dispara.

Si algo falla —sin Go, sin transcript, sin tablero— sale 0 en silencio: un cierre que no se pudo
calcular no puede ser motivo de que la sesión no termine.
"""
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SERVER = RAIZ / "tablero" / "server"
CACHE = RAIZ / "tablero" / "data" / "cache"


def leer_transcript(ruta: str) -> str:
    """Sólo lo que la sesión ESCRIBIÓ en sus herramientas: rutas editadas, comandos, contenido.

    No el transcript entero: una sesión que corre `make tareas` o `make cierre` recibe TODOS los slugs
    en la salida, y con eso cualquier tarea parecería tocada. Lo que se lee (tool_result) no cuenta; lo
    que se manda (tool_use.input) sí. Si el formato no es el esperado, devuelve el texto crudo — mejor
    un aviso de más que un hook que calla porque cambió una clave."""
    try:
        crudo = Path(ruta).read_text(errors="ignore")
    except Exception:
        return ""
    piezas, hubo_forma = [], False
    for linea in crudo.splitlines():
        try:
            ev = json.loads(linea)
        except Exception:
            continue
        contenido = (ev.get("message") or {}).get("content")
        if not isinstance(contenido, list):
            continue
        for bloque in contenido:
            if isinstance(bloque, dict) and bloque.get("type") == "tool_use":
                hubo_forma = True
                piezas.append(json.dumps(bloque.get("input"), ensure_ascii=False))
    return "\n".join(piezas) if hubo_forma else crudo


def main() -> int:
    try:
        entrada = json.load(sys.stdin)
    except Exception:
        return 0
    if entrada.get("stop_hook_active"):
        return 0

    sesion = str(entrada.get("session_id") or "sin-id")[:32]
    marca = CACHE / f"cierre-avisado-{sesion}-{date.today().isoformat()}"
    if marca.exists():
        return 0

    try:
        r = subprocess.run(
            ["go", "run", "./cmd/cierre", "-json"],
            cwd=SERVER, capture_output=True, text=True, timeout=90,
        )
        informe = json.loads(r.stdout)
    except Exception:
        return 0

    transcript = leer_transcript(entrada.get("transcript_path", ""))
    if not transcript:
        return 0  # sin transcript no se sabe qué tocó ESTA sesión; mejor callar que molestar a ciegas

    mias = []
    for t in informe.get("tareas") or []:
        if not t.get("faltan"):
            continue
        # La RUTA del archivo, no el slug pelado: un comando que sólo nombra la tarea (un grep, un
        # dato de prueba, un `make tareas N=x`) no la tocó. Medido en la primera corrida real: marcó
        # tres tareas de otras sesiones porque sus slugs aparecían como texto en un script.
        nombres = ["data/" + t["slug"] + ".md"]
        # la rama viene como "repo/rama"; en un comando aparece la rama sola
        for m in t.get("tocada", []):
            if m.startswith("rama ") and "/" in m[5:]:
                nombres.append(m[5:].split("/", 1)[1])
        if any(n and n in transcript for n in nombres):
            mias.append(t)
    if not mias:
        return 0

    lineas = [
        f"CIERRE DEL TABLERO · {informe['dia']} · a las tareas que tocaste en esta sesión les faltan piezas "
        f"(medido por `make cierre`; tablero/CLAUDE.md §«AL CERRAR UNA SESIÓN»):",
        "",
    ]
    for t in mias:
        lineas.append(f"#{t['id']} {t['slug']}  (tocada por: {' · '.join(t.get('tocada', []))})")
        for f in t["faltan"]:
            lineas.append(f"   ✗ {f}")
        lineas.append("")
    if informe.get("ramasSinTarea"):
        lineas.append("ramas tocadas hoy que ninguna tarea declara en `ramas:`: " + ", ".join(informe["ramasSinTarea"]))
        lineas.append("")
    if informe.get("pulsoDisponible"):
        lineas.append(f"pulso del día: {informe['pulsoMinutos']}′ · bitácora: {informe['bitacoraMinutos']}′ "
                      f"({informe.get('bitacoraSinTareaMinutos', 0)}′ sin tarea). Los minutos se MIDEN (`make pulso`), no se estiman.")
    lineas.append("Si esta era la última respuesta de la sesión, completá lo que falta ahora. Si seguís en el medio del "
                  "trabajo, decilo en una línea y continuá: este aviso no se repite en esta sesión.")

    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        marca.write_text("")
    except Exception:
        pass
    print(json.dumps({"decision": "block", "reason": "\n".join(lineas)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
