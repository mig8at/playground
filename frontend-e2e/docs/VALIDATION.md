# VALIDATION — estado de validación E2E por la UI (Playwright)

> ⚠ Los `docs/*.md` que se citan abajo vivían en `playground/docs/`, **borrada de `main`** (absorbida por el árbol de `context/`). Quedan como referencia histórica; para leer una: `git show 159906a:docs/<archivo>`.


> Par del `backend-e2e` *(borrado 2026-07-19 — lo rescatado está en findings F-57)*, pero **desde la UI del wizard**
> (`loan-request-wizard` :5174) contra el `legacy-backend` en modo mock.
>
> **Dueño de este doc:** el estado de validación por UI (verde / `fixme` con motivo) y el detalle de UI:
> fake del forms-service para SmartPay, mutex de la cuenta de prueba, login Cognito y re-apuntado del comercio.
>
> Lo que **no** vive aquí (solo se enlaza):
> - **Setup / quickstart** (arrancar backend mock + wizard, `.env.local`, stashes, `.cognito.json`) → [`README.md`](../README.md).
> - **Backlog de `data-testid` por grupo + orden de implementación** → [`PLAN-PRUEBAS.md`](PLAN-PRUEBAS.md).
> - **Taxonomía `response_type` 0-4 y ciclo de `user_request_statuses`** → `docs/NEGOCIO.md` *(histórico)*.
> - **Hardcodes (IDs, hashes, montos, status, branches)** → `docs/LOGICA-QUEMADA.md` *(histórico)*.
> - **Encadenamiento URL→archivo→endpoint→tabla** → `docs/MAPA-FLUJOS.md` *(histórico)*.
> - **Mecanismo por flujo (citas archivo:línea, mocks)** → `docs/REFERENCIA-FLUJOS.md` *(histórico)*.

---

## Hallazgo de base: el suite estaba STALE

Las specs UI se escribieron originalmente contra el **viejo mock-server `:4000` (validation-driven, ELIMINADO)**,
no contra el `legacy-backend` real. Síntomas encontrados al correr el baseline:

- `pkg/config.ts:34` apuntaba `mockUrl` a `http://localhost:4000` (muerto) → **corregido a `http://localhost`**.
- Las specs asumían un `POST /__mock/state` para diferenciar el partner. **Esa ruta NO existe en el backend real**
  (`grep -rn "__mock"` en `legacy-backend` → 0 resultados). Lo que **sí** soporta el backend real es el header
  **`X-Fake-Scenario`** por request (`app/Support/Onboarding/External/FixtureLoader.php:94` / `HttpFakeRegistrar`),
  que es el mecanismo que usa `injectFakeScenario` (`pkg/mock-control.ts`).
- El paso de monto: el testid `amount-input` (del stash) está en `amount-form.tsx` (flujo dinámico), pero el
  componente de monto de **self-service** es otro y NO lo lleva → se usa selector semántico
  (`getByRole textbox /monto/`).

> ✅ **Residual resuelto:** se quitó el `POST {mockUrl}/__mock/state` de `e2e/happy-path.spec.ts` (devolvía
> 404 no-op contra el backend real; el partner se fija por el hash de la URL). El `injectFakeScenario`
> (`X-Fake-Scenario`) que le seguía se mantiene — es válido contra el backend real.

---

## Resumen (tally del suite)

Sin specs `dev-*`: **14 ✅ / 66 ⏸️ `fixme` / 0 ❌** con `.cognito.json` presente (incluye Motai UI y
**SmartPay dinámico completo** + ecommerce handshake/notificación); **12 ✅** sin credenciales (Motai y SmartPay
se skipean). Verde donde la validación es real contra el stack real; `fixme` (con motivo) donde la spec dependía
del mock-server `:4000` eliminado, o falta seed / contrato del backend / credenciales.

