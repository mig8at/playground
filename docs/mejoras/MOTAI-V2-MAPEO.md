# Motai v2 — mapeo del flujo objetivo → archivos

> **Rama:** `feature/motai-v2`.
> **Qué es:** el puente entre lo que ya tenemos: el **flujo actual** (atlas `motai.json`, 136 archivos
> cross-repo), el **target** (`examples/motai.html`) y el **plan técnico** (`DES-MOTAIZACION.md`).
> Para cada pieza del target dice: qué es, cómo está hoy, qué cambia y **qué archivos se tocan**.
> **Alcance de esta pasada:** panorama (archivos clave por pieza, no exhaustivo).
> **Flujo v2 en atlas:** `atlas/server/data/flows/motai-v2.json` (misma superficie, narrativa del deber-ser).

---

## Cómo leer esto
- **Hoy** = cómo funciona en el flujo Motai v1 (el de `motai.json`).
- **Target** = lo que muestra `motai.html`.
- **Ref** = ítem del censo técnico en `DES-MOTAIZACION.md` (B = backend, F = frontend) + PR propuesto.
- **NUEVO** = no existe archivo hoy; hay que crearlo.

---

## Resumen (las 7 piezas + contexto)

| # | Pieza del target | Tipo | Repos que toca | PR (DES-MOT.) |
|---|---|---|---|---|
| 0 | Alta / catálogo del comercio | reutiliza | application | — |
| 1 | **Categoría de producto** (reemplaza el "modo") | **nuevo + borra** | legacy + frontend | PR-1, PR-6 |
| 2 | Ingresos: cascada de fuentes + perfil | reutiliza + arregla | legacy + frontend | PR-0 |
| 3 | Calculadora única en backend | mueve (des-duplica) | legacy + frontend | PR-2 |
| 4 | Viabilidad R1–R8 por config | reactiva (hoy salteado) | legacy | PR-4 |
| 5 | Decisión por ingreso | config | legacy | PR-4 |
| 6 | **Codeudor** | **nuevo** | legacy + frontend | fase nueva |
| 7 | PEP / buró | pregunta abierta | legacy + frontend | PR-3/4 |
| — | Identidad (ADO + AML) | reutiliza | legacy + frontend | — |
| — | Formalización / desembolso / cobranza | **fuera de alcance** (post-aprobación) | legacy + frontend | — |

---

## 0 · Alta / catálogo del comercio  ·  *reutiliza*
**Hoy:** el admin da de alta el lender 158 (rt=2) y lo adjunta al comercio/sucursal, copiando reglas + datacrédito por sucursal.
**Target:** igual, pero el producto se elige como un **lender del catálogo** (no un "modo"). No cambia el mecanismo de alta.
**Archivos clave:** `application/.../Admin/LenderController.php`, `AlliedLenderController.php`, `AlliedAlliedBranchController.php`, `LenderRulesController.php`, `LenderDatacreditoRulesController.php`; modelos `Lender`, `CreditopXLenderConfiguration`, `LendersByAllied`, `LendersByAlliedBranch`, `LenderRule`, `GroupRule`.

## 1 · Categoría de producto  ·  *el corazón del cambio*
**Hoy:** el comportamiento lo dispara un **"modo"** del comercio (`isMotaiRenting`, `MOTAI_LENDER_IDS=[158]`) + una **pantalla de modos**.
**Target:** una **categoría de lender** (crédito / arrendamiento / arrend.-con-compra) dispara todo; **desaparece la pantalla de modos** (el producto se elige en el marketplace).
**Qué cambia:** crear la categoría (columna/tabla NUEVA, hoy no existe); los evaluadores la leen con respaldo a los ids viejos (dual-read) y al final se borran los ids/flags.
**Archivos clave:**
- Backend: `legacy/.../Services/lenders/AlliedModeLenderFilterService.php` (el filtro por modo, hoy NO-OP), `App/Models/AlliedMode.php`, `UserRequestMode.php`, `AlliedModeRepository.php`, `UserRequestModeRepository.php`, migraciones `..._create_merchant_modes_table.php` (crea `allied_modes`) y `..._create_request_modes_table.php`.
- Frontend: `merchant-mode.tsx` (app + módulo), `lenders-marketplace/.../lender-card/LenderCardContent.tsx` (branch `isMotai`), `.../domain/constants/lender.constants.ts` (ids Motai), `.../domain/services/lender-resolution.service.ts`.
**Ref:** B1 (disparador dual), B8/B9 (plumbing del modo), F4 (`MotaiLenderCardContent`), F6 (isMotaiRenting en 5 rutas) · **PR-1** (crear categoría) + **PR-6** (borrar hardcode).

