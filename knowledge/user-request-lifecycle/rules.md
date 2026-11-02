# Solicitud: estados, cierre y guardas contra el retroceso

Una solicitud (`user_requests`) es un intento de un cliente de financiar una compra en un comercio.
Su estado vive en `user_request_status_id` (no en `status`, que es la baja lógica de la fila) y cada
cambio deja una fila en `user_request_records` con quién lo hizo y un comentario. Este tema cubre el
catálogo de estados, qué estados cierran una solicitud y las guardas que impiden que una solicitud
autorizada o con dinero de por medio vuelva atrás. No cubre los estados de la cartera CreditopX después
de originar, que viven en `creditop_x_requests_history` (ver `creditopx-payment-application`).

## El catálogo no está versionado y se lee por nombre

`user_request_statuses` existe sólo en la base: la migración crea la tabla pero ninguna siembra sus
filas, y los ids ya divergen entre ambientes. Por eso el código nuevo resuelve los estados por
**nombre** (`UserRequestStatus::idByName`) y falla ruidosamente si el nombre no existe. Los ids de
producción, tal como los anotan los dos monolitos:

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

- «Autorizado pendiente desembolso» es el 30 en producción y el 28 en otros ambientes; el 28 de
  producción es «Pendiente desembolso». Un id fijo para ese estado es una apuesta.
- En `Partner/UserRequestManagementService` hay constantes con nombres engañosos:
  `STATUS_APPROVED = 10` es «Pendiente de autorización», `STATUS_DISBURSED = 11` es «Autorizada» y
  `STATUS_NOT_DISBURSED = 20` es «Aprobada no desembolsada». El propio archivo lo advierte.
- **11 «Autorizada» es el estado de éxito de la originación** y es terminal: el crédito existe. Para
  contar desembolsos se usa `user_requests.disbursed_at`, no el estado.

## Qué estados cierran una solicitud

Los dos monolitos agrupan los estados igual, aunque cada uno con su lista:

- **Cerradas sin crédito:** 6 Negada · 8 Cancelado · 12 Autorización negada · 24 Rechazado por
  validación de identidad (y 7 «No terminó proceso», que se puede retomar).
- **Con crédito:** 5 Desembolsada · 11 Autorizada · 26 Facturado · 27 Paz y salvo · 28/30.
- **Abiertas en la decisión:** 10, 17–23, 25, 31–33 esperan a una persona, un documento o un pago.
- **Onboarding temprano:** 1, 2, 3 y 9.

En legacy-backend, «continuar» una solicitud desde el portal del asesor se niega en
`NON_RESUMABLE_STATUS_IDS = [5, 6, 8, 11, 12, 24, 26, 27, 28]`. Deja abiertos a propósito el 7 (es el
caso para el que existe el botón) y 4/20 (desembolso a medias, donde puede haber razón para
reintentar).

En legacy-application, el admin no deja dar de baja a un usuario que tenga un crédito CreditopX, un
pagaré firmado, una transacción de entidad abierta o una solicitud en un estado pasado la decisión
(5, 10, 11, 17–23, 25, 26, 28, 30–33): la baja libera el documento y el cliente volvería como usuario
nuevo, dejando el crédito y su cobranza colgados del viejo. La lista de estados terminales de
transacción de cada entidad (rechazos, expiraciones, cancelaciones, `reversed` de Nequi) también
vive ahí.

## Al autorizar se cancelan las solicitudes hermanas CreditopX

Cuando una solicitud llega a 11 (titular, codeudor o equipo IMEI), legacy-backend cancela las demás
solicitudes del **mismo usuario en el mismo comercio** cuya entidad es `response_type = 2` (CreditopX
consumo) y que no estén en 11. Pasan a 8 con el comentario «Cancelado en cascada por desembolso de
solicitud N». Las de otras entidades y otros comercios no se tocan.

La cancelación pasa por `safeCancel`, que bloquea la fila y **no cancela** si:

- la solicitud ya está en 11;
- ya tiene la fila `CREACIÓN` en `creditop_x_requests_history` (el crédito existe en el core);
- tiene una cuota inicial con pago aprobado.

La misma guarda respalda la cancelación pedida por el cliente o el asesor (`CancelRequestService`):
si `safeCancel` no cancela, responde 403, con `INITIAL_FEE_PAID` cuando el motivo es la cuota inicial.
La cancelación además registra el código de motivo (voluntaria o no) en
`creditop_x_user_requests_records`.

## Un webhook tardío no saca a una solicitud de Autorizada

Las entidades que originan en su propio flujo avisan el resultado por webhook, y a veces el aviso
llega después de que la solicitud se autorizó por otro camino. En legacy-application el webhook de
Prami comprueba el estado **antes** de aplicar nada: si la solicitud está en 11, deshace la
transacción, deja el log de lo recibido y responde 200 `IGNORED` (200 y no 4xx para no invitar al
reintento). Es la misma idea que `safeCancel`: 11 no retrocede.

## El comercio sólo gestiona a mano las entidades que originan afuera

El portal del comercio permite cambiar el estado de una solicitud (`PATCH` de Partner), pero sólo si
la entidad es `response_type` 0 o 1, es decir, si origina en su propio sitio o flujo y Creditop no
se entera del resultado por sí mismo. Con 2, 3 y 4 responde 422: esas solicitudes las mueve el flujo.
Además la solicitud debe ser del comercio del usuario, y las de UMA van por su propio endpoint.

Negada (6), Cancelado (8) y Aprobada no desembolsada (20) se guardan tal cual; cualquier otro estado
que mande el comercio se reemplaza por el estado que ese comercio tiene configurado en
`status_per_profiles`. Si el resultado es 11, se trata como desembolso.

## En ecommerce hay una solicitud por pedido

Cuando la entrada trae `ecommerce_request_id`, legacy-backend (módulo Onboarding) sólo retoma una
solicitud **de ese mismo pedido** que siga abierta en 1, 3 o 9. Si no la hay —pedido nuevo, o la de
este pedido ya terminó— crea otra, nacida en 1 y sin entidad. Nunca reutiliza la solicitud de otro
pedido ni reabre un estado final. Sin pedido identificado se conserva el flujo viejo por sesión.
