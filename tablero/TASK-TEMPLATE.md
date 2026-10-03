---
id: 0
title: ""
stage: evaluation
created: ""
knowledge: []
canon: []
jira: []
jira_title: ""
---

<!--
  PLANTILLA DE TAREA — copiá este archivo a `tasks/<slug>/task.md` y borrá los comentarios.

  Esta plantilla es para una tarea ligada a Jira. Las mejoras locales NO crean archivos desde esta
  plantilla: van a canon.md, context.md, harness.md, tablero.md, trazador.md, workers.md o
  playground.md. El lint rechaza cualquier otro slug sin Jira.

  ⚠ NO vive en `data/`: ahí todo `.md` se lee como una tarea, así que la plantilla aparecería en el
  tablero como una tarea fantasma.

  Protocolo: CLAUDE.md → «Plantilla por vista». El editor junta la cronología y el documento; Jira y
  Pendientes van a la derecha y Ramas a la consola:
    · DOCUMENTO  objetivo, plan, alternativas, límites, material y referencias: lo que sigue siendo cierto.
    · PILA       bloques privados en `tasks/<slug>/context.jsonl` —título y descripción—, agrupados
                 por día: lo que pasó, lo que se midió, se decidió, se preguntó o se arriesgó.
                 Nunca minutos ni notas de sesión.
    · JIRA       issue recibido de Jira. «Tarea (publicable)» es sólo el borrador local.
    · PENDIENTES las casillas de «Pendientes», sin copiarlas a otras secciones.
    · RAMAS      frontmatter `ramas:` + snapshot de `make tareas-ramas N=<id>`.
    · BITÁCORA   tiempo medido con `make bitacora-add TAREA=<id>`; no es una sección de este archivo.

  Reescribí el plan; mantené el material reproducible. Lo que pasa —una medición, una decisión, una
  pregunta, un riesgo, lo que se hizo en el día— entra a la pila como bloque con `make tarea-bloque`;
  no copies sesiones ni logs. El conocimiento técnico reutilizable va a knowledge/ con fuentes verificadas.
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
    knowledge     temas locales, ej [lender-listing] o [lender-listing#ancla]. Retomar los lee sin red
    canon         referencias opcionales o históricas del equipo. BRIEF=1 consulta su API y CANON=1
                  lee la copia local, sólo cuando se eligen. No bloquea la edición de la tarea
    jira          [CORE-123]. Se omite hasta que el issue exista
    jira_title    se llena al publicar; con varios issues se deja en ""
-->

## Pendientes

<!-- Pestaña Pendientes. Cada casilla lleva una acción y su condición de cierre.
     Acá vive la lista completa de lo abierto. No la copies a la pila.
     - [ ] Acción pendiente; termina cuando [resultado verificable].
       Depende de: [nombre] — [dato o respuesta], si aplica.
     - [x] Acción cerrada — [evidencia de la comprobación].
     Una pregunta abierta a alguien es un pendiente con su «Depende de:»: `make hoy` lo muestra como
     «espera a …» y, a diferencia de la vieja anotación PREGUNTA, se cierra tildándolo.
-->

## Objetivo

<!-- Qué tiene que ser CIERTO cuando esto esté hecho. No cómo se logra: eso es «Cómo se ataca». -->

## Dónde se toca

<!-- Repos, módulos y archivos con ruta y línea — acá SÍ se puede, el cuerpo es privado.
     Es lo que ahorra el primer grep a ciegas. Si son muchos, agrupá por repo.
     CON QUÉ SE LLENA: el código de `main` (`git grep` contra la rama, no contra el working tree) y,
     para un mensaje de log, `trazador/logs.json`, que lo lleva al archivo que lo emite. Es la sección que más rinde al retomar y la que menos se escribe (11 de 68): al terminar
     de indagar uno ya lo tiene todo en la cabeza y no parece que haga falta. -->

## Cómo se ataca

<!-- El plan. En pasos que se puedan entregar por separado, porque así se puede parar en el medio. -->

## Lo que se evaluó y NO se eligió

<!-- Un párrafo por camino descartado, con el POR QUÉ. Es la sección que más rinde al retomar: sin
     ella se vuelve a proponer lo que ya se probó y falló. Hoy la tienen 6 de 12 tareas, y cuando
     está se nota. Si un camino se descartó por una medición, la medición va a la pila como bloque. -->

<!-- Lo decidido, lo bloqueado y los riesgos NO tienen sección: son hechos con fecha, y cada uno entra a
     la pila como un bloque —«el filtro va por comercio, no por asesor» como título, y el motivo en la
     descripción—. Hasta el 2026-09-23 eran anotaciones (`> **DECISIÓN · fecha** — …`) en estas
     secciones; el lint ya las frena en el documento. -->

## Lo que NO entra

<!-- El límite explícito. Sin esto la tarea crece sola y nunca cierra. -->

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

<!-- Acá vive lo que se vuelve a usar: la receta de punta a punta (sembrar el caso, correrlo,
     verificar dónde quedó), las consultas, los datos de prueba, el esquema. Es el comando o la
     corrida que DEMUESTRA que funciona, copiable. Es lo privado y detallado; la receta para QA va
     abajo, en la publicable, y en otro idioma.

     CON QUÉ SE LLENA: el harness (`make harness-case` · `harness-listing` · `harness-walk-wizard`) y, si
     la pregunta es de datos, `make tablero-db`. Trazador queda para seguir UNA solicitud y su
     comportamiento, no para SQL. La cita de base contiene sólo el ambiente y la query, sin el nombre
     de la herramienta. Medido:
     el arnés aparece en 33 tareas y sólo 8 lo nombran acá; las otras 25, sueltas en la prosa.

     ⚠ ESTA SECCIÓN NO SE REESCRIBE NI SE APILA: SE MANTIENE. Es la tercera clase de contenido y la
     que no tenía nombre — por eso terminaba creciendo como secciones nuevas arriba, con fecha, hasta
     volver ilegible el archivo. Si la receta cambió, se corrige acá; el bloque que explica el cambio va
     a la pila. Llevá la fecha de la última vez que se comprobó, no una fecha por versión.
     Una MEDICIÓN no va acá: va a la pila como bloque, con el comando y su «Resultado:». Con
     `BLOQUE=<id|slug>`, `harness-case` · `-listing` · `-walk-wizard` · `-suite`, `trazador-*` y
     `tablero-db` lo agregan solos. -->

## Referencias

<!-- Temas de canon, PRs y enlaces útiles para retomar. El conocimiento técnico reutilizable vive en knowledge/;
     acá sólo se enlaza. No copies el historial dentro de esta sección.
     Los temas locales usados van en `knowledge:`; las referencias de Canon elegidas van en `canon:`,
     en el frontmatter, que es lo que el tablero
     lee; acá van los que ayudan a retomar y lo que no es un tema (PRs, un tablero, un documento). -->

<!-- Si una referencia de Canon sirvió para avanzar, citala en el bloque que la usó como
     [texto visible](canon:tema#ancla). El editor la enlaza ahí mismo; no crees una sección ni un
     marcador especial. -->

<!-- LA HISTORIA VA A LA PILA
     Este documento no lleva `## Registro`, anotaciones fechadas, sección de retoma ni marcadores CANON:
     un diario en el Markdown mezcla historia con lo vigente, y hasta el 2026-09-23 eso volvía ilegibles
     las tareas grandes. Esa historia se apila con `make tarea-bloque N=<id|slug> ARCHIVO=<bloque.md>`,
     y el lint frena una nueva en el documento.

     Un bloque es un título —la conclusión, en una línea— y una descripción con lo que la sostiene:
     archivos por repo, canon, y cada comando con su «Resultado:». Ver `docs/task-context-block.example.md`. -->

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
