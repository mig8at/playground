#!/usr/bin/env python3
"""La CAPA DE CREDITOP sobre el extractor genérico.

`extraer.py` no sabe nada de este negocio a propósito: sirve para cualquier repo y por eso se pudo
probar en PHP, TypeScript y Go sin tocarlo. Esta capa va ENCIMA y traduce lo que aquél saca a lo que
acá significa algo: un archivo deja de ser «tiene 20 funciones» y pasa a ser «toca SmartPay, es rt=2,
escribe en user_requests y emite QUOTA_CHECK_REJECTED».

POR QUÉ SEPARADO Y NO ADENTRO: si el conocimiento de negocio se mete en el extractor, éste deja de ser
reusable y —peor— se vuelve un SEGUNDO lugar donde vive ese conocimiento, compitiendo con `context/`.
Acá el diccionario está aparte (`creditop.json`), declara de qué nodo salió cada grupo, y ante una
diferencia manda el nodo.

Lo que agrega a cada nodolite, bajo la clave `cx`:

    lenders   qué entidades toca, por id o por nombre     rt        qué response_type menciona
    estados   qué user_request_status_id usa              tablas    qué tablas del dominio
    marcas    qué marcadores de log emite                 gates     si depende del ambiente

Y los filtros que eso habilita: `--lender 160`, `--rt 2`, `--tabla profiling_reviews`,
`--marca QUOTA_CHECK_REJECTED`, `--gates`.
"""
import json
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
DIC = json.loads((RAIZ / "creditop.json").read_text(encoding="utf-8"))

LENDERS = {k: v for k, v in DIC["lenders"].items() if not k.startswith("_")}
ALLIEDS = {k: v for k, v in DIC["allieds"].items() if not k.startswith("_")}
RT = {k: v for k, v in DIC["response_type"].items() if not k.startswith("_")}
ESTADOS = {k: v for k, v in DIC["estados"].items() if not k.startswith("_")}
TABLAS = [t for t in DIC["tablas"] if not t.startswith("_")]
MARCAS = [m for m in DIC["marcas_de_log"] if not m.startswith("_")]
GATES = DIC["gates_de_ambiente"]["patrones"]

# ⚠ Un número suelto no dice nada: `160` puede ser un timeout. Se exige que esté CERCA de la palabra
# que le da sentido. Sin esto, el filtro por lender devolvía medio repo.
_LENDER_CERCA = re.compile(
    r"(?:lender[_\s]*id|lenderId|lender)\D{0,12}(\d{1,3})\b|\blender[_\s]*id\D{0,4}(\d{1,3})", re.I)
_ALLIED_CERCA = re.compile(r"(?:allied[_\s]*id|alliedId|comercio)\D{0,12}(\d{1,3})\b", re.I)
_RT_CERCA = re.compile(r"response[_\s]*type\D{0,8}(\d)|\brt\s*=\s*(\d)", re.I)
_ESTADO_CERCA = re.compile(r"user_request_status_id\D{0,12}(\d{1,2})\b")


# ⚠ Nombres que NO sirven para identificar al lender por texto:
# · «Creditop X» es el nombre del PRODUCTO y aparece en media base de código (CreditopXPaymentService,
#   creditop_x_requests_history…). Matchearlo por nombre marcaba como «lender 37» a todo rt=2.
# · «SmartPay» tiene DOS ids (152 dev, 160 prod), así que una sola mención producía dos entidades.
#   Se resuelve agrupando: el nombre apunta al id de PROD y el otro sólo se detecta por número.
AMBIGUOS_POR_NOMBRE = {"37", "152", "94"}


def _nombres(texto, dic):
    """Entidades nombradas por su NOMBRE, no por id: `isSmartpay()`, `CredifamiliaConsumo`."""
    fuera = set()
    bajo = texto.lower().replace(" ", "").replace("_", "")
    for id_, nombre in dic.items():
        if id_ in AMBIGUOS_POR_NOMBRE:
            continue
        limpio = nombre.split("(")[0].strip().replace(" ", "").lower()
        if len(limpio) >= 6 and limpio in bajo:
            fuera.add(id_)
    return fuera


def analizar(texto, ruta=""):
    """Qué cosas de CreditOp toca este archivo. Devuelve el bloque `cx`, o {} si no toca ninguna."""
    cx = {}

    ids = {m.group(1) or m.group(2) for m in _LENDER_CERCA.finditer(texto)} - {None}
    ids |= _nombres(texto, LENDERS)
    lenders = sorted((i for i in ids if i in LENDERS), key=int)
    if lenders:
        cx["lenders"] = [{"id": int(i), "nombre": LENDERS[i]} for i in lenders]

    al = {m.group(1) for m in _ALLIED_CERCA.finditer(texto)}
    allieds = sorted((a for a in al if a in ALLIEDS), key=int)
    if allieds:
        cx["allieds"] = [{"id": int(a), "nombre": ALLIEDS[a]} for a in allieds]

    rts = sorted({(m.group(1) or m.group(2)) for m in _RT_CERCA.finditer(texto)} & set(RT), key=int)
    if rts:
        cx["rt"] = [{"valor": int(r), "que_es": RT[r]} for r in rts]

    est = sorted({m.group(1) for m in _ESTADO_CERCA.finditer(texto)} & set(ESTADOS), key=int)
    if est:
        cx["estados"] = [{"id": int(e), "que_es": ESTADOS[e]} for e in est]

    tablas = sorted(t for t in TABLAS if t in texto)
    if tablas:
        cx["tablas"] = tablas

    marcas = sorted(m for m in MARCAS if m in texto)
    if marcas:
        cx["marcas"] = marcas

    if any(g in texto for g in GATES):
        # No es un dato más: si un archivo bifurca por ambiente, su conducta en staging NO es la que
        # se lee — porque staging corre con APP_ENV=development.
        cx["gates"] = True

    return cx


