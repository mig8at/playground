# Firma y cierre del codeudor

Describe el backend modular y el wizard revisados en `main`. La receta antigua que esperaba `data.signer_role` en el OTP del titular no describe el recorrido propio actual del codeudor. No acredita una firma real ni un despliegue.

## Contexto del codeudor y token

`ResolveCosignerToken` toma `X-Cosigner-Token` y después el input `token`. Sin credencial deja pasar sin contexto. Si un token encontrado pertenece a otra solicitud indicada en ruta o payload, lo ignora antes de validar estado o vencimiento. Si corresponde, comprueba estado y TTL y deriva `cosigner_id`, solicitud y actor desde el servidor. Token desconocido, terminal, vencido o estado ilegible tienen respuestas distintas. El guard opcional no asegura acceso exclusivo. `RequireCosignerToken` reutiliza ese guard y exige contexto: sin actor devuelve 401. Las APIs `/cosigner/signature` usan esa variante estricta y no reciben un id de solicitud en la ruta. En el wizard el token viaja desde query explícito o sesión; el helper sólo aplica el filtro por solicitud al token de sesión cuando el llamador le pasa el id.

## Recorrido propio de firma

El repositorio del wizard llama a `/api/v1/user-request/cosigner/signature`: contexto, aceptación del monto, documentos, envío/reenvío y verificación del OTP. La action de `cosigner/signature/otp` exige token y dirige a `cosigner/signature/success` cuando el caso de uso devuelve `signed`. El caso de uso toma `result.success` como firma lograda y distingue código inválido, vencido y limitación de intentos. La pantalla muestra «Firma realizada con éxito» y afirma que el crédito quedó formalizado; la ruta no consulta de nuevo la autorización. Que esa pantalla se renderice prueba la bifurcación del frontend, no el estado del crédito.

## Firma del titular y espera

El OTP del titular sigue `verify-otp` y luego `authorize`, salvo la rama IMEI. El controller revisado de `verify-otp` devuelve `otp_id`, solicitud, estado y `next_step`; no devuelve `signer_role`. El resolver de rol conserva fallback `applicant` y se usa para analítica. La redirección del titular lee `authorizeResult.data.user_request.deferred_for_cosigner === true`: espera la firma del codeudor o va a aprobado. El backend responde success en el diferimiento porque la firma del titular quedó registrada, aunque esa rama no cierre la autorización. Leer sólo success o buscar el booleano en otro nivel del envelope pierde esa diferencia.

## Firma registrada y autorización de la solicitud

La verificación propia sólo admite `waiting_cosigner_signature` y exige un usuario vinculado. Valida el OTP con AuthV1, registra evidencia y cambia el codeudor a `formalized`, estado terminal que invalida su token para llamadas posteriores. Después intenta el cierre mediante `CosignerSignatureCloser`: necesita catálogo para ese rol, re-renderiza documentos con plantilla y reanuda la autorización diferida. Sin catálogo devuelve `closed:false` y el servicio considera el estado posterior configurado. Un error capturado al reanudar devuelve autorización nula. La respuesta URV27000 incluye `userRequestAuthorized` según esa autorización. El schema del wizard sólo declara estado del codeudor y número de documentos firmados; su caso de uso dirige a éxito por `result.success`, sin exigir aquel booleano. Por eso firma del codeudor, render de documentos y autorización son hechos que deben comprobarse por separado; el éxito visual no certifica estado 11. Estos archivos no garantizan recuperación automática ni que catálogo, correo o proveedor estén operativos en un ambiente.

## Catálogo y evidencia de documentos

El catálogo `lender_signing_documents` elige la rama por la política `requires_cosigner` y los firmantes por `signed_by_applicant` y `signed_by_cosigner`; la columna histórica `signer_role` no decide ese filtro. El endpoint de documentos prefiere ese catálogo y vuelve a la configuración del módulo cuando no encuentra filas para el rol. Obtiene URLs desde `user_request_signing_documents`, dando prioridad a la fila del codeudor y a la última del mismo rol; sólo si ese mapa está vacío consulta Netco. Puede omitir tipos sin PDF y devolver una lista parcial: comprobar sólo HTTP 200 no acredita el juego completo.

`signedDocuments` en URV27000 viene de registrar los tipos de `userrequestv1.cosigner.signature.documents` en `cosigner_signed_documents`: el repositorio devuelve el total de filas de ese codeudor y no exige una URL. Ese contador no certifica cuántos documentos del catálogo se mostraron ni cuántos PDF finales se generaron. El cierre escribe los archivos finales en `user_request_signing_documents`: crea la evidencia del codeudor con su propia llave OTP y actualiza la URL del titular al mismo archivo sin cambiar su llave. Para comprobar ambas firmas hay que contrastar esas filas con el contenido del archivo descargado; el plan de pagos y los documentos sólo del titular no requieren el render de dos firmas.

## Respuesta del proveedor de OTP

AuthV1 decide la validez a partir del HTTP del proveedor: 200 acepta el código; 429 limita intentos; otro estado con `error:expired` señala vencimiento, y los demás rechazan. No exige `payload.success:true` para aceptar un 200. UserRequestV1 traduce esos resultados a URV27000, URV27008, URV27007 y URV27006. Un proveedor de prueba que devuelve siempre 200 no permite comprobar códigos incorrectos, aunque el formulario haya enviado un valor distinto.
