# frontend-monorepo · contexto
> **estado:** al día con main · Monorepo Turborepo + pnpm del wizard de originación (React Router v7 con SSR). Cliente HTTP puro: no toca la BD, habla con **5 backends** distintos y "streamea" las pre-aprobaciones lender-a-lender como Promises del loader.

## Qué es
Repo `frontend-monorepo`: **1.198 archivos `.ts/.tsx/.js/.mjs`** en **21 workspaces pnpm** (`pnpm-workspace.yaml` → `apps/*`, `packages/**`, `modules/**`). El producto real es **uno solo**: `apps/loan-request-wizard`, el wizard de originación que ve el cliente y el asesor. Todo lo demás es soporte (design system, storybook, landing Astro) o esqueleto vacío.

**No decide crédito y no tiene base de datos.** Captura monto/datos, pide el formulario dinámico, dispara el listado de lenders y resuelve las pre-aprobaciones. Todas las decisiones (listado, cupo, reglas, veredicto) viven en **legacy-backend** o en el **MS Go de pre-aprobaciones** — nodos hermanos. Este nodo cubre **el repo como artefacto de ingeniería**: topología, sabores DDD, ruteo, frontera HTTP, entorno/build/deploy, convenciones declaradas vs. reales y deuda.

Dos rarezas estructurales lo definen: (a) **el wizard nuevo NO pasa por el PHP para la pre-aprobación rt≠0** — su loader consume el MS Go server-to-server; y (b) **el "streaming" del marketplace no es SSE ni polling de cliente**: son Promises sin resolver que React Router v7 serializa a través del stream SSR.

## Contenido

### Topología: 3 anillos, 21 workspaces
| Anillo | Qué es | Contenido real |
|---|---|---|
| **`apps/*`** (407 archivos) | Aplicaciones desplegables | `loan-request-wizard` **252** (el producto) · `storybook` **154** (139 stories) · `landing` (Astro, marketing) · **`admin` = solo un `.gitignore`** (ni siquiera es workspace; último toque 2026-05-25) |
| **`modules/loan-request-wizard/*`** (668) | 11 módulos de negocio, cada uno workspace `@creditop/<nombre>` | ver tabla abajo |
| **`packages/**`** (120) | Librerías transversales | `ui` 49 (shadcn `new-york` sobre Radix, iconos Tabler) · `shared/{assets,components,hooks,utils}` 39 · `form-engine` 32 · `tsconfig` |

**Los 11 módulos** (archivos `.ts/.tsx`):

| Módulo | # | Qué resuelve |
|---|---|---|
| `bancolombia-origination` | 215 | El más grande: BNPL + Consumo (onboarding, términos, oferta, firma, procesamiento); `ports/{onboarding,origination}` + `ui/{kit,layouts,state,theme}` propios |
| `lenders-marketplace` | 110 | Listado, cards, pre-aprobación async, selección de lender |
| `loan-origination` | 58 | Post-selección: IMEI, firma de pagaré, cronograma, estado (`echo.service.ts` = Pusher) |
| `loan-application-form` | 51 | Alta: `partner-info`, `phone-number`, `phone-otp`, `personal-info`, `employment-info`, `lender-otp` |
| `identity-validation` | 50 | KYC multi-proveedor (`aws` / `ado` / `crosscore`) + `lib/polling/` + socket |
| `consumer-hub` | 49 | Autogestión **post-desembolso** (cuotas, documentos, medios de pago) — único que apunta a `VITE_GATEWAY_URL` |
| `backend-driven-form` | 47 | Formularios que define el `form-service`; incluye un mock de **2.576 líneas** |
| `dynamic-form` | 32 | Formularios del flujo *dynamic* (`PersonalInfoForm` 896 líneas, `FinancialInfoForm` 577) |
| `abaco` | 27 | Ábaco / scraping gig-economy: selección de plataforma + OTP |
| `customer-profile` | 13 | Perfil financiero (`FINANCIAL_HEALTH_API_URL`) |
| `landing-wizard` | 4 | Solo `components/` — **no tiene DDD** |

