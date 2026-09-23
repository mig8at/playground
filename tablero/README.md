# tablero — LAS TAREAS A REALIZAR (y el sprint: tiempo, avances, conectores Jira/Slack)

> **Qué contesta este proyecto:** *¿en qué se está trabajando, por qué y para qué?*
> Lo que contesta *¿cómo **es** CreditOp?* es **canon**, y son cosas distintas: si algo **sigue siendo
> cierto después de mergear**, es contexto; si deja de tener sentido porque hablaba de una decisión, un
> riesgo o una pregunta abierta, es tarea y va acá.

## Elegí la lectura por la pregunta

| Si necesitás… | Abrí… |
|---|---|
| retomar una tarea concreta | `make retomar N=<id|slug>` o **Hoy** en la tarea |
| decidir qué mover hoy | `make hoy` o los grupos de estado en **Mis tareas** |
| crear o actualizar una tarea | `TASK-TEMPLATE.md` y después `CLAUDE.md` |
| entender cómo está compuesta la herramienta | `docs/ARCHITECTURE.md` |
| encontrar conocimiento estable del producto | **canon**: `github/playground/tools/canon`, o canon.playground.creditop.com |

## La conexión con Jev (sin uso, a propósito)

Hasta el 2026-09-23 el tablero usaba Jev (TypeSafe) en tres lugares: **✦ Orientar** en la cabecera de
una tarea, el **✦** de Pendientes —contrastaba las casillas abiertas con la evidencia fechada— y un
laboratorio por consola (`make tablero-jev`: triage, un banco de 8 casos sintéticos y etiquetas). Se
retiraron los tres: agregaban ruido sin haber encontrado un uso que lo justificara. Lo medido antes de
retirarlo (2026-09-19): en el banco sintético repetido dos veces acertó 16/16 en las tres señales, pero
nunca se comparó contra una muestra real.

Queda la **conexión**, para cuando aterrice un uso mejor: `tools/jev_transport.py` —el endpoint, el
modelo, la lectura del token (`JEV_TOKEN` en `server/.env`) y un pedido acotado que no sigue
redirecciones ni filtra el cuerpo o el token en un error—, con pruebas offline en `make tablero-jev-test`.
El laboratorio, su banco de casos y las dos rutas del server se recuperan de git:
`git show 7be60c4c:tablero/tools/jev.py`.

El README conserva operación, integraciones y referencias; las reglas vigentes para editar tareas viven
en `CLAUDE.md`. Así no hace falta leer ambos completos para una pregunta cotidiana.

Un proyecto con **varios comandos Go y un frontend Vue**, todos apoyados en los mismos clientes HTTP:

| Pieza | Qué es | Cómo se corre |
|---|---|---|
| `cmd/web` | API HTTP (`:8787`) que lee la UI: tareas, bitácora, sprint de Jira, pulso y artifacts | `npm run dev` |
| `cmd/jira-mcp` | **conector MCP** de Jira Cloud (stdio) — 4 tools | registrarlo en Claude Code |
| `cmd/slack-mcp` | **conector MCP** de Slack (stdio) — 3 tools | registrarlo en Claude Code |
| `src/` (Vue) | tareas por estado de los últimos 4 sprints, evidencia, entrega y actividad | `npm run dev` → `:5191` |

## Usar el tablero

- **Mis tareas** agrupa En curso, Bloqueadas, En pruebas, Por empezar y Terminadas. Cada grupo se
  puede plegar; Terminadas empieza cerrado. Buscar abre los grupos que contienen coincidencias.
- Abrir una tarea muestra una cronología central con los bloques de su pila:
  **Hoy**, **Ayer** y después cada fecha real, de más reciente a más antigua. Sólo salen bloques de
  `context.jsonl`; las notas de minutos no aparecen. Cada fecha es un encabezado que **se pega arriba**
  mientras se lee su contenido —el día siguiente lo empuja al llegar— y **se pliega** con un clic, como
  el acordeón del sidebar; plegar un día pegado lo deja en el borde en vez de saltar lejos. Después del recorrido queda el documento
  como material de consulta, **sólo si tiene algo**: una tarea limpia está vacía, sin contenedores con
  su «todavía no hay». El contexto de Canon aparece sólo en el bloque que lo usó. *(Hasta el
  2026-09-23 venían además «Hallazgos» y «Evidencia de trabajo», que salían de las anotaciones del
  documento; ese día las anotaciones pasaron a la pila y cada hecho es un bloque de la cronología.)* **Jira** y **Pendientes** viven en el sidebar derecho; cuando
  la tarea tiene salidas navegables, aparece también **Artifacts**. Ramas queda en la consola inferior.
- Los sidebars y la consola recuerdan sus medidas. Sus separadores se arrastran y también responden a
  las flechas cuando reciben foco.
