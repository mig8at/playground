#!/bin/sh
# esperar.sh — espera a que la llamada de la sala cierre o quede inactiva, consultando /api/state cada 5 s.
#
#   sala/esperar.sh [minutos-de-inactividad=3] [puerto=5201] [sala=demo]
#
# Sale 0 cuando la llamada cerró (imprime por qué y el consumo), 3 si sigue abierta pero nadie dijo nada en ese lapso
# (agentes detenidos sin cerrar) y 2 si la sala no contesta. Existe porque el flujo de eventos podía perder el último
# estado, y quien esperaba el cierre se quedaba esperando (2026-11-02).
IDLE=${1:-3}
PORT=${2:-5201}
ROOM=${3:-demo}
last="" ; since=$(date +%s)
while :; do
  st=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/state?room=$ROOM") || { echo "la sala no contesta en :$PORT"; exit 2; }
  out=$(printf '%s' "$st" | python3 -c '
import json,sys
d=json.load(sys.stdin)
n=len(d.get("messages") or [])
print(n)
print("1" if d.get("running") else "0")
print(d.get("ended") or "")
rep=[m["text"] for m in (d.get("messages") or []) if m["text"].startswith("Consumo de la llamada")]
print(rep[-1] if rep else "")
') || { echo "estado ilegible"; exit 2; }
  n=$(printf '%s\n' "$out" | sed -n 1p); running=$(printf '%s\n' "$out" | sed -n 2p); ended=$(printf '%s\n' "$out" | sed -n 3p)
  if [ "$running" = "0" ] && [ -n "$ended" ]; then
    echo "cerró: $ended"; printf '%s\n' "$out" | sed -n '4,$p'; exit 0
  fi
  if [ "$n" != "$last" ]; then last=$n; since=$(date +%s); fi
  if [ $(( $(date +%s) - since )) -ge $(( IDLE * 60 )) ]; then
    echo "sigue abierta pero nadie dijo nada en $IDLE min ($n mensajes)"; exit 3
  fi
  sleep 5
done