### Dos sabores DDD + tres lugares donde viven los módulos
`CLAUDE.md` advierte "no asumas el sabor DDD, leelo del módulo". Verificado, son literalmente dos:

- **Sabor "lib"** (7 módulos: consumer-hub, customer-profile, dynamic-form, identity-validation, lenders-marketplace, loan-application-form, loan-origination) → `src/lib/{application,domain,infrastructure,ports,types,utils}` + `src/components/`.
- **Sabor "flat"** (3 módulos: abaco, backend-driven-form, bancolombia-origination) → `src/{application,domain,infrastructure,ports,ui}`, que es el que documenta `AGENTS.md`.

Y los módulos viven en **tres** sitios, no dos: además de `modules/loan-request-wizard/*`, la app tiene **6 módulos DDD internos** en `app/modules/` (`allied-theme`, `imei`, `personal-info-config`, `request-management`, `user`, `user-profiling`) con la forma `{types,application,infrastructure,ports}` pero **sin extraer a workspace**. El tercer sitio es `apps/loan-request-wizard/utils/auth/` — 4 archivos **fuera de `app/`** (ver Gotchas).

### El wizard: React Router v7, routing declarativo, SSR
`app/routes.ts` (301 líneas) declara **134 `route()` + 2 `index()` + 1 `layout()` → 127 archivos de ruta**. Cinco familias de URL:

1. **`/:flow/:partner_hash/…`** — público, sin auth. `:flow` sólo admite **`ecommerce`** o **`self-service`** (`public-layout.tsx:11` redirige a `/` con cualquier otro valor). Es el camino del cliente final: `solicitar` → OTP → `personal-info` → `lenders` → CreditopX (confirmación, KYC, firma, Ábaco, IMEI/SmartPay).
2. **`/merchant/:partner_hash/…`** — el asesor. `default-layout.tsx:21` exige **Cognito** (`requireUserWithSession`) y siembra `session.set("alliedCountry", …)` en `:36`. Incluye el sub-árbol `merchant-dynamic-layout` con las 5 pantallas `request-{amount,phone,otp,personal-info,financial-info}`.
3. **`/bancolombia/…`** — origination propia con **4 layouts** (onboarding / shared / origination / response) y dos ramas: `bnpl` y `consumo`.
4. **`/consumer-hub/…`** — 12 rutas de autogestión post-desembolso.
5. **Auth + infra** — `/login`, `/logout`, `/aliados-sso`, `/auth/callback`, `/health`, `/messages/*`, y `form-preview/:user_request_id/:form_type_id` **gateado a no-producción** (`routes.ts:3`).

El contexto de ruta se resuelve en un único helper: `RouteContext = "ecommerce" | "merchant" | "self-service"` (`route-helpers.ts:4`), con `ROUTE_PREFIXES` (`:11`), redirección al panel viejo `https://aliados.creditop.com` (`:17`), la fábrica `createRouteHelpers()` (`:132`) y el registro `ROUTE_PATHS` de 46 entradas (`:189`).

Hay **5 resource routes** en `app/routes/api/` (sólo `loader` o sólo `action`, sin `default export`) más `preapproval-retry` y `soft-update`.

### La frontera HTTP: cinco backends, cero BD
| Variable | Apunta a | Cómo se lee | Quién la usa |
|---|---|---|---|
| `VITE_API_URL` | **legacy-backend** (`legacy-backend.inertia-develop`) | 65× `import.meta.env` + 3× `process.env` | 50 archivos — el grueso |
| `VITE_PREAPPROVALS_ENDPOINT` | **MS Go de pre-aprobaciones** (`POST /v1/preapprovals/check`) | **sólo `process.env`** (server-only) | `available-lenders.tsx:147`, `preapproval-retry.tsx:26` |
| `VITE_GATEWAY_URL` | gateway (`api.dev.creditop.com`) | `import.meta.env` | sólo `consumer-hub` |
| `VITE_ONBOARDING_FORM_SERVICE` | `onboarding-forms-service:8092/v1` | `import.meta.env` | sólo rutas `app/routes/dynamic/*` |
| `VITE_FORM_SERVICE_BASE_URL` | `form-service:8082` | `import.meta.env` | sólo `backend-driven-form` |
| `FINANCIAL_HEALTH_API_URL` | `financial-health.dev.creditop.com` | `process.env` | sólo `customer-profile` |

