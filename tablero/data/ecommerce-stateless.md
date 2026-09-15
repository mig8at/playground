---
id: 6
title: "Ecommerce web stateless"
stage: work
created: "2026-07-21T10:30:30-05:00"
context_nodes: [ecommerce, onboarding, payments, architecture]
jira: [CORE-30]
jira_title: "Revisión de flujo ecommerce V1"
ramas: ecommerce-stateless-checkout, sala-de-espera-ecommerce, ecommerce-*stateless*
---

# Ecommerce web stateless (→ wizard sin cookie)
(migrado del nodo-tarea `ecommerce-web-stateless` del árbol de context, 2026-07-21)

CUÁNDO APLICA: Cuando la tarea toca la migración de la originación de ecommerce (VTEX/Woo/self) al wizard STATELESS (sin cookie) en legacy-backend + frontend: PRs 795 (backend, en main) / 551 (frontend, en develop), el entry ecommerce/checkout, los endpoints de contexto, o el estado 'backend en main, front aún en develop'.

## Si retomás esto sin contexto, empezá acá

**El trabajo llegó a `main` y lo sacaron.** Los tres PRs del front (#997, #1005) subieron con
`Qa (#1012)` el 14/9 y Abel los revirtió esa misma noche con **#1013** (`77796a4f`). El backend #1392
**no** se revirtió y sigue en `main`.

**El motivo del revert es un defecto real y ya está diagnosticado**, no hace falta re-investigarlo: en
el flujo del **asesor**, con una cuota inicial > 0, elegir entidad rebota a `/solicitar`. La ruta
`initial-fee-payment` se registró sólo en el árbol público y React Router la matchea ahí con
`flow="merchant"`, que redirige a `/` → `/merchant` → `/solicitar`. Los cinco eslabones, medidos, en
§«El rebote a `/solicitar`».

⚠ **El defecto sigue vivo en `qa`** — el revert fue sobre `main`. Cualquier promoción futura lo vuelve
a subir si no se arregla antes.

**El próximo paso es:** medir contra el backend si `POST /api/loans/requests/initial-fee-payment/{ur}`
sigue devolviendo **403** para una entidad `rt=2` (lo estaba en junio). De esa medición depende el
arreglo: si ya no 403ea, alcanza con registrar `initial-fee-payment` y
`down-payment-validation/:transaction_id` en el árbol `merchant` de `routes.ts`; si sigue, además hay
que guardar el `if` de la línea 637 para que las in-platform no vayan a Wompi.


# Ecommerce web stateless (→ wizard sin cookie) · task
> **estado (2026-09-15):** 🔴 **llegó a `main` y lo REVIRTIERON.** El front entró con `Qa (#1012)`
> (`f8a802b6`) y Abel lo sacó el 14/9 20:52 con
> [frontend-monorepo#1013](https://github.com/Creditop-SAS/frontend-monorepo/pull/1013) (merge
> `77796a4f`), que deshace **#997 y #1005 enteros** — 27 archivos, −1.062 líneas.
>
> **La causa es un defecto real del PR, no un accidente del merge**, y está diagnosticada y medida en
> §«El rebote a `/solicitar`». Lo reportó Joel (QA) por DM el 15/9 08:38: *«cuando uno da click en el
> botón de "Validar Pre aprobado" en la tarjeta del lender … lo devuelve a uno a la pantalla de
> solicitar»*.
>
> ⚠ **Y el revert dejó las dos puntas desparejas otra vez:** sólo se revirtió el **front**. El backend
> [#1392](https://github.com/Creditop-SAS/legacy-backend/pull/1392) **sigue en `main`** (la ruta
> `ecommerce-status` resuelve contra `origin/main`). Es la misma forma del par de junio —backend
> adelante, front atrás— repetida tres meses después.
>
> `qa` **conserva los tres PRs**: el revert se hizo sobre `main`, no sobre `qa`. O sea que el defecto
> **sigue vivo en `qa`**.
>
> ⚠ **PERO una promoción `qa` → `main` NO lo vuelve a subir — y eso es un problema, no un alivio.**
> Medido el 2026-09-15: `merge-base(origin/main, origin/qa)` **es la punta de `qa`**, o sea que `qa` ya
> está entera dentro de `main`; y `6fa13ae5` (#997) y `f443ecad` (#1005) **son ancestros de `main`**
> aunque su contenido no esté. Es el problema clásico de revertir un merge: git los da por mergeados,
> así que **ninguna promoción futura los trae de vuelta**. El revert es pegajoso.
>
> **Consecuencia práctica para el arreglo:** no alcanza con corregir en `qa` y esperar la promoción. Para
> que esto vuelva a `main` hay que **revertir el revert** (`git revert 77796a4f`) o rehacer el cambio
> como commits NUEVOS. Y las dos piezas —la reposición y el arreglo del rebote— conviene que viajen
> juntas, o `main` queda con la ventana rota abierta entre una y otra.
>
> **La tarea no gradúa a `context/`:** la vara del árbol es `main`, y ahí hoy no hay nada del front.
>
> ⚠ **Y `make tareas-ramas` va a seguir diciendo «en qa, main» para las dos ramas, y es FALSO.** Un
> revert no borra commits: los de #997 y #1392 siguen siendo ancestros de `main`, así que
> `git merge-base --is-ancestor` da verdadero aunque el código ya no esté. Es la **inversa** del falso
> «falta» que este mismo archivo anotó para #551 — y el desempate es el mismo: **el contenido, no el
> SHA**. Acá, `git ls-tree -r --name-only origin/main -- …/ecommerce/checkout.tsx` → vacío.
>
> Los PRs viejos quedan como historia: backend [#795](https://github.com/Creditop-SAS/legacy-backend/pull/795)
> (✅ en main desde junio) · frontend [#551](https://github.com/Creditop-SAS/frontend-monorepo/pull/551)
> (🟡 murió en `develop`, 772 commits detrás — ver §«Cómo aterrizarlo»).
>
> Llevar la originación de ecommerce (VTEX / WooCommerce / self) al **wizard STATELESS (sin cookie)**: el front arma la entrada `ecommerce/checkout` y lee el contexto de la solicitud vía endpoints de contexto del backend (no por sesión/cookie). Es la versión que reemplazó al intento anterior "web-origination" de abril (PRs 503/363, que quedaron sin merge).

## El rebote a `/solicitar`: por qué se revirtió de `main` (2026-09-15)

> **MEDICIÓN · 2026-09-15** — el síntoma que reportó QA es **del asesor**, no de ecommerce, y lo
> produce una ruta que #997 registró en **un solo** árbol de rutas.
> **Cómo se vuelve a comprobar:** los cinco eslabones de abajo se leen en `origin/qa`, y el único que no
> se lee —el matcheo— se mide llamando a `matchRoutes` de **react-router 7.13.1** (la versión que
> declara `apps/loan-request-wizard/package.json`) con una réplica del árbol de `routes.ts`.

**El síntoma:** el asesor elige una entidad, hace click en **«Validar Pre aprobado»** y el wizard lo
devuelve a `/solicitar`, la primera pantalla. Sin error, sin toast, sin nada en consola.

**La cadena, eslabón por eslabón:**

1. **«Validar Pre aprobado» es el copy de `response_type` 2 y 3**
   (`lender-response.mapper.ts:137-140`). O sea CreditopX / in-platform.
2. El action de `available-lenders.tsx` (qa:637) hace
   `if (Number(initial_fee) > 0) return routeHelpers.redirect(ROUTE_PATHS.initialFeePayment(…))`.
   Ese `initial_fee` **no lo pide la entidad: lo escribe el asesor** en el campo del listado
   (`formData.get("initial_fee")`, qa:384), que aparece cuando el comercio tiene el toggle
   `allied.initial_fee` prendido.
3. `routeHelpers.redirect` **prefija el flujo**: en el árbol del asesor `params.flow` no existe, así
   que `createRouteHelpers` cae a `detectRouteContext(pathname)` → `merchant`, y el destino queda
   **`/merchant/{hash}/{lrid}/initial-fee-payment`**.
4. **Esa ruta no existe en el árbol del asesor.** #997 la agregó —junto con
   `down-payment-validation/:transaction_id`— **sólo** bajo `route(":flow", "layouts/public-layout.tsx")`.
   El bloque `route("merchant", "layouts/default-layout.tsx")` no la tiene.
5. Y acá está lo que no se ve leyendo: **React Router no tira 404, se cae al árbol de al lado.** Como
   `:flow` es dinámico, `/merchant/…/initial-fee-payment` **matchea `public-layout` con
   `flow = "merchant"`**. Medido:

   | URL | rama que matchea |
   |---|---|
   | `/merchant/<h>/<id>/lenders` | `merchant-root` → … → `merchant-lenders` ✅ |
   | `/merchant/<h>/<id>/initial-fee-payment` | **`public-layout`** → … → `pub-initial-fee` 🔴 |
   | `/merchant/<h>/<id>/down-payment-validation/tx1` | **`public-layout`** 🔴 |
   | `/merchant/<h>/<id>/ruta-inexistente` | **SIN MATCH (404)** ← el control |

   La última fila es la que prueba que no es «cualquier ruta rara rebota»: una ruta que no existe en
   **ningún** árbol sí da 404. Rebota exactamente la que #997 puso en el árbol equivocado.
6. `public-layout.tsx:20-22`: `if (flow !== "ecommerce" && flow !== "self-service") return redirect("/")`.
7. `home.tsx` → `redirect("/merchant")`.
8. `default-layout.tsx:80,108`: sin `params.partner_hash` →
   `redirect("/merchant/{userAlliedBranchHash}/solicitar")`.

→ **`/solicitar`.** Cuatro 302 legítimos encadenados: por eso no hay error en ningún lado y por eso
se lee como «se devuelve al comienzo» y no como «se rompió».

### Lo que esto significa para el alcance

⚠ **No es sólo rt=2/3.** El `if` de la línea 637 está **antes** de las ramas de renting/RTO, Nequi,
`validateLenderOtp`, `postRedirect` y modal. Sólo lo esquivan las dos que van arriba —gestión manual
(`path_id === 3`) y autogestión (`continueUrl`)—. O sea: **en el flujo del asesor, poner una cuota
inicial > 0 rompe la selección de casi cualquier entidad.** «Validar Pre aprobado» es lo que Joel
tocó, no el límite del defecto.

✔ **Y por eso ecommerce no lo ve:** #997 fuerza `initialFeeAllowed = false` cuando `isEcommerce`, así
que ahí `initial_fee` llega en 0 y el `if` no dispara. El canal que el PR venía a arreglar es el único
inmune; el que rompe es el que no estaba en su título.

### Ya nos había pasado — y el arreglo de entonces ya no aplica

El mismo rebote se diagnosticó el **2026-06-26** sobre la rama local `continue`: mismo `if`, misma
línea, mismo síntoma, mismo canal. El arreglo de entonces fue guardar la línea con
`&& !response.data.standBy`. **Hoy ese arreglo no se puede copiar: `standBy` ya no existe** — cero
ocurrencias en `apps/loan-request-wizard` y `modules/loan-request-wizard`. El camino de CreditopX hoy
es la rama `showModal && isNil(url)` → `/continue?url=qrUrl` (qa:810).

⚠ **Lo que NO se re-verificó hoy** y vale para decidir el arreglo: en junio quedó medido que el
backend **403ea** `POST /api/loans/requests/initial-fee-payment/{ur}` para CreditopX, porque esa cuota
inicial se cobra **in-platform** (continue → confirmation → `down-payment-validation`), no por Wompi.
Si eso sigue siendo cierto, **registrar la ruta en el árbol del asesor no alcanza**: llevaría al asesor
a una pantalla de cobro que el backend rechaza. Son dos defectos apilados — uno de ruteo y uno de
criterio de negocio— y el segundo hay que medirlo antes de arreglar.

### Por qué no lo atajó nada de lo que corrimos

Build, `typecheck`, `biome` y Sonar pasaron los tres PRs en verde, y el caminado de punta a punta del
14/9 recorrió **ecommerce**, que es justo el canal inmune. **Una ruta registrada en un árbol y no en el
otro no falla en ningún lado**: `ROUTE_PATHS.initialFeePayment` compila igual, y el fall-through de
React Router la hace matchear en el árbol equivocado en silencio. Es la **cuarta** vez en esta tarea que
algo pasa build + tipos + lint y sólo aparece corriéndolo — y la primera en la que correr **tampoco**
alcanzó, porque se corrió el canal que no era. Candidato firme a **F-xx**.

## Contextos que usa
- **ecommerce** — el canal (contrato base64, credencial `allied_ecommerce_credentials`, `/vtex/*`, "volver al comercio"). Esta task lo lleva al wizard nuevo en modo stateless; el nodo describe el canal, la task el cambio.
- **onboarding** — el formulario del wizard (teléfono/OTP, datos personales, `init-loan-request`) se adapta para hidratarse del contexto ecommerce sin cookie.
- **payments** — la task suma las rutas de **cuota inicial** al wizard (`initial-fee-payment.tsx` + `.server.ts`) y `down-payment-validation`; el enganche pasa por acá.
- **architecture** — es la costura `application → legacy-backend + frontend`; "stateless (no cookie)" es la misma dirección que el V1→V2: **el estado y la orquestación viven en el front**, el backend solo expone endpoints de contexto.

## Objetivo
Que el checkout de una tienda entre al wizard nuevo SIN depender de cookie/sesión: el front (`ecommerce/checkout.tsx`) recibe el contrato, y en cada paso rehidrata desde endpoints de contexto del backend (`ecommerce-context.server.ts` → `EcommerceRequestController`). Motivación técnica del "no cookie": el SSR del wizard cruza hosts/ambientes y la cookie se perdía. No re-explica el canal (ver **ecommerce**).

## Lo que se mergeó: el libro mayor de los PRs

> Medido el 2026-09-14 con `gh` y `git merge-base --is-ancestor`, no de memoria. Las horas son de
> Colombia (`gh` las devuelve en UTC). Esta sección es ESTADO: se reescribe, no se apila.
> **Sólo lo de esta tarea, sólo lo mío y sólo lo MERGEADO** — lo que mergeó otra gente vive en SU
> tarea, y lo que no mergeó no se hizo. *(Reemplaza a la tabla «Ramas y PRs por repo», que estaba
> verificada al 2026-07-18 y se quedó en los dos PRs de junio.)*

| | PR | rama | tamaño | mergeado a | cuándo | commit |
|---|---|---|---|---|---|---|
| back | **#795** endpoints de contexto para el wizard sin cookie | `ecommerce-stateless-checkout` | +131/−5 · 4 arch | `develop` | 11/6 08:37 | `bb14a8ff3` |
| front | **#551** la entrada ecommerce stateless | `ecommerce-stateless-checkout` | +585/−31 · 21 arch | `develop` | 11/6 08:38 | `d22424690` |
| back | **#1392** la sala de espera del veredicto | `feat/sala-de-espera-ecommerce` | +93/−0 · 2 arch | `qa` | 14/9 15:30 | `gh:1392` |
| front | **#997** la entrada del checkout y la cuota inicial | `feat/ecommerce-stateless-checkout` | +762/−26 · 21 arch | `qa` | 14/9 15:30 | `gh:997` |
| front | **#1005** bienvenida del canal, datos editables, cuota inicial fuera del listado, ancho de móvil | `feat/ecommerce-bienvenida-campos-y-cuota-inicial` | +303/−149 · 9 arch | `qa` | 14/9 18:10 | `gh:1005` |

### ⚠ Esto NO está todo en el mismo lugar, y esa es la parte que engaña

| PR | `qa` | `develop` | `staging` | `main` |
|---|---|---|---|---|
| back #795 | ✅ | ✅ | ✅ | ✅ |
| front #551 | ✅ *(por contenido)* | ✅ | ❌ | ❌ |
| back #1392 | ✅ | ❌ | ❌ | ✅ **sí** |
| front #997 · front #1005 | ✅ | ❌ | ❌ | 🔴 **entraron y se revirtieron** (#1013) |

*(Re-medido el 2026-09-15 con `git ls-tree -r --name-only origin/<rama> -- <ruta>` sobre
`checkout.tsx` e `initial-fee-payment.tsx`, y `git grep -c ecommerce-status origin/<rama> --
Modules/Loans/routes/api.php`. ⚠ El primer intento usó un `for b in …; do git cat-file -e
origin/$b:<ruta>` y **devolvió `no` para las cuatro ramas, incluida `qa`, donde el archivo SÍ está**:
en zsh el `:` pegado a `$b` no expande como uno espera. Un chequeo que contesta «no hay» sin haber
mirado, otra vez — misma clase que el `git grep -E '\s'` de legacy-backend.)*

**El par de junio está PARTIDO**: el backend llegó hasta `main`, el front se quedó en `develop`. O sea
que en producción hay endpoints de contexto stateless **sin la entrada del front que los usa**. Eso no
lo arregla lo de septiembre, que vive sólo en `qa`.

> ⚠ **Y ojo con cómo se mide.** `git merge-base --is-ancestor` dice que el merge de **#551 NO está en
> `qa`**, y es falso: los cuatro archivos net-new de ese PR —`ecommerce/checkout.tsx`,
> `down-payment-validation.tsx`, `initial-fee-payment.tsx`, `ecommerce-context.server.ts`— **existen en
> `qa`**. El contenido llegó por otro camino y el SHA no. Es la segunda vez en el día que la medición
> por commit da un falso «falta» (la otra fue #983, en Alta). **El desempate es el contenido, no el
> SHA.**

### Los dos PRs de abril ya NO están abiertos

> **MEDICIÓN · 2026-09-14** — `legacy-backend#503` y `frontend-monorepo#363` están **CLOSED**, sin
> merge. Se cerraron después de la medición de más abajo, que los dio por abiertos ese mismo día.
> Por eso no entran al libro mayor: no se hicieron. Lo que había que **rescatar** de ellos sigue
> valiendo y está en «Los CUATRO PRs de la migración».


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
abierta escrita adentro. **RESUELTO el 2026-09-14:** esta tarea toma **CORE-30**, que es la que describe este trabajo, y el
archivo aparte (`revision-de-flujo-ecommerce-v1.md`, id 42) se borró. **CORE-543** pasó a la tarea del
SDK. ⚠ Su título en Jira sigue diciendo «Inicio paso refactor ecommerce»: renombrarlo es una escritura
a Jira y la decide Miguel (`make jira-edit`).

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

> **DESENLACE · 2026-09-14, 15:30** — los dos PRs **mergeados a `qa`**. Antes del merge se corrieron los
> tres canales por el front sobre la rama (ecommerce, autogestión de Alta y asesor), con una corrida de
> control sobre `qa` sin los cambios para separar lo nuevo de lo que ya fallaba. Lo que apareció ahí
> está abajo, en §«Lo que encontró validar antes de mergear».

**Corrección 2 · ~~los dos PRs son por CONCERN~~ — ⚠ DESCARTADA por Miguel (2026-09-14):** quería
**un PR por REPO**, no por concern. Se consolidó todo en [#997](https://github.com/Creditop-SAS/frontend-monorepo/pull/997)
(20 archivos, +749/−26, **un commit**) y se cerró el #998. El cherry-pick entró limpio y build,
typecheck y Sonar siguen en verde con los dos concerns juntos. **El argumento del split se queda
anotado como riesgo asumido:** revertir un fallo del checkout en prod se lleva puesta la cuota inicial.
Lo que sigue abajo describe por qué se propuso separarlos.

~~Los dos PRs son por concern, y los dos van en el front.~~ #551 empaquetó dos cosas:

| concern (ambos van juntos en #997) | archivos | líneas |
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
visible. (2) ✅ **HECHO, y consolidado en #997** — la cuota inicial se armó primero
como PR #998 aparte y Miguel pidió un PR por repo, así que se cherry-pickeó al #997 y el #998 se cerró.
Backend ya presente en las cuatro ramas. ⚠ Trajo **una decisión de criterio** que el PR de junio no enfrentaba porque esas
ramas no existían: dónde va el cobro en la cadena de navegación de `available-lenders`. Quedó después
de gestión manual y autogestión —ahí el comprador ya no está en la pantalla— y antes del resto; y
después de la analítica, para no perder `lender_selection_result`, que el early-return original se
salteaba. **Falta confirmarlo con producto.** (3) La sala de espera, aparte y después: es
rescate, no migración.

⚠ **Y un bloqueante que no es de código:** aunque el PR llegue a `main`,
`originaciones.creditop.com/ecommerce/{hash}/checkout` tiene que **responder en prod** para que el
redirect de borde sirva. Eso es deploy/ingress del front.

### Estado de CI de los dos PRs (2026-09-14) — ✅ LOS DOS EN VERDE

| | #997 checkout | #998 cuota inicial |
|---|---|---|
| commits | 1 | 1 |
| `turbo run build` | ✅ | ✅ |
| `typecheck` (errores propios) | ✅ 0 | ✅ 0 |
| **SonarCloud** | ✅ **SUCCESS** | ✅ **SUCCESS** |

Sonar **pasa** en los PRs vecinos (#991, #993, #994), así que es del código nuevo, no del repo.
Se endurecieron cuatro puntos de la misma clase —todos correctos por sí mismos, independientemente
de Sonar— y **el rating siguió en B**:

1. `checkout.tsx` — el `partner_hash` viene de la URL y entraba sin validar tanto en la ruta del
   fetch a legacy como en el destino del `redirect`. Ahora se valida contra la forma real de
   `allied_branches.hash`.
2. `ecommerce-context.server.ts` — `erId` y `loan_request_id` entraban en la ruta de un fetch **del
   servidor**; un id con `/` o `..` reescribía el path. Ahora sólo ids numéricos.
3. `loan-approved.tsx` — la `return_url` la elige el COMERCIO y termina siendo un destino de
   navegación. Ahora sólo `http(s)` absolutas.
4. `initial-fee-payment.tsx` (#998) — `redirect(checkout_url)` con la URL que devuelve la pasarela.
   Idem.

✅ **La causa era otra, y la trajo Miguel del dashboard:** el literal
`|| "http://legacy-backend.inertia-develop"` del `getApiUrl()` — *«Using http protocol is insecure»*.
Está repetido en decenas de archivos del repo, pero Sonar sólo lo mira en **código nuevo**, y mis dos
archivos nuevos lo arrastraban del PR de junio.

**Y el arreglo correcto no era ponerle `https`:** ese host es interno y responde por http. Lo correcto
era **borrar el respaldo**, porque `VITE_API_URL` **ya es obligatoria** —`env.server.ts` la declara en
su esquema zod y `init()` aborta el arranque si falta—. O sea que ese `||` no protegía de nada: con la
variable ausente la app ni arranca, y lo único que podía hacer era mandar tráfico **en claro al cluster
de desarrollo** si alguien rompía esa validación. Ahora tira un error explícito.

⚠ **Y quitarlo destapó el split servidor/cliente otra vez.** Al centralizar la base en el servicio,
`down-payment-validation.tsx` —que consulta `check-status` desde el CLIENTE— quedó importando de un
módulo `.server`, y el build murió con *«Removal of server code»*. **El archivo ya avisaba en su propio
comentario** y lo rompí igual. `typecheck` y `biome` lo dejaron pasar; **sólo el build lo vio**. Es
exactamente [[frontend-el-build-es-la-vara]], otra vez y en el mismo día.

> **MEDICIÓN · 2026-09-14** — ⚠ **Un chequeo que contesta «ninguno» sin haber mirado.** Verifiqué los
> tipos de #997 con la lista de `git status --porcelain`, y para un archivo nuevo dentro de un
> DIRECTORIO nuevo eso lista **el directorio**, no el archivo: `checkout.tsx` nunca entró en la lista y
> el chequeo dijo «0 errores propios» **teniendo uno**. Lo encontró Sonar, no yo.
> **Cómo se hace bien:** la lista sale de `git show --name-only --format= HEAD`, que enumera archivos.
> Es el mismo defecto que el `git grep -E '\s'` de `legacy-backend`: una verificación que no sabe
> buscar es peor que no tenerla, porque se lee como garantía.

### El PR de backend: la sala de espera (2026-09-14)

**[legacy-backend #1392](https://github.com/Creditop-SAS/legacy-backend/pull/1392)** ·
`feat/sala-de-espera-ecommerce`, desde `qa`, **un commit**, 2 archivos (+93).

Rescata del #503 el `checkLoanStatus` de `AdvisorStatusController` —que **sí existía** en `qa`, pero
sólo con sus dos hermanos `checkSigningStatus` / `checkEnrollmentStatus`— y lo rutea como
`GET api/loans/requests/device/ecommerce-status/{user_request_id}`.

⚠ **La ubicación de la ruta es el cambio, no un detalle.** Va en el grupo `device`, que excluye
`onlyMobileValidation`. Colgada del grupo padre respondería **403 a todo comprador de escritorio** — y
el checkout de una tienda es exactamente eso. **Medido:** con user-agent de escritorio el endpoint
nuevo da 200 y su hermano del grupo padre da 403.

No se copió del #503 tal cual: ése leía el vínculo con la tienda con un **join crudo** por Query
Builder; acá se usa el repositorio que ya existe (`UserRequestsByEcommerceRequestRepository`, que
además ya trae la relación cargada). También salieron un log de depuración y las clases con ruta
completa.

### Caminado de punta a punta contra el harness (2026-09-14)

> **MEDICIÓN · 2026-09-14** — la entrada de ecommerce del #997 **funciona**, y caminarla encontró un
> defecto que el build, `typecheck` y Sonar dejaban pasar.
> **Cómo se vuelve a comprobar:** levantar el wizard de la rama del PR, generar la URL con
> `buildEcommerceUrl` de `harness/pkg/ecommerce.ts` (que ya apunta a `/ecommerce/{hash}/checkout`) y
> abrirla. ⚠ Un worktree nuevo **no tiene los `.env`** (gitignoreados): hay que copiarlos, y el del
> repo apunta a `legacy-backend.inertia-develop/api` — host de dev **y con `/api` incluido**, que el
> código no espera.

Lo que se comprobó, con el comercio **Amoblar** (`d63f05e7`) y un contrato base64 real:

1. `/ecommerce/{hash}/checkout` decodifica el contrato, crea el `ecommerce_request` (**6898**) y
   redirige a `/ecommerce/{hash}/solicitar?amount=2000000&erId=6898`. **La llave viaja en la URL.**
2. El monto del pedido llega **prellenado y bloqueado** (`pointer-events-none opacity-60`).
3. El paso del celular llega con **3134886296** —el del billing— en `readOnly` y bloqueado.
4. El `erId` sobrevive el paso de monto → celular.

⚠⚠ **EL DEFECTO: el botón quedaba DESHABILITADO con el dato correcto puesto.** Un campo bloqueado
nunca dispara `onChange`, así que su valor no se validaba y el paso quedaba sin salida. El `trigger()`
estaba en el componente PADRE y no alcanzaba: su efecto corre **antes** de que el formulario hijo se
suscriba a `formState`, así que el `isValid` que lee el botón no se enteraba. **Movido adentro de
`AmountForm` y `PhoneNumberStepForm`, el botón se habilita.** Medido en el navegador antes y después.

**Y es la tercera vez en el día que algo pasa build + tipos + lint y sólo se ve corriéndolo.** Las
otras dos fueron el `ecommerce_request_id` en snake_case y el import de un módulo `.server` desde
cliente.

## Los CUATRO PRs de la migración, y qué rescatar (2026-09-14)

> **MEDICIÓN · 2026-09-14** — los PRs de abril (#503/#363) **siguen ABIERTOS**, no cerrados, y tienen
> **dos piezas que no existen hoy en ningún lado**.
> ⚠ **Caducó el mismo día: los dos se CERRARON** (re-medido el 2026-09-14 por la tarde). Lo que no
> caduca es la segunda mitad — las dos piezas siguen sin existir en ningún lado, y cerrarlos no las
> trajo. Que el PR se cierre no rescata su contenido.
> **Cómo se vuelve a comprobar:** `gh pr view <n> --json state,baseRefName,files` en cada repo, y
> `git grep "ecommerce-check" main` / `git ls-tree -r --name-only origin/develop …/routes/ | grep waiting`.

| PR | estado | base | tamaño | qué es |
|---|---|---|---|---|
| `legacy-backend` [#503](https://github.com/Creditop-SAS/legacy-backend/pull/503) | 🔴 **CERRADO** sin merge *(se cerró el 14/9, después de la medición de acá arriba)* | ← **main** | 15 arch · +295/−31 | «checkout integration», abril |
| `frontend-monorepo` [#363](https://github.com/Creditop-SAS/frontend-monorepo/pull/363) | 🔴 **CERRADO** sin merge *(ídem)* | ← develop | 15 arch · +342/−57 | idem, front |
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

## El SDK del comercio se separó (2026-09-14)

La exploración de «que el flujo corra dentro de la página del comercio» **ya no vive acá**: es la
tarea `sdk-del-comercio.md` (**CORE-543**). Son dos trabajos con dos horizontes: esta migra el canal
que YA existe y tiene PRs abiertos; aquélla explora una capa nueva encima y no está comprometida.

Lo que esta tarea conserva es el **conocimiento del canal** que aquélla usa pero no le pertenece: qué
datos entrega el comercio, y cómo reacciona hoy el formulario.

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

## Lo que encontró validar antes de mergear (2026-09-14)

Correr los tres canales antes del merge encontró **un agujero real en el propio PR**, y lo encontró
porque se recorrió el FRONT, no la API.

**El anclaje al pedido sólo funcionaba para una minoría de comercios.** `otp-verification.tsx` elige
entre dos repositorios de OTP según `resolveKycFlow`: v2 si el comercio está en la lista
`kyc_pipeline_allieds`, v1 —el legacy del monolito— si no. **Cada endpoint lee el id del pedido con su
propia forma** (v2 `ecommerceRequestId`, v1 `ecommerce_request_id`) y el otro lo ignora sin un solo
error. El PR original arreglaba el camino v2; el repositorio **v1 no mandaba el campo en ninguna forma
pese a recibirlo**. Medido contra el ambiente **qa**: de los 7 comercios consultados, **los 7 responden
`usesPipeline=false`** — o sea que v1 no era el caso de borde, era el camino de todos.

Sin ese anclaje se caían **tres cosas a la vez**, y ninguna daba error: el comercio no recibía el
veredicto, el formulario no se prellenaba con lo que el comercio ya sabía, y **por lo tanto tampoco se
bloqueaba ningún campo** — `lockedFields` llegaba vacío y el cliente podía reescribir sus propios datos.
Arreglado dentro del mismo PR (tres líneas en `phone-otp-legacy.repository.ts`) y comprobado corriendo:
el payload sale con el campo, el puente `user_requests_by_ecommerce_request` queda creado, y el loader
de personal-info pasa de `lockedFields: []` a los cinco campos. El spec que lo verifica **borra el cookie
`_session` en cada paso**, así que también deja medido que el camino v1 es stateless: el id llega por el
request, no por la sesión.

**Tres hallazgos transversales salieron de la misma validación** y se registraron en `findings`:
**F-214** (con `flow_id=2` el listado se recorta a `rt=0` y un comercio sin ninguna queda con la pantalla
vacía — es lo que se vio al probar la UI), **F-215** (cualquier 404 del wizard deja una página que no
hidrata, en `main` y `qa`) y **F-216** (una setting ausente da 500 y el front cae al OTP v1 sin avisar).

**Y el canal asesor no fallaba por el PR: fallaba el harness.** El motor HTTP de `harness-caminar` nunca
cargaba la sesión de Cognito, así que `--flow merchant` iba siempre al login y moría en un «/login: HTTP
500» que no decía nada. La corrida de control sobre `qa` daba idéntico, lo que probaba que no era
regresión pero señalaba al lugar equivocado. Arreglado en el harness.

## Cómo probar / validar
- Flujo E2E de ecommerce: `bin/ecommerce` de **harness** (ver nodo **harness**). Como el front vive en develop, apuntá el harness a **dev/develop**, no a main.
- ⚠ Gotcha (nodo `ecommerce`): la entrada ecommerce se degrada en local por Mixed Content — el motivo mismo del rediseño stateless.
- Verdicto: el wizard rehidrata el monto/prefill desde `ecommerce-context.server.ts` sin cookie y cierra a Estado 11.

## Registro

### 2026-09-15 · el revert de `main`, y la causa medida

Miguel trae por Slack el reporte de **Joel (QA)**: *«cuando uno da click en el botón de "Validar Pre
aprobado" en la tarjeta del lender … lo devuelve a uno a la pantalla de solicitar»*. Buscando el
estado apareció primero lo que nadie había escrito: **los PRs entraron a `main` y Abel los revirtió**
(#1013, `77796a4f`, 14/9 20:52), y el revert **no tocó el backend**, que quedó solo en `main`.

La causa se cerró leyendo `origin/qa` y midiendo el único eslabón que no se lee: el matcheo de rutas.
`/merchant/<h>/<id>/initial-fee-payment` **no cae en el árbol del asesor sino en `public-layout`**,
porque #997 registró esa ruta sólo bajo `:flow` — y de ahí salen cuatro 302 encadenados hasta
`/solicitar`. El control (`/merchant/<h>/<id>/ruta-inexistente` → sin match) descarta que sea
«cualquier ruta rara rebota».

Tres cosas que este día deja anotadas y valen más que el bug:

1. **Correr no alcanza si se corre el canal que no es.** El caminado del 14/9 recorrió ecommerce, que
   es el único canal **inmune** (ahí `initialFeeAllowed` se fuerza a `false`). El que rompe es el del
   asesor, que el PR no venía a tocar.
2. **Ya lo habíamos diagnosticado el 2026-06-26** — mismo `if`, misma línea, mismo síntoma. El arreglo
   de entonces (`&& !response.data.standBy`) **ya no se puede copiar**: `standBy` no existe más en el
   wizard.
3. **Y una sonda maía mintió**: `for b in …; do git cat-file -e origin/$b:<ruta>` dio «no» para las
   cuatro ramas, incluida `qa`, donde el archivo sí está. Se rehizo con `git ls-tree`.

## Bitácora
- **2026-04** — 1er intento "web-origination" (PRs 503/363, rama `feature/onboarding/ecommerce-web-origination`): quedó **sin merge**, superado por el enfoque stateless.
- **2026-06-11** — mergeados los squash `bb14a8ff` (#795) y `d2242469` (#551).
- **2026-07-18** — registrado como task (corrige la versión previa de este nodo, que apuntaba por error a 503/363). Estado de merge verificado contra las ramas remotas: backend en main, front en develop. Superficie = 20 archivos que resuelven; 5 net-new del front + los adds van en prosa.
- **2026-09-14 · tarde** — **los dos PRs mergeados a `qa`** (#997 `6fa13ae5` · #1392 `3cd20e34`), un
  commit cada uno. Antes del merge se validaron los tres canales por el front, con control sobre `qa`
  sin los cambios: ahí apareció que el anclaje al pedido sólo cubría el camino v2 del OTP, y que **los 7
  comercios consultados en qa van por el v1** — se arregló dentro del mismo PR y se comprobó corriendo
  (puente creado, `lockedFields` de `[]` a 5). Salieron **F-214/F-215/F-216**. Y cinco arreglos al
  harness, todos del mismo defecto: afirmaba resultados que no había medido (el panel no miraba el
  vínculo, el runner de ecommerce pegaba al endpoint que el front no usa, «frontend reusado» describía
  un proceso que ya no corría, el caminar no cargaba la sesión del asesor, y el contrato de la tienda
  no llevaba el caso del panel). **Pendiente el salto `qa` → `main`: hasta eso, no corre en prod.**
- **2026-09-14** — se le ata **CORE-543** («Inicio paso refactor ecommerce»), que estaba en el sprint sin archivo en el tablero. Se abre el hilo «el flujo dentro de la tienda»: descartado el iframe contra `main` (4 bloqueos), prototipado el SDK y **corrido** — tres llamadas 200 desde otro origen, 6 entidades y no 7, y falta la rt=2. Re-verificado también que #551 sigue **sin** llegar a `main` (está MERGED contra `develop`).

## Pendientes
- [ ] 🔴 **ARREGLAR EL REBOTE Y REPONER EL PR** — es lo que bloquea todo lo demás de esta tarea.
      (a) medir si el backend sigue 403eando `initial-fee-payment/{ur}` para `rt=2`; (b) registrar
      `initial-fee-payment` y `down-payment-validation/:transaction_id` en el árbol `merchant` de
      `routes.ts`; (c) si el 403 sigue, guardar el `if` de qa:637. Ver §«El rebote a `/solicitar`».
- [ ] ⚠ **El defecto está VIVO en `qa`**, y `main` NO lo recupera solo: el revert es pegajoso (los
      commits son ancestros de `main`). Reponerlo pide `git revert 77796a4f` o commits nuevos — junto
      con el arreglo, no después.
- [ ] **El backend #1392 quedó solo en `main`** (front revertido, `ecommerce-status` no). Decidir:
      revertirlo también o dejarlo esperando al front. Es la misma asimetría del par de junio.
- [ ] **Promover a F-xx: una ruta registrada en UN árbol y no en el otro no falla en ningún lado** —
      compila, pasa lint, y React Router la matchea en el árbol vecino en silencio hasta rebotar al
      inicio. Es el hallazgo más transversal del día: aplica a las 3 ramas de `routes.ts`, no a ecommerce.
- [ ] **Agregar al caminado el canal ASESOR con cuota inicial > 0** — la corrida del 14/9 pasó en verde
      porque recorrió el único canal inmune.
- [ ] ~~Promover #551 (front) a main~~ → **no promueve: `develop` está 772 commits detrás de `main`.** El camino es rama nueva desde `qa` (ver §«Cómo aterrizarlo»). El pendiente sigue vivo, cambia el método.
- [ ] ~~viejo~~ **Promover la entrada stateless** — hoy solo en develop; hasta entonces la entrada stateless no corre en prod. ⚠ **Medido el 2026-09-14: son 14.160 checkouts en 6 meses esperando del otro lado**, los que hoy convierten al 1,9 % contra el 18,7 % del mundo nuevo. Es el pendiente con más impacto de esta tarea.
- [ ] **Rescatar la sala de espera de abril** — `AdvisorStatusController@checkLoanStatus` (#503) + `ecommerce-continue.tsx` en `waiting-room` (#363). No existen en main ni develop, y tapan el hueco de las 2.167 solicitudes que quedan en estado 3.
- [ ] **Cerrar o reabastecer #503 y #363** — siguen ABIERTOS. Lo demás de #503 hay que revisarlo archivo por archivo contra main antes de rescatar.
- [ ] **Redirect de borde en `aliados.creditop.com/checkout/*`** — pedido a Infra, 302 con query verbatim. ⚠ Bloqueado por que `/ecommerce/{hash}/checkout` llegue a `main`, y **tiene que excluir los hashes de Corbeta** o secuestra el tráfico que hoy convierte al 18,7 %. Lista de hashes en §«Los CUATRO PRs».
- [ ] Extender el cutover al resto del ecommerce no-Corbeta (sigue el array `[24,209,210,211,311]` en `WoocommerceController` del monolito).
- [ ] Borrar la lógica ecommerce duplicada en `application` una vez completo en main.
- [x] ~~Decidir el alcance del SDK~~ → **medido, y la pregunta era otra**: no es «¿pedimos datos?» sino **«¿pagamos una consulta de buró dentro de la tienda, y con qué gatillo?»**. Ver §MEDIDO. Queda decidirlo, ya con el dato.
- [x] ~~Parsear `should_collect_expedition_date`~~ → **YA ESTÁ**, verificado en `qa` el 2026-09-14: `personal-info-config-v2.repository.ts:112` lo lee con test propio, y `loan-request-form` lo usa como `showExpeditionDate` con `?? true` (fallar hacia el paso de MÁS, que es recuperable). El docblock de `GetPersonalInfoConfigService` que decía «the wizard's own schema does not even parse» quedó viejo.
- [ ] Arreglar el mapeo muerto de apellidos (`surname` en el plugin vs `last_name` en `getBillingField`) y decidir si `address`/`city` dejan de tirarse.
- [ ] Promover a F-xx: el `erId` pre-OTP viaja por el header `Referer` y depende de que `Referrer-Policy` siga en `strict-origin-when-cross-origin`; endurecerla rompe el prefill en silencio. ⚠ **Y ahora hay dato:** medido el 2026-09-14, el POST del OTP sale con `referer: —` (vacío) y el anclaje funciona igual porque el id viaja en el **body**; lo que depende del Referer es `readErIdFromRequest` cuando la URL del action no lo trae.
- [ ] Promover a F-xx: en local, un `OBV21002` no deja rastro (tracer → Loki inexistente, sin fallback al log de Laravel).
- [x] ~~Promover a F-xx el listado vacío del flujo de cupo confirmado~~ → **F-214** (2026-09-14).
- [x] ~~Promover a F-xx la hidratación muerta en los 404~~ → **F-215** (2026-09-14).
- [x] ~~Promover a F-xx el 500 del `kyc-flow` que el front traga~~ → **F-216** (2026-09-14).
- [ ] **Decidir qué hacer con F-214 (producto)** — un comercio sin ninguna entidad `rt=0` no debería ofrecer «Confirmación de cupo», o la pantalla vacía debería dejar volver atrás. Hoy el cliente queda sin salida y sin poder corregir su respuesta.
- [ ] **F-215: el arreglo es un carácter** (`window.ENV?.APP_ENV` en `entry.client.tsx:14`) y toca una rama ajena a esta tarea. Está en `main` y en `qa`. No se comprobó si el botón «Volver a intentar» queda inerte.
- [ ] **F-216: el fallback mudo sigue abierto** — el front no distingue «este comercio va por el legacy» de «no pude preguntarlo». En local se tapó sembrando la setting (`make harness-kyc-flow`).
- [x] ~~Pedir revisor en #997 y #1392~~ → **MERGEADOS a `qa`** el 2026-09-14 15:30 (merges `6fa13ae5` y `3cd20e34`).
- [ ] ⚠ **PROMOVER `qa` → `main`** — es lo único que separa esto de producción. Verificado el 2026-09-14: `checkout.tsx` y la ruta `ecommerce-status` están en `origin/qa` y **no** en `origin/main`. Mientras tanto la tarea **no gradúa** a `context/` (la vara del árbol es `main`) y los 14.160 checkouts siguen esperando.
- [ ] **Confirmar con producto el ORDEN del cobro de cuota inicial** en autogestión — la única decisión de criterio del #997, comentada en el código.
- [ ] ⚠ **Promover a F-xx, y es el hallazgo más transversal del día: la guarda `I_KNOW_THIS_TOUCHES_SHARED_DEV` (F-53) sólo cubre las escrituras por `pkg/db.ts`.** Todo lo que escribe **por la API** contra dev pasa sin pedir permiso — así los specs de `channel/` crearon filas en el compartido durante meses sin que nada avisara. Tapado el caso de Playwright (`playwright.config.ts` fija el target), pero el agujero sigue.
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

## Alcance
No cambia nada del recorrido de mostrador ni del canal del asesor. **No** enciende todavía la nueva
entrada para los comercios que ya están operando: eso es un cambio de infraestructura aparte, que además
debe excluir a los comercios de Corbeta, que ya tienen su propio recorrido y son los que hoy mejor
convierten. La pantalla de espera del veredicto queda disponible en el servidor, pero su pantalla en el
navegador no entra en esta tarea.

## Dónde probar
Ambiente **QA**. Comercio: cualquiera con tienda configurada — se probó con **Amoblando Pullman** y con
**Amoblar**. No hace falta usuario de asesor: el comprador entra sin sesión, desde la tienda.

## Cómo validar
1. Iniciar una compra desde la tienda y elegir pagar con crédito. Debe abrirse el formulario con el
   **monto del carrito ya puesto y bloqueado**.
2. Continuar hasta el código de verificación por celular y validarlo.
3. En la pantalla de datos personales, comprobar que **los campos que el comercio envió están llenos y
   no se pueden editar**, y que los que el comercio no envió sí se pueden escribir.
4. Elegir una entidad y, si pide cuota inicial, completar el pago.
5. Al cerrar, comprobar que **la tienda recibe el resultado** y que aparece el botón para volver a ella.

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
