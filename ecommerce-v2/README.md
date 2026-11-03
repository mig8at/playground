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

## 3 · Comprar

En `ecommerce`, pestaña **Tiendas** de la consola de abajo, un semáforo dice si cada tienda está lista para comprar y el botón
**Levantar** corre en segundo plano lo de esta sección: `shopify app dev` (y apunta la extensión al túnel nuevo solo) y
`vtex link` (sólo con la sesión en `creditop · develop`). **Parar** corta lo que levantó ecommerce, y cerrar `npm run dev`
lo corta también. El login de VTEX abre el navegador: va siempre a mano. Los comandos de abajo son lo que corre el
botón (`server/stores.go`): si cambia uno, se cambian los dos.

Datos de la persona en las dos tiendas: un celular y un correo de prueba tuyos. El correo no puede ser el de una cuenta
de administrador en qa (el registro dice «correo ya registrado»): usá uno aparte, como `tu-nombre-test@creditop.com`.
El código OTP llega a Slack, canal `#qa-messages`.

**Shopify** · tienda https://creditop-dev-store.myshopify.com. La app tiene que estar corriendo:

```bash
cd <clon de shopify> && CREDITOP_LOCAL=1 CREDITOP_ENVIRONMENT=develop npx shopify app dev --config shopify.app.creditop-ecommerce-payments-local.toml --store creditop-dev-store.myshopify.com
```

El túnel cambia en cada arranque: con la URL `https://…trycloudflare.com` que imprime,

```bash
cd <clon de shopify> && npm run extension:url -- https://<túnel>
```

**VTEX** · tienda https://develop--creditop.myvtex.com (workspace de desarrollo de la cuenta de pruebas). Con sesión:

```bash
vtex login creditop
```

```bash
vtex use develop
```

Si https://develop--creditop.myvtex.com/_v/creditop.creditop/v5/manifest no da 200, el conector no está
linkeado: `cd <clon de vtex> && vtex link` (no se commitean los cambios que deja en `node/`).

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

- Shopify: «Volver a la tienda» pasa por el túnel de `shopify app dev`; con la app apagada o reiniciada no abre.
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
