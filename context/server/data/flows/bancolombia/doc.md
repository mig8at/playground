# Bancolombia · referencia (subnodo de `aggregator`)
> **estado:** validado contra `origin/main` de `legacy-backend` · `frontend-monorepo` · `application` · `pre-approvals-service` el **2026-07-31** (los working trees locales estaban en `qa` / feature) · Bancolombia es `response_type=1` **sólo en la decisión de crédito**: es el único agregador cuya **originación completa corre DENTRO de CreditOp** — onboarding propio, 23 endpoints propios, 41 pantallas del wizard.

## Qué responde
- ¿Qué pasos tiene el flujo Bancolombia y qué endpoint es cada uno? ¿En qué orden?
- ¿De dónde sale el `transactionId` de cada producto y **dónde queda persistido**?
- ¿Cómo fuerzo un escenario (con cupo / sin cupo / sesión expirada / fraude) sin tocar la API real?
- ¿Por qué el cierre de estado sigue en `application` si el flujo ya está en `legacy-backend`?
- ¿Cómo se genera hoy el **código de compra en punto de venta** y qué cambia si lo emite Bancolombia?

## Qué es
Bancolombia entra a CreditOp como **dos lenders distintos** que comparten infraestructura de auth:
**BNPL = lender 68** (`BC_PAGA_DESP`) y **Consumo / libre inversión = lender 100** (`BC_CONSUMO`).
Ambos son `response_type=1`: la **decisión, el cupo y la cartera** son del banco. Lo que lo separa del
resto de `aggregator` es que **CreditOp no hace un handoff**: renderiza toda la experiencia (login
redirect, cuota, selección de cuenta, términos, clave dinámica, firma, desembolso) contra **endpoints
propios** que proxyean la API del banco paso a paso. `Bancolombia::register()` (`:223`) está
**literalmente vacío** — no usa el `register()` genérico de `Integration`.

Consecuencia práctica: para trabajar acá **no alcanza el nodo padre**. El padre tiene la decisión
(`PreApprovedLenderService`, el filtro del listado); la máquina de originación es este nodo.

## Contenido

### 1 · Dispatch por id (no hay config)
`PreApprovedLenderService::validatePreApproveLender` bifurca por `$lender->id`: `:167` → `BancolombiaBnpl`
(piso **$100.000**), `:193` → `BancolombiaConsumerLoan` (piso **$1.000.000** y además **fuerza**
`$request->amount = 1000000` en `:199`). El Consumo se **muestra sin cupo real** por el `else`
(`Probabilidad media`/`sort=2`, con un `// ToDo` del propio código admitiéndolo). Cada producto tiene su
Action, su controller y su rama de front. Ver `hardcodes-entidades` (12 acoplamientos, P1).

### 2 · Entrada: Bancolombia tiene onboarding PROPIO
No entra por el marketplace `/lenders`. `routes.ts:146-160` monta un layout aparte:

| Ruta del wizard | Archivo |
|---|---|
| `bancolombia/self-service/:partner_hash/solicitar` | `routes/bancolombia/onboarding/register.tsx` |
| `…/:phone_number/otp` | `routes/bancolombia/onboarding/otp.tsx` |
| `…/no-preapproved` | `routes/bancolombia/no-preapproved.tsx` |
| `…/resolve-ecommerce-flow/:user_request_id` | `routes/bancolombia/ecommerce/resolve-ecommerce-flow.tsx` |

Quién manda ahí: el QR/link público cuando el allied ∈ `Setting('corbeta_allieds')`
(`onboarding/doc.md:22`) y el checkout Corbeta (`CorbetaCheckoutController:1250`). Después del
onboarding, todo cuelga de `bancolombia/:bancolombia_type` (`routes.ts:172`), con
`bancolombia_type ∈ {bnpl, consumo}`.

### 3 · BNPL 68 — la secuencia real (prefijo `bancolombia-bnpl/`, `Modules/Onboarding/routes/api.php:64-73`)

