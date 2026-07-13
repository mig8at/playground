#!/usr/bin/env bash
# loki-check.sh — valida conexión a Grafana Cloud Loki y confirma que el
# tráfico del servicio llegó (útil para cerrar el loop con el validator).
#
# Credenciales por variable de entorno (NO se hardcodean):
#   LOKI_URL    URL base de Loki, ej: https://logs-prod-XX.grafana.net
#   LOKI_USER   User / Instance ID de Loki (lo da grafana.com -> stack -> Send Logs)
#   LOKI_TOKEN  Access Policy token con scope logs:read
#
# Opcionales:
#   SERVICE     nombre del servicio (default: pdf-mapper-service)
#   RANGE       ventana de tiempo LogQL (default: 1h)
#
# Uso:
#   export LOKI_URL=... LOKI_USER=... LOKI_TOKEN=...
#   ./loki-check.sh
set -euo pipefail

SERVICE="${SERVICE:-pdf-mapper-service}"
RANGE="${RANGE:-1h}"

: "${LOKI_URL:?define LOKI_URL (ej: https://logs-prod-XX.grafana.net)}"
: "${LOKI_USER:?define LOKI_USER (instance/user id de Loki)}"
: "${LOKI_TOKEN:?define LOKI_TOKEN (access policy token con logs:read)}"

LOKI_URL="${LOKI_URL%/}"
AUTH=(-u "${LOKI_USER}:${LOKI_TOKEN}")
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "▶ [1/3] Conexión a Loki (${LOKI_URL}) ..."
code=$(curl -s -o "$TMP" -w '%{http_code}' "${AUTH[@]}" "${LOKI_URL}/loki/api/v1/labels") || true
if [ "$code" != "200" ]; then
  echo "❌ Falló la conexión o las credenciales (HTTP ${code})"
  echo "   Respuesta:"; sed 's/^/   /' "$TMP" 2>/dev/null | head -5
  exit 1
fi
echo "✅ Conexión OK (HTTP 200). Labels disponibles:"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("   "+", ".join(d.get("data",[])[:20]))' "$TMP"

echo "▶ [2/3] Tráfico del servicio '${SERVICE}' (últimos ${RANGE}) ..."
curl -s -G "${AUTH[@]}" "${LOKI_URL}/loki/api/v1/query" \
  --data-urlencode "query=sum(count_over_time({service_name=\"${SERVICE}\"} |~ \"http request completed\" [${RANGE}]))" \
  -o "$TMP"
python3 - "$TMP" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
res = d.get("data", {}).get("result", [])
if not res:
    print("   ⚠️  0 peticiones encontradas. ¿Corriste el validator apuntando a este entorno?")
else:
    total = res[0]["value"][1]
    print(f"   ✅ {total} peticiones 'http request completed' en la ventana.")
PY

echo "▶ [3/3] Desglose por status_code (últimos ${RANGE}) ..."
curl -s -G "${AUTH[@]}" "${LOKI_URL}/loki/api/v1/query" \
  --data-urlencode "query=sum by (status_code) (count_over_time({service_name=\"${SERVICE}\"} |~ \"http request completed\" [${RANGE}]))" \
  -o "$TMP"
python3 - "$TMP" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
res = d.get("data", {}).get("result", [])
if not res:
    print("   (sin datos por status_code)")
else:
    rows = sorted(((r["metric"].get("status_code", "?"), r["value"][1]) for r in res))
    for code, count in rows:
        print(f"   {code} : {count}")
PY

echo "──────────────────────────────────────────────"
echo "✅ Listo. Si ves conteos, el tráfico está llegando a Loki y el dashboard reaccionará."