- **Mi jornada** se puede plegar y recuerda la elección. Estas preferencias viven en el navegador.
- Una prueba o una consulta aparece dentro del bloque que la usó, en su caja con el ambiente —**Harness ·
  local**, **Trazador · prod**, **DB · prod**— y debajo lo que dio. *(Hasta el 2026-09-23 había además
  una sección fija «Harness · comandos reproducibles», y después una «Evidencia de trabajo» con enlaces
  al trazador; se retiraron junto con `HARNESS_URL` y `TRACER_URL`.)*
- El documento muestra el plan y el material después de la cronología. Una referencia de Canon se
  enlaza dentro del bloque que la usó; no hay una sección especial ni una colección genérica de temas
  declarados.
- **Jira** muestra el estado y la descripción recibida al cargar el sprint, con el formato adaptado al
  tema del tablero. El HTML se aísla en un marco sin scripts. Si falta una descripción o la tarea es
  local, lo indica; nunca sustituye el contenido publicado por el borrador local.
- Al recargar se muestra inmediatamente el último estado correcto guardado en el navegador. Jira se
  revalida por `fetch` en segundo plano; el pie informa mientras actualiza o si no pudo hacerlo. Las
  demás APIs locales se consultan en paralelo y no desmontan el editor.
- Copiar conserva el Markdown original; la organización de las pestañas no reescribe los archivos.

## La forma de una tarea

