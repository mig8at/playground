# tablero — mi sprint: registro de tiempo, bitácora y conectores propios (Jira/Slack)

Un proyecto con **tres ejecutables Go y un frontend Vue**, todos apoyados en los mismos clientes HTTP:

| Pieza | Qué es | Cómo se corre |
|---|---|---|
| `cmd/web` | servidor WebSocket (`:8787`) que alimenta el dashboard | `npm run dev` |
| `cmd/jira-mcp` | **conector MCP** de Jira Cloud (stdio) — 4 tools | registrarlo en Claude Code |
| `cmd/slack-mcp` | **conector MCP** de Slack (stdio) — 3 tools | registrarlo en Claude Code |
| `src/` (Vue) | "Mi sprint": dashboard de sprint activo + heatmap de actividad | `npm run dev` → `:5191` |

## Por qué existe

Dos motivos distintos que terminaron en el mismo repo:

1. **No usar los conectores MCP pre-armados.** Los de la nube (`mcp.atlassian.com`, `mcp.slack.com`) son cajas
   negras: no sabés qué endpoint llaman ni con qué token. Acá cada llamada HTTP es un método de ~20 líneas en
   `internal/`, con nuestro token y nuestro control. Agregar un endpoint = agregar un método.
2. **Ver mi desempeño sin abrir Jira.** El dashboard responde una sola pregunta —*¿voy al día en el sprint?*—
   comparando % de tareas hechas contra % de tiempo transcurrido.

Los clientes de `internal/` los comparten los tres binarios: lo que se agrega para el MCP queda disponible
para el dashboard y viceversa.

## Arranque rápido

```bash
cd /Users/miguelochoa/Desktop/CREDITOP/playground/tablero
npm install
cp server/.env.example server/.env    # y completá los tokens (ver "Configuración")
npm run dev
```

`npm run dev` levanta las dos cosas con `concurrently`:

- **server** → `go run ./cmd/web` en `:8787`. Al arrancar valida credenciales e imprime
  `server on · ws://localhost:8787/ws · integraciones: Jira(Miguel Ochoa), Slack(...)`.
  Si no hay `.env` dice `integraciones: ninguna (.env sin credenciales)` y el front queda vacío.
- **web** → Vite en `http://localhost:5191` (elegido para no chocar con `flow` en `:5190`).

Otros scripts (verificados en `package.json`):

```bash
npm run server:build   # compila server/bin/{web,slack-mcp,jira-mcp}
npm run server:jira    # corre jira-mcp por stdio (para probar suelto)
npm run server:slack   # corre slack-mcp por stdio
npm run build          # vite build → dist/
cd server && go test ./...   # solo hay tests de NormalizeChannelName
```

## Mapa

```
tools/
├── package.json  vite.config.js  index.html
├── src/
│   ├── App.vue            ← TODO el dashboard (WS + heatmap + estilos), ~325 líneas
│   ├── main.js  styles.css
│   └── scorecards/        ← Rocks & Scorecards Q3 2026 — HUÉRFANO, nadie lo importa
└── server/
    ├── go.mod (module creditop/tablero/server) · .env · .env.example
    ├── cmd/web/main.go        ← WS :8787, 5 mensajes entrantes + /health
    ├── cmd/jira-mcp/          ← main.go (wiring) + tools.go (4 tools)
    ├── cmd/slack-mcp/         ← main.go (wiring) + tools.go (3 tools)
    ├── cmd/issue-update/      ← one-off: edita summary/descripción de un issue
    ├── cmd/issue-transition/  ← one-off: mueve un issue de estado (transición)
    └── internal/
        ├── atlassian/  client.go (Basic auth) · jira.go (API v3) · agile.go (sprints) · activity.go (changelog)
        ├── slack/      client.go · auth.go · conversations.go · messages.go · users.go (+ un test)
        └── env/env.go  ← carga .env sin pisar variables ya exportadas
```

## Los conectores MCP

**`jira-mcp`** (server MCP `creditop-jira`) — API v3 + Agile 1.0:

| Tool | Qué hace | Riesgo |
|---|---|---|
| `jira_myself` | `GET /rest/api/3/myself` — valida credenciales | lectura |
| `jira_search_issues` | `POST /rest/api/3/search/jql` — la JQL **debe** llevar al menos una restricción | lectura |
| `jira_create_issue` | crea issue; con `board_id` además lo mete al **sprint activo** de ese board | escritura |
| `jira_delete_issue` | `DELETE /rest/api/3/issue/{key}` | **irreversible** |

