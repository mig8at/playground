# Goldfish · fix/cuota-inicial-no-supera-el-total (legacy-backend)

- Commit validado: `e3e6658335` contra `origin/main`
- PR: #1643 (MERGED) https://github.com/Creditop-SAS/legacy-backend/pull/1643
- Corrida: 2026-11-13T10:18:57-05:00 → 2026-11-13T10:22:49-05:00 · costo equivalente: US$4.23

**16 hallazgos**: 5 confirmados · 5 plausibles · 6 descartados · 0 sin veredicto

## CONFIRMADO · alta — El cambio ya está en main: esta rama no tiene nada que proponer

`Modules/Loans/App/Services/PaymentIntentService.php:468` · elephant · contexto

`git cherry -v origin/main fix/cuota-inicial-no-supera-el-total` da `- e3e665833`: el mismo cambio ya entró como 9278335b4, del 2026-10-13. origin/main ya tiene AmountAboveTotalException.php y la validación en PaymentIntentService.php:468-471. La revisión de los goldfish se hizo sobre algo ya mergeado. Además, `git diff origin/main fix/...` revertiría decenas de archivos (workflows, Dockerfile, AlliedBranchV1…) porque la rama está atrasada. No se debe abrir un PR desde ella. Lo que sigue: borrar o archivar la rama y `pr/cuota-inicial-no-supera-el-total`, y actualizar `ramas:` y task.md:31-32 (la prueba en qa ya no espera el merge del backend).

> Veredicto: git cherry y git grep contra origin/main: el contenido ya está ahí.

## CONFIRMADO · media — La validación nueva no tiene ninguna prueba

`Modules/Loans/tests/Unit/Exceptions/Payments/PaymentExceptionTest.php:31` · goldfish · riesgos

La única prueba agregada revisa cómo se renderiza la excepción. Ninguna ejercita `createDownPaymentIntent`, así que no se cubren estos casos: un monto igual al total (el borde de `>=`), un monto un centavo menor, el caso con `policy->base` y el caso sin él (el fallback a `amount`), ni que el rechazo ocurra antes de crear la transacción PENDING. Si alguien invierte la condición o cambia el fallback, ninguna prueba falla. Además, el PR reconoce que no se probó de punta a punta en ningún ambiente.

> Veredicto: La única prueba agregada es la del render (PaymentExceptionTest.php:31-45). Ninguna prueba ejercita createDownPaymentIntent con el borde `==`, el caso de un centavo menos ni el fallback. La propuesta lo reconoce, y task.md:31-32 deja pendiente la prueba en qa.

## CONFIRMADO · baja — Si el mínimo es igual o mayor que el total, la cuota inicial no se puede pagar

`Modules/Loans/App/Services/PaymentIntentService.php:441` · goldfish · propuesta vs cambio

Si `minAmountInCents >= totalAmountInCents` (posible con el piso de exceso sobre cupo, o en el caso de respaldo con `amount`), cualquier monto termina en `AMOUNT_BELOW_MINIMUM` o en `AMOUNT_ABOVE_TOTAL`, y el comprador no tiene ninguna forma de pagar. Ni la propuesta ni el código consideran este caso.

> Veredicto: Pasa en el código: `amount = min(base, max(0, ceil(max(byQuota, byPolicy))))` (InitialFeePolicyResolver.php:275), así que el mínimo puede ser igual a la base cuando el cupo disponible es ≤ 0 o la política es del 100 %. En ese caso ningún monto pasa. El rechazo es correcto, porque esa solicitud tampoco se podría autorizar (financiado = 0). Lo que confunde es el mensaje: el comprador ve «debe ser menor que el total» sin ninguna salida. Severidad baja; habría que documentarlo.

## CONFIRMADO · baja — Si el mínimo es igual o mayor que el total, ningún monto pasa

`Modules/Loans/App/Services/PaymentIntentService.php:441` · goldfish · riesgos

Primero se exige `amount >= min` y después `amount < total`. Si en algún caso el mínimo que da la política (por ejemplo, con el piso por exceso sobre el cupo o con un porcentaje del 100 %) iguala o supera el total, el comprador no tiene ningún monto válido: recibe 422 por mínimo o por tope, sin salida y con un mensaje que no explica el problema. Antes ese caso cobraba y fallaba al autorizar, y ahora queda bloqueado sin cobrar. Sería bueno confirmar con datos si ese caso existe.

