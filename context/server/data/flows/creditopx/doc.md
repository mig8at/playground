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

## Antes de concluir
- **`have_ctopx` NO es gate duro.** Un rt=2 que falla las reglas duras no cae a `false_lenders` si el comercio tiene `have_ctopx`; el corte definitivo es la **categoría**, no el datacrédito temprano.
- **rt=3 sin fila de catálogo.** El seeder solo siembra `response_type` 0/1/2; rt=3 (rotativo) existe en código y en el front (`CREDITOP_X_REVOLVING`) pero no como fila sembrada.
- **App↔legacy divergen (parallel-run).** `getLenders(UserRequest $userRequest)` (app) vs `getLenders(int $userRequestId, …)` (legacy); `getLenderUserCategory($user OBJETO)` vs `(int $userId)`; el gate `no_more` está **vivo en application** y **`= false` (TODO-a-quitar) en legacy**. Misma lógica, dos repos; application sigue siendo el default (memoria `migracion-application-a-legacy-estado`).
- **Riesgo chequeado dos veces.** Score/negativos/consultas/maduración corren en el datacrédito temprano Y de nuevo dentro de la categoría/cupo al final; la maduración usa comparadores divergentes entre motores (memoria `datacredito-rules-per-lender`).
- **Perfilamiento/orden SOLO en producción.** `getProfilingData`/`applyProfiling`/`usort` gated a `environment()==='production'` (:231/:244); en local/dev el ranking difiere, y rt=2/3 igual se fuerzan arriba (`weighted_score=1`). El porqué de la lentitud del ML (timeout de 15 s por intento, el fallback que NO son las matrices): **→ `profiling` §perfilador ML** (F-104).
- **Hardcodes.** `response_type == 2/3` comparado como literal en varios servicios; buckets de monto-por-score quemados en `LenderSpecialGrantingService`. Inventario: `159906a:docs/codigo/LOGICA-QUEMADA.md`.

## ⚠ «No apareció» significa cosas distintas según el `response_type`

Fallar las reglas duras **no se ve igual** para todos, y de ahí que dos reportes idénticos del comercio
(«no le salió») tengan causas y diagnósticos distintos. Al cerrar la validación, el listado recorre los
rechazados y les pone `'Probabilidad muy baja'` — y **después** decide quién sobrevive
(`application/app/Services/lenders/LenderValidationService.php:372-385`, verificado):

| quién | qué ve el asesor |
|---|---|
| **rt=2** (CreditopX) | **nada**: `unset` de la lista. Desaparece sin mensaje ni traza en pantalla |
| **Banco de Bogotá 5 · UMA 135/136/137** | **«0% de probabilidad»**, con `sort=15` (al fondo) |
| **todos los demás** | «Probabilidad muy baja», `sort=4` |

Son **tres** conductas, no dos. Consecuencia para soporte: si la entidad que reclaman es CreditopX,
«no apareció» es el **comportamiento normal del rechazo**, no una falla del listado — y el motivo hay
que ir a buscarlo a los logs o al back-office, porque la pantalla del cliente no lo dice. Si es una de
las cuatro del medio, el «0%» tampoco es un bug: está cableado por id.

⚠ Y hay un paso ANTES: con `have_ctopx`, un rt=2 que falla **ni siquiera llega** a esa lista
(`:311-324` — solo entra a `false_lenders` `if (!$user_request->allied->have_ctopx)`), así que
sobrevive hasta el corte de categoría. Los dos mecanismos conviven y el segundo tapa al primero.

## El INGRESO no decide quién aparece — medido, no deducido

Corridas contra `local` el **2026-08-17** en Amoblando Pullman (sucursal `e9409aff`, 7 entidades
cableadas), pidiéndole de antemano a la lambda de mocks qué contestar el buró y variando **sólo** el
ingreso:

| ingreso dictado | entidades en el listado |
|---|---|
| 200.000 · 700.000 · 2.500.000 · 15.000.000 · 50.000.000 | **las mismas 6, siempre** (sólo cambia el orden) |

**250× entre los extremos y ni una entidad entra o sale.** Verificado que el dato llegó de verdad —
`employed: true`, `continuity_3_months: true` y `approximate_real_salary` igual a lo dictado, distinto
en cada caso— porque sin esa comprobación «no cambia» es indistinguible de «nunca llegó».

