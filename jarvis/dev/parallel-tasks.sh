#!/bin/bash
# Prueba de concurrencia: N sesiones de Jarvis en la app de tareas (un grupo), cada una crea su tarea AL MISMO TIEMPO;
# después se cuenta cuántas quedaron en el localStorage compartido. Uso: jarvis/dev/parallel-tasks.sh [N] [etiqueta]. Necesita la app de práctica (:5207) y la extensión conectada.
N=${1:-4}; TAG=${2:-corrida}
cd "$(dirname "$0")/../.."
J=bin/jarvis
API=http://localhost:5203
check() { curl -s -X POST "$API/api/live/check?tab=$1" -H 'Content-Type: application/json' -d "$(python3 -c 'import json,sys; print(json.dumps({"js":sys.argv[1]}))' "$2")" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok'))"; }
sessions=()
for i in $(seq 1 $N); do
  url=http://localhost:5207/; [ $i = 1 ] && url='http://localhost:5207/?reset'
  out=$($J start --group 'Tareas en paralelo' --url "$url" "sesión $i de la prueba $TAG" 2>&1)
  id=$(echo "$out" | grep -o 'pestaña [0-9]*' | head -1 | awk '{print $2}')
  sessions+=($id)
done
echo "sesiones: ${sessions[*]} (todas cargaron la lista inicial de 3 tareas)"
t0=$(python3 -c 'import time; print(time.time())')
i=0
for id in "${sessions[@]}"; do
  i=$((i+1))
  ( s=$(python3 -c 'import time; print(time.time())')
    $J --session $id click 'Nueva tarea' >/dev/null 2>&1
    $J --session $id fill 'Título' "Tarea de la sesión $i" >/dev/null 2>&1
    r=$($J --session $id click 'Crear tarea' 2>&1 | head -1)
    e=$(python3 -c "import time; print(round(time.time()-$s,1))")
    ok=$(echo "$r" | grep -q '✓' && echo bien || echo FALLÓ); echo "  sesión $id: «Tarea de la sesión $i» $ok en ${e} s" ) &
done
wait
echo "todas terminaron en $(python3 -c "import time; print(round(time.time()-$t0,1))") s"
# Lo que quedó en el localStorage (lo comparten todas: mismo Chrome, mismo origen)
first=${sessions[0]}
for k in $(seq 0 $N); do
  if [ "$(check $first "JSON.parse(localStorage.getItem('tareas.estado')||'[]').filter(t => t.titulo.startsWith('Tarea de la sesión')).length === $k")" = True ]; then echo "en el localStorage quedaron $k de $N tareas nuevas"; fi
done
[ "$(check $first "new Set(JSON.parse(localStorage.getItem('tareas.estado')||'[]').map(t => t.id)).size === JSON.parse(localStorage.getItem('tareas.estado')||'[]').length")" = True ] && echo "ids: sin repetir" || echo "ids: HAY REPETIDOS"
for id in "${sessions[@]}"; do
  for k in $(seq 0 $N); do
    [ "$(check $id "[...document.querySelectorAll('#lista strong')].filter(e => e.textContent.startsWith('Tarea de la sesión')).length === $k")" = True ] && echo "  la pantalla de la sesión $id muestra $k"
  done
done
$J groups close 'Tareas en paralelo' --force >/dev/null 2>&1
