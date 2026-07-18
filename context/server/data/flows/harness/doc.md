# Harness E2E · contexto
> **estado:** al día con main (índice recién creado; los dos harness ya son linkeables) · La infra de PRUEBAS que ejercita la originación de crédito punta a punta. Dos arneses hermanos que espejan el mismo modelo `[canal] → [comercio] → [lender]`: **backend-e2e** (Go, sin navegador, contra el `legacy-backend` local) y **frontend-e2e** (Playwright/TS, maneja el wizard React real). Eje central: la **frontera de inyectabilidad** (rt=2/3 in-platform SÍ se inyectan; rt=1 lo decide una API externa).

## Qué es
Cuando necesitás **probar / ejercitar / mockear un flujo de originación** (¿este comercio ofrece este lender?, ¿el cierre llega a Estado 11?, ¿la notificación a la tienda dispara?, ¿el motor de riesgo rechaza este perfil?), estos dos repos son la herramienta. No son producto: son el arnés que corre el producto contra un stack local (o dev acotado) y **asevera** el resultado.

Los dos se organizan por los **tres ejes** de la originación y componen cualquier combinación al vuelo:

| Arnés | Motor | Cómo entra | Contra qué corre |
|---|---|---|---|
| **backend-e2e** | Go (`creditop-tests`), sin UI | HTTP directo al API `api/onboarding/*` | `legacy-backend` LOCAL en modo mock (Docker/Sail, `127.0.0.1:80`) |
| **frontend-e2e** | Playwright + TS, maneja el wizard | el wizard `loan-request-wizard` (:5174) | DEV por defecto (RDS + Cognito real) o LOCAL (`--local`, legacy en Docker) |

La regla que hace todo esto posible: el perfil aprobado NO se arma llamando centrales — se **inyecta** (seed vía `php artisan tinker` en backend-e2e; `synthFill` in-process con `mysql2` en frontend-e2e). El KYC real (Experian/TusDatos/AgilData/Mareigua) y los mocks fake por-request (`X-Fake-Scenario`) se **retiraron** del camino feliz; sobreviven solo en los specs de contrato negativo.

> Ambos repos son **LOCAL, nunca se pushean** (sin remoto). Ver memoria `playground-convention`.

## Contenido

### 1. backend-e2e — el CLI `[canal] → [comercio] → [lender]`
Un solo binario Go compone y corre el triplete. `web`/`asesor`/`vtex` es el **canal** (1er posicional), el resto es comercio + lender(es). Lista con comas = **matriz** (un cierre por lender, datos aislados por `variant()`). Comercio y lender se resuelven **por nombre/slug/hash/id desde la BD** (`merchant.Resolve`/`lender.Resolve`) — nada quemado en el comando.

