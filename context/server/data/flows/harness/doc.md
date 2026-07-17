# Harness y pruebas E2E · referencia
> **estado:** al día con main · Nodo de referencia del OKR de Miguel: la metodología de pruebas E2E de CreditOp.

<!-- REFERENCIA = sustrato transversal (cuelga del group Plataforma). Autosuficiente: los datos duros están acá para no abrir docs/. -->

## Qué responde
- ¿Cómo pruebo el onboarding end-to-end (backend-e2e Go / frontend-e2e Playwright)?
- ¿Cómo armo un usuario sintético con buró inyectado para saltear OTP y la consulta real a la central?
- ¿Cómo se encripta el data del buró (laravel_encrypt AES-256-CBC) para que legacy pueda desencriptarlo?
- ¿Qué data-testid necesita cada paso del wizard y dónde va cada uno (bin/testids on/off)?
- ¿Por qué 'falla' tal lender/comercio en el random del harness? (gap de config vs flujo distinto)
- ¿Qué mocks/bypasses/stashes hay para correr los flujos localmente sin servicios externos?
- ¿Cuál es la regla de oro de dónde se guardan los cambios (playground commit-local vs repos reales en stash/rama, sin PRs sin pedir)?
- ¿Qué campos/tablas toca el synth-fill y el scrub (field_id 87/29/160, tablas hijas)?
- ¿Cómo arma el random su pool y cómo clasifica los errores (classifyErr)?

## Qué es
Nodo de referencia del OKR de Miguel: la metodología de pruebas E2E de CreditOp. Sintetiza la arquitectura de los dos harness (playground/backend-e2e Go y frontend-e2e Playwright, NO indexados), la receta de usuario sintético + encriptación Laravel del buró, el mapa de data-testids + bin/testids, el cheat-sheet de mocks/bypasses/stashes, y la tesis de que casi todo ❌ del harness es gap de config (no flujo distinto), incluido el 500 de garantía = null-deref.

## Contenido
## Harness y pruebas E2E — nodo de referencia (OKR de Miguel: metodología de pruebas)

**Pregunta que resuelve:** ¿cómo pruebo el onboarding de CreditOp end-to-end? ¿por qué "falla" tal lender/comercio en el harness? La respuesta corta a lo segundo: **casi todo ❌ es GAP DE CONFIG del lender, no un flujo distinto.**

⚠️ Los dos harness (`playground/backend-e2e` Go, `playground/frontend-e2e` Playwright/TS) **NO están en el índice** (solo los 3 repos de producto). Este nodo cura la **superficie de PRODUCTO** que el harness toca (bypasses + testids + cierres) y describe el harness en prosa.

---

### 1. Los dos harness (arquitectura común: composer + estrategias)

Ambos modelan la misma realidad: `[canal] → [comercio] → [lender]`, y **componen** los tramos compartidos enchufando lo específico solo donde difiere. Piezas idénticas en los dos:

1. **Runtime `Flow`** que numera pasos, imprime `[i/N] título · ↳ desc · ✓ detalle`, para en el primer ✗, soporta `--explain` (imprime el plan sin ejecutar/tocar BD ni navegador).
   - Backend: `backend-e2e/pkg/flow/flow.go`
   - Frontend: `frontend-e2e/pkg/flow.ts`
2. **Composer** que concatena los pasos de cada eje: `AsesorSteps/WebSteps (canal) + m.Verify (comercio) + l.CloseSteps (lender)`.
   - Backend: `backend-e2e/main.go::runOne`
   - Frontend: `frontend-e2e/pkg/composer.ts::composeFlow`

