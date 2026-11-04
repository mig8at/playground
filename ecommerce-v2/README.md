# ecommerce-v2 · probar una compra de tienda en qa de punta a punta

Una compra de prueba en Shopify o VTEX contra qa, mirada y cerrada desde `ecommerce`: qué comercio, qué mandó la tienda,
a qué usuario quedó pegada, sus tablas, y pasarla a aprobada, negada o cancelada como si la entidad hubiera
contestado. Todo contra la base compartida de dev, qa y staging: **hace falta la VPN de dev**.

## 1 · Levantar ecommerce

Es un proyecto suelto: no necesita ningún otro repo para mirar y cerrar solicitudes. Pide Go (1.25+), Node (20+), la
VPN de dev y el archivo `.env` de la raíz, que trae las claves de cada ambiente (ver los comentarios del archivo).

```bash
npm install
npm run dev
```

Abre http://localhost:5186 (la API queda en :5187). Abajo a la izquierda, `Base: qa`, `local` o `prod`.

`prod` **sólo lee**, por Redash: busca la solicitud y sus tablas, pero el servidor rechaza borrar, dar de baja, pasar de
estado y dictar las centrales, y la interfaz no los ofrece. Es lento (cada consulta pasa por Redash: una búsqueda
tarda ~20 s y las tablas un poco más). Pide `PROD_REDASH_URL` y `PROD_REDASH_TOKEN` en el `.env`, con tu propio token.

En la cuenta VTEX `creditop` hay dos ambientes: `develop` (la app con «Pruebas (develop)», contra qa; ahí también se
linkea al desarrollar) y `master` (producción). Las pruebas van siempre por la tienda de `develop`: `master` no se toca.

## 2 · Antes de comprar: dictarle tu persona a las centrales

El mock de centrales de qa contesta una persona por defecto (JUAN CARLOS PEREZ GOMEZ) para la cédula que no conoce.
En el panel derecho de `ecommerce` («Centrales de prueba», sin tabla abierta): cédula, nombres y apellidos tal como los
vas a escribir en el wizard → **Cargar en las centrales de qa**. Cargalo justo antes de comprar.

⚠ **Cada cédula guarda datos personales 4 veces por hora**, como mucho. La quinta cae en la pantalla «Límite de
intentos alcanzado» (`/rate-limit-exceeded`). El contador vive en el Redis del backend, no en la base: borrar
solicitudes o usuarios no lo reinicia, y desde acá no hay acceso para borrarlo. Cada intento que pasa vuelve a
contar la hora. Salida: esperar, o usar otra cédula (y cargarla en el paso 2).

## 3 · Comprar en VTEX

Tienda https://creditop.myvtex.com, la de la cuenta de pruebas `creditop`. No hace falta consola ni sesión: se elige
Creditop como medio de pago y el checkout lleva al wizard de qa. Que vaya a qa lo decide la condición de pago activa,
«Creditop qa», cuya afiliación usa el conector v5 del workspace `develop` (la afiliación decide qué conector atiende,
no la tienda).

No uses `develop--creditop.myvtex.com` para comprar: es un workspace de desarrollo y su carrito da «Sorry, an error
occurred while processing your request» (ya pasaba el 2026-10-29; el de master da 200).

Datos de la persona: un celular y un correo de prueba tuyos. El correo no puede ser el de una cuenta de administrador en
qa (el registro dice «correo ya registrado»): usá uno aparte, como `tu-nombre-test@creditop.com`. El código OTP llega a
Slack, canal `#qa-messages`.

Para ver el pedido y su estado del lado de la tienda: el admin de VTEX (enlaces del sidebar), con un usuario en la cuenta
`creditop`. Si al pagar no aparece Creditop, o el wizard no es el de qa, alguien cambió la condición de pago: avisale a Miguel.

Shopify todavía no tiene una tienda que pague con la app desplegada. Mientras tanto, la **Shopify demo**.

## 3b · Comprar en la Shopify demo

