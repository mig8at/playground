---
id: 6
title: "Ecommerce web stateless"
stage: work
created: "2026-07-21T10:30:30-05:00"
context_nodes: [ecommerce, onboarding, payments, architecture]
jira: [CORE-30]
cuadrilla: ecommerce/miguel
jira_title: "Ecommerce: flujo de onboarding hasta el listado de entidades, webhook y retorno al comercio"
ramas: flujo-por-origen, autogestion-sin-entrega-al-propio-cliente, ecommerce-cuota-inicial-boton-muerto, cuota-inicial-rebote-asesor-qa, restore/ecommerce-checkout-y-rebote, ecommerce-stateless-checkout, ecommerce-bienvenida-campos-y-cuota-inicial, sala-de-espera-ecommerce, ecommerce-boton-volver-al-comercio, ecommerce-checkout-al-wizard, preapprovals-promesa-rechazada, fix/listado-tramo-por-monto
---

# Ecommerce web stateless (→ wizard sin cookie)

## Si retomás esto sin contexto, empezá acá

**Qué se busca:** que una compra iniciada en la tienda entre al wizard nuevo **sin cookie** —la llave del
pedido viaja en la URL y cada pantalla la relee en su fuente— y que al cerrarse, el comercio reciba el
veredicto de su pedido.

