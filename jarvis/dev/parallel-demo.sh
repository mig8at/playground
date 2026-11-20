#!/bin/bash
# DEMO de paralelismo para MIRAR: dos grupos con tres sesiones cada uno trabajan a la vez, unos 30 s, mientras la
# persona usa su Chrome. Se miran en la vista «Todas» de Jarvis en Cockpit (sin traerlo al frente).
#   «Tareas» (demo de tareas, :5207): cada sesión crea 3 tareas, con su nota.
#   «Panel Andino» (:5206): una cambia el IVA y el nombre de la tienda; dos invitan a dos usuarios cada una.
# Las pestañas se abren DETRÁS de la que está mirando la persona y ningún comando la trae al frente (de fondo por
# defecto: focus.go), así que puede cambiar de pestaña sin cortar nada. Mientras corre se anota qué pestaña mira, y al
# final se valida lo que quedó guardado. Uso: jarvis/dev/parallel-demo.sh [segundos entre pasos, 1.5]
cd "$(dirname "$0")/../.."
J=bin/jarvis
API=http://localhost:5203
PAUSE=${1:-1.5}
nap() { perl -e "select(undef,undef,undef,$PAUSE)"; }
check() { curl -s -X POST "$API/api/live/check?tab=$1" -H 'Content-Type: application/json' -d "$(python3 -c 'import json,sys; print(json.dumps({"js":sys.argv[1]}))' "$2")" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok'))"; }
now() { python3 -c 'import time; print(time.time())'; }
since() { python3 -c "import time; print(round(time.time()-$1,1))"; }
open_session() { $J start --group "$1" --color "$2" --url "$3" "$4" 2>&1 | grep -o 'pestaña [0-9]*' | head -1 | awk '{print $2}'; }
view() { curl -s $API/api/chrome | python3 -c "import json,sys; v=json.load(sys.stdin).get('view',{}); print(('Chrome · ' + (v.get('title') or '?')[:60]) if v.get('focused') else 'otra app (Cockpit, Claude…)')"; }

# Cockpit se asegura arriba SIN traerlo al frente: la demo no le quita el foco a lo que la persona tenga abierto. La
# grilla recuerda la vista «Todas»; para abrirla a mano: bin/cockpit open jarvis '#/all'.
bin/cockpit ensure jarvis >/dev/null 2>&1
echo "── abriendo 2 grupos × 3 sesiones (detrás de tu pestaña) ──"
T1=$(open_session 'Tareas' blue 'http://localhost:5207/?reset' 'Tareas · sesión 1: crear 3 tareas')
P1=$(open_session 'Panel Andino' green 'http://localhost:5206/?reset' 'Panel · sesión 1: IVA y nombre de la tienda')
T2=$(open_session 'Tareas' blue 'http://localhost:5207/' 'Tareas · sesión 2: crear 3 tareas')
T3=$(open_session 'Tareas' blue 'http://localhost:5207/' 'Tareas · sesión 3: crear 3 tareas')
P2=$(open_session 'Panel Andino' green 'http://localhost:5206/#/config/usuarios' 'Panel · sesión 2: invitar a 2 usuarios')
P3=$(open_session 'Panel Andino' green 'http://localhost:5206/#/config/usuarios' 'Panel · sesión 3: invitar a 2 usuarios')
echo "Tareas: $T1 $T2 $T3 · Panel Andino: $P1 $P2 $P3"

tasks_worker() { # sesión n
  local id=$1 n=$2
  for j in 1 2 3; do
    $J --session $id think "Creo la tarea $j de 3" >/dev/null 2>&1
    $J --session $id click 'Nueva tarea' >/dev/null 2>&1; nap
    $J --session $id fill 'Título' "Sesión $n · tarea $j" >/dev/null 2>&1
    $J --session $id fill 'Notas' "La creó la sesión $n en paralelo" >/dev/null 2>&1; nap
    r=$($J --session $id click 'Crear tarea' 2>&1); echo "$r" | grep -q '✓' || echo "  ✗ Tareas $id tarea $j: $(echo "$r" | head -1)"
    nap
  done
}
panel_settings() {
  local id=$1
  $J --session $id think 'Cambio el IVA a 16' >/dev/null 2>&1
  $J --session $id goto 'http://localhost:5206/#/config/impuestos' >/dev/null 2>&1; nap
  $J --session $id fill 'IVA (%)' '16' >/dev/null 2>&1; nap
  $J --session $id click 'Guardar' >/dev/null 2>&1; nap
  $J --session $id think 'Ahora el nombre de la tienda' >/dev/null 2>&1
  $J --session $id goto 'http://localhost:5206/#/config/general' >/dev/null 2>&1; nap
  $J --session $id fill 'Nombre de la tienda' 'Tienda Andina · en paralelo' >/dev/null 2>&1; nap
  $J --session $id click 'Guardar' >/dev/null 2>&1; nap
}
panel_invites() {
  local id=$1 n=$2
  for j in a b; do
    $J --session $id think "Invito a p$n$j" >/dev/null 2>&1
    $J --session $id click 'Invitar usuario' >/dev/null 2>&1; nap
    f=$($J --session $id look 2>&1 | awk '/campo +«Correo»/{print $1; exit}')
    $J --session $id fill "$f" "p$n$j@tiendaandina.test" >/dev/null 2>&1; nap
    r=$($J --session $id click 'Enviar invitación' 2>&1); echo "$r" | grep -q '✓' || echo "  ✗ Panel $id p$n$j: $(echo "$r" | head -1)"
    nap
  done
}

echo "── las 6 trabajan a la vez: mirá Cockpit y cambiá de pestaña en Chrome cuando quieras ──"
LOG=$(mktemp -t jarvis-demo-view)
( while true; do echo "$(date +%H:%M:%S) $(view)"; perl -e 'select(undef,undef,undef,0.5)'; done ) > "$LOG" 2>/dev/null &
VIEW=$!
t0=$(now)
pids=()
tasks_worker $T1 1 & pids+=($!)
tasks_worker $T2 2 & pids+=($!)
tasks_worker $T3 3 & pids+=($!)
panel_settings $P1 & pids+=($!)
panel_invites $P2 2 & pids+=($!)
panel_invites $P3 3 & pids+=($!)
wait "${pids[@]}"
kill $VIEW 2>/dev/null; wait $VIEW 2>/dev/null
echo "las 6 terminaron en $(since $t0) s"

echo "── qué quedó ──"
k=$(for c in $(seq 0 9); do [ "$(check $T1 "Object.keys(localStorage).filter(k => k.startsWith('tareas.t.')).map(k => JSON.parse(localStorage.getItem(k))).filter(t => t.titulo.startsWith('Sesión ')).length === $c")" = True ] && echo $c; done)
echo "Tareas: $k de 9 tareas guardadas"
INV="Object.keys(localStorage).filter(k => k.startsWith('panel.inv.')).map(k => JSON.parse(localStorage.getItem(k)))"
inv=$(for c in $(seq 0 4); do [ "$(check $P1 "$INV.filter(i => /^p[23][ab]@/.test(i.correo)).length === $c")" = True ] && echo $c; done)
echo "Panel Andino: IVA 16 → $(check $P1 "JSON.parse(localStorage.getItem('panel.impuestos')||'{}').iva === 16") · nombre → $(check $P1 "JSON.parse(localStorage.getItem('panel.general')||'{}').nombre === 'Tienda Andina · en paralelo'") · invitaciones $inv de 4"
echo "── lo que estuviste mirando mientras corría (cambios) ──"
uniq -f1 "$LOG" | head -40
rm -f "$LOG"
echo "(los grupos quedan abiertos para que los mires; se cierran con: bin/jarvis groups close 'Tareas' --force y 'Panel Andino')"
