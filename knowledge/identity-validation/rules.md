# Validación de identidad: proveedores y cuándo corre

Qué valida la identidad de una persona en el recorrido «en casa», con qué proveedor y en qué orden.
Describe el módulo `Identity` y los servicios de `CredifamiliaV2` de `legacy-backend` en las refs de
`sources.json`. Lo que decide cada proveedor de su lado no se puede comprobar en este código.

## Dos etapas que no hay que confundir

Hay dos momentos en que se habla de «identidad», y son distintos:

- **Los datos de la persona**, en el tramo común, al enviar los datos personales: Ágil Data, Mareigua
  y TusDatos comparan nombre, apellidos y fecha de expedición contra lo que escribió el cliente
  ([coincidencia de nombres](knowledge:identity-name-validation)). Pasa para cualquier entidad.
- **La persona misma**, después de elegir una entidad que origina en casa: un proveedor comprueba que
  quien está del otro lado es el dueño del documento (foto del documento, selfie, preguntas). Es lo que
  cubre este tema.

Netco no valida identidad: es el proveedor de la **firma** de los documentos, que viene después.

## Cada entidad elige sus proveedores, en orden

Los proveedores salen de `lender_identity_validation_types`: las filas activas de la entidad, por
`order`. La de orden 1 es el primario; las demás son respaldo. Cuando un proveedor termina sin
validar, `SwitchValidationProviderService` pasa al siguiente en orden; si no hay siguiente, sigue el
destino propio del proveedor que falló. Si el país del comercio no tiene centrales de riesgo
habilitadas, el proveedor es `none` sin mirar la configuración de la entidad: los proveedores sólo
conocen personas colombianas.

Antes de mirar el proveedor, `CreditopXFlowService` revisa dos cosas: si la persona tiene una
validación manual de las últimas 24 horas, el paso se salta; y si la entidad no tiene proveedor
primario, el paso termina en error («no tiene tipo de validación principal configurado»).

`IdentityValidationStepResolver` traduce el proveedor al paso que sigue:

| proveedor | qué pide | paso |
|---|---|---|
| **Sin validación** (`none`) | nada | sigue el flujo |
| **ADO** | foto del documento y selfie en la plataforma de ADO | `ado_validation` |
| **AWS** (OCR + Rekognition) | lee el documento y compara la cara | `aws_validation` |
| **CrossCore** | enrolamiento biométrico y evaluación del proveedor | `crosscore_validation` |
| **Evidente** | un cuestionario de preguntas y, si hace falta, un código | `evidente_validation` |
| **Preguntas** (`questions`) | está en el catálogo, pero el resolver no lo atiende | error «no soportado» |

En el recorrido, la identidad se pide después de confirmar la entidad, del formulario adicional y de
Ábaco, y antes de la fecha de pago.

## ADO: documento y selfie, y la re-validación sólo con selfie

ADO devuelve un estado (`IdState`) que el backend traduce. Sólo el 2 aprueba; otros conocidos son
pendiente (1), documento auténtico sin coincidencia de cara (4), captura mala (5), documento inválido
(6), en verificación (7), la cara no coincide (10), ya registrado (14), error (15), cancelado por el
usuario (17), bloqueado (18) y documento que no corresponde (98). Un estado que no está en la lista
queda como desconocido.

La primera validación de una persona siempre pide documento y selfie (`enroll`). Con el flag
`face_only_enabled` del setting `ado_validation_config`, una re-validación puede pedir sólo la selfie
(`verify`), si la persona tiene un enrolamiento aprobado por ADO, reciente y en el mismo proyecto de
ADO. Después de varios `verify` seguidos sin aprobar vuelve a pedir el documento. En los dos modos, un
2 sólo aprueba si el número de documento que devuelve ADO coincide con el del dueño del registro; si
no, queda en 98. El mismo flujo valida al titular y al codeudor.

## CrossCore y Evidente

Los usa hoy Credifamilia: CrossCore primero y Evidente de respaldo. CrossCore sólo cuenta como
validado con decisión ACCEPT y código R0201; otras decisiones van a revisión, a reintento o a
rechazo. Evidente es la validación por preguntas, con un código como paso adicional. El detalle de
las decisiones de CrossCore y de cuándo se cae al respaldo está en
[la originación de Credifamilia](knowledge:credifamilia-origination#identidad-proveedor-primario-y-respaldos).
