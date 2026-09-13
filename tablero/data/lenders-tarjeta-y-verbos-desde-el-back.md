---
id: 80
title: "Lenders: la tarjeta y sus verbos los define el back"
stage: idea
ramas: feat/lenders-tarjeta-desde-el-back, feat/lenders-tabla-cards
created: "2026-09-13T11:30:00-05:00"
context_nodes: [frontend-monorepo, legacy-backend, hardcodes-entidades, entities, ms-preapprovals, microservicios, findings]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

**La fuente de verdad de este frente es el taller, no este archivo:**
https://claude.ai/code/artifact/d6933a7c-f0d2-4eb7-a4fa-4352220c6834 — un JSON a la derecha, la
tarjeta que produce a la izquierda con los tokens reales del wizard, y la traza de **quién decidió
cada renglón**. Ahí está el esquema, los seis verbos, las cuatro fases, las entidades reales de
producción como casos, y todo lo decidido con su porqué. Este archivo es el índice y el registro.

**De dónde viene.** Nació como la tarea 79 el 2026-09-11 («la tarjeta por capacidad y no por id»), ese
mismo día se plegó a Alta Fleet (76) porque parecía un renglón de esa entidad, y el **2026-09-13 Miguel
lo sacó como tarea propia**: *«no las mezclemos con los cambios de Alta»*. Alta cierra en
`frontend-monorepo#994`; todo lo que sigue es de acá.

**Cómo se trabaja, por decisión de Miguel (2026-09-13):** **sólo en local**, en ramas hechas **a partir
de `qa`**, **sin push y sin PR** hasta que haya acuerdo en el esquema. Las ramas: `feat/lenders-tarjeta-desde-el-back`
(monorepo) y `feat/lenders-tabla-cards` (backend), ambas nacidas de `origin/qa` el 13/9 y vacías. Hay
además dos ramas locales más viejas del mismo frente, `feat/tarjeta-por-capacidad` en los dos repos,
con el trabajo del 11/9 (los servicios por capacidad, la migración de `preapproval_key` +
`capabilities`): son **antecedente**, están dos commits detrás de `qa`, no se rebasean a ciegas.

**La única excepción al «sin push»:** el arreglo de la clave de pre-aprobados (F-202) va en **su propio
PR**, porque es un defecto de hoy y no depende de nada de esto. Está definido abajo; Miguel lo pidió
aparte el 13/9.

## La idea, en una línea

**El lender declara QUÉ tiene y QUÉ hace su botón; la tarjeta decide CÓMO se ve.** El back manda un JSON
con dos mitades —la **guardada** (una fila en la tabla `cards`: `hide`, `labels`, `benefits`,
`action`) y la **calculada** por petición (monto, planes, cuotas, cupo, pre-aprobado)— y el front es un
cuerpo de tarjeta más un intérprete de **seis verbos**, cada uno implementado una sola vez.

## Lo que se midió (2026-09-12 y 13) — lo que sostiene cada decisión

- **196 entidades activas; 188 son el default y 8 se salen**, en cinco ejes: beneficios (68, 100),
  renta (158), RTO (193), sin bloque de oferta (182, 183, 198) y pantalla de bienvenida (164). La
  ausencia de fila en `cards` ES el default: **las 188 nunca reciben una**.
- **`action_text` lo usan 0 de 196.** El override está mergeado y funciona; nadie puede escribirlo.
  `amount_text` (174 con valor) y `number_fee_text` (179) **no los lee nadie** — mueren, no migran.
  `conditional_text` lo lee el listado viejo de `legacy-application` (`ListLenders.vue`,
  `additionalText()`), **5 entidades** tienen algo: no se toca hasta el cutover, y es el antecesor de
  `card.footnote` (por fin el asterisco apuntaría a algo).
- **Los cuatro escritores de `additional_data` son destructivos**: `Admin\LenderController` (create y
  update, `legacy-application`) y `LenderManagementService` (create y update, `legacy-backend`)
  reconstruyen el objeto desde cuatro llaves. **Cualquier guardado borra `benefit_list` y `action_text`.**
  Por eso `cards` es tabla aparte y el admin va en apartado aparte: no es prolijidad, es que la columna
  vieja se pierde sola.
- **La respuesta del listado NO se valida con esquema**: `response.json() as LendersApiResponse` (un
  cast) y mapeo campo por campo. Una llave nueva es invisible para cualquier front que no la lea →
  **agregar no versiona; quitar o mover, sí.** `card`, `offer`, `display` están libres (sin colisión con
  las ~30 llaves actuales).
- **El tema es del comercio y ya existe**: `partner-branding` — `allieds.theme_key` (`creditop` ·
  `bancolombia` · `allied-custom`, 6 de 172 usan custom) + `token_overrides`, lista **cerrada** de 10
  tokens con degradación token por token. Su comentario cuenta la cicatriz: *«antes esto era `.strict()`
  y un token nuevo del back despintaba al partner completo por 5 minutos»*. La tarjeta degrada igual.
  Tipografía: `Satoshi-Variable`, del design system, no configurable.
- **Los verbos ya existen sin nombre**: `getLenderSelectionNextStep` (`available-lenders.helpers.ts`)
  devuelve **diez etiquetas** re-interpretando siete flags del back (`continueUrl`, `validateLenderOtp`,
  `postRedirect`, `showModal`, `url`, `openNewTab`, `openProcessModal`) más dos reglas quemadas
  (`isCalculatorProduct`, `isNequiLender`). Su comentario: *«esta función tiene que espejarlo»* al árbol
  del back, y admite que un Nequi mal configurado *«se saltearía la pantalla de cobro»*.
- **Los 138 archivos del módulo**: la tarjeta son 16; lo que engorda es que **el front orquesta**
  (`lender-resolution.service` 362 líneas, `useProgressiveLenderResolution` 301, `welli-shared-risk`
  108, `fallback-lender` 96, `preapproval-gate` 63 —cuando el back ya calcula `can_check_preapproval`—,
  8 repositorios de fetch). El back ya sabe hablarle al microservicio (`PreApprovalsAction.php`).
  Estimación honesta con el back orquestando: **138 → 45–55 archivos**, y una entidad nueva con un
  verbo existente **agrega cero**. Nequi conserva sus 9: pasan a ser la implementación de `open_terminal`.
- **La clave de pre-aprobados**: de 196, 126 (rt 2/3) van a `creditop_x` bien, 4 Welli por id bien,
  **7 aciertan por casualidad de slug y 59 mandan una clave que el registro del microservicio no
  conoce** (11 claves cerradas en `lending_product.go`). De las 59: **55 son rt=0** (flujo clásico, no
  deberían consultar) y **4 son rt=1** (`approbe`, `banco-finandina`, `bancolombia`, `compensar`) que sí
  lo necesitan y hoy fallan. Existe `lenders.requires_preapproval_gate` (real, 1 de 196 la usa): decide
  si hay compuerta, no si se consulta. `lenders.preapproval_key` **no existe en prod** — está en la rama
  local vieja.

## El esquema (resumen; el detalle vive en el taller)

    lender: { name, product: credit|rent|rent_to_own }
    action: { type: select|continue|otp|redirect|message|open_terminal, …params }   ← lo que se sabe ANTES del clic
    offer:  { currency, total, credit_limit, period: weekly|biweekly|monthly, plans[], default_plan }   ← calculada
    card:   { hide[], labels{}, benefits[{icon,text}] }                                                   ← guardada

- `card` entero es opcional: para 188 de 196 es `{}`.
- `hide` admite cualquier renglón y `offer` como atajo de los cuatro de la oferta (producción ya lo
  necesita: 182, 183, 198). **`hide` es sobre MOSTRAR, nunca sobre HACER.**
- `labels` pisa cualquier texto que la tarjeta compone (`product`, `total`, `credit_limit`, `payment`,
  `plan`, `action`); nadie tiene que escribirlos. Mata las dos ramas por id quemado del botón
  (Bancolombia «Consultar Cupo», Nequi «Finalizar la compra»).
- El nombre del producto lo compone la tarjeta desde el enum (`Crédito` · `Renta` · `Renta con opción
  de compra`); `labels.product` lo pisa. No hay `description_*`: `lenders.description` ya existe y la
  usan 188 de 197.
