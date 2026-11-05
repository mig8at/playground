# navegador · reglas de trabajo

> **Para qué existe:** entrar a una página con un Chromium real (playwright-go), loguearse **a mano** si
> hace falta, y después entenderla y manejarla: qué tiene, qué es interactivo y con qué localizador de
> Playwright se llega a cada cosa. Lo que se hace queda como **script de Playwright** y como **paso a paso con
> fotos**. Con `bin/navegador ask`, Claude Code la maneja solo hasta cumplir una meta. No es el harness: el
> wizard de CreditOp con datos de dominio (siembra, centrales, entidades) se prueba allá.

## Cómo está construido

| Pieza | Qué es | Archivos |
|---|---|---|
| Interfaz | Vue en **:5202**. Explorador (árbol de sitios y páginas) · editor (la página en vivo, o la captura con sus elementos marcados) · ficha · consola con pestañas (Pasos, Acciones, Formularios, Enlaces, Llamadas, Errores) | `src/App.vue` |
| API | Go en **:5203**. Sitios, recorrido, análisis, sesión en vivo, reporte | `server/main.go` |
| Análisis | Lo que corre adentro de cada página: estructura, elementos interactivos y sus candidatos a localizador, avisos, muros anti-bots | `server/analyze.js` (embebido) |
| Localizadores | Prueba cada candidato con Playwright (cuántos encuentra y si es ese elemento) y elige el primero que sirve | `server/locators.go`, `server/frames.go` (iframes) |
| Recorrido | Explora el sitio a lo ancho, sólo `<a href>` del mismo host, sin enviar formularios | `server/browser.go` |
| En vivo | Chromium sin ventana transmitido por CDP al editor, acciones por localizador, pasos, diálogos, descargas | `server/live.go` |
| Reporte | El paso a paso de una corrida: md, html con una foto por paso, script | `server/report.go` |
| CLI | `bin/navegador`: maneja la sesión en vivo por consola | `cli/main.go` |
| `ask` | Claude Code (`claude -p`) maneja la sesión hasta cumplir una meta | `cli/ask.go`, `cli/ask.md` (sus instrucciones) |
| Evals | La suite de regresión de `ask` | `cli/evals.go`, `evals/casos.json`, `evals/replay.cjs`, `evals/historial.jsonl` |
| Credidemo | Sitio de **práctica** (:5204): solicitud de crédito con reglas + laboratorio (`/lab/`) | `demo/` |
| Tienda Andina | Sitio ficticio que `ask` trata como **real** (:5205): consentimientos, pago, borrado | `demo-real/` |

`make navegador` levanta todo (interfaz, API, Credidemo y Tienda Andina). La skill **`navegador`**
(`.claude/skills/navegador/`) lleva el ciclo de `ask` a una conversación normal.

Lo que se guarda vive en `navegador/.data/` (gitignoreado: trae sesiones abiertas): `sites.json`, y por sitio su
perfil de Chromium (el login), el mapa y las capturas; `corridas/<fecha>/` (fotos, reporte y script de cada
corrida, servidas en `http://localhost:5202/api/corridas/…`) y `descargas/`.

## Cómo se valida

- **`make navegador-evals`** corre las metas de `evals/casos.json` con el mismo motor que `ask` y compara cómo
  terminaron. LISTO exige que el script se repita en un Chromium nuevo (`replay.cjs`) y tenga al menos una
  aserción que pase. CONFIRMAR/NECESITO se contestan solos con «no» y se exige que después no haya un paso sobre
  nada de `prohibido`. `SOLO=`, `SIN_INTERNET=1`, `V=1`. Cada caso arranca con un **perfil limpio**.
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
- **Antes de bajar algo, la licencia.** Si la página no la dice, no se asume libre. Con un buscador que filtra
  por licencia (Internet Archive: `licenseurl:*publicdomain*`), se filtra: el primer resultado muchas veces no
  declara nada.
- **Contraseñas, tarjetas y documentos reales: nunca.** El login en un sitio real lo hace Miguel a mano en la
  ventana; el perfil de Chromium lo guarda. Contra prod, sólo mirar.
- **Un paso es una acción por localizador.** Lo que se hace a mano sobre el canvas (clics por coordenadas) no
  queda en el script: es un pendiente conocido.
- `ask` corre Claude Code desde una carpeta neutra (sin el CLAUDE.md de este repo, sus hooks ni los MCP), con
  permiso **sólo** para el binario del navegador y `Read`. Sin `grep` ni `head`: sin tuberías por construcción.

## Trampas que ya costaron tiempo

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
- **Claude Code de consola necesita su propia sesión**: la del Code tab no se hereda. `CLAUDE_CODE_OAUTH_TOKEN`
  exportada (de `claude setup-token`). Corre en una sesión de terminal propia (`setsid`) y la respuesta a un
  NECESITO/CONFIRMAR se lee de `/dev/tty`.
- **Sin la palabra clave** (LISTO, NO PUDE, NECESITO, CONFIRMAR) `ask` no sabe si tiene que preguntar: la pide
  reescrita una vez, y la reconoce aunque venga con Markdown.
- **Las fotos de los pasos esperan a que la página cargue** (con tope): sin eso salían desplegables a medio
  cerrar y videos en negro.
- **Un `look` sin tope en YouTube eran 28 000 caracteres:** muestra primero lo que está en pantalla, agrupa los
  repetidos y corta en 40 (`look --buscar`, `look --todo`).
- **Un estado que dejó otra corrida contamina la prueba** (un login en la sesión en vivo): las evals abren cada
  caso con un perfil temporal (`clean=1`).
