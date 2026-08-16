#!/usr/bin/env python3
"""El DICCIONARIO DE ARCHIVOS: `{hash_de_ruta: {…qué representa ese archivo…}}`.

    "A3F9C1": {
      "p": "legacy-backend/Modules/Loans/App/Services/LenderUserCategoryService.php",
      "h": "569a8393",                        <- sha del CONTENIDO cuando se calculó: la frescura
      "lenders":  [{"id": 77, "nombre": "CrediPullman"}],
      "comercios":[{"id": 94, "nombre": "Amoblando Pullman"}],
      "rt": [2], "estados": [11],
      "tablas": ["lender_users_categories", "users_category_log"],
      "marcas": ["CATEGORY_RULE_REJECTED"],
      "gates": true, "tipo": ["service"],
      "nodos": ["profiling", "creditopx"],    <- qué nodos de context/ lo citan
      "notas": []                             <- lo curado a mano, si algún día hace falta
    }

POR QUÉ LA LLAVE ES LA RUTA Y NO EL CONTENIDO — y por qué convive con `tags.py`, que hace lo contrario:

  · llave por CONTENIDO (`tags.py`) = CACHÉ. Se autoinvalida solo, pero al editar un archivo se pierde
    todo lo que tuviera anotado: el sha cambia y la entrada vieja queda huérfana.
  · llave por RUTA (esto) = REGISTRO. Identidad ESTABLE: la anotación sobrevive a las ediciones. Es lo
    que hace falta si acá va a acumularse conocimiento —derivado hoy, curado a mano mañana—, porque
    nadie quiere reescribir una nota cada vez que alguien toca una línea.

El precio de la estabilidad es que puede quedar vieja, y por eso cada entrada guarda `h`: el sha del
contenido con el que se calculó. `verificar()` compara contra `main` y dice cuáles cambiaron. No se
tapa el problema — se hace VISIBLE, que es la única forma honesta de guardar algo derivado.

    ./cli.py archivos --construir      arma o actualiza el diccionario
    ./cli.py archivos --verificar      ¿alguna entrada quedó vieja?
    ./cli.py archivos --buscar smartpay
    ./cli.py archivos --ruta legacy-backend/Modules/...   qué sabemos de un archivo
"""
import hashlib
import json
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
LARGO_LLAVE = 6


def llave(ruta):
    """Hash corto y estable de la RUTA. Determinista: la misma ruta da siempre la misma llave, así que
    dos corridas distintas producen el mismo diccionario y el diff de git es legible."""
    return hashlib.sha1(ruta.encode()).hexdigest()[:LARGO_LLAVE].upper()


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

            k = llave(ruta)
            ent = {"p": ruta, "h": sha[:8]}
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
            # Lo curado a mano SOBREVIVE a la reconstrucción: es la razón de que la llave sea la ruta.
            if viejo.get(k, {}).get("notas"):
                ent["notas"] = viejo[k]["notas"]

            if k not in viejo:
                nuevos += 1
            elif viejo[k].get("h") != ent["h"]:
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


def cargar():
    return json.loads(DICC.read_text(encoding="utf-8")) if DICC.exists() else {}


def verificar():
    """¿Alguna entrada quedó vieja? Compara el `h` guardado contra el sha de `main`.

    Es el precio de guardar algo derivado, y se paga a la vista: un diccionario que no se puede
    auditar es un diccionario que miente y nadie se entera.
    """
    d = cargar()
    if not d:
        print("no hay diccionario todavía: corré `cli.py archivos --construir`")
        return 1
    actuales = {}
    for alias in ROOTS:
        for camino, sha in _ex._shas(alias, solo_codigo=True).items():
            actuales[f"{alias}/{camino}"] = sha[:8]

    viejas = [e for e in d.values() if e["p"] in actuales and actuales[e["p"]] != e.get("h")]
    muertas = [e for e in d.values() if e["p"] not in actuales]
    nuevas = set(actuales) - {e["p"] for e in d.values()}

    print(f"\n  diccionario: {len(d)} archivos")
    print(f"  · al día        {len(d) - len(viejas) - len(muertas)}")
    print(f"  · CAMBIARON     {len(viejas)}   (el archivo se editó desde que se calculó)")
    print(f"  · ya no existen {len(muertas)}")
    # ⚠ «sin entrada» NO es un hueco: son los archivos que no tocan nada del negocio ni los cita
    # ningún nodo, así que no hay qué registrar de ellos. Decirlo como «faltan» invitaba a
    # «completar» un diccionario que está completo.
    print(f"  · sin entrada   {len(nuevas)}   (no tocan nada del dominio: correcto que no estén)")
    for e in viejas[:8]:
        print(f"      cambió: {e['p']}")
    if viejas or muertas:
        print("\n  → `cli.py archivos --construir` lo pone al día (las `notas` a mano se conservan).\n")
    else:
        print("\n  todo al día.\n")
    return 1 if (viejas or muertas) else 0


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
            fuera.append({"llave": k, **e})
    return {"busque": termino, "cuantos": len(fuera),
            "archivos": sorted(fuera, key=lambda x: x["p"])}


def de_ruta(ruta):
    d = cargar()
    e = d.get(llave(ruta))
    return e or {"error": f"sin entrada para {ruta}", "llave_esperada": llave(ruta)}