- Los íconos de beneficios viajan como significado (`calendar` · `money` · `percent` · `check`), no como
  clase CSS (hoy la base dice `ti ti-calendar`).
- **Los seis verbos** y su mapeo a las diez etiquetas de hoy: `select` (default) · `continue`
  (`continue`, `self-management-continue`) · `otp` (`lender-otp`) · `redirect` con `method` y `target`
  (`external-redirect`, `external-popup`, `post-redirect`) · `message` con `kind` (`modal`,
  `continue-with-qr`, `process-modal`) · `open_terminal` (`nequi-payment`). El mismo vocabulario va en la
  tarjeta (lo predecible) y en la respuesta del POST (lo que sólo se sabe después). La pre-aprobación
  **no** es un verbo (pasa al cargar, es la mitad calculada); elegir oferta de Meddipay tampoco (viaja
  dentro del `select` como `id_group`, como hoy).

## Cómo entra sin romper nada (las cuatro fases)

| fase | qué entra | qué se ve |
|---|---|---|
| 1 · tabla | `cards` vacía + el back agrega `card` **compuesto de lo que ya hay** | nada |
| 2 · front | la tarjeta lee `card` en vez de derivarlo; el back sigue mandando lo viejo | nada |
| 3 · admin | el apartado en `apps/backoffice` (ya existe `routes/lenders.config.tsx` → `/api/backoffice/lenders`) y filas para las 8 | lo que configure producto |
| 4 · limpieza | se retiran los campos viejos de la respuesta | nada, **pero esto sí es v3** |

Condiciones: la fila se busca por `lender_id` y nada más (la trampa acá es la copia por sucursal:
37.284 copias de reglas); se lee en **una** consulta para todo el listado (`whereIn`), nunca una por
entidad (el listado acaba de pasar de 124 a 86 consultas por eso); `schema_version` en la fila desde el
día uno; `calculated.plans` **no se mueve** hasta la fase 4 (moverlo antes deja al front desplegado sin
cuota y sin selector, en silencio — F-212).

**Qué repo toca qué:** `legacy-backend` (tabla, bloque compuesto, endpoint bajo `/api/backoffice/lenders`)
y `frontend-monorepo` (tarjeta + apartado del backoffice). **`legacy-application`: nada** — su listado
lee `lenders` y `additional_data`, y la tarjeta nueva vive en una tabla que ese código no consulta; el
admin tampoco va ahí (Miguel, 11/9: *«eso en algún momento queremos matarlo»*). ⚠ Durante el
parallel-run una misma entidad puede verse distinta según qué monolito atienda al comercio.

**Sobre el sobre `v2`** que propuso Miguel: funciona, pero lo que hace que el front viejo siga andando
es que la respuesta no se valida, no el anidado; y promoverlo a la raíz después es una segunda
migración. Se prefirió `card` en la raíz con `schema` adentro. El sobre conviene sólo si la intención
es reestructurar la respuesta entera.

## El PR aparte: la clave de pre-aprobados (F-202)

`lenders.preapproval_key` de **tres estados**, el mismo patrón que `can_check_preapproval`:

- una clave → se consulta con ella (126 + 4 + 7 = 137, comportamiento idéntico)
- `none` → no se consulta (los 55 rt=0: desaparecen 55 llamadas que no pueden funcionar y el
  «Reintentar» imposible)
- **NULL** → nadie se pronunció → cae a la derivación de hoy (los 4 rt=1 quedan **exactamente como
  están** hasta que alguien decida su clave; `bancolombia` probablemente sea `bancolombia_bnpl` o
  `bancolombia_consumer_loan`; `approbe`, `banco-finandina` y `compensar` **no tienen producto en el
  registro** — esa pregunta no es técnica)

Front: en `fetch-lender-preapproval.ts`, si viene `preapproval_key` se usa; si es `none` no se llama;
si falta, la cascada actual (rt 2/3 → `creditop_x`, Welli por id, slug). Es capacidad, **no** va en
`card`. ⚠ Los dos PRs (back y front) llevan cada uno su rama desde `qa`; el del front no depende del
del back porque NULL preserva el comportamiento.

## Dónde quedó (2026-09-13)

**El objetivo de esta tarea es validar VIABILIDAD, no llegar a un acuerdo formal antes de escribir**
(dicho por Miguel). Así que los verbos se fijaron midiendo el código, no opinando, y cada decisión de
abajo tiene de dónde se sacó. Todo vive en local, en cinco commits, ninguno pusheado.

| | estado |
|---|---|
| fase 1 · el bloque viaja | ✅ `legacy-backend` `0347dffa` — 86 → 87 consultas, una sola para todas |
| fase 2 · la tarjeta lo lee | ✅ `frontend-monorepo` `7f88af93` — mismo veredicto en las 7 entidades reales |
| fase 3 · endpoint del admin | ✅ `legacy-backend` `150d461e` — GET/PUT/DELETE, 7 pruebas |
| los verbos, corregidos | ✅ `legacy-backend` `bc6141f1` — la lista anterior partía de una premisa falsa |
| el intérprete de verbos | ✅ `frontend-monorepo` `78329cbf` — 768 combinaciones, cero desacuerdos |
| fase 3 · la pantalla | ⏸ la pieza más cara de rehacer (2.823 líneas de molde); ahora sí puede arrancar |
| fase 4 · retirar lo viejo | ⏸ después, y sí es una v3 |

### Las tres preguntas que faltaban, contestadas con el código

**1 · ¿Los tres redirects son tres verbos o uno con parámetros?** **Uno.** Se distinguen sólo por
(`method`, `target`): `external-redirect` = get+same_tab, `external-popup` = get+new_tab,
`post-redirect` = post+new_tab. La cuarta combinación no se usa y queda representable sin escribir una
rama. Lo confirma el backend: `openNewTab` se calcula en **un solo lugar**
(`lenderTabBehaviorResolver->opensNewTab`) después de que todas las ramas corrieron, así que `target`
ya es un parámetro y no parte de la identidad del verbo.

**2 · ¿`message` lleva un `kind`?** **No.** `modal` y `process-modal` devuelven del árbol real la
**misma forma**, con un `url || ""` de diferencia. Y `continue-with-qr` ni siquiera es un mensaje: el
árbol redirige a `/continue?url=<qrUrl>` — es `continue` con un parámetro, aunque su flag se llame
`showModal`. Tres etiquetas → un `message` con url opcional y un `continue`.

**3 · ¿La tarjeta puede declarar `otp` y `message`?** **Sí, y lo contrario era una premisa falsa mía**
que llegó a quedar fijada en un test. Medido en `UserRequestService::updateUserRequest`: a Compensar
le prende `validateLenderOtp` un **`switch ($lender->name)`**; a Meddipay, Prami, Lagobo (x2) y
Davivienda les prende `openProcessModal` un **`if` por nombre**. Ninguno mira lo que contesta la
entidad — se deciden antes de llamar a nadie. Son identidad quemada, que es justo lo que esta tabla
viene a reemplazar; excluirlos dejaba afuera **7 de las 13** entidades con su nombre en el código.

Lo que sí no se puede configurar es el **destino**: la `url` es un checkout con token, por solicitud.
Y `lenders.url` está poblada en **las 196 activas** —incluidas las que nunca redirigen—, así que
tampoco sirve para declararlo. Por eso `redirect` sale de la tarjeta, y con él `action.url`, `path`,
`method` y `target`.

**El vocabulario quedó `['continue', 'otp', 'message', 'open_terminal', 'manage']`.** `select` no está:
es la **ausencia** de verbo —el caso de 183 de 196— y tenerlo como valor daría dos formas de escribir
lo mismo. `manage` entró: es `path_id = 3` (Efectivo, Elite Vacances, Tarjeta), una rama que el espejo
de telemetría **tampoco conoce**, así que hoy esas tres se reportan mal.

Medido en prod sobre las 196 activas: `message` 5 · `manage` 3 · `continue` 2 · `otp` 2 ·
`open_terminal` 1 · las otras 183 sin `action`.

### Qué prueba el intérprete, y qué NO prueba