| Comando | Args | Qué hace | Archivo |
|---|---|---|---|
| `web`/`asesor`/`vtex <comercio> <lender[,…]>` | canal→comercio→lender | `runDynamic`→`runOne`: compone el triplete como **un flujo numerado** (entrada del canal → verificación del comercio → cierre del lender). vtex = el harness hace de **conector VTEX** (init base64 → create → cierre → webhook → settle). | `backend-e2e/main.go` |
| `flow <ecommerce> <merchant> <lender> [state]` | comando **unificado** ecommerce | `runFlow`: parametriza por entorno·notificador·comercio·lender·state. rt 2/3 + `approved` → cierre REAL (+settle si VTEX); agregadores rt 0/1 o `state=rejected` → **SIMULADOR** (cambia estado vía Eloquent → `UserRequestObserver` notifica). | `backend-e2e/flow.go` |
| `aggregator <comercio> [status=11]` | webhook de agregador | `runAggregatorSim`: entrada ecommerce SIN cierre + cambia estado → el observer notifica al `process_url`. El harness NO puede cerrar agregadores. | `backend-e2e/main.go` |
| `smartpay [branch]` | cadena OTP+submit | `runSmartpay`: replica la cadena BDUS/BDTM/DYFS que el `onboarding-forms-service` hace contra legacy (el micro NO se levanta). Códigos en `code`, no en HTTP status. | `backend-e2e/main.go` |
| `perfilador <comercio> <lender>` | motor de riesgo | `runPerfilador`: varía el perfil (score/ingreso/edad/reportado) y asevera que el marketplace OFRECE o RECHAZA el lender. **Oracle de umbrales leído de BD** (no hardcode). | `backend-e2e/main.go` |
| `offer <comercio>` | descubrimiento | `runOffer`: onboarding asesor + `GET /lenders` para ver qué ofrece un comercio (siembra score 750 antes). | `backend-e2e/main.go` |
| `comparev2 <comercio>` | drift v1↔v2 | onboardea 1 vez y compara `/lenders` (v1) vs `/lenders-v2` (el que usa el wizard). | `backend-e2e/main.go` |
| `random [N=5]` | smoke aleatorio | `runRandom`: N tripletas VÁLIDAS de `lenders_by_allieds` (filtro `rt IN (2,3) OR id IN (24,68,100)`) + mapa de completitud por rt. Los ❌ = gaps de config, no bugs del harness. | `backend-e2e/main.go` |
| `list` | catálogo | comercios (hash·nombre·slug·kind) y lenders (id·nombre·rt) de la BD. | `backend-e2e/main.go` |
| `prep --merchant X --lender Y [--asesor n] [--branch h] [--ecommerce] [--cognito-id sub]` | **siembra precondicionales** | branch + oferta `lenders_by_allieds` + credencial si rt=1 + asesor sintético namespaced. Exporta `E2E_*` (stdout, `eval`-friendly). Idempotente. | `backend-e2e/prep.go` |
| `get <user-request\|merchant\|lender> <arg> [--json]` | inspector read-only | espejo de `kubectl get`/`gh pr view`. Exit 0 OK · 1 not found · 2 args. | `backend-e2e/get.go` |
| `create <role> <merchant> [branchHash]` | usuario sintético | UPSERT idempotente por `cognito_id` (rol+comercio+branch). Nunca borra en bulk. | `backend-e2e/create.go` |
| `doctor [--json]` | diagnóstico | 8 checks del setup local (MySQL, esquema, scoring, OTP bypass, backend HTTP, drivers, stash, `.cognito.json`) con fix inline. | `backend-e2e/doctor.go` |
| `login [--show-token]` | probe Cognito | InitiateAuth (USER_PASSWORD_AUTH) contra el Cognito REAL. Read-only (no toca BD). Diagnóstico de qué auth flow permite el client. | `backend-e2e/login.go` |
| `clean [--seed X]` | limpieza namespaced | borra SOLO el namespace del seed + el ledger. Nunca bulk. | `backend-e2e/clean.go` |
| `setup` | BD nueva | migra esquema base + seed (countries id 60=RD para SmartPay, product_categories, statuses). | `backend-e2e/main.go` |
| flag `--explain` | documentación | imprime el paso a paso SIN ejecutar (no toca el backend). | `backend-e2e/pkg/flow/flow.go` |
| flag `--target=dev` | dev compartido | lee `E2E_DB_*`/`E2E_API_BASE_URL` de `.env.dev`. Solo read-only + `create`/`clean`; el flujo completo exige `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`. | `backend-e2e/pkg/config/config.go` |

Atajos `make` (wrappers, no indexados): `make run/ready <ecommerce\|asesor> <merchant> <lender>`, `make local/dev <ecommerce> <merchant> <lender> [state]`, `make scenario <name>`. El E2E completo con precondicionales + snapshot lo orquesta `scripts/flow.sh` (prep → flujo → get → clean opcional).

### 2. frontend-e2e — specs Playwright + el demo guiado
Maneja el wizard REAL hasta el listado de lenders (`/lenders`). Autosuficiente en TS: hace sus ops de BD con `mysql2` (`frontend-e2e/pkg/db.ts`) e inyecta el KYC in-process (`frontend-e2e/pkg/inject.ts`), sin shellear a `backend-mcp`. Organizado por los mismos ejes.

**El flujo principal** es el demo de 2 ventanas (`frontend-e2e/dev/guided.spec.ts`), orquestado por `bin/asesor <m> auto` / `bin/ecommerce <m> auto` (wrappers no indexados):
- Siembra cada pantalla (monto → teléfono bypass → OTP → personal-info) y **vos das "Continuar"**; en `/lenders` elegís el lender y el demo detecta **por conducta** (no por rt) cómo continuar: rt=2 CreditopX → handoff `continue` (A se queda, B=celular completa); rt=0/1 modal WhatsApp → webhook → Estado 11; rt=1 redirect → portal del banco → la entidad devuelve al comercio (`return_url`).
- `personal-info` NO se puede clickear real (su submit dispara AgilData/Mareigua/Experian) → `synthFill` inyecta KYC + fila Experian cifrada de forma invisible y auto-avanza.

