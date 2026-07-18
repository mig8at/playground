# Amount tiers · contexto
> **estado:** al día con main · **Tramos por monto** (rt=2): según el monto pedido recortan los plazos y topean el cupo. El enganche NO cambia (lo fija la categoría).

<!-- Subcontexto de CreditopX. Seed inicial desde playground/flow (verificado); superficie de código a linkar después. -->

## Qué es
Las **franjas por monto** (`CreditopXConditionsByAmountByLender`): según el monto pedido, **recortan los plazos disponibles** y **topean el cupo**. NO tocan el enganche (lo fija la categoría). Monto **por debajo del primer tramo → rechazo**. Si la entidad no define tramos, el monto no restringe nada.

## Contenido
Corre **AL FINAL**, junto a la categoría (`processRevolvingAndCreditopXLenders`): recorta plazos (cuotas máximas, o cuotas *obligatorias* del tramo) + topea el cupo a `max_amount − 1`.
⚠ **Precedencia (verificado):** el **enganche SIEMPRE lo fija la CATEGORÍA** (`min_initial_fee`); el `initial_fee_percentage` del tramo es **código muerto** en rt=2 (nunca se lee).

## Dónde mirar
- (application) `Models/CreditopXConditionsByAmountByLender.php` (`initial_fee_percentage` = fantasma) · `LenderRetrievalService.php:737-761` (recorta plazos + topea cupo).
- (legacy) `CreditopXQuotaController.php:459` (tramo).

## Bitácora
- **2026-07-17** — Contexto sembrado desde `playground/flow` (TramoNode + MAP.md §S5, verificado). Superficie de código a linkar en la fase de data.

## Enlaces
- Padre: **CreditopX**. Simulador: `playground/flow` (nodo Tramos por monto). Mapa: `playground/flow/MAP.md` §S5. Hermano: **Profiling**.
