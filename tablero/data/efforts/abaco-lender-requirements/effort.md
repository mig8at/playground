---
id: 13
title: "Ábaco alineado a lender_requirements — se retiran los modos"
stage: work
created: "2026-07-29T20:23:53-05:00"
context_nodes: [motai, kyc, ms-preapprovals]
---

ESTADO 2026-07-29: dos PRs MERGEADOS en `qa`. Falta llevarlo a `develop` y aplicar migraciones.

QUÉ SE HIZO
1) PR #1028 — fuente única del requisito de Ábaco.
   - `AbacoRequirementService` dejó de tener dos fuentes: se borró la "Fuente A" (modos) y queda solo
     `lenderRequirementRepository->isAbacoEnabled((int) $userRequest->lender_id)` sobre
     `lender_requirements.abaco_is_enabled` (tabla de Fercho).
   - Migración `2026_07_28_100000_backfill_abaco_is_enabled_from_lender_product`: upsert idempotente
     `abaco_is_enabled = 1` para `lenders.product IN ('renting','rto')`. Sin esto, el mismo deploy que
     mueve la decisión a la tabla APAGA Ábaco en silencio (MOTV1001 → MOTV1000).
   - Migración `2026_07_28_110000_drop_allied_modes_and_user_request_modes_tables`: drop de
     `allied_modes` y `user_request_modes`. DESTRUCTIVA — `down()` recrea el esquema, no los datos
     (3 filas de catálogo + 22 históricas, ninguna posterior a junio). Verificado: sin FKs entrantes.

2) PR #1032 — cupo sin buró para quien valida ingreso por Ábaco.
   - `Modules/Loans/App/Services/LenderUserCategoryService::evaluateEligibility`: si el usuario no tiene
     fila de datacrédito Y el lender tiene `abaco_is_enabled`, se salta el corte duro
     (`if (!$user->datacredito) return eligible:false`) y el cupo sale de
     `calculateAvailableAmountWithInitialFee($rule->category)` — la misma que usa el precedente
     venezolano/Magnocell, que no toca `$user->datacredito`.
   - Helper nuevo `lenderValidatesIncomeWithAbaco(int $lender_id)`: lee `lender_requirements`; si la
     query falla, `catch` → exige buró (fallback conservador). Sin hardcodes de ids (a diferencia del
     precedente, que tiene `lender_id === 84` y categoría 22 quemados).
   - Marca en el log: `users_category_log.category_rules_acceptance` trae `"skipped_bureau_abaco":true`.

POR QUÉ EL SEGUNDO PR ES PARTE DE ESTA MISMA TAREA
La des-motaización mató, junto con los modos, el bypass de buró que daba `isMotaiRenting`. Alinear a
`lender_requirements` obligaba a reponer ese comportamiento como CONFIG, no como excepción por comercio.

VALIDADO
- Local: usuario PEP sin buró (1828537, uReq 464552) → 169/170 con cupo 50.000.000; 168 y Credifamilia
  (sin Ábaco) siguen sin cupo; usuario CC con buró score 700 → 25.000.000 sin regresión.
- qa: `POST /api/loans/lender/available-quota` {user 1827761, lender 158} → approved, 20.000.000, cat 179.
  El mismo POST contra dev → `eligibility_criteria_not_met`, 0.

PENDIENTES (ninguno es código de estos PRs)
a) Las migraciones NO están aplicadas en dev/qa: `main-qa.yaml` solo actualiza el servicio ECS; las
   migraciones van en `run-migrations.yml`, manual (y que además parece roto: usa inputs no declarados
   y le faltan las barras de continuación del `docker run`). `allied_modes` y `user_request_modes`
   siguen existiendo allá. → findings F-77.
b) El fix de cupo está solo en `qa`, pero el MS de pre-approvals pregunta el cupo a
   `legacy-backend.inertia-develop` (rama develop) → el badge del marketplace sigue diciendo
   "Sin cupo disponible". Hay que llevar el cambio a `develop` o repuntar la config del MS. → F-78.
c) Hardcode `if ($ctopx_lender_id == 160)` en `LenderRetrievalService.php:720`: solo CrediPullman va al
   servicio de Loans (el parcheado); el resto de ctopx (158) va a la GEMELA de
   `Modules/Onboarding/App/Services/lenders/LenderUserCategoryService`, que no tiene el skip. De ahí
   salen plazo, `initial_fee_percentage`, `max_amount` y el filtro que elimina al lender. Decidir:
   parchear la gemela o unificar las dos clases.
d) F-76 sin decidir: `document_types` (PEP) lo sembró un backfill; las filas de
   `lenders_by_allied_branches` que se crean después nacen NULL. Opciones: heredar en
   `AlliedManagementService`, default de columna, o mover el dato a `lender_requirements`.

CONTEXTO ESCRITO
Nodo `motai` reescrito a v2 (commit b4c88da) + findings F-73…F-78 (commit 62077e5).
Ramas: `feature/abaco-fuente-unica` (#1028) y `feature/abaco-cupo-sin-buro` (#1032), ambas en `qa`.
