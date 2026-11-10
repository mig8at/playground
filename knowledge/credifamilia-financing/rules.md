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

`PaymentPlanPayloadBuilder` (`App\Services\PaymentPlan\DelegatedOrigination`) toma los insumos
de la fuente que nombra el perfil de la entidad (`delegated_origination_profiles.inputs_source`,
resuelta por `DelegatedOriginationInputsSources`). Para Salud y Materiales es
`credifamilia_pre_approval`: `CredifamiliaPreApprovalInputs` consulta `/v1/preapprovals/check` con
la key `credifamilia` y el id de la entidad como `lending_product_id`. El builder conserva el
resultado por solicitud dentro de la instancia (por solicitud y entidad cuando quien llama pasa la
entidad explícita). Sólo acepta la respuesta si es 2xx, trae `status === 'approved'` y su
`lending_product_id` es idéntico, como texto, al id de la entidad que envió (un id numérico no
coincide); un fallo de conexión, otro estado o un id distinto se tratan igual que no haber
preaprobación. Del `transaction_data` toma la TEA y el porcentaje de seguro de vida, y el builder
divide los dos por 100 antes del motor. El IVA predeterminado del builder (`DEFAULT_IVA_RATE`) es
`0.19`. El `max_amount` se guarda en `partner_limits` bajo el nombre del comercio de la solicitud,
o `Gaes` si no tiene comercio; es sólo la clave con la que el motor lo vuelve a leer, no cambia el
valor.

La entidad con la que se calcula es la que pasa quien llama o, sin ella, la de la solicitud si es
de Credifamilia (`CredifamiliaLenders::engineLenderIdFor`), y Salud en cualquier otro caso. Su perfil
es su fila en `delegated_origination_profiles`, leída por `DelegatedOriginationLenderProfile::forLender`:
una entidad sin fila, o con `payment_days` vacío, lanza `InvalidArgumentException` y nunca toma el
perfil de otra.

`resolveBond` es la única fuente de la fianza para el plan y para la radicación, y la decide el
perfil:

- `bond_percentage_source = pre_approval` (Salud) toma `guarantee_percentage` (ya decimal: no
  dividirlo por 100) de la preaprobación, y `guarantee_type` porque su `forced_bond_type` es null.
- `bond_percentage_source = fng_table` (Materiales) toma el porcentaje de
  `lender_term_fng_percentages` según el plazo, y su `forced_bond_type = 'Anticipada'` fija el tipo
  sin mirar la preaprobación. Un plazo sin fila en esa tabla falla explícito (`INVALID_TERM`, con
  los plazos configurados en el mensaje, o «ninguno»), nunca calcula con cero. El plan resuelve el
  porcentaje con el plazo de cada opción que recorre; la radicación, con `fee_number` de la
  solicitud.
- `applies_four_per_thousand` decide el 4x1000. La siembra lo deja en verdadero para las dos
  entidades: Materiales también lo cobra. El builder sólo agrega `apply_four_per_thousand=false`
  al payload cuando el perfil lo apaga.

Los perfiles y las filas FNG de Materiales los siembran migraciones con el id de Materiales del
ambiente según `APP_ENV` (`CredifamiliaLenders::materialesLenderId()`); la tabla FNG recibe los
plazos 12, 18, 24, 36, 48 y 60. Si la entidad no existe en la base cuando corren, no insertan nada
y no fallan; no vuelven a correr cuando la entidad aparece después, y no pisan una fila ya cargada.
Sin perfil la entidad no calcula. Sin filas FNG para la entidad, todo plazo falla, en el plan y en
la radicación; con la siembra, 6 y 9 siguen sin fila.

`CredifamiliaConsumoService::buildRequest` transporta tipo y porcentaje de fianza al SOAP, y marca
`apply_four_per_thousand=false` cuando el perfil no lo cobra. Con fianza Anticipada la fianza
participa también en el monto radicado; con Vencida, `montoTotalCredito` es el monto solicitado
(`BondBreakdown`, `TransactionRequest`). La tasa mensual SOAP usa `monthly_rate × 100`, redondeada a dos decimales,
con `user_requests.rate` como respaldo. El tipo interno `Vencida` se traduce a `Mensual`;
`Anticipada` conserva su nombre. `verticalComercio` no sale del perfil del riel: lo da
`CredifamiliaLenders::soapVerticalFor` por id (`Salud` o `Materiales`), y lanza con un id que no
es de Credifamilia; pero la radicación lo llama con `engineLenderIdFor(lender_id)`, que resuelve
antes un id ajeno a Salud, así que ahí no lanza.

