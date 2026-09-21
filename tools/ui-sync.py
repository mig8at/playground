#!/usr/bin/env python3
"""Distribuye la fuente de tools/ui en las tres UIs sin cambiar cómo se sirven."""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ('tema.css', 'taller.css', 'workbench.js', 'RegionMenu.vue')
DESTINATIONS = ('tablero/src', 'trazador/src', 'harness/panel')

def sync(check=False):
    drift = []
    for name in FILES:
        source = (ROOT / 'tools/ui' / name).read_bytes()
        for directory in DESTINATIONS:
            if name.endswith('.vue') and directory == 'harness/panel':
                continue
            if name == 'workbench.js' and directory == 'harness/panel':
                # El servidor ya entrega index.html sin caché. Incrustar el módulo evita
                # una ruta nueva y permite actualizar la UI sin reiniciar una corrida.
                target = ROOT / directory / 'index.html'
                html = target.read_text()
                start = html.index('// <workbench-shared>') + len('// <workbench-shared>')
                end = html.index('// </workbench-shared>', start)
                generated = '\n' + source.decode() + '\n'
                if html[start:end] != generated:
                    drift.append(str(target.relative_to(ROOT)) + ' (módulo compartido)')
                    if not check:
                        target.write_text(html[:start] + generated + html[end:])
                continue
            target = ROOT / directory / name
            if not target.exists() or target.read_bytes() != source:
                drift.append(str(target.relative_to(ROOT)))
                if not check:
                    target.write_bytes(source)
    if check and drift:
        print('UI compartida desincronizada. Ejecuta make estilo-sync:')
        print('\n'.join(drift))
        return 1
    print('UI compartida: tres herramientas sincronizadas.' if not drift or not check else '')
    return 0

if __name__ == '__main__':
    raise SystemExit(sync('--check' in sys.argv))
