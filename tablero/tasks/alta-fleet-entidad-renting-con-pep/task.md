---
id: 76
title: "Alta Fleet: entidad propia, pantalla de bienvenida y autogestión"
stage: work
ramas: feat/comercio-pantalla-de-bienvenida, feat/la-card-de-alta
created: "2026-09-09T10:00:00-05:00"
canon: [motai, altas, creditopx, listado]
jira: [CORE-558]
jira_title: "Alta Fleet: entidad propia, pantalla de bienvenida y autogestión"
---

## Lo que se mergeó: el libro mayor de los PRs

> Medido el 2026-09-14 con `gh` y `git merge-base --is-ancestor`, no de memoria. Las horas son de
> Colombia (`gh` las devuelve en UTC). Esta sección es ESTADO: se reescribe, no se apila.
> **Sólo lo de Alta, sólo lo mío y sólo lo que está EN `qa`** — que es lo que realmente se hizo. Lo
> que mergeó otra gente vive en SU tarea; lo que no mergeó no se hizo, por buena que fuera la razón.

| | PR | rama | tamaño | mergeado a `qa` | commit |
|---|---|---|---|---|---|
| front | **#983** dibuja las páginas propias del comercio, y la primera es la bienvenida | `feat/comercio-pantalla-de-bienvenida` | +1226/−105 · 39 arch | 10/9 09:33 | `3f3f87000` |
| back | **#1351** las páginas propias de un comercio, y el arreglo que la deja firmar | `feat/comercio-pantalla-de-bienvenida` | +1117/−33 · 19 arch | 10/9 09:33 | `f70fa7a5f` |
| front | **#987** saca dos imports sobrantes de `posthog.server` que rompen el build de `qa` | `fix/import-servidor-sobrante-rompe-el-build` | +2/−2 · 2 arch | 10/9 09:54 | `852cc163d` |
| front | **#994** el selector de plan aparece cuando hay algo que elegir | `feat/la-card-de-alta` | +318/−201 · 5 arch | 14/9 08:26 | `aed2acf1b` |

### ⚠ Dónde está todo esto: en `qa`, y en ningún otro lado

Verificado con `git merge-base --is-ancestor` contra los tres refs, los cuatro commits dan lo mismo:

    origin/develop   NO      origin/staging   NO      origin/main   NO

Así que **«Alta está lista» quiere decir «lista en `qa`»**. Y `qa`, `dev` y `staging` comparten la BD
pero **no el backend**, así que probarlo apuntando al front de staging mide otra rama.

⚠ **Por qué el #987 existe, y por qué son 21 minutos: #983 rompió el build de `qa` al mergear.**
Entró con **dos imports de más** —`captureServerException` de `~/utils/posthog.server`, en
`bancolombia/bnpl/processing.tsx` y en `request-canceled.tsx`— que nadie usaba. Es exactamente el
defecto que **sólo el build atrapa**: vitest, `tsc` y biome lo dejan pasar, biome lo marca como
*warning* y el despliegue se cae igual. Es **F-194**. El #987 son dos líneas y verificado: `qa` hoy
importa sólo `captureAndRethrowServerException` en las dos rutas.

> **Y de ahí sale una trampa de medición: `make tareas-ramas` dice «falta en qa» para #983 y es
> FALSO.** La remota `feat/comercio-pantalla-de-bienvenida` apunta a `77717c77`, pero lo que mergeó
> fue **`b8466f5f`** (los padres del merge `3f3f8700` son `b42af7f7` y `b8466f5f`), y esos dos
> difieren justo en los dos imports de arriba. O sea que el tip de la rama coincide con lo que `qa`
> tiene HOY —después del hotfix— pero con un commit que nunca entró por su propio SHA. El contenido
> está: `allied-theme` tiene en `qa` las +92 líneas de `pages`/`welcome`. La lección general: cuando
> la medición por commit diga «falta», el desempate son los PADRES del merge y el contenido, no el
> nombre de la rama.

### La consecuencia que más duele: F-188 está arreglado en `qa` y VIVO en `main`

El **#1351** trajo ese arreglo —commit `32e22122`, verificado dentro del merge y presente en `qa`—.
`CatalogDocumentPayloadResolver` elige hoy el builder del PDF así:

| rama | llave | qué implica |
|---|---|---|
| `qa` | `BUILDERS_BY_PRODUCT` (`:56`, `:91`) | cualquier entidad con renting/RTO firma, sin tocar código |
| `main` | `BUILDERS_BY_LENDER` (`:41`, `:65`) | se elige por **id quemado**, y el id del RTO es 193 en prod, 205 en dev/qa y 173 en el dump local |

O sea que **en producción el defecto sigue de pie**: una entidad `rt=2` nueva que reuse ese catálogo
lista bien, simula bien y **se cae al firmar con 500** (`Undefined variable $nombre_cliente`). Mientras
`qa` no promueva, el arreglo no protege a nadie. → [[hardcode-payload-builder-documentos]]

