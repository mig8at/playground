# Jarvis · reglas de trabajo

> **Para qué existe:** aprender y automatizar el uso de **herramientas complejas** (un panel de administración, un
> backoffice, una tienda en VTEX o Shopify). Le decís a Claude qué querés hacer en una app; lo hace en **tu Chrome**,
> con la extensión Jarvis, mientras lo ves trabajar, y lo que aprende queda
> como **flujo**: un JSON en
> `jarvis/flows/` que se **reproduce** navegando de nuevo (con sus datos precargados, parando donde tiene que
> actuar la persona) o se **enseña** paso a paso. El login lo hacés **a mano**. Leer o investigar páginas
> públicas NO es para esto: Claude lo hace mejor directo. No es el harness: el wizard de CreditOp con datos de
> dominio se prueba allá.
>
> Se llamó **navegador** hasta el 2026-11-07 (`navegador/`, `bin/navegador`, `make navegador`, `NAVEGADOR_*`): una
> cita vieja con ese nombre es esto mismo.

## Cómo está construido

| Pieza | Qué es | Archivos |
|---|---|---|
| Interfaz | Vue en **:5202**, para MIRAR y reproducir: lo que hay que hacer se le pide a Claude en la conversación (él maneja todo por la API y el CLI). Izquierda: «Abrir una página» (cualquier URL en vivo, para loguearse a mano: cada host guarda su login en su perfil) y un árbol: cada **proyecto** es una carpeta con sus **flujos**; abrir la carpeta muestra la portada del proyecto (sus flujos con play). Un flujo se borra desde el árbol o su sidebar; un proyecto, desde el árbol o su portada (`DELETE /api/projects/<app>`: sus flujos y sus corridas en .data; una app de práctica queda en la lista, vacía). Con un flujo abierto, el editor muestra sólo su video y el sidebar derecho su información: el botón Reproducir y lo que se edita a gusto (nombre, texto de cada paso, sacar pasos, sus datos y dónde para); si Claude está trabajando, ese sidebar tiene las pestañas Flujo y Claude. Las corridas no se muestran: son el material del video de cada flujo. Centro: el navegador en vivo, sin franja arriba: sus controles viven en el pie, en una línea — atrás, un punto verde (conectada) o gris (sin conexión con la API) que con el mouse se vuelve ⟳ y recarga, y la URL (un campo que se lee como texto y se edita con Enter; al lado, el estado sólo si es otro: Claude trabajando, una reproducción) y, a la derecha, escritorio, teléfono y cerrar la sesión, el punto de seguir a Claude y, al final como en todas las herramientas, el tema y las regiones (con la barra del paso de la guía o de la reproducción), el video de una corrida o un flujo con sus datos. Derecha: **Claude trabajando**. Abajo: Pasos y Script | `src/App.vue`, `src/RunViewer.vue` |
| Tiempo real | UN stream SSE (`/api/events`): las pestañas, el estado de cada sesión cuando cambia, cada evento de Claude (todos llevan su `tab`), las corridas y los flujos al guardarse. Los cuadros del navegador van por `/api/live/frames?tab=N`. **La vista «Todas»** (2026-11-20, el botón a la derecha de las pestañas; se recuerda en `jarvis.liveMode`): una grilla con cada sesión en vivo a la vez —su grupo con su color, la meta, el último paso; la tarjeta donde Claude actuó último, marcada—, y un clic la abre en grande. Sus miniaturas van por UN solo stream (`/api/live/thumbs`, `server/thumbs.go`: el último cuadro de cada sesión, uno por segundo y sólo si cambió), porque un navegador abre a lo sumo 6 streams por servidor en HTTP/1.1, y NO cuentan como mirar (no frenan el cierre automático) | `server/events.go`, `server/thumbs.go` |
| Pestañas | Varias sesiones a la vez, cada una con su página, su Claude, sus pasos, su corrida y su flujo: una pestaña es un `Runner` + un `Asker`. Qué pestaña atiende un pedido lo dice el encabezado `X-Jarvis-Tab` (o `?tab=`); sin él, **la última que se abrió**. Por consola, `--session N` (o `JARVIS_SESSION=N`) en cualquier comando, y `tabs [nueva [url] | close N]`; `ask` fija la suya para él y sus comandos. **Grupos** (2026-11-20, `server/groups.go`, `cli/groups.go`): cada meta de `start` va a su grupo de pestañas de Chrome —`--group 'VTEX' [--color blue]`, o sin él uno con el nombre de la meta (numerado si otro Claude ya trabaja en uno igual)—, con un color libre por grupo. La sesión la elige y la reserva el SERVIDOR (`POST /api/tabs/claim`, en fila con `claimMu`, reservada 90 s hasta que arranca su Claude): una libre del grupo, la vacía que siempre queda o una nueva; antes la elegía el CLI con una lista de recién y dos `start` a la vez tomaban la misma sesión vacía (el segundo chocaba con «ya hay un live corriendo»). Un pedido con `--group G` (encabezado `X-Jarvis-Group`, escapado) y sin `--session` va a la última sesión de ESE grupo; un grupo sin sesiones es 404, no la última en silencio. `bin/jarvis groups [close G [--force] \| move N G \| color G C]`; `PUT /api/tabs/<id> {group, color}` mueve una. Sólo se mueven al grupo las pestañas que abrió Jarvis (una compartida por la persona queda donde está); la extensión 0.2.3 o anterior no sabe agrupar (`chrome.tabs.setGroup`) y la sesión lo dice en su registro: se recarga en `chrome://extensions`. La interfaz elige cuál MIRA (barra arriba del navegador, «+» abre una vacía) sin cambiar ese default: un clic de la persona no manda los comandos de Claude a otra página. **Siguiendo a Claude** (el punto del pie, antes del tema y las regiones: naranja sigue, gris quieto; clic alterna, el tooltip explica; se recuerda): la vista salta a la pestaña donde Claude actúa —un comando o un pensamiento suyo, un paso nuevo, otra página—; si la persona eligió una a mano, se respeta 20 s. «Quieto» lo apaga. **Qué se reutiliza y qué se cierra** (2026-11-20, `server/cleanup.go`, `Tabs.Claim` en `server/groups.go`, `cli/cleanup.go`). *Reutilizar*: `start --url U` toma primero una sesión LIBRE (su meta terminó o nunca tuvo, nada en curso) que ya está en el sitio de U y usa su pestaña («reutilizo la sesión N…»); sin `--group` queda en el grupo que ya tenía. Después, una libre del grupo; después, la vacía inicial (que pasa a ser de Claude); recién ahí una nueva. `finish` y el arranque de una meta sueltan la reserva de Claim (`Tabs.Release`): antes una meta que empezaba y terminaba en menos de 90 s dejaba su sesión sin reutilizar. *Cerrar* (una regla para el barrido de cada 30 s y para `bin/jarvis cleanup [--apply]`, que dice qué y por qué): de lo que abrió Claude, una sesión terminada sin uso hace más de 3 min (`JARVIS_TAB_DONE_IDLE`; `cleanup` la cierra ya), una con su meta abierta sin un comando hace 10 min (`JARVIS_TAB_IDLE`, `0` apaga el barrido) y las pestañas **huérfanas**: las abrió Jarvis, están en un grupo que puso Jarvis y no las maneja ninguna sesión (un reinicio del servidor o una recarga de la extensión), con 60 s de gracia para una recién abierta. Nunca: lo que abrió o compartió la persona, lo que la interfaz mira, un `ask`, una reproducción, un paso de la guía o un login en curso (`inFlight`), ni la ventana aparte de Wally (no va en grupo). La última sesión no se borra: se le cierra la pestaña y queda vacía. La extensión guarda sus listas en `storage.local` (desde la 0.2.7: con `storage.session` se borraban al recargarla y sus pestañas parecían de la persona), las vacía al arrancar Chrome (los ids empiezan de nuevo) y anota los nombres de grupo que puso (`groupTitles`): una huérfana tiene que estar en uno de ésos, así un id viejo nunca apunta a una pestaña de un grupo tuyo. Un grupo que ya existe en OTRA ventana recibe la pestaña nueva (se muda), en vez de armarse otro con el mismo nombre. El CLI se identifica con `X-Jarvis-Client: cli` y `tabs` dice hace cuánto no se usa cada una. Playwright es uno solo para todas | `server/tabs.go`, `cli/main.go` (`takeTabFlag`, `pinTab`) |
| API | Go en **:5203**. Sesión en vivo, Claude, corridas, flujos, apps | `server/main.go` |
| Sesión en vivo | Una pestaña de tu Chrome transmitida por CDP, acciones por localizador, diálogos, descargas. Para que un sitio se vea como en un teléfono, `bin/jarvis ua iphone` cambia el agente de la pestaña | `server/live.go`, `server/browser.go` |
| Chrome · la extensión Jarvis | **Jarvis corre SÓLO en el Chrome de la persona** (decisión de Miguel, 2026-11-07): el Chromium propio —con `--chromium`, `--movil`, `device` y `JARVIS_MOTOR`— se sacó, y con él las evals. Si la extensión no está conectada, `open`, `start` y `ask` lo dicen y no abren nada; un flag viejo explica que ya no existe. Playwright sigue: es el que habla con el puente (`ConnectOverCDP`), sin bajar ningún navegador. La extensión **Jarvis** (`extension/`, MV3, se carga «descomprimida» en `chrome://extensions`) se conecta a `/api/chrome/bridge` y pasa el CDP de las pestañas con `chrome.debugger`; `/api/chrome/cdp` le habla a Playwright como si fuera un Chrome (`ConnectOverCDP`), así look, pasos, flujos, script y reproducción son los mismos. **Cada sesión del navegador es una pestaña real de Chrome**: las que abre Claude van al grupo de pestañas «Jarvis» (violeta) y se cierran al terminar; cerrar una a mano termina su sesión. **Claude trabaja de fondo** (2026-11-20, `server/focus.go`, `cli/focus.go`): un comando ya NO trae su pestaña al frente; sólo van al frente lo que necesita a la persona (`point`, el modo guía), los sitios marcados `front` en `jarvis/focus.json` y todo si `bin/jarvis focus follow on` (lo de antes: seguir a Claude). Un sitio sin perfil va de fondo; `focus check` lo mide con la pestaña detrás de verdad (la extensión pone al frente la pestaña Jarvis de esa ventana, `chrome.tabs.sendBehind`, desde la 0.2.5) y lo guarda; `focus set <sitio> front|background|auto` lo pone a mano y ni una medición ni una falla lo pisan. Una acción de fondo que vence por tiempo mide la página en ese momento y marca el sitio `front` sólo si la medición falla (un botón deshabilitado vence igual al frente). Las pruebas: `visibilityState`, `hasFocus()`, animaciones (rAF, que Playwright usa para saber si un elemento está quieto antes de un clic: >20 en 1 s) y temporizadores (>50 de 100 en 1 s). Sólo se tocan las pestañas que la persona **comparte** y las que abre Claude (lo niega la extensión, no sólo el servidor); si hay una compartida del mismo sitio, la sesión trabaja en ésa y la deja abierta. Al terminar la última sesión en Chrome se suelta el depurador (se va la barra amarilla). **La ventana aparte** (2026-11-17): un `Target.createTarget` con `newWindow` abre la pestaña en una ventana propia de Jarvis, que se reusa mientras exista (`createInAsideWindow`; con `background`, minimizada), para trabajo que la persona no necesita ver —el pool de AI Studio de Wally—; ésas no entran al grupo ni traen la pestaña Jarvis. **El panel lateral** (2026-11-20, `extension/side-panel.*`, desde la 0.2.6): el ícono de Jarvis abre el panel lateral de Chrome con los grupos de pestañas abiertos en esa ventana y sus pestañas (color, nombre, cuántas; un clic va a la pestaña; la cruz de cada grupo lo cierra con sus pestañas —también los tuyos y los que Jarvis ya no reconoce—, con un segundo clic de confirmación, desde la 0.2.9), leído directo de `chrome.tabGroups` y `chrome.tabs` y al día solo. Es lo mínimo a propósito (Miguel: lo de ver está en Cockpit; se suma después de verlo). La pestaña Jarvis (`control.html`) ya no se abre sola: sigue en la extensión, sin nada que la abra, y con ella quedó sin lugar el «Compartir» de tus pestañas. **El ícono** (desde la 0.2.10): una J blanca sobre el violeta del grupo «Jarvis», en `extension/images/` (`icon.svg`; `icon-small.svg` es su versión para 16 px, sin el punto y con el trazo más grueso). Los PNG salen de ahí con `node jarvis/dev/icons.cjs` (el Chromium del harness): se cambia el SVG y se corre. Vista previa con datos de ejemplo: `preview_start jarvis-side-panel` (`.claude/launch.json`, :5299, `/side-panel.html`). `bin/jarvis chrome` dice si está conectado. **Varios clientes de Playwright a la vez** (2026-11-20): el puente acepta más de una conexión a `/api/chrome/cdp` —las sesiones de Jarvis (la del propio servidor, `?client=jarvis`) y, en paralelo, el motor del harness (`jarvis-walk`, `jarvis-vtex-purchase`) u otro—, y cada pestaña tiene DUEÑO (`chromeTab.owner`): sus eventos van sólo a él, sus comandos sólo llegan a las suyas, al irse suelta sólo las suyas, y `dropPlaywright` (la última sesión de Jarvis terminó) corta sólo la del servidor. Antes había una sola y la segunda salía con «ya hay otra conexión de Playwright». Una pestaña compartida nueva le toca al servidor (`autoAttachClient`); una que abrió un cliente es de ése (el reparto espera a que termine `createTarget`: la extensión avisa «compartida nueva» antes de devolver el id), y las que abrió Jarvis para otra sesión no se adoptan al reconectar (son huérfanas y van a la limpieza). Medido el 2026-11-20 con `node jarvis/dev/two-clients.cjs`: el segundo cliente abrió el Panel Andino en 124-140 ms sin ver ninguna pestaña ajena y la usó 10 s, mientras la sesión de Jarvis hacía 3 acciones en 3 s; al irse, Jarvis siguió. **La ventana aparte para el trabajo de fondo** (2026-11-20, `server/aside.go`): `bin/jarvis start --aside '<meta>'` abre la pestaña de la sesión en la ventana aparte de Jarvis (la misma que usa Wally: nace sin foco y se reusa), no en la de la persona; nunca toma una pestaña que ella compartió. Playwright no sabe pedir «en otra ventana», así que el servidor le pide la pestaña al puente (`createTarget` con `newWindow`, para su propio cliente) y toma la página que Playwright ve llegar. Su grupo se arma DENTRO de esa ventana (desde la 0.2.12 la extensión no la muda a la de la persona aunque haya un grupo igual), `tabs` la marca «ventana aparte» y `start` reutiliza una sesión del mismo sitio sólo si está en el mismo modo. Se mira en la vista «Todas» de la interfaz o yendo a esa ventana; el panel lateral muestra los grupos de la ventana donde se abre. Medido el 2026-11-20: una sesión aparte y otra en la ventana de Miguel arrancaron en paralelo y la aparte hizo 3 acciones en 3 s, con capturas de 1920 px (las de la ventana de Miguel, ~1456). **Que Chrome no las descarte** (desde la 0.2.11): cada pestaña que abre Jarvis va con `autoDiscardable: false` (el ahorro de memoria descarta las de fondo, justo donde trabaja Claude); el ahorro de energía (Chrome 133+) igual puede congelar una de fondo que gaste mucho CPU, y eso no tiene llave para una extensión. Pruebas sin el Chrome de la persona: `dev/chrome-stand-in.cjs` y `dev/two-sessions.cjs`; con dos clientes en el Chrome de la persona: `dev/two-clients.cjs` | `server/chrome.go`, `extension/` |
| Análisis | Lo interactivo de la pantalla con sus localizadores verificados (también en iframes) y los avisos (incluido MURO ANTI-BOTS) | `server/analyze.js`, `server/locators.go`, `server/frames.go` |
| Claude | `bin/jarvis ask` corre Claude Code (`claude -p`) sobre la sesión. Desde la interfaz, la API corre el mismo comando con `JARVIS_EVENTS=1` y le pasa las respuestas por stdin. Lo que termina en LISTO se guarda solo como flujo | `cli/ask.go`, `cli/ask.md`, `server/ask.go` |
| Claude desde la conversación | `bin/jarvis start [--url U] '<meta>'` abre una sesión en el panel; cada comando aparece solo, `think '<texto>'` muestra lo que piensa (y es el subtítulo del próximo paso), y `finish 'LISTO: …'` guarda la corrida y, con LISTO, el flujo. El servidor ignora los comandos si no hay sesión abierta | `cli/main.go`, `server/ask.go` (`Begin`, `Event`, `End`) |
| Automático / Enseñame | Automático: Claude hace todo; guardar y activar van solos y **sólo lo irreversible** (eliminar, desactivar, pagar, enviar) frena con CONFIRMAR, y el CLI niega ese clic sin el sí (`saveGuard`). Enseñame: Claude no toca; marca cada paso con `point` y la persona lo hace | `cli/main.go`, `server/guide.go` |
| Flujos | JSON en `jarvis/flows/<app>/<id>.json`: meta, inicio, dispositivo y pasos (acción, localizador estructurado, valor, instrucción, porqué). Un paso que escribe o elige es un **dato** (se cambia antes de reproducir); «pausa» lo deja para la persona. Una reproducción completa lo marca **verificado** | `server/flows.go` |
| Reproducir | Sin Claude y siempre **autorrellenando** (como el harness con un formulario): escribe, elige y marca sola con los datos del JSON, y cada botón o enlace lo toca la persona. También para en una llave, en un «lo hago yo», en un campo sin valor (raro) o si el elemento ya no está. Es una corrida nueva. (El servidor conserva los modos `auto` y `teach`, sin botón en la interfaz) | `server/replay.go` |
| Corridas | Cada trabajo o reproducción guarda en `.data` sus fotos de antes y después de cada paso, el punto de la interacción, el porqué y el script. No se muestran sueltas: son el video («Cómo se hizo») del flujo que salió de ahí o de su última reproducción. **Al tablero llegan por el cierre**: `make closeout TASK=N` lista las corridas del lapso y las pone en el bloque del día como `jarvis:<id>` (Jarvis no escribe en el tablero; `tablero/server/cmd/closeout/jarvis.go` lee `run.json` y el `run` de cada flujo) | `server/report.go` |
| Proyectos | Cada app es un **proyecto** con sus flujos (la barra lateral los agrupa así, también los que todavía no tienen ninguno). Las apps de práctica viven en `jarvis/apps/<id>/` con su `app.json` (`name`, `port`, `description`, `start`): la API las sirve al arrancar y las trata como sitios REALES. **Demo · Tareas** (:5207, lo más simple: crear, actualizar, borrar; trae flujos en `flows/tasks/`) y **Panel Andino** (:5206, un admin de tienda con medios de pago, envíos y una app en iframe). En una app local, el flujo guarda sus URLs relativas a la app | `server/apps.go`, `apps/`, `flujos/` |
| Recetas y mapas | Una **receta** es una tarea completa de una herramienta con parámetros, sin clics: `make jarvis-recipe APP=vtex RECIPE=create-product ARGS='--name … --price …'`. Va por la **API** cuando la herramienta la tiene, y por pantalla lo que sólo existe en el admin. Catálogo y trampas: `recipes/README.md`. El **mapa** de una herramienta (`maps/<app>/map.json`) son sus pantallas y elementos con un nombre nuestro y el localizador que el análisis de Jarvis ya verificó; se arma con un barrido (`make jarvis-map APP=vtex A=save SCREEN=… FRAME='#raccoon-iframe'`, sobre la pestaña de Jarvis tal como está) y se comprueba con `A=verify`, que abre cada pantalla y falla si un elemento ya no está. Fuera del mapa: lo que se repite por fila de una lista y los enlaces «Nombre id» (son datos); marcado `fragil`: lo que sólo tiene CSS por posición. Una receta puede nacer de un **flujo** (el registro de un día): `make jarvis-recipe-from FLOW=… APP=… NAME=…` escribe su esqueleto (`recipes/from-flow.ts`), con lo escrito como parámetros. VTEX hoy: `admin` (el armazón), `products` y `new-product`. Antes del mapa va el **barrido de secciones** (nivel 1 de `GUIDE.md`, el método para aprender una herramienta): `node jarvis/dev/sweep.ts <app> <url>` recorre todo el menú sólo navegando y deja por pantalla sus encabezados, iframes y APIs al cargar (`maps/<app>/sections.json`, sin el armazón ni las precargas); lo que se aprende de ahí va en `maps/<app>/README.md` (VTEX: 97 pantallas en 9 secciones, 2026-11-07) | `recipes/`, `maps/`, `dev/map.ts`, `dev/sweep.ts`, `GUIDE.md` |
| Documentación por herramienta | Lo que Jarvis sabe de cada herramienta, **generado del repo** (no se escribe aparte): `docs/` (paquete Go) arma, por herramienta, sus **APIs** —cada receta con su camino (`api`: la llave de la cuenta, corre en cualquier máquina; `session`: las llamadas del admin con tu sesión; `screen`: la pantalla), qué escribe, sus avisos (⚠ de la cabecera) y las llamadas que hace en su código (`must`/`call`)—, lo que el admin escribe en cada **caso grabado**, sus **pantallas** (el mapa y el barrido del menú) y sus **flujos** (los de los hosts de `maps/<app>/tool.json`). Por consola y SIN servidor (sirve desde la nube): `bin/jarvis docs [vtex [apis\|screens\|cases\|overview]] [--json]`, y `bin/jarvis recipe vtex <receta> [args]` corre una. La pestaña Jarvis de la extensión lo muestra en el bloque «Herramientas» (VTEX → APIs · Pantallas · Flujos) por `GET /api/docs[/<app>]`, con copia en IndexedDB para cuando el servidor está apagado. Para que una receta salga bien documentada: su primer párrafo es el título, `make jarvis-recipe …` el uso, una línea con «ESCRIBE» lo que escribe, y cada «⚠» un aviso | `docs/`, `cli/docs.go`, `server/main.go`, `extension/control.js`, `maps/<app>/tool.json` |
| Cualquier caso del harness en su Chrome | `make jarvis-walk CASES='#hash:entidad' [TARGET=local] [FLOW=…] [HANDS=1]`: `harness-walk-wizard ENGINE=browser` con `JARVIS_CHROME=1`. Por defecto en LOCAL, con identidad a mano y el buró dictado al mock (sin qa ni copias de comercios). Antes de la primera corrida local: `make harness-doctor TARGET=local` y que el wizard tenga su `.env.local` (si sólo está `.env.local.asesor-bak`, el wizard lee el `.env`, que apunta a dev). Medido el 2026-11-07: CrediPullman por la tienda, 10 pantallas en 52 s hasta el 11. **Canal de asesor con dos pestañas**: `FLOW=merchant ADVISOR=c<hash>-fake@creditop.com` carga la sesión de prueba del comercio en la pestaña del asesor (cookies al contexto y `localStorage` del wizard) y, en el handoff de una CreditopX, el cliente sigue en una pestaña propia (`openCustomerTab`) mientras la del asesor queda en «se envió un mensaje»; las dos se cierran al final. Medido: Amoblando Pullman con CrediPullman, 12 pantallas en 54 s hasta el 11 (468371) | `Makefile`, `harness/dev/walk-wizard.ts`, `harness/pkg/wizard-browser.ts` |
| Compra automática (motor del harness) | `make jarvis-vtex-purchase TARGET=qa [HANDS=1]`: una compra VTEX entera en el Chrome de la persona a la velocidad del harness. No pasa por el análisis de Jarvis: es `harness-vtex CASES=rotativo` con `JARVIS_CHROME=1`, y el motor de navegador del caminador (`harness/pkg/wizard-browser.ts`) se conecta por `/api/chrome/cdp` a una pestaña nueva (grupo «Jarvis») con el agente de iPhone puesto por CDP, y la cierra al terminar. `HANDS=1` (`JARVIS_HANDS`): el motor rellena todo y marca en violeta el botón o la entidad que toca; espera a que lo toque la persona (15 min por pantalla). Medido el 2026-11-07: 10 pantallas en 2 min 44 s, solicitud 504729 en 11 y VTEX Approved. El primer intento —manejar el wizard con `look` y `act`— se descartó: el análisis por acción lo hacía lento y frágil | `harness/pkg/wizard-browser.ts`, `harness/pkg/autofill-qr.ts`, `Makefile` |

