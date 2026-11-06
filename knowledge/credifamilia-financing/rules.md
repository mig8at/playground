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
solicitud y conserva el resultado por solicitud dentro de la instancia. Sólo acepta la respuesta
si es 2xx, trae `status === 'approved'` y su `lending_product_id` es idéntico, como texto, al id de
la entidad que envió (un id numérico no coincide); un fallo de conexión, otro estado o un id
distinto se tratan igual que no haber preaprobación. Del `transaction_data` toma la TEA y el
porcentaje de seguro de vida, y el builder divide los dos por 100 antes del motor. El IVA predeterminado del builder es `0.19`. El
`max_amount` se guarda en `partner_limits` bajo el nombre del comercio de la solicitud, o `Gaes`
si no tiene comercio; es sólo la clave con la que el motor lo vuelve a leer, no cambia el valor.

`resolveBond` es la única fuente de la fianza para el plan y para la radicación:

- Salud toma `guarantee_percentage` (ya decimal: no dividirlo por 100) y `guarantee_type` de la
  preaprobación, y cobra 4x1000.
- Materiales toma el porcentaje de `lender_term_fng_percentages` según el plazo, fuerza el tipo
  `Anticipada` sin mirar la preaprobación y no cobra 4x1000. Un plazo sin fila en esa tabla falla
  explícito (`INVALID_TERM`, con los plazos configurados en el mensaje, o «ninguno»), nunca
  calcula con cero. El plan resuelve el porcentaje con el plazo de cada opción que recorre; la
  radicación, con `fee_number` de la solicitud.

Las filas de Materiales las siembra una migración con los plazos 12, 18, 24, 36, 48 y 60, para el
id de Materiales del ambiente según `APP_ENV`. Si esa entidad no existe en la base cuando corre, no
inserta nada y no falla; no vuelve a correr cuando la entidad aparece después. Sin filas para la
entidad, todo plazo falla, en el plan y en la radicación; con la siembra, 6 y 9 siguen sin fila.

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
convierte a entero. `(int)` trunca, no redondea: si `amount` tiene centavos, el SOAP los
descarta y `montoSolicitado` y la base de `montoTotalCredito` quedan por debajo de `amount`. El
builder predeterminado del plan usa entero, pero `CredifamiliaPaymentPlanSummaryService` lo
sobrescribe con `(float) user_requests.amount`. Con centavos, las bases difieren aunque ambos
usen `BondBreakdown`. Sólo el respaldo a `final_amount` (sección siguiente) conserva decimales.

El comprobante toma `credit_conditions.total_disbursement` del resumen cuando éste existe,
y lo pasa a `PayloadFormatters::currency`: convierte a entero y muestra cero decimales.
Un capital de `2430113.60` puede imprimirse como `2.430.113`. Comparar el cálculo numérico
antes de comparar el texto del PDF; no afirmar igualdad exacta por usar la misma fórmula.

## Los respaldos también son distintos

La radicación llama a `resolveBond` en modo blando. En Salud, si falta monto, porcentaje numérico
o tipo de fianza, el SOAP avisa por log y usa `final_amount` con dos decimales, o `null` si
tampoco existe; `tipoFianza` va en `null`. Ese modo blando sólo cubre un `guarantee_type` ausente,
`null` o vacío. Un valor presente que no sea `1`, `2`, `FIANZA_VENCIDA` o `FIANZA_ANTICIPADA`
lanza `Unknown guarantee_type` al armar el pedido, y `finalize` lo registra y lo vuelve a lanzar:
no se radica. En Materiales no hay modo blando para el porcentaje: un plazo sin fila FNG hace
fallar la radicación.

La radicación no exige preaprobación. Si `getLastPreApprovalData` devuelve `null` (cualquiera de
los rechazos de la sección anterior), sigue con `transaction_data` vacío: `tasaEfectivaAnual` va
en `null` y `tasaMensual` cae a `user_requests.rate` redondeada a dos decimales. En Salud la fianza
cae al respaldo de `final_amount`. En Materiales, el tipo forzado `Anticipada` y el porcentaje de
la tabla FNG no dependen de la preaprobación, así que `montoTotalCredito` igual se calcula con la
fianza financiada.

El builder del plan falla cuando no obtiene preaprobación o `transaction_data`, o cuando el plazo
no está en la tabla FNG; el resumen devuelve un error de cálculo. El resumen también falla si la
solicitud no tiene una entidad Credifamilia. `OnboardingPayloadBuilder` recibe el resumen y el
desglose genérico del contenedor: el constructor los declara anulables sin valor por defecto, y
sólo quien lo construye a mano y pasa `null` lo deja sin ellos. Si el comprobante no consigue el
resumen (servicio nulo, excepción o `success: false`), usa el desglose genérico para el total y
deja vacíos varios componentes de fianza. No
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

El plan de cuotas sólo acepta los días de pago 2 y 16, y el servicio de fechas ofrece las dos
próximas que cumplen la regla de 30 días. El resumen no valida el día: lo toma de
`selected_payment_date`, con desembolso hoy. El listado de plazos recorre los `fee_numbers` de la línea de crédito de la
entidad de la solicitud, calcula con día 2 y desembolso hoy, y muestra la cuota 2 como
representativa porque la 1 lleva el interés diario.

Límites: el Days360 del código sólo ajusta el día 31, no el fin de febrero como DAYS360 de Excel, y
la calculadora del proveedor cuenta los 30 días en días calendario: en los bordes de mes la primera
fecha puede diferir. El seguro se calcula sobre el total a desembolsar, no sobre el monto
solicitado. `max_amount` de la preaprobación debe ser mayor que cero, pero no topa el monto: el
motor sólo deriva `available_amount` (total − máximo). El listado de plazos, en cambio, expone
como `available_amount` el propio `max_amount`, y como `interest_rate` la tasa mensual.
