# Motai: tarifa, documentos por escenario y variables

Cómo están configurados en `legacy-backend` el renting de Motai (slug `motai-renting`) y su
gemelo Rent to Own (slug `rent-to-own`): la calculadora sembrada, qué documentos firma cada rama y
de dónde salen las variables de los contratos, y quién manda los recordatorios de cobro. El
mecanismo general de calculadora, planes y selección de builder está en `renting-plans`, y el del
codeudor en `cosigner-signature`. Lo que
siembran las migraciones es el punto de partida: qué filas siguen activas y con qué valores en un
ambiente es dato de la base. Los ids de las entidades cambian entre ambientes; las migraciones
resuelven el RTO por slug.

## La tarifa del renting

La migración de la calculadora de Motai siembra estos parámetros: alistamiento 1.500.000, margen
1,0, IVA 0,19, `anchor_rate` 0,018 y `months` 24. Las fórmulas se evalúan en orden:

- `amount = (costo + setup_fee) × (1 + margin) × (1 + tax)`: el precio de venta.
- `initial_fee = amount × initial_fee_percentage`: la inicial se calcula sobre el precio, no sobre
  el costo, al revés que en crédito. El porcentaje vale 0 en los parámetros y en la simulación lo
  reemplaza el `min_initial_fee` de la categoría del usuario.
- `payment = (amount − initial_fee) × PMT(anchor_rate, months) / 30 × 7 × factor`: la tarifa
  semanal. El 1,8 % es un parámetro de precio, no un interés, y `months` es el divisor del PMT, no
  el plazo del contrato.

Hay tres planes: Semana (1 semana, factor 1,25), Mes (4 semanas, factor 1,0, el plan por defecto) y
Trimestre (12 semanas, factor 0,94). El plan es la duración del alquiler; siempre se paga semanal y
en cuotas planas, sin amortización.

## El Rent to Own nació como clon

El RTO se creó clonando el lender de renting: mismo `calculator`, planes, corte y líneas de crédito;
no se clonaron categorías de usuario (donde vive `min_initial_fee`), ciudades, métodos de pago,
requisitos ni reglas. Primero quedó con `product = renting` y después una migración lo pasó a `rto`.
Ninguna migración de `main` siembra una calculadora amortizada propia del RTO: lo que el contrato
lee de `calculator.params` (`initial_fee`, `rate`) depende de cómo esté configurado en la base.

El builder del RTO separa dos cifras que en renting son iguales: `valor_financiado` es
`final_amount` y `valor_final` es la cuota por el número de cuotas, que incluye los intereses.
`tasa_mensual` y la `tasa_remuneratoria` del pagaré salen de `calculator.params.rate`, no de
`user_requests.rate`; la del pagaré se imprime con la palabra «mensual» detrás. El cronograma
amortiza con `(1 + rate)^(12/n) − 1`, con n = 52 en los cortes semanales, 24 en el quincenal y 12
en el mensual.

Lo de la inicial sobre el precio y el `min_initial_fee` de la categoría es del renting. En el RTO,
la `cuota_inicial` que imprime el contrato es `calculator.params.initial_fee`, un valor fijo de la
configuración que no pasa por la categoría del usuario. El cronograma arranca el saldo en
`final_amount` porque el builder supone que la fórmula `amount` ya lo deja neto de la inicial: que
lo esté depende de las fórmulas que tenga la calculadora del RTO en la base.

## Documentos que firma cada rama

El catálogo es `lender_signing_documents`, separado por `requires_cosigner`; sólo se usan las filas
con `status = 1`, ordenadas por `sort`. `signed_by_cosigner` dice cuáles firma también el codeudor.
La lista de abajo es lo que SIEMBRAN las migraciones, no lo que firma un ambiente: las dos del
renting escriben sólo si existe un lender con id 158 (lo fijan en una constante, con un TODO de
cambiarlo por el id de producción), y las filas pueden haberse editado o apagado después. Qué filas
hay y cuáles están activas se mide en la base.

- **Renting sin codeudor:** consentimiento, pagaré con carta de instrucciones, plan de pagos,
  garantía FGA (no obligatoria) y contrato de renting.
- **Renting con codeudor:** consentimiento, contrato de renting, acuerdo de codeudoría y pagaré
  (estos tres también los firma el codeudor), plan de pagos y garantía FGA.
- **RTO con codeudor:** contrato con opción de adquisición, acuerdo de codeudoría, pagaré, garantía
  mobiliaria y plan de pagos; los cuatro primeros los firma también el codeudor. La garantía
  mobiliaria es `chattel_mortgage`, un tipo distinto del `guarantee` del FGA, y va después del
  pagaré porque cita su número.
