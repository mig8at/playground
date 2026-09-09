---
id: 76
title: "Alta Fleet: la entidad de renting propia del comercio, con PEP"
stage: evaluation
created: "2026-09-09T10:00:00-05:00"
context_nodes: [motai, merchants, creditopx, backoffice, hardcodes-entidades]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

**Alta Fleet** es un comercio de MOTOS que entra como *upselling* con SaaS de $250.000 y **línea de
crédito propia** — o sea el modelo **CreditopX** (`response_type = 2`): el capital y el riesgo son del
comercio y CreditOp opera y cobra comisión. Es el mismo molde que **Motai**, y por eso hereda dos
rasgos suyos: producto de **renting/rent-to-own** sobre moto, y población **gig/migrante** que necesita
el tipo de documento **PEP** (Permiso Especial de Permanencia).

**El comercio YA EXISTE en producción y nadie lo terminó.** Está creado desde el 2026-08-31 con su
sucursal en Bogotá y sus reglas duras copiadas, pero cableado a las **dos entidades de Bancolombia**
(agregadores externos, `rt=1`) — no a una entidad propia. **Cero solicitudes en 9 días.** Lo que falta
es exactamente lo que pidieron: su entidad de renting.

Lo que **ya no hay que investigar**: el mecanismo del PEP (es un campo de la entidad, no de la
sucursal, y el admin ya lo edita), quién escribe las reglas duras (hay API de backoffice en `main` que
las escribe y las propaga), y qué le falta a una entidad `rt=2` para operar (el código lo define en
cinco chequeos — ver «Lo que está decidido»).

**El próximo paso es:** que Miguel decida **renting u opción de compra** (§«Lo que está bloqueado»),
porque de eso dependen el catálogo de documentos y la calculadora, que son las dos piezas que sí
piden código.

## Objetivo

Que un cliente que entra por la sucursal de Alta Fleet en Bogotá vea la entidad propia del comercio en
el listado, pueda elegir **PEP** como tipo de documento, y que la solicitud cierre — con las reglas
duras y los perfiles cargados y **alineados entre el listado y el cupo**.

## Dónde se toca

**Nada de esto es código nuevo: casi todo es configuración con dueño ya construido.**

- `legacy-application` (el admin vivo) — crear la entidad: `app/Http/Controllers/Admin/LenderController.php:88`
  (`store`/`update`). ⚠ Es el único lugar donde se pone `document_types` (el PEP) y `response_type`;
  el comentario del propio `update` (`:110`) lo dice: *«Los tipos que acepta esta entidad, por ser esta
  entidad: Motai acepta PEP y Pullman no, y eso no depende del comercio ni del punto de venta»*.
- `legacy-application` — economía por comercio: `AlliedLenderController` (pantalla `aliados/{a}/entidades`).
  ⚠ **F-127**: esa pantalla borra `lender_guarantee_criteria` y `payment_methods_by_lender`, que NO
  tienen columna de comercio, y sólo las repone si `rt == 2`. Acá es `rt=2`, así que repone — pero
  guardar la calculadora de OTRA entidad no-rt2 del mismo comercio las borraría.
- `legacy-application` — activación en la sucursal: `AlliedAlliedBranchController::update:102`
  (borra y recrea `lenders_by_allied_branches` y dispara la copia de reglas).
- `legacy-backend` `Modules/Backoffice` (en `main`) — **la pieza que cambia el plan**:
  `routes/backoffice.php` bajo `api/backoffice`, con `cognito.token:staff`.
  · `PUT lenders/{id}/rules` → `LenderRulesWriterService.php:124` escribe la **plantilla** de
    `lender_rules` **y los clones por sucursal**, más `lender_datacredito_rules` genérica y por
    sucursal, más los **perfiles** (`lender_users_categories` + `..._category_rules`, donde vive
    `minInitialFee`). Todo en una transacción y con versionado optimista (`baseVersion`, 409).
  · `GET lenders/{id}/readiness` → `LenderReadinessService.php` — los cinco chequeos de «listo para operar».
  · `PUT lenders/{id}/config/identity` (NIT del originador) · `/identity-validation` · `/cutoff` · `/credentials`.
  · `POST lenders/{id}/rules/simulate` y `simulate/by-document/{doc}` — **no escriben nada**.
- `legacy-backend` — lo que NINGÚN panel toca y sí pide migración: `lenders.product`,
  `lenders.calculator` (el JSON de `plans`/`params`/`formulas` que evalúa
  `app/Support/FormulaCalculator.php`), `lender_signing_documents` y `lender_requirements`.
