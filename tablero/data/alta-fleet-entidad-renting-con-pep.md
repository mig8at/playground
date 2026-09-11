---
id: 76
title: "Alta Fleet: entidad propia, pantalla de bienvenida y autogestión"
stage: work
ramas: feat/comercio-pantalla-de-bienvenida
created: "2026-09-09T10:00:00-05:00"
context_nodes: [motai, merchants, creditopx, backoffice, hardcodes-entidades]
jira: [CORE-558]
jira_title: "Alta Fleet: entidad propia, pantalla de bienvenida y autogestión"
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

**Producto decidido: Rent to Own** — el cliente se queda con la moto (Miguel, 2026-09-09).

**Ya está montado y corriendo en LOCAL** (`harness/dev/montar-alta.ts`, idempotente y con `--clean`):
el comercio, la sucursal de Bogotá y la entidad **AltaX** (`rt=2`, `product=rto`, con PEP), con las
reglas duras **alineadas** entre plantilla y clon de sucursal. Medido: **lista** y **ofrece PEP**.
**No cierra**, y la causa no es del comercio nuevo: es **F-188**, un mapa por id de entidad quemado en
el generador de documentos — el propio Rent to Own de Motai falla igual en local.

Lo que **ya no hay que investigar**: el mecanismo del PEP (es un campo de la entidad, no de la
sucursal, y el admin ya lo edita), quién escribe las reglas duras (hay API de backoffice en `main` que
las escribe y las propaga), qué le falta a una entidad `rt=2` para operar (el código lo define en
cinco chequeos), y por qué no cierra (F-188, medido por los dos lados).

⚠ **Y el 2026-09-09 a las 12:06 alguien creó la entidad en PRODUCCIÓN**: `lenders` **199 «Alta te
financia»**, `rt=2`, y ya está **activada** en la sucursal. Le falta TODO lo que el admin no puede
poner, y dos de los cinco chequeos de «listo para operar» fallan. Está en la anotación de abajo.

**Tres cosas más, pedidas el 2026-09-09 y ya investigadas** — las tres son **config que ya existe**,
no desarrollo nuevo:

1. **Herramienta genérica** — `make harness-comercio COMERCIO=<slug>` siembra un comercio entero
   desde un spec declarativo (`harness/comercios/*.json`): sucursales, entidades, reglas duras,
   perfiles, bienvenida y autogestión. Hecho.
2. **Pantalla de bienvenida** (como CrediMovil) — **ya es config**: `lenders.show_intro_screen` +
   `intro_background_url`, y el front la dibuja con `LenderIntroduction`. Verificada corriendo para
   AltaX. ⚠ Su titular es `lenders.description`, **la misma columna** que la descripción de la tarjeta.
3. **Autogestión** — **el flag ya existe, en dos niveles y administrable**. Lo que falta es que el
   código lo respete: `legacy-application` lo ignora para `rt=2`.

**F-188 ARREGLADO y con PR abierto contra `qa`:** `Creditop-SAS/legacy-backend#1349` — el builder de
documentos se elige por `lenders.product` y no por id de entidad. Con eso **Alta Fleet cierra en
estado 11 en local**, con sus cinco documentos generados y firmados, y la suite del codeudor volvió a
verde. La autogestión también quedó verificada corriéndola: `showModal: false`, sin mensaje.

**FRENTE NUEVO desde el 2026-09-11: la tarjeta de cada entidad.** Miguel pidió que la tarjeta deje
de estar quemada y que cada entidad pueda definir la suya, y decidió que se trabaja **en esta misma
tarea**. Ya está medido (sección «La tarjeta de cada entidad»): el canal existe, es administrable, y
está roto en las dos puntas —tres campos que el admin guarda y la tarjeta no dibuja, dos que la
tarjeta lee y **ningún admin escribe**, y cuatro writers que **borran** lo que se cargó a mano—.

**El próximo paso es:** aterrizar ese frente **en LOCAL** — que exista la entidad en `qa`. El PR lleva el CÓDIGO; la configuración de Alta
allá es **dato**, y dev/qa/staging comparten la misma base — así que no se siembra desde una migración
sin decidirlo. El runbook está en §«Cómo se ataca», paso 6.

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

1. ✅ **Montar Alta Fleet en LOCAL** — `harness/dev/montar-alta.ts`, hecho el 2026-09-09. Comercio +
   sucursal en Bogotá (`country_city_id = 149`) + la entidad `rt=2` con PEP, con el molde partido en
   dos (170 para lo operativo, 173 para el catálogo de documentos del RTO) y entrada en `.flows.json`
   como `alta`. Ábaco se apaga a mano: el molde lo trae encendido y nadie lo pidió para Alta Fleet.
2. ✅ **Ejercitar el flujo por consola** — hecho: lista y ofrece PEP; **no cierra** por F-188. La suite
   `harness/suites/alta.json` queda declarada con el cierre en rojo **a propósito**, para que se ponga
   verde sola el día que F-188 se arregle.
3. ✅ **F-188 arreglado** — `Creditop-SAS/legacy-backend#1349`, rama
   `feat/alta-fleet-documentos-por-producto` desde `qa`. El payload builder se elige por
   `lenders.product`; `builderClassFor()` extraída pura con 5 pruebas unitarias. Desbloquea a Alta
   Fleet **y** repara el RTO de Motai en local y en qa (donde es el 205 y el mapa decía 193).
4. **Escribir las dos piezas de config que ningún panel pone**: la migración del `calculator` propio de
   Alta Fleet y la del catálogo `lender_signing_documents` con **sus** plantillas (hoy apunta a las de
   Motai). Depende de que legal las entregue.
5. **Corregir la fila 199 que ya existe en producción** (no crear otra): `product`, los
   `document_types` con CE y PEP, la bienvenida, el `originator_nit`, el proveedor de identidad, los
   perfiles y la política dura. Las tres últimas por la API de backoffice; las tres primeras por
   migración.
6. **El runbook, en este ORDEN** — sirve igual para `qa` y para producción, y el orden está medido,
   no es preferencia: crear el comercio y la sucursal → crear la entidad en el admin (con **CC, CE y
   PEP**) → `PUT /api/backoffice/lenders/{id}/rules` (deja la **plantilla** sola, sin clones, porque
   todavía no hay sucursal habilitada) → cargar la economía por comercio → **recién ahí** activarla en
   la sucursal, que copia la plantilla ya escrita → las cuatro columnas que ningún panel pone
   (`product`, `calculator`, catálogo de documentos, `requirements`) → `GET /readiness` para confirmar
   los cinco chequeos.
   ⚠ Para **qa** faltan además dos cosas que no son código: que alguien cree el comercio allá (no
   existe: 0 filas en `inertia-dev`) y que se dispare el **workflow manual de migraciones**, porque el
   deploy de qa no las corre (F-77).

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

## La tarjeta de cada entidad: por capacidad y no por id

Frente nuevo, incorporado a ESTA tarea el 2026-09-11 por decisión de Miguel: la tarjeta parametrizable
se trabaja acá y no en una tarea aparte. Nació de su pregunta —«¿que cada lender defina cómo mostrar su
tarjeta y eliminar lo hardcodeado?»— y se midió antes de opinar.

⚠ La distinción que decide el alcance: una cosa es que el lender declare **QUÉ tiene** (planes
calculados, lista de beneficios, su copy de botón) y otra que declare **CÓMO se ve** (layout,
componentes, slots). Lo primero mata las listas de ids. Lo segundo es un lenguaje de render para
mantener, y el lender no conoce el design system del wizard.

### Lo medido (2026-09-11)


#### 1 · el canal de presentación YA EXISTE y es una columna administrable

`lenders.additional_data` (longText, migración `2023_04_20_202610`) llega al front como **string JSON**
y su tipo declara seis campos: `amount_text`, `number_fee_text`, `rate_text`, `conditional_text`,
`action_text`, `benefit_list`.

#### 2 · pero ninguna de las dos puntas coincide con la otra

> **MEDICIÓN.** Quién escribe y quién lee, campo por campo. Los ✗ de la columna «escrito» no son un
> olvido de formulario: **ningún writer los emite** (ver medición 3).
>
> | campo | lo escribe algún admin | lo dibuja la tarjeta nueva | lo usa el listado viejo (Vue) |
> |---|---|---|---|
> | `rate_text` | ✔ | ✔ `LenderCard` ×2 · `LenderCardProcessing` ×2 | ✗ |
> | `amount_text` | ✔ | ✗ *(se mapea a la entidad y nadie lo consume)* | ✗ |
> | `number_fee_text` | ✔ | ✗ *(idem)* | ✗ |
> | `conditional_text` | ✔ | ✗ *(idem)* | ✔ ×2 |
> | `action_text` | **✗** | ✔ override genérico en `getActionText` | ✗ |
> | `benefit_list` | **✗** | ✔ ×3, gateado por `BANCOLOMBIA_LENDER_IDS` | ✔ ×3 |
>
> `grep additional_data` en `frontend-monorepo` (sin tests, stories ni mocks) + `legacy-application/resources/js`

