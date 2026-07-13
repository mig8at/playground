#!/usr/bin/env bash
# Corre el MCP en modo CLI: sourcea .env.<target> y ejecuta `go run . <args>`.
# Para que UNA regla de permiso autorice los comandos del MCP sin que el classifier pregunte.
# Target: dev (default) | local — vía `--target X` / `--target=X` / E2E_TARGET. El flag se pasa también a go.
#
# Uso:
#   bash backend-mcp/scripts/dev.sh list pullman
#   bash backend-mcp/scripts/dev.sh --target local list pullman
#   bash backend-mcp/scripts/dev.sh create pullman comercial
#   bash backend-mcp/scripts/dev.sh synth 17f7b360 --ecommerce --notify
#   bash backend-mcp/scripts/dev.sh synth-fill <uReqID> [lender]
#   bash backend-mcp/scripts/dev.sh clean --identity
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1   # → backend-mcp

# resolver target (mismo criterio que main.go: --target / E2E_TARGET / default dev)
target="${E2E_TARGET:-dev}"
prev=""
for a in "$@"; do
  [ "$prev" = "--target" ] && target="$a"
  case "$a" in --target=*) target="${a#--target=}";; esac
  prev="$a"
done

envfile=".env.$target"
if [ ! -f "$envfile" ]; then
  echo "✗ falta backend-mcp/$envfile" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$envfile"
set +a
exec go run . "$@"
