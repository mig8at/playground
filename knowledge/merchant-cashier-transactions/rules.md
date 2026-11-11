# Transacciones de caja del comercio

API servidor a servidor de `Modules/MerchantTransactionsV1` (legacy-backend) con la que la caja de un comercio consulta el código que presenta el cliente, confirma el resultado de la compra y reporta cancelaciones. Describe el código de la ref local de `main`; no certifica despliegue, publicación en el gateway ni que el servicio de códigos de un ambiente tenga el recurso que el módulo consume. No es el código de compra de Corbeta/Bancolombia (`purchase-code-lifecycle`) ni el código plano de autogestión de la app (`/api/v1/generate/code` del mismo servicio): comparte con este último sólo la URL base.

## El token es del comercio y lleva una sola habilidad

`RouteServiceProvider` monta `routes/api.php` bajo el prefijo `v1` (sin `api/`) con los middleware `otel` y `api`, y registra el alias `merchant-transactions.token` → `EnsureMerchantTransactionsToken`. Las cuatro rutas van dentro de ese middleware y excluyen `AddOriginationFlowType`: `GET v1/transactions/{codeId}`, `POST v1/transactions/{codeId}/confirm`, `POST v1/transactions/{codeId}/cancellations` y `POST v1/qa/transactions`.

El middleware resuelve el portador con el guard `sanctum` y responde él mismo, sin lanzar. Si `currentAccessToken()` no es un `PersonalAccessToken` (sin token, o una sesión que resuelve a `TransientToken`) devuelve 401 `Unauthenticated.`. Si el dueño no es un `Allied`, o `merchant:transactions` (`EnsureMerchantTransactionsToken::ABILITY`) no figura literalmente en `abilities`, devuelve 403 `Invalid ability provided.`. Compara con `in_array` sobre el arreglo, no con `tokenCan()`: un token comodín `*` no pasa, y un token de sucursal u otro modelo tampoco.

El token se emite con `php artisan merchant-transactions:issue-token {allied_id} {--name=}` (`IssueMerchantTransactionsTokenCommand`): `Allied::createToken` con esa única habilidad; el texto plano se imprime una vez. `Allied` usa `HasApiTokens` y `personal_access_tokens` es polimórfica. El token es del aliado entero: los servicios toman `$request->user()->id` como `alliedId` y la caja no envía sucursal; la transacción queda en la `allied_branch_id` con que se creó.

Las respuestas no usan el sobre `{code, message, data}` de los módulos nuevos. El trait `MerchantContractResponse` arma `{message, ...}` con las llaves del contrato del comercio y manda el código interno (`MTV11xxx` consulta, `MTV12xxx` confirmación, `MTV13xxx` cancelación, `MTV14xxx` simulación) en la cabecera `X-Creditop-Code`. Una excepción no controlada en cualquier servicio sale como el `…003` de su serie, HTTP 500.

## Los códigos de caja los emite el servicio de códigos y su recurso no está en main

`TransactionLifecycle` fija tres formatos: `qr_code` (por defecto), `code_128` y `ean_13`. `normalizeCodeId` recorta, pasa a mayúsculas y quita espacios y guiones. `isValidCodeId` acepta 16 caracteres Base32 (`[A-Z2-7]{16}`) para `qr_code` y `code_128`, o 13 dígitos cuyo último es el dígito verificador EAN (`ean13CheckDigit`) para `ean_13`. La consulta valida contra el `code_type` del query; confirmación y cancelación no reciben `code_type` y aceptan cualquiera de los dos formatos (`isValidAnyCodeId`). Un formato inválido es 422 antes de salir del monolito.

El monolito no genera ni guarda el código. `TransactionCodeClient` llama al servicio configurado en `services.code_generation_service` (`CODE_GENERATION_SERVICE_BASE_URL`, con respaldo en `CODE_GENERATION_SERVICE_HOST`): `POST /api/v1/transaction-codes` (`generate`), `GET /api/v1/transaction-codes/{code}` (`find`) y `POST /api/v1/transaction-codes/{code}/consume` (`consume`). Devuelve el status y el cuerpo crudos para cualquier respuesta HTTP y sólo relanza si no hay conexión. Del cuerpo usa `merchant_id`, `status` (`ACTIVE`), `reference` (el `user_requests.id`, enviado como texto al generar), `code_id`, `code_type`, `expires_at` e `image_base64`.

