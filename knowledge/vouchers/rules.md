# Vouchers: el comprobante de la compra y el de cada pago

Un **voucher** es un PDF angosto con forma de tirilla de datáfono («¡Transacción exitosa!») que se le manda al
cliente. Hay **dos**, con la misma forma y propósitos distintos, y conviene no confundirlos:

| | voucher de compra (`voucher-disbursement`) | voucher de pago (`voucher-payment`) |
|---|---|---|
| cuándo sale | una vez, cuando la solicitud queda Autorizada (11) | cada vez que el cliente paga una cuota CreditopX |
| para qué | el comercio lo mira para entregar el producto; el cliente lo guarda | prueba de que el cliente pagó |
| qué dice | cliente, comercio, punto de venta, **valor de la compra**, entidad, transacción y referencia | cliente, entidad, **monto pagado**, **método de pago** (y el punto de venta si fue en caja), referencia del pago |
| para qué entidades | todas (con las excepciones de abajo) | sólo CreditopX: es la única cartera que CreditOp recibe |
| plantilla | `resources/views/customer/voucher.blade.php` | `resources/views/payment/voucher.blade.php` |
| traza | `request_vouchers` | `payment_vouchers` |

Una entidad externa o delegada (Finandina) cobra ella: el recibo de cada cuota lo da ella, no CreditOp. Este tema
describe legacy-backend (que genera los dos) y lo que conserva legacy-application.

## El voucher de compra: cuándo sale

En legacy-backend lo arma `VoucherService::generateVoucher` y lo llaman, entre otros:

- **La autorización** (`LoanAuthorizationService`): después del `commit` que deja la solicitud en 11, junto con las
  notificaciones, en su propio `try/catch` que sólo deja traza. **Un voucher que falla no revierte la
  autorización.** En el flujo **IMEI** (la entidad cuyo `path` es IMEI) se salta aquí y sale recién al desembolsar el
  equipo.
- **La caja del comercio** (`ConfirmTransactionService`, al confirmar una compra): también después y sin revertir.
- Los webhooks y retornos de entidades externas que cierran la solicitud por su lado.

legacy-application conserva su propio generador (`Customer/VoucherController`, con Dompdf) y lo siguen llamando la
firma del pagaré (`ValidateOtpPromissoryNoteController`) y los webhooks de las entidades que viven ahí. Esa versión
no tiene marca blanca y formatea el monto en pesos colombianos fijo.

Para Credifamilia el PDF lo hace el pdf-mapper con su propio documento `voucher` (`config/documents.php`); para las
demás, la plantilla Blade.

## Dónde queda el de compra y su traza

Se guarda en S3, **público**, en `admin/allieds/vouchers/{cédula}-{request_number}.pdf` (`RequestVoucherTarget`). La
URL no queda en ninguna columna de la solicitud: la llave es fija, así que se encuentra armándola. Desde octubre de
2026 cada generación escribe una fila en **`request_vouchers`** (`user_request_id`, `storage_key`, `source` —
`generated`, `manual`, `linked`, `backfill`—, quién lo generó y cuándo se notificó). Si alguien busca el voucher y
existe en S3 sin fila (lo generó legacy-application, que no escribe esa tabla), `RequestVoucherLocator` lo adopta como
`linked`.

## Cómo le llega al cliente

- **WhatsApp**, por el servicio de mensajería, con la plantilla `disbursement_voucher_{sufijo}` y la ruta del PDF; el
  país sale del comercio (`countries.iso_code_1`), y para República Dominicana va también por SMS
  (`LoanMessagingServiceRepository::getRoutingData`).
- **Correo**, con el PDF adjunto; si la entidad es del canal SmartPay sale con su remitente y su marca.
- **Marca blanca:** si la entidad tiene `lenders.voucher_image_url`, el voucher lleva su logo (embebido); si no, el de
  CreditOp. El monto se formatea con la moneda del país del comercio (`App\Support\Money`).

La notificación sólo se marca (`notified_at`) cuando salió. Si falla, la excepción sube **después** de haber subido el
PDF y registrado la fila: el voucher existe aunque no le haya llegado al cliente.

## Generar o regenerar el de compra a mano

- **Backoffice nuevo** (`ApplicationVoucherService`, `POST /applications/{id}/voucher`): genera con `source = manual`
  y una leyenda «generado manualmente» en el PDF. Se niega si la solicitud no está en 11, si le falta número,
  monto final, entidad o cédula, si la entidad no es de las que se operan a mano (`response_type` 0 y 1) o si ya
  existe (salvo que se pida regenerar).
- **Admin viejo** (`UserRequestVoucherController`, permiso `regenerate request voucher`): primero se lo pide a
  legacy-backend por su ruta interna (`/api/internal/applications/{id}/voucher`, sin llave propia: vive en la red
  interna y el permiso lo resuelve el admin); si legacy-backend no está configurado o no contesta, lo genera él mismo.

