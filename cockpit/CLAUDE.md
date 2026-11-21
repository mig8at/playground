# cockpit — la app de escritorio que junta las herramientas

Cockpit (`/Applications/Cockpit.app`, Tauri) es **donde Miguel mira las herramientas de my-tools**: una
barra de aplicaciones a la izquierda, como la de VS Code, y a la derecha cada herramienta en su panel. No
reemplaza a ninguna: cada app es la interfaz de siempre, servida por su propio servidor en localhost y
abierta en un iframe que queda vivo al cambiar de app. Lo que sigue vale para USARLO desde una sesión y
para CAMBIARLO; cómo se ve (tema, regiones) está en `tools/ui/CLAUDE.md`.

## Qué apps tiene

La lista vive en UN lugar: `APPS`, en `src-tauri/src/main.rs`. `bin/cockpit status` dice cuáles están arriba.

| id (`bin/cockpit open <id>`) | qué es | carpeta | puerto · API | la levanta |
|---|---|---|---|---|
| `chat` | el chat del equipo | `chat/` | :5185 | de fondo (`make chat-install`); si no está instalado, Cockpit, adentro (Go, `chat-server`) |
| `tablero` | las tareas y el sprint | `tablero/` | :5191 · :8787 | `make tablero` |
| `harness` | el panel del harness | `harness/panel/` | :5195 | `make panel` |
| `jarvis` | Jarvis | `jarvis/` | :5202 · :5203 | `make jarvis` |
| `designer` | el visor de diseños de Figma | `visor/` | :5193 · :5194 | `make visor` |
| `ecommerce` | qué le pasó a una prueba de tienda | `ecommerce/` | :5178 · :5179 | `make ecommerce` |
| `sentinel` | el vigía de producción: entidades y comercios contra lo normal | `sentinel/` | :5210 · :5211 | `make sentinel`; su API también de fondo (`make sentinel-install`, ver `sentinel/CLAUDE.md`) |
| `goldfish` | tus PRs abiertos por repo y su validación Elephant-Goldfish (también de los PRs de otros) | `goldfish/` | :5216 · :5217 | `make goldfish` |
| `correo` | los correos de los remitentes que seguís en Gmail, con aviso de macOS | `correo/` | :5224 · :5225 | `make correo`; su API también de fondo (`make correo-install`, ver `correo/CLAUDE.md`) |
| `knowledge` | Knowledge: el vigía de `knowledge/`; mira main y la pone al día sola, paso a paso, como un workflow | `knowledge-flow/` | :5232 · :5233 | `make knowledge-flow`; su API también de fondo (`make knowledge-flow-install`, ver `knowledge-flow/CLAUDE.md`) |
| `wally` | el asistente y sus agentes, con Claude (el Bedrock de CreditOp) o Gemini por su web (`bin/wally`); manda el numerito de las corridas automáticas que terminaron sin verse | `wally/` | :5228 · :5229 | `make wally` |
| `news` | News: lo nuevo de Hugging Face cada semana, con lo más innovador, los modelos documentados y los papers en español | `news/` | :5240 · :5241 | `make news` |
| `sabueso` | Sabueso: comercios y entidades que no trabajan con CreditOp, buscados en el registro mercantil, con su encaje y la relación con cada uno | `sabueso/` | :5244 · :5245 | `make sabueso` |
| `vault` | el Llavero: tus llaves que no se comparten, en llaveros como tarjetas, cifradas con tu llave personal; exportar e importar para otra máquina | `vault/` | :5236 · :5237 | `make vault` |

En la barra el visor se llama **Designer**; por dentro la carpeta y sus `make` siguen siendo `visor`.

## Quién levanta cada servidor (esto decide qué hacés antes de arrancar uno)

- **El chat corre de fondo** (`make chat-install`, desde el 2026-11-12): un LaunchAgent (`com.creditop.my-tools.chat`,
  binario `chat/bin/chat-server`) que junta el historial, avisa y contesta el llavero aunque Cockpit esté cerrado del
  todo o reinstalándose. Con él instalado Cockpit NO levanta el suyo; sólo de respaldo si el chat no contesta 30 s
  (`chat_agent_installed`, `SIDECAR_GRACE`). Sin él, el servidor viene adentro como antes: arranca con Cockpit, se
  vuelve a levantar si se cae y se apaga al salir. `make chat-status` · `make chat-uninstall`. `make chat` es sólo para
  desarrollar su interfaz.