Familias de endpoint que consume de legacy: `/api/onboarding/*` (loan-application, bancolombia, motai, scraping gig-economy, welli, otp, identity/crosscore, generate-qr, payment-plan, corbeta), `/api/loans/*` (customer requests, consumer credits, `requests/device` = IMEI, promissory-note, user-profiling), `/api/partners/*` (requests, products, dynamic-form/session, user-request-product) y `/api/identity/*`. Autenticación hacia el back: un solo header, `x-cognito-identity-id` (`backend-auth-headers.server.ts:12`).

**Dos clientes HTTP conviven** (ADR-0001 en `DECISIONS.md` fija `HttpClient` para código nuevo): de **49 repositorios en `infrastructure/`**, **13 usan `HttpClient`** (`http-client.ts:101`, timeout default **90s**, envelopes normalizados, `ApiResult<T>`, `traceparent`) y **34 siguen con `fetch` crudo** + `import.meta.env.VITE_API_URL` inline. Hay además **41 interfaces** en `ports/`. Lo que hace tolerable el `fetch` crudo es que `installObservedFetch()` (`observed-fetch.server.ts:24`, invocado en `entry.server.tsx:18`) **monkey-patchea `globalThis.fetch` en el server** para loguear fallas con correlación.

### El "streaming" del marketplace (el mecanismo real)
1. El loader (server) espera **`lenders-v2`** — llamada bloqueante con **timeout duro de 60s** (`loan-options.repository.ts:15`, endpoint en `:26`).
2. Filtra elegibles (`response_type !== STANDARD`, `available-lenders.tsx:188`) y **lanza una Promise por lender sin await** (`:209`). Los `is_fallback_lender` esperan a que todo el lote primario termine (`:231`). Las 4 variantes Welli **comparten una sola consulta** (`:200-229`).
3. Devuelve el mapa `preApprovals: Record<lenderId, Promise<…>>` **sin resolver** (`:251`, `:332`).
4. **React Router v7 serializa las Promises pendientes por el stream SSR**; el cliente las recibe como Promises reales y las consume con `<Await>` (`:773`).
5. `DeferredLenderResolutionAdapter` (`deferred-lender-resolution.adapter.ts:16`) hace `await` de cada una por separado y empuja el estado terminal a `useProgressiveLenderResolution`, que re-renderiza card por card. El puerto (`lender-resolution.port.ts:8`) está diseñado para poder cambiar a SSE/WebSocket sin tocar la UI.

El payload al MS y el mapeo de estados están en `fetch-lender-preapproval.ts`: product key (`:148`, CreditopX y Welli comparten key), payload (`:154`), POST (`:173`), y el polling **exclusivo de Credifamilia** (`:266` → config en `:44`, 6 intentos, backoff, `overallTimeoutMs` **180s**). El veredicto se canoniza a la unión discriminada `LenderResolutionState` (`lender-resolution.entity.ts:32`) y se fusiona con la entidad en `mergeLenderWithResolution()` (`lender-resolution.service.ts:106`).

### Entorno, build y despliegue
**Tres mecanismos de entorno distintos, y hay que saber cuál aplica:**
- `import.meta.env.VITE_*` → **inlineado en build** (Docker `ARG` desde `dockerfile_args` del workflow). Cambiarlo exige rebuild.
- `process.env.*` → **runtime, sólo server** (secrets del task ECS). Es el caso de `VITE_PREAPPROVALS_ENDPOINT`, que por eso **nunca viaja al bundle del cliente**.
- `window.ENV` → runtime server→cliente, vía script inline con nonce en `root.tsx:48`, alimentado por la allowlist `getEnv()` (`env.server.ts:49`).

`env.server.ts:3` valida el entorno con Zod y **falla al arrancar** (`init()` en `entry.server.tsx:16`), pero el schema cubre **15 variables** y deja fuera `VITE_PREAPPROVALS_ENDPOINT`, `VITE_GATEWAY_URL`, `VITE_ONBOARDING_FORM_SERVICE`, `VITE_FORM_SERVICE_BASE_URL`, `FINANCIAL_HEALTH_API_URL` y `SESSION_SECRET`.

