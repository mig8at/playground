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

**El próximo paso es:** el catálogo de tipos de documento del formulario dinámico
(§«Lo que bloquea a Perú», punto 1). Bloquea a BCP en la primera pantalla y es una lista de cuatro
valores en un archivo.

## Objetivo

Que un comercio de un país nuevo se pueda dar de alta y originar de punta a punta **sin tocar código**.
Hoy la configuración existe pero el flujo no la consume: el país llega hasta las pantallas y casi nadie
lo lee.

## Dónde se toca

| | |
|---|---|
| `frontend-monorepo` | `modules/loan-request-wizard/dynamic-form/src/lib/utils/dynamic-step-one.ts` — el catálogo de documentos del flujo dinámico |
| `legacy-backend` | `Modules/Onboarding/App/Services/RegisterCellPhoneService.php:18` — el `'CC'` del alta |
| `legacy-backend` · `legacy-application` | `app/Http/Controllers/Customer/TwilioController.php` — **duplicado**, recorta a 10 dígitos y pega `whatsapp:+57` |
| `legacy-backend` | `PayloadFormatters::currency()` — castea a `(int)` y quema separadores colombianos |
| ambos | cuatro resolvedores distintos de «sucursal → país» (ver §«Lo que borra proceso») |
| BD | `banks` (sin `country_id`) · `country_cities` (sólo Colombia) · `countries` (sin zona horaria) |

## Cómo se ataca

**1 · El catálogo del formulario dinámico.** Que las opciones y su validación salgan de
`allowed_document_types`, igual que ya se hizo en el clásico. Es el mismo arreglo, en el otro flujo.

**2 · Desplegar a producción lo que ya está mergeado.** Nada de esto sirve mientras prod no tenga las
columnas. Ver la medición de abajo: allá sólo existe `lenders_by_allied_branches.document_types`.

**3 · Las ciudades de Perú y de República Dominicana.** Es sourcing de datos; el molde de la migración de
RD ya está probado.

**4 · Un solo resolvedor de «sucursal → país»**, y elegir entre `phone_code` y `dial_code`.

**5 · `banks.country_id`.** Es de los pocos casos donde hace falta una columna nueva: no se deriva de nada.

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
