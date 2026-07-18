# CreditopX · contexto
> **estado:** al día con main · Familia de prestamistas IN-PLATFORM (`response_type` **2**=consumo · **3**=rotativo): CreditOp decide con su motor LOCAL (reglas de grupo → datacrédito → categoría/cupo), fija enganche/cupo/plazo y cierra hasta el **Estado 11** — el único flujo inyectable/simulable.

## Qué es
CreditopX **no es un lender: es una FAMILIA** de prestamistas in-platform (`response_type == 2`, y `== 3` para cupo **rotativo**). Todos comparten UN motor: **CreditOp decide el crédito con reglas y datos LOCALES** (sin API externa de decisión → el único flujo 100% inyectable en pruebas), fija **enganche/cupo/plazo** con su motor de **categorías**, y cierra la solicitud in-platform hasta el **Estado 11** (autorizada/desembolso). Miembros (ids de negocio, ficha `159906a:docs/lenders/CREDITOPX.md`): **CrediPullman 77**, **Creditop X 37**, **Celupresto 96**, **SmartPay 152 dev / 160 prod**, **Motai 158**, Magnocréditos…

Este nodo cubre la **capa de DECISIÓN** (qué card aparece y con qué enganche/cupo). El recorrido punta a punta (OTP → ADO → firma OTP → 11), el buró y el servicing post-11 viven en nodos hermanos (**KYC** cede la adquisición de buró; **Formalization** el cierre; servicing post-11 en application, memoria `continuacion-credito-servicing`). Capa económica: el **comercio** pone capital y riesgo y es dueño del crédito; **CreditOp opera** (origina, firma, desembolsa, cobra) y gana **comisión por recaudo** (memoria `creditopx-modelo-comercio`).

Tipos (capacitación de producto, `159906a:docs/codigo/MECANICA-CREDITO.md`):

| Tipo | Ticket | Cupo | rt |
|---|---|---|---|
| **Rotativo** | < $1.000.000 | se **libera al pagar** capital (reutilizable) | 3 |
| **Consumo** | > $1.000.000 | **NO** se libera tras el pago | 2 |
| **Renting** (Motai) | — | device-lock IMEI (nodo `motai`) | 2 |

Mecánica financiera (informativa): amortización **francesa** (cuota FIJA, interés sobre **saldo diario**); cadena de tasas EA → MV `(1+EA)^(1/12)−1` → diaria `(1+MV)^(1/30)−1`; **cuota total = capital+interés + seguro de vida + fondo de garantía (FGA)**. El **FGA %** y el **enganche** son salidas de la categoría (`lender_users_categories.FGA` / `.min_initial_fee`; ver Subcontextos).

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
- **Gemelo migrado del listado** (legacy): `Modules/Onboarding/App/Http/Controllers/LenderListingController.php` (`lenders-v2`) → `Modules/Onboarding/App/Services/lenders/LenderListingService.php:53 getLenders` · `:298-310` sello (card sólo si `available_amount>0`) · `:356 no_more=false` (TODO). Categoría/cupo Ctopx: `Modules/Loans/App/Services/LenderUserCategoryService.php` (firma `getLenderUserCategory(int $userId, id)` — diverge de application, que pasa el objeto `$user`).
- **Endpoint autoritativo del cupo** (legacy): `Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php:66 getAvailableQuota` · `:239` datacrédito · `:268` categoría · `:326` `scoring_policy_fallback_blocked` · `:452/:468` cupo + tope por tramo.
- **Discriminadores** (legacy `database/seeders/ResponseTypesTableSeeder.php:24-35`; `app/Models/Lender.php:77 isSmartpay` vía `config('lenders.smartpay_lender_id')`; frontend `modules/loan-request-wizard/lenders-marketplace/src/lib/domain/constants/lender.constants.ts:37/57/68/78`).