### Dos pantallas de bienvenida, y no son la misma

La de #983 es **del COMERCIO** y no hay que confundirla con la que ya existía:

| | dónde se configura | cuándo se dibuja |
|---|---|---|
| **comercio** | `allieds.pages.welcome` | al ENTRAR al flujo |
| **entidad** | `lenders.show_intro_screen` + `intro_background_url` | al ELEGIRLA, en `loan-confirmation` |

Usan el mismo componente (`LenderIntroduction`) y viven en capas distintas — no hay precedencia entre
las dos y pueden convivir. Buscar la de una en la columna de la otra es el error fácil.

### Qué falta para cerrar Alta de verdad

1. **Promover `qa` → `main`.** Recién ahí se borran las dos marcas `⏳ PENDIENTE DE MERGE` que quedaron
   en `context/` — `merchants` §10 y `hardcodes-entidades`.
2. **Corregir la fila 199 en PROD** — sigue con `product=credit`, `document_types=["CC"]`, sin
   `calculator` ni `originator_nit`, y 3 de los 5 chequeos de readiness fallando. Nada de lo mergeado
   toca eso: es dato, no código.
3. **`CORE-563 · Parte2. Alta dashboard`** está en el sprint activo y **no tiene archivo de tarea**.


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
3. ✅ **F-188 arreglado, y en `qa` por `legacy-backend#1351`** (commit `32e22122`). El payload builder se elige por
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

> ⏩ **Este frente vive en `playground.md`** hasta que se convierta en Jira. Lo de abajo se conserva
> porque es donde se midió por primera vez, pero **no se actualiza más acá**.


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

### La card de Alta contra la de Motai — medido el 2026-09-12, sin tocar código

Miguel mostró el diseño de la tarjeta de Alta: logo, **una** fila (*Pago semanal \* → $225.000*) y el
botón *Validar Pre aprobado*. Nada más. La pregunta era si se puede con la tarjeta que hoy usa Motai —
que tiene más campos— o si toca una segunda tarjeta.

**Primero, la premisa era otra.** En **producción** Alta NO usa la tarjeta de Motai: `lenders` 199
«Alta te financia» tiene **`product = credit` y `calculator = NULL`**, así que cae en
`StandardLenderCardContent` — la tarjeta de **crédito**, con cupo, cuotas y tasa. La que hereda la de
Motai es la de **local**, montada acá como `AltaX` (211, `product = rto`, calculator con **tres**
planes 12/18/24 meses = 52/78/104 semanas). El mock no es ninguno de los dos: es un tercer diseño.

**Segundo, no existe «la tarjeta de Motai».** `CalculatorLenderCardContent` es **una sola** para
renting y RTO, con filas condicionales. La brecha exacta contra el mock:

| elemento | hoy | mock | qué lo decide hoy |
|---|---|---|---|
| logo + nombre | ✔ | ✔ | fuera de esa función |
| **Monto total** | ✔ (el RTO lo muestra) | ✗ | `product === 'renting'`, única forma de ocultarlo |
| **Pago semanal \*** | ✔ | ✔ | `plans.length > 0`; el «semanal» sale solo (`payment_unit` por defecto `weekly` en el backend) |
| **Plan \*** (select) | ✔ | ✗ | `plans.length > 0` — **no tiene interruptor propio** |
| botón | ✔ | «Validar Pre aprobado» | `additional_data.action_text`, que **ningún admin escribe** (medición 2) |

**Conclusión: NO hace falta una segunda tarjeta.** Faltan dos interruptores, y su naturaleza es
distinta — es eso lo que decide el alcance:

1. **El selector de plan se resuelve SIN schema nuevo.** Con **un** plan no hay nada que elegir: un
   `select` de una sola opción es ruido en la tarjeta de cualquier entidad. La regla «el selector
   aparece con más de un plan» es correcta universalmente, no es un parche para Alta, y Motai conserva
   los suyos. Cero columnas.
2. **El «Monto total» sí necesita dónde escribirse.** Ocultarlo en un RTO es una decisión **comercial**
   —no anclar al cliente en el precio de la moto— y varía por entidad, no por producto. Lo más barato
   es un campo en `calculator`, que el admin ya edita como JSON; lo más limpio, el bloque `card` del
   tramo 1b.

⚠ **Lo que NO se hace:** poner `product = 'renting'` para heredar la tarjeta. Ya se probó y se descartó
en esta misma tarea —rompe el generador de documentos (F-188)— y el test que lo cubre existe justamente
por eso.

**Bloqueado en dos decisiones de negocio** (Miguel, 2026-09-12: las dos **sin definir todavía**):

