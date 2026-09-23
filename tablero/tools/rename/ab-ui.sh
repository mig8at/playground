#!/bin/bash
# ab-ui.sh <árbol-viejo> — la interfaz vieja contra la nueva, cada una con su server y sobre los mismos
# datos (`ab-ui.mjs` toma la huella: texto y clases de cada región en 9 tareas × 3 pestañas). Es la vara
# de la fase 4b del lado del front: si una clave quedó sin renombrar en la UI, un campo sale vacío en la
# nueva y la huella difiere. El árbol viejo tiene que traer `tablero/{server,src,index.html,package.json,
# vite.config.js}` (p. ej. `git archive HEAD tablero/server tablero/src … | tar -x -C <dir>`).
# El caché de ramas cambió de claves: al viejo se le pone el rearmado con `normalize.py --reverse`.
OLD=${1:?uso: ab-ui.sh <árbol-viejo>}
S=${AB_TMP:-/tmp/tablero-ab-ui}; P=$(cd "$(dirname "$0")/../../.." && pwd); T=$P/tablero; R=$T/tools/rename
CACHE=$T/data/cache/ramas.json
rm -rf "$S"; mkdir -p "$S"
cp "$CACHE" "$S/ramas.new.json"; python3 "$R/json/normalize.py" --reverse < "$S/ramas.new.json" > "$S/ramas.old.json" || exit 1
trap 'cp "$S/ramas.new.json" "$CACHE"; kill $W 2>/dev/null' EXIT
ln -sfn "$T/node_modules" "$OLD/tablero/node_modules"
(cd "$OLD/tablero" && npx vite build --logLevel error --outDir "$S/dist-old" --emptyOutDir) || exit 1
(cd "$T" && npx vite build --logLevel error --outDir "$S/dist-new" --emptyOutDir) || exit 1
(cd "$OLD/tablero/server" && go build -o "$S/web-old" ./cmd/web) || exit 1
(cd "$T/server" && go build -o "$S/web-new" ./cmd/web) || exit 1
run() { # $1 viejo|nuevo · $2 caché · $3 binario · $4 dist · $5 puerto
  cp "$2" "$CACHE"
  (cd "$T/server" && exec env WEB_PORT=$5 "$3" > "$S/web-$1.log" 2>&1) & W=$!   # exec: el PID es el server
  for i in $(seq 40); do curl -sf "localhost:$5/health" >/dev/null && break; sleep 0.5; done
  node "$R/ab-ui.mjs" "$4" "$5" "$S/print-$1.json"; kill $W; wait $W 2>/dev/null
}
run old "$S/ramas.old.json" "$S/web-old" "$S/dist-old" 18787
run new "$S/ramas.new.json" "$S/web-new" "$S/dist-new" 18788
python3 - "$S/print-old.json" "$S/print-new.json" <<'PY'
import json, sys, difflib
a, b = (json.load(open(p)) for p in sys.argv[1:3])
bad = 0
for e, label in ((a['errors'], 'vieja'), (b['errors'], 'nueva')):
    if e: print(f"  ⚠ errores de consola en la {label}: {e[:3]}")
for screen in a['print']:
    for reg, old in a['print'][screen].items():
        new = b['print'].get(screen, {}).get(reg)
        if old == new:
            continue
        bad += 1
        print(f"  ✗ {screen} · {reg}")
        if (old or {}).get('text') != (new or {}).get('text'):
            d = difflib.unified_diff(((old or {}).get('text') or '').splitlines(), ((new or {}).get('text') or '').splitlines(), n=0, lineterm='')
            print('\n'.join('      ' + l for l in list(d)[2:12]))
        if (old or {}).get('classes') != (new or {}).get('classes'):
            oc, nc = (old or {}).get('classes') or {}, (new or {}).get('classes') or {}
            print('      clases:', {k: (oc.get(k), nc.get(k)) for k in set(oc) | set(nc) if oc.get(k) != nc.get(k)})
n = sum(len(v) for v in a['print'].values())
print(f"  {n - bad}/{n} regiones idénticas" if bad else f"  = las {n} regiones idénticas (texto y clases)")
sys.exit(1 if bad else 0)
PY
