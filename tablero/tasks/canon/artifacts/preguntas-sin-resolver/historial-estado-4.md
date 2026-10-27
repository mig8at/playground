**`creditop_x_requests_history` lleva dos estados distintos.** `creditop_x_requests_status_id` es el del crédito y sale del catálogo `creditop_x_user_request_statuses`:

| valor | estado |
|---|---|
| 1 | al día |
| 2 | en mora |
| 3 | paz y salvo |
| 4 | cancelado |
| 6 | producto recuperado |
| 7 | recuperado por fondo de garantías |
| 8 | administrado externamente |
| 9 | fallecido |

`status` es el de la fila: 1 es la fila vigente del crédito, 0 una fila reemplazada por otra más nueva o desactivada, y 5 una fila reversada por un pago revertido, que las lecturas descartan.

**Estado 4 con `status` 2 es un crédito anulado desde el administrador del sistema viejo.** La anulación hace todo en una sola transacción:
- pasa la solicitud al estado 8;
- deja la fila vigente en `status` 2 y estado 4;
- pone en cero los días de mora;
- registra un `ANNULMENT` en `creditop_x_log`.

Esa combinación es la que el disparador de la base informa como anulación al servicio de beneficios ([[creditopx/context#cada-compra-autorizada-cancelada-o-anulada-deja-un-aviso-para-el-servicio-de-beneficios]]).

**El sistema nuevo cancela distinto.** Su acción de cancelar sólo pone la fila en `status` 0 y registra un `CANCELLATION` con el motivo. No toca la solicitud ni el estado del crédito, así que la fila conserva el estado que tenía, por ejemplo en mora, y el crédito queda sin fila vigente. Por eso un crédito cancelado no siempre se reconoce por el estado 4: hay que mirar también `creditop_x_log`.

En las recuperaciones (estados 6 y 7), el sistema viejo agrega una fila nueva con el mismo número en `status` y en el estado, y deja la anterior en 0.