**Estado real (21/9):** todo el trabajo vive en `qa` y está desplegado. En `main` **no hay nada del front**:
entró el 14/9 con la promoción `Qa (#1007)` y Abel lo revirtió esa misma noche (#1013); el backend #1392 no
se revirtió y sí quedó. Reponerlo es **#1016**, el único PR abierto, y tiene que entrar **antes** de la
próxima promoción `qa`→`main`.

**Y hay un segundo PR abierto: #1441** (rama `fix/listado-tramo-por-monto` de `legacy-backend`), que
lleva **dos** cosas — las dos sobre lo que la tarjeta le PROMETE al cliente:

1. **El plazo.** #1432 cerró la capa de la CATEGORÍA; ésta cierra la del TRAMO POR MONTO, viva en
   producción con Motai X: 89 de 227 solicitudes (39 %) en 90 días discrepando, y 31 créditos a un
   plazo que la entidad no declara.
2. **El monto de la tienda, que ya no se edita** (21/9). Lo decide el CANAL y no la configuración de
   cada sucursal, porque la compra ya existe cuando el comprador llega a la pantalla.

Va contra `qa`, como todo lo demás, y no espera nada más para que lo revisen.

**Ya comprobado, corriéndolo contra `qa`** (no hace falta volver a investigarlo): los tres canales cierran, y
el discriminante quedó medido **en la base** — mismo comercio, misma entidad, mismo desenlace, y el WhatsApp
de entrega aparece **sólo** con asesor. Lo que no cerró en esos barridos es del ambiente (F-180) o de
configuración del comercio (F-223), no del canal.

**Y el ticket de «las cuotas del listado no coinciden con el plan de pagos» está CERRADO en `qa`** — no lo
vuelvas a investigar. Verificado el 19/9 pidiéndole a `qa` los dos endpoints de la solicitud 502446: los dos
dicen `[1, 3, 6]`. Lo que sigue abierto de ese hilo es otra cosa y está arriba: el tramo por monto.

⚠ **Y antes de colgar CUALQUIER conducta del `is_ecommerce` del listado v2: está MUERTO.** Llega por
query string y el front no lo manda —lo resuelve bien y lo pierde al armar la URL—, así que el servicio
contesta `isEcommerce: false` sobre una compra de tienda; medido el 21/9 con la uReq 466863. La fuente
que sí contesta es `EcommerceRequest::existsForUserRequest()`. Tiene dos consumidores más sin revisar,
en Pendientes.

**Cómo se verifica:** las corridas de §«Cómo se comprueba», leyendo el desenlace en la base y no en la consola.

**El próximo paso es:** que QA recorra los tres canales en `qa` siguiendo «Cómo validar» de la tarea
publicable, **sin sesión de asesor** — ventana de incógnito o logout previo. En paralelo, y sin depender de
eso: que revisen **#1441**, que ya lleva sus dos cosas.

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

- [ ] **Averiguar con infra QUÉ backend y QUÉ base usa `originaciones-qa`** — no es ninguno de los
      alcanzables por VPN: la solicitud 502621, que el front renderiza, no existe en `inertia-dev` ni
      la conoce ningún backend de los cuatro. Hasta saberlo no se puede decir si #1441 le llegó.
      Depende de: infra.
- [ ] **Corregir `harness/.env.qa`: su `E2E_DB_HOST` apunta a `inertia-dev` y eso ya no es la base de
      `qa`.** Por eso la corrida del arnés contra `qa` muere en el OTP. Y sumar al arnés el chequeo que
      lo habría cazado: crear un id y preguntarle al backend si lo conoce.
- [ ] ~~**Forzar el redespliegue de `legacy-backend-qa` — el BACKEND, no el front.**~~ *(descartado:
      el razonamiento se apoyaba en comparar dos backends distintos.)* Redesplegar el front
      el 21/9 a las 19:5x no cambió nada, y el front no cachea (tres peticiones, tres respuestas
      distintas). Sirve una imagen anterior a #1441. Medido el
      21/9: el mismo endpoint devuelve `lock_amount = true` pidiéndoselo directo y `false` cuando lo
      pide el front, con el recorte de categoría de #1432 presente en las dos respuestas — o sea una
      imagen de entre el 18/9 y el 21/9 13:48. Los dos workflows de despliegue salieron ✔. Termina
      cuando `originaciones-qa` muestre el campo del monto bloqueado en una compra de tienda.
      Depende de: infra — no hay acceso a ECS desde acá.

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

## Lo que está decidido

> **DECISIÓN · 2026-09-14 · Miguel** — un PR por REPO, no por concern. Se consolidó #998 dentro de #997.

> **DECISIÓN · 2026-09-15 · Miguel** — #1016 se mergea **cuando QA dé el visto bueno en `qa`**, no antes.
> Es la única forma de volver a meter el código después del revert, así que conviene que entre ya validado;
> y no hay apuro por riesgo, porque `main` hoy no tiene la funcionalidad ni, por lo tanto, el defecto.

> **DECISIÓN · 2026-09-16 · Miguel** — `opensNewTab` queda **congelado**. Arreglar el dato del canal
> destapaba un cambio de conducta en producción (Welli 19 sucursales, Medicredit 18, Wompi 11, Su+pay 4,
> Addi 1 pasarían de modal a pestaña nueva), así que el método vuelve a su firma original y se suma una
> prueba que **fija** el congelamiento. El blast radius del PR queda en uno.

> **DECISIÓN · 2026-09-16** — la regla del canal queda en **«entrega SÓLO el mostrador»**: con asesor el
> proceso se entrega, sin asesor —tienda o autogestión— continúa en el lugar. El riesgo se midió antes en
> prod, 90 días y entidades `rt` 2/3/4: autogestión sobre un comercio sin ninguna marca son **0 comercios
> y 0 solicitudes**, o sea que el caso que cambia no le pasa hoy a nadie.

> **DECISIÓN · 2026-09-17** — `develop` sale de la vía de entrega. La entrega es `qa → main` y después el
> resto de las ramas se pone al día desde `main`.

## Lo que está bloqueado

> **PREGUNTA · 2026-09-15 · QA (Joel)** — ¿los tres canales pasan en `qa`? Es lo único que falta para
> mergear #1016 y promover. El guion está en «Cómo validar», y lo esencial es hacerlo **sin sesión de
> asesor**: el wizard sirve los tres canales desde el mismo dominio y una sesión abierta hace que la compra
> se comporte como mostrador. Eso fue lo que hizo fallar las pruebas del 15 y el 16.

> **PREGUNTA · 2026-09-14 · producto** — ¿en qué momento se cobra la cuota inicial cuando el comprador
> continúa solo? Hoy quedó después de gestión manual y autogestión —ahí el comprador ya no está en la
> pantalla— y antes del resto, y después de la analítica para no perder `lender_selection_result`.

## Riesgos

> **RIESGO · 2026-09-15** — **el revert es pegajoso.** `6fa13ae5` (#997) y `f443ecad` (#1005) siguen siendo
> ancestros de `main` aunque su contenido no esté, así que ninguna promoción los devuelve y
> `make tareas-ramas` va a seguir diciendo «en main, qa» para esas dos ramas. El desempate es el CONTENIDO,
> no el SHA: `git ls-tree -r --name-only origin/main -- …/ecommerce/checkout.tsx` → vacío.

> **RIESGO · 2026-09-17** — poner las ramas al día **desde `main`** destruye lo que sólo vive fuera de
> `main`, así que rescatar lo que falte es prerrequisito del refresh y no una limpieza posterior.
> ⚠ **La lista de qué falta era vieja.** Re-medida el **2026-09-18** contra `origin/qa`: de los cinco
> arreglos de junio que #997 no se llevó, **#665 y #661 ya volvieron** —los repuso #1015— y #600 se rehizo
> dentro de #997; queda #582 por mirar y #663 descartado a propósito. El riesgo del refresh sigue; la lista
> es más corta de lo que este archivo venía diciendo desde el 15/9.
> **Cómo se vuelve a comprobar:** `git grep -c standBy origin/qa -- apps/loan-request-wizard modules/loan-request-wizard`
> (hoy da 4, no 0) y `git show origin/qa:apps/loan-request-wizard/app/routes.ts | grep sharedFlowRoutes`.

> **RIESGO · 2026-09-15** — el backend #1392 quedó **solo en `main`**, sin el front que lo usa. Es la misma
> forma del par de junio —backend adelante, front atrás— repetida tres meses después.

> **RIESGO · 2026-09-16** — el despliegue de `qa` **no corre migraciones** (`main-qa.yaml` sólo invoca el
> deploy de ECS). Ya pasó una vez: la tabla `cards` de #1388 no existía y el listado daba 500 para todo el
> equipo. Va a volver a pasar con la próxima migración de cualquiera, y esa puede no ser aditiva.

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

## Registro

### 2026-09-21 (11) · la base de `qa` NO está atrasada: lo distingue `false` contra `null`

Hipótesis de Miguel: que la base de `qa` estuviera vieja —sin la migración de `lock_amount`— y por eso
el candado funcione en local y no allá. **Se descarta, y con un solo bit.**

El front mapea así (`loan-options.repository.ts:87`):

    lock_amount: alliedBranch?.lock_amount ?? null

Entonces hay tres desenlaces posibles, y cada uno dice una cosa distinta:

| lo que llega del backend | lo que ve el front | qué significa |
|---|---|---|
| la clave **no viene** (columna ausente) | `null` | la base estaría atrasada |
| `alliedBranch` viene vacío (`''`) | `null` | la solicitud no resolvió sucursal |
| la columna existe y vale 0 | **`false`** | la base está bien; el código no la pisó |

Medido en `qa` con la solicitud nueva 502621: **`lock_amount: false`, `typeof "boolean"`,
`=== null` → falso**. O sea el tercer caso.

⇒ **La columna existe en la base de `qa` y llegó en 0.** Si el backend tuviera #1441, la habría
pisado a `true` por ser una compra de tienda. No lo hizo. **Lo que falta es el código, no el dato.**

*(Refuerzo: `amountLabel` también sale de `alliedBranch`, y llegó resuelto — así que `alliedBranch` es
un objeto de verdad, no la cadena vacía.)*

⚠ Esto **no** contradice la entrada (10): sigue siendo cierto que el backend que atiende al front no
es ninguno de los alcanzables por VPN, y que su base no es `inertia-dev`. Lo que esta entrada agrega
es que **esa base sí tiene la migración** — así que cuando infra diga qué servicio es, lo único que
hay que hacer ahí es desplegarle #1441.


### 2026-09-21 (10) · CORRECCIÓN: `qa` no usa la base que creíamos, y por eso todo lo medido apuntaba mal

⛔ **La entrada (6) decía que el servicio `legacy-backend-qa` servía una imagen vieja. Es FALSO, y el
método que lo produjo también: todo lo que medí «directo contra el backend de qa» fue contra un
backend que el front NO usa.**

**Lo que lo destapó:** Miguel creó una solicitud nueva en `qa` —**502621**, monto 2.000.000— y el
front la renderiza con sus dos entidades (CrediPullman 77 y Cierre X 201). Pero:

    SELECT MAX(id) FROM user_requests   →  502619     (base `inertia-dev`, la que dice `.env.qa`)
    502621                              →  NO EXISTE

Y ninguno de los cuatro backends alcanzables por VPN la conoce:

| host | ¿conoce 502621? |
|---|---|
| `legacy-backend-qa` | no |
| `legacy-backend` | no |
| `legacy-backend-lab` | no |
| `legacy-backend-stg` | no |

⇒ **El front de `originaciones-qa` habla con un backend que tiene OTRA base de datos**, y no es
ninguno de los que se alcanzan desde acá con esos nombres. La hipótesis más probable es que
`legacy-backend-qa.inertia-develop` **resuelva distinto desde adentro del cluster que por la VPN**:
el mismo nombre, dos servicios.

**Qué se cae de lo dicho antes, y qué se sostiene:**

- ⛔ Se cae «el servicio sirve una imagen anterior a #1441». Nunca hubo evidencia de eso: la
  comparación era entre dos backends distintos.
- ⛔ Se cae el razonamiento del `1,3,6` como discriminador. Producía `qa`… pero de la OTRA instancia,
  que también corre código de `qa` sobre otra base.
- ✔ Se sostiene que **el código funciona**: probado en local de punta a punta, tienda `readOnly: true`
  contra autogestión `readOnly: false` en la misma sucursal.
- ✔ Se sostiene que **el front de `qa` recibe `lock_amount: false`**, o sea que el backend que sí usa
  no tiene #1441.

⚠ **Y hay un daño colateral que hay que arreglar: `harness/.env.qa` miente.** Declara
`E2E_DB_HOST=inertia-dev…` con el comentario «BD/API_KEY son COPIA de dev (comparten base)». Hoy eso
es falso, y por eso la corrida del arnés contra `qa` de las 20:38Z murió en el OTP: sembraba y
buscaba en la base equivocada. Es el mismo error que el archivo ya cuenta de sí mismo —«hasta el
2026-08-19 `.env.staging` apuntaba a qa y medía la rama equivocada»— repetido un nivel más abajo, en
la base.

⚠ **La lección, y es la misma de siempre en este repo: un nombre de host no es una identidad.** Lo
que hace falta para no repetirlo es lo que el `CLAUDE.md` del arnés ya recomienda para la RAMA
—pedir un campo que sólo exista en una— extendido a la BASE: **preguntarle al backend por un id que
acabás de crear**. Si no lo conoce, no es el tuyo. Cuesta una consulta y habría ahorrado la tarde.


### 2026-09-21 (9) · EL CÓDIGO FUNCIONA: probado en local de punta a punta. Lo que falla es `qa`

Con #1441 en `qa` y #1039 mergeado, el monto seguía editable en `qa`. Para separar «código» de
«ambiente» se probó **en local**, con el mismo comercio y la misma sucursal, cambiando **sólo el
canal**:

| canal | uReq | `#amount-input` | importes |
|---|---|---|---|
| **tienda** (atada a un pedido) | 466883 | **`readOnly: true`** — bloqueado | $1.500.000 · $148.623 |
| **autogestión** (misma sucursal) | 466884 | `readOnly: false` — editable | — |

Eso es la pantalla, no la API: el candado llega hasta el input. **El código está bien.**

**Y en `qa`, a la misma hora, la misma pantalla:** `lock_amount: false`, `readOnly: false`, importes
en `-`. Medido a las 20:32:45Z y otra vez a las 20:35:04Z, esta última **justo después** de que
terminara el despliegue del front de #1039 (20:34:20Z).

**Lo que ya se descartó, cada uno con su medición** (ver las entradas del 21/9 (4) y (6)):

- el código — **local lo prueba**;
- el dato — la sucursal tiene la columna en 0, que es el caso que el canal debe cerrar;
- el front — su build de `qa` apunta a `legacy-backend-qa`, su mapeo es directo y no toca
  `fee_numbers`;
- su caché — tres peticiones dan tres respuestas distintas, y una solicitud nunca cargada da igual;
- un rollout parcial en el camino que yo alcanzo — 10 de 10 peticiones dan `true`, y el host resuelve
  a **una sola IP**;
- que sea otro backend — el front recibe `1,3,6`, que **sólo** produce `qa` (`develop` y `lab`
  devuelven `1,3,6,12`).

⚠ **Queda un solo hueco, y es el que hay que mirar desde ECS:** el mismo endpoint, el mismo host y la
misma solicitud contestan `true` cuando pregunto yo y `false` cuando pregunta el front. Con la imagen
correcta ya construida (`4f1852d`) y tres despliegues en verde —13:48Z, 19:33Z y el tuyo de 19:48Z—,
la explicación que queda es que **el servicio tiene más de una tarea y no todas rotaron**, o que el
proceso del front sostiene una conexión viva contra una tarea vieja.

**Lo que lo resuelve de una:** en el servicio `legacy-backend-qa` del cluster `inertia-develop`,
**Deployments** (cuántas tareas hay, cuántas en la revisión nueva) y **Events** (por qué no rotó la
que falta). Y la mejora durable sigue siendo la misma: `wait-for-service-stability: true` en
`config-ci`, para que un despliegue que no rota salga en rojo y no en verde.


### 2026-09-21 (8) · el arreglo de los importes, y el orden de entrega

**PR `frontend-monorepo#1039`** contra `qa`, rama `fix/importes-de-la-tarjeta-en-ecommerce`
(`42be10f5`). Cuando el canal no ofrece el campo de cuota inicial, la efectiva pasa a ser el
**mínimo** — que es lo que la tarjeta ya prometía dos líneas más arriba. El canal del asesor no se
toca. La decisión vive en `resolveEffectiveInitialFee` (`lib/domain/services/initial-fee.service.ts`)
y no inline en el hook, porque es lo único de ahí que se puede probar solo.

**Comprobado:** build del wizard verde (la vara real en este repo), biome limpio, y la función
**ejecutada** contra sus cinco casos, los cinco en verde.

⚠ **Lo que NO se pudo comprobar, y hay que decirlo:** el render con el arreglo puesto sobre un caso
con mínimo. En local esa entidad llega con `initial_fee_percentage` en 0 —el usuario cayó en
«Segunda oportunidad», que declara 25 %, y aun así la tarjeta mostró el monto completo— así que el
caso no se reproduce ahí. Lo que sí está medido es que el estado al que lleva el cambio —cuota
inicial igual al mínimo— es exactamente el que en `qa` muestra $1.203.750 y $264.970.

⚠ **Y el runner de pruebas del módulo está roto en esta copia:** los **27** archivos fallan con
`__vite_ssr_exportName__ is not defined`, incluidos los 26 que este cambio no toca. No es del cambio;
es la copia. Por eso la función se ejecutó con `tsx` en vez de con `vitest`.

### El ORDEN de entrega, con lo de hoy adentro

1. ✅ **`legacy-backend#1441` — ya mergeado en `qa`** (21/9 13:43Z). Plazo por tramo + monto de la
   tienda bloqueado.
2. ⏳ **Que `legacy-backend-qa` de verdad sirva #1441.** Hoy sirve una imagen anterior; sin esto QA no
   puede validar el monto bloqueado. **Bloquea el paso 4.**
3. **`frontend-monorepo#1039` → `qa`.** Sin él la tarjeta sigue en `-` y QA no puede leer ni el plazo
   ni los importes. Va a `qa` y no a `main` porque es donde vive el defecto y donde se valida.
4. **QA recorre los tres canales en `qa`**, sin sesión de asesor.
5. **`frontend-monorepo#1016` → `main`.** Repone la entrada del checkout y la bienvenida tras el
   revert. ⚠ **Antes de la promoción**: promover primero deja `main` con rutas apuntando a archivos
   que no existen.
6. **Promoción `qa` → `main`** (la llevan Laura y Oscar). Se lleva #1441 y #1039 sin PRs extra.

⚠ **El único orden que no se puede alterar es 5 antes de 6.** Los demás son dependencias de
información, no de código: 3 puede entrar antes que 2 —son repos distintos— pero QA no debería
empezar hasta tener los dos.


### 2026-09-21 (7) · lo que vio Duncan: no es preaprobados, es un cabo suelto de #1018

**El síntoma reportado** —«al cambiar cuotas no cambia el valor a financiar ni la cuota»— está mal
diagnosticado, y la captura lo delata: los dos no están *desactualizados*, están en **`-`**. Nunca se
calcularon.

**Reproducido en `qa`** (Amoblando Pullman, uReq 502610, CrediPullman), moviendo el campo de cuota
inicial y leyendo la fila:

| cuota inicial | Valor a financiar | Cuota |
|---|---|---|
| vacía | `-` | `-` |
| 100.000 (bajo el mínimo) | `-` | `-` |
| **401.250 (el mínimo)** | **$1.203.750** | **$264.970** |

Y con importes a la vista, **el plazo SÍ recalcula**: 6 cuotas → $264.970, 3 cuotas → $515.541.
«Valor a financiar» no cambia con el plazo **a propósito**: es monto − cuota inicial.

**No es el servicio de preaprobados.** Los dos importes los calcula el front del lado del cliente:
aparecieron al tocar un input, sin una sola petición de red (verificado en el panel de red).

⚠ **Es NUESTRO, y es un cabo suelto de #1018** (`61436e2f`, 15/9). Ahí se decidió —bien— que el canal
de tienda **no pide la cuota inicial en el listado** y que el error bloqueante pasara a ser el aviso
«No olvides que en un paso posterior debes realizar el pago de $X». Pero la condición que apaga los
importes quedó sin tocar: `LenderCardSummaries.tsx:71`, `hasAmountToShow = validation.isValid &&
!showPlaceholder`, y esa validación sigue contando el mínimo no alcanzado. En ecommerce el campo **no
existe**, así que el mínimo **no se puede satisfacer nunca** y las dos filas quedan en `-` para
siempre. En el canal del asesor no se ve porque ahí el campo está y el cliente lo llena.

**El arreglo tiene precedente en el propio código:** `useInstallmentOptions.ts` ya resuelve un
`effectiveInitialFee` —cuando el campo está vacío cae al mínimo de la entidad— justo para que los
PLAZOS reflejen el financiamiento real. Los importes tienen que usar esa misma resolución. Es
coherente con lo que la tarjeta ya promete: el aviso dice que ese pago se hará después.

⚠ **Y la lección: al convertir un error bloqueante en aviso hay que seguir a TODOS los que leían esa
validación.** #1018 siguió tres (si el campo se renderiza, si el botón exige valor, qué dice el aviso)
y se le escapó el cuarto, que es el que pinta los números.


### 2026-09-21 (6) · por qué el despliegue de `qa` sale ✔ y sirve código viejo: no espera

Sigue en `false` a las **20:05Z**, después del redespliegue. Leyendo el pipeline apareció la causa, y
un PR de relleno **no** la arregla.

**Lo que el pipeline SÍ hace** (`main-qa.yaml` → `Creditop-SAS/config-ci/.github/workflows/deploy-ecs-service.yaml`):
la imagen se etiqueta con el **SHA corto** (`git rev-parse --short HEAD` → `4f1852d`, que es `qa` HEAD
y **contiene** el cambio), se sube a ECR, se renderiza una task definition nueva y se llama a
`aws-actions/amazon-ecs-deploy-task-definition` con `service` y `cluster`. O sea que cada merge ya
genera imagen nueva, revisión nueva y orden de actualización: **es exactamente lo que haría un PR de
relleno.** Por eso no vale la pena — ese camino ya corrió dos veces hoy (13:48Z y 19:33Z).

⛔ **Lo que NO hace, y es la causa: `wait-for-service-stability` no está puesto** (`deploy-task.yaml`,
el paso «Deploy to Amazon ECS» pasa sólo `task-definition`, `service` y `cluster`). El valor por
defecto es `false`, así que el workflow da ✔ **apenas ECS acepta la orden**, sin comprobar que la tarea
nueva arranque. Si no arranca —health check, capacidad, crash al iniciar— ECS deja la vieja sirviendo,
el despliegue queda IN_PROGRESS para siempre y **GitHub muestra verde**. Es lo que estamos viendo.

**Qué mirar, y es de una sola pantalla:** servicio `legacy-backend-qa` en el cluster `inertia-develop`
→ pestaña **Deployments** (si hay una PRIMARY en IN_PROGRESS con 0 running junto a una ACTIVE vieja) y
**Events** (dice por qué la tarea nueva no queda arriba). El tag esperado en la tarea corriendo es
`4f1852d`; el de #1441 solo era `63c931ac`.

**Y la mejora durable, que no es de esta tarea pero nace de acá:** poner
`wait-for-service-stability: true` en ese paso de `config-ci`. Sin eso, «desplegado» no significa nada
— es la misma clase que las herramientas que devuelven menos y se leen como «no hay».


### 2026-09-21 (5) · redesplegar el FRONT no arregla nada: el que está viejo es el backend

Miguel redesplegó el front y volvió a medirse a las **19:52Z**: el campo sigue editable
(`#amount-input` con `readOnly: false`) y el front sigue recibiendo `lock_amount: false`.

**Y no es caché.** Tres peticiones al `.data` de la misma pantalla dan **tres md5 distintos**, así que
el front recalcula cada vez: está hablando con un backend vivo, sólo que con código viejo.

**El barrido de backends alcanzables, misma solicitud (502610), 19:5xZ:**

| host | IP | `fee_numbers` | `lock_amount` |
|---|---|---|---|
| `legacy-backend-qa` | 172.32.66.42 | `1,3,6` | **`true`** |
| `legacy-backend-lab` | 172.32.74.217 | `1,3,6,12` | `false` |
| `legacy-backend` · `legacy-backend-stg` | — | no contestan JSON ahora | — |
| **lo que recibe el front** | — | **`1,3,6`** | **`false`** |

⚠ **Ningún backend alcanzable produce esa combinación.** `1,3,6` sólo lo genera `qa` (es el recorte
por categoría de #1432; lab y develop devuelven `1,3,6,12`), y `lock_amount: false` sólo lo genera
código anterior a #1441. O sea que la instancia que atiende al front corre **código de `qa` de entre
el 18/9 y el 21/9 13:48**, y `legacy-backend-qa` resuelve a **una sola IP** que sí tiene el cambio.

✔ **Y quedó descartado el último eslabón que estaba verificado sólo por grep:** el front **no** toca
`fee_numbers` — `lender-response.mapper.ts:229` pasa `credit_lines` verbatim y nada lo reescribe fuera
de los fixtures de prueba. Era el que sostenía todo el razonamiento, así que valía leerlo entero.

**Lo que hay que redesplegar es `legacy-backend-qa`, no el front.** Y como su workflow ya salió ✔ dos
veces (13:48Z y 19:33Z), conviene mirar en ECS si el servicio de verdad reemplazó su tarea —revisión de
la task definition, digest de la imagen en la tarea corriendo— o si quedó una vieja sirviendo.


### 2026-09-21 (4) · el monto SIGUE editable en qa, y no es del código: el backend que atiende al front está viejo

Miguel reportó que #1441 ya está mergeado y el monto se sigue pudiendo editar en `qa`. Es cierto, y la
causa **no** está en el código.

**Lo mergeado y desplegado, verificado:** #1441 mergeó a `qa` el 21/9 a las **13:43Z** y su workflow
«Deploy Legacy Backend to QA Env» salió ✔ a las **13:48Z**; después hubo otro despliegue de `qa` ✔ a
las **19:33Z**. Y el código llegó bien: `origin/qa` tiene `alliedBranchForResponse` y `locksAmountFor`
íntegros (`LenderListingService.php:370,722-735`).

**La contradicción, medida el 21/9 a las 19:3x Z — misma solicitud, mismo endpoint, mismo host:**

| quién pregunta | `credit_lines.fee_numbers` | `alliedBranch.lock_amount` |
|---|---|---|
| yo, directo a `legacy-backend-qa.inertia-develop` | `1,3,6` | **`true`** (10 de 10 intentos) |
| el front de `originaciones-qa` (su SSR) | `1,3,6` | **`false`** |
| `legacy-backend.inertia-develop` (rama `develop`, de control) | `1,3,6,12` | `false` |

Y en pantalla: `#amount-input` con `readOnly: false`, o sea editable.

**Por qué esto señala al despliegue y no al código.** Las dos entidades declaran `1,3,6,12`
(`credit_line_by_lenders`), así que el `1,3,6` que recibe el front **sólo lo produce `qa`** — es el
recorte por categoría de #1432, que no está en `develop`, `main` ni `staging` (verificado en las
cuatro ramas). O sea que el front sí habla con un backend de `qa`… pero uno **sin** #1441. Dicho de
otro modo: la instancia que atiende al front sirve una imagen de **entre el 18/9 (#1432) y el 21/9
13:48 (#1441)**.

**Lo que queda descartado, cada uno con su medición:**

- **No es el front.** Su build de `qa` apunta a ese mismo host (`.github/workflows/loans-qa.yaml:27`,
  `VITE_API_URL=http://legacy-backend-qa.inertia-develop`) y su mapeo es directo
  (`loan-options.repository.ts:87`, `alliedBranch?.lock_amount ?? null`). El mapper **no** recorta
  `fee_numbers` — sólo lo lee (`lender-response.mapper.ts:299`).
- **No es caché del front.** Una solicitud que esa pantalla nunca había cargado (502616, sucursal 2171)
  también da `false`, y el `.data` pedido con parámetro único trae `"1,3,6"` y nunca `"1,3,6,12"`.
- **No es un despliegue a medias en MI camino.** Diez peticiones seguidas al backend dieron `true` las
  diez.
- **No es el dato.** La sucursal 659 tiene `lock_amount = 0` en la base, que es justo el caso que el
  canal tiene que cerrar.

**Qué falta hacer:** forzar un despliegue nuevo del servicio `legacy-backend-qa` (o mirar si tiene más
de una tarea y si la definición se actualizó). No se puede confirmar desde acá: no hay acceso a ECS.

⚠ **Y la lección que generaliza, que es lo que más vale de esto: un ✔ en `make deploys` dice que el
WORKFLOW terminó bien, no que el código esté sirviendo.** Acá hubo dos workflows en verde y la
instancia seguía vieja seis minutos después del segundo. Para saber qué código te está contestando hace
falta pedirle al backend un campo que sólo exista en esa rama — que es exactamente la técnica que el
`CLAUDE.md` del arnés ya recomienda con `allowed_document_types`, y que acá funcionó con el recorte de
plazo por categoría.


### 2026-09-21 (3) · corrida de validación: lo de #1441 anda, y apareció una ruta que falta en `qa`

**Tanda A — canal de tienda, $1.500.000, tres entidades en PARALELO** (`make harness-caminar PAR=1
CERRAR=1 MANUAL=1 FLOW=ecommerce MONTO=1500000 CASOS='#13874eb6:77;#13874eb6:68;#13874eb6:9'`, el
comercio del ticket):

| entidad | rt | desenlace |
|---|---|---|
| CrediPullman (77) | 2 | ✅ **cerró en estado 11 «Autorizada»** — el canal cierra entero |
| Bancolombia BNPL (68) | 1 | handoff con modal + WhatsApp: la conducta esperada de rt=1 |
| Sistecrédito (9) | 1 | ⚠ **404 en `/ecommerce/…/validate-lender-otp`** — ver abajo |

**El monto bloqueado, en las tres solicitudes de la tanda** (sucursal 659, columna `lock_amount = 0`):

    uReq 466871 (tienda)        lock_amount = true
    uReq 466872 (tienda)        lock_amount = true
    uReq 466873 (tienda)        lock_amount = true
    uReq 466879 (autogestión)   lock_amount = false   ← control, misma sucursal

**Tanda B — el tramo por monto, Motai X, las tres bandas** (una corrida por banda):

| uReq | monto | banda | listado (tarjeta) | plan de pagos |
|---|---|---|---|---|
| 466874 | 2.000.000 | `[600k, 2.8M)` | `6` (max 6) | `[6]` |
| 466875 | 4.000.000 | `[2.8M, 5M)` | `12` (max 12) | `[12]` |
| 466876 | 6.000.000 | `[5M, 8.5M)` | `24` (max 24) | `[24]` |

Los dos lados coinciden en las tres, que es exactamente lo que #1441 tenía que lograr.

⚠ **HALLAZGO: `validate-lender-otp` NO está en el árbol público de `routes.ts`, y esta tarea decía que
sí.** En «Por promover a F-xx» está escrito que el mecanismo «en `qa` ya está cerrado por
`sharedFlowRoutes()`». **Es falso para esta ruta**: verificado contra el árbol local, que está en la
rama `qa`, `sharedFlowRoutes()` comparte **tres** rutas —`initial-fee-payment`,
`down-payment-validation` y `continue`— y `validate-lender-otp` sigue declarada **sólo** en el árbol
`merchant` (`apps/loan-request-wizard/app/routes.ts:204`, rodeada de ids `merchant-*`). Por eso
Sistecrédito desde la tienda da 404 duro y el comprador queda sin salida. Es la MISMA clase que el
archivo documenta en su propio comentario de cabecera.

⚠ **Y el 500 de `sign-documents` con Motai NO es de #1441: es previo.** Verificado como corresponde —
con los cuatro archivos en su versión de `origin/qa`, la misma corrida falla igual
(uReq 466878). *(El primer intento de esta verificación fue inválido y vale más que el dato: el árbol
estaba limpio porque todo estaba commiteado, así que el `git stash push` no guardó nada y la «corrida
sin mis cambios» corrió CON ellos. La forma que sí sirve es `git checkout origin/qa -- <rutas>`, correr,
y volver con `git checkout HEAD -- <rutas>`.)*

⚠ **Trampa del arnés, medida hoy: tres invocaciones CONCURRENTES de `harness-caminar` sacan el MISMO
teléfono y la MISMA cédula** (`3126490000` / `1818264900` en las tres), así que dos de las tres murieron
en `solicitar` con «Ocurrió un error» y el síntoma parecía del producto. Es la trampa que
`dev/listado.ts` documenta para sí mismo —«con la marca de tiempo SOLA no alcanza»— y que
`caminar-wizard.ts` no cubre entre PROCESOS distintos: su `--paralelo` sí reparte bien los teléfonos
dentro de UNA invocación. Para varias bandas, corridas escalonadas.


### 2026-09-21 (2) · CORE-30 cerrada y renombrada: el nombre dice dónde termina MI parte

Los dos issues de ecommerce se llamaban por el momento en que nacieron —«Revisión de flujo ecommerce
V1» y «Inicio paso refactor ecommerce»— y ninguno decía su alcance. Hoy:

| | antes | ahora |
|---|---|---|
| **CORE-30** | Revisión de flujo ecommerce V1 | **Ecommerce: flujo de onboarding hasta el listado de entidades, webhook y retorno al comercio** · ✅ Terminada |
| **CORE-543** | Inicio paso refactor ecommerce | **Ecommerce: pruebas en conjunto de todo el flujo** · sigue en 👀 En revisión |

⚠ **El nombre nuevo de CORE-30 marca un LÍMITE, y ése es su trabajo:** mi parte del canal llega hasta
el listado de entidades —más el webhook y el retorno al comercio—; de ahí en adelante el flujo de
ecommerce lo trabajan también Hans y Luis. Con el nombre viejo («flujo ecommerce V1») la tarea parecía
cubrir el canal entero, así que cualquier defecto posterior a entidades caía acá por descarte.

⚠ **Y CORE-543 dejó de ser «el arranque de algo» para ser lo que falta:** validar EN CONJUNTO lo que
cada uno hizo por su lado. Ahí es donde viven las pruebas del flujo completo, no en CORE-30.

⚠ **Ojo con esto al retomar: CORE-30 está Terminada pero la ENTREGA no.** Siguen abiertos #1016
(repone el front en `main` después del revert), #1441 (el plazo y el monto de la tienda) y la promoción
`qa` → `main`. Están en Pendientes y no se movieron; lo que se cerró es el issue, no el trabajo.

✔ **El `jira_title` del frontmatter se actualizó al nombre nuevo.** No es cosmético: es lo que se
publica, así que dejarlo viejo habría revertido el renombre en la próxima sincronización.


### 2026-09-21 · el monto de la tienda queda cerrado — y el flag del canal estaba muerto

**Lo que se pidió:** que en la pantalla de entidades del flujo de ecommerce el «Monto a solicitar» no
se pueda editar. La compra ya existe cuando el comprador llega —hay fila en `ecommerce_requests` con
su total—, así que un campo editable ahí ofrece cambiar algo que el resto del flujo no puede
acompañar: el comercio recibe el veredicto de SU pedido, por el total que cobró, y el crédito quedaría
por otro.

**El mecanismo ya existía entero y no hacía falta código nuevo para bloquear:**
`allied_branches.lock_amount` → `lenders-v2` (`alliedBranch.lock_amount`) → prop `lockAmount` en
`AvailableLenders.tsx:772` → `locked` en `RequestAmountForm.tsx`, que ya usa `readOnly` (no `disabled`,
a propósito: un input deshabilitado no dispara eventos y no habría forma de mostrarle el aviso) y ya
trae el texto «Si deseas cambiar el monto, debes iniciar la solicitud desde el inicio».

**Pero prender la columna en la sucursal 659 habría sido la respuesta equivocada**, y por eso fue
código: `lock_amount` es una preferencia del PUNTO DE VENTA —existe para el mostrador con precio
cerrado, hoy sólo la sucursal 2173 de BCP vehicular la tiene en 1— y esto no es una preferencia, es
una propiedad del canal. Si se resolviera por dato, cada sucursal de ecommerce nueva nacería con el
monto abierto hasta que alguien se acordara. La regla quedó en `OnboardingOrigin::locksAmount()`, al
lado de `isCustomerPresent()`, y el canal es un **techo** sobre el flag: cierra lo que la sucursal dejó
abierto, nunca abre lo que la sucursal cerró.

⚠ **Y acá estaba lo caro, que es un flag MUERTO.** El primer intento colgó el candado de
`$is_ecommerce`, el parámetro que ya recibe `getLenders`. No funciona: sale del **query string**
(`LenderListingController::index:22`, `$request->query('is_ecommerce', false)`) y **el front no lo
manda**. Lo resuelve bien —`available-lenders.tsx:133` pregunta por el vínculo con
`getEcommerceContextByLoanRequest`, sin cookie, y el comentario dice «Antes iba `false` fijo»— y lo
pone en el payload… pero `loan-options.repository.ts:35-36` arma la URL sólo con `?amount=`, así que el
flag se cae en el camino.

> **CORRIDA · 2026-09-21** — `make harness-caminar CASOS='#13874eb6' MONTO=1500000 FLOW=ecommerce` en
> `local` (uReq 466863, atada al pedido 7045) y después
> `GET /api/onboarding/loan-application/lenders-v2/466863?amount=1500000`: la respuesta trae
> **`isEcommerce: false`** sobre una compra de tienda. Un candado colgado de ahí habría quedado apagado
> para siempre y sin síntoma.

La fuente que sí contesta es el vínculo persistido, `EcommerceRequest::existsForUserRequest()` —el
mismo que usa `UserRequestService:742` y el que el docblock de `OnboardingOrigin` señala como «el que
contesta de verdad»—, que además cubre las solicitudes recreadas (`original_user_request_id`) y la
tabla puente.

⚠ **Ese flag muerto alimenta DOS consumidores más** en el mismo servicio: `getSteps($is_ecommerce, …)`
(`:333`) y `getAlliedBranch($is_ecommerce)` (`:148`). Los dos reciben `false` siempre. No se tocaron —
cambiarles la conducta tiene su propio alcance— y quedan en Pendientes.

**Verificado corriéndolo**, dos recorridos sobre la MISMA sucursal (659, columna `lock_amount = 0`),
cambiando sólo el canal:

| canal | uReq | `alliedBranch.lock_amount` | el campo |
|---|---|---|---|
| compra de tienda (pedido 7045) | 466863 | **`true`** | bloqueado |
| autogestión, misma sucursal | 466864 | `false` | editable |

**Entregado en el MISMO PR #1441** (commit `ef435701` sobre `9b956475`), por la regla nueva del
`CLAUDE.md` raíz: un PR por tarea y por repo, con todo lo que la tarea toque de ese repo. Y la
descripción del PR se reescribió para que no nombre ninguna herramienta interna —ni `harness`, ni
`trazador`, ni comandos `make`—: eso vive acá, que es privado. Las dos reglas quedaron escritas en
`CLAUDE.md` §Git.


### 2026-09-19 · el ticket de cuotas de ecommerce: ya estaba cerrado en `qa`, y abajo había otro más grande

**El ticket** («la pantalla de lenders muestra X opciones y el plan de pagos de Creditop X sólo 3»,
comercio `13874eb6`, solicitud 502446, $1.500.000) **ya no se reproduce.** Es el caso que motivó #1432,
que mergeó a `qa` el 18/9 a las 00:32 UTC y se desplegó ese mismo día. Verificado hoy pidiéndole a `qa`
los dos endpoints de la MISMA solicitud, que es la comprobación que el nodo `amount-tiers` prescribe:

| servicio | plazos |
|---|---|
| `GET /api/onboarding/loan-application/lenders-v2/502446?amount=1500000` | `fee_numbers = 1,3,6` · `fee_number = 6` |
| `GET /api/loans/requests/promissory-note/502446/simulate-payment-schedule` | **[1, 3, 6]** |

Los dos dicen tres. El dato que lo explica, medido contra la base de `qa`: la entidad es `Cierre X (test)`
(lender 201, rt=2) y declara `1,3,6,12` con máximo 12; el usuario 1828458 está en la categoría
«Segunda oportunidad» (id 168, `max_fee_number = 6`). Ninguno de los dos calculaba mal — el listado
contestaba otra pregunta.

⚠ **Pero el defecto sigue vivo en producción:** #1432 está en `qa` y **no en `main`**
(`git log origin/main -S aplicarTopeDePlazoDeLaCategoria` da cero). Se va con la promoción `qa` → `main`
que esta tarea ya tiene en «Cómo se ataca»; no hace falta nada aparte.

**Lo que apareció al verificar, y que el ticket no vio.** El plan de pagos recorta los plazos por **tres**
capas —producto (`products.max_term`), categoría y **tramo por monto**
(`creditop_x_conditions_by_amount_by_lender`)— y el listado sólo había aprendido la segunda. La tercera
está **viva en producción y pega más fuerte**, en Motai X (lender 62): sus cuatro bandas tienen
`mandatory_fee_number = 1`, así que cada lado ofrece **un** plazo único… y cada lado elige la banda con un
monto distinto. El front usa `original_amount − initial_fee`; el plan usa `user_requests.amount`, que
viene inflado por el factor del plazo MÁXIMO porque el cliente todavía no eligió (está documentado en el
docblock de `RegularPaymentScheduleService::lenderPricesByTerm`).

> **MEDICIÓN · 2026-09-19** — 8 fila(s) en `prod`.
> **Cómo se vuelve a comprobar:** `make trazador-sql SQL='SELECT c_front.max_fee_number AS plazo_tarjeta, c_back.max_fee_number AS plazo_plan, COUNT(*) AS solicitudes FROM user_requests ur LEFT JOIN creditop_x_conditions_by_amount_by_lender c_front ON c_front.lender_id = ur.lender_id AND (ur.original_amount - COALESCE(ur.initial_fee,0)) >= c_front.min_amount AND (ur.original_amount - COALESCE(ur.initial_fee,0)) < c_front.max_amount LEFT JOIN creditop_x_conditions_by_amount_by_lender c_back ON c_back.lender_id = ur.lender_id AND ur.amount >= c_back.min_amount AND ur.amount < c_back.max_amount WHERE ur.lender_id = 62 AND ur.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) GROUP BY c_front.max_fee_number, c_back.max_fee_number ORDER BY solicitudes DESC' TARGET=prod`

| plazo_plan | plazo_tarjeta | solicitudes |
|---|---|---|
| 24 | 24 | 56 |
| 24 | 18 | 45 |
| 18 | 18 | 31 |
| 36 | 24 | 31 |
| 36 | 36 | 26 |
| 12 | 12 | 25 |
| 18 | 12 | 13 |
| 12 | NULL | 1 |

**89 de 227 solicitudes (39 %) en 90 días** con la tarjeta y el plan en bandas distintas: 18→24 (45),
24→36 (31), 12→18 (13). Y el plan gana siempre, así que el desenlace se ve en los plazos cerrados —
**31 créditos a 18 cuotas, un plazo que la entidad NO declara** (`fee_numbers = 6,12,24,36`), porque con
`mandatory` el plan devuelve el techo de la banda aunque no esté en la lista:

> **MEDICIÓN · 2026-09-19** — `prod`, lender 62, 90 días.
> **Cómo se vuelve a comprobar:** `make trazador-sql SQL='SELECT ur.fee_number, COUNT(*) AS solicitudes FROM user_requests ur WHERE ur.lender_id=62 AND ur.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) GROUP BY ur.fee_number ORDER BY ur.fee_number' TARGET=prod`

| fee_number | solicitudes |
|---|---|
| 6 | 2 |
| 12 | 31 |
| **18** | **31** |
| 24 | 109 |
| 36 | 55 |

*(Creditop X (37) también tiene tramos y da **0** divergencias: sus bandas son anchas respecto de sus
montos. DHI X (63) no tuvo solicitudes. O sea que esto es de Motai X, no del mecanismo en general.)*

**Lo que se hizo** — rama `fix/listado-tramo-por-monto` sobre `qa`, commit `9b956475`, PR **#1441**:
el listado aplica el tramo por monto con el **mismo** monto que el plan. La elección de banda, el
desempate de bandas solapadas y el `mandatory` se mudaron a
`Modules/Loans/App/Services/PaymentSchedule/AmountConditionTermPolicy.php` y **los dos servicios la
llaman**. Copiar el bloque al listado lo habría cerrado hoy y reabierto la primera vez que alguien tocara
uno de los dos — es la regla de la vara del `CLAUDE.md` raíz: lo que una herramienta afirma sobre otra se
cablea, no se escribe.

Verificado **corriéndolo** en local, misma solicitud (466860, Motai X, $4.000.000, banda [2.800.001,
5.000.001) → 12 obligatorio):

| | listado (la tarjeta) | plan de pagos |
|---|---|---|
| **sin el arreglo** | `6,12,24,36` · `fee_number = 36` | **[12]** |
| **con el arreglo** | `12` · `fee_number = 12` | **[12]** |

> **CORRIDA · 2026-09-19** — `make harness-caminar CASOS='#5cb92b54:62' MONTO=4000000 CERRAR=1` en
> `local`, y después los dos endpoints sobre el uReq que dejó.

18 pruebas verdes (`Modules/Loans/tests/Unit/AmountConditionTermPolicyTest.php` +
`Modules/Onboarding/tests/Unit/ListadoTopeDePlazoPorCategoriaTest.php`). La única falla de
`Modules/Loans/tests/Unit/PaymentScheduleServiceTest.php` es **previa**: falla igual con el cambio
aislado en un stash, y ese test no toca `getPossibleFeeNumbers`.

⚠ **Una propiedad que quedó y conviene conocer:** el front sigue re-filtrando por su cuenta en
`useInstallmentOptions.ts`, pero **ya no puede contradecir al servidor** — cuando su filtro deja la lista
vacía cae a `baseOptions`, que ahora es la lista recortada. El recorte del servidor pasó a ser el piso.

⚠ **Lo que NO se tocó, a propósito:** cuál de los dos montos es el correcto para elegir la banda.
Cambiarlo cambia el plazo que recibe el 39 % de Motai X en producción — es decisión de negocio, no de
refactor. Hoy los dos servicios contestan lo mismo con el monto que el plan usa desde siempre, así que la
tarjeta deja de prometer lo que el plan no da **sin cambiarle el crédito a nadie**. Queda en Pendientes.


### 2026-09-18 · limpieza del archivo: lo que no era de la tarea, y lo que ya lo dice una pestaña

Miguel señaló tres clases de ruido y se sacaron las tres. **(1) Lo que no es de esta tarea:** la sección del
SDK del comercio y el conocimiento del prefill que usaba se **mudaron** al frente general de
`playground.md` — acá quedó sólo el comportamiento que esta tarea entrega (los campos llegan
llenos y bloqueados), sin el detalle de los seis campos ni el roadmap del formulario dinámico. **(2) Lo que
ya lo dice otra pestaña:** se borraron el `## Bitácora` del cuerpo (el tiempo vive en `data/entries/` y lo
muestra su pestaña) y las cuatro tablas de PRs y ambientes, que son exactamente lo que mide
`make tareas-ramas` — de ellas quedó sólo lo que la medición **no** puede saber, que el revert dejó a #997 y
#1005 como ancestros de `main` sin su contenido. **(3) Lo viejo:** la historia de las ramas mergeadas a
`develop` en junio, que dejó de ser la vía de entrega el 17/9; de esa cola sobrevive lo único vivo, que es
que #582, #661 y #663 **siguen faltando en `qa`** y que el refresh desde `main` los destruiría.

El cuerpo pasó a la forma de la plantilla —estado, pendientes, objetivo, dónde se toca, plan, alternativas,
decisiones, riesgos, límites y material— y los hechos con fecha quedaron como anotaciones, que es lo que
alimenta la pestaña Hallazgos. El Registro del 17 y el 18 queda íntegro; **el del 15 y el 16 se condensó a
una entrada por día**, decisión de Miguel: eran 27 entradas entre los dos días, con el paso a paso de cada
intento, y lo que queda cierto entra en dos. El detalle completo sigue en el historial de git.

⚠ **Y de paso cayó una afirmación que el archivo repetía desde el 15/9**: que de la cola de junio faltaban
#582, #661 y #663 en `qa`. Re-medido hoy contra `origin/qa`, **#665 y #661 ya volvieron** (los repuso
#1015) y #600 se rehizo dentro de #997 — queda #582, y #663 estaba descartado. Corregido en Riesgos y en
el pendiente, con cómo volver a medirlo.

**Y se decidió qué hacer con el rastro de las herramientas**, que era la pregunta de fondo: entra, pero
como **MATERIAL** —la receta que alguien vuelve a correr— y no como diario de invocaciones, que es lo
que infló este archivo. Con ese criterio se sumó a «Cómo se comprueba» el **camino de diagnóstico**
medido el 16/9: el forense de la solicitud, lo que vio el cliente en pantalla y el mensaje crudo del
endpoint, cada uno con lo que aporta y con su trampa. Lo que corrí ESE día y qué dio sigue yendo al
Registro o a una anotación con su `Cómo`.

Esto ordena la documentación: no comprueba despliegues, no cierra pendientes y no toca Jira.

### 2026-09-17 (5) · los cuatro canales en paralelo de nuevo: el listado se cae por config, no por el canal

> **MEDICIÓN · 2026-09-17** — cuatro canales a la vez contra `qa`, **sin exportar ningún permiso de
> escritura**. Desenlace leído en la base, no en la consola:
>
> | canal | comercio · entidad | estado | pedido atado | WhatsApp |
> |---|---|---|---|---|
> | **tienda** | Tienda Fisio · CrediFis X | **11** ✓ | sí | 0 |
> | **tienda** | Amoblando · CrediPullman | 10 | sí | 0 |
> | **tienda** | Alpeluche · Alpeluche X | 10 | sí | 0 |
> | **autogestión** | Creditop · Creditop X | 10 | — | 0 |
> | **autogestión** | Alpeluche · Alpeluche X | 10 | — | 0 |
> | **agregadores** | Refurbi · Welli · Creditop · Su+pay | **9, sin entidad** | — | 0 |
> | **asesor** | — | cortó al instante: sesión vencida | — | — |

**Los tres del canal tienda quedaron atados a su pedido y ninguno entregó el proceso al comprador**, que
es la conducta que esta tarea vino a fijar. Sigue valiendo.

**Lo que no cerró no es de esta tarea, y son dos cosas distintas:**

- **estado 10 en cuatro casos** — llegaron hasta la firma y ahí el documento tardó más de lo que el
  balanceador espera (**504**). Es **F-180**: `qa` es ¼ de vCPU y el corte son 60 s, agravado por correr
  cinco casos a la vez. El flujo está bien; el ambiente no da.
- **estado 9 sin entidad en los dos agregadores** — el listado devuelve **500**. Se diagnosticó y quedó
  como **F-223**, y **no es lo que parecía**: la causa del 16/9 (la tabla `cards` que faltaba) **ya está
  arreglada**, así que este 500 es otro. El listado sale de la **sucursal** y el orden sale del
  **comercio**, y hay entidades habilitadas abajo sin fila arriba —Welli en Refurbi, Su+pay en
  Creditop— así que el servicio que ordena desreferencia un null y tumba la pantalla entera. Está
  igual en `main` y en `qa`.

⚠ **Y el backend no deja rastro**: 111 líneas en Loki para esa solicitud y **un solo error, el `ONB002`
inofensivo**. El mensaje real sólo aparece pegándole al endpoint con `dev/listado.ts --v2`.

**De paso, dos comprobaciones del arnés que esta tanda vino a hacer:** los cuatro canales corrieron
**sin `I_KNOW_THIS_TOUCHES_SHARED_DEV`**, y los tres procesos concurrentes **no se pisaron la lista del
bypass** — 58 teléfonos con las tres corridas en vuelo, 51 al terminar: exactamente los 7 que pusieron.
Antes el primero en terminar se los borraba a los otros.

### 2026-09-17 (4) · PR #1027 · una promesa rechazada rompía el listado ENTERO, no su tarjeta

El barrido de la entrada (3) dejó un caso que no cerraba, y resultó ser un defecto del listado que no
tiene nada que ver con ecommerce: con una entidad **agregadora** el listado contestaba **«Unexpected
Server Error»** y no llegaba nada — ni las entidades que sí habían resuelto.

> **MEDICIÓN · 2026-09-17** — mismo caso (comercio Refurbi · entidad Welli, `response_type=1`) y mismo
> canal (autogestión), por los dos motores del arnés:
>
> | motor | resultado |
> |---|---|
> | **navegador** (el cliente real) | ✅ **listó** |
> | **HTTP** | ❌ «Unexpected Server Error», el listado no llegó |

**Esa diferencia ES el bug.** El listado devuelve un diccionario **de promesas** (una por entidad) y lo
transmite en streaming; una promesa **rechazada** no llega como el error de SU tarjeta, **tumba la
serialización de todo el lote**. El navegador lo tapaba porque su `<Await>` recibe el rechazo y lo
pinta; cualquier otro consumidor del stream ve una pantalla rota.

⚠ **Y el `Promise.allSettled` que ya estaba NO cubría esto**, que es por qué sobrevivió a una guarda que
parecía justamente la guarda: espera las promesas para que el `await` del loader no reviente, pero **el
objeto promesa que se guardó es el mismo que viaja al cliente**. Una guarda sobre el `await` no es una
guarda sobre el valor. Y hay un agravante: la promesa de Welli se **comparte** entre las entidades que
consultan por ella, así que un rechazo no cuesta una tarjeta, cuesta todas las que apuntan a ese objeto.

**El arreglo es una guarda de FRONTERA**, no un `try/catch` más adentro: `neverRejects()` envuelve todo
lo que entra al diccionario. La regla queda declarada en un lugar —*nada que viaje en el stream puede
rechazar*— en vez de repartida por cada sitio que produce una promesa. Separa `aborted` de `rejected`
a propósito: el primero es que alguien se fue, el segundo es que algo falló y nadie lo convirtió en
estado.

Vive en `lib/utils/` y no inline **para que se pueda probar**: ahí cae dentro del `include` de vitest
del wizard. Sus 5 casos incluyen los dos que revientan una guarda ingenua — el abort que llega como
`Error` y no como `DOMException`, y un `reject(undefined)`, que devolvería el problema si la guarda
asumiera `Error`.

| | resultado |
|---|---|
| suite del wizard, baseline `origin/qa` | 521 pasan · 1 falla |
| suite del wizard, con el cambio | **526 pasan** · 1 falla |

Las **3 fallas son previas** (dos archivos que no cargan por `SESSION_SECRET` y uno de
`backend-driven-form`), idénticas con y sin el cambio. Build del wizard en verde — la vara de este
repo. `biome check` deja los 2 warnings de complejidad que ya trae `origin/qa`, ni uno más.

⚠ **El export nuevo se puso a mano en su posición ordenada**: dejar que el formateador reordenara el
índice público habría enterrado el cambio bajo ~200 líneas de movimiento.

**PR abierto: frontend-monorepo #1027 → `qa`** (rama `fix/preapprovals-promesa-rechazada`). Graduó a
**F-221** en el nodo de hallazgos, porque la lección generaliza y no es de esta tarea: *en un loader que
transmite en streaming, el borde no es el `await`, es el valor* — cualquier promesa que se devuelva sin
esperar es parte del contrato de la pantalla y tiene que ser tan total como un campo de un JSON.

### 2026-09-17 (3) · los tres canales en paralelo contra `qa`: la BD dice exactamente lo que tiene que decir

Con el redirect ya vivo (entrada 2), se corrieron **varios comercios con canales distintos en paralelo**
contra `qa` para ver si los cambios rompían algo. **No rompen nada, y el discriminante del canal quedó
medido en la base**, no deducido.

> **MEDICIÓN · 2026-09-17** — cuatro solicitudes de `qa`, re-verificadas en base hoy:
>
> | solicitud | comercio · sucursal | canal | entidad | estado | `corporate_user_id` | WhatsApp de entrega |
> |---|---|---|---|---|---|---|
> | **502463** | Amoblando Pullman · **Ecommerce** (659) | tienda | CrediPullman (77) | **11** | NULL | **0** |
> | **502468** | Amoblando Pullman · **principal** (390) | asesor | CrediPullman (77) | **11** | 1828388 | **1** |
> | **502476** | Amoblando Pullman · Ecommerce (659) | autogestión | CrediPullman (77) | **11** | NULL | **0** |
> | **502477** | Tienda Fisio · Ecommerce (756) | autogestión | CrediFis X (70) | **11** | NULL | **0** |
>
> `SELECT user_request_id, name FROM twilio_logs WHERE user_request_id IN (…)` devuelve **una sola
> fila** en las cuatro: `WhatsApp - Send Self Management` en **502468**, la del asesor.

**El par 502463 / 502468 es el que decide**, porque es el único contraste limpio: **mismo comercio**
(Amoblando Pullman, `allieds` 94), **misma entidad** (77), **mismo desenlace** (estado 11) — y lo único
que cambia es el canal. La compra desde la tienda **no** entrega el proceso al que está mirando; el
mostrador **sí**, que ahí es lo correcto. Autogestión se comporta como la tienda, que es la regla que se
fijó el 16/9.

**Y el webhook fue el que mejor se portó, fallando.** La solicitud de tienda quedó atada a su pedido
(`ecommerce_requests` 7391, pedido `5002`, sucursal 659) con `return_url` apuntando al sumidero del
arnés, `http://localhost:9/volver-al-comercio`. En los logs sale `ecommerce_store_notify_failed` con
`cURL error 7`, y en la base **`processed = 0`** — pero **el crédito llegó igual a estado 11**. Que la
notificación a la tienda no se pueda entregar **no bloquea la autorización**, y queda registrado como
pendiente de reintento en vez de perderse en silencio. Era exactamente la propiedad que había que
comprobar.

⚠ **Dos casos que no cerraron, ninguno de este trabajo:** `#96f5da12:11` (Creditop · Su+pay) muere
antes, en `/solicitar`, sin botón habilitado para avanzar; y Compubit se cae con **504** en
`sign-documents` — eso es **F-180**, la máquina de `qa` con ¼ de vCPU contra el corte de 60 s del
balanceador.

**De paso, un arreglo del arnés que estaba escondiendo resultados.** El bypass de OTP estaba
**enganchado a la bandera `--cerrar`**: correr un caso sin cerrarlo dejaba el bypass sin registrar y la
autogestión moría en el código de verificación. El síntoma parecía del proveedor —y lo pareció más
porque el control falló igual—, pero era la invocación. Desacoplado en `ebebb1c`: el bypass ahora
depende de que el ambiente **no sea** `local`, que es la condición real. Medido, **0/3 → 3/3**.

### 2026-09-17 (2) · MERGEADOS: el botón que vuelve a la tienda, y el checkout de los comercios entrando al wizard

Dos entregas, en dos repos, las dos **mergeadas**:

**1 · frontend-monorepo #1024 → `qa`** (`fix/ecommerce-boton-volver-al-comercio`). En la pantalla de
crédito aprobado, cuando el comprador viene de una tienda el botón dejó de decir «Ver mi perfil»: dice
**«Regresar al comercio»** y lleva a la url de retorno del comercio. Se hizo **sin tocar el componente
de estado**: ya acepta un `copy` parcial que se aplica al final, así que la pantalla sobrescribe sólo
las dos frases que cambian y todo lo demás —incluido el texto del crédito rotativo— sigue igual. Y el
enlace detecta solo que el destino es de otro dominio y sale como enlace común en vez de como navegación
interna. La condición es explícita —hay url de retorno **y** no es el flujo de equipos—, así que ningún
otro canal cambia de texto.

**2 · legacy-application #169** (`feat/ecommerce-checkout-al-wizard`). El checkout de los comercios
**entra al wizard nuevo**: la pantalla vieja recibe el contrato en base64 y, en vez de renderizar,
redirige a `/ecommerce/{hash}/checkout` **reenviando el query string tal cual** — ahí viaja el base64,
con `+ / =` adentro, y re-encodearlo lo corrompería sin dar error, sólo una pantalla sin datos.

⚠ **Corbeta/Bancolombia se dejó exactamente como está, a propósito**: su flujo es muy independiente y ya
tenía su propio camino. La rama nueva entra **después** de la suya, así que los comercios de esa lista
ni la tocan.

⚠ **Y una corrección a lo que dije primero: `NEW_FRONTEND_BASE_URL` NO sirve de interruptor de esta
funcionalidad.** Es la misma variable que usan **seis** controladores, así que apagarla apaga mucho más
que esto. Lo que sí hace es caer al checkout de siempre si no está configurada — por eso el método
devuelve nulo con la variable ausente, vacía o con espacios, que son tres estados distintos y los dos
últimos no son nulos. Van **6 pruebas unitarias** cubriendo justo eso y el reenvío verbatim del base64.

**Probado de punta a punta**: el redirect salió de `develop` en el monolito viejo y el comprador aterrizó
en `qa` del wizard, entrando por la url de prueba que arma el artefacto de QA.

⚠ **Para producción falta un paso que no es de este PR:** `/ecommerce/{hash}/checkout` **no existe en
`main`** del wizard todavía. Mandar el redirect a producción antes de la promoción `qa`→`main` deja al
comprador en una ruta que no está — el mismo orden que ya está anotado más arriba.

### 2026-09-17 · `develop` sale de la vía de entrega

Se retiró del tablero la información de **PRs hacia `develop`**: la entrega es **`qa → main`**, y después el resto de las ramas se pone al día **desde `main`**, así que un merge a `develop` ya no dice nada sobre lo entregado. **No se tocó el Registro con fecha** (es lo que pasó, no lo que falta), ni los nombres de ambiente/infraestructura (`legacy-backend-develop:199`, `…develop.internal.creditop.com`, `APP_ENV=development`), ni el repo `infrastructure`, que no entra en ese flujo. Los **PRs abiertos se conservan** marcados «sin destino»: hay que re-apuntarlos o rehacer la rama sobre `qa`.

Acá: la tabla de los cuatro PRs pierde la columna `base`, la matriz de presencia pierde la columna `develop`, la tabla histórica dice «fuera de la vía» en vez del destino, y cuatro pendientes quedaron reencuadradas. Se corrigió de paso que #503 y #363 seguían declarados ABIERTOS cuando el propio archivo medía que se **cerraron el 14/9**.

⚠ **Y una consecuencia del plan que hay que mirar ANTES de ejecutarlo:** poner las ramas al día desde `main` **destruye lo que sólo vive fuera de `main`** — los CINCO arreglos de junio (#582, #600, #661, #663, #665) que #997 no se llevó. **#665 es literalmente el arreglo del defecto que causó el revert de septiembre.** Esa lista se dejó más visible, no menos: rescatarlos es prerrequisito del refresh.

### 2026-09-16 · el canal como valor con nombre, y los tres canales corridos contra `qa`

*(Condensado el 18/9 de las catorce entradas del día; el paso a paso está en el historial de git.)*

> **MEDICIÓN · 2026-09-16** — los tres canales contra `qa`, con la aplicación haciendo el redirect:
> `502395` ecommerce y `502396` autogestión caen en `/self-service/…/confirmation` con `corporate_user_id`
> NULL y cero WhatsApp; `502397` con asesor va a `/merchant/…/continue` y sí lo dispara.
> **Cómo se vuelve a comprobar:** las tres corridas de §«Cómo se comprueba», y el desenlace en la base.

**El trabajo del día fue la rama `fix/flujo-por-origen`** (backend, desde `origin/qa`) →
[legacy-backend#1409](https://github.com/Creditop-SAS/legacy-backend/pull/1409). El canal deja de deducirse
de dos booleanos sueltos y pasa a ser un valor con nombre, `OnboardingOrigin`, resuelto **una vez** y
compartido por las tres decisiones que antes lo deducían por separado. **Y el pedido de la tienda gana sobre
la sesión**, que es el arreglo: antes la primera pregunta era `auth()->user() !== null`, así que una sesión
colada convertía una compra en flujo de mostrador. Pruebas del resolver: **14 → 20** (47 aserciones).

⚠ **El hallazgo que lo destrabó es anterior a la rama: `$request->ecommerce_request_id` es SIEMPRE null en
`update-user-request`** — el payload del front no lo trae. Dos consecuencias medidas: mi primera versión del
arreglo no hacía nada, **y la guarda que ya existía tampoco** (`&& !isset($ecommerceRequestId)` nunca excluyó
a ecommerce, que es lo que producía el `/continue?url=null`). El dato bueno está persistido desde el checkout
en tres lugares, y quedó como predicado con nombre: `EcommerceRequest::existsForUserRequest()`.

**De dónde sale la sesión colada:** `buildBackendAuthHeaders` decide **sólo** por si hay usuario en la
petición, sin mirar en qué árbol está la ruta; como el wizard sirve los tres canales desde el mismo dominio,
las cookies viajan también en `/ecommerce/*`. Es exactamente lo que vio QA — su solicitud `502370` es del
canal ecommerce y lleva `corporate_user_id = 276231`. En producción no es sólo un artefacto de prueba: el
empleado del comercio con el panel abierto reproduce lo mismo.

**Dos cosas que el día dejó decididas** y viven arriba como anotaciones: la regla queda en «entrega SÓLO el
mostrador» (medido en prod, 90 días: autogestión sin ninguna marca son 0 comercios y 0 solicitudes), y
`opensNewTab` queda **congelado** con una prueba que fija el congelamiento, para que el blast radius del PR
sea uno.

**Lo que costó el día, y no era del producto:**

- 🔴 **`lenders-v2` daba 500 en todo `qa`** — `Table 'creditop.cards' doesn't exist`: el PR #1388 trae su
  migración y **el despliegue de `qa` no corre migraciones**. Se creó sólo esa tabla, con el DDL que Laravel
  genera, idempotente y registrando la fila en `migrations`; **no** se corrió `artisan migrate`, que es el
  mecanismo de CORE-431. La causa de fondo queda abierta, arriba en Riesgos. Se descubrió con PostHog, no
  con Loki: el backend no dejó rastro.
- **El caminador sembraba antes del `action` de `personal-info`** y el formulario pisaba el perfil, así que
  reportaba «la entidad no salió en el listado» como si fuera del comercio. Tres corridas perdidas antes de
  verlo; destrabado resembrando con `synthFill(ur, { lender })` **después** del formulario.
- **`dev/asesor-destino.spec.ts` mintió en verde** en su primera versión: con un localizador propio el click
  pegó en otro botón, la corrida dijo «1 passed» e imprimió como destino la misma URL del listado — y en la
  base el `lender_id` quedó **NULL**. Lo delató mirar la BD, no el runner. Reescrito sobre `elegirEntidad`.
- **La sesión de Cognito de `qa` no era un bloqueo**: el pre-login ya existía por consola
  (`dev/warm-session.spec.ts`, headed). Renovó en 22 s.

**Y dos cosas del método, que costaron corridas.** Una tabla con un comercio por fila y un camino por
comercio **no prueba una regla, la insinúa**: hacen falta las dos celdas del mismo comercio, y el par que
discrimina es el de los dos flags apagados. Y en el canal del asesor **la sucursal la decide el backend**
según a dónde esté asignado el asesor de la sesión, no el caso que se pide.

**De paso, dos cosas que no son de esta tarea:** un 404 previo al elegir Sistecrédito por ecommerce
(`validate-lender-otp`, reproducido con A/B contra `qa` — **tercera** vez la misma clase de defecto de
ruteo), y que el `include` de vitest del wizard deja **19 archivos de prueba sin correr**. Los dos quedaron
como pendientes.

**#1018 portado a #1016** con cherry-pick limpio (commit `33649662` sobre `f474b237`, build verde). Va por
SHA porque la rama está tomada por el worktree de otra sesión.

### 2026-09-15 · el revert de `main`, la causa medida, y los PRs que la reponen

*(Condensado el 18/9 de las trece entradas del día; el paso a paso está en el historial de git.)*

> **MEDICIÓN · 2026-09-15** — el síntoma que reportó QA es **del asesor**, no de ecommerce, y lo produce una
> ruta que #997 registró en **un solo** árbol de rutas: `/merchant/…/initial-fee-payment` no existe en el
> árbol del asesor, y como `:flow` es dinámico **React Router no tira 404: la matchea en `public-layout`**,
> de donde salen cuatro 302 encadenados hasta `/solicitar`. El control —una ruta que no existe en ningún
> árbol— sí da 404, así que no es «cualquier ruta rara rebota».
> **Cómo se vuelve a comprobar:** llamar a `matchRoutes` de react-router 7.13.1 con una réplica del árbol de
> `routes.ts` de `origin/qa`, y las sondas de URL de §«Cómo se comprueba».

**Lo que apareció buscando el estado:** los PRs **entraron a `main`** con la promoción `Qa (#1007)` (14/9
18:58) y **Abel los revirtió** esa noche con #1013 (`77796a4f`, 20:52). El revert **no tocó el backend**.
Lo reportó Joel (QA) por DM: *«al dar click en "Validar Pre aprobado" … lo devuelve a la pantalla de
solicitar»*.

⚠ **El alcance era más ancho que el título del PR.** El `if (initial_fee > 0)` está **antes** de casi todas
las ramas de `available-lenders`, así que en el canal del asesor una cuota inicial > 0 rompía la selección de
casi cualquier entidad — medido después corriendo: con Bancolombia (`rt=1`) rebotaba igual. Y **ecommerce es
el canal inmune** (#997 fuerza `initialFeeAllowed = false`), que es por qué el caminado del 14/9 había dado
verde.

**El arreglo ya estaba escrito desde junio, y eso es lo que más vale del día.** Barridos los dos repos con
`gh pr list --author mig-creditop --state all`, después de #551 (11/6) hubo **cinco PRs de corrección** y
**#997 no se los llevó**: **#665** (26/6) es literalmente el arreglo de este defecto —su comentario nombra el
síntoma— y **#661** es el mismo defecto de ruteo espejado (en junio faltaba `continue` en el árbol público).
La regla que queda: **rehacer trabajo viejo sobre una rama nueva no se copia del PR, se copia del estado
final de la rama donde vivió.**

**Tres PRs, y dos reglas que costaron uno entero.** #1014 se cerró: mostraba 15 commits y 60 archivos, y
**56 eran trabajo ajeno** —salió de `main` apuntando a `qa`, así que arrastró el desfase entre las dos ramas—.
Lo detectó Miguel mirando el contador del PR. **Una rama para `qa` sale de `qa`**: así salió **#1015**, un
commit y 3 archivos, mergeado ese día. **#1016** va a `main` con la reposición más el arreglo.

✔ **Y el arreglo de fondo lo encontró Sonar**, rechazando #1015 por duplicación (30,8 %): las rutas que
tienen que existir en los dos árboles quedan declaradas **una sola vez** en `sharedFlowRoutes()`. No es DRY
por prolijidad — mientras se declaren por separado, olvidar una **no falla en ningún lado**, que es el
mecanismo del bug y ya había pasado dos veces. *(De los 6 hallazgos de Sonar en #1016, dos eran falsos
positivos: matchea la palabra española «todo» como si fuera un TODO. Y el que caía la compuerta era el
literal `|| "http://legacy-backend.inertia-develop"`, que se borró: `VITE_API_URL` ya es obligatoria.)*

**Corrido, no deducido:** dos wizards en paralelo contra la misma base local, `:5174` con el código de `qa`
y `:5177` con el arreglo, mismo comercio y misma entidad. CrediPullman `rt=2` pasa de **0/1 —rebota y cicla,
dejando una `user_request` en estado 3 por vuelta—** a **1/1 en estado 11** con 11 pantallas.

⚠ **Y el caminador NO PODÍA ver este bug.** Tres defectos suyos, los tres de la misma clase —daba verde sin
haber mirado— y los tres arreglados (`a16b5c2`): `initial_fee` estaba **quemado en 0**, el handoff usaba el
prefijo del flujo en curso (ruta que no existe en el árbol merchant), y **el atajo se tomaba mirando sólo el
`response_type`**, así que se salteaba el paso que fallaba y **cerraba en estado 11 igual, con el flujo
roto**. Un runner que se saltea el paso que falla y después declara «cerró» es peor que no tenerlo.

**Otros dos PRs salieron del mismo día, los dos de probar el canal:**
[#1018](https://github.com/Creditop-SAS/frontend-monorepo/pull/1018) —el botón de validar no hacía nada
cuando la entidad pide cuota inicial y el canal esconde el campo: la idea «¿este canal pide la cuota inicial
acá?» estaba escrita en un solo lugar y los otros dos la consultaban de memoria— y
[legacy-backend#1402](https://github.com/Creditop-SAS/legacy-backend/pull/1402) —sin asesor ya no se entrega
el proceso al que está mirando: el WhatsApp que se enviaba marcaba «ya se le entregó algo», que es justo la
condición que impedía continuar—.

**El canal, validado por API contra `qa`**: las 8 comprobaciones en verde, del contrato al vínculo con el
pedido. ⚠ La primera corrida falló **por la herramienta**: derivaba el teléfono al azar y contra `qa` el OTP
sólo es predecible si está en `qa_otp_bypass_phones`. Se agregó `TEL=`.

*(Y el «bucle» del selector de plazo no era un bucle: era el autorrelleno del harness abriendo tres popovers,
por un fallback **por posición** en `pkg/fecha-trio.ts` que leía «12 cuotas» como un día. Arreglado con la
regresión fijada, 14/14 en verde.)*

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
