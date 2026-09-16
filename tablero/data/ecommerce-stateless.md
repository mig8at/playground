---
id: 6
title: "Ecommerce web stateless"
stage: work
created: "2026-07-21T10:30:30-05:00"
context_nodes: [ecommerce, onboarding, payments, architecture]
jira: [CORE-30]
cuadrilla: ecommerce/miguel
jira_title: "Revisión de flujo ecommerce V1"
ramas: autogestion-sin-entrega-al-propio-cliente, ecommerce-cuota-inicial-boton-muerto, restore/ecommerce-checkout-y-rebote, cuota-inicial-rebote-asesor-qa, cuota-inicial-rebote-asesor, ecommerce-stateless-checkout, sala-de-espera-ecommerce, ecommerce-*stateless*, ecommerce-bienvenida-campos-y-cuota-inicial, cuota-inicial-en-el-wizard, ecommerce-web-origination, ecommerce-stateless-detail, ecommerce-continue-route, creditopx-standby-confirmation, creditopx-initial-fee-bounce, down-payment-build, ecommerce-unify-base64-vtex
---

# Ecommerce web stateless (→ wizard sin cookie)
(migrado del nodo-tarea `ecommerce-web-stateless` del árbol de context, 2026-07-21)

CUÁNDO APLICA: Cuando la tarea toca la migración de la originación de ecommerce (VTEX/Woo/self) al wizard STATELESS (sin cookie) en legacy-backend + frontend: PRs 795 (backend, en main) / 551 (frontend, en develop), el entry ecommerce/checkout, los endpoints de contexto, o el estado 'backend en main, front aún en develop'.

## Si retomás esto sin contexto, empezá acá

**QA reporta que el flujo sigue yendo a `continuar` en vez de `confirmation`, y la primera sospecha
—«no se subió a qa»— ya quedó descartada.** Medido el 16/9: front **#1015** (`a58d861a`, 15/9 10:49) y
**#1018** (`7e5774c8`, 15/9 14:59) y back **#1402** (`7b1f45f0`, 15/9 15:58) están en `origin/qa` y las
tres corridas de *Deploy … QA* están en verde. No hubo despliegues posteriores que las pisen. El
detalle, en el Registro del 16/9.

**Quedan TRES explicaciones vivas, y cada una se arregla distinto** (§«Las TRES condiciones del
arreglo»):

1. **que la prueba haya ido contra `dev`** — la guarda de #1402 tiene 5 ocurrencias en `qa` y **CERO en
   `develop` y `staging`**, y las dos URLs se diferencian en un token
   (`originaciones.dev` vs `originaciones-qa.dev`);
2. **que el par (comercio, entidad) no esté marcado** — el arreglo exige `allieds.self_managed` o
   `lenders_by_allieds.user_self_management`, y con **Credifamilia sobre Amoblando Pullman ir a
   `/continue` es lo correcto, no el bug**;
3. 🔴 **un hueco real:** `$inPlatformContinueUrl` sólo se asigna en la rama `empty($credential)`. Con
   credencial, `case 4` prende `standBy` pero no puebla la url y **rt=2/3 ni siquiera tienen `case`**,
   así que el arreglo nunca dispara. Tres pares reales de la base de qa caen ahí.

**El próximo paso es:** preguntarle a QA **contra qué URL, con qué comercio y con qué entidad** corrió
la prueba que falló — con eso las tres se reducen a una. El caso que SÍ ejercita el arreglo es
**CrediPullman (77) o Cierre X (201) sobre Amoblando Pullman, sin sesión de asesor, en
`originaciones-qa.dev.creditop.com`**; si ahí también falla, es el hueco 3 y hay que tocar código.

⚠ **Y ojo con los logs para dirimirlo:** la etiqueta `environment` de Loki en ese stack sólo tiene
`development`, `local` y `testing` — **no hay valor `qa`**, así que `dev/loki-trace.ts` con
`E2E_TARGET=qa` contesta «no es de este target» sin que eso signifique nada.

### Lo de antes, que sigue valiendo

**El trabajo llegó a `main` y lo sacaron.** Los tres PRs del front (#997, #1005) subieron con
`Qa (#1007)` el 14/9 a las 18:58 y Abel los revirtió esa misma noche con **#1013** (`77796a4f`,
20:52). El backend #1392 **no** se revirtió y sigue en `main`. El motivo del revert es un defecto real
y ya diagnosticado: en el flujo del **asesor**, con cuota inicial > 0, elegir entidad rebota a
`/solicitar` — los cinco eslabones, medidos, en §«El rebote a `/solicitar`». Se arregló con **#1015**,
que ya está en `qa`; **#1016** repone la entrada del checkout en `main` y **sigue ABIERTO**.