- **Sentinel, Correo, Knowledge, Wally y Jarvis también corren de fondo** (`make <app>-install`; todos con
  `lib/launchagent`). **Wally y Jarvis desde el 2026-11-18** (`com.creditop.my-tools.wally` · `.jarvis`): sus API andan
  con Cockpit cerrado o con la app oculta, así `bin/wally`, `bin/jarvis` y lo agéntico no dependen de la ventana. Cuando
  Cockpit abre la app con su `make`, el servidor de esa copia no choca: **espera el puerto** (`launchagent.Listen`) y la
  interfaz usa la API de fondo; si la de fondo se saca, toma el relevo.
- **`bin/cockpit restart <app>` de una app de fondo la recompila y la recarga** (`make <app>-install`), y reinicia
  también la copia de Cockpit si la tenía; sirve con Cockpit cerrado. Es el mismo comando de siempre para «que tome un
  cambio en su servidor».
- **Dos servidores de la misma app no se pisan**: el chat y Sentinel, si su puerto ya lo tiene otro de los suyos,
  esperan y toman el relevo cuando se suelta. Sólo el que escucha escribe el historial o lo guardado.
- **Las demás se levantan la primera vez que Miguel las abre** en la barra, con su `make <app>`, y se apagan
  al salir de Cockpit (todo su grupo de procesos). Su salida queda en `~/Library/Logs/cockpit-<id>.log`
  (el chat: `creditop-my-tools-chat.log`).
- **Si el puerto de una app ya contesta, Cockpit usa ésa y no la toca.** Vale en los dos sentidos: lo que
  levantaste vos en una terminal lo muestra Cockpit, y lo que levantó Cockpit ya te sirve a vos.
- ⚠ **Antes de levantar un servidor, mirá si ya está arriba** (`bin/cockpit status`, o el aviso COCKPIT del
  arranque de la sesión). Dos `make tablero` chocan por el puerto.
- **Una app que se cae vuelve sola.** Cockpit vigila cada 5 s las apps que se abrieron (`watchdog`): si una deja
  de contestar la tapa con un aviso y, tras 3 revisiones seguidas, la levanta de nuevo con su `make` y la
  recarga. Medido el 2026-11-11: el tablero, apagado a la fuerza, volvió en 16 s. Espera esas revisiones a
  propósito: un servidor que se reinicia solo (Vite al cambiar su config) deja el puerto un par de segundos.
- **Para que una app tome un cambio en su servidor Go: `bin/cockpit restart <app> --wait`.** Sin `--wait` el comando
  vuelve cuando la app SOLTÓ el puerto, no cuando levantó: lo que corra enseguida le pega a un servidor que no está.
  Apaga la de Cockpit, o la
  de una terminal sólo si el líder de su grupo de procesos es el `make` de esa app; si no, lo dice y no toca
  nada. No mates servidores a mano: nunca `pkill` con patrón, ni por puerto sin `-sTCP:LISTEN`.
- Lo que corre es el **código del working tree**: un cambio en el Vue de una app se ve al guardar (Vite); un
  cambio en su servidor Go pide reiniciar esa app. Sólo el chat y la carcasa piden reinstalar (abajo).

## Manejarlo desde una sesión

`bin/cockpit` habla con el puerto de control de Cockpit. Sin Cockpit abierto lo dice y sale 1: no bloquea nada.

    bin/cockpit status [--json]        qué apps hay, cuáles están arriba y cuál está al frente
    bin/cockpit open <app> [ruta]      trae una app al frente, en una ruta
    bin/cockpit doctor [--json] [--all] ¿qué puedo usar AHORA? En ~4 s: red, AWS, sesiones (playground, gh, asesores de
                                       prueba), el modelo de fondo, Cockpit y sus apps, y los servicios de fondo.
                                       Sirve con Cockpit cerrado; sale 1 si algo falla. Son las sondas rápidas del
                                       llavero (`keyring/check`, grupo `agent` incluido); `--all` es `make keyring`
    bin/cockpit ensure <app>           que esté arriba, SIN traerla al frente ni tocar una que ya anda; vuelve cuando
                                       contesta (hasta 90 s; sale 1 si no levantó). Lo llaman solos bin/wally y bin/jarvis
    bin/cockpit restart <app> [--wait] la reinicia (su servidor Go no se recarga solo) y Cockpit la recarga;
                                       --wait vuelve recién cuando contesta de nuevo (hasta 90 s; sale 1 si no levantó)
    bin/cockpit logs <app> [--lines 40] [--errors]   lo último que escribió una app (su servidor y su Vite), de
                                       ~/Library/Logs; no pasa por Cockpit: sirve con la app caída o Cockpit cerrado
    bin/cockpit say "<texto>"          cuenta en el panel «Claude» la intención o una conclusión
    bin/cockpit apps                   los ids