En `origin/main` de `self-manager-api` ese recurso no existe: su `openapi.yaml` publica `/api/v1/generate/qr`, `/generate/barcode`, `/generate/code`, `/generate/code/consult` y `/generate/code/consumConfirm`, además de `users`, `todos` y las rutas de salud (`/health`, `/ready`, `/api-info`), y ningún archivo de la rama nombra `transaction-codes`. El recurso está en `origin/develop` del servicio. Contra un servicio construido desde `main`, `find` no devuelve el 200 con `merchant_id` que esperan los servicios: un 404 se lee como código inexistente (409 en consulta y confirmación, 404 en cancelación) y cualquier otro status como error interno; `generate` nunca devuelve 201.

## Consultar no gasta el código y confirmar lo consume antes de escribir

`GetTransactionService::getTransactionOrchestrator` sólo lee: `find` y luego `MerchantTransactionRepository::findTransaction(reference)`. Responde `MTV11002`/409 si el código no existe, si su `merchant_id` no es el aliado del token, si `status` no es `ACTIVE` o si la transacción ya no está en `pending`; `MTV11004`/404 si la solicitud referida no tiene fila de transacción. En 200 devuelve `transaction_id`, `lender` (`lending_product_id`, `lending_product_name`), los datos del cliente y `available_amount`. Como no llama a `consume`, se puede repetir hasta que la caja confirme.

`lending_product_id` no es una columna: `TransactionLifecycle::lendingProductId` calcula un UUIDv5 de `lender:<id>` bajo `LENDING_PRODUCT_NAMESPACE`. Cambiar esa constante cambia todos los identificadores públicos de entidad.

`ConfirmTransactionService::confirmTransactionOrchestrator` repite las mismas guardas y agrega las suyas, en este orden: `transaction_id` distinto → `MTV12004`/404; transacción no `pending` → `MTV12002`/409; `lending_product_id` o `available_amount` que no coinciden con la transacción, o `status: completed` con `purchase_amount` mayor que el cupo → `MTV12005`/422 con `errors`. El tope de cupo sólo se evalúa para `completed`.

Sólo después llama a `consume`, y antes de cualquier escritura local. Un 404, 409 o 410 del servicio es `MTV12002`/409: ese consumo es el candado de un solo uso contra dos confirmaciones simultáneas. Si `applyOutcome` falla después, el código queda usado y la transacción sigue `pending` (`MTV1TD002`): no hay compensación, y esa transacción ya no se puede confirmar con ese código.

## Qué escribe confirmar en cada resultado

`applyOutcome` corre en una transacción de base con `lockForUpdate` sobre la solicitud y escribe tres cosas: el `status_id` de `lender_transactions`, la solicitud y el `data_json` de la fila de estado.

En los tres resultados la solicitud recibe `purchase_amount` e `invoice_number`. El estado se busca por nombre con `UserRequestStatus::idByName`: `completed` → «Autorizada», `failed` → «No desembolsada», `cancelled` → «Cancelado». Sólo `completed` escribe además `final_amount` con la compra y `request_number` con el identificador de aprobación, `APPR-` más diez caracteres aleatorios en mayúsculas (`ConfirmTransactionServiceConstants`), que también vuelve como `lender_approval_id`. En `failed` y `cancelled` la respuesta trae `loaned_amount` 0 y `lender_approval_id` nulo.

El estado de `lender_transactions` sale de `resolveLenderStatusName`: recorre `LENDER_STATUS_CANDIDATES` del resultado en orden de prioridad y devuelve el primer nombre que la entidad tenga en `lender_transaction_statuses`, comparando sin distinguir mayúsculas. Si la entidad no tiene ninguno devuelve null y `applyOutcome` no toca esa fila; la solicitud y el estado sí se escriben.

