---
id: 68
title: "Lo que queda de país quemado, después de la tanda de internacionalización"
stage: evaluation
created: "2026-08-27T09:00:00-05:00"
context_nodes: [architecture, onboarding, kyc, entities, merchants]
jira: []
jira_title: ""
ramas: "pais/documentos-que-acepta-el-backend, pais/monto-y-telefono-en-solicitar, pais/borrar-documentos-de-sucursal, pais/la-tarjeta-de-identidad-es-generica, pais/el-pais-trae-bandera-y-gentilicio, pais/la-tarjeta-lee-el-pais-de-la-bd, pais/la-bandera-se-dibuja-desde-el-iso, pais/las-banderas-salen-de-la-bd, pais/la-autoridad-emisora-sale-del-pais-y-el-tipo, documento/la-tarjeta-muestra-la-fecha-de-nacimiento, pais/el-theme-cacheado-no-se-queda-pegado, pais/el-pais-deja-de-suponerse, pais/el-documento-es-unico-por-tipo"
---

## Si retomás esto sin contexto, empezá acá

El censo de **lo que sigue asumiendo Colombia** después de que el país pasó a ser configuración. La
infraestructura está hecha y probada —`countries` con su catálogo, los resolvedores, el payload del
comercio—; esto es el inventario de lo que todavía no la usa.

**Lo importante:** casi nada de esto se descubre leyendo. Está medido contra **producción**, y varios
hallazgos son de los que sólo aparecen mirando datos. No hace falta volver a investigarlo: los números
están abajo con su consulta.

⚠ **Y hay una cosa que NO es un PR**: 62 créditos dominicanos autorizados sin que ninguna central
verificara la identidad. Eso es una decisión de negocio con dueño, y tiene plazo real.

**ESTADO 2026-09-01 · dos frentes abiertos, y conviene no confundirlos.**

**(a) La tarjeta de documento está COMPLETA en `qa`** y esperando pruebas reales de QA y despliegue a
producción. Eso es lo de abajo, sin cambios desde el 31.

