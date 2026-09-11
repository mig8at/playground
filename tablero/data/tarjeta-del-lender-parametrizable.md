---
id: 79
title: "La tarjeta del lender, por capacidad y no por id"
stage: idea
ramas: ""
created: "2026-09-11T08:00:00-05:00"
context_nodes: [hardcodes-entidades, frontend-monorepo, entities, findings]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Miguel preguntó si conviene que **cada lender defina cómo se muestra su tarjeta**, para sacar la forma
quemada de hoy. Se midió antes de opinar, y la medición cambió la respuesta: **el canal ya existe, ya
es administrable, y está roto en las dos direcciones** — hay tres campos que el admin guarda y la
tarjeta nunca dibuja, y dos que la tarjeta sí lee y **ningún admin puede escribir**. Así que el trabajo
no es inventar el mecanismo: es terminarlo. Y el costo que de verdad duele no está en la tarjeta, está
en las **formas del payload** de cada lender, que el front conoce una por una.

⚠ La distinción que decide el alcance: una cosa es que el lender declare **QUÉ tiene** (planes
calculados, lista de beneficios, su propio copy de botón) y otra que declare **CÓMO se ve** (layout,
componentes, slots). Lo primero mata las listas de ids. Lo segundo es un lenguaje de render para
mantener, y el lender no conoce el design system del wizard.

## Lo que se midió (2026-09-11)

### 1 · el canal de presentación YA EXISTE y es una columna administrable

`lenders.additional_data` (longText, migración `2023_04_20_202610`) llega al front como **string JSON**
y su tipo declara seis campos: `amount_text`, `number_fee_text`, `rate_text`, `conditional_text`,
`action_text`, `benefit_list`.

### 2 · pero ninguna de las dos puntas coincide con la otra

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

### 3 · y los CUATRO lugares que lo escriben son DESTRUCTIVOS

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

### 4 · qué hay REALMENTE en la base (copia local, 162 lenders)

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

### 5 · la identidad quemada del front son 31 usos en ~18 archivos — y `quemado` no la ve

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
> | `HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS` | **0** | **0** |
>
> El último es **código muerto**: la constante y su helper `hidesAvailableCreditTag` sólo aparecen en
> su propio archivo de declaración.

### 6 · TRES lenders tienen forma propia de cotización, y ahí está el costo real

`lender-transaction-data.service.ts` (389 líneas) tiene extractores de dos clases: genéricos
(`extractProductCondition`, `extractRevolvingLimits`, `extractCategoryRate`,
`extractQuotaInitialFeePercentage`, `extractCategoryFga`) y **por lender**: `extractPramiQuotas`,
`extractMeddipayOffers`, `extractMeddipayCreditLimit`, `extractMeddipayTermOptions`,
`extractWelliInstallments` — más Credifamilia con su plan dinámico aparte.

**El front conoce la forma del payload de cada lender.** Eso no es presentación: es un adaptador que
quedó del lado equivocado de la frontera.

### 7 · TRES puertas distintas, y es lo que hace que la retrocompatibilidad salga gratis

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

### 8 · lo que NO está normalizado es `transaction_data`, y el que puede normalizarlo es el MICROSERVICIO

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

## Lo que ya está resuelto bien, y sirve de molde

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

## La propuesta, en tramos

### Tramo 0 — la poda · horas · riesgo nulo

- Borrar `HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS` y `hidesAvailableCreditTag`: sin consumidores.
- Sacar `BANCOLOMBIA_LENDER_IDS.includes(lenderData.id)` de `shouldShowBenefitList`
  (`LenderCardContent.tsx:1078`). La condición ya exige `!isNil && !isEmpty`, y sólo 68 y 100 tienen
  `benefit_list`, así que **la conducta no cambia** — cambia la REGLA: de «lo muestro si sos
  Bancolombia» a «muestro lo que llegó».
  ⚠ Ojo al efecto colateral: `shouldApplyDarkBackground` (línea 1089) cuelga de esa misma variable, así
  que el día que otro lender traiga beneficios también cambia de fondo. Es lo que se quiere, pero hay
  que decirlo.

**Qué compra:** el siguiente lender con beneficios funciona sin tocar código.

### Tramo 1 — conectar el canal que ya existe · días · el mejor retorno

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

### Tramo 1b — el bloque `card` en la respuesta del listado (la idea de Miguel) · aditivo

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

### Tramo 2 — normalizar la cotización EN EL MICROSERVICIO · el caro, y el que de verdad paga

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

### Tramo 3 — lo que NO haría

Un DSL de layout: que el backend mande componentes, slots o estructura. Cuesta un lenguaje que
mantener, le quita tipos al front, convierte un cambio de diseño en un cambio de dato, y el lender no
conoce el design system del wizard. La regla que lo reemplaza: **el lender declara QUÉ tiene; la
tarjeta decide CÓMO se ve.**

## Riesgos y preguntas abiertas

- **Los números de la medición 4 son de la copia local.** Antes de tocar nada hay que repetir esa
  consulta **contra prod** (lectura, que es lo único permitido): si allá `benefit_list` lo tiene alguien
  más que 68 y 100, el tramo 0 deja de ser neutro.
- **`rate_text` con ocho grafías es un síntoma, no la enfermedad.** Convertirlo en dato (tasa + período)
  es su propio trabajo y no está costeado acá; lo que sí conviene es no agregar más texto libre
  mientras tanto.
