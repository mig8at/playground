# LÓGICA QUEMADA — catálogo transversal de hardcodes de Creditop

> **Dueño único** del inventario de lógica quemada del sistema: IDs literales (lender / allied /
> branch), `status_id`, `response_type`, `country_id`, `field_id`, montos/umbrales, ramas por
> entorno, listas duplicadas y datos personales (PII) cableados en el código.
>
> Cada hardcode se documenta **una sola vez aquí**, con su `archivo:línea`, el **repo** donde vive
> y la **ruta de módulo completa** cuando el `basename` es ambiguo. Lo que NO es hardcode vive en
> sus dueños y se enlaza:
>
> - Taxonomía `response_type` (0-4) + ciclo de vida de estados → [`./CREDITOP.md`](../CREDITOP.md)
> - Estructura de tablas / columnas / relaciones → [`./MODELO-DATOS.md`](./MODELO-DATOS.md)
> - Por qué "falla el random" / clasificación de fallos + deuda `rt=2` → [`./CASOS-ESPECIALES.md`](./CASOS-ESPECIALES.md)
> - Encadenamiento FE↔BE (URL→archivo→endpoint→controller/service→tabla→prueba) → [`./REFERENCIA-FLUJOS.md`](./REFERENCIA-FLUJOS.md)
> - Mecanismo paso a paso por flujo (citas, mocks) → [`./REFERENCIA-FLUJOS.md`](./REFERENCIA-FLUJOS.md)
> - Estado validado E2E backend → [`../backend-e2e/VALIDATION.md`](../../backend-e2e/VALIDATION.md)

---

## 0. Convenciones de este catálogo

**Repos** (rutas absolutas locales):

| Etiqueta repo | Ruta | Lenguaje |
|---------------|------|----------|
| `legacy-backend` | `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend` | PHP / Laravel modular |
| `bitbucket/application` | `/Users/miguelochoa/Desktop/CREDITOP/bitbucket/application` | **frontend legacy Vue** (`.vue`) |
| `frontend-monorepo` | `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo` | wizard **React/TSX** (0 archivos `.vue`) |

> ⚠️ **Los `.vue` citados aquí NO viven en `frontend-monorepo`.** Ese monorepo es React/TSX y no
> contiene ningún archivo `.vue` (`find -name '*.vue'` → 0 resultados). Todos los componentes Vue
> con `if id==N` (ListLenders, WelcomeUser, RequestsTable) pertenecen al **frontend legacy
> `bitbucket/application`**, bajo `resources/js/pages/customer/...`. El wizard React no contiene esa
> lógica quemada por ID.

**Colisiones de número a vigilar al auditar** (mismo ID, tablas distintas):

- `153`: **allied** 153 = *Energiteca* · **lender** 153 = *SmartPay* (`rt=1`, `country_id=60`). No son lo mismo.
- `24`: **allied** 24 = *Creditop* (está dentro de `corbeta_allieds`) · **lender** 24 = *Credifamilia* (`rt=4`).
- `160`: es el `smartpay_lender_id` de **producción** (`config/lenders.php:24`, `APP_ENV==='production' ? 160 : 153`); en dev/local el canal SmartPay son los lenders **152** (`rt=2`) y **153** (`rt=1`). El código no compara contra el literal 160 sino contra `config('lenders.smartpay_lender_id')` vía `Lender::isSmartpayChannel()` (`Lender.php:65-67`) (ver §2).

**Basenames duplicados** (mismo nombre de clase en módulos distintos — siempre citar ruta completa):

| Clase | Ruta A | Ruta B |
|-------|--------|--------|
| `LenderSpecialGrantingService` | `Modules/Loans/App/Services/…` (buckets de score quemados) | `Modules/Onboarding/App/Services/lenders/…` (usa tabla `creditop_x_quota_restrictions`, **sin** buckets) |
| `NotificationService` | `Modules/Loans/App/Services/…` (mailer smartpay vía `isSmartpayChannel()`) | `Modules/System/App/Services/…` (`country_id==60`) |
| `UserRequestService` | `Modules/Loans/App/Services/…` | `Modules/Onboarding/App/Services/…` (`country_id==60`) |

---

## 1. `response_type` (el eje del cierre) — dónde está quemado

