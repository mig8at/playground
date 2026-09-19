# Backoffice · contexto
> **estado:** al día con main · El panel NUEVO de operaciones (React + Refine, `/api/backoffice`) y el módulo `Auth` que lo autentica con Cognito. **No es el admin viejo de Inertia.**

## Qué es

Un panel de back-office **nuevo y aparte**: app propia en el monorepo (`apps/backoffice`), API propia en
legacy-backend (`Modules/Backoffice` → `/api/backoffice`) y autenticación propia (`Modules/Auth` →
`/api/auth`, Cognito). Hoy sirve dos cosas: **buscar un usuario** (con su detalle, solicitudes,
documentos, validación de identidad, respuestas de centrales, Experian, OTPs) y **listar solicitudes**
con filtros.

Importa por dónde salió: `UsersController` y `ApplicationsController` **se movieron desde `Modules/Loans`**
—queda la nota en `Modules/Loans/routes/admin.php`— así que el dashboard de usuarios y solicitudes ya no
está donde estaba. Y convive con el **admin viejo** (Inertia, `admin.{host}`, ver `actors` y
`application`): son dos paneles distintos, con dos autenticaciones distintas, sobre la misma BD.

Frontera: el admin viejo, sus 12 roles Spatie y los permisos → **`actors`**. La arquitectura modular de
legacy-backend → **`legacy-backend`**. El monorepo y el wizard → **`frontend-monorepo`**.

## Contenido

**La API: `/api/backoffice`, todo detrás de `cognito.token:staff`.** Tres recursos —`/me`, `users/*`,
`applications/*`— definidos en `Modules/Backoffice/routes/backoffice.php`. Bajo `users/{user}` cuelgan
`requests`, `documents`, `validation`, **`cognito-status`**, `central-responses`, `otps`,
`otps/{otp}/log` y el POST `manual-validation`; bajo `applications`, `filter-options`,
`filter-options/points-of-sale`, `{userRequest}` y `{userRequest}/profiling`. ⚠ El grupo lleva **un
segundo middleware además del guard**, `UseColombiaTimezone`: las fechas que devuelve esta API ya vienen
convertidas, así que no hay que volver a convertirlas al compararlas con una consulta cruda a la BD.

**La autenticación NO es la del admin viejo, y tampoco es `auth.cognito`.** `Modules/Auth` expone
`/api/auth` con `ForceJsonResponse` + `otel` + `throttle:auth` como paraguas por IP. **Diez endpoints van
además con `throttle:auth-sensitive`** (login, register, register/confirm, exists, verify, verify-code,
resend, forgot, forgot/confirm, reset) y **dos quedan afuera a propósito** —`change-password` y
`refresh`—, porque **los consume el BFF con tokens ya emitidos** y limitarlos cortaría la renovación
normal de sesiones. El guard de la API es
**`EnsureCognitoAccessToken`** (alias `cognito.token`), que valida el JWT contra el **JWKS público** del
pool —no necesita IAM— comprobando `token_use=access` y el `client_id` del app client. Toma el pool
como parámetro: `cognito.token:staff`.

**Dos pools, configurados por env** (`Modules/Auth/config/config.php`): **`staff`**
(`BACKOFFICE_AWS_COGNITO_*`, con `userProfileId: 2` = Administrador) y **`comercios`**
(`MERCHANT_AWS_COGNITO_*`). Son pools separados: una cuenta de uno no entra por el otro, y el `userProfileId` filtra `users` para
validar que el contacto corresponda a la audiencia (**2 = staff, 4 = comercios**). ⚠ **Y hay un TERCER
pool que este módulo NO usa a propósito: el de mobile (`AWS_COGNITO_*`), que es phone-username.** Por eso
acá **no hay fallback** a esas variables: si el prefijo del pool que corresponde no está seteado, el login
falla — que es lo correcto — en vez de caer silenciosamente al pool equivocado.

