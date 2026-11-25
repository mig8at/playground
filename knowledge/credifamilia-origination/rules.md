# Credifamilia: preaprobación, identidad y radicación

Qué hace el código con una solicitud de Credifamilia antes y después del plan de pagos: cómo se
lee la preaprobación, cómo cae la validación de identidad a un proveedor de respaldo y cómo se
radica el crédito por SOAP. Describe `pre-approvals-service`, `legacy-backend` y el wizard de
`frontend-monorepo` en las refs de `sources.json`. `legacy-application` no tiene la preaprobación por
servicio, CrossCore ni la radicación SOAP: conserva sólo la integración REST anterior con
Credifamilia (OAuth y redirección a su plataforma). La fianza, el monto radicado y el plan de pagos
están en `credifamilia-financing`. Lo que valida Credifamilia de su lado no se puede comprobar en
este código.

## La preaprobación sólo aprueba con estado 3 y «APROBADO»

`pre-approvals-service` traduce la consulta de estado de Credifamilia. Con estado 3 y detalle
«APROBADO» (sin distinguir mayúsculas) la preaprobación queda aprobada, siempre que `MontoMaximo` o
`ValorDisponibleParaComprar` sea mayor que cero (si ninguno es positivo falla con desajuste de
contrato y no aprueba); con estado 3 y otro detalle, queda rechazada. Los estados 0, 1 y 2 quedan
pendientes, y el 4 o cualquier otro, rechazados. El monto aprobado toma el primero positivo entre
`MontoMaximo` y `ValorDisponibleParaComprar`, y la preaprobación vence a los 30 días. `legacy-backend`
descarta la respuesta si su estado no es `approved` o si el producto no coincide con el de la solicitud.

## Cómo se consulta: radicar una vez y después preguntar el estado

El asistente pide la preaprobación con el slug (`credifamilia`; Materiales con `credifamilia-materiales`, que
`Canonical()` lleva a `credifamilia`, y se distinguen por `lending_product_id`). pre-approvals-service le habla a la
API REST de Credifamilia con OAuth2 de usuario y clave y certificado de cliente (mTLS); el usuario de Negozia y el id
de oficina salen de la credencial. Sin certificado o llave no llama.

La consulta es en dos tiempos (`CredifamiliaClient::CallAPI`):

- **Sin una consulta anterior**, radica: `POST /servicescf/consumo/radicacion` con los datos del cliente que el
  servicio pide a legacy-backend (nombre, primer apellido, documento, nacimiento, celular, correo, ingreso mensual y
  tipo de ocupación; un tipo de documento u ocupación que no reconoce falla) y valores fijos: país «Colombia», día de
  pago 16, tipo de tasa 1, autorización de datos, y una fecha de ingreso laboral de hoy menos 760 días, igual para
  todos. Credifamilia devuelve un id de transacción y la preaprobación queda **pendiente**.
- **Con una consulta anterior** de ese cliente, comercio, entidad y sucursal, toma el id de transacción
  (`PreviousTransactionID` o, como respaldo para filas históricas, el de `PreviousRawResponse`) y sólo pregunta el
  estado (`POST …/radicacion/estado`): no vuelve a radicar. Así también la vuelve a pedir el backend al armar el plan
  (`CredifamiliaPreApprovalInputs`).

Mientras sigue pendiente, la misma fila se reemplaza (conserva id y fecha de creación) y se suma la latencia hasta el
veredicto (`CheckPreApprovalUseCase`). Cómo se traduce cada estado está en la sección anterior.

El asistente sondea las entidades del riel 4, no un id: si la entidad es `response_type` 4, repite la consulta hasta un
estado final, con hasta 6 intentos en 3 minutos y esperas de 2 a 20 segundos (`DEFAULT_CREDIFAMILIA_POLL`). Cada
intento espera 40 s, más que el corte de 30 s del servicio, para que un reintento no se cruce con una respuesta en
curso. Fuera del riel no sondea, y un «pendiente» se muestra como error.

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

## CrossCore con Jumio, y los pasos de Evidente

**CrossCore** son dos piezas: Jumio captura y CrossCore decide (`CrossCoreController`, `JumioOnboardingService`).

1. `startBiometric` abre una cuenta de Jumio para la solicitud y le devuelve al asistente el enlace web o el token del
   SDK para capturar documento y selfie en la plataforma de Jumio.
2. Jumio avisa por `callback`. El backend exige el secreto compartido (si no, 401) y guarda el resultado.
3. Si la cuenta tiene solicitud, referencias de Jumio y un estado terminal (`shouldQueueEvaluation`), encola
   `ProcessCrossCoreEvaluation`, con una demora configurable.
4. La evaluación consulta CrossCore y traduce su decisión como dice la sección anterior: sólo ACCEPT con R0201 valida.

**Evidente** guarda en qué etapa va cada solicitud (`EvidenteFlowStateStore`) y avanza así (`EvidenteFlowService`,
`EvidenteOtpFlowService`):