**(b) El país del USUARIO** —otra cosa que la tarjeta— pasó de no existir a escribirse. **#1272 ya
mergeó a `qa`** (el temporal deja de nacer `CC`, y buscar por teléfono deja de duplicar cuentas); y
**#1277 está abierto**, con las cuatro piezas en un solo commit: el usuario nace con el país de su
comercio, el OTP por correo lo usa en vez de suponer Colombia, el indicativo de último recurso sale de
configuración, y el `POST` de comercios exige país como ya lo exige el admin. *(Reemplaza a #1275 y
#1276, cerrados: era el mismo trabajo repartido y se juntó para que se lea de corrido.)* ⚠ **Los dos traen migraciones y las migraciones no corren solas**
(F-77): el backfill de teléfonos de #1272 está escrito y **sin correr** contra la compartida, a la
espera de que `qa` baje a `develop` para que los tres ambientes tengan el arreglo de búsqueda.

⚠ **Y no confundas «escribir el país» con «quitar el `DEFAULT 1`»**: son dos tareas y sólo se hizo la
primera. La segunda sigue bloqueada por el `POST` de comercios del módulo Partner, que crea sin mandar
país. Ver la entrada del 1/9 en §«Registro».

**Lo de la tarjeta, en detalle:** El documento genérico está completo en `qa`. La
tarjeta muestra bandera, gentilicio, nombre del documento y autoridad emisora, todo derivado del país del
comercio y del tipo que eligió el solicitante, más la fecha de nacimiento cuando el comercio la pide. **La
migración de banderas ya corrió contra la base compartida**, así que dev, qa y staging tienen el dato (los
tres comparten base). Probado de punta a punta en qa con un comercio peruano. Los estados de PR salen de
`make tareas-ramas N=68`, que los mide; no los escribas a mano. El detalle, en las dos entradas del 31 en
§«Registro».

**El próximo paso es:** que alguien revise **#1277**; en paralelo, correr las pruebas reales de QA sobre lo mergeado en `qa` — la matriz por país
está en §«Tarea (publicable)» → «Cómo validar» — y desplegar a producción, que **todavía no tiene nada de
esto** (punto 2 de §«Cómo se ataca»). ⚠ **Producción tampoco tiene las banderas**: la migración se corrió
sólo contra la compartida, y allá hay que correrla aparte.

⚠ **Dos riesgos abiertos que NO son PRs y conviene leer antes de probar**, los dos al final del §«Registro»:
vaciarle los tipos de documento a una entidad hace aparecer **más** documentos (el fallback devuelve todos
los del país, PEP incluido), y el bypass de OTP de QA **no aplica en el ambiente qa** — los códigos se leen
en el canal `#qa-messages` de Slack.

Los tres PRs de la segunda tanda **se mergearon el 2026-08-27**: `legacy-backend#1220` y
`frontend-monorepo#889` a `qa`, `legacy-application#83` a `develop`. Quedan abiertos
`frontend-monorepo#894` (el ejemplo del celular por país) y `legacy-backend#1225` (⛔ bloqueada).

⛔ **REGLA VIGENTE, de Miguel, 2026-08-27: la internacionalización NO toca los mecanismos de formularios
dinámicos** —ni el JSON de S3 ni las tablas de José— **mientras no se defina cómo se estandarizan.** Todo
lo demás del censo sigue en pie. Antes de tocar algo que se llame «formulario dinámico», leé §«Tres cosas
se llaman formulario dinámico»: el censo original las confundía y de ahí salió una prioridad equivocada.

## Objetivo

Que un comercio de un país nuevo se pueda dar de alta y originar de punta a punta **sin tocar código**.
Hoy la configuración existe pero el flujo no la consume: el país llega hasta las pantallas y casi nadie
lo lee.

## Dónde se toca

| | |
|---|---|
| ~~`frontend-monorepo`~~ | ~~`…/dynamic-form/src/lib/utils/dynamic-step-one.ts`~~ — **congelado**: es mecanismo, no internacionalización |
| `legacy-backend` | `Modules/Onboarding/App/Services/RegisterCellPhoneService.php:18` — el `'CC'` del alta |
| `legacy-backend` · `legacy-application` | `app/Http/Controllers/Customer/TwilioController.php` — **duplicado**, recorta a 10 dígitos y pega `whatsapp:+57` |
| `legacy-backend` | `PayloadFormatters::currency()` — castea a `(int)` y quema separadores colombianos |
| ambos | cuatro resolvedores distintos de «sucursal → país» (ver §«Lo que borra proceso») |
| `frontend-monorepo` | `…/loan-application-form/src/components/IdBack.tsx` (173 líneas) y `PepCard.tsx` (84 + `apps/loan-request-wizard/public/assets/pep-background.png`) — la ilustración del documento en el paso de fecha de expedición. Los elige `init-loan-request.tsx:274` con `formData.documentType === "PEP"` |
| BD | `banks` (sin `country_id`) · `country_cities` (sólo Colombia) · `countries` (sin zona horaria) |

## Cómo se ataca

**1 · El catálogo del formulario dinámico.** ⏸ **CONGELADO por decisión de Miguel el 2026-08-27.** Se
llegó a hacer y **se revirtió del PR**: no era internacionalización (esa pantalla es sólo de RD y sus
cuatro tipos son los correctos) y toca el **mecanismo** del formulario dinámico, que está en discusión.
**No se toca hasta que se defina cómo se estandarizan el JSON de S3 y las tablas** — ver §«¿Se pasa el
JSON de S3 a las tablas de José?».

**2 · Desplegar a producción lo que ya está mergeado.** Nada de esto sirve mientras prod no tenga las
columnas. Ver la medición de abajo: allá sólo existe `lenders_by_allied_branches.document_types`.

**3 · Las ciudades de Perú y de República Dominicana.** Es sourcing de datos; el molde de la migración de
RD ya está probado.

**4 · Un solo resolvedor de «sucursal → país»**, y elegir entre `phone_code` y `dial_code`.

**5 · `banks.country_id`.** Es de los pocos casos donde hace falta una columna nueva: no se deriva de nada.

## Tres cosas se llaman «formulario dinámico»

Medido el 2026-08-27, después de que el censo confundiera dos de ellas. **Antes de tocar cualquiera,
identificá cuál es.**

| | quién lo usa hoy | de dónde sale el formulario | quién lo sirve |
|---|---|---|---|
| **El wizard clásico** `/solicitar` | los comercios colombianos, y **BCP Perú** | código del front | legacy-backend |
| **El flujo dinámico** `/request-amount` → `/request-phone` → … | **los 12 comercios de SmartPay**, todos de RD | un **JSON en S3**, uno por comercio | `onboarding-forms-service` (Go) |
| **El paso `additional-info` / `dynamic-form/:form_type_id`**, dentro del clásico | ver la tabla de `form_types` abajo | **tablas de legacy** | `form-service` (Go) |

Los dos servicios Go son de José y **no son el mismo**: `VITE_ONBOARDING_FORM_SERVICE` contra
`VITE_FORM_SERVICE_BASE_URL`. Sus repos están clonados en `~/Desktop/CREDITOP/github/`.

**Los 9 `form_types` de prod, que es quién usa de verdad `form-service`** (campos = filas en `forms`):

| id | nombre | campos |
|---|---|---|
| 1 · 3 | Formulario generico | 8 · 7 |
| 2 | BBVA | 80 |
| 4 | Formulario perfilamiento | 3 |
| 5 | Formulario complementario | 0 |
| 6 | credifamilia | 46 |
| **7** | **motai-renting** | 15 |
| **8 · 9** | **bcp-vehiculo-paso-1 · paso-2** | 8 · 4 |

⚠ **BCP está en las DOS familias.** Su formulario de vehículo son los tipos 8 y 9, en **tablas** — no en
el JSON de S3. Y `form-service` ya lee `country_zones` y `country_cities`, o sea que tiene noción de país.

**Y el repo `github/dynamic-form` NO es ninguno de los tres.** Es un prototipo en React Router de Miguel
(219 commits, último el 2026-03-04): **sin workflow de despliegue**, sin `service_name` en Loki, y **cero
referencias** desde los cinco repos reales. Lo único que sobrevivió es su paquete `form-engine`, que
graduó al monorepo como `@creditop/form-engine` — pero su ruta
(`apps/loan-request-wizard/app/routes/dynamic/dynamic.tsx`) **no está registrada en `routes.ts`**: sólo la
consume una historia de storybook. **Motai no pasa por ahí.**

**Cómo se entra al flujo dinámico:** `phone-number.tsx:68`, `if (alliedCountry === 60) redirect(...)`.
El 60 es República Dominicana, quemado. Es el hardcode de país más grande que queda en el front y no
consulta nada de `countries`.

**Y el catálogo de tipos de documento de ese flujo vive en el JSON de S3**, por comercio. O sea que es un
**segundo catálogo**, paralelo a `countries.document_types`, que nadie cruza con el nuestro. Unificarlos
es una conversación con José, no un PR: hoy no le hace falta a nadie, porque el único país ahí es RD.

⚠ **No confundir `show_alternate_flow` con esto.** Esa bandera manda el final del wizard **clásico** al
simulador de Cuotéalo, no al formulario dinámico.

### Qué hace de verdad `onboarding-forms-service` (medido 2026-08-27)

**No es «traer un JSON»: es un orquestador delgado** —68 archivos Go, 5.792 líneas— que hace tres cosas
propias y **delega todo lo que cambia estado**.

**Lo suyo:**

| endpoint | qué hace | contra qué |
|---|---|---|
| `GET /v1/dynamic/:form_id/schema` | trae la definición del formulario | **S3**, `{prefix}/{form_id}.json` |
| `POST find-user-by-email` · `find-user-by-document-number` | ¿está libre? | **MySQL directo**, su propio `user_repository` |
| `POST /:form_id/upload` | guarda el soporte | **S3** |
| — | normalizar el teléfono a E164, validar el correo | código propio (`phone_utils`, `email_utils`) |

**Lo que delega** (`internal/infra/client/http/services/`):

| endpoint del servicio | en qué se convierte, en orden |
|---|---|
| `send-otp` | `otp-service` `api/otp/generate` → `legacy` `backdoor/create-temporary-user` |
| `validate-otp` | `otp-service` `api/otp/validate` → `legacy` `backdoor/check-user-exists` → `backdoor/accept-terms` → `backdoor/resolve-lenders-redirect` |
| `submit` | `legacy` `api/onboarding/dynamic-forms/create-user` |

⚠ **El OTP NO lo manda este servicio.** Lo manda **`otp-service`** (`config.yaml` → `otp_service.base_url`,
`:8083`), un microservicio aparte. Confirmado en los logs de dev: `channels=["sms","whatsapp"]`,
«Message sent successfully via messaging service».

⚠ **Una llamada del front a `validate-otp` son CUATRO llamadas encadenadas hacia afuera.** Si una falla a
mitad, queda el OTP validado y los términos sin aceptar. Eso es lo que hay que mirar antes de tocar nada
de ese flujo, no el JSON.

⚠ **Y se llaman entre sí:** legacy-backend le pide el esquema a `onboarding-forms-service`
(`DynamicFormsRepository` → `/v1/dynamic/full/{formId}/schema`) y `onboarding-forms-service` le pide a
legacy-backend que cree el usuario. El ciclo está ahí y nadie lo dibujó.

**`full` vs `simple` no cambian comportamiento**: comparten `handler_base` y el mismo caso de uso, y
difieren en el sobre de la respuesta (`…FullResponseWriter` / `…SimpleResponseWriter`). El front usa
`simple`; legacy-backend usa `full`.

**El ecosistema es más grande de lo que dice `CLAUDE.md`.** Emitiendo logs en dev hoy: `legacy-backend`,
`CreditopDev`, `customer-profiling-service`, `financial-health-service`, `form-service`,
`kyc-gateway-service`, `onboarding-forms-service`, `otp-service`, y al menos uno más que la sonda cortó
en pantalla.

### ¿Vale la pena el microservicio? (medido 2026-08-27)

**Está subutilizado, y la idea buena que tiene adentro no es la que está ejecutando.**

**De qué es dueño:** dos consultas de LECTURA (`FindUserByEmail`, `FindUserByDocumentNumber`) y S3. **Cero
escrituras a MySQL.** Todo lo que cambia estado lo delega.

**Qué negocio sostiene**, en prod a 90 días:

| | comercios | solicitudes/día |
|---|---|---|
| País 60 (RD) — **todo lo que pasa por él** | 12 | **2,8** |
| Colombia — por el monolito | 293 | 812,3 |

O sea **0,34% del tráfico**. Está vivo en producción (1.107 líneas de log en 24h; `otp-service` 3.818,
`form-service` 422).

**Qué cuesta:**

- el monolito creció **12 archivos «backdoor»** para sostenerlo (`Jose Escobar`, desde 2025-11-19). El
  acoplamiento **subió**, no bajó.
- **se llaman entre sí**: legacy le pide el esquema, él le pide a legacy que cree el usuario.
- `validate-otp` = **cuatro llamadas encadenadas** sin transacción. Si falla la tercera, queda el OTP
  validado y los términos sin aceptar. Es un modo de falla que antes no existía.
- **5 de 7 handlers están duplicados** en `full`/`simple`, que sólo cambian el sobre de la respuesta:
  1.797 de las 2.199 líneas de handlers son las dos versiones de lo mismo.

**La pregunta puntual de Miguel — ¿podría legacy traer el JSON y funcionar igual?** Para el JSON, **sí, y
el rodeo ya existe**: legacy-backend hoy le pide el esquema al microservicio, que lo lee de S3, y
legacy-backend **ya tiene S3 configurado** (disco `s3`, usado en 6+ servicios). Hoy es
`legacy → microservicio → S3` pudiendo ser `legacy → S3`.

**Pero antes de borrar nada hay que decidir para qué es.** Tres caminos:

1. **Es el motor de formularios** → encogerlo a eso: esquema, subidas y validación de forma. Que el front
   hable directo con legacy para OTP, submit y disponibilidad. Se va la cadena de cuatro y se va el ciclo.
   **Es lo que yo haría.**
2. **Es la cabeza de playa para sacar el onboarding del monolito** → entonces tiene que empezar a ser
   dueño de estado. Hoy escribe por «backdoors»: eso no es un strangler, es una fachada — y el strangler
   que no avanza se queda para siempre.
3. **Ninguna** → legacy leyendo S3 directo funciona igual: ~5.800 líneas y un despliegue menos.

⚠ **No es una decisión nuestra: es el servicio de José.** Lo que sí está medido es que **no hay decisión
escrita**: Credibrain —donde vive el conocimiento de producto— **no lo nombra ni una vez** (sí nombra el
microservicio de OTP, con sus endpoints y que usa Twilio por dentro).

**La pregunta para José**, que decide entre el camino 1 y el 2: *¿este servicio va a ser dueño de datos
alguna vez, o va a seguir escribiendo por los backdoors del monolito?*

### ¿Se pasa el JSON de S3 a las tablas de José? (medido 2026-08-27)

**No como está planteado: no son la misma clase de cosa.** El JSON describe **un wizard**; las tablas
describen **un formulario**.

| lo que expresa | JSON de S3 | tablas de `form-service` |
|---|---|---|
| **pasos con navegación** (`next: {label, step, post, clear}`) | ✅ | ❌ lista plana ordenada por `sort` |
| **layout en grilla** (`grid: string[][]`) | ✅ | ❌ |
| **contenido presentacional** (`components` → `boxs` imagen/texto con links) | ✅ | ❌ (sólo imagen por sección) |
| **a qué endpoint postea cada paso** | ✅ | ❌ |
| **tipo `otp`** con su endpoint de envío | ✅ | ❌ |
| **`showIf` con operadores** `== != > <` | ✅ | ⚠ sólo igualdad (`parentId`/`parentValue`) |
| **`theme`**, `accept`/`maxSize` de archivos | ✅ | ❌ |
| **variación por comercio y entidad** | ❌ un archivo por hash: hay que duplicarlo | ✅ `alliedId` · `lenderId` · `flowTypeId` |
| **validación estructurada** | ⚠ `allowed` como string | ✅ `regex`, `min`/`max`, `minLength`/`maxLength`, `dataType` |
| **`dataSource`** (catálogos que sirve el backend) | ❌ | ✅ |
| **persistencia** | ❌ delega el submit | ✅ EAV en `user_field_values` |
| **país** | ❌ | ✅ lee `dial_code`, `phone_code`, `cell_phone_lenght`, `locale`, `currency`, `address_format`, `iso_code_*` |

**La recomendación, en tres partes:**

1. **La mitad de CAMPOS sí debería converger a las tablas.** Ahí las tablas son estrictamente mejores, y
   son lo que esta campaña necesita: `form-service` **ya es la pieza más internacionalizada del sistema**.
2. **La mitad de WIZARD no cabe hoy**, y meterla sería reinventar el JSON dentro de SQL — peor que el JSON.
   Si algún día converge, es agregando `steps` y layout al modelo de tablas, no traduciendo a mano.
3. **No ahora.** El negocio que lo sostiene son **2,8 solicitudes/día**, y migrar rompe el único flujo que
   RD tiene funcionando.

⚠ **Y ojo con el argumento de «las tablas son configuración».** Hoy **ninguno de los dos** se edita desde
el admin: no hay rutas de `form_type` ni en `legacy-application/routes/web.php` ni en
`Modules/Backoffice`. Uno se cambia editando un JSON en S3 y el otro escribiendo un seeder. Los dos piden
un desarrollador. La diferencia real no es configurabilidad, es **expresividad y reúso**.

**Relación con los tres PRs abiertos: ninguna.** Son cambios del flujo clásico más una limpieza del
dinámico; nada depende de dónde viva el esquema. **Esta decisión no bloquea el merge.**

## Lo que se evaluó y NO se eligió

**Meter el país en el esquema del formulario dinámico** (lo sirve `onboarding-forms-service` desde JSON en
S3, y se pide por comercio, así que técnicamente cabe). Se descartó: crearía una **segunda fuente** del
país de un comercio, que es exactamente el patrón que produjo todos los bugs de esta tanda. El costo de no
hacerlo es un `fetch` más en el loader; el de hacerlo, que el día que cambie el país dos caminos tengan
que enterarse. Si el fetch molesta, se cachea — no se duplica.

**Derivar los decimales de `Intl`.** La ISO 4217 le da 2 decimales al COP, y el `maximumFractionDigits: 0`
escrito a mano era una decisión de negocio. Derivarlo del estándar mete centavos en toda la operación.
(Decisión de Laura, 2026-08-26, y es la correcta.)

**Validar el celular sólo por largo.** Es lo que yo había hecho y es peor: con eso `1234567890` pasa a ser
un celular válido. La versión que quedó valida **por ISO** y conserva el patrón colombiano como *regla de
Colombia*.

## Lo que está decidido

> **DECISIÓN · 2026-08-26** — el proveedor se elige **por ENTIDAD, nunca por país**, y eso está bien:
> `risk_centrals` (12 filas) no tiene columna de país, `identity_validation_types` (6) se asigna por
> `lender_id` con un `order` que define primario y respaldos, y la firma y el pagaré salen de
> `lenders.signing_provider_id` / `promissory_type_id`. La única excepción es `messaging-service`, que
> llavea por `country_iso2` y **falla cerrado** si falta la fila — ése es el molde a copiar, no al revés.

## Lo que está bloqueado

> **BLOQUEANTE · 2026-08-27 · Perú** — **el número de documento es único en TODA la tabla, sin mirar el
> tipo ni el país.** El índice se llama `idx_users_document_number_unique` y es sobre una sola columna
> (medido en prod). El DNI peruano tiene 8 dígitos y la cédula colombiana también los tiene en ese rango:
> en producción hay **117.919 documentos de 8 dígitos ya ocupados**, y **84.656 caen en las series que
> RENIEC de verdad emite** (0-3 heredadas de la libreta electoral, más 4, 6 y 7). Cada uno de esos es un
> DNI que **no se va a poder registrar**: el alta responde «documento ya en uso» y no hay salida.
>
> Peor: `RegisterCellPhoneService` busca el duplicado con `findByDocumentAndType($doc, 'CC')` — el tipo
> **quemado**. Así que a un peruano lo choca contra colombianos, y un DNI repetido de verdad no lo
> detecta: se cae en el `unique` de la BD y entra por el `catch`.
>
> **No cabe en los PRs abiertos.** El arreglo es cambiar el índice a `(document_type, document_number)`
> —relajar un `unique` nunca falla por datos— pero hay que auditar **72 usos de `document_number`** en los
> dos monolitos (51 en `legacy-backend` / 29 archivos · 21 en `legacy-application` / 18), y varios buscan
> por número solo: `Modules/Loans/App/Repositories/UserRepository.php:23` y
> `Modules/Onboarding/App/Repositories/UserRepository.php:16`. Es su propia tarea, y va **antes** de que
> BCP reciba tráfico real.
>
> Series tocadas, de los 117.919: `1`→13.174 · `2`→12.734 · `3`→19.166 · `4`→15.894 · `6`→5.829 ·
> `7`→17.858. Las series `5`, `8` y `9` (38.846 más) no las emite RENIEC hoy, por eso no cuentan.

> **PREGUNTA · 2026-08-27 · negocio** — **¿originamos en República Dominicana sin verificación de
> identidad de terceros, sí o no?** No es una pregunta técnica y no la podemos contestar nosotros. Con
> «sí», el entregable es dejar rastro explícito por solicitud más un tablero: una tarde. Con «no», el
> primer entregable es un contrato con un proveedor. Va **antes** que todo lo de formato.

## Riesgos

> **MEDICIÓN · 2026-08-27** — **El texto de los botones se pinta del mismo color que el botón cuando al
> comercio le falta un color.** No está oculto: está ahí, invisible.
>
> `AlliedInfoController` rellena el color del TEXTO con el color del FONDO:
> `'quaternary_color' => $allied->quaternary_color ?? $allied->primary_color`. Ese respaldo no puede ser
> correcto nunca — pinta letras del color de su propio fondo.
>
> **En producción hay 4 comercios activos sin ese color**, los cuatro con fondo `4c39ff`:
> Almacenes La Ganga (**449 solicitudes en 90 días**), Joyería Sofi (104), REVIB (8) y
> HEALTH & FITNESS COMPANY (8) — **569 solicitudes**.
>
> **Y no es sólo el OTP: son 15 componentes** los que pintan el texto de su botón con ese color —el OTP,
> las tarjetas de entidad, la confirmación del crédito, la validación de identidad, la firma de
> documentos, el plan de pagos—. Para esos comercios, el wizard entero tiene los botones en blanco.
>
> **Cómo:** `SELECT id, name, primary_color, quaternary_color FROM allieds WHERE quaternary_color IS NULL
> OR TRIM(quaternary_color) = ''` contra prod.
>
> **El arreglo es una línea**, y el dato dice cuál: **329 de los 330** comercios que sí tienen el color
> usan `FFFFFF`. El respaldo debería ser blanco, no el fondo. (Sigue abierto: no se tocó, es de otra
> tanda.)


> **RIESGO · 2026-08-27** — **el orden de despliegue entre repos.** `legacy-application/develop` lee
> `countries.is_operating` en 7 archivos, y esa columna la crea una migración de **legacy-backend**. Si
> `develop` sale primero, se caen las pantallas de alta de comercio y de entidad. Hoy **nada fuerza ese
> orden**.

> **RIESGO · 2026-08-27** — el front **degrada a Colombia sin avisar**:
> `allied-theme.repository.ts:114` descarta el objeto `country` entero si falta uno de los tres campos.
> O sea que un despliegue incompleto no se ve como error, se ve como que todo es colombiano.

## Lo que NO entra

- Reescribir el flujo dinámico. Se le arregla el catálogo, no se lo unifica con el clásico.
- Migrar el tráfico de `TwilioController` al camino nuevo. Es su propia tarea y es grande (ver medición).
- La zona horaria. `countries` no tiene columna de zona: es un dato nuevo y una discusión aparte.

## Cómo se comprueba

Cada medición de abajo trae su consulta. Todas son de **solo lectura**:

    make trazador-sql TARGET=prod SQL='…'

⚠ Y para el flujo, la línea base de siempre: `make harness-caso CASOS='Motai;Kreditkasa;Sonr;AHL' PAR=1
LAMBDA=1` da **6 · 12 · 9 · 8**, y `CASOS='Motai' CERRAR=1` cierra en estado 11.

> **MEDICIÓN · 2026-08-27 · el bloqueo de Perú está en el front, no en el backend** — el catálogo de
> tipos de documento del flujo dinámico —`dynamic-step-one.ts`— sólo conoce cuatro:
>
>     CED · CI_VE · PAS · PAS_VE       …y cualquier otro tipo:  return false
>
> **`DNI` no está**, así que un peruano se cae en la primera pantalla. Y ése es **el flujo que le toca a
> BCP**: es el único comercio con `show_alternate_flow = 1`; los tres dominicanos lo tienen en 0 y van
> por el clásico.
>
> Es el espejo de lo que arreglamos: allá el techo era colombiano y `CC` al menos pasaba; acá el techo es
> **dominicano** y el DNI no existe. Los validadores del backend que arreglamos **no lo cubren**.

> **MEDICIÓN · 2026-08-27 · PROD · las sucursales dominicanas están en Colombia** — 17 de las 18 figuran
> en **«SANTO DOMINGO», zona Antioquia, país Colombia**. La otra en «TODAS LAS CIUDADES». Nadie eligió
> mal: el selector ofrecía el catálogo colombiano y hay un Santo Domingo en Antioquia.
>
>     RD en producción: 32 zonas · 0 ciudades
>     Perú:             25 zonas · 0 ciudades
>     Colombia:         36 zonas · 1.123 ciudades
>
> Es el mejor ejemplo de por qué un catálogo sin filtro de país no es un detalle cosmético.

> **MEDICIÓN · 2026-08-27 · PROD · el KYC dominicano no existe** — y esto no es un bug de formato:
>
>     usuarios con CED                        255      todos con `full_name` cargado
>     de ellos, en `kyc_name_checks`            0      de 16.731 filas
>     créditos suyos en estado 11              62
>     creados desde el 23-jul con CED/NUI      83  ·  con fila de KYC: 0
>
> El nombre que queda guardado es **el que tecleó el cliente**. `TusDatosService` cae en un `else` que
> devuelve «Tipo de identificacion invalido», y detrás no hay red: los proveedores cableados son
> colombianos. Un DNI peruano recorre el mismo callejón.

> **MEDICIÓN · 2026-08-27 · PROD · producción no tiene nada de esto todavía** — de las columnas nuevas
> sólo existe `lenders_by_allied_branches.document_types`, que ya estaba. Sin `is_operating`, sin
> `countries.document_types`, sin `lenders.document_types` y sin el backfill: **191 entidades siguen en
> Afganistán**. Todo lo mergeado vive en `qa` y en `develop`.

> **MEDICIÓN · 2026-08-27 · el 98 % de la mensajería va por el camino que no sabe de países** —
> `TwilioController` existe **duplicado** en los dos monolitos (19 sitios en uno, 26 en el otro), recorta
> el celular a `substr(-10)` y le pega `'whatsapp:+57'`. Movió **95.512 mensajes en 90 días** contra
> **2.022** del camino nuevo (`MessagingService`).
>
> ⚠ El `substr(-10)` no se puede quitar solo: repara 5.537 celulares guardados con guiones o con `+`.
> Sale junto con el controlador, no antes.

> **MEDICIÓN · 2026-08-27 · el dinero se formatea en el backend, antes de salir** — los tres builders de
> documentos pasan sus **41 montos** por `PayloadFormatters::currency()`, que castea a `(int)` —borra los
> céntimos— y quema separadores colombianos. El pagaré, el plan de pagos y los correos son colombianos
> **por construcción**, y el `pdf-mapper` no puede corregirlo porque recibe las cadenas ya formateadas.
>
> ⚠ Pero la urgencia es baja y conviene saberlo: `user_requests` guarda `decimal(15,4)` y sólo **160 de
> 361.157** filas tienen decimales distintos de cero (0,04 %).

> **MEDICIÓN · 2026-08-27 · los catálogos que se le ofrecen al cliente sin filtrar** —
> `banks`: **28 filas colombianas, sin `country_id`**, y `getActiveBanks()` no filtra. Alimenta la
> pantalla donde se elige con qué se paga. Es de los pocos casos donde hace falta una **columna nueva**:
> no se deriva de nada, igual que `is_operating`.

## Registro

### 2026-09-02 · el documento por tipo queda LISTO pero EN ESPERA

> **DECISIÓN · 2026-09-02 (Miguel)** — el PR del documento por tipo **no se mergea hasta que los
> ambientes estén estables hasta producción**. No es por riesgo del cambio —está validado y el `ALTER`
> es online, 1,3 s medido sobre una tabla del mismo tamaño— sino de SECUENCIA: mergear no corre
> migraciones (F-77), así que el código puede quedar adelantado de la base; y dev/qa/staging comparten
> base pero no código, de modo que correr la migración allá con `develop` y `staging` en el código viejo
> abre una ventana en la que su búsqueda por número solo puede devolver la persona equivocada. Hoy esa
> ventana está cerrada porque no hay ningún duplicado entre tipos, pero se abre en cuanto alguien pruebe
> Perú a propósito. **Marcado como borrador con `⛔ EN ESPERA`**, igual que el otro bloqueado a
> propósito, para que nadie lo mergee por inercia. *Cómo se retoma:* migración junto al `qa → develop`
> —con el backfill de teléfonos, que espera lo mismo— y a producción con el resto de la campaña.

⚠ **Y un detalle a corregir antes de mergearlo:** la base del PR quedó en `develop`, y el resto de la
campaña va a `qa`.

### 2026-09-02 · lo medido del choque, que desbloquea a Perú cuando se aplique

El bloqueante que estaba escrito en §«Lo que está bloqueado» desde el 27/8 quedó resuelto en un PR.
Al medirlo de nuevo salieron dos cosas que cambian cómo estaba dimensionado:

> **MEDICIÓN · 2026-09-02** — en producción hay **119.188 documentos de 8 dígitos** ocupados (119.115
> `CC`), y **85.601** caen en series que RENIEC sí emite. Eran 84.656 el 27/8: **crece solo**.
> *Cómo se vuelve a comprobar:* agrupar `users` por `CHAR_LENGTH(document_number)` y por `LEFT(...,1)`.

> **MEDICIÓN · 2026-09-02** — no son «72 usos que auditar». Esa cuenta incluía escrituras, `LIKE` de
> buscadores del admin y consultas que ya filtran por tipo. Las búsquedas por NÚMERO SOLO son **14 en
> `legacy-backend` y 16 en `legacy-application`**, y ninguna está en el camino de alta.

Y una que no estaba vista: **son CUATRO guardas, no una**. El índice de la base y el `register` miran
el número solo; `personal-info` mira número y tipo y ya estaba bien; y hay **dos `Rule::unique` en
formularios del admin** que nadie había contado. Arreglar sólo el índice no alcanzaba.

> **DECISIÓN · 2026-09-02** — en el índice compuesto **el tipo va PRIMERO**. MySQL usa el prefijo
> izquierdo, así que con el número adelante las búsquedas por número solo seguirían indexadas — y son
> justo las que devuelven la persona equivocada. Con el tipo primero se ven en el plan y en el slow log
> en vez de esconderse. *Cómo se vuelve a comprobar:* `make harness-dni-choca`.

Verificado en local con el caso que reproducía el choque: el comercio peruano acepta el número (200),
el colombiano lo sigue rechazando (409), cero pares repetidos después de migrar, rollback y
reaplicación limpios, y **los dos flujos que cierran siguen cerrando en estado 11**.

⚠ **Lo que NO resuelve:** las 16 búsquedas de `legacy-application` y las 5 de servicing y riesgo. No
están en el alta, así que no bloquean a Perú, pero hay que mirarlas antes de llevar cartera fuera de
Colombia. Quedan clasificadas en la descripción del PR.

### 2026-09-01 (tarde) · cerrado el bloqueante para poder quitar el `DEFAULT 1`

La entrada de más abajo dejaba el `DEFAULT 1` en pie con un bloqueante nombrado: el `POST` de comercios
del módulo Partner, que crea sin mandar país. Se midió ese bloqueante y resultó **mucho más chico de lo
que la migración sugería**, así que se cerró.

> **MEDICIÓN · 2026-09-01** — ese endpoint es **código dormido**: entró hace más de un año, ningún front
> lo llama, ningún test lo ejercita, y en **producción no hay un solo comercio afgano** pese a que el
> backfill de países **nunca corrió allá** (no está en su tabla de migraciones). Si esa puerta se usara,
> veríamos comercios en Afganistán. Prod: 323 Colombia + 16 RD, cero. *Cómo se vuelve a comprobar:*
> agrupar `allieds` por `country_id` contra prod, y `migrations LIKE '%paises%'`.

> **DECISIÓN · 2026-09-01** — se cierra **ya** y no al final de la tanda, aunque el endpoint no se use:
> es el creador de comercios **al que apunta la migración**, así que el día del corte se llevaría puesta
> una validación que el admin ya tiene. Son tres líneas. *Cómo se vuelve a
> comprobar:* `make harness-comercio-pais`.

> **DECISIÓN · 2026-09-01** — las cuatro piezas van en **un solo PR y un solo commit** (#1277), no en
> dos. Se había separado por materia —el país del comercio no es el del usuario—, y Miguel pidió lo
> contrario: la unidad que importa al leer es *el país deja de suponerse*, y partirla obliga a leer dos
> PRs para entender uno. Las dos ramas viejas se cerraron; el árbol se comprobó idéntico al de las dos
> juntas antes de aplastar.

Y salió una cosa de estructura que conviene tener presente: el `StoreRequest` que usa ese endpoint es un
**gemelo** del del admin de la aplicación, y el gemelo se había quedado sin la regla. No es el único par
así; cuando se toque una validación de comercio, vale mirar si el otro lado la tiene.

**Verificado con los dos PRs mergeados en una rama de prueba** —mergean limpio, sin conflicto—: la prueba
del país del usuario (17), la del país del comercio (9) y **10 flujos reales en paralelo, 10/10 en 15 s**.
La corrida en paralelo dejó la línea más clara del día:

| teléfono | el usuario nació en | comercio | país del comercio |
|---|---|---|---|
| …000–004 | **Afganistán** | pullman | Colombia |
| …005, 008 | Colombia | pullman | Colombia |
| …006, 007, 009 | Rep. Dominicana | celurd-test | Rep. Dominicana |

Los primeros cinco son de una corrida del 18/8, antes del cambio. Los otros nacieron hoy.

⚠ Y una trampa de la propia herramienta: el teléfono del runner se deriva del reloj con un período de
~10 días, así que **se repite**. Cuando pasa, el flujo ENCUENTRA al usuario viejo en vez de crear uno, y
una corrida de validación puede salir «mal» midiendo fichas de hace dos semanas. Se comprueba mirando
`created_at` del usuario antes de sacar conclusiones.

### 2026-09-01 · el usuario ya nace con el país de su comercio, y el OTP lo usa

Cerrando lo de ayer. La pregunta era si el `DEFAULT 1` de `country_id` ya no debería existir en `qa`;
la respuesta es **no, y a propósito** — la migración del backfill del 25/8 lo dejó escrito: no quita el
default porque el `POST` de comercios del módulo Partner crea sin mandar país y depende de él, así que
quitarlo cambia un bug silencioso por un 500 en una ruta viva. Sigue vivo en 7 tablas de la compartida
(`allieds`, `lenders`, `users`, `corporate_users`, `credit_lines`, `allied_types`, `settings`).

Pero eso no era lo que hacía falta. **Quitar el default y escribir la columna son dos cosas distintas**,
y para el problema del OTP hacía falta la segunda: si nadie escribe el país y ya no hay default, la
inserción falla — la columna es NOT NULL. El orden correcto es al revés.

> **DECISIÓN · 2026-09-01** — el país del usuario **se escribe al crearlo, desde el comercio**, y el
> `DEFAULT 1` se queda por ahora. Quitarlo es otra tarea con otro bloqueante (el creador del módulo
> Partner). *Cómo se vuelve a comprobar:* `make harness-pais-usuario`.

Lo que entró al PR #1275, que pasó a cubrir dos cosas:

- **`MerchantCountryService`** (nuevo): resuelve sucursal → comercio → país, en un solo lugar.
- **Los dos caminos de alta** graban ese país: el registro de celular y `UserService::getOrCreateUser`
  —que es por donde entra **SmartPay**, así que el camino de José quedó cubierto sin que él toque nada
  (ya le pasaba el `partnerBranchHash` desde `DynamicFormsService`)—.
- **El OTP por correo lee esa columna primero**, y sólo rodea por la última solicitud para los 19.618
  que nacieron antes. Ese rodeo es un puente hasta que haya backfill hacia atrás.

> **MEDICIÓN · 2026-09-01** — 17 comprobaciones en verde contra la base local y sus tres países: los dos
> caminos graban el país, sin sucursal la columna no se escribe (misma conducta de hoy), y el OTP de un
> cliente dominicano se acuña bajo **DO** en vez de **CO**. En `Modules/Onboarding/tests/Unit`: 86 fallas
> antes y 86 después —todas preexistentes en `qa`— con un test más en verde, `RC12`.

**Tres cosas que salieron de hacerlo y no se ven en el diff:**

1. **El provider construye `RegisterCellPhoneService` a mano**, con los argumentos enumerados en una
   closure. Sin actualizarla, cada registro revienta con `ArgumentCountError` en runtime — y **ningún
   test lo atrapa**, porque todos lo mockean. Es la clase de cosa que sólo aparece levantando el
   contenedor.
2. **La prueba se atrapó a sí misma**: el caso dominicano fallaba dando `CO`, y era mi generador de
   teléfonos — RD comparte el `+1` con todo el NANP, así que el país sale del **área** y sólo 809/829/849
   son suyas. Con un `823` inventado, libphonenumber tiene razón en no reconocerlo.
3. **`Modules/Onboarding/tests/Unit` tiene 86 fallas preexistentes en `qa`**, ninguna de esta tanda. Una
   es `OtpServiceTest`, que pasa 9 argumentos a un constructor de 10 desde que entró `OtpBypassService`
   en mayo. No es de esta tarea, pero conviene que alguien lo mire: esa suite no está protegiendo nada.

**Lo que sigue abierto y es la raíz de todo esto:** el `POST` de comercios del módulo Partner. Mientras
cree comercios sin país, el `DEFAULT 1` no se puede quitar y la clave de configuración
`dial_code_fallback` no se puede borrar. Es el único bloqueante nombrado.

### 2026-08-31 · el usuario temporal no lleva país, y el celular se guarda de dos formas (pregunta de José)

José preguntó cómo se guarda el código de país en el usuario temporal, y planteó que el formulario
dinámico lo hace distinto del flujo normal: que el dinámico guarda el teléfono con el indicativo y el
normal usa el país del comercio. Medido contra el código en `main` y contra la base compartida, **las dos
mitades salieron distintas de lo que se suponía**.

**El país no se guarda.** Ninguno de los dos caminos que crean un `TEMPORAL USER` setea `country_id`, y
la columna es `NOT NULL DEFAULT 1` — Afganistán. En los módulos de onboarding `country_id` sólo aparece
leyéndose. Y hubo un día en que dejó de guardarse: los **1.007** temporales creados hasta el **2024-03-18**
tienen Colombia; los **19.618** desde entonces tienen 1. Eso amplía **F-131**, que ya tenía el `DEFAULT 1`
pero lo leía como omisión histórica.

**Lo del indicativo va al revés.** Lo pega `UserService::getOrCreateUser` y sólo si el llamador le pasa
`dialCode`, que es el cuarto parámetro con default vacío. El **flujo normal** lo pasa; el alta por asesor
del **formulario dinámico** usa argumentos con nombre y lo omite, así que nunca lo pega. O sea que el que
lo pega es el normal. Quedó como **F-175**, con la tabla de los dos caminos y los tres formatos que
conviven en la base (13.476 con indicativo pegado, 6.091 sin él, 51 con `+`).

⚠ **Método:** las citas se corrigieron contra `main` antes de escribirlas. Dos de las cinco estaban
corridas porque se leyeron en la rama `qa` —`RegisterCellPhoneService` 388→376 y `OtpService` 379→378—,
que es exactamente el error que la regla de verificar contra `main` previene.

### 2026-08-31 · las banderas llegaron a la base compartida, y el PEP que no se iba era un cache

**Lo que quedó listo para probar.** Cuatro cambios, los cuatro mergeados a `qa`:

| PR | repo | estado | qué |
|---|---|---|---|
| #1250 | `legacy-backend` | ✅ mergeado | el `country` del endpoint suma `nationality` y `flag` |
| #910 | `frontend-monorepo` | ✅ mergeado | la tarjeta los consume |
| #915 | `frontend-monorepo` | ✅ mergeado 28/8 | la autoridad emisora sale de (país, tipo) |
| #925 | `frontend-monorepo` | ✅ mergeado 31/8 | la fecha de nacimiento en la cara visible y en la MRZ |

**La migración de banderas ya corrió contra la base compartida** (`2026_08_28_120000_paises_seed_de_banderas`),
a mano y desde local, porque el deploy no corre migraciones. Antes: **253 países, los 253 sin bandera**.
Después: 18 con `flagcdn`, 235 intactos, cero sobrescrituras. Sirve a dev, qa **y staging** a la vez —
comparten la misma base—. El comando quedó con las credenciales por entorno y `--path` a un solo archivo,
sin tocar el `.env`: apuntar el `.env` a la compartida es el patrón que la vació el 19/8 (CORE-431).

⚠ **`--pretend` NO sirve para validar esa migración.** En modo simulacro `Schema::hasTable()` tampoco se
ejecuta, devuelve `false` y la guarda corta antes de los UPDATE: el simulacro imprime una query y parece
que no hace nada. Se midió con un SELECT que replica el `WHERE`, no confiando en él.

**Probado en qa de punta a punta**, con el comercio peruano y el OTP leído de Slack: bandera de Perú desde
la BD (`naturalWidth 80`, no un fallback), `DNI` en el selector, `NÚMERO DE DNI` en la cara visible, la
tarjeta gira al elegir la fecha y la MRZ sale `I<PER71234567<5…`. Contraste por país contra la API de qa:
Colombia `co.png` + `['CC','CE']`, Rep. Dominicana `do.png` + `['CED','NUI']`, Perú `pe.png` + `['DNI','CE']`.

**La autoridad emisora ya sale, y cierra el pendiente que quedó anotado el 28.** La clave es **doble** —
(país, tipo)— y no sólo país, porque los documentos de extranjería los expide la autoridad migratoria:
`CE` en Colombia es Migración Colombia y en Perú es Migraciones. Un mapa por país solo pondría
«Registraduría» en una cédula de extranjería. Las siete entradas están verificadas contra el sitio oficial
de cada entidad. Va en el front y no en la BD porque es una **relación** (país × tipo), no la columna
suelta que sí fueron `flag` y `nationality`.

⚠ **Sin entrada en el catálogo va `XXXX`, y esto costó un bug.** La primera versión caía a
`country.authority` como respaldo, y con eso **un pasaporte colombiano mostraba «Registraduría Nacional»**,
que lo expide Cancillería. El default del país sólo vale para SU documento; aplicarlo a otro tipo inventa
un dato con cara de real. Lo encontró la prueba, no la lectura.

**La fecha de nacimiento ya se pedía y la tarjeta la ignoraba.** El paso de identificación la pide para
los comercios con `showBirthDate`, validada entre 18 y 100 años, y el documento la mostraba en `XXXX`.
Ahora entra también en la MRZ: TD1 reserva las posiciones 1-6 de la línea 2 para `AAMMDD` y la 7 para su
dígito verificador, que alimenta el compuesto. Verificado contra una implementación independiente del
7-3-1, no contra la del propio componente.

⚠ **Se quitó el campo SEXO de la cara visible, y es una decisión de diseño a validar.** La fila tenía tres
campos en 8 columnas y no entraban: **`COLOMBIANA` ya se cortaba a `COLOMBIA…` desde antes** —se ve en la
story `Front`, que no se tocó— y la fecha completa se cortaba a `1990-11…`. Sexo es el único de los tres
que no se va a llenar nunca: no se pide en ningún paso ni existe en `PersonalInfo`.

### 2026-08-31 · el PEP que no se iba: el backend estaba bien y el cache mentía

Se le agregó el PEP a una entidad para probar, se lo quitaron, y el wizard lo siguió ofreciendo. **El
backend estaba correcto desde el primer segundo** — `DocumentTypesService` no cachea, consulta la base en
cada request, y los dos endpoints devolvían `['CC','CE']`.

**Lo que servía el dato viejo era el cache in-process del BFF del wizard**, TTL de 10 minutos y **sin
ninguna forma de invalidarlo**: ni bypass, ni endpoint de purga, y como es cache de servidor, recargar o
limpiar el navegador no hace nada. La línea de tiempo lo cierra: la entidad se actualizó 15:08:22, la
solicitud se creó 15:09:41, y a las 15:20 el BFF ya servía lo correcto.

⚠ **Y crear una solicitud nueva no ayudaba**, que es lo primero que cualquiera intenta: el loader de
`personal-info` pide el theme **sin pasar el `loanRequestId`** —mientras otras 20 rutas sí lo pasan—, así
que la entrada de cache es una sola por sucursal. De paso, esa pantalla se pierde el bloque `metadata`
que el backend sólo manda con la solicitud (`credit_type`, `lender_path`, `origination_flow_type`).

**Se evaluó bajar el TTL y se decidió NO tocarlo** (Miguel, 31/8). Medido contra qa: la pantalla tarda
2,8-3,2 s con los caches fríos y 0,5-1,0 s calientes, o sea ~0,6 s por cache y por pantalla; un flujo pasa
por ~12 pantallas que piden el theme, así que quitarlo son 6-7 s repartidos por el funnel, en el camino
crítico del SSR. La propuesta era bajarlo sólo en dev/qa/staging dejando prod igual; el PR quedó **cerrado
con el diagnóstico dentro** (`frontend-monorepo#923`) por si se retoma.

**Dato que corrige el comentario del propio código:** dice que el cache está porque «el theme cambia a
escala de días». Medido en prod son ~1.000 solicitudes/día en ~250 sucursales, 4 por sucursal por día:
casi nunca hay dos flujos de la misma dentro de una ventana de 10 minutos. **El cache no ahorra entre
sesiones, ahorra dentro de una.** Eso es lo que dimensiona el TTL. Y tampoco lo justifica aliviar al
monolito: sin cache serían ~12.000 requests/día, 0,14 req/s.

### 🔴 Riesgo abierto: vaciar los tipos de una entidad hace aparecer MÁS, no menos

`app/Services/DocumentTypesService.php` termina así:

    return $cruce !== [] ? $cruce : array_values($tiposDelPais);

Colombia tiene `["CC","CE","PEP"]` en `countries.document_types`. Si alguien le quita **todos** los tipos
a las entidades de una sucursal, el cruce da vacío y el fallback devuelve **los tres del país, PEP
incluido**. Hoy no está disparando —ninguna de las 171 entidades tiene los tipos vacíos, medido— pero es
exactamente el escenario que se temía y está armado esperando.

Y una trampa de configuración: **`lenders.document_types` es de la entidad global**, no de la relación con
el comercio. «Agregarle PEP a una entidad de Pullman» se lo agrega para todos los comercios que la tengan
activa. Esta vez no hubo daño porque `DunCredito CO` está en un solo comercio.

### 🔴 El bypass de OTP de QA no aplica en el ambiente qa

`Modules/Onboarding/App/Services/OtpBypassService.php` corta en la primera línea:

    if (!app()->environment('local', 'development')) return false;

En qa eso devuelve `false`. La prueba: **`3224675745` está en `qa_otp_bypass_phones`** y su OTP en qa fue
`2935` —un código real por SMS— en vez de `5745`, sus últimos 4. Consecuencia: **CORE-448**, que le enseñó
al bypass los prefijos de Perú y RD, **sólo rinde en local y dev**; en qa nunca dispara. Hoy no bloquea a
nadie porque los OTP de qa se leen en el canal `#qa-messages` de Slack (cambio de Joel), pero **el harness
sí depende del bypass**, así que contra qa no puede solo.

### 2026-08-27

Censo con 35 agentes por seis dimensiones —dinero, tiempo, teléfono, documento, geografía, proveedores—,
cada hallazgo verificado por un segundo agente que intentaba refutarlo, y los números decisivos
re-medidos a mano contra producción.

⚠ **Un hallazgo del censo NO se confirmó y queda anotado para que nadie lo persiga**: decía que el
detector de «internacional» (`str_contains($cell_phone, '+')`) hacía que **81 colombianos** recibieran
plantillas dominicanas. Medido: son **180 dominicanos y 1 colombiano**. El mecanismo sigue siendo frágil,
pero el daño de hoy es una persona.

### 2026-08-27 · el catálogo del formulario dinámico, hecho

⚠ **CORREGIDO el mismo día, después de una pregunta de Miguel.** Yo había escrito que este catálogo
«bloqueaba a Perú en la primera pantalla». **Es falso, y la premisa estaba mal en dos puntos.**

**Uno: a este flujo NO entra Perú.** La puerta es `phone-number.tsx:68` — `if (alliedCountry === 60)
redirect(.../request-amount)`. El 60 es **República Dominicana**. Perú (167) hace el flujo clásico.

**Dos: `allieds.show_alternate_flow` no abre el flujo dinámico.** Manda el FINAL del clásico al
simulador de Cuotéalo (`resolve-onboarding-destination.uc.ts:32`), que es otra cosa. Lo agregó Oscar
Rincón el 2026-08-22 y sólo está en `origin/qa` de legacy-backend.

Así que los cuatro tipos que conocía —`CED`, `CI_VE`, `PAS`, `PAS_VE`— son **los correctos** para quien
usa hoy esa pantalla: los 12 comercios dominicanos de SmartPay, más los venezolanos, que son la migración
de ahí. **No era un bug para nadie que exista hoy.**

**Lo que el cambio sí vale**, dicho sin inflarlo: el techo estaba en el lugar equivocado —una lista
escrita a mano rechazando lo que el esquema ofrezca— y los largos estaban duplicados
(`slice(0, 11)` por un lado, `maxLength: 11` por otro). Es limpieza, no un desbloqueo.

**Cómo quedó:** un catálogo `FORMATOS` que dice lo que sabemos de la FORMA de cada documento, no cuáles
existen. Un tipo sin entrada se acepta con una guarda de sanidad (alfanumérico, 3–20). El mismo catálogo
alimenta las tres cosas que antes estaban repetidas: la validación, el `maxLength`/`inputMode` del campo
y el saneado al escribir — que tenía los largos sueltos (`slice(0, 11)`) y podía desincronizarse.

**Medido**, con los tres tipos del catálogo de países (`CC/CE/PEP` · `CED/NUI` · `DNI/CE`):

| | antes | ahora |
|---|---|---|
| `CED` 11 dígitos · `CI_VE` · `PAS` | pasan | pasan igual |
| `CED` de 10 · `PAS` de 4 | rechazan | rechazan igual |
| `DNI` · `CC` · `CE` · `NUI` · `PEP` | **imposible** | pasan |
| `DNI` de 2 caracteres · con símbolos | rechazan | rechazan |

Regresión del flujo clásico sin cambio: Motai 6 · Kreditkasa 12 · Sonr 9 · AHL 8. Typecheck en 218, el
mismo de `qa`.

⚠ **Y un hallazgo que no buscaba: los tests del monorepo NO corren.** Los 34 archivos `*.test.ts` fallan
igual con `ReferenceError: __vite_ssr_exportName__` — los workspaces declaran `vite ^6.3.3` pero el
hoisting resuelve **7.3.3**, y `vitest 1.6.1` no sabe leer su transform de SSR. **Y ningún workflow de
`.github/workflows/` corre tests**, así que nadie se enteró. Medido en tres workspaces (14 archivos):
cero tests ejecutados. El test nuevo queda escrito igual —protege en cuanto se destrabe—, pero **hoy la
prueba de que esto funciona es el runner de consola**, no vitest. Destrabarlo es subir vitest a ^3.

### 2026-08-27 · la sucursal ya no decide (lo cazó Miguel)

El `DocumentTypesService` de los dos monolitos traía un respaldo: *«si la entidad no declara nada, mirá la
fila de sucursal»*. Estaba puesto como **puente hasta que corriera el backfill**. Miguel lo vio al leer el
título del PR —que decía «los documentos que ese punto de venta ofrece»— y preguntó por qué estábamos
volviendo a meter el nivel que la reunión había decidido quitar.

**Tenía razón, y además ya era código muerto:** el backfill corrió el 2026-08-26.

**Medido antes de tocar nada:**

- en dev, **4.082** filas activas y **las 4.082** con la entidad declarando → el respaldo dispara **0** veces
- en local, de **6.163** filas con dato en la sucursal, **0** tienen su entidad sin dato
- corriendo el resolvedor sobre **las 1.525 sucursales**, con y sin el cambio: **0 diferencias**

Lo devuelto, para que quede el retrato: 1.523 sucursales dan `CC,CE`, una da `CED,NUI` (RD) y una da
`CC,CE,PEP`.

**Con esto `lenders_by_allied_branches.document_types` se queda sin lectores** —el único que quedaba en
`main` era `AlliedInfoController`, que este PR reemplaza por el servicio— y puede borrarse en una
migración aparte.

⚠ **La lección es del título, no del código.** El PR se llamaba «los documentos que ese punto de venta
ofrece» y el código hacía otra cosa; el título es lo que se lee en la lista de PRs y es lo que disparó la
duda. Renombrados los dos a **«Los documentos los dicta la ENTIDAD, y el validador lee lo mismo que el
selector»**.

### 2026-08-27 · la migración que borra la columna, escrita pero BLOQUEADA

Se pidió meterla en el PR. **No puede ir ahí**, y la razón es la BD compartida: `dev` y `staging` son la
misma base, y **tres ramas desplegadas todavía leen** `lenders_by_allied_branches.document_types`:

| lector | rama |
|---|---|
| `AlliedInfoController` (versión vieja, `pluck('document_types')`) | `legacy-backend/main` |
| `AlliedInfoController` (versión vieja) | `legacy-backend/develop` |
| `AlliedAlliedBranchController:136` — la **conserva** al guardar una sucursal | `legacy-application/develop` |

Con **4.053 filas con dato en dev**, borrarla hoy es un `Unknown column` que tumba el listado de entidades
y el guardado de sucursales en los dos ambientes a la vez.

**Queda escrita y probada, en su propio PR marcado ⛔ BLOQUEADA.** El orden: mergear el PR del servicio →
que `qa` llegue a `main` y a `develop` → sacar la línea que conserva el dato en el admin de
`legacy-application` → recién ahí borrar.

**La migración no confía en que alguien lea eso:** `up()` **se niega a borrar** si `lenders.document_types`
no existe (el estado de **producción hoy**, donde la columna de la sucursal es la única fuente) o si alguna
entidad activa tiene documentos en la sucursal y ninguno propio. `down()` recrea la columna y la repuebla
desde la entidad.

**Probada corriéndola contra la BD local:** la guarda abortó nombrando la entidad sembrada (`Ids: 7`); el
borrado dejó el resolvedor dando **1.525 sucursales con 0 diferencias**; el rollback devolvió la columna y
repobló las **6.232** filas.

### 2026-08-28 · el documento deja de asumir Colombia, y lo que la tabla `countries` ya tenía

**#903 mergeado** (la tarjeta genérica). Encima, dos PRs para que el país salga de la BD:

| PR | repo | qué |
|---|---|---|
| #1250 | `legacy-backend` | el objeto `country` del endpoint suma `nationality` y `flag` |
| #910 | `frontend-monorepo` | la tarjeta los consume; el default quemado deja de ser lo único que se ve |

**El hallazgo que cambió el plan.** La idea inicial era agregarle una columna `metadata` (JSON) a
`countries` para bandera, gentilicio y capital. Al mirar el esquema, **casi todo ya tenía columna**:

| lo que se quería guardar | columna que ya existe | cómo está |
|---|---|---|
| bandera | `image` varchar | **vacía en TODOS los países** |
| gentilicio | `nationality` varchar | **sólo Colombia** (`COLOMBIANA`) |
| tipo de documento | `document_types` **json** | **sólo Colombia** (`["CC","CE","PEP"]`) |
| capital | — | no existe (lo único que falta) |

Más `iso_code_2/3`, `locale`, `currency`, `dial_code`, `phone_code`, `cell_phone_lenght`,
`address_format`. **El problema no es de esquema: es que nadie llena lo que ya está.** Un `metadata`
JSON encima habría sido la quinta columna que miente.

⚠ **Y dos cosas que el esquema esconde:**

- **`iso_code_2` guarda el código de TRES letras** (`AFG`, `COL`) y `iso_code_3` está vacía. El
  controller ya lo expone bien —`'iso_code' => $country->iso_code_2`—, así que el front recibe el
  valor correcto bajo el nombre correcto, pero la columna de origen miente.
- **`document_types` existe en TRES tablas**: `countries`, `lenders` y `lenders_by_allied_branches`.
  El formulario hoy usa la de la sucursal y el PR #1220 estableció que lo dicta la entidad. Meter una
  cuarta fuente en un metadata de país habría empeorado justo lo que esta tarea desarma.

**Decisión sobre los datos que faltan:** lo que no se le pide al solicitante y no se puede deducir se
muestra como `XXXX`, no vacío ni inventado. Un guion se lee como error de carga; un `Bogotá` de relleno
es indistinguible de un dato real. Mismo criterio que el `<` de la MRZ. La tarjeta ahora distingue tres
cosas: lo escrito, lo deducido del país, y lo que no se sabe.

**Lo que sigue sin salir de la BD:** el nombre local del documento y la autoridad emisora — no hay
columna para ninguno.

### 2026-08-27 · dos componentes de país quemado que el censo no tenía, y su prototipo

**El censo no los tenía.** `grep -rln "IdBack\|PepCard" tablero/data/*.md context/` no devuelve **nada**:
los dos componentes que le dibujan al solicitante su documento en el paso de fecha de expedición no
estaban fichados en ninguna tarea ni en ningún nodo. Son país quemado a la vista del cliente, no en una
consulta.

**Qué son.** En `frontend-monorepo`, módulo `loan-application-form`:

| | |
|---|---|
| `IdBack.tsx` | 173 líneas. El **reverso de la cédula colombiana**: estatura, G.S RH, departamento, código de barras. Todo con `opacity-30` salvo el recuadro de la fecha de expedición, que resalta en `#f79008` con los números animados por spring (`motion/react`) |
| `PepCard.tsx` | 84 líneas + un PNG de 1 archivo (`pep-background.png`). El **Permiso Especial de Permanencia**, posicionando spans sobre la imagen con `--px: 0.2cqw` |
| la elección | `init-loan-request.tsx:274` — `formData.documentType === "PEP" ? <PepCard/> : <IdBack/>` |

**Por qué no escala:** el `documentType` decide cuál de las DOS ilustraciones colombianas se muestra. Un
comercio dominicano (`CED`, `NUI`) o peruano (`DNI`) cae al `else` y ve el reverso de una cédula
colombiana. No hay una tercera opción que agregar: hay que salir del patrón.

**El prototipo: `tablero/data/artifacts/internacionalizacion-onboarding.tarjeta-identidad.html`.** Un archivo, sin dependencias, editable en
vivo (apellidos, nombres, documento, nacimiento, sexo, lugares, autoridad, vencimiento + los tres
selectores de la fecha de expedición). Lo que resuelve:

- **La estructura sale de ICAO 9303 TD1**, el estándar de las ID tamaño tarjeta: proporción 85,6 × 54 mm,
  los campos que existen en TODA identificación, y la MRZ de 3 × 30 caracteres. Lo que se dejó afuera
  —estatura, grupo sanguíneo, departamento, código de barras— es exactamente lo que no generaliza.
- **El país es dato, no estructura**: un objeto por país define nombre, ISO3, nombre local del documento,
  cómo se llama su número y la autoridad. Instanciar un país es una entrada más, no una rama de código.
- **Dos caras con giro**: el frente muestra lo que el solicitante ya escribió; al tocar la fecha de
  expedición gira y el reverso resalta ese campo, que es donde vive el dato en el documento real.
- Los SVG de silueta, huella y guilloché son los del diseño; el guilloché ya venía en `#F0BE00`.

⚠ **Y un hallazgo del dominio que salió de implementar la MRZ: la cédula colombiana NO cabe en ella.**
El campo del número de documento en TD1 tiene **9 posiciones** y la cédula tiene **10 dígitos**. El
estándar lo previó: los primeros 9 van en su lugar, un `<` reemplaza al dígito de verificación, y el
resto **más el dígito del número completo** se mueven al campo de datos opcionales. Con `1020304050` eso
da `01` en opcionales. El DNI peruano (8) entra completo; la CURP mexicana (18) también resuelve por el
mismo mecanismo. **Si algún día se compara un número de cédula contra el que devuelve un lector de MRZ,
ahí está el motivo por el que no coinciden de forma directa.**

El algoritmo del módulo 7-3-1 está verificado contra el caso canónico del apéndice de 9303 parte 3
(Utopía / ERIKSSON): reproduce las tres líneas carácter por carácter, incluido el dígito compuesto —que
no cubre toda la MRZ, sino las posiciones 6-30 de la línea 1 y las 1-7, 9-15 y 19-29 de la línea 2.

**Estado: PR abierto — `frontend-monorepo` #903 → `qa`** (2026-08-27). Rama `pais/la-tarjeta-de-identidad-es-generica`, sacada de `origin/qa` (no de `main`:
`personal-info-form.tsx` ya difiere entre las dos y `qa` es la versión nueva). El componente
`IdentityCard.tsx` está escrito con el diseño del prototipo, `IdBack`/`PepCard`/el PNG borrados, la
bifurcación de `init-loan-request.tsx` reemplazada y la story de storybook migrada. **Pasa `biome check`
y `tsc --noEmit`** (los 9 errores de tsc son preexistentes de `packages/ui`); los 3 tests que fallan del
módulo **fallan idéntico en `qa` limpio** — comprobado con stash.

Dos commits separados a propósito: la tarjeta, y el autocompletado del navegador (que sólo se activa en
self-service, porque en `/merchant` el navegador es del asesor). El segundo se puede revertir solo.

**Lo que falta:** el componente todavía no recibe el país — el default quedó **quemado en Colombia**
(`COLOMBIA_MIENTRAS_TANTO`, con Bogotá en los campos de lugar) mientras se parametriza desde la BD. El
resolvedor de país del front ya existe —entró por el PR #889—, así que es cablearlo, no construirlo.
Y falta correr el flujo entero en un navegador con sesión: lo verificado es build, lint, tipos y las dos
caras en Storybook.

⚠ Y una que apareció al portarlo, por si reaparece en otro componente con 3D: **`container-type` en la
cara que rota rompe el giro.** Aplica `contain: layout`, y un elemento con containment no participa del
contexto 3D de su padre: con `backface-visibility: hidden` las dos caras quedan invisibles. Va en un
contenedor de afuera.

### 2026-08-27 · la corrida por comercio, y el agujero que destapó

Miguel pidió correr el harness en los comercios afectados para ver el país en todos y confirmar que
siguen llegando a estado 11. **Encontró un bug que leer no encontraba.**

**El país, por API** (`GET /api/loans/allied/{hash}`), en los 7 comercios del dump local:

| comercio | país | documentos | moneda | tel | largo |
|---|---|---|---|---|---|
| Prodens · Sonría · Kreditkasa · AHL · DENTIX · Motai | Colombia | `CC,CE` | COP | +57 | 10 |
| **CeluRD Test** | **Dominican Republic** | **`CED,NUI`** | **DOP** | **+1** | 10 |

**Cierre a estado 11** (los tres con entidad CreditopX):

- **Motai (CO)** → cierra, `Motai RB`
- **CeluRD Test (RD)** → cierra, **`smartpay`** — el flujo dominicano cierra entero en local
- **DENTIX** → NO cierra, HTTP 500 generando documentos. **A/B contra `origin/qa`: falla idéntico.
  Preexistente, no nuestro.**

Los otros cuatro dan listado sin cambio: Kreditkasa 12 · AHL 8 · Sonría 9 · Prodens 1.
⚠ `Pullman-pruebas` da **0 de 0 cableadas**: no tiene entidades en el dump local, no es un bug.

⚠ **El harness NO prueba el validador.** Inyecta la identidad directo en la BD
(`pkg/inject.ts:157`, `UPDATE users SET document_type=?`, por defecto `'CC'`) y nunca llama a
`personal-info`. Por eso el dominicano cerró con `document_type = CC`, que su país no ofrece. Eso NO era
el bug — pero al ir a buscarlo, apareció el bug de verdad.

**EL BUG · el puente perdonaba a todo el mundo.** `RegisterCellPhoneService` crea el usuario temporal con
`document_type = 'CC'` **quemado**, y el puente acepta «lo que la persona ya tiene guardado». Combinados:
**`CC` pasaba en cualquier país** — el techo del país no rechazaba nunca el documento colombiano. Y la
columna es `NOT NULL`, así que no hay usuario sin tipo previo: el puente aplicaba siempre.

**El arreglo:** el puente **no perdona al usuario temporal**, que se reconoce por `first_name = 'TEMPORAL
USER'` (lo único que el alta escribe para marcarlo). En los dos monolitos.

**Probado por API contra el comercio dominicano** (catálogo `CED,NUI`):

| | `CC` | `CED` · `NUI` | `CE` · `PEP` · `DNI` |
|---|---|---|---|
| usuario temporal, `CC` sembrado por el alta | **422** | pasa | 422 |
| persona real que ya había elegido `CC` | **pasa** — el puente perdona, como debe | pasa | 422 |

⚠ **Y un dato de la sucursal 1676 que confirma el diseño:** tiene **dos** entidades SmartPay —`153
SmartPay` con `["CED","NUI"]` y `152 smartpay` con `["CC","CE"]`, documentos colombianos en una entidad
dominicana—. El resolvedor devuelve `CED,NUI` porque el catálogo del país recorta la unión. **El país como
TECHO arregla el dato mal cargado sin tocarlo.**

### 2026-08-27 · la ficha en blanco ya no dice «colombiano» (idea de Miguel)

Al registrarse —antes de que la persona diga su nombre— se le crea una ficha `TEMPORAL USER`. La casilla
de tipo de documento es `NOT NULL` y el código escribía **`'CC'`**. Miguel propuso poner **`'-'`** en vez
de eso, y es lo correcto: `CC` no es un valor por defecto, es afirmar «colombiano» sobre alguien de quien
no se sabe nada.

**Medido en prod, 90 días:** **8.935 personas** abandonan antes de llenar sus datos y quedan con esa
afirmación. Las 55.595 que sí completan quedan bien (`CC` 55.195 · `CE` 274 · `CED` 125 · `PAS` 1), porque
al llenar los datos el relleno se pisa. Así que el daño es de datos, no de cliente — pero ensucia todo
conteo por documento y por país.

**Se verificó antes de tocarlo, porque `-` podía romper algo:**

- lo que compara `users.document_type` contra un valor —TusDatos, las reglas de Datacrédito, la categoría
  del lender, los PDF de consentimiento, el PEP del backoffice— corre **después** de los datos personales,
  o sea que ve el tipo real, nunca el relleno;
- `legacy-application` **no crea la ficha**: delega el registro a la API de legacy-backend
  (`RegisterCellPhoneController:218`) y sólo hidrata el modelo. **Un solo lugar que arreglar.**

⚠ **Lo que sí se habría roto, y se arregló junto:** los dos chequeos de duplicados buscaban al dueño de un
documento con `findByDocumentAndType($doc, 'CC')`. Con el relleno en `-` habrían dejado de encontrar al
dueño y el mensaje habría degradado al genérico. **Pero el filtro por tipo ya estaba mal de antes:**
`users.document_number` tiene índice UNIQUE, así que el número ya identifica a la persona, y filtrar
además por tipo sólo podía dejar de encontrar a quien eligió `CE` —o `CED` si es dominicano—. Ahora es
`findByDocument($doc)`, un método nuevo del repositorio del módulo.

**Probado corriéndolo:** un registro real contra la sucursal dominicana deja `document_type = '-'`; los 13
tests del *freeze* de `RegisterCellPhoneService` pasan (actualizados los 7 mocks); y la regresión de cierre
no se movió — Motai (CO) y CeluRD/SmartPay (RD) cierran en estado 11.

**No se tocan las 8.935 fichas viejas.** Son historia y reescribirlas no cambia nada operativo.

### 2026-08-27 · el último respaldo quemado, y el bug que escondía (lo cazó Miguel)

Miguel señaló el `$permitidos = ['CC', 'CE', 'PEP'];` del validador: *«no es mejor confiar en lo que
estipula el country o la entidad?»*. Tenía razón, y quitarlo destapó algo mucho más grande.

**Los dos respaldos, medidos antes de tocarlos:**

- el del `FormRequest` (`['CC','CE','PEP']`) era **inalcanzable**: el servicio nunca devolvía vacío porque
  tenía su propio respaldo colombiano adentro;
- el del servicio (`['CC','CE']`): de **1.941 sucursales activas en prod, 1.915 resuelven por entidad y 26
  por país — ninguna llegaba al respaldo**. No protegía a nadie; esperaba para hacer daño el día que se
  cablee un país nuevo sin catálogo.

Ahora el servicio devuelve **vacío** cuando no sabe, y el validador lo trata como configuración
incompleta. ⚠ **El mensaje también mentía**: decía «este punto de venta no tiene tipos configurados»
cuando quien los declara es **la entidad**; mandaba a soporte a la pantalla equivocada.

**EL BUG QUE EL RESPALDO ESCONDÍA.** La ruta se llama `{partner_branch_id}` **pero el front manda el
HASH** (`personal-info.repository.ts:40`, `partnerBranchHash`). Con el `(int)` que había, eso valía `0`,
la sucursal **nunca se resolvía**, y la validación caía siempre en la lista colombiana. **En esa ruta el
422 de `CED` seguía pasando y el PR no arreglaba nada.** Sólo se vio al quitar el respaldo: mientras
estuvo, el bug era invisible porque el resultado se parecía a lo correcto.

**Y un segundo error, mío, en el propio arreglo:** resolví con «si parece número es un id». **63 de las
2.244 sucursales de producción tienen un hash de puros dígitos** (`30306926` es una) — la heurística los
tomaba por id y volvía a dejarlas sin resolver. Ahora se busca **por hash primero**; el orden es seguro
mientras los ids sean de 4 dígitos y los hashes de 8.

⚠ **También se arregló el harness**, que mandaba `document_type: 'CC'` quemado y por eso no podía probar
un comercio que no fuera colombiano. Ahora pide `allowed_document_types` al payload del comercio y usa el
primero.

**La prueba de que la tanda entera sirve**, corriendo el flujo completo: el comercio dominicano **cierra
en estado 11 con `CED`**, y el colombiano con `CC`. Antes los dos cerraban con `CC`.

⚠ **Lección de método, para la próxima:** un respaldo escrito a mano no sólo mete un país quemado —
**esconde el error que lo hace disparar**. Cada vez que veas un `?: ['algo','razonable']`, la pregunta no
es «¿es razonable?» sino «¿cuándo dispara, y por qué?».

### Qué hizo Laura, y por qué hacía falta

Dos PRs gemelos, mergeados el **2026-08-26 a las 22:38**, siete horas después de los míos de las 15:41.
Es la misma campaña: ella construyó **encima** de la base y siguió.

| | |
|---|---|
| [frontend-monorepo#891](https://github.com/Creditop-SAS/frontend-monorepo/pull/891) | la moneda y el largo del celular · 13 archivos, +467 −55 |
| [legacy-backend#1221](https://github.com/Creditop-SAS/legacy-backend/pull/1221) | el OTP: validación **y** entrega con el país · 5 archivos, +80 −4 |

**1 · La moneda.** `AMOUNT_CONFIG_BY_CURRENCY` conocía COP y DOP y caía a Colombia para todo lo demás.
Corriendo el módulo real, un comercio peruano veía `"El monto mínimo es PEN 50.000"`: el piso colombiano
—**50.000 soles**, ~25 veces un préstamo de consumo— y `PEN` en vez de `S/`, porque `Intl` sólo conoce el
símbolo dentro de un locale que use esa moneda y estaba formateando con `es-CO`.

**2 · El teléfono.** `COLOMBIAN_PHONE_REGEX = /^3[0-5][0-9]{8}$/` era el validador de **todos** los países.
El móvil peruano son 9 dígitos y empieza en 9: el cliente no pasaba de la segunda pantalla. Y
`otp-verification` devolvía `INVALID_PHONE` **aunque el cliente ya hubiera recibido su código**.

**3 · El OTP — y esto corrige un error MÍO.** Dos partes:

- **Mi regla estaba en las rutas equivocadas.** [#1193](https://github.com/Creditop-SAS/legacy-backend/pull/1193)
  creó `CellPhoneLengthForCountry` y la aplicó a `CreateAndAuthUser` y a `OnboardingV2\ValidateOtpAuthRequest`
  — **pero el wizard no pega a ninguno de los dos.** Pega a `phone/register`, `otp-validate/{...}` y
  `otp/resend-via-email/{...}`, y los tres seguían con `digits:10`. Verificado: `SendOtpCodeRequest` y
  `ValidateOtpCodeRequest` tenían **0** referencias a la regla antes de su PR y 2 después.
- **El país nunca llegaba al proveedor.** `OtpService::buildOtpDeliveryContext` resolvía el prefijo con
  `$sendOtpCodeRequest->dialCode ?? null`, y **`dialCode` no es una clave que el request declare**
  (verificado: 0 apariciones en `SendOtpCodeRequest`). O sea `normalizeDialCode(null)` → `'+57'`, el país
  se resolvía como Colombia **siempre**, y el identificador que se le entrega al microservicio de OTP se
  rearmaba con el prefijo colombiano. Para un número peruano eso construye un número que no existe: **el
  código se da por enviado y nunca llega.**

⚠ **Y su decisión de meter los dos en un solo PR es la parte instructiva:** aflojar la validación sin
arreglar la resolución del país **cambia un bloqueo visible por una falla silenciosa**, que es peor.

**Qué le tocó a lo nuestro.** Su #891 reemplazó la mitad de moneda y teléfono de nuestro PR abierto — por
eso se rehízo desde `qa` y quedó sólo con el resolvedor compartido y el `maxLength` del documento. Y en un
punto el suyo es estrictamente mejor: su esquema valida **por ISO** y conserva el patrón colombiano como
*regla de Colombia*; con el nuestro, `1234567890` pasaba a ser un celular válido.

**Dos criterios suyos que conviene copiar:**

- **Los decimales NO se derivan de `Intl`.** La ISO 4217 le asigna 2 decimales al peso colombiano, y en
  Colombia no se opera con centavos. Ese `maximumFractionDigits: 0` escrito a mano **era una decisión de
  negocio, no un descuido** — derivarlo del estándar habría metido centavos en toda la operación viva.
- **El regex colombiano se conserva, pero como mapa por ISO con UNA entrada.** Un patrón de prefijos
  móviles envejece: cuando el regulador asigna un bloque nuevo **rechaza clientes reales**, que es fallar
  cerrado. Los demás países se validan por largo, que es estable; Colombia no se afloja.

### 2026-08-27 · mirar la pantalla encontró lo que ninguna prueba veía

Se montó un **comercio peruano en local** (`make harness-peru`, idempotente y sólo local) porque el dump
no tenía ninguno: 266 colombianos y 2 dominicanos. Perú ya estaba entero como PAÍS —`PEN`, `+51`, 9
dígitos, `["DNI","CE"]`, `es-PE`, `is_operating`—; lo que faltaba era un comercio que lo usara, y sin
comercio no hay hash, y sin hash no hay pantalla.

**Y al abrirla apareció el hueco.** El país llegaba al **esquema** de validación pero **no al CAMPO**: al
renderizar `PhoneNumberStepForm` no se le pasaban `cellPhoneLength` ni `phoneCode`, y el componente los
acepta desde el PR de Laura. Medido en el DOM:

| | antes | ahora |
|---|---|---|
| `maxLength` | **10** | **9** |
| placeholder | `3001234567` | vacío |
| prefijo | ninguno | **`+51`** |

O sea: el validador ya aceptaba el móvil peruano de 9 dígitos, pero **el campo seguía anunciando 10 y un
ejemplo colombiano**. Eran dos props en el sitio de la llamada.

**Colombia no se movió** —10 dígitos y su placeholder— y de paso ganó su `+57`, que nunca se había pasado.

⚠ **La lección, que es más útil que el arreglo:** el esquema y el campo se configuraban por caminos
distintos, así que **arreglar uno se veía como arreglar los dos**. Ninguna prueba de esta tanda lo habría
encontrado: la validación estaba bien y era lo único que se estaba probando. Sólo se vio abriendo la
pantalla con el país puesto.

**De paso, el formato de moneda por país, en pantalla:** `S/ 1,500` con coma (es-PE) contra
`$ 2.000.000` con punto (es-CO).

⚠ **Perú tiene 0 ciudades cargadas**, así que ese comercio llega hasta el celular y datos personales se
corta. Es lo esperado —está en el censo como pendiente—, no un bug del wizard.

### 2026-08-27 · el ejemplo del celular, y por qué va en la misma tabla

Los tres PRs de la tanda quedaron **mergeados**. Encima de eso salió uno más, chico y con una decisión de
diseño que vale registrar.

**El problema:** el campo del celular elegía su número de ejemplo con
`placeholder={largo === 10 ? "3001234567" : undefined}`, o sea **«si mide 10 dígitos, es Colombia»**.
República Dominicana también mide 10, así que al cliente dominicano se le mostraba un número colombiano;
al peruano —9 dígitos— ninguno. Un ejemplo equivocado le dice al cliente que su número está mal cuando
está bien.

**Los formatos, verificados contra el plan de numeración de cada país y no de memoria:**

| | ejemplo | regla real |
|---|---|---|
| Colombia | `3001234567` | 10 dígitos, móviles empiezan en 3 |
| Perú | `987654321` | todo móvil es nacional, 9 dígitos, **siempre** empieza en 9 |
| Rep. Dominicana | `8091234567` | 10 dígitos: área 809/829/849 + 7 locales |

⚠ **Y la decisión que importa: el ejemplo vive en la MISMA tabla que la regla de validación**
(`REGLAS_DE_PREFIJO`, por ISO), no en una nueva. Tenerlo aparte sería una segunda lista de *«qué sabemos
del móvil de este país»*, y este wizard ya pagó ese precio **dos veces en dos semanas**: el selector de
documentos contra su validador, y el esquema del celular contra su campo. Las dos veces el síntoma fue el
mismo —una mitad arreglada parecía arreglar las dos— y las dos veces sólo se vio corriendo o mirando.

La tabla queda **asimétrica** a propósito: Colombia con patrón y ejemplo, Perú y RD sólo con ejemplo. El
ejemplo apenas tiene que parecerse a un número de allá; un patrón decide **a quién se rechaza**, y para
eso sigue valiendo el criterio de Laura de no inventar prefijos sin verificar.

**Un país sin entrada no recibe ejemplo.** Inventar uno sería peor que dejar el campo vacío.

**Verificado en pantalla con un comercio de cada país:** `+57`/10/`3001234567` · `+51`/9/`987654321` ·
`+1`/10/`8091234567`. Los ISO que entrega el backend (`COL`, `PER`, `DOM`) coinciden con los de la tabla.

### 2026-08-27 · la tercera vez que el mismo dato estaba en dos lados

Miguel lo vio en pantalla: un comercio **dominicano** mostraba su `+1` correcto y al lado `3178622287`,
un celular colombiano. **#894 arregló el flujo clásico; el dinámico —el de RD— tenía su propio ejemplo
escrito a mano.**

Buscando aparecieron **cinco pantallas** que piden el celular, cada una resolviendo el ejemplo por su
cuenta: el clásico, el dinámico, el del IMEI, el de autogestión y el del codeudor.

**Ahora la tabla vive en `shared-utils`**, junto a la de monedas que ya estaba ahí por lo mismo. Los dos
flujos la leen y ninguno depende del otro.

⚠ **Y al centralizar, el compilador delató una CUARTA copia** del patrón colombiano: estaba definido dos
veces dentro del mismo paquete (`schemas/common.ts` y la tabla nueva), más las de los módulos.

**El patrón que ya es imposible ignorar — tres veces en dos semanas, siempre igual:**

| | las dos mitades | cómo se vio |
|---|---|---|
| tipos de documento | el selector contra su validador | corriendo el flujo |
| largo del celular | el esquema contra su campo | mirando la pantalla |
| ejemplo del celular | el clásico contra el dinámico | mirando la pantalla |

**Las tres veces el síntoma fue idéntico: arreglar una mitad parecía arreglar las dos.** Y ninguna prueba
las habría encontrado, porque cada mitad estaba bien por separado. Es el argumento más fuerte que tenemos
para que un dato de país no se escriba dos veces, y para no confiar en que la prueba unitaria lo cubra.

⚠ **Lo que quedó sin verificar en pantalla:** el flujo dinámico y el del IMEI viven bajo `/merchant/*`,
que exige sesión de asesor. Se verificaron por código y tipos. La tabla sí se probó aislada
(`COL/PER/DOM` + minúsculas + país desconocido) y el flujo clásico en los tres países.

⚠ **Lo que NO entra:** la pantalla del codeudor sigue con el ejemplo y el largo fijos — es la única que no
carga el tema del comercio, así que no tiene de dónde sacar el país.

### 2026-08-27 · el monto no admitía centavos, y además los leía mal

Miguel preguntó si tenía sentido llevar lo de Laura al monto **por país**, y apuntó lo concreto: el sol
admite céntimos, así que el campo tiene que dejar escribirlos. **Al mirarlo, el problema no era que
faltara: era que el campo leía mal lo que la persona escribía.**

`parseCurrency` era `replace(/\D/g, "")` + `parseInt`: **tiraba el separador decimal y pegaba los
dígitos.** Medido en pantalla con el comercio peruano:

| se escribe | quedaba | o sea |
|---|---|---|
| `1500.75` | `150,075` | una solicitud de **S/ 150.075** en vez de S/ 1.500,75 |
| `2000000,99` (Colombia) | `200.000.099` | **cien veces más**, y ahí la coma es su separador decimal |

**Cien veces más, en silencio.** El sol y el peso dominicano usan su unidad menor y la cuota ya se guarda
con decimales (`fee_value` es `decimal(15,4)`): el campo era la única pieza que no los admitía.

**Y el que de verdad bloqueaba, que sólo se ve tecleando:** el campo se re-pintaba desde el valor en cada
tecla, así que con 2 decimales escribir `1500` lo dejaba en `1,500.00` — y con el `.00` ya puesto, teclear
el separador daba `1,500.00.`, que se lee como 150.000. **No había forma de llegar a los centavos.**

**Lo que se hizo:** el lector respeta los decimales de la moneda (la tabla de Laura ya los declaraba,
faltaba mirarla); con 0 decimales se **corta** en el separador en vez de concatenar; el campo formatea con
su moneda; y mientras se escribe manda lo tecleado, no el re-pintado.

⚠ **El separador decimal se le pregunta a `Intl`, no se quema:** `es-CO` usa la coma y `es-PE`/`es-DO` el
punto, así que cualquier tabla escrita a mano se equivoca en la mitad de los países.

**Verificado tecleando:** Perú `1500`→`1,500`, `+.75`→`1,500.75` · Colombia `2000000`→`2.000.000`,
`2000000,99`→`2.000.000`. Cierre sin cambio.

⚠ **Método:** este bug **no se veía leyendo ni con una prueba de la función** — el `1500.75` entra y sale
como número; lo que fallaba era la interacción entre el parser, el formateador y el efecto de React que
re-pinta. Sólo aparece tecleando en la pantalla, letra por letra.

<!-- ─────────────────────────────────────────────────────────────────────────────────────────────
     DE ACÁ PARA ABAJO ES LO ÚNICO QUE SALE A JIRA.
     ───────────────────────────────────────────────────────────────────────────────────────────── -->


## Tarea (publicable)

## En una línea
Terminar de sacar los supuestos de Colombia del flujo, para que un país nuevo se pueda operar sin
desarrollo.

## Por qué
La configuración por país ya existe y funciona, pero el flujo todavía no la usa en varios puntos. El
resultado es que un cliente de otro país choca con paredes que nadie ve hasta que las choca: no encuentra
su tipo de documento, no hay ciudades de su país para elegir, y los bancos que se le ofrecen son de otro
lado.

## Qué cambia
Las listas que hoy están escritas en el código —tipos de documento, ciudades, bancos— pasan a leerse de
la configuración del país, igual que ya se hace con el indicativo telefónico y la moneda.

Y el **documento que se le dibuja al solicitante** en el paso de fecha de expedición deja de ser la cédula
colombiana. Antes había dos ilustraciones fijas —la cédula y el permiso de permanencia— y se elegía entre
ellas; ahora hay una sola, que se adapta: muestra la bandera del país del comercio, el gentilicio, el
nombre real del documento que la persona eligió, la entidad que lo expide y su fecha de nacimiento cuando
se le pidió. Lo que no se le pregunta al solicitante y no se puede deducir se marca visiblemente en vez de
inventarse.

## Alcance
El flujo de originación. No entra la mensajería, que tiene su propio camino y es un trabajo aparte, ni la
zona horaria, que necesita un dato que todavía no existe. El documento se ilustra en formato tarjeta: un
pasaporte tiene otra forma y queda para después.

## Dónde probar
**El ambiente `qa`** (originaciones-qa), que es donde está mergeado todo esto. Sirve para los tres países
porque hay comercios de prueba de cada uno; la configuración de países ya quedó cargada y alcanza también
a dev y staging, que comparten la misma base.

⚠ **Producción todavía no tiene nada de esto**, y cuando se despliegue habrá que cargar allá las banderas
aparte: no viajan con el código.

⚠ **El código de verificación por SMS no llega al teléfono en `qa`**: se publica en el canal de mensajería
de pruebas del equipo en Slack, en el hilo del número que se usó.

## Cómo validar
Arrancar una solicitud con un comercio de cada país y llegar hasta el paso de la fecha de expedición:

| país | tipos que debe ofrecer | qué debe decir el documento |
|---|---|---|
| Colombia | C.C. y C.E. | bandera colombiana · «Cédula de ciudadanía» · Registraduría · COLOMBIANA |
| Perú | DNI y C.E. | bandera peruana · «Documento Nacional de Identidad» · RENIEC · PER |
| República Dominicana | Cédula y NUI | bandera dominicana · «Cédula de identidad» · JCE · su gentilicio |

Después, en la misma pantalla: elegir la fecha de expedición y comprobar que **el documento gira solo** y
muestra el reverso con esa fecha resaltada; volver a tocarlo para verlo de frente.

Y el caso que más importa: **cambiar el tipo de documento a cédula de extranjería**. La entidad emisora
tiene que cambiar también —en Colombia pasa a Migración Colombia, en Perú a Migraciones—, porque no la
expide la misma oficina que la de nacionales.

## Criterios de aceptación
Un comercio de un país habilitado completa el alta y una solicitud de punta a punta. Ningún país aparece
escrito en el código de esos pasos. Colombia no cambia de comportamiento.

Sobre el documento: en los tres países se ve la bandera correcta y el nombre correcto del documento; al
cambiar el tipo cambian el nombre y la entidad emisora; ningún dato aparece cortado a media palabra; y
los datos que no se le piden al solicitante se ven marcados como desconocidos, nunca con un valor de
relleno que se pueda confundir con uno real.

## Dependencias / contraparte
Hace falta una definición de negocio: si se puede originar en República Dominicana sin verificación de
identidad de terceros. Hoy se está haciendo, y de eso depende si el trabajo es dejar registro o conseguir
un proveedor.
