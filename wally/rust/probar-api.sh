#!/bin/bash
# Dentro del contenedor (sin red): compila el proyecto de /work, levanta su binario en 127.0.0.1:$PORT y le hace, EN
# ORDEN y contra el mismo proceso, los pedidos de criterios.json. Dice cuál pasa y cuál no. Sale 1 si algo falla.
#   [ { "criterio": "…", "pedido": { "metodo": "POST", "ruta": "/tareas", "cuerpo": { … } },
#       "espera": { "estado": 201, "contiene": ["…"], "no_contiene": ["…"] } } ]
cd /work || exit 2
export PORT=8080
FORMA='[
  { "criterio": "lo que tiene que pasar, en una línea",
    "pedido": { "metodo": "POST", "ruta": "/tareas", "cuerpo": { "titulo": "comprar pan" } },
    "espera": { "estado": 201, "contiene": ["comprar pan"], "no_contiene": ["error"] } }
]'
if [ ! -f criterios.json ]; then
  echo "CRITERIOS: falta criterios.json en el proyecto. Sin él no se sabe si la API HACE lo pedido. Escribilo (un criterio por cada cosa que te pidieron), con esta forma:"; echo "$FORMA"
  echo; echo "RESULTADO: 1 problema(s) para corregir."; exit 1
fi
if ! jq -e 'type == "array" and length > 0' criterios.json > /dev/null 2>&1; then
  echo "CRITERIOS: criterios.json tiene que ser una lista JSON con al menos un criterio. La forma:"; echo "$FORMA"
  echo; echo "RESULTADO: 1 problema(s) para corregir."; exit 1
fi
if ! cargo build --offline --color never > /tmp/build.log 2>&1; then
  echo "NO COMPILA:"; grep -v '^ *Compiling\|^ *Downloaded\|^ *Locking' /tmp/build.log | tail -60
  echo; echo "RESULTADO: 1 problema(s) para corregir."; exit 1
fi
BIN=$(cargo metadata --offline --no-deps --format-version 1 2>/dev/null | jq -r '[.packages[0].targets[] | select(.kind[] == "bin") | .name][0] // empty')
if [ -z "$BIN" ]; then echo "El proyecto no tiene un binario (src/main.rs)."; echo; echo "RESULTADO: 1 problema(s) para corregir."; exit 1; fi
"/target/debug/$BIN" > /tmp/server.log 2>&1 &
PID=$!
up=0
for _ in $(seq 1 75); do
  if ! kill -0 $PID 2>/dev/null; then break; fi
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/"; then up=1; break; fi
  sleep 0.2
done
if [ $up -ne 1 ]; then
  echo "LA API NO LEVANTÓ en 127.0.0.1:$PORT (tiene que escuchar en 127.0.0.1 y en el puerto de la variable PORT). Lo que escribió al arrancar:"
  tail -20 /tmp/server.log; kill $PID 2>/dev/null
  echo; echo "RESULTADO: 1 problema(s) para corregir."; exit 1
fi
echo "La API levantó en 127.0.0.1:$PORT."
# Se corren TODOS. Un tope que descarta en silencio los del final se lee como «pasaron» (2026-11-17: cortaba en 30 y
# el criterio 31 nunca se evaluaba; lo encontró el propio agente). Por encima de MAX no se corre ninguno: se dice.
MAX=200
n=$(jq 'length' criterios.json)
if [ "$n" -gt $MAX ]; then
  echo; echo "CRITERIOS: hay $n y el tope es $MAX. No se corrió ninguno: juntá o sacá criterios hasta $MAX."
  kill $PID 2>/dev/null
  echo; echo "RESULTADO: 1 problema(s) para corregir."; exit 1
fi
echo; echo "CRITERIOS ($n):"
bad=0
for i in $(seq 0 $((n - 1))); do
  c=$(jq -c ".[$i]" criterios.json)
  name=$(jq -r '.criterio // "criterio sin nombre"' <<<"$c" | cut -c1-140)
  method=$(jq -r '.pedido.metodo // "GET"' <<<"$c"); path=$(jq -r '.pedido.ruta // "/"' <<<"$c")
  want=$(jq -r '.espera.estado // empty' <<<"$c")
  if [ -z "$want" ] && [ "$(jq '((.espera.contiene // []) + (.espera.no_contiene // [])) | length' <<<"$c")" = "0" ]; then
    echo "  ✗ $name — no dice qué espera (estado, contiene o no_contiene): no comprueba nada"; bad=$((bad + 1)); continue
  fi
  args=(-s -o /tmp/body -w '%{http_code}' --max-time 5 -X "$method" "http://127.0.0.1:$PORT$path")
  if jq -e '.pedido | has("cuerpo")' <<<"$c" > /dev/null; then args+=(-H 'content-type: application/json' --data "$(jq -c '.pedido.cuerpo' <<<"$c")"); fi
  code=$(curl "${args[@]}" 2>/dev/null); body=$(head -c 400 /tmp/body 2>/dev/null)
  why=""
  [ -n "$want" ] && [ "$code" != "$want" ] && why="esperaba estado $want y dio $code"
  while IFS= read -r s; do [ -n "$s" ] && ! grep -qF -- "$s" /tmp/body && why="${why:+$why; }no contiene «$s»"; done < <(jq -r '(.espera.contiene // [])[]' <<<"$c")
  while IFS= read -r s; do [ -n "$s" ] && grep -qF -- "$s" /tmp/body && why="${why:+$why; }contiene «$s» y no debía"; done < <(jq -r '(.espera.no_contiene // [])[]' <<<"$c")
  if [ -n "$why" ]; then echo "  ✗ $name — $method $path: $why. Contestó ($code): $body"; bad=$((bad + 1)); else echo "  ✓ $name"; fi
done
if ! kill -0 $PID 2>/dev/null; then echo "  ✗ la API se cayó durante los pedidos: $(tail -5 /tmp/server.log)"; bad=$((bad + 1)); fi
kill $PID 2>/dev/null
echo
if [ $bad -gt 0 ]; then echo "RESULTADO: $bad problema(s) para corregir."; exit 1; fi
echo "RESULTADO: sin errores."
