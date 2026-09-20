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

  Esta plantilla es para una tarea ligada a Jira. Las mejoras locales NO crean archivos desde esta
  plantilla: van a canon.md, context.md, harness.md, tablero.md, trazador.md, workers.md o
  playground.md. El lint rechaza cualquier otro slug sin Jira.

  ⚠ NO vive en `data/`: ahí todo `.md` se lee como una tarea, así que la plantilla aparecería en el
  tablero como una tarea fantasma.

  Protocolo: CLAUDE.md → «Plantilla por vista». Las siete vistas usan estas fuentes; Trabajo va en el
  editor, Jira/Pendientes/Hallazgos/Registro/Bitácora en pestañas laterales y Ramas en la consola:
    · TRABAJO    retoma, objetivo, plan, alternativas, límites, material y referencias.
    · JIRA       issue recibido de Jira. «Tarea (publicable)» es sólo el borrador local.
    · PENDIENTES las casillas de «Pendientes», sin copiarlas a otras secciones.
    · HALLAZGOS  las anotaciones fechadas en decisiones, bloqueos, riesgos y validación.
    · RAMAS      frontmatter `ramas:` + snapshot de `make tareas-ramas N=<id>`.
    · REGISTRO   la sección «Registro» de este archivo — ya NO se muestra dentro de Trabajo.
    · BITÁCORA   tiempo medido con `make bitacora-add TAREA=<id>`; no es una sección de este archivo.

  Reescribí el estado y el plan; mantené el material reproducible. Los hechos de cada día se agregan
  al Registro (lo nuevo arriba, sin editar lo viejo). El conocimiento estable gradúa a context/.
  No crees seis copias del contenido ni encabezados con los contadores de la interfaz.
-->
<!--
  El frontmatter va SIN comentarios en la línea: el parser toma todo lo que sigue a los dos puntos y
  no los quita, así que un `# nota` al lado quedaría DENTRO del valor. La guía de cada campo:

    id            lo reasigna el tablero al cargar (de verdad, desde 2026-08-27) — poné 0
    title         el NOMBRE COMPARTIDO con Jira. Corto y concreto: apuntá a ≤56 caracteres
    ramas         patrón de rama, o varios por coma. Se omite hasta que la rama exista
    stage         evaluation → work → tasks
    created       ISO-8601 con offset, ej "2026-08-20T09:00:00-05:00"
    context_nodes los nodos de context/ que hay que leer ANTES de investigar. ⚠ ACÁ, no en la prosa:
                  es lo que el tablero lee. Medido: 28 de 68 tareas lo dejan vacío mientras 43
                  nombran context en el texto — o sea, donde no se puede recuperar
    jira          [CORE-123]. Se omite hasta que el issue exista
    jira_title    se llena al publicar; con varios issues se deja en ""
-->

## Si retomás esto sin contexto, empezá acá

<!-- ESTA sección se REESCRIBE cada vez que se trabaja. Es la más importante del archivo y la única
     que alguien lee obligatoriamente. Cuatro cosas, en 5-8 líneas:
       · Qué se busca: una frase.
       · Estado real: qué funciona y qué falta para avanzar.
       · Ya comprobado: qué NO hay que volver a investigar.
       · Validación: con qué se comprueba que sigue andando.
     Podés señalar un bloqueo; su hallazgo y la lista completa de pendientes viven una sola vez. -->

**El próximo paso es:** <!-- UNA acción concreta, no una lista. Si hay tres, elegí la primera. -->

## Pendientes

<!-- Pestaña Pendientes. Cada casilla lleva una acción y su condición de cierre.
     El próximo paso de arriba elige UNA; acá vive la lista completa. No la copies al Registro.
     - [ ] Acción pendiente; termina cuando [resultado verificable].
       Depende de: [nombre] — [dato o respuesta], si aplica.
     - [x] Acción cerrada — [evidencia de la comprobación].
-->

## Objetivo

<!-- Qué tiene que ser CIERTO cuando esto esté hecho. No cómo se logra: eso es «Cómo se ataca». -->

## Dónde se toca

<!-- Repos, módulos y archivos con ruta y línea — acá SÍ se puede, el cuerpo es privado.
     Es lo que ahorra el primer grep a ciegas. Si son muchos, agrupá por repo.
     CON QUÉ SE LLENA: `workers/cli.py buscar "…"` describe en palabras y devuelve archivos con su
     porqué. Es la sección que más rinde al retomar y la que menos se escribe (11 de 68): al terminar
     de indagar uno ya lo tiene todo en la cabeza y no parece que haga falta. -->

## Cómo se ataca

<!-- El plan. En pasos que se puedan entregar por separado, porque así se puede parar en el medio. -->

## Lo que se evaluó y NO se eligió