| Flujo (UI) | Estado | Spec | Nota |
|------------|--------|------|------|
| **Happy path** (amount→phone→OTP→personal→[laboral]→lenders) | ✅ VALIDADO | `e2e/happy-path.spec.ts` | corre verde contra el stack real (Pullman `3e67eade` salta employment vía Quanto). El `POST /__mock/state` residual fue removido. |
| **Corbeta UI** (no-temporal → lenders) | ✅ VALIDADO | `merchant/corbeta.spec.ts` | comercio **Alkosto** (allied 209), hash real `a1c0b15d`; "Corbeta" es el flujo (`settings.corbeta_allieds=[24,209,210,211]`), no el nombre del comercio. `otp-validate success:true` (no-temporal) → el wizard salta directo a /lenders. 3 tests de contrato-mock quedan `fixme`. |
| **Motai (`/merchant/*`)** | ✅ entrada por UI | `merchant/motai-ui.spec.ts` | login Cognito → solicitar → monto → teléfono → OTP → personal-info → fecha → **marketplace Motai**. Requiere `.cognito.json` + cuenta ligada a Motai (ver §`/merchant/*`). Cierre #158/IMEI/Abaco pendiente (Grupo E/F). |
| **SmartPay dinámico (`/merchant/*`)** | ✅ VALIDADO completo | `merchant/smartpay-dynamic.spec.ts` | login Cognito → **amount+producto → teléfono → OTP → personal → financial → /lenders** (5 pasos de `@creditop/dynamic-form`). El wizard llama al forms-service directo → **legacy-backend lo FAKEA** (`/api/forms-fake/dynamic/*`, en stash); el `submit` delega al origination real → `userRequestId` auténtico. Requiere `.cognito.json` + `VITE_ONBOARDING_FORM_SERVICE=http://localhost/api/forms-fake`. El spec re-apunta la cuenta a `bb534d6a` (allied 24) y la restaura a Motai (mutex `pkg/account-lock`). Ver §SmartPay. |
| **Pullman → CrediPullman** | ✅ Pullman / ⏸️ #77 | `merchant/pullman-credipullman.spec.ts` | Pullman por UI ✅ (Quanto auto-inyecta → salta employment → /lenders, ofrece Meddipay). **CrediPullman #77 (rt=2) NO lo ofrece el marketplace** para este branch (mismo "marketplace restrictivo" del backend: `offer 3e67eade` = solo #39/#6). El cierre #77 está validado en backend forzando el lender (`asesor 3e67eade 77` → Estado 11) → oferta+cierre por UI en `fixme`. |
| **Cupo Rotativo UI** | ✅ flujo / ⏸️ rt=3 | `merchant/cupo-rotativo.spec.ts` | flujo del partner (Pullman) llega a /lenders ✅. La oferta rt=3 + RevolvingCreditIntro requiere seed de marketplace → `fixme` (el cierre rt=3 ya está en backend-e2e: `asesor 3e67eade 71`). |
| **Ecommerce (E2E completo)** | ✅ VALIDADO | `channel/ecommerce-local-real.spec.ts`, `channel/ecommerce-notify.spec.ts`, `channel/ecommerce-ui.spec.ts` | **handshake** con contrato base64 REAL (`generate_checkout_url.php`, PHP-serializado) → checkout → /lenders ✅; **notificación a la tienda** ✅ (`notify-store` → POST al `process_url` con `{status:'completed'}`, capturado por listener local vía `host.docker.internal`, + `return_url` propagado). `ecommerce-ui.spec.ts` **NO está obsoleto**: conserva 1 test verde de **contrato** (ver §Ecommerce). |
| **OBS-OTP-02 / OBS-KYC-03** (subcódigos) | ✅ 5 activos / ⏸️ 6 fixme razonado | `channel/otp-subcodes.spec.ts`, `channel/kyc-subcodes.spec.ts`, `channel/smoke.spec.ts` | Reescritos contra el shape REAL del backend (heterogéneo: code/sufijo pueden venir concatenados, anidados en `errors.*`/`error.code`, o como `message`). Aserciones tolerantes vía `pkg/error-shape.ts::assertSubcode` (espejo de backend-e2e/channel/negative.go con OR). **Activos** (validados E2E contra el stack local): OTP `NO_PREVIOUS_OTP` + `CODE_INVALID`; KYC `EXPEDITION_DATE_INVALID` + `DOCUMENT_DUPLICATE` + `ONB030 internal server error` (Experian `server-error`/`timeout`/`no-hit`). **Hallazgos de la validación**: (1) el `user_request_id` viene en `errors.payload.user_request_id` cuando hay ONB002 (no en `data.payload` como asumía); (2) `ONB030` es un code nuevo no documentado antes; (3) los escenarios `tusdatos.*` no aplican a Pullman (partner default) — corre Experian Quanto. **Fixme razonado** (6): escenarios `expired`/`provider-down`/`provider-5xx` (OTP) y `issue-date-mismatch`/`document-not-found`/`name-mismatch` (TusDatos) — para activar TusDatos hay que usar un partner_hash estándar (no Pullman/Corbeta/Motai). |
| **Composable `canal → comercio → lender`** | ✅ entrada | `e2e/triplet.spec.ts` | espejo del CLI de backend: matriz por defecto (asesor→`3e67eade`, asesor→`a1c0b15d`) + override por env (`E2E_CHANNEL`/`E2E_MERCHANT`/`E2E_LENDER`). Valida `canal → comercio → /lenders`; el cierre del lender por UI es el siguiente paso. |
| `dev-*` specs | ➖ scratch | `dev-real-*`, `dev-manual-auth` | manuales/experimentales; fuera del baseline (no cuentan en el tally). |

