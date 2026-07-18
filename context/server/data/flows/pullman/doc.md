# Pullman · contexto
> **estado:** al día con main · Flujo rt=2 CreditopX "vanilla" del comercio **Amoblando Pullman** (allied 94) con el lender **CrediPullman (77)**: el caso base de la familia in-platform, más 5 hardcodes reales por `allied_id==94` (monto mínimo 600k, salto de pre-aprobados, Experian `aciertaQuanto`).

## Qué es
**CrediPullman** es el flujo rt=2 CreditopX **"vanilla"**: el caso base de la familia in-platform, sin las particularidades de SmartPay (path IMEI) ni de Motai (renting/Ábaco). Es la referencia canónica de cómo se ofrece y decide un crédito cuando **CreditOp decide localmente** (motor de categorías) y el más usado en pruebas E2E (100% inyectable, ver **CreditopX**). Dos identidades que no hay que confundir: el **comercio = allied 94 "Amoblando Pullman"** (lo que el código hardcodea) y el **lender = CrediPullman #77** (rt=2, del dump de BD). Ojo: existe además un **lender 94 "Mediarte x 0%"** — otro namespace, nada que ver con el allied 94.

## Contenido
**Capa económica** (matiza el "capital propio"): el comercio pone capital y riesgo; CreditOp **opera** (originación + cobranza + servicing) y gana **comisión por recaudo**. La mecánica in-platform (cascade de 8 etapas, categoría, cupo, Estado 11) es la del group **CreditopX** — acá va solo lo que distingue a Pullman.

**El gate de admisión de CrediPullman** (3 capas; el corte duro es la categoría, no la edad):
- **Group rules del allied 94** (868 reglas): ingreso `>=0 / >=1M / >=1.3M`, edad `<=68/69/74/82` y `>=18/21`, reportado `no` / `no|si`. Para un rt=2 con `have_ctopx` estas reglas **CLASIFICAN, no excluyen** — un ingreso o una edad fuera de rango igual se ofrece.
- **Datacrédito genérico** (regla `allied_branch_id IS NULL`): score **>= 400** + fail-closed si falta la fila Experian. El 400 es tan laxo que un sintético `>=400` nunca rechaza → el datacrédito es gate secundario. (Hay además 111 reglas por-sucursal score 400, **inertes** en el cupo: el motor nuevo solo lee la genérica.)
- **Categoría cat14 = el corte duro del cupo**: edad **0-78**, neg≤3, mora≤1, cons≤1000. Es el tier laxo (piso 400) de los 3 de #77; los tiers estrictos cat12/cat13 sí gatean consultas (≤20 / ≤10). El tope de edad del cupo (**≤78**) es distinto del group rule (≤69).

**Los 5 hardcodes reales por `allied_id==94`** (lo verdaderamente distintivo de Pullman — deberían ser columnas de config, como Corbeta y DENTIX/DFS allied 189):
1. **Monto mínimo 600.000**: `amount <= 600000` ⇒ *no viable* (`pullman_min_amount`).
2. **Salta la consulta de pre-aprobados**: Pullman consulta Experian igual, así que la pre-aprobación externa se omite (se ignoraría de todos modos).
3. **Experian `aciertaQuanto`** (Acierta+Quanto) en vez de `quanto` — su método de buró propio (comparte el branch "Quanto" con DFS/DENTIX 189, que sí usa `quanto`).
4. **Meddipay desaparece según la hora** (`available_until` + allied 94 ⇒ `unset` de la card).
5. **SMS propio** "¡Solicitud con Credipullman!".

Además, allied 94 está en `DatacreditoFrequency` (`every=1`) → el gate datacrédito legacy del listado sí corre para Pullman.

**Cierre**: idéntico al tronco CreditopX — KYC/ADO → firma pagaré → cobro enganche (Wompi) → **Estado 11**. El enganche real sale de `category.min_initial_fee` (ver CreditopX), no del 10% que modela el simulador (`CREDITOPX_CALCULADORA`).

## Dónde mirar
**Hardcodes por `allied_id==94`** (lo propio de Pullman):
- **Monto mínimo** (legacy): `Modules/Risk/App/Http/Controllers/DatacreditoQueryByAlliedController.php:86` `case 94:` → `:90` `amount <= 600000` → `:92` `pullman_min_amount`.
- **Salto pre-aprobados + Experian aciertaQuanto** (legacy): `Modules/Onboarding/App/Services/OnboardingService.php:593-595` (`!$isPullman` neutraliza `consultPreApproveLender`) · `:760,:769` (`$experianMethod = $isPullman ? 'aciertaQuanto' : 'quanto'`).
- **Meddipay por hora** (application): `app/Services/lenders/PreApprovedLenderService.php:536` (`allied_id == 94` ⇒ `unset`).
- **SMS Credipullman** (application): `app/Services/lenders/CreditopXNotificationService.php:48`.

