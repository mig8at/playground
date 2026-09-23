---
id: 6
title: "Ecommerce web stateless"
stage: work
created: "2026-07-21T10:30:30-05:00"
canon: [fronteras, onboarding, cuota, arquitectura]
jira: [CORE-30]
cuadrilla: ecommerce/miguel
jira_title: "Ecommerce: flujo de onboarding hasta el listado de entidades, webhook y retorno al comercio"
ramas: flujo-por-origen, autogestion-sin-entrega-al-propio-cliente, ecommerce-cuota-inicial-boton-muerto, cuota-inicial-rebote-asesor-qa, restore/ecommerce-checkout-y-rebote, ecommerce-stateless-checkout, ecommerce-bienvenida-campos-y-cuota-inicial, sala-de-espera-ecommerce, ecommerce-boton-volver-al-comercio, ecommerce-checkout-al-wizard, preapprovals-promesa-rechazada, fix/listado-tramo-por-monto, fix/importes-de-la-tarjeta-en-ecommerce
---

# Ecommerce web stateless (→ wizard sin cookie)

## Pendientes

**La entrega**

- [ ] **Pushear el port de #1018 a #1016** — cherry-pick limpio, commit `33649662` sobre `f474b237`, build
      verde. Va **por SHA**: la rama está tomada por el worktree de otra sesión. Termina cuando el PR muestra
      los 9 `minimumInitialFee` que tiene `qa`.
- [ ] **Mergear #1016 cuando QA valide ecommerce en `qa`** — decisión de Miguel del 15/9. Es la única vía de
      reponer el código en `main` después del revert, porque el revert es pegajoso: los commits de #997 y
      #1005 siguen siendo ancestros de `main`, así que ninguna promoción los trae de vuelta. Termina cuando
      `apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx` resuelve en `origin/main`.
      Depende de: QA — el visto bueno de los tres canales.
- [ ] **Promover `qa` → `main`, después de #1016** (la promoción la llevan Laura y Oscar). Medido: con #1016
      aplicado el merge es limpio; sin él da conflicto en `routes.ts` y `available-lenders.tsx`, y resolverlo
      a favor de `qa` deja `routes.ts` apuntando a cuatro archivos inexistentes → build roto.
- [ ] **Cerrar la cola de junio: queda mirar #582.** Re-medido el 18/9 contra `origin/qa` — **#665 y #661 ya
      volvieron** (el guard `!response.data.standBy` en `available-lenders`, con el comentario que lo explica,
      y `continue` declarado en los **dos** árboles por `sharedFlowRoutes()`), **#600** se rehizo dentro de
      #997 y **#663** se descartó a propósito. Falta decidir **#582** —el cierre in-platform de CreditopX—,
      cuyo resultado hoy lo da la decisión por origen. Termina cuando esa lista quede vacía o cerrada.
- [ ] **Decidir qué pasa con el backend #1392, que quedó solo en `main`** — el revert no lo tocó. Revertirlo
      también, o dejarlo esperando al front. Es la misma asimetría del par de junio.
- [ ] **Llevar a producción el redirect del checkout viejo** — ya no hace falta pedírselo a Infra:
      `legacy-application#169` lo hace en el monolito y está en su `develop`. ⚠ No puede ir antes de que
      `/ecommerce/{hash}/checkout` exista en `main` del wizard, y tiene que seguir dejando afuera a Corbeta
      (`[24,209,210,211,311]`), que es el tráfico que hoy mejor convierte.
- [ ] Extender el cutover al resto del ecommerce no-Corbeta (el array quemado del `WoocommerceController`).
- [ ] Borrar la lógica ecommerce duplicada en `legacy-application` una vez completo en `main`.

**Lo que quedó abierto al probar**

- [ ] **Mergear `frontend-monorepo#1039` a `qa`** — el arreglo de los importes en `-`, ya abierto
      (rama `fix/importes-de-la-tarjeta-en-ecommerce`, `42be10f5`). Termina cuando la tarjeta del
      canal de tienda muestre números sin tocar nada. *(Era el hallazgo de abajo, ya atacado.)*
