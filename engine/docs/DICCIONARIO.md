# Diccionario de términos

El vocabulario compartido por todas las hojas y políticas. **El diccionario no guarda valores**:
define qué significa cada palabra, su tipo y su unidad. El valor lo pone cada hoja — `lifeInsuranceFactor`
vale `0.0014` en Alta y `0.001307` en salud, y las dos son correctas.

De los 59 términos, solo unos **6 tienen valor universal**: las cuatro constantes de tiempo,
`vatRate` y `financialTransactionTaxRate`.

## Convenciones

- `camelCase`. Sufijo `Rate` = tasa o porcentaje · `Factor` = multiplicador · sin sufijo = plata.
  La unidad va en el nombre cuando es tiempo (`termMonths`, `daysPerWeek`).
- **Tasas en decimal**: `0.19`, no `19`.
- **Todo positivo**: sin signos invertidos.
- Dos opciones → **booleano**. N opciones con datos → **tabla de clave numérica**. Nunca un string.

Marcas: **●** input (lo manda el llamador, no se guarda) · **○** constante (vive en la hoja) ·
**▷** derivado (es una fórmula).

## Conceptos de finanzas, en cristiano

**E.A. vs M.V.** La *Efectiva Anual* es lo que cuesta la plata en un año con los intereses ya
capitalizados; es la que la ley obliga a publicar. La *Mes Vencido* es lo que se cobra cada mes
sobre el saldo que quedó. **No se pasa de una a otra dividiendo por 12**: `(1+EA)^(1/12) − 1`.
28,17% E.A. → 2,09% mensual, no 2,35%.

**Sistema francés.** La cuota es igual todos los períodos, pero su composición cambia: al principio
casi todo es interés, al final casi todo es capital. Es lo que hace `pmt`.

**Fianza.** Un tercero (Novafianza, FGA, FNG) le responde al prestamista si el cliente no paga.
Reemplaza al codeudor de carne y hueso, **y la paga el cliente** — se suma al monto financiado.

**Canon vs cuota.** El mismo número con distinto nombre legal. En arriendo se dice *canon*;
decirle *cuota de crédito* convierte el contrato en otra cosa. Alta lo exige por escrito.

**4×1000.** Impuesto colombiano (GMF): 0,4% cada vez que se mueve plata por el sistema financiero.

---

## A · Tiempo

| término | | tipo | qué es |
|---|---|---|---|
| `daysPerWeek` | ○ | count | 7 |
| `daysPerMonth` | ○ | count | **30**, no 30,44. Convención comercial de "año de 360 días" que usa la banca colombiana para prorratear. No es el calendario — que alguien lo "corrija" rompe todo |
| `weeksPerYear` | ○ | count | 52 |
| `monthsPerYear` | ○ | count | 12 |

## B · Tasas

| término | | tipo · unidad | qué es |
|---|---|---|---|
| `annualEffectiveRate` | ● | rate · decimal anual | La E.A. `0.2817` = 28,17% |
| `monthlyRate` | ●▷ | rate · decimal mensual | La M.V. `0.0187`. A veces entra directa (Motai la tiene fija), a veces se deriva de la E.A. |
| `weeklyRate` | ▷ | rate · decimal semanal | `(1+monthlyRate)^(monthsPerYear/weeksPerYear) − 1` |
| `dailyRate` | ▷ | rate · decimal diaria | `(1+monthlyRate)^(1/daysPerMonth) − 1`. Para los días sueltos antes de la 1ª cuota |
| `lateInterestRate` | ○ | rate · decimal mensual | La de mora |

## C · Armado del precio

| término | | tipo | qué es |
|---|---|---|---|
| `assetCost` | ● | money | Lo que le cuesta la moto al comercio, sin margen |
| `setupFee` | ○ | money | "Alistamiento": dejar la moto lista — papeles, matrícula, entrega |
| `extras` | ● | money | Accesorios opcionales |
| `downPayment` | ● | money | Cuota inicial. **Positivo**; la fórmula lo resta |
| `marginFactor` | ○ | factor | Multiplicador de la ganancia. `1` = el comercio duplica su base |
| `salePrice` | ▷ | money | Precio final al público, con margen e IVA |
| `gpsDevicePrice` | ● | money | El equipo GPS, se financia con la moto |
| `financedAmount` | ▷ | money | Sobre **este** número corren los intereses |
| `disbursedAmount` | ▷ | money | Lo que sale de caja. Difiere del anterior si la fianza va anticipada |
| `requestedAmount` | ● | money | Lo que el cliente pide |
| `maxAmount` | ○▷ | money | Techo por comercio (12.000.000 en salud). Sale de la tabla |

