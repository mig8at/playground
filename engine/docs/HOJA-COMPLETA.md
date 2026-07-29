# La hoja completa, y cómo volver a crecer

> La app quedó en **lo mínimo** —monto, cuotas y tasa— a propósito: para ordenar de a poco.
> Este documento es el mapa de vuelta.

## Dónde está

**`reference/full-sheet.js`** — fuera de la app, pero **vivo**: `verify.mjs` la corre y sigue
probando que **una sola hoja reproduce los cuatro productos**, con **30 puntos de control
exactos** contra los `.xlsm` y el PDF. Borrarlo sería borrar la evidencia de que la
estandarización es correcta.

```bash
node verify.mjs
```

## Qué tiene

**17 inputs, 19 fórmulas** — la forma que ya tiene el código real. La firma de
`Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService::performCalculation` es
**una función con ~15 perillas**, no una por lender:

```
amount · original_amount · rate · fee_number · is_biweekly ·
administrative_costs_percentage · administrative_fixed_value ·
guarantee_fund_percentage · life_insurance_percentage · life_insurance_fixed ·
insurance_fixed_monthly_percentage · guarantee_fixed_monthly_percentage · …
```

Y **6 configuraciones**, que son lo único que distingue un producto de otro:

| configuración | fuente | qué la distingue |
|---|---|---|
| `generico` | — | solo monto, tasa y cuotas |
| `motai-rto` | `Calculadora Renting VF.xlsx`, pestaña RTO | margen 100% + IVA · tasa **efectiva** · cobra semanal |
| `salud-gaes` | `Calculadora PV V20251009.xlsm` | fianza + IVA + 4×1000 · E.A. → mensual |
| `salud-dentix` | el otro `.xlsm` | igual que Gaes, fianza **mensualizada** |
| `alta-moto` | `Creditop-ALTA FLEET.pdf` punto 9 | GPS + fianza con IVA adentro · **nominal** · canon GPS |
| `alta-poliza` | el mismo PDF | **la misma hoja, segunda corrida** |

## El orden sugerido para crecer

> **Corregido.** La primera versión de este documento ordenaba por *estructura del cálculo*
> (precio primero, porque va antes en la cadena). Pero por **cobertura** el orden es casi el
> inverso: `guaranteeRate` y `lifeInsuranceRate` los usan **3 de 6** productos cada uno, y todo
> el bloque de precio lo usa **1 de 6**.

Un bloque por vez, y cada uno se prueba solo con `verify.mjs`. Los inputs nuevos arrancan en
**cero**, así que **ningún bloque cambia los números de lo que ya andaba** — eso es lo que hace
seguro crecer de a poco.

### Lo que la hoja mínima ya cubre

**2 de 6 completos**: `generico` y `alta-poliza` (esta última es solo monto, tasa y cuotas, y da
74.414,06 exacto).

Y un *casi* engañoso: `salud-dentix` acierta la `installment` (806.916,70) pero **eso no es lo que
paga el cliente** — su fianza va mensualizada, así que el cobro real es 806.916 + 80.646 de fianza
+ 5.881 de seguro = **893.444**. La hoja acierta el pedazo y se pierde el total. Ese hueco es el
concepto que falta.

### Las cuatro tandas

> **Tanda 1 aplicada.** La fianza ya está en la hoja mínima, con los dos conceptos visibles: el
> `valor a financiar` aparece en la franja **solo cuando difiere del monto**, y con la fianza
> mensualizada la franja dice *"de la cuota, 41.667 es fianza"* — porque la columna `cuota` de la
> tabla ya no coincide con `capital + interés`.

| # | tanda | perillas | qué desbloquea | concepto nuevo |
|---|---|---|---|---|
| ~~**1**~~ | ~~fianza~~ **✓ HECHA** | 4 · `guaranteeRate` `guaranteeVatRate` `transactionTaxRate` `guaranteeUpfront` | nada completo aún | **lo financiado ≠ lo pedido** |
| **2** | seguro de vida | 1 · `lifeInsuranceRate` | **salud-gaes y salud-dentix** | **lo que paga ≠ la cuota** |
| **3** | dispositivo y cargos | 2 · `deviceCost` `monthlyFixed` | **alta-moto** | — |
| **4** | precio | 5 · `downPayment` `setupFee` `extras` `marginFactor` `priceVatRate` | **motai-rto** | — |

