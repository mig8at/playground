# CREDITOP · my-tools

Espacio propio de Miguel: organiza el conocimiento de **CreditOp** (fintech colombiana de originación
de crédito) y agrupa las herramientas de prueba. Existe para que un modelo entienda **antes** de atacar
una tarea.

⚠ **«playground» es OTRO repo.** Este se llamó `playground` hasta el 2026-11-13 y se renombró a **`my-tools`**
(`~/Desktop/CREDITOP/my-tools`; su remoto personal sigue siendo `mig8at/playground`) porque había dos con el mismo
nombre. Desde entonces **playground** es SÓLO el compartido de la compañía: `Creditop-SAS/playground`, clonado en
`~/Desktop/CREDITOP/github/playground`, con su CLI `playground`, canon y `*.playground.creditop.com`; en las tareas,
el nivel `playground` y el alias citable `playground-equipo`. Una cita vieja a «playground local», a
`~/Desktop/CREDITOP/playground` o a «el playground» fuera de git habla de **my-tools**: corregila al encontrarla.
**La regla:** lo que viene del repo de GitHub compartido (su CLI `playground`, canon, `~/playground/team`, sus dominios)
conserva el nombre; lo que es interno de my-tools —rutas, variables, servicios, apps, etiquetas— dice my-tools, aunque la
herramienta use el CLI compartido. El chat es el caso mixto: herramienta de my-tools que habla por ese CLI
([`chat/CLAUDE.md`](chat/CLAUDE.md)).

## ⚠ Idioma: el código en inglés, lo que se ve en español

Decisión de Miguel (2026-11-18), para todas las herramientas de my-tools:

- **En inglés, todo lo que es código**: carpetas, archivos, identificadores, claves JSON, clases CSS, rutas de API,
  comandos, opciones y lo que imprime un CLI, targets y variables de `make`, verbos de protocolo y valores internos.
- **En español, lo que ve una persona**: el texto de las interfaces, la documentación (`CLAUDE.md`, `knowledge/`, las
  tareas) y los comentarios del código. **Claude contesta en español.**
- **Se quedan los nombres propios** de las herramientas (`tablero`, `harness`, `wally`, `jarvis`, `sentinel`…) y los datos.
- **La vara es `make tablero-naming`**: falla con un nombre nuevo en español. Al renombrar un comando o un target, el
  nombre viejo sigue como alias.
- Las excepciones (las claves de los contratos del harness siguen en español) y cómo se paga la deuda:
  [`tools/CLAUDE.md`](tools/CLAUDE.md) §«El idioma del código».

Este archivo lleva sólo lo que cambia una decisión en CUALQUIER tarea. Lo que sirve al tocar algo
concreto vive al lado de ese algo, y se lee ahí:

| al tocar… | leé |
|---|---|
| estilos o la forma de una UI (tema, regiones, separadores) | [`tools/ui/CLAUDE.md`](tools/ui/CLAUDE.md) |
| el diseño de una herramienta, cómo se valida contra otra, o **qué se puede correr en paralelo** (varias sesiones o subagentes) | [`tools/CLAUDE.md`](tools/CLAUDE.md) |
| una tarea del tablero, el cierre de sesión, Jira | [`tablero/CLAUDE.md`](tablero/CLAUDE.md) |
| el harness, o qué es real en cada ambiente | [`harness/CLAUDE.md`](harness/CLAUDE.md) |
| Jarvis (configurar paneles admin con guía o con confirmación, en tu Chrome con su extensión; recetas por API y por pantalla; `bin/jarvis`) | [`jarvis/CLAUDE.md`](jarvis/CLAUDE.md) |
| Cockpit (la app de escritorio donde Miguel ve las herramientas: `bin/cockpit`, quién levanta cada servidor, agregar una app, reinstalar) | [`cockpit/CLAUDE.md`](cockpit/CLAUDE.md) |
| Correo (los correos de los remitentes que se siguen en Gmail, con aviso: `make correo`, `bin/correo`, `bin/pg gmail`; el `correo:` de una tarea) | [`correo/CLAUDE.md`](correo/CLAUDE.md) |
| conocimiento local: leerlo, verificarlo, editarlo | [`knowledge/CLAUDE.md`](knowledge/CLAUDE.md) |
| Knowledge (el vigía de knowledge/: mira main y la pone al día sola, paso a paso; `make knowledge-flow`; por consola `bin/knowledge status\|run\|decide\|resume`) | [`knowledge-flow/CLAUDE.md`](knowledge-flow/CLAUDE.md) |
| el Llavero (tus llaves en llaveros, cifradas; `bin/pg vault`, `make vault`, exportar e importar) | [`vault/CLAUDE.md`](vault/CLAUDE.md) |
| Sabueso (encontrar comercios y entidades que no trabajan con CreditOp y llevar la relación: `make sabueso`) | [`sabueso/CLAUDE.md`](sabueso/CLAUDE.md) |
| News (lo nuevo de Hugging Face cada semana: lo más innovador, los modelos documentados, los papers; `make news`) | [`news/CLAUDE.md`](news/CLAUDE.md) |
| Minutes (grabar una reunión sin tomar notas: pantalla, micrófono y sistema, transcripción en vivo y un resumen que cruza lo dicho con lo visto; `make minutes CMD=start\|stop`, `bin/minutes`) | [`minutes/CLAUDE.md`](minutes/CLAUDE.md) |
| point (dónde tocar en una captura: `bin/point captura.png '¿dónde le doy para continuar?'`, con un modelo de visión en la Mac) | [`point/CLAUDE.md`](point/CLAUDE.md) |
| los modelos de IA de la Mac: qué herramienta usa cuál, borrar lo que nadie usa, reemplazar uno por otro mejor (`bin/models`) | [`models/CLAUDE.md`](models/CLAUDE.md) |
| Goldfish (validar un PR con Elephant-Goldfish: `make goldfish`, `make goldfish-run PR=<url>`) | [`goldfish/CLAUDE.md`](goldfish/CLAUDE.md) |
| Office (la llamada en papel cortado, el editor de personajes y su CLI: `make office`, `make office-character`) | [`office/CLAUDE.md`](office/CLAUDE.md) |
| la tienda VTEX de pruebas (tema, checkout, auto-onboarding con CreditOp) | [`tienda-simple/VTEX.md`](tienda-simple/VTEX.md) |
| poner `knowledge/` al día contra main | [`tools/knowledge-drift/CLAUDE.md`](tools/knowledge-drift/CLAUDE.md) · `make knowledge-drift STEP=…` |