En el sidebar, bloque **Shopify → Store demo** (o http://localhost:5186/#/shopify-demo): una tienda Shopify de mentira que
paga con la app de Creditop de verdad (el host de temp-shopify), que corre en la máquina de quien la está cambiando. No
hace falta tener ese repo: el host se usa por la dirección de su canal del playground.

- **El editor es la tienda**: productos en tarjetas, el carrito, los datos del comprador y «Pagar con Creditop». La
  pestaña **Pedidos** los muestra como los vería el comercio en Shopify, con lo que pasó en cada uno y los botones para
  avisar el resultado.
- **La consola de abajo, pestaña Conexiones**: si se llega a todo (playground, host de la app y este Shopify falso),
  con el botón para volver a comprobar. Se elige sola al abrir la Store demo.
- **El panel derecho es lo que pasa por debajo**: cada petición a la API y cada
  webhook, en orden —la sesión de pago a la app, el aviso de Creditop y el `paymentSessionResolve` que la app le manda al
  Shopify falso—, con su cuerpo al tocarla. La lupa deja sólo las del pedido elegido.

El comprador vuelve de Creditop a `#/shopify-demo?order=<id>`, que abre la demo en ese pedido.

```text
la demo ──sesión de pago──► canal del host ──► el host (en la máquina de su dueño) ──► Creditop ──► el wizard
«Avisar como Creditop» ──► canal del host ──► el host ──paymentSessionResolve──► canal de la demo ──► ESTE Shopify falso
```

**Una sola vez** (las direcciones tienen nombre y no cambian):

1. Mirá los servicios que publicó el dueño del host y copiá la dirección del suyo:
   ```bash
   playground services @miguel
   playground url shopify.ecommerce.miguel.com
   ```
2. Publicá tu Shopify falso con nombre, en `~/playground/team/services.json`:
   ```json
   [{ "alias": "shopify-falso.ecommerce", "to": "http://127.0.0.1:5187", "description": "Shopify falso de la Store demo" }]
   ```
   y servilo desde esta máquina, en una terminal que quede abierta: `playground serve`. Queda como
   `shopify-falso.ecommerce.<tu usuario>.com`. Pasale ese nombre al dueño del host: su dirección va en su
   `SHOPIFY_PAYMENTS_API_URL`, para que el host le avise a tu Shopify falso.
3. En el `.env` de acá, las direcciones completas (el nombre solo es para el CLI y nunca se resuelve):
   ```text
   SHOPIFY_DEMO_PLAYGROUND=https://playground.creditop.com
   SHOPIFY_DEMO_HOST_URL=https://playground.creditop.com/s/shopify.ecommerce.miguel.com
   SHOPIFY_DEMO_CHANNEL_URL=https://playground.creditop.com/s/shopify-falso.ecommerce.<tu usuario>.com
   SHOPIFY_DEMO_SHOP=creditop-demo.myshopify.com      # la tienda que el host tiene configurada
   SHOPIFY_DEMO_TARGET=qa                             # dónde busca «Avisar como Creditop» el aviso firmado
   ```
   y `npm run dev` de nuevo (el `.env` se lee al arrancar).

Cada día sólo hace falta que tu `playground serve` esté corriendo (y el del dueño del host).

**Probarlo solo, con las dos puntas en tu máquina:** un único `services.json` con el host y el Shopify falso, y un solo
`playground serve`:

```json
[
  { "alias": "shopify.app", "to": "http://localhost:8121", "description": "host de la app de pagos (temp-shopify)" },
  { "alias": "shopify", "to": "http://127.0.0.1:5187", "description": "Shopify falso (Store demo)" }
]
```

`SHOPIFY_DEMO_HOST_URL` va a `…/s/shopify.app.<vos>.com`, `SHOPIFY_DEMO_CHANNEL_URL` a `…/s/shopify.<vos>.com`, y el
`SHOPIFY_PAYMENTS_API_URL` del host también a `…/s/shopify.<vos>.com`. Cuando lo pruebe otra persona, sólo cambia ese
último: a `…/s/shopify.<esa persona>.com`. El host le avisa a un solo Shopify falso a la vez.

Las tres conexiones de la pestaña Conexiones tienen que estar en verde antes de comprar: **playground** (contesta su `/health`),
**host de la app** (su nombre contesta; 503 = su dueño no está corriendo `playground serve`) y **este Shopify falso** (el playground
llega a este servidor por tu nombre: se comprueba con un ping que sólo este proceso sabe contestar).

**«Pagar con Creditop»** le manda al host la sesión de pago con la forma de Shopify y abre la URL que devuelve: el wizard.
**«Avisar como Creditop»** le manda al host el aviso de fin de solicitud (aprobada, negada, cancelada o pendiente) al
`webhook_url` firmado que Creditop guardó del pedido. El host se lo dice al Shopify falso, y el pedido pasa a **Pagado**,
**Pago fallido** o **Pago pendiente**. Cuando el host tenga un dominio que el backend alcance, ese aviso llega solo al
aprobar la solicitud de verdad. Los pedidos de la demo quedan en `.data/shopify-demo.json` (fuera de git).

`SHOPIFY_DEMO_HOST_ANNOUNCED_URL` sólo hace falta con un playground local en `http`: payment-link exige `https`, así que
el host se anuncia con `https://localhost:…` y la demo traduce sus enlaces a la dirección `http` por la que se le llega.

## 4 · Mirar y cerrar la compra en ecommerce

Escribí el celular (`3016992677`) o pegá la URL del wizard. Se ven las solicitudes del celular, y de la abierta sus
tablas; tocar el título de una tabla muestra abajo qué es en palabras de negocio, y a la derecha su consulta.

En la barra del editor, si la solicitud vino de una tienda:

| botón | estado | la tienda recibe |
|---|---|---|
| Aprobar | 11 · Autorizada | `completed` (Shopify: pagado · VTEX: `approved`) |
| Negar | 6 · Negada | `failed` (VTEX: `denied`) |
| Cancelar | 8 · Cancelado | `cancelled` |

Va por el simulador del backend de qa, que le avisa a la tienda (un `UPDATE` a mano no le avisa). **Una sola vez por
solicitud**: la tienda no acepta un segundo resultado, así que después queda sólo **Volver a la tienda ↗**, que lleva
a donde vuelve el comprador y ahí se ve en qué quedó la compra. El bloqueo se recuerda en el navegador.

- VTEX: aprobada, el pedido queda 30 minutos en `window-to-cancel` y no cobra hasta facturarlo (`start-handling` +
  `invoice`; pedile el comando a Miguel).

## 5 · Repetir de cero

- La **basura** de una solicitud la borra con lo que cuelga de ella (con copia en `.backups/`). Si es la última
  del usuario, pregunta si darlo de baja: así su celular, correo y cédula quedan libres para registrarse de nuevo.
- La basura al lado de una **persona** (buscando por celular, correo o cédula) da de baja a un cliente sin
  solicitudes, o lo borra del todo si ya estaba dado de baja. Las cuentas del equipo no se tocan.
- No reinicia el límite de 4 intentos por hora del paso 2.

## Productos de prueba

Las 6 bicicletas ya están en las dos tiendas, con el mismo nombre y SKU (el catálogo de VTEX es de toda la cuenta,
también `master`). Un producto nuevo de VTEX tarda en aparecer en la tienda hasta que VTEX lo indexa.

## Por consola

```bash
go run ./server -target qa -q 504073
```

Más: `go run ./server -h` (borrar con plan y `-rollback`, dar de baja, cargar el perfil de
`.profile.json`).

## Lo que ya confundió

- **La identidad puede pasar con otra persona.** Si Ágil Data devuelve otro nombre, la cadena pregunta a TusDatos, y
  el mock de TusDatos de qa contesta `match` sin nombre (solicitud 504073). Para una prueba limpia, el paso 2 siempre.
- **El monto de VTEX trae centavos** (504073: 242.259,56) y pasa así a la solicitud.
- El simulador no deja fila en el historial de estados: la línea de estados termina en 9 aunque la solicitud esté en 11.
