# tablero/server — el backend del tablero

`cmd/web` (la API de la UI), los comandos de la consola (`tasks`, `today`, `issue-*`, `pulse`, `hooks`…) y
sus paquetes `internal/`. Los clientes de Jira, Slack y la base NO viven acá: son de
`connectors/`, en la raíz de my-tools, porque los usan todas las herramientas.

## Jira y Slack para un agente: `bin/pg`

Hasta el 2026-09-24 había acá dos servidores MCP escritos a mano, `jira-mcp` y `slack-mcp`; los reemplazó
`bin/pg mcp`, que se sacó el 2026-11-18 (casi no se usaba). Hoy un agente usa la consola: `bin/pg jira …`,
`bin/pg slack …`; lo que escribe muestra la vista previa sin `--apply` y el texto pasa por el guard. `bin/pg`
compila el binario si cambió su código y corre desde la raíz, así que encuentra `connectors/.env` desde
donde se lo llame.
Agregar una herramienta es agregar un comando a `cmd/pg/registry.go`: la prueba de ese paquete cruza lo
que el registro declara contra las banderas que el comando acepta.

## La Slack App (una vez)

1. <https://api.slack.com/apps> → **Create New App** → *From scratch*, en el workspace.
2. **OAuth & Permissions → Bot Token Scopes**: `channels:manage` (canales públicos), `groups:write`
   (privados), `chat:write` (mensajes) y `channels:history` (leer #tech-ops desde el trazador).
3. **Install to Workspace** y copiá el **Bot User OAuth Token** (`xoxb-`) a `SLACK_BOT_TOKEN` en
   `connectors/.env`.

⚠ El token de esta máquina no tiene `channels:history` (medido el 2026-09-24: `missing_scope`).
