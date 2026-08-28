# Codeudor · referencia
> verificado contra `main` el 2026-08-20 — leídos en `main`: el enum `CosignerStatus`, `CosignerRequirementService`, `CosignerSignatureCloser`, el diferimiento de `LoanAuthorizationService`, `LenderSigningDocument`, `CosignerEligibilityService`, el middleware `ResolveCosignerToken`, las rutas de los dos módulos y la rama del front que lee el diferimiento. Lo que se apoya en `docs/cosigner/*.md` del repo va marcado.
> El **segundo firmante** de una solicitud: cuándo se exige, cómo entra, cómo se valida y por qué la firma del titular sola ya no cierra el crédito.

## Qué es
El **codeudor** es una segunda persona que participa en la **misma `user_request`** del titular — no se crea una solicitud nueva: monto, plan y comercio ya están decididos y el codeudor solo los confirma. Entra por un **deep link de WhatsApp** con token, se vuelve un `User` completo y hace **su propio onboarding** (celular/OTP → formulario → identidad), **sin pasar por el listado de entidades**. Al final los dos firman **el mismo documento**.

La lógica está repartida en dos módulos y conviene saber cuál abrir: **`Modules/UserRequestV1`** tiene el sub-flujo (estados, token, invitación, elegibilidad, OTP de firma del codeudor) y **`Modules/Loans`** tiene lo que toca la firma del titular (política, catálogo de documentos, diferimiento y cierre). Los modelos y las migraciones viven en la raíz (`app/Models`, `database/migrations`), que es la convención del repo.

## Antes de concluir
- **Firmar ya no significa llegar al estado 11.** Si la política exige codeudor, `LoanAuthorizationService` **difiere**: responde HTTP 200 con `deferred_for_cosigner = true` y `status_id = null`, numera la solicitud, genera los documentos del titular con **una** firma y la deja en el estado macro **«Pendiente firma codeudor»**. Un consumidor que valide ese endpoint solo por `success: true` va a mostrar «tu monto fue aprobado» sobre una solicitud sin autorizar. El wizard ya lo discrimina (`otp-validation.tsx`), pero cualquier otro cliente de ese endpoint hereda la trampa.
- **El id de ese estado macro NO es estable entre ambientes.** La migración lo deja auto-incrementar a propósito, y el código lo resuelve **por nombre** (`UserRequestStatus::pendingCosignerSignatureId()` → `idByName('Pendiente firma codeudor')`). Si escribís el número, funciona en un ambiente y miente en el otro — el mismo error que ya pasó con «Autorizado pendiente».
- **Lo que exige codeudor es la POLÍTICA, no el hecho de que exista uno.** `CosignerRequirementService::requiresCosigner()` lee `lender_users_categories.requires_cosigner` de la categoría en la que cae el usuario, **re-evaluada en el momento de firmar** (no se lee de `users_category_log`: manda la política vigente al firmar). Preguntar «¿hay codeudor activo sin validar?» deja pasar el caso que importa — quien nunca abrió el flujo porque se saltó el paso con la url.
- ⚠ **Esa re-evaluación es CARA**: corre reglas y consulta centrales. Está puesta en la **previsualización de documentos**, que es una request única. **No la metas en caminos por lender ni en bucles** (el listado recorre decenas de entidades).
- **Titular y codeudor firman EL MISMO archivo, y por eso el documento se RE-RENDERIZA.** La firma es electrónica —una constancia impresa dentro del PDF, no un trazo sobre él—, así que la única forma de tener las dos es volver a generarlo con ambas llaves. **La url del titular también se actualiza**: dejarlo apuntando al render de una sola firma sería conservar como prueba una versión que ya no es la vigente. Que ambos firmen el mismo documento es requisito legal (Código de Comercio art. 632, «en un mismo grado»), no una decisión de implementación.
- **Sin filas de catálogo para esa entidad, TODO esto es no-op.** `SigningDocumentResolver` devuelve vacío, no se difiere, no se re-renderiza y el flujo queda como estaba. **La ausencia de configuración ES el fallback** — por eso una entidad nueva necesita su migración de seed antes de que el codeudor funcione ahí, y por eso «no pasa nada» es un síntoma de config faltante, no de código roto.
- **Una fila por INTENTO de codeudor, con un único activo por solicitud.** «Usar otro codeudor» cierra la fila anterior en el estado terminal `Replaced` y crea una nueva. **El deep link vale solo mientras el estado NO sea terminal** y el token no haya expirado: un link que «dejó de funcionar» probablemente esté mirando una fila reemplazada.
- **El guard `cosigner.token` es SOFT.** Sin el header `X-Cosigner-Token` hace `next()` y el flujo del titular pasa byte a byte igual; con token, expone el contexto del codeudor y el controlador decide. Por eso pudo montarse en rutas **compartidas** del onboarding (celular/OTP/formulario) sin tocar la autogestión. La variante dura es otra clase (`RequireCosignerToken`) — no las confundas al leer una ruta.
- **La elegibilidad del codeudor es SOLO LECTURA por contrato.** `CosignerEligibilityService` **no** dispara TusDatos, Experian ni ADO: esas consultas ya corrieron en el onboarding del codeudor y quedaron persistidas; acá solo se leen. Disparar de nuevo duplicaría consultas **facturables**. Y la política es **el cupo de codeudor (type 3)** del lender: si Riesgo necesita más criterios, van dentro del motor de cupo, no en este servicio.
- ⚠ **DataCrédito del codeudor se lee por su `user_id`, no por `user_request_id`** — Experian no ata el resultado a la solicitud. Dos personas conviven en la misma `user_request` sin colisión porque el vínculo lo resuelve la tabla `cosigners`.
- **El OTP de la FIRMA del codeudor no es el OTP del monolito: lo sirve un microservicio.** `SendCosignerSignatureOtpService` baja a `Modules/AuthV1` y de ahí a `OtpClient`, que hace `Http::baseUrl(config('services.otp_service.host'))`. Dos consecuencias prácticas: el código **no queda en la base** (la fila de `otps` guarda el literal `delegated-to-otp-service`, así que no se puede leer de ahí para probar), y si ese host no está configurado el paso muere con un 500 opaco (**F-151**). El OTP del onboarding —el que linkea al codeudor con su `User`— es el de siempre y sí es local: son dos mecanismos distintos en el mismo recorrido.

