#!/usr/bin/env bash
# base64.sh — genera la URL de CHECKOUT ecommerce (contrato base64 COMPLETO) para probar el flujo a mano.
#
# Para QA: NO necesita node, base de datos ni el harness. Solo bash (ya viene en mac/linux).
# Arma el contrato con TODOS los campos —orden, monto, moneda, productos, y billing del comprador
# (documento/cédula, tipo, nombre, apellido, email, teléfono)— más return_url, webhook y token,
# igual que el backend real, y devuelve la URL lista para pegar en el navegador.
#
# Defaults: comercio PULLMAN (después elegís CrediPullman en el wizard). Enter acepta cada default.
#
# Uso:   ./base64.sh            (interactivo, defaults de Pullman)
#        bash base64.sh
set -euo pipefail

ask() { local p="$1" d="${2:-}" v=""; read -r -p "  $p${d:+ [$d]}: " v || true; printf '%s' "${v:-$d}"; }

# --- phpSerialize (string con longitud en BYTES, claves ya ordenadas) + base64 + URL-encode ---
ser_s() { local s="${1:-}" n; n=$(printf '%s' "$s" | wc -c | tr -d '[:space:]'); printf 's:%s:"%s";' "$n" "$s"; }
ser_i() { printf 'i:%s;' "$1"; }
b64()   { printf '%s' "${1:-}" | base64 | tr -d '\n'; }            # base64 sin saltos de línea
urlb64(){ b64 "${1:-}" | sed 's/+/%2B/g; s/\//%2F/g; s/=/%3D/g'; } # base64 + URL-encode (+ / =)

echo "── Generar URL de checkout ecommerce (contrato completo) · default: Pullman / CrediPullman ──"
# sucursal + credencial (defaults: branch ecommerce de Pullman en dev)
HASH="$(ask 'Hash de la sucursal' '13874eb6')"
TOKEN="$(ask 'Token ecommerce (credential)' '39343133383734656236323032342d31322d3130')"
# orden
AMOUNT="$(ask 'Monto' '600000')"
# billing del comprador → se pre-llena (y bloquea) en personal-info del wizard
PHONE="$(ask 'Telefono (OTP = ultimos 4 si esta en bypass)' '3131010101')"
DOC="$(ask 'Documento / cedula' '1032456789')"
DOCTYPE="$(ask 'Tipo de documento' 'CC')"
NAME="$(ask 'Nombre' 'SYNTH')"
SURNAME="$(ask 'Apellido' 'ECOM')"
EMAIL="$(ask 'Email' 'synth-ecom@creditop.com')"
# urls
RETURN_URL="$(ask 'Return URL (boton volver al comercio)' 'https://tienda-mcp.test/return')"
WEBHOOK_URL="$(ask 'Webhook / notificacion (status final)' 'https://tienda-mcp.test/webhook')"
# OJO: la migración (ruta /ecommerce/.../checkout, #551) corre en el wizard LOCAL (localhost:5174, build de
# develop). El deploy de dev (originaciones.dev.creditop.com) aún NO la tiene → ahí da 404. Default = local.
WIZ="$(ask 'Base del wizard' 'http://localhost:5174')"

[ -n "$HASH" ] && [ -n "$TOKEN" ] || { echo "✗ hash y token son obligatorios" >&2; exit 2; }

# webhook con '/' final: la branch Woo le concatena el order_identifier → cae en .../{token}/{orderId}
case "$WEBHOOK_URL" in */) ;; *) WEBHOOK_URL="$WEBHOOK_URL/";; esac

# productos de mentiras (2 ítems que suman el total), igual que el contrato real
BIG=$(( (AMOUNT * 7 + 5) / 10 )); REST=$(( AMOUNT - BIG ))
PRODUCTS="[{\"product_id\":101,\"name\":\"Smartphone Demo X\",\"sku\":\"SKU-DEMO-X\",\"price\":\"${BIG}\",\"quantity\":1},{\"product_id\":102,\"name\":\"Funda + protector de pantalla\",\"sku\":\"SKU-ACC-01\",\"price\":\"${REST}\",\"quantity\":1}]"

# billing (claves ordenadas): document_number, document_type, email, first_name, last_name, phone
BILLING="a:6:{$(ser_s document_number)$(ser_s "$DOC")$(ser_s document_type)$(ser_s "$DOCTYPE")$(ser_s email)$(ser_s "$EMAIL")$(ser_s first_name)$(ser_s "$NAME")$(ser_s last_name)$(ser_s "$SURNAME")$(ser_s phone)$(ser_s "$PHONE")}"
# order (claves ordenadas): billing, currency, id, order_key, total
ORDER="a:5:{$(ser_s billing)${BILLING}$(ser_s currency)$(ser_s COP)$(ser_s id)$(ser_i 5002)$(ser_s order_key)$(ser_s "wc_mcp_${HASH}")$(ser_s total)$(ser_s "$AMOUNT")}"

O="$(urlb64 "$ORDER")"
P="$(urlb64 "$PRODUCTS")"
T="$(urlb64 "$TOKEN")"                       # token = b64(credential)
U="$(urlb64 "$(ser_s "$RETURN_URL")")"       # returnUrl va phpSerializado
PS="$(urlb64 "$WEBHOOK_URL")"                # processUrl/webhook va crudo
CFG="$(urlb64 "$(ser_s '[]')")"              # config = phpSerialize("[]")

URL="${WIZ%/}/ecommerce/${HASH}/checkout?o=${O}&p=${P}&t=${T}&u=${U}&ps=${PS}&config=${CFG}"

echo
echo "  Comercio:  $HASH   ·   Monto: $AMOUNT COP"
echo "  Comprador: $NAME $SURNAME · $DOCTYPE $DOC · $EMAIL · tel $PHONE (OTP ${PHONE: -4})"
echo "  Productos: Smartphone Demo X (\$$BIG) + Funda + protector de pantalla (\$$REST)"
echo "  Return:    $RETURN_URL"
echo "  Webhook:   $WEBHOOK_URL"
echo
echo "  URL de checkout (pegá en el navegador):"
echo "  $URL"
echo