> Veredicto: Es el mismo caso del hallazgo 6, con InitialFeePolicyResolver.php:275 como evidencia. Baja: no se puede cobrar, que es lo correcto porque tampoco se podría autorizar, pero el mensaje no lo explica. Falta medir en prod con qué frecuencia el mínimo iguala la base.

## CONFIRMADO · baja — Un comentario viejo en minimumInitialFeeCents engañó a los dos revisores

`Modules/Loans/App/Services/PaymentIntentService.php:364` · elephant · contexto

El docblock de PaymentIntentService.php:360-367 (main) dice que el resolver no cubre «revolving, renting». Pero InitialFeePolicyResolver.php:65-68 ya resuelve el rotativo (response_type 3) con base. Los hallazgos 1 y 8 (el 8, «alta») se apoyan en ese comentario. Conviene corregirlo, o que la descripción diga en qué casos `base` es null (entidades con response_type distinto de 2/3, sin lenders_by_allied o sin crédito rotativo) y por qué ahí no se llega al cobro nuevo.

> Veredicto: Contradicción entre el comentario y InitialFeePolicyResolver::resolve en main.

## PLAUSIBLE · alta — Sin política, el tope se compara contra `user_requests.amount`, que en algunos flujos no es el total

`Modules/Loans/App/Services/PaymentIntentService.php:447` · goldfish · riesgos

`totalAmountInCents` usa `$policy->base` y, si es null, cae a `toCents($userRequest->amount)` (líneas 339-344). El mismo archivo dice que en los flujos que el resolver todavía no cubre (rotativo, renting) `amount` ya viene sin la cuota inicial y con el fondo de garantía adentro (comentario de las líneas 364-367). En esos casos el tope nuevo es el monto financiado y no el total de la compra. Ejemplo: compra de $1.000.000 con $300.000 financiados; una cuota inicial válida de $700.000 cumple `700.000 >= 300.000` y se rechaza con 422 `AMOUNT_ABOVE_TOTAL`. Así se bloquearían en producción pagos legítimos que hoy pasan. En los flujos en que `amount` sí trae el fondo de garantía sobre el total, pasa lo contrario: el tope queda más alto que el total real y deja pasar cuotas que luego deja el monto financiado en cero o negativo. Que el valor coincida con el preview no prueba que sea el total correcto, porque el preview usa el mismo fallback. El PR no dice qué tipos de solicitud tienen `base` null ni lo prueba.

> Veredicto: Es el mismo mecanismo que el hallazgo 1, y la severidad «alta» se apoya en el comentario viejo de PaymentIntentService.php:364-367. El rotativo ya tiene base (InitialFeePolicyResolver.php:115-157), y el renting no llega a este endpoint: el resolver da `unsupported` para response_type distinto de 2/3 (:68), y esas solicitudes van por el cobro viejo (task.md:194-198). El ejemplo «$300.000 financiados, cuota de $700.000 rechazada» necesita un down_payment con base null, y no encontré un camino vivo que lo produzca. Qué hay que comprobar en prod: si hay cobros down_payment nuevos con entidades de response_type distinto de 2/3, o rechazos AMOUNT_ABOVE_TOTAL en los logs desde el 2026-10-13.

## PLAUSIBLE · media — El tope no siempre es el total de la compra: si no hay `policy->base`, se compara contra `user_requests.amount`

`Modules/Loans/App/Services/PaymentIntentService.php:447` · goldfish · propuesta vs cambio

La propuesta dice que la validación compara contra «el total de la compra». `totalAmountInCents` sólo da ese total cuando la política trae `base`. Si no lo trae, devuelve `user_requests.amount`. Según los comentarios del mismo archivo (líneas 336-337 y 365-367), ese monto ya incluye el fondo de garantía y además ya tiene descontada la cuota inicial. Esto pasa en los flujos que el resolver todavía no cubre (rotativo, renting, `SOURCE_NONE`). Ahí el tope mide otra cosa: puede rechazar cuotas válidas o dejar pasar cuotas que igual dejan el monto a financiar en cero o negativo. Es cierto que el tope coincide con el preview, pero eso no garantiza que coincida con la regla de `FinancedAmount::assertPositive`, que es el problema que el PR dice resolver. La propuesta no aclara esta diferencia entre los dos casos.