def _del_diccionario(nodos):
    """Los tags ya calculados, si el diccionario existe. Es la razón de que exista: el `cx` de un
    archivo no cambia entre corridas, así que recalcularlo cada vez era trabajo tirado."""
    try:
        import archivos
        d = archivos.cargar()
    except Exception:
        return 0
    if not d:
        return 0
    puestos = 0
    for n in nodos:
        e = d.get(n["p"])
        if not e:
            continue
        cx = {}
        if e.get("lenders"):
            cx["lenders"] = e["lenders"]
        if e.get("comercios"):
            cx["allieds"] = e["comercios"]
        if e.get("rt"):
            cx["rt"] = [{"valor": v, "que_es": RT.get(str(v), "")} for v in e["rt"]]
        if e.get("estados"):
            cx["estados"] = [{"id": v, "que_es": ESTADOS.get(str(v), "")} for v in e["estados"]]
        for c in ("tablas", "marcas"):
            if e.get(c):
                cx[c] = e[c]
        if e.get("gates"):
            cx["gates"] = True
        if cx:
            n["cx"] = cx
            puestos += 1
    return puestos


def enriquecer(nodos, blobs):
    """Suma `cx` a cada nodolite.

    Primero intenta el DICCIONARIO (`archivos.json`): ahí están los tags ya calculados y es una
    lectura de un archivo contra releer miles de blobs. Sólo cae a analizar el texto para los que no
    figuren — un archivo nuevo, o el diccionario sin construir todavía. Así el filtro es instantáneo
    sin dejar de funcionar si el caché no está: degrada, no falla.
    """
    del_dicc = _del_diccionario(nodos)
    for n in nodos:
        if "cx" in n:
            continue
        rel = n["p"].split("/", 1)[1]
        texto = blobs.get(rel)
        if texto is None:
            continue
        cx = analizar(texto, rel)
        if cx:
            n["cx"] = cx
    return nodos


def coincide(nodo, lender=None, rt=None, tabla=None, marca=None, gates=False, allied=None):
    """¿Este nodo pasa los filtros de negocio? Todos los dados tienen que cumplirse (AND)."""
    cx = nodo.get("cx", {})
    if lender is not None and not any(l["id"] == lender for l in cx.get("lenders", [])):
        return False
    if allied is not None and not any(a["id"] == allied for a in cx.get("allieds", [])):
        return False
    if rt is not None and not any(r["valor"] == rt for r in cx.get("rt", [])):
        return False
    if tabla and tabla not in cx.get("tablas", []):
        return False
    if marca and marca not in cx.get("marcas", []):
        return False
    if gates and not cx.get("gates"):
        return False
    return True


def a_tags(cx):
    """El bloque `cx` como lista PLANA de tags. Formato `familia:valor`, una sola convención.

    Por qué plano y no un objeto: el objeto repetía la descripción de cada cosa en CADA archivo que la
    tocaba —«rt=2 es CreditopX, el único inyectable» aparecía 32 veces—, y para un modelo eso es ruido
    caro. Ahora el tag es corto y el significado vive UNA vez, en el glosario del payload.
    """
    t = []
    for l in cx.get("lenders", []):
        t.append(f"lender:{l['id']}")
    for a in cx.get("allieds", []):
        t.append(f"com:{a['id']}")
    for r in cx.get("rt", []):
        t.append(f"rt:{r['valor']}")
    for e in cx.get("estados", []):
        t.append(f"estado:{e['id']}")
    for x in cx.get("tablas", []):
        t.append(f"tabla:{x}")
    for m in cx.get("marcas", []):
        t.append(f"marca:{m}")
    if cx.get("gates"):
        t.append("gates")
    return sorted(set(t))


def glosario(tags):
    """Qué significa cada tag — SÓLO los que aparecen. No es el diccionario entero: es el subconjunto
    que hace falta para leer este payload, que es lo que lo mantiene chico."""
    g = {}
    for tag in sorted(set(tags)):
        familia, _, v = tag.partition(":")
        if tag == "gates":
            g[tag] = DIC["gates_de_ambiente"]["_trampa"]
        elif familia == "lender":
            g[tag] = LENDERS.get(v, "")
        elif familia == "com":
            g[tag] = ALLIEDS.get(v, "")
        elif familia == "rt":
            g[tag] = RT.get(v, "")
        elif familia == "estado":
            g[tag] = ESTADOS.get(v, "")
        elif familia == "tabla":
            g[tag] = DIC["tablas"].get(v, "")
        elif familia == "marca":
            g[tag] = DIC["marcas_de_log"].get(v, "")
    return {k: v for k, v in g.items() if v}


def resumen(cx):
    """Una línea legible de lo que toca un archivo."""
    p = []
    if cx.get("lenders"):
        p.append(" ".join(f"[{l['nombre']}]" for l in cx["lenders"][:3]))
    if cx.get("allieds"):
        p.append(" ".join(f"[com. {a['nombre']}]" for a in cx["allieds"][:2]))
    if cx.get("rt"):
        p.append("rt=" + ",".join(str(r["valor"]) for r in cx["rt"]))
    if cx.get("estados"):
        p.append("estados " + ",".join(str(e["id"]) for e in cx["estados"]))
    if cx.get("tablas"):
        p.append("tablas: " + ", ".join(cx["tablas"][:3]))
    if cx.get("marcas"):
        p.append("logs: " + ", ".join(cx["marcas"][:2]))
    if cx.get("gates"):
        p.append("⚠ bifurca por AMBIENTE")
    return " · ".join(p)