**`slack-mcp`** (server MCP `creditop-tools`):

| Tool | Qué hace | Scope que pide |
|---|---|---|
| `slack_create_channel` | crea canal (nombre normalizado antes de enviar) | `channels:manage` / `groups:write` |
| `slack_post_message` | `chat.postMessage` — el bot debe ser **miembro** del canal | `chat:write` |
| `slack_archive_channel` | archiva (Slack **no** permite borrar canales por API fuera de Enterprise Grid) | `channels:manage` |

### Registrarlos en Claude Code

```bash
cd /Users/miguelochoa/Desktop/CREDITOP/playground/tablero && npm run server:build

claude mcp add creditop-jira  -- /Users/miguelochoa/Desktop/CREDITOP/playground/tablero/server/bin/jira-mcp
claude mcp add creditop-tools -- /Users/miguelochoa/Desktop/CREDITOP/playground/tablero/server/bin/slack-mcp
```

No hace falta pasar `--env`: `env.LoadDefaults()` busca `.env` en el cwd, **junto al binario y en su carpeta
padre** — y `server/bin/../.env` es justamente `server/.env` (leído del código, no probado con el registro real).
Las variables ya exportadas ganan sobre el `.env`, a propósito.

Probar suelto, sin Claude (handshake + listar tools):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| ./server/bin/jira-mcp
```

Para quitarlos: `claude mcp remove creditop-jira`.

### Agregar una tool

1. Método nuevo en `internal/slack/` o `internal/atlassian/`.
2. `registerXxx(server, client)` en el `tools.go` correspondiente, con structs de input/output — los tags
   `jsonschema:"..."` son lo que el modelo ve como descripción de cada campo.
3. Llamarla desde `main.go`. El schema se genera solo desde los structs de Go.

## El dashboard

El front abre `ws://localhost:8787/ws` y al conectarse manda `{"type":"dashboard"}` y `{"type":"activity"}`.
Si el server se cae, reintenta cada 1,5 s.

| Panel | De dónde sale |
|---|---|
| Sprint, fechas, días restantes | `GET /rest/agile/1.0/board/{board}/sprint?state=active` |
| Tareas y semáforo de avance | `GET /rest/agile/1.0/sprint/{id}/issue` con `jql=assignee = currentUser()` |
| "vas al día 🟢 / atrasado 🔴" | comparación en el front: `% tareas hechas` vs `% tiempo transcurrido` |
| Story points / horas | `customfield_10036` y `timetracking` del mismo issue |
| Heatmap estilo GitHub | issues tocados en 182 días → `?expand=changelog` de cada uno, contando solo los cambios cuyo autor sos vos |

El heatmap es la parte cara: hace una llamada por issue, con concurrencia acotada a 6 (`activity.go:75`) y un
timeout global de 30 s puesto en el handler del WS (`cmd/web/main.go:334`) — `activity.go` no define ninguno.
Cada request HTTP además corta a los 20 s por su cuenta (`internal/atlassian/client.go:33`).

## Es el hogar del TRABAJO (y `context` el del conocimiento)

Desde el **2026-07-21** la partición es explícita: **`playground/context` responde "cómo *es* CreditOp"**
(contextos + el mapa del código, markdown durable) y **este tablero responde "en qué se está
*trabajando*"** (esfuerzos, tiempo, estado, Jira). El árbol de context ya **no lleva nodos-tarea**: los 4
que tenía se migraron acá.

### El método: tres etapas, y las tareas al final

Un esfuerzo avanza por **`stage`**, y el orden es deliberado:

| Etapa | Qué pasa |
|---|---|
| `evaluation` · **Evaluando** | entender el problema y validar contra el código; todavía no se toca nada |
| `work` · **Trabajando** | desarrollo y pruebas; la bitácora se llena acá |
| `tasks` · **Tareas creadas** | recién ahora se redactan y suben las tareas de Jira |

**Por qué al final:** definir la tarea *después* de haberla resuelto es lo único que permite escribirla
bien — ya se sabe en qué se parte, qué representa de esfuerzo real y cómo se valida. Definirla al empezar
es adivinar. La etapa es explícita y no derivada: "evaluando" y "trabajando" se distinguen por decisión,
no por si ya existe una tarea de Jira.