## Gotchas / riesgos
- **`have_ctopx` NO es gate duro.** Un rt=2 que falla las reglas duras no cae a `false_lenders` si el comercio tiene `have_ctopx`; el corte definitivo es la **categoría**, no el datacrédito temprano.
- **rt=3 sin fila de catálogo.** El seeder solo siembra `response_type` 0/1/2; rt=3 (rotativo) existe en código y en el front (`CREDITOP_X_REVOLVING`) pero no como fila sembrada.
- **App↔legacy divergen (parallel-run).** `getLenders(UserRequest $userRequest)` (app) vs `getLenders(int $userRequestId, …)` (legacy); `getLenderUserCategory($user OBJETO)` vs `(int $userId)`; el gate `no_more` está **vivo en application** y **`= false` (TODO-a-quitar) en legacy**. Misma lógica, dos repos; application sigue siendo el default (memoria `migracion-application-a-legacy-estado`).
- **Riesgo chequeado dos veces.** Score/negativos/consultas/maduración corren en el datacrédito temprano Y de nuevo dentro de la categoría/cupo al final; la maduración usa comparadores divergentes entre motores (memoria `datacredito-rules-per-lender`).
- **Perfilamiento/orden SOLO en producción.** `getProfilingData`/`applyProfiling`/`usort` gated a `environment()==='production'` (:231/:244); en local/dev el ranking difiere. El ML `makePrediction` está corto-circuitado → siempre cae a matrices (memoria `orden-lenders-ml-desactivado`); rt=2/3 igual se fuerzan arriba (`weighted_score=1`).
- **Hardcodes.** `response_type == 2/3` comparado como literal en varios servicios; buckets de monto-por-score quemados en `LenderSpecialGrantingService`. Inventario: `159906a:docs/codigo/LOGICA-QUEMADA.md`.

## Preguntas abiertas
- [ ] ¿El id de "Autorizada" es exactamente **11** en BD? Varios callers lo asumen; no leído de la tabla fuente (needs-runtime).
- [ ] La regla GENÉRICA del `DatacreditoRuleEvaluator` (`allied_branch_id IS NULL`, fail-closed) proviene de la memoria `datacredito-rules-per-lender`; el fail-closed sí se verificó en código (`:48`), el `whereNull` exacto no en este pase.
- [ ] ¿SmartPay prod (160) tiene `response_type` fijado por algún seeder, o solo por `config('lenders.smartpay_lender_id')`? Negocio lo trata como rt=2 (nodo `smartpay`).

## Bitácora
- **2026-07-17** — Fase de data: superficie de código curada (14 archivos, app+legacy en parallel-run, 14/14 en el índice) + doc enriquecido desde `159906a:docs/codigo/FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md` + `MECANICA-CREDITO.md` + `docs/lenders/CREDITOPX.md`. Verificado en código: cupo enganche-inflado (`LenderUserCategoryService.php:47-50`), sello rt=2 por categoría (`LenderListingService.php:298-310`), seeder sin fila rt=3, `requiresInitialFee` siempre en rt=2, `have_ctopx` sobrevive (:308-327). Enriquecido con ids de la familia, tipos rt2/rt3, mecánica francesa+FGA, y las divergencias app↔legacy. Quitado el comentario de seed.
- **2026-07-17** — Contexto sembrado desde playground/flow (LendersNode + PerfilamientoNode/CategoryNode/TramoNode + MAP.md §S5 + DOCUMENTATION.md §2-3).

## Enlaces
- Padre: **Entities**. Subcontextos: **Profiling** · **Amount tiers**.
- Variantes de la familia (nodos hermanos): **Pullman** (rt=2 vanilla) · **SmartPay** (path IMEI) · **Motai** / **Motai-v2** (renting). Cierre/firma: **Formalization**. Buró/identidad: **KYC**. Contraste (bróker rt=0/1/4): **Aggregator** · **Redirect** · **MS-preapprovals**.
- Simulador: playground/flow (nodo "Perfilamiento" + tarjetas categoría/tramo), mapa `playground/flow/MAP.md` §S5.
- Fuente profunda: `159906a:docs/codigo/FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md` · `159906a:docs/codigo/MECANICA-CREDITO.md` · `159906a:docs/lenders/CREDITOPX.md`.
- Memorias: `creditopx-modelo-comercio` · `lender-listing-cascade` · `datacredito-rules-per-lender` · `synth-lender-type-boundary` · `migracion-application-a-legacy-estado` · `orden-lenders-ml-desactivado` · `continuacion-credito-servicing` · `modelos-canales-flujos`.