La **taxonomía** `response_type` (0=UTM · 1=Integración/redirect externo · 2=Creditop X in-platform ·
3=Cupo Rotativo · 4=Credifamilia async, sin fila en `response_types`) es dueño de
[`./CREDITOP.md`](../CREDITOP.md). Aquí solo el **inventario de dónde se compara contra literales** en
vez de leer la columna por una abstracción central.

| Valor | Comparado contra literal en | Repo |
|-------|------------------------------|------|
| `== 2` (Creditop X) | `CreditopXFlowService.php:30`, `DebtSummaryService.php:51`, `RekognitionController.php:48` | legacy-backend |
| `== 3` (cupo rotativo) | **12 archivos** sin constante central: `ConsentService`, `PromissoryNoteService`, `GuaranteeService`, `PaymentDateService`, `DecevalPromissoryNoteService`… | legacy-backend |
| `== 4` (Credifamilia async) | radica al pintar marketplace; único lender con `rt=4` en BD = **Credifamilia (lender 24)** | legacy-backend |

> El `response_type` y `have_ctopx` son los **buenos ejemplos** de configuración por columna; el
> problema es que el resto de la lógica por comercio/lender NO sigue ese patrón (ver §6).

---

## 2. `lender_id` (lenders con código especial)

| ID | Lender (BD) | Qué hardcodea | Archivo:línea | Repo |
|----|-------------|---------------|---------------|------|
| **160** | `smartpay_lender_id` de **producción** (no es fila local) | Es el id que resuelve `config('lenders.smartpay_lender_id')` **solo en prod** (`config/lenders.php:24`). El canal SmartPay (mailer 'smartpay', voucher propio, inyección manual en lista, skip de encuesta) se decide por `Lender::isSmartpayChannel()` (`Lender.php:65-67`), **no** por el literal 160. **Ver nota crítica abajo.** | consumidores: `Modules/Loans/App/Services/NotificationService.php:55,148`; `Modules/Loans/App/Services/VoucherService.php:51,108` (todos vía `isSmartpayChannel()`); `Modules/Onboarding/App/Services/lenders/LenderRetrievalService.php:256-269,679`; skip encuesta `SatisfactionSurveyCheck.php:38` | legacy-backend |
| 152 | smartpay (`rt=2`, `country 1`) | el SmartPay **real** in-platform en BD; cierra vía `CreditopXClose` estándar (NO IMEI) | (lookup por `rt=2`, ver §1) | legacy-backend |
| 153 | SmartPay (`rt=1`, `country 60`) | `smartpay_lender_id` en **dev/local** (`config/lenders.php:24`, rama no-prod); ojo colisión con allied 153 | — | legacy-backend |
| 24 | Credifamilia | radica/polling (`rt=4`); único con PDF de T&C (`ENABLED_LENDERS_FOR_LEGAL=[24]`); voucher/payload propio | `Credifamilia.php:178`; `LegalService.php:31`; `VoucherService.php:15` | legacy-backend |
| 68 / 100 | Bancolombia BNPL / Consumo | swap de producto `BC_PAGA_DESP` ↔ `BC_CONSUMO`; comparado en **8+ lugares** | `BancolombiaBnplController.php:112` (`lender_id==100 → 68`); `PurchaseCodeService.php:158`; `BancolombiaService.php:94` (`=== 68`) | legacy-backend |
| 23,141,142 | Welli (full / cero / subvencionada) | grupo memoizado (1 sola consulta API) — constante `WELLI_LENDER_IDS` | `WelliService.php:26`; `PreApprovedLenderService.php:229` | legacy-backend |
| 84 | Magnocell | doc CE venezolanos → `LenderUsersCategory::find(22)` quemada | `LenderUserCategoryService.php:17`; `LenderValidationService.php:341` | legacy-backend |
| 5 | Banco de Bogotá | fuerza "0% probabilidad" si fallan reglas | `LenderValidationService.php:385` | legacy-backend |
| 5,135,136,137 | BdB + UMA (Occidente / Santander / Finanzauto) | reglas duras → 0% (comentario del código lo confirma) | `LenderValidationService.php:385` | legacy-backend |
| 39 | Meddipay | oculto por horario, solo en Pullman | `PreApprovedLenderService.php:453,457` | legacy-backend |
| 52 | Wompi | `lender_id` quemado en lookups; **`dd()` vivo** (ver §5) | `Wompi.php:78,264,309` | legacy-backend |
| 9 | Sistecrédito | rama de validación propia (defaulter / NoPOS) | `PreApprovedLenderService.php:79` | legacy-backend |
| 12 | **Prami** | acción de lender con rama propia; su payload usa valores **dinámicos** del usuario, **no** PII quemada (ver nota §6). En BD es **`rt=1`** (redirect externo) | `app/Actions/Lenders/Prami.php` | legacy-backend |