---

## Mini-índice de specs en `fixme` (por qué cada uno)

Los 61 `test.fixme()` se reparten así. La causa dominante es el **contrato del mock-server `:4000` eliminado**
(escenarios + shapes que el backend real no replica) y/o **slugs placeholder muertos** (`motai001`,
`smartpay001`, `qu4nt0001`) que hay que reemplazar por hashes reales. **Backlog #2 atendido** (jun 2026):
`otp-subcodes.spec.ts` y `kyc-subcodes.spec.ts` reescritos contra el shape REAL del backend y **VALIDADOS
E2E contra el stack local** — 5 activos verdes + 6 fixme razonados por driver/partner que no aplica.

| Spec | fixme | Por qué está en `fixme` |
|------|------:|--------------------------|
| `merchant/motai.spec.ts` | 21 | Contrato del mock `:4000` + slug placeholder `motai001` + bypass obsoleto `X-Dev-Session` en el header doc. La **entrada** ya está cubierta por `motai-ui.spec.ts`; estos cubren el cierre #158/IMEI/Abaco (Grupo E/F) y pasos intermedios aún sin testids. |
| `merchant/smartpay-rd.spec.ts` | 7 | "rd" = response-driven contra el mock `:4000`. Reemplazado por `smartpay-dynamic.spec.ts` (vivo); restan aserciones de contrato del mock. |
| `merchant/credifamilia.spec.ts` | 7 | rt=4 async (Credifamilia, sin fila en `response_types`): requiere polling/seed del flujo asíncrono que el mock `:4000` simulaba. |
| `channel/kyc-subcodes.spec.ts` | 3✅ + 3⏸ | Reescrito + VALIDADO E2E (backlog #2 atendido). Activos: EXPEDITION_DATE_INVALID, DOCUMENT_DUPLICATE, ONB030 (Experian server-error). Fixme: 3 escenarios `tusdatos.*` — no aplican a Pullman (corre Experian). |
| `channel/otp-subcodes.spec.ts` | 2✅ + 3⏸ | Reescrito + VALIDADO E2E (backlog #2 atendido). Activos: NO_PREVIOUS_OTP, CODE_INVALID. Fixme: 3 escenarios (`expired`/`provider-down`/`provider-5xx`) sin verificación E2E. |
| `channel/kyc-ui.spec.ts` | 4 | Escenarios KYC del mock `:4000`; falta alinear con `TusdatosHttpFake` real. |
| `channel/otp-ui.spec.ts` | 4 | Escenarios OTP del mock `:4000`. |
| `merchant/pullman-quanto.spec.ts` | 4 | Slug placeholder `qu4nt0001` + contrato del mock. La auto-inyección Quanto ya se valida vía `pullman-credipullman.spec.ts` (vivo). |
| `merchant/corbeta.spec.ts` | 3 | El happy-path está vivo (1 test); estos 3 asertan contrato-mock (subcódigos/escenarios). |
| `merchant/cupo-rotativo.spec.ts` | 2 | Oferta rt=3 + RevolvingCreditIntro requieren seed de marketplace (no llega solo con el perfil de onboarding). |
| `channel/smoke.spec.ts` | 1 | Smoke contra el shape del mock `:4000`. |
| `merchant/pullman-credipullman.spec.ts` | 1 | Oferta+cierre #77 (rt=2) por UI: el marketplace no ofrece #77 a `3e67eade` (cierre ya validado en backend). |
| `lender/creditopx-close.spec.ts` | 1 | Cierre rt=2 por UI bloqueado por config Wompi del lender (ver §Muro del cierre rt=2). |
| **Total** | **61** | (5 tests fuera de fixme tras backlog #2 + validación E2E) |

---

## Hallazgos de dominio (específicos de UI)

### Ruteo post-OTP (`otp-verification.tsx:77`)
El wizard decide a dónde ir según la respuesta de `otp-validate`:
- **`response.success && loanRequestId` → /lenders** (`otp-verification.tsx:77`): usuario **NO-temporal**, perfil completo.
- **`errorCode === "ONB002"` → /personal-info** (`otp-verification.tsx:82`): temporal.

Verificado por curl con teléfonos frescos: Corbeta/Alkosto → `success:true` (no-temporal de una, auto-inyecta en
el OTP); Pullman/estándar → `success:false` → personal-info. Un usuario que **regresa** (cualquier partner) con
perfil completo también salta a /lenders. Por eso el helper espera `personal-info | lenders` tras OTP, y luego
`employment-info | lenders` (Pullman salta employment vía Quanto: `OnboardingService.php:700-742`).

### Gate `default-layout` de `/merchant/*` (`default-layout.tsx:63`)
Las rutas `/merchant/*` exigen sesión Cognito (`requireUserWithSession`, `auth-helpers.server.ts`) **y atan la URL
al comercio del usuario**: si `userAlliedBranchHash && params.partner_hash !== userAlliedBranchHash` → **redirect
forzado** a `/merchant/{hash-del-usuario}/solicitar` (`default-layout.tsx:63`). Por eso un usuario solo entra a SU
comercio, y por eso las pruebas de asesor deben **re-apuntar la cuenta** al comercio bajo prueba (ver §Mutex).

Los endpoints `/api/partners/{products/{hash}, user-request-product, dynamic-form/session}` **sí** son públicos
(fuera del grupo `auth.cognito`: `Modules/Partner/routes/api.php:204,205,210` vs grupo auth en líneas 17-197), así
que el flujo de datos funciona en local sin token. El gate es solo del layout del portal merchant.

> El comentario `X-Dev-Session` / `DEV_SESSION_KEY` del `.env.local` está **OBSOLETO**: el flag existe con
> comentario pero **no hay consumidor en código** (grep 0 en `auth-helpers.server.ts` y en todo `apps/`,
> `modules/`, `packages/`). Las pruebas `/merchant/*` usan **login Cognito real**.

### Mutex de la cuenta compartida (`pkg/account-lock.ts`)
La cuenta de prueba 1827080 es un **singleton** que Motai y SmartPay necesitan ligado a comercios distintos. Con
`fullyParallel: true` (`playwright.config.ts:28`), dos specs que la mutan a la vez se pisan → `acquireAccountLock()`
(mkdir atómico en `/tmp`) los **serializa**: cada uno toma el lock en `beforeAll`, apunta su comercio, y libera en
`afterAll`. Por eso `motai-ui` y `smartpay-dynamic` conviven verdes en el suite. Los hashes que usa el lock
(`account-lock.ts:22-24`) coinciden con la BD: `SMARTPAY_MERCHANT` allied 24 branch 570 = `bb534d6a`;
`MOTAI_MERCHANT` allied 158 branch 682 = `f0548728`.

### Muro del cierre rt=2 por UI = **config de lender (Wompi)**, NO falta de testids
El cierre in-platform de Creditop X (rt=2) **no es alcanzable headless** por la config del lender en el mirror
local, no porque falten `data-testid` (el stash ya cubre amount/phone/otp/personal/employment/initial-fee +
`lender-action-{id}` genérico + `sp-*`). Verificado por captura de red sobre los dos rt=2 candidatos:

- **#77** (branch `3e67eade`, score 800): al continuar exige cuota inicial → redirige a **Wompi HOSTED checkout**
  (página externa; `WOMPI_MOCK` aplica al webhook, no al checkout) → no completable headless.
  El gate del FE es `available-lenders.tsx:180` (`if (Number(initial_fee) > 0)` → `initialFeePayment`).
- **#37** (branch `bb534d6a`, score 650/750): la acción del FE responde
  `["redirect","/self-service/bb534d6a/{id}/continue?url=null","status",302]` → `/continue` con url nula → **404**.

Un cierre in-platform limpio exigiría un rt=2 con `min_initial_fee=0` **y** sin redirect/Wompi — config que no
aparece limpia en el mirror. **El cierre rt=2 → Estado 11 ('Autorizada', `user_request_statuses` id 11) ya está
validado en BACKEND** (`backend-e2e: go run . asesor 3e67eade 77`, que fuerza `initial_fee=0` y estado, sin Wompi
ni `/continue`; ver `backend-e2e` *(borrado 2026-07-19 — lo rescatado está en findings F-57)*). Para cerrarlo por UI haría
falta (a) arreglar la config del lender en BD, o (b) driver el checkout Wompi externo — ambos fuera del alcance
"solo bypass en `legacy-backend`". Las cifras de deuda y por qué se clasifica este fallo: ver
`docs/CASOS-ESPECIALES.md` *(histórico)*.

---

## Composable `canal → comercio → lender` (espejo de backend-e2e)

Igual que el CLI de backend (`go run . <canal> <comercio> <lender>`, ver
`backend-e2e` *(borrado 2026-07-19 — lo rescatado está en findings F-57)*), pero el "motor" es Playwright manejando el wizard real
(`e2e/triplet.spec.ts:17-18` + `e2e/triplet.ts`):

```bash
# tripleta única (como el CLI de backend):
E2E_CHANNEL=asesor E2E_MERCHANT=3e67eade [E2E_LENDER=77] npx playwright test e2e/triplet.spec.ts
# matriz por defecto (tripletas conocidas-verdes):
npx playwright test e2e/triplet.spec.ts
```

Ejes: **canal** (`asesor` ✅ / `web` ⏸️ handshake ecommerce), **comercio** (hash del branch), **lender** (para
asertar oferta / cierre). Hoy valida `canal → comercio → /lenders`. El cierre por UI (rt=2) está bloqueado por la
config Wompi (ver §Muro del cierre rt=2).

---

## SmartPay — formulario dinámico completo por UI (`merchant/smartpay-dynamic.spec.ts`)

> **"SmartPay" no es un lender con id propio.** Son los lenders **152** (rt=2) y **153** (rt=1). El id `160` que
> aparece en código es un hardcode (NotificationService/VoucherService/LenderRetrievalService + el skip de encuesta
> `lender_id !== 160` en `SatisfactionSurveyCheck.php:38`) y **no existe como fila en BD**. Detalle de hardcodes en
> `docs/LOGICA-QUEMADA.md` *(histórico)*. El cierre de SmartPay #152 va por `CreditopXClose`
> estándar (NO IMEI; el IMEI es de Motai #158).

**VERDE end-to-end** (headless): login Cognito → `/merchant/bb534d6a/request-amount` → **monto+producto → teléfono
→ OTP → datos personales → datos financieros → `/merchant/bb534d6a/{userRequestId}/lenders`**. Es el flujo de 5
pasos de `@creditop/dynamic-form`, manejado completamente por UI.

### Por qué se fakea en legacy-backend
El wizard llama al microservicio `onboarding-forms-service` **DIRECTO** (`VITE_ONBOARDING_FORM_SERVICE`,
server-side desde los loaders/actions de React Router), NO a legacy-backend. Como **no se levanta ese
microservicio** (restricción del proyecto: solo bypass en legacy-backend), legacy-backend **sirve su CONTRATO como
FAKE** y el `.env.local` del wizard apunta `VITE_ONBOARDING_FORM_SERVICE=http://localhost/api/forms-fake`. El fake
está gateado por `APP_ENV` local/development (`AppServiceProvider.php:53`) y vive en el stash:

| Endpoint (forms-service) | Fake en legacy-backend | Respuesta |
|---|---|---|
| `GET /dynamic/{hash}/schema` | `AppServiceProvider::fakeFormsServiceRoutesForLocal` (línea 51) | schema mínimo (logo/userName + opciones city/documentType) |
| `POST /dynamic/{hash}/send-otp` | idem | `200 {}` (no-op) |
| `POST /dynamic/{hash}/validate-otp` | idem | `{"success":true}` → va a personal-info |
| `POST /dynamic/full/find-user-by-email` | idem | `{"code":"OFS6001"}` (disponible) |
| `POST /dynamic/full/find-user-by-document-number` | idem | `{"code":"OFS7001"}` (disponible) |
| `POST /dynamic/{hash}/upload` | idem | `{"url":"…"}` (solo si ocupación = Conductor) |
| `POST /dynamic/{hash}/submit` | idem | **delega al origination REAL** `DynamicFormsService::userCreateFacade` (DYFS1001) → `{"redirect":"ok","userRequestId":<real>}` |

El `submit` primero crea el usuario temporal (`BackDoorUserController::createTemporaryUser`, lo que el micro
dispararía en send-otp) porque el orchestrator **resuelve** al usuario por teléfono (no lo crea). Así devuelve un
`userRequestId` **auténtico** → `POST /api/partners/user-request-product` (real) + `/lenders/{id}` funcionan.

> ⚠️ **No confundir** este fake con `fakeDynamicFormsServiceForLocal` (`AppServiceProvider.php:150`): ese es un
> `Http::fake` de `*/v1/dynamic/full/*/schema` + `genderapi.io` usado por el flujo **backend** de create-user, no
> por el wizard.

### Marketplace tras el origination
La oferta de lenders sale de `GET lenders/{uReq}` → `ListLenderController@index` →
`LenderRetrievalService::getLenders` (invoca el perfilador). `lenders-v2/{uReq}` (`LenderListingController`) **no**
lo usa el FE. El encadenamiento completo está en `docs/MAPA-FLUJOS.md` *(histórico)*.

### Testids agregados (frontend-monorepo stash, Grupo G)
`sp-city-trigger`, `sp-documentType`, `sp-birthdate` en `dynamic-form/PersonalInfoForm.tsx` (755/780/866). Lo demás
se driva por id/name/placeholder/rol; `OtpForm` ya traía `otp-input`/`otp-submit`; `DateSelector` ya traía
`date-selector-{day,month,year}`. El inventario completo de testids por grupo (A/B/C/E/F/G) vive en
[`PLAN-PRUEBAS.md`](PLAN-PRUEBAS.md).

---

## Flujos `/merchant/*` (Motai, SmartPay) — login Cognito real

**Motai por UI VERIFICADO** (headless, 24.6s): login Cognito → `/merchant/f0548728/solicitar` → monto → teléfono →
OTP → personal-info → fecha → **marketplace Motai (`/lenders` con Productos)**. Spec: `merchant/motai-ui.spec.ts`
(skip sin credenciales). Mismo patrón que SmartPay: login Cognito + cuenta ligada al comercio + mutex.

**Credenciales (asesor / `/merchant/*`)**: en **`.cognito.json`** (raíz de `frontend-e2e`, gitignored, nunca
commitear), leídas por `pkg/config.ts::cognitoCreds`; los env `E2E_COGNITO_USER`/`E2E_COGNITO_PASS` tienen
prioridad. El driver del Hosted UI (`login.creditop.com`) es `pkg/cognito.ts`.

### Estado de la cuenta de prueba (1827080) y re-apuntado
La cuenta de prueba (`a.arismendy`, user 1827080) está asociada en BD local a **Motai** (allied 158, branch 682,
`user_profile_id=4`, `status=1`) con `cognito_id` = el **sub real** de la sesión (`319b25f0-…`). El portal resuelve
el comercio por `auth()->user()` (la fila cuyo `cognito_id` = el SUB de la sesión Cognito), por eso el `cognito_id`
guardado **debe** ser el sub real (originalmente estaba desincronizado y daba "no comercio" incluso para su propio
comercio).

Para re-apuntar la cuenta a otro comercio (otra prueba de asesor):

```sql
UPDATE users SET allied_id=<allied>, allied_branch_id=<branch> WHERE id=1827080;
-- el cognito_id ya está correcto; restaurar a Motai (158/682) al terminar
```

`smartpay-dynamic.spec.ts` hace exactamente esto: re-apunta a `bb534d6a` (allied 24, branch 570) en `beforeAll` y
restaura a Motai en `afterAll`, bajo el lock de `account-lock.ts`. Se eligió `bb534d6a` porque allied 24 tiene
**productos** (el paso amount los exige) y el fake submit origina bien ahí.

> **Nota histórica corregida:** una versión anterior de este doc citaba el estado original de la cuenta como
> "allied 24 / branch 167". Ese par **no existe**: en la BD local el **branch 167 pertenece a allied 41 (Americana
> de colchones, hash `06faf597`)**, no a allied 24. Los branches de allied 24 son 17, 570, 674, 694, 707, … Tómese
> el dato histórico de branch con cautela; la fuente de verdad es la BD.

**Pendiente del cierre Motai por UI**: seleccionar #158 → IMEI/Abaco device flow (testids Grupo E/F, ver
[`PLAN-PRUEBAS.md`](PLAN-PRUEBAS.md)) + que el marketplace ofrezca #158. Los device endpoints públicos
(`lock-device`/`unlock-device`/`get-device-status`, `Modules/Partner/routes/api.php:199-202`) son el contrato a
manejar. El cierre Motai → Estado 11 ya está validado en backend (`asesor f0548728 158`). Los flujos
`/self-service/*` (Pullman, Corbeta, estándar) NO tienen el gate Cognito.

---

## Ecommerce — qué valida `ecommerce-ui.spec.ts` (no está obsoleto)

`channel/ecommerce-ui.spec.ts` conserva **1 test verde de contrato**: `POST
/api/onboarding/ecommerce-request/create/{hash}` con un handshake **incompleto** (solo `order + token`, como el
viejo mock `:4000`) debe ser **rechazado** por el backend real (`success:false`). El backend real exige los **7
campos required** de `CreateEcommerceRequest.php` (`partnerId, order, products, token, returnUrl, processUrl,
config`). El **happy-path** del handshake (contrato base64 PHP-serializado que produce `generate_checkout_url.php`)
se movió a los specs dedicados verdes `ecommerce-local-real.spec.ts` y `ecommerce-notify.spec.ts`. El mapa del
handshake y la notificación a la tienda viven en `docs/MAPA-FLUJOS.md` *(histórico)* (B.1).

---

## Fixes aplicados en el harness (`frontend-e2e/`, es la herramienta)

1. `pkg/config.ts:34`: `mockUrl` → `http://localhost` (backend real, no el `:4000` muerto).
2. `channel/steps.ts`:
   - `fillAmountStep`: selector robusto (testid **o** `getByRole textbox /monto/` + botón "Activar mi crédito"/"Continuar").
   - `runHappyPathUntilLenders`: el paso de monto está en `/solicitar`; maneja el ruteo post-OTP real (ver §Hallazgos).
3. `pkg/account-lock.ts`: mutex de la cuenta compartida (ver §Mutex).
4. Slugs placeholder muertos (`motai001`, `smartpay001`, `qu4nt0001`) reemplazados por hashes reales en los specs
   vivos (`f0548728`, `bb534d6a`, `3e67eade`, `a1c0b15d`).
5. `e2e/happy-path.spec.ts`: removido el `POST /__mock/state` residual (no-op/404 contra el backend real).
6. Refs stale a `:4000` limpiadas en config + comentarios (`playwright.config.ts`, `package.json`,
   `pkg/mock-control.ts`, `channel/otp-ui.spec.ts`); la guía de subcódigos del `README.md` migrada al helper
   `assertSubcode` (el backend real no emite `error_subcode` top-level). Refs que quedan: notas históricas
   de la migración + alias `@deprecated` de `pkg/config.ts:89` (back-compat con specs `.fixme`).

---

## Setup, quickstart y stashes

→ **[`README.md`](../README.md)** (dueño): arrancar backend mock + wizard (:5174), `.env.local`
(`VITE_API_URL`, `VITE_ONBOARDING_FORM_SERVICE`), aplicar los stashes (`legacy-backend stash@{0}` con bypasses +
SmartPay forms-fake; `frontend-monorepo stash@{0}` con los testids), `.cognito.json`, y los comandos
`npx playwright test`.

→ **Backlog de `data-testid` por grupo + orden de implementación**: [`PLAN-PRUEBAS.md`](PLAN-PRUEBAS.md).

---

## Backlog (reescritura contra el stack real)

1. ✅ ~~Quitar el `POST /__mock/state` residual de `e2e/happy-path.spec.ts`~~ — hecho (era no-op/404 contra el backend real).
2. **Convertir las specs `fixme` restantes** al stack real: hash real + aserción de UI (llega a /lenders) +
   `fixme` solo a las aserciones de contrato-mock que no apliquen. Pendientes grandes: `motai.spec.ts` (cierre
   #158/IMEI), `smartpay-rd.spec.ts`, `credifamilia.spec.ts` (rt=4 async).
3. **Contrato de subcódigos**: el backend real usa `error_code` (no `error_subcode`); decidir si se reescriben los
   specs OTP/KYC contra el shape real o se levanta como mejora de observabilidad del backend.
4. **Marketplace/Perfilador por UI**: asertar que la oferta cambia con el perfil (espejo del perfilador del
   backend, ver `backend-e2e` *(borrado 2026-07-19 — lo rescatado está en findings F-57)*).
5. **CI**: descomentar/configurar `webServer` en `playwright.config.ts:58` para levantar backend mock + wizard
   automáticamente.