**Backend (`backend-e2e/`, Go):**
- Ejes: `merchant.Resolve(db,q)` (hash/slug/name/id → infiere `Kind` Standard/Corbeta/Pullman/Motai/Ecommerce por BD, sin matriz hardcodeada) · `lender.Resolve(db,q)` · canal enum `Web`/`Asesor`.
- **Tabla `strategies`** en `backend-e2e/lender/lender.go` = ÚNICO dispatch por lender: filas `motai`, `credifamilia`, `bancolombia` (docOverride `TestDoc=1998228194`), `revolving` (rt==3), `external` (rt==1); fallback `creditopXDefault` (rt=2 in-platform). Métodos `l.Strategy()`/`l.Summary()`/`l.ApplyOverrides(cfg)`. Cierres en `lender/closes.go`.
- Subcomandos Go (creditop-cli fue absorbido): `prep`/`get`/`doctor`/`clean` + `random N` + `asesor <m> <lender>`.

**Frontend (`frontend-e2e/`, Playwright+TS):** autosuficiente en TS, hace DB con `mysql2` e **inyecta el KYC in-process** (`pkg/inject.ts`, ya NO shellea a backend-mcp). Flujo: `make auto asesor|ecommerce <merchant> [preview] [local]` (DEV por defecto). Matriz declarativa `merchantSpecs` en `pkg/composer.ts`:

| merchant | channel | wizard |
|---|---|---|
| pullman, corbeta, credifamilia, cupo-rotativo | self-service | standard |
| motai | merchant-cognito | standard |

SmartPay queda **fuera** del composer a propósito (wizard `request-*` propio). Pasos atómicos (hoja, cero duplicación) en `pkg/wizard-steps.ts`: `fillAmountStep/fillPhoneStep/fillOtpStep/fillExpeditionDate…`. Ops DB puntuales: `node bin/dbops.ts <whois|assign|revoke|scrubphone|list|ecommerce-url|synth-fill>`.

**Extender:** comercio conocido → fila en `merchantSpecs` (FE) o caso en `inferKind` (BE); comercio nuevo → preset en `wizards` (FE) o rama en `m.Verify` (BE); lender con cierre nuevo → fila en `strategies` + fn en `closes.go` (BE); canal nuevo → entry en `channels` (FE) o `channel/<name>.go` (BE).

---

### 2. Receta del usuario sintético + buró inyectado (evita OTP + consulta real)

**Clave:** el backend **reusa un buró < 1 mes** si ya existe (`OnboardingService::userHasDataCredito` consulta `risk_central_user_data` "within last month", línea ~1566; guard también en `CreditStudyService`). Si insertás la fila del buró ANTES de personal-info, NO se vuelve a consultar la central → prueba controlada.

Se insertan/actualizan **4 cosas** sobre la fila `users` del cliente (cliente = `users` con `cognito_id` NULL; asesor = `users` con `cognito_id` = sub de Cognito):
1. **`users`** — identidad (document_type/number, first_name, date_of_birth, expedition_date, age, gender).
2. **`user_summaries`** — `agildata` (JSON empleo/ingreso) + `datacredito` (JSON `{score, value_monthly_payment, data}`).
3. **`user_field_values`** (form_id=1): **field_id 87 = ingreso mensual, 29 = ocupación (Empleado|Independiente|Pensionado), 160 = reportado**.
4. **`risk_central_user_data`** — la fila Experian que `/lenders` mira: `score` **plano**, `data` **ENCRIPTADO Laravel**, `created_at=NOW()` (para que caiga en el reuso <1mes). `risk_central_id` = `Experian - Acierta+Quanto` o `Experian - Acierta`.

**Para que PASE reglas:** `ingreso ≥ mayor umbral`, `score ≥ mayor min_score + margen`, ocupación/edad en rango. Umbrales de: `group_rules`+`lender_rules` (capa comercio por `allied_branch_id`), `lender_users_category_rules.min_score` (rt=2 cupo) o `lender_datacredito_rules.score` (rt≠2).

**Scrub (register limpio) — tablas hijas a borrar antes del user** (por user_request_id y user_id, FK checks off en transacción): `user_summaries, user_field_values, risk_central_user_data, user_requests, confirmation_email_logs, lender_transactions, user_request_products, creditop_x_user_requests_records`.

