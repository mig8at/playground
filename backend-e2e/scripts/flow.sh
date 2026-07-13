#!/usr/bin/env bash
# backend-e2e/scripts/flow.sh — orquesta E2E completo: prep + run + get + cleanup opcional.
#
# Hace lo que antes era manual: sembrar precondicionales, correr el flujo, ver el resultado.
# Todo con los subcomandos NATIVOS de backend-e2e (`go run . prep|doctor|get|clean`) — ya no
# depende del creditop-cli (se consolidó en este harness).
#
# USO:
#   scripts/flow.sh <merchant> <lender> [--clean] [--branch=<hash>]
#
# EJEMPLOS:
#   scripts/flow.sh pullman credipullman                       # corre y deja datos
#   scripts/flow.sh pullman credipullman --branch=3e67eade     # branch específico
#   scripts/flow.sh corbeta credifamilia --clean               # limpia al final
#
# REQUIERE:
#   - Go instalado y el módulo de backend-e2e compilable.
#   - Stack local arriba (verifica con `go run . doctor`).

set -euo pipefail

if [ $# -lt 2 ]; then
    cat >&2 <<EOF
Uso: $0 <merchant> <lender> [--clean] [--branch=<hash>]

Argumentos:
  merchant   alias/id/hash del comercio (ej. pullman, 94, 3e67eade)
  lender     alias/id del lender (ej. credipullman, 77)

Flags:
  --clean              Tras correr, limpia el namespace del seed.
  --branch=<hash>      Hash de branch a preferir (default: primer branch activo).

Ejemplo:
  $0 pullman credipullman --branch=3e67eade
EOF
    exit 2
fi

MERCHANT="$1"
LENDER="$2"
shift 2

CLEAN=0
BRANCH_FLAG=""
for arg in "$@"; do
    case "$arg" in
        --clean) CLEAN=1 ;;
        --branch=*) BRANCH_FLAG="--branch=${arg#--branch=}" ;;
        *) echo "Flag desconocido: $arg" >&2; exit 2 ;;
    esac
done

# Todos los `go run .` corren desde la raíz de backend-e2e.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# 1. Health check rápido (no bloquea — solo muestra warnings).
echo "▶ Verificando setup..."
if ! go run . doctor >/dev/null 2>&1; then
    echo "  ⚠ doctor reportó fallas. Detalle:"
    go run . doctor || true
    echo
    echo "  Continúo igual; si el flujo falla, revisá la salida de 'go run . doctor'."
    echo
fi

# 2. Sembrar precondicionales y consumir los exports.
# `prep` separa stdout (exports eval-friendly) de stderr (resumen humano): `$(...)` captura
# solo stdout y el resumen humano (stderr) llega a la pantalla sin redirección extra.
echo "▶ Sembrando precondicionales..."
PREP_OUTPUT=$(go run . prep --merchant "$MERCHANT" --lender "$LENDER" $BRANCH_FLAG)
eval "$PREP_OUTPUT"

if [ -z "${E2E_PARTNER_HASH:-}" ] || [ -z "${E2E_LENDER_ID:-}" ]; then
    echo "✗ prep no produjo E2E_PARTNER_HASH / E2E_LENDER_ID." >&2
    exit 4
fi

echo "  ✓ E2E_PARTNER_HASH=$E2E_PARTNER_HASH"
echo "  ✓ E2E_LENDER_ID=$E2E_LENDER_ID"
echo "  ✓ E2E_COGNITO_ID=$E2E_COGNITO_ID"
echo

# 3. Correr el flujo con los valores sembrados. `tee` muestra en vivo Y guarda el log para
# extraer el último `user_request #NNNN` del cierre.
echo "▶ Corriendo backend-e2e: asesor $E2E_PARTNER_HASH $E2E_LENDER_ID"
TMP_LOG=$(mktemp)
trap 'rm -f "$TMP_LOG"' EXIT
go run . asesor "$E2E_PARTNER_HASH" "$E2E_LENDER_ID" | tee "$TMP_LOG"

# 4. Extraer el user_request_id del output y mostrar snapshot final.
# backend-e2e emite: `✓ user_request #464108 → Estado 11 (Autorizada)`.
LAST_REQ=$(grep -oE 'user_request #[0-9]+' "$TMP_LOG" | tail -1 | grep -oE '[0-9]+' || echo "")

if [ -n "$LAST_REQ" ]; then
    echo
    echo "▶ Snapshot del user_request resultante:"
    go run . get user-request "$LAST_REQ"
fi

# 5. Limpieza opcional del namespace del seed.
if [ "$CLEAN" -eq 1 ]; then
    echo
    echo "▶ Limpiando namespace..."
    go run . clean || true
fi

echo
echo "✓ flow completo."