| # | Endpoint | Controller | Action (`BancolombiaBnpl.php`) | Persiste |
|---|---|---|---|---|
| 1 | `login-redirect/{ur}` | `BancolombiaBNPLLoginRedirect` | `:85` `login` (`:32` `provideAuthentication`) | — |
| 2 | `retrieve-quota/{ur}` | `:200` `BancolombiaBNPLRetrieveQuota` | `:169` `retrieveQuota` | **`:238` `bnpl_transaction_id`** + `:345` `retrieve_quota` |
| 3 | `list-accounts-and-quota/{ur}` | `:450` `BancolombiaBNPLListAccountsAndQuota` | — | **nada** (lee con `?? null` en `:477`) |
| 4 | `account-select/{ur}` | `BancolombiaBNPLAccountSelect` | `:296` `selectAccount` | — |
| 5 | `fetch-terms-and-conditions/{ur}` | `…FetchTermsAndConditions` | `:462` `retrieveTerms` | `:923` `retrieve_terms` |
| 6 | `accept-terms-and-conditions/{ur}` | `…AcceptTermsAndConditions` | `:532` `acceptanceTerms` | — |
| 7 | `dynamic-key-signature/{ur}` | `…DynamicKeySignature` | (firma clave dinámica) | — |
| 8 | `origination/{ur}` | `…Origination` | `:601` `origination` | `:658` **`LenderTransaction`** por `order_id` |

Fuera de la secuencia: `:716` `validateQuota` (el que usan el listado y el resolve-ecommerce),
`:912` `bnplConfirmed` (lo invocan los crons Corbeta), `:1003` `selfManager` + `:1028`
`selfManagerStatusId`, `:992` `parseWebhookJsonWebToken`. `:367` `purchase` existe pero no cuelga de
las 8 rutas de arriba.

### 4 · Consumo 100 — la secuencia real (prefijo `bancolombia-consumer-loan/`, `api.php:75-90`)

| # | Endpoint | Action (`BancolombiaConsumerLoan.php`) | Persiste |
|---|---|---|---|
| 1 | `login-redirect/{ur}` | `:113` `authenticate` | — |
| 2 | `redirect-user-validate/{ur}` | `:29` `validate` | **`BancolombiaLoanController.php:187` `loan_validate_key`** ← `data.security.customerValidateKey` |
| 3 | `fetch-terms-and-conditions/{ur}` | `:219` `retrieveTerms` | — |
| 4 | `register-terms/{ur}` | `:265` `registerTerms` | — |
| 5 | `enable-offers/{ur}` | `:326` `enableOffers` | — |
| 6 | `get-detail-simulation/{ur}` | `:389` `simulation` | — |
| 7 | `accept-terms-and-conditions/{ur}` | (trait `BancolombiaAcceptTermsTrait`) | — |
| 8 | `select-insurance/{ur}` | `:454` `retrieveAccounts` / `:515` `confirm` | — |
| 9 | `e-sign-document/{ur}` | `:159` `eSignDocument` | — |
| 10 | `origination/{ur}` | `:565` `disbursement` | — |

Ramal **"respuesta al frente"** (form front): `validate-credit-study/{ur}` + `enable-offers-form-front/{ur}`
→ `BancolombiaConsumerLoanOfferEvaluation.php` + los dos FormRequests
`{Personal,Financial}InfoOfferEvaluationRequest`. Cierre: `:637` `consumoConfirmed` (crons Corbeta),
`:711` `selfManager`. **`:77` el 409 `BP40920507` = "sin cupo"** y se devuelve como respuesta, no como
excepción.

### 5 · Auth: no hay token cacheado, se firma cada llamada
Todo en `Bancolombia.php` (base, `extends Integration`): `:52` `getCertificateBase64` (exporta el cert y
hace `strtr("\n"→" ")`), `:63` `generateJsonWebToken` (**RS256 firmado a mano** con `openssl_sign`,
`exp = iat + 60s`, `nonce` de 8 bytes, **sin `kid` ni `scope`**), `:141` `authorize` (OAuth2
client-credentials por scope). Headers: `Client-Id`, `Client-Secret`, `X-Client-Certificate`,
`Json-Web-Token`, `Message-Id`, `Channel` — **ensamblados inline en cada método**, no hay `buildHeaders()`.
Credencial: `LenderAlliedCredential::findOrFailByLenderAndAlly` (columna única `credential`, cast
`encrypted:collection`; claves `bancolombia_{client_id,client_secret,cert,privkey,application_name,api_gw,shared_key}`).
Scope de credencial = **merchant** (una por comercio). Host único `BANCOLOMBIA_HOST` + prefijos por API
(`config/services.php:82`).