SSR en `entry.server.tsx`: `renderToPipeableStream`, nonce aleatorio por request, CSP + HSTS aplicados en `security-headers.server.ts:110` (con `frame-ancestors 'none'`, `:98`) y **`streamTimeout` = 240s en staging / 45s en el resto** (`:15`), con `abort` a `streamTimeout + 1000` (`:105`).

Deploy (workflows que delegan en `Creditop-SAS/config-ci`): `develop` → dev, `staging` → stg + storybook, **tags** → prod. Cada app se empaqueta con `turbo prune <app> --docker`. **Ningún workspace se publica como artefacto**: todos exportan `./src/index.ts` crudo y el bundler los compila (`vite.config.ts:60`, `ssr.noExternal: [/^@creditop\//]`). La **única excepción es `@creditop/form-engine`**, que sí tiene `build` (tsup → `dist/`) — de ahí que los merges que rompen el empaquetado se manifiesten siempre ahí.

Observabilidad: `withRouteLogging(routeId, lifecycle, handler)` (`route-logging.server.ts:26`) envuelve **77 de 104** archivos de ruta con loader/action; los logs salen por **OTLP hacia PostHog** (`posthog-logging.server.ts:126` → `${POSTHOG_HOST}/i/v1/logs`), y la taxonomía de eventos vive en `analytics-taxonomy.ts`.

### Convenciones declaradas vs. adopción real
`CLAUDE.md` + `AGENTS.md` + `DECISIONS.md` + `.cursorrules` fijan el norte; el código va detrás:

| Convención declarada | Realidad medida |
|---|---|
| "No usar `Result` / `neverthrow`" | **36 archivos** lo importan (todo `loan-application-form`, `loan-origination`) |
| `HttpClient` para código nuevo (ADR-0001) | 13 de 49 repos infra |
| Componentes < 300 líneas | `LenderCardContent.tsx` 1.070 · `identity-validation.repository.ts` 1.012 · `PersonalInfoForm.tsx` 896 · `AvailableLenders.tsx` 806 |
| Tests sobre use-cases (vitest) | **13 archivos de test** en todo el repo |
| Biome: 6 espacios, 120 cols, `noConsole: error` | Sí en `app/**`; `utils/auth/**` queda **fuera del scope** del linter |
| `pnpm run test` (AGENTS.md) | **No existe**: ni script raíz ni tarea `test` en `turbo.json` |
| `pnpm typecheck` (CLAUDE.md) | Sólo existe dentro de `apps/loan-request-wizard` |

Scaffolding: `plop/generators/module.js` genera **sólo** `package.json` + `tsconfig` + `vite.config` + `biome.json` + `src/index.ts` — **no impone ningún sabor DDD**, por eso divergen. Commits vía Commitizen (`.cz-config.js`). **No hay `data-testid` en ningún archivo del monorepo** (ni `data-test`, `testId`, `data-cy`): la automatización E2E externa no tiene ganchos estables y depende de texto/roles.

## Dónde mirar
**Entrada y ruteo** (`apps/loan-request-wizard/`): `app/routes.ts:3` (gate del form-preview) · `:8` (`:flow` público) · `:70` (`merchant`) · `:148` (bancolombia self-service) · `:258` (consumer-hub) · `:291` (health) · `app/entry.server.tsx:15-18` (streamTimeout, `init()`, `global.ENV`, observed-fetch) · `app/root.tsx:48` (`window.ENV`) · `app/utils/route-helpers.ts:4/11/17/132/189` · `vite.config.ts:60` (`noExternal @creditop/*`) · `react-router.config.ts`.

**Layouts / auth**: `app/layouts/public-layout.tsx:11` (valida `:flow`) · `app/layouts/default-layout.tsx:21` (Cognito obligatorio) `:36` (siembra `alliedCountry`) · `app/layouts/{base,navbar,merchant-dynamic}-layout.tsx` · `app/layouts/bancolombia/origination-layout.tsx` · `utils/auth/auth.server.ts:29` (OAuth2 Cognito) · `utils/auth/auth-helpers.server.ts` (refresh + revocación) · `utils/auth/session.server.ts:5` (cookie `_session`) · `utils/auth/oauth2-cookies.server.ts` · `app/server/services/session.server.ts:7` (cookie `__session`).

