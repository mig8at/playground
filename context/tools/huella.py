#!/usr/bin/env python3
"""huella.py — la HUELLA MEDIDA de un flujo: qué TABLAS, qué EVENTOS y qué CÓDIGO toca de punta a
punta, y cuánto de eso cubre el árbol. GENERADO desde una corrida real: no se edita a mano.

POR QUÉ EXISTE. El árbol está organizado por TEMA y responde *por qué* el sistema hace lo que hace.
Una tarea, en cambio, llega por FLUJO («el rt=2 de Pullman no cierra»), y ahí la pregunta previa es
*qué toca esto de punta a punta*. Eso no se cura a mano —envejece— y no hace falta: se mide.

⚠ SE MIDE, NO SE DERIVA. El primer intento fue derivarlo de los matchers del trazador, y no sirve:
esos matchers son MENSAJES de log (`QUOTA_CHECK_`, `FIELD_SCORING_COMPLETED`), no ubicaciones de
código — perfectos para clasificar una línea, inútiles como mapa. Las etapas del cierre, que son las
que importan, no traían una sola clase. Por eso esto parte de una corrida.

LOS TRES EJES NO TIENEN LA MISMA RESOLUCIÓN, y decirlo es la mitad del valor:
  · TABLAS   — resolución ALTA. El log general de MySQL ve todas las consultas, sin instrumentar nada.
  · EVENTOS  — resolución MEDIA. Loki solo ve lo que se logueó, y sólo ~13 % de las líneas ancla la
               solicitud (F-102). El wizard además no manda logs a Loki: van a PostHog.
  · CÓDIGO   — resolución BAJA. Sale de los spans de OTel, y la instrumentación es rala: en la corrida
               de referencia, un flujo que tocó 28 tablas emitió **6 clases**. Una ausencia acá no
               prueba nada; es el eje que menos hay que creerle.

CÓMO SE MIDE (3 pasos, con el stack local arriba)

  1. prender el log general y correr el flujo:
       docker exec legacy-backend-mysql-1 mysql -uroot -ppassword \\
         -e "SET GLOBAL general_log_file='/tmp/huella.log'; SET GLOBAL general_log='ON';"
       cd harness && E2E_TARGET=local node dev/sweep.ts close <comercio> <lenderId>
       docker exec legacy-backend-mysql-1 mysql -uroot -ppassword -e "SET GLOBAL general_log='OFF';"
       docker cp legacy-backend-mysql-1:/tmp/huella.log /tmp/huella-mysql.log
  2. el forense de logs (deja `.runs/forense-<ureq>/timeline.ndjson`):
       cd harness && E2E_TARGET=local node dev/loki-trace.ts <ureq>
  3. armar la huella:
       python3 tools/huella.py <ureq> --nombre "rt=2 · Pullman" --mysql /tmp/huella-mysql.log

⚠ APAGÁ EL LOG GENERAL. Queda escribiendo a disco por cada consulta de cualquier conexión.
"""
import json
import os
import re
import sys
import urllib.request
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle import del_ref

CTX = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(CTX, "server", "data", "flows")
HARNESS = os.path.join(os.path.dirname(CTX), "harness")
TEMPO = "http://127.0.0.1:3200/api/traces/"
ESCRIBE = re.compile(r'\b(?:insert\s+into|update|delete\s+from)\s+`?([a-z_][a-z0-9_]*)`?', re.I)
LEE = re.compile(r'\bfrom\s+`([a-z_][a-z0-9_]*)`', re.I)


def tablas(path):
    if not path or not os.path.isfile(path):
        return Counter(), Counter()
    txt = open(path, errors="replace").read()
    return Counter(ESCRIBE.findall(txt)), Counter(m.lower() for m in LEE.findall(txt))


def eventos(ureq):
    """Las líneas de log de la corrida + sus traces, del volcado que deja `dev/loki-trace.ts`."""
    p = os.path.join(HARNESS, ".runs", f"forense-{ureq}", "timeline.ndjson")
    if not os.path.isfile(p):
        return [], []
    filas = [json.loads(l) for l in open(p) if l.strip()]
    return filas, sorted({f.get("traceId") for f in filas if f.get("traceId")})


def spans(traces):
    """`Clase::método` de los spans de OTel. Es el eje flaco: si Tempo no está, se declara vacío."""
    n = Counter()
    for t in traces:
        try:
            d = json.load(urllib.request.urlopen(TEMPO + t, timeout=5))
        except Exception:
            continue

        def walk(o):
            if isinstance(o, dict):
                v = o.get("name")
                if isinstance(v, str) and "::" in v:
                    n[v] += 1
                for x in o.values():
                    walk(x)
            elif isinstance(o, list):
                for x in o:
                    walk(x)
        walk(d)
    return n


