#!/usr/bin/env bash
# Vuelve el backend de qa al lambda de mocks de centrales ANTERIOR (2026-10-08).
#
# El 2026-10-08 se apuntaron las claves de host de las centrales del secreto `dev/legacy-backend-qa`
# (AGILDATA_HOST, MAREIGUA_HOST, EXPERIAN_HOST, los *_MOCK_HOST y EXPERIAN_OPEN_CUSTOMER_INFO_HOST)
# del lambda `ub79ck0htd` al `9b6r8ticg0`, que es el que despliega risk-services-mockery-lambda y tiene
# el dictado por cédula. Este script invierte ese reemplazo y redespliega el servicio.
#
# Muestra qué cambia y sólo guarda si se escribe `si`. No imprime credenciales: sólo las claves que
# contienen el id del lambda.
#
#   ./revertir-lambda-centrales-qa.sh            # vuelve a ub79ck0htd (el anterior)
#   ./revertir-lambda-centrales-qa.sh --rehacer  # vuelve a aplicar el cambio (9b6r8ticg0)
#
# Pide la sesión AWS del perfil `dev` (cuenta 697767917359).
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-dev}" AWS_REGION="${AWS_REGION:-us-east-2}"
SECRET='dev/legacy-backend-qa'
CLUSTER='inertia-develop'
SERVICE='legacy-backend-qa'
OLD='ub79ck0htd'   # el lambda anterior
NEW='9b6r8ticg0'   # el que despliega el repo, con dictado

FROM="$NEW" TO="$OLD"
[ "${1:-}" = "--rehacer" ] && FROM="$OLD" TO="$NEW"

aws sts get-caller-identity --query Account --output text >/dev/null \
  || { echo "sin sesión AWS para el perfil $AWS_PROFILE: corré 'aws sso login --profile $AWS_PROFILE'"; exit 1; }

echo "secreto $SECRET: $FROM -> $TO"
SECRET="$SECRET" FROM="$FROM" TO="$TO" python3 - <<'EOF'
import json, os, subprocess, sys
sid, frm, to = os.environ['SECRET'], os.environ['FROM'], os.environ['TO']
d = json.loads(subprocess.check_output(['aws', 'secretsmanager', 'get-secret-value', '--secret-id', sid,
                                        '--query', 'SecretString', '--output', 'text']))
ch = {k: v.replace(frm, to) for k, v in d.items() if isinstance(v, str) and frm in v}
if not ch:
    print(f'ninguna clave apunta a {frm}: no hay nada que cambiar'); sys.exit(2)
for k, v in ch.items():
    print(f'  {k}: {d[k]} -> {v}')
if input('aplicar? (si/no) ') != 'si':
    print('no se cambió nada'); sys.exit(2)
d.update(ch)
subprocess.check_call(['aws', 'secretsmanager', 'put-secret-value', '--secret-id', sid,
                       '--secret-string', json.dumps(d)], stdout=subprocess.DEVNULL)
print('secreto guardado')
EOF

# ECS lee los secretos al arrancar la tarea: sin redesplegar, el backend sigue con los hosts de antes.
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment \
  --query 'service.deployments[0].rolloutState' --output text
echo "redespliegue de $SERVICE en curso; mirá cuándo termina con:"
echo "  aws ecs describe-services --cluster $CLUSTER --services $SERVICE --query 'services[0].deployments[0].rolloutState' --output text"