**Los dos campos que sirven para parametrizar son justamente los dos que no se pueden configurar.** Y
el caso de `action_text` es el más elocuente, porque el override ya está escrito, probado y mergeado —
su comentario dice *«producto puede cambiarlo sin deploy»*, y hoy **producto no puede**, porque no hay
dónde escribirlo:

    const configuredActionText = additionalData?.action_text?.trim();
    if (configuredActionText) return configuredActionText;      // gana sobre todo lo de abajo
    if (pathId === MANAGED_LENDER_PATH_ID) return "Continuar";
    if (BANCOLOMBIA_LENDER_IDS.includes(lenderId)) return "Consultar Cupo";
    if (isNequiLender(lenderId)) return "Finalizar la compra";  // "fallback para cuando action_text
    switch (responseType) { … }                                 //  todavía no está configurado"

#### 3 · y los CUATRO lugares que lo escriben son DESTRUCTIVOS

> **MEDICIÓN.** `legacy-application` (`Admin\LenderController` update:96 y create:226) y
> `legacy-backend` (`Modules/Partner/App/Services/LenderManagementService` create:55 y update:137)
> **reconstruyen el objeto entero desde cuatro llaves** y lo vuelven a serializar:
>
>     $additional_data = [
>         'amount_text' => …, 'number_fee_text' => …, 'rate_text' => …, 'conditional_text' => …
>     ];
>     … 'additional_data' => json_encode($additional_data),
>
> No es un merge: es un reemplazo. **Cualquier guardado desde cualquiera de los dos admin borra
> `benefit_list` y `action_text`.** Quien los haya puesto a mano los pierde sin aviso.

Eso convierte el «no se puede escribir» en algo peor que un hueco de formulario: lo poco que hay
configurado es **frágil**, y se pierde por usar la pantalla como se debe usar.

#### 4 · qué hay REALMENTE en la base (copia local, 162 lenders)

> **MEDICIÓN.**
>
> - `benefit_list`: **2 lenders** — ids **68 y 100**, que son *exactamente* `BANCOLOMBIA_LENDER_IDS`.
>   JSON escrito a mano, con iconos Tabler (`ti ti-calendar`) y hasta `\n` literales adentro.
> - `action_text`: **0 lenders**. El override nunca se ejerció.
> - `conditional_text`: con contenido real, **5 de 162**.
> - `rate_text`: 159 llenos… y ahí está la otra cara del texto libre. **La misma tasa, escrita de
>   ocho formas**: `1.88% M.V` (70) · `1.88% M.V.` (19) · `0` (10) · `0% M.V` (6) · `0%` (4) ·
>   `1.88% Mes vencido` (4) · `1.88% MV` (4) · `.` (4) · `1.88% N.M.` (3)…
> - `amount_text` es igual de artesanal: `1M-10M` · `1-20M` · `100K-1MM` · `de 1 a 20M` · `$50k-$3M` · `.`
>
> `docker exec legacy-backend-mysql-1 mysql … creditop`

Que `benefit_list` viva sólo en los dos Bancolombia **es lo que hace segura la poda del tramo 0**: la
condición con y sin la lista de ids da hoy el mismo resultado, y está medido, no supuesto.

Y `rate_text` es el argumento entero en un solo campo: **es un número viajando como prosa**. Nadie
puede ordenar por tasa, compararla ni traducirla, y el mismo 1,88% se le muestra al cliente de ocho
maneras según quién cargó la fila.

#### 5 · la identidad quemada del front son 31 usos en ~18 archivos — y `quemado` no la ve

> **MEDICIÓN.** La herramienta `quemado` indexa `legacy-backend` (174) y `legacy-application` (217) y
> **cero** del frontend. A mano, en `lenders-marketplace` (sin el archivo que las declara ni tests):
>
> | constante | usos | archivos |
> |---|---|---|
> | `MEDDIPAY_LENDER_ID` | 11 | 5 |
> | `CREDIFAMILIA_LENDER_ID` | 7 | 4 |
> | `BANCOLOMBIA_LENDER_IDS` | 5 | 3 |
> | `PRAMI_LENDER_ID` | 5 | 3 |
> | `WELLI_LENDER_IDS` · `ALL_WELLI_IDS` · `NEQUI_LENDER_ID` | 1 c/u | 1 c/u |
> | `HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS` | 3 | 3 |
>
> ⚠ **CORREGIDO el 2026-09-11.** El último lo di por **código muerto** y era FALSO: lo grepeé con el
> nombre equivocado (`hidesAvailableCreditTag`), y el helper se llama **`shouldHideAvailableCreditTag`**.
> Tiene **tres consumidores reales** — el mapper, `lender-resolution.service` y `lender-approval.service`.
> No se borra. Y es mejor noticia que un borrado: **el propio código ya pide lo que proponemos**, en un
> comentario escrito antes que esta tarea —*«TODO(backend): mover esta decisión al backend (un flag en la
> respuesta del lender…)»*—, así que es el cuarto caso que el payload debería resolver, no el que sobra.

#### 6 · TRES lenders tienen forma propia de cotización, y ahí está el costo real

`lender-transaction-data.service.ts` (389 líneas) tiene extractores de dos clases: genéricos
(`extractProductCondition`, `extractRevolvingLimits`, `extractCategoryRate`,
`extractQuotaInitialFeePercentage`, `extractCategoryFga`) y **por lender**: `extractPramiQuotas`,
`extractMeddipayOffers`, `extractMeddipayCreditLimit`, `extractMeddipayTermOptions`,
`extractWelliInstallments` — más Credifamilia con su plan dinámico aparte.

**El front conoce la forma del payload de cada lender.** Eso no es presentación: es un adaptador que
quedó del lado equivocado de la frontera.

#### 7 · TRES puertas distintas, y es lo que hace que la retrocompatibilidad salga gratis

> **MEDICIÓN · 2026-09-11.** Los dos fronts **no comparten endpoint**, y el microservicio es una
> tercera cosa:
>
> | quién | a qué le pega | quién lo atiende |
> |---|---|---|
> | wizard (`frontend-monorepo`) | `GET /api/onboarding/loan-application/**lenders-v2**/{ureq}` | `LenderListingController@index` (Modules/Onboarding) |
> | `legacy-application` | `GET /api/onboarding/loan-application/**lenders**/{ureq}` | `ListLenderController@index` — **otro controlador** |
> | wizard, ADEMÁS | `POST /v1/preapprovals/check` (`VITE_PREAPPROVALS_ENDPOINT`) | el microservicio de pre-aprobados |
>
> `loan-options.repository.ts:35` · `Modules/Onboarding/routes/api.php:51-53` ·
> `legacy-application/app/Http/Controllers/Customer/ListLenderController.php:264`

**Consecuencia directa:** agregarle un bloque nuevo a `lenders-v2` **no puede** llegarle a
`legacy-application`, porque no llama a esa ruta. La retrocompatibilidad no hay que construirla con un
flag: ya está, y es por puertas separadas.

⚠ **Trampa de nombres, y es fácil caer:** la vista de `legacy-application` se llama
`customer/lenders/list/**v2**/ListLenders.vue` — ese «v2» es la versión de la PANTALLA, y esa pantalla
consume la API **v1**. «v2» no quiere decir lo mismo en los dos sistemas.

#### 8 · lo que NO está normalizado es `transaction_data`, y el que puede normalizarlo es el MICROSERVICIO

El envelope del microservicio **ya es uniforme** para todos los lenders —`applicant_id`,
`approved_amount`, `available`, `probability`, `status`, `sort`…— y adentro lleva un agujero declarado
a propósito:

    transaction_data: z.unknown(),
    // "All lenders return the same envelope; `transaction_data` is intentionally
    //  `unknown` because each lender ships its own structure."

Ahí nacen los cinco extractores de la medición 6. O sea: **el lugar donde hay que normalizar la
cotización no es el listado del monolito, es el microservicio de pre-aprobados** — que es justamente
quien habla con la API de cada lender y tiene el dato en crudo. El front hoy hace de adaptador de un
servicio que ya tenía la oportunidad de hacerlo.

### Lo que ya está resuelto bien, y sirve de molde

No hay que inventar el patrón: hay tres ejemplos, todos mergeados.

    // ✔ por CAPACIDAD, con el dato que el backend manda
    usesCalculatorOffer(lender) → hasCalculatorPlans(lender.calculated) || isCalculatorProduct(lender.product)
    // ✔ por CONFIGURACIÓN, con precedencia clara
    getActionText(…)           → additional_data.action_text gana; los ids son el fallback
    // ✔ que lo decida el backend
    hide_probability           → un booleano en la respuesta ("lo decide el backend")

    // ✗ por ID
    supportsDynamicPaymentPlan(id) → id === CREDIFAMILIA_LENDER_ID
    supportsLiveReprice(id)        → id === MEDDIPAY_LENDER_ID

El test del primero explica por qué gana, y no es estético: *«antes el RTO venía con
`product = 'renting'` para heredar la card, y un UPDATE en BD lo habría tirado a la de crédito»* — y
cubre la degradación: un alquiler con el calculator roto **no** cae a la tarjeta de crédito.

### La propuesta, en tramos

#### Tramo 0 — la poda · horas · riesgo nulo

- ~~Borrar `HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS`~~ — **no es código muerto** (ver la corrección en la
  medición 5). Pasa a ser candidato del payload, con su `TODO(backend)` ya escrito en el código.
