# Wally — un chat con agentes: Claude (el Bedrock de CreditOp) por defecto, y Gemini por su web

Para hacerle preguntas a Gemini sin abrir AI Studio: a la izquierda las conversaciones guardadas (con buscador y por
día: Hoy, Ayer, Últimos 7 días, Antes); al centro, **en pestañas, las abiertas** —varias a la vez, cada una con su
borrador y su modelo—, y abajo el campo, que crece con lo escrito. Cada respuesta dice con qué modelo salió, cuánto
tardó y a qué hora; un bloque de código lleva su lenguaje y su «Copiar».

**Las pestañas** siguen la gramática del taller (`tools/ui/README.md`, «documentos abiertos»): un clic en la lista
abre la conversación de paso (itálica, la reemplaza el próximo clic); doble clic, o mandar una pregunta, la deja fija;
«+» abre una nueva; ✕ o el botón del medio la cierran. Se recuerdan en esta máquina (`wally.tabs`). Mientras una
espera respuesta, su pestaña y su fila laten, y en las otras se escribe pero no se manda (las preguntas van de a una).

**Los nombres del protocolo están en inglés** (2026-11-18, regla de my-tools: el código en inglés, lo que se ve en
español). Lo que pide un agente: `help`, `commands`, `traps`/`trap`, `task`, `guide`, `write`, `patch`, `list`,
`read`, `check`, `build`, `test`, `check-api`, `console` (y `with-api` adentro), `changes`, `sources`, `grep`, `code`;
los bloques ```` ```command ````, ```` ```file ```` y ```` ```patch ```` (`SEARCH`/`REPLACE`); la
carpeta `wally/sandbox/` (servida en `/sandbox/`) con su `criteria.json` (páginas: `name`, `page`, `steps` con `click`,
`type {field, text}`, `select {field, option}`, `check`, `see`, `not_see`; APIs: `request {method, path, body}` y
`expect {status, contains, not_contains}`); los estados `proposed · running · ran · dismissed · not-allowed`; el modo
`assistant`; y las habilidades `code`, `tools`, `knowledge-sync`, `sandbox`, `tasks`, `traps`. El texto que lee el
modelo (WALLY.md, las habilidades, las notas entre vueltas) sigue en español. **Los nombres de antes siguen
funcionando** (`server/legacy.go`): un modelo que los escribe por su historia queda traducido, los dos checadores
aceptan las claves viejas, lo guardado se migró al cargar y `wally/pruebas/` pasó a `wally/sandbox/` con sus criterios.

**Por defecto contesta CLAUDE, por el puente de canon** (decisión de Miguel, 2026-11-18: «el que se usa en lo
agéntico; Gemini o DeepSeek, opcionales»; `server/claude.go`). Es Claude Sonnet 5.5 en el Bedrock de CreditOp, el
mismo modelo de canon en producción, por el puente `/api/model/stream` que canon deja para usarlo sin credenciales de
AWS. El cliente es el conector `connectors/claude` (el mismo de lo que corre en segundo plano, `bin/pg model ask`). **Es el único que no va por la web ni por el pool**: es una API, no necesita Chrome ni Jarvis, y el contexto no
sale de la cuenta de la empresa, así que los agentes van por él sin el permiso `agentsOther` (sin permiso, un agente
que tiene elegida una web de afuera ahora cae en Claude, no en Gemini).
- **El camino**: `canon.playground.creditop.com` pide Google en el balanceador aunque lleve la llave (302), así que va
  por el GATEWAY del home, como el CLI `playground`: `POST https://playground.creditop.com/api/t/canon/api/model/stream`
  con la sesión de `playground login` (`~/.config/creditop-playground/token.json`) y `x-canon-key`. La llave no se
  copia: `CANON_PROXY_KEY` del proceso, o la del `tools/canon/.env` del clon del playground compartido
  (`CANON_PROXY_KEY` o `CANON_WRITE_KEY`). Sin sesión o vencida, «Servicios» lo dice (`sin-sesion`: `playground login`).
- **Con stream** porque sin él el puente corta a los 55 s; los eventos de Anthropic se juntan en texto
  (`readClaudeStream`), y un corte por tope de tokens (16.384) se avisa al final de la respuesta.
- **Chat temporal**: cada vuelta reenvía toda la conversación, y lo paga la empresa; compacta a 400 mil caracteres
  (`providers.json`). El puente deja 4 invocaciones a la vez por instancia, compartidas con canon.
- **La comprobación** es `GET /api/model` (modelo y región, sin invocar nada), junto con la de las webs.
- **Probado el 2026-11-18**: en el chat de Wally, en Auto, «¿ya nos pasó que el OTP no valide en staging?» → índice de
  trampas → `trap F-135` → la causa, los dos arreglos, el rodeo y qué no verificó: **4 vueltas, 15 s** (la misma
  pregunta por DeepSeek el 17/11: 4 vueltas, 97 s). Comparado con F-135: exacto.