`resolveAction` es el árbol de `available-lenders.tsx` escrito como función pura. La prueba no son ocho
casos elegidos a mano: son **las 768 combinaciones** (2·3·2⁷) de las nueve señales que el árbol lee,
comparadas una por una contra `getLenderSelectionNextStep` —que no es una reimplementación, es el
espejo que el repo ya mantiene y con el que hoy se reporta producción—. **Cero desacuerdos.** Eso
convierte el reemplazo del árbol en mecánico, y hace que mover una rama de lugar se ponga rojo.

⚠ **Lo que NO prueba:** que el árbol de hoy esté bien. Prueba que el intérprete decide **lo mismo**.
Los dos defectos conocidos siguen ahí y quedan anotados en el propio archivo — una entidad de Nequi
configurada como renting se iría por `continue` y se saltearía el cobro; y `manage` no llega a la
telemetría. El intérprete no los arregla: los deja en **un** lugar donde arreglarlos es una línea.

⚠ **Y el ahorro honesto: la tarjeta saca 13 hardcodes por identidad, no 183 ramas.** Las otras 183
entidades siguen sin `action` y siguen haciendo el POST para enterarse. Trece de 196 suena poco hasta
que se ve qué son: son exactamente las que hoy tienen un `switch` con su nombre adentro del backend.

**Lo que sigue sin depender de nada:** el PR de la clave de pre-aprobados (F-202). Es el arreglo de un
defecto de hoy y está definido más arriba con sus tres estados.

## ⚖ ¿Vale la pena mover la tarjeta a la base? — medido el 2026-09-13

Miguel pidió seguir validando si el cambio se paga. Se midió el front entero, y la respuesta honesta
es **la mitad sí y la mitad no, y la mitad que paga no es la que estábamos construyendo.**

### La mitad que NO paga: `hide` / `labels` / `benefits` / `action`

En toda la carpeta de la tarjeta —3.086 líneas en 17 archivos— las decisiones por IDENTIDAD de entidad
son **tres**:

    LenderCard.tsx:85           if (lenderId === MEDDIPAY_LENDER_ID)
    LenderCardContent.tsx:1139  if (lenderData.id !== MEDDIPAY_LENDER_ID) return null
    LenderCardContent.tsx:1161  if (lenderData.id !== PRAMI_LENDER_ID) return null

Tres ramas, dos entidades. Sumadas las reglas derivadas que el bloque también reemplaza (el renting
esconde el monto, `show_disbursement_details` apaga la oferta, los beneficios salen de
`additional_data`), lo que se ahorra es del orden de decenas de líneas. **La fase 2 midió «no cambia
ninguna pantalla» y eso era exacto: tampoco cambia mucho el código.**

⚠ Y hay ocho usos más de ids quemados FUERA de la tarjeta —en `lender-resolution.service`,
`fetch-lender-preapproval`, `lender-response.mapper`, `lender-transaction-status.entity` y la ruta—
que el bloque `card` **no toca**: son de flujo, no de presentación.

### La mitad que SÍ paga: normalizar el PRECIO

Al abrir las tres ramas de arriba resultó que **no son sobre qué muestra la tarjeta**: son sobre **de
dónde sale el número**. Cada entidad manda su precio en otra forma dentro de `transaction_data`:

| entidad | dónde pone su cuota |
|---|---|
| Meddipay | `commercialOffer`, una cuota por plazo |
| Welli | el plan de `transaction_data` |
| Prami | `transaction_data.quotas` |

Y eso cuesta, medido:

- **149 de 405 líneas (37%)** de `lender-transaction-data.service.ts` son extractores POR ENTIDAD
  (`extractPramiQuotas`, `extractMeddipayOffers`, `extractMeddipayCreditLimit`,
  `extractWelliInstallments`, `extractMeddipayTermOptions`);
- se consumen en **cinco lugares**: `useInstallmentOptions`, `LenderCard`, `LenderCardContent`,
  `lender-resolution.service` y el barrel;
- cada uno arrastra su rama de selección («si es Meddipay usá este, si es Welli este otro»).

Los extractores **genéricos**, para comparar, tienen 1 o 2 consumidores cada uno.

**El backend ya sabe hacer esto para los otros productos.** `attachCalculatedFields` corre la fórmula
de `lenders.calculator` y produce `calculated` con `plans[]`, `payment_unit`, `default_plan` e
`initial_fee`. Meddipay, Welli y Prami no tienen `calculator` — su precio llega de su API en el
`transaction_data`, que **el backend ya tiene en la mano** cuando arma la respuesta.

### Qué significa para el plan

**El bloque `offer` del esquema del taller es el que se paga; el bloque `card` es cosmético.** Eran la
misma propuesta y hay que separarlos:

1. mover la normalización del precio al back —los tres extractores mueren en el front y la tarjeta pasa
   a dibujar `plans[]`, que es lo que ya hace con renting y RTO—;
2. `hide`/`labels`/`benefits` siguen valiendo, pero por **configurabilidad sin desplegar**, no por
   ahorro de código. Vendida como simplificación, la tabla `cards` no se sostiene con los números.

⚠ **Y el ahorro no se mide en entidades de hoy sino en las de mañana.** Son tres entidades con forma
propia sobre 196; visto así es poco. Pero cada entidad nueva con un precio propio agrega hoy un
extractor **más una rama en cinco archivos**, y eso es exactamente la queja de «138 archivos para
listar algo». Normalizado en el back, una entidad nueva es un mapeador y cero cambios en el front.

## 🔧 El lugar único, hecho y validado (2026-09-13)

Se probó la idea de Miguel —«los componentes externos simples y uno solo con la lógica»— sobre el caso
medido arriba, y **funciona**. `resolveLenderOffer` junta la cascada que estaba en tres archivos:

| | antes | ahora |
|---|---|---|
| `useInstallmentOptions` | Welli + Meddipay + external | «¿contestó la entidad?» (−37 +14) |
| `LenderCardContent` | un `useMemo` por entidad ×3 | uno (−54 +25) |
| `lender-resolution.service` | leía el tarifario de Prami | lo pide al mismo lugar (−6 +12) |

Neto en los llamadores **−97 +51**; con el servicio nuevo el total **no baja**. Lo que se gana es que el
hecho tiene un dueño, que una entidad nueva es una rama en un archivo, y sobre todo que **ahora se puede
probar**: esa lógica vivía dentro de un hook de React y del `useMemo` de un componente, en un módulo
donde vitest ni arranca.

**Cómo se validó sin pruebas en el módulo:** una prueba diferencial que transcribe literalmente las tres
cascadas de hoy y las compara — **324 combinaciones** para los plazos y **1.296** para la cuota. Encontró
tres cosas que no se veían leyendo:

1. un Meddipay con tarifario vacío **no** cae a las cuotas de crédito (el código devuelve adentro del
   `if`); mi primera versión sí caía;
2. con Welli ya actualizado, la cuota entra por `calculate-loan-financials.uc`, que pisa
   `estimatedFeeAmount` — mi referencia no modelaba ese camino y acusó una diferencia inexistente;
3. **el resultado vivo es sólo de Welli** (`setExternalFinancials` se llama en un lugar y tras parsear
   con el schema de Welli), así que la rama genérica `if (externalFinancials)` de `useInstallmentOptions`
   hoy **no la alcanza nadie**.

## ⚠ Y el diagnóstico de «tantos archivos» era otro

Medido el módulo entero: **141 archivos de código, 16.318 líneas** (más 24 de prueba). Pero:

- **62 archivos tienen menos de 50 líneas.** Ésos no son el problema, y juntarlos lo empeoraría.
- **8 archivos tienen el 30% de las líneas.**

Y esos ocho no fallan por lo mismo:

| archivo | líneas | qué es |
|---|---|---|
| `LenderCardContent.tsx` | 1.242 | **16 componentes en un archivo** y 7 `useMemo`: es DIBUJO apretado, no lógica |
| `AvailableLenders.tsx` | 972 | **42 hooks y CERO componentes**: es orquestación pura |
| `LenderCard.tsx` | 636 | 6 componentes, 9 hooks |

**La conclusión invierte el pedido:** `LenderCardContent` no necesita menos archivos sino **más** —16
componentes no caben en uno—, y el que sí necesita el tratamiento del lugar único es
**`AvailableLenders.tsx`**, donde 42 hooks deciden sin una sola prueba. Reducir el conteo de archivos no
es la palanca; sacar las decisiones de los componentes a funciones puras y probables, sí.