> ### ⚠️ Nota crítica — lender `160` (SmartPay): id de producción vía config
> El `160` es el `smartpay_lender_id` de **producción**: `config/lenders.php:24` define
> `'smartpay_lender_id' => env('APP_ENV') === 'production' ? 160 : 153`. En dev/local ese id resuelve
> a **153**. El código **no** compara contra el literal `160`, sino que consume ese config por un
> **punto único**, `App\Models\Lender::isSmartpayChannel()` (`Lender.php:65-67`), usado en
> `NotificationService.php:55,148` y `VoucherService.php:51,109`. En BD local el canal SmartPay son:
> - **lender 152** = `smartpay`, `response_type=2`, `country_id=1` (el SmartPay in-platform real)
> - **lender 153** = `SmartPay`, `response_type=1`, `country_id=60` (variante redirect RD)
>
> Por eso el literal `160` **no existe como fila** en la BD local, pero la lógica SmartPay **sí se
> activa** en local (resuelve a 153 vía config). Cualquier prueba E2E del mailer/voucher SmartPay debe
> apuntar al lender que `config('lenders.smartpay_lender_id')` devuelva en su entorno, no al `160`
> literal. (`SELECT id,name,response_type,country_id FROM lenders WHERE id IN (152,153,160)` → 152 y
> 153 existen; 160 no.)

---

## 3. `allied_id` y `branch` (comercios con código especial)

| ID | Comercio (BD) | Qué hardcodea | Archivo:línea | Repo |
|----|----------------|---------------|---------------|------|
| 94 | Amoblando Pullman | `hadPreApproveLender=false` (ignora preaprobado), `Experian::aciertaQuanto`, `userViability`; monto ≤600k no viable; Meddipay oculto por horario | `OnboardingService.php:491,572,668,694-695`; `DatacreditoQueryByAlliedController.php:77,81`; `PreApprovedLenderService.php:453,457` | legacy-backend |
| 189 | DENTIX (alias "DFS") | `$isDFS = allied_id == 189` → `aciertaQuanto` (sin `userViability`) | `OnboardingService.php:669` | legacy-backend |
| 26 | Sonría | con **lender 8** → `fee_numbers` / `max_amount=30000000` / `rate=2.31` quemados | `LenderRetrievalService.php:528-531`; subtítulo `list/ListLenders.vue:107`; `v-if` `v2/ListLenders.vue:662,1092` | legacy-backend + bitbucket/application |
| 153 | Energiteca | elimina lender (Sistecrédito) si no `Approved` | `PreApprovedLenderService.php:143` | legacy-backend |
| 24, 209, 210, 211 | Corbeta (Creditop / Alkosto / K-TRONIX / Alkomprar) | `Setting corbeta_allieds = [24,209,210,211]`; inyecta laboral dummy 1.5M; `error_code='ONB006'` → onboarding estilo Bancolombia | `OnboardingService.php:637,643` (`storeLaboralInformation(...,1500000,'Empleado',3)`); `OnboardingController.php:1159` (`$corbetaOnboarding?'ONB006':'ONB002'`), `:1264` (`?'ONB006':null`) | legacy-backend |
| 158 | Motai | modo renting (`allied_mode=2`, `MOTAI_RENTING_ALLIED_MODE_ID=2`); cierre IMEI (device lock); filtra lenders a `[158]`; T&C 16+17 | `OnboardingController.php:36,1149,1472`; `RegisterCellPhoneService.php:421,427`; `UserService.php:339,345` | legacy-backend |
| 24 | Creditop (interno) | excluido de dashboards/límites | `DashboardController.php:199`; `ComunicationController.php:55` | legacy-backend |
| 225 | UMA | flujo especial; oculta columnas de deudor en UI | `UserRequestManagementService.php:24` (`UMA_ALLIED_ID=225`); `RequestsTable.vue:101` | legacy-backend + bitbucket/application |
| 218,219,221,222 | Autogestión | bloquea botón salvo prob. alta; onboarding propio | `v2/ListLenders.vue:662,1092` (`[218,219,221,222]`), `:2780` (`[218,219,222,221]`); `WelcomeUser.vue:8` | bitbucket/application |
| 277 | (`SKIP_EMPLOYMENT_CHECK_ALLIED`) | omite verificación laboral | `UserRequestManagementService.php:28` | legacy-backend |
| branch **1083** | — | bloquea el botón "continuar" | `LenderRetrievalService.php:320` | legacy-backend |