### 6 · El código de compra en punto de venta (PIN) — hoy y lo que viene
**Hoy el PIN lo emite Corbeta, no Bancolombia.** Punto de entrada único
`POST purchase-code/generate/{user_request_id}` (`api.php:137` → `PurchaseCodeController:33` →
`PurchaseCodeService::getPurchaseCode`). Sin jobs, sin schedulers, sin webhooks.

- **Guard** (`PurchaseCodeService.php:106`) — **el estado 25 HABILITA** (no excluye): pasa sólo si
  `isCorbetaAllied(allied)` **Y** `user_request_status_id == 25` **Y** `lender_id ∈ [68,100]`; si no,
  `PCS000` y no genera. *(Esto cierra una contradicción entre dos diagnósticos previos — el guard está
  escrito en negativo `!= 25`, que se lee al revés.)*
- **Proveedor** (`CodeGenerationService.php:21-25`): `switch` por `allied_id` con literales `24`, `209`
  Alkosto, `210` K-TRONIX, `211` Alkomprar → `getFromCorbeta`; `default` → PIN interno. El convenio sale
  de un **ternario** (`:51`): `lender_id == 68 ? convenio_bnpl : convenio_consumo` — el `else` captura al
  100 **y a cualquier otro lender**.
- **Cliente Corbeta** (`app/Actions/Allieds/Corbeta.php`, gemelo byte-idéntico del de `application`):
  `:38` `authorize`/`getToken` · `:58` `register`/`setOrder` (**payload de 18 campos**, email fijo
  `ordenes-corbeta@creditop.com` en `:89`) · `:131` `query`/`getOrder` (**por rango de fechas + estado**,
  devuelve **lista** deduplicada por `pin`). El PIN viene **embebido en texto**: se extrae con regex
  `/PIN\s+([a-f0-9]{20,})/i` (`CodeGenerationService.php:72`).
- **Dónde queda**: `user_request_additional_information.data_json->verification_token` (`longtext`, cast
  `collection`; **19.692 filas** con token en la copia local). `purchase_codes` sólo guarda `barcode_url`.
- **Imagen**: `BarcodeService` — `:35` `ean13` exige `^\d{12}$` (`:49`), `:39` `ean128` sin restricción.
  **Los cuatro allieds Corbeta (24/209/210/211) son `ean128`** (verificado en BD), así que un código de
  20–30 hex es seguro para este alcance.

**Lo que viene (diseño, NO implementado):** Bancolombia publicó *In Store Billing Code — Code Management*
(`POST /generateBillingCode` → `data.billingCode`; `GET /retrieve-order-details?billingCode`; `HEAD /health`)
para reemplazar a la API Fondos de Corbeta en los dos productos. De **18 campos sobreviven 3**
(`address`, `cityCode`, `departmentCode`) y aparece uno nuevo, **`transactionId`**, que es
`bnpl_transaction_id` para el 68 y `loan_validate_key` para el 100 (§3/§4). El eje de consulta cambia de
*rango de fechas → lista* a *billingCode → objeto único*. **El detalle del diseño (Action aditivo
config-driven al estilo `EcommerceNotifier`, `departmentCode = substr(cityCode,0,2)`, bitácora en
`lender_transactions`, timeout explícito) es TAREA, no contexto: vive en el handoff de Santiago
(2026-07-29) y corresponde al tablero.** Acá quedan sólo los hechos del código actual y los datos duros
que sostienen esas decisiones.

Datos duros re-verificados contra la copia local de la BD (respaldan el diseño):

| Dato | Valor |
|---|---|
| `country_cities.code` | **1.124/1.124** con exactamente 5 dígitos; las **112** ciudades alcanzables desde `allied_branches`, todas de 5 dígitos |
| `country_zones.code` | **sucio**: 4.110 filas, sólo 419 numéricas, 235 con largo < 2. Colombia (country_id **47**): 36 filas, 3 malas → `EXT`, `MED`, `TODOS` |
| Sucursales cuya zona no es DANE de 2 dígitos | **44** (todas caen en `TODOS`) → derivar el departamento del `cityCode` evita las 44 |

### 7 · Sandbox: tres palancas, no una
En no-producción hay escenarios direccionables **sin tocar la API real** (`app()->environment() === 'production'` los apaga):

