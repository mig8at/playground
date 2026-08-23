---
id: 64
title: "Correr varios flujos en paralelo (pullman + motai + smartpay): qué es viable hoy y qué no"
stage: work
created: "2026-08-22T20:00:00-05:00"
context_nodes: [smartpay, motai, creditopx]
jira: []
jira_title: "Harness: correr en paralelo flujos de varios comercios"
---

**ESTADO 2026-08-22.** Medido con `2 pullman + 3 motai + 2 smartpay`. **El listado en paralelo es
viable ya. El cierre en paralelo tiene dos topes**, y uno de ellos es del entorno local, no del código.

## Lo que funciona hoy

    make harness-caso CASOS='pullman;pullman;motai;motai;motai;celurd;celurd' PAR=1 LAMBDA=1

Siete casos, listados completos y correctos por comercio, y la vista de diferencias muestra el catálogo
propio de cada uno. **5,6 s** con el servidor local concurrente; 16 s sin él.

⚠ El comercio de SmartPay en el dump local es **CeluRD Test**, no «smartpay» — la entidad se llama así,
el comercio no.

## Tope 1 · el servidor local atiende UNA petición a la vez

Con `CERRAR=1`, siete cierres en paralelo tardaron **522 s y cuatro se trabaron** con timeout, todas en
estado 28. No es del flujo: el contenedor corre el servidor de desarrollo de PHP, que sin
`PHP_CLI_SERVER_WORKERS` es de un solo proceso. Con diez workers, los mismos siete corrieron en **19 s
sin un solo timeout**.

**Ya está resuelto y no hay que acordarse de nada**: vive en la rama local
`local/ajustes-de-pruebas` de `legacy-backend`, en el propio `docker-compose.yml`, junto al comodín del
OTP. Con esa rama puesta, un `sail up` normal ya levanta el backend concurrente.

    PHP_CLI_SERVER_WORKERS: '${PHP_CLI_SERVER_WORKERS:-20}'

⚠ **Esa rama no se commitea.** Son dos ajustes que sólo tienen sentido en la máquina de uno: la
concurrencia del servidor de desarrollo y el comodín del bypass de OTP. Si alguna vez se quiere
proponer al repo, es otra conversación — y el comodín **no** debería ir (ver su comentario: staging
corre con `APP_ENV=development` y comparte base con dev).

⚠ **No es falta de recursos.** Medido el 2026-08-22: 12 CPUs, 151 conexiones de MySQL libres y el
contenedor al **0,11 % de CPU**. El trabajo estaba serializado, no saturado — por eso la palanca es la
concurrencia del servidor y no darle más máquina.

## Fijar la entidad por caso: `comercio:id`

    make harness-caso CASOS='motai:168;motai:169;motai:170' PAR=1 LAMBDA=1 CERRAR=1

Los tres productos de CreditopX de Motai son **tres entidades**, y el `product` de cada una es lo que
las distingue: `credit`, `renting` y `rto`. Cerrando las tres en paralelo se ve la diferencia que
importa — mismo monto pedido, **el renting cierra con un monto final muy superior** a los otros dos,
que es la calculadora inflando el precio (el mecanismo está explicado en el nodo `motai`).

⚠ **`product = 'rto'` SÍ existe en el dump local** (la entidad Motai RB), pero su calculadora **no
tiene matriz**: ni `plans` ni `terms`. Así que el producto y la matriz son cosas independientes, y la
rama `terms` sigue sin ejercitarse en ningún lado.

## Tope 2 · el teléfono para cerrar tiene que estar LIMPIO — RESUELTO

Este era el que hacía ver el problema como si fuera de negocio. Para firmar el pagaré hace falta un
teléfono de `qa_otp_bypass_phones`, y el runner lo tomaba **por índice, sin mirar si servía**. Un
teléfono cuyo usuario ya tiene un crédito en estado 11 arrastra ese crédito al caso nuevo, y el **cupo
rt=2 se bloquea por entidad**: el listado devuelve las rt=1 y ninguna CreditopX. El síntoma era «la
entidad 169 no salió en el listado», que se lee como una regla y era un teléfono sucio.

