# Credifamilia: fianza y monto de radicación

Para investigar diferencias de montos sin reconstruir la tarea #97. Describe el código de
`legacy-backend` revisado en `sources.json`. La radicación SOAP no aparece en la ref revisada
de `application`; no se traslada este mecanismo al monolito anterior.
Las respuestas del proveedor, los ambientes probados y las decisiones del alcance siguen en la tarea.
El código permite comprobar qué se calcula, no certificar la regla comercial de Credifamilia.

El motor del plan y el SOAP sirven a dos entidades, listadas sólo en `CredifamiliaLenders`:
Salud (24) y Materiales, cuyo id depende del ambiente (214 en producción, 216 fuera de ella; nunca
los dos a la vez). Una solicitud sin entidad Credifamilia se calcula como Salud. Lo que cambia entre
ellas vive en `CredifamiliaLenderProfile`; un id fuera de la lista lanza excepción en lugar de
caer en Salud.

## La fianza la decide el perfil de la entidad

`CredifamiliaPayloadBuilder` consulta `/v1/preapprovals/check` con el id de la entidad de la
solicitud y conserva el resultado por solicitud dentro de la instancia. Del `transaction_data`
toma las tasas; el plan convierte la TEA porcentual a decimal. El IVA predeterminado del builder
es `0.19`.

`resolveBond` es la única fuente de la fianza para el plan y para la radicación:

- Salud toma `guarantee_percentage` (ya decimal: no dividirlo por 100) y `guarantee_type` de la
  preaprobación, y cobra 4x1000.
- Materiales toma el porcentaje de `lender_term_fng_percentages` según el plazo, fuerza el tipo
  `Anticipada` sin mirar la preaprobación y no cobra 4x1000. Un plazo sin fila en esa tabla falla
  explícito, nunca calcula con cero. El plan resuelve el porcentaje con el plazo de cada opción que
  recorre; la radicación, con `fee_number` de la solicitud.

`CredifamiliaConsumoService::buildRequest` transporta tipo y porcentaje de fianza al SOAP, y marca
`apply_four_per_thousand=false` cuando la entidad no lo cobra. Por eso la fianza participa también
en el monto radicado. La tasa mensual SOAP usa `monthly_rate × 100`, redondeada a dos decimales,
con `user_requests.rate` como respaldo. El tipo interno `Vencida` se traduce a `Mensual`;
`Anticipada` conserva su nombre. `verticalComercio` sale del perfil: `Salud` o `Materiales`.

## Una fórmula compartida con dos tratamientos de fianza

`BondBreakdown::calculate` calcula, sin redondear cada término:

- fianza = monto solicitado × porcentaje de fianza;
- IVA = fianza × tasa de IVA;
- 4x1000 = (fianza + IVA) × `0.004`, o cero si la entidad no lo cobra (Materiales);
- total fianza = fianza + IVA + 4x1000.

Cuando aplica, el 4x1000 se cobra sobre la fianza más su IVA, no sólo sobre el IVA como en el
ejemplo del alcance; el comentario de la clase atribuye esa base a una confirmación de
Credifamilia. Sin la marca explícita se aplica. `totalDisbursement()` suma el total de fianza al
monto sólo cuando el tipo es exactamente `Anticipada`. Con `Vencida` el capital permanece en el
monto solicitado; Materiales nunca llega a ese caso porque su tipo está forzado.
`CalculationContext` utiliza este desglose para el motor del plan; `TransactionRequest` lo utiliza
para `montoTotalCredito`. Ésta es la fórmula implementada; el redondeo que espera el proveedor no
se resuelve leyendo el código y sigue en #97.

## Compartir fórmula no garantiza montos ni formatos idénticos

La radicación calcula sobre `(int) user_requests.amount` y expone `montoTotalCredito` como
texto con dos decimales (`round` seguido de `number_format`). `montoSolicitado` también se
convierte a entero. El builder predeterminado del plan usa entero, pero
`CredifamiliaPaymentPlanSummaryService` lo sobrescribe con `(float) user_requests.amount`.
Si el monto tiene centavos, las bases pueden diferir aunque ambos usen `BondBreakdown`.

El comprobante toma `credit_conditions.total_disbursement` del resumen cuando éste existe,
y lo pasa a `PayloadFormatters::currency`: convierte a entero y muestra cero decimales.
Un capital de `2428673.60` puede imprimirse como `2.428.673`. Comparar el cálculo numérico
antes de comparar el texto del PDF; no afirmar igualdad exacta por usar la misma fórmula.

## Los respaldos también son distintos

En Salud, si falta monto, porcentaje numérico o tipo de fianza de texto, el SOAP avisa por log y
usa `final_amount` con dos decimales, o `null` si tampoco existe. Un tipo desconocido de texto
no activa la suma anticipada y su traducción SOAP puede quedar en `null`. En Materiales no hay ese
modo blando para el porcentaje: un plazo sin fila FNG hace fallar la radicación.

El builder del plan falla cuando no obtiene preaprobación o `transaction_data`, o cuando el plazo
no está en la tabla FNG; el resumen devuelve un error de cálculo. Si el comprobante no consigue el
resumen, usa el desglose genérico para el total y deja vacíos varios componentes de fianza. No
inferir que hubo preaprobación válida o fianza financiada por encontrar un total en cualquiera de
esas salidas.

## El plan de pagos: tasas, fechas y cuotas

El motor del plan (`CalculationContext` y `ScheduleGenerator`) convierte la TEA de la preaprobación
a tasa mensual `(1+TEA)^(1/12) − 1` y a tasa diaria `(1+TEA)^(1/360) − 1`, sin redondear. La primera
cuota cae el día de pago del mes siguiente al desembolso; si entre las dos fechas hay menos de 30
días contados con Days360, se corre un mes más. Un día de pago mayor al último del mes se recorta a
ese último día.

- Los días de interés diario son `Days360(desembolso, primera cuota) − 30`, y ese interés (total a
  desembolsar × tasa diaria × días) se cobra sólo en la cuota 1.
- La cuota base es `PMT(tasa mensual, plazo, total a desembolsar)`; el abono a capital es la cuota
  base menos el interés del saldo, y la última cuota toma el saldo que quede para cerrar en cero.
- Cada cuota suma, fijos, el seguro de vida (total a desembolsar × `life_insurance_percentage`/100
  de la preaprobación) y, si la fianza es Vencida, total de fianza / plazo. Con Anticipada la fianza
  ya está en el capital y no se cobra por cuota.

Sólo se aceptan los días de pago 2 y 16; el servicio de fechas ofrece las dos próximas que cumplen
la regla de 30 días. El listado de plazos recorre los `fee_numbers` de la línea de crédito de la
entidad de la solicitud, calcula con día 2 y desembolso hoy, y muestra la cuota 2 como
representativa porque la 1 lleva el interés diario.

Límites: el Days360 del código sólo ajusta el día 31, no el fin de febrero como DAYS360 de Excel, y
la calculadora del proveedor cuenta los 30 días en días calendario: en los bordes de mes la primera
fecha puede diferir. El seguro se calcula sobre el total a desembolsar, no sobre el monto
solicitado. `max_amount` de la preaprobación debe ser mayor que cero, pero no topa el monto: sólo
produce `available_amount` (total − máximo).