`make jarvis` levanta todo (en Cockpit es la app Jarvis, que lo levanta sola). **La API corre además de fondo**
(`make jarvis-install`, LaunchAgent `com.creditop.my-tools.jarvis`, binario `jarvis/bin/jarvis-server`, desde el
2026-11-18): `bin/jarvis` anda con Cockpit cerrado o con Jarvis oculto; el servidor de `make jarvis` espera el puerto y
la interfaz usa la de fondo. Después de cambiar el servidor: `bin/cockpit restart jarvis --wait` (la recompila y la
recarga). `make jarvis-status` · `make jarvis-uninstall`; su salida, `~/Library/Logs/my-tools-jarvis.log`. Al
reiniciarse, la extensión de Chrome se reconecta sola. La skill **`jarvis`** (`.claude/skills/jarvis/`) lleva el ciclo a una
conversación normal. Lo que se guarda fuera de git vive en `jarvis/.data/` (las corridas en `runs/`, con sus fotos; las descargas; los
perfiles de Chromium que quedaron de antes del 2026-11-07 ya no se usan).

## Cómo se valida

- **Go**: `go build ./... && go vet ./... && go test ./...` en `server/` y en `cli/`. **La interfaz**: `npx vite build`.
- **En la práctica, en tu Chrome**: `bin/jarvis open <url>` y `look`. Las recetas se prueban corriéndolas.
- **La extensión sin tu Chrome**: `node jarvis/dev/chrome-stand-in.cjs` (un navegador de prueba con la extensión
  cargada; no es un motor para trabajar).
