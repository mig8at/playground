#!/bin/bash
# Prueba de paralelismo con DOS grupos, cada uno en su herramienta, y todas sus sesiones actuando a la vez:
#   «Tareas» (la demo de tareas, :5207): 3 sesiones crean una tarea cada una;
#   «Panel Andino» (:5206): una cambia el IVA a 16 y dos invitan a un usuario cada una (secciones distintas del mismo
#   estado: un guardado no tiene que pisar el de otra sección).
# Al final valida lo que quedó en el localStorage de cada app y lo que muestra cada pantalla, y cierra los dos grupos.
# Uso: jarvis/dev/two-groups.sh. Necesita las apps de práctica y la extensión conectada.
cd "$(dirname "$0")/../.."
J=bin/jarvis
API=http://localhost:5203
check() { curl -s -X POST "$API/api/live/check?tab=$1" -H 'Content-Type: application/json' -d "$(python3 -c 'import json,sys; print(json.dumps({"js":sys.argv[1]}))' "$2")" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok'))"; }
now() { python3 -c 'import time; print(time.time())'; }
since() { python3 -c "import time; print(round(time.time()-$1,1))"; }
open_session() { # grupo url meta → id
  $J start --group "$1" --url "$2" "$3" 2>&1 | grep -o 'pestaña [0-9]*' | head -1 | awk '{print $2}'
}
ok() { echo "$1" | grep -q '✓' && echo bien || echo "FALLÓ: $(echo "$1" | head -1)"; }

echo "── abriendo los dos grupos (la primera de cada app parte de ?reset) ──"
T1=$(open_session 'Tareas' 'http://localhost:5207/?reset' 'tarea 1 en paralelo')
T2=$(open_session 'Tareas' 'http://localhost:5207/' 'tarea 2 en paralelo')
T3=$(open_session 'Tareas' 'http://localhost:5207/' 'tarea 3 en paralelo')
P1=$(open_session 'Panel Andino' 'http://localhost:5206/?reset' 'cambiar el IVA a 16')
P2=$(open_session 'Panel Andino' 'http://localhost:5206/#/config/usuarios' 'invitar a p2')
P3=$(open_session 'Panel Andino' 'http://localhost:5206/#/config/usuarios' 'invitar a p3')
$J --session $P1 goto 'http://localhost:5206/#/config/impuestos' >/dev/null 2>&1
echo "Tareas: sesiones $T1 $T2 $T3 · Panel Andino: sesiones $P1 $P2 $P3"
$J groups | sed -n '1,12p'

echo "── las 6 actúan a la vez ──"
t0=$(now)
for n in 1 2 3; do
  id=$(eval echo \$T$n)
  ( s=$(now); a=$($J --session $id click 'Nueva tarea' 2>&1); f=$($J --session $id fill 'Título' "Tarea del grupo, sesión $n" 2>&1)
    r=$($J --session $id click 'Crear tarea' 2>&1); echo "  Tareas · sesión $id: «Tarea del grupo, sesión $n» → abrir $(ok "$a"), título $(ok "$f"), crear $(ok "$r") en $(since $s) s" ) &
done
( s=$(now); f=$($J --session $P1 fill 'IVA (%)' '16' 2>&1); r=$($J --session $P1 click 'Guardar' 2>&1)
  echo "  Panel · sesión $P1: IVA a 16 → campo $(ok "$f"), guardar $(ok "$r") en $(since $s) s" ) &
for n in 2 3; do
  id=$(eval echo \$P$n)
  ( s=$(now); a=$($J --session $id click 'Invitar usuario' 2>&1)
    # «Correo» aparece dos veces en esa pantalla (la columna de la tabla y el campo): se apunta al campo por su número.
    f=$($J --session $id fill "$($J --session $id look 2>&1 | awk '/campo +«Correo»/{print $1; exit}')" "p$n@tiendaandina.test" 2>&1)
    r=$($J --session $id click 'Enviar invitación' 2>&1)
    echo "  Panel · sesión $id: invitar a p$n → abrir $(ok "$a"), correo $(ok "$f"), enviar $(ok "$r") en $(since $s) s" ) &
done
wait
echo "las 6 terminaron en $(since $t0) s"

echo "── qué quedó ──"
k=$(for c in 0 1 2 3; do [ "$(check $T1 "Object.keys(localStorage).filter(k => k.startsWith('tareas.t.')).map(k => JSON.parse(localStorage.getItem(k))).filter(t => t.titulo.startsWith('Tarea del grupo')).length === $c")" = True ] && echo $c; done)
echo "Tareas: en el localStorage quedaron $k de 3"
for id in $T1 $T2 $T3; do
  c=$(for c in 0 1 2 3; do [ "$(check $id "[...document.querySelectorAll('#lista strong')].filter(e => e.textContent.startsWith('Tarea del grupo')).length === $c")" = True ] && echo $c; done)
  echo "  la pantalla de la sesión $id muestra $c"
done
INV="Object.keys(localStorage).filter(k => k.startsWith('panel.inv.')).map(k => JSON.parse(localStorage.getItem(k)))"
iva=$(check $P1 "JSON.parse(localStorage.getItem('panel.impuestos')||'{}').iva === 16"); p2=$(check $P1 "$INV.some(i => i.correo === 'p2@tiendaandina.test')"); p3=$(check $P1 "$INV.some(i => i.correo === 'p3@tiendaandina.test')")
echo "Panel Andino: IVA en 16 → $iva · invitación de p2 → $p2 · invitación de p3 → $p3"
for id in $P2 $P3; do
  c=$(for c in 0 1 2; do [ "$(check $id "[...document.querySelectorAll('td')].filter(e => /^p[23]@tiendaandina/.test(e.textContent)).length === $c")" = True ] && echo $c; done)
  echo "  la pantalla de usuarios de la sesión $id muestra $c de 2 invitaciones"
done
$J groups close 'Tareas' --force >/dev/null 2>&1; $J groups close 'Panel Andino' --force >/dev/null 2>&1
echo "grupos cerrados"
