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
merchant-api, pre-approvals-service, self-manager-api, financial-health-service y
entitlement-service. identity-service no va bajo `/customers`: se llama en la raíz del gateway
(`/api/v1/identity/…`, `dependency_injection.dart`), igual que las rutas push. Pagar abre los portales web `aliados.` y `pagos.creditop.com`.

La app además sincroniza el token de notificaciones del dispositivo con `/v1/devices/push-tokens`
(`POST` para registrar, `PATCH /{device_id}` cuando FCM rota el token, `DELETE /{device_id}` para la
baja): registra al iniciar sesión, al arrancar, al conceder el permiso y al volver a primer plano, da
de baja al salir, y antes de eliminar la cuenta revoca el registro y borra el token FCM local (sin que
un fallo de esa revocación impida borrar la cuenta). La sesión de un usuario temporal no registra
push hasta completar el registro.

El API Gateway (dev y producción) ya enruta esas tres rutas a messaging-service con el `x-user-id` del
autorizador de clientes, y el `main` de messaging-service las implementa como alias de
`/api/v1/push/devices` (`internal/infra/handlers/push/module.go`), además del envío de mensajes y
correos y el de notificaciones push desde el admin (`/v1/backoffice/push/…`). El registro de
dispositivos responde error sólo si la base de push no está disponible; la app lo tolera (el
lifecycle no lanza, mide el resultado y reconcilia en el próximo disparador).

## Entrada: OTP por celular y registro (legacy o MobileOnboardingV1)

El cliente entra con su celular. La app intenta primero el inicio de sesión de Cognito (Custom Auth):
si el usuario existe, Cognito manda el OTP. Si no existe, decide el flag `ff_auth_cognito_signup` (de
sesión, apagado por defecto; el flavor mock no lo lee y siempre sigue el camino nuevo):

- **apagado**: delega en legacy-backend, `/legacy-api/onboarding/mobile/send-otp-code` y
  `validate-otp-code`. Recuerda qué proveedor mandó cada OTP para validarlo contra el mismo;
- **prendido**: lo crea en Cognito con `signUp` (el PreSignUp del pool lo autoconfirma) y entra con el
  OTP de Cognito; nunca deriva a legacy. La confirmación dispara el trigger PostConfirmation, que llama
  a `POST /api/v1/mobile-onboarding/users/confirm-sign-up` de `MobileOnboardingV1` (no la llama la
  app): enlaza el `sub` al usuario de ese país y número o crea uno temporal.

En el camino legacy, al validar, `MOBA2009` (409) no es un error: significa que el usuario tiene que
registrarse. El registro (`register-user`) pide documento (cédula o cédula de extranjería), nombres,
apellidos, correo, fecha de expedición, ingreso, situación laboral y estrato, y legacy:

- si el celular ya existe en Cognito, primero exige una fila de `users` con ese celular (si no,
  `MOBA3002`); después sólo autentica y devuelve `MOBA3001`, sin los controles de documento, correo
  ni identidad;
- si no, rechaza documento o correo ya asociados a otro usuario (`MOBA3004`, `MOBA3005`);
- a un usuario temporal le guarda los datos personales, y el rechazo de esa validación de nombres,
  apellidos, documento o fecha de expedición vuelve como `MOBA3006`–`MOBA3010`;
- crea una solicitud contra el comercio por defecto de la app, que sale del setting
  `mobile_onboarding_settings.default_credit_rules.commerce_id`;
- consulta Experian si `experian_rules.get_data` está prendido en ese mismo setting.

El mismo setting trae un usuario de prueba (`mock_rules`, si `enable` está en `true`) con teléfono y
OTP fijos. Borrar la cuenta (`delete-user`) se niega con `MOBA4003` si el usuario tiene una solicitud
en los estados de `active_credit_status_ids` o ya no está activo; si no, borra el usuario de Cognito y
lo da de baja.

Con el flag, tras el OTP de Cognito la app acepta los términos
(`/legacy-api/v1/mobile-onboarding/terms-and-conditions/accept`, sin esperar la respuesta) y consulta
`users/is-temporal`: un temporal va al registro, que manda los mismos datos (`clientData`) a
`users/update-info` (códigos `MOV16xxx`); si la consulta falla, la app descarta la sesión recién
creada. `update-info` sólo escribe sobre un usuario temporal creado por el canal móvil
(`users.mobile_created`) cuyo celular coincide con el del `x-user-id`, rechaza documento o correo de
otro usuario, guarda los datos antes de consultar las centrales (un rechazo de identidad deja lo
escrito) y, si una central valida la identidad, marca `users.onboarding_completed`; tiene un tope de
intentos por hora (`mobile_onboarding_update_info_max_attempts_per_hour`). Borrar la cuenta va por
`DELETE users` (`MOV14xxx`): se niega si el usuario está inactivo o tiene una solicitud en los estados
configurados; si no, borra la cuenta del pool y da de baja lógica la fila de `users`.