- **Las evals se sacaron** el 2026-11-07 (decisión de Miguel: gastaban tokens). Su historia está en git
  (`jarvis/evals/`, `cli/evals.go`). Para probar `ask` sin gastar sigue `JARVIS_CLAUDE=<script>`, un Claude simulado
  que habla `stream-json`.

## Decisiones que no se deshacen

- **Todo lo que es código va en inglés; la interfaz y la prosa, en español** (Miguel, 2026-11-07): carpetas
  (`flows/`, `maps/`, `recipes/`), archivos, comandos de `make` y de `bin/jarvis`, flags y claves JSON de los mapas,
  las grabaciones y lo que imprimen las recetas con `--json`. **Los nombres viejos siguen andando**, porque las tareas
  guardan el comando exacto: los targets y variables de `make` (`jarvis-receta`, `RECETA=`, `MANOS=`…, en
  `HARNESS_OLD_TARGETS`/`HARNESS_OLD_VARS`), los nombres de las recetas (`JARVIS_OLD_RECIPES`), los comandos y flags de
  `bin/jarvis` (`cli/legacy.go`, el único español a propósito del código: `make tablero-naming` lo acepta sólo ahí), los
  flags de las recetas (`recipes/args.ts`), `JARVIS_SESION`, `JARVIS_FLUJOS` y `JARVIS_MANOS`, y un `proyecto.json`
  viejo. **Las claves JSON también, desde el 2026-11-11**: los flujos, las corridas, las apps de práctica y la API entre
  el servidor, la interfaz y la extensión (un contrato de tres partes) hablan en inglés (`steps`, `name`, `action`,
  `value`…: el nombre del campo de Go). Lo guardado se migró una vez —los flujos de `flows/`, las apps y `.data`, donde
  `corridas/` pasó a `runs/` y cada `pasos.json` a `steps.json`—, así que no hay código que lea las claves viejas. Las
  apps de práctica imitan un admin en castellano: sus textos, sus datos y los `id` de su HTML siguen en español a
  propósito (los flujos grabados los usan como selectores).