- **`quemado` no indexa el front**, así que el inventario que usamos para priorizar tiene un punto
  ciego. Cerrarlo es barato y hace visible esto y lo que venga.
- El merge de los writers (tramo 1.1) toca dos monolitos a la vez. Van por PRs separados.

## Registro

### 2026-09-11 · segunda pasada: las tres puertas, y dónde va la normalización

Miguel preguntó si el listado que consume el wizard es el del microservicio o `lenders-v1`, para no
validar sobre el camino equivocado. Medido: el wizard usa **`lenders-v2`** del monolito, y el
microservicio de pre-aprobados es una llamada **aparte** (`/v1/preapprovals/check`) — las mediciones de
arriba caen sobre el camino correcto. De paso salieron dos cosas que cambian el plan: `legacy-application`
consume **otro endpoint**, así que la retrocompatibilidad ya está dada por construcción (medición 7); y
el `transaction_data: unknown` del microservicio es **el origen real** de los cinco extractores, así que
el tramo 2 se mueve del monolito al microservicio (medición 8). Se agregó el tramo 1b con la propuesta
de Miguel —un bloque `card` aditivo en la respuesta del listado— y la línea que la mantiene sana:
contenido y capacidades sí, estructura no.


### 2026-09-11 · medido y propuesto

Nace de una pregunta de Miguel: «¿que cada lender defina cómo mostrar su tarjeta y eliminar lo
hardcodeado?». Se midió antes de opinar, y la medición corrigió dos cosas que yo había dado por buenas
al empezar: (a) `action_text` **sí** se lee —el override genérico ya está mergeado— y lo que falta es
poder escribirlo; y (b) los writers no sólo omiten campos, los **destruyen**, que es un problema
distinto y más urgente que el hueco de formulario.

## Tarea (publicable)

## En una línea

Que los textos y los beneficios con los que se muestra cada entidad en el listado se puedan configurar
desde el administrador, en vez de estar escritos en el código del wizard.

## Por qué

Hoy la caja de configuración de la entidad existe y está a medias: hay campos que el administrador
guarda y la tarjeta nunca muestra, y —al revés— los dos que la tarjeta sí usa (la lista de beneficios y
el texto del botón) **no se pueden escribir desde ninguna pantalla**. Peor: como al guardar se
reescribe la caja completa, lo poco que alguien haya dejado cargado a mano **se borra solo** la próxima
vez que se edite esa entidad. El resultado es que cambiar el copy de un botón, que debería ser un
campo, hoy es un despliegue.

## Qué cambia

- El administrador gana dos campos por entidad: **texto del botón** y **lista de beneficios**.
- Guardar una entidad deja de borrar lo que no está en el formulario.
- Los campos que el administrador guarda y nadie muestra se resuelven: o se muestran, o se retiran de
  la pantalla, para que no prometan un efecto que no ocurre.
- La lista de beneficios deja de estar reservada a una entidad puntual: la muestra cualquiera que la
  tenga configurada.

## Alcance

Entra la configuración de **textos y beneficios** de la tarjeta. **No entra** rediseñar la tarjeta, ni
que cada entidad decida su distribución visual (componentes, orden o estructura): la entidad declara
**qué tiene**, la tarjeta sigue decidiendo cómo se ve. Tampoco entra unificar cómo viaja la tasa, que
hoy está escrita en texto libre de ocho maneras distintas — queda anotado como trabajo aparte.

## Dónde probar

Ambiente **dev**, con cualquier comercio que liste varias entidades. Las dos entidades de Bancolombia
(compra y paga después · crédito de consumo) son las únicas que hoy tienen beneficios cargados, así que
sirven de control: tienen que seguir viéndose igual que antes del cambio.

## Cómo validar

1. En el administrador, abrir una entidad **sin** beneficios, cargarle dos o tres y guardar.
2. Entrar al listado con un comercio que ofrezca esa entidad: los beneficios tienen que aparecer en su
   tarjeta.
3. Volver al administrador, cambiar cualquier otro campo de esa misma entidad (por ejemplo el nombre) y
   guardar de nuevo. **Los beneficios tienen que seguir ahí**: es lo que hoy se pierde.
4. Cargarle un texto de botón propio y verificar que la tarjeta lo usa en lugar del texto por defecto.
5. Dejar el texto de botón **vacío** y verificar que vuelve el texto por defecto de esa entidad, no una
   tarjeta con el botón en blanco.
6. Control: las dos entidades de Bancolombia siguen mostrando sus beneficios y su botón como hoy.

## Criterios de aceptación

- Un texto de botón configurado se ve en la tarjeta sin necesidad de un despliegue.
- Editar y guardar una entidad **no** borra ningún dato de configuración que no esté en el formulario.
- Una entidad con beneficios cargados los muestra, sea cual sea la entidad.
- Vaciar un campo devuelve el comportamiento por defecto y nunca deja la tarjeta con un texto en blanco.

## Dependencias / contraparte

El formulario del administrador y la pantalla del cliente viven en sistemas distintos, así que el
cambio va en dos entregas coordinadas: primero la que deja de borrar y agrega los campos, después la
que ajusta la tarjeta. Ninguna necesita nada de un proveedor externo.
