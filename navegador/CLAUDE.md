# navegador · reglas de trabajo

> **Para qué existe:** aprender y automatizar el uso de **herramientas complejas** (un panel de administración, un
> backoffice, una tienda en VTEX o Shopify). Le decís a Claude qué querés hacer en una app; lo hace en un Chromium
> real (playwright-go) mientras lo ves trabajar, y lo que aprende queda como **flujo**: un JSON en
> `navegador/flujos/` que se **reproduce** navegando de nuevo (con sus datos precargados, parando donde tiene que
> actuar la persona) o se **enseña** paso a paso. El login lo hacés **a mano**. Leer o investigar páginas
> públicas NO es para esto: Claude lo hace mejor directo. No es el harness: el wizard de CreditOp con datos de
> dominio se prueba allá.

## Cómo está construido

| Pieza | Qué es | Archivos |
|---|---|---|
| Interfaz | Vue en **:5202**, para MIRAR y reproducir: lo que hay que hacer se le pide a Claude en la conversación (él maneja todo por la API y el CLI). Izquierda: «Abrir una página» (cualquier URL en vivo, para loguearse a mano: cada host guarda su login en su perfil) y un árbol: cada **proyecto** es una carpeta con sus **flujos**; abrir la carpeta muestra la portada del proyecto (sus flujos con play). Un flujo se borra desde el árbol o su sidebar; un proyecto, desde el árbol o su portada (`DELETE /api/projects/<app>`: sus flujos y sus corridas en .data; una app de práctica queda en la lista, vacía). Con un flujo abierto, el editor muestra sólo su video y el sidebar derecho su información: el botón Reproducir y lo que se edita a gusto (nombre, texto de cada paso, sacar pasos, sus datos y dónde para); si Claude está trabajando, ese sidebar tiene las pestañas Flujo y Claude. Las corridas no se muestran: son el material del video de cada flujo. Centro: el navegador en vivo (con la barra del paso de la guía o de la reproducción), el video de una corrida o un flujo con sus datos. Derecha: **Claude trabajando**. Abajo: Pasos y Script | `src/App.vue`, `src/RunViewer.vue` |
| Tiempo real | UN stream SSE (`/api/events`): el estado de la sesión cuando cambia, cada evento de Claude, las corridas y los flujos al guardarse. Los cuadros del navegador van por `/api/live/frames` | `server/events.go` |
| API | Go en **:5203**. Sesión en vivo, Claude, corridas, flujos, apps | `server/main.go` |
| Sesión en vivo | Chromium sin ventana transmitido por CDP, acciones por localizador, diálogos, descargas. Escritorio 1440×900 a densidad 2 (por defecto; las fotos de los pasos, en píxeles CSS) o móvil (perfil Pixel 7) | `server/live.go`, `server/browser.go` |
| Análisis | Lo interactivo de la pantalla con sus localizadores verificados (también en iframes) y los avisos (incluido MURO ANTI-BOTS) | `server/analyze.js`, `server/locators.go`, `server/frames.go` |
| Claude | `bin/navegador ask` corre Claude Code (`claude -p`) sobre la sesión. Desde la interfaz, la API corre el mismo comando con `NAVEGADOR_EVENTS=1` y le pasa las respuestas por stdin. Lo que termina en LISTO se guarda solo como flujo | `cli/ask.go`, `cli/ask.md`, `server/ask.go` |
| Claude desde la conversación | `bin/navegador empezar [--url U] '<meta>'` abre una sesión en el panel; cada comando aparece solo, `pienso '<texto>'` muestra lo que piensa (y es el subtítulo del próximo paso), y `terminar 'LISTO: …'` guarda la corrida y, con LISTO, el flujo. El servidor ignora los comandos si no hay sesión abierta | `cli/main.go`, `server/ask.go` (`Begin`, `Event`, `End`) |
| Automático / Enseñame | Automático: Claude hace todo; guardar y activar van solos y **sólo lo irreversible** (eliminar, desactivar, pagar, enviar) frena con CONFIRMAR, y el CLI niega ese clic sin el sí (`saveGuard`). Enseñame: Claude no toca; marca cada paso con `point` y la persona lo hace | `cli/main.go`, `server/guide.go` |
| Flujos | JSON en `navegador/flujos/<app>/<id>.json`: meta, inicio, dispositivo y pasos (acción, localizador estructurado, valor, instrucción, porqué). Un paso que escribe o elige es un **dato** (se cambia antes de reproducir); «pausa» lo deja para la persona. Una reproducción completa lo marca **verificado** | `server/flows.go` |
| Reproducir | Sin Claude y siempre **autorrellenando** (como el harness con un formulario): escribe, elige y marca sola con los datos del JSON, y cada botón o enlace lo toca la persona. También para en una llave, en un «lo hago yo», en un campo sin valor (raro) o si el elemento ya no está. Es una corrida nueva. (El servidor conserva los modos `auto` y `teach`, sin botón en la interfaz) | `server/replay.go` |
| Corridas | Cada trabajo o reproducción guarda en `.data` sus fotos de antes y después de cada paso, el punto de la interacción, el porqué y el script. No se muestran sueltas: son el video («Cómo se hizo») del flujo que salió de ahí o de su última reproducción | `server/report.go` |
| Proyectos | Cada app es un **proyecto** con sus flujos (la barra lateral los agrupa así, también los que todavía no tienen ninguno). Las apps de práctica viven en `navegador/apps/<id>/` con su `app.json` (nombre, puerto, descripción, inicio): la API las sirve al arrancar y las trata como sitios REALES. **Demo · Tareas** (:5207, lo más simple: crear, actualizar, borrar; trae flujos en `flujos/tareas/`) y **Panel Andino** (:5206, un admin de tienda con medios de pago, envíos y una app en iframe). En una app local, el flujo guarda sus URLs relativas a la app | `server/apps.go`, `apps/`, `flujos/` |
| Evals | La suite de `ask` sobre las apps: cómo terminó, qué quedó guardado (`estado`) y si el script se repite | `cli/evals.go`, `evals/casos.json` |

