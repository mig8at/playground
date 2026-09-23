#!/bin/bash
# ab-json.sh <árbol-viejo> — la vara de la fase 4b (claves JSON en inglés). Es `ab-cli.sh` + `ab-web.sh`
# con una diferencia: una salida JSON del binario VIEJO se traduce con `maps/phase4b-json.tsv` antes de
# comparar (`json/normalize.py --old`), y las dos se comparan como JSON canónico. Una salida de texto se
# compara byte a byte, como siempre. Si algo difiere en más que el nombre de una clave, sale ≠0.
#
# El caché de ramas cambió de claves con la fase: antes de cada corrida se pone el que entiende ese
# binario —el viejo se rearma del actual con `normalize.py --reverse`— y al final queda el nuevo.
# ⚠ Sólo GETs y comandos de lectura: a un binario viejo sobre datos reales no se le manda nada que
# escriba (el 2026-09-23 un DELETE de prueba no borró nada sólo porque el id no existía).
OLD=${1:?uso: ab-json.sh <árbol-viejo>}
S=${AB_TMP:-/tmp/tablero-ab-json}; P=$(cd "$(dirname "$0")/../../.." && pwd); B=$S/bins; N=$P/tablero/tools/rename/json/normalize.py
CACHE=$P/tablero/data/cache/ramas.json
rm -rf "$S"; mkdir -p "$B/old" "$B/new"
cp "$CACHE" "$S/ramas.new.json"
python3 "$N" --reverse < "$S/ramas.new.json" > "$S/ramas.old.json" || exit 1
trap 'cp "$S/ramas.new.json" "$CACHE"' EXIT
for c in tasks today closeout task-context web; do
  (cd "$OLD/tablero/server" && go build -o "$B/old/$c" ./cmd/$c) || exit 1
  (cd "$P/tablero/server" && go build -o "$B/new/$c" ./cmd/$c) || exit 1
done
same() { # $1 salida vieja · $2 salida nueva → 0 si coinciden (JSON por contenido, texto por bytes)
  local o n
  if o=$(printf '%s' "$1" | python3 "$N" --old) && n=$(printf '%s' "$2" | python3 "$N"); then [ "$o" == "$n" ]
  else [ "$1" == "$2" ]; fi
}
cd "$P/tablero/server"
fail=0
echo "── consola"
while IFS= read -r line; do
  [ -z "$line" ] && continue
  c=${line%% *}; a=${line#* }; [ "$a" = "$c" ] && a=""
  cp "$S/ramas.old.json" "$CACHE"; o=$("$B/old/$c" $a 2>&1); oe=$?
  cp "$S/ramas.new.json" "$CACHE"; n=$("$B/new/$c" $a 2>&1); ne=$?
  if [ $oe -eq $ne ] && same "$o" "$n"; then echo "  = $line"; else echo "  ✗ $line (exit $oe → $ne)"; fail=1
    diff <(printf '%s' "$o" | python3 "$N" --old 2>/dev/null || printf '%s' "$o") <(printf '%s' "$n" | python3 "$N" 2>/dev/null || printf '%s' "$n") | head -8; fi
done <<'LIST'
tasks
tasks -todas
tasks -todas -json
tasks -stage work -todas
tasks -n 47
tasks -n 47 -json
tasks -n 47 -json -contenido
tasks -n tablero -json
tasks -n kyc-segundo
tasks -sprint
tasks -sprint -json
tasks -bitacora 30
tasks -bitacora 30 -json
tasks -lint ../tasks/tablero/task.md
tasks -guard ../tasks/motai-v2/task.md
tasks -guard ../tasks/motai-v2/task.md -json
tasks -guard ../tasks/tablero/task.md
today
today -json
today -stage work
today -n 47
today -n 47 -json
today -n 84
today -n 84 -json
today -n 12 -json
today -n 47 -brief 1
today -n 47 -brief 1 -json
closeout
closeout -json
closeout -dia 2026-09-21 -json
closeout -dia 2026-09-18
task-context -tarea 47 -ver
task-context -tarea tablero -ver
LIST
echo "── API"
WEB_PORT=18797 "$B/old/web" > "$S/web-old.log" 2>&1 & A=$!
WEB_PORT=18798 "$B/new/web" > "$S/web-new.log" 2>&1 & W=$!
trap 'kill $A $W 2>/dev/null; cp "$S/ramas.new.json" "$CACHE"' EXIT
for i in $(seq 40); do curl -sf localhost:18797/health >/dev/null && curl -sf localhost:18798/health >/dev/null && break; sleep 0.5; done
for u in /api/config /api/ramas /api/efforts /api/task-locals "/api/entries?days=30" "/api/task-context?effort=47" \
  "/api/task-context?effort=84" "/api/pulse?days=20" "/api/sprints?board=384&n=12" "/api/sprint?board=384" /api/jira-inbox \
  "/api/transitions?key=CORE-420"; do
  cp "$S/ramas.old.json" "$CACHE"; o=$(curl -s "localhost:18797$u")
  cp "$S/ramas.new.json" "$CACHE"; n=$(curl -s "localhost:18798$u")
  if same "$o" "$n"; then echo "  = $u (${#n} B)"; else echo "  ✗ $u"; fail=1
    diff <(printf '%s' "$o" | python3 "$N" --old) <(printf '%s' "$n" | python3 "$N") | head -8; fi
done
exit $fail