| Spec / archivo | Estado | Qué valida |
|---|---|---|
| `frontend-e2e/dev/guided.spec.ts` | demo interactivo | el flujo guiado de 2 ventanas A/B; detecta el cierre por conducta. NO va a CI (necesita tus clicks). |
| `frontend-e2e/e2e/triplet.spec.ts` + `frontend-e2e/e2e/triplet.ts` | ✅ entrada | composable `canal→comercio→/lenders`, espejo del CLI Go. Override por `E2E_CHANNEL/E2E_MERCHANT/E2E_LENDER/E2E_AMOUNT`. |
| `frontend-e2e/e2e/happy-path.spec.ts` | ✅ | amount→phone→OTP→personal→[laboral]→lenders (Pullman salta laboral vía Quanto). |
| `frontend-e2e/e2e/marketplace-select.spec.ts` | ✅ | el testid `lender-action-{id}` expone el CTA seleccionable. |
| `frontend-e2e/channel/steps.ts` | infra | pasos atómicos del wizard + **ruteo post-OTP real** (`personal-info \| lenders`, luego `employment-info \| lenders`). |
| `frontend-e2e/channel/ecommerce-local-real.spec.ts` · `ecommerce-notify.spec.ts` · `ecommerce-ui.spec.ts` | ✅ | handshake base64 real → checkout → /lenders; notificación a la tienda (POST `process_url`); contrato (handshake incompleto = rechazado). |
| `frontend-e2e/channel/vtex-checkout.spec.ts` | canal VTEX | entrada VTEX por checkout. |
| `frontend-e2e/channel/otp-subcodes.spec.ts` | ✅ 2/5 + fixme | subcódigos OTP contra el shape REAL (`NO_PREVIOUS_OTP`/`CODE_INVALID`), aserción tolerante `assertSubcode`. |
| `frontend-e2e/merchant/seed.ts` | infra | helpers de seed por SQL/tinker (perfil aprobado, riesgo, estado/lender) — espejo de `pkg/mocks`. |
| `frontend-e2e/merchant/corbeta.spec.ts` | ✅ flujo | Corbeta (Alkosto allied 209): `otp-validate success:true` no-temporal → salta directo a /lenders. |
| `frontend-e2e/merchant/cupo-rotativo.spec.ts` | ✅ flujo / ⏸ rt=3 | flujo del partner a /lenders; la oferta rt=3 requiere seed de marketplace. |
| `frontend-e2e/merchant/motai-ui.spec.ts` | ✅ entrada (gated Cognito) | login Cognito → marketplace Motai (`f0548728`). Cierre #158/IMEI/Abaco pendiente. |
| `frontend-e2e/merchant/smartpay-dynamic.spec.ts` | ✅ completo (gated Cognito) | flujo dinámico de 5 pasos (`@creditop/dynamic-form`) → /lenders; re-apunta la cuenta a `bb534d6a`. |
| `frontend-e2e/merchant/pullman-credipullman.spec.ts` | ✅ Pullman / ⏸ #77 | Quanto auto-inyecta → salta laboral; #77 (rt=2) no lo ofrece el marketplace para `3e67eade`. |
| `frontend-e2e/merchant/pullman-omite-experian.spec.ts` · `pullman-confirmacion-cupo.spec.ts` | tarea activa | "Confirmación de cupo" → salta buró (ver memoria `pre-approval-omit-experian-frontend`). |
| `frontend-e2e/merchant/credifamilia.spec.ts` | ⏸ rt=4 async | polling/seed del flujo asíncrono. |
| `frontend-e2e/lender/close.ts` · `creditopx-close.spec.ts` · `wompi-close.spec.ts` | ✅ oferta / ⛔ cierre | siembra perfil → marketplace OFRECE #77; `creditopXClose` **lanza** con el diagnóstico del muro Wompi (ver Gotchas). |
| `frontend-e2e/dev/cognito-login.spec.ts` | setup | captura el estado de sesión Cognito (`.auth/cognito-state.json`). |