## 🔧 Segunda pasada: `AvailableLenders` (2026-09-13)

Era el candidato que salió de la medición —972 líneas, 42 hooks, cero componentes— y entre medio
decidía **quién se ve, cuál va destacada y qué tan vacía está la pantalla**: siete `useMemo` y cinco
constantes sueltas, sin una sola prueba.

`buildMarketplaceView` se lleva esas decisiones. Resultado medido:

| | antes | ahora |
|---|---|---|
| líneas | 972 | **932** (−81 +41) |
| hooks | 42 | **39** |
| complejidad de biome | 52 | **45** (sigue sobre el límite) |
| imports de entidades | 6 | **0** |

Los seis que se fueron: `computeHiddenFallbackLenderIds`, `computeHiddenWelliRiskLenderIds`,
`isServerErrorResolution`, `isWelliInstallmentLender`, `isWelliLender` y `supportsLiveReprice`. **El
componente dejó de saber de Welli, de fallbacks, de errores 5xx y de re-precio** — ése es el cambio, no
las 40 líneas.

**Validado igual que la vez anterior:** prueba diferencial con las siete decisiones transcritas tal como
están hoy, comparadas en **5.760 combinaciones** (6 listas × 6 mapas de estado × 5 «mejor aprobada» × 2
montos × 4 juegos de banderas × 2 × 2). Cero desacuerdos. Lo que había que cubrir eran los **cruces**: la
mejor aprobada escondida por un fallback, un 5xx sobre la recomendada del backend, Welli con variantes
mezcladas.

Tres reglas quedaron fijadas por prueba, ninguna protegida hasta hoy:

- **hay TRES clases de vacío**, no un booleano: `soft` deja las tarjetas y quita la destacada; `true` la
  reemplaza por el aviso naranja y deja las tarjetas igual;
- la destacada **cae a «la primera aprobada que siga visible»** cuando la mejor quedó escondida;
- las reglas de Welli se calculan **sobre las visibles**, o la variante escondida le apaga el selector a
  la que sobrevivió.

⚠ **`tsc` atrapó lo que el build no ve.** Los tipos `readonly` de la primera versión chocaban con los
ayudantes que ya existen y con las props de los consumidores. Se quitaron en vez de castear: un cast
tapa el día que alguien sí mute. **El build de Vite no typechequea** — correr `tsc` aparte no es opcional.

### El patrón, ya probado dos veces

1. medir dónde está la decisión (no dónde está el código);
2. escribirla como función pura en `lib/domain/services/`;
3. **validar con una prueba diferencial contra la transcripción literal de lo que hay hoy**, en muchas
   combinaciones, no en casos elegidos;
4. recién ahí cambiar el llamador.

Las dos veces la prueba encontró algo que no se veía leyendo, y las dos veces era un error mío.

## 🔧 Tercera pasada: partir `LenderCardContent` (2026-09-13)

El tercer archivo grande, y **el diagnóstico es el opuesto a los otros dos**: 1.243 líneas con
**dieciséis componentes** y sólo 7 `useMemo`. Ahí no sobraba lógica, sobraba apretujamiento. Necesitaba
más archivos, no menos — así que este cambio no extrae nada, mueve.

| archivo | líneas | qué agrupa |
|---|---|---|
| `LenderCardContent.tsx` | 1.243 → **267** | el contenedor y su hook de oferta por defecto |
| `LenderCardVariants.tsx` | **379** | las dos tarjetas que existen: crédito y calculadora |
| `LenderCardSummaries.tsx` | **286** | los cinco que dibujan NÚMEROS |
| `LenderCardPrimitives.tsx` | **255** | el botón, los selectores, un monto, los tooltips |
| `LenderCardBodyDetails.tsx` | **155** | los renglones, los beneficios y las alertas |

El criterio de cada corte quedó escrito en la cabecera de su archivo. El de las primitivas es el que más
manda: **no deciden nada**. Si una necesita un `useMemo` con reglas de negocio, no es una primitiva.

**Cómo se verifica un movimiento puro**, que no es lo mismo que verificar un cambio: no alcanza con que
compile, hay que probar que el código **es el mismo**. Se compararon las definiciones de nivel superior
de antes contra las de los cinco archivos de ahora — **40 antes, 40 después**, ninguna perdida, ninguna
nueva, ningún cuerpo distinto salvo dos firmas que biome partió en varias líneas.

⚠ **Y esa comparación encontró un defecto que ni el build ni `tsc` veían.** Al mover
`useDefaultOfferSelection` quedó sin usar en `LenderCardVariants`, y el arreglo `--unsafe` de biome lo
**renombró** a `_useDefaultOfferSelection` en vez de borrarlo: quedaban dos copias, una muerta, y ningún
aviso. **Con `--unsafe` hay que mirar lo que hizo** — «no quedan avisos» no es «no quedó basura».

### El balance de las tres pasadas

| | antes | después |
|---|---|---|
| `AvailableLenders.tsx` | 972 líneas · 42 hooks · complejidad 52 | 932 · 39 · **45** |
| `LenderCardContent.tsx` | 1.243 líneas · 16 componentes | **267** en 5 archivos |
| decisiones probables | 0 | **3 servicios puros, 5.760 + 1.620 + 324 combinaciones** |

El módulo pasó de 141 a 145 archivos de código: **la cuenta subió, y eso está bien**. Lo que bajó es lo
que importaba — cuánto hay que leer para entender una decisión, y cuánto se puede probar sin montar
React.

## 📏 Medido antes de seguir: `LenderCard` y `useLenderSelection` (2026-09-13)

Se midieron los dos que quedaban **antes** de decidir, y dan respuestas opuestas.

### `LenderCard.tsx` — 635 líneas, 9 componentes → PARTIR, no extraer

Mismo caso que `LenderCardContent`, más chico: `LenderCardInner` (248), `CollapsibleLenderCard` (94),
`FeaturedLenderCard` (62) y seis piezas menores. **Un solo `useEffect` de efecto real y cero `useMemo`.**

Y lo que decide `LenderCardInner` es **estado de pantalla**, no reglas: `isExpanded`, `showContent`,
`shouldShowRevolvingFooter`, el grosor del borde. La única regla de negocio del archivo
—`resolveShouldShowFee`, el selector de cuotas de Welli y Meddipay— **ya es una función pura** de 14
líneas. No hay nada que extraer.

**Veredicto: vale, es mecánico y de bajo riesgo, pero es menos urgente** — 635/9 contra el 1.243/16 que
ya se partió. Va cuando haya rato, no antes que otra cosa.

### `useLenderSelection.ts` — 443 líneas, UN hook de 336 → NO tocarlo ahora

Sus **quince** condiciones, clasificadas a mano:

| qué es | cuántas |
|---|---|
| guardas del ciclo de React Router (`isSubmitInFlight`, `lastProcessedActionData`, `lastProcessedError`) | **6** |
| realidad del navegador (el popup se bloqueó, la ventana se cerró sola) | **3** |
| despacho sobre la respuesta (`postRedirect`, `showModal`, `tryPopup`) | **3** |
| negocio (`usesCalculatorOffer`, confirmación de la entidad) | **2** |

**Diez de quince son ciclo de vida y realidad del navegador, y eso no se puede mover a una función
pura: coordinar envíos de React Router, bloqueadores de popups y modales ES complicado.** Ese archivo
es grande porque su trabajo lo es. Extraer las 2 de negocio movería seis líneas y dejaría 330.

⚠ **Pero las 3 del despacho son otra cosa: son la mitad CLIENTE del árbol de verbos.**
`resolveAction` ya modela la mitad servidor (`response.data` → verbo); este `useEffect` es
`actionData` → qué hace el navegador. El día que el intérprete se adopte de verdad, estas 111 líneas
pasan a ser un `switch (action.verb)`. **No están bloqueadas por falta de ganas: están bloqueadas por
el intérprete**, y adelantarlas sería escribir el mismo despacho por tercera vez.

### La regla que sale de haber medido cinco archivos

Antes de partir o extraer, mirar **qué proporción del archivo es decisión**:

- mucha decisión y poco dibujo → **extraer a una función pura** (`AvailableLenders`, las tres cascadas);
- mucho dibujo y muchos componentes → **partir** (`LenderCardContent`, `LenderCard`);
- mucho **efecto y ciclo de vida** → **dejarlo** (`useLenderSelection`). Un hook que coordina el
  navegador no se simplifica moviéndolo: se simplifica cuando lo que despacha ya viene decidido.

## ✅ Adoptado: el `actionHandler` decide por verbo (2026-09-13)

El intérprete dejó de ser una pieza al costado. Las **once ramas** del `actionHandler` se eligen por
`action.verb`, y el `next_step` del evento lee **ese mismo valor** — con lo que **F-213 queda arreglado
en local**: ya no hay dos lugares que puedan separarse.

**Una rama menos, y salió de leer los cuerpos para migrarlos:** «modal con url para copiar» y «modal de
proceso» devolvían el **mismo objeto**, con un `url` contra `url || ""` de diferencia. Son un solo caso.
**11 → 10.**

⚠ **La complejidad NO bajó: 54 → 55.** Y a mitad de camino había subido a **57**, porque las guardas
nuevas eran compuestas (`method === "post" && envelope !== null`) donde antes `!isNil(...)` estrechaba
gratis. Se arregló **modelando mejor, no aceptándolo**: `redirect` pasó a ser una unión **discriminada**
—un POST siempre lleva sobre y nunca url, un GET al revés— y las tres guardas de nulo se cayeron solas.

**Este cambio no era para achicar esa función.** Era para que la decisión tenga un dueño y se pueda
probar. Tres constantes se fueron del route (`MANAGED_LENDER_PATH_ID`, `isCalculatorProduct`,
`isNequiLender`): el árbol dejó de preguntar quién es la entidad.

⚠ **El espejo no se borra.** `getLenderSelectionNextStep` queda como **referencia congelada** de la
prueba diferencial de 768 combinaciones. Mientras esté, mover una conducta sin querer se pone rojo;
borrarlo se lleva esa red. Su docblock ya lo dice.

⚠ **Y `tsc` atrapó cuatro cosas que el build no ve** —los estrechamientos de `postRedirect`, de la url
del modal, de la del popup, y dos tipos de mis propias pruebas—. Ninguna habría fallado compilando.
**El build de Vite no typechequea: correr `tsc` aparte no es opcional.**

### ⚠ Lo que creí que desbloqueaba, y NO

Escribí acá que las 111 líneas del `useEffect` de `useLenderSelection` «ya pueden pasar a ser un
`switch (action.verb)`». **Es falso, y se ve leyendo los cuerpos** —que es lo que no había hecho—.

El bloque de `postRedirect` tiene **tres salidas**, y la tercera es la que rompe la idea:

1. el sobre no pasa el schema → aviso de error y **corta**;
2. el navegador bloqueó el popup → `setReadyLender` para que el botón de la tarjeta reintente con el
   gesto del usuario, y **corta sin modal a propósito** («taparía justo ese botón»);
3. **se abrió bien → NO corta: sigue al bloque del mensaje** para dejarle al asesor su modal de proceso.

Y no es un descuido: el `actionHandler` **fuerza** `showModal: true` en esa rama justamente para eso —el
checkout se abre en otra pestaña y el modal es lo único que le dice al asesor que algo pasó—.

**Ese caso son DOS resultados —redirigir Y avisar— y un verbo es UN valor.** Un `switch` los perdería.
La lectura de formas que hace este efecto no está duplicando una decisión como hacía el espejo de
F-213: está expresando una **composición**, que es otra cosa.

⚠ **Y agregarle el verbo al `actionData` tampoco sirve**: el cliente ya distingue bien los tres casos
por su forma, así que el campo nuevo no lo leería nadie. Un campo que no se usa es peor que no tenerlo.

### Y lo que sí se hizo: probarlo primero, después moverlo

El efecto tenía complejidad **25** —el único aviso del archivo— y 111 líneas de `setState` y analítica
con tres pasos sin nombre. Se hizo en **dos commits separados a propósito**, en ese orden:

**1 · El contrato y sus pruebas, sin tocar el hook.** `selectionEffects` devuelve una **lista ordenada
de efectos**, que es la forma correcta justamente porque un verbo no alcanza: la lista sí puede decir
«esto y después esto otro». La referencia es la transcripción literal del cuerpo de hoy, con los
`setState`, la analítica y las notificaciones cambiados por un grabador. **675 combinaciones, cero
desacuerdos.**

El generador atrapó otro estado imposible inventado por mí —«hay sobre pero no se intentó abrir»—; se
restringió el generador, no el veredicto.

**2 · El efecto pasa a ejecutar la lista.**

| | antes | ahora |
|---|---|---|
| `useLenderSelection.ts` | 443 líneas | **415** |
| complejidad de biome | **25** | **sin aviso** |

El efecto quedó en tres cosas: las dos guardas del ciclo de React Router, abrir la ventana, y un bucle.
`applySelectionEffect` es el único lugar que traduce un efecto en llamadas: cinco `case` cortos.

⚠ **Abrir la ventana sigue FUERA de la lista**, y no es una inconsistencia: el navegador sólo concede
una pestaña nueva en el mismo tick del gesto del usuario. Si esperara a que se arme la lista, la
trataría como popup no solicitado. Por eso `checkoutToOpen` existe aparte.

⚠ **Lo que las pruebas NO cubren:** las dos guardas de arriba (`isSubmitInFlight` y la comparación por
identidad con `lastProcessedActionData`). Son del ciclo de React Router y siguen sin red — escrito para
que nadie lea «probado» de más.

⚠ Y `tsc` volvió a atrapar lo que el build no ve: el nombre del evento de analítica es una unión
**cerrada** y mi contrato decía `string`. Compilaba, y dejaba pasar un nombre inventado — que en
analítica no falla: **se pierde**.

## 🔧 `LenderCard` partido, y el balance del frente (2026-09-13)

Último de los grandes. Mismo diagnóstico que `LenderCardContent`, más chico: 635 líneas y **nueve
componentes**, con cero `useMemo` y un solo `useEffect` de efecto real. No sobraba lógica: sobraba
apretujamiento.

| archivo | líneas | qué agrupa |
|---|---|---|
| `LenderCard.tsx` | 635 → **327** | `LenderCardInner`, sus props y `resolveShouldShowFee` |
| `LenderCardShells.tsx` | **202** | los dos envoltorios: la plegable y la destacada |
| `LenderCardParts.tsx` | **140** | ícono, tooltip, pie del rotativo, etiquetas, «validando» |
| `lender-card.variants.ts` | **29** | los dos marcos (`cardVariants`) y su tipo |

⚠ **Lo de `cardVariants` no es prolijidad.** Vivía dentro de `LenderCard.tsx` y **seis** archivos lo
importan de ahí —varios de los cuales `LenderCard` importa a su vez—, o sea que **el ciclo ya existía**.
Al partir en tres iban a ser dos ciclos más. En su propio archivo no hay ciclo posible. `LenderCard`
los **sigue reexportando**, así que los seis importadores no se tocan: migrarlos es otro cambio,
mecánico, y mezclarlo volvía imposible leer cuál de los dos rompió algo.

**Verificado como movimiento puro:** 17 definiciones antes, 17 después, ninguna perdida, ninguna nueva,
y un solo cuerpo distinto — una firma que biome partió en varias líneas.

### El balance del frente

| | al empezar | ahora |
|---|---|---|
| archivos de código del módulo | 141 | **150** |
| archivos de más de 400 líneas | 5 | **3** |
| `LenderCardContent.tsx` | 1.243 | **267** |
| `LenderCard.tsx` | 635 | **327** |
| `AvailableLenders.tsx` | 972 · complejidad 52 | **933 · 45** |
| `useLenderSelection.ts` | 443 · complejidad 25 | **416 · sin aviso** |
| decisiones con prueba | 0 | **4 servicios puros** — 768 + 324/1.296 + 5.760 + 675 combinaciones |

**El conteo de archivos SUBIÓ de 141 a 150, y eso está bien.** Lo que bajó es lo que importaba: cuánto
hay que leer para entender una decisión, y cuánto se puede probar sin montar React. Pedir «menos
archivos» habría empeorado los dos.

