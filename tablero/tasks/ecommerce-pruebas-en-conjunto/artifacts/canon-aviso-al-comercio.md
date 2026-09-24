# Aporte a canon · `cuota/context` · «Al comercio se le avisa lo financiado, no el total de su pedido»

Publicada el 2026-09-23 en canon de producción (revisión 9) por el recurso directo, SIN su área.
Los archivos y tablas de abajo se declaran como su área cuando se despliegue Creditop-SAS/playground#284.

- **node:** `cuota/context` · **kind:** `addition` · **source:** `verified` · **verified:** 2026-09-23
- **as_asked:** ¿por qué el monto que le llega al comercio en el aviso de la compra no coincide con el total del pedido?
- **archivos** (todos existen en `main`):
  - `legacy-backend`: `Modules/Onboarding/App/Services/EcommerceRequestService.php` · `Modules/Onboarding/App/Services/Ecommerce/SelfDevelopmentNotifier.php` · `Modules/Onboarding/App/Services/Ecommerce/WooCommerceNotifier.php` · `Modules/Onboarding/App/Services/Ecommerce/VtexNotifier.php` · `Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService.php` · `Modules/Loans/App/Services/PromissoryNoteService.php`
  - `legacy-application`: `app/Http/Controllers/Customer/WoocommerceController.php` · `app/Http/Controllers/Api/EcommerceController.php`
- **tablas:** `user_requests` (`amount`, `final_amount`, `initial_fee`) · `ecommerce_requests` · `lenders_by_allieds` (`administrative_costs_percentage`)

## Texto (el publicado)

Cuando una compra de tienda termina, CreditOp le avisa el veredicto al comercio con un monto, y ese monto **no es el total del pedido**: sale de `final_amount` de la solicitud, que es **lo financiado**. En el cierre de las entidades de la casa, lo financiado es el total del pedido **menos la cuota inicial** y **más los costos administrativos** que esa entidad cobra en ese comercio, sin el aval.

Los dos sistemas lo mandan distinto. El viejo avisa `final_amount` tal cual desde cada cierre, así que con cuota inicial el comercio recibe **menos** que el total de su orden. El nuevo avisa desde un solo punto, cuando la solicitud llega a Autorizada, y le **suma la cuota inicial** (`final_amount + initial_fee`): cuadra con el total salvo cuando la entidad cobra costos administrativos, y ahí da **más**. Con costos del 7 %, un pedido de 2.000.000 sin cuota inicial se avisa como 2.140.000.

Medido en producción el 2026-09-23, sobre las 725 compras de tienda autorizadas y avisadas en 90 días: `final_amount` no coincide con el total del pedido en 135 (129 por debajo, todas con cuota inicial); sumándole la cuota inicial no coincide en 30 (28 por encima, 24 de ellas con costos administrativos de la entidad).

Qué lleva el aviso depende de la plataforma de la tienda. El desarrollo propio recibe el monto en `approvedAmount`; WooCommerce recibe sólo el estado, sin monto; VTEX recibe el monto en `value` desde el sistema nuevo y un aviso sin cuerpo desde el viejo.

El reclamo que produce: un comercio que cruza el monto del aviso contra el total de su orden no cuadra, y no es un error de cobro. El total que envió la tienda viaja en el contrato del checkout y no se reenvía en el aviso.
