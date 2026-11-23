#!/usr/bin/env python3
"""Comprueba CREDITOP.md, el índice de knowledge/.

- Cada enlace a knowledge/<tema>/rules.md tiene que apuntar a un tema que exista.
- Un `tema#ancla` en el texto del enlace, o un `#ancla` suelto en la misma línea o en un sub-ítem, tiene que
  ser una sección de ese tema (las anclas salen de sources.json: toda sección tiene fuentes).
- Lista los temas que el índice no nombra (avisa, no falla).

Sale 1 si hay un enlace roto.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
INDEX = ROOT / "CREDITOP.md"
KNOWLEDGE = ROOT / "knowledge"

LINK = re.compile(r"\[([^\]]+)\]\((knowledge/[^)]+)\)")
TOPIC_PATH = re.compile(r"^knowledge/([a-z0-9-]+)/rules\.md$")
BARE_ANCHOR = re.compile(r"`#([a-z0-9-]+)`")


def anchors(topic: str) -> set[str]:
    data = json.loads((KNOWLEDGE / topic / "sources.json").read_text())
    return {a for source in data.get("sources", []) for a in source.get("sections", [])}


def main() -> int:
    topics = {p.parent.name for p in KNOWLEDGE.glob("*/rules.md")}
    cache: dict[str, set[str]] = {}
    errors: list[str] = []
    named: set[str] = set()
    current = None  # el último tema enlazado: a él se refieren los `#ancla` sueltos

    for number, line in enumerate(INDEX.read_text().splitlines(), 1):
        for text, href in LINK.findall(line):
            path = ROOT / href
            if not path.exists():
                errors.append(f"línea {number}: {href} no existe")
                continue
            match = TOPIC_PATH.match(href)
            if not match:
                continue
            topic = match.group(1)
            named.add(topic)
            current = topic
            if "#" in text:
                ref_topic, anchor = text.split("#", 1)
                if ref_topic != topic:
                    errors.append(f"línea {number}: el texto «{text}» no coincide con {href}")
                elif anchor not in cache.setdefault(topic, anchors(topic)):
                    errors.append(f"línea {number}: {topic} no tiene la sección #{anchor}")
        for anchor in BARE_ANCHOR.findall(line):
            # Antes del primer enlace, un `#ancla` es texto de ejemplo, no una referencia.
            if current is not None and anchor not in cache.setdefault(current, anchors(current)):
                errors.append(f"línea {number}: {current} no tiene la sección #{anchor}")

    for error in errors:
        print(f"  ✗ {error}")
    missing = sorted(topics - named)
    if missing:
        print("  ▲ temas que el índice no nombra: " + ", ".join(missing))
    if not errors:
        print(f"  ✔ CREDITOP.md: {len(named)} de {len(topics)} temas, todos los enlaces existen")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
