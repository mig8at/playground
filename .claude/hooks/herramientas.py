#!/usr/bin/env python3
"""SessionStart · le dice al modelo qué herramientas tiene, sin que nadie se acuerde de correr `make`.

EL PROBLEMA QUE RESUELVE, que es el mismo de los otros dos hooks: el playground ya tiene acceso a
Loki, a Redash, a las cuatro bases de datos y a Confluence — pero un modelo que no corre `make` no
se entera, **decide que no puede** y contesta suponiendo. Falla en silencio y hacia el lado peor:
inventar en vez de mirar.

POR QUÉ UN HOOK Y NO UNA LÍNEA EN CLAUDE.md (la doc sugiere eso para contexto estático):
este catálogo NO es estático — se genera del propio Makefile. Escrito a mano en CLAUDE.md, se
desincroniza el día que agregás un target y nadie lo nota, que es exactamente el modo de falla que
este repo viene evitando. Generado, un target nuevo aparece solo con escribir su `## @cat …`.

Se imprime a stdout: para SessionStart, Claude Code toma el stdout como texto plano y lo suma al
contexto (no hace falta JSON). Sin matcher en settings.json, así que también entra al reanudar y
DESPUÉS DE COMPACTAR — que es cuando más se olvida.

Si algo falla, sale 0 igual: un catálogo que no se pudo armar no puede ser motivo de que la sesión
no arranque.
"""
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]

CABECERA = """\
# Herramientas de este repo (playground) — inyectado al arrancar, no hace falta correr nada

`make <comando>` desde {raiz} es la puerta única. Antes de decir que NO podés
acceder a algo (logs, base de datos, documentación de negocio), buscalo en esta lista: casi todo
lo externo ya está cableado y con credenciales puestas.

Lo que NO está acá: **Slack** entra por su MCP (ya conectado, herramientas `slack_*`) y **Jira**
tiene un servidor MCP propio en `tablero/server/cmd/jira-mcp` que sólo funciona si está registrado
en la config — si no ves herramientas `jira_*`, no lo está.
"""


def sin_colores(texto: str) -> str:
    """El help de `make` viene con ANSI para la terminal. En contexto son ruido: se van."""
    salida, i = [], 0
    while i < len(texto):
        if texto[i] == "\033":
            fin = texto.find("m", i)
            if fin != -1 and fin - i < 12:  # una fuga de secuencia rara no debe comerse el texto
                i = fin + 1
                continue
        salida.append(texto[i])
        i += 1
    return "".join(salida)


def main() -> int:
    try:
        r = subprocess.run(
            ["make"], cwd=RAIZ, capture_output=True, text=True, timeout=20
        )
    except Exception as e:
        print(f"(no se pudo listar las herramientas: {e})", file=sys.stderr)
        return 0

    catalogo = sin_colores(r.stdout).rstrip()
    if not catalogo:
        return 0

    print(CABECERA.format(raiz=RAIZ))
    print(catalogo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
