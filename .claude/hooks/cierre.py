#!/usr/bin/env python3
"""Stop · el cierre de sesión del tablero deja de depender de que alguien se acuerde.

EL PROBLEMA: `tablero/CLAUDE.md` pide cuatro cosas al terminar de trabajar en una tarea (reescribir
la retoma, apilar el Registro, declarar `ramas:`, escribir la bitácora con minutos medidos). Las
cuatro se olvidaron el 26/8 y el tablero mintió ocho días; medido el 2026-09-14, 23 de las 39 tareas
abiertas no tienen sección de retoma. Olvidarlo no rompe nada, y por eso se olvida.

QUÉ HACE: cuando el modelo termina de responder, corre `cierre -json` (tablero/server/cmd/closeout) y
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
import re
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
                piezas.append((bloque.get("name") or "", json.dumps(bloque.get("input"), ensure_ascii=False)))
    return piezas if hubo_forma else [("", crudo)]


# ¿ESTA SESIÓN ESCRIBIÓ ESE ARCHIVO? Tiene que ser preciso en las dos direcciones, y las dos fallas ya
# pasaron:
#
#   · LEER NO ES TOCAR. Un `head -60 data/sdk-del-comercio.md` del día anterior hizo que el cierre le
#     reclamara registro y bitácora a una tarea que esta sesión sólo había mirado — y que además estaba
#     modificada por OTRA sesión sobre el mismo worktree, que es como se trabaja acá.
#   · NOMBRAR JUNTO A UNA ESCRITURA TAMPOCO. Buscar «la ruta aparece Y el comando escribe algo» seguía
#     marcándola: un comando que escribía `.claude/settings.json` mencionaba esa ruta adentro de un
#     `echo`. Casi todo comando escribe algo, así que la señal tiene que ser la ADYACENCIA — la ruta
#     pegada al verbo, no en la misma línea.
#
# De ahí los tres modos, que son los tres con los que se escribe de verdad acá.
def _patrones(ruta: str):
    r = re.escape(ruta)
    return [
        # open('…/x.md', 'w')
        re.compile(r"open\(\s*['\"][^'\"]*" + r + r"['\"]\s*,\s*['\"][wa]"),
        # > x.md · >> x.md · tee x.md · sed -i … x.md · git add/rm/mv … x.md
        # El comando viaja DENTRO de un JSON, así que antes del verbo puede haber una comilla y no un
        # espacio: exigir `\s` dejaba pasar `git add …` y `sed -i … ` sin detectarlos. Y entre el verbo y
        # la ruta caben argumentos que no empiezan con `-` (`sed -i '' 's/a/b/' x.md`), pero NO otro
        # comando: `[^;&|\n]` corta en el separador, que es lo que evita cruzar de un comando al siguiente.
        re.compile(r"(?:^|[;&|\s\"'({])(?:>>?|tee|sed\s+-i|git\s+add|git\s+rm|git\s+mv)(?:[^;&|\n]*?\s)?['\"]?\S*" + r),
    ]


def _asignada_y_escrita(texto: str, ruta: str) -> bool:
    """El modo `p='…/x.md'` … `open(p,'w')`: la ruta va a una variable y se escribe por ella. Se exige
    que la ASIGNACIÓN sea de esta ruta — si no, cualquier script que escriba otro archivo contaría."""
    if not re.search(r"=\s*['\"][^'\"]*" + re.escape(ruta) + r"['\"]", texto):
        return False
    return bool(re.search(r"open\(\s*\w+\s*,\s*['\"][wa]|\.write\(|writelines\(", texto))


def escribio(piezas, ruta: str) -> bool:
    pats = _patrones(ruta)
    for nombre, texto in piezas:
        if ruta not in texto:
            continue
        if nombre in ("Write", "Edit", "NotebookEdit"):
            return True
        if nombre != "Bash":
            continue
        if any(p.search(texto) for p in pats) or _asignada_y_escrita(texto, ruta):
            return True
    return False


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
            ["go", "run", "./cmd/closeout", "-json"],
            cwd=SERVER, capture_output=True, text=True, timeout=90,
        )
        informe = json.loads(r.stdout)
    except Exception:
        return 0

    piezas = leer_transcript(entrada.get("transcript_path", ""))
    if not piezas:
        return 0  # sin transcript no se sabe qué tocó ESTA sesión; mejor callar que molestar a ciegas

    mias = []
    for t in informe.get("tasks") or []:
        if not t.get("missing"):
            continue
        # La RUTA del archivo, no el slug pelado: un comando que sólo nombra la tarea (un grep, un
        # dato de prueba, un `make tareas N=x`) no la tocó. Medido en la primera corrida real: marcó
        # tres tareas de otras sesiones porque sus slugs aparecían como texto en un script.
        if escribio(piezas, "tasks/" + t["slug"] + "/task.md"):
            mias.append(t)
            continue
        # o la sesión trabajó en una rama que la tarea declara: ahí el trabajo existe aunque su
        # archivo no se haya tocado — que es justamente lo que el cierre viene a reclamar.
        for m in t.get("touchedBy", []):
            if m.startswith("rama ") and "/" in m[5:]:
                rama = m[5:].split("/", 1)[1]
                if any(rama in texto for _, texto in piezas):
                    mias.append(t)
                    break
    if not mias:
        return 0

    lineas = [
        f"CIERRE DEL TABLERO · {informe['day']} · a las tareas que tocaste en esta sesión les faltan piezas "
        f"(medido por `make cierre`; tablero/CLAUDE.md §«AL CERRAR UNA SESIÓN»):",
        "",
    ]
    for t in mias:
        lineas.append(f"#{t['id']} {t['slug']}  (tocada por: {' · '.join(t.get('touchedBy', []))})")
        for f in t["missing"]:
            lineas.append(f"   ✗ {f}")
        lineas.append("")
    if informe.get("branchesWithoutTask"):
        lineas.append("ramas tocadas hoy que ninguna tarea declara en `ramas:`: " + ", ".join(informe["branchesWithoutTask"]))
        lineas.append("")
    if informe.get("pulseAvailable"):
        lineas.append(f"pulso del día: {informe['pulseMinutes']}′ · bitácora: {informe['worklogMinutes']}′ "
                      f"({informe.get('worklogWithoutTaskMinutes', 0)}′ sin tarea). Los minutos se MIDEN (`make pulso`), no se estiman.")
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
