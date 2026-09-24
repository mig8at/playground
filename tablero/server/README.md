# tablero/server — el backend del tablero

`cmd/web` (la API de la UI), los comandos de la consola (`tasks`, `today`, `issue-*`, `pulse`, `hooks`…) y
sus paquetes `internal/`. Los clientes de Jira, Slack, canon y la base NO viven acá: son de
`connectors/`, en la raíz del playground, porque los usan todas las herramientas.

## Jira y Slack para un agente: `bin/pg mcp`

Hasta el 2026-09-24 había acá dos servidores MCP escritos a mano, `jira-mcp` y `slack-mcp`. Se
reemplazaron por UNO, `bin/pg mcp`, cuyas herramientas son los comandos de `pg` —los de Jira y Slack y
también la base, Loki, PostHog y Confluence—, derivados de la misma lista que su ayuda. Las que escriben
(`jira_create`, `jira_delete`, `slack_post`, `slack_channel_create`, `slack_channel_archive`) devuelven
la vista previa si no se les pasa `apply: true`, y el texto que sale pasa por el guard.

```bash
claude mcp add playground -- /Users/miguelochoa/Desktop/CREDITOP/playground/bin/pg mcp
```

`bin/pg` compila el binario si cambió su código y corre desde la raíz, así que encuentra
`connectors/.env` sin importar desde dónde lo lance Claude. Para quitarlo: `claude mcp remove playground`.
Agregar una herramienta es agregar un comando a `cmd/pg/registry.go`: la prueba de ese paquete cruza lo
que el registro declara contra las banderas que el comando acepta.

## La Slack App (una vez)

1. <https://api.slack.com/apps> → **Create New App** → *From scratch*, en el workspace.
2. **OAuth & Permissions → Bot Token Scopes**: `channels:manage` (canales públicos), `groups:write`
   (privados), `chat:write` (mensajes) y `channels:history` (leer #tech-ops desde el trazador).
3. **Install to Workspace** y copiá el **Bot User OAuth Token** (`xoxb-`) a `SLACK_BOT_TOKEN` en
   `connectors/.env` (plantilla: `connectors/.env.example`).

⚠ El token de esta máquina no tiene `channels:history` (medido el 2026-09-24: `missing_scope`).