> ✅ = ≥1 test del archivo corre verde contra el stack real. `npm test` corre **muchos `test.fixme`** (placeholders del extinto mock-server `:4000`) que aparecen como `fixme`, no como pasados. La marca es **por-test, no por-archivo**.

### 3. La frontera de inyectabilidad (rt por rt) — el eje central del harness
Qué se puede sellar localmente vs. qué lo decide un tercero. Es lo que determina si un flujo es probable E2E o solo "parcial".

| response_type | Quién decide | ¿Inyectable? | Cómo lo prueba el harness |
|---|---|---|---|
| **rt=2 · Creditop X (in-platform)** | 100% en `legacy-backend` | **SÍ** (total) | siembra perfil aprobado (score) → `UPDATE user_requests` lender/rate/fee/`initial_fee=0` → promissory-note (PdfMapper fake) → send-otp → force-otp → `authorize` → **asserta Estado 11**. Es la rama **default** del switch de cierre (`backend-e2e/lender/lender.go`; el cierre en `backend-e2e/lender/closes.go`). |
| **rt=3 · Cupo Rotativo** | in-platform, igual que rt=2 | **SÍ** | `revolvingClose`: ciclo 1 crea `creditop_x_revolving_credits` + Pagaré Maestro → Estado 11; ciclo 2 verifica que la 2ª compra NO duplica el pagaré. |
| **rt=1 · Integración (Welli/Meddipay/CeroPay…)** | **API externa del lender** | **NO** | `externalClose` con el host **mockeado** (`fakeExternalLendersForLocal`): `GET /lenders` debe traer `pre_approved_lender=true` + `transaction_data`. **Cierre PARCIAL** (el cierre real es el portal externo). Neutraliza el corte horario (`available_until=NULL`). |
| **rt=1 · Bancolombia #68/#100** | motor PLS + API Bancolombia | **NO** (parcial) | `bancolombiaClose`: `validate-preapproved` (el motor PLS decide BNPL #68 vs Consumo #100) con `Http::fake` Bancolombia + override de documento `TestDoc=1998228194` (sandbox de cupo). Ruteado **por ID** antes que `rt==1`. No llega a Estado 11. |
| **rt=4 · Credifamilia #24 (async)** | radicación + polling SOAP | **NO** (async) | `credifamiliaClose`: radica (status 40) → polling `pre-approval-status` → asserta **APROBADO** (`lender_transactions.status_id=41`), no Estado 11. |
| **rt=0 · UTM / agregador** | webhook del lender externo | **NO** (simulado) | entrada ecommerce SIN cierre + `runAggregatorSim` cambia el estado vía Eloquent → el observer notifica al comercio. |

Por el lado UI la frontera es la misma pero además choca con un **muro de config** (Wompi) que impide cerrar rt=2 headless — ver Gotchas. El resumen operativo: **lo in-platform (rt 2/3) se inyecta y se sella a Estado 11; lo de integración (rt 0/1/4) se mockea el host y se valida la pre-aprobación / el handoff, nunca el cierre**.

### 4. Qué se mockea (y qué NO monta el harness)
Dos capas de mocks distintas:

**(a) Mocks del `legacy-backend` (NO son del harness; los aporta el legacy en modo mock).** Los `Http::fake` de proveedores + el fake de `PdfMapper` ya están **aplicados al working tree** del legacy (`AppServiceProvider.php:31-35`); reaplicables desde `git stash` (`stash@{0}` bypasses + SmartPay forms-service FAKE; `stash@{1}` cierre Creditop X / PdfMapper fake — requiere `PDF_MAPPER_FAKE=true`). Se levanta con `cd ../../github/legacy-backend && make up && make mock-all && make restart`.

