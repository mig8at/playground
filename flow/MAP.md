# MAP.md — Mapa del flujo de solicitud CreditOp (código real)

> **Propósito.** Trazar de punta a punta *cómo se ofrece una opción de crédito a un usuario*: desde
> que se crea un lender / comercio / sucursal, cómo se asocian, cómo arranca la solicitud, cómo se
> llaman los burós y cómo la consolidación calcula qué se ofrece — vía **perfilador (CreditopX rt=2)**
> o vía **servicio de pre-aprobados (agregador rt=1)**. Cada paso apunta a **los archivos exactos**
> (con línea) para poder abrirlos y entender la lógica.
>
> **Verificación.** Este mapa se construyó con un workflow de 6 investigadores + 6 verificadores
> adversariales sobre el código real (`wa6yhb4yk`, 12 agentes, 0 errores). 5/6 secciones quedaron
> `holds=true` con confianza alta; la única corrección material (S4: *legacy sí tiene cliente Experian*)
> ya está incorporada. Las líneas pueden tener deriva de ±1–10 (refactors); sirven para navegar, no como
> contrato. Ante duda, `grep` el nombre del método.

---

## 0 · Leyenda y convenciones

### Repos (rutas raíz)
| Prefijo | Qué es | Ruta absoluta |
|---|---|---|
| **application** | Monolito Laravel/Inertia. **VIVO / default** (el que corre en prod hoy). | `/Users/miguelochoa/Desktop/CREDITOP/bitbucket/application` |
| **legacy** | Reescritura Laravel Modules (strangler). Cableada en *parallel-run*, aún no es el default salvo piezas ya migradas (OTP, cupo rt=2 V2). | `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend` |
| **pre-approvals** | MS Go hexagonal. Resuelve pre-aprobación **rt=1** para el wizard nuevo. | `/Users/miguelochoa/Desktop/CREDITOP/github/pre-approvals-service` |
| **frontend** | Monorepo del wizard (React Router / Vue). | `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo` |
| **microservices** | MS Go greenfield (kyc-gateway, customer-service, …). | `/Users/miguelochoa/Desktop/CREDITOP/github/microservices` |

Las referencias se escriben `[repo] ruta/relativa.php:línea — rol`.

### `response_type` (rt) — el eje que decide TODO el flujo de consolidación
| rt | Nombre | Quién decide el crédito | ¿Inyectable local? |
|---|---|---|---|
| **0** | url_utm / redirect | Nadie (redirige a la web del lender) | n/a |
| **1** | Integración / **agregador** | **API externa** del lender (Welli, Bancolombia, Meddipay…) | ❌ No (decisión fuera) |
| **2** | **CreditopX** in-platform | **CreditOp** (motor de categorías local) | ✅ Sí |
| **3** | Rotativo (revolving) | CreditOp (cupo rotativo local) | ✅ Sí |

> ⚠️ `product_type` **no existe** como columna. El "tipo de producto" se modela con `response_type` + `path_id` (relación `Path`).

### Estados de `user_requests`
`1` creada/inicial · `3` selección de entidad · `9` formulario perfil · `11` aprobado/desembolso · `25/26` otros.

### El hecho estructural: **strangler / parallel-run**
Mucha lógica existe **dos veces** (application VIVO ↔ legacy reescrito). Salvo indicación, **application es el que corre**. Piezas ya migradas a legacy: envío de OTP, el endpoint de cupo rt=2 (`/available-quota`), y la KYC V2 de Credifamilia. El **riesgo transversal** es la *deriva*: dos copias que pueden divergir (lo señalamos en cada etapa).

---

## 1 · El flujo de una mirada

```
ADMIN (una sola vez, panel)                        USUARIO (cada solicitud)
─────────────────────────────                      ─────────────────────────────────────────
S1  crear Lender ─┐                                S3  link sucursal (hash) → registrar celular
    crear Allied ─┼─ existen, sin relación             → OTP → CREA user_request (estado 1→9)
    crear Branch ─┘                                    → form personal/laboral
                                                        │
S2  habilitar lender EN la sucursal ─────────┐         ▼
    · escribe lenders_by_allieds (calculadora)│    S4  buró/KYC: Experian (score) + TusDatos/
    · escribe lenders_by_allied_branches      │        Agildata/Mareigua/ADO (identidad/ingreso)
    · COPIA group_rules + datacrédito por     │        → guarda en risk_central_user_data (cifrado)
      sucursal (addNewRule / addNewLenderRule)│        + EAV (87 ingreso, 29 ocup, 160 flag)
                                              │         │
                                              └────────►▼
                                                   S5/S6  CONSOLIDACIÓN (getLenders) →
                                                          rt=2 → perfilador/categoría → CUPO local
                                                          rt=1 → pre-approvals-service → API externa
                                                          → listado ofrecido al usuario
```

**Orden real de la consolidación rt=2** (clave, ver S5): base sucursal + gate `no_more` → filtros duros
(status/country) → **group_rules + datacrédito rt=2 (AND, EXCLUYE)** → perfilador datacrédito rt≠2 (solo
reordena) → ML/matrices → condiciones especiales → **pre-aprobados rt=1** → orden → **CATEGORÍA rt=2 +
tramo por monto (AL FINAL, EXCLUYE + fija enganche/cupo)**.

---

