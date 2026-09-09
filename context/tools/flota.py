#!/usr/bin/env python3
"""flota.py — el REPARTO de la auditoría: qué le toca revisar a cada agente, y nada más.

POR QUÉ EXISTE, con el número que lo justifica. El árbol tiene tres instrumentos de envejecimiento y
los tres arrancan de la DERIVA: `oracle.py` (rutas que ya no existen), `alinear.py` (archivos tocados
después del sello) y `diff.py` (qué cambió en uno). Eso tiene un techo, y quedó medido el 2026-09-08
auditando el corpus hermano (canon, en el playground compartido): de **178 hallazgos**, sus 480 citas
de evidencia caen en un archivo que la deriva había marcado sólo **44 veces — el 9 %**.

O sea que **el 91 % de lo que estaba mal vivía en archivos que nunca se movieron**: prosa que era falsa
desde el día en que se escribió, o que envejeció por un cambio en OTRO archivo. Ninguno de los tres
instrumentos iba a llegar ahí nunca, porque los tres esperan que algo se mueva.

La auditoría que no espera la deriva es leer una afirmación y preguntarle al código si es cierta HOY.
Eso **necesita un modelo** y por eso es cara. Lo que hace este comando es la otra mitad, la determinista
y gratis: **armar los paquetes**. Cada paquete es lo que un agente necesita para revisar un pedazo del
árbol —las secciones, los archivos que el nodo declara, si derivaron, y los síntomas por los que entra—
y nada más.

TRES COSAS QUE EL REPARTO GARANTIZA Y LA MANO NO. Las tres salieron de hacerlo a mano una vez:

  1. **Cada sección cae en EXACTAMENTE un paquete.** Una auditoría que se salteó cuatro secciones no se
     distingue de una que las revisó y no encontró nada.
  2. **El reparto es PAREJO**, no tajadas con un resto: 17 secciones salen 6+6+5 y no 8+8+1, que deja un
     agente entero para una sección sola, sin vecinas con las que contrastar.
  3. **Es DETERMINISTA**: dos corridas dan los mismos bytes, y por eso la segunda puede decir «estos
     nueve son nuevos» en vez de volver a leer todo.

⚠ ESTO NO CORRE LA AUDITORÍA. No vive ningún modelo acá: reparte. La receta —qué se le pregunta a cada
agente, el pase adversarial que va detrás y las dos formas en que ya falló— está en `CLAUDE.md`.

USO
    python3 tools/flota.py                 → el resumen: cuántos paquetes y qué lleva cada uno
    python3 tools/flota.py json            → los paquetes, para lanzarlos
    python3 tools/flota.py --comprobar     → verifica las tres garantías de arriba y sale
"""
import json
import pathlib
import re
import sys
import unicodedata

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import roots  # noqa: E402

RAIZ = pathlib.Path(__file__).resolve().parent.parent
FLOWS = RAIZ / "server" / "data" / "flows"

# Cuántas secciones lleva un paquete. Ocho es lo que se usó a mano el 2026-09-07 sobre el corpus
# hermano (36 paquetes, 280 secciones): con más, el agente resume en vez de citar.
SECCIONES_POR_PAQUETE = 8