**(b) Mocks propios del harness:**
- **StoreWebhook** (`backend-e2e/channel/storewebhook.go`, :9099): listener local que captura el webhook de cierre (`process_url`) para asertar que la tienda fue notificada. Bind `0.0.0.0` → el backend dockerizado lo alcanza por `host.docker.internal`.
- **mock-preapprovals** (`frontend-e2e/mock-preapprovals/server.mjs`, :8095): reemplaza al MS `pre-approvals-service` con respuestas deterministas (todas las cards pre-aprobadas). Status configurable POR lender vía `/tmp/mock-pa-statuses.json` (lo escribe el panel). Apuntar `VITE_PREAPPROVALS_ENDPOINT` acá.
- **mock-redirect** (`frontend-e2e/mock-redirect/server.mjs`, :8096): shim del "sitio del comercio" + el redirect de borde de infra (`/checkout/{hash}` → 302 al wizard; `/return` = destino del botón "volver al comercio").
- **wompi-mock** / `lender/wompi-close.spec.ts`: mock del webhook Wompi (aplica al webhook, NO al checkout hosted — de ahí el muro).
- **mock-store / mock-bank** (HTML, no indexados): la tienda y el portal del banco del demo guiado.
- **OTP bypass**: el teléfono se agrega al setting `qa_otp_bypass_phones` (`EnsureOtpBypass`, `backend-e2e/pkg/mocks/mocks.go`) → el OTP no pega a Twilio y el **código = últimos dígitos del teléfono** (4 en registro, 6 en el pagaré).
- **`X-Fake-Scenario`** (`frontend-e2e/pkg/mock-control.ts`): fuerza fallos categorizados (OTP/KYC) por request; intercepta `**/*` porque el wizard es SSR y el header debe llegar al FE server para que lo forwardee. Solo en specs de contrato negativo.

### 5. La inyección (el comando, no la semántica)
Cómo el harness fabrica un perfil aprobado sin llamar centrales:
- **backend-e2e**: `SeedApprovedProfile` / `SeedRiskProfile` (`backend-e2e/pkg/mocks/mocks.go`) shellean `php artisan tinker` dentro de `legacy-backend-laravel.test-1`: setean `users.age/gender`, `user_field_values` (29 ocupación, 87 ingreso, 160 reportado) y una fila `RiskCentralUserData` con score plano + `data` (el JSON de datacrédito). `RiskProfile` deja variar score/negativos/reportado/ingreso/edad/mora para el `perfilador`.
- **frontend-e2e**: `synthFill` (`frontend-e2e/pkg/inject.ts`) hace lo mismo in-process con `mysql2` + cripto estilo Laravel (`frontend-e2e/pkg/laravel-crypt.ts`) para la **fila Experian encriptada** con `APP_KEY`. Port 1:1 de `backend-mcp opSynthFill`.

