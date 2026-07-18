#!/usr/bin/env python3
"""Valida que las rutas de un map.json RESUELVEN contra el índice (tools/index.txt).
Uso: python3 tools/oracle.py <map.json>   (o un .json que sea una lista de rutas)
Si falta el índice: python3 tools/build-index.py"""
import sys,os,json
ROOT_DIR=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDX=os.path.join(ROOT_DIR,"tools","index.txt")
if not os.path.exists(IDX):
    sys.exit("falta tools/index.txt → corré: python3 tools/build-index.py")
have=set(l.strip() for l in open(IDX) if l.strip())
data=json.load(open(sys.argv[1]))
files=data if isinstance(data,list) else data.get("files",[])
kept=[f for f in files if f in have]; dropped=[f for f in files if f not in have]
print(f"KEPT {len(kept)} / DROPPED {len(dropped)} (of {len(files)})")
for x in dropped: print("  DROP:",x)
