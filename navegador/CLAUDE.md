# navegador · reglas de trabajo

> **Para qué existe:** configurar cosas en **paneles de administración** complejos (una tienda en VTEX o
> Shopify, un backoffice) sin pelearse con la herramienta. Te logueás **a mano** en un Chromium real
> (playwright-go) y Claude, con `bin/navegador ask`, te **guía** paso a paso marcando en la página qué tocar, o
> **lo hace** él y frena antes de guardar con la lista de cambios. Lo que se hace queda como **script de
> Playwright** y como **paso a paso con fotos** (una guía que se puede volver a ver). Leer o investigar páginas
> públicas NO es para esto: Claude lo hace mejor directo. No es el harness: el wizard de CreditOp con datos de
> dominio se prueba allá.

## Cómo está construido

| Pieza | Qué es | Archivos |
|---|---|---|
| Interfaz | Vue en **:5202**. Sidebar con tres pestañas: **Corridas** (lanzar una meta, y las que tienen reporte; `#/corrida/<id>` la abre en el editor como un video: por paso, la foto de antes con el elemento marcado y la de después, con leyenda, play y la tira de cuadros y su resumen y fuentes a la derecha), **Evals** (cada caso con su último resultado y su historia, de `evals/historial.jsonl`; se corren desde la terminal) y **Sitios** (el explorador: árbol de sitios y páginas, la página en vivo o la captura). Consola con pestañas | `src/App.vue`, `src/RunViewer.vue` |
| API | Go en **:5203**. Sitios, recorrido, análisis, sesión en vivo, reporte | `server/main.go` |
| Análisis | Lo que corre adentro de cada página: estructura, elementos interactivos y sus candidatos a localizador, avisos, muros anti-bots | `server/analyze.js` (embebido) |
| Localizadores | Prueba cada candidato con Playwright (cuántos encuentra y si es ese elemento) y elige el primero que sirve | `server/locators.go`, `server/frames.go` (iframes) |
| Recorrido | Explora el sitio a lo ancho, sólo `<a href>` del mismo host, sin enviar formularios | `server/browser.go` |
| En vivo | Chromium sin ventana transmitido por CDP al editor, acciones por localizador, pasos, diálogos, descargas. Dos dispositivos de tamaño fijo: **escritorio** 1280×800 (por defecto) y **móvil** (perfil Pixel 7 de Playwright: agente, táctil, densidad); el editor lo escala para que entre | `server/live.go` |
| Reporte | El paso a paso de una corrida: md, html con una foto por paso, las fuentes consultadas, script | `server/report.go` |
| Modo guía | `point <n> '<instrucción>'` marca el elemento en la página en vivo, con la instrucción en una barra encima, y espera a la persona (su clic o su teclado, o «Hecho» / «No lo encuentro»; hasta 100 s). El paso queda con su foto de antes y la línea de Playwright de lo que se pidió | `server/guide.go`, `cli/main.go` |
| Modo hacerlo | Claude actúa; `cambios` lista cada campo antes → después (secretos tapados) para el CONFIRMAR. Bajo `ask`, en un sitio real, el CLI **niega** Guardar/Activar/Publicar/Enviar/Eliminar… hasta que la persona dice que sí en esa vuelta | `server/guide.go` (`LiveChanges`), `cli/main.go` (`saveGuard`), `cli/ask.go` |
| Video | El reproductor de una corrida: por paso, la foto de antes y la de después, un cursor que va al punto de la interacción (el centro del elemento, o el clic real de la persona) y deja una onda, y subtítulos con qué se hace y **por qué** (lo que Claude pensó antes de actuar: `ask` lo manda a `/api/live/narrate`). Voz opcional con la del navegador | `src/RunViewer.vue` |
| Repetir una guía | «Repetir esta guía» recorre una corrida de nuevo en la sesión en vivo, **sin Claude**: cada paso trae su localizador estructurado (`ref`), su acción y su valor. En cada uno la persona elige «Hacelo vos» / «Lo hago yo» / «Saltar»; «Seguí solo» avanza hasta el próximo paso que guarda, pide una llave o no se encuentra. Moverse y comprobar textos se hacen solos. La repetición es una corrida nueva (la guía verificada con fecha) | `server/replay.go`, `src/App.vue` |
| Panel Andino | Admin **ficticio** de Tienda Andina (:5206), tratado como sitio REAL: menú lateral anidado, buscador, barra «cambios sin guardar», modal de medios de pago, condiciones de pago, activar con confirm(), envíos con pestañas, una app en iframe | `demo-admin/` |
| CLI | `bin/navegador`: maneja la sesión en vivo por consola | `cli/main.go` |
| `ask` | Claude Code (`claude -p`) maneja la sesión hasta cumplir una meta | `cli/ask.go`, `cli/ask.md` (sus instrucciones) |
| Meta desde la interfaz | La API corre el MISMO `bin/navegador ask` con `NAVEGADOR_EVENTS=1` (una línea JSON por evento), en su propia sesión y sin terminal: la respuesta a un NECESITO/CONFIRMAR le llega por stdin. El panel **Agente** muestra lo que piensa y hace, la pregunta con Sí/No y el resultado. Una a la vez | `server/ask.go`, `/api/ask` |
| Evals | La suite de regresión de `ask` | `cli/evals.go`, `evals/casos.json`, `evals/replay.cjs`, `evals/historial.jsonl` |
| Credidemo | Sitio de **práctica** (:5204): solicitud de crédito con reglas + laboratorio (`/lab/`) | `demo/` |
| Tienda Andina | Sitio ficticio que `ask` trata como **real** (:5205): consentimientos, pago, borrado | `demo-real/` |

