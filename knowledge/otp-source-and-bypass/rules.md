# OTP: origen, OTP del pagaré y bypass de QA

Cubre cómo `legacy-backend` genera y registra los OTP de onboarding y del pagaré, cómo los clasifica
por origen en `otps`, cómo los lee el backoffice y cuándo se puede saltar el envío en ambientes de
prueba. No describe el `otp-service` ni el `messaging-service` por dentro (canal SMS o WhatsApp por
país, plantillas, límites de envío): legacy sólo les pasa país, identificador, largo y plantilla.
Tampoco dice qué teléfonos están en la lista de bypass de un ambiente.

## El origen queda en la fila del OTP

La migración `2026_07_09_130000_add_source_and_qa_bypass_to_otps` agrega `otps.source` (nullable) y
`otps.qa_bypass` (booleano, falso por defecto). Los valores salen del enum `App\Enums\OtpSource`:
`onboarding_web`, `mobile`, `promissory_note`, `login_forgot_password` y `login_migration`.

- Onboarding (`Onboarding\OtpService::sendOtpCode`): usa el `source` explícito si el que llama lo
  pasa —el orquestador móvil pasa `MOBILE`—; si no, `resolveOnboardingSource` mira el texto de la
  acción: `mobile` si contiene «Mobile», si no `onboarding_web`.
- Reenvío por correo (`sendOtpCodeViaEmail`): `promissory_note` si el paso es
  `validate-otp-promissory-note`, si no el de onboarding.
- Pagaré (`Loans\OtpService`): siempre `promissory_note`.
- Login (`Auth`): `login_forgot_password` o `login_migration`.

El resultado (`outcome`) no se persiste: el backoffice lo deriva (`UsersService::deriveOtpOutcome`)
como `validated` si la fila está validada, `send_failed` si `status` es falso, y `sent` en otro
caso. El historial del backoffice lee `otps` directamente (no la vista `VW_OTPs`), descifra el
código en PHP y suma como `send_failed` los errores de `otp_logs`, cuyo origen deduce del texto de
la descripción.

## El OTP del pagaré se genera en el servicio de OTP

`Loans\OtpService::sendOtpPromissoryNote` usa un largo fijo de 6 (`PROMISSORY_OTP_LENGTH`):

1. Resuelve país, identificador y plantilla con `PhoneRoutingService::resolveForUser`: el país sale
   del comercio de la última solicitud del usuario y le gana al deducido del teléfono. Si el
   teléfono no sirve para ese país, falla antes de generar.
2. Pide el código a `otp-service` (`generateOtp`), que devuelve un `created_at`; con él y el
   identificador lo revela (`decryptOtp`). Sin `created_at` o sin código revelado, el envío falla.
3. Recién entonces persiste la fila cifrada en `otps`, con `identifier`, `otp_service_created_at`,
   `source = promissory_note` y `qa_bypass = false`. Si falla un paso anterior no queda fila en
   `otps`, sólo el registro en `otp_logs`.

No hay rama por país ni envío por Twilio en este servicio. La validación (`OtpValidationService`)
también la hace el servicio de OTP con el mismo `identifier` de la fila (o el teléfono nacional
para filas viejas sin él); la fila local sigue siendo la que se marca validada y la que viaja a la
firma. Si el cliente corrigió su celular en la firma, se valida contra el número pendiente.

## El OTP de onboarding

`sendOtpCode` acepta largo 4 o 6 (`otp_length` del request) y también genera por `otp-service`,
con el país que resuelve `PhoneRoutingService` desde la sucursal (`partner_branch_hash`) y, si no
viene, desde el indicativo. `createOtpRecord` guarda el código como texto con su largo (rellena
ceros a la izquierda) y cifrado.

## El bypass de QA

`OtpBypassService` salta el envío cuando el teléfono, normalizado (sólo dígitos, sin prefijo 57, 51
o 1 cuando el largo cuadra), está en el setting `qa_otp_bypass_phones` (arreglo JSON en `settings`).
Un JSON roto deja la lista vacía y lo reporta con `Log::error`.

- El código esperado son los **últimos 4** dígitos en onboarding y los **últimos 6** en el pagaré.
- No se llama al proveedor, pero se persiste la fila cifrada con `qa_bypass = true` y el mismo
  `source`, para que la validación y la firma la encuentren por el camino normal.
- La comparación es en tiempo constante (`hash_equals`).

El bypass sólo actúa si `QaModeService::enabled()`: falso siempre con `APP_ENV=production`, y en
otro ambiente lo decide `onboarding.qa_mode.enabled` (`QA_MODE_ENABLED`, o el antiguo
`OTP_QA_BYPASS_ENABLED`), apagado por defecto. El mismo interruptor gobierna
`QaMessageRoutingService`, que en modo QA desvía a la plantilla `QA` los números no válidos para su
país y redirige los configurados en `qa_message_redirects`.