## 🔧 Segunda pasada de `AvailableLenders`, y un resultado negativo (2026-09-13)

La primera sacó la **forma** del marketplace. Estos tres eran lo que quedaba decidiendo adentro:

- `applyRecalculatedPlans` — el `calculated` que recalcula el backend, encima;
- `enrichLoanOptions` — fusionar la resolución, los overrides de Welli, y ordenar, **en ese orden**;
- `consultationProgress` — disponibles, bloqueadas por política, y el pendiente del copy.

| | antes | ahora |
|---|---|---|
| líneas | 932 | **901** |
| `useMemo` | 15 | **13** |
| complejidad de biome | 45 | **45** |

⚠ **LA COMPLEJIDAD NO BAJÓ, y el motivo vale más que el número.** Lo extraído es código de **línea
recta** —`map`, `filter`, `sort`— y la complejidad cognitiva cuenta **ramas**, no líneas. Lo que quedó
en el componente son los `if` de verdad: los estados de la pantalla y el árbol de render. Bajar de 45
pide **partir el JSX**, que es otro trabajo.

**Lo que sí se ganó son dos reglas de TIEMPO** que vivían sólo como comentario y ahora tienen prueba:

1. **el reparto del gate sale del PAYLOAD, no de `resolutionStates`.** El evento que lo reporta se
   dispara en el primer render, cuando todos los estados están en `processing` —los sembrados llegan
   recién en el primer microtask—: contar por estado daría **0 bloqueadas siempre**;
2. **`consultedPendingCount` cuenta sólo las consultables**, mientras `pendingResolutions` y
   `allResolved` cuentan todas. Esos dos gobiernan cuándo termina la pantalla y cuándo se manda el
   snapshot de `lender-results`; mezclarlos rompe ese contrato.

Y una tercera quedó escrita al mover: en `applyRecalculatedPlans` las llaves llegan como **string** —es
JSON— y los ids son números. Sin el `String(lender.id)` no matchea ninguna y **el recálculo se pierde en
silencio**, que es el peor modo de fallar para algo que cambia una cuota en pantalla.

### La regla, corregida por este caso

A la de las tres pasadas anteriores —decisión → extraer, dibujo → partir, efecto → dejar— le faltaba
una distinción: **extraer código de línea recta baja las líneas y no la complejidad.** Si lo que se
busca es bajar el número de biome, hay que ir por las **ramas**, y en un componente las ramas viven en
el JSX.

## ⚖ «¿Y si dejamos un solo repository y un solo service?» — medido (2026-09-13)

Pregunta de Miguel. La respuesta corta es **no a las dos**, pero la pregunta encontró algo real que no
es ninguna de las dos.

### Por qué NO un solo repositorio

Hay **10 implementaciones**, y no son divisiones arbitrarias: cada una habla con una **familia de
endpoints distinta**.

| repositorio | contra qué |
|---|---|
| `loan-options` | el listado: `lenders-v2`, `recalculate`, `lender-results` |
| `loan-request` | `/api/loans/customer/requests/*` — otro servicio entero |
| `lender-return` | el regreso de Cuotéalo/BCP |
| `welli-amount` | `welli/update-amount` |
| `qr` · `post-redirect` · `user-request` · `lender-transaction-status` | uno cada uno |

Juntarlas da **una clase de ~1.000 líneas con 20 métodos contra 8 superficies del backend**. Es
exactamente el `LenderCardContent.tsx` de 1.243 líneas que esta misma tarea acaba de deshacer. La regla
de hoy —**un repositorio por familia de endpoints**— es fácil de seguir y dice dónde va lo próximo.

### Por qué NO un solo servicio

**13 servicios, 2.354 líneas**, partidos por regla de negocio: `card-config`, `fallback-lender`,
`welli-shared-risk`, `preapproval-gate`, `holder-name`, más los cuatro de esta tarea. Un
`LenderService` de 2.354 líneas es el mismo error con otro nombre.

### Lo que la pregunta SÍ encontró: hay dos formas de hablarle al backend

| | repositorios |
|---|---|
| `HttpClient` + `ApiResult` + zod (el patrón del ADR-0001, el que usa el backoffice) | **2** |
| `fetch` pelado | **8** |

Y la validación es despareja: **`loan-options.repository` —el del LISTADO, el más importante— no valida
NADA**. Tres castes: `response.json() as Promise<LendersApiResponse>`, `as RecalculatedLenders`, y un
`return await response.json()` sin tipo. Lo que el backend mande entra tal cual.

⚠ Esto ya había aparecido en esta tarea por otro camino —«la respuesta del listado no se valida con
esquema»— y explica por qué la fase 1 pudo agregar la llave `card` sin que nada se enterara. Es a la vez
la razón por la que el cambio fue barato **y** la razón por la que un cambio de forma en el backend no
se nota hasta que algo se ve raro en pantalla.

**Lo que sí valdría centralizar, entonces, no es «un repositorio»: es UNA MANERA de hacer un
repositorio.** Y el primer candidato es el del listado, que es el que más tráfico mueve y el único sin
red.

⚠ **Y un dato del mismo barrio:** los 8 puertos de `lib/ports/repositories` tienen **exactamente una
implementación cada uno y CERO dobles de prueba**. La costura para probar los use-cases existe y no la
usa nadie. No es para borrarla —es justo la que haría falta el día que se quieran probar— pero conviene
saber que hoy no compra nada.

## 📏 «150 archivos es absurdo · ¿y un store tipo Pinia?» — medido (2026-09-13)

Dos preguntas de Miguel. **La intuición del encadenamiento es correcta y medible; la del store llega
tarde, porque ya hay uno.**

### Qué son los 150 archivos

| carpeta | archivos | líneas |
|---|---|---|
| `lib/domain` | 28 | 4.069 |
| `components/lender-card` | 23 | 3.194 |
| **`lib/application`** | **20** | **638** |
| `components/available-lenders` | 19 | 3.116 |
| `lib/infrastructure` | 14 | 1.431 |
| **`lib/ports`** | **11** | **183** |
| `components/nequi` | 9 | 1.328 |
| el resto | 26 | 2.902 |

**`lib/application` + `lib/ports` son 31 archivos y 821 líneas: el 21% de los archivos y el 5% del
código.** Y medido uno por uno: **15 de los 20 use-cases tienen un `execute` de UNA línea que sólo
delega**. `GetLoanOptionsUc` entero son 10 líneas para llamar a `repository.getByLoanRequestId`, más
un puerto de 14 para declarar esa firma. Sólo 2 de los 20 hacen algo sustancial
(`calculate-loan-financials`, 95 líneas; `validate-loan-amount`, 67).

⚠ Y los 8 puertos tienen **una implementación cada uno y cero dobles de prueba**. Borrar el pasamanos
son ~23 archivos menos; el costo es cerrar la costura que haría falta el día que se quieran probar los
use-cases. **Es un canje con número, no una obviedad en ninguna de las dos direcciones.**

### El store ya existe, y es más fino que un Zustand ingenuo

`components/context/LenderMarketplaceContext.tsx` —392 líneas— es un store hecho a mano con
`useSyncExternalStore` y **suscripción POR ENTIDAD**: expone `useRequestedAmount`,
`useSelectedFeeNumber`, `useSelectedOffer`, `useExternalFinancials`, `useIsUpdatingAmount`,
`useAmountConditions`, `useCategoryCredipullman`, `useInitialFeeValue` y más.

Cambiarlo por Zustand o Jotai **no bajaría el conteo de archivos ni quitaría una sola prop**, porque las
props que sobran no son estado compartido.

### Pero el encadenamiento SÍ está, y se arregla sin librería

Props declaradas por la cadena: **18 → 17 → 22 → 42 → 19**.

Las 29 de `StandardLenderCardContent` se reparten así: 8 son **banderas de presentación** que calcula el
padre (`shouldShowBenefitList`, `shouldAddTopPadding`, `shouldApplyDarkBackground`…), 7 son **datos por
tarjeta**, 3 **callbacks**, 6 **banderas de estado**… y **cuatro ya están en el store**.

