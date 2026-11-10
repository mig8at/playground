# Solicitud: estados, cierre y guardas contra el retroceso

Una solicitud (`user_requests`) es un intento de un cliente de financiar una compra en un comercio.
Su estado vive en `user_request_status_id` (no en `status`, que es una bandera booleana de la fila) y
los caminos de este tema dejan cada cambio en `user_request_records`, con quién lo hizo y, casi
siempre, un comentario. Este tema cubre el catálogo de estados, qué estados cierran una solicitud y
las guardas que impiden —o no— que una solicitud autorizada o cancelada cambie. No cubre los estados
de la cartera CreditopX después de originar, que viven en `creditop_x_requests_history` (ver
`creditopx-payment-application`).

## El catálogo no está versionado y se lee por nombre

`user_request_statuses` vive en la base: la migración que crea la tabla no siembra el catálogo base.
Sólo los estados recientes llegan por migración —«Autorizado pendiente desembolso», «Pendiente firma
codeudor», «Pendiente aprobación manual» y «Pendiente de formalización»— y se insertan **sin fijar el
id**, así que el id que reciben depende del ambiente. Por eso el código nuevo resuelve los estados por
**nombre** (`UserRequestStatus::idByName` en legacy-backend, con caché de una hora) y falla
ruidosamente si el nombre no existe. Los ids de producción, tal como los anotan los comentarios de los
dos monolitos:

| id | estado | id | estado |
|---|---|---|---|
| 1 | Validación OTP | 17 | Solicita codeudor |
| 2 | Cédula cargada | 18 | Solicita documentación |
| 3 | Seleccionó entidad | 19 | Cuota Inicial |
| 4 | No desembolsada | 20 | Aprobada no desembolsada |
| 5 | Desembolsada | 21 | En aprobación del médico |
| 6 | Negada | 22 | Validación aprobada, espera de revisión |
| 7 | No terminó proceso | 23 | Validación rechazada, espera de revisión |
| 8 | Cancelado | 24 | Rechazado por validación de identidad |
| 9 | Formulario de perfil | 25 | Pendiente de facturación |
| 10 | Pendiente de autorización | 26 | Facturado |
| 11 | Autorizada | 27 | Paz y salvo |
| 12 | Autorización negada | 30 | Autorizado pendiente desembolso |
| | | 31 · 32 · 33 | Pendiente firma codeudor · Pendiente aprobación manual · Pendiente de formalización |

Trampas del catálogo:

- «Autorizado pendiente desembolso» lo anota legacy-application como el 30, con el 28 como «Pendiente
  desembolso»; legacy-backend anota el 28 como «Autorizado pendiente desembolso». Un id fijo para ese
  estado es una apuesta: legacy-backend lo busca por nombre al pasar a él (`transitionToIntermediate`).
- En `Partner/UserRequestManagementService` hay constantes con nombres engañosos:
  `STATUS_APPROVED = 10` es «Pendiente de autorización», `STATUS_DISBURSED = 11` es «Autorizada» y
  `STATUS_NOT_DISBURSED = 20` es «Aprobada no desembolsada». El propio archivo lo advierte.
- Pese a la regla del nombre, varios caminos siguen con el literal: 11 y 8 en `safeCancel`, en el
  middleware `validate.authorized.status` y en el desembolso IMEI; `DENIED_ID = 6` en
  legacy-application.
- **11 «Autorizada» es el estado de éxito de la originación**: el crédito existe (con Nequi no hay
  crédito sino un pago de contado; ver abajo). Para contar desembolsos se usa
  `user_requests.disbursed_at` (lo llena un trigger al entrar en «Autorizada»), no el estado.

## Qué estados cierran una solicitud

Cada monolito tiene su lista y no coinciden del todo.

En legacy-backend, «continuar» una solicitud desde el portal del asesor (`resolveNextStep`) responde
422 en `NON_RESUMABLE_STATUS_IDS = [5, 6, 8, 11, 12, 24, 26, 27, 28]`, que el archivo agrupa en dos:

