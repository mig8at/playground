#!/usr/bin/env python3
"""El DICCIONARIO DE ARCHIVOS: `{ruta: {…qué representa ese archivo…}}`. Información general, rápida.

    "legacy-backend/Modules/Loans/App/Services/LenderUserCategoryService.php": {
      "lenders":  [{"id": 77, "nombre": "CrediPullman"}],
      "comercios":[{"id": 94, "nombre": "Amoblando Pullman"}],
      "rt": [2], "estados": [11],
      "tablas": ["lender_users_categories", "users_category_log"],
      "marcas": ["CATEGORY_RULE_REJECTED"],
      "gates": true, "tipo": ["service"],
      "nodos": ["profiling", "creditopx"],    <- qué nodos de context/ lo citan
      "notas": []                             <- lo curado a mano, si algún día hace falta
    }

LA LLAVE ES LA RUTA, y adentro NO va ningún hash. Se probaron las tres formas y ésta gana:

    llave hash + la ruta adentro : 472 KB  <- lo peor de los dos: opaco Y redundante
    la ruta como llave           : 428 KB  <- legible, grepeable, y el `git diff` dice QUÉ archivo cambió
    sólo hash, sin la ruta       : 255 KB  <- 40% menos, pero no podés leer tu propio diccionario

Y NO guarda el sha del contenido. Lo tuvo un rato como «marca de frescura» para poder auditar si una
entrada quedó vieja, y sobra por dos razones: saber si un archivo cambió ya es trabajo de GIT, y esto
se reconstruye entero en 3 segundos — auditar algo que se regenera en 3 segundos es ceremonia. Si
dudás de que esté fresco, lo regenerás. No se audita: se rehace.

    ./cli.py archivos --construir      lo arma (3 s, los 12 repos)
    ./cli.py archivos --buscar smartpay
    ./cli.py archivos --ruta legacy-backend/Modules/...   qué sabemos de un archivo
"""
import json
import json as _json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ.parent / "context" / "tools"))

import creditop as _cx  # noqa: E402
import extraer as _ex  # noqa: E402
from roots import ROOTS  # noqa: E402

DICC = RAIZ / "archivos.json"
_RAIZ = RAIZ





def _nodos_que_lo_citan():
    """{ruta: [nodos]} — derivado de los map.json. El diccionario no lo inventa: lo lee del árbol."""
    flows = RAIZ.parent / "context" / "server" / "data" / "flows"
    fuera = {}
    for d in sorted(p for p in flows.iterdir() if p.is_dir()):
        m = d / "map.json"
        if not m.is_file():
            continue
        try:
            for f in json.loads(m.read_text(encoding="utf-8")).get("files", []):
                fuera.setdefault(f, []).append(d.name)
        except json.JSONDecodeError:
            continue
    return fuera


def _tipo(ruta):
    t = []
    bajo = ruta.lower()
    if "/routes/" in bajo or bajo.endswith(("api.php", "web.php", "routes.ts")):
        t.append("rutas")
    if "service" in bajo:
        t.append("service")
    if "controller" in bajo:
        t.append("controller")
    if "/models/" in bajo or "/entities/" in bajo:
        t.append("modelo")
    if "/repositories/" in bajo:
        t.append("repositorio")
    if _ex._es_infra(ruta):
        t.append("infra")
    return t