> Veredicto: `totalAmountInCents` cae a `user_requests.amount` cuando `policy->base` es null (PaymentIntentService.php:339-344 en la rama). Pero el comentario de minimumInitialFeeCents en el que se apoya el hallazgo («rotativo, renting» sin cubrir, :364-367) está viejo: el resolver ya cubre el rotativo (InitialFeePolicyResolver.php:65-68, resolveByRevolvingCredit :115-157). En createDownPaymentIntent, `base` sólo puede ser null en tres casos: entidad sin response_type 2/3 (`unsupported`, :68), `lender_allied_not_found` (:89/:129) y `user_without_revolving_credit` (:123). En los tres, requireCategory (:539-556 en main) suele lanzar antes. Además, las entidades que no son CreditopX van por el cobro viejo (InitialFeePaymentService, ver task.md:194-198). Qué hay que comprobar: en prod, si algún `payment_gateway_transactions` con concepto down_payment tiene una entidad con response_type distinto de 2/3 o sin lenders_by_allied. No pude correr esa consulta: el permiso de SQL contra prod fue denegado.

## PLAUSIBLE · media — Supuestos sin escribir: que el front maneje `AMOUNT_ABOVE_TOTAL` y en qué orden se despliega

goldfish · propuesta vs cambio

El tope de la pantalla va en otro PR (`frontend-monorepo`). La propuesta no dice si el front actual muestra bien un 422 con un `code` que no conoce, ni si este PR puede salir antes que el del front. Tampoco dice qué otros canales llaman a `createIntent` con `down_payment` (el parámetro `originChannel` sugiere que hay varios, por ejemplo e-commerce) y que van a recibir el error nuevo.

> Veredicto: El PR del front existe: frontend-monorepo#1169 (task.md:28-30). No pude leer frontend-monorepo en esta sesión porque el acceso git a ese repo está bloqueado. Qué hay que comprobar: si #1169 ya está en main, y cómo muestra la pantalla de cuota inicial un 422 con un `code` desconocido. task.md:199-202 dice que, para LENDER_CONFIGURATION_NOT_FOUND, esa pantalla muestra el mensaje genérico «No pudimos iniciar tu pago», así que lo probable es que haga lo mismo. Como el backend ya está en main desde el 2026-10-13, el orden de despliegue ya se decidió de hecho.

## PLAUSIBLE · baja — Hay un código de error nuevo y el front que lo maneja sale en un PR aparte

`Modules/Loans/App/Exceptions/Payments/AmountAboveTotalException.php:28` · goldfish · riesgos

La API ahora puede responder `AMOUNT_ABOVE_TOTAL`. El tope en el front va en otro PR de `frontend-monorepo`. Si este PR se despliega antes, los clientes actuales (la app, las tiendas, el checkout) reciben un 422 con un código que no conocen y probablemente muestran un error genérico. Hay que acordar el orden de despliegue o confirmar que los clientes muestran el `message` del servidor.

> Veredicto: Es el mismo punto del hallazgo 5. El backend ya está en main (9278335b4); no pude verificar si frontend-monorepo#1169 entró, ni cómo muestra la pantalla un `code` desconocido, porque no tengo acceso git al repo del front en esta sesión.

## PLAUSIBLE · baja — Con factor de ajuste por plazo (la entidad 155), el umbral `>= base` no es exactamente el de assertPositive

`Modules/Loans/App/Support/FinancedAmount.php:44` · elephant · contexto

FinancedAmount::withoutGuarantee multiplica el capital (original − cuota) por factor·plazo cuando la entidad tiene fila de ajuste. Ahí financiado ≤ 0 ya no equivale a cuota ≥ base, porque los costos administrativos no se multiplican. Una cuota entre `original` y `base` da un capital negativo que, escalado, puede dejar financiado ≤ 0 aunque la cuota sea menor que la base. Pasaría el tope nuevo y fallaría al autorizar. Habría que comprobar si la entidad 155 cobra cuota inicial por PaymentIntentService.

> Veredicto: Se ve leyendo la fórmula; falta confirmar que la 155 llegue al cobro down_payment nuevo.

## DESCARTADO · media — Se da por hecho, sin mostrarlo, que el criterio de `>=` es el mismo que el de la autorización

`Modules/Loans/App/Services/PaymentIntentService.php:449` · goldfish · propuesta vs cambio

La propuesta da por sentado que `amountInCents >= total` rechaza justo los casos que después frena `FinancedAmount::assertPositive`. Ese código no está en el diff y no se explica cómo calcula el monto a financiar. Si la autorización resta la cuota a una base distinta (por ejemplo, con el fondo de garantía o con los costos administrativos), los dos criterios no coinciden. Entonces quedarían casos que se cobran y después no se pueden firmar, o casos que se rechazan sin necesidad. Tampoco hay una prueba de la validación dentro del servicio, como reconoce la propia propuesta, que confirme esta equivalencia.

