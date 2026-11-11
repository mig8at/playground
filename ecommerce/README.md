# ecommerce · probar una compra de tienda en qa de punta a punta

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

Abre http://localhost:5178 (la API queda en :5179). Dentro del playground es `make ecommerce`, y la app
Ecommerce de Cockpit lo levanta sola. Abajo a la izquierda, `Base: qa`, `local` o `prod`.

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

## 3b · Comprar en la tienda de Shopify

La tienda de desarrollo, **creditop-dev-store** (enlaces en el bloque **Shopify** del sidebar: la tienda, sus pedidos y
la pantalla de la app). Paga con la app de Creditop del repo `shopify`, **desplegada en dev**
(`https://shopify-app.dev.creditop.com`, contra qa): la despliega la CI al mergear a `develop` y la versión publicada de
la app apunta ahí. No hay nada que levantar en ninguna máquina.

**Para comprar** sólo hace falta la contraseña de la tienda (te la da Miguel). Se elige «Creditop» en el checkout, se
hace la solicitud en el wizard de qa y, al aprobarse, el pedido queda pagado solo: el aviso de qa llega a la app, y si
no llegara, la app lo concilia en unos minutos. Con la solicitud negada o cancelada, Shopify no crea el pedido. Con
«Volver a la tienda» a mitad del wizard, el comprador ve la confirmación de Shopify y el pedido queda **pendiente** de
pago.

En la consola de abajo, pestaña **Conexiones**, se ve si la **Tienda** y la **App de pagos (dev)** contestan (el punto
de la pestaña lo resume; el botón lo vuelve a mirar). Si al pagar la tienda manda a un `trycloudflare.com`, quedó una
vista previa de `shopify app dev` en la tienda: avisale a Miguel.

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

## 4b · El lado de VTEX: qué pasó en la tienda y qué no cuadra

Una solicitud que vino de VTEX muestra arriba la sección **VTEX**: el pedido y la transacción en la cuenta `creditop`,
cuánto tardó el conector en contestar el authorize del checkout, el historial de la transacción (hora UTC) y las
**incidencias**, dichas en palabras de negocio. En el bloque **VTEX** del sidebar, **Pedidos con incidencias** lista los
pedidos VTEX de los últimos 7 días que tienen alguna, también los que no tienen solicitud (que no se pueden buscar por
celular); cada fila se despliega con su detalle.

El mismo bloque dice **qué versión del conector** corre en cada workspace: `master` (la publicada e instalada) y
`develop`, que es el que atiende las compras contra qa. Si `develop` dice **linkeada**, alguien la subió desde su
máquina con `vtex link` para probar una versión sin publicar; sigue así hasta que se deslinkee. La lista de versiones
publicadas del registro no se puede ver: VTEX la niega a la llave y a los usuarios de la cuenta. **Admin · apps
instaladas** abre lo mismo en el admin.

| incidencia | qué quiere decir |
|---|---|
| el conector no contestó a tiempo | el authorize del checkout cortó (`ProxyTimeout`): VTEX negó el pago y el comprador volvió al checkout sin aviso |
| tardó N s en contestar | el authorize del checkout pasó de 1,5 s: el comprador esperó, y VTEX a veces corta a los ~2 s |
| reintento sin contestar a tiempo | un authorize posterior (tras el aviso de Creditop, o el de cada hora) cortó: el resultado llegó tarde a la tienda |
| cancelación trabada | VTEX pidió cancelar, el conector contestó `cancellation-not-supported` y la transacción quedó en `Cancelling` |
| estados distintos | Creditop en 11 y VTEX sin aprobar; Creditop en 6, 7 u 8 y VTEX aprobado; VTEX cancelado y la solicitud viva |
| otro resultado ignorado | Creditop mandó un segundo resultado después de que VTEX canceló (`cannot advance from Cancelled`) |
| nunca llegó al wizard | el pedido de Creditop no tiene solicitud, con la causa si se sabe |

Sólo lee (OMS y la API de pagos de VTEX), sólo en `local` y `qa`, y necesita la llave de la cuenta: `VTEX_ACCOUNT`, `VTEX_APP_KEY` y `VTEX_APP_TOKEN`, en `connectors/.env` (el lugar
único de las credenciales; el `.env` propio, si las tiene, gana). Sin ella la sección lo dice y lo demás anda igual.
Los mensajes de VTEX se recortan en el servidor: el cuerpo de cada llamada (el comprador) no llega al navegador.

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