Un **esfuerzo** (`efforts`) es el trabajo real privado del que salen las tareas de Jira, y guarda:

| Campo | Qué es | ¿Guard? |
|---|---|---|
| `title` | cómo lo llamás vos | privado, sin guard |
| `tech_notes` | el detalle técnico: archivos, análisis, rutas | **sin guard** — nunca sale de local, por eso *sí* puede nombrar archivos y repos |
| `context_nodes` | a qué nodos de `context` apunta (el mapa del código vive allá) | — |
| `jira_title` · `jira_description` | el borrador de la tarea (se escribe en la etapa `tasks`) | **con guard** — termina publicado en Jira |
| `stage` | en qué etapa del método está | — |

Esa asimetría es deliberada: lo técnico y lo publicable son dos textos distintos, y el guard marca la
frontera. Por eso el detalle de archivos **no puede** vivir en las notas de la bitácora.

⚠ **Al terminar una tarea:** lo que se **mergea** gradúa al nodo de `context` que corresponda (pasa a ser
"cómo funciona CreditOp"); lo que no se mergeó se queda acá.

### Del esfuerzo a Jira: crear, mover y notificar al evaluador

La descripción de la tarea sigue la **plantilla orientada a QA** de
[`docs/PLANTILLA-TAREA-JIRA.md`](docs/PLANTILLA-TAREA-JIRA.md): nivel negocio, enfocada en *cómo y
dónde validar*. Todo lo que va a Jira pasa por el **guard** (nada de repos, rutas de archivo, el
playground ni F-xx).

| Acción | Cómo |
|---|---|
| **Crear** tarea | WS `{"type":"create_task","summary":…,"description":…}` → issue en `CORE`, tipo Tarea, asignado a mí, y lo mete al **sprint activo** del board 384. (También `jira_create_issue` del MCP.) |
| **Editar** tarea | `go run ./cmd/issue-update <json>` con `{"key","summary","description"}` → `UpdateIssue` (PUT; la descripción se manda como ADF). |
| **Pasar a pruebas + avisar** | **El camino normal: el botón “🧪 Enviar a pruebas y avisar” de la tarjeta “La tarea”.** Un click hace la transición **y** manda el DM. Ver abajo. |
| **Mover de estado** (suelto) | `go run ./cmd/issue-transition <KEY> <substring-estado>` → busca la transición por estado destino y la aplica. El workflow **no salta directo**: a "En pruebas" se llega **Por Hacer → En progreso → En pruebas** (dos pasos). |
| **Notificar** (suelto) | WS `{"type":"dm","to":"<email>","text":…}` → DM **como yo** (user token). |

**El botón de handoff** (`/api/qa-notice`, la única escritura del tablero sobre el estado de una tarea):

- `GET ?key=CORE-321` → **preview, no escribe**: qué transición aplicaría, a quién le llega el DM y el
  texto ya armado. `POST {key,text}` → transiciona y manda. **Nunca sale nada que no se haya visto:** el
  panel muestra el mensaje y se puede editar antes de enviar.
- La transición se elige por **estado destino** (`FindTransitionTo`, compartido con `issue-transition`),
  no por id ni por nombre: los ids cambian al editar el workflow. El estado se configura con
  `JIRA_TESTING_STATUS` como **subcadena** — en CORE es `🧪 En pruebas`, **con emoji, y no existe
  "En revisión"**.
- El texto pasa por el **mismo guard** que la bitácora, *antes* de tocar Jira. Si el aviso menciona un
  repo, una ruta o un F-xx, el panel lista los motivos y no se manda ni se mueve nada.
- Si la transición sale pero el DM falla, se dice **"movida pero el DM NO salió"**. Dar el aviso por
  hecho es peor que el error: la tarea queda esperando a alguien que no sabe.

**Regla de notificación (Duncan):**

- Se notifica **solo cuando la tarea está "En pruebas"** — recién ahí hay algo para evaluar. El botón
  desaparece cuando la tarea ya está ahí, así que la regla la hace cumplir la UI, no la memoria.
