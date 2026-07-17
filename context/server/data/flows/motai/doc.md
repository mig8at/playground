# Motai · flujo
> **estado:** al día con main (Motai **v1**, como ES hoy) · Originación del comercio Motai (allied 158) con su lender MotaiX rt=2, cuyo rasgo distintivo es el **MODO del comercio** + **Ábaco** (ingresos gig en renting).

<!-- Este es el flujo v1 tal como vive en main. La des-motaización (el deber-ser) es la TAREA motai-v2 que cuelga de acá. -->

## Qué es
Motai es un **COMERCIO** (allied 158) con su lender **MotaiX** (id 158, `response_type=2`, CreditopX in-platform; `isMotai = MOTAI_LENDER_IDS.includes(id)`, `MOTAI_LENDER_IDS=[158]`). Tiene **3 MODOS** (compra `motai` / renting `motai-renting` / alquiler `alquiler`) persistidos en `allied_modes` / `user_request_modes`. Lo DISTINTIVO frente al tronco común es el **MODO** + **ÁBACO** (scraping de ingresos gig, SOLO en renting vía `isAbacoRequired`, que salta Experian/buró).

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **CreditOp (local)** — rt=2 in-platform: cupo/score se sellan en legacy; group rules + datacrédito + categoría clasifican |
| ¿Quién pone la plata / cobra? | El **COMERCIO Motai** pone capital/mercadería y es dueño del riesgo; CreditOp opera y cobra comisión (marca blanca CreditopX) |
| ¿Cómo cierra? | Cierre CreditopX estándar (OTP + pagaré) → **Estado 11** → callback de servicing `motai/update-status` |
| ¿Simulable E2E? | **Sí** — rt=2 in-platform es inyectable; el gate Ábaco es mock en local |

## Cómo funciona
1. **Alta (application).** El admin da de ALTA el lender 158 rt=2 (fila runtime, SIN seeder): crea el lender + su `CreditopXLenderConfiguration`, lo adjunta al comercio/sucursal y **copia reglas + datacrédito por sucursal**.
2. **Onboarding.** monto+teléfono → **OTP** (transporta `isMotaiRenting`) → datos personales/laborales (con el bypass MOTAI/PEP: info laboral dummy, la validación de ingresos se hace luego vía Ábaco) + **selección del MODO**.
3. **Gate Ábaco** (solo renting). `platforms` → init gig-economy → login+OTP → results (mock en local); persiste en `UserSummary.abaco` — **informativo, no cableado hoy**.
4. **Marketplace.** `lenders-v2` → selección del lender 158 (branch `isMotai` en `LenderCardContent`); persiste `lender_id` + `user_request_status_id 3`.
5. **Cierre CreditopX estándar.** confirm → biométrica ADO + AML TusDatos → fecha primer pago → plan de cuotas → firma pagaré + OTP → authorize → **Estado 11** (`LoanAuthorizationService::authorize`; estados DB-driven en `user_request_statuses`, el 11 hardcodeado) → callback `motai/update-status`.

## Dónde mirar
- **Alta / config del lender** (application): `Admin/Allied*`, `CreditopXLenderConfiguration`, copia de reglas/datacrédito por sucursal.
- **Onboarding + selección de modo** (front): pantalla `merchant-mode`, OTP con `isMotaiRenting`, `LenderCardContent` (branch `isMotai`).
- **Ábaco** (front): módulo gig-economy (`platforms` → init → login/OTP → results), persistencia `UserSummary.abaco`.
- **Cierre CreditopX** (legacy): `LoanAuthorizationService::authorize` (Estado 11), pagaré, biométrica ADO, AML TusDatos.
- **Brechas de Alta/MVP2 que este flujo toca** (legacy): subsistema legal/TyC hoy acoplado a Credifamilia (`LegalService` + `AcceptedTermsAndConditionsS3Repository` + `SignedTermsAndConditionsMail` + enum document-type + otp-resend); **motor de viabilidad que Motai SALTEA** (`DatacreditoQueryByAlliedController::userViability`, base de la política R1–R8 de MVP2); perfil financiero al administrador (`customer-profile`/`financial-profile`).

## Gotchas / riesgos
- **Ábaco NO cablea la decisión** hoy: se calcula y se persiste, pero no cambia el resultado.
- **El MODO no filtra lenders** — clasifica/ordena, pero la selección del 158 es la que sella el flujo.
- **El MODO re-decide en `/lenders`**: el usuario pre-elige el producto en `merchant-mode` y `/lenders` re-decide con ese modo, rompiendo el flujo normal (raíz del código quemado que motai-v2 elimina).
- **Estado 11 hardcodeado** aunque los estados son DB-driven.
- **Lender 158 sin seeder**: existe como fila runtime creada por el admin (no reproducible con un seed).

## Bitácora
- **2026-07-14** — Flujo auditado a 136 archivos (workflow 28 agentes + validación contra los PDFs de brechas/PRD MVP2). Cubre la originación actual + las brechas de deuda técnica (legal/TyC, motor de viabilidad salteado, perfil financiero). Reparto: application 13 · frontend 62 · legacy 61.

## Enlaces
- Tronco: group **CreditopX**. Decisión: nodo **motor-decision**.
- Tarea que deriva de acá: **motai-v2** (des-motaización) · nomenclatura: memoria `nomenclatura-negocio`.
