# chat — el chat del equipo

La app (`chat/src`, Vue) y su servidor (`chat/server`, Go, :5185) sobre el CLI `playground`. Cómo se usa por consola
(`bin/chat`), el llavero y Cockpit: el `CLAUDE.md` raíz y [`cockpit/CLAUDE.md`](../cockpit/CLAUDE.md). La videollamada
y sus voces: [`office/CLAUDE.md`](../office/CLAUDE.md) §«En el chat».

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