- **Cerradas sin crédito:** 6 Negada · 8 Cancelado · 12 Autorización negada · 24 Rechazado por
  validación de identidad.
- **Ya con crédito:** 5 Desembolsada · 11 Autorizada · 26 Facturado · 27 Paz y salvo · 28.

Deja abiertos a propósito los intermedios (1, 2, 3, 9, 10, 17–22…), el 7 «No terminó proceso» (es el
caso para el que existe el botón) y 4/20 (desembolso a medias, donde puede haber razón para
reintentar).

En legacy-application, el admin no deja dar de baja a un usuario que tenga un crédito CreditopX, un
pagaré firmado, una transacción de entidad abierta o una solicitud en un estado pasado la decisión
(5, 10, 11, 17–23, 25, 26, 28, 30–33, resueltos por nombre): la baja libera el documento y el cliente
volvería como usuario nuevo, dejando el crédito y su cobranza colgados del viejo. Ahí 4, 6, 7, 8, 12,
24 y también 27 «Paz y salvo» cuentan como cerrados, y 20 cuenta como abierto. La lista de estados
terminales de transacción de cada entidad (rechazos, expiraciones, cancelaciones, `reversed` de
Nequi) también vive ahí.

## Al autorizar se cancelan las solicitudes hermanas CreditopX

Al llegar a 11 legacy-backend cancela las demás solicitudes del **mismo usuario en el mismo comercio**
cuya entidad es `response_type = 2` (CreditopX consumo) y que no estén en 11
(`cancelOtherClientLoansIfOneDisbursed`). Pasan a 8 con el comentario «Cancelado en cascada por
desembolso de solicitud N». Las de otras entidades y otros comercios no se tocan; entre las hermanas
de riel 2 no se filtra por estado, así que también una Negada pasa a 8.

Cuándo corre: en la autorización del titular y en su reanudación tras la firma del codeudor, **sólo si
la solicitud autorizada es de riel 2**; en el desembolso IMEI de SmartPay, siempre. Corre dentro de la
transacción que pone el 11.

La cancelación pasa por `safeCancel`, que bloquea la fila y **no cancela** si:

- la solicitud ya está en 11;
- ya tiene la fila `CREACIÓN` en `creditop_x_requests_history` (el crédito existe en el core);
- tiene una cuota inicial con pago aprobado.

La misma guarda respalda la cancelación pedida por el cliente o el asesor (`CancelRequestService`):
si `safeCancel` no cancela, responde 403, con `INITIAL_FEE_PAID` cuando el motivo es la cuota inicial.
La cancelación además registra el código de motivo (voluntaria o no) en
`creditop_x_user_requests_records`.

La suite `harness/suites/cascada-al-autorizar.json` lo recorre en local: una hermana de riel 2 debe
quedar en 8 con el comentario de la cascada y una de riel 0, intacta.

## La guarda de 11 y 8 vive en el grupo de rutas, no en la transición

En legacy-backend, el grupo `api/loans/requests` lleva los middlewares `onlyMobileValidation`,
`validate.authorized.status` y `origination.flow`. `validate.authorized.status`: si la ruta trae
`user_request_id` (en la URL o en el cuerpo), responde 403 `CREDIT_ALREADY_DISBURSED` con la
solicitud en 11 y 403 `CREDIT_CANCELLED` con la solicitud en 8. Así se protege
`promissory-note/validate/authorize`, la autorización estándar, cuyo controlador además rechaza el 11
por su cuenta (`CREDIT_ALREADY_AUTHORIZED`). `LoanAuthorizationService` no mira el estado previo: antes
de numerar cortan el OTP validado (422), `OfferStillStandsGuard` (409 si el cupo de la entidad bajó
desde la oferta o si el cliente ya llegó al tope de créditos del mes con ella; no compara cupo si
`initial_fee` es mayor que 0, si no hay foto o si cambió el monto), la compuerta de codeudor con
catálogo y, en rotativos, la fecha de pago y el plazo; con codeudor la autorización se difiere y
vuelve sin llegar a 11.

