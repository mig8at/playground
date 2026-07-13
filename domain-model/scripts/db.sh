#!/usr/bin/env bash
# Helper para consultar la BD local (copia de dev). Uso: bash scripts/db.sh "SELECT ... ;"
# Sin args: abre prompt interactivo. Ver CLAUDE.md.
set -uo pipefail
CONTAINER="legacy-backend-mysql-1"
DB="creditop"
if [ "$#" -eq 0 ]; then
  exec docker exec -it "$CONTAINER" mysql -uroot -ppassword "$DB"
else
  docker exec -i "$CONTAINER" mysql -uroot -ppassword "$DB" -e "$*" 2>&1 | grep -v "Using a password"
fi
