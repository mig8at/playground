# Credifamilia: preaprobación, identidad y radicación

Qué hace el código con una solicitud de Credifamilia antes y después del plan de pagos: cómo se
lee la preaprobación, cómo cae la validación de identidad a un proveedor de respaldo y cómo se
radica el crédito por SOAP. Describe `pre-approvals-service`, `legacy-backend` y el wizard de
`frontend-monorepo` en las refs de `sources.json`; en `application` no hay nada de este flujo. La
fianza, el monto radicado y el plan de pagos están en `credifamilia-financing`. Lo que valida
Credifamilia de su lado no se puede comprobar en este código.

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

Cuando el proveedor termina sin validar, el wizard pide los respaldos. Si hay uno, cambia de
proveedor y navega según el nuevo tipo: Evidente va a la validación adicional, ADO o CrossCore a sus
instrucciones. Si no hay respaldo, la solicitud se cancela. Por eso un CONTINUE o APPROVE de
CrossCore también termina en el respaldo: sólo ACCEPT con R0201 valida.

## La radicación tiene dos pasos SOAP

Primero `transaccionConsumo` registra el crédito. El código HTTP se guarda como estado de la
transacción: 200 registrado, 409 duplicado, 400 inválido, y 500 o cualquier otro, error. Si la
solicitud ya tiene una transacción registrada, duplicada o completada, no se vuelve a llamar. Un
reintento después de un error reescribe la misma fila (clave entidad + solicitud), pero el código no
reintenta solo.

Después `guardarDocumentoOpenKm` envía un único PDF. Con 200 o 409 la transacción queda completada.
El código de solicitud es el id de `user_requests` y el documento se nombra
`<número de documento>-<id de solicitud>`.

El PDF une nueve documentos obligatorios en este orden: formulario de vinculación, tratamiento de
datos, autorización de desembolso a terceros, reglamento, fianza (FGA), pagaré, cédula frontal,
cédula reverso y plan de pagos. Si falta uno, o si falla la unión, la formalización aborta y no se
radica.

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