## 2 · Índice de etapas
- [S1 · Alta de entidades: lender, comercio, sucursal](#s1--alta-de-entidades)
- [S2 · Asociación lender↔comercio↔sucursal + copia de reglas](#s2--asociación--copia-de-reglas)
- [S3 · Inicio del flujo de solicitud (UserRequest) + wizard](#s3--inicio-del-flujo)
- [S4 · Llamado a burós/KYC + qué datos se guardan](#s4--burós-y-kyc)
- [S5 · Consolidación rt=2 (CreditopX): cascade + perfilador + cupo](#s5--consolidación-rt2-creditopx)
- [S6 · Consolidación rt=1 (agregador): pre-aprobados](#s6--consolidación-rt1-agregador)
- [Apéndices: frontera rt2/rt1 · campos fantasma · índice maestro de archivos](#apéndice-a--la-frontera-rt2-vs-rt1)

---

## S1 · Alta de entidades

**Qué pasa.** En el panel admin de `application` (Inertia) cada entidad se crea con su controller que
hace `Model::create` dentro de una transacción. **El alta NO cablea la relación lender↔sucursal**: eso
ocurre después, en el *update* de la sucursal (S2). El gemelo legacy es el módulo `Partner`
(Controller→Service→Repository, API JSON), reconstruido 1:1 pero **no es el admin vivo**.

### Secuencia con archivos
| # | Paso | Archivo |
|---|---|---|
| 1 | **Lender · form** | `[application] app/Http/Controllers/Admin/LenderController.php:73` (create) |
| 2 | **Lender · valida** | `[application] app/Http/Requests/Admin/Lender/StoreRequest.php:23` (rules) |
| 3 | **Lender · crea** | `[application] LenderController.php:196` store → `:219` `Lender::create` → `:235` `CreditLineByLender::create` (siempre, credit_line_id=1) → `:248` `CreditopXLenderConfiguration` (solo si rt==2) |
| 4 | **Lender · modelo** | `[application] app/Models/Lender.php` (tabla `lenders`; **HARDCODE** `getResponseTypeAttribute` fuerza lender **id 24 = Credifamilia** a rt=1) · migración `database/migrations/2023_04_20_202610_create_lenders_table.php` |
| 5 | **Comercio · form** | `[application] app/Http/Controllers/Admin/AlliedController.php:79` (create; países 47=CO / 60=RD) |
| 6 | **Comercio · valida** | `[application] app/Http/Requests/Admin/Allied/StoreRequest.php:23` (country ∈ [47,60]) |
| 7 | **Comercio · crea** | `[application] AlliedController.php:101` store → `:112` `Allied::create` (`allied_caterogy_id=1` y `new_screens=true` **quemados**) |
| 8 | **Comercio · modelo** | `[application] app/Models/Allied.php` (tabla `allieds`; flags que gobiernan el flujo: `have_ctopx`, `show_profiling`, `flow_type`, `new_screens`, `self_managed`, `initial_fee`, `production_date`) |
| 9 | **Sucursal · form** | `[application] app/Http/Controllers/Admin/AlliedAlliedBranchController.php:165` (create) |
| 10 | **Sucursal · valida** | `[application] app/Http/Requests/Admin/AlliedBranch/StoreRequest.php:23` |
| 11 | **Sucursal · crea** | `[application] AlliedAlliedBranchController.php:174` store → genera hash + QR (S3) → `:203` `AlliedBranch::create` |
| 12 | **Sucursal · modelo** | `[application] app/Models/AlliedBranch.php` (tabla `allied_branches`; `datacredito_trigger` JSON; `hasCreditopX()`) · migración `2023_07_17_161110` |

### Gemelo legacy (módulo Partner)
`[legacy] Modules/Partner/App/Http/Controllers/LenderController.php:154` → `Services/LenderManagementService.php:30 createLender` → `Repositories/LenderRepository.php:24`. Comercio: `AlliedController.php:60` → `AlliedManagementService.php:763 storeAllied`. Sucursal: `AlliedManagementService.php:280 storeAlliedBranch`.

### Tablas
`lenders` · `allieds` · `allied_branches` · `credit_line_by_lenders` (nace con el lender) · `creditop_x_lender_configurations` (solo rt=2) · `allied_status_logs`.

### Ojo (gotchas)
- **`product_type` es fantasma**: no existe columna; usar `response_type` + `path_id`.
- **HARDCODE Credifamilia (id 24)**: `Lender.php` accessor fuerza rt=1 en todo el flujo, ignorando la BD.
- `response_type` **default = 1** (migración + legacy `createLender`): un lender sin rt explícito nace como *integración externa*.
- **Valores quemados** en alta de comercio: `allied_caterogy_id=1`, `new_screens=true`. La categoría real no se elige al crear.
- **Typo consolidado en BD**: la columna es `allied_caterogy_id` (no `category`) — así en migración, modelo y controllers.
- Ojo con lo que el verificador corrigió: `preapproved_registration`, `star_allied`, `ecommerce`, `is_fallback_lender` **existen como columnas** (hay migración) pero **no** están en `$casts`/`$fillable` de los modelos → no son mass-assignable ni se setean en el alta.
- `destroy` de las 3 entidades es **soft** (status=0). `AlliedController@destroy` está **vacío** (no-op).

---

## S2 · Asociación + copia de reglas

**Qué pasa.** Un lender se configura en **dos niveles** con controllers distintos, y al habilitarlo en
una sucursal se **COPIAN** las reglas por sucursal (esto explica las ~37k filas de reglas duplicadas):

1. **Nivel COMERCIO** → `lenders_by_allieds` = **toda "la calculadora"** (min/max monto, cuota inicial, plazos, IVA, comisión, seguros, banco).
2. **Nivel SUCURSAL** → `lenders_by_allied_branches` = override mínimo (`url_utm`/`sort`; hereda del comercio por COALESCE).
3. **Copia de reglas** (disparada en el *update* de la sucursal, y también al crear credencial ecommerce): por cada lender se clonan `group_rules`+`lender_rules` (duras) y `lender_datacredito_rules` (buró) con `allied_branch_id` de esa sucursal.

### Secuencia con archivos
| # | Paso | Archivo |
|---|---|---|
| 1 | **Calculadora por comercio** | `[application] app/Http/Controllers/Admin/AlliedLenderController.php:137` store → `LendersByAllied::updateOrCreate` (url_utm, seguros/costos %, `iva=19` forzado si rt==2, plazos vía `*_calculation_id`, `bank_id`, `comission_percentage`, `initial_fee_percentage`…). `:222` update escribe `max_amount:247`. rt==2 → `:90` crea `LenderGuaranteeCriteria` + permisos perfiles 6/4 |
| 2 | **Override por sucursal** | `[application] AlliedAlliedBranchController.php:102` update (**el disparador**) → `:123` DELETE previo de `lenders_by_allied_branches` → `:130` `create` (solo `lender_id/allied_branch_id/url_utm/sort`) |
| 3 | **Copia reglas DURAS** | `AlliedAlliedBranchController.php:143` → `[application] app/Http/Controllers/Admin/LenderRulesController.php:330 addNewLenderRule` → `:344` `GroupRule::create('AB{branch_id}')` → `:350` clona `lender_rules` plantilla (`group_rule_id=NULL`) |
| 4 | **Copia reglas DATACRÉDITO** | `AlliedAlliedBranchController.php:142` → `[application] app/Http/Controllers/Admin/LenderDatacreditoRulesController.php:75 addNewRule` → `:80` guard país≠47 → `:102` **fallback a lender 5 (BdB)** si no hay plantilla → `:107` `LenderDatacreditoRule::create` (score, current_dues, time_finance_sector, negative_historical_last_12_months, consulted_last_6_months, probability_levels) |
| 5 | **2º disparador: sucursal-ECOMMERCE** | `[application] app/Http/Controllers/Admin/AlliedEcommerceCredentialsController.php:53` store → `:96` lenders desde `LenderAlliedCredential` → `:98` mismo `addNewRule`+`addNewLenderRule`+`LendersByAlliedBranch::create` |
| 6 | **Gemelo legacy** | `[legacy] Modules/Partner/App/Services/AlliedManagementService.php:237` (delete/recreate) `:257` (addNewRule/addNewLenderRule) — cableado, pero el admin vivo es application |

### Tablas
`lenders_by_allieds` (calculadora × comercio) · `lenders_by_allied_branches` (override × sucursal) · `group_rules` (cabecera "AB{id}") · `lender_rules` (plantilla=`group_rule_id NULL` → clones) · `lender_datacredito_rules` (plantilla=`allied_branch_id NULL` → clones) · `datacredito_frequencies` (gate **separado**, NO se copia).

### Ojo (gotchas)
- **`min_amount` es fantasma**: está en el fillable de `LendersByAllied` pero **ningún controller lo escribe** (solo se escribe `max_amount`). El mínimo de monto no se persiste por esta ruta.
- La sucursal se **reconstruye entera** en cada save (DELETE + recreate). Guardar con lista incompleta **borra** asociaciones. **Pero las reglas ya copiadas NO se borran** → quedan **huérfanas** si el lender se deselecciona.
- La copia es **snapshot único e idempotente**: si cambia la plantilla después, las filas por sucursal **no** se re-sincronizan.
- **Fallback silencioso a lender 5 (BdB)**: un lender sin plantilla de datacrédito hereda los umbrales de BdB sin marca visible.
- Errores de copia se **tragan** (try propio) y solo mandan email a `santiago@creditop.com` → una sucursal puede quedar **habilitada sin reglas**.
- `datacredito_frequencies` ≠ `lender_datacredito_rules`: la primera es el *gate* de si aplica el motor legacy datacrédito; la copia por sucursal no la toca.

---

## S3 · Inicio del flujo

**Qué pasa.** El usuario entra por un **link de sucursal con `hash`** → se resuelve la `AlliedBranch`
(fija `allied_branch_id` + `allied_id`). El **monto se captura ANTES** de crear la solicitud (simulador
o paso del wizard) y viaja por sesión/body. **La `user_request` NO nace en el simulador**: se crea tarde,
al validar OTP o guardar info personal (`createUserRequest`, estado 1→9). El disparo del listado es
`GET entidades-v2/{userRequest}` (application) / `GET lenders-v2/{id}` (legacy) — **JSON síncrono**, no SSE.

### Secuencia con archivos
| # | Paso | Archivo |
|---|---|---|
| 1 | **Entrada por hash** | `[application] app/Http/Controllers/Customer/RegisterCellPhoneController.php:77` index → `:138-146` `AlliedBranch::where('hash')` + `session('allied'/'allied_branch')`. Ecommerce: `:232-241` (amount en query base64) |
| 2 | **Resuelve sucursal** | `[legacy] Modules/Onboarding/App/Services/UserRequestService.php:73` `findByHash` → `:124-125` copia `allied_id/allied_branch_id` a la UR |
| 3 | **Captura de monto** | `[application] app/Http/Controllers/Customer/SimulatorController.php:110-188` (config min/max) · `:190-211` `startV2` guarda `session('amount')` y **redirige, NO crea UR** · wizard: `[frontend] apps/loan-request-wizard/app/routes/dynamic/request-amount.tsx:200` |
| 4 | **Registro celular + OTP** | `[application] RegisterCellPhoneController.php:179-222` store → **delega a legacy** `Http POST /api/onboarding/phone/register` · `[legacy] Modules/Onboarding/App/Http/Controllers/RegisterCellPhoneController.php:32` |
| 5 | **CREA la user_request** | `[application] app/Http/Controllers/Customer/UserRequestController.php:58 createUserRequest` → `:89-108` `updateOrCreate` (lender_id=null, credit_line_id=1, amount de sesión, estado 1) → `:191` estado **9**. Callers: `ValidateOtpController.php:240`, `PersonalInfoController.php:265` (y 654/1084/1576) |
| 5b | **Gemelo legacy** | `[legacy] UserRequestService.php:71 createUserRequest` → `:111-138 handleRegularRequest` (estado 1) → `:241 updateUserRequestStatus` (estado 9); orquestador OTP `OnboardingController.php:1179` |
| 6 | **Form dinámico** | `[legacy] Modules/Onboarding/routes/api.php:44-46` (personal-info + config, laboral-info) · `[frontend] .../personal-info-config/infrastructure/personal-info-config.repository.ts:14` |
| 7 | **Disparo del listado** | `[application] app/Http/Controllers/Customer/ListLenderController.php:226 indexV2` → `getLenders` · `[legacy] Modules/Onboarding/App/Http/Controllers/LenderListingController.php:17` → `getLenders` (JSON) · `[frontend] .../lenders-marketplace/.../loan-options.repository.ts:25` (timeout 60s) |
| 8 | **Selección de lender** | `[application] UserRequestController.php:646 updateUserRequest` (estado 3) · `[legacy] UserRequestService.php:284-296` |

### Tablas
`user_requests` (user_id, allied_id, allied_branch_id, amount, original_amount, credit_line_id=1, user_request_status_id) · `user_request_statuses` · `user_request_records` (historial) · `allied_ecommerce_credentials` (bifurca canal) · `creditop_x_user_requests_records` (marca proceso si `hasCreditopX`).

### Endpoints (los que arrancan el flujo)
- `[application] GET /registrar-celular/{hash?}` · `POST /iniciar-solicitud-v2` · `GET /entidades-v2/{userRequest}`
- `[legacy] POST /api/onboarding/loan-application/otp-validate/{hash}` ← **crea la UR** · `GET .../lenders-v2/{id}` ← dispara el listado

### Ojo (gotchas)
- **El simulador NO crea la solicitud** (`startV2` solo guarda sesión + redirige). Nace al validar OTP / guardar info.
- **El monto tiene 3 orígenes** según canal: `session('amount')` (asesor), query base64 (ecommerce), body `amount` del otp-validate (wizard). En legacy el body tiene prioridad (`request->input('amount') ?? session ?? 0`).
- `lenders-v2` **no es SSE**: el "streaming" lo hace el loader del front resolviendo pre-aprobaciones lender-a-lender (`available-lenders.tsx:103-131`).
- **Número mágico 180000**: `LenderListingController.php:21` usa `query('amount', 180000)` como default — enmascara el monto real si el front no lo manda.
- La UR se **recicla**: `createUserRequest` reutiliza una previa en estados [1,3,9] del mismo user+sucursal en vez de crear otra.
- `session('allied_branch')` guarda el **objeto** `AlliedBranch` (no un array), leído como array por ArrayAccess.
- Valores quemados al crear: `credit_line_id=1` ("Libre inversión"), `lender_id=null`, `fee/rate=0`.

---

## S4 · Burós y KYC

**Qué pasa.** El **único buró que da SCORE** es **Experian/DataCrédito**. Se llama desde
`app/Actions/RiskCentrals/Experian.php` (OAuth2 + `POST /cs/credit-history/v1/hdcplus`, productos
Acierta=score / Quanto=ingreso / Acierta+Quanto). Se persiste **todo** en `risk_central_user_data`:
reporte crudo en `data` (**cifrado con APP_KEY**), `score`, y un `additional_info` mapeado; además espeja
a `user_summaries` y a **EAV** (`87` ingreso, `29` ocupación, `160` flag, `90` egresos). Los otros
proveedores (TusDatos, Agildata, Mareigua, ADO) son **KYC de identidad/ingreso, NO score**. Sobre esos
datos deciden **dos motores de reglas** con campos distintos (ver S5).

> **⚠️ Corrección verificada (era el error de la investigación).** **Los DOS backends tienen cliente
> Experian completo** (parallel-run): `[application] app/Actions/RiskCentrals/Experian.php` (default VIVO)
> **y** `[legacy] app/Actions/RiskCentrals/Experian.php` (OAuth2 + `POST /cs/credit-history/v1/hdcplus:519`,
> ProductId 64), este último cableado en el onboarding de legacy (`OnboardingService`, `CreditStudyService`,
> `MobileOnboardingService`, `OnboardingController`, `DatacreditoQueryByAlliedController`). La distinción
> correcta es **default (application) vs parallel-run (legacy)**, NO "solo application tiene cliente".

### Secuencia con archivos
| # | Paso | Archivo |
|---|---|---|
| 1 | **Gate de disparo por aliado** | `[application] app/Http/Controllers/Customer/DatacreditoQueryByAlliedController.php:20 userViability` (lee `alliedBranch.datacredito_trigger`; valida age/gender/ocupación/ingreso/flag) → `:210 validateDatacreditoQuery` (frecuencia vía `datacredito_frequencies`) → `:234-266` dispara |
| 2 | **Trigger desde datos personales** | `[application] app/Http/Controllers/Customer/PersonalInfoController.php:158` (`users.age` desde `date_of_birth`) → `:434 userViability` → `:766 Experian::aciertaQuanto` |
| 3 | **Cliente HTTP del buró** | `[application] app/Actions/RiskCentrals/Experian.php:51-63` OAuth2 → `:224-234` POST hdcplus → `:201-221` **mock `ExperianFixture` en local/dev** → `:479 creditScore` `:511 quanto` `:543 aciertaQuanto` |
| 4 | **Dónde se guarda** | `[application] app/Models/RiskCentralUserData.php:20-24` (`data` = `encrypted:collection`, APP_KEY) · `Experian.php:237-240` (save) · `:266-268` (score = avg `models.scoreValue`) · `app/Models/User.php:232 datacredito` |
| 5 | **EL MAPPER** | `[application] Experian.php:243-249` (`additional_info`: `negativeAccounts.total` = `principals.currentNegativeCredits`, `maturationSince`) · `:314-323` (espejo `user_summaries`) · `:348-397` (**EAV 87/29/160**; ocup='Empleado' y flag='no' **hardcodeados**) · `:433-473` (EAV 90 egresos) |
| 6 | **Motor datacrédito VIVO (listado rt≠2)** | `[application] app/Services/lenders/RiskCentralValidationService.php:42-59` (score<rule, negativeAccounts>current_dues, maturation `<=` → reordena/quita) |
| 7 | **Motor datacrédito NUEVO (cupo rt=2)** | `[legacy] Modules/Loans/App/Services/DatacreditoRuleEvaluator.php:25-97` (regla genérica `allied_branch_id NULL`; score>=, negativeHistoricalLast12Months, consultedLast6Months, maturation `<` estricto; **fail-closed**) · cableado en `CreditopXQuotaController.php:239` |
| 8 | **KYC identidad/ingreso (no score)** | `[application] app/Actions/RiskCentrals/Tusdatos.php` (identidad + AML) · `Agildata.php` (empleo/ingreso gig) · `Mareigua.php` (analytics) · `Ado.php` (liveness) |
| 9 | **KYC V2 Credifamilia (solo legacy)** | `[legacy] app/Services/Lenders/CredifamiliaV2/Evidente/EvidenteClient.php` · `CrossCore/CrossCoreClient.php` + `JumioOnboardingService.php` |
| 10 | **kyc-gateway (Go) — NO cableado** | `[microservices] kyc-gateway/internal/adapters/providers/{experian,tusdatos,agildata,mareigua}/adapter.go` — passthrough sin mapeo, **sin consumidores hoy** (greenfield muerto) |

### Tablas
`risk_central_user_data` (`data` cifrado, `additional_info`, `score`) · `risk_centrals` (catálogo proveedores) · `risk_central_credentials` (por lender) · `user_summaries` (`datacredito`, `quanto`) · `user_field_values` (EAV 87/29/160/90) · `users` (`age`/`gender`/`date_of_birth`) · `lender_datacredito_rules` · `datacredito_frequencies` + `datacredito_query_by_allieds`.

### Endpoints externos
`POST {experian}/spla/oauth2/v1/token` · `POST {experian}/cs/credit-history/v1/hdcplus` (ProductId 64) · TusDatos `/api/launch(/verify)(/results)` · Agildata `/rest/afiliado/…` · Mareigua `/token`+`/consultas` · ADO `/api/{project}/Validation/{id}`.

### Ojo (gotchas)
- **Dos motores, campos distintos para "cuentas negativas"**: application usa `additional_info.negativeAccounts.total` (mapeado) vs `current_dues`; legacy usa `principals.negativeHistoricalLast12Months` (crudo) vs `negative_historical_last_12_months`. **Miden cosas diferentes** del mismo reporte.
- **Comparador de maduración OPUESTO**: viejo rechaza con `<=` (`RiskCentralValidationService:56`); nuevo con `<` estricto (`DatacreditoRuleEvaluator:94`). En el borde difieren.
- `consultedLast6Months` **solo lo lee el motor nuevo** (directo de `data.principals`); el viejo lo ignora (no está en `additional_info`).
- **Valores forzados**: al procesar Quanto se escribe EAV `29='Empleado'` y `160='no'` **hardcodeados** — el usuario queda marcado como Empleado sin central de riesgo artificialmente.
- En **local/dev el buró se MOCKEA** con `ExperianFixture` (212KB) → score/additional_info de dev son sintéticos.
- `users.age` (gate de CrediPullman) **no viene del buró**: se calcula de `date_of_birth` (TusDatos/Agildata o carga manual).
- El **mapper vive en `Experian.php` de application**; si se cablea kyc-gateway (Go), la normalización quedaría sin dueño.

---

## S5 · Consolidación rt=2 (CreditopX)

**Qué pasa.** `[application] LenderRetrievalService::getLenders` arma el listado en 8 etapas. **La
categoría (perfilador) NO va primero**: `group_rules`+datacrédito corren **antes**; la categoría corre
**al final** y es la que fija enganche/cupo. El endpoint **autoritativo del cupo** (ya migrado) es
`[legacy] CreditopXQuotaController::getAvailableQuota` (`POST /api/loans/lender/available-quota`).

### Orden real del cascade (verificado)
```
(1) base sucursal lenders_by_allied_branches + gate no_more (rt=2 ya usado → excluye)   :121-170
(2) filtros DUROS status=1 / country=1 (payment_link fuerza rt=1; Credifamilia 24)      :173-178
(3) validateRulesByLender = GROUP_RULES (AND) + datacrédito rt=2 INLINE                  LenderValidationService
        score>= · negativeHistoricalLast12Months<= · consultedLast6Months<= ·
        maturationSince>= · tramo amount min/max
      → rt=2 que falla se EXCLUYE (unset) …salvo have_ctopx (sobrevive hasta la categoría)
      → rt≠2 que falla → sort=4 al fondo (clasifica, no excluye)
(3b) applyProfilingAndRiskCentralRules = datacrédito rt≠2 → SOLO REORDENA (no toca rt=2) ProfilingRulesService/RiskCentral
(4) ML/matrices weighted_score (SOLO en producción; rt=2/3 forzados a 1)                 :231-249,585-603
(5) applySpecialConditions (DENTIX, Credifamilia)                                        :252,609-630
(6) preApprovedLenderService → rt=1 (ver S6)                                             :255
(7) orderByGroupProbability                                                              :258
(8) processRevolvingAndCreditopXLenders = CATEGORÍA rt=2 + TRAMO por monto  ◄── EL CORTE FINAL  :650-788
```

### Archivos por etapa
| Etapa | Archivo |
|---|---|
| Orquestador | `[application] app/Services/lenders/LenderRetrievalService.php:73 getLenders` |
| (3) group_rules + datacrédito inline | `[application] app/Services/lenders/LenderValidationService.php:53` (fetch por sucursal) `:196-262` (datacrédito rt=2) `:289-327` (AND + return/false; rt=2→false solo si `!have_ctopx`) `:372-384` (sort=4; **unset rt=2** en :377) |
| (3b) perfilador rt≠2 | `[application] app/Services/lenders/ProfilingRulesService.php:30` · `RiskCentralValidationService.php:42-74` |
| (8) categoría + tramo | `LenderRetrievalService.php:650 processRevolvingAndCreditopXLenders` → `:701 getLenderUserCategory` → `:716` **enganche = category->min_initial_fee** → `:724-736` **EXCLUYE si no hay categoría / cupo insuficiente** → `:737-761` tramo (recorta plazos + topea `max_amount-1`) → `:762-788` special granting DENTIX |
| (a) **cálculo del CUPO** | `[application] app/Services/lenders/LenderUserCategoryService.php:21 getLenderUserCategory` → `:310-351` `available = ceil( min(loan_limit−already_used, capacidad_de_pago, max_amount) / (1 − min_initial_fee/100) )` |
| (b) **endpoint autoritativo** | `[legacy] Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php:66 getAvailableQuota` — orden: status → active_credit `:189` → group/lender_rules `:214` → **datacrédito `:239`** → **categoría `:268`** → scoring-fallback `:325` → special-granting `:351` → tramo `:459` → min_amount `:483` → cupo `:519` |
| Tramo (modelo) | `[application] app/Models/CreditopXConditionsByAmountByLender.php` (`initial_fee_percentage` = **fantasma**, nunca leído) |

### Precedencia tramo vs categoría (verificado, holds=true)
- **El enganche final SIEMPRE lo fija la CATEGORÍA** (`min_initial_fee`). El `initial_fee_percentage` del tramo es **código muerto** en rt=2.
- **`max_fee_number` NO se pisa: se COMBINA por intersección (AND, gana el más restrictivo)**: la categoría pone el techo; el tramo recorta la lista de plazos dentro de ese techo (`mandatory_fee_number` fuerza un único plazo). El tramo aporta además el tope de `max_amount`. **Nunca el enganche.**

### Tablas
`lenders_by_allied_branches` (base) · `group_rules`+`lender_rules` · `lender_datacredito_rules` · `risk_central_user_data` · `datacredito_frequencies` · `lender_users_categories` (loan_limit/already_used_loan/min_initial_fee/max_amount/max_fee_number/life_percentage/multiplier) · `lender_users_category_rules` (tiers) · `creditop_x_conditions_by_amount_by_lender` (tramo) · `creditop_x_occupation/social_strata_multiplier_by_lender` (DENTIX).

### Ojo (gotchas)
- **Corte real rt=2 con `have_ctopx`**: un rt=2 que falla las reglas duras **NO** cae a `false_lenders` si el comercio tiene `have_ctopx` (sobrevive); el corte definitivo es la **categoría** (`:733-736`), no el datacrédito duro.
- **Perfilamiento SOLO en producción**: `getProfilingData`/`applyProfiling`/`usort` están gated a `environment()==='production'`. En local/dev el ranking difiere. (Además el ML `makePrediction` está corto-circuitado → siempre cae a matrices).
- **Solapamiento de riesgo REAL**: score/negativos/consultas/maduración se chequean **dos veces** (datacrédito temprano + categoría al final), ambos exclusión dura rt=2. `current_delinquencies` es exclusivo de la categoría.
- Heurística rara de suficiencia en application (`:727`, fallback mágico `3`); legacy lo reemplaza por un piso limpio `below_min_amount`.
- Fantasmas: `CreditopXConditionsByAmountByLender.initial_fee_percentage` y `category.rate` (comentario: "hoy null").
- **Etapas de fallback que el orden de arriba omite** (verificador): `processFallbackLenders` (`:219/:446`), `removeFallbackLendersIfPreapprovedExist` (`:273-276`), `removeNonPreapprovedLenders` (`:270/:343`, quita Sistecrédito id 9 en ecommerce si no tiene preaprobado).
- **Divergencia app↔legacy**: `getLenderUserCategory($user OBJETO, id)` vs legacy `($userId INT, id)` — misma lógica, dos repos, riesgo de deriva.

---

## S6 · Consolidación rt=1 (agregador)

**Qué pasa.** La pre-aprobación de agregadores (rt=1, deciden por **API externa**) vive en **dos mundos
paralelos**:
1. **application (VIVO, listado v1/v2 del monolito)** → `PreApprovedLenderService` despacha por **lender-id cableado a mano** a una `Action` que golpea la API del proveedor, y **conserva (arriba) o excluye (unset)** del listado según el veredicto. **No hay `/available-quota` para rt=1**: el cupo llega horneado en el listado.
2. **wizard nuevo (React Router)** → **NO usa ese PHP**: su loader dispara server-to-server una `Promise` por lender contra el **MS Go `pre-approvals-service`** (`VITE_PREAPPROVALS_ENDPOINT → POST /v1/preapprovals/check`) y **streamea** cada card.

### Camino A — application (VIVO)
| # | Paso | Archivo |
|---|---|---|
| 1 | getLenders llama la pre-aprobación | `[application] LenderRetrievalService.php:255` · inyectado en `ListLenderController.php:47` |
| 2 | Recorre y despacha por id | `[application] app/Services/lenders/PreApprovedLenderService.php:33 validatePreApproveLender` → `:67` foreach → `:87` ids **9,68,100,23/141/142/166,24,39,12,133** |
| 3 | Cada id → su Action externa | `[application] app/Actions/Lenders/Welli.php:273→118` (POST `/api/externals/risk/run_risk`) · `BancolombiaBnpl.php:630→705` (POST `/prospect-validation/validate-quota`) · `BancolombiaConsumerLoan.php` (fuerza `amount=1000000`) · `Sistecredito.php` (único vía `$lender->action`) · `Meddipay.php` · `Prami.php` · `Credifamilia.php` (radicación async) · `BancoDeBogotaCeroPay.php` |
| 4 | Traduce veredicto → listado | `PreApprovedLenderService.php:142/344/404` (aprobado → sort=1, `available`=cupo, `pre_approved_lender`=true, `$approvedLenders`) · `:709` merge (aprobados arriba + async al fondo) |
| 5 | Rechazo/timeout | `:118/131/199/367/578` `unset` (EXCLUYE) · `:228` Consumo **degrada a "media"** en vez de excluir |

### Camino B — MS Go `pre-approvals-service` (wizard nuevo)
| # | Paso | Archivo |
|---|---|---|
| 6 | Front fan-out + streaming | `[frontend] apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx:120` (endpoint) `:158` (elegibles rt≠0) `:182` (fetch) `:672` (Await) |
| 7 | Arma payload + POST | `[frontend] .../adapters/fetch-lender-preapproval.ts:146` (product key) `:152` (payload) `:171` (POST) `:261/264` (polling Credifamilia) |
| 8 | Handler HTTP | `[pre-approvals] cmd/http-server/main.go:90` · `internal/infra/handlers/preapprovals/handler.go:252` (rutas `/check`+`/me/check`) `:45` (Check) |
| 9 | Usecase core | `[pre-approvals] internal/core/usecases/preapproval/check_preapproval.go:56 Execute` (cache DynamoDB → applicant → request → `:122` override Welli 141/142→23 → `:126 CheckPreApproval` → attempt → `:160 notifyLenderResult`) |
| 10 | Factory por producto | `[pre-approvals] internal/infra/lending_products/factory/factory.go:45` (8 keys) · `core/domain/lending_product.go` (requisitos amount/hash, mínimos) |
| 11 | Workflow 4 etapas | `[pre-approvals] internal/infra/lending_products/workflow.go:52` `credentials(:101)→auth(:117)→api_call(:131)→adapt(:145)` · `:193 normalizeStageError` |
| 12 | Adapter por producto | `[pre-approvals] .../welli/adapter.go:62 Adapt` `:111` (approved solo si estado==approved && monto>0) · `welli/error_adapter.go:66` (5xx retryable, 4xx no) |
| 13 | Taxonomía de errores | `[pre-approvals] core/domain/lender_error.go` (stage+code+retryable) · `errors.go` (sentinels) · `handler.go:221` (→HTTP) `:121` (422 below_minimum) |
| 14 | Respuesta + espejo a legacy | `[pre-approvals] .../mapper.go:10 PreApprovalToAPI` · `internal/infra/services/lender_result_service.go:41` (webhook `/{id}/lender-result`) |
| 15 | Dependencias externas | `[pre-approvals] applicant_service.go:116` (`GET {customer-service}/user/{id}` + ExperianProfile) · `credentials_service.go:50` (`POST {legacy}/api/onboarding/credentials/get-by-lender`) |

### La frontera de responsabilidad (rt=1)
CreditOp solo: (a) decide **qué** lenders consultar (listado sucursal + filtros), (b) aporta **datos**
del solicitante (Experian/KYC vía customer-service) y **credenciales** del comercio, (c) **traduce** la
respuesta y **ordena**. La **decisión de crédito, monto y cupo** los calcula 100% la **API externa** del
agregador. Por eso **rt=1 NO es inyectable/simulable localmente** (no hay palanca en BD que fuerce el
veredicto) — contrasta con rt=2, cuyo cupo se decide local.

### Tablas
`lenders` (`action`=FQCN, `slug`→lending_product_key) · `lenders_by_allied_branches` · `lender_allied_credentials` (por lender+sucursal) · `user_requests` (status 11) · customer-service `users`+`experian_profile` · DynamoDB (preaprobaciones cacheadas + `preapproval_attempts`).

### Endpoints
`[pre-approvals] POST /v1/preapprovals/check` (+ `/me/check`, header `X-User-Id`) · `[legacy] POST /api/onboarding/credentials/get-by-lender` (credenciales) · `[legacy] POST /api/onboarding/loan-application/{id}/lender-result` (webhook espejo) · `[customer-service] GET /user/{id}`.
⚠️ `[legacy] POST /api/loans/lender/available-quota` es **CUPO rt=2**, **NO** rt=1.

### Ojo (gotchas)
- **Dos mundos paralelos** que divergen (p.ej. Welli **166 solo existe en application**; en legacy/MS es 23/141/142).
- El **front nuevo consume el MS Go directamente** (no pasa por el PHP). El PHP es el path viejo.
- **`$lender->action` (columna con el FQCN) solo se usa para Sistecrédito**; el resto instancia la clase a mano → mapa id→proveedor **hardcodeado**.
- **Bancolombia Consumo (100) fuerza `amount=1000000`** y **degrada** en vez de excluir (asimétrico).
- **Meddipay nunca cachea** (`ShouldCheckAgain=true` siempre).
- **Código muerto**: rama `frontend_response` en el front (el MS solo emite approved/rejected/pending); campo `encrypt_code` que el MS nunca emite; `transaction_data` sin contrato (`json.RawMessage`).
- **Race Credifamilia**: timeout del front (40s) > write_timeout del MS (30s) a propósito (abortar duplicaba transacciones).
- El **espejo a legacy es best-effort**: si el webhook falla, se loguea pero no bloquea → posible deriva entre lo que ve el usuario y lo que persiste profiling review.

---

## Apéndice A · La frontera rt=2 vs rt=1

| | **rt=2 CreditopX** | **rt=1 agregador** |
|---|---|---|
| Quién decide | **CreditOp** (motor de categorías local) | **API externa** del lender |
| Dónde | `LenderUserCategoryService` / `CreditopXQuotaController::getAvailableQuota` | Welli/Bancolombia/Meddipay/… (fuera) |
| Cupo | Calculado local (loan_limit − used, capacidad de pago, min_initial_fee) | Horneado en la respuesta externa |
| Enganche | `category->min_initial_fee` (local) | Lo trae el proveedor |
| Endpoint | `POST /api/loans/lender/available-quota` (legacy) | `POST /v1/preapprovals/check` (MS Go) |
| **Inyectable local** | ✅ Sí (hay estado en BD que lo fuerza) | ❌ No (decisión externa) |
| Corte en el listado | Categoría al final (excluye si no cae/cupo insuficiente) | `unset` si rechaza/timeout/sin credencial |

## Apéndice B · Campos fantasma / código muerto (consolidado)
- `product_type` — no existe (usar `response_type`+`path_id`).
- `lenders_by_allieds.min_amount` — fillable, nunca escrito.
- `lenders_by_allied_branches.status` — fillable, nunca escrito por la copia.
- `creditop_x_conditions_by_amount_by_lender.initial_fee_percentage` — nunca leído (enganche = categoría).
- ~~`category.rate` — expuesto, hoy null~~ **CORREGIDO (censo 2026-07-11):** en **legacy** SÍ decide — pisa `creditLines->rate` (`Onboarding/LenderRetrievalService:764-767`) y el wizard la consume; solo application la ignora (migración solo-legacy). Es **divergencia**, no fantasma.
- EAV `29='Empleado'` / `160='no'` — **forzados**, no vienen del buró.
- ~~`$lender->action` — solo Sistecrédito lo usa; resto hardcodeado~~ **CORREGIDO (censo 2026-07-11):** `action` es el despachador FQCN **general** (`new $lender->action` en SelfManager/PersonalInfo/UserRequest/Compensar/PreApprovedLenderService, ambos repos); convive con el mapa de ids de `PreApprovedLenderService:87`.
- Front: rama `frontend_response`, campo `encrypt_code` — sin backend que los produzca.
- Instrumentación Welli **166** (~200 líneas de diagnóstico en application) — ruido, no lógica.
- `kyc-gateway` (Go) completo — reimplementa clientes de buró pero **sin consumidores** (greenfield muerto).
- HARDCODE Credifamilia id 24 → rt=1 (accessor del modelo).

## Apéndice C · Índice maestro de archivos por repo

### application (VIVO)
```
app/Http/Controllers/Admin/
  LenderController.php · AlliedController.php · AlliedAlliedBranchController.php
  AlliedLenderController.php · AlliedEcommerceCredentialsController.php
  LenderRulesController.php · LenderDatacreditoRulesController.php
app/Http/Controllers/Customer/
  RegisterCellPhoneController.php · SimulatorController.php · UserRequestController.php
  ValidateOtpController.php · PersonalInfoController.php · ListLenderController.php
  DatacreditoQueryByAlliedController.php
app/Services/lenders/
  LenderRetrievalService.php ◄ orquestador cascade rt=2
  LenderValidationService.php · ProfilingRulesService.php · RiskCentralValidationService.php
  LenderUserCategoryService.php ◄ cálculo de cupo · PreApprovedLenderService.php ◄ rt=1
app/Actions/RiskCentrals/  Experian.php ◄ buró+mapper · ExperianFixture.php · Tusdatos.php · Agildata.php · Mareigua.php · Ado.php
app/Actions/Lenders/       Welli.php · BancolombiaBnpl.php · BancolombiaConsumerLoan.php · Sistecredito.php · Meddipay.php · Prami.php · Credifamilia.php · BancoDeBogotaCeroPay.php
app/Models/                Lender.php · Allied.php · AlliedBranch.php · LendersByAllied.php · LendersByAlliedBranch.php · UserRequest.php · RiskCentralUserData.php · CreditopXConditionsByAmountByLender.php
```

### legacy-backend (parallel-run)
```
Modules/Partner/App/Services/  LenderManagementService.php · AlliedManagementService.php ◄ alta + copia reglas
Modules/Onboarding/App/        Http/Controllers/{OnboardingController,LenderListingController,RegisterCellPhoneController}.php · Services/{UserRequestService, lenders/PreApprovedLenderService, lenders/RiskCentralValidationService}.php · routes/{api,webhooks}.php
Modules/Loans/App/             Http/Controllers/Customer/CreditopXQuotaController.php ◄ /available-quota rt=2 · Services/{DatacreditoRuleEvaluator, LenderUserCategoryService, LenderRuleEvaluator, ActiveCreditRuleEvaluator}.php · routes/api.php
Modules/Identity/App/          Services/ValidationStatusService.php · Enums/IdentityValidationType.php
app/Actions/RiskCentrals/      Experian.php ◄ cliente buró legacy (parallel-run)
app/Services/Lenders/CredifamiliaV2/  Evidente/EvidenteClient.php · CrossCore/{CrossCoreClient,JumioOnboardingService}.php
```

### pre-approvals-service (Go, rt=1)
```
cmd/http-server/main.go
internal/infra/handlers/preapprovals/  handler.go · mapper.go
internal/core/usecases/preapproval/    check_preapproval.go
internal/core/domain/                  preapproval.go · lending_product.go · lender_error.go · errors.go
internal/infra/lending_products/       workflow.go · factory/factory.go · contract_fields.go · welli/{adapter,error_adapter}.go
internal/infra/services/               applicant_service.go · credentials_service.go · lender_result_service.go
```

### frontend-monorepo (wizard)
```
apps/loan-request-wizard/app/routes/
  dynamic/request-amount.tsx · lenders-marketplace/available-lenders.tsx · .../lenders/preapproval-retry.tsx
modules/loan-request-wizard/
  loan-application-form/.../infrastructure/{partner-info,phone-number,phone-otp}.repository.ts
  lenders-marketplace/.../infrastructure/repositories/loan-options.repository.ts
  lenders-marketplace/.../infrastructure/adapters/fetch-lender-preapproval.ts
  lenders-marketplace/.../domain/entities/lender-resolution.entity.ts
```

---

*Generado desde el workflow de verificación `wa6yhb4yk` (2026-07-11). Para regenerar/ampliar una sección,
reejecutar el workflow `map-flujo-solicitud`.*
