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

## Un cambio entra por PR; development e internal se aplican al mergear, prod a mano

1. Rama desde `main` actualizado; nunca push directo a `main`.
2. PR. Cada ambiente tiene su workflow (`development.yml`, `production.yml`, `internal.yml`), que se dispara en el PR por los paths de su ambiente (`environments/development/**`, `environments/prod/**` o `environments/internal/**`) o por `modules/**`. En el PR corren primero `pre-commit.yml` y `guard-single-environment.yml`, y sólo si los dos pasan, `terragrunt run --all plan` de ese ambiente (`terragrunt-run.yml`); el plan se revisa entero.
3. Nadie mergea su propio PR sin revisión del equipo de infra. Los cambios en `.github/` tienen dueño en `CODEOWNERS` (`@Creditop-SAS/admins`).
4. El `apply` depende del ambiente. En **development** e **internal**, mergear SÍ despliega: el push a `main` que toca sus paths (o `modules/**`) corre `terragrunt run --all apply` solo, y también se puede lanzar a mano (`workflow_dispatch`) desde `refs/heads/main`. En **production** el workflow del PR (`production.yml`, «Production Plan») sólo hace el plan: el apply está aparte, en `production-apply.yml`, que se lanza a mano (`workflow_dispatch`) y sólo aplica desde `refs/heads/main`; mergear no despliega prod. Los applies de un mismo ambiente se serializan (`concurrency` por ambiente, sin cancelar el que está en curso).

No se corre `terragrunt plan`, `apply` ni `destroy` en local, ni se propone como paso: el trabajo local es editar archivos. Como en development e internal el merge aplica, el plan del PR es la última revisión antes de que el cambio llegue a la cuenta. Los cambios en recursos base (VPC, RDS, DynamoDB, S3, KMS, SQS, Cognito, WAF, IAM compartido) se conversan con infra antes de abrir el PR, y un `destroy` o un reemplazo de un recurso con datos pide la confirmación explícita del dueño de infra.

## Un PR toca un solo ambiente: primero development, después prod

El workflow reutilizable `guard-single-environment.yml` (job «Guard single environment per PR»), que llama cada workflow de ambiente en el PR, falla si el PR cambia `environments/development/**` y `environments/prod/**` a la vez, o `environments/internal/**` junto con cualquiera de los otros dos. Si falla, el plan no corre (depende del guard y de pre-commit). El orden es: un PR para development, se aplica (al mergear) y se valida allí, y la promoción a prod va en otro PR que sólo toca `environments/prod`. Al promover se copia del equivalente de **prod**, no del de development: cambian cuenta, ARNs, hostnames (`*.production.internal.creditop.com`) y secrets.

Un cambio en `modules/**` dispara el plan de los tres ambientes (development, production e internal: los tres workflows incluyen `modules/**` en sus paths), y hay que comprobar que ninguno tenga diff inesperado. Al mergearlo se aplica solo en development e internal; prod espera su `workflow_dispatch`.

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

Las rutas públicas viven en `environments/<ambiente>/api-gateway/terragrunt.hcl` y
`environments/<ambiente>/api-gateway-backoffice/terragrunt.hcl`, dos unidades del mismo módulo `modules/api-gateway`,
repartidas en cuatro listas de `inputs`: `routes`, `routes_customers`, `routes_backoffice_legacy` y `routes_backoffice`.
En `prod`, `api-gateway` lleva sólo `routes` y `routes_customers`, y las dos de backoffice (con las
`/legacy-api/auth/…`) están en `api-gateway-backoffice`; en `development`, `api-gateway` todavía lleva las cuatro. El
módulo las junta con `concat` y las indexa por `route_key`; se separan para que cada input quede bajo el límite de
128 KB de una variable de entorno. Las de legacy-backend para ecommerce, mobile-onboarding y `debt-summary` están en
`routes`. Cada ruta es un objeto con `route_key` (método y ruta pública, por ejemplo
`POST /legacy-api/ecommerce/payment-link`), `method`, `authorizer_name` (`null` cuando la autenticación la hace el
backend, como el token de sucursal de las rutas server-to-server de ecommerce; `customer-authorizer` o
`backoffice-authorizer` cuando la hace Cognito) y `request_parameters` con dos sobrescrituras: `overwrite:header.host`
(el servicio interno que contesta, por el ALB interno) y `overwrite:path` (la ruta en ese servicio, para legacy-backend
con `/api/…`). Un parámetro de ruta seguido de más segmentos se escribe con el `local` del archivo (por ejemplo
`${local.order_key_var}`, `${local.placement_var}` o `${local.user_request_id_var}`), porque API Gateway ignora la
forma sin llaves.

