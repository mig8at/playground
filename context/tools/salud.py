#!/usr/bin/env python3
"""¿El árbol sigue siendo ÚTIL para un LLM? (no «¿es correcto?» — eso lo contestan oracle/refs/alinear)

Los otros tres chequeos preguntan si el árbol dice la VERDAD. Este pregunta si además SIRVE, que es
otra cosa: un nodo puede tener todas sus rutas resolviendo, todas sus citas ancladas y cero deriva, y
aun así no rutear a nadie porque su `Cuándo:` son 20 palabras genéricas.

Cinco señales, todas medibles y todas aprendidas de un caso real. **La 0 es la que más pesa** y se
mide primero:

0. PUERTAS DE ENTRADA (`## Dónde mirar`) — es lo ÚNICO que generaliza a preguntas que nadie hizo
   todavía. Un mapa de «qué responsabilidad vive en qué archivo y en qué línea decide» sirve para el
   próximo caso; una lista de síntomas sólo sirve para el anterior. La vara es `creditopx`:
   «Orquestador rt=2 → `LenderRetrievalService.php:73 getLenders` · `:718` cupo · `:727` exclusión».
   Sin ancla `archivo:línea` el nodo obliga a leer el archivo entero, y ahí `grep` ya ganó.
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
5. TABLAS MUDAS — una tabla que en PRODUCCIÓN tiene cientos de miles de filas y que ningún `doc.md`
   nombra ni una vez. Las otras cuatro señales miran el árbol contra sí mismo o contra el código;
   ésta lo mira contra **lo que de verdad se está escribiendo en la base**, que es la única fuente
   que no depende de que alguien haya documentado algo. Un área entera puede faltar sin que ninguna
   de las otras señales se mueva: el árbol no tiene un hueco donde mirar, tiene un hueco donde NO
   mirar. Se apoya en `workers/` (el censo de prod y los vecindarios) — si no está, la señal se salta.

⚠ El orden de arriba es el de VALOR, no el de esfuerzo: los síntomas (la tabla del ROUTE-MAP) son un
caché de casos resueltos y no rutean nada nuevo. Si hay que elegir dónde invertir, se invierte en 0.

Exit 0 siempre: esto ORIENTA, no bloquea. Ningún umbral de acá es un veredicto — un `when` corto puede
ser el correcto para un nodo obvio, y un archivo mudo puede estar bien listado. Se corre para decidir
dónde invertir, no para tener todo en verde.
"""
import json, os, re, sys, glob, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(ROOT, "server", "data", "flows")
MIN_SENAS = 3
MIN_ANCLAS = 3  # una puerta con menos de 3 `archivo:línea` no ahorra abrir el archivo
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

    # 0 · puertas de entrada — la señal que más pesa
    puertas = {}
    for n in nodos:
        m = re.search(r"^## Dónde mirar[^\n]*\n(.*?)(?=\n## |\Z)", docs[n], re.S | re.M)
        s = m.group(1) if m else ""
        # Un ancla es `archivo.php:73` O el atajo `:121`, que es la convención de la casa: se nombra el
        # archivo una vez y después sólo la línea («LenderRetrievalService.php:73 · :121 · :650»).
        # Contar sólo la forma larga penalizaba justo a los nodos mejor escritos — `creditopx` tiene 19
        # citas que refs.py valida y este chequeo veía 10.
        puertas[n] = (len(s.split()),
                      len(re.findall(r"`[^`]+\.(?:php|go|ts|tsx|js|jsx|vue)[:`]", s)),
                      len(re.findall(r"\.(?:php|go|ts|tsx|js|jsx|vue):\d+", s)) + len(re.findall(r"`:\d+", s)))
    # Un nodo puede declarar `"puertas": "n/a: <razón>"` en su map.json. Es para las BITÁCORAS, que no
    # dueñan código: `findings` entra por su índice de síntomas, no por archivo:línea. Se pide explícito
    # y con razón —no se adivina por el nombre— porque una excepción silenciosa es cómo un chequeo se
    # vuelve ruido y deja de mirarse.
    exentos = {n for n in nodos if str(mapas[n].get("puertas", "")).startswith("n/a")}
    sin = [n for n in nodos if puertas[n][0] == 0 and n not in exentos]
    flojas = [n for n in nodos if puertas[n][0] > 0 and puertas[n][2] < MIN_ANCLAS and n not in exentos]
    print(f"  0 · PUERTAS DE ENTRADA (`## Dónde mirar` con ancla archivo:línea) ← la que más pesa")
    print(f"      sin la sección       : {len(sin)}   {', '.join(sin[:8]) or '—'}")
    print(f"      con < {MIN_ANCLAS} anclas       : {len(flojas)}   {', '.join(flojas[:8]) or '—'}")
    usables = len(nodos) - len(sin) - len(flojas)
    print(f"      usables              : {usables} de {len(nodos)}  ({100*usables//len(nodos)}%)"
          + (f"   · {len(exentos)} exento(s): {', '.join(sorted(exentos))}" if exentos else ""))

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

    tablas_mudas(nodos)

    print(f"\n  Esto ORIENTA, no bloquea: ningún umbral de acá es un veredicto.")
    print(f"  ¿El árbol dice la verdad? → oracle.py (rutas) · refs.py (citas) · alinear.py (deriva)\n")
    return 0


