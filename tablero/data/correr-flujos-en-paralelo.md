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