- **Qué sitio es de práctica lo decide el CLI**, no el modelo (`JARVIS_PRACTICE`, por defecto `*.test`). Las
  apps locales cuentan como reales a propósito: así se entrena el frenar antes de lo irreversible.
- **Sólo lo irreversible frena** (decidido el 2026-11-05): eliminar/borrar, desactivar/desconectar, pagar/comprar,
  enviar/publicar a terceros. El mismo criterio en el CLI (`destructiveLike`) y en la reproducción.
- **Un muro anti-bots o un captcha no se pasa**, ni se investiga cómo pasarlo: es un NO PUDE.
- **Contraseñas, llaves y documentos reales: nunca.** Una llave es un paso que hace siempre la persona; su valor no
  queda ni en el script ni en el flujo.
- **Un flujo nace de una corrida, no se escribe a mano**: sus pasos traen localizadores verificados contra la
  página. Se edita lo que la persona decide (datos, pausas, nombre).
- `ask` corre Claude Code desde una carpeta neutra (sin el CLAUDE.md de este repo, sus hooks ni los MCP), con
  permiso **sólo** para el binario del navegador y `Read`.
- Se sacaron (2026-11-05) el explorador de sitios, la investigación de páginas públicas, las descargas de
  contenido, Credidemo y Tienda Andina: la historia está en git.