Es coherente con el cascade de arriba y lo afina: el ingreso **no participa de ningún corte**. Los
cortes son el **score de datacrédito** (punto 3) y la **categoría** (punto 8). Bajando el score a 300
en la misma sucursal, CrediPullman **sí** desaparece.

⚠ Alcance: **un comercio y la etapa del listado**. Que el ingreso no decida quién aparece no dice nada
sobre el cupo ni sobre las etapas siguientes. Se reproduce con
`make harness-caso CASOS='pullman@income=700000;pullman@income=15000000' PAR=1 LAMBDA=1` — y ⚠ pide
que los drivers fake estén apagados (**F-139**), o el buró contesta siempre lo mismo.

## ⚠ El ROTATIVO (rt=3) NO usa categorías — tiene su propio motor

**Es falso que rt=2 y rt=3 compartan «el motor de categorías»** (lo confirmaron política y código): el
rotativo otorga con multiplicador de riesgo, corte duro `≤3`, tope `max_rev_credit` y **plazo mínimo
CALCULADO** (por eso negocio parametriza 1/3/6 cuotas y al cliente le aparece solo 6 — no es bug de
config). El motor completo, sus dos implementaciones divergentes y por qué no se puede auditar por
Redash: **→ nodo `rotativo`** (el dueño). Acá solo importa la frontera: lo de este nodo describe rt=2.

## Un crédito activo BLOQUEA el cupo — y el corte es por ENTIDAD, no por comercio

Antes de calcular cupo, `POST lender/available-quota` corre **tres evaluadores en orden**
(`legacy-backend/Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php:189` · `:214` · `:239`): crédito activo → reglas del lender → datacrédito. El primero que falla
corta, así que el motivo que se ve es el primero, no todos.

**El primero es el que sorprende.** `ActiveCreditRuleEvaluator` rechaza con `active_credit_exists`
cuando la persona **ya tiene un crédito CreditopX vivo con ESA MISMA ENTIDAD** y le queda saldo de
capital. Tres precisiones que cambian el diagnóstico:

- **Es por `lender_id`, no por comercio ni por sucursal.** La consulta filtra
  `ur.user_id` + `ur.lender_id` + `l.response_type = 2` (`legacy-backend/Modules/Loans/App/Repositories/ActiveCreditRepository.php:11-19`). La creencia común —«un cliente no
  puede tener más de una solicitud por comercio»— no es lo que hace el código: **una persona puede tener
  créditos vivos en dos comercios a la vez** si los otorgó una entidad distinta, y **no** puede tener dos
  con la misma entidad aunque sean comercios diferentes.
- **«Activo» es la ÚLTIMA fila del ledger con `status = 1`**, una por solicitud
  (`MAX(rh.id)` agrupado por `user_request_id`) → ver `servicing` § El ledger.
- **Hay una tolerancia de $1.000**, escrita en el código y no en configuración
  (`legacy-backend/Modules/Loans/App/Services/ActiveCreditRuleEvaluator.php:12`): con saldo de capital **menor** a mil pesos el crédito no bloquea. Es la que evita que un
  crédito prácticamente pagado deje a alguien sin poder comprar de nuevo.

⚠ **Y sólo aplica a rt=2.** El rotativo (rt=3) sale antes por otro camino (`RevolvingCreditsService`,
`legacy-backend/Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php:159`) y los rt≠2 salen del método antes de llegar a los evaluadores (`:170`): en esos, «ya tiene un
crédito» lo decide —o no— la API del lender.

## Dónde se SACA una entidad del listado — el mapa completo

Una entidad puede desaparecer del listado en **nueve puntos distintos**, y ninguno deja un rechazo
visible. Este mapa se armó con el índice de código (2026-08-23) después de que catorce descartes
leyendo a mano no dieran con uno de ellos: **el problema no es que el corte esté escondido, es que hay
nueve.**

⚠ **Y antes de leer cualquiera de ellos, mirá qué inyecta el controlador de la ruta** — hay dos
`getLenders` y el que se lee no siempre es el que corre (**F-161**).

