> Backlog accionable del harness **frontend-e2e** (Playwright) contra el `legacy-backend` local en modo mock.
> Este doc NO lleva el "estado por flujo" (eso es de [`VALIDATION.md`](VALIDATION.md)); aquí queda solo **lo que
> falta**: testids pendientes (con rutas reales), helpers de cierre por construir, y el orden de trabajo.
> Quickstart/setup en [`README.md`](README.md); negocio (response_type, estados) en
> [`../docs/NEGOCIO.md`](../docs/NEGOCIO.md); mapa FE↔BE en [`../docs/MAPA-FLUJOS.md`](../docs/MAPA-FLUJOS.md).

# PLAN DE PRUEBAS — backlog frontend-e2e (Playwright)

## Premisa (corregida)

El bloqueador del cierre **Creditop X rt=2 → `loan-approved` por UI NO es la falta de `data-testid`**. El stash
del frontend-monorepo (`stash@{0}: "local-e2e: data-testid flujo completo + lender-action marketplace + SmartPay
dynamic-form"`) ya cubre el flujo de entrada completo (amount/phone/otp/personal/employment/expedition/
date-selector + `initial-fee-input`), el **selector de lender genérico** `lender-action-{id}`
(`lenders-marketplace/.../LenderCardContent.tsx:259`) y los testids `sp-*` del formulario dinámico SmartPay.

El muro real es la **config de lender del mirror local** (verificado por captura de red; ver
[`lender/close.ts`](lender/close.ts):23-34): los dos rt=2 candidatos rutean a destinos externos/rotos —
**#77** exige cuota inicial y redirige a **Wompi hosted checkout** (página externa; `WOMPI_MOCK` aplica al
webhook, no al checkout), y **#37** responde `["redirect","/self-service/bb534d6a/{id}/continue?url=null",302]`
→ `/continue?url=null` da **404**. Agregar más testids (Grupo B/C) **no desbloquea** porque la UI nunca alcanza
esas pantallas. El cierre rt=2 → Estado 11 **ya está validado en backend** (`backend-e2e: go run . asesor
3e67eade 77`, que fuerza `initial_fee=0` y el estado, sin Wompi ni la ruta `/continue`). Lo distintivo de cada
cierre por `response_type` se documenta en [`../docs/REFERENCIA-FLUJOS.md`](../docs/REFERENCIA-FLUJOS.md) y su
espejo Go en [`../backend-e2e/lender/closes.go`](../backend-e2e/lender/closes.go).

**Acceso a `/merchant/*`** (Motai, SmartPay): se resuelve con **login Cognito real + mutex de cuenta**, NO con el
obsoleto `DEV_SESSION`/`X-Dev-Session`. Ver detalle en [`VALIDATION.md`](VALIDATION.md) (§`/merchant/*` y §Mutex):
`.cognito.json` (gitignored) + [`pkg/account-lock.ts`](pkg/account-lock.ts) re-apunta la cuenta de prueba
(1827080) al comercio bajo prueba y la restaura. El viejo `mock-server :4000`/`validation-driven` fue **eliminado**.

**Estado por flujo (qué está verde / fixme / por qué): ver [`VALIDATION.md`](VALIDATION.md).** Lo de abajo es el
delta accionable.

---

## 1. Helpers — qué ya existe (HECHO) y qué falta

Todos espejan `backend-e2e` (`pkg/mocks/mocks.go`, `lender/{lender.go,closes.go}`) y operan **solo** contra el
stack local vía `docker exec` (mysql/tinker). Enlazamos las firmas Go en vez de recopiar.

### ✅ Ya implementados (no recrear)