La [plantilla por vista](CLAUDE.md#plantilla-por-vista) define qué escribir, dónde vive cada dato
y cómo actualizarlo durante el trabajo diario.

`TASK-TEMPLATE.md` (en esta carpeta, **no** en `data/`: ahí todo `.md` se lee como tarea) es el
esqueleto canónico. Copialo para una tarea nueva. Su regla estructural, y el porqué de cada sección,
en `CLAUDE.md` §«La forma del cuerpo».

## Por qué existe

Dos motivos distintos que terminaron en el mismo repo:

1. **No usar los conectores MCP pre-armados.** Los de la nube (`mcp.atlassian.com`, `mcp.slack.com`) son cajas
   negras: no sabés qué endpoint llaman ni con qué token. Acá cada llamada HTTP es un método de ~20 líneas en
   `internal/`, con nuestro token y nuestro control. Agregar un endpoint = agregar un método.
2. **Ver mi desempeño sin abrir Jira.** El dashboard responde una sola pregunta —*¿voy al día en el sprint?*—
   comparando % de tareas hechas contra % de tiempo transcurrido.

Los clientes de `internal/` los comparten los tres binarios: lo que se agrega para el MCP queda disponible
para el dashboard y viceversa.

## Por consola, sin levantar nada

El dashboard es una vista, no la única puerta. Todo el dominio del tablero se lee desde la terminal —
que es lo que sirve cuando quien pregunta es un modelo, o cuando no hay ganas de abrir un navegador:

```bash
make tareas                      # las abiertas, con etapa, Jira y nodos
make tareas N=kyc-segundo        # una: separa lo PÚBLICO de lo PRIVADO y chequea el guard
make tareas STAGE=work TODAS=1 JSON=1
make tarea-json N=tablero        # estado operativo tipado, sin copiar cuerpos largos
make tarea-json N=tablero CONTENIDO=1  # agrega el borrador publicable cuando se necesita
make tareas-guard F=<archivo>    # ¿este texto puede salir a Jira? SALE 1 si no
make sprint                      # el sprint activo con puntos, del SNAPSHOT (dice cuándo se tomó)
make bitacora DAYS=7             # el tiempo registrado, por día
```

Funciona porque **los datos son archivos** (ver «Los datos») y el server lee exactamente los mismos:
no hay estado suyo al que haya que llegar, así que la consola y la UI no pueden contradecirse.

⚠ `tareas-guard` sale con **código 1** cuando el texto no puede salir. Es a propósito: sirve para
frenar antes de publicar, no sólo para informar. Corrélo ANTES de escribir lo publicable — el cuerpo
de una tarea nunca pasa, y ésa es justamente la frontera.

## Arranque rápido

```bash
cd /Users/miguelochoa/Desktop/CREDITOP/playground/tablero
npm install
cp server/.env.example server/.env    # y completá los tokens (ver "Configuración")
npm run dev
```

`npm run dev` levanta las dos cosas con `concurrently`:

- **server** → `go run ./cmd/web` en `:8787`. Al arrancar valida credenciales e imprime
  `server on · http://localhost:8787 · integraciones: Jira(Miguel Ochoa), SlackUser(...)`.
  Si no hay `.env` dice `integraciones: ninguna (.env sin credenciales)` y el front queda vacío.
- **web** → Vite en `http://localhost:5191` (elegido para no chocar con `flow` en `:5190`).

Otros scripts (verificados en `package.json`):

```bash
npm run server:build   # compila server/bin/{web,slack-mcp,jira-mcp,pulso}
npm run server:jira    # corre jira-mcp por stdio (para probar suelto)
npm run server:slack   # corre slack-mcp por stdio
npm run build          # vite build → dist/
npm test               # organización del documento, grupos y comportamiento del panel sin navegador
cd server && go test ./...   # parser, store, guard, conectores y cierre
```

## Mapa

```
tools/
├── package.json  vite.config.js  index.html
├── src/
│   ├── App.vue            ← dashboard y paneles de consulta
│   ├── main.js  styles.css  tema.css  taller.css
│   └── TaskEditor.vue  RegionMenu.vue  ui-state.js  task-document.js
└── server/
    ├── go.mod (module creditop/tablero/server) · .env · .env.example
    ├── cmd/web/main.go        ← WS :8787, 5 mensajes entrantes + /health
    ├── cmd/jira-mcp/          ← main.go (wiring) + tools.go (4 tools)
    ├── cmd/slack-mcp/         ← main.go (wiring) + tools.go (3 tools)
    ├── cmd/issue-update/      ← one-off: edita summary/descripción de un issue
    ├── cmd/issue-transition/  ← one-off: mueve un issue de estado (transición)
    ├── cmd/pulse/             ← el agente: cuándo toqué los repos de la compañía (ver "El pulso")
    └── internal/
        ├── atlassian/  client.go (Basic auth) · jira.go (API v3) · agile.go (sprints) · activity.go (changelog)
        ├── slack/      client.go · auth.go · conversations.go · messages.go · users.go (+ un test)
        ├── pulso/      pulse.go (las 3 señales de git) · store.go (jsonl + agregación por hora)
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

## La API que lee la interfaz

Casi todo es **lectura**. Lo único que escribe afuera son tres clics explícitos —importar de Jira, mover
una tarea de estado y avisarle a QA—, y adentro, refrescar la medición de ramas. Las tareas y la bitácora
**no se escriben desde acá**: las tareas las escribe el asistente en su `task.md` y la bitácora
`make bitacora-add`, que mide los minutos. *(Hasta el 2026-09-23 el server tenía además un WebSocket del
dashboard original, el guard servido a la UI, ajustes, la escritura de tareas y bitácora, y la consola de
ramas de `context`: ninguno tenía quien lo llamara, y se retiraron.)*

| Ruta | Qué devuelve o hace |
|---|---|
| `GET /api/config` | los enlaces a canon, trazador y harness (salen de `server/.env`) |
| `GET /api/efforts` | las tareas locales, con cuerpo, pendientes y artifacts |
| `GET /api/task-locals` | de qué tarea local cuelga cada clave de Jira (`{taskKey, effortId}`) |
| `GET /api/task-context?effort=` | la pila de hitos de una tarea (`tasks/<slug>/context.jsonl`) |
| `GET /api/entries?days=&sprint=` | la bitácora de la ventana, más lo del sprint elegido |
| `GET /api/sprints?board=&n=` · `GET /api/sprint?board=&id=` | los sprints recientes y mis tareas de uno (sin `id`, el activo) |
| `GET /api/jira-inbox` · `POST /api/jira-import` | lo de Jira que no está registrado, y traerlo (crea o enlaza la tarea local) |
| `GET/POST /api/transitions` | las transiciones de un issue, y aplicar una |
| `GET/POST /api/qa-notice` | la previsualización del aviso a QA, y enviarlo: mueve a pruebas y manda el DM |
| `GET /api/ramas` · `POST /api/ramas/refresh?id=` | el snapshot de ramas por tarea, y volver a medir una |
| `GET /api/pulse?days=` | el pulso agregado por día y hora |
| `GET /artifacts/<slug>/<archivo>` | un archivo de `tasks/<slug>/artifacts/` |

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
| `work` · **Trabajando** | desarrollo y pruebas; los avances se apilan acá |
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
| `canon` | a qué temas de **canon** apunta (el corpus compartido vive en otro repo) | — |
| `jira_title` · `jira_description` | el borrador de la tarea (se escribe en la etapa `tasks`) | **con guard** — termina publicado en Jira |
| `stage` | en qué etapa del método está | — |

Esa asimetría es deliberada: lo técnico y lo publicable son dos textos distintos, y el guard marca la
frontera. Por eso el detalle de archivos **no puede** vivir en las notas de avance.

⚠ **Al terminar una tarea:** lo que se **mergea** gradúa al nodo de `context` que corresponda (pasa a ser
"cómo funciona CreditOp"); lo que no se mergeó se queda acá.

### Del esfuerzo a Jira: crear, mover y notificar al evaluador

La descripción de la tarea sigue la **plantilla orientada a QA** de
[`docs/JIRA-TASK-TEMPLATE.md`](docs/JIRA-TASK-TEMPLATE.md): nivel negocio, enfocada en *cómo y
dónde validar*. Todo lo que va a Jira pasa por el **guard** (nada de repos, rutas de archivo, el
playground ni F-xx).

| Acción | Cómo |
|---|---|
| **Crear** tarea | WS `{"type":"create_task","summary":…,"description":…,"effortId":…}` → issue en `CORE`, tipo Tarea, asignado a mí, y lo mete al **sprint activo** del board 384. Con `effortId`, la clave **vuelve** al `jira:` de esa tarea local. (También `jira_create_issue` del MCP.) |
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
- El texto pasa por el **mismo guard** que los avances, *antes* de tocar Jira. Si el aviso menciona un
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

### De Jira al registro local: traer lo que está a mi nombre y no tengo

El camino inverso, y la **única** vista que crea una tarea local desde Jira: la tarjeta **“Traer de
Jira”** al final del tablero.

Existe porque todo el resto mira el **sprint** del board 384. Una tarea asignada fuera de esa ventana
—un sprint viejo, otro board— no aparecía en ninguna parte: no había dónde registrarla **ni forma de
notar que faltaba**. Esta vista pregunta por **asignación**, no por sprint.

| | |
|---|---|
| `GET /api/jira-inbox` | el **cruce**, no escribe nada. `assignee = currentUser() AND project = "CORE"`, sin las terminadas; `?all=1` las incluye y `?jql=…` reemplaza la consulta (para mirar `QC` alguna vez). Devuelve **solo lo que falta** — lo ya registrado va como número, no como fila |
| `POST /api/jira-import` | `{"create":["CORE-30"],"link":{"CORE-317":12}}` → **crea** la carpeta `tasks/<slug>/` o **enlaza** la clave a una tarea que ya existe. Idempotente por clave (`already`) |

Tres decisiones que no son obvias:

- **Acotado a `CORE`** (`JIRA_PROJECT_KEY`). A mi nombre hay 42 tareas de `LO`, el tablero anterior que
  ya no se usa: ofrecerlas en cada apertura es ruido permanente sobre trabajo que no va a volver.
- **La descripción de Jira entra en la parte PRIVADA**, no bajo `## Tarea (publicable)`. Ya está
  publicada, y varias traen rutas de archivo (CORE-159 trae una `.php`): abajo harían que guardar esa
  tarea desde la UI fallara por el guard, por un texto que nadie escribió acá.
- **Un issue cerrado nace `archived`** y con `stage: tasks`. El historial queda, pero `ls tasks/` sigue
  contestando *en qué estoy trabajando*, que es para lo que se lee esa carpeta.

El **candidato parecido** viene preseleccionado como *enlace* (no como archivo nuevo): cuando el título
viajó tal cual a Jira el parecido es ~100%, y crear un archivo duplicaría la tarea. La decisión final
es del select.

## Los datos: archivos, no base de datos

Todo vive en **`tablero/data/`** — markdown y JSON, sin servidor de base de datos. Está **fuera de
`server/`** a propósito: si el server algún día se reduce a un proxy de Jira/Slack, los datos no pueden
vivir dentro de él. `TABLERO_DATA` mueve la carpeta.

```
tasks/<slug>/                UNA TAREA = UNA CARPETA (ver abajo)      → versionado en git
data/
  entries/2026-07.jsonl      avances por tiempo, un archivo por mes      → FUERA de git (dato personal)
  pulse/2026-08.jsonl        el pulso: cuándo toqué los repos          → FUERA de git (dato personal)
  traps/                     las trampas del sistema (F-xx)           → versionado
  cache/jira.json            snapshot de Jira, descartable            → fuera de git
```

`tasks/` va al lado de `data/`: si `TABLERO_DATA` mueve una, la otra la acompaña.

Los archivos locales siguen una lista cerrada: `canon`, `context`, `harness`, `tablero`, `trazador`,
`workers` y `playground`. Cada herramienta acumula sus mejoras en su único contenedor; lo transversal
o todavía sin Jira va a `playground`. Una tarea de producto nueva nace ligada a Jira o se mantiene
como frente dentro de `playground` hasta que se decida. `make tareas` avisa y el lint falla si aparece
otra tarea local.

La API tampoco acepta crear esfuerzos locales sueltos: una tarea de producto se importa desde Jira y
una mejora interna se escribe en el contenedor ya existente.

`make tarea-json N=<slug|id>` deriva una vista `tablero.task.v3` desde ese mismo Markdown y su pila:
identidad, conteos, pendientes, la pila entera (`stack`, del bloque más nuevo al más viejo), índice de
secciones y estado del borrador para Jira. No guarda sidecars. El contrato está en
[`schemas/task.v3.schema.json`](schemas/task.v3.schema.json).
*(Hasta el 2026-09-23 era `tablero.tarea.v1`, con las claves en español; ese día pasó a `v2`, con las
claves en inglés —el mapa viejo → nuevo está en `tools/rename/maps/phase4b-json.tsv`—, y a `v3`, que
dejó `state` (la retoma y el próximo paso) y `annotations` cuando la historia del documento pasó a la
pila, y sumó `stack`.)*
Esta es la forma recomendada para workers y automatizaciones; el cuerpo privado completo se abre
sólo cuando una decisión necesita la evidencia. `CONTENIDO=1` agrega el borrador publicable; el modo
normal informa si existe, si pasa el guard, si tiene receta de QA y cuántos bytes ocupa.

**Por qué archivos y no una base:** para que el detalle técnico de una tarea se lea **sin levantar
nada** —markdown que lee cualquiera— y para que los esfuerzos tengan **historia
en git**. Una base devolvería el tablero al único rincón del playground que exige un server para leerse.

### La tarea: una carpeta en `tasks/`, con la frontera del guard adentro de su documento

`ls tasks/` muestra en qué se está trabajando, que es la pregunta que el tablero contesta. Cada tarea es
`tasks/<slug>/` con su documento `task.md`, su pila de hitos `context.jsonl` y sus `artifacts/`. El nombre
de la carpeta es el slug y se puede renombrar a mano — el `id` vive adentro, y lo que la tarea produjo se
va con ella. *(Hasta el 2026-09-23 era un `data/<slug>.md` suelto, y la pila y los prototipos se le unían
por nombre; un renombre dejó un prototipo huérfano cinco semanas.)*

```markdown
---
id: 4
title: "..."                     ← privado: nombra el esfuerzo, no sale de acá
stage: tasks                     ← evaluation | work | tasks
created: "..."
canon: [onboarding, kyc/context#validacion]  ← referencias de Canon usadas por la tarea
jira: [CORE-293]                 ← las tareas de Jira que salieron de este esfuerzo
jira_title: "..."                ← PUBLICABLE: pasa el guard
---

las notas técnicas: PRIVADO, puede nombrar repos, rutas y hallazgos

## Tarea (publicable)

la descripción que va a Jira — PUBLICABLE: pasa el guard
```

> **La regla en una frase:** todo lo que está fuera de `## Tarea (publicable)` nunca sale de local.

La frontera es **lógica y no física**: un archivo, con una marca adentro. Separarla en archivos
distintos sería redundante, porque **el guard es el mecanismo real** — corre sobre el texto antes de
publicar y ataja repos, rutas y `F-xx` (`make tareas-guard F=…` lo pregunta sin publicar nada).

### Los artifacts de una tarea (`tasks/<slug>/artifacts/`)

Algunas tareas se aterrizan más rápido mostrando el flujo que describiéndolo, y casi todas dejan algo
más que el documento: una consulta, un censo, una nota para QA. Todo eso va en la carpeta `artifacts/`
de la tarea, y la pestaña **Artifacts** lo lista entero. Un prototipo es un HTML autocontenido;
`<slug>.html` aparece como «prototipo» y, cuando hay **más de una propuesta** —otro actor, otro camino—,
`<slug>.<variante>.html` aparece con la variante como etiqueta. Verlas al lado es lo que permite decidir.

Cada artifact se abre en una pestaña del navegador, servido por el propio server
(`GET /artifacts/<slug>/<archivo>`).

No hay nada que declarar: el vínculo es el nombre del archivo. Una convención de nombre no se
desincroniza; una lista en el frontmatter que hay que mantener a mano, sí.

Lo sirve este server y no uno aparte a propósito — **un prototipo que necesita levantar su propio
puerto deja de abrirse, y entonces no se mira.** Por eso también la regla de que sea *un* archivo sin
build: si necesita `npm install`, no es un artefacto de una tarea, es una carpeta del playground con
su entrada en el `Makefile`.

Dos cosas más, que son de higiene y no de mecánica:

- **Lleva la fecha adentro, visible.** Un prototipo sin fecha se lee como estado actual; con fecha se
  lee como lo que es: lo que se acordó ese día.
- **No gradúa a canon.** Cuando la tarea se archiva, el prototipo se archiva con ella. Describe
  lo que se propuso, no cómo funciona CreditOp — y un prototipo viejo en el árbol de contexto miente
  con mucha convicción. Si algo de ahí resultó verdad perenne, se escribe en el nodo con palabras.

### Avances (`entries/`)

Sigue pensada **para análisis de tiempo**, no sólo para que la UI recargue. Las decisiones que importan:

> **Convención de idioma:** claves, identificadores y clases CSS en **inglés**; sólo el texto visible de
> la UI y los comentarios van en español.

- Un registro = un bloque de tiempo trabajado. El snapshot de Jira (`sprints`/`tasks`) es una **dimensión
  descartable** en `cache/`: se upsertea de pasada cada vez que el dashboard carga — navegar el tablero ES
  la sincronización.
- El navegador conserva aparte `tablero:bootstrap:v1` en `localStorage` para la primera pintura. Es una
  copia de lectura con vencimiento de siete días, no persistencia de negocio: cada apertura la revalida
  contra Jira y la reemplaza sólo con una respuesta válida.
- `startedAt` es cuándo **empezó el trabajo** (RFC3339 con offset local); `createdAt` es cuándo se anotó.
  La brecha entre ambos —cuánto tardás en registrar— también es un dato.
- `day` y `hour` desnormalizan el instante en hora **local** y se calculan **al crear el registro**:
  derivarlos después obliga a reinterpretar el offset, y ahí las 9am se convierten en las 14 sin que nadie
  lo note. **Agrupá por `day`/`hour`, no recalcules desde `startedAt`.**
- `minutes` (lo que pasó) convive con `uploadedMinutes` (lo que se publicó en Jira): ajustar al publicar es
  una decisión de publicación, no una reescritura de la verdad.
- `taskKey` puede ir vacío (`freeTitle` dice qué fue): reuniones y soporte no son tareas del sprint, y
  forzarlos a una envenena el análisis.
- La `note` es **publicable por construcción**: `make bitacora-add` le pasa el guard (fuente única en
  `internal/guard`) **antes** de escribir.
- Borrado **suave** (`deletedAt`): existe para recuperación administrativa; la pila visible no ofrece
  borrado ni edición.

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

Endpoint: `GET /api/entries?days=&sprint=`, de sólo lectura — se escribe con `make bitacora-add`.

### La pila de una tarea (`context.jsonl`)

`tasks/<slug>/context.jsonl` es una pila de **bloques de documentación**: cada uno muestra un título
—la conclusión, en una línea— y una descripción en prosa libre. No es un diario, no mide tiempo y nunca
se publica en Jira. La fecha es interna: sólo agrupa los bloques en el acordeón Hoy · Ayer · fechas.

Un bloque se escribe en un Markdown revisable y se valida antes de apilarlo:

```bash
make tarea-bloque N=84 ARCHIVO=tablero/docs/task-context-block.example.md SECO=1   # previsualiza
make tarea-bloque N=84 ARCHIVO=mi-bloque.md
make tarea-context N=84
```

Adentro de la descripción, un archivo va por repo y ruta —`[texto](repo:legacy-backend/ruta)`— y el
comando lo deja fijado al commit en que existe; un tema de canon, como `[texto](canon:tema#ancla)`; y
un comando, en un bloque de código `harness`, `trazador`, `sql <ambiente>` o `sh`, seguido de su
`Resultado: …`. La tabla completa de lo que se admite y lo que se rechaza está en `CLAUDE.md`,
«Bloques de la pila»; el contrato de la línea guardada, en `docs/task-context.schema.json`, y el que
valida de verdad es `server/internal/taskcontext/block.go`.

Hasta el 2026-09-23 la pila era de hitos (`kind` checkpoint · decision · blocker · evidence); los 37 que
había se migraron a bloques ese día y el formato ya no se lee. Ese mismo día entró la historia del
documento —anotaciones, Registro y retoma de las 25 tareas abiertas que los tenían: 386 bloques más, con
`via: migration`—. `make retomar` incluye los ocho bloques más recientes.

### Consultas a base de datos

`make tablero-db TARGET=<local|dev|staging|prod> SQL='SELECT …'` corre una sola consulta de sólo
lectura. No asume producción: el ambiente es obligatorio. Copiá
`tablero/server/.env.db.example` a `tablero/server/.env.<ambiente>`; cada herramienta conserva sus
propias credenciales. Con `MD=1` emite sólo el ambiente y el SQL para pegar en el documento:

````md
> **DB · prod**
>
> ```sql
> SELECT count(*) FROM user_requests
> ```
````

## El pulso (`pulse/`): cuánto trabajo hago de verdad

Los avances contestan **en qué** trabajé y los registra el asistente. El pulso contesta **cuándo estuve tocando
código** y no depende de nadie: lo anota un agente cada 5 minutos, corra o no el tablero. Son la misma
grilla de «Mi jornada» con dos fuentes, y el selector del encabezado cambia cuál se pinta.

```bash
make pulso                # mi jornada en la terminal (DAYS=7 por defecto)
make pulso-install        # siembra el pasado y deja el agente corriendo solo
make pulso-status         # ¿está vivo? último tick y actividad de hoy
make pulso-uninstall      # lo saca (lo ya registrado se queda)
```

### La unidad es el TRAMO DE 5 MINUTOS, no "los minutos trabajados"

Estimar minutos desde git es mentira prolija: un commit a las 18:00 no dice cuándo empezaste. Un tick que
sólo contesta *¿hubo cambios, sí o no?* no se puede falsear. Una hora tiene **12 tramos**, la celda se
llena con los que tuvieron cambios, y el total del día es tramos × 5′ — eso sí es una medición.

### Tres señales, y ninguna sobra

| señal | qué mira | qué prueba |
|---|---|---|
| `edit` | archivo sucio (según git) con `mtime` en la ventana | estabas editando **en ese momento** |
| `commit` | commit tuyo con **fecha de commit** en la ventana | cerraste algo |
| `reflog` | checkout, rebase, stash, pull, amend | estabas operando el repo |

`commit` sola deja huecos donde sí trabajaste (los commits se agrupan). `reflog` es lo **único** que
registra trabajo que no deja commit —hoy `legacy-backend` tiene 6 stashes—. Y `edit` es lo único que ve el
trabajo en curso: **el `mtime` se pierde al commitear**, así que si nadie lo muestrea esas horas no existen
para nadie. De ahí que esto tenga que ser un agente y no algo que corra al abrir el tablero.

Se usa la fecha de **commit**, no la de autoría: un rebase o un amend reescriben la primera, y ese momento
—cuando la reescribiste— es cuando estabas trabajando.

### Cada señal lleva su propio instante

No el del tick que la encontró. Por eso un tick corrido después de un hueco (Mac dormido, agente detenido,
fin de semana) **reparte lo que encuentra en las horas en que de verdad pasó** en vez de amontonarlo en el
momento en que se despertó. Y por eso `pulso seed` puede llenar el mapa hacia atrás: commits y reflog ya
viven en git con su fecha.

> ⚠ Un día **sembrado** es un **piso**, no una medición: un commit marca el instante, no el rato que costó.
> La grilla lo distingue — sin muestreo, la celda va rayada («sin registro»), no lisa («sin cambios»).

### Tres estados, no dos

Es lo que el pulso puede hacer y los avances no: además de *hubo cambios* / *no hubo*, sabe si el agente
**estaba mirando**. Un hueco porque el Mac estaba apagado no es un hueco de trabajo, y pintarlos igual
convertiría el mapa en una acusación falsa.

### Detalles que cuestan tiempo si no se saben

- **Los minutos por repo NO suman al total.** Dos repos pueden caer en el mismo tramo de 5′; el total de la
  celda es la **unión**. Por eso el tooltip lista repos sin minutos, y el desglose del reporte lo avisa.
- **Sólo cuentan MIS commits**, filtrados por autor: lo que baja de otras ramas con un `pull` no es mi
  jornada. Son **tres** identidades (`PULSO_EMAILS`) porque los repos no están configurados igual —
  `legacy-backend` commitea como `mig-creditop@users.noreply.github.com`.
- **El repo se nombra por su ruta relativa** (`microservices/pdf-mapper-service`), no por el último
  segmento: `onboarding-forms-service` existe suelto **y** dentro de `microservices/`, y con el nombre
  corto las dos jornadas se sumarían en una.
- **`git` se invoca con `--no-optional-locks`**: corre en background y no puede quedarse con el lock del
  index justo cuando estás haciendo un commit a mano.
- **El agente es un LaunchAgent, no un cron**: arranca con la sesión y corre cada 300 s. Si el Mac está
  dormido no corre, y está bien — dormido no estabas trabajando. Log en
  `~/Library/Logs/tablero-pulso.log`.
- **El `plist` lleva `PATH` explícito**: launchd no hereda tu shell, y sin eso `git` puede no existir para
  el agente — el pulso "no haría nada" en silencio, que es el peor modo de fallar.

Endpoint: `GET /api/pulse?days=20` → una celda por (día, hora) con `slots`, `covered`, `commits`, `ins`,
`del` y el desglose por repo. El server **no** genera el pulso, sólo agrega el `jsonl` y lo sirve.

Es JSONL, así que también se analiza con `jq`:

```bash
# ¿en qué repos se me va la semana? (tramos, no commits)
jq -s '[.[].signals[]?] | group_by(.repo)[]
       | {repo: .[0].repo, señales: length}' data/pulse/*.jsonl

# ¿qué ramas toqué y cuándo?
jq -r '.signals[]? | select(.why=="commit") | "\(.at[0:16])  \(.repo)  \(.branch)"' data/pulse/*.jsonl
```

## Configuración (`server/.env`)

| Variable | Para qué | Default |
|---|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-` — lo usa sólo `cmd/slack-mcp`; la API del tablero escribe como vos | — |
| `SLACK_USER_TOKEN` | `xoxp-` — DMs "como vos" (`chat:write`, `im:write`, `users:read.email`) | — |
| `ATLASSIAN_SITE` / `_EMAIL` / `_API_TOKEN` | Jira Cloud, Basic auth | — (faltando uno, Jira off) |
| `JIRA_PROJECT_KEY` | proyecto de las tareas nuevas | `CORE` |
| `JIRA_TASK_TYPE_ID` | tipo de issue de `cmd/issue-create` | `10005` (= "Tarea" en CORE) |
| `JIRA_BOARD_ID` | board cuyo sprint activo se usa | `384` |
| `QA_SLACK_EMAIL` | a quién le llega el DM al pasar a pruebas | `duncan.estrada@creditop.com` |
| `JIRA_TESTING_STATUS` | **subcadena** del estado "listo para probar" | `pruebas` (matchea `🧪 En pruebas`) |
| `WEB_PORT` | puerto de la API | `8787` |
| `CANON_URL` | API y enlaces de Canon | `https://canon.playground.creditop.com` |
| `TABLERO_DATA` | dónde vive `data/` | `../data` (relativo al cwd del server) |
| `TABLERO_RAMAS_ROOT` | repos que mide **Refrescar ramas** | `~/Desktop/CREDITOP/github` |
| `PULSO_ROOT` | dónde viven los repos que mira el pulso | `~/Desktop/CREDITOP/github` |
| `PULSO_EMAILS` | mis identidades de commit, separadas por coma | las 3 de Miguel (ver `internal/pulse`) |
| `PULSO_EXTRA` | repos FUERA de la raíz que también son jornada, como `nombre=/ruta` separados por coma. El nombre va explícito porque el último segmento puede chocar con uno de la raíz (`playground` vs `github/playground`) | vacío — el playground personal no cuenta hasta que se declara |

Las tres últimas también salen de `server/.env` (`pulso` lo carga igual que el server: `LoadDefaults` lo
busca junto al binario y en su carpeta padre, así que lo encuentra aun corriendo con `cwd=/`). Además,
`pulso install` congela sus valores en el `plist` — y **eso gana** sobre el archivo, porque el entorno
tiene prioridad. Si cambian, reinstalá: `make pulso-install`.

API token de Atlassian: <https://id.atlassian.com/manage-profile/security/api-tokens>.
Slack app y scopes: <https://api.slack.com/apps> → OAuth & Permissions → Install to Workspace.

## Gotchas

- **`JIRA_PROJECT_KEY`, `JIRA_TASK_TYPE_ID`, `JIRA_BOARD_ID` y `WEB_PORT` no están en `.env.example`.**
  Existen sólo como default en el código (`cmd/web` y `cmd/issue-create`). Si el board o el tipo de issue
  cambian, el síntoma es una tarea creada en el lugar equivocado, no un error. (`QA_SLACK_EMAIL` y
  `JIRA_TESTING_STATUS` sí están documentadas en el `.env.example`.)
- **`WEB_PORT` solo no alcanza:** el front apunta a `http://localhost:8787` salvo que `VITE_TABLERO_API`
  diga otra cosa (`App.vue`, la constante `SERVER`). Si movés el puerto, mové las dos.
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
- **Agregar al sprint es best-effort.** Si `ActiveSprint` o `AddIssuesToSprint` fallan, la tarea **igual queda
  creada** (fuera del sprint) y el resultado no marca error. Vale para el MCP y para `cmd/issue-create`.
- **`/rest/api/3/search` (el viejo) devuelve 410 desde oct-2025.** Por eso todo va a `/search/jql`, que
  además exige JQL restringida: una consulta sin filtros es rechazada por el endpoint.
- *(Acá decía que `src/scorecards/` estaba huérfano —4 componentes + `data.js` con los Rocks de
  Tecnología Q3 2026 que nadie importaba—. Se borró el 2026-09-19, con los ocho alias de color que
  existían sólo para él. Si hace falta recuperarlo: `git show bc4aa91:tablero/src/scorecards/…`.)*
  `dist/` sigue siendo un build viejo (gitignoreado).
- **Ninguno de los dos conectores está registrado hoy** — `claude mcp list` (2026-07-19) solo muestra los
  remotos de claude.ai. Hay que correr el `claude mcp add` de arriba antes de esperar que un modelo los use.
- **`server/.env` tiene secretos reales** y está en `.gitignore` junto con `node_modules/`, `dist/` y
  `server/bin/`. Convención del playground: **commit local, sin push.**

## Docs relacionados

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — mapa corto de datos, UI, consola y contexto.
- [`server/README.md`](server/README.md) — instalar y probar los conectores MCP de Jira y Slack.
- **canon** — el contexto curado de CreditOp, compartido con el equipo, en otro repo
  (`github/playground/tools/canon`). *(Acá apuntaba a `../context/`, que se apagó el 2026-09-21.)*
- `playground/docs/` **ya no existe** (absorbido por `context/`, que a su vez graduó a canon): si algún doc
  apunta ahí, es puntero roto.