El subgrupo `device` (`POST api/loans/requests/device/{user_request_id}/disburse`) quita los tres
middlewares del grupo, incluido `validate.authorized.status`. Ese endpoint sólo exige un IMEI
registrado en `user_request_products`; si el comercio es SmartPay, `disburseImeiRequest` pone 11 sin
mirar el estado previo ni pasar por `OfferStillStandsGuard`, así que **puede devolver a 11 una
solicitud Cancelada (8)**, y además corre la cascada, que cancela sólo las solicitudes del mismo cliente y comercio con
entidad tipo 2 que no estén en 11; `safeCancel` salta las que ya tienen fila `CREACIÓN`. Si no es SmartPay, llama a
`authorize()`, que exige un OTP validado y aplica `OfferStillStandsGuard` (el controlador devuelve
su 409), pero tampoco mira el estado.

La gestión manual del comercio (abajo) tampoco mira el estado actual: con entidades de riel 0 o 1
puede mover una solicitud que ya está en 11.

## Con originación delegada, 11 se confirma antes de radicar

Para las entidades de `response_type = 4` (originación delegada; Credifamilia), `LoanAuthorizationService`
confirma el 11 —con el histórico y la cuota inicial; la cascada (`cancelOtherClientLoansIfOneDisbursed`) es
sólo de `response_type` 2— en su propia transacción y **después**
radica en la entidad, en otra. Qué radicación corre lo dice el perfil de la entidad
(`delegated_origination_profiles.formalization`, resuelto por `DelegatedOriginationFormalizations`;
Salud y Materiales usan `CredifamiliaFormalizationService`). Sin formalización configurada no se
radica y sólo queda un log; una entidad del riel sin perfil lanza después del commit.

Si la radicación falla, la solicitud ya quedó en 11. Una `FormalizationException` (documentos
faltantes) se traduce a 422; otras fallas, como la unión del PDF, se propagan sin traducir. Las dos
dejan en el log `external_managed_formalization_failed_after_authorization`, con el estado de la
solicitud y el código de respuesta. Los efectos posteriores al commit (notificaciones, voucher,
actualización del perfilamiento y cierre de la solicitud) no corren, y en la autorización estándar
tampoco se avisa a la tienda de ecommerce. Lo mismo pasa al reanudar tras la firma del codeudor.
Reintentar por la ruta del cliente ya no sirve, porque el middleware corta el 11; la radicación se
vuelve a pedir por `POST api/loans/admin/user-requests/{id}/formalize-external-managed`, que sólo
radica y no corre esos efectos.

## Un webhook tardío no saca a una solicitud de Autorizada

Las entidades que originan en su propio flujo avisan el resultado por webhook, y a veces el aviso
llega después de que la solicitud se autorizó por otro camino. En legacy-application el webhook de
Prami comprueba el estado **antes** de aplicar nada: si la solicitud está en 11, deshace la
transacción, deja el log de lo recibido y responde 200 `IGNORED` (200 y no 4xx para no invitar al
reintento). Es la misma idea que `safeCancel`; la guarda es de este webhook, no de todos.

## El comercio sólo gestiona a mano las entidades que originan afuera

El portal del comercio permite cambiar el estado de una solicitud (`PATCH` de Partner), pero sólo si
la entidad es `response_type` 0 o 1 (o la solicitud aún no tiene entidad), es decir, si origina en su
propio sitio o flujo y Creditop no se entera del resultado por sí mismo. Con cualquier otro riel
responde 422: esas solicitudes las mueve el flujo. Además la solicitud debe ser del comercio del
usuario (403), y las de UMA van por su propio endpoint (422). No se valida el estado actual.

Negada (6), Cancelado (8) y Aprobada no desembolsada (20) se guardan tal cual; cualquier otro estado
que mande el comercio se reemplaza por el que tiene la fila de `status_per_profiles` del comercio y
del perfil del usuario, si existe (si no, se guarda el enviado). Si el resultado es 11, se trata como
desembolso (`updateDisbursedLender`).