- Sacar `BANCOLOMBIA_LENDER_IDS.includes(lenderData.id)` de `shouldShowBenefitList`
  (`LenderCardContent.tsx:1078`). La condición ya exige `!isNil && !isEmpty`, y sólo 68 y 100 tienen
  `benefit_list`, así que **la conducta no cambia** — cambia la REGLA: de «lo muestro si sos
  Bancolombia» a «muestro lo que llegó».
  ⚠ Ojo al efecto colateral: `shouldApplyDarkBackground` (línea 1089) cuelga de esa misma variable, así
  que el día que otro lender traiga beneficios también cambia de fondo. Es lo que se quiere, pero hay
  que decirlo.

**Qué compra:** el siguiente lender con beneficios funciona sin tocar código.

#### Tramo 1 — conectar el canal que ya existe · días · el mejor retorno

1. **Que los writers dejen de borrar.** Los cuatro lugares que reconstruyen `additional_data` tienen
   que **mergear sobre lo que había**, no reemplazar. Sin esto, todo lo demás se pierde al primer
   guardado.
2. **`action_text` y `benefit_list` al formulario del admin.** El primero es una caja de texto y ya
   tiene su override probado: es el cambio más barato del documento con efecto visible en la tarjeta.
3. **Decidir los tres huérfanos**: `amount_text` y `number_fee_text` no los dibuja nadie, y
   `conditional_text` sólo sobrevive en el listado viejo. O los lee la tarjeta nueva, o salen del
   formulario. Un campo que se guarda y no hace nada es peor que no tenerlo: alguien lo llena y espera
   un efecto.
4. **`additional_data` deja de viajar como string JSON** y viaja como objeto, con un solo parseo
   validado (hoy el front hace `JSON.parse` de una columna de texto, con `catch` que devuelve vacío).

**Qué compra:** esto ES «que el lender defina su tarjeta», administrable, sin inventar nada. Y es el
tramo que hay que hacer **antes** de prometer más: si se conecta y en un mes nadie lo usa, la hipótesis
queda medida en vez de supuesta.

#### Tramo 1b — el bloque `card` en la respuesta del listado (la idea de Miguel) · aditivo

Que `lenders-v2` traiga, por lender, un bloque con **lo que la tarjeta tiene que decir**. El front lo
usa si viene y cae a lo de hoy si no viene, igual que ya hace `action_text`.

    "card": {
      "action_text": "Consultar cupo",
      "benefit_list": [ { "icon": "…", "text": "…" } ],
      "rate":   { "value": 1.88, "period": "monthly" },
      "amount": { "min": 1000000, "max": 10000000 },
      "notes":  "texto condicional"
    }

**Por qué es seguro:** `legacy-application` no llama a `lenders-v2` (medición 7), así que no se entera.
Y dentro del wizard, un campo nuevo que nadie lee todavía no cambia ninguna pantalla: se puede
desplegar el backend primero y el front después, sin coordinar.

⚠ **Dónde está la línea, y es la decisión de fondo del documento.** Ese JSON describe **contenido y
capacidades** (qué texto, qué beneficios, qué tasa, qué rango). El día que empiece a describir
**estructura** —`{"components":[{"type":"row","children":[…]}]}`— deja de ser configuración y pasa a
ser un lenguaje de render: el front pierde los tipos, un cambio de diseño se vuelve una migración de
datos, QA no puede probar una pantalla que varía por fila, y el tema oscuro, la accesibilidad y los
idiomas quedan del lado del que carga el dato. La regla: **el lender declara QUÉ tiene; la tarjeta
decide CÓMO se ve.**

Y una consecuencia práctica de la medición 4: `rate` conviene que viaje **como número y período**, no
como el texto libre de hoy. Si el bloque `card` nace copiando `rate_text`, nace con las ocho grafías
adentro.

#### Tramo 2 — normalizar la cotización EN EL MICROSERVICIO · el caro, y el que de verdad paga

Que `transaction_data` deje de ser `unknown` y el microservicio entregue **una sola forma** de «cuota
por plazo». No es en el listado del monolito: el que tiene el dato crudo de cada lender —y el que ya
uniformó todo lo demás del envelope— es el microservicio de pre-aprobados (medición 8).

**Alcance medido:** 5 extractores por lender dentro de un servicio de 389 líneas; 31 usos de constantes
de identidad en ~18 archivos, con Meddipay como el más caro (11). Las tres ramas por id de
`LenderCardContent` (1081, 1122, 1144) colapsan cuando esto se hace; `supportsDynamicPaymentPlan` y
`supportsLiveReprice` se vuelven capacidades como ya lo es `usesCalculatorOffer`.

**Qué compra:** agregar un lender rt=1 deja de tocar el front. **Riesgo:** cambia el contrato de
`/lenders`, que alimenta la pantalla más visitada del wizard — pide caracterización previa (el harness
ya cierra casos por consola) y despliegue por ambientes.

#### Tramo 3 — lo que NO haría

Un DSL de layout: que el backend mande componentes, slots o estructura. Cuesta un lenguaje que
mantener, le quita tipos al front, convierte un cambio de diseño en un cambio de dato, y el lender no
conoce el design system del wizard. La regla que lo reemplaza: **el lender declara QUÉ tiene; la
tarjeta decide CÓMO se ve.**

### Riesgos y preguntas abiertas de este frente


- **Los números de la medición 4 son de la copia local.** Antes de tocar nada hay que repetir esa
  consulta **contra prod** (lectura, que es lo único permitido): si allá `benefit_list` lo tiene alguien
  más que 68 y 100, el tramo 0 deja de ser neutro.
- **`rate_text` con ocho grafías es un síntoma, no la enfermedad.** Convertirlo en dato (tasa + período)
  es su propio trabajo y no está costeado acá; lo que sí conviene es no agregar más texto libre
  mientras tanto.
- **`quemado` no indexa el front**, así que el inventario que usamos para priorizar tiene un punto
  ciego. Cerrarlo es barato y hace visible esto y lo que venga.
- El merge de los writers (tramo 1.1) toca dos monolitos a la vez. Van por PRs separados.

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

> **MEDICIÓN · 2026-09-09** — montado en local y corrido: comercio «Alta Fleet» + sucursal «Calle 90»
> (Bogotá) + entidad **AltaX** `rt=2` `product=rto` con `["CC","CE","PEP"]`, 6 reglas duras en la
> plantilla y 6 en el grupo `AB<sucursal>` (alineadas), 4 perfiles con criterios de titular Y codeudor,
> 5 documentos del catálogo RTO. **Lista**: `GET lenders` devolvió `[AltaX]`, 1 de 1 cableada. **Ofrece
> PEP**: `allowed_document_types = ["CC","CE","PEP"]` con su regla de largo para cada uno.
> `E2E_TARGET=local node harness/dev/montar-alta.ts` · `make harness-listado COMERCIO=alta` ·
> `curl http://localhost/api/loans/allied/<hash>`

> **MEDICIÓN · 2026-09-09** — **no cierra, y no es del comercio nuevo: es F-188.** El 500 de la
> generación de documentos es
> `Blade PDF generation failed: Undefined variable $nombre_cliente (View: …/lenders/motai/rto/contrato_rto_con_codeudor.blade.php)`,
> porque `CatalogDocumentPayloadResolver::BUILDERS_BY_LENDER` es un mapa por **id de entidad**
> (`158` y `193`) y cualquier otro id cae al builder de onboarding, que produce otras claves. El
> **Rent to Own de Motai falla igual en local** (`CASOS='motai:173'`, mismo 500), así que
> `harness/suites/codeudor.json` —que declara que el 173 cierra en 11— hoy está en rojo.
> `make harness-caso CASOS='alta:<id>' CERRAR=1 LAMBDA=1` · `make harness-caso CASOS='motai:173' CERRAR=1 LAMBDA=1`

> **DECISIÓN · 2026-09-09** — el arreglo de F-188 **no es el `slug`**, aunque sea lo que dice el TODO
> del propio código. El slug arregla los ambientes (el RTO es 193/205/173 según dónde) pero no al
> comercio nuevo, que tiene su propio slug. La llave que ya está en el dato y describe la FORMA del
> payload es **`lenders.product`**: con eso, una entidad nueva del mismo producto funciona sin tocar
> código. Es el movimiento que `hardcodes-entidades` llama «convertir el `if` por identidad en config».

> **MEDICIÓN · 2026-09-09** — de paso salió **F-187**, y explica por qué la primera corrida decía «no
> encontré una sucursal» con la fila en la base: `dev/listado.ts` y `dev/sweep.ts` tenían un `import`
> **estático** arriba del `process.env.E2E_TARGET ||= 'local'`, y los imports estáticos se evalúan
> antes de la primera sentencia — así que `pkg/env.ts` fijaba `TARGET = dev`. Los dos imprimían «target
> local» y pegaban contra el RDS compartido. Arreglado pasándolo a import dinámico; `playground/CLAUDE.md`
> corregido, porque afirmaba que sweep «ya lo fuerza».