## `make` es la puerta única

`make` sin argumentos lista todo lo que se puede correr, agrupado por para qué sirve, con los
parámetros de cada uno. El hook `SessionStart` (`tablero/server/internal/hooks`) inyecta los NOMBRES al
arrancar, al reanudar y después de compactar, junto al catálogo LOCAL de `knowledge/`.
`make knowledge-map` lista títulos y resúmenes; `make knowledge-check` detecta
cambios en sus fuentes contra el `main` de los clones sólo-main (`~/Desktop/CREDITOP/main-clones`, compartidos con el proceso de canon del repo compartido), sin fetch:
antes, `make knowledge-check FETCH=1`, que trae main a esos clones sin tocar los de trabajo.
Acá va lo que `make` no puede decir: **cuál elegir, y
contra qué ambiente**. Convención de nombres: los nombres propios se quedan (`tablero`, `harness`,
`panel`) y los verbos van en inglés (`align`, `refs`, `seal`, `check`), como `proyecto-verbo`.

⚠ **Antes de decir «no tengo acceso a eso», mirá el catálogo.** Loki, Redash, las cuatro bases de
datos, PostHog, Confluence, Jira, Slack y Google Drive (`bin/pg drive`, tras `drive login`) ya están cableados y con credenciales. El error caro no es no
tener la herramienta: es suponer que no está y contestar de memoria.

### Cockpit: donde Miguel ve las herramientas, y lo que hacés

Las interfaces de my-tools —chat, tablero, el panel del harness, Jarvis, Designer (el visor),
ecommerce, Sentinel, Correo, Minutes y Wally (un chat con Gemini por la web de AI Studio: [`wally/CLAUDE.md`](wally/CLAUDE.md))— viven juntas en **Cockpit**, la app de escritorio de Miguel (`make cockpit` la instala). Cambia tres cosas
en cualquier tarea:

- **Lo que hacés se ve solo.** Cada herramienta que usás llega al panel «Claude» de Cockpit, y USAR una (correr el
  harness, escribir en una tarea) trae su app al frente en esa ruta. `bin/cockpit say "…"` es para la intención y
  las conclusiones; `bin/cockpit open <app> [ruta]`, para llevarlo a un lugar; `bin/cockpit logs <app> [--errors]`, para ver por qué una app se portó raro; `bin/cockpit restart <app> --wait`, para que
  una app tome un cambio en su servidor (vuelve cuando contesta de nuevo) (una que se cae vuelve sola). Sin Cockpit abierto, nada de esto bloquea.
- **¿Qué puedo usar ahora?** `bin/cockpit doctor` (~4 s, `--json`): red, AWS, las sesiones (playground, `gh`), el
  modelo de fondo, las apps y los servicios de fondo. Antes de un trabajo largo, miralo.
- **Una app apagada u oculta no te frena**: `bin/wally` y `bin/jarvis` levantan la suya solos; para otra,
  `bin/cockpit ensure <app>` (no la trae al frente).
- **Antes de levantar un servidor, mirá si ya está arriba**: `bin/cockpit status`, o el aviso COCKPIT de este
  arranque. Cockpit levanta cada app con su `make` la primera vez que Miguel la abre, y un segundo `make tablero`
  choca por el puerto.
- **Los servicios de fondo** (el chat, sentinel, correo, knowledge, wally, jarvis, el pulso y la daily) y el listen del chat salen en el aviso KEYRING de
  cada arranque, con su arreglo si se cayeron (`make keyring ONLY=background`).
- **Si Miguel toca «Frenar»**, la siguiente herramienta sale negada: contá en una línea dónde quedaste y esperá.

