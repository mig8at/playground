# CreditOp Mobile: la app del cliente final

CreditOp Mobile es la app Flutter (iOS, Android y web) para el **consumidor final**, no para el
comercio ni el asesor. Le muestra al cliente dónde tiene cupo, le da un código para comprar en un
comercio aliado, le deja ver y pagar sus créditos, y vende «Salud Financiera», un diagnóstico de su
buró con versión gratuita y premium. La rama de producción del repo es `main-pro` (su `main` está
parado); `main-dev` integra. Este tema describe la app en `main-pro` y lo que valida el backend de
cada llamada; no cubre el diseño interno de la app.

## Con qué servicios habla

La app no tiene backend propio: llama por el API Gateway (`v2.api.creditop.com` en producción,
`api.dev.creditop.com` en dev) a legacy-backend (`/legacy-api/…`), y bajo `/customers/…` a
merchant-api, pre-approvals-service, self-manager-api, financial-health-service,
entitlement-service e identity-service. Pagar abre los portales web `aliados.` y `pagos.creditop.com`.

La app además registra el token de notificaciones del dispositivo en `/v1/devices/push-tokens`
(alta al iniciar sesión, refresco y baja al salir), pero **ningún servicio implementa esa ruta** en
`main`: messaging-service sólo expone el envío de notificaciones push desde el admin. Hasta que exista, el registro de
dispositivos no llega a ningún lado.

## Entrada: OTP por celular y registro en legacy

El cliente entra con su celular. La app intenta primero el inicio de sesión de Cognito (Custom Auth):
si el usuario existe, Cognito manda el OTP. Si no existe, delega en legacy-backend,
`/legacy-api/onboarding/mobile/send-otp-code` y `validate-otp-code`. Recuerda qué proveedor mandó
cada OTP para validarlo contra el mismo.

Al validar, `MOBA2009` (409) no es un error: significa que el usuario tiene que registrarse. El
registro (`register-user`) pide documento (cédula o cédula de extranjería), nombres, apellidos,
correo, fecha de expedición, ingreso, situación laboral y estrato, y legacy:

- rechaza documento o correo ya asociados a otro usuario (`MOBA3004`, `MOBA3005`);
- valida nombres, apellidos y fecha de expedición contra el documento (`MOBA3006`–`MOBA3010`);
- crea una solicitud contra el comercio por defecto de la app, que sale del setting
  `mobile_onboarding_settings.default_credit_rules.commerce_id`;
- consulta Experian si `experian_rules.get_data` está prendido en ese mismo setting.

El mismo setting trae un usuario de prueba (`mock_rules`) con teléfono y OTP fijos. Borrar la cuenta
(`delete-user`) se niega con `MOBA4003` si el usuario tiene una solicitud en los estados de
`active_credit_status_ids` o ya no está activo; si no, borra el usuario de Cognito y lo da de baja.

## Home: comercios, preaprobación y sin cupo

El home lista los comercios CreditopX de merchant-api con sus industrias como filtro. Cada comercio
trae sus opciones de financiación: `creditop_x` o un agregador (por ejemplo, el BNPL de Bancolombia).

La preaprobación se pregunta a pre-approvals-service (`POST /preapprovals/me/check`, con la clave del
producto, la entidad, el comercio y el monto opcional) y contesta `approved` (con o sin monto) o
`rejected`. CreditopX se consulta para todos al cargar el home; los agregadores, cuando el cliente toca
la tarjeta. Si no queda ninguna opción, la app muestra la pantalla de «sin cupo».

## Comprar en un comercio: canal y código

Los canales de compra **salen de las sedes** del comercio (`merchants/storefronts` de merchant-api),
según su `point_of_sale_type`:

- **Venta asistida**: sedes `assisted_sale` o `both` con teléfono o WhatsApp válido. El cliente
  contacta a un vendedor.
- **Tienda física**: sedes `physical` o `both`, con mapa y orden por cercanía. También es el canal
  por defecto si no hay contactos, o si las sedes no cargaron (sólo código).
- Si ninguna sede declara tipo, sus sedes con dirección cuentan como tiendas.

Con más de un canal, el cliente elige. Después la app pide el código a self-manager-api
(`POST /generate/code` con comercio, entidad y canal `assisted` o `physical`). El código tiene 4 o 6
caracteres y sirve **hasta el final del día de vencimiento en hora de Colombia**; el cliente se lo da al
comercio y ahí se canjea (ver `client-code-redemption`). `store_type` del comercio ya no decide el
flujo, y «online» dejó de ser un canal: la tienda virtual sigue registrada pero nada la abre.

## Mis créditos

El listado sale de legacy (`/legacy-api/loans/debt-summary?include=revolving`): deuda total,
créditos y capacidad de endeudamiento. El estado de cada crédito es «Al día», «Pagar» o «En mora»
(uno desconocido se muestra como «Pagar»), y el tipo es `consumer` o `revolving`. La capacidad se pinta
por porcentaje: más de 70 saludable, de 30 a 70 moderado, menos de 30 en riesgo.