> **MEDICIÓN · 2026-09-09 12:06 (prod)** — **la entidad de Alta se creó en producción mientras esto se
> escribía**: `lenders` **199 «Alta te financia»**, slug `alta-te-financia`, **`rt=2`**,
> `product = credit`, `document_types = ["CC"]`, `show_intro_screen = 0`. Está **activada**
> (`status=1`) en la sucursal 2262. Lo que tiene: `credit_line_by_lenders`,
> `creditop_x_lender_configuration`, una `lender_datacredito_rules` y el cableado. **Lo que NO tiene:
> 0 `lender_rules` · 0 `lender_users_categories` · 0 `lender_signing_documents` · 0
> `lender_identity_validation_types` · 0 `lender_requirements` · `originator_nit = NULL` ·
> `calculator = NULL`.** O sea: **tres de los cinco chequeos de readiness fallan** (identidad,
> validación, perfiles), y la sucursal ya tiene **un tercer `group_rules` con 0 reglas para el 199** —
> la trampa del grupo vacío, exactamente como estaba previsto.
> `SELECT … FROM lenders WHERE id=199` · el censo de las 12 tablas hijas · `group_rules` de la 2262

> **DECISIÓN · 2026-09-09** — el `product` del 199 quedó en **`credit`** y sus `document_types` en
> **`["CC"]`** (sin CE y sin PEP) porque **el admin no puede poner `product`** y el formulario de
> tipos se guardó con uno solo. Si Alta Fleet va a vender el Rent to Own, esas dos son correcciones
> sobre la fila que ya existe — no hace falta crear otra entidad.

> **MEDICIÓN · 2026-09-09** — **la pantalla de bienvenida ya es config, y funciona.** Las columnas son
> `lenders.show_intro_screen` (bool, default false) y `lenders.intro_background_url`, de la migración
> `2026_04_22_000000_add_intro_fields_to_lenders_table`; el front la dibuja con `LenderIntroduction`
> (`loan-confirmation.tsx:323`, `shouldShowLenderIntroduction = loan?.lender.show_intro_screen === true`)
> a pantalla completa con logo, titular y fondo. En producción **la usa UNA sola entidad: CREDIMOVIL
> (164)**, con `description = "El celular que quieres, más cerca con CrediMovil"`. Verificado corriendo
> para AltaX: `GET /api/loans/customer/requests/{ur}` devuelve `show_intro_screen: true` con su
> descripción y su fondo.
> ⚠ **Y el admin NO tiene esos dos campos** (cero menciones en `legacy-application`): prenderla es
> migración, igual que `product` y `calculator`.

> **RIESGO · 2026-09-09** — el titular de la bienvenida **es `lenders.description`, la misma columna
> que la descripción de la tarjeta del marketplace** (`lender-response.mapper.ts:213`). Credimovil la
> tiene corta (48 caracteres) porque le sirve de titular; Motai tiene un párrafo. Prender la bienvenida
> **obliga** a escribir la descripción como titular, y eso se ve también en la tarjeta. Es una
> restricción del esquema: si se quieren las dos cosas, hace falta una columna más.

> **MEDICIÓN · 2026-09-09** — **la autogestión NO necesita un flag nuevo: hay TRES mecanismos y dos ya
> son config administrable.**
> 1 · `allieds.self_managed` — apaga el modal «Continua el proceso de solicitud con el asesor
> comercial». Editable en el admin de comercios.
> 2 · `lenders_by_allieds.user_self_management` — «esta entidad le manda el link al cliente por
> WhatsApp». Editable en la pantalla de entidades del comercio (`AlliedLenderController:159,237`).
> 3 · `RedirectIdValidationIfDesktop` (alias `onlyMobileValidation` en `Kernel.php:64`) — si el
> user-agent es **DESKTOP**, genera un QR, manda el link y corta con **403 `continue-link-sent`**. No
> mira config: mira el dispositivo, porque la biometría necesita cámara.
> Y el trío 1+2+`auth()->user()` ya está resuelto en un solo lugar dos veces: el resolver puro
> `LenderTabBehaviorResolver::opensNewTab()` —compartido entre el listado y la selección justamente
> para que no divergan— y `NequiPaymentService::isSelfManagement()`, que además lo resuelve en el
> backend «para que el front no lo infiera». Ese docblock también deja dicho que **no existe un
> `flow_id` para esto**: de 360.717 solicitudes, 360.710 tienen `flow_id = NULL`.

> **RIESGO · 2026-09-09** — **`legacy-application` IGNORA el flag para `rt=2`.** Su condición es
> `if ($lenderByAllied->user_self_management && ($url != null && $url !== '') || $lender->response_type === 2)`
> — el `||` gana, así que **toda entidad CreditopX manda el WhatsApp**, y la única salida es una lista
> quemada, `$excludedLenders = [6, 9]` (Addi), marcada `// TEMP`. `legacy-backend` **no** tiene ese
> `||`. O sea que el mismo comercio se porta distinto según qué monolito lo atienda — y Alta Fleet es
> `rt=2`, así que hoy en application recibiría el mensaje aunque la config diga que no.

> **DECISIÓN · 2026-09-09** — la forma escalable **no es un flag nuevo**: es un resolver hermano del
> `LenderTabBehaviorResolver`, puro y compartido, que conteste «¿el cliente continúa solo o se le manda
> el link?» leyendo el trío que ya existe. Con eso se borran el `|| response_type === 2` y la lista
> `[6, 9]`. Si además hiciera falta una excepción por comercio, el patrón de la casa ya está elegido:
> una clave en `settings` leída por `CommonsV1 SettingsService` con caché —como `corbeta_allieds`,
> `stratum_field_allieds` y `kyc_pipeline_allieds`—, y el propio repo lo dice en
> `ManualBirthDateConstants`: «copiar una lista de ids quemada no es el estado final».

> **MEDICIÓN · 2026-09-09 (rama `qa` + el arreglo)** — **Alta Fleet cierra de punta a punta.** uReq
> 466427: listado `[211]`, **estado 11**, y los cinco documentos del Rent to Own **generados y
> firmados** (`lease_agreement`, `cosigner_agreement`, `promissory_note`, `chattel_mortgage`,
> `payment_schedule`). Y la regresión que estaba en rojo volvió a verde: `codeudor.json` **2/2 en
> estado 11**, y `alta.json` **2/2**.
> `make harness-comercio COMERCIO=alta` · `make harness-suite SUITE=harness/suites/alta.json CERRAR=1 LAMBDA=1`

> **MEDICIÓN · 2026-09-09** — **la autogestión funciona, y se verificó por la respuesta, no leyendo el
> código.** Seleccionando AltaX con `allieds.self_managed=1` +
> `lenders_by_allieds.user_self_management=0`, `POST update-user-request` devuelve
> `showModal: false` · `modalMessage: ""` · `openNewTab: false` · `standBy: true` · `url: null`. O sea
> **ningún mensaje y ningún modal**: el cliente sigue donde está. Esto es `legacy-backend`, que es
> quien atiende local y qa; el defecto de F-189 vive en `legacy-application`.

> **MEDICIÓN · 2026-09-09** — **el FRONTEND no necesita ningún cambio, y se comprobó contra `origin/qa`
> antes de escribir nada.** La rama `qa` de `frontend-monorepo` **ya tiene** el componente
> `LenderIntroduction` y su compuerta `show_intro_screen` en `loan-confirmation.tsx`; **ya lee**
> `allowed_document_types` (6 archivos, así que el PEP sale del backend); **ya no queda** nada quemado
> de `motai-renting`/`merchantMode` fuera de fixtures y storybook; y la card lee `calculated.plans`
> genéricamente. Los ids quemados que quedan en `lender.constants.ts` son de otras entidades
> (Credifamilia, Welli, Bancolombia, Meddipay, Prami, Nequi) y sólo mapean su `transaction_data`: una
> entidad que no está en ninguna lista simplemente no recibe ese mapeo, que es lo correcto.
> `git -C frontend-monorepo ls-tree -r --name-only origin/qa | grep LenderIntroduction`

> **DECISIÓN · 2026-09-09** — el PR sale de `qa` y **no** lleva la configuración de Alta. Motivo
> medido: dev, qa y staging **comparten la misma base** (`inertia-dev`), así que una migración que
> siembre el comercio lo crearía en los tres; y en qa las migraciones **no corren en el deploy** —van
> por un workflow manual (F-77)—, así que tampoco llegaría sola. El código va por PR; el dato, por
> runbook y con dueño.

## Lo que está bloqueado

> **DECISIÓN · 2026-09-09 · Miguel** — el cliente **se queda con la moto**: es **Rent to Own**. Con
> opción de compra hay saldo, hay interés y **aplica el techo de usura** (sin ella el cliente paga por
> usar y no hay nada que amortizar). Consecuencias que ya están tomadas por esto: los perfiles van
> todos con `requires_cosigner = 1` —el catálogo del RTO sólo tiene esa rama— y la calculadora es la
> matriz de plazos (12/18/24 meses = 52/78/104 semanas), no la de planes semanales del renting. Y ⚠ la
> terminología del código está **invertida** respecto del PRD: el `renting` del código es el
> *rent-to-own* del PRD.

> **DECISIÓN · 2026-09-09 · Miguel** — local primero, y ya está hecho. El runbook de producción queda
> para el final, y **no puede ejecutarse hasta que F-188 esté arreglado**: en prod la entidad nueva
> listaría y moriría al firmar, igual que acá.

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

> **RIESGO · 2026-09-09** — el catálogo de Alta Fleet apunta HOY a las plantillas de Motai
> (`…/lenders/motai/rto/…`). Sirve para ejercitar el flujo; **en producción sería el contrato de otra
> marca**. Arreglar F-188 desbloquea la firma y no toca esto: son dos entregas distintas, y la segunda
> depende de legal.

