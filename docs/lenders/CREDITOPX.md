# CreditopX — la familia in-platform (rt=2/3)

> Ficha de entidad (vista transversal). Dueños del detalle: [FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md](../codigo/FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md) (originación),
> [CONTINUACION-CREDITO-ANALISIS.md](../codigo/CONTINUACION-CREDITO-ANALISIS.md) (servicing), [REGLAS-POR-COMERCIO-Y-LENDER.md](../codigo/REGLAS-POR-COMERCIO-Y-LENDER.md) (reglas).

**No es UN lender: es una FAMILIA.** Cada comercio con acuerdo tiene el suyo: **CrediPullman (77)**, **Creditop X (37)**,
Magnocréditos, **SmartPay (152)**, **Motai Renting (158)**… Todos comparten el motor in-platform.

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **CreditOp**, con reglas locales (por eso es el único 100% inyectable en pruebas) |
| ¿Quién pone la plata? | **El comercio** (capital y riesgo) — CreditOp opera y gana **comisión por recaudo** |
| ¿Quién cobra la cartera? | **CreditOp** (ledger `creditop_x_requests_history` + crons diarios; cascada cobranza→mora→interés→seguro→capital) |
| ¿Cómo cierra? | In-platform: consentimientos + **pagaré** (Deceval o PDF) + **OTP** → **Estado 11** (rt=3 además libera cupo al pagar capital) |
| ¿Cómo decide? | 3 capas: group rules (**clasifican**, no excluyen) → motor datacrédito **nuevo** (fail-closed, regla genérica) → **categoría/cupo** (`creditop_x_quota_restrictions`) = el corte duro |

## Lo distintivo

- **Los dos sombreros en uno:** técnica/operativamente CreditOp hace todo (originar, firmar, desembolsar, cobrar); económicamente el dueño del crédito es el **comercio**. No confundir capas.
- **El sello rt=2 se decide en el listado** (`getLenders`): si `LenderUserCategoryService` no devuelve categoría → la card ni aparece. El monto solicitado se vuelve el **cupo**.
- **Dos motores de datacrédito conviven**: el NUEVO (`DatacreditoRuleEvaluator`, rt=2, regla genérica `allied_branch_id IS NULL`, fail-closed) vs el LEGACY (rt≠2, por sucursal). Dueño: [ONBOARDING-DATOS-DECISION-ANALISIS.md](../codigo/ONBOARDING-DATOS-DECISION-ANALISIS.md).
- **Servicing propio** (lo que ningún agregador tiene): estados del préstamo al día → mora → paz y salvo → cancelado; recordatorios; revolving. ⚠️ Corre 100% en `application` (legacy tiene copias muertas).
- **Variantes por canal, mismo motor:**
  - **SmartPay (152 dev · `smartpay_lender_id`=160 solo prod):** el celular financiado ES la garantía — paso extra de enrolar IMEI antes de desembolsar + device-lock MDM en mora (crons). Dueño: [SMARTPAY-FLUJO-ANALISIS.md](../codigo/SMARTPAY-FLUJO-ANALISIS.md).
  - **Motai Renting (158):** arrendamiento (rent-to-own según el diccionario D2) — hoy montado como "modo" con bypass de buró + Ábaco para ingresos gig; el plan lo convierte en productos de catálogo. Dueños: [MOTAI-FLUJO-ANALISIS.md](../codigo/MOTAI-FLUJO-ANALISIS.md) + [MOTAI-PLAN-EVOLUCION.md](../mejoras/MOTAI-PLAN-EVOLUCION.md) §10.
- **La política es configurable** — y es justo la que el simulador (`playground/flow`) modela con **herencia** (política base → producto → acuerdo). El deber-ser: [UNIFICACION-Y-RESPONSABILIDADES.md](../vision/UNIFICACION-Y-RESPONSABILIDADES.md).

## Hardcodes que la tocan (muestra)

`response_type == 2` comparado como literal en `CreditopXFlowService`/`DebtSummaryService`/`RekognitionController`; `== 3` en **12 archivos** sin constante · buckets de score quemados en `Modules/Loans/.../LenderSpecialGrantingService.php:186-201` (el gemelo de Onboarding ya usa tabla) · inventario completo: [LOGICA-QUEMADA.md](../codigo/LOGICA-QUEMADA.md) §1-2.

## Cara al usuario final

Wizard React: biométrica (ADO) → plan de pagos → firma OTP → voucher; con QR de autogestión en asesor (2 dispositivos). El listado lo muestra **siempre arriba** (rt=2/3 forzados a 'Probabilidad alta'; el ML está corto-circuitado).
