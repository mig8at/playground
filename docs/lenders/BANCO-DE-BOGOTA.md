# Banco de Bogotá — credi-convenio (5) y CeroPay (133)

> Ficha de entidad (vista transversal). Dueños: [AGREGADORES-FLUJO-ANALISIS.md](../codigo/AGREGADORES-FLUJO-ANALISIS.md) §3 y
> [HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md](../codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md) (su rol de default).

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **La API del banco** (mTLS: cert PEM + key por credencial) |
| ¿Quién pone la plata / cobra? | Banco de Bogotá |
| ¿Cómo cierra? | **5 credi-convenio:** redirect externo (`RedirectUrl`) + **polling** `StatusCheck` → Disbursed→11 · **133 CeroPay:** KYC previo (`/V2/Enterprise/KYC`) + flujo **purchase-code** (sin StatusCheck — está comentado) |
| ¿Simulable E2E? | ✅ mock HTTP (CeroPay además necesita seed de `lender_allied_credentials` que hoy falta en local) |

## Lo distintivo — el "default silencioso" del sistema

- **Su plantilla de datacrédito es EL DEFAULT de todo CreditOp:** si un lender no tiene política de buró propia,
  el sistema **copia la de BdB (`lender_id=5`, score 640)** al sembrarlo en una sucursal — hardcode inline en
  `LenderDatacreditoRulesController.php:102` (`application`) y `LenderRuleRepository::findDefaultDatacreditoRule():148`
  (legacy). Consecuencia medida: **42 entidades corren el corte de BdB sin que nadie lo decidiera** (y 5 casos
  graves donde pisó una política propia de 400-500). Es el ejemplo estrella del problema copia-vs-herencia.
- **Regla "0% duro":** si fallan las reglas duras, BdB (y el grupo UMA `[5,135,136,137]` — Occidente/Santander/Finanzauto)
  se fuerza a **0% de probabilidad** en el listado (`LenderValidationService.php:385`) en vez de solo reordenarse.
- **El único con mTLS + cierre por polling** (credi-convenio); CeroPay es la variante **0%** con KYC previo.
- Dos productos = dos Actions (`BancoDeBogota.php` / `BancoDeBogotaCeroPay.php`) con `Financing-Method` distinto
  (`'credi-convenio'` vs `'cero-pay'`).

## Hardcodes que lo tocan (muestra)

Default datacrédito `lender_id=5` (en ambos repos) · grupo `[5,135,136,137]` → 0% (`LenderValidationService.php:385`) · inventario: [LOGICA-QUEMADA.md](../codigo/LOGICA-QUEMADA.md) §2.