## Lo que NO entra

- **Ábaco.** Motai lo usa porque su población gig no tiene historial en el buró, y se prende por
  entidad con `lender_requirements.abaco_is_enabled`. Hasta que alguien lo pida para Alta Fleet, no
  entra — y en dev/qa **no hay mock**, así que sólo se puede ejercitar en local.
- **El codeudor.** Es un recorrido entero (invitación → token → onboarding → OTP → firma) con su
  propio nodo y sus propios hallazgos. Sólo entra si el producto elegido lo exige.
- **El SaaS de $250.000** y cualquier cobro de suscripción: el sistema no tiene esa pieza y no es de
  esta tarea.
- **Tocar la configuración de las dos entidades de Bancolombia** del comercio.
- **Un `flow_id` o una columna nueva para la autogestión.** Los flags existen; el trabajo es que el
  código los respete.
- **Assets de marca.** El fondo de la bienvenida que se sembró es el de CrediMovil y el logo lo hereda
  del molde: son prestados, para poder verla. Los de Alta Fleet los tiene que dar diseño.
- **Escribir en producción** desde acá. Las entregas 1-3 son local; la 4 es un runbook para que lo
  ejecute quien tenga el panel.

## Cómo se comprueba

    # 1 · el comercio entero, montado en local desde su spec
    make harness-comercio COMERCIO=alta            # CLEAN=1 lo borra · sin COMERCIO lista los que hay

    # 2 · ¿le sale la entidad al cliente, y por qué no las otras?
    make harness-listado COMERCIO=alta

    # 3 · ¿cierra el flujo entero?
    make harness-caso CASOS='alta:211' CERRAR=1 LAMBDA=1

    # 4 · la suite, que falla si algo no cumple lo declarado
    make harness-suite SUITE=harness/suites/alta.json CERRAR=1 LAMBDA=1

    # 5 · los cinco chequeos, contra el propio código (pide token de staff)
    curl -H "Authorization: Bearer $TOKEN" localhost/api/backoffice/lenders/<id>/readiness

Y los dos chequeos que no son un comando:

    # el PEP en el selector
    curl -s http://localhost/api/loans/allied/<hash> | jq '.data.allowed_document_types'

    # la pantalla de bienvenida (pide una solicitud con la entidad ya elegida)
    curl -s http://localhost/api/loans/customer/requests/<ureq> \
      | jq '.data.userRequest.lender | {show_intro_screen, description, intro_background_url}'

## Registro

### 2026-09-11 (noche) · las tres reservas, medidas: ninguna es mecánica

Se intentaron las tres que habían quedado, y las tres se frenaron por el mismo motivo: **no son
refactors, necesitan una señal del backend o una decisión de negocio.** Frenarlas es el resultado.

**1 · La consulta compartida de Welli.** La idea era agrupar por `preapproval_key` en vez de por
`isWelliLender`. **No sirve, y por poco no lo veo:** TODAS las entidades rt=2/3 comparten la clave
`creditop_x`, así que agrupar por clave las haría compartir UNA sola consulta — y cada una es la línea
de crédito de un comercio distinto, que el microservicio separa por `lending_product_id`. Agrupar por
clave sola habría hecho que un comercio viera el cupo de otro. Necesita una señal explícita
(`shares_preapproval`) y, aparte, decidir **cuál** del grupo dispara: hoy es Tasa Full *con sus
credenciales*, y de ahí sale el `comision_aliado` del riesgo compartido.

**2 · Los plazos del selector** (`useInstallmentOptions`, hoy con `isWelliLender` + `MEDDIPAY_LENDER_ID`).
Parecía la misma pregunta con dos formas de payload, pero las dos ramas **no hacen lo mismo**: Welli
prefiere lo repreciado en vivo (`externalFinancials`) sobre su tarifario; Meddipay usa el tarifario de
la oferta aunque haya repreciado. Y `useExternalFinancials` es genérico —no es de Welli—, así que
unificarlas le cambiaría la conducta a Meddipay en silencio. Es una política, no una forma: hace falta
decidirla antes de escribirla.

**3 · Lo de Nequi** (8 usos) no es de la tarjeta: son sus pantallas propias —POS, estado de pago,
banner—, 1.797 líneas en 9 archivos dentro del módulo del listado. No es hardcoding que sobre: es un
producto distinto que vive en la carpeta equivocada. Moverlo es otra tarea.

> **MEDICIÓN · 2026-09-11 · ¿esto achica el listado? NO, y conviene decirlo con números.**
> La rama va **+582 / −133**, con **4 archivos nuevos y 0 borrados**. El módulo tiene 140 archivos y
> 15.902 líneas. Mover una decisión de «un `if` por id» a «capacidad + tipo + prueba» AGREGA código;
> lo que borra es la normalización que viene después.
>
> Lo que SÍ se puede borrar, medido:
>
> | qué | líneas | cuándo |
> |---|---|---|
> | los 5 extractores por lender | **176** de 405 | cuando el backend normalice `transaction_data` |
> | el respaldo por id + sus listas | ~90 | cuando la columna esté en los tres ambientes |
> | `quoted-installment` se encoge a un lookup | ~50 de 80 | idem |
>
> Total realista: **~300 líneas de 15.902 — menos del 2%.**
>
> Y la complejidad de verdad no está en los ids: está en **tres archivos genéricos** —
> `LenderCardContent` (1.223), `AvailableLenders` (972) y `LenderCard` (637): 2.832 líneas con
> complejidad ciclomática de 16, 52 y 21 medida por el propio linter. Ninguna lista de ids los toca.

### 2026-09-11 (tarde) · el refactor probado con el mock, y cuatro hallazgos de correr doce comercios

**Lo que se hizo.** Rama `feat/tarjeta-por-capacidad` en `frontend-monorepo` y `legacy-backend`, las
dos **desde `qa`**, sin push. El front ya tiene el cambio: las CUATRO ramas que buscaban la cuota del
plazo elegido —cada una abriendo con `lenderData.id === <ENTIDAD>`— colapsaron en **una**,
`resolveQuotedInstallment`, que resuelve por la **forma del payload** (`quotas`, `commercialOffer`,
`plan_de_cuotas`) y no por el id. La tarjeta quedó sin una sola referencia a `MEDDIPAY_LENDER_ID`,
`PRAMI_LENDER_ID`, `isWelliLender` ni `BANCOLOMBIA_LENDER_IDS`. Build en verde.

> **MEDICIÓN · el refactor, corriendo.** Con el mock de pre-aprobados enchufado al wizard, `sonria`
> resuelve las tres formas por el único resolver: **Welli** $78.134 a 36 · **Meddipay** $78.839 a 36 ·
> **Credifamilia** $1.636.123 a 6. Verificado contra la fórmula del propio mock: son la **cotización
> del lender**, no la que calcularía el front. Y **Alta Fleet** dibuja su tarjeta de RTO completa
> —*Monto total $4.760.000 · Pago semanal $101.896 · Plan 12/18/24*— **enteramente desde config de
> base de datos**: es el molde que queremos para el resto.

**Los cuatro hallazgos, ya escritos en el árbol de hallazgos** (F-201…F-204):

- **F-201** · el motor HTTP del arnés dice «listó» donde el navegador se traba. Correlación perfecta en
  6 comercios: los que tienen productos cargados (motai, dentix) no pasan la primera pantalla porque
  hay que **elegir el producto**; los que no tienen (sonria, gaes, celucambio, alta-fleet) caminan.
- **F-202** · el front le pregunta al microservicio por entidades cuya clave no existe: la arma con el
  `slug`. **Medido contra producción: 7 de 140** entidades activas rt≠0 tienen clave válida, y **98**
  de las que no, están cableadas a una sucursal activa. Síntoma: «No pudimos consultar esta entidad»
  con un Reintentar que nunca puede funcionar.
- **F-203** · la tasa es texto libre: **18** entidades muestran `0`, `0%` o `.` al cliente, y el mismo
  1,88% está escrito de **ocho** formas.
- **F-204** · el proceso viejo tenía el entorno de cuando arrancó (un `.env.local` renombrado semanas
  atrás), y por eso reiniciar el dev server «rompió» el OTP. Con su corolario: **dije que en local no
  se podía simular el servicio de pre-aprobados y era falso** — `mock-preapprovals` existe, estaba
  corriendo y emite el `transaction_data` de las cuatro entidades.

**Lo que esto le hace al plan.** F-202 agrega una capacidad a la lista: la clave del microservicio
debería venir del backend junto con `can_check_preapproval`, no derivarse del slug. Quedan **siete**
capacidades por mover al payload, y dos de ellas no necesitan flag nuevo (el plan dinámico se deduce de
«¿vino el plan?» y el tope de Nequi de un `max_financing_amount`).

**Decisión de Miguel:** no se pushea a `qa` hasta terminar de sacar el hardcoding del front.

### 2026-09-11 · la tarjeta parametrizable entra a esta tarea, y se mide antes de tocar código

Miguel pidió mirar, **antes de escribir código**, cómo el listado arma la tarjeta de cada entidad, y
propuso que cada lender defina la suya. Se midió (las ocho mediciones están arriba) y la medición
corrigió dos supuestos míos: `action_text` **sí** se lee —el override genérico ya está mergeado, con
tests— y lo que falta es poder escribirlo; y los writers no sólo omiten campos, los **destruyen**.