Quién levanta qué, las rutas de cada app, cómo verificar una interfaz y cuándo hay que reinstalar:
[`cockpit/CLAUDE.md`](cockpit/CLAUDE.md).

### Qué herramienta según qué estás preguntando

| Tu pregunta | Con qué se contesta |
|---|---|
| **¿cómo funciona X técnicamente?** | [`CREDITOP.md`](CREDITOP.md): el índice de `knowledge/` por paso del recorrido y por entidad, con el `tema#ancla` que contesta cada pregunta. Si no está, `make knowledge-search Q='…'` → `make knowledge-read ID=…`. Verificá su alcance en el código de `main`; si falta el tema, investigá el código directamente. La biblioteca es una ayuda, no un paso obligatorio |
| **me falta conocimiento de negocio o producto que no puedo comprobar en local** | Confluence (`make confluence`) y la documentación del equipo. Canon, el corpus del equipo, NO es de my-tools: si hace falta, se lee con el CLI compartido (`playground canon search\|read`). Citá la fuente y señalá lo que queda sin verificar |
| **arranco una tarea como agente** | `make agent N=…` (`ENV=1` mira el ambiente local, `JSON=1` para un agente): la tarea, su criterio de «hecho» (`## Specs`), las trampas que pueden tocarla, si las fuentes de sus temas siguen al día y qué suites los comprueban, y el recorrido de trabajo con los comandos puestos. El veredicto por spec: `make task-verify N=…` |
| **¿el plan de la tarea se sostiene sin mí?** (antes de tocar un repo real) | el subagente **`goldfish`**: le pasás SÓLO la ruta del `task.md`; lo lee sin la conversación ni este archivo y devuelve supuestos sin escribir, criterios que no se pueden volver `S#` y afirmaciones para `main-verifier`, cada una con su línea. Revisa el documento, no el código |
| **retomo una tarea del tablero** | `make resume N=…`: pila, documento y temas locales declarados en `knowledge:`. Sin red ni VPN. Una tarea no cita canon: cita knowledge |
| **¿ya nos pasó?** | `knowledge/traps/traps.md`, entrando por su índice de síntomas |
| **¿qué se quiere en crédito, cómo vamos, qué se decidió?** (metas, prioridades, estrategia) | [`knowledge/meetings/weekly-ct.md`](knowledge/meetings/weekly-ct.md): la Weekly CT semana a semana, y `background.md` con otras reuniones. Son cosas DICHAS, no medidas: una cifra se mide en la base antes de usarla. Ponerla al día: `make meetings-fetch` |
| **¿por qué existe esta regla?** (política, contrato, qué se le ofreció al comercio) | `make confluence`: el porqué del negocio no está en el código |
| **¿qué archivos toco o cómo verifico una afirmación técnica?** | el código de `main` con `git grep` contra la rama, nunca el working tree. La ref de cada repo: `go run ./cmd/repos ref <alias>` desde `tablero/server`. **En los dos monolitos**, o la afirmación sale falsa con evidencia real. Para verificar una afirmación, delegala al subagente **`main-verifier`**: mira los dos, sin tocar nada, y devuelve veredicto con archivo:línea |
| **¿esto pasa de verdad, y cuánto?** | `bin/pg sql --target prod --query 'SELECT …'` (o `make tablero-db TARGET=prod SQL=…`) |
| **¿qué le pasó a ESTA solicitud?** | en **prod**, el tracer del equipo (`tools/tracer` del playground compartido), por cédula, celular o solicitud. Fuera de prod: `make ecommerce` (o `cd ecommerce && go run ./server -target qa -q …`; [`ecommerce/README.md`](ecommerce/README.md)), `make harness-loki UREQ=… TARGET=…` para los logs y `bin/pg sql` para la base. Escribí `TARGET=` siempre (F-234). ⚠ La basura de ecommerce BORRA cualquier solicitud, también en qa y sin `I_KNOW_THIS_TOUCHES_SHARED_DEV` (decisión de Miguel, excepción a F-53 sólo para esa operación), con confirmación y copia en `ecommerce/.backups/` |
| **¿qué hay de esta CÉDULA?** (cliente activo, bajas, centrales consultadas, quién decidió el nombre) | `bin/pg client state --target T --document N`. Sólo lectura, también prod. Para repetir un registro, la baja es `bin/pg admin client-disable` (local, dev; nunca prod) |
| **¿esta SUCURSAL va a consultar Experian, y por qué?** | `bin/pg experian check --target T --hash H`: los atajos que lo fuerzan (CreditopX, entidades o comercio en la lista) y, si no, la periodicidad del comercio. Sólo lectura, también prod |
| **¿anda en local y no en qa? ¿qué setting cambia entre ambientes?** | `bin/pg settings diff --targets local,dev,prod [--key texto]`: las credenciales sólo se comparan por huella |
| **¿por qué estados pasó esta solicitud y quién la movió?** · **¿cómo terminó y con qué cuenta consultó cada central?** · **¿qué falló en la cola?** | `bin/pg request timeline --target T --ureq N` · `bin/pg request verdict --target T --ureq N` (el dictamen: desenlace y código de cancelación, centrales con su cuenta, la tabla `logs` y Loki) · `bin/pg jobs failed --target T --hours 24`. Las dos, sólo lectura; desde el harness, `harness/pkg/backend-reads.ts` |
| **leí un error, ¿de qué archivo salió?** | `git grep -n -F '<mensaje>' <ref de main>` en **los dos monolitos**: el texto fijo del mensaje lleva al archivo que lo emite |
| **¿qué VIO el cliente en pantalla?** | `make harness-posthog UREQ=… TARGET=… TEL=…` (`bin/pg events request`): eventos, bitácora del front y replay. ⚠ Sin `TEL` ves la mitad: la fase de AUTH se identifica por teléfono. Qué pantallas fallan en el ambiente: `make harness-posthog-errors` |
| **Miguel pegó una URL de una pantalla o capa** · pasar un diseño a código | `make visor-url U='<lo que pegó>'`. ⚠ Lo que pega es el ANCLA: no salgas a buscar pantallas. `visor-buscar` sólo si nadie pegó nada |
| **¿qué entidades le salen a ESTE comercio?** | `make harness-listing MERCHANT=…` (3 s, por API). El código y el conocimiento local explican el mecanismo; esto contesta el caso |
| **¿qué pasa si el cliente es así?** | `make harness-case CASES='…'`, en paralelo; `CLOSE=1` llega al desenlace |
| **¿esta regla excluye, o sólo reordena?** | corré el caso con y sin el dato. Una regla que «debería» excluir y no excluye es el error más caro del dominio (F-162) |
| **¿algo que subió a producción está rompiendo la originación?** · **¿se dañó algo con ESTE despliegue?** | Sentinel, por consola y sin la API: `bin/sentinel now` · `day [fecha]` · `deploy <repo> [versión]` · `signal <nombre>` · `verdict` (el dictamen de la mañana) · `why <señal>` · `cases <señal>` · `rules <entidad>`. Sólo lectura. Visual: su app en Cockpit. Todo en [`sentinel/CLAUDE.md`](sentinel/CLAUDE.md) |
| **¿este PR está bien?** (el mío antes de publicarlo, o uno que me pasaron) | Goldfish, el paso previo a publicar: `make goldfish-check REPO=… DESC=<md> BASE=main [PROVE=1]` sobre la rama local (skill **`goldfish`**), `make goldfish-run PR=<url>` para uno ya abierto, `make goldfish-impact REPO=…` para cuánto pesa la rama, en segundos. No comenta en GitHub ni aprueba. [`goldfish/CLAUDE.md`](goldfish/CLAUDE.md) |
| **¿dónde toco en esta captura?** (el botón de continuar, el de pagar; para Jarvis o una prueba) | `bin/point <captura> '<pregunta>'` → el punto en píxeles; sale 3 si no está en la pantalla. Local, sin red, 2–3 s. Un ícono chico sin texto lo suele errar: [`point/CLAUDE.md`](point/CLAUDE.md) |
| **¿qué modelos de IA hay en la Mac y quién los usa?** · una herramienta necesita la ruta de su modelo · un modelo le ganó a otro | `bin/models list` · `unused` (lo que se puede borrar) · `path <herramienta>` · `replace` (el ganador queda, el perdedor se borra y queda en el historial de News). Una herramienta que empieza a usar un modelo lo agrega a `models/registry.json` en el mismo commit: [`models/CLAUDE.md`](models/CLAUDE.md) |
| **¿cómo se VE esta interfaz?** (después de tocar una UI) | `make ui-shot APP=<app> ROUTE='#/…' [CLICK='selector']`: la captura en un Chromium sin ventana más los errores de consola y los pedidos fallidos; `COCKPIT=1`, la ventana de Cockpit tal como la ve Miguel. No depende del navegador de la sesión ni levanta servidores |
| **¿funciona, corriéndolo?** | por consola: `harness-case` (segundos) · `harness-walk-wizard` (HTTP, ~20 s) · `harness-walk-wizard ENGINE=browser` (Chromium, ~3 min). El panel (la app Harness de Cockpit, `make panel`) es el camino visual de Miguel. El canal de asesor pide sesión: `make harness-session` / `make harness-login` |
| **¿qué devuelve ESTE código del backend?** (una clase, un servicio, una consulta; el «corrido en local» de una incidencia) | `make harness-recipe` lista las recetas; `NAME=<receta> ARGS='--param valor'` corre una y `CODE='return …;'` corre PHP suelto, adentro de la app local, en segundos. Sólo local: se niega si la app apunta a otra base. [`harness/CLAUDE.md`](harness/CLAUDE.md) §«Las recetas de código» |
| **¿en qué anda el equipo?** | Slack (MCP) · `make cuadrilla` · `make tablero` |
| **hablarle a alguien del equipo por la terminal** · ¿quién está conectado? · pasar una clave | `playground online` · `bin/chat history\|send\|reply\|inbox\|mentions`. Mandar sale a nombre de Miguel: **se confirma el texto antes**; la conversación en vivo, sólo si Miguel la pide; un agente habla con `--as <agente>`. Los comandos, el llavero y cómo habla un agente: [`chat/CLAUDE.md`](chat/CLAUDE.md) |
| **¿qué comercios podrían vender a crédito con CreditOp, y por dónde les llega una propuesta?** | `bin/sabueso hunt --sector <sector>` (el registro mercantil + Claude por internet: ~1,5 min por empresa, gasta el asiento del plan) · `bin/sabueso contact <nombre>` · `bin/sabueso list`. [`sabueso/CLAUDE.md`](sabueso/CLAUDE.md) |
| **avisarle algo a Miguel** · ¿qué avisó cada herramienta? · callar una | `bin/cockpit notify --title '…' [--important]` · `bin/cockpit notices` (la campana de Cockpit) · `bin/cockpit mute <app>` / `pause 1h`. Toda herramienta avisa por `lib/notice`: [`cockpit/CLAUDE.md`](cockpit/CLAUDE.md) §«Los avisos» |
| **que Miguel vea lo que hacés** · llevar Cockpit a una herramienta | `bin/cockpit say "…"` (la intención o una conclusión) · `bin/cockpit open <app> [ruta]` · `bin/cockpit status`. Cada herramienta que usás ya llega sola al panel «Claude». Rutas de cada app: [`cockpit/CLAUDE.md`](cockpit/CLAUDE.md) |
| **¿contestó VTEX / Shopify?** · los correos que se siguen | `bin/correo latest vtex` (el último de ellos y quién escribió último en el hilo) · `bin/correo digest <id>` (el hilo resumido en español) · `bin/correo list` · `bin/correo search --q '…'` (sólo lectura; [`correo/CLAUDE.md`](correo/CLAUDE.md)) |
| **preguntarle a un modelo por su web** (un texto enorme a Gemini, texto a voz, transcribir, DeepSeek, ChatGPT, Groq) | `bin/aistudio` · `bin/deepseek` · `bin/chatgpt` · `bin/groq`, en tu Chrome con Jarvis, de a una. ⚠ Nada interno ni de clientes a DeepSeek, ni audios con datos de clientes a `transcribe`. Opciones y límites: [`wally/CLAUDE.md`](wally/CLAUDE.md) §«Los modelos por su web» |
| **crear un agente de Wally** · conversaciones de Wally | `bin/wally agent create --name … --intent '…'` · `agents` · `ask [--agent n] [--auto] '…'` · `skills`. Lo hace Claude cuando Miguel lo pide. Contesta Claude (el Bedrock de CreditOp) por defecto. [`wally/CLAUDE.md`](wally/CLAUDE.md) |
| **¿se habló de X en una reunión?** · ¿qué se dijo o decidió en la de hoy? | `bin/minutes search --q '…' --json` (todas las grabaciones) · `bin/minutes context <id>` (una entera, para un modelo) · `show --json` · `wait`. Las reuniones que grabó Miguel con Minutes: [`minutes/CLAUDE.md`](minutes/CLAUDE.md) §«Para un agente» |
| **¿qué digo en la daily?** | el home del tablero, «Para la daily» (se arma sola de lunes a viernes a las 7:30), o `make daily [DAY=…]`: tu bitácora del último día, sin lo de my-tools, en pocas líneas |
| **un proceso agendado o en segundo plano necesita un modelo** | `bin/pg model ask --prompt '…'` (o `--file`): el modelo de segundo plano elegido en Cockpit (engranaje → Modelo): **Gemini por la web de AI Studio** en tu Chrome con Jarvis, por defecto desde el 2026-11-24 (sin costo, con cupo diario); Claude por el puente de Bedrock queda a mano (`bin/pg model set claude`). `bin/pg model info` dice si contesta o está en pausa hasta qué hora ([`connectors/CLAUDE.md`](connectors/CLAUDE.md)) |
| **una llave mía** (las que no se comparten: guardarla, usarla) | `bin/pg vault list` · `bin/pg vault run --ring R -- <comando>` (las pasa como variables de entorno, sin mostrarlas). El valor no se pide: el hook `vault-guard` lo niega. La app Llavero de Cockpit: [`vault/CLAUDE.md`](vault/CLAUDE.md) |
| **Jira o Slack** | `bin/pg jira …` · `bin/pg slack …`. Leer es libre; lo que escribe **sin `--apply` sólo muestra** |

