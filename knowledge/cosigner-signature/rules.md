# Firma y cierre del codeudor

Describe backend modular y wizard de `main`. La receta antigua que esperaba `data.signer_role` en el OTP del titular no describe el recorrido propio del codeudor. No acredita firma real ni despliegue.

## Contexto del codeudor y token

`ResolveCosignerToken` toma `X-Cosigner-Token` y después input `token`. Sin credencial pasa sin contexto. Ignora un token encontrado que pertenece a otra solicitud indicada en ruta o payload, antes de validar estado o vencimiento. Para la solicitud correspondiente valida estado/TTL y deriva actor, solicitud y `cosigner_id` desde el servidor. Token desconocido, terminal, vencido o estado ilegible producen respuestas distintas. El guard opcional no asegura acceso exclusivo: `RequireCosignerToken` exige contexto y devuelve 401 sin actor. `/cosigner/signature` usa esa variante estricta sin id de solicitud en ruta. El wizard toma token de query o sesión; filtra el de sesión por solicitud sólo si el llamador pasa su id.

## Recorrido propio de firma

El wizard usa `/api/v1/user-request/cosigner/signature` para contexto, monto, documentos y envío/reenvío/verificación OTP. La action de `cosigner/signature/otp` exige token y dirige a `cosigner/signature/success` cuando su caso de uso devuelve `signed`. Éste toma `result.success` como firma lograda y distingue código inválido, vencido y limitación de intentos. La pantalla afirma que el crédito quedó formalizado, sin volver a consultar autorización. Renderizarla acredita esa bifurcación del frontend, no el estado del crédito.

## Entrada del titular y política de codeudor

Ante `no_validation_required`, confirmación consulta `available-quota/extended`: ese tipo sólo descarta identidad pendiente. El resolver traduce `next_step:cosigner`, `first_payment_date`, `rejected` y `manual_approval` a sus pantallas. Si falla, confirmación conserva el destino histórico de fecha de pago; ese fallback no acredita política aprobada.

En backend, sin política type 2 el cupo extendido devuelve aprobado, categoría nula y `type_policy_configured:false`. `withNextStep` toma el requisito sólo de esa categoría: nula conduce a `first_payment_date`. Al firmar, `CosignerRequirementService` vuelve a type 1 si falta type 2, reevalúa al titular con id de solicitud y exige codeudor validado si la categoría lo pide. Las decisiones pueden discrepar. Los estados validados incluyen `approved`, ambas esperas de firma y `formalized`; una invitación activa no basta. Describe la discrepancia de `main`, sin dar por integrada una corrección local.

## Firma del titular y espera

El titular sigue `verify-otp` y luego `authorize`, salvo IMEI. El controller de OTP devuelve `otp_id`, solicitud, estado y `next_step`, sin `signer_role`; el resolver de rol conserva fallback `applicant` para analítica. La redirección lee `authorizeResult.data.user_request.deferred_for_cosigner === true` para esperar al codeudor o ir a aprobado. Backend responde success al diferir porque registró la firma del titular, aunque no cierre autorización. Leer sólo success o buscar el booleano en otro nivel pierde esa diferencia.

## Firma registrada y autorización de la solicitud

La verificación propia exige usuario vinculado y `waiting_cosigner_signature`. Valida OTP con AuthV1, registra evidencia y cambia el codeudor a `formalized`: su token queda terminal. Después intenta `CosignerSignatureCloser`, que requiere catálogo del rol, re-renderiza documentos con plantilla y reanuda autorización diferida. Sin catálogo devuelve `closed:false` y el servicio considera el estado posterior configurado. Un error capturado al reanudar devuelve autorización nula.

URV27000 incluye `userRequestAuthorized` según esa autorización. El schema del wizard sólo declara estado del codeudor y contador de documentos firmados; el caso de uso dirige a éxito por `result.success` sin exigir aquel booleano. Firma, render y autorización requieren comprobaciones separadas: éxito visual no certifica 11. Estos archivos no garantizan recuperación automática ni operación de catálogo, correo o proveedor.

## Catálogo y evidencia de documentos

`lender_signing_documents` elige política por `requires_cosigner` y firmantes por `signed_by_applicant`/`signed_by_cosigner`; la columna histórica `signer_role` no decide ese filtro. Documentos prefiere catálogo y vuelve a configuración del módulo si no hay filas para el rol. Lee URLs de `user_request_signing_documents`, priorizando codeudor y última fila del rol; consulta Netco sólo si ese mapa está vacío. Puede omitir tipos sin PDF y devolver lista parcial: HTTP 200 no acredita el juego completo.