La fila de estado pasa a `status` del resultado y agrega `purchase_amount`, `invoice_number`, `loaned_amount`, `remaining_amount` (igual a `loaned_amount`), `lender_approval_id`, `reversed: false`, `cancellations: []` y `confirmed_at`.

Sólo en `completed` corre `runDisbursementSideEffects`, fuera de esa transacción y dentro de un único `try`: `VoucherService::generateVoucher` (que genera y guarda el comprobante, un PDF con visibilidad pública, y lo notifica por celular y por correo; la notificación va en su propio `try/catch`, que registra el fallo y lo relanza) y luego `RequestCompletionService::updateDisbursedLender`, que escribe `disbursed_lender` en la última `ProfilingReview` de esa solicitud si existe. Una excepción en el primero salta el segundo; cualquiera se registra como advertencia y la confirmación responde 200 igual.

## Cancelar exige una compra completada y se aplica después de responder

`CreateCancellationService::createCancellationOrchestrator` no mira el `status` del código (ya está usado), sólo su `merchant_id`. Código desconocido, de otro comercio o `transaction_id` distinto es `MTV13002`/404. Después, en orden: transacción no `completed` → `MTV13008`/409 `transaction_not_completed`; `invoice_number` distinto del de la confirmación → `MTV13009`/422; `reversed` verdadero → `MTV13004`/409 `already_reversed`; reverso con cancelaciones previas o fuera del día de `confirmed_at` → `MTV13006`/409 `not_reversible`; `remaining_amount` en cero → `MTV13005`/409 `already_cancelled`; parcial mayor que el saldo → `MTV13007`/409 `amount_exceeds_available`. Los 409 llevan ese texto en la llave `code` del cuerpo.

El «mismo día» del reverso compara fechas de calendario en `America/Bogota` (`CreateCancellationServiceConstants::OPERATING_TIMEZONE`), no 24 horas. `reversal` y `total` cancelan todo `remaining_amount`; `partial` exige `amount` y cancela ese valor.

Aceptar es `saveState`: baja `remaining_amount`, marca `reversed` si es reverso y agrega a `cancellations` una entrada `queued` con `cancellation_id` y `lender_cancellation_id`, dos UUIDv4 generados acá. Responde 201 con ambos. Es leer, decidir y escribir sin candado (`MTV1TD003`): dos cancelaciones simultáneas pueden pasar las dos la validación del saldo.

Los efectos sobre la solicitud los aplica `ProcessCancellationJob`, despachado con `dispatch(...)->afterResponse()`: corre en el mismo proceso después de enviar la respuesta, no en una cola. El job declara `tries` y `backoff`, pero por ese camino no hay worker que reintente (`MTV1TD004`): si el proceso muere antes, la entrada queda `queued` con el saldo ya descontado y la solicitud sin tocar.

`ProcessCancellationService::processCancellationOrchestrator` marca la entrada `processed` y llama a `applyOutcome` con `final_amount` igual al saldo restante. Si el saldo es cero, además pasa la solicitud a «Cancelado» y `lender_transactions` al estado equivalente a cancelado de la entidad, si lo tiene; con saldo, no cambia ningún estado. Una entrada ya `processed` responde `MTV15002` sin escribir. No modifica `purchase_amount` ni `request_number`.

## Ninguna entidad se llama y sólo la simulación crea la transacción

Ni `ConfirmTransactionService`, ni `CreateCancellationService`, ni `ProcessCancellationService` tienen un cliente de entidad: sus dependencias son `TransactionCodeClientInterface`, `MerchantTransactionRepositoryInterface` y los dos servicios de `Modules\Loans`. `lender_approval_id` y `lender_cancellation_id` se generan en el monolito y los estados se aplican como lo haría el aviso de una entidad. No hay configuración que lo cambie; el módulo lo registra como `MTV1TD005`, bloqueante para producción.

