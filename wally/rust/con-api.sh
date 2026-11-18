#!/bin/bash
# Dentro del contenedor: levanta la API del proyecto de /work en 127.0.0.1:$PORT, corre el comando que le pasen
# (un curl, varios) contra ella, y la apaga. Para explorar a mano lo que `probar-api` comprueba con criterios.
#   con-api curl -s localhost:8080/tareas
#   con-api bash -c 'curl -s -X POST localhost:8080/tareas -H "content-type: application/json" -d "{\"titulo\":\"a\"}"; curl -s localhost:8080/tareas'
cd /work || exit 2
export PORT=${PORT:-8080}
if [ $# -eq 0 ]; then echo "uso: con-api <comando>   (por ejemplo: con-api curl -s localhost:$PORT/)"; exit 2; fi
if ! cargo build --offline --color never > /tmp/build.log 2>&1; then
  echo "NO COMPILA:"; grep -v '^ *Compiling\|^ *Locking' /tmp/build.log | tail -50; exit 1
fi
BIN=$(cargo metadata --offline --no-deps --format-version 1 2>/dev/null | jq -r '[.packages[0].targets[] | select(.kind[] == "bin") | .name][0] // empty')
if [ -z "$BIN" ]; then echo "El proyecto no tiene un binario (src/main.rs)."; exit 1; fi
"/target/debug/$BIN" > /tmp/server.log 2>&1 &
PID=$!
up=0
for _ in $(seq 1 75); do
  kill -0 $PID 2>/dev/null || break
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/"; then up=1; break; fi
  sleep 0.2
done
if [ $up -ne 1 ]; then
  echo "LA API NO LEVANTÓ en 127.0.0.1:$PORT. Lo que escribió al arrancar:"; tail -20 /tmp/server.log; kill $PID 2>/dev/null; exit 1
fi
"$@"
code=$?
echo
if ! kill -0 $PID 2>/dev/null; then echo "⚠ la API se cayó durante el comando."; fi
if [ -s /tmp/server.log ]; then echo "--- lo que escribió la API (stdout y stderr) ---"; tail -15 /tmp/server.log; fi
kill $PID 2>/dev/null
exit $code