- **¿Alta cotiza UN plan o varios?** El mock no deja elegir. Si es uno, el punto 1 lo resuelve gratis.
  Si son tres y el cliente no los elige, hay que definir **quién fija el plazo** — hoy quedaría el
  default del calculator y nadie decide.
- **¿Por qué no va el «Monto total»?** Si es decisión comercial, punto 2. Si el mock todavía puede
  llevarlo, no hay nada que construir.

**Lo que salió de paso y no depende de esas respuestas:**

- **`terms` vs `plans`**: el backend elige la llave de la matriz por **cuál está presente**
  (`LenderCalculator::matrixKey`), no por producto, mientras su propio docblock dice *«`plans`
  (renting) | `terms` (rto)»*. Una entidad RTO configurada siguiendo ese comentario se queda **sin fila
  de pago y sin selector**, en silencio, porque el front sólo lee `calculated.plans`. Ya hay una así en
  la base: **Motai RB (170)**, `rto`, con calculator de params y fórmulas y **ninguna matriz** — su
  tarjeta hoy es «Monto total» y el botón. Es **F-212**.
- **El asterisco de «Pago semanal \*» y «Plan \*» no apunta a nada**: está escrito dentro del label y
  no hay nota al pie en ninguna parte de la tarjeta.


#### El flag por componente ya existe, y su precedente dice lo que cuesta

Pregunta de Miguel (2026-09-13): *«¿es posible un flag para cada componente y decidir cuándo mostrarlo
o no?»*. La respuesta corta es que **sí, y ya está hecho una vez**: `lenders.show_disbursement_details`
(`tinyint(1)`, default 1, migración `2026_07_01_120000`) es exactamente eso — un interruptor por
entidad que apaga un bloque de la tarjeta. En **producción lo usan 3 de 199 entidades**.

Ese precedente deja dos cosas medidas, y las dos importan más que la pregunta:

**1 · Un flag que esconde un componente se lleva lo que cuelga de él.** No lo deduzco: lo dice el
comentario que alguien tuvo que escribir en `LenderCardContent.tsx` al chocar con eso —

> *«Vive FUERA de `LenderCardBodyDetails` a propósito. Ese componente corta de entrada cuando
> `show_disbursement_details === false` —el caso de Nequi—, y ese corte se lleva también los
> beneficios, así que nada colgado de ahí se vería.»*

O sea que el renglón «Te financiamos hasta X» está fuera de su padre natural **por culpa del flag**. El
flag no sólo esconde: reordena el árbol de componentes, y lo paga el que viene después.

**2 · Nadie lo puede escribir.** Vive sólo en `legacy-backend` —migración, modelo y un servicio— y
**no aparece en `legacy-application`**, que es donde está el admin. Las 3 entidades que lo tienen en 0
llegaron ahí por un UPDATE a mano. Es la misma historia de `action_text` (medición 2): el canal existe,
el override funciona, y producto no puede tocarlo.

**Agregar flags a un canal que nadie puede escribir, sobre un árbol donde esconder una caja mata su
contenido, es ponerle caudal a un tubo roto.**

#### La recomendación: no un flag por componente, UNO

De los cuatro renglones de la tarjeta de alquiler, **tres se deducen del dato** y sólo uno necesita que
alguien decida:

| renglón | ¿lo contesta el dato que ya llega? |
|---|---|
| Pago del período | **sí** — hay planes calculados o no |
| Plan | **sí** — hay más de uno o no (hecho, PR #994) |
| Texto del botón | **ya tiene canal** (`action_text`); falta quién lo escriba |
| **Monto total** | **NO** — es decisión comercial por entidad → acá sí, un flag |

La regla que se sigue de esto, y que conviene fijar antes de que entre el próximo renglón: **primero se
pregunta si el dato ya lo contesta; sólo si no, se le da un interruptor.** Así la cantidad de flags se
queda cerca de cero y cada uno está justificado. Lo contrario —un booleano por caja— son 2⁴
combinaciones de las que nadie probó 15, y ninguna dice POR QUÉ se esconde.

⚠ **Y el prerrequisito vale más que el flag:** mientras el canal siga sin admin (tramo 1), cualquier
interruptor nuevo se configura con un UPDATE a mano, igual que los 3 de `show_disbursement_details`.


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

> **MEDICIÓN · 2026-09-09 (rama `qa` + el arreglo)** — **Alta Fleet cierra de punta a punta.** uReq
> 466427: listado `[211]`, **estado 11**, y los cinco documentos del Rent to Own **generados y
> firmados** (`lease_agreement`, `cosigner_agreement`, `promissory_note`, `chattel_mortgage`,
> `payment_schedule`). Y la regresión que estaba en rojo volvió a verde: `codeudor.json` **2/2 en
> estado 11**, y `alta.json` **2/2**.
> `make harness-comercio COMERCIO=alta` · `make harness-suite SUITE=harness/suites/alta.json CERRAR=1 LAMBDA=1`

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
