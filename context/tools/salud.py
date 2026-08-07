#!/usr/bin/env python3
"""¿El árbol sigue siendo ÚTIL para un LLM? (no «¿es correcto?» — eso lo contestan oracle/refs/alinear)

Los otros tres chequeos preguntan si el árbol dice la VERDAD. Este pregunta si además SIRVE, que es
otra cosa: un nodo puede tener todas sus rutas resolviendo, todas sus citas ancladas y cero deriva, y
aun así no rutear a nadie porque su `Cuándo:` son 20 palabras genéricas.

Cuatro señales, todas medibles y todas aprendidas de un caso real:

1. `when` SIN SEÑAS — lo único que rutea sin embeddings es el vocabulario. Un `Cuándo:` sin un id, una
   tabla, un código de error o una frase de síntoma pierde contra `grep`. Medido: los 6 nodos que peor
   rutearon en el censo del 2026-08-07 tenían 23-27 palabras y cero nombres propios.
2. ARCHIVOS MUDOS — citados en un `map.json` y sin una línea de prosa en ningún `doc.md`. Eso es un
   `ls` con pasos extra: el modelo lo abre, no encuentra por qué está ahí, y termina leyendo el código
   igual habiendo pagado el peaje.
3. HUBS — un archivo en muchos nodos no discrimina nada (`api.php` llegó a estar en 12 de 33). No es
   error: son puntos de cruce reales. Pero si nadie dice POR QUÉ está en cada uno, es ruido.
4. `F-xx` FUERA DEL ÍNDICE — `findings` pesa ~58k tokens; un hallazgo que no está en la tabla de
   síntomas existe y no se encuentra, que para ese archivo es casi lo mismo que no existir.

Exit 0 siempre: esto ORIENTA, no bloquea. Ningún umbral de acá es un veredicto — un `when` corto puede
ser el correcto para un nodo obvio, y un archivo mudo puede estar bien listado. Se corre para decidir
dónde invertir, no para tener todo en verde.
"""
import json, os, re, sys, glob, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(ROOT, "server", "data", "flows")
MIN_SENAS = 3
MAX_NODOS_HUB = 4


def senas(w):
    """Una seña es algo que NO aparece en cualquier nodo: un span en backticks, un id numérico, una
    sigla en mayúsculas, o una frase de síntoma entre comillas angulares. Contar PALABRAS no sirve —
    un `when` largo y genérico rutea peor que uno corto que nombra la tabla exacta."""
    return (len(re.findall(r"`[^`]+`", w)) + len(re.findall(r"\b\d{2,4}\b", w))
            + len(re.findall(r"\b[A-Z]{2,}[A-Z_]*\b", w)) + len(re.findall(r"«[^»]+»", w)))


def main():
    nodos = sorted(os.path.basename(os.path.dirname(m)) for m in glob.glob(f"{FLOWS}/*/map.json"))
    mapas, docs = {}, {}
    for n in nodos:
        mapas[n] = json.load(open(f"{FLOWS}/{n}/map.json"))
        p = f"{FLOWS}/{n}/doc.md"
        docs[n] = open(p).read() if os.path.exists(p) else ""

    print(f"\n  ── salud del árbol · {len(nodos)} nodos ──\n")

    # 1 · ruteo
    flojos = [(senas(mapas[n].get("when", "")), n) for n in nodos]
    malos = sorted(x for x in flojos if x[0] < MIN_SENAS)
    sin_sint = [n for n in nodos if not mapas[n].get("sintomas")]
    print(f"  1 · RUTEO")
    print(f"      whens con < {MIN_SENAS} señas : {len(malos)}   {', '.join(n for _, n in malos[:8]) or '—'}")
    print(f"      sin `sintomas[]`        : {len(sin_sint)}   {', '.join(sin_sint[:8]) or '—'}")

    # 2 · mudos
    mudos = collections.Counter()
    todos_docs = "\n".join(docs.values())
    for n in nodos:
        for f in mapas[n].get("files", []):
            base = os.path.basename(f)
            if base not in todos_docs and base.rsplit(".", 1)[0] not in todos_docs:
                mudos[n] += 1
    tot_f = sum(len(mapas[n].get("files", [])) for n in nodos)
    tot_m = sum(mudos.values())
    print(f"\n  2 · ARCHIVOS MUDOS (listados, sin prosa en ningún doc)")
    print(f"      {tot_m} de {tot_f} ({100*tot_m//tot_f if tot_f else 0}%) · peores nodos:")
    for n, c in mudos.most_common(5):
        print(f"        {n:<22} {c:>4} de {len(mapas[n].get('files', [])):<4} mudos")

    # 3 · hubs
    dueños = collections.defaultdict(set)
    for n in nodos:
        for f in mapas[n].get("files", []):
            dueños[f].add(n)
    hubs = sorted(((len(v), f) for f, v in dueños.items() if len(v) > MAX_NODOS_HUB), reverse=True)
    print(f"\n  3 · HUBS (en > {MAX_NODOS_HUB} nodos: no discriminan)")
    print(f"      {len(hubs)} archivos · top:")
    for c, f in hubs[:5]:
        print(f"        {c:>2}× {os.path.basename(f)[:42]:<44}")

    # 4 · findings
    fdoc = docs.get("findings", "")
    fuera = []
    if fdoc:
        i = fdoc.find("## Índice")
        j = fdoc.find("\n---", i) if i >= 0 else -1
        idx = set(re.findall(r"F-\d+", fdoc[i:j])) if i >= 0 else set()
        real = set(re.findall(r"^### (F-\d+)", fdoc, re.M))
        fuera = sorted(real - idx, key=lambda x: int(x[2:]))
        print(f"\n  4 · FINDINGS")
        print(f"      {len(real)} hallazgos · {len(real)-len(fuera)} indexados · {len(fuera)} FUERA del índice")
        if fuera:
            print(f"        {' '.join(fuera[:12])}")
        fantasma = sorted(idx - real, key=lambda x: int(x[2:]))
        if fantasma:
            print(f"      ⚠ en el índice y NO existen: {' '.join(fantasma)}")

    print(f"\n  Esto ORIENTA, no bloquea: ningún umbral de acá es un veredicto.")
    print(f"  ¿El árbol dice la verdad? → oracle.py (rutas) · refs.py (citas) · alinear.py (deriva)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
