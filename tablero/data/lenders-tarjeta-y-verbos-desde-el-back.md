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
