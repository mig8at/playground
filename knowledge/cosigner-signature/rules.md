# Firma y cierre del codeudor

Describe backend modular y wizard de `main`, sin acreditar despliegue. El codeudor tiene recorrido propio, no depende de `data.signer_role` en el OTP del titular.

## Contexto del codeudor y token

`ResolveCosignerToken` prioriza `X-Cosigner-Token` sobre input `token`. Sin credencial pasa sin contexto; ignora token de otra solicitud en ruta/payload antes de validar estado/TTL. Para la propia deriva actor, solicitud y `cosigner_id`; distingue desconocido, terminal, vencido y estado ilegible. `RequireCosignerToken` exige contexto (401 sin actor); `/cosigner/signature` usa ese guard estricto sin id en ruta. El wizard toma query o sesión, filtrando esta última por solicitud sólo si recibe su id.

## Recorrido propio de firma

El wizard usa `/api/v1/user-request/cosigner/signature` para contexto, monto, documentos y OTP. La action `cosigner/signature/otp` exige token y dirige a `cosigner/signature/success` por `signed`: el caso de uso toma `result.success` y distingue código inválido, vencido y límite de intentos. La pantalla afirma formalización sin consultar autorización; renderizarla acredita esa bifurcación, no estado del crédito.

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

`merchant-api` separa API y worker: `cmd/http-server` conecta HTTP, MySQL y cliente Temporal; `cmd/worker` ejecuta workflows/actividades sin MySQL. Necesitan servidor, namespace y task queue coincidentes. Levantar sólo HTTP no ejecuta el saga. La Query exige `HOLDER` o `COSIGNER`, con esas mayúsculas.

`RegisterCosignerService` crea la aplicación, persiste el marcador `merchant_api_workflow` en `user_request_additional_information` tras HTTP 2xx y registra al codeudor. Sin 2xx no marca ni registra. El marcador usa `corporate_user_id` obligatorio; fallar al guardarlo no deshace la creación. `hasStarted` comprueba su existencia, no salud del saga: perderlo omite el reporte del titular. Resolver un token válido reporta inicio en cada consulta; evaluar cupo reporta validación si hay `has_quota`. Transporte o HTTP no exitoso se registran sin invalidar el resultado local. Un inicio repetido fuera de turno puede recibir 409; el comentario de idempotencia no acredita aceptación en cualquier estado.

La espera usa el actor `HOLDER`: `COMPLETED` dirige a aprobado y `EXPIRED` a cancelado; sin `statusUrl` no hace polling legado. El wizard proxya estado y autorización del canal por `MERCHANT_API_URL`, conservando snapshot/HTTP; PHP usa `MERCHANT_API_HOST`. Deben apuntar al ambiente comprobado.

Escucha `state.changed` en `private-credit.{id}.{actor}`; Echo recibe nombre sin `private-` y evento con punto inicial. Se suscribe antes de leer y acepta snapshots válidos con `seq` mayor al máximo compartido entre actores. Lee al montar, confirmar suscripción, reconectar, recuperar red y volver a primer plano. Sin Echo quedan lectura inicial y disparadores del navegador, sin timer para recuperar indefinidamente errores. HTTP y socket se comprueban por separado.

Workflow v1 coordina validación, firma del titular y segunda firma mediante Updates con validador y Query. Soketi puede fallar sin detenerlo. La Query no consulta autorización MySQL. El titular reporta sólo con marcador; el codeudor después de intentar cerrar, aunque `userRequestAuthorized` sea falso. Los errores de reporte no alteran el éxito de firma. `COMPLETED` acredita ambas firmas recibidas, sin certificar autorización, PDF ni desembolso. Las decisiones del workflow no demuestran que los reportes llegaron al servidor.

## Confirmación del titular y estado persistido

El GET de validación devuelve `data.user_request.status_id` en `pending_validation` y `already_authorized`; éste agrupa autorizado 11 e IMEI 28. Saga, success, número y token terminal no sustituyen estado.

En `main`, `PromissoryNoteValidationUserRequestSchema` descarta `status_id`. El loader de `loan-approved` confirma con cualquier respuesta exitosa: enlace directo o `COMPLETED` pueden mostrar desembolso pendiente. Ante error no retorna recuperación y el componente queda vacío. Corrección y mediciones de rama viven en la tarea.

Confirmar exige estado persistido. Volver a consultarlo es lectura, sin OTP ni cierre: mostrar espera evita una afirmación falsa, sin reparar autorización ni acreditar recuperación automática.

## Reanudar autorización y efectos posteriores

En `main`, `resumeDeferredAuthorization` reutiliza número y documentos del cierre. Exige solicitud y número; la carga antes de su transacción sin bloquear la fila ni comprobar estado pendiente/11. Recalcula montos, persiste estado, registra transición e intenta primer histórico. Conservar número no vuelve idempotente toda la operación.

El histórico sí tiene guarda: `createFirstRegister` devuelve la creación existente consultada por `getInitialRegisterByUserRequest`, cuyo filtro selecciona `movement_type:CREACIÓN`, excluye status 5 y ordena por id. Esa guarda no evita repetir transición o efectos de autorización ni demuestra serialización concurrente.

Radicación, avisos, voucher y limpieza suceden tras commit, con errores propios: fallar no revierte autorización. Se distingue pendiente con ambas firmas, autorizado y entrega fallida; repetir OTP o consultar saga no los repara. Sin acreditar recuperación automática ni comando integrado: propuestas locales quedan en la tarea hasta `main`.