**Cinco perillas desbloquean dos productos; las últimas cinco desbloquean uno.** Rendimiento
decreciente, en ese orden exacto.

Los dos primeros pasos traen un **concepto**, no solo perillas:

- **La fianza** es lo primero que se *suma* al monto, así que fuerza la distinción entre lo que el
  cliente pide y lo que se financia. Una vez que existe, cualquier costo futuro es una línea más
  entre esos dos.
- **El seguro** fuerza la segunda: el chip de arriba dice "cuota" y en un producto real eso **no
  es lo que paga el cliente**. Es exactamente el hueco de Dentix.

### Lo que NO agregaría todavía

**`lifeInsuranceFixed` — 0 de 6.** Ningún producto la usa. Existe en el código real
(`life_insurance_fixed`), así que algún lender debe usarla, pero hasta ver cuál es **superficie
especulativa**. Agregarla sería inventar un requisito.

### Lo que falta en TODAS las hojas, incluida la completa

**`firstPeriodDays`.** Hoy la serie asume que todos los períodos son iguales; en la realidad entre
el desembolso y la primera cuota hay un hueco irregular. El código real lo cobra
(`PaymentCalculationService`: `billingDays`, con corte **5 días antes** del pago) y sobre el
crédito de Gaes eso da **+2,49% de intereses** contra el mes idealizado de 30 días.

No desbloquea ningún producto: hace que **la tabla deje de ser una idealización**. Va después de
las cuatro tandas, porque arrastra el calendario — y ahí conviene tener resuelto qué entra al motor
y qué se queda del lado del llamador (la decisión fue: el motor recibe **días contados**, no fechas).

### Lo que nunca va en la entrada

| | por qué |
|---|---|
| score, ingreso, patrimonio | son de la **política**; la calculadora no juzga |
| fechas de calendario | del **llamador** |
| el techo de usura | **dato con vigencia** (la Superfinanciera lo cambia cada trimestre), no constante |

## Lo que NO normaliza, y por qué

**`motai-renting`.** Sin opción de compra el cliente nunca es dueño: no hay saldo, no hay
interés, **no es un crédito** y no le aplica el techo de usura. Su "tasa" del 1,8% es un
**parámetro de precio** — el `.xlsx` la lista literalmente como *"Parámetro"*. Amortiza el
precio de venta a 24 meses y prorratea `÷30 ×7` para fijar una tarifa.

Meterla en la hoja con perillas en cero sería **fingir que es un crédito**. Detalle completo en
el nodo `motai` del contexto.

## Los nombres: dos, y no se cruzan

Cada input tiene **tres campos** y cada uno vive en su lado:

| campo | idioma | dónde aparece |
|---|---|---|
| `name` | inglés | el JSON, las fórmulas, la API. **La UI no lo muestra nunca** |
| `label` | español corto | la interfaz. **El documento no lo guarda nunca** |
| `help` | español largo | tooltip |

```
UI          fianza · IVA de la fianza · 4 × 1000 · fianza anticipada
documento   guaranteeRate · guaranteeVatRate · transactionTaxRate · guaranteeUpfront
```

Lo mismo en la tabla: los encabezados dicen *saldo inicial · interés · capital · cuota · saldo
final* (los mismos del `.xlsx` original) mientras el documento guarda `openingBalance · interest ·
principal · payment · closingBalance`.

**Por qué separarlos:** un cambio de redacción no puede tocar una fórmula, y traducir la interfaz
no puede romper el contrato de la API. Son dos ejes que se mueven a ritmos distintos.

## Lo que se quitó de la app y dónde quedó

| se fue | dónde está |
|---|---|
| el nodo de Cálculo | las fórmulas siguen en la hoja; el botón `documento` las muestra |
| las 6 configuraciones | `reference/full-sheet.js`, corriendo en `verify.mjs` |
| el panel de fórmulas con KaTeX | `git show 61ba683:engine/src/FormulaPanel.vue` y `…:engine/src/latex.js` |
| la pestaña Política | `docs/POLITICA-Y-CALCULO.md` + `POLICIES` en el archivo de referencia |
| las tres zonas rotuladas | con dos nodos no hacían falta |
