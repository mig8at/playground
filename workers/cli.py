#!/usr/bin/env python3
"""workers — la herramienta de línea de comandos para entender CÓMO ESTÁN CONSTRUIDOS los proyectos.

    ./cli.py --help              qué sabe hacer
    ./cli.py extraer --help      las opciones de un subcomando

POR QUÉ UN CLI Y NO TARGETS DE `make`: esto lo maneja tanto una persona como un modelo, y un modelo
necesita **descubrir** la herramienta, no que se la expliquen. un target de make (`ALIAS=x ZOOM=2`)
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
    rutas      qué rutas comparten dos o más repos — quién le habla a quién
    check      ¿las rutas escritas a mano siguen vivas en main?

LA CAPA DE CREDITOP: `extraer` es genérico (anda en cualquier repo), pero encima corre una capa que
traduce lo extraído al negocio de acá — qué lenders, qué response_type, qué tablas, qué marcadores de
log y si bifurca por ambiente. Eso habilita `--lender 160`, `--rt 2`, `--tabla x`, `--marca X` y
`--gates`. El diccionario vive aparte (`creditop.json`) y declara de qué nodo salió cada grupo: NO es
una segunda fuente de verdad, y ante una diferencia manda el nodo.
"""
import argparse
import json
import sys

import creditop as _cx
import archivos as _ar
import extraer as _ex
import indice as _ix


def _ar_resumen(e):
    p = []
    for c, pre in (("lenders", ""), ("comercios", "com. ")):
        if e.get(c):
            p.append(" ".join(f"[{pre}{x['nombre']}]" for x in e[c][:3]))
    if e.get("rt"):
        p.append("rt=" + ",".join(map(str, e["rt"])))
    if e.get("tablas"):
        p.append("tablas: " + ", ".join(e["tablas"][:3]))
    if e.get("marcas"):
        p.append("logs: " + ", ".join(e["marcas"][:2]))
    if e.get("gates"):
        p.append("⚠ AMBIENTE")
    if e.get("nodos"):
        p.append("nodos: " + ", ".join(e["nodos"][:3]))
    return " · ".join(p)


def _salida(datos, texto_fn, como_json):
    if como_json:
        print(json.dumps(datos, ensure_ascii=False, indent=1))
        return 0
    return texto_fn()


