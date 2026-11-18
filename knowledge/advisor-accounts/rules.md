# Asesor: alta, baja y celular con token

Cubre el usuario del asesor en `legacy-backend` y lo que el admin de `legacy-application` hace con él: a qué
comercios y sucursales queda atado al crearlo, qué le cambia la baja y por qué después no aparece al buscarlo, y el
token `-comadv-` que lleva su celular cuando origina con él. No cubre qué decide la entidad ni el recorrido del
mostrador.

## El alta lo ata a comercios y sucursales

`AlliedManagementService::storeCorporateUser` (`Modules/Partner/App/Services/AlliedManagementService.php`) crea el
usuario dentro de una transacción. En `users` escribe `allied_id` (el comercio principal), `multiple_allieds` (la
lista de comercios; si llega vacía, `[allied_id]`) y `allied_branch_id` (la sucursal principal). El documento y el
celular se guardan con el perfil delante: `{user_profile_id}-{document_number}` y `{user_profile_id}-{cell_phone}`.
Crea la asignación de rol en `ModelHasRoles` (`model_type` `App\Models\User`, `role_id` = `user_profile_id`) y una fila
de `AlliedBranchesByUser` (`allied_branch_id`, `user_id`) por cada sucursal de `multiple_allied_branches`.

## La baja apaga, sufija el documento y borra el contacto

`users` no tiene `deleted_at` y el modelo `User` no usa `SoftDeletes`, en ninguno de los dos monolitos: la baja no
borra la fila. `UserRepository::disable()` (`Modules/UsersV1/App/Repositories/UserRepository.php`) sólo actúa sobre un
usuario activo: calcula el sufijo y, en una transacción, deja `status` deshabilitado, `email`, `cell_phone` y
`cognito_id` en `NULL`, y `document_number` con `-t<n>`. El número sale de las filas que ya llevan `-t` para ese
documento (`SUBSTRING_INDEX(document_number, '-t', -1) + 1`), así que la misma persona dada de baja varias veces
queda como `…-t1`, `…-t2`. El cálculo corre antes de la transacción, no dentro. Se llega por
`DELETE /api/v1/mobile-onboarding/users` (`DeleteUserService`). `DisableUserService` responde éxito (`USV21000`) cuando
no hay nada que deshabilitar.

## Buscar por documento o correo no encuentra a uno dado de baja

La fila sigue con su `id`, así que las solicitudes que originó siguen apuntando a ella. Pero el valor con que se la
buscaría cambió: `email` quedó en `NULL` y `document_number` sufijado. Buscar por el documento pelado da
`USV18001` («Customer not found.», `FindCustomerByDocumentNumberAndTypeService`), y quien no conoce el sufijo concluye
que el usuario se borró. `UserData::sanitizeData()` devuelve el documento limpio (`cleanDocumentNumber` le quita el
`-t{n}` y el prefijo del perfil) y también limpia el celular. En el admin, `User::fetchFilteredOutIds()`
(`legacy-application:app/Models/User.php`) saca de métricas y reportes los documentos con `LIKE '%-t%'`: atrapa
cualquier documento que contenga `-t`, no sólo el sufijo final, junto con los de `document_ids_creditop` y los de
cuentas comerciales.

## El celular del asesor lleva el token -comadv-

`users.cell_phone` es único (la migración de `users`, en los dos monolitos), y la persona se identifica por su
celular: dos altas del mismo asesor con su número chocarían. `PhoneUtils::makeAdvisorPhoneUnique()`
(`Modules/CommonsV1/App/Utils/PhoneUtils.php`) devuelve `trim($phone) . '-comadv-' . now()->format('Uu')`: el número,
el marcador y la hora hasta el microsegundo. Ese valor no es un número marcable. Lo pegan tres lugares del alta:
`DynamicFormsService` cuando el número es de un asesor comercial de Smartpay y todavía no está etiquetado
(`BackDoorUserService::phoneBelongsToSmartpayCommercialAdvisor()`), `DynamicFormsService::createUserForAdvisorDrivenIntake`
y `BackDoorUserService` al persistir (`isSmartpayAdvisorPhone`). Al editar un usuario, el `UserController` del admin
(en `legacy-application` y también en `legacy-backend`) conserva el valor etiquetado en vez de recortarlo: recortarlo
podría chocar contra el índice único.

## El token se quita en lo que sale y se conserva en lo guardado

En toda salida —el destinatario de un SMS o un WhatsApp, lo que viaja a un proveedor— se usa
`PhoneUtils::cleanAdvisorUniquePhone()`: lo llaman `TwilioMessagingService`, `NotificationService`, los `OtpService`
de `Loans` y de `Onboarding`, `LoanMessagingServiceRepository`, `OtpValidationService`,
`ValidateOtpPromissoryNoteController`, `PromissoryNotePhoneChangeService` y `PhoneUtils::dialableNational()`. En lo que
se guarda y en las búsquedas el token se deja: el código de un solo uso escribe y lee `otps.cell_phone` con la forma
etiquetada. El limpiador es estricto a propósito (`preg_replace('/-comadv-\d+$/', '')`): sólo saca el token numérico
del final, y un valor con otra forma vuelve intacto. `lookupVariants()` documenta por qué no se limpia quitando
no-dígitos: los del timestamp quedarían pegados al número, la búsqueda no encontraría al usuario y el flujo crearía
otro.

## El bypass se decide con el número marcable

`OtpValidationService` (`Modules/Loans/App/Services/OtpValidationService.php`) separa las dos formas. Busca el código
con el teléfono guardado, con token (el pendiente de cambio o `users.cell_phone`), en
`otpRepository->findLatestByCellPhone()`, y decide el bypass de pruebas con la versión limpia contra
`otpBypassService->isPhoneBypassed()`, porque `qa_otp_bypass_phones` guarda números marcables. Cuando la solicitud
tiene un teléfono pendiente de cambio (`PromissoryNotePhoneChangeService::pendingPhone()`), ése se prefiere sobre el
de `users`, también en el reenvío de `ValidateOtpPromissoryNoteController`. El número real del cliente reemplaza al
del asesor en una etapa posterior del recorrido (`PhoneUtils`), así que lo que significa `users.cell_phone` depende de
la etapa en que se lea.