> Veredicto: Con `base` presente, los dos criterios coinciden. base = original·(1+adm%)+fijo (InitialFeePolicyResolver.php:270), y lo financiado = (original − cuota) + original·adm% + fijo (FinancedAmount.php `withoutGuarantee`, en main). FinancedAmountTest exige que esa fórmula dé lo mismo que el `final_amount` de la autorización (LoanAuthorizationService.php:775-787). Entonces financiado ≤ 0 ⇔ cuota ≥ base, que es justo el `>=` del diff. La única excepción es el factor de ajuste por plazo (hoy sólo la entidad 155): ahí capital·factor·plazo desplaza el umbral; queda como hallazgo extra. Lo que sí falta es que la descripción muestre esta equivalencia.

## DESCARTADO · media — Si la cuota inicial ya está pagada, el reintento puede responder 422 en vez de 409

`Modules/Loans/App/Services/PaymentIntentService.php:449` · goldfish · riesgos

El tope se revisa antes de `assertNotAlreadyCompleted` y de `findReusablePending` (líneas 449-455). Supongamos que la cuota inicial ya se aprobó y después cambia el total o la política (por ejemplo, se recalcula `amount` o `base` después del pago), o que el cliente reenvía el mismo monto. El reintento ahora recibe 422 `AMOUNT_ABOVE_TOTAL` en lugar del 409 `PaymentAlreadyCompleted`, que trae la referencia del pago. Un front o una tienda que usa el 409 para mostrar «ya pagaste» o para redirigir le mostraría al comprador un error de monto aunque ya pagó. Pasa lo mismo con un cobro PENDING que antes se reutilizaba.

> Veredicto: El supuesto es que «el total cambia después del pago». Pero la base sale de original_amount y de los costos administrativos (InitialFeePolicyResolver.php:270). El webhook de Wompi reescribe `initial_fee` y `final_amount` (DownPaymentRecalculation, citado en CustomerFinancedAmountResolver.php:26-28), no original_amount. Un reintento con el mismo monto válido sigue siendo menor que la base y llega al 409 o al reuso igual que antes.

## DESCARTADO · baja — Los cobros pendientes ya creados con un monto mayor al total siguen vigentes

`Modules/Loans/App/Services/PaymentIntentService.php:453` · goldfish · propuesta vs cambio

La validación corre antes de `findReusablePending`, así que un reintento ahora recibe 422. Pero un PENDING creado antes del despliegue con una cuota mayor al total sigue vivo durante el TTL (`intent_ttl_minutes`, 60 minutos por defecto), y su referencia ya está en manos del cliente, que todavía puede pagarla en la pasarela. El PR no anula ni marca esos cobros, y la propuesta no menciona esta ventana ni cómo revisar los casos que ya se cobraron así.

> Veredicto: El cambio ya está en origin/main como 9278335b4, del 2026-10-13 (`git cherry origin/main fix/cuota-inicial-no-supera-el-total` marca `-` para e3e665833). La ventana de 60 minutos de los PENDING anteriores al despliegue ya pasó hace un mes. Revisar los casos que ya se cobraron así es otra cosa, que ya está en la tarea (task.md:31-32).

## DESCARTADO · baja — Un cambio de respuesta que la descripción no cuenta: 422 en lugar de 409 o del cobro reutilizado

`Modules/Loans/App/Services/PaymentIntentService.php:449` · goldfish · propuesta vs cambio

Al poner la validación antes de `assertNotAlreadyCompleted` y del reuso, una solicitud ya pagada, o con un pendiente reutilizable, que reciba un monto mayor o igual al total ahora responde 422 `AMOUNT_ABOVE_TOTAL` en vez de 409 `PAYMENT_ALREADY_COMPLETED` o del cobro reutilizado. La propuesta describe el orden, pero no dice qué cambia para los clientes que dependían de esas respuestas.

> Veredicto: El cambio de respuesta sólo ocurre cuando amount ≥ total. Una solicitud ya pagada con ese monto es justamente el caso roto que el PR ataca: con esa cuota no puede firmar (FinancedAmount::assertPositive, LoanAuthorizationService.php:787). Que responda 409 en vez de 422 no le sirve a nadie. Un reintento legítimo, con un monto menor que el total, sigue pasando a assertNotAlreadyCompleted y al reuso (PaymentIntentService.php:453-459 en la rama).