## Trampas que ya costaron tiempo

- **Varias sesiones en la misma app comparten su `localStorage`** (es el Chrome de la persona, mismo origen), y una app
  que lee al cargar y guarda la lista entera pierde lo que hicieron las otras: medido el 2026-11-20 con
  `jarvis/dev/parallel-tasks.sh 4` en la demo de tareas, 4 sesiones crearon una tarea cada una a la vez (4,8 s) y
  quedó **1 de 4**; cada pantalla mostraba sólo la suya. La demo se corrigió (`apps/tasks/app.js`: cada cambio relee
  antes de escribir, escucha el evento `storage`, ids que no salen de la copia de la pestaña) y dio **4 de 4**, con
  las 4 pantallas mostrando las 4, en dos corridas (12,3 s y 6,1 s: variación). Sus flujos grabados siguen andando
  («Crear una tarea» y «Actualizar una tarea»: 5 pasos de la herramienta, 0 a mano). Al probar una app real en
  paralelo con Jarvis, esto es lo primero que hay que mirar: el paralelismo es de verdad.

- **`Runner.State().Busy` es true en TODA sesión con página** (2026-11-20): la sesión en vivo corre como un trabajo
  (`kind` «live»), así que no dice si hay algo en curso. El barrido lo usaba como «hay una reproducción» y por eso nunca
  cerró una sesión con página —sólo las vacías—: las pestañas de Claude se juntaban hasta que alguien las cerraba a
  mano. Para «está haciendo algo» va `inFlight` (`cleanup.go`): un `ask`, una reproducción, la guía o un login.

