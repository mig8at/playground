# Profiling · contexto
> **estado:** al día con main · El **perfilamiento rt=2** (CreditopX): CreditOp clasifica al usuario en una CATEGORÍA por sus datos, y esa categoría fija enganche/cupo/plazo.

<!-- Subcontexto de CreditopX. Seed inicial desde el simulador playground/flow (verificado, con archivo:línea); la superficie de código se linka en la fase de data. -->

## Qué es
Cómo CreditOp (in-platform, rt=2) **perfila** al usuario: con sus datos (ocupación, edad, salario declarado/verificado, continuidad, género) lo clasifica en una **categoría** de la entidad. La **categoría es la que fija enganche / cupo / plazo**. Un documento en lista negra = **rechazo directo**. (En rt=1 CreditOp NO perfila: pregunta a la API externa y respeta su respuesta; en rt=0 redirige.)

## Contenido
La categoría **no corre primero**. Orden de la consolidación rt=2 (verificado en flow/MAP.md §S5):
1. `group_rules` + **datacrédito rt=2** (AND, **EXCLUYEN**) — corren antes.
2. Perfilador datacrédito rt≠2 — solo **reordena** (no excluye).
3. **CATEGORÍA rt=2 + tramo por monto** — AL FINAL: **excluye** si no hay categoría o el cupo es insuficiente, y fija enganche/cupo. `have_ctopx` sobrevive hasta acá aunque falle una regla previa.

**Cupo** = `ceil( min(loan_limit − already_used, capacidad_de_pago, max_amount) / (1 − min_initial_fee/100) )`.

## Dónde mirar
- (application) `Services/lenders/ProfilingRulesService.php` · `RiskCentralValidationService.php` (perfilador datacrédito) · `LenderUserCategoryService.php:21 getLenderUserCategory` (:310 cupo) · `LenderRetrievalService.php:650 processRevolvingAndCreditopXLenders` (:701 categoría, :716 enganche = `category.min_initial_fee`).
- (legacy) `CreditopXQuotaController.php:268` (categoría) — endpoint autoritativo del cupo.

## Bitácora
- **2026-07-17** — Contexto sembrado desde el simulador `playground/flow` (PerfilamientoNode + MAP.md §S5, verificado por workflow). Superficie de código a linkar en la fase de data.

## Enlaces
- Padre: **CreditopX**. Simulador: `playground/flow` (nodo Perfilamiento). Mapa verificado: `playground/flow/MAP.md` §S5. Hermano: **Amount tiers**.