| dónde | qué saca |
|---|---|
| consulta base | `status != 1`, o fuera de las entidades de la sucursal |
| validación de reglas | **sólo** las rt=2 rechazadas; las demás siguen con «Probabilidad muy baja» |
| lista quemada | `[12, 23, 141, 142, 166]` — Prami y Welli, marcada *TEMPORAL* |
| pre-aprobación | **nueve `unset()` distintos**: aprobado, rechazado, en validación, fallo de radicación, ocupación inválida, timeout, excepción general, falta de credencial, error al consultar credencial |
| cupo rotativo (rt=3) | límite aprobado nulo o ≤ 0 |
| cupo CreditopX (rt=2) | cupo menor al mínimo financiable · categoría que no resuelve |
| otorgación especial | monto especial en 0 |
| ecommerce | Sistecrédito (id 9) sin `available` — por id literal |
| flujo de cupo confirmado | con `flow_id = 2` **sólo sobreviven las rt=0** |

⚠ **La pre-aprobación es el punto más denso y el menos visible:** varias de sus salidas ocurren
**antes de cualquier llamada HTTP** —falta de credencial, ocupación fuera del enum—, así que mirar si
el proveedor recibió la petición **no descarta** que la entidad haya muerto ahí.

## Contenido
La consolidación rt=2 corre en el orquestador `getLenders`. **Clave: la categoría NO va primero** — `group_rules`+datacrédito corren antes; la **categoría corre AL FINAL** y es la que fija enganche/cupo/plazo (y excluye si no hay categoría o el cupo no alcanza).

Orden real del cascade (application, la ruta **viva por defecto** en parallel-run):
1. **Base sucursal** (`lenders_by_allied_branches`) + gate `no_more`: si el usuario ya tiene una solicitud rt=2, excluye los rt=2 (`LenderRetrievalService.php:121`).
2. **Filtros duros** `status=1` / `country=1`.
3. **`group_rules` (AND) + datacrédito rt=2 inline** (`LenderValidationService.php:176-262`): score `>=` (:206) · negativos 12m `<=` (:219) · consultas 6m `<=` (:232) · maduración `>=` (:249). Un rt=2 que falla se **EXCLUYE** (se hace `unset` de `false_lenders`, :376) — **salvo `have_ctopx`** (sobrevive hasta la categoría, :308-327). El datacrédito rt≠2 solo **REORDENA**.
4. **ML/matrices** `weighted_score` — **solo en producción** (`application/app/Services/lenders/LenderRetrievalService.php:231` y `:244`); rt=2/3 forzados a `weighted_score=1` (arriba, `:586`/`:600` del MISMO archivo). ⚠ Ojo con el archivo: este punto **cambia de archivo** respecto del 3. Las sub-líneas sueltas (`:206`, `:219`…) del punto 3 continúan `LenderValidationService.php`, y acá los `:231/:244` iban sueltos también — se leían como del mismo archivo y son de **Retrieval**, no de **Validation**. Los dos viven en la misma carpeta y se diferencian en una palabra.
5. **Special granting** (buckets monto-por-score, casos DENTIX/especiales): `LenderSpecialGrantingService`.
6. Pre-aprobados rt=1 (nodo `aggregator` / `ms-preapprovals`).
7. Orden por probabilidad.
8. **CATEGORÍA rt=2 + TRAMO por monto** ◄ el corte final (`processRevolvingAndCreditopXLenders`, :650): fija enganche (`category->min_initial_fee`, :716), calcula cupo (:718) y **excluye** si no hay categoría o `available_amount < min_amount/min_initial_fee` (:727).