✔ **El arreglo del rebote ya estaba escrito desde junio** (#665): #997 se rehizo partiendo de #551
(11/6) y no se llevó los cinco PRs de corrección posteriores. Ver §«La cola de junio que el rebuild no
se llevó» — de esa cola siguen faltando en `qa` **#582, #661 y #663**.


# Ecommerce web stateless (→ wizard sin cookie) · task
> **estado (2026-09-15):** 🔴 **llegó a `main` y lo REVIRTIERON.** El front entró con `Qa (#1007)`
> (`48246d68`, 14/9 18:58 — una promoción de **40 commits**, no un PR de esta tarea) y Abel lo sacó dos
> horas después, el 14/9 20:52, con
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
> ✔ **DOS PRs abiertos, un commit cada uno** (el #1014 se cerró por arrastrar 56 archivos ajenos — ver
> §«El PR que arrastraba trabajo de otros»):
>
> | PR | → | qué | tamaño |
> |---|---|---|---|
> | **[#1015](https://github.com/Creditop-SAS/frontend-monorepo/pull/1015)** | `qa` | el arreglo del rebote | 1 commit · **3 arch** · ✅ **MERGEADO 15/9** |
> | **[#1016](https://github.com/Creditop-SAS/frontend-monorepo/pull/1016)** | `main` | repone #997/#1005 **+** el arreglo | 1 commit · 28 arch · Sonar ✅ · **sólo espera revisor** |
>
> **EL ORDEN, y la DECISIÓN de Miguel (2026-09-15):**
>
> 1. ~~#1015 → `qa`~~ — ✅ **hecho el 15/9.**
> 2. **#1016 → `main`: se mergea CUANDO QA dé el visto bueno de ecommerce en `qa`**, no antes.
>    Decidido por Miguel. El motivo: **es la única forma de volver a meter el código después del
>    revert**, así que conviene que entre ya validado — no hay apuro por riesgo, porque `main` hoy no
>    tiene la funcionalidad y por lo tanto tampoco el defecto.
> 3. La promoción `qa` → `main` (Laura y Oscar) — después del 2. **Medido: limpia, sin conflictos**, y
>    los cuatro archivos de ecommerce sobreviven.
>
> ⚠ **Si la promoción del paso 3 ocurre ANTES de #1016, da conflicto** en `routes.ts` y
> `available-lenders.tsx`, y resolviéndolo a favor de `qa` deja `routes.ts` apuntando a cuatro archivos
> inexistentes → build roto. Es lo que hay que avisarle a quien promueve.
>
> ⚠ **Y que no confunda a nadie: `main` NO está roto, está VACÍO.** Medido el 15/9 contra
> `origin/main`: el `if (initial_fee > 0)`, la ruta `initial-fee-payment` y el archivo
> `initial-fee-payment.tsx` **no existen**. El revert no borró el bug, borró la funcionalidad entera.
> Por eso #1016 **no es un arreglo**: es la reposición. Y si nunca se mergea, nada se rompe — sólo que
> el trabajo no llega a producción y los 14.160 checkouts siguen entrando por el monolito.
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

**Los CATORCE PRs, en orden.** ⚠ La versión anterior de esta tabla listaba **cinco** y daba mal el
nombre de dos ramas. Faltaba entera la **cola de arreglos de junio** — que es justo la que explica el
revert de septiembre (ver §«La cola de junio que el rebuild no se llevó»).

| | PR | rama | tamaño | → | cuándo | merge |
|---|---|---|---|---|---|---|
| back | **#770** originación web stateless | `feature/onboarding/ecommerce-web-origination` | +63/−0 · 3 arch | `develop` | 9/6 10:34 | `53f2b794` |
| back | **#795** endpoints de contexto para el wizard sin cookie | `feat/onboarding/ecommerce-stateless-detail` | +131/−5 · 4 arch | `develop` | 11/6 08:37 | `bb14a8ff` |
| front | **#551** la entrada ecommerce stateless | `feature/onboarding/ecommerce-web-origination` | +585/−31 · 21 arch | `develop` | 11/6 08:38 | `d2242469` |
| front | **#582** cierre CreditopX in-platform: honrar `standBy` → `/confirmation` | `fix/ecommerce/creditopx-standby-confirmation` | +37/−6 · 4 arch | `develop` | 12/6 12:26 | `84d4b1ad` |
| front | **#600** no importar código `.server` en el cliente — rompía el build | `fix/ecommerce/down-payment-build` | +6/−6 · 2 arch | `develop` | 16/6 15:08 | `8f49a297` |
| back | **#834** unificar el base64 del canal (VTEX) | `feature/onboarding/ecommerce-unify-base64-vtex` | +997/−191 · 27 arch | `develop` | 17/6 13:15 | `afb3f990` |
| back | **#838** simulador de resultado de agregador | `feature/onboarding/ecommerce-unify-base64-vtex` | +93/−0 · 3 arch | `develop` | 17/6 14:36 | `e0707d8d` |
| front | **#661** registrar `/ecommerce/…/continue` (faltaba en el árbol público → 404) | `feature/onboarding/ecommerce-continue-route` | +4/−1 · 1 arch | `develop` | 25/6 15:17 | `771e4850` |
| front | **#663** el handoff se renderiza distinto según el flujo | `continue` | +20/−8 · 2 arch | `develop` | 25/6 17:51 | `b8c30a10` |
| front | **#665** 🔴 **no mandar CreditopX a Wompi cuando hay cuota inicial** | `fix/ecommerce/creditopx-initial-fee-bounce` | +5/−2 · 1 arch | `develop` | 26/6 11:56 | `9206b28c` |
| back | **#1392** la sala de espera del veredicto | `feat/sala-de-espera-ecommerce` | +93/−0 · 2 arch | `qa` | 14/9 15:30 | `3cd20e34` |
| front | **#997** la entrada del checkout y la cuota inicial | `feat/ecommerce-stateless-checkout` | +762/−26 · 21 arch | `qa` | 14/9 15:30 | `6fa13ae5` |
| front | ~~#998~~ la cuota inicial aparte | `feat/cuota-inicial-en-el-wizard` | +315/−0 · 6 arch | — | **CERRADO** | consolidado en #997 |
| front | **#1005** bienvenida del canal, datos editables, cuota inicial fuera del listado, ancho de móvil | `feat/ecommerce-bienvenida-campos-y-cuota-inicial` | +303/−149 · 9 arch | `qa` | 14/9 18:10 | `f443ecad` |
| front | ~~#1014~~ el rebote + la reposición | `fix/ecommerce/cuota-inicial-rebote-asesor` | 60 arch, **56 ajenos** | — | **CERRADO** 15/9 | reemplazado por #1015 |
| front | **#1015** el rebote a `/solicitar` del asesor con cuota inicial | `fix/ecommerce/cuota-inicial-rebote-asesor-qa` | +54/−9 · **3 arch** | `qa` | 15/9 · **MERGEADO** | — |
| front | **#1016** repone la entrada del checkout y la bienvenida, con el rebote arreglado | `restore/ecommerce-checkout-y-rebote` | +1.136/−176 · 28 arch | `main` | 15/9 · **ABIERTO** | — |

*(Medido el 2026-09-15 con `gh pr list --author mig-creditop --state all` filtrando por
`ecommerce|checkout|cuota|stateless|sala` en título y rama. Horas de Colombia.)*

⚠ **La rama de #663 se llama `continue` a secas**, así que **no entra en `ramas:`**: como patrón
capturaría media docena de ramas ajenas. Es la única de las catorce que el tablero no puede medir
sola — su estado hay que mirarlo a mano (`gh pr view 663`).

⚠ **#834 y #838 son del CANAL, no de la entrada stateless** — unifican el base64 y el conector VTEX.
Están acá porque no tienen tarea propia en el tablero y son trabajo mío mergeado; si se les abre una,
se mudan.

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

### La cola de junio que el rebuild no se llevó — y es la causa del revert (2026-09-15)

> **MEDICIÓN · 2026-09-15** — #997 se rehizo sobre `qa` partiendo de **#551 (11/6)**, y **no se llevó
> los cinco PRs de arreglo que vinieron DESPUÉS en `develop`**. Cuatro de los cinco **no están en `qa`**.
> **Cómo se vuelve a comprobar:** `git grep -c standBy origin/qa -- apps/loan-request-wizard
> modules/loan-request-wizard` (da 0; en `origin/develop` da 1) y, sobre el `routes.ts` de cada rama,
> `route("continue"` dentro del bloque `:flow`.

| arreglo de junio | qué tapaba | `develop` | `qa` |
|---|---|---|---|
| **#665** no mandar CreditopX a Wompi con cuota inicial | 🔴 **el rebote a `/solicitar`** | ✅ | ❌ |
| **#582** honrar `standBy` → `/confirmation` | el cierre in-platform de CreditopX | ✅ | ❌ |
| **#661** registrar `continue` en el árbol público | un 404 en ecommerce | ✅ | ❌ |
| **#663** el handoff se pinta distinto por flujo | QR vs. WhatsApp | ✅ | ❌ |
| **#600** no importar `.server` desde el cliente | el build roto | ✅ | ✔ rehecho en #997 |

⚠ **#665 es literalmente el arreglo del defecto que causó el revert**, escrito el **26/6**, tres meses
antes. Su comentario en el código lo dice con todas las letras: *«el backend responde
"continue-link-sent" (HTTP 4xx) en /initial-fee-payment para Creditop X, así que mandarlo a Wompi rompe
el flujo y **rebota a /solicitar**»*. Son cinco líneas: `if (Number(initial_fee) > 0 &&
!response.data.standBy)`.

✔ **Y de paso contesta la pregunta que dejé abierta ayer.** No hace falta medir si el backend sigue
403eando: en junio quedó medido **y escrito en el propio código** que `/initial-fee-payment` no sirve
para CreditopX. Lo que sí hay que decidir es la FORMA del arreglo hoy, porque `standBy` ya no existe en
el wizard — el equivalente actual es la rama `showModal && isNil(url)`.

⚠ **Y #661 es el MISMO defecto de ruteo, espejado.** En junio faltaba `continue` en el árbol
**público** y daba 404 en ecommerce; en septiembre falta `initial-fee-payment` en el árbol
**merchant** y rebota en asesor. Dos veces el mismo error de clase, en direcciones opuestas, con tres
meses de distancia. Y `continue` **sigue faltando hoy en `qa`**: #661 tampoco sobrevivió.

**Por qué pasó, y cómo no repetirlo.** `develop` quedó 772 commits detrás de `main`, así que rehacer
el trabajo sobre `qa` era correcto. Lo que falló es **de dónde se copió**: se tomó el PR de la
funcionalidad (#551) y no el **estado final de la rama en `develop`**, que son #551 más cinco
correcciones. La regla que queda: **cuando se rehace trabajo viejo sobre una rama nueva, la base no es
el PR — es `git log origin/develop -- <rutas>` desde ese PR hasta hoy.**

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

### 2026-09-16 · «no llegó a qa» era falso: llegó y está desplegado — lo que falla es OTRA cosa

> **MEDICIÓN · 2026-09-16** — los dos lados del arreglo de autogestión (front #1015/#1018 y back
> #1402) están en `origin/qa` **y desplegados**, con la corrida de despliegue en verde. La hipótesis
> «no se subió» queda descartada.
> **Cómo se vuelve a comprobar:**
> `gh run list --branch qa --limit 8` en los dos repos · `git show origin/qa:Modules/Onboarding/App/Services/UserRequestService.php | grep -c continuaEnEstaPantalla`

| pieza | rama | merge | despliegue a QA |
|---|---|---|---|
| front **#1015** el rebote a `/solicitar` | `qa` `a58d861a` | 15/9 10:49 | ✅ 15/9 10:49 |
| front **#1018** el botón muerto del listado | `qa` `7e5774c8` | 15/9 14:59 | ✅ 15/9 14:59 |
| back **#1402** autogestión sin entrega | `qa` `7b1f45f0` | 15/9 15:58 | ✅ 15/9 15:58 |

**Y el alcance por rama, que es la primera trampa.** `continuaEnEstaPantalla` (la guarda de #1402)
aparece **5 veces en `qa`, CERO en `develop` y CERO en `staging`**; `continueUrl` en el
`UserRequestService`, **4 en `qa`, 3 en `main`, 0 en los otros dos**. O sea que **probar contra
`originaciones.dev.creditop.com` (dev) o contra staging devuelve el comportamiento viejo**, y las dos
URLs se diferencian en un token. ⚠ Y no se puede desempatar por logs: la etiqueta `environment` de
Loki en ese stack sólo tiene `development`, `local` y `testing` — **no hay valor `qa`**, así que
`dev/loki-trace.ts` con `E2E_TARGET=qa` dice «no es de este target» sin que eso signifique nada.

### Las TRES condiciones del arreglo, y el hueco que no está escrito

`$data['continueUrl']` se puebla sólo si se cumplen las tres a la vez:

1. **sin sesión de asesor** — `continuesInPlace()` devuelve `false` con asesor autenticado, a propósito;
2. **el par (comercio, entidad) marcado** — `allieds.self_managed` **o** `lenders_by_allieds.user_self_management`;
3. **`$inPlatformContinueUrl !== null`** — que es donde está el problema.

⚠ **Hueco medido: `$inPlatformContinueUrl` sólo se asigna en la rama `empty($credential)`.** En la
rama CON credencial, `case 4` prende `standBy` pero **no** puebla esa url, y **rt=2 y rt=3 ni siquiera
tienen `case`**. Así que una entidad en plataforma con credencial cableada **nunca** dispara el
arreglo: se le sigue mandando el WhatsApp, eso prende `showModal`, y el front aterriza en `/continue`.
**Tres pares reales en la base de qa caen ahí** — Ramguiflex SAS (26), Mediarte (91) y DENTIX (189),
los tres con **Credifamilia (24, rt=4)** y credencial a nivel comercio.

### Y los dos comercios con los que se venía probando NO sirven para ver el arreglo

| comercio | `self_managed` | entidades en plataforma (rt 2/3/4) | ¿dispara? |
|---|---|---|---|
| **Amoblar** (38) | 1 | **ninguna** | ❌ nunca hay a dónde continuar |
| **Amoblando Pullman** (94) | 0 | Credifamilia 24 (`usm=0`) | ❌ **por diseño** — el par no está marcado |
| | | CrediPullman 77 (`usm=1`) · Cierre X 201 (`usm=1`) | ✅ debería |

O sea: **con Credifamilia sobre Amoblando Pullman, ir a `/continue` es el comportamiento correcto**, no
el bug. El caso que sí ejercita el arreglo es CrediPullman (77) o Cierre X (201) sobre Amoblando
Pullman, **sin sesión de asesor**, contra `originaciones-qa.dev.creditop.com`.

**Lo que NO se verificó:** contra qué URL, con qué comercio y con qué entidad se corrió la prueba que
falló. Sin eso no se puede elegir entre las tres explicaciones — y las tres tienen arreglo distinto.

### 2026-09-15 (10) · los selects pegados eran el AUTORRELLENO: creía que el plazo era una fecha

> **MEDICIÓN · 2026-09-15** — la entrada (9) se quedó a mitad de camino: acertó que las dos listas
> abiertas eran de tarjetas distintas, pero no dijo **quién las abría**. Es el autorrelleno del harness.
> **Cómo se vuelve a comprobar:** `parteDeCombo('12 cuotas','',0,MESES)` — daba `'dia'`.

**`pkg/fecha-trio.ts` tenía un fallback POR POSICIÓN que adivinaba sin mirar el contenido**: índice 0 =
día, 1 = mes, 2 = año. En `/lenders` hay **un selector de plazo por entidad**, así que con tres
tarjetas los tres salían `["dia","mes","anio"]` y `esTrioDeFecha` devolvía **`true`**. El autorrelleno
abría **los tres** buscando un día y un mes adentro — y ninguno los tiene (Crédito 365: `3,6,9,12` ·
Addi: `3…24` · Vanti: `2…60`).

⚠ **El archivo ya avisaba de esto y la guarda no estaba:** *«un selector de cuotas también cae en uno o
dos dígitos y no es un día»*. El aviso cubría los pasos 1 y 2 (por valor y por etiqueta); el que
fallaba era el 3.

**Y dos fugas más en `elegirEnPopover`, que son por qué quedaban ABIERTOS:**

1. las opciones se buscaban con `document.querySelectorAll('[role=option]')`, **global**. Con dos
   popovers abiertos juntaba las de los dos y `opciones[0]` podía ser **de otra tarjeta**.
2. se cerraba con un **segundo `trigger.click()`**, y con el contenido abierto radix atrapa el foco: un
   click sintético no siempre le llega. Ahora cierra con **Escape**, lo verifica por `aria-expanded` y
   cae a un `pointerdown` afuera como último recurso.

**Arreglado y con la regresión fijada** (`057dc11`): la posición sólo decide si el combo está vacío o
muestra un placeholder. Los cinco casos reales del trío siguen detectándose — **14/14 en verde**, y dos
de esas pruebas comprueban que la versión **inyectada al navegador** se porta igual que el módulo, o sea
que el arreglo viaja.

✔ **Y esto cierra el porqué del «no se cierran»**, que la entrada (9) dejó como «capa/posicionamiento»:
no era z-index, era que **nadie los cerraba**.

### 2026-09-15 (9) · el «bucle» del selector de plazo: no era un bucle, era una tarjeta tapando a otra

> **MEDICIÓN · 2026-09-15** — pedido el listado real de la solicitud de esa corrida (uReq **502328**,
> sucursal `ec977139`) a `lenders-v2`, los plazos de cada entidad son:
> **Cómo se vuelve a comprobar:**
> `GET /api/onboarding/loan-application/lenders-v2/<ur>?amount=<monto>` y mirar `credit_lines.fee_numbers`.

| entidad | plazos que ofrece | default |
|---|---|---|
| **#212 Crédito 365** (rt=1) | **`3, 6, 9, 12`** | **12** |
| #6 Addi (rt=0) | `3,6,9,12,18,24` | 24 |
| **#32 Vanti** (rt=0) | **`2,3,4,5,6,7,8,9,10,11,12,15,17,18,24,36,40,45,50,55,60`** | 60 |

**La lista abierta en la captura empieza en `2` y sigue 3,4,…9 con más abajo: es la de VANTI.** Crédito
365 sólo tiene cuatro opciones y ninguna es `2`. O sea que el «12 cuotas» que no cambiaba es el
**default de Crédito 365** y el «3 cuotas» marcado es el de **Vanti** — **dos tarjetas distintas**.

✔ **No hay bucle de estado.** El desplegable de una tarjeta de «Otras opciones» se dibuja **encima de
la tarjeta destacada**, así que se elige en una lista y el valor visible —que es de la otra— no se mueve.
Se lee como «se quedó pegado» y se vuelve a elegir. Es un problema de **capa/posicionamiento**, no de
estado. *(Descartado adversarialmente: el `Select` toma el label Y el check del mismo
`selectedFeeNumber`, así que dentro de UNA tarjeta no pueden discrepar; `usePaymentPlanOptions` está
gateado a Credifamilia; `useLenderAmountUpdate` se dispara por MONTO, no por plazo; y
`amount_conditions` —el filtro que dejaría una sola opción— **no existe como tabla en `qa`**.)*

⚠ **Lo que SÍ es un bucle, y está documentado en el código:** `useInstallmentOptions` coerciona el
plazo al **último** de la lista cuando el elegido no está
(`getValidSelectedFeeNumber` → `installmentOptions[length-1]`), y hay **tres** escritores de
`setSelectedFeeNumber`. El propio archivo cuenta que eso ya produjo *«un ciclo que no converge (React
#185, Maximum update depth exceeded)»* con renting/RTO, y se tapó salteándose la coerción para esos.
No es lo de esta captura, pero el mecanismo sigue ahí para cualquier entidad cuyo plazo elegido caiga
fuera de sus opciones.

### ⚠ Y el panel anunció las entidades de OTRA sucursal

La corrida imprimió `CrediPullman #77 · Cierre X #201 · Sistecrédito #9`, que son de la sucursal
**`13874eb6`**. Pero la sesión del asesor redirige a **`ec977139`** —se ve en el log:
`302 /merchant/13874eb6/solicitar → /merchant/ec977139/solicitar`— y ahí las entidades son **Addi,
Crédito 365 y Vanti**. El panel describió un montaje que no era el que se probó. Es la misma clase que
los otros tres defectos del harness de hoy: **la herramienta afirmando lo que no midió.**

### 2026-09-15 (8) · ecommerce VALIDADO en `qa`, y qué falta todavía

> **MEDICIÓN · 2026-09-15** — el canal ecommerce cierra **entero** contra `qa`, y el arreglo de #1015
> **ya está desplegado** ahí.
> **Cómo se vuelve a comprobar:**
> `E2E_TARGET=qa CFE_TARGET=qa make harness-ecommerce TEL=3112345678`

**1 · El arreglo está vivo en el despliegue de `qa`**, medido con sondas de URL contra
`originaciones-qa.dev.creditop.com` (lectura pura, sin escribir nada):

| ruta | qa desplegado |
|---|---|
| `/merchant/…/initial-fee-payment` | **302 → login** ✅ *(cayó en el árbol del asesor; con el código viejo daría 302 → `/`)* |
| `/ecommerce/…/continue` · `/self-service/…/continue` | **200** ✅ *(con el viejo, 404)* |
| `/merchant/…/ruta-que-no-existe` | 404 — el control |

**2 · El canal, de punta a punta por API — las 8 comprobaciones en verde**, en los dos casos de la
suite (comercio **Amoblar**, sucursal `d63f05e7`, `ecommerce_request` 7341 y 7342):

    ✓ contrato armado          ✓ checkout aceptado        ✓ prefill 6/6 campos
    ✓ contexto por erId        ✓ camino del OTP (v1)      ✓ solicitud creada (uReq 502319)
    ✓ vínculo comercio ↔ crédito · fila y puente          ✓ listado · 1 entidad

El **vínculo** es el que importa: es lo que hace que el comercio reciba el veredicto de su compra, y
es justo lo que se había arreglado dentro del #997.

### ⚠ Y la primera corrida FALLÓ por la herramienta, no por el canal

`dev/ecommerce.ts` derivaba el teléfono **al azar**, que en local alcanza porque el driver de OTP no
lo mira. Contra `qa` no: el OTP sólo es predecible si el teléfono está en `qa_otp_bypass_phones` (48
entradas, **39** con forma de celular colombiano). Pasaba las cinco comprobaciones previas y moría en
`otp-validate` con **HTTP 200 sin `user_request_id`** — que se lee como un fallo del canal siendo de
la corrida. Agregado `TEL=`; es la cuarta vez en el día que la herramienta dice algo que no midió.

### Lo que NO queda validado en `qa`, y por qué

- **Las PANTALLAS.** Este runner valida el **contrato** entre front y legacy, no el render — lo dice su
  propia cabecera. Para pantallas hace falta el wizard corriendo.
- **El canal ASESOR con cuota inicial > 0**, que es donde estaba el defecto. Lo valida
  `caminar-wizard`, que **escribe en la BD** (siembra el buró y amplía la lista del bypass) — y la BD
  de `qa` es el **RDS compartido** `inertia-dev`. Eso pide `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`
  exportado a mano (F-53) y **no se corrió**: queda como decisión de Miguel. En local ese caso está
  medido antes y después (0/1 → 1/1 en estado 11).
- ⚠ **Y un matiz del `TEL=`:** al reusar un teléfono registrado se reusa un usuario que ya existe en
  `qa`, así que los dos casos reportaron **el mismo uReq 502319** y el listado dio **1 entidad** (en
  local daba 4). El vínculo se mide igual porque es por pedido, pero el prefill puede traer los datos
  de ese usuario y no los del contrato.

### 2026-09-15 (7) · #1015 MERGEADO a `qa`, y los 6 hallazgos de Sonar en #1016

**#1015 está en `qa`** (mergeado por Miguel; al cierre de esta entrada el despliegue aún no terminó).

**#1016 tenía 6 hallazgos de Sonar, y la compuerta caía por UNO solo:** «B Security Rating on New
Code», del literal `|| "http://legacy-backend.inertia-develop"` en el `getApiUrl()` de
`phone-otp-legacy.repository.ts`.

⚠ **Y ese literal no lo introduce el PR: `qa` tiene la misma línea.** Aparece como «código nuevo»
porque el revert-del-revert repone el archivo entero. **Es un costo inherente de un PR de
reposición**: todo lo que vuelve cuenta como nuevo, incluidos los problemas viejos que arrastraba.

**Arreglado con el patrón que ya usa el repo** (`nequi-payment`, `lender-return`, `user-request`): la
base sale de `VITE_API_URL` **sin respaldo** y falla explícito si falta. Ese `||` no protegía de nada
—`VITE_API_URL` ya es obligatoria, `env.server.ts` la declara en zod y `init()` aborta el arranque si
falta— y lo único que podía hacer era mandar tráfico **en claro al cluster de desarrollo**. Aplicado
también a su gemelo **`phone-otp.repository.ts`**, que tenía la misma línea y Sonar **no** había
reportado — porque su línea 7 no cae en el código nuevo del PR. Un problema real que la herramienta
no marcó.

De los otros cinco, dos se arreglaron por ser de cinco minutos y estar en archivos que el PR ya toca:
props como `Readonly` en `Landing.tsx` y `\D` en vez de `[^0-9]` en `phone-number-step-form.tsx`.

### ⚠ Dos de los seis eran FALSOS POSITIVOS, y la causa es el idioma

`loan-request-form:419` y `loan-option.entity:234` los marcaba como «Complete the task associated to
this "TODO" comment». No hay ningún TODO: **Sonar matchea la palabra española «todo» dentro de
prosa** — *«por qué no es TODO lo que llega»*, *«resuelve TODO acá»—. Es un costo recurrente de
escribir los comentarios en español, que es la convención del repo: no se cambia, se sabe.

El tercero —`amount-form:205`— **sí es un TODO de verdad**, y lo que pide es confirmar un copy **con
Lau y Oscar**. Borrarlo para callar a Sonar sería perder la pregunta. Los tres quedan, y son Info: no
tocan la compuerta.

### 2026-09-15 (6) · los dos PRs finales, un commit cada uno, y el orden de merge medido

**#1015 → `qa`** (3 archivos) y **#1016 → `main`** (28, la reposición + el arreglo). Un commit cada
uno, con el mensaje contando todo lo que se trabajó en la rama.

⚠ **Sonar rechazó la primera versión de #1015 por DUPLICACIÓN: 30,8 %** (máximo 20). La causa: las dos
rutas que agregué al árbol del asesor son idénticas a las del público, y sobre 39 líneas nuevas eso es
un tercio. **#1014 no lo había mostrado** porque sus 982 líneas diluían el mismo bloque — o sea que el
PR grande también escondía esto.

✔ **Y el arreglo de Sonar resultó ser el arreglo de fondo:** las tres rutas que tienen que existir en
los dos árboles quedan declaradas **una sola vez** en `sharedFlowRoutes(idPrefix?)` y se despliegan en
ambos. No es DRY por prolijidad: mientras se declaren por separado, **olvidar una no falla en ningún
lado** — es el mecanismo del bug, y ya había pasado dos veces en direcciones opuestas. Con esto no
puede volver a pasar por olvido. Re-verificado: las 8 sondas de URL correctas y el caminado
**1/1 en estado 11**.

**El orden de merge, medido y no supuesto:**

| paso | qué | ¿importa el orden? |
|---|---|---|
| 1 | #1015 → `qa` | no |
| 2 | **#1016 → `main`** | **SÍ: antes del paso 3** |
| 3 | promoción `qa` → `main` | ✅ medido limpio si el 2 ya pasó |

Simulado el paso 3 con el 2 aplicado: *«Automatic merge went well»*, **cero conflictos**, y los cuatro
archivos de ecommerce sobreviven. Simulado **sin** el 2: conflicto en `routes.ts` y
`available-lenders.tsx`, y resolviéndolo a favor de `qa`, `routes.ts` queda apuntando a cuatro archivos
inexistentes → build roto.

### 2026-09-15 (5) · el PR que arrastraba trabajo de otros, y por qué pasó

> **MEDICIÓN · 2026-09-15** — #1014 mostraba **15 commits y 60 archivos**. Desglosados por origen:
> **3** el arreglo, **3** la reposición, **56 cambios de `main` que `qa` no tiene** — los PRs
> **#1000-#1004** (lint y design-system: `.oxlintrc.jsonc`, `AGENTS.md`, `CLAUDE.md`, rutas de Ábaco,
> codeudor, entidad…). El 93 % del PR era trabajo ajeno, y **no aportaba nada al arreglo**.
> **Cómo se vuelve a comprobar:** `comm -12` entre `git diff --name-only origin/qa HEAD` y los archivos
> de `git show --name-only 77796a4f` (el revert) y del commit del arreglo.

**El error, y vale nombrarlo:** la rama salió de `main` y apuntaba a `qa`. Como `qa` está **13 commits
por detrás** de `main`, el diff se llevó ese desfase entero. Y la reposición de #997/#1005 **se
cancela contra `qa`** —que ya tiene ese código—, así que lo único que quedó viajando fue trabajo de
otra gente. Lo detectó Miguel mirando el contador del PR.

**Corregido:** #1014 cerrado, **#1015** abierto desde `qa` con **1 commit y 3 archivos**.

### ⚠ Y lo que NO resuelve #1015, que es de otro

`main` no recupera #997/#1005 con una promoción. Medido simulando el merge:

    CONFLICT (content): apps/loan-request-wizard/app/routes.ts
    CONFLICT (content): .../available-lenders.tsx

Y resolviendo a favor de `qa`, `main` queda con **`routes.ts` apuntando a 4 archivos inexistentes**
(`ecommerce/checkout.tsx`, `initial-fee-payment.tsx`, `down-payment-validation.tsx`,
`ecommerce-context.server.ts`) → el build se rompe. Es el mismo fallo que #997 ya se comió el 14/9.

**Eso pide un `git revert 77796a4f` explícito contra `main`**, y no es de esta tarea: la promoción
`qa` → `main` la llevan **Laura y Oscar**, y el revert lo hizo **Abel**. Queda escrito en la
descripción de #1015 para que no se lo encuentren de sorpresa.

**La regla que queda:** una rama para `qa` sale **de `qa`**. Salir de `main` apuntando a `qa` mete el
desfase entre las dos ramas dentro del PR, y el contador de archivos es donde se ve.

### 2026-09-15 (4) · corrido: el bug reproducido y el arreglo comprobado — y el harness no podía verlo

> **MEDICIÓN · 2026-09-15** — dos wizards en paralelo contra la **misma** base local: `:5174` con el
> código de `qa` (el bug) y `:5177` con la rama del arreglo. Mismo comercio, misma entidad, mismo caso.
> **Cómo se vuelve a comprobar:**
> `E2E_TARGET=local E2E_BASE_URL=http://localhost:<puerto> make harness-caminar CASOS='#13874eb6:77' FLOW=merchant CUOTA=300000 CERRAR=1 MANUAL=1`

**El caso de reproducción ya existía en local:** **Amoblando Pullman** (`13874eb6`) tiene
`allieds.initial_fee = 1` y ofrece **CrediPullman (77, `rt=2`)**. Es el mismo par de junio.

**El rebote, paso por paso, en la app de verdad:**

    ⚠ CrediPullman (rt=2) NO mandó al handoff: el front redirigió a .../initial-fee-payment
    ▸ 35 /merchant/13874eb6/466660/initial-fee-payment   [202 → /]
    ▸ 36 /                                                [202 → /merchant]
    ▸ 37 /merchant                                        [202 → /merchant/13874eb6/solicitar]
    ▸ 38 /merchant/13874eb6/solicitar                     [200]   ← la pantalla del monto

Y después **vuelve a empezar**: abre otra solicitud, elige otra vez, rebota otra vez, hasta el tope de
pasos. Cada vuelta deja una `user_request` en estado 3 — que es exactamente el hueco de las **2.167
solicitudes en «Seleccionó entidad»** que este mismo archivo tenía medido en prod.

**El antes y el después:**

| caso (canal asesor, cuota inicial 300.000) | `:5174` con el bug | `:5177` arreglado |
|---|---|---|
| **CrediPullman `rt=2`** (cierra en plataforma) | 🔴 **0/1** — rebota a `/solicitar` y cicla | ✅ **1/1**, estado **11 «Autorizada»**, 11 pantallas |
| **Bancolombia `rt=1`** (sí cobra por pasarela) | 🔴 **0/1** — rebota igual | ✅ la pantalla de cobro **responde 200** |
| self-service, sin cuota inicial | — | ✅ **1/1**, estado 11 |
| ecommerce, sin cuota inicial | — | ✅ **1/1**, estado 11 |

✔ **La fila de `rt=1` es la que prueba que el alcance era más ancho que CreditopX**: con el bug,
**cualquier** entidad con cuota inicial rebotaba en el canal del asesor.

Y a nivel URL, sobre los dos servidores corriendo:

| | `:5174` | `:5177` |
|---|---|---|
| `/merchant/…/initial-fee-payment` | **302 → `/`** | 302 → login (o sea: cayó en el árbol del asesor) |
| `/merchant/…/down-payment-validation/tx1` | **302 → `/`** | 302 → login |
| `/ecommerce/…/continue` · `/self-service/…/continue` | **404** | **200** |
| `/merchant/…/ruta-que-no-existe` | 404 | 404 *(el control: una ruta que no existe en NINGÚN árbol sí da 404)* |

### ⚠ Y lo que más vale del día: el caminador NO PODÍA ver este bug

Tres defectos del propio `dev/caminar-wizard.ts`, los tres de la misma clase —**daba verde sin haber
mirado**— y los tres arreglados (commit `a16b5c2`):

1. **`initial_fee` estaba QUEMADO en 0.** La rama entera del cobro por pasarela no se ejecutaba nunca.
   Por eso la validación del 14/9 dio verde en el canal del asesor. Ahora hay `CUOTA=`.
2. **El handoff usaba el prefijo del flujo en curso** (`/merchant/…/confirmation`), y esa ruta **no
   existe en el árbol merchant en ninguna rama**. Rebotaba, abría otra solicitud y cicíaba hasta el
   tope, reportando «se pasó de 40 pasos» — que se lee como fallo del producto siendo del runner. La
   continuación la abre el CLIENTE: va fija a `/self-service/…`.
3. **El atajo del handoff se tomaba mirando sólo el `response_type`**, sin importar a dónde hubiera
   redirigido el front — así que saltaba por encima del `/initial-fee-payment` y **cerraba en estado 11
   igual, con el flujo roto**. Medido: el mismo caso pasaba de «1/1 cerró» (falso) a 0/1 con los cuatro
   saltos impresos. Ahora el atajo exige que el front haya mandado a `/continue`.

⚠ **El punto 3 es el que asusta**: no era que la herramienta no mirara, es que **miraba y contestaba
que estaba bien**. Un runner que se saltea el paso que falla y después declara «cerró» es peor que no
tenerlo — la misma forma que el `git grep -E '\s'` y que mi propia sonda de `git cat-file` de esta
mañana.

### 2026-09-15 (3) · el arreglo, armado y probado — listo en local, sin abrir

Elegido **el camino simple**, y resultó más simple de lo que parecía: `qa` es **ancestro estricto** de
`main` (`merge-base(main, qa)` = la punta de `qa`, y `main..qa` da **0 commits**). Entonces una rama
**desde `main`** ya contiene todo lo que `qa` tiene, y el `git revert 77796a4f` que repone #997/#1005
**aplica limpio** — medido: 27 archivos, +1.062/−172, el inverso exacto del revert.

**La forma: UN PR, rama desde `origin/main`, destino `qa`.** Hace tres cosas que `qa` necesita igual
—sincroniza con `main`, repone lo revertido y arregla el rebote— y después la promoción
`qa` → `main` es normal: el revert-del-revert es un commit **nuevo**, así que ya no lo frena el
«git los da por mergeados».

**Rama:** `fix/ecommerce/cuota-inicial-rebote-asesor`, dos commits — el revert-del-revert y el arreglo
(3 archivos, +39/−5). **No pusheada, sin PR.**

**Qué arregla, y son dos defectos apilados:**

1. **Ruteo.** `initial-fee-payment` y `down-payment-validation` quedan registradas **también en el
   árbol `merchant`**. Y de yapa `continue` en el árbol **público** — el mismo defecto espejado, que
   **ya estaba vivo en `qa` aparte del bug de Joel**: `available-lenders` redirige a `continue` para
   renting/RTO y para CreditopX, y en `/ecommerce` y `/self-service` esa ruta no existía → 404.
2. **Negocio.** Vuelve el guard `&& !response.data.standBy`. ✔ **El backend SÍ sigue mandando
   `standBy`** — `UserRequestService.php` lo pone en `false` por defecto y en `true` en las dos ramas
   in-platform; el front había dejado de leerlo. Se vuelve a declarar en `LoanRequestResponse`.

**Medido antes de dar nada por bueno:**

| | resultado |
|---|---|
| `matchRoutes` (react-router 7.13.1) | `/merchant/…/initial-fee-payment` pasa de `public-layout` a **`merchant-initial-fee-payment`**; `/ecommerce/…/continue` y `/self-service/…/continue` pasan de **404** a resolver |
| `turbo run build --filter=loan-request-wizard` | ✅ **2/2**, servidor y cliente |
| `typecheck` | ✅ **0 errores** |
| `biome` sobre los 3 archivos | 2 warnings de complejidad — **idénticos en la versión de `qa` sin el cambio**, o sea pre-existentes |

⚠ **Lo que el PR arrastra:** al salir de `main`, el diff contra `qa` son ~57 archivos, de los cuales
**sólo 3 son el arreglo**. El resto es la sincronización `main`→`qa` (los PRs **#1000-#1004**, lint y
design-system, que fueron **directo a `main`** y `qa` no tiene). Es trabajo que `qa` necesita igual y el
equipo ya hace ese merge de rutina (`a3548673`), pero conviene decirlo en la descripción del PR para que
el revisor sepa dónde mirar.

⚠ **Lo que NO entra a propósito:** el intento de **#663** (que el handoff se pinte distinto en asesor
que en autogestión). Ese PR traía una URL de demo quemada y `qa` ya usa el `qrUrl` real; vale la
intención, no el código. Queda como pendiente aparte.

**Falta:** correr el canal **asesor con cuota inicial > 0** (el caso que rompe) y **ecommerce o
self-service con renting/CreditopX** (el 404 de `continue`) antes de abrir el PR.

### 2026-09-15 (2) · los catorce PRs, y el arreglo que ya existía desde junio

El libro mayor listaba **cinco** PRs y el `ramas:` del frontmatter declaraba **dos** patrones, así que
el tablero medía dos ramas. Barridos los dos repos con
`gh pr list --author mig-creditop --state all` filtrando por `ecommerce|checkout|cuota|stateless|sala`:
son **catorce**. Declaradas once en `ramas:` (la de #663 se llama `continue` a secas y no se puede
capturar sin arrastrar ramas ajenas); `make tareas-ramas` ahora mide once y **corrobora solo** lo de
abajo.

**Y lo que apareció al listarlos vale más que el listado.** Después de #551 (11/6) hubo **cinco PRs de
corrección** en `develop` —#582, #600, #661, #663, #665— y **#997 no se los llevó**. Cuatro no están
en `qa`, medido con `git grep -c standBy origin/qa` (0, contra 1 en `develop`) y con el bloque `:flow`
del `routes.ts` de cada rama.

**#665 (26/6) es literalmente el arreglo del defecto que causó el revert de septiembre**, cinco líneas,
y su comentario nombra el síntoma: *«mandarlo a Wompi rompe el flujo y rebota a /solicitar»*. O sea que
el bug no es nuevo: es un arreglo perdido. Eso **cierra la pregunta que había dejado abierta** — no hace
falta medir el 403, junio ya lo midió y lo dejó escrito en el código.

**Y #661 es el mismo defecto de ruteo, espejado:** en junio faltaba `continue` en el árbol público
(404 en ecommerce); en septiembre falta `initial-fee-payment` en el árbol merchant (rebote en asesor).
`continue` **sigue faltando hoy en `qa`**.

La regla que queda: **rehacer trabajo viejo sobre una rama nueva no se copia del PR, se copia del
estado final de la rama** — `git log origin/develop -- <rutas>` desde ese PR hasta hoy.

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
- [ ] **Mergear #1016 cuando QA valide ecommerce en `qa`** — decisión de Miguel del 15/9. Es la única
      vía para reponer el código en `main` después del revert; sin apuro porque `main` no tiene hoy ni
      la funcionalidad ni el defecto. ⚠ Tiene que entrar **antes** de la próxima promoción `qa`→`main`.
- [x] ~~🔴 **ARREGLAR EL REBOTE Y REPONER EL PR** — es lo que bloquea todo lo demás de esta tarea.
      (a) medir si el backend sigue 403eando `initial-fee-payment/{ur}` para `rt=2`; (b) registrar
      `initial-fee-payment` y `down-payment-validation/:transaction_id` en el árbol `merchant` de
      `routes.ts`; (c) si el 403 sigue, guardar el `if` de qa:637.~~ → **HECHO**: #1015 en `qa`, #1016 abierto.
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

### 2026-09-15 (9) · el botón de validar no hace nada cuando la entidad pide cuota inicial
Probando el canal en el ambiente de pruebas apareció una tarjeta con «La cuota inicial mínima es
$321.000» y el botón **no hace nada**: ni avanza, ni muestra un error, ni deja rastro en consola.
Medido: la solicitud quedó sin entidad elegida y sin moverse de estado, y no salió ni una petición —
o sea que el freno es del navegador, no del backend.

**La causa es mía, del cambio del 14/9 que sacó la cuota inicial del listado en este canal.** Esconder
el campo no elimina el mínimo que exige la entidad: lo vuelve insatisfacible. El botón evalúa «esta
entidad pide cuota inicial y no hay valor», escribe el mensaje «Ingresa la cuota inicial para
continuar» **dentro del formulario que acabamos de esconder**, hace scroll hacia ese formulario oculto
y corta. Desde el lado del cliente eso es un botón muerto, y desde el lado del comprador es un
callejón: ya pagó su carrito y no puede terminar de financiar.

⚠ **El propio comentario del cambio dice lo que debería pasar** —«primero elige entidad, y la cuota
inicial se resuelve después si esa entidad la exige»— y afirma que el cobro posterior no se toca
porque «el valor llega en 0 y el redirect no dispara solo». Eso último es justo lo que falla: el
redirect no dispara porque **el envío nunca ocurre**. La condición que bloquea tiene que mirar si el
canal ofrece el campo; si no lo ofrece, dejar pasar la elección y cobrar en su pantalla.

**Alcance, medido.** En producción **no es alcanzable hoy**: el despliegue vigente es el revert y la
línea no está en la punta de la rama principal. Pero la configuración de producción tiene **7
sucursales de ecommerce con 6 entidades** que tienen al menos una categoría con cuota inicial — una se
llama «Refurbicredit ecommerce». O sea que **entra en producción el día que se reinserte el trabajo**.

⚠ **Y eso lo vuelve un bloqueante del PR de reinserción**, que es justo el que espera el visto bueno de
QA sobre este canal: es un defecto que QA encuentra apretando un botón.

**Cómo se confirmó que en producción todavía no pasa** (y por qué el primer número era engañoso): el
evento de selección fallida por cuota inicial tiene **170 ocurrencias en producción en 30 días**, que
leídas solas parecen un incendio. Separadas por canal son **170 del asesor y 0 de ecommerce** — y en el
del asesor el campo SÍ se muestra, así que ese mensaje es la interacción normal, no un callejón. La
primera consulta de alcance también fue un falso negativo: buscó el mínimo en la tabla del par
comercio-entidad y el mínimo real vive en la **categoría** de la entidad, como porcentaje.

### 2026-09-15 (10) · PR #1018 · el botón muerto, arreglado
Rama limpia desde `qa` al día, **un commit, 6 archivos, +150/−10**, todo dentro del módulo del
marketplace: [#1018](https://github.com/Creditop-SAS/frontend-monorepo/pull/1018) → `qa`.

**Lo que se arregló y por qué esa forma.** Había **una sola** idea —«¿este canal pide la cuota inicial
acá?»— escrita en **un solo lugar**: la condición que decide si el campo se renderiza. Las otras dos
cosas que dependen de ella no la miraban: el botón, que exigía un valor igual, y el aviso de la
tarjeta, que hablaba de un mínimo incumplido. De ese desacuerdo salía el botón muerto. Ahora la idea
tiene nombre y las tres la usan.

Cuando el canal no ofrece el campo, **la elección pasa**. Eso se pudo decidir con un dato, no con una
opinión: en la configuración de producción, las seis entidades con categoría que pide cuota inicial en
sucursales de ecommerce son **todas de las que cierran en plataforma**, y ésas cobran la cuota por el
camino de adentro. O sea que dejar pasar no saltea el cobro: lo devuelve a donde corresponde.

Y el aviso pasa de error bloqueante a informativo —«No olvides que en un paso posterior debes realizar
el pago de $X»—, que es lo que Miguel describió como el comportamiento buscado. **En el canal del
asesor no cambia nada**: ahí el campo existe, y el error accionable que lleva a él sigue igual.

⚠ **La prueba que se agregó no cubre el botón, cubre el modo de fallar SILENCIOSO.** El aviso
informativo se muestra sólo si el mínimo es mayor que cero; si alguien deja de poblar ese número,
`undefined > 0` es falso, el aviso **desaparece sin ningún error** y el comprador elige entidad sin
enterarse de que tiene un pago pendiente. Cuatro casos fijan que el número viaje en las tres ramas de
la validación y que un cero llegue como cero — «no pide cuota inicial» y «no sé cuánto pide» no pueden
ser el mismo valor.

**Tres cosas de la verificación que vale registrar:**
- **el build atrapó lo que el chequeo de tipos no vio**: un reexport que faltaba en el índice del
  contexto. Es la razón por la que en este repo la vara es el build y no el typecheck;
- **lint y pruebas de ese módulo ya fallaban en `qa`** antes de tocar nada — se midió con y sin los
  cambios para no atribuirse deuda ajena ni esconder deuda propia: lint pasa de 20 hallazgos a 19, la
  complejidad del componente queda igual, y de los 4 tests que fallan ninguno es de lo tocado;
- **las pruebas del módulo no corren en esta máquina** por deriva del árbol instalado (dos versiones
  de vite y dos de vitest). Pre-existente y también en `qa` limpio. Se corrieron con la versión que
  declara el lock, y **no se reinstaló nada a propósito**: el servidor de desarrollo estaba en uso.

**Orden de merge: este PR ANTES del de reinserción.** Hoy en producción el callejón no es alcanzable
—el despliegue vigente es el revert—, pero la configuración de producción tiene 7 sucursales de
ecommerce expuestas, así que entra el día que se reinserte el trabajo del canal. Reinsertar primero
sería publicar el botón muerto.

### 2026-09-15 (11) · PR legacy-backend#1402 · el flujo sin asesor ya no entrega el proceso al que está mirando
Rama limpia desde `qa`, **un commit, un archivo, cuatro líneas efectivas**:
[legacy-backend#1402](https://github.com/Creditop-SAS/legacy-backend/pull/1402) → `qa`.

**Lo que se arregló.** Elegir una entidad en plataforma sin asesor dejaba al cliente en la pantalla de
entrega en vez de continuar. Ya existía la rama que hace lo correcto —su propio comentario dice que en
autogestión no hay a quién entregarle nada—, pero antes corría el envío del mensaje, y para una entidad
en plataforma **el link que manda es nuestra propia pantalla de confirmación**. O sea que se le avisaba
al cliente por WhatsApp que siguiera en la página que estaba mirando, y ese aviso marcaba «ya se le
entregó algo», que es justo la condición que la rama de continuar exige que NO esté. La misma marca
habilitaba y impedía.

Ahora la decisión se calcula **una vez y antes** de los avisos, y la comparten los tres lugares que
dependían de ella por separado. Es el mismo patrón que el PR del listado: una idea que estaba escrita en
un solo lugar y que otros dos consultaban de memoria.

⚠ **Y la primera versión de este arreglo iba a romper otro caso.** Suprimir el mensaje «a secas» dejaba
sin aviso a un par que hoy sí lo recibe y que NO continúa en el lugar: quedaba sin mensaje y sin destino.
Por eso la decisión se calcula con el resolver completo y no con «no hay asesor». Se vio pensándolo, no
corriéndolo — pero se vio antes de escribirlo.

**Verificación: los tres canales, antes y después.** El del asesor queda idéntico (medido: sigue yendo a
su pantalla de entrega con el handoff, y las 14 pruebas del resolver siguen verdes). Los dos sin asesor
pasan a la confirmación. Y el de la tienda **cierra entero en un solo recorrido: doce pantallas hasta
«Autorizada»**, que es exactamente lo que Miguel pidió.

⚠ **No se agregó prueba automatizada, y el motivo queda escrito:** el idiom del repositorio para esta
zona recorre el camino por HTTP sobre un esquema propio, y armarlo para este endpoint era desproporcionado
para cuatro líneas. La guarda de regresión es el arnés, que al caminar cualquiera de los dos canales avisa
si el front vuelve a aterrizar en la pantalla de entrega sin nada que entregar.

**Orden:** este PR y el del listado (#1018) son independientes — tocan repos distintos y no se pisan.