**El proxy BFF, y por qué existe.** El front declara `route("api/backoffice/*",
"routes/api-backoffice-proxy.ts")`: los dataProviders de Refine pegan **al mismo origen** y el proxy
reenvía a legacy adjuntando el `Authorization`. El motivo está escrito en el archivo: **el browser nunca
tiene el token** —la sesión vive server-side— así que no puede llamar a legacy directo. Y responde
**401 JSON, no redirect**, porque quien consume son XHR; el redirect a `/login` lo hace el guard del
layout durante la navegación.

⚠ **Trampa de deploy, anotada en el propio `routes/backoffice.php`:** el front con proxy debe salir
**ANTES** que el middleware. Si el middleware sale primero, el **panel viejo** —que pega sin token—
queda sin datos.

⚠ **`config/app.php` de legacy trae `backoffice_host` con default `http://localhost:5175`**, separado a
propósito de `ADMIN_URL`. Con él se arma el link de validación manual que se manda a usuarios internos:
si `BACKOFFICE_HOST` no está seteado en el ambiente, **esos links salen apuntando a localhost**.

**El front.** React Router 7 (SSR) + **Refine v5** (`@refinedev/core`, `simple-rest`, `react-table`,
`kbar`) + Tailwind. Las pantallas cuelgan de `routes/protected-layout.tsx`: `users`, `users/:userId` y
sus vistas (`profiling/:applicationId`, `applications/:applicationId`, `scores/experian`),
`loan-applications`, `profile`. Fuera del layout van las de sesión (`staff-auth/login`, `register`,
`register-confirm`, `resend`, `reset`, `logout`), un `login-preview` y `/health`. Se apoya en tres
paquetes del monorepo: **`@creditop/auth`** (dominio + server de sesión), **`@creditop/refine-ui`**
(layout y componentes Refine) y **`@creditop/backoffice-users`** (las vistas del recurso usuarios).

**Se despliega a producción solo.** `.github/workflows/backoffice-prod.yaml` dispara con push a `main`
filtrado por `paths: apps/backoffice/**`, delegando en `Creditop-SAS/config-ci`
(`service_name: backoffice`, `secret_name: prod/backoffice`). **No hay workflow de dev ni de staging**
para esta app.

## «Ver Perfilamiento»: la única pantalla que contesta «¿por qué no le salió esta entidad?»

Es lo más valioso del panel y no estaba escrito acá pese a que el archivo ya figuraba en `files[]`.
`GET /api/backoffice/applications/{userRequest}/profiling` → `ApplicationsController::profiling` →
`ApplicationsService::getProfiling` devuelve, **por entidad evaluada**:

- `state` (`pass` · `fail` · `off`) y el marcador de **evaluada pero no ofertada** — que es justo el
  caso que desde el listado del cliente se ve como «no apareció» (→ ver **creditopx** § «No apareció
  significa cosas distintas»).
- **`reasonLong`**: el motivo **redactado**, del tipo *«\<regla\> debe ser \<operador\> \<esperado\> y
  es \<real\>»*. Es el «motivo concreto» que pide soporte, ya armado — no hay que re-evaluar reglas.
- Regla por regla: `expected`, `actual`, si pasó, y **de qué campo salió el dato** (`field:<id>` o
  `tabla:columna`).
- Las corridas del motor de categorías (`users_category_log`) con sus `failedChecks` por tier.

Front: `frontend-monorepo/apps/backoffice/app/routes/users.profiling.tsx`. La mecánica de las reglas y
los tiers vive en **profiling**; acá solo que existe la pantalla y con qué cuidados se lee.

**Dos cuidados antes de pasarle el motivo a un comercio:**

⚠ **La fila «apagada» afirma una causa que el listado NO aplica.** Cuando la entidad tiene
`lenders_by_allied_branches.status = 0`, la pantalla dice que *«no se evaluaron reglas ni categoría»*
por estar apagada en el punto de venta. Pero las tres ramas de
`Modules/Onboarding/App/Services/lenders/LenderListingService.php` `resolveLenderIdsByBranch` arman la
base con `where('allied_branch_id', …)->pluck('lender_id')` **sin filtrar por `status`** —y memoizada
30 s en el cache de array del proceso— (verificado contra `main`) — así que el `status = 0` no es lo que impidió la evaluación. Es una explicación
plausible presentada como hecho: dársela al comercio tal cual puede ser darle un motivo equivocado.
Concuerda con lo que ya dice **merchants**: apagar una entidad en una sucursal es una operación
solo-BD que el camino principal no lee.

