---
id: 44
title: "SmartPay multipaís — sacar el país de las venas del código"
stage: backlog
created: "2026-08-08T09:00:00-05:00"
context_nodes: [smartpay, hardcodes-entidades, microservicios, entities, actors]
jira: []
jira_title: "Multipaís: el país deja de estar quemado en el código y pasa a ser configuración del mercado"
---

ESTADO 2026-08-08: análisis y medición hechos. **Nada tocado en los repos reales.** Falta decidir el
alcance con negocio (ver DECISIONES PENDIENTES) antes de escribir una línea.

## MEDICIÓN (2026-08-08, contra `main` de los 3 repos y prod)

**El tamaño.** Motai fueron 15 sitios en 3 repos. Esto es **~250 archivos**:

| | legacy-backend | application | frontend | 
|---|---:|---:|---:|
| `country_id` | 51 | 46 | 11 |
| prefijo `+57` | 42 | 10 | 23 |
| literal `Colombia` | 31 | 20 | 15 |
| `COP` | 16 | 8 | 36 |
| `DOP` | 5 | 4 | 5 |
| `es-CO` | — | — | 42 |
| `es-DO` | — | — | 6 |

La asimetría CO/DO en cada fila dice qué pasó: **RD se fue agregando caso por caso**, no como mercado.

**La buena noticia: el modelo ya tiene la dimensión.** `countries` tiene `currency`, `locale`,
`dial_code`, `cell_phone_lenght`, `iso_code_2/3`, `address_format`. Y hay `country_id` en `allieds`,
`lenders`, `users`, `settings`, `credit_lines`, `country_zones`, `corporate_users` y las taxonomías de
comercio. **No hay que inventar el mecanismo: hay que terminarlo y hacerlo obligatorio.**

**El mecanismo a medio construir.** El backend YA arma y envía `currency_format` por solicitud:

```php
$country = $userRequest->allied?->country;      // ← el mercado sale del COMERCIO
['locale' => $country?->locale, 'currency' => $country?->currency]
```

Está **copiado a mano en 4 controladores** (`ContinueUserFlowController.php:44`,
`PaymentScheduleController.php:93`, `ListLenderController.php:46`,
`ValidateOtpPromissoryNoteController.php:85`). Y el front lo consume en **2 lugares**
(`loan-approved.tsx:132`, `payment-schedule.tsx:241`) mientras hardcodea `es-CO` en ~40, incluido el
formateador compartido `packages/shared/utils/src/currency/formatter.ts:3` cuyo **default es `es-CO`** —
o sea que quien no pasa locale obtiene Colombia sin enterarse. Ya hay un comentario de alguien que se
chocó con esto: `additional-info-form.tsx:32` («Hardcoded hasta que se exponga»).

**El corazón del problema.** Esta línea aparece **cuatro veces, copiada**
(`TwilioController.php:187`, `NotificationService.php:114` · `:217` · `:251`):

```php
$isDoLogic = ($userRequest->lender?->country_id === 60)
          || $countryIso === 'DO'
          || str_contains($user->cell_phone, '+');
```

Tres problemas en una línea: **(a)** el mercado se re-deriva en cada sitio en vez de resolverse una vez;
**(b)** son tres fuentes distintas OR-eadas —lender, ISO y **el string del teléfono**—, y la tercera es
una adivinanza («si tiene un +, es dominicano»); **(c)** es binaria y en negativo: *«es RD, si no
Colombia»*. Un tercer país no entra sin reescribirla. Y `PaymentCalculationService.php:201` hace lo
mismo con `country_id != 60`.

⚠ **Y una MINA que hay que desactivar ANTES de tocar nada.** Hay **dos filas de Colombia** en `countries`:

| id | name | iso_2 | iso_3 | currency | locale | dial | apuntan |
|---|---|---|---|---|---|---|---|
| **1** | **Afghanistan** | (vacío) | **AFG** | **COP** | **es-CO** | (vacío) | **186 lenders · 364.527 users** |
| 47 | Colombia | (vacío) | COL | COP | es-CO | 57 | **307 allieds · 12.189 users** |
| 60 | Dominican Republic | DO | DOM | DOP | es-DO | 1 | 9 allieds · 1 lender |

