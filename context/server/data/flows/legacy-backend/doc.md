# legacy-backend · contexto
> **estado:** al día con main · Reescritura Laravel Modules (strangler), cableada en parallel-run. Default solo en piezas ya migradas (OTP, cupo rt=2, KYC V2 Credifamilia); reconstruyó el núcleo de originación CreditopX.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Reescritura del backend en Laravel Modules (nwidart), organizada por dominio: `Modules/{Partner, Onboarding, Loans, Identity, ...}`. Es el **destino de la migración** bajo estrategia strangler: está cableado en *parallel-run* contra application (misma BD), pero **aún no es el default** salvo las piezas ya migradas. Reconstruyó 1:1 el núcleo de originación CreditopX (y algo más).

**Piezas donde legacy YA es el default (VIVO):** envío de OTP, el endpoint autoritativo de cupo rt=2 (`/available-quota`), y la KYC V2 de Credifamilia. El resto del flujo sigue corriendo en application; legacy tiene el gemelo pero no se invoca en prod todavía.

## Contenido
Piezas del flujo que reconstruyó legacy (MAP.md):

- **Alta de entidades (S1, gemelo Partner)** — módulo `Partner`: `LenderManagementService::createLender`, `AlliedManagementService::storeAllied`/`storeAlliedBranch`. Reconstruido 1:1 pero **no es el admin vivo**.
- **Copia de reglas (S2, gemelo)** — `AlliedManagementService` (delete/recreate + addNewRule/addNewLenderRule); cableado pero application es el que dispara.
- **Inicio del flujo (S3)** — `UserRequestService::createUserRequest` (estado 1) → `handleRegularRequest` → `updateUserRequestStatus` (estado 9); orquestador OTP en `OnboardingController`. El disparo del listado es `GET .../lenders-v2/{id}` (JSON síncrono).
- **Buró (S4)** — **legacy SÍ tiene cliente Experian completo** (`app/Actions/RiskCentrals/Experian.php`, OAuth2 + hdcplus ProductId 64), cableado en el onboarding de legacy. La distinción real es default(application) vs parallel-run(legacy), NO "solo application tiene cliente".
- **Cupo rt=2 (S5, AUTORITATIVO)** — `CreditopXQuotaController::getAvailableQuota` (`POST /api/loans/lender/available-quota`) es el endpoint ya migrado y autoritativo del cupo. Motor datacrédito nuevo: `DatacreditoRuleEvaluator` (regla genérica `allied_branch_id NULL`, maturation `<` estricto, **fail-closed**).
- **KYC V2 Credifamilia (solo legacy)** — Evidente + CrossCore + Jumio (greenfield en legacy).

## Dónde mirar
**legacy-backend** (índice maestro, MAP.md Apéndice C):
- **Partner** (`Modules/Partner/App/Services/`): `LenderManagementService.php:30` (createLender) · `AlliedManagementService.php` (alta + copia reglas :237/:257)
- **Onboarding** (`Modules/Onboarding/App/`): `Http/Controllers/{OnboardingController,LenderListingController,RegisterCellPhoneController}.php` · `Services/{UserRequestService, lenders/PreApprovedLenderService, lenders/RiskCentralValidationService}.php` · `routes/{api,webhooks}.php`
- **Loans** (`Modules/Loans/App/`): `Http/Controllers/Customer/CreditopXQuotaController.php:66` (`/available-quota` rt=2, autoritativo) · `Services/{DatacreditoRuleEvaluator, LenderUserCategoryService, LenderRuleEvaluator, ActiveCreditRuleEvaluator}.php` · `routes/api.php`
- **Identity** (`Modules/Identity/App/`): `Services/ValidationStatusService.php` · `Enums/IdentityValidationType.php`
- **Buró** (`app/Actions/RiskCentrals/`): `Experian.php` (cliente buró legacy, parallel-run; hdcplus ProductId 64 :519)
- **Credifamilia V2** (`app/Services/Lenders/CredifamiliaV2/`): `Evidente/EvidenteClient.php` · `CrossCore/{CrossCoreClient,JumioOnboardingService}.php`

## Gotchas / riesgos
- **Motor datacrédito distinto al viejo**: el nuevo `DatacreditoRuleEvaluator` usa `principals.negativeHistoricalLast12Months` (crudo) y maturation `<` estricto; el viejo (`RiskCentralValidationService`, rt≠2) usa `additional_info.negativeAccounts.total` (mapeado) y `<=`. **Miden cosas diferentes** del mismo reporte y difieren en el borde.
- **`category.rate` SÍ decide en legacy** (no es fantasma): pisa `creditLines->rate` (`Onboarding/LenderRetrievalService:764-767`) y el wizard la consume — solo application la ignora. Es **divergencia**, no muerto.
- **Riesgo de deriva** por parallel-run: dos copias sobre la misma BD (p.ej. `getLenderUserCategory($userId INT)` en legacy vs `($user OBJETO)` en application).
- `/available-quota` es **CUPO rt=2**, NO rt=1 (el rt=1 lo resuelve el MS Go).

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (MAP.md §0 tabla Repos + Apéndice C índice legacy + S1-S6, corrección S4 "legacy sí tiene cliente Experian").

## Enlaces
- Padre: **Architecture**. Mapa: playground/flow/MAP.md §0/S1-S6/Apéndice C. Simulador: playground/flow.