- `harness` — `.flows.json` (mapa `merchants`), un `dev/montar-alta.ts` con el molde de
  `dev/montar-rto.ts`, y una suite con el molde de `suites/motai-creditopx.json`.

## Cómo se ataca

En cuatro entregas que se pueden parar en el medio. **Las tres primeras no tocan producción.**

1. **Montar Alta Fleet en LOCAL** (`dev/montar-alta.ts`, idempotente y con `--clean`, como
   `montar-peru.ts`): comercio + sucursal en Bogotá (`country_city_id = 149`) + la entidad `rt=2` con
   `document_types` incluyendo `PEP`, clonando el árbol de config del molde que se elija. Entrada en
   `.flows.json` como `alta`.
2. **Ejercitar el flujo por consola**: `make harness-listado COMERCIO=alta` (¿aparece la entidad?) y
   `make harness-caso` con `CERRAR=1` (¿cierra?). Suite declarada en `harness/suites/alta.json`.
   Lo que hay que ver además del cierre: que el selector de tipo de documento **ofrezca PEP**.
3. **Decidir el producto y escribir sus dos piezas de código**: la migración del `calculator` y la del
   catálogo `lender_signing_documents`. Esto depende de la decisión bloqueada, y de que legal
   entregue las plantillas.
4. **El runbook de producción**, en este ORDEN — y el orden está medido, no es preferencia:
   crear la entidad en el admin (con PEP) → `PUT /rules` del backoffice (deja la **plantilla** sola,
   sin clones, porque todavía no hay sucursal habilitada) → cargar la economía por comercio →
   **recién ahí** activarla en la sucursal, que copia la plantilla ya escrita → `GET /readiness` para
   confirmar los cinco chequeos.

## Lo que se evaluó y NO se eligió

