# Comercios en el backoffice nuevo

El backoffice nuevo es la aplicación `apps/backoffice` de `frontend-monorepo`, y es lo que reemplaza al admin de
`legacy-application` (tema [`admin-panel`](knowledge:admin-panel) y, para el alta vieja,
[`merchant-onboarding`](knowledge:merchant-onboarding)). Este tema describe lo que hay en `main` de cada repo. El
trabajo de CORE-562 (crear comercios, agregar entidades, reglas, credenciales y logo desde el backoffice) está en las
ramas `lab`, `develop` y `qa`, y todavía no en `main`. Mientras no se mergee, su mapa vive en las tareas que lo usan,
no acá.

## Quién atiende cada pantalla

El navegador nunca le pega directo a un servicio. El servidor del front (React Router, el «BFF») publica proxies en
`apps/backoffice/app/routes.ts`; para comercios atiende dos:

- `api/backoffice/*` → legacy-backend, con el prefijo `/api/backoffice` (`routes/api-backoffice-proxy.ts`).
- `backoffice/merchant-api-service/*` → `merchant-api` (`routes/api-merchant-api-proxy.ts`).

Además publica `backoffice/access-service/*` y `backoffice/pdf-mapper-service/*` con el mismo esquema. Los proxies usan
`proxyWithStaffToken`: el BFF adjunta el token del usuario de staff, y el navegador no lo ve. El prefijo
`/backoffice/merchant-api-service` es el mismo con que el API gateway publica `merchant-api`
(`providers/merchants/merchant-api-url.ts`, `PREFIJO_DE_MERCHANT_API` / `resolveMerchantApiUpstream`). Fuera de local el
front va siempre al gateway; en local, a `MERCHANT_API_LOCAL_URL`, y sin esa variable el proxy responde 503.

En `main`, las pantallas de comercios son el listado (`merchants`), el alta (`merchants/new`, declarada antes de la ruta
con parámetro para que `new` no entre como id de comercio), la de superadministradores (`merchants/superadmins`), la
ficha (`merchants/:merchantId`) y las reglas por entidad del comercio (`merchants/:merchantId/lenders/:lenderId/rules`).

## Lo que hace legacy-backend con un comercio

`Modules/Backoffice/routes/backoffice.php`, con el prefijo `/api/backoffice`. Todo el grupo exige `cognito.token:staff`
(`EnsureCognitoAccessToken`, registrado en `app/Http/Kernel.php`): un access token Bearer firmado por el pool de
STAFF. También exige `ResolveBackofficeActor` (carga la fila de `users` que el gateway nombra en `x-principal-id` para
que la auditoría sepa quién escribió; sin un actor de staff responde 401), junto con `SetBackofficeAuditActor` y
`TraceBackofficeWrites`.

En `main`, sobre comercios (`Route::prefix('merchants')`):

- `GET /merchants`, `GET /merchants/filter-options`, `GET /merchants/{merchant}`, `GET /merchants/{merchant}/health` y
  `PUT /merchants/{merchant}`: el padrón (el listado trae `missingIntegrations`, las entidades que exigen credencial
  propia y no la tienen en ningún nivel), la ficha, la salud y la edición del comercio.
- `GET /merchants/{merchant}/branches`, `PUT /merchants/{merchant}/branches/{branch}` y `POST /merchants/{merchant}/zones`:
  las sedes, la edición de una y las zonas.
- `GET /merchants/{merchant}/lenders`, `GET /merchants/{merchant}/lenders/available`, `POST /merchants/{merchant}/lenders`,
  `PUT` y `DELETE /merchants/{merchant}/lenders/{lender}` (`updateLenderByAllied`, `removeLender`),
  `GET /merchants/{merchant}/lenders/{lender}/removal-preview`, `GET /merchants/{merchant}/products`,
  `GET/PUT /merchants/{merchant}/activations`, `GET/PUT /merchants/{merchant}/extras` y `GET /merchants/{merchant}/ranking`.
- `GET /merchants/{merchant}/branches/{branch}/rules`, `PUT …/rules/{lender}/bureau`, `PUT …/rules/{lender}/hard`,
  `DELETE /merchants/{merchant}/branches/{branch}/rules/{groupRule}`, `GET /merchants/{merchant}/rule-scopes`,
  `GET/PUT /merchants/{merchant}/lenders/{lender}/rule-scope`, `POST …/rule-scope/reset`, `POST …/rule-scope/normalize`,
  `POST …/bureau-scope/normalize`, `GET /merchants/{merchant}/rules-overview` y `POST …/rules-overview/trigger`.
- `GET/PUT /merchants/{merchant}/lenders/{lender}/credential`, `DELETE …/credential/key`,
  `POST /merchants/{merchant}/lenders/{lender}/integration-request`, `GET/POST /merchants/{merchant}/corporate-users`,
  `GET/POST /merchants/superadmins`, `GET/POST /merchants/{merchant}/test-advisor` (con `…/ecommerce` y `…/password`),
  `GET/POST /merchants/{merchant}/ecommerce`, `PUT/DELETE /merchants/{merchant}/ecommerce/{branch}` y
  `GET /merchants/{merchant}/ecommerce/{branch}/credential`.
