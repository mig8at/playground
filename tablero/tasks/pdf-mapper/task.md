---
id: 105
title: PDF mapper en backoffice
stage: work
created: "2026-10-26T16:02:12-05:00"
knowledge: []
canon: []
jira: [CORE-818]
jira_title: PDF mapper en backoffice
ramas: frontend-monorepo:pdf-mapper, infrastructure:backoffice-pdf-mapper
---

## Pendientes

- [x] Sumar la sección «Mappers de PDF» al backoffice — PR frontend-monorepo#1235 mergeado a `lab` el 2026-10-26; el despliegue «Deploy Backoffice Develop» de ese merge terminó en success.
- [x] Publicar en desarrollo las rutas del gateway hacia `pdf-mapper-service` — infrastructure#179 mergeado; el despliegue de development creó el target group y la regla del ALB interno (2 added) y registró el servicio (1 changed); el plan posterior de `api-gateway` da «No changes».
- [ ] Probar la sección desplegada en el backoffice de desarrollo (listar, abrir, guardar, vista previa); termina cuando un documento real abre y se guarda sin diferencias contra el servicio de desarrollo.
- [ ] Dar de alta los permisos `pdf_mapper:view`, `pdf_mapper:edit` y `pdf_mapper:delete` en el catálogo de autorización y asignarlos; termina cuando un staff sin el permiso cae en `/no-access` y uno con el permiso entra.
  Depende de: quien administra el servicio de acceso — alta de los tres permisos.
- [ ] Abrir el PR de infra para producción, armado como #179: sólo dentro de `environments/prod` y sin tocar el módulo `internal-alb`; termina cuando el plan de prod muestra el target group, el registro del servicio en el lugar (no reemplazo) y las 13 rutas.
- [ ] Llevar la sección de `lab` hacia `develop` y `main`; termina cuando el backoffice de producción la sirve.
- [ ] Retirar el PDF Mapper Studio aparte cuando la sección funcione en producción; termina cuando nadie lo usa para publicar.

## Objetivo

Que los mappers de PDF (dónde va cada dato sobre las plantillas que genera `pdf-mapper-service`:
vinculación, pagarés, planes de pago…) se diseñen desde el backoffice, contra el servicio del mismo
ambiente, con el login de staff y permisos, en vez del PDF Mapper Studio aparte, que guardaba en
IndexedDB y publicaba en desarrollo y producción a la vez.

## Dónde se toca