def main():
    p = argparse.ArgumentParser(
        prog="workers", description=__doc__,
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
    g = s.add_argument_group("filtros de CreditOp (la capa de negocio sobre el extractor genérico)")
    g.add_argument("--lender", type=int, metavar="ID",
                   help="sólo archivos que tocan esa entidad. 24 Credifamilia · 77 CrediPullman · "
                        "160 SmartPay · 164 CREDIMOVIL · 158 Motai (ver creditop.json)")
    g.add_argument("--allied", type=int, metavar="ID",
                   help="sólo los que tocan ese COMERCIO. 94 Pullman · 189 DENTIX · 158 Motai. "
                        "⚠ otro namespace que los lenders")
    g.add_argument("--rt", type=int, metavar="N",
                   help="por response_type: 0 UTM · 1 integración · 2 CreditopX · 3 rotativo · 4 Credifamilia")
    g.add_argument("--tabla", metavar="T", help="sólo los que tocan esa tabla del dominio")
    g.add_argument("--marca", metavar="M", help="sólo los que emiten ese marcador de log")
    g.add_argument("--gates", action="store_true",
                   help="sólo los que BIFURCAN POR AMBIENTE. ⚠ staging corre con APP_ENV=development, "
                        "así que esas condiciones aplican ahí y casi nadie lo tiene presente")

    s = con_json(sub.add_parser(
        "rutas", help="qué rutas HTTP comparten dos o más repos (quién le habla a quién)",
        description="Cruza las rutas extraídas del código. El cruce es por SUFIJO porque el que "
                    "llama usa la ruta completa y el que la declara suele hacerlo bajo un prefijo."))
    s.add_argument("alias", nargs="+", help="dos o más repos")
    s.add_argument("--segmentos", type=int, default=2, metavar="N",
                   help="cuántos segmentos finales tienen que coincidir (2). Subilo si hay ruido")
    s.add_argument("--con-ui", action="store_true",
                   help="incluir rutas de NAVEGACIÓN, no sólo de API. Por default se cruzan sólo las "
                        "de API: mezclar pantallas con endpoints da coincidencias falsas")

    s = con_json(sub.add_parser(
        "gemelos", help="qué comparten dos repos a nivel CONTENIDO (para el parallel-run)",
        description="Compara por hash de blob: identidad exacta sin leer archivos. Dice qué se copió "
                    "tal cual, qué se copió y DIVERGIÓ (el riesgo) y qué se renombró."))
    s.add_argument("a")
    s.add_argument("b")

    con_json(sub.add_parser(
        "tags", help="el censo: qué tags existen en el código y cuántos archivos tiene cada uno",
        description="Sale del diccionario (`archivos`). Es el catálogo de lo que se puede filtrar."))

    s = con_json(sub.add_parser(
        "resolver", help="hashes -> rutas: lo que se corre cuando el agente devuelve su lista",
        description="El agente recibe el índice con `p` (para elegir) y `h` (para contestar), y "
                    "responde con hashes. Esto los traduce, y avisa cuáles NO EXISTEN: un hash "
                    "inventado no resuelve, mientras que una ruta inventada parece plausible."))
    s.add_argument("hash", nargs="+", help="los que devolvió el agente")

    s = con_json(sub.add_parser(
        "logs", help="de un MENSAJE de log al archivo que lo emitió (mapa precargado)"))
    s.add_argument("mensaje", nargs="*", help="el mensaje, o la línea cruda")
    s.add_argument("--construir", action="store_true", help="rearma el mapa leyendo los repos")

    s = con_json(sub.add_parser(
        "sin-rastro", help="qué código que el negocio documenta es INVISIBLE en producción"))
    s.add_argument("--todo", action="store_true",
                   help="no filtrar a services/controllers (incluye rutas y config, que no loguean por diseño)")

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
    if a.cmd == "rutas":
        if len(a.alias) < 2:
            print("hacen falta al menos DOS repos para cruzar", file=sys.stderr)
            return 2
        malos = [x for x in a.alias if x not in _ex.ROOTS]
        if malos:
            print(f"alias desconocido: {', '.join(malos)}", file=sys.stderr)
            return 2
        d = _ex.cruzar_rutas(a.alias, a.segmentos, solo_api=not a.con_ui)
        return _salida(d, lambda: _ex.imprimir_cruce(d), j)

    if a.cmd == "gemelos":
        malos = [x for x in (a.a, a.b) if x not in _ex.ROOTS]
        if malos:
            print(f"alias desconocido: {', '.join(malos)}", file=sys.stderr)
            return 2
        d = _ex.gemelos(a.a, a.b)
        return _salida(d, lambda: _ex.imprimir_gemelos(d), j)

    if a.cmd == "tags":
        fam = _ar.censo()
        if j:
            print(json.dumps(fam, ensure_ascii=False, indent=1))
            return 0
        if not fam:
            print("no hay diccionario todavía: corré `cli.py archivos --construir`")
            return 1
        print("\n  Los tags que existen, y cuántos archivos tiene cada uno:\n")
        for familia, ts in fam.items():
            print(f"  {familia}:")
            print("     " + " · ".join(f"{t.split(':',1)[-1]}({n})" for t, n in ts[:14]))
        print()
        return 0

    if a.cmd == "resolver":
        d = _ex.resolver(a.hash)
        if j:
            print(json.dumps(d, ensure_ascii=False, indent=1))
            return 0
        print(f"\n  {len(d['resueltos'])}/{d['pedidos']} resueltos\n")
        for h, r in d["resueltos"].items():
            print(f"  {h}  {r}")
        if d["no_existen"]:
            print(f"\n  ⚠ NO EXISTEN ({len(d['no_existen'])}): {', '.join(d['no_existen'])}")
            print("     Son archivos que el modelo se inventó. Con rutas esto pasaba igual pero")
            print("     parecían plausibles y nadie lo notaba.")
        if d["colisiones"]:
            print(f"\n  ⚠ COLISIÓN de hash ({len(d['colisiones'])}): subí LARGO_H en extraer.py")
            for k, a_, b_ in d["colisiones"][:3]:
                print(f"     {k}: {a_}  vs  {b_}")
        print()
        return 1 if d["no_existen"] else 0

    if a.cmd == "logs":
        import logs as _logs
        if a.construir:
            _logs.construir()
            return 0
        q = " ".join(a.mensaje)
        if not q:
            m = _logs.cargar()
            print(f"\n  {len(m):,} mensajes mapeados. Pasá uno para resolverlo, "
                  f"o --construir para rearmar.\n")
            return 0
        r = _logs.resolver(q)
        if not r:
            print("  sin resolver: ni literal ni nombre de clase en el mensaje")
            return 1
        if j:
            print(json.dumps(r, ensure_ascii=False, indent=2)); return 0
        print(f"\n  «{r['literal']}»  ({r['cubre']})")
        for x in r["archivos"]:
            print(f"    {x['ruta']}:{x['linea']}   h={x['h']}")
        if r.get("ambiguo"):
            print("  ⚠ aparece en muchos archivos: no identifica uno solo")
        print()
        return 0

    if a.cmd == "sin-rastro":
        import archivos as _arch
        r = _arch.sin_rastro(solo_logica=not a.todo)
        if j:
            print(json.dumps(r, ensure_ascii=False, indent=2)); return 0
        print(f"\n  {r['documentados']} archivos que un nodo de context describe"
              f"{' (services y controllers de backend)' if r['solo_logica'] else ''}")
        print(f"    con logs   {r['con_logs']}")
        print(f"    SIN RASTRO {r['sin_rastro']}  ← no se pueden trazar en producción\n")
        for x in r["archivos"][:15]:
            extra = f"  [{', '.join(x['lenders'])}]" if x["lenders"] else ""
            print(f"    {len(x['nodos'])} nodos  {x['ruta'].split('/', 1)[1][:64]}{extra}")
        print(f"\n  {r['nota']}\n")
        return 0

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
        filtra = any([a.lender, a.allied, a.rt, a.tabla, a.marca, a.gates])
        textos, blanca = {}, None
        if filtra:
            # EL ATAJO: el diccionario ya sabe qué archivos tocan qué. Se le pregunta primero y se
            # leen SÓLO ésos — en vez de leer todo el repo y descartar al final.
            dicc = _ar.cargar()
            if dicc:
                pref = a.alias + "/"
                blanca = set()
                for ruta, e in dicc.items():
                    if not ruta.startswith(pref):
                        continue
                    n = {"cx": {"lenders": e.get("lenders", []), "allieds": e.get("comercios", []),
                                "rt": [{"valor": v} for v in e.get("rt", [])],
                                "tablas": e.get("tablas", []), "marcas": e.get("marcas", []),
                                "gates": e.get("gates")}}
                    if _cx.coincide(n, a.lender, a.rt, a.tabla, a.marca, a.gates, a.allied):
                        blanca.add(ruta[len(pref):])
        # Con filtros de negocio hay que extraer SIN presupuesto y recortar después: si no, se
        # descartaría por puntaje antes de saber cuáles son del lender que buscás.
        d = _ex.extraer(a.alias, a.ruta, 10_000 if filtra else a.tope, langs, a.prof, textos,
                        solo_rutas=blanca)
        _cx.enriquecer(d["nodos"], textos)
        if filtra:
            quedan = [n for n in d["nodos"] if _cx.coincide(
                n, a.lender, a.rt, a.tabla, a.marca, a.gates, a.allied)]
            d["filtro_negocio"] = {k: v for k, v in {
                "lender": a.lender, "allied": a.allied, "rt": a.rt,
                "tabla": a.tabla, "marca": a.marca, "gates": a.gates or None}.items() if v}
            d["encontrados"] = len(quedan)
            usado, dentro = 0, []
            for n in quedan:
                cuesta = len(json.dumps(n, ensure_ascii=False))
                if usado + cuesta > a.tope * 1024:
                    continue
                dentro.append(n); usado += cuesta
            d["nodos"], d["entregados"], d["kb"] = dentro, len(dentro), round(usado / 1024, 1)
            d["tope_kb"] = a.tope
        if a.zoom:
            # El zoom se calcula sobre TODO lo encontrado, no sobre lo que entró al presupuesto: si
            # no, la forma de un repo dependería de cuánto lugar quedaba.
            completo = d if d["entregados"] == d["encontrados"] else _ex.extraer(
                a.alias, a.ruta, 10_000, langs, a.prof)
            d["carpetas"] = _ex.agrupar(completo["nodos"], a.alias, a.ruta, a.zoom)
            d.pop("nodos", None)
        # `cx` -> `tags` planos, y el significado UNA vez arriba. Antes cada nodo repetía la
        # descripción de lo que tocaba; con 32 archivos rt=2, el mismo texto 32 veces.
        todos = []
        for n in d.get("nodos", []):
            cx = n.pop("cx", None)
            if cx:
                n["tags"] = _cx.a_tags(cx)
                todos.extend(n["tags"])
        if todos:
            d["glosario"] = _cx.glosario(todos)
        return _salida(d, lambda: _ex.imprimir(d, a.zoom), j)

    return 0


if __name__ == "__main__":
    sys.exit(main())
