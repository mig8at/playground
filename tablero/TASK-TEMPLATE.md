---
id: 0
title: ""
stage: evaluation
created: ""
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
    · TRABAJO    retoma, objetivo, plan, alternativas, límites, material y referencias.
    · JIRA       issue recibido de Jira. «Tarea (publicable)» es sólo el borrador local.
    · PENDIENTES las casillas de «Pendientes», sin copiarlas a otras secciones.
    · HALLAZGOS  las anotaciones fechadas en decisiones, bloqueos, riesgos y validación.
    · RAMAS      frontmatter `ramas:` + snapshot de `make tareas-ramas N=<id>`.
    · CONTEXTO   bloques privados en `tasks/<slug>/context.jsonl` —título y descripción—, agrupados
                 por día. Nunca minutos ni notas de sesión.
    · BITÁCORA   tiempo medido con `make bitacora-add TAREA=<id>`; no es una sección de este archivo.

  Reescribí el estado y el plan; mantené el material reproducible. Los hechos que cambian una retoma
  se agregan como bloques en `tasks/<slug>/context.jsonl` con `make tarea-bloque`;
  no copies sesiones ni logs. El conocimiento estable gradúa a canon.
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
    canon         las referencias de Canon que se usaron o hay que leer antes de investigar. ⚠ ACÁ,
                  no en la prosa: es lo que el tablero lista y lo que `make retomar BRIEF=1`
                  convierte en ficha. Acepta `tema` (abre `tema/context`) o, mejor, una sección
                  exacta como `tema/context#ancla`; Tablero las resuelve por CANON_URL y valida que
                  existan. No copies el contenido de Canon dentro de la tarea.
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
     El próximo paso de arriba elige UNA; acá vive la lista completa. No la copies al contexto JSONL.
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
     la pregunta es de datos, `make tablero-db`. Trazador queda para seguir UNA solicitud y su
     comportamiento, no para SQL. La cita de base contiene sólo el ambiente y la query, sin el nombre
     de la herramienta. Medido:
     el arnés aparece en 33 tareas y sólo 8 lo nombran acá; las otras 25, sueltas en la prosa.

     ⚠ ESTA SECCIÓN NO SE REESCRIBE NI SE APILA: SE MANTIENE. Es la tercera clase de contenido y la
     que no tenía nombre — por eso terminaba creciendo como secciones nuevas arriba, con fecha, hasta
     volver ilegible el archivo. Si la receta cambió, se corrige acá; el hito que explica el cambio va
     al contexto JSONL. Llevá la fecha de la última vez que se comprobó, no una fecha por versión.
     Las mediciones van como anotación, con su `Como`. `make tablero-db … MD=1` emite la cita limpia:
> **MEDICIÓN · 2026-08-20** — 86,6% de las consultas no pasa por el contador.
> **DB · prod**
>
> ```sql
> SELECT count(*) FROM kyc_name_checks WHERE ...
> ```
-->

## Referencias

<!-- Temas de canon, PRs y enlaces útiles para retomar. El conocimiento estable vive en canon/;
     acá sólo se enlaza. No copies el historial dentro de esta sección.
     ⚠ La llena 1 de 68 tareas, así que si está vacía no es que sobre: es que se olvida. Los nodos que
     de verdad hay que leer van igual en `canon:` del frontmatter, que es lo que el tablero
     lee; acá van los que ayudan a retomar y lo que no es un tema (PRs, un tablero, un documento). -->

<!-- Si una referencia de Canon sirvió para avanzar, citala en el bloque que la usó como
     [texto visible](canon:tema#ancla). El editor la enlaza ahí mismo; no crees una sección ni un
     marcador especial. -->

<!-- CONTEXTO DE RETOMA
     Para tareas nuevas NO agregues `## Registro`: un diario Markdown mezcla historia con el documento
     vigente. Usá `make tarea-bloque N=<id|slug> ARCHIVO=<bloque.md>`.

     Un bloque es un título —la conclusión, en una línea— y una descripción con lo que la sostiene:
     archivos por repo, canon, y cada comando con su «Resultado:». Ver `docs/task-context-block.example.md`.

     Las tareas existentes pueden conservar su `## Registro`/`## Bitácora` en el archivo, pero no se
     muestra en el editor. No lo migres en masa. -->

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