- **Una pestaña de Jarvis detrás NO se oculta para la página** (medido el 2026-11-20 en el Chrome de Miguel, demo de
  tareas, dos sesiones en la misma ventana): la de detrás daba `visibilityState` `visible`, `hasFocus()` true, ~60
  animaciones y ~100 temporizadores por segundo, y escribir, hacer clic, leer y capturar anduvo igual (5 acciones en
  4 s). Lo más probable —no se aisló— es el screencast de cada sesión (una pestaña capturada no se oculta) más la
  emulación de foco que pone Playwright al conectarse. Por eso traer la pestaña en cada comando sobraba y se sacó
  (focus.go). Si el screencast se apaga alguna vez, esto deja de valer: `focus check` lo vuelve a medir.

- **El puente no reenvía `Browser.close` (ni `Browser.crash`, `Target.disposeBrowserContext`)**: es el Chrome de la
  persona, y un cliente de Playwright que «cierra el navegador» al terminar no tiene que poder tirarlo.
- **Para manejar un flujo largo, el motor del harness y no `look`/`act`**: analizar la página antes de cada acción
  cuesta segundos y, recién recargada, no encuentra los campos (dos corridas trabadas en el celular, 2026-11-07).

- **El puente de Chrome imita lo que `chrome.debugger` no tiene** (2026-11-07): Playwright 1.60, al conectarse por
  CDP, pide `Target.getTargetInfo` sin sesión, `Target.attachToBrowserTarget` y, para el screencast,
  `Target.attachToTarget` sobre esa sesión. `chrome.debugger` da UNA sesión por pestaña: la segunda es un alias
  (`pw-alias-N`) que manda a la misma pestaña y recibe una copia de sus eventos. Si una versión nueva de Playwright
  falla al conectar, el error dice qué comando falta: se contesta en `handleCommand`.
