entitlement-service guarda en su propia base PostgreSQL qué beneficios tiene cada persona. No cobra: la tienda (App Store o Google Play) cobra y fija el precio, RevenueCat informa el estado de la suscripción y el servicio lo convierte en concesiones. `user_id` es siempre el `users.id` de legacy.

**El catálogo.** Un beneficio (`benefits`) es un permiso; un plan (`plans`) agrupa beneficios por `plan_benefits`. El plan `premium_subscription` se vende en las tiendas con el entitlement `premium` de RevenueCat y trae `premium.access` y `financial_health.full`. El plan `creditop_x` no se vende: trae sólo `financial_health.full`.

**`grants`** es el libro de acceso. Cada fila dice que una persona tuvo un plan entre `starts_at` y `ends_at`:
- `source` es el origen: `store` (una suscripción de tienda, con `store_subscription_id`) o `creditop_x` (una compra con código de la app, con `rule_version_id` y el `user_request_id` en `source_reference`).
- `state` es `active`, `ended` o `revoked` (con `revoked_at` y `revoke_reason`).
- `benefits_snapshot` congela los beneficios del plan al emitirse; editar el plan después no cambia las concesiones existentes.

Un grant da acceso sólo si `state = 'active'` y `starts_at <= ahora < ends_at`. **Premium es únicamente el beneficio `premium.access`**: un grant vigente de `creditop_x` no es premium, aunque la consulta de acceso de la persona lo cuente en `hasActiveSubscription`. En los grants de tienda, `ends_at` lleva un margen sobre el fin del periodo; la fecha que se le muestra a la persona es `store_subscriptions.current_period_ends_at`.

**`store_subscriptions`** copia lo que RevenueCat informa, una fila por suscripción y titular: `store` (la tienda que informa RevenueCat; `promotional` es un acceso regalado desde RevenueCat, no una compra), `environment` (`production` o `sandbox`), `status`, `gives_access`, `auto_renewal_status`, `starts_at`, `current_period_ends_at` y los acumulados `total_revenue_usd_*`.

**Sandbox.** Un despliegue de producción sólo acepta suscripciones `production`; las `sandbox` dan acceso en develop o, en producción, sólo a las cuentas listadas en `revenuecat.sandbox_user_ids` (App Review y QA). Una suscripción sandbox de cualquier otra persona queda grabada con su grant en `ended`.

**Para soporte o datos:**
- ¿Tiene premium ahora? Un grant `active`, vigente por fechas, cuyo `benefits_snapshot` trae `premium.access`. En la práctica: `source = 'store'` sobre una `store_subscriptions` con `environment = 'production'`.
- ¿Pagó? `store_subscriptions` con `store` distinto de `promotional` y `environment = 'production'`. Cada cobro llega en `revenuecat_events` (`INITIAL_PURCHASE`, `RENEWAL`, con `price_in_purchased_currency`, `currency`, `period_type`); un `price_in_purchased_currency` negativo o `cancel_reason = 'CUSTOMER_SUPPORT'` es un reembolso.
- ¿Cuántos lo tienen? Las métricas del servicio cuentan grants `store` vigentes respaldados por una suscripción `production`, una vez por suscripción de la tienda, y dejan fuera los `promotional` de las cuentas sandbox.

El precio de lista no está en el código ni en la base: vive en la tienda y en RevenueCat.
