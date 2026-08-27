---
id: 0
title: ""
stage: evaluation
created: ""
context_nodes: []
jira: []
jira_title: ""
---

<!--
  PLANTILLA DE TAREA — copiá este archivo a `data/<slug>.md` y borrá los comentarios.

  ⚠ NO vive en `data/`: ahí todo `.md` se lee como una tarea, así que la plantilla aparecería en el
  tablero como una tarea fantasma.

  Para qué existe esta forma: para que RETOMAR una tarea en frío sea rápido. La medición que la
  justifica (2026-08-19, sobre las 41 tareas del tablero) es que las dos más grandes —130 KB con 60
  secciones y 84 KB con 55— son ilegibles no por largas, sino porque MEZCLAN el estado actual con el
  registro cronológico: cada día se apiló una sección nueva y ya no se sabe qué sigue vigente.

  De ahí la única regla estructural: hay DOS clases de contenido y no se tocan entre sí.
    · ESTADO ACTUAL (todo hasta «Registro») — se REESCRIBE. Siempre dice lo de HOY.
    · REGISTRO (al final)                   — se APILA. Nunca se edita lo viejo.

  El orden de las secciones no es estético: es el orden en que las necesita alguien que llega sin
  contexto. Por eso lo primero es dónde pararse, y lo último es la historia.
-->
<!--
  El frontmatter va SIN comentarios en la línea: el parser toma todo lo que sigue a los dos puntos y
  no los quita, así que un `# nota` al lado quedaría DENTRO del valor. La guía de cada campo:

    id            lo reasigna el tablero al cargar (de verdad, desde 2026-08-27) — poné 0
    title         el NOMBRE COMPARTIDO con Jira. Corto y concreto: apuntá a ≤56 caracteres
    ramas         patrón de rama, o varios por coma. Se omite hasta que la rama exista
    stage         evaluation → work → tasks
    created       ISO-8601 con offset, ej "2026-08-20T09:00:00-05:00"
    context_nodes los nodos de context/ que hay que leer ANTES de investigar
    jira          [CORE-123]. Se omite hasta que el issue exista
    jira_title    se llena al publicar; con varios issues se deja en ""
-->

## Si retomás esto sin contexto, empezá acá

<!-- ESTA sección se REESCRIBE cada vez que se trabaja. Es la más importante del archivo y la única
     que alguien lee obligatoriamente. Cuatro cosas, en 5-8 líneas:
       · qué es esto, en una frase
       · en qué estado está de verdad (no el de Jira)
       · qué NO hay que volver a investigar, porque ya se hizo
       · con qué se comprueba que sigue andando -->

**El próximo paso es:** <!-- UNA acción concreta, no una lista. Si hay tres, elegí la primera. -->

## Objetivo

<!-- Qué tiene que ser CIERTO cuando esto esté hecho. No cómo se logra: eso es «Cómo se ataca». -->

## Dónde se toca

<!-- Repos, módulos y archivos con ruta y línea — acá SÍ se puede, el cuerpo es privado.
     Es lo que ahorra el primer grep a ciegas. Si son muchos, agrupá por repo. -->

## Cómo se ataca

<!-- El plan. En pasos que se puedan entregar por separado, porque así se puede parar en el medio. -->

## Lo que se evaluó y NO se eligió

<!-- Un párrafo por camino descartado, con el POR QUÉ. Es la sección que más rinde al retomar: sin
     ella se vuelve a proponer lo que ya se probó y falló. Hoy la tienen 6 de 12 tareas, y cuando
     está se nota. Si un camino se descartó por una medición, la medición va como anotación. -->

## Lo que está decidido

<!-- Como ANOTACIONES, no como prosa: llevan fecha, salen en la card y se pueden ver envejecer.
> **DECISIÓN · 2026-08-20** — el filtro va por comercio, no por asesor.
-->

## Lo que está bloqueado

<!-- Una pregunta abierta necesita fecha Y de quién se espera la respuesta: a los 7 días la card la
     marca vencida, que es el punto.
> **PREGUNTA · 2026-08-20 · Joel** — ¿el proveedor nuevo entra este sprint?
-->

## Riesgos

<!--
> **RIESGO · 2026-08-20** — si esto mergea antes del otro PR, el harness se rompe.
-->

## Lo que NO entra

<!-- El límite explícito. Sin esto la tarea crece sola y nunca cierra. -->

## Cómo se comprueba

<!-- El comando o la corrida que DEMUESTRA que funciona, copiable. Es lo privado y detallado; la
     receta para QA va abajo, en la publicable, y en otro idioma.
     Las mediciones van como anotación, con su `Como`:
> **MEDICIÓN · 2026-08-20** — 86,6% de las consultas no pasa por el contador.
> `SELECT count(*) FROM kyc_name_checks WHERE ...`
-->

## Registro

<!-- APPEND-ONLY y lo NUEVO ARRIBA. Un encabezado por día trabajado. Nunca se edita una entrada
     vieja: si algo dejó de ser cierto, se reescribe la sección de arriba y acá queda por qué cambió.

     ⚠ Las tareas viejas llaman a esto `## Bitácora`. Es lo mismo, pero el nombre choca: «bitácora»
     en el tablero es el registro de TIEMPO (`data/entries/`, el botón Bitácora de la card, lo que
     sube al worklog de Jira). Esto es el registro de QUÉ PASÓ. Para tareas nuevas: «Registro». -->

### 2026-08-20

<!-- ─────────────────────────────────────────────────────────────────────────────────────────────
     DE ACÁ PARA ABAJO ES LO ÚNICO QUE SALE A JIRA. Pasa el guard (ni repos, ni rutas, ni F-xx) y
     cambia de idioma: producto y QA, no implementación.
     ───────────────────────────────────────────────────────────────────────────────────────────── -->

## Tarea (publicable)

## En una línea
<!-- Qué se logra. Una oración, en lenguaje de negocio. -->

## Por qué
<!-- El motivo. Qué duele hoy. -->

## Qué cambia
<!-- El cambio que se VE. Pantallas, campos, comportamiento. -->

## Alcance
<!-- Qué NO entra, dicho para producto. -->

## Dónde probar
<!-- Ambiente, comercio, entidad, usuario de prueba. -->

## Cómo validar
<!-- Los pasos, con los datos concretos. Si QA tiene que preguntar algo, falta acá. -->

## Criterios de aceptación
<!-- Cómo se sabe que pasó. Verificable, no opinable. -->

## Dependencias / contraparte
<!-- Qué falta de afuera y de quién. -->
