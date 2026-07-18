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

## Cómo probar / validar
- Flujo E2E de ecommerce: `bin/ecommerce` de **frontend-e2e** (ver nodo **harness**). Como el front vive en develop, apuntá el harness a **dev/develop**, no a main.
- ⚠ Gotcha (nodo `ecommerce`): la entrada ecommerce se degrada en local por Mixed Content — el motivo mismo del rediseño stateless.
- Verdicto: el wizard rehidrata el monto/prefill desde `ecommerce-context.server.ts` sin cookie y cierra a Estado 11.

## Bitácora
- **2026-04** — 1er intento "web-origination" (PRs 503/363, rama `feature/onboarding/ecommerce-web-origination`): quedó **sin merge**, superado por el enfoque stateless.
- **2026-06-11** — mergeados los squash `bb14a8ff` (#795) y `d2242469` (#551).
- **2026-07-18** — registrado como task (corrige la versión previa de este nodo, que apuntaba por error a 503/363). Estado de merge verificado contra las ramas remotas: backend en main, front en develop. Superficie = 20 archivos que resuelven; 5 net-new del front + los adds van en prosa.

## Pendientes
- [ ] **Promover #551 (front) a main** — hoy solo en develop; hasta entonces la entrada stateless no corre en prod.
- [ ] Extender el cutover al resto del ecommerce no-Corbeta (sigue el array `[24,209,210,211,311]` en `WoocommerceController` del monolito).
- [ ] Borrar la lógica ecommerce duplicada en `application` una vez completo en main.

## Enlaces
- PRs: [legacy-backend #795](https://github.com/Creditop-SAS/legacy-backend/pull/795) · [frontend-monorepo #551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551).
- Canal: **ecommerce** · fase: **onboarding** · enganche: **payments** · costura: **architecture**.
