#!/usr/bin/env python3
"""Qué cambió en el código de un nodo DESDE que se verificó. El insumo real para re-contextualizar.

POR QUÉ EXISTE. `alinear.py` dice *qué archivos* cambiaron y *quién* los tocó; `refs.py` dice si las
citas `archivo:línea` siguen apuntando bien. Ninguno contesta la única pregunta que decide si el nodo
sigue siendo cierto: **¿qué dice el código hoy que no decía cuando lo escribí?** Eso se contesta
leyendo, y hasta ahora leerlo costaba reconstruir a mano el repo, el commit del sello y las rutas —
fricción suficiente para que se sellara sin leer (pasó con `ecommerce` el 2026-07-31).

EL DIFF ACUMULADO, NO EL LOG DE COMMITS. `git log -p` cuenta el camino: el mismo archivo aparece
tres veces si lo tocaron tres commits, y hay que ir sumando de cabeza. Para re-contextualizar no
importa el camino, importa **antes contra ahora**: un solo `git diff sello..main`. En los nodos
grandes es varias veces más corto y no obliga a reconciliar cambios que se pisaron entre sí.

Los asuntos de los commits (que sí salen en `alinear.py`) sirven para TRIAR — «esto es de CreditopX,
no toca mi nodo» — pero dicen la intención, no el resultado. La conclusión sale de acá.

Y ANTES DEL DIFF, LA PREGUNTA QUE SE CONTESTA SIN LEERLO: ¿el cambio tocó las líneas que el doc
CITA, o cambió otra parte del archivo? Es aritmética —los rangos de los hunks contra los números de
las citas— y decide casi todo: si tocó lo citado, el nodo puede estar mintiendo HOY; si no, lo más
probable es que sea trabajo en otra parte del archivo. Medido el 2026-09-21: el diff de `trazador`
son 112.358 caracteres, y este mapa cabe en veinte líneas.

⚠ NO reemplaza leer el diff: dice DÓNDE mirar primero, no qué pasó. Un cambio fuera de lo citado
puede ser una función nueva que el nodo debería mencionar, y eso sólo se sabe leyendo.

SIEMPRE CONTRA `main`, NUNCA CONTRA LA RAMA EN LA QUE ESTÉ PARADO EL CLON. Los repos de la compañía
viven en ramas de trabajo —medido el 2026-09-21: `legacy-backend` en `fix/…`, `frontend-monorepo` en
`qa`, `application` en `develop`— y comparar contra lo que tenga HEAD mezclaría trabajo sin mergear
con lo que de verdad corre. `context/` describe lo que corre, y la vara es `main`. Lo resuelve
`ref_a_indexar` (que además prefiere `origin/main` cuando el local está atrasado, que suele estarlo),
y el diff va entre dos COMMITS: el working tree no entra ni aunque esté sucio. Contra qué se comparó
se imprime, porque un resultado que no dice de qué ref salió no se puede contrastar con nada.

USO
  python3 tools/diff.py <nodo>            # el mapa de citas + resumen por archivo + el diff completo
  python3 tools/diff.py <nodo> --citas    # SOLO el mapa: qué citas quedaron dentro del cambio
  python3 tools/diff.py <nodo> --stat     # solo el resumen (cuánto cambió cada archivo)
  python3 tools/diff.py <nodo> --files a.php b.tsx    # solo esos archivos del nodo

EXIT  0 → hay diff (o no hay nada que mostrar) · 2 → el nodo no existe o no tiene sello
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from alinear import base_en, pathspec, rutas_de  # mismo criterio que la alineación
from refs import REF, escrita_en                 # la MISMA regex de citas, no una copia
from roots import ROOTS, ref_a_indexar

CTX = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(CTX, "server", "data", "flows")


def git(root, *args):
    r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, errors="replace")
    return r.stdout if r.returncode == 0 else ""


HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+")


def rangos_tocados(root, base, refe, spec):
    """{ruta desde la raíz del repo: [(ini, fin)…]} — las líneas TOCADAS, en el espacio del SELLO.

    El lado `-` del hunk, no el `+`: una cita `archivo:354` se escribió contra el código como estaba
    al sellar, así que vive en las coordenadas viejas. Compararla contra el lado nuevo desplaza todo
    lo que haya debajo de una inserción y da falsos de los dos signos.

    ⚠ Una inserción PURA (`-a,0`) no entra: no cambió ninguna línea vieja, sólo corrió las de abajo.
    El contenido citado sigue diciendo lo mismo un poco más abajo, y corregir ese desplazamiento es
    trabajo de `refs.py`, que ya lo hace por ancla. Contarla acá haría que agregar una función arriba
    del archivo marcara «el nodo miente» sobre veinte citas intactas.
    """
    return parsear_hunks(git(root, "diff", "-U0", "-M", f"{base}..{refe}", "--", *spec))


def parsear_hunks(out):
    """El parseo, separado de git para poder probarlo con un diff escrito a mano."""
    por_archivo, actual = {}, None
    for row in out.splitlines():
        if row.startswith("--- "):
            ruta = row[4:].strip()
            actual = ruta[2:] if ruta.startswith("a/") else None   # /dev/null = archivo nuevo
            if actual:
                por_archivo.setdefault(actual, [])   # cambió, aunque no reescriba ninguna línea vieja
        elif row.startswith("@@") and actual and (m := HUNK.match(row)):
            n = int(m.group(2)) if m.group(2) is not None else 1
            if n:
                ini = int(m.group(1))
                por_archivo[actual].append((ini, ini + n - 1))
    return por_archivo


def rangos_por_declarado(tocados, declarados):
    """{`alias/ruta` declarado: [(ini, fin)…]} — sólo los que cambiaron; [] = cambió por inserción.

    ⚠ Las claves de `tocados` son rutas desde la RAÍZ DEL REPO y los declarados llevan el alias
    adelante: `application/app/Http/X.php` vive en `app/Http/X.php`. Cruzarlos por igualdad funciona
    únicamente donde el alias coincide con el directorio —el playground y ningún otro repo—, así que
    se cruza por sufijo. Se detectó comparando el nodo `trazador` (que sí coincide) contra uno de
    `legacy-application` (que no).
    """
    salida = {}
    for f in declarados:
        rel = f.partition("/")[2]
        for t, rangos in tocados.items():
            if t in (f, rel) or t.endswith("/" + rel):
                salida[f] = rangos
                break
    return salida


def citas_del_doc(nid, declarados):
    """[(archivo declarado, línea, línea del doc, fecha en que se escribió esa línea)…]

    La cita se resuelve contra los archivos que el nodo DECLARA, por sufijo: en el doc se escriben
    tanto rutas completas como parciales, y lo que importa acá es a cuál de los `files[]` apunta. Una
    cita que calce con dos declarados es ambigua y se deja afuera antes que adivinar.
    """
    doc = os.path.join(FLOWS, nid, "doc.md")
    if not os.path.isfile(doc):
        return []
    blame = escrita_en(os.path.relpath(doc, CTX))
    salida = []
    for i, linea in enumerate(open(doc).read().splitlines(), 1):
        for m in REF.finditer(linea):
            cita, n = m.group(1), int(m.group(2))
            calzan = [f for f in declarados if f.endswith(cita) or f.partition("/")[2].endswith(cita)]
            if len(calzan) == 1:
                salida.append((calzan[0], n, i, blame.get(i)))
    return salida


def clasificar_citas(citas, cambiados, sello):
    """(dentro, fuera, posteriores) — la decisión, sin imprimir ni tocar git."""
    dentro, fuera, posteriores = [], 0, []
    for archivo, n, en_doc, escrita in citas:
        # ⚠ el mismo par (línea, baseline) que cuida `refs.py`: una cita escrita DESPUÉS del sello
        # apunta a una versión intermedia, no a la del sello, así que su número no es comparable con
        # este diff. Decirlo es la única salida honesta; suponer la mandaría a los dos baldes mal.
        if escrita and sello and escrita > sello:
            posteriores.append((archivo, n, en_doc))
        elif archivo not in cambiados:
            continue                      # el archivo no cambió: la cita no dice nada de esta deriva
        elif any(ini <= n <= fin for ini, fin in cambiados[archivo]):
            dentro.append((archivo, n, en_doc))
        else:
            fuera += 1
    return dentro, fuera, posteriores


def mapa_de_citas(nid, declarados, tocados, sello):
    """Imprime qué citas del doc quedaron DENTRO del cambio. Devuelve cuántas."""
    citas = citas_del_doc(nid, declarados)
    cambiados = rangos_por_declarado(tocados, declarados)
    dentro, fuera, posteriores = clasificar_citas(citas, cambiados, sello)

    print("\n── qué tocó el cambio, contra lo que el nodo CITA ──")
    if dentro:
        print(f"  ⚠ {len(dentro)} cita(s) DENTRO del cambio — leé esto primero: el nodo puede estar mintiendo hoy")
        for archivo, n, en_doc in sorted(dentro):
            print(f"     {archivo}:{n}   ({nid}/doc.md:{en_doc})")
    else:
        print("  · ninguna cita del doc cayó dentro de lo que cambió")
    if fuera:
        print(f"  · {fuera} cita(s) en archivos que cambiaron, pero FUERA de lo reescrito — probable refactor")
    if posteriores:
        print(f"  · {len(posteriores)} cita(s) escritas DESPUÉS del sello: su número no es comparable con este diff")
    # Un archivo que cambió SÓLO insertando no reescribió nada de lo citado, y sin embargo es donde
    # más seguido aparece lo que el nodo todavía no menciona: una función nueva, un caso nuevo.
    insercion = sorted(f for f, r in cambiados.items() if not r)
    if insercion:
        print(f"  · {len(insercion)} archivo(s) donde SÓLO se insertó código: no se reescribió nada citado, pero puede haber algo nuevo")
        print(f"     {', '.join(f.rpartition('/')[2] for f in insercion[:6])}" + (" …" if len(insercion) > 6 else ""))
    mudos = sorted(f for f in cambiados if not any(c[0] == f for c in citas))
    if mudos:
        print(f"  · {len(mudos)} archivo(s) cambiados que el doc NO cita: {', '.join(m.rpartition('/')[2] for m in mudos[:6])}"
              + (" …" if len(mudos) > 6 else ""))
    return len(dentro)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    solo_stat = "--stat" in sys.argv
    solo_citas = "--citas" in sys.argv
    filtro = None
    if "--files" in sys.argv:
        i = sys.argv.index("--files")
        filtro = [a for a in sys.argv[i + 1:] if not a.startswith("--")]
        args = [a for a in args if a not in filtro]
    if not args:
        print(__doc__.strip().split("\n\n")[0])
        print("\nfalta el nodo · ej: python3 tools/diff.py onboarding")
        return 2

    nid = args[0]
    mp = os.path.join(FLOWS, nid, "map.json")
    if not os.path.isfile(mp):
        print(f"no existe el nodo `{nid}`")
        return 2
    d = json.load(open(mp))
    sello = (d.get("verified") or {}).get("date")
    ref = (d.get("verified") or {}).get("ref", "main")
    if not sello:
        print(f"`{nid}` no tiene `verified.date` en su map.json: no hay contra qué diffear.")
        return 2

    archivos = [f for f in d.get("files", [])
                if not filtro or any(x in f.partition("/")[2] for x in filtro)]
    por_repo = rutas_de(archivos)

    print(f"╔═ {nid} · qué cambió en `{ref}` desde que se verificó ({sello})")
    print(f"╚═ sobre los {len(archivos)} archivos que el nodo declara"
          + (f" · filtrado por {filtro}" if filtro else ""))

    hubo = False
    tocados = {}
    salida = []
    procedencia = []
    for alias, (root, pre, rutas) in por_repo.items():
        # ⚠ `main` EN EL SELLO ES UNA ETIQUETA, NO UNA REF DE GIT, y la diferencia importa acá.
        #
        # El sello dice contra qué se verificó el nodo: `main` significa «la rama principal», y eso es
        # verdad en cualquier máquina, sin importar dónde tenga el puntero local. Pero para DIFFEAR hay
        # que resolverla: contra un `main` local atrasado el diff no muestra los commits nuevos —o sea
        # que `context-diff` contesta «no cambió nada» sobre un nodo que sí quedó viejo, que es
        # exactamente lo contrario de para lo que existe—. Medido el 2026-09-18: cinco de los diez
        # repos estaban detrás, hasta 22 commits.
        #
        # Un sello contra OTRA rama (`qa`) se respeta literal: ahí sí es una rama concreta y elegida.
        refe, motivo = ref, "la rama del sello, literal"
        if ref in ("main", "origin/main"):
            resuelta, porque = ref_a_indexar(root)
            refe, motivo = resuelta or ref, porque
        base = base_en(root, refe, sello)     # el «antes»: el commit al cierre del día del sello
        if not base:
            continue
        # `-M` y el pathspec con las rutas VIEJAS: sin eso un renombre se lee como archivo nuevo
        # entero (el nodo `harness` mostraba sus 44 archivos como +203 líneas cada uno).
        spec = pathspec(root, pre, rutas, base)
        stat = git(root, "diff", "--stat", "-M", f"{base}..{refe}", "--", *spec).strip()
        if not stat:
            continue
        hubo = True
        procedencia.append(f"  {alias:22} {refe:12} {motivo} · desde {base[:9]} (sello {sello})")
        tocados.update(rangos_tocados(root, base, refe, spec))
        salida.append(f"\n── {alias}  ({base[:9]} … {refe}) ──\n{stat}")
        if not (solo_stat or solo_citas):
            salida.append("\n" + git(root, "diff", "-M", f"{base}..{refe}", "--", *spec).rstrip())

    if not hubo:
        print("\n✓ ningún archivo del nodo cambió desde el sello.")
        return 0

    print("\n── contra qué se comparó ──")
    print("\n".join(procedencia))

    # El mapa va PRIMERO aunque se calcule al final: es lo que decide si hace falta leer el resto.
    mapa_de_citas(nid, archivos, tocados, sello)
    if solo_citas:
        print(f"\n(el diff completo: python3 tools/diff.py {nid})")
        return 0
    print("".join(salida))
    if solo_stat:
        print(f"\n(el diff completo: python3 tools/diff.py {nid})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
