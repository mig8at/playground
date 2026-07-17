# Bróker · group
> **estado:** al día con main · El sombrero **BRÓKER** de CreditOp (rt=0/1/4): CreditOp origina y arma la solicitud, pero **un tercero decide y gestiona la cartera**. Agrupa Agregadores (rt=1) y Credifamilia (rt=4).

<!-- GROUP = el sombrero bróker/marketplace. Lo COMÚN a sus miembros (external decide/gestiona)
     vive acá; cada flujo hijo cuenta su delta. Contrapartida: el group CreditopX (operador rt=2/3). -->

## Qué es
Es uno de los **dos sombreros** de CreditOp. En el bróker, CreditOp **muestra la opción, arma la solicitud y hace el handoff**, pero **NO decide, NO desembolsa y NO lleva cobranza**: eso lo hace un **tercero** (la API del lender externo, o el propio lender tras radicar). CreditOp solo **espeja** el estado hasta el desembolso (Estado 11) y gana por originar. Cubre `response_type` **0** (UTM/referido), **1** (integración/agregadores) y **4** (Credifamilia híbrido). Contrapartida: el group **CreditopX** (operador in-platform rt=2/3), donde CreditOp sí decide/firma/cobra.

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | Un **tercero** (la API externa del lender, o el lender al radicar). CreditOp NO decide. |
| ¿Quién pone la plata / cobra? | El **lender externo** desembolsa y gestiona la cartera. CreditOp gana por originar. |
| ¿Cómo cierra? | **Handoff externo** (redirect / OTP / API / SOAP) → el lender desembolsa → CreditOp espeja el estado (webhook/polling) hasta el 11. |
| ¿Simulable E2E? | **No** de punta a punta (decide un tercero); a lo sumo se mockea el transporte HTTP. |

## Cómo funciona
El tronco compartido del sombrero bróker, sobre la entrada→OTP→datos→marketplace común:
1. **Marketplace** (`available-lenders.tsx` → `LenderRetrievalService::getLenders`): lista los lenders rt≠2; la **pre-aprobación** la resuelve un tercero (`PreApprovedLenderService` o el MS Go), y `lender-response.mapper.ts` mapea la respuesta externa a los campos de la card.
2. **Selección + handoff:** al elegir, `response_type` decide el canal de entrega (redirect / OTP / API multi-step / SOAP). CreditOp entrega el control al tercero.
3. **Espejo de estado:** CreditOp crea un `LenderTransaction` (order_id = id del crédito en el tercero) y sincroniza por webhook/polling **hasta el desembolso (Estado 11)**. A partir de ahí el rastro se detiene (guards frenan cualquier re-update): la cartera vive en el tercero.

## Estados y códigos
- **Estado 11** = desembolsado (el tercero desembolsó; CreditOp lo espeja). Es el terminal del rastro bróker — NO hay ciclo de vida del préstamo en CreditOp (a diferencia del group CreditopX).
- **`LenderTransaction.status_id`** = namespace propio del espejo (Pending/Disbursed/Failed/Aborted…), distinto de `user_request_statuses`.
- `response_types` (catálogo): 0 UTM · 1 Integración · (2 Creditop X = el OTRO group) · 4 Credifamilia. Catálogo global → raíz.

## Dónde mirar
- **Response type / backbone** (legacy + application): `app/Models/ResponseType.php`, `database/{migrations/..._create_response_types_table, seeders/ResponseTypesTableSeeder}.php` (0/1/2/4).
- **Listado + pre-aprobación** (legacy): `Modules/Onboarding/App/Services/lenders/{LenderRetrievalService,PreApprovedLenderService}.php`; (application) `app/Services/lenders/{LenderRetrievalService,PreApprovedLenderService}.php`, `PreapprovedRegistrationController`, `PreapprovedRequest`.
- **Espejo de estado** (legacy + application): `app/Models/{LenderTransaction,LenderTransactionStatus}.php`, `Modules/Loans/App/Repositories/LenderTransactionRepository.php`.
- **Marketplace (front):** `available-lenders.tsx`, `AvailableLenders.tsx`, `lender-response.mapper.ts`, `validate-preapproved-loan.uc.ts`.

## Frontera de simulación / harness
**Ningún miembro del bróker es inyectable de punta a punta** (decide un tercero) — es la contra-cara del group CreditopX (100% inyectable). Lo máximo: mockear el transporte HTTP del proveedor. El detalle por miembro (Bancolombia frontera dura, Prami exige Experian real, Credifamilia KYC V2 + SOAP externos) vive en cada nodo hijo. El mock local del MS de pre-aprobación (`frontend-e2e/mock-preapprovals`) permite avanzar el front sin proveedores.

## Miembros
- **Agregadores** (rt=1) — familia de 8+ lenders externos (Bancolombia, Sistecrédito, Welli, Meddipay, Prami, BdB, Compensar, Addi) + Corbeta batch; la API externa decide y gestiona.
- **Credifamilia** (rt=4) — híbrido: origina in-platform (KYC V2 + firma) pero **radica por SOAP** y de ahí lo gestiona el lender; único con polling de pre-aprobación exclusivo.
- *(rt=0 UTM/referido aún sin nodo propio.)*

## Gotchas / riesgos
- **El rastro termina en el 11/26**: no confundir con el group CreditopX, que sí tiene ciclo de vida post-11 (cartera/crons). En bróker no hay servicing en CreditOp.
- **Credifamilia es rt=4 pero el `application` viejo lo hardcodeaba a `response_type=1`** — ambigüedad histórica; no extrapolar a los agregadores rt=1 genuinos.
- **Pre-aprobación por dos vías en parallel-run** (switch legacy `PreApprovedLenderService` vs MS Go) — cuál gana depende del comercio.

## Bitácora
- **2026-07-17** — Group creado al reestructurar el árbol a jerarquía estricta (raíz→group→flujo→tarea). Reúne los flujos donde decide/gestiona un tercero (rt=0/1/4), como contrapartida del group operador CreditopX. Superficie compartida: 20 archivos (response_type + listing + LenderTransaction espejo + pre-aprobación + marketplace).

## Enlaces
- Backbone: `docs/CREDITOP.md` §1 (los dos sombreros) · §4 (response_type).
- Miembros: nodos **agregadores** (rt=1) y **credifamilia** (rt=4).
- Contrapartida: group **CreditopX** (operador rt=2/3).
- Memorias: `modelos-canales-flujos`, `synth-lender-type-boundary`, `pre-approvals-service`.
