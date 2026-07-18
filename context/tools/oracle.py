#!/usr/bin/env python3
"""Central oracle validator. Usage: oracle.py <files.json>  (or reads map.json 'files').
Prints kept/dropped. Splits 'alias/relpath' against index (repo,path) set."""
import json,sys
IDX="/Users/miguelochoa/.creditop-context/index.json"
ALIASES=["application","frontend-monorepo","legacy-backend","pre-approvals-service","backend-e2e","frontend-e2e"]
idx=json.load(open(IDX))
have=set((n["repo"],n["path"]) for n in idx["nodes"])
def split(entry):
    for a in ALIASES:
        if entry.startswith(a+"/"):
            return a, entry[len(a)+1:]
    return None,None
def check(files):
    kept,dropped=[],[]
    for f in files:
        a,p=split(f)
        if a and (a,p) in have: kept.append(f)
        else: dropped.append(f)
    return kept,dropped
if __name__=="__main__":
    data=json.load(open(sys.argv[1]))
    files=data if isinstance(data,list) else data.get("files",[])
    k,d=check(files)
    print(f"KEPT {len(k)} / DROPPED {len(d)} (of {len(files)})")
    for x in d: print("  DROP:",x)
