#!/bin/bash
OLD=${1:?uso: ab-web-move.sh <worktree-del-commit-anterior>}; P=$(cd "$(dirname "$0")/../../../../.." && pwd); B=${AB_TMP:-/tmp/tablero-ab-move}/bins; S=${AB_TMP:-/tmp/tablero-ab-move}
(cd "$OLD/tablero/server" && WEB_PORT=18787 "$B/old/web" > "$S/web-old.log" 2>&1) & A=$!
(cd "$P/tablero/server" && WEB_PORT=18788 "$B/new/web" > "$S/web-new.log" 2>&1) & N=$!
trap "kill $A $N 2>/dev/null; pkill -f '$B/(old|new)/web' 2>/dev/null" EXIT
for i in $(seq 30); do curl -sf localhost:18787/health >/dev/null && curl -sf localhost:18788/health >/dev/null && break; sleep 0.5; done
for u in /api/config /api/guard /api/settings /api/ramas /api/repos-ramas /api/efforts /api/task-locals \
  "/api/entries?days=30" "/api/entries?effort=47" "/api/task-context?effort=47" "/api/task-context?effort=84" \
  "/api/pulse?days=20" "/api/canon/references?ids=47" /api/sprint "/api/sprints?n=4" "/api/task?key=CORE-420" "/api/jira-inbox"; do
  curl -s "localhost:18787$u" > "$S/o.json"; curl -s "localhost:18788$u" > "$S/n.json"
  python3 - "$u" "$S/o.json" "$S/n.json" <<'PY'
import json,sys
u,o,n=sys.argv[1],open(sys.argv[2]).read(),open(sys.argv[3]).read()
if o==n: print(f'  = {u} ({len(n)} B)'); sys.exit()
try: jo,jn=json.loads(o),json.loads(n)
except Exception: print(f'  ✗ {u} (no es JSON; difiere)'); sys.exit()
def strip(x):  # lo que cambia por diseño en la mudanza
    if isinstance(x,dict): return {k:strip(v) for k,v in x.items() if k not in ('artifacts','file','slug')}
    if isinstance(x,list): return [strip(v) for v in x]
    return x
if strip(jo)==strip(jn):
    def arts(x):
        return {e.get('id'):[a['label'] for a in e.get('artifacts') or []] for e in (x if isinstance(x,list) else x.get('efforts',[])) if isinstance(e,dict)}
    ao,an=arts(jo),arts(jn)
    changed={k:(ao.get(k),an.get(k)) for k in set(ao)|set(an) if ao.get(k)!=an.get(k)}
    print(f'  ≈ {u}: igual salvo artifacts/file/slug' + (f' — artifacts cambiaron en {len(changed)} tareas' if changed else ''))
    for k,(a,b) in sorted(changed.items(), key=lambda kv: str(kv[0])): print(f'      #{k}: {a} → {b}')
else:
    print(f'  ✗ {u}: difiere en algo más que artifacts/file/slug')
PY
done