⚠ Medido en el dump local: **todos** los teléfonos de la lista tienen usuario —así que el criterio
«sin usuario» no dejaba ninguno— pero **la gran mayoría no tiene crédito activo**, que es la condición
que de verdad importa. Ya está corregido: el filtro es «sin crédito en estado 11».

## Tope 3 · con cierres pesados en paralelo, los rt=2 dejaron de listar un rato

En la corrida de siete cierres, el listado de motai bajó de seis entidades a dos —desaparecieron todos
los CreditopX— y volvió solo en la corrida siguiente. **Transitorio, y no es cupo agotado**: la entidad
sigue teniendo créditos disponibles y el listado se recuperó sin tocar nada. Queda sin diagnosticar; si
vas a correr una tanda grande de cierres, **no leas el listado de esa misma tanda como verdad**.

## Lo que NO cierra por su camino real

- **Motai**: el runner elige el primer rt=2 del listado, que hoy es **Motai RB**, no el Rent to Own. Para
  el RTO hay que pedirlo (`#hash:173`) **y** recorrer el sub-flujo del codeudor, que el runner no
  implementa — la secuencia completa está en `motai-rent-to-own-local.md`.
- **SmartPay**: ya cierra por su camino (`device/register` → `disburse`). ⚠ Hasta hoy el runner llamaba
  al `authorize` estándar y reportaba «cerró en estado 11» **sobre un crédito sin equipo inscrito** — un
  verde falso. Corregido; el detalle de por qué `authorize` lo permite está en **F-157**.

## Suites en JSON: casos que DECLARAN qué esperan

    make harness-suite SUITE=harness/suites/motai-creditopx.json

La cadena `CASOS='pullman:77@score=300'` alcanza para preguntar «¿qué pasa?». No alcanza para **«¿esto
sigue valiendo después de mi cambio?»**, que es la pregunta de después de tocar código. Para eso el
caso tiene que decir qué espera, y eso tiene que vivir en un archivo versionado.

    {
      "nombre": "Motai · los tres productos de CreditopX",
      "requiere": ["cerrar", "lambda", "paralelo"],
      "porDefecto": { "amount": 2000000, "income": 2500000, "score": 700 },
      "casos": [
        { "nombre": "renting — la calculadora infla el precio",
          "comercio": "motai", "lender": 169,
          "espera": { "enListado": true, "cierra": true, "estado": 11 } }
      ]
    }

Cuatro expectativas: `enListado` · `entidades` (subconjunto del listado, no igualdad) · `cierra` ·
`estado`. La corrida **sale con código distinto de cero** si alguna no se cumple, y dice caso por caso
qué esperaba y qué obtuvo.

⚠ **Falla cerrado**: una expectativa que **no se pudo evaluar** cuenta como desvío, no como éxito. Si
un caso declara un cierre y la corrida no cerró, lo dice con esas palabras —«sin eso, esto NO está
verificado»— en vez de pasar en verde. Es la diferencia entre «lo verifiqué» y «no lo verifiqué», y
confundirlas es el verde falso que este harness ya se comió una vez.

⚠ **`requiere` hace que la suite se baste sola.** Sin ese campo, olvidarse de `CERRAR=1` no da un
resultado falso pero sí una corrida perdida de dos minutos. Con él, `make harness-suite SUITE=…` sin
un solo flag corre lo que el archivo necesita — que es lo que hace falta para que alguien (o un LLM)
genere una suite y la corra sin saber cómo se invoca este runner.

⚠ **Flake conocido**: una corrida falló con `DOCUMENT_DUPLICATE "document number already in use"` y la
siguiente pasó sin tocar nada. La cédula se deriva del reloj (`Date.now()`), así que dos tandas muy
juntas pueden pisarse. **No está diagnosticado**; si aparece, repetir.

## Cuántos workers: la regla, medida

`workers >= casos en paralelo`, porque **cada caso tiene UNA petición en vuelo a la vez** (el runner
espera cada paso). Más que eso no acelera nada, y los números lo dicen solos:

| | reloj |
|---|---|
| 1 caso solo | **89,5 s** |
| 8 casos en paralelo | **113,0 s** |

