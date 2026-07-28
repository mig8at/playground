# Verificación contra los archivos fuente

`node verify.mjs` — **30 puntos de control**, y todos corren contra **la misma hoja**: lo que
cambia entre casos son los valores de la configuración. Eso es lo que prueba la
estandarización — si una sola hoja reproduce cuatro productos al peso, no hace falta una
hoja por producto.

Los archivos originales están en `~/Downloads` (no versionados acá):

- `Calculadora Renting VF.xlsx` — pestañas *Renting* y *Rent to Own*
- `Calculadora PV V20251009.xlsm` y `Calculadora PV V20251009 (1).xlsm`
- `Creditop-ALTA FLEET-270726-203915.pdf` y `motai-manu.pdf`

## Qué se comprueba

| configuración | celdas / valores del original |
|---|---|
| `motai-rto` | `C16/C17/C18` → 230.997,39 · 162.077,90 · 127.814,62, y que 12/18/24 meses den 52/78/104 semanas |
| `motai-renting` | `C13/C14/C15` → 216.470,43 · 173.176,35 · 162.785,76, y `C8` precio de venta 14.360.920 |
| `creditopx-salud` | los **dos** escenarios: Gaes 36m/10%/anticipada y Dentix 6m/9%/mensual — 17 valores |
| `alta-fleet` | punto 9 del PDF: fianza, valor total, cuota, seguro, cuota vehículo y cuota póliza |

Además: que las series cierren en saldo cero (RTO a 104 semanas, salud a 36 meses) y que la
política de Motai dé los tres veredictos esperados para el mismo solicitante.

## Fórmulas derivadas de los originales

Ninguna estaba escrita en prosa; todas salieron de leer las celdas.

```
motai-renting   margin      = (assetCost + setupFee) * marginFactor        ← C6 =+(C4+C5)*D6
                vatAmount   = (base + margin) * vatRate                     ← C7 =+(C4+C5+C6)*D7
                baseWeekly  = pmt(0.018, 24, salePrice) * 7 / 30            ← C14 =-PMT(C10,24,C8)/30*7

motai-rto       marginBase  = assetCost - downPayment + setupFee            ← C7 =+SUM(C4:C6)*D7
                weeklyRate  = (1 + 0.018) ^ (12/52) - 1                     ← C13 =+(1+C12)^0,230769…-1

salud           monthlyRate = (1 + tasaEA) ^ (1/12) - 1                     ← D23
                dailyRate   = (1 + monthlyRate) ^ (1/30) - 1                ← D24
                disbursed   = if(upfront, monto + totalFianza, monto)       ← D19

alta-fleet      guaranteeCost  = (assetCost + gps) * 0.0964                 ← derivada del punto 9
                financedAmount = assetCost + gps + guaranteeCost
                lifeInsurance  = financedAmount * 0.0014
```

## Hallazgos que salieron de verificar

1. **La columna "Semanas" del doc de Manuela está mal.** Dice 12/18/24; los montos solo cuadran
   con **52/78/104**. Son meses mal etiquetados.

2. **El ejemplo del RTO es degenerado.** Con los valores del documento,
   `2 × (−2.000.000 + 1.500.000) + 1.000.000 = 0`: la cuota inicial, el alistamiento y los extras
   **se cancelan exactamente**, y el total coincide por casualidad con `assetCost × 2 × 1,19`.
   Cualquier bug en cómo se combinan esos tres campos pasa ese test sin chistar. Hace falta un
   segundo juego de valores.

3. **Cuatro convenciones de período distintas.** Renting prorratea la cuota (`/30*7`), RTO
   convierte la tasa (`^(12/52)`), salud no convierte y Alta calcula mensual y cobra semanal.
   La brecha renting↔RTO es **+1,11%**. No es un error: renting no amortiza nada (no hay saldo,
   el `PMT` a 24 meses es un ancla de precio), así que el prorrateo es una decisión comercial.
   Pero nunca estuvo escrita.

4. **La vista semanal de Alta no reconcilia.** El punto 9 pide $225.000 semanales fijos; el plan
   mensual da 764.855 y ninguna conversión (12/52, ÷4, 7/30) llega. En el contrato completo son
   **+33,2%** (17,55M contra 13,17M). Y la cuota del core es escalonada —la póliza son 10 cuotas
   y la moto 18— mientras la del cliente es plana.

5. **`Score mínimo titular` se contradice**: R3 dice 400, la sección 5 dice 0.

6. **Hueco de 100.000 pesos en la tabla de perfiles**: "≥3.000.000 → directa" y "<2.900.000 →
   condicional" dejan la banda 2.900.000–2.999.999 sin regla. La política la manda a
   `revision_manual` con nota, en vez de dejarla caer en silencio.

## Pendiente con Manuela

1. ¿De dónde salen los $225.000 semanales de Alta? ¿Y quién absorbe el escalón del mes 11?
2. El RTO cobra IVA sobre una base a la que ya se le restó la cuota inicial — ¿un mayor enganche
   debe bajar el IVA, o el IVA va sobre el precio de venta?
3. El margen del RTO también se calcula después de restar el enganche: más cuota inicial, menos
   margen para el comercio. ¿Intencional?
4. El +1,11% del renting, ¿es margen buscado o quedó sin querer?
5. Score mínimo del titular: ¿400 o 0?
6. Renting: la tarifa sale de amortizar a 24 meses pero el plan solo cubre 1/4/12 semanas.
   ¿El compromiso máximo es de 12 semanas?
7. Hace falta un segundo juego de valores del RTO que no sea degenerado.

> El PDF de Alta trae un **API token de Ábaco en texto plano** (staging). Conviene rotarlo y
> sacarlo del documento.
