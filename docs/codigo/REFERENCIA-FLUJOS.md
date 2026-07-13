# REFERENCIA-FLUJOS — mecanismo técnico por flujo de originación

> **Referencia técnica ÚNICA por-flujo.** Para cada flujo de originación: *qué hace distinto*, el
> recorrido entrada→cierre, las **citas `archivo:línea` verificadas** contra el código real, y un
> **cheat-sheet de mocks/bypasses** para correrlo E2E en local. Fusión del detalle verificado de los
> antiguos `CONTEXT.md` + `FLUJOS.md`.
>
> Extraído del código REAL (no de suposiciones) cruzando:
> - `legacy-backend` (PHP/Laravel; corre LOCAL en modo mock con drivers `fake`) — `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend`
> - `frontend-monorepo` (wizard React/React-Router: `apps/loan-request-wizard` + `modules/loan-request-wizard/*`) — `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo`
> - `bitbucket/application` (monolito Inertia/Vue: panel asesor/admin + flujo legacy)
> - `dynamic-form` + microservicio `onboarding-forms-service` (formularios dinámicos)

### Reparto de dueños (este doc NO duplica lo de otros)

| Tema | Dueño |
|------|-------|
| Taxonomía `response_type` 0–4 + ciclo de vida `user_request_statuses` | [`./CREDITOP.md`](../CREDITOP.md) |
| Estructura de tablas/columnas/relaciones | [`./MODELO-DATOS.md`](./MODELO-DATOS.md) |
| Inventario de hardcodes (IDs, montos, status, branches, PII) | [`./LOGICA-QUEMADA.md`](./LOGICA-QUEMADA.md) |
| Por qué "falla el random" / clasificación de fallos + cifras de deuda rt=2 | [`./CASOS-ESPECIALES.md`](./CASOS-ESPECIALES.md) |
| Encadenamiento FE↔BE (URL→archivo→endpoint→controller/service→tabla→prueba) | [`./MAPA-FLUJOS.md`](./MAPA-FLUJOS.md) |
| CLI del harness Go (subcomandos/defaults) | [`../backend-e2e/SUITE.md`](../../backend-e2e/SUITE.md) |
| Estado de validación backend | [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md) |
| Setup UI + estado/detalle SmartPay/mutex/Cognito | [`../frontend-e2e/README.md`](../../frontend-e2e/README.md), [`../frontend-e2e/VALIDATION.md`](../../frontend-e2e/VALIDATION.md) |

> **Cómo leer las pruebas:** la columna/nota "prueba" remite siempre a
> [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md) y [`./MAPA-FLUJOS.md`](./MAPA-FLUJOS.md). Aquí se cita el comando
> `go run . <canal> <comercio> <lender>` solo como ancla; el estado PROBADO/CÓDIGO vive en esos docs.

---

## 0. El eje que lo explica todo: `lenders.response_type`

El tipo de cierre lo define **el lender**, no el comercio. Es la variable que más cambia el flujo. (La
semántica completa de cada `response_type` y del ciclo de estados vive en [`./CREDITOP.md`](../CREDITOP.md);
aquí solo el resumen operativo.)

| rt | Cómo CIERRA | ¿Estado 11 in-platform? | Lenders top (volumen real) |
|----|-------------|------------------------------|----------------------------|
| **2** · Creditop X | Pagaré + consent firmados con OTP → `authorize` | ✅ Sí, directo | CrediPullman(77), Celupresto(96), Motai(158), Creditop X(37), smartpay(152) |
| **3** · Cupo Rotativo | Pagaré Maestro 1ª vez; reutiliza cupo sin pagaré después | ✅ Sí | (subconjunto CtopX) |
| **1** · Integración | `register()` → URL de redirect/handoff al portal del lender; Estado 11 llega luego por **Job async / webhook** | ⚠️ No en el click; sí async | Welli(23), Banco Bogotá(5), Meddipay(39), Sistecrédito(9), Bancolombia(8/68/100), SmartPay RD(153) |
| **4** · Async polling | Se **radica** al pintar el marketplace; el front hace polling de estado; al seleccionar da `standBy` | ⚠️ No directo | Credifamilia(24) |
| **0** · UTM | (varios; Credifamilia-addi 6, Sufi 7/28) | depende | Credifamilia-addi(6), Sufi(7/28) |

> **Nota de naming front↔back:** el wizard usa otros nombres de enum (`STANDARD:0`, `PRE_APPROVED:1`,
> `CREDITOP_X:2`, `CREDITOP_X_REVOLVING:3` en `lender.constants.ts:14-19`) y **no define rt=4**: Credifamilia
> se maneja por `CREDIFAMILIA_LENDER_ID=24` hardcodeado, no por response_type. La taxonomía canónica
> (UTM/Integración/…) es la de [`./CREDITOP.md`](../CREDITOP.md).

**Implicación clave:** el cierre Creditop X (`CreditopXClose` → Estado 11) solo aplica a rt=2/3, que es
minoría del volumen. La mayoría (rt=0/1/4) cierra distinto. El harness Go ya despacha por `response_type`
(ver §12).

---

## 1. La base común (lo que TODOS comparten)

```
register → OTP → KYC (AgilData → Mareigua → TusDatos) → laboral (field_id 29/87/160/161)
        → marketplace (profiling/ML) → selección de lender → cierre
```

Lo que cambia entre flujos es **(a) cómo se inyecta el ingreso**, **(b) qué lender se elige**, y **(c)
cómo cierra ese lender** (`response_type`).

- KYC cascade: `OnboardingService.php:85` (AgilData → Mareigua → TusDatos).
- Laboral: `storeLaboralInformation` escribe los 4 campos — `field_id` 29=Situación laboral, 87=Ingresos
  mensuales, 160=reportes negativos, 161=Continuidad laboral (tabla `fields`; detalle en [`./MODELO-DATOS.md`](./MODELO-DATOS.md)).
- Marketplace: el FE llama `GET .../lenders-v2/{uReq}` → `LenderListingController@index` →
  `LenderListingService::getLenders()` (que invoca el perfilador). El path viejo `lenders/{uReq}` →
  `ListLenderController` → `LenderRetrievalService` **ya no lo usa el FE**. Encadenamiento FE↔BE completo en [`./MAPA-FLUJOS.md`](./MAPA-FLUJOS.md).

| Leyenda de pruebas | |
|---|---|
| ✅ PROBADO | corrido E2E contra el backend real, resultado confirmado (ver `../backend-e2e/VALIDATION.md`) |
| 📖 CÓDIGO | lógica extraída del código; el E2E requiere un mock/infra aún no montado |