Sin el flag, el OTP de Cognito también pregunta `is-temporal` (con tope de tiempo y fallando abierto),
para mandar al registro a quien quedó temporal con el flag prendido.

## Home: comercios, preaprobación y sin cupo

El home lista los comercios CreditopX de merchant-api con sus industrias como filtro. Cada comercio
trae sus opciones de financiación: `creditop_x` o un agregador (por ejemplo, el BNPL de Bancolombia).

La preaprobación se pregunta a pre-approvals-service (`POST /preapprovals/me/check`, con la clave del
producto, la entidad, el comercio y el monto opcional) y contesta `approved` (con o sin monto) o
`rejected`. CreditopX se consulta desde el home, por lotes de cuatro comercios a medida que se
desplaza la lista y de a un lote por vez; los agregadores, en el detalle del comercio, cuando el
cliente toca su tarjeta, con un monto fijo. Si un comercio no tiene CreditopX aprobado ni
agregadores, su detalle lleva a la pantalla de «sin cupo».

## Comprar en un comercio: canal y código

Los canales de compra **salen de las sedes** del comercio (`merchants/storefronts` de merchant-api),
según su `point_of_sale_type`:

- **Venta asistida**: sedes `assisted_sale` o `both` con teléfono o WhatsApp válido. El cliente
  contacta a un vendedor.
- **Tienda física**: sedes `physical` o `both`, con mapa y orden por cercanía. También es el canal
  por defecto si no hay contactos, o si las sedes no cargaron (sólo código).
- Si ninguna sede declara tipo, sus sedes con dirección o ubicación cuentan como tiendas. Si alguna
  declara tipo, las que no lo declaran se ignoran.

Con más de un canal, el cliente elige. Después la app pide el código a self-manager-api
(`POST /generate/code` con comercio, entidad y canal `assisted` o `physical`). self-manager-api
**no lee el canal**: su pedido sólo toma comercio y entidad, y el usuario sale del encabezado. El
código nuevo es de dos letras y cuatro dígitos; el servicio sigue aceptando los viejos de cuatro
dígitos, y la app muestra ambos. self-manager-api fija el vencimiento en el **último día del mes**
en que se generó, con fecha y comparación en UTC: lo da por vencido desde las 00:00 UTC del día
siguiente (19:00 en Colombia). La app, en cambio, lo muestra válido hasta el final de ese día en hora
de Colombia, cinco horas más. El cliente se lo da al comercio y
ahí se canjea (ver `client-code-redemption`). `store_type` del comercio ya no decide el
flujo, y «online» dejó de ser un canal: la ruta de la tienda virtual sigue registrada pero nada
navega a ella.

## Mis créditos

El listado sale de legacy (`/legacy-api/loans/debt-summary?include=revolving`): deuda total,
créditos y capacidad de endeudamiento. El estado de cada crédito es «Al día», «Pagar» o «En mora»
(uno desconocido se muestra como «Pagar»), y el tipo es `consumer` o `revolving`. La capacidad se pinta
por porcentaje: más de 70 saludable, de 30 a 70 moderado, menos de 30 en riesgo.

Ese porcentaje es la capacidad **disponible**: legacy calcula ingreso menos cuotas mensuales de
Datacrédito (con el ajuste CreditopX y sin la deuda de tarjetas que ignora) sobre el ingreso, entre 0 y 100. El comentario del DTO de la app que lo
llama «capacidad utilizada» (`DebtCapacityDto.percentage`) está mal; el color sí lo lee bien. Sin reporte de Datacrédito o sin salario,
legacy devuelve 0, y la app lo pinta en riesgo aunque no sea una deuda alta sino falta de datos.

De un crédito de consumo se puede consultar el resumen y los documentos, y pedir cambio de fecha de
pago o de número de cuotas (legacy dice primero si se puede). Del cupo rotativo se ven sus compras,
movimientos y documentos. El estado del **cupo** (`active`, `blocked`, `annulled`, `inactive`,
`data_inconsistent`; uno desconocido queda como tal) es
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
versión gratuita tiene **una consulta entregada por mes calendario de Colombia** (configurable,
contada en `financial_tips_queries`); con cualquier plan activo en entitlement-service, regalo
incluido, no hay tope. Si la última consulta de Experian del cliente no fue exitosa, no arma consejos.

