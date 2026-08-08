# CreditopX · contexto
> **estado:** al día con main · Familia de prestamistas IN-PLATFORM (`response_type` **2**=consumo · **3**=rotativo): CreditOp decide con su motor LOCAL (reglas de grupo → datacrédito → categoría/cupo), fija enganche/cupo/plazo y cierra hasta el **Estado 11** — el único flujo inyectable/simulable.

## Qué es
CreditopX **no es un lender: es una FAMILIA** de prestamistas in-platform (`response_type == 2`, y `== 3` para cupo **rotativo**). ⚠ **Pero rt=2 y rt=3 NO comparten motor** — ver la sección del rotativo más abajo; lo de acá describe rt=2. Para rt=2: **CreditOp decide el crédito con reglas y datos LOCALES** (sin API externa de decisión → el único flujo 100% inyectable en pruebas), fija **enganche/cupo/plazo** con su motor de **categorías**, y cierra la solicitud in-platform hasta el **Estado 11** (autorizada/desembolso). Miembros (ids de negocio, ficha `159906a:docs/lenders/CREDITOPX.md`): **CrediPullman 77**, **Creditop X 37**, **Celupresto 96**, **SmartPay 152 dev / 160 prod**, **Motai 158**, Magnocréditos…

Este nodo cubre la **capa de DECISIÓN** (qué card aparece y con qué enganche/cupo). El recorrido punta a punta (OTP → ADO → firma OTP → 11), el buró y el servicing post-11 viven en nodos hermanos (**KYC** cede la adquisición de buró; **Formalization** el cierre; servicing post-11 en application, memoria `continuacion-credito-servicing`). Capa económica: el **comercio** pone capital y riesgo y es dueño del crédito; **CreditOp opera** (origina, firma, desembolsa, cobra) y gana **comisión por recaudo** (memoria `creditopx-modelo-comercio`).

Tipos (capacitación de producto, `159906a:docs/codigo/MECANICA-CREDITO.md`):

| Tipo | Ticket | Cupo | rt |
|---|---|---|---|
| **Rotativo** | < $1.000.000 | se **libera al pagar** capital (reutilizable) | 3 |
| **Consumo** | > $1.000.000 | **NO** se libera tras el pago | 2 |
| **Renting** (Motai) | — | device-lock IMEI (nodo `motai`) | 2 |

Mecánica financiera (informativa): amortización **francesa** (cuota FIJA, interés sobre **saldo diario**); **cuota total = capital+interés + seguro de vida + fondo de garantía (FGA)**.

> ⚠ **Corregido (F-71).** Acá decía que la cadena de tasas era `EA → MV (1+EA)^(1/12)−1 → diaria (1+MV)^(1/30)−1`. **Ese no es el código de CreditopX** — es el de Credifamilia (`app/Services/PaymentPlan/Credifamilia/Math/FinancialMath.php`). CreditopX **divide**, no capitaliza: `rate/100` (`CreditopXPaymentService.php:741`, `CreditopXRequestHistoryService.php:302`) y `rate/30` para la diaria (`CreditopXRequestHistoryService.php:1165`), porque `credit_line_by_lenders.rate_suffix` es **N.M.** (nominal mensual) en las 157 filas — y para una nominal, dividir es lo correcto. Ver **F-71** en `findings`. El **FGA %** y el **enganche** son salidas de la categoría (`lender_users_categories.FGA` / `.min_initial_fee`; ver Subcontextos).

## ⚠ El ROTATIVO (rt=3) NO usa categorías — tiene su propio motor

Corregido el **2026-08-07**. Este nodo decía que rt=2 y rt=3 comparten «el motor de categorías». Es
**falso para rt=3**, y lo confirmaron las dos fuentes: la dueña de política en #tech-ops
(«Rotativo NO tiene categorías · esas condiciones se manejaron con reglas duras · la política de
rotativo es estándar para todos, y dependiendo del riesgo puede arrojar un plazo mín») y el código.

**La fórmula, en `application/app/Services/lenders/RevolvingLoanConfigService.php`** (los pasos están
numerados en el propio archivo):