### Quién decide en una solicitud, en corto

Antes de razonar sobre por qué una entidad sale, no sale o sale rechazada, ubicá el paso. El detalle con fuentes:
[`knowledge/origination-paths`](knowledge/origination-paths/rules.md) §«Quién decide en el tramo común».

1. **Datos personales** → se consultan y se guardan las centrales (Ágil Data, luego Mareigua; TusDatos; Experian si
   la **sucursal** lo compra). Todavía no se decide nada. En local, dev, qa y staging contesta un mock (F-139).
2. **Listado** → las entidades de la sucursal; las reglas duras (lo que el cliente **declaró**) sólo **sacan** a los
   tipos 2 y 3. El perfilamiento ordena.
3. **Preaprobación por tarjeta** → `pre-approvals-service` le pregunta a la API de la entidad o, para CreditopX (y
   Finandina por alias), al motor de cupo de legacy-backend, con lo guardado en el paso 1. **Aquí se aprueba o se
   rechaza.** El servicio no guarda la respuesta: cada consulta vuelve a evaluar.
4. **Riel**, al elegir → el 4 arma el plan con la ficha de la entidad (`delegated_origination_profiles`).

⚠ **Hay preguntas que no se contestan leyendo: se contestan corriendo.** El conocimiento local y el código describen el mecanismo;
una corrida describe el caso. Y correr encuentra lo que leer no puede: de 12 hallazgos del 2026-08-23,
11 salieron de una corrida.

