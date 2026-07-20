# tools — conectores MCP propios

Servidores [MCP](https://modelcontextprotocol.io) escritos por nosotros, en Go.
La idea: en vez de usar los conectores pre-armados, controlamos cada llamada a
la API del servicio (Slack, y más adelante Jira) con nuestro propio token.

Primer conector: **`slack-mcp`**, con una tool para **crear canales de Slack**.

```
tools/
├── cmd/slack-mcp/      # ejecutable: arma el server MCP y registra las tools
│   ├── main.go         #   wiring (lee token, crea server, corre stdio)
│   └── tools.go        #   definición de cada tool (input/output + handler)
└── internal/slack/     # cliente HTTP mínimo de la Slack Web API
    ├── client.go       #   POST genérico con Bearer token
    └── conversations.go#   conversations.create
```

## 1. Crear la Slack App y obtener el token

1. Ve a <https://api.slack.com/apps> → **Create New App** → *From scratch*.
2. Elige tu workspace y un nombre (ej. `creditop-tools`).
3. En **OAuth & Permissions → Scopes → Bot Token Scopes**, agrega:
   - `channels:manage` — crear canales **públicos**
   - `groups:write` — crear canales **privados** (opcional)
4. Arriba, **Install to Workspace** y autoriza.
5. Copia el **Bot User OAuth Token** (empieza con `xoxb-`).

```bash
cp .env.example .env      # y pega tu token en SLACK_BOT_TOKEN
```

## 2. Compilar

```bash
go build -o bin/slack-mcp ./cmd/slack-mcp
```

## 3. Probar suelto (sin Claude)

```bash
# handshake + listar tools
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| SLACK_BOT_TOKEN=xoxb-... ./bin/slack-mcp
```

Para crear un canal de verdad, agrega una llamada `tools/call`:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"slack_create_channel","arguments":{"name":"prueba-mcp","is_private":false}}}
```

## 4. Registrar en Claude Code

```bash
claude mcp add creditop-tools \
  --env SLACK_BOT_TOKEN=xoxb-... \
  -- /Users/miguelochoa/Desktop/CREDITOP/playground/tools/bin/slack-mcp
```

Luego, en una sesión: *"crea un canal de Slack llamado equipo-loan-origination"*
y Claude llamará a `slack_create_channel`.

Para quitarlo: `claude mcp remove creditop-tools`.

## Agregar más tools

1. Nuevo método en `internal/slack/` (ej. `PostMessage` → `chat.postMessage`).
2. Nueva función `registerXxx(server, client)` en `cmd/slack-mcp/tools.go` con
   sus structs de input/output (los tags `jsonschema` documentan cada campo).
3. Llamarla desde `main.go`.

El schema que ve el modelo se genera solo desde los structs de Go.