Las rutas son las de cada app:

| app | ruta | ejemplo |
|---|---|---|
| `tablero` | `#/tareas/<slug o clave>[?vista=pendientes\|artifacts]` | `'#/tareas/core-800?vista=artifacts'` |
| `harness` | `/<ambiente>/<comercio>/<canal>[?vista=comercio\|cliente\|buros]` | `/local/motai/asesor` |
| `chat` | `#/c/<correo>` · `#/c/agent:<dueño>/<agente>` | |

**El panel «Claude»** (el asterisco ✳ del pie de cada app, al lado del tema; lo agrega `tools/ui/workbench.js` sólo dentro de Cockpit) muestra en vivo cada herramienta que usa la sesión. No
hay que hacer nada: el hook `cockpit` (`tablero/server/internal/hooks/cockpit.go`, en PreToolUse, PostToolUse
y UserPromptSubmit) le pasa una línea por herramienta. Tres cosas que salen de ahí:

- **Seguir a Claude**: USAR una herramienta trae su app al frente, en su ruta — `make harness-case
  TARGET=local MERCHANT=motai` lleva el panel a ese comercio; escribir en `tablero/tasks/<slug>/` abre esa
  tarea. Editar el CÓDIGO de una herramienta no mueve nada. Qué
  comando lleva a qué app lo decide `cockpitTarget`.
- **`say` es para lo que los comandos no dicen**: qué vas a hacer y qué concluiste. No narres cada paso.
- **Con dos o más sesiones de Claude, Cockpit sigue a UNA** (2026-11-18): la primera que habla. Sólo ésa mueve la
  ventana; las otras se ven en el panel con su etiqueta (los 4 primeros caracteres de su id) pero no cambian la app al
  frente. Cambia sola cuando la que se seguía lleva 90 s sin hacer nada y otra actúa, o cuando Miguel toca la ficha de
  otra sesión en la cabecera del panel.
- **Frenar es por sesión**: si Miguel toca «Frenar», el hook niega la siguiente herramienta (sale 2) de la sesión que
  se sigue, no de las demás («todas» las frena juntas), hasta que reanude o te escriba. Escribirle a una sesión la
  reanuda a ella, no a otra que esté frenada. El hook pregunta por la suya (`POST /stop/check {session}`). Pasan sólo `bin/cockpit say|status|apps` y las herramientas internas de la app (`open` y `restart` hacen algo: no pasan). Si te frena: contá en una línea
  dónde quedaste y esperá.

⚠ En un comando compuesto, un `bin/cockpit open` pisa el «seguir» de lo demás: si querés que Cockpit siga a
una herramienta, corré su comando solo.

## Verificar una interfaz: Cockpit no es el navegador de la sesión

Lo que Miguel ve es Cockpit (un WKWebView); lo que la sesión maneja es el navegador embebido, que NO es lo
mismo. **Para ver cómo quedó una interfaz, `make ui-shot`** (`tools/ui-shot`): la abre en un Chromium sin
ventana, en la ruta, con tamaño y tema, hace los clics y deja un PNG, más los errores de consola y los pedidos
fallidos. `COCKPIT=1` captura en cambio la ventana de Cockpit, lo que ve Miguel (con `APP=` la trae al frente
en esa app: lo mueve a él también). No levanta servidores.

    make ui-shot APP=tablero ROUTE='#/tareas/core-800?vista=artifacts' CLICK='.artifact-row:has-text("guia")'
    make ui-shot APP=harness ROUTE=/local/motai/asesor THEME=light
    make ui-shot APP=tablero ROUTE='#/tareas/core-800?vista=pendientes' SELECTOR='#task-views'
    make ui-shot COCKPIT=1 APP=tablero

Lo que ya costó, y por qué existe:

- **Un iframe con `src` lo bloquea el navegador embebido** (`ERR_BLOCKED_BY_CLIENT`), también del mismo
  puerto; con `srcdoc` anda en los dos. Por eso la vista previa de Jira y el visor de artifacts del tablero
  van por `srcdoc`.
