"""Lee Confluence desde la terminal. SOLO LECTURA — no hay ningún verbo que escriba.

Existe porque la documentación de negocio (política de riesgo, contratos con lenders, PRDs) no está
en el código y el árbol no la puede indexar: vive en Confluence. Esto la baja a texto para poder
contrastarla contra el código, que es el único protocolo que la deja entrar al árbol.

    python3 tools/confluence.py espacios
    python3 tools/confluence.py paginas Creditop
    python3 tools/confluence.py leer 143786000
    python3 tools/confluence.py buscar "cupo rotativo"

Credenciales en `context/.env` (gitignoreado): CONFLUENCE_URL · CONFLUENCE_EMAIL · CONFLUENCE_TOKEN.

⚠ Lo que sale de acá NO es verdad todavía. Un documento desactualizado es indistinguible de uno
equivocado, así que toda afirmación se marca `confirmada` (el código coincide) / `contradicha` (difieren
— las más valiosas) / `no verificable` (política pura), y sólo las dos primeras entran a un nodo.
"""
import base64
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def credenciales():
    env = os.path.join(RAIZ, ".env")
    vals = dict(os.environ)
    if os.path.exists(env):
        with open(env, encoding="utf-8") as fh:
            for linea in fh:
                linea = linea.strip()
                if not linea or linea.startswith("#") or "=" not in linea:
                    continue
                k, v = linea.split("=", 1)
                vals.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    faltan = [k for k in ("CONFLUENCE_URL", "CONFLUENCE_EMAIL", "CONFLUENCE_TOKEN") if not vals.get(k)]
    if faltan:
        sys.exit(f"faltan en context/.env: {', '.join(faltan)}")
    return vals["CONFLUENCE_URL"].rstrip("/"), vals["CONFLUENCE_EMAIL"], vals["CONFLUENCE_TOKEN"]


def get(ruta, params=None):
    base, email, token = credenciales()
    url = base + ruta + ("?" + urllib.parse.urlencode(params) if params else "")
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        cuerpo = e.read()[:300].decode("utf-8", "replace")
        # ⚠ Atlassian NO contesta 401 cuando la credencial no sirve: en `/wiki` devuelve 403 y en la
        # API v2 devuelve **404**. Leído tal cual, un 404 en `/wiki/api/v2/spaces` se diagnostica como
        # ruta mal armada o espacio inexistente — y son tres pasos hasta descubrir que el token venció.
        # El que sí dice la verdad es el endpoint de Jira: 401 «Client must be authenticated».
        if e.code in (401, 403, 404):
            base, email, _ = credenciales()
            req = urllib.request.Request(
                base + "/rest/api/3/myself",
                headers={"Authorization": req.headers["Authorization"], "Accept": "application/json"},
            )
            try:
                urllib.request.urlopen(req, timeout=30).read()
            except urllib.error.HTTPError as sonda:
                if sonda.code == 401:
                    sys.exit(
                        f"HTTP {e.code} en {ruta}, pero la causa es la CREDENCIAL: "
                        f"{base}/rest/api/3/myself devuelve 401.\n"
                        f"El token de {email} venció o fue revocado. Generá uno nuevo en\n"
                        f"  https://id.atlassian.com/manage-profile/security/api-tokens\n"
                        f"y actualizá CONFLUENCE_TOKEN en context/.env (gitignoreado)."
                    )
            except Exception:
                pass  # la sonda es un extra: si falla, seguimos con el error original
        sys.exit(f"HTTP {e.code} en {ruta}: {cuerpo}")


# ── storage format (XHTML de Confluence) → texto plano legible ───────────────────────────────────
def a_texto(xhtml):
    t = xhtml or ""
    # macros que traen código o texto suelto
    t = re.sub(r'<ac:structured-macro[^>]*ac:name="code".*?<!\[CDATA\[(.*?)\]\]>.*?</ac:structured-macro>',
               r"\n```\n\1\n```\n", t, flags=re.S)
    t = re.sub(r"<ac:parameter[^>]*>.*?</ac:parameter>", "", t, flags=re.S)
    t = re.sub(r"<ri:page[^>]*ri:content-title=\"([^\"]*)\"[^>]*/?>", r"[[\1]]", t)
    t = re.sub(r"<ri:(user|attachment|url)[^>]*/?>", "", t)
    t = re.sub(r"</?ac:(link|inline-comment-marker|placeholder|adf-[a-z-]+)[^>]*>", "", t)
    t = re.sub(r"<ac:structured-macro[^>]*ac:name=\"([a-z-]+)\"[^>]*/>", r"«macro \1»", t)
    t = re.sub(r"</?ac:[a-z-]+[^>]*>", "", t)

    t = re.sub(r"<h1[^>]*>", "\n\n# ", t)
    t = re.sub(r"<h2[^>]*>", "\n\n## ", t)
    t = re.sub(r"<h3[^>]*>", "\n\n### ", t)
    t = re.sub(r"<h[4-6][^>]*>", "\n\n#### ", t)
    t = re.sub(r"</h[1-6]>", "\n", t)
    t = re.sub(r"<li[^>]*>", "\n- ", t)
    t = re.sub(r"</(p|div|tr|li|ul|ol|table)>", "\n", t)
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"</t[hd]>", " | ", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def cmd_espacios():
    d = get("/wiki/api/v2/spaces", {"limit": 250})
    for s in sorted(d.get("results", []), key=lambda s: s.get("key", "")):
        if s.get("key", "").startswith("~"):
            continue  # espacios personales
        print(f"{s['id']:<12} {s.get('key',''):<16} {s.get('name','')}")


def cmd_paginas(clave):
    d = get("/wiki/api/v2/spaces", {"keys": clave})
    if not d.get("results"):
        sys.exit(f"no existe el espacio {clave}")
    sid = d["results"][0]["id"]
    cursor, total = None, 0
    while True:
        p = {"limit": 250}
        if cursor:
            p["cursor"] = cursor
        d = get(f"/wiki/api/v2/spaces/{sid}/pages", p)
        for pg in d.get("results", []):
            print(f"{pg['id']:<12} {pg['title']}")
            total += 1
        nxt = (d.get("_links") or {}).get("next")
        if not nxt:
            break
        q = urllib.parse.parse_qs(urllib.parse.urlparse(nxt).query)
        cursor = q.get("cursor", [None])[0]
        if not cursor:
            break
    print(f"\n— {total} páginas en {clave}", file=sys.stderr)


def cmd_leer(pid):
    d = get(f"/wiki/api/v2/pages/{pid}", {"body-format": "storage"})
    ver = d.get("version") or {}
    print(f"# {d.get('title','')}")
    print(f"<!-- id {pid} · v{ver.get('number','?')} · {ver.get('createdAt','?')} -->\n")
    print(a_texto(((d.get("body") or {}).get("storage") or {}).get("value", "")))


def cmd_buscar(texto):
    cql = f'text ~ "{texto}" and type = page'
    d = get("/wiki/rest/api/search", {"cql": cql, "limit": 40})
    for r in d.get("results", []):
        c = r.get("content") or {}
        esp = ((r.get("resultGlobalContainer") or {}).get("title")) or ""
        print(f"{c.get('id',''):<12} {esp:<20} {r.get('title','')}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "espacios":
        cmd_espacios()
    elif cmd == "paginas" and args:
        cmd_paginas(args[0])
    elif cmd == "leer" and args:
        cmd_leer(args[0])
    elif cmd == "buscar" and args:
        cmd_buscar(" ".join(args))
    else:
        sys.exit(__doc__)
