#!/bin/bash
# ab-cli.sh <árbol-viejo> — ¿el rename cambió algo que se VE? Compila los comandos de lectura del
# tablero dos veces —desde un árbol viejo (p. ej. `git archive <commit> tablero/server | tar -x -C …`)
# y desde el actual— y corre cada invocación con los dos binarios, uno tras otro, desde el mismo
# directorio y sobre los mismos datos. Compararlos así, y no contra un snapshot de antes, es lo que
# evita el falso positivo: el pulso escribe cada 5′ y dos corridas separadas por minutos difieren solas.
# Deja también los dos `web` compilados para `ab-web.sh`. Sale ≠0 si alguna salida difiere.
# (El id y la hora de `task-context -n` difieren siempre: son un id nuevo por corrida.)
OLD=${1:?uso: ab-cli.sh <árbol-viejo>}
S=${AB_TMP:-/tmp/tablero-ab}; P=$(cd "$(dirname "$0")/../../.." && pwd); B=$S/bins
rm -rf "$B"; mkdir -p "$B/old" "$B/new"
# carpeta de cada comando en cada árbol: desde la fase 3 se llaman distinto (el binario, igual que antes)
renamed_dir() { case $1 in tareas) echo tasks;; hoy) echo today;; cierre) echo closeout;; *) echo "$1";; esac; }
cmd_dir() { local tree=$1 c=$2 d; d=$(renamed_dir "$c")
  if [ -d "$tree/tablero/server/cmd/$d" ]; then echo "$d"; else echo "$c"; fi; }
for c in tareas hoy cierre task-context web; do
  (cd "$OLD/tablero/server" && go build -o "$B/old/$c" ./cmd/$(cmd_dir "$OLD" $c)) || exit 1
  (cd "$P/tablero/server" && go build -o "$B/new/$c" ./cmd/$(cmd_dir "$P" $c)) || exit 1
done
cd "$P/tablero/server"
fail=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  c=${line%% *}; a=${line#* }; [ "$a" = "$c" ] && a=""
  o=$("$B/old/$c" $a 2>&1; echo "exit=$?"); n=$("$B/new/$c" $a 2>&1; echo "exit=$?")
  if [ "$o" == "$n" ]; then echo "  = $line"; else echo "  ✗ $line"; diff <(echo "$o") <(echo "$n") | head -6; fail=1; fi
done <<'LIST'
tareas
tareas -todas
tareas -todas -json
tareas -stage work -todas
tareas -n 47
tareas -n 47 -json
tareas -n 47 -json -contenido
tareas -n tablero -json
tareas -n kyc-segundo
tareas -sprint
tareas -sprint -json
tareas -bitacora 30
tareas -bitacora 30 -json
tareas -lint ../data/tablero.md
tareas -lint ../data/cuadrilla.md
tareas -guard ../data/motai-v2.md
tareas -guard ../data/tablero.md
hoy
hoy -json
hoy -stage work
hoy -n 47
hoy -n 47 -json
hoy -n 84
hoy -n 12 -json
hoy -n 47 -brief 1
hoy -n 47 -brief 1 -json
cierre
cierre -json
cierre -dia 2026-09-21 -json
cierre -dia 2026-09-18
task-context -tarea 47 -ver
task-context -tarea tablero -ver
task-context -tarea 84 -evento ../docs/task-context-event.example.json -n
LIST
exit $fail