- [x] ~~**En ecommerce la tarjeta muestra `-` en «Valor a financiar» y «Cuota», y es un cabo suelto de
      #1018.**~~ El canal no pide la cuota inicial, así que el mínimo nunca se satisface y
      `hasAmountToShow` (`LenderCardSummaries.tsx:71`) deja los dos importes apagados para siempre.
      El arreglo: usar el `effectiveInitialFee` que `useInstallmentOptions.ts` ya resuelve para los
      plazos. Va en `frontend-monorepo`, o sea en el PR del front de esta tarea, no en #1441.
      Reportado por Duncan el 21/9 como «al cambiar cuotas no cambia la cuota» — el plazo sí
      recalcula (medido: 6 → $264.970, 3 → $515.541); lo que no hay es números que mirar.

- [x] ~~**Averiguar qué backend y qué base usa `originaciones-qa`**~~ · ~~**forzar su
      redespliegue**~~ — **los dos se caen: el diagnóstico que los generó era equivocado.** No era otra
      base ni una imagen vieja: el servicio tiene **varias tareas** y no rotaron a la vez, y la
      solicitud que no aparecía la había borrado la restauración de la base que estaba corriendo
      infra. Verificado el 21/9 a las 21:04Z: `lock_amount: true` y el campo `readOnly` en `qa`.
- [ ] **`wait-for-service-stability: true` en `config-ci`** (`deploy-task.yaml`, paso «Deploy to
      Amazon ECS»). Hoy el workflow sale ✔ apenas ECS acepta la orden, así que una flota a medio rotar
      se ve igual que una desplegada — es lo que costó la tarde del 21/9. Termina cuando un despliegue
      que no rota salga en rojo. Es de `config-ci`, no de esta tarea: hay que pasárselo a infra.
- [ ] **Confirmar si `harness/.env.qa` apunta bien.** Declara `E2E_DB_HOST=inertia-dev`; la corrida del
      arnés contra `qa` del 21/9 murió en el OTP y se leyó como que la base era otra, pero eso fue
      durante la restauración. **Por confirmar, no es un hecho** — rehacer la corrida con la base
      estable antes de tocar nada.
- [ ] **Cablear en el arnés el chequeo que faltó:** crear un id y preguntarle al backend si lo conoce.
      Es el equivalente, para la BASE, de lo que el `CLAUDE.md` del arnés ya recomienda para la RAMA
      (`allowed_document_types`). Y su hermano: **sondear el render del servidor varias veces**, que es
      lo único que delata una flota mixta — diez respuestas iguales no prueban una sola instancia.

- [ ] **El flag `is_ecommerce` del listado v2 está MUERTO y tiene dos consumidores más.** Sale del query
      string y el front no lo manda (lo resuelve bien y lo tira al armar la URL). Además del candado del
      monto —que ya no depende de él— lo usan `LenderListingService::getSteps()` (`:333`) y
      `getAlliedBranch()` (`:148`), y los dos reciben `false` siempre. Las opciones son dos: que el
      repositorio del front lo mande, o que el backend lo resuelva con
      `EcommerceRequest::existsForUserRequest()` como ya hace el candado. Lo segundo es más robusto
      —no depende de que el cliente se acuerde— pero **cambia qué pasos ve el comprador**, así que hay
      que medir antes qué devuelve `getSteps` con `true`.

- [ ] **Decidir con negocio con QUÉ MONTO se elige la banda de `creditop_x_conditions_by_amount_by_lender`.**
      Hoy el plan de pagos usa `user_requests.amount`, que viene inflado por el factor del plazo MÁXIMO
      porque el cliente todavía no eligió; el front usa `original_amount − initial_fee`. Con
      `fix/listado-tramo-por-monto` los dos ya contestan lo mismo —así que la tarjeta no miente— pero el
      monto que manda sigue siendo el inflado. Corregirlo **cambia el plazo que recibe el 39 % de Motai X
      en producción** (89 de 227 en 90 días), así que no es un refactor.
      Depende de: negocio / riesgo.
- [ ] **Decidir qué se hace con los 31 créditos de Motai X a 18 cuotas**, un plazo que la entidad no
      declara (`fee_numbers = 6,12,24,36`). Sale de la rama `mandatory_fee_number`, que devuelve el techo
      de la banda **aunque no esté en la lista** — está así en producción desde siempre y el arreglo lo
      conserva a propósito, para que la tarjeta diga lo mismo que el plan. Si 18 no es un plazo válido,
      el arreglo es del dato (la fila del tramo), no del código.
      Depende de: negocio.