**frontend-monorepo** (PR #1235, rama `pdf-mapper` → `lab`, 55 archivos, +4.668/−1):

- `modules/backoffice/pdf-mapper/` — módulo nuevo `@creditop/backoffice-pdf-mapper`:
  - `src/lib/domain/`: esquema del mapper con Zod (`mapper.schema.ts`), operaciones del editor como
    funciones puras (`editor.ts`), tablas con su `_grid` (`table.ts`), catálogo (`catalog.schema.ts`,
    `default-catalog.ts`), plantilla y formulario de documento nuevo; cada uno con sus pruebas.
  - `src/components/`: `PdfMapperProjectsView`, `PdfMapperEditor`, `TemplateStage` + `PdfPage.client`
    (pdf.js), `FieldsLayer`, `TablesLayer`, `TableControls`, `FieldInspector`, `EditorToolbar`,
    `NewDocumentDialog`, `ReplaceTemplateDialog`, `DeleteDialog`, `use-pdf-mapper-editor`.
- `apps/backoffice/app/`:
  - `providers/pdf-mapper/pdf-mapper.repository.ts` (`HttpClient` + `ApiResult`; plantilla, vista
    previa y borrado por `fetch`) y `use-pdf-mapper-api.ts`;
  - rutas `routes/pdf-mapper.tsx` y `routes/pdf-mapper.document.tsx`, registradas en `routes.ts` y
    en `config/resources.tsx`;
  - proxy `routes/api-pdf-mapper-service-proxy.ts` → `/backoffice/pdf-mapper-service/*` con el token
    de staff (ADR-0006); `utils/bff-proxy.server.ts` acepta una lista opcional de cabeceras extra
    (sólo este proxy la usa, para `x-delete-key`); `utils/upstream.server.ts` con
    `PDF_MAPPER_SERVICE_LOCAL_URL`;
  - permisos en `authz/permissions.ts` y sus nombres en `locales/{es,en,pt}`;
  - login local (ADR-0007): `utils/auth/local-login.server.ts`, el desvío en
    `routes/staff-auth.login.tsx`, `access-token.server.ts`, la franja en `protected-layout.tsx`,
    `.env.example` y `DECISIONS.md`.

**infrastructure** (PR #179, sólo `environments/development`):

- `internal-alb/terragrunt.hcl`: host `pdf-mappers.develop.internal.creditop.com`, `priority = 12`,
  puerto 8080, health check `/health`. En plural porque el nombre del target group se corta en 32
  caracteres y `pdf-mapper` dejaba `alb-internal-develop-pdf-mapper-`, terminado en guion, que AWS
  rechaza.
- `ecs-application/terragrunt.hcl`: `pdf-mapper-service` con `load_balancer` hacia ese target group y
  `ports = [8080]`.
- `api-gateway/terragrunt.hcl`: 13 rutas `/backoffice/pdf-mapper-service/…` con
  `backoffice-authorizer` y las cabeceras `x-cognito-identity-id` / `x-principal-id`; los `DELETE`
  reenvían `X-Delete-Key`.

## Cómo se ataca

1. Sección en el backoffice contra el servicio del mismo ambiente, sin estado en el navegador — hecho.
2. Gateway en desarrollo — hecho y aplicado.
3. Permisos en el servicio de acceso y prueba en el backoffice de desarrollo.
4. Gateway en producción, con un PR propio del mismo corte que #179.
5. Promover la sección de `lab` a `develop` y `main`, y retirar el Studio.

## Lo que se evaluó y NO se eligió

- **Un solo PR de infra para dev y prod** (infrastructure#178, cerrado): además tocaba el módulo
  `internal-alb` (`trimsuffix` del nombre del target group). Se partió para aplicar primero en
  desarrollo sin tocar código compartido, y el problema del nombre se resolvió con el host en plural.
- **Seguir con el PDF Mapper Studio aparte**: guardaba en IndexedDB y escribía en desarrollo y
  producción en cada sincronización; no tenía login ni permisos.
- **pdf-mapper como herramienta del playground compartido** (playground#351, cerrado; retirado en
  playground#406): el editor queda en el backoffice, que ya tiene sesión de staff y permisos.

## Lo que NO entra

- Cambios en `pdf-mapper-service`: el editor usa los endpoints que ya registra.
- Editar o borrar campos del catálogo: sólo se le agregan ids nuevos.
- El código del `backoffice-authorizer`, que no está en el repo de infra.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Verificado el 2026-10-26, contra el código mergeado:

- Infra de desarrollo aplicada: el run «Deploy development» del 2026-10-26 20:29 UTC terminó en
  failure por `rds-inertia` (sin relación), pero `internal-alb` («2 added») y `ecs-application`
  («1 changed», en el lugar) se aplicaron, y el plan siguiente da «No changes» en `api-gateway`.

  ```sh
  gh -R Creditop-SAS/infrastructure run view 40396163046 --log | grep -E '\[(internal-alb|ecs-application)\]' | grep 'Apply complete'
  ```
  Resultado: `internal-alb` Apply complete! Resources: 2 added · `ecs-application` Apply complete! Resources: 0 added, 1 changed

- Backoffice de desarrollo desplegado desde `lab`:

  ```sh
  gh -R Creditop-SAS/frontend-monorepo run list --branch lab --limit 1
  ```
  Resultado: 2026-10-26 17:38 UTC «Deploy Backoffice Develop» success

- En local (como se probó el PR): backoffice con `APP_ENV=local`, `BACKOFFICE_LOCAL_LOGIN=1` y
  `PDF_MAPPER_SERVICE_LOCAL_URL` hacia un `pdf-mapper-service` local; para leer los mappers de
  desarrollo sin escribir, apuntar esa URL al servicio de desarrollo. Pruebas:
  `pnpm --filter @creditop/backoffice-pdf-mapper test`, `pnpm turbo run build --filter=backoffice`.

## Referencias

- [Creditop-SAS/frontend-monorepo#1235](https://github.com/Creditop-SAS/frontend-monorepo/pull/1235) — la sección (mergeado a `lab`).
- [Creditop-SAS/infrastructure#179](https://github.com/Creditop-SAS/infrastructure/pull/179) — gateway en desarrollo (mergeado).
- [Creditop-SAS/infrastructure#178](https://github.com/Creditop-SAS/infrastructure/pull/178) — versión dev+prod, cerrada.

## Tarea (publicable)

## En una línea
Los mappers de los PDF que genera la plataforma se diseñan desde el backoffice, con login y permisos.

## Por qué
Hoy se editan en una herramienta aparte, sin login ni permisos, que guarda en el navegador y publica
en desarrollo y producción al mismo tiempo: un cambio de prueba puede llegar a producción.

## Qué cambia
- Nueva sección «Mappers de PDF» en el backoffice: proyectos y sus documentos.
- Editor sobre la plantilla: mover, agregar y borrar campos de texto, casillas y tablas; el id se toma
  del catálogo de campos y uno nuevo se agrega al guardar; deshacer y rehacer.
- Vista previa del PDF con valores de ejemplo, reemplazo de plantilla (avisa cuántos campos se
  descartan) y borrado de documento o proyecto con confirmación y clave de borrado.
- Cada ambiente edita sólo sus propios mappers.
- Permisos separados para ver, editar y borrar.
- Se publicaron en el gateway de desarrollo las rutas hacia el servicio de mappers.

## Alcance
No cambia cómo se generan los PDF ni los documentos que reciben los clientes. Producción queda para
una segunda entrega (gateway y promoción del backoffice).

## Dónde probar
Backoffice de desarrollo, con un usuario de staff que tenga los permisos de mappers de PDF.

## Cómo validar
1. Entrar a «Mappers de PDF»: se listan los proyectos (alta, credifamilia, motai, onvacation) con sus documentos.
2. Abrir un documento: la plantilla se ve con sus campos encima.
3. Mover un campo, guardar y volver a abrir: el campo queda en la nueva posición y los demás no cambian.
4. Pedir la vista previa: se descarga un PDF con valores de ejemplo.
5. Borrar con una clave equivocada: la pantalla avisa y no borra.
6. Entrar con un usuario sin permiso de ver: la sección no es accesible.

## Criterios de aceptación
- Los mappers existentes se abren y se guardan sin perder ni alterar campos.
- Un cambio en desarrollo no aparece en producción.
- Sin permiso no se ve la sección; sin permiso de edición o borrado no se puede guardar ni borrar.

## Dependencias / contraparte
- Infraestructura: rutas del gateway en producción.
- Alta de los permisos de mappers de PDF en el catálogo de autorización.
