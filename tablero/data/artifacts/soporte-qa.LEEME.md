# Probar el canal de soporte por WhatsApp

Es la conversación tal como la va a ver el cliente, pero **cada paso llama la API de verdad**. A la
derecha queda la respuesta de cada llamada: si algo falla, ahí está el motivo con su código de error.

## Abrirlo

⚠ **No sirve abrir el archivo con doble clic.** El navegador bloquea las llamadas a la API cuando la
página se abre como archivo (`file://`). Hay que servirla, y es un comando:

    cd <carpeta donde está este archivo>
    python3 -m http.server 5199

Y abrir **http://localhost:5199/soporte-qa.html**

## Antes de empezar

1. **Token del canal** — pedilo al equipo. Queda guardado en tu navegador, no en el archivo.
2. **Ambiente** — `dev` para probar de verdad. ⚠ dev es **compartido**: los cambios que apliques
   quedan escritos ahí.
3. **Celular y cédula** — tienen que ser de un cliente que exista en ese ambiente. El botón trae uno
   de prueba ya cargado.

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
| ⚠ «problema técnico del canal» | **eso sí es un bug.** Reportalo |

## Para reportar

El botón **copiar reporte** copia todas las llamadas con su respuesta, listo para pegar en el ticket.
El token va tapado.