- [ ] **La tercera capa: `PaymentCalculationService::applyProductFilters` (`products.max_term`) tampoco
      la aplica el listado.** Medido en prod: sólo 4 productos tienen `max_term` y suman **22** usos
      históricos, todos de «N sesiones». Es el mismo defecto con impacto casi nulo — se cierra con el
      mismo patrón cuando toque, no antes.
- [ ] **Mergear #1441 cuando lo revisen** — abierto contra `qa` (rama `fix/listado-tramo-por-monto`,
      commits `9b956475` + `ef435701`). Lleva DOS cosas: el tramo por monto recortando la tarjeta y el
      monto de la tienda bloqueado. Termina cuando las dos estén en `qa`; después viajan a `main` con
      la misma promoción que el resto.

- [ ] **El hueco de la credencial:** `$inPlatformContinueUrl` sólo se asigna en la rama `empty($credential)`,
      así que una entidad en plataforma **con** credencial nunca dispara el arreglo. Tres pares reales en la
      base de `qa`, los tres con Credifamilia.
- [ ] **Confirmar con producto el ORDEN del cobro de cuota inicial** en autogestión — la única decisión de
      criterio de #997, comentada en el código.
      Depende de: producto — en qué momento se cobra cuando el comprador sigue solo.
- [ ] **Ensanchar el `include` de vitest del wizard** — cubre `lenders-marketplace/src/lib/utils/**` y hay 20
      archivos de prueba bajo `src/lib/**`: **19 no corren nunca**. Medido: ensancharlo lleva de 492 a 703
      pruebas y destapa **4 fallas reales**. Es otra entrega, con su propio riesgo.
- [ ] **El caminador siembra antes del `action` de `personal-info`** — se destrabó con resiembra dirigida
      (16/9), pero el arreglo de fondo es que `sembrar()` corra DESPUÉS y reciba `c.lender`.
- [ ] **F-214 (producto):** un comercio sin ninguna entidad `rt=0` no debería ofrecer «Confirmación de cupo»,
      o la pantalla vacía debería dejar volver atrás. Hoy el cliente queda sin salida.
- [ ] **F-215:** el arreglo es un carácter (`window.ENV?.APP_ENV` en `entry.client.tsx:14`) y toca una rama
      ajena a esta tarea. Está en `main` y en `qa`.
- [ ] **F-216:** el fallback mudo sigue abierto — el front no distingue «este comercio va por el legacy» de
      «no pude preguntarlo».
- [ ] **F-223:** con una entidad habilitada en la sucursal y sin fila de orden en el comercio, el listado
      devuelve 500 y tumba la pantalla entera. Diagnosticado el 17/9, **no es de esta tarea**: queda decidir
      quién lo toma. Igual en `main` y en `qa`.

**Por promover a F-xx**

- [ ] **Un despliegue que sale ✔ sin haber rotado la flota.** El workflow de `qa` reporta éxito apenas
      ECS acepta la orden (`wait-for-service-stability` no está), así que una flota a medio rotar se ve
      igual que una desplegada. Medido el 21/9: horas de diagnóstico, y el síntoma aparecía lejos —en
      una pantalla que «no tomaba el cambio»—.
- [ ] **N respuestas iguales NO prueban una sola instancia.** Diez peticiones seguidas al mismo host
      dieron `true` las diez y eso se leyó como «hay una sola tarea, y tiene el código». Eran diez
      caídas en la misma. Lo que delata la mezcla es **sondear el render del SERVIDOR** varias veces:
      ahí salió 4 de 5. Es hermano de la trampa de la sonda del trazador, que muestra una MUESTRA.
- [ ] **Cuando un dato DESAPARECE, la hipótesis barata es que alguien esté tocando la base**, no que
      te estén mintiendo sobre cuál es. El 21/9 una solicitud que el front mostraba no estaba en la
      base, y de ahí salió la conclusión —falsa— de que `qa` usaba otra. La causa era una restauración
      en curso, y preguntarlo en el canal del equipo costaba un minuto.

- [ ] **Una ruta registrada en UN árbol de `routes.ts` y no en el otro no falla en ningún lado:** compila,
      pasa lint, y React Router la matchea en el árbol vecino en silencio hasta rebotar al inicio. Pasó
      **tres** veces (`continue`, `initial-fee-payment`, `validate-lender-otp`).
      ⚠ **Acá decía que «en `qa` el mecanismo ya está cerrado por `sharedFlowRoutes()`». Es FALSO para
      `validate-lender-otp`** — verificado el 2026-09-21 contra el árbol en rama `qa`:
      `sharedFlowRoutes()` comparte tres rutas y ésa no está; sigue declarada sólo en el árbol
      `merchant` (`routes.ts:204`). Medido corriéndolo: Sistecrédito (rt=1) desde la tienda da **404
      duro** y el comprador queda sin salida. Falta moverla a `sharedFlowRoutes()` —con su `lender-otp-validated`, que está al lado— y recién ahí promover la clase a F-xx.
