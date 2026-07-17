# context — mapa de flujos cross-repo (CreditOp)

Un solo proyecto. `npm run dev` levanta **el server (Go) y el frontend (Vue) juntos**;
el server dice **`server on`** y habla con la UI por **WebSocket**. La misma lógica se
expone como **conector MCP (stdio)** para que un host (Claude/Cursor) cree los flujos.

> Hermano de **Carto** (node-lite + IDs) y **Rino** (arrays de archivos por flujo),
> pero apuntado a **varios repos a la vez** y a **guardar flujos** que los cruzan
> (el caso CreditOp: lógica dispersa en `legacy-backend` + `frontend-monorepo` + `application` + micros).

## Idea

1. **Escanear** uno o varios repos → por cada archivo, `node-lite` (imports, definiciones,
   rutas) con un **ID estable**. Sin código: barato.
2. **Conectar**: edges `import` (intra-repo) y `route` (cross-repo, match cliente↔servidor
   por método + path). Ese es el salto frontend↔backend que ningún import expresa.
3. **Guardar flujos**: un flujo = un **array de IDs** con nombre (ej *"Onboarding CreditopX rt=2"*),
   posiblemente de varios repos. Lo crea el MCP; la UI lo muestra **en vivo**.

```
context/
├── package.json  vite.config.js  index.html   ← frontend (Vue, :5193)
├── src/ App.vue  main.js  styles.css           ← UI: repos + flujos + detalle
└── server/                                      ← Go (module creditop/context/server)
    ├── cmd/web/         ← WebSocket (:8788): estado a la UI, poll de disco
    ├── cmd/context-mcp/  ← conector MCP (stdio): scan / map / flows / content
    └── internal/
        ├── scan/    ← extractor node-lite (ts, go, php, py, vue…)
        ├── graph/   ← edges import + route (cross-repo)
        └── engine/  ← estado en disco (JSON atómico), compartido web+MCP
```

**Estado compartido en disco.** Web y MCP apuntan al mismo `CONTEXT_DATA_DIR`
(por defecto `~/.creditop-context`): `index.json` (repos + nodos) y `baselines.json`
(hashes para el drift). Los FLUJOS viven como definiciones editables versionadas en
`server/data/flows/<id>/`:

```
server/data/flows/<id>/
├── map.json   ← estructura: name/combination/group/kind + files "repo/relpath"
└── doc.md     ← documentación VIVA (markdown): qué es el flujo + bitácora de lo
                 que se hizo/decidió. Entra al header del copy y al MCP.
```

El MCP escribe, el web detecta el cambio (poll de mtime, incluye editar `doc.md`
a mano) y refresca la UI.

## Correr

```bash
cd context
npm install
npm run dev
```

- **server** → `go run ./cmd/web` en `:8788` · imprime `server on · ws://… · datos: ~/.creditop-context`
- **web** → Vite en `http://localhost:5193`

En la UI pegá la ruta de un repo (ej `…/CREDITOP/github/legacy-backend`) y **Indexar**.
Repetí por cada repo. Los **flujos** aparecen cuando el MCP los guarda.

## Conector MCP

```bash
npm run server:build       # server/bin/{web,context-mcp}
npm run server:mcp         # corre el MCP por stdio
```

Tools expuestas:

| Tool | Qué hace |
|------|----------|
| `context_scan` | indexa (o re-indexa) un repo |
| `context_map` | catálogo node-lite (barato, sin código); filtro por path |
| `context_connections` | edges de un nodo (import + route cross-repo) |
| `context_save_flow` | **guarda** un flujo = array de IDs (aparece en la UI) |
| `context_list_flows` / `context_get_flow` | lee flujos guardados |
| `context_get_doc` / `context_save_doc` | lee/escribe la doc viva (`doc.md`) de un flujo |
| `context_get_content` | hidrata: código real de unos IDs |

Registrarlo (ejemplo, ruta al binario):

```bash
claude mcp add context -- /ruta/a/context/server/bin/context-mcp
```

## Estado

MVP. El scan y los edges `route`/`import` son heurísticos (regex), no AST — cubren la
mayoría; el resto lo absorbe la **curación** (los flujos guardados son también
ground-truth de las conexiones que la estática no infiere). Ver el análisis de viabilidad
en los docs del playground.
