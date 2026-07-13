# MECÁNICA — cómo funciona financiera y operativamente el crédito

> 📚 Complementa [CREDITOP.md](../CREDITOP.md) (qué es Creditop, `response_type`, ciclo de vida). Este doc
> cubre la **mecánica financiera** (cómo se calcula la cuota, intereses, seguros, garantías) y la
> **operación** (cobranza, recuperación, refinanciación, acuerdos) de Creditop X.
>
> **Fuente:** capacitación de producto **5-jun-2026** (Manuela Romero, equipo de producto) +
> **Calculadora PV V20251009** (`Plan de pago`/`Tablas`). Es **conocimiento de negocio** (el *qué/por qué*),
> no necesariamente validado contra el runtime. Donde se cruzó con la BD/código local se anota **[✓ cruzado]**.

---

## 1. Mecánica financiera — amortización francesa con interés sobre saldo diario

Creditop X usa **amortización francesa**: la **cuota que ve el cliente es FIJA**, pero el cálculo de
intereses corre sobre el **saldo diario** de la deuda → el *saldo consultado* varía día a día
(no es el típico "saldo a fin de mes"). Validado conceptualmente con Yinier en la capacitación (00:24:54, 00:26:16).

**Cadena de tasas** (Calculadora PV, hoja `Plan de pago`):

| Paso | Fórmula (celda) | Qué es |
|---|---|---|
| Tasa **EA** | input `D22` | efectiva anual (el comercio la fija según su apetito) |
| Tasa **MV** | `D23 = (1+EA)^(1/12) − 1` | mes vencido (efectiva mensual) |
| Tasa **diaria** | `D24 = (1+MV)^(1/30) − 1` | para el interés del saldo diario |

**Cuota fija (capital + interés)** = `PMT(MV, plazo, monto)` (`L8 = -PMT($D$23,$D$6,$D$19)`). De ahí:
- **Abono a capital** = `cuota − interés` (`K8 = L8 − I8`); **Saldo** = `saldo_ant − abono` (`H8 = H7 − K8`).
- Al inicio se paga **más interés y menos capital** (propiedad de la francesa) (00:24:54).
- **Interés diario** para períodos parciales: `saldo × tasa_diaria × días`, con los días vía `DAYS360`
  (`D31`) — así arranca el cobro desde la fecha real, no desde un mes redondo.

**Cuota TOTAL ("cuota a informar al cliente")** = cuota K+I **+ seguro de vida + fondo de garantía**
(`O8 = SUM(L8:N8, J8)`). El cliente ve una sola cuota fija; el desglose K/I/seguro/FGA es interno.

> Insumos del plan: `Plazo`, `IVA`, `Tasa EA`, `Factor seguro de vida`, `Día de pago de cuota`,
> `Tipo tasa` (vencida/anticipada → `D19` suma o no el costo financiado). Salida: tabla por cuota con
> `Saldo · Interés · Abono a capital · Seguro de vida · Cuota (K+I) · Cuota total`.

---

## 2. Tipos de crédito Creditop X

| Tipo | Ticket | Cupo | rt |
|---|---|---|---|
| **Cupo rotativo** | < $1.000.000 | se **libera al pagar** (reutilizable) | 3 [✓ cruzado: rt=3 en backend-e2e] |
| **Crédito de consumo** | > $1.000.000 | **NO** se libera tras el pago | 2 [✓ cruzado: rt=2 in-platform] |
| **Renting** (Motai) | — | device-lock IMEI (ver §9 y flujos-especiales) | 2 |

La elección depende del **perfil del comercio** (00:29:00).

---

## 3. Seguros de vida

- **Obligatorios en entidades supervisadas**; cubren la deuda ante fallecimiento/incapacidad del cliente (00:30:39).
- Para no encarecer el crédito, se gestionan vía **brokers** (ej. **Seguros Mundial**): el comercio paga
  facturas mediante acuerdos donde la **cuenta de cobro enviada al broker compensa el costo del seguro** (00:34:04).
- En el plan de pagos entra como **`Factor seguro de vida`** (× saldo) sumado a la cuota total (ver §1).

---

## 4. Fondos de garantía (FGA)

En microcréditos no hay codeudores → se usan **fondos de garantía** que cobran un **% adicional sobre el monto**
(ej. **5% o más**) para cubrir incumplimiento (00:37:01). Permiten operación rápida/en línea (00:38:21).

- Se **acumulan** para cubrir deudas con **> 90 días de mora** (00:40:45).
- Al **reclamar la garantía**, el crédito queda con **saldo cero** (cierre de la obligación) (01:02:00).
- [✓ cruzado] el % vive en `lender_users_categories.FGA` (columna por categoría; ver MODELO-DATOS).

---

## 5. Segmentación de clientes (políticas estándar)

