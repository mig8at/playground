#!/usr/bin/env python3
"""Deja escrito que el cambio de un nodo se MIRÓ y no afecta lo que el nodo afirma — sin sellarlo.

POR QUÉ NO ES UN SELLO, y es la decisión que justifica que exista este archivo. `verified` dice
«una persona revisó este nodo entero y afirma que es cierto». Es lo que ancla el baseline de
`refs.py`, el «desde cuándo» de `diff.py` y la deriva de `alinear.py`. Moverlo por un cambio que se
clasificó como inocuo tiene un efecto que no se deshace: **el próximo diff arranca desde ahí**, así
que si la clasificación estuvo mal, ese cambio no queda pendiente — desaparece, y nada vuelve a
señalarlo. Un sello equivocado no cuesta una lectura de más: cuesta la evidencia.

`triado` es lo mismo pero reversible. Dice «hasta este commit, el cambio se miró y no toca lo que el
nodo afirma», con quién lo dijo. `verified` no se mueve, así que el diff completo sigue disponible: si
mañana la fuente del triaje resulta mala, se borran los `triado` y no se perdió nada.

    "verified": { "ref": "main", "date": "2026-09-14", "source": "manual" }
    "triado":   { "ref": "main", "date": "2026-09-21", "source": "manual",
                  "shas": { "harness": "0d1e4409" }, "veredicto": "refactor de la UI" }

LA GUARDA ES ARITMÉTICA, NO UNA OPINIÓN. Si alguna cita `archivo:línea` del doc cayó dentro de lo que
el cambio reescribió, esto se niega: ahí la afirmación de al lado puede ser falsa HOY, y eso se lee
y se corrige, no se tria. Lo que queda para triar es el cambio que no tocó nada citado — que es el
caso frecuente y el que hoy deja un nodo marcado «viejo» por ruido.

⚠ `source` DICE QUIÉN LO DIJO, y existe por lo mismo que en el sello: para no tratar una estimación
como un hecho. Hoy sólo se escribe `manual`. Una máquina podrá escribir acá cuando haya con qué
medirla —un banco de cambios pasados con etiquetas reales— y con umbrales asimétricos: para decir
«no hay que mirar esto» hace falta mucha más confianza que para decir «mirá esto».

USO
    triar.py <nodo> --veredicto '…'              # lo escribe (source=manual)
    triar.py <nodo> --veredicto '…' --source X   # de otra procedencia (ver arriba)
    triar.py --listar                            # qué nodos tienen triaje y hasta dónde

EXIT  0 → triado · 1 → hay citas tocadas: esto se lee, no se tria · 2 → error de uso
"""
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import diff as D


def tras(argv, flag, default):
    """El valor que sigue a un flag, o el default. Un flag AL FINAL sin valor no revienta: devuelve
    el default y la validación de abajo lo rechaza con un mensaje, que es lo que se puede leer."""
    i = argv.index(flag) + 1 if flag in argv else -1
    return argv[i] if 0 < i < len(argv) else default


def escribir(nid, campo):
    """Escribe `triado` justo después de `verified`, que es donde se lee en contraste con él."""
    mp = os.path.join(D.FLOWS, nid, "map.json")
    d = json.load(open(mp))
    salida, puesto = {}, False
    for k, v in d.items():
        if k == "triado":
            continue
        salida[k] = v
        if k == "verified":
            salida["triado"], puesto = campo, True
    if not puesto:
        salida["triado"] = campo
    with open(mp, "w") as fh:
        json.dump(salida, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def listar():
    for nid in sorted(os.listdir(D.FLOWS)):
        mp = os.path.join(D.FLOWS, nid, "map.json")
        if not os.path.isfile(mp):
            continue
        t = (json.load(open(mp)).get("triado") or {})
        if t:
            print(f"  {nid:22} {t.get('date', '?')}  ({t.get('source', '?')})  {t.get('veredicto', '')[:70]}")
    return 0


def main(argv):
    if "--listar" in argv:
        return listar()
    args = [a for a in argv if not a.startswith("--")]
    if not args or "--veredicto" not in argv:
        print(__doc__.strip().split("\n\n")[0])
        print("\nfalta el nodo y --veredicto '…' · ej: triar.py trazador --veredicto 'refactor de la UI'")
        return 2
    nid = args[0]
    veredicto = tras(argv, "--veredicto", "")
    fuente = tras(argv, "--source", "manual")
    if not veredicto.strip() or veredicto.startswith("--"):
        print("el veredicto no puede ir vacío: es lo que alguien va a leer para saber si confiar en esto")
        return 2
    if not os.path.isfile(os.path.join(D.FLOWS, nid, "map.json")):
        print(f"no existe el nodo `{nid}`")
        return 2

    datos = D.recolectar(nid)
    if not datos["sello"]:
        print(f"`{nid}` no tiene sello: no hay contra qué comparar, así que tampoco qué triar.")
        return 2
    if not datos["tocados"]:
        print(f"✓ `{nid}` no tiene cambios desde su sello: no hay nada que triar.")
        return 0

    print("\n── contra qué se comparó ──")
    print("\n".join(datos["procedencia"]))
    dentro = D.mapa_de_citas(nid, datos["archivos"], datos["tocados"], datos["sello"])
    if dentro:
        print(f"\n✗ NO se tria: {dentro} cita(s) del doc cayeron dentro de lo que el cambio reescribió.")
        print("  Eso se lee y se corrige — puede estar diciendo algo falso hoy. `make context-diff NODE="
              + nid + "`")
        return 1

    previo = (json.load(open(os.path.join(D.FLOWS, nid, "map.json"))).get("triado") or {})
    if previo.get("shas") == datos["shas"]:
        print(f"\n✓ `{nid}` ya estaba triado hasta ese mismo commit el {previo.get('date')} "
              f"({previo.get('source')}): no hay nada nuevo que mirar.")
        return 0

    escribir(nid, {"ref": datos["ref"], "date": str(date.today()), "source": fuente,
                   "shas": datos["shas"], "veredicto": veredicto.strip()})
    print(f"\n✓ `{nid}` triado hasta {datos['shas']} ({fuente}) — el sello NO se movió.")
    print("  El diff completo desde el sello sigue disponible; esto sólo dice que ya se miró.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