`make navegador` levanta todo (interfaz, API, Credidemo, Tienda Andina y Panel Andino). La skill **`navegador`**
(`.claude/skills/navegador/`) lleva el ciclo de `ask` a una conversación normal.

Lo que se guarda vive en `navegador/.data/` (gitignoreado: trae sesiones abiertas): `sites.json`, y por sitio su
perfil de Chromium (el login), el mapa y las capturas; `corridas/<fecha>/` (fotos, reporte y script de cada
corrida, servidas en `http://localhost:5202/api/corridas/…`; `run.json` y `pasos.json` son lo que lee la interfaz por `/api/runs`) y `descargas/`.

## Cómo se valida

- **`make navegador-evals`** corre las metas de `evals/casos.json` con el mismo motor que `ask` y compara cómo
  terminaron. LISTO exige que el script se repita en un Chromium nuevo (`replay.cjs`) y tenga al menos una
  aserción que pase. CONFIRMAR/NECESITO se contestan solos con «no» y se exige que después no haya un paso sobre
  nada de `prohibido`. En un panel, `estado` es una expresión JS que tiene que dar true al final: lo que quedó
  GUARDADO, no lo que Claude dice (con respuesta «sí» además tiene que terminar en LISTO). `debe_decir` exige que
  la respuesta mencione algo. `SOLO=`, `SIN_INTERNET=1`, `V=1`. Cada caso arranca con un
  **perfil limpio**.
- **Antes de tocar `ask.md` o el CLI, correla.** Cada corrida suma una línea a `evals/historial.jsonl` (en git
  a propósito: es la historia de la calidad de `ask`; se commitea cada tanto). Comparar **tokens**, no sólo
  dólares (ver trampas).
- Para probar la suite sin gastar: `NAVEGADOR_CLAUDE=<script>` apunta a un Claude simulado que habla
  `stream-json`. Esas corridas no van al historial.
- Lo que no es de `ask` se prueba corriéndolo contra Credidemo con el CLI, y repitiendo el script exportado.

## Decisiones que no se deshacen