De **"premium"** a **"malos"**. Estrategia clave: **rescatar no-bancarizados / reportados** ofreciéndoles
crédito con **mayor exigencia de garantía + cuota inicial alta (ej. 70%)**, ayudándolos a mejorar su historial
mediante **reportes positivos a Datacrédito** (00:44:42).

[✓ cruzado] las categorías y su `min_initial_fee` (cuota inicial %) viven en `lender_users_categories`;
la asignación a cada cliente la hace el **motor de scoring SQL** (no una banda de score simple).

---

## 6. Cobranza

| Etapa | Cuándo | Submodos |
|---|---|---|
| **Preventiva** | antes del vencimiento | recordatorios |
| **Coactiva** | tras la mora | **prejudicial** / **judicial** |

El **cobro jurídico es poco común**: su costo es alto frente al saldo de microcréditos (**< $10.000.000**) (00:10:40).
Hoy se usa **Colbook** (agentes de **IA**) para las llamadas de cobranza (00:50:38).

---

## 7. Refinanciación y normalización

- **Refinanciación:** ajusta las cuotas para que sean más cómodas en un **plazo mayor**, **sin condonar
  intereses ni capital**. Solicitada frecuentemente por **Motai**. Identificable en los movimientos como
  ajustes para facilitar el cumplimiento (01:00:32).
- Es **distinta** de condonar (que sí implicaría concesiones) — ver §8.

---

## 8. Acuerdos de pago

- **Hoy NO se pueden hacer sin aprobación explícita de crédito Y del comercio**, porque suelen implicar
  **concesiones** (intereses, garantías o seguros) (00:59:09).
- **No existen acuerdos aprobados** bajo este esquema actualmente (pese a consultas de Colbook).

---

## 9. Estados de recuperación (Motai) — [✓ ver MOTAI-FLUJO-ANALISIS.md]

Para **Motai** (renting con IMEI) se incorporaron estados nuevos: **recuperación de producto** y
**recuperación por fondo de garantía** (01:02:00). Motai usa **GPS + prenda sobre la motocicleta** → puede
**recuperar el vehículo** si la deuda no se salda (4 motos recuperadas a la fecha). Al recuperar el producto o
reclamar la garantía, el **saldo queda en cero** (cierre).

---

## 10. Contratos y documentos

- **Contrato de asociación:** cuando los productos tienen **IVA**, para evitar que el crédito se encarezca por
  impuestos sobre intereses, **Creditop X actúa como tercero** en la operación (00:49:08).
- **Documentos estándar firmados (vía OTP):** **pagaré** (en blanco o diligenciado), **consentimiento informado**
  y **contrato de fondo de garantías** (00:55:14). [✓ cruzado: el cierre Creditop X genera acceptance + promissory-note + consent type, ver REFERENCIA-FLUJOS §6/backend-e2e]

---

## 11. Validación de identidad (ADO vs AWS) e internacionalización

- El onboarding integra validación de identidad con **ADO** y **AWS**. **ADO es preferido** para ciertos
  comercios por su **mayor exigencia** y el **seguro contra fraude** que ofrece (00:53:49).
- **Estrategia multi-región:** elegir proveedores que operen en varios países (ADO opera en **República
  Dominicana**, etc.) → reutilizar las integraciones existentes **cambiando solo credenciales**, sin nuevos
  desarrollos técnicos (01:03:31). [✓ cruzado: Ábaco/ADO aparece en flujos-especiales (Motai/PEP)]

---

## 12. Roadmap operativo — plug-and-play

- Hoy poner en marcha un comercio nuevo tarda **~1 semana** (01:04:55).
- Objetivo: **conectar y usar (plug-and-play)** — que gestores de cuenta y comercios **parametricen sus propias
  políticas y activen integraciones desde el front-end**, sin intervención manual prolongada.
- La **personalización de UX se limita** (estandarización) para no disparar costos de desarrollo; lo que SÍ es
  modular/parametrizable son las **políticas de riesgo** por industria (00:13:25, 00:47:48).

---

## Caso de éxito — Mediarte (perfilamiento predictivo)

Tras una **baja conversión inicial**, se estudió la relación entre el **score de Datacrédito (0–950)** y la
aprobación, y se halló que **buenos perfiles eran rechazados** por variables como capacidad de endeudamiento o
**deudas pequeñas en servicios públicos** (00:16:11, 00:19:04). Con el nuevo modelo de perfilamiento, Mediarte:

- facturación **$20M → $350M / mes**,
- **+25%** conversión,
- **3×** ticket promedio (00:20:33).

> [✓ cruzado] el perfilador de `backend-e2e` (`go run . perfilador`) valida esta lógica de oferta por perfil
> (reglas duras + datacrédito); ver VALIDATION.md.

---

**Fuentes:** capacitación producto 5-jun-2026 (timestamps `(hh:mm:ss)` arriba) · Calculadora PV V20251009.
**Última revisión:** 2026-06-05.