- ⚠ **`docs/cosigner/*.md` (en el repo) va ATRASADO respecto del código.** Su tabla de fases marca la firma técnica del codeudor como ⛔ bloqueada por proveedor; en `main` existe `CosignerSignatureCloser`, que re-renderiza con las dos firmas y termina la autorización. Son 10 documentos muy buenos para entender **el porqué de cada decisión** — pero para saber **qué corre hoy**, el código manda.

## El recorrido, y quién decide en cada punto

1. **Se exige.** La categoría del usuario en esa entidad trae `requires_cosigner`. La solicitud pasa al estado macro **17 «Solicita codeudor»** (`StartCosignerFlowService`, idempotente).
2. **Se invita.** `RegisterCosignerService` crea la fila en `cosigners` **sin crear el `User`** (`cosigner_user_id` queda NULL hasta que el codeudor haga su OTP), genera token + TTL y arma el deep link (`CosignerInvitationLinkBuilder`). El envío de WhatsApp es **best-effort**: si el template no está aprobado del otro lado, responde `invitationSent: false` y **la fila no se revierte** — el link se puede reenviar.
3. **Entra.** El codeudor abre el link → `ResolveCosignerTokenService` valida el token y devuelve el contexto de arranque (`userRequestId`, estado, `actor = 'cosigner'`, hash del comercio). **El token ES la credencial**: no hay JWT en este backend, y el middleware lo re-valida en cada request.
4. **Se onboardea.** Celular → OTP (acá se linkea `cosigners.cosigner_user_id`) → formulario → identidad. **No** ve entidades ni elige monto.
5. **Se valida.** `EvaluateCosignerEligibilityService` (idempotente) escribe `approved` o `not_eligible` con su registro en el historial. El titular espera en una pantalla que **polea** `cosigner/status`.
6. **Firman.** El titular firma primero; su render lleva una firma y es exactamente lo que el codeudor ve al previsualizar. Cuando el codeudor valida su OTP, `CosignerSignatureCloser` re-genera el documento con las dos firmas, actualiza las dos filas de evidencia y **recién ahí** termina la autorización.

## Los estados son un enum, no números
El sub-flujo tiene **catálogo propio** (`cosigner_statuses`), deliberadamente aislado de `user_request_statuses` para no heredar sus números mágicos. La fuente de verdad es el enum `CosignerStatus` (string-backed); la tabla existe para integridad referencial y reportes, y se resuelve de vuelta al enum con `App\Models\CosignerStatus::toEnum()`.

Lo que hay que retener no es la lista sino **la terminalidad**, porque de ella depende la validez del link de invitación: `not_eligible`, `formalized`, `cancelled` y `replaced` cierran el intento; el resto no. Los estados de espera de firma (`waiting_applicant_signature` / `waiting_cosigner_signature`) existen en el enum, pero **el orden legal de firma sigue siendo decisión de negocio** — el código difiere y espera, no impone quién va primero.

## El catálogo de documentos: dos preguntas, dos columnas
`lender_signing_documents` es **configuración por entidad** (una fila vale para todas sus solicitudes; lo que pasó en una solicitud concreta —url, estado, firma— vive en `user_request_signing_documents`). Tiene dos ejes que es fácil confundir:

| eje | columna | qué contesta |
|---|---|---|
| **cuándo aplica la fila** | `requires_cosigner` | la **política** del usuario — espeja `lender_users_categories.requires_cosigner`, y como esa columna nunca es null, acá tampoco hay «aplica siempre»: las filas invariantes se declaran en **las dos ramas** |
| **quién firma** | `signed_by_applicant` · `signed_by_cosigner` | el rol que estampa su firma en ese documento |

Están separados a propósito: si el juego se dedujera de los booleanos de firma, el **plan de pagos** —que firma solo el titular pero va haya o no codeudor— desaparecería en cuanto la solicitud tuviera codeudor. Y un documento que firman **los dos** es **una** fila, no dos: una fila es un documento es una plantilla.

