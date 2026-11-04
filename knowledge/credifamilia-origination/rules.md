# Credifamilia: preaprobación, identidad y radicación

Qué hace el código con una solicitud de Credifamilia antes y después del plan de pagos: cómo se
lee la preaprobación, cómo cae la validación de identidad a un proveedor de respaldo y cómo se
radica el crédito por SOAP. Describe `pre-approvals-service`, `legacy-backend` y el wizard de
`frontend-monorepo` en las refs de `sources.json`. `application` no tiene la preaprobación por
servicio, CrossCore ni la radicación SOAP: conserva sólo la integración REST anterior con
Credifamilia (OAuth y redirección a su plataforma). La fianza, el monto radicado y el plan de pagos
están en `credifamilia-financing`. Lo que valida Credifamilia de su lado no se puede comprobar en
este código.

## La preaprobación sólo aprueba con estado 3 y «APROBADO»

`pre-approvals-service` traduce la consulta de estado de Credifamilia. Con estado 3 y detalle
«APROBADO» (sin distinguir mayúsculas) la preaprobación queda aprobada; con estado 3 y otro detalle,
rechazada. Los estados 0, 1 y 2 quedan pendientes, y el 4 o cualquier otro, rechazados. El monto
aprobado es `MontoMaximo` cuando es mayor que cero, y la preaprobación vence a los 30 días.
`legacy-backend` descarta la respuesta si su estado no es `approved` o si el producto no coincide
con el de la solicitud.

## Identidad: proveedor primario y respaldos

Los proveedores salen de `lender_identity_validation_types` activos de la entidad: el de orden 1 es
el primario y los demás, en orden, son respaldo. Si el país del comercio no tiene centrales de riesgo
habilitadas, el proveedor es `none`. Esto no es propio de Credifamilia: cualquier entidad con varios
proveedores sigue el mismo camino.

CrossCore cuenta como validado sólo con decisión ACCEPT y `response_code` R0201. Las decisiones se
agrupan así: ACCEPT, CONTINUE y APPROVE continúan; REFER va a revisión manual; REJECT y STOP
rechazan; ERROR es error técnico; NODECISION y cualquier otra van a revisión técnica. NODECISION no
cierra la evaluación: se reintenta, espaciado por el setting `crosscore_nodecision_retry_seconds`.

Cuando ADO o CrossCore terminan sin validar, el wizard pide los respaldos. Si hay uno, cambia de
proveedor y navega según el nuevo tipo: Evidente va a la validación adicional, ADO o CrossCore a sus
instrucciones. Si no hay respaldo, o falla la consulta o el cambio, sigue el destino propio del
proveedor: con CrossCore la solicitud se cancela; con ADO vuelve a la pantalla de reintento con el
mensaje de su estado. Por eso un CONTINUE o APPROVE de CrossCore también termina en el respaldo:
sólo ACCEPT con R0201 valida.

## La radicación tiene dos pasos SOAP

La radicación corre sólo para entidades con `response_type` 4, después de que la autorización ya
quedó confirmada en estado 11 y en su propia transacción. La disparan la autorización con OTP del
pagaré, la reanudación de una autorización diferida por codeudor y la ruta de administración
`user-requests/{id}/formalize-external-managed`, que sirve para reintentarla.

Primero `transaccionConsumo` registra el crédito. El código HTTP se guarda como estado de la
transacción: 200 registrado, 409 duplicado, 400 inválido, y 500, una falla de transporte o
cualquier otro, error. Si la solicitud ya tiene una transacción registrada, duplicada o completada,
no se vuelve a llamar. Un reintento después de un error reescribe la misma fila (clave entidad +
solicitud), pero el código no reintenta solo.

Después `guardarDocumentoOpenKm` envía un único PDF. Se envía en cada formalización, sea cual sea
el estado que dejó el primer paso. Con 200 o 409 la transacción queda completada; con 400, inválida;
con otro código o una falla de transporte, error. Un estado final distinto de completado sólo se
registra en el log: no corta el flujo. El código de solicitud es el id de `user_requests` y el
documento se nombra `<número de documento>-<id de solicitud>`.

El PDF une nueve documentos obligatorios en este orden: formulario de vinculación, tratamiento de
datos, autorización de desembolso a terceros, reglamento, fianza (FGA), pagaré, cédula frontal,
cédula reverso y plan de pagos. Los cinco primeros y el plan de pagos son la firma más reciente de
cada tipo en `netco_signing_documents`; el pagaré, el último de `promissory_notes`; las caras de la
cédula, `users.front_url` y `users.back_url`. Antes de reunirlos, si el usuario tiene un enrolamiento
de ADO, se descargan sus imágenes y se guardan como esas dos URLs; sin enrolamiento de ADO no se
tocan.

Si falta uno, la formalización aborta sin radicar y la autorización responde HTTP 422 con «No se
puede formalizar el crédito Credifamilia: faltan documentos obligatorios: …» y la lista de los
faltantes. Si falla la unión del PDF también aborta sin radicar, pero el error no se traduce a 422.
En los dos casos la solicitud ya está en estado 11, y no corren las notificaciones de autorización,
el comprobante ni el cierre de la solicitud. Las rutas del pagaré responden 403 a una solicitud en
estado 11, así que el cliente no puede reintentar desde el wizard.

## Autorizar no exige que la identidad haya terminado

Entre la selección de la entidad y el estado 11 nada consulta si la validación de identidad terminó
ni si el usuario sigue siendo el temporal (`TEMPORAL USER`). La selección
(`loan-application/update-user-request`) valida los montos y sólo asigna la entidad si la solicitud
no está en estado 11 o 25. Las rutas del pagaré (plan de pagos, envío y verificación del OTP,
autorizar) exigen un celular (desde escritorio responden con el enlace para continuar), que la
solicitud no esté en estado 8 u 11 y que no quede una cuota inicial de ecommerce sin pagar;
`authorize()` exige un OTP validado y aplica la compuerta de codeudor. Para Credifamilia, la primera barrera que depende de la identidad es la
radicación: sin las imágenes de la cédula en `users.front_url` y `users.back_url`, falta la cédula y
responde el 422 de arriba, con la solicitud ya autorizada.

## Qué datos manda la radicación

- Sólo admite cédula de ciudadanía: otro tipo de documento lanza excepción.
- La ocupación (campo 29) define tres códigos. Empleado: actividad 0010, contrato 3, profesión 15.
  Independiente: 0090, 2 y 32. Pensionado: 0020, 4 y 31. Otras ocupaciones van sin esos códigos.
  El tipo de ocupación tiene su propia tabla, y Desempleado se manda provisoriamente como Empleado.
- Valores fijos: país 169, producto «Consumo» / «Consumo en comercio», origen «Creditop»,
  periodicidad «Mensual» y cuota protegida en falso. La fecha de ingreso laboral es un valor fijo
  provisional, sin fuente.
- Creditop calcula el patrimonio (activos − pasivos) y manda `ingresosValidados` en 0. No valida
  que los activos superen un SMMLV, que los pasivos no superen los activos, que los egresos sean
  menores que los ingresos ni que el plazo esté entre los que acepta Credifamilia: eso lo valida
  Credifamilia.