1. **Ingreso** = `FN_User_Income_Average` (`:64`) — función de BD, ver `db-routines`.
2. **Deuda mensual** = `datacredito.agregatedInfo.overview.balances.valueMonthlyPayment × 1000` (`:71`).
3. **Gastos fijos** = `FN_CreditopX_Profiling_Fixed_Expense_Perc(ingreso)` (`:73`), como % del ingreso.
4. **Capacidad de pago** = ingreso − deuda − gastos + deuda_ya_con_creditop (`:77`).
5. **Multiplicador de riesgo** = `FN_CreditopX_Revolving_Credit_Multiplier(datacredito, userSummary)`
   (`:80`). ⚠ Esa función **no tiene fuente en ningún repositorio** — por eso no se puede auditar desde
   el código ni desde Redash; sólo leyendo la BD de dev (`db-routines`).
6. **Multiplicador ≤ 3 ⇒ RECHAZO** con cupo 0 (`:86`).
7. **Cupo** = capacidad × multiplicador, capado por `lenders.max_rev_credit`, **redondeado hacia abajo
   de a 50.000** (`:90-93`).
8. **PLAZO MÍNIMO = `ceil(cupo / capacidad_de_pago) + 1`** (`:95`). Es **calculado, no parametrizado**.
9. **Enganche y FGA** salen de `creditop_x_profiling_down_payments_fga` buscando por
   **`multiplier_risk`** (`:99-104`) — *no* por categoría. Un lender sin fila ahí queda con enganche 0.

**Por qué esto genera tickets.** Negocio parametriza los plazos del comercio (p. ej. 1, 3 y 6 cuotas) y
al cliente le aparece **sólo 6**. No es un bug de configuración: el paso 8 calculó un mínimo de 6 y
recortó las opciones de abajo. Reportado dos veces el 2026-08-03 por dos personas distintas, y la
respuesta —«por política no tenemos parametrizado el número de cuotas por perfil»— muestra que del lado
de negocio no se esperaba que el sistema lo acotara solo.

**Y por qué no se puede diagnosticar con los datos**: ni el multiplicador ni la capacidad de pago se
persisten; el multiplicador además se calcula en una función de BD sin fuente. Es literal lo que dijo
la dueña de política: *«estaba revisando y no lo pueden ver en redash»*.

## Contenido
La consolidación rt=2 corre en el orquestador `getLenders`. **Clave: la categoría NO va primero** — `group_rules`+datacrédito corren antes; la **categoría corre AL FINAL** y es la que fija enganche/cupo/plazo (y excluye si no hay categoría o el cupo no alcanza).

Orden real del cascade (application, la ruta **viva por defecto** en parallel-run):
1. **Base sucursal** (`lenders_by_allied_branches`) + gate `no_more`: si el usuario ya tiene una solicitud rt=2, excluye los rt=2 (`LenderRetrievalService.php:121`).
2. **Filtros duros** `status=1` / `country=1`.
3. **`group_rules` (AND) + datacrédito rt=2 inline** (`LenderValidationService.php:176-262`): score `>=` (:206) · negativos 12m `<=` (:219) · consultas 6m `<=` (:232) · maduración `>=` (:249). Un rt=2 que falla se **EXCLUYE** (se hace `unset` de `false_lenders`, :376) — **salvo `have_ctopx`** (sobrevive hasta la categoría, :308-327). El datacrédito rt≠2 solo **REORDENA**.
4. **ML/matrices** `weighted_score` — **solo en producción** (`environment()==='production'`, :231/:244); rt=2/3 forzados a `weighted_score=1` (arriba, :586/:600).
5. **Special granting** (buckets monto-por-score, casos DENTIX/especiales): `LenderSpecialGrantingService`.
6. Pre-aprobados rt=1 (nodo `aggregator` / `ms-preapprovals`).
7. Orden por probabilidad.
8. **CATEGORÍA rt=2 + TRAMO por monto** ◄ el corte final (`processRevolvingAndCreditopXLenders`, :650): fija enganche (`category->min_initial_fee`, :716), calcula cupo (:718) y **excluye** si no hay categoría o `available_amount < min_amount/min_initial_fee` (:727).

