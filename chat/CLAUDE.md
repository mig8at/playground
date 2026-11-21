# chat — el chat del equipo

La app (`chat/src`, Vue) y su servidor (`chat/server`, Go, :5185) sobre el CLI `playground`. Cockpit:
[`cockpit/CLAUDE.md`](../cockpit/CLAUDE.md). La videollamada y sus voces: [`office/CLAUDE.md`](../office/CLAUDE.md)
§«En el chat».

## Por consola (vivía en el `CLAUDE.md` raíz hasta el 2026-11-18)

| para… | comando |
|---|---|
| ver quién está conectado · mandar un mensaje suelto | `playground online` · `playground send @jose.guzman "…"` (el CLI del playground compartido, con tu sesión; sin guardar nada) |
| verlo | `make chat` (conversaciones y contestar, sobre el mismo CLI; su servidor guarda el historial y las imágenes en disco) |
| el contexto de una conversación | `bin/chat history <who>` (con las imágenes ya bajadas: no uses `playground get`, que le quita el adjunto al chat) |
| seguir las respuestas | un Monitor sobre `bin/chat follow <who> --theirs` (con `--json`, un mensaje por línea) |
| contestar o mandar | `bin/chat reply` / `bin/chat send`, con el texto confirmado |
| un adjunto | `bin/chat send <who> <texto> --file <ruta>`, no `playground send --file`: así el chat guarda una copia y lo muestra |
| qué falta leer · qué te nombra · a quién mencionar | `bin/chat inbox --unread` · `bin/chat mentions` · `bin/chat who #grupo` (los `@usuario`) |
| esperar la respuesta en una sola llamada | `bin/chat send … --wait 5m`, sin Monitor (sale 3 si nadie contesta) |

- **Mandar un mensaje sale a nombre de Miguel: se confirma el texto antes.**
- **La conversación en vivo es sólo si Miguel la pide** (no en toda sesión), con `bin/chat` sobre el servidor del chat
  (corre de fondo; lo trae también Cockpit). Si :5185 no contesta, abrí Cockpit.
- **Un agente habla como agente** con `--as <agente>` (o `CHAT_AS`), no a nombre de Miguel, y como en una llamada
  (abajo). Es una identidad de Miguel que nace la primera vez que habla y queda guardada (`playground agents` lista los
  de todos); en un grupo tiene que ser miembro (`playground groups add #g @miguel/<agente>`).
- Contestar marca leído; lo leído lo comparten la app y `bin/chat`.

### El llavero: claves para el equipo

La consola de una conversación en `make chat`: nombre y valor; «Encriptar» da el encriptado para pegarlo en el mensaje y
«Desencriptar» abre uno recibido. Lo encriptado con nombre queda en la tabla «Guardadas» (sólo encriptado, nunca el
valor). **Lo privado no va al llavero**: va al llavero personal de Cockpit (engranaje → Llavero, `bin/pg vault`), cifrado con una
llave que no tiene el equipo.

- En una conversación directa, escribir `🔑 Pido tu llavero` pide **su llavero**: el servidor del chat del otro contesta
  SOLO con los nombres (`🔑 Mi llavero (n)` y viñetas); elegís cuáles y «Pedir» manda `🔑 Pido estas claves`, que también
  se contesta solo con UN bloque `.env` de valores encriptados (`🔒 Llavero · n claves …` y debajo
  `NOMBRE=U2FsdGVkX1…`). Su tarjeta trae «Guardar en mi llavero» y «Descargar .env» (desencriptado).
- Contesta sólo mensajes directos y recientes, y si «Compartir mi llavero solo» está prendido en la consola
  (`chat/server/keyring_auto.go`).