**Listas de allieds repetidas** (mismo array en varios sitios → divergencia garantizada):

- Corbeta `[209,210,211]`: `LenderListingService.php:202`, `User.php:314`, `CodeGenerationService.php:23-25` (Alkosto / K-TRONIX / Alkomprar), además del `Setting corbeta_allieds`.

> El **forking de entrada por comercio** (PEP, Pullman, Corbeta, Motai, SmartPay/RD, Ecommerce) y su
> mecanismo paso a paso son dueño de [`./REFERENCIA-FLUJOS.md`](./REFERENCIA-FLUJOS.md); el
> encadenamiento FE↔BE de cada uno, de [`./REFERENCIA-FLUJOS.md`](./REFERENCIA-FLUJOS.md).

---

## 4. `status_id`, `country_id`, `field_id` y otros magic numbers

**Estados.** La tabla de estados de solicitud es `user_request_statuses` (plural); la FK es
`user_requests.user_request_status_id`. La estructura y ciclo de vida son dueño de
[`./MODELO-DATOS.md`](./MODELO-DATOS.md) y [`./CREDITOP.md`](../CREDITOP.md). Aquí solo el literal:

- **`return 11`** (Autorizada) cableado en `LoanAuthorizationService.php:337` (`resolveAuthorizationStatusId()`), y `status_id==11` comparado en **≥13 archivos** (middleware, controllers, services, jobs, callbacks) sin constante central.
- Otros estados relevantes: 9=Formulario perfil, 10=Pendiente autorización, 11=Autorizada.
- ⚠️ `40`/`41` (CREDIT_IN_PROCESS / CREDIT_APPROVED) son `lender_transaction_statuses`, **NO** `user_request_statuses`.

**`country_id == 60` (República Dominicana):**

- `Modules/System/App/Services/NotificationService.php:114,216,250`, `PaymentCalculationService.php:196`, `Modules/Onboarding/App/Services/UserRequestService.php:598`, `TwilioController.php:187`.

**`field_id` (persistencia laboral, `form_id=1`)** — magic numbers en todo el flujo de onboarding:

- `29` situación laboral (`OnboardingService.php:817`), `87` ingreso (`:862`), `160` central de riesgo — placeholder fijo `"no"` (`:907`), `161` continuidad (`:953`); `30` estrato (`:1022`); `44` dirección (`:462`).

**Consent / pagaré / firma:**

- `creditop_x_consent_type_id`: `1` (primer uso) / `2` (segunda utilización, revolving — comentario `ConsentService.php:277`) / `3` (`device_lock_agreement` = contrato IMEI; tabla `creditop_x_consent_types`; existe `DeviceLockAgreementService` + `ValidateImeiRequest`).
- `city_id == 1123` → siempre renderiza "BOGOTA" en pagaré/consent/garantía (`ConsentService.php:112,169`).
- `promissoryType`: `deceval` → SOAP Deceval; `traditional`/`ownership` → PDF local (`PromissoryNoteSigningFactory.php:16`).
- `signingProvider == netco` → firma batch Netco (Credifamilia).
- `terms_and_conditions_id`: `13` (default, `RegisterCellPhoneService.php:442`), `16`+`17` (Motai, `RegisterCellPhoneService.php:421,427` y `UserService.php:339,345`), `18` (Credifamilia, `OnboardingController.php:120,743`).