- [ ] El `erId` pre-OTP viaja por el header `Referer` y depende de que `Referrer-Policy` siga en
      `strict-origin-when-cross-origin`; endurecerla rompe el prefill **en silencio**.
- [ ] En local, un `OBV21002` no deja rastro: el tracer escribe a un Loki inexistente y el fallback al log de
      Laravel nunca dispara.
- [ ] La guarda `I_KNOW_THIS_TOUCHES_SHARED_DEV` (F-53) **sólo cubre las escrituras por `pkg/db.ts`**: todo
      lo que escribe por la API contra dev pasa sin pedir permiso.
- [ ] Corregir el nodo `context/…/onboarding`: dice que G3 (`OnboardingV2`) no tiene consumidores, y el
      wizard en `main` ya le pega a `api/v2/onboarding/otp-auth/validate`.

## Objetivo

Que el checkout de una tienda entre al wizard nuevo **sin depender de cookie ni de sesión**: el front recibe
el contrato en base64, crea el `ecommerce_request` y en cada paso rehidrata desde los endpoints de contexto
del backend. Al cerrarse el crédito, el comercio recibe el veredicto de su pedido. Y que sea **el canal**
—no la sesión que haya abierta en el navegador— el que decida si el proceso se le entrega al cliente.

El motivo técnico del «sin cookie»: el SSR del wizard cruza hosts y ambientes y la cookie se perdía; además
el handoff a celular exige que el contexto sobreviva un cambio de dispositivo, y una copia en cookie no lo
hace. El canal en sí no se re-explica acá — está en el nodo **ecommerce**.

## Dónde se toca

