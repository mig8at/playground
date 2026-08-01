#!/usr/bin/env python3
"""Indexador de rutas (reemplaza al scanner Go). Camina los repos y lista los
archivos fuente como `alias/relpath` en tools/index.txt — la base del oráculo.
Regenerar tras cambios en los repos: python3 tools/build-index.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from roots import ROOTS, EXTS, EXCLUDE   # fuente única, compartida con oracle.py
ROOT_DIR=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