- **Las respuestas de Chrome vuelven a Playwright en orden con los eventos** (2026-11-18): la respuesta de un comando
  reenviado se entrega desde el lector de la extensión (`sendThen`), no desde una goroutine aparte. Antes, con dos o
  tres sesiones abriéndose a la vez, un `Runtime.executionContextCreated` le ganaba a la respuesta de
  `Page.getFrameTree`: Playwright no conocía el frame, descartaba el contexto y la primera lectura de la página
  esperaba para siempre («la sesión en vivo no arrancó en 60 s»; y un intento más chocaba con «ya hay otra conexión
  de Playwright»). Fallaba 1 de cada 2 o 3; después, 15 de 15. Para ver qué pasa por el puente: `JARVIS_CDP_LOG=<archivo>`
  anota cada comando (→), cada respuesta (←) y los eventos de navegación; un → sin su ← es el que quedó colgado. Con
  la API de fondo: `launchctl setenv JARVIS_CDP_LOG <archivo>` y `bin/cockpit restart jarvis --wait` (y `unsetenv` al
  terminar).
- **Los eventos de depuración tienen que salir en orden**: la extensión mira qué pestañas están permitidas en una
  copia en memoria, sin `await`. Con una lectura asíncrona por evento se pueden desordenar.
- **Al reconectarse, la extensión suelta el depurador de las pestañas**: si el servidor se reinició con una sesión
  abierta, la pestaña quedaba enganchada con el estado del Playwright anterior y la sesión siguiente no arrancaba
  («no arrancó en 60 s»).
- **Para probar la extensión sin el Chrome de la persona**, un Chromium de Playwright con `--load-extension`. Pero
  ese Playwright **rechaza solo los diálogos que nadie escucha** y le gana al «aceptar» del navegador (un confirm
  de borrar salía aceptado y no borraba): hay que registrarle un `page.on('dialog', () => {})` vacío. Ese Chromium de prueba ya está armado: `node jarvis/dev/chrome-stand-in.cjs`.
- **Y no se lo bloquea**: si el mismo proceso de Node que lanzó ese Chromium corre `bin/jarvis` de forma
  SINCRÓNICA (`execFileSync`), cada pestaña nueva queda en pausa esperando a ese Playwright, que no atiende hasta que
  el comando termine, y el comando espera a la pestaña: `start` da timeout. Las llamadas van con `execFile`.

- **Un GET de la interfaz no es uso de una pestaña**: la interfaz consulta el estado de todas solas, así que contarlo
  dejaría vivas para siempre las que Claude abandonó. Cuenta un pedido del CLI (cualquiera), una acción de la persona
  (todo lo que no es GET) y mirarla (el stream de cuadros abierto). Nació de un día con diez pestañas viejas del wizard
  abiertas (2026-11-06).

- **Las ventanas emergentes se escuchan con `page.OnPopup`** y no con `OnPage` del contexto: el contexto es el de todo
  tu Chrome, y la página que abre otra pestaña no es un popup de ésta.

- **`shot` sacaba sólo lo visible, y `fullPage` de Playwright no alcanza** (2026-11-13): en Gmail, y en muchos admin, lo
  que se desplaza es un panel interno y el documento mide lo mismo que la ventana. `shot --full captura.png`
  (`server/fullshot.go`) elige el elemento que de verdad se desplaza, lo baja de a una pantalla y deja **una página por
  pantalla**, numeradas (`captura-01.png`, `-02`…), a la resolución real de la pantalla (2x en retina), con 48 px
  repetidos entre una y la siguiente para que ninguna línea quede partida sin verse entera. Tope: 20 000 px CSS. Lo que
  flota (`sticky`/`fixed`, como la barra de «Responder» de Gmail) se esconde mientras tanto: si no, sale en cada foto y
  tapa el texto de abajo. La primera versión pegaba todo en UNA tira (1132×19 560 px, a 1x): ilegible y borrosa
  (Miguel la descartó el mismo día). Medido en un hilo de Gmail: 37 páginas de 2264×1158 px.
