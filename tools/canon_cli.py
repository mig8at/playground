#!/usr/bin/env python3
"""canon_cli.py — leer y escribir canon desde la consola, en un comando.

    buscar "<palabras del negocio>"      qué sección y qué área lo cubren (gratis, sin modelo)
    leer <id>[,<id>…]                    secciones completas: `cuota/context#<ancla>` o el tema entero
    codigo <tema/capa> [n]               los archivos que declara el área n del tema
    ensayar <pieza.json>                 /api/propose: dónde iría, qué rechaza el lint. NO escribe
    dictar <pieza.json>… [--titulo T]    borrador → piezas → cierre: UNA revisión. ESCRIBE

El origen es `CANON_URL` (por defecto canon de producción, que pide la VPN de prod), el mismo que usan
el tablero y `tools/canon.py`. La llave de escritura sale de `CANON_WRITE_KEY` o del `.env` de
`tools/canon` en el repo compartido, y no se imprime nunca.

La pieza es un JSON con los campos del borrador; `text_file` en vez de `text` lee la prosa de un
archivo. El formato y las reglas de qué entra: `.claude/skills/canon/SKILL.md`.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import canon  # noqa: E402

URL = canon.URL
ENV_CANON = os.path.expanduser("~/Desktop/CREDITOP/github/playground/tools/canon/.env")


def llave():
    if os.environ.get("CANON_WRITE_KEY"):
        return os.environ["CANON_WRITE_KEY"]
    try:
        with open(ENV_CANON, encoding="utf-8") as fh:
            for linea in fh:
                if linea.startswith("CANON_WRITE_KEY="):
                    return linea.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    sys.exit(f"falta la llave: exportá CANON_WRITE_KEY o poné CANON_WRITE_KEY en {ENV_CANON}")


def pedir(metodo, ruta, cuerpo=None, escribe=False, timeout=90):
    datos = json.dumps(cuerpo, ensure_ascii=False).encode() if cuerpo is not None else None
    req = urllib.request.Request(URL + ruta, data=datos, method=metodo)
    req.add_header("Content-Type", "application/json")
    if escribe:
        req.add_header("Authorization", "Bearer " + llave())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            texto = r.read().decode()
    except urllib.error.HTTPError as e:
        texto = e.read().decode()
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f"canon no respondió en {URL} ({e}). ¿VPN de prod? Con CANON_URL se apunta a otro.")
    try:
        return json.loads(texto)
    except ValueError:
        return {"_texto": texto}


def buscar(q):
    d = pedir("GET", "/api/search?q=" + urllib.parse.quote(q))
    print(f"  prosa ({URL}):")
    for r in (d.get("results") or [])[:6]:
        print(f"    {r.get('node')}#{r.get('anchor')}  ·  {r.get('section_title', '')}")
    print("  mapa (dónde vive en el código):")
    for r in (d.get("in_the_map") or [])[:4]:
        print(f"    {r.get('citar')}  ·  {str(r.get('objetivo') or '')[:110]}")
    if d.get("sin_cubrir"):
        print(f"  ⚠ sin cubrir: {d['sin_cubrir']}")
    print("  → leer:  make canon-leer IDS=<tema/capa#ancla>")


def leer(ids):
    d = pedir("GET", "/api/read?ids=" + urllib.parse.quote(ids, safe=",/") + "&format=md")  # el `#` viaja como %23
    print(d.get("_texto") or json.dumps(d, ensure_ascii=False, indent=1))


def codigo(area, n="0"):
    d = pedir("GET", f"/api/code?area={urllib.parse.quote(area)}&n={n}")
    a = d.get("area") or {}
    print(f"  {area} · área {n}: {a.get('objetivo', '')}")
    for f in d.get("files") or []:
        print(f"    {f.get('repo')}:{f.get('path')}  ({f.get('declared_hash', '')})")


def cargar_pieza(ruta):
    with open(ruta, encoding="utf-8") as fh:
        p = json.load(fh)
    if "text_file" in p:
        base = os.path.dirname(os.path.abspath(ruta))
        with open(os.path.join(base, p.pop("text_file")), encoding="utf-8") as fh:
            p["text"] = fh.read().strip()
    return p


def ensayar(ruta):
    p = cargar_pieza(ruta)
    d = pedir("POST", "/api/propose", {k: p[k] for k in ("text", "node", "kind", "source", "as_asked") if k in p}, escribe=True)
    print(f"  ready: {d.get('ready')}  ·  lint: {d.get('lint') or d.get('problems') or 'sin objeciones'}")
    if d.get("needs_answers"):
        print(f"  le falta: {d['needs_answers']}")
    for w in (d.get("where_it_might_belong") or [])[:3]:
        print(f"    podría ir cerca de: {w.get('read')}")


def dictar(rutas, titulo):
    piezas = [cargar_pieza(r) for r in rutas]
    b = pedir("POST", "/api/draft", {"quien": os.environ.get("CANON_QUIEN", "Miguel Ochoa")}, escribe=True)
    bid = b.get("draft_id") or b.get("id")
    if not bid:
        sys.exit(f"no se pudo abrir el borrador: {b}")
    for p in piezas:
        r = pedir("POST", f"/api/draft/{bid}", p, escribe=True)
        if not r.get("ok"):
            pedir("DELETE", f"/api/draft/{bid}", escribe=True)
            sys.exit(f"✗ la pieza «{p.get('section')}» no entró, y el borrador se abandonó: {json.dumps(r, ensure_ascii=False)[:600]}")
        print(f"  ✓ {p.get('node')} · «{p.get('section')}»: {r.get('operacion')}")
        for aviso in ("objetivo_de_plantilla", "archivos_nota", "tablas_nota", "ya_vigilados_nota"):
            if r.get(aviso):
                print(f"    ⚠ {aviso}: {str(r[aviso])[:220]}")
    c = pedir("POST", f"/api/draft/{bid}/close", {"titulo": titulo}, escribe=True)
    if not c.get("ok"):
        pedir("DELETE", f"/api/draft/{bid}", escribe=True)
        sys.exit(f"✗ el cierre no guardó nada y el borrador se abandonó: {c.get('error')} · {c.get('detalle')}")
    print(f"  ✓ revisión {c.get('revision')} en {URL}")
    if c.get("sin_enlazar"):
        print(f"    ⚠ sin enlazar: {c['sin_enlazar']}")


def main(a):
    if not a or a[0] in ("-h", "--help"):
        print(__doc__)
        return
    cmd, resto = a[0], a[1:]
    if cmd == "buscar" and resto:
        buscar(" ".join(resto))
    elif cmd == "leer" and resto:
        leer(resto[0])
    elif cmd == "codigo" and resto:
        codigo(resto[0], resto[1] if len(resto) > 1 else "0")
    elif cmd == "ensayar" and resto:
        ensayar(resto[0])
    elif cmd == "dictar" and resto:
        titulo = "canon: dictado desde el playground"
        if "--titulo" in resto:
            i = resto.index("--titulo")
            titulo, resto = resto[i + 1], resto[:i] + resto[i + 2:]
        dictar(resto, titulo)
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main(sys.argv[1:])