Después preguntó si el listado que consume el wizard es el del microservicio o `lenders-v1`, para no
validar sobre el camino equivocado. Bien preguntado: es **`lenders-v2`** del monolito, y el
microservicio es una llamada aparte. De medirlo salieron dos cosas que cambian el plan —
`legacy-application` consume **otro endpoint** (retrocompatibilidad por construcción, sin flag), y el
`transaction_data: unknown` del microservicio es el origen real de los cinco extractores, así que la
normalización va **en el microservicio**.

Nació como tarea #79 aparte y **se plegó acá** por decisión de Miguel: la #79 queda archivada como el
documento de la medición. El esfuerzo de la bitácora también se movió a esta tarea. Y quedó la regla
para la bitácora de acá en adelante: **el arnés y las herramientas locales NO son esfuerzo de tarea**
— se registran como tiempo, sin colgar de ninguna.

### 2026-09-11 · publicada como CORE-558, en progreso

La tarea existía en el tablero desde el 9/9 y nunca se había publicado (`jira: []`). Se subió con la
sección publicable tal cual estaba —5172 caracteres, pasa el guard—, al **sprint activo (CORE Sprint
15)** y con la transición a **🚧 En progreso** en el mismo paso. No se le cargaron **puntos**: la
estimación la pone quien la va a hacer, y inventarla acá sería un número sin medir.



### 2026-09-10 · los dos PRs en qa, y qué se probó contra el backend desplegado

Mergeados los dos (`legacy-backend#1351` y `frontend-monorepo#983`), más un hotfix
(`frontend-monorepo#987`) porque #983 rompió el build del despliegue — ver **F-194**.

> **MEDICIÓN · 2026-09-10** — **dos de las tres piezas de backend, probadas VIVAS contra el
> backend desplegado de qa.** (1) `GET /api/loans/allied/ea2fe316` devuelve el objeto `pages`
> completo con la bienvenida de Alta, y trae `allowed_document_types`, que es la firma de que
> responde la rama `qa` y no `develop` (harness/CLAUDE.md §«Qué es real en cada target»).
> (2) `POST /api/onboarding/loan-application/update-user-request/502189` con `lender_id 211` y
> **sin sesión de asesor** devuelve
> `continueUrl: https://originaciones-qa.dev.creditop.com/self-service/ea2fe316/502189/confirmation`
> — la URL pública del ambiente, apuntando a `/confirmation` y **no** a `/continue`, que es el
> arreglo de **F-191**. (3) El listado: `dev/listado.ts --branch ea2fe316` contra qa da
> **1 de 1 cableada, `211 AltaX` rt=2, HTTP 200**.
> curl contra `legacy-backend-qa.inertia-develop` + `dev/listado.ts` con `E2E_TARGET=qa`

⚠ **La tercera pieza NO está probada en qa**: el builder de documentos por PRODUCTO (el arreglo
de F-188, que es lo que hacía que Alta se cayera al firmar con 500). Pide llegar a la generación
de documentos, o sea el flujo completo — se prueba con `make harness-caminar CASOS='#ea2fe316:211'
CERRAR=1` contra el front desplegado, y eso necesitaba que el front estuviera arriba. En qa el
Rent to Own es el **205** y en producción el **193**, así que qa es justamente el ambiente donde
el código viejo estaba roto: vale la pena correrlo.

⚠ **Lo que quedó en la base COMPARTIDA de mi corrida**, para que nadie se pregunte: user
**1828318**, uReq **502189** (estado 3, lender 211, monto 2.000.000). El comercio: allied **339**
«Alta Fleet» (hash `75cfc9b2`), sucursal **2174** (hash `ea2fe316`), entidad **211** «AltaX».

⚠ **Y las imágenes siguen apuntando a `localhost:5195`**: la bienvenida de qa va a salir sin logo
ni foto para cualquiera que no tenga el panel del harness arriba. El layout aguanta —el componente
dibuja un relleno donde va el logo—. Quedó pendiente subirlas desde `legacy-application`.

**La URL para probar en qa:** `https://originaciones-qa.dev.creditop.com/self-service/ea2fe316/solicitar`

### 2026-09-09 (cierre 4) · por qué el botón de la fecha de pago no hace nada

Con los dos PRs aplicados en local, el canal de autogestión llega hasta `first-payment-date` y **ahí
se muere en silencio**: el cliente elige la fecha, aprieta «Continuar» y no pasa nada. Es **F-192**, y
son tres cosas encadenadas que conviene no confundir.

> **MEDICIÓN · 2026-09-09** — **el backend SÍ contesta, y con un mensaje presentable; el front lo
> tira.** `POST .../confirm-payment-date` para el uReq 466464 devuelve **409** con «Tu solicitud
> requiere un codeudor aprobado antes de firmar los documentos». El `catch` del action de
> `first-payment-date.tsx` llama a `captureServerException` y **devuelve `undefined`** — sin `throw` y
> sin valor de error—, así que React Router no navega ni pinta nada. ⚠ Y en local es completamente
> mudo: `APP_ENV=local` apaga PostHog, o sea que el error no queda ni en telemetría.
>
> **Y el paso anterior no debió mandarlo ahí.** `available-quota/extended`, sobre la MISMA solicitud,
> responde 200 con `type_policy_configured: false`, «la entidad no define política para esta etapa;
> sin restricción adicional» y **`next_step: first_payment_date`**. Dos endpoints del mismo backend
> contestan distinto: uno rutea a un paso que el otro rechaza. La causa es un fallback que existe en un
> lado y no en el otro — `CosignerRequirementService::applicantPolicyType()` usa **type 2 si el lender
> lo tiene y type 1 si no**, y con type 1 encuentra la categoría con `requires_cosigner = 1`. El propio
> docblock de ese servicio dice que la etapa que decide es la extendida, así que el fallback
> contradice la regla que él mismo escribe.
>
> `curl` a los tres endpoints con UA de iPhone, y `lender_users_categories` en local

⚠ **Y el dato de configuración que lo dispara es MÍO:** las **cuatro** categorías de AltaX salieron
con `requires_cosigner = 1` —incluida «Premium»—, copiadas del molde de Motai RTO, que las tiene
igual. O sea que para Alta **todo perfil exige codeudor**. Si eso no es lo que negocio quiere, es un
UPDATE; si sí lo es, el flujo debería rutear al codeudor y no a la fecha de pago, y ahí el problema
vuelve a ser el punto 3.

**El del front YA ESTÁ**, en el mismo PR #983: el action devuelve el error en vez de `undefined`,
rescata el `message` del cuerpo y la pantalla lo muestra con el banner que ya existía. Verificado — el
caminador pasó de «no redirigió ni dio error» a «respondió error: true», y en el navegador sale el
texto exacto del backend.

**Lo que queda, por dueño:** el arreglo del *front* (no tragarse el error) era chico y claramente
bueno — hoy cualquier 409 de ese endpoint es un botón muerto para cualquier comercio, no sólo Alta. El
del *backend* (que las dos puntas contesten lo mismo) tiene alcance y merece su propia prueba. Y el de
*config* es una decisión de negocio.

### 2026-09-09 (cierre 3) · la autogestión, y el 404 que nadie había visto

Tercer pedido de la tarea, ya en los mismos dos PRs: **que en autogestión no se le mande el mensaje al
cliente, y que en vez del handoff se lo redirija ahí mismo al flujo**.

**Lo primero que hay que decir es que el flag NO hacía falta.** Existe y es administrable en dos
niveles —`allieds.self_managed` y `lenders_by_allieds.user_self_management`— y Alta ya estaba así.
Verificado en la BD local: `allied 519` con `self_managed = 1`, y AltaX (lender 211, `rto`, rt=2) con
`user_self_management = 0`. Con eso `legacy-backend` ya no envía nada: el WhatsApp exige el segundo
flag y el modal «continúa con el asesor comercial» exige `!self_managed`.

Lo que faltaba era **decirle al front dónde sigue el cliente**. El back ya armaba esa url
(`/self-service/<hash>/<id>/confirmation`, en el `case 2/3/4`) y no la mandaba: sólo la copiaba a
`qrUrl`, y sólo en país 60. Ahora viaja como `continueUrl`, poblada sólo en autogestión y sólo para el
flujo en plataforma. El criterio va a `LenderTabBehaviorResolver::clientDrivesFlow()`, al lado del
`opensNewTab()` que ya decidía con el mismo trío — no a una clase nueva.

> **MEDICIÓN · 2026-09-09** — **el flujo autogestionado no mostraba un mensaje equivocado: se
> CORTABA.** `available-lenders.tsx` manda todo renting/RTO a `/continue` sin mirar ningún flag, y
> `continue` está declarada **sólo** en el árbol `merchant` de `routes.ts` — pero en autogestión el
> cliente entra por `/self-service`. Caminando el wizard de Alta por HTTP, el action responde
> `202 → /self-service/<hash>/<id>/continue`; con el cambio, `202 → .../confirmation`. Y las tres urls
> a mano: `/self-service/.../continue` → **404**, `/merchant/.../continue` → 302,
> `/self-service/.../confirmation` → **200**. Es **F-191**.
> `make harness-caminar CASOS='alta:211' CERRAR=1` con y sin el cambio (restaurando el archivo con
> `git show HEAD:`), más `curl` a las tres rutas con UA de iPhone

