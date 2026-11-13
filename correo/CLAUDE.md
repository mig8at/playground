# correo — los correos que importan, con aviso

**Para qué existe:** no estar mirando Gmail mientras corre un trámite por correo (la revisión de la app de Shopify, la
homologación de VTEX). Se le dice qué remitentes seguir y avisa por macOS cuando llega algo nuevo de ellos, aunque
Cockpit esté cerrado. Es la tarea `correo` (#130, nivel miguel).

`make correo` (UI :5224 · API :5225) o la app Correo de Cockpit. A la izquierda los **seguimientos** (un nombre y una
búsqueda de Gmail: `from:shopify.com`), con sus sin ver; al centro los correos del elegido (60 días, los 60 más
nuevos); a la derecha el correo abierto, con el enlace al hilo en Gmail. `make correo ONCE=1` lee una vez por consola.

## Sólo lee

Usa la sesión de **`bin/pg gmail login`** (`connectors/gmail`, permiso `gmail.readonly`, el mismo cliente OAuth que
Drive): no puede mandar, borrar ni marcar nada en Gmail. «Visto» es de esta herramienta (`correo/.data/state.json`) y
no cambia el leído de Gmail. Para contestar, el enlace ↗ abre el hilo en Gmail.

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
| la interfaz | `src/App.vue`, con la base de `tools/ui` (`make estilo-sync`) |