- **Con el pane oculto las capturas salen viejas**: el DOM cambia y la imagen no. `ui-shot` no depende del pane.
- **La ventana de Cockpit es la MÁS GRANDE de las suyas** (la primera puede ser un tooltip): así la elige
  `tools/ui-shot/cockpit-window.swift`.
- La ventana del pane suele medir menos de 1050 px, y ahí el tablero pliega su sidebar derecho: emulá 1440.

## Cambiarlo

| pieza | dónde |
|---|---|
| qué apps hay, cómo se levantan, enlaces `cockpit://`, el puerto de control | `src-tauri/src/main.rs` |
| la carcasa: la barra (con la **campana** de avisos), la configuración (el engranaje abre un modal como el de canon: Apariencia, Claude, **Modelo** —el de segundo plano, abajo—, **Avisos**, Apps —su estado y Reiniciar, con `apps_state` y `restart_app`— y Cómo se usa), los iframes, el panel «Claude», el botón Frenar | `shell/index.html` (su tema y taller son copias de `tools/ui`: `make style-sync`) |
| el cliente del puerto de control | `lib/cockpit/` · el CLI: `cmd/cockpit/` (`bin/cockpit`) |
| qué se ve de cada herramienta y a qué app lleva | `tablero/server/internal/hooks/cockpit.go` (con test) |
| lo que una app le dice a la carcasa | `tools/ui/workbench.js` (todas) · `chat/src/desktop.js` (el chat) |

⚠ **La interfaz de Cockpit no muestra comandos** (Miguel, 2026-11-18): ni `bin/…`, ni `make …`, ni rutas de archivos.
Cómo se usa cada cosa por consola es para Claude y va en los `CLAUDE.md`; la interfaz dice qué hace cada cosa, en
palabras.

**La carcasa y las apps se hablan por `postMessage`.** La app manda `badge` (su numerito), `theme` y `palette` (cambió el
tema o la paleta), `open` (abrí otra app) y `claude` (su asterisco: abrí o cerrá el panel); la carcasa manda `route` (ir a una ruta), `claude` (el panel abierto y si hay actividad sin ver), `visible` (si está a la vista: un
iframe escondido no se entera solo, y el chat marcaría leído), `theme` y `palette`. Cockpit tiene UN tema y UNA paleta
para todas (se eligen en el modal del engranaje, Apariencia).
Los enlaces `target="_blank"` de cualquier app los atrapa Rust y los abre en el navegador de Miguel.

**El puerto de control** escucha en 127.0.0.1:5209 y pide la llave que Cockpit deja al arrancar en
`~/.config/creditop-cockpit/control.json` (600, se borra al salir): `GET /status`, `POST /stop {stopped, session}`
(sin sesión: todas), `POST /stop/check {session}`, `POST /open`, `/ensure`, `/restart`, `/say`, `/activity`. La llave existe para que una página web cualquiera no pueda manejar Cockpit.

**Una app oculta o sin abrir sigue sirviendo a Claude** (2026-11-18). Cockpit levanta cada app la primera vez que
Miguel la abre, así que una oculta puede no tener servidor. Los CLI que hablan con la API de su app (`bin/wally`,
`bin/jarvis`) miran antes si el puerto contesta y, si no, corren `bin/cockpit ensure <app>` (`POST /ensure`): la
levanta sin cambiar la app al frente. Medido: Wally apagado, `bin/wally agents` contestó en 2 s. Con `WALLY_API` o
`JARVIS_API` puestos (una prueba) no levantan nada. Con Cockpit cerrado no hay quién la levante: el comando lo dice
y sale 1; por eso Wally y Jarvis además corren de fondo (arriba). Los que tienen servicio de fondo (chat, Sentinel, Correo, Knowledge, Wally, Jarvis) y los que no usan servidor (`bin/pg`,
harness, tablero) no lo necesitan.

**Qué apps se ven en la barra** (engranaje → «Apps», un interruptor por app; 2026-11-18): ocultar una la saca de la
barra y de los atajos ⌘1, ⌘2…, nada más: sigue andando (sus avisos, su servidor de fondo) y se abre igual por un aviso o
con `bin/cockpit open`, y mientras está al frente se ve en la barra. Al menos una queda visible. Se guarda en Cockpit
(`localStorage`, `cockpit.hidden-apps`), no en un archivo: es una preferencia de esta ventana.

**El Llavero** es una app de la barra desde el 2026-11-18 (antes una sección del engranaje, que se sacó: con 31
llaveros se veía muy chico). Todo lo suyo está en [`vault/CLAUDE.md`](../vault/CLAUDE.md).