---

## 5. Montos y umbrales quemados

| Constante | Valor | Archivo:línea | Repo |
|-----------|-------|---------------|------|
| Welli mínimo (`MINIMUM_AMOUNT`) | **180.000** | `WelliService.php:36` (grupo `[23,141,142]` está en `WelliService.php:26`) | legacy-backend |
| BNPL Bancolombia | **100.000** | `PreApprovedLenderService.php:744` | legacy-backend |
| Consumo Bancolombia | **1.000.000** | `PreApprovedLenderService.php:795` | legacy-backend |
| Pullman no viable | ≤ **600.000** | `DatacreditoQueryByAlliedController.php:81` | legacy-backend |
| Capacidad de endeudamiento | ≤ **40%** (`0.4`) | `SpecialConditionsController.php:260` | legacy-backend |
| Laboral dummy (PEP) | **1.500.000** | `OnboardingService.php:254` (`storeLaboralInformation(...,1500000,'Empleado',3)`) | legacy-backend |
| Laboral dummy (Corbeta/Pash) | **1.500.000** | `OnboardingService.php:643` | legacy-backend |
| IVA | **19/100** y `DEFAULT_IVA_RATE=0.19` | `PaymentCalculationService.php:83`; `CredifamiliaPayloadBuilder.php:15` | legacy-backend |
| Buckets de score `LenderSpecialGrantingService` | `>770→15M`, `710-770→8M`, `650-709→5M`, `<650→3M` (+ `score<1/null → 1.2M`) | **`Modules/Loans/App/Services/LenderSpecialGrantingService.php:186-201`** | legacy-backend |

> ⚠️ El ITBIS dominicano (18%) **no** se aplica automáticamente por país: el `19/100` está cableado y
> no condicionado a `country_id`.
>
> ⚠️ El otro `LenderSpecialGrantingService` (`Modules/Onboarding/App/Services/lenders/…`) tiene el
> **mismo basename** pero **no** contiene estos buckets: usa la tabla `creditop_x_quota_restrictions`
> (`CreditopXQuotaRestriction`). Citar siempre la ruta de `Modules/Loans` para los montos quemados.

---

## 6. PII y datos personales cableados

| Dato | Dónde | Archivo:línea | Repo |
|------|-------|---------------|------|
| Email de notificación de excepción `oscar@creditop.com` | path Corbeta/Pash de `userViability` | `OnboardingService.php:650` | legacy-backend |
| Teléfonos personales de empleados (con nombres) | a quién llegan alertas en prod | `ManualValidationService.php:18-22,167`; `CreditopXNotificationService.php:29` (`[3152623357]`); `TwilioController.php:830` (whatsapp `+573208088778`) | legacy-backend |
| Cédulas de prueba | `1998228194` / `1998228111` (`switch` bajo guard `if (!app()->isProduction())`) en `BancolombiaBnpl.php:720,722,728`; `800150280` (ternario `environment()==='production' ? real : '800150280'`) `:44` | legacy-backend |