## En ecommerce hay una solicitud por pedido

En una sucursal con credenciales de ecommerce, cuando la entrada trae `ecommerce_request_id` (en el
cuerpo o en la sesión), legacy-backend (módulo Onboarding) sólo retoma una solicitud **de ese mismo
pedido** que siga abierta en 1, 3 o 9. Si no la hay —pedido nuevo, o la de este pedido ya terminó—
crea otra, nacida en 1 y sin entidad. Nunca reutiliza la solicitud de otro pedido ni reabre un estado
final. Sin pedido identificado se conserva el flujo viejo por sesión.

## Nequi: un pago de contado que puede salir de Autorizada

Nequi aparece en el listado de entidades como una entidad de riel 0, pero **no presta**: cobra la
compra completa por cuenta de Nequi, con CreditOp como agregador y los datos del comercio viajando en
cada operación. El asistente abre su pantalla de cobro por el id de la entidad (`NEQUI_LENDER_ID` en
frontend-monorepo; no hay configuración que lo diga), y legacy-backend decide la vía por contexto:
notificación push en autogestión, QR dinámico en el punto de venta. Crear el intento es idempotente.

Cuando el cobro queda aprobado, `NequiUserRequestSealer` pasa la solicitud a 11 (resuelto por
nombre) en la transacción del llamador, con `final_amount` igual a lo cobrado e `initial_fee` en 0, y
deja la vía y el id de la transacción en `user_request_records`. Si el pago se reversa y no queda
ninguna vía aprobada, la solicitud sale de 11 a 8 (Cancelado) y `final_amount` queda en nulo, porque
la plata volvió al cliente; los reportes ya emitidos no se corrigen. Un cobro rechazado o expirado
pasa la solicitud a 8 sólo si sigue en 3 (el estado cobrable), sin notificar al comercio.

## Links que vencen: continuación y aprobación manual

El link con el que el cliente retoma una solicitud (`/self-service/{hash}/{id}/confirmation`) puede
vencer. Al enviarlo, legacy-backend escribe un marcador en `user_request_additional_information`
(`type_data = link_expiration`, con `expires_at`). Al abrirlo, la continuación responde con el campo
`linkExpired` para que el asistente lo muestre, sin cortar; sólo la entrega por POST de la
redirección a la entidad responde **410** si venció (y antes, 409 `operation_closed` si la operación
ya se cerró). Ninguno cambia el estado de la solicitud. La política vive en el setting
`link_expiration_config`: una lista de entidades donde aplica (`enabled_lender_ids`, sembrada vacía,
así que se prende entidad por entidad sin deploy) y la vigencia en minutos (`ttl_minutes`, 1440 si la
fila no la trae). La lista se consulta sólo al escribir el marcador: sacar una entidad no revive los
links ya vencidos. Si no puede evaluar, falla abierto: no corta el crédito por un problema propio.

Las entidades con `lender_requirements.manual_approval` dejan la solicitud en «Pendiente aprobación
manual» hasta que alguien de la entidad decide en el admin de legacy-application, que relee la fila con
lock y rechaza la decisión si ya no está pendiente. Aprobar la pasa a «Pendiente de formalización»
(por nombre) y rechazar, a Negada (`DENIED_ID = 6`). Al aprobar se manda por WhatsApp el **mismo
link**, con vigencia de 3 horas, y sólo si la solicitud tiene menos de 30 días; si es más vieja la
decisión se guarda igual pero no se envía nada. El marcador se escribe sólo si el envío fue aceptado,
y el reenvío desde el admin (sólo en «Pendiente de formalización») repite el envío sin cambiar el
estado. Las dos claves viven en la misma fila de `link_expiration_config`
(`manual_approval_ttl_minutes`, `manual_approval_max_request_age_days`), y como es la misma URL, el
último link enviado es el que manda (CRED-443).