**Encriptación del buró (laravel_encrypt) — lo no-obvio.** Cast `encrypted:collection`, `Illuminate\Encryption\Encrypter`, **AES-256-CBC**:
```
payload = base64( json{ iv, value, mac, tag } )
  value = base64( AES-256-CBC( PKCS7(plaintext) ) )
  iv    = base64( 16 bytes aleatorios )
  mac   = hex( HMAC_SHA256( key, iv_b64 . value_b64 ) )   ← concatena los STRINGS base64
  tag   = ""   (CBC no es AEAD)
key = base64_decode(APP_KEY sin prefijo "base64:") → 32 bytes
```
Si el APP_KEY no es el de dev, el MAC no valida y legacy no puede desencriptar `$user->datacredito->data`. Plaintext "limpio" que aprueba: `agregatedInfo.overview.principals` con `currentNegativeCredits:0, negativeHistoricalLast12Months:0, consultedLast6Months:1, maturationSince:"2015-01-01"`; `creditCard[].businessBehaviourVectorProduct:"1111…"` (24 chars); `liabilities[].…:"NNNN…"`. Ref Node: `frontend-e2e/pkg/laravel-crypt.ts`, `pkg/inject.ts`, `pkg/asesor.ts`; panel `panel/server.ts`+`panel/index.html` (:5195, manual+inject, switch sintético/real, `create3.ts`).

---

### 3. Mapa de data-testids + bin/testids

Los specs prefieren `getByTestId(...)` con fallback a role/text. **Casi ningún testid existe en el frontend** (salvo employment/expedition) → viven como PATCH sobre el working tree del monorepo (nunca se commitea/pushea): `bin/testids on|off|status|regen` (`frontend-e2e/patches/e2e-testids.patch`). Los primitivos `Input/Button/SelectTrigger/SelectItem/MoneyInput` hacen spread de `{...props}` → un `data-testid` llega al DOM.

| testid | archivo (frontend-monorepo, prefijo `modules/loan-request-wizard/`) | elemento |
|---|---|---|
| `amount-input`, `amount-submit` | `loan-application-form/src/components/amount-form.tsx` | MoneyInput monto / Button "Iniciar solicitud" |
| `phone-input`, `phone-submit` | `loan-application-form/src/components/phone-number-step-form.tsx` | Input tel / Button "Continuar" |
| `otp-input`, `otp-submit` | `packages/shared/components/src/components/otp.tsx` (+ primitivo `packages/ui/src/components/input-otp.tsx`) | InputOTP / Button "Confirmar" — ⚠ `otp-input` es el único con duda de forwarding a nodo focuseable |
| `personal-info-form`, `docnum-input`, `identification-submit` | `loan-application-form/src/components/forms/personal-info-form.tsx` | div externo / Input doc / Button en PersonalInfoSubmitButton |
| `date-selector-{day,month,year}` + `-option-${v}` | `packages/ui/src/components/date-selector.tsx` (compartido; usar `month.value` numérico, NO title) | usado en fecha de expedición y nacimiento (`birth-date-selector.tsx`) |
| `employment-info-form`, `employment-status-trigger`, `employment-status-option-${v}` (Empleado\|Independiente\|Pensionado\|Desempleado), `monthly-income-input`, `employment-submit` | `loan-application-form/src/components/forms/employment-info-form.tsx` | — |
| `expedition-date-submit` | `loan-application-form/src/components/document-expedition-date.tsx` | Button "Continuar" (NO "No corresponde") |
| `lender-toggle-${lenderData.id}` | `lenders-marketplace/src/components/lender-card/LenderCard.tsx` | botón expandir (id numérico de tabla `lenders`) |

En el flujo **asesor** el e2e solo usa amount/phone/otp + `lender-toggle` (el KYC personal/empleo/fecha se INYECTA por DB, no por UI). El resto sirve para el flujo manual completo.

