#!/bin/bash
# ab-py.sh <worktree-viejo> — corre cada herramienta Python del tablero con el código viejo y el nuevo,
# uno tras otro y sobre los mismos datos, y compara la salida. Para prepararlo:
#   git worktree add --detach <dir> <commit> && ln -s "$PWD/tablero/.runs" <dir>/tablero/.runs
# (sin el enlace, `jev stats` lee un .runs vacío del lado viejo y difiere sin que el código cambie).
#
# Normaliza lo que cambia en cada corrida aunque el código sea el mismo —la raíz de cada árbol, la
# hora, el nombre de un reporte nuevo— y, desde la fase 2, los nombres de archivo que se renombraron:
# el lado nuevo se invoca con el nombre nuevo, y su salida se lee con el viejo para poder compararla.
OLD=${1:?uso: ab-py.sh <worktree-viejo>}; NEW=$(cd "$(dirname "$0")/../../.." && pwd); T=${AB_TMP:-/tmp/tablero-ab-py}; mkdir -p "$T"
RENAMED=(citas.py:citations.py ramas.py:branches.py trampas.py:traps.py test_ramas.py:test_branches.py)
# for_tree <árbol> <comando>: el comando con los nombres que EXISTEN en ese árbol (el viejo puede ser de
# antes o de después de cualquier fase)
for_tree() { local tree=$1; shift; local s="$*"
  for p in "${RENAMED[@]}"; do [ -e "$tree/tablero/tools/${p#*:}" ] && s=${s//tools\/${p%%:*}/tools\/${p#*:}}; done
  [ -d "$tree/tablero/data/traps" ] && s=${s//data\/trampas\//data\/traps\/}
  # desde el 2026-09-23 una tarea es tasks/<slug>/task.md: los comandos se escriben con la forma vieja
  [ -d "$tree/tablero/tasks" ] && s=$(echo "$s" | sed -E 's#tablero/data/([a-z0-9-]+)\.md#tablero/tasks/\1/task.md#g')
  echo "$s"; }
to_old() { local s="$1"; for p in "${RENAMED[@]}"; do s=${s//${p#*:}/${p%%:*}}; done; s=${s//data\/traps\//data\/trampas\/}
  echo "$s" | sed -E 's#tasks/([a-z0-9-]+)/task\.md#data/\1.md#g'; }
# ⚠ las corridas de `citas` sobre TAREAS sólo comparan si los dos lados ven los mismos archivos de tarea:
# el validador hace `git blame` de cada documento, así que una tarea editada en el medio (o enlazada en el
# worktree) cambia su resultado sin que el código cambie. Para eso, copiá la versión vieja del validador a
# `<raíz>/.runs/tools/` —misma profundidad, misma raíz— y comparalas sobre el repo real.
norm() { echo "$1" | sed -E 's/ {2,}/  /g; s/[0-9]{8}T[0-9]{6}-[0-9a-f]{8}/<REPORTE>/g; s/"(generado|generated)": "[^"]+"/"generado": "<HORA>"/; s/in [0-9.]+s$/in <T>s/'; }
fail=0
run() { # run <nombre> <comando, con las rutas VIEJAS>
  local name=$1; shift
  o=$(cd "$OLD" && eval "$(for_tree "$OLD" "$*")" 2>&1; echo "exit=$?"); o=${o//$OLD/<RAIZ>}; o=${o//$T\/old/<OUT>}
  n=$(cd "$NEW" && eval "$(for_tree "$NEW" "$*")" 2>&1; echo "exit=$?"); n=${n//$NEW/<RAIZ>}; n=${n//$T\/new/<OUT>}
  o=$(norm "$(to_old "$o")"); n=$(norm "$(to_old "$n")")
  if [ "$o" == "$n" ]; then echo "  = $name (${#n} B)"; else echo "  ✗ $name"; diff <(echo "$o") <(echo "$n") | head -8; fail=1; fi
}
run "trampas" python3 tablero/tools/trampas.py
run "trampas --indice" python3 tablero/tools/trampas.py --indice
run "make trampas (Makefile)" make -s trampas
run "citas trampas/doc.md" python3 tablero/tools/citas.py tablero/data/trampas/doc.md
run "citas trampas/doc.md --ok" python3 tablero/tools/citas.py tablero/data/trampas/doc.md --ok
run "citas kyc (tarea)" python3 tablero/tools/citas.py tablero/data/kyc-segundo-apellido-no-coincide.md
run "citas 2 docs" python3 tablero/tools/citas.py tablero/data/agente-soporte-modificacion-datos.md tablero/data/context.md
run "jev --help" python3 tablero/tools/jev.py --help
run "jev stats" python3 tablero/tools/jev.py stats
run "jev bench (preview)" python3 tablero/tools/jev.py bench
run "ramas --json" "python3 tablero/tools/ramas.py --json --output $T/SIDE.json | sed 's#$T/[a-z]*.json#<OUT>#'"
run "make repos-test (Makefile)" make -s repos-test
run "make tablero-jev-test (Makefile)" make -s tablero-jev-test
run "huella de trazador importa del tablero" "python3 -c 'import sys; sys.argv=[\"x\"]; sys.path.insert(0,\"trazador/tools\"); import huella; print(huella.del_ref.__name__)'"
exit $fail