- **Qué sitio es de práctica lo decide el CLI, no el modelo**: una lista de host:puerto (`NAVEGADOR_PRACTICE`;
  por defecto Credidemo y `*.test`). Todo lo demás —también una app propia en `localhost`— es real, y ahí `ask`
  frena con CONFIRMAR antes de un consentimiento, un pago o un borrado.
- **Un muro anti-bots o un captcha no se pasa**, ni se investiga cómo pasarlo. El análisis lo marca
  (`MURO ANTI-BOTS`) y es un NO PUDE. Pexels está detrás de uno (Cloudflare); Unsplash tampoco cargó
  («Something went wrong»), sin confirmar la causa.
- **Guardar en un sitio real lo autoriza la persona, y lo hace cumplir el CLI** (`saveGuard`): `ask` escribe
  `~/.cache/navegador/aprobado` cuando la persona contesta que sí a un CONFIRMAR y lo borra al terminar esa
  vuelta. Un `press Enter` en un formulario no pasa por esa guarda: es un hueco conocido (queda la regla del prompt).
- **Sólo se repiten las corridas grabadas desde que cada paso guarda su `ref`** (el localizador como datos: la
  línea TS no se puede ejecutar desde Go). Las más viejas se ven en el reproductor pero no muestran «Repetir».
- **El «por qué» de un paso es el último texto que Claude escribió antes de actuar**: si un pensamiento llega
  después de que el comando ya corrió, queda en el paso siguiente (es una carrera entre el stream y el comando).
- **En el modo guía la instrucción va AFUERA de la página** (una barra sobre el editor): encima del canvas tapaba
  lo que la persona tenía que tocar.
- Se sacaron la investigación de páginas públicas y las descargas de contenido (`readfile`, `images`, `media`, la
  descarga de imágenes y sus evals): eso Claude lo hace mejor sin la herramienta. `read` queda para los textos de
  ayuda de una pantalla; `download`, para un export o un reporte. La historia está en git (commit `2837ec3b` y
  anteriores).
- **Contraseñas, tarjetas y documentos reales: nunca.** El login en un sitio real lo hace Miguel a mano en la
  ventana; el perfil de Chromium lo guarda. Contra prod, sólo mirar.
- **Un paso es una acción por localizador.** Lo que se hace a mano sobre el canvas (clics por coordenadas) no
  queda en el script: es un pendiente conocido.
- `ask` corre Claude Code desde una carpeta neutra (sin el CLAUDE.md de este repo, sus hooks ni los MCP), con
  permiso **sólo** para el binario del navegador y `Read`. Sin `grep` ni `head`: sin tuberías por construcción.

## Trampas que ya costaron tiempo

- **Cambiar de dispositivo reabre el navegador** en la misma página (el perfil de un teléfono se fija al abrir):
  con un perfil limpio se pierde lo que había. Por consola: `open --movil`, `device movil|escritorio`, `ask
  --movil`; en un caso de evals, `"dispositivo": "movil"`. El script de un recorrido móvil lleva
  `test.use({ ...devices['Pixel 7'] })` y `replay.cjs` lo repite con ese perfil.
- **«Timeout 10000ms exceeded» no decía nada**: el error de una acción suma la causa del registro de Playwright
  (`callLogWhy`: quién tapa el clic, no se ve, fuera de la pantalla). En móvil la primera prueba lo destapó:
  Credidemo medía 634 px en un teléfono de 412 y una tarjeta tapaba «Mi cuenta». Los dos sitios de práctica son
  responsivos desde entonces (Credidemo con su menú detrás de ☰).

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
  que levantó `make navegador`, el panel Agente muestra el error de login. Para probar la interfaz sin gastar,
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
- **Son fuentes lo que se leyó o donde se hizo algo**, no cualquier página analizada de fondo (una de antes de
  un `reset` se colaba en el reporte).
- **Un estado que dejó otra corrida contamina la prueba** (un login en la sesión en vivo): las evals abren cada
  caso con un perfil temporal (`clean=1`).
