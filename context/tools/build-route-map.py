#!/usr/bin/env python3
"""Genera ROUTE-MAP.md: el índice estático que reemplaza al brief del MCP.
Un LLM lee este archivo, elige nodos por su 'Cuándo', y abre flows/<id>/{doc.md,map.json}
para leer los archivos fuente directamente. Regenerar: python3 tools/build-route-map.py"""
import json, os, glob
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLOWS=os.path.join(ROOT,"server","data","flows")
tree=json.load(open(os.path.join(ROOT,"tree.json")))["combinations"]
byid={c["id"]:c for c in tree}
kids={}
for c in tree: kids.setdefault(c.get("parent"),[]).append(c["id"])
def mapof(i):
    p=os.path.join(FLOWS,i,"map.json")
    return json.load(open(p)) if os.path.exists(p) else {}
# alias→root (de la config del scanner, embebido para portabilidad)
ALIAS={"application":"~/Desktop/CREDITOP/github/legacy-application","frontend-monorepo":"~/Desktop/CREDITOP/github/frontend-monorepo","legacy-backend":"~/Desktop/CREDITOP/github/legacy-backend","pre-approvals-service":"~/Desktop/CREDITOP/github/pre-approvals-service","backend-e2e":"~/Desktop/CREDITOP/playground/backend-e2e","frontend-e2e":"~/Desktop/CREDITOP/playground/frontend-e2e"}
out=[]
out.append("# CreditOp — Mapa de rutas de contexto\n")
out.append("> Índice estático del árbol de contexto (reemplaza al MCP). **Cómo usar:** leé los `Cuándo:` de abajo, elegí 2–4 nodos que matcheen tu tarea, abrí `server/data/flows/<id>/doc.md` (el análisis) y `server/data/flows/<id>/map.json` (la lista de archivos fuente), y de ahí leé el código real. Las rutas de `map.json` son `alias/relpath`.\n")
out.append("**Repos (alias → root):** "+" · ".join(f"`{a}`→`{r}`" for a,r in ALIAS.items())+"\n")
out.append("**Mantenimiento:** validar que las rutas resuelven → `python3 tools/oracle.py <map.json>`. Regenerar este mapa → `python3 tools/build-route-map.py`.\n")
# árbol
out.append("## Árbol\n```")
def render(i,d):
    m=mapof(i); k=m.get("kind","")
    tag=" [task]" if k=="task" else (" [ref]" if k=="reference" else "")
    out.append("  "*d+f"- {i}{tag}")
    for ch in sorted(kids.get(i,[])): render(ch,d+1)
roots=[c["id"] for c in tree if not c.get("parent")]
for r in sorted(roots): render(r,0)
out.append("```\n")
# nodos (contextos primero, luego tasks), alfabético
def role(i):
    k=mapof(i).get("kind","")
    return {"root":0,"reference":1}.get(k,1) if k!="task" else 2
nodes=sorted(byid, key=lambda i:(role(i), i))
out.append("## Nodos\n")
for i in nodes:
    m=mapof(i); nm=m.get("name",i); k=m.get("kind","contexto"); nf=len(m.get("files",[]))
    par=byid[i].get("parent"); ctx=byid[i].get("contexts")
    out.append(f"### {i} — {nm}  ·  _{k}_ · {nf} archivos")
    if m.get("when"): out.append(f"**Cuándo:** {m['when']}")
    line=f"Doc: `server/data/flows/{i}/doc.md` · Archivos: `server/data/flows/{i}/map.json`"
    if par: line+=f" · Padre: `{par}`"
    if ctx: line+=f" · Usa: {', '.join('`'+x+'`' for x in ctx)}"
    out.append(line+"\n")
open(os.path.join(ROOT,"docs","ROUTE-MAP.md"),"w").write("\n".join(out))
print(f"docs/ROUTE-MAP.md: {len(nodes)} nodos, {os.path.getsize(os.path.join(ROOT,'docs','ROUTE-MAP.md'))} bytes")