⚠ **El silencio de una biblioteca NO es «no existe».** Sólo sabe lo que alguien escribió. Verificá
las afirmaciones técnicas en el código de `main`; el comportamiento de un ambiente se mide allí.

⚠ **Menos se lee igual que «no existe».** Una herramienta que lee de una fuente vieja o incompleta no
falla: devuelve menos. Ante un resultado tranquilizador, preguntá de qué está leyendo.

**Una afirmación verificable se verifica antes de escribirla**, y la medición no se escribe a mano: con
`BLOCK=<tarea>` el harness y `tablero-db` (o `bin/pg sql --block`) la agregan solos a la pila de la tarea, con el
comando y lo que dio. La salida de un agente también se verifica, contra `git show main:<ruta>`.

### Contra qué ambiente

Elegí **el más chico que conteste la pregunta**. Subir de ambiente agrega riesgo, no verdad.

| | qué es | regla |
|---|---|---|
| `local` | tuyo, Docker | ⚠ **`E2E_TARGET` por defecto es `dev`, NO `local`**: omitirlo pega contra el dev compartido |
| `dev` | rama `develop`, **compartido con el equipo** | leer libre; **escribir** pide `I_KNOW_THIS_TOUCHES_SHARED_DEV` a mano (F-53) |
| `staging` | rama `staging`, backend propio | **comparte la BD con `dev`**. Su `APP_ENV` está en disputa: no des por apagado nada ahí (`harness/CLAUDE.md`) |
| `prod` | lo real | **SOLO LECTURA**, con una sola excepción: el flujo PÚBLICO de `harness/dev/prod-run.ts`, que corre una persona (OTP por SMS) con una cédula de `PROD_ALLOWED_DOCS` en una sucursal de prueba sin entidades ni Experian, y no pasa del formulario de perfil. Nada escribe en la base por fuera de la app |