- `GET /merchants/{merchant}/logo` (`markerLogo`): lo que el mapa del listado pone dentro del pin;
  `POST /merchants/{merchant}/logo` y `POST /merchants/{merchant}/images/{imagen}` (`updateImage`).
- `POST`, `DELETE` y `PUT …/footnote` en `/merchants/{merchant}/app-banner`: la foto del banner de la app.

No tiene ruta para crear un comercio ni una sede física. merchant-api sí expone su propia creación
(`POST /merchants` y `POST /merchants/:merchant_id/branches`, en `internal/modules/merchant/module.go`).

## La ubicación de las sedes es de merchant-api

`legacy-backend` (`Modules/Backoffice/routes/backoffice.php`) no expone rutas para consultar o escribir ubicaciones de
sedes (`allied_locations`). En `main`, `merchant-api` sirve las ubicaciones (`internal/modules/merchant/module.go`):

- `GET /v1/merchants/:merchant_id/branches/locations`
- `GET /v1/merchants/:merchant_id/branches/:branch_id/location` y `…/location/history`
- `POST …/location/resolve`
- `PUT …/location/confirmation` y `DELETE …/location/confirmation`

Además de `GET /v1/merchants/creditop-x` y `GET /v1/merchants/storefronts`, `merchant-api` también expone el padrón,
alta y edición de comercios y sedes (`GET/POST /v1/merchants`, `PUT /v1/merchants/:merchant_id`,
`GET /v1/merchants/alta-catalogs`, `GET /v1/merchants/filter-options`, `GET /v1/merchants/:merchant_id/cities`,
`POST /v1/merchants/:merchant_id/branches`, `PUT /v1/merchants/:merchant_id/branches/:branch_id`), reglas por sede,
zonas, costos por entidad, imágenes, activaciones, entidades del comercio, `rule-scope`, credenciales, tiendas
(`storefronts`) y gobernanza de disparador.

## El gateway del backoffice

En `infrastructure`, `environments/development/api-gateway-backoffice/terragrunt.hcl` publica
`backoffice-api.dev.creditop.com` (stage `dev`). Las rutas pasan por el authorizer `backoffice-authorizer`, la lambda
`backoffice-cognito-authorizer-development`, que cachea por token y por ruta porque decide ruta por ruta. El gateway
reescribe el host hacia el servicio interno y agrega cuatro cabeceras que salen de lo que devuelve el authorizer:
`x-cognito-identity-id`, `x-cognito-username`, `x-user-profile-id` y `x-principal-id`.

En `development`, esas cuatro cabeceras se declaran una sola vez en el mapa `authorizer_request_parameters` de
`backoffice-authorizer`, y el módulo `api-gateway` las aplica a todas las rutas que usan ese authorizer; cada ruta lleva
solo `overwrite:header.host` y `overwrite:path` (salvo los `POST` de creación e inicio de campañas de WhatsApp, que añaden
`overwrite:header.x-user-id` con `$context.authorizer.principal_id`). En `prod` (`environments/prod/api-gateway-backoffice/terragrunt.hcl`,
`backoffice-api.creditop.com`, stage `prod`, authorizer `backoffice-cognito-authorizer-production`), no existe
`authorizer_request_parameters` y cada ruta protegida repite las cabeceras de identidad en `request_parameters`:
`x-cognito-identity-id` y `x-principal-id` siempre, y `x-user-profile-id` en todas salvo las de `access-service` y las
cinco de ubicación de sucursales de `merchant-api-service` (`…/branches/locations`, `…/{branch_id}/location`,
`…/location/resolve` y el `PUT`/`DELETE` de `…/location/confirmation`); ninguna lleva `x-cognito-username`, y las dos
rutas de campañas de WhatsApp suman `x-user-id`.

- En dev, lo de legacy-backend va al host `leg-lab.develop.internal.creditop.com`: el despliegue de la rama `lab`, no el de
  `develop` ni el de `qa`. La base es la compartida de dev, qa y staging.
- En dev, lo de `merchant-api` va a `merchant-api.develop.internal.creditop.com`.

El front de dev es `backoffice.dev.creditop.com`, y el de producción, `backoffice.creditop.com`, con su gateway
`backoffice-api.creditop.com`.

## Para automatizarlo

Una herramienta que quiera hacer por API lo que hace el backoffice necesita un access token del pool de STAFF y que
su usuario tenga fila de staff en `users`, porque si no, `ResolveBackofficeActor` responde 401. Por el gateway, el
authorizer además decide ruta por ruta. El BFF del front no sirve de atajo: toma el token de la sesión del navegador.