- **RTO sin codeudor:** no tiene filas propias. Existen plantillas `rto/contrato_rto_sin_codeudor` y
  `rto/pagare_carta_sin_codeudor`, pero ninguna migración las asigna: esa rama sigue apuntando a las
  plantillas del renting, es decir, a un contrato sin opción de compra.

La garantía FGA, aunque esté en el catálogo, la decide en ejecución `shouldRequestGuarantee()`
comparando el score de centrales con `lender_guarantee_criteria`; por eso va con `is_required = false`.

El payload no lo elige la plantilla sino `lenders.product` (`CatalogDocumentPayloadResolver`): toda
fila del RTO, también las que apuntan a plantillas de renting, se alimenta con
`MotaiRentToOwnPayloadBuilder`. Si la rama sin codeudor del RTO usa el contrato y el pagaré de
renting, el contrato imprime «pago total de» con el `valor_final` del RTO (cuota por número de
cuotas, con intereses) y el pagaré imprime la `tasa_remuneratoria` del RTO (la tasa de
`calculator.params.rate` seguida de «mensual»), no la de `user_requests`.

Una fila con `status = 0` no se previsualiza, no se firma y no se vuelve a renderizar al cerrar. Si
la garantía mobiliaria del RTO está apagada en un ambiente, el RTO sale sin ella, aunque el contrato
la mencione. La migración del RTO la siembra con `status = 1`, y ninguna otra de `main` la apaga;
el comentario del builder que dice que está en `status = 0` describe un ambiente, no el código. Si
la fila está activa, la prenda se firma con sus quince variables vacías (ver abajo), entre ellas
`monto_maximo_garantizado`.

## De dónde salen las variables

`MotaiRentingPayloadBuilder` arma las variables de renting y RTO:

- Los datos del vehículo (marca, kilometraje, chasis, línea, placa, año) salen de las respuestas del
  formulario dinámico 7 de la solicitud, campos 236 a 241. `direccion_cliente` sale del mismo
  formulario, campo 186. Se leen por solicitud, no por usuario.
- En renting, `tasa_remuneratoria` es `user_requests.rate` con «%» detrás; el RTO la pisa con la
  de su calculadora.
- `numero_contrato` es el `request_number` de la solicitud y `numero_pagare` el id de su fila en
  `promissory_notes`, reservada antes de renderizar para que el número sea el mismo en todos los
  documentos.
- Los montos del plan salen de la calculadora y no de las columnas de la solicitud, porque la
  previsualización corre antes de autorizar. `tipo_plan` es la etiqueta del plan y `vigencia` el
  número de períodos con la unidad del corte.
- El plan de pagos de renting imprime cuotas planas y sin valor financiado.

Las variables sin origen en el sistema se devuelven vacías a propósito, pero no todas llegan a un
PDF:

- Las seis del builder de renting (`ciudad_cliente`, `ciudad_codeudor`, `direccion_codeudor`,
  `tipo_contrato`, `observaciones_adicionales`, `meses_llenado`) no las imprime ninguna plantilla:
  son claves muertas del payload, no huecos visibles.
- Las quince del RTO (cinco datos del vehículo que el formulario no captura —color, cilindraje,
  motor, serie, carrocería— y diez de producto, como `monto_maximo_garantizado` o el representante
  de Motai) las imprime sólo la garantía mobiliaria: salen en blanco cuando esa fila está activa.

Con la identidad del codeudor no hay tolerancia. `CatalogDocumentGenerator` mezcla el payload del
builder con el contexto del llamador (el contexto va después y puede pisar claves) y recién entonces
comprueba: si la fila del catálogo tiene `requires_cosigner` y el payload declara `nombre_codeudor` o
`documento_codeudor` vacíos, lanza `CosignerDataMissingException` y ese documento no se produce. La
condición es la rama de la fila, no quién la firma: en la rama con codeudor corta también el plan de
pagos, que el codeudor no firma, porque tiene plantilla propia y pasa por el mismo generador.

## Los recordatorios de cobro

Los recordatorios de las cuotas de Motai no los manda `application`. Su comando
`app:reminder-creditop-x-requests-command` excluye los créditos cuyo lender tiene `cutoff_type_id`
en `config('reminders.excluded_cutoff_type_ids')`, que es `[3]` (semanal); un lender sin corte no
queda excluido. Los manda `legacy-backend` con `app:reminder-weekly-loans`, programado a diario a las
9:00 de Bogotá, que toma sólo lenders con `cutoff_type_id = 3`: no envía en domingo ni festivo del
país del lender, recupera el estado de cuenta el siguiente día hábil, deduplica por ciclo de pago y
manda un solo recordatorio por cliente y día. Los dos filtros miran el corte 3 exacto: un lender con
el corte semanal de martes (4) no lo excluye `application` ni lo toma el comando semanal.
