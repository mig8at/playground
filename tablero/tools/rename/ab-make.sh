#!/bin/bash
# ab-make.sh <worktree-viejo> — la comparación de más arriba: los targets de `make` y los hooks de
# Claude, que son lo que de verdad se invoca. Como los targets no cambian de nombre, los dos lados
# corren EL MISMO comando; lo que cambia por debajo (carpetas de cmd/, binarios) es lo que se prueba.
# Preparación, para que los dos lados lean los mismos datos (lo que git ignora no viene en el worktree):
#   git worktree add --detach <dir> <commit>
#   for d in cache entries pulse; do rm -rf <dir>/tablero/data/$d; ln -s "$PWD/tablero/data/$d" <dir>/tablero/data/$d; done
#   ln -s "$PWD/tablero/.runs" <dir>/tablero/.runs; cp tablero/server/.env <dir>/tablero/server/.env
OLD=${1:?uso: ab-make.sh <worktree-viejo>}; NEW=$(cd "$(dirname "$0")/../../.." && pwd)
norm() { echo "$1" | sed -E 's/in [0-9.]+s$/in <T>s/; s/"id": "ctx_[^"]+"/"id": "<ID>"/; s/"at": "[^"]+"/"at": "<AT>"/'; }
fail=0
run() {
  local name=$1; shift
  o=$(cd "$OLD" && eval "$*" 2>&1; echo "exit=$?"); o=$(norm "${o//$OLD/<RAIZ>}")
  n=$(cd "$NEW" && eval "$*" 2>&1; echo "exit=$?"); n=$(norm "${n//$NEW/<RAIZ>}")
  if [ "$o" == "$n" ]; then echo "  = $name (${#n} B)"; else echo "  ✗ $name"; diff <(echo "$o") <(echo "$n") | head -8; fail=1; fi
}
# Los targets que leen tareas y git: el `make` NUEVO contra el binario VIEJO con los mismos argumentos,
# los dos desde el repo real. (Correrlos dentro del worktree no sirve: ahí git ve distintas las tareas
# y cambia «días sin tocar» sin que el código tenga nada que ver.) Los binarios viejos los deja
# `ab-cli.sh` en $AB_TMP/bins/old; cada línea es «target | binario argumentos».
B=${AB_TMP:-/tmp/tablero-ab}/bins/old
[ -x "$B/tareas" ] || { echo "falta $B/tareas: corré ab-cli.sh primero"; exit 2; }
while IFS='|' read -r target bin; do
  o=$(cd "$NEW/tablero/server" && eval "$B/$bin" 2>&1; echo "exit=$?"); o=$(norm "$o")
  n=$(cd "$NEW" && eval "make -s $target" 2>&1; echo "exit=$?"); n=$(norm "$n")
  # lo que agregan `go run` y `make` cuando el comando sale ≠0; el código de salida real ya va en exit=
  n=$(echo "$n" | grep -vE '^(exit status [0-9]+|make: \*\*\* \[.*\] Error [0-9]+)$'); n=${n//exit=2/exit=1}; o=${o//exit=2/exit=1}
  if [ "$o" == "$n" ]; then echo "  = make $target (${#n} B)"; else echo "  ✗ make $target"; diff <(echo "$o") <(echo "$n") | head -6; fail=1; fi
done <<'LIST'
tareas TODAS=1|tareas -todas
tareas TODAS=1 JSON=1|tareas -todas -json
tareas N=47|tareas -n 47
tarea-json N=47|tareas -n 47 -json
tarea-json N=47 CONTENIDO=1|tareas -n 47 -json -contenido
sprint JSON=1|tareas -sprint -json
bitacora DAYS=30 JSON=1|tareas -bitacora 30 -json
hoy JSON=1|hoy -json
retomar N=47|hoy -n 47
retomar N=47 JSON=1 BRIEF=1|hoy -n 47 -json -brief 1
cierre JSON=1|cierre -json
cierre DIA=2026-09-21|cierre -dia 2026-09-21
tarea-context N=47|task-context -tarea 47 -ver
tareas-guard F=tablero/data/motai-v2.md|tareas -guard ../../tablero/data/motai-v2.md
LIST
# Los que no dependen de git: el mismo target en los dos árboles. `trampas` imprime la ruta de su
# documento, que es justo lo que se mudó: se lee con el nombre viejo.
for t in "trampas" "trampas INDICE=1" "repos-test" "tablero-jev-test" "pulso DAYS=3"; do
  run "make $t (worktree)" "make -s $t | sed 's#data/traps/#data/trampas/#'"
done
# los hooks, con la entrada que les da Claude Code (una sesión inventada, para no gastar el aviso de ésta)
run "hook tarea-lint" "echo '{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"'\$PWD'/tablero/data/tablero.md\"}}' | python3 .claude/hooks/tarea-lint.py"
run "hook cierre" "echo '{\"session_id\":\"ab-make-\$\$\",\"stop_hook_active\":false}' | CLAUDE_PROJECT_DIR=\$PWD python3 .claude/hooks/cierre.py"
exit $fail
