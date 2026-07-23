#!/usr/bin/env python3
"""Indexador de rutas (reemplaza al scanner Go). Camina los repos y lista los
archivos fuente como `alias/relpath` en tools/index.txt — la base del oráculo.
Regenerar tras cambios en los repos: python3 tools/build-index.py"""
import os
ROOT_DIR=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOTS={
 "application":os.path.expanduser("~/Desktop/CREDITOP/github/legacy-application"),
 "frontend-monorepo":os.path.expanduser("~/Desktop/CREDITOP/github/frontend-monorepo"),
 "legacy-backend":os.path.expanduser("~/Desktop/CREDITOP/github/legacy-backend"),
 "pre-approvals-service":os.path.expanduser("~/Desktop/CREDITOP/github/pre-approvals-service"),
 "form-service":os.path.expanduser("~/Desktop/CREDITOP/github/form-service"),
 "frontend-e2e":os.path.expanduser("~/Desktop/CREDITOP/playground/frontend-e2e"),
}
EXTS={".php",".go",".ts",".tsx",".js",".jsx",".mjs",".cjs",".vue"}
EXCLUDE={"node_modules","vendor",".git",".next","coverage",".turbo",".idea",".vscode"}
lines=[]
for alias,root in ROOTS.items():
    if not os.path.isdir(root): print(f"⚠ root ausente: {alias} {root}"); continue
    n=0
    for dp,dns,fns in os.walk(root):
        dns[:]=[d for d in dns if d not in EXCLUDE]
        for f in fns:
            if os.path.splitext(f)[1] in EXTS:
                lines.append(f"{alias}/{os.path.relpath(os.path.join(dp,f),root)}"); n+=1
    print(f"{alias}: {n}")
lines=sorted(set(lines))
open(os.path.join(ROOT_DIR,"tools","index.txt"),"w").write("\n".join(lines)+"\n")
print("total:",len(lines))
