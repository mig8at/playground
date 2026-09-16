#!/usr/bin/env python3
"""¿La cita `archivo:línea` apunta al SÍMBOLO que la prosa le pone al lado?

POR QUÉ EXISTE, si ya está `refs.py`: contestan preguntas DISTINTAS, y creer que una cubre a la otra
costó 67 citas equivocadas repartidas en nueve nodos.

  · `refs.py` mide **deriva**: guarda el texto que tenía la línea citada EL DÍA QUE SE AFIRMÓ y avisa
    si hoy está en otro lado. Es lo correcto para lo que hace — pero **nunca comprobó que la cita
    fuera cierta**. Una que nació apuntando al método equivocado es ✓ para siempre.
  · Y hay algo peor, que se midió el 2026-09-16: la fecha sale de `git blame` sobre el propio doc, y
    las líneas sin commitear salen con fecha de HOY. O sea que **editar una cita la re-ancla contra
    hoy**: la pasada de citas cortas a ruta completa, que toca todas las líneas, CONGELA EN VERDE lo
    que estuviera mal. `refs.py` lo documenta y es deliberado; la consecuencia no se había visto.
  · Esto mira la otra mitad: la prosa dice `` `…OnboardingController.php:899` `validateOtpCodeAndRedirect` ``
    → ¿está `validateOtpCodeAndRedirect` cerca de :899 en `origin/main`? Estaba en :937.

DOS TRAMPAS, las dos medidas, y por eso el chequeo es más angosto de lo que uno escribiría:

  1. **El símbolo tiene que estar PEGADO.** Entre la cita y el backtick sólo se admite un espacio y/o
     un paréntesis que abre. Con una tolerancia de tres caracteres entraba «). » y se leía el símbolo
     de la frase SIGUIENTE: tres falsos positivos (profiling:104, kyc:405, kyc:420). Es exactamente lo
     que advierte el docstring de `refs.py` cuando dice que emparejar la cita con el símbolo contiguo
     «tampoco se puede» — se puede sólo si se es así de estricto, y aun así REPORTA, no corrige.
  2. **El mismo archivo vive en DOS repos.** `app/Models/User.php` y `app/Actions/RiskCentrals/Experian.php`
     existen en `legacy-backend` y en `legacy-application`. Elegir uno por orden inventa deriva:
     `Experian.php:51` es correcta en `application` y absurda en `legacy-backend`. Se prueban TODOS los
     candidatos y sólo se marca si falla en todos — y el reporte dice dónde está en cada uno.

DOS REDES, y la segunda se agregó porque la primera dejaba afuera demasiado. Si no hay símbolo
pegado, se toma **todo lo que la prosa pone entre backticks hasta la cita siguiente** y se sacan de ahí
los identificadores —también los de dentro de expresiones como `` `$lenderClass = $lender->action` ``—:
basta con que UNO aparezca cerca. Es más laxa a propósito (más cobertura, menos señal por caso), y en
`entities` encontró **7 citas malas que la red estricta no veía**: las de `lender.constants.ts`, que el
doc anota con constantes entre backticks pero no pegadas.

LO QUE **NO** CONTESTA: las citas que no traen NADA entre backticks detrás. Para esas la única vara
sigue siendo `refs.py`. El resumen declara cuántas son, igual que `refs.py` declara las cortas: un verde
que cubre una fracción y no lo dice es la trampa que las dos herramientas vienen a no repetir.

USO
  python3 tools/simbolos.py                 → todos los nodos
  python3 tools/simbolos.py <nodo> [<nodo>] → solo esos
EXIT 0 → nada desalineado · 1 → hay citas que apuntan a otro lado
"""
import io, os, re, subprocess, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS = os.path.join(RAIZ, "server", "data", "flows")
G = os.path.expanduser("~/Desktop/CREDITOP/github")
# (repo, prefijo). El orden NO decide: se prueban todos. El prefijo existe porque el wizard vive en
# un subdirectorio del monorepo y los docs lo citan de las dos formas.
CAND = [("legacy-backend", ""), ("legacy-application", ""), ("pre-approvals-service", ""),
        ("frontend-monorepo", "apps/loan-request-wizard/"), ("frontend-monorepo", "")]
EXT = r"(?:tsx|ts|jsx|js|mjs|cjs|php|vue|go)(?![\w])"
# El `[alias]` que algunos docs anteponen (`[legacy] app/…`) no es parte de la ruta.
# `…` va en la clase: los docs eliden tramos largos (`frontend-monorepo/…/lib/…`) y se resuelven por
# sufijo, igual que en `refs.py`. Sin el caracter, la ruta se cortaba en el trozo de después.
CITA = re.compile(r"`(?:\[\w[\w\-]*\]\s*)?([\w][\w./+…\-]*\." + EXT + r"):(\d+)(?:-(\d+))?`")
SIMB = re.compile(r"`([A-Za-z_][\w]*)`")
BACKTICK = re.compile(r"`([^`]+)`")
IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]{2,}")
# Dónde CORTA la red ancha: en la cita siguiente, en el separador del doc (` · `) o al terminar la
# frase. Sin esto agarraba el símbolo de la oración de al lado — el mismo falso positivo que la red
# estricta ya evitaba (`Prami.php:384` se llevaba el `FN_…` de la frase siguiente).
CORTE = re.compile(r" · |(?<=\))\. |(?<=[a-z])\. ")
# Un `path/al/archivo.php` entre backticks NO es un símbolo de la línea citada: es otra referencia.
# Sin filtrarlo, `app`, `php`, `Models` y `Http` matcheaban en cualquier archivo y todo daba ✓ o ruido.
def utiles(txt):
    if "/" in txt:
        return set()
    # se exige snake_case, camelCase o CONSTANTE: `local`, `case`, `false`, `age` no afirman nada.
    return {w for w in IDENT.findall(txt) if len(w) >= 5 and ("_" in w or any(c.isupper() for c in w[1:]))}