Las rutas con `customer-authorizer` cuyo backend confía en la identidad que le llega (por ejemplo las de
`/legacy-api/v1/mobile-onboarding/…` y `POST /legacy-api/v1/mobile/ecommerce/store-link`) agregan dos
sobrescrituras más, tomadas del contexto del authorizer: `overwrite:header.x-user-id`
(`$context.authorizer.internal_id`) y `overwrite:header.x-cognito-identity-id` (`$context.authorizer.cognito_sub`).
Así un valor mandado por quien llama no llega al backend. No todas las rutas de cliente las llevan:
`GET /legacy-api/loans/debt-summary` arma la ruta con `internal_id_expr` en `overwrite:path`, y las de
`/legacy-api/loans/requests/…` no pasan la identidad.

La identidad que se pasa depende del servicio. Las rutas de form-service con `customer-authorizer`
(`/customers/form-service/v1/app-forms/{placement}` y `…/responses`, en prod) pasan sólo
`overwrite:header.X-User-Id`, sin `x-cognito-identity-id`. Las rutas de backoffice de merchant-api del `api-gateway`
de development (`/backoffice/merchant-api-service/v1/merchants/{merchant_id}/branches/…`, la ubicación de
sucursales) usan `backoffice-authorizer` y sobrescriben `x-cognito-identity-id` (`$context.authorizer.cognito_sub`) y
`x-principal-id` (`$context.authorizer.principal_id`), no `x-user-id`. Las de merchant onboarding
(`…/v1/onboarding-catalog` y `…/v1/admin/merchant-onboardings/…`) no están en `api-gateway`: viven en la unidad
`api-gateway-backoffice`, donde además sobrescriben `x-user-profile-id` (`$context.authorizer.user_profile_id`).

En `environments/prod`, las rutas de cliente bajo `/legacy-api/loans/customer/…` (consumer, revolving —incluida
`GET …/revolving/credits/{revolving_credit_id}/payment-info`— y `customer/payments/{reference}` con su `/receipt`)
pasan esas mismas dos cabeceras con `overwrite:header.x-user-id` y `overwrite:header.x-cognito-identity-id`, igual que
`v1/mobile-onboarding` y `v1/mobile/ecommerce/store-link`. Las demás rutas de cliente de `routes` y `routes_customers`
que pasan identidad (`onboarding/mobile/user-data`, `delete-user`, financial-health, `merchant-api-service/…/creditop-x`,
preapprovals, self-manager-api) usan `overwrite:header.X-User-Id`. En `api-gateway` de prod no queda ninguna con
`append:`, que agrega el valor del contexto al de la cabecera que ya venga en vez de reemplazarlo y por eso no da la
garantía de `overwrite:`.

Un servicio sólo sale por el gateway si su ruta está declarada: que el backend tenga el endpoint desplegado no basta.
Una ruta que falta en el gateway responde 404 aunque el backend la tenga, y la ruta publicada sin token responde lo que
diga el backend (401 en las de ecommerce con token de sucursal; las de ecommerce con `customer-authorizer` las rechaza
el authorizer antes de llegar al backend). Publicar en prod es el segundo PR del apartado anterior, con host
`*.production.internal.creditop.com`.

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