# Vecindarios que NO piden nodo aunque estén vivos y grandes: son plomería del framework o bitácoras
# de auditoría. `sessions` con 251 filas y `oauth_access_tokens` con 24k son ciertas y no le importan
# a nadie que esté depurando una solicitud. Meterlas en el conteo infla el hueco con ruido y el
# número deja de doler donde tiene que doler.
RACIMOS_SIN_NODO = {"plomería", "auth", "vistas"}
MIN_FILAS_MUDA = 1000  # por debajo, «viva» y «muda» no dice gran cosa


def tablas_mudas(nodos):
    """Señal 5: tablas que la base carga de verdad y que el árbol no nombra nunca.

    ⚠ Se busca la tabla como SUBCADENA del texto entero, no con `\\b`: los doc.md la escriben tanto
    suelta como dentro de `user_requests.status_id` o de una ruta. Buscar con frontera de palabra
    daba mudas que sí estaban mencionadas — un falso hueco es peor que ningún hueco, porque manda a
    documentar lo que ya está documentado.
    """
    import importlib.util
    ruta = os.path.join(os.path.dirname(ROOT), "workers", "modelo.py")
    if not os.path.exists(ruta):
        return
    try:
        sys.path.insert(0, os.path.dirname(ruta))
        spec = importlib.util.spec_from_file_location("modelo", ruta)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        m = mod.cargar()
    except Exception as e:
        print(f"\n  5 · TABLAS MUDAS — no se pudo leer el modelo de workers/ ({e})")
        return

    texto = "\n".join(open(os.path.join(FLOWS, n, "doc.md"), encoding="utf-8").read()
                      for n in nodos if os.path.exists(os.path.join(FLOWS, n, "doc.md")))
    candidatas = {t: v for t, v in m["tablas"].items()
                  if v["estado"] == "viva" and v["racimo"] not in RACIMOS_SIN_NODO
                  and (v["filas"] or 0) >= MIN_FILAS_MUDA}
    mudas = {t: v for t, v in candidatas.items() if t not in texto}

    print(f"\n  5 · TABLAS MUDAS (vivas en prod, sin una sola mención en ningún doc)")
    print(f"      {len(mudas)} de {len(candidatas)} · prod medido el {m['medido']}"
          f" · sin contar {', '.join(sorted(RACIMOS_SIN_NODO))}")
    por = collections.defaultdict(list)
    for t, v in mudas.items():
        por[v["racimo"]].append((v["filas"], t))
    # ordenadas por CUÁNTO del vecindario está mudo, no por tamaño: un área con 11 de 13 sin
    # documentar es un hueco de área; una tabla grande suelta es una tabla grande suelta.
    def hueco(r):
        return len(por[r]) / max(1, sum(1 for v in candidatas.values() if v["racimo"] == r))
    for r in sorted(por, key=hueco, reverse=True):
        vivas_r = sum(1 for v in candidatas.values() if v["racimo"] == r)
        marca = "  ← área entera" if hueco(r) > .6 and vivas_r >= 4 else ""
        print(f"        {r:14} {len(por[r]):2} de {vivas_r:2}{marca}")
        for f, t in sorted(por[r], reverse=True)[:3]:
            print(f"            {f:>10,}  {t}")


if __name__ == "__main__":
    sys.exit(main())
