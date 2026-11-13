# cockpit — la app de escritorio que junta las herramientas

Cockpit (`/Applications/Cockpit.app`, Tauri) es **donde Miguel mira las herramientas del playground**: una
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

En la barra el visor se llama **Designer**; por dentro la carpeta y sus `make` siguen siendo `visor`.

## Quién levanta cada servidor (esto decide qué hacés antes de arrancar uno)

- **El chat corre de fondo** (`make chat-install`, desde el 2026-11-12): un LaunchAgent (`com.creditop.playground.chat`,
  binario `chat/bin/chat-server`) que junta el historial, avisa y contesta el llavero aunque Cockpit esté cerrado del
  todo o reinstalándose. Con él instalado Cockpit NO levanta el suyo; sólo de respaldo si el chat no contesta 30 s
  (`chat_agent_installed`, `SIDECAR_GRACE`). Sin él, el servidor viene adentro como antes: arranca con Cockpit, se
  vuelve a levantar si se cae y se apaga al salir. `make chat-status` · `make chat-uninstall`. `make chat` es sólo para
  desarrollar su interfaz.
- **Sentinel y Correo también corren de fondo** (`make sentinel-install`, `make correo-install`); los tres con `lib/launchagent`.
- **Dos servidores de la misma app no se pisan**: el chat y Sentinel, si su puerto ya lo tiene otro de los suyos,
  esperan y toman el relevo cuando se suelta. Sólo el que escucha escribe el historial o lo guardado.
- **Las demás se levantan la primera vez que Miguel las abre** en la barra, con su `make <app>`, y se apagan
  al salir de Cockpit (todo su grupo de procesos). Su salida queda en `~/Library/Logs/cockpit-<id>.log`
  (el chat: `creditop-playground-chat.log`).
- **Si el puerto de una app ya contesta, Cockpit usa ésa y no la toca.** Vale en los dos sentidos: lo que
  levantaste vos en una terminal lo muestra Cockpit, y lo que levantó Cockpit ya te sirve a vos.
- ⚠ **Antes de levantar un servidor, mirá si ya está arriba** (`bin/cockpit status`, o el aviso COCKPIT del
  arranque de la sesión). Dos `make tablero` chocan por el puerto.
- **Una app que se cae vuelve sola.** Cockpit vigila cada 5 s las apps que se abrieron (`watchdog`): si una deja
  de contestar la tapa con un aviso y, tras 3 revisiones seguidas, la levanta de nuevo con su `make` y la
  recarga. Medido el 2026-11-11: el tablero, apagado a la fuerza, volvió en 16 s. Espera esas revisiones a
  propósito: un servidor que se reinicia solo (Vite al cambiar su config) deja el puerto un par de segundos.
- **Para que una app tome un cambio en su servidor Go: `bin/cockpit restart <app>`.** Apaga la de Cockpit, o la
  de una terminal sólo si el líder de su grupo de procesos es el `make` de esa app; si no, lo dice y no toca
  nada. No mates servidores a mano: nunca `pkill` con patrón, ni por puerto sin `-sTCP:LISTEN`.
- Lo que corre es el **código del working tree**: un cambio en el Vue de una app se ve al guardar (Vite); un
  cambio en su servidor Go pide reiniciar esa app. Sólo el chat y la carcasa piden reinstalar (abajo).

## Manejarlo desde una sesión

`bin/cockpit` habla con el puerto de control de Cockpit. Sin Cockpit abierto lo dice y sale 1: no bloquea nada.

    bin/cockpit status [--json]        qué apps hay, cuáles están arriba y cuál está al frente
    bin/cockpit open <app> [ruta]      trae una app al frente, en una ruta
    bin/cockpit restart <app>          la reinicia (su servidor Go no se recarga solo) y Cockpit la recarga
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
- **Frenar**: si Miguel toca «Frenar», el hook niega la siguiente herramienta (sale 2) hasta que reanude o te
  escriba. Pasan sólo `bin/cockpit say|status|apps` y las herramientas internas de la app (`open` y `restart` hacen algo: no pasan). Si te frena: contá en una línea
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
| la carcasa: la barra, la configuración (el engranaje abre un modal como el de canon: Apariencia, Claude, Apps —su estado y Reiniciar, con `apps_state` y `restart_app`— y Cómo se usa), los iframes, el panel «Claude», el botón Frenar | `shell/index.html` (su tema y taller son copias de `tools/ui`: `make estilo-sync`) |
| el cliente del puerto de control | `lib/cockpit/` · el CLI: `cmd/cockpit/` (`bin/cockpit`) |
| qué se ve de cada herramienta y a qué app lleva | `tablero/server/internal/hooks/cockpit.go` (con test) |
| lo que una app le dice a la carcasa | `tools/ui/workbench.js` (todas) · `chat/src/desktop.js` (el chat) |

**La carcasa y las apps se hablan por `postMessage`.** La app manda `badge` (su numerito), `theme` y `palette` (cambió el
tema o la paleta), `open` (abrí otra app) y `claude` (su asterisco: abrí o cerrá el panel); la carcasa manda `route` (ir a una ruta), `claude` (el panel abierto y si hay actividad sin ver), `visible` (si está a la vista: un
iframe escondido no se entera solo, y el chat marcaría leído), `theme` y `palette`. Cockpit tiene UN tema y UNA paleta
para todas (se eligen en el modal del engranaje, Apariencia).
Los enlaces `target="_blank"` de cualquier app los atrapa Rust y los abre en el navegador de Miguel.

**El puerto de control** escucha en 127.0.0.1:5209 y pide la llave que Cockpit deja al arrancar en
`~/.config/creditop-cockpit/control.json` (600, se borra al salir): `GET /status`, `GET|POST /stop`,
`POST /open`, `/say`, `/activity`. La llave existe para que una página web cualquiera no pueda manejar Cockpit.

**Agregar una app**, en este orden:

1. Que tenga su `make <app>` y sus puertos (`.claude/launch.json` dice cuáles están tomados).
2. Una entrada en `APPS` (`main.rs`): id, nombre, url, los `host:puerto` que tienen que contestar, y su `make`.
3. Su ícono en `ICONS` (`shell/index.html`).
4. El estilo «Paneles» y el tema compartido: sumala a `tools/ui-sync.py` y `tools/style.py`, y `make
   estilo-sync` + `make estilo-check`.
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