| Palanca | Dónde | Cómo se elige |
|---|---|---|
| `validateQuota` (listado) | `BancolombiaBnpl.php:793-802` | **cédula**: `1998228194` con cupo · `1998228111` sin cupo |
| `retrieveQuota` + `origination` (BNPL) | `:263` `resolveSandboxScenarioByPhone` / `:283` `resolveOriginationScenarioByPhone` + `config/api_bancolombia_bnpl.php` | **celular**: `3000000010`→BP20790 compra reciente · `3000000015`→BP20753 sesión expirada · `3000000016`→BP20794 riesgo de fraude |
| Consumo | `ApiBancolombiaLoanRequestBuilder::resolveScenarioByDocumentNumber` + `config/api_bancolombia_loan_requests.php` | **cédula**; hay un artisan de preview (`BancolombiaPreviewPayloadCommand`) |
| MS Go (v2) | `pre-approvals-service` `bancolombia_bnpl/sandbox.go` | **cédula**: `1998228194` → `with_quota`; **cualquier otra** → `without_quota` |

### 8 · Cierre de estado: el flujo está en legacy, el webhook NO
`legacy-backend` tiene `app/Http/Controllers/Api/BancolombiaController.php` (`:24` `bnplWebhook`,
`:111` `consumerLoanWebhook`) + sus dos FormRequests, pero **ningún archivo de rutas lo registra en
`main`** — es copia muerta. Las rutas vivas están en `application/routes/api.php:21-30`: `bancolombia/bnpl/webhook`,
`bancolombia/consumer-loan/webhook` y dos variantes `…/webhook-by-user-request` vía
`BancolombiaUserRequestController`. `application/routes/customer.php:318-328` conserva además las
pantallas viejas `/consumo/*` del monolito. Es el bloqueo duro del cutover (ver `architecture`).

## Dónde mirar
- **Actions** (legacy-backend `app/Actions/Lenders/`): `Bancolombia.php` (base: `:52` cert, `:63` JWT, `:141` authorize, **`:223` `register()` vacío**) · `BancolombiaBnpl.php` (§3 + `:671-690` **el patrón robusto de error a replicar**: `data_get(…,'errors.0.code')` + `$isBankHttpError` + reenvía el body crudo) · `BancolombiaConsumerLoan.php` (§4) · `BancolombiaConsumerLoanOfferEvaluation.php`.
- **Controllers + rutas** (legacy-backend): `Modules/Onboarding/App/Http/Controllers/Bancolombia{,Bnpl,Loan}Controller.php` · `Modules/Onboarding/App/Traits/BancolombiaAcceptTermsTrait.php` · `Modules/Onboarding/routes/api.php:59-90` (los 3 prefijos) · `Modules/Onboarding/App/Services/lenders/Bancolombia/BancolombiaService.php` (`:69` rama `lender_id === 68`).
- **Persistencia del flujo**: `app/Models/LenderIntegrationFlow.php` — `:34` `getStepsFromSession` (**el accesor canónico: `:48` filtra por `lender_id`**), `:19` `data` casteado a `collection`. El paso se escribe con `saveLenderIntegrationFlowStep` (`BancolombiaBnplController.php:1440`). `app/Models/LenderTransaction.php` es la bitácora (`order_id`, `request`, `response`, `status_id`).
- **Código de compra**: `PurchaseCodeController.php:33` · `merchants/PurchaseCodeService.php:106/:135-144/:275-283/:296-311` · `merchants/CodeGenerationService.php:21-29/:51/:72` · `merchants/BarcodeService.php:35-51` · `app/Actions/Allieds/Corbeta.php` · `config/services.php:303-309` (bloque `corbeta`).
- **Front** (frontend-monorepo): `apps/loan-request-wizard/app/routes.ts:146-254` (el mapa entero) · **41** archivos en `app/routes/bancolombia/**` + **4** layouts en `app/layouts/bancolombia/` · módulo `modules/loan-request-wizard/bancolombia-origination/` (**30 use-cases**, ports, repositories; las 115 piezas de `ui/` son presentación y no se curan acá). Único test del árbol Bancolombia: `routes/bancolombia/loan/credit-approved.helpers.test.ts`.
- **Precedentes reutilizables**: `Ecommerce/EcommerceNotifier.php` + resolver `Modules/Onboarding/App/Services/EcommerceRequestService.php:537` + `config/ecommerce.php:27-32` (estrategia config-driven) · `Ecommerce/SelfDevelopmentNotifier.php:51` (timeouts explícitos `15/10`) · `CredifamiliaConsumo/TransactionRequest.php:436-459` (`resolveCityCode`, DANE sin padding) · `app/Services/ErrorCaptureService.php`.

