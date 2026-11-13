#!/usr/bin/env bash
# Agrega, cambia o quita claves del secreto JSON de la app de Shopify en AWS Secrets Manager, sin mostrar valores.
#
#   ./secret-keys.sh <perfil> <secreto> CLAVE=valor [...] [-CLAVE ...]
#
#   ./secret-keys.sh dev dev/shopify-app CREDITOP_API_URL=https://v2.api.creditop.com/legacy-api   # modo dev-prod
#   ./secret-keys.sh dev dev/shopify-app -CREDITOP_API_URL                                         # volver a qa
#
# Lee el JSON actual, aplica los cambios y escribe una versión nueva (Secrets Manager guarda la anterior como
# AWSPREVIOUS). Sólo imprime los NOMBRES de las claves. El servicio no toma el cambio hasta un despliegue nuevo.
set -euo pipefail

[ $# -ge 3 ] || { sed -n '2,10p' "$0"; exit 2; }
profile=$1 secret=$2; shift 2
command -v jq >/dev/null || { echo "falta jq (brew install jq)"; exit 2; }

current=$(aws secretsmanager get-secret-value --profile "$profile" --secret-id "$secret" --query SecretString --output text)
echo "$current" | jq -e 'type == "object"' >/dev/null || { echo "el secreto $secret no es un JSON de claves"; exit 1; }

updated=$current
for change in "$@"; do
  case "$change" in
    -*)  key=${change#-}; updated=$(echo "$updated" | jq --arg k "$key" 'del(.[$k])'); echo "  − $key" ;;
    *=*) key=${change%%=*}; value=${change#*=}
         updated=$(echo "$updated" | jq --arg k "$key" --arg v "$value" '.[$k] = $v'); echo "  ✓ $key" ;;
    *)   echo "no entiendo «$change»: va CLAVE=valor o -CLAVE"; exit 2 ;;
  esac
done

echo "claves de $secret después del cambio: $(echo "$updated" | jq -r 'keys | join(", ")')"
read -r -p "¿Escribo la versión nueva de $secret con el perfil $profile? [s/N] " ok
[ "$ok" = s ] || { echo "no se escribió nada"; exit 0; }
aws secretsmanager put-secret-value --profile "$profile" --secret-id "$secret" --secret-string "$updated" --query VersionId --output text >/dev/null
echo "listo: $secret actualizado. Falta un despliegue nuevo del servicio para que lo tome."
