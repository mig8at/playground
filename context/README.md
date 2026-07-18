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
| **`context_brief`** | **empezá acá**: dada una TAREA en lenguaje natural → índice del árbol + nodos candidatos |
| `context_get_doc` / `context_save_doc` | lee/escribe la doc viva (`doc.md`) de un nodo (+ vecinos) |
| **`context_files`** | la superficie de código curada de un nodo, agrupada por repo/subsistema |
| `context_get_content` | hidrata: código real de unos IDs |
| `context_scan` | indexa (o re-indexa) un repo |
| `context_map` | catálogo node-lite (barato, sin código); filtro por path |
| `context_connections` | edges de un nodo (import + route cross-repo) |
| `context_save_flow` | **guarda** un flujo = array de IDs (aparece en la UI) |
| `context_list_flows` / `context_get_flow` | lee flujos guardados |

### Cómo un LLM obtiene contexto para una tarea

El árbol tiene ~2.300 líneas de doc y ~1.270 archivos linkados: volcarlo no entra
en una ventana de contexto. El protocolo es una **escalera de disclosure**, barata
primero — cada escalón dice cuánto cuesta el siguiente:

```
L0  context_brief {task}    índice (1 línea/nodo) + candidatos      ~1.5k tokens
L1  context_get_doc {id}    el doc completo + vecinos del nodo      ~2-5k por nodo
L2  context_files {id}      su superficie de código, agrupada       ~0.5-2k
L3  context_get_content     el código real                          lo que pidas
```

**El ruteo lo hace el modelo, no el servidor.** `context_brief` devuelve el índice
—donde cada nodo trae un campo **`when`** ("cuándo usar este nodo", escrito en el
vocabulario con el que llega una tarea)— más los candidatos que matchean
léxicamente el enunciado, **con la línea del doc que lo justifica**. El servidor
sugiere; el que decide qué abrir es el modelo. Sin embeddings a propósito: es
determinista, explicable, y no se desincroniza cuando editás un doc.

```
"el listado no muestra CrediPullman en el comercio X"
   → pullman (9) · creditopx (6) · merchants (6)
"agregar un tipo de documento nuevo por sucursal"
   → dynamic-forms (16)
"necesito un usuario sintético para probar el score del buró"
   → kyc (16) · profiling (13) · pullman (10)
```

Registrarlo (ejemplo, ruta al binario):

```bash
claude mcp add context -- /ruta/a/context/server/bin/context-mcp
```

## Estado

MVP. El scan y los edges `route`/`import` son heurísticos (regex), no AST — cubren la
mayoría; el resto lo absorbe la **curación** (los flujos guardados son también
ground-truth de las conexiones que la estática no infiere). Ver el análisis de viabilidad
en los docs del playground.