No asumas que el código está en los cuatro: un módulo nuevo puede faltar en `develop` o `staging`, y su
404 no ser un bug. Antes de depurarlo: `git -C <repo> ls-tree -r --name-only <rama> <ruta>`.

## ⛔ La suite de PHPUnit de `legacy-backend` NO se corre entera. Nunca, en ningún ambiente

**El 2026-08-19 la BD compartida de dev+staging quedó vacía.** `phpunit.xml` fija `DB_DATABASE=testing`
pero nunca `DB_HOST`, así que las pruebas se conectan al servidor que diga el `.env`, con credenciales
del usuario maestro del RDS; un test con `RefreshDatabase` corrió `migrate:fresh` ahí. Desde el PR
`Creditop-SAS/legacy-backend#1140` una **guarda** en `tests/CreatesApplication.php` aborta si el host no
es local o el schema no es `testing` (CORE-431). **Pero `make fresh` no pasa por esa guarda**, y apunta
a donde diga tu `.env`.

El hook `destructive-tests` (PreToolUse) frena lo de abajo en esta sesión; fuera de una sesión con
hooks, la regla es la misma. Para recrear de verdad tu base local: `I_KNOW_THIS_RECREATES_MY_LOCAL_DB=1`.

**Lo que NO se hace:**

- `make test` en `legacy-backend` (es `artisan test` pelado: corre todo)
- `make fresh` (es `migrate:fresh --seed --force`) ni `db:wipe`
- `artisan test` / `artisan migrate:fresh` sin ruta
- darle *Run* a un test desde el editor: PhpStorm y VS Code no siempre cargan `phpunit.xml`

**Lo que sí: correr SOLO lo que valida la tarea, con ruta explícita.**

    ./vendor/bin/sail artisan test <ruta/al/archivo o carpeta>
    ./vendor/bin/sail artisan test --filter=nombreDelTest <ruta>
    make test-onboarding                                            # ya viene acotado por rutas

**Antes de correr una carpeta, comprobá que no arrastra el trait**, que se activa de TRES formas: el
trait en la clase (`use RefreshDatabase;`), Pest por archivo (`uses(RefreshDatabase::class);`) y Pest
por DIRECTORIO (un `Pest.php` con `->in('Feature')`, que lo hereda cualquier archivo de la carpeta sin
decirlo; `Modules/UserRequestV1/tests/Pest.php` lo hace).

    grep -rlE '^\s*use RefreshDatabase;|uses\(.*RefreshDatabase::class' <ruta>
    ls <ruta>/Pest.php <ruta>/../Pest.php 2>/dev/null   # si hay, LEELO