1. **Validar** los datos de la persona (`validar`).
2. **Un código**, si Evidente lo pide: iniciar, generar y verificar un OTP. Con el código válido (resultado 1) termina
   aprobado, o pasa al cuestionario si Evidente lo exige; un código inválido (2) termina rechazado; vencido (6), pasa al
   cuestionario; el 8 obliga a empezar de nuevo, y un resultado no documentado bloquea.
3. **El cuestionario:** se genera y se guarda con su id.
4. **Verificar** las respuestas (`verificar`): sólo en la etapa «cuestionario generado» (si no, 409); aprueba si la
   respuesta trae resultado y aprobación. Repetir una verificación devuelve el resultado guardado, sin volver a llamar.

Cada consulta a Evidente queda como una fila de `risk_central_user_data` (`EvidenteConsumptionRecorder`). El flujo con
respuestas simuladas (`mock`) sólo se permite en `local` y `testing`.

## La radicación tiene dos pasos SOAP

La radicación corre sólo para entidades con `response_type` 4 cuyo perfil
(`delegated_origination_profiles.formalization`) nombra una formalización; Salud y Materiales
nombran `credifamilia_radication`, que `DelegatedOriginationFormalizations` resuelve a
`CredifamiliaFormalizationService`. Con la columna en null no se radica y sólo queda un log; una
entidad del riel sin fila de perfil lanza `InvalidArgumentException`. Corre después de que la
autorización ya quedó confirmada en estado 11 y en su propia transacción. La disparan la
autorización con OTP del pagaré, la reanudación de una autorización diferida por codeudor y la ruta
de administración `user-requests/{id}/formalize-external-managed`, que sirve para reintentarla.

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
cédula, `users.front_url` y `users.back_url`. Antes de reunirlos, y sólo si hay formalización
configurada, `AdoIdDocumentService::persistForRequest` descarga las imágenes del enrolamiento de ADO,
si el usuario lo tiene, y las guarda como esas dos URLs, fuera de la transacción de la radicación;
sin enrolamiento de ADO no se tocan.

Si falta uno, la formalización aborta sin radicar y la autorización responde HTTP 422 con «No se
puede formalizar el crédito Credifamilia: faltan documentos obligatorios: …» y la lista de los
faltantes. Si falla la unión del PDF también aborta sin radicar, pero el error no se traduce a 422.
En los dos casos queda en el log `external_managed_formalization_failed_after_authorization`, con
el estado de la solicitud y el código que recibirá quien llamó. La solicitud ya está en estado 11,
y no corren las notificaciones de autorización, el comprobante ni el cierre de la solicitud. Las
rutas que validan el OTP (`verify-otp`) y autorizan (`authorize`) responden 403
`CREDIT_ALREADY_AUTHORIZED` a una solicitud en estado 11 (`GET promissory-note/validate/{id}` está
excluida de ese middleware), así que el cliente no puede
reintentar desde el wizard.

## Autorizar no exige que la identidad haya terminado

Entre la selección de la entidad y el estado 11 nada consulta si la validación de identidad terminó
ni bloquea porque el usuario siga siendo el temporal (`TEMPORAL USER`). La selección
(`loan-application/update-user-request`) valida los montos y actualiza la solicitud vigente sólo si
no está en estado 11 o 25 y no tiene otra entidad (`lender_id` nulo o igual); si no, no rechaza:
origina o reutiliza otra solicitud con la entidad elegida (`UserRequestService`). Las rutas del pagaré (plan de pagos, envío y verificación del OTP,
autorizar) exigen un celular: desde escritorio `RedirectIdValidationIfDesktop` responde 403 con la
URL del QR para continuar, y sólo manda el enlace por SMS si el usuario no es el temporal y la
solicitud no es una venta en punto guiada por asesor (con `corporate_user_id`, sin
`self_management` y sin pedido de ecommerce); es el único lugar de este recorrido donde se mira `TEMPORAL USER`, y no
corta nada. Además exigen que la solicitud no esté en estado 8 u 11 y, en ecommerce, que no quede
una cuota inicial sin pagar (`ValidateInitialFeePaid`, que con `initial_fee` en cero consulta la
política de la categoría). El plan, los documentos, la verificación del OTP y `authorize()` aplican
`OfferStillStandsGuard`: si el cupo bajó desde la oferta, o el cliente llegó al tope de créditos
del mes con la entidad, responden 409. `authorize()` exige un OTP validado y aplica la compuerta de
codeudor. Ninguna de esas barreras depende de la identidad.

Para Credifamilia, la primera barrera que depende de la identidad es la radicación (que corre
porque su perfil nombra la formalización `credifamilia_radication`): sin las imágenes de la cédula
en `users.front_url` y `users.back_url`, falta la cédula y responde el 422 de arriba, con la
solicitud ya autorizada.

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
