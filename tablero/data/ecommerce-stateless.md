---
id: 6
title: "Ecommerce web stateless"
stage: work
created: "2026-07-21T10:30:30-05:00"
context_nodes: [ecommerce, onboarding, payments, architecture]
jira: [CORE-543]
jira_title: "Inicio paso refactor ecommerce"
---

# Ecommerce web stateless (→ wizard sin cookie)
(migrado del nodo-tarea `ecommerce-web-stateless` del árbol de context, 2026-07-21)

CUÁNDO APLICA: Cuando la tarea toca la migración de la originación de ecommerce (VTEX/Woo/self) al wizard STATELESS (sin cookie) en legacy-backend + frontend: PRs 795 (backend, en main) / 551 (frontend, en develop), el entry ecommerce/checkout, los endpoints de contexto, o el estado 'backend en main, front aún en develop'.

# Ecommerce web stateless (→ wizard sin cookie) · task
> **rama:** `feature/onboarding/ecommerce-*stateless*` · **PR:** backend [#795](https://github.com/Creditop-SAS/legacy-backend/pull/795) (✅ en main) · frontend [#551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551) (🟡 en develop, NO en main) · **estado:** parcialmente aterrizado
>
> Llevar la originación de ecommerce (VTEX / WooCommerce / self) al **wizard STATELESS (sin cookie)**: el front arma la entrada `ecommerce/checkout` y lee el contexto de la solicitud vía endpoints de contexto del backend (no por sesión/cookie). Es la versión que reemplazó al intento anterior "web-origination" de abril (PRs 503/363, que quedaron sin merge).

## Contextos que usa
- **ecommerce** — el canal (contrato base64, credencial `allied_ecommerce_credentials`, `/vtex/*`, "volver al comercio"). Esta task lo lleva al wizard nuevo en modo stateless; el nodo describe el canal, la task el cambio.
- **onboarding** — el formulario del wizard (teléfono/OTP, datos personales, `init-loan-request`) se adapta para hidratarse del contexto ecommerce sin cookie.
- **payments** — la task suma las rutas de **cuota inicial** al wizard (`initial-fee-payment.tsx` + `.server.ts`) y `down-payment-validation`; el enganche pasa por acá.
- **architecture** — es la costura `application → legacy-backend + frontend`; "stateless (no cookie)" es la misma dirección que el V1→V2: **el estado y la orquestación viven en el front**, el backend solo expone endpoints de contexto.

## Objetivo
Que el checkout de una tienda entre al wizard nuevo SIN depender de cookie/sesión: el front (`ecommerce/checkout.tsx`) recibe el contrato, y en cada paso rehidrata desde endpoints de contexto del backend (`ecommerce-context.server.ts` → `EcommerceRequestController`). Motivación técnica del "no cookie": el SSR del wizard cruza hosts/ambientes y la cookie se perdía. No re-explica el canal (ver **ecommerce**).

## Ramas y PRs por repo
| Repo | PR | Commit (squash) | Fecha | ¿En main? | ¿develop? | ¿staging? |
|---|---|---|---|---|---|---|
| `legacy-backend` | [#795](https://github.com/Creditop-SAS/legacy-backend/pull/795) — *ecommerce context endpoints for stateless wizard (no cookie)* | `bb14a8ff` | 2026-06-11 | ✅ **SÍ** | ✅ | ✅ |
| `frontend-monorepo` | [#551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551) — *entrada ecommerce web stateless* | `d2242469` | 2026-06-11 | 🟡 **NO** | ✅ | ❌ |

> **Respuesta a "no sé si ya está en main" (verificado 2026-07-18 con `git branch -r --contains`):** el **backend #795 SÍ está en main** (4 archivos, endpoints de contexto). El **frontend #551 NO — solo en develop**. La feature completa NO está en main hasta que #551 promueva. Corroborado por el oráculo: los 5 archivos net-new del front (abajo) NO resuelven contra el índice (que se escanea de main); el 1 net-new del backend SÍ.

## Lo que se hizo
### Backend #795 (`bb14a8ff`, en main) — endpoints de contexto stateless (4 archivos)
- `Modules/Onboarding/App/Http/Controllers/EcommerceRequestController.php` + `App/Services/EcommerceRequestService.php` + `routes/api.php`: exponen el contexto de la `EcommerceRequest` para que el wizard lo consulte sin cookie.
- **NET-NEW**: `App/Http/Requests/FetchEcommerceRequestByUserRequestRequest.php` (fetch del contexto por `user_request`). *(Este sí resuelve en el índice → confirma que está en main.)*

### Frontend #551 (`d2242469`, solo en develop) — la entrada stateless (21 archivos)
- **NET-NEW (5, NO en el índice de main — evidencia de que #551 no promovió):**
  - `app/routes/ecommerce/checkout.tsx` — **la entrada unificada** `/ecommerce/{hash}/checkout` que el nodo `ecommerce` marcaba como "no está en main" (efectivamente: está en develop).
  - `app/server/services/ecommerce-context.server.ts` — el fetch del contexto server-side (reemplaza la cookie).
  - `app/routes/initial-fee-payment.tsx` + `app/server/services/initial-fee-payment.server.ts` — la cuota inicial en el wizard.
  - `app/routes/down-payment-validation.tsx`.
- **Modificados (16):** `entry.client`, `routes.ts`, `route-helpers.ts`, `available-lenders`, `loan-approved`, `bancolombia/no-preapproved`, y el `loan-application-form` (phone/OTP/personal-info/init-loan-request/amount-form/verify-phone-otp/phone-otp.repository) adaptados a la hidratación por contexto.

## Hilo nuevo (2026-09-14): ¿y si el flujo sale de CreditOp y entra a la tienda?

La pregunta que abrió este hilo es de la parte ecommerce: **que el comprador no se vaya de la tienda**.
Se evaluaron dos formas y sólo una sobrevive.

**Descartada — iframe.** No por gusto: está bloqueado en `main`, por diseño, en cuatro lugares
independientes.

1. El wizard manda `X-Frame-Options: DENY` **siempre** y `frame-ancestors 'none'`, con el comentario
   literal «el wizard nunca se embebe en iframe (confirmado)» —
   `frontend-monorepo/apps/loan-request-wizard/app/utils/security-headers.server.ts:122,137`.
2. El monolito manda `SAMEORIGIN` + `frame-ancestors 'self'` —
   `legacy-application/app/Http/Middleware/SecurityHeaders.php:38,101`.
3. La cookie `__session` del wizard es `sameSite: "lax"`: en iframe cross-site **no viaja**, y sostiene
   `ownedLoanRequests`, la marca de etapa y el `sessionId` de trazas.
4. Lo posterior a elegir entidad no es framable por nadie, y el repo ya lo midió dos veces:
   `routes/entidad/simulador.tsx:276` (el simulador de BCP responde `SAMEORIGIN` y el frame queda en
   blanco) y `submit-post-redirect.ts:8` («no sirve fetch/XHR ni un iframe»).

**Viva — SDK en el DOM del comercio.** Esquiva 1-3 (el DOM sería del comercio, no un frame ajeno) y
acepta 4 como su frontera natural.

### El prototipo

`tablero/data/artifacts/ecommerce-stateless.sdk-en-la-tienda.html` — un archivo, sin build ni
dependencias: una tienda falsa con el «SDK» adentro, que maneja el flujo por API y pinta el listado
dentro de la página. Se sirve con `make soporte-qa` y se abre en
`http://localhost:5199/ecommerce-stateless.sdk-en-la-tienda.html` — **no con doble clic**: en `file://`
el Origin es `null` y la prueba deja de parecerse a una tienda.

El contrato salió de los repositorios del wizard en `main`, no de suposiciones. ⚠ Y ahí apareció que
**el wizard ya migró parte a OnboardingV2** (`api/v2/onboarding/otp-auth/validate`, códigos `OBV22xxx`),
así que el nodo `onboarding` de `context/` quedó viejo donde dice que G3 no tiene consumidores.

### Lo medido (2026-09-14, local, origen `:5199` → backend `:80`)

Las tres llamadas dieron **200** — o sea, **una página de otro origen puede manejar el flujo hasta el
listado hoy**, sin secreto de servidor: `phone/register` → `otp-auth/validate` (`OBV22005`, uReq 466543)
→ `lenders-v2`.

⚠ **Pero salieron 6 entidades, no 7.** El mismo comercio por `make harness-listado` da 7. La que falta es
**CrediPullman (77, rt=2)** — la de CreditopX. No es un bug: el harness **inyecta** ingreso y score antes
de pedir el listado; acá el usuario es temporal y no tiene ninguno, así que rt=2 no calcula cupo y se
cae. **Mostrar cupo en la tienda sin pedir datos personales no muestra la oferta de CreditopX**, que es
justo donde el comercio pone capital y CreditOp cobra comisión. Hay que decidirlo antes de diseñar la
pantalla.

### Lo que el prototipo NO resuelve

- `auth.cognito` (`ResolveCognitoUser`) lee `x-user-id` / `x-cognito-identity-id` de headers y **nunca
  rechaza**; CORS es `allowed_origins: ['*']`. Hoy está contenido porque quien llama es el SSR del
  wizard, dentro del cluster. Un SDK publica ese contrato.
- No existe clave pública por comercio, ni allowlist de origen, ni rate limit por origen. Lo único hoy
  es el rate limit de personal-info (4/hora por documento).
- Los módulos del wizard **no son librerías**: `@creditop/lenders-marketplace` y
  `@creditop/loan-application-form` tienen `main: "./src/index.ts"` (TS crudo, sin `dist` ni `exports`)
  y declaran `react-router` como peerDependency. El único paquete con forma distribuible es
  `packages/form-engine` (tsup + `dist` + `exports`) — es el molde si se sigue por acá.
- Sería la **cuarta** superficie sobre el mismo contrato (G1 · G2 · G3 · SDK).

## Cómo probar / validar
- Flujo E2E de ecommerce: `bin/ecommerce` de **harness** (ver nodo **harness**). Como el front vive en develop, apuntá el harness a **dev/develop**, no a main.
- ⚠ Gotcha (nodo `ecommerce`): la entrada ecommerce se degrada en local por Mixed Content — el motivo mismo del rediseño stateless.
- Verdicto: el wizard rehidrata el monto/prefill desde `ecommerce-context.server.ts` sin cookie y cierra a Estado 11.

## Bitácora
- **2026-04** — 1er intento "web-origination" (PRs 503/363, rama `feature/onboarding/ecommerce-web-origination`): quedó **sin merge**, superado por el enfoque stateless.
- **2026-06-11** — mergeados los squash `bb14a8ff` (#795) y `d2242469` (#551).
- **2026-07-18** — registrado como task (corrige la versión previa de este nodo, que apuntaba por error a 503/363). Estado de merge verificado contra las ramas remotas: backend en main, front en develop. Superficie = 20 archivos que resuelven; 5 net-new del front + los adds van en prosa.
- **2026-09-14** — se le ata **CORE-543** («Inicio paso refactor ecommerce»), que estaba en el sprint sin archivo en el tablero. Se abre el hilo «el flujo dentro de la tienda»: descartado el iframe contra `main` (4 bloqueos), prototipado el SDK y **corrido** — tres llamadas 200 desde otro origen, 6 entidades y no 7, y falta la rt=2. Re-verificado también que #551 sigue **sin** llegar a `main` (está MERGED contra `develop`).

## Pendientes
- [ ] **Promover #551 (front) a main** — hoy solo en develop; hasta entonces la entrada stateless no corre en prod.
- [ ] Extender el cutover al resto del ecommerce no-Corbeta (sigue el array `[24,209,210,211,311]` en `WoocommerceController` del monolito).
- [ ] Borrar la lógica ecommerce duplicada en `application` una vez completo en main.
- [ ] **Decidir el alcance del SDK**: ¿listado completo (exige datos personales, muestra CreditopX) o sólo entidades externas (celular + OTP, sin rt=2)? Es la decisión de producto que destapó la corrida.
- [ ] **Antes de cualquier piloto**: clave pública por comercio + allowlist de origen + rate limit por origen en `api/onboarding`. Hoy no hay nada de eso.
- [ ] Medir cuántos comercios ecommerce hay en prod y por cuál mundo entran (el cutover es el array quemado `[24,209,210,211,311]`). Si el grueso sigue en el monolito, un SDK contra `api/onboarding` le sirve a la minoría.
- [ ] Corregir el nodo `context/…/onboarding`: dice que G3 (`OnboardingV2`) no tiene consumidores, y el wizard en `main` ya le pega a `api/v2/onboarding/otp-auth/validate`.

## Enlaces
- PRs: [legacy-backend #795](https://github.com/Creditop-SAS/legacy-backend/pull/795) · [frontend-monorepo #551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551).
- Canal: **ecommerce** · fase: **onboarding** · enganche: **payments** · costura: **architecture**.


## Rutas del código (20)
- legacy-backend/Modules/Onboarding/App/Http/Controllers/EcommerceRequestController.php
- legacy-backend/Modules/Onboarding/App/Services/EcommerceRequestService.php
- legacy-backend/Modules/Onboarding/routes/api.php
- legacy-backend/Modules/Onboarding/App/Http/Requests/FetchEcommerceRequestByUserRequestRequest.php
- frontend-monorepo/apps/loan-request-wizard/app/entry.client.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes.ts
- frontend-monorepo/apps/loan-request-wizard/app/routes/bancolombia/no-preapproved.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/loan-application-form/loan-request-form.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/loan-application-form/otp-verification.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/loan-application-form/phone-number.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/loan-approved.tsx
- frontend-monorepo/apps/loan-request-wizard/app/utils/route-helpers.ts
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/amount-form.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/forms/personal-info-form.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/init-loan-request.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/phone-number-step-form.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/phone-number.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/lib/application/verify-phone-otp.uc.ts
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/lib/infrastructure/phone-otp.repository.ts