CERCA = 3          # red ESTRICTA: el símbolo tiene que estar EN esa línea (±3 por si el bloque creció)
# Red ANCHA: la prosa describe una REGIÓN («`updateTrigger`, con `apply_all` que lo pisa»), y lo que
# nombra suele vivir DENTRO del método, no en su firma. Con ±3 eso daba falso positivo — `apply_all`
# está 11 líneas debajo de la línea citada, y la cita es correcta. Se mide contra el bloque, no la línea.
CERCA_ANCHA = 30
_cache = {}
_arboles = {}


def versiones(rel):
    """[(nombre, líneas)] — TODAS las copias del archivo en `origin/main`, no la primera."""
    if rel in _cache:
        return _cache[rel]
    elidida = "…" in rel or "..." in rel
    suf = re.split(r"(?:\.{3}|…)/?", rel)[-1] if elidida else None
    out = []
    for repo, pre in CAND:
        ruta = f"{pre}{rel}"
        if elidida:
            if repo not in _arboles:
                _arboles[repo] = subprocess.run(
                    ["git", "-C", f"{G}/{repo}", "ls-tree", "-r", "--name-only", "origin/main"],
                    capture_output=True, text=True).stdout.split("\n")
            hits = [x for x in _arboles[repo] if x.endswith(suf)]
            if not hits:
                continue
            ruta = hits[0]
        try:
            txt = subprocess.run(["git", "-C", f"{G}/{repo}", "show", f"origin/main:{ruta}"],
                                 capture_output=True, text=True, check=True).stdout.split("\n")
            out.append(repo if not pre and not elidida else f"{repo}:{ruta}")
            out[-1] = (out[-1], txt)
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass
    _cache[rel] = out
    return out


def revisar(nodo):
    doc = os.path.join(FLOWS, nodo, "doc.md")
    malas = buenas = sin = 0
    for i, linea in enumerate(io.open(doc, encoding="utf-8").read().split("\n")):
        citas = list(CITA.finditer(linea))
        for k, m in enumerate(citas):
            rel, n, fin = m.group(1), int(m.group(2)), int(m.group(3) or 0)
            # RED 1 — el símbolo PEGADO: tiene que estar ese, y no otro.
            s = SIMB.search(linea, m.end())
            if s and re.fullmatch(r" ?\(?", linea[m.end():s.start()]):
                simbolos, ancha = {s.group(1)}, False
            else:
                # RED 2 — todo lo entrecomillado hasta la cita siguiente: basta con que uno pegue.
                hasta = citas[k + 1].start() if k + 1 < len(citas) else len(linea)
                corte = CORTE.search(linea, m.end(), hasta)
                if corte:
                    hasta = corte.start()
                simbolos = set()
                for b in BACKTICK.finditer(linea[m.end():hasta]):
                    simbolos |= utiles(b.group(1))
                ancha = True
            vs = versiones(rel)
            if not simbolos or not vs:
                sin += 1                      # nada que comparar, o el archivo no existe (lo ve refs.py)
                continue
            radio = CERCA_ANCHA if ancha else CERCA
            cerca = [l for _, t in vs for l in t[max(0, n - radio - 1):(fin or n) + radio]]
            if any(sim in l for sim in simbolos for l in cerca):
                buenas += 1
                continue
            donde = []
            for repo, t in vs:
                hits = [j + 1 for j, l in enumerate(t) if any(sim in l for sim in simbolos)]
                donde.append(f"{repo}: " + (f":{hits[0]}" + (f" (+{len(hits)-1})" if len(hits) > 1 else "")
                                            if hits else "no aparece"))
            malas += 1
            rango = f"{n}-{fin}" if fin else str(n)
            marca = "~" if ancha else " "
            print(f" {marca}{nodo}/doc.md:{i+1:<5} {rel}:{rango}  "
                  f"«{'/'.join(sorted(simbolos)[:3])}» → " + " · ".join(donde))
    return malas, buenas, sin


def main():
    nodos = sys.argv[1:] or sorted(d for d in os.listdir(FLOWS)
                                   if os.path.isfile(os.path.join(FLOWS, d, "doc.md")))
    tm = tb = ts = 0
    for nodo in nodos:
        if not os.path.isfile(os.path.join(FLOWS, nodo, "doc.md")):
            print(f"  ⚠ no existe el nodo «{nodo}»")
            continue
        a, b, c = revisar(nodo)
        tm, tb, ts = tm + a, tb + b, ts + c
    cubre = round(100 * (tm + tb) / max(1, tm + tb + ts))
    print(f"\n{tm + tb + ts} citas con archivo y línea · ⚠ {tm} apuntan a otro lado · ✓ {tb} bien")
    print(f"⚠ {ts} no traen NADA entre backticks detrás y no se pueden comprobar así → esto cubre el "
          f"{cubre}%. Para esas, la vara es `tools/refs.py`. Las marcadas con ~ salen de la red ANCHA "
          f"(basta un identificador de la prosa): más cobertura, menos señal por caso.")
    return 1 if tm else 0


if __name__ == "__main__":
    sys.exit(main())