---

## 2. Matriz de diferencias (de un vistazo)

| Flujo | Canal | Disparador | Entrada especial | Cierre / estado final | Servicios externos (mock) |
|-------|-------|-----------|------------------|-----------------------|---------------------------|
| **Estándar / Creditop X** (§3) | asesor/web | `allied.have_ctopx=1` + lender rt=2 | — | verify-otp → **authorize → 11** | PdfMapper fake (stash) |
| **Pullman / DFS** (§4) | asesor | `allied_id ∈ {94,189}` | Quanto auto-inyecta ingreso (field 87); **salta laboral** | igual a estándar | Experian Quanto (`aciertaQuanto`) — fixture |
| **Corbeta** (§5) | asesor → flujo Bancolombia | `allied_id ∈ settings.corbeta_allieds` | Inyecta laboral dummy (87=1.5M, 29=Empleado); usuario `TEMPORAL USER`; `ONB006` | (según lender elegido) | — (código puro) |
| **Cupo Rotativo** (§6) | asesor | lender rt=3 | — | 1ª: Pagaré Maestro; 2ª+: solo consent, sin pagaré | PdfMapper fake |
| **Motai** (§7) | asesor (advisor) | `allied_id=158`, `allied_modes.id=2`, `isMotaiRenting=true` | PEP bypassa KYC; Abaco (ingreso gig) | contrato device-lock → device/enroll → disburse → **11** | Abaco `AbacoFixture`; MDM con bypass `local` |
| **SmartPay (RD)** (§8) | web (wizard `/merchant/{hash}/`) | `country_id=60` + `path_id=2` (IMEI) | **Formulario dinámico** (microservicio); cédula 11 díg | IMEI path → contrato RD → enroll → 11 (lender 152 rt=2 cierra in-platform) | `onboarding-forms-service` (forms) + Redis; o FAKE local |
| **Bancolombia** (§9) | asesor/web | credencial con `bancolombia_type` | motor PLS (BNPL #68 vs Consumo #100), `encrypt_code` | flujo in-platform multi-paso → origination → 11 (portal) | sandbox por nº documento (no-prod) |
| **Ecommerce / Web** (§10) | web | branch con `AlliedEcommerceCredential` | Handshake **base64** (`serialize()` PHP); anclaje compra↔crédito; OTP con `ecommerce_request_id` | igual a estándar + **webhook al comercio** | token de BD |
| **Externos rt=1** (§11) | asesor/web | lender rt=1 | — | `register()` → redirect URL / OTP / link SMS; **11 vía Job async/webhook** | mocks por host (WireMock/`Http::fake`) |
| **Credifamilia** (§12) | asesor/web | lender id=24, rt=4 | radica al pintar marketplace; "En validación" | polling estado; `standBy`; no 11 en el click | mTLS + OAuth, `pdf-mapper-service` |
| **Rutas negativas** (§13) | — | inputs inválidos | — | error codes (ONB001/005/040/006, 422) | `X-Fake-Scenario` header |

---

## 3. Estándar / Creditop X in-platform — `rt=2`

**Qué hace distinto:** es el ÚNICO grupo donde **Creditop financia y cierra in-platform** hasta Estado
11. Genera pagaré + carta de instrucciones (consent) + plan de pagos, todo firmado con OTP. Categoriza al
usuario en `lender_users_categories` (las categorías y su FGA creciente — orden y % en [MODELO-DATOS](./MODELO-DATOS.md)) y eso sobreescribe tasa/cupo/FGA.

**Cuándo una cosa vs otra:** si el lender tiene `promissoryType=deceval` firma por SOAP Deceval; si es
`traditional`/`ownership` genera PDF local. Requiere que el lender tenga categoría y `credit_line` o el
marketplace lo excluye / el pagaré revienta (`UnknownPromissoryTypeException`).

**Entrada → cierre (orden real):**
```
GET /lenders/{uReq} → lender-user-category → POST update-user-request/{uReq}
  → select-payment-date / confirm-payment-date (→ Estado 10)
  → simulate / confirm-payment-schedule → GET promissory-note/{uReq} (preview)
  → send-otp → verify-otp (Estado intermedio "Autorizado pendiente desembolso")
  → authorize (genera docs, Estado 11)
```
⚠️ El cierre real es **2 pasos**: `verify-otp` (devuelve `otp_id`, `next_step='authorize'`) y luego
`authorize(int, ?int otpId)` con el OTP ya validado. El harness usa `ForceOtpValidation`+`authorize`
(atajo equivalente que llega a 11).

**Servicios:**
- `PromissoryNoteSigningFactory` → `deceval`=`DecevalPromissoryNoteService` (SOAP) | `ownership`/`traditional`=`TraditionalPromissoryNoteService` (PDF local).
- `DocumentGeneratorFactory` (blade vs microservicio PdfMapper; por defecto **blade**, fallback a blade si el micro falla).
- `LenderUserCategoryService` (reglas duras + scoring → `lender_users_categories`).

**Tablas tocadas** (estructura en [`./MODELO-DATOS.md`](./MODELO-DATOS.md)): `user_requests`, `promissory_notes`,
`creditop_x_consents` (tipo 1/2), `creditop_x_requests_history` (libro mayor), `creditop_x_revolving_credits`,
`lender_users_categories`, `guarantees`, `otps`.

> ⚠️ **Bug de naming en el backend:** la tabla real es `creditop_x_requests_history` (requests en plural,
> history en singular). `CreditopXRequestHistoryService.php:93` la referencia mal como
> `creditop_x_request_histories` (no existe); `ActiveCreditRepository.php:12,26` usa el nombre correcto.

**Citas:** `ValidateOtpPromissoryNoteController.php:270` (verifyOtp → otp_id),
`LoanAuthorizationService.php:71,~336` (authorize → resolveAuthorizationStatusId → 11),
`PromissoryNoteService.php:225-233` (shouldRequestPromissoryNote),
`PromissoryNoteSigningFactory.php:13-21`, `LenderRetrievalService.php:678` (exclusión sin categoría).

**Prueba:** `go run . asesor 3e67eade 77` → Estado 11 (CrediPullman). Ver
[`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).
> ⚠️ Por UI el cierre Creditop X está **BLOQUEADO** por la config de lender del mirror (#77→Wompi hosted;
> #37→`/continue?url=null` 404). Validado solo en backend (asesor `3e67eade` 77 → Estado 11). El bloqueador
> NO es falta de testids. Detalle en [`../frontend-e2e/VALIDATION.md`](../../frontend-e2e/VALIDATION.md).

**Cheat-sheet:** stash `legacy-backend` **stash@{1}** = cierre Creditop X (fake pdf-mapper + Throwable en
handlers); ya aplicado al working tree. `DOC_GEN_*=blade`. `PdfMapper` fake requiere `PDF_MAPPER_FAKE=true`.
Lender necesita `promissoryType` y categoría o se cae/excluye. OTP por bypass (§14).

---

## 4. Pullman / DFS — ingreso por buró (Experian Quanto) — `rt=2`

**Qué hace distinto:** para `allied_id==94` (Pullman, "Amoblando Pullman") o `189` (DFS, "DENTIX"), al
enviar personal-info en la rama "Flow B" (sin agilData/mareigua en sesión) el backend consulta **Experian
Quanto** y **auto-inyecta el ingreso** desde el buró, **saltando el formulario laboral**. Pullman además
fuerza `hadPreApproveLender=false` (siempre consulta) y dispara `userViability`; DFS no
(`is_dfs_not_pullman`).

**Efecto:** de `productValueList[productCode=62][0]` saca el promedio; si `value>0` inyecta
`user_field_values` field **87** (ingreso = `value*1000`), **29**=Empleado, **160**=no, y
`user_summaries.quanto`. Si hay ingreso → salta el formulario laboral.

**Cuándo una cosa vs otra:** si Quanto devuelve `value>0` → salta laboral; si no → pide laboral manual.

**Mecanismo del mock (VALIDADO):** la rama `aciertaQuanto` usa el fixture `ExperianFixture::aciertaQuantoReport()`
(con `productValueList[productCode=62]`) y **SÍ inyecta** el ingreso en `field 87` (observado ≈2.500.000).
El fake `success` genérico (`ExperianHttpFake.php:58`, `aciertaGoodScore`) NO trae `productValueList`, así que
solo inyecta con el fixture Quanto correcto (`mock_rules MOBA1002` habilitado + teléfono que matchee,
`Experian.php:410`). El bloqueo previo NO era el fake sino el guard **ONB005 DOCUMENT_DUPLICATE**: `register`
persistía el `document_number`, así que `personal-info` veía el doc como duplicado y cortaba **antes** del
bloque Quanto. **Fix (solo harness):** para Pullman NO se manda el documento en `register`.

**Citas:** `OnboardingService.php:668-731` (isPullman==94 / isDFS==189; userViability solo Pullman),
`OnboardingService.php:491` (`hadPreApproveLender=false`), `Experian.php:447-451` (closure fixture),
`Experian.php:687-705` (escribe field 87 = value*1000 y field 29=Empleado),
`ExperianHttpFake.php:58-63` (aciertaGoodScore sin productValueList), `ExperianHttpFake.php:171-183`
(quantoBody con productCode 62).

**Prueba:** `go run . asesor 3e67eade 77` → `merchant.Verify` confirma `field 87`. (3e67eade = allied 94 =
Pullman; el cierre sobre lender 77 llega a 11.) Ver hallazgos 4–5 en [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).

**Cheat-sheet:** la auto-inyección Quanto exige `mock_rules MOBA1002` (no el fake `success`); no requiere
host externo. Doc del fixture: `ExperianFixture`.

---

## 5. Corbeta (Alkosto / K-TRONIX / Alkomprar) — fricción cero

**Qué hace distinto:** "Corbeta" NO es un comercio ni un lender; es un **feature** que se dispara para
`allied_id ∈ settings.corbeta_allieds` (p.ej. Alkosto 209, K-TRONIX 210, Alkomprar 211) o `isPash`. En
`storePersonalInfo` (Flow B) el backend **inyecta un perfil laboral DUMMY** sin consultar nada externo y
devuelve `error_code=ONB006` (en una respuesta `success=true`, HTTP 200) que el front usa para **redirigir
al flujo Bancolombia**. El usuario llega como `full_name='TEMPORAL USER'` (creado en el checkout Corbeta).

**Efecto:** `storeLaboralInformation(uid, urid, 1500000, 'Empleado', 3)` → inyecta fields 29/87/160/161.

**Cuándo una cosa vs otra:** la inyección dummy ocurre en la rama "else" (sin datos AgilData/Mareigua); si
los hubiera, no se inyecta. Si el `allied_id` NO está en `corbeta_allieds`, el usuario temporal recibe
`ONB002` y se bloquea.

> **Disparador local:** `settings.corbeta_allieds` real en el mirror = `[24, 209, 210, 211]`; el harness Go
> siembra `[209, 210, 211, 32]` (`database.go:107`). La lista difiere por fuente — verifica cuál está activa.
> Inventario de IDs en [`./LOGICA-QUEMADA.md`](./LOGICA-QUEMADA.md).

**Citas:** `OnboardingService.php:637-664` (inyección dummy), `OnboardingController.php:765,1159,1264`
(ONB006), `CorbetaCheckoutController.php:788-800` (TEMPORAL USER). El handling FE de ONB006 vive en
`app/routes/bancolombia/onboarding/otp.tsx:161-163` (ver [`./MAPA-FLUJOS.md`](./MAPA-FLUJOS.md)).

**Prueba:** `go run . asesor a1c0b15d 68` (a1c0b15d = Alkosto, allied 209) → `merchant.Verify` confirma la
inyección dummy (field 87 = 1.500.000, field 29 = Empleado) sin mocks externos. El cierre real va a Bancolombia.

**Cheat-sheet:** solo requiere que `settings.corbeta_allieds` contenga el `allied_id`. Sin mock externo.

---

## 6. Cupo Rotativo — `rt=3`

**Qué hace distinto:** la 1ª compra genera un **Pagaré Maestro** vinculado al cupo
(`creditop_x_revolving_credits`); las compras siguientes **NO generan pagaré nuevo** (solo consent tipo 2),
suman `used_limit` y recalculan las cuotas de todas las utilizaciones.

**Cuándo una cosa vs otra:** `shouldRequestPromissoryNote()` → `true` si no existe pagaré con `otp_id` para
ese cupo, `false` si ya existe. El FGA se lee del `revolving_credit` (`revolvingCredit->fga`), no del lender.

**Citas:** `PromissoryNoteService.php:225-233` (shouldRequestPromissoryNote),
`ConsentService.php:269` y `PaymentCalculationService.php:210` (FGA del revolving).

**Prueba:** `go run . asesor 3e67eade 71` → ciclo 1 Estado 11 + Pagaré Maestro (requirió seed de
`creditop_x_revolving_credits` + asociación `lenders_by_allieds`); ciclo 2 (dedup) parcial. Ver
[`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).

**Cheat-sheet:** mismo cierre que rt=2 (PdfMapper fake, stash@{1}); además sembrar `creditop_x_revolving_credits`.

---

## 7. Motai Renting — IMEI + Abaco + PEP

**Qué hace distinto (3 cosas):**

1. **Garantía = hardware (IMEI):** NO genera pagaré; genera un **acuerdo device-lock**
   (`creditop_x_consents` tipo **3**, `creditop_x_consent_types.id=3` name `device_lock_agreement`). El
   código detecta `lender.path.name==='IMEI'`. El cierre es:
   ```
   verify-otp (Estado intermedio "Autorizado pendiente desembolso")
     → device/register (enrola IMEI en MDM PayJoy/Knox vía AlliedProductService::enroll)
     → device/{id}/disburse (regenera PDF con IMEI real, Estado 11)
   ```
   **Dos actores:** advisor (Vue/bitbucket) inicia + escanea IMEI; cliente (wizard React) firma. Polling
   cruzado `advisor-status` / `client-status`. El disburse exige `user_request_products.imei` registrado;
   `ImeiValidationService` valida formato (15 dígitos + Luhn, `ImeiValidationService.php:13,20`).
2. **Ingresos por Abaco** (economía gig, no PILA): `POST /motai/check-abaco-requirement` (lee
   `alliedMode.config.isAbacoRequired`) → wizard conecta plataformas (`/scraping/init|login/step-1|step-2|results`);
   `AbacoParserService` guarda `user_summaries.abaco`. ⚠️ NO escribe `field_87` (persiste el ingreso dummy del PEP).
3. **PEP/PPT:** si `document_type=='PEP'` → bypassa TusDatos/AgilData/Mareigua (migrantes) e inyecta laboral
   dummy (87=1.5M, 29=Empleado, 160=no, 161=3). Código puro, sin mock.

**Disparador:** `allied_id=158`, `allied_modes.id=2` (code `motai-renting`, name `MotaiRenting`,
`config={"isAbacoRequired":true}`), flag `isMotaiRenting=true` en register/otp. Filtra lenders a `[158]` vía
`AlliedModeLenderFilterService`.
> Existen además `allied_modes.id=1` (`motai`) y `id=3` (`motai-alquiler`); el filtrado por allied_mode
> tiene 3 modos, no solo renting.

**MDM IMEI (bypass `local`):** `AlliedProductService::enroll` tiene un bloque `if (app()->environment('local'))`
que **simula** el dispositivo y crea `products` + `user_request_products` sin pegar al MDM
(`merchant_gateways` `/device-locking/devices/enroll`). En `local` **ya no da 500**. El servicio expone
además status/lock/unlock/pin-unlock (`/device-locking/devices/{status,lock,unlock,pin-unlock}`) para el
ciclo de vida del dispositivo.

**Backdoor:** `motaiUpdateStatusOrchestrator` fuerza status 11 o 9.

**Códigos propios (semántica real, `MotaiValidationService.php:142-155`):** `MOTV1000`="La solicitud no
requiere Abaco" (HTTP 200, **es ÉXITO**; también se retorna cuando NO hay `alliedMode` activo, `:89`);
`MOTV1001`="La solicitud requiere Abaco" (HTTP 200, `:111`); `MOTV1002`="Error interno del servidor" (HTTP
500; también cuando `user_request` es null, `:84`). ⚠️ No confundir: 1000/1001 son respuestas OK (sin/con
Abaco); solo 1002 es error.

**IVA del device-lock:** se calcula vía `lenders_by_allieds.iva` (`DeviceLockAgreementService.php:174,184`),
separado del 19% hardcodeado del plan de pagos (ver §8 y [`./LOGICA-QUEMADA.md`](./LOGICA-QUEMADA.md)).

**Citas:** `OnboardingService.php:230-267` (PEP bypass dummy), `MotaiValidationService.php:70-190`,
`AlliedProductService.php:28-67` (bloque local-e2e bypass enroll), `AlliedProductService.php:76,157,196,228`
(status/lock/unlock/pin-unlock), `LoanAuthorizationService.php:106-166` (disburseImeiRequest),
`DeviceLockAgreementService.php:44,97` (detección IMEI + consent type 3), `AbacoFixture.php:12`
(generateDynamicMock), `AbacoService.php:77` (lee `mock_pass`).

**Prueba:** `go run . asesor f0548728 158` → Estado 11 (f0548728 = comercio Motai). Requirió el bypass MDM
local + seed `credit_line` para lender 158. Ver [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).

**Cheat-sheet:** en `local` `AbacoFixture` automático; `settings.abaco_config.mock_pass=true` fuerza pase.
MDM enroll: bypass `local` ya aplicado (no requiere `Http::fake`). Jobs IMEI (lock/unlock/unroll — horarios en [MODELO-DATOS](./MODELO-DATOS.md)) si se prueba el ciclo de vida.

---

## 8. SmartPay (República Dominicana, `country_id=60`) — formulario dinámico + país

**Qué hace distinto (3 cosas):**

1. **Formulario dinámico** (lo distintivo) — NO es un flag, es un sistema de 3 capas:
   1. **Esquema** en microservicio externo `onboarding-forms-service`
      (`GET /v1/dynamic/{partner_hash}/schema` y `.../full/{formHash}/schema`): define campos/opciones/steps/tema
      (ciudades RD, tipos doc, rangos DOP) sin tocar código.
   2. **Sesión Redis** entre pasos (`/api/partner/dynamic-form/session/{txId}`, TTL 3600s).
   3. **Validación dinámica** en `DynamicFormsService::dynamicFormValidation` (payload vs especificación,
      tipo por tipo) en `POST /api/onboarding/dynamic-forms/create-user`. Campos → `user_field_values`
      162-172 + 87/90 (`DYNAMIC_FORM_USER_FIELD_ID_MAP`). El submit delega a `userCreateFacade` (código éxito
      `DYFS1001`). Es OTRA entrada (`/merchant/{hash}/request-*`), no el wizard estándar.
   - El flag legacy `lenders.complementary_form` era el predecesor (pantalla extra de datos financieros);
     superado por el formulario dinámico.

2. **Mutaciones por país (`country_id==60`):** rate SIN cap de usura colombiana
   (`country_id != 60 ? min(creditLine.rate, request.rate) : request.rate`, `PaymentCalculationService.php:196`);
   locale `es_DO` / moneda `DOP` (`DeviceLockAgreementService.php:157-158`); cédula `CED` 11 díg (front);
   mailer `'smartpay'` si el lender es canal SmartPay (`isSmartpayChannel()`, ver abajo); QR en POS.
   - **SMS por driver `'service'` (no Twilio):** se activa por el **flujo IMEI** (`$isImei`), no por país —
     `TwilioMessagingService.php:110` (`return $isImei ? ...->via('service') : ...`). SmartPay lo usa porque
     va por IMEI.
   - ⚠️ **ITBIS 18% NO está automatizado por país:** el IVA de garantía está hardcodeado 19%
     (`PaymentCalculationService.php:80-83`); el ITBIS se configura manual en `lenders_by_allieds.iva=18`.

3. **Cierre IMEI** (igual mecánica que Motai §7: contrato device-lock → enroll → disburse).

**Cuándo una cosa vs otra:** disparador = lender `country_id=60` + `path_id=2` (IMEI) + `cutoff_type_id=2`
(quincenas); allied también `country_id=60`. Para forzar: `UPDATE lenders SET country_id=60, path_id=2, cutoff_type_id=2`.

> ⚠️ **Realidad de IDs (local):** el lender `160` que el código hardcodea **NO existe en BD local**. Local
> tiene `152` (slug `smartpay`, **rt=2**, country 1) y `153` (`SmartPay`, **rt=1**, country 60 RD). Así
> que "SmartPay = rt=2 in-platform" aplica al **152** (cierra vía `CreditopXClose` estándar — NO IMEI; el
> IMEI es de Motai #158); el de RD (153) es rt=1.
> El mailer `'smartpay'` **ya no hardcodea el 160**: `NotificationService.php:55,148` llama
> `$userRequest->lender?->isSmartpayChannel()` → `Lender.php:65-67` compara `(int)$this->id ===
> (int)config('lenders.smartpay_lender_id')`; el literal `160` vive SOLO en `config/lenders.php:24`
> (`env('APP_ENV')==='production' ? 160 : 153`, así que en dev/local resuelve a **153**). Otros puntos que aún
> comparan contra el id concreto: `VoucherService.php:51,108` (voucher), `LenderRetrievalService.php:257,263,679`,
> y el skip de encuesta `lender_id !== 160` (`SatisfactionSurveyCheck.php:38`). Inventario completo en
> [`./LOGICA-QUEMADA.md`](./LOGICA-QUEMADA.md).

**Citas:** `DynamicFormsService.php:42-54` (DYNAMIC_FORM_USER_FIELD_ID_MAP 162-172), `:179` (userCreateFacade),
`:1137-1271` (dynamicFormValidation), `DynamicFormsRepository.php:53-79`,
`PaymentCalculationService.php:80-83,196-199`, `DeviceLockAgreementService.php:157-185,235`,
`TwilioMessagingService.php:110`, `SmartPayTestSeeder.php`, `routes/dynamic/*` (front).

**Prueba:** lender `smartpay` (#152, rt=2) cierra OK in-platform (`random 18`); cadena dinámica vía harness
`go run . smartpay` (backdoor `BDUS002/003` → accept-terms `BDTM002` → `dynamic-forms/create-user` `DYFS1001`
→ resolve-lenders-redirect); IMEI vía Motai. El entry del formulario dinámico requiere
`onboarding-forms-service` + Redis (no montado) — por eso se usa el **FAKE local** (ver cheat-sheet). Ver
[`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md) y, para el detalle de UI (mutex/Cognito), [`../frontend-e2e/VALIDATION.md`](../../frontend-e2e/VALIDATION.md).

**Cheat-sheet:**
- `SmartPayTestSeeder` crea lender/allied/branch/usuario RD y da los curls E2E.
- **FAKE local del forms-service:** `AppServiceProvider::fakeFormsServiceRoutesForLocal` sirve
  `/api/forms-fake/dynamic/*` (schema, send-otp, validate-otp, full/find-user-*, upload, submit) y el submit
  delega a `DynamicFormsService::userCreateFacade` → `DYFS1001`. Vive en **stash@{0}** del legacy-backend.
- UI: el wizard `/merchant/*` llama al forms-service DIRECTO; el legacy-backend lo FAKEA con esas rutas. Exige
  Cognito (`default-layout`) y ata la URL al comercio del usuario (`default-layout.tsx:63` redirige si
  `partner_hash != userAlliedBranchHash`). Mutex en `pkg/account-lock.ts`. `DEV_SESSION`/`X-Dev-Session` y
  `mock-server :4000/validation-driven` están OBSOLETOS/ELIMINADOS. Detalle en [`../frontend-e2e/VALIDATION.md`](../../frontend-e2e/VALIDATION.md).
- Hash real de SmartPay (allied 24) = `bb534d6a` (los slugs `smartpay001`/`motai001`/`qu4nt0001` son placeholders muertos).

---

## 9. Bancolombia — motor de decisión PLS multiproducto

**Qué hace distinto:** Bancolombia **no es un lender simple, es un motor de decisión**: evalúa en paralelo
**BNPL (#68)** y **Consumo (#100)** y asigna el producto con un código **PLS001–005**. NO usa el `register()`
genérico: genera `encrypt_code` y una URL interna (`/bancolombia/{type}/explicacion-de-flujo/{code}`); el
flujo es **in-platform** (no sale del dominio).

**PLS (`validateBancolombiaPreapprove`):**
| Código | Significado | Efecto |
|--------|-------------|--------|
| PLS001 | solo BNPL | asigna #68 |
| PLS002 | solo Consumo | asigna #100 |
| PLS003 | ambos (multiproducto) | ofrece ambos |
| PLS004 | pending | respuesta al frente |
| PLS005 | sin cupo | cancela, `status=8` |

**Cuándo una cosa vs otra:** BNPL valida con monto 100k, Consumo con 1M; si ninguno tiene cupo → `status=8`.

**Cierre:** multi-paso dedicado del portal del banco (OAuth2+JWT). El conteo "8 pasos" es ilustrativo; el
flujo real de ConsumerLoan encadena (`saveLenderIntegrationFlowStep`): `authenticate → retrieve_terms →
register_terms → enable_offers → validate_credit_study → simulation → retrieve_accounts → disbursement`
(`BancolombiaLoanController.php:343,562,727,852,966,1277,1279,1697`). BNPL tiene su propia secuencia
(login-redirect → retrieve-quota → terms → dynamic-key-signature → origination). El handoff es redirect al
portal → **fuera del alcance in-platform** del harness.

**Citas:** `PreApprovedLenderService.php:646-888` (validateBancolombiaPreapprove; PLS001-005 en :722-726,744-846),
`UserRequestService.php:452-581` (encrypt_code), `BancolombiaBnpl.php:565-643,720-836`,
`BancolombiaConsumerLoan.php:565-621`.

**Prueba:** `go run . asesor bccce1c6 68` → motor PLS validado ("cupo en BNPL", asignó #68). Requirió bypass
`Http::fake` del host Bancolombia (auth + validate-quota). Ver [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).

**Cheat-sheet:** sandbox por nº de documento en no-prod (`1998228194`/`10000000011` = con cupo;
`1998228111` = sin cupo); métodos BNPL tienen bloques `!isProduction()` con payloads hardcodeados
(`BancolombiaBnpl.php:720`).

---

## 10. Ecommerce / Web headless

**Qué hace distinto:** entra por un **handshake Base64** (el comercio manda `?o=&p=&t=&u=&ps=&config=`, todo
base64; `o` es `serialize()` PHP). `EcommerceRequestService::deserializeOrderData` hace
`base64_decode`→`unserialize` (fallback json), valida el token contra `AlliedEcommerceCredential.credential`
y persiste `ecommerce_requests`. Ancla compra↔crédito y al cerrar **notifica a la tienda por webhook**.

**Orden:**
```
POST ecommerce-request/create/{hash} (front SSR) → redirect con cookie
  → otp-validate con ecommerce_request_id en body (stateless)
  → ancla user_requests_by_ecommerce_request + ecommerce_requests.user_request_id
  → personal-info (prefill billing; documentNumber/Type readonly)
```

**Webhook de cierre:** al autorizar (Estado 11), `notifyEcommerceStore` mapea vía `WoocommerceStatus`
(11→`completed` línea 391, 8→`cancelled` línea 153, …) y hace `POST` al `process_url`: WooCommerce (Basic
Auth), VTEX (headers AppKey/Token), o self-dev (payload `{orderId, approvedAmount, status, transactionId,...}`).
Error se traga.

**Diferente del asesor:** `origination_flow_type=ecommerce` (middleware `AddOriginationFlowType`), crea nuevo
`user_request` por `order_key`, monto fijado por carrito (`>0`, si `total<=0` → `ERS002`), prefill+readonly,
webhook al cierre.

**Citas:** `EcommerceRequestService.php:287-461` (deserializeOrderData),
`UserRequestService.php:88-224`, `ValidateOtpPromissoryNoteController.php:381-407` (notifyEcommerceStore),
`CorbetaCheckoutController.php:661,671` (base64_decode + @unserialize), `AddOriginationFlowType.php`,
`routes/ecommerce/checkout.tsx`.

**Prueba:** `go run . web 17f7b360 77` → la entrada base64 pasa los 4 pasos
(create/register/otp/personal/laboral) contra el backend real. Ver [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).

**Cheat-sheet:** usa el token de `AlliedEcommerceCredential` de BD; el `WebEntry` del harness ya replica el
handshake. Falta validar el webhook de cierre (WoocommerceStatus).

---

## 11. Externos redirect — `rt=1` (Welli, Banco de Bogotá, Meddipay, Sistecrédito)

**Qué hace distinto:** comparten la clase base `Integration` pero **entregan el control al portal externo**.
Al seleccionar (`UserRequestService::updateUserRequest`, `switch(rt) case 1`) se ejecuta el `register()` del
Action del lender; Creditop queda en estado intermedio (3/10) y el **Estado 11 llega solo por Job async
(`StatusCheck`) o webhook posterior**.

| Lender | id | Handoff | Cómo llega a 11 |
|--------|----|---------|-----------------|
| Banco de Bogotá | 5 | mTLS → `RedirectUrl` (popup/redirect) | `StatusCheck` job (Disbursed→11) |
| Welli | 23 | `next_step_url` | `StatusCheck` (estado `desembolsado`→11) |
| Sistecrédito POS | 9 | sin URL; `validateLenderOtp=true` → front pide OTP → `validate()` crea transacción Approved | (sin POS: `paymentRedirectUrl` + webhook) |
| Meddipay | 39 | URL vacía; `openProcessModal=true`; link al cliente por WhatsApp/SMS | estado por webhook |
| SmartPay RD | 153 | rt=1 (ver §8) | — |

**Citas:** `UserRequestService.php:452-581` (switch rt case 1), `BancoDeBogota.php:70-259`,
`Welli.php:178-378`, `SistecreditoPos.php:147-292`, `Meddipay.php:53-184`. Jobs en
`app/Jobs/Lenders/{Welli,BancoDeBogota}/StatusCheck.php`.

**Prueba:** ✅ pre-aprobación: `go run . asesor 1941e23b 23` (Welli, branch allied 74) y
`go run . asesor 76db47f5 39` (Meddipay, branch allied 26) vía mock de host. El cierre es el portal del
banco, fuera de alcance. Ver [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).

**Cheat-sheet:** requieren mock por host externo (WireMock / `Http::fake`) apuntando los `*_HOST` — mismo
patrón que el bypass de Bancolombia. (El bypass S3 + Sistecrédito host vive en **stash@{2}**.)

---

## 12. Credifamilia — estudio asíncrono + PDFs — `rt=4`

**Qué hace distinto:** se **radica al pintar el marketplace** (no al seleccionar): `PreApprovedLenderService`
llama `Credifamilia::register()` (OAuth + mTLS → `POST servicescf/consumo/radicacion`) → crea
`lender_transactions` (status `CREDIT_IN_PROCESS`=40, `order_id=transactionId`). Aparece "En validación", no
seleccionable. Es el único con firma **Netco** (batch) para sus documentos.

> Nota: 40/41/42 son IDs de `lender_transaction_statuses` (`CREDIT_IN_PROCESS`/`CREDIT_APPROVED`/…), **no**
> de `user_request_statuses`. Las etiquetas "En validación"/"APROBADO" son paráfrasis. Ciclo de estados en
> [`./CREDITOP.md`](../CREDITOP.md), tablas en [`./MODELO-DATOS.md`](./MODELO-DATOS.md).

**Polling (front):** cada 5s, **MAX_ATTEMPTS=8** (=40s) → `GET .../lenders/{urid}/24/pre-approval-status` →
`Credifamilia::show()` mapea estado API (1=no ejecutado / 2=en análisis → en proceso 40; 3+APROBADO →
aprobado 41; 3+RECHAZADO / 4 → denegado 42).

**Servicio de PDFs:** `LegalService` + `PdfMapperServiceClient` genera el TyC firmado vía microservicio
`pdf-mapper-service` (`POST /api/projects/credifamilia/documents/terminos-y-condiciones/generate`), sube a S3.

**rt=4 al seleccionar:** `standBy=true`, URL `/self-service/{hash}/{id}/confirmation` (no abre pestaña). No
pasa a 11 aquí.

**Citas:** `Credifamilia.php:122-413` (register :216 POST radicacion, show :323),
`PreApprovedLenderService.php:306-449`, `LenderRetrievalService.php:935-1010` (mapeo polling),
`LegalService.php:41-148`, `useLenderValidation.ts:234-270` (`POLLING_CONFIG MAX_ATTEMPTS=8 INTERVAL_MS=5000`).

> ⚠️ El timeout de `register()` es configurable: `Setting('credifamilia_timeout')` con **fallback 1s**
> (`Credifamilia.php:197`) en register y fallback 30s en otro punto (`Credifamilia.php:58`). En local sin
> servicio, el fallback 1s lanza `ConnectionException` y se quita del listado.

**Prueba:** `go run . asesor 80059314 24` → radicación (status 40) → polling → APROBADO (status_id 41).
Requirió bypass local de `Credifamilia::register/show` (sin host). Ver [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).

**Cheat-sheet:** sembrar `lender_transactions` (status 40) + apuntar `CREDIFAMILIA_HOST` a un mock que
devuelva `{status:3, status_detail:APROBADO}`. Polling de identidad del harness: 15 intentos (no-Abaco) / 36
(Abaco); Credifamilia `MAX_ATTEMPTS=8`.

---

## 13. Rutas negativas / anti-fraude (entrada)

**Qué hace distinto:** no es un comercio/lender, es la familia de **rechazos de la entrada**.

### Nomenclatura: `error_code` vs sufijo descriptivo

Dos niveles distintos que NO hay que confundir:
- **`error_code`** (genérico, `ONBnnn`) = **qué paso del flujo** reportó el error. Útil para **ROUTING** del FE
  (ej. `otp-verification.tsx:82,86` ramifica por code).
- **Sufijo descriptivo** (`CODE_INVALID`, `EXPEDITION_DATE_INVALID`, etc.) = **la CAUSA** específica. Útil para
  mensaje al usuario, observability y aserciones de spec.

**Shape de transporte (backend real, HETEROGÉNEO según endpoint).** No asumir un único shape:
- `error_code` concatenado: `error_code: "ONB005_EXPEDITION_DATE_INVALID"` (típico de personal-info).
- Campos separados anidados: `errors.error_code: "ONB001"` + `errors.error_subcode: "CODE_INVALID"`
  (cuando aplica; el backend-e2e busca en `errors.*` y `data.*`).
- `error.code` anidado en KYC: `error.code: "DOCUMENT_NOT_FOUND"`.
- `message` libre como fallback: `"document number already in use"` (caso documento duplicado).

El campo separado `error_subcode` (top-level) del viejo mock `:4000` ya **no aplica** al backend real, pero el
helper de aserción del backend-e2e (`channel/negative.go::errField` + OR contra `errCode`/`errSubcode`/`message`)
es tolerante con todas las formas anidadas. Recomendación para los specs del frontend: usar un
helper que busque el marker (`"ONB001"`, `"CODE_INVALID"`, …) como string en cualquier parte del body
(ver `frontend-e2e/pkg/error-shape.ts`).

En esta tabla y en el resto de docs, el `+` entre code y sufijo significa "compuesto" (el shape exacto
depende del endpoint, ver arriba). El catálogo TS de sufijos vive en
`frontend-e2e/pkg/config.ts::expectedSubcodes`.

**Escenarios fake** (`X-Fake-Scenario`) del backend real provienen de `HttpFakeRegistrar` y son **distintos**
de los nombres que usaba el mock-server `:4000`. Familia OTP (driver fake): `success`, `invalid-code`, …
(con `ONBOARDING_DRIVER_OTP=fake` + `ONBOARDING_FAKES_ALLOW_HEADER=true`). Familia TusDatos:
`issue-date-mismatch`, `name-mismatch`, `document-not-found`, `aml-findings`. Familia Experian:
`success`, `poor-score`, `no-hit`, `server-error`, `timeout`. Default global:
`ONBOARDING_FAKES_DEFAULT_SCENARIO` (típicamente `success`).

⚠️ **No todos los escenarios aplican a cualquier partner.** El driver KYC depende del comercio:
- **Pullman (allied 94, hash `3e67eade`)** y **Dentix (189)** ejecutan **Experian Quanto** — los
  escenarios `tusdatos.*` se IGNORAN (respuesta `success:true`). Para gatillar errores KYC, usar
  los escenarios Experian (`server-error`/`timeout`/`no-hit` → `ONB030 internal server error`,
  validado en `frontend-e2e::kyc-subcodes`).
- **Comercios estándar** (no Pullman/Corbeta/Motai/Ecommerce) → ejecutan TusDatos; ahí sí aplican
  `issue-date-mismatch`/`document-not-found`/etc. (pendiente verificación E2E con partner estándar).
- **Corbeta** (allieds 24/209/210/211) auto-inyecta laboral dummy → bypassa el KYC clásico.
- **Motai** (allied 158) usa Ábaco → flujo distinto.

### Catálogo

| Código compuesto | Origen | HTTP | Condición |
|--------|--------|------|-----------|
| ONB001 + `CODE_INVALID`/`CODE_EXPIRED`/`NO_PREVIOUS_OTP`/`PROVIDER_UNREACHABLE`/`PROVIDER_ERROR` | `OtpService::validateOtpCode` | 200 | OTP no coincide / expirado / sin OTP previo / proveedor caído |
| ONB005 + `DOCUMENT_DUPLICATE` | `findByDocumentAndType` | 200 | Cédula ya registrada en otro celular |
| ONB005 + `EXPEDITION_DATE_INVALID` | `checkdate()` | 200 | Fecha imposible (31-feb) |
| ONB005 + `EXPEDITION_DATE_MISMATCH` | TusDatos (Registraduría) | 200 | Fecha no coincide con la registraduría |
| KYC `error.code` ∈ `DOCUMENT_NOT_FOUND` / `KYC_VALIDATION_FAILED` / `PROVIDER_ERROR` | `KycValidationOutcome` | 200 | doc inexistente / nombre no coincide / bureau caído |
| ONB006 | Corbeta (§5) | 200 (`success=true`) | redirige a flujo Bancolombia |
| ONB030 + `"internal server error"` | Experian (driver fake) | 200 (`success=false`) | escenarios Experian `server-error`/`timeout`/`no-hit` — bureau falló o no devolvió hit. NO emite sufijo descriptivo tipo `PROVIDER_ERROR`; el mensaje es genérico. Validado en `frontend-e2e::kyc-subcodes`. |
| ONB040 | `checkRateLimitPerHour` (Redis) | 400 | > N intentos/hora por documento (default 4); o falta `user_request_id`/`partner_branch_id` |
| ERS002 | `EcommerceRequestService` | — | monto inválido (`total<=0`) |
| MOTV1002 | `MotaiValidationService` | 500 | error interno / `user_request` null (`:84`). ⚠️ MOTV1000 ("no requiere Abaco") y MOTV1001 ("requiere Abaco") son respuestas OK (HTTP 200), NO errores |
| HTTP 422 | `PersonalInfoRequest::rules()` | 422 | email inválido / tipo doc no en [CC,CE,PEP] / longitudes / fechas |
| ONB021/022/023 | controller | 404 | UserRequest / User / AlliedBranch no encontrado |

**Inyección de escenarios:** header `X-Fake-Scenario: <nombre>` requiere `ONBOARDING_FAKES_ALLOW_HEADER=true`.
Escenarios por driver: experian (`success`,`poor-score`,`no-hit`,`server-error`,`timeout`), tusdatos
(`issue-date-mismatch`,`name-mismatch`,`document-not-found`,`aml-findings`), etc. Default:
`ONBOARDING_FAKES_DEFAULT_SCENARIO` o `success`.

**Citas:** `OtpValidationOutcome.php:17-21`, `KycValidationOutcome.php:27,30`,
`PersonalInfoRequest.php:21` (in:CC,CE,PEP), `OnboardingService.php:79,147` (rate-limit),
`config/onboarding.php:53-55` (default_scenario + allow_header_override), `HttpFakeRegistrar.php:46-99`.

**Prueba:** `go run . negative 3e67eade` → 4/5 (ONB001 x2, 422, ONB005-fecha; documento-duplicado pendiente).
Ver [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).

---

## 14. Cheat-sheet: mocks / bypasses para E2E local

| Necesidad | Cómo | Dónde |
|-----------|------|-------|
| **OTP sin Twilio** | teléfono en `settings.qa_otp_bypass_phones` → código = **últimos 4 dígitos** del teléfono (también salta rate-limit). En `local`, `readOtpFromRedis` devuelve `1111`. | `OtpService.php:98,426`, `OtpBypassService.php` |
| **Cierre Creditop X (rt=2/3) → PDFs** | **stash@{1}** (fake pdf-mapper + Throwable handlers) aplicado; `DOC_GEN_*=blade`; `PDF_MAPPER_FAKE=true` para PdfMapper | `AppServiceProvider` (stash@{1}) |
| **Quanto inyecta ingreso (Pullman)** | `mock_rules MOBA1002` + teléfono que matchee → `aciertaQuantoReport` inyecta `field 87`; NO con el fake `success`. Para Pullman, no mandar doc en `register` (evita ONB005). | `Experian.php:447`, `OnboardingService.php:668` |
| **Corbeta** | `settings.corbeta_allieds` debe contener el `allied_id` (sin mock externo) | `settings` |
| **Motai Abaco** | en `local` `AbacoFixture` automático; `settings.abaco_config.mock_pass=true` fuerza pase | `AbacoFixture.php` |
| **Motai MDM (IMEI enroll)** | bypass `if (app()->environment('local'))` ya aplicado: simula el enroll y crea products/user_request_products (no da 500) | `AlliedProductService.php:28-67` |
| **SmartPay (entry dinámico)** | FAKE local del forms-service (**stash@{0}**, rutas `/api/forms-fake/dynamic/*`) o `onboarding-forms-service` + Redis; `SmartPayTestSeeder`; `lenders.country_id=60, path_id=2, cutoff_type_id=2` | stash@{0} / seeder |
| **Bancolombia** | nº documento sandbox (`1998228194`=cupo, `1998228111`=sin) en no-prod | `BancolombiaBnpl.php:720` |
| **Credifamilia** | sembrar `lender_transactions` status 40 + mock `CREDIFAMILIA_HOST` con `{status:3,APROBADO}` | — |
| **Externos rt=1** | WireMock/`Http::fake` en `*_HOST` (Welli/Bancolombia/BancoBogotá/Meddipay/Sistecrédito) | stash@{2} (S3+Sistecrédito) / `.env` |
| **Escenarios negativos** | `ONBOARDING_FAKES_ALLOW_HEADER=true` + `X-Fake-Scenario` | `config/onboarding.php` |

**Stashes en `legacy-backend`** (NO commitear; ya aplicados al working tree):
- **stash@{0}** = bypasses completos + SmartPay forms-service FAKE (`fakeFormsServiceRoutesForLocal`).
- **stash@{1}** = cierre Creditop X (fake pdf-mapper + Throwable en handlers).
- **stash@{2}** = bypasses S3 bucket + Sistecrédito host.

> El inventario completo de hardcodes (IDs, montos, magic numbers, branches, PII) vive en
> [`./LOGICA-QUEMADA.md`](./LOGICA-QUEMADA.md); aquí solo se citan los necesarios para montar cada mock.

---

## 15. Apéndice: el harness Go ya despacha por `response_type`

`lender.Close` (`backend-e2e/lender/lender.go:68-85`) hace `switch` con estrategias dedicadas (no es un TODO):

| Caso | Estrategia | Definida en |
|------|-----------|-------------|
| `id==158` o name contiene "motai" | `motaiClose` | `closes.go:76` |
| `id==24` o name contiene "credifamilia" | `credifamiliaClose` | `closes.go:217` |
| `id==68 \|\| id==100` o name contiene "bancolombia" | `bancolombiaClose` | `closes.go:126` |
| `ResponseType==3` | `revolvingClose` | `closes.go:18` |
| `ResponseType==1` | `externalClose` | `closes.go:157` |
| default (rt=2) | `CreditopXClose` | `lender.go` |

El harness Go **no lee `.env`**: la conexión está hardcodeada en `backend-e2e/pkg/config/config.go` (usuario
`creditop`, API `http://127.0.0.1:80/api`). BD local:
`docker exec legacy-backend-mysql-1 mysql -ucreditop -ppassword creditop -e "SQL"`. Subcomandos/defaults del
CLI en [`../backend-e2e/SUITE.md`](../../backend-e2e/SUITE.md); estado de cada flujo en
[`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md).