Alguien le pegó los datos de Colombia a la fila de Afganistán. **Hoy no rompe nada** porque el camino
vivo resuelve por `allied` (que apunta a la 47, correcta) y porque `1 != 60` cae del lado colombiano por
casualidad. **Pero el día que alguien haga lo natural** —resolver el mercado desde el lender o desde el
usuario, que es justo lo que pide un documento por entidad o una validación de teléfono— **186 lenders y
364 mil usuarios se vuelven afganos**. Cualquier plan que empiece por «leamos `country_id`» rompe
producción en el primer deploy.

## ATERRIZAJE (2026-08-08) — gana «el paso DO», con UNA cosa agregada

Miguel tenía una propuesta más avanzada («Que República Dominicana quede bien parada») que **no se había
compartido a propósito**, para no sesgar la búsqueda de alternativas. Comparadas, **la suya es la que se
entrega**, y por los motivos correctos:

- tiene **daño medido en producción**, no riesgo latente: 13 de 13 puntos de venta dominicanos figuran en
  Santo Domingo… de Antioquia; los mensajes a clientes dominicanos salen con `+57`; y **0 de 375.429**
  clientes tienen nacionalidad, así que los contratos dominicanos imprimen «COLOMBIANA»;
- el alcance es **cerrable**: cuatro pasos, tres de datos y una validación;
- no toca el flujo del usuario ni servicios de terceros, así que el riesgo es bajo y el ciclo corto.

### Lo que se DESCARTA de la propuesta anterior (este documento, arriba)

Matar lo propio es parte del aterrizaje. De las seis ideas de la sección anterior:

| idea | veredicto |
|---|---|
| los cinco ejes (jurisdicción/moneda/locale/geografía/identidad) | **cierta pero no es un entregable.** Es una taxonomía; no mueve la aguja hoy |
| plata como objeto con moneda | real, pero su forzante (el recaudo BHD) **no está mergeado**. Cuando entre, entra con él |
| parámetros regulatorios con vigencia | ya está, mejor planteado, en la «segunda ola» del doc de Miguel |
| **submercados** | **prematuro.** Con dos países no hay de quién heredar. Vuelve cuando haya un tercero |
| CI con dos mercados | **la validación del paso 4 es estrictamente mejor para ESTA clase de bug.** El 13/13 no fue una regresión de código: fue un dato mal elegido en un formulario. Un invariante al guardar lo ataja en el origen; una suite de tests, no |
| **el mercado se resuelve UNA vez** | **se queda.** Es lo único que sobrevive, y abajo por qué |

### La ÚNICA cosa que agrego: que «resolver el país» exista una vez

Los pasos 1–3 son datos, y los datos arreglan **hoy**. Lo que no arreglan es **el literal número doce**.

Hoy quien necesita el país escribe `?? '+57'` porque es lo más barato que puede hacer: **no hay función a
la cual llamar**. Y ya hay dos capas del mismo default, una encima de la otra:

```php
TwilioController.php:184              $phoneCode = $userRequest->allied?->country?->phone_code ?? '+57';
TwilioNotificationRepository.php:40   $phoneCode = $params['phone_code'] ?? '+57';
```

La propuesta es **una función que resuelve el país de una solicitud, con los defaults adentro**. Nada más.

Por qué ésta y no otra:

- **Cabe dentro del alcance actual**: el paso 3 necesita igual un lugar desde donde leer `phone_code`.
- **No cambia comportamiento**: el default sigue siendo Colombia, así que el primer deploy no mueve nada
  y se puede verificar comparando respuestas.
- **Convierte cada `?? '+57'` futuro en una llamada.** El próximo no necesita saber de países: llama.
- **Le da casa al invariante del paso 4** y colapsa los dos defaults en uno.
- **Es lo único que hace más barato el tercer país**, y cuesta casi nada ahora.

Y su regla de diseño ya está escrita **en el anexo de Miguel**, con sus palabras: *«El país del punto de
venta no necesita columna propia: se deriva de su comercio.»* Eso ES el patrón «Mercado» — resolver desde
el comercio, una vez, sin guardar copias que con el tiempo mienten. La función sólo lo vuelve ejecutable.
La geografía ya está construida así y lo confirma: `country_cities.country_zone_id` →
`country_zones.country_id`, sin `country_id` redundante en la ciudad.