| Helper / spec | Archivo | Espejo backend | Qué hace |
|---|---|---|---|
| `sql(query)` | [`merchant/seed.ts`](merchant/seed.ts):18 | — | `docker exec legacy-backend-mysql-1 mysql -uroot -ppassword creditop -N -B -e` |
| `userIdByPhone` | `merchant/seed.ts`:39 | — | último `users.id` por `cell_phone` |
| `seedApprovedProfile(phone,uReqID,score=750)` | `merchant/seed.ts`:49 | `SeedApprovedProfile` | edad/género/email + field 29/87 + `RiskCentralUserData` |
| `seedRiskProfile(phone,uReqID,{score,negatives,reportado})` | `merchant/seed.ts`:69 | `SeedRiskProfile` | perfil de riesgo controlado (field 160 reportado) para forzar oferta |
| `setStatusAndLender(uReqID,statusID,lenderID)` | `merchant/seed.ts`:93 | `SetStatusAndLender` | `UPDATE user_requests` (status/lender/rate/fee/initial_fee=0) |
| `forceOtpValidation(phone)` | `merchant/seed.ts`:100 | `ForceOtpValidation` | `UPDATE otps SET validated=1` |
| `seedAndOfferLender(page,hash,id,opts)` | [`lender/close.ts`](lender/close.ts):52 | — | siembra perfil → recarga `/lenders` → asegura `lender-action-{id}` visible. ✅ verificado #77 en `3e67eade` |
| `creditopXClose(page,hash,id)` | `lender/close.ts`:72 | `CreditopXClose` | ⛔ hoy **lanza** con el diagnóstico del muro de config (Wompi #77 / continue?url=null #37). No es un TODO vacío |
| `runHappyPathUntilLenders` + pasos | [`channel/steps.ts`](channel/steps.ts):26-137 | — | amount/phone/otp/personal/expedition/employment → `/lenders`; maneja ruteo post-OTP real |
| `creditopx-close.spec.ts` | [`lender/creditopx-close.spec.ts`](lender/creditopx-close.spec.ts) | — | ✅ VERDE: el marketplace OFRECE #77 (rt=2) seleccionable por UI; cierre completo en `.fixme` |
| `smartpay-dynamic.spec.ts` | [`merchant/smartpay-dynamic.spec.ts`](merchant/smartpay-dynamic.spec.ts) | — | ✅ VALIDADO completo (5 pasos dinámicos → `/lenders`) |
| `ecommerce-notify.spec.ts` | [`channel/ecommerce-notify.spec.ts`](channel/ecommerce-notify.spec.ts) | — | ✅ VALIDADO: `notify-store` → POST a `process_url` con `{status:'completed'}` (listener local) |
| mutex + `pointAccount` | [`pkg/account-lock.ts`](pkg/account-lock.ts) | — | re-apunta la cuenta 1827080 al comercio bajo prueba; serializa Motai/SmartPay |
| `cognitoLogin` | [`pkg/cognito.ts`](pkg/cognito.ts) | — | driven el Hosted UI de Cognito (login.creditop.com) |

> Nota: [`lender/README.md`](lender/README.md) está **desactualizado** (dice "vacío por ahora", pero `close.ts`
> ya existe). No usarlo como fuente; pendiente de actualizar.

### ⏸️ Lo que falta construir

- **Cadena de cierre Creditop X por UI** (consumida por `creditopXClose` cuando se levante el muro):
  `runFirstPaymentDate` / `runPaymentSchedule` / `runSignDocuments` / `runSignatureOtp` / `assertLoanApproved`
  en `channel/steps.ts`. **Condicionada al muro de config Wompi** — escribirlas no sirve hasta tener un rt=2 con
  `min_initial_fee=0` y sin redirect externo (arreglar config de lender en BD) o un mock del checkout Wompi.
- **`revolvingClose` (rt=3)**: reusa el ciclo Creditop X + `RevolvingCreditIntro`/`LoanConfirmation` (Grupo D).
  Mismo bloqueo de config + seed rt=3 (`seedRiskProfile` para que el marketplace ofrezca #71).
- **`runTripletAndClose(page, t)`** en [`e2e/triplet.ts`](e2e/triplet.ts): hoy `runTripletToLenders` solo llega a
  `/lenders` y **lanza** en canal `web` ([`e2e/triplet.ts`](e2e/triplet.ts):46-55). Tras `/lenders` debe invocar
  el cierre — completa el espejo del CLI `go run . <canal> <comercio> <lender>` (ver
  [`../backend-e2e/SUITE.md`](../backend-e2e/SUITE.md)). Bloqueado por el mismo muro.
- **`runMerchantModeUntilLenders(page, hash, mode)`**: entrada `/merchant/{hash}/modes` + click modo (Motai).
- **Extraer `buildCheckoutPath()`** (hoy inline en [`channel/ecommerce-local-real.spec.ts`](channel/ecommerce-local-real.spec.ts):36)
  a helper de canal `web` reutilizable.

---

## 2. `data-testid` pendientes de agregar al stash del frontend-monorepo

Formato `archivo:línea → elemento → testid`. **Raíz real**: `modules/loan-request-wizard/<submódulo>/src/...`
(no `apps/`). Líneas verificadas contra el árbol del monorepo. **Ojo:** los Grupos B/C **no desbloquean** el
cierre rt=2 mientras persista el muro de config (§Premisa) — quedan listados por completitud, no como prioridad.

### Grupo A — Marketplace ✅ YA EXISTE (genérico)
`lender-action-${lenderId}` ya está en `lenders-marketplace/src/components/lender-card/LenderCardContent.tsx:259`
y **aplica a cualquier lender** (no hay que "replicar para 158"). `MOTAI_LENDER_IDS=[158]`
(`lenders-marketplace/src/lib/domain/constants/lender.constants.ts`) es otra constante (ruteo Motai), no el
testid. La selección de lender por UI **ya funciona** (verificada en `creditopx-close.spec.ts` con #77).

### Grupo B — Cierre Creditop X: fecha + plazos (`modules/loan-request-wizard/loan-origination/src/components/`)
- `FirstPaymentDate.tsx:65` → ToggleGroupItem → `first-payment-date-option-{date}`
- `FirstPaymentDate.tsx:86` → Button submit → `first-payment-date-submit`
- `PaymentSchedule.tsx:144` → ToggleGroupItem → `payment-schedule-option-{fee_number}`
- `PaymentSchedule.tsx:250` → Button submit → `payment-schedule-submit`
- *(plazo en la card del lender: el wizard usa un `combobox`, ej. "12 cuotas" — necesita `lender-term-{id}`;
  hoy sin testid. Ver [`lender/close.ts`](lender/close.ts):14-21.)*

### Grupo C — Cierre Creditop X: documentos + firma OTP + aprobado (`.../loan-origination/src/components/`)
- `SignDocuments.tsx:204` → Card → `sign-documents-card-{doc.id}`
- `SignDocuments.tsx:219` → Button continue → `sign-documents-continue`
- `SignDocuments.tsx:271` → Button confirm → `sign-documents-confirm`
- `otp-validation.tsx` → Button confirm firma → `signature-otp-submit` *(`otp-input`/`otp-submit` de
  `shared/components/otp.tsx:257,289` ya existen)*
- `RequestStatus.tsx:181` → Link profile → `loan-approved-profile-link` (+ `loan-approved-title`,
  `return-to-store-button` para ecommerce)

### Grupo D — Cupo Rotativo intro (`.../loan-origination/src/components/`)
- `RevolvingCreditIntro.tsx` → Button continue → `revolving-intro-continue`
- `LoanConfirmation.tsx` → Button confirm → `loan-confirmation-submit`

### Grupo E — Abaco / Motai (`modules/loan-request-wizard/abaco/src/ui/components/`)
- `AbacoRedirect.tsx:42` → Button → `abaco-redirect-btn`
- `PlatformCard.tsx:51` → `<button>` → `abaco-platform-{slug}`
- `CredentialSelection.tsx:267` → Input email → `abaco-credentials-email-input`
- `CredentialSelection.tsx:296` → Button save → `abaco-credentials-save-btn`

### Grupo F — IMEI / Entry (Motai #158)
- `imei/Entry.tsx` → `imei-scan-button`, `imei-input`, `imei-confirm-input`, `imei-country-code`,
  `imei-phone-input`, `imei-submit`

### Grupo H — Credifamilia identidad/polling (`modules/loan-request-wizard/<submódulo>/src/...`)
- `identity-validation.tsx` → `document-front-input`, `document-back-input`, `face-photo-input`,
  `identity-validation-submit`
- `waiting-validation.tsx` → `validation-progress-bar`
- `sign-documents.tsx` → `sign-documents-otp-input` *(o reusar Grupo C)*

### Grupo I — Bancolombia (`modules/loan-request-wizard/<submódulo>/src/...`)
- `bnpl/loan-amount/LoanInfoView.tsx` → `bnpl-amount-input`, `bnpl-loan-info-submit`
- `bnpl/loan-summary/LoanSummaryView.tsx` → `bnpl-account-option-{id}`, `bnpl-loan-summary-submit`
- `bnpl/signature/forms/PersonalInfoForm.tsx` → `bnpl-firstname`, `bnpl-lastname`, `bnpl-email`, `bnpl-signature-submit`
- `loan/loan-terms/LoanTerms.tsx` → `consumo-terms-checkbox`, `consumo-terms-submit`
- `loan/loan-offer-evaluation/FinancialInfoForm.tsx` → `consumo-fixed-income-input`, `consumo-monthly-expenses-input`, `consumo-financial-submit`
- `loan/credit-approved/CreditApprovedView.tsx` → `consumo-credit-approved-continue`
- `shared/account-selector/AccountSelector.tsx` → `account-selector-option-{account_id}`

> **No hay "Grupo G" pendiente.** El formulario dinámico SmartPay ya está cubierto: los testids son `sp-*`
> (`sp-city-trigger`, `sp-documentType`, `sp-birthdate` en `PersonalInfoForm.tsx`, en el stash), NO `dyn-*`.
> El flujo está ✅ VALIDADO completo (ver [`VALIDATION.md`](VALIDATION.md) §SmartPay).

---

## 3. Orden recomendado (mayor desbloqueo / menor esfuerzo primero)

1. ✅ **HECHO (2026-07-18) — `bin/close-lender`.** La premisa original acá estaba INVERTIDA: `min_initial_fee=0`
   NO cierra (con fee=0 el botón "Pagar cuota inicial" queda **disabled** y el flujo se traba antes de Wompi;
   ver `lender/close.ts`). La solución real es lo contrario: un rt=2 con **`min_initial_fee>0` en TODAS las
   categorías**, para que sea cual sea la que asigne el motor de scoring, la cuota dé >0 → botón habilitado →
   redirect a Wompi → lo intercepta `pkg/wompi-mock.ts` (ya verificado) → down-payment-validation → cadena
   cableada. `bin/close-lender` siembra ese lender sintético (clona #77, fee=15% en todas las categorías,
   reversible). Verificado por `lender/cierre-x.spec.ts`. **Queda desbloqueado el paso 2** (Grupos B/C).
2. **Cadena de cierre Creditop X + Grupos B/C** una vez (1) esté resuelto: `runFirstPaymentDate/PaymentSchedule/
   SignDocuments/SignatureOtp/assertLoanApproved` en `channel/steps.ts`, consumidas por `creditopXClose`.
   Desbloquea el cierre canónico rt=2 que reutilizan flujos Creditop X, Cupo Rotativo y Ecommerce.
3. **Cupo Rotativo rt=3 + Grupo D**: `seedRiskProfile` para que el marketplace ofrezca #71; reusa el ciclo
   Creditop X. El cierre rt=3 ya está en backend (`asesor 3e67eade 71`).
4. **Credifamilia rt=4 + Grupo H**: selección + radicación por UI; el polling async se valida mejor en backend
   (`credifamiliaClose` → status 40→41; ver [`../backend-e2e/lender/closes.go`](../backend-e2e/lender/closes.go):217).
5. **Cierre Motai #158 + Grupos E/F + mocks Abaco/IMEI**: alto esfuerzo (testids Abaco/IMEI + escenarios mock
   `check-abaco-requirement`/`scraping/*`/`advisor-status`). La **entrada** por UI ya está ✅
   ([`merchant/motai-ui.spec.ts`](merchant/motai-ui.spec.ts)); falta el device flow. El cierre Motai → Estado 11
   ya está en backend (`asesor f0548728 158`). Mantener `.fixme` hasta tener los mocks.
6. **Bancolombia + Grupo I**: spec desde cero; solo tramos in-platform (OAuth del banco queda fuera, §4).

---

## 4. Qué NO es testeable por UI (queda en backend-e2e)

La **regla**: *redirect a portal externo (OAuth/proveedor)* o *transición de estado en DB sin pantalla*
permanece en `backend-e2e`. (El webhook ecommerce `process_url`/`notify-store`, antes listado aquí, **YA es
observable** por UI: [`channel/ecommerce-notify.spec.ts`](channel/ecommerce-notify.spec.ts) lo valida con un
listener local vía `host.docker.internal` — ver [`VALIDATION.md`](VALIDATION.md).)

- **Cierre Bancolombia BNPL/Consumo (rt=1) y Corbeta→ONB006:** el cierre real ocurre en el **portal OAuth del
  banco** (redirect externo con `:encrypt_code` JWT que Playwright no construye ni el banco mockea). Validado en
  backend por `bancolombiaClose` ([`../backend-e2e/lender/closes.go`](../backend-e2e/lender/closes.go):126) — solo
  asegura que el motor PLS asigna #68 BNPL / #100 Consumo. Por UI solo se cubre hasta el redirect.
- **Lenders externos rt=1 (Welli/Meddipay/BdB) y Credifamilia rt=4 async:** el cierre/originación vive en el
  **portal externo del proveedor**. La lógica distintiva (pre-aprobación/cupo, radicación `status 40→41`) se
  valida en `externalClose`/`credifamiliaClose` (`closes.go`:157,217). Por UI solo: que el marketplace ofrezca
  el lender + el polling de estado.
- **No-duplicado de Pagaré Maestro en Cupo Rotativo ciclo 2:** depende de la regla sobre
  `creditop_x_revolving_credits` real — best-effort incluso en backend (`closes.go`:65-69). No aserción fiable por UI.
- **Desembolso técnico Motai (`device/disburse`, MDM enroll) y scraping Abaco real:** `motaiClose` (`closes.go`:76)
  lo marca con gaps conocidos (requieren extender el modo mock). El desembolso/enrolamiento no tiene UI.
- **Subcódigos OBS-OTP-02 / OBS-KYC-03:** el backend real no emite `error_subcode` en OTP y usa otros nombres de
  escenario (`HttpFakeRegistrar`) — backlog #2 de [`VALIDATION.md`](VALIDATION.md). Es contrato de backend, no UI.

---

## Comercios de prueba (hashes reales)

Los slugs `motai001`/`smartpay001`/`credifam001`/`qu4nt0001` eran placeholders del `mock-server :4000`
**eliminado**: muertos. Hashes reales de `allied_branches` (taxonomía completa en
[`../docs/LOGICA-QUEMADA.md`](../docs/LOGICA-QUEMADA.md)):

| Hash | Allied | Comercio | Uso en specs |
|---|---|---|---|
| `3e67eade` | 94 | Amoblando Pullman (branch 1592) | Pullman/Quanto; cierre #77 rt=2 (backend) |
| `bb534d6a` | 24 | Creditop (branch 570) | SmartPay dinámico; #37 rt=2 |
| `f0548728` | 158 | Motai (branch 682) | Motai (`/merchant/*` con Cognito) |
| `a1c0b15d` | 209 | Alkosto (branch 944, Corbeta) | Corbeta no-temporal → /lenders |

> **"Quanto"** es el motor de scoring de Pullman (auto-inyecta el field de ingreso → salta employment), **no un
> comercio**. El allied 189 es DENTIX, no "Quanto".

---

Archivos clave (rutas absolutas):
- `/Users/miguelochoa/Desktop/CREDITOP/playground/frontend-e2e/channel/steps.ts` (helpers de pasos)
- `/Users/miguelochoa/Desktop/CREDITOP/playground/frontend-e2e/lender/close.ts` (cierre + diagnóstico del muro)
- `/Users/miguelochoa/Desktop/CREDITOP/playground/frontend-e2e/merchant/seed.ts` (seeders, espejo de `mocks.go`)
- `/Users/miguelochoa/Desktop/CREDITOP/playground/frontend-e2e/e2e/triplet.ts` (composable a cerrar)
- `/Users/miguelochoa/Desktop/CREDITOP/playground/frontend-e2e/pkg/{config.ts,account-lock.ts,cognito.ts}` (config + Cognito/mutex)
- Espejo backend: `/Users/miguelochoa/Desktop/CREDITOP/playground/backend-e2e/lender/{lender.go,closes.go}`,
  `/Users/miguelochoa/Desktop/CREDITOP/playground/backend-e2e/pkg/mocks/mocks.go`