⚠ Contra una RAMA, `git grep` **no entiende `\s`** y devuelve cero sin fallar: usá
`'^[[:space:]]*use RefreshDatabase;'`. Y grepear sólo `RefreshDatabase` da falsos positivos (imports,
comentarios): anclá el `use`.

**Si creés que hace falta correr algo destructivo, preguntá.** No alcanza con mirar el `.env`: también
cuentan el entorno de la shell y `DATABASE_URL`, que pisa a todos. La causa raíz, qué archivos
arrastraban el trait y la guarda: `tablero/tasks/tests-pueden-borrar-la-bd-compartida/task.md`.

## EL CICLO — acá siempre pasa lo mismo

Se resuelven **tareas** con **tablero** (historia y plan), **knowledge/** (conocimiento local con
fuentes), **harness** (pruebas) y los **conectores** (`bin/pg`: evidencia de los ambientes). El código de `main`
respalda las afirmaciones técnicas.

⚠ **Canon NO es de my-tools** (decisión de Miguel, 2026-11-18). Es el corpus del EQUIPO y vive entero en el repo
compartido (`~/Desktop/CREDITOP/github/playground/tools/canon`): ahí se consulta, se escribe y se pone al día
(`tools/canon/recontext/README.md`, con `task recontextualizar-canon` y `task canon-cli`). Acá no queda ningún comando,
conector, skill ni agente de canon: los `make canon-*` sólo dicen adónde ir. El conocimiento de my-tools es
**knowledge/**, que es local, más explicado y tiene su propio método (`make knowledge-drift`). No mezcles los dos: lo
que se aprende trabajando acá va a knowledge/. **`context/` y `workers/` ya no existen**: si los ves
citados, está viejo. Las exploraciones de Miguel (`flow`, `engine`, `plantillas`…) están en
`~/Desktop/CREDITOP/temp/`, fuera de git, **no están validadas: no las cites ni decidas con ellas**.

1. **La TAREA vive en `tablero/tasks/<slug>/`** (`task.md`, su pila `context.jsonl`, sus `artifacts/`).
   **Buscá la que ya cubre esto antes de crear una: `make tasks ALL=1`.** Una con `id: 0` no aparece
   en el tablero. Al cerrar la sesión, `make closeout` chequea las tres piezas —el bloque del día, `ramas:`
   medidas y la bitácora con minutos MEDIDOS— y el hook de `Stop` lo corre solo.
2. **El contexto de la tarea se lee antes de investigar** con `make resume`. Si existe contexto
   local pertinente, se lee en `knowledge/` con sus fuentes y límites. El código real vive en
   `~/Desktop/CREDITOP/github/`.
3. **Lo que se descubre SE REGISTRA.** El test: *si esto se mergea mañana, ¿sigue siendo cierto?*
   - conocimiento técnico reutilizable, verificado en `main` → **knowledge/** con sus fuentes;
     políticas de negocio/producto sin comprobación local quedan citadas a su fuente y con ese límite;
   - hallazgos **de la tarea** → su **pila**, como bloques (`make task-block`, o `BLOCK=`);
   - trampas **del sistema**, verificadas → `knowledge/traps/traps.md`. **Mirala antes de depurar un
     muro.**
4. **Probar de verdad es `harness/`**: se comprueba corriendo, no leyendo. ⚠ En local/dev/staging las
   centrales de riesgo las atiende un lambda de mocks de la empresa
   (`Creditop-SAS/risk-services-mockery-lambda`, un Mockoon), al que se le dicta la respuesta por
   cédula (F-139): sin saberlo, una prueba de identidad siempre devuelve la misma persona.
5. **Al mergear**, revisá el conocimiento local afectado y archivá la tarea cuando su objetivo
   terminó. Un PR abierto sigue siendo una propuesta de la tarea, no comportamiento vigente.
   Publicar conocimiento para el equipo (en canon) se hace desde el repo compartido, no desde acá;
   no es condición de cierre ni crea un pendiente.

Las herramientas se documentan en su propio `CLAUDE.md`. `knowledge:` enlaza los temas locales
de una tarea (sus citas a canon pasaron a knowledge el 2026-11-18). De una tarea sólo salen a Jira
`jira_title` y `## Tarea (publicable)`, que pasan el guard; el resto es privado.

## Git

- **Este repo** (`my-tools`) se trabaja directamente sobre `main` y se commitea local. No crees ramas
  para sus mejoras. El push lo decide Miguel: no pushees por tu cuenta.
- **Varias sesiones comparten este worktree y su índice de git**: se stagea y se commitea por RUTA
  (`git commit -m … -- <rutas>`, o `git add <rutas> && git commit …` en el mismo comando). El hook
  `index-guard` frena `git add -A`, `git commit -a` y el commit sin rutas. *(Un worktree por sesión no
  sirve hoy: los `.env`, la bitácora y las cachés están fuera de git, y desde un worktree fallan en silencio.)*
- **Los repos reales** (`legacy-backend`, `frontend-monorepo`, `legacy-application`) trabajan en ramas y
  stashes locales. **No armes PRs ni pushees ahí sin pedir permiso explícito.**
- **Antes de publicar un PR en un repo real, pasalo por Goldfish** (skill `goldfish`: `make goldfish-check`): una
  revisión en frío de la descripción y el diff, sin ser estricta. Lo «fuera de alcance» no se arregla en ese PR.
- **UN PR por tarea y por repo, con TODO lo que la tarea toque de ese repo.** Cinco PRs chicos de la
  misma tarea se revisan cinco veces y se mergean en cinco momentos, así que `main` pasa por estados que
  nadie probó (se decidió el 2026-09-14). La única división es **por repo**.
- ⛔ **La descripción de un PR NO nombra las herramientas internas.** Nada de `harness`, `trazador`,
  `tablero`, `connectors`, `my-tools`, `playground` ni sus comandos `make`: lo leen personas que no tienen este repo.
  Va **qué se midió y qué dio** —ambiente, caso, números, antes y después— y las rutas del repo tocado.
  El comando que lo reproduce va en el archivo de la tarea.

## Entorno local

- Hay una **copia local de la BD** en Docker: contenedor `legacy-backend-mysql-1`, schema `creditop`.
  Usala para verificar contra datos reales en vez de suponer.
- ⚠ **`E2E_TARGET` por defecto es `dev`** (`harness/pkg/db.ts`). Para local, exportalo:
  `E2E_TARGET=local`. Y un `||=` de esa variable **no gana a un import estático** que ya resolvió el
  target (F-187).
- El harness del wizard se maneja desde el **panel**: la app Harness de Cockpit, o `make panel` (:5195).

## Trampas que ya costaron tiempo

- En `user_requests`, el estado es **`user_request_status_id`**, no `status` (F-50).
- **El estado 11 «Autorizada» ES terminal**: de 10.182 solicitudes que lo tocaron en 90 días, 3
  avanzaron. **No cuentes desembolsos con esa columna**; usá `user_requests.disbursed_at` (desde el
  2026-09-18, con histórico reconstruido: ~23% salió de `updated_at`).
- ⚠ **Para buscar o contar en Loki, `bin/pg logs`**: dice la ventana que buscó, avisa si llegó al tope y un conteo
  (`--query 'sum(count_over_time({service_name="x", level="error"} [24h]))'`) da su número, también 0.
- `docs/` (de cuando este repo se llamaba `playground`) fue borrada de `main`. Una ruta `docs/X.md` citada es histórica:
  `git show 159906a:docs/<archivo>`.

## Dos reglas de honestidad

- Si tocaste las fuentes de un tema de knowledge, validá que existan en `main`: una ruta mal escrita no
  falla en ningún lado. Lo mismo con las citas `archivo:línea` de una trampa: `make traps` las ancla.
- **Nunca afirmes como verificado algo que no comprobaste contra el código.** Si no lo miraste, decilo.

## Variables de entorno

**Las credenciales de un servicio viven en UN lugar: su conector.**

| archivo | qué lleva |
|---|---|
| `connectors/.env.<target>` (`local` · `dev` · `qa` · `staging` · `prod`) | lo que depende del ambiente: la base (MySQL directo, o Redash en prod), Loki y PostHog |
| `connectors/.env` | lo que no: Gemini, Atlassian (Jira y Confluence, un token para los dos), Slack, Jev, Twilio, Figma, ElevenLabs (las voces de la videollamada del chat), el cliente OAuth de Drive y la llave de la cuenta VTEX de pruebas (`VTEX_*`, desde el 2026-11-07; antes en `harness/.env.vtex`) |
| `<herramienta>/.env[.<target>]` | sólo las **perillas** de esa herramienta |

Las claves de cada archivo son las de la tabla. **El proceso gana** sobre el archivo, y una variable vacía
en el proceso no tapa la del archivo. Desde otro lenguaje se llega por **`bin/pg`**.

- La única excepción es la base del **harness** (`E2E_DB_*` en `harness/.env.<target>`): siembra, o sea
  escribe, y la escritura no pasa por el conector a propósito.
- Las claves de base van con el prefijo `E2E_DB_`, **nunca `DB_HOST`**: ese es el que lee Laravel
  (CORE-431).
- Antes de agregar una clave a una herramienta, fijate si su conector ya la resuelve: una copia de una
  credencial vence sin avisar.

**Qué rama sirve cada target:** `local` → local · `dev` → `develop` · `staging` → `staging` · `qa` →
`qa`. `dev`, `qa` y `staging` **comparten la BD** (`inertia-development`, en la cuenta de desarrollo; antes de la migración se llamaba `inertia-dev`) pero **no el backend**: el detalle, en
`harness/CLAUDE.md` §«Qué es real en cada target».

**Los permisos no van en archivo.** `I_KNOW_THIS_TOUCHES_SHARED_DEV` se exporta a mano en la shell
cuando de verdad vas a escribir a la BD compartida; meterlo en un `.env` desarma la guarda (F-53).

`.env.*` está gitignoreado y no hay plantillas versionadas: se borraron el 2026-10-19 porque el repo es local y de
uso propio. La última versión de cada una sigue en git: `git show bda2b796:connectors/.env.example` (y
`harness/.env.<target>.example`, `tablero/server/.env.example`).
