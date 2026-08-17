"""LA ESPINA del negocio: los conceptos de CreditOp en el orden en que se encadenan.

POR QUÉ EXISTE, teniendo ya tres vocabularios. `creditop.json` traduce ids a nombres (lender 24 =
Credifamilia), el `GLOSARIO_NEGOCIO` de `indice.py` traduce español a código (cupo →
available_amount), y los 38 nodos de `context/` explican cada área en profundidad. Ninguno contesta
la pregunta de quien llega: **¿cuáles son los conceptos, en qué orden se encadenan, y dónde miro
cada uno?**

⚠ SE ESCRIBE A MANO SÓLO EL ORDEN Y EL CONCEPTO. Todo lo demás —cuántos archivos tocan esa tabla, si
el nodo existe, cuántos mensajes de log la nombran— se resuelve al vuelo contra los otros mapas. Por
eso `negocio.json` es corto y no puede quedar viejo: lo que envejece no está escrito ahí.

⚠ Y NO REEMPLAZA A `context/`: acá va UNA LÍNEA por concepto, la que ubica. El detalle y las trampas
viven en el nodo, y cada entrada dice cuál.

    ./cli.py negocio --zoom 1   el recorrido en una pantalla: sólo los nombres, agrupados por fase
    ./cli.py negocio            (zoom 2) cada concepto con su nombre en código y su nodo
    ./cli.py negocio --zoom 3   todo lo derivado: sinónimos, tabla, cuántos archivos, si se puede trazar
    ./cli.py negocio cupo       un concepto y por dónde seguir
"""
import json
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ESPINA = AQUI / "negocio.json"


def cargar():
    return json.loads(ESPINA.read_text(encoding="utf-8"))


def enriquecer(c):
    """Le suma a un concepto lo que los OTROS mapas ya saben de él. Nada de esto se escribe."""
    import archivos as _arch
    fuera = dict(c)
    if c.get("tabla"):
        r = _arch.buscar(f"tabla:{c['tabla']}")
        fuera["archivos_que_tocan_la_tabla"] = r.get("cuantos", 0)
    if c.get("nodo"):
        m = AQUI.parent / "context" / "server" / "data" / "flows" / c["nodo"] / "map.json"
        fuera["nodo_existe"] = m.is_file()
        if m.is_file():
            fuera["archivos_del_nodo"] = len(json.loads(m.read_text(encoding="utf-8")).get("files", []))
    return fuera


def ver(nombre=None):
    d = cargar()
    cs = d["conceptos"]
    if nombre:
        n = nombre.lower()
        cs = [c for c in cs if n in c["n"].lower() or any(n in s.lower() for s in c.get("es", []))
              or n == (c.get("codigo") or "").lower()]
    return [enriquecer(c) for c in cs]


def por_fase(cs):
    """Agrupa conservando el ORDEN de aparición: las fases salen en la secuencia del recorrido, no
    alfabéticas — que es lo que las vuelve legibles de un vistazo."""
    fuera, orden = {}, []
    for c in cs:
        f = c.get("fase", "—")
        if f not in fuera:
            fuera[f] = []
            orden.append(f)
        fuera[f].append(c)
    return [(f, fuera[f]) for f in orden]


def trazable(c):
    """¿Este concepto DEJA RASTRO en producción? Se deriva de `logs.json` vía la tabla: si ningún
    archivo que la toca emite logs, no hay traza que buscar. Es el dato que decide si una pregunta
    de soporte sobre este concepto se va a poder contestar."""
    if not c.get("tabla"):
        return None
    import archivos as _arch
    d = _arch.cargar()
    tocan = [k for k, v in d.items()
             if c["tabla"] in [t for t in (v.get("tablas") or [])]]
    con = [k for k in tocan if d[k].get("loguea")]
    return {"archivos": len(tocan), "con_logs": len(con)}