**A la vista, sólo Claude y Gemini** (Miguel, 2026-11-18: «dejemos sólo Claude y Gemini por ahora»). DeepSeek, ChatGPT
y Groq quedan **deshabilitados, no borrados** (`hiddenProviders`, `server/config.go`; `SHOWN_PROVIDERS` en la
interfaz): no se listan, no se pueden elegir (400) y una configuración guardada con uno vuelve a Claude; sus recetas y
`bin/deepseek`, `bin/chatgpt`, `bin/groq` siguen andando por consola. Kimi («Próximamente») tampoco se lista. Lo que
[`HISTORY.md`](HISTORY.md) cuenta de ellos es de cuando estaban a la vista. Para volver a mostrar uno, sacarlo de las dos
listas.

**Gemini sigue por la web, como opción** (decisión de Miguel, 2026-11-17, cuando era el único camino): cada pregunta la hace `bin/aistudio` (la
receta `jarvis/recipes/aistudio/ask.ts`) en su Chrome con Jarvis, con su cuenta y en un chat temporal de AI Studio
(no queda en el History ni en Drive). Usa el uso gratuito de la web, que acepta textos enormes, y no la cuota de una
llave. La primera versión, del mismo día, llamaba a la API con la llave de `connectors/.env` y se retiró por eso.

| pieza | qué es |
|---|---|
| `make wally` | levanta la interfaz (:5228, Vue) y la API (:5229, Go). En Cockpit es la app Wally |
| `make wally-install` | **la API de fondo** (LaunchAgent `com.creditop.my-tools.wally`, binario `wally/bin/wally-server`, desde el 2026-11-18): `bin/wally` y los agentes andan con Cockpit cerrado o con Wally oculto. Con ella instalada, el servidor de `make wally` espera el puerto y la interfaz usa la de fondo. **Después de cambiar el servidor: `bin/cockpit restart wally --wait`** (la recompila y la recarga) o `make wally-install`. `make wally-status` · `make wally-uninstall`. Su salida: `~/Library/Logs/my-tools-wally.log` |
| `server/main.go` | la API: `GET /api/models`, `GET/DELETE /api/conversations[/<id>]`, `DELETE /api/conversations/<id>/messages/<bloque>`, `POST /api/ask {id?, model, text, files?}` |
| `server/config.go` | la configuración (`GET/PUT /api/config`, en `.data/config.json`) y lo de hoy (`GET /api/usage`); en el sidebar derecho |
| `server/agents.go` | los agentes: `GET/POST /api/agents` (abajo) |
| `server/claude.go` | Claude por el puente de canon (el de siempre): la pregunta por stream y la comprobación |
| `server/pool.go` · `server/topics.go` | el pool de las webs (todas las preguntas que no son de Claude) · la lista de temas de knowledge para el formulario de un agente |
| `server/files.go` | los adjuntos: `POST /api/files` (multipart, campo `file`), `GET/DELETE /api/files/<id>` |
| `src/App.vue` | la interfaz; la ruta es la pestaña activa: `#/c/<id>`, o `#/nueva/<n>` para una sin preguntas |
| `wally/.data/conversations.json` · `wally/.data/files/` | lo guardado y el texto de los adjuntos (fuera de git) |

## Los modelos por su web, por consola (vivía en el `CLAUDE.md` raíz hasta el 2026-11-18)

Sin Wally: cada uno maneja su web en tu Chrome con Jarvis y tu cuenta. **De a una**: Google corta la cuenta si se le pide
mucho seguido. Para lo agendado o sin Chrome, `bin/pg model ask` (Claude, `connectors/CLAUDE.md`).

| para… | comando | ojo |
|---|---|---|
| un texto enorme a Gemini (400-500 mil tokens) sin gastar la cuota de una llave | `bin/aistudio --file doc.md --prompt '…' [--model gemini-4-hydrogen] [--out r.md] [--json]` | 2 MB de texto en ~18 s |
| texto a voz | `bin/aistudio speak --text '…' --out voz.wav [--voice Enzo]` | |
| transcribir un audio | `bin/aistudio transcribe audio.wav [--out t.md]` | ⚠ sube el audio a Google (queda en tu Drive): nada con datos de clientes |
| Gemini con llave de API y sus opciones (búsqueda, código, JSON) | `bin/pg gemini ask` | gasta la cuota de la llave |
| DeepSeek | `bin/deepseek --prompt '…' [--no-think] [--search]` | ⚠ queda en su historial y en servidores en China: nada interno ni de clientes |
| ChatGPT | `bin/chatgpt --prompt '…' [--think]` | chat temporal; gratis, hasta ~40 mil caracteres |
| Groq | `bin/groq --prompt '…'` | el ultra rápido (~480 tokens/s); hasta ~20 mil caracteres: para lo corto |

## Los agentes, por consola: `bin/wally`

`bin/wally agent create --name … --intent '…' [--notes '…'] [--file f]… [--topic t]… [--skill s]…` · `agents` ·
`agent update <nombre> --notes-file n.md` · `agent delete <nombre>` · `skills` · `new` · `delete <id>` ·
`compact [--agent n]` · `ask [--agent n] [--auto | --resume] '…'`. Lo hace Claude cuando Miguel lo pide, y aparece solo
en Wally. El detalle de cada uno, en [`HISTORY.md`](HISTORY.md).

