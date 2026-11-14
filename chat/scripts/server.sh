#!/bin/sh
# El servidor del chat para `make chat` (desarrollo). Si :5185 ya contesta (la app de escritorio, que trae su servidor),
# usa ése y muestra su registro: no termina, porque si este proceso sale, concurrently -k apaga la interfaz. Si no, lo
# levanta acá con `go run`.
chat=$(cd "$(dirname "$0")/.." && pwd -P)
if curl -s -o /dev/null --max-time 1 http://127.0.0.1:5185/api/state; then
  echo "chat · API: la de Cockpit (:5185); con cambios en server/, \`make cockpit\` la recompila. Su registro:"
  exec tail -n 3 -F "$HOME/Library/Logs/creditop-my-tools-chat.log"
fi
cd "$chat/.." && exec go run ./chat/server -serve 127.0.0.1:5185
