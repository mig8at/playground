# Credifamilia: fianza y monto de radicación

Para investigar diferencias de montos sin reconstruir la tarea #97. Describe el código de
`legacy-backend` revisado en `sources.json`. La radicación SOAP no aparece en la ref revisada
de `application`; no se traslada este mecanismo al monolito anterior.
Las respuestas del proveedor, los ambientes probados y las decisiones del alcance siguen en la tarea.
El código permite comprobar qué se calcula, no certificar la regla comercial de Credifamilia.

## La fianza viene de la preaprobación

`CredifamiliaPayloadBuilder` consulta `/v1/preapprovals/check` y conserva el resultado por
solicitud dentro de la instancia. Del `transaction_data` toma `guarantee_percentage` como decimal,
`guarantee_type` y las tasas. El plan convierte la TEA porcentual a decimal; no dividir también
el porcentaje de fianza por 100. El IVA predeterminado del builder es `0.19`.

`CredifamiliaConsumoService::buildRequest` transporta tipo y porcentaje de fianza al SOAP.
Por eso el porcentaje participa también en el monto radicado. La tasa mensual SOAP usa
`monthly_rate × 100`, redondeada a dos decimales, con `user_requests.rate` como respaldo.
El tipo interno `Vencida` se traduce a `Mensual`; `Anticipada` conserva su nombre.

## Una fórmula compartida con dos tratamientos de fianza

`BondBreakdown::calculate` calcula, sin redondear cada término:

- fianza = monto solicitado × porcentaje de fianza;
- IVA = fianza × tasa de IVA;
- 4x1000 = IVA × `0.004`;
- total fianza = fianza + IVA + 4x1000.

`totalDisbursement()` suma ese total al monto sólo cuando el tipo es exactamente `Anticipada`.
Con `Vencida` el capital permanece en el monto solicitado. `CalculationContext` utiliza este
desglose para el motor del plan; `TransactionRequest` lo utiliza para `montoTotalCredito`.
Ésta es la fórmula implementada. La confirmación de su base y del redondeo con el proveedor
permanece en #97; verla en código no resuelve esas preguntas.

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

Si falta monto, porcentaje numérico o tipo de fianza de texto, el SOAP avisa por log y usa
`final_amount` con dos decimales, o `null` si tampoco existe. Un tipo desconocido de texto
no activa la suma anticipada y su traducción SOAP puede quedar en `null`.

El builder del plan falla cuando no obtiene preaprobación o `transaction_data`; el resumen
devuelve un error de cálculo. Si el comprobante no consigue el resumen, usa el desglose
genérico para el total y deja vacíos varios componentes de fianza. No inferir que hubo
preaprobación válida o fianza financiada por encontrar un total en cualquiera de esas salidas.