⚠ **La atribución de `users_category_log` a «esta corrida» es una heurística de tiempo, no una
llave.** Esa tabla **no tiene `user_request_id`**: se ata por `(user_id, lender_id)` y una ventana de
**±120 s** contra el `updated_at` del review (`ApplicationsService.php`, y el mismo criterio replicado
en `trazador/server/fuentes.go`). Un cliente con varias solicitudes cercanas ensucia la atribución: es
correlación, no prueba.

**(2026-08-28) Re-verificación asistida de los 83 archivos derivados.** Método: un worker digirió el
diff completo contra este doc (agrupado en 6 funcionalidades) y las afirmaciones clave se verificaron a
mano contra `main` — muestreo de 3/6 confirmado exacto. El resultado:

- **Cinco de las seis son el panel alcanzando lo que este doc ya describía** (shell + layout protegido,
  auth de staff por BFF, proxy y data-providers, pantallas de usuarios/solicitudes, y el visor de
  perfilamiento que ganó **simulación interactiva en el Paso 3** — `Paso3Simulation.tsx` +
  `simulate-calc.ts`, con la tarjeta del usuario al lado). El doc queda CONFIRMADO, no viejo.
- **Una es nueva**: el **rechazo de la validación manual ahora se propaga al codeudor** —
  `UsersService` (rama legacy del backoffice) llama al orquestador de
  `RecordCosignerIdentityRejectionService` con usuario y solicitud: si el usuario evaluado es el
  codeudor activo, su participación queda no-elegible y no reintenta la pantalla de identidad en bucle.
  Cierra el circuito con el flujo de codeudor (ver ese nodo).

## Dar de alta una entidad sin SQL a mano: la API que escribe las reglas, y la que dice si está lista

Dos servicios de `Modules/Backoffice/App/Services/` que `context/` no nombraba y que cambian cómo se
monta una entidad nueva. Los dos verificados contra `main` el 2026-09-14.

### `LenderRulesWriterService` — `PUT /api/backoffice/lenders/{id}/rules`

Escribe, **en una sola transacción**, la plantilla de reglas duras (`group_rule_id IS NULL`) **y** los
clones por sucursal, junto con los perfiles y sus criterios. Lleva `baseVersion` para no pisar el
trabajo de otro (devuelve `409`).

⚠ **El defecto que evita está nombrado en su propio docblock, y vale más que la API:** la plantilla la
evalúa el **cupo** de CreditopX y los clones los evalúa el **listado** del onboarding. Verlas divergir
es lo que hace que una entidad **aparezca en el listado y después falle al pedir cupo** — el síntoma
clásico de haber escrito las reglas a mano en una sola de las dos.

⚠ **Y el ORDEN importa, porque se lee en el código:** el writer crea clones sólo para las sucursales
donde la entidad **ya está habilitada** (`bootstrapBranchGroups`, y sólo cuando no hay ninguna fila
previa). O sea: **primero se habilita la entidad en la sucursal, después se escribe la política.** Al
revés quedan las reglas sin clonar y la entidad lista a medias.

**Cada escritura deja rastro inmutable, y contesta «¿quién cambió esta regla y cuándo?».** El servicio no sólo escribe: por cada guardado crea un **snapshot** (`lender_rules_snapshots` — `version`, el `state` completo en JSON, quién lo cambió por id, nombre y correo, y cuántas sucursales quedaron afectadas) y **una fila por campo modificado** en `lender_rules_changesets` (`scope`, `subject`, `field`, `label`, `action`, `old_value`, `new_value`, `message`), escritas desde `legacy-backend/Modules/Backoffice/App/Services/LenderRulesWriterService.php:615`. ⚠ **Son de sólo escritura**: el modelo declara `UPDATED_AT = null` (`legacy-backend/app/Models/LenderRulesChangeset.php:18`), así que una fila de cambio no se edita nunca — es bitácora, no estado.