def cobertura_arbol():
    """(archivo → nodos, y el índice de basenames) para cruzar lo medido con lo documentado."""
    dueno = defaultdict(list)
    for nid in sorted(os.listdir(FLOWS)):
        mp = os.path.join(FLOWS, nid, "map.json")
        if os.path.isfile(mp):
            for f in json.load(open(mp)).get("files", []):
                dueno[f].append(nid)
    por_clase = defaultdict(list)
    for f in dueno:
        por_clase[os.path.splitext(os.path.basename(f))[0]].append(f)
    return dueno, por_clase


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__.split("CÓMO SE MIDE")[1])
        return 2
    ureq = args[0]
    nombre = sys.argv[sys.argv.index("--nombre") + 1] if "--nombre" in sys.argv else f"uReq {ureq}"
    mysql = sys.argv[sys.argv.index("--mysql") + 1] if "--mysql" in sys.argv else None

    esc, lee = tablas(mysql)
    filas, traces = eventos(ureq)
    sp = spans(traces)
    dueno, por_clase = cobertura_arbol()
    existen, _, _ = del_ref("main")

    # ¿qué tabla nombra algún nodo del árbol? (en prosa: es donde se explica, no en files[])
    prosa = {}
    for nid in sorted(os.listdir(FLOWS)):
        d = os.path.join(FLOWS, nid, "doc.md")
        if os.path.isfile(d):
            prosa[nid] = open(d, errors="replace").read()
    def quien_explica(t):
        return sorted(n for n, txt in prosa.items() if re.search(rf'`?\b{re.escape(t)}\b`?', txt))

    L = []
    L.append(f"# Huella medida · {nombre}\n")
    L.append(f"> GENERADO por `tools/huella.py` desde la corrida **uReq {ureq}** (target `local`). "
             f"Es EVIDENCIA de qué toca el flujo, no explicación de por qué — eso vive en los nodos.\n")

    L.append(f"## Tablas ({len(esc)} escritas · {len(lee)} leídas)\n")
    L.append("| tabla | escrituras | ¿algún nodo la explica? |")
    L.append("|---|---|---|")
    huerfanas = []
    for t, n in esc.most_common():
        qs = quien_explica(t)
        if not qs:
            huerfanas.append(t)
        L.append(f"| `{t}` | {n} | {' · '.join(qs[:3]) if qs else '**ninguno**'} |")
    L.append("")
    if huerfanas:
        L.append(f"**{len(huerfanas)} tabla(s) que el flujo ESCRIBE y ningún nodo nombra:** "
                 + ", ".join(f"`{t}`" for t in huerfanas) + "\n")

    L.append(f"## Código ({len(sp)} clases con span)\n")
    if sp:
        L.append("| clase::método | spans | archivo en `main` | nodo |")
        L.append("|---|---|---|---|")
        for s, n in sp.most_common():
            cls = s.split("::")[0]
            arch = por_clase.get(cls) or [f for f in existen
                                          if os.path.basename(f).startswith(cls + ".")]
            ns = sorted({x for f in arch for x in dueno.get(f, [])})
            L.append(f"| `{s}` | {n} | {arch[0] if arch else '—'} | "
                     f"{' · '.join(ns) if ns else '**ninguno**'} |")
    L.append("")
    L.append(f"## Eventos ({len(filas)} líneas en {len(traces)} traces)\n")
    niv = Counter(f.get("level") for f in filas)
    L.append("· ".join(f"**{k}** {v}" for k, v in niv.most_common()) or "sin líneas")
    errs = [f for f in filas if f.get("level") in ("error", "warning")]
    if errs:
        L.append("\nFallas de la corrida (que igual cerró):\n")
        for f in sorted({e.get("msg", "") for e in errs}):
            L.append(f"  · {f}")
    L.append("")
    L.append("## Qué NO ve esta huella\n")
    L.append(f"- **Código:** solo {len(sp)} clases emitieron span para un flujo que escribió "
             f"{len(esc)} tablas. La instrumentación de OTel es rala: **una ausencia acá no prueba "
             "nada**. Para el mapa real de archivos haría falta cobertura (pcov/xdebug están "
             "instalados en el contenedor, pero exigen tocar el php.ini y reiniciar).")
    L.append("- **Front:** el wizard no manda logs a Loki (van a PostHog), así que todo lo que "
             "decide en pantalla es invisible acá.")
    L.append("- **Otros servicios:** el `trace_id` no se propaga a los micros Go.")
    L.append(f"- **Alcance:** es UNA corrida de UN par (comercio, entidad). Otro par puede tocar "
             "otras tablas — la conducta la decide el par, no la entidad (F-34).")
    print("\n".join(L))
    return 0


if __name__ == "__main__":
    sys.exit(main())