## DESCARTADO · baja — `intent.md` no habla de este cambio

`intent.md` · goldfish · propuesta vs cambio

`intent.md` describe un contenedor de defectos que se van pasando a tareas con Jira. No pide esta validación. El PR no enlaza ninguna tarea ni ticket de Jira, así que no se puede comprobar que el defecto haya salido de ese contenedor como pide el objetivo, ni que lo que se arregla sea lo que se reportó.

> Veredicto: La tarea sí registra el defecto y su PR: task.md:28-30 («Abrir los PRs del tope de la cuota inicial», legacy-backend#1643 y frontend-monorepo#1169), y `ramas:` declara esta rama (task.md:11). Lo que no tiene es Jira (`jira: []`, task.md:9), algo que la tarea admite para defectos con PR.

## DESCARTADO · baja — Reglas de PR: sin herramientas internas y sin pruebas destructivas

`Modules/Loans/tests/Unit/Exceptions/Payments/PaymentExceptionTest.php:31` · elephant · contexto

proposal.md no nombra harness, tablero, playground, canon ni comandos make. La prueba nueva (PaymentExceptionTest) no usa RefreshDatabase ni DatabaseTransactions, y Modules/Loans/tests no tiene Pest.php que lo herede (ls-tree en la rama). Se puede correr con ruta explícita sin riesgo para la BD. La otra rama con nombre parecido, fix/rotativo-cuota-inicial-tras-autorizar, es de la tarea integracion-vtex y ya está en main (git cherry vacío), así que no hay que juntarla con esta.

> Veredicto: No hay incumplimiento: se comprobó con git grep y ls-tree en la rama.

---

## La propuesta que se revisó (redactada por el elephant)

### Rechazar la cuota inicial que iguala o supera el total de la compra antes de cobrarla

## Qué cambia y por qué

Al crear el cobro de la cuota inicial (`PaymentIntentService`), el backend sólo validaba el **mínimo**. Si el comprador pagaba una cuota inicial igual o mayor que el total de la compra, el cobro se creaba y la pasarela cobraba el dinero; la solicitud recién se frenaba al autorizar, porque el monto a financiar quedaba en cero o negativo (`FinancedAmount::assertPositive`). Para entonces la cuota inicial ya estaba cobrada y el comprador no podía firmar.

Ahora el cobro se rechaza **antes de pedir dinero**: si `amountInCents >= total`, se lanza `AmountAboveTotalException`, que responde **422** con código `AMOUNT_ABOVE_TOTAL`, un mensaje en español («La cuota inicial debe ser menor que el valor total de la compra.») y `total_amount_in_cents` en el payload. El total se calcula con el mismo método (`totalAmountInCents`, con la política que resuelve `initialFeePolicyResolver`) que usa el preview para mostrarle el total al comprador, así que el tope coincide con lo que ve en pantalla.

La validación se hace después del chequeo del mínimo y antes de mirar si el pago ya está completado o si hay un cobro pendiente reutilizable.

## Qué se tocó

- **Excepción nueva:** `Modules/Loans/App/Exceptions/Payments/AmountAboveTotalException.php` (extiende `PaymentException`, igual que `AmountBelowMinimumException`).
- **Servicio:** `Modules/Loans/App/Services/PaymentIntentService.php`, la validación del tope en la creación del cobro de cuota inicial.
- **Prueba unitaria:** `Modules/Loans/tests/Unit/Exceptions/Payments/PaymentExceptionTest.php`, que comprueba que la excepción se renderiza como 422 con `code`, `message` y `total_amount_in_cents`.

## Cómo se comprobó

- La prueba unitaria nueva cubre **sólo el render de la excepción** (código, estado y payload). No hay una prueba que ejercite la validación dentro de `PaymentIntentService`.
- **Todavía no se probó de punta a punta en un ambiente.** Queda pendiente: una compra donde una cuota inicial mayor que el total sea rechazada por API con `AMOUNT_ABOVE_TOTAL`.

## Qué NO entra

- El tope en la pantalla de cuota inicial del front va en un PR aparte, en `frontend-monorepo`. Este PR sólo agrega la defensa del backend.
- Quién registra la cuota inicial fuera de la tienda y el `redirect-url` del cobro viejo (`InitialFeePaymentService`) son problemas distintos y no se tocan acá.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