- Destinatario: **Duncan** — `duncan.estrada@creditop.com` (configurable con `QA_SLACK_EMAIL`).
- Tono: **de usted** (no tutear), coloquial y corto, con el link a Jira. Ej.: *"Perrito 🐶 le dejé una tarea… échele ojo que al firmar llegue palomeado 👉 <link>"*.
- **Precondición:** el evaluador tiene que tener **cómo validar** lo que se le pide (ej. ver los documentos firmados). Si no, el ping llega pero la validación se traba — resolverlo antes de pasar a "En pruebas".

> La descripción se **escribe en Markdown y se renderiza a ADF** (`mdToADF` en `internal/atlassian/jira.go`):
> la API v3 de Jira no acepta MD/HTML, guarda ADF. Se soporta `##` encabezados, `**negrita**`, `-` viñetas,
> `- [ ]` checklist (checkboxes reales), `1.` numeradas y links.
>
> Los one-offs `issue-update`/`issue-transition` reutilizan las credenciales del `.env` sin tocar el
> server en ejecución. `create_task`/`dm` son mensajes del WS (los dispara el dashboard). El cliente Jira
> ya sabe **crear, editar y transicionar** issues.

## Los datos: archivos, no base de datos

Todo vive en **`tablero/data/`** — markdown y JSON, sin servidor de base de datos. Está **fuera de
`server/`** a propósito: si el server algún día se reduce a un proxy de Jira/Slack, los datos no pueden
vivir dentro de él. `TABLERO_DATA` mueve la carpeta.

```
data/
  efforts/<slug>/effort.md   un archivo por esfuerzo (ver abajo)     → versionado en git
  entries/2026-07.jsonl      la bitácora de tiempo, un archivo por mes → FUERA de git (dato personal)
  settings.json              los flags del tablero                    → versionado
  cache/jira.json            snapshot de Jira, descartable            → fuera de git
  tareas-locales.json        anotaciones de tareas, sólo si hay alguna
```

**Por qué se salió de SQLite:** eran 44 filas con un WAL de 1,9 MB para 139 KB de datos, pero el tamaño
no era la razón. El detalle técnico de una tarea sólo se podía leer **por API**, así que el tablero era el
único rincón del playground que un modelo no puede leer sin levantar un server — mientras `context/` es
markdown que lee cualquiera. Y en archivos los esfuerzos tienen **historia en git**.

### El esfuerzo: un solo archivo, con la frontera del guard adentro

```markdown
---
id: 4
title: "..."                     ← privado: nombra el esfuerzo, no sale de acá
stage: tasks                     ← evaluation | work | tasks
created: "..."
context_nodes: [onboarding, kyc] ← a qué nodos de `context` apunta
jira: [CORE-293]                 ← las tareas de Jira que salieron de este esfuerzo
jira_title: "..."                ← PUBLICABLE: pasa el guard
---

las notas técnicas: PRIVADO, puede nombrar repos, rutas y hallazgos

## Tarea (publicable)

la descripción que va a Jira — PUBLICABLE: pasa el guard
```

> **La regla en una frase:** todo lo que está fuera de `## Tarea (publicable)` nunca sale de local.

Se probó con tres archivos (`effort.md` + `jira.md` + `jira.json`) para hacer *física* esa frontera y se
descartó: **el guard es el mecanismo real** —corre sobre el texto antes de publicar y ataja repos, rutas y
`F-xx`—, así que el archivo aparte era redundancia. Y el `jira.json` no llevaba nada: sus filas tenían
sólo la clave de la tarea, o sea existía para guardar una lista.

### La bitácora (`entries/`)

Sigue pensada **para análisis de tiempo**, no sólo para que la UI recargue. Las decisiones que importan:

> **Convención de idioma:** claves, identificadores y clases CSS en **inglés**; sólo el texto visible de
> la UI y los comentarios van en español.

- Un registro = un bloque de tiempo trabajado. El snapshot de Jira (`sprints`/`tasks`) es una **dimensión
  descartable** en `cache/`: se upsertea de pasada cada vez que el dashboard carga — navegar el tablero ES
  la sincronización.
- `startedAt` es cuándo **empezó el trabajo** (RFC3339 con offset local); `createdAt` es cuándo se anotó.
  La brecha entre ambos —cuánto tardás en registrar— también es un dato.
- `day` y `hour` desnormalizan el instante en hora **local** y se calculan **al crear el registro**:
  derivarlos después obliga a reinterpretar el offset, y ahí las 9am se convierten en las 14 sin que nadie
  lo note. **Agrupá por `day`/`hour`, no recalcules desde `startedAt`.**