Premium se obtiene de dos maneras (`EntitlementSource`): la suscripción `creditop_premium` de
RevenueCat (mensual o anual), o como regalo por un crédito CreditopX originado con el código de la
app. La compra en la tienda no desbloquea nada por sí sola: lo confirma entitlement-service.

En entitlement-service, la suscripción es el plan `premium_subscription` (da `premium.access` y
`financial_health.full`) y el regalo es el plan `creditop_x` (sólo `financial_health.full`). El regalo
lo deciden **reglas versionadas** (`creditop_x_rule_versions`) que se publican desde el backoffice: la
regla original da 3 meses por la primera compra desde el lanzamiento, y las campañas pueden pedir
cantidad o monto de compras en una ventana. Para calificar, la compra debe estar Autorizada en legacy,
no anulada, con entidad (y del tipo de respuesta de entidad que la regla pida, si pide alguno) y con
un código de la app válido para esa compra; cada persona recibe el regalo
**una vez por regla**, y el periodo arranca en la fecha de autorización aunque el sondeo llegue tarde.
La migración siembra la regla original **apagada**: qué versión está prendida es dato del servicio, no
código. Un barrido propio revisa los regalos activos y revoca el de una compra que legacy muestra
anulada.

## Identidad con ADO: sólo para premium

La verificación de identidad (selfie y documento por ambas caras, contra identity-service) se exige
**sólo a premium** antes del diagnóstico completo; la versión gratuita entra sin verificarse.

identity-service decide con una sola regla (`Eligibility`) tanto el estado de la cuenta como si deja
empezar un intento:

- un intento **aprobado con prueba de vida para el documento actual** verifica a la persona para
  siempre, sin ventana de tiempo; un cambio de documento es una persona nueva para el proveedor;
- a una persona cuyo documento el servicio no sabe verificar (tipo no soportado o sin número) no se
  le pide verificación;
- tras un **rechazo terminal** (no reintentable) del mismo documento en el último intento, la cuenta queda «requiere verificación» con motivo
  `identity_rejected` y no se puede empezar otro intento;
- staff puede registrar una aprobación de soporte (proveedor `manual`), que pasa por la misma regla.

ADO responde «registrada previamente» (documento y rostro ya enrolados) y identity-service lo cierra
como **rechazo terminal no reintentable** (`previously_registered`). La app lo trata como aprobado,
pero sólo por la sesión, porque esa aprobación vive en memoria. En la sesión siguiente el servicio
vuelve a responder `verification_required` con `identity_rejected`, y la persona no puede reintentar:
sólo la destraba una aprobación de soporte.

## Campaña de cero interés y flags remotos

El tag «3 meses / 0% intereses» y el banner «¡Estrena en 3 cuotas sin intereses!» los decide un solo
feature flag de la app, `ff_zero_interest_campaign` (Firebase Remote Config): encendido por defecto,
los muestra en todos los comercios sin mirar comercio, entidad ni cupo. Es un flag **de sesión**: un
cambio en la consola rige desde la próxima vez que se abre la app. No es una lectura del backend de
crédito: lo que sostiene la promesa del lado del crédito es el subsidio de intereses Creditop para
créditos de la app (ver `creditopx-portfolio-servicing`).

Los flags se leen de Remote Config del proyecto de cada flavor (dev y producción; el flavor mock usa
sus valores por defecto) y fallan abierto: sin red o con un valor inválido rige el valor por defecto.
Además de la campaña hay dos de versión:

- `ff_min_app_version` (en vivo, un valor por plataforma): con la versión instalada por debajo, toda
  ruta, deep links incluidos, va a la pantalla de actualización obligatoria;
- `ff_recommended_app_version` (de sesión): por debajo, un aviso descartable una vez por sesión.

Vacíos no bloquean ni avisan, y el control de versión no se aplica en builds de debug ni mock salvo
que el build lo fuerce.

Y uno de autenticación, `ff_auth_cognito_signup` (de sesión, **apagado** por defecto): prendido, a quien
no existe en el User Pool la app lo crea en Cognito con `signUp` y usa las APIs de `MobileOnboardingV1`
(términos, `is-temporal`, `update-info`, `DELETE /users`); apagado, sigue el registro de siempre por
legacy (ver la entrada por OTP). Lo resuelve un solo provider (`authCognitoSignupEnabled`). El flavor
mock no lo lee: siempre corre el flujo nuevo.

La app también trae el mecanismo para apagar un flujo entero (`ff_flow_<flujo>`, que manda sus rutas a
«no disponible»), pero en `main-pro` no hay ningún flujo declarado (`appFlowKillSwitches` vacío).