<!-- Un párrafo por camino descartado, con el POR QUÉ. Es la sección que más rinde al retomar: sin
     ella se vuelve a proponer lo que ya se probó y falló. Hoy la tienen 6 de 12 tareas, y cuando
     está se nota. Si un camino se descartó por una medición, la medición va como anotación. -->

## Lo que está decidido

<!-- Pestaña Hallazgos: una anotación por decisión, con fecha real y el motivo. No la dupliques
     como prosa en Trabajo. Los ejemplos de fecha y contenido deben reemplazarse.
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

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

<!-- Acá vive lo que se vuelve a usar: la receta de punta a punta (sembrar el caso, correrlo,
     verificar dónde quedó), las consultas, los datos de prueba, el esquema. Es el comando o la
     corrida que DEMUESTRA que funciona, copiable. Es lo privado y detallado; la receta para QA va
     abajo, en la publicable, y en otro idioma.

     CON QUÉ SE LLENA: el harness (`make harness-caso` · `harness-listado` · `harness-caminar`) y, si
     la pregunta es «¿pasa de verdad, y cuánto?», `make trazador-sql`. ⚠ VA EL COMANDO, NO LA
     CONCLUSIÓN: de las líneas de cita que siguen a una anotación el tablero deriva con qué se
     comprobó y contra qué ambiente, y el ambiente lo reconoce SÓLO por un `TARGET=` escrito. Medido:
     el arnés aparece en 33 tareas y sólo 8 lo nombran acá; las otras 25, sueltas en la prosa.

     ⚠ ESTA SECCIÓN NO SE REESCRIBE NI SE APILA: SE MANTIENE. Es la tercera clase de contenido y la
     que no tenía nombre — por eso terminaba creciendo como secciones nuevas arriba, con fecha, hasta
     volver ilegible el archivo. Si la receta cambió, se corrige acá; lo que pasó ese día va al
     Registro. Llevá la fecha de la última vez que se comprobó, no una fecha por versión.
     Las mediciones van como anotación, con su `Como` — y el trazador la emite ya escrita con `MD=1`
     (`trazador-ureq` · `-buscar` · `-sql`), con la fecha real y el comando adentro:
> **MEDICIÓN · 2026-08-20** — 86,6% de las consultas no pasa por el contador.
> `make trazador-sql TARGET=prod SQL='SELECT count(*) FROM kyc_name_checks WHERE ...'`
-->

## Referencias

<!-- Nodos de contexto, PRs y enlaces útiles para retomar. El conocimiento estable vive en context/;
     acá sólo se enlaza. No copies el historial dentro de esta sección.
     ⚠ La llena 1 de 68 tareas, así que si está vacía no es que sobre: es que se olvida. Los nodos que
     de verdad hay que leer van igual en `context_nodes:` del frontmatter, que es lo que el tablero
     lee; acá van los que ayudan a retomar y lo que no es un nodo (PRs, un tablero, un documento). -->

## Registro

<!-- APPEND-ONLY y lo NUEVO ARRIBA. Un encabezado por día trabajado. Nunca se edita una entrada
     vieja: si algo dejó de ser cierto, se reescribe la sección de arriba y acá queda por qué cambió.

     ⚠ Las tareas viejas llaman a esto `## Bitácora`. Es lo mismo, pero el nombre choca: «bitácora»
     en el tablero es el registro de TIEMPO (`data/entries/`, el botón Bitácora de la card, lo que
     sube al worklog de Jira). Esto es el registro de QUÉ PASÓ. Para tareas nuevas: «Registro». -->

<!-- Formato de entrada (reemplazá la fecha y el contenido):
### YYYY-MM-DD
Qué se hizo → evidencia de la ejecución → conclusión.
-->

<!-- ─────────────────────────────────────────────────────────────────────────────────────────────
     DE ACÁ PARA ABAJO ES LO ÚNICO QUE SALE A JIRA. Pasa el guard (ni repos, ni rutas, ni F-xx) y
     cambia de idioma: producto y QA, no implementación. Es un BORRADOR: editarlo no publica nada
     ni cambia lo que muestra la pestaña Jira. En clase: proyecto, eliminá toda esta parte publicable.
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

## Cambios en datos
<!-- Lo que hay que correr o sembrar fuera del código, dicho en general: migraciones, backfill, filas
     de configuración, consultas para verificar. Es lo que QA y quien despliega necesitan y lo que más
     se olvida — mergear NO aplica migraciones en ningún ambiente. Va el QUÉ, no con qué herramienta:
     «se corrió la migración y un backfill de 1.200 filas», no el comando con el que se corrió.
     Si la tarea no toca datos, borrá esta sección. -->

## Criterios de aceptación
<!-- Cómo se sabe que pasó. Verificable, no opinable. -->

## Dependencias / contraparte
<!-- Qué falta de afuera y de quién. -->
