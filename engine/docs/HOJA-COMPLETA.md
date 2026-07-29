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

Un bloque por vez, y cada uno se puede probar solo con `verify.mjs`. Los inputs que agregues
arrancan en **cero**, así que **ningún bloque nuevo cambia los números de lo que ya andaba** —
eso es lo que hace seguro crecer de a poco.

**1 · Precio** (`marginBase → margin → taxableBase → priceVat → principal`)
Agrega `downPayment`, `setupFee`, `extras`, `marginFactor`, `priceVatRate`.
Con eso entra `motai-rto`. Prueba: `principal = 10.790.920`.

**2 · Fianza** (`guaranteeBase → guaranteeCost → guaranteeVat → guaranteeTax → totalGuarantee`)
Agrega `guaranteeRate`, `guaranteeVatRate`, `transactionTaxRate`, `guaranteeUpfront`, `deviceCost`.
Con eso entran `salud-*` y `alta-moto`. Prueba: `financedAmount = 12.000.000`.

**3 · Cargos por cuota** (`lifeInsurance`, `monthlyGuarantee`, `totalInstallment`)
Agrega `lifeInsuranceRate`, `lifeInsuranceFixed`, `monthlyFixed`.
Prueba: `totalInstallment = 690.441` en `alta-moto`.

**4 · Las configuraciones como presets** — el dropdown que carga valores sin tocar la hoja.

**5 · Política** — otro recurso, no otra hoja. Ver `docs/POLITICA-Y-CALCULO.md`.

## Lo que NO normaliza, y por qué

**`motai-renting`.** Sin opción de compra el cliente nunca es dueño: no hay saldo, no hay
interés, **no es un crédito** y no le aplica el techo de usura. Su "tasa" del 1,8% es un
**parámetro de precio** — el `.xlsx` la lista literalmente como *"Parámetro"*. Amortiza el
precio de venta a 24 meses y prorratea `÷30 ×7` para fijar una tarifa.

Meterla en la hoja con perillas en cero sería **fingir que es un crédito**. Detalle completo en
el nodo `motai` del contexto.

## Lo que se quitó de la app y dónde quedó

| se fue | dónde está |
|---|---|
| el nodo de Cálculo | las fórmulas siguen en la hoja; el botón `documento` las muestra |
| las 6 configuraciones | `reference/full-sheet.js`, corriendo en `verify.mjs` |
| el panel de fórmulas con KaTeX | `git show 61ba683:engine/src/FormulaPanel.vue` y `…:engine/src/latex.js` |
| la pestaña Política | `docs/POLITICA-Y-CALCULO.md` + `POLICIES` en el archivo de referencia |
| las tres zonas rotuladas | con dos nodos no hacían falta |
