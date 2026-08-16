#!/usr/bin/env python3
"""code-index — la herramienta de línea de comandos para entender CÓMO ESTÁN CONSTRUIDOS los proyectos.

    ./cli.py --help              qué sabe hacer
    ./cli.py extraer --help      las opciones de un subcomando

POR QUÉ UN CLI Y NO TARGETS DE `make`: esto lo maneja tanto una persona como un modelo, y un modelo
necesita **descubrir** la herramienta, no que se la expliquen. `make code-index-extraer ALIAS=x ZOOM=2`
no dice qué otros flags hay ni qué valores toman; `./cli.py extraer --help` sí. La ayuda ES la
documentación, y no se desincroniza porque sale del mismo código que corre.

Todo sale con `--json` para que lo consuma otro programa, y todo se lee de `main` (no del working
tree: los repos reales trabajan en ramas).

Los subcomandos, de más general a más específico:

    repos      qué es cada repo, con qué está hecho y por dónde entrar
    subramas   las unidades de adentro (workspaces, módulos), descubiertas de main
    mapa       qué parte del NEGOCIO vive en cada unidad de un repo
    puente     cobertura del árbol de contexto, por repo
    buscar     describís lo que necesitás y te devuelve archivos
    extraer    lee el CÓDIGO y saca qué define, qué importa y qué rutas expone
    check      ¿las rutas escritas a mano siguen vivas en main?
"""
import argparse
import json
import sys

import extraer as _ex
import indice as _ix


def _salida(datos, texto_fn, como_json):
    if como_json:
        print(json.dumps(datos, ensure_ascii=False, indent=1))
        return 0
    return texto_fn()


def main():
    p = argparse.ArgumentParser(
        prog="code-index", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", metavar="<subcomando>")

    def con_json(sp):
        sp.add_argument("--json", action="store_true", help="salida para máquina, no para leer")
        return sp

    s = con_json(sub.add_parser("repos", help="qué es cada repo y por dónde entrar"))
    s.add_argument("alias", nargs="?", help="uno solo; vacío = todos")

    s = con_json(sub.add_parser("subramas", help="las unidades de adentro (workspaces, módulos)"))
    s.add_argument("alias")

    s = con_json(sub.add_parser("mapa", help="qué parte del negocio vive en cada unidad"))
    s.add_argument("alias")

    con_json(sub.add_parser("puente", help="cobertura del árbol de contexto por repo"))

    s = con_json(sub.add_parser("buscar", help="describí qué necesitás y te da archivos"))
    s.add_argument("que", nargs="+", help="en palabras: 'dónde se decide el cupo'")
    s.add_argument("--tope", type=int, default=12, help="cuántos resultados (12)")

    s = con_json(sub.add_parser(
        "extraer", help="lee el CÓDIGO: definiciones, imports y rutas HTTP por archivo",
        description="Genera los nodoslite. Sólo código e infra — nada de .md."))
    s.add_argument("alias")
    s.add_argument("--ruta", default="", help="acotar a una subcarpeta del repo")
    s.add_argument("--lang", default="", help=f"filtrar por stack, con coma: {', '.join(sorted(_ex.LENGUAJES))}")
    s.add_argument("--prof", type=int, default=0, metavar="N",
                   help="sólo hasta N niveles de carpeta, relativos a --ruta")
    s.add_argument("--zoom", type=int, default=0, metavar="N",
                   help="NO filtra: agrupa en carpetas de N niveles. La vista para un repo grande")
    s.add_argument("--tope", type=int, default=60, metavar="KB",
                   help="presupuesto en KB; se llena por puntaje y se avisa qué quedó afuera (60)")

    sub.add_parser("check", help="¿las rutas escritas a mano siguen vivas en main?")
    sub.add_parser("pesos", help="refresca los tamaños guardados en repos.json")

    a = p.parse_args()
    if not a.cmd:
        p.print_help()
        return 0
    j = getattr(a, "json", False)

    if a.cmd == "repos":
        return _salida(_ix.cargar(), lambda: _ix.ver(a.alias), j)
    if a.cmd == "subramas":
        return _salida(_ix.subramas(a.alias), lambda: _ix.ver_subramas(a.alias), j)
    if a.cmd == "mapa":
        return _salida(_ix.mapa_de_negocio(a.alias), lambda: _ix.ver_mapa(a.alias), j)
    if a.cmd == "puente":
        return _salida(_ix.nodos_por_repo(), _ix.ver_puente, j)
    if a.cmd == "buscar":
        q = " ".join(a.que)
        return _salida(_ix.buscar(q, a.tope), lambda: _ix.ver_buscar(q), j)
    if a.cmd == "check":
        return _ix.check()
    if a.cmd == "pesos":
        return _ix.escribir_pesos()

    if a.cmd == "extraer":
        if a.alias not in _ex.ROOTS:
            print(f"alias desconocido '{a.alias}'. Válidos: {', '.join(sorted(_ex.ROOTS))}", file=sys.stderr)
            return 2
        langs = set(a.lang.split(",")) if a.lang else None
        if langs and langs - set(_ex.LENGUAJES):
            print(f"lenguaje desconocido: {', '.join(langs - set(_ex.LENGUAJES))}. "
                  f"Válidos: {', '.join(sorted(_ex.LENGUAJES))}", file=sys.stderr)
            return 2
        d = _ex.extraer(a.alias, a.ruta, a.tope, langs, a.prof)
        if a.zoom:
            # El zoom se calcula sobre TODO lo encontrado, no sobre lo que entró al presupuesto: si
            # no, la forma de un repo dependería de cuánto lugar quedaba.
            completo = d if d["entregados"] == d["encontrados"] else _ex.extraer(
                a.alias, a.ruta, 10_000, langs, a.prof)
            d["carpetas"] = _ex.agrupar(completo["nodos"], a.alias, a.ruta, a.zoom)
            d.pop("nodos", None)
        return _salida(d, lambda: _ex.imprimir(d, a.zoom), j)

    return 0


if __name__ == "__main__":
    sys.exit(main())