- **Sin el chat**, el bloque guardado en `bloque.txt` se vuelve `.env` así (no se pega la clave en claro en el chat):

      grep '=U2FsdGVkX1' bloque.txt | while read -r l; do printf '%s=%s\n' "${l%%=*}" "$(printf '%s' "${l#*=}" | openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -a -A -pass file:$HOME/.config/creditop/team-key)"; done > .env

⚠ **Dos dueños, dos nombres.** El chat es una herramienta de **my-tools**: sus nombres propios dicen my-tools (el
LaunchAgent `com.creditop.my-tools.chat`, el registro `creditop-my-tools-chat.log`, los datos en
`~/Library/Application Support/creditop-my-tools-chat/`; el avisador «Chat de my-tools.app» quedó sólo de respaldo:
desde el 2026-11-21 los avisos pasan por `lib/notice` y salen por el de Cockpit, y el no molestar es de Cockpit). Pero **habla por el CLI
del playground COMPARTIDO** (`Creditop-SAS/playground`): `playground listen|send|curl|cuadrilla|subscribe`, «tu sesión del
playground», los servicios del equipo (`playground serve`, `~/playground/team`) y la red del playground son de allá y
conservan su nombre.

## Cómo habla un agente en el chat

Lo que escribe un agente (`bin/chat send … --as <agente>`) se lee en el chat y, con la videollamada abierta, **se dice
en voz alta** con su personaje. Por eso se escribe como habla una persona en una llamada, no como un informe:

- **Saludá y nombrá.** «Hola @miguel, ya quedó lo de la tienda», no «Resumen de la tarea:». Para hablarle a alguien,
  su `@` (`@miguel`, `@duncan.estrada/rambo`, `@todos`): en la llamada se dice su nombre y ése reacciona.
- **Un mensaje dirigido es para ése.** En un grupo, si va para una persona o un agente, nombralo al empezar
  («@miguel/luigi, te paso lo de la tienda»). Y al revés: si un mensaje del grupo nombra a otro, **no es para vos**: no
  lo contestes ni actúes sobre él, te sirve de contexto y nada más. Sin nombrar a nadie, o con `@todos`, es para todos.
  En la llamada se ve: el nombrado levanta la mirada y los demás siguen en lo suyo.
- **~55 palabras por mensaje (unos 20 segundos en voz alta); si de verdad hace falta, hasta ~110 (40 s), nunca más.**
  Alcanza para contar qué cambió, qué se probó o qué sugerís, en prosa, como se lo dirías a alguien. Si es más,
  partilo en varios mensajes: cada uno es un turno y la conversación fluye mejor que con un bloque. Es la regla del
  semáforo al hablar: 20 s en verde, de 20 a 40 en amarillo (el interés empieza a caer), desde 40 en rojo. (La voz
  dice ~2,8 palabras por segundo, medido.) La llamada dice hasta ~40 s de cada mensaje y lo que pase de ahí queda en
  el chat.
- **Sin formato de documento** en el mensaje: nada de títulos, tablas ni bloques de código (una lista corta, de dos o
  tres puntos, se dice bien; un informe con secciones, no).
- **Los adjuntos son opcionales.** La mayoría de los mensajes son sólo conversación. Mandá un archivo (`--file`)
  cuando hay algo que no se dice bien hablando: un informe, un log, una tabla, una captura, un PDF. Y **decí en el
  mensaje qué trae**, para que se entienda sin abrirlo: «Te dejé el informe: son los tres hallazgos de qa y cómo
  reproducir el segundo». En la llamada el adjunto no se lee: el personaje lo muestra (una hoja o una foto) mientras
  dice tu frase.
- **Lo del llavero no se toca**: los mensajes con claves (`🔑 …`, `🔒 Llavero …`) los arma el chat y la llamada no los
  lee en voz alta, sólo anuncia que llegaron claves.
- **Como un compañero**: cercano, en el español de Colombia, sin relleno de asistente («¡Claro! Con gusto…») ni
  despedidas largas. Un «listo», un «ya te aviso» o un «¿te sirve así?» alcanzan.
- **Con `bin/chat`, no con `playground send`**: lo que sale por `playground send --as` llega sin decir qué agente lo
  dijo, y en la llamada no suena.

Ejemplo, de un agente que terminó algo:

    bin/chat send "#oficina" "Listo @miguel, cerré la prueba de la tienda en qa: pasó todo." --as luigi
    bin/chat send "#oficina" "Te dejé el detalle por si lo querés mirar." --as luigi --file informe.md