**`legacy-backend`** — los endpoints de contexto (#795, en `main` desde junio), la sala de espera (#1392) y
el canal como valor con nombre (#1402 · #1409):

- `Modules/Onboarding/App/Http/Controllers/EcommerceRequestController.php` · `App/Services/EcommerceRequestService.php` · `App/Http/Requests/FetchEcommerceRequestByUserRequestRequest.php` · `routes/api.php`
- `Modules/Onboarding/App/Services/UserRequestService.php` — donde se decide si el proceso se entrega
- `Modules/Onboarding/App/Services/lenders/OnboardingOrigin.php` · `lenders/LenderTabBehaviorResolver.php`, con `Modules/Onboarding/tests/Unit/LenderTabBehaviorResolverTest.php`
- `Modules/Loans/routes/api.php` — `ecommerce-status`, **en el grupo `device`**: colgada del grupo padre responde 403 a todo comprador de escritorio, que es exactamente quien compra en una tienda

**`frontend-monorepo`** — la entrada y la cuota inicial. ⚠ **Los cinco net-new existen en `qa` y NO en
`main`** (el revert los borró; los repone #1016):

- `apps/loan-request-wizard/app/routes/ecommerce/checkout.tsx` — la entrada `/ecommerce/{hash}/checkout`
- `apps/loan-request-wizard/app/server/services/ecommerce-context.server.ts` — el contexto sin cookie
- `apps/loan-request-wizard/app/routes/initial-fee-payment.tsx` + `app/server/services/initial-fee-payment.server.ts`
- `apps/loan-request-wizard/app/routes/down-payment-validation.tsx`

Y lo que se toca alrededor:

- `app/routes.ts` · `app/entry.client.tsx` · `app/utils/route-helpers.ts`
- `app/utils/backend-auth-headers.server.ts` — **por acá se cuela la sesión**: decide sólo por si hay usuario
  en la petición, sin mirar en qué árbol está la ruta
- `app/utils/security-headers.server.ts` — de esto depende que el `Referer` siga trayendo el `erId`
- `app/routes/lenders-marketplace/available-lenders.tsx` · `app/routes/loan-approved.tsx` · `app/routes/bancolombia/no-preapproved.tsx`
- `app/routes/loan-application-form/{phone-number,loan-request-form,otp-verification}.tsx`
- `modules/loan-request-wizard/loan-application-form/src/components/{amount-form,phone-number-step-form,phone-number,init-loan-request}.tsx` · `components/forms/personal-info-form.tsx` · `lib/application/verify-phone-otp.uc.ts`
- `modules/loan-request-wizard/loan-application-form/src/lib/infrastructure/phone-otp.repository.ts` y su gemelo
  `phone-otp-legacy.repository.ts` — **el camino v1 es por donde van los 7 comercios medidos en `qa`**
- `modules/loan-request-wizard/lenders-marketplace/src/lib/utils/never-rejects.ts` — la guarda de frontera del listado (#1027)

**`legacy-application`** (el monolito viejo) — `app/Http/Controllers/Customer/WoocommerceController.php` y
`app/Services/NewFrontendUrlService.php`: la pantalla vieja de checkout redirige al wizard **reenviando el
query string verbatim** (#169, en su `develop`). Re-encodearlo corrompe el base64 sin dar error.

## Cómo se ataca

La vía de entrega es **`qa → main`**, y después el resto de las ramas se pone al día **desde `main`**. Un
merge a `develop` ya no dice nada sobre lo entregado.

1. **QA valida los tres canales en `qa`.** Es lo único que falta para decidir; el código ya está desplegado.
2. **#1016 a `main`** — repone la entrada del checkout y la bienvenida, con el arreglo del rebote y el port
   de #1018. Va **antes** de la promoción: promover primero deja `main` con rutas apuntando a archivos que
   no existen.
3. **Promoción `qa` → `main`**, que se lleva todo lo demás sin PRs extra.
4. **Recién entonces, el redirect del monolito a producción** y el refresh de las otras ramas desde `main`
   —con la cola de junio rescatada antes, o se pierde.

## Lo que se evaluó y NO se eligió

**Abril: el contexto en una cookie** (`legacy-backend#503` + `frontend-monorepo#363`, los dos cerrados sin
merge el 14/9). `checkout-redirection.tsx` guardaba todo en `session.set("ecommerce_session", …)` y las
pantallas leían la copia. No se descartó por estilo: la cookie es justo lo que se perdía cruzando hosts, y
con el handoff a celular el segundo dispositivo llegaría sin monto ni prefill. De esos dos PRs se rescató la
sala de espera; el resto hay que revisarlo archivo por archivo contra `main` antes de tocarlo.

**Dos PRs por concern (entrada / cuota inicial).** Se armó así y **Miguel lo descartó el 14/9**: quería un PR
por repo. Se consolidó en #997 y se cerró el #998. El argumento del split queda anotado como riesgo asumido:
revertir un fallo del checkout en producción se lleva puesta la cuota inicial.

**Que autogestión con asesor también continúe en el lugar.** Evaluado y descartado por alcance, con el motivo
escrito en el docblock de `LenderTabBehaviorResolver::continuesInPlace`: de 39 comercios con el flag, sólo dos
tienen volumen en `rt=2` en 90 días, y a My Tech (305) le cambiaría el 100 % de sus solicitudes. Es otra tarea.

**Copiar el código de #663** (que el handoff se pinte distinto por flujo). Traía una URL de demo quemada y `qa`
ya usa el `qrUrl` real: vale la intención, no el código.

**Que el flujo corra dentro de la página del comercio.** Es el frente «SDK del comercio» dentro de
`playground.md` hasta que tenga Jira: son dos horizontes distintos — ésta migra el canal que ya existe,
aquél explora una capa nueva.

## Lo que NO entra

- **La PANTALLA de la sala de espera.** El backend se rescató (#1392: `ecommerce-status` en el grupo
  `device`); el `ecommerce-continue.tsx` montado en `waiting-room` que traía #363 **no** entra en esta tarea.
- **El SDK del comercio** — frente general en `playground.md` hasta que tenga Jira.
- **El flujo de Corbeta / Bancolombia retail**, que ya tiene su propio camino desde febrero y es el tráfico
  que mejor convierte. Ni el redirect ni el cutover lo tocan.
- **Cambiar el recorrido del asesor**: sigue entregándole el proceso al cliente igual que siempre.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

*(Verificado el 2026-09-17 contra `qa`.)*

⚠ **Antes que nada, la trampa que hizo fallar dos días de pruebas:** el wizard sirve los tres canales desde
el **mismo dominio**, así que las cookies de una sesión de asesor viajan también en `/ecommerce/*` y el
backend deja de ver un comprador anónimo. Se prueba **en incógnito o con logout previo**. Una solicitud con
`corporate_user_id` distinto de NULL no es una compra de tienda, aunque se haya entrado por la tienda.

**El desenlace se lee en la base, no en la consola.** Las dos mitades del mismo booleano:

    SELECT ur.id, ur.user_request_status_id, ur.corporate_user_id,
           (SELECT COUNT(*) FROM twilio_logs t
             WHERE t.user_request_id = ur.id AND t.method = 'sendSelfManagement') AS whatsapp
      FROM user_requests ur WHERE ur.id IN (…);

Sin asesor: `corporate_user_id` NULL y **cero** filas de WhatsApp. Con asesor: el id del asesor y **una**.

**Los tres canales, por consola:**

    E2E_TARGET=qa node dev/caminar-wizard.ts --casos '#13874eb6:77' --flow ecommerce     --cerrar --manual
    E2E_TARGET=qa node dev/caminar-wizard.ts --casos '#13874eb6:77' --flow self-service  --cerrar --manual
    E2E_TARGET=qa node dev/caminar-wizard.ts --casos '#13874eb6:77' --flow merchant      --cerrar --manual

⚠ El canal del asesor pide sesión de Cognito viva: se renueva por consola con
`E2E_TARGET=qa npx playwright test dev/warm-session.spec.ts --headed --project=chromium` (**headed**
obligatorio, F-66; el caminador no la renueva solo, sólo lee el cache).

**El contrato de la tienda, sin navegador** — 8 comprobaciones, de armar el base64 al vínculo con el pedido:

    E2E_TARGET=qa CFE_TARGET=qa make harness-ecommerce TEL=3112345678

⚠ `TEL=` no es opcional contra `qa`: el OTP sólo es predecible si el teléfono está en `qa_otp_bypass_phones`.
Con un teléfono al azar la corrida muere en `otp-validate` con **200 sin `user_request_id`**, que se lee como
un fallo del canal siendo de la herramienta.

**Los comercios que sirven, y los que no:**

| comercio | qué prueba |
|---|---|
| **Amoblando Pullman** (94) · CrediPullman (77, `rt=2`) | el caso completo: cierra en plataforma y el comercio tiene `initial_fee` prendido |
| **Creditop** (`bb534d6a`) · Creditop X (37) | **el par que discrimina**: los dos flags apagados, así que sólo cambia el canal |
| Tienda Fisio · CrediFis X · Alpeluche · Compubit | el barrido en paralelo, cinco entidades en plataforma distintas |
| ❌ **Amoblar** (38) | no tiene ninguna entidad en plataforma: nunca hay a dónde continuar |
| ❌ Amoblando Pullman **con Credifamilia** (24) | el par no está marcado: ir a `/continue` ahí es lo correcto |

⚠ **Y correr el canal que no es da verde igualmente:** ecommerce es **inmune** al rebote de la cuota inicial
(#997 fuerza `initialFeeAllowed = false`), así que el caminado del 14/9 pasó en verde sobre el bug que
provocó el revert. El canal que rompe es el del asesor con cuota inicial > 0 (`CUOTA=` en el caminador).

**Sondas de URL, sin escribir nada** (contra `originaciones-qa.dev.creditop.com`):

| ruta | lo correcto |
|---|---|
| `/merchant/…/initial-fee-payment` | **302 → login** *(cayó en el árbol del asesor; con el código viejo, 302 → `/`)* |
| `/ecommerce/…/continue` · `/self-service/…/continue` | **200** *(con el viejo, 404)* |
| `/merchant/…/ruta-que-no-existe` | **404** ← el control: una ruta que no existe en NINGÚN árbol sí da 404 |

### Cuando una corrida falla y no dice por qué: las TRES fuentes, y qué aporta cada una

Medido el 16/9 y vale como método, no como anécdota: el listado devolvía 500 en `qa` y **el backend no
dejó rastro** —111 líneas en Loki para esa solicitud y un solo error, el `ONB002` inofensivo—, el
navegador sólo decía «Error al obtener las opciones de financiamiento», y el mensaje real
(`Table 'creditop.cards' doesn't exist`) apareció **pegándole al endpoint**. Ninguna de las tres sobra.

| fuente | con qué | qué contesta | la trampa |
|---|---|---|---|
| **el forense de la solicitud** | `make harness-loki UREQ=<id> TARGET=qa` | qué hizo el backend con ESA solicitud, paso por paso | ⚠ el target **por defecto es `local`**: sin `TARGET` contesta «cero anclas» con los logs ahí mismo, o peor, te muestra la corrida de otro con el mismo id (**F-234**). Y en este stack **no hay valor `qa`** en la etiqueta `environment`, así que no se puede desempatar qué backend respondió |
| **lo que vio el cliente** | el caminador ya consulta PostHog cuando un caso sale mal; `FORENSE=1` lo fuerza aunque cierre bien. Para una solicitud suelta, `make trazador-posthog UREQ=<id>` | en qué PANTALLA se rompió y con qué error del loader | es lo único que ve el front: acá apareció `available-lenders.tsx loader GET …/lenders-v2/502391 returned 500` cuando Loki no tenía nada |
| **el mensaje crudo** | `I_KNOW_THIS_TOUCHES_SHARED_DEV=1 E2E_TARGET=qa node dev/listado.ts --branch <hash> --v2` | el error exacto del endpoint, sin la capa del front encima | escribe contra la base compartida, así que pide el permiso a mano (F-53) |

**Y para decidir, no para depurar: `make trazador-sql`, sólo lectura.** Es con lo que se midió el riesgo en
producción **antes** de cambiar una conducta —los 90 días de entidades `rt` 2/3/4 que dieron 0 comercios y 0
solicitudes en el caso que cambia, los 170 eventos de cuota inicial repartidos 170 del asesor y 0 de
ecommerce, los 14.160 checkouts del monolito—. ⚠ **Un cero no prueba nada sin la población de al lado**: la
misma consulta tiene que mostrar los casos vecinos, o no se distingue «no pasa» de «no supe buscar».

## Referencias

- **Nodos de contexto:** `ecommerce` (el canal: contrato base64, credencial, `/vtex/*`, «volver al comercio»)
  · `onboarding` (el formulario que se hidrata sin cookie) · `payments` (cuota inicial y
  `down-payment-validation`) · `architecture` (la costura `application → legacy-backend + frontend`).
- **Frentes vecinos:** «SDK del comercio» en `playground.md` — el flujo dentro de la tienda y el
  conocimiento del prefill del comercio.
- **Hallazgos que salieron de acá:** F-214, F-215, F-216 (14/9) · F-221 (17/9) · F-223 (17/9).
- **Los PRs y sus ambientes no se listan acá: los mide la consola Ramas** (`make tareas-ramas N=6`). Lo único
  que esa medición **no** puede saber está arriba, en Riesgos: el revert dejó a #997 y #1005 como ancestros
  de `main` sin su contenido.
- PRs de origen, de junio: [legacy-backend #795](https://github.com/Creditop-SAS/legacy-backend/pull/795)
  (en `main`) · [frontend-monorepo #551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551) (nunca
  llegó a `main`).
## Tarea (publicable)

## En una línea
Una compra que arranca desde la tienda del comercio entra al flujo de crédito nuevo llevando consigo lo
que el comercio ya sabe del comprador, y al cerrarse le devuelve el veredicto a la tienda.

## Por qué
Hoy ese recorrido corre por la plataforma vieja y **convierte al 1,9 %**, contra el 18,7 % del mundo
nuevo. Son 14.160 compras en seis meses entrando por la puerta que peor funciona. El motivo técnico del
rediseño es que el estado del pedido viajaba en una cookie del navegador, y esa cookie se perdía al
cruzar de dominio o al pasar a otro dispositivo: el comprador llegaba al formulario sin monto y sin
datos. Ahora la llave viaja en la dirección y cada pantalla vuelve a preguntar por el pedido.

## Qué cambia
El comprador que viene de una tienda ve el **monto ya puesto y bloqueado** —lo fija el carrito, no se
escribe— y, en el formulario de datos personales, **los campos que el comercio ya entregó llegan llenos
y bloqueados**: sólo se piden los que faltan. Se bloquean únicamente los que traen un dato de verdad: si
el comercio manda un campo vacío, queda editable. Cuando la entidad elegida exige cuota inicial, el
cobro se hace por pasarela antes de continuar. Y al terminar, el comercio recibe el resultado de la
compra y el comprador tiene el botón para volver a la tienda.

Y se corrige lo que hacía fallar el cierre: al elegir una entidad que resuelve **dentro de la
plataforma**, el flujo **sigue en la misma pantalla** en vez de mostrar «continuá desde tu celular».
Ese mensaje no tenía sentido para quien compra desde la tienda —ya está frente a la pantalla, y no se
le envió ningún mensaje—, pero aparecía igual. Ahora lo decide **de dónde viene la solicitud**: con
asesor el proceso se le entrega al cliente, que es lo correcto; sin asesor —desde la tienda o entrando
solo— continúa en el lugar. Antes lo decidía si había una sesión abierta en el navegador, y por eso una
compra de tienda se comportaba como una venta de mostrador cuando alguien del comercio tenía su panel
abierto en otra pestaña.

## Alcance
**El recorrido del asesor no cambia**: sigue entregándole el proceso al cliente igual que siempre. Lo
que sí cambia es que un comercio **no marcado como autogestionado** ahora también deja continuar en el
lugar a quien entra solo; medido contra producción, ese caso ocurrió **cero veces en 90 días**, así que
no afecta a nadie hoy. **No** enciende todavía la nueva
entrada para los comercios que ya están operando: eso es un cambio de infraestructura aparte, que además
debe excluir a los comercios de Corbeta, que ya tienen su propio recorrido y son los que hoy mejor
convierten. La pantalla de espera del veredicto queda disponible en el servidor, pero su pantalla en el
navegador no entra en esta tarea.

## Dónde probar
Ambiente **QA**. Comercio con tienda configurada y con una entidad que resuelva dentro de la
plataforma — sirve **Amoblando Pullman**. No hace falta usuario de asesor: el comprador entra sin
sesión, desde la tienda. ⚠ Y para el caso del asesor hace falta uno **asignado a ese mismo comercio**.

## Cómo validar

⚠ **Antes que nada: abrí una ventana de incógnito, o cerrá sesión.** Si el navegador tiene abierta una
sesión de asesor, el flujo se comporta como el de mostrador aunque entres por la tienda — el wizard
sirve los tres canales desde el mismo dominio y la sesión viaja igual. Es lo que hizo fallar las
pruebas anteriores.

**A · La compra desde la tienda (sin sesión)**
1. Iniciar una compra desde la tienda y elegir pagar con crédito. Debe abrirse el formulario con el
   **monto del carrito ya puesto y bloqueado**.
2. Continuar hasta el código de verificación por celular y validarlo.
3. En datos personales, comprobar que **los campos que el comercio envió están llenos y no se pueden
   editar**, y que los que el comercio no envió sí se pueden escribir.
4. Elegir una entidad. Si es una entidad **en plataforma**, el flujo debe seguir **en la misma
   pantalla**, en la de confirmación — **no** debe aparecer la pantalla que dice «continuá desde tu
   celular» o «te enviamos un link por WhatsApp». Eso es lo que se arregló.
5. Si pide cuota inicial, completar el pago.
6. Al cerrar, comprobar que **la tienda recibe el resultado** y que aparece el botón para volver a ella.

**B · El mismo comercio, entrando solo (sin sesión y sin pasar por la tienda)**
Mismo resultado que A en el paso 4: sigue en la pantalla de confirmación.

**C · El mismo comercio, con asesor**
Acá **sí** tiene que aparecer la pantalla de entrega: el proceso pasa del asesor al cliente, y eso es
lo correcto. Si en este caso ves la confirmación, ESO es el error.

⚠ Si en el primer paso se responde **«Sí»** a «¿el cliente tiene cupo disponible…?», el listado puede
salir vacío: ese flujo muestra sólo entidades sin integración directa, y no todos los comercios tienen.
Para recorrer el flujo completo, responder **«No»**.

## Criterios de aceptación
- El monto del formulario coincide con el total del carrito y no se puede modificar.
- Los datos que el comercio envió aparecen llenos y bloqueados; los que no envió, editables.
- Si el navegador pierde su sesión a mitad del recorrido, el flujo continúa igual.
- Al cerrarse el crédito, la tienda recibe la notificación del resultado.
- El recorrido de mostrador y el del asesor siguen funcionando igual que antes.

## Dependencias / contraparte
- **Infraestructura**: para que los comercios que ya operan usen la entrada nueva hace falta una
  redirección desde el dominio actual, **excluyendo los comercios de Corbeta**. Sin eso, esto sólo
  aplica a comercios que se configuren de cero.
- **Producto**: falta confirmar en qué momento se cobra la cuota inicial cuando el comprador continúa
  solo desde su celular.
- **Promoción a producción**: el cambio está en QA; hasta que se promueva no aplica a clientes.
