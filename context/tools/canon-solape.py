#!/usr/bin/env python3
"""canon-solape.py — dónde el árbol y canon hablan de lo MISMO, y dónde uno sabe algo que el otro no.

POR QUÉ EXISTE, con el caso que lo pagó. El 2026-09-08 se auditó canon con 28 agentes y 46 minutos, y
uno de sus hallazgos más caros fue que su sección del cupo rotativo describía **un solo motor** cuando
hay dos, con cortes distintos. **El árbol ya lo tenía**: `flows/rotativo/doc.md` trae la tabla
comparativa —redondeo a 50.000 contra 10.000, el nivel truncado contra redondeado hacia arriba, el plazo
mínimo calculado sobre el cupo contra sobre el tope—. O sea que el conocimiento existía, no graduó, y
canon cargó una falsedad meses hasta que una auditoría cara la redescubrió.

Ese es el costo que este comando ataca, y va en las dos direcciones:

  · **ÁRBOL → CANON**: secciones del árbol que pisan una de canon. Si las dos afirman lo mismo, una de
    las dos puede estar vieja — y la que se lee en el equipo es la de canon.
  · **CANON → ÁRBOL**: secciones de canon que el árbol **no menciona en ninguna parte**. Eso es lo que
    el equipo escribió y acá no llegó. Es la mitad que sirve para «mantenerlo al día» sin leer todo.

⚠ ES UN GENERADOR DE CANDIDATOS, NO UN VEREDICTO. La comparación es léxica: un puntaje alto significa
palabras compartidas, no la misma afirmación. Medido el 2026-09-09 sobre las 260 secciones de prosa del
árbol: 24 pares con puntaje fuerte y, leyéndolos, **≈10 hablaban de verdad de lo mismo** — el resto era
coincidencia de vocabulario (una sección sobre un EVENT que reconstruye filas «matcheaba» con una sobre
dónde vive cada cosa). Hay que leer los pares; el comando ordena la cola, no decide.

⚠ Y NO CONFUNDIR SOLAPE CON DUPLICACIÓN. Varias veces el árbol dice lo mismo con algo que canon **no
puede** decir —ids reales, `archivo:línea`, la receta para correrlo—: ahí el solape es legítimo y las
dos versiones se quedan. Lo que hay que arreglar es cuando **se contradicen**.

USO
    python3 tools/canon-solape.py              → las dos direcciones, ordenadas
    python3 tools/canon-solape.py --arbol      → sólo árbol → canon
    python3 tools/canon-solape.py --canon      → sólo canon → árbol (lo que el equipo agregó)
    python3 tools/canon-solape.py --tope 40    → cuántas filas mostrar por dirección
"""
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
CANON_URL = os.environ.get("CANON_URL", "https://canon.playground.creditop.com").rstrip("/")
# El corpus de canon en disco: para la dirección canon → árbol no hace falta red.
CANON_DISCO = pathlib.Path(os.environ.get(
    "CANON_CONTENIDO", os.path.expanduser("~/Desktop/CREDITOP/github/playground/tools/canon/content")))

# Palabras que no discriminan: aparecen en todo el dominio y sólo suben el ruido.
VACIAS = {
    "de", "la", "el", "los", "las", "un", "una", "y", "o", "que", "en", "es", "no", "se", "por", "con",
    "del", "al", "para", "lo", "su", "sus", "como", "más", "mas", "sin", "ya", "pero", "si", "cuando",
    "qué", "que", "cada", "dos", "tres", "solicitud", "entidad", "cliente", "comercio", "canon",
}


