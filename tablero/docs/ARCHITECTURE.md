# Arquitectura del tablero

El tablero tiene dos entradas para el mismo trabajo:

| Necesidad | Puerta | Fuente de verdad |
|---|---|---|
| Decidir qué mover hoy | interfaz Vue | las carpetas de `tasks/` + estado actual de Jira |
| Retomar una tarea o automatizarla | `make hoy` / `make retomar` | la misma carpeta en `tasks/` |
| Compartir trabajo con el equipo | Jira | sólo `jira_title` y `## Tarea (publicable)` |
| Entender el sistema estable | **canon** (`github/playground/tools/canon`) | temas curados contra `main`, compartidos con el equipo |

## Datos y fronteras

Una tarea es una carpeta, `tasks/<slug>/`: su documento `task.md`, su pila de bloques `context.jsonl` y
sus `artifacts/`. El cuerpo privado del documento contiene lo que sigue siendo cierto —objetivo, plan,
alternativas, material de reproducción, pendientes—; lo que pasó, se midió o se decidió son bloques de
la pila. La sección publicable es la única que puede salir a Jira y el guard la valida antes de escribir. La bitácora vive por mes en `data/entries/*.jsonl`; los snapshots
de Jira y ramas se pueden regenerar.

La interfaz y la consola derivan de los mismos archivos: la pila para la cronología, el cuerpo para los
pendientes y el documento. No existe una segunda copia editable de esos datos. *(Hasta el 2026-09-23 el
cuerpo traía además la retoma, el próximo paso, las anotaciones y el Registro, y la interfaz los
derivaba; ese día la historia pasó a la pila.)*

## Recorrido diario

1. Abrir **Mis tareas**, agrupadas por estado, con Terminadas plegado inicialmente. Los filtros y
   la búsqueda se aplican antes de agrupar; buscar muestra también coincidencias en grupos plegados.
2. Abrir una tarea: el centro es su cronología —Hoy, Ayer y después cada fecha, con los bloques de
   `context.jsonl`—, seguida del documento de trabajo. A la derecha, tres
   pestañas de consulta: **Jira**, **Pendientes** y **Artifacts**; abajo, la consola de **Ramas**.
3. El avance de pendientes del encabezado abre Pendientes aunque la región esté plegada (en una ventana
   de ≤1050px arranca así). Las listas de pendientes se proyectan con sus notas.
4. Al cerrar, un bloque del día en la pila (`make tarea-bloque`), la bitácora con minutos medidos y
   `ramas:` si hubo código: `make cierre` dice qué falta.

La jornada plegada, el ancho de los DOS sidebars y si la ficha se ve viven en `localStorage`
bajo `tablero:`.
Si el almacenamiento está bloqueado, la interfaz sigue funcionando durante la visita. Los filtros
de estado y los grupos plegados se reinician al recargar para hacer visible el trabajo disponible.

## Código

- `src/App.vue`: el workbench — árbol de tareas, editor y acordeón del detalle.
- `src/{tema,taller}.css`: **compartidos e idénticos** con las otras tres herramientas; se
  verifican con `make estilo-check`. El color y las regiones, respectivamente.
- `src/TaskEditor.vue`: la tarea en el editor — encabezado y documento. (Fue `TaskPanel.vue`,
  un cajón con pestañas, hasta el 2026-09-18.)
- `src/RegionMenu.vue`: el menú `⋯` del encabezado de una región.
- `src/task-document.js`: organiza tokens Markdown sin confundir títulos de código o citas con secciones.
- `src/jira-preview.js`: presenta `DescriptionHTML` o `Description` del issue; nunca usa el borrador privado.
- `src/ui-state.js`: preferencias, límites de ancho y agrupación por estado.
- `server/internal/store`: archivos, parsers y persistencia local.
- `server/cmd/today`: la agenda (`make hoy`) y retomar una tarea (`make retomar`), para consola.
- `server/cmd/web`: la API HTTP que lee la UI, e integración con Jira y Slack.
- `server/cmd/{jira-mcp,slack-mcp}`: conectores MCP por stdio.

Para las reglas de edición de tareas, leer `../CLAUDE.md`; para los comandos, `../README.md`.
