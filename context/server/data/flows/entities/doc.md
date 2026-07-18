# Entities · contexto
> **estado:** al día con main · Los prestamistas de CreditOp, partidos en 3 familias por su `response_type` — el eje que decide TODO el flujo de consolidación.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Las **entidades** = los prestamistas (tabla `lenders`). Se agrupan en 3 (más una rotativa) familias por su **`response_type` (rt)**, que es el eje sobre el que gira toda la consolidación de `getLenders`: define **quién decide el crédito** y, con eso, si el resultado es **inyectable/simulable localmente**. Es la contraparte de Merchants en el marketplace: la entidad presta, el comercio vende.

Dato base (DOCUMENTATION.md §0): la tabla `lenders` **NO tiene economía** — solo guarda `name, image, description, benefits, response_type, url, email, slug, sort, country_id, additional_data, status`. Toda la economía (montos, cuotas, tasa, enganche) vive en otras tablas (`credit_line_by_lenders`, `lenders_by_allieds`, `lender_users_categories`, …). "CreditopX / agregador / redirect" son solo el `response_type` de un lender.

## Contenido
El `response_type` y quién decide (MAP.md §0):

| rt | Familia | Quién decide el crédito | ¿Inyectable local? |
|---|---|---|---|
| **0** | Redirect (url_utm) | Nadie — redirige a la web del lender | n/a |
| **1** | Aggregator / integración | **API externa** del lender (Welli, Bancolombia, Meddipay…) | ❌ No (decisión fuera) |
| **2** | **CreditopX** in-platform | **CreditOp** (motor de categorías local) | ✅ Sí |
| **3** | Rotativo (revolving) | CreditOp (cupo rotativo local) | ✅ Sí |

- **`product_type` no existe** como columna: el "tipo de producto" (crédito / renting / renting con compra) se modela con `response_type` + `path_id` (relación `Path`, ej. path IMEI de SmartPay).
- El alta de un lender (`LenderController::store`) siempre crea una fila en `credit_line_by_lenders` (credit_line_id=1); solo si rt==2 crea además `CreditopXLenderConfiguration`.
- `response_type` **default = 1** (migración + legacy `createLender`): un lender sin rt explícito nace como *integración externa*.

## Subcontextos
- **CreditopX** — familia in-platform (rt=2/3): CreditOp decide, firma y desembolsa. A su vez tiene **Profiling** (categoría que fija enganche/cupo/plazo) y **Amount tiers** (tramos por monto).
- **Aggregator** — familia por integración/API (rt=1): la API externa del lender decide y gestiona la cartera.
- **Redirect** — familia por redirección (rt=0, UTM/referido): CreditOp deriva al sitio del lender; no decide ni gestiona.

## Dónde mirar
- **Alta de entidad** (application): `app/Http/Controllers/Admin/LenderController.php:73` (form) · `:196` store → `:219` `Lender::create` → `:235` `CreditLineByLender::create` → `:248` `CreditopXLenderConfiguration` (solo rt==2).
- **Modelo** (application): `app/Models/Lender.php` (tabla `lenders`; `getResponseTypeAttribute`) · migración `2023_04_20_202610_create_lenders_table.php`.
- **Gemelo legacy** (módulo Partner): `Modules/Partner/App/Http/Controllers/LenderController.php:154` → `Services/LenderManagementService.php:30 createLender` → `Repositories/LenderRepository.php:24`.

## Gotchas / riesgos
- **HARDCODE Credifamilia (id 24)**: el accessor `getResponseTypeAttribute` de `Lender.php` fuerza rt=1 en todo el flujo, ignorando la BD.
- `response_type` **default = 1**: un lender mal configurado se comporta como agregador externo.
- **Valores quemados** en el alta de comercio: `allied_caterogy_id=1`, `new_screens=true` (typo `caterogy` consolidado en BD).

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (LendersConfigNode + LendersNode + MAP.md §0/§S1 + DOCUMENTATION.md §0).

## Enlaces
- Raíz: **CreditOp**. Contraparte: **Merchants**. Simulador: playground/flow (nodo "Entidades del comercio" / "Entidades disponibles"). Mapa: playground/flow/MAP.md §0, §S1.
