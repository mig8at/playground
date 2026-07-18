# application · contexto
> **estado:** al día con main · Monolito Laravel/Inertia (Aliados). VIVO / default: lo que corre en prod hoy. Aloja alta de entidades, panel admin, el mapper de Experian y el orquestador cascade rt=2.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Monolito Laravel/Inertia (Aliados), **el runtime por defecto** — el que efectivamente corre en producción hoy. Dominio en `app/` (Models, `Http/Controllers/{Admin,Customer}`, Services, Actions), rutas por audiencia. Aunque legacy sea "el destino de la migración", casi todo el flujo de originación sigue decidiéndose acá salvo las piezas ya migradas (OTP, cupo rt=2, KYC V2 Credifamilia).

Acá viven las tres cosas más pesadas del flujo: (1) el **alta de lender/comercio/sucursal** y la copia de reglas por sucursal (panel admin), (2) el **mapper de Experian** (dueño de la normalización del buró), y (3) el **orquestador cascade rt=2** (`LenderRetrievalService::getLenders`, 8 etapas).

## Contenido
Piezas del flujo que resuelve application (MAP.md S1-S6):

- **Alta de entidades (S1)** — cada entidad se crea con `Model::create` en transacción; **el alta NO cablea la relación lender↔sucursal** (eso pasa en el *update* de la sucursal, S2). Valores quemados: `allied_caterogy_id=1`, `new_screens=true`, `credit_line_id=1`.
- **Asociación + copia de reglas (S2)** — dos niveles: `lenders_by_allieds` (calculadora × comercio) y `lenders_by_allied_branches` (override × sucursal). Al habilitar un lender en una sucursal se **COPIAN** `group_rules`+`lender_rules` y `lender_datacredito_rules` por sucursal (~37k filas duplicadas).
- **Inicio del flujo (S3)** — entrada por hash de sucursal, captura de monto (el simulador NO crea la UR), delega OTP a legacy, crea la `user_request` (estado 1→9).
- **Burós/KYC (S4)** — `Experian.php` (OAuth2 + hdcplus) con el **mapper** que espeja a `risk_central_user_data` (cifrado APP_KEY), `user_summaries` y EAV 87/29/160/90. En local/dev el buró se **mockea** con `ExperianFixture`.
- **Consolidación rt=2 (S5)** — cascade de 8 etapas: base sucursal → filtros duros → group_rules + datacrédito rt=2 → perfilador rt≠2 → ML/matrices → condiciones especiales → pre-aprobados rt=1 → orden → **categoría + tramo (corte final)**.
- **Consolidación rt=1 (S6, path viejo)** — `PreApprovedLenderService` despacha por **id cableado a mano** (9,68,100,23/141/142/166,24,39,12,133) a cada Action externa.

## Dónde mirar
**application** (índice maestro, MAP.md Apéndice C):
- **Admin** (`app/Http/Controllers/Admin/`): `LenderController.php` · `AlliedController.php` · `AlliedAlliedBranchController.php` · `AlliedLenderController.php` · `AlliedEcommerceCredentialsController.php` · `LenderRulesController.php` · `LenderDatacreditoRulesController.php`
- **Customer** (`app/Http/Controllers/Customer/`): `RegisterCellPhoneController.php` · `SimulatorController.php` · `UserRequestController.php` · `ValidateOtpController.php` · `PersonalInfoController.php` · `ListLenderController.php` · `DatacreditoQueryByAlliedController.php`
- **Services** (`app/Services/lenders/`): `LenderRetrievalService.php:73` (orquestador cascade rt=2) · `LenderValidationService.php` · `ProfilingRulesService.php` · `RiskCentralValidationService.php` · `LenderUserCategoryService.php:21` (cálculo de cupo) · `PreApprovedLenderService.php:33` (rt=1)
- **Burós** (`app/Actions/RiskCentrals/`): `Experian.php` (buró + mapper) · `ExperianFixture.php` · `Tusdatos.php` · `Agildata.php` · `Mareigua.php` · `Ado.php`
- **Lenders externos** (`app/Actions/Lenders/`): `Welli.php` · `BancolombiaBnpl.php` · `BancolombiaConsumerLoan.php` · `Sistecredito.php` · `Meddipay.php` · `Prami.php` · `Credifamilia.php` · `BancoDeBogotaCeroPay.php`
- **Models** (`app/Models/`): `Lender.php` · `Allied.php` · `AlliedBranch.php` · `LendersByAllied.php` · `LendersByAlliedBranch.php` · `UserRequest.php` · `RiskCentralUserData.php` · `CreditopXConditionsByAmountByLender.php`

## Gotchas / riesgos
- **HARDCODE Credifamilia (id 24)**: el accessor `getResponseTypeAttribute` de `Lender.php` fuerza rt=1 ignorando la BD.
- **El mapper del buró vive acá**: si se cablea kyc-gateway (Go), la normalización de Experian quedaría sin dueño.
- **Perfilamiento SOLO en producción**: `getProfilingData`/`applyProfiling`/`usort` están gated a `environment()==='production'`; en local/dev el ranking difiere (y el ML `makePrediction` está corto-circuitado → siempre cae a matrices).
- **Buró mockeado en local/dev** (`ExperianFixture`, 212KB): score/additional_info de dev son sintéticos.
- Fantasmas: `lenders_by_allieds.min_amount` (fillable, nunca escrito), `CreditopXConditionsByAmountByLender.initial_fee_percentage` (nunca leído). Divergencia app↔legacy: `getLenderUserCategory($user OBJETO)` vs legacy `($userId INT)`.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (MAP.md §0 tabla Repos + Apéndice C índice application + S1-S6).

## Enlaces
- Padre: **Architecture**. Mapa: playground/flow/MAP.md §0/S1-S6/Apéndice C. Simulador: playground/flow.
