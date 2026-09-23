#!/bin/bash
# ab-py.sh <worktree-viejo> — corre cada herramienta Python del tablero con el código viejo y el nuevo,
# uno tras otro, y compara la salida. Las rutas del worktree se normalizan: son lo único que difiere.
OLD=${1:?uso: ab-py.sh <worktree-viejo>  (git worktree add --detach <dir> <commit>; y enlazá su tablero/.runs al real)}; NEW=$(cd "$(dirname "$0")/../../.." && pwd); T=${AB_TMP:-/tmp/tablero-ab-py}; mkdir -p $T
fail=0
run() { # run <nombre> <cmd relativo a la raíz…>
  local name=$1; shift
  o=$(cd "$OLD" && "$@" 2>&1; echo "exit=$?"); o=${o//$OLD/<RAIZ>}
  n=$(cd "$NEW" && "$@" 2>&1; echo "exit=$?"); n=${n//$NEW/<RAIZ>}
  o=${o//$T\/old/<OUT>}; n=${n//$T\/new/<OUT>}
  # lo que cambia en cada corrida aunque el código sea el mismo: la hora y el nombre de un reporte nuevo
  o=$(echo "$o" | sed -E 's/[0-9]{8}T[0-9]{6}-[0-9a-f]{8}/<REPORTE>/g; s/"generado": "[^"]+"/"generado": "<HORA>"/'); n=$(echo "$n" | sed -E 's/[0-9]{8}T[0-9]{6}-[0-9a-f]{8}/<REPORTE>/g; s/"generado": "[^"]+"/"generado": "<HORA>"/')
  if [ "$o" == "$n" ]; then echo "  = $name (${#n} B)"; else echo "  ✗ $name"; diff <(echo "$o") <(echo "$n") | head -8; fail=1; fi
}
run "trampas" python3 tablero/tools/trampas.py
run "trampas --indice" python3 tablero/tools/trampas.py --indice
run "citas trampas/doc.md" python3 tablero/tools/citas.py tablero/data/trampas/doc.md
run "citas trampas/doc.md --ok" python3 tablero/tools/citas.py tablero/data/trampas/doc.md --ok
run "citas kyc (tarea)" python3 tablero/tools/citas.py tablero/data/kyc-segundo-apellido-no-coincide.md
run "citas 2 docs" python3 tablero/tools/citas.py tablero/data/agente-soporte-modificacion-datos.md tablero/data/context.md
run "jev --help" python3 tablero/tools/jev.py --help
run "jev stats" python3 tablero/tools/jev.py stats
run "jev bench (preview)" python3 tablero/tools/jev.py bench
# ramas.py escribe un snapshot: a un archivo propio de cada lado, y se comparan también los archivos
o=$(cd "$OLD" && python3 tablero/tools/ramas.py --json --output $T/old.json 2>&1); n=$(cd "$NEW" && python3 tablero/tools/ramas.py --json --output $T/new.json 2>&1)
o=${o//$T\/old/<OUT>}; n=${n//$T\/new/<OUT>}; o=${o//$OLD/<RAIZ>}; n=${n//$NEW/<RAIZ>}
o=$(echo "$o" | sed -E 's/"generado": "[^"]+"/"generado": "<HORA>"/'); n=$(echo "$n" | sed -E 's/"generado": "[^"]+"/"generado": "<HORA>"/')
if [ "$o" == "$n" ]; then echo "  = ramas --json (${#n} B)"; else echo "  ✗ ramas --json"; diff <(echo "$o") <(echo "$n") | head -8; fail=1; fi
if python3 - "$T/old.json" "$T/new.json" <<'PY'
import json,sys
a,b=(json.load(open(p)) for p in sys.argv[1:])
for d in (a,b): d.pop('generated',None); d.pop('generado',None)
sys.exit(0 if a==b else 1)
PY
then echo "  = ramas snapshot (sin la hora)"; else echo "  ✗ ramas snapshot"; fail=1; fi
exit $fail
