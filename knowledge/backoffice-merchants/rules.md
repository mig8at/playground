# Comercios en el backoffice nuevo

El backoffice nuevo es la aplicación `apps/backoffice` de `frontend-monorepo`, y es lo que reemplaza al admin de
`legacy-application` (tema [`admin-panel`](knowledge:admin-panel) y, para el alta vieja,
[`merchant-onboarding`](knowledge:merchant-onboarding)). Este tema describe lo que hay en `main` de cada repo. El
trabajo de CORE-562 (crear comercios, agregar entidades, reglas, credenciales y logo desde el backoffice) está en las
ramas `lab`, `develop` y `qa`, y todavía no en `main`. Mientras no se mergee, su mapa vive en las tareas que lo usan,
no acá.

## Quién atiende cada pantalla

El navegador nunca le pega directo a un servicio. El servidor del front (React Router, el «BFF») publica dos proxies
en `apps/backoffice/app/routes.ts`:

- `api/backoffice/*` → legacy-backend, con el prefijo `/api/backoffice` (`routes/api-backoffice-proxy.ts`).
- `backoffice/merchant-api-service/*` → `merchant-api` (`routes/api-merchant-api-proxy.ts`).

Los dos usan `proxyWithStaffToken`: el BFF adjunta el token del usuario de staff, y el navegador no lo ve. El prefijo
`/backoffice/merchant-api-service` es el mismo con que el API gateway publica `merchant-api`
(`providers/merchants/merchant-api-url.ts`). Fuera de local el front va siempre al gateway; en local, a
`MERCHANT_API_LOCAL_URL`, y sin esa variable el proxy responde 503.

En `main`, las pantallas de comercios son el listado (`merchants`) y la ficha (`merchants/:merchantId`). No hay
pantalla de alta.

## Lo que hace legacy-backend con un comercio

`Modules/Backoffice/routes/backoffice.php`, con el prefijo `/api/backoffice`. Todo el grupo exige
`cognito.token:staff` (`EnsureCognitoAccessToken`, registrado en `app/Http/Kernel.php`): un access token Bearer
firmado por el pool de STAFF. También exige `ResolveBackofficeActor`, que carga la fila de `users` que el gateway
nombra en `x-principal-id`, para que la auditoría sepa quién escribió; sin un actor de staff responde 401.

En `main`, sobre comercios:

- `GET /merchants`, `GET /merchants/filter-options` y `GET /merchants/{merchant}`: el padrón y la ficha. El
  listado trae `missingIntegrations`, las entidades que exigen credencial propia y no la tienen en ningún nivel.
- `GET /merchants/{merchant}/branches` y `PUT /merchants/{merchant}/branches/{branch}`: las sedes y la edición de una.
- `GET /merchants/{merchant}/logo`: lo que el mapa del listado pone dentro del pin.
- `POST`, `DELETE` y `PUT …/footnote` en `/merchants/{merchant}/app-banner`: la foto del banner de la app.

No hay ruta para crear un comercio, ni para su logo de marca, sus entidades o sus reglas. Eso es lo que agrega
CORE-562 fuera de `main`.

## La ubicación de las sedes es de merchant-api

`legacy-backend` dejó a propósito de escribir `allied_locations`: lo dice el comentario de sus rutas, para que no
haya dos servicios escribiendo la misma tabla con reglas de caché distintas. En `main`, `merchant-api` sirve las
ubicaciones (`internal/modules/merchant/module.go`):

- `GET /v1/merchants/:merchant_id/branches/locations`
- `GET /v1/merchants/:merchant_id/branches/:branch_id/location` y `…/location/history`
- `POST …/location/resolve`
- `PUT …/location/confirmation` y `DELETE …/location/confirmation`

Además están `GET /v1/merchants/creditop-x` y `GET /v1/merchants/storefronts`, que no son del backoffice.

## El gateway del backoffice

En `infrastructure`, `environments/development/api-gateway-backoffice/terragrunt.hcl` publica
`backoffice-api.dev.creditop.com` (stage `dev`). Las rutas pasan por el authorizer `backoffice-authorizer`, la lambda
`backoffice-cognito-authorizer-development`, que cachea por token y por ruta porque decide ruta por ruta. El gateway
reescribe el host hacia el servicio interno y agrega cuatro cabeceras que salen de lo que devuelve el authorizer:
`x-cognito-identity-id`, `x-cognito-username`, `x-user-profile-id` y `x-principal-id`.

Esas cabeceras se declaran una sola vez, en el mapa `authorizer_request_parameters` de `backoffice-authorizer`, y el
módulo `api-gateway` las aplica a todas las rutas que usan ese authorizer. Cada ruta lleva solo `overwrite:header.host` y
`overwrite:path`; no hay copias por ruta de las cabeceras de identidad.

- Lo de legacy-backend va al host `leg-lab.develop.internal.creditop.com`: el despliegue de la rama `lab`, no el de
  `develop` ni el de `qa`. La base es la compartida de dev, qa y staging.
- Lo de `merchant-api` va a `merchant-api.develop.internal.creditop.com`.

El front de dev es `backoffice.dev.creditop.com`, y el de producción, `backoffice.creditop.com`, con su gateway
`backoffice-api.creditop.com`.

## Para automatizarlo

Una herramienta que quiera hacer por API lo que hace el backoffice necesita un access token del pool de STAFF y que
su usuario tenga fila de staff en `users`, porque si no, `ResolveBackofficeActor` responde 401. Por el gateway, el
authorizer además decide ruta por ruta. El BFF del front no sirve de atajo: toma el token de la sesión del navegador.