- **Enganche final = SIEMPRE la CATEGORÍA** (`min_initial_fee`); el `initial_fee_percentage` del comercio/tramo es **código muerto** en rt=2 (nunca se lee para enganche).
- **Cupo (el enganche INFLA lo financiable):** `available = ceil( min(loan_limit − already_used, capacidad_de_pago, max_amount) / (1 − min_initial_fee/100) )` (`LenderUserCategoryService.php:47-50` ruta simple · `:318/:334/:347-350` ruta por capacidad de pago = PV francesa del salario menos seguro de vida y cuota reportada en datacrédito).
- **Dos motores en paralelo (strangler):** application (`LenderRetrievalService::getLenders`, default vivo) y el gemelo migrado en legacy (`LenderListingService::getLenders` → marketplace `lenders-v2`). El **sello rt=2** en legacy: si la categoría no devuelve `available_amount>0`, la card **no aparece** (`LenderListingService.php:298-310`).
- **Endpoint autoritativo del cupo** (ya migrado a legacy): `POST /api/loans/lender/available-quota` → `CreditopXQuotaController::getAvailableQuota` (:66); re-decide en el punto de venta (datacrédito :239, categoría :268, cupo :452 topeado por tramo a `max_amount−1` :468).
- **Discriminador `response_type`:** seeder `0=UTM · 1=Integración · 2=Creditop X` — **no hay fila 3** sembrada aunque el código (`in_array(rt,[3,2])`) y el front la usan. Front: `LENDER_RESPONSE_TYPE {CREDITOP_X:2, CREDITOP_X_REVOLVING:3}`; `requiresInitialFee` = **siempre true en rt=2**, y en rt=3 solo si `monto>maxAmount`; `PRE_APPROVAL_FLOW_RESPONSE_TYPES = {2,3,4}` (rt=4 Credifamilia comparte el flujo de pre-aprobación del front pero decide FUERA).

## Subcontextos
- **Profiling** — perfilamiento rt=2: la **categoría** (`lender_users_categories` + `lender_users_category_rules`) en la que cae el usuario fija enganche/cupo/plazo (el corte final del cascade) + el perfilador datacrédito rt≠2 (solo reordena).
- **Amount tiers** — **tramos por monto** (`creditop_x_conditions_by_amount_by_lender`): según el monto pedido recortan plazos (`max_fee_number`/`mandatory_fee_number`) y **topean el cupo** (`max_amount−1`). NO tocan el enganche.

## Dónde mirar
- **Orquestador rt=2 — ruta viva** (application): `app/Services/lenders/LenderRetrievalService.php:73 getLenders` · `:121 have_ctopx/no_more` · `:650 processRevolvingAndCreditopXLenders` · `:716` enganche=`category->min_initial_fee` · `:718` cupo=`min(min(available,loan_limit−used),max_amount)` · `:727` exclusión por cupo.
- **Reglas duras + datacrédito rt=2** (application): `app/Services/lenders/LenderValidationService.php:27 validateRulesByLender` · `:176` gate rt=2 · `:206/219/232/249` score/negativos/consultas/maduración · `:308-327` `have_ctopx` sobrevive · `:376` `unset` del rt=2 fallido.
- **Cupo / enganche-inflado** (application): `app/Services/lenders/LenderUserCategoryService.php:21 getLenderUserCategory` · `:47-50` cupo (ceil·min) · `:334` PV francesa por capacidad de pago.
- **Special granting / buckets de score** (application `app/Services/lenders/LenderSpecialGrantingService.php`; legacy `Modules/Loans/App/Services/LenderSpecialGrantingService.php` ~`:198-203` buckets quemados 1.2M/15M — el gemelo de Onboarding ya usa tabla).
- **Motor datacrédito NUEVO rt=2** (legacy): `Modules/Loans/App/Services/DatacreditoRuleEvaluator.php:19 evaluate` · `:48` fail-closed (sin score→rechaza; un score real de 0 sí pasa) · `:80` score`>=` · `:85` negativos. Umbral por-lender: `application/app/Models/LenderDatacreditoRule.php`.
- **Gemelo migrado del listado** (legacy): `Modules/Onboarding/App/Http/Controllers/LenderListingController.php` (`lenders-v2`) → `Modules/Onboarding/App/Services/lenders/LenderListingService.php:53 getLenders` · `:298-310` sello (card sólo si `available_amount>0`) · `:356 no_more=false` (TODO)

