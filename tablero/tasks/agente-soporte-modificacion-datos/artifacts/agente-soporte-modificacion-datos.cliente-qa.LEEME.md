# Probar el canal de soporte por WhatsApp

Es la conversación tal como la va a ver el cliente, pero **cada paso llama la API de verdad**. A la
derecha queda la respuesta de cada llamada: si algo falla, ahí está el motivo con su código de error.

## Abrirlo

⚠ **No sirve abrir el archivo con doble clic.** El navegador bloquea las llamadas a la API cuando la
página se abre como archivo (`file://`). Hay que servirla, y es un comando:

    cd <carpeta donde está este archivo>
    python3 -m http.server 5199

Y abrir **http://localhost:5199/agente-soporte-modificacion-datos.cliente-qa.html**

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

⚠ **Si el chat dice «no encontramos una cuenta con esos datos»**, no es un bug: falta correr
`agente-soporte-modificacion-datos.cliente-qa.casos.sql` contra ese ambiente. Es lo que crea a ANA QA.

## Probar con otro cliente: la columna de la derecha

Arriba están los clientes que **existen**, con lo que cada uno sirve para probar. Un clic y quedan
puestos su celular y su cédula. Cambiar el celular es cambiar de persona: es lo primero que mira el bot.

| Cliente | Para qué sirve |
|---|---|
| **QA** | un crédito gestionable: el camino completo hasta aplicar el cambio |
| **JOSE FERNANDO** | dos créditos en dos comercios: se ve el menú de elegir, y después el rechazo por cuota pendiente |
| **ANA QA** | dos créditos gestionables — **hay que correr `agente-soporte-modificacion-datos.cliente-qa.casos.sql`** para que exista |

⚠ **El celular y la cédula van juntos.** Cambiar sólo uno da «no encontramos una cuenta con esos datos»,
que parece un bug y no lo es. Si tipeás un celular de la lista, su cédula se completa sola.

⚠ Y mirá el aviso de color que aparece ahí:

| Lo que dice | Qué significa |
|---|---|
| verde · *está en la lista de pruebas de QA* | no se manda ningún mensaje y el código son los últimos 4 dígitos del celular |
| ámbar · *no está en la lista* | **a ese número le va a llegar un SMS de verdad.** Usá sólo números propios |

Cuando el número no está en la lista, el código **no** viene pre-escrito: llega por mensaje y hay que
escribir el que llegó.

## Para volver a probar: corré el script

Un crédito al que se le cambió algo **no admite otro cambio por 6 meses** — es la regla del negocio, no
un error. Para volver al estado inicial:

    mysql -h <host> -u <usuario> -p <base> < agente-soporte-modificacion-datos.cliente-qa.casos.sql

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