⚠ **Una fila sin `template` se genera con el servicio de siempre, sobre una plantilla genérica cuyo bloque de evidencia solo contempla al titular.** El cierre del codeudor la **omite** (y lo traza), porque re-generarla no agregaría la segunda firma: llevarla a dos firmas es darle su plantilla, no escribir código.

**(2026-08-28) Cuatro hilos nuevos en `main`, leídos y verificados:**

1. **El ciclo se espeja hacia `merchant-api-service`**: legacy le reporta seis hitos (solicitud,
   codeudor registrado, invitación abierta, cupo validado, firma del titular, cierre) para que el
   proveedor tenga su copia **sin que el embudo dependa de que esté arriba**. La compuerta ya no es el
   lender 158 quemado (estaba en cinco lugares): es un **marcador de workflow** en el almacén tipado
   por solicitud (`UserRequestAdditionalInformation`), escrito al crearse la aplicación.
2. **El codeudor ahora recibe lo que firmó**: antes el cierre notificaba sólo al titular (el único
   destinatario del `sendAuthorizationNotifications` compartido); hoy el cierre le manda al codeudor
   su propio correo con las filas del catálogo de SU rol, re-renderizadas con las dos firmas.
3. **El título valor salía con el codeudor EN BLANCO**: `formalized` es terminal y apaga `is_active`,
   y los payload builders resolvían con `findActiveByUserRequestId` — en el render final no había
   codeudor «activo» y el pagaré salía sin su nombre, documento y teléfono. Hoy los builders resuelven
   con `findSignatoryByUserRequestId`.
4. **La compuerta de firma del titular**: si la política exige codeudor y no hay uno aprobado, el
   titular no ve ningún documento (cubre el salto por URL). Sólo en el repo nuevo.

## Dónde mirar
- `legacy-backend/Modules/Loans/App/Services/LoanAuthorizationService.php` — la rama que **difiere**: numera, genera los documentos del titular y devuelve `deferred_for_cosigner`. Es el punto donde «firmó» deja de significar «quedó autorizada».
- `legacy-backend/Modules/Loans/App/Services/Signing/CosignerRequirementService.php` — la política re-evaluada al firmar, y el corte que impide que el titular firme el juego equivocado. Explica en su cabecera por qué es la política y no el hecho.
- `legacy-backend/Modules/Loans/App/Services/Signing/CosignerSignatureCloser.php` — el cierre: re-render con las dos firmas, actualización de las dos urls de evidencia y fin de la autorización. **No lanza**: una firma ya ocurrida no se tumba por un render fallido.
- `legacy-backend/Modules/UserRequestV1/App/Enums/CosignerStatus.php` — los estados y su terminalidad (de la que depende la validez del link).
- `legacy-backend/app/Models/LenderSigningDocument.php` — los dos ejes del catálogo, con el porqué de que sean columnas distintas.
- `legacy-backend/Modules/UserRequestV1/App/Services/CosignerEligibilityService.php` — el contrato read-only y qué tabla se lee para cada dato (AML, Experian, ADO/AWS, score).
- `legacy-backend/Modules/UserRequestV1/App/Http/Middleware/ResolveCosignerToken.php` — el guard SOFT que permite montar el recorrido del codeudor sobre las rutas del titular.
- `legacy-backend/Modules/Onboarding/routes/api.php` — dónde está montado ese guard, ruta por ruta (celular, OTP, formulario, laboral, estado de validación). Los comentarios de esas líneas dicen por qué en cada caso.
- `frontend-monorepo/apps/loan-request-wizard/app/routes/otp-validation.tsx` — la bifurcación tras la firma: discrimina por `deferred_for_cosigner`, no por `next_step`.
- `frontend-monorepo/apps/loan-request-wizard/app/utils/signer-role.server.ts` — el **único** punto que decide qué pantalla de cierre ve quien firmó; su fallback es «titular» a propósito.
- **El porqué de cada decisión de diseño**: `legacy-backend/docs/cosigner/` (10 documentos: modelo de datos, endpoints, firma cruzada, actor en el motor de pasos, invitación por WhatsApp, ADO del codeudor). Ver la advertencia de arriba sobre su desfase.

## Lo que NO está verificado
- **El envío real de la invitación por WhatsApp.** El endpoint la dispara, pero depende de un template aprobado en el proveedor. Para saber si hoy sale de verdad hay que mirar el messaging-service y el estado del template, no este código.
- **Qué entidades tienen catálogo cargado en cada ambiente.** Es dato, no código: se mide con una consulta a `lender_signing_documents` por ambiente. **Y no es teórico** — en el Rent to Own está medido y las dos mitades del problema conviven: una rama del catálogo la sembró una migración de `main` y la otra una que no existe en el repositorio, así que el mismo lender firma cosas distintas según dónde esté (**F-152**, y el detalle del producto en `motai`).
- **El orden legal de firma** (titular primero o codeudor primero) y **la decisión de aprobación combinada** titular + codeudor: siguen abiertas por negocio, y el código no las impone.
