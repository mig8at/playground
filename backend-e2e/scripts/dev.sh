#!/usr/bin/env bash
# Corre el harness contra DEV: sourcea .env.dev (E2E_DB_*, guard, SEED, cliente de prueba) y
# ejecuta `go <args>`. Existe para que UNA sola regla de permiso (settings.local.json) autorice
# los comandos dev sin que el auto-mode classifier pregunte cada vez.
#
# Uso:
#   bash backend-e2e/scripts/dev.sh test ./pkg/database/ -run TestOtpBypass -v -count=1
#   bash backend-e2e/scripts/dev.sh run . create --target=dev comercial pullman
#
# Robusto al cwd: resuelve su propio directorio (backend-e2e) antes de sourcear.
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1   # → backend-e2e
if [ ! -f .env.dev ]; then
  echo "✗ falta backend-e2e/.env.dev" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env.dev
set +a
exec go "$@"