Ocho cuestan **26 % más que uno**. Y muestreando durante la tanda: **22 procesos PHP, ~0,3 de un core
y 12 conexiones de MySQL de las 151** disponibles. La máquina está ociosa — **el piso lo pone la cadena
secuencial de cada caso (~90 s), no el servidor**.

⚠ Corolario: **subir los workers no va a hacer nada** mientras se corran menos casos que workers. Lo
que sí acortaría el reloj es recortar la cadena de cada caso, que es otra conversación.

## Lo que aparece cuando de verdad corre en paralelo

Con 20 workers, **12 casos tardan lo mismo que 7** (~134 s): escala. Pero a esa concurrencia salieron
**tres fallos con `HTTP 500 · PromissoryNote no encontrado`**, y ahí está el valor de correr en
paralelo: son cosas que en serie no se ven.

⚠ **La causa próxima era del runner, no de la aplicación**: llamaba a la generación de documentos sin
mirar la respuesta y seguía derecho al OTP y al `authorize`, así que el fallo reaparecía tres llamadas
después con otro mensaje y en otro componente. Ya corta ahí. **Lo que queda sin diagnosticar** es por
qué el pagaré no estaba visible en ese momento: los casos que fallaron **sí tenían pagaré en la base**
al revisarlos después. La hipótesis es que la generación no había terminado, pero **no está medido**.

## Paralelo Y secuencial: `pasos`, el cliente que vuelve

El modelo es **paralelo entre clientes, secuencial dentro de un cliente**. Un `caso` es una persona;
sus `pasos` son sus solicitudes en orden. Los casos siguen corriendo todos a la vez.

    { "nombre": "cierra y vuelve a pedir", "comercio": "motai",
      "pasos": [
        { "lender": 169, "espera": { "cierra": true, "estado": 11 } },
        { "lender": null, "espera": { "noEntidades": [169] } }
      ] }

Sale casi gratis porque **el teléfono y la cédula se derivan del índice del caso, no de la solicitud**:
correr el mismo índice dos veces es, para el backend, la misma persona pidiendo de nuevo.

Y la expectativa `noEntidades` existe justo para esto: afirmar que una entidad **desapareció** del
listado. Es la forma declarada de lo que descubrimos por accidente con los teléfonos sucios —**un
crédito activo bloquea el cupo rt=2, y el corte es por entidad**—.

**Funciona, y el camino del cliente recurrente hubo que construirlo.** El runner arrancaba cada caso
por el onboarding completo, y en la segunda vuelta el backend contestaba —bien— *«El correo electrónico
ya se encuentra registrado»*: `personal-info` es el paso que CREA la persona. Los pasos posteriores al
primero lo saltean; la solicitud no se pierde, la crea `otp-validate` dos llamadas antes. **Es la
diferencia real entre un cliente nuevo y uno que vuelve, y hasta ahora este harness sólo sabía probar
el primero.**

Medido con la suite `cliente-recurrente.json`: el cliente que cerró un crédito **pierde las CreditopX
en su segunda solicitud**, y el control —un cliente nuevo, mismo comercio, mismo momento— las sigue
viendo. Lo que antes salía como un síntoma raro ahora es una afirmación que se verifica sola.

## ⚠ Una suite que CIERRA degrada el ambiente, y el síntoma parece de negocio

Corriendo la suite varias veces, la entidad 169 **desapareció del listado para todos** — incluido un
cliente nuevo. No era el cupo por usuario: es **`lender_users_categories.already_used_loan`**, el
acumulado del tope de colocación mensual, que **nada reinicia** (es **F-119**). Cada cierre lo
incrementa y la categoría se agota.

⚠ **Y el renting lo agota cuatro veces más rápido**, porque la calculadora infla el monto: cada crédito
consume ~8,3M de tope por 2M pedidos. La cadena entera —calculadora infla → tope se consume → nada
reinicia → la entidad deja de ofrecerse— no se ve en ninguna parte del código.