- `minutes` (lo que pasó) convive con `uploadedMinutes` (lo que se publicó en Jira): ajustar al publicar es
  una decisión de publicación, no una reescritura de la verdad.
- `taskKey` puede ir vacío (`freeTitle` dice qué fue): reuniones y soporte no son tareas del sprint, y
  forzarlos a una envenena el análisis.
- La `note` es **publicable por construcción**: el guard (fuente única en `cmd/web/main.go`, servido a la
  UI por `/api/guard`) corre en el server **antes** de escribir.
- Borrado **suave** (`deletedAt`): el ✕ de la UI marca, no elimina.

Es JSONL, así que el análisis se hace con `jq` en vez de SQL:

```bash
# ¿cuántas horas por día?
jq -s 'map(select(.deletedAt|not)) | group_by(.day)[]
       | {day: .[0].day, horas: (map(.minutes)|add/60|.*10|round/10)}' data/entries/*.jsonl

# ¿en qué se va el tiempo? (dev vs test vs blocker)
jq -s 'map(select(.deletedAt|not)) | group_by(.kind)[]
       | {kind: .[0].kind, horas: (map(.minutes)|add/60|.*10|round/10)}' data/entries/*.jsonl

# ¿mañana o tarde? (por eso existe `hour` local)
# ⚠ se etiqueta ANTES de agrupar: `group_by` conserva el valor original, así que agrupar por la
#   condición y leer `.[0]` devuelve la hora (9) en vez del bloque ("mañana").
jq -s 'map(select(.deletedAt|not)
       | if .hour < 12 then "mañana" elif .hour < 14 then "almuerzo" else "tarde" end)
       | group_by(.)[] | {bloque: .[0], registros: length}' data/entries/*.jsonl
```

Endpoints: `GET/POST /api/entries`, `DELETE /api/entries/{id}`, `GET /api/guard`.

## Configuración (`server/.env`)

| Variable | Para qué | Default |
|---|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-` — mensajes/canales "como el bot" | — (sin él, Slack off) |
| `SLACK_USER_TOKEN` | `xoxp-` — DMs "como vos" (`chat:write`, `im:write`, `users:read.email`) | — |
| `SLACK_TEST_CHANNEL` | canal del mensaje de prueba | `C0BG5GP5JN7` (hardcodeado en `main.go`) |
| `ATLASSIAN_SITE` / `_EMAIL` / `_API_TOKEN` | Jira Cloud, Basic auth | — (faltando uno, Jira off) |
| `JIRA_PROJECT_KEY` | proyecto de las tareas nuevas | `CORE` |
| `JIRA_TASK_TYPE_ID` | tipo de issue | `10005` (= "Tarea" en CORE) |
| `JIRA_BOARD_ID` | board cuyo sprint activo se usa | `384` |
| `QA_SLACK_EMAIL` | a quién le llega el DM al pasar a pruebas | `duncan.estrada@creditop.com` |
| `JIRA_TESTING_STATUS` | **subcadena** del estado "listo para probar" | `pruebas` (matchea `🧪 En pruebas`) |
| `WEB_PORT` | puerto del WS | `8787` |

API token de Atlassian: <https://id.atlassian.com/manage-profile/security/api-tokens>.
Slack app y scopes: <https://api.slack.com/apps> → OAuth & Permissions → Install to Workspace.

## Gotchas

- **`JIRA_PROJECT_KEY`, `JIRA_TASK_TYPE_ID`, `JIRA_BOARD_ID` y `WEB_PORT` no están en `.env.example`.**
  Existen solo como default en `cmd/web/main.go`. Si el board o el tipo de issue cambian, el síntoma es
  una tarea creada en el lugar equivocado, no un error. (`QA_SLACK_EMAIL` y `JIRA_TESTING_STATUS` sí
  están documentadas en el `.env.example`.)
- **`WEB_PORT` es una trampa a medias:** el front tiene `ws://localhost:8787/ws` **hardcodeado**
  (`App.vue:4`). Cambiar el puerto en el `.env` deja el dashboard desconectado.
- **Tres mensajes del WS no tienen UI.** El server maneja `send_slack`, `dm` y `create_task`
  (`main.go:111-122`), pero `App.vue` solo manda `dashboard` y `activity`. Son alcanzables únicamente
  mandando el JSON a mano por el WebSocket — quedaron de una versión anterior del front.
