#!/usr/bin/env python3
"""¿Las referencias `archivo:línea` de los docs siguen apuntando a lo que dicen?

POR QUÉ. Hay **849** referencias `archivo:línea` en 27 nodos, y son lo que se rompe EN SILENCIO: un
refactor mueve una función 30 líneas y la cita queda apuntando a otra cosa. El oráculo no lo ve (el
archivo existe) y `alinear.py` tampoco (solo dice que el archivo cambió). Revisarlas a mano es leer
849 veces; esto las convierte en un diff.

LO QUE HACE DE MÁS, Y ES EL PUNTO: no solo marca la que se movió — **dice la línea correcta**. Cuando
la cita viene con un símbolo al lado (el caso normal: «`scrubphone` (`pkg/asesor.ts:236`)»), busca ese
símbolo en el archivo y reporta dónde está de verdad. Así arreglar no requiere ir a buscar.

CUATRO BALDES, y separarlos es lo que hace que se le pueda creer:
  ✓ ok         resuelve, la línea existe y (si había símbolo) el símbolo está ahí cerca.
  ⚠ movida     el símbolo está en OTRA línea del mismo archivo → viene con la corrección.
  ⚠ fuera      la línea no existe: el archivo tiene menos líneas.
  ? ambigua    el nombre matchea varios archivos → no se puede afirmar nada.
  ? no existe  ningún archivo matchea en `main`. Puede ser un artefacto generado, algo de otra rama,
               o una herramienta borrada — los tres casos ya aparecieron y NO son deriva. Por eso van
               en su propio balde en vez de mezclarse con las movidas.

USO
  python3 tools/refs.py                 → todos los nodos
  python3 tools/refs.py <nodo> [<nodo>] → solo esos
  python3 tools/refs.py --ok            → lista también las que están bien

EXIT  0 → nada movido · 1 → hay referencias movidas o fuera de rango
"""
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle import del_ref  # misma definición de "qué existe en main" que el oráculo
from roots import ROOTS

CTX = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(CTX, "server", "data", "flows")
CERCA = 3  # cuántas líneas de margen se aceptan entre la cita y el símbolo

# `ruta/archivo.ext:123` — con o sin backticks. La extensión es obligatoria para no capturar
# cualquier `palabra:123`; los archivos sin extensión (bin/asesor:99) se buscan aparte.
REF = re.compile(r'([\w][\w./+\-]*\.(?:ts|tsx|php|mjs|cjs|js|jsx|vue|go)):(\d+)')
# el símbolo citado justo antes de la referencia, en la misma línea
SIMBOLO = re.compile(r'`([A-Za-z_][\w:<>$-]{2,})`(?:[^`]{0,80})?$')


def indice(ref="main"):
    """Mapas para resolver una cita: por relpath completo y por basename."""
    existen, _, _ = del_ref(ref)
    por_rel, por_base = defaultdict(list), defaultdict(list)
    for f in existen:
        alias, _, rel = f.partition("/")
        por_rel[rel].append((alias, rel))
        por_base[os.path.basename(rel)].append((alias, rel))
    return existen, por_rel, por_base