**El gate (lender 77)**:
- **rt=2 clasifica-no-excluye** (application): `app/Services/lenders/LenderValidationService.php:176` (`response_type == 2`) · `:311-324` (`have_ctopx` no manda el rt=2 fallido a `false_lenders`) · `:376-377` (`unset` de todo rt=2 de la lista de baja).
- **Datacrédito genérico 400** (legacy): `Modules/Loans/App/Services/DatacreditoRuleEvaluator.php:80` (`score >= ruleScore`) · `:37` (fail-closed `no_datacredito_data`); regla genérica en `Modules/Loans/App/Repositories/LenderDatacreditoRulesRepository.php:25` (`whereNull('allied_branch_id')`).
- **Categoría → cupo** (legacy): `Modules/Loans/App/Services/LenderUserCategoryService.php:54 getLenderUserCategory` · `:79/:105` (primer tier que pasa, ordenado por `lender_users_category_id`).
- **Cupo autoritativo** (legacy): `Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php:66 getAvailableQuota` · `:268` categoría · `:331` `scoring_policy_fallback_blocked`.

> El cascade completo de 8 etapas (base sucursal → filtros duros → group_rules → datacrédito → ML → especiales → pre-aprobados → categoría) vive en el nodo **CreditopX**; acá solo lo específico de Pullman.

## Gotchas / riesgos
- **Tres ids que se confunden**: comercio **allied 94** (Amoblando Pullman, en código), lender **77** (CrediPullman, en BD) y lender **94** (Mediarte x 0%, otro namespace).
- **La edad NO es el corte duro** (corrige el doc previo): el group rule de edad **clasifica** (rt=2 + `have_ctopx`); quien corta es la **categoría cat14** (edad 0-78). Y hay dos topes de edad distintos: group rule ≤69 vs cupo ≤78.
- **El datacrédito genérico 400 es inocuo** (corrige MEMORY "no hay fila para #77"): **sí** hay fila (dc-gen 400 + 111 por-sucursal), pero 400 es tan laxo que nunca rechaza; las por-sucursal quedan **inertes** en el cupo (el motor nuevo lee solo la genérica).
- **`have_ctopx` sin confirmar para allied 94**: el dump muestra allied 94 **sin** `have_ctopx=1` (§9), pero el path rt=2 asume `have_ctopx` para no excluir → ¿otra señal, o §9 del dump truncada? (pregunta abierta).
- **La regla de edad del `datacredito_trigger` de sucursal es un no-op**: está escrita `age <= min_age && age >= max_age`, solo dispara con rango invertido (`min >= max`).
- **Orden solo en producción**: el perfilamiento (ranking) está gated a `production` y el ML está corto-circuitado → en local/dev el orden difiere y cae a matrices internas.

## Bitácora
- **2026-07-17** — Fase de data: superficie de código curada + doc enriquecido desde `git 159906a:docs/lenders/CREDITOPX.md` y `docs/codigo/REGLAS-POR-COMERCIO-Y-LENDER.md`, verificado contra los repos (5 hardcodes reales por `allied_id==94`, lender 77 vs allied 94, categoría cat14, datacrédito genérico 400). 13 archivos, 13/13 resuelven.
- **2026-07-17** — Contexto sembrado desde playground/flow (fieldDocs `merch.nombre` hardcode allied_id==94, `buro.edad`, cascade rt=2, store `CREDITOPX_CALCULADORA`) + MAP.md §S5.

## Enlaces
- Padre: **Merchants**. Hermanos: **SmartPay** (mismo núcleo rt=2 + path IMEI), **MotaiX** (+ modo/Ábaco). Mecanismo: **CreditopX** (cascade de 8 etapas + subcontextos **Profiling** y **Amount tiers**).
- Memorias: `synth-credipullman-gates` (los 2 gates + diagnósticos) · `datacredito-rules-per-lender` · `reglas-comercio-lender-map` · `lender-listing-cascade` · `reglas-copia-por-sucursal`.
- Fuente profunda: `git 159906a:docs/lenders/CREDITOPX.md` · `git 159906a:docs/codigo/REGLAS-POR-COMERCIO-Y-LENDER.md`.