## Lo que hay que saber para usarlo o cambiarlo

Cada punto es la regla vigente en una o dos líneas. El porqué, las mediciones y cómo se llegó a cada una están en
[`HISTORY.md`](HISTORY.md), bajo el mismo título en negrita.

**Cómo conversa**
- **La conversación la guarda Wally, en bloques** (`.data/conversations.json`): cada pregunta le manda al modelo todos
  los bloques guardados. Cualquier bloque se borra; al pasar el tope del proveedor (`providers.json`, `compactChars`) lo
  viejo se **compacta** en un resumen y el original queda en `.data/archive/`.
- **Toda conversación es del asistente**: contesta con [`WALLY.md`](WALLY.md) (la base, corta) y puede pedir comandos.
  Las **habilidades** (`skills/*.md`) se piden con `help <nombre>`; agregar una es agregar un archivo.
- **El proveedor es uno para todo**, el de la barra de escribir (se guarda en la configuración). Claude por defecto;
  Gemini por su web necesita Jarvis conectado en Chrome y tiene cupo diario por modelo.
- **Una pregunta por conversación a la vez** (2026-11-18): la segunda sale 1 al instante («ya hay una pregunta en
  curso», 409) en vez de mezclar sus bloques con los de la primera. Conversaciones o agentes distintos van en paralelo.
- **Los adjuntos no se suben al proveedor**: Wally les saca el texto en esta máquina y viaja con la pregunta.

**Qué puede correr un agente (la seguridad está acá, no en el modelo)**
- ⚠ **Qué se corre lo decide el servidor**: la lista blanca (`allowList`, `server/commands.go`), con los argumentos
  validados y sin shell. Todo es de lectura. Afuera a propósito: bases, logs, PostHog, datos de clientes o de producción
  y la pila de las tareas. Para sumar un comando: su línea en `allowList`, su caso en `commands_test.go` y su habilidad
  (`TestSkillsMatchTheAllowList` comprueba que digan lo mismo).
- ⚠ **Lo único donde un agente escribe es `wally/sandbox/`** (fuera de git): archivos enteros (` ```file `) o parches
  (` ```patch `, `SEARCH`/`REPLACE`), con ruta, tipo y tamaño validados. Lo escrito se sirve AISLADO (`/sandbox/…`, sin
  red ni acceso a Wally).
- ⚠ **Lo único que se ejecuta de lo que escribe un modelo es Rust, en un contenedor sin red** (`make wally-rust` arma
  la imagen): `build`, `test`, `check-api` y `console sandbox/<proyecto> <comando>`.
- **Datos de producción**: sólo los agregados de Sentinel (`sentinel now|day|deploy`), nunca de clientes.

**El modo automático**
- **Vive en el servidor** (`server/autorun.go`): `bin/wally ask … --auto` o el alternador «Auto» arrancan una corrida
  que sigue aunque se cierre la ventana; Ctrl-C o «Frenar» la paran. Hasta 12 vueltas.
- **El freno**: un agente no cierra si escribió después de su último `check` o si algo quedó en rojo; y un **revisor**
  aparte comprueba que los criterios (`criteria.json`) cubran lo pedido.
- **Reintenta y se retoma**: dos reintentos si falla el proveedor; una corrida cortada queda con «Retomar»
  (`bin/wally ask --agent <n> --resume`).
- Al terminar avisa por macOS y queda «sin ver» (el numerito de Wally en Cockpit).

**Los agentes** (cada uno es UNA conversación larga con nombre, intención, notas, archivos, temas y habilidades; no
hablan entre ellos; los grupos se sacaron)
- **Los nueve de knowledge** (Pikachu KYC · Charmander CreditopX · Bulbasaur entidades · Squirtle tienda y caja ·
  Snorlax el camino de una solicitud · Jigglypuff el cierre · Magnemite dispositivos y renting · Meowth comercios y
  admin · Alakazam el mapa general): llevan precargado el `rules.md` de sus temas y el estado de sus fuentes.
- **Mew** diseña las pruebas de una tarea (`agents/mew.md`) · **Noctowl** da el dictamen de producción con Sentinel
  (`agents/noctowl.md`; Sentinel lo arma solo cada mañana con esas mismas notas) · **Porygon** revisa qué cambió en
  knowledge (`agents/porygon.md`; desde el 2026-11-18 lo hace sola la herramienta Knowledge, `knowledge-flow/`) ·
  **Smeargle** arma páginas y **Krabby** APIs en Rust, en `sandbox/` (`agents/smeargle.md`, `agents/krabby.md`).

**Al cambiar Wally**
- Su API corre de fondo: después de tocar el servidor, `bin/cockpit restart wally --wait`. La interfaz se recarga sola
  (Vite), salvo por lo que escribe un agente en `sandbox/`.
- Borrar es con dos toques, sin `confirm()` (dentro de Cockpit no existe).
- Lo que contesta el modelo se trata como no confiable: el HTML crudo sale como texto.
- Para ver la vista previa de una página de `sandbox/`, `make ui-shot` (el navegador embebido de la sesión bloquea los
  iframes).