---

### 4. Cheat-sheet de mocks / bypasses / stashes (superficie de producto)

- **OTP bypass (producto):** tabla/setting `qa_otp_bypass_phones` → `OtpService` delega a `OtpBypassService::validateOtpCodeBypassed`, que **valida contra los últimos 4 dígitos del teléfono** y saltea el proveedor externo. Migración `2026_05_26_120000_add_qa_otp_bypass_phones_to_settings_table`.
- **Modo mock legacy-backend:** `make up && make mock-all && make restart` → drivers fake (`ONBOARDING_DRIVER_*=fake`, `EXPERIAN_DRIVER=fake`) + header `X-Fake-Scenario` (`success`, `invalid-code`, `issue-date-mismatch`, …). Doc `legacy-backend/docs/local-dev.md`.
- **Stash bypasses backend** (`stash@{0}` "bypasses completos"): guards `if (app()->environment('local','development'))` que evitan Twilio/S3/Wompi. `git stash apply`, nunca commitear.
- **Stash testids frontend** (`stash@{0}`): data-testid flujo completo + lender-action + fix `lenderData.id`.
- **Wompi:** ÚNICO rt=1 con mock nativo — `WOMPI_MOCK_ENABLED=true` (`config/services.php:297`), `app/Actions/Lenders/Wompi.php`.
- **BD local:** contenedor `legacy-backend-mysql-1` (MySQL 8.0.35, :3306, esquema `creditop`, dump de inertia-dev). Sembrar precondiciones: `backend-e2e: go run . prep --merchant X --lender Y` (idempotente, `go run . clean` limpia).
- **`.env.local` wizard** (gitignored): `VITE_API_URL=http://localhost`, `VITE_ONBOARDING_FORM_SERVICE=…/api/forms-fake`.

---

### 5. Tesis de CASOS-ESPECIALES: por qué "falla el random" (casi todo = gap de config)

El `random N` arma su pool con `response_type IN (2,3) OR id IN (24,68,100)` (`backend-e2e/main.go:466`) — incluye rt=2/rt=3 por tipo y **fuerza por ID** Credifamilia (24, rt=4) + Bancolombia (68/100, rt=1); excluye rt=0 y el resto de rt=1. `classifyErr()` (`main.go:551`) etiqueta cada ❌ con su tipo de gap.

| response_type | ¿iguales entre sí? | ¿cierra in-platform? | random |
|---|---|---|---|
| **0 · UTM** (46) | TODOS iguales (redirect a URL del lender, `case 0` solo URL+`openNewTab`) | ❌ no (por diseño) | excluir |
| **2 · Creditop X** (73 activos) | mismo flujo | ✅ si config completa | incluir; ❌ = 3 tipos de gap |
| **3 · Cupo Rotativo** (13) | iguales (revolving) | ✅ | incluir |
| **4 · Credifamilia** (1) | estudio async | ⚠️ APROBADO (no 11) | incluir con bypass |
| **1 · Integración** (16) | 4 sub-grupos A/B/C/D | ⚠️ async/redirect | incluir solo con mock de host |

**El 500 de garantía = null-deref, NO "variable NULL→eval"** (el gap rt=2 más común). Cadena verificada: `authorize` → `DocumentSigningService::generateGuaranteeDocument` → `GuaranteeService::generateGuaranteePdf()` **devuelve null cuando FGA<=0** (`GuaranteeService.php:125,137`) y NO persiste fila `Guarantee`; pero `shouldRequestGuarantee()` es **true** porque **existe fila en `lender_guarantee_criteria`** (`GuaranteeService.php:212`); entonces `Guarantee::where(...)->first()` (`DocumentSigningService.php:541`) = null y `$guarantee->id . '_'…` (`:543`) **desreferencia null → 500**. El path `eval()` (`GuaranteeService.php:214-216`) está MUERTO: **56/56 filas de `lender_guarantee_criteria` tienen `variable=NULL`** → el eval nunca se ejerce hoy.

