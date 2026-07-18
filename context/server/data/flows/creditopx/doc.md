# CreditopX · contexto
> **estado:** al día con main · Familia de prestamistas IN-PLATFORM (rt=2/3): CreditOp decide con su motor de categorías local, firma y desembolsa — el único caso inyectable/simulable.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Familia de prestamistas IN-PLATFORM (`response_type` **2** = CreditopX, **3** = rotativo/revolving). Acá **CreditOp decide** el crédito con su propio motor de categorías, y cierra la solicitud in-platform hasta el **Estado 11** (autorizada/desembolso). Es el producto insignia y el **único inyectable localmente** (hay estado en BD que fuerza el veredicto), a diferencia de rt=1/rt=0. rt=3 (rotativo) usa la misma cadena de formalización que rt=2.

## Contenido
La consolidación rt=2 la arma `LenderRetrievalService::getLenders` en **8 etapas**; lo clave (MAP.md §S5): la **categoría (perfilamiento) NO va primero** — `group_rules`+datacrédito corren antes, y la **categoría corre AL FINAL** y es la que fija enganche/cupo/plazo.

Orden real del cascade:
1. Base sucursal (`lenders_by_allied_branches`) + gate `no_more` (rt=2 ya usado → excluye).
2. Filtros DUROS `status=1` / `country=1`.
3. `group_rules` (AND) + **datacrédito rt=2 inline** (score>= · negativos<= · consultas<= · maduración>= · tramo amount) → rt=2 que falla se **EXCLUYE** …salvo `have_ctopx` (sobrevive hasta la categoría).
   - 3b. datacrédito rt≠2 → solo REORDENA (no toca rt=2).
4. ML/matrices `weighted_score` (solo en producción; rt=2/3 forzados a 1).
5. Condiciones especiales (DENTIX, Credifamilia).
6. Pre-aprobados rt=1 (ver Aggregator).
7. Orden por probabilidad.
8. **CATEGORÍA rt=2 + TRAMO por monto** ◄ el corte final: fija enganche (= `category.min_initial_fee`), calcula cupo y EXCLUYE si no hay categoría / cupo insuficiente.

- **Enganche final = SIEMPRE la CATEGORÍA** (`min_initial_fee`); el `initial_fee_percentage` del comercio/tramo es código muerto en rt=2.
- **Cupo** (espejo `LenderUserCategoryService`): `available = ceil( min(loan_limit−already_used, capacidad_de_pago, max_amount) / (1 − min_initial_fee/100) )` — el enganche INFLA lo financiable.
- **Endpoint autoritativo del cupo** (ya migrado a legacy): `POST /api/loans/lender/available-quota` → `CreditopXQuotaController::getAvailableQuota`; re-decide en el punto de venta.

## Subcontextos
- **Profiling** — perfilamiento rt=2: la categoría (`lender_users_categories` + `lender_users_category_rules`) en la que cae el usuario fija enganche/cupo/plazo. El corte final del cascade.
- **Amount tiers** — tramos por monto (`creditop_x_conditions_by_amount_by_lender`): según el monto pedido, recortan plazos (`max_fee`/`mandatory`) y topean el cupo. NO tocan el enganche.

## Dónde mirar
- **Orquestador** (application): `app/Services/lenders/LenderRetrievalService.php:73 getLenders` · `:650 processRevolvingAndCreditopXLenders` (categoría + tramo) · `:716` enganche = `category->min_initial_fee`.
- **Reglas duras + datacrédito rt=2** (application): `app/Services/lenders/LenderValidationService.php:53/196-262/289-327/372-384`.
- **Cálculo del cupo** (application): `app/Services/lenders/LenderUserCategoryService.php:21 getLenderUserCategory` · `:310-351`.
- **Endpoint autoritativo** (legacy): `Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php:66 getAvailableQuota` · datacrédito `:239` · categoría `:268` · cupo `:519`.

## Gotchas / riesgos
- **`have_ctopx`**: un rt=2 que falla las reglas duras NO cae a `false_lenders` si el comercio tiene `have_ctopx`; el corte definitivo es la **categoría**, no el datacrédito duro.
- **Perfilamiento SOLO en producción**: `getProfilingData`/`applyProfiling`/`usort` gated a `environment()==='production'`; en local/dev el ranking difiere. Además el ML `makePrediction` está corto-circuitado → siempre cae a matrices.
- **Riesgo chequeado dos veces**: score/negativos/consultas/maduración corren en el datacrédito temprano Y dentro de la categoría al final (ambas exclusión dura rt=2), con comparadores de maduración OPUESTOS entre motores (`<=` viejo vs `<` nuevo).
- **Divergencia app↔legacy**: `getLenderUserCategory($user OBJETO, id)` vs legacy `($userId INT, id)` — misma lógica, dos repos.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (LendersNode + PerfilamientoNode/CategoryNode/TramoNode + MAP.md §S5 + DOCUMENTATION.md §2-3).

## Enlaces
- Padre: **Entities**. Subcontextos: **Profiling**, **Amount tiers**. Simulador: playground/flow (nodo "Perfilamiento" + tarjetas de categoría/tramo). Mapa: playground/flow/MAP.md §S5.