**En producción no está mordiendo**: ninguna categoría agotada, una sola por encima del 80 %. El que se
degrada es el ambiente de pruebas. Si una entidad «deja de aparecer» después de una tanda de cierres,
mirá `already_used_loan` antes de buscar una regla.

## El codeudor, automatizado — y por qué su suite falla a propósito

El sub-flujo del codeudor era **lo último de rt=2 que pedía manos**: ocho endpoints, dos actores y un
token que no viaja por la respuesta. Ya está en el runner y se dispara solo cuando la política de la
categoría lo exige — se pregunta a la BD, no se deduce del estado (arrancar el flujo «para ver» mandaría
al estado 17 una solicitud que no lo necesita).

**El orden no es negociable:** el codeudor tiene que quedar aprobado y en etapa de firma **antes** de que
el titular firme, porque el juego de documentos depende de la política.

⚠ **Dos cosas que sólo pasan en local, y por eso están en el runner y no en el producto:**
- **El token de invitación no vuelve en la respuesta** — viaja por WhatsApp, que en local no sale. Se
  lee de la tabla.
- **El AML no corre para nadie en local** (cero filas en toda la base), y sin esa fila la elegibilidad
  devuelve `evaluated: false` **para siempre**. Se forja, cifrada como el cast de Laravel.

Y el buró del codeudor se inyecta **apuntando a su usuario**, no derivándolo de la solicitud: comparte
la `user_request` del titular, así que sin eso los datos irían al titular y el codeudor quedaría sin
buró — fallando al **leer** en vez de al decidir (F-153).

**Medido:** el codeudor queda `approved` y en `waiting_applicant_signature` sin intervención. **Lo que
falla es la firma del titular, con HTTP 500 en la generación de documentos: eso es F-150**, el builder
elegido por id quemado. La suite `codeudor.json` **es su prueba de regresión** — falla hoy a propósito y
va a pasar sola el día que se arregle. Antes había que reproducirlo a mano; ahora tarda 12 segundos.

## La bitácora de una corrida, y por qué no alcanzaba con los logs del backend

Cada caso deja ahora un archivo en `harness/.runs/` con **todo lo que hizo el runner**: ruta, método,
status y milisegundos de cada llamada, con la línea de tiempo. Una corrida del codeudor son **26
llamadas**, del registro del teléfono a la firma cruzada — y ahí se ve, por ejemplo, que el verify del
codeudor tarda 8,3 s porque re-renderiza el documento con las dos firmas.

**Por qué hacía falta, si ya existe la forense de Loki.** Son dos mitades distintas y ninguna reemplaza
a la otra:

| | qué contesta | confiabilidad |
|---|---|---|
| **bitácora** (nueva) | qué se le **pidió** al backend | total: la escribimos nosotros, cubre cada llamada |
| **forense de Loki** (ya existía) | qué **decidió** el backend | parcial y con techos declarados |

La forense tiene límites que están escritos en su propio código: sólo ve `legacy-backend`, apenas una
fracción de las líneas trae el `user_request_id`, y **una ausencia tiene cuatro causas
indistinguibles**. Sirve para entender una decisión; no para saber qué se pidió. Y esa mitad —la
nuestra— no quedaba en ningún lado: cuando un caso fallaba, la única forma de ver la secuencia era
**volver a correrlo**, que con 90 s por caso y fallos intermitentes es justo lo que no se puede hacer.

⚠ **Del cuerpo se guarda un extracto, y completo SÓLO cuando la respuesta no fue 2xx** — que es cuando
hace falta. Guardar todos los cuerpos multiplicaría el archivo y metería datos personales en disco sin
necesidad.

⚠ **Los milisegundos son de la LLAMADA, no del backend**: incluyen red y cola. Con un solo worker, un
número alto puede ser espera y no trabajo.

**Y las dos se disparan solas al fallar**: la bitácora siempre, y la forense cuando el caso no pudo
correr **o cuando no cumplió lo que declara** — porque «la entidad no salió en el listado» es el desvío
más común y una regla que excluye una entidad **no mueve ningún estado ni cambia ningún status HTTP**.
La bitácora no puede explicarlo; el log de reglas sí.

## rt=4 (Credifamilia): hasta dónde llega hoy, etapa por etapa