**Otros gaps rt=2:** Celupresto(96) → `promissory-note` 500 por falta `lenders_by_allieds(96,allied)` (`PaymentCalculationService.php:25 firstOrFail`); Creditop X(37)/139 deceval → `promissory-note` 500 por falta `RiskCentralCredential` tipo Lender (`DecevalSoap.php:54`).

**Bancolombia PLS:** cupo vs "no preaprobado" depende de UNA cosa: si el comercio tiene `lender_allied_credentials` para 68/100. `validateQuota` → `LenderAlliedCredential::findOrFailByLenderAndAlly(68,branch)` (`BancolombiaBnpl.php:675`); sin credencial → `ModelNotFoundException` → `hasBnpl=false` → **PLS005**. El gate NO es `lenders_by_allieds` (eso solo lista).

**rt=1 externos, 4 sub-comportamientos:** A. redirect+async (Welli 23, BdB 5, Sistecrédito-Pay 9, Approbe 41); B. OTP in-store (Sistecrédito-POS 9 vía interface `OtpValidation`, Compensar 47 gateado por nombre `UserRequestService.php:556-557`); C. link por notificación (Meddipay 39, `url=''`); D. pasarela de pago (Wompi via credencial `wompi_method` dentro del `case 1`, Payvalida, BdB CeroPay 133). Cada uno necesita mock de su host `*.fake` para E2E; solo Wompi trae mock nativo.

