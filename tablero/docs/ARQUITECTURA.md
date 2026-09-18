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

1. Abrir **En foco hoy**: bloqueos, preguntas vencidas, tareas dormidas y próximo paso.
2. Elegir **Retomar**: la portada de la tarea aparece antes del documento completo y enlaza sus nodos
   de `context/`.
3. Consultar Ramas, Bitácora, Hallazgos o Pendientes sólo cuando haga falta.
4. Al cerrar, reescribir la retoma y el próximo paso; el Registro conserva la historia.

## Código

- `src/App.vue`: interfaz y paneles de consulta.
- `server/internal/store`: archivos, parsers y persistencia local.
- `server/cmd/hoy`: agenda y retoma para consola.
- `server/cmd/web`: API HTTP/WebSocket e integración con Jira y Slack.
- `server/cmd/{jira-mcp,slack-mcp}`: conectores MCP por stdio.

Para las reglas de edición de tareas, leer `../CLAUDE.md`; para los comandos, `../README.md`.
