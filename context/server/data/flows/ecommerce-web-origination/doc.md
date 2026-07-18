# Ecommerce web origination (→ legacy) · task
> **rama:** `feature/onboarding/ecommerce-web-origination` (backend + frontend) · **PR:** backend [#503](https://github.com/Creditop-SAS/legacy-backend/pull/503) · frontend [#363](https://github.com/Creditop-SAS/frontend-monorepo/pull/363) · **estado:** 🧪 pruebas locales / dev — SIN merge
>
> Sacar la originación de ecommerce (VTEX / WooCommerce / desarrollo propio) del monolito `application` y dejarla en **legacy-backend + frontend-monorepo** (el wizard nuevo): la tienda hace checkout → el wizard levanta la solicitud, pide teléfono/OTP/datos y la cierra, hablando con los módulos `Onboarding`/`Loans` de legacy por `VITE_API_URL`.

## Contextos que usa
- **ecommerce** — el canal en sí (contrato base64 de 6 params, credencial `allied_ecommerce_credentials`, `/vtex/*`, webhooks, "volver al comercio"). El nodo describe CÓMO es el canal; esta task lo REUBICA de `application` a legacy — no se repite su mecánica acá.
- **onboarding** — el grueso del cambio: entrada por hash de sucursal, registro de celular + OTP, creación de la `user_request` y el formulario personal/laboral se re-implementan en el wizard + `Modules/Onboarding` de legacy (antes vivían en el monolito).
- **architecture** — es una migración `application → legacy-backend + frontend-monorepo` (la costura del strangler / parallel-run): quitar lógica del monolito viejo y dejarla en el núcleo nuevo de originación.

## Objetivo
Que una solicitud que ENTRA por el checkout de una tienda online se origine y cierre en el stack nuevo (wizard + legacy-backend) en vez del monolito `application`. Hoy en `main`/prod el checkout ecommerce no-Corbeta sigue server-rendered en el monolito (`WoocommerceController::show` redirige a legacy SOLO `allied_id ∈ [24,209,210,211,311]` = familia Corbeta); esta task extiende ese cutover al resto del ecommerce. Doc magro a propósito: el canal lo explica **ecommerce** — acá va qué se reubicó y su estado real.

## Ramas y PRs por repo
| Repo | Rama | Base | PR → | Estado |
|---|---|---|---|---|
| `legacy-backend` | `feature/onboarding/ecommerce-web-origination` | develop (merge-base `82b170bb`) | [#503](https://github.com/Creditop-SAS/legacy-backend/pull/503) | 🟡 abierto, sin merge — head `07c0a8d7` (2026-04-15), 15 archivos |
| `frontend-monorepo` | `feature/onboarding/ecommerce-web-origination` | develop (merge-base `221480da`) | [#363](https://github.com/Creditop-SAS/frontend-monorepo/pull/363) | 🟡 abierto, sin merge — head `35737607` (2026-04-08), 15 archivos (2 rutas net-new) |
| `application` | — | — | — | sin cambios — la lógica SALE de acá; borrar el duplicado del monolito es un paso posterior (ver Pendientes) |

## Lo que se hizo
### Frontend (#363) — la entrada y el retorno del canal (net-new)
- **`app/routes/checkout-redirection.tsx`** (NUEVA) = la entrada unificada del canal. Recibe los 6 params del contrato en la query (`o` order · `p` products · `t` token · `u` returnUrl · `ps` processUrl · `config`), hace `POST ${VITE_API_URL}/api/onboarding/ecommerce-request/create/{partner_hash}` (endpoint de legacy-backend), guarda `ecommerce_session` (`ecommerceRequestId`, `amount`, `prefill`) en la sesión server y redirige al wizard. Es el entry unificado que el nodo `ecommerce` marcaba como "no está en `main`".
- **`app/routes/ecommerce-continue.tsx`** (NUEVA) = el retorno / polling. Hace polling a `${VITE_API_URL}/api/onboarding/loans/ecommerce-check/{loan_request_id}` y aprueba cuando `result.data.user_request_status_id === 11` (Estado 11 = originación cerrada). Es el "volver al comercio".
- Adaptación del **loan-application-form** al flujo ecommerce (prefill desde `ecommerce_session`): `phone-number` / `phone-number-step-form` / `otp-verification` / `verify-phone-otp.uc.ts` / `phone-otp.repository.ts` / `personal-info-form` / `init-loan-request` / `loan-request-form`; + `app/routes.ts` (registra las 2 rutas nuevas) y `packages/ui/radio-card-group`.

### Backend (#503) — el flujo en los módulos de legacy
- **`Modules/Onboarding`**: `EcommerceRequestService` (crea el `EcommerceRequest` desde el POST del checkout), `OnboardingController`, `OnboardingService`, `OtpService`, `RegisterCellPhoneService`, `routes/api.php` (expone `ecommerce-request/create/{partner}` y el `ecommerce-check`).
- **`Modules/Loans`**: `AdvisorStatusController`, `RequestCompletionService`, `OtpValidationService`, `DocumentSigningService`, `LoansServiceProvider` — el cierre de la solicitud en legacy.
- Dependencias del flujo: `Modules/Identity/TusDatosService`, `Modules/Partner/AlliedProductService`, `app/Actions/Lenders/BancolombiaBnpl`, `app/Actions/RiskCentrals/Experian`.

## Cómo probar / validar
- Es el flujo E2E de ecommerce: usar el harness (`bin/ecommerce` de **frontend-e2e** → abre el checkout simulado). Ver el nodo **harness** para el arnés.
- ⚠ Gotcha del nodo `ecommerce`: la entrada ecommerce se **degrada en local** por Mixed Content (el SSR/resource routes leen `VITE_API_URL` HTTP y el browser no alcanza el host interno) → probar contra **dev**, no local puro.
- Verdicto de éxito = `user_request_status_id === 11` en el polling de `ecommerce-continue`.

## Bitácora
- **2026-04** — desarrollo en las ramas `feature/onboarding/ecommerce-web-origination` (backend #503, 15 archivos · frontend #363, 15 archivos con 2 rutas net-new). Probado en dev.
- **2026-07-18** — registrado como task del árbol de context (Miguel confirmó: hecho en dev, sin merge, estado pruebas locales). Superficie = 27 archivos que resuelven contra el índice; los 2 `.tsx` net-new (`checkout-redirection`, `ecommerce-continue`) y `pnpm-lock.yaml` quedan en prosa (no están en el índice de `main`).

## Pendientes
- [ ] Mergear #503 y #363 (siguen abiertas desde abril 2026; base `develop`).
- [ ] Extender el cutover: hoy solo `[24,209,210,211,311]` (Corbeta) van a legacy vía `WoocommerceController`; el resto del ecommerce sigue server-rendered en el monolito.
- [ ] Borrar la lógica ecommerce duplicada en `application` una vez mergeado (el objetivo "quitar de application").

## Enlaces
- PRs: [legacy-backend #503](https://github.com/Creditop-SAS/legacy-backend/pull/503) · [frontend-monorepo #363](https://github.com/Creditop-SAS/frontend-monorepo/pull/363).
- Contexto del canal: **ecommerce**. Fase que reubica: **onboarding**. Costura de migración: **architecture**.