`signedDocuments` cuenta filas del codeudor en `cosigner_signed_documents` para tipos de `userrequestv1.cosigner.signature.documents`, sin exigir URL. No certifica cantidad de PDF del catálogo. El cierre escribe archivos finales en `user_request_signing_documents`, registra la llave OTP del codeudor y actualiza al titular a la misma URL sin cambiar su llave. Ambas firmas se comprueban cruzando filas con contenido descargado. Plan de pagos y documentos sólo del titular no requieren render de dos firmas.

## Respuesta del proveedor de OTP

AuthV1 decide por HTTP: 200 acepta sin exigir `payload.success:true`; 429 limita intentos; otro estado con `error:expired` indica vencimiento; el resto rechaza. UserRequestV1 traduce a URV27000, URV27008, URV27007 y URV27006. Un proveedor de prueba que siempre devuelve 200 no permite comprobar códigos incorrectos.

## Estado del saga y sincronización de la espera

La espera del titular consume el saga de `merchant-api` como `HOLDER`: `COMPLETED` dirige a aprobado y `EXPIRED` a cancelado. Sin `statusUrl` no hace polling legado. El wizard proxya estado y autorización del canal mediante `MERCHANT_API_URL`, conservando snapshot y HTTP; PHP configura `MERCHANT_API_HOST`. Ambas deben apuntar al ambiente comprobado.

Escucha `state.changed` en `private-credit.{id}.{actor}`; Echo recibe nombre sin `private-` y evento con punto inicial. Se suscribe antes de leer; acepta sólo snapshots válidos con `seq` mayor al máximo visto, compartido entre actores de la solicitud. Lee al montar, confirmar suscripción, reconectar, recuperar red y volver a primer plano. Sin Echo mantiene lectura inicial y disparadores del navegador; no hay timer que recupere indefinidamente una lectura fallida. HTTP y socket se diagnostican por separado.

Workflow v1 coordina validación del codeudor, firma del titular, espera y segunda firma mediante Updates con validador y Query. Soketi puede fallar sin detenerlo. La Query lee saga, sin consultar autorización MySQL. El monolito reporta al titular sólo con marcador de workflow y al codeudor tras intentar cerrar, aunque `userRequestAuthorized` sea falso; captura fallos de reporte sin alterar éxito de firma. `COMPLETED` acredita ambas firmas recibidas, sin certificar autorización, PDF ni desembolso. Un cierre correcto no cubre uno fallido ni demuestra reportes recibidos por Temporal.

## Confirmación del titular y estado persistido

El GET de validación de pagaré devuelve `data.user_request.status_id` desde la solicitud al responder `pending_validation` y `already_authorized`. El último texto agrupa autorizado 11 e intermedio IMEI 28. Tampoco saga, success, número de solicitud o codeudor terminal reemplazan comprobar estado.

En `main`, `PromissoryNoteValidationUserRequestSchema` no declara `status_id` y lo descarta al parsear. El loader de `loan-approved` consulta validación, pero toda respuesta exitosa entrega datos a confirmación sin exigir estado. Un enlace directo o `COMPLETED` pueden mostrar monto como desembolsado cuando aún está pendiente. Ante error, captura sin retornar estado de recuperación y el componente queda vacío. La corrección propuesta y sus mediciones viven en la tarea hasta integrarse.

Confirmar exige conservar y contrastar estado persistido. Consultarlo de nuevo es lectura, sin reenviar OTP con token terminal ni ejecutar cierre. Mostrar espera evita una afirmación falsa; no repara la autorización fallida ni acredita recuperación automática.

## Reanudar autorización y efectos posteriores

En `main`, `resumeDeferredAuthorization` reutiliza número y documentos del cierre. Exige solicitud y número; la carga antes de su transacción sin bloquear la fila ni comprobar estado pendiente/11. Recalcula montos, persiste estado, registra transición e intenta primer histórico. Conservar número no vuelve idempotente toda la operación.

El histórico sí tiene guarda: `createFirstRegister` devuelve la creación existente consultada por `getInitialRegisterByUserRequest`, cuyo filtro selecciona `movement_type:CREACIÓN`, excluye status 5 y ordena por id. Esa guarda no evita repetir transición o efectos de autorización ni demuestra serialización concurrente.

El commit precede a radicación, avisos, voucher y limpieza posterior, con tratamientos de error propios. Una falla posterior no revierte autorización persistida. Al recuperar se distingue crédito pendiente con ambas firmas, crédito autorizado y entrega posterior fallida. Repetir OTP con token terminal o consultar saga no repara esa separación. Describe mecanismo y límites, sin acreditar recuperación automática ni comando operativo integrado; las propuestas locales siguen en la tarea hasta llegar a `main`.
