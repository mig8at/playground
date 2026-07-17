# CrediPullman · flujo
> **estado:** al día con main · El rt=2 **vanilla** (lender id 77): el caso base "puro" del group CreditopX, sin variante. Su único delta es el **gate de group rules (`users.age`)** + su regla de datacrédito.

<!-- Flujo MAGRO: hereda TODO el tronco del group CreditopX (entrada→OTP→datos→marketplace→ADO→firma→Estado 11). NO lo repite: lo enlaza. Acá va solo lo que distingue a CrediPullman del resto de la familia. -->

## Qué es
CrediPullman (lender **77**) es el CreditopX rt=2 **sin variante**: no tiene path IMEI (SmartPay) ni modo/Ábaco (Motai). Es el flujo base "de referencia" del group CreditopX — sirve para ver la familia en su forma pura y es **el más usado en pruebas E2E** (decide 100% local, sin sistemas externos que no sean ADO/AML mockeables). Todo su recorrido = el **tronco del group CreditopX**; su parte distintiva es solo **cómo se gatea** (qué usuario califica).

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **CreditOp** (motor rt=2 del group): group rules → datacrédito → categoría/cupo. |
| ¿Quién pone la plata / cobra? | El comercio (Pullman) pone capital/riesgo; CreditOp opera y cobra comisión. |
| ¿Cómo cierra? | Igual que el tronco: `verify-otp` → `authorize` → **Estado 11**. |
| ¿Simulable E2E? | **Sí, es el caso canónico** — synth con `users.age` en rango + fila Experian con score sobre el umbral. |

## Cómo funciona
**Idéntico al tronco del group CreditopX** (ver ese nodo): entrada → OTP → datos → marketplace (`getLenders` sella rt=2 por categoría) → confirm/standBy → ADO → polling+Echo → plan/firma OTP → `authorize` → Estado 11. **CrediPullman no agrega ni salta pasos.** Lo único propio es el **gate de admisión** (abajo).

## Estados y códigos
Los del tronco del group CreditopX (Estado 3 selección · intermedio "Autorizado pendiente desembolso" · **Estado 11** desembolsado). Sin estados propios.

## Dónde mirar
Solo lo distintivo (el gate); el resto vive en el group CreditopX.
- **Gate group rules (`users.age`)** (legacy): `Modules/Risk/App/Http/Controllers/Admin/GroupRuleController.php`, `app/Models/GroupRule.php`; (application) `app/Http/Controllers/Admin/GroupRuleController.php`, `app/Models/GroupRule.php`, migración `create_group_rules_table`.
- **Datacrédito + categoría (la decisión rt=2)** (legacy): `DatacreditoRuleEvaluator.php`, `LenderUserCategoryService.php`, `LenderSpecialGrantingService.php`, `LenderUserCategoryScoringPolicyRuleRepository.php`, `LenderDatacreditoRulesRepository.php`, models `LenderUserCategoryScoringPolicyRule`/`LenderDatacreditoRule` + tests `DatacreditoRuleEvaluatorTest`/`LenderUserCategoryServiceMatchedByRuleTest`.

## Frontera de simulación / harness
**Es el flujo de referencia para el harness rt=2** (100% inyectable, ver group CreditopX). Los 2 gates de CrediPullman (memoria `synth-credipullman-gates`): **(1) `users.age`** — la inclusión vía group rules exige edad en rango; **(2) datacrédito Experian** — la regla del motor nuevo (genérica, `allied_branch_id IS NULL`, fail-closed) exige score sobre el umbral + sin negativos recientes. Con ambos + categoría con cupo, el synth llega a Estado 11. `backend-mcp synth` inyecta el datacrédito encriptado; `branchdiag`/`grouprules`/`rules` diagnostican por qué "no sale".

## Datos de prueba / usuario que pasa
Receta del synth que **aprueba** en CrediPullman: `users.age` dentro del rango de las group rules + fila Experian (encriptada con `APP_KEY`) con score ≥ umbral del datacrédito rule + sin negativos recientes + categoría (`lender_users_categories`) con `available_amount > 0` ≥ monto solicitado. Falla por defecto si la edad cae fuera del rango, el score no llega, o no hay categoría (fail-closed).

## Gotchas / riesgos
- CrediPullman **casi no tiene superficie propia**: es el tronco del group + config (el lender 77 es una fila runtime, sin seeder). Por eso su map.json son los archivos del **gate**, no un flujo aparte.
- Los archivos de gate se **comparten** con el group CreditopX y con el nodo `motor` conceptual — es esperable (el flujo es "vanilla").
- La copia de reglas/datacrédito es **por sucursal** (memoria `reglas-copia-por-sucursal`): el gate real que evalúa CrediPullman es la COPIA de la sucursal, no la plantilla.

## Diferencias vs otros flujos
- **vs SmartPay:** SmartPay agrega path IMEI + device-lock + skip-AML; CrediPullman no.
- **vs Motai:** Motai agrega modo + Ábaco; CrediPullman no.
- **vs el group CreditopX:** el group ES el tronco compartido; CrediPullman es su instancia vanilla (id 77) con el gate `users.age`.

## Bitácora
- **2026-07-17** — Nodo creado al reestructurar a jerarquía estricta (flujo bajo el group CreditopX). Superficie: 15 archivos (el gate group-rules + datacrédito + categoría), 15/15 resuelven. Doc magro a propósito: el recorrido vive en el group.

## Enlaces
- Tronco: group **CreditopX**. Fuente: `docs/codigo/FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md` · `docs/codigo/REGLAS-POR-COMERCIO-Y-LENDER.md` (gate por comercio/lender).
- Memorias: `synth-credipullman-gates` (los 2 gates + diagnósticos) · `datacredito-rules-per-lender` · `lender-listing-cascade` · `reglas-copia-por-sucursal`.