**Frontera HTTP y observabilidad**: `app/utils/backend-auth-headers.server.ts:12` · `packages/shared/utils/src/network/http-client.ts:11/101` · `.../network/result.types.ts` · `.../observability/trace-context.ts` · `app/utils/observed-fetch.server.ts:24` · `app/utils/route-logging.server.ts:26` · `app/utils/posthog-logging.server.ts:126` · `app/utils/trace-context.server.ts` · `app/utils/security-headers.server.ts:98/110` · `app/utils/nonce.ts` · `app/utils/env.server.ts:3/49` · `app/utils/analytics-taxonomy.ts`.

**Marketplace (el camino caliente)**: `app/routes/lenders-marketplace/available-lenders.tsx:147` (endpoint MS) `:188` (elegibles) `:209` (fan-out) `:231` (fallback) `:251` (mapa sin resolver) `:773` (`Await`) · `modules/…/lenders-marketplace/src/lib/infrastructure/repositories/loan-options.repository.ts:15/26` · `.../adapters/fetch-lender-preapproval.ts:44/148/154/173/266` · `.../adapters/deferred-lender-resolution.adapter.ts:16` · `.../domain/entities/lender-resolution.entity.ts:32` · `.../domain/entities/loan-option.entity.ts` · `.../domain/constants/lender.constants.ts` · `.../domain/services/lender-resolution.service.ts:106` · `.../mappers/lender-response.mapper.ts:311` (re-ordenamiento) · `.../ports/services/lender-resolution.port.ts:8` · `.../components/available-lenders/AvailableLenders.tsx:145` · `.../hooks/useProgressiveLenderResolution.ts:10` · `app/routes/lenders-marketplace/lenders/preapproval-retry.tsx:26`.

**Módulos internos de la app** (`app/modules/`): `personal-info-config/infrastructure/personal-info-config.repository.ts:14` (config del form) · `user-profiling/infrastructure/user-profiling.repository.ts` (único consumidor de `HttpClient` en la app) · `request-management/infrastructure/request-management.repository.ts` (legacy aceptado por ADR-0001) · `user/infrastructure/user.repository.ts` · `allied-theme/infrastructure/allied-theme.repository.ts` · `imei/infrastructure/device-imei.repository.ts`.

**Rutas representativas**: `app/routes/loan-application-form/phone-number.tsx:67` (gate RD → flujo *dynamic*) · `app/routes/dynamic/request-amount.tsx:201` · `app/routes/loan-continue.tsx` (handoff/QR) · `app/routes/api/lender-results.tsx` (resource route) · `app/routes/form-preview.tsx` (preview dev del backend-driven-form) · `app/routes/health.tsx` · `app/routes/auth/callback.tsx`.

**Módulos y paquetes (superficie pública)**: los 11 `modules/loan-request-wizard/*/src/index.ts` · `loan-application-form/src/lib/infrastructure/partner-info.repository.ts` (HttpClient) · `customer-profile/src/lib/infrastructure/financial-profile.repository.ts` (`FINANCIAL_HEALTH_API_URL`) · `backend-driven-form/src/infrastructure/repositories/dynamic-form-schema.repository.ts` (`VITE_FORM_SERVICE_BASE_URL`) · `consumer-hub/src/lib/infrastructure/phone-number.repository.ts` (`VITE_GATEWAY_URL`) · `identity-validation/src/lib/infrastructure/identity-validation.repository.ts` (1.012 líneas) · `packages/ui/src/index.ts` · `packages/form-engine/src/{index.ts,renderer.tsx}` · `packages/shared/utils/src/index.ts` · `apps/storybook/src/main.tsx`.

**Scaffolding**: `plopfile.js` · `plop/generators/module.js` · `.cz-config.js`.