**La sesión del playground** (2026-11-18): mientras Cockpit está abierto, cada 10 min corre `bin/cockpit session check`
(`cmd/cockpit/session.go`): si el token vence en menos de una hora, o ya venció, un aviso de macOS —a lo sumo uno por
hora— que al tocarlo abre `cockpit://session/login`, que corre `playground login`. Con Cockpit cerrado no avisa nadie, a
propósito. **No se renueva sola**: la página del playground pide tocar «Continuar con Google» cada vez (medido el
2026-11-18 con una pestaña minimizada de Jarvis: a los 90 s seguía ahí), y que una herramienta toque ese botón por Miguel
no se hace. ⚠ El aviso abre el enlace sólo si sale por el avisador de Cockpit (con permiso de avisos en Configuración
del Sistema, abajo); por `osascript` se ve, pero tocarlo no hace nada.

## Los avisos: los maneja Cockpit (2026-11-21)

Decisión de Miguel: «que las notificaciones sean manejadas por cockpit». **Cada herramienta decide QUÉ merece un aviso;
Cockpit decide CÓMO llega.** Todo pasa por [`lib/notice`](../lib/notice/notice.go) (`notice.Send`), el único camino: un
test (`lib/notice/guard_test.go`) falla si otro archivo llama a un avisador por su cuenta. Hasta ese día había cuatro
copias (Sentinel, Correo, Wally, chat), los avisos de Sentinel decían «Chat de my-tools» y el no molestar era sólo del chat.

- **Funciona con Cockpit cerrado.** Sentinel, Correo, Knowledge, Wally y la daily corren de fondo: el silencio y la
  bandeja son archivos (`~/Library/Application Support/creditop-my-tools/notices/`: `inbox.jsonl`, `settings.json`,
  `state.json`) que lee `lib/notice` en cada aviso. Cockpit sólo los muestra y los edita, con `bin/cockpit notices … --json`
  (Rust: `notices_state`, `notices_read`, `notices_save`, `notices_test`): una sola implementación, en Go.
- **El silencio** (engranaje → **Avisos**, o `bin/cockpit mute|pause`): no molestar de todos los días (nació con el que
  tenía el chat), una pausa (1 h, 3 h) y un nivel por herramienta: **Todos · Importantes · Ninguno**. Importante es lo que
  suena: una alerta de Sentinel, una corrida de Knowledge que frenó o falló, una mención, un correo de quien seguís, la
  sesión que vence. Los importantes atraviesan el no molestar si así está puesto; la pausa no la atraviesa nadie.
- **La bandeja** (la campana de la barra, con el número sin leer): cada aviso de los últimos 30 días, por día, con el
  ícono de su herramienta; tocarlo abre su ruta. Lo callado se ve con el ojo, apagado y con su motivo; lo que no salió,
  con su error. Abrirla la marca leída. Rust mira el archivo cada 2 s y avisa a la carcasa (`cockpit-notices`).
- **El avisador** es «Cockpit» (`~/Applications/Cockpit Avisos.app`, `cockpit/notifier/`, lo compila `make cockpit`,
  firmado con `bin/sign` como `com.creditop.my-tools.notifier`): tocar un aviso abre `cockpit://<app>/#/<ruta>` y
  `cockpit://cockpit/` abre la campana. Un aviso con `Replace` (una alerta que se repite, el estado de una corrida)
  reemplaza al anterior de su grupo. **Su permiso lo da Miguel una vez**: `bin/cockpit notify --test` (o engranaje →
  Avisos → Probar) lo pide; mientras no lo tenga, `lib/notice` sale por el avisador viejo del chat («Chat de
  my-tools.app», que queda instalado sólo como respaldo) y, si tampoco, por `osascript`.
- **Por consola:** `bin/cockpit notices [--app X] [--unread] [--read]` · `bin/cockpit notify --title … [--important]`
  (lo que manda una sesión de Claude queda como app `claude`) · `bin/cockpit mute <app> [all|important|none]` ·
  `bin/cockpit pause 1h|off`.
- **Una herramienta nueva que avise** usa `notice.Send(notice.Notice{App: "<id de Cockpit>", Title, Body, URL:
  "cockpit://<app>/#/…", Group, Replace, Important, Sound})` y se suma a `noticeApps` (`cmd/cockpit/notices.go`) para
  tener su fila en Avisos.

