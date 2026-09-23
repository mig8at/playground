#!/usr/bin/env python3
"""PostToolUse · valida un archivo de tarea del tablero apenas se escribe.

EL PROBLEMA: el frontmatter de una tarea no falla en ningún lado. Una etapa inventada («done», «idea»)
no cae en ninguna columna del tablero; un id repetido hace que una tarea PISE a la otra en el store y
sobreviva una sola; un nodo de context mal escrito manda a leer una carpeta que no existe; y un texto
con rutas o repos debajo de «## Tarea (publicable)» sale a Jira. Las cuatro pasaron (27/8 y 14/9) y
nadie se enteró hasta mirar a mano.

QUÉ HACE: si el archivo escrito es `tablero/tasks/<slug>/task.md`, corre `tareas -lint`
(tablero/server/cmd/tasks), que es la fuente única de estas reglas — la misma que `make tareas` usa
para avisar. Y si es un `.md` suelto en `tablero/data/` —donde vivían las tareas hasta el
2026-09-23—, lo frena: una sesión con el mapa viejo recrearía ahí una tarea que ya nadie lee. Un PostToolUse no puede bloquear, pero con exit 2 su stderr vuelve al
modelo como error y no se puede ignorar: lo escrito ya está, lo que importa es que no quede así.

Cualquier otro archivo sale en microsegundos. Si Go o el tablero no están, sale 0: un lint que no se
pudo correr no es motivo para frenar la sesión.
"""
import json
import pathlib
import subprocess
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[2]
SERVER = RAIZ / "tablero" / "server"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    destino = payload.get("tool_input", {}).get("file_path") or ""
    ruta = pathlib.Path(destino)
    if ruta.suffix == ".md" and ruta.parent.name == "data" and ruta.parent.parent.name == "tablero":
        sys.stderr.write(f"✗ {ruta.name} quedó suelto en tablero/data/, donde las tareas vivían hasta el "
                         "2026-09-23. Hoy una tarea es una carpeta: tablero/tasks/<slug>/task.md, con su "
                         "context.jsonl y su artifacts/ al lado (tablero/CLAUDE.md). Movelo ahí.\n")
        return 2
    if ruta.name != "task.md" or ruta.parent.parent.name != "tasks" or ruta.parent.parent.parent.name != "tablero":
        return 0
    # ⚠ Si esta carpeta no existe el hook sale 0 SIN AVISAR. Así estuvo apagado desde el 2026-09-23 (fase
    # 3 del código en inglés): la carpeta pasó de `cmd/tareas` a `cmd/tasks` y esta línea quedó vieja.
    if not ruta.exists() or not (SERVER / "cmd" / "tasks").is_dir():
        return 0
    try:
        r = subprocess.run(
            ["go", "run", "./cmd/tasks", "-lint", str(ruta)],
            cwd=SERVER, capture_output=True, text=True, timeout=60,
        )
    except Exception:
        return 0
    if r.returncode == 1:
        sys.stderr.write(r.stderr.rstrip() + "\n"
                         "Arreglalo ahora: la regla de cada campo está en tablero/TASK-TEMPLATE.md.\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
