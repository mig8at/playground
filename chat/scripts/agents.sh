#!/bin/sh
# TUS AGENTES DEL CHAT, prendidos con el chat (`make chat`): cada uno de ../agents/* en su proceso. Uno que ya corre
# (su puerto escucha) no se vuelve a prender, y uno que falla no tumba el chat: este proceso queda vivo igual, porque
# `concurrently -k` apaga todo cuando uno de los suyos termina.
cd "$(dirname "$0")/../.." || exit 0
# Cada agente se compila y corre él mismo (no con `go run`, que al apagarlo deja vivo al binario): así apagar este
# proceso apaga a los agentes que prendió.
bin=$(mktemp -d)
# El `sleep` de la espera también se mata: si queda vivo, sigue con la salida de este proceso abierta y `concurrently`
# espera a que se cierre (hasta una hora) antes de soltar la terminal. Por eso Ctrl-C no cortaba.
trap 'kill $pids $sleeper 2>/dev/null; rm -rf "$bin"; exit 0' INT TERM
sleeper=''
pids=''
for d in agents/*/; do
  name=$(basename "$d")
  # El puerto es el que el agente escucha por defecto (`-serve 127.0.0.1:NNNN` en su main.go).
  port=$(sed -n 's/.*"serve", "127\.0\.0\.1:\([0-9]*\)".*/\1/p' "$d/main.go" | head -1)
  if [ -n "$port" ] && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "$name: ya corre en :$port"
    continue
  fi
  echo "$name: prendiendo${port:+ en :$port}"
  go build -o "$bin/$name" "./$d" || continue
  "$bin/$name" &
  pids="$pids $!"
done
# `wait` y no `sleep` solo: con el sleep en primer plano, la trampa no corre hasta que termina.
while :; do sleep 3600 & sleeper=$!; wait $sleeper; done