## D · Impuestos y costos asociados

| término | | tipo | qué es |
|---|---|---|---|
| `vatRate` | ○ | rate · decimal | IVA. `0.19` |
| `financialTransactionTaxRate` | ○ | rate · decimal | El 4×1000. `0.004` |
| `guaranteeRate` | ● | rate · decimal | % de la fianza. `0.0964` en Alta, `0.09`–`0.10` en salud |
| `guaranteeCost` | ▷ | money | La fianza en pesos |
| `guaranteeFundRate` | ○ | rate · decimal | FNG, Fondo Nacional de Garantías (estatal). `0.031` |
| `guaranteePaidUpfront` | ● | **bool** | `true` = se suma al desembolso · `false` = mensualizada |
| `lifeInsuranceFactor` | ○ | factor | Seguro de vida deudores: si el cliente muere, la aseguradora paga el saldo. `0.0014` = 1.400 pesos por millón al mes |
| `lifeInsurancePremium` | ▷ | money | La prima mensual |
| `gpsMonthlyFee` | ○ | money | Canon del GPS. `20.000` |

## E · Plazos

| término | | tipo | qué es |
|---|---|---|---|
| `termMonths` | ● | count · meses | 12, 18, 24, 36 |
| `termWeeks` | ▷ | count · semanas | `termMonths × weeksPerYear / monthsPerYear` → 52, 78, 104 |
| `anchorTermMonths` | ○ | count · meses | Solo renting: plazo **ficticio** (24) para fijar el precio del arriendo, no para cobrarlo |
| `planDurationWeeks` | ● | count · semanas | Duración del plan de renting: 1, 4 o 12 |
| `firstPeriodDays` | ● | count · días | Días entre desembolso y 1ª cuota. **Lo calcula el llamador** |

## F · Resultados de pago

| término | | tipo | qué es |
|---|---|---|---|
| `installment` | ▷ | money | La cuota pelada, sin seguros ni GPS |
| `weeklyRent` | ▷ | money | El **canon** semanal. Mismo número, nombre de arriendo |
| `totalInstallment` | ▷ | money | Cuota + seguro + GPS. Lo que de verdad paga |
| `principalPortion` | ▷ | money | La parte que baja la deuda |
| `interestPortion` | ▷ | money | La parte que se lleva el prestamista |
| `openingBalance` | ▷ | money | Saldo al empezar el período |
| `closingBalance` | ▷ | money | Saldo al terminar. El de una fila es el `opening` de la siguiente |

## G · Riesgo — van en las políticas, no en las hojas

| término | | tipo | qué es |
|---|---|---|---|
| `creditScore` | ● | count · puntos | Datacrédito, escala ~0–950 |
| `monthlyIncome` | ● | money | Ingreso mensual verificado |
| `weeklyIncome` | ▷ | money | `monthlyIncome × monthsPerYear / weeksPerYear` |
| `existingDebt` | ● | money | Deudas que ya tiene |
| `overdueAmount` | ● | money | Moras vigentes en centrales |
| `netWorth` | ● | money | Patrimonio |
| `incomeVerifiedByApp` | ● | **bool** | `true` = conductor de app, ingreso vía Ábaco · `false` = empleado o independiente (AgilData / Mareigua / TusDatos) |
| `minCreditScore` | ○ | count | `400` |
| `minWeeklyRent` | ○ | money | `150000` |
| `maxWeeklyRent` | ○ | money | `300000` |
| `maxIncomeShare` | ○ | rate · decimal | `0.25` — el canon no puede pasar del 25% del ingreso semanal |
| `maxDebtToIncome` | ○ | rate · decimal | `0.40` |
| `maxDebtToNetWorth` | ○ | rate · decimal | `0.50` |

## H · Cartera

| término | | tipo | qué es |
|---|---|---|---|
| `daysElapsed` | ● | count · días | Días corridos desde el último corte |
| `daysOverdue` | ● | count · días | Días en mora |
| `collectionFeeRate` | ○ | rate · decimal | Gasto de cobranza |
| `daysToCollectionFee` | ○ | count · días | Desde cuántos días de mora se cobra |
| `paymentAmount` | ● | money | Lo que el cliente efectivamente pagó |

---

## El conteo

| | cuántos | dónde están |
|---|---|---|
| ● inputs | ~21 | solo declarados. Viajan en cada llamada, no se guardan |
| ▷ derivados | ~16 | son fórmulas, no valores |
| ○ constantes | ~22 | **los únicos valores guardados** |

Y esos 22 están repartidos: cada hoja usa entre 5 y 7. **Entre los seis JSON del sistema hay menos
de 30 números.** Lo que parecía mucho eran las palabras, no los datos.
