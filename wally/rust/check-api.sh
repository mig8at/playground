#!/bin/bash
# Dentro del contenedor (sin red): compila el proyecto de /work, levanta su binario en 127.0.0.1:$PORT y le hace, EN
# ORDEN y contra el mismo proceso, los pedidos de criteria.json. Dice cuál pasa y cuál no. Sale 1 si algo falla.
#   [ { "name": "…", "request": { "method": "POST", "path": "/tasks", "body": { … } },
#       "expect": { "status": 201, "contains": ["…"], "not_contains": ["…"] } } ]
# Con los nombres de antes (criterio, pedido, metodo, ruta, cuerpo, espera, estado, contiene, no_contiene) también corre.
cd /work || exit 2
export PORT=8080
FORMA='[
  { "name": "lo que tiene que pasar, en una línea",
    "request": { "method": "POST", "path": "/tasks", "body": { "title": "comprar pan" } },
    "expect": { "status": 201, "contains": ["comprar pan"], "not_contains": ["error"] } }
]'
if [ ! -f criteria.json ]; then
  echo "CRITERIOS: falta criteria.json en el proyecto. Sin él no se sabe si la API HACE lo pedido. Escribilo (un criterio por cada cosa que te pidieron), con esta forma:"; echo "$FORMA"
  echo; echo "RESULTADO: 1 problema(s) para corregir."; exit 1
fi
if ! jq -e 'type == "array" and length > 0' criteria.json > /dev/null 2>&1; then
  echo "CRITERIOS: criteria.json tiene que ser una lista JSON con al menos un criterio. La forma:"; echo "$FORMA"
  echo; echo "RESULTADO: 1 problema(s) para corregir."; exit 1
fi
# Los nombres de antes se traducen a los de ahora en una copia: el resto lee sólo esa.
jq 'map({name: (.name // .criterio),
  request: ((.request // .pedido // {}) | {method: (.method // .metodo), path: (.path // .ruta)}
    + (if has("body") then {body: .body} elif has("cuerpo") then {body: .cuerpo} else {} end)),
  expect: ((.expect // .espera // {}) | {status: (.status // .estado), contains: (.contains // .contiene), not_contains: (.not_contains // .no_contiene)})})' \
  criteria.json > /tmp/criteria.json
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
n=$(jq 'length' /tmp/criteria.json)
if [ "$n" -gt $MAX ]; then
  echo; echo "CRITERIOS: hay $n y el tope es $MAX. No se corrió ninguno: juntá o sacá criterios hasta $MAX."
  kill $PID 2>/dev/null
  echo; echo "RESULTADO: 1 problema(s) para corregir."; exit 1
fi
echo; echo "CRITERIOS ($n):"
bad=0
for i in $(seq 0 $((n - 1))); do
  c=$(jq -c ".[$i]" /tmp/criteria.json)
  name=$(jq -r '.name // "criterio sin nombre"' <<<"$c" | cut -c1-140)
  method=$(jq -r '.request.method // "GET"' <<<"$c"); path=$(jq -r '.request.path // "/"' <<<"$c")
  want=$(jq -r '.expect.status // empty' <<<"$c")
  if [ -z "$want" ] && [ "$(jq '((.expect.contains // []) + (.expect.not_contains // [])) | length' <<<"$c")" = "0" ]; then
    echo "  ✗ $name — no dice qué espera (status, contains o not_contains): no comprueba nada"; bad=$((bad + 1)); continue
  fi
  args=(-s -o /tmp/body -w '%{http_code}' --max-time 5 -X "$method" "http://127.0.0.1:$PORT$path")
  if jq -e '.request | has("body")' <<<"$c" > /dev/null; then args+=(-H 'content-type: application/json' --data "$(jq -c '.request.body' <<<"$c")"); fi
  code=$(curl "${args[@]}" 2>/dev/null); body=$(head -c 400 /tmp/body 2>/dev/null)
  why=""
  [ -n "$want" ] && [ "$code" != "$want" ] && why="esperaba estado $want y dio $code"
  while IFS= read -r s; do [ -n "$s" ] && ! grep -qF -- "$s" /tmp/body && why="${why:+$why; }no contiene «$s»"; done < <(jq -r '(.expect.contains // [])[]' <<<"$c")
  while IFS= read -r s; do [ -n "$s" ] && grep -qF -- "$s" /tmp/body && why="${why:+$why; }contiene «$s» y no debía"; done < <(jq -r '(.expect.not_contains // [])[]' <<<"$c")
  if [ -n "$why" ]; then echo "  ✗ $name — $method $path: $why. Contestó ($code): $body"; bad=$((bad + 1)); else echo "  ✓ $name"; fi
done
if ! kill -0 $PID 2>/dev/null; then echo "  ✗ la API se cayó durante los pedidos: $(tail -5 /tmp/server.log)"; bad=$((bad + 1)); fi
kill $PID 2>/dev/null
echo
if [ $bad -gt 0 ]; then echo "RESULTADO: $bad problema(s) para corregir."; exit 1; fi
echo "RESULTADO: sin errores."
