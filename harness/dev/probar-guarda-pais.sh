#!/usr/bin/env bash
# Prueba la guarda POR HTTP contra PUT /entidades/{id}, verificando el EFECTO en la base.
#
# Tres trampas que costaron vueltas y quedan escritas para no repetirlas:
#  · Laravel redirige (302) tanto al guardar como al rechazar → el código HTTP no distingue nada.
#    Lo único que distingue es si la fila se movió.
#  · curl NO manda cookies de dominio `.localhost` guardadas en un tarro (`localhost` cuenta como
#    sufijo público), así que el tarro devuelve peticiones ANÓNIMAS y todo parece rechazado. Hay
#    que mandar la cookie a mano con -b "nombre=valor", que siempre se envía.
#  · La sesión y el XSRF tienen que salir de la MISMA emisión; mezclarlas da el redirect de login.
set -uo pipefail
APP=~/Desktop/CREDITOP/github/legacy-application
BASE=http://admin.localhost:8000

SES=$(~/Desktop/CREDITOP/playground/harness/bin/admin-sesion 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin)['value'])")
XSRF_Q=$(curl -s -D - -o /dev/null -b "creditopapplication_session=$SES" "$BASE/entidades" \
  | grep -i '^set-cookie: XSRF-TOKEN=' | head -1 | sed 's/.*XSRF-TOKEN=\([^;]*\).*/\1/')
XSRF=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$XSRF_Q")
COOKIES="creditopapplication_session=$SES; XSRF-TOKEN=$XSRF_Q"

[ -z "$XSRF_Q" ] && { echo "  no salió el XSRF — ¿la sesión autentica?"; exit 1; }

pais_de() { (cd "$APP" && php artisan tinker --execute="echo App\Models\Lender::find($1)->country_id;" 2>/dev/null | grep -oE '^[0-9]+$' | head -1); }
poner_pais() { (cd "$APP" && php artisan tinker --execute="App\Models\Lender::find($1)->forceFill(['country_id'=>$2])->save();" >/dev/null 2>&1); }

caso() {  # $1=titulo  $2=id  $3=inicial  $4=destino  $5=esperado(pasa|frena)
  poner_pais "$2" "$3"
  local cuerpo quedo real marca
  cuerpo=$(cd "$APP" && php artisan tinker --execute="\$__id=$2; \$__pais=$4; require '/tmp/payload.php';" 2>/dev/null | grep -m1 '^{')
  curl -s -o /dev/null -X PUT "$BASE/entidades/$2" -b "$COOKIES" \
    -H "X-XSRF-TOKEN: $XSRF" -H 'Content-Type: application/json' -d "$cuerpo"
  quedo=$(pais_de "$2")
  if [ "$quedo" = "$4" ]; then real="pasa"; else real="frena"; fi
  marca="✗"; [ "$real" = "$5" ] && marca="✓"
  printf "  %s  %-54s quedó en %-4s %s\n" "$marca" "$1" "$quedo" "$real"
}

echo
echo "  ── HOY: las entidades arrastran el país 1, que no opera ──"
caso "Banco de Bogotá (136 comercios) · 1 → Colombia"        5  1  47  pasa
caso "Banco de Bogotá · 1 → Perú (el hueco de la ventana)"   5  1  167 pasa
echo
echo "  ── DESPUÉS del backfill: ya paradas en su país ──"
caso "Banco de Bogotá (con comercios) · Colombia → Perú"     5  47 167 frena
caso "Banco de Bogotá · Colombia → Colombia (no la mueve)"   5  47 47  pasa
caso "Lagobo (sin comercios, CON solicitudes) · Col → Perú"  21 47 167 frena
caso "AV Villas (sin comercios ni solicitudes) · Col → Perú" 2  47 167 pasa
echo
echo "  ── el techo de siempre: mover a un país sin operación ──"
caso "AV Villas · Colombia → Afganistán (no opera)"          2  47 1   frena