- **Mover una tarea a otro sprint NO se puede por el Agile API.** `POST /rest/agile/1.0/sprint/{id}/issue`
  (lo que hace `AddIssuesToSprint`) responde **404** con
  `rapidViewId: "El tablero solicitado no se puede ver…"`: la llamada resuelve el **board dueño** del
  sprint, y los sprints del proyecto nacen en el board **351**, que esta cuenta no ve — el 384 los
  *lista* pero no los posee. Funciona sí al crear (el sprint activo ya está en el board propio) y falla
  al mover a otro. El camino que sí sirve es el campo Sprint del issue:
  `PUT /rest/api/3/issue/{key}` con `{"fields":{"customfield_10020": <sprintId>}}` → 204.
  Es **seguro**: el campo conserva los sprints **cerrados** del historial y solo reemplaza el
  activo/futuro (verificado moviendo Sprint 8 → 9: quedó `[Sprint 9, Sprint 7]`).
- **`customfield_10036` (story points) es específico de CORE.** En otro proyecto Jira el campo tiene otro id
  y el panel de puntos queda en `—` sin avisar.
- **Si la validación de arranque falla por timeout, el heatmap sale vacío pero "ok".** `myAccountID` se setea
  una sola vez en `connectIntegrations()`, que corta a los 8 s (`cmd/web/main.go:366`) — bastante menos que los
  15 s del dashboard y los 30 s de activity. Si `GetMyself` se pasa de ese corte **pero las credenciales son
  válidas**, `myAccountID` queda en `""` y `activity.go` filtra por autor contra ese string → heatmap todo gris,
  0 cambios, sin error. Mismo efecto en `create_task`: la tarea se crea **sin asignado**.
  Con credenciales inválidas o expiradas el síntoma es otro: las llamadas siguientes también fallan (401), el
  WS manda `activity_data` con `ok:false`, `App.vue` no asigna `activity` y el heatmap directamente no se
  dibuja (`v-if="heatmap"`), mientras `dashboard_data` con `ok:false` pinta el banner rojo.
- **El heatmap está capado a 80 issues** (`recentIssueKeys`, `maxResults: 80`). Con más actividad que eso en
  26 semanas, subcuenta — no hay paginación.
- **Agregar al sprint es best-effort.** Si `ActiveSprint` o `AddIssuesToSprint` fallan, la tarea **igual queda
  creada** (fuera del sprint) y el resultado no marca error. Vale para el MCP y para el WS.
- **`/rest/api/3/search` (el viejo) devuelve 410 desde oct-2025.** Por eso todo va a `/search/jql`, que
  además exige JQL restringida: una consulta sin filtros es rechazada por el endpoint.
- **`src/scorecards/` está huérfano**: 4 componentes + `data.js` con los Rocks de Tecnología Q3 2026, que
  nadie importa. El único rastro vivo es el `<title>` de `index.html`, que sigue diciendo
  "Rocks & Scorecards" mientras la app muestra "Mi sprint". `dist/` es un build viejo (gitignoreado).
- **Ninguno de los dos conectores está registrado hoy** — `claude mcp list` (2026-07-19) solo muestra los
  remotos de claude.ai. Hay que correr el `claude mcp add` de arriba antes de esperar que un modelo los use.
- **`server/.env` tiene secretos reales** y está en `.gitignore` junto con `node_modules/`, `dist/` y
  `server/bin/`. Convención del playground: **commit local, sin push.**

## Docs relacionados

- [`server/README.md`](server/README.md) — guía paso a paso para crear la Slack App y sacar el token, y el
  ejemplo de `tools/call` por stdio. **Ojo: está desactualizado** — describe slack-mcp como "el primer
  conector" con una sola tool, dice que Jira viene "más adelante" (ya está), y su árbol de carpetas y el
  `claude mcp add` omiten el nivel `server/` (dicen `tools/bin/slack-mcp`, la ruta real es
  `tools/server/bin/slack-mcp`).
- `../context/` — árbol de contexto de CreditOp (mapa estático `ROUTE-MAP.md` + toolkit Python). Nada que
  ver con estos conectores, pero es el otro proyecto grande del playground.
- `playground/docs/` **ya no existe** (absorbido por `context/`): si algún doc apunta ahí, es puntero roto.
