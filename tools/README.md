# tools — herramienta personal (Creditop)

Un solo proyecto. Al entrar y hacer `npm run dev` levanta **el frontend y el server juntos**;
el server dice **`server on`** y habla con el frontend por **WebSocket**.

Hoy el frontend muestra un **"Hola Mundo"** y el server solo envía ese saludo — pero ya
está **cableado a Jira y Slack** (los mismos clientes de los conectores MCP). La dirección a
futuro: enfocar la herramienta en **mi desempeño** (tareas diarias, lo que me toca cumplir).

```
tools/
├── package.json  vite.config.js  index.html   ← frontend (Vue)
├── src/
│   ├── App.vue          ← "Hola Mundo" + cliente WebSocket
│   ├── main.js  styles.css
│   └── scorecards/      ← dashboard Rocks & Scorecards (PARQUEADO para después)
└── server/                                     ← lógica en Go
    ├── go.mod  (module creditop/tools/server) · .env
    ├── cmd/web/         ← servidor WebSocket (":8787"): imprime "server on", envía "hola mundo"
    ├── cmd/slack-mcp/  cmd/jira-mcp/           ← conectores MCP (stdio)
    └── internal/  (slack, atlassian, env)      ← lógica compartida (web + MCP)
```

## Correr

```bash
cd tools
npm install
npm run dev
```

Eso arranca (con `concurrently`):
- **server** → `go run ./cmd/web` en `:8787` · imprime `server on · ws://... · integraciones: Jira(...), Slack(...)`
- **web** → Vite en `http://localhost:5191`

El frontend abre un WebSocket a `ws://localhost:8787/ws`, recibe `hola mundo` y muestra el
estado **server on**. Si el server se cae, el front reintenta solo.

## Otros comandos

```bash
npm run server:build   # compila server/bin/{web,slack-mcp,jira-mcp}
npm run server:slack    # corre el conector MCP de Slack (stdio)
npm run server:jira     # corre el conector MCP de Jira (stdio)
```

Credenciales en `server/.env` (ver `server/.env.example`). Detalle de los conectores MCP en
[server/README.md](server/README.md).

## Parqueado

El dashboard **Rocks & Scorecards** (semáforo semanal + detalle W1) quedó en
`src/scorecards/` por si retomamos esa vista; hoy no se monta.