Las tres rutas de caja dependen de `findTransaction`, que busca en `user_request_additional_information` la última fila de la solicitud con `type_data = 'MERCHANT_TRANSACTION'` (`TransactionLifecycle::ADDITIONAL_INFORMATION_TYPE`). El único punto que crea esa fila es `MerchantTransactionRepository::createTransaction`, y su único llamador es la simulación; fuera del módulo, ningún archivo de `main` nombra ese `type_data`. Una solicitud aprobada por el recorrido del cliente no tiene esa fila ni un código de caja que la referencie: la caja no puede encontrarla.

Para cobrar compras reales faltan tres piezas, y ninguna es una perilla: la integración de confirmación y cancelación con cada entidad, que el recorrido del cliente cree la fila `MERCHANT_TRANSACTION` y pida el código, y el recurso `transaction-codes` en `main` del servicio de códigos.

## La simulación escribe filas reales y su perilla depende de APP_ENV

`POST v1/qa/transactions` (`SimulateTransactionService`) reemplaza lo que pasa en el celular del cliente. Con el mismo token recibe `document_number` y `available_amount` obligatorios, y `document_type`, `code_type`, `lender_id` y `branch_hash` opcionales (`SimulateTransactionRequest`).

La perilla es `merchanttransactionsv1.simulation.enabled`, definida en `config/config.php` como `(bool) env('MERCHANT_TRANSACTIONS_SIMULATION_ENABLED', env('APP_ENV') !== 'production')`: sin la variable queda encendida en todo ambiente cuyo `APP_ENV` no sea `production`, también con `APP_ENV` sin definir. La fachada valida el cuerpo antes: apagada, un cuerpo inválido responde `MTV14001`/422 y no 404. El orquestador la compara con `!== true` antes de leer nada; apagada responde `MTV14002`/404 sin escribir. Apaga sólo esta ruta: las otras tres siguen respondiendo, sin transacciones que encontrar.

Valores por defecto y lo que se comprueba, con `MTV14004`/422 cuando falla:

- Sucursal: `findActiveBranchId` toma la sucursal del aliado con `status = 1` y ese `hash`, o sin `branch_hash` la de menor id.
- Cliente: `findCustomerIdByDocument` toma el `users.id` más alto con ese documento y `user_profile_id = 1`, filtrando por `document_type` sólo si se envía.
- Entidad: `lender_id` o `merchanttransactionsv1.simulation.default_lender_id` (`MERCHANT_TRANSACTIONS_SIMULATION_DEFAULT_LENDER_ID`, 68 por defecto). Es un id de `lenders` fijo en la configuración: a qué entidad corresponde depende de la base. Debe existir y tener nombres de estado que resuelvan `pending`, `completed` y `failed`; no se exige el de `cancelled`.

No comprueba que la entidad esté habilitada para el comercio o la sucursal, ni que el cliente califique, ni pasa por OTP, listado, centrales o el proceso de la entidad.

`createTransaction` escribe en una transacción de base: la solicitud en «Aprobada no desembolsada» con el cupo en `amount`, `original_amount` y `amount_available` y `credit_line_id = 1`; la fila de `lender_transactions` con el estado pendiente de la entidad y el `transaction_id` (UUIDv4) como `order_id`; y la fila `MERCHANT_TRANSACTION` con `corporate_user_id = 1` y el estado inicial `pending`. Los atributos de la solicitud y de la fila de estado no incluyen ninguna marca de prueba; la única huella es el literal `merchant-transactions-v1 simulation` en `request` y `response` de `lender_transactions`.

El código se pide después, fuera de esa transacción: `generate` con `reference` = id de la solicitud y `ttl_seconds` de `merchanttransactionsv1.code.ttl_seconds` (86400 por defecto). Si el servicio no responde 201 se lanza una excepción y la respuesta es `MTV14003`/500, con la solicitud ya creada y sin código. Con 201, `saveState` guarda `code_id` y `code_expires_at` y la respuesta trae el código, `image_base64` e `image_url`; esta última es null si `merchanttransactionsv1.code.image_public_base_url` (`MERCHANT_TRANSACTIONS_CODE_IMAGE_BASE_URL`, sin valor por defecto) está vacía.

Una simulación confirmada como `completed` es una solicitud «Autorizada» como cualquier otra para lo que lea `user_requests`.