### Correcciones y agregados al doc de Miguel (verificados 2026-08-08 contra prod y `main`)

**✅ Confirmado, y yo lo había leído mal**: `phone_code` está **NULL en los tres países** y es la que lee
el código (**24 referencias**, contra 5 de `dial_code`). Yo había mirado `dial_code` —que sí está poblada
(57 · 1)— y concluí que el prefijo funcionaba. **El dato existe en la columna equivocada**, así que el
paso 3 es más chico de lo que parece: copiar `dial_code` a `phone_code` con el `+` adelante (los lectores
concatenan sin normalizar).

**➕ Falta un paso cero, y es el vecino del que ya se habla.** El anexo dice: *«Ocho consultas filtran por
un identificador de país fijo… Hay que corregirlas antes de poblar el país de las entidades.»* Correcto,
y hay una versión peor del mismo problema que no está en el doc:

> **186 lenders y 364.527 usuarios apuntan a `countries.id = 1`, que se llama «Afghanistan»**
> (`iso_code_3 = AFG`) con la moneda y el locale de Colombia pegados encima. La fila correcta de Colombia
> es la **47**, y a ella apuntan los 307 comercios. Hoy es inocuo porque el camino vivo resuelve por
> `allied`. **Pero el paso 3 es justo el que hace que el país importe**: en cuanto algo resuelva el país
> desde el lender o desde el usuario, esas filas son afganas.
>
> Y un segundo filo del mismo asunto: **`iso_code_2` está vacío en las DOS filas de Colombia**, mientras
> el código compara `$countryIso === 'DO'`. Cualquier chequeo por ISO **ya falla en silencio** para
> Colombia — sólo que hoy falla del lado correcto.

**➕ Una decisión que conviene endurecer.** El doc dice, sobre unificar las dos pantallas: *«Converger es
la única forma de que el tercer país no cueste otra copia, pero es un proyecto en sí mismo.»* Las dos
mitades son ciertas. Propongo convertirlo en **regla escrita**: *no se abre un tercer país antes de que
las pantallas converjan.* Si no se decide explícitamente, se decide por omisión — y el tercer país llega
con su tercera copia.

## EL PASO A PASO

Ordenado por **dependencia**, no por importancia. Son dos vías que arrancan en paralelo y convergen en el
invariante. Cada paso dice **cómo se verifica**, porque un paso de datos sin verificación es una creencia.

### Vía A — apagar el daño que ya está pasando

**A1 · El prefijo, donde el código de verdad lo lee.** `phone_code` está **NULL en los tres países** y es
la que leen los 24 puntos; `dial_code` sí está poblada (57 · 1) y casi nadie la mira. Son **dos UPDATE**:
copiar `dial_code` a `phone_code` **con el `+` adelante** (los lectores concatenan sin normalizar).
- *No depende de nada* — los comercios ya apuntan a las filas correctas (47 y 60).
- *Verificación*: mandar una notificación a un cliente de un comercio dominicano y ver el destino. Y que
  un colombiano siga saliendo igual.
- ⚠ Poblar sólo 47 y 60, **no la fila 1**: dejarla NULL mantiene el `?? '+57'` como red mientras exista.

**A2 · La geografía de República Dominicana.** Las 32 provincias ya están en `country_zones`; faltan las
ciudades. El área metropolitana de Santo Domingo alcanza para los 13 puntos de venta.
- *Verificación*: que el selector de ciudad muestre ciudades dominicanas al editar un comercio de RD.

**A3 · Corregir los 13 puntos de venta.** Depende de A2. Las direcciones registradas identifican la
provincia sin ambigüedad, así que es mecánico.
- *Verificación*: la consulta que destapó el bug tiene que dar cero.
  ```sql
  SELECT COUNT(*) FROM allied_branches b
    JOIN allieds a ON a.id = b.allied_id
    JOIN country_cities c ON c.id = b.country_city_id
    JOIN country_zones z ON z.id = c.country_zone_id
   WHERE z.country_id <> a.country_id;   -- hoy: 13
  ```