## Gotchas / riesgos
- **`lenders-v2` NO es SSE ni polling de cliente.** El progreso card-por-card sale de **Promises sin resolver serializadas por React Router v7** en el stream SSR (`available-lenders.tsx:251` → `:773` → `deferred-lender-resolution.adapter.ts:16`). El único polling real es **server-side y sólo para Credifamilia** (`fetch-lender-preapproval.ts:266`).
- **`streamTimeout` (45s) < poll de Credifamilia (180s).** `entry.server.tsx:15` corta el stream a los 45s salvo en staging (240s), mientras `DEFAULT_CREDIFAMILIA_POLL.overallTimeoutMs` es 180s (`fetch-lender-preapproval.ts:54`). Fuera de staging la card puede morir antes de que el MS conteste. El timeout de fetch por intento (40s) sí es **deliberadamente mayor** al `write_timeout` del MS (30s): abortar en el mismo instante duplicaba transacciones en Credifamilia (`:36-41`).
- **Dos cookies de sesión distintas y fáciles de confundir**: `_session` (un guion bajo, secret `AUTH_SECRET`, dominio `.creditop.com`, 7 días — guarda `user`, `merchant-mode`, `alliedCountry`) en `utils/auth/session.server.ts:5`, vs `__session` (dos guiones, secret `SESSION_SECRET`) en `app/server/services/session.server.ts:7`, que sólo guarda el `sessionId` del form dinámico. Ambos exportan un símbolo llamado `sessionStorage`.
- **`apps/loan-request-wizard/utils/` está fuera del linter.** El `biome.json` de la app sólo incluye `app/**`, así que los 4 archivos de `utils/auth/` no se formatean ni se lintean (indentan a 2 espacios en vez de 6, usan `any`). Se importan con el alias `@/…` (raíz de la app), distinto de `~/…` (que apunta a `app/`).
- **`response_type` está duplicado en el front.** `lender.constants.ts` hardcodea la tabla (`STANDARD 0`, `PRE_APPROVED 1`, `CREDITOP_X 2`, `CREDITOP_X_REVOLVING 3`) y **`isPreApprovalFlowLender()` ya acepta `4`** (usado en 4 lugares reales), pese a que `4` no está nombrado en la unión.
- **IDs de lender quemados en el front**: Credifamilia `24`, Welli `[23,141,142,166]`, Bancolombia `[68,100]`, Motai `[158]`, Meddipay `39`, Prami `12`, y `[160]` (SmartPay) para ocultar el tag de cupo — este último con un `TODO(backend)` explícito. También `path_id 3` = gestión manual y `path_id 2` = flujo IMEI.
- **El front re-ordena el listado** que ya viene ordenado del back: `filterAndSortLenders()` (`lender-response.mapper.ts:311`) aplica recomendado → bloque pre-aprobado → grupo de probabilidad → `sort`, explícitamente porque "en v2 la probabilidad llega obsoleta".
- **`low_probability` es una rama muerta**: el `kind` está declarado (`lender-resolution.entity.ts:35`) y hay tres consumidores, pero **ningún productor** — `statusToState()` nunca lo construye. `encrypt_code` está en el schema (`:23`) y no lo lee nadie dentro del marketplace. **Corrección al doc anterior: `frontend_response` SÍ está vivo** — es la "respuesta al frente" de Bancolombia Consumo, con branch propio en `lender-resolution.service.ts:43` y fix reciente en `main` (a605beb7).
- **7 rutas huérfanas** existen en `app/routes/` pero no están en `routes.ts` ni las importa nadie: `lenders-marketplace/lenders/soft-update.tsx` (action completo contra `soft-update-user-request`), `dynamic/dynamic.tsx`, `bancolombia/bnpl/ecommerce-errors.tsx`, `merchant/example.tsx`, `request-status.tsx`, `validation-pending.tsx`, `waiting-validation.tsx`. Además **10 de las 46 claves de `ROUTE_PATHS`** no se usan, y `ROUTE_PATHS.requestStatus` apunta a una ruta que ni siquiera está registrada.
- **El redirect de entrada a `/modes` está comentado** (`phone-number.tsx:131-133`). La ruta sigue viva y se alcanza desde `loan-continue.tsx` y `financial-profile.tsx`, pero el gate automático por `redirectToModes` no corre.
- **CI: los filtros de path se saltan dos paquetes.** `loans-dev` observa `apps/loan-request-wizard/**` + `packages/ui/**` + `modules/loan-request-wizard/**`, y `loans-stg` cambia a `modules/**`. **Ninguno incluye `packages/shared/**` ni `packages/form-engine/**`**, así que un cambio en `HttpClient` o en el form-engine no dispara deploy (queda el escape manual `loans-manual-*`). El de storybook sí los incluye.
- **Restos de otro repo en la CI**: `run-migrations.yml` ejecuta `php artisan migrate` en un monorepo 100% TypeScript sin BD (último toque 2025-08-20, y encima le faltan continuaciones de línea). Y `.github/workflows/README.md` documenta workflows que **no existen** (`main-dev.yaml`, `build.yaml`, `push.yaml`, `deploy.yaml`) y un servicio ECS llamado `application`.
- **Versión de pnpm inconsistente a tres bandas**: `package.json` pinea `pnpm@8.15.6`, `README.md` pide `>=9.12`, el `Dockerfile` hace `corepack prepare pnpm@9`.
- **Fuga de capas**: `lenders-marketplace/src/lib/index.ts:1` re-exporta componentes React (`LenderCard`, `LenderLogo`) desde el barrel de dominio/aplicación.

