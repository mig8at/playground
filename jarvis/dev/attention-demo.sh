#!/bin/bash
# DEMO del aviso de atención: tres sesiones en la app de práctica «Verificación» (:5208) llegan a un paso que necesita
# a la persona —el código que «llega al celular» y después «mantené apretado»— y lo avisan (bin/jarvis attention):
# 🔔 en su pestaña, su grupo «⚠ Verificación» en rojo, el número en el ícono de Jarvis y la tarjeta con borde rojo en
# Cockpit. La persona las resuelve (en Chrome o en Cockpit, abriéndola en grande); el script va actualizando el motivo
# según el paso y lo borra cuando esa sesión queda verificada. Uso: jarvis/dev/attention-demo.sh [N, 3] [minutos, 5]
cd "$(dirname "$0")/../.."
J=bin/jarvis
API=http://localhost:5203
N=${1:-3}; MAX=${2:-5}
check() { curl -s -X POST "$API/api/live/check?tab=$1" -H 'Content-Type: application/json' -d "$(python3 -c 'import json,sys; print(json.dumps({"js":sys.argv[1]}))' "$2")" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok'))"; }
step() { # en qué paso está la página de la sesión
  for s in done hold code login; do [ "$(check $1 "!document.getElementById('step-$s').hidden")" = True ] && { echo $s; return; }; done; echo "?"; }
ids=()
for i in $(seq 1 $N); do
  url=http://localhost:5208/; [ $i = 1 ] && url='http://localhost:5208/?reset'
  id=$($J start --group 'Verificación' --color purple --url "$url" "Ingresar como s$i@ejemplo.test" 2>&1 | grep -o 'pestaña [0-9]*' | head -1 | awk '{print $2}')
  $J --session $id fill 'Correo' "s$i@ejemplo.test" >/dev/null 2>&1
  $J --session $id click 'Enviar código' >/dev/null 2>&1
  $J --session $id attention "Necesito el código que te llegó al celular (s$i@ejemplo.test): está en http://localhost:5208/phone.html" >/dev/null
  ids+=($id)
done
echo "sesiones ${ids[*]}: las $N te necesitan. Resolvelas en Chrome (🔔) o en Cockpit (borde rojo)."
last=()
t0=$(date +%s)
while :; do
  pending=0
  for idx in "${!ids[@]}"; do
    id=${ids[$idx]}; n=$((idx+1)); s=$(step $id)
    case $s in
      code) want="Necesito el código que te llegó al celular (s$n@ejemplo.test): está en http://localhost:5208/phone.html" ;;
      hold) want="Mantené apretado el botón 2 segundos (s$n@ejemplo.test)" ;;
      done) want="" ;;
      *) want="Algo raro en la sesión $id: está en «$s»" ;;
    esac
    [ -n "$want" ] && pending=$((pending+1))
    if [ "${last[$idx]}" != "$s" ]; then
      last[$idx]=$s
      if [ -n "$want" ]; then $J --session $id attention "$want" >/dev/null; echo "$(date +%H:%M:%S) sesión $id → $s: avisa «$want»"
      else $J --session $id attention --clear >/dev/null; echo "$(date +%H:%M:%S) sesión $id → verificada: ya no te necesita"; fi
    fi
  done
  [ $pending = 0 ] && { echo "las $N verificadas en $(( $(date +%s) - t0 )) s"; break; }
  [ $(( $(date +%s) - t0 )) -gt $((MAX*60)) ] && { echo "pasaron $MAX minutos: quedan $pending sin verificar"; break; }
  perl -e 'select(undef,undef,undef,1)'
done
echo "(el grupo queda abierto; se cierra con: bin/jarvis groups close 'Verificación' --force)"