Ese porcentaje es la capacidad **disponible**: legacy calcula salario menos cuotas mensuales (ajustadas
y sin las deudas que ignora) sobre el salario, entre 0 y 100. El comentario del DTO de la app que lo
llama «capacidad utilizada» está mal; el color sí lo lee bien. Sin reporte de Datacrédito o sin salario,
legacy devuelve 0, y la app lo pinta en riesgo aunque no sea una deuda alta sino falta de datos.

De un crédito de consumo se puede consultar el resumen y los documentos, y pedir cambio de fecha de
pago o de número de cuotas (legacy dice primero si se puede). Del cupo rotativo se ven sus compras,
movimientos y documentos. El estado del **cupo** (`active`, `blocked`, `annulled`, `inactive`) es
distinto del estado de la **deuda**: el cupo puede seguir bloqueado con la deuda al día, mientras
espera la reactivación diaria. Pagar abre el portal de pagos con la URL que da el backend.

## Salud Financiera: gratuita y premium

financial-health-service arma el diagnóstico a partir del buró que trae legacy, y decide entre dos
documentos por el beneficio `financial_health.full` de entitlement-service:

- **con el beneficio**: el reporte completo (score, deuda, experiencia, hábitos, productos), del
  reporte B2C de Experian;
- **sin el beneficio**: el reducido (nombre y score), del Acierta clásico que legacy ya tiene.

Antes de leer, pide a legacy un refresco del buró, que legacy sólo hace para quien tiene el beneficio.
El documento se guarda en caché por cliente y la caché se lee antes que el beneficio: un cambio de
plan tarda hasta su vencimiento, salvo que se avise el cambio de suscripción.

Los consejos con IA se piden a financial-health-service, que proyecta los **dos últimos reportes de
Experian exitosos** del cliente y los manda por POST a un workflow de n8n
(`/webhook/financial-analysis`; la URL de ejemplo es `n8n.creditop.com`), que el propio código describe
como fuera de la infraestructura de la compañía. Es el único flujo del servicio que saca datos. La
versión gratuita tiene **una consulta por mes calendario de Colombia** (configurable, contada en
`financial_tips_queries`); premium, sin tope.

Premium se obtiene de dos maneras (`EntitlementSource`): la suscripción `creditop_premium` de
RevenueCat (mensual o anual), o como regalo por un crédito CreditopX originado con el código de la
app. La compra en la tienda no desbloquea nada por sí sola: lo confirma entitlement-service.

En entitlement-service, la suscripción es el plan `premium_subscription` (da `premium.access` y
`financial_health.full`) y el regalo es el plan `creditop_x` (sólo `financial_health.full`). El regalo
lo deciden **reglas versionadas** (`creditop_x_rule_versions`) que se publican desde el backoffice: la
regla original da 3 meses por la primera compra desde el lanzamiento, y las campañas pueden pedir
cantidad o monto de compras en una ventana. Para calificar, la compra debe estar Autorizada en legacy,
no anulada, con entidad y con un código de la app válido para esa compra; cada persona recibe el regalo
**una vez por regla**, y el periodo arranca en la fecha de autorización aunque el sondeo llegue tarde.
La migración siembra la regla original **apagada**: qué versión está prendida es dato del servicio, no
código. Una anulación confirmada revoca el regalo.

## Identidad con ADO: sólo para premium

La verificación de identidad (selfie y documento por ambas caras, contra identity-service) se exige
**sólo a premium** antes del diagnóstico completo; la versión gratuita entra sin verificarse.

identity-service decide con una sola regla (`Eligibility`) tanto el estado de la cuenta como si deja
empezar un intento:

- un intento **aprobado con prueba de vida para el documento actual** verifica a la persona para
  siempre, sin ventana de tiempo; un cambio de documento es una persona nueva para el proveedor;
- un documento que el servicio no sabe verificar no recibe verificación;
- tras un **rechazo terminal** del mismo documento, la cuenta queda «requiere verificación» con motivo
  `identity_rejected` y no se puede empezar otro intento;
- staff puede registrar una aprobación de soporte, que pasa por la misma regla.

ADO responde «registrada previamente» (documento y rostro ya enrolados) y identity-service lo cierra
como **rechazo terminal no reintentable** (`previously_registered`). La app lo trata como aprobado,
pero sólo por la sesión, porque esa aprobación vive en memoria. En la sesión siguiente el servicio
vuelve a responder `verification_required` con `identity_rejected`, y la persona no puede reintentar:
sólo la destraba una aprobación de soporte.

## Campaña de cero interés

El tag «3 meses / 0% intereses» y el banner «¡Estrena en 3 cuotas sin intereses!» están **quemados en
la app**: un provider devuelve `true` y los muestra en todos los comercios, sin mirar comercio,
entidad ni cupo. No es una lectura del backend: lo que sostiene la promesa del lado del crédito es el
subsidio de intereses Creditop para créditos de la app (ver `creditopx-portfolio-servicing`).