def ancla(titulo: str) -> str:
    """El mismo normalizador que usa el árbol para los enlaces: minúsculas, sin acentos, no alfanumérico a `-`."""
    t = unicodedata.normalize("NFD", titulo.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def deriva_por_nodo() -> tuple[dict, str]:
    """Lo que `alinear.py` ya calculó, si está. Devuelve también CUÁNDO se calculó: un dato de deriva de
    hace dos semanas no es falso, es viejo, y el agente tiene derecho a saberlo."""
    p = RAIZ / "alineacion.json"
    if not p.exists():
        return {}, ""
    d = json.loads(p.read_text())
    return {n["id"]: n for n in d.get("nodos", [])}, d.get("generado", "")


def secciones_de(doc: pathlib.Path) -> list[dict]:
    """Las secciones de un `doc.md`: su título, su ancla y cuántas palabras tiene. Un `##` que no
    empieza la línea no es un encabezado — y eso ya rompió prosa dos veces en el corpus hermano."""
    if not doc.exists():
        return []
    out, titulo, cuerpo = [], None, []

    def cerrar():
        if titulo is not None:
            out.append({"titulo": titulo, "ancla": ancla(titulo), "palabras": len(" ".join(cuerpo).split())})

    for linea in doc.read_text(encoding="utf-8").splitlines():
        if linea.startswith("## "):
            cerrar()
            titulo, cuerpo = linea[3:].strip(), []
        elif titulo is not None:
            cuerpo.append(linea)
    cerrar()
    return out


def archivos_de(mapa: dict, nodo_deriva: dict) -> list[dict]:
    """Los archivos que el nodo declara, con su repo resuelto y si derivaron. El prefijo del `files[]`
    es el nombre del ROOT (`application/…`, `legacy-backend/…`), no una ruta del disco: se resuelve
    igual que en el oráculo, por `roots.ROOTS`."""
    derivados = set((nodo_deriva.get("deriva") or {}).get("archivos") or [])
    muertas = set(nodo_deriva.get("rutas_muertas") or [])
    out = []
    for entrada in mapa.get("files") or []:
        repo, _, ruta = entrada.partition("/")
        item = {"repo": repo, "ruta": ruta, "declarado_como": entrada}
        if repo not in roots.ROOTS:
            item["aviso"] = "el prefijo no es un root conocido: no se puede resolver"
        if entrada in derivados:
            item["derivo"] = True
        if entrada in muertas:
            item["ruta_muerta"] = True
        out.append(item)
    return out


def paquetes() -> list[dict]:
    """La lista completa, ordenada y determinista."""
    deriva, _ = deriva_por_nodo()
    out = []
    for carpeta in sorted(p for p in FLOWS.iterdir() if p.is_dir()):
        mp = carpeta / "map.json"
        if not mp.exists():
            continue
        mapa = json.loads(mp.read_text())
        secs = secciones_de(carpeta / "doc.md")
        if not secs:
            continue
        nd = deriva.get(carpeta.name, {})
        archivos = archivos_de(mapa, nd)

        # El reparto PAREJO: ceil para la cantidad de partes, y el resto se distribuye de a uno.
        partes = (len(secs) + SECCIONES_POR_PAQUETE - 1) // SECCIONES_POR_PAQUETE
        base, resto, desde = divmod(len(secs), partes)[0], len(secs) % partes, 0
        for i in range(partes):
            cuantas = base + (1 if i < resto else 0)
            out.append({
                "nodo": carpeta.name,
                "nombre": mapa.get("name") or carpeta.name,
                "kind": mapa.get("kind"),
                "verificado": (mapa.get("verified") or {}).get("date") if isinstance(mapa.get("verified"), dict) else None,
                "parte": i + 1,
                "de": partes,
                "secciones": secs[desde:desde + cuantas],
                # Los síntomas por los que se entra a este nodo: es la forma en que llegan las preguntas
                # de verdad, así que el agente los necesita para juzgar si la prosa contesta lo que se
                # le pregunta — no sólo si es cierta.
                "sintomas": mapa.get("sintomas") or [],
                "cuando_se_usa": mapa.get("when") or "",
                "archivos": archivos,
            })
            desde += cuantas
    return out


def comprobar() -> int:
    """Las tres garantías, verificadas sobre el árbol real. Sin marco de pruebas porque no hay ninguno
    en este repo: el comando se comprueba solo."""
    ps = paquetes()
    fallas = []

    vistas = {}
    for p in ps:
        for s in p["secciones"]:
            vistas[p["nodo"] + "#" + s["ancla"]] = vistas.get(p["nodo"] + "#" + s["ancla"], 0) + 1
    repetidas = [k for k, v in vistas.items() if v != 1]
    if repetidas:
        fallas.append(f"secciones en más de un paquete: {repetidas[:3]}")

    esperadas = 0
    for carpeta in sorted(p for p in FLOWS.iterdir() if p.is_dir()):
        esperadas += len(secciones_de(carpeta / "doc.md"))
    if len(vistas) != esperadas:
        fallas.append(f"se repartieron {len(vistas)} secciones y el árbol tiene {esperadas}")

    por_nodo = {}
    for p in ps:
        por_nodo.setdefault(p["nodo"], []).append(len(p["secciones"]))
    for nodo, tam in por_nodo.items():
        if max(tam) > SECCIONES_POR_PAQUETE:
            fallas.append(f"{nodo}: un paquete de {max(tam)} y el techo es {SECCIONES_POR_PAQUETE}")
        if max(tam) - min(tam) > 1:
            fallas.append(f"{nodo}: reparto desparejo {tam}")

    if json.dumps(paquetes()) != json.dumps(ps):
        fallas.append("dos corridas dieron paquetes distintos: no se pueden comparar dos auditorías")

    if fallas:
        for f in fallas:
            print("  ✗", f)
        return 1
    print(f"  ✓ {len(ps)} paquetes · {len(vistas)} secciones, cada una en exactamente uno · reparto parejo · determinista")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if "--comprobar" in args:
        return comprobar()
    ps = paquetes()
    if "json" in args:
        print(json.dumps(ps, ensure_ascii=False, indent=1))
        return 0

    _, cuando = deriva_por_nodo()
    secciones = sum(len(p["secciones"]) for p in ps)
    archivos = sum(len(p["archivos"]) for p in ps)
    derivados = sum(1 for p in ps for a in p["archivos"] if a.get("derivo"))
    muertas = sum(1 for p in ps for a in p["archivos"] if a.get("ruta_muerta"))
    sin_sintomas = sum(1 for p in ps if not p["sintomas"])

    print(f"\n  LOS PAQUETES DE LA AUDITORÍA ({len(ps)})")
    print("  cada uno es lo que un agente necesita para revisar un pedazo del árbol: las secciones, los")
    print("  archivos que el nodo declara, si derivaron, y los síntomas por los que se entra. Con `json` sale la lista.\n")
    for p in ps:
        linea = f"  {p['nodo']:26s} {p['parte']}/{p['de']} · {len(p['secciones']):2d} sección(es) · {len(p['archivos']):3d} archivo(s)"
        d = sum(1 for a in p["archivos"] if a.get("derivo"))
        if d:
            linea += f" ({d} derivados)"
        if not p["sintomas"]:
            linea += " · sin síntomas declarados"
        print(linea)
    print(f"\n  {secciones} secciones repartidas · {archivos} archivos declarados", end="")
    if cuando:
        print(f" · {derivados} derivados y {muertas} ruta(s) muerta(s), según la alineación del {cuando}")
        print("  ⚠ Esa alineación es de esa fecha: para deriva fresca, `python3 tools/alinear.py` antes.")
    else:
        print(" · sin `alineacion.json`: no se dice qué derivó (corré `alinear.py`)")
    print(f"  {sin_sintomas} nodo(s) sin síntomas declarados: por ahí no entra ninguna pregunta de soporte\n")
    print("  ⚠ Esto NO corre la auditoría: arma los paquetes. La receta —qué preguntarle a cada agente,")
    print("    el pase adversarial y las dos formas en que ya falló— está en CLAUDE.md.")
    print("  ⚠ Y antes de correrla: `git fetch` en los clones. De 178 hallazgos del corpus hermano, los 2")
    print("    que se cayeron fue por leer un clon viejo — y en uno la prosa que ya estaba era la correcta.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