El mensaje falso también estaba —el texto por defecto de esa pantalla dice «Se ha enviado un mensaje
de WhatsApp con un link para continuar el proceso»— y es lo que hace que el defecto se lea como un
problema de copy cuando la navegación está rota. Vale registrarlo: **buscábamos un mensaje de más y
encontramos un 404**, y sólo apareció porque se corrió.

> **MEDICIÓN · 2026-09-09** — **el CANAL era la mitad de la explicación, y probar por el árbol
> equivocado me hizo cambiar la precedencia y después volver atrás.** Hay tres contextos y no son
> intercambiables: sin sesión, `/merchant/<hash>/solicitar` responde **302 a `/login`** —es el árbol
> del asesor— mientras `/self-service/<hash>/solicitar` y `/ecommerce/<hash>/solicitar` responden
> **200**. Alta entra por `/self-service`, donde nunca hay sesión: por eso mi corrida por consola
> (uReq 466444, `corporate_user_id = NULL`) continuaba bien y la corrida VISUAL de Miguel (466446,
> `corporate_user_id = 1827080`) iba al handoff — el panel del harness abre `/merchant/*`
> (`bin/asesor:462`). Los dos árboles montan el MISMO módulo para `solicitar`, así que la pantalla se
> ve igual y la diferencia no salta.
>
> En el medio invertí la precedencia para que `self_managed` ganara al asesor, y la **revertí** al
> confirmar el canal: con Alta en `/self-service` no hace falta, y sí tenía alcance sobre comercios
> vivos — 39 con el flag (9 activos), en rt=2 sólo dos con volumen en 90 días: Refurbi (1.600, 15 con
> asesor) y **My Tech (72, TODAS con asesor)**, o sea el 100% de su volumen. Queda como decisión de
> producto aparte, con la fila del trío marcada en la prueba.
> `curl` a las tres entradas con UA de iPhone · `user_requests`/`user_request_records` en local para
> las dos corridas · `make trazador-sql TARGET=prod` para el padrón

⚠ **Dos trampas del front al redirigir a una url que decide el back, las dos medidas:**
`routeHelpers.redirect` **prefija el contexto de la ruta** (produjo
`/self-service/<hash>/self-service/<hash>/<id>/confirmation`, hay que usar `redirectExternal`), y
`UrlGenerationService::buildUrl` devuelve una url **absoluta** con `front_end_url` de settings — para
continuar en el mismo browser se usa sólo el path, o el cliente sale del origen donde vive su sesión.

⚠ **Lo que NO entró, a propósito:** el defecto espejo de `legacy-application` (F-189), cuya condición
`... || $lender->response_type === 2` hace que para CUALQUIER rt=2 el `||` gane y se mande el WhatsApp
ignorando el flag. Sacar ese `||` cambia el comportamiento de todos los rt=2 en producción — es una
decisión aparte, con su propia prueba, y encima en un tercer repo. **Y tiene consecuencia práctica: si
en producción a Alta la atiende `legacy-application`, el WhatsApp se manda igual y este trabajo no se
nota.** Hay que confirmar qué monolito la sirve antes de dar el pedido por cerrado.

### 2026-09-09 (cierre 2) · las dos hojas bajo el panel

Diseño pidió que el contenedor azul termine en **dos capas más, transparentes**, como hojas apiladas
asomando. Son dos `div` decorativos (`aria-hidden` + `pointer-events-none`) al 55 % y al 30 % del color
de marca. **Las tres piezas —las dos hojas y el panel— tienen el mismo ancho y el mismo radio**, y lo
único que cambia es cuánto bajan: 48 px la de atrás, 24 px la de adelante. Así cada curva se apoya
sobre la hoja de atrás en vez de cortarse. Los 24 px de banda visible son a ojo de diseño: con 16 los
tres bordes se leían pegados. Acotadas a `merchant` (el panel de entidad es negro) y a
móvil (en desktop el panel llega hasta abajo).

**Tres versiones hasta acertar, y las dos primeras fallaron por lo mismo: querer resolverlo desde
adentro del panel.**

1. **hojas angostas en degradé, colgadas del borde** (`top-full`, cada una más angosta) — diseño lo
   rechazó: las quería del mismo tamaño.
2. **dos bandas del mismo ancho, corridas con `mt-4`** — la esquina cuadrada de la de abajo chocaba
   contra la curva de la de arriba y se veía **cortada**.
3. **hojas del ancho del panel, hermanas suyas y por detrás** — lo que diseño quería desde el
   principio: que cada curva se oculte tras la de adelante.

> **MEDICIÓN · 2026-09-09** — **desde adentro del panel esto NO se puede hacer, y no es una limitación
> de Tailwind.** Un hijo no puede pintarse detrás del fondo de su padre: el fondo del padre se pinta
> antes que cualquier descendiente, tenga `-z` o no. Por eso las dos primeras versiones tuvieron que
> colgar las hojas del borde con `top-full`, y ahí su borde superior recto choca con la curva del panel.
> La versión que funciona las saca a **hermanas** del panel, dentro de un envoltorio que existe sólo
> para darles de dónde medir, y se apilan **por orden del DOM** —las tres son posicionadas con
> `z-index: auto`—, con el panel escrito último. De ahí que el panel necesite su `relative`: si fuera
> estático, el contenido en flujo se pinta antes que los posicionados y las hojas le quedarían encima.
>
> **Y el envoltorio no mueve el layout**, medido en las dos variantes y los dos breakpoints
> (`x/y/ancho/alto`): `merchant` 390×844 panel `0/0/390/490` y botón `16/426/358/48`; `merchant`
> 1440×900 panel `0/0/720/800` y botón `104/548/512/48`; `entity` 390×844 idem móvil; `entity`
> 1440×900 panel `432/72/576/800` y botón `480/638/480/48`. Las cuatro filas dan **exactamente lo
> mismo** que antes del envoltorio, y ninguna genera scroll.
> Playwright contra `/merchant/<hash>/solicitar` en local; la variante `entity` forzada en la ruta y
> comparada contra el commit anterior restaurando el archivo con `git show HEAD:` — sin `stash`, que
> ya me hizo aplicar un stash viejo de Miguel una vez

**Y el pie va blanco con la «e» en verde** (pedido de diseño, sólo para comercio). El verde no se
decide en la pantalla: `CreditopBrand` pinta el acento en `#27CF85` con cualquier `color` **menos**
`black`, que lo apaga a negro junto con el resto — o sea que pedir «blanco con la e verde» es
exactamente dejar de pedir `black`, sin prop nueva ni tocar el componente de UI. Con eso el comercio
necesita **una sola** instancia del pie en vez de dos: la condición pasa de `backgroundImageSrc` a
`backgroundImageSrc && !esComercio`, y el par responsive queda sólo para la entidad.

> **MEDICIÓN · 2026-09-09** — `merchant` renderiza **1** instancia en los dos tamaños, con texto
> `rgb(255,255,255)`, relleno `#FFFFFF` y acento `#27CF85`. `entity` sigue con **2**: en 390×844 la
> visible es la negra (`#000000` en los dos rellenos) y en 1440×900 la blanca con el acento verde —
> idéntico a antes. **Su pie no cambia.**
> Playwright leyendo los atributos `fill` de los `path` del SVG, con la variante `entity` forzada en la
> ruta. ⚠ Para la captura hay que borrar `#react-scan-root`: las devtools flotan justo encima del pie y
> lo tapan — dos capturas se perdieron por eso antes de darme cuenta

⚠ Y una nota sobre el comentario que acompaña al código: una redacción intermedia justificaba el
`top-full` diciendo que el panel «crea contexto de apilado con su `z-10`». **Es falso** — el `z-10` es
de la columna, no del panel. Un comentario que explica bien una decisión con un mecanismo equivocado
enseña mal al que lo lee después.

### 2026-09-09 (noche 2) · la bienvenida pasa a ser del COMERCIO, en una columna JSON

Decisión de Miguel: la pantalla de bienvenida es del **comercio**, no de la entidad. Y la medición la
respalda — la única entidad con el flag encendido (CREDIMOVIL, 164) está en **un** comercio y es
siempre su única entidad activa, o sea que ahí entidad y comercio son lo mismo; Bancolombia BNPL está
en **161** comercios y Addi en 152. Mover la pantalla al comercio además **disuelve** el problema que
tenía la otra: el comercio se sabe siempre (su hash está en la URL), la entidad no.

**Una columna JSON, `allieds.intro_screen`, y `NULL` es el apagado** — la presencia ES el flag, así que
no puede existir «encendida y sin contenido» (el estado que sí admite la versión por entidad). Las
llaves son los props del componente que ya la dibuja, así que no hizo falta componente nuevo.

Dos PRs desde `qa`: **`Creditop-SAS/legacy-backend#1351`** (columna + cast + payload + validación con
allowlist, 13 pruebas) y **`Creditop-SAS/frontend-monorepo#983`** (el render y su gate).

