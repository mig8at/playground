#!/usr/bin/env bash
# Corre la suite del CODEUDOR —desactivada en el repo desde CORE-431— en un entorno AISLADO.
#
# ⚠ POR QUÉ ESTÁ DESACTIVADA. Sus seis archivos están envueltos en un comentario de bloque para que
# `RefreshDatabase` no tenga a qué engancharse: `phpunit.xml` fija `DB_DATABASE=testing` pero NO
# `DB_CONNECTION`, así que la conexión hereda HOST y driver del `.env`. El 2026-08-19 eso dejó vacía
# la BD compartida de dev+staging. Ver `docs/cosigner/testing.md`.
#
# QUÉ HACE ESTE SCRIPT PARA QUE NO PUEDA PASAR:
#   · usa un schema DESECHABLE del contenedor local (`creditop_testing`), nunca `creditop`;
#   · COMPRUEBA a qué se conectaría ANTES de correr nada, y aborta si no es el esperado — es el paso
#     que lo vuelve seguro, no el archivo `.env.testing`;
#   · usa `DatabaseTransactions` (sólo rollback) en vez de `RefreshDatabase`, porque además el
#     historial de migraciones NO corre limpio desde cero (muere en
#     `2025_02_12_212827_add_insurance_per_million_to_lenders_by_allieds`).
#
# ⚠ Y sqlite en memoria —que sería inmune por construcción— NO sirve: la migración
# `2024_10_01_144533_reorder_creditop_x_requests_history_table` altera columnas y exige doctrine/dbal.
#
# Uso:  bin/tests-codeudor.sh [--preparar]
#       --preparar  crea el schema, le copia la estructura y los catálogos (hacelo una vez)

set -euo pipefail
REPO=~/Desktop/CREDITOP/github/legacy-backend
APP=legacy-backend-laravel.test-1
DB=legacy-backend-mysql-1
SCHEMA=creditop_testing
ENVS=(-e APP_ENV=testing -e DB_CONNECTION=mysql -e DB_HOST=mysql -e DB_DATABASE=$SCHEMA -e DB_USERNAME=root -e DB_PASSWORD=password)

if [ "${1:-}" = "--preparar" ]; then
    echo "  creando $SCHEMA y copiándole estructura + catálogos…"
    docker exec $DB sh -c "mysql -uroot -ppassword -e 'CREATE DATABASE IF NOT EXISTS $SCHEMA'" 2>/dev/null
    docker exec $DB sh -c "mysqldump -uroot -ppassword --no-data --routines=FALSE --triggers=FALSE creditop 2>/dev/null | mysql -uroot -ppassword $SCHEMA" 2>/dev/null || true
    # ⚠ el dump local DIVERGE de las migraciones: `countries` no tiene `cell_phone_length`, que está
    # en la migración ORIGINAL de 2023. Se parcha acá porque los factories la usan.
    docker exec $DB sh -c "mysql -uroot -ppassword $SCHEMA -e 'ALTER TABLE countries ADD COLUMN cell_phone_length INT NULL'" 2>/dev/null || true
    CAT="promissory_types countries paths response_types user_request_statuses allied_types allied_categories cosigner_statuses lender_users_category_types risk_centrals identity_validation_types credit_lines banks signing_providers creditop_x_cutoff_types creditop_x_user_request_statuses country_cities user_profiles"
    docker exec $DB sh -c "mysqldump -uroot -ppassword --no-create-info --complete-insert creditop $CAT 2>/dev/null | mysql -uroot -ppassword $SCHEMA" 2>/dev/null
    echo "  listo"
fi

echo "  ── comprobando a qué se conectaría (aborta si no es el schema desechable) ──"
DEST=$(docker exec "${ENVS[@]}" $APP php -r 'require "/var/www/html/vendor/autoload.php"; $a=require "/var/www/html/bootstrap/app.php"; $a->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); $c=config("database.default"); echo config("database.connections.$c.host"), "/", config("database.connections.$c.database");' 2>/dev/null | tail -1)
echo "     $DEST"
[ "$DEST" = "mysql/$SCHEMA" ] || { echo "  ✗ ABORTA: esperaba mysql/$SCHEMA"; exit 2; }

# Copias temporales sin el comentario de bloque; el original NUNCA se toca.
cd "$REPO"
python3 - <<'PY'
import pathlib, re
d = pathlib.Path('Modules/UserRequestV1/tests/Feature')
for t in d.glob('*TmpTest.php'): t.unlink()
n = 0
for f in sorted(d.glob('*Test.php')):
    l = f.read_text(encoding='utf-8').splitlines()
    ini = None
    for i, x in enumerate(l):
        if x.strip() != '/*': continue
        sig = next((y.strip() for y in l[i+1:i+4] if y.strip()), '')
        if re.match(r'^(use |it\(|describe\(|function |beforeEach\(|test\()', sig): ini = i; break
    fin = next((i for i in range(len(l)-1, 0, -1) if l[i].strip() == '*/'), None)
    if ini is None or fin is None or fin <= ini: continue
    (d / (f.stem + 'TmpTest.php')).write_text(
        "<?php\ndeclare(strict_types=1);\nuse Illuminate\\Foundation\\Testing\\DatabaseTransactions;\n"
        "uses(Tests\\TestCase::class, DatabaseTransactions::class);\n" + "\n".join(l[ini+1:fin]) + "\n",
        encoding='utf-8')
    n += 1
print(f"  {n} archivos reactivados en copias temporales")
PY

docker exec "${ENVS[@]}" $APP ./vendor/bin/pest Modules/UserRequestV1/tests/Feature/ 2>&1 | tail -12
rm -f "$REPO"/Modules/UserRequestV1/tests/Feature/*TmpTest.php
echo "  (copias temporales borradas · los originales quedaron intactos)"