**Y se está usando, no sólo desplegado.** Medido en prod el 2026-09-18: **13 snapshots** sobre **5 entidades** y **59 cambios** individuales, el último el 2026-09-16. Es poco volumen, pero es real: antes de esto un cambio de reglas no dejaba ninguna constancia de autor.

### `LenderReadinessService` — «listo para operar» no es opinión

Cinco chequeos, y **dos** pueden no bloquear:

| # | chequeo | qué pasa si falta |
|---|---|---|
| 1 | **identidad** — `lenders.originator_nit` cargado | la pasarela rechaza los pagos |
| 2 | **validación** — un proveedor ACTIVO en `order 1` | el flujo lanza excepción |
| 3 | **pagos** — al menos un comercio con cuenta de Wompi lista | no se puede cobrar · ⚠ **salvo cobranza externa** (ver abajo) |
| 4 | **perfiles** — al menos un perfil con fila en `lender_users_category_rules` | *«una categoría sin criterios no existe para el motor»* |
| 5 | **política dura** | se reporta el conteo, con **`blocking: false`** |

⚠ **El tercero deja de bloquear cuando `lenders.externally_serviced` está prendido:** si el ciclo de
vida del crédito no lo gestiona CreditOp, **no hay recaudo que configurar**. El chequeo se devuelve igual
—con `applicable: false`— para que el listado, el flujo guiado y el admin viejo **sigan viendo las mismas
cinco claves**, pero no pide cuenta ni bloquea. Quien lea «Pagos: no aplica» no está viendo un chequeo
roto: está viendo una entidad con cobranza externa.

El quinto es la decisión que conviene no revertir por prolijidad: *«un lender sin reglas no está
incompleto, está sin filtros»*. Un lender sin política dura **opera** — lista para todos. Marcarlo como
bloqueante convertiría un default deliberado en un error.

**(2026-09-18) Nodo RE-VERIFICADO entero.** 20 afirmaciones auditadas —19 de código leídas contra `main`
y 1 de dato medida contra producción—, **cero chequeos débiles y ninguna afirmación falsa**. Los cuatro
huecos que aparecieron ya están incorporados arriba: el endpoint `cognito-status` que faltaba en el
listado, el middleware `UseColombiaTimezone` que el grupo lleva además del guard, el **tercer pool de
Cognito** que este módulo se niega a usar sin fallback, y —el que más importa— que **el chequeo de pagos
tampoco bloquea** cuando la entidad es de cobranza externa, contra lo que decía «uno de ellos». También
se completó la lista de endpoints de `Auth`, que omitía cinco y no distinguía los dos que quedan fuera
del throttle sensible a propósito.

## Dónde mirar

- **Alta de entidades** (legacy-backend): `Modules/Backoffice/App/Services/LenderRulesWriterService.php` ·
  `App/Services/LenderReadinessService.php`.
- **API** (legacy-backend): `Modules/Backoffice/routes/backoffice.php` — el mapa completo de endpoints ·
  `App/Http/Controllers/{Users,Applications,Me}Controller.php` · `App/Services/{Users,Applications}Service.php`.
- **Auth** (legacy-backend): `Modules/Auth/routes/auth.php` · `App/Http/Middleware/EnsureCognitoAccessToken.php`
  (el guard y el JWKS) · `App/Cognito/CognitoGateway.php` · `config/config.php` (los dos pools).
- **Panel** (frontend-monorepo): `apps/backoffice/app/routes.ts` (el árbol de rutas) ·
  `app/routes/api-backoffice-proxy.ts` (el BFF) · `app/routes/protected-layout.tsx` (el guard) ·
  `app/utils/auth/session.server.ts`.
- **Paquetes**: `packages/auth/src/` · `packages/refine-ui/src/layout/layout.tsx` ·
  `modules/backoffice/users/src/`.

## Lo que NO está verificado

- **Qué ve cada rol dentro del panel.** El guard de la API es un solo `cognito.token:staff`; no se
  comprobó si hay diferencias de alcance por rol una vez adentro, como sí las hay en el admin viejo.
- **Si el panel viejo y el nuevo coexisten en producción hoy**, y bajo qué criterio se manda gente a
  uno o al otro. La nota de deploy sugiere que conviven, pero no se verificó el corte.