⚠ **`selectedOffer`, `selectedFeeNumber`, `isAmountUpdating` y `requestedAmount` viajan por los DOS
caminos a la vez.** `LenderCardContent.tsx` recibe `selectedOffer` como prop **y** llama a
`useSelectedOffer`. Eso no lo arregla una librería: se arregla **dejando de bajarlas**.

### El veredicto

1. **No hace falta un store nuevo** — hay uno, y es bueno.
2. **Sí hay props de más**, y las primeras cuatro son gratis: ya están en el store.
3. **El conteo de archivos sí se puede bajar ~23**, pero por el lado del pasamanos, no del store. Y
   tiene un costo real.
4. **Las 8 banderas de presentación** son el siguiente bocado: las calcula el padre y podrían salir de
   una función pura como las cuatro de esta tarea.

## ❌ Las «cuatro props duplicadas» no existían — y de dónde viene la sensación de profundidad

### Mi error, primero

Escribí que `selectedOffer`, `selectedFeeNumber`, `isAmountUpdating` y `requestedAmount` «viajan por los
dos caminos a la vez». **Es falso.** Lo derivé cruzando «el store la sirve» con «algún componente la
lee», que no es lo mismo que «el mismo componente hace las dos cosas». Cruzado bien, quedaban **dos**
casos, y ninguno es duplicación:

- `LenderMarketplaceContext` recibe `requestedAmount` y expone `useRequestedAmount` — **es el provider**:
  por definición recibe lo que expone;
- `LenderCardVariants` tiene los dos hermanos resolviéndolo distinto… **porque la regla es distinta**.

⚠ **Y quitarla habría metido un bug.** El `selectedFeeNumber` que baja por props **no es** el que da el
store: `useInstallmentOptions` devuelve `getValidSelectedFeeNumber(...)`, el valor **ya validado contra
las opciones disponibles**. El hook del store da el crudo. Para renting y RTO el hook explícitamente
**no** coerce —los planes cuentan pagos, no cuotas—, y por eso `CalculatorLenderCardContent` sí lee del
store y `StandardLenderCardContent` no. No es inconsistencia: es la regla.

**Nada que quitar.** Anotado porque el error es instructivo: un conteo cruzado mal parece un hallazgo.

### Lo que sí se midió: «toco 20 archivos para un cambio»

203 commits al marketplace en 6 meses, sin merges:

| archivos por commit | commits |
|---|---|
| 1 | 31% |
| 2–3 | 31% |
| 4–9 | 28% |
| 10–19 | 10% |
| **20 o más** | **1%** (2 de 203) |

**Mediana: 3 archivos.** Los dos de 20+ son features enteras: integrar el servicio async de
pre-aprobados (24) e integrar Nequi (23).

**Pero la sensación no es sobre la cantidad: es sobre la PROFUNDIDAD, y ahí Miguel tiene razón.**
Midiendo **capas distintas** por commit —puerto, use-case, repositorio, entidad, servicio, mapper,
tipos, store, hook, componente, ruta—:

| capas | commits |
|---|---|
| 1 | **48%** |
| 2 | 18% |
| 3 | 13% |
| **6 o más** | **10%** |
| máximo | **10 capas** |

**La mitad de los cambios toca una sola capa. Pero uno de cada diez cruza seis o más** — y ésos son los
que duelen, los que se recuerdan y los que forman la sensación. Los peores:

    10 capas · 24 archivos   integrar el servicio async de pre-aprobados
     9 capas · 23 archivos   integrar el flujo de pago Nequi
     9 capas ·  9 archivos   resumen financiero en la pantalla de lenders

⚠ **El patrón: los que cruzan muchas capas son los que traen un DATO NUEVO desde el backend.** Entidad →
mapper → repositorio → use-case → puerto → servicio → hook → componente → ruta. Y es exactamente donde
15 de esos archivos no hacen nada (los use-cases pasamanos y sus puertos).

**Así que las dos mediciones se juntan:** la profundidad no molesta en el 90% de los cambios, y en el
10% restante lo que se atraviesa es, en buena parte, ceremonia. Eso vuelve la poda del pasamanos un
canje mucho más claro de lo que parecía cuando se miró sola.

## 📏 El encadenamiento de props, medido — y las dos conversaciones separadas (2026-09-13)

Miguel separó dos cosas que yo había mezclado, y tiene razón en separarlas:

1. **La hexagonal para pegarle al backend** (puertos + use-cases pasamanos) le parece sobreingeniería,
   **pero es decisión del ARQUITECTO** — ya hubo fricción por no usar las capas. ⛔ **No se toca
   unilateralmente.** Lo que queda de esta tarea para esa conversación son números, no una propuesta:
   15 de 20 use-cases tienen un `execute` de una línea que delega; los 8 puertos tienen una
   implementación cada uno y **cero dobles de prueba**; y de los commits que cruzan 6+ capas, buena
   parte atraviesa justo esa ceremonia.
2. **El paso de props entre componentes**, que es lo que de verdad le molesta. Eso sí es del equipo del
   front y se midió.

### Cuántas props no hacen nada más que pasar de largo

Una prop «de paso» es la que un componente **declara y reenvía sin usarla**:

| componente | props | sólo reenvía | |
|---|---|---|---|
| `LenderCard` | 17 | 3 | 18% |
| `LenderCardShells` | 12 | 1 | 8% |
| `LenderCardContent` | 22 | **7** | 32% |
| `LenderCardVariants` | 30 | **14** | **47%** |
| `LenderCardBodyDetails` | 19 | **9** | **47%** |

**34 de 100 props declaradas en la cadena sólo pasan de largo**, y en los dos últimos eslabones es casi
la mitad. Ahí está la sensación de «toco cuatro archivos y tres no aportan nada»: es literal — tres de
esos cuatro sólo escriben el nombre de la prop dos veces.

### Por qué un store no lo arregla, y qué sí

Las 29 props de `StandardLenderCardContent` se agrupan solas:

| grupo | cuántas |
|---|---|
| banderas de presentación (`should*`, `is*`, `variant`, `show*`) | **15** |
| la oferta y su plata (`financialData`, `formatMoney`, `validation`, `selected*`…) | **8** |
| manejadores (`on*`) | **4** |
| el resto (`lenderData`, `statusMessage`) | 2 |

**Tres bolsas cubren 27 de 29.** Y eso es lo que ataca el problema de verdad: hoy **agregar un campo
obliga a declararlo y reenviarlo en cada eslabón**; con una bolsa, agregar un campo toca **al que lo
produce y al que lo consume, y a nadie más**. Los intermediarios reenvían el objeto y no se enteran.

⚠ Un store no sirve para esto: 15 de las 29 son **banderas calculadas por el padre para ESA tarjeta**,
no estado compartido. Meterlas en un store global sería peor.

**Las dos opciones reales, con su canje:**

- **bolsas** (`presentation`, `offer`, `handlers`): quita el reenvío sin agregar indirección; el costo
  es que los tipos se vuelven más gruesos y hay que decidir qué va en cuál;
- **un contexto por tarjeta**: quita el reenvío del todo, pero agrega una indirección y vuelve más
  difícil ver de dónde sale un valor — que es el defecto que esta tarea pasó el día corrigiendo en
  otros lados.

Mi recomendación son las **bolsas**: es el cambio que hace que «agregar un campo» deje de tocar cuatro
archivos, sin comprarse un mecanismo nuevo.

## Riesgos y preguntas abiertas

- **`preapproval_key` de los 4 rt=1** — decisión de negocio, no técnica.
- **El trade-off de la orquestación**: hoy las tarjetas aparecen a medida que cada entidad resuelve. La
  salida que conserva eso: el back devuelve el listado al instante con la resolución pendiente y el
  front corre **un** poll genérico por tarjeta. ⚠ Transmitir desde el back no sale gratis: el único
  streaming del wizard hoy es el SSR de React Router, no un stream de datos.
- **Mover la orquestación al back es un proyecto más grande que la tarjeta.** La tarjeta con `action`
  es su fase cero; no hay que esperar el resto para hacerla.
- **Las pruebas del módulo están rotas** (23 archivos, vitest 1.6.1 vs vite 7.3.3) y **ningún workflow
  del repo corre tests**. Lo que se agregue acá se prueba con Node directo o Storybook hasta que la
  suite vuelva.