## Una fórmula compartida con dos tratamientos de fianza

`BondBreakdown::calculate` (`App\Services\PaymentPlan\DelegatedOrigination\ValueObjects`)
calcula, sin redondear cada término:

- fianza = monto solicitado × porcentaje de fianza;
- IVA = fianza × tasa de IVA;
- 4x1000 = (fianza + IVA) × `0.004`, o cero si el perfil de la entidad no lo cobra
  (`applies_four_per_thousand`); los perfiles sembrados de Salud y Materiales lo cobran;
- total fianza = fianza + IVA + 4x1000.

Cuando aplica, el 4x1000 se cobra sobre la fianza más su IVA, no sólo sobre el IVA como en el
ejemplo del alcance; el comentario de la clase atribuye esa base a una confirmación de
Credifamilia. Sin la marca explícita se aplica. `totalDisbursement()` suma el total de fianza al
monto sólo cuando el tipo es exactamente `Anticipada`. Con `Vencida` el capital permanece en el
monto solicitado; Materiales nunca llega a ese caso porque su perfil fuerza el tipo
(`forced_bond_type = 'Anticipada'`). `CalculationContext` utiliza este desglose para el motor del
plan; `TransactionRequest` lo utiliza para `montoTotalCredito`. Ésta es la fórmula implementada; el
redondeo que espera el proveedor no se resuelve leyendo el código y sigue en #97.

## Compartir fórmula no garantiza montos ni formatos idénticos

La radicación calcula sobre `(int) user_requests.amount` y expone `montoTotalCredito` como
texto con dos decimales (`round` seguido de `number_format`). `montoSolicitado` también se
convierte a entero. `(int)` trunca, no redondea: si `amount` tiene centavos, el SOAP los
descarta y `montoSolicitado` y la base de `montoTotalCredito` quedan por debajo de `amount`. El
builder predeterminado del plan (`PaymentPlanPayloadBuilder`) usa entero, pero
`PaymentPlanSummaryService` (`App\Services\PaymentPlan\DelegatedOrigination\PaymentPlanSummary`) lo
sobrescribe con `(float) user_requests.amount`. Con centavos, las bases difieren aunque ambos
usen `BondBreakdown`. Sólo el respaldo a `final_amount` (sección siguiente) conserva decimales.

El comprobante toma `credit_conditions.total_disbursement` del resumen cuando éste existe,
y lo pasa a `PayloadFormatters::currency`: convierte a entero y muestra cero decimales.
Un capital de `2430113.60` puede imprimirse como `2.430.113`. Comparar el cálculo numérico
antes de comparar el texto del PDF; no afirmar igualdad exacta por usar la misma fórmula.

## Los respaldos también son distintos

La radicación llama a `resolveBond` en modo blando. En Salud, si falta monto, porcentaje numérico
o tipo de fianza, el SOAP avisa por log y usa `final_amount` con dos decimales, o `null` si
tampoco existe; `tipoFianza` va en `null` sólo si falta el tipo (si falta monto o porcentaje, el tipo se
manda igual). Ese modo blando sólo cubre un `guarantee_type` ausente,
`null` o vacío. Un valor presente que no sea `1`, `2`, `FIANZA_VENCIDA` o `FIANZA_ANTICIPADA`
lanza `Unknown guarantee_type` al armar el pedido (sólo cuando el perfil no fuerza el tipo, como
Salud: Materiales tiene `forced_bond_type`), y `finalize` lo registra y lo vuelve a lanzar:
no se radica. En Materiales no hay modo blando para el porcentaje: un plazo sin fila FNG hace
fallar la radicación. Tampoco lo hay para el perfil: una entidad sin fila en
`delegated_origination_profiles` hace fallar el plan y la radicación.

La radicación no exige preaprobación. Si `PaymentPlanPayloadBuilder::getLastPreApprovalData`
devuelve `null` (cualquiera de los rechazos de la sección anterior), sigue con `transaction_data`
vacío: `tasaEfectivaAnual` va en `null` y `tasaMensual` cae a `user_requests.rate` redondeada a dos
decimales. En Salud la fianza cae al respaldo de `final_amount`. En Materiales, el tipo que fuerza
el perfil (`Anticipada`) y el porcentaje de la tabla FNG no dependen de la preaprobación, así que
`montoTotalCredito` igual se calcula con la fianza financiada.