def resolver(cita, existen, por_rel, por_base):
    """Devuelve [(alias, relpath)] candidatos para una cita tal como está escrita en el doc."""
    # Los docs eliden tramos con `...` o `…` (`Modules/Risk/.../SistecreditoController.php`). Es un
    # estilo de escritura, no una ruta rota: se toma lo que va DESPUÉS de la última elisión y se
    # resuelve por sufijo. Sin esto, 7 citas válidas caían en "no existe" y ensuciaban el balde que
    # justamente existe para lo que no es deriva.
    if "..." in cita or "…" in cita:
        cita = re.split(r'(?:\.{3}|…)/?', cita)[-1].lstrip("/")
    # 0) la cita YA trae el alias (`legacy-backend/app/...`). Sin este caso primero, el paso 1 le
    #    pega otro alias delante y arma `legacy-backend/legacy-backend/app/...`: no resuelve y el
    #    archivo aparece como inexistente aunque esté ahí. Es el mismo doble-prefijo que ya había
    #    mordido en `alinear.py`.
    if cita in existen:
        alias, _, rel = cita.partition("/")
        return [(alias, rel)]
    # 1) con cada alias por delante — y se RECOLECTAN TODOS, no se devuelve el primero. Devolver el
    #    primero hacía que `config/services.php` resolviera a `legacy-application` (267 líneas) y
    #    reportara como deriva las citas :297/:303/:317, que son válidas en `legacy-backend` (371).
    #    Seis falsos positivos de una: el mismo archivo vive en los dos repos, y elegir por el orden
    #    del diccionario es elegir al azar.
    en_alias = [(alias, cita) for alias in ROOTS if f"{alias}/{cita}" in existen]
    if en_alias:
        return en_alias
    # 2) el relpath exacto
    if cita in por_rel:
        return por_rel[cita]
    # 3) sufijo del relpath (la cita suele ser un tramo final)
    suf = [v for rel, vs in por_rel.items() if rel.endswith("/" + cita) for v in vs]
    if suf:
        return suf
    # 4) el basename SOLO si la cita no traía directorio. Con directorio, caer al basename es
    #    mis-resolución: `backend-e2e/main.go` (herramienta borrada) se pegaba al `main.go` de otro
    #    repo y salía reportado como "fuera de rango", o sea deriva inventada.
    if "/" in cita:
        return []
    return por_base.get(cita, [])


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ver_ok = "--ok" in sys.argv
    existen, por_rel, por_base = indice()

    nodos = args or sorted(os.listdir(FLOWS))
    baldes = defaultdict(list)

    for nid in nodos:
        doc = os.path.join(FLOWS, nid, "doc.md")
        if not os.path.isfile(doc):
            continue
        lineas = open(doc).read().splitlines()
        for i, linea in enumerate(lineas, 1):
            for m in REF.finditer(linea):
                cita, n = m.group(1), int(m.group(2))
                cands = resolver(cita, existen, por_rel, por_base)
                donde = f"{nid}/doc.md:{i}"
                if not cands:
                    baldes["no-existe"].append((donde, f"{cita}:{n}", ""))
                    continue
                sm = SIMBOLO.search(linea[:m.start()])
                sym = sm.group(1) if sm else None

                # Con varios candidatos NO se adivina, pero tampoco se tira la toalla: si ALGUNO
                # valida (línea en rango y, si hay símbolo, el símbolo cerca), la cita está bien y
                # reportarla como "ambigua" sería ruido. Solo queda ambigua si ninguno valida.
                veredictos = []
                for alias, rel in {(a, r) for a, r in cands}:
                    try:
                        src = open(os.path.join(ROOTS[alias], rel), encoding="utf-8",
                                   errors="replace").read().splitlines()
                    except OSError:
                        continue
                    if n > len(src):
                        veredictos.append(("fuera", f"{rel}: tiene {len(src)} líneas", None))
                    elif not sym:
                        veredictos.append(("ok", "sin símbolo: solo se verificó el rango", None))
                    elif any(sym in l for l in src[max(0, n - 1 - CERCA):n + CERCA]):
                        veredictos.append(("ok", sym, None))
                    else:
                        reales = [j + 1 for j, l in enumerate(src) if sym in l]
                        veredictos.append(("movida" if reales else "ok",
                                           f"`{sym}` está en :{', :'.join(map(str, reales[:3]))}" if reales
                                           else f"`{sym}` ya no está en el archivo (¿renombrado?)", None))
                if not veredictos:
                    baldes["no-existe"].append((donde, f"{cita}:{n}", "no se pudo leer"))
                elif any(v[0] == "ok" for v in veredictos):
                    nota = next(v[1] for v in veredictos if v[0] == "ok")
                    baldes["ok"].append((donde, f"{cita}:{n}",
                                         nota + (f" · {len(cands)} candidatos, uno valida" if len(cands) > 1 else "")))
                elif len(cands) > 1:
                    baldes["ambigua"].append((donde, f"{cita}:{n}",
                                              f"{len(cands)} candidatos y ninguno valida: " + veredictos[0][1]))
                else:
                    clave, nota, _ = veredictos[0]
                    baldes[clave].append((donde, f"{cita}:{n}", nota))

    ORD = [("movida", "⚠ MOVIDAS — el símbolo está en otra línea (viene la corrección)"),
           ("fuera", "⚠ FUERA DE RANGO — la línea no existe"),
           ("ambigua", "? AMBIGUAS — el nombre matchea varios archivos, no se puede afirmar"),
           ("no-existe", "? NO EXISTEN en main — artefacto generado / otra rama / herramienta borrada")]
    for clave, titulo in ORD:
        if not baldes[clave]:
            continue
        print(f"\n{titulo}  ({len(baldes[clave])})")
        for donde, cita, nota in sorted(baldes[clave]):
            print(f"  {donde:34s} {cita:58s} {nota}")

    if ver_ok and baldes["ok"]:
        print(f"\n✓ OK ({len(baldes['ok'])})")
        for donde, cita, nota in sorted(baldes["ok"]):
            print(f"  {donde:34s} {cita:58s} {nota}")

    tot = sum(len(v) for v in baldes.values())
    print(f"\n{tot} referencias · ✓ {len(baldes['ok'])} ok · ⚠ {len(baldes['movida'])} movidas · "
          f"⚠ {len(baldes['fuera'])} fuera · ? {len(baldes['ambigua'])} ambiguas · "
          f"? {len(baldes['no-existe'])} no existen")
    print("Las dos últimas categorías NO son deriva: pedían juicio, no arreglo automático.")
    return 1 if (baldes["movida"] or baldes["fuera"]) else 0


if __name__ == "__main__":
    sys.exit(main())