**Y adentro de Cockpit, imposible de no ver** (2026-11-19, Miguel: «cuando esté caducada debería aparecerme como una
alerta en el centro de la pantalla, con un botoncito de login»; ese día el aviso de macOS pasó de largo y el modelo de
fondo quedó sin sesión media mañana). La carcasa pregunta `bin/cockpit session status --json` cada minuto y al volver a
la ventana (Rust: `session_state`):

- **Vencida o sin sesión:** un modal en el centro con el fondo oscurecido (un `<dialog>` como la configuración): cuándo
  venció, qué se detiene sin ella y **«Iniciar sesión»** (Rust: `session_login`, que corre `playground login` y abre el
  navegador). Mientras tanto dice «Esperando que termines en el navegador…» y pregunta cada 3 s; al entrar muestra
  «Listo» con el nuevo vencimiento y se cierra solo. «Más tarde» (o Escape) lo deja una hora.
- **Por vencer (menos de 60 min):** una franja arriba del panel, «vence en N min · Renovar», que no bloquea; la ✕ la
  oculta hasta que venza.
- **Para probarlo sin esperar:** `bin/cockpit session fake expired|soon` hace que la CARCASA la vea así (la sesión real
  y lo que la usa no cambian); `bin/cockpit session fake off` vuelve a la real. No lo dejes puesto.

**El modelo de segundo plano** (engranaje → «Modelo», 2026-11-18; Miguel: «para tareas en segundo plano que se
ejecutan a ciertas horas»): el modelo que usa lo que corre solo, agendado o sin nadie mirando. Claude por defecto
(Sonnet 5.5 en el Bedrock de CreditOp, por el puente de canon) o Gemini por su API. La carcasa no lo implementa:
corre `bin/pg model info --json` y `bin/pg model set <m>` (Rust: `model_state`, `set_model`), que leen y guardan
`~/.config/creditop-cockpit/settings.json` (`lib/cockpit/settings.go`; no se borra al salir, a diferencia del
control). Lo agendado pregunta con `bin/pg model ask` o, desde Go, con `lib/background` (la daily del tablero), y lee la misma elección con Cockpit cerrado. Wally elige el
suyo aparte, en su barra.

**Agregar una app**, en este orden:

1. Que tenga su `make <app>` y sus puertos (`.claude/launch.json` dice cuáles están tomados).
2. Una entrada en `APPS` (`main.rs`): id, nombre, url, los `host:puerto` que tienen que contestar, y su `make`.
3. Su ícono en `ICONS` (`shell/index.html`).
4. El estilo «Paneles» y el tema compartido: sumala a `tools/ui-sync.py` y `tools/style.py`, y `make
   style-sync` + `make style-check`.
5. Si tiene comandos de consola, a qué app llevan: `cockpitTarget`, con su caso en el test.
6. La fila de la tabla de arriba, y el id en la fila de `bin/cockpit` del `CLAUDE.md` raíz.

**Reinstalar: `make cockpit`** compila el chat (servidor y interfaz) y la carcasa, cierra Cockpit, lo copia a
Aplicaciones y lo abre; si el chat corre de fondo, también lo recompila y lo recarga (`make chat-install`). Tarda unos minutos. Hace falta cuando cambia `cockpit/` o `chat/`; **no** para un
cambio en tablero, harness, Jarvis, Designer o ecommerce.

- ⚠ Reinstalar **apaga las apps que Cockpit había levantado** (no las que levantaste vos).
- ⚠ Después de reinstalar, macOS puede volver a pedir permiso para la carpeta Escritorio, y hasta que Miguel
  lo acepta el servidor del chat queda colgado: no es el código. Lo mismo con los de fondo (`chat-server`,
  `sentinel`) al instalarlos: el proceso vive y su log no dice nada hasta que se toca «Permitir».
- **El micrófono** (dictar en el chat): Cockpit concede sólo el micrófono a sus apps (`on_permission_request`), los
  iframes lo piden con `allow="microphone"`, y macOS pregunta una vez (`NSMicrophoneUsageDescription`, en
  `src-tauri/Info.plist`, que Tauri junta con el de la app). La transcripción la hace el servidor del chat con Whisper
  en esta máquina (`chat/server/dictation.go`): pide `brew install whisper-cpp` y el modelo en
  `~/.cache/whisper/ggml-large-v3-turbo-q5_0.bin` (~550 MB, de huggingface.co/ggerganov/whisper.cpp); sin eso, el
  micrófono no aparece.
- Cerrar la ventana la esconde: Cockpit sigue juntando el historial del chat y avisando. Arranca sola al
  iniciar sesión.
