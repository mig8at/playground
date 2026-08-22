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

Se activa con un `docker-compose.override.yml` en la raíz de `legacy-backend` (no está versionado ni
gitignoreado — por eso acá va la receta y no el archivo):

    services:
        laravel.test:
            environment:
                PHP_CLI_SERVER_WORKERS: '10'

…y `docker compose up -d laravel.test`. ⚠ **Borralo cuando termines**: deja un archivo suelto en el
repo de la compañía, que es fácil de commitear sin querer.

## Tope 2 · con cierres pesados en paralelo, los rt=2 dejaron de listar un rato

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