El builder del plan falla cuando no obtiene preaprobación o `transaction_data`, o cuando el plazo
no está en la tabla FNG; el resumen (`PaymentPlanSummaryService`) devuelve un error de cálculo. El
resumen también responde `USER_REQUEST_NOT_FOUND` si la solicitud no es de una entidad del riel
(`response_type` 4). `OnboardingPayloadBuilder` recibe el resumen y el desglose genérico del
contenedor: el constructor los declara anulables sin valor por defecto, y sólo quien lo construye a
mano y pasa `null` lo deja sin ellos. Si el comprobante no consigue el resumen (servicio nulo,
excepción o `success: false`), usa el desglose genérico para el total y deja vacíos los
componentes de fianza (`bond_base`, `bond_iva`, `bond_fee`, `total_bond`, `bond_percentage`,
`fianza_amount`, `fianza_type`). No inferir que hubo preaprobación válida o fianza financiada por
encontrar un total en cualquiera de esas salidas.

## El plan de pagos: tasas, fechas y cuotas

El motor del plan (`CalculationContext` y `ScheduleGenerator`, en
`App\Services\PaymentPlan\DelegatedOrigination\Engine`) convierte la TEA de los insumos a tasa
mensual `(1+TEA)^(1/12) − 1` y a tasa diaria `(1+TEA)^(1/360) − 1`, sin redondear. La primera
cuota cae el día de pago del mes siguiente al desembolso; si entre las dos fechas hay menos de 30
días contados con Days360, se corre un mes más. Un día de pago mayor al último del mes se recorta a
ese último día.

- Los días de interés diario son `Days360(desembolso, primera cuota) − 30`, y ese interés (total a
  desembolsar × tasa diaria × días) se cobra sólo en la cuota 1.
- La cuota base es `PMT(tasa mensual, plazo, total a desembolsar)`; el abono a capital es la cuota
  base menos el interés del saldo, y la última cuota toma el saldo que quede para cerrar en cero.
- Cada cuota suma, fijos, el seguro de vida (total a desembolsar × `life_insurance_percentage`/100
  de los insumos) y, si la fianza es Vencida, total de fianza / plazo. Con Anticipada la fianza
  ya está en el capital y no se cobra por cuota.

Tasa, seguro y máximo salen de la fuente que nombra el perfil de la entidad
(`delegated_origination_profiles.inputs_source`); para Salud y Materiales es la preaprobación de
Credifamilia (`credifamilia_pre_approval`). Los días de pago también son del perfil
(`payment_days`): la siembra de Credifamilia les pone 2 y 16. El plan de cuotas
(`InstallmentPlanService`) sólo acepta los días del perfil de la entidad de la solicitud
(`INVALID_PAYMENT_DAY` si no), y el servicio de fechas (`PaymentPlanDatesService`) ofrece las dos
próximas, entre esos días, que cumplen la regla de 30 días. Una entidad sin perfil no calcula. El
resumen no valida el día: lo toma de `selected_payment_date`, con desembolso hoy. Cuando el cliente
todavía no eligió, el builder usa el primer día del perfil (`defaultPaymentDay`). El listado de
plazos (`PaymentPlanLoanOptionsService`) recorre los `fee_numbers` de la línea de crédito de la
entidad con la que calcula (la de la ruta, o la de la solicitud si es Credifamilia, o Salud),
calcula con ese día por omisión y desembolso hoy, y muestra la cuota 2 como representativa porque
la 1 lleva el interés diario.

Límites: el Days360 del código sólo ajusta el día 31, no el fin de febrero como DAYS360 de Excel, y
la calculadora del proveedor cuenta los 30 días en días calendario: en los bordes de mes la primera
fecha puede diferir. El seguro se calcula sobre el total a desembolsar, no sobre el monto
solicitado. `max_amount` de los insumos debe ser mayor que cero, pero no topa el monto: el
motor sólo deriva `available_amount` (total − máximo). El listado de plazos, en cambio, expone
como `available_amount` el propio `max_amount`, y como `interest_rate` la tasa mensual.