La **semántica** de esos campos (qué score pasa, cómo se lee la fila Experian, qué regla datacrédito aplica) es turf de **profiling**/**datacredito** — acá solo el mecanismo de inyección.

### 6. Setup (Cognito, assign por SUB, puertos)
- **Puertos**: wizard `loan-request-wizard` **:5174**; panel del harness **:5195**; MySQL local `127.0.0.1:3306` (usuario `creditop`/`password`, schema `creditop`); API legacy `http://127.0.0.1:80/api` (vhost `legacy-backend.inertia-develop` por header `Host`). Mocks: :8095/:8096/:9099.
- **Cognito** (`/merchant/*` = Motai/SmartPay exigen sesión): credenciales en **`.cognito.json`** (raíz de frontend-e2e, gitignored) `{user,pass}`, leídas por `frontend-e2e/pkg/config.ts`; el env `E2E_COGNITO_USER/PASS` tiene prioridad. El Hosted UI (`login.creditop.com`, pool compartido dev+local) lo maneja `frontend-e2e/pkg/cognito.ts`. Sin `.cognito.json` los specs de asesor **skipean** (no fallan). `backend-e2e login` es un probe read-only del mismo pool.
- **Assign por SUB**: el backend resuelve el comercio por `x-cognito-identity-id` = el **sub real** del login web. `bin/asesor` **asocia la fila `users` al comercio** vía `dbops assign` (usa el SUB como clave, `frontend-e2e/pkg/asesor.ts`) solo si el asesor no está ya en ese comercio (un asesor = un comercio). `prep --cognito-id=<sub>` hace lo análogo en backend-e2e. Revert: `dbops revoke`.
- **`.flows.json`** (frontend, gitignored): identidad del asesor (`email`/`sub`) + `merchants.<m>.branch_hash` + `otp_bypass_phone`. **`.env.<target>`** (dev/local): `E2E_DB_*`, `APP_KEY` (cifra la fila Experian), `I_KNOW_THIS_TOUCHES_SHARED_DEV=1` en dev.
- **El panel** (`frontend-e2e/panel/server.ts`, :5195): UI local que elige comercio, define el usuario sintético (nombre/ingreso/score) y lanza `bin/asesor <m>` con `E2E_INJECT=1` (inyecta buró invisible) o sin él (buró real). Switch sintético/real + status por lender del mock-preapprovals. Solo local (fuerza `E2E_TARGET=local`).

### 7. Namespacing y "nunca borrado en bulk"
En una BD compartida (dev) cada dev trabaja en su **seed** (`backend-e2e/pkg/identity/identity.go`, derivado de `usuario@host`, override `CREDITOP_SEED`): teléfonos/docs/cognito_id únicos, UPSERT, y borra SOLO lo suyo (`cognito_id LIKE '%__{seed}_test'`). Todo recurso creado se anota en un **ledger** JSON (`backend-e2e/pkg/ledger/ledger.go`, `.created-resources.json`) para borrarlo UNO A UNO por clave. `clean` (`backend-e2e/clean.go`) corre con `FOREIGN_KEY_CHECKS=0` pero nunca hace bulk; en dev exige `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`. El flujo completo de originación (`web`/`asesor`/`setup`/`prep`/`random`) está **bloqueado en dev** salvo el guard explícito.

## Fronteras (qué cede este nodo)
- **El CONTRATO del microservicio de pre-aprobación y su taxonomía de errores/UI** → **ms-preapprovals**. Acá solo cómo el harness lo **mockea** (`mock-preapprovals/server.mjs`, status por lender) o lo **ejercita** (rt=1 con host fakeado).
- **La semántica de riesgo del usuario sintético** (qué score pasa, la fila Experian cifrada, las reglas datacrédito de los 2 motores) → **profiling** / **datacredito**. Acá solo el **comando de inyección** (`SeedRiskProfile` / `synthFill` / `injectDatacredito`), no la decisión.
- **Los flujos de producto reales** (Motai IMEI/Abaco, SmartPay celular-garantía, agregadores) → sus nodos **Motai** / **SmartPay** / **Aggregator**. Acá solo el arnés que los prueba (specs `motai-ui`, `smartpay-dynamic`, `aggregator`).
- **La cascada de listado y el ruteo ONB0xx del onboarding** → **onboarding** / **lender-listing**. Acá solo que el harness *asevera* el resultado del listado.

## Dónde mirar

**backend-e2e — CLI y ejes**
- `backend-e2e/main.go` — dispatcher (`runDynamic`/`runOne`/`runSmartpay`/`runPerfilador`/`runRandom`/`runOffer`/`runAggregatorSim`), el guard `--target=dev`, `variant()` (aislamiento de datos en matriz), y el `perfiladorOracle` (umbrales leídos de BD).
- `backend-e2e/flow.go` — comando unificado `flow`: `ecommerceType` (notificador), rt→cierre-real-vs-simulador, VTEX settle.
- `backend-e2e/prep.go` · `get.go` · `create.go` · `clean.go` · `doctor.go` · `login.go` · `presets.go` — los subcomandos de operación (consolidados del extinto `creditop-cli`).
- `backend-e2e/channel/channel.go` (asesor: register→otp→personal→laboral; se adapta al comercio) · `web.go` (handshake ecommerce base64 PHP-serializado) · `vtex.go` (conector VTEX + `vtexUnique`) · `storewebhook.go` (listener :9099).
- `backend-e2e/merchant/merchant.go` — `Resolve`/`inferKind` (standard/corbeta/pullman/motai/ecommerce) + `Verify` (Quanto/Corbeta laboral dummy).
- `backend-e2e/lender/lender.go` — el switch de cierre (por ID/rt, default=CreditopXClose) · `closes.go` — revolving/motai/bancolombia/credifamilia/external + el IMEI de prueba `356938035643809`.

**backend-e2e — infra**
- `backend-e2e/pkg/mocks/mocks.go` — `SeedApprovedProfile`/`SeedRiskProfile` (tinker), `EnsureOtpBypass`, `ForceOtpValidation`, `SetStatusAndLender`.
- `backend-e2e/pkg/config/config.go` — conexión local hardcodeada (sin `.env`) + override dev por env; `BackdoorAPIKey` para smartpay; `IsShared()`.
- `backend-e2e/pkg/flow/flow.go` — el runner de pasos autodocumentados (`Explain()`, `Ctx`).
- `backend-e2e/pkg/database/database.go` (mysql TCP + `Clean`) · `identity/identity.go` (seed) · `ledger/ledger.go` (no bulk) · `client/client.go` (HTTP + vhost `Host`) · `pkg/database/devquery_test.go` (test de query dev).

**frontend-e2e — orquestación e infra**
- `frontend-e2e/dev/guided.spec.ts` — el demo guiado 2 ventanas; detección de cierre por conducta; `E2E_INJECT`, `synthFill`, watcher del banner de error.
- `frontend-e2e/e2e/triplet.ts` + `triplet.spec.ts` · `happy-path.spec.ts` · `marketplace-select.spec.ts` — composición.
- `frontend-e2e/pkg/windows.ts` — **fuente única** del tiling A/B (CDP `setWindowBounds`), `IPHONE_UA`, `PREVIEW_VP`.
- `frontend-e2e/pkg/inject.ts` — `synthFill` (KYC armado + Experian cifrada) · `laravel-crypt.ts` (cripto Laravel) · `db.ts` (pool mysql2, `assertWriteAllowed`).
- `frontend-e2e/pkg/config.ts` (datos de prueba + cognitoCreds) · `cognito.ts` (Hosted UI) · `account-lock.ts` (mutex + re-apuntar cuenta 1827080) · `asesor.ts` (whois/assign/revoke/scrubphone) · `ecommerce.ts` (contrato/URL checkout) · `close.ts` (cierre CreditopX por UI) · `flow.ts` (narración) · `error-shape.ts` (`assertSubcode`) · `mock-control.ts` (`X-Fake-Scenario`).
- `frontend-e2e/panel/server.ts` — el panel :5195; `frontend-e2e/create3.ts` — fabrica 3 lenders Motai sintéticos (credit/renting/rto) clonando el 62.
- `frontend-e2e/playwright.config.ts` — testDir `.`, ignora `_scratch/`, `fullyParallel`, `webServer` comentado (CI).

**Wrappers operativos (NO indexados, pero son la puerta de entrada)**: `backend-e2e/{Makefile,scripts/flow.sh}`; `frontend-e2e/bin/{asesor,ecommerce,panel,dbops.ts,mock-preapprovals,mock-redirect}`.

## Gotchas / riesgos
- **backend-e2e local NO lee `.env`**: la conexión (`127.0.0.1:80`, `PartnerHash=3e67eade`, `TestAmount=1.500.000`) está hardcodeada en `config.go`. Solo `--target=dev` lee env.
- **Elegir el lender correcto para el comercio**: un lender solo cierra in-platform si está en `lenders_by_allieds` del allied. Forzar #77 (de Pullman/allied 94) en otro comercio da **pagaré HTTP 500**. Usá `offer <comercio>` primero.
- **`random` "falla"**: los ❌ son **gaps de config** (categoría/asociación faltante), no bugs. `classifyErr` los tipifica (promissory-note 500 deceval-sin-cred, authorize 500 guarantee_criteria, etc.).
- **Muro Wompi (cierre rt=2 por UI) — ✅ VOLTEADO (2026-07-18, `bin/close-lender`)**: el muro NO era el checkout de Wompi (`pkg/wompi-mock.ts` ya lo intercepta y está verificado) sino el **motor de scoring**: a un perfil aprobado le asigna una categoría con `min_initial_fee=0` → cuota $0 → botón "Pagar" disabled → nunca llega a Wompi. Solución: `bin/close-lender` siembra un lender rt=2 **sintético** clonando #77 con `min_initial_fee>0` en TODAS las categorías → la cuota da >0 → botón habilitado → Wompi → mock → down-payment-validation. Verificado por `frontend-e2e/lender/cierre-x.spec.ts`; falta solo el Grupo B/C para `loan-approved`. El `creditopXClose` original sigue lanzando para **#77/#37** (categoría fee=0 / redirect `/continue?url=null`); el cierre backend sigue en `asesor 3e67eade 77` (fuerza `initial_fee=0`).
- **`IPHONE_UA` obligatorio**: el wizard gatea `loan-approved`/validación por `onlyMobileValidation` — con UA de escritorio responde **403** (loader en blanco). A y B usan UA de iPhone; el SSR reenvía el UA.
- **Reuse de puertos**: `bin/asesor` **reusa** el wizard :5174 si ya está arriba, y lo **reinicia solo si apuntaba a otro backend** (dev↔local). `mock-preapprovals` reusa solo si el `MOCK_PA_DELAY_MS` coincide (el env se hornea al bootear) — si cambió, reinicia.
- **Degradación en local (ecommerce)**: el checkout SSR lee `process.env.VITE_API_URL`; la entrada ecommerce se degrada en local → **usar dev** para el flujo ecommerce completo (ver memoria `frontend-e2e-split-view`).
- **Timeouts**: el wizard usa lenders-v1 (pre-aprobación sincrónica lenta) → "Server Timeout" del `streamTimeout` (fix por env); `navigationTimeout` 30s / `actionTimeout` 10s (`playwright.config.ts`); `PICK_TIMEOUT` (default 300s) espera tu click por pantalla en el guiado.
- **`MoneyInput` pierde `fill()` por hidratación**: `seedField` reintenta tecla por tecla (`pressSequentially`) hasta que el valor quede.
- **VTEX idempotencia**: `vtexUnique()` (nanosegundos) evita reusar un `EcommerceRequest` ya `processed=1` (el observer saltaría por idempotencia y el listener no recibiría el POST).
- **Mutex de la cuenta 1827080**: Motai y SmartPay la necesitan ligada a comercios distintos; `account-lock.ts` (mkdir atómico en `/tmp`) los serializa bajo `fullyParallel`. Restaura a Motai (158/682) al terminar.
- **SmartPay teléfono internacional** (`+57…`): `create-temporary-user` guarda el phone crudo pero `check-user-exists`/`resolve` normalizan a `+`+dígitos; sin el `+` da BDUS004 (usuario no encontrado).
- **`X-Dev-Session`/`DEV_SESSION_KEY` OBSOLETOS**: el gate de `/merchant/*` hoy es Cognito; el flag existe con comentario pero sin consumidor en código.
- **`npm test` engaña**: muchos `test.fixme` (del mock-server `:4000` eliminado) aparecen como `fixme`, no como pasados — "todo verde" ≠ cobertura total. El script `test:onboarding` apunta a una carpeta inexistente (roto).

## Preguntas abiertas
- El flujo ecommerce **por UI en local** sigue degradado (SSR `process.env.VITE_API_URL`) — falta cerrar el gap para no depender de dev.
- El cierre **Motai por UI** (seleccionar #158 → IMEI/Abaco device flow) está pendiente: faltan testids Grupo E/F + que el marketplace ofrezca #158. Validado solo en backend (`asesor f0548728 158`).
- `--target=dev` para el **flujo completo** sigue gated (solo read-only + create/clean); endurecerlo contra hosts compartidos es trabajo pendiente (ver `DEV-TARGET.md`, no indexado).
- 61 `test.fixme` en frontend-e2e por convertir al stack real (los grandes: `motai.spec.ts` cierre #158, `smartpay-rd.spec.ts`, `credifamilia.spec.ts` rt=4 async).

## Bitácora
- **2026-07-18** — Nodo `harness` creado. Los dos harness E2E (`backend-e2e` 24 nodos Go + `frontend-e2e` 66 nodos Playwright/TS) **recién indexados**; antes no eran linkeables. Superficie curada: 66 archivos (24 backend + 42 frontend), 0 DROP. Documentado por análisis de código.

## Enlaces
- Padre: **CreditOp**.
- Fronteras (cede a): **ms-preapprovals** (contrato/taxonomía del MS de pre-aprobación), **profiling** / **datacredito** (semántica del perfil sintético), **Motai** / **SmartPay** / **Aggregator** (flujos de producto), **onboarding** / **lender-listing** (ruteo y cascada del listado).
- Nodos de repo hermanos: **legacy-backend** (el SUT del backend), **frontend-monorepo** (el wizard que maneja frontend-e2e), **pre-approvals-service** (el MS que mock-preapprovals reemplaza).
- Memorias: `backend-e2e-dev-target`, `creditop-cli-consolidado`, `synth-credipullman-gates`, `synth-lender-type-boundary`, `datacredito-rules-per-lender`, `frontend-e2e-setup`, `frontend-e2e-dev-asesor-login`, `frontend-e2e-asesor-commands`, `frontend-e2e-split-view`, `frontend-e2e-windows-ab`, `frontend-e2e-wizard-dev-gotchas`, `motai-v2-validacion-local` (el harness panel), `pre-approval-omit-experian-frontend`.