- **«Timeout 10000ms exceeded» no decía nada**: el error de una acción suma la causa del registro de Playwright
  (`callLogWhy`: quién tapa el clic, no se ve, fuera de la pantalla).

- **El driver de Playwright se arma desde npm** (`server/driver.go`): playwright-go lo baja de un CDN que ya no
  publica los zips (404). Queda en `~/.cache/ms-playwright-go/<versión>/`; `replay.cjs` usa ese mismo
  `playwright-core`.
- **Vite escucha sólo en IPv6:** las URLs que se dan van con `localhost`, nunca `127.0.0.1:5202`.
- **Los manejadores de eventos de playwright-go corren en el hilo del driver:** llamar ahí a algo que espera
  respuesta (Evaluate, Screenshot, Accept de un diálogo) lo traba. Anotan y mandan a un canal o una goroutine.
- `Dblclick` de playwright-go manda un campo (`steps`) que el driver rechaza: se usa `Click` con `ClickCount: 2`.
- **Un `confirm()` sin atender se descarta en silencio** y la acción sale ✓ sin hacer nada. Se contestan según
  `dialog accept|dismiss` y quedan como `page.once('dialog', …)` antes del paso.
- **`innerText` del body no ve Shadow DOM ni iframes:** `text` los suma; si no, dice «no aparece» sobre algo
  que está. El análisis entra a los dos (`page.frameLocator(…)` para los iframes).
- **El primer texto de una página grande suele estar oculto:** `wait` espera la primera coincidencia visible.
- **La versión de la página sube sola** (lo que carga después, un análisis de fondo): una acción con un número
  viejo se niega salvo que ese número siga nombrando lo mismo (el CLI manda el nombre).
- **El costo de una corrida depende de la caché de prompts:** el mismo caso costó US$ 0,066 con 2 400 tokens
  escritos a caché y US$ 0,325 con 13 900. La telemetría de `ask` (modelo y tokens) está para comparar eso.
- **Una meta lanzada desde la interfaz hereda el entorno de la API**: sin `CLAUDE_CODE_OAUTH_TOKEN` en la shell
  que levantó `make jarvis`, el panel de Claude muestra el error de login. Para probar la interfaz sin gastar,
  la configuración `jarvis-prueba` (`.claude/launch.json`) levanta otra copia con un Claude simulado.
- **Claude Code corre en su propia sesión (`setsid`)**: un Ctrl-C o el «Frenar» no le llegan solos; `runClaude`
  se los pasa a su grupo.
- **Claude Code de consola necesita su propia sesión**: la del Code tab no se hereda. `CLAUDE_CODE_OAUTH_TOKEN`
  exportada (de `claude setup-token`). Corre en una sesión de terminal propia (`setsid`) y la respuesta a un
  NECESITO/CONFIRMAR se lee de `/dev/tty`.
- **Sin la palabra clave** (LISTO, NO PUDE, NECESITO, CONFIRMAR) `ask` no sabe si tiene que preguntar: la pide
  reescrita una vez, y la reconoce aunque venga con Markdown.
- **El cuadro de un paso se mide ANTES de actuar** (`shotBefore`: lleva el elemento a la vista, guarda su caja y
  la foto `NN-antes.png`): después de un clic que navega, el elemento ya no está. Una aserción (`wait`) marca el
  texto sobre la foto de después. Las corridas de antes de esto se ven sin cuadro.
- **Las fotos de los pasos esperan a que la página cargue** (con tope): sin eso salían desplegables a medio
  cerrar y videos en negro.
- **El «sí» no se reconocía**: `\b` en Go (RE2) es sólo ASCII, y después de la «í» de «sí» no hay límite de
  palabra. `affirmative` usa `([^\pL]|$)` (`cli/aff_test.go`).
- **Un `look` sin tope en YouTube eran 28 000 caracteres:** muestra primero lo que está en pantalla, agrupa los
  repetidos y corta en 40 (`look --search`, `look --all`).
- **Una ventana emergente que abre la persona a mano** (un «Entrar con Google») se muestra en el editor y recibe su
  clic y su teclado hasta que se cierra (`showPopup`): antes se cerraba y la página principal iba a esa URL, y un
  login por popup se rompía (la ventana necesita a la página que la abrió). Lo que hacen Claude o una reproducción
  sigue igual. Lo que se teclea a mano en el canvas no queda en ningún paso ni registro.
- **Ctrl+V en la página en vivo no pegaba nada**: el atajo llegaba al navegador manejado, que tiene su propio
  portapapeles (vacío). Ahora la interfaz toma el texto del evento `paste` y lo teclea en el campo con el foco
  (`onCanvasPaste`); sirve para una contraseña o un código largo, y no queda en ningún paso ni registro.
- **«Abrir una página» con otra sesión abierta** fallaba («ya hay un live corriendo»): `/api/live/start` navega si
  es el mismo sitio, o cierra la sesión y abre otra.
- **Dos ediciones de un flujo que llegan juntas se pisaban** (un dato y un «lo escribo yo»): leer, cambiar y
  escribir un flujo va con `flowsMu`.
- **En automático, la repetición pasa un instante por `waiting`** antes de actuar sola: un cliente que corta en
  `waiting` cree que espera a la persona.
- **El análisis ya no saca captura ni guarda la página** (era del explorador y frenaba cada acción): sólo los
  controles, sus localizadores y los avisos.