Dos cosas salieron de capturas y no de razonar: con el panel en `bg-primary` el **botón primario
desaparece** (azul sobre azul), así que el componente pasó a tener variante `entity`/`merchant` con el
default intacto para no cambiarle el aspecto a CREDIMOVIL; y el gate tuvo que mirar `?step=`, porque
esta ruta sirve también el paso del teléfono y un refresh ahí reabría la bienvenida.

⚠ **Queda la mitad administrable**, y es una condición que me puse yo: el panel vivo que escribe
`allieds` es el Inertia de `legacy-application` y no se tocó, así que hoy esto se carga por SQL o por
la API de `Modules/Partner`. Sin campo en ese panel, cada alta necesita un dev — que es exactamente lo
que le pasa a `lenders.calculator`.

### 2026-09-09 (cierre del día) · Alta en el panel, y el autorelleno del camino visual

Alta Fleet quedó en los atajos del panel del harness, con lo que ejercita anotado. Y se escribió el
**autorelleno** (`harness/pkg/autorelleno.ts`, enganchado en `openWindow`): la pantalla se llena sola y
sólo hay que dar «Continuar». Heurístico a propósito —no un mapa de campos— porque lo cansón son las
pantallas que ningún seeder cubre, y usa los datos sintéticos del harness para no inventar otra persona.

Tres cosas salieron de mirar capturas y no de razonar: los controles del wizard son de **radix** (el
trío de fecha es `button[role=combobox]`, la confirmación `button[role=checkbox]`), el trío de fecha hay
que resolverlo **junto** (la primera opción de cada uno daba `2026-01-01` de fecha de expedición), y una
regresión propia: meter el texto de los ancestros en la pista de todos los campos hizo que «apellidos»
ganara en todos. Queda `dev/autorelleno-probe.spec.ts` como sonda, porque el modo de falla es silencioso.

⚠ Y el límite, medido: rellena, pero **no hace que un usuario sintético pase el KYC** — el
self-service a mano queda completo hasta `personal-info`, sin errores ni 4xx, y de ahí no sale. Para eso
está el guiado, que saltea esa pantalla a propósito. Los dos se complementan.

### 2026-09-09 (noche) · F-188 arreglado sobre `qa`, y Alta cierra

Rama `feat/alta-fleet-documentos-por-producto` desde `origin/qa` (los dos repos bajados primero) →
**PR `Creditop-SAS/legacy-backend#1349`**. El builder de documentos se elige por `lenders.product`;
`builderClassFor()` extraída pura, 5 pruebas unitarias corridas **con ruta explícita** (nunca la suite
entera).

Medido antes de tocar, para que no fuera un refactor a ciegas: sólo tres entidades tienen catálogo de
firma en producción y dos en dev/qa, así que en producción el cambio es **equivalente** y en los otros
dos ambientes **repara**. En `qa` el defecto estaba vivo: el RTO es el 205 y el mapa decía 193.

Verificado corriéndolo: Alta Fleet **cierra en estado 11** con sus cinco documentos firmados,
`codeudor.json` volvió a **verde** y la autogestión devuelve `showModal: false`.

**El frontend no necesitó nada**, y se comprobó contra `origin/qa` antes de escribir: ya tiene el
componente de bienvenida, ya lee los tipos de documento del backend y ya no le queda nada quemado de
Motai. Se deja anotado para no volver a buscarlo.

### 2026-09-09 (cierre) · la herramienta se generalizó, y los otros dos pedidos ya eran config

`montar-alta.ts` duró medio día: se generalizó a `montar-comercio.ts` + spec declarativo
(`make harness-comercio COMERCIO=alta`), porque la tercera vez que se copia un seeder de comercio lo
que hay que versionar es el DATO. Cubre la forma común y deja las integraciones de país en su script
—`montar-peru.ts`— a propósito.

La **pantalla de bienvenida** ya existía como config desde abril y sólo la usa CREDIMOVIL en
producción; se prendió para AltaX y se verificó por API. Salió una restricción del esquema: su titular
es la misma columna que la descripción de la tarjeta.

La **autogestión** tampoco necesitaba un flag: hay tres mecanismos y dos ya son administrables. El
problema es que `legacy-application` ignora el flag para `rt=2` con un `||` y lo parchea con una lista
quemada marcada TEMP. La forma escalable es un resolver hermano del que ya existe.

Y mientras esto se escribía, **alguien creó la entidad 199 en producción** y la activó en la sucursal
sin configurarla — el grupo de reglas vacío que este mismo día se había descrito como riesgo.

### 2026-09-09 (tarde) · montado en local, y el bloqueador tiene nombre

Se escribió `harness/dev/montar-alta.ts` y se corrió. Alta Fleet **lista y ofrece PEP**; no cierra, y
la causa es un mapa por id de entidad quemado en el generador de documentos (**F-188**) que también
rompe el Rent to Own de Motai en local. La suite `alta.json` queda con el cierre en rojo a propósito.

En el camino salió **F-187**: dos runners del harness decían «target local» y pegaban contra el RDS
compartido, por un import estático evaluado antes del default. Arreglado, y `CLAUDE.md` corregido —
afirmaba lo contrario.

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
- Al elegir la entidad, el cliente ve primero una **pantalla de bienvenida de la marca** —logo,
  mensaje y fondo, a pantalla completa— como la que ya tiene otra de las entidades.
- El comercio opera en **autogestión**: el cliente avanza solo y **no recibe un mensaje pidiéndole que
  continúe**, ni se le dice que siga con un asesor.

## Alcance

Entra la puesta a punto del comercio, su punto de venta de Bogotá, su entidad propia, su pantalla de
bienvenida y el modo autogestión. **No** entra la validación de ingresos de aplicaciones de reparto,
**no** entra el cobro de la suscripción mensual, **no** se toca la configuración de las entidades del
banco que el comercio ya tiene, y **no** entran las piezas de marca (logo y fondo de la pantalla de
bienvenida), que las tiene que entregar diseño.

⚠ Un límite que conviene saber antes de aprobar el texto: **el mensaje de la pantalla de bienvenida es
el mismo texto que la descripción de la tarjeta** en el listado. Hoy no se pueden escribir distintos.

## Dónde probar

Ambiente local primero, con el comercio y el punto de venta sembrados por las herramientas de prueba. En producción
existe ya el comercio **Alta**, punto de venta **Calle 90** (Bogotá).

## Cómo validar

1. Entrar al onboarding por el punto de venta de Alta Fleet.
2. En el formulario de datos personales, comprobar que el selector de tipo de documento ofrece **PEP**.
3. Completar el flujo con un cliente que cumpla las reglas y comprobar que la entidad del comercio
   aparece en el listado de opciones.
4. Elegirla y comprobar que aparece la **pantalla de bienvenida** con el mensaje y el fondo de la
   marca, y que el botón continúa al flujo.
5. Comprobar que **no llega ningún mensaje** (WhatsApp ni correo) pidiendo continuar, y que la pantalla
   no dice que hay que seguir con un asesor: el cliente avanza en el mismo dispositivo.
6. Llegar hasta la firma; la solicitud debe quedar **Autorizada**.
7. Repetir con un cliente que NO cumpla una regla dura (por ejemplo, ingreso por debajo del mínimo) y
   comprobar que la entidad no se le ofrece.

⚠ Desde un **computador de escritorio** el sistema sí manda un link con QR para seguir en el celular,
y eso es correcto: la validación de identidad necesita cámara. Probar la autogestión **desde el
celular**.

## Criterios de aceptación

- El selector de documento ofrece PEP en el punto de venta de Alta Fleet.
- La entidad del comercio aparece en el listado para un cliente que cumple las reglas.
- Un cliente que no cumple una regla dura no la ve.
- El cupo que ofrece la tarjeta y el que calcula el sistema al continuar **coinciden**.
- La pantalla de bienvenida aparece al elegir la entidad, con el mensaje y el fondo correctos.
- Desde el celular, el cliente completa el proceso **sin recibir ningún mensaje** para continuar.
- La revisión de configuración de la entidad da los cinco chequeos en verde.

## Dependencias / contraparte

- **Ya definido:** el cliente termina siendo dueño de la moto, así que el crédito exige codeudor y el
  plazo se ofrece en 12, 18 o 24 meses.
- **Legal:** las plantillas del contrato con opción de compra **a nombre de Alta Fleet**. Hoy el
  comercio nuevo firmaría un contrato con la marca de otro comercio, y sólo existe la versión con
  codeudor.
- **Desarrollo, y son dos cosas bloqueantes.** (1) Hoy los documentos del producto sólo se generan
  para los dos comercios que ya lo venden; cualquier comercio nuevo llega hasta la firma y ahí falla.
  (2) El sistema manda el mensaje de «continuá el proceso» a todo cliente de una entidad de este tipo,
  sin mirar si el comercio está en autogestión. Las dos hay que resolverlas antes de habilitar Alta
  Fleet: sin la primera el cliente elige y no puede firmar; sin la segunda recibe un mensaje que en
  autogestión no corresponde.
- **Diseño:** el logo y la imagen de fondo de la pantalla de bienvenida. Hoy están puestas las de otra
  entidad, sólo para poder verla.
- **Comercial:** confirmar si la entidad propia conviven con las dos del banco o las reemplaza.
- **Producto:** los valores de la cuota (margen, cuota inicial, gastos de alistamiento) son hoy los
  de otro comercio; hacen falta los de Alta Fleet.
