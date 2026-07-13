# Credifamilia (24) — la excepción rt=4

> Ficha de entidad (vista transversal). Dueños: [CREDIFAMILIA-FLUJO-ANALISIS.md](../codigo/CREDIFAMILIA-FLUJO-ANALISIS.md) (flujo) y
> [CREDIFAMILIA-PIPELINE-DOCUMENTOS.md](../codigo/CREDIFAMILIA-PIPELINE-DOCUMENTOS.md) (documentos).

**El único lender `rt=4`** — un valor sin fila en el catálogo `response_types` (0-3). Híbrido: CreditOp origina
**adentro** (identidad, plan, firma) pero el crédito se **radica en Credifamilia por SOAP** y lo gestiona el lender.

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **Mixto**: gate LOCAL en el listado (0% si `totalNs<12 \|\| !debtCapacity` — `SpecialConditionsController`) + decisión FINAL del lender al radicar |
| ¿Quién pone la plata / cobra? | Credifamilia |
| ¿Cómo cierra? | Origina in-platform → **radicación SOAP** → *polling* hasta APROBADO/RECHAZADO (estados **40/41** de `lender_transaction_statuses` — otro namespace que `user_request_statuses`) |
| ¿Simulable E2E? | ⚠️ **Parcial**: el gate local del listado SÍ es inyectable; KYC V2 (Evidente + CrossCore + Jumio) y la radicación SOAP son externos |

## Lo distintivo

- **3 integraciones = 3 etapas:** REST (pre-aprobación) → **V2 KYC greenfield** (Evidente + CrossCore + Jumio, todo en legacy-backend) → Consumo **SOAP** (radicación).
- **El único con flujo legal de documentos completo:** `ENABLED_LENDERS_FOR_LEGAL=[24]` (`LegalService.php:31`) — TyC sin firmar por **WhatsApp**, PDF vía `pdf-mapper-service`, custodia en **S3**, envío por correo. Es **el patrón de firma/custodia** que el plan Motai/Alta generaliza (brecha 4.5 de José).
- **Gate local exigente** (por qué "no sale" en pruebas): requiere fila de buró con `economicSector==1`, **≥12 'N' consecutivas**, sin negativos, y `cuota×1000/ingreso ≤ 0.4`. El fixture base trae `economicSector 3/4` → `totalNs=0` → **0% por defecto**.
- **[CRÍTICO] Ambigüedad rt=2 vs rt=4:** partes del código tratan a Credifamilia como cupo local (rt=2/3 vía `available-quota`) y la formalización SOAP **solo corre con rt==4**. Riesgo de configurarlo mal. Dueño: [CREDIFAMILIA-FLUJO-ANALISIS.md](../codigo/CREDIFAMILIA-FLUJO-ANALISIS.md).
- **Colisión de ID:** lender 24 = Credifamilia, **allied 24 = Creditop** (está en `corbeta_allieds`). Verificar namespace antes de tocar un "24".
- No confundir con **"Credifamilia-addi"** (entrada redirect del catálogo en algunas sucursales del simulador/BD): esta ficha es el lender 24 con radicación.

## Hardcodes que lo tocan (muestra)

`ENABLED_LENDERS_FOR_LEGAL=[24]` + slugs del pdf-mapper (`LegalService.php:31,35-36`) · TyC id **18** repetido en 3 servicios · `$lender_id=24` fijado al consultar Datacrédito por lender (`DatacreditoQueryByAlliedController.php:342`) · voucher/payload propio (`VoucherService.php:15`) · inventario: [LOGICA-QUEMADA.md](../codigo/LOGICA-QUEMADA.md) §2, §4.
