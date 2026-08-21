# Probar el canal de soporte por WhatsApp

Es la conversación tal como la va a ver el cliente, pero **cada paso llama la API de verdad**. A la
derecha queda la respuesta de cada llamada: si algo falla, ahí está el motivo con su código de error.

## Abrirlo

⚠ **No sirve abrir el archivo con doble clic.** El navegador bloquea las llamadas a la API cuando la
página se abre como archivo (`file://`). Hay que servirla, y es un comando:

    cd <carpeta donde está este archivo>
    python3 -m http.server 5199

Y abrir **http://localhost:5199/soporte-qa.html**

## Se usa como un WhatsApp: sólo hay que dar clic en ➤

No hay nada que configurar. El campo del mensaje viene **pre-escrito** en cada paso —el saludo, la
cédula, el código— así que probar es clic, clic, clic sin tipear nada. Pero **sigue siendo un campo**: si
borrás la cédula y escribís otra, el canal se comporta como con cualquier persona real (te va a decir que
no encontró la cuenta).

Lo que **nunca** viene pre-elegido son las decisiones —qué crédito, qué cambio, confirmar—: eso es
justamente lo que se está probando.

El cliente de prueba es **ANA QA**, con **dos créditos en dos comercios distintos**: así se ve el menú de
elegir crédito, y quedan dos créditos para probar el cambio de fecha en uno y el de plazo en el otro. El
↺ del cabezal del chat empieza de nuevo.

## Para volver a probar: corré el script

Un crédito al que se le cambió algo **no admite otro cambio por 6 meses** — es la regla del negocio, no
un error. Para volver al estado inicial:

    mysql -h <host> -u <usuario> -p <base> < soporte-qa.casos.sql

Eso borra los cambios de ANA QA y deja sus dos créditos como al principio. Correrlo las veces que
quieras. **Es también lo que la crea la primera vez**: si el chat dice que el número no está registrado,
es que falta correrlo en ese ambiente.

## El código que llega por mensaje

Si el celular está en la **lista de pruebas de QA**, no se manda ningún mensaje y el código es los
**últimos 4 dígitos** del número. Con un celular que no esté en la lista, **el mensaje se manda de
verdad** — usá sólo números propios.

## Qué esperar en cada rama

| lo que ves | qué significa |
|---|---|
| «no admite cambios: tienes una deuda pendiente» | el crédito tiene una cuota por pagar. Correcto, no es un bug |
| «ya hiciste un cambio recientemente» | sólo se permite un cambio cada 6 meses. Correcto |
| «este crédito lo administra la entidad que lo otorgó» | ese crédito no lo gestiona CreditOp. Correcto |
| «no hay plazos alternativos» | puede pasar con la fecha sí disponible: son dos cosas distintas |
| «el token del canal no sirve» | el token está mal pegado o venció. Pedí uno nuevo — no es un bug |
| ⚠ «problema técnico del canal» | **eso sí es un bug.** Reportalo con «copiar reporte» |

## Para reportar

El botón **copiar reporte** copia todas las llamadas con su respuesta, listo para pegar en el ticket.
El token va tapado.
