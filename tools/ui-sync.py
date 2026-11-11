#!/usr/bin/env python3
"""Distribuye la fuente de tools/ui en las tres UIs sin cambiar cómo se sirven."""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ('theme.css', 'workbench.css', 'workbench.js', 'RegionMenu.vue')
DESTINATIONS = ('tablero/src', 'visor/src', 'radar/src', 'keyring/src', 'chat/src', 'ecommerce/src', 'jarvis/src', 'jarvis/extension', 'harness/panel', 'cockpit/shell')
# El panel del harness no tiene bundler: el renglón que aplica el tema antes de pintar (`THEME_BOOT` de
# workbench.js) va escrito en su <head>, entre estos marcadores, y se rellena desde la fuente.
THEME_BOOT_TARGETS = ('harness/panel/index.html', 'cockpit/shell/index.html')
BOOT_START, BOOT_END = '/* <theme-boot> */', '/* </theme-boot> */'


def theme_boot():
    """El valor de `THEME_BOOT`, con `${THEME_KEY}`, `${PALETTE_KEY}` y `${PALETTE_IDS}` (los ids de `PALETTES`, en
    una sola lista) resueltos. Falla si aparece otra interpolación: copiarla literal dejaría en el HTML un `${…}` que el
    navegador no entiende."""
    source = (ROOT / 'tools/ui/workbench.js').read_text()
    key = re.search(r"export const THEME_KEY = '([^']+)';", source)
    palette_key = re.search(r"export const PALETTE_KEY = '([^']+)';", source)
    palettes = re.search(r'export const PALETTES = \[(.*?)\];', source, re.S)
    boot = re.search(r'export const THEME_BOOT = `([^`]*)`;', source)
    if not key or not boot or not palette_key or not palettes:
        raise SystemExit('tools/ui/workbench.js: no encontré THEME_KEY, PALETTE_KEY, PALETTES o THEME_BOOT')
    ids = re.findall(r"id: '([a-z-]+)'", palettes.group(1))
    value = (boot.group(1).replace('${THEME_KEY}', key.group(1)).replace('${PALETTE_KEY}', palette_key.group(1))
             .replace('${PALETTE_IDS}', '|'.join(ids)))
    if '${' in value:
        raise SystemExit('THEME_BOOT tiene una interpolación que ui-sync no sabe resolver')
    return value


def sync(check=False):
    drift = []
    for name in FILES:
        source = (ROOT / 'tools/ui' / name).read_bytes()
        for directory in DESTINATIONS:
            # Sin bundler (el harness, la extensión Jarvis): un .vue no se puede usar.
            if name.endswith('.vue') and directory in ('harness/panel', 'jarvis/extension', 'cockpit/shell'):
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
    boot = theme_boot()
    for rel in THEME_BOOT_TARGETS:
        target = ROOT / rel
        html = target.read_text()
        if BOOT_START not in html or BOOT_END not in html:
            drift.append(rel + ' (sin el bloque theme-boot)')
            continue
        start = html.index(BOOT_START) + len(BOOT_START)
        end = html.index(BOOT_END, start)
        if html[start:end] != boot:
            drift.append(rel + ' (theme-boot)')
            if not check:
                target.write_text(html[:start] + boot + html[end:])
    if check and drift:
        print('UI compartida desincronizada. Ejecuta make estilo-sync:')
        print('\n'.join(drift))
        return 1
    print(f'UI compartida: {len(DESTINATIONS)} destinos sincronizados.' if not drift or not check else '')
    return 0

if __name__ == '__main__':
    raise SystemExit(sync('--check' in sys.argv))