> Los datos de prueba de `BancolombiaBnpl` están **guardados por entorno** (`!isProduction()` /
> `environment() !== 'production'`): NO se ejecutan en producción. Son **deuda de
> mantenibilidad / riesgo de fuga**, no un fallo en prod (consistente con el anti-patrón #3 de §8).
>
> ⚠️ **Prami (lender 12) NO hardcodea PII de prueba.** `app/Actions/Lenders/Prami.php` arma su
> payload con valores **dinámicos** del usuario: `sanitizeDigits($user->document_number)` (`:76,:167`),
> `max(0,(int) $income_avg)` (`:439`) y `max(0,(int)($datacredito->score ?? 0))` (`:448`). No existen
> literales de documento/ingreso/score cableados (verificado por `git log -S` = 0 ocurrencias).

---

## 7. ⚠️ Priorización de remediación

Ordenado por impacto × probabilidad. P0 = rompe prod hoy; P1 = riesgo alto / fragilidad sistémica;
P2 = deuda contenida por entorno o config.

| # | Hardcode | Severidad | Por qué importa | Acción sugerida |
|---|----------|-----------|-----------------|-----------------|
| 1 | **`dd($exception)` VIVO** en `Wompi.php:78` (`getMerchant()`) | **P0** | corta cualquier request que toque ese path en prod | eliminar el `dd()`, manejar la excepción vía `Integration::handleException` |
| 2 | **`status_id==11` en ≥13 archivos** + `return 11` (`LoanAuthorizationService.php:337`) | **P1** | cambiar la convención de estados rompe todo a la vez | extraer a enum/constante central, referenciar `user_request_statuses` |
| 3 | **`smartpay_lender_id` por entorno** (160 prod / 153 dev, `config/lenders.php:24`, §2) | **P2** | id que varía por `APP_ENV`; tests E2E SmartPay engañosos si asumen `160` | ya centralizado en `Lender::isSmartpayChannel()`; en pruebas resolver el id vía config, no el literal |
| 4 | **Listas allied/lender duplicadas**: corbeta `[209,210,211]` (3+ sitios + Setting), Welli `[23,141,142]`, BdB+UMA `[5,135,136,137]` | **P1** | agregar/quitar un comercio exige editar varios archivos → divergencia | centralizar en `Setting`/columna; el `corbeta_allieds` ya es el patrón a seguir |
| 5 | **IVA `19/100`** sin condicionar a país (§5) | **P1** | cambia por decreto; RD (ITBIS 18%) queda mal calculado | tasa por `country_id` en config/BD |
| 6 | **Buckets de score quemados** `LenderSpecialGrantingService` (Loans) `:186-201` | **P2** | reglas de otorgamiento en código; el módulo Onboarding ya usa tabla | migrar a `creditop_x_quota_restrictions` como el gemelo |
| 7 | **PII de empleados** (`oscar@creditop.com`, teléfonos) | **P2** | privacidad + operacional; alertas atadas a personas | mover a `Setting`/grupo de notificación |
| 8 | **Cédulas de prueba BancolombiaBnpl** (§6) | **P2** | guardadas por entorno; deuda de mantenibilidad, riesgo de fuga | extraer a fixtures/seeds fuera del código de la integración |
| 9 | **T&C ids `13/16/17/18`** quemados en 6+ lugares | **P2** | nueva versión = editar varios archivos | resolver por columna/relación en BD |
| 10 | **`if id==N` en `.vue`** (`v2/ListLenders.vue`: decenas de `v-if` por allied/lender) | **P2** | acoplamiento por ID en el frontend legacy `bitbucket/application` | flag/columna desde el backend; no portar al wizard React |

---

## 8. Patrón de fondo (la conclusión)

La lógica quemada se concentra en **3 anti-patrones**:

1. **Acoplamiento por ID literal**: `if (lender_id == N)` / `if (allied_id == N)` esparcidos, en vez de un flag/columna en BD. El peor caso: `bitbucket/application/.../v2/ListLenders.vue` (decenas de `v-if` por id).
2. **Listas duplicadas**: el mismo array de allieds/lenders repetido en backend (3-4 sitios) y frontend (constantes propias) → divergencia garantizada.
3. **Sandbox/mock dentro del código**: payloads/documentos fijos bajo `!isProduction()` mezclados con la lógica real (Bancolombia) → riesgo de fuga y ruido al leer.

**Lo que SÍ está bien abstraído** (modelo a seguir): `Integration` (clase base de lenders), el
switch por `response_type`, `promissoryType`/`signingProvider` (factories), `AlliedModeLenderFilterService`
(filtro por config) y el `Setting corbeta_allieds`. El camino de mejora es **mover los `if id==N` a
columnas/config**, como ya se hizo con `have_ctopx` y `response_type`.

---

> **Trazabilidad**: cada fila cita `archivo:línea` y repo, verificados por re-grep del código y
> consultas a la BD local (`docker exec legacy-backend-mysql-1 mysql -ucreditop -ppassword creditop
> -e "SQL"`). Para el detalle por flujo ver [`./REFERENCIA-FLUJOS.md`](./REFERENCIA-FLUJOS.md) y
> [`./REFERENCIA-FLUJOS.md`](./REFERENCIA-FLUJOS.md); para por qué falla el random,
> [`./CASOS-ESPECIALES.md`](./CASOS-ESPECIALES.md).
