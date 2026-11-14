El asistente de solicitud inicializa PostHog del lado del servidor con `VITE_PUBLIC_POSTHOG_KEY` y `VITE_PUBLIC_POSTHOG_HOST`, y **no lo inicializa cuando `APP_ENV=local`**: en una máquina propia no hay eventos, y eso no es una falla. Para un caso puntual es la única fuente que dice qué pantalla vio el cliente y en cuál se quedó.

Lo **constante** en cada evento es el nombre de la app —`loan-request-wizard`, que va en las propiedades base—, y **eso** es lo que sirve para acotar a la app. ⚠ El nombre del flujo **lo pone cada ruta**: en la misma app conviven `loan_request_wizard`, `bancolombia`, `abaco` y `consumer_hub`, así que **filtrar por el flujo del asistente pierde enteros los recorridos de Bancolombia, del proveedor de ingresos informales y del portal del cliente**.

**La persona de PostHog es el cliente, no la solicitud ni el teléfono.** El identificador es `customer_<id del usuario>`, y se resuelve a partir de la solicitud: el servidor busca al dueño de la solicitud y manda a esa persona **todo evento que lleve el número de solicitud**, aunque quien lo emite pase `loan_request_<id>` como identidad. El navegador hace lo mismo: cuando la ruta trae el número de solicitud, pide el identificador del cliente y se identifica con él; si la tableta seguía identificada con otro cliente, primero reinicia la identidad para no sumarle eventos ajenos.

⚠ **Antes de que exista una solicitud el navegador es anónimo.** Las pantallas de teléfono y código de un solo uso ya no identifican a nadie por el celular: sus eventos quedan con el identificador anónimo del navegador, y PostHog se los suma al cliente recién cuando éste se identifica con su solicitud. Si el cliente abandona antes de tener solicitud, sus eventos quedan sólo como anónimos y **no se encuentran buscando por teléfono**.

Las demás identidades:

- en el **portal del cliente**, `consumer_<id>`, que es otra persona de PostHog distinta de la del asistente;
- en el **canal asistido**, el servidor identifica la sesión con el **asesor** mientras no haya solicitud; los eventos que llevan número de solicitud igual van al cliente.

Para el caso puntual se busca por la propiedad del número de solicitud de los eventos, que sigue viajando en cada evento ligado a una solicitud. **Un embudo por persona es por cliente**: un cliente con dos solicitudes es una sola persona, y el comercio de la primera y de la última compra quedan como propiedades de esa persona.
