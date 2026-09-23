#!/bin/bash
# ab-web.sh — la misma comparación que `ab-cli.sh`, para la API que lee la interfaz. Levanta el `web`
# viejo (:18787) y el nuevo (:18788) que dejó `ab-cli.sh`, sobre los mismos datos, y compara cada GET
# byte a byte. Sólo GETs: ninguno escribe (los de Jira leen el issue y sus transiciones).
S=${AB_TMP:-/tmp/tablero-ab}; P=$(cd "$(dirname "$0")/../../.." && pwd)
[ -x "$S/bins/old/web" ] || { echo "falta $S/bins/old/web: corré ab-cli.sh primero"; exit 2; }
cd "$P/tablero/server"
WEB_PORT=18787 "$S/bins/old/web" > "$S/web-old.log" 2>&1 & A=$!
WEB_PORT=18788 "$S/bins/new/web" > "$S/web-new.log" 2>&1 & B=$!
trap "kill $A $B 2>/dev/null" EXIT
for i in $(seq 20); do curl -sf localhost:18787/health >/dev/null && curl -sf localhost:18788/health >/dev/null && break; sleep 0.5; done
fail=0
for u in /api/config /api/guard /api/settings /api/ramas /api/repos-ramas /api/efforts /api/task-locals \
  "/api/entries?days=30" "/api/entries?effort=47" "/api/task-context?effort=47" "/api/task-context?effort=84" \
  "/api/pulse?days=20" "/api/canon/references?ids=47" /api/sprint "/api/sprints?n=4" \
  "/api/task?key=CORE-420" "/api/transitions?key=CORE-420"; do
  o=$(curl -s "localhost:18787$u"); n=$(curl -s "localhost:18788$u")
  if [ "$o" == "$n" ]; then echo "  = $u (${#n} B)"; else echo "  ✗ $u"; cmp <(echo "$o") <(echo "$n") | head -2; fail=1; fi
done
exit $fail