## 2 · Ingresos: cascada de fuentes + perfil  ·  *reutiliza + arregla*
**Hoy:** en renting corre **Ábaco** (scraping gig) que salta el buró; el ingreso (`average_income`) **se calcula y se descarta** (nadie lo persiste ni lo lee).
**Target:** **cascada** AgilData→Mareigua→TusDatos→Ábaco→Manual (1ª que responde) → perfil **App** (Ábaco) / **No-App** (tradicional). Persistir `average_income` y cablearlo a la decisión.
**Archivos clave:**
- Backend Ábaco: `AbacoController.php`, `AbacoService.php` (**acá se descarta el ingreso — arreglar**), `AbacoParserService.php`, `app/Actions/RiskCentrals/Abaco.php` (+ `AbacoFixture.php`), `UserSummary.php` (columna abaco), migración `..._add_abaco_column_to_user_summaries_table.php`.
- Fuentes tradicionales / buró: `Services/lenders/RiskCentralValidationService.php`, `Modules/Risk/.../DatacreditoQueryByAlliedController.php`.
- Frontend: `apps/.../routes/abaco/*` + `modules/.../abaco/*` (use-cases y repos).
**Ref:** B16 (`average_income` ni se persiste) · **PR-0** (persistir + cablear).

## 3 · Calculadora única en backend  ·  *des-duplicar*
**Hoy:** la fórmula de precio está **quemada y DUPLICADA en el front** (`LenderCardContent.tsx` y `useLenderSelection.ts`).
**Target:** una sola fuente **en backend** (renting: tarifa PMT 24m /30×7 × factor; RTO: valor a financiar con **cuota inicial editable** + anualidad semanal 52/78/104). El front solo muestra.
**Archivos clave:**
- Front (origen duplicado): `lenders-marketplace/.../lender-card/LenderCardContent.tsx`, `.../available-lenders/hooks/useLenderSelection.ts`.
- Backend (destino): `Modules/Loans/.../CreditopXQuotaController.php` + `GetCreditopXQuotaRequest.php`, `Modules/Loans/App/Services/CreditopXFlowService.php`, `PaymentScheduleController.php`, `PromissoryNoteController.php` (amortización del pagaré).
**Ref:** brecha 4.4 (calculadora quemada y duplicada) · **PR-2**.

## 4 · Viabilidad R1–R8 por config  ·  *reactivar el motor que Motai saltea*
**Hoy:** Motai **saltea** la política de crédito (el bypass del buró es el corazón de `isMotaiRenting`); el motor de viabilidad existe pero no corre para Motai.
**Target:** las R1–R8 como **reglas con clave estable + valor** en el motor que ya existe: 2 referencias · Datacrédito consultado · score ≥ 400 · canon $150k–$300k · cuota ≤ 25% ingreso semanal · deuda ≤ 40% ingreso mensual · endeudamiento < 50%.
**Archivos clave:** `Modules/Risk/.../DatacreditoQueryByAlliedController.php` (`userViability` — base de la política), `Services/lenders/RiskCentralValidationService.php`, `Services/lenders/ProfilingRulesService.php`, `LenderListingService.php`; config: `LenderRule`, `GroupRule`, `LendersByAlliedBranch` (reglas por sucursal), `LenderRulesController.php`, `LenderDatacreditoRulesController.php`.
**Ref:** motor de viabilidad que salta (C2 revierte el bypass del buró) · **PR-4** (toca riesgo, fail-closed).

