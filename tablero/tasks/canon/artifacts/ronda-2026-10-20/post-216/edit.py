import json, re, sys, unicodedata
root = sys.argv[1]
def rd(p): return open(f"{root}/{p}", encoding="utf-8").read()
def wr(p, s): open(f"{root}/{p}", "w", encoding="utf-8").write(s)
def jload(p): return json.loads(rd(p))
def jdump(p, o): wr(p, json.dumps(o, ensure_ascii=False, indent=2) + "\n")

def rename(topic, node_file, old_title, new_title, old_slug, new_slug, new_body=None):
    md = rd(f"{topic}/{node_file}")
    assert f"## {old_title}\n" in md
    if new_body is None:
        md = md.replace(f"## {old_title}\n", f"## {new_title}\n")
    else:
        start = md.index(f"## {old_title}\n")
        nxt = md.find("\n## ", start + 3)
        end = len(md) if nxt == -1 else nxt + 1
        md = md[:start] + f"## {new_title}\n\n" + new_body.strip() + "\n\n" + md[end:]
    wr(f"{topic}/{node_file}", md)
    s = rd(f"{topic}/map.json")
    m = json.loads(s)
    for a in m["areas"]:
        if "secciones" in a: a["secciones"] = [new_slug if x == old_slug else x for x in a["secciones"]]
    # mapa de ids estables: busco el dict que tiene old_slug como clave
    def walk(o):
        if isinstance(o, dict):
            if old_slug in o and isinstance(o[old_slug], dict) and "id" in o[old_slug]:
                ent = o.pop(old_slug)
                ent.setdefault("aliases", [])
                if old_slug not in ent["aliases"] and old_slug != new_slug:
                    ent["aliases"].append(old_slug)
                # conservar el orden: reconstruyo
                o[new_slug] = ent
                return True
            return any(walk(v) for v in o.values())
        if isinstance(o, list): return any(walk(v) for v in o)
        return False
    assert walk(m), "sin mapa de ids"
    jdump(f"{topic}/map.json", m)

# 1. documentos: sacar lender_77 de payment_schedule_notes y renombrar CrediPullman
m = jload("documentos/map.json")
for a in m["areas"]:
    lb = a.get("fuentes", {}).get("legacy-backend", {})
    lb.pop("resources/views/creditopxpdf/lenders/payment_schedule_notes/lender_77.blade.php", None)
jdump("documentos/map.json", m)
body = open(sys.argv[2], encoding="utf-8").read()
rename("documentos", "context.md",
  "CrediPullman promete en sus documentos condonar la última cuota, y ningún proceso de cartera la condona",
  "Los documentos de CrediPullman ya no prometen condonar la última cuota, y ningún proceso de cartera la condona",
  "credipullman-promete-en-sus-documentos-condonar-la-ultima-cuota-y-ningun-proceso-de-cartera-la-condona",
  "los-documentos-de-credipullman-ya-no-prometen-condonar-la-ultima-cuota-y-ningun-proceso-de-cartera-la-condona",
  body)

# 2. backoffice: reapuntar ActivityTab
m = jload("backoffice/map.json")
for a in m["areas"]:
    fm = a.get("fuentes", {}).get("frontend-monorepo", {})
    if "modules/backoffice/lender-rules/src/components/activity/ActivityTab.tsx" in fm:
        fm.pop("modules/backoffice/lender-rules/src/components/activity/ActivityTab.tsx")
        fm["modules/backoffice/shared/src/components/audit/ActivityTab.tsx"] = sys.argv[3]
jdump("backoffice/map.json", m)

# 3. repos: sacar user_request.sql y el objetivo
m = jload("repos/map.json")
for a in m["areas"]:
    ma = a.get("fuentes", {}).get("merchant-api", {})
    if ma.pop("internal/modules/merchant/infra/storage/mysql/queries/user_request.sql", None):
        a["objetivo"] = "Leer el catálogo de comercios e industrias desde la base MySQL heredada."
jdump("repos/map.json", m)

# 4. observabilidad
rename("observabilidad", "operar.md", "Los prefijos de módulo en uso hoy", "Los prefijos de módulo en uso",
  "los-prefijos-de-modulo-en-uso-hoy", "los-prefijos-de-modulo-en-uso")
m = jload("repos/map.json")
for a in m["areas"]:
    if a.get("objetivo") == "Leer el catálogo de comercios e industrias desde la base MySQL heredada.":
        old = a["se_deduce_leyendo"]
        a["se_deduce_leyendo"] = old.replace("sucursales, entidades por sucursal y solicitudes;", "sucursales y entidades por sucursal;")
        assert a["se_deduce_leyendo"] != old
jdump("repos/map.json", m)
m = jload("documentos/map.json")
for a in m["areas"]:
    if a["id"] == "area-2ccd2a6a85f8":
        a["objetivo"] = "Qué beneficio de última cuota de CrediPullman se retiró de los documentos y por qué la cartera no lo ejecuta en los créditos que lo firmaron."
        a["se_deduce_leyendo"] = "que el pagaré de la entidad ya no imprime la cláusula y que la condonación de saldos de cartera es manual, sin regla que la aplique sola"
jdump("documentos/map.json", m)