**A4 · La nacionalidad en los documentos.** 0 de 375.429 clientes la tienen, y los contratos imprimen
«COLOMBIANA» por omisión. **No se arregla poblando 375 mil filas**: se arregla haciendo que el documento
tome la nacionalidad del **país del comercio** cuando no hay dato del cliente — que es una inferencia
mucho mejor que «Colombia siempre», y no requiere backfill.
- *Verificación*: generar el contrato de un caso dominicano y leer el campo.

### Vía B — que no vuelva a pasar

**B1 · Una sola Colombia. Bloquea B3.** Migrar de la fila **1 («Afghanistan»)** a la **47 (Colombia)**:
186 entidades y 364.527 clientes. Y poblar `iso_code_2` en la 47 (`CO`), que hoy está vacío mientras el
código compara `$countryIso === 'DO'`.
- **Por qué bloquea**: el invariante de B3 es *«el país de X es el país de Y»*, y con dos Colombias eso da
  **falso** para todo comercio en 47 con entidad en 1. **Literalmente no se puede escribir la regla
  mientras existan dos filas de Colombia.** Ése es el argumento del orden, no el riesgo.
- *Verificación*: `SELECT COUNT(*) FROM lenders WHERE country_id = 1` → 0. Y el listado de opciones de
  crédito de un comercio colombiano sigue devolviendo lo mismo (⚠ acá viven las **8 consultas con id de
  país fijo** del anexo: hay que corregirlas **en el mismo PR**, o el listado queda vacío).
- ⚠ Es el único paso destructivo. Va con respaldo de las dos columnas antes de tocar.

**B2 · Que «resolver el país» exista una vez.** Una función, con los defaults adentro. Es lo único de
código de todo el plan, y no cambia comportamiento: el default sigue siendo Colombia.
- Reemplaza las 4 copias de `currency_format`, las 4 de `$isDoLogic` y los 2 `?? '+57'` encadenados.
- *Verificación*: comparar la respuesta de los endpoints tocados antes y después, para un comercio de cada
  país. Tienen que ser idénticas.

**B3 · El invariante, en los dos lados.** Depende de A3 y B1.
- la **ciudad** de un punto de venta pertenece al país de su comercio;
- la **entidad** que se asocia a un comercio opera en el país de ese comercio.
- Hoy los dos se cumplen (medido: **cero** asociaciones cruzadas en `lenders_by_allieds` y en
  `lenders_by_allied_branches`) — o sea que activar la regla **no rompe nada existente**. Es la mejor
  ventana posible para ponerla.
- ⚠ **La validación es la red, no el arreglo.** El arreglo del 13/13 es **filtrar el selector de ciudad
  por el país del comercio**: si el comercio es dominicano, «Santo Domingo, Antioquia» no aparece en la
  lista y el error se vuelve imposible de cometer. Una validación que rechaza al guardar avisa tarde y
  frustra; un selector filtrado no deja equivocarse.

## LA FORMA LIMPIA: el país en comercios y entidades

Lo que hay que dejar armado para que esto no se vuelva a desarmar. La clave es que **el país no significa
lo mismo en cada lugar**, y hoy están tratados como si sí:

| dónde | qué significa de verdad | quién lo consume | estado hoy |
|---|---|---|---|
| **comercio** `allieds.country_id` | **dónde opera** → define el mercado del cliente: moneda, locale, prefijo, geografía | los 4 `currency_format`, el documento firmado | ✅ correcto (307→47 · 9→60) |
| **entidad** `lenders.country_id` | **dónde está habilitada a prestar** → jurisdicción: tope de tasa, instrumento del título, burós, impuesto | **hoy nada lo lee para decidir** | ⚠ 186 → fila «Afghanistan» |
| **cliente** `users.country_id` | **nacionalidad / residencia** → tipo de documento. **NO es el mercado** | los documentos | ⚠ 364.527 → «Afghanistan» |

### Tres reglas, y con eso alcanza

**1 · Se GUARDA donde es un hecho propio; se DERIVA donde es una consecuencia.**

