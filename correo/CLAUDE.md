# correo — los correos que importan, con aviso

**Para qué existe:** no estar mirando Gmail mientras corre un trámite por correo (la revisión de la app de Shopify, la
homologación de VTEX). Se le dice qué remitentes seguir y avisa por macOS cuando llega algo nuevo de ellos, aunque
Cockpit esté cerrado. Es la tarea `correo` (#130, nivel miguel).

`make correo` (UI :5224 · API :5225) o la app Correo de Cockpit. A la izquierda los **seguimientos** (un nombre y una
búsqueda de Gmail) y, debajo, los correos del elegido (60 días, los 60 más nuevos) con sus filtros; al centro el
correo abierto tal como llegó, con el enlace al hilo en Gmail; a la derecha **el hilo desglosado en español** (abajo).
`make correo ONCE=1` lee una vez por consola.

## La consola: `bin/correo` (para Miguel y para un agente)

Es lo que se usa para contestar «¿contestó VTEX?» sin abrir nada. Lo que se sigue sale de la API de fondo si está
arriba (lee cada minuto) y si no, de lo guardado; `read` y `search` van directo a Gmail. Todo acepta `--json`.

| comando | contesta |
|---|---|
| `bin/correo watches` | qué se sigue: id, nombre, búsqueda, cuántos sin ver, por responder y de esta semana |
| `bin/correo list [seguimiento] [--unread \| --pending] [--n 10]` | los correos de lo que se sigue, con su estado, id y enlace al hilo en Gmail |
| `bin/correo latest <seguimiento>` | el último de ellos, hace cuánto, y **quién escribió último en el hilo**: si fuiste vos, «se espera a ellos»; si fueron ellos, «te toca contestar» |
| `bin/correo read <id>` | un correo entero |
| `bin/correo digest <id> [--refresh]` | **el hilo desglosado en español**: resumen, en qué está, qué sigue y cada mensaje en puntos (Claude; guardado por hilo) |
| `bin/correo search --q '<búsqueda de Gmail>'` | cualquier búsqueda, se siga o no |
| `bin/correo follow --name … --query …` · `unfollow <seguimiento>` | seguir otro; con el nombre de uno que ya se sigue, le cambia la búsqueda |
| `bin/correo noreply <id> [--undo]` | «no hace falta responder»: un acuse automático deja de figurar como por responder |
| `bin/correo refresh` | que lo de fondo lea ya |

**Los seguimientos de hoy** (2026-11-13): `shopify` (`from:support@shopify.com OR from:paymentspartners@shopify.com`, el
ticket 72090155) y `vtex` (`{from:vtexhelp.zendesk.com from:vtex.com} -from:ct.vtex.com.br`, el ticket #1484435 de la
homologación). ⚠ **El soporte de VTEX escribe desde Zendesk** (`support@vtexhelp.zendesk.com`), no desde `vtex.com`:
con `from:vtex.com` la homologación no salía y la lista quedaba vacía, lo que se lee igual que «no contestaron».

## El desglose del hilo, en español (`server/digest.go`)

Al abrir un correo, el panel derecho muestra su hilo entero digerido: un resumen, **en qué está**, **qué sigue** (qué
te toca o qué se espera de ellos) y cada mensaje (ellos / vos) en puntos cortos, en español aunque venga en inglés.
Abajo, «Qué responderle», un área de texto vacía por ahora: el lugar del borrador de respuesta que venga después.

- **Lo arma Claude con `claude -p`** (Claude Code de consola, la sesión de Miguel; modelo `CORREO_CLAUDE_MODEL`, por
  defecto `sonnet`), desde una carpeta neutra, **sin herramientas ni MCP** (`--tools "" --strict-mcp-config`) y sin las
  variables de una sesión anfitriona (como Jarvis): sólo lee el texto y contesta un JSON. ~20 s por hilo. Fue Gemini
  primero; Miguel pidió Claude el mismo día. ⚠ El texto del hilo sale a Anthropic.
- **Quién escribió y cuándo no los decide el modelo**: salen de Gmail; el modelo sólo resume cada mensaje por índice.
- **Lo citado de cada respuesta se saca** («On … wrote:» y las líneas con «>»): ya está en el mensaje anterior.
  Cada mensaje va hasta 6000 caracteres.
- **Se guarda por hilo** (`correo/.data/digests/<hilo>.json`) y se reusa mientras el hilo tenga los mismos mensajes:
  si llega uno nuevo, se rearma solo al abrirlo. ↻ en el panel lo rearma a mano.
- Por consola: `bin/correo digest <id> [--refresh]` (también para un agente: «¿qué dijo VTEX?»).

## Sólo lee

Usa la sesión de **`bin/pg gmail login`** (`connectors/gmail`, permiso `gmail.readonly`, el mismo cliente OAuth que
Drive): no puede mandar, borrar ni marcar nada en Gmail. «Visto» es de esta herramienta (`correo/.data/state.json`) y
no cambia el leído de Gmail. Para contestar, el enlace ↗ abre el hilo en Gmail.

## Sin ver, por responder, respondido

Cada correo tiene uno de tres estados (`MessageView.Status`, en `server/store.go`):

- **Sin ver**: no se abrió en la herramienta.
- **Por responder**: se vio, y en su hilo no hay nada tuyo después.
- **Respondido**: en el hilo hay un correo tuyo posterior (`RepliedAt`). Cuenta aunque se haya contestado desde Gmail
  sin abrirlo acá.
- **No hace falta responder**: se marcó a mano (botón en el correo abierto, o `bin/correo noreply <id>`). Es para los
  acuses automáticos («Ticket #1484435 received»), que si no quedan para siempre por responder. No se adivina por el
  asunto: lo decide Miguel. Una respuesta tuya posterior gana igual (pasa a respondido).

Para eso, cada lectura pide en Gmail el hilo entero de lo que se muestra (`format=metadata`, `connectors/gmail`
`Thread`) y guarda la última vez que escribiste vos y la última que escribieron ellos (`state.json`, `threads`). Cada
seguimiento cuenta sus sin ver, sus por responder y los de los últimos 7 días; la lista se filtra por estado.

## Cómo decide qué avisar

- **Cada minuto** (`-every`) busca en Gmail cada seguimiento (`<búsqueda> newer_than:60d`) y pide los encabezados sólo
  de los correos que no tenía. El cuerpo se pide al abrir uno.
- **Un aviso por correo, una vez** (`Notified`). Sobrevive a un reinicio.
- **La primera lectura de un seguimiento no avisa** (`Primed`): lo que ya estaba se da por visto. Cambiar la búsqueda de
  un seguimiento lo vuelve a estrenar. Si no, agregar `from:vtex.com` mandaba decenas de avisos viejos.
- El aviso sale por el avisador del chat («Chat del playground»), como el de Sentinel: tocarlo abre Cockpit en
  `#/w/<seguimiento>/<correo>`. Sin él, por osascript. `go run ./correo/server -notify-test` manda uno de prueba.
- El numerito de la barra de Cockpit son los sin ver (`badge`).

## De fondo

`make correo-install` deja la API como **LaunchAgent** (`com.creditop.correo`, binario `correo/bin/correo`, fuera de
git): arranca con la sesión y avisa aunque Cockpit esté cerrado. **Después de cambiar el servidor, `make
correo-install` de nuevo.** `make correo-status` · `make correo-uninstall`. Su salida: `~/Library/Logs/correo.log`.
Como Sentinel, dos APIs no se pisan: la que llega después espera el puerto y toma el relevo, así que no avisan dos.

## Cómo está construido

| pieza | dónde |
|---|---|
| la lectura de Gmail (OAuth, búsqueda, un correo con su texto) | `connectors/gmail/gmail.go` · por consola, `bin/pg gmail me\|search\|read` |
| lo guardado: seguimientos, correos, visto y avisado | `server/store.go` (con test) |
| las lecturas, la API y el LaunchAgent | `server/main.go` |
| el aviso de macOS | `server/notify.go` |
| la consola (`bin/correo`) | `server/cli.go` |
| el desglose en español (`claude -p`, guardado por hilo) | `server/digest.go` |
| la interfaz | `src/App.vue`, con la base de `tools/ui` (`make estilo-sync`) |
