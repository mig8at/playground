# tests · probar una compra de tienda en qa de punta a punta

Una compra de prueba en Shopify o VTEX contra qa, mirada y cerrada desde `tests`: qué comercio, qué mandó la tienda,
a qué usuario quedó pegada, sus tablas, y pasarla a aprobada, negada o cancelada como si la entidad hubiera
contestado. Todo contra la base compartida de dev, qa y staging: **hace falta la VPN de dev**.

## 1 · Levantar tests

```bash
make tests
```

Abre http://localhost:5178 (la API queda en :5179). Abajo a la izquierda, `Base: qa` o `local`.

## 2 · Antes de comprar: dictarle tu persona a las centrales

El mock de centrales de qa contesta una persona por defecto (JUAN CARLOS PEREZ GOMEZ) para la cédula que no conoce.
En el panel derecho de `tests` («Centrales de prueba», sin tabla abierta): cédula, nombres y apellidos tal como los
vas a escribir en el wizard → **Cargar en las centrales de qa**. Cargalo justo antes de comprar.

⚠ **Cada cédula guarda datos personales 4 veces por hora**, como mucho. La quinta cae en la pantalla «Límite de
intentos alcanzado» (`/rate-limit-exceeded`). El contador vive en el Redis del backend, no en la base: borrar
solicitudes o usuarios no lo reinicia, y desde acá no hay acceso para borrarlo. Cada intento que pasa vuelve a
contar la hora. Salida: esperar, o usar otra cédula (y cargarla en el paso 2).

## 3 · Comprar

Datos de la persona en las dos tiendas: celular `3016992677`, correo **`miguel-test@creditop.com`** (no
`miguel@creditop.com`: es tu cuenta de administrador en qa y el registro dice «correo ya registrado»). El código
OTP llega a Slack, canal `#qa-messages`.

**Shopify** · tienda https://creditop-dev-store.myshopify.com. La app tiene que estar corriendo:

```bash
cd ~/Desktop/CREDITOP/github/shopify && CREDITOP_LOCAL=1 CREDITOP_ENVIRONMENT=develop npx shopify app dev --config shopify.app.creditop-ecommerce-payments-local.toml --store creditop-dev-store.myshopify.com
```

El túnel cambia en cada arranque: con la URL `https://…trycloudflare.com` que imprime,

```bash
cd ~/Desktop/CREDITOP/github/shopify && npm run extension:url -- https://<túnel>
```

**VTEX** · tienda https://migueldev--creditop.myvtex.com (workspace de desarrollo; nunca `master`). Con sesión:

```bash
vtex login creditop
```

```bash
vtex use migueldev
```

Si https://migueldev--creditop.myvtex.com/_v/creditop.creditop/v4/manifest no da 200, el conector no está
linkeado: `cd ~/Desktop/CREDITOP/github/vtex && vtex link` (no se commitean los cambios que deja en `node/`).

## 4 · Mirar y cerrar la compra en tests

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
  `invoice`; el comando está en `tablero/tasks/integracion-vtex/task.md`).

## 5 · Repetir de cero

- La **basura** de una solicitud la borra con lo que cuelga de ella (con copia en `tests/.backups/`). Si es la última
  del usuario, pregunta si darlo de baja: así su celular, correo y cédula quedan libres para registrarse de nuevo.
- La basura al lado de una **persona** (buscando por celular, correo o cédula) da de baja a un cliente sin
  solicitudes, o lo borra del todo si ya estaba dado de baja. Las cuentas del equipo no se tocan.
- No reinicia el límite de 4 intentos por hora del paso 2.

## Productos de prueba

Las 6 bicicletas (`~/Desktop/CREDITOP/shopping/productos.txt`, con sus imágenes) están en las dos tiendas, con el
mismo nombre y SKU. En VTEX se cargan con
`python3 tablero/tasks/integracion-vtex/artifacts/cargar-bicicletas.py` (idempotente; el catálogo es de toda la
cuenta, también `master`). Un producto nuevo de VTEX tarda en aparecer en la tienda hasta que VTEX lo indexa.

## Por consola

```bash
go run ./tests/server -target qa -q 504073
```

Más: `go run ./tests/server -h` (borrar con plan y `-rollback`, dar de baja, cargar el perfil de
`tests/.profile.json`). Consultas SQL sueltas para qa: `~/Desktop/CREDITOP/shopping/pruebas-qa.sql`.

## Lo que ya confundió

- **La identidad puede pasar con otra persona.** Si Ágil Data devuelve otro nombre, la cadena pregunta a TusDatos, y
  el mock de TusDatos de qa contesta `match` sin nombre (solicitud 504073). Para una prueba limpia, el paso 2 siempre.
- **El monto de VTEX trae centavos** (504073: 242.259,56) y pasa así a la solicitud.
- El simulador no deja fila en el historial de estados: la línea de estados termina en 9 aunque la solicitud esté en 11.
