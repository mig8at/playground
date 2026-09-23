#!/bin/bash
# ab-move.sh — la mudanza de data/ a tasks/<slug>/: el binario VIEJO corre en un worktree del commit de
# antes (con la forma vieja), el NUEVO en el repo ya mudado; los dos leen la misma bitácora, pulso y
# cachés. Las rutas que cambian por diseño se traducen a la forma vieja antes de comparar.
OLD=${1:?uso: ab-move.sh <worktree-del-commit-anterior>}; P=$(cd "$(dirname "$0")/../../../../.." && pwd); B=${AB_TMP:-/tmp/tablero-ab-move}/bins
rm -rf "$B"; mkdir -p "$B/old" "$B/new"
for c in tasks today closeout task-context web; do
  (cd "$OLD/tablero/server" && go build -o "$B/old/$c" ./cmd/$c) || exit 1
  (cd "$P/tablero/server" && go build -o "$B/new/$c" ./cmd/$c) || exit 1
done
# forma nueva → vieja, para que una ruta que cambió por diseño no cuente como diferencia
norm() { sed -E 's#(\.\./)?tasks/([a-z0-9-]+)/task\.md#\1data/\2.md#g; s#tasks/([a-z0-9-]+)/context\.jsonl#data/task-context/\1.jsonl#g; s#"id": "ctx_[^"]+"#"id": "<ID>"#; s#"at": "[^"]+"#"at": "<AT>"#'; }
fail=0
while IFS='|' read -r c oldargs newargs; do
  [ -z "$c" ] && continue
  [ -z "$newargs" ] && newargs=$oldargs
  o=$(cd "$OLD/tablero/server" && eval "$B/old/$c $oldargs" 2>&1; echo "exit=$?")
  n=$(cd "$P/tablero/server" && eval "$B/new/$c $newargs" 2>&1; echo "exit=$?")
  o=$(echo "$o" | sed "s#$OLD#<RAIZ>#g"); n=$(echo "$n" | sed "s#$P#<RAIZ>#g" | norm)
  if [ "$o" == "$n" ]; then echo "  = $c $newargs"; else echo "  ✗ $c $newargs"; diff <(echo "$o") <(echo "$n") | head -10; fail=1; fi
done <<'LIST'
tasks|
tasks|-todas
tasks|-todas -json
tasks|-stage work -todas
tasks|-n 47
tasks|-n 47 -json
tasks|-n 47 -json -contenido
tasks|-n tablero -json
tasks|-n kyc-segundo
tasks|-sprint
tasks|-sprint -json
tasks|-bitacora 30
tasks|-bitacora 30 -json
tasks|-lint ../data/tablero.md|-lint ../tasks/tablero/task.md
tasks|-lint ../data/cuadrilla.md|-lint ../tasks/cuadrilla/task.md
tasks|-guard ../data/motai-v2.md|-guard ../tasks/motai-v2/task.md
tasks|-guard ../data/tablero.md|-guard ../tasks/tablero/task.md
today|
today|-json
today|-stage work
today|-n 47
today|-n 47 -json
today|-n 84
today|-n 12 -json
today|-n 47 -brief 1
today|-n 47 -brief 1 -json
closeout|
closeout|-json
closeout|-dia 2026-09-21 -json
closeout|-dia 2026-09-18
task-context|-tarea 47 -ver
task-context|-tarea tablero -ver
task-context|-tarea 84 -evento ../docs/task-context-event.example.json -n
LIST
exit $fail
