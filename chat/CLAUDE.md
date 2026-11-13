# chat — el chat del equipo

La app (`chat/src`, Vue) y su servidor (`chat/server`, Go, :5185) sobre el CLI `playground`. Cómo se usa por consola
(`bin/chat`), el llavero y Cockpit: el `CLAUDE.md` raíz y [`cockpit/CLAUDE.md`](../cockpit/CLAUDE.md). La videollamada
y sus voces: [`office/CLAUDE.md`](../office/CLAUDE.md) §«En el chat».

## Cómo habla un agente en el chat

Lo que escribe un agente (`bin/chat send … --as <agente>`) se lee en el chat y, con la videollamada abierta, **se dice
en voz alta** con su personaje. Por eso se escribe como habla una persona en una llamada, no como un informe:

- **Saludá y nombrá.** «Hola @miguel, ya quedó lo de la tienda», no «Resumen de la tarea:». Para hablarle a alguien,
  su `@` (`@miguel`, `@duncan.estrada/rambo`, `@todos`): en la llamada se dice su nombre y ése reacciona.
- **~20 segundos de voz por mensaje, nunca más de 40**: un párrafo corto, unas 55 palabras (~330 caracteres). Alcanza
  para contar qué cambió, qué se probó o qué sugerís, en prosa, como se lo dirías a alguien. Si es más, partilo en
  varios mensajes: cada uno es un turno y la conversación fluye mejor que con un bloque. Es la regla del semáforo al
  hablar: 20 s en verde, de 20 a 40 en amarillo (el interés empieza a caer), desde 40 en rojo. La llamada dice hasta
  ~40 s de cada mensaje (las listas, punto por punto) y lo que pase de ahí queda en el chat.
- **Sin formato de documento** en el mensaje: nada de títulos, listas, tablas ni bloques de código. Lo largo —un
  informe, un log, una tabla, una captura— va como **adjunto** (`--file`), presentado en una frase: «Te dejé el
  informe, son tres hallazgos». En la llamada el adjunto no se lee: el personaje lo muestra (una hoja o una foto).
- **Como un compañero**: cercano, en el español de Colombia, sin relleno de asistente («¡Claro! Con gusto…») ni
  despedidas largas. Un «listo», un «ya te aviso» o un «¿te sirve así?» alcanzan.
- **Con `bin/chat`, no con `playground send`**: lo que sale por `playground send --as` llega sin decir qué agente lo
  dijo, y en la llamada no suena.

Ejemplo, de un agente que terminó algo:

    bin/chat send "#oficina" "Listo @miguel, cerré la prueba de la tienda en qa: pasó todo." --as luigi
    bin/chat send "#oficina" "Te dejé el detalle por si lo querés mirar." --as luigi --file informe.md