## El voucher de pago: cuándo sale

Sólo para pagos de cartera CreditopX:

- **legacy-backend** (`CreditopXPaymentService`): al aplicar un pago despacha el job `GeneratePaymentVoucher`
  **después del commit** (`afterCommit`). Antes se generaba dentro del cobro y una falla del PDF deshacía un pago
  que la pasarela ya había cobrado. El método va como «Físico» si lo registró un asesor y «En línea» si no. Un pago
  de **cupo rotativo** no pasa por acá: tiene su propio job (`GenerateRevolvingPaymentVoucher`), con la utilización
  más reciente.
- **legacy-application** ya no lo genera: al aplicar un pago (`CreditopXPaymentController::processPayment`) encola
  `RequestPaymentVoucher`, que le pide a legacy-backend que lo haga (`PaymentVoucherApiClient`, ruta interna
  `.../payment-vouchers/payments/{id}/enqueue`). Las etiquetas viejas se traducen: «Cajas» y «caja comercio» son
  «Físico»; «PSE» y lo demás, «En línea» (`PaymentVoucherMethodLabel`). El pago en caja de Pullman pasa por ahí y
  tiene voucher; el comando que aplica pagos pendientes en efectivo (`ApplyPendingCashPaymentCommand`) no genera
  ninguno.

Llega por **correo** y por **WhatsApp** (plantilla `payment_voucher_{sufijo}`), los dos desde legacy-backend.

## Dónde queda el de pago y quién lo ve

Se guarda en `admin/allieds/vouchers/payments/{user_id}-{referencia}.pdf` (`PaymentVoucherTarget`): por el id del
usuario y no por la cédula, para que la llave siga valiendo si se corrige el documento y la cédula no quede en una
URL pública. Si S3 rechaza la subida, falla en vez de mandarle al cliente un enlace a un archivo que no existe. La
fila va en **`payment_vouchers`**, una por registro de pago (o por pago de cupo), con su `storage_key`, su `source` y
quién lo generó; si escribir la fila falla, el PDF igual queda y se enlaza después. El acceso es por URL firmada de
10 minutos (`PaymentVoucherLocator`), y `payment-vouchers:backfill` enlaza lo que ya estaba en S3 sin generar nada.

El portal de aliados y asesores de legacy-application (`Customer/PaymentVoucherController`) sólo lo **consulta**.

## Generar uno de pago a mano: las reglas

Desde el admin viejo (`Admin/PaymentVoucherController`, permiso `generate payment voucher`), que llama a
legacy-backend (`/api/internal/payment-vouchers/payments/{id}/generate`, con una llave `Bearer`; sin llave
configurada se niega todo). `PaymentVoucherEligibility` lo permite sólo si se cumplen todas:

1. Es plata que pagó el cliente: tipo de pago 1 a 4 (retenido, capital, cuota, total). Un descuento por pronto pago,
   un subsidio, una condonación, una reversión o una cuota inicial no tienen voucher.
2. Pagó al menos $1 (menos es un residuo de redondeo).
3. El registro está «Recibido» y no fue reversado.
4. Si vino por pasarela, la transacción está aprobada y es sólo de ese pago; un pago en línea sin ese enlace necesita
   una transacción aprobada del mismo crédito a menos de 30 minutos.
5. El detalle del pago (`creditop_x_payments`) suma lo pagado, con $1 de tolerancia.
6. En un rotativo, todos los registros del pago cumplen y suman el pago entero.
7. El cliente tiene cédula y no está liberada (sufijo `-tN` de un usuario borrado o de prueba).
8. El pago no tiene voucher todavía: **nunca se reemplaza uno existente**.

El generado a mano no se le notifica al cliente.

## Lo que no es un voucher aunque se llame así

- **El «voucher» del riel 4** (`GET {lender_slug}/voucher/{solicitud}`, `PaymentPlanVoucherService`): un JSON con el
  resumen del crédito delegado para la pantalla final. No es un PDF ni queda en S3.
- **El recibo del pago para el cliente** (`CustomerPaymentReceipt`): un JSON del pago (usa el mismo logo de marca
  blanca), distinto del PDF.
- **El comprobante de cuota inicial** de legacy-application (una entidad puntual): se guarda en la misma llave que el
  voucher de compra y la pisa.

## Límites

- Lo que generan los webhooks de legacy-application no escribe `request_vouchers`: esa traza se completa sólo cuando
  alguien busca el voucher y legacy-backend lo adopta como `linked`.
- legacy-application conserva una ruta pública vieja de regeneración (`POST /api/voucher/regenerate`), marcada como
  deprecada, que cambia el monto final antes de regenerar.
- Este tema no cubre qué pasa con la plata entre la entidad y el comercio después del voucher de compra (el
  desembolso al comercio): eso lo define cada convenio.
