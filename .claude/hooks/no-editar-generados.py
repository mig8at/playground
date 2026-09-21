#!/usr/bin/env python3
"""PreToolUse: bloquea editar a mano archivos que son GENERADOS.

Hoy `context/docs/ROUTE-MAP.md` dice "es GENERADO — no lo edites a mano", y eso es una regla escrita:
se puede violar sin que nada falle, y el próximo `build-route-map.py` borra el cambio en silencio.
A diferencia de un `PostToolUse` (que corre DESPUÉS del hecho), un `PreToolUse` con `exit 2` **impide
la escritura** y devuelve el motivo. Regla escrita → regla imposible de violar.
"""
import json
import pathlib
import sys

# archivo generado → con qué se regenera
GENERADOS = {
    "context/docs/ROUTE-MAP.md": "python3 context/tools/build-route-map.py "
                                 "(sale del `when` de cada map.json y de tree.json)",
    "context/tools/index.txt": "python3 context/tools/build-index.py",
    "context/alineacion.json": "python3 context/tools/alinear.py "
                               "(sale de git: qué cambió en main desde el sello `verified`)",
    # Se mudó desde `context/docs/` el 2026-09-21, con el árbol apagándose. No estaba en esta lista
    # y es el caso más caro de los cuatro: lo genera una medición contra PRODUCCIÓN, así que una
    # corrección a mano se pierde en la próxima corrida y, mientras tanto, se lee como medida.
    "workers/ENTIDADES.md": "make entidades "
                            "(lo MIDE contra producción; editarlo a mano inventa un dato)",
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
