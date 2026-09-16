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

LO QUE **NO** CONTESTA: las citas sin símbolo pegado (la mayoría: ~1800 de 2026). Para esas la única
vara sigue siendo `refs.py`. El resumen las declara, igual que `refs.py` declara las cortas: un verde
que cubre el 10 % y no lo dice es la trampa que las dos herramientas vienen a no repetir.

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
CITA = re.compile(r"`(?:\[\w[\w\-]*\]\s*)?([\w][\w./+\-]*\." + EXT + r"):(\d+)(?:-(\d+))?`")
SIMB = re.compile(r"`([A-Za-z_][\w]*)`")
CERCA = 3          # cuántas líneas antes/después cuentan como «ahí»
_cache = {}


def versiones(rel):
    """[(nombre, líneas)] — TODAS las copias del archivo en `origin/main`, no la primera."""
    if rel in _cache:
        return _cache[rel]
    out = []
    for repo, pre in CAND:
        try:
            txt = subprocess.run(["git", "-C", f"{G}/{repo}", "show", f"origin/main:{pre}{rel}"],
                                 capture_output=True, text=True, check=True).stdout.split("\n")
            out.append((repo if not pre else f"{repo}/{pre.rstrip('/')}", txt))
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass
    _cache[rel] = out
    return out


def revisar(nodo):
    doc = os.path.join(FLOWS, nodo, "doc.md")
    malas = buenas = sin = 0
    for i, linea in enumerate(io.open(doc, encoding="utf-8").read().split("\n")):
        for m in CITA.finditer(linea):
            rel, n, fin = m.group(1), int(m.group(2)), int(m.group(3) or 0)
            s = SIMB.search(linea, m.end())
            if not s or not re.fullmatch(r" ?\(?", linea[m.end():s.start()]):
                sin += 1
                continue
            sim, vs = s.group(1), versiones(rel)
            if not vs:
                continue                      # el archivo no existe: eso lo reporta `refs.py`
            if any(sim in l for _, t in vs for l in t[max(0, n - CERCA - 1):(fin or n) + CERCA]):
                buenas += 1
                continue
            pat = re.compile(r"\b" + re.escape(sim) + r"\b")
            donde = []
            for repo, t in vs:
                hits = [j + 1 for j, l in enumerate(t) if pat.search(l)]
                donde.append(f"{repo}: " + (f":{hits[0]}" + (f" (+{len(hits)-1})" if len(hits) > 1 else "")
                                            if hits else "no aparece"))
            malas += 1
            rango = f"{n}-{fin}" if fin else str(n)
            print(f"  {nodo}/doc.md:{i+1:<5} {rel}:{rango}  «{sim}» → " + " · ".join(donde))
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
    print(f"⚠ {ts} no traen un símbolo pegado y NO se pueden comprobar así → esto cubre el {cubre}%. "
          f"Para esas, la vara es `tools/refs.py`.")
    return 1 if tm else 0


if __name__ == "__main__":
    sys.exit(main())
