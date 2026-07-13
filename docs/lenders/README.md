# lenders/ — las entidades, una por una (vista comparativa)

> **Qué es esta carpeta.** Una **vista transversal por entidad**: el mismo conocimiento verificado de
> [`../codigo/`](../codigo/), pero organizado como lo pregunta negocio — *"¿en qué se diferencia Bancolombia de
> Credifamilia y de CreditopX?"*. Cada **ficha** resume lo distintivo de una entidad y **apunta al doc dueño**
> (no re-documenta). Si un dato de acá choca con el dueño, manda el dueño.

## La diferencia esencial (los dos sombreros)

- **CreditOp como BRÓKER** (`rt=0` referido · `rt=1` integración): la entidad externa **decide, presta y cobra**;
  CreditOp muestra opciones, arma la solicitud y gana por originar.
- **CreditOp como OPERADOR** (`rt=2` in-platform · `rt=3` cupo rotativo — la familia **CreditopX**): CreditOp
  **decide con reglas locales, firma, desembolsa y cobra**; el **capital y el riesgo los pone el comercio**.
- **Excepción:** `rt=4` (solo Credifamilia): CreditOp origina adentro pero **radica** el crédito en el lender (SOAP).

## Tabla comparativa

| Entidad | rt | ¿Quién decide? | ¿Quién pone la plata? | ¿Quién cobra la cartera? | ¿Cómo cierra? | ¿Simulable E2E? |
|---|---|---|---|---|---|---|
| **[CreditopX](./CREDITOPX.md)** (CrediPullman 77, Creditop X 37, SmartPay 152, Motai Renting 158…) | 2/3 | **CreditOp** (reglas locales: cupo + categoría + datacrédito propio) | **El comercio** | **CreditOp** (ledger + crons; comisión por recaudo) | in-platform: pagaré + OTP → **Estado 11** | ✅ 100% inyectable |
| **[Bancolombia](./BANCOLOMBIA.md)** (BNPL 68 · Consumo 100) | 1 | API del banco (`validate-quota` / `customers/validate`) | Bancolombia | Bancolombia | secuencia multi-step in-app → desembolso del banco; Estado 11 asíncrono | ❌ (solo mock HTTP) |
| **[Credifamilia](./CREDIFAMILIA.md)** (24) | **4** | Mixto: gate local (0% si `totalNs<12`) + **radicación SOAP** que decide el lender | Credifamilia | Credifamilia | origina in-platform → radica SOAP → *polling* 40/41 | ⚠️ parcial |
| **[Welli](./WELLI.md)** (23 · 141 · 142 · 166) | 1 | API externa (`run_risk`) | Welli | Welli | handoff a `next_step_url` + *polling* | ✅ mock HTTP (con matices v1/v2) |
| **[Banco de Bogotá](./BANCO-DE-BOGOTA.md)** (5 credi-convenio · 133 CeroPay) | 1 | API del banco (mTLS) | BdB | BdB | redirect externo + *polling* (5) / purchase-code (133) | ✅ mock HTTP |
| **[Sistecrédito](./SISTECREDITO.md)** (9) | 1 | API externa (cupo del cliente) | Sistecrédito | Sistecrédito | POS: OTP in-app · Online: redirect + **webhook propio** | ✅ mock HTTP |
| Meddipay (39) | 1 | API externa (`CreateOrder→APP`) | Meddipay | Meddipay | **handoff al celular** del cliente (modal, ni redirect ni in-app) | ✅ mock HTTP |
| Prami (12) | 1 | API externa — exige **perfil Experian REAL** reconstruido | Prami | Prami | `confirm-credit` sin redirect | ⚠️ el más costoso (Experian sembrado) |
| Compensar | 1 (cupo rotativo) | API externa por **OTP** (`generacionOtp/validacionOtp`) | Compensar | Compensar | in-app por OTP → Disbursed inmediato | ✅ mock HTTP |
| Addi | 0/1 | En su sitio (Action **stub**: register/consult vacíos) | Addi | Addi | redirect 100%; CreditOp solo espeja el retorno | ✅ (decisión en su sitio) |
| Referidos rt=0 (AV Villas, Rapicredit, Lulo…) | 0 | En el sitio del banco | El banco | El banco | redirect UTM; el crédito ni vuelve a CreditOp | — |

*(Detalle end-to-end de todos los rt=1 + Corbeta batch: [AGREGADORES-FLUJO-ANALISIS.md](../codigo/AGREGADORES-FLUJO-ANALISIS.md) §3.)*

## Cómo decide cada tipo (dónde viven las reglas)

| Tipo | Las reglas de decisión viven… | CreditOp puede cambiarlas |
|---|---|---|
| CreditopX (rt=2/3) | **Adentro**: group rules (clasifican), motor datacrédito nuevo, categorías/cupo (`creditop_x_quota_restrictions`) | ✅ (config BD — es la política que el simulador modela con herencia) |
| Integraciones (rt=1) | **Afuera**: la API del lender; CreditOp solo filtra/ordena el listado y empaqueta datos | ❌ (solo el listado) |
| Credifamilia (rt=4) | Mixto: gate local en el listado + decisión final del lender al radicar | parcial |

> Matiz importante del listado: la exclusión `array_filter [12,23,141,142,166]` (Prami + las 4 Welli) y la
> pre-aprobación sincrónica son del path **v1**; el **wizard usa v2**, donde la pre-aprobación la resuelve el
> front **progresivamente** contra el MS `pre-approvals-service`. Dueño: [ONBOARDING-DATOS-DECISION-ANALISIS.md](../codigo/ONBOARDING-DATOS-DECISION-ANALISIS.md) §7.1.

## IDs para no perderse (colisiones)

`24` = Credifamilia (lender) **y** Creditop (allied) · `100` = Bancolombia Consumo (lender) **y** un allied ·
`158` = Motai Renting (lender) **y** Motai (allied) · `153` = SmartPay rt=1 (lender) **y** Energiteca (allied) ·
`160` = `smartpay_lender_id` **solo en producción** (dev/local resuelve a 153). Dueño: [CREDITOP.md](../CREDITOP.md) §11.