**Crear todo con SQL a mano, como se hizo con el Rent to Own** (tarea #61). Fue lo correcto entonces
—el backoffice no existía— y hoy es la peor opción: `montar-rto.ts` copia reglas y perfiles del
hermano 170 «sin revisar», que es exactamente lo que el docblock de la migración del clon desaconseja
(*«un gemelo a medias con reglas de riesgo copiadas sin revisar, que es peor que no tenerlas»*), y
además deja la plantilla y los clones **desalineados**, que es el defecto que el
`LenderRulesWriterService` existe para evitar. Sirve para local; no para el runbook de producción.

**Clonar Motai Renting con una migración**, como se hizo para el RTO. Se descarta por lo que ya
enseñó ese clon: el `product` y la calculadora que corren en cada ambiente los puso una **migración
que no existe en el repositorio**, así que un clon no es reproducible y lo que se valide en un
ambiente no predice el otro. Para Alta la calculadora hay que **escribirla**, no heredarla.

**Copiar el `document_types` a la fila de sucursal** (`lenders_by_allied_branches`). Era el mecanismo
viejo y es el que produjo **F-76** (la fila nueva nace en NULL y el PEP desaparece sin error ni log).
Ya no hace falta: `DocumentTypesService::resolver()` lee `lenders.document_types` de las entidades
activas, une, y recorta con el catálogo del país.

**Usar el gemelo `Modules/Partner` de legacy-backend** para el CRUD del comercio. Está habilitado pero
su CRUD **no lo consume nadie**: el admin vivo sigue siendo el panel Inertia de `legacy-application`.

## Lo que está decidido

> **MEDICIÓN · 2026-09-09** — el comercio ya existe en producción y está a medias: `allieds` 346
> «Alta», Colombia, hash `384205e9`, creado 2026-08-31 16:41; una sucursal, `allied_branches` 2262
> «Calle 90», hash `8ab6c783`, Bogotá D.C. (`country_city_id` 149). Cableado a las entidades **68**
> (Bancolombia · Compra y paga después) y **100** (Bancolombia · Crédito de consumo), las dos `rt=1`
> y `status=1`, con sus reglas duras SÍ copiadas (grupos `AB2262` 10839 y 10840, 6 reglas cada uno).
> `have_ctopx=0`, `initial_fee=0`, `show_products=0`. **0 solicitudes.**
> `SELECT * FROM allieds WHERE id=346` · `SELECT ... FROM allied_branches WHERE allied_id=346` ·
> `SELECT COUNT(*) FROM user_requests WHERE allied_id=346` (prod, solo lectura)

> **MEDICIÓN · 2026-09-09** — no existe en NINGÚN otro ambiente: `allieds WHERE name LIKE '%Alta%'`
> devuelve 0 filas en dev y 0 en local. O sea que montarlo en local es trabajo nuevo, no una copia.

> **DECISIÓN · 2026-09-09** — «activar el documento PEP» es **un campo de la ENTIDAD**, no de la
> sucursal, y ya se edita desde el admin viejo. `DocumentTypesService::resolver()` toma las entidades
> activas de la sucursal, une sus `lenders.document_types`, y **recorta con el catálogo del país**
> (Colombia = `["CC","CE","PEP"]`, verificado en la BD). El país es techo, no piso: si el cruce queda
> vacío manda el país. Consecuencia práctica: basta con crear la entidad con `["CC","CE","PEP"]`.

> **MEDICIÓN · 2026-09-09** — en prod las tres entidades del molde: `158` Motai Renting
> (`product=renting`, calculator 651 B, `["CC","CE","PEP"]`), `193` Rent to Own (`product=rto`,
> calculator 515 B, `["CC","CE","PEP"]`) y `62` Motai X (`product=credit`, sin calculator,
> `["CC","CE"]`). ⚠ **El 193 hoy corre con `product = 'rto'`**, no con `renting` — el nodo `motai`
> lo describe como clon con `product=renting`, y eso cambió: su calculadora usa la matriz de plazos
> (`12/18/24`, `weeks 52/78/104`) y no la de planes semanales del 158.
> `SELECT id,product,calculator FROM lenders WHERE id IN (62,158,193)`

> **DECISIÓN · 2026-09-09** — «listo para operar» no es opinión: lo define
> `Modules/Backoffice/App/Services/LenderReadinessService` con cinco chequeos, y la política dura
> **no bloquea a propósito** (*«un lender sin reglas no está incompleto, está sin filtros»*):
> 1 · **identidad** — `lenders.originator_nit` cargado, si no la pasarela rechaza los pagos.
> 2 · **validación** — un proveedor ACTIVO en `order 1`; sin eso el flujo lanza excepción.
> 3 · **pagos** — al menos un comercio con cuenta de Wompi lista.
> 4 · **perfiles** — al menos un perfil con fila en `lender_users_category_rules` (*«una categoría
> sin criterios no existe para el motor»*).
> 5 · **política dura** — se reporta el conteo, con `blocking: false`.

> **DECISIÓN · 2026-09-09** — las reglas duras **no se escriben a mano**: `PUT
> /api/backoffice/lenders/{id}/rules` escribe la plantilla (`group_rule_id IS NULL`) Y los clones por
> sucursal en una sola transacción, con los perfiles y sus criterios, y con `baseVersion` para no
> pisar el trabajo de otro (409). Su docblock nombra el defecto que evita: la plantilla la evalúa el
> **cupo** de CreditopX y los clones el **listado** del onboarding, y verlas divergir es lo que hace
> que una entidad aparezca en el listado y después falle al pedir cupo.

> **MEDICIÓN · 2026-09-09** — el orden del runbook importa, y se lee en el código: el writer crea
> clones sólo para las sucursales donde la entidad YA está habilitada
> (`bootstrapBranchGroups`, y sólo cuando no hay ninguna fila previa). Al revés, el admin viejo
> (`addNewLenderRule`) copia como plantilla las `lender_rules` **huérfanas** de la entidad — que en
> una entidad nueva son **cero** —, así que crea el `GroupRule` `AB<sucursal>` **vacío**. En local ya
> hay cuatro grupos así en la sucursal 682 de Motai (7846, 7847, 3603, 7861, con 0 reglas cada uno).
> Por eso: **escribir la política ANTES de activar la sucursal.**
> `SELECT g.id,r.lender_id,COUNT(r.id) FROM group_rules g LEFT JOIN lender_rules r ON r.group_rule_id=g.id WHERE g.allied_branch_id=682 GROUP BY g.id,r.lender_id`

> **MEDICIÓN · 2026-09-09** — lo que NINGÚN panel puede poner, verificado por ausencia en `main`:
> `lenders.product` y `lenders.calculator` no aparecen ni en `legacy-application`
> (`Admin/LenderController` + sus `StoreRequest`/`UpdateRequest`) ni en `Modules/Backoffice`;
> `lender_requirements` no tiene ningún controller de admin en `legacy-application`; y
> `lender_signing_documents` sólo se crea desde migraciones. **Ésas cuatro son el código de la tarea.**

## Lo que está bloqueado

> **PREGUNTA · 2026-09-09 · Miguel** — ¿el cliente de Alta Fleet **se queda con la moto** o la
> devuelve? No es cosmético y no se puede diferir: decide el catálogo de documentos, la calculadora y
> el perímetro legal. Sin opción de compra no hay saldo → no hay interés → **no aplica el techo de
> usura**; con opción de compra sí hay interés y el PRD de Motai lo llama con sus palabras *«un
> crédito disfrazado de arriendo»*. Y ⚠ la terminología del código está **invertida** respecto del
> PRD: el `renting` del código es el *rent-to-own* del PRD.

> **PREGUNTA · 2026-09-09 · Miguel** — ¿en qué ambiente hay que dejarlo listo? El comercio existe sólo
> en **prod**. Local no tiene ni el comercio ni la entidad; dev tampoco. La propuesta es local primero
> (entregas 1-3) y prod por runbook al final, pero si lo que hace falta es que opere ya, el orden cambia.

> **PREGUNTA · 2026-09-09 · Andrés / Fabián** — ¿Alta Fleet **reemplaza** las dos entidades de
> Bancolombia o **convive** con ellas? Si conviven, el cliente elige el documento antes de saber qué
> entidad le toca y los tipos se UNEN, así que el PEP aparecería también para el camino Bancolombia.
> Y ⚠ guardar la calculadora de una de las de Bancolombia (`rt=1`) desde la pantalla de entidades del
> comercio **borraría** `lender_guarantee_criteria` y `payment_methods_by_lender` de esa entidad sin
> reponerlas (F-127).

> **PREGUNTA · 2026-09-09 · legal** — las plantillas del contrato. Es el hueco conocido del Rent to
> Own: legal entregó **sólo las versiones con deudor solidario**, y como
> `SigningDocumentResolver::resolveForPolicy()` filtra por `requires_cosigner`, la rama sin codeudor
> devuelve vacío. Si Alta Fleet va a ofrecer un perfil sin codeudor, sus documentos hay que pedirlos.

## Riesgos

> **RIESGO · 2026-09-09** — activar la entidad en la sucursal **antes** de escribir su política deja
> el `GroupRule` vacío, y según el docblock del writer eso hace que *«esa sucursal ofrecería el lender
> sin ningún filtro mientras el cupo lo rechaza con la política recién guardada»*. En producción eso
> es ofrecer crédito sin reglas duras. Es el motivo del orden del paso 4, y el motivo de que esto se
> mida en local antes.

> **RIESGO · 2026-09-09** — el catálogo de documentos es lo que distingue renting de rent-to-own, **no
> el `product` ni la calculadora**. Una entidad nueva sin catálogo propio no falla con error: o firma
> el contrato equivocado, o no genera ningún documento. Los dos síntomas son silenciosos y cambian
> según el ambiente.

> **RIESGO · 2026-09-09** — la copia de reglas del admin **se traga la excepción** y avisa por mail a
> santiago@creditop.com (`LenderRulesController.php:364`). Si algo falla al habilitar la sucursal, la
> pantalla no lo dice.

## Lo que NO entra

- **Ábaco.** Motai lo usa porque su población gig no tiene historial en el buró, y se prende por
  entidad con `lender_requirements.abaco_is_enabled`. Hasta que alguien lo pida para Alta Fleet, no
  entra — y en dev/qa **no hay mock**, así que sólo se puede ejercitar en local.
- **El codeudor.** Es un recorrido entero (invitación → token → onboarding → OTP → firma) con su
  propio nodo y sus propios hallazgos. Sólo entra si el producto elegido lo exige.
- **El SaaS de $250.000** y cualquier cobro de suscripción: el sistema no tiene esa pieza y no es de
  esta tarea.
- **Tocar la configuración de las dos entidades de Bancolombia** del comercio.
- **Escribir en producción** desde acá. Las entregas 1-3 son local; la 4 es un runbook para que lo
  ejecute quien tenga el panel.

## Cómo se comprueba

    # 1 · el comercio y su sucursal, montados en local
    E2E_TARGET=local node harness/dev/montar-alta.ts

    # 2 · ¿le sale la entidad al cliente, y por qué no las otras?
    make harness-listado COMERCIO=alta

    # 3 · ¿cierra el flujo entero?
    make harness-caso CASOS='alta' CERRAR=1 LAMBDA=1

    # 4 · la suite, que falla si algo no cumple lo declarado
    make harness-suite SUITE=harness/suites/alta.json CERRAR=1 LAMBDA=1

    # 5 · los cinco chequeos, contra el propio código (pide token de staff)
    curl -H "Authorization: Bearer $TOKEN" localhost/api/backoffice/lenders/<id>/readiness

Y el chequeo que no es un comando: que el selector de tipo de documento de `personal-info` **ofrezca
PEP**. Se ve en la respuesta de `GET /api/loans/allied/{hash}` en `allowed_document_types`.

## Registro

### 2026-09-09

Aterrizaje. Se midió el estado real en los tres ambientes y se encontró que **el comercio ya existe
en producción a medias** — lo que convierte «crear un comercio» en «terminar el que hay». El contexto
de negocio salió de Slack (#comercial, 2026-08-27, Andrés García): *marca de upselling, negocio de
motos, SaaS de $250.000 y línea de crédito propia*, con su registro en HubSpot.

El hallazgo que cambia el plan es `Modules/Backoffice` en `main`: hay API para escribir la política
dura y los perfiles, propagarlos a las sucursales, simular sin escribir y preguntar por los cinco
chequeos de «listo para operar». La tarea #61 tuvo que hacer todo eso con SQL a mano porque en agosto
eso no existía. **No se escribió una línea de código todavía**, a pedido.

⚠ Dos cosas quedaron sin poder verificarse: **Confluence** rechaza la credencial de miguel@creditop.com
(el token venció — `https://creditop.atlassian.net/rest/api/3/myself` devuelve 401), así que el «por
qué» de negocio no se pudo cruzar contra la documentación; y **no hay issue de Jira** para esto.

<!-- ─────────────────────────────────────────────────────────────────────────────────────────────
     DE ACÁ PARA ABAJO ES LO ÚNICO QUE SALE A JIRA.
     ───────────────────────────────────────────────────────────────────────────────────────────── -->

## Tarea (publicable)

## En una línea

Dejar operativo el comercio Alta Fleet con su propia entidad de financiación de motos, aceptando como
documento el Permiso Especial de Permanencia.

## Por qué

Alta Fleet entró como comercio nuevo con línea de crédito propia, y hoy está creado a medias: tiene su
punto de venta en Bogotá pero sólo las entidades de un banco externo, ninguna propia. En nueve días no
ha entrado una sola solicitud. Su público —trabajadores de plataformas y migrantes— usa PEP como
documento, y hoy ese tipo no se le ofrece.

## Qué cambia

- Al cliente que entra por el punto de venta de Alta Fleet le aparece la entidad del comercio en el
  listado de opciones de financiación.
- El selector de tipo de documento ofrece **PEP** además de cédula y cédula de extranjería.
- La entidad queda con sus reglas de otorgamiento y sus perfiles cargados, y con las mismas reglas en
  el listado y en el cálculo de cupo.

## Alcance

Entra la puesta a punto del comercio, su punto de venta de Bogotá y su entidad propia. **No** entra la
validación de ingresos de aplicaciones de reparto, **no** entra el recorrido con codeudor, **no** entra
el cobro de la suscripción mensual, y **no** se toca la configuración de las entidades de Bancolombia
que el comercio ya tiene.

## Dónde probar

Ambiente local primero, con el comercio y el punto de venta sembrados por las herramientas de prueba. En producción
existe ya el comercio **Alta**, punto de venta **Calle 90** (Bogotá).

## Cómo validar

1. Entrar al onboarding por el punto de venta de Alta Fleet.
2. En el formulario de datos personales, comprobar que el selector de tipo de documento ofrece **PEP**.
3. Completar el flujo con un cliente que cumpla las reglas y comprobar que la entidad del comercio
   aparece en el listado de opciones.
4. Elegirla y llegar hasta la firma; la solicitud debe quedar **Autorizada**.
5. Repetir con un cliente que NO cumpla una regla dura (por ejemplo, ingreso por debajo del mínimo) y
   comprobar que la entidad no se le ofrece.

## Criterios de aceptación

- El selector de documento ofrece PEP en el punto de venta de Alta Fleet.
- La entidad del comercio aparece en el listado para un cliente que cumple las reglas.
- Un cliente que no cumple una regla dura no la ve.
- El cupo que ofrece la tarjeta y el que calcula el sistema al continuar **coinciden**.
- La revisión de configuración de la entidad da los cinco chequeos en verde.

## Dependencias / contraparte

- **Producto / comercial:** definir si el cliente termina siendo dueño de la moto o la devuelve. De eso
  dependen el contrato que firma y la forma de la cuota.
- **Legal:** las plantillas del contrato del producto elegido. Para el producto con opción de compra
  hoy sólo existen las versiones con codeudor.
- **Comercial:** confirmar si la entidad propia conviven con las dos de Bancolombia o las reemplaza.
