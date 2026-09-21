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

## «Ver Perfilamiento» — GRADUÓ a canon

> **Graduó** (2026-09-21) → canon, `backoffice/context` § «Por qué no le salió una entidad: el motivo
> ya viene redactado, no hay que re-evaluar reglas». La mecánica de reglas y tiers sigue en
> **profiling**.

## Dar de alta una entidad sin SQL a mano: la API que escribe las reglas, y la que dice si está lista

Dos servicios de `Modules/Backoffice/App/Services/` que `context/` no nombraba y que cambian cómo se
monta una entidad nueva. Los dos verificados contra `main` el 2026-09-14.

### `LenderRulesWriterService` — GRADUÓ a canon

> **Graduó** (2026-09-21) → canon, `backoffice/context`: el **orden** (§ «Primero habilitar la
> entidad en la sucursal, después guardar la política») y el **rastro de sólo escritura**, en esa
> misma sección. El control de versión con 409 y la regla de los clones **ya estaban** allá, y
> mejor explicados — ahí no había nada que graduar.

### `LenderReadinessService` — GRADUÓ a canon

> **Graduó** (2026-09-21) → canon, `backoffice/context` § «Listo para operar son cinco chequeos, y
> dos no bloquean a propósito». Ahí vive el hecho: las cinco claves, y por qué pagos deja de
> bloquear con `lenders.externally_serviced` y la política dura no bloquea nunca. Se verificó contra
> `origin/main` al graduarlo, y de paso se corrigió el orden — en el código es identidad ·
> validación · **pagos** · **política** · **perfiles**, y acá los dos últimos estaban al revés.

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
