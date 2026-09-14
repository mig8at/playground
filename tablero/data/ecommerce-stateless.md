---
id: 6
title: "Ecommerce web stateless"
stage: work
created: "2026-07-21T10:30:30-05:00"
context_nodes: [ecommerce, onboarding, payments, architecture]
jira: [CORE-543]
jira_title: "Inicio paso refactor ecommerce"
ramas: ecommerce-stateless-checkout, ecommerce-*stateless*
---

# Ecommerce web stateless (→ wizard sin cookie)
(migrado del nodo-tarea `ecommerce-web-stateless` del árbol de context, 2026-07-21)

CUÁNDO APLICA: Cuando la tarea toca la migración de la originación de ecommerce (VTEX/Woo/self) al wizard STATELESS (sin cookie) en legacy-backend + frontend: PRs 795 (backend, en main) / 551 (frontend, en develop), el entry ecommerce/checkout, los endpoints de contexto, o el estado 'backend en main, front aún en develop'.

# Ecommerce web stateless (→ wizard sin cookie) · task
> **rama:** `feature/onboarding/ecommerce-*stateless*` · **PR:** backend [#795](https://github.com/Creditop-SAS/legacy-backend/pull/795) (✅ en main) · frontend [#551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551) (🟡 en develop, NO en main) · **estado:** parcialmente aterrizado
>
> Llevar la originación de ecommerce (VTEX / WooCommerce / self) al **wizard STATELESS (sin cookie)**: el front arma la entrada `ecommerce/checkout` y lee el contexto de la solicitud vía endpoints de contexto del backend (no por sesión/cookie). Es la versión que reemplazó al intento anterior "web-origination" de abril (PRs 503/363, que quedaron sin merge).

## Contextos que usa
- **ecommerce** — el canal (contrato base64, credencial `allied_ecommerce_credentials`, `/vtex/*`, "volver al comercio"). Esta task lo lleva al wizard nuevo en modo stateless; el nodo describe el canal, la task el cambio.
- **onboarding** — el formulario del wizard (teléfono/OTP, datos personales, `init-loan-request`) se adapta para hidratarse del contexto ecommerce sin cookie.
- **payments** — la task suma las rutas de **cuota inicial** al wizard (`initial-fee-payment.tsx` + `.server.ts`) y `down-payment-validation`; el enganche pasa por acá.
- **architecture** — es la costura `application → legacy-backend + frontend`; "stateless (no cookie)" es la misma dirección que el V1→V2: **el estado y la orquestación viven en el front**, el backend solo expone endpoints de contexto.

## Objetivo
Que el checkout de una tienda entre al wizard nuevo SIN depender de cookie/sesión: el front (`ecommerce/checkout.tsx`) recibe el contrato, y en cada paso rehidrata desde endpoints de contexto del backend (`ecommerce-context.server.ts` → `EcommerceRequestController`). Motivación técnica del "no cookie": el SSR del wizard cruza hosts/ambientes y la cookie se perdía. No re-explica el canal (ver **ecommerce**).

## Ramas y PRs por repo
| Repo | PR | Commit (squash) | Fecha | ¿En main? | ¿develop? | ¿staging? |
|---|---|---|---|---|---|---|
| `legacy-backend` | [#795](https://github.com/Creditop-SAS/legacy-backend/pull/795) — *ecommerce context endpoints for stateless wizard (no cookie)* | `bb14a8ff` | 2026-06-11 | ✅ **SÍ** | ✅ | ✅ |
| `frontend-monorepo` | [#551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551) — *entrada ecommerce web stateless* | `d2242469` | 2026-06-11 | 🟡 **NO** | ✅ | ❌ |

> **Respuesta a "no sé si ya está en main" (verificado 2026-07-18 con `git branch -r --contains`):** el **backend #795 SÍ está en main** (4 archivos, endpoints de contexto). El **frontend #551 NO — solo en develop**. La feature completa NO está en main hasta que #551 promueva. Corroborado por el oráculo: los 5 archivos net-new del front (abajo) NO resuelven contra el índice (que se escanea de main); el 1 net-new del backend SÍ.

## Lo que se hizo
### Backend #795 (`bb14a8ff`, en main) — endpoints de contexto stateless (4 archivos)
- `Modules/Onboarding/App/Http/Controllers/EcommerceRequestController.php` + `App/Services/EcommerceRequestService.php` + `routes/api.php`: exponen el contexto de la `EcommerceRequest` para que el wizard lo consulte sin cookie.
- **NET-NEW**: `App/Http/Requests/FetchEcommerceRequestByUserRequestRequest.php` (fetch del contexto por `user_request`). *(Este sí resuelve en el índice → confirma que está en main.)*

### Frontend #551 (`d2242469`, solo en develop) — la entrada stateless (21 archivos)
- **NET-NEW (5, NO en el índice de main — evidencia de que #551 no promovió):**
  - `app/routes/ecommerce/checkout.tsx` — **la entrada unificada** `/ecommerce/{hash}/checkout` que el nodo `ecommerce` marcaba como "no está en main" (efectivamente: está en develop).
  - `app/server/services/ecommerce-context.server.ts` — el fetch del contexto server-side (reemplaza la cookie).
  - `app/routes/initial-fee-payment.tsx` + `app/server/services/initial-fee-payment.server.ts` — la cuota inicial en el wizard.
  - `app/routes/down-payment-validation.tsx`.
- **Modificados (16):** `entry.client`, `routes.ts`, `route-helpers.ts`, `available-lenders`, `loan-approved`, `bancolombia/no-preapproved`, y el `loan-application-form` (phone/OTP/personal-info/init-loan-request/amount-form/verify-phone-otp/phone-otp.repository) adaptados a la hidratación por contexto.

## Quién hizo qué, y qué lleva tráfico hoy (verificado 2026-09-14)

> **MEDICIÓN · 2026-09-14** — hay **DOS** migraciones de ecommerce al mundo nuevo y se confunden.
> La de esta tarea **todavía no lleva tráfico**.
> **Cómo se vuelve a comprobar:** `git log main --reverse -- <ruta>` sobre `CorbetaCheckoutController.php`
> y `git log main -S'revisionCorbeta' -- WoocommerceController.php`; y
> `git ls-tree -r --name-only main apps/loan-request-wizard/app/routes/ecommerce/` en el front.

| pieza | quién · cuándo | qué migra | ¿en `main`? | ¿lleva tráfico? |
|---|---|---|---|---|
| **Corbeta / Bancolombia retail** — `CorbetaCheckoutController` + el array `revisionCorbeta` `[24,209,210,211,311]` | **jose guzman** · feb-2026 | **sólo** esos 5 comercios | ✅ sí | ✅ **sí** — 2.583 checkouts en 6 meses |
| **Ecommerce web stateless** (ESTA tarea) — PRs [#795](https://github.com/Creditop-SAS/legacy-backend/pull/795) + [#551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551) | **Miguel** (`mig-creditop`) · **11-jun-2026** | la entrada **genérica**, todos los demás comercios | 🟡 backend sí, **front NO** | ❌ **no** |

Los dos commits squash están firmados `mig-creditop <miguel@creditop.com>` con **7 segundos de
diferencia** (`bb14a8ff` 08:37:57 y `d2242469` 08:38:04 del 11-jun-2026): los dos PRs se mergearon juntos.

**Por qué importa la distinción:** es fácil leer «ecommerce ya corre en legacy-backend» y darla por
hecha. Lo que corre es la pieza de Corbeta, que es **por comercio y hardcodeada**. La entrada genérica
—la de esta tarea— sigue esperando que #551 llegue a `main`, y mientras tanto **el 85 % de los checkouts
los sigue sirviendo el monolito**.

**Lo que está en juego, medido el mismo día contra prod:** los **14.160 checkouts en 6 meses** que hoy
pasan por el monolito son exactamente el tráfico que esta migración tomaría — y son los que convierten
al **1,9 %** contra el **18,7 %** del mundo nuevo. Promover #551 no es «terminar una tarea vieja»: es
mover el canal que peor convierte al camino que mejor convierte.

⚠ **Y CORE-30 parece ser el MISMO trabajo que CORE-543.** El texto de CORE-30 en Jira es literal: «*Se
debe pasar el flujo de ecommerce al refactor y validar que funcione de la misma forma en la que está
funcionando actualmente*» — que es la definición de esta tarea. Hoy vive como archivo aparte
(`revision-de-flujo-ecommerce-v1.md`, id 42, 8 puntos, la reporta Manuela Romero) con la pregunta
abierta escrita adentro. **Queda por decidir si se unifican** (el propio archivo dice cómo: poner
`CORE-30` en el `jira:` de acá y borrarlo). Los dos issues están hoy en **🧪 En pruebas**.

## Por qué el enfoque de junio es mejor: el dato del comercio NO se copia

El resumen «sin cookie» se queda corto. Lo que cambia es la **forma del dato**, y la primera línea de
`ecommerce-context.server.ts` lo dice literal:

> *«Stateless ecommerce context from legacy (no cookie): key = erId in the URL (pre-OTP) /
> loan_request_id (post-OTP).»*

- **Abril**: una lectura en la puerta → copia entera al cookie
  (`session.set("ecommerce_session", {ecommerceRequestId, amount, prefill, readonlyFields})`) → todas
  las pantallas leen **la copia**.
- **Junio**: viaja **la llave** (`?erId=` pre-OTP, el `loan_request_id` del path post-OTP) y el dato se
  **relee en su fuente** en cada paso. **Seis loaders** lo piden por su cuenta (`phone-number`,
  `loan-request-form`, `available-lenders`, `lender-result`, `loan-approved`…), sin caché: `fetch` pelado.
  Los dos endpoints que lo habilitan (`ecommerce-request/detail/{id}` y `by-user-request/{ur}`) son los
  que puso #795 y **ya están en `main`**.

⚠ **Y eso es lo que hace posible el handoff a celular.** Cuando `RedirectIdValidationIfDesktop` manda
el QR + SMS para seguir en el teléfono, ese teléfono **no tiene la cookie**: con el enfoque de abril
llegaría sin prefill ni monto. La versión stateless no es sólo más limpia — es la única de las dos que
sobrevive el cambio de dispositivo que el propio producto exige.

⚠ **Costura frágil que conviene conocer — candidata a F-xx.** Las acciones POST pierden el query string,
así que `readErIdFromRequest` cae a leer el `erId` del header **`Referer`**. Funciona porque el wizard
manda `Referrer-Policy: strict-origin-when-cross-origin` (`security-headers.server.ts:139`), que en
navegación *same-origin* envía la URL completa. **Si alguien endurece esa cabecera a `no-referrer` o
`origin`, el prefill pre-OTP se rompe EN SILENCIO** — sin error, simplemente sin datos del comercio.
Es un acoplamiento entre dos archivos que nada declara.
✔ Degrada bien, eso sí: `if (!res.ok) return null` y el catch también, con el comentario *«Non-fatal:
no prefill/context on network error»*. Un fallo del contexto deja al comprador sin prellenado, no lo bloquea.

## Cómo aterrizarlo: rama desde `qa`, y NO son dos PRs por repo

> **MEDICIÓN · 2026-09-14** — `develop` está **772 commits detrás de `main`**: #551 no promueve de ahí
> nunca. `qa` sí llega a main (merge `Qa (#961)`, 4-sep). Y **el backend ya está completo en `qa`**.
> **Cómo se vuelve a comprobar:** `git rev-list --count origin/develop..origin/main`;
> `git log origin/main --merges`; y `git cat-file -e origin/qa:<los 4 archivos de #795>`.

| | estado |
|---|---|
| `develop` | último commit 31-ago · **772 commits detrás de main** — vía muerta |
| `qa` | último commit **hoy** · 17 de main le faltan, 29 propios · **de acá sí se llega a main** |
| backend #795 en `qa` | ✅ **los 4 archivos, con `prefill`/`readonlyFields`** |
| front: los 5 net-new en `qa` | ❌ ninguno |

**Corrección 1 · el backend no necesita PR.** Ya está en las cuatro ramas. Un PR de backend sólo se
justifica si además se rescata la sala de espera (`AdvisorStatusController@checkLoanStatus` +
`loans/ecommerce-check`), que eso sí no está en ninguna.

**Corrección 2 · los dos PRs son por CONCERN, y los dos van en el front.** #551 empaquetó dos cosas:

| concern | archivos | líneas |
|---|---|---|
| **entrada stateless de ecommerce** | `ecommerce/checkout.tsx` +90 · `ecommerce-context.server.ts` +60 · y ~16 retoques | ~336 |
| **cuota inicial** (payments) | `down-payment-validation.tsx` +109 · `initial-fee-payment.tsx` +93 · `.server.ts` +47 | **249 (43 %)** |

`checkout.tsx` **no menciona** la cuota inicial; se tocan sólo en `routes.ts`, `route-helpers.ts` y
`available-lenders.tsx`. Son separables. Y si van en un commit único juntas, revertir un fallo del
checkout en prod se lleva puesta la cuota inicial.

**El orden:** (1) ✅ **HECHO** — rama `feat/ecommerce-stateless-checkout` desde `qa`, **PR
[#997](https://github.com/Creditop-SAS/frontend-monorepo/pull/997)**, un commit, 16 archivos
(+371/−26). Build en verde; `typecheck` da 220 errores preexistentes de `qa` y **ninguno** en los
archivos del cambio. ⚠ Y el camino dejó **dos cosas que sólo aparecen rehaciéndolo**: el build atrapó
que `routes.ts` se había traído las rutas de la cuota inicial sin sus archivos, y —lo caro— el PR
original mandaba `ecommerce_request_id` en **snake_case al endpoint v1**, mientras `qa` ya usa
OnboardingV2, que lo valida como **`ecommerceRequestId`**: copiado tal cual, el backend lo ignoraba, la
solicitud nacía sin vincular al pedido y **el comercio nunca recibía el veredicto**, sin ningún error
visible. (2) Con PR 1 en `qa`, rama nueva desde `qa` → PR 2
con la cuota inicial — secuencial, **sin apilar ramas**. (3) La sala de espera, aparte y después: es
rescate, no migración.

⚠ **Y un bloqueante que no es de código:** aunque el PR llegue a `main`,
`originaciones.creditop.com/ecommerce/{hash}/checkout` tiene que **responder en prod** para que el
redirect de borde sirva. Eso es deploy/ingress del front.

## Los CUATRO PRs de la migración, y qué rescatar (2026-09-14)

> **MEDICIÓN · 2026-09-14** — los PRs de abril (#503/#363) **siguen ABIERTOS**, no cerrados, y tienen
> **dos piezas que no existen hoy en ningún lado**.
> **Cómo se vuelve a comprobar:** `gh pr view <n> --json state,baseRefName,files` en cada repo, y
> `git grep "ecommerce-check" main` / `git ls-tree -r --name-only origin/develop …/routes/ | grep waiting`.

| PR | estado | base | tamaño | qué es |
|---|---|---|---|---|
| `legacy-backend` [#503](https://github.com/Creditop-SAS/legacy-backend/pull/503) | 🟠 **ABIERTO** | ← **main** | 15 arch · +295/−31 | «checkout integration», abril |
| `frontend-monorepo` [#363](https://github.com/Creditop-SAS/frontend-monorepo/pull/363) | 🟠 **ABIERTO** | ← develop | 15 arch · +342/−57 | idem, front |
| `legacy-backend` [#795](https://github.com/Creditop-SAS/legacy-backend/pull/795) | ✅ merged | ← develop | 4 arch · +131/−5 | endpoints de contexto stateless |
| `frontend-monorepo` [#551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551) | ✅ merged | ← develop | 21 arch · +585/−31 | entrada stateless |

*(Corrige lo que decía este archivo: «quedaron sin merge» se leía como cerrados. Están abiertos, y #503
apunta a `main` directo.)*

**Cuál resuelve mejor: junio (#795+#551), y la razón está en el código de abril.**
`checkout-redirection.tsx` de #363 guarda el contexto en una **cookie**
(`session.set("ecommerce_session", {…})`) — exactamente la cookie que se perdía cruzando hosts y que
motivó el enfoque stateless. Abril no está superado por estilo: lo está por el bug que lo originó.

**Lo rescatable, y es concreto — dos piezas que NO están ni en `main` ni en `origin/develop`:**
1. **Backend #503**: `GET loans/ecommerce-check/{user_request_id}` → `AdvisorStatusController@checkLoanStatus`
   (38 líneas). Verificado: `git grep "ecommerce-check" main` no devuelve nada.
2. **Front #363**: `ecommerce-continue.tsx` montado en la ruta **`waiting-room`** (90 líneas) — polling
   cada 5 s hasta `user_request_status_id === 11`, y al aprobar pinta `RequestStatus`.

Juntas son **la sala de espera del veredicto**, y hoy eso existe **sólo para Bancolombia**
(`bancolombia/ecommerce/ecommerce-loan-processing.tsx`). Engancha con lo medido en prod: **2.167
solicitudes del monolito quedan en estado 3 «Seleccionó entidad»** — eligieron entidad y no volvieron.
Ese es el hueco que la sala de espera tapa.

El resto de #503 (TusDatos, DocumentSigning, OtpValidation, RequestCompletion, AlliedProductService,
Experian, BancolombiaBnpl) son cambios dispersos de abril: hay que revisarlos uno por uno contra `main`
antes de rescatarlos — buena parte probablemente ya llegó por otras vías.

### El redirect de borde en `aliados.creditop.com/checkout/*`

Lo verificado que **da la razón** a la propuesta: el prerrequisito bloqueante es real
(`/ecommerce/{hash}/checkout` está en `origin/develop`, **no en `main`** → 404 en prod); el 302 y el
query verbatim son correctos, y el código ya lo asume — el monolito documenta que reenvía
`getQueryString()` con los `+` como `%20` y que legacy los revierte aguas abajo
(`str_replace(' ', '+', …)` en `unserializeCreateEcommerceRequest`). Re-encodear en el borde rompería
el base64.

⚠ **Lo que falta en la propuesta: la regla `/checkout/*` SECUESTRA a Corbeta.** El monolito no manda a
todos al mismo destino — para los allieds `[24,209,210,211,311]` llama a `buildLegacyCheckoutRedirectUrl`,
que resuelve `NewFrontendUrlService::ecommerceResolveCheckout` (→ `/bancolombia/ecommerce/resolve-checkout`)
o cae a `legacy-api.creditop.com/api/onboarding/checkout/{hash}`. Un 302 de borde plano los mandaría a la
entrada **genérica**, que no conoce el flujo Corbeta — y ése es justo el tráfico que funciona: **2.583
checkouts al 18,7 %** contra el 1,9 % del resto.

**Hashes de sucursal a excluir** (los que tienen credencial ecommerce, medido en prod):
`f61bb559` Alkosto (2.193 checkouts/6m) · `9909ad59` Alkomprar (142) · `88cbd88b` K-TRONIX (138) ·
`b8e4f63b` Kalley (110) · y los de Creditop 24 sin tráfico: `bb534d6a`, `96f5da12`, `eeddcc1c`,
`638bd7f1`, `4e803739`, `d9c122ff`.

✔ **Y un dato que reduce el alcance del problema:** el plugin de Woo **ya está migrado** — su ajuste
`base_url` tiene por defecto `https://originaciones.creditop.com` y arma el path nuevo
`/ecommerce/{hash}/checkout` (v1.0.20, `class-creditop-gateway.php:508`). El redirect de borde es para
la **base instalada vieja**, que es exactamente el planteo; pero conviene decirlo, porque abre una
segunda palanca (empujar la actualización del plugin) para los comercios que sí actualizan.

## Hilo nuevo (2026-09-14): ¿y si el flujo sale de CreditOp y entra a la tienda?

La pregunta que abrió este hilo es de la parte ecommerce: **que el comprador no se vaya de la tienda**.
Se evaluaron dos formas y sólo una sobrevive.

**Descartada — iframe.** No por gusto: está bloqueado en `main`, por diseño, en cuatro lugares
independientes.

1. El wizard manda `X-Frame-Options: DENY` **siempre** y `frame-ancestors 'none'`, con el comentario
   literal «el wizard nunca se embebe en iframe (confirmado)» —
   `frontend-monorepo/apps/loan-request-wizard/app/utils/security-headers.server.ts:122,137`.
2. El monolito manda `SAMEORIGIN` + `frame-ancestors 'self'` —
   `legacy-application/app/Http/Middleware/SecurityHeaders.php:38,101`.
3. La cookie `__session` del wizard es `sameSite: "lax"`: en iframe cross-site **no viaja**, y sostiene
   `ownedLoanRequests`, la marca de etapa y el `sessionId` de trazas.
4. Lo posterior a elegir entidad no es framable por nadie, y el repo ya lo midió dos veces:
   `routes/entidad/simulador.tsx:276` (el simulador de BCP responde `SAMEORIGIN` y el frame queda en
   blanco) y `submit-post-redirect.ts:8` («no sirve fetch/XHR ni un iframe»).

**Viva — SDK en el DOM del comercio.** Esquiva 1-3 (el DOM sería del comercio, no un frame ajeno) y
acepta 4 como su frontera natural.

### El prototipo

`tablero/data/artifacts/ecommerce-stateless.sdk-en-la-tienda.html` — un archivo, sin build ni
dependencias: una tienda falsa con el «SDK» adentro, que maneja el flujo por API y pinta el listado
dentro de la página. Se sirve con `make soporte-qa` y se abre en
`http://localhost:5199/ecommerce-stateless.sdk-en-la-tienda.html` — **no con doble clic**: en `file://`
el Origin es `null` y la prueba deja de parecerse a una tienda.

El contrato salió de los repositorios del wizard en `main`, no de suposiciones. ⚠ Y ahí apareció que
**el wizard ya migró parte a OnboardingV2** (`api/v2/onboarding/otp-auth/validate`, códigos `OBV22xxx`),
así que el nodo `onboarding` de `context/` quedó viejo donde dice que G3 no tiene consumidores.

### Lo medido (2026-09-14, local, origen `:5199` → backend `:80`)

Las tres llamadas dieron **200** — o sea, **una página de otro origen puede manejar el flujo hasta el
listado hoy**, sin secreto de servidor: `phone/register` → `otp-auth/validate` (`OBV22005`, uReq 466543)
→ `lenders-v2`.

⚠ **Pero salieron 6 entidades, no 7.** El mismo comercio por `make harness-listado` da 7. La que falta es
**CrediPullman (77, rt=2)** — la de CreditopX. No es un bug: el harness **inyecta** ingreso y score antes
de pedir el listado; acá el usuario es temporal y no tiene ninguno, así que rt=2 no calcula cupo y se
cae. **Mostrar cupo en la tienda sin pedir datos personales no muestra la oferta de CreditopX**, que es
justo donde el comercio pone capital y CreditOp cobra comisión. Hay que decidirlo antes de diseñar la
pantalla.

### Qué datos del usuario ya tiene el comercio (2026-09-14)

`EcommerceRequestService` lee del contrato base64 y devuelve **exactamente seis**: `email`, `phone`,
`firstName`, `lastName`, `documentNumber`, `documentType` — en `main`, en las dos puntas (`ERS003` al
entrar y `ERS005` al rehidratar). WooCommerce manda el pedido entero y deja mapear nombres de campo
personalizados (`config`: nombres, apellidos, documento, dirección, ciudad, teléfono); VTEX normaliza
a los nombres canónicos y manda `config: []`.

**Y no es casualidad que sean esos seis: cubren los CINCO obligatorios de `personal-info`**
(`document.type`, `document.number`, `email`, `name`, `surname`) más el teléfono del registro.
`document.expedition` y `birth` son **`nullable`** en el validador — la expedición sólo se exige donde
`should_collect_expedition_date` la pide. O sea: **para un comercio que mapee todo, el piso de fricción
puede ser cero.** *(Corrige lo que dije antes en este mismo hilo, que el piso nunca era cero.)*

**Cuatro trampas verificadas:**
1. **`address` y `city` viajan y se tiran** — el plugin las deja mapear, llegan en `config`, y `prefill`
   no las lee. `personal-info` acepta `address`.
2. **El fallback por config de *apellidos* está muerto**: el plugin guarda la clave como `surname` y
   `getBillingField` pregunta por `$config->last_name`. Un comercio que renombró ese campo **no lo puede
   mapear**; funciona sólo porque el `billing` nativo de Woo ya trae `last_name`.
3. **`document_type` no es mapeable** — no está entre los seis del plugin.
4. **Los dos endpoints difieren en el default**: `create` devuelve `documentNumber ?? ''` y
   `documentType ?? 'CC'`; `detail` no pone default. VTEX también quema `'CC'` (`billingFrom:213`).
   Engancha con #71 y #68.

✔ El front ya se defiende: `real()` descarta vacíos y placeholders `---`, y `lockedFields =
Object.keys(prefill)` bloquea **sólo lo que llegó** — ignora el `readonlyFields` del backend. Vive en
**develop**, no en main.

### Que el formulario reaccione a lo que recibe: ya está a medio cablear

Tres piezas vivas y una tirada:
1. **Reacciona a quién es el comercio**: `GET /api/v2/onboarding/personal-info/{branch}/config` →
   `visibleOptionalFields`, y el form **oculta** (`{showBirthDate && …}`), no sólo bloquea.
2. **Reacciona a qué mandó la tienda**: `lockedFields`. El lock es por **CSS, no `disabled`** — el
   comentario dice por qué: «*which would drop the value from the submit*».
3. **Dos flags que el backend ya manda y el front tira**: el docblock de `GetPersonalInfoConfigService`
   dice que v1 devuelve `should_collect_expedition_date` y `should_collect_employment_info` y que «*the
   wizard's own schema does not even parse*» — y ya existe `shouldCollectExpeditionDateForAllied`
   (`OnboardingController:1800`).

⚠ **Pero el recálculo va en el BACKEND, no en el front.** El mismo archivo trae la advertencia: «*two
independent readings of "does this merchant need a stratum" is how a screen ends up not asking for
something the save then rejects*». Si el form decide solo qué saltear y `StorePersonalInfoService`
valida por su cuenta, el guardado rechaza lo que la pantalla nunca pidió. Y hay una segunda razón:
`should_use_manual_birth_date` no sale del comercio sino de **si la sucursal ofrece una entidad que lo
exige** — el front no puede saberlo.

Orden propuesto, de barato a caro: **(a)** parsear `should_collect_expedition_date`, que ya viaja;
**(b)** mover la decisión al backend espejando el gate de escritura, como se hizo con el estrato;
**(c)** recién ahí evaluar el form dinámico (`form-service`, `@creditop/backend-driven-form`,
`packages/form-engine` ya existen).

### Dos trampas que costaron tiempo hoy, y no eran del producto

- ⚠ **El contenedor local corre el WORKING TREE, no `main`.** El prototipo daba **HTTP 500 / `OBV21002`**
  en `personal-info`. La causa: la rama `feat/lenders-tabla-cards` trae el validador viejo con `$this`
  dentro de un método `static` («Using $this when not in object context»), que revienta en el closure de
  `document.type`. **En `main` está arreglado** (captura `$partnerBranchId` en variable) y el propio
  archivo documenta ese mismo fatal como un bug ya corregido una vez. No es un defecto de `main`: es la
  rama local atrasada.
- ⚠ **En local, la causa de un `OBV21002` es INVISIBLE.** `runServiceMethod` atrapa todo y loguea con el
  tracer → `Log::channel('loki')` → `host.docker.internal:3100`, que en local no existe; el handler se
  traga su propio fallo y **el fallback a `Log::channel()` nunca dispara**. Para verla hay que levantar
  un receptor en el 3100 y repetir la llamada. *(Candidato a F-xx.)*
- Y un detalle del contrato: el wizard manda `document.number` como **número**
  (`Number(input.documentNumber)`), no string.

### El artefacto para producto

`tablero/data/artifacts/ecommerce-stateless.experiencia-para-producto.html` — mismo tema, otro público:
sin códigos, sin endpoints, sin `main` vs rama. Muestra la experiencia del comprador y **la única
palanca**: seis interruptores de «qué nos manda esta tienda» y una ficha de producto que se re-dibuja
mostrando cuánto tiene que escribir. No pega contra la API (es simulado, para que ande en cualquier
demo). Cierra con las tres decisiones que son de producto. Publicado también como artifact:
<https://claude.ai/code/artifact/00755787-ad1c-4f46-9dcf-61f47298ebf0>

### Qué destraba la entidad rt=2 — y no son los datos del comercio

> **MEDICIÓN · 2026-09-14** — ¿dar los datos personales hace aparecer a **CrediPullman (77, rt=2)**?
> **No: lo que la destraba es la consulta al buró.**
> **Cómo se vuelve a comprobar:** corré el flujo por API contra local tres veces, mismo comercio
> (`e9409aff`) y mismo monto (2.000.000), variando **sólo** el endpoint de datos personales —
> `phone/register` → `api/v2/onboarding/otp-auth/validate` (OTP `1111`) → el endpoint bajo prueba →
> `lenders-v2`; después mirá los `user_field_values` 29/87/160 del usuario.

Los tres resultados:

| camino | respuesta | campos EAV 29/87/160 | listado | rt=2 |
|---|---|---|---|---|
| **sin** guardar datos | — | ninguno | **6** | ✗ |
| **v2** `api/v2/onboarding/personal-info` | `OBV21001` ok | **ninguno** | **6** | ✗ |
| **v1** `api/onboarding/loan-application/personal-info` | *«laboral information obtained **via risk centrals**»* | **29=Empleado · 87=2320000 · 160=no** | **7** | ✓ |

**La causa es el buró, no el dato del comercio.** El v2 «recoge y persiste, y nada más» —su propio
docblock lo dice y explica por qué: el v1 corría la cascada AgilData → Mareigua y disparaba Experian
dentro de la misma llamada, así que llenar el formulario **compraba consultas de buró**, y con el
pipeline de KYC encendido se pagaban dos veces (run `01a036f7`: legacy compró Experian 22:29:11, el
pipeline lo recompró 22:29:52). En el camino nuevo la identidad la resuelve el pipeline, que es «el
dueño del orden, del control de frescura y **del dinero**».

**Consecuencia para el SDK, y es la decisión de producto de verdad:** las seis entidades externas salen
con celular + OTP y nada más. La del propio comercio —la única con capital del comercio y comisión de
CreditOp— exige **una consulta de buró que se paga por comprador que la dispare, califique o no**. No es
«¿pedimos datos o no?»: es **«¿pagamos buró dentro de la tienda, y con qué gatillo?»**.

⚠ Y ojo con el atajo: usar el **v1** desde el SDK para que aparezca la rt=2 vuelve a comprar el buró en
el lugar equivocado, que es exactamente lo que el v2 vino a arreglar.

**Cómo se midió** (reproducible): `phone/register` → `api/v2/.../otp-auth/validate` (OTP `1111` en local)
→ el endpoint de datos personales bajo prueba → `lenders-v2`, y después los `user_field_values`
29/87/160 en la base. Para el caso v2 hizo falta aplicar **temporalmente** la versión de `main` de
`StorePersonalInfoRequest.php` sobre el working tree (la rama `feat/lenders-tabla-cards` trae el
validador viejo con `$this` en un método `static`) y **restaurarla al terminar** — verificado: la rama
quedó en `4f9c9319` y el working tree limpio. Y el v1 exige **fecha de nacimiento**: sin ella devuelve
`ONB005`.

### Lo que el prototipo NO resuelve

- `auth.cognito` (`ResolveCognitoUser`) lee `x-user-id` / `x-cognito-identity-id` de headers y **nunca
  rechaza**; CORS es `allowed_origins: ['*']`. Hoy está contenido porque quien llama es el SSR del
  wizard, dentro del cluster. Un SDK publica ese contrato.
- No existe clave pública por comercio, ni allowlist de origen, ni rate limit por origen. Lo único hoy
  es el rate limit de personal-info (4/hora por documento).
- Los módulos del wizard **no son librerías**: `@creditop/lenders-marketplace` y
  `@creditop/loan-application-form` tienen `main: "./src/index.ts"` (TS crudo, sin `dist` ni `exports`)
  y declaran `react-router` como peerDependency. El único paquete con forma distribuible es
  `packages/form-engine` (tsup + `dist` + `exports`) — es el molde si se sigue por acá.
- Sería la **cuarta** superficie sobre el mismo contrato (G1 · G2 · G3 · SDK).

## Cómo probar / validar
- Flujo E2E de ecommerce: `bin/ecommerce` de **harness** (ver nodo **harness**). Como el front vive en develop, apuntá el harness a **dev/develop**, no a main.
- ⚠ Gotcha (nodo `ecommerce`): la entrada ecommerce se degrada en local por Mixed Content — el motivo mismo del rediseño stateless.
- Verdicto: el wizard rehidrata el monto/prefill desde `ecommerce-context.server.ts` sin cookie y cierra a Estado 11.

## Bitácora
- **2026-04** — 1er intento "web-origination" (PRs 503/363, rama `feature/onboarding/ecommerce-web-origination`): quedó **sin merge**, superado por el enfoque stateless.
- **2026-06-11** — mergeados los squash `bb14a8ff` (#795) y `d2242469` (#551).
- **2026-07-18** — registrado como task (corrige la versión previa de este nodo, que apuntaba por error a 503/363). Estado de merge verificado contra las ramas remotas: backend en main, front en develop. Superficie = 20 archivos que resuelven; 5 net-new del front + los adds van en prosa.
- **2026-09-14** — se le ata **CORE-543** («Inicio paso refactor ecommerce»), que estaba en el sprint sin archivo en el tablero. Se abre el hilo «el flujo dentro de la tienda»: descartado el iframe contra `main` (4 bloqueos), prototipado el SDK y **corrido** — tres llamadas 200 desde otro origen, 6 entidades y no 7, y falta la rt=2. Re-verificado también que #551 sigue **sin** llegar a `main` (está MERGED contra `develop`).

## Pendientes
- [ ] ~~Promover #551 (front) a main~~ → **no promueve: `develop` está 772 commits detrás de `main`.** El camino es rama nueva desde `qa` (ver §«Cómo aterrizarlo»). El pendiente sigue vivo, cambia el método.
- [ ] ~~viejo~~ **Promover la entrada stateless** — hoy solo en develop; hasta entonces la entrada stateless no corre en prod. ⚠ **Medido el 2026-09-14: son 14.160 checkouts en 6 meses esperando del otro lado**, los que hoy convierten al 1,9 % contra el 18,7 % del mundo nuevo. Es el pendiente con más impacto de esta tarea.
- [ ] **Rescatar la sala de espera de abril** — `AdvisorStatusController@checkLoanStatus` (#503) + `ecommerce-continue.tsx` en `waiting-room` (#363). No existen en main ni develop, y tapan el hueco de las 2.167 solicitudes que quedan en estado 3.
- [ ] **Cerrar o reabastecer #503 y #363** — siguen ABIERTOS. Lo demás de #503 hay que revisarlo archivo por archivo contra main antes de rescatar.
- [ ] **Redirect de borde en `aliados.creditop.com/checkout/*`** — pedido a Infra, 302 con query verbatim. ⚠ Bloqueado por que `/ecommerce/{hash}/checkout` llegue a `main`, y **tiene que excluir los hashes de Corbeta** o secuestra el tráfico que hoy convierte al 18,7 %. Lista de hashes en §«Los CUATRO PRs».
- [ ] Extender el cutover al resto del ecommerce no-Corbeta (sigue el array `[24,209,210,211,311]` en `WoocommerceController` del monolito).
- [ ] Borrar la lógica ecommerce duplicada en `application` una vez completo en main.
- [x] ~~Decidir el alcance del SDK~~ → **medido, y la pregunta era otra**: no es «¿pedimos datos?» sino **«¿pagamos una consulta de buró dentro de la tienda, y con qué gatillo?»**. Ver §MEDIDO. Queda decidirlo, ya con el dato.
- [ ] **Medir cuántos comercios ecommerce mapean el campo documento** (`allied_ecommerce_credentials` + los `ecommerce_requests.data` ya guardados). Es lo que decide si la experiencia sin fricción es real o es una demo: sin documento no hay identificación y la entidad del propio comercio no aparece.
- [ ] Parsear `should_collect_expedition_date` en el wizard — el backend ya lo manda y el schema del front no lo lee.
- [ ] Arreglar el mapeo muerto de apellidos (`surname` en el plugin vs `last_name` en `getBillingField`) y decidir si `address`/`city` dejan de tirarse.
- [ ] Promover a F-xx: el `erId` pre-OTP viaja por el header `Referer` y depende de que `Referrer-Policy` siga en `strict-origin-when-cross-origin`; endurecerla rompe el prefill en silencio.
- [ ] Promover a F-xx: en local, un `OBV21002` no deja rastro (tracer → Loki inexistente, sin fallback al log de Laravel).
- [ ] **Antes de cualquier piloto**: clave pública por comercio + allowlist de origen + rate limit por origen en `api/onboarding`. Hoy no hay nada de eso.
- [ ] Medir cuántos comercios ecommerce hay en prod y por cuál mundo entran (el cutover es el array quemado `[24,209,210,211,311]`). Si el grueso sigue en el monolito, un SDK contra `api/onboarding` le sirve a la minoría.
- [ ] **Decidir si CORE-30 y CORE-543 se unifican** — el texto de CORE-30 describe este mismo trabajo. Ver §«Quién hizo qué».
- [ ] Corregir el nodo `context/…/onboarding`: dice que G3 (`OnboardingV2`) no tiene consumidores, y el wizard en `main` ya le pega a `api/v2/onboarding/otp-auth/validate`.

## Enlaces
- PRs: [legacy-backend #795](https://github.com/Creditop-SAS/legacy-backend/pull/795) · [frontend-monorepo #551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551).
- Canal: **ecommerce** · fase: **onboarding** · enganche: **payments** · costura: **architecture**.


## Rutas del código (20)
- legacy-backend/Modules/Onboarding/App/Http/Controllers/EcommerceRequestController.php
- legacy-backend/Modules/Onboarding/App/Services/EcommerceRequestService.php
- legacy-backend/Modules/Onboarding/routes/api.php
- legacy-backend/Modules/Onboarding/App/Http/Requests/FetchEcommerceRequestByUserRequestRequest.php
- frontend-monorepo/apps/loan-request-wizard/app/entry.client.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes.ts
- frontend-monorepo/apps/loan-request-wizard/app/routes/bancolombia/no-preapproved.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/loan-application-form/loan-request-form.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/loan-application-form/otp-verification.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/loan-application-form/phone-number.tsx
- frontend-monorepo/apps/loan-request-wizard/app/routes/loan-approved.tsx
- frontend-monorepo/apps/loan-request-wizard/app/utils/route-helpers.ts
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/amount-form.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/forms/personal-info-form.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/init-loan-request.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/phone-number-step-form.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/components/phone-number.tsx
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/lib/application/verify-phone-otp.uc.ts
- frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/lib/infrastructure/phone-otp.repository.ts
