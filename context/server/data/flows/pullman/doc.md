# Pullman · contexto
> **estado:** al día con main · Flujo CrediPullman/Pullman (rt=2 in-platform "vanilla"): el caso base de la familia CreditopX, con hardcode allied_id==94 y la edad como gate.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
**CrediPullman/Pullman** es el flujo rt=2 CreditopX **"vanilla"**: el caso base de la familia in-platform, sin las particularidades de SmartPay (path IMEI) ni de Motai (renting/Ábaco). Sirve de referencia canónica de cómo se ofrece y decide un crédito cuando **CreditOp decide localmente** (motor de categorías), y de contraste con los agregadores rt=1 (decisión externa). En el simulador es el rt=2 que ejercita todo el cascade sin bifurcaciones especiales.

## Contenido
**Es el default de la calculadora CreditopX** (`CREDITOPX_CALCULADORA`): comisión 2%, cuota inicial 10%, IVA 19, fondo de garantías 0, monto máx 3M, resto en 0 — la base de la familia sobre la que un comercio overridea.

**Hardcode por id** (nodo *Comercio* / `merch.nombre`): el nombre del comercio ramifica lógica por id, y **allied_id==94 = Pullman** es uno de los hardcodes que "deberían ser columnas de config" (junto a Corbeta [24,209,210,211] y DENTIX 189).

**La edad es el gate de CrediPullman** (`buro.edad`): `users.age` — que **no viene del buró**, se calcula de `date_of_birth` — es el gate distintivo de Pullman (además de alimentar group rules y el min/max_age de la categoría).

**Flujo rt=2 completo** (el mismo cascade de §S5, sin excepciones): base sucursal → filtros duros (status/país) → group_rules + datacrédito rt=2 (AND, EXCLUYE) → perfilador rt≠2 (solo reordena) → ML/matrices → condiciones especiales → pre-aprobados rt=1 → orden → **CATEGORÍA + tramo por monto (corte final: fija enganche/cupo)**. El cupo se calcula local; formalización local (KYC → firma pagaré → cobro enganche Wompi → **Estado 11**).

## Dónde mirar
Todo el cascade rt=2 de MAP.md §S5 aplica a Pullman:
- **Orquestador** (application): `LenderRetrievalService.php:73 getLenders` → `:650 processRevolvingAndCreditopXLenders` (categoría + tramo, corte final) → `LenderUserCategoryService.php:21 getLenderUserCategory` (cálculo del cupo).
- **Reglas** (application): `LenderValidationService.php` (group_rules + datacrédito rt=2 inline).
- **Cupo autoritativo** (legacy): `Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php:66 getAvailableQuota` (`POST /api/loans/lender/available-quota`).
> El hardcode `allied_id==94` y los gates de negocio de CrediPullman (edad, datacrédito Experian del sello Estado 11) están señalados en flow pero su ubicación exacta en código se linka en la fase de data.

## Gotchas / riesgos
- **No hay nodo "Pullman" dedicado** en flow: se modela como el rt=2 canónico; sus particularidades reales son el hardcode por id 94 y el gate de edad.
- El **corte real rt=2 es la categoría**, no el datacrédito duro: un rt=2 que falla las reglas duras sobrevive hasta la categoría si el comercio tiene `have_ctopx`.
- El **perfilamiento (orden) solo corre en producción**; en local/dev el ranking difiere y el ML está corto-circuitado → cae a matrices internas.
- Los gates de negocio (`users.age`, datacrédito Experian encriptado) vienen del contexto de código/negocio, no de flow.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (fieldDocs `merch.nombre` hardcode allied_id==94, `buro.edad` gate de CrediPullman, `node.perfil`/`node.out` cascade rt=2, store `CREDITOPX_CALCULADORA`) + MAP.md §S5.

## Enlaces
- Padre: **Merchants**. Hermano: **SmartPay** (mismo núcleo rt=2, con path IMEI). Simulador: playground/flow (rt=2 canónico; nodos Perfilamiento, Tramos, Entidades disponibles). Mapa: playground/flow/MAP.md §S5.
