# Aporte a canon · `cuota/context` · «Al comercio se le avisa el monto financiado, no el total de su pedido»

Listo para dictar (ensayado con `/api/propose` contra el canon local el 2026-09-23: `ready: true`).
Falta publicarlo en canon de producción, que pide la VPN de prod.

- **node:** `cuota/context` · **kind:** `addition` · **source:** `verified` · **verified:** 2026-09-23
- **as_asked:** ¿por qué el monto que le llega al comercio en el aviso de la compra no coincide con el total del pedido?
- **archivos** (todos existen en `main`):
  - `legacy-backend`: `Modules/Onboarding/App/Services/EcommerceRequestService.php` · `Modules/Onboarding/App/Services/Ecommerce/SelfDevelopmentNotifier.php` · `Modules/Onboarding/App/Services/Ecommerce/WooCommerceNotifier.php` · `Modules/Onboarding/App/Services/Ecommerce/VtexNotifier.php` · `Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService.php` · `Modules/Loans/App/Services/PromissoryNoteService.php`
  - `legacy-application`: `app/Http/Controllers/Customer/WoocommerceController.php` · `app/Http/Controllers/Api/EcommerceController.php`
- **tablas:** `user_requests` (`amount`, `final_amount`, `initial_fee`) · `ecommerce_requests` · `lenders_by_allieds` (`administrative_costs_percentage`)

## Texto

Cuando una compra de tienda termina, CreditOp le avisa el veredicto al comercio, y el monto de ese aviso **no es el total del pedido**: es `final_amount` de la solicitud, el valor financiado. En el cierre de las entidades de la casa ese valor es **el monto más los costos administrativos** de esa entidad en ese comercio, sin el aval. Con costos administrativos del 7 %, un pedido de 2.000.000 se avisa como 2.140.000; con el porcentaje en cero los dos coinciden y la diferencia no se ve.

Los dos sistemas mandan ese número, con una diferencia. El nuevo avisa desde un solo punto, cuando la solicitud llega a Autorizada, y le **suma la cuota inicial** (`final_amount + initial_fee`). El viejo pasa `final_amount` sin la cuota inicial desde cada cierre que avisa. Con cuota inicial en cero dan lo mismo; con cuota inicial, el monto avisado depende de qué sistema cerró.

Qué lleva el aviso depende de la plataforma de la tienda. El desarrollo propio recibe el monto en `approvedAmount`. WooCommerce recibe sólo el estado, sin monto. VTEX recibe el monto en `value` desde el sistema nuevo y un aviso sin cuerpo desde el viejo.

El reclamo que produce: un comercio que cruza el monto del aviso contra el total de su orden no cuadra, y no es un error de cobro. El total que envió la tienda viaja en el contrato del checkout y no se reenvía en el aviso.