def construir(aliases=None, verboso=True):
    """Recorre los repos y arma/actualiza el diccionario. Preserva `notas` de lo que ya estaba."""
    aliases = aliases or list(ROOTS)
    viejo = cargar()
    # Se lee UNA vez y se invierte: {archivo: [mensajes]}. Si no está construido, no pasa nada —
    # el campo simplemente no aparece, en vez de romper la reconstrucción del diccionario entero.
    _loguean = {}
    try:
        import logs as _logs
        for msg, donde in _logs.cargar().items():
            for x in donde:
                _loguean.setdefault(x["ruta"], set()).add(msg)
    except Exception:
        pass
    nuevo, citan = {}, _nodos_que_lo_citan()
    nuevos = actualizados = 0

    for alias in aliases:
        shas = _ex._shas(alias, solo_codigo=True)
        p = subprocess.Popen(["git", "-C", ROOTS[alias], "cat-file", "--batch"],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        orden = list(shas.items())
        salida, _ = p.communicate(("\n".join(s for _, s in orden) + "\n").encode(), timeout=600)
        pos = 0
        for camino, sha in orden:
            nl = salida.find(b"\n", pos)
            if nl == -1:
                break
            cab = salida[pos:nl].split()
            if len(cab) < 3:
                break
            largo = int(cab[2])
            texto = salida[nl + 1:nl + 1 + largo].decode("utf-8", "replace")
            pos = nl + 1 + largo + 1

            ruta = f"{alias}/{camino}"
            cx = _cx.analizar(texto, camino)
            tipo = _tipo(camino)
            nodos = citan.get(ruta, [])
            if not (cx or tipo or nodos):
                continue  # nada que decir de este archivo: no ocupa lugar

            k = ruta
            ent = {}
            if cx.get("lenders"):
                ent["lenders"] = cx["lenders"]
            if cx.get("allieds"):
                ent["comercios"] = cx["allieds"]
            if cx.get("rt"):
                ent["rt"] = [r["valor"] for r in cx["rt"]]
            if cx.get("estados"):
                ent["estados"] = [e["id"] for e in cx["estados"]]
            for campo in ("tablas", "marcas"):
                if cx.get(campo):
                    ent[campo] = cx[campo]
            if cx.get("gates"):
                ent["gates"] = True
            if tipo:
                ent["tipo"] = tipo
            if nodos:
                ent["nodos"] = sorted(nodos)
            # Lo que LOGUEA, derivado de `logs.json`: qué mensajes emite este archivo. Es la mitad
            # que faltaba —el campo `marcas` cubría 10 archivos y hay 224 que loguean— y es la que
            # convierte «este archivo existe» en «este archivo deja rastro, y así se lo reconoce en
            # una traza». Sub-objeto y no lista plana para poder filtrar por cuánto y por qué.
            lg = _loguean.get(k)
            if lg:
                ent["loguea"] = {"mensajes": len(lg), "muestra": sorted(lg)[:4]}

            # Lo curado a mano SOBREVIVE a la reconstrucción: es la razón de que la llave sea la ruta.
            if viejo.get(k, {}).get("notas"):
                ent["notas"] = viejo[k]["notas"]

            if k not in viejo:
                nuevos += 1
            elif viejo[k] != ent:
                actualizados += 1
            nuevo[k] = ent
        if verboso:
            print(f"  {alias:26} {len(shas):>5} archivos")

    DICC.write_text(json.dumps(nuevo, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
                    encoding="utf-8")
    fueron = set(viejo) - set(nuevo)
    if verboso:
        print(f"\n  diccionario: {len(nuevo)} archivos · {nuevos} nuevos · {actualizados} cambiaron "
              f"· {len(fueron)} desaparecieron · {DICC.stat().st_size / 1024:.0f} KB")
    return nuevo


def menu_de_nodo(nodo=None, minimo=15):
    """Cuando un agente abre un nodo, ¿cuánto de lo que ve es SEÑAL?

    Un `map.json` es una lista curada a mano, y con el tiempo se le van sumando archivos de plomería
    —`AdminHeader.tsx`, `AdminLayout.tsx`— que están bien citados pero no enseñan nada de negocio. El
    costo no es el archivo: es que el MENÚ del seleccionador se diluye, y elegir bien es todo su
    trabajo.

    «Mudo» = el diccionario no le conoce ningún rasgo de negocio (ni tabla, ni lender, ni rt, ni
    estado, ni logs). ⚠ Y mudo NO ES SOBRANTE: se muestreó y 22 de 24 mudos del front eran de verdad
    componentes de presentación, o sea bien clasificados. Esto es una señal PARA EL CURADOR, no una
    lista para borrar — el `map.json` se cura a mano a propósito, y un nodo puede querer nombrar su
    plomería. Lo que sí se puede afirmar es cuánto pesa esa parte del menú.
    """
    d = cargar()
    F = _RAIZ.parent / "context" / "server" / "data" / "flows"
    import sys as _s
    _s.path.insert(0, str(_RAIZ))
    import indice as _ix
    fuera = []
    for mj in sorted(F.glob("*/map.json")):
        n_ = mj.parent.name
        if nodo and n_ != nodo:
            continue
        fs = _json.loads(mj.read_text(encoding="utf-8")).get("files", [])
        if not fs or (not nodo and len(fs) < minimo):
            continue
        mudos = [f for f in fs if not (set(d.get(f, {})) - {"tipo", "nodos"})]
        kb = sum(_ix.peso(f) or 0 for f in mudos) / 1024
        fuera.append({"nodo": n_, "citados": len(fs), "con_negocio": len(fs) - len(mudos),
                      "mudos": len(mudos), "kb_mudos": round(kb),
                      "ejemplos": [m.rsplit("/", 1)[-1] for m in mudos[:5]]})
    fuera.sort(key=lambda x: -x["mudos"])
    return {"nodos": fuera,
            "nota": "«mudo» = sin rasgo de negocio conocido. NO significa sobrante: se muestreó y la "
                    "mayoría son componentes de presentación bien clasificados. Es una señal para "
                    "quien cura el map.json, no una lista para borrar."}


def sin_rastro(solo_logica=True):
    """EL CRUCE que ningún mapa contesta solo: qué archivos el NEGOCIO documenta y NO dejan rastro
    en producción — o sea, código que importa y es invisible en Loki.

    Sale de juntar tres mapas por la ruta: `context/` dice qué archivos describe un nodo (`nodos`),
    `logs.json` dice cuáles emiten mensajes (`loguea`), y este diccionario dice de qué tipo es cada
    uno. Ninguno de los tres lo sabe por su cuenta.

    ⚠ `solo_logica` filtra a services y controllers de backend, y NO es cosmético: sin él el 88% del
    árbol sale «ciego» y el número no significa nada, porque encabezan archivos de rutas, config y
    front — que no loguean POR DISEÑO. Un `routes/api.php` sin logs no es un problema. Un
    `CreditopXFlowService` sin logs, sí.

    Para qué sirve: decide si una pregunta de soporte se va a poder contestar ANTES de prometerlo.
    Si el archivo que te importa está en esta lista, no hay traza que buscar — hay que instrumentar
    primero.
    """
    d = cargar()

    def es_logica(k, v):
        t = set(v.get("tipo") or [])
        return bool(t & {"service", "controller"}) and k.split("/")[0] in ("legacy-backend", "application") \
            and "test" not in k.lower()

    doc = {k: v for k, v in d.items()
           if v.get("nodos") and (not solo_logica or es_logica(k, v))}
    ciegos = {k: v for k, v in doc.items() if not v.get("loguea")}
    orden = sorted(ciegos.items(), key=lambda kv: -len(kv[1].get("nodos", [])))
    return {
        "documentados": len(doc), "con_logs": len(doc) - len(ciegos), "sin_rastro": len(ciegos),
        "solo_logica": solo_logica,
        "archivos": [{"ruta": k, "nodos": v["nodos"], "tablas": v.get("tablas", []),
                      "lenders": [x["nombre"] for x in v.get("lenders", [])]}
                     for k, v in orden[:40]],
        "nota": "ordenados por cuántos nodos de negocio los citan. Que no logueen no es un bug en sí: "
                "es que NO SE PUEDEN TRAZAR en producción, y eso hay que saberlo antes de prometer "
                "una investigación sobre ellos.",
    }


def cargar():
    return json.loads(DICC.read_text(encoding="utf-8")) if DICC.exists() else {}


def buscar(termino):
    """Qué archivos representan algo: 'smartpay', 'lender:77', 'gates', 'tabla:user_requests'.

    ⚠ Soporta la sintaxis `campo:valor` mirando los campos ESTRUCTURADOS, no el texto: buscar
    «lender:77» contra el JSON crudo daba cero, porque adentro está como {"id": 77, ...}. Que la
    sintaxis del filtro no matchee la forma del dato es un clásico, y falla en silencio: devuelve
    vacío y parece que no hay nada."""
    t = termino.lower().strip()
    campo, _, valor = t.partition(":")
    fuera = []
    for k, e in cargar().items():
        ok = False
        if valor:
            if campo in ("lender", "lenders"):
                ok = any(str(x["id"]) == valor or valor in x["nombre"].lower()
                         for x in e.get("lenders", []))
            elif campo in ("comercio", "comercios", "allied"):
                ok = any(str(x["id"]) == valor or valor in x["nombre"].lower()
                         for x in e.get("comercios", []))
            elif campo == "rt":
                ok = valor.isdigit() and int(valor) in e.get("rt", [])
            elif campo == "estado":
                ok = valor.isdigit() and int(valor) in e.get("estados", [])
            elif campo in ("tabla", "tablas"):
                ok = any(valor in x.lower() for x in e.get("tablas", []))
            elif campo in ("marca", "marcas", "log"):
                ok = any(valor in x.lower() for x in e.get("marcas", []))
            elif campo == "nodo":
                ok = any(valor == x.lower() for x in e.get("nodos", []))
            elif campo == "tipo":
                ok = valor in [x.lower() for x in e.get("tipo", [])]
            else:
                ok = t in json.dumps(e, ensure_ascii=False).lower()
        elif t == "gates":
            ok = bool(e.get("gates"))
        else:
            ok = t in json.dumps(e, ensure_ascii=False).lower()
        if ok:
            fuera.append({"p": k, **e})
    return {"busque": termino, "cuantos": len(fuera),
            "archivos": sorted(fuera, key=lambda x: x["p"])}


def de_ruta(ruta):
    return cargar().get(ruta) or {"error": f"sin entrada para {ruta}",
                                  "quizas": "¿la ruta va como 'alias/camino'? ej: legacy-backend/app/..."}


def censo():
    """Qué tags EXISTEN en todo el código y cuántos archivos tiene cada uno.

    Es el `--help` de los datos: sin esto no se sabe qué se puede pedir. Y salió más interesante que
    su motivo original — es un censo del código por concepto de negocio, algo que nadie había contado.
    """
    import creditop as _cx
    cuenta = {}
    for e in cargar().values():
        cx = {"lenders": e.get("lenders", []), "allieds": e.get("comercios", []),
              "rt": [{"valor": v} for v in e.get("rt", [])],
              "estados": [{"id": v} for v in e.get("estados", [])],
              "tablas": e.get("tablas", []), "marcas": e.get("marcas", []),
              "gates": e.get("gates")}
        for tag in _cx.a_tags(cx):
            cuenta[tag] = cuenta.get(tag, 0) + 1
        for tp in e.get("tipo", []):
            cuenta[f"tipo:{tp}"] = cuenta.get(f"tipo:{tp}", 0) + 1
    porFamilia = {}
    for tag, n in sorted(cuenta.items(), key=lambda x: -x[1]):
        porFamilia.setdefault(tag.split(":")[0], []).append((tag, n))
    return porFamilia