**Cifras canónicas (auditoría SQL BD local, ±1 por seed):** rt=2 activos 73 (totales 76); con fila `lender_guarantee_criteria` **51/73 ≈ 70%**; sin `lender_users_categories` 23/73 ≈ 32%; `lender_guarantee_criteria` **56/56 = 100% variable NULL**. Bancolombia: ~109 allieds ofrecen 68/100, ~111 con credencial, **~6 ofrecen sin credencial** (→ PLS005, ej. BICICLETAS STRONGMAN allied 228). Corrida real `random 18`: **17✅/1❌** (el único ❌ = CrediFis #124 rt=2, guarantee_criteria+FGA=0 — exactamente lo predicho). **SmartPay #152 es rt=2 y cierra por CreditopXClose estándar (NO por IMEI)**; el IMEI es colateral de Motai (158, `motaiClose`).

**error_code vs error_subcode:** `error_code` (ONBnnn = qué paso, para routing FE) ≠ sufijo/subcódigo (CODE_EXPIRED, EXPEDITION_DATE_INVALID = la causa, para mensajes/obs). El backend REAL emite `error_subcode` **anidado** bajo `errors` (`errors.error_subcode`: `OtpService.php:181,203,256,781`; `OnboardingController.php:1097-1099,674-681,780-792`; `ApiResponse.php:44`). El shape top-level `error_subcode` (fuera de `errors`) era del mock muerto. Catálogo TS: `frontend-e2e/pkg/config.ts::expectedSubcodes`.

---

### 6. Regla de oro (CONVENCIONES — no romper)

- **`playground/*`** (backend-e2e, frontend-e2e, flows, docs, …): ✅ commit local, ❌ NO push. Un solo repo git, es la fuente de verdad del sandbox.
- **Repos reales** (legacy-backend, frontend-monorepo, application): ❌ NO commitear a main, ❌ NO armar PRs sin pedir explícitamente. Los cambios de prueba viven en `git stash` / ramas locales (`test`, `mock-onboarding`), nunca en main. La decisión de abrir PR es manual del usuario.
- **dev = data compartida** (aliados + refactor + otros devs). Toda escritura impacta a todos → guard explícito (`X-Confirm-Dev:1` / `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`), por defecto solo READ.
- Nunca commitear `.env.local`, `.cognito.json`, `db-dump/`.

## Dónde mirar
- **backend-e2e (Go, NO indexado)** (playground): runtime Flow (pkg/flow/flow.go), composer runOne (main.go), tabla strategies (lender/lender.go), cierres (lender/closes.go), random+classifyErr (main.go:466,551); subcomandos prep/get/doctor/clean/random/asesor
- **frontend-e2e (Playwright/TS, NO indexado)** (playground): composeFlow+merchantSpecs (pkg/composer.ts), pasos atómicos (pkg/wizard-steps.ts), inject in-process (pkg/inject.ts), laravel-crypt.ts, asesor.ts, panel (panel/server.ts :5195), patch de testids (patches/e2e-testids.patch), dbops.ts, config.ts::expectedSubcodes
- **OtpBypassService.php + OtpService.php** (legacy-backend): bypass OTP de producto: qa_otp_bypass_phones setting → valida contra últimos 4 dígitos del teléfono; error_subcode anidado en errors (OtpService:181,203,256,781)
- **OnboardingService.php / CreditStudyService.php** (legacy-backend): guard de reuso de buró <1 mes (userHasDataCredito ~:1550-1584 consulta risk_central_user_data within last month) → clave para inyectar buró sintético
- **UserRequestService.php (Onboarding)** (legacy-backend): switch case 0/1/2 de cierre (updateUserRequest): url_utm+openNewTab, ramas por empty(credential), validateLenderOtp por nombre (Compensar :556-557) — 897 líneas, es el que tiene el switch (NO el homónimo de Loans)
- **DocumentSigningService.php + GuaranteeService.php** (legacy-backend): el 500 de garantía = null-deref: FGA<=0 → generateGuaranteePdf null (Guarantee:125,137) + fila guarantee_criteria hace shouldRequestGuarantee true (:212) → first() null → ->id deref (DocumentSigning:541,543); eval en :214-216 MUERTO (56/56 variable NULL)
- **CreditopXQuotaController.php / PaymentCalculationService.php / DecevalSoap.php** (legacy-backend): gating rt=2/3 del cierre in-platform (:159,170,186); promissory-note 500 por firstOrFail (PaymentCalc:25, asociación allied faltante); deceval sin RiskCentralCredential (DecevalSoap:54)
- **PreApprovedLenderService.php / BancolombiaBnpl.php / LenderAlliedCredential.php** (legacy-backend): PLS Bancolombia: gate real = lender_allied_credentials (findOrFailByLenderAndAlly 68/100, Bnpl:675); sin credencial → PLS005
- **Wompi.php / SistecreditoPos.php / Compensar.php / Meddipay.php / Welli.php + ApiResponse.php** (legacy-backend): los 4 sub-comportamientos rt=1 (A redirect/async, B OTP in-store, C link, D pasarela); Wompi = único mock nativo (WOMPI_MOCK_ENABLED); ApiResponse:44 shape error_subcode
- **loan-application-form + lenders-marketplace + packages/ui|shared** (frontend-monorepo): superficie de testids del wizard: amount/phone/otp/personal-info/employment/expedition/date-selector/lender-toggle (spread {...props} lleva data-testid al DOM)

## Frontera de simulación / harness
Este ES el nodo del OKR de pruebas de Miguel. Frontera de inyectabilidad del harness: rt=2/rt=3 in-platform (CrediPullman, Cupo Rotativo) deciden 100% en legacy → SÍ inyectables/simulables E2E con usuario sintético + buró (score/data en risk_central_user_data). rt=1 integración (Bancolombia, Welli, etc.) deciden vía API externa → NO inyectables sin mock del host *.fake (solo Wompi trae mock nativo WOMPI_MOCK_ENABLED). rt=0 UTM no se cierra in-platform por diseño (el random los excluye). rt=4 Credifamilia async entra por ID quemado, cierra en APROBADO (no Estado 11), requiere bypass. El random es un medidor de completitud de config, no de flujo: su ❌ mapea 1:1 con gaps (guarantee_criteria+FGA=0 → authorize 500; asociación allied faltante o deceval sin credencial → promissory-note 500; Bancolombia sin lender_allied_credentials → PLS005).

## Gotchas / riesgos
- Los dos harness (backend-e2e, frontend-e2e) NO están en el índice de context (solo los 3 repos de producto) — este nodo cura la superficie de PRODUCTO que tocan; el código del harness solo se cita en prosa.
- La encriptación del buró usa el APP_KEY de dev: si no es el correcto, el MAC no valida y legacy no puede desencriptar $user->datacredito->data. El mac concatena los STRINGS base64 (iv_b64 . value_b64), no los bytes.
- Casi ningún data-testid existe en el frontend real (salvo employment/expedition) → viven en un PATCH sobre el working tree (bin/testids on/off), NUNCA se commitea ni pushea.
- El 500 de garantía NO es 'variable NULL → eval'; es null-deref (fila guarantee_criteria + FGA=0). El path eval() está MUERTO en la BD actual (56/56 filas variable=NULL).
- SmartPay #152 es rt=2 y cierra por CreditopXClose estándar, NO por IMEI. El IMEI es colateral de Motai (158, motaiClose).
- Hay DOS UserRequestService.php homónimos: el switch case 0/1/2 vive en Modules/Onboarding/…/UserRequestService.php (897 líneas), NO en el de Loans (364 líneas).
- Credifamilia (24, rt=4) y Bancolombia (68/100, rt=1) entran al random por ID quemado, no por su response_type; el pool base es rt IN (2,3).
- El backend real SÍ emite error_subcode pero anidado bajo errors (errors.error_subcode); el shape top-level era del mock muerto.
- dev = data compartida (aliados+refactor+otros devs); toda escritura impacta a todos → guard explícito y por defecto solo READ. En local NO hay envío de OTP (por eso el cliente sintético + teléfono bypass).
- El bypass de OTP en producto valida contra los ÚLTIMOS 4 DÍGITOS del teléfono (qa_otp_bypass_phones), no un código fijo.

## Preguntas abiertas
- [ ] ¿El primitivo InputOTP (packages/ui/input-otp.tsx) forwardea data-testid a un nodo focuseable? El testid otp-input es el único con duda de forwarding (el e2e hace click + keyboard.type).
- [ ] El nodo cura solo la superficie de producto; el detalle vivo del harness (flags, defaults del random) depende de backend-e2e/SUITE.md que no está indexado — ¿conviene un nodo espejo del harness o basta la prosa?
- [ ] Las cifras de deuda de config (51/73, 56/56 NULL, ~6 Bancolombia) se mueven ±1 por seed; no hay snapshot versionado en el índice.

## Bitácora
- **2026-07-17** — Nodo de referencia creado bajo el group Plataforma. Superficie: 29 archivos, 29/29 resuelven. Síntesis de `HARNESS-ARQUITECTURA + HANDOFF-PRUEBAS + E2E-DATA-TESTIDS + CASOS-ESPECIALES + CONVENCIONES` para hacer el árbol autosuficiente (resolver tareas sin abrir docs/).

## Enlaces
- playground/docs/operacion/HARNESS-ARQUITECTURA.md
- playground/docs/operacion/HANDOFF-PRUEBAS-ONBOARDING.md
- playground/docs/operacion/E2E-DATA-TESTIDS.md
- playground/docs/codigo/CASOS-ESPECIALES.md
- playground/docs/operacion/CONVENCIONES.md
- playground/backend-e2e/SUITE.md
- playground/backend-e2e/VALIDATION.md
- playground/docs/codigo/REFERENCIA-FLUJOS.md
- playground/docs/codigo/LOGICA-QUEMADA.md
- playground/frontend-e2e/VALIDATION.md
