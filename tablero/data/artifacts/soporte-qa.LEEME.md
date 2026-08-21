# Probar el canal de soporte por WhatsApp

Es la conversación tal como la va a ver el cliente, pero **cada paso llama la API de verdad**. A la
derecha queda la respuesta de cada llamada: si algo falla, ahí está el motivo con su código de error.

## Abrirlo

⚠ **No sirve abrir el archivo con doble clic.** El navegador bloquea las llamadas a la API cuando la
página se abre como archivo (`file://`). Hay que servirla, y es un comando:

    cd <carpeta donde está este archivo>
    python3 -m http.server 5199

Y abrir **http://localhost:5199/soporte-qa.html**

## No hay nada que configurar

Elegí uno de los tres casos de arriba y dale **Empezar**. El token ya viene puesto en el archivo y
siempre corre contra **develop**.

| El caso | Qué muestra |
|---|---|
| **Cambio completo** | un cliente con un crédito y sin cuota pendiente: llega hasta aplicar el cambio |
| **Dos comercios** | el cliente elige entre dos créditos, y después el rechazo por cuota pendiente |
| **Número sin cuenta** | cómo se ve cuando el celular no está registrado |

Los tres son clientes de prueba de develop **cuyo celular está en la lista de QA**, así que no se
manda ningún mensaje. Para probar con otro cliente, abrí **«otro cliente»** a la derecha.

⚠ develop es **compartido con el equipo**: los cambios que apliques quedan escritos ahí. Y ojo con
«Cambio completo»: si lo aplicás, **ese mismo crédito no admite otro cambio por 6 meses** — es la regla
del negocio, no un error. Para volver a probarlo hay que usar otro crédito.

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
