---
id: 0
title: "Lo que queda de país quemado, después de la tanda de internacionalización"
stage: evaluation
created: "2026-08-27T09:00:00-05:00"
context_nodes: [architecture, onboarding, kyc, entities, merchants]
jira: []
jira_title: ""
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

**El próximo paso es:** desplegar a producción lo que ya está mergeado (punto 2 de §«Cómo se ataca»).

⚠ **Y antes de tocar el «formulario dinámico», leé §«Tres cosas se llaman formulario dinámico».** El
censo original las confundía y de ahí salió una prioridad equivocada.

## Objetivo

Que un comercio de un país nuevo se pueda dar de alta y originar de punta a punta **sin tocar código**.
Hoy la configuración existe pero el flujo no la consume: el país llega hasta las pantallas y casi nadie
lo lee.

## Dónde se toca

| | |
|---|---|
| `frontend-monorepo` | ~~`modules/loan-request-wizard/dynamic-form/src/lib/utils/dynamic-step-one.ts`~~ — hecho |
| `legacy-backend` | `Modules/Onboarding/App/Services/RegisterCellPhoneService.php:18` — el `'CC'` del alta |
| `legacy-backend` · `legacy-application` | `app/Http/Controllers/Customer/TwilioController.php` — **duplicado**, recorta a 10 dígitos y pega `whatsapp:+57` |
| `legacy-backend` | `PayloadFormatters::currency()` — castea a `(int)` y quema separadores colombianos |
| ambos | cuatro resolvedores distintos de «sucursal → país» (ver §«Lo que borra proceso») |
| BD | `banks` (sin `country_id`) · `country_cities` (sólo Colombia) · `countries` (sin zona horaria) |

## Cómo se ataca

**1 · El catálogo del formulario dinámico.** ✅ **HECHO** el 2026-08-27, dentro del PR del front. Las
opciones ya salían del backend; lo que bloqueaba era la **validación**. Detalle en el registro.

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

## Alcance
El flujo de originación. No entra la mensajería, que tiene su propio camino y es un trabajo aparte, ni la
zona horaria, que necesita un dato que todavía no existe.

## Dónde probar
Local y dev, con un comercio de cada país.

## Cómo validar
Dar de alta un comercio de un país distinto de Colombia y llegar hasta la elección de entidad: tiene que
poder elegir su ciudad, su tipo de documento y ver su moneda, sin que nadie toque código.

## Criterios de aceptación
Un comercio de un país habilitado completa el alta y una solicitud de punta a punta. Ningún país aparece
escrito en el código de esos pasos. Colombia no cambia de comportamiento.

## Dependencias / contraparte
Hace falta una definición de negocio: si se puede originar en República Dominicana sin verificación de
identidad de terceros. Hoy se está haciendo, y de eso depende si el trabajo es dejar registro o conseguir
un proveedor.