## 5 · Decisión por ingreso  ·  *config*
**Hoy:** la decisión la toma el **asesor** por un endpoint sin auth propia (`BackDoorUserController`/`Service`).
**Target (PRD):** ≥ $3M → aprobación directa; < $3M → **codeudor obligatorio**. **La fuente (App/No-App) NO cambia la decisión** (a diferencia del Playbook de operaciones — conflicto a cerrar con Manuela).
**Archivos clave:** `Modules/Onboarding/.../BackDoorUserController.php` + `BackDoorUserService.php`, `MotaiValidationController.php` + `MotaiValidationService.php`, `MotaiUpdateStatusRequest.php`; perfil que pasa al admin: `customer-profile/.../financial-profile.repository.ts`.
**Ref:** brechas 4.7–4.11 (actor administrador) — **workstream aparte** (mover la decisión del asesor a un admin con rol/auditoría).

## 6 · Codeudor  ·  *pieza NUEVA*
**Hoy:** no existe (solo string de estado + copy en PDF).
**Target:** **modelo + formulario** de datos del codeudor (nombre, documento, score Datacrédito, ingreso, relación) que aparece **solo si ingreso < $3M**, con gate **score > 650**.
**Archivos clave (a crear / extender):** onboarding (`personal-info-form.tsx`, `UserService.php`, `UpdateRequest.php`) + modelo/tabla de codeudor **NUEVOS**.
**Ref:** codeudor = pieza nueva (fase del motor de decisión).

## 7 · PEP / buró  ·  *decisión de negocio ABIERTA*
**Hoy:** el PEP entra como tipo de documento y **no dispara consulta**; hay whitelist del flag en las requests de OTP.
**Target:** el PEP (migrante sin historial local) **no es consultable** en identidad ni Datacrédito → **¿qué hacer?** (validación manual / exención de política / garantía). El simulador lo deja como pregunta abierta desde la etapa de identidad en adelante.
**Archivos clave:** `document-type.ts` (front), `personal-info-form.tsx`, `SendOtpCodeRequest.php` / `ValidateOtpCodeRequest.php` (whitelist del flag — B7), legal/TyC: `LegalService.php` + `AcceptedTermsAndConditionsS3Repository.php` + `SignedTermsAndConditionsMail.php`; buró: `RiskCentralValidationService.php`, `DatacreditoQueryByAlliedController.php`.
**Ref:** B7 (whitelist OTP), brechas 4.1/4.2/4.5/4.6 (legal + PEP) · **PR-3** (legal por config).

---

## Reutiliza (sin cambio de fondo)
**Identidad (ADO + AML):** `Modules/Identity/.../AdoController.php`, `IdentityValidationStepResolver.php`, `ValidationStatusService.php`; front `identity-validation-instructions.tsx`, `identity-validation-status.tsx`, `identity-validation/.../validation-polling.types.ts`.

## Fuera de alcance del target (post-aprobación)
El target de `motai.html` **termina en la pantalla del asesor**. Estas etapas existen en el flujo v1 pero quedan afuera:
- **Firma / pagaré:** `sign-documents.tsx`, `otp-validation.tsx`, `PromissoryNoteController.php`, `PromissoryNoteService.php`, `ValidateOtpPromissoryNoteController.php`, `loan-origination/*`.
- **Desembolso / Estado 11:** `LoanAuthorizationService.php`, `UserRequestStatus.php`, `loan-approved.tsx`.
- **Cobranza / servicing:** `CreditopXRequestHistoryService.php`, callback `motai/update-status`.

---

## Pendientes de negocio (para Manuela) — bloquean piezas
1. **C9** score mínimo (400 vs 0) → usamos 400 (Playbook §5A). Afecta pieza 4.
2. **C10** semanas RTO (52/78/104, no 12/18/24). Afecta pieza 3.
3. **App vs No-App:** ¿la fuente cambia la decisión? PRD dice **no**; Playbook dice **sí** (No-App siempre codeudor). Afecta pieza 5.
4. **PEP:** qué hacer sin buró. Afecta pieza 7 (y todo lo de ahí en adelante).
5. **Fórmula base de la tarifa de renting** (vivía solo en el Excel; ya reproducida en `motai.html`). Afecta pieza 3.