`make navegador` levanta todo. La skill **`navegador`** (`.claude/skills/navegador/`) lleva el ciclo a una
conversación normal. Lo que se guarda fuera de git vive en `navegador/.data/` (perfiles de Chromium con el login,
corridas con sus fotos, descargas).

## Cómo se valida

- **`make navegador-evals`** corre las metas de `evals/casos.json` con el mismo motor que `ask`. `estado` es una
  expresión JS que tiene que dar true al final: lo que quedó GUARDADO, no lo que Claude dice. Cada caso arranca
  con un perfil limpio. Cada corrida suma una línea a `evals/historial.jsonl` (en git a propósito).
- **Antes de tocar `ask.md` o el CLI, correla.** Comparar tokens, no sólo dólares.
- Para probar sin gastar: `NAVEGADOR_CLAUDE=<script>` apunta a un Claude simulado que habla `stream-json`. La
  configuración `navegador-prueba` (`.claude/launch.json`) levanta otra copia (web :5212, API :5213, apps +10,
  flujos en otra carpeta) con un Claude simulado.

## Decisiones que no se deshacen

- **Qué sitio es de práctica lo decide el CLI**, no el modelo (`NAVEGADOR_PRACTICE`, por defecto `*.test`). Las
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

- **Cambiar de dispositivo reabre el navegador** en la misma página (el perfil de un teléfono se fija al abrir):
  con un perfil limpio se pierde lo que había. Por consola: `open --movil`, `device movil|escritorio`, `ask
  --movil`; en un caso de evals, `"dispositivo": "movil"`. El script de un recorrido móvil lleva
  `test.use({ ...devices['Pixel 7'] })` y `replay.cjs` lo repite con ese perfil.
- **«Timeout 10000ms exceeded» no decía nada**: el error de una acción suma la causa del registro de Playwright
  (`callLogWhy`: quién tapa el clic, no se ve, fuera de la pantalla). En móvil es lo más común.

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
  que levantó `make navegador`, el panel de Claude muestra el error de login. Para probar la interfaz sin gastar,
  la configuración `navegador-prueba` (`.claude/launch.json`) levanta otra copia con un Claude simulado.
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
  repetidos y corta en 40 (`look --buscar`, `look --todo`).
- **Un estado que dejó otra corrida contamina la prueba** (un login en la sesión en vivo): las evals abren cada
  caso con un perfil temporal (`clean=1`).
- **Una ventana emergente que abre la persona a mano** (un «Entrar con Google») se muestra en el editor y recibe su
  clic y su teclado hasta que se cierra (`showPopup`): antes se cerraba y la página principal iba a esa URL, y un
  login por popup se rompía (la ventana necesita a la página que la abrió). Lo que hacen Claude o una reproducción
  sigue igual. Lo que se teclea a mano en el canvas no queda en ningún paso ni registro.
- **Ctrl+V en la página en vivo no pegaba nada**: el atajo llegaba al Chromium del navegador, que tiene su propio
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