| | |
|---|---|
| **comercio** | se guarda. **Obligatorio** — es un hecho del comercio |
| **entidad** | se guarda. **Obligatorio** — es un hecho de su licencia |
| **sucursal** | **se deriva** del comercio. Nunca columna *(ya es así, y la geografía también: `country_cities.country_zone_id` → `country_zones.country_id`)* |
| **solicitud** | **se deriva** del comercio de su sucursal. Nunca columna |
| **cliente** | se guarda, pero **degradado a nacionalidad**: no se usa para decidir mercado |

Ese último punto es el que más simplifica: **si `users.country_id` deja de ser fuente de mercado, las
364.527 filas que apuntan a «Afghanistan» dejan de ser una mina** y pasan a ser sólo un dato de
nacionalidad equivocado — que igual hoy no existe (0 de 375.429). Y baja el riesgo de B1: lo que hay que
migrar con cuidado son las 186 entidades, no las 364 mil personas.

**2 · Un solo invariante los ata: manda el país del comercio.** La ciudad de su sucursal pertenece a ese
país, y las entidades que se le asocian operan en ese país. Nada más. No hace falta un motor de reglas.

**3 · Una sola función lo resuelve, y el default vive ahí.** `mercadoDe(solicitud)` → sucursal → comercio
→ país. Nadie más vuelve a preguntar de qué país es algo. La regla que lo hace cierto es de revisión de
código, no de arquitectura: **si en un PR aparece un literal de país, es un bug**.

### Lo que a propósito NO se construye ahora

**Una entidad opera en UN país: una columna, no una tabla puente.** Hoy son 187 entidades y ninguna opera
en dos países. Armar la relación muchos-a-muchos «por si acaso» es sobre-diseño: se paga hoy y se usa
nunca. **El día que una entidad realmente opere en dos países, ése es el momento** — y va a ser un cambio
chico, porque la resolución ya pasa por un solo lugar (regla 3). Es la misma disciplina que descartó los
submercados: no se construye la generalización antes del segundo caso.

## ⚠ Discrepancia a resolver (no pude reproducir un número del doc)

El doc menciona en la limpieza *«12 asociaciones de la entidad dominicana con comercios colombianos que
nunca se usaron»*. **Mis consultas dan cero cruces**, en las dos tablas y con las dos filas de Colombia
normalizadas:

| tabla | mismo país | cruzadas |
|---|---:|---:|
| `lenders_by_allieds` | 1.089 CO↔CO · 8 RD↔RD | **0** |
| `lenders_by_allied_branches` | 7.522 CO↔CO · 13 RD↔RD | **0** |

Y el lender 160 (SmartPay, RD) tiene sus 8 asociaciones, todas con comercios dominicanos. ¿De qué tabla
salieron los 12? Puede ser otra tabla, otro estado, o una entidad dominicana que **no está marcada como
RD** — y esa tercera posibilidad importaría, porque sería un caso más de B1.

---

# ANEXO · el análisis previo (para trazabilidad)

## LA RECOMENDACIÓN — UNA sola: el «Mercado» de Shopify, con el contenido en forma de Country Spec

Miré cómo lo resolvieron cuatro empresas y **descarto tres**, con el motivo:

