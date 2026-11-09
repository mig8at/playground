#!/bin/sh
# El servidor del chat para `make chat`. Si está el servicio del Mac (scripts/service.sh), usa ese: lo recompila si
# cambió el código y muestra su registro (no termina, porque si este proceso sale, concurrently -k apaga la interfaz).
# Si no, lo levanta acá con `go run`, como siempre.
label=com.creditop.playground.chat
chat=$(cd "$(dirname "$0")/.." && pwd -P)
if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  sh "$chat/scripts/service.sh" refresh
  echo "chat · API: la del servicio del Mac (:5185). Su registro:"
  exec tail -n 3 -F "$HOME/Library/Logs/creditop-playground-chat.log"
fi
cd "$chat/.." && exec go run ./chat/server -serve 127.0.0.1:5185