## Preguntas abiertas
- ¿`APP_ENV` llega realmente como `"staging"` en el cluster de stg? De eso depende que `streamTimeout` sea 240s y no 45s, y el valor viene del task-def / secret (`dev/loan-request-wizard`), no del repo. Si no llega, el corte de Credifamilia es sistemático también en stg.
- ¿Alguien produce `low_probability`? No hay constructor en este repo; habría que confirmarlo contra el contrato del **MS Pre-approvals**.
- Las 7 rutas huérfanas: ¿deuda a podar o preparación de features? `soft-update.tsx` es sospechoso porque el endpoint backend (`soft-update-user-request`) sí existe.
- `apps/admin` (sólo `.gitignore`, último commit 2026-05-25): ¿placeholder reservado o abandonado?
- El gap de deploy de `packages/shared/**` y `packages/form-engine/**`: ¿se cubre de hecho con los workflows manuales o hubo despliegues con esos paquetes desactualizados?
- Sin `data-testid` en ningún lado: ¿el harness E2E externo se apoya en texto/roles a propósito, o es deuda a saldar del lado del front?

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (MAP.md §0 tabla Repos + Apéndice C índice frontend + S3/S6 camino B).
- **2026-07-18** — Fase de data: nodo documentado por ANALISIS DE CODIGO (no habia doc fuente) + superficie curada.

## Enlaces
- **Padre:** Architecture (índice de repos: application / legacy-backend / frontend-monorepo / ms-preapprovals).
- **Hermanos con frontera explícita:** **MS Pre-approvals** (contrato del MS Go; acá sólo el lado cliente) · **Legacy-backend** (dueño de `lenders-v2`, cupo y reglas) · **Application** (monolito vivo; el wizard nuevo no lo consume) · **Dynamic Forms** (concepto backend-driven; acá sólo repos/rutas) · **Onboarding**, **CreditopX**, **Aggregator**, **Redirect**, **KYC**, **Formalization**, **Profiling** (fases del flujo) · **SmartPay**, **Motai-v2**, **MotaiX**, **Pullman**, **Merchants** (familias de lender/comercio).
- **Memorias:** `[[frontend-e2e-setup]]`, `[[frontend-e2e-asesor-commands]]`, `[[frontend-e2e-split-view]]` (el gotcha de `process.env.VITE_API_URL` en SSR), `[[frontend-e2e-wizard-dev-gotchas]]` (el "Server Timeout" del `streamTimeout`), `[[develop-merge-wizard-deps-fix]]` (form-engine, el único paquete con build), `[[pre-approvals-service]]`, `[[lender-listing-cascade]]`, `[[orden-lenders-ml-desactivado]]`, `[[playground-convention]]`.
- Material histórico de `playground/docs` (removido de main): citar como `git 159906a:docs/<ruta>`.