Perseguir el estado 11 con esta entidad destapó que el bloqueo **no era uno sino una fila**, y cada uno
tapaba al siguiente. Estado al 2026-08-23:

| etapa | estado | qué hizo falta |
|---|---|---|
| listar | ✅ | llamar **`lenders-v2`**, no `lenders` — son dos listados distintos (**F-161**) |
| seleccionar | ✅ | — |
| pre-aprobación | ✅ | apuntar `PRE_APPROVALS_BASE_URL` al mock (su default `:8086` no lo atiende nadie) |
| plan de pagos | ✅ | el mock no armaba `transaction_data` para esta entidad — cinco claves exactas |
| documentos legales | ✅ | levantar `mock-pdf-mapper`, **que no lo levanta nadie** |
| **pagaré (Deceval)** | ✅ | `bin/mock-deceval` (:8106) + la credencial del dump local, que trae claves de Experian (**F-163**) |
| **firma (Netco)** | ✅ | `bin/mock-netco` (:8107) + cinco variables de entorno |
| radicación (SOAP) | — | no hizo falta: la solicitud llega a **estado 11** sin pasar por ahí |

⚠ **Cada bloqueo escondía al siguiente**, y ninguno se veía desde afuera: todos llegaban como
`HTTP 500` en la generación de documentos. El código de error real —`CP050` para el plan de pagos—
sólo aparece leyendo el contexto del log, nunca en la respuesta.

⚠ **El número de cuotas no es libre**: pedir uno que la entidad no ofrece corta con el mismo `CP050`,
sin nombrar las cuotas. Medido en producción, Credifamilia va en 24, 36, 48, 12, 6, 18 y 9 — **nunca en
4**, que era el default quemado del runner. Ahora va por caso (`@cuotas=24`).

**ACTUALIZADO 2026-08-23 — rt=4 CIERRA.** Estado 11 con siete documentos firmados. Se construyeron los
dos mocks que faltaban y la radicación SOAP resultó no estar en el camino al 11. La receta completa vive
en el nodo `credifamilia`; los seis muros y sus síntomas, en **F-165**. La tarea propia es la 65.

Y se decidió con los ojos abiertos, que era la duda de arriba: un Deceval y un Netco falsos prueban
**nuestra orquestación**, no la firma — que es precisamente aquello cuyo valor es no poder simularse. Lo
que se ganó es poder recorrer entera la única familia de `response_type` que no se podía recorrer.

### ⚠ Y el paralelo destapó un TOPE 4, que es el hallazgo más caro de esta tarea

La suite de Credifamilia cierra **3/3 en serie** y **1/3 en paralelo**. Los dos que fallan dicen
`There is no active transaction`, que suena a bug del framework y no lo es: la autorización **firma los
seis documentos dentro de una transacción abierta**, o sea sosteniendo locks durante doce viajes de red,
y dos autorizaciones simultáneas se traban en un deadlock. Encima el error se registra como falla de S3
y el mensaje final lo reemplaza por el de la transacción — **tres capas y ninguna nombra la causa**
(**F-166**).

**Hoy no pasa en producción** —medido: cero deadlocks en 24 h, cero solicitudes trabadas—, y lo que lo
tapa es el volumen, no el diseño. Es el primero de los topes del paralelo que **no** es del entorno
local: es del producto.

**El borde exacto, medido:** lo que choca son **dos rt=4 a la vez**, no el paralelo en general —el lock
está en `netco_signing_documents` y sólo Credifamilia firma con Netco—.

    pullman + motai + UNA credifamilia   → 3/3 en estado 11
    ...más una SEGUNDA credifamilia      → cae sólo esa; las otras tres cierran igual

O sea que **la mezcla de comercios sigue siendo libre**: el único cupo es una solicitud de Credifamilia
por corrida paralela.

## Los CINCO response_type corriendo juntos — la prueba de la herramienta (2026-08-23)

Nueve casos, **cuatro comercios y cinco `response_type` en una sola corrida paralela**, en **96,8 s**.
Verificado contra la base, no contra el reporte:

| rt | entidad | comercio | estado | cuotas | radicación |
|---|---|---|---|---|---|
| 0 | Sufi · Crediwonder | Refrigeración Wonder | 3 «Seleccionó entidad» | 6 · 6 | — |
| 1 | Banco de Bogotá · Sistecrédito | Refrigeración Wonder · Prodens | 3 | 3 · 6 | — |
| 2 | CrediPullman | Amoblando Pullman | **11** | 3 | — |
| 2 | Motai C · Motai R | Motai | **11** · **11** | 12 · 24 | — |
| 3 | Dentalpay X Rotativo | Dentalix | 10 «Pendiente de autorización» | 6 | — |
| 4 | Credifamilia | DENTIX | **11** | 24 | **CREDIT_COMPLETED** |

**El plazo pedido aterrizó en los nueve**, cada uno el suyo. Y los rt=0/1 quedando en estado 3 es el
comportamiento **correcto**: deciden afuera.

### Lo que la corrida destapó del propio reporte, y ya está arreglado

- **Contaba a rt=0 y rt=1 entre los que «se trabaron».** No lo están: la decisión la toma una
  redirección o la API del banco, así que la ausencia de `standBy` es lo esperado. Contarlos como fallo
  manda a buscar una causa donde no hay nada roto. Ahora salen aparte: «N deciden afuera (rt=0/1)».
- **El encabezado decía «CIERRE rt=2» siempre**, incluso corriendo rt=3 y rt=4 — un rótulo que
  contradecía a la línea de abajo.

### ⚠ Bancolombia NO estaba cubierto, y la corrida lo hacía parecer que sí

Lo señaló Miguel: Bancolombia **no entra por el onboarding**. La corrida paralela pedía el lender 8 y
devolvía un resultado prolijo — pero ese lender se llama, en producción, **«Bancolombia (No activo)»** y
tiene **cero solicitudes en 90 días**. Los dos productos vivos son el **100** (crédito de consumo, 2.812)
y el **68** (BNPL, 1.687), y **entran por el canal QR de Corbeta**.

Peor: el sufijo «(No activo)» **sólo está en producción**; el dump local guarda «Bancolombia» a secas,
así que la única marca que delataría a la entidad muerta no llega al ambiente donde se prueba (**F-173**).

**Sí está cubierto, con otra herramienta y otro desenlace:** `make harness-qr PRODUCT=bnpl|consumo`
cierra los dos productos en **estado 25 «Pendiente de facturación»** con código de compra —no en 11, que
para este canal no aplica—. Verificado el 2026-08-23. Pide `bin/mock-bancolombia` y `bin/mock-corbeta`.

La lección para el barrido: **un canal que entra por otra puerta no se cubre agregando un caso más**, y
medirlo con la vara del estado 11 da cero por construcción.

### Y un hallazgo del producto: **F-169**

El rotativo (rt=3) muere generando documentos con `Attempt to read property "fga" on null`. Es un
acceso **sin guarda** donde los otros tres lugares que leen lo mismo sí preguntan. Lo dispara un cliente
**sin cupo rotativo previo**. En producción no ocurre —las 122 solicitudes rt=3 de 90 días tenían todas
cupo previo—, pero **por qué** no ocurre no está establecido: en local la entidad **sí aparece** en el
listado de un cliente sin cupo.

## Tarea (publicable)

**En una línea.** Poder ejercitar varios flujos de comercios distintos a la vez, para comparar qué le
ofrece el sistema a cada uno.

**Por qué.** Comparar comercios de a uno esconde las diferencias; verlos juntos las muestra.

**Qué cambia.** La herramienta de pruebas corre los casos en paralelo y cierra cada uno por el camino
que le corresponde a su producto.

**Alcance.** Sólo el entorno de pruebas. No cambia nada del producto.

**Dónde probar.** Local.

**Cómo validar.** Correr varios casos de comercios distintos a la vez y comprobar que cada uno termina
por el camino de su producto, no por uno genérico.

**Criterios de aceptación.** Cada caso reporta el resultado de su propio camino; ninguno se reporta como
exitoso si se salteó un paso obligatorio de su producto.

**Dependencias.** Ninguna.
