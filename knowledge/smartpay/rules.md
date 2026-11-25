# SmartPay: qué lo identifica en el código y qué cambia

SmartPay es una entidad CreditopX de República Dominicana que vende celulares a crédito por la ruta IMEI.
Describe cómo `legacy-backend` y `legacy-application` la reconocen en `main` y qué tratos especiales le dan.
No dice qué id tiene SmartPay en cada ambiente: eso se mide en la base. Lo de la ruta IMEI en general está en
[el registro de IMEI](knowledge:device-imei-validation) y [el bloqueo del equipo](knowledge:device-locking).

## Dos preguntas distintas: ¿es SmartPay? y ¿es su canal?

El código pregunta por SmartPay de dos maneras, y no son iguales:

- **`UserRequest::isSmartPay()`**: la solicitud va por la ruta `IMEI` (`isImeiPath`: el `path` de la entidad se llama
  `IMEI`) **y** la entidad tiene el id fijo de SmartPay. Decide el recorrido: qué documentos, qué desembolso, si corre
  TusDatos.
- **`Lender::isSmartpayChannel()`**: la entidad tiene el id de `config('lenders.smartpay_lender_id')`. No mira la ruta.
  Decide la marca: con qué buzón salen los correos.

## El id fijo, y por qué no coincide fuera de producción

El id de SmartPay no vive en un solo lugar:

| dónde | id en producción | id en otro ambiente |
|---|---|---|
| `UserRequest::isSmartPay()` | 160 | 152 |
| `BackDoorService` y `BackDoorUserService` (asesor comercial de SmartPay) | 160 | 152 |
| `config/lenders.php` `smartpay_lender_id` (`Lender::isSmartpayChannel`) | 160 | 153 |
| `ReminderCreditopXRequestsCommand::SMARTPAY_LENDER_ID` | 160 | 160 |
| legacy-application, `CreditopXPrincipalPaymentType::SMARTPAY_LENDER_ID` | 160 | 160 |

En producción todo dice 160. Fuera de producción, el recorrido se reconoce con 152, el canal de correo
con 153 y los recordatorios y los permisos siguen con 160: una prueba de SmartPay fuera de producción no
ejercita todo junto con la misma entidad. El comentario de `isSmartPay()` lo reconoce como deuda: el id
debería salir de configuración. Los recordatorios apagados por entidad sí se leen de un setting
(`reminders_disabled_lender_ids`) justamente porque el id cambia entre ambientes.

## Qué cambia en el recorrido

Con `isSmartPay()` verdadero:

- **No corre TusDatos.** `ContinueUserFlowController::confirm` no lanza el proceso de fondo de TusDatos, y
  `TusDatosService` contesta que la solicitud no necesita la validación de listas. Sin esto, fuera de producción el
  confirm se rompía con usuarios temporales sin fecha de expedición (lo que motivó el condicional por ambiente).
- **Los documentos son los de la ruta IMEI.** `PromissoryNoteController` previsualiza el acuerdo de bloqueo del equipo
  (`DeviceLockAgreementService`) en lugar del pagaré, y `DocumentSigningService::generateAllDocuments` genera el juego de
  la ruta IMEI. El acuerdo todavía lleva el número de registro de Pro Consumidor como marcador (`XXX/20XX`).
- **El desembolso es otro.** `device/{id}/disburse` exige un producto con IMEI y, para SmartPay, llama a
  `disburseImeiRequest` (pone el 11 sin pasar por la autorización común); para cualquier otra entidad, a `authorize`.
  Ver [la ruta de desembolso](knowledge:device-imei-validation) y [el ciclo de la solicitud](knowledge:user-request-lifecycle).

## El correo con la marca SmartPay

Con `isSmartpayChannel()` verdadero, `NotificationService` (los correos del pagaré y la originación) y `VoucherService`
(el comprobante) mandan por el mailer `smartpay` de `config/mail.php`: su propio servidor SMTP y remitente
(`SMARTPAY_MAIL_*`, por defecto `noreply@tusmartpay.com`), con el nombre de la entidad en el encabezado y el asunto.
Como el canal mira sólo el id de config, fuera de producción el correo con marca sale para la entidad 153, no para la
que `isSmartPay()` reconoce.

## Recordatorios de cobro

`legacy-backend` sólo manda los recordatorios diarios de SmartPay (`app:reminder-creditop-x-requests-command`, con el
calendario de feriados de la entidad); el resto de entidades los manda `legacy-application`. Si el id está en
`settings.reminders_disabled_lender_ids`, la corrida no manda nada y el resumen lo dice. Horarios, plantillas y el
recordatorio semanal: [recordatorios de cobro](knowledge:weekly-collection-reminders).

## Lo que el admin no deja hacer con República Dominicana

En `legacy-application`, `CreditopXRequestHistoryController::dominicanRepublicRejection` niega el cambio de fecha, el
de plazo y la refinanciación de «Gestionar» cuando la entidad del crédito es de República Dominicana
(`Country::DOMINICAN_REPUBLIC_ID`): el código y los avisos de esas operaciones salen con prefijo +57. Condonar,
recuperar y anular no mandan esos mensajes y no se frenan por el país. Mira el país de la entidad, no el id de SmartPay.

## Usuarios de comercio, permisos y validación manual

- **Asesores comerciales.** `BackDoorService` y `BackDoorUserService` reconocen al asesor comercial de SmartPay por
  su comercio activo en `lenders_by_allieds` con el id de SmartPay: [cuentas de asesor](knowledge:advisor-accounts).
- **Permisos.** `CreditopXPrincipalPaymentType::isSmartPayUser` (el comercio activo del usuario, por `allied_id` o
  `multiple_allieds`, trabaja con SmartPay) deja al usuario sin `register creditop x payments` ni
  `reduce creditop x installments`: [roles](knowledge:user-roles).
- **Validación manual.** Toda validación manual —incluida SmartPay— se delega desde `UserController` al
  microservicio de préstamos en `legacy-backend`, sin respaldo local de WhatsApp por Twilio:
  [validación manual](knowledge:identity-validation#la-validacion-manual-quien-la-escribe-y-que-la-frena).