def normal(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def palabras(s: str) -> set:
    return {w for w in re.findall(r"[a-z0-9_]{4,}", normal(s)) if w not in VACIAS}


def secciones_del_arbol() -> list:
    ps = json.loads(subprocess.run([sys.executable, str(RAIZ / "tools" / "flota.py"), "json"],
                                   capture_output=True, text=True).stdout)
    out = []
    for p in ps:
        for s in p["secciones"]:
            t = s["titulo"]
            if normal(t).startswith(("indice", "contenido")):
                continue  # un índice no es una afirmación
            out.append((p["nodo"], t))
    return out


def secciones_de_canon() -> list:
    out = []
    if not CANON_DISCO.exists():
        return out
    for md in sorted(CANON_DISCO.glob("*/*.md")):
        nodo = f"{md.parent.name}/{md.stem}"
        for l in md.read_text(encoding="utf-8").splitlines():
            if l.startswith("## "):
                out.append((nodo, l[3:].strip()))
    return out


def arbol_a_canon(tope: int) -> None:
    secs = secciones_del_arbol()
    print(f"\n  ÁRBOL → CANON · {len(secs)} secciones consultadas contra {CANON_URL}")
    print("  Puntaje alto = palabras compartidas. Hay que LEER el par: si los dos afirman lo mismo, una")
    print("  puede estar vieja; si el árbol dice algo que canon no puede decir, el solape es legítimo.\n")
    res = []
    for nodo, titulo in secs:
        q = urllib.parse.quote(titulo[:120])
        try:
            with urllib.request.urlopen(f"{CANON_URL}/api/search?q={q}&limit=3", timeout=20) as r:
                d = json.loads(r.read())
        except Exception:
            continue
        hits = d.get("results") or []
        if hits:
            h = hits[0]
            res.append((h.get("score", 0), nodo, titulo, h.get("node", ""),
                        h.get("section_title") or h.get("anchor") or ""))
        time.sleep(0.04)
    res.sort(reverse=True)
    for s, nodo, tit, cn, ct in res[:tope]:
        print(f"  {s:5d}  {nodo:18s} «{tit[:42]:42s}» → {cn.split('/')[0]:16s} «{ct[:38]}»")
    print(f"\n  {len(res)} de {len(secs)} secciones tuvieron algún resultado.")


def canon_a_arbol(tope: int) -> None:
    """La dirección que sirve para mantenerlo al día: qué escribió el equipo que acá no se menciona."""
    canon = secciones_de_canon()
    if not canon:
        print(f"\n  CANON → ÁRBOL · no encontré el corpus en disco ({CANON_DISCO}).")
        print("  Pasá CANON_CONTENIDO apuntando a `tools/canon/content` del playground compartido.\n")
        return
    docs = {p.parent.name: normal(p.read_text(encoding="utf-8")) for p in (RAIZ / "server" / "data" / "flows").glob("*/doc.md")}
    print(f"\n  CANON → ÁRBOL · {len(canon)} secciones de canon contra el árbol")
    print("  Las de abajo son las que el árbol NO menciona: candidatas a que el equipo sepa algo que acá")
    print("  no llegó. Puede ser legítimo (canon cubre temas que el árbol no tiene) — se lee y se decide.\n")
    # ⚠ EL CUBRIMIENTO SE MIDE CONTRA EL MEJOR NODO, no contra el árbol entero. El primer intento
    #    preguntaba «¿aparecen estas palabras en algún lado?» y contra 145.000 palabras la respuesta es
    #    casi siempre sí: dio 2 huérfanas de 301, o sea ninguna señal. Lo que importa es si ALGÚN nodo
    #    habla de eso, porque el árbol se lee por nodo.
    huerfanas = []
    for nodo, titulo in canon:
        ws = palabras(titulo)
        if not ws:
            continue
        mejor, cual = 0.0, ""
        for id_nodo, texto in docs.items():
            c = sum(1 for w in ws if w in texto) / len(ws)
            if c > mejor:
                mejor, cual = c, id_nodo
        if mejor < 0.6:
            huerfanas.append((mejor, nodo, titulo, cual))
    huerfanas.sort()
    for c, nodo, tit, cual in huerfanas[:tope]:
        print(f"  {int(c*100):3d}%  {nodo:26s} «{tit[:52]:52s}» (lo más cerca: {cual})")
    print(f"\n  {len(huerfanas)} de {len(canon)} secciones de canon que ningún nodo del árbol cubre ni al 60%.")


def main() -> int:
    args = sys.argv[1:]
    tope = 30
    if "--tope" in args:
        tope = int(args[args.index("--tope") + 1])
    solo_arbol, solo_canon = "--arbol" in args, "--canon" in args
    if not solo_canon:
        arbol_a_canon(tope)
    if not solo_arbol:
        canon_a_arbol(tope)
    print("\n  ⚠ Candidatos, no veredictos: medido el 2026-09-09, de 24 pares fuertes ~10 hablaban de lo")
    print("    mismo. Y solape no es duplicación: si el árbol dice algo que canon NO PUEDE decir —ids,")
    print("    `archivo:línea`, la receta para correrlo—, las dos versiones se quedan.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