## Frontera de simulación / harness
- **La decisión no es inyectable** (la toma la API del banco), pero **el escenario sí es direccionable en no-prod** por cédula y por celular (§7). Eso es más de lo que decía el padre ("frontera dura"): se pueden ejercitar con-cupo, sin-cupo, sesión expirada y riesgo de fraude sin mockear el transporte.
- El harness lo rutea **por ID antes que por `rt==1`** (`bancolombiaClose`: `validate-preapproved` con `Http::fake` + override `TestDoc=1998228194`). **No llega a Estado 11.**
- El eje ecommerce se degrada en local (Mixed Content contra el host interno) → usar dev desplegado.

## Gotchas / riesgos
- **`bnpl_transaction_id` casi nunca se escribe.** Sólo lo escribe `RetrieveQuota` (`:238`); el endpoint paralelo `ListAccountsAndQuota` (`:450`) **no escribe nada** y lo lee con `?? null` (`:477`). En la copia local, de **119** solicitudes de lender 68 en estado 25 sólo **5** tienen la clave (el handoff reportó **0 de 120** en el entorno que consultó — la conclusión cualitativa se sostiene, la absoluta no; los dos entornos difieren también en el total de flows del 68: 223 local vs 29 reportado). Sin ese valor, cualquier consumidor posterior de `transactionId` queda sin insumo.
- **Las asignaciones `$request->campo = …` no persisten nada.** `clone $request` es `Illuminate\Http\Request`, no Eloquent: la propiedad vive sólo durante esa petición HTTP. La única persistencia real es `lender_integration_flows.data`. Importa porque `purchase-code/generate` es una petición **posterior y separada**.
- **`UserRequest::lenderIntegrationFlow()`** (`app/Models/UserRequest.php:207`) es un `hasOne` **sin filtro de lender**, y la tabla mezcla lenders (local: 100→1.730, 68→223, 24→8, 23→1, 6→1). No hay índice único sobre `user_request_id`: **16** `user_request_id` con más de una fila en la copia local. Usar siempre `getStepsFromSession`.
- **`getRequestExceptionCode()` accede por índice directo** `['errors'][0]['code']` — triplicado en `Bancolombia.php:27`, `BancolombiaBnpl.php:27`, `BancolombiaConsumerLoan.php:26`. Una respuesta de error sin `errors` **lanza dentro del propio manejador de errores**. El patrón robusto ya existe en `BancolombiaBnpl.php:671-690` pero no se aplicó acá.
- **Cero timeouts** en toda la integración Bancolombia (`Bancolombia`, `BancolombiaBnpl`, `BancolombiaConsumerLoan`, `…OfferEvaluation`, `Integration`): default de Guzzle, y las llamadas son **síncronas en el request del usuario**.
- **Expiración del certificado no se guarda ni se verifica**: `LenderAlliedCredential` no tiene columna de fecha y `getCertificateBase64()` no lee `validTo`. Un cert vencido sólo se detecta por rechazo del banco (misma superficie que el bloqueo abierto de `enableOffers`).
- **Dos fuentes de verdad para "es Corbeta"**: `Setting('corbeta_allieds')` (dinámico, lo usa el guard) vs el `switch` hardcodeado de `CodeGenerationService.php:21-29`. Un allied agregado al Setting pero no al switch pasa el guard y cae en `generateInternally()` → **falla en silencio** con un código interno que no sirve en caja.
- **HTTP 400 en `Allieds/Corbeta::register()` → variable indefinida**: sin seed de `LenderErrorCode` para `App\Actions\Allieds\Corbeta`, `handleException` retorna `void` y `register()` hace `return $apiResponse` **nunca asignada** → `Error` de PHP 8, que **no es `Exception`** y ningún catch de la cadena lo captura.
- **Cero tests** del camino purchase-code (ni `Http::fake` del host de Corbeta): no hay red de seguridad para detectar una regresión al conmutar de proveedor.
- **`query()` no manda el header `UserId` que `register()` sí manda** (`Corbeta.php:131` vs `:58`). No se determinó si es intencional.