| | qué hacen | por qué NO es lo nuestro |
|---|---|---|
| **Airbnb** · [i18n Platform](https://medium.com/airbnb-engineering/building-airbnbs-internationalization-platform-45cf0104b63c) | plataforma central de contenido y traducción: 1M de textos, 62 idiomas, 100 mil millones de requests/día | resuelve **traducción a escala**. CreditOp opera español→español: no es nuestro problema |
| **Uber** · [UCDP](https://www.uber.com/en-US/blog/how-we-unified-configuration-distribution-across-systems-at-uber) | plataforma de distribución de configuración en capas (global → zonal → local), con UI para que **no-ingenieros** cambien la config por ciudad | es **infraestructura** de distribución. Con el tamaño del equipo, montar eso cuesta más de lo que ahorra. Me quedo con **una** idea suya: la jerarquía con herencia |
| **Stripe** · [Country Specs](https://docs.stripe.com/api/country_specs/object) | cada país es un **objeto de datos** con `default_currency`, `supported_payment_methods` y —la clave— **`verification_fields`: qué datos hay que recolectar, como DATO** | la forma del contenido es exactamente la que necesitamos, pero está **indexada por país**, y nuestra unidad no es el país |
| **Shopify** · [Markets](https://shopify.dev/docs/storefronts/headless/hydrogen/markets) | la unidad es el **Mercado** (agrupación comercial, no geográfica), con **submercados** que heredan y sobreescriben unas pocas cosas. Abrir una tienda aparte sólo se justifica con un catálogo y una marca genuinamente distintos | **✅ ES LO NUESTRO** |

### Por qué el «Mercado» de Shopify y no los otros

**1. Nuestra unidad de negocio no es el país: es el comercio.** CreditOp no le vende a Colombia, le vende
a comercios. Y el código **ya resuelve el mercado desde el comercio** (`allied->country` en los 4
controladores). El Mercado de Shopify es exactamente eso: una agrupación **comercial** que *contiene*
países, no un hecho geográfico. Indexar por país —como Stripe— nos obligaría a torcer el modelo que ya
tenemos y que ya es correcto.

**2. El submercado es la forma real de RD.** República Dominicana **no es un clon de Colombia**: es el
mismo flujo con un puñado de excepciones (moneda, largo del teléfono, sin Deceval, otro buró). Eso es
literalmente un submercado: *heredá todo, sobreescribí estas cinco cosas*. Cualquier modelo que trate a
RD como un país completo y paralelo nos hace mantener dos de todo.

**3. La regla que más nos protege es la que dice cuándo NO usarlo.** Shopify es explícito: abrir una
tienda separada sólo se justifica con un catálogo y una identidad genuinamente distintos; para todo lo
demás, un mercado. Traducido: **nunca forkear el código por país.** Y esto importa porque ya estamos a un
paso — el `$isDoLogic` copiado cuatro veces es el primer escalón de ese fork.

**4. Escala por donde CreditOp crece.** El vector de crecimiento son comercios, no países. Una
abstracción con forma de comercio crece con el negocio; una con forma de país sólo sirve el día que se
abre un país.

### Lo que NO hay que construir: el patrón ya está en casa, funcionando

Éste es el argumento de que no implica reescribir. El `verification_fields` de Stripe —«qué datos pedir
es un dato, no código»— **ya existe en CreditOp y funciona**:

```php
// Modules/Loans/App/Services/FormTypeService.php:35
$formType = $this->formTypeRepository->findLatestActiveByLenderId((int) $lenderId);
```

Cero `if`. Un lookup por configuración, un formulario que se renderiza genérico. **Ese es el slot de
identidad del Country Spec, ya resuelto.** La propuesta no es traer una arquitectura nueva: es
**generalizar a los otros slots una forma que ya se ganó el lugar en uno.**

Y los demás slots también tienen su hueso puesto:

| slot del Mercado | qué ya existe | qué falta |
|---|---|---|
| **qué datos pedir** | `FormTypeService` por lender ✅ | que la resolución mire el mercado |
| **buró / centrales** | `risk_centrals` como catálogo con credenciales ✅ | que el mercado diga cuál |
| **título valor** | `promissory_types` + `PromissoryNoteSigningFactory` ✅ | que el mercado diga cuál |
| **moneda y locale** | `countries.currency/locale` + `currency_format` ✅ | **una** fuente, no 4 copias |
| **jerarquía de config** | `settings.country_id` ✅ | hoy 63 filas, **todas del país 1** — el eje existe y no se usa |
| **geografía** | `country_cities.code` genérico ✅ | sacar `dane_code` del núcleo |

Seis slots, seis huesos ya puestos. **Ninguno pide reescribir: piden que la resolución mire una cosa en
vez de estar copiada.**

### La jerarquía (lo único que me llevo de Uber)

```
global  →  mercado (Colombia | RD)  →  submercado  →  comercio  →  lender
```

Se resuelve de abajo hacia arriba y **el primero que define, gana**. Eso da dos cosas gratis: una
excepción de un comercio no obliga a crear un mercado, y **un mercado nuevo hereda todo** — se declara
sólo lo que difiere. Es la diferencia entre dar de alta un país en una tarde y en un trimestre.

### Por qué NO obliga a reescribir: el mercado por defecto es lo de hoy

La migración es un [strangler](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
clásico, y la clave es una sola línea de diseño: **si no hay mercado resuelto, se usa Colombia.**

- El primer deploy **no cambia nada**. Se agrega el punto de resolución y nadie lo consume todavía.
- Cada sitio se convierte **de a uno**, y cada conversión es un PR chico, independiente y verificable
  (misma respuesta antes y después para un comercio colombiano).
- El progreso se **mide**: cuántos de los ~250 sitios ya no leen el hardcode. Empieza en 0 y sube.
- Si se corta a la mitad, lo convertido **ya quedó mejor** y lo que falta sigue funcionando. No hay
  estado intermedio roto — que es justo lo que hundió otros refactors de la casa.

## PLAN POR FASES

**F0 · Desactivar la mina (bloquea todo lo demás).** Decidir qué pasa con la fila 1: repararla o migrar
los 186 lenders y 364K usuarios a la 47. Y llenar `iso_code_2` (hoy vacío en las dos filas de Colombia,
mientras el código compara `$countryIso === 'DO'`). Sin esto no se puede empezar.

**F1 · Una sola fuente de verdad.** `MarketContext` resuelto en un lugar; los 4 `currency_format`
copiados pasan a leerlo; los 4 `$isDoLogic` se borran. Sin cambio de comportamiento — es refactor puro y
se puede verificar comparando respuestas antes/después.

**F2 · El front deja de tener default colombiano.** Quitar `es-CO` como valor por omisión del formateador
compartido: que sea **obligatorio**. Eso convierte ~40 hardcodes silenciosos en errores de compilación,
que es exactamente lo que se quiere.

**F3 · El primer slot del Mercado**, por el que más duele en SmartPay, no por completitud. Candidato:
moneda+locale, porque es el de más sitios y el de verificación más barata (la cifra en pantalla).

**F4 · El CI con dos mercados** (podría adelantarse; es lo que protege F1-F3 de la erosión).

## DECISIONES PENDIENTES (no son técnicas — son de negocio)

- **¿Cuál es la unidad de mercado?** Hoy de hecho es el **comercio**. ¿Es correcto, o un comercio puede
  operar en dos países? La respuesta cambia el modelo entero.
- **¿A qué se apunta?** ¿Sostener CO+RD sin dolor, o poder abrir un tercer país sin release? El costo es
  muy distinto y F3/F4 sólo se justifican con lo segundo.
- **¿Quién define la jurisdicción de un crédito** cuando el comercio, el prestamista y el cliente no
  coinciden de país? Es una pregunta legal, no de arquitectura, y hay que hacérsela a alguien.
- **La fila Afganistán**: reparar o migrar. Migrar es más limpio y toca 364K filas.

## RIESGOS

- ⚠ **El deploy que «lee bien el país» es el que rompe producción**, si F0 no se hizo antes.
- **Un tercer país en el catálogo no es un país operativo**: hay 253 filas en `countries`, todas activas,
  y sólo 3 tienen locale en español. El catálogo es un volcado ISO con dos filas editadas a mano.
- **F1 no se ve.** Es refactor sin funcionalidad nueva: hay que venderlo como lo que es, la condición
  para que lo siguiente sea barato. Sin eso, se corta a la mitad y queda peor que antes.

## Tarea (publicable)

Hoy el país está quemado en el código en unos 250 archivos entre los tres repositorios, y la decisión de
"¿esto es Colombia o República Dominicana?" se re-calcula en cada sitio con criterios distintos — en un
caso, mirando si el teléfono del cliente tiene un signo "+". Eso hace que sumar o sostener un país sea
editar código en tres repos en vez de configurar datos.

La propuesta separa el país en los cinco ejes que realmente lo componen (jurisdicción, moneda, idioma,
geografía e identidad), resuelve el mercado **una sola vez** al entrar la solicitud y lo lleva a través
del flujo, y convierte cada país en un paquete de configuración en vez de una rama del código. Buena
parte del mecanismo ya existe en la base de datos y en el backend: el trabajo es terminarlo y hacerlo
obligatorio, no inventarlo.

Antes de escribir código hay que reparar el catálogo de países, donde hoy conviven dos registros de
Colombia y la mayoría de los datos apunta al que está mal.
