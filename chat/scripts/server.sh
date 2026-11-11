#!/bin/sh
# El servidor del chat para `make chat`. Si está el servicio del Mac (scripts/service.sh), usa ese: lo recompila si
# cambió el código y muestra su registro (no termina, porque si este proceso sale, concurrently -k apaga la interfaz).
# Si :5185 ya contesta (la app de escritorio, que trae su servidor), usa ése y muestra el registro.
# Si no, lo levanta acá con `go run`, como siempre.
label=com.creditop.playground.chat
chat=$(cd "$(dirname "$0")/.." && pwd -P)
if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  sh "$chat/scripts/service.sh" refresh
  echo "chat · API: la del servicio del Mac (:5185). Su registro:"
  exec tail -n 3 -F "$HOME/Library/Logs/creditop-playground-chat.log"
fi
if curl -s -o /dev/null --max-time 1 http://127.0.0.1:5185/api/state; then
  echo "chat · API: la de la app de escritorio (:5185); con cambios en server/, \`make chat-app\` la recompila. Su registro:"
  exec tail -n 3 -F "$HOME/Library/Logs/creditop-playground-chat.log"
fi
cd "$chat/.." && exec go run ./chat/server -serve 127.0.0.1:5185
