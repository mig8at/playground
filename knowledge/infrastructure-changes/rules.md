# Infraestructura: cómo se propone y se aplica un cambio

El repo `infrastructure` (Terraform + Terragrunt) declara los recursos de AWS de las cuentas de
development y producción. Su README es la regla de contribución del equipo de infra y pide pasárselo
a un agente antes de pedirle cambios: lo que sigue lo resume, y ante una duda manda el README de `main`.

## Qué es el repo y qué cuentas maneja

Hay dos ambientes, cada uno en su cuenta y siempre en `us-east-2`: `environments/development` (cuenta
`697767917359`, perfil `creditop-dev`) y `environments/prod` (cuenta `299276669008`, perfil
`creditop-leg`). Cada carpeta de `environments/<ambiente>/` es un stack de Terragrunt independiente; el
backend, el provider y los tags los genera el `root.hcl` del ambiente, no se declaran en cada stack.
La lógica reutilizable vive en `modules/` y los valores de cada ambiente en `environments/`.

## Un cambio entra por PR y se aplica a mano desde main

1. Rama desde `main` actualizado; nunca push directo a `main`.
2. PR. El check `pr-checks.yml` corre pre-commit y `terragrunt run --all plan` del ambiente tocado; el
   plan se revisa entero.
3. Nadie mergea su propio PR sin revisión del equipo de infra.
4. El `apply` es manual: el workflow `deploy-infra.yml` (`workflow_dispatch`, ambiente `production` o
   `development`) sólo aplica desde `refs/heads/main`. Mergear no despliega.

No se corre `terragrunt plan`, `apply` ni `destroy` en local, ni se propone como paso: el trabajo local
es editar archivos. Los cambios en recursos base (VPC, RDS, DynamoDB, S3, KMS, SQS, Cognito, WAF, IAM
compartido) se conversan con infra antes de abrir el PR, y un `destroy` o un reemplazo de un recurso con
datos pide la confirmación explícita del dueño de infra.

## Un PR toca un solo ambiente: primero development, después prod

El job «Guard single environment per PR» de `pr-checks.yml` falla si el PR cambia
`environments/development/**` y `environments/prod/**` a la vez. El orden es: un PR para development,
se aplica y se valida allí, y la promoción a prod va en otro PR que sólo toca `environments/prod`. Al
promover se copia del equivalente de **prod**, no del de development: cambian cuenta, ARNs, hostnames
(`*.production.internal.creditop.com`) y secrets. Un cambio en `modules/**` dispara el plan de los dos
ambientes, y hay que comprobar que el otro no tenga diff inesperado.

## Qué se exige dentro del PR

- Alcance mínimo: sólo lo que el PR necesita; no reordenar listas, reformatear ni «limpiar» código ajeno.
  Las listas se anexan al final (`services[]`) o en orden alfabético (ECR, secrets).
- Sin comentarios nuevos en HCL, YAML ni código; las explicaciones van en la descripción del PR. Los
  comentarios que ya estaban se conservan.
- Sin secretos en el diff: se declara el nombre del secret y el valor se carga fuera del repo.
- IAM de mínimo privilegio, nada interno expuesto a internet, versiones fijas, y README al día en el
  módulo cuyos inputs u outputs cambian.
- pre-commit pasa (`terraform_fmt`, `terragrunt_fmt`, fin de archivo, espacios, conflictos, YAML), y la
  descripción dice qué cambia, por qué y qué se verificó.

## Publicar una ruta en el API Gateway

Las rutas públicas viven en `environments/<ambiente>/api-gateway/terragrunt.hcl`, en la lista `routes`.
Cada una es un objeto con `route_key` (método y ruta pública, por ejemplo
`POST /legacy-api/ecommerce/payment-link`), `method`, `authorizer_name` (`null` cuando la autenticación
la hace el backend, como el token de sucursal de ecommerce; `customer-authorizer` o
`backoffice-authorizer` cuando la hace Cognito) y `request_parameters` con dos sobrescrituras:
`overwrite:header.host` (el servicio interno que contesta, por el ALB interno) y `overwrite:path` (la
ruta en ese servicio, para legacy-backend con `/api/…`). Un parámetro de ruta seguido de más segmentos
se escribe con el `local` del archivo (por ejemplo `${local.order_key_var}`), porque API Gateway ignora
la forma sin llaves.

Un servicio sólo sale por el gateway si su ruta está declarada: que el backend tenga el endpoint
desplegado no basta. Una ruta que falta en el gateway responde 404 aunque el backend la tenga, y la
ruta publicada sin token responde lo que diga el backend (401 en las de ecommerce). Publicar en prod es
el segundo PR del apartado anterior, con host `*.production.internal.creditop.com`.

## En development cada ruta elige su backend

En development el gateway público (`api.dev.creditop.com`) no manda todo `/legacy-api` a una sola rama:
cada ruta fija su `overwrite:header.host`, y en el archivo conviven `legacy-backend.develop.internal…`
(la rama `develop`), `leg-qa.develop.internal…` (la rama `qa`), `leg-lab.develop.internal…` y otros. Para
saber a qué rama pega una ruta pública de development hay que leer el host de esa ruta, no suponerlo por
el dominio. En prod las rutas de legacy van a `legacy-backend.production.internal.creditop.com`.

## Lo que no está en el repo

No todo AWS está en IaC. En prod quedan fuera, entre otros, el cluster ECS (`inertia-production`), el
cache, Cognito y el RDS de inertia; SES, ACM, AWS Organizations e IAM Identity Center son manuales en las
dos cuentas, y el DNS se administra a mano en Cloudflare (un hostname nuevo pide su registro aparte del
PR). Antes de referenciar un recurso con `dependency` hay que confirmar que está en el repo; uno creado
fuera se importa, no se declara como nuevo. La VPC nueva de prod (`creditop-production`) está declarada
pero los servicios siguen en la red anterior mientras dura la migración.