## Preguntas abiertas
- [ ] **F1/F2 (front)**: ¿el módulo `bancolombia-origination` llama `RetrieveQuota` o `ListAccountsAndQuota` para la cuota BNPL, y reenvía `bnplTransactionId` en pasos posteriores? Explica el hueco de arriba. Requiere diagnóstico del front.
- [ ] **N1 (negocio)**: ¿el código de compra para **Consumo** ya corrió en producción? En la copia local hay **0** solicitudes de lender 100 en estado 25 (vs 119 del 68) → puede ser habilitación, no reemplazo.
- [ ] **N2 (negocio)**: `address` del servicio nuevo se describe como *residencia del cliente*, pero hoy se envía `alliedBranch->address` (dirección de la **sucursal**). Además el nuevo tiene `maxLength 20`.
- [ ] **Al banco**: ¿el 409 `BP21000` devuelve el `billingCode` existente o sólo el error, y hay forma de consultar por `transactionId`? Sin eso, una respuesta perdida deja la orden huérfana (no hay clave de idempotencia; `message-id` identifica el mensaje, no la operación).
- [ ] ¿Por qué `app/Http/Controllers/Api/BancolombiaController.php` existe en legacy sin ruta? ¿Se registró y se revirtió, o se portó anticipando el cutover?
- [ ] `Modules/Onboarding/App/Http/Controllers/BancolombiaController.php:23` `validatePreApprovedAndRedirect`: no se leyó el criterio con que elige BNPL vs Consumo al redirigir.

### Cerradas en esta pasada
- ✅ **El estado 25 habilita** (no excluye) en `PurchaseCodeService.php:106` → las cifras calculadas asumiendo que habilita son las correctas.
- ✅ **`barcode_type` de los allieds 24/209/210/211 = `ean128`** → el riesgo de `ean13` (`^\d{12}$`) no aplica a este alcance.
- ✅ **`country_zones` está sucio y `country_cities.code` está limpio** (números arriba) → derivar el departamento del código de ciudad es lo correcto.

## Bitácora
- **2026-07-31** — Nodo creado (carve-out de `aggregator`). **145 archivos** validados con el oráculo (0 DROP) y verificados uno a uno contra `origin/main`. Motivo: el padre resumía toda la originación Bancolombia en una celda de tabla ("login→quota→purchase→origination") mientras el código real tiene 23 endpoints, 41 rutas de wizard, 4 layouts y un módulo DDD de 216 archivos; la cobertura curada era 8/19 archivos en legacy-backend y 5/216 en el módulo del front. Absorbe el handoff `bancolombia-billing-code-handoff.md` (Santiago Villaquiran, 2026-07-29) **sólo en su parte durable**: el diseño pendiente (D1–D9 + plan de 6 pasos) es tarea y va al tablero. Drift corregido del handoff: `routes/api.php:135`→**:137**, `config/services.php:297-304`→**:303-309**, `EcommerceRequestService` **no** está bajo `Services/Ecommerce/` (es `Modules/Onboarding/App/Services/EcommerceRequestService.php:537`), `SelfDevelopmentNotifier:56`→**:51**, `resolveCityCode:317-343`→**:436-459**, filtro por lender en `getStepsFromSession` `:50-52`→**:48**.

## Enlaces
- Padre: **aggregator** (maquinaria genérica rt=1: `PreApprovedLenderService`, `LenderRetrievalService`, el filtro `[12,23,141,142,166]`, las Actions de los otros lenders, `UserRequestService` con el `case 1` y la tabla de canales). Hermano: **corbeta** (el canal batch: checkout base64, crons de conciliación, estado 26, y quién **invoca** `bnplConfirmed`/`consumoConfirmed`).
- Pre-aprobación v2: **ms-preapprovals** (`bancolombia_bnpl` / `bancolombia_consumer_loan` en el MS Go: adapter + client + oauth2_strategy + `sandbox.go`; el challenge `urlAuthenticate`/`customerValidateKey` del Consumo). Deuda de ids: **hardcodes-entidades**. Cutover: **architecture**.
- Fuentes: `Downloads/MOTAI/BANCOLOMBA/bancolombia-billing-code-handoff.md` (handoff, 2026-07-29) + `api_in-store-billing-code-code-management__1_.yaml` (OpenAPI del servicio nuevo — **no vive en ningún repo**, no verificable contra código).
- Memorias: `modelos-canales-flujos`, `synth-lender-type-boundary`, `pre-approvals-service`, `migracion-application-a-legacy-estado`, `lender-listing-cascade`.