- **Enganche final = SIEMPRE la CATEGORÍA** (`min_initial_fee`); el `initial_fee_percentage` del comercio/tramo es **código muerto** en rt=2 (nunca se lee para enganche).
- **Cupo (el enganche INFLA lo financiable):** `available = ceil( min(loan_limit − already_used, capacidad_de_pago, max_amount) / (1 − min_initial_fee/100) )` (`LenderUserCategoryService.php:47-50` ruta simple · `:318/:334/:347-350` ruta por capacidad de pago = PV francesa del salario menos seguro de vida y cuota reportada en datacrédito).
- **Dos motores en paralelo (strangler):** application (`LenderRetrievalService::getLenders`, default vivo) y el gemelo migrado en legacy (`LenderListingService::getLenders` → marketplace `lenders-v2`). El **sello rt=2** en legacy: si la categoría no da cupo suficiente, la card **no aparece** — y eso pasa en el PADRE, `Modules/Onboarding/App/Services/lenders/LenderRetrievalService.php:776-779` (`available_amount < creditLines->min_amount`) y `:781-784` (el `else`: no hubo categoría). ⚠ **No confundir con `LenderListingService::stampCreditopXApproval` (`:304`)**, que suena a lo mismo y no lo es: sella el estado de pre-aprobación y su propio docblock aclara que **no ejecuta los gates** de crédito activo / reglas / datacrédito. Citarlo como «el sello que oculta la card» es un error que ya se cometió acá (venía de aceptar una corrección automática de `refs.py` sin leer qué función quedaba en la línea nueva: el ancla de texto se movió bien, pero a otra cosa).
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
- **El marcador de log del rechazo por cupo es `QUOTA_CHECK_REJECTED`** — y el mismo controller lo emite desde **más de una decena** de puntos de salida distintos (`:98`, `:119`, `:143`, `:175`, `:199`, y sigue hasta `:693`; contalos con grep, no confíes en una lista escrita). O sea que el marcador **solo no dice cuál compuerta cortó**: hay que mirar el payload. Sale a nivel `info` (a diferencia del `debug` de `CATEGORY_RULE_REJECTED` → ver **Profiling § El vocabulario del CÓDIGO**, que tiene la tabla completa de marcadores de categoría). El equivalente rt=3 es `REVOLVING_CREDIT_REJECTED` → ver **rotativo**.
- **Discriminadores** (legacy `database/seeders/ResponseTypesTableSeeder.php:24-35`; `app/Models/Lender.php:77 isSmartpay` vía `config('lenders.smartpay_lender_id')`; frontend `modules/loan-request-wizard/lenders-marketplace/src/lib/domain/constants/lender.constants.ts:37/57/68/78`).

## Lo que NO está verificado
- La regla GENÉRICA del `DatacreditoRuleEvaluator`: el fail-closed está verificado (`:48`); el `whereNull(allied_branch_id)` exacto, no.

## `can_check_preapproval` — el flag fail-closed que el front todavía no lee

Entró a `main` el **2026-08-10** (`3a6d59de`, Santiago). Es un booleano **por entidad** que el listado
**v2** agrega a cada card para decirle al front si debe disparar la consulta al microservicio de
pre-aprobados para ESA entidad. Su mensaje de commit lo resume: *«el front necesita saber si debe
disparar la consulta al microservicio de pre-aprobados para cada entidad, según las políticas de
datacrédito del lender»*.

**Nace en `false` y se siembra ANTES de cualquier bifurcación** (`LenderListingService`, sobre la
colección recién traída y antes del branch de `$hasGroupRules`), porque las dos ramas derivan de esas
mismas instancias: así ninguna entidad puede llegar a la respuesta sin el campo. Al final del pipeline
hay una **red idempotente** que cubre las instancias que no pasaron por la siembra — hoy sólo el
Magnocell 84.

**Lo sube a `true` un solo lugar**: `RiskCentralValidationService`, con
`$scorePassed && $negativeAccountsPassed && $maturationPassed` — las tres validaciones de datacrédito
(score, cuentas negativas, antigüedad en el sector financiero). Es **fail-closed de verdad**: una
validación que no se pudo correr *por dato ausente del cliente* NO cuenta como pasada.

Tres cosas que cambian cómo se lee este campo:

- **NO filtra.** No participa de `$remove_lender`: la entidad sigue apareciendo en el listado. Sólo
  dice si se puede consultar pre-aprobación.
- **Nunca se evalúa si las políticas duras ya hundieron la card.** El bloque entero está adentro del
  `if` que exige que `probability` no sea `Probabilidad muy baja` ni `0% de probabilidad` — o sea que
  para esas entidades el flag se queda en el `false` de la siembra. Se conecta con la asimetría de
  probabilidades de más arriba en este mismo nodo.
- ⚠ **Su significado es exclusivo de lenders-v2.** `RiskCentralValidationService` es compartido con el
  listado **v1** (`LenderRetrievalService`), así que el atributo también aparece allá — pero v1
  resuelve sus pre-aprobados por otro camino (`validatePreApproveLender`) y **debe ignorarlo**. Leer
  este campo en una respuesta de v1 lleva a la conclusión equivocada.

⚠ **El front todavía NO lo consume.** Medido el 2026-08-16 sobre `main` de `frontend-monorepo`: cero
apariciones, en snake_case y en camelCase. Es una entrega backend-first esperando su mitad — si estás
depurando por qué el front no cambia de comportamiento, la respuesta es que aún no lo lee, no que el
backend lo mande mal. Su contrato sí está fijado por
`Modules/Onboarding/tests/Unit/LenderListingCanCheckPreapprovalTest.php`.