⚠ **En el flujo «confirmación de cupo» CreditopX NO se lista.** `LenderListingController::filterLendersByResponseTypeForFlow`
(`:57-73`) recorta el listado a **solo `response_type == 0`** cuando `user_request.flow_id ==
Flow::ALREADY_CONFIRMED_PRE_APPROVAL` (=2, `Modules/UserRequestV1/App/Constants/Flow.php:24`); para
cualquier otro flujo devuelve la lista intacta. Como CreditopX es rt=2, **queda excluido**: ese flujo
salta Experian y solo ofrece los lenders sin integración directa. Vale para `lenders-v2`; el filtro
vive en el controller, no en `LenderListingService`.. Categoría/cupo Ctopx: `Modules/Loans/App/Services/LenderUserCategoryService.php` (firma `getLenderUserCategory(int $userId, id)` — diverge de application, que pasa el objeto `$user`).
- **Endpoint autoritativo del cupo** (legacy): `Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php:66 getAvailableQuota` · `:239` datacrédito · `:268` categoría · `:326` `scoring_policy_fallback_blocked` · `:452/:468` cupo + tope por tramo.
- **Discriminadores** (legacy `database/seeders/ResponseTypesTableSeeder.php:24-35`; `app/Models/Lender.php:77 isSmartpay` vía `config('lenders.smartpay_lender_id')`; frontend `modules/loan-request-wizard/lenders-marketplace/src/lib/domain/constants/lender.constants.ts:37/57/68/78`).

## Gotchas / riesgos
- **`have_ctopx` NO es gate duro.** Un rt=2 que falla las reglas duras no cae a `false_lenders` si el comercio tiene `have_ctopx`; el corte definitivo es la **categoría**, no el datacrédito temprano.
- **rt=3 sin fila de catálogo.** El seeder solo siembra `response_type` 0/1/2; rt=3 (rotativo) existe en código y en el front (`CREDITOP_X_REVOLVING`) pero no como fila sembrada.
- **App↔legacy divergen (parallel-run).** `getLenders(UserRequest $userRequest)` (app) vs `getLenders(int $userRequestId, …)` (legacy); `getLenderUserCategory($user OBJETO)` vs `(int $userId)`; el gate `no_more` está **vivo en application** y **`= false` (TODO-a-quitar) en legacy**. Misma lógica, dos repos; application sigue siendo el default (memoria `migracion-application-a-legacy-estado`).
- **Riesgo chequeado dos veces.** Score/negativos/consultas/maduración corren en el datacrédito temprano Y de nuevo dentro de la categoría/cupo al final; la maduración usa comparadores divergentes entre motores (memoria `datacredito-rules-per-lender`).
- **Perfilamiento/orden SOLO en producción.** `getProfilingData`/`applyProfiling`/`usort` gated a `environment()==='production'` (:231/:244); en local/dev el ranking difiere. El ML `makePrediction` **no responde** — ⚠ y no por estar corto-circuitado: en prod **timeoutea a los 15 s** contra `profiler.inertia-production:8000` (medido 2026-08-06 en la uReq 521997, 4 veces en una solicitud). ⚠ Tampoco «cae a matrices»: el fallback es el OTRO perfilador (estrategia `new_then_legacy`), y el nuevo está apagado porque falta `NEW_PROFILER_ML_HOST` — o sea que el intento primario falla en el 100 % de las solicitudes. Ver **F-104**. La diferencia importa para diagnosticar: un listado lento no es «el ML está apagado», es 15 s de espera por intento; rt=2/3 igual se fuerzan arriba (`weighted_score=1`).
- **Hardcodes.** `response_type == 2/3` comparado como literal en varios servicios; buckets de monto-por-score quemados en `LenderSpecialGrantingService`. Inventario: `159906a:docs/codigo/LOGICA-QUEMADA.md`.

## Lo que NO está verificado
- La regla GENÉRICA del `DatacreditoRuleEvaluator`: el fail-closed está verificado (`:48`); el `whereNull(allied_branch_id)` exacto, no.
