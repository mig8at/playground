#!/usr/bin/env python3
"""PreToolUse: bloquea editar a mano archivos que son GENERADOS.

Un archivo generado suele decir "es GENERADO — no lo edites a mano", y eso es una regla escrita:
se puede violar sin que nada falle, y el próximo `build-route-map.py` borra el cambio en silencio.
A diferencia de un `PostToolUse` (que corre DESPUÉS del hecho), un `PreToolUse` con `exit 2` **impide
la escritura** y devuelve el motivo. Regla escrita → regla imposible de violar.
"""
import json
import pathlib
import sys

# archivo generado → con qué se regenera
GENERADOS = {
    # ⚠ El caso más caro: lo genera una medición contra PRODUCCIÓN, así que una corrección a mano
    # se pierde en la próxima corrida y, mientras tanto, se lee como medida.
    "workers/ENTIDADES.md": "make entidades "
                            "(lo MIDE contra producción; editarlo a mano inventa un dato)",
    "workers/archivos.json": "python3 -c \"import sys;sys.path.insert(0,'workers');"
                             "import archivos;archivos.construir()\"",
    "workers/repos.json": "python3 workers/cli.py repos --construir (o `pesos` para los tamaños)",
    "tablero/data/cache/repos.json": "make repos",
}


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    destino = payload.get("tool_input", {}).get("file_path") or ""
    if not destino:
        return 0
    posix = pathlib.Path(destino).as_posix()

    for generado, comando in GENERADOS.items():
        if posix.endswith(generado):
            print(
                f"✋ `{generado}` es un archivo GENERADO: editarlo a mano se pierde en la próxima "
                f"regeneración, sin aviso.\n"
                f"   Para cambiar su contenido, cambiá la FUENTE y regeneralo:\n     {comando}",
                file=sys.stderr,
            )
            return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — un hook roto no debe frenar la sesión
        print(f"hook no-editar-generados.py falló (no bloqueante): {e}", file=sys.stderr)
        sys.exit(1)
