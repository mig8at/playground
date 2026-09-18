# Arquitectura del tablero

El tablero tiene dos entradas para el mismo trabajo:

| Necesidad | Puerta | Fuente de verdad |
|---|---|---|
| Decidir qué mover hoy | interfaz Vue | archivos en `data/` + estado actual de Jira |
| Retomar una tarea o automatizarla | `make hoy` / `make retomar` | el mismo Markdown en `data/` |
| Compartir trabajo con el equipo | Jira | sólo `jira_title` y `## Tarea (publicable)` |
| Entender el sistema estable | `../context/` | nodos curados contra `main` |

## Datos y fronteras

Una tarea es `data/<slug>.md`. El cuerpo privado contiene la retoma, el próximo paso, decisiones,
material de reproducción y registro. La sección publicable es la única que puede salir a Jira y el
guard la valida antes de escribir. La bitácora vive por mes en `data/entries/*.jsonl`; los snapshots
de Jira y ramas se pueden regenerar.

La interfaz y la consola derivan del mismo cuerpo `Retoma`, `ProximoPaso`, anotaciones y pendientes.
No existe una segunda copia editable de esos datos.

## Recorrido diario

1. Abrir **Mis tareas**, agrupadas por estado, con Terminadas plegado inicialmente. Los filtros y
   la búsqueda se aplican antes de agrupar; buscar muestra también coincidencias en grupos plegados.
2. Elegir **Retomar**: un panel único muestra la tarea, con pestañas de Resumen, Jira, Pendientes, Hallazgos,
   Ramas, Bitácora y, cuando existen, Prototipos.
3. El Resumen muestra una sola retoma y pliega el historial al final. Las listas de pendientes se
   proyectan con sus notas en Pendientes; los marcadores de anotación se consultan en Hallazgos.
   El índice abre la sección histórica al seleccionarla. El archivo original y los copiados conservan su orden.
4. Al cerrar, reescribir la retoma y el próximo paso; el Registro conserva la historia.

La preferencia de jornada plegada y el ancho del panel viven en `localStorage` bajo `tablero:`.
Si el almacenamiento está bloqueado, la interfaz sigue funcionando durante la visita. Los filtros
de estado y los grupos plegados se reinician al recargar para hacer visible el trabajo disponible.

## Código

- `src/App.vue`: interfaz y paneles de consulta.
- `src/TaskPanel.vue`: panel común, pestañas, foco de teclado y redimensionamiento persistente.
- `src/task-document.js`: organiza tokens Markdown sin confundir títulos de código o citas con secciones.
- `src/jira-preview.js`: presenta `DescriptionHTML` o `Description` del issue; nunca usa el borrador privado.
- `src/ui-state.js`: preferencias, límites de ancho y agrupación por estado.
- `server/internal/store`: archivos, parsers y persistencia local.
- `server/cmd/hoy`: agenda y retoma para consola.
- `server/cmd/web`: API HTTP/WebSocket e integración con Jira y Slack.
- `server/cmd/{jira-mcp,slack-mcp}`: conectores MCP por stdio.

Para las reglas de edición de tareas, leer `../CLAUDE.md`; para los comandos, `../README.md`.
