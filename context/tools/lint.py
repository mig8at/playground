#!/usr/bin/env python3
"""lint.py — la guardia de la documentación LLM: caza los patrones que YA se pudrieron una vez.

A diferencia de salud.py (que ORIENTA y siempre sale 0), esto BLOQUEA: exit 1 si hay violaciones.
Es de la familia de la verdad (oracle/refs): cada chequeo existe porque ese patrón produjo una
mentira concreta en este repo — el porqué está al lado de cada regla.

Escape por línea: agregá `<!-- lint:ok -->` cuando la mención es legítima (ej. un README que
ADVIERTE que una carpeta fue borrada).
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]      # context/
PLAY = ROOT.parent                                       # playground/
FLOWS = ROOT / "server" / "data" / "flows"
ESCAPE = "lint:ok"

fallas: list[str] = []


def leer(p: pathlib.Path) -> list[str]:
    try:
        return p.read_text().splitlines()
    except OSError:
        return []


def falla(check: str, p: pathlib.Path, n: int, linea: str) -> None:
    rel = p.relative_to(PLAY)
    fallas.append(f"  {check} · {rel}:{n} · {linea.strip()[:110]}")


# ── L1 · conteos horneados en las PUERTAS (README/CLAUDE/plantillas) ─────────────────────────
# Por qué: «52 hallazgos», «31 nodos», «8 mocks» quedaron mintiendo en 7 lugares. Un número que
# una máquina puede contar no se escribe a mano; la prosa apunta a quien lo computa.
# NO aplica a flows/: un censo con fecha y método es evidencia legítima.
# El lookbehind excluye los RANGOS-instrucción («abrí 2–4 nodos»), que no son una afirmación
# contable sobre el árbol sino una indicación de cuántos leer.
L1_RX = re.compile(r"(?<![\d–—-])\b\d+\s+(nodos?|hallazgos?|repos\b|roots\b|mocks?\b|citas\b|corridas\b|invariantes\b)")
L1_FILES = [PLAY / "README.md", PLAY / "CLAUDE.md", ROOT / "README.md", ROOT / "CLAUDE.md",
            PLAY / "harness" / "CLAUDE.md", PLAY / "harness" / "README.md",
            PLAY / "tablero" / "CLAUDE.md", PLAY / "tablero" / "README.md",
            *sorted((ROOT / "server" / "data" / "doc-templates").glob("*.md"))]
for p in L1_FILES:
    for n, l in enumerate(leer(p), 1):
        if ESCAPE in l:
            continue
        if L1_RX.search(l):
            falla("L1 conteo-horneado", p, n, l)

# ── L2 · referencias a herramientas/carpetas BORRADAS ───────────────────────────────────────
# Por qué: el nodo harness llegó a tener una tabla de 18 comandos de backend-e2e (borrada) y el
# README ruteaba a soporte/ y examples/. findings/ queda exento: ahí la historia es el contenido.
L2_RX = re.compile(r"soporte/|examples/|backend-e2e|backend-mcp")
for p in sorted(PLAY.glob("*.md")) + sorted(ROOT.glob("*.md")) + sorted(FLOWS.glob("*/doc.md")) \
        + [PLAY / "harness" / "CLAUDE.md", PLAY / "harness" / "README.md"]:
    if p.parent.name == "findings":
        continue
    for n, l in enumerate(leer(p), 1):
        if ESCAPE in l:
            continue
        if L2_RX.search(l):
            falla("L2 ref-muerta", p, n, l)

# ── L3 · secciones prohibidas en nodos y plantillas ──────────────────────────────────────────
# Por qué: Bitácora duplica git (187 líneas), Preguntas abiertas eran hipótesis (199) y
# Qué responde duplica el `when` que rutea. La partición: historia→git · preguntas→tablero.
L3_RX = re.compile(r"^## (Bitácora|Preguntas abiertas|Qué responde)")
for p in sorted(FLOWS.glob("*/doc.md")) + sorted((ROOT / "server" / "data" / "doc-templates").glob("*.md")):
    for n, l in enumerate(leer(p), 1):
        if L3_RX.match(l):
            falla("L3 sección-prohibida", p, n, l)

# ── L4 · ruta de código DESNUDA en «Dónde mirar» ─────────────────────────────────────────────
# Por qué: cientos de rutas re-tipeaban map.json sin valor agregado. Una ruta se gana el lugar
# con: ancla `:línea`, razón con « — », o el patrón-casa de grupo `- **Responsabilidad**: rutas…`
# (la etiqueta ES la razón grupal). Una ruta pelada sin nada de eso ya vive en map.json.
PATH_RX = re.compile(r"`[\w@./-]+\.(php|go|ts|tsx|js|jsx|mjs|cjs|vue)`")
ANCHOR_RX = re.compile(r"\.(php|go|ts|tsx|js|jsx|mjs|cjs|vue):\d")
GRUPO_RX = re.compile(r"^\s*[-*]\s+\*\*[^*]+\*\*\s*(\([^)]*\))?\s*:")
for p in sorted(FLOWS.glob("*/doc.md")):
    if p.parent.name == "findings":
        continue
    dentro = False
    for n, l in enumerate(leer(p), 1):
        if l.startswith("## "):
            dentro = l.lstrip("# ").startswith("Dónde mirar")
            continue
        if dentro and l.lstrip().startswith(("-", "*")) and PATH_RX.search(l):
            if not ANCHOR_RX.search(l) and " — " not in l and " – " not in l \
                    and not GRUPO_RX.match(l) and ESCAPE not in l:
                falla("L4 ruta-desnuda", p, n, l)

# ── L5 · todo nodo de tree.json aparece en el ROUTE-MAP ─────────────────────────────────────
# Por qué: `microservicios` vivió semanas registrado e INVISIBLE para el ruteo, sin que nada
# avisara. Cubre también ediciones a mano donde el hook no corre.
try:
    ids = {c["id"] for c in json.loads((ROOT / "tree.json").read_text())["combinations"]}
    mapa = (ROOT / "docs" / "ROUTE-MAP.md").read_text()
    for i in sorted(ids):
        if f"### {i} — " not in mapa and f"- {i}" not in mapa:
            fallas.append(f"  L5 nodo-invisible · {i} está en tree.json y NO en docs/ROUTE-MAP.md (regenerá: python3 tools/build-route-map.py)")
except (OSError, KeyError, json.JSONDecodeError) as e:
    fallas.append(f"  L5 no se pudo evaluar: {e}")

# ── L6 · `kind` fuera del enum ───────────────────────────────────────────────────────────────
# Por qué: un `"referencia"` (español) bucketizó distinto en el generador. Enum congelado.
KINDS = {"root", "reference", "flujo"}
for p in sorted(FLOWS.glob("*/map.json")):
    try:
        k = json.loads(p.read_text()).get("kind", "")
    except (OSError, json.JSONDecodeError):
        continue
    if k and k not in KINDS:
        fallas.append(f"  L6 kind-fuera-de-enum · {p.relative_to(PLAY)} · kind={k!r} (válidos: {sorted(KINDS)})")

# ── L7 · cita doc→doc CON número de línea ────────────────────────────────────────────────────
# Por qué: las líneas de un doc.md se corren con cada poda y refs.py no valida citas a docs.
# Entre nodos se apunta por § sección, nunca por línea.
L7_RX = re.compile(r"doc\.md:\d")
for p in sorted(FLOWS.glob("*/doc.md")):
    if p.parent.name == "findings":
        continue
    for n, l in enumerate(leer(p), 1):
        if ESCAPE in l:
            continue
        if L7_RX.search(l):
            falla("L7 cita-doc-con-línea", p, n, l)

# ── L8 · «Antes de concluir» sepultado bajo la descripción ──────────────────────────────────
# Por qué: es el bloque que corrige creencias falsas, y en TODOS los nodos menos `creditop`
# estaba llegando al 60–92% del documento — o sea después de la descripción, donde ya no cambia
# ninguna decisión. Un modelo abre el nodo con una hipótesis; corregirla al final no sirve.
# El umbral es la mitad: si el doc crece y el bloque queda abajo, la prioridad se invirtió otra vez.
L8_RX = re.compile(r"^## (Antes de concluir|Invariantes|Los \d+ invariantes)")
for p in sorted(FLOWS.glob("*/doc.md")):
    if p.parent.name == "findings":       # el archivo ENTERO es ese bloque
        continue
    ls = leer(p)
    pos = next((i for i, l in enumerate(ls) if L8_RX.match(l)), None)
    if pos is None:
        continue                          # nodo sin nada contraintuitivo: se avisa en salud, no acá
    if ls and pos > len(ls) // 2:
        pct = pos * 100 // max(len(ls), 1)
        fallas.append(f"  L8 bloque-sepultado · {p.relative_to(PLAY)}:{pos + 1} · "
                      f"«Antes de concluir» arranca al {pct}% del doc (tiene que ir en la primera mitad)")

# ── veredicto ────────────────────────────────────────────────────────────────────────────────
if fallas:
    print(f"✗ lint: {len(fallas)} violación(es) — cada una fue una mentira real alguna vez:\n")
    print("\n".join(fallas))
    print("\n  (mención legítima → agregá `<!-- lint:ok -->` en esa línea)")
    sys.exit(1)
print("✓ lint: sin conteos horneados, refs muertas, secciones prohibidas, rutas desnudas,")
print("        nodos invisibles, kinds fuera de enum, citas doc→doc con línea")
print("        ni bloques «Antes de concluir» sepultados bajo la descripción.")