- **La tipografía del taller** es Geist, no Satoshi (Google Fonts es el único host que admite el CSP).
  Colores, radios y tamaños sí son los del sistema.

## Registro

### 2026-09-13 · fase 3, mitad del backend: el apartado del admin ya tiene endpoint

`legacy-backend`, commit local `150d461e` — sin push. `GET`, `PUT` y `DELETE` en
`/api/backoffice/lenders/{lender}/card`, hermanos de `config` y `rules`, con su FormRequest de
vocabularios cerrados, su servicio y 7 pruebas.

**La decisión de diseño de la pantalla:** el documento devuelve **tres** cosas —`composed`, `stored`
(null para 188 de 196) y `effective`—. Sin las tres la pantalla miente por omisión: sólo `stored` deja
un formulario vacío para una entidad que SÍ esconde el monto porque es renting, y sólo `effective`
hace imposible distinguir «lo escribió alguien» de «salió solo». Y `DELETE` es de primera clase, no el
efecto de guardar vacío: la tabla existe para tener SÓLO las excepciones.

Probado de punta a punta contra la base local: Motai Renting sin fila da el compuesto; guardar sólo
una etiqueta deja vivo el `hide` compuesto; `hide: []` lo apaga y la etiqueta sobrevive; `DELETE`
devuelve la tabla a cero; lender inexistente da 404.

⚠ **`Modules/Backoffice/tests/Feature` arrastra `RefreshDatabase`** — se corrió sólo `tests/Unit` (29
pasadas, 0 fallidas). Vale anotarlo: es una de las seis carpetas que pueden recrear la base.

**Lo que falta de la fase 3 es la pantalla**, y es la pieza más cara de todo el frente: el módulo que
sirve de molde (`modules/backoffice/lender-config`) son **13 archivos y 2.823 líneas**, más su
repositorio, su hook y su ruta. Es también la más cara de rehacer si el esquema cambia, así que
conviene no escribirla antes de que el esquema esté acordado.


### 2026-09-13 · fase 2 hecha en local: la tarjeta lee el bloque, y sigue sin verse

`frontend-monorepo`, rama `feat/lenders-tarjeta-desde-el-back`, commit local `7f88af93` — sin push.
`card-config.service` es la frontera: `hidesCardRow`, `cardLabel`, `cardBenefits`. El componente
consume eso en vez de derivar de tres fuentes.

**La prueba que importa:** contra el backend real, las 7 entidades de un listado dan el **mismo
veredicto** con el bloque y sin él —los cinco renglones y la cuenta de beneficios—, así que la
pantalla queda igual. Más 22 aserciones sobre la cascada (sin bloque manda la regla vieja; con bloque
manda el bloque; a medias sólo pisa lo que declara; `hide: []` apaga la regla vieja; un bloque que no
es objeto se ignora entero). Build del wizard verde, `tsc` con los mismos 16 errores preexistentes,
biome limpio con los 2 avisos de complejidad que ya estaban.

Se cayeron tres imports muertos, y uno tenía filo: `shouldShowBenefitList` exigía que el lender fuera
uno de `BANCOLOMBIA_LENDER_IDS`, así que una entidad nueva podía traer beneficios configurados y **no
verlos nunca**. Hoy no cambia ninguna pantalla —sólo 68 y 100 los tienen— pero cambia la regla.

⚠ **El `.test.ts` no se puede correr**: la suite del módulo sigue rota de antes (vitest 1.6.1 contra
vite 7.3.3, 23 archivos) y **ningún workflow del repo corre tests**. Las mismas aserciones se
corrieron con `tsx`. Y ojo con el atajo: `lodash` es CJS y no da exports nombrados fuera del bundler
—por eso `card-config.service` no lo usa, que además es más correcto: `isEmpty` de lodash devuelve
`true` para un número.


### 2026-09-13 · fase 1 hecha en local: la tarjeta viaja y no se ve

`legacy-backend`, rama `feat/lenders-tabla-cards`, commit local `0347dffa` — sin push. La tabla
`cards`, el modelo, `CardComposer` y el bloque colgado de cada entidad en `LenderListingService`.

Medido con disciplina de opcache y solicitud viva: **86 → 87 consultas**, tres corridas por lado, y la
de `cards` es **una sola para todas las entidades**. La composición verificada en sus cuatro caminos
—crédito pelado, `show_disbursement_details = 0` → `hide: [offer]`, `rto` → `action: continue`, y los
beneficios reales de Bancolombia 68 y 100—, más la fila guardada pisando campo por campo con una fila
sembrada a mano y revertida. `down()` borra la tabla y re-correr la migración no hace nada. La suite
del módulo: 54 fallidas / 379 pasadas contra 54 / 368 sin el cambio — mismos fallos preexistentes y
+11 nuevos.

⚠ **Y una hora perdida persiguiendo un fantasma, que conviene no repetir.** El listado empezó a
devolver 0 entidades y parecía una regresión mía; no lo era, y tampoco era `qa`. Las solicitudes
locales de prueba **habían sido borradas**: `dev/listado.ts` corre `scrubphone` antes de cada
registro, y ese scrub empareja por los **últimos 10 dígitos** y borra el usuario *con sus
solicitudes*. El teléfono que genera es `313` + `Date.now() % 9.000.000`, o sea que **se repite cada
2 horas y media**: una corrida de la tarde borra la de la mañana. La pista que lo delató fue que el
arnés reportaba ids **por encima** del `AUTO_INCREMENT` de la tabla. Lo que sí se descartó en el
camino: las peticiones repetidas **no** agotan una solicitud (11 listados seguidos, 7 entidades
siempre). Para medir, solicitud fresca y de una.


### 2026-09-13 · nace como tarea propia; el taller queda como fuente de verdad

Miguel cortó Alta en `frontend-monorepo#994` y sacó este frente a su propia tarea, para trabajarlo en
local desde `qa` sin push. Se crearon las dos ramas vacías. El día se fue en el taller: tokens reales
del wizard, llaves en inglés, el nombre del producto derivado del enum, las entidades reales de
producción como casos, la tabla `cards` y las cuatro fases, la respuesta al `v2`, los tres campos
viejos medidos, la calculadora y los pre-aprobados explicados, la capacidad de pre-aprobado con su
columna real, la contabilidad honesta de los 138 archivos (corrigiendo la primera versión, que defendía
la frontera equivocada), y los seis verbos sacados de `getLenderSelectionNextStep`. Nada de código en
los repos: todo es diseño, y es a propósito.

## Tarea (publicable)

## En una línea

Que cada entidad del listado defina desde el admin qué muestra su tarjeta y qué hace su botón, sin
que cada entidad nueva requiera código en la pantalla.

## Por qué

Hoy la pantalla del listado decide por identidad de la entidad qué renglones mostrar, qué dice el
botón y qué pasa al tocarlo. Cada entidad que se porta distinto agrega lógica, y la pantalla crece con
cada una. Producto no puede cambiar un texto ni ocultar un renglón sin un despliegue, y lo poco que se
configuró a mano se pierde al guardar desde el admin.

## Qué cambia

Una configuración por entidad —renglones a ocultar, textos, beneficios y la acción del botón— que la
pantalla interpreta. Las entidades sin configuración se ven exactamente igual que hoy. La calculadora,
la pre-aprobación y los flujos de cada entidad no cambian.

## Alcance

Entra: la configuración por entidad, su lectura en el listado, y el apartado del admin. No entra:
cambiar los flujos posteriores al clic, el tema visual del comercio (ya existe aparte), ni el listado
del sistema anterior, que sigue igual.

## Dónde probar

En el listado de entidades de una solicitud, con una entidad configurada y una sin configurar.

## Cómo validar

La entidad sin configuración se ve idéntica a hoy. La configurada muestra sólo los renglones y textos
que se le indicaron, y su botón hace lo que se le indicó.

## Criterios de aceptación

- Ninguna entidad sin configuración cambia de aspecto ni de comportamiento.
- Una entidad configurada refleja la configuración sin despliegue.
- Guardar desde el admin no borra configuración existente.

## Dependencias / contraparte

Producto define la configuración de las entidades que cambian; el resto queda en el default.
