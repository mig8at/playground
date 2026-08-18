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

    s = con_json(sub.add_parser(
        "menu", help="cuando un agente abre un nodo de context, ¿cuánto del menú es señal?"))
    s.add_argument("nodo", nargs="?", help="un nodo; vacío = todos los que citan 15+ archivos")

    s = con_json(sub.add_parser(
        "flujos", help="qué sabe PROBAR el harness — y qué códigos de error no cubre nadie"))
    s.add_argument("--construir", action="store_true", help="rearma el mapa leyendo los specs")
    s.add_argument("--codigos", action="store_true", help="sólo el cruce: códigos sin prueba")
    # ⚠ Por TRAZA y no por ureq: sólo el 11% de las líneas llevan el `user_request_id` en su texto
    # (medido), así que anclar por ureq acá devolvía casi siempre cero — que se lee como «no hizo
    # nada». Resolver ureq→traza bien exige cruzar la BD, y eso ya lo hace el trazador: `make
    # trazador-ureq` da las etapas y los archivos. Acá se entra por lo que agrupa de verdad.
    s.add_argument("--traza", help="los PASOS reales de una traza, en orden (trace_id de Loki)")

    s = con_json(sub.add_parser(
        "negocio", help="LA ESPINA: los conceptos de CreditOp en orden, y dónde mirar cada uno"))
    s.add_argument("concepto", nargs="?", help="uno solo (acepta sinónimos: «buró», «tier», «ureq»)")
    s.add_argument("--zoom", type=int, default=2, choices=[1, 2, 3, 4],
                   help="1 = el recorrido · 2 = normal · 3 = todo lo derivado · 4 = PASO A PASO (10×5)")
    s.add_argument("--acciones", action="store_true",
                   help="el vocabulario de ACCIONES: qué HACE el sistema, no de qué habla")
    s.add_argument("--traza", help="qué hizo el sistema en esta traza, agrupado por acción")

    s = con_json(sub.add_parser(
        "relaciones", help="el MODELO DE DATOS: 247 tablas en vecindarios, y con qué se une cada una"))
    s.add_argument("tabla", nargs="?", metavar="<vecindario|tabla>",
                   help="un vecindario (`riesgo`, `plata`…) o una tabla suelta")
    s.add_argument("--html", nargs="?", const="modelo.html", metavar="<archivo>",
                   help="la CARTA: la misma info en una página navegable, para leerla de un vistazo")

    s = con_json(sub.add_parser(
        "quemado", help="dónde el código decide por IDENTIDAD y no por configuración"))
    s.add_argument("categoria", nargs="?",
                   choices=["despacho", "id_quemado", "lista_ids", "ambiente"],
                   help="una sola categoría, con sus archivos y líneas")

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

    if a.cmd == "relaciones":
        import json as _j, collections as _c
        import modelo as _mod
        m = _mod.cargar()
        T, grupos = m["tablas"], _mod.por_racimo(m)
        if a.html:
            import modelo_html as _mh, pathlib as _pl
            d = _mh.generar(_pl.Path(a.html).expanduser().resolve())
            print(f"\n  carta escrita: {d}\n  ábrila con: open {d}\n")
            return 0
        if j:
            print(_j.dumps(m, ensure_ascii=False, indent=2)); return 0

        # Un vecindario: sus tablas, la que más carga primero.
        if a.tabla in grupos:
            print(f"\n  {a.tabla} — {_mod.descripcion(a.tabla)}\n")
            for t in grupos[a.tabla]:
                v = T[t]
                peso = f"{v['filas']:>10,}" if v["filas"] else " " * 10
                marca = "" if v["estado"] in ("viva", "vista") else f"  ({v['estado']})"
                print(f"    {peso}  {t}{marca}")
            print(f"\n  `relaciones <tabla>` para el detalle de una.\n")
            return 0

        # Una tabla: con qué se une, y en qué vecindario vive.
        if a.tabla:
            v = T.get(a.tabla)
            if not v:
                # subcadena Y parecido: `user_reqest` no contiene a `user_requests`, y un typo es
                # justo el caso en que uno necesita la sugerencia
                import difflib as _dl
                cerca = ([t for t in T if a.tabla.lower() in t.lower()]
                         or _dl.get_close_matches(a.tabla, T, n=5, cutoff=0.6))[:8]
                print(f"\n  no existe `{a.tabla}`."
                      + (f" ¿alguna de estas? {', '.join(cerca)}" if cerca else "")
                      + f"\n  vecindarios: {' · '.join(sorted(grupos))}\n")
                return 1
            peso = f"{v['filas']:,} filas" if v["filas"] else v["estado"]
            hered = "  (vecindario heredado de a dónde apunta)" if v["heredado"] else ""
            print(f"\n  {a.tabla}   ·   {v['racimo']}   ·   {peso}{hered}\n")
            print(f"    APUNTA A ({len(v['apunta_a'])}):")
            for col, r in v["apunta_a"]:
                print(f"      {col:34} → {r['a']:32} [{r['via']}]"
                      + ("  ⚠ no se sostiene en los datos" if r.get("⚠") else ""))
                if r.get("rol"):
                    print(f"        {r['rol'][:88]}")
            print(f"\n    LE APUNTAN ({len(v['le_apuntan'])}):")
            for k in v["le_apuntan"][:24]:
                print(f"      {k}")
            if len(v["le_apuntan"]) > 24:
                print(f"      … y {len(v['le_apuntan']) - 24} más")
            print()
            return 0

        # El mapa: los vecindarios y la columna vertebral.
        n_rel = sum(len(v["apunta_a"]) for v in T.values())
        rotas = [(t, c) for t, v in T.items() for c, r in v["apunta_a"] if r.get("⚠")]
        print(f"\n  {len(T)} tablas · {n_rel} relaciones · prod medido el {m['medido']}\n")
        for k in sorted(grupos, key=lambda k: -len(grupos[k])):
            vivas = sum(1 for t in grupos[k] if T[t]["estado"] == "viva")
            print(f"    {k:14} {len(grupos[k]):3} tablas, {vivas:2} con datos"
                  f"   {_mod.descripcion(k)}")
        print(f"\n  LA ESPINA — todo cuelga de estas cuatro:")
        for t, n_ in _mod.espina(m):
            print(f"    {t:16} le apuntan {n_:3} columnas   ({T[t]['filas']:,} filas)")
        via = _c.Counter(r["via"] for v in T.values() for _, r in v["apunta_a"])
        print(f"\n  DE DÓNDE SALE CADA RELACIÓN: "
              + " · ".join(f"{k} {n_}" for k, n_ in via.most_common()))
        print(f"  ⚠ {len(rotas)} inferidas NO se sostienen en los datos "
              f"({', '.join(f'{t}.{c}' for t, c in rotas[:3])}…)")
        print("\n  `relaciones <vecindario>` · `relaciones <tabla>` · `--json`\n")
        return 0

    if a.cmd == "quemado":
        import json as _j, collections as _c
        import quemado as _q
        hits = _q.barrer()
        if j:
            print(_j.dumps({"coincidencias": hits,
                            "archivos_por_entidad": _q.plantillas_por_entidad()},
                           ensure_ascii=False, indent=2))
            return 0
        errs = [x for x in hits if "error" in x]
        for e in errs:
            print(f"  ⚠ {e['repo']}/{e['categoria']}: {e['error']}")

        if a.categoria:
            ss = [x for x in hits if x["categoria"] == a.categoria and "error" not in x]
            desc = next(d for c, _, _, _, d in _q.PATRONES if c == a.categoria)
            print(f"\n  {a.categoria} — {desc}\n")
            visto = set()
            for x in sorted(ss, key=lambda x: (x["repo"], x["archivo"], x["linea"])):
                clave = (x["repo"], x["archivo"], x["linea"])
                if clave in visto:
                    continue
                visto.add(clave)
                quienes = " · ".join(
                    f"{y['columna']} {y['id']} = {y['quien']}"
                    for y in ss if (y["repo"], y["archivo"], y["linea"]) == clave and y.get("quien"))
                print(f"    {x['repo']}/{x['archivo']}:{x['linea']}")
                if quienes:
                    print(f"      → {quienes}")
            print()
            return 0

        cats = _c.Counter(x["categoria"] for x in hits if "error" not in x)
        print(f"\n  {sum(cats.values())} lugares donde el código decide por identidad\n")
        for c, _, _, _, d in _q.PATRONES:
            if cats.get(c):
                print(f"    {c:12} {cats[c]:4}   {d}")
                if c == "lista_ids":
                    # el desglose no es cosmético: 97 de estas son máquinas de estado en SQL
                    # (normales) y sólo las de ENTIDAD son conducta atada a un comercio o un lender
                    sob = _c.Counter(x.get("sobre") for x in hits
                                     if x["categoria"] == "lista_ids" and x.get("sobre"))
                    print(f"    {'':12} {'':4}   └ "
                          + " · ".join(f"{n} de {k}" for k, n in sob.most_common()))
                cats[c] = 0
        con_id = [x for x in hits if x.get("id")]
        print(f"\n  A QUIÉN NOMBRAN — {len(con_id)} ids quemados, "
              f"{sum(1 for x in con_id if x.get('quien'))} resueltos a un nombre:")
        for (col, i, quien), n in _c.Counter(
                (x["columna"], x["id"], x["quien"]) for x in con_id).most_common(12):
            print(f"    {n}×  {col} {i:>4}  =  {quien}")
        pl = _q.plantillas_por_entidad()
        print(f"\n  ARCHIVOS BAUTIZADOS CON UN ID: {sum(len(v) for v in pl.values())} "
              f"para {len(pl)} entidades")
        print(f"    quien no tiene el suyo cae al genérico, y no hay dónde consultarlo:")
        for i in sorted(pl, key=int):
            print(f"      {i:>4}  {len(pl[i])} archivo(s)")
        print("\n  `quemado <categoria>` para los archivos y líneas · `--json`\n")
        return 0

    if a.cmd == "negocio":
        import negocio as _neg
        if a.zoom == 4:
            d = _neg.cargar()
            arb = d["arbol"]
            if j:
                print(json.dumps(arb, ensure_ascii=False, indent=2)); return 0
            vistos = sum(1 for k, v_ in arb.items() for s in v_ if not s.startswith("_")
                         and v_[s].get("visto_en_prod"))
            tot = sum(1 for k, v_ in arb.items() for s in v_ if not s.startswith("_"))
            print(f"\n  EL ÁRBOL · {len(arb)} tramos × {tot} pasos  "
                  f"({vistos} ocurren en producción · {tot - vistos} sólo existen en el código)\n")
            for i, (k, v_) in enumerate(arb.items(), 1):
                print(f"  {i:2}. {k}")
                print(f"      {v_['_n']}  ·  {v_['_cuando']}")
                for sk, s in v_.items():
                    if sk.startswith("_"):
                        continue
                    marca = "●" if s["visto_en_prod"] else "○"
                    falla = f"   ⚠ {s['falla'][:46]}" if s.get("falla") else ""
                    print(f"        {marca} {sk:38}{falla}")
                print()
            print("  ● ocurre en producción  ·  ○ sólo existe en el código (medido en 6h)")
            print("  `--zoom 4 --json` para el árbol entero con sus señales.\n")
            return 0
        if a.acciones:
            d = _neg.cargar()
            print("\n  LAS ACCIONES · qué HACE el sistema (el otro eje: los conceptos son sustantivos)\n")
            for x in d["acciones"]:
                print(f"    {x['n']:24} {x['que_es'][:78]}")
            print("\n  `--traza <trace_id>` para ver cuáles ocurrieron en una corrida.\n")
            return 0
        if a.traza:
            import datos as _d, json as _j, re as _re
            _d.TARGET = "prod"
            sel = '{service_name="legacy-backend"} | trace_id="' + a.traza + '"'
            crudas = _d._lineas_crudas(sel, "24h", 600)
            msgs = []
            for _, _, cc in (list(reversed(crudas)) if isinstance(crudas, list) else []):
                try: msgs.append(_j.loads(cc).get("message", ""))
                except Exception:
                    g = _re.search(r'"message"\s*:\s*"((?:[^"\\]|\\.)*)"', cc)
                    if g: msgs.append(g.group(1))
            r = _neg.resumir([m for m in msgs if m])
            if j:
                print(json.dumps(r, ensure_ascii=False, indent=2)); return 0
            print(f"\n  QUÉ HIZO EL SISTEMA · {r['lineas']} líneas → {len(r['pasos'])} acciones\n")
            for x in r["pasos"]:
                f = f"  ⚠ {x['fallos']} fallo(s)" if x["fallos"] else ""
                c = f"  [{', '.join(x['conceptos'][:3])}]" if x["conceptos"] else ""
                print(f"    {x['lineas']:3}×  {x['accion']:24}{c}{f}")
            print(f"\n  ({r['sin_clasificar']} líneas sin acción reconocida — contexto, no pasos)\n")
            return 0
        cs = _neg.ver(a.concepto)
        if j:
            print(json.dumps(cs, ensure_ascii=False, indent=2)); return 0
        if not cs:
            print(f"  no encontré «{a.concepto}» en la espina. Corré sin argumento para verla entera.")
            return 1
        if a.concepto and len(cs) <= 3:
            for c in cs:
                print(f"\n  {c['n'].upper()}")
                print(f"    {c['que_es']}")
                print(f"\n    en el código   {c['codigo']}")
                if c.get("es"):    print(f"    también        {', '.join(c['es'])}")
                if c.get("tabla"): print(f"    tabla          {c['tabla']}  ({c.get('archivos_que_tocan_la_tabla', 0)} archivos la tocan)")
                print(f"    el detalle en  context/server/data/flows/{c['nodo']}/doc.md"
                      f"  ({c.get('archivos_del_nodo', 0)} archivos)")
            print()
            return 0
        if a.zoom == 1:
            print("\n  EL RECORRIDO\n")
            for fase, items in _neg.por_fase(cs):
                print(f"  {fase.upper():18}  " + " → ".join(c["n"] for c in items))
            print("\n  `--zoom 2` agrega el nombre en código y el nodo · `--zoom 3`, todo.\n")
            return 0
        if a.zoom == 3:
            print("\n  LA ESPINA · todo lo que se puede derivar de cada concepto\n")
            for fase, items in _neg.por_fase(cs):
                print(f"  ══ {fase.upper()}")
                for c in items:
                    print(f"\n    {c['n']}  ·  {c['codigo']}")
                    print(f"      {c['que_es']}")
                    if c.get("es"):
                        print(f"      también:  {', '.join(c['es'])}")
                    if c.get("tabla"):
                        tr = _neg.trazable(c) or {}
                        print(f"      tabla:    {c['tabla']}  ·  {tr.get('archivos', 0)} archivos la tocan"
                              f"  ·  {tr.get('con_logs', 0)} dejan rastro en prod")
                    print(f"      detalle:  context/…/flows/{c['nodo']}/doc.md"
                          f"  ({c.get('archivos_del_nodo', 0)} archivos)")
                print()
            return 0
        print("\n  LA ESPINA · los conceptos en el orden en que se encadenan\n")
        for fase, items in _neg.por_fase(cs):
            print(f"  ── {fase}")
            for c in items:
                extra = f"· {c['archivos_que_tocan_la_tabla']} arch." if c.get("archivos_que_tocan_la_tabla") else ""
                print(f"     {c['n']:28} {c['codigo']:26} [{c['nodo']}] {extra}")
        print("\n  `--zoom 1` el recorrido solo · `--zoom 3` todo · `negocio <concepto>` para uno.\n")
        return 0

    if a.cmd == "flujos":
        import flujos as _fl
        if a.construir:
            _fl.construir(); return 0
        if a.traza:
            import datos as _d, json as _j, re as _re
            _d.TARGET = "prod"
            sel = '{service_name="legacy-backend"} | trace_id="' + a.traza + '"'
            crudas = _d._lineas_crudas(sel, "24h", 500)
            # ⚠ `_lineas_crudas` devuelve MÁS NUEVO PRIMERO (así se leen los logs: lo último arriba).
            # Un RECORRIDO se lee al derecho, así que acá se invierte. Sin esto el paso 1 era
            # «exiting» y el flujo salía de atrás para adelante — legible, plausible y al revés.
            if isinstance(crudas, list):
                crudas = list(reversed(crudas))
            msgs = []
            for _, _, c in (crudas if isinstance(crudas, list) else []):
                try: msgs.append(_j.loads(c).get("message", ""))
                except Exception:
                    g = _re.search(r'"message"\s*:\s*"((?:[^"\\]|\\.)*)"', c)
                    if g: msgs.append(g.group(1))
            pasos = _fl.secuencia([m for m in msgs if m])
            if j:
                print(json.dumps({"traza": a.traza, "pasos": pasos}, ensure_ascii=False, indent=2)); return 0
            print(f"\n  traza {a.traza[:16]}… · {len(pasos)} pasos, en orden de primera aparición\n")
            for i, p_ in enumerate(pasos, 1):
                print(f"    {i:3}. {p_[:96]}")
            print("\n  ⚠ es el recorrido de UNA corrida, no el flujo canónico: otra solicitud puede diferir.\n")
            return 0
        if a.codigos:
            r = _fl.codigos_sin_prueba()
            if j:
                print(json.dumps(r, ensure_ascii=False, indent=2)); return 0
            print(f"\n  {len(r['probados'])} códigos cubiertos por algún spec")
            print(f"\n  ⚠ CÓDIGOS QUE EL CLIENTE RECIBE Y NADIE PRUEBA ({len(r['codigos_sin_prueba'])}):")
            for c in r["codigos_sin_prueba"]:
                print(f"      {c}")
            print(f"\n  (telemetría interna sin prueba, que NO son fallos: {len(r['marcas_sin_prueba'])})")
            print(f"\n  {r['nota']}\n")
            return 0
        d = _fl.cargar()
        if not d:
            print("  el mapa no está construido: ./cli.py flujos --construir"); return 1
        if j:
            print(json.dumps(d, ensure_ascii=False, indent=2)); return 0
        ejes = {}
        for k, v in d.items():
            ejes.setdefault(v["eje"], []).append((k, v))
        print(f"\n  {len(d)} specs · {sum(len(v['escenarios']) for v in d.values())} escenarios\n")
        for eje, items in sorted(ejes.items()):
            print(f"  ── {eje}")
            for k, v in items[:6]:
                print(f"     {k.split('/')[-1][:44]:46} {len(v['escenarios'])} escenario(s)"
                      + (f" · {', '.join(v['codigos'][:3])}" if v.get("codigos") else ""))
        print()
        return 0

    if a.cmd == "menu":
        import archivos as _arch
        r = _arch.menu_de_nodo(a.nodo)
        if j:
            print(json.dumps(r, ensure_ascii=False, indent=2)); return 0
        print("\n  cuando un agente abre un nodo, ¿cuánto del menú tiene señal de negocio?\n")
        for x in r["nodos"][:15]:
            print(f"    {x['nodo']:16} {x['con_negocio']:3}/{x['citados']:3} con negocio"
                  f"  ·  {x['mudos']:3} mudos = {x['kb_mudos']:4} KB")
            if a.nodo:
                print(f"       ej: {', '.join(x['ejemplos'])}")
        print(f"\n  {r['nota']}\n")
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
